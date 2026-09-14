// src/utils/whatsappHelper.js

/**
 * Parses and resolves Spintax patterns: {optionA|optionB|optionC}
 * Supports nested spintax patterns as well.
 *
 * Example:
 * "{Hello|Hi|Greetings} {{name}}, {hope you are doing well|good day}!"
 */
export function parseSpintax(text) {
  if (!text || typeof text !== "string") return "";
  const spintaxRegex = /\{([^{}]+)\}/;
  let matches;
  let result = text;
  while ((matches = spintaxRegex.exec(result)) !== null) {
    const options = matches[1].split("|");
    const chosen = options[Math.floor(Math.random() * options.length)];
    result = result.replace(matches[0], chosen);
  }
  return result;
}

/**
 * Replaces {{field}} placeholders using row data, then applies Spintax parsing.
 * Supports exact match, case-insensitive match, and space/underscore normalized matching.
 */
export function renderWhatsappMessage(template, record = {}) {
  if (!template) return "";
  let rendered = template.replace(/\{\{\s*([\w.\s-]+?)\s*\}\}/g, (match, field) => {
    const trimmed = field.trim();
    if (record[trimmed] !== undefined && record[trimmed] !== null) {
      return String(record[trimmed]);
    }
    const normField = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
    const foundKey = Object.keys(record).find(
      (k) => k.toLowerCase().replace(/[\s_-]+/g, "") === normField
    );
    if (foundKey && record[foundKey] !== undefined && record[foundKey] !== null) {
      return String(record[foundKey]);
    }
    return "";
  });
  return parseSpintax(rendered);
}

/**
 * Formats any raw phone number into a valid WhatsApp JID:
 * <country_code><national_number>@s.whatsapp.net
 *
 * Handles:
 * - Local numbers with trunk 0 (e.g., 0771234567 with default CC 94 -> 94771234567)
 * - Numbers with +, spaces, hyphens, brackets
 * - Returns null if phone number does not have enough digits (min 7)
 */
export function formatToWhatsappJid(rawPhone, defaultCountryCode = "") {
  if (!rawPhone) return null;
  const str = String(rawPhone).trim();
  const hasPlus = str.startsWith("+");
  const digits = str.replace(/[^\d]/g, "");

  if (digits.length < 7) return null;

  let cleanedDigits = digits;
  const cc = String(defaultCountryCode || "").replace(/[^\d]/g, "");

  if (!hasPlus && cc && digits.startsWith("0") && digits.length <= 11) {
    cleanedDigits = `${cc}${digits.replace(/^0+/, "")}`;
  }

  return `${cleanedDigits}@s.whatsapp.net`;
}

/**
 * Extracts bare phone number from JID or raw string
 */
export function extractDigitsFromJid(jid) {
  if (!jid) return "";
  return String(jid).split("@")[0].replace(/[^\d]/g, "");
}

/**
 * Sleep helper for promise-based delays
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random integer delay between min and max seconds (in ms)
 */
export function getRandomDelayMs(minSeconds = 10, maxSeconds = 25) {
  const min = Math.max(1, Number(minSeconds) || 10);
  const max = Math.max(min, Number(maxSeconds) || 25);
  const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomSeconds * 1000;
}
