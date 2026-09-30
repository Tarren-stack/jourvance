// React Flow draws a line from the handle its edge names, and a name the step does not have draws
// nothing at all. Maps saved before #6 named 'accepted' on a landing page (bp6's page-to-upsell
// line and the auditor's "add an upsell" fix), so that line stayed hidden in every saved map.
// src/lib/stepHandles.ts holds the one handle table and the load-time repair; these tests pin the
// table to the card components and prove every load path runs the repair.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { SOURCE_HANDLES, TARGET_HANDLES, stepHasHandle, repairEdgeHandles, repairJourneyHandles } =
  await import('./src/lib/stepHandles.ts');
const { edgeKind } = await import('./src/lib/edgeKinds.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

// Copied from edge-kinds.test.mjs on purpose, so neither file has to import the other.
const NODE_FILES = {
  'ad-source': 'AdNode.tsx', 'landing-page': 'PageNode.tsx', 'lead-form': 'FormNode.tsx',
  'follow-up-sequence': 'SequenceNode.tsx', 'thank-you': 'ThankYouNode.tsx', upsell: 'UpsellNode.tsx', 'ab-split': 'AbSplitNode.tsx'
};
const handlesIn = (file, side) => {
  const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
  return src.split('<Handle').slice(1).map(b => b.slice(0, b.indexOf('/>')))
    .filter(b => new RegExp(`type="${side}"`).test(b))
    .map(b => (b.match(/\bid="([^"]+)"/) || [])[1] || null);
};

const clone = v => JSON.parse(JSON.stringify(v));
const bp6 = () => clone(ECOM_BLUEPRINTS.find(bp => bp.edges.some(e => e.id === 'e-bp6-2')));
// The e-bp6-2 line exactly as maps saved before #6 hold it.
const legacyBp6 = () => {
  const map = bp6();
  const edge = map.edges.find(e => e.id === 'e-bp6-2');
  edge.sourceHandle = 'accepted';
  edge.data = { ...edge.data, sourceHandle: 'accepted' };
  return map;
};
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

test('the handle tables are read from the node components', () => {
  assert.deepEqual(Object.keys(SOURCE_HANDLES).sort(), Object.keys(NODE_FILES).sort());
  assert.deepEqual(Object.keys(TARGET_HANDLES).sort(), Object.keys(NODE_FILES).sort());
  for (const [type, file] of Object.entries(NODE_FILES)) {
    assert.deepEqual(SOURCE_HANDLES[type], handlesIn(file, 'source'), `${type} source handles`);
    assert.deepEqual(TARGET_HANDLES[type], handlesIn(file, 'target'), `${type} target handles`);
  }
});

test('a pre-#6 bp6 page line loses the handle a page does not have', () => {
  const map = legacyBp6();
  const legacy = map.edges.find(e => e.id === 'e-bp6-2');
  const typeOf = new Map(map.nodes.map(n => [n.id, n]));
  assert.equal(edgeKind(legacy.data.sourceHandle ?? legacy.sourceHandle, typeOf.get(legacy.target)?.data), 'accepted');

  const repaired = repairEdgeHandles(map.nodes, map.edges);
  assert.notEqual(repaired, map.edges);
  const fixed = repaired.find(e => e.id === 'e-bp6-2');
  assert.equal(own(fixed, 'sourceHandle'), false);
  assert.equal(own(fixed.data, 'sourceHandle'), false);
  assert.equal(fixed.data.rate, 15.9);
  assert.equal(fixed.data.targetCount, 236);
  assert.equal(fixed.source, 'bp6-page');
  assert.equal(fixed.target, 'bp6-upsell');
  assert.equal(edgeKind(fixed.data.sourceHandle ?? fixed.sourceHandle, typeOf.get(fixed.target)?.data), 'main');
  map.edges.forEach((e, i) => { if (e.id !== 'e-bp6-2') assert.equal(repaired[i], e, e.id); });
});

test('the pre-#6 auditor upsell edge is repaired', () => {
  const nodes = [
    { id: 'p', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page' } },
    { id: 'u', type: 'upsell', position: { x: 0, y: 0 }, data: { type: 'upsell' } }
  ];
  const edge = {
    id: 'e-page-upsell-123', source: 'p', target: 'u', sourceHandle: 'accepted',
    data: { sourceThroughput: 0, targetCount: 0, rate: 0, sourceHandle: 'accepted' }
  };
  const [fixed] = repairEdgeHandles(nodes, [edge]);
  assert.notEqual(fixed, edge);
  assert.equal(own(fixed, 'sourceHandle'), false);
  assert.equal(own(fixed.data, 'sourceHandle'), false);
  assert.deepEqual([fixed.id, fixed.source, fixed.target], ['e-page-upsell-123', 'p', 'u']);
  assert.deepEqual(fixed.data, { sourceThroughput: 0, targetCount: 0, rate: 0 });
  assert.equal(own(fixed, 'type'), false);
});

test('good handles are never touched', () => {
  for (const map of [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT]) {
    assert.equal(repairEdgeHandles(map.nodes, map.edges), map.edges, map.name || map.title || map.id);
    assert.equal(repairJourneyHandles(map), map);
  }
  const node = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: { type } });
  const nodes = [node('p', 'landing-page'), node('u', 'upsell'), node('s', 'ab-split'), node('q', 'follow-up-sequence'), node('t', 'thank-you')];
  const line = (id, source, target, sourceHandle, targetHandle) => ({
    id, source, target,
    ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}),
    data: { ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}) }
  });
  const edges = [
    line('a', 'u', 't', 'accepted'), line('b', 'u', 't', 'declined'), line('c', 'u', 'q', 'rescue', 'retention-in'),
    line('d', 'p', 'q', 'abandon', 'retention-in'), line('e', 's', 'p', 'branch-a'), line('f', 's', 't', 'branch-b'),
    line('g', 'q', 't')
  ];
  const before = JSON.stringify(edges);
  const out = repairEdgeHandles(nodes, edges);
  assert.equal(out, edges);
  out.forEach((e, i) => assert.equal(e, edges[i]));
  assert.equal(JSON.stringify(out), before);
});

test('a stray target name is dropped only where the step has a main target', () => {
  const node = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: { type } });
  const nodes = [node('p', 'landing-page'), node('u', 'upsell'), node('q', 'follow-up-sequence'), node('ad', 'ad-source')];
  const intoUpsell = { id: 'x', source: 'p', target: 'u', targetHandle: 'retention-in', data: { targetHandle: 'retention-in', rate: 3 } };
  const intoSequence = { id: 'y', source: 'p', target: 'q', targetHandle: 'retention-in', data: { targetHandle: 'retention-in' } };
  const intoAd = { id: 'z', source: 'p', target: 'ad', targetHandle: 'whatever', data: { targetHandle: 'whatever' } };
  const [x, y, z] = repairEdgeHandles(nodes, [intoUpsell, intoSequence, intoAd]);
  assert.equal(own(x, 'targetHandle'), false);
  assert.equal(own(x.data, 'targetHandle'), false);
  assert.equal(x.data.rate, 3);
  assert.equal(y, intoSequence);
  assert.equal(z, intoAd);
});

test('no branch is invented', () => {
  const node = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: { type } });
  const nodes = [node('u', 'upsell'), node('s', 'ab-split'), node('t', 'thank-you')];
  const upsellAbandon = { id: 'a', source: 'u', target: 't', sourceHandle: 'abandon', data: { sourceHandle: 'abandon' } };
  const splitAccepted = { id: 'b', source: 's', target: 't', sourceHandle: 'accepted', data: { sourceHandle: 'accepted' } };
  const edges = [upsellAbandon, splitAccepted];
  const out = repairEdgeHandles(nodes, edges);
  assert.equal(out, edges);
  assert.equal(out[0], upsellAbandon);
  assert.equal(out[1], splitAccepted);
  assert.equal(stepHasHandle('upsell', 'source', null), false);
});

test('stepHasHandle reads the table', () => {
  assert.equal(stepHasHandle('landing-page', 'source', null), true);
  assert.equal(stepHasHandle('landing-page', 'source'), true);
  assert.equal(stepHasHandle('landing-page', 'source', 'accepted'), false);
  assert.equal(stepHasHandle('landing-page', 'source', 'abandon'), true);
  assert.equal(stepHasHandle('follow-up-sequence', 'target', 'retention-in'), true);
  assert.equal(stepHasHandle('thank-you', 'source', null), false);
  assert.equal(stepHasHandle('mystery', 'source', null), false);
  assert.equal(stepHasHandle('toString', 'source', null), false);
  assert.equal(stepHasHandle(undefined, 'target', null), false);
  assert.equal(stepHasHandle(42, 'target', null), false);
});

test('odd input is left alone and never throws', () => {
  const nodes = [
    { id: 'p', type: 'landing-page', position: { x: 0, y: 0 }, data: {} },
    { id: 'm', type: 'mystery', position: { x: 0, y: 0 }, data: {} }
  ];
  const edges = [
    { id: 'missing', source: 'gone', target: 'p', sourceHandle: 'accepted', data: { sourceHandle: 'accepted' } },
    { id: 'unknown', source: 'm', target: 'p', sourceHandle: 'accepted' },
    { id: 'nulldata', source: 'p', target: 'm', data: null },
    { id: 'nodata', source: 'p', target: 'm', data: undefined },
    { id: 'empty', source: 'p', target: 'p', sourceHandle: '', targetHandle: null, data: { sourceHandle: '', targetHandle: null } },
    null
  ];
  const out = repairEdgeHandles(nodes, edges);
  assert.equal(out, edges);
  assert.equal(repairEdgeHandles('nope', edges), edges);
  assert.equal(repairEdgeHandles(nodes, 'nope'), 'nope');
  assert.equal(repairEdgeHandles(nodes, undefined), undefined);
  assert.equal(repairEdgeHandles([null, undefined], edges), edges);
  // A foreign name next to data null still repairs the top-level key and keeps data as it was.
  const [fixed] = repairEdgeHandles(nodes, [{ id: 'q', source: 'p', target: 'm', sourceHandle: 'accepted', data: null }]);
  assert.equal(own(fixed, 'sourceHandle'), false);
  assert.equal(fixed.data, null);
});

test('the repair is not an edit', () => {
  const project = { ...legacyBp6(), id: 'journey_legacy_bp6', name: 'Legacy', updatedAt: '2026-01-01T00:00:00.000Z', forecast: { visitors: 10 } };
  const before = JSON.stringify(project);
  const repaired = repairJourneyHandles(project);
  assert.notEqual(repaired, project);
  assert.equal(JSON.stringify(project), before, 'the input was not mutated');
  assert.equal(repaired.updatedAt, project.updatedAt);
  assert.equal(repaired.id, project.id);
  assert.equal(repaired.name, project.name);
  assert.equal(repaired.forecast, project.forecast);
  assert.equal(repaired.nodes, project.nodes);
  assert.equal(repairJourneyHandles(repaired), repaired);
});

test('loadCurrentJourney repairs the stored map', async () => {
  const stored = JSON.stringify({ ...legacyBp6(), id: 'journey_legacy_bp6', name: 'Legacy', updatedAt: '2026-01-01T00:00:00.000Z' });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: key => (key === 'jourvance_active_project' ? stored : null), setItem() {} },
    configurable: true, writable: true
  });
  const { loadCurrentJourney } = await import('./src/lib/journeyStorage.ts');
  const loaded = loadCurrentJourney();
  const fixed = loaded.edges.find(e => e.id === 'e-bp6-2');
  assert.equal(own(fixed, 'sourceHandle'), false);
  assert.equal(own(fixed.data, 'sourceHandle'), false);
  assert.equal(loaded.updatedAt, '2026-01-01T00:00:00.000Z');
  const kept = loaded.edges.find(e => e.id === 'e-bp6-4');
  assert.equal(kept.sourceHandle, 'accepted');
  assert.equal(kept.data.sourceHandle, 'accepted');
});

test('every load path repairs', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  // The sign-in load repairs handles (#6). Whether it also strips pre-C36 fields is R25's, pinned by
  // running App's own expressions in 'the sign-in load reads ... as one' below.
  assert.match(app,/repairJourneyHandles\(remote\)|edges:\s*repairEdgeHandles\(remote\.nodes,\s*remote\.edges\)/);
  assert.equal(app.includes('edges: remote.edges,'), false);
  const modal = fs.readFileSync('src/components/modals/BlueprintModal.tsx', 'utf8');
  assert.ok(modal.includes('zeroBlueprintMetrics(clonedNodes, repairEdgeHandles(clonedNodes, clonedEdges))'));
  const storage = fs.readFileSync('src/lib/journeyStorage.ts', 'utf8');
  assert.ok(storage.includes('return repairJourneyHandles(parsed as JourneyProject)'));
  const handles = fs.readFileSync('src/lib/stepHandles.ts', 'utf8');
  const imports = handles.split('\n').filter(l => /^\s*import\b/.test(l));
  assert.ok(imports.length > 0);
  // Type-only, or the pre-C36 strip (R25), which is itself type-only, so node can load both.
  for (const line of imports) assert.match(line, /^import type |^import \{ stripCanvasOnlyFields \} from '\.\/canvasOnlyFields\.ts';$/, line);
  const strip = fs.readFileSync('src/lib/canvasOnlyFields.ts', 'utf8');
  for (const line of strip.split('\n').filter(l => /^\s*import\b/.test(l))) assert.match(line, /^import type /, line);
});

// R25: journeys saved before C36 carry what the canvas adds only for drawing. canvasOnlyFields.ts
// strips it, the load repair (repairJourneyHandles) runs it, and the strip is not an edit. The
// browser's copy and the account's copy of one save are compared on sign-in and on a library write,
// so both account reads pass through the same repair; the last three tests hold that line.
const { stripCanvasOnlyFields } = await import('./src/lib/canvasOnlyFields.ts');
const { historyFingerprint } = await import('./src/lib/journeyHistory.ts');

/** The default journey as a Backspace delete or a drag saved it before C36. */
function preC36(project = DEFAULT_LEAD_CAPTURE_PROJECT) {
  const clean = clone(project);
  const byId = new Map(clean.nodes.map(n => [n.id, n]));
  return {
    ...clean, id: 'journey_pre_c36', updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: clean.nodes.map((n, i) => ({
      ...n, measured: { width: 260, height: 140 }, selected: i === 0, ...(i === 0 ? { dragging: false } : {}),
      data: { ...n.data, canvasViewMode: 'roas' }
    })),
    edges: clean.edges.map((e, i) => ({
      ...e, markerEnd: { type: 'arrowclosed', color: '#6366F1' }, ...(i === 0 ? { selected: true } : {}),
      data: {
        ...e.data, isRetentionEdge: false, inLoop: false,
        sourceNodeType: byId.get(e.source)?.data?.type, targetNodeType: byId.get(e.target)?.data?.type,
        sourceNodeLabel: byId.get(e.source)?.data?.label, targetNodeLabel: byId.get(e.target)?.data?.label,
        sourceNodeData: byId.get(e.source)?.data, targetNodeData: byId.get(e.target)?.data, isSelected: i === 0
      }
    }))
  };
}
const withoutIdentity = p => ({ ...p, id: DEFAULT_LEAD_CAPTURE_PROJECT.id, updatedAt: DEFAULT_LEAD_CAPTURE_PROJECT.updatedAt });
const stripJourney = p => {
  const out = stripCanvasOnlyFields(p.nodes, p.edges);
  return out.nodes === p.nodes && out.edges === p.edges ? p : { ...p, ...out };
};

test('the strip gives back exactly the journey a pre-C36 save bloated', () => {
  const bloated = preC36();
  const before = JSON.stringify(bloated);
  const stripped = stripJourney(bloated);
  assert.equal(JSON.stringify(bloated), before, 'the input was not mutated');
  assert.deepEqual(withoutIdentity(stripped), withoutIdentity(clone(DEFAULT_LEAD_CAPTURE_PROJECT)));
  assert.ok(JSON.stringify(stripped).length < before.length / 2, 'the stored copy shrinks');
  assert.equal(stripped.updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(stripJourney(stripped), stripped, 'a second pass changes nothing');
  // The load repair strips it too, and a clean journey loads as the same object.
  assert.deepEqual(repairJourneyHandles(bloated), stripped, 'loading a pre-C36 save strips it');
  assert.equal(repairJourneyHandles(stripped), stripped);
});

test('the strip keeps what a person or a generator saved', () => {
  const nodes = [
    { id: 'p', type: 'landing-page', position: { x: 1, y: 2 }, width: 300, height: 180, measured: { width: 1, height: 1 }, data: { type: 'landing-page', description: 'Own copy', canvasViewMode: 'edit' } },
    { id: 'q', type: 'follow-up-sequence', position: { x: 0, y: 0 }, data: { type: 'follow-up-sequence' } }
  ];
  const edges = [
    { id: 'r', source: 'p', target: 'q', sourceHandle: 'abandon', targetHandle: 'retention-in', animated: true, markerEnd: { type: 'arrowclosed' },
      data: { sourceThroughput: 10, targetCount: 4, rate: 40, dropOffAlert: true, sourceHandle: 'abandon', targetHandle: 'retention-in', isRetentionEdge: true, inLoop: true, description: 'A line', sourceNodeData: { type: 'landing-page' } } }
  ];
  const out = stripCanvasOnlyFields(nodes, edges);
  assert.deepEqual(out.nodes[0], { id: 'p', type: 'landing-page', position: { x: 1, y: 2 }, width: 300, height: 180, data: { type: 'landing-page', description: 'Own copy' } });
  assert.equal(out.nodes[1], nodes[1], 'a clean step is the same object');
  assert.deepEqual(out.edges[0], {
    id: 'r', source: 'p', target: 'q', sourceHandle: 'abandon', targetHandle: 'retention-in', animated: true,
    data: { sourceThroughput: 10, targetCount: 4, rate: 40, dropOffAlert: true, sourceHandle: 'abandon', targetHandle: 'retention-in', isRetentionEdge: true }
  });
  // A saved false reads exactly like no flag, so it goes; true is kept above.
  const [plain] = stripCanvasOnlyFields(nodes, [{ id: 's', source: 'p', target: 'q', data: { rate: 1, isRetentionEdge: false } }]).edges;
  assert.deepEqual(plain.data, { rate: 1 });
});

test('clean journeys and odd input come back as they were', () => {
  for (const map of [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT]) {
    const out = stripCanvasOnlyFields(map.nodes, map.edges);
    assert.equal(out.nodes, map.nodes, map.name || map.id);
    assert.equal(out.edges, map.edges, map.name || map.id);
  }
  const odd = [null, undefined, 3, 'x', { id: 'n', data: null }, { id: 'm' }];
  const out = stripCanvasOnlyFields(odd, odd);
  assert.equal(out.nodes, odd);
  assert.equal(out.edges, odd);
  assert.deepEqual(stripCanvasOnlyFields(undefined, 'nope'), { nodes: undefined, edges: 'nope' });
});

test('the strip is not an edit: undo history and the stored stamp see nothing', () => {
  const bloated = preC36();
  const stripped = stripJourney(bloated);
  // History already ignored every key the strip removes but inLoop and a false isRetentionEdge, so
  // with those two set aside the fingerprints agree, and updatedAt (how App tells a load from an
  // edit) is kept.
  const isolated = p => ({ ...p, edges: p.edges.map(e => ({ ...e, data: Object.fromEntries(Object.entries(e.data).filter(([k]) => k !== 'inLoop' && k !== 'isRetentionEdge')) })) });
  assert.equal(historyFingerprint(isolated(bloated)), historyFingerprint(stripped));
  assert.equal(stripped.updatedAt, bloated.updatedAt);
  assert.equal(stripped.name, bloated.name);
});

test('every browser and account load path hands back one copy of a pre-C36 save without writing it', async () => {
  const stored = JSON.stringify(preC36());
  const writes = [];
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: key => (key === 'jourvance_active_project' || key === 'jourvance_journey:journey_pre_c36' ? stored : null),
      setItem: (key) => { writes.push(key); }, key: () => 'jourvance_journey:journey_pre_c36', length: 1
    },
    configurable: true, writable: true
  });
  const { loadCurrentJourney, readParkedJourney, listLocalJourneys } = await import('./src/lib/journeyStorage.ts');
  const { fromServerJourney } = await import('./src/lib/journeyLibrary.ts');
  const expected = repairJourneyHandles(JSON.parse(stored));
  for (const [name, loaded] of [
    ['loadCurrentJourney', loadCurrentJourney()],
    ['readParkedJourney', readParkedJourney('journey_pre_c36')],
    ['listLocalJourneys', listLocalJourneys()[0]],
    ['fromServerJourney', fromServerJourney(JSON.parse(stored))]
  ]) {
    assert.equal(loaded.updatedAt, '2026-01-01T00:00:00.000Z', name);
    assert.deepEqual(loaded.nodes, expected.nodes, name);
    assert.deepEqual(loaded.edges, expected.edges, name);
  }
  // That one copy is the journey as it was before the save bloated it.
  assert.deepEqual(withoutIdentity(expected), withoutIdentity(clone(DEFAULT_LEAD_CAPTURE_PROJECT)));
  assert.deepEqual(writes, [], 'loading writes nothing');
});

// The browser's copy of a journey and the account's copy of the same save must read as one on every
// comparison, whatever the load repair removes. Otherwise the sign-in load sets the browser's copy
// aside as a duplicate and a library rename is refused as diverged. These run App's and
// journeyClient's own code, so switching the strip on in repairJourneyHandles before both pass the
// account copy through it fails here.
const { adoptChangesNothing, chooseOnLoad, writeKeepsAccountCopy } = await import('./src/lib/accountSync.ts');
const { stripTypeScriptTypes } = await import('node:module');

/** App's own right-hand side for `name` inside `block`, run with the load's locals bound. */
function appExpression(block, pattern, locals) {
  const m = block.match(pattern);
  assert.ok(m, `App.tsx no longer has ${pattern}`);
  const expr = m[1].replace(/\s+as\s+[A-Z]\w*(\[\])?/g, '');
  return new Function(...Object.keys(locals), `return (${expr});`)(...Object.values(locals));
}

async function browserLoad(saved) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: key => (key === 'jourvance_active_project' || key === `jourvance_journey:${saved.id}` ? JSON.stringify(saved) : null),
      setItem() {}, key: () => `jourvance_journey:${saved.id}`, length: 1
    },
    configurable: true, writable: true
  });
  const { loadCurrentJourney, listLocalJourneys } = await import('./src/lib/journeyStorage.ts');
  return { current: loadCurrentJourney(), listed: listLocalJourneys()[0] };
}

test('the sign-in load reads the browser copy and the account copy of one pre-C36 save as one', async () => {
  const saved = preC36();
  const { current: p } = await browserLoad(saved);
  // The account's copy of that save, under the stamp the server gave it.
  const remote = { ...clone(saved), updatedAt: '2026-01-01T00:00:01.234Z' };
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const repaired = appExpression(app, /const repaired = ([^;\n]+);/, { remote, repairEdgeHandles, repairJourneyHandles });
  const same = adoptChangesNothing(p, repaired);
  assert.equal(same, true, 'the same save reads as the same content');
  // With no sync record yet (every browser on first sign-in after deploy), a differing copy is set aside.
  assert.equal(chooseOnLoad(p.updatedAt, remote.updatedAt, null, same), 'keep');
  // What the adopt path puts on screen, and later saves, is what the browser load gives.
  const asAccount = app.slice(app.indexOf('const asAccount = '), app.indexOf('updatedAt: remoteAt', app.indexOf('const asAccount = ')));
  const locals = { remote, repaired };
  assert.deepEqual(appExpression(asAccount, /\bnodes: ([^,\n]+),/, locals), p.nodes);
  assert.deepEqual(appExpression(asAccount, /\bedges: ([^,\n]+),/, locals), p.edges);
});

test('a library rename of a pre-C36 journey keeps the account copy it read', async () => {
  const saved = preC36();
  const { listed } = await browserLoad(saved);
  const { fromServerJourney } = await import('./src/lib/journeyLibrary.ts');
  const remote = { ...clone(saved), updatedAt: '2026-01-01T00:00:01.234Z' };
  // journeyClient's own noteAccountRead, run as written, records the read the write is checked against.
  const client = fs.readFileSync('src/lib/journeyClient.ts', 'utf8');
  const start = client.indexOf('export function noteAccountRead(');
  assert.ok(start >= 0, 'journeyClient.ts no longer has noteAccountRead');
  const source = stripTypeScriptTypes(client.slice(start, client.indexOf('\n}\n', start) + 2).replace(/^export /, ''));
  const accountReads = new Map();
  const note = new Function('accountReads', 'readKey', 'repairJourneyHandles', `${source}\nreturn noteAccountRead;`)(
    accountReads, (uid, id) => JSON.stringify([uid, id]), repairJourneyHandles);
  note('uid-1', saved.id, remote);
  const read = accountReads.get(JSON.stringify(['uid-1', saved.id]));
  assert.ok(read && read.copy);
  // The browser's copy and the library's copy of the account journey, renamed, with no sync record.
  for (const [name, copy] of [['listLocalJourneys', listed], ['fromServerJourney', fromServerJourney(clone(remote))]]) {
    assert.equal(writeKeepsAccountCopy({ ...copy, name: 'Renamed' }, read.copy, null), true, name);
  }
});
