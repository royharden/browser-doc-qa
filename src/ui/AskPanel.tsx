import { useState } from 'react';
import type { ArmId, Hit } from '../domain.ts';
import { ARMS } from '../domain.ts';
import { DEMO_NEGATIVE_QUESTION, DEMO_PARAPHRASE_QUESTION, DEMO_QUESTION } from '../data/harborLine.ts';
import type { ArmRun } from '../lib/ask.ts';
import { MAX_QUESTION_CHARS } from '../lib/config.ts';
import type { PanelProps } from './App.tsx';
import { isBusy } from './StatusBar.tsx';

export const ARM_LABEL: Record<ArmId, string> = { keyword: 'Keyword (BM25)', dense: 'Embedding (dense)', hybrid: 'Hybrid (RRF)' };

export function AskPanel({ state, controller }: PanelProps) {
  const [question, setQuestion] = useState('');
  const busy = isBusy(state.phase);
  const disabled = !state.corpus || busy;
  const tutorial = state.corpus?.document.id.startsWith('fixture:harbor-line') ?? false;
  const submit = (text: string): void => {
    setQuestion(text);
    void controller.ask(text);
  };
  return (
    <section className="panel" aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask</h2>
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
      >
        <label htmlFor="question">Question</label>
        <textarea
          id="question"
          value={question}
          maxLength={MAX_QUESTION_CHARS}
          rows={2}
          disabled={!state.corpus}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={state.corpus ? 'Ask about the loaded document' : 'Load a document first'}
        />
        <div className="row">
          <button type="submit" disabled={disabled || question.trim() === ''}>Ask</button>
          {tutorial && (
            <>
              <button type="button" className="chip" disabled={disabled} onClick={() => submit(DEMO_QUESTION)}>Weekday departure</button>
              <button type="button" className="chip" disabled={disabled} onClick={() => submit(DEMO_PARAPHRASE_QUESTION)}>Paraphrase</button>
              <button type="button" className="chip" disabled={disabled} onClick={() => submit(DEMO_NEGATIVE_QUESTION)}>Not in the document</button>
            </>
          )}
        </div>
      </form>

      {state.query && (
        <>
          <AnswerView state={state} controller={controller} />
          <h3>Rankings for “{state.query}”</h3>
          <p className="hint">Each arm ran independently on the same question. Scores have different meanings per column and are not confidence.</p>
          <div className="arms">
            {ARMS.map((arm) => <ArmColumn key={arm} arm={arm} run={state.runs[arm]} />)}
          </div>
        </>
      )}
    </section>
  );
}

function AnswerView({ state, controller }: PanelProps) {
  const run = state.runs[state.answerArm];
  const answer = run?.answer ?? null;
  return (
    <div className="answer" aria-live="polite">
      <fieldset className="row">
        <legend>Answer from</legend>
        {ARMS.map((arm) => (
          <label key={arm} className="radio">
            <input
              type="radio"
              name="answer-arm"
              value={arm}
              checked={state.answerArm === arm}
              disabled={state.runs[arm]?.status !== 'ok'}
              onChange={() => controller.setAnswerArm(arm)}
            />
            {ARM_LABEL[arm]}
          </label>
        ))}
      </fieldset>
      {!run && <p className="hint">Running…</p>}
      {run && run.status !== 'ok' && <p className="message">{ARM_LABEL[run.arm]}: {run.status} — {run.reason}</p>}
      {answer && answer.status === 'answered' && (
        <ol className="excerpts">
          {answer.excerpts.map((excerpt) => {
            const focused = state.focus?.arm === state.answerArm && state.focus.alias === excerpt.alias;
            return (
              <li key={excerpt.alias} className={focused ? 'focused' : undefined}>
                <blockquote>{excerpt.quote}</blockquote>
                <button
                  type="button"
                  className="citation"
                  aria-pressed={focused}
                  aria-label={`Citation ${excerpt.alias}: page ${excerpt.citation.pageNumber}, characters ${excerpt.citation.start} to ${excerpt.citation.end}`}
                  onClick={() => controller.focusCitation(state.answerArm, excerpt.alias)}
                >
                  [{excerpt.alias}] p.{excerpt.citation.pageNumber}
                </button>
                {excerpt.fragment && <span className="tag">part of a longer sentence</span>}
                <span className="hint">
                  {excerpt.keywordCoverage !== null && ` keyword coverage ${excerpt.keywordCoverage.toFixed(2)}`}
                  {excerpt.denseCosine !== null && ` cosine ${excerpt.denseCosine.toFixed(3)}`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {answer && answer.status !== 'answered' && (
        <p className="abstain">{answer.reason}</p>
      )}
      {answer?.stageError && (
        <div className="message message-error">
          Answer stage error ({answer.stageError.stage}): {answer.stageError.message}
          <RetrievedPassageFallback run={run} state={state} />
        </div>
      )}
      {answer && (
        <p className="hint">
          Gates: keyword coverage ≥ {answer.policy.keywordMinCoverage}, cosine ≥ {answer.policy.denseMinCosine}
          {answer.policy.source === 'calibrated' ? ' (calibrated on the calibration split)' : ' (uncalibrated defaults)'}. Traceability is not truth.
        </p>
      )}
    </div>
  );
}

/** Clearly labelled retrieved passage when sentence scoring failed; never counted as an answer. */
function RetrievedPassageFallback({ run, state }: { run: ArmRun | undefined; state: PanelProps['state'] }) {
  const top = run?.hits[0];
  const chunk = top ? state.corpus?.chunkById.get(top.chunkId) : undefined;
  if (!chunk) return null;
  return (
    <details>
      <summary>Show the top retrieved passage instead (not an answer)</summary>
      <blockquote className="passage">{chunk.text}</blockquote>
    </details>
  );
}

function ArmColumn({ arm, run }: { arm: ArmId; run: ArmRun | undefined }) {
  return (
    <div className="arm">
      <h4>{ARM_LABEL[arm]}</h4>
      {!run && <p className="hint">Waiting…</p>}
      {run && run.status !== 'ok' && <p className="hint">{run.status === 'unavailable' ? 'Unavailable' : run.status}: {run.reason}</p>}
      {run && run.status === 'ok' && (
        <>
          {run.hits.length === 0 ? <p className="hint">No matching passages.</p> : (
            <table>
              <thead>
                <tr><th scope="col">#</th><th scope="col">Page</th><th scope="col">Score</th><th scope="col">Via</th></tr>
              </thead>
              <tbody>
                {run.hits.map((hit) => (
                  <tr key={hit.chunkId}>
                    <td>{hit.rank}</td>
                    <td>{hit.pageNumber}</td>
                    <td>{scoreText(arm, hit)}</td>
                    <td>{viaText(hit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">
            Retrieval {run.retrievalSumMs?.toFixed(2)} ms (sum of stages), wall {run.retrievalWallMs?.toFixed(2)} ms
            {run.answerSumMs !== null && `; answer ${run.answerSumMs.toFixed(2)} ms`}. One observation.
          </p>
        </>
      )}
    </div>
  );
}

function scoreText(arm: ArmId, hit: Hit): string {
  if (arm === 'keyword') return `BM25 ${hit.keyword?.score.toFixed(3) ?? '-'}`;
  if (arm === 'dense') return `cos ${hit.dense?.score.toFixed(3) ?? '-'}`;
  return `RRF ${hit.fused?.score.toFixed(4) ?? '-'}`;
}

function viaText(hit: Hit): string {
  const parts: string[] = [];
  if (hit.keyword) parts.push(`kw #${hit.keyword.rank}`);
  if (hit.dense) parts.push(`dense #${hit.dense.rank}`);
  return parts.join(', ');
}
