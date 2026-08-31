// src/controllers/emailSendController.js
import nodemailer from 'nodemailer';
import { htmlToText } from 'html-to-text';
import { getSettings } from '../config/settingsStore.js';

const MAX_RECIPIENTS_PER_REQUEST = 500;

// Renders {{field}}-style placeholders against one record for the
// personalized mail-merge mode — matches the template style already used in
// the user's own cold-outreach playbook.
function renderTemplate(template, record) {
  if (!template) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, field) => {
    const value = record ? record[field] : undefined;
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

// Sends a batch of mail-options-producing items with a delay between
// batches, to avoid tripping the SMTP provider's rate limiting. Shared by
// both the blast and personalized send modes below.
async function sendInBatches(transporter, items, buildMailOptions, batchSize = 10) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchPromises = batch.map((item) => {
      const mailOptions = buildMailOptions(item);
      const recipient = mailOptions.to;
      return transporter
        .sendMail(mailOptions)
        .then((info) => ({ email: recipient, status: 'sent', messageId: info.messageId }))
        .catch((err) => ({ email: recipient, status: 'failed', error: err.message }));
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
    const { emailTemplate, emails, mode, records } = req.body;

    if (!emailTemplate) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    const { smtp } = getSettings();
    if (!smtp.host || !smtp.port || !smtp.user || !smtp.pass || !smtp.fromEmail) {
      return res.status(500).json({
        error: 'Email sending is not configured. Add your SMTP credentials in Settings first.',
      });
    }

    const fromHeader = `"${smtp.fromName || 'RapidMailer'}" <${smtp.fromEmail}>`;
    const transporter = buildTransporter(smtp);

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

      results = await sendInBatches(transporter, validRecords, (record) => {
        const subject = renderTemplate(emailTemplate.subject || 'No Subject', record);
        const html = renderTemplate(emailTemplate.html, record);
        const text = htmlToText(html, { wordwrap: 130 });
        return { from: fromHeader, to: record.email, subject, html, text };
      });
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
      results = await sendInBatches(transporter, emails, (email) => ({
        from: fromHeader,
        to: email,
        subject: emailTemplate.subject || 'No Subject',
        html: emailTemplate.html,
        text: textVersion,
      }));
    }

    res.status(200).json({
      message: 'Email sending process completed',
      results,
      stats: {
        total: results.length,
        sent: results.filter((r) => r.status === 'sent').length,
        failed: results.filter((r) => r.status === 'failed').length,
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
