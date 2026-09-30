import React from 'react';
import type { JourneyEdge, JourneyNode, NodeType } from '../../types/journey';
import { EDGE_KINDS, EDGE_WIDTH } from '../../lib/edgeKinds';
import { revealsHiddenStep, stepConnections, type StepLink } from '../../lib/stepNavigation';
import { STEP_PORTS } from '../../lib/addStep';

// The steps an opened step comes from and leads to, one button each, drawn with the same colour,
// dash and label the line has on the map. Names and line kinds only: no counts, no rates.

interface Props {
  nodeId: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  showRetentionBranches: boolean;
  onJump: (nodeId: string) => void;
  onAddBefore?: () => void;
  onAddAfter?: () => void;
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)'
};

const LineSwatch: React.FC<{ link: StepLink }> = ({ link }) => {
  const k = EDGE_KINDS[link.kind];
  return (
    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line
        x1="2"
        y1="5"
        x2="22"
        y2="5"
        stroke={k.color}
        strokeWidth={EDGE_WIDTH}
        strokeDasharray={k.dash}
        strokeLinecap={k.round ? 'round' : 'butt'}
      />
    </svg>
  );
};

const actionButtonStyle: React.CSSProperties = {
  flex: 1,
  minHeight: '36px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px 12px',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text-main)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};

export const StepConnections: React.FC<Props> = ({ nodeId, nodes, edges, showRetentionBranches, onJump, onAddBefore, onAddAfter }) => {
  const { incoming, outgoing } = stepConnections(nodeId, nodes, edges);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const node = byId.get(nodeId);
  const ports = node ? STEP_PORTS[node.type as NodeType] : undefined;
  const canAddBefore = Boolean(onAddBefore && ports?.inputs.some(p => p.handle === null));
  const canAddAfter = Boolean(onAddAfter && ports && ports.exits.length > 0);

  const list = (heading: string, links: StepLink[], empty: string) => (
    <div>
      <h3 style={headingStyle}>{heading}</h3>
      {links.length === 0 ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '4px' }}>
          {links.map(link => {
            const hidden = revealsHiddenStep(byId.get(link.stepId), showRetentionBranches);
            return (
              <li key={link.edgeId}>
                <button
                  type="button"
                  onClick={() => onJump(link.stepId)}
                  style={{
                    width: '100%',
                    minHeight: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 10px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    color: 'var(--color-text-main)',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                >
                  <LineSwatch link={link} />
                  <span style={{ display: 'grid', minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, overflowWrap: 'anywhere' }}>{link.stepName}</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                      {link.lineLabel}
                      {hidden ? ', hidden' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <section
      aria-label="Connections"
      style={{ display: 'grid', gap: '12px', paddingBottom: '16px', marginBottom: '16px', borderBottom: '1px solid var(--color-border)' }}
    >
      {list('Comes from', incoming, 'Nothing leads here yet.')}
      {list('Leads to', outgoing, 'This step does not lead anywhere yet.')}
      {(canAddBefore || canAddAfter) && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          {canAddBefore && (
            <button
              type="button"
              onClick={onAddBefore}
              style={actionButtonStyle}
            >
              + Add step before
            </button>
          )}
          {canAddAfter && (
            <button
              type="button"
              onClick={onAddAfter}
              style={actionButtonStyle}
            >
              + Add step after
            </button>
          )}
        </div>
      )}
    </section>
  );
};
