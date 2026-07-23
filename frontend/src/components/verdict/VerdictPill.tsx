"use client";

import { usePreferences } from "@/i18n/I18nProvider";
import type { Verdict } from "@/lib/types";

export const VERDICT_STYLES: Record<Verdict, { pill: string; bar: string; text: string }> = {
  safe: { pill: "bg-safe-tint text-safe border-safe/25", bar: "bg-safe", text: "text-safe" },
  suspicious: {
    pill: "bg-suspicious-tint text-suspicious border-suspicious/25",
    bar: "bg-suspicious",
    text: "text-suspicious",
  },
  scam: { pill: "bg-scam-tint text-scam border-scam/25", bar: "bg-scam", text: "text-scam" },
};

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const path =
    verdict === "safe"
      ? "M5 12.5l4.5 4.5L19 7.5"
      : verdict === "suspicious"
        ? "M12 7v6.5M12 17.2v.1"
        : "M7 7l10 10M17 7L7 17";
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 shrink-0">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const { t } = usePreferences();
  return (
    <p
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-bold ${VERDICT_STYLES[verdict].pill}`}
    >
      <VerdictIcon verdict={verdict} />
      {t(`verdict.${verdict}`)}
    </p>
  );
}
