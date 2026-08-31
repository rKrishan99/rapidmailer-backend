import express from "express";
import extractEmailsFromWebsite, {
  enrichLeadsWithEmails,
} from "../controller/emailExtractorController.js";
import scrapeGoogleSearch from "../controller/scrapers/googleSearchScraper.js";

const router = express.Router();
const MAX_RESULTS = 100;

// POST (not GET): launches Puppeteer and scrapes Google as a side effect,
// so it needs the CORS preflight a JSON body gets rather than being
// triggerable by any web page the user has open via a simple GET.
router.post('/extract-emails', async (req, res) => {
  try {
      const { keyword, location, limit } = req.body || {};
      if (!keyword) {
          return res.status(400).json({ error: 'Keyword is required!' });
      }

      // Step 1: Scrape Google Search Results
      const parsedLimit = limit ? parseInt(limit, 10) : 10;
      const boundedLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_RESULTS) : 10;
      const businesses = await scrapeGoogleSearch(keyword, location, boundedLimit);

      // Step 2: Visit each website and extract emails
      for (const business of businesses) {
          business.emails = await extractEmailsFromWebsite(business.website);
      }

      res.json({ results: businesses });
  } catch (error) {
      if (error.message === 'SCRAPER_ENGINE_MISSING') {
        return res.status(503).json({
          error: "The scraping engine (Chromium) isn't installed. Reinstall the app, or run \"npm install\" in the backend folder to download it.",
        });
      }
      console.error('Error:', error.message);
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
      console.error('Bulk Email Enrichment Error:', error.message);
      res.status(500).json({ error: 'Failed to enrich leads with emails' });
  }
});

export default router;
