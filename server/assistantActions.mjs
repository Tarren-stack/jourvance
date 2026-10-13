// Ask Jourvance actions (ASK_JOURVANCE_PLAN.md Wave 3, W3.A): the few edits the assistant may
// PROPOSE, and the reading of a reply that may carry them. Nothing here runs an action. The model
// suggests; this module keeps only the shapes in the vocabulary below and builds each button's label
// from the user's own data, never from model text; the person reads the label and clicks or does not.
//
//   { kind: 'open', view: 'canvas' | 'email-studio' | 'attribution' }
//   { kind: 'add-step', type: <NodeType>, journeyId }        only on the canvas, for the SCREEN's journey
//   { kind: 'rename-journey', name, journeyId }              only on the canvas, for the SCREEN's journey
//
// Anything else (an unknown kind, an extra key, a wrong type, a value outside its list, a name that
// is empty, too long or holds a control character, a journeyId that is not the screen's) is dropped
// silently, never a 400: the answer still reaches the person. Never: delete, publish, send,
// unpublish, notes, feedback, workspace or Shopify actions.
//
// Pure: no imports at all. The route hands in the screen, the user's own journeys and the cleaner
// for model text (cleanModelStrings in server/aiCall.mjs), so this file decides only shapes.
// This file carries no em dash and no en dash.

/** At most this many actions are kept from one answer. */
export const ACTIONS_MAX = 3;
/** A journey name the assistant proposes is 1 to this many characters after trimming. */
export const NAME_MAX = 80;
/** A journey name longer than this is cut with an ellipsis inside a button label. */
export const LABEL_JOURNEY_MAX = 60;
/** The action kinds, in the order the plan lists them. */
export const ACTION_KINDS = Object.freeze(['open', 'add-step', 'rename-journey']);
/** The views an open action may name: the three app views (ActiveAppView in src/types/journey.ts). */
export const ACTION_VIEWS = Object.freeze(['canvas', 'email-studio', 'attribution']);
/**
 * The step types an add-step action may name. Copied from `NodeType` in src/types/journey.ts, which
 * is the source; assistant-actions.test.mjs pins this list to that type's text and to the `type` of
 * every STEP_CHOICES row in src/lib/addStep.ts, so a new step type fails the test until it is here.
 */
export const NODE_TYPES = Object.freeze(['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split']);
/**
 * How a step type reads inside a button label. The card names from stepShortName in
 * src/lib/stepNames.ts (one per type, which also names the twelve kinds of src/lib/stepKinds.ts),
 * written as they sit mid-sentence; a follow-up sequence is its plain name. Pinned by the test.
 */
export const STEP_NAMES = Object.freeze({
  'ad-source': 'traffic source',
  'landing-page': 'landing page',
  'lead-form': 'lead form',
  'follow-up-sequence': 'follow-up sequence',
  'thank-you': 'thank-you page',
  upsell: 'upsell',
  'ab-split': 'A/B split'
});
const VIEW_LABELS = Object.freeze({ canvas: 'Open the canvas', 'email-studio': 'Open Email Studio', attribution: 'Open attribution' });
/** The fields each kind carries, and no others. */
const FIELDS = Object.freeze({ open: ['kind', 'view'], 'add-step': ['kind', 'type', 'journeyId'], 'rename-journey': ['kind', 'name', 'journeyId'] });
/**
 * No label is longer than this. The longest one actionLabel can build is 105 characters (a rename to
 * an 80 character name); assistant-actions.test.mjs builds the longest of each kind and holds them
 * under it, and the client refuses a label past it (src/lib/assistant.ts, ACTION_LIMITS.LABEL_MAX).
 */
export const LABEL_MAX = 120;
/** The longest hub text a reply is read from, cut BEFORE it is parsed (MAX_HUB_ANSWER_CHARS in server/aiCall.mjs; a test holds them equal). */
export const REPLY_MAX_CHARS = 64 * 1024;
/** Every id a journey carries is at most this long (JOURNEY_ID_MAX in src/lib/journeyRoute.ts). */
const JOURNEY_ID_MAX = 120;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// Every control, format (zero width, the direction marks and overrides, the soft hyphen, the tag
// characters), private use and surrogate character, the line and paragraph separators, and the
// blank characters that read as letters or symbols but show nothing (the Hangul fillers and the blank
// Braille pattern). None belongs in a label, and each can make one read as something else.
const CONTROL = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\u2800]/u;
// A proposed name also never holds a double quote of any shape: the label puts the name in quotes,
// and a quote inside it would end them early and let the rest read as the label's own words.
const NAME_REFUSED = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0\u2800"\u201c\u201d\u201e\u201f\u2033\u2036\u3003\u301d\u301e\uff02]/u;
/** A name holds at least one letter or digit, so a name of spaces, marks or symbols alone is refused. */
const NAME_NEEDS = /[\p{L}\p{N}]/u;
const chars = (s) => [...s].length;

/**
 * A journey name the assistant may propose: trimmed, 1 to NAME_MAX characters, at least one letter
 * or digit, and none of NAME_REFUSED. '' when it is not one.
 */
export function readJourneyName(raw, clean = (s) => s) {
  if (typeof raw !== 'string' || NAME_REFUSED.test(raw)) return '';
  const cleaned = clean(raw);
  if (typeof cleaned !== 'string' || NAME_REFUSED.test(cleaned)) return '';
  const name = cleaned.trim();
  // A dash the cleaner could not turn into words is never shown as the model wrote it.
  if (/\u2014|\s\u2013\s/.test(name)) return '';
  return name && NAME_NEEDS.test(name) && chars(name) <= NAME_MAX ? name : '';
}

const hasOnly = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k)) && keys.every((k) => Object.hasOwn(obj, k));
const validJourneyId = (v) => typeof v === 'string' && v.length > 0 && v.length <= JOURNEY_ID_MAX && !CONTROL.test(v);

/** The one action's identity, so a repeat (same kind, same values) is dropped. */
const identity = (a) => JSON.stringify([a.kind, a.view ?? '', a.type ?? '', a.name ?? '', a.journeyId ?? '']);

/**
 * A journey name for a label: the user's own words, cut at LABEL_JOURNEY_MAX with an ellipsis. The
 * characters CONTROL names are taken out of the label's copy only (the journey keeps its name).
 */
function labelJourneyName(name) {
  const s = typeof name === 'string' ? name.replace(new RegExp(CONTROL.source, 'gu'), '').replace(/\s+/g, ' ').trim() : '';
  if (!s) return 'this journey';
  const cps = [...s];
  return cps.length > LABEL_JOURNEY_MAX ? `${cps.slice(0, LABEL_JOURNEY_MAX - 1).join('').trimEnd()}\u2026` : s;
}

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * The button text for one action, built here from the vocabulary and the user's own journey name,
 * never from model text. '' for an action that is not in the vocabulary.
 */
export function actionLabel(action, { journeyName = '', stepName = '' } = {}) {
  const a = isPlainObject(action) ? action : {};
  if (a.kind === 'open') return VIEW_LABELS[a.view] || '';
  if (a.kind === 'add-step') {
    const step = stepName || STEP_NAMES[a.type] || '';
    return step ? `Add ${article(step)} ${step} step to ${labelJourneyName(journeyName)}` : '';
  }
  if (a.kind === 'rename-journey') return typeof a.name === 'string' && a.name ? `Rename this journey to "${a.name}"` : '';
  return '';
}

/**
 * The actions a reply proposed, each checked against the vocabulary and the screen, labelled, at most
 * ACTIONS_MAX, in order, repeats dropped. `screen` is the screen ownScreen kept (a journeyId on it is
 * one of the user's journeys); `journeys` is the user's own journey list, for the names; `clean` is
 * the model-text cleaner, applied to a proposed name before it is checked.
 */
export function readActions(raw, screen, { journeys = [], clean } = {}) {
  if (!Array.isArray(raw)) return [];
  const onScreen = isPlainObject(screen) && screen.view === 'canvas' && validJourneyId(screen.journeyId) ? screen.journeyId : '';
  const list = Array.isArray(journeys) ? journeys : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= ACTIONS_MAX) break;
    if (!isPlainObject(item) || typeof item.kind !== 'string' || !ACTION_KINDS.includes(item.kind)) continue;
    if (!hasOnly(item, FIELDS[item.kind])) continue;
    let action;
    if (item.kind === 'open') {
      if (typeof item.view !== 'string' || !ACTION_VIEWS.includes(item.view)) continue;
      action = { kind: 'open', view: item.view };
    } else {
      // A journey action is for the journey on the canvas and no other.
      if (!onScreen || item.journeyId !== onScreen) continue;
      if (item.kind === 'add-step') {
        if (typeof item.type !== 'string' || !NODE_TYPES.includes(item.type)) continue;
        action = { kind: 'add-step', type: item.type, journeyId: onScreen };
      } else {
        const name = readJourneyName(item.name, clean);
        if (!name) continue;
        action = { kind: 'rename-journey', name, journeyId: onScreen };
      }
    }
    const id = identity(action);
    if (seen.has(id)) continue;
    const journey = action.journeyId ? list.find((j) => isPlainObject(j) && j.id === action.journeyId) : null;
    const journeyName = journey ? (typeof journey.name === 'string' && journey.name.trim() ? journey.name : journey.metadata?.name) : '';
    const label = actionLabel(action, { journeyName, stepName: action.type ? STEP_NAMES[action.type] : '' });
    if (!label) continue;
    seen.add(id);
    out.push({ ...action, label });
  }
  return out;
}

// One fence at the start (``` or ~~~, with any tag such as json, json5 or JSON) and one at the end.
const FENCE_OPEN = /^(?:```|~~~)[ \t]*[A-Za-z0-9_+.-]*[ \t]*\r?\n?/;
const FENCE_CLOSE = /\r?\n?[ \t]*(?:```|~~~)[ \t]*$/;

/** The text of the first whole JSON object in `s` (braces counted outside strings), or ''. */
function firstObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return '';
}

/**
 * One reply from the model: { answer, actions, format }. The model is asked for
 * {"answer": "...", "actions": [...]}. The text is cut to REPLY_MAX_CHARS first, then read in this
 * order: the whole text without one leading and one trailing fence; when that does not parse, the
 * span from the first "{" to the last "}" once; when that does not parse either, the first whole
 * object (prose before the JSON, or two objects in a row). Of the last two, only one that parses to
 * an object with a non-empty string `answer` is used. A reply none of them reads is the answer,
 * whole, with no actions (format 'text'), so a plain answer still reaches the person. A whole text
 * that parses without a non-empty string `answer` answers '' (the route then says it could not read
 * it). `text` may also be an object a caller already parsed. `screen` and `opts` go to readActions.
 * The answer is returned as the model wrote it: the route cleans and caps it.
 */
export function readReply(text, screen = null, opts = {}) {
  const fromObject = (obj) => {
    if (!isPlainObject(obj) || typeof obj.answer !== 'string' || !obj.answer.trim()) return { answer: '', actions: [], format: 'json' };
    return { answer: obj.answer, actions: readActions(obj.actions, screen, opts), format: 'json' };
  };
  if (isPlainObject(text)) return fromObject(text);
  if (typeof text !== 'string') return { answer: '', actions: [], format: 'text' };
  const whole = text.slice(0, REPLY_MAX_CHARS).trim();
  const parse = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch {
      return { ok: false };
    }
  };
  const hasAnswer = (v) => isPlainObject(v) && typeof v.answer === 'string' && !!v.answer.trim();
  // One leading fence and one trailing fence, each only when it is there.
  const body = whole.replace(FENCE_OPEN, '').replace(FENCE_CLOSE, '').trim();
  const first = parse(body);
  if (first.ok) return fromObject(first.value);
  for (const span of [whole.slice(whole.indexOf('{'), whole.lastIndexOf('}') + 1), firstObject(whole)]) {
    if (!span.startsWith('{')) continue;
    const tried = parse(span);
    if (tried.ok && hasAnswer(tried.value)) return fromObject(tried.value);
  }
  return { answer: whole, actions: [], format: 'text' };
}

/**
 * The actions stored on a message, rebuilt for an answer that is read back: every label is built
 * again here from the action's own fields, this user's current journey list (`journeys`, the user's
 * own rows) and STEP_NAMES, and the stored label is never kept. A journey action whose journey is not
 * in the list (deleted, or a list that could not be read: pass null) is dropped, and so is a stored
 * rename whose name these rules refuse today.
 */
export function relabelStoredActions(raw, journeys) {
  const list = Array.isArray(journeys) ? journeys : null;
  const out = [];
  for (const a of cleanStoredActions(raw)) {
    if (a.kind === 'open') {
      out.push({ kind: 'open', view: a.view, label: actionLabel(a) });
      continue;
    }
    const journey = list ? list.find((j) => isPlainObject(j) && j.id === a.journeyId) : null;
    if (!journey) continue;
    const journeyName = typeof journey.name === 'string' && journey.name.trim() ? journey.name : journey.metadata?.name;
    if (a.kind === 'add-step') {
      out.push({ kind: 'add-step', type: a.type, journeyId: a.journeyId, label: actionLabel(a, { journeyName, stepName: STEP_NAMES[a.type] }) });
    } else {
      out.push({ kind: 'rename-journey', name: a.name, journeyId: a.journeyId, label: actionLabel(a) });
    }
  }
  return out;
}

/**
 * Actions as they were stored on a message, checked again by shape when the thread is read: the kind,
 * a label string, and each kind's own fields. A stored action is not checked against a screen (the
 * screen it was proposed on is gone), only that it could have been built here. Bad items are dropped;
 * an empty result means the message carries no `actions`. relabelStoredActions builds every label
 * again before an answer leaves the server.
 */
export function cleanStoredActions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= ACTIONS_MAX) break;
    if (!isPlainObject(item) || typeof item.kind !== 'string' || !ACTION_KINDS.includes(item.kind)) continue;
    if (!hasOnly(item, [...FIELDS[item.kind], 'label'])) continue;
    if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > LABEL_MAX || CONTROL.test(item.label)) continue;
    if (item.kind === 'open') {
      if (typeof item.view !== 'string' || !ACTION_VIEWS.includes(item.view)) continue;
      out.push({ kind: 'open', view: item.view, label: item.label });
    } else if (item.kind === 'add-step') {
      if (typeof item.type !== 'string' || !NODE_TYPES.includes(item.type) || !validJourneyId(item.journeyId)) continue;
      out.push({ kind: 'add-step', type: item.type, journeyId: item.journeyId, label: item.label });
    } else {
      const name = readJourneyName(item.name);
      if (!name || name !== item.name || !validJourneyId(item.journeyId)) continue;
      out.push({ kind: 'rename-journey', name, journeyId: item.journeyId, label: item.label });
    }
  }
  return out;
}
