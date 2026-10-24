# Browser Doc Q&A

A static, in-browser document Q&A workbench. Load one document, compare **keyword (BM25)**, **embedding
(dense)** and **hybrid (RRF)** retrieval side by side, read at most two short verbatim excerpts, and click a
citation to highlight the exact source characters. The differentiator is the **Measurements** panel: a fixed
protocol on an original labelled corpus that reports evidence recall@1/3/5, MRR@5, abstention outcomes,
status coverage and measured browser timings, exportable as JSON (`browser-doc-qa.measurement.v3`).

Processing is intended to stay local: no backend, no accounts, no uploads, no analytics. Loading the embedding
model downloads model and runtime files (disclosed in the UI) only after explicit consent. First-visit offline
use and zero network egress are **not** claimed.

## Status: built, not run

> **Dirty Mode construction - runtime unverified.** This source was written under a static-checks-only
> construction mode. Nothing here has been installed, built, tested or opened in a browser.

What was checked: every `.ts`/`.tsx` file was syntax-parsed and type-checked (no emit) with an already
installed TypeScript 6.0 outside this repo; third-party module types (React, pdf.js, Transformers.js, Vite)
were unavailable because `node_modules` was deliberately not installed, so diagnostics that depend on them
were filtered. Logic and tests were reviewed by hand-trace in separate static reviews.

What has **not** happened: `npm install` (there is no lockfile yet), `npm run typecheck` with real
dependency types, `npm test`, `npm run build`, any dev server, any browser run, any real PDF extraction,
any model download/inference, any calibration or measurement run. No numbers in this repo are measured.

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
- **Harbor Line PDF**: `tests/fixtures/pdf/harbor-line.print.html` is the printable source. The PDF itself
  (`public/demo/harbor-line.pdf`) has **not** been produced; see "Activation" step 5.

## Run it (once installs are allowed)

Use Node 22.6 or newer (the tests use `--experimental-strip-types`). From this folder:

```text
npm install          # resolves the ranges in package.json and creates package-lock.json; commit the lockfile
npm run typecheck
npm test
npm run build        # output in dist/
npm run dev          # claim a host port first (agent-ports skill) before listening
```

The app works with keyword search immediately. Embedding and hybrid stay "unavailable" until you tick the
consent box and load the model (WASM by default; "Try WebGPU" only when an adapter is found within 1.5 s).

## Activation and validation still required

1. Install once and keep the lockfile; record exact versions of `pdfjs-dist`, `@huggingface/transformers`,
   React and Vite, and check current advisories for pdf.js.
2. Run `npm run typecheck`, `npm test`, `npm run build`; fix real failures (do not weaken tests).
3. Pin the model: replace `revision: 'main'` in `src/adapters/modelRegistry.ts` with the exact Hugging Face
   commit of `Xenova/bge-small-en-v1.5`, fill `expectedBytes`, confirm CLS pooling, 384 dimensions and the
   512-token limit for that artifact, set `pinned: true`, and confirm licence terms in `NOTICE`.
4. In a browser: tutorial journey (weekday question, citation highlight, negative question), model load
   with progress/cancel, WASM and optional WebGPU, all three arms on the paraphrase question.
5. Print `tests/fixtures/pdf/harbor-line.print.html` to `public/demo/harbor-line.pdf` (Letter, default
   margins, no headers/footers), record browser and page mapping in `harbor-line.expected.json`, import it,
   and inspect extraction and citations.
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
- Exported reports contain only the bundled fixture's ids, questions, config and metrics — never imported
  documents, file names or your own questions.

## Limits

10 MiB file, 40 pages, 200,000 characters of text, 400 chunks, 1,000-character questions. These are chosen
workloads, not measured browser capacities. Born-digital PDFs only (no OCR); scanned, encrypted, corrupt and
over-limit files get distinct messages.

## Not in this build

OCR, cloud inference, accounts, sync, sharing, URL imports, multiple corpora, rerankers, model pickers,
original-layout PDF highlights, answer generation (the optional WebLLM exact-quote generator and the larger
real-PDF study are post-MVP and were not built).

Database: none. See `BOLT-HANDOFF.md`.
