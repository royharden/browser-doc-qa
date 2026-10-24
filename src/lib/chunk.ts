import type { Chunk, PageText } from '../domain.ts';
import { CHUNK_OVERLAP, CHUNK_SIZE } from './config.ts';
import { ActionableError } from './errors.ts';

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export function chunkPages(pages: PageText[], options: ChunkOptions = {}): Chunk[] {
  const size = options.size ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  if (!Number.isInteger(size) || !Number.isInteger(overlap) || size <= 0 || overlap < 0 || overlap >= size) {
    throw new ActionableError('bad-chunk', 'Chunk size must be a positive integer greater than the overlap.');
  }

  const chunks: Chunk[] = [];
  for (const page of pages) {
    if (page.text.trim() === '') continue;
    for (const window of windows(page.text, size, overlap)) {
      chunks.push({
        id: `c${chunks.length}`,
        text: window.text,
        pageStart: page.page,
        pageEnd: page.page,
        spans: [{ page: page.page, start: window.start, end: window.end }],
      });
    }
  }
  return chunks;
}

function windows(text: string, size: number, overlap: number): { text: string; start: number; end: number }[] {
  const step = size - overlap;
  const found: { text: string; start: number; end: number }[] = [];
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + size);
    const slice = text.slice(start, end);
    if (slice.trim() !== '') found.push({ text: slice, start, end });
    if (end >= text.length) break;
  }
  return found;
}
