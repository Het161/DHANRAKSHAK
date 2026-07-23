# DhanRakshak frontend

Next.js App Router + TypeScript + Tailwind v4. Mobile-first, installable as a PWA,
built to work on a cheap Android phone over a slow connection.

## Running it

The backend must be running first (see `../backend/README.md`).

```bash
cd frontend
npm install
cp .env.local.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                          # http://localhost:3000
```

The backend needs this origin in its allowlist:

```bash
cd ../backend
CORS_ORIGINS=http://localhost:3000 ../.venv/bin/python -m uvicorn app.main:app --port 8000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config, `next/core-web-vitals` + `next/typescript`) |

## How it is put together

```
src/
  lib/types.ts        Mirror of backend/app/schemas/contracts.py. The contract.
  lib/api.ts          Fetch + SSE parsing. Splits transient from permanent failures.
  lib/retry.ts        One cold-start retry policy, shared by both hooks.
  lib/spans.ts        Overlapping evidence spans to flat, tappable segments.
  lib/caps.ts         Input limits mirroring the backend, checked before upload.
  lib/preferences.ts  Language and elder mode, via useSyncExternalStore.
  hooks/useAnalyze.ts   Owns the analyze stream. Components only read its state.
  hooks/useSimulator.ts Owns the practice session.
  hooks/useRecorder.ts  MediaRecorder wrapper with the 90s cap built in.
  i18n/               en.ts defines the key set; hi.ts and gu.ts must satisfy it.
  components/         Presentational. No component fetches anything itself.
```

Three decisions worth knowing before changing anything:

**The verdict is never blocked on the explanation.** `useAnalyze` renders the
`verdict` event the moment it arrives, complete with its template explanation. Tokens
that stream afterwards replace the wording only once there are enough of them to be
worth swapping in (`MIN_STREAM_SWAP_CHARS`), so the panel never blanks. The `done`
payload is authoritative for the final text and its source.

**Evidence spans index into `analyzed_text`, not into what the user typed.** The
backend normalizes input before scoring, so offsets refer to the normalized string,
which every response echoes back. `segmentByFlags` sweeps span boundaries rather than
nesting elements, because two tactics regularly overlap in one sentence.

**Nothing analyzed is ever persisted.** Only `dr.lang` and `dr.elder` are written to
localStorage, both UI preferences. Message text, transcripts and verdicts live in
React state and die with the tab. The service worker caches the app shell only and
never touches `/api`.

## Elder mode

One toggle sets `font-size: 22px` on `<html>` (1.4x). Because Tailwind sizes and
spacing are rem-based, type, padding and tap targets all scale from that single
declaration. Elder mode also reorders the input tabs to put Voice first and drops
the tab grid to two columns.

## Deploying to Vercel

1. Push the monorepo to GitHub.
2. Vercel → **Add New → Project** → import the repository.
3. Set **Root Directory** to `frontend`. Framework preset is detected as Next.js;
   leave the build and output settings alone.
4. Add the environment variable, for **Production, Preview and Development**:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://<your-render-service>.onrender.com` |

   No trailing slash. It is a `NEXT_PUBLIC_` variable, so it is baked in at build
   time: changing it later requires a redeploy, not just a restart.
5. Deploy.
6. **Then go back to Render** and set `CORS_ORIGINS` on the backend to the Vercel
   domain, comma-separated if you want previews too, and redeploy the backend:

   ```
   CORS_ORIGINS=https://dhanrakshak.vercel.app,http://localhost:3000
   ```

   Until this is done the browser blocks every call and the app will look broken
   while the backend logs nothing wrong. This is the single most common way to get
   a dead demo.

There are no server-side secrets in this app and no API routes, so every page is
static and served from the edge. Nothing else needs configuring.

### Checking a deploy

- Open the site. A first-time visitor should see the Gujarati-first language chooser.
- Paste a scam SMS and press Check. The verdict card must appear within a second or
  two of the backend responding; if the backend was asleep you should see
  "Waking up the guardian", not a spinner or an error.
- Open DevTools → Application → Manifest to confirm the PWA is installable, and
  Network to confirm `/api/analyze` returns `text/event-stream`.
