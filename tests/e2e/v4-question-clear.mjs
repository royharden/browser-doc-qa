import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const authorityPath = 'C:/Users/Roy Harden/OneDrive/PJ-OD/Bolt.New/browser-doc-qa/ROY-20261026-deletion-tests-answers-delegated.md';
async function grant() {
  const answer = await readFile(authorityPath, 'utf8');
  assert.match(answer, /Decision: APPROVED, narrow/);
  assert.doesNotMatch(answer, /^\s*deletion-tests exception revoked\s*$/im);
}
assert.equal(process.env.S11_RV_SYNTHETIC_DELETE, 'delegated-20261026');
await grant();
const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const tree = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, tree);
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V4-question-${Date.now()}`);
await mkdir(output, { recursive: true });
const receipt = { tree, productCommit: process.env.S11_RV_PRODUCT_COMMIT, status: 'FAIL', blocked: [] };
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 30000 });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('**/*', (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  receipt.blocked.push(new URL(route.request().url()).origin);
  return route.abort('blockedbyclient');
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
  await page.getByRole('button', { name: 'Weekday departure', exact: true }).click();
  await page.locator('.excerpts blockquote').first().waitFor();
  receipt.beforeQuestion = await page.getByLabel('Question', { exact: true }).inputValue();
  assert.ok(receipt.beforeQuestion.length > 0);
  await grant();
  await page.getByRole('button', { name: 'Delete all app data…', exact: true }).click();
  await page.getByRole('group', { name: 'Confirm delete all', exact: true }).getByRole('button', { name: 'Delete all', exact: true }).click();
  await page.getByText(/All documents, vectors, answers, reports and settings stored by this app were deleted/).waitFor();
  receipt.afterQuestion = await page.getByLabel('Question', { exact: true }).inputValue();
  receipt.sourceCount = await page.locator('.page-text').count();
  receipt.answerCount = await page.locator('.excerpts blockquote').count();
  assert.equal(receipt.sourceCount, 0);
  assert.equal(receipt.answerCount, 0);
  assert.deepEqual(receipt.blocked, []);
  assert.equal(receipt.afterQuestion, '', 'Delete all app data must clear the last asked question still held in UI memory');
  receipt.status = 'PASS';
} catch (error) { receipt.error = error.stack ?? String(error); }
finally {
  await page.screenshot({ path: resolve(output, 'after-delete.png'), fullPage: true });
  await writeFile(resolve(output, 'results.json'), JSON.stringify(receipt, null, 2));
  await context.close(); await browser.close();
  console.log(receipt.status, 'asked-question memory after Delete all; receipt:', output);
}
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
