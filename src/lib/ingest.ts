import type { DocumentRecord } from '../domain.ts';
import { makeDocument } from '../session.ts';
import { EXTRACTION_VERSION_TEXT, MAX_INPUT_BYTES } from './config.ts';
import { ActionableError } from './errors.ts';
import { pagesFromPlainText } from './textExtract.ts';

export type ImportKind = 'pdf' | 'txt' | 'md';

/** Decides the import path from name/MIME/size BEFORE any bytes are parsed. */
export function classifyFile(name: string, mime: string, size: number): ImportKind {
  if (size > MAX_INPUT_BYTES) {
    throw new ActionableError('too-large', `This file is ${(size / 1024 / 1024).toFixed(1)} MiB. The limit is ${MAX_INPUT_BYTES / 1024 / 1024} MiB.`);
  }
  if (size === 0) throw new ActionableError('no-text', 'That file is empty.');
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || mime === 'text/markdown') return 'md';
  if (lower.endsWith('.txt') || mime === 'text/plain') return 'txt';
  throw new ActionableError('unsupported-type', 'Only PDF, TXT and Markdown files are supported.');
}

/** UTF-8 TXT/Markdown bytes to a document. Invalid UTF-8 is rejected rather than guessed. */
export function documentFromTextBytes(bytes: ArrayBuffer, displayName: string, kind: 'txt' | 'md'): DocumentRecord {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ActionableError('unsupported-encoding', 'This file is not valid UTF-8 text. Save it as UTF-8 and try again.');
  }
  return makeDocument({
    displayName,
    sourceType: kind,
    extractionVersion: EXTRACTION_VERSION_TEXT,
    pages: pagesFromPlainText(text),
  });
}
