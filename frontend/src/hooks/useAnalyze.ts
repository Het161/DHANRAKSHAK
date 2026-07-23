"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PermanentApiError, streamAnalyzeFile, streamAnalyzeText } from "@/lib/api";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, WAKE_UP_AFTER_MS, delay, isAbort } from "@/lib/retry";
import type { AnalyzeResponse, ExplanationSource, LanguageHint, SSEEvent } from "@/lib/types";

/**
 * The verdict event already carries a complete template explanation. Swapping
 * to the live stream only once it has some substance avoids blanking a filled
 * panel for the first few tokens.
 */
const MIN_STREAM_SWAP_CHARS = 40;

export type AnalyzePhase = "idle" | "connecting" | "waking" | "streaming" | "done" | "error";

export type AnalyzeInput =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string }
  | { kind: "image"; file: File }
  | { kind: "audio"; file: Blob; filename: string };

interface InternalState {
  phase: AnalyzePhase;
  verdict: AnalyzeResponse | null;
  streamed: string;
  finalExplanation: string | null;
  explanationSource: ExplanationSource | null;
  latencyMs: number | null;
  errorMessage: string | null;
  attempt: number;
}

const INITIAL: InternalState = {
  phase: "idle",
  verdict: null,
  streamed: "",
  finalExplanation: null,
  explanationSource: null,
  latencyMs: null,
  errorMessage: null,
  attempt: 1,
};

export interface AnalyzeState extends InternalState {
  /** What the Why section should display right now, in every tier. */
  explanation: string;
  /** True while the LLM is actively improving on the template wording. */
  isRefining: boolean;
  isBusy: boolean;
}

export function useAnalyze(languageHint: LanguageHint) {
  const [state, setState] = useState<InternalState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotVerdictRef = useRef(false);

  const clearWakeTimer = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearWakeTimer();
  }, [clearWakeTimer]);

  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    cancel();
    gotVerdictRef.current = false;
    setState(INITIAL);
  }, [cancel]);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case "verdict":
          gotVerdictRef.current = true;
          clearWakeTimer();
          setState((prev) => ({
            ...prev,
            phase: "streaming",
            verdict: event.payload,
            errorMessage: null,
          }));
          break;
        case "token":
          setState((prev) => ({ ...prev, streamed: prev.streamed + event.payload.text }));
          break;
        case "done":
          setState((prev) => ({
            ...prev,
            phase: "done",
            finalExplanation: event.payload.explanation,
            explanationSource: event.payload.explanation_source,
            latencyMs: event.payload.latency_ms,
          }));
          break;
        case "error":
          setState((prev) => ({
            ...prev,
            phase: prev.verdict ? "done" : "error",
            errorMessage: event.payload.message,
          }));
          break;
      }
    },
    [clearWakeTimer],
  );

  const runOnce = useCallback(
    async (input: AnalyzeInput, signal: AbortSignal) => {
      if (input.kind === "image") {
        await streamAnalyzeFile(
          "image",
          input.file,
          input.file.name || "screenshot.png",
          languageHint,
          handleEvent,
          signal,
        );
        return;
      }
      if (input.kind === "audio") {
        await streamAnalyzeFile(
          "audio",
          input.file,
          input.filename,
          languageHint,
          handleEvent,
          signal,
        );
        return;
      }
      await streamAnalyzeText(
        { input_type: input.kind, content: input.text, language_hint: languageHint },
        handleEvent,
        signal,
      );
    },
    [handleEvent, languageHint],
  );

  const run = useCallback(
    async (input: AnalyzeInput) => {
      cancel();
      const controller = new AbortController();
      controllerRef.current = controller;
      gotVerdictRef.current = false;

      setState({ ...INITIAL, phase: "connecting" });
      wakeTimerRef.current = setTimeout(() => {
        if (!gotVerdictRef.current) setState((prev) => ({ ...prev, phase: "waking" }));
      }, WAKE_UP_AFTER_MS);

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          await runOnce(input, controller.signal);
          clearWakeTimer();
          // A stream that ends without a done event still leaves the verdict on
          // screen; settle the phase so the UI stops showing progress.
          setState((prev) => (prev.phase === "done" ? prev : { ...prev, phase: "done" }));
          return;
        } catch (error) {
          if (isAbort(error) || controller.signal.aborted) return;

          if (error instanceof PermanentApiError) {
            clearWakeTimer();
            setState((prev) => ({ ...prev, phase: "error", errorMessage: error.message }));
            return;
          }

          // The answer already arrived; a dropped connection afterwards costs
          // only the streamed wording, which the template already covers.
          if (gotVerdictRef.current) {
            clearWakeTimer();
            setState((prev) => ({ ...prev, phase: "done" }));
            return;
          }

          if (attempt === MAX_ATTEMPTS) {
            clearWakeTimer();
            setState((prev) => ({ ...prev, phase: "error", errorMessage: null }));
            return;
          }

          setState((prev) => ({ ...prev, phase: "waking", attempt: attempt + 1 }));
          try {
            await delay(RETRY_DELAYS_MS[attempt - 1] ?? 8_000, controller.signal);
          } catch {
            return;
          }
        }
      }
    },
    [cancel, clearWakeTimer, runOnce],
  );

  const derived = useMemo<AnalyzeState>(() => {
    const streamedIsUsable = state.streamed.trim().length >= MIN_STREAM_SWAP_CHARS;
    const explanation =
      state.finalExplanation ??
      (streamedIsUsable ? state.streamed : (state.verdict?.explanation ?? ""));
    return {
      ...state,
      explanation,
      isRefining: state.phase === "streaming" && streamedIsUsable,
      isBusy: state.phase === "connecting" || state.phase === "waking" || state.phase === "streaming",
    };
  }, [state]);

  return { state: derived, run, reset, cancel };
}
