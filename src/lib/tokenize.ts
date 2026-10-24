const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'to', 'and', 'or', 'from', 'in', 'on',
  'for', 'with', 'what', 'where', 'when', 'who', 'how', 'does', 'do', 'did', 'can', 'could',
  'should', 'would', 'be', 'this', 'that', 'it', 'its', 'at', 'by', 'as',
]);

/** Lowercase tokens. Hyphens join. Stopwords and single characters drop out. */
export function tokenize(text: string): string[] {
  const folded = text.toLowerCase().replace(/['’\-]/g, '');
  const parts = folded.split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  for (const part of parts) {
    if (part.length < 2) continue;
    if (STOPWORDS.has(part)) continue;
    tokens.push(part);
  }
  return tokens;
}
