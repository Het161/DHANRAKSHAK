/**
 * Test-only loader: assembles EngineArtifacts by reading public/engine/*.json
 * from disk, so parity runs in Node without a fetch/service-worker. In the app
 * the same bundle comes from artifacts.ts over HTTP.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EngineArtifacts } from "@/lib/engine/types";

const ENGINE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "public",
  "engine",
);

function read<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, name), "utf-8")) as T;
}

export function loadArtifactsFromDisk(): EngineArtifacts {
  const manifest = read<{ engine_version: string }>("manifest.json");
  return {
    version: manifest.engine_version,
    lexicons: read<{ lexicons: EngineArtifacts["lexicons"] }>("rules.json").lexicons,
    urlConfig: read("url_config.json"),
    upiConfig: read("upi_config.json"),
    templates: read("templates.json"),
    advisories: read<{ chunks: EngineArtifacts["advisories"] }>("advisories.json").chunks,
    model: read("model.json"),
    thresholds: read<{ thresholds: EngineArtifacts["thresholds"] }>("config.json").thresholds,
  };
}
