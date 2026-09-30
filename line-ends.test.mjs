import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// C06: with Retention Flows hidden, Backspace on a step that has a line into a hidden retention
// step saved that line with its source gone. React Flow is given only the lines it draws, so it
// never sends a remove for a hidden one, and App replaced the nodes without looking at the lines.
// The line could not be seen, selected or deleted, and Check design gained a problem nobody could
// reach. src/lib/lineEnds.ts decides which lines survive, and App runs every change through it.

const { linesWithBothEnds } = await import('./src/lib/lineEnds.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dangling = (p) => {
  const ids = new Set(p.nodes.map(n => n.id));
  return p.edges.filter(e => !ids.has(e.source) || !ids.has(e.target)).map(e => e.id);
};

// App's two change handlers, as updaters over the project, exactly as App.tsx writes them (pinned below).
const app = {
  nodes: (nodes) => (p) => ({ ...p, nodes, edges: linesWithBothEnds(nodes, p.edges) }),
  edges: (edges) => (p) => ({ ...p, edges: linesWithBothEnds(p.nodes, edges) })
};
// The same handlers before the fix, to show the scenario below is the one that failed.
const before = {
  nodes: (nodes) => (p) => ({ ...p, nodes }),
  edges: (edges) => (p) => ({ ...p, edges })
};

/**
 * A keyboard delete of `stepId` as the canvas reports it: React Flow removes only the DISPLAYED
 * lines touching the step (JourneyCanvas displayedEdges leaves out every line into a hidden
 * retention step), and the canvas hands App the saved lines less those, and the saved steps less
 * the step. Both callbacks read the canvas's props, so both see the journey from before the delete.
 */
function keyboardDelete(handlers, project, stepId, { showRetention, order }) {
  const hidden = new Set(showRetention ? [] : project.nodes.filter(n => n.data?.isRetentionBranch).map(n => n.id));
  const displayed = project.edges.filter(e => !hidden.has(e.source) && !hidden.has(e.target));
  const rfRemoved = new Set(displayed.filter(e => e.source === stepId || e.target === stepId).map(e => e.id));
  const edgeCall = handlers.edges(project.edges.filter(e => !rfRemoved.has(e.id)));
  const nodeCall = handlers.nodes(project.nodes.filter(n => n.id !== stepId));
  const calls = order === 'edges-first' ? [edgeCall, nodeCall] : [nodeCall, edgeCall];
  if (rfRemoved.size === 0) calls.splice(calls.indexOf(edgeCall), 1); // no edge change is sent
  return calls.reduce((p, f) => f(p), project);
}

const bp6 = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
const journey = { id: 'j', name: 'bp6', nodes: bp6.nodes, edges: bp6.edges };

test('the finding: the old handlers save a line from the deleted step into a hidden retention step', () => {
  const after = keyboardDelete(before, journey, 'bp6-page', { showRetention: false, order: 'edges-first' });
  assert.deepEqual(dangling(after), ['e-bp6-3']);
});

for (const order of ['edges-first', 'nodes-first']) {
  for (const showRetention of [false, true]) {
    test(`keyboard delete saves no orphan line (retention ${showRetention ? 'shown' : 'hidden'}, ${order})`, () => {
      const after = keyboardDelete(app, journey, 'bp6-page', { showRetention, order });
      assert.deepEqual(after.nodes.map(n => n.id), ['bp6-ad', 'bp6-upsell', 'bp6-ty', 'bp6-cart-recovery', 'bp6-upsell-rescue']);
      assert.deepEqual(after.edges.map(e => e.id), ['e-bp6-4', 'e-bp6-5', 'e-bp6-6']);
      assert.deepEqual(dangling(after), []);
    });
  }
}

test('deleting a hidden-adjacent step keeps every line that still has both ends, in order', () => {
  const after = keyboardDelete(app, journey, 'bp6-upsell', { showRetention: false, order: 'edges-first' });
  assert.deepEqual(after.edges.map(e => e.id), ['e-bp6-1', 'e-bp6-3', 'e-bp6-6']);
  assert.deepEqual(dangling(after), []);
});

test('linesWithBothEnds keeps a whole journey as the same array and drops only orphan lines', () => {
  assert.equal(linesWithBothEnds(journey.nodes, journey.edges), journey.edges);
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'ax', source: 'a', target: 'x' },
    { id: 'xb', source: 'x', target: 'b' },
    { id: 'ba', source: 'b', target: 'a' }
  ];
  assert.deepEqual(linesWithBothEnds(nodes, edges).map(e => e.id), ['ab', 'ba']);
  assert.deepEqual(linesWithBothEnds([], edges), []);
});

test('a line drawn to a step added in the same change survives', () => {
  const next = [...journey.nodes, { id: 'new', type: 'thank-you', position: { x: 0, y: 0 }, data: { type: 'thank-you', label: 'New' } }];
  const line = { id: 'e-new', source: 'bp6-ty', target: 'new' };
  // The canvas's fallback when onGraphChange is absent: nodes first, then the lines.
  const fallback = [app.nodes(next), app.edges([...journey.edges, line])].reduce((p, f) => f(p), journey);
  assert.equal(fallback.edges.at(-1), line);
});

// handleGraphChange is left as it was: it only ever adds steps and lines, both from one snapshot.
test('App runs every node and line change through linesWithBothEnds', () => {
  const src = read('./src/App.tsx');
  assert.match(src, /import \{ linesWithBothEnds \} from '\.\/lib\/lineEnds';/);
  const body = (name) => {
    const at = src.indexOf(`const ${name} = (`);
    assert.ok(at >= 0, `${name} is defined`);
    return src.slice(at, src.indexOf('\n\n', at));
  };
  assert.match(body('handleNodesChange'), /edges: linesWithBothEnds\(nodes, p\.edges\)/);
  assert.match(body('handleEdgesChange'), /edges: linesWithBothEnds\(p\.nodes, edges\)/);
});
