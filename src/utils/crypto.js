import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RAPIDMAILER_DATA_DIR || path.join(__dirname, "..", "..", "data");
const KEY_FILE = path.join(DATA_DIR, "settings.key");

// Secrets are encrypted at rest with AES-256-GCM. The key comes from
// SETTINGS_ENCRYPTION_KEY if set (derived via scrypt so any passphrase
// length works); otherwise a random 32-byte key is generated once and
// persisted locally so this works out of the box with zero setup.
function loadOrCreateKey() {
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    return crypto.scryptSync(process.env.SETTINGS_ENCRYPTION_KEY, "rapidmailer-settings", 32);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

const KEY = loadOrCreateKey();

export function encryptSecret(plaintext) {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload) {
  if (!payload) return "";
  const parts = String(payload).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return "";

  const [, ivHex, authTagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}
