import type { Hit } from '../domain.ts';
import type { Corpus } from '../session.ts';
import { keywordSearch, type KeywordHit } from './bm25.ts';
import { FUSION_POOL, RETRIEVE_K, RRF_K } from './config.ts';
import { ActionableError } from './errors.ts';
import { reciprocalRankFusion } from './rrf.ts';
import { denseSearch, type DenseHit, type Vector } from './vector.ts';

/**
 * Pure ranking over immutable per-revision indexes. Hybrid = top20 keyword + top20 dense -> plain RRF
 * (k=60) -> stable sort -> top5, keeping every candidate's component rank/score provenance.
 * Display and answers never alter these measured lists.
 */

export function keywordCandidates(corpus: Corpus, query: string, depth = FUSION_POOL): KeywordHit[] {
  return keywordSearch(corpus.bm25, query, depth);
}

export function denseCandidates(corpus: Corpus, vectors: readonly Vector[], queryVector: Vector, depth = FUSION_POOL): DenseHit[] {
  return denseSearch(corpus.chunks.map((chunk) => chunk.id), vectors, queryVector, depth);
}

export function keywordHits(corpus: Corpus, candidates: readonly KeywordHit[], topK = RETRIEVE_K): Hit[] {
  return candidates.slice(0, topK).map((candidate, index) => toHit(corpus, candidate.chunkId, index + 1, {
    keyword: { rank: candidate.rank, score: candidate.score },
    dense: null,
    fused: null,
  }));
}

export function denseHits(corpus: Corpus, candidates: readonly DenseHit[], topK = RETRIEVE_K): Hit[] {
  return candidates.slice(0, topK).map((candidate, index) => toHit(corpus, candidate.chunkId, index + 1, {
    keyword: null,
    dense: { rank: candidate.rank, score: candidate.score },
    fused: null,
  }));
}

export function fuseHits(
  corpus: Corpus,
  keyword: readonly KeywordHit[],
  dense: readonly DenseHit[],
  topK = RETRIEVE_K,
  pool = FUSION_POOL,
): Hit[] {
  const keywordPool = keyword.slice(0, pool);
  const densePool = dense.slice(0, pool);
  const keywordById = new Map(keywordPool.map((hit) => [hit.chunkId, hit]));
  const denseById = new Map(densePool.map((hit) => [hit.chunkId, hit]));
  const fused = reciprocalRankFusion([keywordPool.map((hit) => hit.chunkId), densePool.map((hit) => hit.chunkId)], RRF_K);
  return fused.slice(0, topK).map((entry, index) => {
    const k = keywordById.get(entry.id);
    const d = denseById.get(entry.id);
    return toHit(corpus, entry.id, index + 1, {
      keyword: k ? { rank: k.rank, score: k.score } : null,
      dense: d ? { rank: d.rank, score: d.score } : null,
      fused: { rank: index + 1, score: entry.score },
    });
  });
}

function toHit(corpus: Corpus, chunkId: string, rank: number, scores: Pick<Hit, 'keyword' | 'dense' | 'fused'>): Hit {
  const chunk = corpus.chunkById.get(chunkId);
  if (!chunk) throw new ActionableError('stale-hit', `Hit ${chunkId} is not in corpus revision ${corpus.revision}.`);
  return {
    chunkId,
    pageNumber: chunk.pageNumber,
    start: chunk.start,
    end: chunk.end,
    keyword: scores.keyword,
    dense: scores.dense,
    fused: scores.fused,
    via: { keyword: scores.keyword !== null, dense: scores.dense !== null },
    rank,
    corpusRevision: corpus.revision,
    configFingerprint: corpus.configFingerprint,
  };
}
