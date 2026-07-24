"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { usePreferences } from "@/i18n/I18nProvider";
import type { AnalyzePhase, ImageStage } from "@/hooks/useAnalyze";
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

/** OCR could not read the screenshot; steer the user to the instant paste path. */
function OcrFailedCard({ onPasteText }: { onPasteText: () => void }) {
  const { t } = usePreferences();
  return (
    <Card className="border-suspicious/20 bg-suspicious-tint">
      <p className="text-lg font-bold text-ink">{t("ocr.failedTitle")}</p>
      <p className="mt-1 leading-relaxed text-ink-soft">{t("ocr.failedBody")}</p>
      <Button variant="primary" className="mt-4" onClick={onPasteText}>
        {t("ocr.pasteText")}
      </Button>
    </Card>
  );
}

/**
 * Local-first means the text path shows a verdict almost instantly, so this panel
 * only ever fills the gap for the server-only inputs (screenshot, recording),
 * which must prepare, wake a sleeping instance, upload, then wait on OCR/STT.
 * Once a verdict is on screen, every wait becomes a quiet note inside the card.
 */
export function StatusPanel({
  phase,
  busyKey,
  errorMessage,
  onRetry,
  waking,
  hasVerdict,
  imageStage,
  ocrFailed,
  onPasteText,
}: {
  phase: AnalyzePhase;
  busyKey: MessageKey;
  errorMessage: string | null;
  onRetry: () => void;
  waking: boolean;
  hasVerdict: boolean;
  imageStage: ImageStage;
  ocrFailed: boolean;
  onPasteText: () => void;
}) {
  const { t } = usePreferences();

  if (ocrFailed && !hasVerdict) return <OcrFailedCard onPasteText={onPasteText} />;

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

  const busy = phase === "preparing" || phase === "local" || phase === "serverPending";
  if (busy && !hasVerdict) {
    // Staged copy so the (slower) screenshot wait reads as intentional, not stuck.
    const titleKey: MessageKey = waking
      ? "status.wakingTitle"
      : phase === "preparing"
        ? "status.preparing"
        : imageStage === "uploading"
          ? "status.uploading"
          : imageStage === "reading"
            ? "status.reading"
            : busyKey;
    return (
      <Card aria-live="polite">
        <p className="text-lg font-bold text-ink">{t(titleKey)}</p>
        {waking && <p className="mt-1 leading-relaxed text-ink-soft">{t("status.wakingBody")}</p>}
        <ShimmerLines />
      </Card>
    );
  }

  return null;
}
