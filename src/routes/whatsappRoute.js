import express from "express";
import {
  listWhatsappAccounts,
  addWhatsappAccount,
  updateWhatsappAccount,
  deleteWhatsappAccount,
  SettingsValidationError,
} from "../config/settingsStore.js";
import { testWhatsappConnection, sendBulkWhatsapp } from "../controller/whatsappController.js";

const router = express.Router();

const MAX_BULK_RECIPIENTS = 300;

// --- Accounts (multi-account: one per client/project) ---------------------

router.get("/whatsapp/accounts", (req, res) => {
  res.json({ accounts: listWhatsappAccounts() });
});

router.post("/whatsapp/accounts", (req, res) => {
  try {
    const { label, accessToken, phoneNumberId, wabaId, apiVersion } = req.body || {};
    const account = addWhatsappAccount({ label, accessToken, phoneNumberId, wabaId, apiVersion });
    res.status(201).json({ account, message: "WhatsApp account added" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to add WhatsApp account:", error);
    res.status(500).json({ error: "Failed to add WhatsApp account" });
  }
});

router.put("/whatsapp/accounts/:id", (req, res) => {
  try {
    const { label, accessToken, phoneNumberId, wabaId, apiVersion } = req.body || {};
    const account = updateWhatsappAccount(req.params.id, {
      label,
      accessToken,
      phoneNumberId,
      wabaId,
      apiVersion,
    });
    res.json({ account, message: "WhatsApp account updated" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to update WhatsApp account:", error);
    res.status(500).json({ error: "Failed to update WhatsApp account" });
  }
});

router.delete("/whatsapp/accounts/:id", (req, res) => {
  try {
    deleteWhatsappAccount(req.params.id);
    res.json({ message: "WhatsApp account removed" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to delete WhatsApp account:", error);
    res.status(500).json({ error: "Failed to delete WhatsApp account" });
  }
});

// Verifies a connection against the real Graph API — either a not-yet-saved
// draft ({accessToken, phoneNumberId}) before "Add Account", or an existing
// saved account ({accountId}) for a "Re-test" on its card.
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

// --- Sending -----------------------------------------------------------

// Bulk send for the WhatsApp Bulk Sender (and the Number Filter, which sends
// too — a send attempt is the only way the official API reveals whether a
// number is reachable). `recipients` must already carry a resolved `phone`
// field per row. `accountId` picks which connected account sends the
// messages — required, since RapidMailer supports multiple accounts.
router.post("/whatsapp/send-bulk", async (req, res) => {
  try {
    const { recipients, message, settings } = req.body || {};

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "recipients (non-empty array) is required" });
    }
    if (recipients.length > MAX_BULK_RECIPIENTS) {
      return res.status(400).json({ error: `Max ${MAX_BULK_RECIPIENTS} recipients per request.` });
    }
    if (!settings?.accountId) {
      return res.status(400).json({ error: "Pick which connected WhatsApp account to send from." });
    }
    if (!message || (message.mode === "template" && !message.templateName)) {
      return res
        .status(400)
        .json({ error: "A template name is required (create/approve it in Meta Business Manager first)." });
    }
    if (message.mode === "text" && !message.text) {
      return res.status(400).json({ error: "text is required for text mode" });
    }

    const results = await sendBulkWhatsapp(recipients, message, settings);

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
