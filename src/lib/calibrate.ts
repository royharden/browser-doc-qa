import type { GatePolicy, LabelledQuestion } from '../domain.ts';
import { isNegativeKind } from '../domain.ts';
import { CALIBRATION_GRID, DEFAULT_POLICY } from './config.ts';
import { balancedAccuracy } from './metrics.ts';

/**
 * Gate calibration (PLAN.md section 5). Uses ONLY the 12-question calibration split. Keyword and dense
 * thresholds are swept separately on {0, 0.05, ..., 1}. A question is accepted at threshold t when its
 * best ungated candidate score is >= t (no candidate = refused). Selection: highest balanced accuracy,
 * then fewer false accepts, then the higher threshold. The chosen policy is frozen before evaluation.
 * A failed or incomplete calibration keeps the explicitly uncalibrated defaults.
 */

export interface CalibrationObservation {
  questionId: string;
  positive: boolean;
  /** Best candidate score for this arm, or null when the arm produced no candidate. */
  score: number | null;
  /** False when the run errored/was unavailable for this question. */
  ok: boolean;
}

export interface SweepRow {
  threshold: number;
  positivesAccepted: number;
  positivesRefused: number;
  negativesAccepted: number;
  negativesRefused: number;
  balancedAccuracy: number;
}

export interface ArmCalibration {
  arm: 'keyword' | 'dense';
  status: 'calibrated' | 'incomplete' | 'unavailable';
  reason: string | null;
  sweep: SweepRow[];
  chosen: SweepRow | null;
}

export interface CalibrationResult {
  runId: string;
  createdAt: string;
  fixtureId: string;
  fixtureVersion: string;
  questionIds: string[];
  keyword: ArmCalibration;
  dense: ArmCalibration;
  /** Hybrid accept/refuse counts under the chosen component gates (descriptive). */
  hybrid: { positivesAccepted: number; negativesAccepted: number; positives: number; negatives: number; complete: boolean } | null;
  policy: GatePolicy;
}

export function sweep(observations: readonly CalibrationObservation[], grid: readonly number[] = CALIBRATION_GRID): SweepRow[] {
  const positives = observations.filter((item) => item.positive);
  const negatives = observations.filter((item) => !item.positive);
  return grid.map((threshold) => {
    const accepted = (item: CalibrationObservation): boolean => item.score !== null && item.score >= threshold;
    const positivesAccepted = positives.filter(accepted).length;
    const negativesAccepted = negatives.filter(accepted).length;
    return {
      threshold,
      positivesAccepted,
      positivesRefused: positives.length - positivesAccepted,
      negativesAccepted,
      negativesRefused: negatives.length - negativesAccepted,
      balancedAccuracy: balancedAccuracy(positivesAccepted, positives.length, negatives.length - negativesAccepted, negatives.length),
    };
  });
}

/** Highest balanced accuracy, then fewer false accepts, then higher threshold. */
export function choose(rows: readonly SweepRow[]): SweepRow | null {
  let best: SweepRow | null = null;
  for (const row of rows) {
    if (!best
      || row.balancedAccuracy > best.balancedAccuracy
      || (row.balancedAccuracy === best.balancedAccuracy && row.negativesAccepted < best.negativesAccepted)
      || (row.balancedAccuracy === best.balancedAccuracy && row.negativesAccepted === best.negativesAccepted && row.threshold > best.threshold)) {
      best = row;
    }
  }
  return best;
}

export function calibrateArm(arm: 'keyword' | 'dense', questions: readonly LabelledQuestion[], observations: readonly CalibrationObservation[] | null, unavailableReason: string | null): ArmCalibration {
  if (!observations) return { arm, status: 'unavailable', reason: unavailableReason ?? 'Arm unavailable.', sweep: [], chosen: null };
  const expected = new Set(questions.map((question) => question.id));
  const complete = observations.length === questions.length
    && observations.every((item) => item.ok && expected.has(item.questionId))
    && new Set(observations.map((item) => item.questionId)).size === questions.length;
  if (!complete) {
    return { arm, status: 'incomplete', reason: 'Some calibration questions failed or are missing; the uncalibrated default is kept.', sweep: [], chosen: null };
  }
  const rows = sweep(observations);
  return { arm, status: 'calibrated', reason: null, sweep: rows, chosen: choose(rows) };
}

export function observation(question: LabelledQuestion, score: number | null, ok: boolean): CalibrationObservation {
  return { questionId: question.id, positive: !isNegativeKind(question.kind), score, ok };
}

/** Combines per-arm results into one frozen policy; any uncalibrated arm keeps its default threshold. */
export function policyFrom(keyword: ArmCalibration, dense: ArmCalibration, runId: string): GatePolicy {
  const keywordOk = keyword.status === 'calibrated' && keyword.chosen !== null;
  const denseOk = dense.status === 'calibrated' && dense.chosen !== null;
  if (!keywordOk && !denseOk) return DEFAULT_POLICY;
  return Object.freeze({
    keywordMinCoverage: keywordOk && keyword.chosen ? keyword.chosen.threshold : DEFAULT_POLICY.keywordMinCoverage,
    denseMinCosine: denseOk && dense.chosen ? dense.chosen.threshold : DEFAULT_POLICY.denseMinCosine,
    source: keywordOk && denseOk ? 'calibrated' : 'partially-calibrated',
    calibratedGates: [...(keywordOk ? ['keyword' as const] : []), ...(denseOk ? ['dense' as const] : [])],
    calibrationRunId: runId,
  });
}
