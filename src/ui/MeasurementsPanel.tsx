import { useState } from 'react';
import type { ArmId } from '../domain.ts';
import { ARMS } from '../domain.ts';
import { productionComparable } from '../lib/reportValidate.ts';
import type { ArmSummary, MeasurementReport, SampleSummary } from '../report.ts';
import type { PanelProps } from './App.tsx';
import { ARM_LABEL, policyLabel } from './AskPanel.tsx';
import { isBusy } from './StatusBar.tsx';

const fmt = (value: number | null | undefined, digits = 3): string => (value === null || value === undefined ? 'N/A' : value.toFixed(digits));

export function MeasurementsPanel({ state, controller }: PanelProps) {
  const busy = isBusy(state.phase);
  const measurement = state.measurement;
  const report = measurement.report;
  const evaluationLoaded = state.corpus?.document.id.startsWith('fixture:cedar-ridge-tool-library') ?? false;
  const [exportError, setExportError] = useState<string | null>(null);

  const download = (): void => {
    try {
      const json = controller.exportReport();
      if (!json || !report) return;
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `browser-doc-qa-${report.runId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="panel measurements" aria-labelledby="measure-heading">
      <h2 id="measure-heading">Measurements</h2>
      <p className="hint">
        A fixed protocol on an original bundled corpus (8 pages): calibrate the two answer gates on 12 calibration questions, freeze
        them, then evaluate 24 untouched questions (18 answerable, 6 negatives) with 1 excluded warm-up and 3 measured passes.
        Recall@k counts evidence units covered by the retrieved chunks; MRR@5 uses the first fully covered unit.
      </p>
      <div className="row">
        <button type="button" onClick={() => void controller.loadEvaluationCorpus()} disabled={busy}>Load evaluation corpus</button>
        <button type="button" className="secondary" onClick={() => void controller.calibrate()} disabled={busy || !evaluationLoaded}>Calibrate gates</button>
        <button type="button" className="secondary" onClick={() => void controller.runBenchmark()} disabled={busy || !evaluationLoaded}>Run measurements</button>
        <button type="button" className="secondary" onClick={download} disabled={!report}>Export JSON</button>
      </div>
      <p className="hint">
        Current gates: keyword coverage ≥ {state.policy.keywordMinCoverage}, cosine ≥ {state.policy.denseMinCosine}{policyLabel(state.policy)}.
        {state.dense.status !== 'ready' && ' Embedding and hybrid rows will be unavailable until the model is loaded and the evaluation corpus is indexed.'}
      </p>
      {measurement.message && <p className="message">{measurement.message}</p>}
      {exportError && <p className="message message-error">{exportError}</p>}
      {measurement.calibration && <CalibrationView calibration={measurement.calibration} />}
      {report && <ReportView report={report} />}
    </section>
  );
}

function CalibrationView({ calibration }: { calibration: NonNullable<PanelProps['state']['measurement']['calibration']> }) {
  return (
    <details open>
      <summary>Calibration ({calibration.questionIds.length} calibration questions)</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th scope="col">Gate</th><th scope="col">Status</th><th scope="col">Chosen threshold</th><th scope="col">Balanced accuracy</th><th scope="col">Positives accepted</th><th scope="col">False accepts</th></tr>
          </thead>
          <tbody>
            {[calibration.keyword, calibration.dense].map((arm) => (
              <tr key={arm.arm}>
                <td>{arm.arm === 'keyword' ? 'Keyword coverage' : 'Dense cosine'}</td>
                <td>{arm.status}{arm.reason ? ` (${arm.reason})` : ''}</td>
                <td>{arm.chosen ? arm.chosen.threshold.toFixed(2) : 'default kept'}</td>
                <td>{arm.chosen ? arm.chosen.balancedAccuracy.toFixed(3) : 'N/A'}</td>
                <td>{arm.chosen ? `${arm.chosen.positivesAccepted}/${arm.chosen.positivesAccepted + arm.chosen.positivesRefused}` : 'N/A'}</td>
                <td>{arm.chosen ? `${arm.chosen.negativesAccepted}/${arm.chosen.negativesAccepted + arm.chosen.negativesRefused}` : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {calibration.hybrid && (
        <p className="hint">
          Hybrid under the chosen gates: {calibration.hybrid.positivesAccepted}/{calibration.hybrid.positives} positives accepted,
          {' '}{calibration.hybrid.negativesAccepted}/{calibration.hybrid.negatives} negatives accepted{calibration.hybrid.complete ? '' : ' (incomplete)'}.
        </p>
      )}
    </details>
  );
}

function ReportView({ report }: { report: MeasurementReport }) {
  const [inspectArm, setInspectArm] = useState<ArmId>('keyword');
  const nonProduction = report.rows.some((row) => !productionComparable(row));
  return (
    <div className="report">
      <h3>Report {report.status !== 'complete' && <span className="tag">{report.status}</span>}</h3>
      <p className="hint">
        Run {report.runId} at {report.createdAt}; corpus {report.fixture.fixtureId}/{report.fixture.fixtureVersion}, {report.fixture.chunkCount} chunks;
        model {report.model ? `${report.model.identity.modelId} on ${report.model.backend}` : `not loaded (${report.modelUnavailableReason ?? 'unavailable'})`}.
      </p>
      {nonProduction && <p className="message message-error">This report contains test-oracle rows and is not a production comparison.</p>}
      {!nonProduction && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Arm</th><th scope="col">Rows ok</th><th scope="col">Recall@1</th><th scope="col">@3</th><th scope="col">@5</th>
                <th scope="col">MRR@5</th><th scope="col">Correct abstain /{report.arms[0]?.negativeDenominator}</th>
                <th scope="col">False abstain /{report.arms[0]?.answerableDenominator}</th><th scope="col">False accepts</th>
                <th scope="col">Retrieval p50 / p95 ms (n)</th><th scope="col">Answer journey p50 / p95 ms</th>
              </tr>
            </thead>
            <tbody>
              {report.arms.map((arm) => <ArmRow key={arm.arm} arm={arm} />)}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Comparable figures appear only for arms with every expected row; partial arms show coverage only and unavailable arms show N/A.
        {report.arms.some((arm) => arm.latency.retrievalSum.lowN) && ' Fewer than 20 latency samples: p95 describes this sample only.'}
      </p>
      <details>
        <summary>Per-pass quality</summary>
        <ul className="plain">
          {report.arms.map((arm) => (
            <li key={arm.arm}>
              {ARM_LABEL[arm.arm]}: {arm.passes.map((pass) => `${pass.passId} R@5 ${fmt(pass.recall?.['5'] ?? null)} MRR ${fmt(pass.mrr)}`).join('; ')}
              {arm.ranksVaryAcrossPasses && ' (rankings varied across passes)'}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Per-question inspection</summary>
        <fieldset className="row">
          <legend>Arm</legend>
          {ARMS.map((arm) => (
            <label key={arm} className="radio">
              <input type="radio" name="inspect-arm" checked={inspectArm === arm} onChange={() => setInspectArm(arm)} />
              {ARM_LABEL[arm]}
            </label>
          ))}
        </fieldset>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th scope="col">Question</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Top pages</th><th scope="col">Recall@5</th><th scope="col">RR</th><th scope="col">Answer</th></tr>
            </thead>
            <tbody>
              {report.rows.filter((row) => row.arm === inspectArm && row.passId === report.protocol.passIds[report.protocol.warmupPasses]).map((row) => (
                <tr key={row.questionId}>
                  <td>{row.questionId}</td>
                  <td>{row.kind}</td>
                  <td>{row.status}{row.reason ? `: ${row.reason}` : ''}</td>
                  <td>{row.hits.map((hit) => hit.pageNumber).join(', ')}</td>
                  <td>{fmt(row.recall?.['5'] ?? null, 2)}</td>
                  <td>{fmt(row.reciprocalRank, 2)}</td>
                  <td>{row.answer?.status ?? 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>Environment and setup</summary>
        <dl className="facts">
          <dt>Browser</dt><dd>{report.environment.userAgent ?? 'unknown'}</dd>
          <dt>Logical cores</dt><dd>{report.environment.hardwareConcurrency ?? 'unknown'}</dd>
          <dt>Device memory</dt><dd>{report.environment.deviceMemoryGb === null ? 'unknown' : `${report.environment.deviceMemoryGb} GB (browser hint)`}</dd>
          <dt>WebGPU API</dt><dd>{report.environment.webgpuApiPresent === null ? 'unknown' : report.environment.webgpuApiPresent ? 'present (presence is not use)' : 'absent'}</dd>
          <dt>Cross-origin isolated</dt><dd>{String(report.environment.crossOriginIsolated ?? 'unknown')}</dd>
          <dt>WASM threads</dt><dd>{report.environment.wasmThreads ?? 'unknown'}</dd>
          <dt>Sentence-vector cache</dt><dd>{report.cacheState.note}</dd>
        </dl>
        <ul className="plain">
          {report.setup.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}: {item.ms.toFixed(1)} ms (n=1){item.note ? `, ${item.note}` : ''}</li>)}
        </ul>
        <ul className="plain">{report.notes.map((note) => <li key={note} className="hint">{note}</li>)}</ul>
      </details>
    </div>
  );
}

function ArmRow({ arm }: { arm: ArmSummary }) {
  const c = arm.coverage;
  const rows = `${c.ok}/${c.expected}${c.unavailable ? `, ${c.unavailable} unavailable` : ''}${c.error ? `, ${c.error} error` : ''}${c.cancelled ? `, ${c.cancelled} cancelled` : ''}`;
  if (arm.state !== 'complete' || !arm.aggregate) {
    return (
      <tr>
        <th scope="row">{ARM_LABEL[arm.arm]}</th>
        <td>{rows}</td>
        <td colSpan={9}>{arm.state === 'unavailable' ? `N/A: ${arm.unavailableReason ?? 'unavailable'}` : 'Partial run: no comparable aggregate. See per-question rows.'}</td>
      </tr>
    );
  }
  const a = arm.aggregate;
  return (
    <tr>
      <th scope="row">{ARM_LABEL[arm.arm]}</th>
      <td>{rows}</td>
      <td>{fmt(a.recall['1'])}</td>
      <td>{fmt(a.recall['3'])}</td>
      <td>{fmt(a.recall['5'])}</td>
      <td>{fmt(a.mrr)}</td>
      <td>{fmt(a.correctAbstentions, 1)}</td>
      <td>{fmt(a.falseAbstentions, 1)}</td>
      <td>{fmt(a.falseAccepts, 1)}</td>
      <td>{latency(arm.latency.retrievalSum)}</td>
      <td>{latency(arm.latency.answerJourneySum)}</td>
    </tr>
  );
}

function latency(summary: SampleSummary): string {
  if (summary.n === 0) return 'N/A';
  return `${fmt(summary.p50, 2)} / ${fmt(summary.p95, 2)} (${summary.n})`;
}
