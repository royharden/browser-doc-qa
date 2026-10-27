import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { localAssets, modelRevision, transport, instrumentWorkers } from './v3-local-transport.mjs';
import { verifyRealReport } from '../../evals/v3-report-oracle.mjs';
import { evaluationFixture } from '../../src/data/evaluation/index.ts';

// Production preview only. Build with SOURCE_REVISION set to the pinned product commit first.
const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const tree = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, tree, 'Exact reviewer test tree must be pinned');
const productCommit = process.env.S11_RV_PRODUCT_COMMIT;
assert.match(productCommit ?? '', /^[0-9a-f]{40}$/);
const assets = await localAssets(process.env.S11_RV_MODEL_DIR
  ?? `C:/Worktrees/Bolt.New/browser-doc-qa/FULL-INT/.agent-work/models/${modelRevision}`);
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V3-${Date.now()}`);
await mkdir(output, { recursive: true });
const docSentinel = 'RV_V3_PRIVATE_DOCUMENT_0760_20261026';
const querySentinel = 'RV_V3_PRIVATE_QUERY_0760_20261026';
const rows = [];
const observations = { assets: assets.verified, tree, productCommit, origin };
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, timeout: 30000, args: ['--disable-gpu'] });

async function save() { await writeFile(resolve(output, 'results.json'), JSON.stringify({ ...observations, browser: browser.version(), rows }, null, 2)); }
async function scenario(name, run, controls = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  await context.addInitScript(instrumentWorkers);
  const network = await transport(context, origin, assets, [docSentinel, querySentinel], controls);
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const started = Date.now();
  try {
    const response = await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    const headers = response.headers();
    observations.servedHeaders = Object.fromEntries(['content-security-policy', 'referrer-policy', 'x-content-type-options', 'permissions-policy']
      .map((header) => [header, headers[header] ?? null]));
    await run(page, context, network);
    await network.flush();
    assert.deepEqual(network.leaks, []);
    assert.deepEqual(network.blocked, []);
    assert.deepEqual(network.webSockets, []);
    assert.deepEqual(errors, []);
    rows.push({ name, status: 'PASS', ms: Date.now() - started, network, errors });
  } catch (error) {
    rows.push({ name, status: 'FAIL', ms: Date.now() - started, error: error.stack ?? String(error), network, errors });
    await page.screenshot({ path: resolve(output, `failure-${rows.length}.png`), fullPage: true }).catch(() => {});
  } finally {
    controls.cleanup?.();
    await save(); // Persist results before browser teardown; no deletion operations invoked.
    await context.close();
  }
  console.log(rows.at(-1).status, name);
}

async function consent(page) {
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
}
async function load(page) {
  await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor({ timeout: 240000 });
}
async function downloadReport(page, name) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await event;
  const path = resolve(output, name);
  await download.saveAs(path);
  return JSON.parse(await readFile(path, 'utf8'));
}

try {
  let release;
  let held = false;
  const gate = new Promise((done) => { release = done; });
  await scenario('consent, cancel pending real model asset and preserve keyword', async (page, _context, network) => {
    await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).isEnabled(), false);
    assert.equal(network.requests.some((request) => request.origin !== origin), false, 'No automatic model prefetch');
    await consent(page);
    await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
    const deadline = Date.now() + 30000;
    while (!held && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert.equal(held, true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    release();
    await page.locator('.phase-keyword-ready').waitFor();
    await page.getByRole('button', { name: 'Weekday departure', exact: true }).click();
    await page.getByRole('button', { name: /^Citation 1:/ }).first().waitFor();
    assert.equal(await page.locator('input[name=answer-arm][value=dense]').isEnabled(), false);
  }, { beforeAsset: async () => { held = true; await gate; }, cleanup: () => release() });
  release();

  let failOnce = true;
  await scenario('failed load, explicit WASM retry, real prefix/vectors, frozen calibration/evaluation and privacy', async (page, _context, network) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'rv-private.txt', mimeType: 'text/plain',
      buffer: Buffer.from(`Synthetic local ferry manual. ${docSentinel} Departure is 10:40 p.m.`) });
    await page.getByRole('heading', { name: 'Source: rv-private.txt', exact: true }).waitFor();
    assert.equal(network.requests.some((request) => request.origin !== origin), false);
    await consent(page);
    await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-labelledby=model-heading] dd')?.textContent.trim().startsWith('error'));
    await page.locator('.phase-keyword-ready').waitFor();
    await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).isEnabled(), true);
    await load(page); // Explicit user retry; assets are now delivered locally and inference is real.
    await page.getByLabel('Question', { exact: true }).fill(`When is departure? ${querySentinel}`);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.locator('.phase-full-ready').waitFor();

    observations.probe = await page.evaluate(async () => {
      const worker = window.__rvWorkers.at(-1);
      let sequence = 0;
      const rpc = (op, payload) => new Promise((resolveRpc, reject) => {
        const requestId = `rv-probe-${++sequence}`;
        const timeout = setTimeout(() => { worker.removeEventListener('message', listener); reject(new Error('real worker probe timeout')); }, 120000);
        const listener = ({ data }) => {
          if (data.requestId !== requestId || data.status === 'progress') return;
          clearTimeout(timeout); worker.removeEventListener('message', listener);
          if (data.status === 'error') reject(new Error(data.payload.message)); else resolveRpc(data.payload);
        };
        worker.addEventListener('message', listener);
        worker.postMessage({ requestId, corpusRevision: '', op, payload });
      });
      const text = 'A local ferry departs in the evening.';
      const prefix = 'Represent this sentence for searching relevant passages: ';
      const query = await rpc('embed', { kind: 'query', texts: [text] });
      const prefixedPassage = await rpc('embed', { kind: 'passage', texts: [prefix + text] });
      const plain = await rpc('embed', { kind: 'passage', texts: [text] });
      const sentence = await rpc('embed', { kind: 'sentence', texts: [text] });
      return {
        query: Array.from(query.data), prefixedPassage: Array.from(prefixedPassage.data),
        plain: Array.from(plain.data), sentence: Array.from(sentence.data), dimensions: query.dimensions,
        queryCount: (await rpc('count', { kind: 'query', texts: [text] })).counts[0],
        prefixedCount: (await rpc('count', { kind: 'passage', texts: [prefix + text] })).counts[0],
        overflowCount: (await rpc('count', { kind: 'query', texts: ['x!'.repeat(330)] })).counts[0],
      };
    });
    const probe = observations.probe;
    assert.equal(probe.dimensions, 384);
    assert.equal(probe.queryCount, probe.prefixedCount);
    assert.ok(probe.overflowCount > 512);
    const difference = (a, b) => Math.max(...a.map((n, i) => Math.abs(n - b[i])));
    assert.ok(difference(probe.query, probe.prefixedPassage) < 1e-6);
    assert.ok(difference(probe.plain, probe.sentence) < 1e-6);
    assert.ok(difference(probe.query, probe.plain) > 1e-5, 'Query prefix must materially affect this probe');

    await page.getByLabel('Question', { exact: true }).fill('x!'.repeat(330));
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.locator('.phase-full-ready').waitFor();
    assert.match(await page.locator('.arms').innerText(), /exceed 512 tokens|Nothing was truncated/);
    await page.getByRole('button', { name: 'Load evaluation corpus', exact: true }).click();
    await page.locator('.phase-full-ready').waitFor();
    await page.evaluate(() => { window.__rvWorkerStats.queries = []; });
    await page.getByRole('button', { name: 'Calibrate gates', exact: true }).click();
    await page.getByText('Gates frozen from the calibration split.', { exact: true }).waitFor({ timeout: 240000 });
    const calibrationQueries = await page.evaluate(() => window.__rvWorkerStats.queries);
    const calibration = evaluationFixture().calibration.map((q) => q.text);
    assert.equal(calibrationQueries.length, 24);
    for (const text of calibrationQueries) assert.ok(calibration.includes(text));
    await page.evaluate(() => { window.__rvWorkerStats.queries = []; });
    await page.getByRole('button', { name: 'Run measurements', exact: true }).click();
    await page.locator('.phase-full-ready').waitFor({ timeout: 300000 });
    const report = await downloadReport(page, 'real-model-report.json');
    observations.oracle = verifyRealReport(report, productCommit);
    assert.equal(JSON.stringify(report).includes(docSentinel), false);
    assert.equal(JSON.stringify(report).includes(querySentinel), false);
    const queries = await page.evaluate(() => window.__rvWorkerStats.queries);
    const expectedQueries = [];
    for (let pass = 0; pass < 4; pass += 1) for (const q of evaluationFixture().evaluation) expectedQueries.push(q.text, q.text);
    assert.deepEqual(queries, expectedQueries, 'Each dense/hybrid arm embeds the original fixture query independently');
    observations.worker = await page.evaluate(() => window.__rvWorkerStats);
    assert.ok(observations.worker.loads.some((status) => status.backend === 'wasm' && status.dimensions === 384));
    for (const result of observations.worker.results) {
      assert.equal(result.dimensions, 384);
      for (const norm of result.norms) assert.ok(Number.isFinite(norm) && Math.abs(norm - 1) < 1e-3);
    }
    await page.screenshot({ path: resolve(output, 'real-model-report.png'), fullPage: true });

    // Dense passage overflow is an index error and must leave keyword retrieval usable.
    await page.locator('input[type=file]').setInputFiles({ name: 'rv-overflow.txt', mimeType: 'text/plain', buffer: Buffer.from('x!'.repeat(270)) });
    await page.locator('.phase-keyword-ready').waitFor();
    assert.match(await page.locator('.facts').allTextContents().then((texts) => texts.join(' ')), /Dense index.*error|exceed 512 tokens/s);
    await page.getByLabel('Question', { exact: true }).fill('x');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.locator('.phase-keyword-ready').waitFor();
    assert.equal(await page.locator('input[name=answer-arm][value=keyword]').isEnabled(), true);
  }, { beforeAsset: async (url) => { if (failOnce && url.endsWith('/config.json')) { failOnce = false; return 'fail'; } } });

  rows.push({ name: 'WebGPU', status: 'N/A', reason: 'Optional backend not selected; this acceptance uses real WASM.' });
  rows.push({ name: 'clear app data/model cache and reload deletion', status: 'BLOCKED', reason: 'No explicit deletion grant.' });
  await save();
} finally {
  await save();
  await browser.close();
  console.log('Receipt:', output);
}
process.exitCode = rows.some((r) => r.status === 'FAIL') ? 1 : rows.some((r) => r.status === 'BLOCKED') ? 2 : 0;
