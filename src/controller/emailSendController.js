// src/controllers/emailSendController.js
import nodemailer from 'nodemailer';
import { htmlToText } from 'html-to-text';
import { getEmailAccount, getDefaultEmailAccount } from '../config/settingsStore.js';

const MAX_RECIPIENTS_PER_REQUEST = 500;

// Renders {{field}}-style placeholders against one record for the
// personalized mail-merge mode — matches the template style already used in
// the user's own cold-outreach playbook.
// The field name pattern [\w.\s-]+ is intentionally broad so column names
// that include spaces (e.g. "primary pitch hook") or hyphens ("business-name")
// work as-is without the user needing to rename their CSV headers.
function renderTemplate(template, record) {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.\s-]+?)\s*\}\}/g, (match, field) => {
    const trimmedField = field.trim();
    const value = record ? record[trimmedField] : undefined;
    return value === undefined || value === null ? '' : String(value);
  });
}

function buildTransporter(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure, // true for 465, false for other ports
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

/** Extract the bare domain from an email address. */
function domainFromEmail(email) {
  if (!email || !email.includes('@')) return '';
  return email.split('@')[1].toLowerCase().trim();
}

// Sends a batch of mail-options-producing items with a delay between
// batches, to avoid tripping the SMTP provider's rate limiting. Shared by
// both the blast and personalized send modes below.
// Each result now includes: email, domain, status, messageId, timestamp, errorDetail.
async function sendInBatches(transporter, items, buildMailOptions, batchSize = 10, bccAddress = null) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchPromises = batch.map((item) => {
      const mailOptions = buildMailOptions(item);
      const recipient = mailOptions.to;

      // Inject BCC when test mode = "bcc"
      if (bccAddress) {
        mailOptions.bcc = bccAddress;
      }

      const timestamp = new Date().toISOString();

      return transporter
        .sendMail(mailOptions)
        .then((info) => ({
          email: recipient,
          domain: domainFromEmail(recipient),
          status: 'sent',
          messageId: info.messageId,
          timestamp,
          errorDetail: null,
        }))
        .catch((err) => ({
          email: recipient,
          domain: domainFromEmail(recipient),
          status: 'failed',
          messageId: null,
          timestamp,
          errorDetail: err.message,
        }));
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}

export const sendEmails = async (req, res) => {
  try {
    const {
      emailTemplate,
      emails,
      mode,
      records,
      accountId,
      testMode,   // "none" | "single" | "bcc"
      testEmail,  // owner's verification address (required when testMode !== "none")
    } = req.body;

    if (!emailTemplate) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    let smtp;
    if (accountId) {
      smtp = getEmailAccount(accountId);
      if (!smtp) {
        return res.status(400).json({ error: 'No email account with that id' });
      }
    } else {
      smtp = getDefaultEmailAccount();
    }

    if (!smtp || !smtp.host || !smtp.port || !smtp.user || !smtp.pass || !smtp.fromEmail) {
      return res.status(500).json({
        error: 'Email sending is not configured. Add a sender account in Email Accounts first.',
      });
    }

    const appName = process.env.APP_NAME || 'Omini Pulse';
    const fromHeader = `"${smtp.fromName || appName}" <${smtp.fromEmail}>`;
    const transporter = buildTransporter(smtp);

    // Rows dropped by the sanitization middleware — returned in the report.
    const skippedRows = req.body._skippedRows || [];
    const bccAddress = testMode === 'bcc' && testEmail ? testEmail : null;

    // ── Test Mode: Single ──────────────────────────────────────────────────
    // Send only row #1 (or the first email) to the owner's verification address.
    // The full queue is NOT triggered.
    if (testMode === 'single' && testEmail) {
      let mailOptions;

      if (mode === 'personalized') {
        if (!records || records.length === 0) {
          return res.status(400).json({ error: 'No records available for test send' });
        }
        const record = records[0];
        const subject = '[TEST] ' + renderTemplate(emailTemplate.subject || 'No Subject', record);
        const html = renderTemplate(emailTemplate.html, record);
        const text = htmlToText(html, { wordwrap: 130 });
        mailOptions = { from: fromHeader, to: testEmail, subject, html, text };
      } else {
        if (!emails || emails.length === 0) {
          return res.status(400).json({ error: 'No emails available for test send' });
        }
        const text = htmlToText(emailTemplate.html, { wordwrap: 130 });
        mailOptions = {
          from: fromHeader,
          to: testEmail,
          subject: '[TEST] ' + (emailTemplate.subject || 'No Subject'),
          html: emailTemplate.html,
          text,
        };
      }

      const timestamp = new Date().toISOString();
      try {
        const info = await transporter.sendMail(mailOptions);
        return res.status(200).json({
          message: 'Test email sent successfully',
          testMode: 'single',
          results: [{
            email: testEmail,
            domain: domainFromEmail(testEmail),
            status: 'sent',
            messageId: info.messageId,
            timestamp,
            errorDetail: null,
          }],
          skippedRows,
          stats: { total: 1, sent: 1, failed: 0, skipped: skippedRows.length },
        });
      } catch (err) {
        return res.status(200).json({
          message: 'Test email failed',
          testMode: 'single',
          results: [{
            email: testEmail,
            domain: domainFromEmail(testEmail),
            status: 'failed',
            messageId: null,
            timestamp,
            errorDetail: err.message,
          }],
          skippedRows,
          stats: { total: 1, sent: 0, failed: 1, skipped: skippedRows.length },
        });
      }
    }

    // ── Normal / BCC send ──────────────────────────────────────────────────
    let results;

    if (mode === 'personalized') {
      if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'records (non-empty array) is required for personalized mode' });
      }
      if (records.length > MAX_RECIPIENTS_PER_REQUEST) {
        return res.status(400).json({
          error: `Too many recipients in a single request (max ${MAX_RECIPIENTS_PER_REQUEST})`,
        });
      }

      const validRecords = records.filter((r) => r && r.email);
      if (validRecords.length === 0) {
        return res.status(400).json({ error: 'No records with a valid email field were provided' });
      }

      results = await sendInBatches(
        transporter,
        validRecords,
        (record) => {
          const subject = renderTemplate(emailTemplate.subject || 'No Subject', record);
          const html = renderTemplate(emailTemplate.html, record);
          const text = htmlToText(html, { wordwrap: 130 });
          return { from: fromHeader, to: record.email, subject, html, text };
        },
        10,
        bccAddress,
      );
    } else {
      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'Invalid request data' });
      }
      if (emails.length > MAX_RECIPIENTS_PER_REQUEST) {
        return res.status(400).json({
          error: `Too many recipients in a single request (max ${MAX_RECIPIENTS_PER_REQUEST})`,
        });
      }

      const textVersion = htmlToText(emailTemplate.html, { wordwrap: 130 });
      results = await sendInBatches(
        transporter,
        emails,
        (email) => ({
          from: fromHeader,
          to: email,
          subject: emailTemplate.subject || 'No Subject',
          html: emailTemplate.html,
          text: textVersion,
        }),
        10,
        bccAddress,
      );
    }

    const sentCount   = results.filter((r) => r.status === 'sent').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    res.status(200).json({
      message: 'Email sending process completed',
      testMode: testMode || 'none',
      results,
      skippedRows,
      stats: {
        total: results.length,
        sent: sentCount,
        failed: failedCount,
        skipped: (req.body._skippedRecords || req.body._skippedEmails || 0),
      },
    });
  } catch (error) {
    console.error('Error sending emails:', error);
    res.status(500).json({
      error: 'Failed to send emails',
      ...(process.env.NODE_ENV === 'production' ? {} : { details: error.message }),
    });
  }
};
