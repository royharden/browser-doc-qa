import assert from 'node:assert/strict';
import test from 'node:test';
import { checkVectorSet, memoryLibrary } from '../src/adapters/libraryStore.ts';
import { harborDocument } from '../src/data/harborLine.ts';
import { ActionableError } from '../src/lib/errors.ts';
import { JobController, PendingRequests, type TimerApi } from '../src/lib/lifecycle.ts';

function manualTimers(): TimerApi & { fire(): void; active(): number } {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    set(callback) {
      const id = next;
      next += 1;
      callbacks.set(id, callback);
      return id;
    },
    clear(handle) {
      callbacks.delete(handle as number);
    },
    fire() {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id);
        callback();
      }
    },
    active: () => callbacks.size,
  };
}

test('a replaced or invalidated job can no longer commit', () => {
  const jobs = new JobController();
  const first = jobs.begin('index');
  const second = jobs.begin('index');
  assert.equal(first.signal.aborted, true, 'starting a job cancels the previous one');
  assert.equal(jobs.commit(first, () => assert.fail('stale write')), false);
  let wrote = false;
  assert.equal(jobs.commit(second, () => { wrote = true; }), true);
  assert.equal(wrote, true);
  jobs.invalidateAll();
  assert.equal(second.isCurrent(), false);
  assert.equal(jobs.commit(second, () => assert.fail('write after delete')), false);
});

test('timeout settles once, terminates the worker and a late success is ignored', async () => {
  const timers = manualTimers();
  const pending = new PendingRequests<string>(timers);
  let terminated = 0;
  const promise = pending.create('r1', 1000, () => { terminated += 1; });
  timers.fire();
  await assert.rejects(promise, (error: unknown) => error instanceof ActionableError && error.code === 'timeout');
  assert.equal(terminated, 1);
  assert.equal(pending.resolve('r1', 'late'), false);
  assert.equal(pending.size(), 0);
});

test('abort and dispose settle every outstanding request exactly once', async () => {
  const timers = manualTimers();
  const pending = new PendingRequests<number>(timers);
  const controller = new AbortController();
  const aborted = pending.create('a', 1000, () => {}, controller.signal);
  const other = pending.create('b', 1000, () => {});
  controller.abort();
  await assert.rejects(aborted, (error: unknown) => error instanceof ActionableError && error.code === 'cancelled');
  pending.dispose();
  await assert.rejects(other, (error: unknown) => error instanceof ActionableError && error.code === 'disposed');
  assert.equal(pending.size(), 0);
  assert.equal(timers.active(), 0, 'no timers left behind');
  await assert.rejects(pending.create('c', 1000, () => {}), (error: unknown) => error instanceof ActionableError && error.code === 'disposed');
});

test('memory library clones records and delete-all clears everything', async () => {
  const library = memoryLibrary();
  const document = harborDocument();
  await library.putDocument(document);
  const stored = await library.getDocument(document.id);
  assert.ok(stored);
  assert.notEqual(stored, document);
  stored.pages[0] = { pageNumber: 1, canonicalText: 'mutated' };
  assert.equal((await library.getDocument(document.id))?.pages[0]?.canonicalText, document.pages[0]?.canonicalText);
  await library.putReport({ schema: 'x' });
  await library.clearAll();
  assert.deepEqual(await library.listDocuments(), []);
  assert.equal(await library.getReport(), null);
});

test('vector cache lookups compare the full identity, ids and width', async () => {
  const library = memoryLibrary();
  const identity = { model: 'm', revision: 'r1', corpusRevision: 'c1' };
  await library.putVectorSet({ key: 'k', documentId: 'd', corpusRevision: 'c1', identity, ids: ['a', 'b'], dimensions: 2, vectors: [[1, 0], [0, 1]] });
  assert.equal((await library.getVectorSet('k', identity, ['a', 'b'], 2)).status, 'hit');
  const changed = await library.getVectorSet('k', { ...identity, revision: 'r2' }, ['a', 'b'], 2);
  assert.deepEqual(changed, { status: 'discarded', reason: 'cache identity changed' });
  assert.equal((await library.getVectorSet('k', identity, ['a', 'b'], 2)).status, 'miss', 'discarded entries are removed');
  assert.equal(checkVectorSet({ key: 'k', identity, ids: ['a'], dimensions: 2, vectors: [[Number.NaN, 0]] }, 'k', identity, ['a'], 2).status, 'discarded');
});
