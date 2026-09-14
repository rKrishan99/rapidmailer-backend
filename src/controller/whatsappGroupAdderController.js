// src/controller/whatsappGroupAdderController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { formatToWhatsappJid, extractDigitsFromJid, sleep } from "../utils/whatsappHelper.js";

/**
 * Bulk adds contact numbers to a WhatsApp group where the account has admin permissions.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {string} params.groupId
 * @param {Array<{phone: string, [key: string]: any}>} params.recipients
 * @param {number} [params.batchSize=5]
 * @param {number} [params.delaySeconds=8]
 * @returns {Promise<{results: object[], stats: object}>}
 */
export async function bulkAddGroupParticipants({
  accountId,
  groupId,
  recipients = [],
  batchSize = 5,
  delaySeconds = 8,
}) {
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

  // 1. Verify admin permissions
  const meta = await sock.groupMetadata(groupId);
  const myJid = sock.user?.id || "";
  const myPhone = extractDigitsFromJid(myJid);

  const myParticipant = (meta.participants || []).find(
    (p) => p.id === myJid || extractDigitsFromJid(p.id) === myPhone
  );

  if (!myParticipant || !myParticipant.admin) {
    throw new Error(
      `Your account is not an admin in "${meta.subject}". Only group administrators can add new participants.`
    );
  }

  const results = [];
  const chunkSize = Math.min(Math.max(Number(batchSize) || 5, 1), 10);
  const validRecipients = recipients.filter((r) => r.phone);

  for (let i = 0; i < validRecipients.length; i += chunkSize) {
    const batch = validRecipients.slice(i, i + chunkSize);
    const batchJids = [];
    const itemMap = new Map();

    for (const item of batch) {
      const jid = formatToWhatsappJid(item.phone);
      if (jid) {
        batchJids.push(jid);
        itemMap.set(jid, item);
      } else {
        results.push({
          ...item,
          status: "invalid_phone",
          message: "Unrecognized phone number format.",
        });
      }
    }

    if (batchJids.length > 0) {
      try {
        const outcomes = await sock.groupParticipantsUpdate(groupId, batchJids, "add");

        if (Array.isArray(outcomes)) {
          for (const outcome of outcomes) {
            const original = itemMap.get(outcome.jid) || { phone: outcome.jid };
            const statusCode = String(outcome.status);

            let status = "failed";
            let message = `Status ${statusCode}`;

            if (statusCode === "200") {
              status = "added";
              message = "Added to group successfully.";
            } else if (statusCode === "403" || statusCode === "408") {
              status = "privacy_restricted";
              message = "Participant privacy settings prevent direct adding.";
            } else if (statusCode === "409") {
              status = "already_member";
              message = "Already in group.";
            }

            results.push({
              ...original,
              status,
              statusCode,
              message,
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          // If response isn't array, assume added
          for (const jid of batchJids) {
            const original = itemMap.get(jid) || { phone: jid };
            results.push({
              ...original,
              status: "added",
              message: "Added to group.",
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error("Error adding participants batch:", err.message);
        for (const jid of batchJids) {
          const original = itemMap.get(jid) || { phone: jid };
          results.push({
            ...original,
            status: "failed",
            message: err.message || "Failed to add to group.",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Delay between participant batches
    if (i + chunkSize < validRecipients.length) {
      await sleep(Math.max(3, Number(delaySeconds) || 8) * 1000);
    }
  }

  return {
    groupSubject: meta.subject,
    results,
    stats: {
      total: results.length,
      added: results.filter((r) => r.status === "added").length,
      privacyRestricted: results.filter((r) => r.status === "privacy_restricted").length,
      alreadyMember: results.filter((r) => r.status === "already_member").length,
      failed: results.filter((r) => r.status === "failed" || r.status === "invalid_phone").length,
    },
  };
}
