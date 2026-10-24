import type { Chunk, ScoredHit } from '../domain.ts';
import { ActionableError } from './errors.ts';

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** Brute-force cosine. Non-positive scores are omitted. Callers apply the abstain threshold separately. */
export function embeddingSearch(
  chunks: Chunk[],
  vectors: number[][],
  queryVector: number[],
  topK: number,
): ScoredHit[] {
  if (vectors.length !== chunks.length) {
    throw new ActionableError(
      'vector-mismatch',
      'Stored vectors do not line up with the current chunks. Embed the document again.',
    );
  }
  if (topK <= 0 || chunks.length === 0) return [];

  const scored: { chunkId: string; score: number }[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const vector = vectors[index];
    if (!chunk || !vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    if (score > 0) scored.push({ chunkId: chunk.id, score });
  }
  scored.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
  return scored.slice(0, topK).map((hit, rank) => ({ ...hit, rank: rank + 1 }));
}
