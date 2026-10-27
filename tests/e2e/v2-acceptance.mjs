import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMeasurementReport } from '../../src/lib/reportValidate.ts';
import { harborPages } from '../../src/data/harborLine.ts';

// Run from repo root using node --experimental-strip-types tests/e2e/v2-acceptance.mjs.
// Caller must claim/check its own rv-* port first. This runner never starts a server.
const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, revision, 'Pin the exact checked-out candidate before running.');
const output = resolve('.agent-work/rv-receipts', `V2-${Date.now()}`);
await mkdir(output, { recursive: true });
const rows = [];
let browser;
let external = [];

async function fresh(run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  const blocked = [];
  const errors = [];
  const requests = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${origin}/`)) return route.continue();
    // Record only origin/resource type; never capture arbitrary document content or request bodies.
    blocked.push({ origin: new URL(url).origin, type: route.request().resourceType() });
    return route.abort('blockedbyclient');
  });
  context.on('request', (request) => requests.push({ origin: new URL(request.url()).origin, type: request.resourceType() }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Browser Doc Q&A', exact: true }).waitFor();
    await run(page, context);
    assert.deepEqual(errors, [], 'No uncaught page errors');
    assert.deepEqual(blocked, [], 'No attempted external downloads/calls in keyword-only journeys');
    return { requests, errors, blocked };
  } finally {
    external.push(...blocked);
    await context.close();
  }
}

async function check(name, run) {
  const started = Date.now();
  try {
    const evidence = await fresh(run);
    rows.push({ name, status: 'PASS', ms: Date.now() - started, evidence });
  } catch (error) {
    rows.push({ name, status: 'FAIL', ms: Date.now() - started, error: error.stack ?? String(error) });
  }
  console.log(rows.at(-1).status, name);
}

async function importText(page, name, text) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('heading', { name: `Source: ${name}`, exact: true }).waitFor();
}

async function citationCheck(page) {
  const quotes = await page.locator('.excerpts blockquote').allTextContents();
  assert.ok(quotes.length > 0 && quotes.length <= 2);
  const citation = page.getByRole('button', { name: /^Citation 1:/ }).first();
  const label = await citation.getAttribute('aria-label');
  const [, pageNumber, start, end] = label.match(/page (\d+), characters (\d+) to (\d+)/);
  await citation.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.matches('mark.cited'));
  const source = await page.getByLabel(`Page ${pageNumber}`, { exact: true }).evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('.cite-label').forEach((label) => label.remove());
    return copy.textContent;
  });
  const markText = await page.locator('mark.cited').evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
  assert.equal(source.slice(Number(start), Number(end)), quotes[0]);
  assert.equal(markText, quotes[0]);
  // Focus the same immutable alias after page navigation; it must return to the original span.
  await page.getByRole('navigation', { name: 'Pages', exact: true }).getByRole('button').last().click();
  await citation.click();
  await page.waitForFunction(() => document.activeElement?.matches('mark.cited'));
  assert.equal(await citation.getAttribute('aria-label'), label);
}

try {
  browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, timeout: 30000, args: ['--disable-gpu'] });

  await check('tutorial: keyword, exact keyboard citation, negative, no model traffic', async (page) => {
    assert.equal(await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Export JSON', exact: true }).isEnabled(), false);
    await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
    assert.equal(await page.getByRole('navigation', { name: 'Pages', exact: true }).getByRole('button').count(), 4);
    await page.getByRole('button', { name: 'Weekday departure', exact: true }).click();
    await page.locator('.excerpts blockquote').first().waitFor();
    assert.match(await page.locator('.excerpts').innerText(), /10:40 p\.m\./);
    await citationCheck(page);
    assert.equal(await page.locator('input[name=answer-arm][value=dense]').isEnabled(), false);
    assert.equal(await page.locator('input[name=answer-arm][value=hybrid]').isEnabled(), false);
    await page.getByRole('button', { name: 'Not in the document', exact: true }).click();
    await page.locator('.abstain').waitFor();
    assert.equal(await page.locator('.excerpts blockquote').count(), 0);
    await page.screenshot({ path: resolve(output, 'tutorial-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 600, height: 900 });
    const layout = await page.locator('.layout').evaluate((el) => ({ columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > window.innerWidth }));
    assert.equal(layout.columns, 1);
    assert.equal(layout.overflow, false);
    await page.screenshot({ path: resolve(output, 'tutorial-mobile.png'), fullPage: true });
  });

  await check('inert text and memory-default reload', async (page) => {
    const payload = '<script>globalThis.__rvInjected=true</script>\n<img src="https://invalid.example/rv" onerror="globalThis.__rvInjected=true">\n**RV source**';
    await importText(page, 'rv-inert.md', payload);
    assert.equal(await page.locator('.page-text').innerText(), payload);
    assert.equal(await page.locator('.page-text script,.page-text img').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.__rvInjected), undefined);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.library button').count(), 0);
    assert.equal(await page.locator('.page-text').count(), 0);
  });

  await check('explicit persistence opt-in survives reload', async (page) => {
    await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).check();
    await page.getByText(/Currently using: browser storage \(IndexedDB\)/).waitFor();
    await importText(page, 'rv-persist.txt', 'Synthetic persisted source: opening time is 08:30.');
    await page.locator('.library').getByRole('button', { name: 'rv-persist.txt', exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.library').getByRole('button', { name: 'rv-persist.txt', exact: true }).click();
    await page.getByRole('heading', { name: 'Source: rv-persist.txt', exact: true }).waitFor();
    assert.match(await page.locator('.page-text').innerText(), /08:30/);
  });

  await check('bundled keyword report exports valid JSON excluding imported sentinel', async (page) => {
    const sentinel = 'RV_PRIVATE_SENTINEL_20261026';
    await importText(page, 'rv-report-sentinel.txt', `${sentinel} private synthetic question text.`);
    await page.getByRole('button', { name: 'Load evaluation corpus', exact: true }).click();
    await page.getByRole('button', { name: 'Run measurements', exact: true }).click();
    const button = page.getByRole('button', { name: 'Export JSON', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Export JSON' && !b.disabled));
    const downloaded = page.waitForEvent('download');
    await button.click();
    const download = await downloaded;
    const file = resolve(output, 'keyword-report.json');
    await download.saveAs(file);
    const json = await readFile(file, 'utf8');
    assert.equal(json.includes(sentinel), false);
    assert.equal(json.includes('rv-report-sentinel.txt'), false);
    const report = JSON.parse(json);
    assert.equal(isMeasurementReport(report), true);
    assert.equal(report.rows.length, 288, 'Include the 72 warm-up diagnostic rows');
    const measured = report.rows.filter((r) => !r.warmup);
    assert.equal(measured.length, 216);
    assert.equal(measured.filter((r) => r.arm === 'keyword' && r.status === 'ok').length, 72);
    assert.equal(measured.filter((r) => r.arm !== 'keyword' && r.status === 'unavailable').length, 144);
    assert.equal(report.model, null);
  });

  const pdf = resolve('public/demo/harbor-line.pdf');
  try { await access(pdf); }
  catch { rows.push({ name: 'actual PDF pages and spans', status: 'BLOCKED', reason: 'Pinned original PDF asset missing.' }); }
  if (!rows.some((r) => r.name === 'actual PDF pages and spans')) {
    await check('actual PDF pages and spans', async (page) => {
      await page.locator('input[type=file]').setInputFiles(pdf);
      await page.getByRole('heading', { name: 'Source: harbor-line.pdf', exact: true }).waitFor();
      const nav = page.getByRole('navigation', { name: 'Pages', exact: true });
      assert.equal(await nav.getByRole('button').count(), 4);
      const actual = [];
      for (let i = 0; i < 4; i += 1) {
        await nav.getByRole('button', { name: String(i + 1), exact: true }).click();
        const text = await page.getByLabel(`Page ${i + 1}`, { exact: true }).innerText();
        actual.push(text);
        // Whitespace normalization only; preserve every authored digit, punctuation and word.
        assert.equal(text.replace(/\s+/g, ' ').trim(), harborPages()[i].canonicalText.replace(/\s+/g, ' ').trim());
      }
      await writeFile(resolve(output, 'pdf-pages.json'), JSON.stringify(actual, null, 2));
      await page.getByLabel('Question', { exact: true }).fill('What is the last weekday departure from Pier 4?');
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await page.locator('.excerpts blockquote').first().waitFor();
      await citationCheck(page);
    });
  }
  rows.push({ name: 'clear-data while pending and reload deletion', status: 'BLOCKED', reason: 'Real deletion remains unexecuted under BASELINE-V2-GRANT; cancel/replace has independent memory-only controller contracts.' });
} catch (error) {
  rows.push({ name: 'browser startup', status: 'BLOCKED', error: error.stack ?? String(error) });
} finally {
  if (browser) await browser.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, origin, external, rows }, null, 2));
  console.log('Receipt:', output);
}
process.exitCode = rows.some((r) => r.status === 'FAIL') ? 1 : rows.some((r) => r.status === 'BLOCKED') ? 2 : 0;
