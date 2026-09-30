import React, { createContext, useContext } from 'react';
import type { DesignReport } from '../../lib/designChecks';

// The amber "! N" on a step card when the design checks have something to say about it (#10).
// The checks are computed once for the whole map in JourneyCanvas and handed down through this
// context, so they never enter node data, undo history or a saved journey.
// Drop <DesignIssueBadge nodeId={id} /> in as the FIRST child of a card's root. The root is not
// positioned, so the badge's containing block is .react-flow__node and the root's overflow:hidden
// does not clip it, the same way the handles escape.
// Zoomed out it counter-scales from its bottom-right corner (index.css, --jv-caption-scale), so
// "! N" stays 11px on screen and the badge stays on its card's corner, growing up and away from the
// step name rather than over it (T02). Where that would reach another card, a handle or another
// badge, EdgeLabelLayout marks it data-jv-badge-form="dot" (a small amber dot on the corner, its
// text not drawn) or "hidden", and it shows whole again while it holds keyboard focus.

export interface DesignIssuesValue {
  byNode: DesignReport['byNode'];
  /** Opens Check design at this step's rows. */
  onOpenIssues?: (nodeId: string) => void;
}

export const DesignIssuesContext = createContext<DesignIssuesValue>({ byNode: {} });

export const DesignIssueBadge: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const { byNode, onOpenIssues } = useContext(DesignIssuesContext);
  const entry = byNode[nodeId];
  if (!entry || entry.messages.length === 0) return null;
  const n = entry.messages.length;
  return (
    <button
      type="button"
      // nodrag and nopan keep a press from moving the card or the map. nokey stops React Flow 12's
      // node wrapper from selecting the step when Enter or Space is pressed on the badge.
      className="nodrag nopan nokey"
      data-jv-design-badge={nodeId}
      aria-label={`${n} design ${n === 1 ? 'check' : 'checks'} on ${entry.name}`}
      title={entry.messages.join('\n')}
      onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX && e.clientY) {
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          ) {
            return;
          }
        }
        e.stopPropagation();
        onOpenIssues?.(nodeId);
      }}
      style={{
        position: 'absolute',
        top: -10,
        right: -10,
        zIndex: 5,
        minWidth: 24,
        height: 20,
        padding: '0 6px',
        borderRadius: 9999,
        background: '#FBBF24',
        color: '#0B0F19',
        border: '2px solid #0B0F19',
        fontSize: 11,
        fontWeight: 800,
        lineHeight: '16px',
        cursor: 'pointer'
      }}
    >
      <span data-jv-badge-text="">! {n}</span>
    </button>
  );
};
