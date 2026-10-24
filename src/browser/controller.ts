import type { ArmId, BackendKind, CitationId, DocumentRecord, EnvironmentSnapshot, GatePolicy, JobState } from '../domain.ts';
import { ARMS } from '../domain.ts';
import type { DocumentSummary, EmbedProgress, LibraryStore } from '../ports.ts';
import { importLocalFile, type FileLike } from '../adapters/fileImport.ts';
import { harborDocument } from '../data/harborLine.ts';
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
  focus: { arm: ArmId; alias: number; citation: CitationId } | null;
  viewerPage: number | null;
  model: { status: ModelStatus; backend: BackendKind | null; message: string | null; initMs: number | null; webgpuAvailable: boolean | null; fallbackFrom: BackendKind | null };
  dense: { status: DenseStatus; reason: string; revision: string | null };
  policy: GatePolicy;
  environment: EnvironmentSnapshot;
  /** Registry facts shown before consent; null when this build has no dense service. */
  modelInfo: { modelId: string; revision: string; dtype: string; estimate: string; origins: readonly string[] } | null;
}

type Listener = () => void;

function idleDenseReason(services: Services): string {
  return services.dense ? NO_DENSE_REASON : 'Dense retrieval is not available in this build.';
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
    await this.openLibrary(this.state.persistence.enabled);
    const probe = await this.services.environment.probeWebGpu(1500);
    this.set({ model: { ...this.state.model, webgpuAvailable: probe } });
  }

  private async openLibrary(persistent: boolean): Promise<void> {
    this.library?.close();
    const library = await this.services.openLibrary(persistent);
    this.library = library;
    const documents = await library.listDocuments().catch(() => []);
    this.set({
      persistence: { enabled: persistent, kind: library.kind, warning: library.warning },
      library: documents,
    });
  }

  /** Explicit opt-in. Turning it off does not delete stored data; "Delete all" does. */
  async setPersistence(enabled: boolean): Promise<void> {
    this.services.preferences.setPersistence(enabled);
    await this.openLibrary(enabled);
    const corpus = this.state.corpus;
    if (enabled && corpus && corpus.document.sourceType !== 'fixture') await this.persistDocument(corpus.document);
  }

  private async persistDocument(document: DocumentRecord): Promise<number> {
    if (!this.library || this.library.kind !== 'indexeddb' || document.sourceType === 'fixture') return 0;
    const started = this.services.clock.now();
    await this.library.putDocument(document);
    const ms = this.services.clock.now() - started;
    this.set({ library: await this.library.listDocuments() });
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
      this.jobs.commit(job, () => this.set({
        corpus,
        setup: observations,
        phase: 'keyword-ready',
        progress: null,
        notice: warning,
        viewerPage: document.pages[0]?.pageNumber ?? null,
      }));
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
    if (!corpus) return;
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
      focus: { arm, alias, citation: excerpt.citation },
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
  }

  // ---- Dense model (real model only; see DenseService) ----

  async loadModel(backend: BackendKind): Promise<void> {
    const dense = this.services.dense;
    if (!dense) return;
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

  // ---- Data controls ----

  /**
   * Delete all: invalidates work first, then clears documents/pages/chunks/vectors/answers/reports/settings.
   * The model cache is separate (clearModelCache). Reload checks remain later evidence.
   */
  async deleteAll(): Promise<void> {
    this.jobs.invalidateAll();
    this.dense = null;
    this.set({ corpus: null, runs: {}, query: null, focus: null, viewerPage: null, setup: [], phase: 'idle', progress: null, dense: { status: 'unavailable', reason: idleDenseReason(this.services), revision: null }, policy: DEFAULT_POLICY });
    try {
      await this.library?.clearAll();
      this.library?.close();
      this.library = null;
      await this.services.deleteDatabase().catch(() => undefined);
      this.services.preferences.clear();
      await this.openLibrary(false);
      this.set({ notice: 'All documents, vectors, answers, reports and settings stored by this app were deleted. The model cache is cleared separately.' });
      this.afterDeleteAll();
    } catch (error) {
      this.fail(error, 'idle');
    }
  }

  /** Hook for later packages (measurement state reset). */
  protected afterDeleteAll(): void {}

  dispose(): void {
    this.jobs.invalidateAll();
    this.services.dense?.dispose();
    this.library?.close();
    this.listeners.clear();
  }
}
