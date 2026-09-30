import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The canvas had no undo. src/lib/journeyHistory.ts records one step per content change, where
// a stats poll, a selection, a measured size or a publish flag is NOT content: if any of those
// became a step, every 20 second poll would push the person's real edits out of reach.

const {
  HISTORY_LIMIT, COALESCE_MS, GESTURE_MS, PUBLISH_KEYS, LIVE_STAT_KEYS, EDGE_MEASURED_KEYS,
  createHistory, recordEdit, undoStep, redoStep, restoreSnapshot,
  historyFingerprint, saveFingerprint, editKey, historyShortcut, parentMovedIds
} = await import('./src/lib/journeyHistory.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function base() {
  return {
    id: 'j1',
    name: 'Spring launch',
    businessType: 'Salon',
    offerHeadline: 'Book a cut',
    goal: 'Leads',
    updatedAt: '2026-09-01T00:00:00.000Z',
    forecast: { monthlyAdSpend: 500, cpc: 1, conversionRate: 2, corePrice: 40, cogsPercentage: 20, bumpTakeRate: 10, bumpPrice: 5, upsellTakeRate: 5, upsellPrice: 20 },
    nodes: [
      { id: 'a', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', label: 'Page', headline: 'Hi', visitors: 10, conversions: 2, published: true, publishedUrl: 'https://x.test/p' } },
      { id: 'b', type: 'follow-up-sequence', position: { x: 300, y: 0 }, data: { type: 'follow-up-sequence', label: 'Seq', jourvanceFlowId: 'f1', jourvanceFlowName: 'Welcome', flowEnrolled: 4 } },
      { id: 'c', type: 'thank-you', position: { x: 600, y: 0 }, data: { type: 'thank-you', label: 'Thanks' } }
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', data: { sourceThroughput: 10, targetCount: 2, rate: 20 } },
      { id: 'e2', source: 'b', target: 'c', data: { sourceThroughput: 2, targetCount: 1, rate: 50 } }
    ]
  };
}

const withNode = (p, id, patch) => ({ ...p, nodes: p.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) });
const withData = (p, id, patch) => ({ ...p, nodes: p.nodes.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test('the constants are the ones the spec names', () => {
  assert.equal(HISTORY_LIMIT, 100);
  assert.equal(COALESCE_MS, 1000);
  assert.equal(GESTURE_MS, 150);
  assert.deepEqual([...PUBLISH_KEYS], ['published', 'publishedAt', 'publishedUrl']);
  assert.deepEqual([...EDGE_MEASURED_KEYS], ['sourceThroughput', 'targetCount', 'rate']);
  for (const key of ['visitors', 'conversions', 'flowEnrolled', 'flowSent', 'flowClicked', 'flowOpened', 'flowRevenue']) {
    assert.ok(LIVE_STAT_KEYS.includes(key), key);
  }
});

test('recordEdit pushes the before-state and clears future; undo and redo walk it', () => {
  const p0 = base();
  const p1 = withData(p0, 'a', { headline: 'Hello' });
  let h = recordEdit(createHistory(), p0, p1, 1000);
  assert.equal(h.past.length, 1);
  assert.equal(h.past[0], p0);
  assert.deepEqual(h.future, []);

  const undone = undoStep(h, p1);
  assert.equal(undone.target, p0);
  assert.deepEqual(undone.history.past, []);
  assert.equal(undone.history.future.at(-1), p1);

  const redone = redoStep(undone.history, p0);
  assert.equal(redone.target, p1);
  assert.equal(redone.history.past.at(-1), p0);
  assert.deepEqual(redone.history.future, []);

  // A new edit after an undo drops what could have been redone.
  const p2 = withData(p0, 'c', { label: 'Done' });
  h = recordEdit(undone.history, p0, p2, 5000);
  assert.deepEqual(h.future, []);
  assert.equal(undoStep(createHistory(), p0), null);
  assert.equal(redoStep(createHistory(), p0), null);
});

test('history keeps exactly 100 steps: after 150 edits the oldest kept is the project from edit 50', () => {
  const projects = [base()];
  let h = createHistory();
  for (let i = 1; i <= 150; i++) {
    const prev = projects[i - 1];
    const next = { ...prev, nodes: [...prev.nodes, { id: `n${i}`, type: 'thank-you', position: { x: i, y: 0 }, data: { type: 'thank-you', label: `T${i}` } }] };
    projects.push(next);
    h = recordEdit(h, prev, next, i * 1000);
  }
  assert.equal(h.past.length, 100);
  assert.equal(h.past[0], projects[50]);
  assert.equal(h.past.at(-1), projects[149]);
});

test('view state, live counts, publish flags and updatedAt are not an edit', () => {
  const p0 = base();
  const h = recordEdit(createHistory(), p0, withData(p0, 'a', { headline: 'x' }), 100);
  const variants = {
    selected: withNode(p0, 'a', { selected: true }),
    dragging: withNode(p0, 'a', { dragging: true }),
    measured: withNode(p0, 'a', { measured: { width: 240, height: 180 }, width: 240, height: 180 }),
    updatedAt: { ...p0, updatedAt: '2026-09-02T00:00:00.000Z' },
    canvasViewMode: withData(p0, 'a', { canvasViewMode: 'stats' }),
    measuredCount: withData(p0, 'a', { visitors: 999 }),
    flowCount: withData(p0, 'b', { flowEnrolled: 77 }),
    flowName: withData(p0, 'b', { jourvanceFlowName: 'Renamed in the email tool' }),
    edgeRate: { ...p0, edges: p0.edges.map(e => (e.id === 'e1' ? { ...e, data: { ...e.data, rate: 99 } } : e)) },
    edgeView: { ...p0, edges: p0.edges.map(e => (e.id === 'e1' ? { ...e, selected: true, data: { ...e.data, isSelected: true, sourceNodeLabel: 'Page', onSelectEdge: () => {} } } : e)) },
    publishFlag: withData(p0, 'a', { published: false })
  };
  for (const [name, after] of Object.entries(variants)) {
    assert.equal(recordEdit(h, p0, after, 5000), h, `${name} became an undo step`);
    assert.equal(historyFingerprint(after), historyFingerprint(p0), name);
  }
  // Saving is a wider net: a publish or a flow rename is saved, a count is not.
  assert.notEqual(saveFingerprint(variants.publishFlag), saveFingerprint(p0));
  assert.notEqual(saveFingerprint(variants.flowName), saveFingerprint(p0));
  assert.equal(saveFingerprint(variants.flowCount), saveFingerprint(p0));
  assert.equal(saveFingerprint(variants.measuredCount), saveFingerprint(p0));
  assert.equal(saveFingerprint(variants.selected), saveFingerprint(p0));
  // Forecast values and positions are content.
  assert.notEqual(historyFingerprint({ ...p0, forecast: { ...p0.forecast, cpc: 2 } }), historyFingerprint(p0));
  assert.notEqual(historyFingerprint(withNode(p0, 'a', { position: { x: 5, y: 0 } })), historyFingerprint(p0));
});

test('the fingerprint does not depend on key order', () => {
  const p0 = base();
  const reordered = { ...p0, nodes: p0.nodes.map(n => ({ data: Object.fromEntries(Object.entries(n.data).reverse()), position: n.position, type: n.type, id: n.id })) };
  assert.equal(historyFingerprint(reordered), historyFingerprint(p0));
});

test('editKey names one node data change or one top-level field, and nothing structural', () => {
  const p0 = base();
  assert.equal(editKey(p0, withData(p0, 'a', { headline: 'x' })), 'data:a');
  assert.equal(editKey(p0, { ...p0, name: 'x' }), 'field:name');
  assert.equal(editKey(p0, { ...p0, forecast: { ...p0.forecast, cpc: 3 } }), 'field:forecast');
  assert.equal(editKey(p0, withNode(p0, 'a', { position: { x: 9, y: 9 } })), null);
  assert.equal(editKey(p0, withData(withData(p0, 'a', { headline: 'x' }), 'c', { label: 'y' })), null);
  assert.equal(editKey(p0, { ...withData(p0, 'a', { headline: 'x' }), name: 'x' }), null);
  assert.equal(editKey(p0, { ...p0, edges: p0.edges.slice(1) }), null);
  assert.equal(editKey(p0, { ...p0, name: 'x', goal: 'y' }), null);
});

test('typing in one card or one field is one step until a pause of more than 1 second', () => {
  const p0 = base();
  const a1 = withData(p0, 'a', { headline: 'H' });
  const a2 = withData(a1, 'a', { headline: 'He' });
  const a3 = withData(a2, 'a', { headline: 'Hel' });
  let h = recordEdit(createHistory(), p0, a1, 0);
  h = recordEdit(h, a1, a2, 400);
  h = recordEdit(h, a2, a3, 800);
  assert.equal(h.past.length, 1, 'edits to A at 0, 400 and 800ms are one step');
  const a4 = withData(a3, 'a', { headline: 'Hell' });
  h = recordEdit(h, a3, a4, 2500);
  assert.equal(h.past.length, 2, 'an edit to A at 2500ms is a new step');
  const b1 = withData(a4, 'c', { label: 'T2' });
  h = recordEdit(h, a4, b1, 2800);
  assert.equal(h.past.length, 3, 'an edit to another card 300ms later is a new step');

  const n1 = { ...p0, name: 'S' };
  const n2 = { ...n1, name: 'Sp' };
  const n3 = { ...n2, name: 'Spr' };
  let hn = recordEdit(createHistory(), p0, n1, 10000);
  hn = recordEdit(hn, n1, n2, 10200);
  hn = recordEdit(hn, n2, n3, 10400);
  assert.equal(hn.past.length, 1, 'three name edits 200ms apart are one step');
  assert.equal(undoStep(hn, n3).target, p0);

  const undone = undoStep(h, b1);
  const again = withData(a4, 'c', { label: 'T3' });
  const after = recordEdit(undone.history, a4, again, 2900);
  assert.equal(after.past.length, undone.history.past.length + 1, 'after an undo, a same-key edit 100ms later is a new step');
});

test('removing a step and then its lines 20ms later is one step, and undo brings back both', () => {
  const p0 = base();
  const noNode = { ...p0, nodes: p0.nodes.filter(n => n.id !== 'b') };
  const noLines = { ...noNode, edges: [] };
  let h = recordEdit(createHistory(), p0, noNode, 5000);
  h = recordEdit(h, noNode, noLines, 5020);
  assert.equal(h.past.length, 1);
  const step = undoStep(h, noLines);
  const restored = restoreSnapshot(noLines, step.target, '2026-09-03T00:00:00.000Z');
  assert.deepEqual(restored.nodes.map(n => n.id), ['a', 'b', 'c']);
  assert.deepEqual(restored.edges.map(e => e.id), ['e1', 'e2']);
  assert.deepEqual(restored.nodes.find(n => n.id === 'b').position, { x: 300, y: 0 });
});

test('restoreSnapshot keeps the present counts and publish state, and the target content', () => {
  const target = base();
  target.nodes[1] = { ...target.nodes[1], data: { ...target.nodes[1].data, jourvanceFlowName: 'Old name' } };
  const current = {
    ...base(),
    name: 'Changed',
    nodes: [
      { ...target.nodes[0], data: { type: 'landing-page', label: 'Page', headline: 'Edited', visitors: 50, conversions: 9, published: false } },
      { ...target.nodes[1], data: { ...target.nodes[1].data, flowEnrolled: 12, jourvanceFlowName: 'New name' } }
    ],
    edges: [{ ...target.edges[0], data: { sourceThroughput: 50, targetCount: 9, rate: 18 } }]
  };
  const stamp = '2026-09-04T00:00:00.000Z';
  const out = restoreSnapshot(current, target, stamp);
  const a = out.nodes.find(n => n.id === 'a').data;
  assert.equal(a.headline, 'Hi', 'content comes from the target');
  assert.equal(a.visitors, 50);
  assert.equal(a.conversions, 9);
  assert.equal(a.published, false);
  assert.ok(!('publishedUrl' in a), 'a publish key the present lacks is deleted');
  const b = out.nodes.find(n => n.id === 'b').data;
  assert.equal(b.flowEnrolled, 12);
  assert.equal(b.jourvanceFlowName, 'Old name', 'the flow name stays with the target flow id');
  assert.equal(out.edges.find(e => e.id === 'e1').data.rate, 18);
  assert.equal(out.edges.find(e => e.id === 'e2').data.rate, 50, 'a line the present lacks keeps its snapshot values');
  assert.equal(out.nodes.find(n => n.id === 'c'), target.nodes[2], 'a node the present lacks is untouched');
  assert.equal(out.name, 'Spring launch');
  assert.equal(out.updatedAt, stamp);
});

test('recordEdit, undoStep, redoStep and restoreSnapshot never mutate frozen snapshots', () => {
  const p0 = deepFreeze(base());
  const p1 = deepFreeze(withData(p0, 'a', { headline: 'x', visitors: 1 }));
  const p2 = deepFreeze({ ...p1, nodes: p1.nodes.slice(1) });
  const h1 = deepFreeze(recordEdit(createHistory(), p0, p1, 0));
  const h2 = deepFreeze(recordEdit(h1, p1, p2, 5000));
  const u = undoStep(h2, p2);
  deepFreeze(u);
  assert.doesNotThrow(() => restoreSnapshot(p2, u.target, 'now'));
  assert.doesNotThrow(() => restoreSnapshot(p1, p0, 'now'));
  assert.doesNotThrow(() => redoStep(u.history, u.target));
  assert.doesNotThrow(() => historyFingerprint(p2));
});

test('the shortcut matrix: Cmd or Ctrl+Z undoes, Shift or Ctrl+Y redoes, never in a text field', () => {
  const k = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
  const body = { tagName: 'BODY' };
  assert.equal(historyShortcut(k('z', { metaKey: true }), body), 'undo');
  assert.equal(historyShortcut(k('z', { ctrlKey: true }), body), 'undo');
  assert.equal(historyShortcut(k('Z', { metaKey: true, shiftKey: true }), body), 'redo');
  assert.equal(historyShortcut(k('z', { ctrlKey: true, shiftKey: true }), body), 'redo');
  assert.equal(historyShortcut(k('y', { ctrlKey: true }), body), 'redo');
  assert.equal(historyShortcut(k('y', { metaKey: true }), body), null);
  assert.equal(historyShortcut(k('z', { metaKey: true, altKey: true }), body), null);
  assert.equal(historyShortcut(k('z'), body), null);
  assert.equal(historyShortcut(k('z', { metaKey: true }), null), 'undo');
  const cmdZ = k('z', { metaKey: true });
  assert.equal(historyShortcut(cmdZ, { tagName: 'INPUT', type: 'text' }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'INPUT', type: '' }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'INPUT', type: 'number' }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'TEXTAREA' }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'SELECT' }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'DIV', isContentEditable: true }), null);
  assert.equal(historyShortcut(cmdZ, { tagName: 'INPUT', type: 'checkbox' }), 'undo');
});

// Cmd+Z used to reach the map behind an open Check design drawer: the fix was undone behind it,
// the drawer kept offering its own Undo, and that Undo then said the fix had been edited.
test('modalIsOpen sees an aria-modal drawer and a native modal dialog, and nothing else', async () => {
  const { modalIsOpen } = await import('./src/lib/modalOpen.ts');
  const root = (present, { noModalPseudo = false } = {}) => ({
    querySelector(sel) {
      if (sel === 'dialog:modal' && noModalPseudo) throw new SyntaxError('unknown pseudo-class');
      return present.includes(sel) ? {} : null;
    }
  });
  assert.equal(modalIsOpen(root([])), false);
  assert.equal(modalIsOpen(null), false);
  assert.equal(modalIsOpen(root(['[aria-modal="true"]'])), true);
  assert.equal(modalIsOpen(root(['dialog:modal'])), true);
  // A dialog opened with show() is not modal and leaves the map live.
  assert.equal(modalIsOpen(root(['dialog[open]'])), false);
  // Without :modal support, any open dialog counts rather than letting the shortcut through.
  assert.equal(modalIsOpen(root(['dialog[open]'], { noModalPseudo: true })), true);
  assert.equal(modalIsOpen(root([], { noModalPseudo: true })), false);
});

test('the undo shortcut does nothing while a modal is open', () => {
  const src = read('./src/lib/useJourneyEditing.ts');
  const onKey = src.slice(src.indexOf('const onKey = (e: KeyboardEvent)'), src.indexOf("window.addEventListener('keydown', onKey)"));
  assert.ok(onKey.length > 0, 'the keydown handler is where the test expects it');
  const guard = onKey.indexOf('if (modalIsOpen(document)) return;');
  assert.ok(guard >= 0, 'the handler checks for an open modal');
  assert.ok(guard < onKey.indexOf('historyShortcut('), 'the check runs before any shortcut is read');
  // Check design is the drawer the defect was found behind; it must stay a modal the guard sees.
  assert.match(read('./src/components/drawers/PreFlightAuditDrawer.tsx'), /aria-modal="true"/);
});

test('parentMovedIds names moved and new ids, not unmoved ones', () => {
  const seen = new Map([['a', { x: 0, y: 0 }], ['b', { x: 10, y: 10 }]]);
  const moved = parentMovedIds([
    { id: 'a', position: { x: 0, y: 0 } },
    { id: 'b', position: { x: 210, y: 10 } },
    { id: 'n', position: { x: 0, y: 0 } }
  ], seen);
  assert.deepEqual([...moved].sort(), ['b', 'n']);
});

test('the live stat keys are exactly liveStats.ts\'s measured, flow and page counts', async () => {
  // History imports every list from liveStats, so a new measured key is never an undo step.
  const { MEASURED_KEYS, FLOW_STAT_KEYS, PAGE_STAT_KEYS } = await import('./src/lib/liveStats.ts');
  assert.ok(MEASURED_KEYS.length > 20);
  assert.deepEqual([...FLOW_STAT_KEYS], ['flowEnrolled', 'flowSent', 'flowClicked', 'flowOpened', 'flowRevenue']);
  assert.deepEqual([...PAGE_STAT_KEYS], ['leads']);
  assert.deepEqual([...LIVE_STAT_KEYS], [...MEASURED_KEYS, ...FLOW_STAT_KEYS, ...PAGE_STAT_KEYS]);
  // Every branch of the stats poll names the keys it writes (and nulls while not measured). Read
  // them ALL: matching only the first array checked the ad branch and let `leads` through.
  const arrays = [...read('./server/routes/analyticsRoutes.mjs').matchAll(/const keys = \[([^\]]*)\]/g)];
  assert.ok(arrays.length >= 7, `the stats poll still names its keys per step type (found ${arrays.length})`);
  const written = new Set(arrays.flatMap(a => [...a[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1])));
  for (const key of ['clicks', 'leads', 'views', 'flowEnrolled', 'pageViews', 'takes', 'branchAVisitors']) {
    assert.ok(written.has(key), `the pin reads the branch that writes ${key}`);
  }
  for (const key of written) assert.ok(LIVE_STAT_KEYS.includes(key), `${key} is written by the poll but would be an undo step`);
});

test('a landing-page poll that writes leads adds no undo step and no autosave', () => {
  // The notMeasured branch writes `leads: null` over an absent key, then each new lead bumps it.
  const p0 = base();
  const p1 = withData(p0, 'a', { visitors: null, leads: null, conversions: null });
  const p2 = withData(p1, 'a', { leads: 3 });
  const h = createHistory();
  assert.equal(recordEdit(h, p0, p1, 5000), h);
  assert.equal(recordEdit(h, p1, p2, 25000), h);
  assert.equal(saveFingerprint(p0), saveFingerprint(p1));
  assert.equal(saveFingerprint(p1), saveFingerprint(p2));
  // Undo takes leads from the present like every other live count.
  const edited = withData(p2, 'a', { headline: 'Edited' });
  const step = undoStep(recordEdit(h, p2, edited, 30000), withData(edited, 'a', { leads: 9 }));
  const restored = restoreSnapshot(withData(edited, 'a', { leads: 9 }), step.target, '2026-01-01T00:00:00.000Z');
  assert.equal(restored.nodes.find(n => n.id === 'a').data.leads, 9);
});

// Source pins for the wiring into App, CanvasHeader, JourneyCanvas and liveStats.

test('JourneyCanvas moves a card when its parent changes the position', () => {
  assert.match(read('./src/components/canvas/JourneyCanvas.tsx'), /parentMovedIds\(/);
});

test('App records history and autosaves through useJourneyEditing', () => {
  const app = read('./src/App.tsx');
  assert.match(app, /useJourneyEditing\(/);
  assert.match(app, /editing\.saveNow\(\)/);
  assert.doesNotMatch(app, /BROWSER_ONE_JOURNEY_QUESTION|LEAVE_JOURNEY_QUESTION/);
  assert.doesNotMatch(app, /await handleSave\(\)/);
});

test('the header has Undo and Redo and shows a waiting save', () => {
  const header = read('./src/components/toolbar/CanvasHeader.tsx');
  assert.match(header, /aria-label="Undo"/);
  assert.match(header, /aria-label="Redo"/);
  assert.match(header, /savePending/);
});

test('liveStats exports the flow counts the stats poll writes', () => {
  assert.match(read('./src/lib/liveStats.ts'), /export const FLOW_STAT_KEYS/);
  assert.match(read('./src/lib/liveStats.ts'), /export const MEASURED_KEYS/);
});
