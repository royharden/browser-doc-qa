import assert from 'node:assert/strict';
import test from 'node:test';
import { harborPages, harborQuestions, SAMPLE_DOCUMENT_NAME } from '../src/data/harborLine.ts';
import { chunkPages } from '../src/lib/chunk.ts';
import { runMeasurement } from '../src/lib/measure.ts';
import { pagesFromPlainText, serializePages } from '../src/lib/textExtract.ts';
import type { Clock } from '../src/lib/ask.ts';

function clock(): Clock {
  let value = 0;
  return { now: () => { value += 1; return value; } };
}

test('plain text page markers round-trip the sample', () => {
  const pages = harborPages();
  assert.deepEqual(pagesFromPlainText(serializePages(pages)), pages);
  assert.deepEqual(pagesFromPlainText('Alpha\fBeta'), [
    { page: 1, text: 'Alpha' },
    { page: 2, text: 'Beta' },
  ]);
});

test('each bundled quote sits in exactly one default chunk', () => {
  const chunks = chunkPages(harborPages());
  for (const question of harborQuestions()) {
    for (const quote of question.goldQuotes) {
      const holders = chunks.filter((chunk) => chunk.text.includes(quote));
      assert.equal(holders.length, 1, question.id);
    }
  }
});

test('keyword harness hits lexical quotes, abstains on the helicopter question, and skips embeddings', async () => {
  const report = await runMeasurement({
    documentName: SAMPLE_DOCUMENT_NAME,
    pages: harborPages(),
    questions: harborQuestions(),
    embedder: null,
    clock: clock(),
    nowIso: '2026-10-23T18:00:00.000Z',
    environment: {
      userAgent: 'test',
      hardwareConcurrency: 4,
      deviceMemoryGb: null,
      webgpu: false,
      embeddingBackend: 'unavailable',
      embeddingModel: null,
      embeddingDtype: null,
      language: 'en',
    },
  });

  assert.equal(report.schema, 'browser-doc-qa.measurement.v1');
  assert.equal(report.questionCount, 8);
  assert.equal(report.environment.userAgent, 'test');
  const keyword = report.arms.find((arm) => arm.arm === 'keyword');
  const embedding = report.arms.find((arm) => arm.arm === 'embedding');
  const hybrid = report.arms.find((arm) => arm.arm === 'hybrid');
  assert.equal(keyword?.available, true);
  assert.equal(embedding?.available, false);
  assert.equal(hybrid?.available, false);
  assert.equal(report.stages.find((stage) => stage.stage === 'embed')?.n, 0);

  for (const question of harborQuestions().filter((item) => item.kind === 'lexical')) {
    const row = report.questions.find((item) => item.id === question.id);
    assert.equal(row?.arms.keyword.firstRelevantRank, 1, question.id);
    assert.equal(row?.arms.keyword.abstained, false, question.id);
  }
  const helicopter = report.questions.find((item) => item.id === 'helicopter-pad');
  assert.equal(helicopter?.arms.keyword.abstained, true);
  assert.equal(keyword?.abstain.correct, 1);
  assert.equal(report.answerer, 'extractive');
  assert.ok(report.notes.some((note) => note.includes('nearest-rank')));
});
