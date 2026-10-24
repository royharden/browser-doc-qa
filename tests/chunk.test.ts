import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkPages } from '../src/lib/chunk.ts';
import { ActionableError } from '../src/lib/errors.ts';
import type { PageText } from '../src/domain.ts';

test('spans rebuild each chunk and windows overlap inside a page', () => {
  const pages: PageText[] = [
    { page: 1, text: 'abcdefghij' },
    { page: 2, text: 'zzzz' },
  ];
  const chunks = chunkPages(pages, { size: 4, overlap: 1 });
  assert.deepEqual(chunks.map((chunk) => chunk.text), ['abcd', 'defg', 'ghij', 'zzzz']);
  assert.equal(chunks[1]?.pageStart, 1);
  assert.equal(chunks[1]?.pageEnd, 1);
  assert.equal(chunks[3]?.pageStart, 2);
  for (const chunk of chunks) {
    let rebuilt = '';
    for (const span of chunk.spans) {
      const page = pages.find((item) => item.page === span.page);
      rebuilt += page?.text.slice(span.start, span.end) ?? '';
    }
    assert.equal(rebuilt, chunk.text);
  }
});

test('a short page is one chunk', () => {
  const chunks = chunkPages([{ page: 3, text: 'Pier schedule.' }]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.pageStart, 3);
  assert.equal(chunks[0]?.spans[0]?.end, 'Pier schedule.'.length);
});

test('bad chunk options throw', () => {
  assert.throws(
    () => chunkPages([{ page: 1, text: 'abc' }], { size: 10, overlap: 10 }),
    (error: unknown) => error instanceof ActionableError && error.code === 'bad-chunk',
  );
});
