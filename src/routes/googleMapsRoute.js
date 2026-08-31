import express from "express";
import { scrapeGoogleMaps } from "../scrapers/googleMapScraper.js";

const router = express.Router();

// Google's own Maps UI stops adding new local-pack results somewhere
// around 100-120 per search, no matter how far you scroll — that's a
// ceiling Google enforces, not a RapidMailer limit. A single keyword +
// location search topping out here is expected, especially for a
// smaller city or a narrow keyword; it isn't a bug. To actually get a
// big bulk total, run more searches (more cities, more keyword
// variants) rather than expecting one search to return everything.
const MAX_RESULTS = 120;

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

    // No `limit` sent (the frontend doesn't expose one) now means "give me
    // everything Google will actually return for this search", i.e.
    // MAX_RESULTS, instead of the old token default of 10.
    const parsedLimit = limit ? parseInt(limit, 10) : MAX_RESULTS;
    const results = await scrapeGoogleMaps(
      query,
      location,
      Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_RESULTS) : MAX_RESULTS
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
                                                                                                                                                                                                                                                                                                                                                    