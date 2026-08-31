import express from "express";
import extractEmailsFromWebsite, {
  enrichLeadsWithEmails,
} from "../controller/emailExtractorController.js";
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

// Bulk email-finder for an EXISTING lead list (e.g. leads exported from
// Google Maps): POST /enrich-emails-bulk { leads: [{name, website, ...}] }
// Unlike /extract-emails, this does NOT run a fresh Google Search — it just
// visits each lead's own website and fills in an `email` column, passing
// every other field on the lead straight through untouched.
router.post('/enrich-emails-bulk', async (req, res) => {
  try {
      const { leads } = req.body;

      if (!leads || !Array.isArray(leads) || leads.length === 0) {
          return res.status(400).json({ error: 'leads (non-empty array) is required!' });
      }

      if (leads.length > 300) {
          return res.status(400).json({ error: 'Max 300 leads per request.' });
      }

      const results = await enrichLeadsWithEmails(leads);
      res.json({ results });
  } catch (error) {
      console.error('Bulk Email Enrichment Error:', error);
      res.status(500).json({ error: 'Failed to enrich leads with emails' });
  }
});

export default router;
