"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PermanentApiError, sendSimulatorTurn, startSimulator } from "@/lib/api";
import { loadPracticeEngine, type PracticeEngine, type PracticeSession } from "@/lib/practice/engine";
import { WAKE_UP_AFTER_MS, isAbort, retryTransient } from "@/lib/retry";
import type { Coach, Language, PersonaId, ScenarioPlanDebug } from "@/lib/types";

/** Everything ?debug=1 needs to prove the session was randomized. */
export interface SimulatorDebug {
  plan: ScenarioPlanDebug | null;
  sources: ("llm" | "fallback")[];
}

export type SimulatorPhase = "idle" | "starting" | "waking" | "ready" | "sending" | "error";

export type Entry =
  | { kind: "scammer"; id: number; text: string }
  | { kind: "user"; id: number; text: string }
  | { kind: "coach"; id: number; coach: Coach };

interface SimulatorState {
  phase: SimulatorPhase;
  entries: Entry[];
  score: number;
  turn: number;
  finished: boolean;
  errorMessage: string | null;
  debug: SimulatorDebug;
  /** True when this session is running on-device (offline), not via the server. */
  offline: boolean;
}

const INITIAL: SimulatorState = {
  phase: "idle",
  entries: [],
  score: 0,
  turn: 0,
  finished: false,
  errorMessage: null,
  debug: { plan: null, sources: [] },
  offline: false,
};

export function useSimulator() {
  const [state, setState] = useState<SimulatorState>(INITIAL);
  const sessionRef = useRef<string | null>(null);
  const offlineRef = useRef<{ engine: PracticeEngine; session: PracticeSession } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(0);

  const nextId = () => {
    nextIdRef.current += 1;
    return nextIdRef.current;
  };

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
    sessionRef.current = null;
    offlineRef.current = null;
    setState(INITIAL);
  }, [cancel]);

  const fail = useCallback((error: unknown) => {
    setState((prev) => ({
      ...prev,
      phase: "error",
      errorMessage: error instanceof PermanentApiError ? error.message : null,
    }));
  }, []);

  const start = useCallback(
    async (persona: PersonaId, lang: Language) => {
      cancel();
      const controller = new AbortController();
      controllerRef.current = controller;
      offlineRef.current = null;
      sessionRef.current = null;
      nextIdRef.current = 0;
      setState({ ...INITIAL, phase: "starting" });

      // Offline: run the whole session on-device from the precached pools.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        try {
          const engine = await loadPracticeEngine();
          const { session, opening } = engine.start(persona, lang);
          offlineRef.current = { engine, session };
          setState({
            ...INITIAL,
            phase: "ready",
            offline: true,
            entries: [{ kind: "scammer", id: nextId(), text: opening }],
            debug: {
              plan: {
                seed: session.plan.seed,
                opening: session.plan.opening,
                tactic_order: session.plan.tacticOrder,
                slots: session.plan.slots,
              },
              sources: [],
            },
          });
        } catch (error) {
          fail(error);
        }
        return;
      }

      wakeTimerRef.current = setTimeout(
        () => setState((prev) => (prev.phase === "starting" ? { ...prev, phase: "waking" } : prev)),
        WAKE_UP_AFTER_MS,
      );

      try {
        const response = await retryTransient(
          (signal) => startSimulator({ persona, lang }, signal),
          controller.signal,
          () => setState((prev) => ({ ...prev, phase: "waking" })),
        );
        clearWakeTimer();
        sessionRef.current = response.session_id;
        setState({
          ...INITIAL,
          phase: "ready",
          entries: [{ kind: "scammer", id: nextId(), text: response.scammer_text }],
          debug: { plan: response.plan ?? null, sources: [] },
        });
      } catch (error) {
        clearWakeTimer();
        if (isAbort(error) || controller.signal.aborted) return;
        fail(error);
      }
    },
    [cancel, clearWakeTimer, fail],
  );

  const send = useCallback(
    async (message: string) => {
      // Offline: score and answer on-device, synchronously.
      const offline = offlineRef.current;
      if (offline) {
        const result = offline.engine.turn(offline.session, message);
        setState((prev) => {
          const entries: Entry[] = [...prev.entries, { kind: "user", id: nextId(), text: message }];
          entries.push({ kind: "coach", id: nextId(), coach: result.coach });
          entries.push({ kind: "scammer", id: nextId(), text: result.scammerText });
          return {
            ...prev,
            phase: "ready",
            entries,
            score: result.score,
            turn: result.turn,
            finished: result.finished,
            debug: { ...prev.debug, sources: [...prev.debug.sources, "fallback"] },
          };
        });
        if (result.finished) offlineRef.current = null;
        return;
      }

      const sessionId = sessionRef.current;
      if (!sessionId) return;

      const controller = new AbortController();
      controllerRef.current = controller;
      setState((prev) => ({
        ...prev,
        phase: "sending",
        entries: [...prev.entries, { kind: "user", id: nextId(), text: message }],
      }));

      try {
        const response = await retryTransient(
          (signal) => sendSimulatorTurn({ session_id: sessionId, message }, signal),
          controller.signal,
          () => undefined,
        );
        setState((prev) => {
          const entries: Entry[] = [...prev.entries];
          if (response.coach) entries.push({ kind: "coach", id: nextId(), coach: response.coach });
          entries.push({ kind: "scammer", id: nextId(), text: response.scammer_text });
          return {
            ...prev,
            phase: "ready",
            entries,
            score: response.score,
            turn: response.turn,
            finished: response.finished,
            errorMessage: null,
            debug: {
              ...prev.debug,
              sources: [...prev.debug.sources, response.source ?? "fallback"],
            },
          };
        });
        if (response.finished) sessionRef.current = null;
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) return;
        fail(error);
      }
    },
    [fail],
  );

  return { state, start, send, reset };
}
