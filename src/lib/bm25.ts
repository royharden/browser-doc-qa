import type { Chunk } from '../domain.ts';
import { BM25_B, BM25_K1 } from './config.ts';
import { compareCodepoints } from './hash.ts';
import { tokenize, uniqueTokens } from './tokenize.ts';

/** Immutable BM25 index, built once per corpus revision (PLAN.md section 4). */
export interface Bm25Index {
  readonly corpusRevision: string;
  readonly chunkIds: readonly string[];
  readonly termFrequencies: readonly ReadonlyMap<string, number>[];
  readonly lengths: readonly number[];
  readonly docFreq: ReadonlyMap<string, number>;
  readonly documentCount: number;
  readonly avgDocLength: number;
  readonly k1: number;
  readonly b: number;
}

export interface KeywordHit {
  chunkId: string;
  score: number;
  rank: number;
}

let buildCount = 0;

/** Number of BM25 builds since load; regression tests assert queries never rebuild. */
export function bm25BuildCount(): number {
  return buildCount;
}

export function buildBm25(chunks: readonly Chunk[], corpusRevision: string): Bm25Index {
  buildCount += 1;
  const termFrequencies: Map<string, number>[] = [];
  const lengths: number[] = [];
  const docFreq = new Map<string, number>();
  let lengthSum = 0;
  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const token of frequencies.keys()) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    termFrequencies.push(frequencies);
    lengths.push(tokens.length);
    lengthSum += tokens.length;
  }
  return Object.freeze({
    corpusRevision,
    chunkIds: Object.freeze(chunks.map((chunk) => chunk.id)),
    termFrequencies: Object.freeze(termFrequencies),
    lengths: Object.freeze(lengths),
    docFreq,
    documentCount: chunks.length,
    avgDocLength: chunks.length === 0 ? 0 : lengthSum / chunks.length,
    k1: BM25_K1,
    b: BM25_B,
  });
}

/** IDF(t) = ln(1 + (N - df + 0.5) / (df + 0.5)). OOV terms (df = 0) get ln(1 + (N + 0.5) / 0.5). */
export function idf(index: Bm25Index, term: string): number {
  const df = index.docFreq.get(term) ?? 0;
  const n = index.documentCount;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/**
 * Okapi BM25 over unique query terms. Returns positive-scoring hits, ties broken by chunk-id codepoints.
 * Empty or all-stopword queries return no hits. An empty corpus or zero mean length never yields NaN.
 */
export function keywordSearch(index: Bm25Index, query: string, topK: number): KeywordHit[] {
  const terms = uniqueTokens(query);
  if (topK <= 0 || index.documentCount === 0 || terms.length === 0) return [];
  const average = index.avgDocLength > 0 ? index.avgDocLength : 1;
  const weights = terms.map((term) => ({ term, weight: idf(index, term) }));
  const scored: { chunkId: string; score: number }[] = [];
  for (let position = 0; position < index.documentCount; position += 1) {
    const frequencies = index.termFrequencies[position];
    const chunkId = index.chunkIds[position];
    if (!frequencies || chunkId === undefined) continue;
    const length = index.lengths[position] ?? 0;
    let score = 0;
    for (const { term, weight } of weights) {
      const frequency = frequencies.get(term) ?? 0;
      if (frequency === 0) continue;
      const denominator = frequency + index.k1 * (1 - index.b + index.b * (length / average));
      score += weight * ((frequency * (index.k1 + 1)) / denominator);
    }
    if (score > 0 && Number.isFinite(score)) scored.push({ chunkId, score });
  }
  scored.sort((left, right) => right.score - left.score || compareCodepoints(left.chunkId, right.chunkId));
  return scored.slice(0, topK).map((hit, position) => ({ ...hit, rank: position + 1 }));
}

/**
 * Keyword sentence coverage (PLAN.md section 5): sum of IDF of matched unique query terms divided by
 * the sum of IDF of ALL retained unique query terms, using the frozen corpus statistics.
 * Returns null when the total weight is empty or non-positive (never NaN, never full acceptance).
 */
export function keywordCoverage(index: Bm25Index, query: string, sentence: string): number | null {
  const terms = uniqueTokens(query);
  if (terms.length === 0) return null;
  const present = new Set(tokenize(sentence));
  let total = 0;
  let matched = 0;
  for (const term of terms) {
    const weight = idf(index, term);
    total += weight;
    if (present.has(term)) matched += weight;
  }
  if (!(total > 0) || !Number.isFinite(total)) return null;
  return matched / total;
}
