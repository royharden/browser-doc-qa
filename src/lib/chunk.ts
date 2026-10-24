import type { Chunk, ChunkerConfig, Page } from '../domain.ts';
import { CHUNKER_CONFIG } from './config.ts';
import { ActionableError } from './errors.ts';
import { sentenceIntervals, type TextInterval } from './sentences.ts';

export interface ChunkIdentity {
  documentId: string;
  corpusRevision: string;
}

/**
 * The one chunker (PLAN.md section 3). Per page:
 * 1. sentence/paragraph intervals; sentences longer than maxChars split at whitespace, unbroken
 *    tokens at code-unit boundaries that never split a surrogate pair. Atomic units exist after this.
 * 2. pack consecutive units into contiguous canonical slices <= maxChars (original whitespace kept).
 * 3. carry trailing whole units as overlap (<= overlapChars) only when they fit with new content.
 * 4. merge a short tail into its predecessor only when same-page contiguity and the cap hold.
 * 5. validate slice/page/coverage invariants.
 * Chunks never cross pages. Every iteration adds previously uncovered units, so the loop terminates.
 */
export function chunkPages(pages: readonly Page[], identity: ChunkIdentity, config: ChunkerConfig = CHUNKER_CONFIG): Chunk[] {
  assertConfig(config);
  const chunks: Chunk[] = [];
  for (const page of pages) {
    const units = atomicUnits(page.canonicalText, config.maxChars);
    for (const slice of packUnits(units, config)) {
      chunks.push({
        id: chunkId(page.pageNumber, slice.start, slice.end),
        documentId: identity.documentId,
        corpusRevision: identity.corpusRevision,
        pageNumber: page.pageNumber,
        start: slice.start,
        end: slice.end,
        text: page.canonicalText.slice(slice.start, slice.end),
        chunkerVersion: config.version,
        chunkerConfig: config,
      });
    }
  }
  validateChunks(pages, chunks, config);
  return chunks;
}

export function chunkId(pageNumber: number, start: number, end: number): string {
  return `p${String(pageNumber).padStart(3, '0')}:${String(start).padStart(6, '0')}-${String(end).padStart(6, '0')}`;
}

export function atomicUnits(text: string, maxChars: number): TextInterval[] {
  const units: TextInterval[] = [];
  for (const sentence of sentenceIntervals(text)) {
    if (sentence.end - sentence.start <= maxChars) {
      units.push(sentence);
      continue;
    }
    units.push(...splitLong(text, sentence, maxChars));
  }
  return units;
}

/** Split an oversized interval at whitespace; fall back to safe code-unit boundaries for long tokens. */
function splitLong(text: string, interval: TextInterval, maxChars: number): TextInterval[] {
  const pieces: TextInterval[] = [];
  let cursor = interval.start;
  while (cursor < interval.end) {
    while (cursor < interval.end && /\s/.test(text[cursor] ?? '')) cursor += 1;
    if (cursor >= interval.end) break;
    if (interval.end - cursor <= maxChars) {
      pieces.push({ start: cursor, end: interval.end });
      break;
    }
    const limit = cursor + maxChars;
    let cut = -1;
    for (let index = limit; index > cursor; index -= 1) {
      if (/\s/.test(text[index] ?? '')) {
        cut = index;
        break;
      }
    }
    let end: number;
    if (cut > cursor) {
      end = cut;
      while (end > cursor && /\s/.test(text[end - 1] ?? '')) end -= 1;
    } else {
      end = limit;
      if (isLowSurrogate(text.charCodeAt(end)) && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    }
    pieces.push({ start: cursor, end });
    cursor = end;
  }
  return pieces;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function packUnits(units: readonly TextInterval[], config: ChunkerConfig): TextInterval[] {
  const slices: TextInterval[] = [];
  let first = 0; // first unit of the current slice (may be overlap)
  let fresh = 0; // first unit not yet covered by any slice
  while (fresh < units.length) {
    const startUnit = units[first];
    if (!startUnit) break;
    let last = fresh;
    while (last + 1 < units.length && (units[last + 1]?.end ?? 0) - startUnit.start <= config.maxChars) last += 1;
    const endUnit = units[last];
    if (!endUnit) break;
    slices.push({ start: startUnit.start, end: endUnit.end });
    fresh = last + 1;
    const nextFresh = units[fresh];
    if (!nextFresh) break;
    // Overlap: smallest k (> first, <= last) whose trailing span fits overlapChars and still fits with new content.
    let overlapStart = fresh;
    for (let k = last; k > first; k -= 1) {
      const unit = units[k];
      if (!unit) break;
      if (endUnit.end - unit.start > config.overlapChars) break;
      if (nextFresh.end - unit.start > config.maxChars) break;
      overlapStart = k;
    }
    first = overlapStart;
  }
  return mergeTail(slices, config);
}

function mergeTail(slices: TextInterval[], config: ChunkerConfig): TextInterval[] {
  if (slices.length < 2) return slices;
  const tail = slices[slices.length - 1];
  const previous = slices[slices.length - 2];
  if (!tail || !previous) return slices;
  if (tail.end - tail.start >= config.minTailChars) return slices;
  if (tail.end - previous.start > config.maxChars) return slices;
  return [...slices.slice(0, -2), { start: previous.start, end: tail.end }];
}

function assertConfig(config: ChunkerConfig): void {
  const ok = Number.isInteger(config.maxChars)
    && Number.isInteger(config.overlapChars)
    && Number.isInteger(config.minTailChars)
    && config.maxChars > 0
    && config.overlapChars >= 0
    && config.overlapChars < config.maxChars
    && config.minTailChars >= 0;
  if (!ok) throw new ActionableError('bad-chunk-config', 'Chunk size must be a positive integer greater than the overlap.');
}

/** Throws on any broken slice, page, cap or coverage invariant. */
export function validateChunks(pages: readonly Page[], chunks: readonly Chunk[], config: ChunkerConfig): void {
  const byPage = new Map(pages.map((page) => [page.pageNumber, page]));
  const ids = new Set<string>();
  for (const chunk of chunks) {
    const page = byPage.get(chunk.pageNumber);
    if (!page) throw new ActionableError('chunk-invariant', `Chunk ${chunk.id} points at a missing page.`);
    if (chunk.start < 0 || chunk.end > page.canonicalText.length || chunk.end <= chunk.start) {
      throw new ActionableError('chunk-invariant', `Chunk ${chunk.id} has invalid bounds.`);
    }
    if (page.canonicalText.slice(chunk.start, chunk.end) !== chunk.text) {
      throw new ActionableError('chunk-invariant', `Chunk ${chunk.id} text is not its canonical slice.`);
    }
    if (chunk.end - chunk.start > config.maxChars) {
      throw new ActionableError('chunk-invariant', `Chunk ${chunk.id} exceeds ${config.maxChars} code units.`);
    }
    if (ids.has(chunk.id)) throw new ActionableError('chunk-invariant', `Duplicate chunk id ${chunk.id}.`);
    ids.add(chunk.id);
  }
  for (const page of pages) {
    const covered = chunks.filter((chunk) => chunk.pageNumber === page.pageNumber);
    for (const unit of atomicUnits(page.canonicalText, config.maxChars)) {
      const inside = covered.some((chunk) => chunk.start <= unit.start && chunk.end >= unit.end);
      if (!inside) throw new ActionableError('chunk-invariant', `Page ${page.pageNumber} content at ${unit.start} is not covered.`);
    }
  }
}
