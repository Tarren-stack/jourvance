import React, { createContext, useContext } from 'react';
import {
  publishStateDetail,
  publishStateLabel,
  type PublicationRead,
  type StepPublishState
} from '../../lib/publishState';
import type { PreviewOutcome } from '../../lib/saveOutcome';

/**
 * What is live, per step, handed to the cards and the inspector by context. It is never written
 * into node.data, so a status read never becomes an undo step or part of a saved journey.
 */
export interface PublishStatusValue {
  states: Map<string, StepPublishState>;
  read: PublicationRead | null;
  refresh: () => void;
  /**
   * Saves, then asks for a one-hour preview link. It rides the context because the inspector sits
   * inside the docked step panel, which has no prop for it. Absent: no preview button.
   */
  preview?: (nodeId: string) => Promise<PreviewOutcome>;
}

const EMPTY: PublishStatusValue = { states: new Map(), read: null, refresh: () => {} };

export const PublishStatusContext = createContext<PublishStatusValue>(EMPTY);

export function usePublishStatus(): PublishStatusValue {
  return useContext(PublishStatusContext);
}

export interface PublishTone {
  color: string;
  background: string;
  /** Checking and unavailable are not answers yet, so they carry a dashed top border. */
  dashed: boolean;
}

export function publishTone(state: StepPublishState): PublishTone {
  switch (state.kind) {
    case 'published': return { color: '#34D399', background: 'rgba(16, 185, 129, 0.12)', dashed: false };
    case 'changed': return { color: '#FBBF24', background: 'rgba(245, 158, 11, 0.14)', dashed: false };
    case 'not-published': return { color: '#CBD5E1', background: 'rgba(148, 163, 184, 0.10)', dashed: false };
    case 'untracked': return { color: '#7DD3FC', background: 'rgba(56, 189, 248, 0.12)', dashed: false };
    default: return { color: '#CBD5E1', background: 'transparent', dashed: true };
  }
}

export const revisionOf = (state: StepPublishState): number | null =>
  'revisionNumber' in state ? state.revisionNumber : null;

/**
 * The full-width status row under a card's top banner. Words first; the colour only repeats them.
 * nodeType picks the same sentence the inspector shows (a thank-you step has its own).
 */
export const PublishStatusStrip: React.FC<{ nodeId: string; nodeType: string }> = ({ nodeId, nodeType }) => {
  const { states, read } = usePublishStatus();
  const state = states.get(nodeId) ?? null;
  if (!state) return null;
  const tone = publishTone(state);
  const label = publishStateLabel(state);
  const revision = revisionOf(state);
  const detail = state.kind === 'unknown' && state.reason === 'unavailable' && read?.kind === 'unavailable'
    ? read.message
    : publishStateDetail(state, nodeType);
  return (
    <div
      data-publish-status={state.kind}
      // Fades out when the map is zoomed out, where the card's summary repeats the status (F3).
      data-jv-detail-row
      title={detail}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '5px 14px',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        color: tone.color,
        background: tone.background,
        borderTop: tone.dashed ? '1px dashed rgba(148, 163, 184, 0.45)' : '1px solid transparent',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '9999px',
          flexShrink: 0,
          background: tone.dashed ? 'transparent' : tone.color,
          border: tone.dashed ? `1px solid ${tone.color}` : 'none',
          boxSizing: 'border-box'
        }}
      />
      {/* One line of text, so the space before the revision is real text a screen reader gets. */}
      <span>
        {label}
        {revision !== null && <span style={{ color: '#94A3B8', fontWeight: 500 }}> · Rev {revision}</span>}
      </span>
    </div>
  );
};
