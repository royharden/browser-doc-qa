import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(process.env.S11_RV_EXPECT_COMMIT, revision);
const input = 'C:/Worktrees/Bolt.New/browser-doc-qa/FULL-INT/.agent-work/fixtures/pdf-boundaries';
const manifest = JSON.parse(await readFile(resolve(input, 'manifest.json'), 'utf8'));
const specs = [
  ['too-many-pages.pdf', 20075, 'dff4c17ec3e7a9945e6fba0ce11d0dba93d67254982f8841196ac5aac9438537', /has 41 pages.*limit is 40/],
  ['encrypted.pdf', 2003, '5bf2cb364e2a46be39f0bb4222155bd2f927aed8bf48443d46bda7515e75a1c6', /password-protected/],
  ['image-only.pdf', 3327, '08f83db0b61483097f04a18d0c0ecd88c669882b3c99fbcdc952ba08c631be1c', /no extractable text.*does not do OCR/],
  ['corrupt.pdf', 43, '31a0da7926658e1c657e8acfec4ae82881a154ad44aa3e1ceef74a3f7da5397a', /not a readable PDF.*damaged/],
];
assert.deepEqual(manifest.files.map((f) => f.file).sort(), specs.map(([name]) => name).sort());
const output = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts', `V3-pdf-${Date.now()}`);
await mkdir(output, { recursive: true });
const rows = [];
const browser = await chromium.launch({ executablePath: process.env.S11_RV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 30000 });
try {
  for (const [name, bytes, sha256, message] of specs) {
    const body = await readFile(resolve(input, name));
    assert.equal(body.length, bytes);
    assert.equal(createHash('sha256').update(body).digest('hex'), sha256);
    assert.equal(manifest.files.find((f) => f.file === name).sha256, sha256);
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const blocked = [];
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blocked.push(new URL(route.request().url()).origin);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer: body });
      const alert = page.getByRole('alert');
      await alert.filter({ hasText: message }).waitFor();
      const observed = await alert.innerText();
      assert.equal(await page.locator('.page-text').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).isEnabled(), false);
      assert.deepEqual(blocked, []);
      assert.deepEqual(errors, []);
      rows.push({ name, bytes, sha256, status: 'PASS', observed });
      await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    } catch (error) { rows.push({ name, status: 'FAIL', error: error.stack ?? String(error), blocked, errors }); }
    finally {
      await writeFile(resolve(output, 'results.json'), JSON.stringify({ revision, browser: browser.version(), rows }, null, 2));
      await context.close();
    }
    console.log(rows.at(-1).status, name);
  }
} finally {
  await browser.close();
  console.log('Receipt:', output);
}
process.exitCode = rows.some((row) => row.status === 'FAIL') ? 1 : 0;
