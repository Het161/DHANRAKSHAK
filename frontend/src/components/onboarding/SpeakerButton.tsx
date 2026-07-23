"use client";

import { usePreferences } from "@/i18n/I18nProvider";

/**
 * A speaker control paired with a `useNarration` instance in the parent, so a
 * step owns the cancel-on-change lifecycle and this stays a pure button.
 */
export function SpeakerButton({
  speaking,
  onToggle,
  label,
}: {
  speaking: boolean;
  onToggle: () => void;
  label?: string;
}) {
  const { t } = usePreferences();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={speaking}
      aria-label={label ?? (speaking ? t("onb.stopListening") : t("onb.listen"))}
      className={`focus-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
        speaking
          ? "border-brand bg-brand text-white"
          : "border-line-strong bg-surface text-ink-soft hover:bg-brand-tint"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5">
        <path
          d="M4 9v6h4l5 4V5L8 9H4Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {speaking ? (
          <path
            d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M16 9.5a4 4 0 0 1 0 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span>{speaking ? t("onb.stopListening") : t("onb.listen")}</span>
    </button>
  );
}
