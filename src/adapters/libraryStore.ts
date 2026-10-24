import type { DocumentRecord } from '../domain.ts';
import type { DocumentSummary, LibraryStore, StoredVectorSet, VectorSetLookup } from '../ports.ts';
import { ActionableError, errorMessage } from '../lib/errors.ts';
import { stableStringify } from '../lib/hash.ts';
import { isDocumentRecord, isFiniteNumberArray, isRecord, isStringArray } from '../validate.ts';

const DB_NAME = 'browser-doc-qa';
/**
 * v1 was the unrun Grok schema (documents/meta with an unvalidated StoredDocument shape).
 * v2 migrates explicitly: v1 stores are dropped because their records cannot pass v2 validation.
 */
const DB_VERSION = 2;
const REPORT_KEY = 'last-report';

interface DocumentRow {
  id: string;
  savedAt: string;
  document: DocumentRecord;
}

const clone = <T>(value: T): T => structuredClone(value);

/** Checks a stored vector set against the identity, ids and width the caller expects now. */
export function checkVectorSet(raw: unknown, key: string, identity: Record<string, unknown>, ids: readonly string[], dimensions: number): VectorSetLookup {
  if (raw === undefined || raw === null) return { status: 'miss' };
  if (!isRecord(raw) || raw.key !== key) return { status: 'discarded', reason: 'malformed record' };
  if (!isRecord(raw.identity) || stableStringify(raw.identity) !== stableStringify(identity)) {
    return { status: 'discarded', reason: 'cache identity changed' };
  }
  if (!isStringArray(raw.ids) || raw.ids.length !== ids.length || raw.ids.some((id, index) => id !== ids[index])) {
    return { status: 'discarded', reason: 'ids do not match the current chunks/spans' };
  }
  if (raw.dimensions !== dimensions || !Array.isArray(raw.vectors) || raw.vectors.length !== ids.length) {
    return { status: 'discarded', reason: 'vector count or width changed' };
  }
  if (!raw.vectors.every((vector) => isFiniteNumberArray(vector, dimensions))) {
    return { status: 'discarded', reason: 'non-finite or wrong-width vector' };
  }
  return { status: 'hit', set: clone(raw as unknown as StoredVectorSet) };
}

export function memoryLibrary(warning: string | null = null): LibraryStore {
  const documents = new Map<string, DocumentRow>();
  const vectorSets = new Map<string, StoredVectorSet>();
  let report: unknown = null;
  return {
    kind: 'memory',
    warning,
    async listDocuments() {
      return [...documents.values()].map(summary);
    },
    async getDocument(id) {
      const row = documents.get(id);
      return row && isDocumentRecord(row.document) ? clone(row.document) : null;
    },
    async putDocument(document) {
      documents.set(document.id, { id: document.id, savedAt: new Date().toISOString(), document: clone(document) });
    },
    async deleteDocument(id) {
      documents.delete(id);
      for (const [key, set] of vectorSets) if (set.documentId === id) vectorSets.delete(key);
    },
    async getVectorSet(key, identity, ids, dimensions) {
      const lookup = checkVectorSet(vectorSets.get(key), key, identity, ids, dimensions);
      if (lookup.status === 'discarded') vectorSets.delete(key);
      return lookup;
    },
    async putVectorSet(set) {
      vectorSets.set(set.key, clone(set));
    },
    async getReport() {
      return report === null ? null : clone(report);
    },
    async putReport(next) {
      report = clone(next);
    },
    async clearAll() {
      documents.clear();
      vectorSets.clear();
      report = null;
    },
    close() {},
  };
}

/**
 * Opens IndexedDB only after explicit persistence opt-in. Any failure (private mode, blocked upgrade,
 * unavailable API) falls back to memory with a recoverable warning instead of a broken library.
 */
export async function openPersistentLibrary(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<LibraryStore> {
  if (!factory) return memoryLibrary('This browser has no IndexedDB. Your library stays in memory for this tab.');
  try {
    return indexedLibrary(await openDatabase(factory));
  } catch (error) {
    return memoryLibrary(`Browser storage is unavailable (${errorMessage(error)}). Your library stays in memory for this tab.`);
  }
}

/** Deletes the whole app database (used by "Delete all" when persistence was on). */
export function deleteDatabase(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (!factory) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(mapError(request.error));
    request.onblocked = () => reject(new ActionableError('storage-blocked', 'Close other tabs of this app, then try again.'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 2) {
        for (const legacy of ['documents', 'meta']) if (db.objectStoreNames.contains(legacy)) db.deleteObjectStore(legacy);
        db.createObjectStore('documents', { keyPath: 'id' });
        const vectors = db.createObjectStore('vectorSets', { keyPath: 'key' });
        vectors.createIndex('documentId', 'documentId', { unique: false });
        db.createObjectStore('reports');
      }
    };
    request.onblocked = () => reject(new ActionableError('storage-blocked', 'Another tab is using an older version of this app. Close it and reload.'));
    request.onerror = () => reject(mapError(request.error));
    request.onsuccess = () => resolve(request.result);
  });
}

function indexedLibrary(db: IDBDatabase): LibraryStore {
  let closed = false;
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  db.onclose = () => {
    closed = true;
  };
  const guard = (): void => {
    if (closed) throw new ActionableError('storage-closed', 'Browser storage was closed by another tab. Reload to continue.');
  };

  return {
    kind: 'indexeddb',
    warning: null,
    async listDocuments() {
      guard();
      const rows = await run<unknown[]>(db, ['documents'], 'readonly', (tx) => tx.objectStore('documents').getAll());
      return (rows ?? []).filter(isDocumentRow).map(summary);
    },
    async getDocument(id) {
      guard();
      const row = await run<unknown>(db, ['documents'], 'readonly', (tx) => tx.objectStore('documents').get(id));
      if (row === undefined) return null;
      if (!isDocumentRow(row)) {
        await this.deleteDocument(id);
        return null;
      }
      return row.document;
    },
    async putDocument(document) {
      guard();
      const row: DocumentRow = { id: document.id, savedAt: new Date().toISOString(), document: clone(document) };
      await run(db, ['documents'], 'readwrite', (tx) => tx.objectStore('documents').put(row));
    },
    async deleteDocument(id) {
      guard();
      await run(db, ['documents', 'vectorSets'], 'readwrite', (tx) => {
        tx.objectStore('documents').delete(id);
        const index = tx.objectStore('vectorSets').index('documentId');
        const cursor = index.openKeyCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) return;
          tx.objectStore('vectorSets').delete(current.primaryKey);
          current.continue();
        };
      });
    },
    async getVectorSet(key, identity, ids, dimensions) {
      guard();
      const raw = await run<unknown>(db, ['vectorSets'], 'readonly', (tx) => tx.objectStore('vectorSets').get(key));
      const lookup = checkVectorSet(raw, key, identity, ids, dimensions);
      if (lookup.status === 'discarded') await run(db, ['vectorSets'], 'readwrite', (tx) => tx.objectStore('vectorSets').delete(key));
      return lookup;
    },
    async putVectorSet(set) {
      guard();
      await run(db, ['vectorSets'], 'readwrite', (tx) => tx.objectStore('vectorSets').put(clone(set)));
    },
    async getReport() {
      guard();
      const value = await run<unknown>(db, ['reports'], 'readonly', (tx) => tx.objectStore('reports').get(REPORT_KEY));
      return value ?? null;
    },
    async putReport(report) {
      guard();
      await run(db, ['reports'], 'readwrite', (tx) => tx.objectStore('reports').put(clone(report), REPORT_KEY));
    },
    async clearAll() {
      guard();
      await run(db, ['documents', 'vectorSets', 'reports'], 'readwrite', (tx) => {
        tx.objectStore('documents').clear();
        tx.objectStore('vectorSets').clear();
        tx.objectStore('reports').clear();
      });
    },
    close() {
      closed = true;
      db.close();
    },
  };
}

/**
 * One transaction. complete/error/abort handlers are attached at creation, before any request is
 * issued; the promise settles once, on transaction completion (so writes are durable when it resolves).
 */
function run<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => IDBRequest | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(mapError(error));
      return;
    }
    let result: T | undefined;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(mapError(tx.error));
    tx.onabort = () => reject(mapError(tx.error ?? new Error('Storage transaction aborted.')));
    try {
      const request = body(tx);
      if (request) request.onsuccess = () => { result = request.result as T; };
    } catch (error) {
      try { tx.abort(); } catch { /* already finished */ }
      reject(mapError(error));
    }
  });
}

function mapError(error: unknown): ActionableError {
  const name = error && typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
  if (name === 'QuotaExceededError') return new ActionableError('storage-quota', 'Browser storage is full. Delete saved documents or keep this one in memory.');
  if (name === 'InvalidStateError') return new ActionableError('storage-closed', 'Browser storage was closed. Reload to continue.');
  return new ActionableError('storage-error', `Browser storage failed (${errorMessage(error)}).`);
}

function isDocumentRow(value: unknown): value is DocumentRow {
  return isRecord(value) && typeof value.id === 'string' && typeof value.savedAt === 'string' && isDocumentRecord(value.document) && value.document.id === value.id;
}

function summary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    displayName: row.document.displayName,
    sourceType: row.document.sourceType,
    pageCount: row.document.pages.length,
    savedAt: row.savedAt,
  };
}
