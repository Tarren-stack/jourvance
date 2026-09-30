import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A step opened only from a mouse click on the map, the panel covered the map's right side, and
// nothing listed the steps or walked between them. src/lib/stepNavigation.ts is now the one rule
// for how a step is grouped, ordered, found, named and reached, and the docked panel, its finder,
// its connections list and the map's keyboard handling all read it.

const nav = await import('./src/lib/stepNavigation.ts');
const {
  PATH_GROUPS,
  pathGroup,
  stepKindLabel,
  stepName,
  stepSpokenName,
  orderSteps,
  stepMatchesQuery,
  stepList,
  neighbourStep,
  stepConnections,
  lineKindOf,
  revealsHiddenStep,
  panTarget,
  canvasKeyAction,
  STEP_ARIA_LABELS,
  MIN_FOCUS_ZOOM,
  PAN_DURATION_MS,
  PAN_MARGIN
} = nav;
const { edgeKind, isRetentionLink } = await import('./src/lib/edgeKinds.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const bp = prefix => ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id.startsWith(`${prefix}-`)));
const bp5 = bp('bp5');
const bp6 = bp('bp6');
const def = DEFAULT_LEAD_CAPTURE_PROJECT;
const node = (id, data, position = { x: 0, y: 0 }) => ({ id, position, data });

test('retention sequences and retention branches are the retention flows group, everything else the main path', () => {
  assert.deepEqual(PATH_GROUPS, ['Main path', 'Retention flows']);
  for (const t of ['checkout_recovery', 'upsell_recovery', 'at_risk_winback']) {
    assert.equal(pathGroup({ type: 'follow-up-sequence', sequenceType: t }), 'Retention flows', t);
  }
  assert.equal(pathGroup({ type: 'landing-page', isRetentionBranch: true }), 'Retention flows');
  assert.equal(pathGroup({ type: 'follow-up-sequence', sequenceType: 'fulfillment_review' }), 'Main path');
  for (const type of ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split']) {
    assert.equal(pathGroup({ type }), 'Main path', type);
  }
  assert.equal(pathGroup(undefined), 'Main path');
});

test('every step type has a plain name, and an upsell card says whether it is a downsell', () => {
  assert.equal(stepKindLabel({ type: 'ad-source' }), 'Ad');
  assert.equal(stepKindLabel({ type: 'landing-page' }), 'Landing page');
  assert.equal(stepKindLabel({ type: 'lead-form' }), 'Form');
  assert.equal(stepKindLabel({ type: 'follow-up-sequence' }), 'Follow-up');
  assert.equal(stepKindLabel({ type: 'thank-you' }), 'Thank-you page');
  assert.equal(stepKindLabel({ type: 'upsell', offerType: 'upsell' }), 'Upsell');
  assert.equal(stepKindLabel({ type: 'upsell' }), 'Upsell');
  assert.equal(stepKindLabel({ type: 'upsell', offerType: 'downsell' }), 'Downsell');
  assert.equal(stepKindLabel({ type: 'ab-split' }), 'A/B split');
});

test('a step with no name reads as Untitled step, and the spoken name reads like its card', () => {
  assert.equal(stepName(node('a', { type: 'lead-form', label: '   ' })), 'Untitled step');
  assert.equal(stepName(node('a', { type: 'lead-form' })), 'Untitled step');
  assert.equal(stepName(node('a', { type: 'lead-form', label: '  Intake  ' })), 'Intake');
  const page = def.nodes.find(n => n.id === 'node-page-1');
  // #19: the map speaks the card's wording, from stepNames.ts, and takes a node or its data. The
  // status is the one the card's strip shows, passed in (U07); with none there is no status word.
  assert.equal(stepSpokenName(page), 'Landing page /vip-consultation');
  assert.equal(stepSpokenName(page.data), 'Landing page /vip-consultation');
  assert.equal(stepSpokenName(page, { kind: 'not-published' }), 'Landing page /vip-consultation, not published');
});

test('steps are ordered main path first, then left to right, then top to bottom', () => {
  assert.deepEqual(orderSteps(def.nodes).map(n => n.id), ['node-ad-1', 'node-page-1', 'node-form-1', 'node-seq-1']);
  assert.deepEqual(orderSteps(bp6.nodes).map(n => n.id), [
    'bp6-ad', 'bp6-page', 'bp6-upsell', 'bp6-ty', 'bp6-cart-recovery', 'bp6-upsell-rescue'
  ]);
  // Same column: top to bottom, then id, so a tie never shuffles.
  const tie = [node('b', { type: 'thank-you' }, { x: 10.2, y: 5 }), node('a', { type: 'thank-you' }, { x: 9.8, y: 5 }), node('c', { type: 'thank-you' }, { x: 10, y: 1 })];
  assert.deepEqual(orderSteps(tie).map(n => n.id), ['c', 'a', 'b']);
  // The input is not reordered in place.
  assert.deepEqual(tie.map(n => n.id), ['b', 'a', 'c']);
});

test('search matches a name, a step type or a page address, ignoring case, spaces and a leading slash', () => {
  const matches = q => def.nodes.filter(n => stepMatchesQuery(n, q)).map(n => n.id);
  assert.deepEqual(matches('/vip-consultation'), ['node-page-1']);
  assert.deepEqual(matches('  VIP-Consultation '), ['node-page-1']);
  assert.deepEqual(matches('form'), ['node-form-1']);
  assert.deepEqual(matches('INTAKE'), ['node-form-1']);
  assert.deepEqual(matches('zzz'), []);
  assert.equal(matches('').length, 4);
  assert.equal(matches('   ').length, 4);
});

test('search finds a step by the card wording the map and Check design give it (C53)', async () => {
  // Check design, the issue badges and the map call a step by its card ("Downsell
  // /mini-essentials-downsell-c4/downsell") while the finder lists its label ("Downsell
  // Alternative"). Typing the card wording used to answer "No step matches."
  const { stepShortName } = await import('./src/lib/stepNames.ts');
  const down = node('d', { type: 'upsell', offerType: 'downsell', label: 'Downsell Alternative', slug: 'mini-essentials-downsell-c4' });
  const up = node('u', { type: 'upsell', offerType: 'upsell', label: 'Main Upsell', slug: 'overnight-recovery-elixir-c5' });
  const ad = node('a', { type: 'ad-source', platform: 'meta', label: 'Paid Traffic' });
  const steps = [down, up, ad];
  const matches = q => steps.filter(n => stepMatchesQuery(n, q)).map(n => n.id);
  assert.equal(stepShortName(down), 'Downsell /mini-essentials-downsell-c4/downsell');
  assert.deepEqual(matches(stepShortName(down)), ['d']);
  assert.deepEqual(matches('/mini-essentials-downsell-c4/downsell'), ['d']);
  assert.deepEqual(matches('Upsell /overnight-recovery-elixir-c5/upsell'), ['u']);
  assert.deepEqual(matches('meta ad'), ['a']);
  // Every step of every starter journey is found by its card wording and by its label.
  for (const journey of [def, ...ECOM_BLUEPRINTS]) {
    for (const n of journey.nodes) {
      assert.ok(stepMatchesQuery(n, stepShortName(n)), `${n.id} by ${stepShortName(n)}`);
      assert.ok(stepMatchesQuery(n, stepName(n)), `${n.id} by ${stepName(n)}`);
    }
  }
});

test('the walk and the connection notices read the one label rule, never a copy of it (C53)', () => {
  const walk = readFileSync('src/lib/journeyWalk.ts', 'utf8');
  const rules = readFileSync('src/lib/connectionRules.ts', 'utf8');
  assert.match(walk, /import \{ stepName \} from '\.\/stepNavigation\.ts';/);
  assert.match(rules, /import \{[^}]*\bstepLabel\b[^}]*\} from '\.\/stepNavigation\.ts';/);
  for (const [name, src] of [['journeyWalk', walk], ['connectionRules', rules]]) {
    assert.doesNotMatch(src, /label\.trim\(\)/, `${name} keeps its own copy of the label rule`);
  }
  assert.equal(nav.stepLabel(node('x', { label: '  Spring Sale  ' })), 'Spring Sale');
  assert.equal(nav.stepLabel(node('x', { label: '   ' })), '');
  assert.equal(nav.stepLabel(null), '');
});

test('the step list filters by path group and keeps a filtered-out selected step in its group', () => {
  const rescue = stepList(bp6.nodes, { filter: 'Retention flows' });
  assert.deepEqual(rescue.matchIds, ['bp6-cart-recovery', 'bp6-upsell-rescue']);
  assert.deepEqual(rescue.groups, ['Retention flows']);

  const kept = stepList(bp6.nodes, { filter: 'Retention flows', selectedId: 'bp6-page' });
  assert.ok(!kept.matchIds.includes('bp6-page'));
  assert.deepEqual(kept.groups, ['Main path', 'Retention flows']);

  assert.deepEqual(stepList(def.nodes).filters, ['all']);
  assert.deepEqual(stepList(bp6.nodes).filters, ['all', 'Main path', 'Retention flows']);
  // The Show options do not shrink while a search narrows the list.
  assert.deepEqual(stepList(bp6.nodes, { query: 'cart' }).filters, ['all', 'Main path', 'Retention flows']);

  const all = stepList(def.nodes, { query: 'form' });
  assert.deepEqual(all.ordered.map(n => n.id), ['node-ad-1', 'node-page-1', 'node-form-1', 'node-seq-1']);
  assert.deepEqual(all.matchIds, ['node-form-1']);
  assert.deepEqual(all.groups, ['Main path']);
  assert.deepEqual(stepList([]).groups, []);
});

test('Previous and Next walk the filtered list and stop at the ends', () => {
  const ordered = ['a', 'b', 'c', 'd', 'e'];
  const all = ordered;
  assert.equal(neighbourStep(ordered, all, 'c', 1), 'd');
  assert.equal(neighbourStep(ordered, all, 'c', -1), 'b');
  assert.equal(neighbourStep(ordered, all, 'e', 1), null);
  assert.equal(neighbourStep(ordered, all, 'a', -1), null);
  assert.equal(neighbourStep(ordered, all, null, 1), 'a');
  assert.equal(neighbourStep(ordered, all, null, -1), 'e');
  // A selected step the filters hide: the nearest match in that direction.
  const some = ['a', 'd', 'e'];
  assert.equal(neighbourStep(ordered, some, 'b', 1), 'd');
  assert.equal(neighbourStep(ordered, some, 'c', -1), 'a');
  assert.equal(neighbourStep(ordered, ['a'], 'c', 1), null);
  assert.equal(neighbourStep(ordered, [], null, 1), null);
  assert.equal(neighbourStep(ordered, [], 'c', -1), null);
});

test('a step lists the lines into and out of it, in legend order, and skips a line to a missing step', () => {
  const edges = [...bp5.edges, { id: 'e-ghost', source: 'bp5-upsell', target: 'bp5-gone', data: { sourceThroughput: 0, targetCount: 0, rate: 0 } }];
  const { incoming, outgoing } = stepConnections('bp5-upsell', bp5.nodes, edges);
  assert.deepEqual(
    outgoing.map(l => [l.stepId, l.lineLabel]),
    [['bp5-ty', 'Accepted'], ['bp5-downsell', 'Declined or left']]
  );
  assert.deepEqual(outgoing.map(l => l.kind), ['accepted', 'declined']);
  assert.equal(outgoing[0].stepName, 'Final VIP Order Summary');
  assert.equal(outgoing[0].edgeId, 'e-bp5-4');
  assert.deepEqual(incoming.map(l => [l.stepId, l.lineLabel]), [['bp5-page', 'Next step']]);
  assert.equal(incoming[0].stepName, 'Core Offer Landing Page');
});

// The canvas builds each line's data as { computed sourceHandle, computed isRetentionEdge, ...saved data },
// and ConversionEdge draws edgeKind over that merged object. This copy is written from the canvas, not
// from the module under test, so the two can be compared.
function drawnKind(edge, nodes) {
  const target = nodes.find(n => n.id === edge.target);
  const isRetention = Boolean(edge.data?.isRetentionEdge || isRetentionLink(edge.sourceHandle, target?.data));
  const d = { sourceHandle: edge.sourceHandle || undefined, isRetentionEdge: isRetention, ...(edge.data || {}), targetNodeData: target?.data };
  return edgeKind(d.sourceHandle, d.targetNodeData, d.isRetentionEdge);
}

test('the line kind is the one the map draws, for every line in every starter journey', () => {
  const journeys = [...ECOM_BLUEPRINTS, def];
  let count = 0;
  for (const j of journeys) {
    for (const e of j.edges) {
      const target = j.nodes.find(n => n.id === e.target);
      assert.equal(lineKindOf(e, target), drawnKind(e, j.nodes), `${e.id}`);
      count++;
    }
  }
  assert.ok(count > 20, `only ${count} lines checked`);
  // A saved isRetentionEdge of false on a rescue handle is still a retention line on the map.
  const nodes = [node('u', { type: 'upsell' }), node('p', { type: 'landing-page' })];
  const saved = { id: 'x', source: 'u', target: 'p', sourceHandle: 'rescue', data: { isRetentionEdge: false } };
  assert.equal(lineKindOf(saved, nodes[1]), 'retention');
  assert.equal(drawnKind(saved, nodes), 'retention');
  // The saved data's handle wins over the edge's own, as it does on the map.
  const moved = { id: 'y', source: 'u', target: 'p', sourceHandle: 'accepted', data: { sourceHandle: 'declined' } };
  assert.equal(lineKindOf(moved, nodes[1]), 'declined');
  assert.equal(drawnKind(moved, nodes), 'declined');
});

test('choosing a retention step turns retention flows back on only while they are hidden', () => {
  const cart = bp6.nodes.find(n => n.id === 'bp6-cart-recovery');
  const page = bp6.nodes.find(n => n.id === 'bp6-page');
  assert.equal(revealsHiddenStep(cart, false), true);
  assert.equal(revealsHiddenStep(cart, true), false);
  assert.equal(revealsHiddenStep(page, false), false);
  assert.equal(revealsHiddenStep(null, false), false);
});

test('the map pans only when a step is not fully in view, and never zooms out past the floor', () => {
  assert.equal(PAN_MARGIN, 24);
  assert.equal(MIN_FOCUS_ZOOM, 0.75);
  assert.equal(PAN_DURATION_MS, 280);
  const pane = { width: 1000, height: 600 };
  const rect = { x: 100, y: 100, width: 200, height: 100 };
  assert.equal(panTarget(rect, { x: 0, y: 0, zoom: 1 }, pane), null);
  // Off the right edge.
  assert.deepEqual(panTarget({ x: 950, y: 100, width: 200, height: 100 }, { x: 0, y: 0, zoom: 1 }, pane), { x: 1050, y: 150, zoom: 1 });
  // Inside the pane but within the margin counts as not fully in view.
  assert.notEqual(panTarget({ x: 10, y: 100, width: 200, height: 100 }, { x: 0, y: 0, zoom: 1 }, pane), null);
  // Zoom is raised to the floor, and kept when it is already above it.
  assert.equal(panTarget({ x: 3000, y: 100, width: 200, height: 100 }, { x: 0, y: 0, zoom: 0.5 }, pane).zoom, 0.75);
  assert.equal(panTarget({ x: 3000, y: 100, width: 200, height: 100 }, { x: 0, y: 0, zoom: 1.2 }, pane).zoom, 1.2);
  // A visible step at a low zoom is left alone: zoom is not raised for a visible step.
  assert.equal(panTarget(rect, { x: 0, y: 0, zoom: 0.4 }, pane), null);
  // A step larger than the pane is centred.
  assert.deepEqual(panTarget({ x: 0, y: 0, width: 2000, height: 1000 }, { x: 0, y: 0, zoom: 1 }, pane), { x: 1000, y: 500, zoom: 1 });
  // The viewport offset moves the screen rect.
  assert.equal(panTarget(rect, { x: -200, y: 0, zoom: 1 }, pane) !== null, true);
  assert.equal(panTarget(rect, { x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }), null);
});

const el = (classes, attrs = {}) => ({
  classList: { contains: c => classes.includes(c) },
  getAttribute: name => (name in attrs ? attrs[name] : null)
});

test('Enter or Space on a focused step opens it and Escape closes it; nothing else does', () => {
  const step = el(['react-flow__node', 'selectable'], { 'data-id': 'node-form-1' });
  assert.deepEqual(canvasKeyAction('Enter', step), { open: 'node-form-1' });
  assert.deepEqual(canvasKeyAction(' ', step), { open: 'node-form-1' });
  assert.deepEqual(canvasKeyAction('Escape', step), { close: 'node-form-1' });
  assert.equal(canvasKeyAction('Enter', el(['card-button'])), null);
  assert.equal(canvasKeyAction('Enter', el(['react-flow__edge'], { 'data-id': 'e1' })), null);
  assert.equal(canvasKeyAction('Enter', el(['react-flow__node'])), null);
  assert.equal(canvasKeyAction('a', step), null);
  assert.equal(canvasKeyAction('Backspace', step), null);
  assert.equal(canvasKeyAction('Enter', null), null);
});

test('both React Flow description keys carry the same step hint', () => {
  const text = 'Press Enter to open this step in the step panel. Backspace deletes the selected step.';
  assert.equal(STEP_ARIA_LABELS['node.a11yDescription.default'], text);
  assert.equal(STEP_ARIA_LABELS['node.a11yDescription.keyboardDisabled'], text);
});

test('the step hint names the panel by its label, never by where it sits', () => {
  // The panel is beside the map from 768px up and under it below that (src/index.css), but the
  // description is one string at every width, so a place word is wrong at one of them (C35).
  const hint = STEP_ARIA_LABELS['node.a11yDescription.default'];
  assert.doesNotMatch(hint, /\b(beside|next to|under|below|above|right|left)\b/i);
  // The name it uses is the docked panel's own accessible name, so a screen reader hears one name.
  const dock = readFileSync(new URL('./src/components/drawers/StepDock.tsx', import.meta.url), 'utf8');
  assert.match(dock, /<aside[^>]*aria-label="Step panel"/);
  assert.match(hint, /\bstep panel\b/);
});

test('no exported string has an em dash or a spaced en dash', () => {
  const strings = [];
  const walk = v => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [name, value] of Object.entries(nav)) if (typeof value !== 'function') walk(value);
  walk(stepKindLabel({ type: 'upsell', offerType: 'downsell' }));
  assert.ok(strings.length >= 4);
  for (const s of strings) {
    assert.ok(!s.includes('—'), s);
    assert.ok(!/\s–\s/.test(s), s);
  }
});
