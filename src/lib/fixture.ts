import type { DocumentRecord, EvidenceUnit, LabelledQuestion, Page, QuestionKind, Suite } from '../domain.ts';
import { isNegativeKind } from '../domain.ts';
import type { Corpus } from '../session.ts';
import { EXTRACTION_VERSION_FIXTURE } from './config.ts';
import { ActionableError } from './errors.ts';
import { pagesHash } from './hash.ts';
import { unitCovered, type RetrievedSpan } from './metrics.ts';

export const FIXTURE_MIN_CHUNKS = 16;

/** Frozen per-split counts (PLAN.md section 6). Negatives include hard negatives. */
export const EXPECTED_SPLIT_COUNTS: Record<'calibration' | 'evaluation', Record<'lexical' | 'paraphrase' | 'multi-evidence' | 'negatives', number>> = {
  calibration: { lexical: 2, paraphrase: 2, 'multi-evidence': 2, negatives: 6 },
  evaluation: { lexical: 6, paraphrase: 8, 'multi-evidence': 4, negatives: 6 },
};

export interface CorpusFile {
  fixtureId: string;
  fixtureVersion: string;
  displayName: string;
  extractionVersion: string;
  contentHash: string;
  provenance: string;
  pages: Page[];
}

export interface SplitFile {
  fixtureId: string;
  fixtureVersion: string;
  split: string;
  sourceHash: string;
  questions: LabelledQuestion[];
}

export interface EvaluationFixture {
  fixtureId: string;
  fixtureVersion: string;
  document: DocumentRecord;
  calibration: LabelledQuestion[];
  evaluation: LabelledQuestion[];
}

const KINDS: readonly QuestionKind[] = ['lexical', 'paraphrase', 'multi-evidence', 'negative', 'hard-negative'];

/** Parses the frozen JSON files into typed fixture records; shape errors throw. */
export function parseEvaluationFixture(corpus: unknown, calibration: unknown, evaluation: unknown): EvaluationFixture {
  const corpusFile = asCorpusFile(corpus);
  const calibrationFile = asSplitFile(calibration, 'calibration');
  const evaluationFile = asSplitFile(evaluation, 'evaluation');
  for (const file of [calibrationFile, evaluationFile]) {
    if (file.fixtureId !== corpusFile.fixtureId || file.fixtureVersion !== corpusFile.fixtureVersion) {
      throw invalid([`${file.split} split belongs to ${file.fixtureId}/${file.fixtureVersion}, not the corpus.`]);
    }
  }
  return {
    fixtureId: corpusFile.fixtureId,
    fixtureVersion: corpusFile.fixtureVersion,
    document: {
      id: `fixture:${corpusFile.fixtureId}:${corpusFile.fixtureVersion}`,
      contentHash: corpusFile.contentHash,
      displayName: corpusFile.displayName,
      sourceType: 'fixture',
      extractionVersion: EXTRACTION_VERSION_FIXTURE,
      pages: corpusFile.pages.map((page) => ({ pageNumber: page.pageNumber, canonicalText: page.canonicalText })),
      emptyPages: [],
    },
    calibration: calibrationFile.questions,
    evaluation: evaluationFile.questions,
  };
}

/**
 * Validates a fixture against its built corpus. Any absent, ambiguous or unmappable evidence invalidates
 * the fixture/run; it is never a dropped question or an ordinary miss. Returns the problem list (empty = valid).
 */
export function fixtureProblems(fixture: EvaluationFixture, corpus: Corpus): string[] {
  const problems: string[] = [];
  const actualHash = pagesHash(fixture.document.pages);
  if (actualHash !== fixture.document.contentHash) problems.push(`Corpus hash ${actualHash} does not match declared ${fixture.document.contentHash}.`);
  if (corpus.document.contentHash !== fixture.document.contentHash) problems.push('Built corpus is not this fixture.');
  if (corpus.chunks.length < FIXTURE_MIN_CHUNKS) problems.push(`Fixture produced ${corpus.chunks.length} chunks; at least ${FIXTURE_MIN_CHUNKS} are required.`);

  const allIds = new Set<string>();
  const calibrationText = new Set(fixture.calibration.map((question) => normalizeQuestion(question.text)));
  for (const [split, questions] of [['calibration', fixture.calibration], ['evaluation', fixture.evaluation]] as const) {
    problems.push(...countProblems(split, questions));
    for (const question of questions) {
      if (question.suite !== split) problems.push(`${question.id}: suite ${question.suite} in ${split} split.`);
      if (allIds.has(question.id)) problems.push(`${question.id}: duplicate question id.`);
      allIds.add(question.id);
      if (split === 'evaluation' && calibrationText.has(normalizeQuestion(question.text))) {
        problems.push(`${question.id}: text also appears in the calibration split.`);
      }
      problems.push(...unitProblems(question, corpus));
    }
  }
  return problems;
}

export function assertFixtureValid(fixture: EvaluationFixture, corpus: Corpus): void {
  const problems = fixtureProblems(fixture, corpus);
  if (problems.length > 0) throw invalid(problems);
}

/** Problems with one question's evidence units against a corpus (also used for the tutorial suite). */
export function unitProblems(question: LabelledQuestion, corpus: Corpus): string[] {
  const problems: string[] = [];
  const negative = isNegativeKind(question.kind);
  if (negative && question.evidenceUnits.length > 0) problems.push(`${question.id}: negatives must have no evidence units.`);
  if (!negative && question.evidenceUnits.length === 0) problems.push(`${question.id}: answerable question without evidence units.`);
  const unitIds = new Set<string>();
  for (const unit of question.evidenceUnits) {
    if (unitIds.has(unit.unitId)) problems.push(`${question.id}: duplicate unit id ${unit.unitId}.`);
    unitIds.add(unit.unitId);
    if (unit.sourceHash !== corpus.document.contentHash) problems.push(`${unit.unitId}: source hash mismatch.`);
    const page = corpus.pageByNumber.get(unit.pageNumber);
    if (!page) {
      problems.push(`${unit.unitId}: page ${unit.pageNumber} does not exist.`);
      continue;
    }
    if (!(Number.isInteger(unit.start) && Number.isInteger(unit.end) && unit.start >= 0 && unit.end > unit.start && unit.end <= page.canonicalText.length)) {
      problems.push(`${unit.unitId}: invalid bounds.`);
      continue;
    }
    if (page.canonicalText.slice(unit.start, unit.end) !== unit.quote) problems.push(`${unit.unitId}: quote is not the canonical slice.`);
    const all: RetrievedSpan[] = corpus.chunks
      .filter((chunk) => chunk.pageNumber === unit.pageNumber)
      .map((chunk) => ({ sourceHash: corpus.document.contentHash, pageNumber: chunk.pageNumber, start: chunk.start, end: chunk.end }));
    if (!unitCovered(unit, all, all.length)) problems.push(`${unit.unitId}: not coverable by the finalized chunk intervals.`);
  }
  return problems;
}

/** Builds evidence units for authored in-source data (the tutorial) by unique exact quote lookup. */
export function unitsFromQuotes(questionId: string, pages: readonly Page[], sourceHash: string, quotes: readonly string[]): EvidenceUnit[] {
  return quotes.map((quote, index) => {
    const matches: { pageNumber: number; start: number }[] = [];
    for (const page of pages) {
      let from = 0;
      for (;;) {
        const at = page.canonicalText.indexOf(quote, from);
        if (at < 0) break;
        matches.push({ pageNumber: page.pageNumber, start: at });
        from = at + 1;
      }
    }
    const match = matches[0];
    if (!match || matches.length !== 1) {
      throw invalid([`${questionId}: quote ${matches.length === 0 ? 'absent' : 'ambiguous'}: ${quote}`]);
    }
    return { unitId: `${questionId}#${index + 1}`, sourceHash, pageNumber: match.pageNumber, start: match.start, end: match.start + quote.length, quote };
  });
}

function countProblems(split: 'calibration' | 'evaluation', questions: readonly LabelledQuestion[]): string[] {
  const counts = { lexical: 0, paraphrase: 0, 'multi-evidence': 0, negatives: 0 };
  for (const question of questions) {
    if (isNegativeKind(question.kind)) counts.negatives += 1;
    else counts[question.kind as 'lexical' | 'paraphrase' | 'multi-evidence'] += 1;
  }
  const expected = EXPECTED_SPLIT_COUNTS[split];
  return (Object.keys(expected) as (keyof typeof expected)[])
    .filter((key) => counts[key] !== expected[key])
    .map((key) => `${split}: expected ${expected[key]} ${key}, found ${counts[key]}.`);
}

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function invalid(problems: string[]): ActionableError {
  return new ActionableError('fixture-invalid', `The evaluation fixture is invalid: ${problems.join(' ')}`);
}

function asCorpusFile(value: unknown): CorpusFile {
  const record = asRecord(value, 'corpus');
  const pages = asArray(record.pages, 'corpus.pages').map((page, index) => {
    const item = asRecord(page, `corpus.pages[${index}]`);
    return { pageNumber: asInteger(item.pageNumber, 'pageNumber'), canonicalText: asString(item.canonicalText, 'canonicalText') };
  });
  return {
    fixtureId: asString(record.fixtureId, 'fixtureId'),
    fixtureVersion: asString(record.fixtureVersion, 'fixtureVersion'),
    displayName: asString(record.displayName, 'displayName'),
    extractionVersion: asString(record.extractionVersion, 'extractionVersion'),
    contentHash: asString(record.contentHash, 'contentHash'),
    provenance: asString(record.provenance, 'provenance'),
    pages,
  };
}

function asSplitFile(value: unknown, split: 'calibration' | 'evaluation'): SplitFile {
  const record = asRecord(value, split);
  if (record.split !== split) throw invalid([`Expected the ${split} split file.`]);
  const questions = asArray(record.questions, `${split}.questions`).map((raw, index) => {
    const item = asRecord(raw, `${split}.questions[${index}]`);
    const kind = asString(item.kind, 'kind') as QuestionKind;
    if (!KINDS.includes(kind)) throw invalid([`Unknown question kind ${kind}.`]);
    const suite = asString(item.suite, 'suite') as Suite;
    const units = asArray(item.evidenceUnits, 'evidenceUnits').map((unitRaw) => {
      const unit = asRecord(unitRaw, 'evidenceUnit');
      return {
        unitId: asString(unit.unitId, 'unitId'),
        sourceHash: asString(unit.sourceHash, 'sourceHash'),
        pageNumber: asInteger(unit.pageNumber, 'pageNumber'),
        start: asInteger(unit.start, 'start'),
        end: asInteger(unit.end, 'end'),
        quote: asString(unit.quote, 'quote'),
      };
    });
    return { id: asString(item.id, 'id'), suite, kind, text: asString(item.text, 'text'), evidenceUnits: units };
  });
  return {
    fixtureId: asString(record.fixtureId, 'fixtureId'),
    fixtureVersion: asString(record.fixtureVersion, 'fixtureVersion'),
    split,
    sourceHash: asString(record.sourceHash, 'sourceHash'),
    questions,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid([`${label} must be an object.`]);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw invalid([`${label} must be an array.`]);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalid([`${label} must be a string.`]);
  return value;
}

function asInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid([`${label} must be an integer.`]);
  return value;
}
