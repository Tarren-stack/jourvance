import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tidy layout (#14): one button arranges the steps into ranked columns. Only positions change: a
// line's source handle IS the branch in Jourvance, so the tidy must never rewrite a line, and a
// saved node keeps its id, type and data. Undo goes through the one history stack (#8).

const {
  tidyPositions, applyPositions, positionsOf, nodesAt, nodeSize, leavesDownward,
  HANDLE_Y_FRACTION, COLUMN_GAP, ROW_GAP, LANE_GAP, LOOSE_GAP, LAYOUT_ORIGIN, DEFAULT_NODE_SIZE
} = await import('./src/lib/journeyLayout.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { onlyPositionsDiffer } = await import('./src/lib/journeyHistory.ts');

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const clone = o => JSON.parse(JSON.stringify(o));
const bp = prefix => clone(ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id.startsWith(`${prefix}-`))));
const journeys = () => [
  ...ECOM_BLUEPRINTS.map(b => ({ name: b.id, nodes: clone(b.nodes), edges: clone(b.edges) })),
  { name: 'default', nodes: clone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes), edges: clone(DEFAULT_LEAD_CAPTURE_PROJECT.edges) }
];

const deepFreeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

const node = (id, type, x, y, data = {}) => ({ id, type, position: { x, y }, data: { type, label: id, ...data } });
const link = (source, target, sourceHandle = null, targetHandle = null) => ({
  id: `e-${source}-${target}-${sourceHandle || ''}`, source, target, sourceHandle, targetHandle
});

const rect = (n, sizes) => {
  const s = nodeSize(n, sizes);
  return { x: n.position.x, y: n.position.y, w: s.width, h: s.height };
};
const rectsOf = (nodes, pos, sizes) => new Map(nodes.map(n => [n.id, rect({ ...n, position: pos.get(n.id) }, sizes)]));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const assertNoOverlap = (rects, label) => {
  const list = [...rects];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      assert.ok(!overlaps(list[i][1], list[j][1]), `${label}: ${list[i][0]} overlaps ${list[j][0]}`);
    }
  }
};
const centreX = r => r.x + r.w / 2;
const centreY = r => r.y + r.h / 2;

test('only positions change', () => {
  for (const j of journeys()) {
    const nodes = deepFreeze(clone(j.nodes));
    const edges = deepFreeze(clone(j.edges));
    const pos = tidyPositions(nodes, edges);
    assert.ok(pos instanceof Map, j.name);
    assert.deepEqual([...pos.keys()].sort(), nodes.map(n => n.id).sort(), j.name);
    for (const p of pos.values()) {
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), `${j.name}: integer position`);
    }
    const moved = applyPositions(nodes, pos);
    moved.forEach((n, i) => {
      assert.equal(n.data, nodes[i].data, `${j.name}: data kept by reference`);
      assert.deepEqual({ ...n, position: null }, { ...nodes[i], position: null }, `${j.name}: only position differs`);
      assert.deepEqual(n.position, pos.get(n.id));
    });
    assert.deepEqual(edges, clone(j.edges), `${j.name}: edges untouched`);
  }
});

test('ranked columns: every forward line runs left to right past the gap', () => {
  const variants = [
    nodes => nodes.map(n => ({ ...n, measured: { width: 280, height: 360 } })),
    nodes => nodes.map((n, i) => ({ ...n, measured: { width: [261, 283, 297][i % 3], height: 300 + 37 * i } }))
  ];
  for (const prefix of ['bp5', 'bp6', 'default']) {
    for (const vary of variants) {
      const src = prefix === 'default' ? clone(DEFAULT_LEAD_CAPTURE_PROJECT) : bp(prefix);
      const nodes = vary(src.nodes);
      const pos = tidyPositions(nodes, src.edges);
      const rects = rectsOf(nodes, pos);
      for (const e of src.edges) {
        if (leavesDownward(e)) continue;
        const s = rects.get(e.source);
        const t = rects.get(e.target);
        assert.ok(t.x >= s.x + s.w + COLUMN_GAP - 1, `${prefix} ${e.id}: ${t.x} >= ${s.x + s.w + COLUMN_GAP}`);
      }
      assertNoOverlap(rects, prefix);
    }
  }
});

test('retention lane under its source', () => {
  const b = bp('bp6');
  const widths = { 'bp6-page': 297, 'bp6-cart-recovery': 261, 'bp6-upsell': 283, 'bp6-upsell-rescue': 300 };
  for (const nodes of [b.nodes, b.nodes.map(n => ({ ...n, measured: { width: widths[n.id] || 280, height: 350 } }))]) {
    const pos = tidyPositions(nodes, b.edges);
    const rects = rectsOf(nodes, pos);
    const mainBottom = Math.max(
      ...['bp6-ad', 'bp6-page', 'bp6-upsell', 'bp6-ty'].map(id => rects.get(id).y + rects.get(id).h)
    );
    for (const [child, parent] of [['bp6-cart-recovery', 'bp6-page'], ['bp6-upsell-rescue', 'bp6-upsell']]) {
      assert.ok(Math.abs(centreX(rects.get(child)) - centreX(rects.get(parent))) <= 1, `${child} under ${parent}`);
      assert.ok(rects.get(child).y >= mainBottom + LANE_GAP, `${child} sits in the retention lane`);
    }
    assert.ok(rects.get('bp6-ty').x >= rects.get('bp6-upsell').x + rects.get('bp6-upsell').w + COLUMN_GAP - 1);
  }
});

test('straight main path on the default journey', () => {
  const { nodes, edges } = clone(DEFAULT_LEAD_CAPTURE_PROJECT);
  const sized = nodes.map((n, i) => ({ ...n, measured: { width: 280, height: 250 + 31 * i } }));
  for (const list of [nodes, sized]) {
    const rects = rectsOf(list, tidyPositions(list, edges));
    const ys = [...rects.values()].map(centreY);
    assert.ok(Math.max(...ys) - Math.min(...ys) <= 1, `centres share one line: ${ys}`);
    for (const e of edges) assert.ok(rects.get(e.target).x > rects.get(e.source).x);
  }
});

test('sibling order follows the handle', () => {
  const nodes = [
    node('ad', 'ad-source', 0, 0),
    node('split', 'ab-split', 300, 0),
    node('p1', 'landing-page', 600, 0),
    node('p2', 'landing-page', 600, 500)
  ];
  const edges = [link('ad', 'split'), link('split', 'p1', 'branch-b'), link('split', 'p2', 'branch-a')];
  const pos = tidyPositions(nodes, edges);
  assert.equal(pos.get('p1').x, pos.get('p2').x, 'one column');
  assert.ok(pos.get('p2').y < pos.get('p1').y, 'branch A above branch B');

  const up = [
    node('u', 'upsell', 0, 0),
    node('no', 'thank-you', 300, 0),
    node('yes', 'thank-you', 300, 600)
  ];
  const upEdges = [link('u', 'no', 'declined'), link('u', 'yes', 'accepted')];
  const upPos = tidyPositions(up, upEdges);
  assert.equal(upPos.get('yes').x, upPos.get('no').x);
  assert.ok(upPos.get('yes').y < upPos.get('no').y, 'accepted above declined');
  assert.ok(HANDLE_Y_FRACTION.accepted < HANDLE_Y_FRACTION.declined);
});

test('parallel branches keep the user order on a tie', () => {
  const b = bp('bp1');
  let pos = tidyPositions(b.nodes, b.edges);
  assert.equal(pos.get('bp1-seq').x, pos.get('bp1-ty').x, 'one column');
  assert.ok(pos.get('bp1-seq').y < pos.get('bp1-ty').y, 'seq (y 150) above ty (y 360)');
  const swapped = b.nodes.map(n =>
    n.id === 'bp1-seq' ? { ...n, position: { x: 800, y: 360 } } : n.id === 'bp1-ty' ? { ...n, position: { x: 800, y: 150 } } : n
  );
  pos = tidyPositions(swapped, b.edges);
  assert.ok(pos.get('bp1-ty').y < pos.get('bp1-seq').y, 'swapping the current y swaps the result');
});

test('same-column drop-down chain puts the child under its parent', () => {
  const nodes = [
    node('ad', 'ad-source', 0, 0),
    node('page', 'landing-page', 300, 0),
    node('r2', 'follow-up-sequence', 300, 100),
    node('r1', 'follow-up-sequence', 300, 900)
  ];
  const edges = [
    link('ad', 'page'),
    link('page', 'r1', 'abandon', 'retention-in'),
    link('r1', 'r2', 'rescue', 'retention-in')
  ];
  // The second run also feeds R2 from the ad, which scores it above R1: the chain rule still wins.
  for (const list of [edges, [...edges, link('ad', 'r2')]]) {
    const pos = tidyPositions(nodes, list);
    assert.equal(pos.get('r1').x, pos.get('page').x);
    assert.equal(pos.get('r2').x, pos.get('page').x);
    assert.ok(pos.get('r2').y >= pos.get('r1').y + DEFAULT_NODE_SIZE.height + ROW_GAP, 'R2 sits under R1');
    assert.ok(pos.get('r1').y >= pos.get('page').y + DEFAULT_NODE_SIZE.height + LANE_GAP, 'R1 sits under the page');
  }
});

function pile() {
  const b = bp('bp6');
  const down = bp('bp5').nodes.find(n => n.id === 'bp5-downsell');
  const nodes = [
    ...b.nodes,
    down,
    node('ab-ad', 'ad-source', 0, 0),
    node('ab', 'ab-split', 0, 0),
    node('ab-a', 'landing-page', 0, 0),
    node('ab-b', 'landing-page', 0, 0)
  ].map(n => ({ ...n, position: { x: 100, y: 100 } }));
  const edges = [
    ...b.edges,
    link('bp6-upsell', 'bp5-downsell', 'declined'),
    link('bp5-downsell', 'bp6-ty', 'accepted'),
    link('ab-ad', 'ab'),
    link('ab', 'ab-a', 'branch-a'),
    link('ab', 'ab-b', 'branch-b')
  ];
  return { nodes, edges };
}

test('no overlaps even from a pile', () => {
  const { nodes, edges } = pile();
  const pos = tidyPositions(nodes, edges);
  const rects = rectsOf(nodes, pos);
  assertNoOverlap(rects, 'pile');
  const byColumn = new Map();
  for (const [id, r] of rects) byColumn.set(r.x + r.w / 2, [...(byColumn.get(r.x + r.w / 2) || []), [id, r]]);
  for (const column of byColumn.values()) {
    column.sort((a, b) => a[1].y - b[1].y);
    for (let i = 1; i < column.length; i++) {
      const [upper, lower] = [column[i - 1][1], column[i][1]];
      assert.ok(lower.y >= upper.y + upper.h + ROW_GAP, `${column[i][0]} is ROW_GAP under ${column[i - 1][0]}`);
    }
  }
});

test('measured sizes are honoured, from the node or from the size cache', () => {
  const b = bp('bp1');
  const tall = b.nodes.map(n => (n.id === 'bp1-seq' ? { ...n, measured: { width: 300, height: 700 } } : n));
  const fromMeasured = tidyPositions(tall, b.edges);
  const sizes = new Map([['bp1-seq', { width: 300, height: 700 }]]);
  const fromCache = tidyPositions(b.nodes, b.edges, sizes);
  assert.deepEqual(fromCache, fromMeasured);
  assert.ok(fromMeasured.get('bp1-ty').y >= fromMeasured.get('bp1-seq').y + 700 + ROW_GAP);
  assertNoOverlap(rectsOf(b.nodes, fromCache, sizes), 'sized');
  // measured wins over the cache, the cache over width/height, and the default only as a last resort.
  const n = { id: 'x', position: { x: 0, y: 0 }, measured: { width: 10, height: 20 }, width: 50, height: 60 };
  assert.deepEqual(nodeSize(n, new Map([['x', { width: 30, height: 40 }]])), { width: 10, height: 20 });
  assert.deepEqual(nodeSize({ ...n, measured: undefined }, new Map([['x', { width: 30, height: 40 }]])), { width: 30, height: 40 });
  assert.deepEqual(nodeSize({ ...n, measured: { width: 0, height: NaN } }), { width: 50, height: 60 });
  assert.deepEqual(nodeSize({ id: 'y', position: { x: 0, y: 0 } }), DEFAULT_NODE_SIZE);
});

test('idempotent: tidying a tidy map moves nothing', () => {
  for (const j of [...journeys(), { name: 'pile', ...pile() }]) {
    const first = tidyPositions(j.nodes, j.edges);
    const tidied = applyPositions(j.nodes, first);
    assert.deepEqual(tidyPositions(tidied, j.edges), first, j.name);
    assert.ok(nodesAt(tidied, tidyPositions(tidied, j.edges)), j.name);
  }
});

test('cycles, dangling and self links', () => {
  const b = bp('bp6');
  const edges = [...b.edges, link('bp6-ty', 'bp6-ad'), link('bp6-page', 'missing'), link('bp6-upsell', 'bp6-upsell')];
  const pos = tidyPositions(b.nodes, edges);
  assert.equal(pos.size, b.nodes.length);
  const keys = new Set();
  for (const p of pos.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    keys.add(`${p.x},${p.y}`);
  }
  assert.equal(keys.size, b.nodes.length, 'no two positions coincide');
  assertNoOverlap(rectsOf(b.nodes, pos), 'cycle');
  const loop = ['bp6-ad', 'bp6-page', 'bp6-upsell', 'bp6-ty', 'bp6-upsell-rescue'];
  const cx = loop.map(id => pos.get(id).x + DEFAULT_NODE_SIZE.width / 2);
  assert.ok(cx.every(v => v === cx[0]), 'cycle members share a column');
});

test('unconnected steps are set aside in a row below', () => {
  const b = bp('bp6');
  const without = tidyPositions(b.nodes, b.edges);
  const orphan = { ...node('orphan', 'landing-page', 0, 0), measured: { width: 900, height: 300 } };
  const orphan2 = node('orphan2', 'thank-you', 0, 0);
  const nodes = [orphan, ...b.nodes, orphan2];
  const withOrphan = tidyPositions(nodes, b.edges);
  for (const n of b.nodes) assert.deepEqual(withOrphan.get(n.id), without.get(n.id), `${n.id} did not move`);
  const connectedBottom = Math.max(...b.nodes.map(n => without.get(n.id).y + DEFAULT_NODE_SIZE.height));
  assert.ok(withOrphan.get('orphan').y >= connectedBottom + LANE_GAP);
  assert.equal(withOrphan.get('orphan').x, LAYOUT_ORIGIN.x);
  assert.equal(withOrphan.get('orphan2').x, LAYOUT_ORIGIN.x + 900 + LOOSE_GAP);
  assert.equal(withOrphan.get('orphan2').y, withOrphan.get('orphan').y);
});

test('undo helpers', () => {
  const b = bp('bp6');
  assert.deepEqual(applyPositions(b.nodes, positionsOf(b.nodes)), b.nodes);
  const partial = new Map([['bp6-ad', { x: 5, y: 6 }], ['ghost', { x: 1, y: 1 }]]);
  const moved = applyPositions(b.nodes, partial);
  assert.deepEqual(moved[0].position, { x: 5, y: 6 });
  assert.equal(moved[1], b.nodes[1], 'a node with no entry is the same object');
  assert.equal(moved.length, b.nodes.length, 'unknown ids ignored');
  // positionsOf copies, so moving a node later cannot change a saved Undo.
  const saved = positionsOf(b.nodes);
  b.nodes[0].position.x = 9999;
  assert.notEqual(saved.get('bp6-ad').x, 9999);

  const after = tidyPositions(b.nodes, b.edges);
  const tidied = applyPositions(b.nodes, after);
  assert.ok(nodesAt(tidied, after));
  const nudged = tidied.map((n, i) => (i === 2 ? { ...n, position: { x: n.position.x + 1, y: n.position.y } } : n));
  assert.equal(nodesAt(nudged, after), false, 'a 1px move withdraws the offer');
  assert.equal(nodesAt(tidied.slice(1), after), false, 'a delete withdraws the offer');
  assert.ok(nodesAt([...tidied, node('new', 'thank-you', 7, 7)], after), 'an added step keeps it');
});

test('empty and single', () => {
  assert.deepEqual(tidyPositions([], []), new Map());
  const one = tidyPositions([node('solo', 'landing-page', 400, 300)], []);
  assert.deepEqual(one, new Map([['solo', { ...LAYOUT_ORIGIN }]]));
});

test('leavesDownward is the one drop-down rule', () => {
  assert.ok(leavesDownward({ source: 'a', target: 'b', sourceHandle: 'abandon' }));
  assert.ok(leavesDownward({ source: 'a', target: 'b', sourceHandle: 'rescue' }));
  assert.ok(leavesDownward({ source: 'a', target: 'b', targetHandle: 'retention-in' }));
  assert.equal(leavesDownward({ source: 'a', target: 'b', sourceHandle: 'declined' }), false);
  assert.equal(leavesDownward({ source: 'a', target: 'b' }), false);
});

test('the notice Undo only reuses history while the tidy is the latest change', () => {
  const b = bp('bp6');
  const project = { id: 'j', name: 'J', updatedAt: 't0', nodes: b.nodes, edges: b.edges };
  const tidied = { ...project, updatedAt: 't1', nodes: applyPositions(b.nodes, tidyPositions(b.nodes, b.edges)) };
  assert.ok(onlyPositionsDiffer(project, tidied), 'a tidy is a move only');
  const edited = { ...tidied, nodes: tidied.nodes.map((n, i) => (i === 0 ? { ...n, data: { ...n.data, label: 'Renamed' } } : n)) };
  assert.equal(onlyPositionsDiffer(project, edited), false, 'a data edit on top is not');
  assert.equal(onlyPositionsDiffer(project, { ...tidied, name: 'Other' }), false, 'a rename on top is not');
  assert.equal(onlyPositionsDiffer(project, { ...tidied, edges: b.edges.slice(1) }), false, 'a removed line is not');
  // Live counts and the view's own bookkeeping are not content (the history fingerprint drops them).
  const polled = { ...tidied, nodes: tidied.nodes.map(n => ({ ...n, measured: { width: 1, height: 1 }, selected: true })) };
  assert.ok(onlyPositionsDiffer(project, polled));

  const hook = read('./src/lib/useJourneyEditing.ts');
  const body = hook.slice(hook.indexOf('const undoMove'), hook.indexOf('useEffect(', hook.indexOf('const undoMove')));
  assert.match(body, /undoStep\(historyRef\.current/);
  assert.match(body, /onlyPositionsDiffer\(/);
  assert.match(body, /nodesAt\(/);
  assert.match(body, /apply\(step\)/);
  assert.match(read('./src/App.tsx'), /onUndoMove=\{editing\.undoMove\}/);
});

test('canvas wiring', () => {
  const src = read('./src/components/canvas/JourneyCanvas.tsx');
  assert.match(src, /import \{[^}]*\btidyPositions\b[^}]*\bapplyPositions\b[^}]*\} from '\.\.\/\.\.\/lib\/journeyLayout'/);
  assert.match(src, />Tidy layout</);
  const tidy = src.slice(src.indexOf('const handleTidyLayout'), src.indexOf('const handleUndoTidy'));
  assert.ok(tidy.length > 0);
  assert.match(tidy, /onNodesChange\(/);
  assert.match(tidy, /measuredSizes/);
  assert.doesNotMatch(tidy, /onEdgesChange\(/);
  assert.doesNotMatch(tidy, /setRfEdges\(/);
  const undo = src.slice(src.indexOf('const handleUndoTidy'), src.indexOf('const dismissTidyNote'));
  assert.match(undo, /onUndoMove\?\.\(note\.before\)/, 'Undo asks the one history stack first');
  assert.doesNotMatch(undo, /onEdgesChange\(|setRfEdges\(/);
  assert.match(src, /role="status"/);
  assert.match(src, /onInit=/);
  const button = src.slice(src.indexOf('ref={tidyButtonRef}'), src.indexOf('<span>Tidy layout</span>'));
  assert.doesNotMatch(button, /outline:/);
  const pill = src.slice(src.indexOf('const toolPill'), src.indexOf('const noteButton'));
  assert.doesNotMatch(pill, /outline:/);
  for (const text of ['Layout tidied.', 'Already tidy. Nothing moved.', 'Tidy layout', 'Undo tidy layout', 'Dismiss message']) {
    assert.ok(src.includes(text), text);
    assert.doesNotMatch(text, /—| – /);
  }
  assert.doesNotMatch(src, /—/);
});
