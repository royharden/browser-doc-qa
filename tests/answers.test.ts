import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chunk, ScoredHit } from '../src/domain.ts';
import { extractiveAnswer } from '../src/lib/extractive.ts';
import { groundGeneratedText } from '../src/lib/grounding.ts';
import { highlightPage } from '../src/lib/highlight.ts';
import { askQuestion, type Clock } from '../src/lib/ask.ts';
import { documentFromPages } from '../src/session.ts';

const jackets = 'Life jackets are stored in the port locker beside the wheelhouse.';

function clock(): Clock {
  let value = 0;
  return { now: () => { value += 1; return value; } };
}

function jacketChunk(): Chunk {
  return {
    id: 'c0',
    text: `${jackets} Fog delays hold the boat at the dock.`,
    pageStart: 3,
    pageEnd: 3,
    spans: [{ page: 3, start: 0, end: jackets.length }],
  };
}

test('highlight merges overlapping ranges', () => {
  const segments = highlightPage('abcdef', [{ start: 1, end: 3 }, { start: 2, end: 5 }]);
  assert.deepEqual(segments, [
    { text: 'a', marked: false },
    { text: 'bcde', marked: true },
    { text: 'f', marked: false },
  ]);
});

test('extractive answer cites the overlapping sentence and abstains when asked', () => {
  const chunk = jacketChunk();
  const hits: ScoredHit[] = [{ chunkId: 'c0', score: 2, rank: 1 }];
  const map = new Map([[chunk.id, chunk]]);
  const answer = extractiveAnswer('Where are the life jackets stored?', hits, map, false);
  assert.equal(answer.abstained, false);
  assert.equal(answer.sentences[0]?.citation, 1);
  assert.match(answer.text, /\[1\]/);
  const abstained = extractiveAnswer('Where are the life jackets stored?', hits, map, true);
  assert.equal(abstained.abstained, true);
  assert.equal(abstained.text, '');
});

test('grounding keeps a copied sentence and drops an invented one', () => {
  const chunk = jacketChunk();
  const hits: ScoredHit[] = [{ chunkId: 'c0', score: 1, rank: 1 }];
  const map = new Map([[chunk.id, chunk]]);
  const mixed = groundGeneratedText(
    `${jackets} The helicopter is on the roof.`,
    hits,
    map,
  );
  assert.equal(mixed.abstained, false);
  assert.equal(mixed.sentences.length, 1);
  assert.match(mixed.sentences[0]?.text ?? '', /Life jackets/);

  const invented = groundGeneratedText('The helicopter is on the roof.', hits, map);
  assert.equal(invented.abstained, true);
  const declined = groundGeneratedText("I don't know", hits, map);
  assert.equal(declined.abstained, true);
});

test('keyword ask abstains when no term matches and cites when it does', async () => {
  const document = documentFromPages('Note', [{ page: 1, text: jackets }], { extractMs: 1 }, { id: 'n1' }, clock());
  const miss = await askQuestion({
    document,
    query: 'Is a helicopter pad available for charter pickups?',
    embedder: null,
    generator: null,
    mode: 'extractive',
    clock: clock(),
  });
  assert.equal(miss.arms.find((arm) => arm.arm === 'keyword')?.abstained, true);
  assert.equal(miss.answer.abstained, true);
  assert.equal(miss.arms.find((arm) => arm.arm === 'embedding')?.available, false);

  const hit = await askQuestion({
    document,
    query: 'Where are the life jackets stored?',
    embedder: null,
    generator: null,
    mode: 'extractive',
    clock: clock(),
  });
  assert.equal(hit.answer.abstained, false);
  assert.match(hit.answer.text, /port locker/);
  assert.equal(hit.answerArm, 'keyword');
});
