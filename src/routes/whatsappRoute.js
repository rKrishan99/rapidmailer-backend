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
import {
  getParticipatingGroups,
  getGroupParticipants,
} from "../controller/whatsappGroupController.js";
import {
  getPollsList,
  getPollAnalytics,
} from "../controller/whatsappPollController.js";
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  toggleRule,
} from "../controller/whatsappAutoResponder.js";
import {
  getAccountChatsAndContacts,
} from "../controller/whatsappBackupController.js";
import {
  startWarmer,
  stopWarmer,
  getWarmerStatus,
} from "../controller/whatsappWarmerController.js";
import {
  getActiveGroupMembers,
} from "../controller/whatsappActiveMembersController.js";
import {
  extractGroupLinksFromUrls,
} from "../controller/whatsappWebLinksController.js";
import {
  findPublicGroups,
} from "../controller/whatsappGroupFinderController.js";
import {
  batchJoinGroups,
} from "../controller/whatsappGroupJoinerController.js";
import {
  bulkAddGroupParticipants,
} from "../controller/whatsappGroupAdderController.js";
import {
  batchCreateGroups,
} from "../controller/whatsappGroupCreatorController.js";

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
    const hasText = Boolean(message?.text && message.text.trim());
    const hasPoll = Boolean(
      message?.poll &&
        message.poll.question?.trim() &&
        Array.isArray(message.poll.options) &&
        message.poll.options.length >= 2
    );
    if (message?.mode !== "custom_csv" && !hasText && !hasPoll) {
      return res.status(400).json({ error: "Please provide a message text or attach a WhatsApp poll." });
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

// ---------------------------------------------------------------------------
// WhatsApp Group Members Grabber
// ---------------------------------------------------------------------------

router.get("/whatsapp/groups", async (req, res) => {
  try {
    const accountId = req.query.accountId;
    if (!accountId) {
      return res.status(400).json({ error: "accountId query parameter is required" });
    }
    const groups = await getParticipatingGroups(accountId);
    res.json({ groups });
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error fetching participating groups:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch groups" });
  }
});

router.get("/whatsapp/groups/:id/participants", async (req, res) => {
  try {
    const groupId = req.params.id;
    const accountId = req.query.accountId;
    if (!accountId) {
      return res.status(400).json({ error: "accountId query parameter is required" });
    }
    const details = await getGroupParticipants(accountId, groupId);
    res.json(details);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    console.error(`Error fetching group participants for ${req.params.id}:`, error.message);
    res.status(500).json({ error: error.message || "Failed to fetch group participants" });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp Poll Results & Analytics
// ---------------------------------------------------------------------------

router.get("/whatsapp/polls", (req, res) => {
  try {
    const accountId = req.query.accountId;
    const polls = getPollsList(accountId);
    res.json({ polls });
  } catch (error) {
    console.error("Error fetching polls list:", error.message);
    res.status(500).json({ error: "Failed to fetch polls list" });
  }
});

router.get("/whatsapp/polls/:id", (req, res) => {
  try {
    const pollId = req.params.id;
    const analytics = getPollAnalytics(pollId);
    if (!analytics) {
      return res.status(404).json({ error: "Poll not found" });
    }
    res.json(analytics);
  } catch (error) {
    console.error("Error fetching poll analytics:", error.message);
    res.status(500).json({ error: "Failed to fetch poll analytics" });
  }
});

// ---------------------------------------------------------------------------
// Rule-Based Auto-Responder Bot
// ---------------------------------------------------------------------------

router.get("/whatsapp/auto-responder/rules", (req, res) => {
  try {
    const rules = listRules();
    res.json({ rules });
  } catch (error) {
    console.error("Error listing auto-responder rules:", error.message);
    res.status(500).json({ error: "Failed to list auto-responder rules" });
  }
});

router.post("/whatsapp/auto-responder/rules", (req, res) => {
  try {
    const { keyword, matchType, replyText, enabled } = req.body || {};
    const created = addRule({ keyword, matchType, replyText, enabled });
    res.status(201).json({ rule: created, message: "Rule created successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put("/whatsapp/auto-responder/rules/:id", (req, res) => {
  try {
    const updated = updateRule(req.params.id, req.body || {});
    res.json({ rule: updated, message: "Rule updated successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/whatsapp/auto-responder/rules/:id", (req, res) => {
  try {
    deleteRule(req.params.id);
    res.json({ message: "Rule deleted successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/whatsapp/auto-responder/rules/:id/toggle", (req, res) => {
  try {
    const updated = toggleRule(req.params.id, req.body?.enabled);
    res.json({ rule: updated, message: "Rule status updated" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Active Chats & Contacts Backup
// ---------------------------------------------------------------------------

router.get("/whatsapp/backup/chats-contacts", async (req, res) => {
  try {
    const accountId = req.query.accountId;
    if (!accountId) {
      return res.status(400).json({ error: "accountId query parameter is required" });
    }
    const data = await getAccountChatsAndContacts(accountId);
    res.json(data);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error retrieving backup contacts/chats:", error.message);
    res.status(500).json({ error: error.message || "Failed to retrieve backup data" });
  }
});

// ---------------------------------------------------------------------------
// 1. WhatsApp Warmer Engine
// ---------------------------------------------------------------------------

router.post("/whatsapp/warmer/start", (req, res) => {
  try {
    const status = startWarmer(req.body || {});
    res.json({ message: "Warmer engine started", status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/whatsapp/warmer/stop", (req, res) => {
  try {
    const status = stopWarmer();
    res.json({ message: "Warmer engine stopped", status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/whatsapp/warmer/status", (req, res) => {
  try {
    const status = getWarmerStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 2. Grab Active Group Members Only
// ---------------------------------------------------------------------------

router.get("/whatsapp/groups/:id/active-members", async (req, res) => {
  try {
    const groupId = req.params.id;
    const { accountId, days } = req.query;
    if (!accountId) {
      return res.status(400).json({ error: "accountId query parameter is required" });
    }
    const data = await getActiveGroupMembers({ accountId, groupId, days });
    res.json(data);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error fetching active group members:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch active group members" });
  }
});

// ---------------------------------------------------------------------------
// 3. Grab Group Links from Web Pages
// ---------------------------------------------------------------------------

router.post("/whatsapp/web-links/extract", async (req, res) => {
  try {
    const { urls, accountId } = req.body || {};
    const result = await extractGroupLinksFromUrls(urls, { accountId });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 4. WhatsApp Group Finder
// ---------------------------------------------------------------------------

router.get("/whatsapp/group-finder/search", async (req, res) => {
  try {
    const { keyword, country, maxResults } = req.query;
    const result = await findPublicGroups({ keyword, country, maxResults });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 5. Auto Group Joiner
// ---------------------------------------------------------------------------

router.post("/whatsapp/group-joiner/join", async (req, res) => {
  try {
    const result = await batchJoinGroups(req.body || {});
    res.json(result);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 6. Bulk Add Group Members
// ---------------------------------------------------------------------------

router.post("/whatsapp/group-adder/add", async (req, res) => {
  try {
    const result = await bulkAddGroupParticipants(req.body || {});
    res.json(result);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 7. Bulk Group Generator
// ---------------------------------------------------------------------------

router.post("/whatsapp/group-creator/create", async (req, res) => {
  try {
    const result = await batchCreateGroups(req.body || {});
    res.json(result);
  } catch (error) {
    if (error.code === "NOT_CONFIGURED" || error.code === "NOT_CONNECTED") {
      return res.status(400).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

export default router;
