// src/controller/whatsappGroupCreatorController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { formatToWhatsappJid, sleep } from "../utils/whatsappHelper.js";

/**
 * Batch generates multiple WhatsApp groups with customizable title patterns and shareable invite links.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {string} params.titleTemplate e.g. "VIP Deals #{{n}}"
 * @param {number} [params.count=3]
 * @param {string[]} [params.initialParticipants=[]] At least 1 participant or self
 * @param {number} [params.delaySeconds=5]
 * @returns {Promise<{groups: object[], stats: object}>}
 */
export async function batchCreateGroups({
  accountId,
  titleTemplate = "VIP Community #{{n}}",
  count = 3,
  initialParticipants = [],
  delaySeconds = 5,
}) {
  if (!accountId) {
    const err = new Error("Account ID is required.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const sock = getActiveSocket(accountId);
  if (!sock) {
    const st = getSessionStatus(accountId);
    const err = new Error(`WhatsApp account is not connected (${st.status}).`);
    err.code = "NOT_CONNECTED";
    throw err;
  }

  const numGroups = Math.min(Math.max(Number(count) || 1, 1), 20);

  // WhatsApp group creation requires participants.
  // If user provided custom phone numbers, map them; otherwise use creator account JID
  const myJid = sock.user?.id || "";
  let participants = (initialParticipants || [])
    .map(formatToWhatsappJid)
    .filter(Boolean);

  if (participants.length === 0 && myJid) {
    participants = [myJid];
  }

  const createdGroups = [];

  for (let i = 1; i <= numGroups; i++) {
    // Generate title
    let groupTitle = titleTemplate.includes("{{n}}")
      ? titleTemplate.replace(/\{\{n\}\}/g, String(i))
      : `${titleTemplate} (${i})`;

    // WhatsApp group titles have a max 25 character limit
    groupTitle = groupTitle.slice(0, 25);

    try {
      const groupInfo = await sock.groupCreate(groupTitle, participants);
      const groupId = groupInfo.id;

      // Automatically generate invite link
      let inviteCode = "";
      let inviteLink = "";
      try {
        inviteCode = await sock.groupInviteCode(groupId);
        inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
      } catch (inviteErr) {
        console.warn(`Could not generate invite code for ${groupId}:`, inviteErr.message);
      }

      createdGroups.push({
        id: groupId,
        title: groupTitle,
        inviteCode,
        inviteLink,
        creationStatus: "created",
        createdAt: new Date().toISOString(),
      });

      console.log(`✅ Created group "${groupTitle}" (${groupId}) -> ${inviteLink}`);
    } catch (err) {
      console.error(`Failed to create group "${groupTitle}":`, err.message);
      createdGroups.push({
        id: null,
        title: groupTitle,
        inviteCode: null,
        inviteLink: null,
        creationStatus: "failed",
        error: err.message || "Failed to create group",
        createdAt: new Date().toISOString(),
      });
    }

    // Delay between creations
    if (i < numGroups) {
      await sleep(Math.max(3, Number(delaySeconds) || 5) * 1000);
    }
  }

  return {
    groups: createdGroups,
    stats: {
      requested: numGroups,
      created: createdGroups.filter((g) => g.creationStatus === "created").length,
      failed: createdGroups.filter((g) => g.creationStatus === "failed").length,
    },
  };
}
