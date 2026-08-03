/*
 * Automated proof of the offline promise, in a real browser.
 *
 * Serves the static export the way Netlify does (exact file -> `.html` ->
 * `/index.html`), then drives headless Chrome over the DevTools Protocol through
 * the exact journey a rural user takes: load once ONLINE, let the service worker
 * precache, switch the network OFF, reload, and run a full on-device verdict in
 * both English and Gujarati. Exits non-zero if either verdict fails to render,
 * so it can gate a deploy.
 *
 * Zero dependencies: Node's global WebSocket (>=21) speaks CDP directly, and a
 * tiny inline static server stands in for the host. Requires Google Chrome; set
 * CHROME_PATH to override the macOS default.
 *
 * Usage:  npm run build && node scripts/verify-offline.mjs
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "out");
const PORT = 4188;
const CDP_PORT = 9345;
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

// Netlify-style resolution: exact file, then `${p}.html`, then `${p}/index.html`.
function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const direct = path.join(OUT, clean);
  const tries = [direct];
  if (!path.extname(clean)) tries.push(direct + ".html", path.join(direct, "index.html"));
  if (clean === "/") tries.unshift(path.join(OUT, "index.html"));
  return tries.find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404).end("404");
      return;
    }
    const headers = { "content-type": MIME[path.extname(file)] || "application/octet-stream" };
    if (req.url.split("?")[0] === "/sw.js") headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// --- minimal CDP client ----------------------------------------------------
let msgId = 0;
function send(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve) => {
    const handler = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", handler);
        resolve(m.result);
      }
    };
    ws.addEventListener("message", handler);
  });
}
const evalJs = async (ws, s, expr) =>
  (await send(ws, "Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, s))
    ?.result?.value;

async function chromeWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a CDP endpoint");
}

// One online->offline->analyze run for a given language. Returns true on a verdict.
async function runLang(ws, base, lang) {
  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  await send(ws, "Page.enable", {}, sessionId);
  await send(ws, "Runtime.enable", {}, sessionId);
  await send(ws, "Network.enable", {}, sessionId);

  // Seed a returning user (onboarding done) so we land on the analyzer.
  await send(ws, "Page.navigate", { url: base + "/welcome" }, sessionId);
  await sleep(1500);
  await evalJs(ws, sessionId, `localStorage.setItem('dr.onboarded','1');localStorage.setItem('dr.lang','${lang}')`);
  await send(ws, "Page.navigate", { url: base + "/" }, sessionId);

  // Wait for the worker to control the page and finish precaching.
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const s = await evalJs(
      ws,
      sessionId,
      `(async()=>{const r=await navigator.serviceWorker.getRegistration();const k=await caches.keys();let n=0;if(k.length)n=(await (await caches.open(k[0])).keys()).length;return JSON.stringify({c:navigator.serviceWorker.controller?1:0,n});})()`,
    );
    const j = JSON.parse(s);
    if (j.c && j.n > 0) {
      ready = true;
      break;
    }
    await sleep(1000);
  }
  if (!ready) throw new Error(`[${lang}] worker never precached`);

  // Airplane mode, then reload from cache.
  await send(ws, "Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, sessionId);
  await send(ws, "Page.reload", {}, sessionId);
  await sleep(3500);

  const verdict = await evalJs(
    ws,
    sessionId,
    `(async()=>{
      const ta=document.querySelector('textarea'); if(!ta) return 'NO_TEXTAREA';
      const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      set.call(ta,'Your account will be blocked today. Enter your UPI PIN now to receive Rs 5000 refund.');
      ta.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,200));
      const go=[...document.querySelectorAll('button')].find(b=>/check|analy|તપાસ|જુઓ|जांच|जाँच|देख/i.test(b.textContent||''));
      if(go) go.click();
      for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,300)); const t=document.body.innerText;
        if(/scam|suspicious|safe|risk|જોખમ|કૌભાંડ|સુરક્ષિત|धोखा|जोखिम|सुरक्षित|घोटाला/i.test(t)&&t.length>350)
          return t.replace(/\\s+/g,' ').slice(0,200);
      }
      return 'NO_VERDICT';
    })()`,
  );
  await send(ws, "Target.closeTarget", { targetId });
  const ok = verdict !== "NO_TEXTAREA" && verdict !== "NO_VERDICT";
  console.log(`  [${lang}] ${ok ? "VERDICT ✓" : "FAILED ✗"} :: ${verdict}`);
  return ok;
}

// --- orchestrate -----------------------------------------------------------
if (!fs.existsSync(path.join(OUT, "sw.js"))) {
  console.error("out/sw.js not found — run `npm run build` first.");
  process.exit(1);
}
if (!fs.existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to your Chrome binary.`);
  process.exit(1);
}

const server = await startServer();
const base = `http://127.0.0.1:${PORT}`;
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=/tmp/dr-verify-offline-${Date.now()}`,
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
]);

let code = 0;
try {
  const ws = new WebSocket(await chromeWsUrl());
  await new Promise((r) => (ws.onopen = r));
  console.log("offline verification (online → airplane mode → reload → on-device verdict):");
  const en = await runLang(ws, base, "en");
  const gu = await runLang(ws, base, "gu");
  ws.close();
  code = en && gu ? 0 : 1;
  console.log(code === 0 ? "\nPASS — the app works fully offline." : "\nFAIL — offline verdict did not render.");
} catch (err) {
  console.error("verification error:", err.message);
  code = 1;
} finally {
  try {
    chrome.kill();
  } catch {
    /* already gone */
  }
  server.close();
}
process.exit(code);
