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

    // Lower cap than other bulk endpoints — this now searches 7 social
    // platforms per lead via DuckDuckGo, far more rate-limit sensitive than
    // a normal website fetch. Keep batches ≤ 50 and split larger lists.
    if (leads.length > 50) {
      return res.status(400).json({ error: "Max 50 leads per request. Split larger lists into multiple batches." });
    }

    const results = await enrichSocialProfilesBulk(leads);
    res.json({ results });
  } catch (error) {
    console.error("Bulk Social Enrichment Error:", error);
    res.status(500).json({ error: "Failed to enrich social profiles" });
  }
});

export default router;
