// Ask Jourvance actions (server/assistantActions.mjs, ASK_JOURVANCE_PLAN.md Wave 3, W3.A): what a reply
// may propose, read and checked on the server, and the button labels built from the user's own data.
// A reply that is not JSON is the answer whole with no actions; every action outside the vocabulary,
// or for a journey that is not the one on the canvas, is dropped silently. The step type list is
// pinned to NodeType in src/types/journey.ts and to STEP_CHOICES in src/lib/addStep.ts, and the step
// names to stepShortName in src/lib/stepNames.ts, so neither can drift from the client.
// Dashes in this file are written as \u escapes so it carries none.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ACTIONS_MAX,
  NAME_MAX,
  LABEL_JOURNEY_MAX,
  ACTION_KINDS,
  ACTION_VIEWS,
  NODE_TYPES,
  STEP_NAMES,
  readReply,
  readActions,
  actionLabel,
  readJourneyName,
  cleanStoredActions,
  relabelStoredActions,
  LABEL_MAX,
  REPLY_MAX_CHARS
} from './server/assistantActions.mjs';
import { cleanModelStrings, MAX_HUB_ANSWER_CHARS } from './server/aiCall.mjs';

const { STEP_CHOICES } = await import('./src/lib/addStep.ts');
const { stepShortName } = await import('./src/lib/stepNames.ts');

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const EM = '\u2014';
const EN = '\u2013';
const CANVAS = { view: 'canvas', journeyId: 'j1', journeyName: 'Spring Glaze Sale' };
const JOURNEYS = [{ id: 'j1', name: 'Spring Glaze Sale' }, { id: 'j2', name: 'Winter Wheel Class' }];
const opts = { journeys: JOURNEYS, clean: cleanModelStrings };
const open = (view) => ({ kind: 'open', view });
const add = (type, journeyId = 'j1') => ({ kind: 'add-step', type, journeyId });
const rename = (name, journeyId = 'j1') => ({ kind: 'rename-journey', name, journeyId });

// ---- The lists are the client's ----

test('NODE_TYPES is NodeType in src/types/journey.ts, and every STEP_CHOICES type in src/lib/addStep.ts', () => {
  const source = read('./src/types/journey.ts');
  const line = source.match(/^export type NodeType = (.+);$/m);
  assert.ok(line, 'the NodeType line is in src/types/journey.ts');
  const fromType = [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...NODE_TYPES].sort(), [...fromType].sort());
  assert.equal(NODE_TYPES.length, 7);
  assert.deepEqual([...new Set(STEP_CHOICES.map((c) => c.type))].sort(), [...NODE_TYPES].sort(), 'the Add Step picker offers exactly these types');
  assert.ok(Object.isFrozen(NODE_TYPES));
});

test('ACTION_VIEWS is ActiveAppView in src/types/journey.ts, and the kinds are the three the plan names', () => {
  const line = read('./src/types/journey.ts').match(/^export type ActiveAppView = (.+);$/m);
  assert.ok(line);
  assert.deepEqual([...ACTION_VIEWS], [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...ACTION_KINDS], ['open', 'add-step', 'rename-journey']);
  assert.equal(ACTIONS_MAX, 3);
  assert.equal(NAME_MAX, 80);
  assert.equal(LABEL_JOURNEY_MAX, 60);
});

test('STEP_NAMES has one name per type, each the start of the card name stepShortName gives that type', () => {
  assert.deepEqual(Object.keys(STEP_NAMES).sort(), [...NODE_TYPES].sort());
  for (const type of NODE_TYPES) {
    // An unknown sequenceType reads as the plain "Follow-up sequence"; no address reads ", no address yet".
    const card = stepShortName({ type, sequenceType: 'not-a-kind' }).toLowerCase();
    assert.ok(card.startsWith(STEP_NAMES[type].toLowerCase()), `${type}: "${card}" does not start with "${STEP_NAMES[type]}"`);
  }
  assert.equal(STEP_NAMES['follow-up-sequence'], 'follow-up sequence');
});

test('the module is pure (no import at all) and carries no em dash or en dash', () => {
  const src = read('./server/assistantActions.mjs');
  assert.ok(!/^\s*import\s/m.test(src), 'no import statement');
  assert.ok(!src.includes(EM) && !src.includes(EN));
});

// ---- readReply ----

test('readReply: a JSON reply gives its answer and its checked actions; one leading and one trailing fence are stripped', () => {
  const body = JSON.stringify({ answer: 'Open Email Studio to write it.', actions: [open('email-studio')] });
  for (const text of [body, `\`\`\`json\n${body}\n\`\`\``, `\`\`\`\n${body}\n\`\`\``, `  ${body}  `, `\`\`\`json ${body}\`\`\``]) {
    const r = readReply(text, CANVAS, opts);
    assert.equal(r.format, 'json', text);
    assert.equal(r.answer, 'Open Email Studio to write it.');
    assert.deepEqual(r.actions, [{ kind: 'open', view: 'email-studio', label: 'Open Email Studio' }]);
  }
  // An object a caller already parsed reads the same.
  assert.deepEqual(readReply(JSON.parse(body), CANVAS, opts).actions, [{ kind: 'open', view: 'email-studio', label: 'Open Email Studio' }]);
});

test('readReply: a reply that is not JSON is the whole answer with no actions', () => {
  for (const text of ['Open Attribution to see where people leave.', 'Use {first_name} in the subject line.', 'Pick {one} or {two}.', '```\nnot json\n```', '{"answer": "cut short', 'Here: {"answer": 5}']) {
    const r = readReply(text, CANVAS, opts);
    assert.deepEqual(r, { answer: text.trim(), actions: [], format: 'text' }, text);
  }
});

test('readReply: any fence tag, a ~~~ fence, prose before the JSON and two objects in a row never show raw JSON', () => {
  const body = JSON.stringify({ answer: 'Open Email Studio.', actions: [open('email-studio')] });
  const wanted = { answer: 'Open Email Studio.', actions: [{ kind: 'open', view: 'email-studio', label: 'Open Email Studio' }], format: 'json' };
  for (const text of [
    `\`\`\`json5\n${body}\n\`\`\``,
    `\`\`\`JSON\n${body}\n\`\`\``,
    `\`\`\` js\n${body}\n\`\`\``,
    `~~~json\n${body}\n~~~`,
    `~~~\n${body}\n~~~`,
    `Sure, here it is:\n${body}`,
    `Sure:\n\`\`\`json\n${body}\n\`\`\`\nHope that helps.`,
    `${body}\n${JSON.stringify({ answer: 'A second object.', actions: [] })}`,
    `${body} trailing words {not json}`
  ]) {
    assert.deepEqual(readReply(text, CANVAS, opts), wanted, text);
  }
  // The span and the first object are used only when they carry an answer.
  assert.equal(readReply('Note {"x": 1} then {"answer": "Kept."}', CANVAS, opts).format, 'text');
});

test('readReply: the hub text is cut to REPLY_MAX_CHARS BEFORE it is parsed, and that cap is the hub cap', () => {
  assert.equal(REPLY_MAX_CHARS, MAX_HUB_ANSWER_CHARS);
  assert.equal(REPLY_MAX_CHARS, 64 * 1024);
  // An object whose end lies past the cap is never read whole: the text is the cut plain answer.
  const long = `{"answer": "${'x'.repeat(REPLY_MAX_CHARS)}", "actions": [{"kind": "open", "view": "canvas"}]}`;
  const r = readReply(long, CANVAS, opts);
  assert.equal(r.format, 'text');
  assert.deepEqual(r.actions, []);
  assert.equal(r.answer.length, REPLY_MAX_CHARS);
  // Under the cap the same shape is read.
  assert.equal(readReply(`{"answer": "${'x'.repeat(100)}"}`).format, 'json');
});

test('readReply: JSON without a non-empty string answer answers nothing, so the route says it could not read it', () => {
  for (const text of ['{"actions": [{"kind": "open", "view": "canvas"}]}', '{"answer": ""}', '{"answer": "   "}', '{"answer": 42}', '[]', '"just a string"', '42', 'null', 'true']) {
    const r = readReply(text, CANVAS, opts);
    assert.equal(r.answer, '', text);
    assert.deepEqual(r.actions, [], text);
  }
  for (const v of [undefined, null, 7, []]) assert.equal(readReply(v).answer, '');
});

test('readReply: the answer is handed back as the model wrote it; actions are read only from the actions field', () => {
  const r = readReply(JSON.stringify({ answer: `Done \u2014 see [1].`, actions: 'open the canvas', open: 'canvas' }), CANVAS, opts);
  assert.equal(r.answer, `Done \u2014 see [1].`, 'the route cleans and caps it');
  assert.deepEqual(r.actions, []);
});

// ---- readActions: the injection shapes ----

test('readActions: an unknown kind, an extra key, a wrong type or a value outside its list is dropped, never thrown', () => {
  const bad = [
    { kind: 'delete', journeyId: 'j1' },
    { kind: 'publish', journeyId: 'j1' },
    { kind: 'send' },
    { kind: 'notes', text: 'x' },
    { kind: 'Open', view: 'canvas' },
    { kind: 'open', view: 'admin' },
    { kind: 'open', view: 'public' },
    { kind: 'open', view: 1 },
    { kind: 'open' },
    { kind: 'open', view: 'canvas', label: 'Delete every journey' },
    { kind: 'open', view: 'canvas', journeyId: 'j1' },
    { kind: 'add-step', type: 'checkout', journeyId: 'j1' },
    { kind: 'add-step', type: 'Landing-Page', journeyId: 'j1' },
    { kind: 'add-step', type: ['landing-page'], journeyId: 'j1' },
    { kind: 'add-step', journeyId: 'j1' },
    { kind: 'add-step', type: 'landing-page' },
    { kind: 'add-step', type: 'landing-page', journeyId: 1 },
    { kind: 'add-step', type: 'landing-page', journeyId: 'j1', data: { headline: 'Free money' } },
    { kind: 'rename-journey', name: 7, journeyId: 'j1' },
    { kind: 'rename-journey', journeyId: 'j1' },
    { kind: 'rename-journey', name: 'Fine', journeyId: 'j1', label: 'Fine' },
    // JSON.parse makes "__proto__" an own key, so it is an extra key like any other.
    JSON.parse('{"kind": "open", "view": "canvas", "__proto__": {"label": "Delete"}}'),
    null, 'open', 7, [open('canvas')]
  ];
  assert.deepEqual(readActions(bad, CANVAS, opts), []);
  for (const raw of [undefined, null, 'open', { kind: 'open', view: 'canvas' }, 42]) assert.deepEqual(readActions(raw, CANVAS, opts), [], String(raw));
});

test('readActions: a journey action is kept only for the journey on the canvas; another journey, no journey or another view is dropped', () => {
  assert.deepEqual(readActions([add('landing-page', 'j2'), rename('New', 'j2'), add('lead-form', 'jB'), rename('X', '')], CANVAS, opts), []);
  for (const screen of [null, undefined, { view: 'canvas' }, { view: 'email-studio', journeyId: 'j1' }, { view: 'attribution', journeyId: 'j1' }, { view: 'public', journeyId: 'j1' }, { view: 'canvas', journeyId: 'x'.repeat(121) }]) {
    const kept = readActions([add('landing-page'), rename('New name'), open('canvas')], screen, opts);
    assert.deepEqual(kept.map((a) => a.kind), ['open'], JSON.stringify(screen));
  }
  const kept = readActions([add('landing-page'), rename('New name')], CANVAS, opts);
  assert.deepEqual(kept, [
    { kind: 'add-step', type: 'landing-page', journeyId: 'j1', label: 'Add a landing page step to Spring Glaze Sale' },
    { kind: 'rename-journey', name: 'New name', journeyId: 'j1', label: 'Rename this journey to "New name"' }
  ]);
});

test('readActions: a name is trimmed, 1 to 80 characters, with no control character', () => {
  const ok = (name) => readActions([rename(name)], CANVAS, opts).map((a) => a.name);
  assert.deepEqual(ok('  Spring sale  '), ['Spring sale']);
  assert.deepEqual(ok('x'.repeat(80)), ['x'.repeat(80)]);
  assert.deepEqual(ok('x'.repeat(81)), [], '81 characters is too long');
  assert.deepEqual(ok(`${'x'.repeat(79)}\u{1F600}`), [`${'x'.repeat(79)}\u{1F600}`], 'an emoji counts once');
  for (const name of ['', '   ', 'Line\nbreak', 'Tab\there', 'Bell\u0007', 'Null\u0000', 'Del\u007f', 'C1\u0085', 'Sep\u2028x', 'Rtl\u202eevil', 'Iso\u2066x']) {
    assert.deepEqual(ok(name), [], JSON.stringify(name));
  }
});

// One sample per refused class, each inside an otherwise good name and, where it can be, as the whole name.
const REFUSED_IN_NAMES = {
  'straight double quote': 'Spring "Sale"',
  'curly left quote': 'Spring \u201cSale',
  'curly right quote': 'Spring Sale\u201d',
  'low double quote': 'Spring \u201eSale',
  'fullwidth quote': 'Spring \uff02Sale',
  'double prime': 'Spring \u2033Sale',
  'tag character (U+E0041)': 'Spring\u{E0041}Sale',
  'tag cancel (U+E007F)': 'Spring\u{E007F}',
  'zero width space': 'Spring\u200bSale',
  'zero width joiner': 'Spring\u200dSale',
  'zero width non-joiner': 'Spring\u200cSale',
  'word joiner': 'Spring\u2060Sale',
  'byte order mark': '\ufeffSpring Sale',
  'left-to-right mark': 'Spring\u200eSale',
  'right-to-left mark': 'Spring\u200fSale',
  'Arabic letter mark': 'Spring\u061cSale',
  'soft hyphen': 'Spring\u00adSale',
  'Hangul filler U+3164': 'Spring \u3164',
  'halfwidth Hangul filler U+FFA0': 'Spring \uffa0',
  'Hangul choseong filler U+115F': 'Spring \u115f',
  'blank Braille pattern U+2800': 'Spring \u2800Sale',
  'private use': 'Spring \ue000',
  'lone surrogate': 'Spring \ud800',
  'paragraph separator': 'Spring\u2029Sale',
  'left-to-right override': 'Spring\u202dSale'
};

test('readJourneyName refuses every control, format, private use and surrogate character, the separators, the invisible fillers and every double quote', () => {
  for (const [what, name] of Object.entries(REFUSED_IN_NAMES)) {
    assert.equal(readJourneyName(name), '', what);
    assert.equal(readJourneyName(name, cleanModelStrings), '', `${what}, after the cleaner`);
    assert.deepEqual(readActions([rename(name)], CANVAS, opts), [], what);
  }
  for (const whole of ['\u3164', '\u2800', '\u00ad', '\u200b\u200b', '\uffa0', '\u115f\u1160', '\u{E0041}\u{E0042}']) {
    assert.equal(readJourneyName(whole), '', JSON.stringify(whole));
  }
});

test('readJourneyName needs a letter or a digit, and keeps an apostrophe, accents, digits and an emoji beside words', () => {
  for (const name of ['!!!', '---', '...', '\u2605', '\u{1F389}', '?', '   .   ']) assert.equal(readJourneyName(name), '', JSON.stringify(name));
  for (const name of ['Spring 2026', 'Caf\u00e9 cr\u00e8me', "Rosa's Funnel", 'Sale \u{1F389}', '2026', '\u6625\u306e\u30bb\u30fc\u30eb']) assert.equal(readJourneyName(name), name, name);
});

test('a quote in a proposed name cannot end the label\u2019s quotes: the whole action is dropped', () => {
  const breakout = 'Spring Glaze Sale" now publishes and emails all 1,200 contacts. Continue "';
  assert.deepEqual(readActions([rename(breakout)], CANVAS, opts), []);
  assert.deepEqual(readActions([rename('Spring Glaze Sale\u201d now emails everyone. \u201cOK')], CANVAS, opts), []);
  const kept = readActions([rename('Autumn launch')], CANVAS, opts);
  assert.equal(kept[0].label, 'Rename this journey to "Autumn launch"', 'the label carries the validated name');
});

test('readActions: a model dash in a proposed name is cleaned, and with no cleaner the name is dropped rather than shown', () => {
  assert.deepEqual(readActions([rename(`Spring \u2014 sale`)], CANVAS, opts).map((a) => a.name), ['Spring, sale']);
  assert.deepEqual(readActions([rename(`Spring \u2014 sale`)], CANVAS, { journeys: JOURNEYS }), []);
  assert.deepEqual(readActions([rename(`Spring ${EN} sale`)], CANVAS, { journeys: JOURNEYS }), []);
  assert.equal(readJourneyName(`a\u2014b`), '');
  assert.equal(readJourneyName('  Plain  '), 'Plain');
});

test('readActions: at most 3 kept, in order, and a repeat (same kind and values) is dropped before the cap', () => {
  const four = [open('canvas'), open('email-studio'), open('attribution'), add('landing-page')];
  assert.deepEqual(readActions(four, CANVAS, opts).map((a) => a.view ?? a.type), ['canvas', 'email-studio', 'attribution']);
  const repeats = [open('canvas'), open('canvas'), add('upsell'), add('upsell'), rename('A'), rename(' A ')];
  assert.deepEqual(readActions(repeats, CANVAS, opts).map((a) => a.kind), ['open', 'add-step', 'rename-journey']);
  const bad = [{ kind: 'delete' }, { kind: 'delete' }, { kind: 'delete' }, open('attribution')];
  assert.deepEqual(readActions(bad, CANVAS, opts).map((a) => a.view), ['attribution'], 'dropped items do not use up the three');
});

test('readActions: the label never carries model text; the journey name is the user\u2019s own', () => {
  const kept = readActions([add('ab-split')], { view: 'canvas', journeyId: 'j1', journeyName: 'Name the model chose' }, { journeys: [{ id: 'j1', name: 'Real Name' }] });
  assert.equal(kept[0].label, 'Add an A/B split step to Real Name');
  const meta = readActions([add('upsell')], CANVAS, { journeys: [{ id: 'j1', name: '', metadata: { name: 'From Metadata' } }] });
  assert.equal(meta[0].label, 'Add an upsell step to From Metadata');
  const none = readActions([add('thank-you')], CANVAS, { journeys: [] });
  assert.equal(none[0].label, 'Add a thank-you page step to this journey');
});

// ---- actionLabel ----

test('actionLabel: the open labels, the add-step sentence with the right article, the rename quote, and a long journey name cut to 60', () => {
  assert.equal(actionLabel(open('canvas')), 'Open the canvas');
  assert.equal(actionLabel(open('email-studio')), 'Open Email Studio');
  assert.equal(actionLabel(open('attribution')), 'Open attribution');
  const sentences = {
    'ad-source': 'Add a traffic source step to Spring',
    'landing-page': 'Add a landing page step to Spring',
    'lead-form': 'Add a lead form step to Spring',
    'follow-up-sequence': 'Add a follow-up sequence step to Spring',
    'thank-you': 'Add a thank-you page step to Spring',
    upsell: 'Add an upsell step to Spring',
    'ab-split': 'Add an A/B split step to Spring'
  };
  for (const [type, sentence] of Object.entries(sentences)) assert.equal(actionLabel(add(type), { journeyName: 'Spring' }), sentence, type);
  assert.equal(actionLabel(rename('Spring sale')), 'Rename this journey to "Spring sale"');
  const long = 'L'.repeat(61);
  const label = actionLabel(add('landing-page'), { journeyName: long });
  assert.equal(label, `Add a landing page step to ${'L'.repeat(59)}\u2026`);
  assert.equal(actionLabel(add('landing-page'), { journeyName: 'M'.repeat(60) }), `Add a landing page step to ${'M'.repeat(60)}`, 'sixty characters are kept whole');
  for (const a of [{ kind: 'delete' }, open('admin'), add('checkout'), rename(''), null, undefined]) assert.equal(actionLabel(a), '', JSON.stringify(a));
  for (const s of Object.values(sentences)) assert.ok(!s.includes(EM) && !/\s\u2013\s/.test(s));
});

// ---- Stored actions, checked again on read ----

test('no label is longer than LABEL_MAX: the longest of each kind is built and measured', () => {
  const longest = [
    actionLabel(rename('n'.repeat(NAME_MAX))),
    ...NODE_TYPES.map((type) => actionLabel(add(type), { journeyName: 'j'.repeat(500) })),
    ...ACTION_VIEWS.map((view) => actionLabel(open(view)))
  ];
  for (const label of longest) assert.ok(label.length <= LABEL_MAX, `${label.length}: ${label.slice(0, 40)}`);
  assert.equal(Math.max(...longest.map((l) => l.length)), 105, 'the longest is a rename to an 80 character name');
  assert.equal(LABEL_MAX, 120);
});

test('a journey name in a label loses the characters no label may hold, and only in the label', () => {
  const name = 'Spring\u200e \u202eGlaze\u00ad Sale';
  const [a] = readActions([add('upsell')], CANVAS, { journeys: [{ id: 'j1', name }] });
  assert.equal(a.label, 'Add an upsell step to Spring Glaze Sale');
});

test('relabelStoredActions: a stored label is never sent as stored; journey actions are rebuilt from the current list or dropped', () => {
  // The adversary's seeded document: a vocabulary action wearing another label.
  const seeded = [
    { kind: 'open', view: 'email-studio', label: 'Delete every journey in this workspace' },
    { kind: 'add-step', type: 'lead-form', journeyId: 'j1', label: 'Publish everything now' },
    { kind: 'rename-journey', name: 'Autumn launch', journeyId: 'j1', label: 'Email all contacts' }
  ];
  const now = [{ id: 'j1', name: 'Renamed Since' }];
  assert.deepEqual(relabelStoredActions(seeded, now), [
    { kind: 'open', view: 'email-studio', label: 'Open Email Studio' },
    { kind: 'add-step', type: 'lead-form', journeyId: 'j1', label: 'Add a lead form step to Renamed Since' },
    { kind: 'rename-journey', name: 'Autumn launch', journeyId: 'j1', label: 'Rename this journey to "Autumn launch"' }
  ]);
  // A journey that is gone, and a list that could not be read, keep only the open action.
  assert.deepEqual(relabelStoredActions(seeded, [{ id: 'other', name: 'Other' }]).map((a) => a.kind), ['open']);
  assert.deepEqual(relabelStoredActions(seeded, null).map((a) => a.kind), ['open']);
  // A stored rename these rules refuse today is dropped, whatever its label says.
  assert.deepEqual(relabelStoredActions([{ kind: 'rename-journey', name: 'Spring "Sale"', journeyId: 'j1', label: 'Rename' }], now), []);
  assert.deepEqual(relabelStoredActions([{ kind: 'rename-journey', name: 'Spring\u200b', journeyId: 'j1', label: 'Rename' }], now), []);
  for (const raw of [undefined, null, 'x', {}]) assert.deepEqual(relabelStoredActions(raw, now), []);
});

test('cleanStoredActions keeps what could have been built here and drops every other shape', () => {
  const good = [
    { kind: 'open', view: 'email-studio', label: 'Open Email Studio' },
    { kind: 'add-step', type: 'lead-form', journeyId: 'j1', label: 'Add a lead form step to Spring' },
    { kind: 'rename-journey', name: 'Spring sale', journeyId: 'j1', label: 'Rename this journey to "Spring sale"' }
  ];
  assert.deepEqual(cleanStoredActions(good), good);
  const bad = [
    { kind: 'open', view: 'email-studio' },
    { kind: 'open', view: 'email-studio', label: '' },
    { kind: 'open', view: 'email-studio', label: 7 },
    { kind: 'open', view: 'admin', label: 'Open admin' },
    { kind: 'open', view: 'canvas', label: 'x'.repeat(201) },
    { kind: 'open', view: 'canvas', label: 'Line\nbreak' },
    { kind: 'open', view: 'canvas', label: 'Open', extra: true },
    { kind: 'delete', journeyId: 'j1', label: 'Delete' },
    { kind: 'add-step', type: 'checkout', journeyId: 'j1', label: 'Add' },
    { kind: 'add-step', type: 'lead-form', journeyId: '', label: 'Add' },
    { kind: 'rename-journey', name: 'x'.repeat(81), journeyId: 'j1', label: 'Rename' },
    { kind: 'rename-journey', name: ' padded ', journeyId: 'j1', label: 'Rename' },
    null, 'open'
  ];
  assert.deepEqual(cleanStoredActions(bad), []);
  assert.deepEqual(cleanStoredActions([...good, good[0]]).length, 3, 'at most three');
  for (const raw of [undefined, null, {}, 'x']) assert.deepEqual(cleanStoredActions(raw), []);
});
