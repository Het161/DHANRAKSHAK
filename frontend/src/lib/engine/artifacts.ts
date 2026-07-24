/**
 * Loads the exported engine artifacts from /engine/*.json and assembles the
 * typed bundle the LocalEngine needs. Runs in the Web Worker; the service worker
 * precaches these files, so the fetch resolves from cache when offline.
 */

import type {
  AdvisoryChunk,
  EngineArtifacts,
  LexiconPayload,
  ModelArtifact,
  Templates,
  Thresholds,
  UpiConfig,
  UrlConfig,
} from "@/lib/engine/types";

const BASE = "/engine";

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`${BASE}/${name}`, { cache: "force-cache" });
  if (!response.ok) throw new Error(`engine artifact ${name} failed: ${response.status}`);
  return (await response.json()) as T;
}

export async function loadArtifacts(): Promise<EngineArtifacts> {
  const [manifest, rules, urlConfig, upiConfig, templates, advisories, model, config] = await Promise.all([
    fetchJson<{ engine_version: string }>("manifest.json"),
    fetchJson<{ lexicons: LexiconPayload[] }>("rules.json"),
    fetchJson<UrlConfig>("url_config.json"),
    fetchJson<UpiConfig>("upi_config.json"),
    fetchJson<Templates>("templates.json"),
    fetchJson<{ chunks: AdvisoryChunk[] }>("advisories.json"),
    fetchJson<ModelArtifact>("model.json"),
    fetchJson<{ thresholds: Thresholds }>("config.json"),
  ]);

  return {
    version: manifest.engine_version,
    lexicons: rules.lexicons,
    urlConfig,
    upiConfig,
    templates,
    advisories: advisories.chunks,
    model,
    thresholds: config.thresholds,
  };
}
