"use client";

import { useMemo, useState } from "react";

import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";
import { segmentByFlags } from "@/lib/spans";
import type { Flag } from "@/lib/types";

function flagTitle(name: string, t: (key: MessageKey) => string): string {
  const key = `tactic.${name}` as MessageKey;
  const label = t(key);
  return label === key ? name.replaceAll("_", " ") : label;
}

/**
 * The differentiator: the user's own message, with the exact words the engine
 * reacted to marked and tappable.
 */
export function EvidenceText({ text, flags }: { text: string; flags: Flag[] }) {
  const { t } = usePreferences();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const segments = useMemo(() => segmentByFlags(text, flags), [text, flags]);
  const hasHighlights = segments.some((segment) => segment.flags.length > 0);
  const openSegment = openIndex === null ? null : segments[openIndex];

  return (
    <div>
      <p className="mb-2 text-sm text-ink-faint">
        {hasHighlights ? t("verdict.evidenceHint") : t("verdict.noEvidence")}
      </p>

      <p className="rounded-2xl border border-line bg-paper p-4 text-base leading-loose break-words whitespace-pre-wrap">
        {segments.map((segment, index) =>
          segment.flags.length === 0 ? (
            <span key={segment.start}>{segment.text}</span>
          ) : (
            <button
              key={segment.start}
              type="button"
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              aria-expanded={openIndex === index}
              className={`animate-pulse-once -mx-0.5 rounded-md px-0.5 text-scam decoration-scam/50 decoration-2 underline-offset-4 ${
                openIndex === index ? "bg-scam/20 underline" : "bg-scam-tint underline"
              }`}
            >
              {segment.text}
            </button>
          ),
        )}
      </p>

      {openSegment && (
        <div className="animate-slide-up mt-3 space-y-3 rounded-2xl border border-scam/20 bg-scam-tint p-4">
          {openSegment.flags.map((flag) => (
            <div key={flag.name}>
              <p className="text-sm font-bold text-scam">{flagTitle(flag.name, t)}</p>
              <p className="mt-1 text-base leading-relaxed text-ink">{flag.detail}</p>
              {flag.action && (
                <p className="mt-1 text-base leading-relaxed font-semibold text-ink">
                  {flag.action}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { flagTitle };
