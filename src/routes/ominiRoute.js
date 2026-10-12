// src/routes/ominiRoute.js
import express from "express";
import { postOminiChat, getOminiStatus } from "../controller/ominiController.js";

const router = express.Router();

router.get("/omini/status", getOminiStatus);
router.post("/omini/chat", postOminiChat);

export default router;
