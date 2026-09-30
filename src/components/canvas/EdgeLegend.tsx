import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { EDGE_KINDS, EDGE_WIDTH, type EdgeKind } from '../../lib/edgeKinds';

interface Props {
  kinds: EdgeKind[];
  /** The basis of the numbers on the lines: the range, or why there are none (#9). */
  note?: string;
}

// Starts closed on a phone, where the open list would cover a third of the map.
const startsOpen = () => {
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
};

// Names only the kinds of line on the map right now, so a plain funnel shows one row, not six.
// The list ignores the pointer so the map under it can still be panned and clicked.
export const EdgeLegend: React.FC<Props> = ({ kinds, note }) => {
  const [open, setOpen] = useState(startsOpen);
  if (kinds.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="What the line colours mean"
      style={{
        padding: open ? '6px 10px 8px' : '0',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none'
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: open ? '2px 0' : '6px 10px',
          marginBottom: open ? '4px' : 0,
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
          pointerEvents: 'auto'
        }}
      >
        Lines
        <ChevronDown size={12} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '5px' }}>
          {kinds.map(kind => {
            const k = EDGE_KINDS[kind];
            return (
              <li
                key={kind}
                data-edge-kind={kind}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: 600, color: '#CBD5E1' }}
              >
                <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <line
                    x1="2"
                    y1="5"
                    x2="23"
                    y2="5"
                    stroke={k.color}
                    strokeWidth={EDGE_WIDTH}
                    strokeDasharray={k.dash}
                    strokeLinecap={k.round ? 'round' : 'butt'}
                  />
                  <path d="M22 1.5 L29 5 L22 8.5 Z" fill={k.color} />
                </svg>
                {k.label}
              </li>
            );
          })}
        </ul>
      )}
      {open && note && (
        <div data-legend-note style={{ marginTop: '6px', maxWidth: '200px', fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.35 }}>
          {note}
        </div>
      )}
    </div>
  );
};
