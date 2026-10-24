import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenize } from '../src/lib/tokenize.ts';
import { sentenceIntervals } from '../src/lib/sentences.ts';
import { identityHash, stableStringify } from '../src/lib/hash.ts';

const sentences = (text: string): string[] => sentenceIntervals(text).map((span) => text.slice(span.start, span.end));

test('tokenizer keeps times, decimals, single digits and technical symbols', () => {
  assert.deepEqual(tokenize('What is the Pier 10:40?'), ['pier', '10:40']);
  assert.deepEqual(tokenize('C++ and C# in v1.5 cost 3.50'), ['c++', 'c#', 'v1.5', 'cost', '3.50']);
  assert.deepEqual(tokenize('a 7 b'), ['7']);
  assert.deepEqual(tokenize('1,000 dollars'), ['1000', 'dollars']);
});

test('tokenizer keeps negations and folds accents and case', () => {
  assert.deepEqual(tokenize('Not without NEVER no'), ['not', 'without', 'never', 'no']);
  assert.deepEqual(tokenize('Café résumé'), ['cafe', 'resume']);
  assert.deepEqual(tokenize('the of and'), []);
});

test('sentence splitter respects abbreviations, decimals, times, URLs and emails', () => {
  assert.deepEqual(sentences('The fare is 3.50 dollars. Call Dr. Smith at 10:40 p.m. Then leave.'), [
    'The fare is 3.50 dollars.',
    'Call Dr. Smith at 10:40 p.m.',
    'Then leave.',
  ]);
  assert.deepEqual(sentences('Write to help@example.com or visit www.example.org today. Thanks.'), [
    'Write to help@example.com or visit www.example.org today.',
    'Thanks.',
  ]);
  assert.deepEqual(sentences('Bring tools, e.g. a saw. Done'), ['Bring tools, e.g. a saw.', 'Done']);
  assert.deepEqual(sentences('Open 9:00 a.m. to 4:00 p.m. and later.'), ['Open 9:00 a.m. to 4:00 p.m. and later.']);
});

test('sentence splitter breaks paragraphs and bullets but joins wrapped lines', () => {
  assert.deepEqual(sentences('Title\n\nFirst line wraps\nonto the next. Second.\n- bullet one\n- bullet two'), [
    'Title',
    'First line wraps\nonto the next.',
    'Second.',
    '- bullet one',
    '- bullet two',
  ]);
});

test('sentence intervals are exact slices of the original text', () => {
  const text = '  Leading space.   Trailing gap.  ';
  for (const span of sentenceIntervals(text)) {
    assert.equal(text.slice(span.start, span.end).trim(), text.slice(span.start, span.end));
  }
});

test('identity hash is deterministic and stable stringify ignores key order', () => {
  assert.equal(identityHash('abc'), identityHash('abc'));
  assert.notEqual(identityHash('abc'), identityHash('abd'));
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});
