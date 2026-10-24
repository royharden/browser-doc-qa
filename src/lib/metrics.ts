export interface PercentileSummary {
  n: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

/**
 * Nearest-rank percentiles. Rank = ceil(p/100 * n), then clamped into the sorted sample.
 * A single sample makes p50, p95, and p99 equal that sample.
 */
export function nearestRankPercentiles(samples: number[]): PercentileSummary {
  if (samples.length === 0) return { n: 0, p50Ms: null, p95Ms: null, p99Ms: null };
  const sorted = [...samples].sort((left, right) => left - right);
  const pick = (percentile: number): number | null => {
    const rank = Math.ceil((percentile / 100) * sorted.length);
    const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
    return sorted[index] ?? null;
  };
  return { n: sorted.length, p50Ms: pick(50), p95Ms: pick(95), p99Ms: pick(99) };
}

export function recallAtK(firstRanks: Array<number | null>, k: number): number {
  if (firstRanks.length === 0) return 0;
  let hits = 0;
  for (const rank of firstRanks) {
    if (rank !== null && rank <= k) hits += 1;
  }
  return hits / firstRanks.length;
}

export function meanReciprocalRank(firstRanks: Array<number | null>): number {
  if (firstRanks.length === 0) return 0;
  let sum = 0;
  for (const rank of firstRanks) {
    if (rank !== null && rank > 0) sum += 1 / rank;
  }
  return sum / firstRanks.length;
}
