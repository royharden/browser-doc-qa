/**
 * Pure PDF text-item reconstruction (PLAN.md section 3), versioned as PDF_LAYOUT_VERSION.
 * Input mirrors pdf.js TextItem: str, transform [a, b, c, d, e, f] (e = x, f = y baseline, PDF space,
 * y grows upward), width, height and hasEOL. Output is the page's canonical text.
 *
 * Decisions in pdf-layout-v1 (change the version when any of these changes):
 * - Lines: a new line starts after hasEOL or when the baseline moves by more than half the font height.
 *   Items within a line are ordered by x.
 * - Spaces: a horizontal gap above 0.15 x font height inserts one space; a gap above 2 x font height is
 *   a column/table gap and inserts a TAB, so table cells are never silently glued together.
 * - Paragraphs: a vertical gap above 1.6 x the line's font height inserts a blank line.
 * - Hyphenated wraps: the hyphen is KEPT and the lines are joined with no space ("exam-" + "ple" ->
 *   "exam-ple"), so no glyph is ever dropped and real compounds ("well-known") stay correct.
 * - Ligatures U+FB00-U+FB06 expand to their letters (NFKC on that block only). Digits are never altered.
 * - Bullets and list numbers are kept as extracted text; they start a new line only when pdf.js reports a
 *   new baseline or hasEOL (no extra bullet-specific rule in v1).
 */
export const PDF_LAYOUT_VERSION = 'pdf-layout-v1';

export interface LayoutItem {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface Line {
  y: number;
  height: number;
  items: LayoutItem[];
}

const SPACE_GAP = 0.15;
const COLUMN_GAP = 2;
const NEW_LINE_SHIFT = 0.5;
const PARAGRAPH_GAP = 1.6;

export function reconstructPage(items: readonly LayoutItem[]): string {
  const lines = groupLines(items);
  let output = '';
  let previous: Line | null = null;
  for (const line of lines) {
    const text = lineText(line);
    if (text.trim() === '') continue;
    if (previous) {
      const gap = Math.abs(previous.y - line.y);
      const height = Math.max(previous.height, line.height, 1);
      if (gap > PARAGRAPH_GAP * height) output = `${output.trimEnd()}\n\n`;
      else if (/[\p{L}]-$/u.test(output) && /^\p{Ll}/u.test(text)) {
        // keep the hyphen, join the wrap without a space
      } else output += '\n';
    }
    output += text;
    previous = line;
  }
  return expandLigatures(output).replace(/[ \t]+\n/g, '\n').trimEnd();
}

function groupLines(items: readonly LayoutItem[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let breakNext = false;
  for (const item of items) {
    const y = item.transform[5] ?? 0;
    const height = Math.abs(item.height) || Math.abs(item.transform[3] ?? 0) || 1;
    if (item.str === '' && !item.hasEOL) continue;
    const shifted = current !== null && Math.abs(current.y - y) > NEW_LINE_SHIFT * Math.max(current.height, height);
    if (!current || breakNext || shifted) {
      current = { y, height, items: [] };
      lines.push(current);
    }
    if (item.str !== '') {
      current.items.push(item);
      current.height = Math.max(current.height, height);
    }
    breakNext = item.hasEOL === true;
  }
  return lines.filter((line) => line.items.length > 0);
}

function lineText(line: Line): string {
  const ordered = [...line.items].sort((left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0));
  let text = '';
  let previousEnd: number | null = null;
  for (const item of ordered) {
    const x = item.transform[4] ?? 0;
    if (previousEnd !== null) {
      const gap = x - previousEnd;
      if (gap > COLUMN_GAP * line.height) text = `${text.trimEnd()}\t`;
      else if (gap > SPACE_GAP * line.height && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
    }
    text += item.str;
    previousEnd = x + item.width;
  }
  return text.replace(/ /g, ' ');
}

function expandLigatures(text: string): string {
  return text.replace(/[ﬀ-ﬆ]/g, (char) => char.normalize('NFKC'));
}
