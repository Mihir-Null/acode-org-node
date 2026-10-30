// Writing what org-node writes: new notes, their file names, id: links.
//
// A note created on the phone should be indistinguishable from one made by
// SPC n f in kittymacs, so each function here mirrors a named upstream one.

import { linkDisplayFormat } from "./org.js";

/**
 * org-node-slugify-for-web: "Löb's Theorem" -> "lobs-theorem".
 *
 * Step by step, as upstream does it:
 *   1. show links as their descriptions (org-link-display-format);
 *   2. decompose characters (NFD) so "ö" becomes "o" + a combining mark,
 *      drop the marks U+0300..U+0331, and compose again (NFC);
 *   3. lower-case and trim;
 *   4. runs of whitespace become "-";
 *   5. everything but letters, digits, "/" and "-" is dropped
 *      (Emacs' [:alnum:] is Unicode-aware, hence \p{L} and \p{N});
 *   6. "/" becomes "-", runs of "-" collapse, and leading/trailing "-" go.
 */
export function slugifyForWeb(title) {
  return linkDisplayFormat(title)
    .normalize("NFD")
    .replace(/[̀-̱]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}/-]/gu, "")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/** org-node-title-to-basename with an empty timestamp format. */
export function titleToFileName(title) {
  const slug = slugifyForWeb(title);
  return `${slug || "untitled"}.org`;
}

/**
 * A random (version 4) UUID, lower-case, as org-id-new makes with
 * org-id-method `uuid'.  crypto.randomUUID needs a secure context, which a
 * WebView may not be, so fall back to getRandomValues.
 */
export function newId(crypto = globalThis.crypto) {
  if (crypto?.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // not a secure context
    }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");

/**
 * An inactive Org timestamp with time, in local time:
 * (org-time-stamp-format t t) is "[%Y-%m-%d %a %H:%M]".
 */
export function inactiveTimestamp(date = new Date()) {
  return (
    `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${DAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}]`
  );
}

/**
 * The text of a new file note, as org-node-new-file writes it and then
 * org-node-creation-hook completes it (org-node-ensure-crtime-property adds
 * :CREATED:).  Property names are padded the way org-entry-put does
 * (org-property-format "%-10s %s").
 */
export function newNoteText(title, id, date = new Date()) {
  return [
    ":PROPERTIES:",
    `${":ID:".padEnd(10)} ${id}`,
    `${":CREATED:".padEnd(10)} ${inactiveTimestamp(date)}`,
    ":END:",
    `#+title: ${title}`,
    "",
  ].join("\n");
}

/**
 * [[id:ID][DESCRIPTION]].  A description cannot contain "]]" or end in "]",
 * which would close the link early, so those brackets become braces.
 */
export function makeIdLink(id, description) {
  const desc = (description ?? "").replace(/\]\]/g, "]}").replace(/\]$/, "}").replace(/\s*\n\s*/g, " ").trim();
  return desc ? `[[id:${id}][${desc}]]` : `[[id:${id}]]`;
}
