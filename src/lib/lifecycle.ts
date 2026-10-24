import { ActionableError } from './errors.ts';

/**
 * Lifecycle primitives (PLAN.md section 7). Pure and timer-injectable so they are testable in Node.
 *
 * JobController: one corpus revision and at most one indexing/benchmark job. Replace/delete/cancel
 * invalidate the current job BEFORE any later callback can write; `commit` refuses stale jobs.
 */
export type JobKind = 'import' | 'model-load' | 'index' | 'ask' | 'benchmark' | 'calibrate';

export interface Job {
  readonly id: number;
  readonly kind: JobKind;
  readonly epoch: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}

export class JobController {
  private epoch = 0;
  private nextId = 1;
  private current: { job: Job; controller: AbortController } | null = null;

  /** Starts a job, cancelling any job already running (only one at a time). */
  begin(kind: JobKind): Job {
    this.cancelCurrent();
    const controller = new AbortController();
    const epoch = this.epoch;
    const id = this.nextId;
    this.nextId += 1;
    const job: Job = {
      id,
      kind,
      epoch,
      signal: controller.signal,
      isCurrent: () => this.current?.job.id === id && this.epoch === epoch && !controller.signal.aborted,
    };
    this.current = { job, controller };
    return job;
  }

  /** Aborts the running job but keeps the corpus revision. */
  cancelCurrent(): void {
    const running = this.current;
    this.current = null;
    running?.controller.abort();
  }

  /** Replace/delete: invalidates every outstanding job and the revision they were built for. */
  invalidateAll(): void {
    this.epoch += 1;
    this.cancelCurrent();
  }

  running(): Job | null {
    return this.current?.job ?? null;
  }

  /** Runs `write` only when the job is still current; returns whether it ran. */
  commit(job: Job, write: () => void): boolean {
    if (!job.isCurrent()) return false;
    write();
    return true;
  }

  /** Marks the job finished (if it is still the current one). */
  finish(job: Job): void {
    if (this.current?.job.id === job.id) this.current = null;
  }
}

export interface TimerApi {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: TimerApi = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface PendingEntry<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
  timer: unknown;
  onProgress?: (progress: unknown) => void;
}

/**
 * Client-side pending map for worker requests. Every request settles exactly once: by its reply, its
 * timeout, an abort, a worker error or disposal. Late replies after settlement are ignored (returns false).
 */
export class PendingRequests<T> {
  private readonly entries = new Map<string, PendingEntry<T>>();
  private disposed = false;
  private readonly timers: TimerApi;

  // No parameter properties: the Node strip-types test runner only accepts erasable syntax.
  constructor(timers: TimerApi = realTimers) {
    this.timers = timers;
  }

  create(
    requestId: string,
    timeoutMs: number,
    onTimeout: () => void,
    signal?: AbortSignal,
    onProgress?: (progress: unknown) => void,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new ActionableError('disposed', 'The model worker was shut down.'));
    if (this.entries.has(requestId)) return Promise.reject(new Error(`Duplicate request id ${requestId}.`));
    if (signal?.aborted) return Promise.reject(new ActionableError('cancelled', 'Cancelled.'));
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.set(() => {
        if (this.settle(requestId, 'reject', new ActionableError('timeout', 'The model did not respond in time. It was stopped.'))) onTimeout();
      }, timeoutMs);
      this.entries.set(requestId, { resolve, reject, timer, onProgress });
      signal?.addEventListener('abort', () => {
        this.settle(requestId, 'reject', new ActionableError('cancelled', 'Cancelled.'));
      }, { once: true });
    });
  }

  progress(requestId: string, progress: unknown): boolean {
    const entry = this.entries.get(requestId);
    if (!entry) return false;
    entry.onProgress?.(progress);
    return true;
  }

  resolve(requestId: string, value: T): boolean {
    return this.settle(requestId, 'resolve', value);
  }

  reject(requestId: string, error: unknown): boolean {
    return this.settle(requestId, 'reject', error);
  }

  /** Rejects every outstanding request (worker crash, timeout termination). */
  rejectAll(error: unknown): number {
    const ids = [...this.entries.keys()];
    for (const id of ids) this.settle(id, 'reject', error);
    return ids.length;
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAll(new ActionableError('disposed', 'The model worker was shut down.'));
  }

  size(): number {
    return this.entries.size;
  }

  private settle(requestId: string, how: 'resolve' | 'reject', value: unknown): boolean {
    const entry = this.entries.get(requestId);
    if (!entry) return false;
    this.entries.delete(requestId);
    this.timers.clear(entry.timer);
    if (how === 'resolve') entry.resolve(value as T);
    else entry.reject(value);
    return true;
  }
}
