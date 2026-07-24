/**
 * The generated service worker must precache everything the app needs to open and
 * fully render offline: the shell routes, CSS, a JS chunk, and every engine
 * artifact. Guards against a build that silently drops the offline promise.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "out");
const swPath = path.join(OUT, "sw.js");

describe("service worker precache manifest", () => {
  const exists = fs.existsSync(swPath);
  it.skipIf(!exists)("covers shell, engine artifacts and assets, with no placeholders left", () => {
    const sw = fs.readFileSync(swPath, "utf-8");
    expect(sw).not.toContain("__BUILD_ID__");
    expect(sw).not.toContain("__PRECACHE_MANIFEST__");

    const list = JSON.parse(sw.match(/PRECACHE = (\[.*?\]);/s)![1]!) as string[];
    const required = [
      "/",
      "/simulator",
      "/welcome",
      "/engine/model.json",
      "/engine/rules.json",
      "/engine/templates.json",
      "/engine/personas.json",
      "/manifest.webmanifest",
    ];
    for (const url of required) expect(list, `missing ${url}`).toContain(url);
    expect(list.some((u) => u.endsWith(".css"))).toBe(true);
    expect(list.some((u) => u.startsWith("/_next/static/") && u.endsWith(".js"))).toBe(true);
  });

  if (!exists) it("(run `npm run build` first to check the generated worker)", () => expect(true).toBe(true));
});
