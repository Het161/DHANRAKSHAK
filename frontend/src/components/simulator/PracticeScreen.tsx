"use client";

import { useCallback, useState } from "react";

import { PersonaPicker } from "@/components/simulator/PersonaPicker";
import { SimulatorScreen } from "@/components/simulator/SimulatorScreen";
import { VoiceCallScreen } from "@/components/simulator/VoiceCallScreen";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import type { CallOptions } from "@/hooks/useVoiceCall";
import { usePreferences } from "@/i18n/I18nProvider";
import { fetchSpeech } from "@/lib/api";
import type { Gender, PersonaId } from "@/lib/types";

const PREVIEW_LINE: Record<string, string> = {
  gu: "નમસ્તે, હું બેંકમાંથી બોલું છું.",
  hi: "नमस्ते, मैं बैंक से बोल रहा हूं।",
  en: "Hello, I am calling from the bank.",
};

type Mode = "pick" | "text" | "voice-setup" | "voice-call";

function VoicePreview({ gender }: { gender: Gender }) {
  const { t, lang } = usePreferences();
  const [busy, setBusy] = useState(false);

  const play = useCallback(async () => {
    setBusy(true);
    const controller = new AbortController();
    const blob = await fetchSpeech(PREVIEW_LINE[lang] ?? PREVIEW_LINE.en!, lang, gender, controller.signal);
    if (blob) {
      const audio = new Audio(URL.createObjectURL(blob));
      audio.addEventListener("ended", () => URL.revokeObjectURL(audio.src), { once: true });
      await audio.play().catch(() => undefined);
    }
    setBusy(false);
  }, [gender, lang]);

  return (
    <button
      type="button"
      onClick={() => void play()}
      disabled={busy}
      className="focus-ring rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-soft disabled:opacity-50"
    >
      {t("voice.preview")}
    </button>
  );
}

export function PracticeScreen({ debug }: { debug: boolean }) {
  const { t, lang } = usePreferences();
  const [mode, setMode] = useState<Mode>("pick");
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [gender, setGender] = useState<Gender>("male");
  const [call, setCall] = useState<CallOptions | null>(null);

  if (mode === "text") return <SimulatorScreen />;

  if (mode === "voice-call" && call) {
    return (
      <VoiceCallScreen
        options={call}
        debug={debug}
        onLeave={() => {
          setCall(null);
          setMode("pick");
        }}
      />
    );
  }

  if (mode === "voice-setup") {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t("voice.setupTitle")}</h1>

        <Card className="space-y-4">
          <CardTitle>{t("simulator.choose")}</CardTitle>
          <PersonaPicker selected={persona} onSelect={setPersona} />
        </Card>

        <Card className="space-y-3">
          <CardTitle>{t("voice.voiceLabel")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {(["male", "female"] as Gender[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setGender(option)}
                aria-pressed={gender === option}
                className={`focus-ring rounded-2xl border px-5 py-3 font-semibold transition-colors ${
                  gender === option
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-ink-soft"
                }`}
              >
                {t(option === "male" ? "voice.male" : "voice.female")}
              </button>
            ))}
            <VoicePreview gender={gender} />
          </div>
        </Card>

        <Button
          variant="primary"
          block
          disabled={!persona}
          onClick={() => {
            if (!persona) return;
            setCall({ persona, lang, gender });
            setMode("voice-call");
          }}
        >
          {t("voice.start")}
        </Button>
        <Button variant="quiet" block onClick={() => setMode("pick")}>
          {t("simulator.leave")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {t("simulator.title")}
        </h1>
        <p className="mt-2 leading-relaxed text-ink-soft">{t("simulator.subtitle")}</p>
      </div>

      <Card className="space-y-4">
        <CardTitle>{t("practice.mode.title")}</CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("voice-setup")}
            className="focus-ring rounded-2xl border border-brand bg-brand-tint p-5 text-left"
          >
            <p className="text-lg font-bold text-brand-dark">{t("practice.mode.voice")}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              {t("practice.mode.voiceDesc")}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className="focus-ring rounded-2xl border border-line bg-surface p-5 text-left"
          >
            <p className="text-lg font-bold text-ink">{t("practice.mode.text")}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              {t("practice.mode.textDesc")}
            </p>
          </button>
        </div>
      </Card>
    </div>
  );
}
