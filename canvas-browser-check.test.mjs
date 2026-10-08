import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_RULES,
  CHECK_VIEWPORTS,
  LAYOUT_NEGATIVE_CONTROL,
  LAYOUT_POSITIVE_CONTROL,
  SAVE_RULES,
  SIGNED_IN_FAILURE,
  ZERO_ONLY_RULES,
  countByRule,
  dedupeFindings,
  drawerProblems,
  exitCode,
  findingKey,
  firebaseApiKeyFrom,
  formatReport,
  isSavedClaim,
  layoutProblems,
  pageErrorProblems,
  ratchetVerdict,
  routeVerdict,
  saveProblems,
  signedInUserFixture
} from './src/lib/canvasCheckRules.ts';
import { A11Y_RULES } from './src/lib/a11yRules.ts';

// The judging half of npm run check:canvas (#11). scripts/canvas-browser-check.mjs drives real
// Chrome and only collects facts; these tests drive every judge, the fixture user, the ratchet and
// the exit code with facts written by hand, and pin the safety rules in the harness's source.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts', 'canvas-browser-check.mjs');
const BASELINE = path.join(ROOT, 'scripts', 'canvas-browser-check.baseline.json');
const ORIGIN = 'http://127.0.0.1:4555';
const rules = list => list.map(f => f.rule);
const DASHES = /—| – /;

// ---- routeVerdict ----

test('routeVerdict lets only the preview files through', () => {
  assert.equal(routeVerdict(`${ORIGIN}/assets/x.js`, ORIGIN), 'continue');
  assert.equal(routeVerdict(`${ORIGIN}/canvas`, ORIGIN), 'continue');
  for (const url of [
    `${ORIGIN}/api/user/u/journey/j`,
    `${ORIGIN}/p/slug`,
    'http://localhost:3005/x',
    'http://127.0.0.1:3005/api/user/u/journey/j',
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
    'https://fonts.googleapis.com/css2',
    'https://zeluslabs.dev/tracker.js',
    'not a url'
  ]) {
    assert.equal(routeVerdict(url, ORIGIN), 'abort', url);
  }
  // A path that only starts with the letters is not the API.
  assert.equal(routeVerdict(`${ORIGIN}/apiary.png`, ORIGIN), 'continue');
});

// ---- layoutProblems ----

const layout = (over = {}) => ({ viewport: { width: 390, height: 844 }, scrollWidths: { documentElement: 390, body: 390 }, controls: [], clippedBoxes: [], ...over });
const control = (over = {}) => ({
  where: 'button "Save" #1 in journey toolbar',
  rect: { left: 380, top: 10, right: 440, bottom: 40 },
  clipped: { x: false, y: false },
  revealable: { x: false, y: false },
  inPannableCanvas: false,
  ...over
});

test('page-scroll fires at 391 on a 390 screen and not at 390', () => {
  assert.deepEqual(rules(layoutProblems(layout({ scrollWidths: { documentElement: 390, body: 392 } }))), ['page-scroll']);
  assert.deepEqual(rules(layoutProblems(layout({ scrollWidths: { documentElement: 392, body: 390 } }))), ['page-scroll']);
  assert.deepEqual(layoutProblems(layout({ scrollWidths: { documentElement: 391, body: 390 } })), []);
  assert.deepEqual(layoutProblems(layout()), []);
});

test('a control from 380 to 440 on a 390 screen is off screen unless it can be revealed', () => {
  assert.deepEqual(rules(layoutProblems(layout({ controls: [control()] }))), ['control-off-screen']);
  assert.deepEqual(layoutProblems(layout({ controls: [control({ revealable: { x: true, y: false } })] })), []);
  assert.deepEqual(layoutProblems(layout({ controls: [control({ inPannableCanvas: true })] })), []);
  const inside = control({ rect: { left: 300, top: 10, right: 360, bottom: 40 } });
  assert.deepEqual(layoutProblems(layout({ controls: [inside] })), []);
  assert.deepEqual(rules(layoutProblems(layout({ controls: [{ ...inside, clipped: { x: true, y: false } }] }))), ['control-off-screen']);
  assert.deepEqual(rules(layoutProblems(layout({ controls: [{ ...inside, rect: { left: 300, top: 830, right: 360, bottom: 870 } }] }))), ['control-off-screen']);
});

test('a control covered in its own layer cannot be pressed either', () => {
  // A toolbar squeezed onto one row stacks its buttons on top of each other without leaving the screen.
  const inside = control({ rect: { left: 20, top: 150, right: 90, bottom: 180 } });
  const found = layoutProblems(layout({ controls: [{ ...inside, coveredBy: 'input[text] "Journey name" #1 in journey toolbar' }] }));
  assert.deepEqual(rules(found), ['control-off-screen']);
  assert.match(found[0].detail, /covered by input\[text\] "Journey name"/);
  assert.deepEqual(layoutProblems(layout({ controls: [{ ...inside, coveredBy: null }] })), []);
  assert.deepEqual(layoutProblems(layout({ controls: [{ ...inside, coveredBy: 'div "Export CSV" #1', revealable: { x: false, y: true } }] })), []);
  assert.deepEqual(layoutProblems(layout({ controls: [{ ...inside, coveredBy: 'x', inPannableCanvas: true }] })), []);
});

test('content-clipped fires on a nowrap box hiding 46px and not with an ellipsis', () => {
  const box = { where: 'div #1 in "Funnel Economics & ROAS Forecaster" drawer', hiddenPx: 46, hides: 'text', ellipsis: false };
  const found = layoutProblems(layout({ clippedBoxes: [box] }));
  assert.deepEqual(rules(found), ['content-clipped']);
  assert.match(found[0].detail, /46px/);
  assert.deepEqual(layoutProblems(layout({ clippedBoxes: [{ ...box, ellipsis: true }] })), []);
});

test('the layout controls plant one example per rule and a negative snippet', () => {
  assert.deepEqual(LAYOUT_POSITIVE_CONTROL.map(c => c.rule), ['page-scroll', 'control-off-screen', 'control-off-screen', 'content-clipped']);
  assert.match(LAYOUT_NEGATIVE_CONTROL, /text-overflow:ellipsis/);
  assert.match(LAYOUT_NEGATIVE_CONTROL, /overflow-x:auto/);
  assert.match(LAYOUT_NEGATIVE_CONTROL, /react-flow__viewport/);
});

// ---- drawerProblems ----

const styledDrawer = (over = {}) => ({
  name: 'Pre-Flight Funnel Audit',
  found: true,
  stylesheetRule: true,
  viewport: { width: 390, height: 844 },
  root: { position: 'fixed', rect: { left: 0, top: 0, right: 390, bottom: 844 }, backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  panel: { display: 'flex', flexDirection: 'column', backgroundColor: 'rgb(15, 23, 42)', rect: { left: 0, top: 0, right: 390, bottom: 844 } },
  closes: true,
  ...over
});

test('a styled drawer passes', () => {
  assert.deepEqual(drawerProblems(styledDrawer()), []);
});

test('an unstyled drawer fails stylesheet, overlay and panel', () => {
  const unstyled = styledDrawer({
    stylesheetRule: false,
    root: { position: 'static', rect: { left: 0, top: 0, right: 390, bottom: 300 }, backgroundColor: 'rgba(0, 0, 0, 0)' },
    panel: { display: 'block', flexDirection: 'row', backgroundColor: 'rgba(0, 0, 0, 0)', rect: { left: 0, top: 0, right: 390, bottom: 300 } }
  });
  assert.deepEqual(rules(drawerProblems(unstyled)), ['drawer-stylesheet', 'drawer-overlay', 'drawer-panel']);
});

test('drawer-close and drawer-missing', () => {
  assert.deepEqual(rules(drawerProblems(styledDrawer({ closes: false }))), ['drawer-close']);
  assert.deepEqual(drawerProblems(styledDrawer({ closes: null })), []);
  assert.deepEqual(rules(drawerProblems(styledDrawer({ found: false, root: null, panel: null }))), ['drawer-missing']);
  // A translucent panel is not a panel.
  const glass = styledDrawer();
  glass.panel = { ...glass.panel, backgroundColor: 'rgba(15, 23, 42, 0.9)' };
  assert.deepEqual(rules(drawerProblems(glass)), ['drawer-panel']);
});

// ---- saveProblems and isSavedClaim ----

const MESSAGE = 'Not saved because the server could not be reached. Your changes are kept in this browser. Check your connection and try again.';
const happySave = (over = {}) => ({
  signedIn: true,
  postsAttempted: 1,
  alertText: `${MESSAGE}Try againDismiss`,
  expectedMessage: MESSAGE,
  statusText: 'Not saved',
  statusLog: ['Saving…', 'Not saved'],
  retryOffered: true,
  retryPosts: 1,
  keptName: 'Browser check journey',
  expectedName: 'Browser check journey',
  dismissed: true,
  ...over
});

test('the happy save facts yield nothing', () => {
  assert.deepEqual(saveProblems(happySave()), []);
});

test('each of the nine save rules fires on its broken fact', () => {
  const cases = {
    'save-signed-in': { signedIn: false },
    'save-not-attempted': { postsAttempted: 0 },
    'save-failure-hidden': { alertText: 'Something went wrong' },
    'save-status': { statusText: 'Unsaved changes' },
    'save-claimed': { statusLog: ['Saving…', 'Saved'] },
    'save-no-retry': { retryOffered: false },
    'save-retry-idle': { retryPosts: 0 },
    'save-not-kept': { keptName: 'Lead Capture Funnel' },
    'save-dismiss': { dismissed: false }
  };
  assert.deepEqual(Object.keys(cases), [...SAVE_RULES]);
  for (const [rule, broken] of Object.entries(cases)) {
    assert.deepEqual(rules(saveProblems(happySave(broken))), [rule], rule);
  }
});

test('a user who did not sign in fails the save section with the named sentence and nothing else', () => {
  const found = saveProblems(happySave({ signedIn: false, postsAttempted: 0, alertText: null }));
  assert.deepEqual(found.map(f => f.detail), [SIGNED_IN_FAILURE]);
  assert.equal(SIGNED_IN_FAILURE, 'The test user did not sign in, so the failed save was not checked.');
});

test('a status that says Saved on a failed save is save-claimed, wherever it shows', () => {
  assert.deepEqual(rules(saveProblems(happySave({ statusText: 'Saved', statusLog: [] }))), ['save-status', 'save-claimed']);
  assert.ok(rules(saveProblems(happySave({ statusLog: ['Saved in this browser'] }))).includes('save-claimed'));
});

test('isSavedClaim is true only for a status that starts with Saved', () => {
  for (const t of ['Saving…', 'Not saved', 'Unsaved changes', '', null]) assert.equal(isSavedClaim(t), false, String(t));
  for (const t of ['Saved', 'Saved in this browser', 'Saved, not backed up', '  Saved ']) assert.equal(isSavedClaim(t), true, t);
  assert.equal(isSavedClaim('saved'), false);
  assert.deepEqual(saveProblems(happySave({ statusLog: ['Saving…', 'Not saved'] })), []);
});

test('page-error findings carry the first line of the message', () => {
  const found = pageErrorProblems(['TypeError: x is undefined\n    at foo']);
  assert.deepEqual(found, [{ rule: 'page-error', where: 'page', detail: 'The page threw an error: TypeError: x is undefined' }]);
});

// ---- The fixture user ----

test('signedInUserFixture is what UserImpl._fromJSON accepts', () => {
  const now = 1_700_000_000_000;
  const { key, value } = signedInUserFixture('AIzaTest', now);
  assert.equal(key, 'firebase:authUser:AIzaTest:[DEFAULT]');
  // The asserts @firebase/auth 1.13 makes in UserImpl._fromJSON and StsTokenManager.fromJSON.
  assert.equal(typeof value.uid, 'string');
  assert.ok(value.uid);
  assert.equal(typeof value.emailVerified, 'boolean');
  assert.equal(typeof value.isAnonymous, 'boolean');
  assert.equal(typeof value.createdAt, 'string');
  assert.equal(typeof value.lastLoginAt, 'string');
  assert.equal(typeof value.email, 'string');
  assert.ok(Array.isArray(value.providerData));
  assert.equal(typeof value.stsTokenManager.refreshToken, 'string');
  assert.equal(typeof value.stsTokenManager.accessToken, 'string');
  assert.equal(typeof value.stsTokenManager.expirationTime, 'number');
  assert.ok(value.stsTokenManager.expirationTime > now + 30000);
  assert.equal(value.apiKey, 'AIzaTest');
  assert.equal(value.appName, '[DEFAULT]');
  assert.match(value.email, /browser-check/);
  // It must survive the trip through localStorage.
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

test('firebaseApiKeyFrom reads the key from src/lib/firebase.ts and answers null without one', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/lib/firebase.ts'), 'utf8');
  assert.match(firebaseApiKeyFrom(source), /^AIza/);
  assert.equal(firebaseApiKeyFrom("const c = { apiKey: 'AIzaSingle' };"), 'AIzaSingle');
  assert.equal(firebaseApiKeyFrom('const c = { projectId: "x" };'), null);
  assert.equal(firebaseApiKeyFrom(''), null);
});

// ---- Dedupe, ratchet and exit ----

const finding = (over = {}) => ({ section: 'a11y', rule: 'label', where: 'input[range] #1 in "Funnel Economics & ROAS Forecaster" drawer', detail: 'x', viewport: '390', scenario: 'forecaster-drawer', ...over });

test('dedupe keeps distinct ordinals apart and merges one element seen at two widths', () => {
  const two = dedupeFindings([finding(), finding({ where: finding().where.replace('#1', '#2') })]);
  assert.equal(two.length, 2);
  const one = dedupeFindings([finding(), finding({ viewport: '1440' })]);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].viewports, ['390', '1440']);
  assert.equal(findingKey(finding()), 'a11y|label|input[range] #1 in "Funnel Economics & ROAS Forecaster" drawer');
  assert.deepEqual(countByRule(two), { label: 2 });
});

test('ratchetVerdict: above is over, below is stale, forbidden entries are refused', () => {
  const known = [...CHECK_RULES, ...A11Y_RULES];
  const baseline = { label: { count: 11, owner: '#19 Accessibility pass' } };
  assert.deepEqual(ratchetVerdict({ label: 11 }, baseline, ZERO_ONLY_RULES, { knownRules: known }), { over: [], stale: [], forbidden: [] });
  assert.deepEqual(ratchetVerdict({ label: 12 }, baseline, ZERO_ONLY_RULES, { knownRules: known }).over, [{ rule: 'label', count: 12, allowed: 11 }]);
  assert.deepEqual(ratchetVerdict({ label: 10 }, baseline, ZERO_ONLY_RULES, { knownRules: known }).stale, [{ rule: 'label', count: 10, allowed: 11 }]);
  assert.deepEqual(ratchetVerdict({}, baseline, ZERO_ONLY_RULES, { knownRules: known }).stale, [{ rule: 'label', count: 0, allowed: 11 }]);
  // A rule with no entry is over at its first finding.
  assert.deepEqual(ratchetVerdict({ 'button-name': 1 }, {}, ZERO_ONLY_RULES, { knownRules: known }).over, [{ rule: 'button-name', count: 1, allowed: 0 }]);
  // A partial run sees fewer elements: it can go over but is never stale.
  assert.deepEqual(ratchetVerdict({ label: 3 }, baseline, ZERO_ONLY_RULES, { knownRules: known, partial: true }).stale, []);
  // A section that did not run is not stale either.
  assert.deepEqual(ratchetVerdict({}, baseline, ZERO_ONLY_RULES, { knownRules: known, ranSections: ['save', 'runtime'] }).stale, []);

  const forbidden = rule => ratchetVerdict({}, rule, ZERO_ONLY_RULES, { knownRules: known }).forbidden.map(f => f.rule);
  assert.deepEqual(forbidden({ 'save-claimed': { count: 1, owner: '#8' } }), ['save-claimed']);
  assert.deepEqual(forbidden({ 'made-up-rule': { count: 1, owner: '#19' } }), ['made-up-rule']);
  assert.deepEqual(forbidden({ label: { count: 3 } }), ['label']);
  assert.deepEqual(forbidden({ label: { count: 3, owner: 'somebody' } }), ['label']);
  assert.deepEqual(forbidden({ label: { count: 0, owner: '#19' } }), ['label']);
  assert.deepEqual(forbidden({ label: { count: 1.5, owner: '#19' } }), ['label']);
  // An accessibility id is unknown unless the caller names the accessibility rules.
  assert.deepEqual(ratchetVerdict({}, baseline, ZERO_ONLY_RULES).forbidden.map(f => f.rule), ['label']);
});

test('zero-only rules cover page-scroll, control-off-screen, every drawer and save rule, and page-error', () => {
  for (const rule of ['page-scroll', 'control-off-screen', 'page-error']) assert.ok(ZERO_ONLY_RULES.includes(rule), rule);
  for (const rule of CHECK_RULES.filter(r => r.startsWith('drawer-') || r.startsWith('save-'))) assert.ok(ZERO_ONLY_RULES.includes(rule), rule);
  assert.ok(!ZERO_ONLY_RULES.includes('content-clipped'));
  for (const rule of A11Y_RULES) assert.ok(!ZERO_ONLY_RULES.includes(rule), rule);
});

test('exitCode: 2 for a missing section or a failed control, 1 for findings, 0 when clean', () => {
  const clean = { over: [], stale: [], forbidden: [] };
  const base = { requested: ['overflow', 'runtime'], ran: ['overflow', 'runtime'], controlsFailed: false, verdict: clean, findings: [] };
  assert.equal(exitCode(base), 0);
  assert.equal(exitCode({ ...base, ran: ['runtime'] }), 2);
  assert.equal(exitCode({ ...base, controlsFailed: true }), 2);
  assert.equal(exitCode({ ...base, verdict: { ...clean, over: [{ rule: 'label', count: 2, allowed: 1 }] } }), 1);
  assert.equal(exitCode({ ...base, verdict: { ...clean, stale: [{ rule: 'label', count: 0, allowed: 1 }] } }), 1);
  assert.equal(exitCode({ ...base, verdict: { ...clean, forbidden: [{ rule: 'save-claimed', reason: 'x' }] } }), 1);
  assert.equal(exitCode({ ...base, findings: [{ rule: 'page-scroll' }] }), 1);
  // A finding held by the baseline is not a failure.
  assert.equal(exitCode({ ...base, findings: [{ rule: 'label' }] }), 0);
});

test('formatReport: PASS when clean, KNOWN with owners when held, and the a11y line says not axe', () => {
  const baseline = { label: { count: 1, owner: '#19 Accessibility pass' } };
  const findings = dedupeFindings([finding()]);
  const report = formatReport({
    requested: ['overflow', 'drawers', 'save', 'a11y', 'runtime'],
    ran: ['overflow', 'drawers', 'save', 'a11y', 'runtime'],
    findings,
    verdict: { over: [], stale: [], forbidden: [] },
    baseline
  });
  assert.match(report, /^overflow: PASS$/m);
  assert.match(report, /^a11y \(hand-written rules, not axe\): KNOWN 1 held by the baseline \(#19 Accessibility pass\)$/m);
  assert.doesNotMatch(report, /a11y.*PASS/);
  const failing = formatReport({
    requested: ['overflow', 'save', 'runtime'],
    ran: ['overflow', 'runtime'],
    findings: dedupeFindings([finding({ section: 'overflow', rule: 'page-scroll', where: 'page' })]),
    verdict: { over: [], stale: [{ rule: 'label', count: 0, allowed: 1 }], forbidden: [] },
    baseline
  });
  assert.match(failing, /^overflow: FAIL 1 finding$/m);
  assert.match(failing, /^save: DID NOT RUN$/m);
  assert.match(failing, /^drawers: not requested$/m);
  assert.match(failing, /lower the baseline: label/);
  // A section left unfinished by a scenario that could not open still shows what it found.
  const incomplete = formatReport({
    requested: ['overflow', 'runtime'],
    ran: ['runtime'],
    findings: dedupeFindings([finding({ section: 'overflow', rule: 'control-off-screen', where: 'button "Undo" #1 in journey toolbar' })]),
    verdict: { over: [], stale: [], forbidden: [] },
    baseline: {}
  });
  assert.match(incomplete, /^overflow: INCOMPLETE, 1 finding from the scenarios that ran$/m);
  assert.match(incomplete, /control-off-screen: button "Undo" #1 in journey toolbar/);
  assert.doesNotMatch(report + failing, DASHES);
});

test('no rule text the checks can print carries an em dash or a spaced en dash', () => {
  const texts = [
    ...layoutProblems(layout({ scrollWidths: { documentElement: 500, body: 500 }, controls: [control()], clippedBoxes: [{ where: 'd', hiddenPx: 46, hides: 'control', ellipsis: false }] })),
    ...drawerProblems(styledDrawer({ stylesheetRule: false, closes: false, root: { position: 'static', rect: { left: 0, top: 0, right: 1, bottom: 1 }, backgroundColor: 'transparent' } })),
    ...drawerProblems(styledDrawer({ found: false })),
    ...saveProblems(happySave({ signedIn: false })),
    ...saveProblems(happySave({ postsAttempted: 0, alertText: null, statusText: 'Saved', retryOffered: false, keptName: null, dismissed: false })),
    ...saveProblems(happySave({ retryPosts: 0 })),
    ...pageErrorProblems(['boom'])
  ].map(p => p.detail);
  for (const t of texts) assert.doesNotMatch(t, DASHES, t);
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const lib of ['src/lib/canvasCheckRules.ts', 'src/lib/a11yRules.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, lib), 'utf8'), DASHES, lib);
  }
  assert.doesNotMatch(source, DASHES);
});

test('the check runs at 1440x900, 768x1024 and 390x844', () => {
  assert.deepEqual(CHECK_VIEWPORTS.map(v => [v.label, v.width, v.height]), [['1440', 1440, 900], ['768', 768, 1024], ['390', 390, 844]]);
});

test('when the baseline file exists, every entry has a whole count of 1 or more and an owning item', (t) => {
  // A skip is counted and reported; an early return used to count as a pass (truth protocol, 3).
  if (!fs.existsSync(BASELINE)) return t.skip('no axe baseline file on this machine');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  for (const [rule, entry] of Object.entries(baseline)) {
    assert.ok(Number.isInteger(entry.count) && entry.count >= 1, rule);
    assert.ok(typeof entry.owner === 'string' && entry.owner.includes('#'), rule);
    assert.ok(!ZERO_ONLY_RULES.includes(rule), `${rule} can never be baselined`);
  }
});

// ---- Source pins on the harness ----

test('the harness never spawns, never reads .env, never proxies, and uses the pure judges', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /child_process/);
  assert.doesNotMatch(code, /dotenv/);
  assert.match(code, /envDir/);
  assert.match(code, /proxy: \{\}/);
  assert.match(code, /route\(\s*'\*\*\/\*'[\s\S]{0,200}routeVerdict\(/);
  assert.match(code, /import \{[^}]*\bsaveOutcome\b[^}]*\} from '\.\.\/src\/lib\/saveOutcome\.ts'/);
  assert.match(code, /from '\.\.\/src\/lib\/a11yRules\.ts'/);
  assert.match(code, /from '\.\.\/src\/lib\/canvasCheckRules\.ts'/);
  const controls = code.indexOf('await runControls(browser)');
  const loop = code.indexOf('for (const viewport of viewports)');
  assert.ok(controls > 0 && loop > controls, 'runControls runs before the scenario loop');
  assert.match(code, /export const SCENARIOS/);
  for (const id of ['canvas', 'more-menu', 'add-step-menu', 'step-selected', 'line-selected', 'live-roas', 'audit-drawer', 'forecaster-drawer', 'save-failed']) {
    assert.match(code, new RegExp(`id: '${id}'`), id);
  }
  assert.match(code, /The checks cannot be trusted: rule \$\{rule\} did not fire on its planted example\./);
  assert.match(code, /Nothing reached a server\./);
});

test('package.json runs the check as check:canvas with no new dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:canvas'], 'node scripts/canvas-browser-check.mjs');
  assert.ok(!('axe-core' in (pkg.dependencies ?? {})) && !('axe-core' in (pkg.devDependencies ?? {})));
  assert.ok(!('playwright' in (pkg.dependencies ?? {})) && !('playwright' in (pkg.devDependencies ?? {})));
});
