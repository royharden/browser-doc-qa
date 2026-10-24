import { RRF_K } from './config.ts';
import { compareCodepoints } from './hash.ts';

export interface FusedRank {
  id: string;
  score: number;
  /** One-based rank in each input list, or null when absent. */
  inputRanks: (number | null)[];
}

/**
 * Plain reciprocal rank fusion: score = sum over lists of 1 / (k + rank), ranks start at 1.
 * Duplicate ids within one list count once (first occurrence). Ties break on id codepoints.
 * No pruning threshold (PLAN.md section 4).
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[], k = RRF_K): FusedRank[] {
  if (!Number.isFinite(k) || k < 0) throw new Error('RRF k must be a non-negative finite number.');
  const fused = new Map<string, FusedRank>();
  rankings.forEach((ranking, listIndex) => {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of ranking) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      let entry = fused.get(id);
      if (!entry) {
        entry = { id, score: 0, inputRanks: rankings.map(() => null) };
        fused.set(id, entry);
      }
      entry.score += 1 / (k + rank);
      entry.inputRanks[listIndex] = rank;
    }
  });
  return [...fused.values()].sort((left, right) => right.score - left.score || compareCodepoints(left.id, right.id));
}
