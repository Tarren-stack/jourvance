// Design checks for any journey (#10). The old audit scored every journey as a store, so the
// default lead journey read "Audit: 25/100", a D. src/lib/designChecks.ts asks what any journey
// needs instead (a way in, a destination for every exit that needs one, no line the map cannot
// draw, no unreachable step, no loop, a headline and a button on every page), and its fixes
// change lines only, all or nothing, with a preview written from the same change list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const graph = await import('./src/lib/journeyGraph.ts');
const dc = await import('./src/lib/designChecks.ts');
const { STEP_BRANCHES, STEP_ENTRIES, branchOf, lineIsDrawable, nodeLookup, stepName } = graph;
const { checkJourneyDesign, planDesignFix, applyFixPlan, revertFixPlan, COPY_FIELDS, isPlaceholderText } = dc;
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const clone = v => JSON.parse(JSON.stringify(v));
const bp = n => clone(ECOM_BLUEPRINTS.find(b => b.nodes.some(x => x.id === `bp${n}-ad`)));
const home = () => clone(DEFAULT_LEAD_CAPTURE_PROJECT);
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { type, label: id, ...data } });
const line = (id, source, target, sourceHandle, targetHandle) => {
  const e = { id, source, target, type: 'conversion', data: { sourceThroughput: 0, targetCount: 0, rate: 0 } };
  if (sourceHandle !== undefined) { e.sourceHandle = sourceHandle; e.data.sourceHandle = sourceHandle; }
  if (targetHandle !== undefined) { e.targetHandle = targetHandle; e.data.targetHandle = targetHandle; }
  return e;
};
const page = (id, extra = {}) => node(id, 'landing-page', { slug: id, headline: 'A real headline', buttonText: 'Buy now', ...extra });
const checks = p => checkJourneyDesign(p).issues;
// The map's own checks, without the rows naming a blueprint's sample offers (R23).
const structural = p => checks(p).filter(i => i.check !== 'sample-offer');
const has = (p, check, nodeId) => checks(p).some(i => i.check === check && (nodeId === undefined || i.nodeId === nodeId));
const plain = text => {
  assert.ok(typeof text === 'string' && text.length > 0, 'empty text');
  assert.doesNotMatch(text, /—/, `em dash in: ${text}`);
  assert.doesNotMatch(text, / – /, `spaced en dash in: ${text}`);
};

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

test('the design check modules load under node', () => {
  assert.equal(typeof checkJourneyDesign, 'function');
  assert.equal(typeof graph.reachableFrom, 'function');
  assert.equal(typeof graph.findLoopLines, 'function');
});

// T10: the starter ad, and each letter, used to carry instruction text as their words, so the page
// headline was the only row. Each empty field is its own honest row now.
const STARTER_ROWS = [
  ['ad-headline', 'node-ad-1'], ['ad-button', 'node-ad-1'], ['ad-campaign', 'node-ad-1'], ['page-headline', 'node-page-1'],
  ['letter-empty', 'node-seq-1'], ['letter-empty', 'node-seq-1'], ['letter-empty', 'node-seq-1']
];

test('the default journey lists only what is still to write: the ad and page headlines and the three letters', () => {
  const r = checkJourneyDesign(home());
  assert.deepEqual(r.issues.map(i => [i.check, i.nodeId]), STARTER_ROWS);
  assert.equal(r.byNode['node-page-1'].messages.length, 1);
  assert.equal(r.byNode['node-page-1'].name, 'Landing page /vip-consultation');
  assert.equal(r.issues.find(i => i.check === 'page-headline').message, 'Add a headline.');
  assert.deepEqual(r.journeyIssues, []);
  // The form's line into the follow-up fills "After submit".
  assert.ok(!has(home(), 'branch-missing'));
});

test('blueprints: bp1 to bp4 are structurally clean, bp5 and bp6 each miss "Declined"', () => {
  for (const n of [1, 2, 3, 4]) assert.deepEqual(structural(bp(n)), [], `bp${n}`);
  assert.deepEqual(structural(bp(5)).map(i => [i.check, i.nodeId, i.branch]), [['branch-missing', 'bp5-downsell', 'declined']]);
  // #30 gave the follow-up card an exit, so e-bp6-6 (rescue sequence to thank-you) draws now.
  assert.deepEqual(structural(bp(6)).map(i => [i.check, i.nodeId, i.branch]), [['branch-missing', 'bp6-upsell', 'declined']]);
  const six = bp(6);
  assert.ok(lineIsDrawable(six.edges.find(e => e.id === 'e-bp6-6'), nodeLookup(six.nodes)));
});

test('one entry: no ad is no-entry with no unreachable noise; ads into different first steps are several-starts', () => {
  const noAd = home();
  noAd.nodes = noAd.nodes.filter(n => n.type !== 'ad-source');
  noAd.edges = noAd.edges.filter(e => e.source !== 'node-ad-1');
  const r = checkJourneyDesign(noAd);
  assert.ok(r.journeyIssues.some(i => i.check === 'no-entry'));
  assert.ok(!has(noAd, 'unreachable'));

  const same = home();
  same.nodes.push(node('ad2', 'ad-source'));
  same.edges.push(line('e-ad2', 'ad2', 'node-page-1'));
  assert.ok(!has(same, 'several-starts'));

  const different = home();
  different.nodes.push(node('ad2', 'ad-source'), page('p2'));
  different.edges.push(line('e-ad2', 'ad2', 'p2'), line('e-p2', 'p2', 'node-form-1'));
  assert.ok(has(different, 'several-starts'));
});

test('an unconnected page is unreachable and misses its Button branch', () => {
  const p = home();
  p.nodes.push(page('lonely'));
  assert.ok(has(p, 'unreachable', 'lonely'));
  assert.ok(checks(p).some(i => i.check === 'branch-missing' && i.nodeId === 'lonely' && i.message === 'Connect "Button" to a next step.'));
});

test('an upsell with only Accepted misses Declined', () => {
  const p = bp(5);
  p.edges = p.edges.filter(e => e.id !== 'e-bp5-3');
  assert.ok(checks(p).some(i => i.check === 'branch-missing' && i.nodeId === 'bp5-upsell' && i.branch === 'declined'));
});

test('branch-duplicate counts routing lines only; a line into a follow-up runs beside the path', () => {
  const two = home();
  two.nodes.push(node('ty', 'thank-you', { headline: 'Thanks' }));
  two.edges.push(line('e-page-ty', 'node-page-1', 'ty'));
  assert.ok(has(two, 'branch-duplicate', 'node-page-1'));
  // bp1 is page main -> sequence + thank-you.
  assert.ok(!has(bp(1), 'branch-duplicate'));
});

test('both split handles to one page is split-same-target', () => {
  const p = { nodes: [node('ad', 'ad-source'), node('ab', 'ab-split', { slug: 'ab' }), page('p', { slug: 'p' })], edges: [
    line('e1', 'ad', 'ab'), line('e2', 'ab', 'p', 'branch-a'), line('e3', 'ab', 'p', 'branch-b'), line('e4', 'p', 'ab')
  ] };
  assert.ok(has(p, 'split-same-target', 'ab'));
});

test('a line to a deleted step is broken-line and not hidden-line', () => {
  const p = home();
  p.edges.push(line('e-ghost', 'node-page-1', 'ghost'));
  const r = checks(p);
  assert.ok(r.some(i => i.check === 'broken-line' && i.nodeId === 'node-page-1' && i.edgeId === 'e-ghost'));
  assert.ok(!r.some(i => i.check === 'hidden-line'));
});

test('a handle name the step does not have is hidden-line, and a step reached only by it is unreachable', () => {
  const accepted = home();
  const e = accepted.edges.find(x => x.id === 'edge-page-form');
  e.sourceHandle = 'accepted';
  e.data.sourceHandle = 'accepted';
  assert.ok(checks(accepted).some(i => i.check === 'hidden-line' && i.nodeId === 'node-page-1' && i.edgeId === 'edge-page-form'));
  assert.ok(has(accepted, 'unreachable', 'node-form-1'));

  const intoThankYou = bp(1);
  intoThankYou.edges.find(x => x.id === 'e-bp1-3').targetHandle = 'retention-in';
  assert.ok(checks(intoThankYou).some(i => i.check === 'hidden-line' && i.edgeId === 'e-bp1-3'));
});

test('a line back up the path is a loop on its source, but a follow-up sending readers back is intended', () => {
  const p = bp(5);
  p.edges.push(line('e-back', 'bp5-downsell', 'bp5-upsell', 'declined'));
  const loops = checks(p).filter(i => i.check === 'loop');
  assert.deepEqual(loops.map(i => [i.nodeId, i.edgeId]), [['bp5-downsell', 'e-back']]);

  const back = bp(6);
  back.edges.push(line('e-seq-back', 'bp6-upsell-rescue', 'bp6-page'));
  assert.ok(!has(back, 'loop'));
});

test('empty, blank and placeholder words fail the headline and button checks', () => {
  const button = bp(1);
  button.nodes.find(n => n.id === 'bp1-page').data.buttonText = '';
  assert.ok(has(button, 'page-button', 'bp1-page'));
  for (const headline of ['   ', 'Your offer headline', ' your OFFER headline ']) {
    const p = bp(1);
    p.nodes.find(n => n.id === 'bp1-page').data.headline = headline;
    assert.ok(has(p, 'page-headline', 'bp1-page'), JSON.stringify(headline));
  }
  assert.ok(isPlaceholderText('Your upsell headline'));
  assert.ok(!isPlaceholderText('Your order is confirmed'));
  // An ad is not a page: its headline is its own check (T10), never a page headline.
  const ad = bp(1);
  ad.nodes.find(n => n.id === 'bp1-ad').data.headline = 'Your offer headline';
  assert.ok(!has(ad, 'page-headline', 'bp1-ad'));
  assert.ok(has(ad, 'ad-headline', 'bp1-ad'));
});

test('a new upsell dropped on the map shows at least two checks', () => {
  const p = home();
  p.nodes.push(node('u', 'upsell', { headline: 'Your offer headline', acceptButtonText: 'Yes, add this to my order' }));
  const r = checkJourneyDesign(p);
  assert.ok(r.byNode.u.messages.length >= 2);
  assert.ok(has(p, 'unreachable', 'u'));
});

test('STEP_BRANCHES and STEP_ENTRIES are the handles the cards render', () => {
  assert.deepEqual(Object.keys(STEP_BRANCHES).sort(), Object.keys(NODE_FILES).sort());
  for (const [type, file] of Object.entries(NODE_FILES)) {
    assert.deepEqual(STEP_BRANCHES[type].map(b => b.handle), handlesIn(file, 'source'), `${type} source`);
    assert.deepEqual([...STEP_ENTRIES[type]], handlesIn(file, 'target'), `${type} target`);
  }
  // The required exits (owner decision 2). A follow-up's exit is a plain line, never required.
  const required = type => STEP_BRANCHES[type].filter(b => b.required).map(b => b.label);
  assert.deepEqual(required('ad-source'), ['Next step']);
  assert.deepEqual(required('landing-page'), ['Button']);
  assert.deepEqual(required('lead-form'), ['After submit']);
  assert.deepEqual(required('upsell'), ['Accepted', 'Declined']);
  assert.deepEqual(required('ab-split'), ['Split A', 'Split B']);
  assert.deepEqual(required('follow-up-sequence'), []);
  assert.deepEqual(required('thank-you'), []);
  // An unnamed line leaves from the first exit, as React Flow draws it.
  assert.equal(branchOf({}, 'upsell').handle, 'accepted');
  assert.equal(branchOf({ sourceHandle: 'accepted' }, 'landing-page'), null);
  assert.equal(stepName(bp(5).nodes.find(n => n.id === 'bp5-downsell')), 'Downsell /mini-essentials-downsell/downsell');
});

test('fixes are offered only when exactly one structural answer exists', () => {
  const none = (p, check, nodeId) => {
    const issue = checks(p).find(i => i.check === check && (nodeId === undefined || i.nodeId === nodeId));
    assert.ok(issue, `${check} not found`);
    assert.equal(planDesignFix(p, issue), null, `${check} should have no fix`);
  };
  none(home(), 'page-headline');
  const button = bp(1);
  button.nodes.find(n => n.id === 'bp1-page').data.buttonText = '';
  none(button, 'page-button');
  const lonely = home();
  lonely.nodes.push(page('lonely'));
  none(lonely, 'unreachable', 'lonely');
  const two = home();
  two.nodes.push(node('ty', 'thank-you', { headline: 'Thanks' }));
  two.edges.push(line('e-page-ty', 'node-page-1', 'ty'));
  none(two, 'branch-duplicate');
  const loop = bp(5);
  loop.edges.push(line('e-back', 'bp5-downsell', 'bp5-upsell', 'declined'));
  none(loop, 'loop');
  const split = { nodes: [node('ad', 'ad-source'), node('ab', 'ab-split', { slug: 'ab' }), page('p', { slug: 'p' }), page('q', { slug: 'q' })], edges: [
    line('e1', 'ad', 'ab'), line('e2', 'ab', 'p', 'branch-a'), line('e3', 'p', 'q')
  ] };
  none(split, 'branch-missing', 'ab');
  // Two thank-you pages: which one "Declined" should reach is the person's call.
  const twoTy = bp(5);
  twoTy.nodes.push(node('ty2', 'thank-you', { headline: 'Thanks again' }));
  none(twoTy, 'branch-missing', 'bp5-downsell');
});

test('bp5: preview, apply and undo the Declined fix', () => {
  const original = { ...bp(5), updatedAt: '2026-01-01T00:00:00.000Z' };
  const issue = checks(original)[0];
  const plan = planDesignFix(original, issue);
  assert.equal(plan.changes.length, 1);
  const [change] = plan.changes;
  assert.equal(change.kind, 'add-edge');
  assert.deepEqual([change.edge.source, change.edge.sourceHandle, change.edge.target], ['bp5-downsell', 'declined', 'bp5-ty']);
  assert.deepEqual(plan.lines, ['Adds a line from "Declined" on Downsell /mini-essentials-downsell/downsell to Thank-you page /core-flagship-offer.']);
  assert.equal(original.edges.length, 5, 'a preview changes nothing');

  const applied = applyFixPlan(original, plan);
  assert.equal(applied.applied, true);
  assert.deepEqual(structural(applied.project), []);
  assert.ok(Date.parse(applied.project.updatedAt) > Date.parse(original.updatedAt));

  const reverted = revertFixPlan(applied.project, plan);
  assert.equal(reverted.reverted, true);
  assert.deepEqual(reverted.project.nodes, original.nodes);
  assert.deepEqual(reverted.project.edges, original.edges);
  assert.ok(Date.parse(reverted.project.updatedAt) >= Date.parse(applied.project.updatedAt));
});

test('a hidden line is removed and put back at its old position, or repaired when its name is foreign', () => {
  // A line out of a thank-you page: nothing can leave it, so the only answer is to remove it.
  const six = bp(6);
  const e6 = six.edges.find(e => e.id === 'e-bp6-6');
  e6.source = 'bp6-ty';
  e6.target = 'bp6-upsell-rescue';
  e6.targetHandle = 'retention-in';
  const hidden = checks(six).find(i => i.check === 'hidden-line');
  assert.equal(hidden.edgeId, 'e-bp6-6');
  const remove = planDesignFix(six, hidden);
  assert.deepEqual(remove.changes.map(c => [c.kind, c.edge?.id, c.index]), [['remove-edge', 'e-bp6-6', 5]]);
  const once = applyFixPlan(six, remove).project;
  assert.ok(!once.edges.some(e => e.id === 'e-bp6-6'));
  const back = revertFixPlan(once, remove).project;
  assert.equal(back.edges.findIndex(e => e.id === 'e-bp6-6'), 5);
  assert.deepEqual(back.edges, six.edges);

  // Both bp6 plans together leave nothing open on the map (its sample offers are the person's to replace).
  const declined = planDesignFix(once, checks(once).find(i => i.check === 'branch-missing'));
  assert.deepEqual(structural(applyFixPlan(once, declined).project), []);

  // The legacy 'accepted' name on a landing page is cleared from the edge and its data.
  const accepted = home();
  const e = accepted.edges.find(x => x.id === 'edge-page-form');
  e.sourceHandle = 'accepted';
  e.data.sourceHandle = 'accepted';
  const repair = planDesignFix(accepted, checks(accepted).find(i => i.check === 'hidden-line'));
  assert.equal(repair.title, 'Repair the hidden line');
  const fixed = applyFixPlan(accepted, repair).project;
  const after = fixed.edges.find(x => x.id === 'edge-page-form');
  assert.ok(!after.sourceHandle && !after.data.sourceHandle);
  assert.ok(!has(fixed, 'hidden-line'));
  assert.deepEqual(revertFixPlan(fixed, repair).project.edges, accepted.edges);
});

test('a broken line is removed; a traffic source goes to the only open landing page; a recovery sequence is linked', () => {
  const broken = home();
  broken.edges.push(line('e-ghost', 'node-page-1', 'ghost'));
  const plan = planDesignFix(broken, checks(broken).find(i => i.check === 'broken-line'));
  assert.ok(!has(applyFixPlan(broken, plan).project, 'broken-line'));

  const loose = home();
  loose.edges = loose.edges.filter(e => e.id !== 'edge-ad-page');
  const connect = planDesignFix(loose, checks(loose).find(i => i.check === 'branch-missing' && i.nodeId === 'node-ad-1'));
  assert.deepEqual(connect.changes.map(c => [c.kind, c.edge.source, c.edge.target]), [['add-edge', 'node-ad-1', 'node-page-1']]);

  const orphan = bp(6);
  orphan.edges = orphan.edges.filter(e => e.id !== 'e-bp6-3');
  const link = planDesignFix(orphan, checks(orphan).find(i => i.check === 'unreachable' && i.nodeId === 'bp6-cart-recovery'));
  const [add] = link.changes;
  assert.deepEqual([add.edge.source, add.edge.sourceHandle, add.edge.target, add.edge.targetHandle], ['bp6-page', 'abandon', 'bp6-cart-recovery', 'retention-in']);
  assert.equal(add.edge.data.isRetentionEdge, true);
  assert.ok(!has(applyFixPlan(orphan, link).project, 'unreachable'));
});

test('stale plans are refused with the same object, and copy fields are never set', () => {
  const p = bp(5);
  const plan = planDesignFix(p, checks(p)[0]);
  const already = clone(p);
  already.edges.push(line('by-hand', 'bp5-downsell', 'bp5-ty', 'declined'));
  const refused = applyFixPlan(already, plan);
  assert.equal(refused.applied, false);
  assert.equal(refused.project, already);

  const applied = applyFixPlan(p, plan).project;
  const edited = clone(applied);
  edited.edges.find(e => e.id === plan.changes[0].edge.id).target = 'bp5-upsell';
  const notReverted = revertFixPlan(edited, plan);
  assert.equal(notReverted.reverted, false);
  assert.equal(notReverted.project, edited);

  const copy = { key: 'x', title: 'x', lines: [], changes: [{ kind: 'set-node-field', nodeId: 'bp5-page', field: 'headline', before: p.nodes[1].data.headline, after: 'New words' }] };
  const noCopy = applyFixPlan(p, copy);
  assert.equal(noCopy.applied, false);
  assert.equal(noCopy.project, p);
});

test('no plan sets a copy field, and no message or plan line has an em dash', () => {
  const fixtures = [home(), ...[1, 2, 3, 4, 5, 6].map(bp)];
  const accepted = home();
  accepted.edges.find(x => x.id === 'edge-page-form').sourceHandle = 'accepted';
  const broken = home();
  broken.edges.push(line('e-ghost', 'node-page-1', 'ghost'), line('e-ghost2', 'gone', 'node-page-1'), line('e-ghost3', 'gone', 'gone2'));
  const noAd = home();
  noAd.nodes = noAd.nodes.filter(n => n.type !== 'ad-source');
  const loop = bp(5);
  loop.edges.push(line('e-back', 'bp5-downsell', 'bp5-upsell', 'declined'));
  const lonely = home();
  lonely.nodes.push(page('lonely', { headline: '', buttonText: '' }), node('f2', 'lead-form'), node('ty2', 'thank-you'));
  fixtures.push(accepted, broken, noAd, loop, lonely);
  let plans = 0;
  for (const p of fixtures) {
    for (const issue of checks(p)) {
      plain(issue.message);
      const plan = planDesignFix(p, issue);
      if (!plan) continue;
      plans++;
      plain(plan.title);
      plan.lines.forEach(plain);
      for (const c of plan.changes) if (c.kind === 'set-node-field') assert.ok(!COPY_FIELDS.has(c.field), c.field);
    }
  }
  assert.ok(plans >= 4, `only ${plans} plans`);
});

// ---- Source pins ----

const read = f => fs.readFileSync(f, 'utf8');

test('the badge is a nodrag, nopan, nokey button with a name and readable colours', () => {
  const src = read('src/components/canvas/DesignIssueBadge.tsx');
  assert.ok(src.includes('className="nodrag nopan nokey"'));
  assert.ok(src.includes('stopPropagation'));
  assert.ok(src.includes('aria-label'));
  assert.ok(!/outline:\s*['"]?none/.test(src));
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (lum('#FBBF24') + 0.05) / (lum('#0B0F19') + 0.05);
  assert.ok(ratio >= 4.5, `contrast ${ratio}`);
  assert.ok(src.includes("background: '#FBBF24'") && src.includes("color: '#0B0F19'"));
});

test('the drawer lost the invented figures and declares every hook before it returns null', () => {
  const src = read('src/components/drawers/PreFlightAuditDrawer.tsx');
  for (const gone of ['Apply All Quick Wins', 'Margin at Risk', 'Margin Protected', 'Impact:', '✦', '—']) {
    assert.ok(!src.includes(gone), gone);
  }
  const early = src.search(/\n\s*if \(!isOpen[^\n]*return null;/);
  assert.ok(early > 0, 'the drawer returns null while closed');
  const after = src.slice(early);
  assert.doesNotMatch(after, /\buse(State|Effect|Memo|Ref|DialogFocus)\(/);
  assert.ok(src.includes('Check design'));
  assert.ok(src.includes('aria-label="Close design checks"'));
  assert.ok(src.includes('id={`check-${node.id}`}'));
  assert.ok(src.includes('Sign in and choose a workspace to connect one.'));
  assert.ok(src.includes('The journey changed since this preview. Preview the fix again.'));
  assert.ok(src.includes('This fix was edited after it was applied, so it cannot be undone here.'));
});

test('journeyGraph and designChecks import types with whole import type lines', () => {
  for (const f of ['src/lib/journeyGraph.ts', 'src/lib/designChecks.ts']) {
    const src = read(f);
    const imports = src.match(/^import \{[^}]*\} from/gm) || [];
    for (const i of imports) {
      const specs = i.slice(i.indexOf('{') + 1, i.indexOf('}')).split(',').map(s => s.trim()).filter(Boolean);
      assert.ok(!specs.every(s => s.startsWith('type ')), `${f}: ${i}`);
    }
    for (const m of src.matchAll(/^import [^;]* from '(\.[^']+)';/gm)) {
      if (!m[0].startsWith('import type')) assert.match(m[1], /\.ts$/, `${f} value import ${m[1]} needs .ts`);
    }
  }
});

// The canvas, card and header wiring is w3-spine-2's part of #10 (landed, so these are hard pins).
const WIRING = {};

test('every card renders the badge as its first child (w3-spine-2)', WIRING, () => {
  for (const file of Object.values(NODE_FILES)) {
    const src = read(`src/components/canvas/nodes/${file}`);
    assert.match(src, /\(\{\s*id,\s*data,\s*selected\s*\}/, `${file} destructures id`);
    assert.ok(src.includes('<DesignIssueBadge nodeId={id}'), `${file} renders the badge`);
  }
});

test('the canvas provides the checks and the header and publish read them (w3-spine-2)', WIRING, () => {
  const canvas = read('src/components/canvas/JourneyCanvas.tsx');
  assert.ok(canvas.includes('DesignIssuesContext.Provider'));
  assert.match(canvas, /checkJourneyDesign\(/);
  const app = read('src/App.tsx');
  const publish = app.slice(app.indexOf('const handlePublishFunnel'), app.indexOf('setPublishing(true)', app.indexOf('const handlePublishFunnel')));
  assert.match(publish, /checkJourneyDesign\(/);
  assert.doesNotMatch(publish, /auditFunnel\(/);
  const header = read('src/components/toolbar/CanvasHeader.tsx');
  assert.match(header, /checkJourneyDesign/);
  assert.doesNotMatch(header, /auditFunnel/);
});

// ---- R19: instructions saved as copy ----
// stepDefaults.ts and the starter map stored "Describe what the visitor gets." and "First point you
// can stand behind" as field VALUES, so they published as the page's words, and Check design read
// "Design checked" as soon as the headline was written, because it looked at nothing else.
const SD = await import('./src/lib/stepDefaults.ts');
const INSTRUCTION = /^describe\b|you can stand behind|^tell your customer|^new value point$/i;
const copyValues = data => Object.entries(data || {}).flatMap(([k, v]) =>
  typeof v === 'string' ? [[k, v]] : Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => [k, x]) : []);
// Exactly what a journey saved before R19 holds on its ad, page and upsell.
const OLD = {
  ad: { body: 'Describe the offer in words you can stand behind.' },
  page: { subhead: 'Describe what the visitor gets.', bullets: ['First point you can stand behind', 'Second point you can stand behind'] },
  upsell: { subhead: 'Describe the add-on in words you can stand behind.', benefits: ['First point you can stand behind'] }
};

test('R19: new steps, the starter map and the blueprints store no instruction as copy', () => {
  const types = ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split'];
  const sources = [
    ...types.map(t => [`new ${t}`, SD.newStepData(t, 's')]),
    ...home().nodes.map(n => [`starter map ${n.id}`, n.data]),
    ...ECOM_BLUEPRINTS.flatMap(b => b.nodes.map(n => [`blueprint ${n.id}`, n.data]))
  ];
  for (const [name, data] of sources) {
    for (const [field, value] of copyValues(data)) {
      assert.ok(!SD.isStarterText(value) && !INSTRUCTION.test(value.trim()), `${name}.${field} stores "${value}"`);
    }
  }
  // Each field those instructions lived in starts empty; the editors carry the hint instead.
  assert.equal(SD.newStepData('ad-source', 's').body, '');
  assert.equal(SD.newStepData('landing-page', 's').subhead, '');
  assert.deepEqual(SD.newStepData('landing-page', 's').bullets, []);
  assert.equal(SD.newStepData('upsell', 's').subhead, '');
  assert.deepEqual(SD.newStepData('upsell', 's').benefits, []);
  // The starter map's rows are only the empty fields it asks the person to write (T10).
  assert.deepEqual(checks(home()).map(i => [i.check, i.nodeId]), STARTER_ROWS);
});

test('R19: Check design names an instruction left standing in as copy, and offers no fix', () => {
  const p = home();
  const at = id => p.nodes.find(n => n.id === id);
  Object.assign(at('node-ad-1').data, OLD.ad);
  Object.assign(at('node-page-1').data, OLD.page, { headline: 'Book a free call' });
  p.nodes.push(node('u', 'upsell', { headline: 'Add the refill', acceptButtonText: 'Yes', ...OLD.upsell }));
  p.nodes.push(node('ty', 'thank-you', { headline: 'Thanks', subhead: 'Tell your customer what happens next.' }));
  p.nodes.push(page('b', { variantB: { subhead: 'Describe what the visitor gets.', bullets: ['New value point'] } }));
  const starter = checks(p).filter(i => i.check === 'starter-text');
  assert.deepEqual(starter.map(i => `${i.nodeId}:${i.field}`).sort(), [
    'b:variantB.bullets', 'b:variantB.subhead',
    'node-ad-1:body', 'node-page-1:bullets', 'node-page-1:subhead',
    'ty:subhead', 'u:benefits', 'u:subhead'
  ]);
  const msg = f => starter.find(i => `${i.nodeId}:${i.field}` === f).message;
  assert.equal(msg('node-page-1:subhead'), 'The subheadline still holds the starter text "Describe what the visitor gets." Write your own or clear it.');
  assert.equal(msg('node-page-1:bullets'), 'The key benefits still hold the starter text "First point you can stand behind". Write your own or remove it.');
  assert.match(msg('b:variantB.subhead'), /^The variant B subheadline still holds/);
  for (const i of starter) {
    plain(i.message);
    assert.equal(planDesignFix(p, i), null, `${i.key} must not get a fix: the words are the person's to write`);
  }
  // Case and spacing do not hide one, and written copy is never flagged.
  const q = home();
  Object.assign(q.nodes.find(n => n.id === 'node-page-1').data, { subhead: '  DESCRIBE what the visitor gets. ', bullets: ['Ships Monday', ' '] });
  assert.deepEqual(checks(q).filter(i => i.check === 'starter-text').map(i => i.field), ['subhead']);
  Object.assign(q.nodes.find(n => n.id === 'node-page-1').data, { subhead: 'We describe what you get on the call.' });
  assert.ok(!has(q, 'starter-text'));
});

test('R19: a published page never carries an instruction, and keeps what the person wrote', async () => {
  const { renderPublicFunnelHtml, renderPublicUpsellHtml, renderPublicThankYouHtml } = await import('./server/routes/publicRoutes.mjs');
  const req = { query: {}, headers: {}, params: {}, cookies: {} };
  const res = { cookie() {}, setHeader() {}, getHeader() {} };
  const pageData = { ...home().nodes.find(n => n.id === 'node-page-1').data, headline: 'Book a free call' };
  const found = html => html.match(/Describe (what|the)[^<"]*|[^<>"]*you can stand behind|Tell your customer[^<"]*|New value point/gi) || [];
  const landing = renderPublicFunnelHtml({ slug: 'vip-consultation', data: { ...pageData, ...OLD.page }, shopifyConfig: {} }, req, res);
  assert.deepEqual(found(landing), []);
  assert.ok(!landing.includes('<p class="subhead"></p>') && !landing.includes('<div class="bullets">'), 'an empty subhead or list leaves no empty block');
  const variantB = renderPublicFunnelHtml(
    { slug: 'v', data: { ...pageData, abTestingEnabled: true, subhead: 'Mine', bullets: ['Ships Monday'], variantB: { subhead: 'Describe what the visitor gets.', bullets: ['New value point'] } }, shopifyConfig: {} },
    { ...req, query: { var: 'b' } }, res);
  // ?var= is the key resolveSplitVariant reads; any other falls through to the random split.
  assert.match(variantB, /const activeVariant = "b"/);
  assert.deepEqual(found(variantB), []);
  assert.match(variantB, /<p class="subhead">Mine<\/p>/, 'variant B instructions fall back to what A wrote');
  assert.match(variantB, /Ships Monday/);
  const up = { ...SD.newStepData('upsell', 's'), headline: 'Add the refill' };
  assert.deepEqual(found(renderPublicUpsellHtml({ slug: 'o', data: { upsell: { ...up, ...OLD.upsell } }, shopifyConfig: {} }, req, res)), []);
  const fresh = renderPublicUpsellHtml({ slug: 'o', data: { upsell: up }, shopifyConfig: {} }, req, res);
  assert.deepEqual(found(fresh), []);
  assert.ok(!/<p class="subhead">\s*<\/p>/.test(fresh), 'a new upsell leaves no empty subhead paragraph');
  // A blank line is no line: no empty paragraph, no blank meta description.
  assert.equal(SD.ownCopy('   '), '');
  const blank = renderPublicFunnelHtml({ slug: 'w', data: { ...pageData, subhead: '  ', bullets: [] }, shopifyConfig: {} }, req, res);
  assert.ok(!/<p class="subhead">\s*<\/p>/.test(blank) && /<meta name="description" content="">/.test(blank));
  assert.ok(!/<p class="subhead">\s*<\/p>/.test(renderPublicUpsellHtml({ slug: 'o', data: { upsell: { ...up, subhead: ' \n ' } }, shopifyConfig: {} }, req, res)));
  const ty = renderPublicThankYouHtml({ data: { thankYou: { headline: 'Thanks', subhead: 'Tell your customer what happens next.' } }, shopifyConfig: {} }, req, res);
  assert.deepEqual(found(ty), []);
  // An instruction is no line, and a thank-you page has no stock subhead (R17), so none shows.
  assert.doesNotMatch(ty, /<p class="subhead">/);
  // What the person wrote still ships, beside a leftover instruction.
  const mixed = renderPublicFunnelHtml({ slug: 'm', data: { ...pageData, subhead: 'Thirty minutes, no charge.', bullets: ['First point you can stand behind', 'Ships Monday'] }, shopifyConfig: {} }, req, res);
  assert.match(mixed, /<p class="subhead">Thirty minutes, no charge\.<\/p>/);
  assert.match(mixed, /Ships Monday/);
  assert.deepEqual(found(mixed), []);
  const upMixed = renderPublicUpsellHtml({ slug: 'o', data: { upsell: { ...up, subhead: 'Same formula.', benefits: ['Refill size', 'First point you can stand behind'] } }, shopifyConfig: {} }, req, res);
  assert.match(upMixed, /Same formula\./);
  assert.match(upMixed, /Refill size/);
  assert.deepEqual(found(upMixed), []);
});

test('R19: the seed scrub empties an invented line instead of writing an instruction', async () => {
  const { clearTemplateMetrics } = await import('./src/lib/liveStats.ts');
  const p = home();
  Object.assign(p.nodes.find(n => n.id === 'node-page-1').data, { subhead: 'Rated 4.9/5 by 2,000+ verified customers' });
  Object.assign(p.nodes.find(n => n.id === 'node-ad-1').data, { body: 'Book your VIP Consultation today' });
  const out = clearTemplateMetrics(p);
  assert.equal(out.nodes.find(n => n.id === 'node-page-1').data.subhead, '');
  assert.equal(out.nodes.find(n => n.id === 'node-ad-1').data.body, '');
});

test('R18: the starter page opens its form, and a page whose button skips a form says so before publish', () => {
  // The starter map leads its page to Client Intake Form, and only the lead gate opens a form.
  const start = home();
  assert.equal(start.nodes.find(n => n.id === 'node-page-1').data.checkoutMode, 'lead-gate');
  assert.ok(!has(start, 'button-skips-form'));

  for (const mode of [undefined, 'direct']) {
    const p = home();
    const pg = p.nodes.find(n => n.id === 'node-page-1');
    if (mode === undefined) delete pg.data.checkoutMode; else pg.data.checkoutMode = mode;
    const found = checks(p).filter(i => i.check === 'button-skips-form');
    assert.equal(found.length, 1, `checkoutMode ${mode}`);
    assert.equal(found[0].nodeId, 'node-page-1');
    plain(found[0].message);
    assert.match(found[0].message, /Direct to Checkout/);
    assert.match(found[0].message, /skips the form its line leads to/);
    // With no store the button opens the email form whatever the mode, so the sentence names the store case.
    assert.match(found[0].message, /^Once a store is connected, /);
    assert.match(found[0].message, /2-Step Lead Gate/);
    // The header count and the publish confirm read issues.length, so this one is counted there.
    assert.equal(checkJourneyDesign(p).issues.length, STARTER_ROWS.length + 1);

    const plan = planDesignFix(p, found[0]);
    assert.ok(plan, 'the setting is the one structural answer');
    assert.deepEqual(plan.changes, [{ kind: 'set-node-field', nodeId: 'node-page-1', field: 'checkoutMode', before: mode, after: 'lead-gate' }]);
    plan.lines.forEach(plain);
    assert.match(plan.lines[0], /2-Step Lead Gate/);
    const { project: fixed, applied } = applyFixPlan(p, plan);
    assert.ok(applied);
    assert.equal(fixed.nodes.find(n => n.id === 'node-page-1').data.checkoutMode, 'lead-gate');
    assert.ok(!has(fixed, 'button-skips-form'));
    const { project: undone, reverted } = revertFixPlan(fixed, plan);
    assert.ok(reverted);
    assert.equal(undone.nodes.find(n => n.id === 'node-page-1').data.checkoutMode, mode);
    assert.equal('checkoutMode' in undone.nodes.find(n => n.id === 'node-page-1').data, mode !== undefined);
  }

  // Only the button's own line counts: an abandon line into a form, or a button into a sequence, is not this.
  const q = home();
  delete q.nodes.find(n => n.id === 'node-page-1').data.checkoutMode;
  q.edges = q.edges.map(e => (e.id === 'edge-page-form' ? line(e.id, e.source, e.target, 'abandon') : e));
  assert.ok(!has(q, 'button-skips-form'));
  const r = home();
  delete r.nodes.find(n => n.id === 'node-page-1').data.checkoutMode;
  r.edges = r.edges.map(e => (e.id === 'edge-page-form' ? line(e.id, e.source, 'node-seq-1') : e));
  assert.ok(!has(r, 'button-skips-form'));
});

test('R18: with no store the published button opens the email form, never an invented launch notice', async () => {
  const { renderPublicFunnelHtml } = await import('./server/routes/publicRoutes.mjs');
  const req = { query: {}, headers: {}, params: {}, cookies: {} };
  const res = { cookie() {}, setHeader() {}, getHeader() {} };
  const starter = { ...home().nodes.find(n => n.id === 'node-page-1').data, headline: 'Book a free call' };
  const render = (data, shopifyConfig = {}) => renderPublicFunnelHtml({ slug: 'vip-consultation', data, shopifyConfig }, req, res);
  const modalOf = html => html.slice(html.indexOf('<div id="lead-modal"'), html.indexOf('</form>'));
  const store = { storeDomain: 'real-shop.myshopify.com' };

  for (const mode of ['lead-gate', 'direct', undefined]) {
    const html = render({ ...starter, checkoutMode: mode, discountCode: 'SAVE10' });
    assert.doesNotMatch(html, /preparing for launch|open shortly/i, `checkoutMode ${mode}`);
    assert.match(html, /const leadOnly = true;/);
    // The CTA opens the form whatever the mode, since there is no checkout to go to.
    assert.match(html, /if \(isLeadGate \|\| leadOnly\) \{\s*openLeadModal\(\);/);
    const modal = modalOf(html);
    assert.match(modal, /Leave your email/);
    assert.doesNotMatch(modal, /checkout|voucher|coupon|SAVE10|tracking SMS/i, 'no checkout, code or order is promised');
    assert.match(modal, /<span id="btn-text">Send<\/span>/);
    // In place, and only after the server said the lead was saved; a failure says so with a retry.
    assert.match(html, /if \(!resp\.ok\) throw new Error/);
    assert.match(html, /Thanks\. Your details were received\./);
    assert.match(html, /Your details were not sent\. Try again\./);
    assert.match(html, /id="lead-status" role="status"/);
  }

  // The form is a dialog a keyboard or screen-reader user can use: named, labelled, closed by
  // Escape with focus handed back, Tab kept inside, and focus on Close once the form is gone.
  for (const [data, cfg] of [[{ ...starter, checkoutMode: 'lead-gate' }, {}], [{ ...starter, checkoutMode: 'lead-gate', discountCode: 'SAVE10' }, store], [{ ...starter, checkoutMode: 'lead-gate' }, store]]) {
    const html = render(data, cfg);
    const modal = modalOf(html);
    assert.match(modal, /class="modal-card" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title"/);
    assert.match(modal, /<h2 id="lead-modal-title"/);
    assert.match(modal, /id="modal-close-btn" class="modal-close" type="button" aria-label="Close"/);
    assert.match(html, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); closeLeadModal\(\); return; \}/);
    assert.match(html, /closeBtn\.addEventListener\('click', closeLeadModal\)/);
    assert.match(html, /Thanks\. Your details were received\.';[^]*?if \(closeBtn\) closeBtn\.focus/);
  }

  // The exit drawer offers Continue only when there is a checkout to continue to: with no store it
  // sent the visitor to https:///cart/, and focus goes to its Close instead.
  const exitOn = { ...starter, exitIntentEnabled: true, exitIntentHeadline: 'Before you go' };
  const exitNoStore = render(exitOn);
  assert.match(exitNoStore, /id="jv-exit-drawer"/);
  assert.doesNotMatch(exitNoStore, /<button id="jv-exit-continue-btn"/);
  assert.match(exitNoStore, /else if \(closeBtn\) closeBtn\.focus/);
  assert.match(render(exitOn, store), /<button id="jv-exit-continue-btn"/);

  // A connected store keeps both published flows as they were.
  const gate = render({ ...starter, checkoutMode: 'lead-gate' }, store);
  assert.match(gate, /const leadOnly = false;/);
  assert.match(modalOf(gate), /Continue to checkout/);
  const direct = render({ ...starter, checkoutMode: 'direct' }, store);
  assert.match(direct, /const leadOnly = false;/);
  assert.match(direct, /fireInitiateCheckout\(\);\s*const targetUrl = buildCheckoutUrl\(\);/);
});

test('R18: the publish panel names what the button does, and says so when there is no store', () => {
  const src = fs.readFileSync('src/components/preview/PublishModal.tsx', 'utf8');
  assert.match(src, /!storeDomain \? 'email'/);
  assert.match(src, /'Email form, no checkout'/);
  assert.doesNotMatch(src, /fontSize: '(?:\d|10)px'/, '11px minimum text');
});

// ---- R23: a blueprint's sample offers ----

const sampleRow = (p, nodeId) => checks(p).find(i => i.check === 'sample-offer' && i.nodeId === nodeId);
const stepOf = (p, id) => p.nodes.find(n => n.id === id);

test('R23: Check design names every sample code, price, discount and countdown a blueprint loads with', () => {
  const six = bp(6);
  const want = {
    'bp6-page': ['the discount code "WELCOME10"', 'the product price "$68.00"', 'the order bump price "$24.00"', 'the key benefits'],
    'bp6-upsell': ['the badge "Private 40% VIP Privilege"', 'the 5 minute countdown', 'the price "$38.00"', 'the regular price "$64.00"', 'the 40% discount', 'the yes button text'],
    'bp6-ty': ['the discount code "VIPGLOW15"', 'the perk description "$15 Off Your Next Replenishment"'],
    'bp6-cart-recovery': ['the voucher code "COMPLETE10"', 'email 1 and email 2'],
    'bp6-upsell-rescue': ['the voucher code "SAVE10" and email 1'],
    'bp6-ad': ['the ad text']
  };
  for (const [id, parts] of Object.entries(want)) {
    const row = sampleRow(six, id);
    assert.ok(row, `${id} has no sample-offer row`);
    for (const part of parts) assert.ok(row.message.includes(part), `${id}: "${part}" missing from: ${row.message}`);
    assert.match(row.message, /^Still the blueprint's sample, not checked against your store: .+\. Make each one true for your store, or replace or clear it\.$/);
    plain(row.message);
    assert.equal(planDesignFix(six, row), null, 'no fix: the words are the person\'s to write');
  }
  const five = bp(5);
  for (const part of ['the headline', 'the price "$39.00"', 'the regular price "$65.00"', 'the 40% discount']) assert.ok(sampleRow(five, 'bp5-upsell').message.includes(part), part);
  for (const part of ['the headline', 'the price "$19.00"']) assert.ok(sampleRow(five, 'bp5-downsell').message.includes(part), part);
  assert.ok(sampleRow(five, 'bp5-ad').message.includes('the headline'), 'Save 20%');

  // A shipping or tracking promise, a gift, and a results claim are claims too, not only codes and prices.
  assert.match(sampleRow(bp(1), 'bp1-seq')?.message ?? '', /: email 1\./, 'insured priority tracking');
  assert.match(sampleRow(bp(2), 'bp2-seq')?.message ?? '', /: email 2\./, '3.4x ROI');
  assert.ok(sampleRow(bp(2), 'bp2-ad')?.message.includes('the ad text'), 'in 30 days');
  // A customer count, a user count and a price comparison are claims too. BlueprintModal's load scrub
  // leaves these three in place, so once everything else the row names is the person's own, the row
  // still names them rather than going quiet with an invented claim on the page.
  const counts = {
    3: ['bp3-page', 'trustBadge', 'the trust badge', { bullets: ['Mine'], discountCode: '', shopifyProductPrice: '', orderBumpPrice: '', orderBumpDescription: 'Mine', orderBumpHeadline: 'Mine' }],
    4: ['bp4-page', 'subhead', 'the subheadline', { bullets: ['Mine'], discountCode: '', shopifyProductPrice: '', orderBumpPrice: '', orderBumpDescription: 'Mine', trustBadge: '' }],
    5: ['bp5-page', 'subhead', 'the subheadline', { bullets: ['Mine'], discountCode: '', shopifyProductPrice: '', orderBumpPrice: '', orderBumpDescription: 'Mine', trustBadge: '' }]
  };
  for (const [n, [id, field, name, replaced]] of Object.entries(counts)) {
    const p = bp(Number(n));
    Object.assign(stepOf(p, id).data, replaced);
    assert.match(sampleRow(p, id)?.message ?? '', new RegExp(`: ${name}\\.`), `${id}.${field}: ${stepOf(p, id).data[field]}`);
    stepOf(p, id).data[field] = 'Mine';
    assert.equal(sampleRow(p, id), undefined, `${id}: the row goes once the claim is the person's own`);
  }
  // "Tested and proven by thousands of daily users" is a sample benefit on bp5 even with the price replaced.
  const bp5 = bp(5);
  Object.assign(stepOf(bp5, 'bp5-page').data, { discountCode: '', shopifyProductPrice: '', subhead: 'Mine', trustBadge: '' });
  stepOf(bp5, 'bp5-page').data.bullets = stepOf(bp5, 'bp5-page').data.bullets.filter(b => /thousands/.test(b));
  assert.match(sampleRow(bp5, 'bp5-page')?.message ?? '', /: the key benefits\./);
  // Loading bp4 replaces email 1's VIP15 body (BlueprintModal), and its preview text still promises a gift.
  const four = bp(4);
  const welcome = stepOf(four, 'bp4-seq').data.steps[0];
  welcome.body = 'Hi [First Name],\n\nThanks for signing up. The next step is here: [Checkout Link]\n\nThe Team';
  assert.match(sampleRow(four, 'bp4-seq').message, /: email 1, email 2 and email 3\./, 'a welcome gift');
  welcome.previewText = 'Download your file';
  assert.match(sampleRow(four, 'bp4-seq').message, /: email 2 and email 3\./);

  // Every code, price, discount and countdown any blueprint ships is named on its own step, one row a step.
  for (const b of ECOM_BLUEPRINTS) {
    const p = clone(b);
    const rows = checks(p).filter(i => i.check === 'sample-offer');
    assert.equal(new Set(rows.map(i => i.nodeId)).size, rows.length, `${b.id}: one row a step`);
    for (const n of p.nodes) {
      const d = n.data;
      const shipped = [
        ...['discountCode', 'bounceBackDiscountCode', 'voucherCode', 'productPrice', 'regularPrice', 'orderBumpPrice', 'shopifyProductPrice']
          .filter(f => typeof d[f] === 'string' && d[f].trim()).map(f => `"${d[f]}"`),
        ...(d.discountPercentage > 0 ? [`the ${d.discountPercentage}% discount`] : []),
        ...(d.urgencyMinutes > 0 ? [`the ${d.urgencyMinutes} minute countdown`] : [])
      ];
      for (const s of shipped) assert.ok(sampleRow(p, n.id)?.message.includes(s), `${n.id}: ${s} not named`);
    }
  }
});

test('R23: a row lists only what is still the sample, and goes once each one is the person\'s own', () => {
  const p = bp(6);
  const ty = stepOf(p, 'bp6-ty');
  ty.data.bounceBackDiscountCode = 'MYSTORE15';
  assert.ok(!sampleRow(p, 'bp6-ty').message.includes('VIPGLOW15'));
  assert.ok(sampleRow(p, 'bp6-ty').message.includes('the perk description'));
  ty.data.bounceBackDiscountText = '';
  // The insured tracking promise in the subheadline and the guide is still the sample's.
  assert.match(sampleRow(p, 'bp6-ty').message, /: the subheadline and the guide steps\./);
  ty.data.subhead = 'We have your order.';
  ty.data.usageGuideSteps = ty.data.usageGuideSteps.slice(0, 2);
  assert.equal(sampleRow(p, 'bp6-ty'), undefined);

  // A price a connected store fills in is the store's, not the sample.
  stepOf(p, 'bp6-page').data.shopifyProductPrice = '68.00';
  assert.ok(!sampleRow(p, 'bp6-page').message.includes('$68.00'));

  // Emails are counted where they now sit, so taking one out never hides the other.
  const seq = stepOf(p, 'bp6-cart-recovery');
  seq.data.steps.shift();
  assert.match(sampleRow(p, 'bp6-cart-recovery').message, /"COMPLETE10" and email 1\./);
  seq.data.voucherCode = '';
  seq.data.steps[0] = { ...seq.data.steps[0], subject: 'Your cart is saved', previewText: '', body: 'Hi [First Name],\n\n[Checkout Link]' };
  assert.equal(sampleRow(p, 'bp6-cart-recovery'), undefined);

  // A countdown turned off, and a discount cleared, leave the list.
  const up = stepOf(p, 'bp6-upsell');
  delete up.data.urgencyMinutes;
  up.data.discountPercentage = 0;
  assert.ok(!/countdown|% discount/.test(sampleRow(p, 'bp6-upsell').message));
});

test('R23: the same offer written on a step of the person\'s own is theirs, never "the blueprint\'s sample"', () => {
  const p = home();
  const own = bp(6).nodes.map(n => ({ ...n, id: `mine-${n.id}` }));
  p.nodes.push(...own);
  for (const n of own) assert.equal(sampleRow(p, n.id), undefined, n.id);
  // And the starter map carries no sample offer at all.
  assert.ok(!has(home(), 'sample-offer'));
});

// ---- T10: the starter map's letters, ad headline and notification address ----
// The starter journey kept "Replace this before anyone receives it" in each letter's preview text
// and body, "Your ad headline" on its ad and "team@yourbusiness.com" as the form's notification
// address, all as VALUES, and Check design named none of them, so writing the page headline made it
// read clean. Exactly what a journey saved before T10 holds on its ad and letters:
const OLD_T10 = {
  ad: { headline: 'Your ad headline' },
  steps: [
    { id: 'step-1', channel: 'email', delay: 'Instant (0m)', subject: 'You are on the list', previewText: 'Replace this before anyone receives it', body: 'Hi [First Name],\n\nThanks for signing up. Replace this note with the real next step before anyone receives it.\n\nThe Team' },
    { id: 'step-2', channel: 'email', delay: '24 Hours', subject: 'A follow-up', previewText: 'Replace this before anyone receives it', body: 'Hi [First Name],\n\nThis is a follow-up in the sequence. Replace it with a real detail about your offer before anyone receives it.\n\nThe Team' },
    { id: 'step-3', channel: 'email', delay: '72 Hours', subject: 'One more note', previewText: 'Replace this before anyone receives it', body: 'Hi [First Name],\n\nThis is the last note in the sequence. Mention a deadline only if you actually have one.\n\nThe Team' }
  ]
};
const T10_INSTRUCTION = /replace (?:this|it)\b|before anyone receives it|only if you actually have one|^your ad headline$|^write this subject$/i;
const T10_INVENTED = /@yourbusiness\.com|yourbusiness\.com/i;
const deepStrings = (v, path = '') => typeof v === 'string' ? [[path, v]]
  : Array.isArray(v) ? v.flatMap((x, i) => deepStrings(x, `${path}[${i}]`))
  : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => deepStrings(x, path ? `${path}.${k}` : k)) : [];

test('T10: a fresh starter journey holds no instruction text or invented address as a value', () => {
  for (const [path, value] of deepStrings(DEFAULT_LEAD_CAPTURE_PROJECT)) {
    assert.ok(!T10_INSTRUCTION.test(value.trim()), `${path} stores "${value}"`);
    assert.ok(!T10_INVENTED.test(value), `${path} stores the invented address "${value}"`);
  }
  const at = type => home().nodes.find(n => n.type === type).data;
  assert.equal(at('ad-source').headline, '');
  assert.equal(at('lead-form').notifyEmail ?? '', '');
  for (const letter of at('follow-up-sequence').steps) {
    assert.equal(letter.previewText, '', letter.id);
    assert.equal(letter.body, '', letter.id);
    assert.ok(letter.subject.trim(), `${letter.id} keeps its neutral subject`);
  }
});

test('T10: Check design lists the empty letters and the ad headline on a fresh journey, with no fix', () => {
  const p = home();
  const rows = checks(p);
  const msg = (check, field) => rows.find(i => i.check === check && (field === undefined || i.field === field))?.message;
  assert.equal(msg('ad-headline'), 'Add an ad headline.');
  // U04: the ad's button text and campaign tag start empty too, and an ad with no tag is not measured.
  assert.equal(msg('ad-button'), 'Add the ad button text.');
  assert.equal(msg('ad-campaign'), 'Add a campaign tag so visits from this ad can be counted.');
  assert.equal(msg('letter-empty', 'steps.0'), 'Email 1 has no preview text or message yet.');
  assert.equal(msg('letter-empty', 'steps.2'), 'Email 3 has no preview text or message yet.');
  assert.deepEqual(checkJourneyDesign(p).byNode['node-seq-1'].messages.length, 3);
  for (const i of rows.filter(r => ['ad-headline', 'ad-button', 'ad-campaign', 'letter-empty'].includes(r.check))) {
    plain(i.message);
    assert.equal(planDesignFix(p, i), null, `${i.key}: the words are the person's to write`);
  }
  // Writing the page headline no longer makes it read clean.
  p.nodes.find(n => n.id === 'node-page-1').data.headline = 'Book a free call';
  assert.equal(checks(p).length, 6);
  // Written words clear every row: a real letter may say "replace", and a text needs only its message.
  const seq = p.nodes.find(n => n.id === 'node-seq-1').data;
  seq.steps = seq.steps.map((s, i) => ({ ...s, previewText: 'Your call details', body: `Hi [First Name],\n\nWe replace this kind of form with a quick call. Note ${i + 1}.` }));
  seq.steps.push({ id: 'sms-1', channel: 'sms', delay: '1 Hour', subject: '', body: 'See you at 3pm.' });
  Object.assign(p.nodes.find(n => n.id === 'node-ad-1').data, { headline: 'Book a free call', ctaText: 'Book now', utmCampaign: 'spring-calls' });
  assert.deepEqual(checks(p), []);
  // A text with no message is named as a text, and never asked for a subject line or preview.
  seq.steps[3].body = ' ';
  assert.deepEqual(checks(p).map(i => i.message), ['Text 4 has no message yet.']);
  // An email with nothing at all names all three parts.
  seq.steps.push({ id: 'blank', channel: 'email', delay: '2 Days', subject: '', body: '' });
  assert.ok(checks(p).some(i => i.message === 'Email 5 has no subject line, preview text or message yet.'));
});

test('T10: Check design names old saved instruction text on letters and the ad headline', () => {
  const p = home();
  p.nodes.find(n => n.id === 'node-page-1').data.headline = 'Book a free call';
  Object.assign(p.nodes.find(n => n.id === 'node-ad-1').data, { ctaText: 'Book now', utmCampaign: 'spring-calls' }, OLD_T10.ad);
  p.nodes.find(n => n.id === 'node-seq-1').data.steps = clone(OLD_T10.steps);
  const rows = checks(p);
  assert.deepEqual(rows.map(i => [i.check, i.field]), [
    ['ad-headline', 'headline'],
    ['starter-text', 'steps.0'], ['starter-text', 'steps.1'], ['starter-text', 'steps.2']
  ]);
  assert.equal(rows[0].message, 'The ad headline is still the placeholder "Your ad headline".');
  assert.equal(rows[1].message, 'Email 1 still has draft instructions in its preview text and message. Write your own before anyone receives it.');
  assert.equal(rows[3].message, 'Email 3 still has draft instructions in its preview text and message. Write your own before anyone receives it.');
  // The other drafts that write letters: a new step's, a preset's and the forecaster's retention flows.
  // A new step starts with empty letters now (U04), so the old draft journeys still hold is built here.
  const drafts = { steps: [{ id: 'step-1', channel: 'email', delay: 'Instant (0m)', subject: 'Write this subject', previewText: 'Replace this before anyone receives it', body: 'Hi [First Name],\n\nReplace this note with your real message before anyone receives it.\n\nThe Team' }] };
  const q = home();
  q.nodes.find(n => n.id === 'node-seq-1').data.steps = drafts.steps;
  assert.match(checks(q).find(i => i.nodeId === 'node-seq-1').message, /^Email 1 still has draft instructions in its subject line, preview text and message\./);
  for (const i of rows) plain(i.message);
});

test('T10: the editors show hints, not values, and no field implies a lead is emailed', () => {
  const seqSrc = read('src/components/drawers/SequenceEditor.tsx');
  // Add Letter starts empty rather than with an invented subject about "your order".
  assert.match(seqSrc, /const newStep: SequenceStep = \{[\s\S]{0,120}?subject: '',\s*previewText: '',\s*body: ''/);
  assert.doesNotMatch(seqSrc, /Follow-up regarding your order/);
  // Subject, preview text (email only) and message each carry a placeholder hint.
  assert.match(seqSrc, /id=\{fid\('subject'\)\}[\s\S]{0,200}placeholder="[^"]+"/);
  assert.match(seqSrc, /currentStep\.channel !== 'sms'[\s\S]{0,300}id=\{fid\('preview-text'\)\}[\s\S]{0,300}placeholder="[^"]+"/);
  assert.match(seqSrc, /id=\{fid\('body'\)\}[\s\S]{0,200}placeholder="[^"]+"/);
  assert.match(seqSrc, /No message written yet/);
  const adSrc = read('src/components/drawers/AdEditor.tsx');
  assert.match(adSrc, /id=\{fid\('headline'\)\}[\s\S]{0,200}placeholder="[^"]+"/);
  const formSrc = read('src/components/drawers/FormEditor.tsx');
  assert.doesNotMatch(formSrc, /handleFieldChange\('notifyEmail'/, 'nothing reads notifyEmail, so the editor must not offer it');
  assert.doesNotMatch(formSrc, /Lead Notification Email/);
  for (const src of [seqSrc, adSrc, formSrc]) {
    for (const [, hint] of src.matchAll(/placeholder="([^"]*)"/g)) {
      assert.doesNotMatch(hint, /—| – /, `dash in hint: ${hint}`);
      assert.doesNotMatch(hint, /spot is reserved|complimentary/i, `invented promise in hint: ${hint}`);
    }
  }
});
