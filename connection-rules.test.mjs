// Which lines the journey map accepts (#13). React Flow's strict mode checks only the handle type,
// so a step could join itself, a second line on one branch was simply added, and a split with two
// branch-a lines sent variant B to the second branch-a target (journeyRoutes.mjs takes
// outgoingEdges[1] when there is no branch-b line). src/lib/connectionRules.ts decides it now.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rules = await import('./src/lib/connectionRules.ts');
const {
  SOURCE_HANDLES, TARGET_HANDLES, checkConnection, withConnection, createsLoop, findLoopEdges,
  branchName, stepName, stepCardName, replacePrompt, loopMessage, refusalNotice, connectionFromState
} = rules;
const stepHandles = await import('./src/lib/stepHandles.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

// Copied from step-handles.test.mjs on purpose, so neither file has to import the other.
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

const node = (id, type, label = '', extra = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { type, label, ...extra } });
const line = (id, source, target, sourceHandle, targetHandle) => {
  const e = { id, source, target, data: { sourceThroughput: 0, targetCount: 0, rate: 0 } };
  if (sourceHandle !== undefined) e.sourceHandle = sourceHandle;
  if (targetHandle !== undefined) e.targetHandle = targetHandle;
  return e;
};
const conn = (source, target, sourceHandle = null, targetHandle = null) => ({ source, target, sourceHandle, targetHandle });

const NODES = [
  node('ad', 'ad-source', 'Meta ad'),
  node('p', 'landing-page', 'Sale page'),
  node('p2', 'landing-page', 'Second page'),
  node('f', 'lead-form', 'Signup'),
  node('s', 'follow-up-sequence', 'Nurture'),
  node('s2', 'follow-up-sequence', 'Nurture two'),
  node('ty', 'thank-you', 'Thank you'),
  node('u', 'upsell', 'Upsell'),
  node('d', 'upsell', 'Downsell', { offerType: 'downsell' }),
  node('ab', 'ab-split', 'Split'),
  node('ab2', 'ab-split', 'Split two')
];

const plain = text => {
  assert.ok(text.length > 0, 'empty text');
  assert.ok(!text.includes('—'), `em dash in: ${text}`);
  assert.ok(!text.includes(' – '), `spaced en dash in: ${text}`);
};

test('the handle tables match the node components', () => {
  assert.deepEqual(Object.keys(SOURCE_HANDLES).sort(), Object.keys(NODE_FILES).sort());
  assert.deepEqual(Object.keys(TARGET_HANDLES).sort(), Object.keys(NODE_FILES).sort());
  for (const [type, file] of Object.entries(NODE_FILES)) {
    assert.deepEqual(SOURCE_HANDLES[type], handlesIn(file, 'source'), `${type} source handles`);
    assert.deepEqual(TARGET_HANDLES[type], handlesIn(file, 'target'), `${type} target handles`);
  }
  // One table (#31). The rules re-export it rather than typing it again.
  assert.equal(SOURCE_HANDLES, stepHandles.SOURCE_HANDLES);
  assert.equal(TARGET_HANDLES, stepHandles.TARGET_HANDLES);
});

test('impossible links are refused with a reason and a sentence', () => {
  const rows = [
    [conn('p', 'p'), 'self'],
    [conn('p', 'ad'), 'no-way-in'],
    [conn('s', 'ad'), 'no-way-in'],
    [conn('ty', 'p'), 'no-way-out'],
    [conn('p', 'u', 'accepted'), 'unknown-handle'],
    [conn('p', 's', null, 'bogus'), 'unknown-handle'],
    [conn('p', 'p2', 'abandon'), 'needs-message'],
    [conn('u', 'ty', 'rescue'), 'needs-message'],
    [conn('ab', 's', 'branch-a'), 'needs-page'],
    [conn('ab', 'ty', 'branch-a'), 'needs-page'],
    [conn('ab', 'f', 'branch-a'), 'needs-page'],
    [conn('ab', 'ab2', 'branch-a'), 'needs-page'],
    [conn('p', 'nowhere'), 'missing-step']
  ];
  for (const [c, reason] of rows) {
    const v = checkConnection(c, NODES, []);
    assert.equal(v.kind, 'refuse', `${c.source} ${c.sourceHandle} -> ${c.target}`);
    assert.equal(v.reason, reason, `${c.source} ${c.sourceHandle} -> ${c.target}`);
    plain(v.message);
    assert.ok(v.message.endsWith('.'), v.message);
  }
  assert.equal(checkConnection(conn('p', 'p'), NODES, []).message, 'A step cannot lead to itself.');
  assert.equal(checkConnection(conn('p', 'ad'), NODES, []).message, 'An ad is where visitors start. Nothing can lead into it.');
  assert.equal(checkConnection(conn('ty', 'p'), NODES, []).message, 'A thank-you page ends the path. No line can leave it.');
  assert.equal(checkConnection(conn('p', 'u', 'accepted'), NODES, []).message, 'Sale page has no accepted branch.');
  assert.equal(checkConnection(conn('p', 's', null, 'bogus'), NODES, []).message, 'Nurture cannot take a line there.');
  assert.match(checkConnection(conn('p', 'p2', 'abandon'), NODES, []).message, /follow-up sequence/);
  assert.match(checkConnection(conn('ab', 's', 'branch-a'), NODES, []).message, /landing page or an upsell/);
});

test('links that make sense are added', () => {
  const rows = [
    conn('ad', 'p'),
    conn('ad', 'ab'),
    conn('ad', 's'), // odd, but no code gives it a meaning to refuse on. #10 may warn.
    conn('p', 'f'),
    conn('p', 's', 'abandon', 'retention-in'),
    conn('u', 'ty', 'accepted'),
    conn('u', 'd', 'declined'),
    conn('ab', 'p', 'branch-a'),
    conn('ab', 'u', 'branch-b'),
    conn('f', 's'),
    conn('f', 'ty'),
    // #30 gave the follow-up card one unnamed exit: where a reader goes after the emails.
    conn('s', 'ty'),
    conn('s', 'p'),
    conn('s', 'u'),
    conn('s', 'f')
  ];
  for (const c of rows) {
    assert.deepEqual(checkConnection(c, NODES, []), { kind: 'add' }, `${c.source} ${c.sourceHandle} -> ${c.target}`);
  }
});

test('one line per branch handle', () => {
  const accepted = line('e1', 'u', 'ty', 'accepted');
  assert.deepEqual(checkConnection(conn('u', 'd', 'accepted'), NODES, [accepted]), { kind: 'replace', existing: [accepted] });
  assert.deepEqual(checkConnection(conn('u', 'd', 'declined'), NODES, [accepted]), { kind: 'add' });

  const a = line('e2', 'ab', 'p', 'branch-a');
  assert.deepEqual(checkConnection(conn('ab', 'p2', 'branch-a'), NODES, [a]), { kind: 'replace', existing: [a] });
  assert.deepEqual(checkConnection(conn('ab', 'p2', 'branch-b'), NODES, [a]), { kind: 'add' });

  // A retention line counts whether or not the canvas is showing it.
  const rescue = line('e3', 'u', 's', 'rescue', 'retention-in');
  assert.deepEqual(checkConnection(conn('u', 's2', 'rescue'), NODES, [rescue]), { kind: 'replace', existing: [rescue] });
});

test('the main handle keeps one next step and any number of follow-up sequences', () => {
  const toTy = line('e1', 'p', 'ty');
  assert.deepEqual(checkConnection(conn('p', 'f'), NODES, [toTy]), { kind: 'replace', existing: [toTy] });

  const toS = line('e2', 'p', 's');
  assert.deepEqual(checkConnection(conn('p', 's'), NODES, [toTy]), { kind: 'add' });
  assert.deepEqual(checkConnection(conn('p', 's2'), NODES, [toTy, toS]), { kind: 'add' });
  // A follow-up line never counts as the routing line it would replace.
  assert.deepEqual(checkConnection(conn('p', 'f'), NODES, [toS, toTy]), { kind: 'replace', existing: [toTy] });

  const again = checkConnection(conn('p', 'ty'), NODES, [toTy]);
  assert.equal(again.kind, 'refuse');
  assert.equal(again.reason, 'duplicate');

  // An empty handle name is the main handle, as React Flow draws it.
  assert.equal(checkConnection(conn('p', 'ty', ''), NODES, [toTy]).reason, 'duplicate');

  // Legacy maps may hold two routing lines on one handle. Replace lists and removes both.
  const toF = line('e3', 'p', 'f');
  assert.deepEqual(checkConnection(conn('p', 'u'), NODES, [toTy, toF, toS]), { kind: 'replace', existing: [toTy, toF] });
});

test('an exact duplicate is refused, the same pair on another branch is not', () => {
  const accepted = line('e1', 'u', 'ty', 'accepted');
  const twice = checkConnection(conn('u', 'ty', 'accepted'), NODES, [accepted]);
  assert.equal(twice.kind, 'refuse');
  assert.equal(twice.reason, 'duplicate');
  assert.equal(twice.message, 'These steps are already joined by this line.');
  assert.deepEqual(checkConnection(conn('u', 'ty', 'declined'), NODES, [accepted]), { kind: 'add' });
});

test('withConnection swaps exactly the replaced line', () => {
  const edges = [line('e1', 'ad', 'p'), line('e2', 'u', 'ty', 'accepted'), line('e3', 'u', 'd', 'declined')];
  const added = line('e4', 'u', 'p2', 'accepted');
  const out = withConnection(edges, added, [edges[1]]);
  assert.equal(out.length, edges.length);
  assert.ok(!out.some(e => e.id === 'e2'));
  assert.equal(out[out.length - 1], added);
  assert.equal(out[0], edges[0]);
  assert.equal(out[1], edges[2]);
  assert.equal(edges.length, 3, 'the input is not changed');

  const plus = withConnection(edges, added);
  assert.equal(plus.length, 4);
  edges.forEach((e, i) => assert.equal(plus[i], e));
});

test('loops are found, not refused', () => {
  const edges = [
    line('ad-p', 'ad', 'p'),
    line('p-u', 'p', 'u'),
    line('u-d', 'u', 'd', 'declined'),
    line('d-p', 'd', 'p', 'accepted'),
    line('d-ty', 'd', 'ty', 'declined')
  ];
  assert.deepEqual([...findLoopEdges(edges)].sort(), ['d-p', 'p-u', 'u-d']);
  assert.deepEqual([...findLoopEdges([...edges, line('self', 'f', 'f')])].sort(), ['d-p', 'p-u', 'self', 'u-d']);
  assert.equal(findLoopEdges([edges[0], edges[1], edges[4]]).size, 0);
  assert.equal(createsLoop(edges.filter(e => e.id !== 'd-p'), 'd', 'p'), true);
  assert.equal(createsLoop(edges, 'p', 'ty'), false);
  assert.equal(createsLoop([], 'p', 'p'), true);

  const open = edges.filter(e => e.id !== 'd-p');
  assert.deepEqual(checkConnection(conn('d', 'p', 'accepted'), NODES, open), { kind: 'add' });
  // #30: a retention sequence linking back to an earlier page is an intended loop, and allowed.
  const rescue = [line('ad-p', 'ad', 'p'), line('p-u', 'p', 'u'), line('u-s', 'u', 's', 'rescue', 'retention-in')];
  assert.deepEqual(checkConnection(conn('s', 'p'), NODES, rescue), { kind: 'add' });
});

test('every shipped map passes the rules', () => {
  const maps = [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT];
  let replayed = 0;
  for (const map of maps) {
    const drawn = [];
    for (const e of map.edges) {
      const v = checkConnection(e, map.nodes, drawn);
      // e-bp6-6 (sequence -> thank-you) was the one undrawable line until #30 gave the follow-up
      // card an exit. It is an ordinary line now.
      assert.deepEqual(v, { kind: 'add' }, `${map.id} ${e.id}: ${JSON.stringify(v)}`);
      drawn.push(e);
      replayed++;
    }
    assert.equal(findLoopEdges(map.edges).size, 0, `${map.id} has a loop`);
  }
  assert.ok(replayed >= 27, `replayed ${replayed} lines`);
});

test('the prompts are plain', () => {
  const labelled = [node('U', 'upsell', 'Upsell'), node('T', 'thank-you', 'Thank you'), node('D', 'upsell', 'Downsell', { offerType: 'downsell' })];
  assert.deepEqual(replacePrompt(conn('U', 'D', 'accepted'), labelled, [line('x', 'U', 'T', 'accepted')]), {
    title: 'Replace this line?',
    body: 'Upsell already sends its accepted line to Thank you. Send it to Downsell instead?',
    confirm: 'Replace line'
  });

  const main = replacePrompt(conn('p', 'u'), NODES, [line('a', 'p', 'ty'), line('b', 'p', 'f')]);
  assert.equal(main.body, 'Sale page already sends its next step line to Thank you and Signup. Send it to Upsell instead?');
  const three = replacePrompt(conn('p', 'u'), NODES, [line('a', 'p', 'ty'), line('b', 'p', 'f'), line('c', 'p', 'p2')]);
  assert.match(three.body, /to Thank you, Signup and Second page\./);

  const blank = [node('P', 'landing-page', '   '), node('F', 'lead-form', ''), node('T', 'thank-you')];
  assert.equal(stepName(blank[0]), 'Landing page');
  assert.equal(replacePrompt(conn('P', 'F'), blank, [line('a', 'P', 'T')]).body,
    'Landing page already sends its next step line to Thank-you page. Send it to Form instead?');
  assert.equal(stepName(node('x', 'upsell', '', { offerType: 'downsell' })), 'Downsell');
  assert.equal(stepName(undefined), 'This step');

  assert.equal(branchName(null), 'next step');
  assert.equal(branchName('abandon'), 'abandoned');
  assert.equal(branchName('branch-b'), 'split B');

  // A loop notice names each step as its card reads (R27), so it matches Check design's loop row.
  const addressed = [node('p', 'landing-page', 'Sale page', { slug: 'sale' }), node('d', 'upsell', 'Downsell', { offerType: 'downsell', slug: 'mini' })];
  const loop = loopMessage(conn('d', 'p', 'accepted'), addressed);
  assert.equal(loop, 'This line makes a loop. Landing page /sale can lead back to Downsell /mini/downsell. The loop is marked on the map.');
  plain(loop);
  const notice = refusalNotice('A step cannot lead to itself.');
  assert.equal(notice, 'Line not added. A step cannot lead to itself.');
  plain(notice);
  for (const t of Object.values(rules.TYPE_NAMES)) plain(t);
});

test('connectionFromState orients a drag from either end', () => {
  const U = { id: 'U' };
  const D = { id: 'D' };
  const accepted = { id: 'accepted', type: 'source' };
  const into = { id: null, type: 'target' };
  const want = { source: 'U', sourceHandle: 'accepted', target: 'D', targetHandle: null };
  assert.deepEqual(connectionFromState({ fromNode: U, fromHandle: accepted, toNode: D, toHandle: into }), want);
  assert.deepEqual(connectionFromState({ fromNode: D, fromHandle: into, toNode: U, toHandle: accepted }), want);
  assert.equal(connectionFromState({ fromNode: U, fromHandle: accepted, toNode: D, toHandle: { id: null, type: 'source' } }), null);
  assert.equal(connectionFromState({ fromNode: U, fromHandle: accepted, toNode: D, toHandle: null }), null);
  assert.equal(connectionFromState(null), null);
  // An undefined handle id (React Flow's main handle) reads as null.
  assert.deepEqual(connectionFromState({ fromNode: U, fromHandle: { type: 'source' }, toNode: D, toHandle: { type: 'target' } }),
    { source: 'U', sourceHandle: null, target: 'D', targetHandle: null });
});

test('the Replace dialog is a native modal with Cancel focused', () => {
  const src = fs.readFileSync('src/components/canvas/ReplaceLineDialog.tsx', 'utf8');
  assert.match(src, /showModal\(\)/);
  assert.match(src, /onCancel=\{/);
  assert.match(src, /<button[^>]*\bautoFocus\b[^>]*>\s*Cancel\s*</);
  // On the shared dialog stack (#19), so Escape closes this and not the docked panel under it.
  assert.match(src, /useDialogFocus/);
  assert.match(src, /modal: true/);
  assert.match(src, /aria-labelledby=\{/);
  assert.match(src, /aria-describedby=\{/);
  assert.doesNotMatch(src, /—| – /);
});

// The canvas wiring, w3-spine-2's part of #13.
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

test('the canvas checks every line through the rules', () => {
  const src = read('src/components/canvas/JourneyCanvas.tsx');
  assert.ok(src.includes('isValidConnection={'));
  assert.ok(src.includes('onConnectEnd={'));
  assert.ok(src.includes('onClickConnectEnd={'));
  const body = src.slice(src.indexOf('const handleConnect'), src.indexOf('const handleConnect') + 1500);
  assert.ok(body.includes('checkConnection('));
  assert.ok(!src.includes('addEdge'));
  const spread = src.indexOf('...(e.data || {})');
  assert.ok(spread >= 0 && src.indexOf('inLoop:', spread) > spread);
});

test('a line on a loop shows a LOOP chip', () => {
  const edge = read('src/components/canvas/edges/ConversionEdge.tsx');
  assert.match(edge, /inLoop/);
  assert.match(edge, /LOOP/);
  assert.match(edge, /data-edge-id=\{/);
  assert.match(edge, /data-loop=/);
  const types = read('src/types/journey.ts');
  const data = types.slice(types.indexOf('interface ConversionEdgeData'), types.indexOf('export type JourneyEdge'));
  assert.match(data, /inLoop\?: boolean/);
});

test('a refused line is drawn red and dashed while dragged', () => {
  const css = read('src/index.css');
  const at = css.indexOf('.react-flow__connection.invalid');
  assert.ok(at >= 0);
  assert.ok(!css.slice(at, css.indexOf('}', at)).includes('!important'));
});

// R27: the loop notice after a line is drawn and Check design's loop row named one step two ways
// ('Post-Purchase Upsell (OTO)' against 'Upsell /vip-bundle-upsell/upsell'). Both now name a step
// as its card reads, which is also the name the map speaks.
test('the loop notice and Check design name a step the same way (R27)', async () => {
  const graph = await import('./src/lib/journeyGraph.ts');
  const { checkJourneyDesign } = await import('./src/lib/designChecks.ts');
  const { stepShortName } = await import('./src/lib/stepNames.ts');
  const { stepLabel } = await import('./src/lib/stepNavigation.ts');

  // One rule: stepCardName is journeyGraph.stepName for every shipped step, a step whose node
  // type disagrees with its data, and a missing step.
  const maps = [...ECOM_BLUEPRINTS, DEFAULT_LEAD_CAPTURE_PROJECT];
  let named = 0;
  for (const map of maps) {
    for (const n of map.nodes) {
      assert.equal(stepCardName(n), graph.stepName(n), `${map.id}/${n.id}`);
      assert.equal(stepCardName(n), stepShortName({ ...n.data, type: n.type }), `${map.id}/${n.id}`);
      named++;
    }
  }
  assert.ok(named >= 30, `named ${named} steps`);
  const mixed = { id: 'm', type: 'upsell', data: { type: 'landing-page', offerType: 'downsell', slug: 'x', label: 'Mixed' } };
  assert.equal(stepCardName(mixed), graph.stepName(mixed));
  assert.equal(stepCardName(mixed), 'Downsell /x/downsell');
  assert.equal(stepCardName(undefined), graph.stepName(undefined));

  // The finding's own journey: bp5 with the downsell's Declined line sent back to the upsell.
  const p = JSON.parse(JSON.stringify(ECOM_BLUEPRINTS.find(b => b.nodes.some(x => x.id === 'bp5-ad'))));
  const back = line('e-back', 'bp5-downsell', 'bp5-upsell', 'declined');
  const notice = loopMessage(back, p.nodes);
  p.edges.push(back);
  const row = checkJourneyDesign(p).issues.find(i => i.check === 'loop' && i.edgeId === 'e-back');
  assert.ok(row, 'Check design reports the loop');
  const upsell = p.nodes.find(n => n.id === 'bp5-upsell');
  const downsell = p.nodes.find(n => n.id === 'bp5-downsell');
  assert.notEqual(stepLabel(upsell), graph.stepName(upsell), 'fixture must have a label that differs from the card wording');
  assert.equal(notice, `This line makes a loop. ${graph.stepName(upsell)} can lead back to ${graph.stepName(downsell)}. The loop is marked on the map.`);
  assert.equal(row.message, `A line from this step makes a loop back to ${graph.stepName(upsell)}.`);
  assert.ok(!notice.includes(stepLabel(upsell)) && !notice.includes(stepLabel(downsell)), `label leaked into: ${notice}`);

  // Pinned at the source too: the notice reads the card-name rule, never the label rule.
  const src = read('src/lib/connectionRules.ts');
  const body = src.slice(src.indexOf('export function loopMessage'), src.indexOf('export function refusalNotice'));
  assert.match(body, /stepCardName\(/);
  assert.doesNotMatch(body, /\bstepName\(/);
  assert.match(src, /import \{[^}]*\bstepShortName\b[^}]*\} from '\.\/stepNames\.ts';/);
});
