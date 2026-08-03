<div align="center">

<img src="docs/hero.svg" alt="DhanRakshak — on-device, offline-first scam guardian" width="100%"/>

<br/>

![On-device parity](https://img.shields.io/badge/on--device_parity-20%2F20_within_±5-0e7c5a?style=for-the-badge)
![Tests](https://img.shields.io/badge/tests-84_backend_+_31_frontend-0e7c5a?style=for-the-badge)
![Offline](https://img.shields.io/badge/offline_PWA-~636KB-0e7c5a?style=for-the-badge)

![Next.js](https://img.shields.io/badge/Next.js-000?style=flat-square&logo=nextdotjs)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white)
![Languages](https://img.shields.io/badge/ગુજરાતી_·_हिन्दी_·_English-083527?style=flat-square)

**A scam guardian that runs the _real_ detector on your phone — in your language, even with no internet.**

[**🔗 Live demo**](https://dhanrakshakai.netlify.app) · [Backend docs](backend/README.md) · [Frontend docs](frontend/README.md)

</div>

---

## What it does

You paste or forward a suspicious **SMS, WhatsApp message, link, screenshot, or call recording**. DhanRakshak tells you — in **Gujarati, Hindi, or English** — whether it is a scam, **why** (with the exact words highlighted), how risky it is (0–100), and **what to do next**, including the government's `1930` helpline. It also has a **practice mode**: a fake scam caller you can rehearse saying "no" to.

The catch that makes it different: the detection engine doesn't live on a server you have to reach. **It runs on the phone, in the browser, offline.**

<div align="center">

| 🛡️ Real engine on-device | 📴 Works offline | 🇮🇳 Gujarati-first | 🎧 Practice mode |
|:---:|:---:|:---:|:---:|
| The full detector, not a cut-down copy — verified 20/20 against the server | Opens and answers in aeroplane mode, ~636KB | UI, verdicts & advisories in gu / hi / en | Rehearse a scam call that reacts to what you say |

</div>

## Why it exists

Last October the Prime Minister warned the whole country about **"digital arrest"** scams on Mann Ki Baat — fake police who threaten arrest to extort money. Losses run into hundreds of crores, and the people who lose the most are **first-time, elderly, and rural users** who just got a smartphone and a bank account. The scam-checkers that already exist are English-only, need the internet, and assume a tech-savvy user. Rural Gujarat — patchy signal, low digital literacy, Gujarati speakers — is left out. That is exactly who we built for.

## How it works

### System at a glance

```mermaid
flowchart LR
  U(["📱 User"]) -->|paste / forward| PWA

  subgraph PWA["Next.js PWA · the phone"]
    direction TB
    UI["Verdict card"]
    W["Web Worker"]
    ENG["On-device engine<br/>rules + TF-IDF + LightGBM"]
    SWc[["Service Worker cache"]]
    UI --> W --> ENG
    SWc -. precaches .-> ENG
  end

  PWA ==>|"verdict under 100ms"| U
  PWA -. "optional · if online" .-> API

  subgraph API["FastAPI backend · Render"]
    direction TB
    DET["Same detection engine"]
    RAG["BM25 over RBI / NPCI / I4C advisories"]
    LLM["LLM explainer · Groq"]
    TPL["Template fallback"]
    DET --> RAG --> LLM --> TPL
  end

  API -. "richer explanation" .-> PWA
```

### The detection pipeline

Four independent checks read every message at once, and none overrules the others. They are fused with a **noisy-OR**, so one strong signal (a poisoned link, a UPI PIN trap) can raise the alarm on its own.

```mermaid
flowchart TD
  M(["Message / URL / screenshot / audio"]) --> N["Normalize + detect language"]
  N --> R["Rule lexicons<br/>7 scam tactics · gu/hi/en"]
  N --> URL["URL heuristics<br/>look-alike domains · .apk · bare-IP"]
  N --> UPI["UPI trap detector<br/>PIN-to-receive inversion"]
  N --> ML["TF-IDF + LightGBM classifier"]
  R --> F(("noisy-OR<br/>fusion"))
  URL --> F
  UPI --> F
  ML --> F
  F --> V["Risk 0–100 · safe / suspicious / scam<br/>+ highlighted evidence"]

  classDef sig fill:#e7f4ef,stroke:#0e7c5a,color:#0b1512;
  classDef out fill:#0e7c5a,stroke:#0a5b42,color:#ffffff;
  class R,URL,UPI,ML sig;
  class V out;
```

### Local-first: instant on-device, then upgraded

The verdict never waits on the network. The on-device engine answers immediately; if you happen to be online, the server adds a fuller plain-language explanation that **upgrades the card in place**. Honest little labels always say what actually ran — we never pretend the AI answered when it didn't.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as Phone · on-device
  participant S as Server · if online
  U->>P: Check this message
  P-->>U: Verdict under 100ms, "ran on your device"
  P->>S: (background) request richer explanation
  S-->>P: LLM plain-language explanation
  P-->>U: card upgrades in place · "detailed explanation added"
  Note over U,P: Offline? the on-device verdict is the final answer.
```

### The degradation ladder — nothing ever dead-ends

The live link must never break. The API returns a complete answer in every tier; an outage upstream costs wording quality, never the verdict.

| Tier | What it does | Depends on | If it fails |
|:---:|---|---|---|
| **1** | Verdict, risk score, evidence spans | nothing — pure Python, in-memory | cannot fail |
| **2** | Advisory snippet via in-process BM25 | nothing — no network, no vector DB | returns no advisory |
| **3** | Plain-language explanation | LLM provider, 8s hard budget | pre-written templates in gu / hi / en |

## Proof it works

We didn't just claim the phone matches the server — we tested it.

- **On-device parity: 20 / 20.** Twenty test messages sent through both engines; every verdict label matches and every risk score lands within **±5 points**. The parity test lives in the suite.
- **Real offline test.** A headless-Chrome run loads the app once online, switches the network **off**, reloads, and confirms a full verdict still renders — in **both English and Gujarati**, with highlights and the "ran on your device" chip. The install is resilient: the service worker precaches each asset best-effort and **guarantees the shell essentials**, so one dropped byte on a rural link never leaves the app un-openable offline.
- **84 backend + 31 frontend tests**, all green. Typed, small modules.
- **Privacy by design.** Messages are analysed and never stored; an offline check never leaves the device.

> **Honest note.** The public demo runs on a free server tier (~a tenth of a CPU), so server-side screenshot OCR is slow there. On a laptop or a paid instance it is near-instant, and the on-device checks are always fast because they never leave the phone.

## Tech stack

| Layer | Choices |
|---|---|
| **Frontend** | Next.js (static export) · TypeScript · Tailwind · PWA (service worker + Web Worker) |
| **On-device engine** | TypeScript port of the server engine · TF-IDF + LightGBM (tree JSON) · ~195KB gzipped |
| **Backend** | FastAPI · Python 3.11 · Pydantic v2 |
| **AI / ML** | scikit-learn + LightGBM (detection) · Groq LLM (explanations, voice) · Tesseract OCR · edge-tts |
| **Deploy** | Netlify (frontend) · Render (backend, Docker) |

## Run it locally

Everything runs at full speed on a laptop (screenshots included).

```bash
# 1 · backend  (needs backend/.env with GROQ_API_KEY)
cd backend
../.venv/bin/uvicorn app.main:app --reload --port 8000

# 2 · frontend  (uses .env.local → NEXT_PUBLIC_API_URL=http://localhost:8000)
cd frontend
npm run build:worker && npm run dev      # http://localhost:3000
```

## Works offline after the first online visit

**One online visit is all it takes.** On that first load the service worker precaches the
whole shell — every route, JS/CSS chunk, font, the i18n dictionaries, the on-device engine
artifacts, the persona pools and the icons (~638KB gzipped, budget 1.5MB). After that the app
opens and works with **zero network**: the shell loads, language switching works, the analyzer
runs a full on-device verdict with highlights, sample chips work, and text-mode practice works.
A quiet **"Offline — instant checks still work"** indicator appears; screenshot/voice features
(which need the server) degrade with a clear note. When a new version deploys, a subtle
**"App updated — refresh"** toast appears and the old cache is cleaned on refresh — never a
stale-forever app.

> Why a static site normally *doesn't* open offline: reopening it makes a **navigation request**
> that hits the network and fails. Our worker answers navigations from the cached shell instead,
> so the app always opens — App Router then routes client-side from cache.

<details>
<summary><b>Judge demo — prove it in 60 seconds</b></summary>

<br/>

**On a phone (the real test):**
1. Open **https://dhanrakshakai.netlify.app** once with internet. Wait ~5–10s (the shell is caching).
2. Optional: **Add to Home Screen** from the browser menu — it installs as an app.
3. Turn on **Airplane mode**.
4. Reopen the site (or tap the installed icon). It opens — no dinosaur, no blank screen.
5. Paste a scam (e.g. *"Your account will be blocked. Enter your UPI PIN to receive ₹5000."*) → tap **Check** → full verdict, risk score, highlighted evidence, and the chip reads **"ran on your device."**

**On a laptop (DevTools):**
```bash
cd frontend
npm run build && npx serve out -l 3000
# open http://localhost:3000 once, then DevTools → Application → Service Worker
# (shows "activated"; the precache list includes /engine/*), then
# DevTools → Network → Offline → reload → paste a scam → full verdict, chip = on-device
```

**Reproduce the automated proof** (real headless Chrome, online→offline→reload→analyze):
```bash
cd frontend && npm run build
# serves the export Netlify-style and drives real Chrome through the offline flow
node scripts/verify-offline.mjs      # prints VERDICT for English and Gujarati
```

</details>

## Repo layout

```
dhanrakshak/
├── backend/              FastAPI: detection, explainer, simulator, OCR/STT
│   ├── app/detection/    rules · urls · upi · TF-IDF+LightGBM · fusion
│   ├── app/explain/      BM25 advisories · LLM providers · templates
│   ├── app/simulator/    scam-call practice: personas · coach · voice
│   └── scripts/          export_client_model.py → ships the engine to the browser
├── frontend/
│   └── src/lib/engine/   the faithful TypeScript port + parity tests
├── docs/                 README assets (animated hero)
└── render.yaml           one-command backend deploy
```

## Credits

Built for the **MAVERICK AI Challenge** (Dewang Mehta Foundation · GTU). Scam patterns and advisories are grounded in official guidance from **RBI, NPCI, and the Indian Cyber Crime Coordination Centre (I4C)**. National cyber-crime helpline: **1930** · [cybercrime.gov.in](https://cybercrime.gov.in).

<div align="center">
<br/>
<sub><b>Check before you trust.</b></sub>
</div>
