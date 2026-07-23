"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { usePreferences } from "@/i18n/I18nProvider";
import type { AnalyzePhase } from "@/hooks/useAnalyze";
import type { MessageKey } from "@/i18n/dictionary";

function ShimmerLines() {
  return (
    <div className="mt-4 space-y-2" aria-hidden>
      <div className="shimmer h-3 w-3/4 rounded-full" />
      <div className="shimmer h-3 w-full rounded-full" />
      <div className="shimmer h-3 w-2/3 rounded-full" />
    </div>
  );
}

/**
 * A sleeping free-tier instance takes most of a minute to answer. Saying so
 * plainly, with visible progress, reads as reliability; an unexplained spinner
 * reads as broken.
 */
export function StatusPanel({
  phase,
  busyKey,
  errorMessage,
  onRetry,
}: {
  phase: AnalyzePhase;
  busyKey: MessageKey;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  const { t } = usePreferences();

  if (phase === "error") {
    return (
      <Card className="border-scam/20 bg-scam-tint">
        <p className="text-lg font-bold text-scam">{t("error.title")}</p>
        <p className="mt-1 leading-relaxed text-ink">{errorMessage ?? t("error.generic")}</p>
        <Button variant="primary" className="mt-4" onClick={onRetry}>
          {t("error.retry")}
        </Button>
      </Card>
    );
  }

  if (phase === "waking") {
    return (
      <Card aria-live="polite">
        <p className="text-lg font-bold text-ink">{t("status.wakingTitle")}</p>
        <p className="mt-1 leading-relaxed text-ink-soft">{t("status.wakingBody")}</p>
        <ShimmerLines />
      </Card>
    );
  }

  if (phase === "connecting") {
    return (
      <Card aria-live="polite">
        <p className="text-lg font-semibold text-ink">{t(busyKey)}</p>
        <ShimmerLines />
      </Card>
    );
  }

  return null;
}
