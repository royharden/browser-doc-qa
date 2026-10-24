import assert from 'node:assert/strict';
import test from 'node:test';
import { bm25BuildCount, idf, keywordCoverage, keywordSearch } from '../src/lib/bm25.ts';
import { ActionableError } from '../src/lib/errors.ts';
import { reciprocalRankFusion } from '../src/lib/rrf.ts';
import { denseCandidates, fuseHits, keywordCandidates, keywordHits } from '../src/lib/retrieve.ts';
import { denseSearch, dot, validateVector } from '../src/lib/vector.ts';
import { buildCorpus, makeDocument } from '../src/session.ts';

const clock = (): number => 0;

function corpusOf(texts: string[]) {
  const document = makeDocument({
    displayName: 'test',
    sourceType: 'txt',
    extractionVersion: 'test',
    pages: texts.map((canonicalText, index) => ({ pageNumber: index + 1, canonicalText })),
  });
  return buildCorpus(document, clock);
}

test('IDF matches the declared formula, including OOV terms', () => {
  const corpus = corpusOf(['Tickets are sold at the window.', 'The senior fare is 7 dollars with photo identification.']);
  assert.ok(Math.abs(idf(corpus.bm25, 'senior') - Math.log(2)) < 1e-12);
  assert.ok(Math.abs(idf(corpus.bm25, 'helicopter') - Math.log(6)) < 1e-12);
});

test('BM25 ranks the matching chunk first and builds once per corpus', () => {
  const corpus = corpusOf(['Tickets are sold at the window.', 'The senior fare is 7 dollars with photo identification.']);
  const builds = bm25BuildCount();
  const hits = keywordSearch(corpus.bm25, 'What is the senior fare?', 5);
  keywordSearch(corpus.bm25, 'tickets window', 5);
  assert.equal(bm25BuildCount(), builds, 'queries never rebuild the index');
  assert.equal(hits[0]?.chunkId, corpus.chunks[1]?.id);
  assert.equal(hits[0]?.rank, 1);
  assert.equal(hits.length, 1, 'only positive-scoring hits');
});

test('empty, all-stopword and OOV queries produce no hits; empty-corpus math never yields NaN', () => {
  const corpus = corpusOf(['Fog delays hold the boat.']);
  assert.deepEqual(keywordSearch(corpus.bm25, '', 5), []);
  assert.deepEqual(keywordSearch(corpus.bm25, 'what is the', 5), []);
  assert.deepEqual(keywordSearch(corpus.bm25, 'helicopter pad', 5), []);
});

test('keyword coverage keeps OOV terms in the denominator and returns null without terms', () => {
  const corpus = corpusOf(['Tickets are sold at the window.', 'The senior fare is 7 dollars with photo identification.']);
  const coverage = keywordCoverage(corpus.bm25, 'senior helicopter', 'The senior fare is 7 dollars.');
  assert.ok(coverage !== null);
  assert.ok(Math.abs(coverage - Math.log(2) / (Math.log(2) + Math.log(6))) < 1e-12);
  assert.equal(keywordCoverage(corpus.bm25, 'the of', 'anything'), null);
});

test('numbers and negations are distinct keyword terms', () => {
  const corpus = corpusOf(['Pets are not allowed on deck.', 'Pets are allowed in crates.', 'The fare is 7 dollars.', 'The fare is 70 dollars.']);
  const negated = keywordSearch(corpus.bm25, 'not allowed', 5);
  assert.equal(negated[0]?.chunkId, corpus.chunks[0]?.id);
  const seven = keywordSearch(corpus.bm25, 'fare 7', 5);
  assert.equal(seven[0]?.chunkId, corpus.chunks[2]?.id);
});

test('vector validation rejects wrong dimension, non-finite, zero and unnormalized vectors', () => {
  const reject = (vector: number[]): void => assert.throws(
    () => validateVector(vector, 2, 'test'),
    (error: unknown) => error instanceof ActionableError && error.code === 'vector-invalid',
  );
  reject([1]);
  reject([Number.NaN, 0]);
  reject([0, 0]);
  reject([1, 1]);
  validateVector([0.6, 0.8], 2, 'ok');
  assert.ok(Math.abs(dot([0.6, 0.8], [0.6, 0.8]) - 1) < 1e-12);
});

test('dense search rejects misaligned vectors and ranks by cosine with codepoint ties', () => {
  assert.throws(
    () => denseSearch(['a'], [], [1, 0], 3),
    (error: unknown) => error instanceof ActionableError && error.code === 'vector-mismatch',
  );
  const hits = denseSearch(['b', 'a', 'c'], [[1, 0], [1, 0], [0, 1]], [1, 0], 3);
  assert.deepEqual(hits.map((hit) => hit.chunkId), ['a', 'b', 'c']);
});

test('RRF deduplicates within a list, merges across lists and breaks ties by id', () => {
  const fused = reciprocalRankFusion([['a', 'a', 'b'], ['b']], 60);
  assert.equal(fused[0]?.id, 'b');
  assert.ok(Math.abs((fused[0]?.score ?? 0) - (1 / 62 + 1 / 61)) < 1e-12);
  assert.ok(Math.abs((fused[1]?.score ?? 0) - 1 / 61) < 1e-12);
  assert.deepEqual(fused[0]?.inputRanks, [2, 1]);
  const tie = reciprocalRankFusion([['b'], ['a']], 60);
  assert.deepEqual(tie.map((entry) => entry.id), ['a', 'b']);
});

test('hybrid keeps component provenance and returns at most five hits', () => {
  const corpus = corpusOf(['Senior fare details.', 'Bicycle rack fee.', 'Fog hold rules.', 'Crane limit.', 'Life jackets.', 'Pier schedule.']);
  const keyword = keywordCandidates(corpus, 'senior fare bicycle');
  const vectors = corpus.chunks.map((_, index) => (index === 2 ? [1, 0] : [0, 1]));
  const dense = denseCandidates(corpus, vectors, [1, 0]);
  const fused = fuseHits(corpus, keyword, dense);
  assert.ok(fused.length <= 5);
  const fog = fused.find((hit) => hit.chunkId === corpus.chunks[2]?.id);
  assert.ok(fog && fog.via.dense && fog.dense?.rank === 1);
  const senior = fused.find((hit) => hit.chunkId === corpus.chunks[0]?.id);
  assert.ok(senior && senior.via.keyword && senior.keyword !== null && senior.dense !== null);
  assert.ok(fused.every((hit, index) => hit.rank === index + 1 && hit.fused?.rank === index + 1));
  const plain = keywordHits(corpus, keyword);
  assert.ok(plain.every((hit) => hit.dense === null && hit.fused === null && hit.corpusRevision === corpus.revision));
});
