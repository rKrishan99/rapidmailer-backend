// src/config/dataDir.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The data directory is located OUTSIDE the rapidmailer-backend codebase
// so that nodemon/watchers never see session auth files or settings writes.
const DEFAULT_DATA_DIR = path.join(__dirname, "..", "..", "..", "rapidmailer_data");
const LEGACY_DATA_DIR = path.join(__dirname, "..", "..", "data");

export const DATA_DIR = process.env.RAPIDMAILER_DATA_DIR || DEFAULT_DATA_DIR;

// Ensure DATA_DIR exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {}

// Auto-migrate legacy data from backend/data to rapidmailer_data if needed
try {
  if (fs.existsSync(LEGACY_DATA_DIR) && DATA_DIR !== LEGACY_DATA_DIR) {
    const filesToMigrate = ["settings.json", "settings.key"];
    for (const file of filesToMigrate) {
      const src = path.join(LEGACY_DATA_DIR, file);
      const dst = path.join(DATA_DIR, file);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
        console.log(`📦 Migrated ${file} to ${DATA_DIR}`);
      }
    }
  }
} catch (e) {
  console.warn("Could not auto-migrate legacy data:", e.message);
}
