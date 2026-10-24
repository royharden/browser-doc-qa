import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryLibrary } from '../src/adapters/libraryStore.ts';
import { createDenseService, passageCacheIdentity } from '../src/adapters/denseService.ts';
import { BGE_SMALL_EN_V15 } from '../src/adapters/modelRegistry.ts';
import { MAX_BATCH_ITEMS, workerEmbedder, type WorkerLike } from '../src/adapters/transformersEmbedder.ts';
import type { WorkerRequest } from '../src/adapters/workerProtocol.ts';
import { harborDocument } from '../src/data/harborLine.ts';
import { ActionableError } from '../src/lib/errors.ts';
import type { TimerApi } from '../src/lib/lifecycle.ts';
import { buildCorpus } from '../src/session.ts';
import { fingerprint as fingerprintOf } from '../src/lib/hash.ts';

// TEST ORACLE ONLY: a scripted worker that returns deterministic unit vectors. Never wired into the app.
const DIM = BGE_SMALL_EN_V15.identity.dimensions;

interface FakeOptions {
  backend?: 'wasm' | 'webgpu';
  tokens?: (text: string) => number;
  vector?: (text: string, index: number) => number[];
  silent?: boolean;
}

function fakeWorker(options: FakeOptions = {}) {
  const sent: WorkerRequest[] = [];
  let terminated = 0;
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => { terminated += 1; },
    postMessage(request) {
      sent.push(request);
      if (options.silent && request.op !== 'load') return;
      queueMicrotask(() => {
        const base = { requestId: request.requestId, corpusRevision: request.corpusRevision, op: request.op, status: 'result' as const };
        if (request.op === 'load') worker.onmessage?.({ data: { ...base, payload: { backend: options.backend ?? request.payload.backend, initMs: 5, dimensions: DIM, wasmThreads: 1 } } });
        if (request.op === 'count') worker.onmessage?.({ data: { ...base, payload: { counts: request.payload.texts.map(options.tokens ?? ((text) => text.split(/\s+/).length + 2)) } } });
        if (request.op === 'embed') {
          const data = new Float32Array(request.payload.texts.length * DIM);
          request.payload.texts.forEach((text, row) => {
            const vector = options.vector?.(text, row) ?? unit(row % DIM);
            data.set(vector, row * DIM);
          });
          worker.onmessage?.({ data: { ...base, payload: { count: request.payload.texts.length, dimensions: DIM, data } } });
        }
      });
    },
  };
  return { worker, sent, terminated: () => terminated };
}

function unit(index: number): number[] {
  const vector = new Array<number>(DIM).fill(0);
  vector[index] = 1;
  return vector;
}

function manualTimers(): TimerApi & { fire(): void } {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    set(callback) { const id = next; next += 1; callbacks.set(id, callback); return id; },
    clear(handle) { callbacks.delete(handle as number); },
    fire() { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); } },
  };
}

const signal = new AbortController().signal;

test('the reported backend comes from the worker, and batches respect the 16-item cap', async () => {
  const fake = fakeWorker({ backend: 'wasm' });
  const embedder = workerEmbedder(() => fake.worker);
  const status = await embedder.load('webgpu', signal);
  assert.equal(status.backend, 'wasm', 'actual execution, not the request');
  const texts = Array.from({ length: 40 }, (_, index) => `passage ${index}`);
  const vectors = await embedder.embed(texts, 'passage', signal);
  assert.equal(vectors.length, 40);
  const embedCalls = fake.sent.filter((request) => request.op === 'embed');
  assert.ok(embedCalls.every((request) => request.op === 'embed' && request.payload.texts.length <= MAX_BATCH_ITEMS));
  assert.equal(embedCalls.length, 3);
});

test('token overflow fails explicitly instead of truncating', async () => {
  const fake = fakeWorker({ tokens: (text) => (text.includes('long') ? 600 : 10) });
  const embedder = workerEmbedder(() => fake.worker);
  await embedder.load('wasm', signal);
  await assert.rejects(embedder.embed(['short', 'very long passage'], 'passage', signal),
    (error: unknown) => error instanceof ActionableError && error.code === 'passage-overflow');
  await assert.rejects(embedder.embed(['long question'], 'query', signal),
    (error: unknown) => error instanceof ActionableError && error.code === 'query-overflow');
  assert.equal(fake.sent.filter((request) => request.op === 'embed').length, 0, 'nothing was embedded');
});

test('unnormalized or wrong vectors are rejected, never used', async () => {
  const fake = fakeWorker({ vector: () => new Array<number>(DIM).fill(1) });
  const embedder = workerEmbedder(() => fake.worker);
  await embedder.load('wasm', signal);
  await assert.rejects(embedder.embed(['a b'], 'passage', signal),
    (error: unknown) => error instanceof ActionableError && error.code === 'vector-invalid');
});

test('a stalled worker is terminated on timeout and its late reply cannot publish', async () => {
  const timers = manualTimers();
  const fake = fakeWorker({ silent: true });
  const embedder = workerEmbedder(() => fake.worker, BGE_SMALL_EN_V15, timers);
  await embedder.load('wasm', signal);
  const pending = embedder.tokenCount(['x'], 'passage', signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  timers.fire();
  await assert.rejects(pending, (error: unknown) => error instanceof ActionableError && error.code === 'timeout');
  assert.equal(fake.terminated(), 1);
  assert.equal(embedder.status(), null, 'the model must be loaded again');
  const last = fake.sent[fake.sent.length - 1];
  assert.ok(last);
  fake.worker.onmessage?.({ data: { requestId: last.requestId, corpusRevision: '', op: 'count', status: 'result', payload: { counts: [1] } } });
});

test('dispose settles outstanding requests', async () => {
  const fake = fakeWorker({ silent: true });
  const embedder = workerEmbedder(() => fake.worker);
  await embedder.load('wasm', signal);
  const pending = embedder.tokenCount(['x'], 'passage', signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  embedder.dispose();
  await assert.rejects(pending, (error: unknown) => error instanceof ActionableError && error.code === 'disposed');
});

test('dense index reuses only a cache entry with the full identity', async () => {
  const corpus = buildCorpus(harborDocument(), () => 0);
  const library = memoryLibrary();
  let embedderCalls = 0;
  const service = createDenseService(() => {
    embedderCalls += 1;
    return workerEmbedder(() => fakeWorker().worker);
  }, { now: () => 0 });
  await service.load('wasm', signal, () => {});
  const first = await service.buildIndex(corpus, library, signal, () => {});
  assert.equal(first.cache, 'miss');
  assert.equal(first.context.vectors.length, corpus.chunks.length);
  assert.equal(first.context.executionKind, 'real-browser-model');
  const second = await service.buildIndex(corpus, library, signal, () => {});
  assert.equal(second.cache, 'hit');
  assert.equal(embedderCalls, 1);
  const wasm = passageCacheIdentity(corpus, BGE_SMALL_EN_V15.identity, 'wasm');
  const gpu = passageCacheIdentity(corpus, BGE_SMALL_EN_V15.identity, 'webgpu');
  assert.notDeepEqual(wasm, gpu, 'backend is part of the identity');
});

test('query vectors are prefixed inside the adapter and sentence vectors are cached by exact span', async () => {
  const fake = fakeWorker();
  const service = createDenseService(() => workerEmbedder(() => fake.worker), { now: () => 0 });
  const corpus = buildCorpus(harborDocument(), () => 0);
  await service.load('wasm', signal, () => {});
  const { context } = await service.buildIndex(corpus, memoryLibrary(), signal, () => {});
  await context.embedQuery('When does it leave?', signal);
  const query = fake.sent.find((request) => request.op === 'embed' && request.payload.kind === 'query');
  assert.ok(query && query.op === 'embed');
  assert.deepEqual(query.payload.texts, ['When does it leave?'], 'the prefix is applied in the worker, not by callers');
  const candidate = { key: 'k1', chunkId: 'c', chunkRank: 1, pageNumber: 1, start: 0, end: 3, quote: 'abc', fragment: false };
  await context.sentenceVectors([candidate], signal);
  const before = fake.sent.length;
  await context.sentenceVectors([candidate], signal);
  assert.equal(fake.sent.length, before, 'cached spans are not re-embedded');
});

test('cancelling an in-flight request terminates the worker so the next request cannot overlap it', async () => {
  const fake = fakeWorker({ silent: true });
  const embedder = workerEmbedder(() => fake.worker);
  await embedder.load('wasm', signal);
  const controller = new AbortController();
  const pending = embedder.tokenCount(['x'], 'passage', controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof ActionableError && error.code === 'cancelled');
  assert.equal(fake.terminated(), 1, 'the busy worker was stopped');
  assert.equal(embedder.status(), null, 'the model must be loaded again on a fresh worker');
});

test('a cached vector set with invalid values is discarded and rebuilt, not fatal', async () => {
  const corpus = buildCorpus(harborDocument(), () => 0);
  const library = memoryLibrary();
  const service = createDenseService(() => workerEmbedder(() => fakeWorker().worker), { now: () => 0 });
  await service.load('wasm', signal, () => {});
  const first = await service.buildIndex(corpus, library, signal, () => {});
  assert.equal(first.cache, 'miss');
  const identity = passageCacheIdentity(corpus, BGE_SMALL_EN_V15.identity, 'wasm');
  const ids = corpus.chunks.map((chunk) => chunk.id);
  const lookup = await library.getVectorSet(fingerprintOf(identity), identity, ids, DIM);
  assert.equal(lookup.status, 'hit');
  if (lookup.status !== 'hit') return;
  await library.putVectorSet({ ...lookup.set, vectors: lookup.set.vectors.map((vector) => vector.map(() => 1)) });
  const rebuilt = await service.buildIndex(corpus, library, signal, () => {});
  assert.equal(rebuilt.cache, 'discarded');
  assert.equal(rebuilt.context.vectors.length, corpus.chunks.length);
});
