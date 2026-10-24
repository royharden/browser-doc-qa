import type { ChunkerConfig, GatePolicy } from '../domain.ts';

/** Input limits: chosen workloads, not measured browser capacities (PLAN.md section 1). */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 40;
export const MAX_CANONICAL_CHARS = 200_000;
export const MAX_CHUNKS = 400;
export const MAX_QUESTION_CHARS = 1_000;

export const CHUNKER_CONFIG: ChunkerConfig = Object.freeze({
  version: 'chunk-v2',
  maxChars: 900,
  overlapChars: 150,
  minTailChars: 200,
});

export const TOKENIZER_VERSION = 'tok-v2-nfkd';
export const EXTRACTION_VERSION_TEXT = 'text-v2';
export const EXTRACTION_VERSION_PDF = 'pdf-layout-v1';
export const EXTRACTION_VERSION_FIXTURE = 'fixture-v1';

export const BM25_K1 = 1.5;
export const BM25_B = 0.75;
export const RRF_K = 60;
export const RETRIEVE_K = 5;
export const FUSION_POOL = 20;
/** Excerpts are collected from the selected arm's top N chunks. */
export const EXCERPT_CHUNKS = 3;
export const MAX_EXCERPTS = 2;

/** Provisional, uncalibrated gates (PLAN.md section 5). Never shown as confidence. */
export const DEFAULT_POLICY: GatePolicy = Object.freeze({
  keywordMinCoverage: 0.5,
  denseMinCosine: 0.8,
  source: 'uncalibrated-default',
  calibrationRunId: null,
});

/** Threshold sweep grid {0, 0.05, ..., 1}. */
export const CALIBRATION_GRID: readonly number[] = Object.freeze(
  Array.from({ length: 21 }, (_, index) => index * 5 / 100),
);

export const REPORT_SCHEMA = 'browser-doc-qa.measurement.v3' as const;
export const RECALL_KS: readonly number[] = [1, 3, 5];
export const MRR_DEPTH = 5;
export const MEASURED_PASSES = 3;
export const LOW_N_NOTE_BELOW = 20;
