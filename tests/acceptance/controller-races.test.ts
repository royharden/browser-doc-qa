import assert from 'node:assert/strict';
import test from 'node:test';
import { AppController } from '../../src/browser/controller.ts';
import type { Services } from '../../src/browser/services.ts';
import type { LibraryStore } from '../../src/ports.ts';
import { memoryLibrary } from '../../src/adapters/libraryStore.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function services(overrides: Partial<Services> = {}): Services {
  return {
    clock: { now: () => 0 }, dense: null,
    pdf: { extract: async () => { throw new Error('No PDF parsing in this controller contract test.'); } },
    environment: {
      snapshot: () => ({ userAgent: null, hardwareConcurrency: null, deviceMemoryGb: null,
        webgpuApiPresent: null, crossOriginIsolated: null, language: null }),
      probeWebGpu: async () => false, wasmThreads: () => null,
    },
    openLibrary: async () => memoryLibrary(),
    deleteDatabase: async () => { throw new Error('Deletion is not authorized or executed by this suite.'); },
    preferences: { getPersistence: () => false, setPersistence: () => {}, clear: () => { throw new Error('No deletion.'); } },
    sourceRevision: 'test-oracle', ...overrides,
  };
}

test('RV: cancel during file read cannot repopulate the document after late bytes arrive', async () => {
  // Catches stale import callbacks after cancellation without using any real filesystem or database.
  const read = deferred<ArrayBuffer>();
  const controller = new AppController(services());
  await controller.init();
  const pending = controller.importFile({ name: 'late.txt', type: 'text/plain', size: 10, arrayBuffer: () => read.promise });
  assert.equal(controller.getState().phase, 'importing');
  controller.cancel();
  read.resolve(new TextEncoder().encode('Late source content.').buffer);
  await pending;
  assert.equal(controller.getState().corpus, null);
  assert.equal(controller.getState().phase, 'idle');
  controller.dispose();
});

test('RV: replacing a pending import preserves the tutorial after late completion', async () => {
  // Catches stale source/citation revision replacement after a newer document is already ready.
  const read = deferred<ArrayBuffer>();
  const controller = new AppController(services());
  await controller.init();
  const pending = controller.importFile({ name: 'old.txt', type: 'text/plain', size: 10, arrayBuffer: () => read.promise });
  await controller.loadTutorial();
  const revision = controller.getState().corpus!.revision;
  read.resolve(new TextEncoder().encode('Obsolete content.').buffer);
  await pending;
  assert.equal(controller.getState().corpus!.revision, revision);
  assert.equal(controller.getState().phase, 'keyword-ready');
  controller.dispose();
});

test('RV: a late persistence opt-in cannot override a newer opt-out', async () => {
  // Catches privacy/state drift when two asynchronous storage opens finish in reverse order.
  // All stores are in-memory test doubles; no IndexedDB or deletion action is performed.
  const opening = deferred<LibraryStore>();
  let preference = false;
  const controller = new AppController(services({
    openLibrary: async (persistent) => persistent ? opening.promise : memoryLibrary(),
    preferences: { getPersistence: () => preference, setPersistence: (value) => { preference = value; }, clear: () => {} },
  }));
  await controller.init();
  const enable = controller.setPersistence(true);
  await controller.setPersistence(false);
  opening.resolve({ ...memoryLibrary(), kind: 'indexeddb' });
  await enable;
  assert.equal(preference, false);
  assert.equal(controller.getState().persistence.enabled, false, 'the latest opt-out must win');
  assert.equal(controller.getState().persistence.kind, 'memory');
  controller.dispose();
});
