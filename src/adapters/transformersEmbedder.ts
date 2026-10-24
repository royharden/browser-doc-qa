import type { BackendKind, EmbedKind, EmbedderStatus } from '../domain.ts';
import type { EmbedProgress, Embedder } from '../ports.ts';
import { ActionableError } from '../lib/errors.ts';
import { PendingRequests, realTimers, type TimerApi } from '../lib/lifecycle.ts';
import { validateVectors } from '../lib/vector.ts';
import { BGE_SMALL_EN_V15, type RegistryEntry } from './modelRegistry.ts';
import { isWorkerReply, type WorkerReply, type WorkerRequest } from './workerProtocol.ts';

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export const LOAD_TIMEOUT_MS = 10 * 60_000;
export const EMBED_TIMEOUT_MS = 120_000;
export const COUNT_TIMEOUT_MS = 60_000;
export const WEBGPU_PROBE_MS = 1_500;
/** Batches are at most 16 items and at most this many tokens. */
export const MAX_BATCH_ITEMS = 16;
export const MAX_BATCH_TOKENS = 4_096;

type ResultPayload = Extract<WorkerReply, { status: 'result' }>['payload'];

/**
 * Worker client for the real embedding model. A client-side pending map owns every request; cancel,
 * timeout, worker error and dispose settle every promise exactly once. A stalled worker is terminated
 * on timeout (Promise.race alone is not enough) and late replies are ignored. Requests are serialized:
 * one batch at a time.
 */
export function workerEmbedder(makeWorker: () => WorkerLike, entry: RegistryEntry = BGE_SMALL_EN_V15, timers: TimerApi = realTimers): Embedder {
  let worker: WorkerLike | null = null;
  let pending = new PendingRequests<ResultPayload>(timers);
  let status: EmbedderStatus | null = null;
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const terminate = (reason: ActionableError): void => {
    worker?.terminate();
    worker = null;
    status = null;
    pending.rejectAll(reason);
    pending = new PendingRequests<ResultPayload>(timers);
  };

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker;
    const created = makeWorker();
    created.onmessage = (event) => {
      const message = event.data;
      if (!isWorkerReply(message)) return;
      if (message.status === 'progress') pending.progress(message.requestId, message.payload);
      else if (message.status === 'error') pending.reject(message.requestId, new ActionableError(message.payload.code, message.payload.message));
      else pending.resolve(message.requestId, message.payload);
    };
    created.onerror = (event) => terminate(new ActionableError('worker-crashed', `The model worker stopped: ${event.message ?? 'unknown error'}.`));
    worker = created;
    return created;
  };

  const send = <P extends ResultPayload>(
    build: (requestId: string) => WorkerRequest,
    timeoutMs: number,
    signal: AbortSignal,
    onProgress?: (progress: EmbedProgress) => void,
  ): Promise<P> => {
    const run = async (): Promise<P> => {
      if (signal.aborted) throw new ActionableError('cancelled', 'Cancelled.');
      const target = ensureWorker();
      sequence += 1;
      const requestId = `r${sequence}`;
      const promise = pending.create(
        requestId,
        timeoutMs,
        () => terminate(new ActionableError('timeout', 'The model worker stopped responding and was restarted. Load the model again.')),
        signal,
        onProgress ? (progress) => onProgress(progress as EmbedProgress) : undefined,
      );
      target.postMessage(build(requestId));
      // The worker cannot abort an in-flight load/inference. Cancelling an in-flight request therefore
      // terminates the worker (like a timeout), so the next request can never overlap the abandoned one.
      const onAbort = (): void => {
        if (worker === target) terminate(new ActionableError('cancelled', 'Cancelled; the model worker was stopped. Load the model again.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        return (await promise) as P;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  async function tokenCount(texts: readonly string[], kind: EmbedKind, signal: AbortSignal): Promise<number[]> {
    if (!status) throw new ActionableError('model-not-loaded', 'Load the embedding model first.');
    const result = await send<Extract<ResultPayload, { counts: number[] }>>((requestId) => ({
      requestId, corpusRevision: '', op: 'count', payload: { texts: [...texts], kind },
    }), COUNT_TIMEOUT_MS, signal);
    if (!Array.isArray(result.counts) || result.counts.length !== texts.length || !result.counts.every((n) => Number.isInteger(n) && n > 0)) {
      throw new ActionableError('tokenizer-invalid', 'The tokenizer returned unexpected counts.');
    }
    return result.counts;
  }

  return {
    identity: entry.identity,
    async load(backend: BackendKind, signal, onProgress) {
      if (status && status.backend === backend) return status;
      if (status) terminate(new ActionableError('reloading', 'Switching backend.'));
      const result = await send<Extract<ResultPayload, { initMs: number }>>((requestId) => ({
        requestId,
        corpusRevision: '',
        op: 'load',
        payload: { backend, modelId: entry.identity.modelId, revision: entry.identity.revision, dtype: entry.identity.dtype, webgpuProbeMs: WEBGPU_PROBE_MS },
      }), LOAD_TIMEOUT_MS, signal, onProgress);
      if (result.dimensions !== entry.identity.dimensions) {
        terminate(new ActionableError('model-shape', 'Unexpected model output shape.'));
        throw new ActionableError('model-shape', `The model reports ${result.dimensions} dimensions; expected ${entry.identity.dimensions}.`);
      }
      // The backend comes from the worker's actual execution, never from navigator.gpu or the request alone.
      status = { identity: entry.identity, backend: result.backend, initMs: result.initMs };
      return status;
    },
    async embed(texts, kind, signal, onProgress) {
      if (!status) throw new ActionableError('model-not-loaded', 'Load the embedding model first.');
      const counts = await tokenCount(texts, kind, signal);
      const overflow = counts.map((count, index) => ({ count, index })).filter((item) => item.count > entry.identity.maxTokens);
      if (overflow.length > 0) {
        const detail = overflow.slice(0, 5).map((item) => `#${item.index} (${item.count} tokens)`).join(', ');
        throw new ActionableError(kind === 'query' ? 'query-overflow' : kind === 'sentence' ? 'sentence-overflow' : 'passage-overflow',
          `${overflow.length} ${kind} input(s) exceed ${entry.identity.maxTokens} tokens: ${detail}. Nothing was truncated.`);
      }
      const vectors: Float32Array[] = [];
      for (const batch of batches(counts)) {
        const slice = texts.slice(batch.start, batch.end);
        const result = await send<Extract<ResultPayload, { data: Float32Array }>>((requestId) => ({
          requestId, corpusRevision: '', op: 'embed', payload: { texts: [...slice], kind },
        }), EMBED_TIMEOUT_MS, signal);
        if (result.count !== slice.length || result.dimensions !== entry.identity.dimensions || result.data.length !== result.count * result.dimensions) {
          throw new ActionableError('vector-invalid', `The model returned ${result.count}x${result.dimensions} values for ${slice.length} inputs.`);
        }
        for (let row = 0; row < result.count; row += 1) {
          vectors.push(result.data.slice(row * result.dimensions, (row + 1) * result.dimensions));
        }
        onProgress?.({ phase: 'embed', done: vectors.length, total: texts.length });
      }
      validateVectors(vectors, texts.length, entry.identity.dimensions, `${kind} vectors`);
      return vectors;
    },
    tokenCount,
    status: () => status,
    dispose() {
      pending.dispose();
      worker?.terminate();
      worker = null;
      status = null;
    },
  };

  function batches(counts: readonly number[]): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    let start = 0;
    let tokens = 0;
    for (let index = 0; index < counts.length; index += 1) {
      const count = counts[index] ?? 0;
      if (index > start && (index - start >= MAX_BATCH_ITEMS || tokens + count > MAX_BATCH_TOKENS)) {
        out.push({ start, end: index });
        start = index;
        tokens = 0;
      }
      tokens += count;
    }
    if (start < counts.length) out.push({ start, end: counts.length });
    return out;
  }
}

export function browserWorkerFactory(): WorkerLike {
  return new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

