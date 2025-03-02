import express from "express";
import { scrapeGoogleMaps } from "../scrapers/googleMapScraper.js";

const router = express.Router();

router.get("/google-maps", async (req, res) => {
  try {
    const { query, location, limit } = req.query;

    if (!query || !location) {
      return res
        .status(400)
        .json({ error: "Query and location are required!" });
    }

    const results = await scrapeGoogleMaps(
      query,
      location,
      limit ? parseInt(limit) : 10
    );
    res.json({ results });
    
  } catch (error) {
    console.error("Scraping Error:", error);
    res.status(500).json({ error: "Failed to scrape Google Maps" });
  }
});

export default router;
