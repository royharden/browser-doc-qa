export const CHUNK_SIZE = 900;
export const CHUNK_OVERLAP = 150;
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;
export const RRF_K = 60;
export const RETRIEVE_K = 5;
export const FUSION_POOL = 20;
/** Cosine scores below this value abstain. Uncalibrated until a real model is measured. */
export const COSINE_ABSTAIN_BELOW = 0.25;
export const MAX_PAGES = 40;
export const MAX_CHARS = 200_000;
export const MAX_CHUNKS = 400;
export const MAX_QUESTION_CHARS = 1_000;
export const EMBEDDING_MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DTYPE = 'q8';
export const WEBLLM_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
export const REPORT_SCHEMA = 'browser-doc-qa.measurement.v1' as const;
