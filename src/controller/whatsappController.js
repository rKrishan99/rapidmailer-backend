import axios from "axios";
import { getWhatsappAccount, updateWhatsappAccount } from "../config/settingsStore.js";

// WhatsApp Business Cloud API (Meta's official API — not an unofficial
// QR-linked client). Every call here talks to graph.facebook.com using the
// access token + phone number id of ONE saved account (RapidMailer supports
// connecting several — one per client/project — and every call into this
// module is told which account to use via an accountId; there is no single
// global "the" WhatsApp connection).
//
// IMPORTANT LIMITATION, by design of the official API (confirmed against
// Meta's current docs while building this): there is no endpoint that lets
// you ask "does this phone number have WhatsApp?" for an arbitrary number.
// That lookup only exists on unofficial client libraries that impersonate a
// real WhatsApp app — which is exactly the ToS-violating, ban-prone approach
// this project deliberately avoided. The closest the official API offers is
// this: attempt to send, and read the per-recipient result. A number that
// isn't on WhatsApp (or is malformed) comes back as a rejection — usually
// immediately in this same response, occasionally only later as a delivery
// webhook this app doesn't yet receive (that would need a public HTTPS
// endpoint registered with Meta, which is a separate setup step). So instead
// of a separate "checker" tool that can't really check anything, the one
// Bulk Sender tool reports Accepted / Rejected (+ reason) per recipient —
// that IS the check, it just happens at send time rather than before it.

function graphBaseUrl(apiVersion) {
  return `https://graph.facebook.com/${apiVersion || "v22.0"}`;
}

// Normalizes a phone number to the digits-only, country-code-prefixed shape
// the Graph API expects (no "+", no spaces/dashes/parens). Returns null if
// there aren't enough digits left to plausibly be a phone number.
//
// CSVs exported from Google Maps (or typed by hand) very often use LOCAL
// format with a trunk "0" and no country code at all (e.g. "077 123 4567"
// for a Sri Lankan number) — WhatsApp requires the full international
// number with no leading 0. When `defaultCountryCode` is given (digits
// only, e.g. "94"), a number that starts with a single leading 0 has that
// 0 stripped and the country code prepended. A number that already starts
// with "+" or already looks long enough to include a country code (11+
// digits) is left as-is.
export function normalizeWhatsappNumber(raw, defaultCountryCode) {
  if (!raw) return null;
  const hasPlus = String(raw).trim().startsWith("+");
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length < 7) return null;

  if (hasPlus) return digits;

  const cc = (defaultCountryCode || "").replace(/[^\d]/g, "");
  if (cc && digits.startsWith("0") && digits.length <= 11) {
    return `${cc}${digits.replace(/^0+/, "")}`;
  }

  return digits;
}

export async function fetchWhatsappSenderInfo({ accessToken, phoneNumberId, apiVersion }) {
  const url = `${graphBaseUrl(apiVersion)}/${phoneNumberId}`;
  const response = await axios.get(url, {
    params: { fields: "display_phone_number,verified_name" },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status >= 200 && response.status < 300) {
    return {
      ok: true,
      displayPhoneNumber: response.data.display_phone_number || "",
      verifiedName: response.data.verified_name || "",
    };
  }

  const message =
    response.data?.error?.error_user_msg ||
    response.data?.error?.message ||
    `Meta API returned ${response.status}`;
  return { ok: false, error: message };
}

// Tests a connection — either a not-yet-saved draft (accessToken +
// phoneNumberId passed directly, used by "Test" before "Add Account") or an
// already-saved account (accountId, optionally with fields to override,
// used by "Re-test" on a saved card). On success, caches the verified
// display name/number back onto the saved account (if there is one) so the
// UI can show "Connected as <name> · <number>" without re-calling Meta on
// every load.
export async function testWhatsappConnection(draft = {}) {
  const stored = draft.accountId ? getWhatsappAccount(draft.accountId) : null;
  const creds = {
    accessToken: draft.accessToken || stored?.accessToken,
    phoneNumberId: draft.phoneNumberId || stored?.phoneNumberId,
    apiVersion: draft.apiVersion || stored?.apiVersion,
  };

  if (!creds.accessToken || !creds.phoneNumberId) {
    return { ok: false, error: "Access token and Phone Number ID are both required." };
  }

  const info = await fetchWhatsappSenderInfo(creds);
  if (info.ok && draft.accountId) {
    updateWhatsappAccount(draft.accountId, {
      verifiedDisplayName: info.verifiedName,
      verifiedPhoneNumber: info.displayPhoneNumber,
    });
  }
  return info;
}

async function sendOne({ accessToken, phoneNumberId, apiVersion }, payload) {
  const url = `${graphBaseUrl(apiVersion)}/${phoneNumberId}/messages`;
  const response = await axios.post(
    url,
    { messaging_product: "whatsapp", ...payload },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
      validateStatus: () => true,
    }
  );

  if (response.status >= 200 && response.status < 300) {
    const messageId = response.data?.messages?.[0]?.id || null;
    return { status: "sent", messageId };
  }

  const err = response.data?.error || {};
  return {
    status: "failed",
    errorCode: err.code ?? null,
    error: err.error_user_msg || err.message || `Meta API returned ${response.status}`,
  };
}

// Builds the Graph API message body for either a pre-approved template
// (required for business-initiated / cold outreach — this is the mode used
// for a bulk send to leads who haven't messaged you first) or plain text
// (only actually deliverable inside the 24h window after a customer messages
// you first — kept here for completeness/replies, not for bulk sending).
function buildMessagePayload(to, message) {
  if (message.mode === "text") {
    return { to, type: "text", text: { body: message.text || "" } };
  }

  const parameters = (message.bodyParams || [])
    .filter((v) => v !== undefined && v !== null && String(v).length > 0)
    .map((v) => ({ type: "text", text: String(v) }));

  return {
    to,
    type: "template",
    template: {
      name: message.templateName,
      language: { code: message.templateLanguage || "en_US" },
      ...(parameters.length > 0 ? { components: [{ type: "body", parameters }] } : {}),
    },
  };
}

/**
 * Sends one message per recipient, in batches with a delay between batches —
 * the same shape as the app's other bulk tools (Email Finder, Social
 * Enricher), but with the batch size / delay exposed as user-adjustable
 * settings here specifically because WhatsApp accounts can be flagged or
 * banned for bursty, spam-shaped sending. Slower and smaller batches are
 * safer.
 *
 * @param {Array<{phone: string, [key: string]: any}>} recipients - each row
 *   must carry a phone number under `phone` (already resolved by the caller
 *   via flexible column detection) plus whatever fields the template needs.
 * @param {{mode: 'template'|'text', templateName?, templateLanguage?, bodyParamFields?: string[], text?}} message
 * @param {{accountId: string, batchSize?: number, delayMs?: number, defaultCountryCode?: string}} options
 */
export async function sendBulkWhatsapp(recipients, message, options = {}) {
  if (!options.accountId) {
    const err = new Error("Pick which connected WhatsApp account to send from.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const account = getWhatsappAccount(options.accountId);
  if (!account || !account.accessToken || !account.phoneNumberId) {
    const err = new Error("That WhatsApp account isn't connected. Connect it from the sidebar first.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const batchSize = Math.min(Math.max(Number(options.batchSize) || 5, 1), 20);
  const delayMs = Math.min(Math.max(Number(options.delayMs) || 2000, 500), 60000);

  const creds = {
    accessToken: account.accessToken,
    phoneNumberId: account.phoneNumberId,
    apiVersion: account.apiVersion,
  };

  const results = new Array(recipients.length);

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (recipient, offset) => {
        const index = i + offset;
        const to = normalizeWhatsappNumber(recipient.phone, options.defaultCountryCode);
        if (!to) {
          return { ...recipient, status: "failed", error: "No usable phone number on this row" };
        }

        const bodyParams =
          message.mode === "template"
            ? (message.bodyParamFields || []).map((field) => recipient[field] ?? "")
            : [];

        const payload = buildMessagePayload(to, {
          mode: message.mode,
          templateName: message.templateName,
          templateLanguage: message.templateLanguage,
          bodyParams,
          text: message.text,
        });

        const outcome = await sendOne(creds, payload);
        return { ...recipient, ...outcome };
      })
    );

    batchResults.forEach((r, offset) => {
      results[i + offset] = r;
    });

    if (i + batchSize < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
