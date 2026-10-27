import assert from 'node:assert/strict';
import { evaluationFixture } from '../src/data/evaluation/index.ts';
import { buildCorpus } from '../src/session.ts';
import { isMeasurementReport } from '../src/lib/reportValidate.ts';

// An independent discrete-cell oracle; no imports of product metric/aggregation/calibration helpers.
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function covered(unit, hits, k) {
  for (let cell = unit.start; cell < unit.end; cell += 1) {
    if (!hits.slice(0, k).some((hit) => hit.pageNumber === unit.pageNumber && hit.start <= cell && hit.end > cell)) return false;
  }
  return true;
}

export function verifyRealReport(report, sourceRevision) {
  assert.equal(isMeasurementReport(report), true);
  assert.equal(report.app.sourceRevision, sourceRevision);
  const fixture = evaluationFixture();
  const corpus = buildCorpus(fixture.document, () => 0);
  const questions = [...fixture.evaluation]; // Frozen authored ID order; never tune/reorder after outcomes.
  assert.equal(report.fixture.corpusHash, fixture.document.contentHash);
  assert.equal(report.fixture.corpusRevision, corpus.revision);
  assert.deepEqual(report.fixture.questionIds, questions.map((q) => q.id));
  assert.equal(report.model.backend, 'wasm');
  assert.equal(report.model.executionKind, 'real-browser-model');
  assert.equal(report.model.identity.pooling, 'cls');
  assert.equal(report.model.identity.dtype, 'q8');
  assert.equal(report.model.identity.dimensions, 384);
  assert.equal(report.model.identity.normalized, true);
  assert.equal(report.model.identity.revision, 'ea104dacec62c0de699686887e3f920caeb4f3e3');
  assert.equal(report.model.identity.tokenizerRevision, report.model.identity.revision);
  assert.deepEqual(report.config.bm25, { k1: 1.5, b: 0.75 });
  assert.deepEqual(report.config.rrf, { k: 60, pool: 20, topK: 5 });
  assert.equal(report.policy.source, 'calibrated');
  assert.equal(report.protocol.warmupPasses, 1);
  assert.equal(report.protocol.measuredPasses, 3);
  assert.equal(report.rows.length, 288);
  assert.equal(report.calibration.questionIds.length, 12);
  assert.equal(report.calibration.questionIds.some((id) => report.fixture.questionIds.includes(id)), false);

  for (const gate of ['keyword', 'dense']) {
    const calibration = report.calibration[gate];
    assert.equal(calibration.status, 'calibrated');
    assert.equal(calibration.sweep.length, 21);
    calibration.sweep.forEach((row, i) => {
      near(row.threshold, i / 20);
      assert.equal(row.positivesAccepted + row.positivesRefused, 6);
      assert.equal(row.negativesAccepted + row.negativesRefused, 6);
      near(row.balancedAccuracy, (row.positivesAccepted / 6 + row.negativesRefused / 6) / 2);
    });
    const ordered = [...calibration.sweep].sort((a, b) => b.balancedAccuracy - a.balancedAccuracy
      || a.negativesAccepted - b.negativesAccepted || b.threshold - a.threshold);
    assert.deepEqual(calibration.chosen, ordered[0]);
  }
  assert.equal(report.policy.keywordMinCoverage, report.calibration.keyword.chosen.threshold);
  assert.equal(report.policy.denseMinCosine, report.calibration.dense.chosen.threshold);
  const quality = [];
  let index = 0;
  for (const pass of report.protocol.passIds) {
    for (const question of questions) {
      for (const arm of ['keyword', 'dense', 'hybrid']) {
        const row = report.rows[index++];
        assert.equal(row.passId, pass);
        assert.equal(row.questionId, question.id);
        assert.equal(row.arm, arm);
        assert.equal(row.status, 'ok');
        assert.equal(row.executionKind, arm === 'keyword' ? 'real-browser-lexical' : 'real-browser-model');
        assert.ok(row.hits.length <= 5);
        for (const hit of row.hits) {
          const chunk = corpus.chunkById.get(hit.chunkId);
          assert.ok(chunk);
          assert.equal(hit.pageNumber, chunk.pageNumber);
          assert.equal(hit.start, chunk.start);
          assert.equal(hit.end, chunk.end);
        }
        const stages = arm === 'keyword' ? ['search-keyword'] : arm === 'dense'
          ? ['embed-query', 'search-vector'] : ['search-keyword', 'embed-query', 'search-vector', 'fuse'];
        near(row.retrievalSumMs, stages.reduce((sum, key) => sum + row.stageMs[key], 0));
        for (const value of Object.values(row.stageMs)) assert.ok(Number.isFinite(value) && value >= 0);
        if (question.evidenceUnits.length) {
          for (const k of [1, 3, 5]) {
            const units = question.evidenceUnits.filter((unit) => covered(unit, row.hits, k));
            near(row.recall[String(k)], units.length / question.evidenceUnits.length);
            assert.deepEqual([...row.coveredUnitIds[String(k)]].sort(), units.map((u) => u.unitId).sort());
          }
          const first = [1, 2, 3, 4, 5].find((k) => question.evidenceUnits.some((unit) => covered(unit, row.hits, k)));
          near(row.reciprocalRank, first ? 1 / first : 0);
        } else assert.equal(row.recall, null);
      }
    }
  }
  for (const arm of report.arms) {
    assert.equal(arm.state, 'complete');
    assert.equal(arm.coverage.ok, 72);
    assert.equal(arm.answerableDenominator, 18);
    assert.equal(arm.negativeDenominator, 6);
    const rows = report.rows.filter((row) => !row.warmup && row.arm === arm.arm && row.recall !== null);
    for (const k of ['1', '3', '5']) near(arm.aggregate.recall[k], rows.reduce((sum, row) => sum + row.recall[k], 0) / 54);
    near(arm.aggregate.mrr, rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / 54);
    const measured = report.rows.filter((row) => !row.warmup && row.arm === arm.arm);
    const negativeIds = new Set(questions.filter((q) => !q.evidenceUnits.length).map((q) => q.id));
    const refused = (row) => ['abstained', 'no-query-terms'].includes(row.answer.status);
    near(arm.aggregate.correctAbstentions, measured.filter((r) => negativeIds.has(r.questionId) && refused(r)).length / 3);
    near(arm.aggregate.falseAccepts, measured.filter((r) => negativeIds.has(r.questionId) && r.answer.status === 'answered').length / 3);
    near(arm.aggregate.falseAbstentions, measured.filter((r) => !negativeIds.has(r.questionId) && refused(r)).length / 3);
    const samples = measured.map((row) => row.retrievalSumMs);
    assert.deepEqual(arm.latency.retrievalSum.samples, samples);
    const ordered = [...samples].sort((a, b) => a - b);
    assert.equal(arm.latency.retrievalSum.n, 72);
    near(arm.latency.retrievalSum.p50, ordered[Math.ceil(0.5 * 72) - 1]);
    near(arm.latency.retrievalSum.p95, ordered[Math.ceil(0.95 * 72) - 1]);
    assert.equal(arm.latency.warmupExcluded, 24);
    quality.push({ arm: arm.arm, aggregate: arm.aggregate, coverage: arm.coverage });
  }
  return { quality, rows: report.rows.length, measured: report.rows.filter((r) => !r.warmup).length,
    calibrationRunId: report.calibration.runId, policy: report.policy };
}
