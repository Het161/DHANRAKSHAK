/**
 * Main-thread handle to the on-device engine.
 *
 * Prefers the Web Worker so analysis never blocks the UI; if a worker cannot be
 * created (old webview, blocked blob), it falls back to running the same engine
 * inline so a verdict is never lost. Requests are correlated by id.
 */

import type { LocalEngine } from "@/lib/engine";
import type { WorkerRequest } from "@/lib/engine/analyze.worker";
import type { LocalVerdict } from "@/lib/engine/types";
import type { LanguageHint } from "@/lib/types";

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: LocalVerdict;
  error?: string;
  version?: string;
}

type Pending = { resolve: (v: LocalVerdict) => void; reject: (e: Error) => void };

export class LocalAnalyzer {
  private worker: Worker | null = null;
  private inline: Promise<LocalEngine> | null = null;
  private seq = 1;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    this.spawnWorker();
  }

  private spawnWorker(): void {
    if (typeof window === "undefined" || typeof Worker === "undefined") return;
    try {
      // A standalone esbuild bundle (scripts/build-worker.mjs), served as a static
      // asset and precached, so it runs offline with no Next runtime dependency.
      const worker = new Worker("/engine-worker.js", { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, ok, result, error } = event.data;
        if (id === 0) return; // warm-up ping
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (ok && result) entry.resolve(result);
        else entry.reject(new Error(error ?? "engine failed"));
      };
      worker.onerror = () => this.retreatToInline();
      this.worker = worker;
    } catch {
      this.worker = null;
    }
  }

  /** Drop the worker and reject anything in flight so callers retry inline. */
  private retreatToInline(): void {
    this.worker = null;
    for (const [, entry] of this.pending) entry.reject(new Error("worker crashed"));
    this.pending.clear();
  }

  private async runInline(text: string, hint: LanguageHint): Promise<LocalVerdict> {
    if (this.inline === null) {
      this.inline = (async () => {
        const [{ LocalEngine }, { loadArtifacts }] = await Promise.all([
          import("@/lib/engine"),
          import("@/lib/engine/artifacts"),
        ]);
        return new LocalEngine(await loadArtifacts());
      })();
    }
    return (await this.inline).analyze(text, hint);
  }

  analyze(text: string, hint: LanguageHint): Promise<LocalVerdict> {
    const worker = this.worker;
    if (!worker) return this.runInline(text, hint);

    const id = (this.seq += 1);
    const request: WorkerRequest = { id, text, hint };
    return new Promise<LocalVerdict>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(request);
    }).catch((error) => {
      // A worker that died mid-request still owes an answer: retry inline once.
      if (!this.worker) return this.runInline(text, hint);
      throw error;
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

let singleton: LocalAnalyzer | null = null;

/** The app's shared on-device analyzer, created on first use in the browser. */
export function localAnalyzer(): LocalAnalyzer {
  if (singleton === null) singleton = new LocalAnalyzer();
  return singleton;
}
