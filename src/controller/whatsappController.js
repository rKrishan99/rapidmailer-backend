// src/controller/whatsappController.js
import { getActiveSocket, getSessionStatus, initSession } from "./whatsappSessionManager.js";
import {
  formatToWhatsappJid,
  renderWhatsappMessage,
  parseSpintax,
  getRandomDelayMs,
  sleep,
  extractDigitsFromJid,
} from "../utils/whatsappHelper.js";
import { registerPoll } from "./whatsappPollController.js";

/**
 * Validates a list of phone numbers using WhatsApp's direct protocol lookup:
 * `sock.onWhatsApp(...jidList)`.
 *
 * No messages are sent. High throughput, checks in batches of 20-50.
 */
export async function filterWhatsappNumbers(recipients, options = {}) {
  const { accountId, defaultCountryCode, batchSize = 30 } = options;

  if (!accountId) {
    const err = new Error("Pick which connected WhatsApp account to use for number filtering.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  let sock = getActiveSocket(accountId);
  if (!sock) {
    const status = getSessionStatus(accountId);
    const err = new Error(
      `WhatsApp account is not connected (${status.status}). Please scan the QR code in WhatsApp Accounts.`
    );
    err.code = "NOT_CONNECTED";
    throw err;
  }

  const chunkSize = Math.min(Math.max(Number(batchSize) || 30, 10), 50);
  const results = [];

  for (let i = 0; i < recipients.length; i += chunkSize) {
    const batch = recipients.slice(i, i + chunkSize);

    // Map each row to JID
    const validJidRows = [];
    const invalidRows = [];

    for (const row of batch) {
      const jid = formatToWhatsappJid(row.phone, defaultCountryCode);
      if (jid) {
        validJidRows.push({ ...row, jid });
      } else {
        invalidRows.push({
          ...row,
          status: "invalid",
          exists: false,
          error: "Unusable phone format",
          verifiedAt: new Date().toISOString(),
        });
      }
    }

    if (validJidRows.length > 0) {
      try {
        const jidsToCheck = validJidRows.map((r) => r.jid);
        // Direct Baileys socket call
        const checkOutcomes = await sock.onWhatsApp(...jidsToCheck);

        // Map outcomes by JID or digits
        const existsMap = new Map();
        if (Array.isArray(checkOutcomes)) {
          for (const item of checkOutcomes) {
            if (item && item.exists) {
              const digits = extractDigitsFromJid(item.jid);
              existsMap.set(digits, item.jid);
            }
          }
        }

        for (const row of validJidRows) {
          const digits = extractDigitsFromJid(row.jid);
          const matchedJid = existsMap.get(digits);
          const exists = Boolean(matchedJid);

          results.push({
            ...row,
            status: exists ? "valid" : "invalid",
            exists,
            formattedJid: matchedJid || row.jid,
            error: exists ? null : "Not registered on WhatsApp",
            verifiedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error("Error during sock.onWhatsApp check batch:", err.message);
        for (const row of validJidRows) {
          results.push({
            ...row,
            status: "failed",
            exists: false,
            error: err.message || "Lookup error",
            verifiedAt: new Date().toISOString(),
          });
        }
      }
    }

    results.push(...invalidRows);

    // Small courteous pause between lookup batches
    if (i + chunkSize < recipients.length) {
      await sleep(500);
    }
  }

  const valid = results.filter((r) => r.exists);
  const invalid = results.filter((r) => !r.exists);

  return {
    results,
    valid,
    invalid,
    stats: {
      total: results.length,
      valid: valid.length,
      invalid: invalid.length,
    },
  };
}

/**
 * Sends messages in bulk using Baileys socket with anti-ban safeguards:
 * - Emulate realistic presence (typing 'composing' 2-4s before dispatch)
 * - Randomized human delays between messages (10-25s by default)
 * - Pacing cooldown (90s pause after every 15 messages)
 * - Spintax and personalized {{tags}} template parsing
 *
 * @param {Array<{phone: string, [key: string]: any}>} recipients
 * @param {{text: string, media?: {type: 'image'|'video'|'document', url: string, urlField?: string}}} messageConfig
 * @param {object} options
 */
export async function sendBulkWhatsapp(recipients, messageConfig, options = {}) {
  const {
    accountId,
    defaultCountryCode,
    minDelaySeconds = 10,
    maxDelaySeconds = 25,
    cooldownAfterCount = 15,
    cooldownSeconds = 90,
    simulatePresence = true,
  } = options;

  if (!accountId) {
    const err = new Error("Pick which connected WhatsApp account to send from.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const status = getSessionStatus(accountId);
    const err = new Error(
      `WhatsApp account is not connected (${status.status}). Please scan the QR code in WhatsApp Accounts first.`
    );
    err.code = "NOT_CONNECTED";
    throw err;
  }

  const results = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];

    // Anti-ban batch cooldown: every N messages, pause for cooldownSeconds
    if (i > 0 && i % cooldownAfterCount === 0) {
      console.log(
        `⏳ Anti-ban cooldown active: pausing for ${cooldownSeconds}s after ${i} messages dispatched...`
      );
      await sleep(cooldownSeconds * 1000);
    }

    const jid = formatToWhatsappJid(recipient.phone, defaultCountryCode);
    if (!jid) {
      results.push({
        ...recipient,
        status: "failed",
        error: "Invalid or missing phone number",
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    // Dynamic message rendering: custom_csv mode or template mode
    let renderedText;
    if (
      messageConfig.mode === "custom_csv" &&
      (recipient.message?.trim() || recipient.custom_message?.trim() || recipient.pitch?.trim())
    ) {
      // Use the per-lead column value directly, but still apply Spintax variability
      const rawLeadMsg =
        recipient.message?.trim() || recipient.custom_message?.trim() || recipient.pitch?.trim();
      renderedText = parseSpintax(rawLeadMsg);
    } else {
      // Template mode: interpolate {{placeholders}} then resolve Spintax
      renderedText = renderWhatsappMessage(messageConfig.text || "", recipient);
    }

    try {
      // 1. Emulate realistic typing presence
      if (simulatePresence) {
        try {
          await sock.sendPresenceUpdate("composing", jid);
          const typingDuration = Math.floor(Math.random() * 2000) + 2000; // 2-4 seconds typing
          await sleep(typingDuration);
          await sock.sendPresenceUpdate("paused", jid);
        } catch (presenceErr) {
          // Presence update is best effort, do not abort send if it fails
        }
      }

      // 2. Dispatch payload
      let sentInfo;

      // Check if media attachment is configured
      const media = messageConfig.media;
      const mediaUrl = media?.url || (media?.urlField ? recipient[media.urlField] : null);

      if (media && media.type && mediaUrl) {
        const mediaPayload = {};
        if (media.type === "image") {
          mediaPayload.image = { url: String(mediaUrl).trim() };
          mediaPayload.caption = renderedText;
        } else if (media.type === "video") {
          mediaPayload.video = { url: String(mediaUrl).trim() };
          mediaPayload.caption = renderedText;
        } else if (media.type === "document") {
          mediaPayload.document = { url: String(mediaUrl).trim() };
          mediaPayload.caption = renderedText;
          mediaPayload.mimetype = "application/pdf";
        }
        sentInfo = await sock.sendMessage(jid, mediaPayload);
      } else if (renderedText) {
        // Plain text with Spintax
        sentInfo = await sock.sendMessage(jid, { text: renderedText });
      }

      // Check if interactive Poll attachment is configured
      const poll = messageConfig.poll;
      if (
        poll &&
        poll.question &&
        poll.question.trim() &&
        Array.isArray(poll.options) &&
        poll.options.length >= 2
      ) {
        const renderedPollName = renderWhatsappMessage(poll.question.trim(), recipient);
        const pollValues = poll.options
          .map((opt) => renderWhatsappMessage(String(opt || "").trim(), recipient))
          .filter(Boolean)
          .slice(0, 12); // WhatsApp supports up to 12 choices

        if (pollValues.length >= 2) {
          // If a text message was sent first, pause slightly for natural rhythm
          if (sentInfo) {
            await sleep(1000);
          }
          const pollInfo = await sock.sendMessage(jid, {
            poll: {
              name: renderedPollName,
              values: pollValues,
              selectableCount: Number(poll.selectableCount) || 1,
            },
          });
          if (pollInfo?.key?.id) {
            const encKey =
              pollInfo.message?.pollCreationMessage?.encKey ||
              pollInfo.message?.pollCreationMessageV2?.encKey ||
              pollInfo.message?.pollCreationMessageV3?.encKey;
            try {
              registerPoll({
                pollId: pollInfo.key.id,
                accountId,
                jid,
                question: renderedPollName,
                options: pollValues,
                pollEncKey: encKey,
                pollCreatorJid: sock.user?.id,
              });
            } catch (regErr) {
              console.warn("Could not register poll metadata:", regErr.message);
            }
          }
          if (!sentInfo) sentInfo = pollInfo;
        }
      }

      results.push({
        ...recipient,
        status: "sent",
        messageId: sentInfo?.key?.id || null,
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (sendErr) {
      console.error(`Failed to send WhatsApp message to ${recipient.phone}:`, sendErr.message);
      results.push({
        ...recipient,
        status: "failed",
        messageId: null,
        error: sendErr.message || "Failed to dispatch message",
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Anti-ban human randomized delay before next recipient
    if (i + 1 < recipients.length) {
      const delayMs = getRandomDelayMs(minDelaySeconds, maxDelaySeconds);
      await sleep(delayMs);
    }
  }

  return {
    results,
    stats: {
      total: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
  };
}
