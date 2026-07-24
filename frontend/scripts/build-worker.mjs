/*
 * Bundle the on-device engine worker into a standalone module at
 * public/engine-worker.js.
 *
 * Next's `new Worker(new URL(...))` does not self-bootstrap under output:"export",
 * so the worker is built here as a self-contained ES module with esbuild (the @/
 * alias resolved to src). The result is a plain static asset: precached by the
 * service worker and runnable fully offline, with no Next runtime dependency.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, "src/lib/engine/analyze.worker.ts")],
  outfile: path.join(root, "public/engine-worker.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "none",
  alias: { "@": path.join(root, "src") },
  banner: { js: "/* DhanRakshak on-device engine worker - generated, do not edit */" },
});

console.log("built public/engine-worker.js");
