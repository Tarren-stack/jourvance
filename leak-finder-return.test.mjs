import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The leak finder's integration (#20 in w3-spine-2): its "Show <step> on the map" button returns
// through App.selectStep, the one step chooser (#7), and its rows name a step's type with the same
// words the finder and the docked panel use.

const { stepKindLabel } = await import('./src/lib/leakFinder.ts');
const nav = await import('./src/lib/stepNavigation.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const TYPES = ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split'];

test('a leak row names its step type exactly as the finder does', () => {
  for (const type of TYPES) {
    const node = { id: type, type, position: { x: 0, y: 0 }, data: { type, label: 'x' } };
    assert.equal(stepKindLabel(node), nav.stepKindLabel(node.data), type);
  }
  const down = { id: 'd', type: 'upsell', position: { x: 0, y: 0 }, data: { type: 'upsell', offerType: 'downsell' } };
  assert.equal(stepKindLabel(down), 'Downsell');
  assert.equal(stepKindLabel(down), nav.stepKindLabel(down.data));
  for (const n of DEFAULT_LEAD_CAPTURE_PROJECT.nodes) assert.equal(stepKindLabel(n), nav.stepKindLabel(n.data), n.id);
});

test('a node whose data lacks its type is still named by the node type', () => {
  const node = { id: 's', type: 'follow-up-sequence', position: { x: 0, y: 0 }, data: { label: 'Nurture' } };
  assert.equal(stepKindLabel(node), nav.stepKindLabel({ type: 'follow-up-sequence' }));
  assert.notEqual(stepKindLabel(node), 'Step');
});

test('leakFinder reads the one naming rule rather than a second table', () => {
  const src = read('./src/lib/leakFinder.ts');
  assert.match(src, /from '\.\/stepNavigation\.ts'/);
  assert.ok(!src.includes('KIND_LABEL'), 'no private copy of the type names');
});

test('the Attribution button returns to the map through selectStep', () => {
  const src = read('./src/App.tsx');
  const start = src.indexOf('<AttributionReports');
  const el = src.slice(start, src.indexOf('/>', start));
  const handler = el.slice(el.indexOf('onSelectStep='));
  assert.match(handler, /selectStep\(nodeId\)/, 'the choice goes through App.selectStep');
  assert.ok(!/setSelectedNodeId\(/.test(handler), 'no second way to choose a step');
  assert.ok(!/setSelectedEdgeId\(/.test(handler), 'selectStep already clears the line');
  assert.ok(handler.indexOf('selectStep(nodeId)') < handler.indexOf("setActiveView('canvas')"));
  // An id the journey no longer holds changes nothing.
  assert.match(handler, /project\.nodes\.some\(n => n\.id === nodeId\)\) return;/);
});
