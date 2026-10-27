// Test-only browser entry: bundle the actual canonical adapter, with no fake IndexedDB implementation.
export { openPersistentLibrary, memoryLibrary } from '../../src/adapters/libraryStore.ts';
export { makeDocument } from '../../src/session.ts';
