"use client";

import { useEffect } from "react";

import { SpeakerButton } from "@/components/onboarding/SpeakerButton";
import { Button } from "@/components/ui/Button";
import { useNarration } from "@/hooks/useNarration";
import { usePreferences } from "@/i18n/I18nProvider";

export function PromiseStep({ onNext }: { onNext: () => void }) {
  const { t, lang } = usePreferences();
  const { toggle, speaking, stop } = useNarration();

  const spoken = `${t("onb.promise.title")} ${t("onb.promise.sub")}`;

  useEffect(() => stop, [stop]);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="animate-onb-shield flex h-28 w-28 items-center justify-center rounded-full bg-brand-tint">
        <svg viewBox="0 0 24 24" aria-hidden className="h-16 w-16 text-brand">
          <path
            d="M12 2.5 4.5 5.6v5.9c0 4.6 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.3 7.5-9.9V5.6L12 2.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="m8.5 12 2.5 2.5 4.5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="text-2xl leading-snug font-bold text-ink">{t("onb.promise.title")}</h1>
      <p className="text-lg leading-relaxed text-ink-soft">{t("onb.promise.sub")}</p>

      <SpeakerButton speaking={speaking} onToggle={() => toggle(spoken, lang)} />

      <Button variant="primary" block onClick={onNext}>
        {t("onb.next")}
      </Button>
    </div>
  );
}
