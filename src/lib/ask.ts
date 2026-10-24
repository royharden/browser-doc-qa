import type { Answer, ArmId, GatePolicy, Hit } from '../domain.ts';
import type { Clock } from '../ports.ts';
import type { QueryStage, RowStatus } from '../report.ts';
import type { Corpus } from '../session.ts';
import { answerFromHits, type AnswerDiagnostics, type SentenceVectorSource } from './answer.ts';
import { MAX_QUESTION_CHARS } from './config.ts';
import { ActionableError, errorMessage } from './errors.ts';
import { denseCandidates, fuseHits, keywordCandidates, keywordHits, denseHits } from './retrieve.ts';
import type { Vector } from './vector.ts';

/**
 * Dense side of a corpus revision, supplied by the dense layer only once a REAL model has indexed
 * every chunk of this revision. Never constructed from fake/hash/random vectors in the product.
 */
export interface DenseContext {
  corpusRevision: string;
  vectors: readonly Vector[];
  embedQuery(query: string, signal: AbortSignal): Promise<Vector>;
  sentenceVectors: SentenceVectorSource;
  executionKind: 'real-browser-model' | 'test-oracle';
}

export interface ArmRun {
  arm: ArmId;
  status: RowStatus;
  reason: string | null;
  failedStage: QueryStage | null;
  hits: Hit[];
  answer: Answer | null;
  /** Ungated candidate maxima for calibration; null until the answer stage ran. */
  diagnostics: AnswerDiagnostics | null;
  stageMs: Partial<Record<QueryStage, number>>;
  retrievalSumMs: number | null;
  answerSumMs: number | null;
  retrievalWallMs: number | null;
  journeyWallMs: number | null;
  retrievalAttempted: boolean;
  retrievalSucceeded: boolean;
}

export interface ArmInput {
  arm: ArmId;
  corpus: Corpus;
  dense: DenseContext | null;
  denseUnavailableReason: string;
  query: string;
  policy: GatePolicy;
  clock: Clock;
  signal: AbortSignal;
}

export function validateQuestion(raw: string): string {
  const query = raw.trim();
  if (query === '') throw new ActionableError('empty-question', 'Enter a question first.');
  if (query.length > MAX_QUESTION_CHARS) {
    throw new ActionableError('question-too-long', `Keep the question under ${MAX_QUESTION_CHARS} characters.`);
  }
  return query;
}

/**
 * Runs one arm independently (no cross-arm reuse of query results, PLAN.md section 8):
 * keyword = search-keyword; dense = embed-query + search-vector; hybrid = search-keyword + embed-query +
 * search-vector + fuse. Answer stages follow. Failures keep a status and the stage that failed;
 * an answer-stage failure keeps the successful retrieval.
 */
export async function runArm(input: ArmInput): Promise<ArmRun> {
  const { arm, corpus, clock, signal } = input;
  const stageMs: Partial<Record<QueryStage, number>> = {};
  const run: ArmRun = {
    arm,
    status: 'ok',
    reason: null,
    failedStage: null,
    hits: [],
    answer: null,
    diagnostics: null,
    stageMs,
    retrievalSumMs: null,
    answerSumMs: null,
    retrievalWallMs: null,
    journeyWallMs: null,
    retrievalAttempted: false,
    retrievalSucceeded: false,
  };
  const dense = input.dense;
  if (arm !== 'keyword' && (!dense || dense.corpusRevision !== corpus.revision)) {
    return { ...run, status: 'unavailable', reason: dense ? 'The dense index belongs to another corpus revision.' : input.denseUnavailableReason };
  }

  const timed = async <T>(stage: QueryStage, work: () => Promise<T> | T): Promise<T> => {
    if (signal.aborted) throw new ActionableError('cancelled', 'Cancelled.');
    const started = clock.now();
    try {
      return await work();
    } finally {
      stageMs[stage] = clock.now() - started;
    }
  };

  const journeyStarted = clock.now();
  run.retrievalAttempted = true;
  let stage: QueryStage = 'search-keyword';
  let queryVector: Vector | null = null;
  try {
    if (arm === 'keyword') {
      stage = 'search-keyword';
      const candidates = await timed(stage, () => keywordCandidates(corpus, input.query));
      run.hits = keywordHits(corpus, candidates);
    } else if (dense) {
      let keyword: ReturnType<typeof keywordCandidates> = [];
      if (arm === 'hybrid') {
        stage = 'search-keyword';
        keyword = await timed(stage, () => keywordCandidates(corpus, input.query));
      }
      stage = 'embed-query';
      const vector = await timed(stage, () => dense.embedQuery(input.query, signal));
      queryVector = vector;
      stage = 'search-vector';
      const denseList = await timed(stage, () => denseCandidates(corpus, dense.vectors, vector));
      if (arm === 'dense') run.hits = denseHits(corpus, denseList);
      else {
        stage = 'fuse';
        run.hits = await timed(stage, () => fuseHits(corpus, keyword, denseList));
      }
    }
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof ActionableError && error.code === 'cancelled');
    return { ...run, status: cancelled ? 'cancelled' : 'error', reason: errorMessage(error), failedStage: stage, journeyWallMs: null };
  }
  run.retrievalWallMs = clock.now() - journeyStarted;
  run.retrievalSucceeded = true;
  run.retrievalSumMs = retrievalSum(arm, stageMs);

  try {
    if (signal.aborted) throw new ActionableError('cancelled', 'Cancelled.');
    const { answer, timing, diagnostics } = await answerFromHits({
      arm,
      corpus,
      query: input.query,
      hits: run.hits,
      policy: input.policy,
      clock,
      signal,
      queryVector,
      sentenceVectors: dense?.sentenceVectors ?? null,
    });
    Object.assign(stageMs, timing);
    run.answer = answer;
    run.diagnostics = diagnostics;
    run.answerSumMs = (timing['answer-select'] ?? 0) + (timing['answer-embed'] ?? 0) + (timing['answer-format'] ?? 0);
    run.journeyWallMs = clock.now() - journeyStarted;
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof ActionableError && error.code === 'cancelled');
    return { ...run, status: cancelled ? 'cancelled' : 'error', reason: errorMessage(error), failedStage: 'answer-select' };
  }
  return run;
}

/** Retrieval component sums per arm definition (PLAN.md section 8). */
export function retrievalSum(arm: ArmId, stageMs: Partial<Record<QueryStage, number>>): number {
  const get = (stage: QueryStage): number => stageMs[stage] ?? 0;
  if (arm === 'keyword') return get('search-keyword');
  if (arm === 'dense') return get('embed-query') + get('search-vector');
  return get('search-keyword') + get('embed-query') + get('search-vector') + get('fuse');
}
