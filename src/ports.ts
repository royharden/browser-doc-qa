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

export interface EnvironmentProbe {
  snapshot(): EnvironmentSnapshot;
  /** Bounded requestAdapter probe; null/rejection/timeout => false. Late completion is ignored. */
  probeWebGpu(timeoutMs: number): Promise<boolean>;
  wasmThreads(): number | null;
}
