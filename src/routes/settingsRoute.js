import express from "express";
import nodemailer from "nodemailer";
import {
  getSettings,
  getPublicSettings,
  updateSettings,
  SettingsValidationError,
} from "../config/settingsStore.js";

const router = express.Router();

router.get("/settings", (req, res) => {
  res.json({ settings: getPublicSettings() });
});

router.put("/settings", (req, res) => {
  try {
    const settings = updateSettings(req.body || {});
    res.json({ settings, message: "Settings saved" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to update settings:", error);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// Sends a real test email using either the saved SMTP settings or an
// unsaved draft from the request body, so the UI can verify credentials
// work before committing them.
router.post("/settings/test-smtp", async (req, res) => {
  try {
    const stored = getSettings().smtp;
    const draft = req.body?.smtp || {};

    const smtp = {
      host: draft.host !== undefined ? draft.host : stored.host,
      port: draft.port !== undefined ? Number(draft.port) : stored.port,
      secure: draft.secure !== undefined ? Boolean(draft.secure) : stored.secure,
      user: draft.user !== undefined ? draft.user : stored.user,
      pass: draft.pass ? draft.pass : stored.pass,
      fromEmail: draft.fromEmail !== undefined ? draft.fromEmail : stored.fromEmail,
      fromName: draft.fromName !== undefined ? draft.fromName : stored.fromName,
    };

    if (!smtp.host || !smtp.port || !smtp.user || !smtp.pass || !smtp.fromEmail) {
      return res
        .status(400)
        .json({ error: "Fill in host, port, user, password and from email before testing" });
    }

    const to = req.body?.to || smtp.fromEmail;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    await transporter.verify();
    const info = await transporter.sendMail({
      from: `"${smtp.fromName || "RapidMailer"}" <${smtp.fromEmail}>`,
      to,
      subject: "RapidMailer test email",
      text: "This is a test email confirming your SMTP settings are working.",
      html: "<p>This is a test email confirming your SMTP settings are working.</p>",
    });

    res.json({ message: `Test email sent to ${to}`, messageId: info.messageId });
  } catch (error) {
    console.error("SMTP test failed:", error.message);
    res.status(400).json({ error: error.message || "SMTP test failed" });
  }
});

export default router;
