import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build: no server, no proxy, no env secrets. Workers (pdf.js, embedding) are bundled by Vite.
// SOURCE_REVISION may be supplied by a build step (e.g. the git commit); otherwise reports say "unknown".
const sourceRevision = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SOURCE_REVISION ?? 'unknown';

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
});
