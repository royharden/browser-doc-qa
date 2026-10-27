import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Static build: no server, no proxy, no env secrets. Workers (pdf.js, embedding) are bundled by Vite.
// SOURCE_REVISION may be supplied by a build step (e.g. the git commit); otherwise reports say "unknown".
const sourceRevision = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SOURCE_REVISION ?? 'unknown';
// One header source: preview mirrors the proposed static-host file for local production validation.
// Hosting still has to apply this file; a successful local preview does not configure a remote host.
const previewHeaders = Object.fromEntries(readFileSync(new URL('./public/_headers', import.meta.url), 'utf8')
  .split(/\r?\n/).flatMap((line) => {
    const match = /^\s{2}([A-Za-z-]+):\s*(.+)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
if (!previewHeaders['Content-Security-Policy']) throw new Error('Missing production preview CSP in public/_headers.');

export default defineConfig({
  plugins: [react()],
  define: {
    __SOURCE_REVISION__: JSON.stringify(sourceRevision),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  preview: { headers: previewHeaders },
});
