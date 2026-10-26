import type { ModelIdentity } from '../domain.ts';

/**
 * Model artifact registry (PLAN.md section 4). One entry; no model picker.
 *
 * Artifact/config/tokenizer metadata pinned during FULL activation; see docs/MODEL-ARTIFACT.md.
 * expectedBytes covers the declared model files, excluding the bundled runtime/application.
 * Runtime/model quality requires separate execution evidence.
 */
export interface RegistryEntry {
  identity: ModelIdentity;
  /** Exact query prefix, applied inside the adapter for kind === 'query' only. */
  queryPrefix: string;
  files: readonly string[];
  /** Total bytes of `files`; null until pinned and measured. */
  expectedBytes: number | null;
  approvedOrigins: readonly string[];
  terms: string;
  pinned: boolean;
}

export const BGE_SMALL_EN_V15: RegistryEntry = Object.freeze({
  identity: Object.freeze({
    modelId: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'cls',
    normalized: true,
    queryPrefixVersion: 'bge-en-v1.5-query-v1',
    tokenizerRevision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
    maxTokens: 512,
  }),
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
  files: Object.freeze(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']),
  expectedBytes: 34726871,
  approvedOrigins: Object.freeze([
    'https://huggingface.co and its file CDN redirects on *.hf.co (model, config and tokenizer files)',
    'https://cdn.jsdelivr.net (ONNX Runtime WebAssembly files used by Transformers.js)',
  ]),
  terms: 'BAAI/bge-small-en-v1.5 is published under the MIT licence; the Xenova ONNX conversion and Transformers.js (Apache-2.0) terms must be confirmed at pinning time.',
  pinned: true,
});

export function downloadEstimate(entry: RegistryEntry): string {
  if (entry.expectedBytes === null || !entry.pinned) {
    return 'size not yet pinned for this build; real progress is shown while files download, and later loads reuse the browser cache';
  }
  return `about ${(entry.expectedBytes / 1024 / 1024).toFixed(1)} MiB on first load`;
}
