import type {
  ArmId,
  ArmReport,
  Embedder,
  EnvironmentSnapshot,
  LabelledQuestion,
  LoadedDocument,
  MeasurementReport,
  PageText,
  QuestionArmReport,
  QuestionReport,
  StageReport,
} from '../domain.ts';
import { REPORT_SCHEMA, RETRIEVE_K } from './config.ts';
import { errorMessage } from './errors.ts';
import { askQuestion, systemClock, type Clock } from './ask.ts';
import { meanReciprocalRank, nearestRankPercentiles, recallAtK } from './metrics.ts';
import { serializePages, pagesFromPlainText } from './textExtract.ts';
import { documentFromPages, embedLoadedDocument } from '../session.ts';

const ARMS: ArmId[] = ['keyword', 'embedding', 'hybrid'];
const RECALL_KS = [1, 3, 5];

export interface MeasureInput {
  documentName: string;
  pages: PageText[];
  questions: LabelledQuestion[];
  embedder: Embedder | null;
  clock?: Clock;
  nowIso?: string;
  environment?: EnvironmentSnapshot;
}

export async function runMeasurement(input: MeasureInput): Promise<MeasurementReport> {
  const clock = input.clock ?? systemClock();
  const notes = [
    'Percentiles use the nearest-rank method. With fewer than 20 questions, p95 and p99 describe this sample. They are not a stable tail estimate.',
    'The bundled manual is four short pages, so the 900 character window keeps each page in one chunk. Recall here ranks pages.',
    'Answer timings are the extractive answerer. This harness does not call a local language model.',
  ];

  const extractStarted = clock.now();
  const extracted = pagesFromPlainText(serializePages(input.pages));
  const extractMs = clock.now() - extractStarted;
  let document = documentFromPages(
    input.documentName,
    extracted,
    { extractMs },
    { id: 'measurement', savedAt: input.nowIso ?? new Date().toISOString() },
    clock,
  );

  const embedSamples: number[] = [];
  let embedSkip: string | undefined;
  if (!input.embedder) {
    embedSkip = 'No embedder was provided.';
    notes.push('Embedding and hybrid arms did not run because no embedder was provided.');
  } else {
    try {
      const embedded = await embedLoadedDocument(document, input.embedder, clock);
      document = embedded.document;
      embedSamples.push(embedded.embedMs);
      notes.push(`Embeddings used ${input.embedder.modelId} (${input.embedder.dtype}, ${input.embedder.backend}).`);
    } catch (error) {
      embedSkip = errorMessage(error);
      notes.push(`Embedding and hybrid arms did not run: ${embedSkip}`);
    }
  }

  const retrieveSamples: Record<ArmId, number[]> = { keyword: [], embedding: [], hybrid: [] };
  const answerSamples: number[] = [];
  const questionReports: QuestionReport[] = [];
  let answerArm: ArmId | null = null;

  for (const question of input.questions) {
    const result = await askQuestion({
      document,
      query: question.prompt,
      embedder: document.vectors ? input.embedder : null,
      generator: null,
      mode: 'extractive',
      clock,
    });
    answerArm = result.answerArm;
    answerSamples.push(result.answer.generateMs);
    const arms = {} as Record<ArmId, QuestionArmReport>;
    for (const arm of result.arms) {
      if (arm.available) retrieveSamples[arm.arm].push(arm.retrieveMs);
      arms[arm.arm] = {
        available: arm.available,
        firstRelevantRank: arm.available ? firstRelevantRank(arm.hits, question.goldQuotes) : null,
        abstained: arm.available ? arm.abstained : false,
        topScore: arm.available ? (arm.hits[0]?.score ?? null) : null,
      };
    }
    questionReports.push({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      arms,
    });
  }

  const environment = environmentFor(input, document);
  return {
    schema: REPORT_SCHEMA,
    startedAt: input.nowIso ?? new Date().toISOString(),
    documentName: input.documentName,
    chunkCount: document.chunks.length,
    questionCount: input.questions.length,
    answerableCount: input.questions.filter((question) => !question.expectAbstain).length,
    answerer: 'extractive',
    answerArm,
    arms: ARMS.map((arm) => armReport(arm, input.questions, questionReports)),
    stages: [
      stage('extract', null, [extractMs]),
      stage('chunk', null, [document.chunkMs]),
      stage('embed', null, embedSamples, embedSkip),
      ...ARMS.map((arm) => stage(
        'retrieve',
        arm,
        retrieveSamples[arm],
        retrieveSamples[arm].length === 0 ? 'This arm did not run.' : undefined,
      )),
      stage('answer', answerArm, answerSamples),
    ],
    questions: questionReports,
    environment,
    notes,
  };
}

export function isMeasurementReport(value: unknown): value is MeasurementReport {
  if (!value || typeof value !== 'object') return false;
  return (value as { schema?: unknown }).schema === REPORT_SCHEMA;
}

function firstRelevantRank(hits: { rank: number; chunk: { text: string } }[], quotes: string[]): number | null {
  for (const hit of hits) {
    const haystack = hit.chunk.text.toLowerCase();
    if (quotes.some((quote) => haystack.includes(quote.toLowerCase()))) return hit.rank;
  }
  return null;
}

function armReport(arm: ArmId, questions: LabelledQuestion[], reports: QuestionReport[]): ArmReport {
  const rows = reports.map((report, index) => ({ report: report.arms[arm], question: questions[index] }));
  const available = rows.some((row) => row.report?.available);
  const unavailableReason = available ? undefined : rows[0]?.report?.available === false
    ? 'This arm did not run for the harness.'
    : undefined;
  const answerable = rows.filter((row) => row.question && !row.question.expectAbstain && row.report?.available);
  const ranks = answerable.map((row) => row.report?.firstRelevantRank ?? null);
  const abstainRows = rows.filter((row) => row.question?.expectAbstain && row.report?.available);
  return {
    arm,
    available,
    unavailableReason: available ? undefined : (armUnavailableNote(arm, unavailableReason)),
    recallAt: available ? RECALL_KS.map((k) => ({ k, recall: recallAtK(ranks, k) })) : [],
    mrr: available ? meanReciprocalRank(ranks) : null,
    abstain: {
      expected: abstainRows.length,
      correct: abstainRows.filter((row) => row.report?.abstained).length,
    },
  };
}

function armUnavailableNote(arm: ArmId, fallback: string | undefined): string {
  if (arm === 'keyword') return fallback ?? 'Keyword search did not run.';
  if (arm === 'embedding') return 'The embedding arm did not run. Load an embedder and embed the document first.';
  return 'Hybrid search did not run. It needs the keyword arm and the embedding arm.';
}

function stage(stageName: StageReport['stage'], arm: ArmId | null, samples: number[], skippedReason?: string): StageReport {
  const summary = nearestRankPercentiles(samples);
  return {
    stage: stageName,
    arm,
    n: summary.n,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    p99Ms: summary.p99Ms,
    samplesMs: samples,
    skippedReason: summary.n === 0 ? skippedReason : undefined,
  };
}

function environmentFor(input: MeasureInput, document: LoadedDocument): EnvironmentSnapshot {
  const base = input.environment ?? {
    userAgent: 'not collected',
    hardwareConcurrency: null,
    deviceMemoryGb: null,
    webgpu: null,
    embeddingBackend: 'unavailable',
    embeddingModel: null,
    embeddingDtype: null,
    language: null,
  };
  return {
    ...base,
    embeddingBackend: document.embeddingBackend ?? input.embedder?.backend ?? 'unavailable',
    embeddingModel: document.embeddingModel,
    embeddingDtype: document.embeddingDtype,
  };
}

export const MEASUREMENT_TOP_K = RETRIEVE_K;
