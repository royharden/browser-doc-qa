import { browserEnvironmentProbe } from '../adapters/environment.ts';
import { deleteDatabase, memoryLibrary, openPersistentLibrary } from '../adapters/libraryStore.ts';
import { pdfjsExtractor } from '../adapters/pdfjsExtract.ts';
import type { Clock } from '../ports.ts';
import type { DenseService, Preferences, Services } from './services.ts';

const PERSIST_KEY = 'browser-doc-qa.persist';

/** localStorage is a per-viewer convenience only; every access is guarded. */
export function browserPreferences(): Preferences {
  const storage = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    getPersistence() {
      try {
        return storage()?.getItem(PERSIST_KEY) === '1';
      } catch {
        return false;
      }
    },
    setPersistence(enabled) {
      try {
        if (enabled) storage()?.setItem(PERSIST_KEY, '1');
        else storage()?.removeItem(PERSIST_KEY);
      } catch {
        // storage blocked: the opt-in lasts for this tab only
      }
    },
    clear() {
      try {
        storage()?.removeItem(PERSIST_KEY);
      } catch {
        // nothing stored
      }
    },
  };
}

export const performanceClock: Clock = { now: () => performance.now() };

/**
 * Production composition. Adapters are wired only here; test doubles are never imported.
 * `dense` is the real Transformers.js worker service (or null when this build has none).
 */
export function productionServices(dense: DenseService | null): Services {
  return {
    clock: performanceClock,
    pdf: pdfjsExtractor(),
    environment: browserEnvironmentProbe(),
    dense,
    openLibrary: (persistent) => (persistent ? openPersistentLibrary() : Promise.resolve(memoryLibrary())),
    deleteDatabase: () => deleteDatabase(),
    preferences: browserPreferences(),
    sourceRevision: typeof __SOURCE_REVISION__ === 'string' ? __SOURCE_REVISION__ : 'unknown',
  };
}
