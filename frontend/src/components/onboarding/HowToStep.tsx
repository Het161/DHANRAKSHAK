"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import { SpeakerButton } from "@/components/onboarding/SpeakerButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useNarration } from "@/hooks/useNarration";
import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";

function Row({ icon, title, sub, pill }: { icon: ReactNode; title: string; sub: string; pill?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-tint text-brand">
        {icon}
      </span>
      <div>
        <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
          {title}
          {pill && (
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white">
              {pill}
            </span>
          )}
        </p>
        <p className="mt-0.5 leading-relaxed text-ink-soft">{sub}</p>
      </div>
    </div>
  );
}

export function HowToStep({ onFinish }: { onFinish: () => void }) {
  const { t, lang, elder, setElder } = usePreferences();
  const { toggle, speaking, stop } = useNarration();

  useEffect(() => stop, [stop]);

  const spoken = [
    t("onb.how.paste"),
    t("onb.how.media"),
    t("onb.how.practice"),
    t("onb.trust.privacy"),
  ].join(". ");

  const rowKeys: { title: MessageKey; sub: MessageKey; icon: ReactNode; pill?: string }[] = [
    {
      title: "onb.how.paste",
      sub: "onb.how.pasteSub",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6">
          <path
            d="M9 4h6v3H9zM7 5H5v15h14V5h-2M8 12h8M8 16h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      title: "onb.how.media",
      sub: "onb.how.mediaSub",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6">
          <path
            d="M4 7h4l1.5-2h5L16 7h4v12H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      title: "onb.how.practice",
      sub: "onb.how.practiceSub",
      pill: t("onb.how.practicePill"),
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6">
          <path
            d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{t("onb.how.title")}</h1>
        <SpeakerButton speaking={speaking} onToggle={() => toggle(spoken, lang)} />
      </div>

      <Card className="space-y-5">
        {rowKeys.map((row) => (
          <Row key={row.title} icon={row.icon} title={t(row.title)} sub={t(row.sub)} pill={row.pill} />
        ))}
      </Card>

      <Card className="space-y-2 border-brand/20 bg-brand-tint">
        <p className="leading-relaxed font-semibold text-ink">{t("onb.trust.privacy")}</p>
        <p className="font-semibold text-brand-dark">{t("footer.helpline")}</p>
      </Card>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <span className="font-semibold text-ink">{t("onb.elder.offer")}</span>
        <button
          type="button"
          role="switch"
          aria-checked={elder}
          onClick={() => setElder(!elder)}
          className={`focus-ring flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
            elder ? "border-brand bg-brand text-white" : "border-line-strong bg-paper text-ink-soft"
          }`}
        >
          <span aria-hidden>A</span>
          <span aria-hidden className="text-lg leading-none">
            A
          </span>
          <span>{elder ? t("onb.elder.on") : t("onb.elder.off")}</span>
        </button>
      </div>

      <Button variant="primary" block onClick={onFinish}>
        {t("onb.start")}
      </Button>
    </div>
  );
}
