import express from "express";
import { getPublicSettings, updateSettings, SettingsValidationError } from "../config/settingsStore.js";

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

export default router;
