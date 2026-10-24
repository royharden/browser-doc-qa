import type { PageText } from '../domain.ts';
import { ActionableError } from './errors.ts';

const PAGE_MARKER = /(?:^|\n)--- page \d+ ---\n/;

/** Split plain text on a form feed or a line that reads `--- page N ---`. Numbers follow section order. */
export function pagesFromPlainText(text: string): PageText[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized === '') {
    throw new ActionableError('empty-document', 'That file has no text.');
  }
  const parts = normalized.split(new RegExp(`${PAGE_MARKER.source}|\\f`));
  const pages: PageText[] = [];
  for (const part of parts) {
    const body = part.trim();
    if (body === '') continue;
    pages.push({ page: pages.length + 1, text: body });
  }
  if (pages.length === 0) {
    throw new ActionableError('empty-document', 'That file has no text.');
  }
  return pages;
}

export function serializePages(pages: PageText[]): string {
  return pages
    .map((page, index) => (index === 0 ? page.text : `--- page ${index + 1} ---\n${page.text}`))
    .join('\n');
}
