"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_AUDIO_SECONDS } from "@/lib/caps";

export type RecorderStatus = "unsupported" | "idle" | "recording" | "ready" | "denied";

const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export interface Recording {
  blob: Blob;
  filename: string;
  seconds: number;
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopTicking();
      releaseStream();
    },
    [releaseStream, stopTicking],
  );

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === "undefined") {
      setStatus("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("denied");
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];
    setRecording(null);
    setSeconds(0);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stopTicking();
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      releaseStream();
      setSeconds((elapsed) => {
        setRecording({ blob, filename: `recording.${extensionFor(type)}`, seconds: elapsed });
        return elapsed;
      });
      setStatus("ready");
    };

    recorder.start();
    setStatus("recording");
    tickRef.current = setInterval(() => {
      setSeconds((elapsed) => {
        // The backend rejects anything longer, so stop before the upload rather
        // than after it.
        if (elapsed + 1 >= MAX_AUDIO_SECONDS) stop();
        return elapsed + 1;
      });
    }, 1000);
  }, [releaseStream, stop, stopTicking]);

  const reset = useCallback(() => {
    stopTicking();
    releaseStream();
    chunksRef.current = [];
    setRecording(null);
    setSeconds(0);
    setStatus(typeof MediaRecorder === "undefined" ? "unsupported" : "idle");
  }, [releaseStream, stopTicking]);

  return { status, seconds, recording, start, stop, reset };
}
