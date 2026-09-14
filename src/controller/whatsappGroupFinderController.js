// src/controller/whatsappGroupFinderController.js
import axios from "axios";
import * as cheerio from "cheerio";

const LINK_REGEX = /(?:https?:\/\/)?chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/gi;

/**
 * Discovers niche-specific public WhatsApp groups via search dorks.
 *
 * @param {object} params
 * @param {string} params.keyword
 * @param {string} [params.country]
 * @param {number} [params.maxResults=40]
 * @returns {Promise<{groups: object[], stats: object}>}
 */
export async function findPublicGroups({ keyword, country, maxResults = 40 }) {
  if (!keyword || !keyword.trim()) {
    throw new Error("Keyword is required to search for public WhatsApp groups.");
  }

  const queryParts = ["site:chat.whatsapp.com", `"${keyword.trim()}"`];
  if (country && country.trim()) {
    queryParts.push(`"${country.trim()}"`);
  }
  const searchQuery = queryParts.join(" ");

  const foundMap = new Map(); // code -> { code, inviteLink, title, snippet }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const $ = cheerio.load(res.data);

    // Parse DuckDuckGo standard HTML search result blocks
    $(".result").each((_, el) => {
      const titleEl = $(el).find(".result__title");
      const snippetEl = $(el).find(".result__snippet");
      const snippetText = snippetEl.text() || "";
      const rawTitle = titleEl.text().trim();
      const rawHtml = $(el).html() || "";

      const matches = [...rawHtml.matchAll(LINK_REGEX)];
      for (const m of matches) {
        const code = m[1];
        if (!foundMap.has(code)) {
          // Clean title (remove "WhatsApp Group Invite" suffix if present)
          const cleanTitle = rawTitle.replace(/WhatsApp Group Invite/gi, "").trim() || `${keyword} Group`;
          foundMap.set(code, {
            code,
            inviteLink: `https://chat.whatsapp.com/${code}`,
            title: cleanTitle,
            snippet: snippetText.trim(),
            keyword,
          });
        }
      }
    });
  } catch (err) {
    console.warn("Search engine dork query warning:", err.message);
  }

  const groups = Array.from(foundMap.values()).slice(0, Number(maxResults) || 40);

  return {
    groups,
    stats: {
      keyword,
      country: country || null,
      totalFound: groups.length,
    },
  };
}
