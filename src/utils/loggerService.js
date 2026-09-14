// src/utils/loggerService.js
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config/dataDir.js";

const LOGS_DIR = path.join(DATA_DIR, "logs");
const MAX_RETENTION_DAYS = 90;
const RECENT_BUFFER_SIZE = 300;

// Ensure logs directory exists
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (e) {}

// Circular buffer for instant in-memory retrieval without heavy disk hits
const recentLogs = [];

/**
 * Redact sensitive fields (passwords, auth tokens, JWTs, Baileys keys)
 */
function sanitizeData(input) {
  if (typeof input !== "string") {
    try {
      input = JSON.stringify(input);
    } catch {
      input = String(input);
    }
  }

  return input
    .replace(/(?:pass|password|pwd|secret|accessToken|token|apiKey|key)["']?\s*[:=]\s*["']?([^"',\s}]+)/gi, (m, val) => {
      if (val.length <= 4) return m.replace(val, "••••");
      return m.replace(val, `${val.slice(0, 2)}••••${val.slice(-2)}`);
    })
    .replace(/Bearer\s+([a-zA-Z0-9._-]+)/gi, "Bearer ••••••••")
    .replace(/EA[A-Za-z0-9]+/g, (m) => `${m.slice(0, 4)}••••${m.slice(-4)}`);
}

/**
 * Get current day log filename
 */
function getLogFilePath(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `app-${yyyy}-${mm}-${dd}.log`);
}

/**
 * Purge log files older than 90 days
 */
export function cleanOldLogs() {
  try {
    if (!fs.existsSync(LOGS_DIR)) return;
    const now = Date.now();
    const maxAgeMs = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOGS_DIR);

    for (const file of files) {
      if (!file.startsWith("app-") || !file.endsWith(".log")) continue;
      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error("Failed to clean old logs:", err.message);
  }
}

// Initial clean on startup
cleanOldLogs();
// Periodic sweep every 24 hours
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000).unref();

/**
 * Core log appender
 */
function appendLog(level, moduleName, message, meta = null) {
  const timestamp = new Date().toISOString();
  let cleanMsg = sanitizeData(message || "");
  let cleanMeta = meta ? " " + sanitizeData(meta) : "";
  const entryText = `[${timestamp}] [${level.toUpperCase()}] [${moduleName || "APP"}] ${cleanMsg}${cleanMeta}`;

  const entryObj = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    level: level.toUpperCase(),
    module: moduleName || "APP",
    message: cleanMsg,
    meta: cleanMeta.trim() || undefined,
  };

  // Push to circular buffer
  recentLogs.push(entryObj);
  if (recentLogs.length > RECENT_BUFFER_SIZE) {
    recentLogs.shift();
  }

  // Write asynchronously to daily disk log
  const logFile = getLogFilePath();
  fs.appendFile(logFile, entryText + "\n", "utf8", (err) => {
    if (err) console.error("Error writing to diagnostic log:", err.message);
  });
}

export const logger = {
  info: (moduleName, msg, meta) => appendLog("INFO", moduleName, msg, meta),
  warn: (moduleName, msg, meta) => appendLog("WARN", moduleName, msg, meta),
  error: (moduleName, msg, meta) => appendLog("ERROR", moduleName, msg, meta),
  debug: (moduleName, msg, meta) => appendLog("DEBUG", moduleName, msg, meta),

  /**
   * Return recent log entries from memory buffer with optional level filter
   */
  getRecentLogs: (limit = 200, levelFilter = "ALL") => {
    let logs = [...recentLogs];
    if (levelFilter && levelFilter.toUpperCase() !== "ALL") {
      logs = logs.filter((l) => l.level === levelFilter.toUpperCase());
    }
    return logs.slice(-Math.min(limit, 500)).reverse();
  },

  /**
   * Export the last N days of logs consolidated into a single string
   */
  exportConsolidatedLogs: (days = 7) => {
    cleanOldLogs();
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const targetDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const filePath = getLogFilePath(targetDate);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        result.push(content);
      }
    }

    if (result.length === 0 && recentLogs.length > 0) {
      return recentLogs.map((l) => `[${l.timestamp}] [${l.level}] [${l.module}] ${l.message}`).join("\n");
    }

    return result.join("\n");
  },
};
