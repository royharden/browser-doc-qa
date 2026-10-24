import type { Chunk, ScoredHit } from '../domain.ts';
import { COSINE_ABSTAIN_BELOW, FUSION_POOL, RETRIEVE_K } from './config.ts';
import { buildBm25, keywordSearch } from './bm25.ts';
import { embeddingSearch } from './vector.ts';
import { reciprocalRankFusion } from './rrf.ts';

export function keywordHits(chunks: Chunk[], query: string, topK = RETRIEVE_K): ScoredHit[] {
  return keywordSearch(buildBm25(chunks), query, topK);
}

export function embeddingHits(
  chunks: Chunk[],
  vectors: number[][],
  queryVector: number[],
  topK = RETRIEVE_K,
): ScoredHit[] {
  return embeddingSearch(chunks, vectors, queryVector, topK);
}

export function hybridHits(keyword: ScoredHit[], embedding: ScoredHit[], topK = RETRIEVE_K): ScoredHit[] {
  const fused = reciprocalRankFusion(
    [keyword.map((hit) => hit.chunkId), embedding.map((hit) => hit.chunkId)],
  );
  return fused.slice(0, topK).map((hit, index) => ({
    chunkId: hit.id,
    score: hit.score,
    rank: index + 1,
  }));
}

export function keywordAbstained(hits: ScoredHit[]): boolean {
  return hits.length === 0;
}

export function embeddingAbstained(hits: ScoredHit[]): boolean {
  const top = hits[0];
  if (!top) return true;
  return top.score < COSINE_ABSTAIN_BELOW;
}

export function hybridAbstained(keywordStopped: boolean, embeddingStopped: boolean): boolean {
  return keywordStopped && embeddingStopped;
}

export function fusionPool(): number {
  return FUSION_POOL;
}
