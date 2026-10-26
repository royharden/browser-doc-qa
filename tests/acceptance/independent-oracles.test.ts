import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceUnit } from '../../src/domain.ts';
import { recallAt, reciprocalRankAt, type RetrievedSpan } from '../../src/lib/metrics.ts';
import { keywordSearch, keywordCoverage } from '../../src/lib/bm25.ts';
import { buildCorpus, makeDocument } from '../../src/session.ts';

// Independent discrete-cell oracle: deliberately does not sort or merge intervals.
function covered(unit: EvidenceUnit, rows: RetrievedSpan[], k: number): boolean {
  for (let cell = unit.start; cell < unit.end; cell += 1) {
    if (!rows.slice(0, k).some((s) => s.sourceHash === unit.sourceHash
      && s.pageNumber === unit.pageNumber && s.start <= cell && s.end > cell)) return false;
  }
  return true;
}

test('RV: evidence metrics agree with a cell oracle across 300 deterministic adversarial cases', () => {
  // Catches gaps, wrong-page/hash leakage, overlapping duplicate credit and wrong prefix MRR.
  let seed = 112026;
  const random = (bound: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % bound;
  };
  for (let trial = 0; trial < 300; trial += 1) {
    const units: EvidenceUnit[] = [0, 1, 2].map((i) => {
      const start = random(12);
      const end = start + 1 + random(6);
      return { unitId: `u${i}`, sourceHash: 'gold', pageNumber: i + 1, start, end, quote: 'x'.repeat(end - start) };
    });
    const rows: RetrievedSpan[] = Array.from({ length: 7 }, () => {
      const start = random(16);
      return { sourceHash: random(5) ? 'gold' : 'other', pageNumber: 1 + random(3), start, end: start + 1 + random(10) };
    });
    for (const k of [1, 3, 5]) {
      const expected = units.filter((unit) => covered(unit, rows, k)).length / units.length;
      assert.equal(recallAt(units, rows, k), expected, `trial ${trial}, k=${k}`);
    }
    const first = [1, 2, 3, 4, 5].find((k) => units.some((unit) => covered(unit, rows, k)));
    assert.equal(reciprocalRankAt(units, rows), first ? 1 / first : 0, `trial ${trial}`);
  }
});

test('RV: BM25 scores match hand-computed term frequencies and length normalization', () => {
  // Catches ranking tests passing despite an incorrect score formula or duplicate query weighting.
  const document = makeDocument({ displayName: 'synthetic', sourceType: 'txt', extractionVersion: 'rv',
    pages: ['alpha alpha beta', 'beta gamma', 'delta'].map((canonicalText, i) => ({ pageNumber: i + 1, canonicalText })) });
  const corpus = buildCorpus(document, () => 0);
  const hits = keywordSearch(corpus.bm25, 'alpha alpha beta', 5);
  const alphaIdf = Math.log(1 + 2.5 / 1.5);
  const betaIdf = Math.log(1 + 1.5 / 2.5);
  const norm = (tf: number, length: number): number => tf * 2.5 / (tf + 1.5 * (0.25 + 0.75 * length / 2));
  assert.equal(hits.length, 2);
  assert.ok(Math.abs(hits[0]!.score - (alphaIdf * norm(2, 3) + betaIdf * norm(1, 3))) < 1e-12);
  assert.ok(Math.abs(hits[1]!.score - betaIdf * norm(1, 2)) < 1e-12);
  const oovIdf = Math.log(1 + 3.5 / 0.5);
  assert.ok(Math.abs(keywordCoverage(corpus.bm25, 'alpha unknown', 'alpha')! - alphaIdf / (alphaIdf + oovIdf)) < 1e-12);
});
