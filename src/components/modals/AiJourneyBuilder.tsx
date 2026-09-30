import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, WandSparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { JourneyProject } from '../../types/journey';
import { useDialogFocus } from '../../lib/a11yHooks';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../../lib/a11y';
import { requestJourneyPlan } from '../../lib/hubClient';
import {
  BRIEF_LIMITS,
  DEFAULT_BRIEF,
  aiPlanOutcome,
  LIMIT_WAITED_MESSAGE,
  buildJourneyFromPlan,
  claimFlags,
  createBlocker,
  fieldInputId,
  planProblems,
  readSavedAiDraft,
  simulateAiJourney,
  writeSavedAiDraft,
  type AiEmailRole,
  type AiPageRole,
  type AiPlatform,
  type JourneyAiBrief,
  type JourneyAiPlan,
  type WalkChoices
} from '../../lib/journeyAi';

/**
 * Draft with AI (#25): a brief, one paid AI draft, and a review screen where every word can be
 * edited before Create builds the map in code. Nothing is published or sent. The brief and plan
 * are kept in sessionStorage so closing by accident does not waste a paid call.
 *
 * Keys: the panel stops every key from reaching the document, so React Flow's Backspace delete
 * (which listens there) cannot remove a selected step behind the dialog. That also keeps the keys
 * from useDialogFocus's document listener, so Tab and Escape are handled here; the hook still puts
 * the dialog on the stack, moves focus in and puts it back on close.
 *
 * Focus never falls to the page while the dialog is open: Draft and Create stay focusable while
 * busy (aria-disabled, never disabled), Retry hands focus to the status line when it unmounts, and
 * a refusal hands it to Retry or the alert. A capture guard on the document is the last line: a
 * Backspace or Delete from outside the panel never reaches the map while the dialog is open.
 */

export interface AiJourneyBuilderProps {
  signedIn: boolean;
  businessType?: string;
  workspaceId?: string;
  onOpenAuth: () => void;
  onOpenBlueprints: () => void;
  /** Answers null when the journey is on the canvas, or the sentence that says why it is not. */
  onCreate: (journey: JourneyProject) => Promise<string | null>;
  onClose: () => void;
  /** 'add' once the journey library can hold more than one journey: Create adds, never replaces. */
  createMode?: 'replace' | 'add';
}

const TITLE_ID = 'ai-builder-title';
const REVIEW_HEADING_ID = 'ai-review-heading';
const STATUS_ID = 'ai-draft-status';
const REFUSAL_ID = 'ai-draft-refusal';
const RETRY_ID = 'ai-draft-retry';
// <summary> is tabbable but not in the shared selector, and the review screen has one per step.
const TRAP_SELECTOR = `${FOCUSABLE_SELECTOR}, summary`;

const C = {
  panel: '#0F172A',
  text: '#E2E8F0',
  muted: '#94A3B8',
  field: '#1E293B',
  border: '#334155',
  amber: '#FBBF24',
  amberBg: '#1F1B0E',
  red: '#FCA5A5',
  redBg: '#2A1215',
  violet: '#C4B5FD',
  violetBg: '#1B1833',
  primary: '#4F46E5'
};

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: C.text, marginBottom: '4px' };
const helpStyle: React.CSSProperties = { fontSize: '12px', color: C.muted, marginTop: '4px', lineHeight: 1.45 };
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: C.field,
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  color: '#F1F5F9',
  fontSize: '13px',
  padding: '8px 10px',
  fontFamily: 'inherit'
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', lineHeight: 1.45 };
const fieldWrap: React.CSSProperties = { marginBottom: '12px', minWidth: 0 };
const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit'
};
const primaryButton: React.CSSProperties = { ...buttonBase, background: C.primary, border: `1px solid ${C.primary}`, color: '#FFFFFF' };
const secondaryButton: React.CSSProperties = { ...buttonBase, background: 'transparent', border: '1px solid #475569', color: C.text };
const disabledButton: React.CSSProperties = { ...buttonBase, background: C.field, border: '1px dashed #475569', color: '#CBD5E1', cursor: 'not-allowed' };
const smallButton: React.CSSProperties = { ...secondaryButton, padding: '4px 10px', fontSize: '12px' };

const PLATFORM_OPTIONS: { value: AiPlatform; label: string }[] = [
  { value: 'meta', label: 'Meta ads (Facebook, Instagram)' },
  { value: 'google', label: 'Google ads' },
  { value: 'tiktok', label: 'TikTok ads' },
  { value: 'organic', label: 'Organic posts (no paid ads)' }
];

const PAGE_TITLES: Record<AiPageRole, string> = {
  landing: 'Landing page',
  'landing-b': 'Version B landing page',
  upsell: 'Upsell page',
  thanks: 'Thank-you page'
};

const EMAIL_TITLES: Record<AiEmailRole, string> = {
  followup: 'Follow-up emails',
  recovery: 'Checkout recovery emails'
};

/**
 * Whether a person can see and reach an element. Chrome still gives a rect to a field inside a
 * closed <details>, so the closed panel is checked by hand (its own <summary> stays reachable).
 */
function isShown(el: HTMLElement): boolean {
  const closed = el.closest('details:not([open])');
  if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) return false;
  return el.getClientRects().length > 0;
}

const DEFAULT_CHOICES: Required<WalkChoices> = { variant: 'a', checkout: 'paid', upsell: 'accepted', form: 'submitted' };

function draftStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const sameBrief = (a: JourneyAiBrief, b: JourneyAiBrief) => JSON.stringify(a) === JSON.stringify(b);

/** A field where Backspace edits text. React Flow already ignores keys typed into one. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** The <details> a field key lives in, or null for the fields above the steps. */
function stepKeyOf(field: string): string | null {
  const [head, role] = field.split('.');
  if (head === 'ad' || head === 'form') return head;
  if (head === 'pages') return `page-${role}`;
  if (head === 'emails') return `emails-${role}`;
  return null;
}

/** A plain wait box that lets the field be empty while typing, which a number in state cannot. */
function WaitInput({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) && value >= 0 ? String(value) : '');
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={0}
      max={168}
      step={1}
      value={text}
      onChange={e => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? Number.NaN : Number(e.target.value));
      }}
      style={{ ...inputStyle, maxWidth: '160px' }}
    />
  );
}

export const AiJourneyBuilder: React.FC<AiJourneyBuilderProps> = ({
  signedIn,
  businessType,
  workspaceId,
  onOpenAuth,
  onOpenBlueprints,
  onCreate,
  onClose,
  createMode = 'replace'
}) => {
  const initialBrief = useMemo<JourneyAiBrief>(() => ({ ...DEFAULT_BRIEF, businessType: (businessType || '').slice(0, BRIEF_LIMITS.businessType) }), [businessType]);
  const [saved] = useState(() => readSavedAiDraft(draftStorage()));
  const [brief, setBrief] = useState<JourneyAiBrief>(saved?.editedBrief ?? saved?.brief ?? initialBrief);
  // The brief the current plan was drafted for. The review reads this one, so editing the brief
  // screen after going back never changes what the plan is checked against.
  const [planBrief, setPlanBrief] = useState<JourneyAiBrief | null>(saved?.plan ? saved.brief : null);
  const [plan, setPlan] = useState<JourneyAiPlan | null>(saved?.plan ?? null);
  const [screen, setScreen] = useState<'brief' | 'review'>(saved?.plan ? 'review' : 'brief');
  const [busy, setBusy] = useState(false);
  // retryAt: when the hourly limit's wait ends. Until then there is no Retry, since it cannot help.
  const [refusal, setRefusal] = useState<{ message: string; retryable: boolean; unavailable: boolean; retryAt?: number } | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [choices, setChoices] = useState<Required<WalkChoices>>(DEFAULT_CHOICES);
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set(['ad']));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const pendingFocus = useRef<string | null>(null);

  const panelRef = useDialogFocus<HTMLDivElement>(true, onClose, { modal: true });

  // Declared after the hook on purpose: cleanups run in order, so when the hook found nothing to
  // return focus to (the More menu item that opened this is gone), the More button gets it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      const active = document.activeElement;
      if (!active || active === document.body || !(active as HTMLElement).isConnected) {
        document.querySelector<HTMLElement>('[data-more-trigger]')?.focus({ preventScroll: true });
      }
    };
  }, []);

  // Backspace and Delete from outside the panel (focus on the page after a click on the backdrop)
  // would reach React Flow's document listener and delete the selected step behind the dialog.
  // Capture runs before it. A field in a dialog above this one still gets its keys.
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const panel = panelRef.current;
      if (!panel || (e.target instanceof Node && panel.contains(e.target)) || isEditable(e.target)) return;
      e.stopPropagation();
    };
    document.addEventListener('keydown', guard, true);
    return () => document.removeEventListener('keydown', guard, true);
  }, [panelRef]);

  // Offer Retry once the hourly limit's wait has passed. Focus stays where it is.
  useEffect(() => {
    const at = refusal?.retryAt;
    if (at === undefined) return;
    const timer = setTimeout(() => {
      setRefusal(r => (r && r.retryAt === at ? { message: LIMIT_WAITED_MESSAGE, retryable: true, unavailable: false } : r));
    }, Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
  }, [refusal?.retryAt]);

  // Keep the draft after each change. A fresh, untouched brief with no plan is not worth keeping.
  // Brief edits made after going back from a plan are kept beside it, not in place of it.
  useEffect(() => {
    const store = draftStorage();
    if (plan && planBrief) writeSavedAiDraft(store, sameBrief(brief, planBrief) ? { brief: planBrief, plan } : { brief: planBrief, plan, editedBrief: brief });
    else if (sameBrief(brief, initialBrief)) writeSavedAiDraft(store, null);
    else writeSavedAiDraft(store, { brief, plan: null });
  }, [brief, plan, planBrief, initialBrief]);

  // Focus requests that need the next render (a screen change, a details panel opening).
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    // Chrome refuses focus inside a <details> opened in the same task, so wait one frame.
    // Not cancelled by the next render: a render in between must not drop the request.
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      const el = document.getElementById(id);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView?.({ block: 'center' });
    });
  });

  /** True when focus is not on something the person can still act on inside the panel. */
  const focusLost = () => {
    const active = document.activeElement;
    const panel = panelRef.current;
    return !active || !panel || !panel.contains(active) || active.id === STATUS_ID || !!active.closest(`#${REFUSAL_ID}`);
  };

  const problems = useMemo(() => (plan && planBrief ? planProblems(plan, planBrief) : []), [plan, planBrief]);
  const claims = useMemo(() => (plan && planBrief ? claimFlags(plan, planBrief) : []), [plan, planBrief]);
  const walk = useMemo(() => {
    if (!plan || !planBrief) return [];
    try {
      return simulateAiJourney(plan, planBrief, choices);
    } catch {
      return [];
    }
  }, [plan, planBrief, choices]);
  const blocker = plan && planBrief ? createBlocker(plan, planBrief, reviewed) : 'Draft a plan first.';

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(TRAP_SELECTOR)).filter(isShown);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, index, e.shiftKey);
    if (next === null) {
      if (items.length === 0) e.preventDefault();
      return;
    }
    e.preventDefault();
    items[next].focus();
  };

  const updateBrief = (patch: Partial<JourneyAiBrief>) => {
    setBriefError(null);
    setBrief(b => {
      const next = { ...b, ...patch };
      if (next.goal !== 'sales') next.upsell = false;
      return next;
    });
  };

  const updatePlan = (change: (p: JourneyAiPlan) => JourneyAiPlan) => {
    setPlan(p => (p ? change(p) : p));
    setReviewed(false);
    setCreateError(null);
  };

  const draft = async () => {
    if (!signedIn || busy) return;
    if (!brief.offer.trim()) {
      setBriefError('Say what you are promoting before you draft.');
      document.getElementById('ai-brief-offer')?.focus();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const asked = { ...brief, offer: brief.offer.trim(), audience: brief.audience.trim(), businessType: brief.businessType.trim() };
    // Retry sits inside the refusal, which unmounts now. Its focus goes to the status line.
    if (focusLost()) pendingFocus.current = STATUS_ID;
    setBusy(true);
    setRefusal(null);
    const answer = await requestJourneyPlan(asked, controller.signal);
    if (controller.signal.aborted || !mountedRef.current) return;
    setBusy(false);
    const outcome = aiPlanOutcome(answer, asked);
    if (outcome.kind === 'plan') {
      setPlanBrief(asked);
      setPlan(outcome.plan);
      setReviewed(false);
      setChoices(DEFAULT_CHOICES);
      setOpenSteps(new Set(['ad']));
      setCreateError(null);
      setScreen('review');
      pendingFocus.current = REVIEW_HEADING_ID;
    } else {
      setRefusal({
        message: outcome.message,
        retryable: outcome.retryable,
        unavailable: outcome.unavailable,
        ...(outcome.retryAfterMs !== undefined ? { retryAt: Date.now() + outcome.retryAfterMs } : {})
      });
      // The status line is going away. Draft keeps its focus; anything else moves to the refusal.
      if (focusLost()) pendingFocus.current = outcome.retryable ? RETRY_ID : REFUSAL_ID;
    }
  };

  const goTo = (field: string) => {
    const step = stepKeyOf(field);
    if (step) setOpenSteps(s => new Set(s).add(step));
    const id = field.startsWith('assumptions') ? 'ai-assumptions' : fieldInputId(field);
    const el = document.getElementById(id);
    if (el && isShown(el)) {
      el.focus();
      el.scrollIntoView?.({ block: 'center' });
    } else {
      pendingFocus.current = id;
    }
  };

  const backToBrief = () => {
    setScreen('brief');
    pendingFocus.current = brief.goal === 'sales' ? 'ai-brief-goal-sales' : 'ai-brief-goal-leads';
  };

  const backToReview = () => {
    setScreen('review');
    pendingFocus.current = REVIEW_HEADING_ID;
  };

  const startOver = () => {
    abortRef.current?.abort();
    setBusy(false);
    setPlan(null);
    setPlanBrief(null);
    setBrief(initialBrief);
    setReviewed(false);
    setRefusal(null);
    setCreateError(null);
    setScreen('brief');
    writeSavedAiDraft(draftStorage(), null);
    pendingFocus.current = 'ai-brief-goal-leads';
  };

  const create = async () => {
    if (!plan || !planBrief || blocker || creating) return;
    setCreating(true);
    setCreateError(null);
    const journey = buildJourneyFromPlan(plan, planBrief, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      now: new Date().toISOString(),
      workspaceId
    });
    let problem: string | null;
    try {
      problem = await onCreate(journey);
    } catch {
      problem = 'Nothing was created because something went wrong. Try again.';
    }
    if (!mountedRef.current) return;
    setCreating(false);
    if (problem) {
      setCreateError(problem);
      return;
    }
    writeSavedAiDraft(draftStorage(), null);
    onClose();
  };

  // ---- Field helpers for the review screen ----

  const textField = (field: string, label: string, value: string, set: (v: string) => void, opts: { multiline?: boolean; rows?: number; help?: string; start?: boolean } = {}) => {
    const id = fieldInputId(field);
    const helpId = opts.help ? `${id}-help` : undefined;
    return (
      <div style={fieldWrap} key={field}>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        {opts.multiline ? (
          <textarea id={id} rows={opts.rows || 3} value={value} onChange={e => set(e.target.value)} style={textareaStyle} aria-describedby={helpId} />
        ) : (
          <input id={id} type="text" value={value} onChange={e => set(e.target.value)} style={inputStyle} aria-describedby={helpId} data-dialog-start={opts.start ? '' : undefined} />
        )}
        {opts.help && <p id={helpId} style={helpStyle}>{opts.help}</p>}
      </div>
    );
  };

  const setPage = (role: AiPageRole, patch: Partial<JourneyAiPlan['pages'][number]>) =>
    updatePlan(p => ({ ...p, pages: p.pages.map(pg => (pg.role === role ? { ...pg, ...patch } : pg)) }));

  const setEmail = (role: AiEmailRole, change: (e: JourneyAiPlan['emails'][number]) => JourneyAiPlan['emails'][number]) =>
    updatePlan(p => ({ ...p, emails: p.emails.map(e => (e.role === role ? change(e) : e)) }));

  const setMessage = (role: AiEmailRole, index: number, patch: Partial<JourneyAiPlan['emails'][number]['messages'][number]>) =>
    setEmail(role, e => ({ ...e, messages: e.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));

  const step = (key: string, title: string, reason: string, children: React.ReactNode) => (
    <details
      key={key}
      open={openSteps.has(key)}
      onToggle={e => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        setOpenSteps(s => {
          if (s.has(key) === isOpen) return s;
          const next = new Set(s);
          if (isOpen) next.add(key);
          else next.delete(key);
          return next;
        });
      }}
      style={{ border: `1px solid ${C.border}`, borderRadius: '10px', marginBottom: '10px', background: '#111C33' }}
    >
      <summary style={{ cursor: 'pointer', padding: '10px 12px', fontSize: '14px', fontWeight: 700, color: C.text }}>{title}</summary>
      <div style={{ padding: '0 12px 4px' }}>
        {reason.trim() && <p style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>Why this step: {reason}</p>}
        {children}
      </div>
    </details>
  );

  const goToButton = (field: string) => (
    <button type="button" onClick={() => goTo(field)} style={smallButton}>Go to field</button>
  );

  // ---- Screens ----

  const briefScreen = (
    <div>
      <p style={{ fontSize: '13px', color: C.text, lineHeight: 1.5, marginBottom: '14px' }}>
        Describe what you are promoting. The AI drafts the copy for an ad, the pages and the emails. You check every word before anything goes on your canvas.
      </p>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
        <legend style={labelStyle}>Goal</legend>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {([['leads', 'Collect leads'], ['sales', 'Sell a product']] as const).map(([value, label]) => (
            <span key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <input
                id={`ai-brief-goal-${value}`}
                type="radio"
                name="ai-brief-goal"
                value={value}
                checked={brief.goal === value}
                onChange={() => updateBrief({ goal: value })}
                data-dialog-start={brief.goal === value && screen === 'brief' ? '' : undefined}
              />
              <label htmlFor={`ai-brief-goal-${value}`} style={{ fontSize: '13px', color: C.text }}>{label}</label>
            </span>
          ))}
        </div>
      </fieldset>

      <div style={fieldWrap}>
        <label htmlFor="ai-brief-offer" style={labelStyle}>What are you promoting?</label>
        <textarea
          id="ai-brief-offer"
          rows={4}
          maxLength={BRIEF_LIMITS.offer}
          value={brief.offer}
          onChange={e => updateBrief({ offer: e.target.value })}
          aria-describedby="ai-brief-offer-help"
          aria-invalid={briefError ? true : undefined}
          style={textareaStyle}
        />
        <p id="ai-brief-offer-help" style={helpStyle}>
          Include the facts the copy may use, such as price, what is included and who it is for. The AI uses only what you write here.
        </p>
        {briefError && <p role="alert" style={{ ...helpStyle, color: C.red }}>{briefError}</p>}
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ ...fieldWrap, flex: '1 1 240px' }}>
          <label htmlFor="ai-brief-audience" style={labelStyle}>Who is it for?</label>
          <input id="ai-brief-audience" type="text" maxLength={BRIEF_LIMITS.audience} value={brief.audience} onChange={e => updateBrief({ audience: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ ...fieldWrap, flex: '1 1 200px' }}>
          <label htmlFor="ai-brief-business" style={labelStyle}>Business type</label>
          <input id="ai-brief-business" type="text" maxLength={BRIEF_LIMITS.businessType} value={brief.businessType} onChange={e => updateBrief({ businessType: e.target.value })} style={inputStyle} />
        </div>
      </div>

      <div style={fieldWrap}>
        <label htmlFor="ai-brief-platform" style={labelStyle}>Where does the traffic come from?</label>
        <select id="ai-brief-platform" value={brief.platform} onChange={e => updateBrief({ platform: e.target.value as AiPlatform })} style={{ ...inputStyle, maxWidth: '360px' }}>
          {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <input id="ai-brief-ab" type="checkbox" checked={brief.abTest} onChange={e => updateBrief({ abTest: e.target.checked })} />
          <label htmlFor="ai-brief-ab" style={{ fontSize: '13px', color: C.text }}>Test two versions of the landing page</label>
        </span>
        {brief.goal === 'sales' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <input id="ai-brief-upsell" type="checkbox" checked={brief.upsell} onChange={e => updateBrief({ upsell: e.target.checked })} />
            <label htmlFor="ai-brief-upsell" style={{ fontSize: '13px', color: C.text }}>Add an upsell offer after checkout</label>
          </span>
        )}
      </div>

      {plan && <p style={{ ...helpStyle, color: C.amber, marginBottom: '10px' }}>Drafting again replaces the plan you edited.</p>}

      {busy && (
        <p id={STATUS_ID} role="status" tabIndex={-1} style={{ fontSize: '13px', color: C.text, marginBottom: '10px' }}>Drafting your journey. This can take up to a minute.</p>
      )}

      {refusal && !busy && (
        <div id={REFUSAL_ID} role="alert" tabIndex={-1} style={{ background: C.redBg, border: '1px solid #7F1D1D', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
          <p style={{ fontSize: '13px', color: C.red, lineHeight: 1.45, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
            <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{refusal.message}</span>
          </p>
          {(refusal.retryable || refusal.unavailable) && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              {refusal.retryable && <button id={RETRY_ID} type="button" onClick={draft} style={smallButton}>Retry</button>}
              {refusal.unavailable && <button type="button" onClick={onOpenBlueprints} style={smallButton}>Open Blueprints</button>}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {signedIn ? (
          <button type="button" onClick={draft} aria-disabled={busy} style={busy ? disabledButton : primaryButton}>
            <WandSparkles size={14} aria-hidden="true" />
            {busy ? 'Drafting…' : 'Draft my journey'}
          </button>
        ) : (
          <button type="button" onClick={onOpenAuth} style={primaryButton}>Sign in to draft with AI</button>
        )}
        {plan && <button type="button" onClick={backToReview} style={secondaryButton}>Back to review</button>}
        <button type="button" onClick={close} style={secondaryButton}>Cancel</button>
      </div>
      {signedIn && <p style={{ ...helpStyle, marginTop: '10px' }}>Each draft counts toward your hourly AI limit.</p>}
    </div>
  );

  const reviewScreen = plan && planBrief && (() => {
    const sales = planBrief.goal === 'sales';
    const pages = plan.pages;
    const pageFields = (pg: JourneyAiPlan['pages'][number]) => {
      const k = `pages.${pg.role}`;
      const thanks = pg.role === 'thanks';
      return (
        <>
          {textField(`${k}.title`, 'Step name on your canvas', pg.title, v => setPage(pg.role, { title: v }))}
          {textField(`${k}.headline`, 'Headline', pg.headline, v => setPage(pg.role, { headline: v }))}
          {textField(`${k}.subhead`, 'Subhead', pg.subhead, v => setPage(pg.role, { subhead: v }), { multiline: true, rows: 3 })}
          {!thanks && textField(`${k}.bullets`, 'Bullet points', pg.bullets.join('\n'), v => setPage(pg.role, { bullets: v.split('\n') }), { multiline: true, rows: 4, help: 'One per line.' })}
          {!thanks && textField(`${k}.button`, pg.role === 'upsell' ? 'Accept button' : 'Button', pg.button, v => setPage(pg.role, { button: v }))}
          {pg.role === 'upsell' && textField(`${k}.decline`, 'Decline link', pg.decline, v => setPage(pg.role, { decline: v }))}
        </>
      );
    };
    const pageStep = (role: AiPageRole) => {
      const pg = pages.find(p => p.role === role);
      return pg ? step(`page-${role}`, PAGE_TITLES[role], pg.reason, pageFields(pg)) : null;
    };
    const emailStep = (role: AiEmailRole) => {
      const flow = plan.emails.find(e => e.role === role);
      if (!flow) return null;
      const k = `emails.${role}`;
      return step(`emails-${role}`, EMAIL_TITLES[role], flow.reason, (
        <>
          {textField(`${k}.name`, 'Flow name', flow.name, v => setEmail(role, e => ({ ...e, name: v })))}
          {flow.messages.map((m, i) => (
            <fieldset key={i} style={{ border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px 2px', margin: '0 0 12px', minWidth: 0 }}>
              <legend style={{ ...labelStyle, padding: '0 4px', marginBottom: 0 }}>Email {i + 1}</legend>
              {textField(`${k}.${i}.subject`, 'Subject', m.subject, v => setMessage(role, i, { subject: v }))}
              {textField(`${k}.${i}.preview`, 'Preview text', m.preview, v => setMessage(role, i, { preview: v }))}
              {textField(`${k}.${i}.body`, 'Body', m.body, v => setMessage(role, i, { body: v }), { multiline: true, rows: 6 })}
              <div style={fieldWrap}>
                <label htmlFor={fieldInputId(`${k}.${i}.delayHours`)} style={labelStyle}>
                  {i === 0 ? 'Wait after joining (hours)' : 'Wait since the previous email (hours)'}
                </label>
                <WaitInput id={fieldInputId(`${k}.${i}.delayHours`)} value={m.delayHours} onChange={n => setMessage(role, i, { delayHours: n })} />
              </div>
            </fieldset>
          ))}
        </>
      ));
    };
    const warning = createMode === 'add'
      ? 'Create adds this draft as a new journey. Your current journey stays as it is.'
      : signedIn
        ? 'Create replaces the journey on your canvas. Your current journey is saved to your account first.'
        : 'Create replaces the journey on your canvas. You are signed out, so your current journey is not kept anywhere else.';

    return (
      <div>
        <h3 id={REVIEW_HEADING_ID} tabIndex={-1} style={{ fontSize: '15px', fontWeight: 700, color: C.text, marginBottom: '8px' }}>Review your draft</h3>
        {plan.strategy.trim() && <p style={{ fontSize: '13px', color: C.text, lineHeight: 1.5, marginBottom: '8px' }}>{plan.strategy}</p>}
        <p style={{ fontSize: '13px', color: C.text, marginBottom: '8px' }}>
          Nothing is published or sent. {createMode === 'add' ? 'Create adds this draft to your journeys.' : 'Create puts this draft on your canvas.'}
        </p>
        {sales && (
          <p style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>
            Link a product to the landing page before you publish. Prices come from your store, not from this draft.
          </p>
        )}

        {plan.assumptions.some(a => a.trim()) && (
          <section aria-labelledby="ai-assumptions-heading" style={{ background: C.amberBg, border: '1px solid #78591A', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
            <h4 id="ai-assumptions-heading" style={{ fontSize: '13px', fontWeight: 700, color: C.amber, marginBottom: '6px' }}>Assumptions to check</h4>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: C.amber, lineHeight: 1.5 }}>
              {plan.assumptions.filter(a => a.trim()).map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </section>
        )}

        {claims.length > 0 && (
          <section aria-labelledby="ai-claims-heading" style={{ background: C.violetBg, border: '1px solid #4C1D95', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
            <h4 id="ai-claims-heading" style={{ fontSize: '13px', fontWeight: 700, color: C.violet, marginBottom: '4px' }}>Claims to check</h4>
            <p style={{ ...helpStyle, marginTop: 0, marginBottom: '6px' }}>These figures and promises are not in your brief. Keep one only if it is true for your business.</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {claims.map((c, i) => (
                <li key={`${c.field}-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: C.text, padding: '4px 0' }}>
                  <span style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}>“{c.text}” in {c.label} is not in your brief.</span>
                  {goToButton(c.field)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {problems.length > 0 && (
          <section role="alert" aria-labelledby="ai-problems-heading" style={{ background: C.redBg, border: '1px solid #7F1D1D', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
            <h4 id="ai-problems-heading" style={{ fontSize: '13px', fontWeight: 700, color: C.red, marginBottom: '6px' }}>Fix before you create</h4>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {problems.map((p, i) => (
                <li key={`${p.field}-${i}`} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: C.red, padding: '4px 0' }}>
                  <span style={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}>{p.message}</span>
                  {goToButton(p.field)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div style={{ marginTop: '14px' }}>
          {textField('name', 'Journey name', plan.name, v => updatePlan(p => ({ ...p, name: v })), { start: true })}
          {planBrief.abTest && textField('hypothesis', 'What the A/B test checks', plan.hypothesis, v => updatePlan(p => ({ ...p, hypothesis: v })), { multiline: true, rows: 2 })}
          <div style={fieldWrap}>
            <label htmlFor="ai-assumptions" style={labelStyle}>Assumptions</label>
            <textarea
              id="ai-assumptions"
              rows={3}
              value={plan.assumptions.join('\n')}
              onChange={e => updatePlan(p => ({ ...p, assumptions: e.target.value.split('\n') }))}
              aria-describedby="ai-assumptions-help"
              style={textareaStyle}
            />
            <p id="ai-assumptions-help" style={helpStyle}>One per line. These are only notes for you. They never appear on a page.</p>
          </div>

          {step('ad', 'Ad', plan.ad.reason, (
            <>
              {textField('ad.headline', 'Headline', plan.ad.headline, v => updatePlan(p => ({ ...p, ad: { ...p.ad, headline: v } })))}
              {textField('ad.body', 'Body', plan.ad.body, v => updatePlan(p => ({ ...p, ad: { ...p.ad, body: v } })), { multiline: true, rows: 3 })}
              {textField('ad.cta', 'Button', plan.ad.cta, v => updatePlan(p => ({ ...p, ad: { ...p.ad, cta: v } })))}
            </>
          ))}
          {pageStep('landing')}
          {pageStep('landing-b')}
          {plan.form && step('form', 'Sign-up form', plan.form.reason, (
            <>
              {textField('form.title', 'Form title', plan.form.title, v => updatePlan(p => ({ ...p, form: p.form && { ...p.form, title: v } })))}
              {textField('form.button', 'Button', plan.form.button, v => updatePlan(p => ({ ...p, form: p.form && { ...p.form, button: v } })))}
              {textField('form.success', 'Message after sign-up', plan.form.success, v => updatePlan(p => ({ ...p, form: p.form && { ...p.form, success: v } })), { multiline: true, rows: 2 })}
            </>
          ))}
          {pageStep('upsell')}
          {pageStep('thanks')}
          {emailStep('followup')}
          {emailStep('recovery')}
        </div>

        <section aria-labelledby="ai-walk-heading" style={{ border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px', margin: '14px 0' }}>
          <h4 id="ai-walk-heading" style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '2px' }}>Walk a customer through it</h4>
          <p style={{ ...helpStyle, marginTop: 0, marginBottom: '10px' }}>Simulated. Nothing is sent, charged or recorded.</p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {planBrief.abTest && (
              <div style={{ minWidth: 0 }}>
                <label htmlFor="ai-walk-variant" style={labelStyle}>Version</label>
                <select id="ai-walk-variant" value={choices.variant} onChange={e => setChoices(c => ({ ...c, variant: e.target.value as 'a' | 'b' }))} style={inputStyle}>
                  <option value="a">A</option>
                  <option value="b">B</option>
                </select>
              </div>
            )}
            {sales && (
              <div style={{ minWidth: 0 }}>
                <label htmlFor="ai-walk-checkout" style={labelStyle}>Checkout</label>
                <select id="ai-walk-checkout" value={choices.checkout} onChange={e => setChoices(c => ({ ...c, checkout: e.target.value as 'paid' | 'left' }))} style={inputStyle}>
                  <option value="paid">Pays</option>
                  <option value="left">Leaves without paying</option>
                </select>
              </div>
            )}
            {sales && planBrief.upsell && (
              <div style={{ minWidth: 0 }}>
                <label htmlFor="ai-walk-upsell" style={labelStyle}>Upsell</label>
                <select id="ai-walk-upsell" value={choices.upsell} onChange={e => setChoices(c => ({ ...c, upsell: e.target.value as 'accepted' | 'declined' }))} style={inputStyle}>
                  <option value="accepted">Accepts</option>
                  <option value="declined">Declines</option>
                </select>
              </div>
            )}
            {!sales && (
              <div style={{ minWidth: 0 }}>
                <label htmlFor="ai-walk-form" style={labelStyle}>Form</label>
                <select id="ai-walk-form" value={choices.form} onChange={e => setChoices(c => ({ ...c, form: e.target.value as 'submitted' | 'left' }))} style={inputStyle}>
                  <option value="submitted">Fills it in</option>
                  <option value="left">Leaves</option>
                </select>
              </div>
            )}
          </div>
          <ol aria-label="Simulated path" style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: C.text, lineHeight: 1.5 }}>
            {walk.map(row => (
              <li key={row.key} style={{ marginBottom: '6px', overflowWrap: 'anywhere' }}>
                <span style={{ fontWeight: 700 }}>{row.title}.</span> {row.detail}
              </li>
            ))}
          </ol>
        </section>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '10px' }}>
          <input id="ai-reviewed" type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} style={{ marginTop: '3px' }} />
          <label htmlFor="ai-reviewed" style={{ fontSize: '13px', color: C.text, lineHeight: 1.45 }}>I read every page and email, and each claim is true for my business.</label>
        </div>
        <p style={{ fontSize: '13px', color: C.amber, lineHeight: 1.45, marginBottom: '10px', display: 'flex', gap: '6px' }}>
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>{warning}</span>
        </p>
        {createError && (
          <p role="alert" style={{ fontSize: '13px', color: C.red, background: C.redBg, border: '1px solid #7F1D1D', borderRadius: '8px', padding: '8px 10px', marginBottom: '10px' }}>{createError}</p>
        )}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={create}
            aria-disabled={!!blocker || creating}
            aria-describedby={blocker ? 'ai-create-blocker' : undefined}
            style={blocker || creating ? disabledButton : primaryButton}
          >
            <CheckCircle2 size={14} aria-hidden="true" />
            {creating ? 'Creating…' : 'Create journey'}
          </button>
          {blocker && <span id="ai-create-blocker" style={{ fontSize: '13px', color: '#CBD5E1' }}>{blocker}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          <button type="button" onClick={backToBrief} style={secondaryButton}>Back to brief</button>
          <button type="button" onClick={startOver} style={secondaryButton}>Start over</button>
        </div>
      </div>
    );
  })();

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(2, 6, 23, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', boxSizing: 'border-box' }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="jv-ai-builder"
        onKeyDown={onKeyDown}
        tabIndex={-1}
        style={{
          background: C.panel,
          color: C.text,
          border: `1px solid ${C.border}`,
          borderRadius: '14px',
          width: 'min(960px, calc(100vw - 32px))',
          maxHeight: '92vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '18px 20px',
          boxSizing: 'border-box',
          textAlign: 'left',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <WandSparkles size={18} color={C.violet} aria-hidden="true" />
          <h2 id={TITLE_ID} style={{ fontSize: '17px', fontWeight: 700, color: '#F8FAFC', flex: 1, minWidth: 0 }}>Draft a journey with AI</h2>
          <button type="button" onClick={close} aria-label="Close" style={{ ...smallButton, padding: '6px' }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {screen === 'review' && reviewScreen ? reviewScreen : briefScreen}
      </div>
    </div>
  );
};

export default AiJourneyBuilder;
