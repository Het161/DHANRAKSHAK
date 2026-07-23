/** Input limits mirroring backend/app/config.py. Checked before upload so a
 *  user on a slow connection learns about an oversized file immediately. */

import type { MessageKey } from "@/i18n/dictionary";

export const MAX_TEXT_CHARS = 10_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 90;

export type Validation = { ok: true } | { ok: false; key: MessageKey };

export function validateText(value: string): Validation {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, key: "error.empty" };
  if (value.length > MAX_TEXT_CHARS) return { ok: false, key: "error.textTooLong" };
  return { ok: true };
}

export function validateImage(file: File): Validation {
  if (!file.type.startsWith("image/")) return { ok: false, key: "error.notImage" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, key: "error.imageTooLarge" };
  return { ok: true };
}

export function validateAudio(file: Blob): Validation {
  if (file.size === 0) return { ok: false, key: "error.empty" };
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, key: "error.audioTooLarge" };
  return { ok: true };
}
