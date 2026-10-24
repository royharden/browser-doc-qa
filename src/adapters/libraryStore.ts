import type { LoadedDocument, MeasurementReport } from '../domain.ts';
import { isMeasurementReport } from '../lib/measure.ts';
import { errorMessage } from '../lib/errors.ts';
import { hydrateStored, toStored } from '../session.ts';

export interface LibraryStore {
  kind: 'indexeddb' | 'memory';
  warning: string | null;
  list(): Promise<LoadedDocument[]>;
  get(id: string): Promise<LoadedDocument | null>;
  put(document: LoadedDocument): Promise<void>;
  delete(id: string): Promise<void>;
  saveReport(report: MeasurementReport): Promise<void>;
  loadReport(): Promise<MeasurementReport | null>;
}

const DB_NAME = 'browser-doc-qa';
const DB_VERSION = 1;
const REPORT_KEY = 'last-report';

export function memoryLibrary(warning: string | null = null): LibraryStore {
  const documents = new Map<string, ReturnType<typeof toStored>>();
  let report: MeasurementReport | null = null;
  return {
    kind: 'memory',
    warning,
    async list() {
      return [...documents.values()].map((stored) => hydrateStored(stored));
    },
    async get(id) {
      const stored = documents.get(id);
      return stored ? hydrateStored(stored) : null;
    },
    async put(document) {
      documents.set(document.id, toStored(document));
    },
    async delete(id) {
      documents.delete(id);
    },
    async saveReport(next) {
      report = next;
    },
    async loadReport() {
      return report && isMeasurementReport(report) ? report : null;
    },
  };
}

export async function openBrowserLibrary(): Promise<LibraryStore> {
  if (typeof indexedDB === 'undefined') {
    return memoryLibrary('This browser has no IndexedDB. The library stays in memory for this tab.');
  }
  try {
    const db = await openDatabase(indexedDB);
    return indexedLibrary(db);
  } catch (error) {
    return memoryLibrary(`IndexedDB did not open (${errorMessage(error)}). The library stays in memory for this tab.`);
  }
}

function indexedLibrary(db: IDBDatabase): LibraryStore {
  return {
    kind: 'indexeddb',
    warning: null,
    async list() {
      const rows = await getAll(db);
      return rows.map((row) => hydrateStored(row));
    },
    async get(id) {
      const row = await getOne(db, id);
      return row ? hydrateStored(row) : null;
    },
    async put(document) {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(toStored(document));
      await transactionDone(tx);
    },
    async delete(id) {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').delete(id);
      await transactionDone(tx);
    },
    async saveReport(report) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(report, REPORT_KEY);
      await transactionDone(tx);
    },
    async loadReport() {
      const tx = db.transaction('meta', 'readonly');
      const value = await requestToPromise(tx.objectStore('meta').get(REPORT_KEY));
      await transactionDone(tx);
      return isMeasurementReport(value) ? value : null;
    },
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function getAll(db: IDBDatabase): Promise<ReturnType<typeof toStored>[]> {
  const tx = db.transaction('documents', 'readonly');
  const request = tx.objectStore('documents').getAll();
  return requestToPromise(request);
}

function getOne(db: IDBDatabase, id: string): Promise<ReturnType<typeof toStored> | undefined> {
  const tx = db.transaction('documents', 'readonly');
  return requestToPromise(tx.objectStore('documents').get(id));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
