export interface TextInterval {
  start: number;
  end: number;
}

/** Abbreviations whose trailing period never ends a sentence (lowercased, without the final dot). */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'vs', 'e.g', 'i.e', 'approx', 'dept',
  'fig', 'jr', 'sr', 'mt', 'ave', 'est', 'ext',
]);

/** Abbreviations that end a sentence only when the next word starts with a capital letter. */
const TERMINAL_ABBREVIATIONS = new Set(['a.m', 'p.m', 'etc', 'inc', 'ltd', 'co', 'u.s']);

/**
 * Sentence intervals over the original text, trimmed of surrounding whitespace.
 * Hard boundaries: blank lines (paragraphs), a newline before a bullet/numbered item, and a newline
 * after a line ending in . ! ? : or ;. Soft boundaries: . ! ? followed by whitespace, unless the word
 * is a known abbreviation or a single capital initial. Decimals, times, URLs and emails have no
 * whitespace after their dots, so they never split. Offsets are UTF-16 code units into `text`.
 */
export function sentenceIntervals(text: string): TextInterval[] {
  const intervals: TextInterval[] = [];
  let segmentStart = 0;
  const push = (start: number, end: number): void => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s] ?? '')) s += 1;
    while (e > s && /\s/.test(text[e - 1] ?? '')) e -= 1;
    if (e > s) intervals.push({ start: s, end: e });
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (char === '\n') {
      const rest = text.slice(index + 1, index + 8);
      const blank = /^[ \t]*(?:\n|$)/.test(rest);
      const bullet = /^[ \t]*(?:[-*•]|\d{1,3}[.)])\s/.test(rest);
      const lineEndsSentence = /[.!?:;]\s*$/.test(text.slice(segmentStart, index));
      if (blank || bullet || lineEndsSentence) {
        push(segmentStart, index);
        segmentStart = index + 1;
      }
      continue;
    }
    if (char !== '.' && char !== '!' && char !== '?') continue;
    const next = text[index + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (char === '.' && isAbbreviation(text, index)) continue;
    push(segmentStart, index + 1);
    segmentStart = index + 1;
  }
  push(segmentStart, text.length);
  return intervals;
}

function isAbbreviation(text: string, dotIndex: number): boolean {
  let start = dotIndex;
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1] ?? '')) start -= 1;
  const raw = text.slice(start, dotIndex);
  if (raw === '') return false;
  const word = raw.toLowerCase();
  if (ABBREVIATIONS.has(word)) return true;
  if (TERMINAL_ABBREVIATIONS.has(word)) {
    const following = /^\s+(\S)/u.exec(text.slice(dotIndex + 1, dotIndex + 12));
    return !(following && /\p{Lu}/u.test(following[1] ?? ''));
  }
  // Single capital initial such as "J." in "J. Smith".
  return /^\p{Lu}$/u.test(raw);
}
