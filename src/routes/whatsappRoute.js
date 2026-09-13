// src/routes/whatsappRoute.js
import express from "express";
import {
  listWhatsappAccounts,
  addWhatsappAccount,
  updateWhatsappAccount,
  deleteWhatsappAccount,
  SettingsValidationError,
} from "../config/settingsStore.js";
import {
  initSession,
  getSessionStatus,
  subscribeSessionUpdates,
  logoutSession,
} from "../controller/whatsappSessionManager.js";
import {
  filterWhatsappNumbers,
  sendBulkWhatsapp,
} from "../controller/whatsappController.js";

const router = express.Router();

const MAX_BULK_RECIPIENTS = 500;

// ---------------------------------------------------------------------------
// Accounts & Sessions Management (QR-based multi-account)
// ---------------------------------------------------------------------------

// List all accounts enriched with live session status.
// Auto-triggers initSession for accounts whose creds exist but socket is idle
// (e.g. after a server restart) so the UI sees "connecting" → "connected" quickly.
router.get("/whatsapp/accounts", (req, res) => {
  const accounts = listWhatsappAccounts();
  const enriched = accounts.map((acc) => {
    const live = getSessionStatus(acc.id);

    // If credentials exist on disk but no active socket, silently reconnect
    if (live.status === "saved_idle") {
      initSession(acc.id).catch((err) =>
        console.error(`Auto-reconnect failed for ${acc.id}:`, err.message)
      );
    }

    return {
      ...acc,
      liveStatus: live.status,
      connected: live.status === "connected" || acc.connected,
      activeUser: live.user || null,
    };
  });
  res.json({ accounts: enriched });
});

// Create a new WhatsApp Account draft and initialize session for QR generation
router.post("/whatsapp/accounts", async (req, res) => {
  try {
    const { label } = req.body || {};
    const account = addWhatsappAccount({
      label: label || "New WhatsApp Account",
      accessToken: "qr_managed",
      phoneNumberId: "qr_managed",
    });

    // Start session in background for QR code generation
    initSession(account.id).catch((err) => {
      console.error(`Error auto-initializing session for ${account.id}:`, err.message);
    });

    res.status(201).json({ account, message: "WhatsApp account created" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to add WhatsApp account:", error.message);
    res.status(500).json({ error: "Failed to add WhatsApp account" });
  }
});

// Update an account label
router.put("/whatsapp/accounts/:id", (req, res) => {
  try {
    const { label } = req.body || {};
    const account = updateWhatsappAccount(req.params.id, { label });
    res.json({ account, message: "WhatsApp account updated" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to update WhatsApp account:", error.message);
    res.status(500).json({ error: "Failed to update WhatsApp account" });
  }
});

// Remove an account and disconnect its active session
router.delete("/whatsapp/accounts/:id", async (req, res) => {
  try {
    const accountId = req.params.id;
    await logoutSession(accountId);
    deleteWhatsappAccount(accountId);
    res.json({ message: "WhatsApp account removed" });
  } catch (error) {
    console.error("Failed to delete WhatsApp account:", error.message);
    res.status(500).json({ error: "Failed to delete WhatsApp account" });
  }
});

// ---------------------------------------------------------------------------
// QR Code & Session Control Endpoints
// ---------------------------------------------------------------------------

// Trigger session init / QR generation
router.post("/whatsapp/session/:id/init", async (req, res) => {
  try {
    const accountId = req.params.id;
    const result = await initSession(accountId);
    res.json(result);
  } catch (error) {
    console.error("Error initializing session:", error.message);
    res.status(500).json({ error: error.message || "Failed to initialize session" });
  }
});

// Polling status endpoint — also auto-initiates session if creds exist but socket is idle
router.get("/whatsapp/session/:id/status", (req, res) => {
  const accountId = req.params.id;
  const status = getSessionStatus(accountId);

  // Auto-reconnect if creds are on disk but session socket isn't active
  if (status.status === "saved_idle") {
    initSession(accountId).catch((err) =>
      console.error(`Auto-reconnect (status poll) for ${accountId}:`, err.message)
    );
  }

  res.json(status);
});

// Server-Sent Events (SSE) for real-time QR code and connection updates
router.get("/whatsapp/session/:id/events", (req, res) => {
  const accountId = req.params.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);

  const unsubscribe = subscribeSessionUpdates(accountId, (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  });

  // Keep-alive heartbeats every 20s
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (e) {}
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Disconnect / Log out of WhatsApp session
router.post("/whatsapp/session/:id/logout", async (req, res) => {
  try {
    const accountId = req.params.id;
    await logoutSession(accountId);
    res.json({ message: "WhatsApp account logged out successfully" });
  } catch (error) {
    console.error("Failed to logout session:", error.message);
    res.status(500).json({ error: "Failed to log out session" });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp Number Filter (Direct protocol check: sock.onWhatsApp)
// ---------------------------------------------------------------------------

router.post("/whatsapp/filter-numbers", async (req, res) => {
  try {
    const { recipients, options } = req.body || {};

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "recipients (non-empty array) is required" });
    }
    if (recipients.length > MAX_BULK_RECIPIENTS) {
      return res.status(400).json({ error: `Max ${MAX_BULK_RECIPIENTS} numbers per filter request.` });
    }
    if (!options?.accountId) {
      return res.status(400).json({ error: "Pick which connected WhatsApp account to use." });
    }

    const result = await filterWhatsappNumbers(recipients, options);
    res.status(200).json({
      message: "Number filtering completed",
      ...result,
    });
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("WhatsApp number filter error:", error.message);
    res.status(500).json({ error: "Failed to verify numbers on WhatsApp" });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp Bulk Sender (Anti-ban paced dispatch)
// ---------------------------------------------------------------------------

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
    if (message?.mode !== "custom_csv" && (!message?.text || !message.text.trim())) {
      return res.status(400).json({ error: "Message text is required." });
    }

    const outcome = await sendBulkWhatsapp(recipients, message, settings);

    res.status(200).json({
      message: "WhatsApp bulk send completed",
      results: outcome.results,
      stats: outcome.stats,
    });
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("WhatsApp bulk send error:", error.message);
    res.status(500).json({ error: "Failed to send WhatsApp messages" });
  }
});

export default router;
