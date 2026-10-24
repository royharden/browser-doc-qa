import type { ModelIdentity } from '../domain.ts';

/**
 * Model artifact registry (PLAN.md section 4). One entry; no model picker.
 *
 * ACTIVATION TASK (not done under Dirty Mode): pin `revision`/`tokenizerRevision` to an exact Hugging Face
 * commit of the converted artifact, fill `expectedBytes` from the real files, verify the 512-token limit
 * and the CLS-pooling config against that commit, and confirm terms. Until then these fields are
 * explicitly marked unpinned/unknown and the UI shows real download progress instead of a size claim.
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
    revision: 'main',
    dtype: 'q8',
    dimensions: 384,
    pooling: 'cls',
    normalized: true,
    queryPrefixVersion: 'bge-en-v1.5-query-v1',
    tokenizerRevision: 'main',
    maxTokens: 512,
  }),
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
  files: Object.freeze(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']),
  expectedBytes: null,
  approvedOrigins: Object.freeze([
    'https://huggingface.co (model, config and tokenizer files)',
    'https://cdn.jsdelivr.net (ONNX Runtime WebAssembly files used by Transformers.js)',
  ]),
  terms: 'BAAI/bge-small-en-v1.5 is published under the MIT licence; the Xenova ONNX conversion and Transformers.js (Apache-2.0) terms must be confirmed at pinning time.',
  pinned: false,
});

export function downloadEstimate(entry: RegistryEntry): string {
  if (entry.expectedBytes === null || !entry.pinned) {
    return 'size not yet pinned for this build; real progress is shown while files download, and later loads reuse the browser cache';
  }
  return `about ${(entry.expectedBytes / 1024 / 1024).toFixed(1)} MiB on first load`;
}
