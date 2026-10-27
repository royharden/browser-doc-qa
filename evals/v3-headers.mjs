import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const origin = process.env.S11_RV_ORIGIN;
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:227\d\d$/);
const canonical = await readFile('public/_headers', 'utf8');
const expected = Object.fromEntries(canonical.split(/\r?\n/).flatMap((line) => {
  const match = /^\s{2}([A-Za-z-]+):\s*(.+)$/.exec(line);
  return match ? [[match[1].toLowerCase(), match[2]]] : [];
}));
assert.equal(Object.keys(expected).length, 4);
const asset = (await readdir('dist/assets')).find((name) => /^embed\.worker-.*\.js$/.test(name));
assert.ok(asset);
const checks = await Promise.all(['/', `/assets/${asset}`].map(async (path) => {
  const response = await fetch(origin + path, { method: 'HEAD', redirect: 'error' });
  assert.equal(response.status, 200);
  const observed = Object.fromEntries(Object.keys(expected).map((key) => [key, response.headers.get(key)]));
  assert.deepEqual(observed, expected);
  return { path, status: response.status, observed };
}));
const root = resolve(process.env.S11_RV_RECEIPT_ROOT ?? '.agent-work/rv-receipts');
await mkdir(root, { recursive: true });
const output = resolve(root, `V3-headers-${Date.now()}.json`);
await writeFile(output, JSON.stringify({ origin, canonicalSha256: createHash('sha256').update(canonical).digest('hex'), checks }, null, 2));
console.log('PASS canonical preview headers on document and actual embedding worker:', output);
