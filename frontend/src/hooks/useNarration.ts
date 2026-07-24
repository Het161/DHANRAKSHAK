"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSpeech } from "@/lib/api";
import { RECOGNITION_LOCALE } from "@/lib/speech";
import type { Language } from "@/lib/types";

/**
 * Reads onboarding text aloud.
 *
 * Prefers the server's neural voice (edge-tts), because the browser's built-in
 * Gujarati voice is poor-to-missing on most phones and desktops, while the neural
 * gu-IN voice is clear. It falls back to the browser voice when the API is down or
 * offline, so onboarding still narrates. Always cancels on unmount and on the next
 * `speak`, so moving between steps never leaves two voices talking.
 */
export function useNarration() {
  const [speaking, setSpeaking] = useState(false);
  const supportedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancelAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (supportedRef.current) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    supportedRef.current = typeof window !== "undefined" && "speechSynthesis" in window;
    return cancelAll;
  }, [cancelAll]);

  const stop = useCallback(() => {
    cancelAll();
    setSpeaking(false);
  }, [cancelAll]);

  // Offline / API-down fallback: the browser's own voice.
  const speakBrowser = useCallback((text: string, lang: Language) => {
    if (!supportedRef.current) {
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const locale = RECOGNITION_LOCALE[lang];
    const voice = window.speechSynthesis
      .getVoices()
      .find((candidate) => candidate.lang === locale || candidate.lang.startsWith(`${lang}-`));
    if (voice) utterance.voice = voice;
    utterance.lang = locale;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    (text: string, lang: Language) => {
      if (!text.trim()) return;
      cancelAll();
      setSpeaking(true);

      const controller = new AbortController();
      abortRef.current = controller;
      void fetchSpeech(text, lang, "female", controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          if (!blob) {
            speakBrowser(text, lang);
            return;
          }
          const audio = new Audio(URL.createObjectURL(blob));
          audioRef.current = audio;
          audio.addEventListener(
            "ended",
            () => {
              setSpeaking(false);
              URL.revokeObjectURL(audio.src);
            },
            { once: true },
          );
          audio.addEventListener("error", () => speakBrowser(text, lang), { once: true });
          void audio.play().catch(() => speakBrowser(text, lang));
        })
        .catch(() => {
          if (!controller.signal.aborted) speakBrowser(text, lang);
        });
    },
    [cancelAll, speakBrowser],
  );

  const toggle = useCallback(
    (text: string, lang: Language) => {
      if (speaking) {
        stop();
        return;
      }
      speak(text, lang);
    },
    [speaking, speak, stop],
  );

  return { speak, stop, toggle, speaking };
}
