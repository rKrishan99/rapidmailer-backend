import express from "express";
import { scrapeGoogleMaps } from "../scrapers/googleMapScraper.js";

const router = express.Router();

const MAX_RESULTS = 100;

// POST (not GET): launches Puppeteer and scrapes Google as a side effect,
// so it needs the CORS preflight a JSON body gets rather than being
// triggerable by any web page the user has open via a simple GET.
router.post("/google-maps", async (req, res) => {
  try {
    const { query, location, limit } = req.body || {};

    if (!query || !location) {
      return res
        .status(400)
        .json({ error: "Query and location are required!" });
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const results = await scrapeGoogleMaps(
      query,
      location,
      Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_RESULTS) : 10
    );
    res.json({ results });

  } catch (error) {
    if (error.message === "SCRAPER_ENGINE_MISSING") {
      return res.status(503).json({
        error: "The scraping engine (Chromium) isn't installed. Reinstall the app, or run \"npm install\" in the backend folder to download it.",
      });
    }
    console.error("Scraping Error:", error.message);
    res.status(500).json({ error: "Failed to scrape Google Maps" });
  }
});

export default router;
                                                                                                                                                                                                                                                                                                                                                    