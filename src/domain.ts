export type ArmId = 'keyword' | 'embedding' | 'hybrid';

export type AnswerMode = 'extractive' | 'local-model';

export interface PageText {
  page: number;
  text: string;
}

export interface Span {
  page: number;
  start: number;
  end: number;
}

export interface Chunk {
  id: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  spans: Span[];
}

export interface ScoredHit {
  chunkId: string;
  score: number;
  rank: number;
}

export interface Embedder {
  modelId: string;
  dtype: string;
  backend: 'webgpu' | 'wasm';
  embed(texts: string[]): Promise<number[][]>;
}

export interface LocalGenerator {
  modelId: string;
  generate(prompt: string): Promise<string>;
}

export interface CitedSentence {
  text: string;
  citation: number;
  chunkId: string;
}

export interface AnswerView {
  mode: AnswerMode;
  abstained: boolean;
  reason?: string;
  sentences: CitedSentence[];
  text: string;
  generateMs: number;
}

export interface ArmView {
  arm: ArmId;
  available: boolean;
  unavailableReason?: string;
  hits: Array<ScoredHit & { chunk: Chunk }>;
  abstained: boolean;
  retrieveMs: number;
}

export interface AskResult {
  arms: ArmView[];
  answer: AnswerView;
  answerArm: ArmId | null;
}

export interface EnvironmentSnapshot {
  userAgent: string;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  webgpu: boolean | null;
  embeddingBackend: string;
  embeddingModel: string | null;
  embeddingDtype: string | null;
  language: string | null;
}

export interface ArmReport {
  arm: ArmId;
  available: boolean;
  unavailableReason?: string;
  recallAt: { k: number; recall: number }[];
  mrr: number | null;
  abstain: { expected: number; correct: number };
}

export interface StageReport {
  stage: 'extract' | 'chunk' | 'embed' | 'retrieve' | 'answer';
  arm: ArmId | null;
  n: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  samplesMs: number[];
  skippedReason?: string;
}

export interface QuestionArmReport {
  available: boolean;
  firstRelevantRank: number | null;
  abstained: boolean;
  topScore: number | null;
}

export interface QuestionReport {
  id: string;
  kind: 'lexical' | 'paraphrase' | 'unanswerable';
  prompt: string;
  arms: Record<ArmId, QuestionArmReport>;
}

export interface MeasurementReport {
  schema: 'browser-doc-qa.measurement.v1';
  startedAt: string;
  documentName: string;
  chunkCount: number;
  questionCount: number;
  answerableCount: number;
  answerer: 'extractive';
  answerArm: ArmId | null;
  arms: ArmReport[];
  stages: StageReport[];
  questions: QuestionReport[];
  environment: EnvironmentSnapshot;
  notes: string[];
}

export interface LabelledQuestion {
  id: string;
  kind: 'lexical' | 'paraphrase' | 'unanswerable';
  prompt: string;
  goldQuotes: string[];
  expectAbstain: boolean;
}

export interface LoadedDocument {
  id: string;
  name: string;
  savedAt: string;
  pages: PageText[];
  chunks: Chunk[];
  vectors: number[][] | null;
  embeddingModel: string | null;
  embeddingDtype: string | null;
  embeddingBackend: string | null;
  extractMs: number;
  chunkMs: number;
}

export interface StoredDocument {
  id: string;
  name: string;
  savedAt: string;
  pages: PageText[];
  vectors: number[][] | null;
  embeddingModel: string | null;
  embeddingDtype: string | null;
  embeddingBackend: string | null;
  extractMs: number;
}
