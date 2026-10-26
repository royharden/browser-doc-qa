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
