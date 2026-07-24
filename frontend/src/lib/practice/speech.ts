/**
 * On-device speech for offline practice.
 *
 * Uses the browser's speechSynthesis, which runs locally on most phones, so the
 * scammer's lines can be heard with no network and no server TTS. Best-effort: if
 * a voice for the language is unavailable, it stays silent rather than erroring.
 */

import type { Language } from "@/lib/types";

const LOCALE: Record<Language, string> = { gu: "gu-IN", hi: "hi-IN", en: "en-IN" };

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: Language): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const locale = LOCALE[lang];
  return (
    voices.find((v) => v.lang === locale) ??
    voices.find((v) => v.lang.startsWith(lang)) ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export function speak(text: string, lang: Language): void {
  if (!speechSupported() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LOCALE[lang];
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
