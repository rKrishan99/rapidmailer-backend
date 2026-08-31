import express from "express";
import nodemailer from "nodemailer";
import {
  listEmailAccounts,
  getEmailAccount,
  addEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  SettingsValidationError,
} from "../config/settingsStore.js";

const router = express.Router();

// --- Accounts (multi-account: one per sender/domain) -----------------------

router.get("/email-accounts", (req, res) => {
  res.json({ accounts: listEmailAccounts() });
});

router.post("/email-accounts", (req, res) => {
  try {
    const { label, host, port, secure, user, pass, fromEmail, fromName } = req.body || {};
    const account = addEmailAccount({ label, host, port, secure, user, pass, fromEmail, fromName });
    res.status(201).json({ account, message: "Email account added" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to add email account:", error);
    res.status(500).json({ error: "Failed to add email account" });
  }
});

router.put("/email-accounts/:id", (req, res) => {
  try {
    const { label, host, port, secure, user, pass, fromEmail, fromName } = req.body || {};
    const account = updateEmailAccount(req.params.id, {
      label,
      host,
      port,
      secure,
      user,
      pass,
      fromEmail,
      fromName,
    });
    res.json({ account, message: "Email account updated" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to update email account:", error);
    res.status(500).json({ error: "Failed to update email account" });
  }
});

router.delete("/email-accounts/:id", (req, res) => {
  try {
    deleteEmailAccount(req.params.id);
    res.json({ message: "Email account removed" });
  } catch (error) {
    if (error instanceof SettingsValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Failed to delete email account:", error);
    res.status(500).json({ error: "Failed to delete email account" });
  }
});

// Sends a real test email using either an existing saved account (by id) or
// a not-yet-saved draft, so the UI can verify credentials work before (or
// after) committing them.
router.post("/email-accounts/test", async (req, res) => {
  try {
    const body = req.body || {};
    let smtp;

    if (body.accountId) {
      const account = getEmailAccount(body.accountId);
      if (!account) return res.status(400).json({ error: "No email account with that id" });
      smtp = account;
    } else {
      smtp = {
        host: body.host,
        port: Number(body.port) || 587,
        secure: Boolean(body.secure),
        user: body.user,
        pass: body.pass,
        fromEmail: body.fromEmail,
        fromName: body.fromName,
      };
    }

    if (!smtp.host || !smtp.port || !smtp.user || !smtp.pass || !smtp.fromEmail) {
      return res
        .status(400)
        .json({ error: "Fill in host, port, user, password and from email before testing" });
    }

    const to = body.to || smtp.fromEmail;

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
