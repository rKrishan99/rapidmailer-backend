import express from "express";
import extractEmailsFromWebsite, {
  enrichLeadsWithEmails,
} from "../controller/emailExtractorController.js";

const router = express.Router();

const MAX_URLS = 200;

/**
 * POST /api/extract-emails-from-urls
 *
 * Accepts a list of website URLs, visits each one, and returns the emails
 * found on that page.
 *
 * Body: { urls: string[] }
 * Response: { results: [{ url: string, emails: string[], error?: string }] }
 */
router.post("/extract-emails-from-urls", async (req, res) => {
  try {
    const { urls } = req.body || {};

    // --- Input validation ---
    if (!Array.isArray(urls) || urls.length === 0) {
      return res
        .status(400)
        .json({ error: "urls must be a non-empty array of strings." });
    }

    if (urls.length > MAX_URLS) {
      return res.status(400).json({
        error: `Too many URLs. Maximum allowed per request is ${MAX_URLS}.`,
      });
    }

    // Normalise, deduplicate, and validate each URL
    const VALID_URL_RE = /^https?:\/\/.+/i;

    const seen = new Set();
    const items = []; // { originalUrl, normalisedUrl, validationError? }

    for (const raw of urls) {
      if (typeof raw !== "string") {
        items.push({ originalUrl: String(raw), error: "Not a valid string." });
        continue;
      }

      const trimmed = raw.trim();
      if (!trimmed) continue; // silently skip blank entries

      // Auto-prepend https:// if protocol is missing
      const normalised = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;

      // Validate with URL constructor for full correctness
      let parsedUrl;
      try {
        parsedUrl = new URL(normalised);
      } catch {
        items.push({ originalUrl: trimmed, error: "Invalid URL format." });
        continue;
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        items.push({ originalUrl: trimmed, error: "Only http/https URLs are supported." });
        continue;
      }

      // Deduplicate (case-insensitive on the normalised href)
      const dedupeKey = parsedUrl.href.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      items.push({ originalUrl: trimmed, normalisedUrl: parsedUrl.href });
    }

    // --- Concurrency-controlled extraction ---
    const CONCURRENCY = 5;

    const validItems = items.filter((i) => i.normalisedUrl && !i.error);
    const invalidItems = items.filter((i) => i.error);

    const results = new Array(validItems.length);
    const queue = validItems.map((item, index) => ({ item, index }));

    async function worker() {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) continue;
        const { item, index } = task;

        try {
          const emails = await extractEmailsFromWebsite(item.normalisedUrl);
          results[index] = {
            url: item.originalUrl,
            emails,
          };
        } catch (err) {
          console.error(`Email extraction failed for ${item.normalisedUrl}:`, err.message);
          results[index] = {
            url: item.originalUrl,
            emails: [],
            error: "Failed to reach or parse the website.",
          };
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, validItems.length || 1) },
      worker
    );
    await Promise.all(workers);

    // Merge invalid items back (they go at the end, preserving their original order)
    const allResults = [
      ...results,
      ...invalidItems.map((i) => ({
        url: i.originalUrl,
        emails: [],
        error: i.error,
      })),
    ];

    return res.json({ results: allResults });
  } catch (err) {
    console.error("extract-emails-from-urls error:", err.message);
    return res.status(500).json({ error: "Internal server error during email extraction." });
  }
});

// ---------------------------------------------------------------------------
// Bulk email-finder for an EXISTING lead list (e.g. Google Maps export).
// POST /enrich-emails-bulk { leads: [{name, website, ...}] }
// Unlike the URL extractor above, this does NOT run a fresh Google Search —
// it just visits each lead's own website and fills in an `email` column,
// passing every other field on the lead straight through untouched.
// ---------------------------------------------------------------------------
router.post("/enrich-emails-bulk", async (req, res) => {
  try {
    const { leads } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: "leads (non-empty array) is required!" });
    }

    if (leads.length > 300) {
      return res.status(400).json({ error: "Max 300 leads per request." });
    }

    const results = await enrichLeadsWithEmails(leads);
    res.json({ results });
  } catch (error) {
    console.error("Bulk Email Enrichment Error:", error.message);
    res.status(500).json({ error: "Failed to enrich leads with emails" });
  }
});

export default router;
