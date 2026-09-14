// src/controller/whatsappPollController.js
import crypto from "node:crypto";
import { decryptPollVote } from "@whiskeysockets/baileys";
import {
  getPollById,
  getAllPolls,
  recordPollVote,
  registerPoll,
} from "../config/whatsappStore.js";
import { extractDigitsFromJid } from "../utils/whatsappHelper.js";

/**
 * Computes SHA256 buffer for a poll option string as used by WhatsApp protocol.
 */
function hashOption(optionName) {
  return crypto.createHash("sha256").update(Buffer.from(optionName || "", "utf8")).digest();
}

/**
 * Handles incoming poll vote update events from Baileys messages.upsert.
 *
 * @param {object} params
 * @param {string} params.accountId
 * @param {object} params.sock
 * @param {object} params.msg  Baileys WAMessage
 */
export async function handleIncomingPollUpdate({ accountId, sock, msg }) {
  if (!msg?.message?.pollUpdateMessage) return;

  const pollUpdate = msg.message.pollUpdateMessage;
  const pollKey = pollUpdate.pollCreationMessageKey;
  if (!pollKey?.id) return;

  const pollId = pollKey.id;
  const poll = getPollById(pollId);

  // Identify the voter
  const voterJid = msg.key.participant || msg.key.remoteJid || "";
  const voterPhone = extractDigitsFromJid(voterJid);
  const voterName = msg.pushName || null;

  let selectedOptionNames = [];
  let selectedOptionHashes = [];

  try {
    if (pollUpdate.vote?.encPayload && pollUpdate.vote?.encIv) {
      // If we have registered encryption keys for this poll, decrypt the vote
      if (poll?.pollEncKey) {
        const pollEncKeyBuf = Buffer.isBuffer(poll.pollEncKey)
          ? poll.pollEncKey
          : Buffer.from(poll.pollEncKey, "base64");

        const pollCreatorJid = poll.pollCreatorJid || sock?.user?.id || pollKey.participant || "";

        const decryptedVote = decryptPollVote(
          {
            encPayload: Buffer.from(pollUpdate.vote.encPayload),
            encIv: Buffer.from(pollUpdate.vote.encIv),
          },
          {
            pollCreatorJid,
            pollMsgId: pollId,
            pollEncKey: pollEncKeyBuf,
            voterJid,
          }
        );

        if (decryptedVote?.selectedOptions) {
          selectedOptionHashes = decryptedVote.selectedOptions.map((opt) =>
            Buffer.from(opt).toString("hex")
          );

          // Map hashes back to option names
          if (Array.isArray(poll.options)) {
            for (const optionName of poll.options) {
              const expectedHex = hashOption(optionName).toString("hex");
              if (selectedOptionHashes.includes(expectedHex)) {
                selectedOptionNames.push(optionName);
              }
            }
          }
        }
      }
    } else if (pollUpdate.vote?.selectedOptions) {
      // In some unencrypted/forwarded payloads, selected options might be directly available
      selectedOptionNames = pollUpdate.vote.selectedOptions.map((o) => o.toString());
    }

    // Record the vote
    recordPollVote(pollId, voterJid, {
      voterName,
      selectedOptions: selectedOptionHashes,
      selectedOptionNames,
    });

    console.log(
      `📊 Poll vote received from +${voterPhone} for poll "${poll?.question || pollId}": [${selectedOptionNames.join(
        ", "
      )}]`
    );
  } catch (err) {
    console.warn(`⚠️ Failed to decrypt or parse poll vote for ${pollId} from ${voterPhone}:`, err.message);
    // Still record participation even if option decryption was unavailable
    recordPollVote(pollId, voterJid, {
      voterName,
      selectedOptions: [],
      selectedOptionNames: ["(Voted)"],
    });
  }
}

/**
 * Returns all polls with vote aggregation summaries.
 */
export function getPollsList(accountId) {
  const polls = getAllPolls(accountId);

  return polls.map((poll) => {
    const votes = poll.votes || {};
    const totalVotes = Object.keys(votes).length;

    // Aggregate counts per option
    const optionCounts = (poll.options || []).map((opt) => {
      const votersForOption = Object.values(votes).filter((v) =>
        v.selectedOptionNames.includes(opt)
      );
      return {
        name: opt,
        count: votersForOption.length,
        voters: votersForOption.map((v) => ({
          phone: v.voterPhone,
          name: v.voterName,
          timestamp: v.timestamp,
        })),
      };
    });

    return {
      id: poll.id,
      accountId: poll.accountId,
      question: poll.question,
      options: poll.options,
      totalVotes,
      optionCounts,
      createdAt: poll.createdAt,
    };
  });
}

/**
 * Returns detailed voter list and stats for a specific poll.
 */
export function getPollAnalytics(pollId) {
  const poll = getPollById(pollId);
  if (!poll) return null;

  const votes = poll.votes || {};
  const voterList = Object.values(votes).map((v) => ({
    phone: v.voterPhone,
    name: v.voterName || "WhatsApp User",
    selectedOptions: v.selectedOptionNames,
    timestamp: v.timestamp,
  }));

  const optionCounts = (poll.options || []).map((opt) => {
    const matching = voterList.filter((v) => v.selectedOptions.includes(opt));
    return {
      name: opt,
      count: matching.length,
      percentage: voterList.length > 0 ? Math.round((matching.length / voterList.length) * 100) : 0,
      voters: matching,
    };
  });

  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    totalRespondents: voterList.length,
    optionCounts,
    voters: voterList,
    createdAt: poll.createdAt,
  };
}

export { registerPoll };
