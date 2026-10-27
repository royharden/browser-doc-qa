import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const modelRevision = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
const specs = [
  ['config.json', 683, 'fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350'],
  ['tokenizer.json', 711396, 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'],
  ['tokenizer_config.json', 366, '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'],
  ['onnx/model_quantized.onnx', 34014426, '6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4'],
];

export async function localAssets(modelRoot) {
  const manifest = JSON.parse(await readFile(resolve(modelRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.revision, modelRevision);
  assert.deepEqual(manifest.files.map((f) => f.file).sort(), specs.map(([name]) => name).sort());
  const files = new Map();
  const verified = [];
  // Only these exact files are ever read; no manifest-controlled arbitrary paths or credential files.
  for (const [name, bytes, expected] of specs) {
    const body = await readFile(resolve(modelRoot, name));
    const sha256 = createHash('sha256').update(body).digest('hex');
    assert.equal(body.length, bytes);
    assert.equal(sha256, expected);
    const record = manifest.files.find((f) => f.file === name);
    assert.equal(record.sha256, expected);
    assert.equal(record.bytes, bytes);
    files.set(`https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${modelRevision}/${name}`, {
      body, contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    });
    verified.push({ name, bytes, sha256 });
  }
  const runtime = new Map();
  for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
    const body = await readFile(resolve('node_modules/@huggingface/transformers/dist', name));
    runtime.set(name, { body, contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    verified.push({ name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
  }
  return { files, runtime, verified };
}

export async function transport(context, origin, assets, sentinels, controls = {}) {
  const evidence = { requests: [], blocked: [], leaks: [], webSockets: [] };
  const inspections = [];
  context.on('request', (request) => {
    inspections.push((async () => {
      const url = request.url();
      const headers = JSON.stringify(await request.allHeaders());
      const body = request.postData() ?? '';
      const leaked = sentinels.filter((value) => [url, decodeURIComponent(url), headers, body].some((field) => field.includes(value)));
      if (leaked.length) evidence.leaks.push({ origin: new URL(url).origin, sentinelCount: leaked.length });
      let thread = 'worker-or-unassociated';
      try { if (request.frame()) thread = 'page'; } catch { /* requests made by dedicated worker */ }
      evidence.requests.push({ origin: new URL(url).origin, path: new URL(url).pathname, method: request.method(), thread });
    })().catch((error) => evidence.leaks.push({ inspectionError: error.message })));
  });
  evidence.flush = () => Promise.all(inspections);
  await context.routeWebSocket('**/*', (socket) => {
    evidence.webSockets.push(socket.url());
    socket.close(); // Never connect a production test context to any remote socket.
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    let asset = assets.files.get(url.href);
    if (!asset && url.origin === 'https://cdn.jsdelivr.net') asset = assets.runtime.get(url.pathname.split('/').at(-1));
    if (!asset) {
      evidence.blocked.push({ origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    // Optional deterministic failure/pending boundary changes transport availability only, never vectors.
    if (controls.beforeAsset) {
      const result = await controls.beforeAsset(url.href);
      if (result === 'fail') return route.fulfill({ status: 503, body: 'RV deliberate local transport failure',
        headers: { 'access-control-allow-origin': '*' } });
    }
    await route.fulfill({ status: 200, body: asset.body, contentType: asset.contentType,
      headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } }).catch(() => {});
  });
  return evidence;
}

export function instrumentWorkers() {
  // Observe real worker messages. No request text, inference result or worker source is replaced.
  const NativeWorker = window.Worker;
  window.__rvWorkers = [];
  window.__rvWorkerStats = { queries: [], results: [], loads: [] };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      window.__rvWorkers.push(this);
      this.addEventListener('message', ({ data }) => {
        if (data?.op === 'load' && data.status === 'result') window.__rvWorkerStats.loads.push(data.payload);
        if (data?.op === 'embed' && data.status === 'result') {
          const { count, dimensions, data: values } = data.payload;
          window.__rvWorkerStats.results.push({ count, dimensions,
            norms: Array.from({ length: count }, (_, row) => Math.sqrt(values.slice(row * dimensions, (row + 1) * dimensions)
              .reduce((sum, n) => sum + n * n, 0))) });
        }
      });
    }
    postMessage(message, ...rest) {
      if (message?.op === 'embed' && message.payload?.kind === 'query' && !message.requestId.startsWith('rv-')) {
        window.__rvWorkerStats.queries.push(...message.payload.texts);
      }
      return super.postMessage(message, ...rest);
    }
  };
}
