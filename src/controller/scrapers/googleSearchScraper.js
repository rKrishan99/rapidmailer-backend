import puppeteer from "puppeteer";

async function scrapeGoogleSearch(keyword, location, maxResults = 10) {
    const browser = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    try {
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      const searchQuery = location ? `${keyword} in ${location}` : keyword;
      const url = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

      console.log(`🔍 Searching Google: ${searchQuery}`);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

      console.log("Waiting for h3 elements...");
      await page.waitForSelector("h3", { timeout: 60000 });

      const results = await page.evaluate(() => {
        const data = [];
        const items = document.querySelectorAll("div.MjjYud"); // Updated selector

        items.forEach((item) => {
          const titleElement = item.querySelector("h3");
          const linkElement = item.querySelector("a");
          const isSponsored =
            item.innerText.includes("Sponsored") || item.innerText.includes("My Ad Centre");

          if (titleElement && linkElement && !isSponsored) {
            data.push({
              name: titleElement.innerText.trim(),
              website: linkElement.href.trim(),
            });
          }
        });

        console.log("Founded website list:", data);

        return data;
      });

      return results.slice(0, maxResults);
    } finally {
      await browser.close();
    }
  }

export default scrapeGoogleSearch;