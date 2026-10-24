import type { BackendKind, EmbedKind } from '../domain.ts';

/**
 * Embedding worker messages (PLAN.md section 2): every request carries requestId and corpusRevision;
 * every reply repeats both and carries progress/result/error status. Payloads are validated on receipt.
 */
export type WorkerRequest =
  | { requestId: string; corpusRevision: string; op: 'load'; payload: { backend: BackendKind; modelId: string; revision: string; dtype: string; webgpuProbeMs: number } }
  | { requestId: string; corpusRevision: string; op: 'embed'; payload: { texts: string[]; kind: EmbedKind } }
  | { requestId: string; corpusRevision: string; op: 'count'; payload: { texts: string[]; kind: EmbedKind } }
  | { requestId: string; corpusRevision: string; op: 'dispose'; payload: Record<string, never> };

export type WorkerReply =
  | { requestId: string; corpusRevision: string; op: string; status: 'progress'; payload: { phase: 'download' | 'init' | 'embed'; done: number; total: number; loadedBytes?: number; totalBytes?: number } }
  | { requestId: string; corpusRevision: string; op: 'load'; status: 'result'; payload: { backend: BackendKind; initMs: number; dimensions: number; wasmThreads: number | null } }
  | { requestId: string; corpusRevision: string; op: 'embed'; status: 'result'; payload: { count: number; dimensions: number; data: Float32Array } }
  | { requestId: string; corpusRevision: string; op: 'count'; status: 'result'; payload: { counts: number[] } }
  | { requestId: string; corpusRevision: string; op: 'dispose'; status: 'result'; payload: Record<string, never> }
  | { requestId: string; corpusRevision: string; op: string; status: 'error'; payload: { code: string; message: string } };

export function isWorkerReply(value: unknown): value is WorkerReply {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestId === 'string'
    && typeof record.corpusRevision === 'string'
    && typeof record.op === 'string'
    && (record.status === 'progress' || record.status === 'result' || record.status === 'error')
    && typeof record.payload === 'object' && record.payload !== null;
}
