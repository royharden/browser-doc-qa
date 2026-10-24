# Measurement protocol (short reference)

Source of truth: the code in `src/lib/{metrics,calibrate,protocol,reportValidate}.ts`. No run has happened yet.

- Corpus: Cedar Ridge Tool Library, 8 original pages, at least 16 page-bounded chunks (validated at run time).
- Calibration: 12 questions, used only to choose the two answer gates. Keyword coverage and dense cosine are
  swept separately on {0, 0.05, ..., 1}; a question is accepted when its best ungated candidate reaches the
  threshold. Pick highest balanced accuracy, then fewer false accepts, then the higher threshold. The fallback
  is per gate: a gate whose calibration is incomplete or unavailable (e.g. no model loaded) keeps its
  uncalibrated default (keyword 0.5, cosine 0.8). One calibrated gate gives a `partially-calibrated` policy
  (with `calibratedGates`); both give `calibrated`; neither keeps `uncalibrated-default`. The policy is frozen
  before evaluation.
- Evaluation: 24 untouched questions (18 answerable, 6 negatives). One excluded warm-up pass, then 3
  measured passes; questions in frozen id order; arms in order keyword, dense, hybrid; each arm runs
  independently (dense and hybrid each embed the query).
- Evidence recall@k: a gold unit counts as covered at k when the union of same-page retrieved chunk intervals
  in the first k fully covers it. Per question: covered units / gold units; macro-averaged over the 18.
- MRR@5: reciprocal of the first rank at which any gold unit becomes fully covered, else 0.
- Abstention: correct abstentions out of 6 negatives, false abstentions out of 18 positives, false accepts.
  Errors, unavailable and cancelled rows are statuses, never refusals.
- Comparable aggregates only for arms with every expected row ok; partial arms show coverage only;
  unavailable arms show N/A.
- Timing: injected `performance.now()` clock. Retrieval component sums: keyword = search-keyword;
  dense = embed-query + search-vector; hybrid = search-keyword + embed-query + search-vector + fuse. Wall
  durations are recorded alongside. Nearest-rank p50/p95 over success samples only; fewer than 20 samples is
  flagged. Setup timings are single observations.
- Report: `browser-doc-qa.measurement.v3`, validated at save, read and export. Its `calibration` block holds
  the calibration run that produced the policy (run id, per-gate 21-row sweeps with counts and balanced
  accuracy, chosen thresholds, hybrid outcomes); it is `null` only for the uncalibrated default, and the
  validator checks the run id, the sweeps, that chosen thresholds equal the policy and that calibration
  questions are disjoint from evaluated ones. Rows record an execution kind: `real-browser-lexical`,
  `real-browser-model`, `not-run` (dense/hybrid rows when no model was loaded) or `test-oracle` (test doubles,
  never rendered as a production comparison).
