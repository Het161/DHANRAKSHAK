"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { dictionaries, type MessageKey } from "./dictionary";

import {
  dismissPracticeTip,
  getServerSnapshot,
  getSnapshot,
  setElderMode,
  setLanguage,
  signalFirstAnalysis,
  subscribe,
  type PracticeTip,
} from "@/lib/preferences";
import type { Language } from "@/lib/types";

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface PreferencesValue {
  lang: Language;
  setLang: (lang: Language) => void;
  elder: boolean;
  setElder: (elder: boolean) => void;
  hasChosenLanguage: boolean;
  practiceTip: PracticeTip;
  signalFirstAnalysis: () => void;
  dismissPracticeTip: () => void;
  t: Translate;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = prefs.lang;
  }, [prefs.lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("elder", prefs.elder);
  }, [prefs.elder]);

  const t = useCallback<Translate>(
    (key, params) => {
      const template = dictionaries[prefs.lang][key] ?? dictionaries.en[key];
      // Returning the key lets callers that build keys from backend codes detect
      // a miss and fall back to a humanized label.
      if (template === undefined) return key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [prefs.lang],
  );

  const value = useMemo<PreferencesValue>(
    () => ({
      lang: prefs.lang,
      setLang: setLanguage,
      elder: prefs.elder,
      setElder: setElderMode,
      hasChosenLanguage: prefs.hasChosenLanguage,
      practiceTip: prefs.practiceTip,
      signalFirstAnalysis,
      dismissPracticeTip,
      t,
    }),
    [prefs.lang, prefs.elder, prefs.hasChosenLanguage, prefs.practiceTip, t],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside I18nProvider");
  return value;
}
