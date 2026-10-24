import type {
  AnswerMode,
  AnswerView,
  ArmId,
  ArmView,
  AskResult,
  Chunk,
  Embedder,
  LoadedDocument,
  LocalGenerator,
  ScoredHit,
} from '../domain.ts';
import { MAX_QUESTION_CHARS, RETRIEVE_K } from './config.ts';
import { ActionableError, errorMessage } from './errors.ts';
import { extractiveAnswer } from './extractive.ts';
import { buildGroundedPrompt, groundGeneratedText } from './grounding.ts';
import {
  embeddingAbstained,
  embeddingHits,
  fusionPool,
  hybridAbstained,
  hybridHits,
  keywordAbstained,
  keywordHits,
} from './retrieve.ts';

export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };
}

export interface AskInput {
  document: LoadedDocument;
  query: string;
  embedder: Embedder | null;
  generator: LocalGenerator | null;
  mode: AnswerMode;
  answerArm?: ArmId;
  clock?: Clock;
}

export async function askQuestion(input: AskInput): Promise<AskResult> {
  const query = input.query.trim();
  if (query === '') {
    throw new ActionableError('empty-question', 'Enter a question first.');
  }
  if (query.length > MAX_QUESTION_CHARS) {
    throw new ActionableError('question-too-long', `Keep the question under ${MAX_QUESTION_CHARS} characters.`);
  }

  const clock = input.clock ?? systemClock();
  const chunks = input.document.chunks;
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const pool = fusionPool();

  const keywordStarted = clock.now();
  const keyword = keywordHits(chunks, query, pool);
  const keywordMs = clock.now() - keywordStarted;

  const embeddingState = await embedArm(input, query, clock);
  const keywordView = armView('keyword', true, undefined, keyword, keywordAbstained(keyword), keywordMs, chunkMap);
  const embeddingView = embeddingState.view;
  const hybridView = hybridViewFor(keyword, embeddingState, chunkMap, clock);

  const arms = [keywordView, embeddingView, hybridView];
  const answerArm = chooseArm(input.answerArm, arms);
  const selected = arms.find((arm) => arm.arm === answerArm) ?? null;
  const answer = await answerFromArm(input, query, selected, chunkMap, clock);
  return { arms, answer, answerArm };
}

async function embedArm(
  input: AskInput,
  query: string,
  clock: Clock,
): Promise<{ view: ArmView; hits: ScoredHit[] }> {
  const chunks = input.document.chunks;
  const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const reason = embeddingBlockReason(input.document, input.embedder);
  if (reason || !input.embedder || !input.document.vectors) {
    return {
      hits: [],
      view: armView('embedding', false, reason ?? 'Load the embedding model and embed this document.', [], true, 0, chunkMap),
    };
  }

  const started = clock.now();
  try {
    const embedded = await input.embedder.embed([query]);
    const queryVector = embedded[0];
    if (!queryVector || queryVector.length === 0) {
      throw new ActionableError(
        'embedding-output-unexpected',
        'The embedding model returned no query vector. No result was invented.',
      );
    }
    const hits = embeddingHits(chunks, input.document.vectors, queryVector, fusionPool());
    const elapsed = clock.now() - started;
    return {
      hits,
      view: armView('embedding', true, undefined, hits, embeddingAbstained(hits), elapsed, chunkMap),
    };
  } catch (error) {
    const elapsed = clock.now() - started;
    return {
      hits: [],
      view: armView('embedding', false, errorMessage(error), [], true, elapsed, chunkMap),
    };
  }
}

function hybridViewFor(
  keyword: ScoredHit[],
  embeddingState: { view: ArmView; hits: ScoredHit[] },
  chunkMap: Map<string, Chunk>,
  clock: Clock,
): ArmView {
  if (!embeddingState.view.available) {
    return armView(
      'hybrid',
      false,
      'Hybrid search needs both the keyword arm and the embedding arm.',
      [],
      true,
      0,
      chunkMap,
    );
  }
  const started = clock.now();
  const hits = hybridHits(keyword.slice(0, fusionPool()), embeddingState.hits.slice(0, fusionPool()), RETRIEVE_K);
  const fuseMs = clock.now() - started;
  const deepKeyword = keyword.slice(0, fusionPool());
  const abstained = hybridAbstained(keywordAbstained(deepKeyword), embeddingState.view.abstained);
  return armView('hybrid', true, undefined, hits, abstained, fuseMs, chunkMap);
}

function armView(
  arm: ArmId,
  available: boolean,
  unavailableReason: string | undefined,
  hits: ScoredHit[],
  abstained: boolean,
  retrieveMs: number,
  chunkMap: Map<string, Chunk>,
): ArmView {
  const shown = hits.slice(0, RETRIEVE_K).map((hit, index) => {
    const chunk = chunkMap.get(hit.chunkId);
    return {
      ...hit,
      rank: index + 1,
      chunk: chunk ?? emptyChunk(hit.chunkId),
    };
  });
  return {
    arm,
    available,
    unavailableReason,
    hits: shown.filter((hit) => chunkMap.has(hit.chunkId)),
    abstained,
    retrieveMs,
  };
}

function emptyChunk(id: string): Chunk {
  return { id, text: '', pageStart: 0, pageEnd: 0, spans: [] };
}

export function embeddingBlockReason(document: LoadedDocument, embedder: Embedder | null): string | null {
  if (!embedder) {
    if (document.vectors && document.embeddingModel) {
      return `Saved vectors were built with ${document.embeddingModel}. Load that model to search them. Keyword results still work.`;
    }
    return 'Load the embedding model to enable this arm. Keyword results still work.';
  }
  if (!document.vectors || !document.embeddingModel) {
    return 'Embed this document to use this arm. Keyword results still work.';
  }
  if (document.embeddingModel !== embedder.modelId) {
    return `Saved vectors are for ${document.embeddingModel}. The loaded model is ${embedder.modelId}. Embed the document again.`;
  }
  return null;
}

function chooseArm(requested: ArmId | undefined, arms: ArmView[]): ArmId | null {
  if (requested) {
    const match = arms.find((arm) => arm.arm === requested);
    if (match?.available) return requested;
    return null;
  }
  const hybrid = arms.find((arm) => arm.arm === 'hybrid');
  if (hybrid?.available) return 'hybrid';
  const keyword = arms.find((arm) => arm.arm === 'keyword');
  if (keyword?.available) return 'keyword';
  return null;
}

async function answerFromArm(
  input: AskInput,
  query: string,
  selected: ArmView | null,
  chunkMap: Map<string, Chunk>,
  clock: Clock,
): Promise<AnswerView> {
  if (!selected) {
    return {
      mode: input.mode,
      abstained: true,
      reason: 'The selected arm is unavailable.',
      sentences: [],
      text: '',
      generateMs: 0,
    };
  }
  const hits = selected.hits.map((hit) => ({ chunkId: hit.chunkId, score: hit.score, rank: hit.rank }));
  if (input.mode === 'local-model') {
    return localAnswer(input.generator, query, hits, chunkMap, selected.abstained, clock);
  }
  const started = clock.now();
  const extracted = extractiveAnswer(query, hits, chunkMap, selected.abstained);
  return { mode: 'extractive', ...extracted, generateMs: clock.now() - started };
}

async function localAnswer(
  generator: LocalGenerator | null,
  query: string,
  hits: ScoredHit[],
  chunkMap: Map<string, Chunk>,
  retrievalAbstained: boolean,
  clock: Clock,
): Promise<AnswerView> {
  if (retrievalAbstained || hits.length === 0) {
    return {
      mode: 'local-model',
      abstained: true,
      reason: 'Retrieval abstained, so the local model was not called.',
      sentences: [],
      text: '',
      generateMs: 0,
    };
  }
  if (!generator) {
    return {
      mode: 'local-model',
      abstained: true,
      reason: 'The local model is not loaded. The extractive answer is still available.',
      sentences: [],
      text: '',
      generateMs: 0,
    };
  }
  const prompt = buildGroundedPrompt(
    query,
    hits.map((hit) => ({ rank: hit.rank, text: chunkMap.get(hit.chunkId)?.text ?? '' })),
  );
  const started = clock.now();
  try {
    const generated = await generator.generate(prompt);
    const grounded = groundGeneratedText(generated, hits, chunkMap);
    return { mode: 'local-model', ...grounded, generateMs: clock.now() - started };
  } catch (error) {
    return {
      mode: 'local-model',
      abstained: true,
      reason: errorMessage(error),
      sentences: [],
      text: '',
      generateMs: clock.now() - started,
    };
  }
}
