import type { ArmId, BackendKind, CitationId, DocumentRecord, EnvironmentSnapshot, GatePolicy, JobState } from '../domain.ts';
import { ARMS } from '../domain.ts';
import type { DocumentSummary, EmbedProgress, LibraryStore } from '../ports.ts';
import { importLocalFile, type FileLike } from '../adapters/fileImport.ts';
import { harborDocument } from '../data/harborLine.ts';
import { evaluationFixture } from '../data/evaluation/index.ts';
import type { CalibrationResult } from '../lib/calibrate.ts';
import { runBenchmark, runCalibration } from '../lib/protocol.ts';
import { exportReportJson, isMeasurementReport } from '../lib/reportValidate.ts';
import type { MeasurementReport, SetupObservation } from '../report.ts';
import { runArm, validateQuestion, type ArmRun, type DenseContext } from '../lib/ask.ts';
import { DEFAULT_POLICY } from '../lib/config.ts';
import { ActionableError, errorMessage } from '../lib/errors.ts';
import { JobController, type Job, type JobKind } from '../lib/lifecycle.ts';
import { buildCorpus, type Corpus } from '../session.ts';
import type { Services } from './services.ts';

export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';
export type DenseStatus = 'unavailable' | 'indexing' | 'ready' | 'error';

export interface ProgressView {
  label: string;
  done: number;
  total: number;
}

export interface AppState {
  phase: JobState;
  progress: ProgressView | null;
  error: { code: string; message: string } | null;
  notice: string | null;
  corpus: Corpus | null;
  /** Setup observations for the current document (read/extract/chunk/BM25/embed/persist). */
  setup: { name: string; ms: number; note: string | null }[];
  persistence: { enabled: boolean; kind: 'memory' | 'indexeddb'; warning: string | null };
  library: DocumentSummary[];
  query: string | null;
  runs: Partial<Record<ArmId, ArmRun>>;
  answerArm: ArmId;
  /** `sequence` increments on every citation click so the viewer re-focuses even for the same span. */
  focus: { arm: ArmId; alias: number; citation: CitationId; sequence: number } | null;
  viewerPage: number | null;
  model: { status: ModelStatus; backend: BackendKind | null; message: string | null; initMs: number | null; webgpuAvailable: boolean | null; fallbackFrom: BackendKind | null };
  dense: { status: DenseStatus; reason: string; revision: string | null };
  policy: GatePolicy;
  environment: EnvironmentSnapshot;
  measurement: {
    status: 'idle' | 'calibrating' | 'running' | 'done' | 'cancelled' | 'error';
    message: string | null;
    report: MeasurementReport | null;
    calibration: CalibrationResult | null;
  };
  /** Registry facts shown before consent; null when this build has no dense service. */
  modelInfo: { modelId: string; revision: string; dtype: string; estimate: string; origins: readonly string[] } | null;
}

type Listener = () => void;

function idleDenseReason(services: Services): string {
  return services.dense ? NO_DENSE_REASON : 'Dense retrieval is not available in this build.';
}

function isCancel(error: unknown): boolean {
  return error instanceof ActionableError && error.code === 'cancelled';
}

function newRunId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

const SETUP_NAMES: readonly SetupObservation['name'][] = ['fixture-prepare', 'read', 'extract', 'chunk', 'bm25-build', 'model-init', 'passage-embed', 'persist'];

function toSetupObservation(item: { name: string; ms: number; note: string | null }): SetupObservation {
  const name = SETUP_NAMES.find((candidate) => candidate === item.name) ?? 'read';
  return { name, ms: item.ms, items: null, note: item.note };
}

export const NO_DENSE_REASON = 'Load the embedding model and build the dense index to enable this arm. Keyword works without it.';

/**
 * App controller: owns state, the job controller and service lifecycles. React components only read
 * state and call these methods. Every async result commits through JobController so replace/delete/
 * cancel can never be repopulated by a late callback (PLAN.md section 7).
 */
export class AppController {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private readonly jobs = new JobController();
  private readonly services: Services;
  private library: LibraryStore | null = null;
  private libraryEpoch = 0;
  private disposed = false;
  private dense: DenseContext | null = null;

  constructor(services: Services) {
    this.services = services;
    this.state = {
      phase: 'idle',
      progress: null,
      error: null,
      notice: null,
      corpus: null,
      setup: [],
      persistence: { enabled: services.preferences.getPersistence(), kind: 'memory', warning: null },
      library: [],
      query: null,
      runs: {},
      answerArm: 'keyword',
      focus: null,
      viewerPage: null,
      model: { status: 'unloaded', backend: null, message: null, initMs: null, webgpuAvailable: null, fallbackFrom: null },
      dense: { status: 'unavailable', reason: idleDenseReason(services), revision: null },
      policy: DEFAULT_POLICY,
      environment: services.environment.snapshot(),
      measurement: { status: 'idle', message: null, report: null, calibration: null },
      modelInfo: services.dense ? {
        modelId: services.dense.identity.modelId,
        revision: services.dense.identity.revision,
        dtype: services.dense.identity.dtype,
        estimate: services.dense.downloadEstimate,
        origins: services.dense.approvedOrigins,
      } : null,
    };
  }

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private fail(error: unknown, phase: JobState): void {
    const code = error instanceof ActionableError ? error.code : 'error';
    if (code === 'cancelled') {
      this.set({ phase, progress: null, notice: 'Cancelled.' });
      return;
    }
    this.set({ phase, progress: null, error: { code, message: errorMessage(error) } });
  }

  private readyPhase(): JobState {
    if (!this.state.corpus) return 'idle';
    return this.state.dense.status === 'ready' ? 'full-ready' : 'keyword-ready';
  }

  private begin(kind: JobKind, phase: JobState, label: string): Job {
    const job = this.jobs.begin(kind);
    this.set({ phase, progress: { label, done: 0, total: 0 }, error: null, notice: null });
    return job;
  }

  dismissMessage(): void {
    this.set({ error: null, notice: null });
  }

  async init(): Promise<void> {
    if (!(await this.openLibrary(this.state.persistence.enabled))) return;
    await this.loadStoredReport();
    if (this.disposed) return;
    const probe = await this.services.environment.probeWebGpu(1500);
    if (!this.disposed) this.set({ model: { ...this.state.model, webgpuAvailable: probe } });
  }

  private async openLibrary(persistent: boolean): Promise<boolean> {
    const epoch = ++this.libraryEpoch;
    this.library?.close();
    this.library = null;
    // Reflect intent immediately, including opt-out while an earlier IndexedDB open is pending.
    this.set({ persistence: { enabled: persistent, kind: 'memory', warning: null }, library: [] });
    const library = await this.services.openLibrary(persistent);
    if (this.disposed || epoch !== this.libraryEpoch) {
      library.close();
      return false;
    }
    const documents = await library.listDocuments().catch(() => []);
    if (this.disposed || epoch !== this.libraryEpoch) {
      library.close();
      return false;
    }
    this.library = library;
    this.set({
      persistence: { enabled: persistent, kind: library.kind, warning: library.warning },
      library: documents,
    });
    return true;
  }

  /** Explicit opt-in. Turning it off does not delete stored data; "Delete all" does. */
  async setPersistence(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    this.services.preferences.setPersistence(enabled);
    if (!(await this.openLibrary(enabled))) return;
    const corpus = this.state.corpus;
    if (enabled && corpus && corpus.document.sourceType !== 'fixture') await this.persistDocument(corpus.document);
  }

  private async persistDocument(document: DocumentRecord): Promise<number> {
    const library = this.library;
    const epoch = this.libraryEpoch;
    if (!library || library.kind !== 'indexeddb' || document.sourceType === 'fixture') return 0;
    const started = this.services.clock.now();
    await library.putDocument(document);
    const ms = this.services.clock.now() - started;
    if (!this.disposed && epoch === this.libraryEpoch) {
      const documents = await library.listDocuments();
      if (!this.disposed && epoch === this.libraryEpoch) this.set({ library: documents });
    }
    return ms;
  }

  loadTutorial(): Promise<void> {
    return this.loadDocument(() => Promise.resolve({ document: harborDocument(), setup: [{ name: 'fixture-prepare', ms: 0, note: 'Bundled text fixture; not a PDF extraction.' }] }));
  }

  importFile(file: FileLike): Promise<void> {
    return this.loadDocument(async (job) => {
      const { document, readMs, extractMs } = await importLocalFile(file, this.services.pdf, job.signal, this.services.clock, (progress) => {
        this.jobs.commit(job, () => this.set({ progress: { label: 'Extracting pages', done: progress.pagesDone, total: progress.pagesTotal } }));
      });
      return {
        document,
        setup: [
          { name: 'read', ms: readMs, note: null },
          { name: 'extract', ms: extractMs, note: document.sourceType === 'pdf' ? `PDF text extraction (${document.pages.length} pages)` : 'Text decode and paging' },
        ],
      };
    });
  }

  async openSaved(id: string): Promise<void> {
    const library = this.library;
    if (!library) return;
    await this.loadDocument(async () => {
      const document = await library.getDocument(id);
      if (!document) throw new ActionableError('not-found', 'That saved document is missing or failed validation, so it was discarded.');
      return { document, setup: [{ name: 'read', ms: 0, note: 'Loaded from browser storage' }] };
    }, false);
  }

  private async loadDocument(
    produce: (job: Job) => Promise<{ document: DocumentRecord; setup: AppState['setup'] }>,
    persist = true,
  ): Promise<void> {
    // Replacing the document invalidates every outstanding job and the old revision first.
    this.jobs.invalidateAll();
    this.dense = null;
    this.syncModelAfterAbort();
    const job = this.begin('import', 'importing', 'Importing');
    this.set({ corpus: null, runs: {}, query: null, focus: null, viewerPage: null, setup: [], dense: { status: 'unavailable', reason: idleDenseReason(this.services), revision: null } });
    try {
      const { document, setup } = await produce(job);
      if (!job.isCurrent()) return;
      const corpus = buildCorpus(document, () => this.services.clock.now());
      const persistMs = persist ? await this.persistDocument(document) : 0;
      const observations = [
        ...setup,
        { name: 'chunk', ms: corpus.chunkMs, note: `${corpus.chunks.length} chunks` },
        { name: 'bm25-build', ms: corpus.bm25Ms, note: null },
        ...(persistMs > 0 ? [{ name: 'persist', ms: persistMs, note: 'Saved to browser storage (opt-in)' }] : []),
      ];
      const warning = document.emptyPages.length > 0 ? `Pages without extractable text: ${document.emptyPages.join(', ')}.` : null;
      const committed = this.jobs.commit(job, () => this.set({
        corpus,
        setup: observations,
        phase: 'keyword-ready',
        progress: null,
        notice: warning,
        viewerPage: document.pages[0]?.pageNumber ?? null,
      }));
      if (!committed) return;
      this.jobs.finish(job);
      if (this.state.model.status === 'ready') await this.buildDenseIndex();
    } catch (error) {
      if (!job.isCurrent()) return;
      this.jobs.finish(job);
      this.fail(error, 'idle');
    }
  }

  async ask(raw: string): Promise<void> {
    const corpus = this.state.corpus;
    if (!corpus || this.jobs.running()) return;
    let query: string;
    try {
      query = validateQuestion(raw);
    } catch (error) {
      this.fail(error, this.readyPhase());
      return;
    }
    const job = this.begin('ask', 'asking', 'Searching');
    this.set({ query, runs: {}, focus: null });
    const runs: Partial<Record<ArmId, ArmRun>> = {};
    for (const arm of ARMS) {
      const result = await runArm({
        arm,
        corpus,
        dense: this.dense,
        denseUnavailableReason: this.state.dense.reason,
        query,
        policy: this.state.policy,
        clock: this.services.clock,
        signal: job.signal,
      });
      if (!job.isCurrent()) return;
      runs[arm] = result;
      this.jobs.commit(job, () => this.set({ runs: { ...runs } }));
    }
    const answerArm = runs[this.state.answerArm]?.status === 'ok' ? this.state.answerArm : 'keyword';
    this.jobs.commit(job, () => this.set({ phase: this.readyPhase(), progress: null, answerArm }));
    this.jobs.finish(job);
  }

  setAnswerArm(arm: ArmId): void {
    this.set({ answerArm: arm, focus: null });
  }

  /** Focuses an answer-local citation alias. A cleared/replaced source shows "source unavailable". */
  focusCitation(arm: ArmId, alias: number): void {
    const excerpt = this.state.runs[arm]?.answer?.excerpts.find((item) => item.alias === alias);
    if (!excerpt) return;
    const corpus = this.state.corpus;
    const available = corpus !== null && corpus.revision === excerpt.citation.revision && corpus.document.contentHash === excerpt.citation.sourceHash;
    this.set({
      focus: { arm, alias, citation: excerpt.citation, sequence: (this.state.focus?.sequence ?? 0) + 1 },
      viewerPage: available ? excerpt.citation.pageNumber : this.state.viewerPage,
      notice: available ? null : 'Source unavailable: the document behind this citation was cleared or replaced.',
    });
  }

  showPage(pageNumber: number): void {
    this.set({ viewerPage: pageNumber });
  }

  cancel(): void {
    const running = this.jobs.running();
    if (!running) return;
    this.set({ phase: 'cancelling' });
    this.jobs.cancelCurrent();
    this.set({ phase: this.readyPhase(), progress: null, notice: 'Cancelled.' });
    if (running.kind === 'model-load') this.set({ model: { ...this.state.model, status: 'unloaded', message: 'Model load cancelled.' } });
    if (running.kind === 'index') this.set({ dense: { status: 'unavailable', reason: 'Dense indexing was cancelled. Keyword still works.', revision: null } });
    if ((running.kind === 'calibrate' || running.kind === 'benchmark') && (this.state.measurement.status === 'calibrating' || this.state.measurement.status === 'running')) {
      this.set({ measurement: { ...this.state.measurement, status: 'cancelled', message: 'Cancelled.' } });
    }
    this.syncModelAfterAbort();
  }

  /**
   * Cancelling an in-flight model request terminates the worker (it cannot abort inference), which
   * unloads the model. Reflect that so the UI never shows a stale "loading"/"ready" model or dense index.
   */
  private syncModelAfterAbort(): void {
    const dense = this.services.dense;
    if (!dense || this.state.model.status === 'unloaded' || this.state.model.status === 'error') return;
    if (dense.status() !== null) return;
    this.dense = null;
    this.set({
      model: { ...this.state.model, status: 'unloaded', backend: null, message: 'The model worker was stopped by a cancel or replace. Load the model again for embedding and hybrid.' },
      dense: { status: 'unavailable', reason: NO_DENSE_REASON, revision: null },
    });
  }

  // ---- Dense model (real model only; see DenseService) ----

  async loadModel(backend: BackendKind): Promise<void> {
    const dense = this.services.dense;
    // One job at a time: conflicting actions are refused here, not only disabled in the UI.
    if (!dense || this.jobs.running()) return;
    const job = this.begin('model-load', 'loading-model', 'Loading model');
    this.set({ model: { ...this.state.model, status: 'loading', message: null, fallbackFrom: null } });
    try {
      const status = await dense.load(backend, job.signal, (progress) => this.onProgress(job, progress));
      if (!this.jobs.commit(job, () => this.set({ model: { ...this.state.model, status: 'ready', backend: status.backend, initMs: status.initMs, message: null }, phase: this.readyPhase(), progress: null }))) return;
      this.jobs.finish(job);
      this.set({ setup: [...this.state.setup, { name: 'model-init', ms: status.initMs, note: `${status.identity.modelId} on ${status.backend}` }] });
      if (this.state.corpus) await this.buildDenseIndex();
    } catch (error) {
      if (!job.isCurrent()) return;
      this.jobs.finish(job);
      const message = errorMessage(error);
      const cancelled = error instanceof ActionableError && error.code === 'cancelled';
      this.set({ model: { ...this.state.model, status: cancelled ? 'unloaded' : 'error', message: backend === 'webgpu' && !cancelled ? `WebGPU failed: ${message} You can retry with WASM.` : message, fallbackFrom: backend === 'webgpu' ? 'webgpu' : null } });
      this.fail(error, this.readyPhase());
    }
  }

  async buildDenseIndex(): Promise<void> {
    const dense = this.services.dense;
    const corpus = this.state.corpus;
    const library = this.library;
    if (!dense || !corpus || !library || this.state.model.status !== 'ready') return;
    const job = this.begin('index', 'indexing', 'Embedding passages');
    this.dense = null;
    this.set({ dense: { status: 'indexing', reason: 'Building the dense index.', revision: null } });
    try {
      const built = await dense.buildIndex(corpus, library, job.signal, (progress) => this.onProgress(job, progress));
      const committed = this.jobs.commit(job, () => {
        if (this.state.corpus?.revision !== corpus.revision) return;
        this.dense = built.context;
        this.set({
          dense: { status: 'ready', reason: '', revision: corpus.revision },
          phase: 'full-ready',
          progress: null,
          setup: [
            ...this.state.setup,
            { name: 'passage-embed', ms: built.embedMs, note: built.cache === 'hit' ? 'Reused validated cached vectors' : `${corpus.chunks.length} passages embedded${built.cache === 'discarded' ? ' (stale cache discarded)' : ''}` },
            ...(built.persistMs > 0 ? [{ name: 'persist', ms: built.persistMs, note: 'Vectors saved (opt-in)' }] : []),
          ],
        });
      });
      if (committed) this.jobs.finish(job);
    } catch (error) {
      if (!job.isCurrent()) return;
      this.jobs.finish(job);
      // Keyword stays usable on the unchanged chunks; no partial dense readiness is published.
      this.set({ dense: { status: 'error', reason: `Dense index failed: ${errorMessage(error)} Keyword still works.`, revision: null } });
      this.fail(error, 'keyword-ready');
    }
  }

  async clearModelCache(): Promise<void> {
    const dense = this.services.dense;
    if (!dense) return;
    try {
      const result = await dense.clearModelCache();
      this.set({ notice: [`Cleared: ${result.cleared.length > 0 ? result.cleared.join(', ') : 'nothing found'}.`, ...result.notes].join(' ') });
    } catch (error) {
      this.fail(error, this.readyPhase());
    }
  }

  private onProgress(job: Job, progress: EmbedProgress): void {
    const label = progress.phase === 'download' ? 'Downloading model files' : progress.phase === 'init' ? 'Starting the model' : 'Embedding';
    this.jobs.commit(job, () => this.set({ progress: { label, done: progress.done, total: progress.total } }));
  }

  // ---- Measurements (bundled evaluation fixture only) ----

  loadEvaluationCorpus(): Promise<void> {
    const fixture = evaluationFixture();
    return this.loadDocument(() => Promise.resolve({
      document: fixture.document,
      setup: [{ name: 'fixture-prepare', ms: 0, note: 'Bundled evaluation text fixture; not a PDF extraction.' }],
    }), false);
  }

  private measurementReady(): { corpus: Corpus; fixture: ReturnType<typeof evaluationFixture> } | null {
    const corpus = this.state.corpus;
    const fixture = evaluationFixture();
    if (!corpus || corpus.document.contentHash !== fixture.document.contentHash) {
      this.set({ measurement: { ...this.state.measurement, status: 'error', message: 'Load the evaluation corpus first.' } });
      return null;
    }
    return { corpus, fixture };
  }

  /** Calibrates gates on the 12-question calibration split only, then freezes the policy. */
  async calibrate(): Promise<void> {
    if (this.jobs.running()) return;
    const ready = this.measurementReady();
    if (!ready) return;
    const job = this.begin('calibrate', 'benchmarking', 'Calibrating gates');
    this.set({ measurement: { ...this.state.measurement, status: 'calibrating', message: null } });
    try {
      const result = await runCalibration({
        fixture: ready.fixture,
        corpus: ready.corpus,
        dense: this.dense,
        denseUnavailableReason: this.state.dense.reason || NO_DENSE_REASON,
        clock: this.services.clock,
        signal: job.signal,
        runId: newRunId('cal'),
        createdAt: new Date().toISOString(),
        onProgress: (done, total) => { this.jobs.commit(job, () => this.set({ progress: { label: 'Calibrating', done, total } })); },
      });
      const message = result.policy.source === 'uncalibrated-default'
        ? 'Calibration was incomplete; the uncalibrated defaults are kept.'
        : 'Gates frozen from the calibration split.';
      const committed = this.jobs.commit(job, () => this.set({
        policy: result.policy,
        phase: this.readyPhase(),
        progress: null,
        measurement: { ...this.state.measurement, status: 'done', calibration: result, message },
      }));
      if (committed) this.jobs.finish(job);
    } catch (error) {
      if (!job.isCurrent()) return;
      this.jobs.finish(job);
      this.set({ measurement: { ...this.state.measurement, status: isCancel(error) ? 'cancelled' : 'error', message: errorMessage(error) } });
      this.fail(error, this.readyPhase());
    }
  }

  /** Runs the fixed protocol on the untouched 24-question evaluation split with the frozen policy. */
  async runBenchmark(): Promise<void> {
    if (this.jobs.running()) return;
    const ready = this.measurementReady();
    if (!ready) return;
    const job = this.begin('benchmark', 'benchmarking', 'Running measurements');
    this.set({ measurement: { ...this.state.measurement, status: 'running', message: null } });
    try {
      const report = await runBenchmark({
        fixture: ready.fixture,
        corpus: ready.corpus,
        dense: this.dense,
        denseUnavailableReason: this.state.dense.reason || NO_DENSE_REASON,
        model: this.services.dense?.status() ?? null,
        policy: this.state.policy,
        calibration: this.state.measurement.calibration,
        clock: this.services.clock,
        signal: job.signal,
        environment: this.services.environment.snapshot(),
        wasmThreads: this.services.environment.wasmThreads(),
        sourceRevision: this.services.sourceRevision,
        runId: newRunId('run'),
        createdAt: new Date().toISOString(),
        setup: this.state.setup.map(toSetupObservation),
        onProgress: (done, total) => { this.jobs.commit(job, () => this.set({ progress: { label: 'Measuring', done, total } })); },
      });
      const valid = isMeasurementReport(report);
      if (report.status === 'cancelled') {
        // Cancel already moved the UI on; keep the completed diagnostic rows visible, marked cancelled.
        if (this.state.corpus?.revision === ready.corpus.revision) {
          this.set({ measurement: { ...this.state.measurement, status: 'cancelled', report, message: 'Cancelled: completed rows are kept; remaining rows are marked cancelled.' } });
        }
        return;
      }
      const committed = this.jobs.commit(job, () => this.set({
        phase: this.readyPhase(),
        progress: null,
        measurement: { ...this.state.measurement, status: 'done', report, message: valid ? null : 'The report failed validation and was not saved.' },
      }));
      if (!committed) return;
      this.jobs.finish(job);
      if (valid) await this.library?.putReport(report);
    } catch (error) {
      if (!job.isCurrent()) return;
      this.jobs.finish(job);
      this.set({ measurement: { ...this.state.measurement, status: isCancel(error) ? 'cancelled' : 'error', message: errorMessage(error) } });
      this.fail(error, this.readyPhase());
    }
  }

  /** JSON text of the current report (bundled fixture data only); throws when invalid. */
  exportReport(): string | null {
    const report = this.state.measurement.report;
    return report ? exportReportJson(report) : null;
  }

  private async loadStoredReport(): Promise<void> {
    const raw = await this.library?.getReport().catch(() => null);
    if (raw && isMeasurementReport(raw)) {
      this.set({ measurement: { ...this.state.measurement, report: raw, message: 'Showing the last saved measurement report.' } });
    }
  }

  // ---- Data controls ----

  /**
   * Delete all: invalidates work first, then clears documents/pages/chunks/vectors/answers/reports/settings.
   * The model cache is separate (clearModelCache). Reload checks remain later evidence.
   */
  async deleteAll(): Promise<void> {
    this.jobs.invalidateAll();
    this.dense = null;
    this.syncModelAfterAbort();
    this.set({ measurement: { status: 'idle', message: null, report: null, calibration: null } });
    this.set({ corpus: null, runs: {}, query: null, focus: null, viewerPage: null, setup: [], phase: 'idle', progress: null, dense: { status: 'unavailable', reason: idleDenseReason(this.services), revision: null }, policy: DEFAULT_POLICY });
    // Every clear step runs even if an earlier one fails; the first failure is reported afterwards.
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void> | void): Promise<void> => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    };
    try {
      await attempt(() => this.library?.clearAll());
      await attempt(() => this.library?.close());
      this.library = null;
      await attempt(() => this.services.deleteDatabase());
      await attempt(() => this.services.preferences.clear());
      await this.openLibrary(false);
      if (failures.length > 0) throw failures[0];
      this.set({ notice: 'All documents, vectors, answers, reports and settings stored by this app were deleted. The model cache is cleared separately.' });
    } catch (error) {
      this.fail(error, 'idle');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.libraryEpoch += 1;
    this.jobs.invalidateAll();
    this.services.dense?.dispose();
    this.library?.close();
    this.library = null;
    this.listeners.clear();
  }
}
