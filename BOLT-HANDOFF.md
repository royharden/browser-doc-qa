# Bolt infrastructure handoff: browser-doc-qa

Status line: **Dirty Mode construction - runtime unverified.**

## Target and readiness

- Repository / branch / prepared revision: local Git repository only (no remote yet); branch `master`. Record the imported commit at import time.
- App root: repository root (this folder). The outer `browser-doc-qa\` wrapper folder holds coordination notes and is not part of the app.
- Database: **none** (static, local-only app). IndexedDB in the user's browser is browser storage, not a backend.
- Target: Not required.
- Existing baseline / applied migrations: Not required (no migrations exist).
- Hosting: static hosting of the Vite `dist/` output; host not selected.
- Publication: prepare only. Not authorized.
- Bolt action: **inspect and prepare only**.
- Status: implementation complete at source level, never installed/built/run; infrastructure Not required.
- Owner prerequisites: GitHub access to the imported repository (none exists yet). No API keys or registrations.

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Node >= 22.6 (tests use `--experimental-strip-types`), npm. **No lockfile yet**: the first `npm install` creates `package-lock.json`, which must be committed. |
| Frozen install / dev | `npm ci` once the lockfile exists; `npm run dev` |
| Build / output | `npm run build` (typecheck then `vite build`); output `dist/` |
| Type/lint/tests | `npm run typecheck`, `npm test` — **never run**. Only a static syntax parse + partial no-emit typecheck without dependency types was done. |
| Client file / public env names | Not required. No env variables (`.env.example` explains). Optional non-secret build-time `SOURCE_REVISION`. |
| Missing config behavior | Not applicable; keyword search works without any model; dense/hybrid show "unavailable" until the user loads the model. |

## Database

Not required. No tables, RLS, RPCs, triggers, extensions, seeds or migrations.

## Functions

Not required. No edge functions, webhooks or server code.

## Server secrets to enter through settings

None. Do not add any. Never expose credentials through `VITE_` variables.

## Auth, storage, and external steps

- Auth providers/confirmation: Not required.
- Site URL and callback routes: Not required (single page, no router).
- Buckets: Not required.
- Realtime: Not required.
- Scheduled/long jobs: Not required.
- Outside services (browser-side downloads after user consent only):
  - Model files: `Xenova/bge-small-en-v1.5` from `https://huggingface.co` (redirects to `*.hf.co`).
  - ONNX Runtime WebAssembly files loaded by Transformers.js from `https://cdn.jsdelivr.net`.
  - PDF.js worker is bundled by Vite (no CDN worker).
- Real integrations: PDF.js (local bytes), Transformers.js (real model in a worker). Explicit demos/stubs: none in the product; test doubles exist only under `tests/`.
- Headers: `public/_headers` is a **proposed** CSP/security header set; whether the host serves it is unverified.
- Assets still missing: `public/demo/harbor-line.pdf` (print `tests/fixtures/pdf/harbor-line.print.html`; see README Activation step 5).

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | intended revision loads; install creates lockfile; `npm run build` passes | pending |
| Typecheck/tests | `npm run typecheck`, `npm test` pass with real dependency types | pending |
| Keyword journey | tutorial loads with no model fetch; weekday question cites exact span; negative abstains | pending |
| Dense/hybrid | consented model load (WASM; optional WebGPU) with progress/cancel; all three arms run | pending |
| Measurements | calibration on 12 calibration questions, then 24-question run; JSON export validates | pending |
| PDF import | printed Harbor Line PDF extracts with correct pages/citations | pending (asset not produced) |
| Storage/lifecycle | opt-in persistence, reload, delete all, cancel/replace during jobs | pending |
| Privacy/headers | served headers inspected; production sentinel check of main/worker requests | pending |
| Publish | Not requested | Not requested |

Pinned model revision, exact dependency versions and served headers are activation tasks, not presumed successes.

## Deferred-validation ledger

| Component | Assumption / skipped check | Later step |
|---|---|---|
| Dependencies | package.json ranges resolve; APIs match pdf.js v4 / Transformers.js v3 | `npm install`, record versions, typecheck |
| Model registry | revision `main` unpinned; 512 tokens, CLS, 384-d assumed from model config | pin commit, measure bytes, confirm limits |
| Embedding worker | Transformers.js pipeline options and tokenizer `encode` behave as coded | real WASM run; optional WebGPU run |
| PDF layout | heuristics (space/column/paragraph/hyphen) suit real pdf.js items | inspect real extraction of the printed PDF |
| Tests | hand-traced only | `npm test` |
| IndexedDB | upgrade/blocked/versionchange/quota paths behave as coded | browser checks incl. private mode |
| Calibration/quality | no thresholds chosen yet; defaults 0.5 / 0.8 are uncalibrated | real calibration then evaluation run |
| Headers/privacy | `_headers` proposal; no egress measured | inspect served headers; sentinel check |

## One prompt after GitHub import

### Inspect and prepare only

> Inspect and prepare the imported inner browser-doc-qa Vite project. Preserve its local-only design and
> providers. Check the actual imported revision, dependency lockfile, static build, bundled PDF/embedding
> workers, pinned model/runtime origins and actual hosting response headers. Report missing assets/
> configuration and unverified browser/model/privacy behavior. No backend, database, authentication, storage
> service, secret, cloud provisioning or publishing is required. Do not provision or publish. Import alone is
> not proof of working inference or privacy.
