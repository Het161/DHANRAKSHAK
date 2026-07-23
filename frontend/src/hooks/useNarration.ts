"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RECOGNITION_LOCALE } from "@/lib/speech";
import type { Language } from "@/lib/types";

/**
 * Reads onboarding text aloud with the browser's own voice.
 *
 * Many target users read poorly, so every step can be spoken. There is no
 * backend dependency: onboarding narrates even with the API down. It fails
 * silently where speech synthesis is missing, and always cancels on unmount and
 * on the next `speak`, so moving between steps never leaves two voices talking.
 */
export function useNarration() {
  const [speaking, setSpeaking] = useState(false);
  const supportedRef = useRef(false);

  useEffect(() => {
    supportedRef.current =
      typeof window !== "undefined" && "speechSynthesis" in window;
    return () => {
      if (supportedRef.current) window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (supportedRef.current) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, lang: Language) => {
      if (!supportedRef.current || !text.trim()) return;
      // Cancel first: overlapping utterances are the usual cause of speech that
      // never starts on Chrome.
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

      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [],
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
