import { useState } from 'react';
import type { PanelProps } from './App.tsx';
import { isBusy } from './StatusBar.tsx';

/** Explicit, consented model load. No automatic fetch; WASM is the default, WebGPU is opt-in. */
export function ModelPanel({ state, controller }: PanelProps) {
  const [consented, setConsented] = useState(false);
  const info = state.modelInfo;
  const busy = isBusy(state.phase);
  const model = state.model;
  return (
    <section className="panel" aria-labelledby="model-heading">
      <h2 id="model-heading">Embedding model</h2>
      {!info && <p className="hint">{state.dense.reason}</p>}
      {info && (
        <>
          <p>
            <code>{info.modelId}</code> ({info.dtype}, revision <code>{info.revision}</code>). Model files: {info.estimate}.
            {' '}The app and inference runtime add separate downloads; transfer size depends on caching and compression.
            Files come from: {info.origins.join(', ')}. Your document text is not sent anywhere; only model files are downloaded.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} disabled={model.status === 'ready'} />
            I agree to download the model files
          </label>
          <div className="row">
            <button type="button" disabled={!consented || busy || model.status === 'ready'} onClick={() => void controller.loadModel('wasm')}>
              Load model (WASM)
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!consented || busy || model.status === 'ready' || model.webgpuAvailable !== true}
              onClick={() => void controller.loadModel('webgpu')}
              title={model.webgpuAvailable === true ? 'Try WebGPU' : 'No WebGPU adapter was found within 1.5 s'}
            >
              Try WebGPU
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void controller.clearModelCache()}>Clear model cache</button>
          </div>
          <dl className="facts">
            <dt>Model</dt>
            <dd>
              {model.status}
              {model.backend && ` on ${model.backend} (actual runtime backend)`}
              {model.initMs !== null && `, init ${model.initMs.toFixed(0)} ms`}
            </dd>
            <dt>WebGPU adapter</dt>
            <dd>{model.webgpuAvailable === null ? 'checking' : model.webgpuAvailable ? 'available (not yet used)' : 'unavailable'}</dd>
            <dt>Dense index</dt>
            <dd>{state.dense.status}{state.dense.reason ? ` — ${state.dense.reason}` : ''}</dd>
          </dl>
          {model.message && <p className="message message-error">{model.message}</p>}
          {model.fallbackFrom === 'webgpu' && model.status === 'error' && (
            <button type="button" onClick={() => void controller.loadModel('wasm')} disabled={busy}>Retry with WASM</button>
          )}
          {state.dense.status === 'error' && state.model.status === 'ready' && (
            <button type="button" onClick={() => void controller.buildDenseIndex()} disabled={busy}>Retry dense index</button>
          )}
        </>
      )}
    </section>
  );
}
