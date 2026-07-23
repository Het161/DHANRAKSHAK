"use client";

import { usePreferences } from "@/i18n/I18nProvider";
import { MAX_TEXT_CHARS } from "@/lib/caps";

export function TextInput({
  value,
  onChange,
  variant,
}: {
  value: string;
  onChange: (value: string) => void;
  variant: "message" | "link";
}) {
  const { t } = usePreferences();
  const isLink = variant === "link";

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.slice(0, MAX_TEXT_CHARS));
    } catch {
      // Clipboard permission is routinely refused; the user can still long-press
      // and paste into the field themselves.
    }
  };

  return (
    <div>
      {isLink ? (
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("analyzer.linkPlaceholder")}
          aria-label={t("analyzer.linkPlaceholder")}
          className="focus-ring w-full rounded-2xl border border-line bg-surface px-4 py-4 text-base break-all text-ink placeholder:text-ink-faint"
        />
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("analyzer.messagePlaceholder")}
          aria-label={t("analyzer.messagePlaceholder")}
          rows={6}
          maxLength={MAX_TEXT_CHARS}
          className="focus-ring w-full resize-y rounded-2xl border border-line bg-surface px-4 py-4 text-base leading-relaxed text-ink placeholder:text-ink-faint"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={paste}
          className="focus-ring rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-soft"
        >
          {t("analyzer.paste")}
        </button>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="focus-ring rounded-xl px-3 py-2 text-sm font-semibold text-ink-faint"
          >
            {t("analyzer.clear")}
          </button>
        )}
        {!isLink && value.length > MAX_TEXT_CHARS * 0.8 && (
          <span className="ml-auto text-sm text-ink-faint">
            {t("analyzer.charCount", { count: value.length, max: MAX_TEXT_CHARS })}
          </span>
        )}
      </div>
    </div>
  );
}
