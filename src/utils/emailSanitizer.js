// src/utils/emailSanitizer.js
//
// Pre-flight email sanitization applied to every cell value before it is
// validated or dispatched. Real-world CSVs from Google Maps exports, scrapers,
// and third-party enrichment tools routinely produce dirty email columns:
//
//   "user@acme.com website"           → user@acme.com
//   "user1@a.com; user2@b.com"        → user1@a.com  (first valid wins)
//   "%20user@acme.com%20"             → user@acme.com
//   "logo.gif"                        → null
//   "noreply@sentry.io"               → null
//   "test@example.com"                → null
//
// The function is deliberately pure and side-effect-free so it can be
// unit-tested without any framework setup.

import { validateEmail } from './emailValidator.js';

// ── Block-list patterns ────────────────────────────────────────────────────

/** Image/media file extensions that are never email addresses. */
const BLOCKED_EXTENSIONS = /\.(gif|png|jpg|jpeg|webp|svg|bmp|ico|pdf|zip|mp4|mov)$/i;

/** Domains that are never real outreach targets. */
const BLOCKED_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'sentry.io',
  'sentry-next.io',
  'noreply.',
  'no-reply.',
  'donotreply.',
  'mailer-daemon.',
  'postmaster.',
  'bounce.',
  'bounces.',
  'localhost',
];

/** URL / web-URI artifacts that may trail a real email address in a CSV cell. */
const TRAILING_ARTIFACTS = /[\s,;]+(?:website|location|map|page|url|link|http|www|contact|info|home|blog|shop|store|office)[\w:/.-]*/gi;

// ── Core helper ────────────────────────────────────────────────────────────

/**
 * Returns true when the candidate token looks like a blocked / junk address.
 * @param {string} token  Already trimmed, lowercased candidate.
 */
function isBlockedToken(token) {
  if (BLOCKED_EXTENSIONS.test(token)) return true;
  for (const domain of BLOCKED_DOMAINS) {
    if (token.includes(domain)) return true;
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extracts the best valid email address from a single CSV cell value.
 *
 * Strategy:
 *  1. URL-decode percent-encoded sequences (%20 etc.).
 *  2. Strip known trailing non-email words (e.g. "website", "location").
 *  3. Split on common multi-value delimiters: `;`, `,`, space, newline, `|`.
 *  4. For each token, run the block-list check then the format validator.
 *  5. Return the first token that passes both checks, or null.
 *
 * @param {string|null|undefined} raw  The raw cell value from the CSV.
 * @returns {string|null}  A clean email address, or null if none found.
 */
export function sanitizeEmailCell(raw) {
  if (raw === null || raw === undefined) return null;

  let cell = String(raw).trim();
  if (!cell) return null;

  // Step 1 – URL-decode artifacts like %20, %40, %2C
  try {
    cell = decodeURIComponent(cell);
  } catch {
    // If it's malformed percent-encoding, work with the raw string.
  }

  // Step 2 – Strip trailing web-artifact words
  cell = cell.replace(TRAILING_ARTIFACTS, '').trim();

  // Step 3 – Split on multi-value delimiters
  const tokens = cell
    .split(/[;,|\s\n\r]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // Step 4 & 5 – Find first valid, non-blocked token
  for (const token of tokens) {
    if (!token.includes('@')) continue;         // not an email shape at all
    if (isBlockedToken(token)) continue;        // junk / blocked domain
    if (validateEmail(token)) return token;     // passes RFC-style check
  }

  return null;
}

/**
 * Sanitizes an array of raw cell values and returns only the valid emails.
 * Preserves order; duplicate addresses (same email appearing in multiple cells)
 * are deduplicated.
 *
 * @param {string[]} raws
 * @returns {string[]}
 */
export function sanitizeEmailList(raws) {
  const seen = new Set();
  const out = [];
  for (const raw of raws) {
    const email = sanitizeEmailCell(raw);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}
