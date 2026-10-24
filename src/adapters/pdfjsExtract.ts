import type { DocumentRecord, Page } from '../domain.ts';
import type { ExtractProgress, PdfExtractor } from '../ports.ts';
import { EXTRACTION_VERSION_PDF, MAX_CANONICAL_CHARS, MAX_INPUT_BYTES, MAX_PAGES } from '../lib/config.ts';
import { ActionableError, errorMessage } from '../lib/errors.ts';
import { reconstructPage, type LayoutItem } from '../lib/pdfLayout.ts';
import { makeDocument } from '../session.ts';

/**
 * PDF.js adapter: local bytes only, Vite-bundled worker (never a CDN worker), isEvalSupported:false,
 * no scripting, no XFA, no URL fetching, no OCR. Exact pdfjs-dist version/advisories are an activation
 * task (PLAN.md section 3); the API used here is the documented v4 getDocument/getTextContent surface.
 */
export function pdfjsExtractor(): PdfExtractor {
  return {
    async extract(bytes, displayName, signal, onProgress) {
      if (bytes.byteLength > MAX_INPUT_BYTES) {
        throw new ActionableError('too-large', `This file is larger than ${MAX_INPUT_BYTES / 1024 / 1024} MiB.`);
      }
      const pdfjs = await loadPdfjs();
      throwIfAborted(signal);
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes.slice(0)),
        isEvalSupported: false,
        enableXfa: false,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
        stopAtErrors: false,
      });
      const abort = (): void => { void task.destroy(); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const pdf = await task.promise.catch((error: unknown) => { throw classifyOpenError(error); });
        throwIfAborted(signal);
        if (pdf.numPages > MAX_PAGES) {
          throw new ActionableError('too-many-pages', `This PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES}.`);
        }
        const pages: Page[] = [];
        let characters = 0;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          throwIfAborted(signal);
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent({ includeMarkedContent: false });
          const items = content.items.filter(isTextItem);
          const canonicalText = reconstructPage(items);
          characters += canonicalText.length;
          if (characters > MAX_CANONICAL_CHARS) {
            throw new ActionableError('too-much-text', `This PDF has more than ${MAX_CANONICAL_CHARS} characters of text. Split the file and try again.`);
          }
          pages.push({ pageNumber, canonicalText });
          page.cleanup();
          onProgress?.({ pagesDone: pageNumber, pagesTotal: pdf.numPages } satisfies ExtractProgress);
        }
        if (pages.every((page) => page.canonicalText.trim() === '')) {
          throw new ActionableError(
            'scanned-or-image-only',
            'This PDF has no extractable text. It may be scanned or image-only; this app does not do OCR.',
          );
        }
        const document: DocumentRecord = makeDocument({
          displayName,
          sourceType: 'pdf',
          extractionVersion: EXTRACTION_VERSION_PDF,
          pages,
        });
        return document;
      } finally {
        signal.removeEventListener('abort', abort);
        void task.destroy();
      }
    },
  };
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy(): Promise<void>;
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
}

interface PdfPageProxy {
  getTextContent(options: { includeMarkedContent: boolean }): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    try {
      const [module, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      const pdfjs = module as unknown as PdfjsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      return pdfjs;
    } catch (error) {
      pdfjsPromise = null;
      throw new ActionableError('pdf-library-missing', `The PDF reader could not load (${errorMessage(error)}). TXT and Markdown still work.`);
    }
  })();
  return pdfjsPromise;
}

function isTextItem(item: unknown): item is LayoutItem {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  return typeof record.str === 'string' && Array.isArray(record.transform) && typeof record.width === 'number';
}

function classifyOpenError(error: unknown): ActionableError {
  const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
  if (name === 'PasswordException') return new ActionableError('encrypted', 'This PDF is password-protected. Remove the password and try again.');
  if (name === 'InvalidPDFException') return new ActionableError('corrupt', 'This file is not a readable PDF. It may be damaged.');
  if (name === 'AbortException') return new ActionableError('cancelled', 'Import was cancelled.');
  return new ActionableError('unsupported-pdf', `This PDF could not be opened (${errorMessage(error)}).`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new ActionableError('cancelled', 'Import was cancelled.');
}
