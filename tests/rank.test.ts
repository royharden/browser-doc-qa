import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBm25, keywordSearch } from '../src/lib/bm25.ts';
import { tokenize } from '../src/lib/tokenize.ts';
import { cosineSimilarity, embeddingSearch } from '../src/lib/vector.ts';
import { reciprocalRankFusion } from '../src/lib/rrf.ts';
import { ActionableError } from '../src/lib/errors.ts';
import type { Chunk } from '../src/domain.ts';

function chunk(id: string, text: string): Chunk {
  return { id, text, pageStart: 1, pageEnd: 1, spans: [{ page: 1, start: 0, end: text.length }] };
}

test('tokenizer drops stopwords and splits times', () => {
  assert.deepEqual(tokenize('What is the Pier 10:40?'), ['pier', '10', '40']);
  assert.deepEqual(tokenize('555-0148'), ['5550148']);
});

test('BM25 ranks the chunk that contains the query terms first', () => {
  const chunks = [
    chunk('c0', 'Tickets are sold at the window.'),
    chunk('c1', 'The senior fare is 7 dollars with photo identification.'),
  ];
  const hits = keywordSearch(buildBm25(chunks), 'What is the senior fare?', 5);
  assert.equal(hits[0]?.chunkId, 'c1');
  assert.equal(hits[0]?.rank, 1);
});

test('unknown query tokens produce no keyword hits', () => {
  const hits = keywordSearch(buildBm25([chunk('c0', 'Fog delays hold the boat.')]), 'helicopter pad', 5);
  assert.deepEqual(hits, []);
});

test('cosine is 1 on the same direction and 0 on orthogonal or empty vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], [1]), 0);
});

test('embedding search rejects a vector list that does not match the chunks', () => {
  assert.throws(
    () => embeddingSearch([chunk('c0', 'a')], [], [1, 0], 3),
    (error: unknown) => error instanceof ActionableError && error.code === 'vector-mismatch',
  );
});

test('embedding search returns the nearest positive chunk', () => {
  const chunks = [chunk('c0', 'north'), chunk('c1', 'east')];
  const hits = embeddingSearch(chunks, [[1, 0], [0, 1]], [0.9, 0.1], 2);
  assert.equal(hits[0]?.chunkId, 'c0');
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
});

test('reciprocal rank fusion rewards agreement', () => {
  const fused = reciprocalRankFusion([['a', 'b'], ['b', 'c']], 60);
  assert.equal(fused[0]?.id, 'b');
  const expected = 1 / 61 + 1 / 62;
  assert.ok(Math.abs((fused[0]?.score ?? 0) - expected) < 1e-12);
});
