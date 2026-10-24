import type { Embedder, LoadedDocument, PageText, StoredDocument } from './domain.ts';
import { MAX_CHARS, MAX_CHUNKS, MAX_PAGES } from './lib/config.ts';
import { chunkPages } from './lib/chunk.ts';
import { ActionableError } from './lib/errors.ts';
import { systemClock, type Clock } from './lib/ask.ts';

export function documentFromPages(
  name: string,
  pages: PageText[],
  timings: { extractMs: number },
  identity: { id?: string; savedAt?: string } = {},
  clock: Clock = systemClock(),
): LoadedDocument {
  assertBounds(pages);
  const started = clock.now();
  const chunks = chunkPages(pages);
  const chunkMs = clock.now() - started;
  if (chunks.length === 0) {
    throw new ActionableError('empty-document', 'That document has no extractable text.');
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new ActionableError(
      'too-large',
      `This document produced ${chunks.length} chunks. The limit is ${MAX_CHUNKS}. Split the file and try again.`,
    );
  }
  return {
    id: identity.id ?? newId(),
    name: name.trim() || 'Untitled document',
    savedAt: identity.savedAt ?? new Date().toISOString(),
    pages,
    chunks,
    vectors: null,
    embeddingModel: null,
    embeddingDtype: null,
    embeddingBackend: null,
    extractMs: timings.extractMs,
    chunkMs,
  };
}

export async function embedLoadedDocument(
  document: LoadedDocument,
  embedder: Embedder,
  clock: Clock = systemClock(),
): Promise<{ document: LoadedDocument; embedMs: number }> {
  const started = clock.now();
  const vectors = await embedder.embed(document.chunks.map((chunk) => chunk.text));
  const embedMs = clock.now() - started;
  if (vectors.length !== document.chunks.length) {
    throw new ActionableError(
      'embedding-output-unexpected',
      'The embedding model returned a different number of vectors than chunks. Nothing was saved.',
    );
  }
  const width = vectors[0]?.length ?? 0;
  if (width === 0 || vectors.some((vector) => vector.length !== width)) {
    throw new ActionableError(
      'embedding-output-unexpected',
      'The embedding model returned uneven vectors. Nothing was saved.',
    );
  }
  return {
    embedMs,
    document: {
      ...document,
      vectors,
      embeddingModel: embedder.modelId,
      embeddingDtype: embedder.dtype,
      embeddingBackend: embedder.backend,
    },
  };
}

export function toStored(document: LoadedDocument): StoredDocument {
  return {
    id: document.id,
    name: document.name,
    savedAt: document.savedAt,
    pages: document.pages,
    vectors: document.vectors,
    embeddingModel: document.embeddingModel,
    embeddingDtype: document.embeddingDtype,
    embeddingBackend: document.embeddingBackend,
    extractMs: document.extractMs,
  };
}

export function hydrateStored(stored: StoredDocument, clock: Clock = systemClock()): LoadedDocument {
  const document = documentFromPages(
    stored.name,
    stored.pages,
    { extractMs: stored.extractMs },
    { id: stored.id, savedAt: stored.savedAt },
    clock,
  );
  const vectors = stored.vectors;
  const width = vectors && vectors.length > 0 ? (vectors[0]?.length ?? 0) : 0;
  const aligned = Boolean(
    vectors
    && vectors.length === document.chunks.length
    && width > 0
    && vectors.every((vector) => vector.length === width),
  );
  if (!aligned || !vectors) return document;
  return {
    ...document,
    vectors,
    embeddingModel: stored.embeddingModel,
    embeddingDtype: stored.embeddingDtype,
    embeddingBackend: stored.embeddingBackend,
  };
}

export function assertBounds(pages: PageText[]): void {
  if (pages.length === 0 || pages.every((page) => page.text.trim() === '')) {
    throw new ActionableError('empty-document', 'That document has no extractable text.');
  }
  if (pages.length > MAX_PAGES) {
    throw new ActionableError(
      'too-large',
      `This document has ${pages.length} pages. The limit is ${MAX_PAGES}.`,
    );
  }
  const characters = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (characters > MAX_CHARS) {
    throw new ActionableError(
      'too-large',
      `This document has ${characters} characters. The limit is ${MAX_CHARS}.`,
    );
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
