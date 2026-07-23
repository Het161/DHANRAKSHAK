"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { InputTabs, type TabId } from "@/components/analyzer/InputTabs";
import { ScreenshotInput } from "@/components/analyzer/ScreenshotInput";
import { TextInput } from "@/components/analyzer/TextInput";
import { VoiceInput } from "@/components/analyzer/VoiceInput";
import { LanguageChooser } from "@/components/LanguageChooser";
import { StatusPanel } from "@/components/StatusPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { VerdictCard } from "@/components/verdict/VerdictCard";
import { useAnalyze, type AnalyzeInput } from "@/hooks/useAnalyze";
import type { Recording } from "@/hooks/useRecorder";
import { usePreferences } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/dictionary";
import { validateAudio, validateImage, validateText } from "@/lib/caps";
import { sampleText } from "@/lib/onboardingContent";
import type { Language } from "@/lib/types";

const BUSY_KEY: Record<TabId, MessageKey> = {
  message: "status.analyzing",
  link: "status.analyzing",
  screenshot: "status.reading",
  voice: "status.listening",
};

const SAMPLE_CHIPS: { kind: "kyc" | "lottery" | "upi"; label: MessageKey }[] = [
  { kind: "kyc", label: "analyzer.sampleKyc" },
  { kind: "lottery", label: "analyzer.sampleLottery" },
  { kind: "upi", label: "analyzer.sampleUpi" },
];

/** One-tap first check for a hesitant user. Fills the box; never sends on its own. */
function SampleChips({ lang, onPick }: { lang: Language; onPick: (text: string) => void }) {
  const { t } = usePreferences();
  return (
    <div>
      <p className="mb-2 text-sm text-ink-faint">{t("analyzer.tryTitle")}</p>
      <div className="flex flex-wrap gap-2">
        {SAMPLE_CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            onClick={() => onPick(sampleText(lang, chip.kind))}
            className="focus-ring rounded-full border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-brand-tint"
          >
            {t(chip.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnalyzerPanel() {
  const { t, lang, hasChosenLanguage, signalFirstAnalysis } = usePreferences();
  const [tab, setTab] = useState<TabId>("message");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [validationKey, setValidationKey] = useState<MessageKey | null>(null);

  // The language the user reads in is what the backend should answer in.
  const { state, run, reset } = useAnalyze(hasChosenLanguage ? lang : "auto");
  const resultRef = useRef<HTMLDivElement>(null);
  const lastInputRef = useRef<AnalyzeInput | null>(null);

  useEffect(() => {
    if (state.verdict) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state.verdict]);

  // A completed check is what arms the one-time "now practise" nudge on the tab.
  useEffect(() => {
    if (state.phase === "done") signalFirstAnalysis();
  }, [state.phase, signalFirstAnalysis]);

  const buildInput = useCallback((): AnalyzeInput | { error: MessageKey } => {
    if (tab === "screenshot") {
      if (!image) return { error: "error.empty" };
      const check = validateImage(image);
      return check.ok ? { kind: "image", file: image } : { error: check.key };
    }
    if (tab === "voice") {
      const blob = recording?.blob ?? audioFile;
      if (!blob) return { error: "error.empty" };
      const check = validateAudio(blob);
      if (!check.ok) return { error: check.key };
      return {
        kind: "audio",
        file: blob,
        filename: recording?.filename ?? audioFile?.name ?? "recording.webm",
      };
    }
    const value = tab === "link" ? link : text;
    const check = validateText(value);
    return check.ok ? { kind: tab === "link" ? "url" : "text", text: value } : { error: check.key };
  }, [audioFile, image, link, recording, tab, text]);

  const submit = useCallback(() => {
    const input = buildInput();
    if ("error" in input) {
      setValidationKey(input.error);
      return;
    }
    setValidationKey(null);
    lastInputRef.current = input;
    void run(input);
  }, [buildInput, run]);

  const retry = useCallback(() => {
    if (lastInputRef.current) void run(lastInputRef.current);
  }, [run]);

  const checkAnother = useCallback(() => {
    reset();
    setText("");
    setLink("");
    setImage(null);
    setAudioFile(null);
    setRecording(null);
    setValidationKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [reset]);

  const showForm = !state.verdict && state.phase !== "error";

  return (
    <div className="space-y-5">
      <LanguageChooser />

      {showForm && (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {t("analyzer.title")}
            </h1>
            <p className="mt-2 leading-relaxed text-ink-soft">{t("analyzer.subtitle")}</p>
          </div>

          <Card className="space-y-4">
            <InputTabs active={tab} onChange={setTab} />

            {tab === "message" && (
              <>
                <TextInput value={text} onChange={setText} variant="message" />
                {text.length === 0 && <SampleChips lang={lang} onPick={setText} />}
              </>
            )}
            {tab === "link" && <TextInput value={link} onChange={setLink} variant="link" />}
            {tab === "screenshot" && <ScreenshotInput file={image} onChange={setImage} />}
            {tab === "voice" && (
              <VoiceInput
                uploaded={audioFile}
                onRecording={setRecording}
                onUpload={setAudioFile}
              />
            )}

            {validationKey && (
              <p role="alert" className="rounded-xl bg-suspicious-tint px-3 py-2 text-suspicious">
                {t(validationKey)}
              </p>
            )}

            <Button variant="primary" block onClick={submit} disabled={state.isBusy}>
              {state.isBusy ? t("analyzer.checking") : t("analyzer.check")}
            </Button>
          </Card>
        </>
      )}

      <div ref={resultRef} className="scroll-mt-32 space-y-4">
        <StatusPanel
          phase={state.phase}
          busyKey={BUSY_KEY[tab]}
          errorMessage={state.errorMessage}
          onRetry={retry}
        />
        {state.verdict && <VerdictCard state={state} onCheckAnother={checkAnother} />}
      </div>
    </div>
  );
}
