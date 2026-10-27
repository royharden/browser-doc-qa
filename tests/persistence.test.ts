import assert from 'node:assert/strict';
import test from 'node:test';
import { AppController } from '../src/browser/controller.ts';
import type { Services } from '../src/browser/services.ts';
import type { Clock, DocumentSummary, LibraryStore } from '../src/ports.ts';
import { memoryLibrary } from '../src/adapters/libraryStore.ts';
import { documentFromTextBytes } from '../src/lib/ingest.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(openLibrary: Services['openLibrary'], clock: Clock = { now: () => 0 }) {
  let preference = false;
  const controller = new AppController({
    clock, dense: null, openLibrary,
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

test('tutorial and evaluation preparation use the clock instead of placeholder zero durations', async () => {
  // Catches falsely measured cold setup while chunk/BM25 timing happens to be real.
  let tick = 0;
  const { controller } = setup(async () => memoryLibrary(), { now: () => tick += 5 });
  await controller.init();
  await controller.loadTutorial();
  assert.ok(controller.getState().setup.find(item => item.name === 'fixture-prepare')!.ms > 0);
  await controller.loadEvaluationCorpus();
  assert.ok(controller.getState().setup.find(item => item.name === 'fixture-prepare')!.ms > 0);
  controller.dispose();
});

test('saved-document read timing includes the actual asynchronous store lookup', async () => {
  // Catches persisted imports being displayed/exported as zero-cost reads regardless of elapsed clock.
  let tick = 0;
  const store = memoryLibrary();
  const document = documentFromTextBytes(new TextEncoder().encode('Saved synthetic text.').buffer, 'saved.txt', 'txt');
  await store.putDocument(document);
  const { controller } = setup(async () => store, { now: () => tick += 5 });
  await controller.init();
  await controller.openSaved(document.id);
  assert.ok(controller.getState().setup.find(item => item.name === 'read')!.ms > 0);
  controller.dispose();
});
