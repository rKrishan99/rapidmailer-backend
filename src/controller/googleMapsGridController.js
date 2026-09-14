// src/controller/googleMapsGridController.js
//
// High-Yield Google Maps Grid Scraper
// ------------------------------------
// Overcomes the ~120-result Google Maps ceiling by splitting the search into
// sub-queries (one per sub-locality or postal code), running them sequentially,
// and merging/deduplicating results into a single consolidated dataset.
//
// Progress is streamed to the caller via a `progressCallback` so the HTTP
// layer can forward it as Server-Sent Events (SSE) for real-time UI updates.

import { scrapeGoogleMaps } from "../scrapers/googleMapScraper.js";
import { isMissingBrowserError } from "../utils/browserRegistry.js";

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function normaliseName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalisePhone(s) {
  return String(s || "").replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * Generates a composite dedup key for a single lead.
 * Prefers phone (globally unique) over name (may collide for chains).
 * Falls back to name-only for leads without a phone.
 */
function dedupKey(lead) {
  const phone = normalisePhone(lead.phone || lead.Phone || "");
  const name = normaliseName(lead.name || lead.businessName || "");
  if (phone && phone.length >= 6) return `phone:${phone}`;
  if (name) return `name:${name}`;
  return `raw:${JSON.stringify(lead)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GridProgress
 * @property {'slot_start'|'slot_done'|'complete'|'error'} event
 * @property {number}  slotIndex   0-based index of the current slot
 * @property {number}  totalSlots
 * @property {string}  subLocation The sub-locality being scraped
 * @property {number}  slotFound   Results returned by this slot (slot_done only)
 * @property {number}  totalFound  Cumulative deduped total so far
 * @property {string}  [message]   Human-readable status line
 * @property {object}  [error]     Error details (error event only)
 */

/**
 * Run a sub-region grid scrape and return merged, deduplicated results.
 *
 * @param {object}   opts
 * @param {string}   opts.query            Primary keyword (e.g. "Plumbers")
 * @param {string[]} opts.subLocations     Array of sub-locality / postal code strings
 * @param {number}   [opts.maxPerSlot=120] Max results to request from each sub-query
 * @param {Function} [opts.progressCallback] Called with a GridProgress object after each slot
 * @returns {Promise<{results: object[], stats: object}>}
 */
export async function scrapeGrid({
  query,
  subLocations = [],
  maxPerSlot = 120,
  progressCallback = null,
}) {
  if (!query || !query.trim()) {
    throw Object.assign(new Error("query is required"), { code: "BAD_INPUT" });
  }
  if (!Array.isArray(subLocations) || subLocations.length === 0) {
    throw Object.assign(new Error("subLocations array must not be empty"), {
      code: "BAD_INPUT",
    });
  }

  const slots = subLocations
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (slots.length === 0) {
    throw Object.assign(new Error("No valid sub-locations provided"), {
      code: "BAD_INPUT",
    });
  }

  const cap = Math.min(Math.max(Number(maxPerSlot) || 120, 1), 120);
  const seen = new Map(); // dedupKey → merged lead object
  const slotStats = [];

  const emit = (payload) => {
    try {
      progressCallback?.(payload);
    } catch (_) {
      // never let a listener error abort the scrape
    }
  };

  for (let i = 0; i < slots.length; i++) {
    const subLocation = slots[i];

    emit({
      event: "slot_start",
      slotIndex: i,
      totalSlots: slots.length,
      subLocation,
      totalFound: seen.size,
      message: `Scraping slot ${i + 1}/${slots.length} — ${subLocation}…`,
    });

    let slotResults = [];
    let slotError = null;

    try {
      const raw = await scrapeGoogleMaps(query, subLocation, cap);
      // scrapeGoogleMaps returns an array or { error } on failure
      if (Array.isArray(raw)) {
        slotResults = raw;
      } else if (raw && typeof raw === "object" && raw.error) {
        slotError = raw.error;
      }
    } catch (err) {
      if (isMissingBrowserError?.(err) || err.message === "SCRAPER_ENGINE_MISSING") {
        // Fatal — propagate immediately
        throw err;
      }
      slotError = err.message || "Unknown scraping error";
    }

    // Merge into seen map
    let newCount = 0;
    for (const lead of slotResults) {
      const key = dedupKey(lead);
      if (!seen.has(key)) {
        seen.set(key, { ...lead, _sourceSlot: subLocation });
        newCount++;
      }
    }

    slotStats.push({
      subLocation,
      raw: slotResults.length,
      new: newCount,
      error: slotError,
    });

    emit({
      event: slotError ? "error" : "slot_done",
      slotIndex: i,
      totalSlots: slots.length,
      subLocation,
      slotFound: slotResults.length,
      slotNew: newCount,
      totalFound: seen.size,
      error: slotError ? { message: slotError } : undefined,
      message: slotError
        ? `Slot ${i + 1}/${slots.length} — ${subLocation}: error (${slotError}). Continuing…`
        : `Slot ${i + 1}/${slots.length} — ${subLocation}: ${slotResults.length} raw, ${newCount} new (${seen.size} total)`,
    });

    // Brief courtesy pause between slots to avoid hammering Google
    if (i < slots.length - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const results = Array.from(seen.values());

  const stats = {
    totalSlots: slots.length,
    totalRaw: slotStats.reduce((acc, s) => acc + s.raw, 0),
    totalDeduped: results.length,
    deduplicatedAway: slotStats.reduce((acc, s) => acc + s.raw, 0) - results.length,
    slotsWithErrors: slotStats.filter((s) => s.error).length,
    slotBreakdown: slotStats,
  };

  emit({
    event: "complete",
    slotIndex: slots.length - 1,
    totalSlots: slots.length,
    totalFound: results.length,
    stats,
    message: `Done — ${results.length} unique leads from ${slots.length} locations.`,
  });

  return { results, stats };
}
