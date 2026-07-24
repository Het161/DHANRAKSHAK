"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { localAnalyzer } from "@/lib/engine/client";
import { PermanentApiError, pingHealth, streamAnalyzeFile, streamAnalyzeText } from "@/lib/api";
import { serverPlan } from "@/lib/connectivity";
import { prepareImage } from "@/lib/prepareImage";
import { delay, isAbort } from "@/lib/retry";
import type { AnalyzeResponse, ExplanationSource, LanguageHint, SSEEvent } from "@/lib/types";

/**
 * Local-first orchestration.
 *
 * Every check runs the on-device engine first and shows a complete verdict card
 * at once. If the connection allows, the server is then asked in the background
 * for a richer explanation, which upgrades the card in place. The verdict itself
 * never changes on upgrade unless the server's risk differs materially (>15
 * points), in which case both are shown honestly.
 */

const MIN_STREAM_SWAP_CHARS = 40;
// Once the server verdict has arrived, allow the explanation this long to stream
// before giving up on it; the local answer is already on screen regardless.
const STREAM_FINISH_MS = 15_000;
// A material gap between the two engines - only then is the divergence surfaced.
const MATERIAL_RISK_GAP = 15;
// Render instances sleep; if the first server byte is this slow, tell the user
// it is waking - as a background note, never as a blocker over the local result.
const WAKE_NOTE_AFTER_MS = 3_000;
// OCR is inherently slower than text, so the image upload gets its own budget.
const IMAGE_BUDGET_MS = 35_000;
const HEALTH_PING_MS = 3_000;
// How long the "Uploading..." copy shows before switching to "Reading...".
const UPLOAD_STAGE_MS = 2_500;

export type AnalyzePhase = "idle" | "preparing" | "local" | "serverPending" | "done" | "error";
export type SourceChip = "instant" | "offline" | "serverAdded" | "serverChecked";
/** Staged copy for the image path while it uploads then waits on server OCR. */
export type ImageStage = "uploading" | "reading" | null;

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
  serverPending: boolean;
  serverAttempted: boolean;
  ranOffline: boolean;
  waking: boolean;
  localRisk: number | null;
  serverRisk: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  /** OCR could not read the screenshot; the UI offers the paste-text path. */
  ocrFailed: boolean;
  imageStage: ImageStage;
}

const INITIAL: InternalState = {
  phase: "idle",
  verdict: null,
  streamed: "",
  finalExplanation: null,
  explanationSource: null,
  serverPending: false,
  serverAttempted: false,
  ranOffline: false,
  waking: false,
  localRisk: null,
  serverRisk: null,
  latencyMs: null,
  errorMessage: null,
  ocrFailed: false,
  imageStage: null,
};

export interface AnalyzeState extends InternalState {
  explanation: string;
  isRefining: boolean;
  isBusy: boolean;
  chip: SourceChip;
  /** True when the server's risk differs from the on-device risk by >15 points. */
  divergent: boolean;
}

function signatureOf(input: AnalyzeInput): string {
  if (input.kind === "text" || input.kind === "url") return `${input.kind}:${input.text}`;
  if (input.kind === "image") return `image:${input.file.name}:${input.file.size}`;
  return `audio:${input.filename}:${input.file.size}`;
}

function chipFor(state: InternalState): SourceChip {
  if (state.explanationSource === "llm") return "serverAdded";
  if (state.explanationSource === "template" && state.serverAttempted) return "serverChecked";
  // Still on-device: instant while the server may yet answer, offline once settled.
  if (state.serverPending) return "instant";
  return state.ranOffline || !state.serverAttempted ? "offline" : "instant";
}

export function useAnalyze(languageHint: LanguageHint) {
  const [state, setState] = useState<InternalState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightSignatureRef = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The prepared JPEG for the current screenshot, so a retry reuses it instead of
  // re-preparing (and the user never has to re-pick the file).
  const preparedRef = useRef<{ file: File; blob: Blob; filename: string } | null>(null);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightSignatureRef.current = null;
    clearTimers();
  }, [clearTimers]);

  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    cancel();
    preparedRef.current = null;
    setState(INITIAL);
  }, [cancel]);

  // --- server upgrade (background) ---------------------------------------

  const runServerUpgrade = useCallback(
    async (input: AnalyzeInput, budgetMs: number, localRisk: number | null, signal: AbortSignal) => {
      let gotVerdict = false;

      const onEvent = (event: SSEEvent) => {
        switch (event.type) {
          case "verdict": {
            gotVerdict = true;
            const serverRisk = event.payload.risk_score;
            const divergent = localRisk !== null && Math.abs(serverRisk - localRisk) > MATERIAL_RISK_GAP;
            setState((prev) => ({
              ...prev,
              waking: false,
              serverRisk,
              // Keep the on-device verdict on screen; only adopt the server's
              // advisory and actions, which are the richer half of its answer.
              verdict: prev.verdict
                ? { ...prev.verdict, advisory: event.payload.advisory ?? prev.verdict.advisory, actions: event.payload.actions.length ? event.payload.actions : prev.verdict.actions }
                : event.payload,
              // divergence is derived in the selector from localRisk/serverRisk,
              // but stash the flag intent by leaving both risks in state.
              errorMessage: divergent ? null : prev.errorMessage,
            }));
            break;
          }
          case "token":
            setState((prev) => ({ ...prev, streamed: prev.streamed + event.payload.text }));
            break;
          case "done":
            setState((prev) => ({
              ...prev,
              finalExplanation: event.payload.explanation,
              explanationSource: event.payload.explanation_source,
              latencyMs: event.payload.latency_ms,
            }));
            break;
          case "error":
            // A stream error after the verdict costs only the richer wording.
            break;
        }
      };

      // Budget only guards the FIRST server byte (cold Render). Once the verdict
      // is in, the explanation is allowed to finish under a longer cap.
      const budgetTimer = setTimeout(() => {
        if (!gotVerdict) controllerRef.current?.abort();
      }, budgetMs);
      const wakeTimer = setTimeout(() => {
        if (!gotVerdict) setState((prev) => ({ ...prev, waking: true }));
      }, WAKE_NOTE_AFTER_MS);
      const finishTimer = setTimeout(() => controllerRef.current?.abort(), budgetMs + STREAM_FINISH_MS);
      timersRef.current.push(budgetTimer, wakeTimer, finishTimer);

      const runOnce = () =>
        input.kind === "image"
          ? streamAnalyzeFile("image", input.file, input.file.name || "screenshot.png", languageHint, onEvent, signal)
          : input.kind === "audio"
            ? streamAnalyzeFile("audio", input.file, input.filename, languageHint, onEvent, signal)
            : streamAnalyzeText({ input_type: input.kind, content: input.text, language_hint: languageHint }, onEvent, signal);

      try {
        await runOnce();
      } catch (error) {
        if (isAbort(error) || signal.aborted) return;
        // Retry once, but only if the verdict has not arrived and it is worth it.
        if (!gotVerdict && !(error instanceof PermanentApiError)) {
          try {
            await delay(1_500, signal);
            await runOnce();
          } catch {
            /* keep the local result */
          }
        }
      } finally {
        clearTimers();
        setState((prev) => ({
          ...prev,
          phase: "done",
          serverPending: false,
          waking: false,
          ranOffline: prev.ranOffline || !gotVerdict,
        }));
      }
    },
    [languageHint, clearTimers],
  );

  // --- audio path (server-only: no offline STT) --------------------------

  const runServerOnly = useCallback(
    async (file: Blob, filename: string, signal: AbortSignal) => {
      setState({ ...INITIAL, phase: "serverPending", serverPending: true, serverAttempted: true });
      const onEvent = (event: SSEEvent) => {
        if (event.type === "verdict") {
          setState((prev) => ({ ...prev, verdict: event.payload, serverRisk: event.payload.risk_score, waking: false }));
        } else if (event.type === "token") {
          setState((prev) => ({ ...prev, streamed: prev.streamed + event.payload.text }));
        } else if (event.type === "done") {
          setState((prev) => ({ ...prev, finalExplanation: event.payload.explanation, explanationSource: event.payload.explanation_source, latencyMs: event.payload.latency_ms }));
        } else if (event.type === "error") {
          setState((prev) => ({ ...prev, errorMessage: event.payload.message ?? null }));
        }
      };
      const wakeTimer = setTimeout(() => setState((prev) => (prev.verdict ? prev : { ...prev, waking: true })), WAKE_NOTE_AFTER_MS);
      timersRef.current.push(wakeTimer);
      try {
        await streamAnalyzeFile("audio", file, filename, languageHint, onEvent, signal);
      } catch (error) {
        if (isAbort(error) || signal.aborted) return;
        setState((prev) => ({ ...prev, phase: prev.verdict ? "done" : "error", errorMessage: error instanceof PermanentApiError ? error.message : null }));
        return;
      } finally {
        clearTimers();
      }
      setState((prev) => ({ ...prev, phase: "done", serverPending: false, waking: false }));
    },
    [languageHint, clearTimers],
  );

  // --- image path (server OCR, with its own budget and cold-start handling) ---

  const runImage = useCallback(
    async (file: File, signal: AbortSignal) => {
      // 1. Prepare (downscale + JPEG), reusing the result on a retry so the user
      // never re-picks the file.
      let prepared = preparedRef.current;
      if (!prepared || prepared.file !== file) {
        setState({ ...INITIAL, phase: "preparing" });
        try {
          const result = await prepareImage(file);
          prepared = { file, blob: result.blob, filename: result.filename };
          preparedRef.current = prepared;
        } catch {
          // Oversized originals are caught before run() by validateImage; anything
          // else here is an unreadable file.
          setState({ ...INITIAL, phase: "error", errorMessage: null });
          return;
        }
      }
      if (signal.aborted) return;

      // 2. Wake the server FIRST, so the upload itself never absorbs the cold start.
      if (!(await pingHealth(HEALTH_PING_MS))) {
        if (signal.aborted) return;
        setState({ ...INITIAL, phase: "serverPending", serverPending: true, serverAttempted: true, waking: true });
        for (let i = 0; i < 18 && !(await pingHealth(HEALTH_PING_MS)); i += 1) {
          if (signal.aborted) return;
          try {
            await delay(2_000, signal);
          } catch {
            return;
          }
        }
      }
      if (signal.aborted) return;

      // 3. Upload with staged progress ("Uploading..." -> "Reading...") and a 35s budget.
      setState({ ...INITIAL, phase: "serverPending", serverPending: true, serverAttempted: true, imageStage: "uploading" });
      let gotVerdict = false;
      let budgetHit = false;
      let settled = false;
      const stageTimer = setTimeout(
        () => setState((prev) => (prev.verdict ? prev : { ...prev, imageStage: "reading" })),
        UPLOAD_STAGE_MS,
      );
      const budgetTimer = setTimeout(() => {
        budgetHit = true;
        controllerRef.current?.abort();
      }, IMAGE_BUDGET_MS);
      timersRef.current.push(stageTimer, budgetTimer);

      const onEvent = (event: SSEEvent) => {
        if (event.type === "verdict") {
          gotVerdict = true;
          setState((prev) => ({ ...prev, verdict: event.payload, serverRisk: event.payload.risk_score, imageStage: null, waking: false }));
        } else if (event.type === "token") {
          setState((prev) => ({ ...prev, streamed: prev.streamed + event.payload.text }));
        } else if (event.type === "done") {
          setState((prev) => ({ ...prev, finalExplanation: event.payload.explanation, explanationSource: event.payload.explanation_source, latencyMs: event.payload.latency_ms }));
        } else if (event.type === "error") {
          settled = true;
          if (event.payload.code === "ocr_failed" || event.payload.code === "ocr_unavailable") {
            setState((prev) => ({ ...prev, ocrFailed: true, imageStage: null, waking: false }));
          } else {
            setState((prev) => ({ ...prev, errorMessage: event.payload.message ?? null, imageStage: null, waking: false }));
          }
        }
      };

      try {
        await streamAnalyzeFile("image", prepared.blob, prepared.filename, languageHint, onEvent, signal);
      } catch (error) {
        clearTimers();
        if (isAbort(error) || signal.aborted) {
          // A budget timeout with nothing on screen is a retryable error (the
          // prepared image is kept, so "Try again" does not re-pick the file).
          if (budgetHit && !gotVerdict) {
            setState((prev) => ({ ...prev, phase: "error", errorMessage: null, imageStage: null, waking: false }));
          }
          return;
        }
        setState((prev) => ({ ...prev, phase: prev.verdict ? "done" : "error", errorMessage: error instanceof PermanentApiError ? error.message : null, imageStage: null, waking: false }));
        return;
      }
      clearTimers();
      setState((prev) => ({ ...prev, phase: gotVerdict || settled ? "done" : "error", serverPending: false, waking: false, imageStage: null }));
    },
    [languageHint, clearTimers],
  );

  const run = useCallback(
    async (input: AnalyzeInput) => {
      const signature = signatureOf(input);
      // Dedupe: an identical check already in flight is left to finish.
      if (inFlightSignatureRef.current === signature && controllerRef.current) return;

      cancel();
      const controller = new AbortController();
      controllerRef.current = controller;
      inFlightSignatureRef.current = signature;

      // Screenshots and recordings need the server (OCR/STT); no offline path.
      if (input.kind === "image" || input.kind === "audio") {
        if (!serverPlan().attempt) {
          setState({ ...INITIAL, phase: "error", errorMessage: null, ranOffline: true });
          return;
        }
        if (input.kind === "image") await runImage(input.file, controller.signal);
        else await runServerOnly(input.file, input.filename, controller.signal);
        return;
      }

      // 1. On-device first: a complete card, right away.
      let local;
      try {
        local = await localAnalyzer().analyze(input.text, languageHint);
      } catch {
        setState({ ...INITIAL, phase: "error", errorMessage: null });
        return;
      }
      if (controller.signal.aborted) return;

      const plan = serverPlan();
      setState({
        ...INITIAL,
        phase: plan.attempt ? "serverPending" : "done",
        verdict: local,
        explanationSource: "on-device",
        localRisk: local.risk_score,
        serverRisk: null,
        serverAttempted: plan.attempt,
        serverPending: plan.attempt,
        ranOffline: !plan.attempt,
      });

      // 2. Optional server upgrade, in the background.
      if (plan.attempt) await runServerUpgrade(input, plan.budgetMs, local.risk_score, controller.signal);
    },
    [cancel, languageHint, runImage, runServerOnly, runServerUpgrade],
  );

  const derived = useMemo<AnalyzeState>(() => {
    const streamedUsable = state.streamed.trim().length >= MIN_STREAM_SWAP_CHARS;
    const explanation =
      state.finalExplanation ?? (streamedUsable ? state.streamed : (state.verdict?.explanation ?? ""));
    const divergent =
      state.localRisk !== null &&
      state.serverRisk !== null &&
      Math.abs(state.serverRisk - state.localRisk) > MATERIAL_RISK_GAP;
    return {
      ...state,
      explanation,
      isRefining: state.phase === "serverPending" && streamedUsable,
      isBusy: state.phase === "preparing" || state.phase === "local" || state.phase === "serverPending",
      chip: chipFor(state),
      divergent,
    };
  }, [state]);

  return { state: derived, run, reset, cancel };
}
