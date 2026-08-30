import express from "express";
import { auditWebsite, auditWebsiteBulk } from "../controller/websiteAuditController.js";

const router = express.Router();

const MAX_BULK_URLS = 15;

router.get("/audit-website", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const result = await auditWebsite(url);
    res.json({ result });
  } catch (error) {
    console.error("Website audit error:", error);
    res.status(500).json({ error: "Failed to audit website" });
  }
});

router.post("/audit-website-bulk", async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "urls array is required" });
    }
    if (urls.length > MAX_BULK_URLS) {
      return res.status(400).json({ error: `Maximum ${MAX_BULK_URLS} URLs per request` });
    }

    const results = await auditWebsiteBulk(urls);
    res.json({ results });
  } catch (error) {
    console.error("Bulk website audit error:", error);
    res.status(500).json({ error: "Failed to audit websites" });
  }
});

export default router;
