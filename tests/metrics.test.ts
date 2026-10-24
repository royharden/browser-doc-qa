import assert from 'node:assert/strict';
import test from 'node:test';
import { meanReciprocalRank, nearestRankPercentiles, recallAtK } from '../src/lib/metrics.ts';

test('nearest-rank percentiles', () => {
  const summary = nearestRankPercentiles([40, 10, 30, 20]);
  assert.equal(summary.n, 4);
  assert.equal(summary.p50Ms, 20);
  assert.equal(summary.p95Ms, 40);
  assert.equal(summary.p99Ms, 40);
  assert.deepEqual(nearestRankPercentiles([]), { n: 0, p50Ms: null, p95Ms: null, p99Ms: null });
  assert.equal(nearestRankPercentiles([7]).p50Ms, 7);
});

test('recall and MRR ignore misses', () => {
  const ranks = [1, 3, null];
  assert.equal(recallAtK(ranks, 1), 1 / 3);
  assert.equal(recallAtK(ranks, 3), 2 / 3);
  assert.equal(meanReciprocalRank(ranks), (1 + 1 / 3) / 3);
});
