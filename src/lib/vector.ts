import { compareCodepoints } from './hash.ts';
import { ActionableError } from './errors.ts';

export type Vector = Float32Array | readonly number[];

export const NORM_TOLERANCE = 1e-3;

/**
 * Validates a model output vector before it is published or reused: exact dimension, all finite,
 * nonzero norm and unit length within tolerance. Invalid vectors are errors, never silent zero scores.
 */
export function validateVector(vector: Vector, dimensions: number, label: string): void {
  if (vector.length !== dimensions) {
    throw new ActionableError('vector-invalid', `${label}: expected ${dimensions} components, got ${vector.length}.`);
  }
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? Number.NaN;
    if (!Number.isFinite(value)) throw new ActionableError('vector-invalid', `${label}: component ${index} is not finite.`);
    norm += value * value;
  }
  if (norm === 0) throw new ActionableError('vector-invalid', `${label}: zero vector.`);
  if (Math.abs(Math.sqrt(norm) - 1) > NORM_TOLERANCE) {
    throw new ActionableError('vector-invalid', `${label}: vector is not normalized (norm ${Math.sqrt(norm).toFixed(4)}).`);
  }
}

export function validateVectors(vectors: readonly Vector[], expectedCount: number, dimensions: number, label: string): void {
  if (vectors.length !== expectedCount) {
    throw new ActionableError('vector-invalid', `${label}: expected ${expectedCount} vectors, got ${vectors.length}.`);
  }
  vectors.forEach((vector, index) => validateVector(vector, dimensions, `${label} #${index}`));
}

/** Exact dot product. For validated normalized vectors this is cosine similarity. */
export function dot(left: Vector, right: Vector): number {
  if (left.length !== right.length) {
    throw new ActionableError('vector-invalid', `Dimension mismatch: ${left.length} vs ${right.length}.`);
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += (left[index] ?? 0) * (right[index] ?? 0);
  return sum;
}

export interface DenseHit {
  chunkId: string;
  score: number;
  rank: number;
}

/** Brute-force cosine over validated vectors aligned with chunkIds. Ties break on chunk-id codepoints. */
export function denseSearch(chunkIds: readonly string[], vectors: readonly Vector[], query: Vector, topK: number): DenseHit[] {
  if (vectors.length !== chunkIds.length) {
    throw new ActionableError('vector-mismatch', 'Vectors do not line up with the current chunks. Rebuild the dense index.');
  }
  if (topK <= 0) return [];
  const scored = chunkIds.map((chunkId, index) => {
    const vector = vectors[index];
    if (!vector) throw new ActionableError('vector-mismatch', `Missing vector for ${chunkId}.`);
    return { chunkId, score: dot(query, vector) };
  });
  scored.sort((left, right) => right.score - left.score || compareCodepoints(left.chunkId, right.chunkId));
  return scored.slice(0, topK).map((hit, position) => ({ ...hit, rank: position + 1 }));
}
