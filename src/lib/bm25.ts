import type { Chunk, ScoredHit } from '../domain.ts';
import { BM25_B, BM25_K1 } from './config.ts';
import { tokenize } from './tokenize.ts';

export interface Bm25Index {
  chunks: Chunk[];
  docTokens: string[][];
  docFreq: Map<string, number>;
  avgDocLength: number;
}

export function buildBm25(chunks: Chunk[]): Bm25Index {
  const docTokens = chunks.map((chunk) => tokenize(chunk.text));
  const docFreq = new Map<string, number>();
  let lengthSum = 0;
  for (const tokens of docTokens) {
    lengthSum += tokens.length;
    const seen = new Set(tokens);
    for (const token of seen) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  return {
    chunks,
    docTokens,
    docFreq,
    avgDocLength: chunks.length === 0 ? 0 : lengthSum / chunks.length,
  };
}

/** Okapi BM25. Each query token counts once. Hits with score <= 0 are omitted. */
export function keywordSearch(index: Bm25Index, query: string, topK: number): ScoredHit[] {
  if (topK <= 0 || index.chunks.length === 0) return [];
  const queryTokens = [...new Set(tokenize(query))];
  const documentCount = index.chunks.length;
  const scored: { chunkId: string; score: number }[] = [];

  for (let indexInCorpus = 0; indexInCorpus < documentCount; indexInCorpus += 1) {
    const chunk = index.chunks[indexInCorpus];
    const tokens = index.docTokens[indexInCorpus] ?? [];
    if (!chunk) continue;
    const termFrequency = new Map<string, number>();
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);

    let score = 0;
    const average = index.avgDocLength || 1;
    for (const term of queryTokens) {
      const documentFrequency = index.docFreq.get(term) ?? 0;
      const frequency = termFrequency.get(term) ?? 0;
      if (documentFrequency === 0 || frequency === 0) continue;
      const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (tokens.length / average));
      score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
    }
    if (score > 0) scored.push({ chunkId: chunk.id, score });
  }

  scored.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
  return scored.slice(0, topK).map((hit, rank) => ({ ...hit, rank: rank + 1 }));
}
