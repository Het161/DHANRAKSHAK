# DhanRakshak

An AI guardian that detects financial scams — scam SMS and WhatsApp texts, phishing
URLs, fake UPI collect requests, scam call recordings, screenshots — and explains the
verdict in Gujarati, Hindi or English for first-time digital banking users in rural India.

This repository is a monorepo:

| Directory   | What it is                                                        |
| ----------- | ----------------------------------------------------------------- |
| `backend/`  | FastAPI service. Detection engine, explainer, simulator. This doc. |
| `frontend/` | Next.js PWA. See `frontend/README.md`, including Vercel deploy.    |

Run both locally:

```bash
# terminal 1
cd backend && CORS_ORIGINS=http://localhost:3000 ../.venv/bin/python -m uvicorn app.main:app --port 8000

# terminal 2
cd frontend && npm install && npm run dev
```

## The one architectural rule: two run modes, one codebase

Nothing in the application branches on "local" or "hosted". Both are consequences of
which provider names are configured:

| | LOCAL (offline demo) | HOSTED (the live link) |
| --- | --- | --- |
| LLM | Ollama, `qwen3:4b` | Groq, `llama-3.3-70b-versatile` |
| Speech | `faster-whisper`, if installed | Groq `whisper-large-v3-turbo` |
| Set with | `LLM_PROVIDER=ollama STT_PROVIDER=local` | `LLM_PROVIDER=groq STT_PROVIDER=groq` |

`LLMProvider` and `STTProvider` are abstract interfaces with one implementation each per
mode. `faster-whisper` is imported inside the method that uses it, so the hosted image
never needs the package and stays small enough to boot fast on a 512MB instance.

## The degradation ladder

The live link must never break. The API returns a complete `AnalyzeResponse` in every
tier; an outage upstream costs wording quality, never functionality.

| Tier | What it does | Depends on | If it fails |
| --- | --- | --- | --- |
| 1 | Verdict, risk score, evidence spans | nothing — pure Python, in-memory | cannot fail |
| 2 | Advisory snippet via in-process BM25 | nothing — no network, no vector DB | returns no advisory |
| 3 | Plain-language explanation | LLM provider, 8s hard budget | pre-written per-tactic templates in gu/hi/en |

Two consequences worth stating plainly:

- **The engine decides; the LLM only translates.** The prompt receives the engine's
  signals, never the user's original message, so the model cannot re-decide the verdict.
- **The `verdict` SSE event is emitted before the LLM is called**, and already contains a
  complete answer including a template explanation. Tokens that stream in afterwards are
  an upgrade. If the connection drops mid-stream, the client already has a correct result.

Measured locally: the engine path returns in **1–5ms**, well inside the 150ms budget.

## API

All endpoints are under `/api`.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/analyze` | `AnalyzeRequest` JSON | SSE stream |
| POST | `/analyze/image` | multipart `file`, `language_hint` | SSE stream |
| POST | `/analyze/audio` | multipart `file`, `language_hint` | SSE stream |
| POST | `/simulator/start` | `StartRequest` | `StartResponse` |
| POST | `/simulator/turn` | `TurnRequest` | `TurnResponse` |
| POST | `/simulator/voice-turn` | `VoiceTurnRequest` | SSE stream |
| POST | `/tts` | `TTSRequest` | `audio/mpeg` stream |
| GET | `/health` | — | `HealthResponse` |

SSE events share one envelope, `{"type": ..., "payload": ...}`, in this order:

1. `verdict` — a complete `AnalyzeResponse` (verdict, risk score, localized flags with
   evidence spans, advisory, actions, template explanation, and `analyzed_text`).
2. `token` — `{"text": "..."}`, repeated, as the explanation streams.
3. `done` — `{"explanation", "explanation_source": "llm"|"template", "latency_ms"}`.
   This is authoritative: it carries the final text whichever tier produced it.
4. `error` — only if the stream itself fails after it has already opened.

Evidence spans are character offsets into `analyzed_text`, not into what the client sent,
because input is normalized (Unicode NFC, invisible characters stripped) before scoring.
For image and audio input, `analyzed_text` is the only copy of the extracted text.

## Voice call mode

Practice offers two modes. Text chat is unchanged. Voice call is a spoken
conversation: the scam caller speaks in a neural voice, the user answers out loud,
and either side can interrupt the other.

**Why it is fast.** edge-tts costs about a second to the first audio byte on every
call and does not warm up, measured. A pipeline that waits for the model, cuts a
sentence, then synthesises it cannot beat roughly 1.5s. So the caller's immediate
reply is a scripted line whose audio is already on disk, and the model's reaction to
what the user actually said is synthesised while that line is still playing and
queued behind it. The user hears a reply in tens of milliseconds and still gets a
conversation that responds to them.

| Stage | Measured |
| --- | --- |
| Opening line (cached) | 2-4ms |
| User stops speaking to caller audible | **18-23ms**, all three languages |
| Model reaction, queued behind the scripted line | 350-1100ms |
| Live synthesis of unseen text (cache miss) | 900-1200ms |

The pieces:

- **Speech in** is the browser's own `SpeechRecognition`, streaming, with the session
  locale. No audio upload in the happy path. Browsers without it (iOS Safari) get a
  push-to-talk button that records and posts to the existing `/api/analyze/audio`
  path for Groq transcription, which is slower and works everywhere.
- **Brain** is `GROQ_VOICE_MODEL` (default `llama-3.1-8b-instant`) under a voice-register
  prompt that forces one or two spoken sentences.
- **Speech out** is edge-tts. Voices are discovered from the live catalogue at startup
  by locale and gender, never hardcoded blindly, and every predictable line is
  pre-synthesised: opening lines for all four personas at boot, and the rest of a
  scenario's script in the background the moment a call starts.
- **Barge-in**: when recognition reports speech while the caller is talking, playback
  stops instantly and every queued sentence is marked stale by a generation counter.

Degradation, in order: model unreachable, the scripted line still plays from cache;
edge-tts unreachable, the server emits `tts_unavailable` and the browser speaks with
`speechSynthesis`; recognition unsupported or refused, push-to-talk. The call never dies.

`?debug=1` on `/simulator` shows a per-turn overlay of the real numbers: transcript to
first sentence event, and sentence event to audio audible.

**Microphones need a secure context.** `localhost` is fine; anywhere else needs HTTPS.
Testing on a phone over the LAN therefore needs a tunnel (`ngrok http 3000`) or a
self-signed certificate, not a bare `http://192.168.x.x`.

## Running it

Requires Python 3.11+ and Tesseract (`brew install tesseract` or
`apt-get install tesseract-ocr tesseract-ocr-hin tesseract-ocr-guj`).

```bash
cd backend
python -m venv ../.venv && ../.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # then fill in GROQ_API_KEY, or switch to Ollama
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

`GET /api/health` reports the mode, which providers are configured, whether the classifier
artifact loaded, which Tesseract language packs are present, and how many advisories,
lexicons and template languages were indexed. It reports `degraded` rather than failing
when the LLM is unconfigured — because the service still answers every request correctly.

### Local mode

```bash
ollama pull qwen3:4b
LLM_PROVIDER=ollama STT_PROVIDER=local OLLAMA_URL=http://localhost:11434 \
  ../.venv/bin/python -m uvicorn app.main:app --port 8000
```

Speech recognition in local mode needs the optional extra:
`pip install -r requirements-local.txt`.

### Verifying it works

```bash
../.venv/bin/python scripts/check_detection.py   # 10 fixed samples, verdicts + latency
../.venv/bin/python scripts/eval_corpus.py       # confusion matrix over data/corpus
../.venv/bin/python -m pytest                    # 78 tests
```

`scripts/check_detection.py` prints the matched signals and the evidence span for each
sample, which is the fast loop when tuning a lexicon. `eval_corpus.py` is the guard
against the expensive kind of mistake: a genuine bank SMS scored as a scam teaches users
to ignore the warning.

Current results — rules tier, 36-row seed corpus: **precision 1.000, recall 1.000**.

### Training the classifier

```bash
../.venv/bin/python scripts/train_classifier.py
```

Downloads the UCI SMS Spam Collection, merges it with `data/corpus/labelled.csv`,
fits TF-IDF (word + character n-grams) into LightGBM, prints precision and recall per
data slice, and writes `models/scam_clf.joblib`. It never runs at server startup, and a
missing artifact is a warning, not a crash.

**Read this before trusting the classifier.** Measured on the seed corpus, the artifact
returns 0.99 for a harmless Hindi family message and 0.00 for a real lottery scam: it is
fitted on English marketing spam, so Devanagari, Gujarati and Indian transactional SMS are
all out of distribution. The engine therefore constrains it, in `detection/classifier.py`
and `detection/fusion.py`, to what it can actually support:

- It is not consulted at all on text under 25 characters or less than 60% Latin script.
- `P(scam)` below `CLASSIFIER_MIN_PROB` (0.85) contributes nothing; above it, the
  remainder is stretched across `CLASSIFIER_WEIGHT` (0.5).
- It enters the same noisy-OR as every other signal, so it can raise suspicion on
  phrasing the lexicons have never seen but can never lower a score or drive a verdict.

The rules tier carries Gujarati and Hindi, and does so at 1.00/1.00 on the seed corpus.
Improving the classifier means adding Indic rows to `data/corpus/labelled.csv` and
retraining — not raising its weight.

## Deploying to Render

`render.yaml` is a blueprint; or configure manually:

1. New → Web Service → connect this repository.
2. Runtime **Docker**, root directory `backend`, health check path `/api/health`.
3. Environment variables: `GROQ_API_KEY` (secret) and `CORS_ORIGINS` set to the Vercel
   domain that will serve the frontend. The rest have working defaults.
4. Deploy. The image installs the Hindi and Gujarati Tesseract packs and starts one
   uvicorn worker bound to `$PORT`.

The Dockerfile runs as a non-root user and excludes `faster-whisper` and torch, which is
what keeps it inside the free tier's memory budget.

## Scaling and operations

**The service is stateless.** No database, no session store on disk, nothing written
anywhere. Simulator sessions live in a bounded in-memory TTL map, and losing them on a
restart costs a user one click. Horizontal scaling is therefore just adding instances
behind the load balancer — there is no shared state to coordinate and no sticky sessions
to configure.

- **Rate limiting** — 20/min per IP on analyze, 60/min overall, via slowapi. Behind
  Render's proxy the client is read from the left-most `X-Forwarded-For` entry, so every
  visitor does not share the load balancer's bucket. Exceeding a limit returns a friendly
  JSON 429, not an HTML error page.
- **Caching** — SHA-256 of the normalized input to the finished response, 500 entries,
  15-minute TTL. Repeated demo inputs are instant and cost no Groq quota. In RAM only,
  never written to disk; set `CACHE_SIZE=0` to disable.
- **Input caps** — 10,000 characters, 5MB images, 10MB / 90s audio. Uploads are read one
  byte past the cap so an oversized file is rejected without being buffered in full.
  Rejections are 413 or 422 with a sentence a user can act on.
- **Timeouts** — 8s on the LLM (a hard ceiling, not a target), 30s speech, 15s OCR. One
  shared `httpx.AsyncClient` for the process, so connections are reused.
- **Startup** — lexicons, the classifier, the BM25 index and templates all load once in
  the lifespan, so no request path touches the filesystem. Provider warm-up runs as a
  background task, so a slow or unreachable provider cannot delay the health check.
- **Errors** — a global handler returns clean JSON. A stack trace never reaches a client.

### Privacy

Privacy is the feature, not a setting. Nothing a user sends is persisted. The analyze log
line records mode, input type, language, verdict, risk score, tier, latency and character
count — never the message, the transcript, or the OCR text:

```
analyze mode=hosted input=text lang=gu verdict=scam risk=81 tier=template engine_ms=3 latency_ms=8 chars=112
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `groq` | `groq`, `ollama`, or `none`. Also selects the reported mode. |
| `STT_PROVIDER` | `groq` | `groq`, `local`, or `none`. |
| `GROQ_API_KEY` | — | Required in hosted mode. Without it the service runs on templates. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Primary explanation model. |
| `GROQ_FALLBACK_MODEL` | `llama-3.1-8b-instant` | Retried once on a 429 before templates. |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` | Transcription model. |
| `OLLAMA_URL` | `http://localhost:11434` | Local mode LLM endpoint. |
| `OLLAMA_MODEL` | `qwen3:4b` | Local mode model. |
| `LOCAL_WHISPER_MODEL` | `small` | Only used when `STT_PROVIDER=local`. |
| `LLM_TIMEOUT_S` | `8.0` | Hard budget for tier 3, after which templates answer. |
| `CORS_ORIGINS` | localhost:3000, :5173 | Comma-separated allowlist. Never `*`. |
| `RATE_LIMIT_ANALYZE` | `20/minute` | Per-IP limit on the analyze endpoints. |
| `RATE_LIMIT_DEFAULT` | `60/minute` | Per-IP limit overall. |
| `CACHE_SIZE` / `CACHE_TTL_S` | `500` / `900` | Response cache. `0` disables. |
| `RISK_SUSPICIOUS_THRESHOLD` | `35` | Score at or above which the verdict is `suspicious`. |
| `RISK_SCAM_THRESHOLD` | `65` | Score at or above which the verdict is `scam`. |
| `CLASSIFIER_WEIGHT` | `0.5` | Ceiling on the classifier's risk contribution. |
| `CLASSIFIER_MIN_PROB` | `0.85` | `P(scam)` below this counts as no evidence. |
| `MAX_TEXT_CHARS` | `10000` | Text input cap. |
| `MAX_IMAGE_BYTES` | `5242880` | Image cap. |
| `MAX_AUDIO_BYTES` / `MAX_AUDIO_SECONDS` | `10485760` / `90` | Audio caps. |
| `LOG_LEVEL` | `INFO` | Standard logging level. |
| `GROQ_VOICE_MODEL` | `llama-3.1-8b-instant` | Model for voice turns. Latency over eloquence. |
| `VOICE_LLM_MAX_TOKENS` | `160` | Indic scripts need headroom or replies truncate. |
| `VOICE_LLM_TIMEOUT_S` | `6.0` | After this the scripted line stands alone. |
| `VOICE_MAX_SENTENCES` | `2` | Sentences the caller may add per turn. |
| `TTS_ENABLED` | `true` | `false` disables `/api/tts` and voice mode. |
| `TTS_TIMEOUT_S` | `5.0` | Per-synthesis ceiling before degrading to browser speech. |
| `TTS_DISCOVERY_TIMEOUT_S` | `8.0` | Startup voice-catalogue fetch. |
| `TTS_CACHE_DIR` | `/tmp/tts-cache` | Pre-synthesised audio. Generated lines only, never user input. |
| `TTS_CACHE_MAX_BYTES` | `209715200` | Cache cap; oldest entries evicted first. |
| `TTS_PREWARM_ENABLED` | `true` | Warm opening lines at boot and scripts per call. |
| `TTS_PREWARM_CONCURRENCY` | `8` | Parallel synthesis during warming. |
| `RATE_LIMIT_TTS` | `120/minute` | Per-IP limit on `/api/tts`. |

## Layout

```
backend/app/
  detection/     rules, urls, upi, classifier, fusion, engine   (tier 1: decides)
  explain/       rag, prompt, templates, providers, service     (tiers 2 and 3: translates)
  pipelines/     ocr, audio, language, normalize                (any input -> CleanInput)
  simulator/     personas, coach, session, service              (training mode)
  api/           routes, sse, limits, errors
  schemas/       contracts.py  (Pydantic v2, the locked request and response shapes)
backend/data/
  lexicons/      tactic detectors as data, not code
  advisories/    RBI / NPCI / I4C summaries with front matter
  templates/     per-tactic explanations in gu, hi, en
  personas/      simulator scripts, including no-LLM fallbacks
  corpus/        labelled seed examples
```

## Extending it

Everything a contributor is likely to change is data, not code:

- **New scam tactic** — add `data/lexicons/<name>.json`, add the same key to all three
  `data/templates/explanations.*.json`, run `scripts/eval_corpus.py`. No Python changes.
  Terms are matched case-insensitively; Latin terms match whole words with common
  inflections, Indic terms anchor at the start to allow suffixes. Use `patterns` for
  proximity rules, and `veto_patterns` to suppress a tactic on a known false positive.
- **New advisory** — drop a markdown file with front matter into `data/advisories/`.
  It is chunked and indexed at startup; the `tactics:` list is what routes flags to it.
- **New simulator persona** — add `data/personas/<name>.json` including `scripted_turns`,
  which is what makes the persona work when no LLM is reachable, and add the id to
  `PersonaId` in `schemas/contracts.py`.

### On the seed data

`data/` is clearly marked seed content, written for this project and intended to be
extended. The advisory documents are **plain-language summaries** of public guidance from
the RBI, NPCI and I4C, each carrying an attribution note saying so; they are not official
publications, and they contain no invented circular numbers, dates or statistics. The
`ref` values are internal identifiers. The only helpline referenced is the real national
cybercrime number, 1930, and cybercrime.gov.in. Corpus rows are written examples, not real
user messages.
