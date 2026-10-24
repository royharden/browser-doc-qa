export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function normalizeSpace(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function formatAnswer(sentences: { text: string; citation: number }[]): string {
  return sentences.map((sentence) => `${sentence.text} [${sentence.citation}]`).join(' ');
}
