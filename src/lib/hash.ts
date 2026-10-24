import type { Page } from '../domain.ts';

/**
 * Deterministic non-cryptographic 64-bit identity hash: two FNV-1a 32-bit lanes over UTF-16 code units.
 * Used for content/revision/config identity, never for security. The prefix names the algorithm.
 * scripts/fixture-authoring.py reimplements this exactly for the frozen evaluation fixture.
 */
export function identityHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    a = Math.imul(a ^ unit, 0x01000193) >>> 0;
    b = Math.imul(b ^ unit, 0x01000193) >>> 0;
  }
  return `fnv64:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Canonical serialization used for a document's contentHash. */
export function pagesHash(pages: readonly Page[]): string {
  return identityHash(pages.map((page) => `${page.pageNumber}\n${page.canonicalText}`).join('\f'));
}

export function fingerprint(parts: Record<string, unknown>): string {
  return identityHash(stableStringify(parts));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort(compareCodepoints)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** Codepoint (not locale) comparison for stable tie-breaks. */
export function compareCodepoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
