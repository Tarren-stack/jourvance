// Store checks (#10). src/lib/funnelAuditor.ts scored every journey as a store and invented what
// it could not know: a monthly "margin at risk", conversion lifts in percent, and fixes that wrote
// product names, prices, an image and a promise onto the person's page. It now scores only with a
// connected store, and each fix is a FixPlan that adds structure with placeholder words only.
// auditor.test.mjs and forecaster.test.mjs test private copies of the old logic and never import
// these modules, so they are not coverage. This file is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auditor = await import('./src/lib/funnelAuditor.ts');
const { auditFunnel, storeScoreFor, isStoreConnected, planAuditFix } = auditor;
const { checkJourneyDesign, applyFixPlan, revertFixPlan, COPY_FIELDS } = await import('./src/lib/designChecks.ts');
const { lineIsDrawable, nodeLookup } = await import('./src/lib/journeyGraph.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const clone = v => JSON.parse(JSON.stringify(v));
const project = map => ({ id: 'p', name: 'P', businessType: '', offerHeadline: '', goal: '', updatedAt: '2026-01-01T00:00:00.000Z', ...clone(map) });
const bp = n => project(ECOM_BLUEPRINTS.find(b => b.nodes.some(x => x.id === `bp${n}-ad`)));
const STORE = { shopifyConfig: { status: 'connected', storeDomain: 'x.myshopify.com' } };
const items = report => report.pillars.flatMap(p => p.items);
const item = (report, id) => items(report).find(i => i.id === id);
const keys = issues => issues.map(i => i.key).sort();

test('the auditor module loads under node', () => {
  assert.equal(typeof auditFunnel, 'function');
  assert.equal(typeof planAuditFix, 'function');
});

test('the store score exists only with a connected store, and invents no figures', () => {
  const p = bp(1);
  assert.equal(storeScoreFor(p, null), null);
  assert.equal(storeScoreFor(p, undefined), null);
  assert.equal(storeScoreFor(p, { shopifyConfig: { status: 'disconnected' } }), null);
  assert.equal(isStoreConnected({ shopifyConfig: { status: 'error' } }), false);
  const report = storeScoreFor(p, STORE);
  assert.equal(typeof report.overallScore, 'number');
  assert.ok(!('estimatedMarginAtRisk' in report));
  for (const i of items(report)) {
    assert.ok(!('conversionImpact' in i), i.id);
    assert.ok(!('autoFixLabel' in i), i.id);
    assert.doesNotMatch(i.summary, /\d%|—|✦/, i.id);
  }
  assert.doesNotMatch(`${report.headline} ${report.subhead}`, /—/);
});

test('order bump and trust rows only open the step; fixes are offered only where they fit', () => {
  const report = storeScoreFor(bp(1), STORE);
  for (const id of ['order_bump_configured', 'trust_badge_guarantee']) {
    const row = item(report, id);
    assert.equal(row.autoFixType, undefined, id);
    assert.equal(row.targetNodeId, 'bp1-page', id);
    assert.equal(planAuditFix(bp(1), row), null, id);
  }

  // An upsell with no price is the person's to finish: no new upsell, the row opens that one.
  const unpriced = bp(5);
  for (const n of unpriced.nodes) if (n.type === 'upsell') n.data.productPrice = '';
  const upsellRow = item(auditFunnel(unpriced, STORE), 'post_purchase_upsell');
  assert.equal(upsellRow.autoFixType, undefined);
  assert.equal(upsellRow.targetNodeId, 'bp5-upsell');

  const noPage = project(DEFAULT_LEAD_CAPTURE_PROJECT);
  noPage.nodes = noPage.nodes.filter(n => n.type !== 'landing-page');
  assert.equal(item(auditFunnel(noPage, STORE), 'cart_recovery_flow').autoFixType, undefined);

  assert.equal(item(auditFunnel(bp(1), STORE), 'upsell_rescue_flow').autoFixType, undefined, 'no upsell');
  const rescueUsed = bp(5);
  rescueUsed.nodes.push({ id: 'seq', type: 'follow-up-sequence', position: { x: 0, y: 0 }, data: { type: 'follow-up-sequence', label: 'Notes' } });
  rescueUsed.edges.push({ id: 'e-r', source: 'bp5-upsell', sourceHandle: 'rescue', target: 'seq', targetHandle: 'retention-in' });
  assert.equal(item(auditFunnel(rescueUsed, STORE), 'upsell_rescue_flow').autoFixType, undefined, 'rescue exit used');
  assert.equal(item(auditFunnel(bp(5), STORE), 'upsell_rescue_flow').autoFixType, 'sync_upsell_rescue');
});

test('the product price is shown only when one is configured', () => {
  const p = bp(1);
  const page = p.nodes.find(n => n.id === 'bp1-page');
  page.data.shopifyProductTitle = 'A product';
  page.data.shopifyProductPrice = '';
  assert.equal(item(auditFunnel(p, STORE), 'product_pricing_linked').summary, 'A product is linked.');
  page.data.shopifyProductPrice = '24.00';
  assert.equal(item(auditFunnel(p, STORE), 'product_pricing_linked').summary, 'A product is linked (24.00).');
});

test('Add an upsell inserts a placeholder upsell between the page and its next page', () => {
  const p = bp(1);
  const row = item(auditFunnel(p, STORE), 'post_purchase_upsell');
  assert.equal(row.autoFixType, 'add_upsell_node');
  const plan = planAuditFix(p, row);
  const added = plan.changes.filter(c => c.kind === 'add-node');
  assert.equal(added.length, 1);
  const upsell = added[0].node;
  assert.equal(upsell.type, 'upsell');
  for (const [field, value] of Object.entries(upsell.data)) {
    if (!COPY_FIELDS.has(field)) continue;
    assert.ok(
      value === '' || (Array.isArray(value) && value.length === 0) ||
      ['Your upsell headline', 'Yes, add it to my order', 'No thanks'].includes(value),
      `${field}: ${JSON.stringify(value)}`
    );
  }
  for (const gone of ['urgencyMinutes', 'discountPercentage', 'productImage', 'badgeText', 'regularPrice']) {
    assert.ok(!(gone in upsell.data), gone);
  }

  const removed = plan.changes.filter(c => c.kind === 'remove-edge').map(c => c.edge.id);
  assert.deepEqual(removed, ['e-bp1-3']);
  const lines = plan.changes.filter(c => c.kind === 'add-edge').map(c => c.edge);
  assert.deepEqual(lines.map(e => [e.source, e.sourceHandle || null, e.target]), [
    ['bp1-page', null, upsell.id],
    [upsell.id, 'accepted', 'bp1-ty'],
    [upsell.id, 'declined', 'bp1-ty']
  ]);
  plan.lines.forEach(l => assert.doesNotMatch(l, /—| – /));

  const after = applyFixPlan(p, plan);
  assert.equal(after.applied, true);
  assert.ok(after.project.edges.some(e => e.id === 'e-bp1-2'), 'page to sequence is kept');
  const byId = nodeLookup(after.project.nodes);
  for (const e of lines) assert.ok(lineIsDrawable(e, byId), e.id);
  // The fix adds only the upsell's own "write a headline" row; what the blueprint already raised
  // (a sample offer to check, for one) is not the fix's to change.
  const had = new Set(checkJourneyDesign(p).issues.map(i => `${i.check}|${i.nodeId}`));
  assert.deepEqual(
    checkJourneyDesign(after.project).issues.map(i => [i.check, i.nodeId]).filter(([c, n]) => !had.has(`${c}|${n}`)),
    [['page-headline', upsell.id]]
  );

  const back = revertFixPlan(after.project, plan);
  assert.equal(back.reverted, true);
  assert.deepEqual(back.project.edges, p.edges);
  assert.deepEqual(back.project.nodes, p.nodes);
  // With an upsell on the map, there is nothing to add.
  assert.equal(item(auditFunnel(after.project, STORE), 'post_purchase_upsell').autoFixType, undefined);
});

// Replaces edge-kinds.test.mjs "the auditor's upsell fix links from the page's own handle", a pin on
// source text that could only look for one literal. This drives the real plan.
test("the auditor's upsell fix links from the page's own handle, and every added line draws", () => {
  const p = bp(1);
  const plan = planAuditFix(p, item(auditFunnel(p, STORE), 'post_purchase_upsell'));
  const upsellId = plan.changes.find(c => c.kind === 'add-node').node.id;
  const toUpsell = plan.changes.find(c => c.kind === 'add-edge' && c.edge.source === 'bp1-page' && c.edge.target === upsellId);
  assert.ok(toUpsell);
  assert.ok(!toUpsell.edge.sourceHandle && !toUpsell.edge.data?.sourceHandle);
  const byId = nodeLookup(applyFixPlan(p, plan).project.nodes);
  for (const c of plan.changes) if (c.kind === 'add-edge') assert.ok(lineIsDrawable(c.edge, byId), c.edge.id);
});

test('recovery fixes add "Replace this" drafts with no code, and are undone with the forecast', () => {
  const p = bp(1);
  const before = keys(checkJourneyDesign(p).issues);
  const row = item(auditFunnel(p, STORE), 'cart_recovery_flow');
  assert.equal(row.autoFixType, 'sync_cart_recovery');
  const plan = planAuditFix(p, row);
  const nodes = plan.changes.filter(c => c.kind === 'add-node').map(c => c.node);
  assert.equal(nodes.length, 1);
  const seq = nodes[0].data;
  assert.ok(!('voucherCode' in seq));
  assert.ok(seq.steps.length > 0);
  for (const s of seq.steps) {
    assert.match(s.body, /Replace this/);
    assert.doesNotMatch(`${s.subject} ${s.previewText} ${s.body}`, /SAVE|\d%|✨/);
  }
  assert.doesNotMatch(`${seq.label} ${seq.sequenceTitle}`, /Companion|%/);
  const lines = plan.changes.filter(c => c.kind === 'add-edge').map(c => c.edge);
  assert.ok(lines.length > 0);
  assert.ok(!lines.some(e => e.source === nodes[0].id), 'no line out of a sequence');

  const after = applyFixPlan(p, plan);
  assert.equal(after.applied, true);
  assert.equal(after.project.forecast.cartRecoveryEnabled, true);
  // The drafts say "Replace this ... before anyone receives it", so Check design flags each one
  // (T10); nothing else changes.
  const afterKeys = keys(checkJourneyDesign(after.project).issues);
  const draftPrefix = `starter-text:${nodes[0].id}:`;
  assert.deepEqual(afterKeys.filter(k => !k.startsWith(draftPrefix)), before);
  for (let i = 0; i < seq.steps.length; i++) assert.ok(afterKeys.includes(`${draftPrefix}steps.${i}`), `letter ${i} is flagged as a draft`);
  const back = revertFixPlan(after.project, plan);
  assert.equal(back.reverted, true);
  assert.ok(!('forecast' in back.project), 'the missing forecast comes back missing');
  assert.deepEqual(back.project.nodes, p.nodes);
  assert.deepEqual(back.project.edges, p.edges);

  const five = bp(5);
  const rescue = planAuditFix(five, item(auditFunnel(five, STORE), 'upsell_rescue_flow'));
  const rescueSeq = rescue.changes.find(c => c.kind === 'add-node').node;
  assert.ok(!rescue.changes.some(c => c.kind === 'add-edge' && c.edge.source === rescueSeq.id));
  assert.ok(!('voucherCode' in rescueSeq.data));
  const applied = applyFixPlan(five, rescue).project;
  assert.equal(applied.forecast.upsellRescueEnabled, true);
  assert.ok(!checkJourneyDesign(applied).issues.some(i => i.nodeId === rescueSeq.id && i.check !== 'starter-text'), 'the new sequence is reached');
});

// C43: on the default lead journey (page, lead form, follow-up, no product) the upsell fix put a
// purchase upsell between the page and the sign-up form, and cart recovery was offered on a page
// with no checkout to leave.
test('a lead journey is offered no upsell and no cart recovery, and its plans are null', () => {
  const lead = project(DEFAULT_LEAD_CAPTURE_PROJECT);
  const report = storeScoreFor(lead, STORE);
  for (const id of ['post_purchase_upsell', 'cart_recovery_flow']) {
    const row = item(report, id);
    assert.equal(row.autoFixType, undefined, id);
  }
  // A stale row or a direct call still gets no plan.
  assert.equal(planAuditFix(lead, { id: 'post_purchase_upsell', autoFixType: 'add_upsell_node' }), null);
  assert.equal(planAuditFix(lead, { id: 'cart_recovery_flow', autoFixType: 'sync_cart_recovery' }), null);

  // A page that sells but leads to a lead form first still gets no upsell before sign-up.
  const gated = project(DEFAULT_LEAD_CAPTURE_PROJECT);
  const page = gated.nodes.find(n => n.type === 'landing-page');
  page.data.checkoutUrl = 'https://x.myshopify.com/cart/1:1';
  const gatedReport = auditFunnel(gated, STORE);
  assert.equal(item(gatedReport, 'post_purchase_upsell').autoFixType, undefined);
  assert.equal(planAuditFix(gated, { id: 'post_purchase_upsell', autoFixType: 'add_upsell_node' }), null);
  // It has a checkout, so people can leave one: cart recovery fits.
  assert.equal(item(gatedReport, 'cart_recovery_flow').autoFixType, 'sync_cart_recovery');
});

test('the recovery plan sentence reads correctly for one email and for several', () => {
  const five = bp(5);
  const rescue = planAuditFix(five, item(auditFunnel(five, STORE), 'upsell_rescue_flow'));
  const count = rescue.changes.find(c => c.kind === 'add-node').node.data.steps.length;
  assert.equal(count, 1);
  assert.equal(rescue.lines[0], 'Adds an upsell decline sequence with 1 draft email that says "Replace this" and no discount code.');

  const one = bp(1);
  const cart = planAuditFix(one, item(auditFunnel(one, STORE), 'cart_recovery_flow'));
  const n = cart.changes.find(c => c.kind === 'add-node').node.data.steps.length;
  assert.ok(n > 1);
  assert.equal(cart.lines[0], `Adds a cart recovery sequence with ${n} draft emails that say "Replace this" and no discount code.`);
});

test('the Forecaster writes drafts with no voucher even when placeholder drafts are not asked for (R12)', async () => {
  // The finished-copy default invented SAVE10, COMPLETE10, shipping and a held bag for any caller
  // that left placeholderCopy out. Drafts are the only copy now, with no line out of the sequence.
  const { injectRetentionFlows } = await import('./src/lib/funnelForecaster.ts');
  const p = bp(5);
  const page = p.nodes.find(n => n.data.type === 'landing-page');
  page.data.checkoutUrl = 'https://example.invalid/checkout';
  const own = injectRetentionFlows({ nodes: p.nodes, edges: p.edges, addCartRecovery: true, addUpsellRescue: true, cartRecoveryDiscount: 15, upsellRescueDiscount: 20 });
  assert.ok(own.addedNodes.length > 0);
  for (const node of own.addedNodes) {
    assert.equal(node.data.voucherCode, undefined);
    assert.doesNotMatch(JSON.stringify(node.data), /SAVE\d|COMPLETE10|15%|20%|complimentary|held for 24|courtesy bottle|✨/i);
    for (const step of node.data.steps) assert.equal(step.subject, 'Write this subject');
  }
  const added = new Set(own.addedNodes.map(n => n.id));
  assert.ok(own.addedEdges.every(e => added.has(e.target) && !added.has(e.source)), 'every added line leads INTO a sequence');
  assert.ok(!/SAVE\$\{|'COMPLETE10'|'SAVE10'/.test(fs.readFileSync('src/lib/funnelForecaster.ts', 'utf8')));
});

test('R12: Sync to Canvas offers no sequence on the default lead-capture journey', async () => {
  // It has a page that collects leads (no product, no checkout link) and no upsell. Sync to Canvas
  // added cart recovery on a checkout nobody can leave and upsell decline emails nothing led to.
  const { injectRetentionFlows, retentionFlowsThatFit } = await import('./src/lib/funnelForecaster.ts');
  const lead = project(DEFAULT_LEAD_CAPTURE_PROJECT);
  assert.deepEqual(retentionFlowsThatFit(lead.nodes, lead.edges), { cartRecovery: false, upsellRescue: false });
  assert.deepEqual(retentionFlowsThatFit(lead.nodes), { cartRecovery: false, upsellRescue: false });
  // Asked anyway, the injector adds no sequence that no step leads to.
  const r = injectRetentionFlows({ nodes: lead.nodes, edges: lead.edges, addUpsellRescue: true, placeholderCopy: true });
  assert.equal(r.addedNodes.length, 0);
  assert.equal(r.addedEdges.length, 0);

  // Positive control: a checkout link and an upsell make both fit, and a used exit makes each not.
  const page = lead.nodes.find(n => n.data.type === 'landing-page');
  page.data.checkoutUrl = 'https://example.invalid/checkout';
  lead.nodes.push({ id: 'u1', type: 'upsell', position: { x: 900, y: 180 }, data: { type: 'upsell', label: 'Upsell' } });
  assert.deepEqual(retentionFlowsThatFit(lead.nodes, lead.edges), { cartRecovery: true, upsellRescue: true });
  const used = [...lead.edges,
    { id: 'x1', source: page.id, sourceHandle: 'abandon', target: 'node-seq-1' },
    { id: 'x2', source: 'u1', sourceHandle: 'rescue', target: 'node-seq-1' }];
  assert.deepEqual(retentionFlowsThatFit(lead.nodes, used), { cartRecovery: false, upsellRescue: false });
});

test('R12: the Forecaster and the store checks agree on when a recovery sequence belongs', async () => {
  const { retentionFlowsThatFit } = await import('./src/lib/funnelForecaster.ts');
  const journeys = [project(DEFAULT_LEAD_CAPTURE_PROJECT), ...ECOM_BLUEPRINTS.map(b => project(b))];
  // Each blueprint again with its retention sequences and checkout details taken off, and again
  // with a checkout link, so both answers are exercised both ways.
  for (const j of journeys.slice()) {
    const bare = clone(j);
    const gone = new Set(bare.nodes.filter(n => n.type === 'follow-up-sequence' &&
      ['checkout_recovery', 'upsell_recovery'].includes(n.data.sequenceType)).map(n => n.id));
    bare.nodes = bare.nodes.filter(n => !gone.has(n.id) && !(n.type === 'follow-up-sequence' && /cart|checkout|rescue|second.?chance/i.test(n.data.sequenceTitle || n.data.label || '')));
    bare.edges = bare.edges.filter(e => bare.nodes.some(n => n.id === e.source) && bare.nodes.some(n => n.id === e.target));
    for (const n of bare.nodes) if (n.data.type === 'landing-page') {
      for (const k of ['shopifyProductPrice', 'shopifyProductTitle', 'shopifyProductId', 'shopifyVariantId', 'checkoutUrl']) delete n.data[k];
    }
    const sold = clone(bare);
    for (const n of sold.nodes) if (n.data.type === 'landing-page') n.data.checkoutUrl = 'https://example.invalid/checkout';
    journeys.push(bare, sold);
  }
  const seen = { cart: new Set(), rescue: new Set() };
  for (const j of journeys) {
    const fit = retentionFlowsThatFit(j.nodes, j.edges);
    const report = auditFunnel(j, STORE);
    assert.equal(item(report, 'cart_recovery_flow').autoFixType === 'sync_cart_recovery', fit.cartRecovery, j.name);
    assert.equal(item(report, 'upsell_rescue_flow').autoFixType === 'sync_upsell_rescue', fit.upsellRescue, j.name);
    const cartPlan = planAuditFix(j, { ...item(report, 'cart_recovery_flow'), autoFixType: 'sync_cart_recovery' });
    const rescuePlan = planAuditFix(j, { ...item(report, 'upsell_rescue_flow'), autoFixType: 'sync_upsell_rescue' });
    assert.equal(Boolean(cartPlan), fit.cartRecovery, `${j.name}: cart plan`);
    assert.equal(Boolean(rescuePlan), fit.upsellRescue, `${j.name}: rescue plan`);
    seen.cart.add(fit.cartRecovery);
    seen.rescue.add(fit.upsellRescue);
  }
  assert.equal(seen.cart.size, 2, 'cart recovery fits on some journeys and not others');
  assert.equal(seen.rescue.size, 2, 'upsell decline emails fit on some journeys and not others');
});

test('R12: the Forecaster drawer offers and syncs only the sequences that fit', () => {
  const src = fs.readFileSync('src/components/drawers/FinancialSimulatorDrawer.tsx', 'utf8');
  assert.match(src, /retentionFlowsThatFit\(nodes, edges\)/);
  assert.doesNotMatch(src, /addCartRecovery:\s*!extractedNodes/);
  assert.doesNotMatch(src, /addUpsellRescue:\s*!extractedNodes/);
  assert.match(src, /addCartRecovery:\s*retentionFit\.cartRecovery/);
  assert.match(src, /addUpsellRescue:\s*retentionFit\.upsellRescue/);
  assert.match(src, /\{fitCount > 0 && onSyncRetentionToCanvas &&/);
  assert.match(src, /onSyncRetentionToCanvas && retentionFit\.cartRecovery \?/);
  assert.match(src, /onSyncRetentionToCanvas && retentionFit\.upsellRescue \?/);
});

test('no invented copy or figures are left in the auditor source', () => {
  // 'trust_badge_guarantee' is the row's stable id, read by other code, not copy anyone sees.
  const src = fs.readFileSync('src/lib/funnelAuditor.ts', 'utf8').replaceAll('trust_badge_guarantee', '');
  assert.ok(!src.includes('—'));
  assert.ok(!src.includes('✦'));
  assert.doesNotMatch(src, /Elixir|Botanical|Illuminating|Ritual|Guarantee|unsplash/i);
  assert.doesNotMatch(src, /['"`][^'"`\n]*\d%[^'"`\n]*['"`]/);
  assert.ok(!src.includes('applyAuditFix'));
  assert.ok(!src.includes('estimatedMarginAtRisk'));
});

test('the publishing row passes only when the landing page is published, never for the store itself', () => {
  // A connected store is the precondition for every score shown, so a row that counted it
  // passed on every score anyone could see: 10 critical points and a "Passed" that checked nothing.
  const pageOnly = (data = {}) => project({
    nodes: [{ id: 'lp', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', ...data } }],
    edges: []
  });
  const unpublished = storeScoreFor({ ...pageOnly({ published: false }), shopifyStoreDomain: 'x.myshopify.com' }, STORE);
  const row = item(unpublished, 'domain_and_publishing');
  assert.equal(row.passed, false);
  assert.equal(row.points, 0);
  assert.equal(row.maxPoints, 10);
  assert.equal(row.title, 'Landing page published');
  assert.equal(row.summary, 'The landing page is not published yet.');
  assert.equal(unpublished.pillars.find(p => p.id === 'trust').score, 0);

  // A failing row still has somewhere to go: it opens the landing page.
  assert.equal(row.targetNodeId, 'lp');

  const passed = item(storeScoreFor(pageOnly({ published: true }), STORE), 'domain_and_publishing');
  assert.equal(passed.passed, true);
  assert.equal(passed.points, 10);
  assert.equal(passed.summary, 'The landing page is published.');

  // A verified custom domain is a DNS check, not a publish: it passes before any publish and
  // stays set after Unpublish, when the page is no longer on the web.
  for (const data of [
    { published: false, customDomain: 'offer.brand.com', customDomainVerified: true },
    { published: false, publishedUrl: '/p/x', customDomain: 'offer.brand.com', customDomainVerified: true },
    { customDomainVerified: true }
  ]) {
    const domainOnly = item(storeScoreFor(pageOnly(data), STORE), 'domain_and_publishing');
    assert.equal(domainOnly.passed, false, JSON.stringify(data));
    assert.equal(domainOnly.points, 0, JSON.stringify(data));
    assert.equal(domainOnly.summary, 'The landing page is not published yet.');
  }

  // No landing page at all: nothing is published.
  assert.equal(item(storeScoreFor(project({ nodes: [], edges: [] }), STORE), 'domain_and_publishing').passed, false);
});
