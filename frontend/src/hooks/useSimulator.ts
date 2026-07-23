"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PermanentApiError, sendSimulatorTurn, startSimulator } from "@/lib/api";
import { WAKE_UP_AFTER_MS, isAbort, retryTransient } from "@/lib/retry";
import type { Coach, Language, PersonaId } from "@/lib/types";

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
}

const INITIAL: SimulatorState = {
  phase: "idle",
  entries: [],
  score: 0,
  turn: 0,
  finished: false,
  errorMessage: null,
};

export function useSimulator() {
  const [state, setState] = useState<SimulatorState>(INITIAL);
  const sessionRef = useRef<string | null>(null);
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
      nextIdRef.current = 0;
      setState({ ...INITIAL, phase: "starting" });
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
