import type { Chunk, ChunkerConfig, DocumentRecord, Page, SourceType } from './domain.ts';
import { buildBm25, type Bm25Index } from './lib/bm25.ts';
import { chunkPages } from './lib/chunk.ts';
import {
  BM25_B,
  BM25_K1,
  CHUNKER_CONFIG,
  FUSION_POOL,
  MAX_CANONICAL_CHARS,
  MAX_CHUNKS,
  MAX_PAGES,
  RETRIEVE_K,
  RRF_K,
  TOKENIZER_VERSION,
} from './lib/config.ts';
import { ActionableError } from './lib/errors.ts';
import { fingerprint, pagesHash } from './lib/hash.ts';

/**
 * A corpus revision: one document's canonical pages, its chunks and its immutable keyword index.
 * Any change to extraction, chunking or retrieval config produces a new revision; dense indexes and
 * evaluation results are keyed by it and never reused across revisions.
 */
export interface Corpus {
  readonly document: DocumentRecord;
  readonly revision: string;
  readonly configFingerprint: string;
  readonly chunks: readonly Chunk[];
  readonly chunkById: ReadonlyMap<string, Chunk>;
  readonly pageByNumber: ReadonlyMap<number, Page>;
  readonly bm25: Bm25Index;
  readonly chunkMs: number;
  readonly bm25Ms: number;
}

export interface DocumentInput {
  id?: string;
  displayName: string;
  sourceType: SourceType;
  extractionVersion: string;
  pages: Page[];
}

export function retrievalConfig(chunker: ChunkerConfig): Record<string, unknown> {
  return {
    chunker,
    tokenizer: TOKENIZER_VERSION,
    bm25: { k1: BM25_K1, b: BM25_B },
    rrf: { k: RRF_K, pool: FUSION_POOL, topK: RETRIEVE_K },
  };
}

/** Builds a DocumentRecord after enforcing page/text limits. Empty pages are kept and listed. */
export function makeDocument(input: DocumentInput): DocumentRecord {
  assertPageBounds(input.pages);
  const contentHash = pagesHash(input.pages);
  return {
    id: input.id ?? contentHash,
    contentHash,
    displayName: input.displayName.trim() || 'Untitled document',
    sourceType: input.sourceType,
    extractionVersion: input.extractionVersion,
    pages: input.pages.map((page) => ({ pageNumber: page.pageNumber, canonicalText: page.canonicalText })),
    emptyPages: input.pages.filter((page) => page.canonicalText.trim() === '').map((page) => page.pageNumber),
  };
}

export function buildCorpus(
  document: DocumentRecord,
  now: () => number,
  chunker: ChunkerConfig = CHUNKER_CONFIG,
): Corpus {
  const configFingerprint = fingerprint(retrievalConfig(chunker));
  const revision = fingerprint({
    contentHash: document.contentHash,
    extractionVersion: document.extractionVersion,
    configFingerprint,
  });
  const chunkStarted = now();
  const chunks = chunkPages(document.pages, { documentId: document.id, corpusRevision: revision }, chunker);
  const chunkMs = now() - chunkStarted;
  if (chunks.length === 0) throw new ActionableError('empty-document', 'That document has no usable text.');
  if (chunks.length > MAX_CHUNKS) {
    throw new ActionableError(
      'too-many-chunks',
      `This document produced ${chunks.length} chunks. The limit is ${MAX_CHUNKS}. Split the file and try again.`,
    );
  }
  const bm25Started = now();
  const bm25 = buildBm25(chunks, revision);
  const bm25Ms = now() - bm25Started;
  return Object.freeze({
    document,
    revision,
    configFingerprint,
    chunks: Object.freeze(chunks),
    chunkById: new Map(chunks.map((chunk) => [chunk.id, chunk])),
    pageByNumber: new Map(document.pages.map((page) => [page.pageNumber, page])),
    bm25,
    chunkMs,
    bm25Ms,
  });
}

export function assertPageBounds(pages: readonly Page[]): void {
  if (pages.length > MAX_PAGES) {
    throw new ActionableError('too-many-pages', `This document has ${pages.length} pages. The limit is ${MAX_PAGES}.`);
  }
  if (pages.length === 0 || pages.every((page) => page.canonicalText.trim() === '')) {
    throw new ActionableError('no-text', 'That document has no extractable text. Scanned or image-only files need OCR, which this app does not do.');
  }
  let characters = 0;
  for (const page of pages) {
    characters += page.canonicalText.length;
    if (characters > MAX_CANONICAL_CHARS) {
      throw new ActionableError(
        'too-much-text',
        `This document has more than ${MAX_CANONICAL_CHARS} characters of text. Split the file and try again.`,
      );
    }
  }
  const seen = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || seen.has(page.pageNumber)) {
      throw new ActionableError('bad-pages', 'Page numbers must be unique positive integers.');
    }
    seen.add(page.pageNumber);
  }
}
