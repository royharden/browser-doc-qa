import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Local synthetic-fixture validation only. Use a claimed S11 port and a fresh browser context.
const origin = process.env.S11_TEST_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
console.log('Starting isolated S11 browser validation');
const browser = await chromium.launch({ executablePath: process.env.S11_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 60000, args: ['--disable-gpu'] });
console.log('Browser launched:', browser.version());
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const requests = [];
// Recovery runs must remain local: external requests are blocked before any interaction.
await context.route('**/*', route => {
  const url = route.request().url();
  return url.startsWith(`${origin}/`) || url.startsWith('file:')
    ? route.continue() : route.abort('blockedbyclient');
});
page.on('pageerror', e => errors.push(e.message));
context.on('request', r => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
try {
  if (process.argv.includes('--prepare-pdf')) {
    await page.goto(pathToFileURL(resolve('tests/fixtures/pdf/harbor-line.print.html')).href);
    await mkdir('public/demo', { recursive: true });
    await page.pdf({ path: 'public/demo/harbor-line.pdf', format: 'Letter', margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' }, displayHeaderFooter: false, printBackground: true });
    console.log('PDF prepared with', browser.version());
  }
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Load Harbor Line tutorial', exact: true }).click();
  await page.getByRole('button', { name: 'Weekday departure', exact: true }).click();
  const citation = page.getByRole('button', { name: /^Citation 1:/ });
  await citation.waitFor();
  const quote = await page.locator('.excerpts blockquote').first().innerText();
  assert.match(quote, /10:40 p\.m\./);
  await citation.focus();
  await page.keyboard.press('Enter');
  await page.locator('mark').first().waitFor();
  assert.equal(await page.locator('mark').first().evaluate(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')), quote);
  await page.getByRole('button', { name: 'Not in the document', exact: true }).click();
  await page.locator('.abstain').waitFor();
  assert.equal(requests.filter(r => !r.url.startsWith(origin) && !r.url.startsWith('file:')).length, 0);
  console.log('Tutorial/citation/negative/no automatic model download PASS');
  await page.locator('input[type=file]').setInputFiles('public/demo/harbor-line.pdf');
  await page.getByText('harbor-line.pdf', { exact: true }).waitFor();
  const extracted = await page.evaluate(async () => {
    const { pdfjsExtractor } = await import('/src/adapters/pdfjsExtract.ts');
    const bytes = await (await fetch('/demo/harbor-line.pdf')).arrayBuffer();
    return await pdfjsExtractor().extract(bytes, 'harbor-line.pdf', new AbortController().signal);
  });
  const expected = JSON.parse(await readFile('tests/fixtures/pdf/harbor-line.expected.json', 'utf8'));
  assert.equal(extracted.pages.length, 4);
  for (const gold of expected.pages) {
    const actual = extracted.pages.find(p => p.pageNumber === gold.pageNumber);
    if (gold.canonicalText) assert.equal(actual.canonicalText, gold.canonicalText);
    for (const sentence of gold.sentences) assert.ok(actual.canonicalText.replace(/\s+/g, ' ').includes(sentence));
  }
  await page.getByLabel('Question', { exact: true }).fill('What is the last weekday departure from Pier 4?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await citation.waitFor();
  await citation.click();
  const pdfQuote = await page.locator('.excerpts blockquote').first().innerText();
  assert.match(pdfQuote, /10:40 p\.m\./);
  assert.equal(await page.locator('mark').first().evaluate(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('')), pdfQuote);
  await mkdir('.agent-work/receipts', { recursive: true });
  await page.screenshot({ path: '.agent-work/receipts/pdf-desktop.png', fullPage: true });
  // The controlled checkbox commits after IndexedDB opens; wait for its resulting saved row.
  await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).click();
  const savedPdf = page.locator('.library').getByRole('button', { name: 'harbor-line.pdf', exact: true });
  await savedPdf.waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await savedPdf.click();
  await page.getByText('harbor-line.pdf', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('Save imported documents and vectors in this browser', { exact: true }).isChecked(), true);
  assert.match(await page.locator('.page-text').innerText(), /Harbor Line Ferry: Schedule/);
  console.log('Explicit persistence opt-in and IndexedDB reload PASS');
  await page.setViewportSize({ width: 800, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.agent-work/receipts/pdf-stacked.png', fullPage: true });
  const inertName = '<img src=x onerror=alert(1)>.md';
  await page.locator('input[type=file]').setInputFiles({ name: inertName, mimeType: 'text/markdown', buffer: Buffer.from('<script>globalThis.__s11_xss=1</script>\nS11_LOCAL_DOCUMENT_SENTINEL_0764. No browser upload is needed.') });
  await page.getByText(inertName, { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => globalThis.__s11_xss), undefined);
  assert.equal(await page.locator('.page-text script, .page-text img').count(), 0);
  assert.match(await page.locator('.page-text').innerText(), /<script>/);
  console.log('Inert Markdown/filename and stacked viewport PASS');
  await page.locator('input[type=file]').setInputFiles({ name: 'oversize.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65) });
  await page.locator('.status-error, .message-error').filter({ hasText: /10 MiB|too large|larger than/i }).first().waitFor();
  console.log('Byte-first oversized import rejection PASS');
  assert.equal(requests.filter(r => !r.url.startsWith(origin) && !r.url.startsWith('file:')).length, 0);
  await writeFile('.agent-work/receipts/browser-v1.json', JSON.stringify({ browser: browser.version(), origin, quote, pdfQuote, extracted, errors, requests }, null, 2));
  assert.deepEqual(errors, []);
  console.log('Actual browser PDF import and exact citation PASS');
} finally {
  await context.close();
  await browser.close();
}
