// src/middleware/emailValidation.js
//
// Production-grade approach: never block a campaign because SOME addresses
// are invalid — real-world CSVs always contain dirty data. Instead, sanitize
// and strip bad rows, then let the send proceed with the valid ones. The
// controller's response already includes per-recipient sent/failed stats so
// the user always knows exactly what happened.
//
// The only hard rejections are structural errors (missing array, wrong type)
// that indicate a bug in the client, not dirty user data.
//
// Sanitization pipeline (applied per cell before the format validator):
//   1. URL-decode percent-encoded sequences (%20, %40, …)
//   2. Strip trailing non-email words (e.g. "website", "location")
//   3. Split multi-value delimiters (;  ,  space  newline  |)
//   4. Block junk tokens (.gif, example.com, sentry.io, noreply.*, …)
//   5. RFC format check via validateEmail()

import { validateEmail } from '../utils/emailValidator.js';
import { sanitizeEmailCell } from '../utils/emailSanitizer.js';

export const validateEmails = (req, res, next) => {
  const { emails, mode, records } = req.body;

  if (mode === 'personalized') {
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'records array is required for personalized mode' });
    }

    const originalLength = records.length;
    const skippedRows = [];  // rows that were dropped — sent back to the UI
    const cleanRecords = [];

    for (const r of records) {
      if (!r || !r.email) {
        skippedRows.push({
          email: r?.email ?? '',
          domain: '',
          status: 'skipped',
          reason: 'Missing email field',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const cleaned = sanitizeEmailCell(r.email);

      if (!cleaned) {
        skippedRows.push({
          email: String(r.email).trim(),
          domain: '',
          status: 'skipped',
          reason: 'Invalid or blocked email address',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // Re-attach the sanitized address so the controller always has a clean value.
      cleanRecords.push({ ...r, email: cleaned });
    }

    if (cleanRecords.length === 0) {
      return res.status(400).json({
        error:
          'None of the provided records contain a valid email address. ' +
          'Please check that you selected the correct email column and that the ' +
          'column contains properly formatted addresses (e.g. user@example.com).',
      });
    }

    req.body.records = cleanRecords;
    req.body._skippedRecords = originalLength - cleanRecords.length;
    req.body._skippedRows = skippedRows;

    return next();
  }

  // ── Blast mode ────────────────────────────────────────────────────────────
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Emails array is required' });
  }

  const skippedRows = [];
  const cleanEmails = [];

  for (const raw of emails) {
    const cleaned = sanitizeEmailCell(raw);
    if (cleaned) {
      cleanEmails.push(cleaned);
    } else {
      skippedRows.push({
        email: String(raw || '').trim(),
        domain: '',
        status: 'skipped',
        reason: 'Invalid or blocked email address',
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (cleanEmails.length === 0) {
    return res.status(400).json({
      error:
        'None of the provided email addresses are valid. ' +
        'Please check your CSV and ensure it contains properly formatted addresses.',
    });
  }

  req.body.emails = cleanEmails;
  req.body._skippedEmails = emails.length - cleanEmails.length;
  req.body._skippedRows = skippedRows;

  next();
};
