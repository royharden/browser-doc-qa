# Embedding artifact

The application uses Xenova/bge-small-en-v1.5 at converted-artifact revision `ea104dacec62c0de699686887e3f920caeb4f3e3`. Registry facts were checked against the public Hugging Face model API with file metadata on 2026-10-26. These downloads are public dependencies; inference is local, with no account, key, hosted inference or payment.

| File | Bytes |
|---|---:|
| config.json | 683 |
| tokenizer.json | 711396 |
| tokenizer_config.json | 366 |
| onnx/model_quantized.onnx | 34014426 |
| Total model/config/tokenizer | 34726871 |

The total excludes the bundled ONNX runtime/WASM and application code. The registry's download estimate describes these model files, not a measured network transfer total.

The pinned config declares hidden_size=384 and max_position_embeddings=512. The pinned tokenizer config declares model_max_length=512. Query-only instruction is `Represent this sentence for searching relevant passages: `, including its trailing space. Actual tokens including special tokens/prefix must be counted before inference; character count is not a token budget.

PLAN specifies CLS pooling and normalization. BAAI's upstream `1_Pooling/config.json` declares pooling_mode_cls_token=true and pooling_mode_mean_tokens=false. Xenova's conversion README shows a mean-pooling example; this build deliberately follows the PLAN/BAAI CLS recipe and makes no comparative pooling superiority claim.

Sources:

- [Pinned model config](https://huggingface.co/Xenova/bge-small-en-v1.5/blob/ea104dacec62c0de699686887e3f920caeb4f3e3/config.json)
- [Pinned tokenizer config](https://huggingface.co/Xenova/bge-small-en-v1.5/blob/ea104dacec62c0de699686887e3f920caeb4f3e3/tokenizer_config.json)
- [Converted artifact repository](https://huggingface.co/Xenova/bge-small-en-v1.5/tree/ea104dacec62c0de699686887e3f920caeb4f3e3)
- [BAAI upstream pooling](https://huggingface.co/BAAI/bge-small-en-v1.5/blob/main/1_Pooling/config.json)
- [BAAI upstream model/terms](https://huggingface.co/BAAI/bge-small-en-v1.5)

These metadata checks do not establish real browser backend, vectors, inference quality, calibration or privacy. Those require execution receipts and independent review.

## Local execution asset cache

FULL validation acquired only these immutable public dependency files (no inference API, account/key or document payload). They remain outside Git under ignored `.agent-work/models/<revision>/`. Offline browser validation verifies bytes and SHA-256 and fulfills asset requests from that cache; no remote request is continued.

| File | SHA-256 |
|---|---|
| config.json | fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350 |
| tokenizer.json | d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66 |
| tokenizer_config.json | 9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3 |
| onnx/model_quantized.onnx | 6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4 |

The matching runtime `.mjs`/`.wasm` files come from installed Transformers.js 3.8.1. The offline validation cache is a test transport for unchanged real model bytes, not an embedding test double or a production offline-shell promise. Use a production preview, not first-use Vite development optimization: optimizer reloads can reset consent/model state during the first dynamic worker import.
