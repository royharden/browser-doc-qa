import type { BackendKind, EmbedderStatus, ModelIdentity } from '../domain.ts';
import type { DenseContext } from '../lib/ask.ts';
import type { Clock, EmbedProgress, EnvironmentProbe, LibraryStore, PdfExtractor } from '../ports.ts';
import type { Corpus } from '../session.ts';

/** Dense layer: real model lifecycle and per-revision index (implemented in src/adapters/denseService.ts). */
export interface DenseService {
  readonly identity: ModelIdentity;
  /** Registry-derived download estimate text; never a fixed unverified size claim. */
  readonly downloadEstimate: string;
  readonly approvedOrigins: readonly string[];
  status(): EmbedderStatus | null;
  load(backend: BackendKind, signal: AbortSignal, onProgress: (progress: EmbedProgress) => void): Promise<EmbedderStatus>;
  /**
   * Embeds every chunk of the revision (or reuses a validated cache entry), checks token bounds first
   * and publishes nothing on failure. Resolves with a ready DenseContext for exactly that revision.
   */
  buildIndex(corpus: Corpus, library: LibraryStore, signal: AbortSignal, onProgress: (progress: EmbedProgress) => void): Promise<{ context: DenseContext; cache: 'hit' | 'miss' | 'discarded'; embedMs: number; persistMs: number }>;
  clearModelCache(): Promise<{ cleared: string[]; notes: string[] }>;
  dispose(): void;
}

/** Everything the controller needs; composed only in src/browser/wire.ts. */
export interface Services {
  clock: Clock;
  pdf: PdfExtractor;
  environment: EnvironmentProbe;
  dense: DenseService | null;
  openLibrary(persistent: boolean): Promise<LibraryStore>;
  deleteDatabase(): Promise<void>;
  preferences: Preferences;
  sourceRevision: string;
}

/** Per-viewer conveniences only (persistence opt-in flag). Reads/writes never throw. */
export interface Preferences {
  getPersistence(): boolean;
  setPersistence(enabled: boolean): void;
  clear(): void;
}
