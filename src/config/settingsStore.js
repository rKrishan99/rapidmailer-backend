import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable so a packaged desktop build can point this at the OS user-data
// folder instead of writing next to (possibly read-only) application code.
const DATA_DIR = process.env.RAPIDMAILER_DATA_DIR || path.join(__dirname, "..", "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export class SettingsValidationError extends Error {}

function isValidPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// .env values are only used to seed settings.json the first time it's
// created — after that, settings.json (editable live via the UI) wins.
function defaultsFromEnv() {
  return {
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      fromEmail: process.env.FROM_EMAIL || "",
      fromName: process.env.FROM_NAME || "RapidMailer",
    },
    scraping: {
      puppeteerHeadless: process.env.PUPPETEER_HEADLESS !== "false",
    },
    integrations: {
      googlePageSpeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY || "",
    },
    whatsapp: {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
      apiVersion: process.env.WHATSAPP_API_VERSION || "v22.0",
      // Cached from the last successful "test connection" call, purely for
      // display in the UI — never trusted for auth decisions.
      verifiedDisplayName: "",
      verifiedPhoneNumber: "",
    },
  };
}

function readFromDisk() {
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  const defaults = defaultsFromEnv();

  return {
    smtp: {
      ...defaults.smtp,
      ...raw.smtp,
      pass: raw.smtp?.pass ? decryptSecret(raw.smtp.pass) : defaults.smtp.pass,
    },
    scraping: { ...defaults.scraping, ...raw.scraping },
    integrations: {
      ...defaults.integrations,
      ...raw.integrations,
      googlePageSpeedApiKey: raw.integrations?.googlePageSpeedApiKey
        ? decryptSecret(raw.integrations.googlePageSpeedApiKey)
        : defaults.integrations.googlePageSpeedApiKey,
    },
    whatsapp: {
      ...defaults.whatsapp,
      ...raw.whatsapp,
      accessToken: raw.whatsapp?.accessToken
        ? decryptSecret(raw.whatsapp.accessToken)
        : defaults.whatsapp.accessToken,
    },
  };
}

function writeToDisk(settings) {
  const toStore = {
    smtp: { ...settings.smtp, pass: encryptSecret(settings.smtp.pass) },
    scraping: { ...settings.scraping },
    integrations: {
      ...settings.integrations,
      googlePageSpeedApiKey: encryptSecret(settings.integrations.googlePageSpeedApiKey),
    },
    whatsapp: {
      ...settings.whatsapp,
      accessToken: encryptSecret(settings.whatsapp.accessToken),
    },
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(toStore, null, 2));
  fs.renameSync(tmpFile, SETTINGS_FILE);
}

let cache = null;

function ensureLoaded() {
  if (cache) return cache;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    cache = defaultsFromEnv();
    writeToDisk(cache);
    return cache;
  }

  try {
    cache = readFromDisk();
  } catch (err) {
    console.error("Failed to read settings.json, falling back to .env defaults:", err.message);
    cache = defaultsFromEnv();
  }
  return cache;
}

// Full settings including decrypted secrets — for internal server use only.
// Never send this straight back over HTTP; use getPublicSettings() instead.
export function getSettings() {
  return structuredClone(ensureLoaded());
}

export function getPublicSettings() {
  const s = getSettings();
  return {
    smtp: {
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      user: s.smtp.user,
      passConfigured: Boolean(s.smtp.pass),
      fromEmail: s.smtp.fromEmail,
      fromName: s.smtp.fromName,
    },
    scraping: { ...s.scraping },
    integrations: {
      googlePageSpeedApiKeyConfigured: Boolean(s.integrations.googlePageSpeedApiKey),
    },
    whatsapp: {
      phoneNumberId: s.whatsapp.phoneNumberId,
      wabaId: s.whatsapp.wabaId,
      apiVersion: s.whatsapp.apiVersion,
      accessTokenConfigured: Boolean(s.whatsapp.accessToken),
      verifiedDisplayName: s.whatsapp.verifiedDisplayName,
      verifiedPhoneNumber: s.whatsapp.verifiedPhoneNumber,
      connected: Boolean(s.whatsapp.accessToken && s.whatsapp.phoneNumberId),
    },
  };
}

export function updateSettings(partial = {}) {
  const current = ensureLoaded();
  const next = structuredClone(current);

  if (partial.smtp) {
    const s = partial.smtp;
    if (s.host !== undefined) next.smtp.host = String(s.host).trim();
    if (s.port !== undefined) {
      const port = Number(s.port);
      if (!isValidPort(port)) throw new SettingsValidationError("SMTP port must be between 1 and 65535");
      next.smtp.port = port;
    }
    if (s.secure !== undefined) next.smtp.secure = Boolean(s.secure);
    if (s.user !== undefined) next.smtp.user = String(s.user).trim();
    if (s.pass !== undefined) next.smtp.pass = String(s.pass);
    if (s.fromEmail !== undefined) {
      const email = String(s.fromEmail).trim();
      if (email && !isValidEmail(email)) {
        throw new SettingsValidationError("From email is not a valid email address");
      }
      next.smtp.fromEmail = email;
    }
    if (s.fromName !== undefined) next.smtp.fromName = String(s.fromName).trim();
  }

  if (partial.scraping?.puppeteerHeadless !== undefined) {
    next.scraping.puppeteerHeadless = Boolean(partial.scraping.puppeteerHeadless);
  }

  if (partial.integrations?.googlePageSpeedApiKey !== undefined) {
    next.integrations.googlePageSpeedApiKey = String(partial.integrations.googlePageSpeedApiKey);
  }

  if (partial.whatsapp) {
    const w = partial.whatsapp;
    if (w.accessToken !== undefined) next.whatsapp.accessToken = String(w.accessToken).trim();
    if (w.phoneNumberId !== undefined) next.whatsapp.phoneNumberId = String(w.phoneNumberId).trim();
    if (w.wabaId !== undefined) next.whatsapp.wabaId = String(w.wabaId).trim();
    if (w.apiVersion !== undefined) next.whatsapp.apiVersion = String(w.apiVersion).trim() || "v22.0";
    if (w.verifiedDisplayName !== undefined) {
      next.whatsapp.verifiedDisplayName = String(w.verifiedDisplayName).trim();
    }
    if (w.verifiedPhoneNumber !== undefined) {
      next.whatsapp.verifiedPhoneNumber = String(w.verifiedPhoneNumber).trim();
    }
  }

  writeToDisk(next);
  cache = next;
  return getPublicSettings();
}

// Is outbound email actually usable right now? Used at startup and by the
// UI to show a "not configured" nudge instead of a confusing send failure.
export function isSmtpConfigured() {
  const { smtp } = getSettings();
  return Boolean(smtp.host && smtp.port && smtp.user && smtp.pass && smtp.fromEmail);
}

// Same idea for WhatsApp: an access token + phone number id are the two
// things every Graph API call needs. The WABA id is only needed for
// template-management calls, not for sending, so it's not required here.
export function isWhatsappConfigured() {
  const { whatsapp } = getSettings();
  return Boolean(whatsapp.accessToken && whatsapp.phoneNumberId);
}
