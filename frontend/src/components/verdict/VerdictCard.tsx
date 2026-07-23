"use client";

import { ActionPanel } from "@/components/verdict/ActionPanel";
import { EvidenceText, flagTitle } from "@/components/verdict/EvidenceText";
import { RiskMeter } from "@/components/verdict/RiskMeter";
import { VerdictPill } from "@/components/verdict/VerdictPill";
import { Card, CardTitle } from "@/components/ui/Card";
import { usePreferences } from "@/i18n/I18nProvider";
import type { AnalyzeState } from "@/hooks/useAnalyze";
import type { Flag } from "@/lib/types";

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
