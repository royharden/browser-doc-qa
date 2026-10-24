export interface TextSegment {
  text: string;
  marked: boolean;
}

export function highlightPage(text: string, ranges: { start: number; end: number }[]): TextSegment[] {
  const clamped = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(text.length, range.start)),
      end: Math.max(0, Math.min(text.length, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: { start: number; end: number }[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), marked: false });
    segments.push({ text: text.slice(range.start, range.end), marked: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), marked: false });
  return segments.filter((segment) => segment.text.length > 0);
}
