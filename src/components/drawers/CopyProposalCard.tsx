import React, { useEffect, useId, useRef } from 'react';
import type { CopyField, CopyRow } from '../../lib/pageCopyProposal';

// The review card for AI copy. Nothing the model wrote reaches a field until the person keeps it
// here. Module scope for the same reason as EditorSection: defined inside the editor's render it
// would remount on every keystroke.

interface Props {
  rows: CopyRow[];
  heading: string;
  selected: CopyField[];
  onToggle: (field: CopyField) => void;
  onUse: () => void;
  onKeep: () => void;
  focusFirst: 'keep' | 'use';
}

const textStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#E2E8F0',
  lineHeight: 1.45,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  // A letter body keeps its paragraphs (C19).
  whiteSpace: 'pre-wrap'
};

export const CopyProposalCard: React.FC<Props> = ({ rows, heading, selected, onToggle, onUse, onKeep, focusFirst }) => {
  const headingId = useId();
  const idBase = useId();
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (focusFirst === 'keep' ? keepButtonRef : applyButtonRef).current?.focus();
  }, []);

  const nothingChecked = !rows.some(r => selected.includes(r.field));

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onKeep();
        }
      }}
      style={{
        padding: '12px',
        borderRadius: '10px',
        background: 'rgba(236, 72, 153, 0.06)',
        border: '1px solid rgba(236, 72, 153, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minWidth: 0
      }}
    >
      <div>
        <h4 id={headingId} style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F3F4F6' }}>{heading}</h4>
        <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94A3B8' }}>
          Written by AI. Check every claim before you use it.
        </p>
      </div>

      {rows.map(row => {
        const inputId = `${idBase}-${row.field}`;
        return (
          <div
            key={row.field}
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              padding: '8px 10px',
              borderRadius: '8px',
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F3F4F6' }}>{row.label}</div>
              <div style={textStyle}>
                <span style={{ color: '#94A3B8', fontWeight: 600 }}>Now: </span>
                {row.current ? row.current : <span style={{ color: '#64748B' }}>Empty</span>}
              </div>
              <div style={textStyle}>
                <span style={{ color: '#F9A8D4', fontWeight: 600 }}>New: </span>
                {row.suggested}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, minHeight: '24px' }}>
              <input
                id={inputId}
                type="checkbox"
                checked={selected.includes(row.field)}
                onChange={() => onToggle(row.field)}
                aria-label={`Use the new ${row.label.toLowerCase()}`}
                style={{ width: '16px', height: '16px', margin: 0, cursor: 'pointer', accentColor: '#ec4899' }}
              />
              <label htmlFor={inputId} style={{ fontSize: '11px', fontWeight: 600, color: '#E2E8F0', cursor: 'pointer' }}>
                Use
              </label>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          ref={applyButtonRef}
          type="button"
          onClick={onUse}
          disabled={nothingChecked}
          style={{
            padding: '8px 12px',
            minHeight: '36px',
            borderRadius: '8px',
            background: nothingChecked ? 'rgba(236, 72, 153, 0.35)' : '#ec4899',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 700,
            cursor: nothingChecked ? 'not-allowed' : 'pointer'
          }}
        >
          Use selected
        </button>
        <button
          ref={keepButtonRef}
          type="button"
          onClick={onKeep}
          style={{
            padding: '8px 12px',
            minHeight: '36px',
            borderRadius: '8px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#E2E8F0',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Keep my copy
        </button>
      </div>
    </div>
  );
};
