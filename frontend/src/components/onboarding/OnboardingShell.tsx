"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { DemoStep } from "@/components/onboarding/DemoStep";
import { HowToStep } from "@/components/onboarding/HowToStep";
import { LanguageStep } from "@/components/onboarding/LanguageStep";
import { PromiseStep } from "@/components/onboarding/PromiseStep";
import { usePreferences } from "@/i18n/I18nProvider";
import { setOnboarded } from "@/lib/preferences";

const TOTAL_STEPS = 4;

/** Small shield lockup, shown at the top of every step. */
function BrandMark() {
  const { t } = usePreferences();
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 text-brand">
        <path
          d="M12 2.5 4.5 5.6v5.9c0 4.6 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.3 7.5-9.9V5.6L12 2.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-bold tracking-tight text-ink">{t("app.name")}</span>
    </span>
  );
}

export function OnboardingShell() {
  const router = useRouter();
  const { t } = usePreferences();
  const [step, setStep] = useState(0);

  const finish = useCallback(() => {
    setOnboarded();
    // replace, so the browser back button never returns to onboarding.
    router.replace("/");
  }, [router]);

  const next = useCallback(() => setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1)), []);
  const back = useCallback(() => setStep((current) => Math.max(current - 1, 0)), []);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-md flex-col">
      <div className="flex items-center justify-between gap-3 py-2">
        {step > 0 ? (
          <button
            type="button"
            onClick={back}
            className="focus-ring rounded-xl px-2 py-1 text-sm font-semibold text-ink-soft"
          >
            {t("onb.back")}
          </button>
        ) : (
          <BrandMark />
        )}

        <div
          className="flex items-center gap-2"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={t("onb.stepOf", { n: step + 1, total: TOTAL_STEPS })}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <span
              key={index}
              aria-hidden
              className={`h-2 rounded-full transition-all ${
                index === step ? "w-6 bg-brand" : "w-2 bg-line-strong"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={finish}
          className="focus-ring rounded-xl px-2 py-1 text-sm font-semibold text-ink-soft"
        >
          {t("onb.skip")}
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center py-4">
        {step === 0 && <LanguageStep onChoose={next} />}
        {step === 1 && <PromiseStep onNext={next} />}
        {step === 2 && <DemoStep onNext={next} />}
        {step === 3 && <HowToStep onFinish={finish} />}
      </div>
    </div>
  );
}
