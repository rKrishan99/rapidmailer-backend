import express from 'express';
import { validateEmail } from '../utils/emailValidator.js';

const router = express.Router();

const MAX_EMAILS_PER_REQUEST = 2000;

router.post('/verify-emails', async (req, res) => {
  try {
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ message: 'Invalid email list' });
    }
    if (emails.length > MAX_EMAILS_PER_REQUEST) {
      return res
        .status(400)
        .json({ message: `Too many emails in a single request (max ${MAX_EMAILS_PER_REQUEST})` });
    }

    const validEmails = [];
    const invalidEmails = [];

    for (const email of emails) {
      const trimmed = typeof email === 'string' ? email.trim() : '';
      if (!trimmed) {
        invalidEmails.push({ email: trimmed, reason: 'Missing email' });
      } else if (validateEmail(trimmed)) {
        validEmails.push(trimmed);
      } else {
        invalidEmails.push({ email: trimmed, reason: 'Invalid format' });
      }
    }

    res.json({ validEmails, invalidEmails });
  } catch (error) {
    console.error('Validation error:', error.message);
    res.status(500).json({ message: 'Email validation failed' });
  }
});

export default router;
