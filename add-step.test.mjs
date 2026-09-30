// Adding a step where the person works (#12): + Next, + Before, + Step on a line, a line dragged
// into empty map and a loose step dropped onto a line. Every rule lives in src/lib/addStep.ts and
// every new step's data in src/lib/stepDefaults.ts, so these tests drive them directly on the
// shipped starter map and blueprints. The header's old Add Step placed cards with
// (n*280)%1200+100, on top of whatever sat there, and new upsell and thank-you steps arrived with
// a skincare product, "$38.00", "VIPOTO40" and a "$15 Off" code nobody wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const A = await import('./src/lib/addStep.ts');
const D = await import('./src/lib/stepDefaults.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT: MAP } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const NODE_FILES = {
  'ad-source': 'AdNode.tsx', 'landing-page': 'PageNode.tsx', 'lead-form': 'FormNode.tsx',
  'follow-up-sequence': 'SequenceNode.tsx', 'thank-you': 'ThankYouNode.tsx', upsell: 'UpsellNode.tsx', 'ab-split': 'AbSplitNode.tsx'
};
const SIDE = { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' };
const handleBlocks = file => {
  const src = fs.readFileSync(`src/components/canvas/nodes/${file}`, 'utf8');
  return src.split('<Handle').slice(1).map(b => b.slice(0, b.indexOf('/>')));
};
const portsFromCard = (file, kind) => handleBlocks(file)
  .filter(b => new RegExp(`type="${kind}"`).test(b))
  .map(b => ({ handle: (b.match(/\bid="([^"]+)"/) || [])[1] || null, side: SIDE[(b.match(/Position\.(\w+)/) || [])[1]] }));
const handleAndSide = ports => ports.map(({ handle, side }) => ({ handle, side }));

const EM_DASH = /—|\s–\s/;
const byId = (list, id) => list.find(x => x.id === id);
const clone = v => JSON.parse(JSON.stringify(v));
const nodes = () => clone(MAP.nodes);
const edges = () => clone(MAP.edges);
const rectOf = n => ({ x: n.position.x, y: n.position.y, ...A.sizeOf(n) });
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const overlapsAny = (n, others) => others.some(o => o.id !== n.id && intersects(rectOf(n), rectOf(o)));

test('STEP_PORTS matches the handles on the cards', () => {
  for (const [type, file] of Object.entries(NODE_FILES)) {
    assert.deepEqual(handleAndSide(A.STEP_PORTS[type].inputs), portsFromCard(file, 'target'), `${type} inputs`);
    assert.deepEqual(handleAndSide(A.STEP_PORTS[type].exits), portsFromCard(file, 'source'), `${type} exits`);
    for (const x of A.STEP_PORTS[type].insertExits) {
      assert.ok(A.STEP_PORTS[type].exits.some(p => p.handle === x), `${type} inserts through ${x}, which it does not have`);
    }
  }
});

test('defaultExit never picks a bottom exit', () => {
  const ns = nodes();
  const page = byId(ns, 'node-page-1');
  assert.equal(A.defaultExit(page, ns, edges()), null);
  const upsell = D.makeStep('upsell', { x: 0, y: 0 }, 'u');
  const thanks = D.makeStep('thank-you', { x: 400, y: 0 }, 't');
  const all = [...ns, upsell, thanks];
  const accepted = { id: 'x1', source: upsell.id, sourceHandle: 'accepted', target: thanks.id };
  const declined = { id: 'x2', source: upsell.id, sourceHandle: 'declined', target: thanks.id };
  assert.equal(A.defaultExit(upsell, all, []), 'accepted');
  assert.equal(A.defaultExit(upsell, all, [accepted]), 'declined');
  assert.equal(A.defaultExit(upsell, all, [accepted, declined]), 'accepted');
  assert.equal(A.defaultExit(thanks, all, []), undefined);
  // #30 gave follow-up emails one unnamed exit, so + Next on them uses it.
  assert.equal(A.defaultExit(byId(ns, 'node-seq-1'), ns, edges()), null);
});

test('next on a free exit connects', () => {
  const ns = nodes();
  const es = edges();
  const plan = A.planAdd({ direction: 'next', anchorId: 'node-form-1', handle: null }, 'thank-you', ns, es, 's1');
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.edges.length, es.length + 1);
  assert.ok(byId(plan.edges, 'edge-form-seq'), 'a follow-up runs alongside, so its line stays');
  assert.deepEqual(plan.removed, []);
  const [line] = plan.added;
  assert.equal(line.source, 'node-form-1');
  assert.equal(line.target, plan.node.id);
  assert.equal(line.sourceHandle, null);
  assert.equal(line.type, 'conversion');
  assert.equal(line.data.isRetentionEdge, false);
  const form = byId(ns, 'node-form-1');
  assert.ok(plan.node.position.x > form.position.x + A.sizeOf(form).width, 'right of the form');
  assert.equal(overlapsAny(plan.node, ns), false);
  assert.match(plan.summary, /^Added .+ after Client Intake Form\.$/);
});

test('next on a taken exit inserts', () => {
  const es = edges();
  const plan = A.planAdd({ direction: 'next', anchorId: 'node-page-1', handle: null }, 'lead-form', nodes(), es, 's2');
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(byId(plan.edges, 'edge-page-form'), undefined);
  assert.deepEqual(plan.removed, ['edge-page-form']);
  const id = plan.node.id;
  assert.ok(plan.edges.some(e => e.source === 'node-page-1' && e.target === id));
  assert.ok(plan.edges.some(e => e.source === id && e.target === 'node-form-1'));
  assert.equal(plan.edges.length, es.length + 1);
  for (const e of plan.added) {
    assert.equal(e.data.rate, 0);
    assert.equal(e.data.sourceThroughput, 0);
    assert.equal(e.data.targetCount, 0);
  }
  assert.equal(new Set(plan.edges.map(e => e.id)).size, plan.edges.length);
  assert.equal(
    A.exitNote({ direction: 'next', anchorId: 'node-page-1', handle: null }, nodes(), es),
    'Lead Capture Lander leads to Client Intake Form now. The new step goes in between.'
  );
});

test('an upsell in between sends both answers on', () => {
  const es = edges();
  es.find(e => e.id === 'edge-page-form').targetHandle = null;
  const plan = A.planAdd({ direction: 'next', anchorId: 'node-page-1', handle: null }, 'upsell', nodes(), es, 'same');
  assert.equal(plan.ok, true, plan.reason);
  const out = plan.edges.filter(e => e.source === plan.node.id);
  assert.deepEqual(out.map(e => e.sourceHandle).sort(), ['accepted', 'declined']);
  assert.ok(out.every(e => e.target === 'node-form-1'));
  assert.notEqual(out[0].id, out[1].id);
  assert.equal(new Set(plan.edges.map(e => e.id)).size, plan.edges.length);
});

test('two routing lines refuse', () => {
  const ns = nodes();
  const extra = D.makeStep('thank-you', { x: 800, y: 700 }, 'x');
  ns.push(extra);
  const es = [...edges(), { id: 'fan', source: 'node-page-1', target: extra.id, type: 'conversion', data: { sourceThroughput: 0, targetCount: 0, rate: 0 } }];
  const req = { direction: 'next', anchorId: 'node-page-1', handle: null };
  const refused = A.planAdd(req, 'lead-form', ns, es, 's');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /\+ Step/);
  const alongside = A.planAdd(req, 'follow-up', ns, es, 's');
  assert.equal(alongside.ok, true, alongside.reason);
  assert.match(alongside.summary, /runs alongside the next step/);
  assert.deepEqual(alongside.removed, []);
  assert.equal(A.exitNote(req, ns, es), '');
  const rows = A.choicesFor(req, ns, es);
  for (const row of [...rows.recommended, ...rows.other]) {
    if (row.type !== 'follow-up-sequence') assert.match(row.refusal ?? '', /\+ Step/, row.key);
  }
});

test('refusals are plain and change nothing', () => {
  const es = edges();
  const before = JSON.stringify(es);
  const between = { direction: 'between', edgeId: 'edge-page-form' };
  for (const key of ['thank-you', 'ab-split', 'follow-up']) {
    const plan = A.planAdd(between, key, nodes(), es, 's');
    assert.equal(plan.ok, false, key);
    assert.match(plan.reason, /Lead Capture Lander/, key);
    assert.match(plan.reason, /Client Intake Form/, key);
    assert.doesNotMatch(plan.reason, EM_DASH, key);
  }
  assert.equal(JSON.stringify(es), before);
  const rows = A.choicesFor(between, nodes(), es);
  const all = [...rows.recommended, ...rows.other];
  for (const key of ['thank-you', 'ab-split', 'follow-up']) assert.ok(all.find(r => r.key === key)?.refusal, key);
  assert.equal(all.find(r => r.key === 'lead-form')?.refusal, undefined);
  for (const req of [between, { direction: 'next', anchorId: 'node-page-1', handle: null }, { direction: 'next', anchorId: 'node-form-1', handle: null }]) {
    const list = A.choicesFor(req, nodes(), es);
    assert.equal([...list.recommended, ...list.other].some(r => r.key === 'ad-source'), false);
  }
  const page = A.choicesFor({ direction: 'next', anchorId: 'node-page-1', handle: null }, nodes(), es);
  assert.deepEqual(page.recommended.map(r => r.label), ['Lead form', 'Upsell offer', 'Thank-you page', 'Follow-up emails']);
});

test('bottom exits lead into recovery flows', () => {
  const req = { direction: 'next', anchorId: 'node-page-1', handle: 'abandon' };
  const rows = A.choicesFor(req, nodes(), edges());
  assert.equal(rows.recommended[0].key, 'checkout-recovery');
  const plan = A.planAdd(req, 'checkout-recovery', nodes(), edges(), 's3');
  assert.equal(plan.ok, true, plan.reason);
  const d = plan.node.data;
  assert.equal(d.sequenceType, 'checkout_recovery');
  assert.equal(d.isRetentionBranch, true);
  assert.equal(d.voucherCode, undefined);
  assert.equal(d.steps.length, 1);
  const email = JSON.stringify(d.steps[0]);
  for (const bad of ['%', 'code', 'free']) assert.ok(!email.toLowerCase().includes(bad), bad);
  const [line] = plan.added;
  assert.equal(line.sourceHandle, 'abandon');
  assert.equal(line.targetHandle, 'retention-in');
  assert.equal(line.data.isRetentionEdge, true);
  const page = byId(nodes(), 'node-page-1');
  assert.ok(plan.node.position.y >= page.position.y + A.sizeOf(page).height, 'below the page');
  const main = A.choicesFor({ direction: 'next', anchorId: 'node-page-1', handle: null }, nodes(), edges());
  const mainKeys = [...main.recommended, ...main.other].map(r => r.key);
  assert.ok(!mainKeys.includes('checkout-recovery') && !mainKeys.includes('upsell-rescue'));
  // Someone who left is reached only by message (#13's rule), so a bottom exit offers emails alone,
  // and a loose page dropped onto that line is refused rather than wired where #13 would refuse it.
  assert.deepEqual([...rows.recommended, ...rows.other].map(r => r.type).filter(t => t !== 'follow-up-sequence'), []);
  const page2 = D.makeStep('landing-page', { x: 0, y: 1400 }, 'p2');
  const drop = A.dropOnLine([...nodes(), plan.node, page2], plan.edges, line.id, page2.id, 's');
  assert.equal(drop.ok, false);
  assert.match(drop.reason, /by message/);
  // A drag released below the dot puts the new card's top centre at the release point.
  const dropped = A.planAdd({ ...req, at: { x: 530, y: 800 } }, 'checkout-recovery', nodes(), edges(), 's4');
  assert.deepEqual({ x: dropped.node.position.x + D.STEP_SIZE.width / 2, y: dropped.node.position.y }, { x: 530, y: 800 });
});

test('a split branch leads only to a page or an offer', () => {
  const ns = nodes();
  const split = D.makeStep('ab-split', { x: 380, y: 900 }, 'ab');
  ns.push(split);
  const req = { direction: 'next', anchorId: split.id, handle: 'branch-a' };
  const rows = A.choicesFor(req, ns, edges());
  assert.deepEqual([...rows.recommended, ...rows.other].map(r => r.key), ['landing-page', 'upsell', 'downsell']);
  const refused = A.planAdd(req, 'lead-form', ns, edges(), 's');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /published page/);
  assert.equal(A.planAdd(req, 'landing-page', ns, edges(), 's').ok, true);
});

test('before only offers steps with a main exit', () => {
  const req = { direction: 'before', anchorId: 'node-page-1' };
  const rows = A.choicesFor(req, nodes(), edges());
  const keys = [...rows.recommended, ...rows.other].map(r => r.key);
  assert.equal(keys[0], 'ad-source');
  for (const k of keys) assert.ok(['ad-source', 'landing-page', 'lead-form'].includes(k), k);
  const es = edges();
  const plan = A.planAdd(req, 'ad-source', nodes(), es, 's5');
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.edges.length, es.length + 1);
  assert.deepEqual(plan.removed, []);
  const [line] = plan.added;
  assert.deepEqual([line.source, line.sourceHandle, line.target, line.targetHandle], [plan.node.id, null, 'node-page-1', null]);
  assert.ok(plan.node.position.x < byId(nodes(), 'node-page-1').position.x, 'left of the page');
  assert.equal(A.planAdd({ direction: 'before', anchorId: 'node-ad-1' }, 'landing-page', nodes(), es, 's').ok, false);
});

test('dropOnLine', () => {
  const ns = nodes();
  const es = edges();
  const connected = A.dropOnLine(ns, es, 'edge-ad-page', 'node-form-1', 's');
  assert.deepEqual(connected, { ok: false, reason: '' });
  const form = D.makeStep('lead-form', { x: 300, y: 600 }, 'f');
  const withForm = [...ns, form];
  const esHandle = edges();
  esHandle.find(e => e.id === 'edge-page-form').targetHandle = null;
  const split = A.dropOnLine(withForm, esHandle, 'edge-form-seq', form.id, 's6');
  assert.equal(split.ok, true, split.reason);
  assert.match(split.summary, /^Inserted .+ between Client Intake Form and Nurture & Booking Flow\.$/);
  assert.equal(byId(split.edges, 'edge-form-seq'), undefined);
  const out = split.edges.find(e => e.source === form.id);
  assert.equal(out.target, 'node-seq-1');
  // A line into the retention dot keeps that dot after the insert.
  const retention = edges().map(e => (e.id === 'edge-form-seq' ? { ...e, targetHandle: 'retention-in' } : e));
  const kept = A.dropOnLine(withForm, retention, 'edge-form-seq', form.id, 's7');
  assert.equal(kept.edges.find(e => e.source === form.id).targetHandle, 'retention-in');
  assert.deepEqual(form.position, { x: 300, y: 600 });
  const thanks = D.makeStep('thank-you', { x: 300, y: 600 }, 't');
  const refused = A.dropOnLine([...ns, thanks], es, 'edge-ad-page', thanks.id, 's');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /ends the journey/);
  assert.deepEqual(thanks.position, { x: 300, y: 600 });
  assert.deepEqual(A.dropOnLine(ns, es, 'gone', 'node-form-1', 's'), { ok: false, reason: '' });
});

test('freeSlot places without overlap', () => {
  const card = { id: 'a', position: { x: 0, y: 0 } };
  assert.deepEqual(A.freeSlot({ x: 1000, y: 0 }, [card]), { x: 1000, y: 0 });
  const below = A.freeSlot({ x: 0, y: 0 }, [card]);
  assert.equal(below.x, 0);
  assert.ok(below.y >= D.STEP_SIZE.height + 32);
  const small = { id: 'b', position: { x: 0, y: 0 }, measured: { width: 100, height: 60 } };
  assert.deepEqual(A.freeSlot({ x: 140, y: 0 }, [small], { width: 100, height: 60 }), { x: 140, y: 0 });
  assert.notDeepEqual(A.freeSlot({ x: 140, y: 0 }, [card], { width: 100, height: 60 }), { x: 140, y: 0 });
  const left = A.freeSlot({ x: 0, y: 0 }, [{ id: 'w', position: { x: 0, y: 0 }, measured: { width: 300, height: 5000 } }], D.STEP_SIZE, -1);
  assert.ok(left.x < 0, 'searches left');
  for (const map of [...ECOM_BLUEPRINTS, MAP]) {
    for (const n of map.nodes) {
      const spot = A.freeSlot(n.position, map.nodes);
      const probe = { id: 'probe', position: spot };
      assert.equal(overlapsAny(probe, map.nodes), false, `${map.name ?? map.id} at ${n.id}`);
    }
  }
  const view = { center: { x: 5000, y: 5000 }, sizeOf: () => ({ width: 10, height: 10 }) };
  assert.deepEqual(A.slotForNewStep(MAP.nodes, view), { x: 5000 - D.STEP_SIZE.width / 2, y: 5000 - D.STEP_SIZE.height / 2 });
  // view.sizeOf wins over the estimate: a tall measured card pushes the new step below it.
  const tall = [{ id: 'tall', position: { x: 0, y: 0 } }];
  const measured = A.slotForNewStep(tall, { center: { x: 150, y: 160 }, sizeOf: () => ({ width: 300, height: 900 }) });
  assert.ok(measured.y >= 900 + 32);
  assert.deepEqual(A.slotForNewStep([], null), { x: 100, y: 180 });
  const noView = A.slotForNewStep(MAP.nodes, null);
  assert.ok(noView.x >= Math.max(...MAP.nodes.map(n => n.position.x + D.STEP_SIZE.width)));
});

test('nearestLine and needsReveal', () => {
  const flat = { h: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  assert.equal(A.nearestLine({ x: 50, y: 10 }, flat, 24), 'h');
  assert.equal(A.nearestLine({ x: 50, y: 10 }, flat, 5), null);
  const two = { far: [{ x: 0, y: 30 }, { x: 100, y: 30 }], near: [{ x: 0, y: 12 }, { x: 100, y: 12 }] };
  assert.equal(A.nearestLine({ x: 50, y: 0 }, two, 40), 'near');
  const view = A.visibleFlowRect({ x: 0, y: 0, zoom: 1 }, { width: 1000, height: 800 });
  assert.equal(A.needsReveal({ x: 100, y: 100, width: 300, height: 300 }, view), false);
  assert.equal(A.needsReveal({ x: 850, y: 100, width: 300, height: 300 }, view), true);
  const covered = A.visibleFlowRect({ x: 0, y: 0, zoom: 1 }, { width: 1000, height: 800 }, 420);
  assert.equal(A.needsReveal({ x: 400, y: 100, width: 300, height: 300 }, covered), true);
  const zoomed = A.visibleFlowRect({ x: -200, y: -100, zoom: 2 }, { width: 1000, height: 800 });
  assert.deepEqual(zoomed, { x: 100, y: 50, width: 500, height: 400 });
});

const INVENTED = ['Bioactive', 'cosmetic', 'VIPOTO40', 'VIPRETURN', '$38.00', '$64.00', 'unsplash', '$15 Off', 'voucher', 'reserv', 'Reserv', 'VIP', 'welcome guide', 'Check your email'];

test('step defaults carry no invented copy', () => {
  const types = Object.keys(NODE_FILES);
  for (const type of types) {
    assert.equal(D.newStepData(type, 's').type, type);
    assert.notEqual(D.makeStep(type, { x: 0, y: 0 }, 'a').id, D.makeStep(type, { x: 0, y: 0 }, 'b').id);
  }
  const retention = A.STEP_CHOICES.filter(c => c.key === 'checkout-recovery' || c.key === 'upsell-rescue').map(c => c.patch);
  assert.equal(retention.length, 2);
  // Every step type, not just the two that once carried a product: the lead form confirmed a
  // "reservation" and the follow-up email promised a "VIP welcome guide" nobody wrote (C47).
  const texts = [...types.map(t => D.newStepData(t, 's')), ...retention].map(v => JSON.stringify(v));
  for (const text of texts) for (const bad of INVENTED) assert.ok(!text.includes(bad), `${bad} in ${text.slice(0, 60)}`);
  const upsell = D.newStepData('upsell', 's');
  for (const field of ['productTitle', 'productPrice', 'regularPrice', 'discountCode', 'productImage']) assert.equal(upsell[field], '', field);
  const thanks = D.newStepData('thank-you', 's');
  for (const field of ['bounceBackDiscountCode', 'bounceBackDiscountText', 'communityInviteText', 'subhead']) assert.equal(thanks[field], '', field);
  assert.equal(D.makeStep('upsell', { x: 0, y: 0 }, 's', { offerType: 'downsell' }).data.offerType, 'downsell');
  // A new form reads like the starter map's: neutral. A new email starts empty (U04, below).
  const form = D.newStepData('lead-form', 's');
  assert.equal(form.formTitle, 'Where should we reach you?');
  assert.equal(form.submitButtonText, 'Submit');
  assert.equal(form.successMessage, 'Thanks. We have your details.');
  for (const email of D.newStepData('follow-up-sequence', 's').steps) {
    for (const field of ['subject', 'previewText', 'body']) assert.equal(email[field], '', `a new email's ${field}`);
  }
  assert.equal(thanks.label, 'Thank-you page');

  // Every word this item shows: defaults, choices, recommendations, reasons and summaries.
  const words = [...types.map(t => JSON.stringify(D.newStepData(t, 's'))), JSON.stringify(A.STEP_CHOICES), JSON.stringify(A.STEP_PORTS)];
  const ns = nodes();
  const es = edges();
  const requests = [
    { direction: 'next', anchorId: 'node-page-1', handle: null },
    { direction: 'next', anchorId: 'node-page-1', handle: 'abandon' },
    { direction: 'next', anchorId: 'node-form-1', handle: null },
    { direction: 'before', anchorId: 'node-page-1' },
    { direction: 'before', anchorId: 'node-ad-1' },
    { direction: 'between', edgeId: 'edge-page-form' },
    { direction: 'between', edgeId: 'gone' }
  ];
  for (const req of requests) {
    words.push(A.exitNote(req, ns, es), A.pickerTitle(req), A.pickerAnchorLabel(req, ns, es));
    for (const choice of A.STEP_CHOICES) {
      const plan = A.planAdd(req, choice.key, ns, es, 's');
      words.push(plan.ok ? plan.summary : plan.reason);
    }
  }
  words.push(A.planAdd(requests[0], 'nope', ns, es, 's').reason);
  for (const w of words) assert.doesNotMatch(w, EM_DASH, w);
});

test('choosing a step is one pure edit: inputs are never mutated', () => {
  const ns = nodes();
  const es = edges();
  const before = JSON.stringify([ns, es]);
  for (const req of [
    { direction: 'next', anchorId: 'node-page-1', handle: null },
    { direction: 'between', edgeId: 'edge-ad-page' },
    { direction: 'before', anchorId: 'node-form-1' }
  ]) {
    for (const c of A.STEP_CHOICES) A.planAdd(req, c.key, ns, es, 's');
    A.choicesFor(req, ns, es);
  }
  assert.equal(JSON.stringify([ns, es]), before);
});

// ---- One rule with #13. Only a line from the MAIN exit into follow-up emails runs alongside
// (connectionRules.isFollowUpLine); on a named exit every line is the one way on. The picker and a
// dropped step used to treat a line into emails as "not there" on every exit, so they reported
// taken bottom exits as free, added a second recovery flow beside the first, and let + Step on a
// line into emails turn it into a second routing line: a fan-out the item promises never happens.
const R = await import('./src/lib/connectionRules.ts');
const blueprint = id => clone(ECOM_BLUEPRINTS.find(b => b.id === id));

test('+ Step on a line into follow-up emails never fans an exit out', () => {
  const bp = blueprint('single-product-flash-drop');
  const between = { direction: 'between', edgeId: 'e-bp1-2' };
  const before = JSON.stringify(bp.edges);
  const rows = A.choicesFor(between, bp.nodes, bp.edges);
  for (const key of ['lead-form', 'upsell', 'landing-page', 'downsell']) {
    const row = [...rows.recommended, ...rows.other].find(r => r.key === key);
    assert.ok(row?.refusal, `${key} is offered on a line into emails while the page already leads on`);
    assert.match(row.refusal, /Product Showcase Landing Page already leads to/, key);
    assert.doesNotMatch(row.refusal, EM_DASH, key);
    assert.equal(A.planAdd(between, key, bp.nodes, bp.edges, 'z').ok, false, key);
  }
  const loose = D.makeStep('lead-form', { x: 0, y: 1400 }, 'loose');
  const drop = A.dropOnLine([...bp.nodes, loose], bp.edges, 'e-bp1-2', loose.id, 'z');
  assert.equal(drop.ok, false);
  assert.match(drop.reason, /already leads to/);
  assert.equal(JSON.stringify(bp.edges), before);
  assert.equal(A.routingLines(bp.nodes, bp.edges, 'bp1-page', null).length, 1);
  // Positive control: the same line with no routing line beside it still takes a step, and the
  // emails it pushes on stay a line that runs alongside.
  const alone = bp.edges.filter(e => e.id !== 'e-bp1-3');
  const ok = A.planAdd(between, 'lead-form', bp.nodes, alone, 'z');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(A.routingLines([...bp.nodes, ok.node], ok.edges, 'bp1-page', null).length, 1);
});

test('a named exit carries one line, whatever it leads to', () => {
  const bp = blueprint('turnkey-retention-ecosystem');
  const page = byId(bp.nodes, 'bp6-page');
  assert.deepEqual(A.routingLines(bp.nodes, bp.edges, 'bp6-page', 'abandon').map(e => e.id), ['e-bp6-3']);
  const abandon = A.exitOptions(page, bp.nodes, bp.edges).find(o => o.handle === 'abandon');
  assert.doesNotMatch(abandon.label, /free/);
  assert.match(abandon.label, /Left at checkout \(now goes to /);
  const req = { direction: 'next', anchorId: 'bp6-page', handle: 'abandon' };
  const rows = [...A.choicesFor(req, bp.nodes, bp.edges).recommended, ...A.choicesFor(req, bp.nodes, bp.edges).other];
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(row.refusal, `${row.key} would add a second line to Left at checkout`);
  const plan = A.planAdd(req, 'checkout-recovery', bp.nodes, bp.edges, 'z');
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /already leads to/);
  assert.doesNotMatch(plan.reason, EM_DASH);
  assert.doesNotMatch(A.exitNote(req, bp.nodes, bp.edges), /goes in between/, 'nothing can go in between here');
  // An upsell's Accepted answer already leads to the thank-you page: emails there would be a
  // second line, which #13 answers with Replace.
  const oto = blueprint('oto-upsell-funnel-system');
  const accepted = A.planAdd({ direction: 'next', anchorId: 'bp5-upsell', handle: 'accepted' }, 'follow-up', oto.nodes, oto.edges, 'z');
  assert.equal(accepted.ok, false);
  // Positive controls: on the MAIN exit emails still run alongside, and a free named exit connects.
  const main = A.planAdd({ direction: 'next', anchorId: 'bp5-page', handle: null }, 'follow-up', oto.nodes, oto.edges, 'z');
  assert.equal(main.ok, true, main.reason);
  assert.match(main.summary, /runs alongside the next step/);
  const rescue = A.planAdd({ direction: 'next', anchorId: 'bp5-upsell', handle: 'rescue' }, 'upsell-rescue', oto.nodes, oto.edges, 'z');
  assert.equal(rescue.ok, true, rescue.reason);
  // The lead form's main exit leads only into emails: it is free, and the label says the emails stay.
  const form = byId(MAP.nodes, 'node-form-1');
  const next = A.exitOptions(form, MAP.nodes, MAP.edges).find(o => o.handle === null);
  assert.match(next.label, /^Next step \(free, .+ runs alongside\)$/);
});

// An old map can fan an exit out: two routing lines from one exit. + Next refuses there and points
// to + Step on a line, and + Step puts the step on that line only. #13's checkConnection reads the
// line + Step puts back as a Replace of the other branch, so a plan is checked with checkPlan and
// committed as plan.edges, never through a Replace's existing lines.
const withFanOut = () => {
  const bp = clone(MAP);
  const extra = D.makeStep('thank-you', { x: 1800, y: 900 }, 'fan');
  bp.nodes.push(extra);
  bp.edges.push(A.makeLine('node-page-1', null, extra.id, null, extra.data, 'fan'));
  return { ...bp, id: 'default+fan-out', fanLine: bp.edges[bp.edges.length - 1].id };
};

test('+ Step on one line of an old fan-out keeps the other line', () => {
  const bp = withFanOut();
  const before = JSON.stringify(bp.edges);
  assert.equal(A.routingLines(bp.nodes, bp.edges, 'node-page-1', null).length, 2);
  const next = A.planAdd({ direction: 'next', anchorId: 'node-page-1', handle: null }, 'lead-form', bp.nodes, bp.edges, 'z');
  assert.equal(next.ok, false);
  assert.match(next.reason, /use \+ Step instead/);

  const between = { direction: 'between', edgeId: 'edge-page-form' };
  assert.equal(A.exitNote(between, bp.nodes, bp.edges),
    'Lead Capture Lander leads to 2 steps from this exit. The new step goes on this line only, and the other line stays.');
  for (const key of ['lead-form', 'upsell', 'landing-page']) {
    const plan = A.planAdd(between, key, bp.nodes, bp.edges, 'z');
    assert.equal(plan.ok, true, `${key}: ${plan.reason}`);
    assert.deepEqual(plan.removed, ['edge-page-form']);
    assert.ok(plan.edges.some(e => e.id === bp.fanLine), `${key} kept the other branch`);
    const all = [...bp.nodes, plan.node];
    assert.equal(A.routingLines(all, plan.edges, 'node-page-1', null).length, 2, `${key}: the fan-out is kept, not widened`);
    // Why the check is checkPlan: line by line, #13 calls the line into the new step a Replace of
    // the other branch, and a Replace commit would delete it.
    const raw = R.checkConnection(plan.added[0], all, bp.edges.filter(e => e.id !== 'edge-page-form'));
    assert.equal(raw.kind, 'replace');
    assert.deepEqual(raw.existing.map(e => e.id), [bp.fanLine]);
    assert.ok(!R.withConnection(plan.edges.filter(e => e.id !== plan.added[0].id), plan.added[0], raw.existing).some(e => e.id === bp.fanLine));
    assert.deepEqual(A.checkPlan(plan, bp.nodes, bp.edges), { ok: true, keptFanOut: [bp.fanLine] });
  }
  // A loose step dropped on the same line follows the same rule.
  const loose = D.makeStep('lead-form', { x: 0, y: 1600 }, 'loose');
  const drop = A.dropOnLine([...bp.nodes, loose], bp.edges, 'edge-page-form', loose.id, 'z');
  assert.equal(drop.ok, true, drop.reason);
  assert.deepEqual(A.checkPlan(drop, [...bp.nodes, loose], bp.edges), { ok: true, keptFanOut: [bp.fanLine] });
  // + Step on the fan-out line itself is the same edit from the other side.
  const other = A.planAdd({ direction: 'between', edgeId: bp.fanLine }, 'lead-form', bp.nodes, bp.edges, 'z');
  assert.deepEqual(A.checkPlan(other, bp.nodes, bp.edges), { ok: true, keptFanOut: ['edge-page-form'] });
  assert.equal(JSON.stringify(bp.edges), before, 'inputs are not mutated');
});

test('checkPlan refuses a plan that would fan an exit out', () => {
  // A hand-built plan that adds a second routing line to an exit that had one: the exact edit the
  // picker never makes. checkPlan must say no rather than read it as a kept fan-out.
  const ns = nodes();
  const es = edges();
  const extra = D.makeStep('thank-you', { x: 1800, y: 900 }, 'x');
  const line = A.makeLine('node-page-1', null, extra.id, null, extra.data, 'x');
  const plan = { ok: true, node: extra, edges: [...es, line], added: [line], removed: [], summary: '' };
  const verdict = A.checkPlan(plan, ns, es);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.message, 'Lead Capture Lander would lead to more than one step from this exit.');
  // A #13 refusal comes back as it is.
  const into = A.makeLine('node-form-1', null, 'node-ad-1', null, {}, 'y');
  const refused = A.checkPlan({ ok: true, edges: [...es, into], added: [into], removed: [], summary: '' }, ns, es);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Nothing can lead into it/);
  assert.deepEqual(A.checkPlan({ ok: false, reason: 'No.' }, ns, es), { ok: false, message: 'No.' });
});

test('every plan passes checkPlan and never fans an exit out', () => {
  const mismatches = [];
  const replaces = [];
  for (const bp of [clone(MAP), withFanOut(), ...ECOM_BLUEPRINTS.map(b => clone(b))]) {
    const requests = [];
    for (const n of bp.nodes) {
      for (const p of A.STEP_PORTS[n.type].exits) requests.push({ direction: 'next', anchorId: n.id, handle: p.handle });
      requests.push({ direction: 'before', anchorId: n.id });
    }
    for (const e of bp.edges) requests.push({ direction: 'between', edgeId: e.id });
    const exits = bp.nodes.flatMap(n => A.STEP_PORTS[n.type].exits.map(p => [n.id, p.handle]));
    for (const req of requests) {
      for (const choice of A.STEP_CHOICES) {
        const plan = A.planAdd(req, choice.key, bp.nodes, bp.edges, 'z');
        if (!plan.ok) continue;
        const tag = `${bp.id ?? 'default'} ${JSON.stringify(req)} ${choice.key}`;
        const check = A.checkPlan(plan, bp.nodes, bp.edges);
        if (!check.ok) mismatches.push(`${tag}: ${check.message}`);
        else if (check.keptFanOut.length) replaces.push(tag);
        const all = [...bp.nodes, plan.node];
        for (const [id, handle] of exits) {
          const was = A.routingLines(all, bp.edges, id, handle).length;
          const now = A.routingLines(all, plan.edges, id, handle).length;
          if (now > Math.max(1, was)) mismatches.push(`${tag}: ${id}/${handle ?? 'main'} ${was} -> ${now}`);
        }
      }
    }
  }
  assert.deepEqual(mismatches, []);
  // Only the fan-out fixture ever needs a kept fan-out, and only for + Step on its two lines.
  assert.ok(replaces.length > 0, 'the fan-out fixture is exercised');
  for (const tag of replaces) assert.match(tag, /^default\+fan-out \{"direction":"between","edgeId":"(edge-page-form|e-node-page-1-main-node-thank-you-fan-fan)"\}/, tag);
});

test('the thank-you code field shows no invented code', () => {
  const src = fs.readFileSync('src/components/drawers/ThankYouEditor.tsx', 'utf8');
  assert.ok(!src.includes("bounceBackDiscountCode || 'VIPRETURN'}\n                  onChange"), 'code input value');
  assert.ok(!src.includes("bounceBackDiscountText || '$15 Off Next Order'}"), 'perk input value');
  assert.match(src, /value=\{data\.bounceBackDiscountCode \|\| ''\}\s*placeholder="No code"/);
});

test('the thank-you editor shows only what the step holds', () => {
  // A new step's badge, guide title, store and community text are '' (stepDefaults). Every input
  // used to fall back to invented copy, so a person saw text that is not in the data and will not
  // publish, and clearing a field brought it back. Placeholders name what publishes when empty.
  const src = fs.readFileSync('src/components/drawers/ThankYouEditor.tsx', 'utf8');
  for (const field of ['badgeText', 'headline', 'subhead', 'usageGuideTitle', 'storeReturnText', 'storeReturnUrl', 'communityInviteText', 'communityInviteUrl', 'bounceBackDiscountText']) {
    assert.match(src, new RegExp(`value=\\{data\\.${field} \\|\\| ''\\}\\s*placeholder=(?:"[^"]+"|\\{.+\\})`), field);
  }
  for (const bad of ['VIP Member Privilege', 'Quick Start Onboarding', 'Complimentary Formulations', 'Private VIP Customer Community',
    'VIP Allocation', 'bioactive', 'VIPRETURN', '$15 Off', 'Best-Sellers']) {
    assert.ok(!src.includes(bad), bad);
  }
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, ''), EM_DASH);
});

// The Live Customer View used to show a store button on every step and a community button with
// text alone, while the published page shows each only with its link. thankYouView is the preview's
// one source; here it is laid beside the real renderer. The renderer reads thankYouHeadline,
// thankYouSubhead and thankYouBadge off the published record, so the fixture carries the step's
// headline, subhead and badge under those names too (see the report: publish must map them).
const { renderPublicThankYouHtml } = await import('./server/routes/publicRoutes.mjs');
const published = (data, storeDomain = '') => {
  const html = renderPublicThankYouHtml({
    data: { ...data, thankYouHeadline: data.headline, thankYouSubhead: data.subhead, thankYouBadge: data.badgeText, thankYou: data },
    shopifyConfig: { storeDomain, status: storeDomain ? 'connected' : 'disconnected' }
  }, { query: {}, headers: {} }, {});
  const body = html.slice(html.indexOf('<body>'));
  const text = re => (body.match(re) || [])[1] ?? null;
  return {
    badge: text(/<div class="vip-pill">([^<]*)<\/div>/) ?? '',
    headline: text(/<h1>([^<]*)<\/h1>/),
    // No subhead paragraph reads as '' (R17: a blank subhead publishes no line).
    subhead: text(/<p class="subhead">([^<]*)<\/p>/) ?? '',
    voucher: body.includes('class="card voucher-card"') ? text(/id="jv-code-val">([^<]*)</) : null,
    guideSteps: [...body.matchAll(/<div class="step-num">\d+<\/div>\s*<div[^>]*>([^<]*)<\/div>/g)].map(m => m[1]),
    store: body.includes('class="btn-primary"') ? { url: text(/<a href="([^"]*)"[^>]*class="btn-primary">/), text: text(/class="btn-primary">([^<]*)</) } : null,
    community: body.includes('class="btn-secondary"') ? { url: text(/<a href="([^"]*)"[^>]*class="btn-secondary">/), text: text(/class="btn-secondary">([^<]*)</) } : null
  };
};

test('the Live Customer View shows what the published thank-you page shows', () => {
  const fresh = D.newStepData('thank-you', 's');
  const cases = [
    ['new step', fresh, ''],
    ['new step, store connected', fresh, 'shop.example.com'],
    ['community text alone', { ...fresh, communityInviteText: 'Join us' }, ''],
    ['community link', { ...fresh, communityInviteText: 'Join us', communityInviteUrl: 'https://example.com/c' }, ''],
    ['community link, no text', { ...fresh, communityInviteUrl: 'https://example.com/c' }, ''],
    ['store link and text', { ...fresh, storeReturnUrl: 'https://example.com/shop', storeReturnText: 'Shop again' }, 'shop.example.com'],
    ['written copy', { ...fresh, headline: 'Welcome aboard', subhead: 'We sent the details.', badgeText: 'Member' }, ''],
    ['code and guide', { ...fresh, bounceBackDiscountCode: 'BACK10', bounceBackDiscountText: 'Next order', usageGuideTitle: 'Start', usageGuideSteps: ['Open it', '', 'Use it'] }, ''],
    ['guide lines but blank', { ...fresh, usageGuideTitle: 'Start', usageGuideSteps: ['', ''] }, ''],
    // R19: an instruction saved as the subhead is never published; the page shows its own line.
    ['stored instruction', { ...fresh, subhead: 'Tell your customer what happens next.' }, '']
  ];
  for (const [name, data, domain] of cases) {
    const view = D.thankYouView(data, domain);
    const live = published(data, domain);
    assert.equal(view.badge, live.badge, `${name}: badge`);
    assert.equal(view.headline, live.headline, `${name}: headline`);
    assert.equal(view.subhead, live.subhead, `${name}: subhead`);
    assert.equal(view.voucher?.code ?? null, live.voucher, `${name}: voucher`);
    assert.deepEqual(view.guide?.steps ?? [], live.guideSteps, `${name}: guide`);
    assert.deepEqual(view.store, live.store, `${name}: store button`);
    assert.deepEqual(view.community, live.community, `${name}: community button`);
  }
  // The reviewer's case: a new step shows no subhead line (R17) and no button at all.
  const view = D.thankYouView(fresh, '');
  assert.equal(view.subhead, '');
  assert.equal(view.store, null);
  assert.equal(view.community, null);

  const src = fs.readFileSync('src/components/drawers/ThankYouEditor.tsx', 'utf8');
  const preview = src.slice(src.indexOf('LIVE INTERACTIVE PREVIEW TAB'));
  assert.match(src, /thankYouView\(data, storeDomain\)/);
  for (const raw of ['data.headline', 'data.subhead', 'data.badgeText', 'data.storeReturnText', 'data.communityInviteText', "'Back to the store'", "'Open the link'"]) {
    assert.ok(!preview.includes(raw), `the preview reads ${raw} itself instead of thankYouView`);
  }
});

// Test Lead Flow (C50) showed "No subhead yet" for a new thank-you step while the published page
// showed "Your order is confirmed." It now shows the live page's lines, laid beside the real
// renderer here, and names the ones the page fills with its default. Since R17 only the headline
// has one: a blank subhead publishes no line, so the walk's "No subhead yet" is the truth again.
test('Test Lead Flow shows the thank-you lines the published page shows', () => {
  const fresh = D.newStepData('thank-you', 's');
  const cases = [
    ['new step', fresh, []],
    ['headline cleared', { ...fresh, headline: '' }, ['headline']],
    ['fields missing', { type: 'thank-you' }, ['headline']],
    ['written copy', { ...fresh, headline: 'Welcome aboard', subhead: 'We sent the details.' }, []],
    // A blank line is no line (ownCopy), so the page shows no subhead paragraph at all.
    ['blank written subhead', { ...fresh, subhead: '   ' }, []],
    ['stored instruction', { ...fresh, subhead: 'Tell your customer what happens next.' }, []]
  ];
  for (const [name, data, defaults] of cases) {
    const lines = D.thankYouWalkLines(data);
    const live = published(data);
    assert.equal(lines.headline, live.headline.trim(), `${name}: headline`);
    assert.equal(lines.subhead, live.subhead.trim(), `${name}: subhead`);
    assert.deepEqual(lines.defaults, defaults, `${name}: defaults named`);
  }
  assert.equal(D.thankYouWalkLines(fresh).subhead, '');

  const src = fs.readFileSync('src/components/preview/LiveFunnelModal.tsx', 'utf8');
  const walk = src.slice(src.indexOf("case 'thank-you': {"), src.indexOf('default:', src.indexOf("case 'thank-you': {")));
  assert.match(walk, /thankYouWalkLines\(d\)/);
  assert.ok(!walk.includes('d.subhead') && !walk.includes('d.headline'), 'the walk reads the lines itself instead of thankYouWalkLines');
  assert.match(walk, /The live page shows its default \{lines\.defaults\.join\(' and '\)\} here\. Write your own in the step\./);
  assert.doesNotMatch(walk, EM_DASH);
});

// R17: the thank-you step ends lead-only journeys too (the lead-magnet blueprint: ad, page,
// sequence, thank-you), and a blank subhead published "Your order is confirmed." there, a claim
// about an order nobody placed, which Test Lead Flow then repeated as the page's default line.
// A blank subhead now publishes no line, the preview and the walk agree, and nothing on the page
// or in the walk invents a confirmation.
test('a blank thank-you subhead publishes no line and claims no order', () => {
  const render = data => renderPublicThankYouHtml({ data, shopifyConfig: {} }, { query: {}, headers: {} }, {});
  const leadStep = {
    ...D.newStepData('thank-you', 's'),
    headline: 'Your Guide is On Its Way To Your Inbox', subhead: '', usageGuideSteps: [], storeReturnUrl: ''
  };
  for (const [name, data] of [
    ['step subhead blank', { thankYou: leadStep }],
    ['step subhead whitespace', { thankYou: { ...leadStep, subhead: '  \n ' } }],
    ['legacy record, no subhead anywhere', { thankYouHeadline: 'Thanks' }],
    ['new step as added', { thankYou: D.newStepData('thank-you', 's') }]
  ]) {
    const html = render(data);
    const body = html.slice(html.indexOf('<body>'));
    assert.doesNotMatch(body, /order is confirmed|your order|purchase is confirmed/i, `${name}: no invented order claim`);
    assert.doesNotMatch(body, /<p class="subhead">/, `${name}: no subhead paragraph, not even an empty one`);
  }
  assert.equal(D.thankYouView(leadStep).subhead, '');
  const lines = D.thankYouWalkLines(leadStep);
  assert.deepEqual(lines, { headline: 'Your Guide is On Its Way To Your Inbox', subhead: '', defaults: [] });
  // Written copy still ships, and the older top-level field still renders when the step has none.
  assert.match(render({ thankYou: { ...leadStep, subhead: 'Check your inbox.' } }), /<p class="subhead">Check your inbox\.<\/p>/);
  assert.match(render({ thankYouSubhead: 'Old line' }), /<p class="subhead">Old line<\/p>/);
  // No shared source keeps the stock line as a fallback.
  for (const f of ['src/lib/stepDefaults.ts', 'server/routes/publicRoutes.mjs']) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes("'Your order is confirmed.'"), `${f} still carries the stock order line`);
  }
});

// Publish keeps the thank-you step under d.thankYou (journeyRoutes.mjs landingData), so the live
// page must read it there. The older top-level fields still render when the step carries none.
test('the published thank-you page reads the step the editor wrote', () => {
  const render = data => renderPublicThankYouHtml({ data, shopifyConfig: {} }, { query: {}, headers: {} }, {});
  const step = {
    headline: 'Welcome aboard', subhead: 'We sent the details.', badgeText: 'Member',
    bounceBackDiscountCode: 'BACK10', usageGuideTitle: 'Start', usageGuideSteps: ['Open it'],
    storeReturnUrl: 'https://example.com/shop', storeReturnText: 'Shop again'
  };
  const html = render({ thankYou: step });
  for (const text of ['<h1>Welcome aboard</h1>', 'We sent the details.', 'Member', 'BACK10', 'Open it', 'https://example.com/shop', 'Shop again']) {
    assert.ok(html.includes(text), `the live page shows ${text}`);
  }
  const legacy = render({ thankYouHeadline: 'Old headline', bounceBackDiscountCode: 'OLD5' });
  assert.ok(legacy.includes('<h1>Old headline</h1>'));
  assert.ok(legacy.includes('OLD5'));
  // A field the step cleared stays cleared rather than falling back to a stale top-level copy.
  assert.ok(!render({ thankYou: { bounceBackDiscountCode: '' }, bounceBackDiscountCode: 'OLD5' }).includes('OLD5'));
});

// ---- C47, the export half: Export Assets fed each new step to funnelExportGenerators.ts, which
// turned every empty field back into copy ("VIPRETURN", "$15 Off", "Limited Intake", "$37", three
// stock emails with "2 slots remaining"). These run every generator over what Add Step makes and
// read what a visitor or the person's email tool would see.
const G = await import('./src/lib/funnelExportGenerators.ts');
const EXPORT_INVENTED = [
  ...INVENTED, 'Limited Intake', 'slots remaining', '$37', '$67', '$19', 'Save 40', 'Save 50', '256-bit', 'never shared',
  'Stop Leaking', 'Stop losing leads', 'Best-Sellers', 'concierge', 'emailed to you', 'Proven 3-step', 'Get Started Free',
  'Upgrade Pass', 'Starter Toolkit', 'Exclusive Offer', 'Official Confirmation', 'case study', '40%'
];
/** What a visitor reads: the page with its styles, scripts and tags taken out. */
const visibleText = html => html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');
const newStepExports = () => {
  const n = t => D.newStepData(t, 's');
  const recovery = A.STEP_CHOICES.filter(c => c.patch && c.patch.steps).map(c => D.makeStep('follow-up-sequence', { x: 0, y: 0 }, 's', c.patch).data);
  const downsell = D.makeStep('upsell', { x: 0, y: 0 }, 's', { offerType: 'downsell' }).data;
  return {
    'landing page': visibleText(G.generateLandingPageHtml({ pageNode: n('landing-page'), formNode: n('lead-form') })),
    'landing page, every field emptied': visibleText(G.generateLandingPageHtml({ pageNode: { ...n('landing-page'), headline: '', subhead: '', bullets: [], buttonText: '' } })),
    'landing page, variant B': visibleText(G.generateLandingPageHtml({ pageNode: { ...n('landing-page'), variantB: { headline: '' } }, variantOverride: 'b' })),
    'thank-you page': visibleText(G.generateThankYouHtml({ thankYouNode: n('thank-you') })),
    'thank-you page, store connected': visibleText(G.generateThankYouHtml({ thankYouNode: n('thank-you'), storeDomain: 'shop.example.com' })),
    'upsell page': visibleText(G.generateUpsellHtml({ upsellNode: n('upsell'), thankYouNode: n('thank-you') })),
    'downsell page': visibleText(G.generateUpsellHtml({ upsellNode: downsell, thankYouNode: n('thank-you') })),
    'split router': visibleText(G.generateSplitRouterHtml({ splitNode: n('ab-split') })),
    'email sequence': G.generateEmailSequenceText({ sequenceNode: n('follow-up-sequence') }),
    'email sequence, all emails deleted': G.generateEmailSequenceText({ sequenceNode: { ...n('follow-up-sequence'), steps: [] } }),
    ...Object.fromEntries(recovery.map((r, i) => [`recovery sequence ${i + 1}`, G.generateEmailSequenceText({ sequenceNode: r })])),
    'ad copy': G.generateAdCopyText({ adNode: n('ad-source') }),
    'ad copy, every field emptied': G.generateAdCopyText({ adNode: { ...n('ad-source'), headline: '', body: '' } })
  };
};

test('an export of a new step carries no invented copy', () => {
  const exports = newStepExports();
  assert.ok(exports['recovery sequence 2'], 'both recovery presets are exported');
  for (const [name, text] of Object.entries(exports)) {
    for (const bad of EXPORT_INVENTED) assert.ok(!text.includes(bad), `${name} exports "${bad}"`);
    assert.doesNotMatch(text, EM_DASH, `${name} carries an em dash`);
  }
  // Empty reads as the published page reads it, and an empty sequence says so instead of exporting emails.
  assert.match(exports['landing page, every field emptied'], /\bOffer\b/);
  assert.match(exports['landing page, every field emptied'], /Continue/);
  assert.match(exports['email sequence, all emails deleted'], /no emails yet/);
  assert.doesNotMatch(exports['email sequence, all emails deleted'], /SUBJECT:/);
  assert.doesNotMatch(exports['ad copy'], /HOOK ANGLE/);
  assert.match(exports['ad copy, every field emptied'], /No headline written yet/);
  // U04: no invented button text or campaign tag; an empty tag leaves utm_campaign out and says so.
  assert.match(exports['ad copy'], /CALL TO ACTION \(CTA\):\n\(No button text written yet\)/);
  assert.doesNotMatch(exports['ad copy'], /Learn More|utm_campaign|lead_intake|brand_conversion|founder_story/);
  assert.match(exports['ad copy'], /No campaign tag is set on this ad step/);
  const tagged = G.generateAdCopyText({ adNode: { ...D.newStepData('ad-source', 's'), ctaText: 'Book now', utmCampaign: 'spring-calls' } });
  assert.equal((tagged.match(/&utm_campaign=spring-calls\b/g) || []).length, 3);
  assert.doesNotMatch(tagged, /hook_angle_1|customer_journey_builder|problem_agitation/);
  assert.match(tagged, /CALL TO ACTION \(CTA\):\nBook now/);
  assert.doesNotMatch(tagged, /No campaign tag/);
  // What the person wrote still ships.
  const written = visibleText(G.generateLandingPageHtml({ pageNode: { ...D.newStepData('landing-page', 's'), trustBadge: 'Family run', bullets: ['Ships Monday'] } }));
  assert.ok(written.includes('Family run') && written.includes('Ships Monday'));
  const upsell = visibleText(G.generateUpsellHtml({ upsellNode: { ...D.newStepData('upsell', 's'), productTitle: 'Refill', productPrice: '$12', regularPrice: '$16', discountPercentage: 25, benefits: ['Same formula'] } }));
  for (const text of ['Refill', '$12', '$16', 'Save 25%', 'Same formula']) assert.ok(upsell.includes(text), `the upsell export drops ${text}`);
  assert.match(G.generateAdCopyText({ adNode: { ...D.newStepData('ad-source', 's'), hook: 'Tired of guessing?' } }), /HOOK ANGLE:\n"Tired of guessing\?"/);
});

// R19, the parts outside this lane: an export, Test Lead Flow and the ad preview read the raw
// fields, so a journey saved before R19 exported and walked its instructions as copy, and the
// starter ad's empty body showed AdEditor's own pitch. Those files now read ownCopy, and these
// tests fail on a regression.
const OLD_PAGE = { ...D.newStepData('landing-page', 's'), headline: 'Book a free call', subhead: 'Describe what the visitor gets.', bullets: ['First point you can stand behind', 'Second point you can stand behind'] };
const INSTRUCTION = /describe (what|the)|stand behind|tell your customer|new value point/i;

test('an export of a journey saved before R19 leaves its instructions out', () => {
  const upsell = { ...D.newStepData('upsell', 's'), headline: 'H', subhead: 'Describe the add-on in words you can stand behind.', benefits: ['First point you can stand behind'] };
  const withB = { ...OLD_PAGE, subhead: 'Mine', bullets: ['Ships Monday'], abTestingEnabled: true, variantB: { subhead: 'Describe what the visitor gets.', bullets: ['New value point'] } };
  const out = {
    landing: G.generateLandingPageHtml({ pageNode: OLD_PAGE }),
    'variant B, static': G.generateLandingPageHtml({ pageNode: withB, variantOverride: 'b' }),
    'variant B, in-page swap': G.generateLandingPageHtml({ pageNode: withB }),
    upsell: G.generateUpsellHtml({ upsellNode: upsell }),
    ad: G.generateAdCopyText({ adNode: { ...D.newStepData('ad-source', 's'), body: 'Describe the offer in words you can stand behind.' } })
  };
  for (const [name, text] of Object.entries(out)) assert.doesNotMatch(text, INSTRUCTION, `${name} exports an instruction`);
  // Variant B falls back to A's own copy, as the published page does, and an empty body says so.
  assert.ok(visibleText(out['variant B, static']).includes('Mine') && out['variant B, static'].includes('Ships Monday'));
  assert.match(out.ad, /No ad copy written yet/);
});

test('Test Lead Flow and the ad preview show no instruction or pitch as copy', () => {
  const walk = fs.readFileSync('src/components/preview/LiveFunnelModal.tsx', 'utf8');
  for (const raw of ['str(d.body)', 'str(d.subhead)', 'list(d.bullets)', 'list(d.benefits)']) assert.ok(!walk.includes(raw), `the walk reads ${raw} raw`);
  const ad = fs.readFileSync('src/components/drawers/AdEditor.tsx', 'utf8');
  assert.doesNotMatch(ad, /data\.body \|\|/, 'the ad preview falls back to its own copy');
  for (const pitch of ['Are you leaking 40%', 'Zero code required', 'in one view']) assert.ok(!ad.includes(pitch), `the ad preview carries "${pitch}"`);
});

// The exported thank-you page is read like the live one: thankYouView's parts, nothing else.
const exportedThankYou = (data, storeDomain = '') => {
  const html = G.generateThankYouHtml({ thankYouNode: data, storeDomain });
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>')));
  const text = re => (body.match(re) || [])[1] ?? null;
  return {
    badge: text(/<span class="badge">([^<]*)<\/span>/) ?? '',
    headline: text(/<h1>([^<]*)<\/h1>/),
    // No subhead paragraph reads as '' (R17: a blank subhead publishes no line).
    subhead: text(/<p class="subhead">([^<]*)<\/p>/) ?? '',
    voucher: text(/id="voucherCode">([^<]*)</),
    guideSteps: [...body.matchAll(/<span class="step-num"[^>]*>\d+<\/span>\s*<span>([^<]*)<\/span>/g)].map(m => m[1]),
    store: body.includes('class="btn-primary"') ? { url: text(/<a href="([^"]*)" class="btn-primary">/), text: text(/class="btn-primary">([^<]*)</) } : null,
    community: body.includes('class="btn-secondary"') ? { url: text(/<a href="([^"]*)" class="btn-secondary">/), text: text(/class="btn-secondary">([^<]*)</) } : null
  };
};

test('the exported thank-you page shows what the published one shows', () => {
  const fresh = D.newStepData('thank-you', 's');
  const cases = [
    ['new step', fresh, ''],
    ['new step, store connected', fresh, 'shop.example.com'],
    ['community text alone', { ...fresh, communityInviteText: 'Join us' }, ''],
    ['community link', { ...fresh, communityInviteText: 'Join us', communityInviteUrl: 'https://example.com/c' }, ''],
    ['store link and text', { ...fresh, storeReturnUrl: 'https://example.com/shop', storeReturnText: 'Shop again' }, 'shop.example.com'],
    ['written copy', { ...fresh, headline: 'Welcome aboard', subhead: 'We sent the details.', badgeText: 'Member' }, ''],
    ['code and guide', { ...fresh, bounceBackDiscountCode: 'BACK10', bounceBackDiscountText: 'Next order', usageGuideTitle: 'Start', usageGuideSteps: ['Open it', '', 'Use it'] }, ''],
    ['guide lines but blank', { ...fresh, usageGuideTitle: 'Start', usageGuideSteps: ['', ''] }, ''],
    // R19: an instruction saved as the subhead is never published; the page shows its own line.
    ['stored instruction', { ...fresh, subhead: 'Tell your customer what happens next.' }, '']
  ];
  for (const [name, data, domain] of cases) {
    const out = exportedThankYou(data, domain);
    const live = published(data, domain);
    for (const part of ['badge', 'headline', 'subhead', 'voucher', 'guideSteps', 'store', 'community']) {
      assert.deepEqual(out[part], live[part], `${name}: ${part}`);
    }
  }
});

test('the picker is a labelled modal on the shared dialog stack', () => {
  const src = fs.readFileSync('src/components/canvas/StepPicker.tsx', 'utf8');
  assert.match(src, /<dialog[\s\S]*className="jv-step-picker"[\s\S]*aria-labelledby=/);
  assert.match(src, /useDialogFocus/);
  assert.match(src, /showModal\(\)/);
  assert.match(src, /aria-label="Search steps"/);
  assert.match(src, /aria-label="Close"/);
  assert.match(src, /No steps match\./);
  assert.match(src, /aria-disabled=\{row\.refusal \? 'true' : undefined\}/);
  assert.match(src, /repeat\(auto-fill, minmax\(220px, 1fr\)\)/);
  for (const [, px] of src.matchAll(/fontSize: '(\d+)px'/g)) assert.ok(Number(px) >= 11, `${px}px`);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), EM_DASH);
});

// ---- Wiring: the w3-spine-2 integration lane wired #12 into the canvas after #13 and #8.
const read = p => fs.readFileSync(p, 'utf8');

test('wiring: App places steps with makeStep and slotForNewStep', () => {
  const src = read('src/App.tsx');
  assert.ok(!src.includes('(project.nodes.length * 280) % 1200'));
  assert.match(src, /makeStep\(/);
  assert.match(src, /slotForNewStep\(/);
});

test('wiring: JourneyCanvas opens the picker and builds lines with makeLine', () => {
  const src = read('src/components/canvas/JourneyCanvas.tsx');
  assert.match(src, /onConnectEnd=/);
  assert.match(src, /<StepAddSlot nodeId=\{props\.id\} \/>/);
  assert.match(src, /data-step-add=\{nodeId\}/);
  // #13 builds every new line in commitConnection, which handleConnect and the replace dialog call.
  const start = src.indexOf('const commitConnection');
  assert.ok(start > 0, 'JourneyCanvas has no commitConnection');
  assert.match(src.slice(start, src.indexOf('const handleConnect', start)), /makeLine\(/);
});

test('wiring: a selected line offers + Step', () => {
  assert.match(read('src/components/canvas/edges/ConversionEdge.tsx'), /Add a step on this line/);
});

test('wiring: the cards stop inventing figures', () => {
  const upsell = read('src/components/canvas/nodes/UpsellNode.tsx');
  for (const bad of ['Bioactive Triple Barrier Reserve', "'$38.00'", "'SAVE 40%'"]) assert.ok(!upsell.includes(bad), bad);
  const thanks = read('src/components/canvas/nodes/ThankYouNode.tsx');
  for (const bad of ["'VIPRETURN'", "'$15 off next order'", "'VIP Portal'", '|| 3']) assert.ok(!thanks.includes(bad), bad);
});

// ---- C22: a new upsell used to arrive with urgencyMinutes 5, so it published a 05:00 countdown
// nobody set, and the editor's field turned 0 or an empty box back into 5, so no one could remove it.
test('a new upsell starts with no countdown, on the card, the live page and the export', async () => {
  const up = D.newStepData('upsell', 's');
  assert.ok(!('urgencyMinutes' in up), 'a new upsell carries urgencyMinutes');
  const { renderPublicUpsellHtml } = await import('./server/routes/publicRoutes.mjs');
  const live = renderPublicUpsellHtml({ slug: 'offer', data: { upsell: up }, shopifyConfig: {} }, { query: {}, headers: {}, params: {} }, {});
  assert.doesNotMatch(live, /This offer timer runs for/);
  const { generateUpsellHtml } = await import('./src/lib/funnelExportGenerators.ts');
  assert.doesNotMatch(generateUpsellHtml({ upsellNode: up }), /id="jvTimer"/);
  // A timer the person did set still ships.
  assert.match(generateUpsellHtml({ upsellNode: { ...up, urgencyMinutes: 10 } }), /id="jvTimer">10:00/);
});

test('the countdown field can be emptied, and 0 turns it off', () => {
  const cases = [['', undefined], [' ', undefined], ['0', undefined], ['-3', undefined], ['abc', undefined],
    ['1', 1], ['5', 5], ['7.9', 7], ['60', 60], ['61', 60]];
  for (const [raw, want] of cases) assert.equal(D.timerMinutesFromInput(raw), want, JSON.stringify(raw));
  const editor = read('src/components/drawers/UpsellEditor.tsx');
  const field = editor.slice(editor.indexOf("fid('urgency-minutes')"), editor.indexOf('/>', editor.indexOf("id={fid('urgency-minutes')}")));
  assert.match(field, /Countdown timer \(optional, minutes\)/);
  assert.match(field, /value=\{data\.urgencyMinutes \|\| ''\}/);
  assert.match(field, /timerMinutesFromInput\(e\.target\.value\)/);
  assert.doesNotMatch(field, /\|\|\s*5/);
});

// The editor's Live Customer Mockup printed "Order #9812 Reserved ... expires in 04:59" on every
// upsell, timer or not, and the position switcher wrote a made-up headline and prices into the step.
test('the editor mockup shows the countdown the step has, and nothing the person did not write', () => {
  const editor = read('src/components/drawers/UpsellEditor.tsx');
  const mock = editor.slice(editor.indexOf('/* Live Mockup View */'));
  for (const bad of ['04:59', '9812', 'SAVE 40%', "'$38.00'", 'Bioactive Triple', 'SPECIAL VIP ALLOCATION', 'benefits.slice']) {
    assert.ok(!mock.includes(bad), `mockup still carries ${bad}`);
  }
  assert.match(mock, /\{\(data\.urgencyMinutes \?\? 0\) > 0 && \(/);
  assert.match(mock, /This offer timer runs for \{String\(data\.urgencyMinutes\)\.padStart\(2, '0'\)\}:00\./);
  for (const pos of ['upsell', 'downsell']) {
    const at = editor.indexOf(`offerType: '${pos}'`);
    const call = editor.slice(at, editor.indexOf('});', at));
    assert.doesNotMatch(call, /headline|badgeText|productPrice|regularPrice/, `${pos} switch writes offer copy`);
  }
});

// R19: the upsell editor showed three skincare claims as saved value points whenever the list was
// empty (editing one saved all three), and Add Point wrote "Exclusive one-time VIP savings not
// available in store." A new upsell now starts with no points, so the editor must not fill them in.
test('the upsell editor adds and shows only value points the person wrote', () => {
  const src = fs.readFileSync('src/components/drawers/UpsellEditor.tsx', 'utf8');
  for (const bad of ['cellular renewal', 'cosmetic formulation', 'expedited priority shipping', 'Exclusive one-time VIP savings']) {
    assert.ok(!src.includes(bad), `UpsellEditor still writes "${bad}"`);
  }
  assert.match(src, /const benefits = Array\.isArray\(data\.benefits\) \? data\.benefits : \[\];/);
  assert.match(src, /handleFieldChange\('benefits', \[\.\.\.benefits, ''\]\)/);
  assert.match(src, /aria-label=\{`Value point \$\{idx \+ 1\}`\}[\s\S]{0,160}placeholder="A point you can stand behind"/);
  assert.match(src, /No value points yet\./);
});

// R20: a new upsell arrived with the headline 'Your offer headline', so its card read like the
// offer's own words instead of saying none was written, and the live page put it in the <h1>.
test('a new upsell has no headline: the card says so, Check design asks for one, the page shows no placeholder', async () => {
  const downsellPatch = A.STEP_CHOICES.find(c => c.key === 'downsell').patch;
  for (const [name, data] of [['upsell', D.newStepData('upsell', 's')], ['downsell', D.makeStep('upsell', { x: 0, y: 0 }, 's', downsellPatch).data]]) {
    assert.equal(data.headline, '', `a new ${name} carries a headline`);
    const { checkJourneyDesign } = await import('./src/lib/designChecks.ts');
    const issue = checkJourneyDesign({ nodes: [{ id: 'u', type: 'upsell', position: { x: 0, y: 0 }, data }], edges: [] })
      .issues.find(i => i.check === 'page-headline' && i.nodeId === 'u');
    assert.equal(issue?.message, 'Add a headline.', `${name}: Check design does not ask for a headline`);
    const { renderPublicUpsellHtml } = await import('./server/routes/publicRoutes.mjs');
    const live = renderPublicUpsellHtml({ slug: 'offer', data: { upsell: data }, shopifyConfig: {} }, { query: {}, headers: {}, params: {} }, {});
    assert.doesNotMatch(live, /Your offer headline/i, `${name}: the live page shows the placeholder`);
    assert.match(live, /<h1>Another offer<\/h1>/, `${name}: the live page's own fallback`);
  }
  // The card draws its own empty state for an empty headline, and the editor hints without an offer.
  assert.match(read('src/components/canvas/nodes/UpsellNode.tsx'), /\{d\.headline \|\| 'No headline yet'\}/);
  const editor = read('src/components/drawers/UpsellEditor.tsx');
  assert.match(editor, /id=\{fid\('headline'\)\}[\s\S]{0,200}placeholder="Write the headline for this offer"/);
  assert.ok(!editor.includes('3-Pack Replenishment'), 'the headline hint still names an invented offer');
});

// R20, the product pick: with a new upsell's headline empty, picking a product from the store fell
// through to "Special Allocation: <title> with VIP Savings", an invented offer that published and
// silenced Check design's 'Add a headline.'. The pick writes no headline text of its own, and it
// replaces the yes button only while that holds no words the person wrote.
test('picking a product keeps the headline and the yes button the person wrote', () => {
  const editor = read('src/components/drawers/UpsellEditor.tsx');
  const at = editor.indexOf('const handleProductPicked');
  const handler = editor.slice(at, editor.indexOf('\n  };', at));
  assert.ok(at > 0 && handler.length > 0, 'handleProductPicked not found');
  const code = handler.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const bad of ['VIP Savings', 'Special Allocation', 'Wait! Try']) assert.ok(!code.includes(bad), `the pick still writes "${bad}"`);
  assert.match(code, /headline: data\.headline\s*\n/);
  assert.doesNotMatch(code, /headline: data\.headline \|\|/);
  assert.match(code, /acceptButtonText: buttonIsOurs \? `⚡ Yes, Add \$\{product\.title\} to My Order` : data\.acceptButtonText/);
  // The button rule, run on the editor's own pattern and the new-step default.
  const picked = new RegExp(editor.match(/const PICKED_BUTTON = \/(.+)\/;/)[1]);
  const def = D.newStepData('upsell', 's').acceptButtonText;
  assert.match(code, new RegExp(`buttonText === '${def}'`), 'the pick no longer knows the new-step default');
  const ours = text => !text.trim() || text.trim() === def || picked.test(text.trim());
  for (const t of ['', '  ', def, '⚡ Yes, Add Real Store Serum to My Order']) assert.ok(ours(t), JSON.stringify(t));
  for (const t of ['Add it for $12', 'Yes please', '⚡ Yes, Add it']) assert.ok(!ours(t), JSON.stringify(t));
});

// U04: the starter map and a new step still stored words nobody wrote as their values: the starter
// page's headline 'Your offer headline', the starter ad's button "Claim Your Offer" and campaign tag
// "lead-gen-spring", a new ad's 'Your ad headline', "Learn More" and "promo-blast", a new page's
// "Claim Offer", and a new follow-up's "Write this subject" drafts. The editors read those as the
// field's own value rather than a hint, and the landing card drew "Clean single-offer landing page."
// for a page with no subheadline. New content starts empty, and Check design asks for what is empty.
const U04_INVENTED = ['Your offer headline', 'Your ad headline', 'Your offer', 'Claim Your Offer', 'Claim Offer', 'Learn More',
  'lead-gen-spring', 'promo-blast', 'Write this subject', 'Replace this', 'before anyone receives it'];

test('U04: the starter map and a new ad, page or follow-up hold no invented copy, campaign tag or instruction', async () => {
  const { isPlaceholderText } = await import('./src/lib/designChecks.ts');
  const strings = (v, out = []) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(x => strings(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
    return out;
  };
  const values = {
    'the starter map': strings({ ...MAP, nodes: MAP.nodes.map(n => n.data) }),
    ...Object.fromEntries(['ad-source', 'landing-page', 'follow-up-sequence'].map(t => [`a new ${t}`, strings(D.newStepData(t, 's'))]))
  };
  for (const [where, list] of Object.entries(values)) {
    for (const v of list) {
      for (const bad of U04_INVENTED) assert.ok(!v.toLowerCase().includes(bad.toLowerCase()), `${where} holds "${v}"`);
      assert.ok(!isPlaceholderText(v) && !D.isStarterText(v), `${where} holds the placeholder "${v}"`);
    }
  }
  const ad = byId(MAP.nodes, 'node-ad-1').data;
  const page = byId(MAP.nodes, 'node-page-1').data;
  assert.equal(MAP.offerHeadline, '');
  for (const field of ['headline', 'body', 'ctaText', 'utmCampaign']) assert.equal(ad[field], '', `starter ad ${field}`);
  assert.equal(page.headline, '');
  const newAd = D.newStepData('ad-source', 's');
  for (const field of ['headline', 'body', 'ctaText', 'utmCampaign']) assert.equal(newAd[field], '', `new ad ${field}`);
  const newPage = D.newStepData('landing-page', 's');
  assert.equal(newPage.headline, '');
  // A page's button is a step, not a pitch: the same neutral word the starter page uses.
  assert.equal(newPage.buttonText, page.buttonText);
  assert.equal(newPage.buttonText, 'Continue');
  // The editors carry the hint the value used to stand in for.
  assert.match(read('src/components/drawers/AdEditor.tsx'), /id=\{fid\('cta-text'\)\}[\s\S]{0,200}placeholder="[^"]+"/);
  assert.match(read('src/components/drawers/AdEditor.tsx'), /id=\{fid\('utm-campaign'\)\}[\s\S]{0,200}placeholder="[^"]+"/);
});

test('U04: Check design lists what a fresh starter map and a new ad, page or follow-up leave empty', async () => {
  const { checkJourneyDesign } = await import('./src/lib/designChecks.ts');
  const rows = checkJourneyDesign(MAP).issues.map(i => [i.nodeId, i.field, i.message]);
  assert.deepEqual(rows.filter(r => r[0] === 'node-ad-1'), [
    ['node-ad-1', 'headline', 'Add an ad headline.'],
    ['node-ad-1', 'ctaText', 'Add the ad button text.'],
    ['node-ad-1', 'utmCampaign', 'Add a campaign tag so visits from this ad can be counted.']
  ]);
  assert.deepEqual(rows.filter(r => r[0] === 'node-page-1'), [['node-page-1', 'headline', 'Add a headline.']]);
  assert.deepEqual(rows.filter(r => r[0] === 'node-seq-1').map(r => r[2]), [1, 2, 3].map(i => `Email ${i} has no preview text or message yet.`));
  const step = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: D.newStepData(type, 's') });
  const fresh = checkJourneyDesign({
    nodes: [step('a', 'ad-source'), step('p', 'landing-page'), step('q', 'follow-up-sequence')],
    edges: [{ id: 'e1', source: 'a', target: 'p' }, { id: 'e2', source: 'p', target: 'q' }]
  }).issues.map(i => [i.nodeId, i.field, i.message]);
  assert.ok(fresh.some(r => r[0] === 'a' && r[1] === 'headline' && r[2] === 'Add an ad headline.'), JSON.stringify(fresh));
  assert.ok(fresh.some(r => r[0] === 'a' && r[1] === 'ctaText' && r[2] === 'Add the ad button text.'), JSON.stringify(fresh));
  assert.ok(fresh.some(r => r[0] === 'a' && r[1] === 'utmCampaign'), JSON.stringify(fresh));
  assert.ok(fresh.some(r => r[0] === 'p' && r[1] === 'headline' && r[2] === 'Add a headline.'), JSON.stringify(fresh));
  assert.ok(fresh.some(r => r[0] === 'q' && r[1] === 'steps.0' && r[2] === 'Email 1 has no subject line, preview text or message yet.'), JSON.stringify(fresh));
  // Nothing on a new step reads as a draft left standing in for words.
  assert.ok(!fresh.some(r => /placeholder|draft instructions|starter text/.test(r[2])), JSON.stringify(fresh));
});

test('U04: the landing card says a headline or subheadline is missing instead of inventing one', () => {
  const card = read('src/components/canvas/nodes/PageNode.tsx');
  for (const invented of ['Clean single-offer landing page.', "'Offer Page'"]) assert.ok(!card.includes(invented), `the card still draws ${invented}`);
  assert.match(card, /\{\(d\.headline \|\| ''\)\.trim\(\) \|\| 'No headline yet'\}/);
  assert.match(card, /\{\(d\.subhead \|\| ''\)\.trim\(\) \|\| 'No subheadline yet'\}/);
  // The subheadline's empty state is drawn in the card's muted grey, like its written subheadline.
  assert.match(card, /color: '#94A3B8'[^}]*\}\}>\s*\{\(d\.subhead/);
});
