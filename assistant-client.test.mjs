// Ask Jourvance, the pure client half (src/lib/assistant.ts): the limits are pinned equal to the
// server's, and every server answer reads as exactly one honest state with the exact copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIMITS } from './server/assistantContext.mjs';
import { limitMessage } from './server/routes/aiJourneyRoutes.mjs';
import {
  ASSISTANT_LIMITS,
  PANEL_COPY,
  readAskOutcome,
  readThread,
  notesOutcome,
  feedbackLine,
  focusTargetOnOpen,
  limitText,
  waitWords,
  screenFor,
  suggestionKeys,
  SCREEN_TEXT_MAX,
  ASK_EVENT,
  ASK_READY_ATTR,
  askAssistantReady,
  ACTION_LIMITS,
  ACTION_VIEWS,
  ACTION_STEP_TYPES,
  readMessage,
  readAction,
  readActions,
  latestAnswerId,
  runAssistantAction,
  ACTION_STEP_NAMES,
  readActionName,
  showsActionButtons,
  actionKey,
  actionRunnable,
  markActionRun,
  actionDoneLine,
  SHEET_OPEN_ATTR
} from './src/lib/assistant.ts';
import * as SERVER_ACTIONS from './server/assistantActions.mjs';

const answerBody = { success: true, source: 'hub-brain', answer: { id: 'a1', role: 'assistant', text: 'Open the journey, then Publish.', at: '2026-10-11T10:00:00Z', grounding: 'app' } };

test('every limit equals the server\'s and the key sets are identical', () => {
  assert.deepEqual(Object.keys(ASSISTANT_LIMITS).sort(), Object.keys(LIMITS).sort());
  for (const key of Object.keys(LIMITS)) assert.equal(ASSISTANT_LIMITS[key], LIMITS[key], key);
  assert.equal(Object.keys(LIMITS).length, 10);
});

test('readAskOutcome: a 200 with a readable answer is the answer', () => {
  const out = readAskOutcome({ status: 200, body: answerBody });
  assert.equal(out.kind, 'answer');
  assert.equal(out.message.id, 'a1');
  assert.equal(out.message.grounding, 'app');
});

test('readAskOutcome: a 200 whose answer cannot be read is a retryable failure with the unreadable sentence', () => {
  for (const body of [{ success: true }, { success: true, answer: { id: 'x', role: 'user', text: 'hi' } }, { success: true, answer: { id: 'x', role: 'assistant', text: '  ' } }]) {
    const out = readAskOutcome({ status: 200, body });
    assert.deepEqual(out, { kind: 'failed', retryable: true, text: PANEL_COPY['unreadable.line'] });
  }
});

test('readAskOutcome: 401 is signed out', () => {
  assert.deepEqual(readAskOutcome({ status: 401, body: {} }), { kind: 'signedOut', text: PANEL_COPY['signedOut.line'] });
});

test('readAskOutcome: 429 names the wait in the server\'s own words, and falls back to 1 hour', () => {
  const cases = [[60, '1 minute'], [30, '1 minute'], [720, '12 minutes'], [3600, '1 hour'], [9999, '1 hour']];
  for (const [seconds, words] of cases) {
    const out = readAskOutcome({ status: 429, body: { success: false, retryAfterSeconds: seconds } });
    assert.equal(out.kind, 'limit');
    assert.equal(out.text, `You have reached this hour’s limit for questions. Try again in ${words}.`, String(seconds));
  }
  assert.equal(readAskOutcome({ status: 429, body: { retryAfterSeconds: 720 } }).seconds, 720);
  for (const body of [{}, { retryAfterSeconds: 'soon' }, { retryAfterSeconds: 0 }, null]) {
    const out = readAskOutcome({ status: 429, body });
    assert.equal(out.kind, 'limit');
    assert.equal(out.seconds, 3600);
    assert.match(out.text, /Try again in 1 hour\.$/);
  }
});

test('readAskOutcome: 503 ai-unavailable is unavailable, other 503 is a retryable failure', () => {
  assert.deepEqual(readAskOutcome({ status: 503, body: { reason: 'ai-unavailable', retryable: false } }), { kind: 'unavailable', text: PANEL_COPY['unavailable.line'] });
  assert.deepEqual(readAskOutcome({ status: 503, body: {} }), { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] });
});

test('readAskOutcome: 502 is retryable, 500 follows the body, 400 carries the server\'s sentence, null is retryable', () => {
  assert.deepEqual(readAskOutcome({ status: 502, body: { retryable: true } }), { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] });
  assert.deepEqual(readAskOutcome({ status: 500, body: { success: false, retryable: true } }), { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] });
  assert.deepEqual(readAskOutcome({ status: 500, body: {} }), { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] });
  assert.deepEqual(readAskOutcome({ status: 400, body: { error: 'Keep your question to 1,000 characters or fewer.' } }), { kind: 'failed', retryable: false, text: 'Keep your question to 1,000 characters or fewer.' });
  assert.deepEqual(readAskOutcome(null), { kind: 'failed', retryable: true, text: PANEL_COPY['failed.line'] });
});

test('readThread: safe defaults for anything missing or the wrong type', () => {
  const empty = { available: true, reason: '', messages: [], notes: '', profileOnHub: { durable: false }, accountBrain: { readable: false } };
  assert.deepEqual(readThread(null), empty);
  assert.deepEqual(readThread('nope'), empty);
  assert.deepEqual(readThread({ messages: 'x', notes: 5, profileOnHub: 3, accountBrain: [] }), empty);
  const full = readThread({
    available: false,
    reason: 'ai-unavailable',
    notes: 'We sell tea.',
    messages: [{ id: 'm1', role: 'user', text: 'hi', at: 't' }, { id: 'm2', role: 'robot', text: 'x' }, { role: 'user', text: 'no id' }, { id: 'm3', role: 'assistant', text: 'yo', rating: 'up', shared: true, grounding: 'account' }],
    profileOnHub: { durable: true, at: 'now', sha: 'abc' },
    accountBrain: { readable: true }
  });
  assert.equal(full.available, false);
  assert.equal(full.reason, 'ai-unavailable');
  assert.deepEqual(full.messages.map(m => m.id), ['m1', 'm3']);
  assert.equal(full.messages[1].rating, 'up');
  assert.equal(full.messages[1].shared, true);
  assert.equal(full.notes, 'We sell tea.');
  assert.deepEqual(full.profileOnHub, { durable: true, at: 'now', sha: 'abc' });
  assert.equal(full.accountBrain.readable, true);
});

test('notesOutcome: saved, saved here only with the reason, and the reason slot dropped with its space', () => {
  const saved = notesOutcome({ status: 200, body: { success: true, notes: 'a', profileOnHub: { durable: true } } });
  assert.deepEqual(saved, { kind: 'saved', notes: 'a', text: 'Notes saved.' });
  const local = notesOutcome({ status: 200, body: { success: true, notes: 'a', profileOnHub: { durable: false, reason: 'HUB_API_KEY is not set on this server.' } } });
  assert.equal(local.kind, 'local');
  assert.equal(local.text, 'Your notes are saved on this server, but the AI service did not take them. HUB_API_KEY is not set on this server. Try saving again later.');
  const bare = notesOutcome({ status: 200, body: { success: true, notes: 'a', profileOnHub: { durable: false } } });
  assert.equal(bare.text, 'Your notes are saved on this server, but the AI service did not take them. Try saving again later.');
  assert.ok(!bare.text.includes('{reason}') && !bare.text.includes('  '));
  const failed = notesOutcome({ status: 500, body: { success: false } });
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.notes, null);
  assert.equal(notesOutcome(null).kind, 'failed');
});

test('feedbackLine: shared once, not shared once, nothing after, nothing for Not helpful, a failure says so', () => {
  const ok = shared => ({ status: 200, body: { success: true, shared } });
  assert.equal(feedbackLine(ok(true), false), PANEL_COPY['feedback.sharedOnce']);
  assert.equal(feedbackLine(ok(false), false), PANEL_COPY['feedback.notSharedOnce']);
  assert.equal(feedbackLine(ok(true), true), '');
  assert.equal(feedbackLine(ok(false), true), '');
  assert.equal(feedbackLine(ok(false), false, 'down'), '');
  assert.equal(feedbackLine(ok(true), true, 'down', true), 'Rating updated. The copy of your question shared earlier stays shared.');
  assert.equal(feedbackLine(ok(false), false, 'down', false), '');
  assert.match(feedbackLine(null, false), /did not save/);
  assert.match(feedbackLine({ status: 404, body: { success: false } }, true), /did not save/);
});

test('focusTargetOnOpen: the box from 720px up, the heading below', () => {
  assert.equal(focusTargetOnOpen(719), 'heading');
  assert.equal(focusTargetOnOpen(720), 'input');
  assert.equal(focusTargetOnOpen(1440), 'input');
  assert.equal(focusTargetOnOpen(390), 'heading');
});

test('limitText fills {wait} and leaves no slot behind', () => {
  assert.ok(!limitText(60).includes('{'));
  assert.equal(limitText(5), PANEL_COPY['limit.template'].replace('{wait}', '1 minute'));
});

test('the client sends to the five routes the server serves', () => {
  const src = fs.readFileSync(new URL('./src/lib/assistantClient.ts', import.meta.url), 'utf8');
  for (const [method, path] of [['GET', '/api/ai/assistant/thread'], ['POST', '/api/ai/assistant/ask'], ['POST', '/api/ai/assistant/notes'], ['POST', '/api/ai/assistant/feedback'], ['DELETE', '/api/ai/assistant/thread']]) {
    assert.ok(src.includes(`'${method}', '${path}'`), `${method} ${path}`);
  }
  assert.ok(src.includes('authHeaders'));
});

test('waitWords says the same words as the server\'s limitMessage for every wait', () => {
  for (const seconds of [1, 59, 60, 61, 119, 120, 720, 3540, 3541, 3600]) {
    assert.ok(limitMessage(seconds).endsWith(`Try again in ${waitWords(seconds)}.`), String(seconds));
  }
});

test('screenFor: an unknown or missing view is public, and public carries no journey', () => {
  for (const view of [undefined, null, 'home', 42, '', 'Canvas', {}]) assert.deepEqual(screenFor({ view, journeyId: 'j1', journeyName: 'N', step: { kind: 'page', name: 'P' } }), { view: 'public' }, String(view));
  assert.deepEqual(screenFor(undefined), { view: 'public' });
  assert.deepEqual(screenFor(null), { view: 'public' });
  assert.deepEqual(screenFor({ view: 'public', journeyId: 'j1' }), { view: 'public' });
});

test('screenFor: the three app views keep the journey and the step', () => {
  for (const view of ['canvas', 'email-studio', 'attribution']) {
    assert.deepEqual(screenFor({ view, journeyId: 'j1', journeyName: 'Spring launch', step: { kind: 'page', name: 'Landing' } }), { view, journeyId: 'j1', journeyName: 'Spring launch', step: { kind: 'page', name: 'Landing' } }, view);
  }
});

test('screenFor: every string is trimmed and cut at 120, and no half surrogate is left', () => {
  assert.equal(SCREEN_TEXT_MAX, 120);
  const long = 'x'.repeat(300);
  const s = screenFor({ view: 'canvas', journeyId: long, journeyName: '  ' + long, step: { kind: long, name: long } });
  for (const v of [s.journeyId, s.journeyName, s.step.kind, s.step.name]) assert.equal(v.length, 120);
  const emoji = 'a'.repeat(119) + '\u{1F600}';
  const cut = screenFor({ view: 'canvas', journeyName: emoji }).journeyName;
  assert.equal(cut, 'a'.repeat(119));
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut));
});

test('screenFor: an empty or non-string id or name is left out, and a missing step is dropped', () => {
  assert.deepEqual(screenFor({ view: 'canvas', journeyId: '', journeyName: '   ' }), { view: 'canvas' });
  assert.deepEqual(screenFor({ view: 'canvas', journeyId: 7, journeyName: {} }), { view: 'canvas' });
  for (const step of [undefined, null, 'page', {}, { kind: '', name: ' ' }, { kind: 3, name: null }]) {
    assert.ok(!('step' in screenFor({ view: 'canvas', step })), JSON.stringify(step));
  }
  assert.deepEqual(screenFor({ view: 'canvas', step: { kind: 'page' } }).step, { kind: 'page', name: '' });
});

test('suggestionKeys: three rows per view, all in the copy table, different between views, unknown reads as public', () => {
  const seen = new Set();
  for (const view of ['canvas', 'email-studio', 'attribution', 'public']) {
    const keys = suggestionKeys(view);
    assert.equal(keys.length, 3, view);
    for (const k of keys) {
      assert.equal(typeof PANEL_COPY[k], 'string', k);
      assert.ok(PANEL_COPY[k].length > 10, k);
      assert.ok(!seen.has(k), `${k} is used by two views`);
      seen.add(k);
    }
  }
  assert.deepEqual(suggestionKeys('canvas'), ['suggest.canvas.1', 'suggest.canvas.2', 'suggest.canvas.3']);
  assert.deepEqual(suggestionKeys('email-studio'), ['suggest.email.1', 'suggest.email.2', 'suggest.email.3']);
  assert.deepEqual(suggestionKeys('nowhere'), suggestionKeys('public'));
  assert.deepEqual(suggestionKeys(undefined), suggestionKeys('public'));
});

test('the ask event and the ready attribute have the names the senders and the listener share', () => {
  assert.equal(ASK_EVENT, 'jv-ask');
  assert.equal(ASK_READY_ATTR, 'data-jv-ask-ready');
  assert.equal(askAssistantReady(), false, 'no document here, so not ready');
});

// ---- W3.A: suggested actions ----

const OPEN = { kind: 'open', view: 'email-studio', label: 'Open Email Studio' };
const ADD = { kind: 'add-step', type: 'landing-page', journeyId: 'j1', label: 'Add a landing page step to Spring' };
const RENAME = { kind: 'rename-journey', name: 'Spring sale', journeyId: 'j1', label: 'Rename this journey to "Spring sale"' };

test('the action limits and lists equal the server\u2019s, key for key', () => {
  assert.deepEqual(ACTION_LIMITS, { ACTIONS_MAX: SERVER_ACTIONS.ACTIONS_MAX, NAME_MAX: SERVER_ACTIONS.NAME_MAX, LABEL_MAX: SERVER_ACTIONS.LABEL_MAX });
  assert.deepEqual([...ACTION_VIEWS], [...SERVER_ACTIONS.ACTION_VIEWS]);
  assert.deepEqual([...ACTION_STEP_TYPES], [...SERVER_ACTIONS.NODE_TYPES]);
  assert.deepEqual({ ...ACTION_STEP_NAMES }, { ...SERVER_ACTIONS.STEP_NAMES });
  assert.equal(SHEET_OPEN_ATTR, 'data-jv-sheet-open');
});

// Names the two rules must agree on: one per refused class, and a few that are kept.
const NAME_SAMPLES = [
  'Spring "Sale"', 'Spring \u201cSale', 'Spring Sale\u201d', 'Spring \u201eSale', 'Spring \uff02Sale', 'Spring \u2033Sale',
  'Spring\u{E0041}Sale', 'Spring\u200bSale', 'Spring\u200dSale', 'Spring\u2060Sale', '\ufeffSpring', 'Spring\u200eSale',
  'Spring\u200fSale', 'Spring\u061cSale', 'Spring\u00adSale', 'Spring \u3164', '\u3164', 'Spring \uffa0', 'Spring \u115f', 'Spring \u2800',
  '\u2800', 'Spring \ue000', 'Spring \ud800', 'Spring\u2028', 'Spring\u2029', 'Spring\u202e', 'Spring\u2066', 'Bell\u0007', 'C1\u0085',
  '!!!', '---', '\u2605', '', '   ', 'x'.repeat(81),
  'Spring 2026', "Rosa's Funnel", 'Caf\u00e9 cr\u00e8me', 'Sale \u{1F389}', '  Trimmed  ', 'x'.repeat(80)
];

test('readActionName agrees with the server\u2019s readJourneyName on every sample, refused classes and kept names alike', () => {
  for (const name of NAME_SAMPLES) assert.equal(readActionName(name), SERVER_ACTIONS.readJourneyName(name), JSON.stringify(name));
  assert.equal(NAME_SAMPLES.filter((n) => readActionName(n)).length, 6, 'six samples are names');
  assert.equal(readAction({ kind: 'rename-journey', name: 'Spring "Sale"', journeyId: 'j1', label: 'Rename' }), null);
});

test('readAction refuses a label longer than the server\u2019s longest, or holding a character no label may hold', () => {
  const base = { kind: 'open', view: 'canvas' };
  assert.equal(readAction({ ...base, label: 'x'.repeat(ACTION_LIMITS.LABEL_MAX) }).label.length, ACTION_LIMITS.LABEL_MAX);
  assert.equal(readAction({ ...base, label: 'x'.repeat(ACTION_LIMITS.LABEL_MAX + 1) }), null);
  for (const bad of ['Open\u200e the canvas', 'Open\u202e the canvas', 'Open\u{E0041}', 'Open\u3164', 'Open\u0007', 'Open\u2028x']) {
    assert.equal(readAction({ ...base, label: bad }), null, JSON.stringify(bad));
  }
  assert.equal(readAction({ ...RENAME }).label, 'Rename this journey to "Spring sale"', 'straight quotes are fine in a label');
});

test('showsActionButtons: only the newest answer, and only one that arrived in this page load', () => {
  const live = new Set(['a2']);
  assert.equal(showsActionButtons('a2', 'a2', live), true);
  assert.equal(showsActionButtons('a1', 'a2', live), false, 'an older answer');
  assert.equal(showsActionButtons('a3', 'a3', live), false, 'the newest, read back with the thread');
  assert.equal(showsActionButtons('', '', new Set([''])), false);
});

test('actionRunnable and markActionRun: an action runs once per key, its result kept under that key and never replaced', () => {
  const key = actionKey('m_1', 2);
  assert.equal(key, 'm_1:2');
  const done = { ok: true, line: 'Opened.', tone: 'ok' };
  const empty = {};
  assert.equal(actionRunnable(empty, key), true);
  const after = markActionRun(empty, key, done);
  assert.deepEqual(after, { [key]: done });
  assert.deepEqual(empty, {}, 'the old record is not changed');
  assert.equal(actionRunnable(after, key), false, 'it cannot run again');
  assert.equal(actionRunnable(after, actionKey('m_1', 1)), true, 'the other actions of that message still can');
  assert.deepEqual(markActionRun(after, key, { ok: false, line: 'x', tone: 'bad' })[key], done, 'a second result never replaces the first');
  assert.equal(actionRunnable({ toString: done }, 'toString'), false);
  assert.equal(actionRunnable({}, 'toString'), true, 'an inherited name is not a result');
});

test('actionDoneLine names what ran: the step with "a" or "an", the new name in quotes', () => {
  const add = (type) => actionDoneLine({ kind: 'add-step', type, journeyId: 'j1', label: 'x' });
  assert.equal(add('landing-page'), 'Added a landing page step. Undo is in the editor toolbar.');
  assert.equal(add('upsell'), 'Added an upsell step. Undo is in the editor toolbar.');
  assert.equal(add('ab-split'), 'Added an A/B split step. Undo is in the editor toolbar.');
  assert.equal(add('thank-you'), 'Added a thank-you page step. Undo is in the editor toolbar.');
  assert.equal(actionDoneLine(RENAME), 'Renamed to "Spring sale". Undo is in the editor toolbar.');
  assert.equal(actionDoneLine(OPEN), 'Opened.');
});

test('readMessage reads an answer\u2019s actions by shape: the good ones kept, at most three, the bad ones dropped, none on a question', () => {
  const base = { id: 'a1', role: 'assistant', text: 'Here.', at: 't' };
  assert.deepEqual(readMessage({ ...base, actions: [OPEN, ADD, RENAME] }).actions, [OPEN, ADD, RENAME]);
  assert.deepEqual(readMessage({ ...base, actions: [OPEN, OPEN, OPEN, ADD] }).actions.length, 3);
  const bad = [
    { kind: 'delete', journeyId: 'j1', label: 'Delete' },
    { kind: 'open', view: 'admin', label: 'Open admin' },
    { kind: 'open', view: 'canvas' },
    { kind: 'open', view: 'canvas', label: '   ' },
    { kind: 'open', view: 'canvas', label: 'Line\nbreak' },
    { kind: 'add-step', type: 'checkout', journeyId: 'j1', label: 'Add' },
    { kind: 'add-step', type: 'lead-form', label: 'Add' },
    { kind: 'rename-journey', name: 'x'.repeat(81), journeyId: 'j1', label: 'Rename' },
    { kind: 'rename-journey', name: 'Tab\there', journeyId: 'j1', label: 'Rename' },
    { kind: 'rename-journey', name: '', journeyId: 'j1', label: 'Rename' },
    null, 'open'
  ];
  assert.ok(!('actions' in readMessage({ ...base, actions: bad })), 'nothing readable leaves no key');
  assert.ok(!('actions' in readMessage({ ...base, actions: 'open' })));
  assert.ok(!('actions' in readMessage({ ...base })));
  assert.ok(!('actions' in readMessage({ id: 'u1', role: 'user', text: 'q', actions: [OPEN] })), 'a question proposes nothing');
  assert.deepEqual(readThread({ messages: [{ ...base, actions: [OPEN, bad[0]] }] }).messages[0].actions, [OPEN]);
  assert.deepEqual(readAskOutcome({ status: 200, body: { success: true, answer: { ...base, actions: [RENAME] } } }).message.actions, [RENAME]);
  assert.deepEqual(readActions([RENAME, OPEN]), [RENAME, OPEN]);
  assert.equal(readAction({ ...RENAME, name: '  Spring sale  ' }).name, 'Spring sale');
});

test('latestAnswerId names the newest answer, so only its actions are buttons', () => {
  const m = (id, role) => ({ id, role, text: id, at: '' });
  assert.equal(latestAnswerId([m('u1', 'user'), m('a1', 'assistant'), m('u2', 'user'), m('a2', 'assistant'), m('u3', 'user')]), 'a2');
  assert.equal(latestAnswerId([m('u1', 'user')]), '');
  assert.equal(latestAnswerId([]), '');
});

test('runAssistantAction: open runs the view switch, a journey action runs only on the journey open now, and each says what happened', () => {
  const calls = [];
  const handlers = (openJourneyId, openViewAnswer = true) => ({
    openJourneyId,
    openView: (view) => { calls.push(['open', view]); return openViewAnswer; },
    addStep: (type) => calls.push(['add', type]),
    renameJourney: (name) => calls.push(['rename', name])
  });
  assert.deepEqual(runAssistantAction(OPEN, handlers('j1')), { ok: true, line: 'Opened.', tone: 'ok' });
  assert.deepEqual(runAssistantAction(OPEN, handlers('j1', false)), { ok: false, line: 'That did not run. Nothing changed.', tone: 'bad' }, 'the person chose to stay');
  assert.deepEqual(runAssistantAction(ADD, handlers('j1')), { ok: true, line: 'Added a landing page step. Undo is in the editor toolbar.', tone: 'ok' });
  assert.deepEqual(runAssistantAction(RENAME, handlers('j1')), { ok: true, line: 'Renamed to "Spring sale". Undo is in the editor toolbar.', tone: 'ok' });
  assert.deepEqual(calls, [['open', 'email-studio'], ['open', 'email-studio'], ['add', 'landing-page'], ['rename', 'Spring sale']]);
  calls.length = 0;
  for (const open of ['j2', '', null, undefined]) {
    for (const action of [ADD, RENAME]) {
      assert.deepEqual(runAssistantAction(action, handlers(open)), { ok: false, line: 'That journey is not open any more. Open it and ask again.', tone: 'warn' }, `${action.kind} with ${open}`);
    }
  }
  assert.deepEqual(calls, [], 'nothing ran on another journey');
  assert.deepEqual(runAssistantAction({ kind: 'delete', journeyId: 'j1', label: 'Delete' }, handlers('j1')), { ok: false, line: 'That did not run. Nothing changed.', tone: 'bad' });
  assert.deepEqual(calls, []);
  assert.throws(() => runAssistantAction(ADD, { ...handlers('j1'), addStep: () => { throw new Error('boom'); } }), /boom/, 'a throw reaches the panel, which shows action.failed');
});

test('the action copy rows are the contract\u2019s words', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PANEL_COPY).filter(([k]) => k.startsWith('action.'))),
    {
      'action.group': 'Suggested actions',
      'action.done.open': 'Opened.',
      'action.done.add-step': 'Added a {step} step. Undo is in the editor toolbar.',
      'action.done.rename-journey': 'Renamed to "{name}". Undo is in the editor toolbar.',
      'action.notOpen': 'That journey is not open any more. Open it and ask again.',
      'action.failed': 'That did not run. Nothing changed.',
      'action.suggested': 'Suggested:'
    }
  );
});
