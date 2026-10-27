# Bolt infrastructure handoff: browser-doc-qa

Status line: **FULL local validation: all currently authorized scope independently passed; deletion-dependent checks remain unexecuted.**

## Target and readiness

- Repository / branch / prepared revision: local Git repository only (no remote yet); branch `master`. Record the imported commit at import time.
- App root: repository root (this folder). The outer `browser-doc-qa\` wrapper folder holds coordination notes and is not part of the app.
- Database: **none** (static, local-only app). IndexedDB in the user's browser is browser storage, not a backend.
- Target: Not required.
- Existing baseline / applied migrations: Not required (no migrations exist).
- Hosting: static hosting of the Vite `dist/` output; host not selected.
- Publication: prepare only. Not authorized.
- Bolt action: **inspect and prepare only**.
- Status: source reused from Dirty Mode. V0/V1, bounded V2 and authorized V3 independently accepted. Real PDF/browser/local-WASM/calibration/evaluation and non-destructive storage matrix executed. Deletion-dependent checks remain prohibited/unexecuted; no whole-PLAN completion claim. Infrastructure Not required.
- Owner prerequisites: GitHub access to the imported repository (none exists yet). No API keys or registrations.

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Node 24.18.0 validated; minimum 22.13.0. npm 11.11.0; retained package-lock.json and exact direct versions. |
| Frozen install / dev | `npm ci` once the lockfile exists; `npm run dev` |
| Build / output | `npm run build` (typecheck then `vite build`); output `dist/` |
| Type/lint/tests | `npm run typecheck`, `npm test`; V3 independent run passed real types and 83 Node tests. Tests include reviewer oracles; no lint script exists. Candidate-specific receipts/verdicts in outer STATUS.md. |
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
- Headers: Vite production preview mirrors canonical `public/_headers` for local verification. Remote hosting is unconfigured and its behavior remains unverified.
- Original PDF retained: `public/demo/harbor-line.pdf`; actual four-page extraction frozen in `tests/fixtures/pdf/harbor-line.expected.json` after rendered-page inspection. Normal builds do not reprint it.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | pinned `npm ci`; `npm run build` passes | independent offline install/type/build PASS through V3 source 1da1cbb |
| Typecheck/tests | `npm run typecheck`, `npm test` pass with real dependency types | independent V3 PASS, 83 tests; reviewer test tree 51377b8 retained |
| Keyword journey | tutorial loads with no model fetch; weekday question cites exact span; negative abstains | independent bounded V2 PASS |
| Dense/hybrid | consented model load (WASM; optional WebGPU) with progress/cancel; all three arms run | independent real local WASM/prefix/vector/token/cancel/retry PASS; optional WebGPU unavailable |
| Measurements | calibration on 12 calibration questions, then 24-question run; JSON export validates | independent V3 PASS: 216/216 measured rows OK; separate evidence/count/calibration/timing oracle agrees |
| PDF import | printed Harbor Line PDF extracts with correct pages/citations | independent V2 PASS; retained original asset/frozen canonical extraction |
| Storage/lifecycle | opt-in persistence, reload, delete all, cancel/replace during jobs | non-destructive persistence/cancel/replace/blocked-open/upgrade/versionchange/quota PASS; destructive rows blocked |
| Privacy/headers | served headers inspected; production sentinel check of main/worker requests | independent loopback document/worker canonical headers and URL/body/header/export sentinels PASS; remote hosting/all-transport behavior unverified |
| Publish | Not requested | Not requested |

Model metadata is pinned at ea104dacec62c0de699686887e3f920caeb4f3e3 (docs/MODEL-ARTIFACT.md).
Real WASM/backend/quality and local production document/worker headers were independently observed; remote hosting remains unverified.

## Deferred-validation ledger

| Component | Assumption / skipped check | Later step |
|---|---|---|
| Dependencies | exact versions and lock retained; PDF.js 6.2.108 / Transformers.js 3.8.1 | `npm ci`, candidate type/test/build and actual PDF/model run |
| Model registry | exact artifact/tokenizer revision and file sizes checked; 512-token/384-d config verified | actual token bounds/CLS vectors/backend inference pending |
| Embedding worker | real CLS/q8/384 normalization, query-only prefix and token refusal verified | optional WebGPU remains unexecuted/unavailable baseline |
| PDF layout | actual original PDF canonical extraction, citations and four error states verified | larger/noisy-layout PDF study is optional post-MVP |
| Tests | V0 73 existing + 2 independent oracle tests really passed | `npm test` on each accepted candidate |
| IndexedDB | real blocked/non-destructive upgrade/versionchange/quota/isolated-context behavior verified | destructive old-store removal and clear-data/cache cases remain prohibited/unexecuted |
| Calibration/quality | calibration chose .55/.75 before fixed evaluation; all three arms complete | descriptive small-corpus results/positive refusals in docs/VALIDATION.md; no general-quality claim |
| Headers/privacy | local preview mirrors and serves canonical policy; actual request/export sentinels verified | remote host application, broader transports and first-visit offline remain unverified |

## One prompt after GitHub import

### Inspect and prepare only

> Inspect and prepare the imported inner browser-doc-qa Vite project. Preserve its local-only design and
> providers. Check the actual imported revision, dependency lockfile, static build, bundled PDF/embedding
> workers, pinned model/runtime origins and actual hosting response headers. Report missing assets/
> configuration and unverified browser/model/privacy behavior. No backend, database, authentication, storage
> service, secret, cloud provisioning or publishing is required. Do not provision or publish. Import alone is
> not proof of working inference or privacy.
