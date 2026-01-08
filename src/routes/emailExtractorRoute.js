import express from "express";
import extractEmailsFromWebsite from "../controller/emailExtractorController.js";
import scrapeGoogleSearch from "../controller/scrapers/googleSearchScraper.js";

const router = express.Router();

router.get('/extract-emails', async (req, res) => {
  try {
      const { keyword, location, limit } = req.query;
      if (!keyword) {
          return res.status(400).json({ error: 'Keyword is required!' });
      }

      // Step 1: Scrape Google Search Results
      const businesses = await scrapeGoogleSearch(keyword, location, limit ? parseInt(limit) : 10);

      // Step 2: Visit each website and extract emails
      for (const business of businesses) {
          business.emails = await extractEmailsFromWebsite(business.website);
      }

      res.json({ results: businesses });
  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Failed to extract emails' });
  }
});

export default router;
