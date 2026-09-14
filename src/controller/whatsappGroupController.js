// src/controller/whatsappGroupController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { extractDigitsFromJid } from "../utils/whatsappHelper.js";

/**
 * Lists all groups the linked WhatsApp account is currently participating in.
 *
 * @param {string} accountId
 * @returns {Promise<Array<{id: string, subject: string, size: number, creation: string|null, desc: string, owner: string}>>}
 */
export async function getParticipatingGroups(accountId) {
  if (!accountId) {
    const err = new Error("Account ID is required.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const status = getSessionStatus(accountId);
    const err = new Error(
      `WhatsApp account is not connected (${status.status}). Please link via QR code in WhatsApp Accounts.`
    );
    err.code = "NOT_CONNECTED";
    throw err;
  }

  try {
    const rawGroups = await sock.groupFetchAllParticipating();
    const groups = Object.values(rawGroups || {}).map((g) => ({
      id: g.id,
      subject: g.subject || "Unnamed Group",
      size: g.size || (Array.isArray(g.participants) ? g.participants.length : 0),
      creation: g.creation ? new Date(g.creation * 1000).toISOString() : null,
      desc: g.desc ? g.desc.toString() : "",
      owner: g.owner ? extractDigitsFromJid(g.owner) : "",
      isCommunity: Boolean(g.isCommunity),
    }));

    // Sort alphabetically by group subject
    groups.sort((a, b) => a.subject.localeCompare(b.subject));
    return groups;
  } catch (err) {
    console.error(`Error fetching groups for ${accountId}:`, err.message);
    throw new Error(err.message || "Failed to fetch participating groups.");
  }
}

/**
 * Fetches group metadata and extracts sanitized participant list with admin indicators.
 *
 * @param {string} accountId
 * @param {string} groupId
 * @returns {Promise<{id: string, subject: string, desc: string, size: number, participants: Array<{id: string, phone: string, admin: string|null, isAdmin: boolean}>}>}
 */
export async function getGroupParticipants(accountId, groupId) {
  if (!accountId || !groupId) {
    const err = new Error("Account ID and Group ID are required.");
    err.code = "BAD_INPUT";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const status = getSessionStatus(accountId);
    const err = new Error(
      `WhatsApp account is not connected (${status.status}). Please link via QR code in WhatsApp Accounts.`
    );
    err.code = "NOT_CONNECTED";
    throw err;
  }

  try {
    const meta = await sock.groupMetadata(groupId);
    const participants = (meta.participants || []).map((p) => {
      const phone = extractDigitsFromJid(p.id);
      return {
        id: p.id,
        phone,
        admin: p.admin || null, // 'admin' | 'superadmin' | null
        isAdmin: Boolean(p.admin),
      };
    });

    // Sort admins first, then by phone number
    participants.sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return a.phone.localeCompare(b.phone);
    });

    return {
      id: meta.id,
      subject: meta.subject || "Unnamed Group",
      desc: meta.desc ? meta.desc.toString() : "",
      size: participants.length,
      participants,
    };
  } catch (err) {
    console.error(`Error fetching group metadata for ${groupId}:`, err.message);
    throw new Error(err.message || "Failed to fetch group participants.");
  }
}
