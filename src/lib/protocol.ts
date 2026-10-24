import type { ArmId, EmbedderStatus, EnvironmentSnapshot, GatePolicy, Hit, LabelledQuestion } from '../domain.ts';
import { ARMS, isNegativeKind } from '../domain.ts';
import type { Clock } from '../ports.ts';
import type {
  ArmSummary,
  CoverageCounts,
  ExecutionKind,
  LatencySummary,
  MeasurementReport,
  PassQuality,
  QueryRow,
  QueryStage,
  SampleSummary,
  SetupObservation,
} from '../report.ts';
import type { Corpus } from '../session.ts';
import { runArm, type ArmRun, type DenseContext } from './ask.ts';
import { calibrateArm, observation, policyFrom, type CalibrationResult } from './calibrate.ts';
import {
  BM25_B,
  BM25_K1,
  FUSION_POOL,
  LOW_N_NOTE_BELOW,
  MEASURED_PASSES,
  RECALL_KS,
  REPORT_SCHEMA,
  RETRIEVE_K,
  RRF_K,
  TOKENIZER_VERSION,
} from './config.ts';
import { ActionableError } from './errors.ts';
import { assertFixtureValid, type EvaluationFixture } from './fixture.ts';
import { coveredUnitIds, mean, percentiles, recallAt, reciprocalRankAt, type RetrievedSpan } from './metrics.ts';

/**
 * Fixed benchmark protocol (PLAN.md section 8): one excluded warm-up suite, then 3 measured passes.
 * Questions in frozen id order; arms serially keyword, dense, hybrid; effectiveQuery is the original
 * fixture text; arms are independent (no cross-arm reuse of query results). Every expected
 * pass/question/arm row is recorded with a status; denominators never shrink after failures.
 */

export interface ProtocolInput {
  fixture: EvaluationFixture;
  corpus: Corpus;
  dense: DenseContext | null;
  denseUnavailableReason: string;
  model: EmbedderStatus | null;
  policy: GatePolicy;
  /** The calibration run that produced `policy` (required unless the policy is the uncalibrated default). */
  calibration: CalibrationResult | null;
  clock: Clock;
  signal: AbortSignal;
  environment: EnvironmentSnapshot;
  wasmThreads: number | null;
  sourceRevision: string;
  runId: string;
  createdAt: string;
  setup: SetupObservation[];
  onProgress?: (done: number, total: number) => void;
  warmupPasses?: number;
  measuredPasses?: number;
}

const ANSWER_DECIDED = new Set(['answered', 'abstained', 'no-query-terms']);
const ABSTAINED = new Set(['abstained', 'no-query-terms']);

function assertRunnable(fixture: EvaluationFixture, corpus: Corpus): void {
  if (corpus.document.sourceType !== 'fixture' || corpus.document.contentHash !== fixture.document.contentHash) {
    throw new ActionableError('wrong-corpus', 'Measurements run only on the bundled evaluation corpus. Load it first.');
  }
  assertFixtureValid(fixture, corpus);
}

function denseFor(input: { dense: DenseContext | null; corpus: Corpus }): DenseContext | null {
  return input.dense && input.dense.corpusRevision === input.corpus.revision ? input.dense : null;
}

function executionKindFor(arm: ArmId, dense: DenseContext | null): ExecutionKind {
  if (arm === 'keyword') return 'real-browser-lexical';
  // No dense context: these rows never executed a model, so they claim no model lineage.
  return dense?.executionKind ?? 'not-run';
}

export async function runBenchmark(input: ProtocolInput): Promise<MeasurementReport> {
  const { fixture, corpus, clock, signal } = input;
  assertRunnable(fixture, corpus);
  const questions = fixture.evaluation;
  const dense = denseFor(input);
  const warmups = input.warmupPasses ?? 1;
  const measured = input.measuredPasses ?? MEASURED_PASSES;
  const passIds = [
    ...Array.from({ length: warmups }, (_, index) => `warmup-${index + 1}`),
    ...Array.from({ length: measured }, (_, index) => `pass-${index + 1}`),
  ];
  const total = passIds.length * questions.length * ARMS.length;
  const rows: QueryRow[] = [];
  let cancelled = false;
  let done = 0;

  for (const [passIndex, passId] of passIds.entries()) {
    const warmup = passIndex < warmups;
    for (const question of questions) {
      for (const arm of ARMS) {
        if (signal.aborted) cancelled = true;
        if (cancelled) {
          rows.push(cancelledRow(passId, passIndex, warmup, question, arm, executionKindFor(arm, dense)));
        } else {
          const run = await runArm({
            arm,
            corpus,
            dense,
            denseUnavailableReason: input.denseUnavailableReason,
            query: question.text,
            policy: input.policy,
            clock,
            signal,
          });
          if (run.status === 'cancelled') cancelled = true;
          rows.push(toRow(passId, passIndex, warmup, question, run, corpus, executionKindFor(arm, dense)));
        }
        done += 1;
        input.onProgress?.(done, total);
      }
    }
  }

  const measuredPassIds = passIds.slice(warmups);
  const arms = ARMS.map((arm) => summarizeArm(arm, rows, questions, measuredPassIds, arm === 'keyword' ? null : dense ? null : input.denseUnavailableReason));
  const report: MeasurementReport = {
    schema: REPORT_SCHEMA,
    runId: input.runId,
    createdAt: input.createdAt,
    app: { name: 'browser-doc-qa', sourceRevision: input.sourceRevision || 'unknown' },
    fixture: {
      fixtureId: fixture.fixtureId,
      fixtureVersion: fixture.fixtureVersion,
      split: 'evaluation',
      corpusHash: corpus.document.contentHash,
      corpusRevision: corpus.revision,
      chunkCount: corpus.chunks.length,
      questionIds: questions.map((question) => question.id),
    },
    policy: input.policy,
    calibration: input.policy.source === 'uncalibrated-default' ? null : input.calibration,
    config: {
      chunker: corpus.chunks[0]?.chunkerConfig ?? { version: 'none', maxChars: 0, overlapChars: 0, minTailChars: 0 },
      tokenizerVersion: TOKENIZER_VERSION,
      configFingerprint: corpus.configFingerprint,
      bm25: { k1: BM25_K1, b: BM25_B },
      rrf: { k: RRF_K, pool: FUSION_POOL, topK: RETRIEVE_K },
    },
    model: dense && input.model
      ? { identity: input.model.identity, backend: input.model.backend, initMs: input.model.initMs, executionKind: dense.executionKind }
      : null,
    modelUnavailableReason: dense ? null : input.denseUnavailableReason,
    environment: { ...input.environment, wasmThreads: input.wasmThreads },
    cacheState: dense
      ? { sentenceVectors: 'warmed-by-excluded-pass', note: 'Sentence vectors for exact spans were cached during the excluded warm-up pass; measured answer-embed stages mostly reuse them.' }
      : { sentenceVectors: 'not-applicable', note: 'No dense model; no sentence vectors.' },
    protocol: {
      warmupPasses: warmups,
      measuredPasses: measured,
      armOrder: [...ARMS],
      questionOrder: questions.map((question) => question.id),
      passIds,
      queryIsolation: 'independent-arms-no-cross-arm-reuse',
      effectiveQuery: 'original-fixture-text',
    },
    status: cancelled ? 'cancelled' : 'complete',
    arms,
    rows,
    setup: input.setup,
    notes: reportNotes(measured, questions.length),
  };
  return report;
}

function reportNotes(passes: number, questions: number): string[] {
  return [
    `Quality is per unique question per pass: ${questions} questions x ${passes} passes are not ${questions * passes} independent samples.`,
    'Percentiles are nearest-rank over success samples only; with fewer than 20 samples p95 describes this sample, not a stable tail.',
    'Order, repeats, background tabs, thermal state and timer resolution limit interpretation. No device-speed or superiority claim follows from this small suite.',
    'Equal or worse hybrid results are valid data. Gates are heuristics, not confidence.',
  ];
}

function toRow(passId: string, passIndex: number, warmup: boolean, question: LabelledQuestion, run: ArmRun, corpus: Corpus, executionKind: ExecutionKind): QueryRow {
  const answerable = !isNegativeKind(question.kind);
  const retrieved: RetrievedSpan[] = run.hits.map((hit) => ({ sourceHash: corpus.document.contentHash, pageNumber: hit.pageNumber, start: hit.start, end: hit.end }));
  const scored = run.status === 'ok' && answerable;
  return {
    passId,
    passIndex,
    warmup,
    questionId: question.id,
    kind: question.kind,
    arm: run.arm,
    status: run.status,
    reason: run.reason,
    failedStage: run.failedStage,
    retrievalAttempted: run.retrievalAttempted,
    retrievalSucceeded: run.retrievalSucceeded,
    executionKind,
    hits: run.hits.map(rowHit),
    coveredUnitIds: scored ? Object.fromEntries(RECALL_KS.map((k) => [String(k), coveredUnitIds(question.evidenceUnits, retrieved, k)])) : null,
    recall: scored ? Object.fromEntries(RECALL_KS.map((k) => [String(k), recallAt(question.evidenceUnits, retrieved, k)])) : null,
    reciprocalRank: scored ? reciprocalRankAt(question.evidenceUnits, retrieved) : null,
    answer: run.answer
      ? {
        status: run.answer.status,
        excerpts: run.answer.excerpts.map((excerpt) => ({
          pageNumber: excerpt.citation.pageNumber,
          start: excerpt.citation.start,
          end: excerpt.citation.end,
          keywordCoverage: excerpt.keywordCoverage,
          denseCosine: excerpt.denseCosine,
        })),
        stageError: run.answer.stageError ? `${run.answer.stageError.stage}: ${run.answer.stageError.message}` : null,
      }
      : null,
    stageMs: { ...run.stageMs },
    retrievalSumMs: run.retrievalSumMs,
    answerSumMs: run.answerSumMs,
    retrievalWallMs: run.retrievalWallMs,
    journeyWallMs: run.journeyWallMs,
  };
}

function rowHit(hit: Hit): QueryRow['hits'][number] {
  return {
    chunkId: hit.chunkId,
    pageNumber: hit.pageNumber,
    start: hit.start,
    end: hit.end,
    keywordRank: hit.keyword?.rank ?? null,
    keywordScore: hit.keyword?.score ?? null,
    denseRank: hit.dense?.rank ?? null,
    denseCosine: hit.dense?.score ?? null,
    fusedRank: hit.fused?.rank ?? null,
    fusedScore: hit.fused?.score ?? null,
  };
}

function cancelledRow(passId: string, passIndex: number, warmup: boolean, question: LabelledQuestion, arm: ArmId, executionKind: ExecutionKind): QueryRow {
  return {
    passId, passIndex, warmup, questionId: question.id, kind: question.kind, arm,
    status: 'cancelled', reason: 'The run was cancelled before this row.', failedStage: null,
    retrievalAttempted: false, retrievalSucceeded: false, executionKind, hits: [],
    coveredUnitIds: null, recall: null, reciprocalRank: null, answer: null, stageMs: {},
    retrievalSumMs: null, answerSumMs: null, retrievalWallMs: null, journeyWallMs: null,
  };
}

export function summarizeArm(arm: ArmId, rows: readonly QueryRow[], questions: readonly LabelledQuestion[], passIds: readonly string[], unavailableReason: string | null): ArmSummary {
  const armRows = rows.filter((row) => row.arm === arm);
  const measuredRows = armRows.filter((row) => !row.warmup);
  const answerables = questions.filter((question) => !isNegativeKind(question.kind));
  const negatives = questions.filter((question) => isNegativeKind(question.kind));
  const coverage: CoverageCounts = {
    expected: passIds.length * questions.length,
    attempted: measuredRows.filter((row) => row.retrievalAttempted).length,
    ok: measuredRows.filter((row) => row.status === 'ok').length,
    unavailable: measuredRows.filter((row) => row.status === 'unavailable').length,
    error: measuredRows.filter((row) => row.status === 'error').length,
    cancelled: measuredRows.filter((row) => row.status === 'cancelled').length,
  };
  // Missing expected rows count against completeness, never shrink the denominator.
  const state: ArmSummary['state'] = coverage.unavailable === coverage.expected ? 'unavailable' : coverage.ok === coverage.expected ? 'complete' : 'partial';

  const passes: PassQuality[] = passIds.map((passId) => {
    const passRows = measuredRows.filter((row) => row.passId === passId);
    const byQuestion = new Map(passRows.map((row) => [row.questionId, row]));
    const complete = questions.every((question) => byQuestion.get(question.id)?.status === 'ok');
    const decided = complete && questions.every((question) => ANSWER_DECIDED.has(byQuestion.get(question.id)?.answer?.status ?? ''));
    const recall = complete
      ? Object.fromEntries(RECALL_KS.map((k) => [String(k), mean(answerables.map((question) => byQuestion.get(question.id)?.recall?.[String(k)] ?? 0)) ?? 0]))
      : null;
    const mrr = complete ? mean(answerables.map((question) => byQuestion.get(question.id)?.reciprocalRank ?? 0)) : null;
    const status = (question: LabelledQuestion): string => byQuestion.get(question.id)?.answer?.status ?? '';
    return {
      passId,
      recall,
      mrr,
      correctAbstentions: decided ? negatives.filter((question) => ABSTAINED.has(status(question))).length : null,
      falseAbstentions: decided ? answerables.filter((question) => ABSTAINED.has(status(question))).length : null,
      falseAccepts: decided ? negatives.filter((question) => status(question) === 'answered').length : null,
      answerDecisionsComplete: decided,
    };
  });

  const allComplete = state === 'complete' && passes.every((pass) => pass.recall !== null && pass.mrr !== null);
  const allDecided = passes.every((pass) => pass.answerDecisionsComplete);
  const meanOf = (pick: (pass: PassQuality) => number | null): number | null => {
    const values = passes.map(pick);
    return values.every((value): value is number => value !== null) ? mean(values) : null;
  };
  const aggregate = allComplete
    ? {
      recall: Object.fromEntries(RECALL_KS.map((k) => [String(k), mean(passes.map((pass) => pass.recall?.[String(k)] ?? 0)) ?? 0])),
      mrr: mean(passes.map((pass) => pass.mrr ?? 0)) ?? 0,
      correctAbstentions: allDecided ? meanOf((pass) => pass.correctAbstentions) : null,
      falseAbstentions: allDecided ? meanOf((pass) => pass.falseAbstentions) : null,
      falseAccepts: allDecided ? meanOf((pass) => pass.falseAccepts) : null,
    }
    : null;

  const ranksVaryAcrossPasses = questions.some((question) => {
    const lists = measuredRows.filter((row) => row.questionId === question.id && row.status === 'ok').map((row) => row.hits.map((hit) => hit.chunkId).join(','));
    return new Set(lists).size > 1;
  });

  return {
    arm,
    state,
    unavailableReason: state === 'unavailable' ? unavailableReason ?? measuredRows[0]?.reason ?? 'Unavailable.' : null,
    coverage,
    answerableDenominator: answerables.length,
    negativeDenominator: negatives.length,
    passes,
    aggregate,
    ranksVaryAcrossPasses,
    latency: latency(armRows),
  };
}

function summary(samples: number[]): SampleSummary {
  const stats = percentiles(samples);
  return { n: stats.n, p50: stats.p50, p95: stats.p95, samples, lowN: stats.n < LOW_N_NOTE_BELOW };
}

function latency(armRows: readonly QueryRow[]): LatencySummary {
  const measured = armRows.filter((row) => !row.warmup);
  const ok = measured.filter((row) => row.status === 'ok');
  const values = (pick: (row: QueryRow) => number | null): number[] => ok.map(pick).filter((value): value is number => value !== null);
  const stages: Partial<Record<QueryStage, SampleSummary>> = {};
  const stageNames: QueryStage[] = ['search-keyword', 'embed-query', 'search-vector', 'fuse', 'answer-select', 'answer-embed', 'answer-format'];
  for (const stage of stageNames) {
    const samples = values((row) => row.stageMs[stage] ?? null);
    if (samples.length > 0) stages[stage] = summary(samples);
  }
  return {
    retrievalSum: summary(values((row) => row.retrievalSumMs)),
    retrievalWall: summary(values((row) => row.retrievalWallMs)),
    answerJourneySum: summary(values((row) => (row.retrievalSumMs !== null && row.answerSumMs !== null ? row.retrievalSumMs + row.answerSumMs : null))),
    journeyWall: summary(values((row) => row.journeyWallMs)),
    stages,
    failureDurationsMs: measured
      .filter((row) => row.status === 'error' || (row.status === 'cancelled' && row.retrievalAttempted))
      .map((row) => Object.values(row.stageMs).reduce((sum, value) => sum + (value ?? 0), 0)),
    warmupExcluded: armRows.length - measured.length,
  };
}

export interface CalibrationInput {
  fixture: EvaluationFixture;
  corpus: Corpus;
  dense: DenseContext | null;
  denseUnavailableReason: string;
  clock: Clock;
  signal: AbortSignal;
  runId: string;
  createdAt: string;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Runs keyword and dense once over the 12 calibration questions (never the evaluation split), sweeps
 * thresholds per arm, then reports hybrid accept counts under the chosen component gates.
 */
export async function runCalibration(input: CalibrationInput): Promise<CalibrationResult> {
  const { fixture, corpus, clock, signal } = input;
  assertRunnable(fixture, corpus);
  const questions = fixture.calibration;
  const dense = denseFor(input);
  const probePolicy: GatePolicy = { keywordMinCoverage: 0, denseMinCosine: -1, source: 'uncalibrated-default', calibratedGates: [], calibrationRunId: null };
  const total = questions.length * (dense ? 3 : 1);
  let done = 0;
  const step = (): void => { done += 1; input.onProgress?.(done, total); };

  const observe = async (arm: 'keyword' | 'dense') => {
    const observations = [];
    for (const question of questions) {
      if (signal.aborted) throw new ActionableError('cancelled', 'Calibration was cancelled.');
      const run = await runArm({ arm, corpus, dense, denseUnavailableReason: input.denseUnavailableReason, query: question.text, policy: probePolicy, clock, signal });
      const ok = run.status === 'ok' && run.answer !== null && run.answer.status !== 'error';
      const score = arm === 'keyword' ? run.diagnostics?.maxKeywordCoverage ?? null : run.diagnostics?.maxDenseCosine ?? null;
      observations.push(observation(question, score, ok));
      step();
    }
    return observations;
  };

  const keywordObs = await observe('keyword');
  const denseObs = dense ? await observe('dense') : null;
  const keyword = calibrateArm('keyword', questions, keywordObs, null);
  const denseCal = calibrateArm('dense', questions, denseObs, input.denseUnavailableReason);
  const policy = policyFrom(keyword, denseCal, input.runId);

  let hybrid: CalibrationResult['hybrid'] = null;
  if (dense) {
    let positivesAccepted = 0;
    let negativesAccepted = 0;
    let complete = true;
    for (const question of questions) {
      if (signal.aborted) throw new ActionableError('cancelled', 'Calibration was cancelled.');
      const run = await runArm({ arm: 'hybrid', corpus, dense, denseUnavailableReason: input.denseUnavailableReason, query: question.text, policy, clock, signal });
      if (run.status !== 'ok' || !run.answer || run.answer.status === 'error') complete = false;
      else if (run.answer.status === 'answered') {
        if (isNegativeKind(question.kind)) negativesAccepted += 1;
        else positivesAccepted += 1;
      }
      step();
    }
    const negatives = questions.filter((question) => isNegativeKind(question.kind)).length;
    hybrid = { positivesAccepted, negativesAccepted, positives: questions.length - negatives, negatives, complete };
  }

  return {
    runId: input.runId,
    createdAt: input.createdAt,
    fixtureId: fixture.fixtureId,
    fixtureVersion: fixture.fixtureVersion,
    questionIds: questions.map((question) => question.id),
    keyword,
    dense: denseCal,
    hybrid,
    policy,
  };
}
