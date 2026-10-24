import { RRF_K } from './config.ts';

export interface FusedRank {
  id: string;
  score: number;
}

/** Reciprocal rank fusion. Ranks are 1-based. Ties break on id. */
export function reciprocalRankFusion(rankings: string[][], k = RRF_K): FusedRank[] {
  if (!Number.isFinite(k) || k < 0) {
    throw new Error('RRF k must be a non-negative finite number.');
  }
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      const rank = index + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
