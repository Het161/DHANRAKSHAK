"use client";

import { flagTitle } from "@/components/verdict/EvidenceText";
import { usePreferences } from "@/i18n/I18nProvider";
import type { Coach } from "@/lib/types";

export function CoachCard({ coach }: { coach: Coach }) {
  const { t } = usePreferences();
  const good = coach.score_delta >= 0;

  return (
    <div
      className={`animate-slide-up mx-auto w-full rounded-2xl border p-4 ${
        good ? "border-safe/25 bg-safe-tint" : "border-suspicious/30 bg-suspicious-tint"
      }`}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={`text-sm font-bold tracking-wide uppercase ${good ? "text-safe" : "text-suspicious"}`}
        >
          {t("simulator.coach")}
        </p>
        {coach.score_delta !== 0 && (
          <span
            className={`rounded-full px-2.5 py-1 text-sm font-bold ${
              good ? "bg-safe text-white" : "bg-suspicious text-white"
            }`}
          >
            {coach.score_delta > 0 ? `+${coach.score_delta}` : coach.score_delta}
          </span>
        )}
      </div>

      {coach.tactic_revealed && (
        <p className="mt-2 text-sm font-semibold text-ink-soft">
          {t("simulator.tacticRevealed", { tactic: flagTitle(coach.tactic_revealed, t) })}
        </p>
      )}
      <p className="mt-1 leading-relaxed text-ink">{coach.tip}</p>
    </div>
  );
}
