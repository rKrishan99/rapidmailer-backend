// src/controller/whatsappSessionManager.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { updateWhatsappAccount, getWhatsappAccount } from "../config/settingsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RAPIDMAILER_DATA_DIR || path.join(__dirname, "..", "..", "data");
const SESSIONS_DIR = path.join(DATA_DIR, "whatsapp_sessions");

// Ensure sessions directory exists
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/**
 * In-memory state tracking for active sessions:
 * sessions.set(accountId, {
 *   sock: BaileysSocket,
 *   status: 'idle' | 'connecting' | 'qr_ready' | 'connected' | 'disconnected',
 *   qr: string (base64 DataURL),
 *   rawQr: string,
 *   user: { id, name, phone },
 *   error: string | null,
 *   listeners: Set<Function>,
 * })
 */
const activeSessions = new Map();

function getOrCreateSessionData(accountId) {
  if (!activeSessions.has(accountId)) {
    activeSessions.set(accountId, {
      sock: null,
      status: "idle",
      qr: null,
      rawQr: null,
      user: null,
      error: null,
      listeners: new Set(),
      reconnectAttempts: 0,
    });
  }
  return activeSessions.get(accountId);
}

function notifyListeners(accountId) {
  const session = activeSessions.get(accountId);
  if (!session) return;
  const payload = {
    accountId,
    status: session.status,
    qr: session.qr,
    user: session.user,
    error: session.error,
    timestamp: Date.now(),
  };
  for (const listener of session.listeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error(`Error notifying listener for ${accountId}:`, err);
    }
  }
}

/**
 * Initializes or restores a WhatsApp Baileys session for the given accountId
 */
export async function initSession(accountId) {
  if (!accountId) throw new Error("accountId is required to initialize WhatsApp session");

  const session = getOrCreateSessionData(accountId);

  // If already connected, do not reinitialize
  if (session.sock && session.status === "connected") {
    return { status: "connected", user: session.user };
  }

  // If already connecting with a fresh QR ready, return current status
  if (session.sock && session.status === "qr_ready" && session.qr) {
    return { status: session.status, qr: session.qr, user: session.user };
  }

  // Clean up any existing inactive or closing socket
  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners();
      session.sock.ws?.close();
    } catch (e) {}
    session.sock = null;
  }

  session.status = "connecting";
  session.error = null;
  notifyListeners(accountId);

  const sessionDir = path.join(SESSIONS_DIR, accountId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1015901307],
    isLatest: false,
  }));

  const logger = pino({ level: "silent" });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ["RapidMailer", "Chrome", "122.0.0"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  session.sock = sock;

  // Credential update handling
  sock.ev.on("creds.update", saveCreds);

  // Connection update handling
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.rawQr = qr;
      try {
        session.qr = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
      } catch (err) {
        console.error("Failed to generate QR data URL:", err);
      }
      session.status = "qr_ready";
      session.error = null;
      notifyListeners(accountId);
    }

    if (connection === "open") {
      const fullJid = sock.user?.id || "";
      const phone = fullJid.split(":")[0].replace(/[^\d]/g, "");
      const name = sock.user?.name || "WhatsApp User";

      session.status = "connected";
      session.qr = null;
      session.rawQr = null;
      session.user = { id: fullJid, phone, name };
      session.error = null;
      session.reconnectAttempts = 0;

      // Update in settings store for persistent UI view
      try {
        updateWhatsappAccount(accountId, {
          verifiedDisplayName: name,
          verifiedPhoneNumber: phone,
          connected: true,
        });
      } catch (e) {
        // If account isn't yet saved in store, that's okay
      }

      notifyListeners(accountId);
      console.log(`✅ WhatsApp session ${accountId} connected successfully as +${phone} (${name})`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const errorMessage = lastDisconnect?.error?.message || "Connection closed";

      console.log(`⚠️ WhatsApp session ${accountId} closed. StatusCode: ${statusCode}. Logged out: ${isLoggedOut}`);

      if (isLoggedOut) {
        session.status = "disconnected";
        try {
          session.sock?.ev?.removeAllListeners();
          session.sock?.ws?.close();
        } catch (e) {}
        session.sock = null;
        session.qr = null;
        session.rawQr = null;
        session.user = null;
        session.error = "Session logged out from device.";

        // Wipe session folder
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          updateWhatsappAccount(accountId, { connected: false });
        } catch (e) {}

        notifyListeners(accountId);
      } else {
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
        const isQrEnded = errorMessage?.includes("QR refs attempts ended") || statusCode === 408;

        try {
          session.sock?.ev?.removeAllListeners();
          session.sock?.ws?.close();
        } catch (e) {}
        session.sock = null;

        if (isQrEnded && !session.user) {
          session.status = "disconnected";
          session.error = "QR code expired. Click to refresh QR code.";
          notifyListeners(accountId);
        } else {
          // Keep QR code visible if available, or stay in connecting state
          if (!session.qr) {
            session.status = "connecting";
          }
          session.error = null;
          notifyListeners(accountId);

          // Reconnect with debounce
          setTimeout(() => {
            if (activeSessions.get(accountId)?.status !== "connected") {
              initSession(accountId).catch((err) => {
                console.error(`Reconnect error for ${accountId}:`, err.message);
              });
            }
          }, 1500);
        }
      }
    }
  });

  return {
    status: session.status,
    qr: session.qr,
    user: session.user,
  };
}

/**
 * Returns current status and details for an account
 */
export function getSessionStatus(accountId) {
  const session = activeSessions.get(accountId);
  if (!session) {
    // Check if session directory exists on disk with saved credentials
    const sessionDir = path.join(SESSIONS_DIR, accountId);
    const hasCreds = fs.existsSync(path.join(sessionDir, "creds.json"));
    return {
      accountId,
      status: hasCreds ? "saved_idle" : "disconnected",
      qr: null,
      user: null,
      error: null,
    };
  }

  return {
    accountId,
    status: session.status,
    qr: session.qr,
    user: session.user,
    error: session.error,
  };
}

/**
 * Gets the active, connected Baileys socket for operations (filtering, sending)
 */
export function getActiveSocket(accountId) {
  const session = activeSessions.get(accountId);
  if (!session || !session.sock || session.status !== "connected") {
    return null;
  }
  return session.sock;
}

/**
 * Subscribes a listener function to session updates (used by SSE or web sockets)
 */
export function subscribeSessionUpdates(accountId, callback) {
  const session = getOrCreateSessionData(accountId);
  session.listeners.add(callback);

  // Send current state immediately
  callback({
    accountId,
    status: session.status,
    qr: session.qr,
    user: session.user,
    error: session.error,
    timestamp: Date.now(),
  });

  return () => {
    session.listeners.delete(callback);
  };
}

/**
 * Logs out and removes a session completely
 */
export async function logoutSession(accountId) {
  const session = activeSessions.get(accountId);
  if (session && session.sock) {
    try {
      await session.sock.logout();
    } catch (err) {
      // Ignore if already closed
    }
  }

  const sessionDir = path.join(SESSIONS_DIR, accountId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (err) {}

  if (session) {
    session.status = "disconnected";
    session.sock = null;
    session.qr = null;
    session.rawQr = null;
    session.user = null;
    session.error = null;
    notifyListeners(accountId);
  }

  try {
    updateWhatsappAccount(accountId, {
      connected: false,
      verifiedPhoneNumber: "",
      verifiedDisplayName: "",
    });
  } catch (e) {}

  return { success: true };
}

/**
 * Auto-connect all accounts that have existing session credentials on disk
 */
export async function autoRestoreSessions() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const accountId = entry.name;
        const credsFile = path.join(SESSIONS_DIR, accountId, "creds.json");
        if (fs.existsSync(credsFile)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsFile, "utf8"));
            // Only auto-restore sessions that were actually paired and linked to a phone!
            if (creds && creds.me && creds.me.id) {
              console.log(`🔄 Auto-restoring WhatsApp session for account: ${accountId}`);
              initSession(accountId).catch((err) => {
                console.error(`Failed to auto-restore session ${accountId}:`, err.message);
              });
            }
          } catch (readErr) {}
        }
      }
    }
  } catch (err) {
    console.error("Error auto-restoring WhatsApp sessions:", err);
  }
}
