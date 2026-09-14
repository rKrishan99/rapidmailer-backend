// src/controller/whatsappWebLinksController.js
import axios from "axios";
import { getActiveSocket } from "./whatsappSessionManager.js";

const LINK_REGEX = /(?:https?:\/\/)?chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/gi;

/**
 * Scrapes target web pages to extract WhatsApp group invite links.
 *
 * @param {string[]} urls Array of webpage URLs
 * @param {object} [options]
 * @param {string} [options.accountId] Optional connected account to inspect group titles via Baileys
 * @returns {Promise<{links: object[], stats: object}>}
 */
export async function extractGroupLinksFromUrls(urls = [], options = {}) {
  const targetUrls = (Array.isArray(urls) ? urls : [urls])
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("http://") || u.startsWith("https://"));

  if (targetUrls.length === 0) {
    throw new Error("Provide at least one valid HTTP/HTTPS URL.");
  }

  const foundMap = new Map(); // code -> { code, inviteLink, sourceUrls: Set, subject, size }
  const errors = [];

  const sock = options.accountId ? getActiveSocket(options.accountId) : null;

  for (const url of targetUrls) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
      const matches = [...html.matchAll(LINK_REGEX)];

      for (const m of matches) {
        const code = m[1];
        const link = `https://chat.whatsapp.com/${code}`;

        if (!foundMap.has(code)) {
          foundMap.set(code, {
            code,
            inviteLink: link,
            sourceUrls: [url],
            subject: "WhatsApp Group",
            size: null,
            status: "extracted",
          });
        } else {
          const existing = foundMap.get(code);
          if (!existing.sourceUrls.includes(url)) {
            existing.sourceUrls.push(url);
          }
        }
      }
    } catch (err) {
      errors.push({ url, error: err.message || "Failed to fetch webpage" });
    }
  }

  const results = Array.from(foundMap.values());

  // If active socket is available, enrich with live invite details (subject, size)
  if (sock && results.length > 0) {
    for (const item of results.slice(0, 20)) { // limit inspection to first 20 to avoid rate limit
      try {
        const info = await sock.groupGetInviteInfo(item.code);
        if (info) {
          item.subject = info.subject || item.subject;
          item.size = info.size || null;
          item.status = "verified";
        }
      } catch (e) {
        // Invite might be revoked or rate limited
        if (e.message?.includes("404") || e.message?.includes("revoked")) {
          item.status = "expired_or_revoked";
        }
      }
    }
  }

  return {
    links: results,
    stats: {
      urlsScanned: targetUrls.length,
      linksFound: results.length,
      errorsCount: errors.length,
      errors,
    },
  };
}
