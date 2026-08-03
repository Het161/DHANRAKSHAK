"use client";

import { useRef } from "react";

import { usePreferences } from "@/i18n/I18nProvider";
import type { Recording, RecorderStatus } from "@/hooks/useRecorder";

/**
 * Presentational recorder UI. The recorder itself lives in the parent so the
 * page's primary "Check" button can coordinate with recording state (turning
 * into "Stop & check" mid-recording), instead of silently rejecting the user
 * with "enter something" while the mic is still running.
 */
export function VoiceInput({
  status,
  seconds,
  recording,
  start,
  stop,
  reset,
  uploaded,
  onUpload,
}: {
  status: RecorderStatus;
  seconds: number;
  recording: Recording | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  uploaded: File | null;
  onUpload: (file: File | null) => void;
}) {
  const { t } = usePreferences();
  const fileRef = useRef<HTMLInputElement>(null);

  const beginRecording = async () => {
    onUpload(null);
    await start();
  };

  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-5 text-center">
      <p className="mb-4 text-base text-ink-soft">{t("analyzer.voicePrompt")}</p>

      {status === "recording" ? (
        <button
          type="button"
          onClick={stop}
          className="focus-ring animate-pulse-once w-full rounded-2xl border border-scam/30 bg-scam-tint px-4 py-4 text-lg font-bold text-scam"
        >
          {t("analyzer.voiceStop")} — {t("analyzer.voiceRecording", { seconds })}
        </button>
      ) : (
        <button
          type="button"
          onClick={beginRecording}
          disabled={status === "unsupported"}
          className="focus-ring w-full rounded-2xl border border-brand bg-brand px-4 py-4 text-lg font-bold text-white disabled:opacity-50"
        >
          {t("analyzer.voiceRecord")}
        </button>
      )}

      <p className="mt-2 text-sm text-ink-faint">{t("analyzer.voiceLimit")}</p>

      {status === "denied" && (
        <p className="mt-3 rounded-xl bg-suspicious-tint px-3 py-2 text-sm text-suspicious">
          {t("error.micDenied")}
        </p>
      )}
      {status === "unsupported" && (
        <p className="mt-3 rounded-xl bg-suspicious-tint px-3 py-2 text-sm text-suspicious">
          {t("analyzer.voiceUnsupported")}
        </p>
      )}

      {recording && (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm font-semibold text-brand">
          {t("analyzer.voiceReady", { seconds: recording.seconds })}
          <button
            type="button"
            onClick={reset}
            className="focus-ring rounded-lg px-2 py-1 font-semibold text-scam"
          >
            {t("analyzer.removeFile")}
          </button>
        </p>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file) reset();
            onUpload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="focus-ring rounded-2xl border border-line-strong bg-paper px-4 py-3 font-semibold text-ink"
        >
          {t("analyzer.voiceUpload")}
        </button>
        {uploaded && (
          <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-soft">
            <span className="max-w-full truncate">
              {t("analyzer.selectedFile", { name: uploaded.name })}
            </span>
            <button
              type="button"
              onClick={() => onUpload(null)}
              className="focus-ring rounded-lg px-2 py-1 font-semibold text-scam"
            >
              {t("analyzer.removeFile")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
