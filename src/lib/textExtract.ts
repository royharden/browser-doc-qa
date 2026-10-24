import type { Page } from '../domain.ts';
import { MAX_PAGES } from './config.ts';
import { ActionableError } from './errors.ts';

/** A line that reads exactly `--- page N ---` (N is informational; numbering follows physical order). */
const PAGE_MARKER = /^[ \t]*--- page \d+ ---[ \t]*$/;

/**
 * TXT/Markdown logical pages (PLAN.md section 3): split on form feed or a standalone `--- page N ---`
 * line, otherwise one page. Delimiters are not source text. Pages are numbered 1..n in physical order;
 * a marker's own number is ignored so a mislabelled marker cannot reorder text. Empty logical pages are
 * kept (numbering stays physical). CRLF/CR become LF and a leading BOM is dropped; nothing else changes.
 * Markdown is kept as inert text.
 */
export function pagesFromPlainText(raw: string): Page[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') throw new ActionableError('no-text', 'That file has no text.');
  const parts: string[] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (PAGE_MARKER.test(line)) {
      parts.push(current.join('\n'));
      current = [];
      continue;
    }
    const pieces = line.split('\f');
    current.push(pieces[0] ?? '');
    for (const piece of pieces.slice(1)) {
      parts.push(current.join('\n'));
      current = [piece];
    }
  }
  parts.push(current.join('\n'));
  // A marker or form feed at the very start does not create a leading empty page.
  if (parts.length > 1 && (parts[0] ?? '').trim() === '') parts.shift();
  if (parts.length > MAX_PAGES) {
    throw new ActionableError('too-many-pages', `This file has ${parts.length} pages. The limit is ${MAX_PAGES}.`);
  }
  return parts.map((canonicalText, index) => ({ pageNumber: index + 1, canonicalText }));
}
