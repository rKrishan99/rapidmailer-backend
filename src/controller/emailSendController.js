// src/controllers/emailSendController.js
import nodemailer from 'nodemailer';
import { htmlToText } from 'html-to-text';

const MAX_RECIPIENTS_PER_REQUEST = 500;

export const sendEmails = async (req, res) => {
  try {
    const { emailTemplate, emails } = req.body;

    // Validate input
    if (!emailTemplate || !emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    if (emails.length > MAX_RECIPIENTS_PER_REQUEST) {
      return res.status(400).json({
        error: `Too many recipients in a single request (max ${MAX_RECIPIENTS_PER_REQUEST})`,
      });
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
      return res.status(500).json({ error: 'Email sending is not configured on the server' });
    }

    // Create reusable transporter object using SMTP transport
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // Convert HTML to plain text for the text version
    const textVersion = htmlToText(emailTemplate.html, {
      wordwrap: 130,
    });

    // Send emails in batches to avoid rate limiting
    const batchSize = 10; // Adjust based on your SMTP provider's limits
    const results = [];
    
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(email => {
        const mailOptions = {
          from: `"${process.env.FROM_NAME || 'RapidMailer'}" <${FROM_EMAIL}>`,
          to: email,
          subject: emailTemplate.subject || 'No Subject',
          html: emailTemplate.html,
          text: textVersion,
        };

        return transporter.sendMail(mailOptions)
          .then(info => ({ email, status: 'sent', messageId: info.messageId }))
          .catch(err => ({ email, status: 'failed', error: err.message }));
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.status(200).json({
      message: 'Email sending process completed',
      results,
      stats: {
        total: results.length,
        sent: results.filter(r => r.status === 'sent').length,
        failed: results.filter(r => r.status === 'failed').length,
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