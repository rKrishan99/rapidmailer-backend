import axios from "axios";
import * as cheerio from "cheerio";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Visit a single website URL and return every unique email address found on
 * its homepage (both from mailto: links and plain text).
 *
 * Returns an empty array (never throws) when the site is unreachable,
 * returns a non-HTTP response, or contains no emails.
 *
 * @param {string} website - A fully-qualified URL (http:// or https://).
 * @returns {Promise<string[]>} Lowercase-deduplicated email list.
 */
async function extractEmailsFromWebsite(website) {
  if (!website) return [];

  // Normalise: auto-prepend https:// when the caller omits a protocol
  const rawUrl = /^https?:\/\//i.test(website.trim())
    ? website.trim()
    : `https://${website.trim()}`;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return [];
  }

  try {
    const { data: html } = await axios.get(url.toString(), {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 5 * 1024 * 1024, // 5 MB cap
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const $ = cheerio.load(html);

    // 1. Harvest explicit mailto: links first (highest signal)
    const mailtoEmails = [];
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace(/^mailto:/i, "").split("?")[0].trim();
      if (email) mailtoEmails.push(email);
    });

    // 2. Harvest emails from visible body text
    const bodyText = $("body").text();
    const textEmails = bodyText.match(EMAIL_REGEX) || [];

    // 3. Merge, lowercase, deduplicate
    const emails = [
      ...new Set(
        [...mailtoEmails, ...textEmails].map((e) => e.toLowerCase().trim())
      ),
    ].filter((e) => e.includes("@")); // final sanity check

    return emails;
  } catch (error) {
    console.error(`Failed to extract emails from ${website}:`, error.message);
    return [];
  }
}

/**
 * Bulk email-finder for an EXISTING list of leads (e.g. a Google Maps export
 * that already has name/address/website columns). Unlike the URL extractor
 * endpoint, this does not start a new search — it walks each lead's `website`
 * field and fills in emails, using limited concurrency so a list of 100+ leads
 * doesn't fire 100+ simultaneous requests.
 *
 * Each input lead is returned unchanged plus two new fields:
 *   - emails: string[]  (every address found on the site)
 *   - email:  string    (the first one, for direct use in the CSV pipeline)
 *
 * A lead with no real website (missing, or the literal "No Website" that the
 * Google Maps scraper writes) is passed through untouched — no request is
 * made for it.
 *
 * @param {object[]} leads
 * @param {number}   [concurrency=5]
 * @returns {Promise<object[]>}
 */
export async function enrichLeadsWithEmails(leads, concurrency = 5) {
  const queue = leads.map((lead, index) => ({ lead, index }));
  const results = new Array(leads.length);

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      const { lead, index } = item;

      const website = (lead.website || lead.url || "").toString().trim();
      const isRealWebsite =
        website && website.toLowerCase() !== "no website";

      if (!isRealWebsite) {
        results[index] = { ...lead, emails: [], email: lead.email || "" };
        continue;
      }

      const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
      const emails = await extractEmailsFromWebsite(url);
      results[index] = {
        ...lead,
        emails,
        email: emails[0] || lead.email || "",
      };
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, leads.length) },
    worker
  );
  await Promise.all(workers);

  return results;
}

export default extractEmailsFromWebsite;
