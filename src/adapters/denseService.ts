import type { BackendKind, EmbedderStatus, ModelIdentity } from '../domain.ts';
import type { Clock, Embedder } from '../ports.ts';
import type { DenseService } from '../browser/services.ts';
import type { SentenceCandidate } from '../lib/answer.ts';
import type { DenseContext } from '../lib/ask.ts';
import { ActionableError } from '../lib/errors.ts';
import { fingerprint } from '../lib/hash.ts';
import { validateVector, validateVectors, type Vector } from '../lib/vector.ts';
import type { Corpus } from '../session.ts';
import { BGE_SMALL_EN_V15, downloadEstimate, type RegistryEntry } from './modelRegistry.ts';
import { browserWorkerFactory, workerEmbedder } from './transformersEmbedder.ts';

/** Transformers.js keeps downloaded model files in this Cache Storage bucket. */
export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

/**
 * Full cache identity (PLAN.md section 4): content hash, extraction version, chunker version/config,
 * ordered chunk ids, artifact/tokenizer revision, dtype/dimension/pooling/normalization/prefix version and
 * the backend (cached results are treated as backend-dependent). Same count/width is never sufficient.
 */
export function passageCacheIdentity(corpus: Corpus, identity: ModelIdentity, backend: BackendKind): Record<string, unknown> {
  const first = corpus.chunks[0];
  return {
    kind: 'passage',
    contentHash: corpus.document.contentHash,
    extractionVersion: corpus.document.extractionVersion,
    corpusRevision: corpus.revision,
    chunkerVersion: first?.chunkerVersion ?? null,
    chunkerConfig: first?.chunkerConfig ?? null,
    chunkIds: fingerprint({ ids: corpus.chunks.map((chunk) => chunk.id) }),
    model: { ...identity },
    backend,
  };
}

export function createDenseService(
  makeEmbedder: () => Embedder = () => workerEmbedder(browserWorkerFactory),
  clock: Clock = { now: () => performance.now() },
  entry: RegistryEntry = BGE_SMALL_EN_V15,
): DenseService {
  let embedder: Embedder | null = null;
  const current = (): Embedder => {
    embedder ??= makeEmbedder();
    return embedder;
  };

  return {
    identity: entry.identity,
    downloadEstimate: downloadEstimate(entry),
    approvedOrigins: entry.approvedOrigins,
    status: () => embedder?.status() ?? null,
    load(backend, signal, onProgress): Promise<EmbedderStatus> {
      return current().load(backend, signal, onProgress);
    },
    async buildIndex(corpus, library, signal, onProgress) {
      const model = current();
      const status = model.status();
      if (!status) throw new ActionableError('model-not-loaded', 'Load the embedding model first.');
      const identity = passageCacheIdentity(corpus, entry.identity, status.backend);
      const key = fingerprint(identity);
      const ids = corpus.chunks.map((chunk) => chunk.id);
      const started = clock.now();
      const lookup = await library.getVectorSet(key, identity, ids, entry.identity.dimensions);
      let vectors: Float32Array[];
      let persistMs = 0;
      if (lookup.status === 'hit') {
        vectors = lookup.set.vectors.map((vector) => Float32Array.from(vector));
        validateVectors(vectors, ids.length, entry.identity.dimensions, 'cached passage vectors');
      } else {
        // Token-bound check happens inside embed(); any overflow fails the whole dense index.
        vectors = await model.embed(corpus.chunks.map((chunk) => chunk.text), 'passage', signal, onProgress);
        const persistStarted = clock.now();
        if (signal.aborted) throw new ActionableError('cancelled', 'Cancelled.');
        await library.putVectorSet({
          key,
          documentId: corpus.document.id,
          corpusRevision: corpus.revision,
          identity,
          ids,
          dimensions: entry.identity.dimensions,
          vectors: vectors.map((vector) => Array.from(vector)),
        });
        persistMs = library.kind === 'indexeddb' ? clock.now() - persistStarted : 0;
      }
      const embedMs = clock.now() - started - persistMs;
      if (signal.aborted) throw new ActionableError('cancelled', 'Cancelled.');
      return {
        context: denseContext(corpus, model, vectors, entry, status.backend),
        cache: lookup.status,
        embedMs,
        persistMs,
      };
    },
    async clearModelCache() {
      const notes = ['The ONNX Runtime WebAssembly files may remain in the ordinary browser HTTP cache, which a page cannot clear; use the browser\'s site-data settings for that.'];
      if (typeof caches === 'undefined') return { cleared: [], notes: ['Cache Storage is not available here.', ...notes] };
      const removed = await caches.delete(TRANSFORMERS_CACHE_NAME);
      return { cleared: removed ? [`Cache Storage "${TRANSFORMERS_CACHE_NAME}"`] : [], notes };
    },
    dispose() {
      embedder?.dispose();
      embedder = null;
    },
  };
}

/**
 * Dense context for one revision. Sentence vectors are cached per exact span key plus model/backend
 * fingerprint, so a changed span or config is never reused.
 */
function denseContext(corpus: Corpus, model: Embedder, vectors: readonly Float32Array[], entry: RegistryEntry, backend: BackendKind): DenseContext {
  const sentenceCache = new Map<string, Float32Array>();
  const configKey = fingerprint({ model: { ...entry.identity }, backend });
  return {
    corpusRevision: corpus.revision,
    vectors,
    executionKind: 'real-browser-model',
    async embedQuery(query, signal) {
      const [vector] = await model.embed([query], 'query', signal);
      if (!vector) throw new ActionableError('vector-invalid', 'The model returned no query vector.');
      validateVector(vector, entry.identity.dimensions, 'query vector');
      return vector;
    },
    async sentenceVectors(candidates: readonly SentenceCandidate[], signal: AbortSignal): Promise<ReadonlyMap<string, Vector>> {
      const keyOf = (candidate: SentenceCandidate): string => `${configKey}|${candidate.key}`;
      const missing = candidates.filter((candidate) => !sentenceCache.has(keyOf(candidate)));
      if (missing.length > 0) {
        const embedded = await model.embed(missing.map((candidate) => candidate.quote), 'sentence', signal);
        missing.forEach((candidate, index) => {
          const vector = embedded[index];
          if (vector) sentenceCache.set(keyOf(candidate), vector);
        });
      }
      const result = new Map<string, Vector>();
      for (const candidate of candidates) {
        const vector = sentenceCache.get(keyOf(candidate));
        if (vector) result.set(candidate.key, vector);
      }
      return result;
    },
  };
}
