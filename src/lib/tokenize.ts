/** Function words dropped from scoring. Negations (not, no, never, without) are deliberately kept. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'to', 'and', 'or', 'from', 'in', 'on',
  'for', 'with', 'what', 'where', 'when', 'who', 'how', 'does', 'do', 'did', 'can', 'could',
  'should', 'would', 'be', 'this', 'that', 'it', 'its', 'at', 'by', 'as', 'which', 'there',
  'their', 'they', 'i', 'you', 'we', 'me', 'my', 'our', 'your', 'has', 'have', 'had', 'any',
]);

/** Letters/digits, joined internally by . or : (decimals, times, dotted names), optional ++ or # suffix. */
const TOKEN = /[\p{L}\p{N}]+(?:[.:][\p{L}\p{N}]+)*(?:\+\+|#)?/gu;

/**
 * Versioned tokenizer (config TOKENIZER_VERSION) shared by corpus, query and sentence coverage.
 * NFKD folding, combining marks removed, lowercase. Keeps internal technical symbols (c++, c#, v1.5,
 * example.com), single digits, decimals and times (10:40), and negations. No stemming.
 * Display text is never changed by this function.
 */
export function tokenize(text: string): string[] {
  const folded = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const tokens: string[] = [];
  for (const match of folded.matchAll(TOKEN)) {
    const token = match[0];
    if (STOPWORDS.has(token)) continue;
    if (token.length === 1 && !/\p{N}/u.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

export function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}
