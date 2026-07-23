"use client";

import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";
import type { PersonaId } from "@/lib/types";

const PERSONAS: PersonaId[] = ["digital_arrest", "fake_kyc", "lottery", "loan_app"];

export function PersonaPicker({
  selected,
  onSelect,
}: {
  selected: PersonaId | null;
  onSelect: (persona: PersonaId) => void;
}) {
  const { t } = usePreferences();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PERSONAS.map((persona) => {
        const active = selected === persona;
        return (
          <button
            key={persona}
            type="button"
            onClick={() => onSelect(persona)}
            aria-pressed={active}
            className={`focus-ring rounded-2xl border p-4 text-left transition-colors ${
              active
                ? "border-brand bg-brand-tint"
                : "border-line bg-surface hover:border-line-strong"
            }`}
          >
            <p className="font-bold text-ink">{t(`simulator.persona.${persona}` as MessageKey)}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              {t(`simulator.persona.${persona}.desc` as MessageKey)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
