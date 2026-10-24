/**
 * Canonical product types. One definition per concept (PLAN.md section 2).
 * Runtime validators for data that crosses a trust boundary live in src/validate.ts.
 * Offsets are half-open UTF-16 code-unit offsets into a page's canonicalText.
 */

export type ArmId = 'keyword' | 'dense' | 'hybrid';
export const ARMS: readonly ArmId[] = ['keyword', 'dense', 'hybrid'];

export type SourceType = 'pdf' | 'txt' | 'md' | 'fixture';

export interface Page {
  /** One-based. PDF page numbers and empty pages are preserved. */
  pageNumber: number;
  canonicalText: string;
}

export interface DocumentRecord {
  id: string;
  /** Deterministic hash of the canonical pages (see lib/hash.ts). */
  contentHash: string;
  displayName: string;
  sourceType: SourceType;
  extractionVersion: string;
  pages: Page[];
  /** Pages with no extractable text, kept for warnings. */
  emptyPages: number[];
}

export interface ChunkerConfig {
  version: string;
  maxChars: number;
  overlapChars: number;
  minTailChars: number;
}

export interface Chunk {
  /** Stable within a corpus revision; ties break on codepoint order of this id. */
  id: string;
  documentId: string;
  corpusRevision: string;
  pageNumber: number;
  start: number;
  end: number;
  /** Invariant: text === page.canonicalText.slice(start, end). */
  text: string;
  chunkerVersion: string;
  chunkerConfig: ChunkerConfig;
}

export interface EvidenceUnit {
  unitId: string;
  sourceHash: string;
  pageNumber: number;
  start: number;
  end: number;
  quote: string;
}

export type Suite = 'tutorial' | 'calibration' | 'evaluation';
export type QuestionKind = 'lexical' | 'paraphrase' | 'multi-evidence' | 'negative' | 'hard-negative';

export interface LabelledQuestion {
  id: string;
  suite: Suite;
  kind: QuestionKind;
  text: string;
  /** Answerables have at least one unit; negatives have none. */
  evidenceUnits: EvidenceUnit[];
}

export function isNegativeKind(kind: QuestionKind): boolean {
  return kind === 'negative' || kind === 'hard-negative';
}

export interface RankScore {
  rank: number;
  score: number;
}

export interface Hit {
  chunkId: string;
  pageNumber: number;
  start: number;
  end: number;
  /** BM25 score (not a probability). */
  keyword: RankScore | null;
  /** Cosine similarity of normalized vectors. */
  dense: RankScore | null;
  /** RRF score. */
  fused: RankScore | null;
  via: { keyword: boolean; dense: boolean };
  /** Rank within the arm that produced this hit list. */
  rank: number;
  corpusRevision: string;
  configFingerprint: string;
}

export interface CitationId {
  revision: string;
  sourceHash: string;
  pageNumber: number;
  start: number;
  end: number;
}

export interface Excerpt {
  /** Answer-local alias [n]; immutable once the answer exists. */
  alias: number;
  citation: CitationId;
  quote: string;
  sourceChunkId: string;
  /** True when the excerpt is a bounded piece of a longer sentence. */
  fragment: boolean;
  keywordCoverage: number | null;
  denseCosine: number | null;
}

export type GatePolicySource = 'uncalibrated-default' | 'calibrated' | 'partially-calibrated';

export interface GatePolicy {
  keywordMinCoverage: number;
  denseMinCosine: number;
  source: GatePolicySource;
  /** Which component gates came from the calibration sweep; the others are uncalibrated defaults. */
  calibratedGates: ('keyword' | 'dense')[];
  /** Fingerprint of the calibration run that produced it, when calibrated. */
  calibrationRunId: string | null;
}

export type AnswerStatus = 'answered' | 'abstained' | 'no-query-terms' | 'unavailable' | 'error';

export interface Answer {
  arm: ArmId;
  status: AnswerStatus;
  excerpts: Excerpt[];
  /** Human-readable reason for abstained/unavailable/error. */
  reason: string | null;
  policy: GatePolicy;
  /** Present when a dense sentence-stage error kept retrieval but lost the answer. */
  stageError: { stage: string; message: string } | null;
}

export type BackendKind = 'wasm' | 'webgpu';

export interface ModelIdentity {
  modelId: string;
  revision: string;
  dtype: string;
  dimensions: number;
  pooling: 'cls' | 'mean';
  normalized: boolean;
  queryPrefixVersion: string;
  tokenizerRevision: string;
  maxTokens: number;
}

export interface EmbedderStatus {
  identity: ModelIdentity;
  /** Backend actually used by the runtime, never inferred from navigator.gpu. */
  backend: BackendKind;
  initMs: number;
}

export type EmbedKind = 'query' | 'passage' | 'sentence';

export interface EnvironmentSnapshot {
  userAgent: string | null;
  hardwareConcurrency: number | null;
  /** Missing navigator.deviceMemory means unknown. */
  deviceMemoryGb: number | null;
  webgpuApiPresent: boolean | null;
  crossOriginIsolated: boolean | null;
  language: string | null;
}

export type JobState =
  | 'idle'
  | 'importing'
  | 'keyword-ready'
  | 'loading-model'
  | 'indexing'
  | 'full-ready'
  | 'asking'
  | 'benchmarking'
  | 'cancelling'
  | 'error';
