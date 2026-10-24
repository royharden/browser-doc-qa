import type {
  AnswerStatus,
  ArmId,
  BackendKind,
  ChunkerConfig,
  EnvironmentSnapshot,
  GatePolicy,
  ModelIdentity,
  QuestionKind,
} from './domain.ts';
import type { REPORT_SCHEMA } from './lib/config.ts';

/**
 * browser-doc-qa.measurement.v3 (PLAN.md section 8). Types only; the validator lives in lib/reportValidate.ts.
 * All durations are milliseconds from the injected monotonic Clock, exported at full precision.
 */

export type RowStatus = 'ok' | 'unavailable' | 'error' | 'cancelled';

/** Real browser execution vs. contract-test values; only real rows may render as a production comparison. */
export type ExecutionKind = 'real-browser-lexical' | 'real-browser-model' | 'test-oracle';

export type QueryStage =
  | 'search-keyword'
  | 'embed-query'
  | 'search-vector'
  | 'fuse'
  | 'answer-select'
  | 'answer-embed'
  | 'answer-format';

export interface RowHit {
  chunkId: string;
  pageNumber: number;
  start: number;
  end: number;
  keywordRank: number | null;
  keywordScore: number | null;
  denseRank: number | null;
  denseCosine: number | null;
  fusedRank: number | null;
  fusedScore: number | null;
}

export interface RowAnswer {
  status: AnswerStatus;
  excerpts: { pageNumber: number; start: number; end: number; keywordCoverage: number | null; denseCosine: number | null }[];
  stageError: string | null;
}

export interface QueryRow {
  passId: string;
  passIndex: number;
  warmup: boolean;
  questionId: string;
  kind: QuestionKind;
  arm: ArmId;
  status: RowStatus;
  reason: string | null;
  failedStage: QueryStage | 'setup' | null;
  retrievalAttempted: boolean;
  retrievalSucceeded: boolean;
  executionKind: ExecutionKind;
  hits: RowHit[];
  /** Covered evidence-unit ids per k (keys "1","3","5"); null for negatives or failed retrieval. */
  coveredUnitIds: Record<string, string[]> | null;
  recall: Record<string, number> | null;
  reciprocalRank: number | null;
  answer: RowAnswer | null;
  stageMs: Partial<Record<QueryStage, number>>;
  retrievalSumMs: number | null;
  answerSumMs: number | null;
  retrievalWallMs: number | null;
  journeyWallMs: number | null;
}

export interface CoverageCounts {
  expected: number;
  attempted: number;
  ok: number;
  unavailable: number;
  error: number;
  cancelled: number;
}

export interface PassQuality {
  passId: string;
  /** Macro-averaged over the fixed answerable denominator; null when the pass is incomplete for this arm. */
  recall: Record<string, number> | null;
  mrr: number | null;
  correctAbstentions: number | null;
  falseAbstentions: number | null;
  falseAccepts: number | null;
  answerDecisionsComplete: boolean;
}

export interface ArmSummary {
  arm: ArmId;
  /** 'complete' allows comparable aggregates; 'partial' shows coverage and descriptive rows only; 'unavailable' is N/A. */
  state: 'complete' | 'partial' | 'unavailable';
  unavailableReason: string | null;
  coverage: CoverageCounts;
  answerableDenominator: number;
  negativeDenominator: number;
  passes: PassQuality[];
  /** Mean over passes; only present when state === 'complete'. */
  aggregate: {
    recall: Record<string, number>;
    mrr: number;
    /** Means over passes; null while any answer decision is missing (answer-stage errors). */
    correctAbstentions: number | null;
    falseAbstentions: number | null;
    falseAccepts: number | null;
  } | null;
  ranksVaryAcrossPasses: boolean;
  latency: LatencySummary;
}

export interface SampleSummary {
  n: number;
  p50: number | null;
  p95: number | null;
  samples: number[];
  lowN: boolean;
}

export interface LatencySummary {
  /** Retrieval component sum per arm definition (PLAN.md section 8). Success samples only. */
  retrievalSum: SampleSummary;
  retrievalWall: SampleSummary;
  answerJourneySum: SampleSummary;
  journeyWall: SampleSummary;
  stages: Partial<Record<QueryStage, SampleSummary>>;
  failureDurationsMs: number[];
  warmupExcluded: number;
}

export interface SetupObservation {
  name: 'fixture-prepare' | 'read' | 'extract' | 'chunk' | 'bm25-build' | 'model-init' | 'passage-embed' | 'persist';
  ms: number;
  items: number | null;
  note: string | null;
}

export interface MeasurementReport {
  schema: typeof REPORT_SCHEMA;
  runId: string;
  createdAt: string;
  app: { name: 'browser-doc-qa'; sourceRevision: string };
  fixture: {
    fixtureId: string;
    fixtureVersion: string;
    split: 'calibration' | 'evaluation';
    corpusHash: string;
    corpusRevision: string;
    chunkCount: number;
    questionIds: string[];
  };
  policy: GatePolicy;
  config: {
    chunker: ChunkerConfig;
    tokenizerVersion: string;
    configFingerprint: string;
    bm25: { k1: number; b: number };
    rrf: { k: number; pool: number; topK: number };
  };
  model: {
    identity: ModelIdentity;
    backend: BackendKind;
    initMs: number;
    executionKind: ExecutionKind;
  } | null;
  modelUnavailableReason: string | null;
  environment: EnvironmentSnapshot & { wasmThreads: number | null };
  cacheState: { sentenceVectors: 'warmed-by-excluded-pass' | 'not-applicable'; note: string };
  protocol: {
    warmupPasses: number;
    measuredPasses: number;
    armOrder: ArmId[];
    questionOrder: string[];
    passIds: string[];
    queryIsolation: 'independent-arms-no-cross-arm-reuse';
    effectiveQuery: 'original-fixture-text';
  };
  status: 'complete' | 'cancelled' | 'failed';
  arms: ArmSummary[];
  rows: QueryRow[];
  setup: SetupObservation[];
  notes: string[];
}
