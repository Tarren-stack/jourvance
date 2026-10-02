import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Mail,
  MessageSquare,
  CheckCircle2,
  ArrowLeft,
  RotateCcw,
  Smartphone,
  Monitor,
  Clock,
  ShoppingBag,
  Lock,
  Check
} from 'lucide-react';
import type {
  JourneyProject,
  JourneyNode,
  AdNodeData,
  PageNodeData,
  FormNodeData,
  FormFieldConfig,
  SequenceNodeData,
  ThankYouNodeData,
  UpsellNodeData,
  AbSplitNodeData
} from '../../types/journey';
import { EDGE_KINDS } from '../../lib/edgeKinds';
import { stepName } from '../../lib/stepNavigation';
import { endSentence, nameInSentence } from '../../lib/stepNames';
import { ownCopy, ownCopyList, thankYouWalkLines } from '../../lib/stepDefaults';
import {
  WALK_INTRO,
  WALK_STEP_LIMIT,
  beginWalk,
  takeExit,
  walkEntries,
  walkExits,
  walkAtLimit,
  startedSequenceIds,
  splitShares,
  pageButtonNote,
  firstNameFrom,
  fillMerge,
  type WalkExit
} from '../../lib/journeyWalk';

// Test Lead Flow (#22). Walks the lines on the map one visitor choice at a time and renders each
// step from its OWN data. Every effect is labelled Simulated: nothing is sent, charged or saved,
// and this file makes no network call. Where a step has no copy yet, it says so rather than
// showing invented copy. The card carries 'nokey' so React Flow's document Backspace handler
// never deletes a selected canvas step while focus is in the dialog.

interface Props {
  project: JourneyProject;
  onClose: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PLATFORM_LINE: Record<AdNodeData['platform'], string> = {
  meta: 'Sponsored on Meta',
  google: 'Sponsored on Google',
  tiktok: 'Sponsored on TikTok',
  organic: 'Organic post'
};

const panel: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '18px',
  borderRadius: '12px',
  background: '#1E293B',
  border: '1px solid rgba(255, 255, 255, 0.1)'
};
const missingStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '6px',
  border: '1px dashed rgba(148, 163, 184, 0.5)',
  color: '#94A3B8',
  fontSize: '12px',
  fontStyle: 'italic',
  fontWeight: 500
};
const noteStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '8px',
  background: 'rgba(251, 191, 36, 0.08)',
  border: '1px solid rgba(251, 191, 36, 0.3)',
  color: '#FDE68A',
  fontSize: '12px',
  lineHeight: 1.5
};
const simulatedPill: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '9999px',
  background: 'rgba(251, 191, 36, 0.15)',
  border: '1px solid rgba(251, 191, 36, 0.4)',
  color: '#FBBF24',
  fontSize: '11px',
  fontWeight: 700,
  whiteSpace: 'nowrap'
};
const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: '9999px',
  background: 'rgba(56, 189, 248, 0.15)',
  color: '#38BDF8',
  fontSize: '11px',
  fontWeight: 700,
  marginBottom: '10px'
};
const footerButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  borderRadius: '8px',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  color: '#F8FAFC',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer'
};
const fieldInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: '6px',
  background: '#0F172A',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  color: '#FFF',
  fontSize: '13px'
};

const Missing: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={missingStyle}>{children}</span>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

/** An image from the step's own data. A failed load hides it rather than showing a broken icon. */
const StepImage: React.FC<{ src: string; height: number }> = ({ src, height }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: '100%', height: `${height}px`, objectFit: 'cover', borderRadius: '8px', marginBottom: '12px', display: 'block' }}
    />
  );
};

const Headline: React.FC<{ text: string; size?: number }> = ({ text, size = 20 }) => (
  <h3 style={{ fontSize: `${size}px`, fontWeight: 800, color: '#FFF', margin: '0 0 8px', lineHeight: 1.3 }}>
    {text || <Missing>No headline yet</Missing>}
  </h3>
);

const Checklist: React.FC<{ items: string[] }> = ({ items }) =>
  items.length ? (
    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((b, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', color: '#E2E8F0' }}>
          <CheckCircle2 size={15} color="#34D399" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  ) : null;

/** A choice button, edged in the colour and dash of the line it follows. */
const ChoiceButton: React.FC<{ exit: WalkExit; disabled: boolean; onTake: () => void; type?: 'button' | 'submit' }> = ({ exit, disabled, onTake, type = 'button' }) => {
  const kind = EDGE_KINDS[exit.kind];
  const isDecline = exit.kind === 'declined' || exit.action === 'declined';
  const isAbandon = exit.action === 'abandon';
  const isAccept = exit.kind === 'accepted' || exit.action === 'accepted';

  let bg = 'rgba(255, 255, 255, 0.06)';
  let borderLeft = `3px ${isDecline || isAbandon ? 'dashed' : 'solid'} ${kind ? kind.color : '#38BDF8'}`;
  let textColor = disabled ? '#64748B' : '#F8FAFC';
  let fontWeight = 700;

  if (isAccept) {
    bg = 'linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.35) 100%)';
    borderLeft = '3px solid #10B981';
    textColor = '#34D399';
  } else if (isDecline || isAbandon) {
    bg = 'rgba(255, 255, 255, 0.03)';
    textColor = disabled ? '#64748B' : '#94A3B8';
    fontWeight = 500;
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={type === 'button' ? onTake : undefined}
      style={{
        textAlign: 'left',
        padding: isAccept ? '12px 16px' : '10px 14px',
        borderRadius: '8px',
        background: bg,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderLeft,
        color: textColor,
        fontSize: '13px',
        fontWeight,
        cursor: disabled ? 'not-allowed' : 'pointer',
        maxWidth: '100%',
        overflowWrap: 'anywhere',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.15s ease'
      }}
    >
      {isAccept && <Check size={14} aria-hidden="true" />}
      <span>{exit.label}</span>
    </button>
  );
};

export const LiveFunnelModal: React.FC<Props> = ({ project, onClose }) => {
  const [path, setPath] = useState(() => beginWalk(project));
  const [values, setValues] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>('mobile');
  const [bumpSelected, setBumpSelected] = useState<boolean>(false);
  const nodeById = useMemo(() => new Map<string, JourneyNode>(project.nodes.map(n => [n.id, n])), [project.nodes]);
  const entries = useMemo(() => walkEntries(project), [project]);

  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves in on open and returns to the opener on close, when the opener is still there
  // (the More menu item is gone by then, so that case is skipped).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  // Escape closes, Tab wraps inside the card, and no key reaches the canvas behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const inside = e.target instanceof Node && card.contains(e.target);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) {
          e.preventDefault();
          headingRef.current?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const at = active ? items.indexOf(active) : -1;
        if (!inside) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (at === -1) {
          // The heading or the step area. The browser's own order stays inside the card unless
          // it would step past the first or last control.
          const before = !!active && !!(active.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
          const after = !!active && !!(active.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_PRECEDING);
          if (e.shiftKey && before) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && after) {
            e.preventDefault();
            first.focus();
          }
        } else if (e.shiftKey && at === 0) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === items.length - 1) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (!inside) {
        // Focus drifted out (a removed button); a Backspace there must not delete a canvas step.
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // A choice replaces the buttons, so move focus to the new step instead of losing it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    scrollRef.current?.scrollTo?.({ top: 0 });
    stepRef.current?.focus({ preventScroll: true });
  }, [path]);

  const current = path[path.length - 1];
  const currentNode = current.nodeId ? nodeById.get(current.nodeId) : undefined;
  const exits = currentNode ? walkExits(project, currentNode.id) : [];
  const atLimit = walkAtLimit(path);
  const started = startedSequenceIds(path);
  const noEntry = path.length === 1 && current.nodeId === null;

  // The fields of every form this visitor has filled in, for the merge preview and the To line.
  const visitedFields = useMemo(() => {
    const seen = new Set<string>();
    const fields: FormFieldConfig[] = [];
    for (const v of path) {
      const n = v.nodeId ? nodeById.get(v.nodeId) : undefined;
      if (n?.type !== 'lead-form' || seen.has(n.id)) continue;
      seen.add(n.id);
      fields.push(...((n.data as FormNodeData).fields || []));
    }
    return fields;
  }, [path, nodeById]);
  const firstName = firstNameFrom(visitedFields, values);
  const addressFor = (type: 'email' | 'tel') => {
    const field = visitedFields.find(f => f.enabled && f.type === type);
    return (field && str(values[field.id])) || 'the test visitor';
  };

  const take = (exit: WalkExit) => setPath(p => takeExit(p, exit, project));
  const restart = () => {
    setPath(beginWalk(project));
    setValues({});
    setBumpSelected(false);
  };

  const renderChoices = (only?: WalkExit[]) => {
    const shown = only ?? exits;
    if (!shown.length) return null;
    return (
      <div role="group" aria-label="Choices" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          What does the visitor do?
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {shown.map(exit => (
            <ChoiceButton key={exit.action} exit={exit} disabled={atLimit} onTake={() => take(exit)} />
          ))}
        </div>
        {shown.some(x => x.skippedNodeIds.length) && (
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>Another line also leaves this choice. The test follows the first one.</div>
        )}
      </div>
    );
  };

  const renderStep = (node: JourneyNode) => {
    switch (node.type) {
      case 'ad-source': {
        const d = node.data as AdNodeData;
        return (
          <div style={{ ...panel, maxWidth: '440px', margin: '0 auto' }}>
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFF' }}>{stepName(node)}</div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>{PLATFORM_LINE[d.platform] || 'Ad'}</div>
            </div>
            <div style={{ fontSize: '13px', color: '#E2E8F0', marginBottom: '12px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {ownCopy(d.body) || <Missing>No ad text yet</Missing>}
            </div>
            <StepImage src={str(d.imageUrl)} height={180} />
            <Headline text={str(d.headline)} size={15} />
            {renderChoices()}
          </div>
        );
      }
      case 'landing-page': {
        const d = node.data as PageNodeData;
        const next = exits.find(x => x.action === 'next');
        const note = pageButtonNote(d, next?.nextNodeId ? nodeById.get(next.nextNodeId)?.type : undefined);
        const slug = str(d.slug);
        const title = str(d.shopifyProductTitle);
        const price = str(d.shopifyProductPrice);
        const hasBump = Boolean(d.orderBumpEnabled);
        const bumpTitle = str(d.orderBumpTitle);
        const bumpPrice = str(d.orderBumpPrice);
        const bumpHeadline = str(d.orderBumpHeadline);
        const bumpDesc = str(d.orderBumpDescription);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {slug && (
              <div style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace' }}>
                Page address: /p/{slug}
              </div>
            )}
            <div style={panel}>
              {str(d.trustBadge) && <div style={badgeStyle}>{str(d.trustBadge)}</div>}
              <StepImage src={str(d.heroImageUrl)} height={160} />
              <Headline text={str(d.headline)} size={22} />
              <p style={{ fontSize: '14px', color: '#CBD5E1', margin: '0 0 12px', lineHeight: 1.6 }}>
                {ownCopy(d.subhead) || <Missing>No subhead yet</Missing>}
              </p>
              <Checklist items={list(ownCopyList(d.bullets))} />

              {/* Core Product Summary */}
              {(title || price) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.25)', fontSize: '13px' }}>
                  <span style={{ color: '#FFF', fontWeight: 700 }}>{title}</span>
                  <span style={{ color: '#34D399', fontWeight: 700 }}>{price}</span>
                </div>
              )}

              {/* Order Bump Add-on Section */}
              {hasBump && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '12px',
                    borderRadius: '8px',
                    background: bumpSelected ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.04)',
                    border: `1px ${bumpSelected ? 'solid' : 'dashed'} rgba(245, 158, 11, 0.4)`,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', background: '#F59E0B', color: '#0F172A', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}>
                      One-Time Add-On
                    </span>
                    {bumpPrice && (
                      <span style={{ color: '#FCD34D', fontSize: '12px', fontWeight: 700 }}>
                        {bumpPrice}
                      </span>
                    )}
                  </div>
                  <label
                    htmlFor="jv-walk-bump"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: '#F8FAFC',
                      fontWeight: 700
                    }}
                  >
                    <input
                      type="checkbox"
                      id="jv-walk-bump"
                      checked={bumpSelected}
                      onChange={e => setBumpSelected(e.target.checked)}
                      style={{ marginTop: '2px', accentColor: '#F59E0B', cursor: 'pointer' }}
                    />
                    <span>
                      {bumpHeadline || (bumpTitle ? `Yes, add ${bumpTitle}` : 'Yes! Add order bump to my purchase')}
                    </span>
                  </label>
                  {bumpDesc && (
                    <div style={{ fontSize: '12px', color: '#CBD5E1', marginTop: '6px', paddingLeft: '24px', lineHeight: 1.5 }}>
                      {bumpDesc}
                    </div>
                  )}
                </div>
              )}

              {/* Simulated Cart Breakdown if Bump is selected */}
              {hasBump && bumpSelected && (title || price) && (
                <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34D399', fontWeight: 700, marginBottom: '6px' }}>
                    <ShoppingBag size={13} aria-hidden="true" />
                    <span>Simulated Cart: Core Product + Add-On Included</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
                    <span>1x {title || 'Core Product'}</span>
                    <span>{price}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#FCD34D' }}>
                    <span>1x {bumpTitle || 'Add-on Bump'}</span>
                    <span>{bumpPrice}</span>
                  </div>
                </div>
              )}

              {renderChoices()}
            </div>
            {d.abTestingEnabled && d.variantB && (
              <div style={noteStyle}>This page also has a variant B. The test shows variant A.</div>
            )}
            {note && <div style={noteStyle}>{note}</div>}
          </div>
        );
      }
      case 'lead-form': {
        const d = node.data as FormNodeData;
        const fields = (d.fields || []).filter(f => f.enabled);
        const submit = exits.find(x => x.action === 'next');
        return (
          <form
            onSubmit={e => {
              e.preventDefault();
              if (submit && !atLimit) take(submit);
            }}
            style={{ ...panel, maxWidth: '520px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <Headline text={str(d.formTitle)} size={17} />
            {!fields.length && <Missing>No fields on this form yet</Missing>}
            {fields.map(f => {
              const id = `jv-test-${f.id}`;
              const common = {
                id,
                name: f.id,
                required: f.required,
                value: values[f.id] ?? '',
                placeholder: f.placeholder,
                style: fieldInput,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                  const value = e.target.value;
                  setValues(v => ({ ...v, [f.id]: value }));
                }
              };
              return (
                <div key={f.id}>
                  <label htmlFor={id} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '4px' }}>
                    {str(f.label) || 'Untitled field'}
                    {f.required && <span style={{ color: '#F87171' }}> (required)</span>}
                  </label>
                  {f.type === 'textarea' ? <textarea rows={2} {...common} /> : <input type={f.type} {...common} />}
                </div>
              );
            })}
            {submit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <ChoiceButton exit={submit} disabled={atLimit} onTake={() => take(submit)} type="submit" />
                </div>
                {submit.skippedNodeIds.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#94A3B8' }}>Another line also leaves this choice. The test follows the first one.</div>
                )}
              </div>
            )}
          </form>
        );
      }
      case 'upsell': {
        const d = node.data as UpsellNodeData;
        const title = str(d.productTitle);
        const price = str(d.productPrice);
        const regular = str(d.regularPrice);
        const minutes = typeof d.urgencyMinutes === 'number' && d.urgencyMinutes > 0 ? d.urgencyMinutes : 0;

        return (
          <div style={{ ...panel, maxWidth: '560px', margin: '0 auto' }}>
            {str(d.badgeText) && <div style={badgeStyle}>{str(d.badgeText)}</div>}
            {minutes > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#FCA5A5', fontSize: '12px', fontWeight: 700, marginBottom: '12px' }}>
                <Clock size={13} color="#EF4444" aria-hidden="true" />
                <span>Simulated offer reservation timer: {String(minutes).padStart(2, '0')}:00 active</span>
              </div>
            )}
            <StepImage src={str(d.productImage)} height={160} />
            <Headline text={str(d.headline)} />
            <p style={{ fontSize: '14px', color: '#CBD5E1', margin: '0 0 12px', lineHeight: 1.6 }}>
              {ownCopy(d.subhead) || <Missing>No subhead yet</Missing>}
            </p>
            <Checklist items={list(ownCopyList(d.benefits))} />
            {(title || price || regular) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px 12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.25)', fontSize: '13px' }}>
                <span style={{ color: '#FFF', fontWeight: 700 }}>{title}</span>
                <span>
                  {price && <span style={{ color: '#34D399', fontWeight: 700 }}>{price}</span>}
                  {regular && <span style={{ color: '#94A3B8', textDecoration: 'line-through', marginLeft: '8px' }}>{regular}</span>}
                </span>
              </div>
            )}
            <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '10px', fontStyle: 'italic' }}>
              Simulated 1-click post-purchase offer: billing information is carried over securely from checkout.
            </div>
            {renderChoices()}
          </div>
        );
      }
      case 'ab-split': {
        const d = node.data as AbSplitNodeData;
        const shares = splitShares(d);
        return (
          <div style={{ ...panel, maxWidth: '520px', margin: '0 auto' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFF', marginBottom: '6px' }}>{stepName(node)}</div>
            <div style={{ fontSize: '13px', color: '#CBD5E1' }}>
              A gets {shares.a}% of live traffic, B gets {shares.b}%.
            </div>
            {shares.lockedTo && (
              <div style={{ ...noteStyle, marginTop: '10px' }}>
                Winner chosen: every live visitor goes to {shares.lockedTo.toUpperCase()}.
              </div>
            )}
            <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '10px' }}>Pick the variant to test.</div>
            {renderChoices()}
          </div>
        );
      }
      case 'thank-you': {
        const d = node.data as ThankYouNodeData;
        const steps = list(d.usageGuideSteps);
        // A blank headline or subhead publishes the page's own line, so show that line and say so.
        const lines = thankYouWalkLines(d);
        return (
          <div style={{ ...panel, maxWidth: '560px', margin: '0 auto' }}>
            {str(d.badgeText) && <div style={badgeStyle}>{str(d.badgeText)}</div>}
            <Headline text={lines.headline} />
            <p style={{ fontSize: '14px', color: '#CBD5E1', margin: '0 0 12px', lineHeight: 1.6 }}>
              {lines.subhead || <Missing>No subhead yet</Missing>}
            </p>
            {lines.defaults.length > 0 && (
              <div style={{ ...noteStyle, marginBottom: '12px' }}>
                The live page shows its default {lines.defaults.join(' and ')} here. Write your own in the step.
              </div>
            )}
            {steps.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                {str(d.usageGuideTitle) && <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFF', marginBottom: '6px' }}>{str(d.usageGuideTitle)}</div>}
                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#E2E8F0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#94A3B8' }}>End of this path.</div>
          </div>
        );
      }
      default:
        return (
          <div style={{ ...panel, maxWidth: '520px', margin: '0 auto', fontSize: '13px', color: '#CBD5E1' }}>
            {endSentence(`The test cannot show ${nameInSentence(stepName(node))}`)} End of this path.
          </div>
        );
    }
  };

  const renderSequences = () => {
    if (!started.length) return null;
    return (
      <section aria-label="Follow-ups started" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#FFF', margin: 0 }}>Follow-ups this visitor would get</h3>
        {started.map(id => {
          const seq = nodeById.get(id);
          if (!seq) return null;
          const d = seq.data as SequenceNodeData;
          const steps = Array.isArray(d.steps) ? d.steps : [];
          return (
            <div key={id} style={{ ...panel, padding: '14px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFF', marginBottom: '10px' }}>{stepName(seq)}</div>
              {!steps.length && <Missing>No messages in this sequence yet</Missing>}
              <ol aria-label={`Messages in ${stepName(seq)}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {steps.map(step => {
                  const email = step.channel !== 'sms';
                  return (
                    <li key={step.id} data-jv-test-message style={{ padding: '12px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 10px', marginBottom: '6px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>
                          {email ? <Mail size={14} color="#FBBF24" aria-hidden="true" /> : <MessageSquare size={14} color="#FBBF24" aria-hidden="true" />}
                          {email ? 'Email' : 'Text message'}
                          <span style={{ fontWeight: 500, color: '#94A3B8' }}>Wait: {str(step.delay) || 'not set'}</span>
                        </span>
                        <span style={simulatedPill}>Simulated · Not sent</span>
                      </div>
                      {email && (
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC', marginBottom: '2px' }}>
                          Subject: {str(step.subject) || <Missing>No subject yet</Missing>}
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '8px' }}>
                        To: {addressFor(email ? 'email' : 'tel')}
                      </div>
                      <div style={{ fontSize: '12px', color: '#CBD5E1', whiteSpace: 'pre-line', lineHeight: 1.6 }}>
                        {str(step.body) ? fillMerge(step.body, firstName) : <Missing>No message text yet</Missing>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </section>
    );
  };

  const trail = path.filter(v => v.nodeId !== null);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(12px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        ref={cardRef}
        className="nokey"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jv-test-flow-title"
        onKeyDown={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          background: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
        }}
      >
        {/* Top bar */}
        <div style={{ padding: '14px 20px', background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <h2 id="jv-test-flow-title" ref={headingRef} tabIndex={-1} style={{ fontSize: '16px', fontWeight: 800, color: '#FFF', margin: 0, outline: 'none' }}>
                  Test lead flow
                </h2>
                <span style={simulatedPill}>Simulated</span>
              </div>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>{WALK_INTRO}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {/* Viewport Switcher */}
              <div
                role="group"
                aria-label="Device viewport"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  padding: '3px',
                  gap: '2px'
                }}
              >
                <button
                  type="button"
                  aria-pressed={viewMode === 'mobile'}
                  onClick={() => setViewMode('mobile')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    background: viewMode === 'mobile' ? '#38BDF8' : 'transparent',
                    color: viewMode === 'mobile' ? '#0F172A' : '#94A3B8',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Smartphone size={13} aria-hidden="true" />
                  <span>Mobile 390px</span>
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'desktop'}
                  onClick={() => setViewMode('desktop')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    background: viewMode === 'desktop' ? '#38BDF8' : 'transparent',
                    color: viewMode === 'desktop' ? '#0F172A' : '#94A3B8',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <Monitor size={13} aria-hidden="true" />
                  <span>Desktop 680px</span>
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close test"
                style={{ background: 'transparent', border: 'none', color: '#CBD5E1', cursor: 'pointer', padding: '6px' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {trail.length > 0 && (
            <ol
              aria-label="Steps so far"
              style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 6px', fontSize: '12px', color: '#94A3B8' }}
            >
              {trail.map((v, i) => {
                const isCurrent = v === current;
                const n = v.nodeId ? nodeById.get(v.nodeId) : undefined;
                return (
                  <li key={i} aria-current={isCurrent ? 'step' : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {i > 0 && <span aria-hidden="true">›</span>}
                    <span style={{ color: isCurrent ? '#38BDF8' : '#94A3B8', fontWeight: isCurrent ? 700 : 500 }}>
                      {n ? stepName(n) : 'Removed step'}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {entries.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
              <label htmlFor="jv-test-start" style={{ fontSize: '12px', color: '#CBD5E1', fontWeight: 600 }}>Start from</label>
              <select
                id="jv-test-start"
                value={path[0].nodeId ?? ''}
                onChange={e => setPath(beginWalk(project, e.target.value))}
                style={{ ...fieldInput, width: 'auto', maxWidth: '100%', padding: '5px 8px', fontSize: '12px' }}
              >
                {entries.map(n => <option key={n.id} value={n.id}>{stepName(n)}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* The current step inside device frame */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <div ref={stepRef} tabIndex={-1} aria-label="Current step" style={{ outline: 'none' }}>
            <div role="status" aria-live="polite" style={{ fontSize: '12px', color: '#FBBF24', fontWeight: 600, minHeight: current.outcome ? undefined : 0, marginBottom: current.outcome ? '12px' : 0 }}>
              {current.outcome || ''}
            </div>

            {noEntry && (
              <div style={{ ...panel, fontSize: '13px', color: '#CBD5E1' }}>This journey has no steps to walk yet.</div>
            )}

            {!noEntry && current.nodeId === null && (
              <div style={{ ...panel, fontSize: '13px', color: '#E2E8F0', lineHeight: 1.6 }}>{current.endSentence}</div>
            )}

            {current.nodeId !== null && !currentNode && (
              <div style={{ ...panel, fontSize: '13px', color: '#CBD5E1' }}>This step is no longer on the map. Restart the test to walk the map as it is now.</div>
            )}

            {currentNode && (
              <div
                data-device-frame={viewMode}
                style={{
                  width: '100%',
                  maxWidth: viewMode === 'mobile' ? '390px' : '680px',
                  margin: '0 auto',
                  background: '#0B0F19',
                  borderRadius: viewMode === 'mobile' ? '32px' : '12px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.7)',
                  overflow: 'hidden',
                  transition: 'max-width 0.2s ease'
                }}
              >
                {/* Device Chrome Header */}
                {viewMode === 'mobile' ? (
                  <div style={{ padding: '10px 16px 8px', background: '#090D16', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    {/* Phone Speaker Notch */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                      <div style={{ width: '48px', height: '4px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.2)' }} />
                    </div>
                    {/* Mobile Status Bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>
                      <span>9:41</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '10px' }}>5G</span>
                        <span style={{ fontSize: '10px' }}>100%</span>
                      </div>
                    </div>
                    {/* Simulated Mobile Browser URL */}
                    <div style={{ marginTop: '6px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94A3B8' }}>
                      <Lock size={10} color="#34D399" aria-hidden="true" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        store.preview/{currentNode.type === 'landing-page' ? (str((currentNode.data as PageNodeData).slug) || 'offer') : currentNode.type}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '8px 14px', background: '#090D16', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Desktop Window Dots */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#EF4444' }} />
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#F59E0B' }} />
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10B981' }} />
                    </div>
                    {/* Desktop Address Bar */}
                    <div style={{ flex: 1, padding: '4px 10px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#94A3B8' }}>
                      <Lock size={10} color="#34D399" aria-hidden="true" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        https://store.preview.shop/{currentNode.type === 'landing-page' ? (str((currentNode.data as PageNodeData).slug) || 'offer') : currentNode.type}
                      </span>
                    </div>
                  </div>
                )}

                {/* Device Content Area */}
                <div style={{ padding: viewMode === 'mobile' ? '14px' : '20px' }}>
                  {renderStep(currentNode)}
                </div>

                {/* Mobile Home Bar */}
                {viewMode === 'mobile' && (
                  <div style={{ padding: '8px 0 10px', display: 'flex', justifyContent: 'center', background: '#090D16' }}>
                    <div style={{ width: '110px', height: '4px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.2)' }} />
                  </div>
                )}
              </div>
            )}

            {atLimit && current.nodeId !== null && (
              <div style={{ ...noteStyle, marginTop: '12px' }}>
                This path has run {WALK_STEP_LIMIT} steps, so the map probably loops. The test stopped here.
              </div>
            )}

            {renderSequences()}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' }}>
          {!noEntry && (
            <>
              <button
                type="button"
                onClick={() => setPath(p => (p.length > 1 ? p.slice(0, -1) : p))}
                disabled={path.length <= 1}
                style={{ ...footerButton, opacity: path.length <= 1 ? 0.5 : 1, cursor: path.length <= 1 ? 'not-allowed' : 'pointer' }}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span>Back one step</span>
              </button>
              <button type="button" onClick={restart} style={footerButton}>
                <RotateCcw size={13} aria-hidden="true" />
                <span>Restart test</span>
              </button>
            </>
          )}
          <button type="button" onClick={onClose} style={footerButton}>Close</button>
        </div>
      </div>
    </div>
  );
};
