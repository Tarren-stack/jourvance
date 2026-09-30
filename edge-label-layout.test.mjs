// Caption placement (#24): a line's rate pill stays on its line when it fits there, otherwise it
// moves just clear of every card, handle and earlier caption and a leader points back to its line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSmoothStepPath } from '@xyflow/system';
import {
  pathPoints,
  pathLength,
  pointAlong,
  distanceToPath,
  boxesOverlap,
  nodeGeometry,
  obstaclesFor,
  geometryKey,
  placeEdgeLabels,
  placementFits,
  samePlacements,
  findCollisions,
  LEADER_COLOR,
  LABEL_GAP,
  HANDLE_CLEARANCE,
  LEADER_ALONG_OFFSET,
  leaderRunsAlong,
  VIEWPORT_PORTAL_SELECTOR,
  viewportPortalOf,
  placeStepAdd,
  boxGap,
  ADD_SLOT_GAP,
  ADD_SLOT_MAX_MOVE,
  CAPTION_MAX_MOVE,
  scaleBox,
  screenBoxToFlow,
  placeStepAddZoomed,
  ADD_SLOT_FAR_MOVE,
  placeBadges,
  BADGE_HANDLE_CLEARANCE,
  BADGE_OWN_HANDLE_CLEARANCE,
  BADGE_DOT_SCALE,
  mapEdgeBands,
  rectToBox,
  intersectRects,
  ADD_SLOT_CLOSE_GAP,
  ADD_SLOT_OWN_MARGIN,
  STEP_ADD_FALLBACKS
} from './src/lib/edgeLabelLayout.ts';
import { captionLayoutScale, captionScale } from './src/lib/semanticZoom.ts';
import { EDGE_KINDS } from './src/lib/edgeKinds.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';
import { ECOM_BLUEPRINTS, BLUEPRINT_CARD_HEIGHTS } from './src/data/ecomBlueprints.ts';

// ---- Fixtures that mirror the node components -------------------------------------------------

// Every handle is 10x10 and centred 6px outside its card side (style left/right/top/bottom -6
// plus React Flow's centring translate). [id, side, fraction along that side]; null = main.
const HANDLES = {
  'ad-source': { source: [[null, 'right', 0.5]], target: [] },
  'landing-page': { source: [[null, 'right', 0.5], ['abandon', 'bottom', 0.5]], target: [[null, 'left', 0.5]] },
  'lead-form': { source: [[null, 'right', 0.5]], target: [[null, 'left', 0.5]] },
  'follow-up-sequence': {
    source: [[null, 'right', 0.5]],
    target: [[null, 'left', 0.5], ['retention-in', 'top', 0.5]]
  },
  'thank-you': { source: [], target: [[null, 'left', 0.5]] },
  upsell: {
    source: [['accepted', 'right', 0.35], ['declined', 'right', 0.65], ['rescue', 'bottom', 0.5]],
    target: [[null, 'left', 0.5]]
  },
  // AbSplitNode.tsx wraps each branch handle in a zero-size div at top 44% and 75%.
  'ab-split': { source: [['branch-a', 'right', 0.44], ['branch-b', 'right', 0.75]], target: [[null, 'left', 0.5]] }
};

const HANDLE_SIZE = 10;

function handleCentre(card, side, f) {
  const { x, y, width: w, height: h } = card;
  if (side === 'right') return { x: x + w + 6, y: y + h * f };
  if (side === 'left') return { x: x - 6, y: y + h * f };
  if (side === 'bottom') return { x: x + w * f, y: y + h + 6 };
  return { x: x + w * f, y: y - 6 };
}

// A React Flow InternalNode-shaped object, with node-relative handle bounds.
function internalNode(id, type, pos, size) {
  const card = { x: pos.x, y: pos.y, width: size.width, height: size.height };
  const rel = list =>
    list.map(([hid, side, f]) => {
      const c = handleCentre(card, side, f);
      return { id: hid, position: side, x: c.x - HANDLE_SIZE / 2 - pos.x, y: c.y - HANDLE_SIZE / 2 - pos.y, width: HANDLE_SIZE, height: HANDLE_SIZE };
    });
  const table = HANDLES[type];
  return {
    id,
    type,
    measured: { ...size },
    internals: { positionAbsolute: { ...pos }, handleBounds: { source: rel(table.source), target: rel(table.target) } }
  };
}

// React Flow's getHandlePosition: a right source leaves from the handle's right edge and middle,
// a left target ends at its left edge and middle, top and bottom use those edges and the centre.
function handleEnd(node, kind, handleId) {
  const list = node.internals.handleBounds[kind];
  const h = (handleId ? list.find(x => x.id === handleId) : list.find(x => x.id === null)) || list[0];
  const x = node.internals.positionAbsolute.x + h.x;
  const y = node.internals.positionAbsolute.y + h.y;
  if (h.position === 'right') return { x: x + h.width, y: y + h.height / 2, position: 'right' };
  if (h.position === 'left') return { x, y: y + h.height / 2, position: 'left' };
  if (h.position === 'bottom') return { x: x + h.width / 2, y: y + h.height, position: 'bottom' };
  return { x: x + h.width / 2, y, position: 'top' };
}

function edgeLabels(internals, edges, size) {
  const byId = new Map(internals.map(n => [n.id, n]));
  return edges.map(e => {
    const s = handleEnd(byId.get(e.source), 'source', e.sourceHandle);
    const t = handleEnd(byId.get(e.target), 'target', e.targetHandle);
    const [path, midX, midY] = getSmoothStepPath({
      sourceX: s.x,
      sourceY: s.y,
      sourcePosition: s.position,
      targetX: t.x,
      targetY: t.y,
      targetPosition: t.position,
      borderRadius: 16
    });
    const sz = typeof size === 'function' ? size(e) : size;
    return { id: e.id, width: sz.width, height: sz.height, midX, midY, path };
  });
}

const DEFAULT_SIZES = {
  'ad-source': { width: 290, height: 166 },
  'landing-page': { width: 260, height: 197 },
  'lead-form': { width: 260, height: 209 },
  'follow-up-sequence': { width: 270, height: 256 }
};

function defaultMap(captionSize, positions) {
  const p = DEFAULT_LEAD_CAPTURE_PROJECT;
  const internals = p.nodes.map((n, i) =>
    internalNode(n.id, n.type, positions ? positions[i] : n.position, DEFAULT_SIZES[n.type])
  );
  return { internals, labels: edgeLabels(internals, p.edges, captionSize) };
}

function captionBox(pl, label) {
  return { x: pl.x - label.width / 2, y: pl.y - label.height / 2, width: label.width, height: label.height };
}

function toRect(id, b) {
  return { id, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}

function collisionsFor(internals, labels, placed) {
  const geos = internals.map(nodeGeometry);
  return findCollisions({
    captions: labels.map(l => toRect(l.id, captionBox(placed.get(l.id), l))),
    cards: geos.map(g => toRect(g.id, g.box)),
    handles: geos.flatMap(g => g.handles.map((h, i) => toRect(`${g.id}:h${i}`, h)))
  });
}

// Checks every caption against every card and every inflated handle with the real 8px gap.
function assertClear(internals, labels, placed) {
  const geos = internals.map(nodeGeometry);
  const obstacles = obstaclesFor(geos);
  for (const l of labels) {
    const box = captionBox(placed.get(l.id), l);
    for (const o of obstacles) assert.equal(boxesOverlap(box, o), false, `${l.id} overlaps an obstacle`);
    for (const other of labels) {
      if (other.id === l.id) continue;
      assert.equal(boxesOverlap(box, captionBox(placed.get(other.id), other), 0), false, `${l.id} overlaps ${other.id}`);
    }
  }
}

// ---- Path geometry -----------------------------------------------------------------------------

test('pathPoints parses the real smooth-step path, including both L forms and Q', () => {
  const d = 'M645 258.5L665 258.5L 682,258.5Q 690,258.5 690,266.5L 690,266.5Q 690,274.5 698,274.5L715 274.5L735 274.5';
  const [realPath, lx, ly] = getSmoothStepPath({
    sourceX: 645, sourceY: 258.5, sourcePosition: 'right',
    targetX: 735, targetY: 274.5, targetPosition: 'left', borderRadius: 16
  });
  assert.equal(realPath, d);
  const pts = pathPoints(d);
  assert.deepEqual(pts[0], { x: 645, y: 258.5 });
  assert.deepEqual(pts[pts.length - 1], { x: 735, y: 274.5 });
  assert.ok(distanceToPath({ x: lx, y: ly }, pts) < 0.5);
  const len = pathLength(pts);
  assert.ok(len >= 99 && len <= 106, `length ${len}`);

  // Every parsed point lies within 0.5 of the true path (lines plus the two quadratics).
  const truth = [{ x: 645, y: 258.5 }, { x: 665, y: 258.5 }, { x: 682, y: 258.5 }];
  const quad = (p0, c, p1) => {
    for (let i = 1; i <= 200; i++) {
      const t = i / 200;
      const u = 1 - t;
      truth.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
    }
  };
  quad({ x: 682, y: 258.5 }, { x: 690, y: 258.5 }, { x: 690, y: 266.5 });
  quad({ x: 690, y: 266.5 }, { x: 690, y: 274.5 }, { x: 698, y: 274.5 });
  truth.push({ x: 715, y: 274.5 }, { x: 735, y: 274.5 });
  for (const p of pts) assert.ok(distanceToPath(p, truth) < 0.5, `${p.x},${p.y} is off the curve`);
});

test('pointAlong walks the polyline', () => {
  const pts = pathPoints('M0 0L100 0L100 100');
  assert.deepEqual(pointAlong(pts, 0), { x: 0, y: 0 });
  assert.deepEqual(pointAlong(pts, 0.25), { x: 50, y: 0 });
  assert.deepEqual(pointAlong(pts, 0.75), { x: 100, y: 50 });
  assert.deepEqual(pointAlong(pts, 1), { x: 100, y: 100 });
});

test('boxesOverlap keeps an 8px gap by default', () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(boxesOverlap(a, { x: 17, y: 0, width: 10, height: 10 }), true);
  assert.equal(boxesOverlap(a, { x: 19, y: 0, width: 10, height: 10 }), false);
  assert.equal(boxesOverlap(a, { x: 10, y: 0, width: 10, height: 10 }, 0), false);
  assert.equal(LABEL_GAP, 8);
});

test('nodeGeometry and obstaclesFor read React Flow internal nodes', () => {
  const n = {
    id: 'n',
    measured: { width: 260, height: 200 },
    internals: {
      positionAbsolute: { x: 100, y: 50 },
      handleBounds: { source: [{ x: 255, y: 95, width: 10, height: 10 }], target: [{ x: -5, y: 95, width: 10, height: 10 }] }
    }
  };
  const g = nodeGeometry(n);
  assert.deepEqual(g.box, { x: 100, y: 50, width: 260, height: 200 });
  const obs = obstaclesFor([g]);
  assert.deepEqual(obs, [
    { x: 100, y: 50, width: 260, height: 200 },
    { x: 345, y: 135, width: 30, height: 30 },
    { x: 85, y: 135, width: 30, height: 30 }
  ]);
  assert.equal(HANDLE_CLEARANCE, 10);
  assert.equal(nodeGeometry({ ...n, hidden: true }), null);
  assert.equal(nodeGeometry({ ...n, measured: {} }), null);
  assert.equal(nodeGeometry({ ...n, measured: undefined }), null);
});

test('geometryKey changes when a card moves or a handle is measured, not otherwise', () => {
  const a = internalNode('a', 'lead-form', { x: 0, y: 0 }, { width: 260, height: 200 });
  const k1 = geometryKey([a]);
  assert.equal(geometryKey([internalNode('a', 'lead-form', { x: 0, y: 0 }, { width: 260, height: 200 })]), k1);
  assert.notEqual(geometryKey([internalNode('a', 'lead-form', { x: 5, y: 0 }, { width: 260, height: 200 })]), k1);
  assert.notEqual(geometryKey([{ ...a, internals: { ...a.internals, handleBounds: null } }]), k1);
});

// ---- Placement ---------------------------------------------------------------------------------

function twoCards(gap) {
  const a = internalNode('a', 'lead-form', { x: 0, y: 0 }, { width: 260, height: 200 });
  const b = internalNode('b', 'lead-form', { x: 260 + gap, y: 0 }, { width: 260, height: 200 });
  return [a, b];
}

test('a caption that fits stays at its midpoint with no leader', () => {
  const internals = twoCards(400);
  const [label] = edgeLabels(internals, [{ id: 'e', source: 'a', target: 'b' }], { width: 130, height: 26 });
  const placed = placeEdgeLabels([label], obstaclesFor(internals.map(nodeGeometry)));
  const p = placed.get('e');
  assert.equal(p.x, label.midX);
  assert.equal(p.y, label.midY);
  assert.equal(p.displaced, false);
  assert.equal(p.forX, label.midX);
  assert.equal(p.forY, label.midY);
});

test('a caption moves along its line before it leaves it', () => {
  const internals = twoCards(600);
  const [label] = edgeLabels(internals, [{ id: 'e', source: 'a', target: 'b' }], { width: 130, height: 26 });
  const blocker = { x: label.midX - 50, y: label.midY - 50, width: 100, height: 100 };
  // A long line tries 20% first, so put a second blocker there to prove the midpoint is not used.
  const pts = pathPoints(label.path);
  const at20 = pointAlong(pts, 0.2);
  const blocker20 = { x: at20.x - 20, y: at20.y - 20, width: 40, height: 40 };
  const placed = placeEdgeLabels([label], [...obstaclesFor(internals.map(nodeGeometry)), blocker, blocker20]);
  const p = placed.get('e');
  assert.ok(Math.abs(p.x - label.midX) > 1 || Math.abs(p.y - label.midY) > 1);
  assert.equal(p.displaced, false);
  assert.ok(distanceToPath(p, pts) < 0.5);
});

for (const size of [{ width: 90, height: 21 }, { width: 150, height: 26 }]) {
  test(`default map: ${size.width}x${size.height} captions clear cards and handles and sit above the row`, () => {
    const { internals, labels } = defaultMap(size);
    const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
    assert.equal(placed.size, 3);
    assertClear(internals, labels, placed);
    assert.deepEqual(collisionsFor(internals, labels, placed), []);
    const geos = internals.map(nodeGeometry);
    for (const l of labels) {
      const p = placed.get(l.id);
      assert.equal(p.displaced, true, `${l.id} should leave the crowded gap`);
      assert.ok(distanceToPath({ x: p.anchorX, y: p.anchorY }, pathPoints(l.path)) < 0.5);
      const box = captionBox(p, l);
      for (const g of geos) {
        const spans = box.x < g.box.x + g.box.width && box.x + box.width > g.box.x;
        if (spans) assert.ok(box.y + box.height + LABEL_GAP <= g.box.y, `${l.id} is not above ${g.id}`);
      }
    }
  });
}

test('default map spread 520px apart: every caption stays at its midpoint', () => {
  const positions = [0, 520, 1040, 1560].map((x, i) => ({ x, y: DEFAULT_LEAD_CAPTURE_PROJECT.nodes[i].position.y }));
  const { internals, labels } = defaultMap({ width: 130, height: 26 }, positions);
  const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
  for (const l of labels) {
    const p = placed.get(l.id);
    assert.equal(p.displaced, false);
    assert.equal(p.x, l.midX);
    assert.equal(p.y, l.midY);
  }
});

test('every shipped blueprint places its captions clear of cards, handles and each other', () => {
  for (const bp of ECOM_BLUEPRINTS) {
    const internals = bp.nodes.map(n =>
      internalNode(n.id, n.type, n.position, n.type === 'upsell' ? { width: 270, height: 330 } : { width: 270, height: 240 })
    );
    const labels = edgeLabels(internals, bp.edges, { width: 130, height: 26 });
    const obstacles = obstaclesFor(internals.map(nodeGeometry));
    const placed = placeEdgeLabels(labels, obstacles);
    assert.deepEqual(collisionsFor(internals, labels, placed), [], bp.id);
    assertClear(internals, labels, placed);
    for (const l of labels) {
      const p = placed.get(l.id);
      const pts = pathPoints(l.path);
      assert.ok(distanceToPath({ x: p.anchorX, y: p.anchorY }, pts) < 0.5, `${bp.id} ${l.id} anchor is off its line`);
      if (!p.displaced) {
        // On its line and clear, so it did not fall back.
        assert.ok(distanceToPath(p, pts) < 0.5);
      }
    }
  }
});

test('placement is deterministic whatever order the captions arrive in', () => {
  const { internals, labels } = defaultMap({ width: 120, height: 24 });
  const obstacles = obstaclesFor(internals.map(nodeGeometry));
  const a = placeEdgeLabels(labels, obstacles);
  const b = placeEdgeLabels([...labels].reverse(), obstacles);
  const c = placeEdgeLabels(labels, obstacles);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.deepEqual(a, c);
  assert.equal(samePlacements(a, b), true);
});

test('two captions on the same line never stack', () => {
  const internals = twoCards(400);
  const [label] = edgeLabels(internals, [{ id: 'e1', source: 'a', target: 'b' }], { width: 130, height: 26 });
  const second = { ...label, id: 'e2' };
  const placed = placeEdgeLabels([label, second], obstaclesFor(internals.map(nodeGeometry)));
  const b1 = captionBox(placed.get('e1'), label);
  const b2 = captionBox(placed.get('e2'), second);
  assert.equal(boxesOverlap(b1, b2, 0), false);
  const p2 = placed.get('e2');
  assert.ok(distanceToPath({ x: p2.anchorX, y: p2.anchorY }, pathPoints(label.path)) < 0.5);
});

test('a caption with no size yet is left out, so its edge keeps its own midpoint', () => {
  const { internals, labels } = defaultMap({ width: 120, height: 24 });
  labels[0] = { ...labels[0], width: 0 };
  const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
  assert.equal(placed.has(labels[0].id), false);
  assert.equal(placed.size, 2);
});

test('a selected caption grows and moves no more than 12px', () => {
  const { internals, labels } = defaultMap({ width: 110, height: 22 });
  const obstacles = obstaclesFor(internals.map(nodeGeometry));
  const before = placeEdgeLabels(labels, obstacles);
  for (let i = 0; i < labels.length; i++) {
    const grown = labels.map((l, j) => (j === i ? { ...l, width: l.width + 6, height: l.height + 4 } : l));
    const after = placeEdgeLabels(grown, obstacles);
    const a = before.get(labels[i].id);
    const b = after.get(labels[i].id);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= 12, `${labels[i].id} moved ${Math.hypot(a.x - b.x, a.y - b.y)}`);
  }
});

test('placementFits and samePlacements', () => {
  const p = { x: 10, y: 20, anchorX: 10, anchorY: 20, displaced: false, forX: 100, forY: 200 };
  assert.equal(placementFits(p, 100.4, 199.6), true);
  assert.equal(placementFits(p, 102, 200), false);
  const a = new Map([['e', p]]);
  assert.equal(samePlacements(a, new Map([['e', { ...p }]])), true);
  assert.equal(samePlacements(a, new Map([['e', { ...p, x: 11 }]])), false);
  assert.equal(samePlacements(a, new Map([['f', { ...p }]])), false);
});

test('findCollisions names each overlapping pair and ignores a 1px touch', () => {
  const r = (id, left, top, right, bottom) => ({ id, left, top, right, bottom });
  assert.deepEqual(
    findCollisions({
      captions: [r('edge-a', 0, 0, 50, 20), r('edge-b', 40, 0, 90, 20), r('edge-c', 200, 0, 250, 20)],
      cards: [r('node-1', 240, 10, 400, 100)],
      handles: [r('node-1:h', 0.5, 19.5, 10, 30)]
    }),
    ['edge-a / edge-b', 'edge-c / node-1']
  );
});

function contrast(a, b) {
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the leader colour reads on the canvas and matches no line kind', () => {
  assert.ok(contrast(LEADER_COLOR, '#0B0F19') >= 3);
  for (const k of Object.values(EDGE_KINDS)) assert.notEqual(k.color.toLowerCase(), LEADER_COLOR.toLowerCase());
});

// ---- A leader never runs along another line (R06) ---------------------------------------------

// Independent of leaderRunsAlong: samples the leader every 2px and asks whether a stretch of it,
// or its straight continuation 40px past either end, lies within 4px of another line.
function leaderJoins(anchor, caption, otherPaths) {
  const len = Math.hypot(caption.x - anchor.x, caption.y - anchor.y);
  const ux = (caption.x - anchor.x) / len;
  const uy = (caption.y - anchor.y) / len;
  const lines = otherPaths.map(pathPoints);
  let run = 0;
  for (let t = -40; t <= len + 40; t += 2) {
    const p = { x: anchor.x + ux * t, y: anchor.y + uy * t };
    run = lines.some(pts => distanceToPath(p, pts) <= 4) ? run + 1 : 0;
    // Six samples in a row (12px) on another line is running along it; a crossing covers four.
    if (run >= 6) return true;
  }
  return false;
}

function leadersAlongOtherLines(labels, placed) {
  const out = [];
  for (const l of labels) {
    const p = placed.get(l.id);
    if (!p.displaced) continue;
    const others = labels.filter(o => o.id !== l.id).map(o => o.path);
    if (leaderJoins({ x: p.anchorX, y: p.anchorY }, p, others)) out.push(l.id);
  }
  return out;
}

// bp6 as the browser measured it at 1920 (card boxes from positions and measured sizes, the six
// paths React Flow drew). TAKE's leader went straight up from x 1110, the same x as the dotted
// retention line e-bp6-6 below it, so both lines looked joined to the TAKE pill.
const BP6_CARDS = [
  ['bp6-ad', 'ad-source', 50, 160, 265, 219],
  ['bp6-page', 'landing-page', 420, 160, 265, 309],
  ['bp6-upsell', 'upsell', 790, 160, 275, 369],
  ['bp6-ty', 'thank-you', 1160, 160, 265, 307],
  ['bp6-cart-recovery', 'follow-up-sequence', 420, 600, 275, 327],
  ['bp6-upsell-rescue', 'follow-up-sequence', 790, 600, 275, 254]
];
const BP6_PATHS = {
  'e-bp6-1': 'M321 269.1875L341 269.1875L 353,269.1875Q 365,269.1875 365,281.1875L 365,299.875Q 365,311.875 377,311.875L389 311.875L409 311.875',
  'e-bp6-2': 'M691 311.875L711 311.875L 723,311.875Q 735,311.875 735,323.875L 735,329.984375Q 735,341.984375 747,341.984375L759 341.984375L779 341.984375',
  'e-bp6-3': 'M550 474.765625L550 494.765625L 550,529.3828125Q 550,531.8828125 552.5,531.8828125L 552.5,531.8828125Q 555,531.8828125 555,534.3828125L555 569L555 589',
  'e-bp6-4': 'M1071 287.390625L1091 287.390625L 1100.5,287.390625Q 1110,287.390625 1110,296.890625L 1110,303.984375Q 1110,313.484375 1119.5,313.484375L1129 313.484375L1149 313.484375',
  'e-bp6-5': 'M925 534.984375L925 554.984375L925 561.9921875L925 561.9921875L925 569L925 589',
  'e-bp6-6': 'M1071 727L1091 727L 1100.5,727Q 1110,727 1110,717.5L 1110,322.984375Q 1110,313.484375 1119.5,313.484375L1129 313.484375L1149 313.484375'
};

function bp6Measured() {
  const internals = BP6_CARDS.map(([id, type, x, y, width, height]) => internalNode(id, type, { x, y }, { width, height }));
  // getSmoothStepPath's label point is the centre of the line's two ends.
  const labels = Object.entries(BP6_PATHS).map(([id, path]) => {
    const pts = pathPoints(path);
    const a = pts[0];
    const b = pts[pts.length - 1];
    return { id, width: 104, height: 24, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, path };
  });
  return { internals, labels };
}

test('leaderRunsAlong: parallel and on, or carrying straight on from, another line; not crossing it', () => {
  const vertical = [[{ x: 100, y: 400 }, { x: 100, y: 200 }]];
  // Straight on from the line's end, 20px past it.
  assert.equal(leaderRunsAlong({ x: 100, y: 180 }, { x: 100, y: 60 }, vertical), true);
  // Along it, 4px to the side.
  assert.equal(leaderRunsAlong({ x: 104, y: 380 }, { x: 104, y: 250 }, vertical), true);
  // Parallel but 20px to the side: two separate lines.
  assert.equal(leaderRunsAlong({ x: 120, y: 180 }, { x: 120, y: 60 }, vertical), false);
  // In line with it but well clear of its end.
  assert.equal(leaderRunsAlong({ x: 100, y: 150 }, { x: 100, y: 40 }, vertical), false);
  // Crossing it.
  assert.equal(leaderRunsAlong({ x: 40, y: 300 }, { x: 160, y: 300 }, vertical), false);
  // Too short to be a leader.
  assert.equal(leaderRunsAlong({ x: 100, y: 199 }, { x: 100, y: 198 }, vertical), false);
});

test('bp6 as measured: the TAKE leader no longer runs along the dotted retention line (R06)', () => {
  const { internals, labels } = bp6Measured();
  const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
  assert.deepEqual(leadersAlongOtherLines(labels, placed), []);
  assert.deepEqual(collisionsFor(internals, labels, placed), []);
  assertClear(internals, labels, placed);
  const take = placed.get('e-bp6-4');
  // Still off its line with a leader back to it, and the leader starts on e-bp6-4 itself.
  assert.equal(take.displaced, true);
  assert.ok(distanceToPath({ x: take.anchorX, y: take.anchorY }, pathPoints(BP6_PATHS['e-bp6-4'])) < 0.5);
  assert.ok(Math.abs(take.anchorX - 1110) > LEADER_ALONG_OFFSET, `anchor x ${take.anchorX}`);
});

test('no shipped blueprint draws a leader along another line', () => {
  for (const bp of ECOM_BLUEPRINTS) {
    for (const size of [{ width: 104, height: 24 }, { width: 130, height: 26 }]) {
      const internals = bp.nodes.map(n =>
        internalNode(n.id, n.type, n.position, { width: 275, height: BLUEPRINT_CARD_HEIGHTS[n.type] ?? 240 })
      );
      const labels = edgeLabels(internals, bp.edges, size);
      const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
      assert.deepEqual(leadersAlongOtherLines(labels, placed), [], `${bp.id} at ${size.width}px captions`);
      assert.deepEqual(collisionsFor(internals, labels, placed), [], bp.id);
    }
  }
});

test('when every move runs along a line, the shortest move still wins', () => {
  // A caption that must leave a short line, and another line crossing it in a plus: every move
  // up, down, left or right has a leader along one arm, so placement keeps the old rule.
  const obstacles = [{ x: -50, y: -20, width: 100, height: 40 }];
  const label = { id: 'a', width: 40, height: 16, midX: 0, midY: 0, path: 'M-4 0L4 0' };
  const plus = { id: 'b', width: 0, height: 0, midX: 0, midY: 0, path: 'M0 -200L0 200M-200 0L200 0' };
  const alone = placeEdgeLabels([label], obstacles).get('a');
  const crossed = placeEdgeLabels([label, plus], obstacles).get('a');
  assert.equal(alone.displaced, true);
  assert.equal(leaderRunsAlong({ x: crossed.anchorX, y: crossed.anchorY }, crossed, [pathPoints(plus.path)]), true);
  assert.deepEqual(crossed, alone);
});

// ---- Source pins -------------------------------------------------------------------------------

test('source pins: the edge, the canvas and the provider are wired as the layout expects', () => {
  const edge = readFileSync(new URL('./src/components/canvas/edges/ConversionEdge.tsx', import.meta.url), 'utf8');
  assert.match(edge, /useEdgeLabelPlacement\(/);
  assert.match(edge, /placementFits\(/);
  const wrapperStart = edge.indexOf('data-jv-edge-label=');
  assert.ok(wrapperStart > 0, 'caption wrapper carries data-jv-edge-label');
  const wrapper = edge.slice(wrapperStart, edge.indexOf('<button', wrapperStart));
  for (const attr of ['data-label-x=', 'data-label-y=', 'data-edge-path=', 'data-displaced=']) {
    assert.ok(wrapper.includes(attr), `wrapper has ${attr}`);
  }
  const style = wrapper.slice(wrapper.indexOf('style={{'), wrapper.indexOf('}}'));
  assert.ok(!style.includes('transition'), 'captions jump rather than animate');
  const leader = edge.slice(edge.indexOf('data-jv-edge-leader='), edge.indexOf('</g>', edge.indexOf('data-jv-edge-leader=')));
  assert.match(leader, /pointerEvents: 'none'/);
  assert.match(leader, /LEADER_COLOR/);

  const canvas = readFileSync(new URL('./src/components/canvas/JourneyCanvas.tsx', import.meta.url), 'utf8');
  const open = [/<ReactFlowProvider>/, /<EdgeLabelLayout>/, /<ReactFlow\s/].map(re => canvas.search(re));
  assert.ok(open.every(i => i > 0) && open[0] < open[1] && open[1] < open[2], 'provider order');
  const close = ['</ReactFlow>', '</EdgeLabelLayout>', '</ReactFlowProvider>'].map(s => canvas.indexOf(s));
  assert.ok(close.every(i => i > 0) && close[0] < close[1] && close[1] < close[2], 'closing order');

  const provider = readFileSync(new URL('./src/components/canvas/EdgeLabelLayout.tsx', import.meta.url), 'utf8');
  assert.ok(!provider.includes('useViewport'), 'no viewport subscription');
  // One render-time read of the zoom (T02), through the stepped caption scale, so a zoom frame
  // renders nothing. The one other listener only starts a timer, and only zoomed out.
  const selectors = provider.match(/useStore\([^)]*\)/g) || [];
  assert.deepEqual(selectors.filter(x => x.includes('transform')), ['useStore(s => captionLayoutScale(s.transform[2])']);
  assert.match(provider, /const unsubscribe = scale > 1\n\s*\? store\.subscribe\(\(s, prev\) => \{\n\s*if \(s\.transform === prev\.transform\) return;\n\s*if \(settle\) clearTimeout\(settle\);\n\s*settle = window\.setTimeout\(\(\) => \{ settle = 0; schedule\(\); \}, SETTLE_MS\);/);

  const lib = readFileSync(new URL('./src/lib/edgeLabelLayout.ts', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(lib), 'edgeLabelLayout.ts imports nothing');
});

// ---- One portal lookup for every caption (R16) ------------------------------------------------

// A stand-in for React Flow's root element that counts the DOM queries made against it.
function fakeFlowRoot(portal) {
  const root = {
    queries: 0,
    portal,
    querySelector(sel) {
      root.queries++;
      return sel === VIEWPORT_PORTAL_SELECTOR ? root.portal : null;
    }
  };
  return root;
}

test('viewportPortalOf queries the flow once, however many times it is asked', () => {
  const portal = { isConnected: true };
  const root = fakeFlowRoot(portal);
  // About 30 store updates a keystroke for 20 keys. Before R16 each of 99 captions queried on
  // every one of them: 59,400 queries.
  for (let i = 0; i < 600; i++) assert.equal(viewportPortalOf(root), portal);
  assert.equal(root.queries, 1);
  // A second flow has its own portal.
  const other = fakeFlowRoot({ isConnected: true });
  assert.equal(viewportPortalOf(other), other.portal);
  assert.equal(other.queries, 1);
  assert.equal(viewportPortalOf(root), portal);
  assert.equal(root.queries, 1);
});

test('viewportPortalOf asks again after a miss or once its element leaves the page', () => {
  assert.equal(viewportPortalOf(null), null);
  assert.equal(viewportPortalOf(undefined), null);
  const root = fakeFlowRoot(null);
  assert.equal(viewportPortalOf(root), null);
  assert.equal(viewportPortalOf(root), null);
  assert.equal(root.queries, 2, 'a miss is never cached');
  const first = { isConnected: true };
  root.portal = first;
  assert.equal(viewportPortalOf(root), first);
  assert.equal(root.queries, 3);
  first.isConnected = false;
  const second = { isConnected: true };
  root.portal = second;
  assert.equal(viewportPortalOf(root), second, 'a detached portal is found again');
  assert.equal(root.queries, 4);
  assert.equal(viewportPortalOf(root), second);
  assert.equal(root.queries, 4);
});

test('source pins: every caption portals into the one element the provider found (R16)', () => {
  const edge = readFileSync(new URL('./src/components/canvas/edges/ConversionEdge.tsx', import.meta.url), 'utf8');
  assert.match(edge, /const portal = useCaptionPortal\(\)/);
  assert.match(edge, /createPortal\(caption, portal\)/);
  // React Flow's own ViewportPortal runs a DOM query per caption per store update. It is only the
  // fallback for an edge rendered with no EdgeLabelLayout above it.
  const uses = edge.match(/<ViewportPortal>/g) || [];
  assert.equal(uses.length, 1);
  assert.match(edge, /portal === undefined \? <ViewportPortal>\{caption\}<\/ViewportPortal>/);

  const provider = readFileSync(new URL('./src/components/canvas/EdgeLabelLayout.tsx', import.meta.url), 'utf8');
  assert.match(provider, /useStore\(s => viewportPortalOf<HTMLElement>\(s\.domNode\)\)/);
  assert.match(provider, /<PortalContext\.Provider value=\{portal\}>/);
  assert.ok(!provider.includes("querySelector('.react-flow__viewport-portal')"), 'no second lookup of the portal');
});

// ---- + Before / + Next clear of the captions (R22) --------------------------------------------

// A row 128x22 (screen px, as Chrome draws + Before / + Next), resting 8px above its card.
const ROW = { width: 128, height: 22 };
const REST = 8;
const restOf = card => ({ x: card.x + card.width - ROW.width, y: card.y - REST - ROW.height, ...ROW });
const rowAt = spot => ({ x: spot.x, y: spot.y, ...ROW });
// Nearer its own card than any other, so it never reads as another step's buttons.
function nearestIsOwn(row, card, cards) {
  return cards.every(c => boxGap(row, c) > boxGap(row, card));
}

test('placeStepAdd: at rest above the top-right corner when nothing is in the way', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  const spot = placeStepAdd(card, ROW, { captions: [], cards: [], handles: [] }, REST);
  assert.deepEqual(spot, { x: 172, y: 70, side: 'above', fit: 'clear' });
  // Zero-size boxes (not laid out yet) are never in the way.
  const zero = { x: 180, y: 75, width: 0, height: 0 };
  assert.deepEqual(placeStepAdd(card, ROW, { captions: [zero], cards: [zero], handles: [zero] }, REST), spot);
});

test('placeStepAdd: a caption over the corner moves the row the least it can, and clear of it', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // Over the right half of the resting spot: rising just past it is the shortest way out.
  const pill = { x: 250, y: 74, width: 100, height: 20 };
  const risen = placeStepAdd(card, ROW, { captions: [pill], cards: [], handles: [] }, REST);
  assert.deepEqual(risen, { x: 172, y: 74 - ADD_SLOT_GAP - ROW.height - 0.5, side: 'above', fit: 'clear' });
  // With a card close above, rising would meet it, so the row slides left along its own card
  // just far enough to clear the pill, rather than all the way to the card's left edge or below it.
  const upper = { x: 100, y: 0, width: 200, height: 60 };
  const slid = placeStepAdd(card, ROW, { captions: [pill], cards: [upper], handles: [] }, REST);
  assert.deepEqual(slid, { x: 250 - ADD_SLOT_GAP - ROW.width - 0.5, y: 70, side: 'above', fit: 'clear' });
  assert.equal(boxesOverlap(rowAt(slid), pill, ADD_SLOT_GAP), false);
  assert.ok(nearestIsOwn(rowAt(slid), card, [upper]));
  // The selected card's own top handle counts too.
  const handle = { x: 195, y: 92, width: 10, height: 10 };
  const narrow = { x: 100, y: 100, width: 140, height: 150 };
  const over = placeStepAdd(narrow, ROW, { captions: [], cards: [], handles: [handle] }, REST);
  assert.equal(boxesOverlap(rowAt(over), handle, ADD_SLOT_GAP), false);
  assert.equal(over.side, 'above');
});

test('placeStepAdd: never rises onto the card above, its handles, or nearer that card (R22)', () => {
  // The skeptic's case: a branch card 60px under another, with the line's pill in the gap.
  const upper = { x: 100, y: 0, width: 200, height: 140 };
  const card = { x: 100, y: 200, width: 200, height: 150 };
  const upperHandle = { x: 195, y: 141, width: 10, height: 10 };
  const pill = { x: 180, y: 160, width: 110, height: 22 };
  const around = { captions: [pill], cards: [upper], handles: [upperHandle] };
  // Rising past the pill alone, as the first fix did, lands on the upper card and its handle.
  const old = { ...restOf(card), y: pill.y - ADD_SLOT_GAP - ROW.height };
  assert.equal(boxesOverlap(old, upper, 0) || boxesOverlap(old, upperHandle, 0), true);
  const spot = placeStepAdd(card, ROW, around, REST);
  const row = rowAt(spot);
  assert.equal(spot.fit, 'clear');
  for (const b of [pill, upper, upperHandle, card]) assert.equal(boxesOverlap(row, b, ADD_SLOT_GAP), false);
  assert.ok(nearestIsOwn(row, card, [upper]), `row at ${spot.side} ${spot.x},${spot.y}`);
  // A spot that stays close but ends up nearer the upper card is refused too: with the pill a
  // little higher, the row could squeeze between it and the card, but only 4px under the upper card.
  const high = { x: 100, y: 146, width: 200, height: 22 };
  const squeezed = placeStepAdd(card, ROW, { captions: [high], cards: [upper], handles: [] }, REST);
  assert.ok(nearestIsOwn(rowAt(squeezed), card, [upper]));
  assert.notEqual(squeezed.side, 'above');
});

test('placeStepAdd: with no spot that covers nothing, the row is hidden, never over a caption or a card (U10)', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // Captions all round the card: no spot clears them. Before U10 the row took one over a caption.
  const ring = [
    { x: 40, y: 20, width: 320, height: 70 },
    { x: 40, y: 260, width: 320, height: 70 },
    { x: 305, y: 20, width: 60, height: 310 },
    { x: 35, y: 20, width: 60, height: 310 }
  ];
  const spot = placeStepAdd(card, ROW, { captions: ring, cards: [], handles: [] }, REST);
  assert.equal(spot.fit, 'hidden');
  // Hidden, it still has the spot T07 gave it, over a caption only, for a canvas that draws it.
  assert.deepEqual(spot, { x: 172, y: 70, side: 'above', fit: 'hidden', fallback: 'caption' });
  // Cards packed all round: nothing fits. Before U10 the row was drawn at its resting spot over them.
  // Hidden, it keeps that spot, which covers a card but no overlay, since there are none here.
  const packed = [
    { x: 0, y: 0, width: 400, height: 92 },
    { x: 0, y: 258, width: 400, height: 92 },
    { x: 308, y: 0, width: 92, height: 350 },
    { x: 0, y: 0, width: 92, height: 350 }
  ];
  assert.deepEqual(placeStepAdd(card, ROW, { captions: [], cards: packed, handles: [] }, REST), { x: 172, y: 70, side: 'above', fit: 'hidden', fallback: 'card' });
});

test('U10: a hidden row keeps the best spot that can be pressed, in the order T07 took them, never under an overlay when one clears', () => {
  // A canvas that draws a hidden row anyway (one with a pill in keyboard focus, or one that predates
  // U10 and reads x and y only) must be able to show and press it there. Before this, a hidden row
  // kept its resting spot, which on a card scrolled up to the tools was under the journey toolbar,
  // where a canvas that drew it made it impossible to press and its keyboard focus impossible to see.
  assert.deepEqual([...STEP_ADD_FALLBACKS], ['badge', 'caption', 'crowded', 'card', 'rest']);
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // Nothing above the card is on the map (the tools), a caption below it and one each side.
  const overlays = [{ x: -1000, y: -1000, width: 3000, height: 1092 }];
  const below = { x: 40, y: 256, width: 320, height: 60 };
  const sides = [{ x: 305, y: 90, width: 60, height: 260 }, { x: 35, y: 90, width: 60, height: 260 }];
  const captions = [below, ...sides];
  const onCaption = placeStepAdd(card, ROW, { captions, cards: [], handles: [], overlays }, REST);
  assert.equal(onCaption.fit, 'hidden');
  assert.equal(onCaption.fallback, 'caption');
  assert.deepEqual(underAny(rowAt(onCaption), overlays), [], 'never at rest under the tools');
  assert.equal(onCaption.side, 'below');
  // The resting spot is under them: that is where the row sat before, and where the bug was.
  assert.notDeepEqual(underAny({ x: 172, y: 70, ...ROW }, overlays), []);
  // The same spot as a badge rather than a caption: clear of every caption, so it is preferred to one
  // over a caption, and kept apart from a caption the row would cover.
  const badged = placeStepAdd(card, ROW, { captions: sides, badges: [below], cards: [], handles: [], overlays }, REST);
  assert.equal(badged.fit, 'hidden');
  assert.equal(badged.fallback, 'badge');
  for (const c of sides) assert.equal(boxesOverlap(rowAt(badged), c, 0), false, JSON.stringify(c));
  // Nothing above or left of the card on the map, a card right under it, and another 4px past the
  // row's spot beside it: that spot is 'crowded' (T07's name), clear of every overlay, card and handle
  // but nearer that other card than its own.
  const edges = [overlays[0], { x: -1000, y: -1000, width: 1095, height: 3000 }];
  const cards = [{ x: 100, y: 256, width: 200, height: 100 }, { x: 440, y: 100, width: 200, height: 150 }];
  const crowded = placeStepAdd(card, ROW, { captions: [], cards, handles: [], overlays: edges }, REST);
  assert.deepEqual(crowded, { x: card.x + card.width + REST, y: card.y, side: 'right', fit: 'hidden', fallback: 'crowded' });
  assert.deepEqual(underAny(rowAt(crowded), edges), []);
  for (const c of cards) assert.equal(boxesOverlap(rowAt(crowded), c, 0), false);
  // Only when every spot within reach is under an overlay does it rest at the corner.
  const all = [{ x: -1000, y: -1000, width: 3000, height: 3000 }];
  assert.deepEqual(placeStepAdd(card, ROW, { captions: [], cards: [], handles: [], overlays: all }, REST), { x: 172, y: 70, side: 'above', fit: 'hidden', fallback: 'rest' });
});

// The default map as Chrome drew it at 1440x900 (zoom 0.644): card sizes and the 128x22 captions
// read from the page. The layout lifts each caption above the gap between two cards, where the
// selected step's + Before / + Next row sits (above its top-right corner, 8px screen gap, 22px tall,
// 128px wide, counter-scaled so the same in screen px at any zoom).
const R22_SIZES = {
  'ad-source': { width: 260, height: 186 },
  'landing-page': { width: 260, height: 245 },
  'lead-form': { width: 260, height: 248 },
  'follow-up-sequence': { width: 270, height: 275 }
};

function r22Map() {
  const p = DEFAULT_LEAD_CAPTURE_PROJECT;
  const internals = p.nodes.map(n => internalNode(n.id, n.type, n.position, R22_SIZES[n.type]));
  const labels = edgeLabels(internals, p.edges, { width: 128, height: 22 });
  const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
  return { internals, labels, placed };
}

// Everything around one step in screen px (pan dropped): its card, the other cards, every handle
// and every caption, the map's boxes times the zoom.
function aroundStep(internals, labels, placed, stepId, zoom) {
  const scale = b => ({ x: b.x * zoom, y: b.y * zoom, width: b.width * zoom, height: b.height * zoom });
  const geos = internals.map(nodeGeometry);
  const own = geos.find(g => g.id === stepId);
  return {
    card: scale(own.box),
    cards: geos.filter(g => g.id !== stepId).map(g => ({ id: g.id, ...scale(g.box) })),
    handles: geos.flatMap(g => g.handles.map(h => ({ id: g.id, ...scale(h) }))),
    captions: labels.map(l => ({ id: l.id, ...scale(captionBox(placed.get(l.id), l)) }))
  };
}

// Every way a row can be wrong: over a caption, a card or a handle, or nearer another card.
function rowProblems(row, a) {
  const out = [];
  for (const c of a.captions) if (boxesOverlap(row, c, 0)) out.push(`caption ${c.id}`);
  for (const c of a.cards) if (boxesOverlap(row, c, 0)) out.push(`card ${c.id}`);
  for (const h of a.handles) if (boxesOverlap(row, h, 0)) out.push(`handle ${h.id}`);
  if (boxesOverlap(row, a.card, 0)) out.push('its own card');
  if (!nearestIsOwn(row, a.card, a.cards)) out.push('nearer another card');
  return out;
}

test('default map: a selected step\'s + Before / + Next clear the next line\'s caption (R22)', () => {
  const { internals, labels, placed } = r22Map();
  // The layout puts the captions where Chrome showed them.
  assert.deepEqual(['edge-ad-page', 'edge-page-form', 'edge-form-seq'].map(id => [placed.get(id).x, placed.get(id).y]), [[345, 140.5], [690, 140.5], [1050, 130.5]]);
  const cases = [['node-ad-1', 'edge-ad-page'], ['node-page-1', 'edge-page-form'], ['node-form-1', 'edge-form-seq']];
  for (const zoom of [0.37, 0.644, 0.703, 1.113]) {
    for (const [stepId, edgeId] of cases) {
      const a = aroundStep(internals, labels, placed, stepId, zoom);
      // Where the row sat before R22, it covered part of that caption (the bug, at the zoom seen).
      if (zoom === 0.644) assert.equal(boxesOverlap(restOf(a.card), a.captions.find(c => c.id === edgeId), 0), true, `${stepId} row at rest covers ${edgeId}`);
      const spot = placeStepAdd(a.card, ROW, a, REST);
      assert.deepEqual(rowProblems(rowAt(spot), a), [], `${stepId} at ${zoom}`);
      assert.equal(spot.fit, 'clear');
    }
  }
  // The last step has no line after it and no caption over its corner, only its own top handle
  // (retention in), so the row rises just past that handle and no further.
  const last = aroundStep(internals, labels, placed, 'node-seq-1', 0.644);
  const rest = restOf(last.card);
  const top = last.handles.filter(h => h.id === 'node-seq-1').reduce((a, h) => (h.y < a.y ? h : a));
  assert.deepEqual(placeStepAdd(last.card, ROW, last, REST), { x: rest.x, y: top.y - ADD_SLOT_GAP - ROW.height - 0.5, side: 'above', fit: 'clear' });
});

test('every shipped blueprint: the row covers no caption, card or handle, and sits nearest its own step (R22)', () => {
  // The first R22 fix rose past captions alone, so on a branch it climbed onto the card above and
  // its bottom handle (bp2-form, bp5-downsell, bp6-cart-recovery, bp6-upsell-rescue in Chrome).
  const risePastCaptions = (row, captions) => {
    let lift = 0;
    for (let i = 0; i < 64; i++) {
      const hit = captions.filter(c => boxesOverlap({ ...row, y: row.y - lift }, c, ADD_SLOT_GAP));
      if (!hit.length) break;
      lift = row.y + row.height + ADD_SLOT_GAP - Math.min(...hit.map(c => c.y));
    }
    return { ...row, y: row.y - lift };
  };
  let oldOnAStep = 0;
  for (const bp of ECOM_BLUEPRINTS) {
    const internals = bp.nodes.map(n =>
      internalNode(n.id, n.type, n.position, { width: 275, height: BLUEPRINT_CARD_HEIGHTS[n.type] ?? 240 })
    );
    const labels = edgeLabels(internals, bp.edges, { width: 104, height: 24 });
    const placed = placeEdgeLabels(labels, obstaclesFor(internals.map(nodeGeometry)));
    for (const zoom of [0.4, 0.5, 0.62, 0.8, 1.05]) {
      for (const n of internals) {
        const a = aroundStep(internals, labels, placed, n.id, zoom);
        const old = risePastCaptions(restOf(a.card), a.captions);
        if (rowProblems(old, a).some(p => p.startsWith('card') || p.startsWith('handle'))) oldOnAStep++;
        const spot = placeStepAdd(a.card, ROW, a, REST);
        const row = rowAt(spot);
        assert.deepEqual(rowProblems(row, a), [], `${bp.id} ${n.id} at ${zoom}: ${spot.side} ${spot.fit}`);
        // It never strays further than the move it is allowed from the spot it started at.
        const home = { above: a.card.y - REST - ROW.height, below: a.card.y + a.card.height + REST }[spot.side];
        if (home !== undefined) assert.ok(Math.abs(row.y - home) <= ADD_SLOT_MAX_MOVE + 0.001, `${bp.id} ${n.id} at ${zoom} moved ${row.y - home}`);
      }
    }
  }
  assert.ok(oldOnAStep > 0, 'the old rule put the row on a step somewhere, so this test can see it');
});

test('source pins: the selected step\'s + Before / + Next row is placed by placeStepAdd (R22)', () => {
  const canvas = readFileSync(new URL('./src/components/canvas/JourneyCanvas.tsx', import.meta.url), 'utf8');
  const start = canvas.indexOf('const StepAddSlot');
  const slot = canvas.slice(start, canvas.indexOf('function withStepAdd', start));
  assert.ok(start > 0 && slot.length > 0, 'StepAddSlot is where it was');
  assert.match(slot, /placeStepAddZoomed\(card, row, \{ captions, cards, handles, badges, overlays \}, zoom < 1, STEP_ADD_GAP\)/);
  assert.match(slot, /flow\.querySelectorAll\('\[data-jv-design-badge\]'\)\.forEach\(el => badges\.push\(box\(el\)\)\);/);
  // Moved by the translate property, which applies outside the counter-scale, so in map units.
  assert.match(slot, /transform: `scale\(\$\{1 \/ zoom\}\)`/);
  assert.match(slot, /translate: spot\.x \|\| spot\.y \? `\$\{spot\.x \/ zoom\}px \$\{spot\.y \/ zoom\}px` : undefined/);
  // Measured against every caption and each + Step, every other card and every handle.
  assert.match(slot, /useCaptionPortal\(\)/);
  assert.match(slot, /\[data-jv-edge-label\], \[data-jv-edge-label\] \.jv-add-next/);
  assert.match(slot, /querySelectorAll\('\.react-flow__node'\)/);
  assert.match(slot, /querySelectorAll\('\.react-flow__handle'\)/);
  // Measured again when a caption moves, any step moves or resizes, or the zoom changes.
  assert.match(slot, /new MutationObserver\(schedule\)/);
  assert.match(slot, /geometryKey\(s\.nodeLookup\.values\(\)\)/);
  assert.match(slot, /\}, \[shown, zoom, layout, portal, store\]\);/);
});

// ---- Zoomed out (T02) ----------------------------------------------------------------------------
// Below zoom 1 a caption counter-scales so its 11px text stays 11px on screen, so the layout places
// it at that scale. A caption that has no clear spot near its line shows its figure only, and one
// with no room even for that is hidden, rather than covering a card, a handle or another caption.

// The fit zooms measured in Chrome (semantic-zoom.test.mjs), and a caption's size in flow px whole
// ("VISITS Unavailable") and as its figure only ("Unavailable").
const FIT = { 'default@1440': 0.643939, 'default@390': 0.24697, 'bp6@1440': 0.620438, 'bp6@390': 0.237956 };
const WHOLE = { width: 118, height: 21 };
const FIGURE = { width: 74, height: 21 };

function scaledCaption(pl, label, scale) {
  const size = pl.form === 'compact' ? { width: label.compactWidth, height: label.compactHeight } : label;
  return { x: pl.x - (size.width * scale) / 2, y: pl.y - (size.height * scale) / 2, width: size.width * scale, height: size.height * scale };
}

// Every caption that is drawn clears every card, every (scaled) handle keep-out and every other
// drawn caption by the scaled gap, and a hidden one takes no space.
function assertClearScaled(internals, labels, placed, scale, where) {
  const geos = internals.map(nodeGeometry);
  const obstacles = obstaclesFor(geos, scale);
  const drawn = labels.filter(l => placed.get(l.id).form !== 'hidden');
  for (const l of drawn) {
    const box = scaledCaption(placed.get(l.id), l, scale);
    for (const o of obstacles) assert.equal(boxesOverlap(box, o, LABEL_GAP * scale), false, `${where}: ${l.id} overlaps an obstacle`);
    for (const other of drawn) {
      if (other.id === l.id) continue;
      assert.equal(boxesOverlap(box, scaledCaption(placed.get(other.id), other, scale), 0), false, `${where}: ${l.id} overlaps ${other.id}`);
    }
    const p = placed.get(l.id);
    assert.ok(Math.hypot(p.x - p.anchorX, p.y - p.anchorY) <= CAPTION_MAX_MOVE * scale + 1e-6, `${where}: ${l.id} moved too far`);
  }
}

const withFigure = label => ({ ...label, compactWidth: FIGURE.width, compactHeight: FIGURE.height });

test('T02: at scale 1 every caption is whole and placed exactly as before', () => {
  const maps = [defaultMap(WHOLE)];
  for (const bp of ECOM_BLUEPRINTS) {
    const internals = bp.nodes.map(n => internalNode(n.id, n.type, n.position, n.type === 'upsell' ? { width: 270, height: 330 } : { width: 270, height: 240 }));
    maps.push({ internals, labels: edgeLabels(internals, bp.edges, WHOLE) });
  }
  for (const { internals, labels } of maps) {
    const obstacles = obstaclesFor(internals.map(nodeGeometry));
    assert.deepEqual(obstaclesFor(internals.map(nodeGeometry), 1), obstacles);
    const plain = placeEdgeLabels(labels, obstacles);
    for (const opts of [{}, { scale: 1 }, { scale: 0.5 }, { scale: NaN }]) {
      const again = placeEdgeLabels(labels.map(withFigure), obstacles, opts);
      assert.deepEqual([...again], [...plain], JSON.stringify(opts));
    }
    for (const p of plain.values()) assert.equal(p.form, 'full');
  }
});

test('T02: at every fit zoom the default map and every blueprint place captions clear at their drawn size', () => {
  const maps = [['default', defaultMap(WHOLE)]];
  for (const bp of ECOM_BLUEPRINTS) {
    const internals = bp.nodes.map(n => internalNode(n.id, n.type, n.position, n.type === 'upsell' ? { width: 270, height: 330 } : { width: 270, height: 240 }));
    maps.push([bp.id, { internals, labels: edgeLabels(internals, bp.edges, WHOLE) }]);
  }
  let whole = 0;
  let shown = 0;
  for (const [id, { internals, labels }] of maps) {
    for (const [at, zoom] of Object.entries(FIT)) {
      const scale = captionLayoutScale(zoom);
      assert.ok(scale > 1);
      const withForms = labels.map(withFigure);
      const placed = placeEdgeLabels(withForms, obstaclesFor(internals.map(nodeGeometry), scale), { scale });
      assert.equal(placed.size, labels.length);
      assertClearScaled(internals, withForms, placed, scale, `${id} at ${at}`);
      for (const p of placed.values()) {
        if (p.form === 'full') whole++;
        if (p.form !== 'hidden') shown++;
      }
    }
  }
  // The rule is not met by hiding everything: most captions stay whole at fit.
  assert.ok(whole > shown / 2, `${whole} whole of ${shown} shown`);
});

// A caption in a hole: its line's midpoint sits in a gap between four large blocks, so no move
// within CAPTION_MAX_MOVE clears them. The gap fits the figure at scale 2 and not the whole caption.
function inAHole(scale, hole) {
  const label = { id: 'e', width: 130, height: 26, midX: 0, midY: 0, path: 'M-100 0L100 0' };
  const half = { w: hole.width / 2, h: hole.height / 2 };
  const far = 4000;
  const blocks = [
    { x: -far, y: -far, width: 2 * far, height: far - half.h },
    { x: -far, y: half.h, width: 2 * far, height: far },
    { x: -far, y: -half.h, width: far - half.w, height: hole.height },
    { x: half.w, y: -half.h, width: far, height: hole.height }
  ];
  return { label, blocks, scale };
}

test('T02: a caption with no room near its line shows its figure only, then nothing', () => {
  const scale = 2;
  const gap = LABEL_GAP * scale;
  // Wide enough for a 60x22 figure at scale 2 with its gap, too narrow for the whole 130x26.
  const { label, blocks } = inAHole(scale, { width: 60 * scale + 2 * gap + 4, height: 26 * scale + 2 * gap + 4 });
  const figure = { ...label, compactWidth: 60, compactHeight: 22 };
  const p = placeEdgeLabels([figure], blocks, { scale }).get('e');
  assert.equal(p.form, 'compact');
  assert.equal(p.displaced, false);
  assert.deepEqual([p.x, p.y], [0, 0]);
  // With no shorter form it is not drawn, and it says so rather than sitting over the blocks.
  const none = placeEdgeLabels([label], blocks, { scale }).get('e');
  assert.equal(none.form, 'hidden');
  assert.equal(none.displaced, false);
  // A figure no shorter than the caption is not a shorter form.
  assert.equal(placeEdgeLabels([{ ...label, compactWidth: 130, compactHeight: 26 }], blocks, { scale }).get('e').form, 'hidden');
  // At scale 1 nothing is ever hidden: the old rule takes over and moves it however far it must.
  const old = placeEdgeLabels([figure], blocks).get('e');
  assert.equal(old.form, 'full');
});

test('T02: a hidden caption takes no space from the captions after it', () => {
  const scale = 2;
  const gap = LABEL_GAP * scale;
  const { label, blocks } = inAHole(scale, { width: 60 * scale + 2 * gap + 4, height: 26 * scale + 2 * gap + 4 });
  // 'a' sorts first and has no figure, so it is hidden; 'b' on the same line then takes the hole.
  const a = { ...label, id: 'a' };
  const b = { ...label, id: 'b', compactWidth: 60, compactHeight: 22 };
  const placed = placeEdgeLabels([b, a], blocks, { scale });
  assert.equal(placed.get('a').form, 'hidden');
  assert.equal(placed.get('b').form, 'compact');
});

test('T02: a caption never moves further than CAPTION_MAX_MOVE on screen when zoomed out', () => {
  const scale = 3;
  const label = { id: 'e', width: 130, height: 26, midX: 0, midY: 0, path: 'M-100 0L100 0' };
  // One wide block over the line: the shortest way out is straight up or down past its edge.
  const block = half => [{ x: -1000, y: -half, width: 2000, height: 2 * half }];
  const out = half => half + LABEL_GAP * scale + (26 * scale) / 2 + 0.5;
  assert.ok(out(200) < CAPTION_MAX_MOVE * scale && out(400) > CAPTION_MAX_MOVE * scale, 'the fixture straddles the limit');
  const near = placeEdgeLabels([label], block(200), { scale }).get('e');
  assert.equal(near.form, 'full');
  assert.equal(near.displaced, true);
  assert.ok(Math.abs(Math.hypot(near.x - near.anchorX, near.y - near.anchorY) - out(200)) < 1e-6);
  assert.equal(placeEdgeLabels([label], block(400), { scale }).get('e').form, 'hidden');
  // At scale 1 there is no limit, as before.
  assert.equal(placeEdgeLabels([label], block(400)).get('e').displaced, true);
});

test('T02: handle clearance and the badge box grow with the scale', () => {
  const internals = twoCards(400);
  const geos = internals.map(nodeGeometry);
  const one = obstaclesFor(geos);
  const three = obstaclesFor(geos, 3);
  assert.equal(one.length, three.length);
  // Cards stay the cards; handle keep-outs grow by HANDLE_CLEARANCE per unit of scale.
  assert.deepEqual(three[0], one[0]);
  const h = one[1];
  const h3 = three[1];
  assert.equal(h3.width - h.width, 2 * HANDLE_CLEARANCE * 2);
  assert.equal(h3.x, h.x - 2 * HANDLE_CLEARANCE);
  // A badge at top -10, right -10 of a 260px card, scaled from its bottom-right corner: it keeps
  // 10px inside the card's top-right corner and grows up and left.
  const badge = { x: 260 + 10 - 28, y: -10, width: 28, height: 20 };
  const grown = scaleBox(badge, 2, 1, 1);
  assert.deepEqual(grown, { x: 270 - 56, y: 10 - 40, width: 56, height: 40 });
  assert.deepEqual(scaleBox(badge, 2, 1, 0), { x: 270 - 56, y: -10, width: 56, height: 40 });
  assert.deepEqual(scaleBox(badge, 2), { x: badge.x - 14, y: -20, width: 56, height: 40 });
  assert.deepEqual(scaleBox(badge, NaN), badge);
});

test('T02: samePlacements tells a change of form apart', () => {
  const p = { x: 1, y: 2, anchorX: 1, anchorY: 2, displaced: false, forX: 1, forY: 2, form: 'full' };
  assert.equal(samePlacements(new Map([['e', p]]), new Map([['e', { ...p }]])), true);
  assert.equal(samePlacements(new Map([['e', p]]), new Map([['e', { ...p, form: 'compact' }]])), false);
  assert.equal(samePlacements(new Map([['e', p]]), new Map([['e', { ...p, form: 'hidden' }]])), false);
});

// ---- The + Before / + Next row, zoomed out (T02) -------------------------------------------------

test('U10: from zoom 1 up the row is placed as placeStepAdd places it, and keeps clear of badges too', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  const pill = { x: 250, y: 74, width: 100, height: 20 };
  const badge = { x: 150, y: 60, width: 30, height: 30 };
  const around = { captions: [pill], cards: [], handles: [] };
  const spot = placeStepAddZoomed(card, ROW, { ...around, badges: [badge] }, false, REST);
  assert.deepEqual(spot, placeStepAdd(card, ROW, { ...around, badges: [badge] }, REST));
  // Before U10 badges were not asked about from zoom 1 up, and the row rose past the pill onto the badge.
  const unasked = placeStepAdd(card, ROW, around, REST);
  assert.equal(boxesOverlap(rowAt(unasked), badge, 0), true, 'without the badge the row covers it, so this test can see it');
  assert.deepEqual(spot, { x: 172, y: badge.y - ADD_SLOT_GAP - ROW.height - 0.5, side: 'above', fit: 'clear' });
  // The badge as the card draws it at zoom 1 (DesignIssueBadge, 10px down and out from the top-right
  // corner, 29 by 20): the resting row covered its top edge; now it rises just past it.
  const corner = { x: card.x + card.width + 10 - 29, y: card.y - 10, width: 29, height: 20 };
  assert.equal(boxesOverlap(restOf(card), corner, 0), true);
  const clear = placeStepAddZoomed(card, ROW, { captions: [], cards: [], handles: [], badges: [corner] }, false, REST);
  assert.deepEqual(clear, { x: 172, y: corner.y - ADD_SLOT_GAP - ROW.height - 0.5, side: 'above', fit: 'clear' });
  // From zoom 1 up the row still moves no further than ADD_SLOT_MAX_MOVE.
  const strip = { x: 40, y: card.y - REST - ROW.height - 40, width: 320, height: 60 };
  const walled = placeStepAddZoomed(card, ROW, { captions: [strip], cards: [], handles: [], badges: [] }, false, REST);
  const home = { above: card.y - REST - ROW.height, below: card.y + card.height + REST }[walled.side];
  assert.ok(home === undefined || Math.abs(walled.y - home) <= ADD_SLOT_MAX_MOVE + 0.001, `${walled.side} ${walled.y}`);
});

test('T02: zoomed out, the row keeps clear of a badge, and of a wall of captions around it', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // A badge on the card's corner, where the row rests: the row rises past it.
  const badge = { x: 262, y: 62, width: 44, height: 44 };
  const past = placeStepAddZoomed(card, ROW, { captions: [], cards: [], handles: [], badges: [badge] }, true, REST);
  assert.equal(past.fit, 'clear');
  assert.equal(boxesOverlap(rowAt(past), badge, 0), false);
  // Captions fill the space beside and below the card: the row rises past the badge between them.
  const wall = [
    { x: 0, y: -400, width: 400, height: 470 },
    { x: 100 + 200 + REST, y: 0, width: 400, height: 400 },
    { x: -400, y: 0, width: 400 + 100 - REST, height: 400 },
    { x: 0, y: 100 + 150 + REST, width: 400, height: 400 }
  ];
  const spot = placeStepAddZoomed(card, ROW, { captions: wall.slice(1), cards: [], handles: [], badges: [badge] }, true, REST);
  assert.equal(spot.fit, 'clear');
  for (const c of wall.slice(1)) assert.equal(boxesOverlap(rowAt(spot), c, 0), false);
});

test('T02: zoomed out, the row may move up to ADD_SLOT_FAR_MOVE to clear the larger captions', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // A caption strip right above the card, as 11px captions sit at fit (bp6 at 1440): clear space
  // starts 60px above the resting spot, past ADD_SLOT_MAX_MOVE and within ADD_SLOT_FAR_MOVE.
  const strip = { x: 40, y: card.y - REST - ROW.height - 40, width: 320, height: 60 };
  // And one under it, so below the card is no better; its neighbours close off both sides.
  const under = { x: 40, y: card.y + card.height + REST - 10, width: 320, height: 60 };
  const cards = [{ x: -150, y: 100, width: 200, height: 150 }, { x: 350, y: 100, width: 200, height: 150 }];
  const around = { captions: [strip, under], cards, handles: [] };
  assert.equal(placeStepAdd(card, ROW, around, REST).fit, 'hidden', 'the old reach finds nothing clear');
  const spot = placeStepAddZoomed(card, ROW, { ...around, badges: [] }, true, REST);
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'above');
  assert.deepEqual(rowProblems(rowAt(spot), { card, ...around }), []);
  const moved = card.y - REST - ROW.height - spot.y;
  assert.ok(moved > ADD_SLOT_MAX_MOVE && moved <= ADD_SLOT_FAR_MOVE + 0.001, `moved ${moved}`);
});

test('T02: zoomed out, captions keep clear of the map overlays and the map edge, as the view stands', () => {
  const provider = readFileSync(new URL('./src/components/canvas/EdgeLabelLayout.tsx', import.meta.url), 'utf8');
  assert.match(provider, /placeEdgeLabels\(labels, \[\.\.\.obstaclesFor\(geometry, scale\), \.\.\.badges, \.\.\.overlays\(\)\], \{ scale \}\)/);
  const fn = provider.slice(provider.indexOf('const overlays = (): Box[] => {'), provider.indexOf('const schedule = () => {'));
  assert.match(fn, /if \(scale <= 1 \|\| !root\) return \[\];/, 'never from zoom 1 up');
  assert.match(fn, /mapOverlayRects\(root, pane\)\.map\(r => screenBoxToFlow\(r, pane, t\)\)/);
  // What floats over the map is read in one place, shared with the + Before / + Next row (T07).
  const shared = provider.slice(provider.indexOf('export function mapOverlayRects'), provider.indexOf('/** The element captions portal into'));
  assert.match(shared, /root\.querySelector\('\[data-map-overlay\]'\)/);
  assert.match(shared, /'\.react-flow__minimap, \.react-flow__controls'/);
  assert.match(shared, /\.\.\.mapEdgeBands\(pane\)\]/, 'a band beyond each edge of the map');
  // A screen box in map units, for a pane at (100, 50) and a view at x 20, y 10, zoom 0.5.
  const box = screenBoxToFlow({ left: 170, top: 90, width: 50, height: 25 }, { left: 100, top: 50 }, [20, 10, 0.5]);
  assert.deepEqual(box, { x: 100, y: 60, width: 100, height: 50 });
  assert.deepEqual(screenBoxToFlow({ left: 0, top: 0, width: 4, height: 4 }, { left: 0, top: 0 }, [0, 0, 0]), { x: 0, y: 0, width: 4, height: 4 });
});

// ---- Design-check badges past fit (T02) ----------------------------------------------------------
// The 11px badge counter-scales from its card's corner. Past fit on a phone it is bigger than its card
// and reached the card above, that card's handles and its own (a press on the upsell's rescue handle
// opened Check design). placeBadges draws it whole only where it is clear, grown up and left or else up
// and right, then as a dot, then not at all.

// bp6 as Chrome measured it at 390px (React Flow's measured sizes and handle bounds, map units).
const BP6_MEASURED = [
  ['bp6-ad', [50, 160, 260, 218], [[311, 264]]],
  ['bp6-page', [420, 160, 260, 304], [[681, 307], [545, 465], [409, 307]]],
  ['bp6-upsell', [790, 160, 270, 364], [[1061, 282], [1061, 392], [920, 525], [779, 337]]],
  ['bp6-ty', [1160, 160, 260, 307], [[1149, 308]]],
  ['bp6-cart-recovery', [420, 600, 270, 319], [[691, 755], [409, 755], [550, 589]]],
  ['bp6-upsell-rescue', [790, 600, 270, 254], [[1061, 722], [779, 722], [920, 589]]]
].map(([id, [x, y, width, height], hs]) => ({ id, box: { x, y, width, height }, handles: hs.map(([hx, hy]) => ({ x: hx, y: hy, width: 10, height: 10 })) }));

// DesignIssueBadge at top -10, right -10 of its card, 29 by 20 as measured ("! 1").
const badgeOn = g => ({ nodeId: g.id, box: { x: g.box.x + g.box.width + 10 - 29, y: g.box.y - 10, width: 29, height: 20 } });

// The scaled box each form draws, as index.css scales it.
function formBox(req, form, s) {
  if (form === 'full') return scaleBox(req.box, s, 1, 1);
  if (form === 'full-right') return scaleBox(req.box, s, 0, 1);
  if (form === 'dot') return scaleBox(req.box, s * BADGE_DOT_SCALE, 1, 1);
  return null;
}

const distToBox = (box, x, y) => Math.hypot(Math.max(box.x - x, 0, x - (box.x + box.width)), Math.max(box.y - y, 0, y - (box.y + box.height)));

// Every drawn badge clears every other card, every handle's keep-out circle and every other badge.
function assertBadgesClear(geos, requests, placed, s, where) {
  const drawn = [];
  for (const req of requests) {
    const p = placed.get(req.nodeId);
    assert.ok(p, `${where}: ${req.nodeId} was placed`);
    assert.deepEqual(p.box, formBox(req, p.form, s), `${where}: ${req.nodeId}'s box is the one its form draws`);
    if (!p.box) continue;
    for (const g of geos) {
      const own = g.id === req.nodeId;
      if (!own) assert.equal(boxesOverlap(p.box, g.box, 0), false, `${where}: ${req.nodeId} (${p.form}) covers the ${g.id} card`);
      for (const h of g.handles) {
        const r = h.width / 2 + (own ? BADGE_OWN_HANDLE_CLEARANCE : BADGE_HANDLE_CLEARANCE) * s;
        assert.ok(distToBox(p.box, h.x + h.width / 2, h.y + h.height / 2) >= r - 1e-9, `${where}: ${req.nodeId} (${p.form}) reaches a ${g.id} handle`);
      }
    }
    for (const d of drawn) assert.equal(boxesOverlap(p.box, d.box, 0), false, `${where}: ${req.nodeId} covers ${d.id}'s badge`);
    drawn.push({ id: req.nodeId, box: p.box });
  }
  return drawn.length;
}

test('T02: from zoom 1 up every badge is whole, where it always was', () => {
  const requests = BP6_MEASURED.map(badgeOn);
  for (const s of [1, 0.5, NaN, captionScale(1), captionScale(1.8)]) {
    const placed = placeBadges(requests, BP6_MEASURED, s);
    for (const req of requests) assert.deepEqual(placed.get(req.nodeId), { form: 'full', box: req.box }, `scale ${s}`);
  }
});

test('T02: bp6 at 390, as measured: every badge whole at fit, and clear of every card and handle past it', () => {
  const requests = BP6_MEASURED.map(badgeOn);
  const fit = captionScale(0.237956);
  const atFit = placeBadges(requests, BP6_MEASURED, fit);
  assertBadgesClear(BP6_MEASURED, requests, atFit, fit, 'fit');
  for (const [id, p] of atFit) assert.ok(p.form === 'full' || p.form === 'full-right', `${id} is ${p.form} at fit`);
  // Grown up and left it would reach the upsell's rescue handle, so it grows up and right instead.
  assert.equal(atFit.get('bp6-upsell-rescue').form, 'full-right');
  // The skeptic's zooms, one and two presses of Zoom out, and on to the floor of 0.1.
  const upsell = BP6_MEASURED.find(g => g.id === 'bp6-upsell');
  const rescue = upsell.handles[2];
  for (const zoom of [0.198297, 0.165247, 0.137706, 0.114755, 0.1]) {
    const s = captionScale(zoom);
    const placed = placeBadges(requests, BP6_MEASURED, s);
    assertBadgesClear(BP6_MEASURED, requests, placed, s, `zoom ${zoom}`);
    // The control: the old rule, every badge whole and up and left, covers the rescue handle's centre.
    const old = scaleBox(badgeOn(BP6_MEASURED.find(g => g.id === 'bp6-upsell-rescue')).box, s, 1, 1);
    assert.equal(distToBox(old, rescue.x + 5, rescue.y + 5), 0, `zoom ${zoom}: the old badge covered the handle`);
    assert.notEqual(placed.get('bp6-upsell-rescue').form, 'full', `zoom ${zoom}`);
  }
  // Clear, not gone: past fit most badges are still drawn whole.
  const s = captionScale(0.198297);
  const whole = [...placeBadges(requests, BP6_MEASURED, s).values()].filter(p => p.form === 'full' || p.form === 'full-right').length;
  assert.ok(whole >= 4, `${whole} of 6 whole one press past fit`);
});

test('T02: a badge with no room whole is a dot on its corner, then not drawn, and a hidden one takes no room', () => {
  const s = 4;
  const card = { id: 'c', box: { x: 0, y: 200, width: 260, height: 200 }, handles: [] };
  const req = badgeOn(card);
  const whole = scaleBox(req.box, s, 1, 1);
  const right = scaleBox(req.box, s, 0, 1);
  const dot = scaleBox(req.box, s * BADGE_DOT_SCALE, 1, 1);
  // A card above that reaches just below both whole boxes' tops, and not the dot's.
  const above = { id: 'a', box: { x: -400, y: 0, width: 1200, height: Math.min(whole.y, right.y) + 1 }, handles: [] };
  assert.ok(above.box.y + above.box.height < dot.y, 'the fixture leaves the dot room');
  assert.deepEqual(placeBadges([req], [card, above], s).get('c'), { form: 'dot', box: dot });
  // A card that reaches the dot too: not drawn.
  const lower = { ...above, box: { ...above.box, height: dot.y + 1 } };
  assert.deepEqual(placeBadges([req], [card, lower], s).get('c'), { form: 'hidden', box: null });
  // Another card's handle whose hit circle reaches the whole box, up and left only: up and right.
  const handleCard = { id: 'h', box: { x: -500, y: 0, width: 10, height: 10 }, handles: [{ x: whole.x - 5, y: whole.y + 20, width: 10, height: 10 }] };
  assert.equal(placeBadges([req], [card, handleCard], s).get('c').form, 'full-right');
  // Its own card's handle is kept clear by its dot and a little, not its whole hit circle (it draws above).
  const near = { x: whole.x - 10 - BADGE_OWN_HANDLE_CLEARANCE * s - 1, y: whole.y + 20, width: 10, height: 10 };
  const own = { ...card, handles: [near] };
  assert.equal(placeBadges([badgeOn(own)], [own], s).get('c').form, 'full');
  // The same handle on another card is inside its hit circle, so the badge does not grow over it.
  assert.notEqual(placeBadges([req], [card, { ...handleCard, handles: [near] }], s).get('c').form, 'full');
  // A hidden badge takes no room. Badge a (first in order) has a handle's keep-out over its own box,
  // which every form contains, so it is hidden; b's whole box overlaps where a's would be, and b is
  // still drawn whole.
  const far = id => ({ id, box: { x: 5000 + id.charCodeAt(0) * 400, y: 5000, width: 10, height: 10 }, handles: [] });
  const ra = { nodeId: 'a', box: { x: 1000, y: 1000, width: 29, height: 20 } };
  const rb = { nodeId: 'b', box: { x: 1000 - 110, y: 1000, width: 29, height: 20 } };
  const blocker = { ...far('z'), handles: [{ x: 1000 + 14.5 - 5, y: 1000 + 10 - 5, width: 10, height: 10 }] };
  assert.ok(boxesOverlap(scaleBox(ra.box, s, 1, 1), scaleBox(rb.box, s, 1, 1), 0), 'the fixture: the two whole boxes overlap');
  const two = placeBadges([rb, ra], [far('a'), far('b'), blocker], s);
  assert.deepEqual(two.get('a'), { form: 'hidden', box: null });
  assert.equal(two.get('b').form, 'full');
  // The control: with a drawn, b cannot be whole where it would cover a.
  const both = placeBadges([rb, ra], [far('a'), far('b')], s);
  assert.equal(both.get('a').form, 'full');
  assert.notEqual(both.get('b').form, 'full');
});

test('T02: badges are placed the same whatever order they arrive in', () => {
  const requests = BP6_MEASURED.map(badgeOn);
  for (const zoom of [0.237956, 0.198297, 0.1]) {
    const s = captionScale(zoom);
    const one = placeBadges(requests, BP6_MEASURED, s);
    const two = placeBadges(requests.slice().reverse(), BP6_MEASURED.slice().reverse(), s);
    assert.deepEqual([...two].sort(), [...one].sort(), `zoom ${zoom}`);
  }
});

test('T02: on the default map and every blueprint, no badge reaches another card or a handle at any zoom out', () => {
  const maps = [['default', DEFAULT_LEAD_CAPTURE_PROJECT.nodes.map(n => internalNode(n.id, n.type, n.position, DEFAULT_SIZES[n.type]))]];
  for (const bp of ECOM_BLUEPRINTS) {
    maps.push([bp.id, bp.nodes.map(n => internalNode(n.id, n.type, n.position, n.type === 'upsell' ? { width: 270, height: 330 } : { width: 270, height: 240 }))]);
  }
  let drawn = 0;
  let asked = 0;
  for (const [id, internals] of maps) {
    const geos = internals.map(nodeGeometry);
    const requests = geos.map(badgeOn);
    for (let zoom = 0.9; zoom >= 0.1; zoom -= 0.02) {
      const s = captionScale(zoom);
      drawn += assertBadgesClear(geos, requests, placeBadges(requests, geos, s), s, `${id} at zoom ${zoom.toFixed(2)}`);
      asked += requests.length;
    }
  }
  // The rule is not met by hiding every badge.
  assert.ok(drawn > asked * 0.6, `${drawn} of ${asked} drawn`);
});

test('T02: findCollisions reads badges: not their own card, but any other card, any handle, another badge or a caption', () => {
  const r = (id, left, top, right, bottom, card) => ({ id, left, top, right, bottom, ...(card ? { card } : {}) });
  const cards = [r('card A', 0, 100, 200, 300), r('card B', 0, 400, 200, 600)];
  const handles = [r('B handle', 95, 395, 105, 405)];
  // On its own card's corner: nothing to report.
  assert.deepEqual(findCollisions({ captions: [], cards, handles, badges: [r('badge A', 180, 80, 210, 110, 'card A')] }), []);
  // Grown down onto card B and its handle, and onto another badge and a caption.
  const hits = findCollisions({
    captions: [r('caption', 150, 350, 190, 370)],
    cards,
    handles,
    badges: [r('badge A', 90, 290, 210, 410, 'card A'), r('badge X', 200, 380, 230, 400, 'card X')]
  });
  assert.deepEqual(hits.sort(), ['badge A / B handle', 'badge A / badge X', 'badge A / card B', 'caption / badge A'].sort());
});

// ---- + Before / + Next clear of the map's overlays (T07) ------------------------------------------
// The tools and legend, the zoom controls and the minimap float over the map, and the map's edges
// cut off whatever is past them, so a row under any of them cannot be clicked. placeStepAdd avoided
// captions, cards and handles only: a card scrolled up near the top kept its row under the tools.

// The map at 1440x900 as Chrome drew it: the pane, and the painted boxes of the tools row (Tidy
// layout, Numbers, Retention flows), the legend, the zoom controls and the minimap, in screen px.
const PANE_1440 = { left: 0, top: 104, width: 1020, height: 796 };
const TOOLS_1440 = [
  { x: 515.3, y: 118, width: 101.9, height: 32 },
  { x: 625.2, y: 118, width: 175.7, height: 32 },
  { x: 808.9, y: 118, width: 195.1, height: 32 },
  { x: 858.9, y: 158, width: 145.1, height: 123.8 },
  { x: 15, y: 805, width: 28, height: 80 },
  { x: 865, y: 795, width: 140, height: 90 }
];
const OVERLAYS_1440 = [...TOOLS_1440, ...mapEdgeBands(PANE_1440).map(rectToBox)];
const underAny = (row, overlays) => overlays.filter(o => boxesOverlap(row, o, 0));

test('T07: mapEdgeBands is a band beyond each edge of the map, and nothing for a map not laid out', () => {
  const bands = mapEdgeBands(PANE_1440, 1000);
  assert.equal(bands.length, 4);
  const inside = { x: 0, y: 104, width: 1020, height: 796 };
  for (const b of bands.map(rectToBox)) assert.equal(boxesOverlap(b, inside, 0), false, 'a band never reaches into the map');
  // Just past each edge is in a band.
  for (const [x, y] of [[-1, 500], [1021, 500], [500, 103], [500, 901], [-1, 50], [1030, 950]]) {
    assert.ok(bands.some(b => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height), `${x},${y}`);
  }
  assert.deepEqual(mapEdgeBands({ left: 0, top: 0, width: 0, height: 300 }), []);
  assert.deepEqual(rectToBox({ left: 1, top: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 });
});

test('T07: on a phone the map is only as far as it is on screen, past a scroller and the window', () => {
  // 390x844: the map scrolled 135px up inside the page's scroller (the step panel under it).
  const flow = { left: 0, top: -135, width: 390, height: 523 };
  const scroller = { left: 0, top: 135, width: 390, height: 709 };
  const view = { left: 0, top: 0, width: 390, height: 844 };
  const onScreen = intersectRects(flow, scroller, view);
  assert.deepEqual(onScreen, { left: 0, top: 135, width: 390, height: 253 });
  // A card whose top is 20px into what is left: above it is cut off, so its row goes below.
  const card = { x: 200, y: 155, width: 150, height: 90 };
  const bands = mapEdgeBands(onScreen).map(rectToBox);
  const spot = placeStepAdd(card, ROW, { captions: [], cards: [], handles: [], overlays: bands }, REST);
  assert.equal(spot.side, 'below');
  assert.deepEqual(underAny(rowAt(spot), bands), []);
  // Rects that miss leave nothing, and no bands.
  assert.deepEqual(intersectRects(flow, { left: 500, top: 0, width: 10, height: 10 }).width, 0);
  assert.deepEqual(mapEdgeBands(intersectRects(flow, { left: 500, top: 0, width: 10, height: 10 })), []);
});

test('T07: a card scrolled up under the tools gets its row below it, clear of every overlay', () => {
  // A card whose top sits 10px under the tools row: the resting spot is under Tidy layout and Numbers.
  const card = { x: 520, y: 160, width: 200, height: 150 };
  const around = { captions: [], cards: [], handles: [] };
  const old = placeStepAdd(card, ROW, around, REST);
  assert.equal(old.side, 'above', 'with no overlays the row rests above, as before T07');
  assert.ok(underAny(rowAt(old), OVERLAYS_1440).length > 0, 'and there it is under the tools, so this test can see the bug');
  const spot = placeStepAdd(card, ROW, { ...around, overlays: OVERLAYS_1440 }, REST);
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'below');
  assert.deepEqual(underAny(rowAt(spot), OVERLAYS_1440), []);
  // Zoomed out too, where the row is placed by placeStepAddZoomed.
  const zoomed = placeStepAddZoomed(card, ROW, { ...around, badges: [], overlays: OVERLAYS_1440 }, true, REST);
  assert.equal(zoomed.fit, 'clear');
  assert.deepEqual(underAny(rowAt(zoomed), OVERLAYS_1440), []);
});

test('T07: a card at the top edge of the map gets its row below it rather than cut off', () => {
  const card = { x: 100, y: 120, width: 200, height: 150 };
  const bands = mapEdgeBands(PANE_1440).map(rectToBox);
  assert.ok(rowAt(placeStepAdd(card, ROW, { captions: [], cards: [], handles: [] }, REST)).y < PANE_1440.top);
  const spot = placeStepAdd(card, ROW, { captions: [], cards: [], handles: [], overlays: bands }, REST);
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'below');
  assert.ok(spot.y >= PANE_1440.top);
});

test('T07: bp6 at 1440, the upsell scrolled under the tools: its row is clickable and covers nothing', () => {
  // Measured in Chrome at the fit zoom (0.644), the upsell's top at the tools row's bottom. Above it is
  // the tools and the top edge; below it a caption holds the left of the space before the next card.
  const card = { x: 430.5, y: 147.9, width: 173.9, height: 234.4 };
  const row = { width: 127.7, height: 22 };
  const captions = [
    { x: 94.8, y: 352.6, width: 127.4, height: 22.1 }, { x: 331.9, y: 352.6, width: 83.7, height: 22.1 },
    { x: 140.6, y: 386.6, width: 114.5, height: 22.1 }, { x: 428.6, y: 395.7, width: 65.8, height: 22.1 },
    { x: 615.3, y: 462.3, width: 138.5, height: 22.1 }
  ];
  const cards = [
    { x: -46, y: 147.9, width: 167.4, height: 140.6 }, { x: 192.3, y: 147.9, width: 167.4, height: 195.6 },
    { x: 668.8, y: 147.9, width: 167.4, height: 197.7 }, { x: 192.3, y: 431.2, width: 173.9, height: 205.4 },
    { x: 430.5, y: 431.2, width: 173.9, height: 163.6 }
  ];
  const handles = [
    [122.1, 215], [185.2, 242.5], [360.3, 242.5], [272.8, 344.1], [423.4, 261.9], [605, 226.7], [605, 297],
    [514.2, 382.9], [661.7, 243.5], [185.2, 530.7], [276, 424.1], [366.8, 530.7], [423.4, 509.8], [514.2, 424.1], [605, 509.8]
  ].map(([x, y]) => ({ x, y, width: 6.4, height: 6.4 }));
  const around = { captions, cards, handles, badges: [] };
  const old = placeStepAddZoomed(card, row, around, true, REST);
  const at = s => ({ x: s.x, y: s.y, ...row });
  assert.ok(underAny(at(old), OVERLAYS_1440).length > 0, 'the old row sat under the tools');
  const spot = placeStepAddZoomed(card, row, { ...around, overlays: OVERLAYS_1440 }, true, REST);
  const box = at(spot);
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'below');
  assert.deepEqual(underAny(box, OVERLAYS_1440), []);
  for (const b of [...captions, ...cards, ...handles, card]) assert.equal(boxesOverlap(box, b, ADD_SLOT_GAP), false, JSON.stringify(b));
  assert.ok(nearestIsOwn(box, card, cards));
  // Slid right past the card's corner, past the caption under its left and the card's bottom handle,
  // by no more than the move it has zoomed out (T02).
  const slid = spot.x - (card.x + card.width - row.width);
  assert.ok(slid > 0 && slid <= ADD_SLOT_FAR_MOVE + 0.001, `slid ${slid}`);
});

// Views measured in Chrome (r22b's zoomed-out pass), in screen px, as [x, y, width, height].
const B = ([x, y, width, height]) => ({ x, y, width, height });
const handlesAt = (size, points) => points.map(([x, y]) => ({ x, y, width: size, height: size }));

test('T07: bp6 at 1440 zoomed out, the page under the tools: the row slides on past a spot nearer the card beside it', () => {
  // The Landing page card at zoom 0.53, its top at the tools row's bottom. Above it is the tools and
  // the top edge; below it the captions under its left and right; beside it, on its left, the Meta Ad.
  const card = B([499.9, 168.8, 137.9, 161.1]);
  const row = { width: 127.7, height: 22 };
  const captions = [[407.4, 339, 126.7, 22], [546.9, 355, 113.9, 22], [679.9, 371, 65.5, 22], [866.5, 425.9, 137.7, 22]].map(B);
  const badges = [
    [418, 154.1, 28.9, 20], [614.2, 154.1, 28.9, 20], [815.7, 154.1, 28.9, 20], [1006.7, 154.1, 28.9, 20],
    [619.5, 387.5, 28.9, 20], [815.7, 387.5, 28.9, 20]
  ].map(B);
  const cards = [
    [303.7, 168.8, 137.9, 115.8], [696.1, 168.8, 143.2, 193], [892.4, 168.8, 137.9, 162.8],
    [499.9, 402.2, 143.2, 169.2], [696.1, 402.2, 143.2, 134.7]
  ].map(B);
  const handles = handlesAt(5.3, [
    [442.1, 224.1], [494.1, 246.7], [638.3, 246.7], [566.2, 330.5], [690.3, 262.7], [839.9, 233.7], [839.9, 291.6],
    [765.1, 362.4], [886.5, 247.6], [494.1, 484.1], [568.9, 396.3], [643.6, 484.1], [690.3, 466.9], [765.1, 396.3], [839.9, 466.9]
  ]);
  const spot = placeStepAddZoomed(card, row, { captions, badges, cards, handles, overlays: OVERLAYS_1440 }, true, REST);
  const box = { x: spot.x, y: spot.y, ...row };
  // Before, the slide beside the card stopped where it first cleared the Meta Ad, nearer that card
  // than its own, gave the side up, and the row covered the captions under the card instead.
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'left');
  assert.deepEqual(underAny(box, OVERLAYS_1440), []);
  for (const b of [...captions, ...badges, ...cards, ...handles, card]) assert.equal(boxesOverlap(box, b, ADD_SLOT_GAP), false, JSON.stringify(b));
  assert.ok(nearestIsOwn(box, card, cards));
  const firstClear = { ...box, y: cards[0].y + cards[0].height + ADD_SLOT_GAP + 0.5 };
  assert.equal(nearestIsOwn(firstClear, card, cards), false, 'where the slide first clears the Meta Ad, that card is nearer');
  assert.ok(spot.y > firstClear.y && spot.y <= card.y + card.height - row.height + 0.001, `y ${spot.y}`);
  // And it slid on until it is plainly its own card's, not just past the line between the two.
  for (const c of cards) assert.ok(boxGap(box, card) + ADD_SLOT_OWN_MARGIN <= boxGap(box, c) + 0.001, JSON.stringify(c));
});

test('T07: a row that slid past another card\'s spot never stops on the line between the two cards', () => {
  // Nothing above or below the card is on the map and a card sits close on its right, so only the
  // left is open, under the card to the left. Just past that card's bottom the row is 8px from both;
  // a little lower it is nearer its own by less than the margin, and the card ends before the margin.
  const card = { x: 320, y: 294, width: 106, height: 125 };
  const cards = [{ x: 170, y: 294, width: 104, height: 89 }, { x: 440, y: 294, width: 100, height: 125 }];
  const overlays = [{ x: -1000, y: -1000, width: 3000, height: 1290 }, { x: -1000, y: 423, width: 3000, height: 1000 }];
  const spot = placeStepAdd(card, ROW, { captions: [], cards, handles: [], overlays }, REST);
  const box = rowAt(spot);
  // Nearer its own card by a hair at y 392 would have been taken as clear, and read as the other's.
  const hair = { ...box, x: card.x - REST - ROW.width, y: 392 };
  assert.ok(nearestIsOwn(hair, card, cards) && boxGap(hair, cards[0]) - boxGap(hair, card) < ADD_SLOT_OWN_MARGIN);
  // Where it stops it is plainly its own card's: ADD_SLOT_OWN_MARGIN nearer it than the other. Before
  // U10 nothing like that was in reach; now it is just past the card's bottom, still beside it.
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'left');
  for (const c of cards) assert.ok(boxGap(box, card) + ADD_SLOT_OWN_MARGIN <= boxGap(box, c) + 0.001, JSON.stringify(c));
  assert.deepEqual(underAny(box, overlays), []);
  // A spot past the card's end is held to the margin from the start (U10), not only once it has
  // passed another card's spot: without the room below that, it is hidden, never at y 397 (6px nearer).
  const tighter = [overlays[0], { ...overlays[1], y: 420 }];
  assert.equal(placeStepAdd(card, ROW, { captions: [], cards, handles: [], overlays: tighter }, REST).fit, 'hidden');
});

test('T07: a phone zoomed out, with no spot a gap from every caption, the row sits against a caption rather than on it', () => {
  // The default map at 390, zoomed out, the Nurture sequence selected: the map shows only 210px of
  // itself, the minimap fills the lower right, and the NEXT pill sits right under the card.
  const card = B([263.1, 215.9, 47.2, 48]);
  const row = { width: 127.7, height: 22 };
  const pane = { left: 0, top: 216, width: 390, height: 210.3 };
  const tools = [[88.4, -83, 101.9, 32], [198.3, -83, 175.7, 32], [203.1, -43, 170.9, 26], [307.3, -9, 66.7, 26], [15, 331.3, 28, 80], [235, 321.3, 140, 90]].map(B);
  const overlays = [...tools, ...mapEdgeBands(pane).map(rectToBox)];
  const captions = [[66.2, 167.2, 130.1, 22.6], [125.5, 135, 132, 22.6], [192.6, 273, 123.5, 22.6]].map(B);
  const next = captions[2];
  const badges = [[97.2, 202.3, 29.6, 20.5], [154.9, 198.9, 29.6, 20.5], [307, 197.1, 29.6, 20.5]].map(B);
  const cards = [[79.7, 221.1, 45.4, 40.2], [137.4, 217.7, 45.4, 43.2], [200.2, 219.4, 45.4, 43.3]].map(B);
  const handles = handlesAt(1.7, [[125.3, 240.4], [135.4, 238.4], [183, 238.4], [159.2, 261], [198.3, 240.2], [245.8, 240.2], [261.2, 239], [285.8, 214], [310.4, 239]]);
  const spot = placeStepAddZoomed(card, row, { captions, badges, cards, handles, overlays }, true, REST);
  const box = { x: spot.x, y: spot.y, ...row };
  // Before, it took the first spot clear of cards and handles, right under the card, over 90% of the pill.
  assert.equal(spot.fit, 'close');
  assert.equal(spot.side, 'below');
  assert.deepEqual(underAny(box, overlays), []);
  for (const c of [...captions, ...badges]) assert.equal(boxesOverlap(box, c, ADD_SLOT_CLOSE_GAP - 0.01), false, JSON.stringify(c));
  assert.ok(boxesOverlap(box, next, ADD_SLOT_GAP), 'nearer the pill than the gap, as nothing else fits');
  for (const b of [...cards, ...handles, card]) assert.equal(boxesOverlap(box, b, ADD_SLOT_GAP), false, JSON.stringify(b));
  assert.ok(nearestIsOwn(box, card, cards));
  // Where a spot keeps the gap, it still wins: move the pill down out of the way and the row is clear.
  const lower = placeStepAddZoomed(card, row, { captions: [...captions.slice(0, 2), { ...next, y: 400 }], badges, cards, handles, overlays }, true, REST);
  assert.equal(lower.fit, 'clear');
});

test('T07: the row may sit right against an overlay, and is hidden rather than cover one or a caption', () => {
  const card = { x: 100, y: 300, width: 300, height: 200 };
  // A card close above (it cannot rise), one close below and one either side (no room there).
  const cards = [
    { x: 100, y: 150, width: 300, height: 110 },
    { x: 100, y: 505, width: 300, height: 100 },
    { x: -60, y: 300, width: 150, height: 200 },
    { x: 410, y: 300, width: 150, height: 200 }
  ];
  // A caption over the right of the resting spot, so the row slides left along the card, to the
  // zoom controls' right edge: clear of them by 2.5px, less than the gap it keeps from a caption.
  const caption = { x: 330, y: 266, width: 100, height: 30 };
  const controls = { x: 150, y: 250, width: 45, height: 50 };
  const around = { captions: [caption], cards, handles: [] };
  const spot = placeStepAdd(card, ROW, { ...around, overlays: [controls] }, REST);
  assert.equal(spot.fit, 'clear');
  assert.equal(spot.side, 'above');
  assert.deepEqual(underAny(rowAt(spot), [controls]), []);
  assert.equal(boxesOverlap(rowAt(spot), caption, ADD_SLOT_GAP), false);
  // Wider controls leave no clear spot: before U10 the row covered the caption; now it is not drawn.
  const wide = { x: 150, y: 250, width: 60, height: 50 };
  const covered = placeStepAdd(card, ROW, { ...around, overlays: [wide] }, REST);
  assert.equal(covered.fit, 'hidden');
});

test('U10: with no spot nearer its own card, the row is hidden rather than read as another card\'s', () => {
  const card = { x: 100, y: 100, width: 200, height: 150 };
  // Nothing above or left of the card is on the map; a card right under it; another 4px past the
  // row's spot beside it, so that spot is clear of everything but nearer that card than its own.
  const overlays = [{ x: -1000, y: -1000, width: 3000, height: 1092 }, { x: -1000, y: -1000, width: 1095, height: 3000 }];
  const cards = [{ x: 100, y: 256, width: 200, height: 100 }, { x: 440, y: 100, width: 200, height: 150 }];
  // T07 took that spot ('crowded'), where the row read as the other card's buttons.
  const beside = { x: card.x + card.width + REST, y: card.y, ...ROW };
  assert.equal(nearestIsOwn(beside, card, cards), false);
  assert.equal(placeStepAdd(card, ROW, { captions: [], cards, handles: [], overlays }, REST).fit, 'hidden');
  // Without overlays nothing changes from R22: the resting spot, above the corner.
  assert.deepEqual(placeStepAdd(card, ROW, { captions: [], cards, handles: [] }, REST), { x: 172, y: 70, side: 'above', fit: 'clear' });
});

test('source pins: the + Before / + Next row keeps clear of the map overlays, placed again on a pan (T07)', () => {
  const canvas = readFileSync(new URL('./src/components/canvas/JourneyCanvas.tsx', import.meta.url), 'utf8');
  const start = canvas.indexOf('const StepAddSlot');
  const slot = canvas.slice(start, canvas.indexOf('function withStepAdd', start));
  assert.match(slot, /const root = flow\.closest\('#journey-map'\) \?\? flow\.parentElement;/);
  // The map as far as it is on screen: cut by the window and every scroller or clip around it.
  assert.match(slot, /const clips = \[\{ left: 0, top: 0, width: window\.innerWidth, height: window\.innerHeight \}\];/);
  assert.match(slot, /if \(o\.overflowX !== 'visible' \|\| o\.overflowY !== 'visible'\) clips\.push\(a\.getBoundingClientRect\(\)\);/);
  assert.match(slot, /const onScreen = intersectRects\(flow\.getBoundingClientRect\(\), \.\.\.clips\);/);
  assert.match(slot, /const overlays = root \? mapOverlayRects\(root, onScreen\)\.map\(rectToBox\) : \[\];/);
  assert.match(slot, /window\.addEventListener\('scroll', schedule, true\);/);
  assert.match(slot, /window\.removeEventListener\('scroll', schedule, true\);/);
  assert.match(slot, /\{ captions, cards, handles, badges, overlays \}/);
  // The overlays stay put while the map moves, so a pan places the row again, as does a resize of
  // the map or the tools.
  assert.match(slot, /store\.subscribe\(\(s, prev\) => \{\s*if \(s\.transform !== prev\.transform\) schedule\(\);/);
  assert.match(slot, /sizes\?\.observe\(flow\);/);
  assert.match(slot, /if \(tools\) sizes\?\.observe\(tools\);/);
  assert.match(slot, /panned\(\);/, 'and stops listening when the step is let go');
});

// ---- + Before / + Next never over a caption, a badge, a card, a handle or an overlay (U10) -------
// Zoomed out on a phone or a tablet, after the tap that centres a card in the strip of map above the
// step panel (T06), and at 1280 with a card panned near the tools, no spot around a card covered
// nothing, so the row took one over a caption, a badge or another step's name, and at rest it could
// sit under the journey toolbar. The row now keeps clear of every one of them at every zoom, tries
// past the card's other corner and ends, and is hidden when nothing is clear.

const ROW_U10 = { width: 127.7, height: 22 };

// Every way a drawn row is wrong. A hidden row covers nothing: it takes no room and no pointer, and
// shows only while a pill in it holds keyboard focus (the U10 outside edit).
function u10Problems(spot, row, a) {
  if (spot.fit === 'hidden') return [];
  const box = { x: spot.x, y: spot.y, ...row };
  const out = [];
  const over = (list, name) => list.forEach((b, i) => { if (boxesOverlap(box, b, 0)) out.push(`${name} ${b.id ?? i}`); });
  over(a.captions, 'caption');
  over(a.badges, 'badge');
  over(a.cards, 'card');
  over(a.handles, 'handle');
  over(a.overlays, 'overlay');
  if (boxesOverlap(box, a.card, 0)) out.push('its own card');
  if (!nearestIsOwn(box, a.card, a.cards)) out.push('nearer another card');
  return out;
}

// Views Chrome drew, in screen px (dump.mjs in the U10 scratch folder): the selected card, the row,
// and what was within 220px of the card: captions and each + Step, badges, other cards and handles,
// plus every overlay (the tools, the legend, the zoom controls, the minimap) and the map as far as
// it is on screen, whose edges are overlays too. `was` is where the row sat before U10.
const U10_MEASURED = {
  // Default map at 390x844, the Landing page tapped (T06): the row sat over the VISITS caption, the
  // Meta Ad's badge and its own.
  'default 390 page': {
    was: { x: 131, y: 226, over: ['caption 0', 'badge 0', 'badge 1'] },
    card: [194.5, 256, 64.2, 60.4], onScreen: [0, 216, 390, 210.3],
    captions: [[122, 207.5, 127.7, 22.2], [206.3, 176.4, 129.5, 22.2], [100.7, 216.5, 0, 0]],
    badges: [[150.6, 243.3, 29.1, 20.2], [232.1, 238.3, 29.1, 20.2], [412.4, 235.8, 29.1, 20.2]],
    cards: [[113, 261, 64.2, 46], [283.4, 258.5, 64.2, 61.2], [372.3, 253.5, 66.7, 67.9]],
    handles: [[177.5, 282.7, 2.5, 2.5], [191.8, 285, 2.5, 2.5], [259, 285, 2.5, 2.5], [225.4, 316.7, 2.5, 2.5], [280.7, 287.9, 2.5, 2.5], [347.9, 287.9, 2.5, 2.5], [369.6, 286.3, 2.5, 2.5], [404.4, 250.8, 2.5, 2.5], [439.2, 286.3, 2.5, 2.5]],
    floats: [[260.7, -83, 113.3, 26], [15, 331.3, 28, 80], [235, 321.3, 140, 90]]
  },
  // bp6 at 768x1024, the page selected at fit: the row sat over the VISITS caption and two badges.
  'bp6 768 page': {
    was: { x: 62.6, y: 456.3, over: ['caption 0', 'badge 0', 'badge 1'] },
    card: [125.8, 486.3, 64.5, 75.4], onScreen: [0, 137, 408, 887],
    captions: [[48, 437.6, 128.3, 22.3], [150.3, 406.3, 107.3, 22.3], [101.1, 683.4, 115.3, 22.3], [231.4, 437.6, 121.6, 22.3], [318.3, 574.9, 66.3, 22.3], [227.4, 714.6, 139.4, 22.3]],
    badges: [[71.8, 468.5, 29.2, 20.3], [163.6, 468.5, 29.2, 20.3], [257.9, 468.5, 29.2, 20.3], [347.2, 468.5, 29.2, 20.3], [166.1, 577.7, 29.2, 20.3], [280, 577.7, 29.2, 20.3]],
    cards: [[34, 486.3, 64.5, 54.2], [217.6, 486.3, 67, 90.3], [309.5, 486.3, 64.5, 76.2], [125.8, 595.5, 67, 79.2], [217.6, 595.5, 67, 63]],
    handles: [[98.8, 512.2, 2.5, 2.5], [123.1, 522.8, 2.5, 2.5], [190.6, 522.8, 2.5, 2.5], [156.8, 562, 2.5, 2.5], [214.9, 530.2, 2.5, 2.5], [284.9, 516.7, 2.5, 2.5], [284.9, 543.8, 2.5, 2.5], [249.9, 576.9, 2.5, 2.5], [306.7, 523.2, 2.5, 2.5], [123.1, 633.9, 2.5, 2.5], [158.1, 592.8, 2.5, 2.5], [193.1, 633.9, 2.5, 2.5], [214.9, 625.8, 2.5, 2.5], [249.9, 592.8, 2.5, 2.5], [284.9, 625.8, 2.5, 2.5]],
    floats: [[278.7, 151, 113.3, 26], [15, 929, 28, 80], [253, 919, 140, 90]]
  },
  // bp6 at 1280x800, the upsell panned 12px under the map's top: the row flipped below the card onto
  // the 18h wait caption and the rescue card's badge.
  'bp6 1280 upsell top': {
    was: { x: 552.4, y: 310, over: ['caption 2', 'badge 4'] },
    card: [476.2, 115.5, 138.4, 186.5], onScreen: [0, 104, 896, 696],
    captions: [[194.7, 281.4, 127.3, 22.1], [378.4, 286.8, 59.6, 22.1], [631.6, 310.5, 65.7, 22.1], [571, 481.3, 138.3, 22.1]],
    badges: [[395.9, 100.5, 29, 20.1], [590.7, 100.5, 29, 20.1], [775.2, 100.5, 29, 20.1], [401.1, 326, 29, 20.1], [590.7, 326, 29, 20.1]],
    cards: [[286.6, 115.5, 133.3, 155.7], [665.8, 115.5, 133.3, 157.3], [286.6, 341, 138.4, 163.5], [476.2, 341, 138.4, 130.2]],
    handles: [[280.9, 190.8, 5.1, 5.1], [420.3, 190.8, 5.1, 5.1], [350.6, 271.7, 5.1, 5.1], [470.6, 206.2, 5.1, 5.1], [615.1, 178.2, 5.1, 5.1], [615.1, 234.2, 5.1, 5.1], [542.8, 302.6, 5.1, 5.1], [660.2, 191.6, 5.1, 5.1], [353.2, 335.4, 5.1, 5.1], [425.4, 420.2, 5.1, 5.1], [470.6, 403.5, 5.1, 5.1], [542.8, 335.4, 5.1, 5.1], [615.1, 403.5, 5.1, 5.1]],
    floats: [[391.3, 118, 101.9, 32], [501.2, 118, 175.7, 32], [684.9, 118, 195.1, 32], [734.9, 158, 145.1, 123.8], [15, 705, 28, 80], [741, 695, 140, 90]]
  },
  // The same, panned to the map's right edge: with nothing clear the row rested at y 85.5, above the
  // map's top (104) under the journey toolbar, where it could not be pressed.
  'bp6 1280 upsell right': {
    was: { x: 747.9, y: 85.5, over: ['badge 1', 'overlay'] },
    card: [737.2, 115.5, 138.4, 186.5], onScreen: [0, 104, 896, 696],
    captions: [[455.7, 281.4, 127.3, 22.1], [639.4, 286.8, 59.6, 22.1]],
    badges: [[656.9, 100.5, 29, 20.1], [851.7, 100.5, 29, 20.1], [1036.2, 100.5, 29, 20.1], [662.1, 326, 29, 20.1], [851.7, 326, 29, 20.1]],
    cards: [[547.6, 115.5, 133.3, 155.7], [926.8, 115.5, 133.3, 157.3], [547.6, 341, 138.4, 163.5], [737.2, 341, 138.4, 130.2]],
    handles: [[541.9, 190.8, 5.1, 5.1], [681.3, 190.8, 5.1, 5.1], [611.6, 271.7, 5.1, 5.1], [731.6, 206.2, 5.1, 5.1], [876.1, 178.2, 5.1, 5.1], [876.1, 234.2, 5.1, 5.1], [803.8, 302.6, 5.1, 5.1], [921.2, 191.6, 5.1, 5.1], [614.2, 335.4, 5.1, 5.1], [686.4, 420.2, 5.1, 5.1], [731.6, 403.5, 5.1, 5.1], [803.8, 335.4, 5.1, 5.1], [876.1, 403.5, 5.1, 5.1]],
    floats: [[391.3, 118, 101.9, 32], [501.2, 118, 175.7, 32], [684.9, 118, 195.1, 32], [734.9, 158, 145.1, 123.8], [15, 705, 28, 80], [741, 695, 140, 90]]
  }
};

function measuredAround(m) {
  const [left, top, width, height] = m.onScreen;
  return {
    card: B(m.card),
    captions: m.captions.map(B),
    badges: m.badges.map(B),
    cards: m.cards.map(B),
    handles: m.handles.map(B),
    overlays: [...m.floats.map(B), ...mapEdgeBands({ left, top, width, height }).map(rectToBox)]
  };
}

test('U10: as Chrome drew them, the row that covered a caption, a badge or sat under the toolbar now covers nothing', () => {
  const shown = [];
  for (const [where, m] of Object.entries(U10_MEASURED)) {
    const a = measuredAround(m);
    // Where the row sat before, it covered what the finding named, so this test can see the bug.
    const was = u10Problems({ x: m.was.x, y: m.was.y, fit: 'clear' }, ROW_U10, a);
    for (const name of m.was.over) assert.ok(was.some(p => p.startsWith(name)), `${where}: before, over ${name} (${was.join(', ')})`);
    const spot = placeStepAddZoomed(a.card, ROW_U10, a, true, REST);
    assert.deepEqual(u10Problems(spot, ROW_U10, a), [], `${where}: ${spot.side} ${spot.fit} at ${spot.x},${spot.y}`);
    if (spot.fit !== 'hidden') shown.push(where);
  }
  // Not met by hiding every row: on the default map at 390 the row goes below, slid left past the
  // minimap, clear of both badges and the caption.
  assert.ok(shown.includes('default 390 page'), shown.join(', '));
  const a = measuredAround(U10_MEASURED['default 390 page']);
  const spot = placeStepAddZoomed(a.card, ROW_U10, a, true, REST);
  assert.equal(spot.side, 'below');
  assert.equal(spot.fit, 'clear');
  // The toolbar case: hidden, and its spot never above the map's top, so a canvas that draws it (a
  // pill in keyboard focus, or a canvas that reads x and y only) draws it where it can be pressed.
  const right = measuredAround(U10_MEASURED['bp6 1280 upsell right']);
  const hidden = placeStepAddZoomed(right.card, ROW_U10, right, true, REST);
  assert.equal(hidden.fit, 'hidden');
  assert.notEqual(hidden.fallback, 'rest');
  const box = { x: hidden.x, y: hidden.y, ...ROW_U10 };
  assert.deepEqual(right.overlays.filter(o => boxesOverlap(box, o, 0)), []);
  assert.ok(box.y >= U10_MEASURED['bp6 1280 upsell right'].onScreen[1], `row top ${box.y} below the map's top`);
});

// The default map and bp6 at the fit zoom of each width (measured in Chrome), laid out as the canvas
// lays them out: badges by placeBadges, captions by placeEdgeLabels at their drawn size, both in map
// units, then drawn to the screen. Each step is selected at fit, centred in the visible strip (the
// T06 tap), and panned 12px under the strip's top at its middle, left and right. The overlays are
// shaped as Chrome measured them: at 1024 and wider the tools row and the legend in the top-right, on
// a phone or a tablet the Map tools button, and always the zoom controls and the minimap.
const U10_VIEWS = [
  { width: 390, strip: { left: 0, top: 216, width: 390, height: 210.3 }, zoom: { default: 0.24697, bp6: 0.237956 } },
  { width: 768, strip: { left: 0, top: 137, width: 408, height: 887 }, zoom: { default: 0.257576, bp6: 0.248175 } },
  { width: 1024, strip: { left: 0, top: 104, width: 664, height: 664 }, zoom: { default: 0.419697, bp6: 0.40438 } },
  { width: 1280, strip: { left: 0, top: 104, width: 896, height: 696 }, zoom: { default: 0.566667, bp6: 0.512516 } },
  { width: 1440, strip: { left: 0, top: 104, width: 1020, height: 796 }, zoom: { default: 0.643939, bp6: 0.620438 } }
];

function u10Floats(view) {
  const { left, top, width, height } = view.strip;
  const right = left + width;
  const bottom = top + height;
  const tools = view.width >= 1024
    ? [[right - 504.7, top + 14, 101.9, 32], [right - 394.8, top + 14, 175.7, 32], [right - 211.1, top + 14, 195.1, 32], [right - 161.1, top + 54, 145.1, 123.8]]
    : [[right - 129.3, top + 14, 113.3, 26]];
  return [...tools, [left + 15, bottom - 95, 28, 80], [right - 155, bottom - 105, 140, 90]].map(B);
}

function u10Maps() {
  const def = DEFAULT_LEAD_CAPTURE_PROJECT;
  const defInternals = def.nodes.map(n => internalNode(n.id, n.type, n.position, R22_SIZES[n.type]));
  const bp6 = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
  const measured = new Map(BP6_MEASURED.map(g => [g.id, g.box]));
  const bpInternals = bp6.nodes.map(n => {
    const box = measured.get(n.id);
    return internalNode(n.id, n.type, n.position, box ? { width: box.width, height: box.height } : { width: 270, height: 240 });
  });
  return [
    ['default', defInternals, edgeLabels(defInternals, def.edges, WHOLE).map(withFigure)],
    ['bp6', bpInternals, edgeLabels(bpInternals, bp6.edges, WHOLE).map(withFigure)]
  ];
}

// Everything around one step on the screen, for a view whose map point (0, 0) is at (tx, ty).
function u10Around(layout, stepId, zoom, tx, ty, overlays) {
  const s = b => ({ x: b.x * zoom + tx, y: b.y * zoom + ty, width: b.width * zoom, height: b.height * zoom });
  const own = layout.geos.find(g => g.id === stepId);
  return {
    card: s(own.box),
    cards: layout.geos.filter(g => g.id !== stepId).map(g => ({ id: g.id, ...s(g.box) })),
    handles: layout.geos.flatMap(g => g.handles.map(h => ({ id: g.id, ...s(h) }))),
    captions: layout.captions.map(c => ({ id: c.id, ...s(c.box) })),
    badges: layout.badges.map(b => ({ id: b.id, ...s(b.box) })),
    overlays
  };
}

test('U10: the default map and bp6 at 390, 768, 1024, 1280 and 1440, at fit, tapped and panned: the row covers nothing', () => {
  const problems = [];
  let cases = 0;
  let shown = 0;
  const hiddenWideAtFit = [];
  // Where a hidden row's spot is under an overlay, or is 'rest': a canvas that draws it could not press it.
  const unpressable = [];
  const restUnderTools = [];
  const fallbacks = {};
  for (const [name, internals, labels] of u10Maps()) {
    const geos = internals.map(nodeGeometry);
    for (const view of U10_VIEWS) {
      const zoom = view.zoom[name];
      // The map as the canvas lays it out at this zoom, in map units.
      const placedBadges = placeBadges(geos.map(badgeOn), geos, captionScale(zoom));
      const badges = [...placedBadges].filter(([, p]) => p.box).map(([id, p]) => ({ id, box: p.box }));
      const scale = captionLayoutScale(zoom);
      const placed = placeEdgeLabels(labels, [...obstaclesFor(geos, scale), ...badges.map(b => b.box)], { scale });
      const captions = labels
        .filter(l => placed.get(l.id).form !== 'hidden')
        .map(l => ({ id: l.id, box: scaledCaption(placed.get(l.id), l, scale) }));
      const layout = { geos, badges, captions };
      const overlays = [...u10Floats(view), ...mapEdgeBands(view.strip).map(rectToBox)];
      const { left, top, width, height } = view.strip;
      // Fit: the map's bounds centred in the strip.
      const x0 = Math.min(...geos.map(g => g.box.x));
      const y0 = Math.min(...geos.map(g => g.box.y));
      const x1 = Math.max(...geos.map(g => g.box.x + g.box.width));
      const y1 = Math.max(...geos.map(g => g.box.y + g.box.height));
      const fit = [left + (width - (x1 - x0) * zoom) / 2 - x0 * zoom, top + (height - (y1 - y0) * zoom) / 2 - y0 * zoom];
      for (const g of geos) {
        const w = g.box.width * zoom;
        const h = g.box.height * zoom;
        const fitX = g.box.x * zoom + fit[0];
        const pans = {
          fit,
          tapped: [left + (width - w) / 2 - g.box.x * zoom, top + (height - h) / 2 - g.box.y * zoom],
          top: [fit[0], top + 12 - g.box.y * zoom],
          left: [left + 20 - g.box.x * zoom, top + 12 - g.box.y * zoom],
          right: [left + width - 20 - w - g.box.x * zoom, top + 12 - g.box.y * zoom]
        };
        for (const [pan, [tx, ty]] of Object.entries(pans)) {
          if (pan === 'top' && fitX < left) continue;
          const a = u10Around(layout, g.id, zoom, tx, ty, overlays);
          const spot = placeStepAddZoomed(a.card, ROW_U10, a, zoom < 1, REST);
          const wrong = u10Problems(spot, ROW_U10, a);
          if (wrong.length) problems.push(`${name} ${view.width} ${g.id} ${pan}: ${spot.side} ${spot.fit} over ${wrong.join(', ')}`);
          cases++;
          if (spot.fit !== 'hidden') shown++;
          else {
            if (pan === 'fit' && view.width >= 1280) hiddenWideAtFit.push(`${name} ${view.width} ${g.id}`);
            fallbacks[spot.fallback] = (fallbacks[spot.fallback] || 0) + 1;
            const box = { x: spot.x, y: spot.y, ...ROW_U10 };
            const under = overlays.filter(o => boxesOverlap(box, o, 0)).length;
            // A card panned in under the tools, so that most of it cannot be seen or pressed either, is
            // the one place the row may rest under them: nothing within reach of the card is clear.
            if (under || spot.fallback === 'rest' || boxesOverlap(box, a.card, 0)) {
              if (spot.fallback === 'rest' && coveredShare(a.card, overlays) > 0.5) restUnderTools.push(`${name} ${view.width} ${g.id} ${pan}`);
              else unpressable.push(`${name} ${view.width} ${g.id} ${pan}: ${spot.fallback} under ${under}`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(problems, []);
  // Not met by hiding every row: most are drawn, and at fit on a laptop or a desktop every one is. On
  // a phone or a tablet at fit the row is wider than the card and the space around it is taken by the
  // neighbours' captions and badges, so there some are hidden (every card here carries a badge).
  assert.ok(shown > cases / 2, `${shown} of ${cases} drawn`);
  assert.deepEqual(hiddenWideAtFit, []);
  // Every hidden row still has a spot clear of the overlays and its own card, so one drawn anyway,
  // with a pill in keyboard focus, is seen and pressed there.
  assert.deepEqual(unpressable, [], JSON.stringify(fallbacks));
  assert.ok(restUnderTools.length <= 1, restUnderTools.join(', '));
});

// The share of a box under any of the overlays, sampled on a 10 by 10 grid.
function coveredShare(b, overlays) {
  let under = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const x = b.x + (b.width * (i + 0.5)) / 10;
      const y = b.y + (b.height * (j + 0.5)) / 10;
      if (overlays.some(o => x >= o.x && x <= o.x + o.width && y >= o.y && y <= o.y + o.height)) under++;
    }
  }
  return under / 100;
}

test('U10 outside edit: the canvas measures badges at every zoom and does not draw a row placed hidden', () => {
  const canvas = readFileSync(new URL('./src/components/canvas/JourneyCanvas.tsx', import.meta.url), 'utf8');
  const start = canvas.indexOf('const StepAddSlot');
  const slot = canvas.slice(start, canvas.indexOf('function withStepAdd', start));
  assert.doesNotMatch(slot, /if \(zoom < 1\) flow\.querySelectorAll\('\[data-jv-design-badge\]'\)/, 'badges at every zoom');
  assert.match(slot, /hidden: at\.fit === 'hidden'/);
  // Hidden as a hidden caption is: no room and no pointer, still in the tab order, shown while focused.
  assert.match(slot, /scale: spot\.hidden && !focused \? '0' : undefined/);
  assert.match(slot, /onFocus=\{\(\) => setFocused\(true\)\}/);
  // Measured by layout size, which scale 0 keeps: measured on screen a hidden row read as 0 wide, was
  // placed as if it fitted anywhere, shown, measured again, hidden, and so on.
  assert.match(slot, /const row = \{ width: slot\.offsetWidth, height: slot\.offsetHeight - STEP_ADD_GAP \};/);
});
