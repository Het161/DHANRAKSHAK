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
 * Local-first means the text path shows a verdict almost instantly, so this panel
 * only ever fills the gap for the server-only inputs (screenshot, recording),
 * which must wait on OCR/STT and a possibly-sleeping instance. Once a verdict is
 * on screen, every wait becomes a quiet note inside the card, never a blocker.
 */
export function StatusPanel({
  phase,
  busyKey,
  errorMessage,
  onRetry,
  waking,
  hasVerdict,
}: {
  phase: AnalyzePhase;
  busyKey: MessageKey;
  errorMessage: string | null;
  onRetry: () => void;
  waking: boolean;
  hasVerdict: boolean;
}) {
  const { t } = usePreferences();

  if (phase === "error" && !hasVerdict) {
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

  // Only the server-only inputs reach here with nothing on screen yet.
  if ((phase === "local" || phase === "serverPending") && !hasVerdict) {
    return (
      <Card aria-live="polite">
        <p className="text-lg font-bold text-ink">{waking ? t("status.wakingTitle") : t(busyKey)}</p>
        {waking && <p className="mt-1 leading-relaxed text-ink-soft">{t("status.wakingBody")}</p>}
        <ShimmerLines />
      </Card>
    );
  }

  return null;
}
