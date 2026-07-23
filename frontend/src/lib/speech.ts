import type { Language } from "@/lib/types";

/**
 * Minimal typings for the Web Speech API, which TypeScript's DOM library still
 * does not ship. Only the surface this app uses is declared.
 */
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/** BCP-47 tags the recogniser expects, per session language. */
export const RECOGNITION_LOCALE: Record<Language, string> = {
  gu: "gu-IN",
  hi: "hi-IN",
  en: "en-IN",
};

export function speechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const scope = window as unknown as SpeechWindow;
  return Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
}

export function createRecognition(lang: Language): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as SpeechWindow;
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = RECOGNITION_LOCALE[lang];
  recognition.continuous = true;
  // Interim results are what make barge-in possible: they fire while the user
  // is still talking, long before the final transcript.
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}
