import type { Chunk, CitedSentence, ScoredHit } from '../domain.ts';
import { tokenize } from './tokenize.ts';
import { formatAnswer, normalizeSpace, splitSentences } from './sentences.ts';
import type { ExtractiveAnswer } from './extractive.ts';

const DECLINE = /^i don't know\.?$/i;

export function buildGroundedPrompt(query: string, hits: Array<{ rank: number; text: string }>): string {
  const passages = hits.map((hit) => `[${hit.rank}] ${hit.text}`).join('\n\n');
  return `Question: ${query}\n\nPassages:\n${passages}`;
}

/** Keep model sentences that are copied from, or strongly overlap, a retrieved chunk. Drop the rest. */
export function groundGeneratedText(
  text: string,
  hits: ScoredHit[],
  chunks: Map<string, Chunk>,
): ExtractiveAnswer {
  const trimmed = text.trim().slice(0, 2000);
  if (trimmed === '' || DECLINE.test(trimmed)) {
    return {
      abstained: true,
      reason: 'The local model declined to answer from the passages.',
      sentences: [],
      text: '',
    };
  }

  const kept: CitedSentence[] = [];
  for (const sentence of splitSentences(trimmed)) {
    if (DECLINE.test(sentence.trim())) continue;
    const cleaned = sentence.replace(/\s*\[\d+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const hinted = citationHint(sentence);
    const grounded = findGroundedHit(cleaned, hits, chunks, hinted);
    if (!grounded) continue;
    kept.push({ text: cleaned, citation: grounded.rank, chunkId: grounded.chunkId });
  }

  if (kept.length === 0) {
    return {
      abstained: true,
      reason: 'Nothing in the local model reply is grounded in a retrieved passage.',
      sentences: [],
      text: '',
    };
  }
  return { abstained: false, sentences: kept, text: formatAnswer(kept) };
}

function citationHint(sentence: string): number | null {
  const match = /\[(\d+)\]/.exec(sentence);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function findGroundedHit(
  sentence: string,
  hits: ScoredHit[],
  chunks: Map<string, Chunk>,
  hintedRank: number | null,
): ScoredHit | null {
  const ordered = [...hits].sort((left, right) => {
    if (hintedRank === null) return left.rank - right.rank;
    if (left.rank === hintedRank) return -1;
    if (right.rank === hintedRank) return 1;
    return left.rank - right.rank;
  });
  for (const hit of ordered) {
    const chunk = chunks.get(hit.chunkId);
    if (!chunk) continue;
    if (chunkContains(chunk, sentence) || tokenGrounded(sentence, chunk)) return hit;
  }
  return null;
}

function chunkContains(chunk: Chunk, sentence: string): boolean {
  return normalizeSpace(chunk.text).includes(normalizeSpace(sentence));
}

function tokenGrounded(sentence: string, chunk: Chunk): boolean {
  const content = tokenize(sentence).filter((token) => token.length >= 4);
  if (content.length < 2) return false;
  const haystack = new Set(tokenize(chunk.text));
  let hits = 0;
  for (const token of content) {
    if (haystack.has(token)) hits += 1;
  }
  return hits / content.length >= 0.5;
}
