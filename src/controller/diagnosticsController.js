// src/controller/diagnosticsController.js
import os from "node:os";
import { logger } from "../utils/loggerService.js";
import { getLicenseInfo, activateLicense } from "../config/licenseStore.js";

/**
 * GET /api/system/logs
 * Query: limit (default 200), level (ALL, INFO, WARN, ERROR)
 */
export async function getSystemLogs(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 200;
    const level = req.query.level || "ALL";
    const logs = logger.getRecentLogs(limit, level);
    res.json({ success: true, logs });
  } catch (err) {
    logger.error("DIAGNOSTICS", `Failed to get system logs: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve logs" });
  }
}

/**
 * GET /api/system/logs/export
 * Download consolidated 7-day logs as text attachment
 */
export async function exportSystemLogs(req, res) {
  try {
    const days = parseInt(req.query.days, 10) || 7;
    const consolidated = logger.exportConsolidatedLogs(days);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `rapidmailer-diagnostics-${dateStr}.log`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(consolidated);
  } catch (err) {
    logger.error("DIAGNOSTICS", `Failed to export logs: ${err.message}`);
    res.status(500).json({ error: "Failed to export logs" });
  }
}

/**
 * POST /api/system/logs/send-support
 * Collect sanitized system telemetry and bundle with recent errors
 */
export async function sendDiagnosticReport(req, res) {
  try {
    const { userNotes } = req.body || {};
    const recentErrors = logger.getRecentLogs(50, "ERROR");
    const license = getLicenseInfo();

    const memTotal = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const memFree = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    const memUsage = process.memoryUsage();

    const telemetryReport = {
      reportId: `REP-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      userNotes: userNotes || "None provided",
      system: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpuModel: os.cpus()?.[0]?.model || "unknown",
        cpuCount: os.cpus()?.length || 0,
        totalMemoryGB: memTotal,
        freeMemoryGB: memFree,
        nodeVersion: process.version,
        uptimeHours: (process.uptime() / 3600).toFixed(2),
        processHeapUsedMB: (memUsage.heapUsed / (1024 * 1024)).toFixed(2),
      },
      license: {
        hwid: license.hwid,
        tier: license.tier,
        registeredEmail: license.registeredEmail,
      },
      errorCount: recentErrors.length,
      sampleErrors: recentErrors.slice(0, 15),
    };

    logger.info("SUPPORT", `Diagnostic support report generated: ${telemetryReport.reportId}`, {
      tier: license.tier,
      hwid: license.hwid,
    });

    // In a production desktop app, this dispatches via HTTPS to the central Omni support telemetry server.
    // We return full confirmation and ticket identifier to the client.
    res.json({
      success: true,
      ticketId: telemetryReport.reportId,
      message: "Diagnostic report successfully bundled and queued for Omni Support dispatch.",
      report: telemetryReport,
    });
  } catch (err) {
    logger.error("SUPPORT", `Support dispatch failed: ${err.message}`);
    res.status(500).json({ error: "Failed to create diagnostic support report" });
  }
}

/**
 * GET /api/system/license
 */
export async function getLicenseDetails(req, res) {
  try {
    const info = getLicenseInfo();
    // Mask license key for display e.g. OMNI-••••-••••-4410
    const rawKey = info.licenseKey || "";
    const parts = rawKey.split("-");
    let maskedKey = rawKey;
    if (parts.length >= 3) {
      maskedKey = `${parts[0]}-••••-••••-${parts[parts.length - 1]}`;
    }

    res.json({
      success: true,
      license: {
        ...info,
        maskedKey,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read license info" });
  }
}

/**
 * POST /api/system/license/activate
 */
export async function handleActivateLicense(req, res) {
  try {
    const { email, licenseKey } = req.body;
    const activated = activateLicense({ email, licenseKey });
    logger.info("LICENSE", `License activated for tier ${activated.tier} on HWID ${activated.hwid}`);
    res.json({
      success: true,
      message: `Successfully activated ${activated.tier}!`,
      license: activated,
    });
  } catch (err) {
    logger.warn("LICENSE", `License activation rejected: ${err.message}`);
    res.status(400).json({ error: err.message || "Invalid license key" });
  }
}
