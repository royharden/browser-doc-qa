import { ARMS, type ArmId } from '../domain.ts';
import type { MeasurementReport, QueryRow, SampleSummary } from '../report.ts';
import { RECALL_KS, REPORT_SCHEMA } from './config.ts';

/**
 * Full-shape validation for browser-doc-qa.measurement.v3 (PLAN.md section 8), applied at persistence,
 * read and export. The schema string alone is insufficient: enums, references, counts/bounds and
 * finite numbers are checked. Old/incomplete versions are rejected (no silent migration).
 */
export function reportProblems(value: unknown): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => { problems.push(message); };
  if (!isObject(value)) return ['Report is not an object.'];
  if (value.schema !== REPORT_SCHEMA) return [`Unsupported report schema ${String(value.schema)}; only ${REPORT_SCHEMA} is accepted.`];
  for (const key of ['runId', 'createdAt'] as const) if (typeof value[key] !== 'string') fail(`${key} must be a string.`);
  if (!['complete', 'cancelled', 'failed'].includes(value.status as string)) fail('Invalid status.');

  const fixture = value.fixture;
  if (!isObject(fixture) || !Array.isArray(fixture.questionIds) || !fixture.questionIds.every((id) => typeof id === 'string')) {
    fail('fixture.questionIds missing.');
    return problems;
  }
  if (typeof fixture.corpusHash !== 'string' || typeof fixture.corpusRevision !== 'string') fail('fixture identity missing.');
  if (!finiteInt(fixture.chunkCount) || (fixture.chunkCount as number) < 1) fail('fixture.chunkCount invalid.');
  const questionIds = new Set(fixture.questionIds as string[]);

  const protocol = value.protocol;
  if (!isObject(protocol) || !Array.isArray(protocol.passIds) || !Array.isArray(protocol.armOrder)) {
    fail('protocol missing.');
    return problems;
  }
  const passIds = protocol.passIds as unknown[];
  if (!passIds.every((id) => typeof id === 'string')) fail('protocol.passIds invalid.');
  if (JSON.stringify(protocol.armOrder) !== JSON.stringify(ARMS)) fail('protocol.armOrder must be keyword, dense, hybrid.');
  if (!finiteInt(protocol.warmupPasses) || !finiteInt(protocol.measuredPasses)) fail('protocol pass counts invalid.');
  if ((protocol.warmupPasses as number) + (protocol.measuredPasses as number) !== passIds.length) fail('protocol pass ids do not match pass counts.');

  const policy = value.policy;
  if (!isObject(policy) || !finite(policy.keywordMinCoverage) || !finite(policy.denseMinCosine) || !['uncalibrated-default', 'calibrated', 'partially-calibrated'].includes(policy.source as string)) {
    fail('policy invalid.');
  }

  if (!Array.isArray(value.rows)) {
    fail('rows missing.');
    return problems;
  }
  const rows = value.rows as unknown[];
  const expectedRows = passIds.length * questionIds.size * ARMS.length;
  if (rows.length !== expectedRows) fail(`Expected ${expectedRows} rows, found ${rows.length}.`);
  rows.forEach((row, index) => rowProblems(row, index, questionIds, new Set(passIds as string[])).forEach(fail));

  if (!Array.isArray(value.arms) || value.arms.length !== ARMS.length) {
    fail('arms must contain keyword, dense and hybrid summaries.');
  } else {
    (value.arms as unknown[]).forEach((arm, index) => {
      if (!isObject(arm) || arm.arm !== ARMS[index]) {
        fail(`arms[${index}] must be ${ARMS[index]}.`);
        return;
      }
      if (!['complete', 'partial', 'unavailable'].includes(arm.state as string)) fail(`${String(arm.arm)}: invalid state.`);
      const coverage = arm.coverage;
      if (!isObject(coverage)) {
        fail(`${String(arm.arm)}: coverage missing.`);
        return;
      }
      const counts = ['expected', 'attempted', 'ok', 'unavailable', 'error', 'cancelled'].map((key) => coverage[key]);
      if (!counts.every(finiteInt)) fail(`${String(arm.arm)}: coverage counts must be integers.`);
      const [expected, , ok, unavailable, error, cancelled] = counts as number[];
      if (ok + (unavailable ?? 0) + (error ?? 0) + (cancelled ?? 0) !== expected) fail(`${String(arm.arm)}: status counts do not add up to expected rows.`);
      if (expected !== (protocol.measuredPasses as number) * questionIds.size) fail(`${String(arm.arm)}: expected rows do not match the protocol.`);
      if (arm.state === 'complete' && ok !== expected) fail(`${String(arm.arm)}: complete arm with failed rows.`);
      if (arm.state !== 'complete' && arm.aggregate !== null) fail(`${String(arm.arm)}: aggregates are only allowed for complete arms.`);
      if (isObject(arm.aggregate)) {
        const recall = arm.aggregate.recall;
        if (!isObject(recall) || !RECALL_KS.every((k) => unit(recall[String(k)]))) fail(`${String(arm.arm)}: recall must be in [0,1].`);
        if (!unit(arm.aggregate.mrr)) fail(`${String(arm.arm)}: MRR must be in [0,1].`);
      }
      const latency = arm.latency;
      if (!isObject(latency)) fail(`${String(arm.arm)}: latency missing.`);
      else for (const key of ['retrievalSum', 'retrievalWall', 'answerJourneySum', 'journeyWall']) sampleProblems(latency[key], `${String(arm.arm)}.${key}`).forEach(fail);
    });
  }
  return problems;
}

export function isMeasurementReport(value: unknown): value is MeasurementReport {
  return reportProblems(value).length === 0;
}

/** Bundled-fixture-only JSON export. Refuses invalid reports; imported documents never enter reports. */
export function exportReportJson(report: MeasurementReport): string {
  const problems = reportProblems(report);
  if (problems.length > 0) throw new Error(`Report failed validation: ${problems.slice(0, 3).join(' ')}`);
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Whether a dense/hybrid row may render in the production comparison (real model only). */
export function productionComparable(row: Pick<QueryRow, 'arm' | 'executionKind'>): boolean {
  return row.arm === 'keyword' ? row.executionKind === 'real-browser-lexical' : row.executionKind === 'real-browser-model';
}

const ROW_STATUS = ['ok', 'unavailable', 'error', 'cancelled'];
const EXECUTION = ['real-browser-lexical', 'real-browser-model', 'test-oracle'];

function rowProblems(row: unknown, index: number, questionIds: Set<string>, passIds: Set<string>): string[] {
  const label = `rows[${index}]`;
  if (!isObject(row)) return [`${label} is not an object.`];
  const problems: string[] = [];
  if (!questionIds.has(row.questionId as string)) problems.push(`${label}: unknown question.`);
  if (!passIds.has(row.passId as string)) problems.push(`${label}: unknown pass.`);
  if (!ARMS.includes(row.arm as ArmId)) problems.push(`${label}: unknown arm.`);
  if (!ROW_STATUS.includes(row.status as string)) problems.push(`${label}: invalid status.`);
  if (!EXECUTION.includes(row.executionKind as string)) problems.push(`${label}: invalid execution kind.`);
  if (!Array.isArray(row.hits) || row.hits.length > 5) problems.push(`${label}: hits must be at most 5.`);
  if (row.recall !== null && (!isObject(row.recall) || !Object.values(row.recall).every(unit))) problems.push(`${label}: recall out of range.`);
  if (row.reciprocalRank !== null && !unit(row.reciprocalRank)) problems.push(`${label}: reciprocal rank out of range.`);
  if (!isObject(row.stageMs) || !Object.values(row.stageMs).every(duration)) problems.push(`${label}: stage durations must be finite and non-negative.`);
  for (const key of ['retrievalSumMs', 'answerSumMs', 'retrievalWallMs', 'journeyWallMs']) {
    if (row[key] !== null && !duration(row[key])) problems.push(`${label}: ${key} invalid.`);
  }
  return problems;
}

function sampleProblems(value: unknown, label: string): string[] {
  if (!isObject(value)) return [`${label} missing.`];
  const summary = value as unknown as SampleSummary;
  if (!Array.isArray(summary.samples) || !summary.samples.every(duration)) return [`${label}: samples must be finite non-negative durations.`];
  if (summary.n !== summary.samples.length) return [`${label}: n does not match samples.`];
  if (summary.n === 0 && (summary.p50 !== null || summary.p95 !== null)) return [`${label}: empty samples must have null percentiles.`];
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function unit(value: unknown): boolean {
  return finite(value) && (value as number) >= 0 && (value as number) <= 1;
}

function duration(value: unknown): boolean {
  return finite(value) && (value as number) >= 0;
}
