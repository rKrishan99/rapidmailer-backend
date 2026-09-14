// src/controller/whatsappWarmerController.js
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { formatToWhatsappJid, getRandomDelayMs, sleep } from "../utils/whatsappHelper.js";

const PRELOADED_SCRIPTS = {
  casual: [
    { sender: 0, text: "Hey! How are things going today?" },
    { sender: 1, text: "Hey! Pretty good, just catching up on a few tasks. How about you?" },
    { sender: 0, text: "Same here, wrapping up a few project milestones before the weekend." },
    { sender: 1, text: "Sounds productive! Let me know if you want to grab coffee or jump on a quick call later." },
    { sender: 0, text: "Definitely! Let's touch base in an hour or two." },
    { sender: 1, text: "Perfect, talk soon! 👍" },
  ],
  business: [
    { sender: 0, text: "Good morning! Just reviewing the proposal you shared yesterday." },
    { sender: 1, text: "Good morning! Thanks for checking it. Did you have any questions on the delivery timeline?" },
    { sender: 0, text: "The milestones look solid. Can we lock in the scope for Phase 1 by Tuesday?" },
    { sender: 1, text: "Yes, that works on our end. I will send over the confirmation document shortly." },
    { sender: 0, text: "Appreciate the quick turnaround! Looking forward to kicking this off." },
    { sender: 1, text: "Glad to collaborate. Have a great rest of your day!" },
  ],
  support: [
    { sender: 0, text: "Hello, checking in regarding the system update scheduled for this evening." },
    { sender: 1, text: "Hi! All backup instances are prepped and the migration scripts passed verification." },
    { sender: 0, text: "Great news. Expected downtime should be under 5 minutes, correct?" },
    { sender: 1, text: "Yes, exactly. We'll monitor live metrics right after deployment." },
    { sender: 0, text: "Understood. Thanks for keeping everything running smoothly." },
    { sender: 1, text: "Always happy to help!" },
  ],
};

let warmerState = {
  running: false,
  accountIds: [],
  minDelay: 25,
  maxDelay: 75,
  theme: "casual",
  customScript: [],
  currentScriptIndex: 0,
  logs: [],
  stats: {
    totalExchanged: 0,
    startedAt: null,
  },
  timer: null,
};

function logWarmerEvent(event) {
  warmerState.logs.unshift({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...event,
  });
  if (warmerState.logs.length > 50) warmerState.logs.pop();
}

async function warmerStep() {
  if (!warmerState.running) return;

  const { accountIds, theme, customScript } = warmerState;
  if (accountIds.length < 2) {
    logWarmerEvent({ type: "error", message: "Needs at least 2 connected accounts to continue." });
    stopWarmer();
    return;
  }

  // Get active script
  const script = customScript.length > 0 ? customScript : (PRELOADED_SCRIPTS[theme] || PRELOADED_SCRIPTS.casual);
  const turn = script[warmerState.currentScriptIndex % script.length];
  warmerState.currentScriptIndex++;

  const senderAccId = accountIds[turn.sender % accountIds.length];
  const receiverAccId = accountIds[(turn.sender + 1) % accountIds.length];

  const senderSock = getActiveSocket(senderAccId);
  const receiverStatus = getSessionStatus(receiverAccId);

  if (!senderSock) {
    logWarmerEvent({
      type: "warn",
      message: `Account ${senderAccId} is currently disconnected. Retrying next round...`,
    });
    scheduleNextStep();
    return;
  }

  const receiverPhone = receiverStatus.user?.phone;
  if (!receiverPhone) {
    logWarmerEvent({
      type: "warn",
      message: `Could not determine phone number for receiver ${receiverAccId}.`,
    });
    scheduleNextStep();
    return;
  }

  const receiverJid = formatToWhatsappJid(receiverPhone);

  try {
    // 1. Simulate human presence ('composing' for 2-4s)
    try {
      await senderSock.sendPresenceUpdate("composing", receiverJid);
      await sleep(Math.floor(Math.random() * 2000) + 2000);
      await senderSock.sendPresenceUpdate("paused", receiverJid);
    } catch (_) {}

    // 2. Dispatch warm text
    await senderSock.sendMessage(receiverJid, { text: turn.text });
    warmerState.stats.totalExchanged++;

    logWarmerEvent({
      type: "message",
      from: senderStatusName(senderAccId),
      to: senderStatusName(receiverAccId),
      text: turn.text,
      message: `Sent: "${turn.text}" (+${senderPhoneFromId(senderAccId)} → +${receiverPhone})`,
    });
  } catch (err) {
    logWarmerEvent({
      type: "error",
      message: `Failed to exchange message: ${err.message}`,
    });
  }

  scheduleNextStep();
}

function senderStatusName(accountId) {
  const s = getSessionStatus(accountId);
  return s.user?.name || s.user?.phone || accountId;
}

function senderPhoneFromId(accountId) {
  const s = getSessionStatus(accountId);
  return s.user?.phone || "";
}

function scheduleNextStep() {
  if (!warmerState.running) return;
  const delayMs = getRandomDelayMs(warmerState.minDelay, warmerState.maxDelay);
  warmerState.timer = setTimeout(warmerStep, delayMs);
}

export function startWarmer({ accountIds, minDelay = 25, maxDelay = 75, theme = "casual", customScript = [] }) {
  if (!Array.isArray(accountIds) || accountIds.length < 2) {
    throw new Error("Select at least 2 connected WhatsApp accounts to start the warming exchange.");
  }

  // Verify accounts are connected
  for (const accId of accountIds) {
    const sock = getActiveSocket(accId);
    if (!sock) {
      const st = getSessionStatus(accId);
      throw new Error(`Account ${accId} is not connected (${st.status}). Connect it first.`);
    }
  }

  stopWarmer();

  warmerState = {
    running: true,
    accountIds,
    minDelay: Math.max(10, Number(minDelay) || 25),
    maxDelay: Math.max(20, Number(maxDelay) || 75),
    theme,
    customScript: Array.isArray(customScript) ? customScript : [],
    currentScriptIndex: 0,
    logs: [],
    stats: {
      totalExchanged: 0,
      startedAt: new Date().toISOString(),
    },
    timer: null,
  };

  logWarmerEvent({
    type: "info",
    message: `Warming engine started across ${accountIds.length} accounts (${warmerState.minDelay}s–${warmerState.maxDelay}s randomized delay).`,
  });

  // Kick off first step
  scheduleNextStep();

  return getWarmerStatus();
}

export function stopWarmer() {
  if (warmerState.timer) {
    clearTimeout(warmerState.timer);
    warmerState.timer = null;
  }
  const wasRunning = warmerState.running;
  warmerState.running = false;

  if (wasRunning) {
    logWarmerEvent({
      type: "info",
      message: `Warming engine stopped. Total messages exchanged: ${warmerState.stats.totalExchanged}.`,
    });
  }

  return getWarmerStatus();
}

export function getWarmerStatus() {
  return {
    running: warmerState.running,
    accountIds: warmerState.accountIds,
    minDelay: warmerState.minDelay,
    maxDelay: warmerState.maxDelay,
    theme: warmerState.theme,
    stats: warmerState.stats,
    logs: warmerState.logs,
  };
}
