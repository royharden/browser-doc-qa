import assert from 'node:assert/strict';
import test from 'node:test';
import { AppController } from '../src/browser/controller.ts';
import { memoryLibrary } from '../src/adapters/libraryStore.ts';
import { BGE_SMALL_EN_V15 } from '../src/adapters/modelRegistry.ts';
import type { EmbedderStatus } from '../src/domain.ts';

test('download UI reports partial bytes rather than treating one active file as complete', async () => {
  // Catches a 1/1 file-discovery count rendering a completed progress bar during partial transfer.
  let complete!: (status: EmbedderStatus) => void;
  const loading = new Promise<EmbedderStatus>(resolve => { complete = resolve; });
  const controller = new AppController({
    clock: { now: () => 0 }, pdf: { extract: async () => { throw new Error('Unused'); } },
    environment: {
      snapshot: () => ({ userAgent: null, hardwareConcurrency: null, deviceMemoryGb: null,
        webgpuApiPresent: null, crossOriginIsolated: null, language: null }),
      probeWebGpu: async () => false, wasmThreads: () => null,
    },
    openLibrary: async () => memoryLibrary(), deleteDatabase: async () => { throw new Error('No deletion'); },
    preferences: { getPersistence: () => false, setPersistence: () => {}, clear: () => {} },
    sourceRevision: 'test-oracle',
    dense: {
      identity: BGE_SMALL_EN_V15.identity, downloadEstimate: 'test', approvedOrigins: [], status: () => null,
      load: (_backend, _signal, progress) => {
        progress({ phase: 'download', done: 1, total: 1, loadedBytes: 512, totalBytes: 1024 });
        return loading;
      },
      buildIndex: async () => { throw new Error('Unused'); },
      clearModelCache: async () => { throw new Error('No deletion'); }, dispose: () => {},
    },
  });
  await controller.init();
  const pending = controller.loadModel('wasm');
  assert.deepEqual(controller.getState().progress, { label: 'Downloading model bytes', done: 512, total: 1024 });
  complete({ identity: BGE_SMALL_EN_V15.identity, backend: 'wasm', initMs: 1 });
  await pending;
  controller.dispose();
});
