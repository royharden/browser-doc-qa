import type { DocumentRecord } from '../domain.ts';
import type { Clock, ExtractProgress, PdfExtractor } from '../ports.ts';
import { ActionableError } from '../lib/errors.ts';
import { classifyFile, documentFromTextBytes } from '../lib/ingest.ts';

export interface FileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Reads a user-selected local file. The size/type check happens before reading any bytes. */
export async function importLocalFile(
  file: FileLike,
  extractor: PdfExtractor,
  signal: AbortSignal,
  clock: Clock,
  onProgress?: (progress: ExtractProgress) => void,
): Promise<{ document: DocumentRecord; readMs: number; extractMs: number }> {
  const kind = classifyFile(file.name, file.type, file.size);
  const readStarted = clock.now();
  const bytes = await file.arrayBuffer();
  const readMs = clock.now() - readStarted;
  if (signal.aborted) throw new ActionableError('cancelled', 'Import was cancelled.');
  const extractStarted = clock.now();
  const document = kind === 'pdf'
    ? await extractor.extract(bytes, file.name, signal, onProgress)
    : documentFromTextBytes(bytes, file.name, kind);
  return { document, readMs, extractMs: clock.now() - extractStarted };
}
