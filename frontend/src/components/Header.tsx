"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useOnline } from "@/hooks/useOnline";
import { LANGUAGE_ORDER } from "@/i18n/dictionary";
import { usePreferences } from "@/i18n/I18nProvider";
import type { Language } from "@/lib/types";

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-7 w-7 shrink-0 text-brand">
      <path
        d="M12 2.5 4.5 5.6v5.9c0 4.6 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.3 7.5-9.9V5.6L12 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 8.2h5.2M9.4 10.6h5.2M13 8.2c1.4 0 2 .9 2 2s-.7 2-2.1 2H9.4l4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LanguageSwitcher() {
  const { lang, setLang, t } = usePreferences();
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-line bg-surface p-1"
      role="group"
      aria-label={t("nav.language")}
    >
      {LANGUAGE_ORDER.map((code: Language) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`focus-ring rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
            lang === code ? "bg-brand text-white" : "text-ink-soft hover:bg-brand-tint"
          }`}
        >
          {t(`lang.${code}`)}
        </button>
      ))}
    </div>
  );
}

function ElderToggle() {
  const { elder, setElder, t } = usePreferences();
  return (
    <button
      type="button"
      onClick={() => setElder(!elder)}
      aria-pressed={elder}
      title={elder ? t("elder.on") : t("elder.off")}
      className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
        elder ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-soft"
      }`}
    >
      <span aria-hidden className="font-bold">
        A
      </span>
      <span aria-hidden className="text-lg leading-none font-bold">
        A
      </span>
      <span className="sr-only">{t("elder.label")}</span>
    </button>
  );
}

function HelpButton() {
  const { t } = usePreferences();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push("/welcome")}
      aria-label={t("nav.help")}
      title={t("nav.help")}
      className="focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-base font-bold text-ink-soft"
    >
      ?
    </button>
  );
}

/** Quiet reassurance when the network drops: instant checks still work offline. */
function OfflineDot() {
  const { t } = usePreferences();
  const online = useOnline();
  if (online) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-suspicious-tint px-2.5 py-1 text-xs font-semibold text-suspicious"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-suspicious" />
      {t("status.offlineDot")}
    </span>
  );
}

/** One-time nudge toward the simulator, shown after the first real analysis. */
function PracticeTip() {
  const { t, dismissPracticeTip } = usePreferences();
  return (
    <div
      role="status"
      className="animate-slide-up absolute top-full left-0 z-30 mt-2 w-60 rounded-2xl border border-brand/25 bg-surface p-3 shadow-lg"
    >
      <span
        aria-hidden
        className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-t border-l border-brand/25 bg-surface"
      />
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm leading-relaxed font-medium text-ink">{t("onb.practiceTip")}</p>
        <button
          type="button"
          onClick={dismissPracticeTip}
          aria-label={t("onb.practiceTipClose")}
          className="focus-ring -mt-1 -mr-1 rounded-lg px-2 py-1 text-ink-faint"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export function Header() {
  const { t, practiceTip, dismissPracticeTip } = usePreferences();
  const pathname = usePathname();

  // Onboarding is a full-screen experience; the app chrome would only distract.
  if (pathname === "/welcome") return null;

  const tabs = [
    { href: "/", label: t("nav.analyzer") },
    { href: "/simulator", label: t("nav.simulator") },
  ] as const;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-xl">
          <ShieldMark />
          <span className="text-lg font-bold tracking-tight">{t("app.name")}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <OfflineDot />
          <HelpButton />
          <ElderToggle />
          <LanguageSwitcher />
        </div>
        <nav className="flex w-full gap-2" aria-label={t("app.name")}>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const isPractice = tab.href === "/simulator";
            return (
              <div key={tab.href} className={isPractice ? "relative" : undefined}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  onClick={isPractice ? dismissPracticeTip : undefined}
                  className={`focus-ring tap flex items-center rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    active ? "bg-brand-tint text-brand" : "text-ink-soft hover:bg-black/5"
                  }`}
                >
                  {tab.label}
                </Link>
                {isPractice && practiceTip === "ready" && <PracticeTip />}
              </div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
