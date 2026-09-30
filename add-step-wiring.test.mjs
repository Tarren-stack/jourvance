// Adding a step where the person works (#12), wired into the map. The rules live in
// src/lib/addStep.ts and are driven directly by add-step.test.mjs; these pins cover the part the
// integration lane owns: the header's Add Step places a step in a free slot instead of
// (n*280)%1200+100, every add from the map is ONE change through App.handleGraphChange (one undo
// step), the canvas opens the picker from + Before, + Next, + Step and a line let go on empty map,
// a loose step dropped on a line goes onto it, and the cards stop inventing figures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const A = await import('./src/lib/addStep.ts');
const D = await import('./src/lib/stepDefaults.ts');

const read = p => fs.readFileSync(p, 'utf8');
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const EM_DASH = /—|\s–\s/;
const app = read('src/App.tsx');
const canvas = read('src/components/canvas/JourneyCanvas.tsx');
const edge = read('src/components/canvas/edges/ConversionEdge.tsx');

// The body of `const name = ...` up to the next top-level const in the component.
function block(src, name) {
  const m = new RegExp(`const ${name}\\s*[:=]`).exec(src);
  assert.ok(m, `${name} is defined`);
  const start = m.index;
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

test('the header Add Step places a step in a free slot and selects it', () => {
  assert.ok(!app.includes('(project.nodes.length * 280) % 1200'), 'the old formula is gone');
  const add = block(app, 'handleAddNode');
  assert.match(add, /makeStep\(type, slotForNewStep\(project\.nodes, canvasView\.current\), newStamp\(\)\)/);
  assert.match(add, /setSelectedNodeId\(node\.id\)/);
  // The invented upsell and thank-you copy moved to stepDefaults.ts and was replaced there.
  for (const bad of ['VIPOTO40', 'VIPRETURN', 'Bioactive', 'unsplash']) assert.ok(!app.includes(bad), bad);
});

test('every add from the map is one setProject through handleGraphChange', () => {
  const change = block(app, 'handleGraphChange');
  assert.equal(change.match(/setProject\(/g)?.length, 1);
  assert.match(change, /nodes, edges, updatedAt/);
  assert.match(app, /onGraphChange=\{handleGraphChange\}/);
  assert.match(app, /canvasViewRef=\{canvasView\}/);
  // The canvas calls it once per add, and falls back to the two old callbacks only without it.
  const apply = block(canvas, 'applyGraph');
  assert.equal(apply.match(/onGraphChange\(/g)?.length, 1);
  assert.match(apply, /if \(onGraphChange\) onGraphChange\(nextNodes, nextEdges\);\s*else \{/);
});

test('a chosen step is checked by #13 before it is committed, and a refusal keeps the picker open', () => {
  const choose = block(canvas, 'chooseStep');
  assert.match(choose, /planAdd\(picker\.request, row\.key, planNodes, edges, newStamp\(\)\)/);
  assert.match(choose, /checkPlan\(plan, nodes, edges\)/);
  assert.match(choose, /note: reason/);
  assert.match(choose, /applyGraph\(\[\.\.\.persistedNodes\(\), plan\.node\], plan\.edges, plan\.node\.id, plan\.summary\)/);
  // What is saved is the parent's nodes at live positions, never rfNodes with view-only fields.
  assert.match(block(canvas, 'persistedNodes'), /return nodes\.map\(/);
});

test('a line drawn by hand is built by makeLine, the shape the picker uses', () => {
  const commit = block(canvas, 'commitConnection');
  assert.match(commit, /const newEdge = makeLine\(/);
  assert.match(commit, /sourceNode\?\.data\s*\)/);
  assert.ok(!commit.includes('Date.now()'), 'the id comes from makeLine');
  assert.match(commit, /withConnection\(edges, newEdge, replaced\)/);
});

test('a line let go on empty map opens the picker, and only on the bare pane', () => {
  assert.match(canvas, /onConnectEnd=\{handleConnectEnd\}/);
  const end = block(canvas, 'handleConnectEnd');
  assert.match(end, /document\.elementFromPoint\(point\.clientX, point\.clientY\)/);
  assert.match(end, /classList\.contains\('react-flow__pane'\)/);
  assert.match(end, /canvasRef\.current\?\.contains\(hit\)/);
  assert.match(end, /direction: 'next', anchorId, handle: state\.fromHandle\.id \?\? null, at \}, lockedExit: true/);
  assert.match(end, /direction: 'before', anchorId, at \}, lockedExit: true/);
  assert.match(end, /Retention flows start from the bottom dot of a page or an offer\./);
  // A successful connection or a refused one never opens the picker.
  assert.ok(end.indexOf('state.isValid === false') < end.indexOf('setPicker('));
  assert.match(end, /if \(state\.isValid \|\| !state\.fromNode/);
});

test('+ Before and + Next sit on the selected step with named buttons', () => {
  // They render inside the selected step's own wrapper (StepAddSlot, C34), above its top-right corner,
  // so Tab reaches them right after that step. The slot takes no clicks; the pills do.
  const slot = canvas.slice(canvas.indexOf('const StepAddSlot'), canvas.indexOf('function withStepAdd'));
  assert.match(slot, /data-step-add=\{nodeId\}/);
  assert.match(slot, /className="nodrag nopan nokey"/);
  assert.match(slot, /right: 0,\s*bottom: '100%'/);
  assert.match(slot, /pointerEvents: 'none'/);
  assert.match(slot, /transform: `scale\(\$\{1 \/ zoom\}\)`/);
  assert.match(canvas, /pointerEvents: 'auto'/);
  assert.doesNotMatch(canvas, /<NodeToolbar/);
  assert.match(canvas, /aria-label=\{`Add a step before \$\{stepName\(toolbarStep\)\}`\}/);
  assert.match(canvas, /aria-label=\{`Add a step after \$\{stepName\(toolbarStep\)\}`\}/);
  assert.match(canvas, /handle: defaultExit\(toolbarStep, nodes, edges\) \?\? null \}, false\)/);
  assert.match(canvas, /const canAddBefore = !!toolbarPorts\?\.inputs\.some\(p => p\.handle === null\)/);
  assert.match(canvas, /const canAddNext = !!toolbarPorts && toolbarPorts\.exits\.length > 0/);
  // The ports decide which buttons show: an ad has no way in, a thank-you page no way on.
  assert.equal(A.STEP_PORTS['ad-source'].inputs.length, 0);
  assert.equal(A.STEP_PORTS['thank-you'].exits.length, 0);
});

test('a selected line offers + Step, which opens the picker on that line', () => {
  assert.match(edge, /\{isSelected && d\?\.onAddStep && \(/);
  assert.match(edge, /aria-label="Add a step on this line"/);
  assert.match(edge, /e\.stopPropagation\(\);\s*d\.onAddStep\?\.\(id\);/);
  assert.match(canvas, /onAddStep: \(id: string\) => setPicker\(\{ request: \{ direction: 'between', edgeId: id \}, lockedExit: true \}\)/);
  assert.match(read('src/types/journey.ts'), /onAddStep\?: \(id: string\) => void;/);
});

test('a loose step dropped on a line goes onto it; a connected or grouped drag never rewires', () => {
  assert.match(canvas, /onNodeDragStart=\{handleNodeDragStart\}/);
  assert.match(canvas, /onNodeDrag=\{handleNodeDrag\}/);
  const start = block(canvas, 'handleNodeDragStart');
  assert.match(start, /if \(dragged\.length !== 1 \|\| edges\.some\(e => e\.source === node\.id \|\| e\.target === node\.id\)\) return;/);
  assert.match(start, /path\.react-flow__edge-path/);
  assert.match(block(canvas, 'handleNodeDrag'), /nearestLine\(centre, samples, Math\.min\(size\.width, size\.height\) \/ 2\)/);
  const stop = block(canvas, 'handleNodeDragStop');
  assert.match(stop, /dropOnLine\(moved, edges, lineId, node\.id, newStamp\(\)\)/);
  assert.match(stop, /checkPlan\(plan, moved, edges\)/);
  // With no line under it, a drag saves the saved steps at their new positions (C36).
  assert.match(stop, /onNodesChange\(persistedNodes\(dragged\)\.map\(stripA11yDecorations\)/);
  // The line under the step thickens past the selected width.
  assert.match(canvas, /strokeWidth: EDGE_WIDTH_SELECTED \+ 1\.5/);
});

test('a new step is selected, focused, and turns hidden retention flows back on', () => {
  const apply = block(canvas, 'applyGraph');
  assert.match(apply, /onSelectNode\(step\)/);
  assert.match(apply, /isRetentionStep\(step\.data\) && !effectiveShowRetention/);
  assert.match(apply, /onToggleRetentionBranches\?\.\(true\)/);
  assert.ok(!/onToggleRetentionBranches\?\.\(false\)|onToggleRetentionBranches\?\.\(!/.test(apply), 'it never toggles off');
  assert.match(apply, /focusCard\(stepId\)/);
  assert.match(block(canvas, 'focusCard'), /\.react-flow__node\[data-id="\$\{CSS\.escape\(id\)\}"\]/);
  // No second pan: FocusSelectedStep (#7) is the one that brings a selected step into view.
  assert.equal((canvas.match(/setCenter\(/g) || []).length, 1);
});

test('the added notice is a status line that clears after 6 s', () => {
  assert.match(canvas, /tone: 'added', text: summary/);
  assert.match(canvas, /window\.setTimeout\(\(\) => setRuleNotice\(n => \(n === shown \? null : n\)\), 6000\)/);
  const at = canvas.indexOf('data-rule-notice=');
  assert.match(canvas.slice(canvas.lastIndexOf('bottom: 116', at), at), /role="status"/);
});

test('the header reads the view on screen now, not when the map was first drawn', () => {
  assert.match(block(canvas, 'reportView'), /get center\(\)/);
  // The same getter shape, fed to the placement rule, centres the new step on the view.
  let reads = 0;
  const view = { get center() { reads++; return { x: 5000, y: 5000 }; }, sizeOf: () => undefined };
  const at = A.slotForNewStep([], view);
  assert.ok(reads > 0);
  assert.deepEqual(at, { x: 5000 - D.STEP_SIZE.width / 2, y: 5000 - D.STEP_SIZE.height / 2 });
});

test('the cards stop inventing figures', () => {
  const upsell = read('src/components/canvas/nodes/UpsellNode.tsx');
  for (const bad of ['Bioactive Triple Barrier Reserve', "'$38.00'", "'$24.00'", "'SAVE 40%'", "'SAVE 50%'", '1-Tap Discount Applied', 'Deluxe Travel Ritual Duo']) {
    assert.ok(!upsell.includes(bad), bad);
  }
  for (const plain of ["'No headline yet'", "'No product chosen'", "'No price set'", "'No discount code'"]) assert.ok(upsell.includes(plain), plain);
  const thanks = read('src/components/canvas/nodes/ThankYouNode.tsx');
  for (const bad of ["'VIPRETURN'", "'$15 off next order'", "'VIP Portal'", '|| 3', 'Your VIP Allocation is Confirmed']) assert.ok(!thanks.includes(bad), bad);
  assert.match(thanks, /\{d\.bounceBackDiscountCode && \(/);
  assert.match(thanks, /\{stepsCount > 0 && \(/);
  assert.match(thanks, /'No headline yet'/);
});

test('the picker and pills have a visible focus ring and a dimmed backdrop', () => {
  const css = read('src/index.css');
  assert.match(css, /\.jv-step-picker::backdrop \{\s*background: rgba\(2, 6, 23, 0\.6\);/);
  assert.match(css, /\.jv-step-picker :is\(button, input, select\):focus-visible,\s*\.jv-add-next:focus-visible \{/);
});

test('no text this item added carries an em dash or a spaced en dash, or sits below 11px', () => {
  for (const src of [canvas, edge, read('src/components/canvas/nodes/UpsellNode.tsx'), read('src/components/canvas/nodes/ThankYouNode.tsx')]) {
    for (const phrase of ['+ Before', '+ Next', '+ Step', 'Add a step', 'Release to put', 'No product chosen', 'No headline yet']) {
      for (const line of src.split('\n').filter(l => l.includes(phrase))) assert.doesNotMatch(line, EM_DASH, line);
    }
  }
  const pill = canvas.slice(canvas.indexOf('const addPill'), canvas.indexOf('};', canvas.indexOf('const addPill')));
  assert.match(pill, /fontSize: '11px'/);
  assert.doesNotMatch(code(canvas), /Release to put[^`]*—/);
});
