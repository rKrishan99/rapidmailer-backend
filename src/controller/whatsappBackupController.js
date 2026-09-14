// src/controller/whatsappBackupController.js
import { getCachedContactsAndChats } from "../config/whatsappStore.js";
import { getActiveSocket, getSessionStatus } from "./whatsappSessionManager.js";
import { extractDigitsFromJid } from "../utils/whatsappHelper.js";

/**
 * Returns all cached WhatsApp contacts and active chats for the given account.
 *
 * @param {string} accountId
 * @returns {Promise<{contacts: Array<object>, chats: Array<object>, stats: object}>}
 */
export async function getAccountChatsAndContacts(accountId) {
  if (!accountId) {
    const err = new Error("Account ID is required.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const { contacts: cachedContacts, chats: cachedChats } = getCachedContactsAndChats(accountId);

  // If active socket is available, also incorporate current user's profile info
  const sock = getActiveSocket(accountId);
  const sessionStatus = getSessionStatus(accountId);

  const contactList = Object.values(cachedContacts || {}).map((c) => {
    const phone = extractDigitsFromJid(c.id);
    return {
      id: c.id,
      phone,
      name: c.name || c.notify || c.verifiedName || `+${phone}`,
      notify: c.notify || "",
      verifiedName: c.verifiedName || "",
      updatedAt: c.updatedAt || new Date().toISOString(),
    };
  });

  const chatList = Object.values(cachedChats || {}).map((ch) => ({
    id: ch.id,
    name: ch.name || ch.id,
    unreadCount: ch.unreadCount || 0,
    timestamp: ch.timestamp ? new Date(ch.timestamp).toISOString() : null,
    isGroup: Boolean(ch.isGroup),
  }));

  // Sort contacts alphabetically
  contactList.sort((a, b) => a.name.localeCompare(b.name));
  // Sort chats by most recent activity
  chatList.sort((a, b) => (new Date(b.timestamp || 0)) - (new Date(a.timestamp || 0)));

  return {
    accountId,
    accountStatus: sessionStatus.status,
    accountUser: sessionStatus.user,
    contacts: contactList,
    chats: chatList,
    stats: {
      totalContacts: contactList.length,
      totalChats: chatList.length,
      directChats: chatList.filter((c) => !c.isGroup).length,
      groupChats: chatList.filter((c) => c.isGroup).length,
    },
  };
}
