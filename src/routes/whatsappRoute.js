import express from "express";
import { getPublicSettings, updateSettings } from "../config/settingsStore.js";
import { testWhatsappConnection, sendBulkWhatsapp } from "../controller/whatsappController.js";

const router = express.Router();

const MAX_BULK_RECIPIENTS = 300;

// Connection status for the shared sidebar "Connect WhatsApp" control.
router.get("/whatsapp/status", (req, res) => {
  res.json({ whatsapp: getPublicSettings().whatsapp });
});

// Save credentials (access token, phone number id, WABA id). Mirrors the
// existing PUT /settings pattern rather than reusing it directly, so the
// WhatsApp connect page doesn't need to know about SMTP/other settings.
router.put("/whatsapp/credentials", (req, res) => {
  try {
    const { accessToken, phoneNumberId, wabaId, apiVersion } = req.body || {};
    const settings = updateSettings({
      whatsapp: { accessToken, phoneNumberId, wabaId, apiVersion },
    });
    res.json({ whatsapp: settings.whatsapp, message: "WhatsApp credentials saved" });
  } catch (error) {
    console.error("Failed to save WhatsApp credentials:", error);
    res.status(500).json({ error: "Failed to save WhatsApp credentials" });
  }
});

// Verifies the saved (or a not-yet-saved draft) connection against the real
// Graph API, so the UI can show "Connected as <business name>" before the
// user relies on it for a bulk send.
router.post("/whatsapp/test-connection", async (req, res) => {
  try {
    const result = await testWhatsappConnection(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      message: `Connected to WhatsApp as "${result.verifiedName}" (${result.displayPhoneNumber})`,
      verifiedName: result.verifiedName,
      displayPhoneNumber: result.displayPhoneNumber,
    });
  } catch (error) {
    console.error("WhatsApp connection test failed:", error);
    res.status(500).json({ error: "Failed to test the WhatsApp connection" });
  }
});

// Bulk send for the WhatsApp Bulk Sender tool. `recipients` must already
// carry a resolved `phone` field per row (the frontend does flexible
// column-name detection before calling this). `message` picks template vs
// text mode; `settings.batchSize`/`settings.delayMs` control send pacing.
router.post("/whatsapp/send-bulk", async (req, res) => {
  try {
    const { recipients, message, settings } = req.body || {};

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "recipients (non-empty array) is required" });
    }
    if (recipients.length > MAX_BULK_RECIPIENTS) {
      return res.status(400).json({ error: `Max ${MAX_BULK_RECIPIENTS} recipients per request.` });
    }
    if (!message || (message.mode === "template" && !message.templateName)) {
      return res
        .status(400)
        .json({ error: "A template name is required (create/approve it in Meta Business Manager first)." });
    }
    if (message.mode === "text" && !message.text) {
      return res.status(400).json({ error: "text is required for text mode" });
    }

    const results = await sendBulkWhatsapp(recipients, message, settings || {});

    res.status(200).json({
      message: "WhatsApp bulk send completed",
      results,
      stats: {
        total: results.length,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
    });
  } catch (error) {
    if (error.code === "NOT_CONFIGURED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("WhatsApp bulk send error:", error);
    res.status(500).json({ error: "Failed to send WhatsApp messages" });
  }
});

export default router;
