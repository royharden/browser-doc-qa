import assert from 'node:assert/strict';
import test from 'node:test';
import expected from './fixtures/pdf/harbor-line.expected.json' with { type: 'json' };
import { harborPages } from '../src/data/harborLine.ts';
import { ActionableError } from '../src/lib/errors.ts';
import { classifyFile, documentFromTextBytes } from '../src/lib/ingest.ts';
import { reconstructPage, type LayoutItem } from '../src/lib/pdfLayout.ts';
import { pagesFromPlainText } from '../src/lib/textExtract.ts';

const item = (str: string, x: number, y: number, width: number, height = 10, hasEOL = false): LayoutItem => ({
  str, transform: [height, 0, 0, height, x, y], width, height, hasEOL,
});
const code = (error: unknown): string => (error instanceof ActionableError ? error.code : 'other');

test('PDF layout keeps line adjacency, paragraphs and bullets', () => {
  const text = reconstructPage([
    item('First line of a', 0, 700, 80), item('paragraph.', 0, 688, 50),
    item('Second paragraph.', 0, 650, 90),
    item('• bullet one', 0, 638, 60), item('• bullet two', 0, 626, 60),
  ]);
  assert.equal(text, 'First line of a\nparagraph.\n\nSecond paragraph.\n• bullet one\n• bullet two');
});

test('PDF layout separates words, keeps wide table columns apart and never alters digits', () => {
  const text = reconstructPage([
    item('Fare', 0, 700, 20), item('3.50', 23, 700, 18), item('Senior', 100, 700, 30), item('10:40', 200, 700, 25),
  ]);
  assert.equal(text, 'Fare 3.50\tSenior\t10:40');
});

test('PDF layout keeps wrap hyphens, expands ligatures and handles empty pages', () => {
  assert.equal(reconstructPage([item('exam-', 0, 700, 30), item('ple of ﬁne text', 0, 688, 80)]), 'exam-ple of fine text');
  assert.equal(reconstructPage([]), '');
  assert.equal(reconstructPage([item('', 0, 700, 0, 10, true)]), '');
});

test('PDF layout honours hasEOL even on the same baseline', () => {
  assert.equal(reconstructPage([item('one', 0, 700, 20, 10, true), item('two', 0, 700, 20)]), 'one\ntwo');
});

test('plain text pages split on form feed and marker lines, numbered in physical order', () => {
  const pages = pagesFromPlainText('﻿Alpha\r\n--- page 9 ---\r\nBeta\fGamma');
  assert.deepEqual(pages, [
    { pageNumber: 1, canonicalText: 'Alpha' },
    { pageNumber: 2, canonicalText: 'Beta' },
    { pageNumber: 3, canonicalText: 'Gamma' },
  ]);
  assert.deepEqual(pagesFromPlainText('Just one page.'), [{ pageNumber: 1, canonicalText: 'Just one page.' }]);
  assert.throws(() => pagesFromPlainText('  \n '), (error: unknown) => code(error) === 'no-text');
});

test('file classification checks size and type before parsing', () => {
  assert.equal(classifyFile('a.PDF', '', 10), 'pdf');
  assert.equal(classifyFile('notes.md', '', 10), 'md');
  assert.equal(classifyFile('notes.txt', '', 10), 'txt');
  assert.throws(() => classifyFile('big.pdf', '', 11 * 1024 * 1024), (error: unknown) => code(error) === 'too-large');
  assert.throws(() => classifyFile('photo.png', 'image/png', 10), (error: unknown) => code(error) === 'unsupported-type');
  assert.throws(() => classifyFile('empty.txt', '', 0), (error: unknown) => code(error) === 'no-text');
});

test('text import rejects invalid UTF-8 and builds a hashed document', () => {
  assert.throws(() => documentFromTextBytes(new Uint8Array([0xff, 0xfe, 0x00]).buffer, 'bad.txt', 'txt'), (error: unknown) => code(error) === 'unsupported-encoding');
  const document = documentFromTextBytes(new TextEncoder().encode('# Title\n\nBody text.').buffer, 'n.md', 'md');
  assert.equal(document.sourceType, 'md');
  assert.equal(document.pages[0]?.canonicalText, '# Title\n\nBody text.');
  assert.ok(document.contentHash.startsWith('fnv64:'));
});

test('the inspected PDF extraction preserves each tutorial sentence and page mapping', () => {
  const pages = harborPages();
  assert.equal(expected.pages.length, pages.length);
  expected.pages.forEach((page, index) => {
    const source = pages[index]?.canonicalText ?? '';
    assert.equal(page.pageNumber, index + 1);
    assert.ok(page.canonicalText.startsWith(page.heading));
    for (const sentence of page.sentences) {
      assert.ok(source.includes(sentence), sentence);
      assert.ok(page.canonicalText.replace(/\s+/g, ' ').includes(sentence), sentence);
    }
  });
  assert.equal(expected.status, 'validated-real-extraction');
  assert.ok(expected.preparation.browser);
  assert.ok(expected.extraction.contentHash.startsWith('fnv64:'));
});
