"use client";

import { LANGUAGE_ORDER } from "@/i18n/dictionary";
import { usePreferences } from "@/i18n/I18nProvider";

/**
 * Shown once, before any language has been picked. Gujarati sits first and is
 * the widest target because that is who this is built for; the other two are
 * one tap away so nobody is locked out.
 */
export function LanguageChooser() {
  const { setLang, hasChosenLanguage } = usePreferences();
  if (hasChosenLanguage) return null;

  return (
    <section className="animate-slide-up mb-5 rounded-3xl border border-brand/25 bg-brand-tint p-5">
      <p className="mb-3 text-center text-base font-semibold text-brand-dark">
        ભાષા પસંદ કરો / भाषा चुनें / Choose your language
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LANGUAGE_ORDER.map((code, index) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            className={`focus-ring rounded-2xl border border-brand/30 bg-surface px-4 py-4 font-bold text-ink transition-colors hover:bg-white ${
              index === 0 ? "text-xl sm:col-span-3" : "text-lg"
            }`}
          >
            {code === "gu" ? "ગુજરાતી" : code === "hi" ? "हिन्दी" : "English"}
          </button>
        ))}
      </div>
    </section>
  );
}
