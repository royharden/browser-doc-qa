import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { harborPages, DEMO_QUESTION, DEMO_NEGATIVE_QUESTION, DEMO_PARAPHRASE_QUESTION } from '../../src/data/harborLine.ts';

const authority = 'C:/Users/Roy Harden/OneDrive/PJ-OD/Bolt.New/browser-doc-qa/ROY-20261026-deletion-tests-answers-delegated.md';
async function grant() {
  const text = await readFile(authority, 'utf8');
  assert.match(text, /Decision: APPROVED, narrow/);
  assert.doesNotMatch(text, /^\s*deletion-tests exception revoked\s*$/im);
}
assert.equal(process.env.S11_RV_SYNTHETIC_DELETE, 'delegated-20261026');
await grant();
const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const tree = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, tree);
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V4-reset-${Date.now()}`);
await mkdir(output, { recursive: true });
const result = { tree, productCommit: process.env.S11_RV_PRODUCT_COMMIT, status: 'FAIL', stages: [], blocked: [], errors: [] };
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 30000 });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('**/*', (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  result.blocked.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient');
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', (error) => result.errors.push(error.message));
async function clear() {
  await grant();
  await page.getByRole('button', { name: 'Delete all app data…', exact: true }).click();
  await page.getByRole('group', { name: 'Confirm delete all', exact: true }).getByRole('button', { name: 'Delete all', exact: true }).click();
}
async function cleared(stage) {
  const observed = await page.evaluate(() => ({ question: document.querySelector('#question')?.value,
    main: document.querySelectorAll('main.layout').length, questions: document.querySelectorAll('#question').length,
    models: document.querySelectorAll('[aria-labelledby=model-heading]').length,
    measurements: document.querySelectorAll('[aria-labelledby=measure-heading]').length,
    file: document.querySelector('input[type=file]')?.value }));
  observed.consent = await page.getByLabel('I agree to download the model files', { exact: true }).isChecked();
  result.stages.push({ stage, ...observed });
  assert.deepEqual(observed, { question: '', main: 1, questions: 1, models: 1, measurements: 1, file: '', consent: false });
  assert.equal(await page.getByRole('group', { name: 'Confirm delete all', exact: true }).count(), 0);
}
async function typedRecovery() {
  await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill(DEMO_QUESTION);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: /^Citation 1:/ }).first().click();
  await page.waitForFunction(() => document.activeElement?.matches('mark.cited'));
  assert.match(await page.locator('.excerpts').innerText(), /10:40 p\.m\./);
}
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  assert.deepEqual(await page.evaluate(() => indexedDB.databases()), []);
  await typedRecovery();
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
  await clear();
  await page.getByText(/All documents, vectors, answers, reports and settings stored by this app were deleted/).waitFor();
  await cleared('asked-question and consent reset');

  await typedRecovery();
  await page.getByLabel('Question', { exact: true }).fill(DEMO_NEGATIVE_QUESTION); // Unsent original synthetic draft.
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
  await clear();
  await page.getByText(/All documents, vectors, answers, reports and settings stored by this app were deleted/).waitFor();
  await cleared('unsent draft and second reset boundary');
  await typedRecovery();

  await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).click();
  await page.getByText(/Currently using: browser storage \(IndexedDB\)/).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'rv-reset-original.txt', mimeType: 'text/plain',
    buffer: Buffer.from(harborPages().map((p) => p.canonicalText).join('\f')) });
  await page.getByRole('heading', { name: 'Source: rv-reset-original.txt', exact: true }).waitFor();
  await page.getByLabel('Question', { exact: true }).fill(DEMO_PARAPHRASE_QUESTION);
  await page.getByLabel('I agree to download the model files', { exact: true }).check();
  // An actual second connection prevents final DB removal; no fake storage or modified adapter.
  await page.evaluate(async () => {
    window.__rvHeld = await new Promise((done, reject) => {
      const request = indexedDB.open('browser-doc-qa', 2);
      request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error);
    });
    window.__rvHeld.onversionchange = () => {};
  });
  await clear();
  const alert = page.getByRole('alert').filter({ hasText: /Close other tabs|database is in use/i });
  await alert.waitFor();
  result.storageFailure = await alert.innerText();
  await cleared('failed storage deletion still resets UI');
  assert.equal(await page.getByText(/All documents, vectors, answers, reports and settings stored by this app were deleted/).count(), 0);
  await page.screenshot({ path: resolve(output, 'storage-error.png'), fullPage: true });
  await page.evaluate(() => { window.__rvHeld.close(); window.__rvHeld = null; });
  await page.waitForFunction(async () => !(await indexedDB.databases()).some((db) => db.name === 'browser-doc-qa'));
  await typedRecovery();
  result.typedRecoveryAfterFailure = true;
  assert.deepEqual(result.blocked, []); assert.deepEqual(result.errors, []);
  result.status = 'PASS';
} catch (error) { result.error = error.stack ?? String(error); }
finally {
  await page.evaluate(() => window.__rvHeld?.close()).catch(() => {});
  await page.screenshot({ path: resolve(output, 'final.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2));
  await context.close(); await browser.close();
  console.log(result.status, 'draft/control/reset/error recovery; receipt:', output);
}
process.exitCode = result.status === 'PASS' ? 0 : 1;
