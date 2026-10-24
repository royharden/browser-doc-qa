import type { Answer, ArmId, Excerpt, GatePolicy, Hit } from '../domain.ts';
import type { Clock } from '../ports.ts';
import type { Corpus } from '../session.ts';
import { keywordCoverage } from './bm25.ts';
import { atomicUnits } from './chunk.ts';
import { EXCERPT_CHUNKS, MAX_EXCERPTS, RRF_K } from './config.ts';
import { errorMessage } from './errors.ts';
import { compareCodepoints } from './hash.ts';
import { sentenceIntervals } from './sentences.ts';
import { uniqueTokens } from './tokenize.ts';
import { dot, type Vector } from './vector.ts';

/**
 * Excerpt answers (PLAN.md section 5). Sentence spans come from the selected arm's top 3 chunks, are
 * deduplicated by exact canonical span only, scored per arm, gated by the (uncalibrated unless calibrated)
 * policy and at most two original spans are returned with immutable citations. Gates never touch the
 * raw rankings used for recall. Scores are heuristics, never confidence or entailment.
 */

export interface SentenceCandidate {
  /** Exact span identity: revision|page|start|end. */
  key: string;
  chunkId: string;
  chunkRank: number;
  pageNumber: number;
  start: number;
  end: number;
  quote: string;
  fragment: boolean;
}

/** Supplies same-config sentence vectors for exact spans (cached by the dense layer). */
export type SentenceVectorSource = (candidates: readonly SentenceCandidate[], signal: AbortSignal) => Promise<ReadonlyMap<string, Vector>>;

export interface AnswerInput {
  arm: ArmId;
  corpus: Corpus;
  query: string;
  hits: readonly Hit[];
  policy: GatePolicy;
  clock: Clock;
  signal: AbortSignal;
  /** Required for dense/hybrid answers. */
  queryVector?: Vector | null;
  sentenceVectors?: SentenceVectorSource | null;
}

/** Ungated candidate maxima, used only by the calibration sweep (never shown as confidence). */
export interface AnswerDiagnostics {
  candidates: number;
  maxKeywordCoverage: number | null;
  maxDenseCosine: number | null;
}

export interface AnswerTiming {
  'answer-select': number;
  'answer-embed'?: number;
  'answer-format': number;
}

export const ABSTAIN_REASON = "I don't know: no supporting excerpt found. (Heuristic gate, not a guarantee.)";

export function spanKey(revision: string, pageNumber: number, start: number, end: number): string {
  return `${revision}|${pageNumber}|${start}|${end}`;
}

export function collectCandidates(corpus: Corpus, hits: readonly Hit[], chunkCount = EXCERPT_CHUNKS): SentenceCandidate[] {
  const seen = new Set<string>();
  const candidates: SentenceCandidate[] = [];
  for (const hit of hits.slice(0, chunkCount)) {
    const chunk = corpus.chunkById.get(hit.chunkId);
    const page = chunk ? corpus.pageByNumber.get(chunk.pageNumber) : undefined;
    if (!chunk || !page) continue;
    const sentences = new Set(sentenceIntervals(page.canonicalText).map((span) => `${span.start}-${span.end}`));
    for (const unit of atomicUnits(page.canonicalText, chunk.chunkerConfig.maxChars)) {
      if (unit.start < chunk.start || unit.end > chunk.end) continue;
      const key = spanKey(corpus.revision, chunk.pageNumber, unit.start, unit.end);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        key,
        chunkId: chunk.id,
        chunkRank: hit.rank,
        pageNumber: chunk.pageNumber,
        start: unit.start,
        end: unit.end,
        quote: page.canonicalText.slice(unit.start, unit.end),
        fragment: !sentences.has(`${unit.start}-${unit.end}`),
      });
    }
  }
  return candidates;
}

interface Scored {
  candidate: SentenceCandidate;
  coverage: number | null;
  cosine: number | null;
  order: number;
  eligible: boolean;
}

export interface AnswerResult {
  answer: Answer;
  timing: AnswerTiming;
  diagnostics: AnswerDiagnostics;
}

const NO_DIAGNOSTICS: AnswerDiagnostics = { candidates: 0, maxKeywordCoverage: null, maxDenseCosine: null };

export async function answerFromHits(input: AnswerInput): Promise<AnswerResult> {
  const { clock, policy, corpus } = input;
  const selectStarted = clock.now();
  const base = { arm: input.arm, policy, stageError: null } as const;
  if (uniqueTokens(input.query).length === 0 && input.arm === 'keyword') {
    return finish({ ...base, status: 'no-query-terms', excerpts: [], reason: 'The question has no searchable words.' }, selectStarted);
  }
  if (input.hits.length === 0) {
    return finish({ ...base, status: 'abstained', excerpts: [], reason: ABSTAIN_REASON }, selectStarted);
  }
  const candidates = collectCandidates(corpus, input.hits);
  const needsVectors = input.arm !== 'keyword';
  let selectMs = clock.now() - selectStarted;
  let embedMs: number | undefined;
  let vectors: ReadonlyMap<string, Vector> = new Map();
  if (needsVectors) {
    const embedStarted = clock.now();
    try {
      if (!input.queryVector || !input.sentenceVectors) throw new Error('The dense index is not ready.');
      vectors = await input.sentenceVectors(candidates, input.signal);
      for (const candidate of candidates) {
        if (!vectors.has(candidate.key)) throw new Error(`Missing sentence vector for ${candidate.key}.`);
      }
    } catch (error) {
      embedMs = clock.now() - embedStarted;
      const formatStarted = clock.now();
      const answer: Answer = {
        ...base,
        status: 'error',
        excerpts: [],
        reason: 'The answer stage failed; retrieval results are still shown.',
        stageError: { stage: 'answer-embed', message: errorMessage(error) },
      };
      return { answer, timing: { 'answer-select': selectMs, 'answer-embed': embedMs, 'answer-format': clock.now() - formatStarted }, diagnostics: { ...NO_DIAGNOSTICS, candidates: candidates.length } };
    }
    embedMs = clock.now() - embedStarted;
  }

  const rescoreStarted = clock.now();
  const scored = scoreCandidates(input, candidates, vectors);
  const picked = scored.filter((item) => item.eligible).slice(0, MAX_EXCERPTS);
  selectMs += clock.now() - rescoreStarted;

  const formatStarted = clock.now();
  const excerpts: Excerpt[] = picked.map((item, index) => Object.freeze({
    alias: index + 1,
    citation: Object.freeze({
      revision: corpus.revision,
      sourceHash: corpus.document.contentHash,
      pageNumber: item.candidate.pageNumber,
      start: item.candidate.start,
      end: item.candidate.end,
    }),
    quote: item.candidate.quote,
    sourceChunkId: item.candidate.chunkId,
    fragment: item.candidate.fragment,
    keywordCoverage: item.coverage,
    denseCosine: item.cosine,
  }));
  const answer: Answer = Object.freeze({
    ...base,
    status: excerpts.length > 0 ? 'answered' : 'abstained',
    excerpts: Object.freeze(excerpts) as Excerpt[],
    reason: excerpts.length > 0 ? null : ABSTAIN_REASON,
  });
  const timing: AnswerTiming = { 'answer-select': selectMs, 'answer-format': clock.now() - formatStarted };
  if (embedMs !== undefined) timing['answer-embed'] = embedMs;
  const diagnostics: AnswerDiagnostics = {
    candidates: scored.length,
    maxKeywordCoverage: maxOf(scored.map((item) => item.coverage)),
    maxDenseCosine: maxOf(scored.map((item) => item.cosine)),
  };
  return { answer, timing, diagnostics };

  function finish(answer: Answer, started: number): AnswerResult {
    const selected = clock.now() - started;
    return { answer, timing: { 'answer-select': selected, 'answer-format': 0 }, diagnostics: NO_DIAGNOSTICS };
  }
}

function maxOf(values: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const value of values) if (value !== null && (best === null || value > best)) best = value;
  return best;
}

function scoreCandidates(input: AnswerInput, candidates: readonly SentenceCandidate[], vectors: ReadonlyMap<string, Vector>): Scored[] {
  const { policy } = input;
  const scored: Scored[] = candidates.map((candidate) => {
    const coverage = input.arm === 'dense' ? null : keywordCoverage(input.corpus.bm25, input.query, candidate.quote);
    const vector = vectors.get(candidate.key);
    const cosine = input.arm === 'keyword' || !vector || !input.queryVector ? null : dot(input.queryVector, vector);
    const keywordPass = coverage !== null && coverage >= policy.keywordMinCoverage;
    const densePass = cosine !== null && cosine >= policy.denseMinCosine;
    const eligible = input.arm === 'keyword' ? keywordPass : input.arm === 'dense' ? densePass : keywordPass || densePass;
    return { candidate, coverage, cosine, order: 0, eligible };
  });

  if (input.arm === 'keyword') {
    scored.sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1) || a.candidate.chunkRank - b.candidate.chunkRank || compareCodepoints(a.candidate.key, b.candidate.key));
  } else if (input.arm === 'dense') {
    scored.sort((a, b) => (b.cosine ?? -Infinity) - (a.cosine ?? -Infinity) || compareCodepoints(a.candidate.key, b.candidate.key));
  } else {
    // Hybrid: RRF (k=60) over lexical and semantic sentence ranks.
    const lexical = [...scored].sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1) || compareCodepoints(a.candidate.key, b.candidate.key));
    const semantic = [...scored].sort((a, b) => (b.cosine ?? -Infinity) - (a.cosine ?? -Infinity) || compareCodepoints(a.candidate.key, b.candidate.key));
    const fused = new Map<string, number>();
    lexical.forEach((item, index) => fused.set(item.candidate.key, 1 / (RRF_K + index + 1)));
    semantic.forEach((item, index) => fused.set(item.candidate.key, (fused.get(item.candidate.key) ?? 0) + 1 / (RRF_K + index + 1)));
    for (const item of scored) item.order = fused.get(item.candidate.key) ?? 0;
    scored.sort((a, b) => b.order - a.order || compareCodepoints(a.candidate.key, b.candidate.key));
  }
  return scored;
}
