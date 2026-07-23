"use client";

import { usePathname } from "next/navigation";

import { usePreferences } from "@/i18n/I18nProvider";

export function Footer() {
  const { t } = usePreferences();
  const pathname = usePathname();

  // Onboarding carries its own trust line; the app footer would duplicate it.
  if (pathname === "/welcome") return null;

  return (
    <footer className="mx-auto max-w-3xl px-4 pt-8 pb-10">
      <p className="text-center text-sm leading-relaxed text-ink-faint">{t("footer.privacy")}</p>
      <p className="mt-2 text-center text-sm font-semibold text-ink-soft">{t("footer.helpline")}</p>
    </footer>
  );
}
