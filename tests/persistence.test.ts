import assert from 'node:assert/strict';
import test from 'node:test';
import { AppController } from '../src/browser/controller.ts';
import type { Services } from '../src/browser/services.ts';
import type { DocumentSummary, LibraryStore } from '../src/ports.ts';
import { memoryLibrary } from '../src/adapters/libraryStore.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(openLibrary: Services['openLibrary']) {
  let preference = false;
  const controller = new AppController({
    clock: { now: () => 0 }, dense: null, openLibrary,
    pdf: { extract: async () => { throw new Error('PDF not used'); } },
    environment: {
      snapshot: () => ({ userAgent: null, hardwareConcurrency: null, deviceMemoryGb: null,
        webgpuApiPresent: null, crossOriginIsolated: null, language: null }),
      probeWebGpu: async () => false, wasmThreads: () => null,
    },
    preferences: { getPersistence: () => preference, setPersistence: value => { preference = value; }, clear: () => {} },
    deleteDatabase: async () => { throw new Error('No deletion in these tests'); }, sourceRevision: 'test-oracle',
  });
  return { controller, preference: () => preference };
}

test('persistence opt-out wins when the older store is still listing documents', async () => {
  // Catches a stale list response publishing a persistent handle after newer memory intent.
  const listing = deferred<DocumentSummary[]>();
  const entered = deferred<void>();
  let closed = 0;
  const persistent: LibraryStore = { ...memoryLibrary(), kind: 'indexeddb',
    listDocuments: () => { entered.resolve(); return listing.promise; }, close: () => { closed += 1; } };
  const { controller, preference } = setup(async enabled => enabled ? persistent : memoryLibrary());
  await controller.init();
  const enable = controller.setPersistence(true);
  await entered.promise;
  await controller.setPersistence(false);
  listing.resolve([]);
  await enable;
  assert.equal(preference(), false);
  assert.equal(controller.getState().persistence.enabled, false);
  assert.equal(controller.getState().persistence.kind, 'memory');
  assert.equal(closed, 1);
  controller.dispose();
});

test('disposing during storage opening closes the late handle and publishes no later state', async () => {
  // Catches unmount leaks and delayed state/listener publication after an IndexedDB open.
  const opening = deferred<LibraryStore>();
  let closed = 0;
  const { controller } = setup(async enabled => enabled ? opening.promise : memoryLibrary());
  await controller.init();
  let updates = 0;
  controller.subscribe(() => { updates += 1; });
  const enable = controller.setPersistence(true);
  const beforeDispose = updates;
  controller.dispose();
  opening.resolve({ ...memoryLibrary(), kind: 'indexeddb', close: () => { closed += 1; } });
  await enable;
  assert.equal(closed, 1);
  assert.equal(updates, beforeDispose);
});
