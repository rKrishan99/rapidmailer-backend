import axios from "axios";
import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return new URL(url);
}

// Each signature is tested against the fetched HTML (+ meta generator tag)
// and response headers. Order doesn't matter — every match is reported.
const SIGNATURES = [
  { name: "WordPress", test: ({ html }) => /wp-content|wp-includes/i.test(html) },
  {
    name: "Shopify",
    test: ({ html, headers }) => /cdn\.shopify\.com/i.test(html) || Boolean(headers["x-shopify-stage"]),
  },
  { name: "Wix", test: ({ html }) => /static\.wixstatic\.com|wix\.com/i.test(html) },
  { name: "Squarespace", test: ({ html }) => /squarespace\.com|static1\.squarespace\.com/i.test(html) },
  { name: "Webflow", test: ({ html }) => /webflow\.com|data-wf-site/i.test(html) },
  { name: "BigCommerce", test: ({ html }) => /cdn11\.bigcommerce\.com|bigcommerce\.com/i.test(html) },
  { name: "Next.js", test: ({ html }) => /__NEXT_DATA__|_next\/static/i.test(html) },
  { name: "Nuxt.js", test: ({ html }) => /__NUXT__|_nuxt\//i.test(html) },
  { name: "Gatsby", test: ({ html }) => /___gatsby|gatsby-image/i.test(html) },
  { name: "React", test: ({ html }) => /data-reactroot|react-dom/i.test(html) },
  { name: "Vue.js", test: ({ html }) => /data-v-app|__vue__|vue\.js/i.test(html) },
  { name: "Angular", test: ({ html }) => /ng-version|angular\.js/i.test(html) },
  { name: "jQuery", test: ({ html }) => /jquery(\.min)?\.js/i.test(html) },
  { name: "Bootstrap", test: ({ html }) => /bootstrap(\.min)?\.(css|js)/i.test(html) },
  { name: "Tailwind CSS", test: ({ html }) => /tailwind/i.test(html) },
  {
    name: "Drupal",
    test: ({ html, headers }) => /Drupal\.settings|sites\/default\/files/i.test(html) || /drupal/i.test(headers["x-generator"] || ""),
  },
  { name: "Joomla", test: ({ html }) => /\/media\/jui\/|Joomla!/i.test(html) },
  { name: "Magento", test: ({ html }) => /Mage\.Cookies|\/skin\/frontend\//i.test(html) },
  { name: "Google Analytics", test: ({ html }) => /gtag\(|google-analytics\.com/i.test(html) },
  { name: "Google Tag Manager", test: ({ html }) => /googletagmanager\.com\/gtm\.js/i.test(html) },
  {
    name: "Cloudflare",
    test: ({ headers }) => /cloudflare/i.test(headers["server"] || "") || Boolean(headers["cf-ray"]),
  },
  { name: "Font Awesome", test: ({ html }) => /font-?awesome/i.test(html) },
  { name: "PHP", test: ({ headers }) => /php/i.test(headers["x-powered-by"] || "") },
  {
    name: "ASP.NET",
    test: ({ headers }) => /asp\.net/i.test(headers["x-powered-by"] || "") || Boolean(headers["x-aspnet-version"]),
  },
];

export async function detectTechForUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);

  try {
    const response = await axios.get(url.toString(), {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: () => true,
      headers: { "User-Agent": USER_AGENT },
    });

    const headers = Object.fromEntries(
      Object.entries(response.headers || {}).map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value) ? value.join(", ") : String(value ?? ""),
      ])
    );
    const html = typeof response.data === "string" ? response.data : "";
    const generator = cheerio.load(html)('meta[name="generator"]').attr("content") || "";
    const context = { html: `${html} ${generator}`, headers };

    const technologies = SIGNATURES.filter((sig) => {
      try {
        return sig.test(context);
      } catch {
        return false;
      }
    }).map((sig) => ({ name: sig.name }));

    if (technologies.length === 0) technologies.push({ name: "Unknown / Custom" });

    return {
      url: url.toString(),
      technologies,
      server: headers["server"] || "N/A",
      poweredBy: headers["x-powered-by"] || "N/A",
    };
  } catch (error) {
    return {
      url: url.toString(),
      error: error.code === "ECONNABORTED" ? "Request timed out" : error.message || "Failed to fetch site",
    };
  }
}

export async function detectTechBulk(urls, concurrency = 4) {
  const results = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const current = cursor++;
      results[current] = await detectTechForUrl(urls[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}
