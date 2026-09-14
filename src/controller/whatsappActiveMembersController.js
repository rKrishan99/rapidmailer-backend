// src/controller/whatsappActiveMembersController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { getGroupMemberActivities } from "../config/whatsappStore.js";
import { extractDigitsFromJid } from "../utils/whatsappHelper.js";

/**
 * Scans group members and filters out inactive/ghost members based on recorded message activity.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {string} params.groupId
 * @param {number} [params.days=7] Timeframe in days (e.g. 1 for 24h, 7, 30)
 * @returns {Promise<object>}
 */
export async function getActiveGroupMembers({ accountId, groupId, days = 7 }) {
  if (!accountId || !groupId) {
    const err = new Error("Account ID and Group ID are required.");
    err.code = "BAD_INPUT";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const st = getSessionStatus(accountId);
    const err = new Error(`WhatsApp account is not connected (${st.status}).`);
    err.code = "NOT_CONNECTED";
    throw err;
  }

  const metadata = await sock.groupMetadata(groupId);
  const participants = metadata.participants || [];
  const activities = getGroupMemberActivities(groupId);

  const cutoffMs = Date.now() - (Number(days) || 7) * 24 * 60 * 60 * 1000;

  const enrichedMembers = participants.map((p) => {
    const phone = extractDigitsFromJid(p.id);
    const activity = activities[p.id] || activities[`${phone}@s.whatsapp.net`] || {
      lastSeen: 0,
      messageCount: 0,
    };

    const isActive = activity.lastSeen >= cutoffMs;

    return {
      id: p.id,
      phone,
      admin: p.admin || null,
      isAdmin: Boolean(p.admin),
      lastSeen: activity.lastSeen ? new Date(activity.lastSeen).toISOString() : null,
      messageCount: activity.messageCount || 0,
      isActive,
    };
  });

  // Filter only active members or tag them
  const activeMembers = enrichedMembers.filter((m) => m.isActive);
  const inactiveMembers = enrichedMembers.filter((m) => !m.isActive);

  // Sort active members by most recent message, then admins
  activeMembers.sort((a, b) => {
    const timeA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
    const timeB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
    return timeB - timeA;
  });

  return {
    groupId: metadata.id,
    subject: metadata.subject || "Unnamed Group",
    timeframeDays: Number(days) || 7,
    totalMembers: participants.length,
    activeCount: activeMembers.length,
    inactiveCount: inactiveMembers.length,
    activeMembers,
    allMembers: enrichedMembers,
  };
}
