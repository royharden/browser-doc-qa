# Independent V3 acceptance

Owner: 0760 S11-RV. Run only on the reconciled pinned V3 product commit plus reviewer tests, a fresh task-only browser, and an agent-ports claimed/checked rv-* loopback port. Never run INT's author harness as this independent gate. No live/hosted/credentialed request is continued. No deletion API is called.

Model/runtime files are local input assets. `v3-local-transport.mjs` reads only the four exact authorized model files and manifest, verifies their pinned sizes/SHA-256, and hashes installed Transformers.js runtime files. Unknown external paths are blocked; exact model/CDN URLs receive these unchanged local bytes. This changes transport availability, not inference/model output. Worker instrumentation observes messages, never replaces embeddings. Source mutation and model/fixture/threshold tuning are prohibited.

Preparation checks: Node syntax checks for all four mjs files; project typecheck includes the test-only storage TS entry; model/runtime byte hashes verified. No V3 model/browser/real-storage outcome is claimed until execution against the supplied pin.

Before production execution, set `SOURCE_REVISION` to the exact product commit and run `npm run build`. Start `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port <claimed> --strictPort` only after port check. Set these environment variables in the runner shell:

- `S11_RV_ORIGIN=http://127.0.0.1:<claimed>`
- `S11_RV_EXPECT_COMMIT=<full current reviewer test-tree SHA>`
- `S11_RV_PRODUCT_COMMIT=<full pinned INT product SHA>`
- `S11_RV_MODEL_DIR=C:/Worktrees/Bolt.New/browser-doc-qa/FULL-INT/.agent-work/models/ea104dacec62c0de699686887e3f920caeb4f3e3` (read-only authorized input)
- `S11_RV_RECEIPT_ROOT=<outer>/.agent-work/rv-receipts` (outside served repo to avoid Vite receipt-file watch locks)
- Optional `S11_RV_CHROME=<task browser executable>`; never set a real profile/user-data directory.

Commands:

```
node --experimental-strip-types tests/e2e/v3-model-acceptance.mjs
node --experimental-strip-types tests/e2e/v3-storage-acceptance.mjs
```

The model suite covers pre-consent no-fetch, held-asset cancellation and retained keyword, deliberate local asset failure then explicit WASM retry, real 384 normalized vectors, query-only prefix equivalence/difference, actual tokenizer counts, typed query/passage overflow without truncation, calibration-only queries and frozen gates, untouched fixed evaluation with independent per-arm queries, report roundtrip and independent evidence/score/count/timing oracles. It inspects synthetic document/question sentinels across request URLs, bodies and headers from page/worker traffic, including allowlisted hosts; blocks sockets and records actual served security headers. It does not establish unrestricted production-host egress/privacy or offline-shell support; service workers are blocked and WebRTC/other browser-wide transports are not exhaustively covered.

The storage suite bundles the actual canonical storage adapter into a test-only module, served from an intercepted same-origin test path. Four fresh contexts cover real ephemeral Chrome IDB/reload, blocked v1 opening then v2 recovery, versionchange closure and future-version fallback, and real task-origin CDP quota failure with explicit memory retry through production UI. The v1 fixture preserves a dedicated marker store: this tests the real upgrade without deleting legacy stores. Historical documents/meta-removal migration remains explicitly unexecuted. Chrome isolated-context access is not a claim about every browser's private mode.

Both runners keep clear-data/model-cache/durable-deletion checks BLOCKED under the current grant. No execution flag silently authorizes them. Exit zero must not be claimed while blocked rows remain; consume JSON status rows and report exact process outcome. Save partial evidence before teardown. Never remove older receipts. Close only owned browser/server resources and release the own port after completion.
