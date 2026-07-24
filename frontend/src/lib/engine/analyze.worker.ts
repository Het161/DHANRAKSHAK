/// <reference lib="webworker" />
/**
 * Runs the on-device engine off the UI thread. The engine (regex compile, tf-idf,
 * 300-tree traversal) is CPU-bound; keeping it here is what stops a cheap phone
 * from janking while it thinks. Artifacts load once, from cache when offline.
 */

import { LocalEngine } from "@/lib/engine";
import { loadArtifacts } from "@/lib/engine/artifacts";
import type { LanguageHint } from "@/lib/types";

export interface WorkerRequest {
  id: number;
  text: string;
  hint: LanguageHint;
}

let enginePromise: Promise<LocalEngine> | null = null;

function getEngine(): Promise<LocalEngine> {
  if (enginePromise === null) enginePromise = loadArtifacts().then((a) => new LocalEngine(a));
  return enginePromise;
}

// Warm the engine as soon as the worker spins up, so the first real check is hot.
void getEngine().then((engine) => postMessage({ id: 0, ok: true, version: engine.version }));

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, text, hint } = event.data;
  try {
    const engine = await getEngine();
    postMessage({ id, ok: true, result: engine.analyze(text, hint) });
  } catch (error) {
    postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
