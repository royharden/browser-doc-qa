import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, revision);
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V3-storage-${Date.now()}`);
await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ['tests/e2e/v3-storage-entry.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
const adapterBytes = bundled.outputFiles[0].contents;
const rows = [];
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 30000 });
async function check(name, run) {
  // Each case gets a new ephemeral browser storage partition. Never open a user profile.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const external = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.href === `${origin}/__rv/storage.mjs`) return route.fulfill({ body: adapterBytes, contentType: 'text/javascript' });
    if (url.origin === origin) return route.continue();
    external.push(url.origin);
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { window.__rvStorage = await import('/__rv/storage.mjs'); });
    const evidence = await run(page, context);
    assert.deepEqual(external, []);
    rows.push({ name, status: 'PASS', evidence });
  } catch (error) { rows.push({ name, status: 'FAIL', error: error.stack ?? String(error) }); }
  finally {
    await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, browser: browser.version(), rows }, null, 2));
    await context.close();
  }
  console.log(rows.at(-1).status, name);
}

try {
  await check('real ephemeral Chrome IndexedDB persists across reload', async (page) => {
    const first = await page.evaluate(async () => {
      const { openPersistentLibrary, makeDocument } = window.__rvStorage;
      const lib = await openPersistentLibrary();
      const doc = makeDocument({ displayName: 'rv-incognito.txt', sourceType: 'txt', extractionVersion: 'rv',
        pages: [{ pageNumber: 1, canonicalText: 'Original synthetic task-only storage fixture.' }] });
      await lib.putDocument(doc); lib.close();
      return { id: doc.id, kind: lib.kind };
    });
    assert.equal(first.kind, 'indexeddb');
    await page.reload({ waitUntil: 'networkidle' });
    const loaded = await page.evaluate(async (id) => {
      const { openPersistentLibrary } = await import('/__rv/storage.mjs');
      const lib = await openPersistentLibrary();
      const doc = await lib.getDocument(id); lib.close(); return doc?.displayName;
    }, first.id);
    assert.equal(loaded, 'rv-incognito.txt');
    return { mode: 'fresh isolated Chromium context, reload in same partition', first };
  });

  await check('real blocked v1 opening falls back, then non-destructive schema upgrade recovers', async (page) => {
    const evidence = await page.evaluate(async () => {
      const wait = (request) => new Promise((resolveRequest, reject) => {
        const timer = setTimeout(() => reject(new Error('IDB open timed out')), 10000);
        request.onsuccess = () => { clearTimeout(timer); resolveRequest(request.result); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
      });
      const request = indexedDB.open('browser-doc-qa', 1);
      // V1 test marker is deliberately outside the removed legacy stores, so no deletion occurs.
      request.onupgradeneeded = () => request.result.createObjectStore('rv-v1-preserved');
      const legacy = await wait(request);
      const fallback = await window.__rvStorage.openPersistentLibrary();
      const result = { blockedKind: fallback.kind, warning: fallback.warning };
      fallback.close(); legacy.close();
      const recovered = await window.__rvStorage.openPersistentLibrary();
      const inspect = await wait(indexedDB.open('browser-doc-qa', 2));
      result.version = inspect.version;
      result.stores = Array.from(inspect.objectStoreNames);
      result.recoveredKind = recovered.kind;
      inspect.close(); recovered.close();
      return result;
    });
    assert.equal(evidence.blockedKind, 'memory');
    assert.match(evidence.warning, /older version|storage|Close/i);
    assert.equal(evidence.recoveredKind, 'indexeddb');
    assert.equal(evidence.version, 2);
    assert.ok(evidence.stores.includes('rv-v1-preserved'));
    for (const store of ['documents', 'vectorSets', 'reports']) assert.ok(evidence.stores.includes(store));
    return evidence;
  });

  await check('real versionchange closes existing handle and exposes recoverable fallback', async (page) => {
    const evidence = await page.evaluate(async () => {
      const lib = await window.__rvStorage.openPersistentLibrary();
      await new Promise((done, reject) => {
        const request = indexedDB.open('browser-doc-qa', 3);
        const timer = setTimeout(() => reject(new Error('Versionchange did not release its handle')), 10000);
        request.onupgradeneeded = () => request.result.createObjectStore('rv-future-marker');
        request.onsuccess = () => { clearTimeout(timer); request.result.close(); done(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
      });
      let code;
      try { await lib.listDocuments(); } catch (error) { code = error.code; }
      const fallback = await window.__rvStorage.openPersistentLibrary();
      const result = { oldHandleError: code, fallback: fallback.kind, warning: fallback.warning };
      fallback.close(); return result;
    });
    assert.equal(evidence.oldHandleError, 'storage-closed');
    assert.equal(evidence.fallback, 'memory');
    assert.match(evidence.warning, /storage|version/i);
    return evidence;
  });

  await check('real task-origin quota error and explicit memory retry through UI', async (page, context) => {
    await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).click();
    await page.getByText(/Currently using: browser storage \(IndexedDB\)/).waitFor();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1 });
    const file = { name: 'rv-quota.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic quota fixture. '.repeat(2000)) };
    try {
      await page.locator('input[type=file]').setInputFiles(file);
      await page.getByRole('alert').filter({ hasText: /storage is full/i }).waitFor();
      await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).click();
      await page.getByText(/Currently using: memory only/).waitFor();
      await page.locator('input[type=file]').setInputFiles(file);
      await page.getByRole('heading', { name: 'Source: rv-quota.txt', exact: true }).waitFor();
      return { quotaBytes: 1, errorVisible: true, memoryRetry: true };
    } finally {
      await cdp.send('Storage.overrideQuotaForOrigin', { origin }); // Remove only the task context quota override.
      await cdp.detach();
    }
  });

  rows.push({ name: 'legacy v1 documents/meta removal, clear-data/cache and durable deletion', status: 'BLOCKED',
    reason: 'Would remove task fixture stores/data; retained as blocked under current no-delete rule. The non-destructive v1->v2 branch is exercised separately.' });
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, browser: browser.version(), rows }, null, 2));
  await browser.close();
  console.log('Receipt:', output);
}
process.exitCode = rows.some((r) => r.status === 'FAIL') ? 1 : rows.some((r) => r.status === 'BLOCKED') ? 2 : 0;
