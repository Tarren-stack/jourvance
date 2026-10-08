// The page builder's History view (LANDING_BUILDER_PLAN.md, Wave 3): the last 20 times this landing
// page was published, newest first, each with Restore. Restore reads that publish's stored design
// from the server (server/builderRevisions.mjs) and hands it to the shell, which loads it as ONE
// undoable step: nothing is published and nothing reaches the live page until the merchant does it.
// An unreachable history says so in words and offers Try again; it never reads as "no history".

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBuilderRevision,
  listBuilderRevisions,
  revisionFrom,
  revisionsFrom,
  type BuilderRevisionSummary
} from '../../lib/builderRevisionsClient';
import type { ServerAnswer } from '../../lib/saveOutcome';
import { validateBuilderDoc } from '../../lib/pageBuilder/model.mjs';
import type { BuilderDoc } from '../../types/pageBuilder';
import { hintStyle, smallButton } from './BuilderFields';

export interface BuilderHistoryProps {
  journeyId: string | null;
  nodeId: string | null;
  /** Loads `doc` as one undoable replace of the page. `label` names the version in words. */
  onRestore: (doc: BuilderDoc, label: string) => void;
  /** Says a refusal in the builder's live region as well as showing it here. */
  onProblem: (text: string) => void;
}

/** Said on a row whose publish also carried the page's A/B test, in the words the step editor uses. */
export const HAS_SPLIT_TEST_NOTE = ', with Variant B of its A/B test';

const OFFLINE = 'The history could not be reached. Check your connection and try again.';

/** "8 Oct 2026, 14:05" in the visitor's own locale and zone, or the raw text when it will not parse. */
export function revisionDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The server's own sentence for a failed answer, or the offline sentence when none came. */
function errorOf(answer: ServerAnswer | null): string {
  const error = (answer?.body as { error?: unknown } | null | undefined)?.error;
  return typeof error === 'string' && error.trim() ? error.trim() : OFFLINE;
}

type ListState =
  | { state: 'loading' }
  | { state: 'ready'; revisions: BuilderRevisionSummary[] }
  | { state: 'error'; error: string };

export const BuilderHistory: React.FC<BuilderHistoryProps> = ({ journeyId, nodeId, onRestore, onProblem }) => {
  const [list, setList] = useState<ListState>({ state: 'loading' });
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const load = useCallback(async () => {
    if (!journeyId || !nodeId) return;
    setList({ state: 'loading' });
    const answer = await listBuilderRevisions(journeyId, nodeId);
    const revisions = revisionsFrom(answer);
    setList(revisions ? { state: 'ready', revisions } : { state: 'error', error: errorOf(answer) });
  }, [journeyId, nodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (text: string) => {
    setProblem(text);
    onProblem(text);
  };

  const restore = async (rev: BuilderRevisionSummary) => {
    if (!journeyId || !nodeId) return;
    setBusy(rev.rev);
    setProblem(null);
    const answer = await getBuilderRevision(journeyId, nodeId, rev.rev);
    setBusy(null);
    const revision = revisionFrom(answer);
    if (!revision) {
      fail(errorOf(answer));
      return;
    }
    const check = validateBuilderDoc(revision.document);
    if (!check.ok) {
      fail(`Version ${rev.rev} cannot be restored, because part of its design is no longer supported by the builder. Your page has not changed.`);
      return;
    }
    onRestore(revision.document as BuilderDoc, `version ${rev.rev}, published ${revisionDate(rev.publishedAt)}`);
  };

  const ready = list.state === 'ready' ? list.revisions : [];

  return (
    <section aria-labelledby="jvb-history-title" style={{ display: 'flex', flexDirection: 'column' }}>
      <h3 id="jvb-history-title" ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>History</h3>
      <p style={{ ...hintStyle, marginBottom: '8px' }}>
        The last 20 times you published this page. Restore puts that version in the builder as one step you can undo. It does not publish anything.
      </p>
      {(!journeyId || !nodeId) && <p style={hintStyle}>History is kept once this page belongs to a saved journey.</p>}
      {/* Mounted from the start and only its text changes, so a screen reader announces it. */}
      <p role="status" style={hintStyle}>{journeyId && nodeId && list.state === 'loading' ? 'Loading the history.' : ''}</p>
      {/* The restore in progress, in its own region mounted from the start, as the line above. */}
      <p role="status" data-history-restoring="" style={{ ...hintStyle, margin: 0 }}>{busy !== null ? `Restoring version ${busy}.` : ''}</p>
      {list.state === 'error' && (
        <div role="alert" style={{ fontSize: '11px', color: '#FCA5A5' }}>
          <p style={{ margin: '0 0 6px' }}>{list.error}</p>
          <button
            type="button"
            onClick={() => {
              // This block unmounts while it loads, so focus goes to the heading first.
              titleRef.current?.focus();
              void load();
            }}
            style={smallButton}
          >
            Try again
          </button>
        </div>
      )}
      {list.state === 'ready' && ready.length === 0 && (
        <p style={hintStyle}>Nothing here yet. Each time you publish this page, that version is kept so you can come back to it.</p>
      )}
      {problem && <p role="alert" style={{ margin: '0 0 6px', fontSize: '11px', color: '#FCA5A5' }}>{problem}</p>}
      {ready.length > 0 && (
        <ol aria-label="Published versions, newest first" style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ready.map(rev => (
            <li key={rev.rev} data-history-row={rev.rev} style={{ listStyle: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
              <span style={{ fontSize: '12px', color: '#E2E8F0', minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{`Version ${rev.rev}`}</strong>
                <span style={{ color: '#94A3B8' }}>{`Published ${revisionDate(rev.publishedAt)}${rev.hasB ? HAS_SPLIT_TEST_NOTE : ''}`}</span>
              </span>
              <button
                type="button"
                data-history-restore={rev.rev}
                aria-label={`Restore version ${rev.rev}`}
                aria-disabled={busy !== null}
                onClick={() => { if (busy === null) void restore(rev); }}
                style={{ ...smallButton, opacity: busy !== null && busy !== rev.rev ? 0.45 : 1 }}
              >
                {busy === rev.rev ? 'Restoring' : 'Restore'}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
