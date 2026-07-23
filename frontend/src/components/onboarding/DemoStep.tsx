"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SpeakerButton } from "@/components/onboarding/SpeakerButton";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { flagTitle } from "@/components/verdict/EvidenceText";
import { RiskMeter } from "@/components/verdict/RiskMeter";
import { VerdictPill } from "@/components/verdict/VerdictPill";
import { useNarration } from "@/hooks/useNarration";
import { usePreferences } from "@/i18n/I18nProvider";
import { demoResult } from "@/lib/onboardingContent";
import { segmentByFlags } from "@/lib/spans";

// Stage 0 idle, 1 verdict+meter, 2..4 each flag, 5 advisory. Named so the
// reveal reads top to bottom.
const STAGE_FINAL = 5;
const STAGE_INTERVAL_MS = 850;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function DemoStep({ onNext }: { onNext: () => void }) {
  const { t, lang } = usePreferences();
  const { toggle, speaking, stop } = useNarration();
  const result = useMemo(() => demoResult(lang), [lang]);

  const [stage, setStage] = useState(0);
  const [meterScore, setMeterScore] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);
  useEffect(() => stop, [stop]);

  const run = useCallback(() => {
    clearTimers();
    stop();
    if (prefersReducedMotion()) {
      setStage(STAGE_FINAL);
      setMeterScore(result.risk);
      return;
    }
    setStage(1);
    setMeterScore(0);
    // Let the bar mount at zero, then sweep, so the width transition plays.
    timersRef.current.push(setTimeout(() => setMeterScore(result.risk), 60));
    for (let next = 2; next <= STAGE_FINAL; next += 1) {
      timersRef.current.push(
        setTimeout(() => setStage(next), STAGE_INTERVAL_MS * (next - 1)),
      );
    }
  }, [clearTimers, result.risk, stop]);

  const revealed = Math.max(0, Math.min(stage - 1, result.flags.length));
  const segments = useMemo(
    () => segmentByFlags(result.sms, result.flags.slice(0, revealed)),
    [result.sms, result.flags, revealed],
  );

  return (
    <div className="flex flex-col gap-4">
      <PhoneFrame sender={result.sender}>
        <p className="text-base leading-relaxed break-words whitespace-pre-wrap">
          {stage === 0
            ? result.sms
            : segments.map((segment) =>
                segment.flags.length === 0 ? (
                  <span key={segment.start}>{segment.text}</span>
                ) : (
                  <mark
                    key={segment.start}
                    className="animate-pulse-once -mx-0.5 rounded-md bg-scam-tint px-0.5 text-scam underline decoration-scam/50 decoration-2 underline-offset-4"
                  >
                    {segment.text}
                  </mark>
                ),
              )}
        </p>
      </PhoneFrame>

      {stage === 0 ? (
        <Button variant="primary" block onClick={run}>
          {t("onb.demo.checkButton")}
        </Button>
      ) : (
        <>
          <Card className="animate-slide-up space-y-4">
            <VerdictPill verdict={result.verdict} />
            <RiskMeter score={meterScore} verdict={result.verdict} />
          </Card>

          {revealed > 0 && (
            <Card className="space-y-3">
              {result.flags.slice(0, revealed).map((flag) => (
                <div key={flag.name} className="animate-slide-up border-l-2 border-scam/30 pl-3">
                  <p className="font-bold text-scam">{flagTitle(flag.name, t)}</p>
                  <p className="mt-0.5 leading-relaxed text-ink-soft">{flag.detail}</p>
                </div>
              ))}
            </Card>
          )}

          {stage >= STAGE_FINAL && (
            <Card className="animate-slide-up border-brand/20 bg-brand-tint">
              <CardTitle>{t("verdict.advisoryTitle")}</CardTitle>
              <p className="leading-relaxed text-ink">{result.advisory.snippet}</p>
              <p className="mt-3 text-sm font-semibold text-brand-dark">
                {result.advisory.source}
                <span className="ml-2 font-normal text-ink-faint">{result.advisory.ref}</span>
              </p>
            </Card>
          )}
        </>
      )}

      <p className="text-center leading-relaxed font-medium text-ink-soft">
        {t("onb.demo.caption")}
      </p>

      <div className="flex items-center justify-center">
        <SpeakerButton speaking={speaking} onToggle={() => toggle(t("onb.demo.narration"), lang)} />
      </div>

      {stage >= STAGE_FINAL && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={run}>
            {t("onb.demo.replay")}
          </Button>
          <Button variant="primary" onClick={onNext}>
            {t("onb.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

function PhoneFrame({ sender, children }: { sender: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xs rounded-[2rem] border-4 border-ink/80 bg-ink/80 p-2 shadow-lg">
      <div className="overflow-hidden rounded-[1.5rem] bg-paper">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-tint text-sm font-bold text-brand">
            {sender.slice(0, 2)}
          </span>
          <span className="text-sm font-semibold text-ink">{sender}</span>
        </div>
        <div className="p-3">
          <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-line bg-surface p-3 text-ink">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
