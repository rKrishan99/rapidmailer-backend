import express from 'express';
import { validateEmail } from '../utils/emailValidator.js';

const router = express.Router();

router.post('/verify-emails', async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ message: 'Invalid email list' });
    }

    const validationResults = await Promise.all(
      emails.map(email => validateEmail(email))
    );

    const validEmails = validationResults
      .filter(result => result.valid)
      .map(result => result.email);

    const invalidEmails = validationResults
      .filter(result => !result.valid)
      .map(result => ({
        email: result.email,
        reason: result.reason
      }));

    res.json({ validEmails, invalidEmails });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ message: 'Email validation failed' });
  }
});

export default router;