"use client";

import { usePreferences } from "@/i18n/I18nProvider";
import { VERDICT_STYLES } from "@/components/verdict/VerdictPill";
import type { Verdict } from "@/lib/types";

export function RiskMeter({ score, verdict }: { score: number; verdict: Verdict }) {
  const { t } = usePreferences();
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-bold tracking-wide text-ink-soft uppercase">
          {t("verdict.risk")}
        </span>
        <span className={`text-sm font-bold ${VERDICT_STYLES[verdict].text}`}>
          {t("verdict.riskOf100", { score: clamped })}
        </span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("verdict.risk")}
      >
        <div
          className={`animate-meter h-full rounded-full transition-[width] duration-700 ease-out ${VERDICT_STYLES[verdict].bar}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
