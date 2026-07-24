"use client";

import { ActionPanel } from "@/components/verdict/ActionPanel";
import { EvidenceText, flagTitle } from "@/components/verdict/EvidenceText";
import { RiskMeter } from "@/components/verdict/RiskMeter";
import { VerdictPill } from "@/components/verdict/VerdictPill";
import { Card, CardTitle } from "@/components/ui/Card";
import { usePreferences } from "@/i18n/I18nProvider";
import type { AnalyzeState, SourceChip } from "@/hooks/useAnalyze";
import type { MessageKey } from "@/i18n/dictionary";
import type { Flag } from "@/lib/types";

const CHIP_LABEL: Record<SourceChip, MessageKey> = {
  instant: "verdict.chipInstant",
  offline: "verdict.chipOffline",
  serverAdded: "verdict.chipServerAdded",
  serverChecked: "verdict.chipServerChecked",
};

/** Honesty chip: says exactly which engine produced what is on screen. */
function SourceChip({ state }: { state: AnalyzeState }) {
  const { t } = usePreferences();
  const onDevice = state.chip === "instant" || state.chip === "offline";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
          onDevice ? "bg-brand-tint text-brand-dark" : "bg-safe-tint text-safe"
        }`}
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${onDevice ? "bg-brand" : "bg-safe"}`} />
        {t(CHIP_LABEL[state.chip])}
      </span>
      {state.serverPending && (
        <span className="text-sm text-ink-faint">
          {state.waking ? t("verdict.serverWaking") : t("verdict.serverPending")}
        </span>
      )}
    </div>
  );
}

function FlagList({ flags }: { flags: Flag[] }) {
  const { t } = usePreferences();
  if (flags.length === 0) return null;

  return (
    <Card>
      <CardTitle>{t("verdict.flagsTitle")}</CardTitle>
      <ul className="space-y-4">
        {flags.map((flag) => (
          <li key={`${flag.kind}:${flag.name}`} className="border-l-2 border-line pl-4">
            <p className="font-bold text-ink">{flagTitle(flag.name, t)}</p>
            <p className="mt-1 leading-relaxed text-ink-soft">{flag.detail}</p>
            {flag.action && (
              <p className="mt-1 leading-relaxed font-semibold text-brand-dark">{flag.action}</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function VerdictCard({
  state,
  onCheckAnother,
}: {
  state: AnalyzeState;
  onCheckAnother: () => void;
}) {
  const { t } = usePreferences();
  const response = state.verdict;
  if (!response) return null;

  const spanned = response.flags.some((flag) => flag.evidence_span !== null);

  return (
    <div className="animate-slide-up space-y-4">
      <Card className="space-y-5">
        <VerdictPill verdict={response.verdict} />
        <RiskMeter score={response.risk_score} verdict={response.verdict} />
        <SourceChip state={state} />
        {state.divergent && state.serverRisk !== null && state.localRisk !== null && (
          <p className="rounded-xl bg-suspicious-tint px-3 py-2 text-sm leading-relaxed text-suspicious">
            {t("verdict.serverAdjusted", { serverRisk: state.serverRisk, localRisk: state.localRisk })}
          </p>
        )}
      </Card>

      {response.analyzed_text && (
        <Card>
          <CardTitle>
            {spanned ? t("verdict.evidenceTitle") : t("verdict.transcriptTitle")}
          </CardTitle>
          <EvidenceText text={response.analyzed_text} flags={response.flags} />
        </Card>
      )}

      <Card>
        <CardTitle>{t("verdict.whyTitle")}</CardTitle>
        <p
          className={`text-base leading-loose whitespace-pre-wrap text-ink ${
            state.isRefining ? "stream-caret" : ""
          }`}
        >
          {state.explanation}
        </p>
        <p className="mt-3 text-sm text-ink-faint">
          {state.isRefining
            ? t("verdict.refining")
            : state.explanationSource === "llm"
              ? t("verdict.sourceLlm")
              : state.explanationSource === "on-device"
                ? t("verdict.sourceOnDevice")
                : t("verdict.sourceTemplate")}
        </p>
      </Card>

      <FlagList flags={response.flags} />

      {response.advisory && (
        <Card className="border-brand/20 bg-brand-tint">
          <CardTitle>{t("verdict.advisoryTitle")}</CardTitle>
          <p className="text-base leading-relaxed text-ink">{response.advisory.snippet}</p>
          <p className="mt-3 text-sm font-semibold text-brand-dark">
            {response.advisory.source}
            <span className="ml-2 font-normal text-ink-faint">{response.advisory.ref}</span>
          </p>
        </Card>
      )}

      {response.actions.length > 0 && (
        <Card>
          <CardTitle>{t("verdict.actionsTitle")}</CardTitle>
          <ol className="space-y-3">
            {response.actions.map((action, index) => (
              <li key={action} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-bold text-brand"
                >
                  {index + 1}
                </span>
                <span className="leading-relaxed text-ink">{action}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ActionPanel response={response} onCheckAnother={onCheckAnother} />
    </div>
  );
}
