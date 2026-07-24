/*
 * Post-build: inject the precache manifest into the exported service worker.
 *
 * Runs after `next build` (which has copied public/sw.js verbatim to out/sw.js).
 * It scans out/ for the app shell, CSS, JS chunks, engine artifacts, icons and
 * HTML routes, then rewrites out/sw.js with that list plus a content-derived
 * BUILD_ID and the engine_version. It also reports the total gzipped offline
 * payload against the 1.5MB budget.
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "out");
const BUDGET_BYTES = 1.5 * 1024 * 1024;

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** Map an out/ file to the URL the browser will request. */
function toUrl(rel) {
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"/index.html".length);
  if (rel.endsWith(".html")) return "/" + rel.slice(0, -".html".length);
  return "/" + rel;
}

function shouldPrecache(rel) {
  if (rel === "sw.js") return false; // never cache the worker itself
  if (rel.endsWith(".map")) return false; // source maps are dev-only weight
  if (rel === "404.html" || rel === "_not-found.html") return false;
  return true;
}

if (!fs.existsSync(OUT)) {
  console.error("gen-sw-precache: out/ not found - run `next build` first");
  process.exit(1);
}

const engineVersion = JSON.parse(
  fs.readFileSync(path.join(OUT, "engine", "manifest.json"), "utf-8"),
).engine_version;

const all = walk(OUT)
  .map((f) => path.relative(OUT, f).split(path.sep).join("/"))
  .filter(shouldPrecache)
  .sort();

const urls = [...new Set(all.map(toUrl))];

// BUILD_ID: a hash of every precached file's bytes, so any content change keys a
// fresh cache. Cheap enough at this corpus size.
const hash = createHash("sha256");
let totalGzip = 0;
const byType = {};
for (const rel of all) {
  const bytes = fs.readFileSync(path.join(OUT, rel));
  hash.update(bytes);
  const gz = gzipSync(bytes, { level: 9 }).length;
  totalGzip += gz;
  const ext = path.extname(rel) || "other";
  byType[ext] = (byType[ext] || 0) + gz;
}
const buildId = hash.digest("hex").slice(0, 12);

const swPath = path.join(OUT, "sw.js");
const template = fs.readFileSync(swPath, "utf-8");
const injected = template
  .replace("__BUILD_ID__", buildId)
  .replace("__ENGINE_VERSION__", engineVersion)
  .replace("__PRECACHE_MANIFEST__", JSON.stringify(urls));
fs.writeFileSync(swPath, injected);

const kb = (n) => (n / 1024).toFixed(1) + "KB";
console.log(`\nservice worker precache (build ${buildId}, engine ${engineVersion}):`);
console.log(`  files: ${urls.length}`);
for (const [ext, size] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ext.padEnd(8)} ${kb(size)}`);
}
console.log(`  TOTAL offline payload: ${kb(totalGzip)} gzipped (budget ${kb(BUDGET_BYTES)})`);
if (totalGzip > BUDGET_BYTES) {
  console.error(`  OVER BUDGET by ${kb(totalGzip - BUDGET_BYTES)}`);
  process.exit(1);
}
console.log(`  under budget by ${kb(BUDGET_BYTES - totalGzip)}\n`);
