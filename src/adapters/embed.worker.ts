import { BGE_SMALL_EN_V15 } from './modelRegistry.ts';
import type { WorkerReply, WorkerRequest } from './workerProtocol.ts';

/**
 * The one embedding worker (PLAN.md section 4). Runs Transformers.js feature extraction with CLS pooling
 * and normalization for the registry model. One request at a time (the client serializes). Never fakes
 * vectors: any load/inference failure is reported as an error. Document text never leaves this worker
 * except as vectors back to the page; only model/runtime files are fetched.
 */

interface Extractor {
  (texts: string[], options: { pooling: 'cls' | 'mean'; normalize: boolean }): Promise<{ dims: number[]; data: Float32Array }>;
  tokenizer: { encode(text: string): number[] };
  dispose?: () => Promise<void>;
}

interface TransformersModule {
  pipeline(task: 'feature-extraction', model: string, options: Record<string, unknown>): Promise<Extractor>;
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    backends?: { onnx?: { wasm?: { numThreads?: number } } };
  };
}

/** Minimal worker scope typing (the DOM and WebWorker libs cannot share one program). */
interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  navigator: unknown;
}

const scope = self as unknown as WorkerScope;
let extractor: Extractor | null = null;

const reply = (message: WorkerReply, transfer: Transferable[] = []): void => scope.postMessage(message, transfer);

// Messages are handled strictly one at a time, independent of the client's own serialization.
let chain: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  chain = chain.then(() => handle(event.data), () => handle(event.data));
};

async function handle(request: WorkerRequest): Promise<void> {
  const { requestId, corpusRevision, op } = request;
  try {
    if (op === 'load') {
      const result = await load(request.payload, (payload) => reply({ requestId, corpusRevision, op, status: 'progress', payload }));
      reply({ requestId, corpusRevision, op, status: 'result', payload: result });
    } else if (op === 'embed') {
      const model = requireModel();
      const texts = request.payload.kind === 'query'
        ? request.payload.texts.map((text) => `${BGE_SMALL_EN_V15.queryPrefix}${text}`)
        : request.payload.texts;
      const output = await model(texts, { pooling: BGE_SMALL_EN_V15.identity.pooling, normalize: true });
      const count = output.dims[0] ?? 0;
      const dimensions = output.dims[1] ?? 0;
      const data = output.data.slice(0, count * dimensions);
      reply({ requestId, corpusRevision, op, status: 'result', payload: { count, dimensions, data } }, [data.buffer]);
    } else if (op === 'count') {
      const model = requireModel();
      const counts = request.payload.texts.map((text) => {
        const input = request.payload.kind === 'query' ? `${BGE_SMALL_EN_V15.queryPrefix}${text}` : text;
        return model.tokenizer.encode(input).length;
      });
      reply({ requestId, corpusRevision, op, status: 'result', payload: { counts } });
    } else if (op === 'dispose') {
      await extractor?.dispose?.();
      extractor = null;
      reply({ requestId, corpusRevision, op, status: 'result', payload: {} });
    }
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    const code = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'model-error';
    reply({ requestId, corpusRevision, op, status: 'error', payload: { code, message } });
  }
}

function requireModel(): Extractor {
  if (!extractor) throw Object.assign(new Error('The embedding model is not loaded.'), { code: 'model-not-loaded' });
  return extractor;
}

async function load(
  payload: Extract<WorkerRequest, { op: 'load' }>['payload'],
  progress: (payload: { phase: 'download' | 'init' | 'embed'; done: number; total: number; loadedBytes?: number; totalBytes?: number }) => void,
): Promise<{ backend: 'wasm' | 'webgpu'; initMs: number; dimensions: number; wasmThreads: number | null }> {
  const started = performance.now();
  if (payload.backend === 'webgpu' && !(await webgpuAdapter(payload.webgpuProbeMs))) {
    throw Object.assign(new Error('No WebGPU adapter was available within the probe time.'), { code: 'webgpu-unavailable' });
  }
  let transformers: TransformersModule;
  try {
    transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule;
  } catch (error) {
    throw Object.assign(new Error(`The embedding runtime could not load (${error instanceof Error ? error.message : String(error)}).`), { code: 'runtime-missing' });
  }
  transformers.env.allowLocalModels = false;
  transformers.env.useBrowserCache = true;

  const files = new Map<string, { loaded: number; total: number }>();
  const created = await transformers.pipeline('feature-extraction', payload.modelId, {
    device: payload.backend,
    dtype: payload.dtype,
    revision: payload.revision,
    progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (event.status === 'progress' && event.file && typeof event.loaded === 'number' && typeof event.total === 'number') {
        files.set(event.file, { loaded: event.loaded, total: event.total });
        let loaded = 0;
        let total = 0;
        for (const file of files.values()) {
          loaded += file.loaded;
          total += file.total;
        }
        progress({ phase: 'download', done: files.size, total: files.size, loadedBytes: loaded, totalBytes: total });
      } else if (event.status === 'ready') {
        progress({ phase: 'init', done: 0, total: 1 });
      }
    },
  });
  // Successful runtime initialization means a real probe inference with the expected output shape.
  const probe = await created(['probe'], { pooling: BGE_SMALL_EN_V15.identity.pooling, normalize: true });
  const dimensions = probe.dims[1] ?? 0;
  if (dimensions !== BGE_SMALL_EN_V15.identity.dimensions) {
    await created.dispose?.();
    throw Object.assign(new Error(`The model returned ${dimensions} dimensions; expected ${BGE_SMALL_EN_V15.identity.dimensions}.`), { code: 'model-shape' });
  }
  extractor = created;
  const threads = transformers.env.backends?.onnx?.wasm?.numThreads;
  return {
    backend: payload.backend,
    initMs: performance.now() - started,
    dimensions,
    wasmThreads: payload.backend === 'wasm' && typeof threads === 'number' ? threads : null,
  };
}

async function webgpuAdapter(timeoutMs: number): Promise<boolean> {
  const gpu = (scope.navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  try {
    return await Promise.race([gpu.requestAdapter().then((adapter) => adapter !== null && adapter !== undefined, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
