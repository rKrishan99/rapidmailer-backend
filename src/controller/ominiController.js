// src/controller/ominiController.js
import { handleOminiChat } from "../services/ominiAiService.js";
import { isFeatureAllowed } from "../config/licenseStore.js";
import { logger } from "../utils/loggerService.js";

/**
 * GET /api/omini/status
 */
export async function getOminiStatus(req, res) {
  try {
    const allowed = isFeatureAllowed("omini_copilot");
    res.json({
      success: true,
      allowed,
      feature: "omini_copilot",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to check Omini status" });
  }
}

/**
 * POST /api/omini/chat
 * Body: { messages: [{ role: 'user'|'assistant', content: string }], currentRoute: string }
 */
export async function postOminiChat(req, res) {
  try {
    // 1. License Entitlement Enforcement
    const allowed = isFeatureAllowed("omini_copilot");
    if (!allowed) {
      return res.status(403).json({
        success: false,
        locked: true,
        error: "Omini AI Copilot is an exclusive feature for Pro & Omni Suite licenses.",
      });
    }

    const { messages = [], currentRoute = "" } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array cannot be empty" });
    }

    const reply = await handleOminiChat({ messages, currentRoute });
    res.json({
      success: true,
      reply,
    });
  } catch (err) {
    logger.error("OMINI_CHAT", `Chat turn failed: ${err.message}`);
    res.status(500).json({ error: "Omini copilot encountered an error processing your query" });
  }
}
