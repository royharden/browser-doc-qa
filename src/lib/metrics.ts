import type { EvidenceUnit } from '../domain.ts';
import { MRR_DEPTH } from './config.ts';

/** A retrieved chunk's location, in rank order. */
export interface RetrievedSpan {
  sourceHash: string;
  pageNumber: number;
  start: number;
  end: number;
}

/**
 * A unit is covered at k when the union of retrieved same-source, same-page chunk intervals among the
 * first k fully covers its span (PLAN.md section 6). Duplicates/overlaps count once; any gap fails.
 */
export function unitCovered(unit: EvidenceUnit, retrieved: readonly RetrievedSpan[], k: number): boolean {
  const intervals = retrieved
    .slice(0, Math.max(0, k))
    .filter((span) => span.sourceHash === unit.sourceHash && span.pageNumber === unit.pageNumber)
    .map((span) => ({ start: span.start, end: span.end }))
    .sort((left, right) => left.start - right.start);
  let reach = unit.start;
  for (const interval of intervals) {
    if (interval.start > reach) break;
    if (interval.end > reach) reach = interval.end;
    if (reach >= unit.end) return true;
  }
  return reach >= unit.end;
}

/** Unique units: identical (source, page, start, end) labels are counted once. */
export function uniqueUnits(units: readonly EvidenceUnit[]): EvidenceUnit[] {
  const seen = new Set<string>();
  const unique: EvidenceUnit[] = [];
  for (const unit of units) {
    const key = `${unit.sourceHash}|${unit.pageNumber}|${unit.start}|${unit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(unit);
  }
  return unique;
}

/** recall@k for one answerable question = covered unique units / all unique gold units. */
export function recallAt(units: readonly EvidenceUnit[], retrieved: readonly RetrievedSpan[], k: number): number {
  const unique = uniqueUnits(units);
  if (unique.length === 0) throw new Error('recall@k is undefined for a question without evidence units.');
  return unique.filter((unit) => unitCovered(unit, retrieved, k)).length / unique.length;
}

/** Covered unit ids at each k (for per-query inspection). */
export function coveredUnitIds(units: readonly EvidenceUnit[], retrieved: readonly RetrievedSpan[], k: number): string[] {
  return uniqueUnits(units).filter((unit) => unitCovered(unit, retrieved, k)).map((unit) => unit.unitId);
}

/**
 * Reciprocal of the earliest prefix rank (1..depth) at which ANY complete gold unit becomes covered by
 * the prefix union, else 0. Measures first evidence, not complete multi-evidence reasoning.
 */
export function reciprocalRankAt(units: readonly EvidenceUnit[], retrieved: readonly RetrievedSpan[], depth = MRR_DEPTH): number {
  const unique = uniqueUnits(units);
  if (unique.length === 0) throw new Error('MRR is undefined for a question without evidence units.');
  for (let rank = 1; rank <= Math.min(depth, retrieved.length); rank += 1) {
    if (unique.some((unit) => unitCovered(unit, retrieved, rank))) return 1 / rank;
  }
  return 0;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface PercentileSummary {
  n: number;
  p50: number | null;
  p95: number | null;
}

/**
 * Nearest-rank percentile on success samples: sorted, one-based index ceil(p * n).
 * Negative or non-finite durations are rejected, never replaced with zero.
 */
export function nearestRank(samples: readonly number[], p: number): number | null {
  assertDurations(samples);
  if (samples.length === 0) return null;
  if (!(p > 0 && p <= 1)) throw new Error('Percentile must be in (0, 1].');
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(p * sorted.length);
  return sorted[index - 1] ?? null;
}

export function percentiles(samples: readonly number[]): PercentileSummary {
  return { n: samples.length, p50: nearestRank(samples, 0.5), p95: nearestRank(samples, 0.95) };
}

export function assertDurations(samples: readonly number[]): void {
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < 0) throw new Error(`Invalid duration sample: ${String(sample)}.`);
  }
}

/** Balanced accuracy = mean(positive-accept rate, negative-reject rate). */
export function balancedAccuracy(positivesAccepted: number, positives: number, negativesRejected: number, negatives: number): number {
  if (positives <= 0 || negatives <= 0) throw new Error('Balanced accuracy needs positives and negatives.');
  return (positivesAccepted / positives + negativesRejected / negatives) / 2;
}
