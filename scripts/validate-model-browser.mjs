import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const origin = process.env.S11_TEST_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const revision = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
const root = resolve(process.env.S11_MODEL_CACHE ?? `.agent-work/models/${revision}`);
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.revision, revision);
assert.deepEqual(manifest.files.map(f => f.file).sort(), ['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']);
const files = new Map();
for (const entry of manifest.files) {
  const bytes = await readFile(resolve(root, entry.file));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  files.set(entry.file, resolve(root, entry.file));
}
const out = resolve('.agent-work/receipts/model-browser');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.S11_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] });
console.log('Model validation browser:', browser.version());
const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(180000);
const errors = [], blocked = [], localAssets = [], requests = [], headerChecks = [];
const sentinel = 'S11_LOCAL_ONLY_SENTINEL_0764';
page.on('pageerror', e => errors.push(e.message));
context.on('request', request => {
  assert.equal(`${request.url()} ${request.postData() ?? ''}`.includes(sentinel), false, 'Synthetic source/query sentinel leaked into a network request');
  headerChecks.push(request.allHeaders().then(headers => {
    assert.equal(JSON.stringify(headers).includes(sentinel), false, 'Synthetic sentinel leaked into request headers');
  }));
  requests.push({ origin: new URL(request.url()).origin, method: request.method(), type: request.resourceType() });
});
await context.routeWebSocket('**/*', socket => {
  blocked.push('Unexpected WebSocket transport');
  socket.close();
});
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  const prefix = `/Xenova/bge-small-en-v1.5/resolve/${revision}/`;
  if (url.origin === 'https://huggingface.co' && url.pathname.startsWith(prefix)) {
    const name = url.pathname.slice(prefix.length);
    const file = files.get(name);
    if (file) {
      localAssets.push(`model:${name}`);
      return route.fulfill({ path: file, contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
    }
  }
  const runtimePrefix = '/npm/@huggingface/transformers@3.8.1/dist/';
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith(runtimePrefix)) {
    const name = url.pathname.slice(runtimePrefix.length);
    if (['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'].includes(name)) {
      localAssets.push(`runtime:${name}`);
      return route.fulfill({ path: resolve('node_modules/@huggingface/transformers/dist', name), contentType: name.endsWith('.mjs') ? 'application/javascript' : 'application/wasm', headers: { 'access-control-allow-origin': '*' } });
    }
  }
  blocked.push(`${url.origin}${url.pathname}`);
  await route.abort('blockedbyclient');
});
// Retain native worker references for post-benchmark observation; inference remains unmodified.
await page.addInitScript(() => {
  const NativeWorker = globalThis.Worker;
  globalThis.__s11Workers = [];
  globalThis.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); globalThis.__s11Workers.push(this); }
  };
});
try {
  const response = await page.goto(origin, { waitUntil: 'networkidle' });
  const servedHeaders = await response.allHeaders();
  assert.match(servedHeaders['content-security-policy'], /object-src 'none'/);
  assert.equal(servedHeaders['referrer-policy'], 'no-referrer');
  await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
  await page.locator('.phase-keyword-ready').waitFor();
  assert.equal(localAssets.length, 0, 'No model asset may be requested before consent');
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
  await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
  console.log('Consented real WASM load started');
  await page.waitForFunction(() => document.querySelector('.phase-full-ready') || document.querySelector('[role="alert"]'), undefined, { timeout: 180000 });
  assert.equal(await page.locator('.phase-full-ready').isVisible(), true, await page.locator('body').innerText());
  assert.match(await page.locator('[aria-labelledby="model-heading"]').innerText(), /ready on wasm/);
  console.log('Real WASM model initialized and tutorial indexed from pinned local files');
  await page.getByRole('button', { name: 'Paraphrase', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor();
  assert.equal(await page.locator('.arms .arm table').count(), 3);
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-sentinel.txt', mimeType: 'text/plain', buffer: Buffer.from(`The local code is ${sentinel}. This text must remain in the browser.`) });
  await page.locator('.phase-full-ready').waitFor();
  await page.getByLabel('Question', { exact: true }).fill(`Where is ${sentinel} mentioned?`);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor();
  console.log('Real three-arm paraphrase and synthetic network sentinel PASS');
  await page.getByRole('button', { name: 'Load evaluation corpus', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor();
  await page.getByRole('button', { name: 'Calibrate gates', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.measurements')?.textContent.includes('both gates calibrated on the calibration split'), undefined, { timeout: 180000 });
  console.log('Real 12-question calibration complete; policy frozen before evaluation');
  await page.getByRole('button', { name: 'Run measurements', exact: true }).click();
  await page.locator('.report').waitFor({ timeout: 240000 });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await pending;
  await download.saveAs(resolve(out, 'report.json'));
  const report = JSON.parse(await readFile(resolve(out, 'report.json'), 'utf8'));
  assert.equal(report.schema, 'browser-doc-qa.measurement.v3');
  assert.equal(report.status, 'complete');
  assert.equal(report.model.backend, 'wasm');
  assert.equal(report.model.executionKind, 'real-browser-model');
  assert.equal(report.model.identity.revision, revision);
  assert.equal(report.calibration.questionIds.length, 12);
  assert.equal(report.policy.source, 'calibrated');
  assert.equal(report.rows.filter(row => !row.warmup).length, 216);
  for (const arm of report.arms) {
    assert.equal(arm.state, 'complete');
    assert.equal(arm.coverage.expected, 72);
    assert.equal(arm.coverage.ok, 72);
    assert.equal(arm.answerableDenominator, 18);
    assert.equal(arm.negativeDenominator, 6);
  }
  assert.equal(JSON.stringify(report).includes(sentinel), false, 'Export must exclude imported source/questions');
  // Attach observers only after the measurement artifact is frozen, avoiding query-timing instrumentation.
  await page.evaluate(() => {
    globalThis.__s11VectorAudit = { vectors: 0, dimensions: [], norms: [], tokenCounts: [] };
    for (const worker of globalThis.__s11Workers) worker.addEventListener('message', event => {
      const message = event.data, audit = globalThis.__s11VectorAudit;
      if (message.status !== 'result') return;
      if (message.op === 'count') audit.tokenCounts.push(...message.payload.counts);
      if (message.op === 'embed') {
        const { count, dimensions, data } = message.payload;
        audit.dimensions.push(dimensions);
        for (let row = 0; row < count; row += 1) {
          let norm = 0;
          for (let i = 0; i < dimensions; i += 1) norm += data[row * dimensions + i] ** 2;
          audit.norms.push(Math.sqrt(norm)); audit.vectors += 1;
        }
      }
    });
  });
  await page.getByLabel('Question', { exact: true }).fill('When does the tool library open?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor();
  await page.getByLabel('Question', { exact: true }).fill('x! '.repeat(330));
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor();
  assert.match(await page.locator('.arms .arm').nth(1).innerText(), /query input\(s\) exceed 512 tokens/);
  assert.match(await page.locator('.arms .arm').nth(2).innerText(), /query input\(s\) exceed 512 tokens/);
  await page.locator('input[type=file]').setInputFiles({ name: 'token-overflow.txt', mimeType: 'text/plain', buffer: Buffer.from('x! '.repeat(270)) });
  await page.getByText(/Dense index failed:.*passage input\(s\) exceed 512 tokens/).waitFor();
  await page.locator('.phase-keyword-ready').waitFor();
  assert.match(await page.locator('[aria-labelledby="model-heading"]').innerText(), /ready on wasm/);
  const vectorAudit = await page.evaluate(() => globalThis.__s11VectorAudit);
  assert.ok(vectorAudit.vectors >= 2);
  assert.ok(vectorAudit.dimensions.every(d => d === 384));
  assert.ok(vectorAudit.norms.every(n => Number.isFinite(n) && Math.abs(n - 1) < 0.001));
  assert.ok(vectorAudit.tokenCounts.some(n => n > 512));
  console.log('Actual 384-dimensional normalized vectors and query/passage token overflow recovery PASS');
  await Promise.all(headerChecks);
  assert.deepEqual(blocked, [], 'Unexpected model/runtime dependency must not be hidden');
  assert.deepEqual(errors, []);
  await page.locator('.measurements').screenshot({ path: resolve(out, 'measurements.png') });
  await writeFile(resolve(out, 'receipt.json'), JSON.stringify({ browser: browser.version(), servedHeaders, assetTransport: 'Exact pinned files fulfilled from task-owned local cache; no external request continued', manifest, vectorAudit, localAssets, requests, errors, blocked }, null, 2));
  console.log(JSON.stringify({ policy: report.policy, arms: report.arms.map(a => ({ arm: a.arm, coverage: a.coverage, aggregate: a.aggregate })) }, null, 2));
  console.log('Real local model calibration/evaluation/export PASS; no hosted inference or external page/worker requests');
} catch (error) {
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), errors, blocked, localAssets }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
