import axios from "axios";
import * as cheerio from "cheerio";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

async function extractEmailsFromWebsite(website) {
  if (!website) return [];

  let url;
  try {
    url = new URL(website);
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
      maxContentLength: 5 * 1024 * 1024, // 5MB cap
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const $ = cheerio.load(html);
    const text = $("body").text();

    const mailtoEmails = [];
    $("a[href^='mailto:']").each((_, el) => {
      const href = $(el).attr("href");
      const email = href.replace("mailto:", "").split("?")[0].trim();
      if (email) mailtoEmails.push(email);
    });

    const textEmails = text.match(EMAIL_REGEX) || [];

    const emails = [...new Set([...mailtoEmails, ...textEmails].map((e) => e.toLowerCase()))];

    return emails;
  } catch (error) {
    console.error(`Failed to extract emails from ${website}:`, error.message);
    return [];
  }
}

/**
 * Bulk email-finder for an EXISTING list of leads (e.g. a Google Maps export
 * that already has name/address/website columns) — unlike /extract-emails,
 * this does not start a fresh Google Search. It just walks each lead's
 * `website` field and fills in emails, using limited concurrency so a list
 * of 100+ leads doesn't fire 100+ simultaneous requests.
 *
 * Each input lead is returned unchanged plus two new fields:
 *   - emails: string[]  (every address found on the site)
 *   - email:  string    (the first one, for direct use in the CSV pipeline)
 *
 * A lead with no real website (missing, or the literal "No Website" the
 * Google Maps scraper writes) is passed through untouched — no request is
 * made for it.
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
      const isRealWebsite = website && website.toLowerCase() !== "no website";

      if (!isRealWebsite) {
        results[index] = { ...lead, emails: [], email: lead.email || "" };
        continue;
      }

      const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
      const emails = await extractEmailsFromWebsite(url);
      results[index] = { ...lead, emails, email: emails[0] || lead.email || "" };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, leads.length) }, worker);
  await Promise.all(workers);

  return results;
}

export default extractEmailsFromWebsite;
