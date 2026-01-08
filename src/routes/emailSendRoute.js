// src/routes/emailSendRoute.js
import express from 'express';
import { sendEmails } from '../controller/emailSendController.js';
import { validateEmails } from '../middleware/emailValidation.js';

const router = express.Router();

router.post('/send-emails',validateEmails, sendEmails);

export default router;
