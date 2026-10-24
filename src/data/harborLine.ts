import type { LabelledQuestion, PageText } from '../domain.ts';

export const SAMPLE_DOCUMENT_ID = 'harbor-line-sample';
export const SAMPLE_DOCUMENT_NAME = 'Harbor Line manual';

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

export function harborPages(): PageText[] {
  return [
    { page: 1, text: PAGE_SCHEDULE },
    { page: 2, text: PAGE_FARES },
    { page: 3, text: PAGE_SAFETY },
    { page: 4, text: PAGE_FREIGHT },
  ];
}

export function harborQuestions(): LabelledQuestion[] {
  return [
    {
      id: 'weekday-departure',
      kind: 'lexical',
      prompt: 'What time is the last weekday departure from Pier 4?',
      goldQuotes: [QUOTE_WEEKDAY],
      expectAbstain: false,
    },
    {
      id: 'senior-fare',
      kind: 'lexical',
      prompt: 'What is the senior fare?',
      goldQuotes: [QUOTE_SENIOR],
      expectAbstain: false,
    },
    {
      id: 'life-jackets',
      kind: 'lexical',
      prompt: 'Where are the life jackets stored?',
      goldQuotes: [QUOTE_JACKETS],
      expectAbstain: false,
    },
    {
      id: 'fog-delay',
      kind: 'lexical',
      prompt: 'What happens when fog delays a departure?',
      goldQuotes: [QUOTE_FOG],
      expectAbstain: false,
    },
    {
      id: 'bicycle-fee',
      kind: 'lexical',
      prompt: 'How much is the bicycle rack fee?',
      goldQuotes: [QUOTE_BICYCLE],
      expectAbstain: false,
    },
    {
      id: 'crane-limit',
      kind: 'lexical',
      prompt: 'What is the deck crane weight limit?',
      goldQuotes: [QUOTE_CRANE],
      expectAbstain: false,
    },
    {
      id: 'monday-commuter',
      kind: 'paraphrase',
      prompt: 'How late can a commuter still leave on a Monday?',
      goldQuotes: [QUOTE_WEEKDAY],
      expectAbstain: false,
    },
    {
      id: 'helicopter-pad',
      kind: 'unanswerable',
      prompt: 'Is a helicopter pad available for charter pickups?',
      goldQuotes: [],
      expectAbstain: true,
    },
  ];
}
