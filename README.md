# Browser Doc Q&A

A static, in-browser document Q&A workbench. Load one document, compare **keyword (BM25)**, **embedding
(dense)** and **hybrid (RRF)** retrieval side by side, read at most two short verbatim excerpts, and click a
citation to highlight the exact source characters. The differentiator is the **Measurements** panel: a fixed
protocol on an original labelled corpus that reports evidence recall@1/3/5, MRR@5, abstention outcomes,
status coverage and measured browser timings, exportable as JSON (`browser-doc-qa.measurement.v3`).

Processing is intended to stay local: no backend, no accounts, no uploads, no analytics. Loading the embedding
model downloads model and runtime files (disclosed in the UI) only after explicit consent. First-visit offline
use and zero network egress are **not** claimed.

## Status: FULL validation in progress

Dirty Mode closed by Roy on 2026-10-26. The inherited source is being validated in local worktrees;
independent reviewer acceptance is pending. At baseline activation commit `8690fb1`, pinned installation,
real dependency typechecking, 73 existing tests, 2 independent oracle tests and the Vite production build
all passed on Node 24.18.0/npm 11.11.0. The app also starts on its claimed loopback test port.

Follow-up dependencies use PDF.js 6.2.108 and an override of the unused browser-path Node image dependency
sharp to 0.35.5; real typecheck, baseline 75 tests, production build and production dependency audit passed
(zero audit findings at the activation check). After PC recovery, Chrome 155 ran actual tutorial/keyboard
citation/negative/PDF import, exact extraction, persistence opt-in/reload, inert Markdown and stacked-layout
checks with external requests blocked. A delayed persistence opt-in race was reproduced by the reviewer and
fixed with latest-operation ownership and independently accepted in the bounded V2 checkpoint. An author
production run now executes real local WASM embeddings, calibration and all three evaluation arms, with
request/export sentinels and actual token/vector checks. Independent V3 acceptance and the permitted storage
matrix remain required; destructive clear-data/cache tests are held by the current no-delete instruction.
See `docs/VALIDATION.md` and outer STATUS.md for scope, candidate pins and remaining checks.

## What is built (source)

| Area | Files |
|---|---|
| Contracts | `src/domain.ts`, `src/ports.ts`, `src/report.ts` (v3 types), `src/validate.ts`, `src/session.ts` (corpus revision) |
| Text and chunks | `src/lib/textExtract.ts` (form-feed / `--- page N ---` paging), `src/lib/sentences.ts`, `src/lib/chunk.ts` (page-bounded <=900 code units, <=150 overlap, exact slices) |
| PDF | `src/lib/pdfLayout.ts` (pure, versioned reconstruction), `src/adapters/pdfjsExtract.ts` (local bytes, bundled worker, `isEvalSupported:false`, no OCR) |
| Retrieval | `src/lib/tokenize.ts` (NFKD, symbols/digits/negations kept, no stemming), `bm25.ts` (k1 1.5, b 0.75, built once per revision), `vector.ts`, `rrf.ts`, `retrieve.ts` (top20+top20 -> plain RRF60 -> top5) |
| Answers | `src/lib/answer.ts` (sentence excerpts from top-3 chunks, IDF coverage / cosine gates, exact-span dedup, immutable citations), `src/lib/ask.ts` (independent arm runs with stage timings) |
| Dense model | `src/adapters/modelRegistry.ts`, `embed.worker.ts`, `transformersEmbedder.ts` (pending map, timeouts, batching, token bounds), `denseService.ts` (full-identity vector cache) |
| Measurements | `src/lib/fixture.ts`, `calibrate.ts`, `protocol.ts`, `metrics.ts`, `reportValidate.ts`; data in `src/data/evaluation/*.json` |
| Storage / lifecycle | `src/adapters/libraryStore.ts` (memory default, IndexedDB only on opt-in), `src/lib/lifecycle.ts` |
| UI | `src/main.tsx`, `src/browser/{controller,services,wire}.ts`, `src/ui/*.tsx`, `src/styles.css` |
| Tests (unrun) | `tests/*.test.ts` (Node built-in runner), `tests/fixtures/pdf/*` |

Fixtures:

- **Harbor Line Ferry tutorial** (`src/data/harborLine.ts`): 4 short pages, 8 questions. An intro and smoke
  fixture only; too small to be a quality benchmark.
- **Cedar Ridge Tool Library evaluation corpus** (`src/data/evaluation/`): original fictional text, 8 pages,
  12 calibration questions (2 lexical, 2 paraphrase, 2 multi-evidence, 6 hard negatives) and 24 evaluation
  questions (6 lexical, 8 paraphrase, 4 multi-evidence, 6 negatives). Generated with exact UTF-16 offsets by
  `scripts/fixture-authoring.py` (`--check` verifies the committed JSON). Do not edit labels after looking at
  results; bump the fixture version instead.
- **Harbor Line PDF**: `public/demo/harbor-line.pdf` is the original four-page tutorial, prepared from
  `tests/fixtures/pdf/harbor-line.print.html` with Chrome 155. Its four rendered pages and actual PDF.js 6.2.108
  extraction were inspected; exact canonical strings and preparation settings are frozen in
  `tests/fixtures/pdf/harbor-line.expected.json`. It is separate from the text benchmark.

## Run it locally

Validated runtime: Node 24.18.0 (`.node-version`); minimum Node 22.13.0. From this folder:

```text
npm ci               # retained lockfile; exact direct dependency versions
npm run typecheck
npm test
npm run build        # output in dist/
npm run dev          # claim a host port first (agent-ports skill) before listening
```

The app works with keyword search immediately. Embedding and hybrid stay "unavailable" until you tick the
consent box and load the model (WASM by default; "Try WebGPU" only when an adapter is found within 1.5 s).

## Activation and validation still required

1. Retain the lockfile and exact versions. Reproduce with `npm ci`; current direct versions are in package.json.
2. Run `npm run typecheck`, `npm test`, `npm run build` on the candidate; independent review and combined-tree
   checks are still required. `npm test` includes the nested independent oracles and serializes test files.
3. Model metadata is pinned at `ea104dacec62c0de699686887e3f920caeb4f3e3`; see `docs/MODEL-ARTIFACT.md`.
   Confirm actual browser token counts, output vectors and backend through real inference; metadata is not execution.
4. In a browser: tutorial journey (weekday question, citation highlight, negative question), model load
   with progress/cancel, WASM and optional WebGPU, all three arms on the paraphrase question.
5. The prepared original PDF is retained; normal builds and browser checks do not regenerate it. If changing
   the printable source, explicitly run `npm run prepare:pdf` against a claimed local dev port, inspect all
   four rendered pages and re-freeze canonical extraction/page mapping in `harbor-line.expected.json`.
6. Measurements: load the evaluation corpus, load the model, **Calibrate gates** (calibration split only),
   then **Run measurements** on the untouched evaluation split; export the JSON report.
7. Lifecycle/storage: cancel/replace/delete during pending jobs, IndexedDB reload/upgrade/quota/private mode,
   "Delete all" and "Clear model cache" actually removing data.
8. Privacy/hosting: inspect served headers (`public/_headers` is only a proposal) and run a production-build
   sentinel check of main-thread and worker requests.

## Data and privacy controls

- Memory by default; "Save imported documents and vectors in this browser" opts into IndexedDB. Same-origin
  browser storage is not an encrypted vault.
- "Delete all app data" invalidates running work, then clears documents, pages, chunks, vectors, answers,
  reports and settings. "Clear model cache" separately removes the Transformers.js Cache Storage bucket; the
  ONNX Runtime files in the ordinary HTTP cache cannot be cleared by a page.
- Measurements run only on the bundled evaluation corpus, so exported reports **never** contain imported
  documents, file names or your own questions. A report does contain: the bundled fixture's ids, question
  text and labels; config and the gate policy with its calibration sweep evidence; per-question rows (retrieved
  chunk ids/offsets, scores, answer decisions, stage timings); model id, backend and init time; run id,
  timestamps and source revision; and browser/device hints (user agent, language, logical cores, device-memory
  hint, WebGPU API presence, cross-origin isolation, WASM threads). Review the JSON before sharing it.

## Limits

10 MiB file, 40 pages, 200,000 characters of text, 400 chunks, 1,000-character questions. These are chosen
workloads, not measured browser capacities. Born-digital PDFs only (no OCR); scanned, encrypted, corrupt and
over-limit files get distinct messages.

## Not in this build

OCR, cloud inference, accounts, sync, sharing, URL imports, multiple corpora, rerankers, model pickers,
original-layout PDF highlights, answer generation (the optional WebLLM exact-quote generator and the larger
real-PDF study are post-MVP and were not built).

Database: none. See `BOLT-HANDOFF.md`.

Local browser regression (Chrome installed on this PC): set `S11_TEST_ORIGIN` to the claimed loopback dev
origin, then `npm run test:browser`. Optional `S11_CHROME` selects an installed browser executable. The script
uses a fresh context, blocks external requests, imports only synthetic/bundled fixtures, checks persistence
reload and renders captures under ignored `.agent-work/receipts`. It does not execute clear-data deletion
actions or substitute mocked vectors for real-model acceptance. Independent RV suites remain the acceptance gate.

For the real model regression, build with the non-secret `SOURCE_REVISION` set to the tested Git commit,
start a claimed loopback production preview, set `S11_TEST_ORIGIN`, then run `npm run test:model-browser`.
It requires the four SHA-verified model files and manifest in `.agent-work/models/<revision>/` (or an explicit
`S11_MODEL_CACHE` directory); see `docs/MODEL-ARTIFACT.md`. Model/runtime requests are fulfilled from local
dependency files and all other external requests are blocked. It does not invoke a hosted inference service.
The production preview reads security headers from `public/_headers`; remote hosting still must apply them.
