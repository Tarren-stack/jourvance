import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus, useFieldIds } from '../../lib/a11yHooks';
import type { ChoiceRow, ExitOption } from '../../lib/addStep';

// The step chooser behind + Next, + Before, + Step and a line dragged into empty map. A native
// modal <dialog>, so the page behind it is inert, on the shared dialog stack (useDialogFocus), so
// Escape closes only the top dialog and focus goes back to whatever opened it. The picker knows
// only rows and callbacks: which rows exist, which are refused and why comes from addStep.ts, and
// the parent commits the choice as one map edit and moves focus to the new card.
// A refused row stays in the list, marked unavailable with its reason, so nothing a person
// expected silently disappears; pressing it does nothing.

interface Props {
  /** 'Add next step', 'Add a step before' or 'Add a step on this line' (addStep.pickerTitle). */
  title: string;
  /** The line under the heading naming where the step goes (addStep.pickerAnchorLabel). */
  anchorLabel: string;
  /** Connect from: shown only with two or more (addStep.exitOptions). */
  exits?: ExitOption[];
  exit?: string | null;
  onExit?: (handle: string | null) => void;
  /** A warning shown before anything is chosen, or a refusal after (addStep.exitNote). */
  note: string;
  rows: { recommended: ChoiceRow[]; other: ChoiceRow[] };
  onChoose: (row: ChoiceRow) => void;
  onCancel: () => void;
  /** Where focus goes on close when the opener is gone (a line dragged from a dot has none). */
  fallbackFocusId?: string;
}

const encodeExit = (handle: string | null | undefined) => handle ?? 'main';
const decodeExit = (value: string) => (value === 'main' ? null : value);

const TEXT = 'var(--color-text-main)';
const MUTED = 'var(--color-text-muted)';
const BORDER = 'rgba(255,255,255,0.16)';
const REASON = '#FBBF24';

function matches(row: ChoiceRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${row.label} ${row.detail}`.toLowerCase().includes(q);
}

export const StepPicker: React.FC<Props> = ({
  title,
  anchorLabel,
  exits,
  exit,
  onExit,
  note,
  rows,
  onChoose,
  onCancel,
  fallbackFocusId
}) => {
  const fid = useFieldIds();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Escape reaches both the shared stack's key handler and the dialog's own cancel event.
  const closed = useRef(false);
  const cancel = () => {
    if (closed.current) return;
    closed.current = true;
    onCancel();
  };
  // Registered before showModal runs, so the element recorded to return focus to is the opener.
  const dialogRef = useDialogFocus<HTMLDialogElement>(true, cancel, { modal: true, initialFocus: false, fallbackFocusId });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    searchRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const recommended = useMemo(() => rows.recommended.filter(r => matches(r, query)), [rows, query]);
  const other = useMemo(() => rows.other.filter(r => matches(r, query)), [rows, query]);

  const choose = (row: ChoiceRow) => {
    if (row.refusal) return;
    onChoose(row);
  };

  const renderRow = (row: ChoiceRow) => {
    const reasonId = fid(`reason-${row.key}`);
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => choose(row)}
        aria-disabled={row.refusal ? 'true' : undefined}
        aria-describedby={row.refusal ? reasonId : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '4px',
          textAlign: 'left',
          padding: '10px 12px',
          borderRadius: '8px',
          border: `1px solid ${BORDER}`,
          background: row.refusal ? 'rgba(15, 23, 42, 0.4)' : 'rgba(15, 23, 42, 0.85)',
          color: TEXT,
          cursor: row.refusal ? 'not-allowed' : 'pointer',
          minWidth: 0
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, color: row.refusal ? MUTED : TEXT }}>{row.label}</span>
        <span style={{ fontSize: '12px', color: MUTED, lineHeight: 1.4 }}>{row.detail}</span>
        {row.refusal && (
          <span id={reasonId} style={{ fontSize: '12px', color: REASON, lineHeight: 1.4 }}>
            Unavailable. {row.refusal}
          </span>
        )}
      </button>
    );
  };

  const group = (name: string, id: string, list: ChoiceRow[]) =>
    list.length === 0 ? null : (
      <section aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 id={id} style={{ margin: 0, fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED }}>
          {name}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
          {list.map(renderRow)}
        </div>
      </section>
    );

  const titleId = fid('title');
  const showExits = !!exits && exits.length >= 2;

  return (
    <dialog
      ref={dialogRef}
      className="jv-step-picker"
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        cancel();
      }}
      style={{
        width: 'min(560px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '85vh',
        boxSizing: 'border-box',
        // The global reset zeroes margins, and a modal <dialog> centres itself with margin: auto.
        margin: 'auto',
        padding: 0,
        borderRadius: '12px',
        border: `1px solid ${BORDER}`,
        background: 'var(--color-surface-1)',
        color: TEXT,
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 16px 12px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <h2 id={titleId} style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: TEXT }}>{title}</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: MUTED, overflowWrap: 'anywhere' }}>{anchorLabel}</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={cancel}
              style={{ flexShrink: 0, display: 'inline-flex', padding: '6px', borderRadius: '6px', border: `1px solid ${BORDER}`, background: 'transparent', color: TEXT, cursor: 'pointer' }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {showExits && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: MUTED }}>
              Connect from
              <select
                value={encodeExit(exit)}
                onChange={e => onExit?.(decodeExit(e.target.value))}
                style={{ padding: '8px 10px', borderRadius: '6px', border: `1px solid ${BORDER}`, background: 'rgba(15, 23, 42, 0.85)', color: TEXT, fontSize: '13px' }}
              >
                {exits!.map(option => (
                  <option key={encodeExit(option.handle)} value={encodeExit(option.handle)}>{option.label}</option>
                ))}
              </select>
            </label>
          )}

          <p aria-live="polite" style={{ margin: 0, fontSize: '12px', color: REASON }}>
            {note}
          </p>

          <input
            ref={searchRef}
            type="search"
            aria-label="Search steps"
            placeholder="Search steps"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: '6px', border: `1px solid ${BORDER}`, background: 'rgba(15, 23, 42, 0.85)', color: TEXT, fontSize: '13px' }}
          />
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {group('Recommended', fid('recommended'), recommended)}
          {group('All steps', fid('all'), other)}
          {recommended.length === 0 && other.length === 0 && (
            <p style={{ margin: 0, fontSize: '13px', color: MUTED }}>No steps match.</p>
          )}
        </div>
      </div>
    </dialog>
  );
};
