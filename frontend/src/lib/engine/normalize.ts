/**
 * Port of backend/app/pipelines/normalize.py and language.py.
 *
 * Evidence spans index into the cleaned text, so the client must clean a message
 * exactly as the server does or the highlights land on the wrong characters.
 */

import type { Language, LanguageHint } from "@/lib/types";

// Built from \u escapes (pure-ASCII source, no invisible characters here):
// zero-width and bidi controls; C0/C1 controls; unicode spaces; blank-line runs.
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]", "g");
const CONTROL = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]", "g");
const WHITESPACE = new RegExp("[ \\t\\u00a0\\u2000-\\u200a\\u202f\\u205f\\u3000]+", "g");
const BLANK_LINES = /\n{3,}/g;

export function cleanText(raw: string): string {
  let text = raw.normalize("NFC");
  text = text.replace(INVISIBLE, "");
  text = text.replace(CONTROL, " ");
  text = text.replace(WHITESPACE, " ");
  text = text.replace(BLANK_LINES, "\n\n");
  return text.trim();
}

// Script ranges settle Gujarati and Hindi without any model.
const GUJARATI_MIN = 0x0a80;
const GUJARATI_MAX = 0x0aff;
const DEVANAGARI_MIN = 0x0900;
const DEVANAGARI_MAX = 0x097f;
const SCRIPT_SHARE = 0.15;

function scriptLanguage(text: string): Language | null {
  let letters = 0;
  let gujarati = 0;
  let devanagari = 0;
  for (const char of text) {
    // Cheap isalpha() stand-in: only letters count toward the script share.
    if (!/\p{L}/u.test(char)) continue;
    letters += 1;
    const code = char.codePointAt(0)!;
    if (code >= GUJARATI_MIN && code <= GUJARATI_MAX) gujarati += 1;
    else if (code >= DEVANAGARI_MIN && code <= DEVANAGARI_MAX) devanagari += 1;
  }
  if (letters === 0) return null;
  if (gujarati / letters >= SCRIPT_SHARE) return "gu";
  if (devanagari / letters >= SCRIPT_SHARE) return "hi";
  return null;
}

/**
 * Resolve the language to answer in.
 *
 * An explicit hint wins, exactly like the server. On "auto" the script ranges
 * settle Gujarati and Hindi; romanized Hinglish resolves to English, which is
 * the server's outcome too. The one divergence from the server is its langdetect
 * pass over romanized Indic text - rare, and almost never reached because the
 * analyzer passes the user's chosen language as the hint.
 */
export function detectLanguage(text: string, hint: LanguageHint = "auto"): Language {
  if (hint !== "auto") return hint;
  return scriptLanguage(text) ?? "en";
}
