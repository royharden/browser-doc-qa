import type { DocumentRecord, LabelledQuestion, Page } from '../domain.ts';
import { EXTRACTION_VERSION_FIXTURE } from '../lib/config.ts';
import { unitsFromQuotes } from '../lib/fixture.ts';
import { pagesHash } from '../lib/hash.ts';

/**
 * Harbor Line Ferry: the original four-page tutorial/smoke document. It introduces the app and backs
 * small contract tests. It is intentionally too small to be a quality benchmark (PLAN.md section 6).
 */
export const SAMPLE_DOCUMENT_NAME = 'Harbor Line Ferry manual (tutorial)';

export const QUOTE_WEEKDAY = 'The last weekday departure from Pier 4 is 10:40 p.m.';
export const QUOTE_SENIOR = 'The senior fare is 7 dollars with photo identification.';
export const QUOTE_JACKETS = 'Life jackets are stored in the port locker beside the wheelhouse.';
export const QUOTE_FOG = 'Fog delays hold the boat at the dock until visibility exceeds one mile.';
export const QUOTE_BICYCLE = 'A bicycle pays a 3 dollar rack fee and must sit on the stern rack.';
export const QUOTE_CRANE = 'The deck crane limit is 800 pounds.';

const PAGE_SCHEDULE = [
  'Harbor Line Ferry runs between Pier 4 and Gull Island.',
  QUOTE_WEEKDAY,
  'Saturday and Sunday last departures leave at 9:15 p.m.',
  'Boarding closes ten minutes before departure.',
  'The crossing takes thirty five minutes in clear weather.',
].join(' ');

const PAGE_FARES = [
  'Adult fare is 14 dollars each way.',
  QUOTE_SENIOR,
  'Children under five ride free.',
  QUOTE_BICYCLE,
  'Tickets are sold at the Pier 4 window until boarding closes.',
].join(' ');

const PAGE_SAFETY = [
  QUOTE_JACKETS,
  'In a medical emergency, call the duty officer on channel 16 and then the harbor clinic at 555-0148.',
  QUOTE_FOG,
  'Do not board during a posted fog hold.',
].join(' ');

const PAGE_FREIGHT = [
  QUOTE_CRANE,
  'Live animals travel only in approved crates on the freight well.',
  'Propane and loose fuel are refused.',
  'Freight closes twenty minutes before departure.',
].join(' ');

export function harborPages(): Page[] {
  return [
    { pageNumber: 1, canonicalText: PAGE_SCHEDULE },
    { pageNumber: 2, canonicalText: PAGE_FARES },
    { pageNumber: 3, canonicalText: PAGE_SAFETY },
    { pageNumber: 4, canonicalText: PAGE_FREIGHT },
  ];
}

export function harborDocument(): DocumentRecord {
  const pages = harborPages();
  const contentHash = pagesHash(pages);
  return {
    id: 'fixture:harbor-line:tutorial-v1',
    contentHash,
    displayName: SAMPLE_DOCUMENT_NAME,
    sourceType: 'fixture',
    extractionVersion: EXTRACTION_VERSION_FIXTURE,
    pages,
    emptyPages: [],
  };
}

const TUTORIAL: readonly { id: string; kind: LabelledQuestion['kind']; text: string; quotes: string[] }[] = [
  { id: 'weekday-departure', kind: 'lexical', text: 'What time is the last weekday departure from Pier 4?', quotes: [QUOTE_WEEKDAY] },
  { id: 'senior-fare', kind: 'lexical', text: 'What is the senior fare?', quotes: [QUOTE_SENIOR] },
  { id: 'life-jackets', kind: 'lexical', text: 'Where are the life jackets stored?', quotes: [QUOTE_JACKETS] },
  { id: 'fog-delay', kind: 'lexical', text: 'What happens when fog delays a departure?', quotes: [QUOTE_FOG] },
  { id: 'bicycle-fee', kind: 'lexical', text: 'How much is the bicycle rack fee?', quotes: [QUOTE_BICYCLE] },
  { id: 'crane-limit', kind: 'lexical', text: 'What is the deck crane weight limit?', quotes: [QUOTE_CRANE] },
  { id: 'monday-commuter', kind: 'paraphrase', text: 'How late can a commuter still leave on a Monday?', quotes: [QUOTE_WEEKDAY] },
  { id: 'helicopter-pad', kind: 'negative', text: 'Is a helicopter pad available for charter pickups?', quotes: [] },
];

/** Demo question for the acceptance journey (step 2) and the negative (step 3). */
export const DEMO_QUESTION = TUTORIAL[0]?.text ?? '';
export const DEMO_NEGATIVE_QUESTION = TUTORIAL[7]?.text ?? '';
export const DEMO_PARAPHRASE_QUESTION = TUTORIAL[6]?.text ?? '';

export function harborQuestions(): LabelledQuestion[] {
  const pages = harborPages();
  const hash = pagesHash(pages);
  return TUTORIAL.map((item) => ({
    id: item.id,
    suite: 'tutorial',
    kind: item.kind,
    text: item.text,
    evidenceUnits: unitsFromQuotes(item.id, pages, hash, item.quotes),
  }));
}
