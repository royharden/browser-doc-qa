import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluationFixture } from '../src/data/evaluation/index.ts';
import { harborDocument } from '../src/data/harborLine.ts';
import type { DenseContext } from '../src/lib/ask.ts';
import { calibrateArm, choose, observation, policyFrom, sweep } from '../src/lib/calibrate.ts';
import { DEFAULT_POLICY } from '../src/lib/config.ts';
import { ActionableError } from '../src/lib/errors.ts';
import { runBenchmark, runCalibration, summarizeArm, type ProtocolInput } from '../src/lib/protocol.ts';
import { exportReportJson, isMeasurementReport, productionComparable, reportProblems } from '../src/lib/reportValidate.ts';
import { buildCorpus } from '../src/session.ts';

let tick = 0;
const clock = { now: () => (tick += 0.5) };
const environment = { userAgent: null, hardwareConcurrency: null, deviceMemoryGb: null, webgpuApiPresent: null, crossOriginIsolated: null, language: null };

function input(overrides: Partial<ProtocolInput> = {}): ProtocolInput {
  const fixture = evaluationFixture();
  return {
    fixture,
    corpus: buildCorpus(fixture.document, clock.now),
    dense: null,
    denseUnavailableReason: 'Model not loaded.',
    model: null,
    policy: DEFAULT_POLICY,
    calibration: null,
    clock,
    signal: new AbortController().signal,
    environment,
    wasmThreads: null,
    sourceRevision: 'test',
    runId: 'run-test',
    createdAt: '2026-10-23T00:00:00.000Z',
    setup: [],
    ...overrides,
  };
}

test('sweep and selection follow balanced accuracy, then fewer false accepts, then higher threshold', () => {
  const questions = evaluationFixture().calibration;
  const scores: Record<string, number | null> = {};
  questions.forEach((question, index) => { scores[question.id] = question.evidenceUnits.length > 0 ? 0.9 : index % 2 === 0 ? 0.3 : null; });
  const rows = sweep(questions.map((question) => observation(question, scores[question.id] ?? null, true)));
  assert.equal(rows.length, 21);
  const chosen = choose(rows);
  assert.ok(chosen);
  assert.equal(chosen.balancedAccuracy, 1);
  assert.equal(chosen.threshold, 0.9, 'ties at BA=1 resolve to the highest threshold');
});

test('incomplete calibration keeps the uncalibrated defaults', () => {
  const questions = evaluationFixture().calibration;
  const partial = questions.slice(1).map((question) => observation(question, 0.5, true));
  const keyword = calibrateArm('keyword', questions, partial, null);
  assert.equal(keyword.status, 'incomplete');
  const dense = calibrateArm('dense', questions, null, 'no model');
  assert.equal(policyFrom(keyword, dense, 'r'), DEFAULT_POLICY);
});

test('keyword-only benchmark: complete keyword arm, N/A dense/hybrid, fixed denominators, valid v3 report', async () => {
  const report = await runBenchmark(input());
  assert.equal(report.rows.length, 4 * 24 * 3);
  assert.deepEqual(report.protocol.passIds, ['warmup-1', 'pass-1', 'pass-2', 'pass-3']);
  const [keyword, dense, hybrid] = report.arms;
  assert.equal(keyword?.state, 'complete');
  assert.equal(keyword?.answerableDenominator, 18);
  assert.equal(keyword?.negativeDenominator, 6);
  assert.equal(keyword?.coverage.expected, 72);
  assert.ok(keyword?.aggregate && keyword.aggregate.recall['5'] !== undefined);
  assert.equal(dense?.state, 'unavailable');
  assert.equal(dense?.aggregate, null);
  assert.equal(hybrid?.state, 'unavailable');
  assert.equal(keyword?.latency.warmupExcluded, 24);
  assert.equal(keyword?.latency.retrievalSum.n, 72);
  assert.deepEqual(reportProblems(report), []);
  assert.ok(isMeasurementReport(report));
  assert.ok(exportReportJson(report).includes('browser-doc-qa.measurement.v3'));
});

test('cancellation keeps completed rows, marks the rest cancelled and suppresses aggregates', async () => {
  const controller = new AbortController();
  let rows = 0;
  const report = await runBenchmark(input({
    signal: controller.signal,
    onProgress: (done) => { rows = done; if (done === 40) controller.abort(); },
  }));
  assert.equal(report.status, 'cancelled');
  assert.equal(report.rows.length, 288, 'every expected row is still recorded');
  assert.ok(rows === 288);
  assert.ok(report.rows.slice(0, 40).some((row) => row.status === 'ok'));
  assert.ok(report.rows.slice(41).every((row) => row.status === 'cancelled'));
  assert.equal(report.arms[0]?.state, 'partial');
  assert.equal(report.arms[0]?.aggregate, null);
});

test('measurements refuse a non-fixture corpus', async () => {
  const fixture = evaluationFixture();
  await assert.rejects(runBenchmark(input({ corpus: buildCorpus(harborDocument(), clock.now), fixture })),
    (error: unknown) => error instanceof ActionableError && error.code === 'wrong-corpus');
});

test('test-oracle dense rows are flagged as not production-comparable', async () => {
  const base = input();
  const oracle: DenseContext = {
    corpusRevision: base.corpus.revision,
    vectors: base.corpus.chunks.map((_, index) => [index % 2 === 0 ? 1 : 0, index % 2 === 0 ? 0 : 1]),
    embedQuery: async () => [1, 0],
    sentenceVectors: async (candidates) => new Map(candidates.map((candidate) => [candidate.key, [1, 0]])),
    executionKind: 'test-oracle',
  };
  const report = await runBenchmark({ ...base, dense: oracle, warmupPasses: 0, measuredPasses: 1 });
  const denseRow = report.rows.find((row) => row.arm === 'dense');
  assert.ok(denseRow);
  assert.equal(productionComparable(denseRow), false);
  assert.equal(productionComparable(report.rows.find((row) => row.arm === 'keyword') ?? denseRow), true);
});

test('calibration uses only the calibration split', async () => {
  const base = input();
  const result = await runCalibration({ fixture: base.fixture, corpus: base.corpus, dense: null, denseUnavailableReason: 'none', clock, signal: base.signal, runId: 'cal', createdAt: base.createdAt });
  assert.deepEqual(result.questionIds, base.fixture.calibration.map((question) => question.id));
  assert.equal(result.keyword.status, 'calibrated');
  assert.equal(result.dense.status, 'unavailable');
  assert.equal(result.policy.source, 'partially-calibrated');
  assert.deepEqual(result.policy.calibratedGates, ['keyword']);
});

test('the validator rejects old schemas, bad durations and aggregates on partial arms', async () => {
  assert.ok(reportProblems({ schema: 'browser-doc-qa.measurement.v1' })[0]?.includes('Unsupported'));
  const report = await runBenchmark(input({ warmupPasses: 0, measuredPasses: 1 }));
  const first = report.rows[0];
  assert.ok(first);
  const bad = { ...report, rows: [{ ...first, retrievalSumMs: -1 }, ...report.rows.slice(1)] };
  assert.ok(reportProblems(bad).some((problem) => problem.includes('retrievalSumMs')));
  const keyword = report.arms[0];
  assert.ok(keyword && keyword.aggregate);
  const lying = { ...report, arms: [{ ...keyword, state: 'partial' as const }, ...report.arms.slice(1)] };
  assert.ok(reportProblems(lying).some((problem) => problem.includes('aggregates')));
  assert.throws(() => exportReportJson(bad as typeof report));
});

test('summaries never shrink denominators when rows fail', () => {
  const questions = evaluationFixture().evaluation;
  const summary = summarizeArm('keyword', [], questions, ['pass-1'], null);
  assert.equal(summary.coverage.expected, 24);
  assert.equal(summary.state, 'partial');
  assert.equal(summary.aggregate, null);
});

test('a calibrated report carries and validates its calibration evidence; mismatches are rejected', async () => {
  const base = input();
  const calibration = await runCalibration({ fixture: base.fixture, corpus: base.corpus, dense: null, denseUnavailableReason: 'none', clock, signal: base.signal, runId: 'cal-1', createdAt: base.createdAt });
  const report = await runBenchmark({ ...base, policy: calibration.policy, calibration, warmupPasses: 0, measuredPasses: 1 });
  assert.equal(report.calibration?.runId, 'cal-1');
  assert.deepEqual(reportProblems(report), []);
  const missing = { ...report, calibration: null };
  assert.ok(reportProblems(missing).some((problem) => problem.includes('calibration evidence')));
  const mismatched = { ...report, calibration: { ...calibration, runId: 'other' } };
  assert.ok(reportProblems(mismatched).some((problem) => problem.includes('run id')));
  const wrongThreshold = { ...report, policy: { ...calibration.policy, keywordMinCoverage: calibration.policy.keywordMinCoverage === 0 ? 0.05 : 0 } };
  assert.ok(reportProblems(wrongThreshold).some((problem) => problem.includes('chosen threshold')));
});

test('dense rows that never ran carry no model lineage', async () => {
  const report = await runBenchmark(input({ warmupPasses: 0, measuredPasses: 1 }));
  assert.ok(report.rows.filter((row) => row.arm !== 'keyword').every((row) => row.executionKind === 'not-run' && row.status === 'unavailable'));
});
