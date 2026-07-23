"use client";

import { useState } from "react";

import { SpeakerButton } from "@/components/onboarding/SpeakerButton";
import { useNarration } from "@/hooks/useNarration";
import { LANGUAGE_ORDER } from "@/i18n/dictionary";
import { usePreferences } from "@/i18n/I18nProvider";
import { GREETINGS } from "@/lib/onboardingContent";
import type { Language } from "@/lib/types";

const NATIVE_NAME: Record<Language, string> = {
  gu: "ગુજરાતી",
  hi: "हिन्दी",
  en: "English",
};

export function LanguageStep({ onChoose }: { onChoose: (lang: Language) => void }) {
  const { setLang } = usePreferences();
  const { toggle, speaking, stop } = useNarration();
  // Which card last requested speech. Paired with `speaking`, so the highlight
  // clears on its own when narration ends, no effect needed.
  const [speakingLang, setSpeakingLang] = useState<Language | null>(null);

  const hearGreeting = (lang: Language) => {
    if (speakingLang === lang && speaking) {
      stop();
      setSpeakingLang(null);
      return;
    }
    setSpeakingLang(lang);
    toggle(GREETINGS[lang], lang);
  };

  const choose = (lang: Language) => {
    stop();
    setLang(lang);
    onChoose(lang);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-base leading-relaxed text-ink-soft">
        ભાષા પસંદ કરો&nbsp;·&nbsp;भाषा चुनें&nbsp;·&nbsp;Choose your language
      </p>

      {LANGUAGE_ORDER.map((lang, index) => (
        <div
          key={lang}
          className={`animate-slide-up flex items-center gap-3 rounded-3xl border-2 bg-surface p-2 pr-3 transition-colors ${
            index === 0 ? "border-brand" : "border-line"
          }`}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <button
            type="button"
            onClick={() => choose(lang)}
            className="focus-ring flex-1 rounded-2xl px-4 py-6 text-left text-3xl font-bold text-ink"
          >
            {NATIVE_NAME[lang]}
          </button>
          <SpeakerButton
            speaking={speakingLang === lang && speaking}
            onToggle={() => hearGreeting(lang)}
            label={NATIVE_NAME[lang]}
          />
        </div>
      ))}
    </div>
  );
}
