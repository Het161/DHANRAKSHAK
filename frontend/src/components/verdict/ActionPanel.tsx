"use client";

import { Button } from "@/components/ui/Button";
import { usePreferences } from "@/i18n/I18nProvider";
import type { AnalyzeResponse } from "@/lib/types";

const CYBERCRIME_HELPLINE = "tel:1930";
/** Chakshu, the Department of Telecommunications' fraud reporting portal. */
const CHAKSHU_URL = "https://sancharsaathi.gov.in/sfc/";

export function ActionPanel({
  response,
  onCheckAnother,
}: {
  response: AnalyzeResponse;
  onCheckAnother: () => void;
}) {
  const { t } = usePreferences();
  const risky = response.verdict !== "safe";

  const shareText = [
    t("actions.shareIntro"),
    t("actions.shareVerdict", {
      verdict: t(`verdict.${response.verdict}`),
      score: response.risk_score,
    }),
    risky ? t("actions.shareAdvice") : t("actions.shareAdviceSafe"),
  ].join(" ");

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring tap inline-flex items-center justify-center rounded-2xl border border-line-strong bg-surface px-5 py-3 text-base font-semibold text-ink"
      >
        {t("actions.askFamily")}
      </a>

      {risky && (
        <>
          <a
            href={CYBERCRIME_HELPLINE}
            className="focus-ring tap inline-flex items-center justify-center rounded-2xl border border-scam/25 bg-scam-tint px-5 py-3 text-base font-semibold text-scam"
          >
            {t("actions.call1930")}
          </a>
          <a
            href={CHAKSHU_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring tap inline-flex items-center justify-center rounded-2xl border border-line-strong bg-surface px-5 py-3 text-base font-semibold text-ink"
          >
            {t("actions.reportOnline")}
          </a>
        </>
      )}

      <Button variant="primary" onClick={onCheckAnother} block className={risky ? "" : "sm:col-span-1"}>
        {t("analyzer.checkAnother")}
      </Button>
    </div>
  );
}
