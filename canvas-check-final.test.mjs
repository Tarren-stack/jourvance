// #11 final (lane w5-final): the scenario rows for #7, #8, #12, #14 and #19, #19's keyboard checks
// called from npm run check:canvas as zero-only rules, the recorded baseline, and the product fixes
// the first full run asked for (header menus cut off at 768 and 390px, card label contrast, the
// React Flow attribution, the unnamed-role map controls, and the header's active colours).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuSide, MENU_GUTTER_PX } from './src/lib/menuPlacement.ts';
import { routeVerdict, ratchetVerdict, exitCode, formatReport, ZERO_ONLY_RULES, CHECK_RULES } from './src/lib/canvasCheckRules.ts';
import { contrastRatio, A11Y_RULES } from './src/lib/a11yRules.ts';
import { allowedRequest, CHECKS } from './scripts/a11y-browser-check.mjs';
import {
  SCENARIOS,
  KEYBOARD_RULES,
  CANVAS_KEYBOARD_CHECKS,
  keyboardRule,
  keyboardFindings,
  BROWSER_SAVE_RULES,
  browserRefusal,
  browserSaveProblems
} from './scripts/canvas-browser-check.mjs';
import { BROWSER_OUT_OF_SPACE, browserSaveOutcome } from './src/lib/saveOutcome.ts';
import { keepJourney } from './src/lib/journeyStorage.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = p => read(p).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const DASHES = /—| – /;
const hex = h => {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
};

// ---- Header menus ----

test('menuSide keeps a right-aligned menu when it fits on screen', () => {
  assert.equal(menuSide({ left: 1200, right: 1290 }, 220, 1440), 'right');
  assert.equal(menuSide({ left: 180, right: 228 + MENU_GUTTER_PX }, 220, 1440), 'right');
});

test('menuSide lines a menu up with the left edge when right alignment would run off the screen', () => {
  // The More button at 768px (the toolbar wrapped): right-aligned, the menu spanned -12 to 194px.
  assert.equal(menuSide({ left: 127, right: 201 }, 220, 768), 'left');
  // Add Step at 390px: right-aligned, it spanned -84 to 112px.
  assert.equal(menuSide({ left: 95, right: 196 }, 210, 390), 'left');
});

test('menuSide takes the side that loses less when neither fits', () => {
  assert.equal(menuSide({ left: 10, right: 60 }, 300, 320), 'left');
  assert.equal(menuSide({ left: 250, right: 300 }, 300, 320), 'right');
});

test('both header menus hang from the side menuSide picks, measured when they open', () => {
  const header = code('src/components/toolbar/CanvasHeader.tsx');
  assert.match(header, /import \{ menuSide \} from '\.\.\/\.\.\/lib\/menuPlacement'/);
  assert.match(header, /\[addMenuSide\]: 0/);
  assert.match(header, /\[moreMenuSide\]: 0/);
  assert.match(header, /setAddMenuSide\(sideFor\(addButtonRef\.current, ADD_MENU_WIDTH\)\)/);
  assert.match(header, /setMoreMenuSide\(sideFor\(moreButtonRef\.current, MORE_MENU_WIDTH\)\)/);
  assert.doesNotMatch(header, /top: '40px', right: 0/);
  assert.doesNotMatch(header, /top: '42px',\s*right: 0/);
});

// ---- Contrast fixes found by the first full run ----

test('card labels are #94A3B8, which reads at 4.5 to 1 on the dark card, not #64748B', () => {
  for (const f of ['AdNode', 'PageNode', 'FormNode', 'SequenceNode', 'ThankYouNode', 'UpsellNode', 'AbSplitNode']) {
    assert.doesNotMatch(read(`src/components/canvas/nodes/${f}.tsx`), /color: '#64748B'/, f);
  }
  assert.ok(contrastRatio(hex('#94A3B8'), hex('#0F172A')) >= 4.5);
  assert.ok(contrastRatio(hex('#64748B'), hex('#0F172A')) < 4.5, 'the old colour really failed');
});

test('white text on each active header colour reads at 4.5 to 1 or more', () => {
  const header = read('src/components/toolbar/CanvasHeader.tsx');
  const actives = [
    /activeView === 'canvas' \? '(#[0-9a-fA-F]{6})'/,
    /activeView === 'email-studio' \? '(#[0-9a-fA-F]{6})'/,
    /activeView === 'attribution' \? '(#[0-9a-fA-F]{6})'/,
    /canvasViewMode === 'roas' \? '(#[0-9a-fA-F]{6})'/,
    /isOp \? '(#[0-9a-fA-F]{6})'/,
    /isOp \? '#[0-9a-fA-F]{6}' : '(#[0-9a-fA-F]{6})'/
  ];
  for (const re of actives) {
    const m = re.exec(header);
    assert.ok(m, String(re));
    assert.ok(contrastRatio(hex('#FFFFFF'), hex(m[1])) >= 4.5, `${m[1]} is ${contrastRatio(hex('#FFFFFF'), hex(m[1])).toFixed(2)} to 1`);
  }
});

test('the React Flow attribution is a light link on a dark strip, and the map controls are a named group', () => {
  const css = read('src/index.css');
  assert.match(css, /\.react-flow \.react-flow__attribution \{\s*background: #0F172A;/);
  assert.match(css, /\.react-flow \.react-flow__attribution a \{\s*color: #CBD5E1;/);
  assert.ok(contrastRatio(hex('#CBD5E1'), hex('#0F172A')) >= 4.5);
  assert.match(code('src/components/canvas/JourneyCanvas.tsx'), /querySelector\('\.react-flow__controls'\)[\s\S]{0,120}setAttribute\('role', 'group'\)/);
});

// ---- The route guard #19's checks use ----

test("#19's route guard lets through exactly what #11's routeVerdict lets through", () => {
  const origin = 'http://127.0.0.1:4731';
  const urls = [
    `${origin}/assets/x.js`,
    `${origin}/canvas`,
    `${origin}/`,
    `${origin}/api/user/u/journey/j`,
    `${origin}/api`,
    `${origin}/p/slug`,
    `${origin}/pricing`,
    'http://localhost:3005/x',
    'http://localhost:4731/canvas',
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
    'https://fonts.googleapis.com/css2',
    'https://zeluslabs.dev/tracker.js',
    'not a url'
  ];
  for (const url of urls) {
    assert.equal(allowedRequest(url, origin), routeVerdict(url, origin) === 'continue', url);
  }
});

test('the #19 check script loads child_process only inside its own main()', () => {
  const src = code('scripts/a11y-browser-check.mjs');
  assert.doesNotMatch(src, /^import .*child_process/m);
  const dynamic = src.indexOf("await import('node:child_process')");
  assert.ok(dynamic > src.indexOf('async function main()'), 'the dynamic import sits in main()');
});

// ---- Scenario rows for later items ----

test('SCENARIOS keeps the nine #11 rows and adds one per later item', () => {
  const ids = SCENARIOS.map(s => s.id);
  assert.deepEqual(ids.slice(0, 9), ['canvas', 'more-menu', 'add-step-menu', 'step-selected', 'line-selected', 'live-roas', 'audit-drawer', 'forecaster-drawer', 'save-failed']);
  const browserSave = ['browser-save-full', 'browser-save-refused'];
  for (const id of ['step-finder', 'undo-ready', ...browserSave, 'step-picker', 'tidied', 'focus-returned']) {
    const row = SCENARIOS.find(s => s.id === id);
    assert.ok(row, id);
    assert.deepEqual(row.sections, browserSave.includes(id) ? ['save', 'overflow', 'a11y'] : ['overflow', 'a11y'], id);
    assert.equal(typeof row.open, 'function', id);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(SCENARIOS.find(s => s.id === 'browser-save-full').storageFails, 'QuotaExceededError');
  assert.equal(SCENARIOS.find(s => s.id === 'browser-save-refused').storageFails, 'SecurityError');
});

// ---- T01: a browser that refuses the save, judged by what saveOutcome.ts says today ----

/** keepJourney run in a browser whose every write throws a DOMException of this name. */
function keepWithRefusal(name) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const quiet = console.error;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: () => { throw new DOMException('refused', name); }, getItem: () => null, removeItem: () => {} }
  });
  console.error = () => {};
  try {
    return keepJourney({ id: 'j-check', name: 'Check', nodes: [], edges: [], updatedAt: '2026-01-01T00:00:00.000Z' });
  } finally {
    console.error = quiet;
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
}

test('each storage-refusal row throws the error the app reads as the refusal the row expects', () => {
  // The rows are the only thing tying a thrown DOMException to a banner. A row that threw a quota
  // error while expecting the blocked sentence waited for text the app never shows (T01).
  const rows = SCENARIOS.filter(s => s.storageFails);
  assert.deepEqual(rows.map(r => r.full).sort(), [false, true], 'both refusal kinds are covered');
  for (const row of rows) {
    assert.equal(typeof row.storageFails, 'string', `${row.id} names the DOMException it throws`);
    assert.equal(typeof row.full, 'boolean', row.id);
    assert.ok(row.sections.includes('save'), `${row.id} is judged under save`);
    assert.equal(typeof row.probe, 'function', row.id);
    assert.deepEqual(keepWithRefusal(row.storageFails), { kept: false, full: row.full }, row.id);
  }
});

test('the refusal the check expects is the one saveOutcome.ts gives, never a copy of it', () => {
  assert.equal(browserRefusal(true).message, BROWSER_OUT_OF_SPACE);
  assert.deepEqual(browserRefusal(true), browserSaveOutcome(false, '', true));
  assert.deepEqual(browserRefusal(false), browserSaveOutcome(false, '', false));
  assert.equal(browserRefusal(true).action, 'open-library');
  assert.notEqual(browserRefusal(true).message, browserRefusal(false).message);
  // No four words in a row of either sentence may be written into the harness's code: a copied
  // sentence (the old /would not store the journey/ wait) goes stale the day saveOutcome.ts is reworded.
  const src = read('scripts/canvas-browser-check.mjs')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\/\*\*|\*)/.test(l))
    .join('\n')
    .toLowerCase();
  for (const full of [true, false]) {
    const words = browserRefusal(full).message.toLowerCase().replace(/[.,]/g, '').split(/\s+/);
    for (let i = 0; i + 4 <= words.length; i++) {
      const run = words.slice(i, i + 4).join(' ');
      assert.ok(!src.includes(run), `the harness copies "${run}" from saveOutcome.ts; import the sentence instead`);
    }
  }
  assert.match(src, /import \{[^}]*\bbrowser_out_of_space\b[^}]*\bbrowsersaveoutcome\b[^}]*\} from '\.\.\/src\/lib\/saveoutcome\.ts'/);
});

const refusalFacts = (full, extra = {}) => {
  const expected = browserRefusal(full);
  return {
    full,
    found: true,
    alertText: `${expected.message}${full ? 'Open journeys' : ''}Dismiss`,
    statusText: full ? 'Out of space' : 'Not saved',
    buttons: full ? ['Open journeys', 'Dismiss'] : ['Dismiss'],
    libraryOpened: full ? true : null,
    leaveWarned: true,
    ...extra
  };
};
const rulesOf = problems => problems.map(p => p.rule);

test('browserSaveProblems passes both refusals as the app shows them today', () => {
  assert.deepEqual(browserSaveProblems(refusalFacts(true)), []);
  assert.deepEqual(browserSaveProblems(refusalFacts(false)), []);
});

test('browserSaveProblems names a banner that says the other refusal, or nothing', () => {
  // The T01 state: a full browser checked against the blocked sentence, and the other way round.
  const blockedText = browserRefusal(false).message;
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(true, { found: false, alertText: `${blockedText}Dismiss`, buttons: [] }))), ['save-browser-message']);
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(false, { found: false, alertText: `${BROWSER_OUT_OF_SPACE}Open journeysDismiss`, buttons: [] }))), ['save-browser-message']);
  const none = browserSaveProblems(refusalFacts(true, { found: false, alertText: null, buttons: [], libraryOpened: null }));
  assert.deepEqual(rulesOf(none), ['save-browser-message']);
  assert.match(none[0].detail, /No alert showed\./);
});

test('browserSaveProblems wants Open journeys only when the browser is full, and Try again never', () => {
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(true, { buttons: ['Dismiss'], libraryOpened: null }))), ['save-browser-action']);
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(true, { libraryOpened: false }))), ['save-browser-action']);
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(false, { buttons: ['Open journeys', 'Dismiss'] }))), ['save-browser-action']);
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(false, { buttons: ['Try again', 'Dismiss'] }))), ['save-browser-retry']);
  assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(true, { buttons: ['Open journeys', 'Try again', 'Dismiss'] }))), ['save-browser-retry']);
});

test('browserSaveProblems wants the leave warning and no saved claim for either refusal', () => {
  for (const full of [true, false]) {
    assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(full, { leaveWarned: false }))), ['save-browser-leave']);
    assert.deepEqual(rulesOf(browserSaveProblems(refusalFacts(full, { statusText: 'Saved in this browser' }))), ['save-browser-claimed']);
  }
});

test('the browser-save rules are zero-only save rules the ratchet knows', () => {
  for (const rule of BROWSER_SAVE_RULES) {
    assert.match(rule, /^save-browser-[a-z]+$/);
    assert.ok(!CHECK_RULES.includes(rule) && !KEYBOARD_RULES.includes(rule), `${rule} collides`);
  }
  const src = code('scripts/canvas-browser-check.mjs');
  assert.match(src, /const zeroOnly = \[\.\.\.ZERO_ONLY_RULES, \.\.\.KEYBOARD_RULES, \.\.\.BROWSER_SAVE_RULES\];/);
  assert.match(src, /knownRules: \[\.\.\.CHECK_RULES, \.\.\.A11Y_RULES, \.\.\.KEYBOARD_RULES, \.\.\.BROWSER_SAVE_RULES\]/);
  assert.match(src, /result\.browserSave \? browserSaveProblems\(result\.browserSave\) : saveProblems\(result\.save\)/);
  const baseline = JSON.parse(read('scripts/canvas-browser-check.baseline.json'));
  for (const rule of BROWSER_SAVE_RULES) assert.ok(!(rule in baseline), `${rule} can never be baselined`);
});

test('the scenario rows reach the features by their real names', () => {
  const src = code('scripts/canvas-browser-check.mjs');
  // The Audit button has been "Check design" since #10; the old name opened nothing.
  assert.doesNotMatch(src, /Pre-Flight Funnel Audit/);
  assert.match(src, /button\[aria-label\^="Check design"\]/);
  assert.match(src, /#jv-step-search/);
  assert.match(src, /button\[aria-label="Undo"\]\[aria-disabled="false"\]/);
  assert.match(src, /button\[aria-label\^="Add a step after"\]/);
  assert.match(src, /'Tidy layout'/);
  assert.match(src, /Storage\.prototype\.setItem = function/);
  // The row's DOMException name reaches the page: coerced to a boolean, the blocked row threw a quota error.
  assert.match(src, /storageFails: scenario\.storageFails \?\? false/);
  assert.match(src, /throw new DOMException\(`[^`]*`, name\)/);
});

test('a control covered by something that scrolls with it is not excused by the page scrolling', () => {
  // A 390px page scrolls down, which used to mark every control revealable, so a toolbar button
  // drawn over Undo passed. Scrolling cannot move a control out from under a cover in the same
  // scroll box, so the collector tells the judge nothing can reveal it.
  const src = code('scripts/canvas-browser-check.mjs');
  assert.match(src, /const scrollerOf = node =>/);
  assert.match(src, /const pinned = \(node, scroller\) =>/);
  assert.match(src, /scroller === scrollerOf\(cover\) && !pinned\(cover, scroller\) && !pinned\(el, scroller\)\) revealable = \{ x: false, y: false \}/);
});

// ---- #19's checks as zero-only rules ----

test('every #19 check has a zero-only rule named a11y-<check>, and no id collides', () => {
  // #19's checks plus the ones this harness runs itself (C05's keyboardMove, C01's blueprintLayout).
  assert.equal(KEYBOARD_RULES.length, Object.keys(CHECKS).length + Object.keys(CANVAS_KEYBOARD_CHECKS).length);
  assert.ok(KEYBOARD_RULES.includes('a11y-keyboard-move'));
  assert.equal(keyboardRule('stepRoundTrip'), 'a11y-step-round-trip');
  assert.equal(keyboardRule('modalTrap'), 'a11y-modal-trap');
  for (const r of KEYBOARD_RULES) {
    assert.match(r, /^a11y-[a-z-]+$/);
    assert.ok(!A11Y_RULES.includes(r) && !CHECK_RULES.includes(r), r);
  }
});

test('keyboardFindings keeps each line apart, reads a width it names, and a thrown check did not run', () => {
  const out = keyboardFindings({ stepNames: ['a', 'b'], stepRoundTrip: ['390px: Escape did not close the step panel'], labels: [], modalTrap: { error: 'boom' } });
  assert.equal(out.findings.length, 3);
  assert.deepEqual(out.findings.map(f => f.rule), ['a11y-step-names', 'a11y-step-names', 'a11y-step-round-trip']);
  assert.deepEqual(out.findings.map(f => f.viewport), ['1440', '1440', '390']);
  assert.ok(out.findings.every(f => f.section === 'a11y' && !DASHES.test(f.detail)));
  assert.deepEqual(out.notRun, ['#19 modalTrap check could not run: boom']);
});

test('a #19 finding fails the run and can never be baselined', () => {
  const zeroOnly = [...ZERO_ONLY_RULES, ...KEYBOARD_RULES];
  const known = [...CHECK_RULES, ...A11Y_RULES, ...KEYBOARD_RULES];
  const baseline = { 'a11y-modal-trap': { count: 1, owner: '#19 Accessibility pass' } };
  const verdict = ratchetVerdict({ 'a11y-modal-trap': 1 }, baseline, zeroOnly, { knownRules: known });
  assert.deepEqual(verdict.forbidden.map(f => f.rule), ['a11y-modal-trap']);
  const finding = { section: 'a11y', rule: 'a11y-modal-trap', where: 'Escape did not close the Audit', detail: 'x', viewport: '1440', scenario: '#19 modalTrap', viewports: ['1440'], scenarios: ['#19 modalTrap'] };
  const clean = { over: [], stale: [], forbidden: [] };
  const all = ['overflow', 'drawers', 'save', 'a11y', 'runtime'];
  assert.equal(exitCode({ requested: all, ran: all, controlsFailed: false, verdict: clean, findings: [finding], zeroOnly }), 1);
  const report = formatReport({ requested: all, ran: all, findings: [finding], verdict: clean, baseline: {}, zeroOnly });
  assert.match(report, /a11y \(hand-written rules, not axe\): FAIL 1 finding/);
});

test('the harness hands the #19 rules to the ratchet, the report and the exit code', () => {
  const src = code('scripts/canvas-browser-check.mjs');
  assert.match(src, /const zeroOnly = \[\.\.\.ZERO_ONLY_RULES, \.\.\.KEYBOARD_RULES[,\]]/);
  assert.match(src, /ratchetVerdict\(counts, baseline, zeroOnly, \{ knownRules: \[\.\.\.CHECK_RULES, \.\.\.A11Y_RULES, \.\.\.KEYBOARD_RULES[,\]]/);
  assert.match(src, /formatReport\(\{ requested, ran, findings, verdict, baseline, zeroOnly \}\)/);
  assert.match(src, /exitCode\(\{ requested, ran, controlsFailed: false, verdict, findings, zeroOnly \}\)/);
  assert.match(src, /runA11yChecks\(browser, \{\s*base: origin/);
  // runControls still comes before every scenario and every #19 check.
  assert.ok(src.indexOf('await runControls(browser)') < src.indexOf('await runA11yChecks('));
  assert.doesNotMatch(src, DASHES);
});

// ---- The recorded baseline ----

test('the baseline exists, holds no zero-only or #19 rule, and every entry names its owning item', () => {
  const baseline = JSON.parse(read('scripts/canvas-browser-check.baseline.json'));
  for (const [rule, entry] of Object.entries(baseline)) {
    assert.ok([...A11Y_RULES, ...CHECK_RULES].includes(rule), `${rule} is a real rule`);
    assert.ok(!ZERO_ONLY_RULES.includes(rule) && !KEYBOARD_RULES.includes(rule), `${rule} can never be baselined`);
    assert.ok(Number.isInteger(entry.count) && entry.count >= 1, rule);
    assert.match(entry.owner, /#\d+/, rule);
  }
});
