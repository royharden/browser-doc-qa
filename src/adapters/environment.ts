import type { EnvironmentSnapshot } from '../domain.ts';
import type { EnvironmentProbe } from '../ports.ts';

export interface NavigatorLike {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  language?: string;
  gpu?: { requestAdapter?: () => Promise<unknown> };
}

/** Observed hints only. Missing values stay unknown (null); WebGPU API presence is not execution. */
export function readEnvironment(nav: NavigatorLike | null, isolated: boolean | null): EnvironmentSnapshot {
  return {
    userAgent: nav?.userAgent && nav.userAgent.trim() !== '' ? nav.userAgent : null,
    hardwareConcurrency: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    webgpuApiPresent: nav ? typeof nav.gpu?.requestAdapter === 'function' : null,
    crossOriginIsolated: isolated,
    language: nav?.language ?? null,
  };
}

/** Resolves true only when requestAdapter returns an adapter within the bound; late results are ignored. */
export function probeWebGpu(nav: NavigatorLike | null, timeoutMs: number): Promise<boolean> {
  const request = nav?.gpu?.requestAdapter;
  if (typeof request !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Promise.resolve()
      .then(() => request.call(nav?.gpu))
      .then((adapter) => finish(adapter !== null && adapter !== undefined), () => finish(false));
  });
}

export function browserEnvironmentProbe(): EnvironmentProbe {
  const nav = typeof navigator === 'undefined' ? null : (navigator as unknown as NavigatorLike);
  const isolated = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : null;
  return {
    snapshot: () => readEnvironment(nav, isolated),
    probeWebGpu: (timeoutMs) => probeWebGpu(nav, timeoutMs),
    // Without cross-origin isolation there is no SharedArrayBuffer, so WASM is single-threaded. Otherwise the
    // actual thread count is only known inside the runtime; report unknown here rather than guess.
    wasmThreads: () => (isolated === false ? 1 : null),
  };
}
