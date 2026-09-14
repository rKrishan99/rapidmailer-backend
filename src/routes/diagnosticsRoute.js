// src/routes/diagnosticsRoute.js
import express from "express";
import {
  getSystemLogs,
  exportSystemLogs,
  sendDiagnosticReport,
  getLicenseDetails,
  handleActivateLicense,
} from "../controller/diagnosticsController.js";

const router = express.Router();

router.get("/system/logs", getSystemLogs);
router.get("/system/logs/export", exportSystemLogs);
router.post("/system/logs/send-support", sendDiagnosticReport);
router.get("/system/license", getLicenseDetails);
router.post("/system/license/activate", handleActivateLicense);

export default router;
