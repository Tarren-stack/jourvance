import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SectionSummary } from '../../lib/pageEditorSections';

// A disclosure section for the step editors. Module scope on purpose: a component defined
// inside a render body is a new type on every render, so React remounts it on each keystroke
// and the field being typed in loses focus.

interface Props {
  title: string;
  summary: SectionSummary;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SUMMARY_COLOURS: Record<SectionSummary['tone'], string> = {
  neutral: '#94A3B8',
  on: '#34D399',
  warn: '#FBBF24'
};

export const EditorSection: React.FC<Props> = ({ title, summary, open, onToggle, children }) => {
  const buttonId = useId();
  const panelId = useId();
  return (
    <section>
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            minHeight: '44px',
            padding: '8px 12px',
            boxSizing: 'border-box',
            textAlign: 'left',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            cursor: 'pointer',
            font: 'inherit'
          }}
        >
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#F3F4F6' }}>{title}</span>
            <span style={{ fontSize: '11px', fontWeight: 500, color: SUMMARY_COLOURS[summary.tone], overflowWrap: 'anywhere' }}>
              {summary.text}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            style={{ flexShrink: 0, color: '#94A3B8', transform: open ? 'rotate(180deg)' : undefined }}
          />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        style={{ marginTop: open ? '10px' : 0, display: open ? 'flex' : undefined, flexDirection: 'column', gap: '16px' }}
      >
        {open ? children : null}
      </div>
    </section>
  );
};
