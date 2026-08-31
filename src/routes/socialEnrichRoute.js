import express from "express";
import { enrichSocialProfile, enrichSocialProfilesBulk } from "../controller/socialEnricher.js";

const router = express.Router();

// Single lookup: POST /api/enrich/social { businessName, city }
router.post("/enrich/social", async (req, res) => {
  try {
    const { businessName, city } = req.body;

    if (!businessName) {
      return res.status(400).json({ error: "businessName is required!" });
    }

    const result = await enrichSocialProfile({ businessName, city: city || "" });
    res.json({ result });
  } catch (error) {
    console.error("Social Enrichment Error:", error);
    res.status(500).json({ error: "Failed to enrich social profile" });
  }
});

// Bulk lookup for the Social Enricher tool's CSV upload:
// POST /api/enrich/social-bulk { leads: [{name, address, ...}] }
router.post("/enrich/social-bulk", async (req, res) => {
  try {
    const { leads } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: "leads (non-empty array) is required!" });
    }

    // Lower cap than other bulk endpoints — this hits a search engine per
    // lead (x2, for Facebook + Instagram), which is far more rate-limit
    // sensitive than fetching a lead's own website.
    if (leads.length > 100) {
      return res.status(400).json({ error: "Max 100 leads per request." });
    }

    const results = await enrichSocialProfilesBulk(leads);
    res.json({ results });
  } catch (error) {
    console.error("Bulk Social Enrichment Error:", error);
    res.status(500).json({ error: "Failed to enrich social profiles" });
  }
});

export default router;
