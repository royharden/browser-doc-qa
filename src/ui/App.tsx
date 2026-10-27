import { useSyncExternalStore } from 'react';
import type { AppController, AppState } from '../browser/controller.ts';
import { AskPanel } from './AskPanel.tsx';
import { DocumentPanel } from './DocumentPanel.tsx';
import { MeasurementsPanel } from './MeasurementsPanel.tsx';
import { ModelPanel } from './ModelPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Viewer } from './Viewer.tsx';

export interface PanelProps {
  state: AppState;
  controller: AppController;
}

export function App({ controller }: { controller: AppController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return (
    <div className="app">
      <header className="app-header">
        <h1>Browser Doc Q&amp;A</h1>
        <p className="tagline">
          Ask one document that stays in this browser. Compare keyword, embedding and hybrid retrieval, read exact
          excerpts and click citations to see the source characters.
        </p>
        <p className="privacy-note">
          Documents are processed locally; nothing is uploaded. Loading the embedding model downloads model files from
          the listed origins only after you ask. Offline use and zero network traffic are not claimed.
        </p>
      </header>
      <StatusBar state={state} controller={controller} />
      <main className="layout" key={`controls-${state.dataResetSequence}`}>
        <section className="column column-controls" aria-label="Controls">
          <DocumentPanel state={state} controller={controller} />
          <ModelPanel state={state} controller={controller} />
          <AskPanel state={state} controller={controller} />
        </section>
        <section className="column column-viewer" aria-label="Document viewer">
          <Viewer state={state} controller={controller} />
        </section>
      </main>
      <MeasurementsPanel key={`measurements-${state.dataResetSequence}`} state={state} controller={controller} />
    </div>
  );
}
