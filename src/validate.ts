import type { DocumentRecord, Page, SourceType } from './domain.ts';
import { MAX_CANONICAL_CHARS, MAX_PAGES } from './lib/config.ts';
import { pagesHash } from './lib/hash.ts';

/**
 * Runtime validators for data crossing a trust boundary (IndexedDB reads, worker replies, imports).
 * Stored data is never trusted because it was written by an earlier version or another tab.
 */

const SOURCE_TYPES: readonly SourceType[] = ['pdf', 'txt', 'md', 'fixture'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPage(value: unknown): value is Page {
  return isRecord(value)
    && typeof value.pageNumber === 'number'
    && Number.isInteger(value.pageNumber)
    && value.pageNumber >= 1
    && typeof value.canonicalText === 'string';
}

/** Full DocumentRecord check, including the content hash recomputed from the pages. */
export function isDocumentRecord(value: unknown): value is DocumentRecord {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.contentHash !== 'string' || typeof value.displayName !== 'string') return false;
  if (typeof value.extractionVersion !== 'string') return false;
  if (!SOURCE_TYPES.includes(value.sourceType as SourceType)) return false;
  if (!Array.isArray(value.pages) || value.pages.length === 0 || value.pages.length > MAX_PAGES) return false;
  if (!value.pages.every(isPage)) return false;
  if (!Array.isArray(value.emptyPages) || !value.emptyPages.every((n) => typeof n === 'number')) return false;
  const pages = value.pages as Page[];
  if (pages.reduce((sum, page) => sum + page.canonicalText.length, 0) > MAX_CANONICAL_CHARS) return false;
  if (new Set(pages.map((page) => page.pageNumber)).size !== pages.length) return false;
  return pagesHash(pages) === value.contentHash;
}

export function isFiniteNumberArray(value: unknown, length?: number): value is number[] {
  return Array.isArray(value)
    && (length === undefined || value.length === length)
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
