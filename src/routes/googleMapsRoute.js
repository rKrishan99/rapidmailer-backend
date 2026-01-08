import express from "express";
import { scrapeGoogleMaps } from "../controller/googleMapController.js";

const router = express.Router();

router.get("/google-maps", async (req, res) => {
  try {
    const { keyword, location, limit } = req.query;

    console.log(keyword, location, limit);

    if (!keyword || !location) {
      return res
        .status(400)
        .json({ error: "Query and location are required!" });
    }

    const results = await scrapeGoogleMaps(
      keyword,
      location,
      limit ? parseInt(limit) : 100 // Increased default from 10 to 100
    );
    res.json({ results });
  } catch (error) {
    console.error("Scraping Error:", error);
    res.status(500).json({ error: "Failed to scrape Google Maps" });
  }
});

export default router;
