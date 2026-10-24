import { useEffect, useRef } from 'react';
import { highlightPage } from '../lib/highlight.ts';
import type { PanelProps } from './App.tsx';

/**
 * Canonical-text viewer. Highlights the focused citation's exact half-open span on its page and moves
 * keyboard focus to it. The highlight is marked by outline + underline + label, not color alone.
 */
export function Viewer({ state, controller }: PanelProps) {
  const corpus = state.corpus;
  const markRef = useRef<HTMLElement>(null);
  const focus = state.focus;
  const available = Boolean(
    focus && corpus && corpus.revision === focus.citation.revision && corpus.document.contentHash === focus.citation.sourceHash,
  );
  useEffect(() => {
    if (!available || !markRef.current) return;
    markRef.current.focus({ preventScroll: true });
    markRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [available, focus?.citation.start, focus?.citation.end, focus?.citation.pageNumber, focus?.alias]);

  if (!corpus) {
    return (
      <section className="panel viewer" aria-labelledby="viewer-heading">
        <h2 id="viewer-heading">Source</h2>
        <p className="hint">Load the tutorial or import a document to see its extracted text here.</p>
      </section>
    );
  }
  const pageNumber = state.viewerPage ?? corpus.document.pages[0]?.pageNumber ?? 1;
  const page = corpus.pageByNumber.get(pageNumber);
  const ranges = available && focus && focus.citation.pageNumber === pageNumber ? [{ start: focus.citation.start, end: focus.citation.end }] : [];
  const segments = page ? highlightPage(page.canonicalText, ranges) : [];
  return (
    <section className="panel viewer" aria-labelledby="viewer-heading">
      <h2 id="viewer-heading">Source: {corpus.document.displayName}</h2>
      <p className="hint">Extracted canonical text (not the original page layout). Citations point at exact characters of this text.</p>
      <nav className="row pages" aria-label="Pages">
        {corpus.document.pages.map((item) => (
          <button
            key={item.pageNumber}
            type="button"
            className={item.pageNumber === pageNumber ? 'page current' : 'page'}
            aria-current={item.pageNumber === pageNumber ? 'page' : undefined}
            onClick={() => controller.showPage(item.pageNumber)}
          >
            {item.pageNumber}
          </button>
        ))}
      </nav>
      {focus && !available && <p className="message">Source unavailable for citation [{focus.alias}].</p>}
      <div className="page-text" aria-label={`Page ${pageNumber}`}>
        {page && page.canonicalText.trim() === '' && <p className="hint">This page has no extractable text.</p>}
        {segments.map((segment, index) => (segment.marked ? (
          <mark key={index} ref={markRef} tabIndex={-1} className="cited" aria-label={`Cited text for [${focus?.alias ?? ''}]`}>
            <span className="cite-label" aria-hidden="true">[{focus?.alias}]</span>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )))}
      </div>
    </section>
  );
}
