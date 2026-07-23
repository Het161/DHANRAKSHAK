"use client";

import { useEffect, useState } from "react";

import { CallController, INITIAL_STATE, type VoiceCallState } from "@/lib/callController";

export type { CallOptions, CallPhase, VoiceCallState, SentenceTiming } from "@/lib/callController";

/**
 * Thin adapter over CallController. The controller owns every piece of mutable
 * call state as instance fields and pushes snapshots here; React only renders.
 */
export function useVoiceCall() {
  const [state, setState] = useState<VoiceCallState>(INITIAL_STATE);
  // Constructed once; a plain value, so its methods are safe to read in render.
  const [controller] = useState(() => new CallController(setState));

  useEffect(() => controller.teardown, [controller]);

  return {
    state,
    start: controller.start,
    end: controller.end,
    reset: controller.reset,
    interrupt: controller.interrupt,
    toggleMute: controller.toggleMute,
    submitSpoken: controller.submitSpoken,
    attachAudio: controller.attachAudio,
  };
}
