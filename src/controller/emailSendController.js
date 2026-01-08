// src/controllers/emailSendController.js
import nodemailer from 'nodemailer';
import { htmlToText } from 'html-to-text';

export const sendEmails = async (req, res) => {
  try {
    const { emailTemplate, emails } = req.body;
    console.log("email tamplate and email here > ", emailTemplate, emails);
    
    // Validate input
    if (!emailTemplate || !emails || !Array.isArray(emails)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // Create reusable transporter object using SMTP transport
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
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
          from: `"Your Company" <${process.env.FROM_EMAIL}>`,
          to: email,
          subject: emailTemplate.subject || 'No Subject',
          html: emailTemplate.html,
          text: textVersion,
        };

        return transporter.sendMail(mailOptions)
          .then(info => ({ email, status: 'sent', info }))
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
    res.status(500).json({ error: 'Failed to send emails', details: error.message });
  }
};