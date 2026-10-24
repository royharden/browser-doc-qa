import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_NEGATIVE_QUESTION, DEMO_QUESTION, QUOTE_WEEKDAY, harborDocument } from '../src/data/harborLine.ts';
import { DEFAULT_POLICY } from '../src/lib/config.ts';
import { collectCandidates } from '../src/lib/answer.ts';
import { runArm, validateQuestion, type DenseContext } from '../src/lib/ask.ts';
import { ActionableError } from '../src/lib/errors.ts';
import { buildCorpus, makeDocument } from '../src/session.ts';

// Test-oracle clock and dense context: contract tests only, never wired into the product.
let tick = 0;
const clock = { now: () => (tick += 1) };
const signal = new AbortController().signal;
const tutorial = () => buildCorpus(harborDocument(), clock.now);

const base = { denseUnavailableReason: 'no model', policy: DEFAULT_POLICY, clock, signal };

test('keyword journey: weekday question answers with the exact sentence and an exact citation', async () => {
  const corpus = tutorial();
  const run = await runArm({ ...base, arm: 'keyword', corpus, dense: null, query: DEMO_QUESTION });
  assert.equal(run.status, 'ok');
  assert.equal(run.answer?.status, 'answered');
  const excerpt = run.answer?.excerpts[0];
  assert.ok(excerpt);
  assert.equal(excerpt.quote, QUOTE_WEEKDAY);
  assert.equal(excerpt.alias, 1);
  const page = corpus.pageByNumber.get(excerpt.citation.pageNumber);
  assert.equal(page?.canonicalText.slice(excerpt.citation.start, excerpt.citation.end), QUOTE_WEEKDAY);
  assert.equal(excerpt.citation.revision, corpus.revision);
  assert.ok((run.answer?.excerpts.length ?? 0) <= 2);
  assert.ok(Object.isFrozen(excerpt.citation), 'citation identities are immutable');
  assert.ok(run.retrievalSumMs !== null && run.retrievalSumMs === run.stageMs['search-keyword']);
});

test('keyword journey: the negative question abstains instead of inventing an answer', async () => {
  const run = await runArm({ ...base, arm: 'keyword', corpus: tutorial(), dense: null, query: DEMO_NEGATIVE_QUESTION });
  assert.equal(run.status, 'ok');
  assert.equal(run.answer?.status, 'abstained');
  assert.deepEqual(run.answer?.excerpts, []);
});

test('all-stopword questions produce no retrieval answer and over-long questions are rejected', async () => {
  const run = await runArm({ ...base, arm: 'keyword', corpus: tutorial(), dense: null, query: 'what is the' });
  assert.equal(run.answer?.status, 'no-query-terms');
  assert.throws(() => validateQuestion('x'.repeat(1001)), (error: unknown) => error instanceof ActionableError && error.code === 'question-too-long');
  assert.throws(() => validateQuestion('   '), (error: unknown) => error instanceof ActionableError && error.code === 'empty-question');
});

test('dense and hybrid are unavailable without a real index; never answered from keyword', async () => {
  const corpus = tutorial();
  for (const arm of ['dense', 'hybrid'] as const) {
    const run = await runArm({ ...base, arm, corpus, dense: null, query: DEMO_QUESTION });
    assert.equal(run.status, 'unavailable');
    assert.equal(run.answer, null);
    assert.deepEqual(run.hits, []);
  }
});

test('a dense index from another revision is refused', async () => {
  const corpus = tutorial();
  const stale: DenseContext = {
    corpusRevision: 'other',
    vectors: [],
    embedQuery: async () => [1],
    sentenceVectors: async () => new Map(),
    executionKind: 'test-oracle',
  };
  const run = await runArm({ ...base, arm: 'dense', corpus, dense: stale, query: DEMO_QUESTION });
  assert.equal(run.status, 'unavailable');
});

test('a sentence-embedding failure keeps retrieval and reports an answer-stage error, not abstention', async () => {
  const corpus = tutorial();
  const oracle: DenseContext = {
    corpusRevision: corpus.revision,
    vectors: corpus.chunks.map((_, index) => (index === 0 ? [1, 0] : [0, 1])),
    embedQuery: async () => [1, 0],
    sentenceVectors: async () => { throw new Error('sentence batch failed'); },
    executionKind: 'test-oracle',
  };
  const run = await runArm({ ...base, arm: 'hybrid', corpus, dense: oracle, query: DEMO_QUESTION });
  assert.equal(run.status, 'ok');
  assert.ok(run.hits.length > 0);
  assert.equal(run.answer?.status, 'error');
  assert.equal(run.answer?.stageError?.stage, 'answer-embed');
  const sum = ['search-keyword', 'embed-query', 'search-vector', 'fuse']
    .reduce((total, stage) => total + (run.stageMs[stage as keyof typeof run.stageMs] ?? 0), 0);
  assert.equal(run.retrievalSumMs, sum, 'hybrid is charged for all of its components');
});

test('excerpt candidates are deduplicated by exact span only, so changed numbers survive', () => {
  const document = makeDocument({
    displayName: 'n', sourceType: 'txt', extractionVersion: 't',
    pages: [{ pageNumber: 1, canonicalText: 'The fee is 7 dollars. The fee is 70 dollars. The fee is 7 dollars.' }],
  });
  const corpus = buildCorpus(document, clock.now);
  const hits = [{ chunkId: corpus.chunks[0]?.id ?? '', rank: 1 }];
  const candidates = collectCandidates(corpus, hits as never);
  assert.equal(candidates.length, 3, 'identical text at different spans stays distinct');
  assert.equal(new Set(candidates.map((candidate) => candidate.key)).size, 3);
});
