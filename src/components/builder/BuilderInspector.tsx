// The page builder's inspector (LANDING_BUILDER_DESIGN.md sections 5 and 6): Content, Style and
// Advanced for the selected block, or the page theme when nothing is selected.
//
// Content draws one field per prop from the registry's spec. Style draws the style keys grouped as
// in design section 2 and edits the layer of the device the switch shows: a value inherited from a
// larger device says so, and a value set on this device can be cleared back to the inherited one.
// Advanced holds the anchor (sections), the CSS class (one for every device) and hide per device.

import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Monitor, Plus, Smartphone, Tablet, Trash2, type LucideIcon } from 'lucide-react';
import { SECTION_PROPS, STYLE_KEYS, WIDGET_REGISTRY, findNode, resolveStyle } from '../../lib/pageBuilder/model.mjs';
import type {
  BuilderDevice,
  BuilderDoc,
  BuilderNode,
  BuilderWidget,
  PropSpec,
  StyleSpec,
  StyleValues
} from '../../types/pageBuilder';
import type { BuilderAction, BuilderNotice } from './builderState';
import {
  CheckField,
  ClearButton,
  ColorField,
  DateTimeField,
  NumberField,
  SelectField,
  TextField,
  hintStyle,
  smallButton
} from './BuilderFields';
import { BuilderThemePanel, FONT_CHOICES } from './BuilderThemePanel';
import { REWRITABLE, RewriteControl } from './BuilderRewrite';

export const DEVICE_NAMES: Readonly<Record<BuilderDevice, string>> = Object.freeze({ desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' });
const DEVICE_ORDER: BuilderDevice[] = ['desktop', 'tablet', 'mobile'];
const DEVICE_ICONS: Record<BuilderDevice, LucideIcon> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone
};

/**
 * The device switch: a radio group, one tab stop, arrows move and choose (design section 7, "the
 * device switch is a radio group named Editing for").
 */
export function DeviceSwitch({ device, onDevice, label = 'Editing for', compact = false }: { device: BuilderDevice; onDevice: (d: BuilderDevice) => void; label?: string; compact?: boolean }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (delta: number) => {
    const next = DEVICE_ORDER[(DEVICE_ORDER.indexOf(device) + delta + DEVICE_ORDER.length) % DEVICE_ORDER.length];
    onDevice(next);
    requestAnimationFrame(() => refs.current[next]?.focus());
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: '8px', backgroundColor: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
    >
      {DEVICE_ORDER.map(d => {
        const Icon = DEVICE_ICONS[d];
        const checked = d === device;
        return (
          <button
            key={d}
            ref={el => { refs.current[d] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={DEVICE_NAMES[d]}
            tabIndex={checked ? 0 : -1}
            onClick={() => onDevice(d)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: compact ? '4px 7px' : '5px 9px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: checked ? '#4338CA' : 'transparent',
              color: checked ? '#FFFFFF' : '#CBD5E1'
            }}
          >
            <Icon size={14} aria-hidden="true" />
            {!compact && <span>{DEVICE_NAMES[d]}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface BuilderInspectorProps {
  doc: BuilderDoc;
  device: BuilderDevice;
  selectedId: string | null;
  notice: BuilderNotice | null;
  dispatch: (action: BuilderAction) => void;
  onDevice: (device: BuilderDevice) => void;
  labelOf: (id: string) => string;
  /** Says a sentence in the builder's polite live region (an AI rewrite's outcome). */
  onSay?: (text: string) => void;
}

type Tab = 'content' | 'style' | 'advanced';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'content', label: 'Content' },
  { id: 'style', label: 'Style' },
  { id: 'advanced', label: 'Advanced' }
];

const STYLE_GROUPS: Array<{ id: StyleSpec['group']; label: string }> = [
  { id: 'spacing', label: 'Spacing' },
  { id: 'layout', label: 'Size and position' },
  { id: 'typography', label: 'Text' },
  { id: 'background', label: 'Background' },
  { id: 'border', label: 'Border and shadow' }
];

/** Friendlier words for enum values a merchant picks from. Anything not listed shows as written. */
const ENUM_WORDS: Record<string, string> = {
  boxed: 'Boxed (within the page width)',
  full: 'Full width',
  never: 'Never',
  'lead-gate': 'Ask for an email first',
  direct: 'Go straight to checkout',
  checkout: 'Checkout started',
  add: 'Added to cart',
  evergreen: 'Each visitor gets their own clock',
  deadline: 'Everyone counts down to one date',
  hidden: 'Hidden',
  optional: 'Optional',
  required: 'Required',
  message: 'Show a thank-you line',
  start: 'Start',
  end: 'End',
  stretch: 'Stretch',
  center: 'Centre',
  top: 'Top',
  middle: 'Middle',
  bottom: 'Bottom',
  none: 'None',
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
  xl: 'Extra large'
};

const enumLabel = (v: string | number, key: string): string => {
  if (key === 'level') return `Heading ${v}`;
  if (key === 'fontWeight') return String(v);
  const s = String(v);
  return ENUM_WORDS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
};

const coalesceAt = () => Date.now();

const errorFor = (notice: BuilderNotice | null, target: string): string | null => (notice && notice.target === target ? notice.text : null);

// ---- Content ----

function PropField({
  node, propKey, spec, value, fallback, dispatch, notice
}: {
  node: BuilderNode;
  propKey: string;
  spec: PropSpec;
  value: unknown;
  fallback?: string;
  dispatch: (a: BuilderAction) => void;
  notice: BuilderNotice | null;
}) {
  const target = `props.${propKey}`;
  const error = errorFor(notice, target);
  const set = (v: unknown) =>
    dispatch({ type: 'setProps', id: node.id, props: { [propKey]: v }, target, coalesce: `props:${node.id}:${propKey}`, at: coalesceAt() });
  const hint = fallback ? `Left empty, the page shows "${fallback}".` : undefined;
  switch (spec.kind) {
    case 'string':
      return (
        <TextField
          label={spec.label}
          value={typeof value === 'string' ? value : ''}
          multiline={spec.multiline}
          rows={spec.markdown ? 6 : 3}
          hint={spec.markdown ? `${hint ? `${hint} ` : ''}Use **bold**, *italic*, [a link](https://example.com) and lines starting with - for a list.` : hint}
          error={error}
          onChange={set}
        />
      );
    case 'anchor':
      return <TextField label={spec.label} value={typeof value === 'string' ? value : ''} hint="Letters, digits, hyphens and underscores, starting with a letter. Link to it with #name." error={error} onChange={set} />;
    case 'html':
      return <TextField label={spec.label} value={typeof value === 'string' ? value : ''} multiline monospace rows={6} hint="Anything that runs code (scripts, onclick and javascript: links) is removed when the page is drawn." error={error} onChange={set} />;
    case 'url':
      return (
        <TextField
          label={spec.label}
          value={typeof value === 'string' ? value : ''}
          inputMode="url"
          placeholder={spec.video ? 'https://www.youtube.com/watch?v=...' : 'https:// or /page or #section'}
          hint={spec.video ? 'A YouTube or Vimeo address.' : undefined}
          error={error}
          onChange={set}
        />
      );
    case 'color':
      return <ColorField label={spec.label} value={typeof value === 'string' ? value : undefined} error={error} onChange={v => set(v ?? '')} />;
    case 'number':
      return (
        <NumberField
          label={spec.label}
          value={typeof value === 'number' ? value : undefined}
          min={spec.min}
          max={spec.max}
          step={spec.integer ? 1 : undefined}
          unit={spec.unit}
          hint={`From ${spec.min} to ${spec.max}.`}
          error={error}
          onChange={v => {
            if (v !== undefined) set(v);
          }}
        />
      );
    case 'boolean':
      return <CheckField label={spec.label} checked={value === true} onChange={set} />;
    case 'enum':
      return (
        <SelectField
          label={spec.label}
          value={String(value ?? spec.values[0])}
          options={spec.values.map(v => ({ value: String(v), label: enumLabel(v, propKey) }))}
          error={error}
          onChange={v => set(typeof spec.values[0] === 'number' ? Number(v) : v)}
        />
      );
    case 'datetime':
      return <DateTimeField label={spec.label} value={typeof value === 'string' ? value : ''} error={error} onChange={set} />;
    case 'list':
      return <ListField node={node} propKey={propKey} spec={spec} value={value} dispatch={dispatch} error={error} />;
    default:
      return null;
  }
}

/** A list prop: one box per item with its own fields, and add, move and remove per item. */
function ListField({
  node, propKey, spec, value, dispatch, error
}: {
  node: BuilderNode;
  propKey: string;
  spec: Extract<PropSpec, { kind: 'list' }>;
  value: unknown;
  dispatch: (a: BuilderAction) => void;
  error: string | null;
}) {
  const headingId = useId();
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const target = `props.${propKey}`;
  const write = (next: Array<Record<string, unknown>>, coalesce?: string) =>
    dispatch({ type: 'setProps', id: node.id, props: { [propKey]: next }, target, coalesce, at: coalesce ? coalesceAt() : undefined });
  const blankItem = () => {
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(spec.item)) out[k] = s.kind === 'number' ? (s.min > 0 ? s.min : 0) : '';
    return out;
  };
  const fields = Object.entries(spec.item);
  const single = fields.length === 1;
  const itemWord = spec.itemLabel;
  return (
    <div role="group" aria-labelledby={headingId} style={{ marginBottom: '12px' }}>
      <p id={headingId} style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: '#CBD5E1' }}>{spec.label}</p>
      {items.length === 0 && <p style={{ ...hintStyle, marginBottom: '6px' }}>None yet.</p>}
      {items.map((it, i) => (
        <div key={i} style={{ border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: single ? '6px 8px 0' : '8px 8px 0', marginBottom: '6px' }}>
          {fields.map(([field, fieldSpec]) => {
            const v = it?.[field];
            const setField = (nv: unknown) => write(items.map((x, j) => (j === i ? { ...x, [field]: nv } : x)), `props:${node.id}:${propKey}:${i}:${field}`);
            const label = single ? `${capital(itemWord)} ${i + 1}` : `${fieldSpec.label} (${itemWord} ${i + 1})`;
            if (fieldSpec.kind === 'number') {
              return <NumberField key={field} label={label} value={typeof v === 'number' ? v : undefined} min={fieldSpec.min} max={fieldSpec.max} step={fieldSpec.integer ? 1 : undefined} onChange={nv => { if (nv !== undefined) setField(nv); }} />;
            }
            if (fieldSpec.kind === 'url') {
              return <TextField key={field} label={label} value={typeof v === 'string' ? v : ''} inputMode="url" placeholder="https://" onChange={setField} />;
            }
            return <TextField key={field} label={label} value={typeof v === 'string' ? v : ''} multiline={fieldSpec.kind === 'string' && fieldSpec.multiline} onChange={setField} />;
          })}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <button type="button" aria-label={`Move ${itemWord} ${i + 1} up`} disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; write(n); }} style={smallButton}>
              <ArrowUp size={12} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Move ${itemWord} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => { const n = [...items]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; write(n); }} style={smallButton}>
              <ArrowDown size={12} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Remove ${itemWord} ${i + 1}`} onClick={() => write(items.filter((_, j) => j !== i))} style={{ ...smallButton, color: '#FECACA' }}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      {items.length < spec.max && (
        <button type="button" onClick={() => write([...items, blankItem()])} style={smallButton}>
          <Plus size={12} aria-hidden="true" />
          <span>{`Add ${itemWord}`}</span>
        </button>
      )}
      {error && <p role="alert" style={{ margin: '4px 0 0', fontSize: '11px', color: '#FCA5A5' }}>{error}</p>}
    </div>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Rewrite with AI" under a text field the route can rewrite, applied as one undoable setProps. */
function RewriteFor({ node, propKey, value, label, dispatch, onSay }: {
  node: BuilderWidget;
  propKey: string;
  value: unknown;
  label: string;
  dispatch: (a: BuilderAction) => void;
  onSay: (text: string) => void;
}) {
  const kind = REWRITABLE[node.type]?.[propKey];
  if (!kind) return null;
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const text = kind === 'list'
    ? items.map(i => (typeof i?.text === 'string' ? i.text : '')).filter(Boolean).join('\n')
    : typeof value === 'string' ? value : '';
  const apply = (next: string | string[]) => {
    const props = kind === 'list'
      ? { [propKey]: (Array.isArray(next) ? next : String(next).split('\n')).map((t, i) => ({ ...(items[i] ?? {}), text: t })) }
      : { [propKey]: Array.isArray(next) ? next.join('\n') : next };
    dispatch({ type: 'setProps', id: node.id, props, target: `props.${propKey}` });
  };
  return <RewriteControl kind={kind} text={text} name={label} onApply={apply} onSay={onSay} />;
}

function ContentTab({ node, dispatch, notice, isInner, onSay }: { node: BuilderNode; dispatch: (a: BuilderAction) => void; notice: BuilderNotice | null; isInner: boolean; onSay: (text: string) => void }) {
  if (node.kind === 'column') {
    return <p style={hintStyle}>A column has no content settings of its own. Set its width and spacing in Style, and add blocks to it from Add blocks.</p>;
  }
  if (node.kind === 'section') {
    const props = (node.props || {}) as unknown as Record<string, unknown>;
    return (
      <>
        {(Object.entries(SECTION_PROPS) as Array<[string, PropSpec]>).filter(([k]) => k !== 'anchor').map(([key, spec]) => (
          <PropField key={key} node={node} propKey={key} spec={spec} value={props[key] ?? ((spec.kind === 'string' || spec.kind === 'anchor') ? '' : undefined)} dispatch={dispatch} notice={notice} />
        ))}
        <p style={hintStyle}>{isInner ? 'An inner section sits inside a column of the section around it.' : 'The name is for this outline only. Visitors never see it.'}</p>
      </>
    );
  }
  const widget = node as BuilderWidget;
  const def = (WIDGET_REGISTRY as unknown as Record<string, { label: string; description: string; defaultProps: Record<string, unknown>; fallbacks: Record<string, string>; props: Record<string, PropSpec> }>)[widget.type];
  if (!def) return <p style={hintStyle}>This block type is not one this builder knows.</p>;
  const props = { ...def.defaultProps, ...((widget.props || {}) as Record<string, unknown>) };
  const entries = Object.entries(def.props);
  return (
    <>
      <p style={{ ...hintStyle, marginTop: 0, marginBottom: '10px' }}>{def.description}</p>
      {entries.length === 0 && <p style={hintStyle}>Nothing to fill in. Set its size in Style.</p>}
      {entries.map(([key, spec]) => (
        <React.Fragment key={key}>
          <PropField node={widget} propKey={key} spec={spec} value={props[key]} fallback={def.fallbacks[key]} dispatch={dispatch} notice={notice} />
          <RewriteFor node={widget} propKey={key} value={props[key]} label={`${def.label} ${spec.label.toLowerCase()}`} dispatch={dispatch} onSay={onSay} />
        </React.Fragment>
      ))}
    </>
  );
}

// ---- Style ----

function StyleField({
  node, styleKey, spec, device, dispatch, notice
}: {
  node: BuilderNode;
  styleKey: keyof StyleValues;
  spec: StyleSpec;
  device: BuilderDevice;
  dispatch: (a: BuilderAction) => void;
  notice: BuilderNotice | null;
}) {
  const resolved = resolveStyle(node, device) as Record<string, unknown>;
  const layer = (node.style?.[device] ?? {}) as Record<string, unknown>;
  const own = layer[styleKey];
  const value = resolved[styleKey];
  const target = `style.${styleKey}`;
  const error = errorFor(notice, target);
  const set = (v: unknown) =>
    dispatch({ type: 'setStyle', id: node.id, values: { [styleKey]: v }, target, coalesce: `style:${node.id}:${device}:${styleKey}`, at: coalesceAt() });
  const inheritedFrom: BuilderDevice | null =
    own === undefined && value !== undefined
      ? device === 'mobile' && node.style?.tablet && (node.style.tablet as Record<string, unknown>)[styleKey] !== undefined ? 'tablet' : 'desktop'
      : null;
  const hint = inheritedFrom ? `Inherited from ${DEVICE_NAMES[inheritedFrom].toLowerCase()}. Change it to set it for ${DEVICE_NAMES[device].toLowerCase()} only.` : own !== undefined && device !== 'desktop' ? `Set for ${DEVICE_NAMES[device].toLowerCase()} only.` : undefined;
  const aside = own !== undefined ? <ClearButton label={`Clear ${spec.label} for ${DEVICE_NAMES[device].toLowerCase()}`} onClear={() => set(undefined)} /> : undefined;

  switch (spec.kind) {
    case 'number':
      return (
        <NumberField
          label={spec.label}
          value={typeof value === 'number' ? value : undefined}
          min={spec.min}
          max={spec.max}
          unit={spec.unit || undefined}
          hint={hint}
          error={error}
          aside={aside}
          onChange={set}
        />
      );
    case 'color':
      return <ColorField label={spec.label} value={typeof value === 'string' ? value : undefined} hint={hint} error={error} aside={aside} onChange={set} />;
    case 'url':
      return <TextField label={spec.label} value={typeof value === 'string' ? value : ''} inputMode="url" placeholder="https://" hint={hint} error={error} aside={aside} onChange={v => set(v === '' ? undefined : v)} />;
    case 'enum':
      return (
        <SelectField
          label={spec.label}
          value={value === undefined ? '' : String(value)}
          options={[{ value: '', label: 'Not set' }, ...spec.values.map(v => ({ value: String(v), label: enumLabel(v, styleKey) }))]}
          hint={hint}
          error={error}
          aside={aside}
          onChange={v => set(v === '' ? undefined : typeof spec.values[0] === 'number' ? Number(v) : v)}
        />
      );
    case 'font':
      return (
        <SelectField
          label={spec.label}
          value={typeof value === 'string' ? value : ''}
          options={[
            { value: '', label: 'Not set' },
            { value: 'theme.heading', label: 'Theme heading font' },
            { value: 'theme.body', label: 'Theme body font' },
            ...FONT_CHOICES.map(f => ({ value: f, label: f })),
            ...(typeof value === 'string' && value && !value.startsWith('theme.') && !FONT_CHOICES.includes(value) ? [{ value, label: value }] : [])
          ]}
          hint={hint}
          error={error}
          aside={aside}
          onChange={v => set(v === '' ? undefined : v)}
        />
      );
    default:
      return null;
  }
}

function StyleTab({ node, device, onDevice, dispatch, notice }: { node: BuilderNode; device: BuilderDevice; onDevice: (d: BuilderDevice) => void; dispatch: (a: BuilderAction) => void; notice: BuilderNotice | null }) {
  const keys = Object.entries(STYLE_KEYS) as Array<[keyof StyleValues, StyleSpec]>;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <DeviceSwitch device={device} onDevice={onDevice} label="Style for" compact />
        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{device === 'desktop' ? 'Desktop sets every device.' : `Changes here apply to ${DEVICE_NAMES[device].toLowerCase()}${device === 'tablet' ? ' and mobile' : ''}.`}</span>
      </div>
      {STYLE_GROUPS.map(group => {
        const inGroup = keys.filter(([key, spec]) => spec.group === group.id && !(node.kind === 'widget' && key === 'verticalAlign'));
        if (!inGroup.length) return null;
        return (
          <details key={group.id} open={group.id === 'spacing'} style={{ marginBottom: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '6px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: '#E2E8F0', marginBottom: '8px' }}>{group.label}</summary>
            <div style={{ display: 'grid', gridTemplateColumns: group.id === 'spacing' ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)', columnGap: '8px' }}>
              {inGroup.map(([key, spec]) => (
                <StyleField key={key} node={node} styleKey={key} spec={spec} device={device} dispatch={dispatch} notice={notice} />
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

// ---- Advanced ----

function AdvancedTab({ node, dispatch, notice }: { node: BuilderNode; dispatch: (a: BuilderAction) => void; notice: BuilderNotice | null }) {
  const hidden = {
    desktop: resolveStyle(node, 'desktop').hidden === true,
    tablet: resolveStyle(node, 'tablet').hidden === true,
    mobile: resolveStyle(node, 'mobile').hidden === true
  };
  const className = typeof node.style?.desktop?.customClass === 'string' ? node.style.desktop.customClass : '';
  return (
    <>
      {node.kind === 'section' && (
        <PropField node={node} propKey="anchor" spec={SECTION_PROPS.anchor as PropSpec} value={(node.props as { anchor?: string }).anchor ?? ''} dispatch={dispatch} notice={notice} />
      )}
      <TextField
        label="CSS class"
        value={className}
        hint="For developers: a class name your own style sheet uses, applied on every device. Names only, separated by spaces."
        error={errorFor(notice, 'style.customClass')}
        onChange={v => dispatch({ type: 'setClass', id: node.id, className: v, coalesce: `class:${node.id}`, at: coalesceAt() })}
      />
      <div role="group" aria-labelledby="jvb-hide-on" style={{ marginTop: '6px' }}>
        <p id="jvb-hide-on" style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, color: '#CBD5E1' }}>Hide on</p>
        {DEVICE_ORDER.map(d => (
          <CheckField
            key={d}
            label={`Hide on ${DEVICE_NAMES[d].toLowerCase()}`}
            checked={hidden[d]}
            onChange={v => dispatch({ type: 'setVisibility', id: node.id, hidden: { ...hidden, [d]: v } })}
          />
        ))}
        <p style={hintStyle}>A hidden block stays in the outline, marked Hidden, so you can bring it back.</p>
      </div>
    </>
  );
}

// ---- The inspector ----

const quiet = () => {};

export const BuilderInspector: React.FC<BuilderInspectorProps> = ({ doc, device, selectedId, notice, dispatch, onDevice, labelOf, onSay = quiet }) => {
  const [tab, setTab] = useState<Tab>('content');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const found = selectedId ? findNode(doc, selectedId) : null;

  useEffect(() => {
    if (found?.node.kind === 'column' && tab === 'content') setTab('style');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  if (!found) {
    return (
      <section aria-labelledby="jvb-theme-title" style={{ display: 'flex', flexDirection: 'column' }}>
        <h3 id="jvb-theme-title" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Page theme</h3>
        <p style={{ ...hintStyle, marginBottom: '10px' }}>Select a block on the page or in the outline to edit it. These settings apply to the whole page.</p>
        <BuilderThemePanel theme={doc.theme} dispatch={dispatch} notice={notice} />
      </section>
    );
  }

  const node = found.node;
  const isInner = node.kind === 'section' && found.parent !== null;
  const pick = (index: number) => {
    const next = TABS[(index + TABS.length) % TABS.length].id;
    setTab(next);
    requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  return (
    <section aria-labelledby={`${baseId}-title`} style={{ display: 'flex', flexDirection: 'column' }}>
      <h3 id={`${baseId}-title`} style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>{labelOf(node.id)}</h3>
      <div role="tablist" aria-label="Block settings" style={{ display: 'flex', gap: '2px', margin: '8px 0 10px', padding: '2px', borderRadius: '8px', backgroundColor: 'rgba(0, 0, 0, 0.35)' }}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                pick(i + 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                pick(i - 1);
              }
            }}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: tab === t.id ? '#4338CA' : 'transparent',
              color: tab === t.id ? '#FFFFFF' : '#CBD5E1'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`}>
        {tab === 'content' && <ContentTab key={node.id} node={node} dispatch={dispatch} notice={notice} isInner={isInner} onSay={onSay} />}
        {tab === 'style' && <StyleTab key={`${node.id}:${device}`} node={node} device={device} onDevice={onDevice} dispatch={dispatch} notice={notice} />}
        {tab === 'advanced' && <AdvancedTab key={node.id} node={node} dispatch={dispatch} notice={notice} />}
      </div>
    </section>
  );
};
