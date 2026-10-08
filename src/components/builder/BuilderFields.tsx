// The page builder's form controls (LANDING_BUILDER_DESIGN.md sections 5 and 7), shared by the
// inspector and the theme panel. Every control has a visible label tied to it, every colour control
// has a hex text field beside its picker, and a refusal from the model shows under the field it
// belongs to. A field keeps what was typed while the model refuses it, so a half-typed link is not
// wiped out by the check.

import React, { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { THEME_COLOR_KEYS } from '../../lib/pageBuilder/model.mjs';

export const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '4px' };
export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: '6px',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backgroundColor: '#0B1220',
  color: '#F1F5F9',
  fontSize: '12px',
  fontFamily: 'inherit'
};
export const hintStyle: React.CSSProperties = { margin: '3px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: 1.4 };
export const errorStyle: React.CSSProperties = { margin: '3px 0 0', fontSize: '11px', color: '#FCA5A5', lineHeight: 1.4 };
export const smallButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  color: '#E2E8F0',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer'
};

/** The text a field shows for a value: numbers as typed, nothing for unset. */
const shown = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

interface Shell {
  label: string;
  hint?: string;
  error?: string | null;
  /** Shown on the label's line, right-aligned: a clear control for a style override. */
  aside?: React.ReactNode;
}

function FieldFrame({ id, label, hint, error, aside, children }: Shell & { id: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        {aside}
      </div>
      {children}
      {hint && <p id={`${id}-hint`} style={hintStyle}>{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" style={errorStyle}>{error}</p>}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string | null) =>
  [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

/** Text, a link, an anchor or a class: every keystroke goes to the model, the field keeps what was typed. */
export function TextField({
  label, value, onChange, hint, error, aside, multiline = false, placeholder, inputMode, monospace = false, rows = 3
}: Shell & {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  monospace?: boolean;
  rows?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const common = {
    id,
    value: draft,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, hint, error),
    style: { ...inputStyle, ...(monospace ? { fontFamily: 'var(--font-mono)' } : {}) }
  };
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} aside={aside}>
      {multiline ? (
        <textarea {...common} rows={rows} onChange={e => { setDraft(e.target.value); onChange(e.target.value); }} style={{ ...common.style, resize: 'vertical' }} />
      ) : (
        <input {...common} type="text" inputMode={inputMode} onChange={e => { setDraft(e.target.value); onChange(e.target.value); }} />
      )}
    </FieldFrame>
  );
}

/** A number in a range. Empty means unset (`onChange(undefined)`), which a style field reads as "inherit". */
export function NumberField({
  label, value, onChange, min, max, step, unit, hint, error, aside, placeholder
}: Shell & {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(shown(value));
  useEffect(() => setDraft(shown(value)), [value]);
  return (
    <FieldFrame id={id} label={unit ? `${label} (${unit})` : label} hint={hint} error={error} aside={aside}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step ?? 'any'}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw.trim() === '') {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={inputStyle}
      />
    </FieldFrame>
  );
}

export function SelectField({
  label, value, options, onChange, hint, error, aside
}: Shell & {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} aside={aside}>
      <select
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </FieldFrame>
  );
}

export function CheckField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input id={id} type="checkbox" checked={checked} aria-describedby={hint ? `${id}-hint` : undefined} onChange={e => onChange(e.target.checked)} />
        <label htmlFor={id} style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
      </div>
      {hint && <p id={`${id}-hint`} style={hintStyle}>{hint}</p>}
    </div>
  );
}

const THEME_COLOR_NAMES: Record<string, string> = {
  primary: 'Main colour',
  secondary: 'Second colour',
  background: 'Page background',
  surface: 'Card background',
  text: 'Text',
  muted: 'Quiet text'
};

/** A #rrggbb a native colour picker can show for any hex the model accepts. */
function pickerHex(v: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (!m) return '#000000';
  const h = m[1];
  if (h.length === 3) return `#${h.split('').map(c => c + c).join('')}`.toLowerCase();
  return `#${h.slice(0, 6)}`.toLowerCase();
}

/**
 * A colour: a theme colour by name, or a custom hex with a picker and a hex text field beside it.
 * `allowTheme` false (the theme's own colours) shows the custom controls only.
 */
export function ColorField({
  label, value, onChange, hint, error, aside, allowTheme = true
}: Shell & { value: string | undefined; onChange: (v: string | undefined) => void; allowTheme?: boolean }) {
  const id = useId();
  const current = value ?? '';
  const token = /^theme\.([a-z]+)$/i.exec(current)?.[1] ?? '';
  const [hex, setHex] = useState(token ? '' : current);
  useEffect(() => setHex(token ? '' : current), [current, token]);
  const choice = token ? `theme.${token}` : current ? 'custom' : allowTheme ? '' : 'custom';
  return (
    <FieldFrame id={allowTheme ? id : `${id}-hex`} label={label} hint={hint} error={error} aside={aside}>
      {allowTheme && (
        <select
          id={id}
          value={choice}
          aria-describedby={describedBy(id, hint, error)}
          onChange={e => {
            const v = e.target.value;
            if (v === '') onChange(undefined);
            else if (v === 'custom') onChange(/^#/.test(hex) ? hex : '#ffffff');
            else onChange(v);
          }}
          style={{ ...inputStyle, marginBottom: choice === 'custom' ? '6px' : 0 }}
        >
          <option value="">Not set</option>
          {THEME_COLOR_KEYS.map(k => <option key={k} value={`theme.${k}`}>{`Theme: ${THEME_COLOR_NAMES[k] ?? k}`}</option>)}
          <option value="custom">Custom colour</option>
        </select>
      )}
      {choice === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="color"
            aria-label={`${label}, colour picker`}
            value={pickerHex(hex || current)}
            onChange={e => {
              setHex(e.target.value);
              onChange(e.target.value);
            }}
            style={{ width: '36px', height: '30px', padding: 0, border: '1px solid rgba(255, 255, 255, 0.14)', borderRadius: '6px', backgroundColor: 'transparent', cursor: 'pointer' }}
          />
          <input
            id={`${id}-hex`}
            type="text"
            aria-label={allowTheme ? `${label}, colour code` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(allowTheme ? id : `${id}-hex`, hint, error)}
            value={hex}
            placeholder="#ec4899"
            spellCheck={false}
            onChange={e => {
              setHex(e.target.value);
              onChange(e.target.value);
            }}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          />
        </div>
      )}
    </FieldFrame>
  );
}

/** The "clear this device's value" control beside a style field that is set on this device. */
export function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClear} style={{ ...smallButton, padding: '2px 6px', marginBottom: '4px' }}>
      <X size={11} aria-hidden="true" />
      <span>Clear</span>
    </button>
  );
}

/** A date and time with the browser's time zone, written as ISO 8601 with its offset (design section 8, question 7). */
export function DateTimeField({ label, value, onChange, hint, error }: Shell & { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const local = (() => {
    const t = Date.parse(value);
    if (!value || !Number.isFinite(t)) return '';
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  return (
    <FieldFrame id={id} label={label} hint={hint ?? 'In your own time zone.'} error={error}>
      <input
        id={id}
        type="datetime-local"
        value={local}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint ?? 'x', error)}
        onChange={e => {
          const raw = e.target.value;
          if (!raw) {
            onChange('');
            return;
          }
          const d = new Date(raw);
          if (!Number.isFinite(d.getTime())) return;
          const offset = -d.getTimezoneOffset();
          const sign = offset >= 0 ? '+' : '-';
          const abs = Math.abs(offset);
          const pad = (n: number) => String(n).padStart(2, '0');
          onChange(`${raw}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`);
        }}
        style={inputStyle}
      />
    </FieldFrame>
  );
}
