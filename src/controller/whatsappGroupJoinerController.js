// src/controller/whatsappGroupJoinerController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { getRandomDelayMs, sleep } from "../utils/whatsappHelper.js";

function extractInviteCode(linkOrCode) {
  if (!linkOrCode) return "";
  const match = String(linkOrCode).match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
  if (match) return match[1];
  const cleaned = String(linkOrCode).trim();
  if (/^[0-9A-Za-z]{20,24}$/.test(cleaned)) return cleaned;
  return cleaned;
}

/**
 * Sequentially joins WhatsApp groups via invite codes with human pacing.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {string[]} params.inviteLinks
 * @param {number} [params.minDelay=15]
 * @param {number} [params.maxDelay=40]
 * @returns {Promise<{results: object[], stats: object}>}
 */
export async function batchJoinGroups({ accountId, inviteLinks = [], minDelay = 15, maxDelay = 40 }) {
  if (!accountId) {
    const err = new Error("Account ID is required.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const st = getSessionStatus(accountId);
    const err = new Error(`WhatsApp account is not connected (${st.status}). Connect via QR code first.`);
    err.code = "NOT_CONNECTED";
    throw err;
  }

  const rawList = Array.isArray(inviteLinks) ? inviteLinks : [inviteLinks];
  const codes = rawList
    .map(extractInviteCode)
    .filter(Boolean);

  if (codes.length === 0) {
    throw new Error("Provide at least one valid WhatsApp group invite link or code.");
  }

  const results = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const inviteLink = `https://chat.whatsapp.com/${code}`;

    let groupInfo = null;
    try {
      groupInfo = await sock.groupGetInviteInfo(code).catch(() => null);
    } catch (_) {}

    try {
      const groupJid = await sock.groupAcceptInvite(code);

      results.push({
        code,
        inviteLink,
        subject: groupInfo?.subject || "Joined Group",
        groupJid: groupJid || null,
        status: "joined",
        message: "Successfully joined group.",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const errMsg = err.message || "";
      let status = "failed";
      let message = errMsg;

      if (errMsg.includes("already in group") || errMsg.includes("conflict")) {
        status = "already_member";
        message = "Already a participant in this group.";
      } else if (errMsg.includes("not-authorized") || errMsg.includes("404") || errMsg.includes("revoked")) {
        status = "revoked";
        message = "Invite link has been revoked or expired.";
      } else if (errMsg.includes("rate-overlimit")) {
        status = "rate_limited";
        message = "WhatsApp join limit reached. Pause and retry later.";
      }

      results.push({
        code,
        inviteLink,
        subject: groupInfo?.subject || "WhatsApp Group",
        groupJid: null,
        status,
        message,
        timestamp: new Date().toISOString(),
      });
    }

    // Delay between joins
    if (i < codes.length - 1) {
      const pauseMs = getRandomDelayMs(minDelay, maxDelay);
      await sleep(pauseMs);
    }
  }

  return {
    results,
    stats: {
      total: results.length,
      joined: results.filter((r) => r.status === "joined").length,
      alreadyMember: results.filter((r) => r.status === "already_member").length,
      failed: results.filter((r) => r.status === "failed" || r.status === "revoked").length,
    },
  };
}
