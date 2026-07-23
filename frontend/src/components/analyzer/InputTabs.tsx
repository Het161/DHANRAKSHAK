"use client";

import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";

export type TabId = "message" | "link" | "screenshot" | "voice";

const LABELS: Record<TabId, MessageKey> = {
  message: "tabs.message",
  link: "tabs.link",
  screenshot: "tabs.screenshot",
  voice: "tabs.voice",
};

const DEFAULT_ORDER: TabId[] = ["message", "link", "screenshot", "voice"];
/** Elder mode is voice-first: speaking is easier than pasting. */
const ELDER_ORDER: TabId[] = ["voice", "message", "screenshot", "link"];

export function tabOrder(elder: boolean): TabId[] {
  return elder ? ELDER_ORDER : DEFAULT_ORDER;
}

export function InputTabs({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const { t, elder } = usePreferences();

  return (
    <div
      role="tablist"
      aria-label={t("analyzer.title")}
      // Four across clips the longer labels at 360px, which is the screen this
      // product is actually used on.
      className={`grid gap-2 ${elder ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}
    >
      {tabOrder(elder).map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab)}
            className={`focus-ring rounded-2xl border px-2 py-3 text-sm font-semibold transition-colors ${
              selected
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink-soft hover:bg-brand-tint"
            }`}
          >
            {t(LABELS[tab])}
          </button>
        );
      })}
    </div>
  );
}
