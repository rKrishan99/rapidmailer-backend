// src/config/whatsappStore.js
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./dataDir.js";

const RULES_FILE = path.join(DATA_DIR, "auto_responder_rules.json");
const POLLS_FILE = path.join(DATA_DIR, "poll_store.json");

function safeReadJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠️ Error reading JSON from ${filePath}:`, err.message);
    return defaultValue;
  }
}

function safeWriteJson(filePath, data) {
  try {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.error(`⚠️ Error writing JSON to ${filePath}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Auto-Responder Rules
// ---------------------------------------------------------------------------

export function getAutoResponderRules() {
  return safeReadJson(RULES_FILE, []);
}

export function saveAutoResponderRule(rule) {
  const rules = getAutoResponderRules();
  const existingIdx = rules.findIndex((r) => r.id === rule.id);

  const formatted = {
    id: rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    keyword: (rule.keyword || "").trim(),
    matchType: ["exact", "contains", "regex"].includes(rule.matchType)
      ? rule.matchType
      : "contains",
    replyText: (rule.replyText || "").trim(),
    enabled: rule.enabled !== undefined ? Boolean(rule.enabled) : true,
    createdAt: rule.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    rules[existingIdx] = { ...rules[existingIdx], ...formatted };
  } else {
    rules.push(formatted);
  }

  safeWriteJson(RULES_FILE, rules);
  return formatted;
}

export function deleteAutoResponderRule(ruleId) {
  const rules = getAutoResponderRules();
  const filtered = rules.filter((r) => r.id !== ruleId);
  safeWriteJson(RULES_FILE, filtered);
  return { success: true };
}

export function toggleAutoResponderRule(ruleId, enabled) {
  const rules = getAutoResponderRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;
  rule.enabled = enabled !== undefined ? Boolean(enabled) : !rule.enabled;
  rule.updatedAt = new Date().toISOString();
  safeWriteJson(RULES_FILE, rules);
  return rule;
}

// ---------------------------------------------------------------------------
// Polls & Interactive Responses Store
// ---------------------------------------------------------------------------

export function getPollsStore() {
  return safeReadJson(POLLS_FILE, {});
}

export function registerPoll(pollData) {
  const store = getPollsStore();
  const { pollId, accountId, jid, question, options, pollEncKey, pollCreatorJid } = pollData;
  if (!pollId) return null;

  store[pollId] = {
    id: pollId,
    accountId: accountId || "default",
    jid,
    question,
    options: options || [],
    pollEncKey: pollEncKey
      ? Buffer.isBuffer(pollEncKey)
        ? pollEncKey.toString("base64")
        : typeof pollEncKey === "object"
        ? Buffer.from(Object.values(pollEncKey)).toString("base64")
        : String(pollEncKey)
      : null,
    pollCreatorJid: pollCreatorJid || null,
    votes: {},
    createdAt: new Date().toISOString(),
  };

  safeWriteJson(POLLS_FILE, store);
  return store[pollId];
}

export function recordPollVote(pollId, voterJid, voteData) {
  const store = getPollsStore();
  let poll = store[pollId];

  // If poll wasn't registered prior, create a placeholder
  if (!poll) {
    poll = {
      id: pollId,
      accountId: "unknown",
      question: "Interactive Poll",
      options: [],
      pollEncKey: null,
      pollCreatorJid: null,
      votes: {},
      createdAt: new Date().toISOString(),
    };
    store[pollId] = poll;
  }

  poll.votes = poll.votes || {};
  poll.votes[voterJid] = {
    voterJid,
    voterPhone: voterJid.split("@")[0].replace(/[^\d]/g, ""),
    voterName: voteData.voterName || null,
    selectedOptions: voteData.selectedOptions || [],
    selectedOptionNames: voteData.selectedOptionNames || [],
    timestamp: new Date().toISOString(),
  };

  safeWriteJson(POLLS_FILE, store);
  return poll;
}

export function getPollById(pollId) {
  const store = getPollsStore();
  return store[pollId] || null;
}

export function getAllPolls(accountId) {
  const store = getPollsStore();
  const list = Object.values(store);
  if (!accountId) return list;
  return list.filter((p) => p.accountId === accountId || p.accountId === "default");
}

// ---------------------------------------------------------------------------
// Contacts & Chats Cache
// ---------------------------------------------------------------------------

function getCachePath(accountId) {
  return path.join(DATA_DIR, `contacts_cache_${accountId}.json`);
}

export function getCachedContactsAndChats(accountId) {
  const filePath = getCachePath(accountId);
  return safeReadJson(filePath, { contacts: {}, chats: {} });
}

export function updateCachedContacts(accountId, newContacts = []) {
  if (!accountId || !Array.isArray(newContacts) || newContacts.length === 0) return;
  const current = getCachedContactsAndChats(accountId);
  for (const c of newContacts) {
    if (!c || !c.id) continue;
    const jid = c.id;
    const phone = jid.split("@")[0].replace(/[^\d]/g, "");
    current.contacts[jid] = {
      ...(current.contacts[jid] || {}),
      id: jid,
      phone,
      name: c.name || c.notify || c.verifiedName || current.contacts[jid]?.name || "",
      notify: c.notify || current.contacts[jid]?.notify || "",
      verifiedName: c.verifiedName || current.contacts[jid]?.verifiedName || "",
      updatedAt: new Date().toISOString(),
    };
  }
  safeWriteJson(getCachePath(accountId), current);
}

export function updateCachedChats(accountId, newChats = []) {
  if (!accountId || !Array.isArray(newChats) || newChats.length === 0) return;
  const current = getCachedContactsAndChats(accountId);
  for (const c of newChats) {
    if (!c || !c.id) continue;
    const jid = c.id;
    const isGroup = jid.endsWith("@g.us");
    current.chats[jid] = {
      ...(current.chats[jid] || {}),
      id: jid,
      name: c.name || current.chats[jid]?.name || (isGroup ? "Group Chat" : "Direct Chat"),
      unreadCount: c.unreadCount || 0,
      timestamp: c.conversationTimestamp
        ? typeof c.conversationTimestamp === "number"
          ? c.conversationTimestamp * 1000
          : Number(c.conversationTimestamp)
        : Date.now(),
      isGroup,
    };
  }
  safeWriteJson(getCachePath(accountId), current);
}

// ---------------------------------------------------------------------------
// Group Member Activity Tracking (for Active Members Grabber)
// ---------------------------------------------------------------------------

const GROUP_ACTIVITY_FILE = path.join(DATA_DIR, "group_member_activity.json");

export function getGroupMemberActivities(groupId) {
  const store = safeReadJson(GROUP_ACTIVITY_FILE, {});
  return store[groupId] || {};
}

export function recordGroupMemberActivity(groupId, senderJid, timestamp = Date.now()) {
  if (!groupId || !senderJid) return;
  const store = safeReadJson(GROUP_ACTIVITY_FILE, {});
  store[groupId] = store[groupId] || {};

  const current = store[groupId][senderJid] || { lastSeen: 0, messageCount: 0 };
  store[groupId][senderJid] = {
    lastSeen: Math.max(current.lastSeen, typeof timestamp === "number" ? timestamp : Date.now()),
    messageCount: (current.messageCount || 0) + 1,
  };

  safeWriteJson(GROUP_ACTIVITY_FILE, store);
}
