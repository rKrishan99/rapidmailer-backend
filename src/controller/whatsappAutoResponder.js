// src/controller/whatsappAutoResponder.js
import {
  getAutoResponderRules,
  saveAutoResponderRule,
  deleteAutoResponderRule,
  toggleAutoResponderRule,
} from "../config/whatsappStore.js";
import { sleep, extractDigitsFromJid } from "../utils/whatsappHelper.js";

// In-memory throttling map: JID -> last reply timestamp (ms)
const lastReplyPerJid = new Map();
const THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Checks if a given incoming text matches a rule based on matchType.
 */
function isRuleMatch(rule, incomingText) {
  if (!rule.enabled || !rule.keyword || !incomingText) return false;

  const keyword = rule.keyword.trim().toLowerCase();
  const text = incomingText.trim().toLowerCase();

  if (rule.matchType === "exact") {
    return text === keyword;
  }

  if (rule.matchType === "contains") {
    return text.includes(keyword);
  }

  if (rule.matchType === "regex") {
    try {
      const reg = new RegExp(rule.keyword, "i");
      return reg.test(incomingText);
    } catch (e) {
      return false;
    }
  }

  return false;
}

/**
 * Extracts clean plain-text string from a Baileys incoming message.
 */
export function extractIncomingMessageText(msg) {
  if (!msg?.message) return null;
  const m = msg.message;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

/**
 * Evaluates an incoming WhatsApp message against auto-reply rules and dispatches replies.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {object} params.sock  Active Baileys socket
 * @param {object} params.msg   Incoming WAMessage
 */
export async function handleIncomingAutoResponse({ accountId, sock, msg }) {
  // Only process messages from external senders (not our own messages)
  if (msg.key.fromMe) return;

  const remoteJid = msg.key.remoteJid || "";
  // Do not auto-reply to status broadcasts or newsletters
  if (remoteJid.includes("status@broadcast") || remoteJid.includes("@newsletter")) return;
  // Ignore group chats to prevent group spam unless explicitly desired
  if (remoteJid.endsWith("@g.us")) return;

  const text = extractIncomingMessageText(msg);
  if (!text || !text.trim()) return;

  const now = Date.now();
  const lastReplied = lastReplyPerJid.get(remoteJid) || 0;

  // 24-hour throttling safeguard per sender JID
  if (now - lastReplied < THROTTLE_WINDOW_MS) {
    return;
  }

  const rules = getAutoResponderRules();
  const activeRules = rules.filter((r) => r.enabled);

  for (const rule of activeRules) {
    if (isRuleMatch(rule, text)) {
      const phone = extractDigitsFromJid(remoteJid);
      console.log(
        `🤖 Auto-responder triggered for +${phone} by rule "${rule.keyword}" [match: ${rule.matchType}]`
      );

      // Record throttle timestamp immediately to prevent race conditions
      lastReplyPerJid.set(remoteJid, now);

      try {
        // 1. Simulate human typing presence
        try {
          await sock.sendPresenceUpdate("composing", remoteJid);
          const typingDuration = Math.floor(Math.random() * 1500) + 2000; // 2-3.5 seconds
          await sleep(typingDuration);
          await sock.sendPresenceUpdate("paused", remoteJid);
        } catch (presenceErr) {
          // Presence is best-effort
        }

        // 2. Dispatch automated reply
        await sock.sendMessage(remoteJid, { text: rule.replyText });
        console.log(`✅ Auto-reply dispatched to +${phone}: "${rule.replyText.slice(0, 40)}..."`);
      } catch (sendErr) {
        console.error(`❌ Failed to send auto-reply to +${phone}:`, sendErr.message);
        // Reset throttle so user can retry on transient failures
        lastReplyPerJid.delete(remoteJid);
      }

      // First matching rule wins
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Rule Management API
// ---------------------------------------------------------------------------

export function listRules() {
  const rules = getAutoResponderRules();
  return rules.map((r) => ({
    ...r,
    cooldownWindowHours: 24,
  }));
}

export function addRule({ keyword, matchType, replyText, enabled = true }) {
  if (!keyword || !keyword.trim()) {
    throw new Error("Keyword is required.");
  }
  if (!replyText || !replyText.trim()) {
    throw new Error("Reply text is required.");
  }

  return saveAutoResponderRule({
    keyword,
    matchType,
    replyText,
    enabled,
  });
}

export function updateRule(id, updates) {
  if (!id) throw new Error("Rule ID is required.");
  return saveAutoResponderRule({ id, ...updates });
}

export function deleteRule(id) {
  if (!id) throw new Error("Rule ID is required.");
  return deleteAutoResponderRule(id);
}

export function toggleRule(id, enabled) {
  if (!id) throw new Error("Rule ID is required.");
  const updated = toggleAutoResponderRule(id, enabled);
  if (!updated) throw new Error("Rule not found.");
  return updated;
}
