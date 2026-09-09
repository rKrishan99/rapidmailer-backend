import axios from "axios";
import * as cheerio from "cheerio";

// Social Profile & Contact Enricher
// ----------------------------------
// For leads that showed up on Google Maps with no website (and therefore no
// email), most local businesses still run a Facebook Page or Instagram
// profile for customer engagement. This module finds those pages via a
// free, no-API-key search (DuckDuckGo's HTML endpoint, which is a plain
// server-rendered results page — no JS, no login, no billing) and makes a
// best-effort attempt to pull a public email/phone off the Facebook page
// itself.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * @typedef {Object} EnrichedContact
 * @property {string} businessName
 * @property {string} city
 * @property {string|null} facebookUrl
 * @property {string|null} instagramUrl
 * @property {string|null} extractedEmail
 * @property {string|null} extractedPhone
 */

// Paths that show up in facebook.com / instagram.com search results but are
// never the business's own page — login walls, sharer widgets, help docs,
// tracking pixels, etc. Anything matching these is skipped.
const FACEBOOK_JUNK_PATH = /^\/(login|sharer|help|policies|policy|plugins|tr|l\.php|groups\/[^/]+\/(permalink|posts)|watch|marketplace|events|ads|business\/help)/i;
const INSTAGRAM_JUNK_PATH = /^\/(p|reel|reels|explore|accounts|stories|direct|about|legal|developer)\//i;

// DuckDuckGo's HTML results wrap the real target URL in a redirect link:
// //duckduckgo.com/l/?uddg=<encoded-real-url>&rut=... — this pulls the real
// URL back out. If a result link is already a plain URL (no redirect), it's
// returned as-is.
function unwrapDuckDuckGoLink(href) {
  if (!href) return null;
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return href.startsWith("http") ? href : null;
  } catch {
    return null;
  }
}

// Runs a DuckDuckGo HTML search and returns the raw list of result URLs, in
// order. No API key required — this is the same endpoint DuckDuckGo serves
// to no-JS/lite clients.
async function searchDuckDuckGo(query) {
  const response = await axios.get("https://html.duckduckgo.com/html/", {
    params: { q: query },
    timeout: 15000,
    maxContentLength: 5 * 1024 * 1024,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    validateStatus: () => true,
  });

  if (typeof response.data !== "string") return [];

  const $ = cheerio.load(response.data);
  const urls = [];
  $("a.result__a, a.result__url").each((_, el) => {
    const href = $(el).attr("href");
    const real = unwrapDuckDuckGoLink(href);
    if (real) urls.push(real);
  });
  return urls;
}

// Strips a facebook.com/instagram.com URL down to just the profile path,
// dropping tracking query params (?ref=..., ?fref=..., ?__tn__=...) so the
// stored URL is clean.
function cleanProfileUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.hostname}${pathname}`;
  } catch {
    return rawUrl;
  }
}

async function searchFacebookPage(businessName, city) {
  const query = `"${businessName}" "${city}" site:facebook.com`;
  try {
    const urls = await searchDuckDuckGo(query);
    for (const rawUrl of urls) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }
      if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) continue;
      if (FACEBOOK_JUNK_PATH.test(parsed.pathname)) continue;
      if (parsed.pathname === "/" || parsed.pathname === "") continue;
      return cleanProfileUrl(rawUrl);
    }
    return null;
  } catch (error) {
    console.error(`⚠️ Facebook search failed for "${businessName}":`, error.message);
    return null;
  }
}

async function searchInstagramProfile(businessName, city) {
  const query = `"${businessName}" "${city}" site:instagram.com`;
  try {
    const urls = await searchDuckDuckGo(query);
    for (const rawUrl of urls) {
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }
      if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) continue;
      if (INSTAGRAM_JUNK_PATH.test(parsed.pathname)) continue;
      if (parsed.pathname === "/" || parsed.pathname === "") continue;
      return cleanProfileUrl(rawUrl);
    }
    return null;
  } catch (error) {
    console.error(`⚠️ Instagram search failed for "${businessName}":`, error.message);
    return null;
  }
}

const EMAIL_REGEX = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/gi;
// Loose international phone matcher: an optional +country code, then 7-14
// more digits, allowing spaces/dashes/dots/parens as separators. Deliberately
// permissive — this is a "does something phone-shaped exist" pass, not
// validation.
const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

// Best-effort only: Facebook aggressively gates logged-out/bot traffic, so
// this will come back empty for a large share of pages — that's expected,
// not a bug. When it works, it's a bonus; the facebookUrl itself (so a human
// can open Messenger) is the reliable part of this feature.
async function extractContactFromFacebookPage(facebookUrl) {
  try {
    const response = await axios.get(facebookUrl, {
      timeout: 12000,
      maxContentLength: 5 * 1024 * 1024,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: () => true,
    });

    const html = typeof response.data === "string" ? response.data : "";
    if (!html) return { email: null, phone: null };

    const emailMatches = html.match(EMAIL_REGEX) || [];
    const validEmail =
      emailMatches.find(
        (e) => !/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(e) && !/facebook\.com$/i.test(e)
      ) || null;

    // Only look at a text-stripped version for phone numbers — raw HTML is
    // full of numeric noise (ids, timestamps, pixel dimensions) that would
    // otherwise false-positive constantly.
    const textOnly = cheerio.load(html)("body").text();
    const phoneMatches = textOnly.match(PHONE_REGEX) || [];
    const validPhone = phoneMatches.find((p) => p.replace(/\D/g, "").length >= 7) || null;

    return {
      email: validEmail,
      phone: validPhone ? validPhone.trim() : null,
    };
  } catch (error) {
    console.error(`⚠️ Could not read Facebook page ${facebookUrl}:`, error.message);
    return { email: null, phone: null };
  }
}

/**
 * Locate a business's social profiles and, best-effort, a public contact
 * email/phone from its Facebook page.
 * @param {{businessName: string, city: string}} input
 * @returns {Promise<EnrichedContact>}
 */
export async function enrichSocialProfile({ businessName, city }) {
  const name = (businessName || "").trim();
  const location = (city || "").trim();

  const base = {
    businessName: name,
    city: location,
    facebookUrl: null,
    instagramUrl: null,
    extractedEmail: null,
    extractedPhone: null,
  };

  if (!name) return base;

  const [facebookUrl, instagramUrl] = await Promise.all([
    searchFacebookPage(name, location),
    searchInstagramProfile(name, location),
  ]);

  base.facebookUrl = facebookUrl;
  base.instagramUrl = instagramUrl;

  if (facebookUrl) {
    const { email, phone } = await extractContactFromFacebookPage(facebookUrl);
    base.extractedEmail = email;
    base.extractedPhone = phone;
  }

  return base;
}

/**
 * Bulk version for a filtered leads list from the Google Maps table. Search
 * engines are far more sensitive to bursty traffic than a normal website
 * fetch, so this uses a smaller concurrency than the other bulk tools in
 * this app.
 * @param {Array<{businessName?: string, name?: string, city?: string, address?: string}>} leads
 * @param {number} concurrency
 * @returns {Promise<EnrichedContact[]>}
 */
export async function enrichSocialProfilesBulk(leads, concurrency = 3) {
  const queue = leads.map((lead, index) => ({ lead, index }));
  const results = new Array(leads.length);

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      const { lead, index } = item;

      const businessName = lead.businessName || lead.name || "";
      // Google Maps leads carry a full `address`, not a clean `city` field —
      // fall back to the address string itself as the search's location
      // term when no explicit city is given. Good enough for a search query.
      const city = lead.city || lead.address || "";

      const enriched = await enrichSocialProfile({ businessName, city });
      results[index] = { ...lead, ...enriched };

      // Small stagger between requests on top of the worker concurrency cap,
      // to stay polite to the search endpoint.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, leads.length) }, worker);
  await Promise.all(workers);

  return results;
}
