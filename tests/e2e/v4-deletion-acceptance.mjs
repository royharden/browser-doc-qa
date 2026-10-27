import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { harborPages } from '../../src/data/harborLine.ts';
import { localAssets, modelRevision, transport, instrumentWorkers } from './v3-local-transport.mjs';

// A separate additive run: never rewrite V3's historical BLOCKED rows.
const authorityPath = 'C:/Users/Roy Harden/OneDrive/PJ-OD/Bolt.New/browser-doc-qa/ROY-20261026-deletion-tests-answers-delegated.md';
assert.equal(process.env.S11_RV_SYNTHETIC_DELETE, 'delegated-20261026', 'Explicit narrow delegated test opt-in required');
async function grant() {
  const text = await readFile(authorityPath, 'utf8');
  assert.match(text, /Decision: APPROVED, narrow/);
  assert.doesNotMatch(text, /^\s*deletion-tests exception revoked\s*$/im);
  return createHash('sha256').update(text).digest('hex');
}
const authoritySha256 = await grant();
const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const tree = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, tree);
const productCommit = '109ea2b5964f76376d8316d78502e4a2041a6bac';
assert.equal(process.env.S11_RV_PRODUCT_COMMIT, productCommit);
const assets = await localAssets(`C:/Worktrees/Bolt.New/browser-doc-qa/FULL-INT/.agent-work/models/${modelRevision}`);
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V4-${Date.now()}`);
await mkdir(output, { recursive: true });
const rows = [];
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, timeout: 30000, args: ['--disable-gpu'] });
const source = harborPages().map((page) => page.canonicalText).join('\f');
const save = () => writeFile(resolve(output, 'results.json'), JSON.stringify({ tree, productCommit, authoritySha256,
  authority: 'Effie delegated by Roy, msg t278u; narrow synthetic-context exception', browser: browser.version(), assets: assets.verified, rows }, null, 2));

async function snapshot(page) {
  return page.evaluate(async () => {
    const result = { databases: await indexedDB.databases(), stores: {}, documents: [], reportSources: [], caches: {},
      preference: localStorage.getItem('browser-doc-qa.persist'), workers: window.__rvWorkerStats, workerCount: window.__rvWorkers.length };
    if (result.databases.some((db) => db.name === 'browser-doc-qa')) {
      const db = await new Promise((done, reject) => {
        const request = indexedDB.open('browser-doc-qa');
        request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Unexpected database creation during snapshot')); };
        request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error);
      });
      result.version = db.version;
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const reads = names.map((name) => new Promise((done, reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => {
          result.stores[name] = request.result.length;
          if (name === 'documents') result.documents = request.result.map((row) => row.document?.displayName ?? row.id);
          if (name === 'reports') result.reportSources = request.result.map((row) => row.app?.sourceRevision ?? null);
          done();
        };
        request.onerror = () => reject(request.error);
      }));
      await Promise.all(reads); db.close();
    }
    for (const name of await caches.keys()) result.caches[name] = (await (await caches.open(name)).keys()).map((request) => request.url);
    return result;
  });
}

function absent(value) {
  assert.equal(value.databases.some((db) => db.name === 'browser-doc-qa'), false);
  assert.equal(value.preference, null);
  assert.deepEqual(value.stores, {});
}

async function importOriginal(page, name) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByRole('heading', { name: `Source: ${name}`, exact: true }).waitFor();
}
async function optIn(page) {
  await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).click();
  await page.getByText(/Currently using: browser storage \(IndexedDB\)/).waitFor();
}
async function model(page) {
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
  await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
  await page.locator('.phase-full-ready').waitFor({ timeout: 180000 });
}
async function erase(page) {
  await grant();
  await page.getByRole('button', { name: 'Delete all app data…', exact: true }).click();
  await grant();
  await page.getByRole('group', { name: 'Confirm delete all', exact: true }).getByRole('button', { name: 'Delete all', exact: true }).click();
  await page.getByText(/All documents, vectors, answers, reports and settings stored by this app were deleted/).waitFor();
  await page.locator('.phase-idle').waitFor();
  assert.equal(await page.locator('.page-text,.excerpts blockquote,.library button').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole('button', { name: 'Export JSON', exact: true }).isEnabled(), false);
  assert.equal(await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).isChecked(), false);
}
async function recoverKeyword(page) {
  await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
  await page.getByRole('button', { name: 'Weekday departure', exact: true }).click();
  await page.getByRole('button', { name: /^Citation 1:/ }).first().click();
  await page.waitForFunction(() => document.activeElement?.matches('mark.cited'));
  assert.match(await page.locator('.excerpts').innerText(), /10:40 p\.m\./);
}
async function check(name, run, controls = {}) {
  await grant();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(instrumentWorkers);
  const network = await transport(context, origin, assets, [], controls);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const evidence = {};
  let deadline;
  console.log('START', name);
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    evidence.initial = await snapshot(page);
    assert.deepEqual(evidence.initial.databases, []);
    assert.deepEqual(evidence.initial.caches, {});
    assert.equal(evidence.initial.preference, null);
    await Promise.race([run(page, context, evidence), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('V4 scenario exceeded four minutes')), 240000);
    })]);
    await network.flush();
    assert.deepEqual(network.blocked, []);
    assert.deepEqual(network.webSockets, []);
    assert.deepEqual(errors, []);
    rows.push({ name, status: 'PASS', evidence, network, errors });
  } catch (error) {
    rows.push({ name, status: 'FAIL', error: error.stack ?? String(error), evidence, network, errors });
  } finally {
    clearTimeout(deadline); controls.cleanup?.();
    await page.screenshot({ path: resolve(output, `${rows.length}.png`), fullPage: true }).catch(() => {});
    await save(); // Receipts precede task-created context lifecycle cleanup.
    await context.close();
  }
  console.log(rows.at(-1).status, name);
}

try {
  await check('real app data/cache removal, reload absence and repeat initialization', async (page, _context, evidence) => {
    await optIn(page);
    // Generate a real fixed-fixture keyword report through the UI; no calibration/model matrix replay.
    await page.getByRole('button', { name: 'Load evaluation corpus', exact: true }).click();
    await page.getByRole('button', { name: 'Run measurements', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Export JSON' && !button.disabled));
    await importOriginal(page, 'rv-v4-original.txt');
    await model(page);
    await page.getByLabel('Question', { exact: true }).fill('What is the last weekday departure from Pier 4?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.locator('.excerpts blockquote').first().waitFor();
    // A separate task-owned cache with unchanged public config bytes proves cache scoping.
    const config = assets.files.get(`https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${modelRevision}/config.json`).body.toString('utf8');
    await page.evaluate(async ({ config, origin }) => {
      const cache = await caches.open('rv-v4-preserved');
      await cache.put(`${origin}/rv-public-config.json`, new Response(config));
    }, { config, origin });
    evidence.before = await snapshot(page);
    assert.equal(evidence.before.stores.documents, 1);
    assert.ok(evidence.before.stores.vectorSets > 0);
    assert.equal(evidence.before.stores.reports, 1);
    assert.deepEqual(evidence.before.reportSources, [productCommit]);
    assert.equal(evidence.before.preference, '1');
    assert.ok(evidence.before.caches['transformers-cache'].some((url) => url.endsWith('model_quantized.onnx')));
    await erase(page);
    evidence.afterDelete = await snapshot(page); absent(evidence.afterDelete);
    assert.deepEqual(evidence.afterDelete.caches, evidence.before.caches, 'App delete must leave separate model/task caches alone');
    await page.reload({ waitUntil: 'networkidle' });
    evidence.reloaded = await snapshot(page); absent(evidence.reloaded);
    assert.equal(await page.locator('.page-text,.library button').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Export JSON', exact: true }).isEnabled(), false);
    await grant();
    await page.getByRole('button', { name: 'Clear model cache', exact: true }).click();
    await page.getByText(/Cleared: Cache Storage "transformers-cache"/).waitFor();
    evidence.afterCacheClear = await snapshot(page);
    assert.equal(Object.hasOwn(evidence.afterCacheClear.caches, 'transformers-cache'), false);
    assert.deepEqual(evidence.afterCacheClear.caches['rv-v4-preserved'], evidence.before.caches['rv-v4-preserved']);
    await page.reload({ waitUntil: 'networkidle' });
    evidence.cacheReload = await snapshot(page);
    assert.equal(Object.hasOwn(evidence.cacheReload.caches, 'transformers-cache'), false);
    await recoverKeyword(page);
    await model(page);
    evidence.reinitialized = await snapshot(page);
    assert.ok(evidence.reinitialized.caches['transformers-cache'].some((url) => url.endsWith('model_quantized.onnx')));
    assert.ok(evidence.reinitialized.workers.loads.some((load) => load.backend === 'wasm' && load.dimensions === 384));
    await optIn(page);
    await importOriginal(page, 'rv-v4-second.txt');
    await page.locator('.phase-full-ready').waitFor();
    evidence.secondPersistence = await snapshot(page);
    assert.equal(evidence.secondPersistence.stores.documents, 1);
  });

  let releaseModel;
  let modelHeld = false;
  const modelGate = new Promise((done) => { releaseModel = done; });
  await check('delete while real model load is pending; late release cannot restore data', async (page, _context, evidence) => {
    await optIn(page); await importOriginal(page, 'rv-v4-pending-model.txt');
    await page.getByLabel('I agree to download the model files', { exact: true }).check();
    await page.getByRole('button', { name: 'Load model (WASM)', exact: true }).click();
    const deadline = Date.now() + 30000;
    while (!modelHeld && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert.equal(modelHeld, true);
    evidence.pending = await snapshot(page);
    await erase(page);
    evidence.afterDelete = await snapshot(page); absent(evidence.afterDelete);
    assert.ok(evidence.afterDelete.workers.terminations >= 1);
    releaseModel();
    await page.waitForTimeout(750); // Bounded late-publication observation after terminated worker response release.
    evidence.afterLateResponse = await snapshot(page); absent(evidence.afterLateResponse);
    assert.equal(await page.locator('.phase-full-ready,.page-text,.library button').count(), 0);
    await page.reload({ waitUntil: 'networkidle' });
    evidence.reloaded = await snapshot(page); absent(evidence.reloaded);
    await recoverKeyword(page);
  }, { beforeAsset: async (url) => { if (url.endsWith('/model_quantized.onnx')) { modelHeld = true; await modelGate; } }, cleanup: () => releaseModel() });

  await check('delete while original real PDF worker is pending; reload and keyword recover', async (page, context, evidence) => {
    let release;
    let held = false;
    const gate = new Promise((done) => { release = done; });
    // Hold the actual worker module, not Vite's small .js URL-export helper.
    await context.route('**/pdf.worker*.mjs', async (route) => {
      held = true; await gate; await route.continue().catch(() => {});
    });
    try {
      await optIn(page);
      await page.locator('input[type=file]').setInputFiles(resolve('public/demo/harbor-line.pdf'));
      const deadline = Date.now() + 30000;
      while (!held && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
      assert.equal(held, true);
      evidence.pending = await snapshot(page);
      assert.ok(evidence.pending.workerCount >= 1, 'The actual PDF worker must exist at the held boundary');
      await erase(page);
      evidence.afterDelete = await snapshot(page); absent(evidence.afterDelete);
      release();
      await page.waitForTimeout(750);
      evidence.afterLateResponse = await snapshot(page); absent(evidence.afterLateResponse);
      assert.ok(evidence.afterLateResponse.workers.terminations >= 1, 'Cancelled PDF worker must be terminated');
      assert.equal(await page.locator('.page-text,.library button').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).isEnabled(), false);
      await page.reload({ waitUntil: 'networkidle' });
      evidence.reloaded = await snapshot(page); absent(evidence.reloaded);
      await recoverKeyword(page);
    } finally { release(); }
  });

  await check('real v1 legacy documents/meta removal and reload migration recovery', async (page, _context, evidence) => {
    await page.evaluate(async (source) => {
      const db = await new Promise((done, reject) => {
        const request = indexedDB.open('browser-doc-qa', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('documents', { keyPath: 'id' });
          request.result.createObjectStore('meta');
        };
        request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((done, reject) => {
        const tx = db.transaction(['documents', 'meta'], 'readwrite');
        tx.objectStore('documents').put({ id: 'rv-original-legacy', text: source });
        tx.objectStore('meta').put('Original synthetic Harbor Line metadata', 'rv-legacy');
        tx.oncomplete = done; tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, source);
    evidence.legacy = await snapshot(page);
    assert.equal(evidence.legacy.version, 1);
    assert.deepEqual(evidence.legacy.stores, { documents: 1, meta: 1 });
    await grant(); await optIn(page); // Production migration removes only this task context's seeded legacy stores.
    evidence.migrated = await snapshot(page);
    assert.equal(evidence.migrated.version, 2);
    assert.deepEqual(evidence.migrated.stores, { documents: 0, reports: 0, vectorSets: 0 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText(/Currently using: browser storage \(IndexedDB\)/).waitFor();
    evidence.reloaded = await snapshot(page);
    assert.deepEqual(evidence.reloaded.stores, evidence.migrated.stores);
    assert.equal(await page.locator('.library button').count(), 0);
    await recoverKeyword(page);
    await importOriginal(page, 'rv-v4-after-migration.txt');
    evidence.recovered = await snapshot(page);
    assert.equal(evidence.recovered.stores.documents, 1);
    assert.deepEqual(evidence.recovered.documents, ['rv-v4-after-migration.txt']);
  });
} finally {
  await save();
  await browser.close();
  console.log('Receipt:', output);
}
process.exitCode = rows.some((row) => row.status !== 'PASS') || rows.length !== 4 ? 1 : 0;
