import axios from "axios";
import * as cheerio from "cheerio";

// Social Profile & Contact Enricher
// ----------------------------------
// For leads with no website (Google Maps "No Website" exports), most local
// businesses still run at least one social profile. This module finds those
// profiles via DuckDuckGo's free no-JS HTML endpoint — no API key, no billing
// — and extracts a public email/phone from any page it can read.
//
// Platforms searched: Facebook · Instagram · LinkedIn · Twitter/X ·
//   YouTube · TikTok · Google Business · WhatsApp Business (extracted from
//   page HTML rather than a separate search).

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Junk-path filters — results that look like the right domain but are login
// walls, help articles, advertising dashboards, etc.
// ---------------------------------------------------------------------------
const JUNK_PATHS = {
  facebook: /^\/(login|sharer|help|policies|policy|plugins|tr|l\.php|groups\/[^/]+\/(permalink|posts)|watch|marketplace|events|ads|business\/help|share|dialog|media)/i,
  instagram: /^\/(p|reel|reels|explore|accounts|stories|direct|about|legal|developer|tv)\//i,
  linkedin: /^\/(login|signup|jobs|learning|company\/login|authwall|checkpoint|uas|comm)\//i,
  twitter: /^\/(i\/|hashtag\/|explore|search|home|notifications|messages|settings|intent\/|share\?)/i,
  youtube: /^\/(watch|shorts|playlist|results|feed|c\/|channel\/(?!.{3}))/i, // allow /channel/<id> if id ≥ 3 chars
  tiktok: /^\/(login|signup|foryou|discover|upload|live|messages|tag\/|trending)/i,
  googlebusiness: /^\/(search|maps|accounts|business\/manage|signin)/i,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** DuckDuckGo wraps result URLs in a redirect. Unwrap to the real target. */
function unwrapDDGLink(href) {
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

/** Strip tracking query params from a social profile URL. */
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

/** Sleep for `ms` milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run DuckDuckGo HTML search, return ordered list of result URLs.
 * Retries up to `maxRetries` times on 429 / 503 with exponential backoff.
 */
async function searchDDG(query, maxRetries = 2) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get("https://html.duckduckgo.com/html/", {
        params: { q: query },
        timeout: 15000,
        maxContentLength: 5 * 1024 * 1024,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
        validateStatus: () => true,
      });

      if (response.status === 429 || response.status === 503) {
        if (attempt < maxRetries) {
          await sleep(delay);
          delay *= 2;
          continue;
        }
        return [];
      }

      if (typeof response.data !== "string") return [];

      const $ = cheerio.load(response.data);
      const urls = [];
      $("a.result__a, a.result__url").each((_, el) => {
        const real = unwrapDDGLink($(el).attr("href"));
        if (real) urls.push(real);
      });
      return urls;
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      console.warn(`⚠️ DDG search failed (attempt ${attempt + 1}):`, err.message);
      return [];
    }
  }
  return [];
}

/**
 * Generic platform search — queries DDG, validates each result URL against the
 * expected hostname pattern and junk-path filter, returns the first clean match.
 *
 * @param {string} query           DDG query string
 * @param {RegExp} hostnamePattern Regex that the result URL's hostname must match
 * @param {RegExp} [junkPaths]     Regex of paths to skip (login walls, etc.)
 * @param {number} [minPathLen=2]  Minimum characters after leading slash
 */
async function searchPlatform(query, hostnamePattern, junkPaths, minPathLen = 2) {
  try {
    const urls = await searchDDG(query);
    for (const rawUrl of urls) {
      let parsed;
      try { parsed = new URL(rawUrl); } catch { continue; }
      if (!hostnamePattern.test(parsed.hostname)) continue;
      const path = parsed.pathname.replace(/\/+$/, "");
      if (path.length < minPathLen) continue;
      if (junkPaths && junkPaths.test(path)) continue;
      return cleanProfileUrl(rawUrl);
    }
    return null;
  } catch (err) {
    console.error(`⚠️ Platform search failed [${query.slice(0, 60)}]:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-platform search functions
// ---------------------------------------------------------------------------

function searchFacebook(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" site:facebook.com`
    : `"${name}" site:facebook.com`;
  return searchPlatform(q, /(^|\.)facebook\.com$/i, JUNK_PATHS.facebook);
}

function searchInstagram(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" site:instagram.com`
    : `"${name}" site:instagram.com`;
  return searchPlatform(q, /(^|\.)instagram\.com$/i, JUNK_PATHS.instagram);
}

function searchLinkedIn(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" site:linkedin.com/company`
    : `"${name}" site:linkedin.com/company`;
  return searchPlatform(q, /(^|\.)linkedin\.com$/i, JUNK_PATHS.linkedin);
}

function searchTwitter(name, loc) {
  // Search both twitter.com and x.com; DuckDuckGo indexes both.
  const q = loc
    ? `"${name}" "${loc}" (site:twitter.com OR site:x.com)`
    : `"${name}" (site:twitter.com OR site:x.com)`;
  return searchPlatform(q, /(^|\.)(?:twitter|x)\.com$/i, JUNK_PATHS.twitter);
}

function searchYouTube(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" (site:youtube.com/channel OR site:youtube.com/@)`
    : `"${name}" (site:youtube.com/channel OR site:youtube.com/@)`;
  return searchPlatform(q, /(^|\.)youtube\.com$/i, JUNK_PATHS.youtube);
}

function searchTikTok(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" site:tiktok.com/@`
    : `"${name}" site:tiktok.com/@`;
  return searchPlatform(q, /(^|\.)tiktok\.com$/i, JUNK_PATHS.tiktok);
}

function searchGoogleBusiness(name, loc) {
  const q = loc
    ? `"${name}" "${loc}" (site:g.page OR site:business.google.com)`
    : `"${name}" (site:g.page OR site:business.google.com)`;
  return searchPlatform(
    q,
    /(^|\.)(?:g\.page|business\.google\.com)$/i,
    JUNK_PATHS.googlebusiness
  );
}

// ---------------------------------------------------------------------------
// Contact & WhatsApp extraction from a discovered social page
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?[\d]{1,3}[\s.\-()]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{3,4}(?:[\s.\-]?\d{2,4})?/g;
// wa.me/+1234567890 or api.whatsapp.com/send?phone=1234567890
const WHATSAPP_REGEX = /(?:wa\.me|api\.whatsapp\.com\/send\?phone=)[\/?+]*([\d]{7,15})/gi;

/** Fetch a URL's HTML. Returns empty string on any error. */
async function fetchHtml(url) {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      maxContentLength: 5 * 1024 * 1024,
      headers: { "User-Agent": USER_AGENT },
      validateStatus: () => true,
    });
    return typeof res.data === "string" ? res.data : "";
  } catch {
    return "";
  }
}

/**
 * Try to extract email, phone and WhatsApp Business link from a page.
 * Tries URLs in order until it gets at least an email or phone.
 * @param {string[]} urlsToTry  Ordered list of page URLs to attempt
 * @param {string[]} [skipDomains] Domains known to block scrapers (skip early)
 */
async function extractContactFromPages(urlsToTry, skipDomains = []) {
  for (const url of urlsToTry) {
    if (!url) continue;
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (skipDomains.some((d) => domain.includes(d))) continue;
    } catch {
      continue;
    }

    const html = await fetchHtml(url);
    if (!html) continue;

    // Email — scan raw HTML (scripts/meta sometimes contain mailto: links)
    const emailMatches = html.match(EMAIL_REGEX) || [];
    const validEmail =
      emailMatches.find(
        (e) =>
          !/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|css|js)$/i.test(e) &&
          !/(?:facebook|instagram|linkedin|twitter|youtube|tiktok|sentry|google|apple|microsoft)\.com$/i.test(e) &&
          e.length < 80
      ) || null;

    // Phone — scan text content only to avoid numeric noise in HTML attributes
    const $ = cheerio.load(html);
    const textOnly = $("body").text();
    const phoneMatches = textOnly.match(PHONE_REGEX) || [];
    const validPhone =
      phoneMatches.find((p) => {
        const digits = p.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 15;
      }) || null;

    // WhatsApp Business link — scan raw HTML for wa.me links
    let whatsappBusinessUrl = null;
    let waMatch;
    WHATSAPP_REGEX.lastIndex = 0;
    while ((waMatch = WHATSAPP_REGEX.exec(html)) !== null) {
      const digits = waMatch[1].replace(/\D/g, "");
      if (digits.length >= 7) {
        whatsappBusinessUrl = `https://wa.me/${digits}`;
        break;
      }
    }

    if (validEmail || validPhone || whatsappBusinessUrl) {
      return {
        email: validEmail,
        phone: validPhone ? validPhone.trim() : null,
        whatsappBusinessUrl,
      };
    }
  }

  return { email: null, phone: null, whatsappBusinessUrl: null };
}

// ---------------------------------------------------------------------------
// Sanity guard — skip hopeless queries
// ---------------------------------------------------------------------------

/**
 * Returns false if the business name is too generic to search reliably.
 * E.g. empty, less than 3 chars, or pure numbers.
 */
function isNameSearchable(name) {
  if (!name || name.trim().length < 3) return false;
  const letters = (name.match(/[a-zA-Z\u00C0-\u024F]/g) || []).length;
  return letters >= 2;
}

// ---------------------------------------------------------------------------
// Per-lead 30-second hard timeout guard
// ---------------------------------------------------------------------------
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EnrichedContact
 * @property {string}      businessName
 * @property {string}      city
 * @property {string|null} facebookUrl
 * @property {string|null} instagramUrl
 * @property {string|null} linkedinUrl
 * @property {string|null} twitterUrl
 * @property {string|null} youtubeUrl
 * @property {string|null} tiktokUrl
 * @property {string|null} googleBusinessUrl
 * @property {string|null} whatsappBusinessUrl
 * @property {string|null} extractedEmail
 * @property {string|null} extractedPhone
 */

/**
 * Locate a business's social profiles across 8 platforms and extract a public
 * email/phone where possible. Hard-capped at 30 s per lead.
 *
 * @param {{ businessName: string, city?: string, website?: string }} input
 * @returns {Promise<EnrichedContact>}
 */
export async function enrichSocialProfile({ businessName, city, website } = {}) {
  const name = (businessName || "").trim();
  const location = (city || "").trim();

  /** @type {EnrichedContact} */
  const base = {
    businessName: name,
    city: location,
    facebookUrl: null,
    instagramUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    youtubeUrl: null,
    tiktokUrl: null,
    googleBusinessUrl: null,
    whatsappBusinessUrl: null,
    extractedEmail: null,
    extractedPhone: null,
  };

  if (!isNameSearchable(name)) return base;

  const enrichTask = async () => {
    // Run all 7 social platform searches concurrently (one DDG request each).
    const [
      facebookUrl,
      instagramUrl,
      linkedinUrl,
      twitterUrl,
      youtubeUrl,
      tiktokUrl,
      googleBusinessUrl,
    ] = await Promise.all([
      searchFacebook(name, location),
      searchInstagram(name, location),
      searchLinkedIn(name, location),
      searchTwitter(name, location),
      searchYouTube(name, location),
      searchTikTok(name, location),
      searchGoogleBusiness(name, location),
    ]);

    base.facebookUrl = facebookUrl;
    base.instagramUrl = instagramUrl;
    base.linkedinUrl = linkedinUrl;
    base.twitterUrl = twitterUrl;
    base.youtubeUrl = youtubeUrl;
    base.tiktokUrl = tiktokUrl;
    base.googleBusinessUrl = googleBusinessUrl;

    // Contact extraction: try discovered pages in order of likelihood of
    // having public contact info. Facebook blocks scrapers most aggressively
    // so it goes last; Google Business and website go first.
    // WhatsApp Business link may also be found embedded in any page.
    const pagesToScan = [
      googleBusinessUrl,
      website || null,   // if the lead row has a website despite being "no website" (edge case)
      facebookUrl,
      instagramUrl,
    ].filter(Boolean);

    // Domains that reliably block scraping and should be skipped early
    const alwaysBlockedDomains = ["facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "twitter.com", "x.com", "youtube.com"];

    // Only skip known blocked domains for email/phone; WhatsApp links can
    // appear on any page including blocked ones — we still try to scrape
    // them for wa.me URLs since that's in the public HTML source.
    const { email, phone, whatsappBusinessUrl } = await extractContactFromPages(
      pagesToScan,
      [] // don't skip any domain — let the fetch timeout handle it
    );

    base.extractedEmail = email;
    base.extractedPhone = phone;
    if (whatsappBusinessUrl) base.whatsappBusinessUrl = whatsappBusinessUrl;

    return base;
  };

  return withTimeout(enrichTask(), 30_000, base);
}

/**
 * Bulk enrichment for a list of leads. Concurrency-capped (default 3) and
 * staggered with a short delay between items to stay polite to DDG.
 *
 * @param {Array<{businessName?: string, name?: string, city?: string, address?: string, website?: string}>} leads
 * @param {number} [concurrency=3]
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

      const businessName = (lead.businessName || lead.name || "").trim();
      const city = (lead.city || lead.address || "").trim();
      const website = lead.website || lead.url || "";

      try {
        const enriched = await enrichSocialProfile({ businessName, city, website });
        results[index] = { ...lead, ...enriched };
      } catch (err) {
        console.error(`⚠️ Enrichment failed for "${businessName}":`, err.message);
        results[index] = { ...lead };
      }

      // Stagger requests to stay polite to the search endpoint.
      await sleep(400);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, leads.length) }, worker);
  await Promise.all(workers);

  return results;
}
