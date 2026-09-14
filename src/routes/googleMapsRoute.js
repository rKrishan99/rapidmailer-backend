import express from "express";
import { scrapeGoogleMaps } from "../scrapers/googleMapScraper.js";
import { scrapeGrid } from "../controller/googleMapsGridController.js";

const router = express.Router();

// Google's own Maps UI stops adding new local-pack results somewhere
// around 100-120 per search, no matter how far you scroll — that's a
// ceiling Google enforces, not a RapidMailer limit. A single keyword +
// location search topping out here is expected, especially for a
// smaller city or a narrow keyword; it isn't a bug. To get a big bulk
// total, run more searches (more cities / keyword variants), or use the
// Grid endpoint below.
const MAX_RESULTS = 120;

// ---------------------------------------------------------------------------
// Single-location search (original endpoint — unchanged)
// ---------------------------------------------------------------------------
// POST /api/google-maps  { query, location, limit? }
// ---------------------------------------------------------------------------
router.post("/google-maps", async (req, res) => {
  try {
    const { query, location, limit } = req.body || {};

    if (!query || !location) {
      return res
        .status(400)
        .json({ error: "Query and location are required!" });
    }

    const parsedLimit = limit ? parseInt(limit, 10) : MAX_RESULTS;
    const results = await scrapeGoogleMaps(
      query,
      location,
      Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), MAX_RESULTS)
        : MAX_RESULTS
    );
    res.json({ results });
  } catch (error) {
    if (error.message === "SCRAPER_ENGINE_MISSING") {
      return res.status(503).json({
        error:
          "The scraping engine (Chromium) isn't installed. Reinstall the app, or run \"npm install\" in the backend folder to download it.",
      });
    }
    console.error("Scraping Error:", error.message);
    res.status(500).json({ error: "Failed to scrape Google Maps" });
  }
});

// ---------------------------------------------------------------------------
// Grid Scraper — Server-Sent Events streaming endpoint
// ---------------------------------------------------------------------------
// POST /api/google-maps-grid
//   body: { query, subLocations: string[] | string, maxPerSlot?: number }
//
// Streams progress via SSE (text/event-stream). Each line is:
//   data: <JSON>\n\n
//
// Event shapes (see GridProgress typedef in googleMapsGridController.js):
//   slot_start  — a slot is beginning
//   slot_done   — a slot finished, slotFound + totalFound updated
//   error       — a slot failed (non-fatal; scrape continues)
//   complete    — all slots done, stats included
//   results     — the full merged results array (final event)
//   fatal       — unrecoverable error (Chromium missing, etc.)
// ---------------------------------------------------------------------------
router.post("/google-maps-grid", async (req, res) => {
  const { query, subLocations, maxPerSlot } = req.body || {};

  if (!query || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const slots = Array.isArray(subLocations)
    ? subLocations.map((s) => String(s).trim()).filter(Boolean)
    : typeof subLocations === "string"
    ? subLocations
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (slots.length === 0) {
    return res.status(400).json({
      error: "subLocations must be a non-empty array or comma-separated string",
    });
  }

  if (slots.length > 30) {
    return res
      .status(400)
      .json({ error: "Maximum 30 sub-locations per grid run." });
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if proxied
  res.flushHeaders();

  const sendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch (_) {
      // client disconnected — ignore
    }
  };

  try {
    const { results, stats } = await scrapeGrid({
      query: query.trim(),
      subLocations: slots,
      maxPerSlot: maxPerSlot ? Number(maxPerSlot) : MAX_RESULTS,
      progressCallback: sendEvent,
    });

    // Send the full results array as the last event
    sendEvent({ event: "results", results, stats });
  } catch (err) {
    const isMissing = err.message === "SCRAPER_ENGINE_MISSING";
    sendEvent({
      event: "fatal",
      message: isMissing
        ? "Scraping engine (Chromium) not installed. Run 'npm install' in the backend folder."
        : err.message || "Unexpected scraping error",
    });
  } finally {
    res.end();
  }
});

export default router;