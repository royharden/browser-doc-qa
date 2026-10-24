import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkPages, validateChunks } from '../src/lib/chunk.ts';
import { CHUNKER_CONFIG } from '../src/lib/config.ts';
import { ActionableError } from '../src/lib/errors.ts';
import type { Chunk, Page } from '../src/domain.ts';

const identity = { documentId: 'doc', corpusRevision: 'rev' };

function assertInvariants(pages: Page[], chunks: Chunk[]): void {
  validateChunks(pages, chunks, CHUNKER_CONFIG);
  for (const chunk of chunks) {
    const page = pages.find((item) => item.pageNumber === chunk.pageNumber);
    assert.ok(page);
    assert.equal(page.canonicalText.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.end - chunk.start <= CHUNKER_CONFIG.maxChars);
  }
}

function sentence(index: number): string {
  return `Sentence number ${index} describes a distinct tool rule in some detail for testing.`;
}

test('a short page is one chunk with exact offsets', () => {
  const pages = [{ pageNumber: 3, canonicalText: 'Pier schedule. Fares apply.' }];
  const chunks = chunkPages(pages, identity);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.pageNumber, 3);
  assert.equal(chunks[0]?.start, 0);
  assert.equal(chunks[0]?.end, pages[0]?.canonicalText.length);
  assertInvariants(pages, chunks);
});

test('chunks never cross pages, stay under the cap, overlap at most 150 and always advance', () => {
  const text = Array.from({ length: 40 }, (_, index) => sentence(index)).join(' ');
  const pages = [
    { pageNumber: 1, canonicalText: text },
    { pageNumber: 2, canonicalText: 'Second page sentence.' },
  ];
  const chunks = chunkPages(pages, identity);
  assertInvariants(pages, chunks);
  const first = chunks.filter((chunk) => chunk.pageNumber === 1);
  assert.ok(first.length >= 3);
  for (let index = 1; index < first.length; index += 1) {
    const previous = first[index - 1];
    const current = first[index];
    assert.ok(previous && current);
    assert.ok(current.end > previous.end, 'each chunk adds uncovered content');
    assert.ok(Math.max(0, previous.end - current.start) <= CHUNKER_CONFIG.overlapChars, 'overlap is bounded');
  }
  assert.equal(chunks.filter((chunk) => chunk.pageNumber === 2).length, 1);
});

test('a sentence longer than the cap splits at whitespace into bounded pieces', () => {
  const longSentence = `${Array.from({ length: 400 }, (_, index) => `word${index}`).join(' ')}.`;
  const pages = [{ pageNumber: 1, canonicalText: longSentence }];
  const chunks = chunkPages(pages, identity);
  assert.ok(chunks.length >= 3);
  assertInvariants(pages, chunks);
  for (const chunk of chunks) assert.ok(!/^\s|\s$/.test(chunk.text));
});

test('an unbroken token falls back to code-unit cuts without splitting a surrogate pair', () => {
  const emoji = '\u{1F600}';
  const token = `${'x'.repeat(899)}${emoji}${'y'.repeat(1200)}`;
  const pages = [{ pageNumber: 1, canonicalText: token }];
  const chunks = chunkPages(pages, identity);
  assertInvariants(pages, chunks);
  for (const chunk of chunks) {
    const last = chunk.text.charCodeAt(chunk.text.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'no chunk ends on a high surrogate');
  }
  assert.equal(chunks.map((chunk) => chunk.text).join(''), token, 'no overlap for oversized units and nothing lost');
});

test('empty pages produce no chunks and whitespace-only content is not invented', () => {
  const pages = [
    { pageNumber: 1, canonicalText: '   \n  ' },
    { pageNumber: 2, canonicalText: 'Real text.' },
  ];
  const chunks = chunkPages(pages, identity);
  assert.deepEqual(chunks.map((chunk) => chunk.pageNumber), [2]);
});

test('invalid chunker config throws an actionable error', () => {
  assert.throws(
    () => chunkPages([{ pageNumber: 1, canonicalText: 'abc' }], identity, { ...CHUNKER_CONFIG, overlapChars: 900 }),
    (error: unknown) => error instanceof ActionableError && error.code === 'bad-chunk-config',
  );
});

test('validateChunks rejects a chunk whose text is not its canonical slice', () => {
  const pages = [{ pageNumber: 1, canonicalText: 'Alpha beta.' }];
  const chunks = chunkPages(pages, identity).map((chunk) => ({ ...chunk, text: 'Alpha  beta.' }));
  assert.throws(() => validateChunks(pages, chunks, CHUNKER_CONFIG), (error: unknown) => error instanceof ActionableError);
});
