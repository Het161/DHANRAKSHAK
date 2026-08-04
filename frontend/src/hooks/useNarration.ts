"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSpeech, pingHealth } from "@/lib/api";
import { RECOGNITION_LOCALE } from "@/lib/speech";
import type { Language } from "@/lib/types";

// A tiny (0.05s) silent WAV. Playing it inside the click handler "unlocks" the
// <audio> element within the user gesture, so the real speech can start later -
// after the fetch - without the browser blocking it as unsolicited autoplay.
const SILENT_CLIP =
  "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

/**
 * Reads onboarding text aloud.
 *
 * Prefers the server's neural voice (edge-tts), because the browser's built-in
 * Gujarati voice is poor-to-missing on most phones and desktops, while the neural
 * gu-IN voice is clear. It falls back to the browser voice only when the API is
 * down or offline.
 *
 * The subtle part is autoplay: the speech arrives from an async fetch, and browsers
 * refuse to *start* audio that first plays outside the click's user-gesture window
 * (worse when a cold server takes seconds to answer). So we unlock a reusable
 * <audio> element with a silent clip the instant the button is pressed, and only
 * swap in the fetched speech when it lands - which then plays freely.
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
    // Wake a possibly-sleeping speech backend early, so the first "Listen" tap gets
    // audio back quickly rather than after a 30s cold start.
    void pingHealth(4_000);
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

      // Unlock an audio element NOW, inside the user gesture, with a silent clip.
      const audio = new Audio(SILENT_CLIP);
      audio.preload = "auto";
      audioRef.current = audio;
      void audio.play().catch(() => {});

      const controller = new AbortController();
      abortRef.current = controller;
      void fetchSpeech(text, lang, "female", controller.signal)
        .then((blob) => {
          if (controller.signal.aborted || audioRef.current !== audio) return;
          if (!blob) {
            speakBrowser(text, lang);
            return;
          }
          const url = URL.createObjectURL(blob);
          audio.addEventListener(
            "ended",
            () => {
              setSpeaking(false);
              URL.revokeObjectURL(url);
            },
            { once: true },
          );
          audio.addEventListener(
            "error",
            () => {
              URL.revokeObjectURL(url);
              speakBrowser(text, lang);
            },
            { once: true },
          );
          // Swap the silent clip for the fetched speech on the already-unlocked
          // element, so it plays without needing a fresh user gesture.
          audio.src = url;
          void audio.play().catch(() => {
            URL.revokeObjectURL(url);
            speakBrowser(text, lang);
          });
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
