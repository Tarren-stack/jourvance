import type { MailBlock } from '../components/campaign/EmailBlocks';
import type { ServerAnswer } from './saveOutcome';

// Drafting one email with AI in Email Studio (ASK_JOURVANCE_PLAN.md, Wave 3, W3.B): the request the
// composer sends to POST /api/ai/email-draft, the one reading of its answer, how a kept draft lands
// in the email, and the drafting session the control runs (createDraftSession). A draft is a
// proposal until the person keeps it, and keeping it never replaces a block they wrote: the subject
// is filled, the preview text only when the draft has one, and the paragraphs are APPENDED as far
// as the email's block cap allows.
// Pure, with type-only imports, so the node tests load it without a bundler.

export type DraftKind = 'broadcast' | 'flow-step';
export type DraftGrounding = 'account' | 'app';

export interface EmailDraft {
  subject: string;
  previewText: string;
  paragraphs: string[];
  cta?: { label: string };
}

/** The same caps as DRAFT_LIMITS in server/routes/aiEmailRoutes.mjs; ai-email-draft-route.test.mjs pins them equal. */
export const DRAFT_LIMITS = {
  brief: 300,
  subjectHint: 120,
  subject: 120,
  previewText: 140,
  paragraphs: 6,
  paragraph: 400,
  ctaLabel: 40
} as const;

/**
 * The most top-level blocks an email keeps: cleanBlockList in email-doc.mjs keeps 24, and the
 * broadcast draft store refuses more (broadcastDraftRoutes.mjs draftWouldClip). email-draft.test.mjs
 * pins this against both. The preview text cap (140) is pinned the same way, against the broadcast
 * store and cleanFlow.
 */
export const EMAIL_BLOCK_CAP = 24;

/** The server's own sentence for a brief that is empty or too long, said before anything is sent. */
export const BRIEF_PROBLEM = 'Describe the email in up to 300 characters.';
export const DRAFT_UNREACHABLE = 'Nothing was drafted, because the server did not answer. Check your connection and try again.';
export const DRAFT_SIGNED_OUT = 'Sign in to draft an email with AI. Nothing was drafted.';
export const DRAFT_UNREADABLE = 'The AI service answered in a shape this app cannot read. Try again.';
/** A 429 that names no wait is the Security Sentinel's per-address limit, not the hourly AI limit. */
export const DRAFT_TOO_MANY = 'Too many requests from this connection. Wait a minute and try again.';
export const DRAFT_BUSY = 'Writing a draft. It can take up to a minute.';
export const DRAFT_DISCARDED = 'Discarded the draft. Nothing in the email changed.';
export const DRAFT_STOPPED = 'Stopped. Nothing was drafted.';

// 'account' means only that the hub accepted the account scope, not that it found a profile (an
// empty corpus is skipped without a word), so each line says no more than is known.
export const GROUNDING_ACCOUNT = 'Uses your business profile, when the AI has it.';
export const GROUNDING_GENERAL = 'Uses general guidance, not your profile.';

/** The one line under a proposal that says what the AI wrote from. */
export function groundingLine(grounding: unknown): string {
  return grounding === 'account' ? GROUNDING_ACCOUNT : GROUNDING_GENERAL;
}

/**
 * "12 of 300 characters", counted on the brief as it will be sent (trimmed). Over the limit it says
 * so in words too, so the count never differs by colour alone.
 */
export function briefCount(brief: string): string {
  const n = brief.trim().length;
  return `${n} of ${DRAFT_LIMITS.brief} characters${n > DRAFT_LIMITS.brief ? '. Too long.' : ''}`;
}

/** '' when the brief can be sent, otherwise the sentence that says why not. */
export function briefProblem(brief: string): string {
  const n = brief.trim().length;
  return n === 0 || n > DRAFT_LIMITS.brief ? BRIEF_PROBLEM : '';
}

export interface EmailDraftRequest {
  kind: DraftKind;
  brief: string;
  subjectHint?: string;
  flowTrigger?: string;
}

/**
 * The route's body. The subject the person already wrote rides along as a hint when it fits the
 * hint's cap (a longer one is left out rather than refusing the draft), and the flow's trigger only
 * for a flow step.
 */
export function emailDraftBody(input: { kind: DraftKind; brief: string; subject?: string; trigger?: string }): EmailDraftRequest {
  const hint = (input.subject || '').trim();
  const trigger = (input.trigger || '').trim();
  return {
    kind: input.kind,
    brief: input.brief.trim(),
    ...(hint && hint.length <= DRAFT_LIMITS.subjectHint ? { subjectHint: hint } : {}),
    ...(input.kind === 'flow-step' && trigger ? { flowTrigger: trigger } : {})
  };
}

export type DraftOutcome =
  | { ok: true; draft: EmailDraft; grounding: DraftGrounding | null }
  | { ok: false; error: string; retryable: boolean; retryAfterSeconds?: number };

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The draft in an answer body, checked again on this side, or null when it is not one. */
export function readDraft(value: unknown): EmailDraft | null {
  if (!isObject(value) || !nonEmpty(value.subject) || !Array.isArray(value.paragraphs)) return null;
  const paragraphs = value.paragraphs.filter(nonEmpty).map((p: string) => p.trim()).slice(0, DRAFT_LIMITS.paragraphs);
  if (paragraphs.length === 0) return null;
  const label = isObject(value.cta) && nonEmpty(value.cta.label) ? value.cta.label.trim().slice(0, DRAFT_LIMITS.ctaLabel) : '';
  return {
    subject: value.subject.trim().slice(0, DRAFT_LIMITS.subject),
    previewText: typeof value.previewText === 'string' ? value.previewText.trim().slice(0, DRAFT_LIMITS.previewText) : '',
    paragraphs: paragraphs.map((p: string) => p.slice(0, DRAFT_LIMITS.paragraph)),
    ...(label ? { cta: { label } } : {})
  };
}

/**
 * The one reading of a POST /api/ai/email-draft answer. Null is a request that never got an answer
 * (offline, aborted, past the timeout). A refusal says the server's own sentence; Retry is offered
 * only when it can help, and the hourly limit carries the wait the server named.
 */
export function readDraftOutcome(answer: ServerAnswer | null): DraftOutcome {
  if (!answer) return { ok: false, error: DRAFT_UNREACHABLE, retryable: true };
  if (answer.status === 401) return { ok: false, error: DRAFT_SIGNED_OUT, retryable: false };
  const body = isObject(answer.body) ? answer.body : {};
  // The hourly AI limit always names its wait. A 429 without one is the Sentinel's per-address limit,
  // which a Retry pressed now would only hit again.
  if (answer.status === 429 && !(Number(body.retryAfterSeconds) > 0)) return { ok: false, error: DRAFT_TOO_MANY, retryable: false };
  if (answer.status < 200 || answer.status >= 300 || body.success !== true) {
    const said = nonEmpty(body.error) && body.error.length < 300 ? body.error.trim() : `Nothing was drafted. The server answered with status ${answer.status}.`;
    const retryable = typeof body.retryable === 'boolean' ? body.retryable : answer.status === 408 || answer.status === 429 || answer.status >= 500;
    const wait = Number(body.retryAfterSeconds);
    return {
      ok: false,
      error: /[.!?]$/.test(said) ? said : `${said}.`,
      retryable,
      ...(answer.status === 429 && Number.isFinite(wait) && wait > 0 ? { retryAfterSeconds: Math.ceil(wait) } : {})
    };
  }
  // Only the hub brain writes a draft; anything else is not shown as one.
  const draft = body.source === 'hub-brain' ? readDraft(body.draft) : null;
  if (!draft) return { ok: false, error: DRAFT_UNREADABLE, retryable: true };
  return { ok: true, draft, grounding: body.grounding === 'account' || body.grounding === 'app' ? body.grounding : null };
}

/**
 * The editor's own block factory: the kinds it can make, and a new BLANK block of a kind with a
 * fresh id. A button block is added for the draft's button label only when 'button' is one of the
 * kinds, and it carries no link: the person adds that.
 */
export interface BlockFactory {
  kinds: readonly string[];
  make: (kind: 'text' | 'button') => MailBlock;
}

/** One text block per paragraph, then a button block for the button label when the editor has one. */
export function draftToBlocks(draft: EmailDraft, factory: BlockFactory): MailBlock[] {
  const blocks: MailBlock[] = draft.paragraphs.map((text) => ({ ...factory.make('text'), text }));
  if (draft.cta?.label && factory.kinds.includes('button')) blocks.push({ ...factory.make('button'), label: draft.cta.label });
  return blocks;
}

export interface DraftFit {
  /** The blocks that fit under EMAIL_BLOCK_CAP after the `existing` ones, paragraphs first. */
  blocks: MailBlock[];
  paragraphs: number;
  button: boolean;
  leftParagraphs: number;
  leftButton: boolean;
}

/** What of the draft fits in an email that already holds `existing` blocks: paragraphs first, then the button. */
export function draftFit(draft: EmailDraft, factory: BlockFactory, existing: number): DraftFit {
  const all = draftToBlocks(draft, factory);
  const room = Math.max(0, EMAIL_BLOCK_CAP - Math.max(0, existing));
  const blocks = all.slice(0, room);
  const paragraphs = blocks.filter((b) => b.kind === 'text').length;
  const button = blocks.some((b) => b.kind === 'button');
  const wantButton = all.some((b) => b.kind === 'button');
  return { blocks, paragraphs, button, leftParagraphs: draft.paragraphs.length - paragraphs, leftButton: wantButton && !button };
}

export interface DraftTarget {
  subject: string;
  previewText: string;
  blocks: MailBlock[];
}

/**
 * The email after Keep, in ONE new object: the draft's subject, its preview text when it has one (a
 * draft without one keeps the preview the person typed), and every block the email already held
 * followed by as many of the draft's as fit under EMAIL_BLOCK_CAP. Pass the CURRENT email so edits
 * typed while the draft was being written are kept.
 */
export function applyDraftToComposer<T extends DraftTarget>(state: T, draft: EmailDraft, factory: BlockFactory): T {
  return {
    ...state,
    subject: draft.subject,
    previewText: draft.previewText || state.previewText,
    blocks: [...state.blocks, ...draftFit(draft, factory, state.blocks.length).blocks]
  };
}

const paragraphsText = (n: number) => `${n} ${n === 1 ? 'paragraph' : 'paragraphs'}`;

/**
 * What Keep says it did, naming what changed and what is still the person's to do. `preview` is false
 * where the email has no preview text (an order email), and the preview is named only when the draft
 * carried one. `existingBlocks` is how many blocks the email held before Keep, so what did not fit
 * under the cap is said. `saveHint` is the editor's own next step.
 */
export function keptSentence(
  draft: EmailDraft,
  factory: BlockFactory,
  { preview = true, saveHint = '', existingBlocks = 0 }: { preview?: boolean; saveHint?: string; existingBlocks?: number } = {}
): string {
  const fit = draftFit(draft, factory, existingBlocks);
  const filled = preview && draft.previewText ? 'Filled in the subject and the preview text' : 'Filled in the subject';
  const parts = [fit.paragraphs > 0
    ? `${filled}, and added ${paragraphsText(fit.paragraphs)}${fit.button ? ' and a button' : ''} at the end of the email.`
    : `${filled}.`];
  const left = [fit.leftParagraphs > 0 ? paragraphsText(fit.leftParagraphs) : '', fit.leftButton ? 'the button' : ''].filter(Boolean).join(' and ');
  if (left) parts.push(`${left.charAt(0).toUpperCase()}${left.slice(1)} did not fit, because an email keeps at most ${EMAIL_BLOCK_CAP} blocks.`);
  if (fit.button) parts.push('Add the button\u2019s link before it goes out.');
  if (saveHint) parts.push(saveHint);
  return parts.join(' ');
}

// ---- The drafting session the control runs ----

export type DraftPhase =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'error'; error: string; retryable: boolean }
  | { state: 'proposal'; draft: EmailDraft; grounding: DraftGrounding | null };

export interface DraftSessionState {
  open: boolean;
  brief: string;
  phase: DraftPhase;
  /** The last thing said: a brief that cannot be sent, Stop, Discard or what Keep did. */
  notice: string;
}

export type DraftRequester = (body: EmailDraftRequest, signal: AbortSignal) => Promise<DraftOutcome>;

export interface DraftSession {
  readonly state: DraftSessionState;
  toggle(): void;
  setBrief(brief: string): void;
  write(context: { kind: DraftKind; subject?: string; trigger?: string }): Promise<void>;
  stop(): void;
  /** `apply` puts the draft into the email and answers the sentence that says what it did. */
  keep(apply: (draft: EmailDraft) => string): void;
  discard(): void;
  /** The control went away: whatever is in flight is aborted and its reply is dropped. */
  dispose(): void;
}

export const IDLE_DRAFT_SESSION: DraftSessionState = Object.freeze({ open: false, brief: '', phase: Object.freeze({ state: 'idle' }), notice: '' }) as DraftSessionState;

/**
 * One drafting session: the state the control renders, and the one rule that matters most here, that
 * a reply which lands after Stop, after the form closed or after the control went away is DROPPED
 * (each request takes a ticket, and anything that ends it moves the ticket on). `onChange` is called
 * with every new state. No React, so the node tests drive it with a request they control.
 */
export function createDraftSession(request: DraftRequester, onChange: (state: DraftSessionState) => void): DraftSession {
  let state: DraftSessionState = IDLE_DRAFT_SESSION;
  let ticket = 0;
  let controller: AbortController | null = null;
  const set = (patch: Partial<DraftSessionState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const cancel = () => {
    ticket++;
    controller?.abort();
    controller = null;
  };
  return {
    get state() {
      return state;
    },
    toggle() {
      if (state.open) {
        cancel();
        set({ open: false, phase: { state: 'idle' }, notice: '' });
      } else {
        set({ open: true, notice: '' });
      }
    },
    setBrief(brief) {
      // The refusal goes as soon as the brief can be sent again, not at the next Write.
      set({ brief, ...(state.notice === BRIEF_PROBLEM && !briefProblem(brief) ? { notice: '' } : {}) });
    },
    async write({ kind, subject, trigger }) {
      if (state.phase.state === 'busy') return;
      const problem = briefProblem(state.brief);
      if (problem) {
        set({ phase: { state: 'idle' }, notice: problem });
        return;
      }
      cancel();
      const mine = ticket;
      const signal = new AbortController();
      controller = signal;
      set({ phase: { state: 'busy' }, notice: '' });
      const outcome = await request(emailDraftBody({ kind, brief: state.brief, subject, trigger }), signal.signal);
      // The stale-reply guard: a reply to a request that was stopped, closed or replaced is dropped.
      if (mine !== ticket) return;
      controller = null;
      set({
        phase: outcome.ok
          ? { state: 'proposal', draft: outcome.draft, grounding: outcome.grounding }
          : { state: 'error', error: outcome.error, retryable: outcome.retryable }
      });
    },
    stop() {
      if (state.phase.state !== 'busy') return;
      cancel();
      set({ phase: { state: 'idle' }, notice: DRAFT_STOPPED });
    },
    keep(apply) {
      if (state.phase.state !== 'proposal') return;
      const said = apply(state.phase.draft);
      set({ open: false, phase: { state: 'idle' }, notice: said });
    },
    discard() {
      if (state.phase.state !== 'proposal') return;
      set({ phase: { state: 'idle' }, notice: DRAFT_DISCARDED });
    },
    dispose() {
      cancel();
    }
  };
}
