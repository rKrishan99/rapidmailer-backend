import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

function newAccountId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function emptyWhatsappAccount(overrides = {}) {
  return {
    id: newAccountId("wa"),
    label: "",
    accessToken: "",
    phoneNumberId: "",
    wabaId: "",
    apiVersion: "v22.0",
    // Cached from the last successful "test connection" call, purely for
    // display in the UI — never trusted for auth decisions.
    verifiedDisplayName: "",
    verifiedPhoneNumber: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function emptyEmailAccount(overrides = {}) {
  return {
    id: newAccountId("em"),
    label: "",
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    fromEmail: "",
    fromName: "RapidMailer",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// .env values are only used to seed settings.json the first time it's
// created — after that, settings.json (editable live via the UI) wins. A
// single account is seeded from .env if any WHATSAPP_* var is set, so an
// existing single-account .env setup keeps working; from then on, accounts
// are managed entirely through the UI (multiple accounts, one per client).
function defaultsFromEnv() {
  const envHasWhatsapp =
    process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_PHONE_NUMBER_ID;

  const envHasSmtp = process.env.SMTP_HOST || process.env.SMTP_USER;

  return {
    emailAccounts: {
      accounts: envHasSmtp
        ? [
            emptyEmailAccount({
              label: "Default",
              host: process.env.SMTP_HOST || "",
              port: Number(process.env.SMTP_PORT) || 587,
              secure: process.env.SMTP_SECURE === "true",
              user: process.env.SMTP_USER || "",
              pass: process.env.SMTP_PASS || "",
              fromEmail: process.env.FROM_EMAIL || "",
              fromName: process.env.FROM_NAME || "RapidMailer",
            }),
          ]
        : [],
    },
    scraping: {
      puppeteerHeadless: process.env.PUPPETEER_HEADLESS !== "false",
    },
    integrations: {
      googlePageSpeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY || "",
    },
    whatsapp: {
      accounts: envHasWhatsapp
        ? [
            emptyWhatsappAccount({
              label: "Default",
              accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
              phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
              wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
              apiVersion: process.env.WHATSAPP_API_VERSION || "v22.0",
            }),
          ]
        : [],
    },
  };
}

// Older settings.json files stored a single WhatsApp account inline
// (whatsapp.accessToken / whatsapp.phoneNumberId etc, no accounts array).
// Migrates that shape into a one-item accounts array the first time it's
// read, so nobody who connected WhatsApp before multi-account support loses
// their saved connection.
function migrateWhatsappShape(raw) {
  if (raw?.whatsapp?.accounts) return raw.whatsapp.accounts;
  if (raw?.whatsapp?.accessToken || raw?.whatsapp?.phoneNumberId) {
    return [
      emptyWhatsappAccount({
        label: "Default",
        accessToken: raw.whatsapp.accessToken || "",
        phoneNumberId: raw.whatsapp.phoneNumberId || "",
        wabaId: raw.whatsapp.wabaId || "",
        apiVersion: raw.whatsapp.apiVersion || "v22.0",
        verifiedDisplayName: raw.whatsapp.verifiedDisplayName || "",
        verifiedPhoneNumber: raw.whatsapp.verifiedPhoneNumber || "",
      }),
    ];
  }
  return [];
}

// Older settings.json files stored a single SMTP account inline (smtp.host /
// smtp.user etc, no accounts array). Migrates that shape into a one-item
// accounts array the first time it's read, so nobody who configured SMTP
// before multi-account support loses their saved sender. `pass` here is
// still the raw (encrypted) on-disk string — decrypted uniformly below,
// same as every other account, whichever shape it came from.
function migrateEmailShape(raw) {
  if (raw?.emailAccounts?.accounts) return raw.emailAccounts.accounts;
  if (raw?.smtp?.host || raw?.smtp?.user) {
    return [
      emptyEmailAccount({
        label: "Default",
        host: raw.smtp.host || "",
        port: raw.smtp.port || 587,
        secure: Boolean(raw.smtp.secure),
        user: raw.smtp.user || "",
        pass: raw.smtp.pass || "",
        fromEmail: raw.smtp.fromEmail || "",
        fromName: raw.smtp.fromName || "RapidMailer",
      }),
    ];
  }
  return [];
}

function readFromDisk() {
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  const defaults = defaultsFromEnv();

  const rawWhatsappAccounts = migrateWhatsappShape(raw);
  const rawEmailAccounts = migrateEmailShape(raw);

  return {
    emailAccounts: {
      accounts:
        rawEmailAccounts.length > 0
          ? rawEmailAccounts.map((acc) => ({
              ...emptyEmailAccount(),
              ...acc,
              pass: acc.pass ? decryptSecret(acc.pass) : "",
            }))
          : defaults.emailAccounts.accounts,
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
      accounts:
        rawWhatsappAccounts.length > 0
          ? rawWhatsappAccounts.map((acc) => ({
              ...emptyWhatsappAccount(),
              ...acc,
              accessToken: acc.accessToken ? decryptSecret(acc.accessToken) : "",
            }))
          : defaults.whatsapp.accounts,
    },
  };
}

function writeToDisk(settings) {
  const toStore = {
    emailAccounts: {
      accounts: settings.emailAccounts.accounts.map((acc) => ({
        ...acc,
        pass: encryptSecret(acc.pass),
      })),
    },
    scraping: { ...settings.scraping },
    integrations: {
      ...settings.integrations,
      googlePageSpeedApiKey: encryptSecret(settings.integrations.googlePageSpeedApiKey),
    },
    whatsapp: {
      accounts: settings.whatsapp.accounts.map((acc) => ({
        ...acc,
        accessToken: encryptSecret(acc.accessToken),
      })),
    },
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(toStore, null, 2));
  fs.renameSync(tmpFile, SETTINGS_FILE);
}

let cache = null;
let usingEphemeralSettings = false;

// Runs at first use, potentially before the server has bound a port. On a
// machine where DATA_DIR isn't writable (locked-down profile, AV blocking
// the folder, read-only install path) an uncaught fs error here would crash
// the whole process. Degrade instead: keep running with in-memory-only
// settings for this session rather than dying — the user can still use the
// app, they just won't have their settings saved until the underlying
// permission issue is fixed (surfaced via isUsingEphemeralSettings()).
function ensureLoaded() {
  if (cache) return cache;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SETTINGS_FILE)) {
      cache = defaultsFromEnv();
      writeToDisk(cache);
      return cache;
    }
  } catch (err) {
    usingEphemeralSettings = true;
    console.error(
      `⚠️  Could not create/write ${DATA_DIR} (${err.message}). Running with in-memory-only settings — ` +
        `nothing will be saved until RapidMailer has write access to that folder.`
    );
    cache = defaultsFromEnv();
    return cache;
  }

  try {
    cache = readFromDisk();
  } catch (err) {
    console.error("Failed to read settings.json, falling back to .env defaults:", err.message);
    // Preserve the unreadable file instead of letting the next save silently
    // overwrite it — corruption (a crash mid-write outside this app, a bad
    // manual edit, disk fault) shouldn't destroy whatever was recoverable.
    try {
      fs.renameSync(SETTINGS_FILE, `${SETTINGS_FILE}.corrupted-${Date.now()}`);
    } catch {
      // Best effort — if even the rename fails, proceed with defaults anyway
      // rather than blocking startup over it.
    }
    cache = defaultsFromEnv();
  }
  return cache;
}

export function isUsingEphemeralSettings() {
  return usingEphemeralSettings;
}

function persist(next) {
  writeToDisk(next);
  cache = next;
}

// Full settings including decrypted secrets — for internal server use only.
// Never send this straight back over HTTP; use getPublicSettings() /
// listWhatsappAccounts() instead.
export function getSettings() {
  return structuredClone(ensureLoaded());
}

function redactWhatsappAccount(acc) {
  return {
    id: acc.id,
    label: acc.label,
    phoneNumberId: acc.phoneNumberId,
    wabaId: acc.wabaId,
    apiVersion: acc.apiVersion,
    accessTokenConfigured: Boolean(acc.accessToken),
    verifiedDisplayName: acc.verifiedDisplayName,
    verifiedPhoneNumber: acc.verifiedPhoneNumber,
    connected: Boolean(acc.accessToken && acc.phoneNumberId),
    createdAt: acc.createdAt,
  };
}

function redactEmailAccount(acc) {
  return {
    id: acc.id,
    label: acc.label,
    host: acc.host,
    port: acc.port,
    secure: acc.secure,
    user: acc.user,
    passConfigured: Boolean(acc.pass),
    fromEmail: acc.fromEmail,
    fromName: acc.fromName,
    createdAt: acc.createdAt,
  };
}

export function getPublicSettings() {
  const s = getSettings();
  return {
    emailAccounts: {
      accounts: s.emailAccounts.accounts.map(redactEmailAccount),
    },
    scraping: { ...s.scraping },
    integrations: {
      googlePageSpeedApiKeyConfigured: Boolean(s.integrations.googlePageSpeedApiKey),
    },
    whatsapp: {
      accounts: s.whatsapp.accounts.map(redactWhatsappAccount),
    },
  };
}

export function updateSettings(partial = {}) {
  const current = ensureLoaded();
  const next = structuredClone(current);

  if (partial.scraping?.puppeteerHeadless !== undefined) {
    next.scraping.puppeteerHeadless = Boolean(partial.scraping.puppeteerHeadless);
  }

  if (partial.integrations?.googlePageSpeedApiKey !== undefined) {
    next.integrations.googlePageSpeedApiKey = String(partial.integrations.googlePageSpeedApiKey);
  }

  persist(next);
  return getPublicSettings();
}

// Is outbound email actually usable right now? Used at startup and by the
// UI to show a "not configured" nudge instead of a confusing send failure.
export function isEmailConfigured() {
  return getSettings().emailAccounts.accounts.some(
    (a) => a.host && a.port && a.user && a.pass && a.fromEmail
  );
}

// ---------------------------------------------------------------------------
// Email accounts (multi-account: one per sender/domain). Campaigns pick one
// of these by id for a given send rather than there being a single global
// "the" SMTP connection.
// ---------------------------------------------------------------------------

export function listEmailAccounts() {
  return getSettings().emailAccounts.accounts.map(redactEmailAccount);
}

// Full account including the decrypted password — for internal server use
// only (building the SMTP transporter), never sent over HTTP.
export function getEmailAccount(accountId) {
  const account = getSettings().emailAccounts.accounts.find((a) => a.id === accountId);
  return account || null;
}

// The account a campaign sends from when none is explicitly picked.
export function getDefaultEmailAccount() {
  return getSettings().emailAccounts.accounts[0] || null;
}

function validateEmailAccountFields(fields, { requireCreds }) {
  if (requireCreds) {
    if (!fields.host || !String(fields.host).trim()) throw new SettingsValidationError("SMTP host is required");
    if (!fields.user || !String(fields.user).trim()) throw new SettingsValidationError("SMTP username is required");
    if (!fields.pass || !String(fields.pass).trim()) throw new SettingsValidationError("SMTP password is required");
    if (!fields.fromEmail || !String(fields.fromEmail).trim()) {
      throw new SettingsValidationError("From email is required");
    }
  }
  if (fields.fromEmail && !isValidEmail(String(fields.fromEmail).trim())) {
    throw new SettingsValidationError("From email is not a valid email address");
  }
  if (fields.port !== undefined && !isValidPort(Number(fields.port))) {
    throw new SettingsValidationError("SMTP port must be between 1 and 65535");
  }
}

export function addEmailAccount(fields = {}) {
  validateEmailAccountFields(fields, { requireCreds: true });
  const current = ensureLoaded();
  const next = structuredClone(current);

  const account = emptyEmailAccount({
    label: String(fields.label || "").trim() || `Account ${next.emailAccounts.accounts.length + 1}`,
    host: String(fields.host).trim(),
    port: Number(fields.port) || 587,
    secure: Boolean(fields.secure),
    user: String(fields.user).trim(),
    pass: String(fields.pass).trim(),
    fromEmail: String(fields.fromEmail).trim(),
    fromName: String(fields.fromName || "").trim() || "RapidMailer",
  });

  next.emailAccounts.accounts.push(account);
  persist(next);
  return redactEmailAccount(account);
}

export function updateEmailAccount(accountId, fields = {}) {
  validateEmailAccountFields(fields, { requireCreds: false });
  const current = ensureLoaded();
  const next = structuredClone(current);
  const index = next.emailAccounts.accounts.findIndex((a) => a.id === accountId);
  if (index === -1) {
    throw new SettingsValidationError("No email account with that id");
  }

  const account = next.emailAccounts.accounts[index];
  if (fields.label !== undefined) account.label = String(fields.label).trim();
  if (fields.host !== undefined) account.host = String(fields.host).trim();
  if (fields.port !== undefined) account.port = Number(fields.port);
  if (fields.secure !== undefined) account.secure = Boolean(fields.secure);
  if (fields.user !== undefined) account.user = String(fields.user).trim();
  if (fields.pass !== undefined && String(fields.pass).trim()) {
    account.pass = String(fields.pass).trim();
  }
  if (fields.fromEmail !== undefined) account.fromEmail = String(fields.fromEmail).trim();
  if (fields.fromName !== undefined) account.fromName = String(fields.fromName).trim() || "RapidMailer";

  persist(next);
  return redactEmailAccount(account);
}

export function deleteEmailAccount(accountId) {
  const current = ensureLoaded();
  const next = structuredClone(current);
  const before = next.emailAccounts.accounts.length;
  next.emailAccounts.accounts = next.emailAccounts.accounts.filter((a) => a.id !== accountId);
  if (next.emailAccounts.accounts.length === before) {
    throw new SettingsValidationError("No email account with that id");
  }
  persist(next);
}

// ---------------------------------------------------------------------------
// WhatsApp accounts (multi-account: one per client/project). Every WhatsApp
// tool picks one of these by id for a given run rather than there being a
// single global "the" WhatsApp connection.
// ---------------------------------------------------------------------------

export function listWhatsappAccounts() {
  return getSettings().whatsapp.accounts.map(redactWhatsappAccount);
}

// Full account including the decrypted access token — for internal server
// use only (building the Graph API request), never sent over HTTP.
export function getWhatsappAccount(accountId) {
  const account = getSettings().whatsapp.accounts.find((a) => a.id === accountId);
  return account || null;
}

export function isWhatsappConfigured() {
  return getSettings().whatsapp.accounts.some((a) => a.accessToken && a.phoneNumberId);
}

function validateWhatsappFields(fields, { requireCreds }) {
  if (requireCreds) {
    if (!fields.accessToken || !String(fields.accessToken).trim()) {
      throw new SettingsValidationError("Access token is required");
    }
    if (!fields.phoneNumberId || !String(fields.phoneNumberId).trim()) {
      throw new SettingsValidationError("Phone Number ID is required");
    }
  }
}

export function addWhatsappAccount(fields = {}) {
  validateWhatsappFields(fields, { requireCreds: true });
  const current = ensureLoaded();
  const next = structuredClone(current);

  const account = emptyWhatsappAccount({
    label: String(fields.label || "").trim() || `Account ${next.whatsapp.accounts.length + 1}`,
    accessToken: String(fields.accessToken).trim(),
    phoneNumberId: String(fields.phoneNumberId).trim(),
    wabaId: String(fields.wabaId || "").trim(),
    apiVersion: String(fields.apiVersion || "").trim() || "v22.0",
  });

  next.whatsapp.accounts.push(account);
  persist(next);
  return redactWhatsappAccount(account);
}

export function updateWhatsappAccount(accountId, fields = {}) {
  const current = ensureLoaded();
  const next = structuredClone(current);
  const index = next.whatsapp.accounts.findIndex((a) => a.id === accountId);
  if (index === -1) {
    throw new SettingsValidationError("No WhatsApp account with that id");
  }

  const account = next.whatsapp.accounts[index];
  if (fields.label !== undefined) account.label = String(fields.label).trim();
  if (fields.accessToken !== undefined && String(fields.accessToken).trim()) {
    account.accessToken = String(fields.accessToken).trim();
  }
  if (fields.phoneNumberId !== undefined) account.phoneNumberId = String(fields.phoneNumberId).trim();
  if (fields.wabaId !== undefined) account.wabaId = String(fields.wabaId).trim();
  if (fields.apiVersion !== undefined) account.apiVersion = String(fields.apiVersion).trim() || "v22.0";
  if (fields.verifiedDisplayName !== undefined) {
    account.verifiedDisplayName = String(fields.verifiedDisplayName).trim();
  }
  if (fields.verifiedPhoneNumber !== undefined) {
    account.verifiedPhoneNumber = String(fields.verifiedPhoneNumber).trim();
  }

  persist(next);
  return redactWhatsappAccount(account);
}

export function deleteWhatsappAccount(accountId) {
  const current = ensureLoaded();
  const next = structuredClone(current);
  const before = next.whatsapp.accounts.length;
  next.whatsapp.accounts = next.whatsapp.accounts.filter((a) => a.id !== accountId);
  if (next.whatsapp.accounts.length === before) {
    throw new SettingsValidationError("No WhatsApp account with that id");
  }
  persist(next);
}
