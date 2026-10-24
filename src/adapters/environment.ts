import type { EnvironmentSnapshot } from '../domain.ts';

export interface NavigatorLike {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  language?: string;
  gpu?: unknown;
}

export function readEnvironment(nav: NavigatorLike | null): EnvironmentSnapshot {
  return {
    userAgent: nav?.userAgent && nav.userAgent.trim() !== '' ? nav.userAgent : 'unavailable',
    hardwareConcurrency: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    webgpu: nav ? Boolean(nav.gpu) : null,
    embeddingBackend: 'unavailable',
    embeddingModel: null,
    embeddingDtype: null,
    language: nav?.language ?? null,
  };
}
