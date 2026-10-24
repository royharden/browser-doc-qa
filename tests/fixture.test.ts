import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluationFixture } from '../src/data/evaluation/index.ts';
import { harborDocument, harborQuestions } from '../src/data/harborLine.ts';
import { FIXTURE_MIN_CHUNKS, fixtureProblems, unitProblems } from '../src/lib/fixture.ts';
import { buildCorpus } from '../src/session.ts';

const clock = (): number => 0;

test('the frozen evaluation fixture is valid against its built corpus', () => {
  const fixture = evaluationFixture();
  const corpus = buildCorpus(fixture.document, clock);
  assert.deepEqual(fixtureProblems(fixture, corpus), []);
  assert.ok(corpus.chunks.length >= FIXTURE_MIN_CHUNKS);
  assert.equal(fixture.calibration.length, 12);
  assert.equal(fixture.evaluation.length, 24);
  assert.equal(fixture.evaluation.filter((question) => question.evidenceUnits.length > 0).length, 18);
});

test('a tampered quote or hash invalidates the fixture instead of becoming a miss', () => {
  const fixture = evaluationFixture();
  const corpus = buildCorpus(fixture.document, clock);
  const [first, ...rest] = fixture.evaluation;
  assert.ok(first && first.evidenceUnits[0]);
  const tampered = {
    ...fixture,
    evaluation: [{ ...first, evidenceUnits: [{ ...first.evidenceUnits[0], quote: `${first.evidenceUnits[0].quote} ` }] }, ...rest],
  };
  assert.ok(fixtureProblems(tampered, corpus).some((problem) => problem.includes('canonical slice')));
  const wrongHash = { ...first, evidenceUnits: [{ ...first.evidenceUnits[0], sourceHash: 'fnv64:0' }] };
  assert.ok(unitProblems(wrongHash, corpus).some((problem) => problem.includes('source hash')));
});

test('calibration and evaluation splits are disjoint', () => {
  const fixture = evaluationFixture();
  const calibration = new Set(fixture.calibration.map((question) => question.id));
  assert.ok(fixture.evaluation.every((question) => !calibration.has(question.id)));
});

test('the tutorial questions map to exact Harbor Line spans', () => {
  const corpus = buildCorpus(harborDocument(), clock);
  for (const question of harborQuestions()) assert.deepEqual(unitProblems(question, corpus), []);
});
