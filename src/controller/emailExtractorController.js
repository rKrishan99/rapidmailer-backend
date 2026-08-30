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

export default extractEmailsFromWebsite;
