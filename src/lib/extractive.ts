import type { Chunk, CitedSentence, ScoredHit } from '../domain.ts';
import { tokenize } from './tokenize.ts';
import { formatAnswer, normalizeSpace, splitSentences } from './sentences.ts';

export interface ExtractiveAnswer {
  abstained: boolean;
  reason?: string;
  sentences: CitedSentence[];
  text: string;
}

export function sentenceOverlap(query: string, sentence: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const sentenceTokens = new Set(tokenize(sentence));
  let hits = 0;
  for (const token of queryTokens) {
    if (sentenceTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.size;
}

export function extractiveAnswer(
  query: string,
  hits: ScoredHit[],
  chunks: Map<string, Chunk>,
  abstain: boolean,
): ExtractiveAnswer {
  if (abstain || hits.length === 0) {
    return {
      abstained: true,
      reason: 'No passage cleared the abstain rule.',
      sentences: [],
      text: '',
    };
  }

  const candidates: { score: number; rank: number; chunkId: string; text: string }[] = [];
  for (const hit of hits.slice(0, 3)) {
    const chunk = chunks.get(hit.chunkId);
    if (!chunk) continue;
    const haystack = normalizeSpace(chunk.text);
    for (const sentence of splitSentences(chunk.text)) {
      const score = sentenceOverlap(query, sentence);
      if (score <= 0) continue;
      if (!haystack.includes(normalizeSpace(sentence))) continue;
      candidates.push({ score, rank: hit.rank, chunkId: hit.chunkId, text: sentence });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.rank - right.rank);
  const picked = candidates.slice(0, 2);
  if (picked.length === 0) {
    return {
      abstained: true,
      reason: 'Retrieved passages do not contain a sentence that overlaps the question.',
      sentences: [],
      text: '',
    };
  }
  const sentences = picked.map((candidate) => ({
    text: candidate.text,
    citation: candidate.rank,
    chunkId: candidate.chunkId,
  }));
  return { abstained: false, sentences, text: formatAnswer(sentences) };
}
