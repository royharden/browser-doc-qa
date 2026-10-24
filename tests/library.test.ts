import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryLibrary } from '../src/adapters/libraryStore.ts';
import { readEnvironment } from '../src/adapters/environment.ts';
import { documentFromPages } from '../src/session.ts';
import type { MeasurementReport } from '../src/domain.ts';

test('memory library drops vectors that no longer match the chunks', async () => {
  const store = memoryLibrary();
  const document = documentFromPages(
    'Note',
    [{ page: 1, text: 'Alpha beta gamma.' }],
    { extractMs: 2 },
    { id: 'n1', savedAt: '2026-10-23T00:00:00.000Z' },
  );
  await store.put({
    ...document,
    vectors: [[1, 2], [3, 4]],
    embeddingModel: 'example-model',
  });
  const loaded = await store.get('n1');
  assert.equal(loaded?.vectors, null);
  assert.equal(loaded?.embeddingModel, null);
  assert.equal(loaded?.name, 'Note');

  await store.put(document);
  const clean = await store.get('n1');
  assert.equal(clean?.chunks.length, 1);
  await store.delete('n1');
  assert.equal(await store.get('n1'), null);
});

test('memory library keeps a report and rejects a foreign shape', async () => {
  const store = memoryLibrary('memory only');
  assert.equal(store.warning, 'memory only');
  const report = { schema: 'browser-doc-qa.measurement.v1' } as MeasurementReport;
  await store.saveReport(report);
  assert.equal((await store.loadReport())?.schema, report.schema);
});

test('environment probe records WebGPU presence without claiming a model', () => {
  const snapshot = readEnvironment({
    userAgent: 'TestBrowser',
    hardwareConcurrency: 8,
    deviceMemory: 4,
    language: 'en-US',
    gpu: {},
  });
  assert.equal(snapshot.webgpu, true);
  assert.equal(snapshot.deviceMemoryGb, 4);
  assert.equal(snapshot.embeddingModel, null);
  assert.equal(snapshot.embeddingBackend, 'unavailable');
});
