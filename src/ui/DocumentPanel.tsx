import { useRef, useState } from 'react';
import { MAX_CANONICAL_CHARS, MAX_CHUNKS, MAX_INPUT_BYTES, MAX_PAGES } from '../lib/config.ts';
import type { PanelProps } from './App.tsx';
import { isBusy } from './StatusBar.tsx';

export function DocumentPanel({ state, controller }: PanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busy = isBusy(state.phase);
  const corpus = state.corpus;
  return (
    <section className="panel" aria-labelledby="doc-heading">
      <h2 id="doc-heading">Document</h2>
      <div className="row">
        <button type="button" onClick={() => void controller.loadTutorial()} disabled={busy}>Load Harbor Line tutorial</button>
        <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy}>Import PDF, TXT or Markdown</button>
        <input
          ref={input}
          type="file"
          accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void controller.importFile(file);
          }}
        />
      </div>
      <p className="hint">
        Limits: {MAX_INPUT_BYTES / 1024 / 1024} MiB, {MAX_PAGES} pages, {MAX_CANONICAL_CHARS.toLocaleString()} characters, {MAX_CHUNKS} chunks.
        Born-digital PDFs only (no OCR). Text is shown as extracted canonical text, not the original PDF layout.
      </p>
      {corpus && (
        <dl className="facts">
          <dt>Loaded</dt><dd>{corpus.document.displayName}</dd>
          <dt>Pages</dt><dd>{corpus.document.pages.length}</dd>
          <dt>Chunks</dt><dd>{corpus.chunks.length} (max {corpus.chunks[0]?.chunkerConfig.maxChars} characters, page-bounded)</dd>
          <dt>Revision</dt><dd><code>{corpus.revision}</code></dd>
        </dl>
      )}
      {state.setup.length > 0 && (
        <details>
          <summary>Setup timings (single observations)</summary>
          <ul className="plain">
            {state.setup.map((item, index) => (
              <li key={`${item.name}-${index}`}>{item.name}: {item.ms.toFixed(1)} ms{item.note ? ` (${item.note})` : ''}</li>
            ))}
          </ul>
        </details>
      )}

      <h3>Storage</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={state.persistence.enabled}
          disabled={busy}
          onChange={(event) => void controller.setPersistence(event.target.checked)}
        />
        Save imported documents and vectors in this browser
      </label>
      <p className="hint">
        Off by default: everything stays in memory and disappears when you close the tab. Browser storage is same-origin
        storage, not an encrypted vault. Currently using: {state.persistence.kind === 'indexeddb' ? 'browser storage (IndexedDB)' : 'memory only'}.
      </p>
      {state.persistence.warning && <p className="message message-error">{state.persistence.warning}</p>}
      {state.library.length > 0 && (
        <ul className="plain library">
          {state.library.map((item) => (
            <li key={item.id}>
              <button type="button" className="link" disabled={busy} onClick={() => void controller.openSaved(item.id)}>
                {item.displayName}
              </button>{' '}
              <span className="hint">({item.sourceType}, {item.pageCount} pages)</span>
            </li>
          ))}
        </ul>
      )}
      {!confirmDelete ? (
        <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete all app data…</button>
      ) : (
        <div className="confirm" role="group" aria-label="Confirm delete all">
          <p>Delete documents, pages, chunks, vectors, answers, measurement reports and settings stored by this app? The model cache is cleared separately.</p>
          <button type="button" className="danger" onClick={() => { setConfirmDelete(false); void controller.deleteAll(); }}>Delete all</button>
          <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>Keep</button>
        </div>
      )}
    </section>
  );
}
