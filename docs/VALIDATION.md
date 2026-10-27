# Local validation scope

Normal mode resumed after the 2026-10-26 PC crash. Source-only Dirty Mode acceptance is historical. The
independent reviewer passed dependency checkpoints V0/V1, bounded V2 and the authorized V3 scope. Final candidate
verdicts and integration receipts live in the outer STATUS/HANDOFF run records; this document grants no
publication or whole-PLAN acceptance.

## Executed journeys

- Real dependency types, Node regression/oracle suites and production build. The V3 author suite has 83 tests,
  including independent evidence/BM25 oracles, persistence opt-out/cancel/replace races and partial-byte progress.
- Chrome 155 fresh contexts: keyword tutorial/negative, exact keyboard citations, inert Markdown/filenames,
  desktop and stacked layout, >10 MiB rejection, explicit IndexedDB opt-in/reload, PDF cancel/replace and JSON export.
- Original four-page PDF: printed, all four rendered pages visually inspected, actual PDF.js canonical strings
  frozen exactly and independently checked against the retained asset and original authored sentences.
- Real q8/CLS/384 WASM model, consented load, three-arm paraphrase, calibration before evaluation, overflow recovery,
  valid report export excluding synthetic private source/questions. No embedding doubles are in the production path.
- Independent V3 replay: real asset cancellation/local failure/explicit WASM retry; independent prefix/vector/token
  observations and a separate cell-based report oracle; canonical headers on both document and actual worker;
  real blocked-open/upgrade/versionchange/quota and isolated Chrome reload cases; four distinct negative PDF states.

## Observed authored-corpus result

An author production run calibrated only on 12 frozen calibration questions, choosing keyword coverage 0.55 and
dense cosine 0.75. Evaluation then ran one excluded warm-up and three measured passes on the unchanged 24 questions
(18 answerable, 6 negatives), serial independent arms. All 216 measured rows were OK; the export has 288 rows with
warm-up included. Identical repeated ranks do not turn 18 unique positives into 54 independent examples.

| Arm | Recall@1 | Recall@3 | Recall@5 | MRR@5 | Positive refusals /18 | Correct negative refusals /6 |
|---|---:|---:|---:|---:|---:|---:|
| Keyword | .639 | .778 | .833 | .736 | 14 | 6 |
| Dense | .611 | .944 | 1.000 | .780 | 10 | 6 |
| Hybrid | .694 | .833 | .889 | .792 | 9 | 6 |

These are small original-fictional-corpus observations, not generalized quality guarantees. Traceable excerpts
and recall do not establish complete reasoning or entailment. The heuristic gates refused many answerable questions;
hybrid did not dominate dense recall. No threshold/label was changed after viewing evaluation outcomes.

Actual observed vectors had 384 finite components and norm about 1.000000058. Queries above the real 512-token budget
(670 tokens) were refused explicitly; an over-budget passage (542 tokens) failed dense indexing while keyword stayed
available. Nothing was silently truncated. WebGPU was unavailable in the GPU-disabled baseline and was not executed.

## Privacy and headers

Tests use fresh isolated browser contexts and synthetic fixtures. Four immutable public model files are SHA-verified
local dependencies; matching runtime files are from pinned Transformers.js 3.8.1. Browser asset requests are fulfilled
from those local bytes; no external request is continued and no hosted inference/API is called. Main/worker request
URLs, bodies and headers are scanned for the synthetic sentinel; WebSockets are blocked and service workers disabled.
Default fixture report exports exclude the imported source/question sentinel. This is bounded observed behavior,
not universal zero-egress, first-visit-offline, all-transport or deployed-host certification.

Vite production preview mirrors the canonical `public/_headers` CSP/security policy so real model tests can assert
served headers. Remote hosting is unconfigured and may ignore that file; inspect the real deployment separately.
Raw timings/reports/captures remain ignored agent receipts, not committed performance promises.

## Still required / restricted

V3 source 1da1cbb and reviewer test tree 51377b8 have a bounded independent PASS. Model/storage runners deliberately
returned nonzero for explicit BLOCKED deletion rows (model exit 1, storage exit 2); PDF boundaries and headers returned
zero with all authorized cases passing. Do not relabel those mixed-scope runs as all-green full-PLAN completion.
Delete-all, pending-job deletion, reload-confirmed deletion, model-cache clearing and removal of legacy v1 documents/meta
remain unexecuted under Roy's no-delete instruction unless explicitly permitted for synthetic test contexts.
No push, publish, deploy, credentials, accounts, paid services or real-user-profile actions were performed. Database,
SQL migrations and Docker services are not applicable to this static app. Optional M7/M8 studies/generation remain out.
