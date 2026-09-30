import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A screen reader heard every step as "node-page-1" and every line as "Edge from node-ad-1 to
// node-page-1", Escape closed every open panel at once, focus fell to <body> when a panel closed,
// and text on the map ran as small as 8px. #19 fixes that to Aura's standard.
//
// The rules are pure and pinned first: src/lib/stepNames.ts (what a step and a line are called),
// src/lib/a11y.ts (the dialog stack, the Tab trap, where focus returns) and the hook glue in
// src/lib/a11yHooks.ts, which the docked step panel already uses.
//
// The rest reads the components, like edge-kinds.test.mjs, because they need a browser to render.
// Those files belong to later lanes of #19, so their checks are marked todo: they run and report,
// but do not fail the suite until that lane lands. TODO(#19): when a lane below lands, set its
// entry in PENDING to {} so its checks become hard failures. scripts/a11y-browser-check.mjs is
// the same contract in a real browser.

const PENDING = {
  // Forecaster, Audit, product picker and the Ad, Form, Upsell, Thank-you and Page editors.
  'w3-a11y-drawers': {},
  // Sequence and A/B split editors and the line inspector.
  'w4-a11y-editors': {},
  // The map, its cards and lines, the step inspector, the header, index.css and the types.
  'w5-final': {}
};

const stepNames = await import('./src/lib/stepNames.ts');
const { stepShortName, stepSpokenName, describeEdge, JOURNEY_ARIA_LABELS, STEP_ARIA_LABELS, stripA11yDecorations } = stepNames;
const a11y = await import('./src/lib/a11y.ts');
const {
  MIN_TEXT_PX,
  FOCUSABLE_SELECTOR,
  openDialog,
  closeDialog,
  isTopDialog,
  resetDialogStackForTest,
  shouldCloseOnEscape,
  nextTrapIndex,
  pickReturnTarget,
  shouldRestoreFocus
} = a11y;
const nav = await import('./src/lib/stepNavigation.ts');
const { EDGE_KINDS } = await import('./src/lib/edgeKinds.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const read = path => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '');
const def = DEFAULT_LEAD_CAPTURE_PROJECT;
const journeys = [def, ...ECOM_BLUEPRINTS];
const EM_DASH = '\u2014';
const SPACED_EN_DASH = /\s\u2013\s/;

// ---- Step and line names ----

test('a step is named the way its card reads', () => {
  const spoken = Object.fromEntries(def.nodes.map(n => [n.id, stepSpokenName(n.data)]));
  assert.deepEqual(spoken, {
    'node-ad-1': 'Meta ad',
    'node-page-1': 'Landing page /vip-consultation',
    'node-form-1': 'Lead form "Where should we reach you?", 4 fields',
    'node-seq-1': 'Nurture sequence "New Client 3-Part Follow-Up", 3 messages'
  });
  // A node reads the same as its data, so a caller holding either gets one answer.
  for (const n of def.nodes) assert.equal(stepSpokenName(n), spoken[n.id]);
  // stepNavigation re-exports the same function: one naming rule for the finder, dock and map.
  assert.equal(nav.stepSpokenName, stepSpokenName);
  assert.equal(nav.STEP_ARIA_LABELS, STEP_ARIA_LABELS);

  const page = def.nodes.find(n => n.id === 'node-page-1').data;
  assert.equal(stepSpokenName(page, { kind: 'published', revisionNumber: 3, publishedAt: '' }), 'Landing page /vip-consultation, published');
  assert.equal(stepSpokenName({ ...page, abTestingEnabled: true }, { kind: 'not-published' }), 'Landing page /vip-consultation, not published, A/B test on');
  assert.equal(stepSpokenName({ ...page, slug: '' }, { kind: 'not-published' }), 'Landing page, no address yet, not published');
  assert.equal(stepShortName({ type: 'ad-source', platform: 'organic' }), 'Organic traffic');
  assert.equal(stepShortName({ type: 'ad-source', platform: 'google' }), 'Google search ad');
  assert.equal(stepShortName({ type: 'ad-source', platform: 'tiktok' }), 'TikTok ad');
  assert.equal(stepShortName({ type: 'ad-source', platform: 'print' }), 'Traffic source');
  assert.equal(stepSpokenName({ type: 'ad-source', platform: 'meta', utmCampaign: '  ' }), 'Meta ad');
  assert.equal(
    stepSpokenName({ type: 'follow-up-sequence', sequenceTitle: 'One', steps: [{ id: 's' }] }),
    'Nurture sequence "One", 1 message'
  );
  assert.equal(
    stepSpokenName({ type: 'follow-up-sequence', isRetentionBranch: true, sequenceTitle: 'Come back', steps: [] }),
    'Retention sequence "Come back", 0 messages'
  );
  const sequenceKinds = {
    upsell_recovery: 'Courtesy rescue sequence',
    checkout_recovery: 'Cart recovery sequence',
    at_risk_winback: 'Winback sequence',
    fulfillment_review: 'Review request sequence',
    lead_nurture: 'Nurture sequence',
    something_new: 'Follow-up sequence'
  };
  for (const [sequenceType, kind] of Object.entries(sequenceKinds)) {
    assert.equal(stepShortName({ type: 'follow-up-sequence', sequenceType }), kind, sequenceType);
  }
  assert.equal(stepSpokenName({ type: 'thank-you', slug: '' }), 'Thank-you page, no address yet');
  assert.equal(stepShortName({ type: 'thank-you', slug: 'thanks' }), 'Thank-you page /thanks');
  assert.equal(stepSpokenName({ type: 'upsell', offerType: 'downsell', slug: 'glow' }, { kind: 'published', revisionNumber: 3, publishedAt: '' }), 'Downsell /glow/downsell, published');
  assert.equal(stepSpokenName({ type: 'upsell', slug: 'glow' }, { kind: 'not-published' }), 'Upsell /glow/upsell, not published');
  assert.equal(stepSpokenName({ type: 'upsell', offerType: 'upsell' }, { kind: 'not-published' }), 'Upsell, no address yet, not published');
  assert.equal(stepSpokenName({ type: 'ab-split', slug: 'spring', splitRatio: 70 }, { kind: 'not-published' }), 'A/B split /spring, not published, 70/30 split');
  assert.equal(stepSpokenName({ type: 'ab-split', slug: 'spring', splitRatio: 70, winner: 'b' }, { kind: 'not-published' }), 'A/B split /spring, not published, winner B');
  // The card clamps the ratio and defaults it to 50; the name does the same.
  assert.equal(stepSpokenName({ type: 'ab-split', slug: 'spring', splitRatio: 140 }), 'A/B split /spring, 100/0 split');
  assert.equal(stepSpokenName({ type: 'ab-split', slug: 'spring' }), 'A/B split /spring, 50/50 split');
  assert.equal(stepSpokenName({ type: 'lead-form', formTitle: '', fields: [{ enabled: true }, { enabled: false }] }), 'Lead form, 1 field');
  assert.equal(stepSpokenName({ type: 'mystery' }), 'Step');
  assert.equal(stepSpokenName(undefined), 'Step');
  assert.equal(stepSpokenName(null), 'Step');
});

test('no step name leaks an id, a dash, a blank or a number the card does not show', () => {
  let checked = 0;
  for (const journey of journeys) {
    for (const node of journey.nodes) {
      for (const name of [stepSpokenName(node.data), stepShortName(node.data)]) {
        assert.ok(name.trim().length > 0, node.id);
        assert.ok(!name.includes(node.id), `${node.id}: ${name}`);
        assert.ok(!name.includes(EM_DASH), name);
        assert.ok(!SPACED_EN_DASH.test(name), name);
        assert.ok(!/undefined|null|NaN/.test(name), name);
        // Traffic figures never ride on a name: a screen reader would read stale numbers.
        assert.ok(!/visitor|conversion|revenue|%/i.test(name), name);
      }
      checked++;
    }
  }
  assert.ok(checked >= 20, `only ${checked} steps checked`);
});

test('a line is described in words', () => {
  assert.equal(
    describeEdge({ kind: 'accepted', from: 'Upsell /glow/upsell', to: 'Thank-you page /thanks', visitors: 340, reached: 41 }),
    'Accepted: from Upsell /glow/upsell to Thank-you page /thanks. 41 of 340 visitors went on.'
  );
  assert.equal(
    describeEdge({ kind: 'main', from: 'Meta ad', to: 'Landing page /vip-consultation', visitors: 0, reached: 0 }),
    'Next step: from Meta ad to Landing page /vip-consultation. No visits measured yet.'
  );
  assert.match(describeEdge({ kind: 'declined', from: 'a', to: 'b' }), /No visits measured yet\.$/);
  assert.match(describeEdge({ kind: 'retention', from: 'a', to: 'b', visitors: NaN, reached: 3 }), /No visits measured yet\.$/);
  assert.equal(
    describeEdge({ kind: 'split-a', from: 'A/B split /s', to: 'Landing page /x', visitors: 12000, reached: 1500 }),
    `Split A: from A/B split /s to Landing page /x. ${(1500).toLocaleString()} of ${(12000).toLocaleString()} visitors went on.`
  );
  let lines = 0;
  for (const journey of journeys) {
    const byId = new Map(journey.nodes.map(n => [n.id, n]));
    for (const e of journey.edges) {
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      const kind = nav.lineKindOf(e, target);
      const text = describeEdge({
        kind,
        from: source ? stepShortName(source.data) : 'a step that is gone',
        to: target ? stepShortName(target.data) : 'a step that is gone',
        visitors: e.data?.sourceThroughput,
        reached: e.data?.targetCount
      });
      assert.ok(text.startsWith(`${EDGE_KINDS[kind].label}: from `), text);
      for (const id of [e.id, e.source, e.target]) assert.ok(!text.includes(id), `${text} names ${id}`);
      assert.ok(!text.includes(EM_DASH) && !SPACED_EN_DASH.test(text), text);
      lines++;
    }
  }
  assert.ok(lines >= 15, `only ${lines} lines checked`);
});

test('the map speaks Jourvance, not React Flow defaults', async () => {
  const KEYS = [
    'node.a11yDescription.default',
    'node.a11yDescription.keyboardDisabled',
    'node.a11yDescription.ariaLiveMessage',
    'edge.a11yDescription.default',
    'controls.ariaLabel',
    'controls.zoomIn.ariaLabel',
    'controls.zoomOut.ariaLabel',
    'controls.fitView.ariaLabel',
    'controls.interactive.ariaLabel',
    'minimap.ariaLabel',
    'handle.ariaLabel'
  ];
  assert.deepEqual(Object.keys(JOURNEY_ARIA_LABELS).sort(), [...KEYS].sort());
  let system = null;
  try {
    system = await import('@xyflow/system');
  } catch {
    // Not resolvable from node here: the pinned list above still holds.
  }
  if (system?.defaultAriaLabelConfig) {
    assert.deepEqual(Object.keys(JOURNEY_ARIA_LABELS).sort(), Object.keys(system.defaultAriaLabelConfig).sort());
  }
  // One step description, the one #7's panel wording set. React Flow 12.11 shows the
  // keyboardDisabled text while keyboard access is on, so both keys carry it.
  const hint = JOURNEY_ARIA_LABELS['node.a11yDescription.default'];
  assert.equal(hint, STEP_ARIA_LABELS['node.a11yDescription.default']);
  assert.equal(JOURNEY_ARIA_LABELS['node.a11yDescription.keyboardDisabled'], hint);
  assert.ok(hint.startsWith('Press Enter to open this step'), hint);
  assert.equal(JOURNEY_ARIA_LABELS['node.a11yDescription.ariaLiveMessage']({ direction: 'left', x: 0, y: 0 }), 'Moved the step left.');
  for (const [key, value] of Object.entries(JOURNEY_ARIA_LABELS)) {
    const text = typeof value === 'function' ? value({ direction: 'up', x: 1, y: 2 }) : value;
    assert.equal(typeof text, 'string', key);
    assert.ok(text.trim(), key);
    assert.ok(!/\bnodes?\b|\bedges?\b/i.test(text), `${key}: ${text}`);
    assert.ok(!text.includes(EM_DASH) && !SPACED_EN_DASH.test(text), `${key}: ${text}`);
  }
});

test('stripA11yDecorations removes only what the canvas added', () => {
  const node = {
    id: 'node-page-1',
    type: 'landing-page',
    position: { x: 1, y: 2 },
    data: { type: 'landing-page', slug: 'vip', label: 'Lander' },
    ariaLabel: 'Landing page /vip, draft',
    domAttributes: { 'aria-roledescription': 'step' }
  };
  const edge = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceHandle: 'accepted',
    ariaLabel: 'Accepted: from a to b.',
    focusable: false,
    domAttributes: { 'aria-hidden': true },
    data: { sourceThroughput: 10, targetCount: 2, description: 'Accepted: from a to b.' }
  };
  const nodeBefore = structuredClone(node);
  const edgeBefore = structuredClone(edge);
  const n = stripA11yDecorations(node);
  const e = stripA11yDecorations(edge);
  for (const item of [n, e]) {
    for (const key of ['ariaLabel', 'domAttributes', 'focusable']) assert.ok(!(key in item), key);
  }
  assert.ok(!('description' in e.data));
  assert.deepEqual(n, { id: 'node-page-1', type: 'landing-page', position: { x: 1, y: 2 }, data: node.data });
  assert.deepEqual(e, { id: 'e1', source: 'a', target: 'b', sourceHandle: 'accepted', data: { sourceThroughput: 10, targetCount: 2 } });
  // Never mutates, and a second pass changes nothing.
  assert.deepEqual(node, nodeBefore);
  assert.deepEqual(edge, edgeBefore);
  assert.deepEqual(stripA11yDecorations(n), n);
  assert.deepEqual(stripA11yDecorations(e), e);
  // A saved line with no data stays without data.
  assert.deepEqual(stripA11yDecorations({ id: 'e2', source: 'a', target: 'b', ariaLabel: 'x' }), { id: 'e2', source: 'a', target: 'b' });
});

// ---- The dialog stack, the trap and where focus goes ----

test('Escape closes only the top dialog', () => {
  resetDialogStackForTest();
  const a = openDialog();
  const b = openDialog();
  assert.notEqual(a, b);
  assert.equal(isTopDialog(b), true);
  assert.equal(isTopDialog(a), false);
  // A lower dialog closing first never strands the top one.
  closeDialog(a);
  assert.equal(isTopDialog(b), true);
  closeDialog(b);
  assert.equal(isTopDialog(b), false);
  closeDialog(b);
  const base = { key: 'Escape', defaultPrevented: false, isTop: true, modal: true, focusInside: true };
  assert.equal(shouldCloseOnEscape({ ...base, key: 'Enter' }), false);
  assert.equal(shouldCloseOnEscape({ ...base, defaultPrevented: true }), false);
  assert.equal(shouldCloseOnEscape({ ...base, isTop: false }), false);
  assert.equal(shouldCloseOnEscape({ ...base, focusInside: false }), true);
  assert.equal(shouldCloseOnEscape({ ...base, modal: false, focusInside: false }), false);
  assert.equal(shouldCloseOnEscape({ ...base, modal: false, focusInside: true }), true);
  resetDialogStackForTest();
});

test('Tab wraps inside a modal', () => {
  assert.equal(nextTrapIndex(0, -1, false), null);
  assert.equal(nextTrapIndex(5, -1, false), 0);
  assert.equal(nextTrapIndex(5, -1, true), 4);
  assert.equal(nextTrapIndex(5, 4, false), 0);
  assert.equal(nextTrapIndex(5, 0, true), 4);
  assert.equal(nextTrapIndex(5, 2, false), null);
  assert.equal(nextTrapIndex(5, 2, true), null);
  assert.equal(nextTrapIndex(1, 0, false), 0);
  // A dialog heading has tabIndex -1: focusable, never tabbable.
  assert.match(FOCUSABLE_SELECTOR, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
  assert.match(FOCUSABLE_SELECTOR, /input:not\(\[disabled\]\):not\(\[type="hidden"\]\)/);
  assert.equal(MIN_TEXT_PX, 11);
});

test('focus goes back where it came from', () => {
  const body = { isConnected: true };
  const saved = { isConnected: true };
  const gone = { isConnected: false };
  const map = { isConnected: true };
  assert.equal(pickReturnTarget(saved, body, map), saved);
  assert.equal(pickReturnTarget(body, body, map), map);
  assert.equal(pickReturnTarget(gone, body, map), map);
  assert.equal(pickReturnTarget(null, body, map), map);
  assert.equal(pickReturnTarget(gone, body, { isConnected: false }), null);
  assert.equal(pickReturnTarget(gone, body, null), null);
  assert.equal(shouldRestoreFocus({ active: null, body, insidePanel: false }), true);
  assert.equal(shouldRestoreFocus({ active: body, body, insidePanel: false }), true);
  assert.equal(shouldRestoreFocus({ active: saved, body, insidePanel: true }), true);
  assert.equal(shouldRestoreFocus({ active: saved, body, insidePanel: false }), false);
  // One key rule for the map, in stepNavigation.ts (#7), and a11y.ts does not define a second.
  const el = (classes, id) => ({ classList: { contains: c => classes.includes(c) }, getAttribute: n => (n === 'data-id' ? id : null) });
  const step = el(['react-flow__node'], 'node-page-1');
  assert.deepEqual(nav.canvasKeyAction('Enter', step), { open: 'node-page-1' });
  assert.deepEqual(nav.canvasKeyAction(' ', step), { open: 'node-page-1' });
  assert.deepEqual(nav.canvasKeyAction('Escape', step), { close: 'node-page-1' });
  assert.equal(nav.canvasKeyAction('Enter', el(['react-flow__pane'], null)), null);
  assert.equal(nav.canvasKeyAction('a', step), null);
  assert.ok(!('canvasKeyAction' in a11y));
});

test('the dialog hook moves focus in, stacks Escape, traps Tab in a modal and puts focus back', () => {
  const hooks = read('src/lib/a11yHooks.ts');
  assert.match(hooks, /export function useDialogFocus<T extends HTMLElement = HTMLDivElement>\(/);
  assert.match(hooks, /export function useFieldIds\(\)/);
  // The panel element is captured for cleanup: React clears the ref before passive cleanup runs.
  assert.match(hooks, /const panel = ref\.current;/);
  assert.match(hooks, /\[data-dialog-start\]/);
  assert.match(hooks, /preventScroll: true/);
  assert.match(hooks, /shouldCloseOnEscape\(/);
  assert.match(hooks, /isModal && isTopDialog\(id\)/);
  assert.match(hooks, /nextTrapIndex\(/);
  assert.match(hooks, /closeDialog\(id\)/);
  assert.match(hooks, /pickReturnTarget</);
  assert.match(hooks, /\}, \[open, key\]\);/);
  assert.match(hooks, /useId\(\)\.replace\(\/\[\^A-Za-z0-9_-\]\/g, ''\)/);
});

test('the docked step panel is on the dialog stack and keeps its own focus rules', () => {
  const dock = read('src/components/drawers/StepDock.tsx');
  const call = dock.indexOf('useDialogFocus<HTMLDivElement>(');
  assert.ok(call > 0, 'StepDock calls useDialogFocus');
  const args = dock.slice(call, dock.indexOf(');', call));
  assert.match(args, /modal: false/);
  assert.match(args, /initialFocus: false/);
  assert.match(args, /fallbackFocusId: 'journey-map'/);
  // Before the heading-focus effect, so the opener it records is what the person pressed.
  assert.ok(call < dock.indexOf('headingRef.current?.focus()'), 'hook runs before the heading focus effect');
  assert.match(dock, /<div ref=\{panelRef\}/);
  // The two inspectors render inside the dock, so they must not join the stack a second time.
  for (const file of ['src/components/drawers/NodeInspector.tsx', 'src/components/drawers/EdgeInspector.tsx']) {
    assert.ok(!read(file).includes('useDialogFocus('), `${file} calls useDialogFocus inside the dock`);
  }
});

// ---- Source scans shared by the component checks ----

/** Index just past the brace that closes the one at `open`, skipping strings, templates and comments. */
function skipBraces(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') {
      for (i++; i < src.length && src[i] !== '`'; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '$' && src[i + 1] === '{') i = skipBraces(src, i + 1) - 1;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** The index of the '>' that ends the JSX opening tag starting at `start`. */
function tagEnd(src, start) {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { i = skipBraces(src, i) - 1; continue; }
    if (c === '"' || c === "'") { i = src.indexOf(c, i + 1); if (i === -1) return src.length; continue; }
    if (c === '>') return i;
  }
  return src.length;
}

function openingTags(src, name) {
  const re = new RegExp(`<${name}(?=[\\s>/])`, 'g');
  const tags = [];
  for (let m; (m = re.exec(src)); ) {
    const end = tagEnd(src, m.index);
    tags.push({ start: m.index, end, text: src.slice(m.index, end + 1) });
  }
  return tags;
}

/** The raw text of an attribute's value: the inside of "..." or of {...}. */
function attrValue(tag, name) {
  const m = new RegExp(`\\s${name}=`).exec(tag);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (tag[at] === '"' || tag[at] === "'") return tag.slice(at + 1, tag.indexOf(tag[at], at + 1));
  if (tag[at] === '{') return tag.slice(at + 1, skipBraces(tag, at) - 1).trim();
  return null;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every font size under MIN_TEXT_PX in a file: fontSize strings and numbers, text-[Npx], font-size. */
function smallText(src) {
  const found = [];
  const add = (index, px) => { if (px < MIN_TEXT_PX) found.push(`line ${lineOf(src, index)}: ${px}px`); };
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
    const expr = m[1];
    const pxs = [...expr.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => Number(x[1]));
    if (pxs.length) pxs.forEach(px => add(m.index, px));
    else if (/^\s*\d+(?:\.\d+)?\s*$/.test(expr)) add(m.index, Number(expr));
  }
  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) add(m.index, Number(m[1]));
  for (const m of src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) add(m.index, Number(m[1]));
  return found;
}

/** Every <label> that names nothing and every control with no name, in one file. */
function labelProblems(src) {
  const problems = [];
  const labels = openingTags(src, 'label');
  const ranges = [];
  const targets = new Set();
  for (const label of labels) {
    const close = src.indexOf('</label>', label.end);
    const inner = close === -1 ? '' : src.slice(label.end + 1, close);
    ranges.push([label.end, close === -1 ? label.end : close]);
    const htmlFor = attrValue(label.text, 'htmlFor');
    if (htmlFor !== null) targets.add(htmlFor);
    else if (!/<(input|select|textarea)(?=[\s>/])/.test(inner)) problems.push(`line ${lineOf(src, label.start)}: <label> names no control`);
  }
  for (const kind of ['input', 'select', 'textarea']) {
    for (const tag of openingTags(src, kind)) {
      if (/\stype="hidden"/.test(tag.text)) continue;
      if (/\saria-label=/.test(tag.text) || /\saria-labelledby=/.test(tag.text)) continue;
      const id = attrValue(tag.text, 'id');
      if (id !== null && targets.has(id)) continue;
      if (ranges.some(([from, to]) => tag.start > from && tag.start < to)) continue;
      problems.push(`line ${lineOf(src, tag.start)}: <${kind}> has no label`);
    }
  }
  return problems;
}

/** Every <button> whose opening tag holds `needle`, and whether each carries aria-pressed. */
function pressedButtons(src, needle) {
  const buttons = openingTags(src, 'button');
  const hits = [];
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + needle.length)) {
    const tag = buttons.filter(b => b.start < at && at < b.end).pop();
    if (tag) hits.push({ line: lineOf(src, at), pressed: /\saria-pressed=/.test(tag.text) });
  }
  return hits;
}

const C = 'src/components';
const LANE_FILES = {
  'w3-a11y-drawers': [
    `${C}/drawers/AdEditor.tsx`,
    `${C}/drawers/FormEditor.tsx`,
    `${C}/drawers/UpsellEditor.tsx`,
    `${C}/drawers/ThankYouEditor.tsx`,
    `${C}/drawers/PageEditor.tsx`,
    `${C}/drawers/PreFlightAuditDrawer.tsx`,
    `${C}/drawers/FinancialSimulatorDrawer.tsx`,
    `${C}/modals/ShopifyProductPickerModal.tsx`
  ],
  'w4-a11y-editors': [`${C}/drawers/SequenceEditor.tsx`, `${C}/drawers/AbSplitEditor.tsx`, `${C}/drawers/EdgeInspector.tsx`],
  'w5-final': [
    ...fs.readdirSync(`${C}/canvas/nodes`).filter(f => f.endsWith('.tsx')).map(f => `${C}/canvas/nodes/${f}`),
    `${C}/canvas/edges/ConversionEdge.tsx`,
    `${C}/canvas/EdgeLegend.tsx`,
    `${C}/canvas/JourneyCanvas.tsx`,
    `${C}/drawers/NodeInspector.tsx`,
    `${C}/toolbar/CanvasHeader.tsx`,
    `${C}/toolbar/WorkspaceSelector.tsx`
  ]
};

// ---- Text size ----

test('the step panel files render no text under 11px', () => {
  for (const file of ['StepDock', 'StepFinder', 'StepConnections']) {
    const src = read(`${C}/drawers/${file}.tsx`);
    assert.ok(src, file);
    assert.deepEqual(smallText(src), [], file);
  }
});

for (const [lane, files] of Object.entries(LANE_FILES)) {
  test(`no text under 11px (${lane})`, PENDING[lane], () => {
    const offenders = [];
    for (const file of files) {
      const src = read(file);
      if (!src) { offenders.push(`${file}: missing`); continue; }
      for (const hit of smallText(src)) offenders.push(`${file} ${hit}`);
    }
    assert.deepEqual(offenders, []);
  });
}

// ---- Labels ----

const LABEL_FILES = {
  'w3-a11y-drawers': ['AdEditor', 'FormEditor', 'UpsellEditor', 'ThankYouEditor', 'PageEditor', 'FinancialSimulatorDrawer'].map(f => `${C}/drawers/${f}.tsx`)
    .concat(`${C}/modals/ShopifyProductPickerModal.tsx`),
  'w4-a11y-editors': ['SequenceEditor', 'AbSplitEditor'].map(f => `${C}/drawers/${f}.tsx`),
  'w5-final': [`${C}/toolbar/CanvasHeader.tsx`]
};

test('the label scanner reads real JSX', () => {
  const ok = `<label htmlFor={fid('a')} style={{ x: '{' }}>A</label><input id={fid('a')} onChange={e => f({ v: e.target.value })} />
    <label>B <select value={x}><option>1</option></select></label>
    <input aria-label="Search" /><textarea aria-labelledby={fid('h')} /><input type="hidden" />`;
  assert.deepEqual(labelProblems(ok), []);
  const bad = `<label style={{ color: 'red' }}>Orphan</label>\n<input value={v} />\n<select id={fid('z')}></select>`;
  assert.deepEqual(labelProblems(bad), ['line 1: <label> names no control', 'line 2: <input> has no label', 'line 3: <select> has no label']);
  const buttons = `<button\n  type="button"\n  onClick={() => set({ a: 1, offerType: 'upsell' })}\n  aria-pressed={on}\n>x</button><button onClick={() => go('b')}>y</button>`;
  assert.deepEqual(pressedButtons(buttons, "offerType: 'upsell'"), [{ line: 3, pressed: true }]);
  assert.deepEqual(pressedButtons(buttons, "go('b')"), [{ line: 5, pressed: false }]);
  assert.deepEqual(smallText(`fontSize: '10px', a: 1, fontSize: 9, b: 'text-[10px] text-[12px]', fontSize: big ? '14px' : '8px'`), [
    'line 1: 10px', 'line 1: 9px', 'line 1: 8px', 'line 1: 10px'
  ]);
});

test('the step panel files tie every label to its control', () => {
  for (const file of ['StepDock', 'StepFinder', 'StepConnections']) {
    assert.deepEqual(labelProblems(read(`${C}/drawers/${file}.tsx`)), [], file);
  }
});

for (const [lane, files] of Object.entries(LABEL_FILES)) {
  test(`every label names a control and every control has a name (${lane})`, PENDING[lane], () => {
    const problems = [];
    for (const file of files) for (const p of labelProblems(read(file))) problems.push(`${file} ${p}`);
    assert.deepEqual(problems, []);
  });
}

// ---- Pressed toggles ----

// [file, onClick needle, buttons that hold it]. A count that no longer matches means the editor
// changed shape and this table needs the new needle, not that the toggle may go unmarked.
const TOGGLES = {
  'w3-a11y-drawers': [
    ['drawers/AdEditor.tsx', 'setEditorTab(', 2],
    ['drawers/AdEditor.tsx', 'setAdFormat(', 3],
    ['drawers/AdEditor.tsx', "handleFieldChange('platform', p)", 1],
    ['drawers/FormEditor.tsx', 'setEditorTab(', 2],
    ['drawers/FormEditor.tsx', 'toggleRequired(f.id)', 1],
    ['drawers/UpsellEditor.tsx', 'setEditorTab(', 2],
    ['drawers/UpsellEditor.tsx', "offerType: 'upsell'", 1],
    ['drawers/UpsellEditor.tsx', "offerType: 'downsell'", 1],
    ['drawers/ThankYouEditor.tsx', 'setEditorTab(', 2],
    ['drawers/PageEditor.tsx', 'setEditorTab(', 2],
    ['drawers/PageEditor.tsx', 'setPreviewDevice(', 2],
    ['drawers/PageEditor.tsx', 'setPreviewVariant(', 2],
    ['drawers/PageEditor.tsx', 'setPreviewViewMode(', 2],
    ['drawers/PageEditor.tsx', 'setPreviewCurrency(code)', 1],
    ['drawers/PageEditor.tsx', "handleFieldChange('checkoutMode'", 2],
    ['drawers/PageEditor.tsx', "handleFieldChange('cookieConsentGeoTarget'", 2],
    ['drawers/PageEditor.tsx', "handleFieldChange('socialProofMinRating'", 2],
    ['drawers/PageEditor.tsx', 'setActiveVariantTab(', 2]
  ],
  'w4-a11y-editors': [
    ['drawers/SequenceEditor.tsx', 'setEditorTab(', 3],
    ['drawers/SequenceEditor.tsx', 'setActiveStepIdx(idx)', 2],
    ['drawers/AbSplitEditor.tsx', 'splitRatio: preset.ratio', 1],
    ['drawers/AbSplitEditor.tsx', "handleDeclareWinner('a')", 1],
    ['drawers/AbSplitEditor.tsx', "handleDeclareWinner('b')", 1]
  ],
  'w5-final': [['canvas/JourneyCanvas.tsx', 'onClick={toggleRetention}', 1]]
};

for (const [lane, rows] of Object.entries(TOGGLES)) {
  test(`toggles say whether they are on (${lane})`, PENDING[lane], () => {
    const problems = [];
    for (const [file, needle, count] of rows) {
      const hits = pressedButtons(read(`${C}/${file}`), needle);
      if (hits.length !== count) problems.push(`${file} ${needle}: ${hits.length} buttons, expected ${count}`);
      for (const h of hits) if (!h.pressed) problems.push(`${file} line ${h.line} ${needle}: no aria-pressed`);
    }
    assert.deepEqual(problems, []);
  });
}

// ---- Dialogs and names ----

/** The source before the component's first `return null`, where every hook call must sit. */
const beforeReturnNull = src => src.slice(0, src.indexOf('return null') === -1 ? src.length : src.indexOf('return null'));

test('the Audit, the Forecaster and the product picker are modal dialogs (w3-a11y-drawers)', PENDING['w3-a11y-drawers'], () => {
  for (const file of ['drawers/PreFlightAuditDrawer.tsx', 'drawers/FinancialSimulatorDrawer.tsx', 'modals/ShopifyProductPickerModal.tsx']) {
    const src = read(`${C}/${file}`);
    assert.ok(src.includes('role="dialog"'), `${file} role="dialog"`);
    assert.ok(src.includes('aria-modal="true"'), `${file} aria-modal`);
    assert.ok(/aria-labelledby=/.test(src), `${file} aria-labelledby`);
    assert.ok(/data-dialog-start/.test(src), `${file} data-dialog-start`);
    const head = beforeReturnNull(src);
    assert.ok(/useDialogFocus(<[^>]+>)?\([^;]*modal: true/.test(head), `${file} useDialogFocus modal: true before return null`);
  }
  // The generated drawer stylesheet matches the root class list exactly.
  for (const file of ['drawers/PreFlightAuditDrawer.tsx', 'drawers/FinancialSimulatorDrawer.tsx']) {
    assert.match(read(`${C}/${file}`), /className="jv-utility fixed inset-0/);
  }
});

test('the step and line panels are named regions inside the dock (w4-a11y-editors, w5-final)', PENDING['w5-final'], () => {
  // #7 docked both inspectors in StepDock, which puts them on the dialog stack (checked above).
  // Each keeps a named panel, a focusable heading and the step or line in words.
  const nodeInspector = read(`${C}/drawers/NodeInspector.tsx`);
  const edgeInspector = read(`${C}/drawers/EdgeInspector.tsx`);
  for (const [name, src] of [['NodeInspector', nodeInspector], ['EdgeInspector', edgeInspector]]) {
    assert.ok(/aria-labelledby=/.test(src), `${name} aria-labelledby`);
    assert.ok(/aria-describedby=/.test(src), `${name} aria-describedby`);
    assert.ok(/data-dialog-start/.test(src), `${name} data-dialog-start`);
    assert.ok(!src.includes('aria-modal="true"'), `${name} is not modal`);
  }
  assert.match(nodeInspector, /stepSpokenName\(/);
  assert.match(edgeInspector, /describeEdge\(/);
});

test('icon-only buttons have names (w3-a11y-drawers)', PENDING['w3-a11y-drawers'], () => {
  for (const file of ['drawers/FinancialSimulatorDrawer.tsx', 'modals/ShopifyProductPickerModal.tsx']) {
    const src = read(`${C}/${file}`);
    const close = openingTags(src, 'button').find(t => t.text.includes('onClick={onClose}'));
    assert.ok(close, `${file} has a close button`);
    assert.match(close.text, /\saria-label=/, file);
  }
});

test('icon-only buttons have names (w4-a11y-editors)', PENDING['w4-a11y-editors'], () => {
  const close = openingTags(read(`${C}/drawers/EdgeInspector.tsx`), 'button').find(t => t.text.includes('onClick={onClose}'));
  assert.ok(close, 'EdgeInspector close button');
  assert.match(close.text, /\saria-label=/);
});

test('icon-only buttons have names (w5-final)', PENDING['w5-final'], () => {
  const tags = openingTags(read(`${C}/drawers/NodeInspector.tsx`), 'button');
  const close = tags.find(t => t.text.includes('onClick={onClose}'));
  const del = tags.find(t => t.text.includes('onDeleteNode'));
  assert.ok(close && /\saria-label=/.test(close.text), 'NodeInspector Close');
  assert.ok(del && /\saria-label=/.test(del.text), 'NodeInspector Delete');
});

// ---- The map, the stylesheet and saved data ----

/** The body of `const name = useCallback(...)` or `const name = (...) => {...}`. */
function bodyOf(src, name) {
  const at = src.indexOf(`const ${name} =`);
  if (at === -1) return '';
  const arrow = src.indexOf('=>', at);
  const open = src.indexOf('{', arrow);
  return src.slice(open, skipBraces(src, open));
}

/** Every onNodesChange( / onEdgesChange( call's arguments in a body. */
function changeCalls(body) {
  const calls = [];
  for (const m of body.matchAll(/on(Nodes|Edges)Change\(/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')' && --depth === 0) break;
    }
    calls.push(body.slice(m.index + m[0].length, i).trim());
  }
  return calls;
}

test('the map names its steps and lines, and saves them clean (w5-final)', PENDING['w5-final'], () => {
  const canvas = read(`${C}/canvas/JourneyCanvas.tsx`);
  for (const needle of [
    'ariaLabel: stepSpokenName(',
    "'aria-roledescription': 'step'",
    'describeEdge(',
    'focusable: false',
    'ariaLabelConfig={JOURNEY_ARIA_LABELS}',
    'id="journey-map"',
    'canvasKeyAction('
  ]) {
    assert.ok(canvas.includes(needle), `JourneyCanvas: ${needle}`);
  }
  for (const handler of ['handleConnect', 'handleNodeDragStop', 'handleNodesChange', 'handleEdgesChange']) {
    const body = bodyOf(canvas, handler);
    assert.ok(body, `${handler} not found`);
    for (const args of changeCalls(body)) {
      const direct = args.includes('stripA11yDecorations');
      const viaName = /^\w+$/.test(args) && new RegExp(`const ${args} =[^;]*stripA11yDecorations`).test(body);
      assert.ok(direct || viaName, `${handler} passes ${args} back to App with its decorations`);
    }
  }
  assert.match(read(`${C}/canvas/edges/ConversionEdge.tsx`), /aria-describedby/);
  const header = read(`${C}/toolbar/CanvasHeader.tsx`);
  const refFocus = header.indexOf('moreButtonRef.current?.focus()');
  assert.ok(refFocus !== -1 && refFocus < header.indexOf('item.onClick()', refFocus), 'More hands focus to its button first');
  assert.match(read('src/types/journey.ts'), /description\?: string;/);
});

/** The declarations inside the first block whose selector matches. */
function cssBlock(css, selectorRe) {
  const m = selectorRe.exec(css);
  if (!m) return null;
  const open = css.indexOf('{', m.index);
  return css.slice(open + 1, skipBraces(css, open) - 1);
}

test('keyboard focus is always visible (w5-final)', PENDING['w5-final'], () => {
  const css = read('src/index.css');
  const ring = cssBlock(css, /(^|\n)\s*:focus-visible\s*\{/);
  assert.ok(ring, 'a global :focus-visible rule');
  assert.match(ring, /outline:[^;]*!important/);
  assert.match(ring, /outline-offset:[^;]*!important/);
  assert.match(css, /--color-focus:\s*#818CF8/i);
  assert.ok(cssBlock(css, /\.jv-sr-only\s*\{/), '.jv-sr-only');
  const attribution = cssBlock(css, /\.react-flow__attribution\s*\{/);
  assert.ok(attribution, '.react-flow__attribution');
  const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(attribution);
  assert.ok(size && Number(size[1]) >= MIN_TEXT_PX, 'attribution at 11px or more');
});

test('reduced motion stops every animation, the line dash included (w5-final)', PENDING['w5-final'], () => {
  const css = read('src/index.css');
  const block = cssBlock(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
  assert.ok(block, 'a prefers-reduced-motion: reduce block');
  const universal = cssBlock(block, /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/) ?? cssBlock(block, /(^|\n|\})\s*\*\s*\{/);
  assert.ok(universal, 'a universal selector');
  assert.match(universal, /animation:\s*none\s*!important/);
  assert.match(universal, /transition:\s*none\s*!important/);
  const dash = cssBlock(block, /\.react-flow__edge\.animated path[^{]*\{/);
  assert.ok(dash, '.react-flow__edge.animated path');
  assert.match(dash, /animation:\s*none\s*!important/);
});

test('no new accessibility string has an em dash or a spaced en dash', () => {
  for (const file of ['src/lib/a11y.ts', 'src/lib/stepNames.ts', 'src/lib/a11yHooks.ts']) {
    const src = read(file);
    for (const m of src.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)) {
      const s = m[1] ?? m[2];
      assert.ok(!s.includes(EM_DASH) && !SPACED_EN_DASH.test(s), `${file}: ${s}`);
    }
  }
});
