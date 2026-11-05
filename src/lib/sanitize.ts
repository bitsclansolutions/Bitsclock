/**
 * Input hygiene shared by the browser forms and the API (no server-only imports).
 *
 * SQL injection is prevented structurally: every query goes through Prisma, which
 * sends values as bound parameters, never as SQL text (the codebase has no
 * $queryRaw / $executeRaw). These helpers add the second layer: each field is
 * normalised and checked for the exact shape we expect before it touches the
 * database or the DOM.
 */

// C0/C1 control characters except tab, newline and carriage return, plus Unicode
// line/paragraph separators (U+2028/2029) and bidi override marks (U+202A-202E,
// U+2066-2069) that can disguise text. Built from code points so no editor can
// turn the escapes into real characters.
const INVISIBLE = [0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => String.fromCodePoint(c)).join("");
const CONTROL = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F" + INVISIBLE + "]", "g");

/** Single-line text: NFC-normalised, control characters removed, whitespace collapsed, trimmed. */
export function cleanText(value: string) {
  return value.normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

/** Multi-line text: like cleanText but keeps newlines (runs of blank lines capped at two). */
export function cleanMultiline(value: string) {
  return value
    .normalize("NFC")
    .replace(CONTROL, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanEmail(value: string) {
  return cleanText(value).toLowerCase();
}

/** Prisma cuid: "c" followed by 20-32 lowercase base-36 characters. */
export const CUID_RE = /^c[a-z0-9]{20,32}$/;
export function isCuid(value: unknown): value is string {
  return typeof value === "string" && CUID_RE.test(value);
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Deliberately conservative email shape: one @, no spaces, dotted domain. */
export const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Letters, digits, spaces and a few punctuation marks: enough for names, titles and role names. */
export const NAME_RE = /^[\p{L}\p{M}\p{N} .,'&()/-]+$/u;

export const LIMITS = {
  name: 80,
  email: 254,
  jobTitle: 80,
  projectName: 80,
  projectDescription: 1000,
  roleName: 50,
  roleDescription: 300,
  entryDescription: 500,
  password: 128,
  search: 100,
} as const;

/** Safe redirect target: a same-origin path only (no protocol-relative "//evil.com"). */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\x00-\x1F]/.test(value)) return fallback;
  return value.length > 500 ? fallback : value;
}
