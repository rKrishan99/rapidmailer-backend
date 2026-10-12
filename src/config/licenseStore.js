// src/config/licenseStore.js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { DATA_DIR } from "./dataDir.js";

const LICENSE_FILE = path.join(DATA_DIR, "license.json");

/**
 * Deterministic Machine HWID based on system traits
 */
export function getMachineHWID() {
  try {
    const netInterfaces = os.networkInterfaces();
    let macAddress = "";
    for (const iface of Object.values(netInterfaces).flat()) {
      if (iface && !iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        macAddress = iface.mac;
        break;
      }
    }

    const rawId = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()?.[0]?.model || "cpu",
      macAddress || "default-mac",
    ].join("|");

    const hash = crypto.createHash("sha256").update(rawId).digest("hex").toUpperCase();
    return `HWID-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
  } catch (err) {
    return "HWID-COMMERCIAL-RAPID-001";
  }
}

/**
 * Default licensing payload
 */
function defaultLicense() {
  return {
    registeredEmail: "support@omniplus.io",
    licenseKey: "OMNI-PRO-9842-8712-4410",
    tier: "Omni All-in-One Suite", // 'Lead Miner' | 'Outreach Pro' | 'Omni All-in-One Suite'
    status: "active",
    features: [
      "scraping",
      "whatsapp",
      "email",
      "unlimited_matrix",
      "bulk_verification",
      "omini_copilot"
    ],
    activatedAt: new Date().toISOString(),
    expiresAt: null, // Lifetime / Annual
    boundHwid: getMachineHWID(),
  };
}

/**
 * Get active license status
 */
export function getLicenseInfo() {
  const hwid = getMachineHWID();
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8"));
      // Ensure omini_copilot is included for active Pro/Suite licenses
      const tier = raw.tier || "";
      const isProOrSuite = tier.includes("Suite") || tier.includes("Pro") || tier.includes("All-in-One");
      let features = Array.isArray(raw.features) ? [...raw.features] : [];
      if (isProOrSuite && !features.includes("omini_copilot")) {
        features.push("omini_copilot");
      }
      return {
        ...raw,
        features,
        hwid,
        isBound: !raw.boundHwid || raw.boundHwid === hwid,
      };
    }
  } catch (e) {}

  const def = defaultLicense();
  try {
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(def, null, 2));
  } catch (e) {}

  return {
    ...def,
    hwid,
    isBound: true,
  };
}

/**
 * Check if a specific feature entitlement is active
 */
export function isFeatureAllowed(featureName) {
  const license = getLicenseInfo();
  if (license.status !== "active") return false;
  if (!license.features || !Array.isArray(license.features)) return false;
  return license.features.includes(featureName);
}

/**
 * Activate or update license key
 */
export function activateLicense({ email, licenseKey }) {
  if (!licenseKey || !licenseKey.trim()) {
    throw new Error("License key cannot be empty");
  }

  const cleanKey = licenseKey.trim().toUpperCase();
  const hwid = getMachineHWID();

  // Tier detection based on key format / prefix
  let tier = "Outreach Pro";
  let features = ["scraping", "whatsapp", "email", "omini_copilot"];

  if (cleanKey.includes("SUITE") || cleanKey.includes("ALL") || cleanKey.includes("PRO")) {
    tier = "Omni All-in-One Suite";
    features = ["scraping", "whatsapp", "email", "unlimited_matrix", "bulk_verification", "omini_copilot"];
  } else if (cleanKey.includes("LEAD") || cleanKey.includes("SCRAP")) {
    tier = "Lead Miner";
    features = ["scraping"];
  }

  const updated = {
    registeredEmail: (email && email.trim()) || "commercial-user@rapidmailer.io",
    licenseKey: cleanKey,
    tier,
    status: "active",
    features,
    activatedAt: new Date().toISOString(),
    expiresAt: null,
    boundHwid: hwid,
  };

  fs.writeFileSync(LICENSE_FILE, JSON.stringify(updated, null, 2));
  return { ...updated, hwid, isBound: true };
}
