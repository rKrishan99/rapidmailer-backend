import axios from "axios";
import * as cheerio from "cheerio";
import https from "node:https";
import { getSettings } from "../config/settingsStore.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

const SECURITY_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "content-security-policy",
  "referrer-policy",
];

const EXPOSED_PATHS = [".env", ".git/config", "wp-config.php.bak", "backup.zip", ".DS_Store"];

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return new URL(url);
}

function headerNameLabel(key) {
  return key.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("-");
}

function checkSsl(url) {
  if (url.protocol !== "https:") {
    return Promise.resolve({ valid: false, error: "Site is not served over HTTPS" });
  }

  return new Promise((resolve) => {
    const req = https.request(
      {
        host: url.hostname,
        port: url.port || 443,
        method: "HEAD",
        path: "/",
        timeout: 10000,
        rejectUnauthorized: true,
      },
      (res) => {
        resolve({ valid: true });
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ valid: false, error: "SSL check timed out" });
    });
    req.on("error", (err) => resolve({ valid: false, error: err.message }));
    req.end();
  });
}

// Flags a path as "exposed" only if it 200s with content that differs from
// the homepage — avoids false positives on SPAs that 200 every route.
async function checkExposedFiles(url, homepageHtml) {
  const found = [];
  await Promise.all(
    EXPOSED_PATHS.map(async (path) => {
      try {
        const target = new URL(path, url.origin).toString();
        const res = await axios.get(target, {
          timeout: 8000,
          maxRedirects: 0,
          maxContentLength: 5 * 1024 * 1024,
          validateStatus: () => true,
          headers: { "User-Agent": USER_AGENT },
        });
        const body = typeof res.data === "string" ? res.data : "";
        if (res.status === 200 && body && body !== homepageHtml) found.push(path);
      } catch {
        // network error / non-2xx — treated as not exposed
      }
    })
  );
  return found;
}

async function checkTextResourceExists(url, path) {
  try {
    const target = new URL(path, url.origin).toString();
    const res = await axios.get(target, {
      timeout: 8000,
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: () => true,
      headers: { "User-Agent": USER_AGENT },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

let latestWpVersionCache = null;
async function getLatestWordpressVersion() {
  if (latestWpVersionCache) return latestWpVersionCache;
  try {
    const res = await axios.get("https://api.wordpress.org/core/version-check/1.7/", { timeout: 8000 });
    const latest = res.data?.offers?.[0]?.version || null;
    latestWpVersionCache = latest;
    return latest;
  } catch {
    return null;
  }
}

async function detectWordpress($, html, url) {
  const generator = $('meta[name="generator"]').attr("content") || "";
  const isWordpress = /wp-content|wp-includes/i.test(html) || /wordpress/i.test(generator);
  if (!isWordpress) return null;

  let detectedVersion = (generator.match(/WordPress\s([\d.]+)/i) || [])[1] || null;

  if (!detectedVersion) {
    try {
      const readme = await axios.get(new URL("readme.html", url.origin).toString(), {
        timeout: 8000,
        validateStatus: () => true,
        headers: { "User-Agent": USER_AGENT },
      });
      if (readme.status === 200 && typeof readme.data === "string") {
        detectedVersion = (readme.data.match(/Version\s([\d.]+)/i) || [])[1] || null;
      }
    } catch {
      // ignore — version stays unknown
    }
  }

  const latestVersion = await getLatestWordpressVersion();
  const outdated =
    Boolean(detectedVersion) && Boolean(latestVersion) && compareVersions(detectedVersion, latestVersion) < 0;

  return { detectedVersion: detectedVersion || "unknown", latestVersion, outdated };
}

function buildSeo($, hasRobotsTxt, hasSitemapXml) {
  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || "";

  return {
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    hasViewport: $('meta[name="viewport"]').length > 0,
    hasCanonical: $('link[rel="canonical"]').length > 0,
    hasOpenGraph: $('meta[property^="og:"]').length > 0,
    hasRobotsTxt,
    hasSitemapXml,
  };
}

async function getPerformance(url) {
  try {
    const apiKey = getSettings().integrations.googlePageSpeedApiKey;
    const query = new URLSearchParams();
    query.append("url", url.toString());
    query.append("strategy", "mobile");
    ["performance", "seo", "best-practices", "accessibility"].forEach((c) => query.append("category", c));
    if (apiKey) query.append("key", apiKey);

    const response = await axios.get(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query.toString()}`,
      { timeout: 45000 }
    );

    const lighthouse = response.data?.lighthouseResult;
    const categories = lighthouse?.categories || {};
    const audits = lighthouse?.audits || {};
    const scoreOf = (cat) => (typeof categories[cat]?.score === "number" ? Math.round(categories[cat].score * 100) : null);

    return {
      performanceScore: scoreOf("performance"),
      seoScore: scoreOf("seo"),
      bestPracticesScore: scoreOf("best-practices"),
      accessibilityScore: scoreOf("accessibility"),
      largestContentfulPaint: audits["largest-contentful-paint"]?.displayValue || null,
      cumulativeLayoutShift: audits["cumulative-layout-shift"]?.displayValue || null,
      totalBlockingTime: audits["total-blocking-time"]?.displayValue || null,
    };
  } catch (error) {
    return {
      error: error.response?.data?.error?.message || "PageSpeed check unavailable (rate limited or unreachable)",
    };
  }
}

function buildOutreachSummary({ url, performance, security, seo }) {
  const points = [];

  if (!performance.error && typeof performance.performanceScore === "number") {
    if (performance.performanceScore < 50) points.push(`page speed is slow (${performance.performanceScore}/100)`);
    else if (performance.performanceScore < 90)
      points.push(`page speed has room to improve (${performance.performanceScore}/100)`);
  }

  if (security.ssl.valid === false) points.push("SSL/HTTPS isn't set up correctly");
  if (security.missingHeaders.length)
    points.push(`missing ${security.missingHeaders.length} security header${security.missingHeaders.length > 1 ? "s" : ""}`);
  if (security.exposedFiles.length) points.push(`has exposed sensitive files (${security.exposedFiles.join(", ")})`);
  if (security.wordpress?.outdated) points.push(`is running an outdated WordPress (v${security.wordpress.detectedVersion})`);

  if (!seo.metaDescription) points.push("has no meta description");
  if (!seo.hasViewport) points.push("isn't mobile-optimized (no viewport tag)");
  if (!seo.hasSitemapXml) points.push("has no sitemap.xml");

  if (points.length === 0) {
    return `${url} looks solid — no major performance, security or SEO issues found.`;
  }

  return `${url} ${points.slice(0, 4).join(", ")}.`;
}

export async function auditWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);

  let html = "";
  let $;
  let headers = {};

  try {
    const response = await axios.get(url.toString(), {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: () => true,
      headers: { "User-Agent": USER_AGENT },
    });

    html = typeof response.data === "string" ? response.data : "";
    $ = cheerio.load(html);
    headers = Object.fromEntries(
      Object.entries(response.headers || {}).map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value) ? value.join(", ") : String(value ?? ""),
      ])
    );
  } catch (error) {
    return {
      url: url.toString(),
      error: error.code === "ECONNABORTED" ? "Request timed out" : error.message || "Failed to reach site",
    };
  }

  const [ssl, exposedFiles, hasRobotsTxt, hasSitemapXml, performance, wordpress] = await Promise.all([
    checkSsl(url),
    checkExposedFiles(url, html),
    checkTextResourceExists(url, "robots.txt"),
    checkTextResourceExists(url, "sitemap.xml"),
    getPerformance(url),
    detectWordpress($, html, url),
  ]);

  const missingHeaders = SECURITY_HEADERS.filter((h) => !headers[h]).map(headerNameLabel);
  const seo = buildSeo($, hasRobotsTxt, hasSitemapXml);
  const security = { ssl, missingHeaders, exposedFiles, wordpress };
  const outreachSummary = buildOutreachSummary({ url: url.toString(), performance, security, seo });

  return {
    url: url.toString(),
    performance,
    security,
    seo,
    outreachSummary,
  };
}

export async function auditWebsiteBulk(urls, concurrency = 2) {
  const results = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const current = cursor++;
      results[current] = await auditWebsite(urls[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}
