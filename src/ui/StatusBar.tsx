import type { JobState } from '../domain.ts';
import type { PanelProps } from './App.tsx';

const PHASE_LABEL: Record<JobState, string> = {
  idle: 'No document loaded',
  importing: 'Importing',
  'keyword-ready': 'Keyword ready',
  'loading-model': 'Loading model',
  indexing: 'Building dense index',
  'full-ready': 'All arms ready',
  asking: 'Searching',
  benchmarking: 'Running measurements',
  cancelling: 'Cancelling',
  error: 'Error',
};

export const BUSY_PHASES: readonly JobState[] = ['importing', 'loading-model', 'indexing', 'asking', 'benchmarking', 'cancelling'];

export function isBusy(phase: JobState): boolean {
  return BUSY_PHASES.includes(phase);
}

export function StatusBar({ state, controller }: PanelProps) {
  const busy = isBusy(state.phase);
  const progress = state.progress;
  return (
    <div className="status-bar" role="status" aria-live="polite">
      <span className={`phase phase-${state.phase}`}>{PHASE_LABEL[state.phase]}</span>
      {progress && (
        <span className="progress">
          {progress.label}
          {progress.total > 0 && ` ${progress.done}/${progress.total}`}
          {progress.total > 0 && <progress value={progress.done} max={progress.total} aria-label={progress.label} />}
        </span>
      )}
      {busy && state.phase !== 'cancelling' && (
        <button type="button" className="secondary" onClick={() => controller.cancel()}>Cancel</button>
      )}
      {state.error && (
        <span className="message message-error" role="alert">
          {state.error.message}
          <button type="button" className="link" onClick={() => controller.dismissMessage()} aria-label="Dismiss error">Dismiss</button>
        </span>
      )}
      {!state.error && state.notice && (
        <span className="message">
          {state.notice}
          <button type="button" className="link" onClick={() => controller.dismissMessage()} aria-label="Dismiss notice">Dismiss</button>
        </span>
      )}
    </div>
  );
}
