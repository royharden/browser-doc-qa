# Bolt infrastructure handoff: browser-doc-qa

Status line: **FULL local validation in progress; independent acceptance pending.**

## Target and readiness

- Repository / branch / prepared revision: local Git repository only (no remote yet); branch `master`. Record the imported commit at import time.
- App root: repository root (this folder). The outer `browser-doc-qa\` wrapper folder holds coordination notes and is not part of the app.
- Database: **none** (static, local-only app). IndexedDB in the user's browser is browser storage, not a backend.
- Target: Not required.
- Existing baseline / applied migrations: Not required (no migrations exist).
- Hosting: static hosting of the Vite `dist/` output; host not selected.
- Publication: prepare only. Not authorized.
- Bolt action: **inspect and prepare only**.
- Status: source reused from Dirty Mode. V0 install/typecheck/75 tests/build pass at 8690fb1; current dependency follow-up typecheck/audit pass. Browser startup blocked; no whole-product acceptance. Infrastructure Not required.
- Owner prerequisites: GitHub access to the imported repository (none exists yet). No API keys or registrations.

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Node 24.18.0 validated; minimum 22.13.0. npm 11.11.0; retained package-lock.json and exact direct versions. |
| Frozen install / dev | `npm ci` once the lockfile exists; `npm run dev` |
| Build / output | `npm run build` (typecheck then `vite build`); output `dist/` |
| Type/lint/tests | `npm run typecheck`, `npm test`; V0 passed real typecheck and 75 tests. Tests include reviewer oracles; no lint script exists. Follow-up results are candidate-specific in outer STATUS.md. |
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
- Original PDF retained: `public/demo/harbor-line.pdf`; actual four-page extraction frozen in `tests/fixtures/pdf/harbor-line.expected.json` after rendered-page inspection. Normal builds do not reprint it.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | pinned `npm ci`; `npm run build` passes | V0 8690fb1 pass; independent review pending |
| Typecheck/tests | `npm run typecheck`, `npm test` pass with real dependency types | V0 8690fb1 real typecheck and 75 tests pass; current follow-up checks recorded outside |
| Keyword journey | tutorial loads with no model fetch; weekday question cites exact span; negative abstains | pending |
| Dense/hybrid | consented model load (WASM; optional WebGPU) with progress/cancel; all three arms run | pending |
| Measurements | calibration on 12 calibration questions, then 24-question run; JSON export validates | pending |
| PDF import | printed Harbor Line PDF extracts with correct pages/citations | author browser run passed; independent V2 acceptance pending |
| Storage/lifecycle | opt-in persistence, reload, delete all, cancel/replace during jobs | pending |
| Privacy/headers | served headers inspected; production sentinel check of main/worker requests | pending |
| Publish | Not requested | Not requested |

Model metadata is pinned at ea104dacec62c0de699686887e3f920caeb4f3e3 (docs/MODEL-ARTIFACT.md).
Real inference/backend/quality and served production headers remain unverified.

## Deferred-validation ledger

| Component | Assumption / skipped check | Later step |
|---|---|---|
| Dependencies | exact versions and lock retained; PDF.js 6.2.108 / Transformers.js 3.8.1 | `npm ci`, candidate type/test/build and actual PDF/model run |
| Model registry | exact artifact/tokenizer revision and file sizes checked; 512-token/384-d config verified | actual token bounds/CLS vectors/backend inference pending |
| Embedding worker | Transformers.js pipeline options and tokenizer `encode` behave as coded | real WASM run; optional WebGPU run |
| PDF layout | heuristics (space/column/paragraph/hyphen) suit real pdf.js items | inspect real extraction of the printed PDF |
| Tests | V0 73 existing + 2 independent oracle tests really passed | `npm test` on each accepted candidate |
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
