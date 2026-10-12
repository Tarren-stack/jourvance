// Ask Jourvance, the pure half: the limits (pinned equal to the server's by assistant-client.test.mjs),
// every string the panel shows, and the readers that turn a server answer into one honest state.
// Pure: only a type import, so `node --test` loads it directly. The fetches live in assistantClient.ts
// and the components in src/components/assistant/.

import type { ServerAnswer } from './saveOutcome';

/** The server's LIMITS (server/assistantContext.mjs), key for key. A test holds the two equal. */
export const ASSISTANT_LIMITS = {
  MESSAGE_MAX: 1000,
  NOTES_MAX: 2000,
  THREAD_KEEP: 40,
  HISTORY_TURNS: 8,
  ANSWER_MAX: 2000,
  FEEDBACK_PER_DAY: 20,
  PROFILE_SYNC_PER_DAY: 10,
  ASSISTANT_PER_HOUR: 40,
  PACK_MAX_CHARS: 6000,
  GUIDE_SLICE_MAX_CHARS: 6000
} as const;

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  grounding?: 'account' | 'app';
  rating?: 'up' | 'down';
  shared?: boolean;
}

/** Every string from docs/assistant/panel-copy.md, keyed by its table key. Copied, not reworded. */
export const PANEL_COPY = {
  'bubble.ariaLabel': 'Ask Jourvance',
  'bubble.tooltip': 'Ask Jourvance a question',
  'panel.title': 'Ask Jourvance',
  'panel.intro': 'Ask about your numbers, your emails, or how to do something in Jourvance.',
  'thread.empty': 'No questions yet. Ask one below.',
  'suggest.canvas.1': 'How many visits and leads did this journey get in the last 30 days?',
  'suggest.canvas.2': 'What should I work on next to get more leads from this journey?',
  'suggest.canvas.3': 'How do I publish this journey?',
  'suggest.email.1': 'How many emails have I sent, and what are my open and click rates?',
  'suggest.email.2': 'What should I send next to the people on my list?',
  'suggest.email.3': 'How do I build an email flow?',
  'suggest.attribution.1': 'Which journey brought in the most revenue in the last 30 days?',
  'suggest.attribution.2': 'Which journey should I put more effort into?',
  'suggest.attribution.3': 'What is the difference between last touch and first touch?',
  'suggest.public.1': 'How many leads did my journeys get in the last 30 days?',
  'suggest.public.2': 'What should I set up first to get my first lead?',
  'suggest.public.3': 'How do I publish a funnel?',
  'input.label': 'Your question',
  'input.placeholder': 'Type your question',
  'input.tooLong': 'Questions can be up to 1,000 characters.',
  'send.label': 'Send',
  'busy.line': 'Thinking. This can take up to a minute.',
  'signedOut.line': 'Sign in to ask about your business and your account.',
  'signedOut.button': 'Sign In',
  'unavailable.line': 'The assistant is not set up on this server, so it cannot answer yet.',
  'limit.template': 'You have reached this hour’s limit for questions. Try again in {wait}.',
  'failed.line': 'The assistant did not answer. Nothing was changed. Try again in a minute.',
  'failed.retry': 'Retry',
  'unreadable.line': 'The assistant answered with something Jourvance could not read. Try again.',
  'feedback.group': 'Was this answer helpful?',
  'feedback.helpful': 'Helpful',
  'feedback.notHelpful': 'Not helpful',
  'feedback.sharedOnce': 'Thanks. Your question, with anything specific to your business taken out, was shared to help improve Jourvance.',
  'feedback.notSharedOnce': 'Thanks. Your rating is saved here. Nothing was shared.',
  'feedback.alreadyShared': 'Rating updated. The copy of your question shared earlier stays shared.',
  'notes.heading': 'What the assistant knows about your business',
  'notes.help': 'Write facts the assistant should know, such as what you sell, who buys it and how you like to sound. Never write customer names or card details.',
  'notes.tooLong': 'Notes can be up to 2,000 characters.',
  'notes.save': 'Save notes',
  'notes.saved': 'Notes saved.',
  'notes.savedLocalOnly': 'Your notes are saved on this server, but the AI service did not take them. {reason} Try saving again later.',
  'clear.label': 'Clear conversation',
  'clear.confirm': 'Clear this conversation? Your questions and answers will be removed.',
  'clear.confirmYes': 'Clear conversation',
  'clear.confirmNo': 'Keep it',
  'clear.done': 'Conversation cleared.',
  'close.label': 'Close',
} as const;

/**
 * Strings the panel needs that docs/assistant/panel-copy.md does not hold yet: a spoken speaker
 * prefix, the hint and counts, and the lines for a rating, a notes save and a clear that failed.
 * They are kept apart so the content writer can see exactly which words are still unsigned.
 */
export const PANEL_EXTRA = {
  'bubble.newAnswer': 'An answer is waiting.',
  'speaker.you': 'You said:',
  'speaker.assistant': 'Ask Jourvance said:',
  'input.hint': 'Enter sends. Shift+Enter adds a line.',
  'count.template': '{n} of {max}',
  'feedback.failed': 'Your rating did not save. Try again.',
  'notes.failed': 'Your notes did not save. Your text is still in the box. Try again.',
  'clear.failed': 'The conversation was not cleared. Try again.'
} as const;

/** The screen the person is on, sent with every ask and thread call (server: `screen`, strings capped at 120). */
export type ScreenView = 'canvas' | 'email-studio' | 'attribution' | 'public';
export interface AssistantScreen {
  view: ScreenView;
  journeyId?: string;
  journeyName?: string;
  step?: { kind: string; name: string };
}
export const SCREEN_TEXT_MAX = 120;
const SCREEN_VIEWS: readonly ScreenView[] = ['canvas', 'email-studio', 'attribution', 'public'];

const cutScreenText = (v: unknown): string => {
  if (typeof v !== 'string') return '';
  const cut = v.trim().slice(0, SCREEN_TEXT_MAX);
  // Never leave half of a surrogate pair at the end.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

/**
 * The screen object for a call. An unknown view is `public`; strings are cut at 120; an empty id or
 * name is left out; a step with neither a kind nor a name is dropped. The public pages belong to no
 * journey, so they carry none.
 */
export function screenFor(input: { view?: unknown; journeyId?: unknown; journeyName?: unknown; step?: unknown } | null | undefined): AssistantScreen {
  const raw = input && typeof input === 'object' ? input : {};
  const view = SCREEN_VIEWS.includes(raw.view as ScreenView) ? (raw.view as ScreenView) : 'public';
  const screen: AssistantScreen = { view };
  if (view === 'public') return screen;
  const journeyId = cutScreenText(raw.journeyId);
  const journeyName = cutScreenText(raw.journeyName);
  if (journeyId) screen.journeyId = journeyId;
  if (journeyName) screen.journeyName = journeyName;
  const step = raw.step && typeof raw.step === 'object' ? (raw.step as Record<string, unknown>) : null;
  if (step) {
    const kind = cutScreenText(step.kind);
    const name = cutScreenText(step.name);
    if (kind || name) screen.step = { kind, name };
  }
  return screen;
}

const SUGGESTION_SETS = {
  canvas: ['suggest.canvas.1', 'suggest.canvas.2', 'suggest.canvas.3'],
  'email-studio': ['suggest.email.1', 'suggest.email.2', 'suggest.email.3'],
  attribution: ['suggest.attribution.1', 'suggest.attribution.2', 'suggest.attribution.3'],
  public: ['suggest.public.1', 'suggest.public.2', 'suggest.public.3']
} as const;

/** The three suggested-question keys for a view; anything unknown reads as the public set. */
export function suggestionKeys(view: unknown): readonly (keyof typeof PANEL_COPY)[] {
  return SUGGESTION_SETS[SCREEN_VIEWS.includes(view as ScreenView) ? (view as ScreenView) : 'public'];
}

/** "Ask about this": a window event a screen sends and Ask Jourvance listens for. */
export const ASK_EVENT = 'jv-ask';
/** Set on <html> while the assistant is mounted; a sender renders its button only while it is there. */
export const ASK_READY_ATTR = 'data-jv-ask-ready';
export interface AskEventDetail { question: string; screen?: Partial<AssistantScreen> }

export function askAssistantReady(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(ASK_READY_ATTR);
}

/** Opens the panel with the question in the box. Sends nothing to the server by itself. */
export function askAssistant(question: string, screen?: Partial<AssistantScreen>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AskEventDetail>(ASK_EVENT, { detail: { question, ...(screen ? { screen } : {}) } }));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The wait in the server's own words (limitMessage): 1 minute, 12 minutes, 1 hour. */
export function waitWords(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 60 ? '1 hour' : minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function limitText(seconds: number): string {
  return PANEL_COPY['limit.template'].replace('{wait}', waitWords(seconds));
}

export type AskOutcome =
  | { kind: 'answer'; message: AssistantMessage }
  | { kind: 'limit'; seconds: number; text: string }
  | { kind: 'unavailable'; text: string }
  | { kind: 'failed'; retryable: boolean; text: string }
  | { kind: 'signedOut'; text: string };

/** One message, or null when the object is not a readable message. */
export function readMessage(raw: unknown): AssistantMessage | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.role !== 'user' && raw.role !== 'assistant') return null;
  if (typeof raw.text !== 'string') return null;
  const message: AssistantMessage = { id: raw.id, role: raw.role, text: raw.text, at: typeof raw.at === 'string' ? raw.at : '' };
  if (raw.grounding === 'account' || raw.grounding === 'app') message.grounding = raw.grounding;
  if (raw.rating === 'up' || raw.rating === 'down') message.rating = raw.rating;
  if (typeof raw.shared === 'boolean') message.shared = raw.shared;
  return message;
}

const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/** One honest reading of an answer to POST /api/ai/assistant/ask. Null means no answer came. */
export function readAskOutcome(answer: ServerAnswer | null): AskOutcome {
  if (!answer) return { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] };
  if (answer.status === 401) return { kind: 'signedOut', text: PANEL_COPY['signedOut.line'] };
  const body = isObject(answer.body) ? answer.body : {};
  if (answer.status === 429) {
    const s = body.retryAfterSeconds;
    const seconds = typeof s === 'number' && Number.isFinite(s) && s > 0 ? Math.min(3600, Math.ceil(s)) : 3600;
    return { kind: 'limit', seconds, text: limitText(seconds) };
  }
  if (answer.status === 503 && body.reason === 'ai-unavailable') {
    return { kind: 'unavailable', text: PANEL_COPY['unavailable.line'] };
  }
  if (answer.status >= 200 && answer.status < 300 && body.success === true) {
    const message = readMessage(body.answer);
    if (message && message.role === 'assistant' && message.text.trim()) return { kind: 'answer', message };
    return { kind: 'failed', retryable: true, text: PANEL_COPY['unreadable.line'] };
  }
  const retryable = typeof body.retryable === 'boolean' ? body.retryable : retryableStatus(answer.status);
  // A 4xx the person caused (an empty or over-long question) carries the server's own one sentence.
  const said = typeof body.error === 'string' ? body.error.trim() : '';
  if (answer.status >= 400 && answer.status < 500 && said) return { kind: 'failed', retryable: false, text: said };
  return { kind: 'failed', retryable, text: PANEL_COPY['failed.line'] };
}

export interface AssistantThread {
  available: boolean;
  reason: string;
  messages: AssistantMessage[];
  notes: string;
  profileOnHub: { durable: boolean; reason?: string; at?: string; sha?: string };
  accountBrain: { readable: boolean; reason?: string };
}

/** The thread document with safe defaults for anything missing or the wrong type. */
export function readThread(body: unknown): AssistantThread {
  const b = isObject(body) ? body : {};
  const messages = Array.isArray(b.messages) ? b.messages.map(readMessage).filter((m): m is AssistantMessage => m !== null) : [];
  const p = isObject(b.profileOnHub) ? b.profileOnHub : {};
  const brain = isObject(b.accountBrain) ? b.accountBrain : {};
  return {
    available: b.available !== false,
    reason: typeof b.reason === 'string' ? b.reason : '',
    messages,
    notes: typeof b.notes === 'string' ? b.notes : '',
    profileOnHub: {
      durable: p.durable === true,
      ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
      ...(typeof p.at === 'string' ? { at: p.at } : {}),
      ...(typeof p.sha === 'string' ? { sha: p.sha } : {})
    },
    accountBrain: { readable: brain.readable === true, ...(typeof brain.reason === 'string' ? { reason: brain.reason } : {}) }
  };
}

export type NotesOutcome =
  | { kind: 'saved'; notes: string | null; text: string }
  | { kind: 'local'; notes: string | null; text: string }
  | { kind: 'failed'; notes: null; text: string };

/** What a notes save achieved: taken by the AI service, kept here only, or not saved at all. */
export function notesOutcome(answer: ServerAnswer | null): NotesOutcome {
  const body = answer && isObject(answer.body) ? answer.body : {};
  const ok = !!answer && answer.status >= 200 && answer.status < 300 && body.success === true;
  if (!ok) return { kind: 'failed', notes: null, text: PANEL_EXTRA['notes.failed'] };
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const hub = isObject(body.profileOnHub) ? body.profileOnHub : {};
  if (hub.durable === true) return { kind: 'saved', notes, text: PANEL_COPY['notes.saved'] };
  const reason = typeof hub.reason === 'string' ? hub.reason.trim() : '';
  // No reason drops the slot and the space before it, so the sentence never ends in a gap.
  const template = PANEL_COPY['notes.savedLocalOnly'];
  const text = reason ? template.replace('{reason}', reason) : template.replace(' {reason}', '');
  return { kind: 'local', notes, text };
}

/**
 * The one-time line under a rating. Only a Helpful that the server answered says anything, and only
 * the first time: later ratings and Not helpful stay quiet. A rating that did not save says so.
 */
export function feedbackLine(answer: ServerAnswer | null, seenBefore: boolean, rating: 'up' | 'down' = 'up', alreadyShared = false): string {
  const body = answer && isObject(answer.body) ? answer.body : {};
  const ok = !!answer && answer.status >= 200 && answer.status < 300 && body.success === true;
  if (!ok) return PANEL_EXTRA['feedback.failed'];
  // Not helpful after a shared Helpful: the copy already shared stays shared, and the line says so.
  if (rating === 'down') return alreadyShared ? PANEL_COPY['feedback.alreadyShared'] : '';
  if (seenBefore) return '';
  return body.shared === true ? PANEL_COPY['feedback.sharedOnce'] : PANEL_COPY['feedback.notSharedOnce'];
}

/** Where focus goes when the panel opens: the box from 720px up, the heading below (no phone keyboard unasked). */
export function focusTargetOnOpen(widthPx: number): 'input' | 'heading' {
  return widthPx >= 720 ? 'input' : 'heading';
}
