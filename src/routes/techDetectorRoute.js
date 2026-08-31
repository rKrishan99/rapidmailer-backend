import express from "express";
import { detectTechForUrl, detectTechBulk } from "../controller/techDetectorController.js";

const router = express.Router();

const MAX_BULK_URLS = 25;

// POST (not GET) even for a single URL: this triggers real network/scraping
// activity as a side effect, so it needs the CORS preflight a JSON POST body
// gets — a GET+query-string version would be triggerable by any web page
// the user has open (e.g. an <img> tag), since simple GETs bypass preflight.
router.post("/detect-tech", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const result = await detectTechForUrl(url);
    res.json({ result });
  } catch (error) {
    console.error("Tech detection error:", error.message);
    res.status(500).json({ error: "Failed to detect website technology" });
  }
});

router.post("/detect-tech-bulk", async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "urls array is required" });
    }
    if (urls.length > MAX_BULK_URLS) {
      return res.status(400).json({ error: `Maximum ${MAX_BULK_URLS} URLs per request` });
    }

    const results = await detectTechBulk(urls);
    res.json({ results });
  } catch (error) {
    console.error("Bulk tech detection error:", error.message);
    res.status(500).json({ error: "Failed to detect website technologies" });
  }
});

export default router;
