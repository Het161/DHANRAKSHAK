"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { useRecorder } from "@/hooks/useRecorder";
import { usePreferences } from "@/i18n/I18nProvider";
import { transcribeSpeech } from "@/lib/api";

/**
 * Speech input for browsers without continuous recognition, notably iOS Safari.
 *
 * Records while held and sends the clip to the server for transcription, which
 * costs a round trip the streaming path avoids. That is the trade: this variant
 * works everywhere, and is slower everywhere.
 */
export function PushToTalk({ onTranscript }: { onTranscript: (transcript: string) => void }) {
  const { t, lang } = usePreferences();
  const { status, seconds, recording, start, stop, reset } = useRecorder();
  // A finished recording is exactly the "waiting for the transcript" state, so
  // there is nothing extra to store.
  const sending = recording !== null;

  useEffect(() => {
    if (!recording) return;
    const controller = new AbortController();
    transcribeSpeech(recording.blob, recording.filename, lang, controller.signal)
      .then((transcript) => {
        if (transcript) onTranscript(transcript);
      })
      .catch(() => undefined)
      .finally(reset);
    return () => controller.abort();
  }, [lang, onTranscript, recording, reset]);

  const recordingNow = status === "recording";

  return (
    <div className="space-y-2">
      <Button
        variant={recordingNow ? "danger" : "primary"}
        block
        disabled={sending || status === "unsupported"}
        onPointerDown={() => void start()}
        onPointerUp={stop}
        onPointerLeave={() => recordingNow && stop()}
      >
        {sending
          ? t("simulator.sending")
          : recordingNow
            ? t("analyzer.voiceRecording", { seconds })
            : t("voice.holdToTalk")}
      </Button>
      {status === "denied" && (
        <p role="alert" className="text-sm text-scam">
          {t("voice.micDenied")}
        </p>
      )}
    </div>
  );
}
