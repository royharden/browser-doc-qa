import type { DocumentRecord, EmbedKind, EmbedderStatus, EnvironmentSnapshot, ModelIdentity } from './domain.ts';

/**
 * The one canonical location for browser-facing ports (PLAN.md section 2). Pure logic depends only on
 * these interfaces; src/browser/wire.ts composes the production adapters. Test doubles implement them
 * in tests only and are never wired into the UI.
 */

/** Monotonic clock (performance.now in production). */
export interface Clock {
  now(): number;
}

export interface ExtractProgress {
  pagesDone: number;
  pagesTotal: number;
}

export interface PdfExtractor {
  extract(bytes: ArrayBuffer, displayName: string, signal: AbortSignal, onProgress?: (progress: ExtractProgress) => void): Promise<DocumentRecord>;
}

export interface EmbedProgress {
  done: number;
  total: number;
  phase: 'download' | 'init' | 'embed';
  /** Byte progress, only when the runtime reports it. */
  loadedBytes?: number;
  totalBytes?: number;
}

/** Real embedding model. No fake/hash/random implementation may be wired into the product. */
export interface Embedder {
  readonly identity: ModelIdentity;
  /** Loads the model on the requested backend; resolves with the backend actually used. */
  load(backend: 'wasm' | 'webgpu', signal: AbortSignal, onProgress?: (progress: EmbedProgress) => void): Promise<EmbedderStatus>;
  /** Query prefixing happens inside the adapter for kind === 'query'. */
  embed(texts: readonly string[], kind: EmbedKind, signal: AbortSignal, onProgress?: (progress: EmbedProgress) => void): Promise<Float32Array[]>;
  /** Token count with the pinned tokenizer, including special tokens and (for queries) the prefix. */
  tokenCount(texts: readonly string[], kind: EmbedKind, signal: AbortSignal): Promise<number[]>;
  status(): EmbedderStatus | null;
  dispose(): void;
}

export interface DocumentSummary {
  id: string;
  displayName: string;
  sourceType: DocumentRecord['sourceType'];
  pageCount: number;
  savedAt: string;
}

/** Persisted vectors. The full cache identity is stored and compared on read; count/width alone is insufficient. */
export interface StoredVectorSet {
  key: string;
  documentId: string;
  corpusRevision: string;
  identity: Record<string, unknown>;
  /** Chunk ids (passages) or exact span keys (sentences), aligned with vectors. */
  ids: string[];
  dimensions: number;
  vectors: number[][];
}

export type VectorSetLookup =
  | { status: 'hit'; set: StoredVectorSet }
  | { status: 'miss' }
  | { status: 'discarded'; reason: string };

/**
 * Library storage. Memory is the default; IndexedDB only after explicit opt-in. Records are cloned on
 * write and read and runtime-validated on read. Same-origin browser storage is not an encrypted vault.
 */
export interface LibraryStore {
  readonly kind: 'memory' | 'indexeddb';
  readonly warning: string | null;
  listDocuments(): Promise<DocumentSummary[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  putDocument(document: DocumentRecord): Promise<void>;
  /** Deletes the document and every vector set built from it. */
  deleteDocument(id: string): Promise<void>;
  getVectorSet(key: string, identity: Record<string, unknown>, ids: readonly string[], dimensions: number): Promise<VectorSetLookup>;
  putVectorSet(set: StoredVectorSet): Promise<void>;
  /** Raw stored report; the caller validates it (lib/reportValidate.ts) before use. */
  getReport(): Promise<unknown>;
  putReport(report: unknown): Promise<void>;
  /** Delete all: documents, pages, chunks, vectors, reports and settings stored here. */
  clearAll(): Promise<void>;
  close(): void;
}

export interface EnvironmentProbe {
  snapshot(): EnvironmentSnapshot;
  /** Bounded requestAdapter probe; null/rejection/timeout => false. Late completion is ignored. */
  probeWebGpu(timeoutMs: number): Promise<boolean>;
  wasmThreads(): number | null;
}
