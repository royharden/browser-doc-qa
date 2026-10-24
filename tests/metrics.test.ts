import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceUnit } from '../src/domain.ts';
import { balancedAccuracy, nearestRank, recallAt, reciprocalRankAt, unitCovered, type RetrievedSpan } from '../src/lib/metrics.ts';

const unit = (unitId: string, start: number, end: number, pageNumber = 1): EvidenceUnit => ({
  unitId, sourceHash: 'h', pageNumber, start, end, quote: 'x'.repeat(end - start),
});
const span = (start: number, end: number, pageNumber = 1): RetrievedSpan => ({ sourceHash: 'h', pageNumber, start, end });

test('recall is fractional over unique units and never exceeds 1 (PLAN example)', () => {
  const units = [unit('A', 10, 20), unit('B', 100, 120)];
  const retrieved = [span(0, 50), span(5, 40), span(90, 130)];
  assert.equal(recallAt(units, retrieved, 1), 0.5);
  assert.equal(recallAt(units, retrieved, 3), 1);
});

test('duplicate gold labels count once', () => {
  assert.equal(recallAt([unit('A', 10, 20), unit('A2', 10, 20)], [span(0, 30)], 1), 1);
});

test('two chunks can complete a cross-boundary unit; a gap or partial coverage fails', () => {
  const crossing = unit('A', 80, 120);
  assert.equal(unitCovered(crossing, [span(0, 100), span(100, 200)], 2), true);
  assert.equal(unitCovered(crossing, [span(0, 100)], 1), false);
  assert.equal(unitCovered(crossing, [span(0, 99), span(100, 200)], 2), false);
  assert.equal(unitCovered(crossing, [span(0, 100), span(100, 200, 2)], 2), false, 'other page never counts');
});

test('MRR@5 uses the earliest prefix that completes any unit', () => {
  const crossing = unit('A', 80, 120);
  assert.equal(reciprocalRankAt([crossing], [span(0, 100), span(300, 400), span(100, 200)]), 1 / 3);
  assert.equal(reciprocalRankAt([crossing], [span(500, 600)]), 0);
  const six = [span(500, 501), span(502, 503), span(504, 505), span(506, 507), span(508, 509), span(0, 200)];
  assert.equal(reciprocalRankAt([crossing], six), 0, 'rank 6 is outside MRR@5');
});

test('nearest-rank percentiles use ceil(p*n) and reject bad durations', () => {
  assert.equal(nearestRank([5, 1, 3], 0.5), 3);
  assert.equal(nearestRank([5, 1, 3], 0.95), 5);
  assert.equal(nearestRank([], 0.5), null);
  assert.throws(() => nearestRank([1, -1], 0.5));
  assert.throws(() => nearestRank([1, Number.POSITIVE_INFINITY], 0.5));
});

test('balanced accuracy averages positive acceptance and negative rejection', () => {
  assert.equal(balancedAccuracy(6, 6, 3, 6), 0.75);
});
