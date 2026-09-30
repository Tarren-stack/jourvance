import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Attribution page drew a fixed six-row funnel that had nothing to do with the journey on the
// map. src/lib/leakFinder.ts now orders the journey's own steps along its path, compares each step
// with the steps that lead into it, and names the biggest measured drop.

const {
  MIN_LEAK_BASE, buildJourneyFunnel, biggestLeakIndex, leakSummary, isFunnelLink,
  readFunnelAnswer, funnelStatsRequest, funnelStats, timeframeDays, unavailableReason, stepKindLabel, STEP_UNIT
} = await import('./src/lib/leakFinder.ts');
const { edgeKind } = await import('./src/lib/edgeKinds.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const node = (id, type, x, y = 0, data = {}) => ({ id, type, position: { x, y }, data: { type, label: id, ...data } });
const edge = (id, source, target, sourceHandle, data) => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(data ? { data } : {}) });

/** Stats whose every edge sends the source step's whole count, unless a branch share is given. */
function statsFor(counts, edges, shares = {}) {
  const steps = Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c && typeof c === 'object' ? c : { count: c }]));
  const edgeStats = Object.fromEntries(edges.map(e => {
    const sourceThroughput = shares[e.id] ?? (steps[e.source]?.count ?? 0);
    return [e.id, { sourceThroughput, targetCount: steps[e.target]?.count ?? 0, rate: 0 }];
  }));
  return { steps, edges: edgeStats };
}

const ids = funnel => funnel.rows.map(r => r.nodeId);

test('the default journey is listed in path order with its own labels and depths', () => {
  const { nodes, edges } = DEFAULT_LEAD_CAPTURE_PROJECT;
  const funnel = buildJourneyFunnel(nodes, edges, statsFor({ 'node-ad-1': 1200, 'node-page-1': 1000, 'node-form-1': 40, 'node-seq-1': 30 }, edges));
  assert.deepEqual(ids(funnel), ['node-ad-1', 'node-page-1', 'node-form-1', 'node-seq-1']);
  assert.deepEqual(funnel.rows.map(r => r.depth), [0, 1, 2, 3]);
  assert.deepEqual(funnel.rows.map(r => r.label), ['Meta Ad Campaign', 'Lead Capture Lander', 'Client Intake Form', 'Nurture & Booking Flow']);
  assert.deepEqual(funnel.rows.map(r => r.unit), ['ad visits', 'visitors', 'forms sent', 'enrolled']);
  assert.equal(funnel.rows[0].base, null, 'the first step has nothing before it');
});

test('bp5: the downsell is only reached by a declined line, so it is not a row', () => {
  const bp5 = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id === 'bp5-downsell'));
  const counts = { 'bp5-ad': 1100, 'bp5-page': 1000, 'bp5-upsell': 50, 'bp5-downsell': 40, 'bp5-ty': 90 };
  const funnel = buildJourneyFunnel(bp5.nodes, bp5.edges, statsFor(counts, bp5.edges));
  assert.deepEqual(ids(funnel), ['bp5-ad', 'bp5-page', 'bp5-upsell', 'bp5-ty']);
  const ty = funnel.rows.find(r => r.nodeId === 'bp5-ty');
  assert.deepEqual(ty.fromIds, ['bp5-upsell']);
  assert.equal(ty.base, 50);
  assert.equal(ty.conversion, 1.8);
  assert.equal(ty.drop, 0);
  assert.equal(ty.lost, 0);
  assert.notEqual(funnel.rows[funnel.leakIndex]?.nodeId, 'bp5-ty');
});

test('bp6: the rescue and cart-recovery sequences and their retention lines are left out', () => {
  const bp6 = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.id === 'bp6-upsell-rescue'));
  const counts = Object.fromEntries(bp6.nodes.map(n => [n.id, 100]));
  const funnel = buildJourneyFunnel(bp6.nodes, bp6.edges, statsFor(counts, bp6.edges));
  assert.deepEqual(ids(funnel), ['bp6-ad', 'bp6-page', 'bp6-upsell', 'bp6-ty']);
  const ty = funnel.rows.find(r => r.nodeId === 'bp6-ty');
  assert.deepEqual(ty.fromIds, ['bp6-upsell'], 'the rescue line into the thank-you page is not a parent');
  const byId = Object.fromEntries(bp6.nodes.map(n => [n.id, n]));
  for (const e of bp6.edges.filter(e => e.data?.isRetentionEdge)) {
    assert.equal(isFunnelLink(e, byId[e.target], byId[e.source]), false, e.id);
  }
});

test('isFunnelLink agrees with edgeKind for every handle case', () => {
  const page = { data: { type: 'landing-page' } };
  const cases = [
    [undefined, page, true], [null, page, true], ['accepted', page, true], ['branch-a', page, true], ['branch-b', page, true],
    ['declined', page, false], ['abandon', page, false], ['rescue', page, false],
    [undefined, { data: { sequenceType: 'at_risk_winback' } }, false],
    [undefined, { data: { isRetentionBranch: true } }, false],
    ['accepted', { data: { isRetentionBranch: true } }, false]
  ];
  for (const [handle, target, expected] of cases) {
    const kind = edgeKind(handle, target.data);
    assert.equal(isFunnelLink({ id: 'e', source: 's', target: 't', sourceHandle: handle }, target), expected, `${handle} -> ${kind}`);
    if (expected) assert.ok(['main', 'accepted', 'split-a', 'split-b'].includes(kind));
  }
  assert.equal(isFunnelLink({ id: 'e', source: 's', target: 't', data: { isRetentionEdge: true } }, page), false);
});

test('a split branch is compared with its own share, not with the whole split', () => {
  const nodes = [node('ad', 'ad-source', 0), node('split', 'ab-split', 100), node('pageA', 'landing-page', 200, 0), node('pageB', 'landing-page', 200, 200)];
  const edges = [edge('e0', 'ad', 'split'), edge('ea', 'split', 'pageA', 'branch-a'), edge('eb', 'split', 'pageB', 'branch-b')];
  const funnel = buildJourneyFunnel(nodes, edges, statsFor({ ad: 100, split: 100, pageA: 45, pageB: 10 }, edges, { ea: 50, eb: 50 }));
  const a = funnel.rows.find(r => r.nodeId === 'pageA');
  const b = funnel.rows.find(r => r.nodeId === 'pageB');
  assert.equal(a.base, 50);
  assert.ok(Math.abs(a.drop - 0.1) < 1e-9);
  assert.ok(Math.abs(b.drop - 0.8) < 1e-9);
  assert.deepEqual(a.fromIds, ['split']);
  assert.equal(funnel.rows[funnel.leakIndex].nodeId, 'pageB');
  assert.equal(funnel.rows.find(r => r.nodeId === 'split').drop, 0, 'the split row is compared with its own parent only');
  assert.ok(!funnel.rows.some(r => r.drop === 0.5));
});

const chain = (counts) => {
  const nodes = [node('page', 'landing-page', 0), node('form', 'lead-form', 100), node('seq', 'follow-up-sequence', 200)];
  const edges = [edge('e1', 'page', 'form'), edge('e2', 'form', 'seq')];
  return buildJourneyFunnel(nodes, edges, statsFor(counts, edges));
};

test('the biggest drop over enough people is the leak', () => {
  const funnel = chain({ page: 1000, form: 40, seq: 30 });
  const form = funnel.rows[funnel.leakIndex];
  assert.equal(form.nodeId, 'form');
  assert.ok(Math.abs(form.drop - 0.96) < 1e-9);
  assert.equal(form.lost, 960);
});

test('equal drops go to more people lost, then to the earlier row', () => {
  const row = (nodeId, base, count) => ({ nodeId, base, count, conversion: count / base, drop: 1 - count / base, lost: base - count });
  assert.equal(biggestLeakIndex([row('a', 100, 50), row('b', 400, 200)]), 1);
  assert.equal(biggestLeakIndex([row('a', 100, 50), row('b', 100, 50)]), 0);
});

test('too few people is not a leak, and the summary says so', () => {
  const funnel = chain({ page: 3, form: 0, seq: 0 });
  assert.equal(funnel.leakIndex, -1);
  const summary = leakSummary(funnel.rows, funnel.leakIndex);
  assert.equal(summary.nodeId, null);
  assert.match(summary.sentence, /^Too few people so far to name a leak\. It needs at least 20 at the step before\.$/);
  assert.equal(MIN_LEAK_BASE, 20);
});

test('more people than the step before sent is never a leak', () => {
  const funnel = chain({ page: 100, form: 150, seq: 10 });
  const form = funnel.rows.find(r => r.nodeId === 'form');
  assert.equal(form.drop, 0);
  assert.equal(form.lost, 0);
  assert.equal(funnel.rows[funnel.leakIndex].nodeId, 'seq');
});

test('an unmeasured step reads null, and so does the comparison that needs it', () => {
  const { nodes, edges } = DEFAULT_LEAD_CAPTURE_PROJECT;
  const funnel = buildJourneyFunnel(nodes, edges, statsFor({
    'node-ad-1': { count: null, why: 'no_campaign' }, 'node-page-1': 1000, 'node-form-1': 40, 'node-seq-1': 30
  }, edges));
  const [ad, page] = funnel.rows;
  assert.equal(ad.count, null);
  assert.equal(ad.why, 'no_campaign');
  assert.equal(page.base, null);
  assert.equal(page.conversion, null);
  assert.equal(page.drop, null);
  assert.notEqual(funnel.leakIndex, 0);
  assert.notEqual(funnel.leakIndex, 1);
  assert.equal(funnel.rows[funnel.leakIndex].nodeId, 'node-form-1');
});

test('nothing measured means no data', () => {
  assert.equal(chain({ page: 0, form: { count: null, why: 'no_source' }, seq: 0 }).hasData, false);
  assert.equal(chain({ page: 1, form: 0, seq: 0 }).hasData, true);
});

test('a loop is walked once and ends', () => {
  const nodes = [node('E', 'ad-source', 0), node('A', 'landing-page', 100), node('B', 'lead-form', 200)];
  const edges = [edge('e1', 'E', 'A'), edge('e2', 'A', 'B'), edge('e3', 'B', 'A')];
  const funnel = buildJourneyFunnel(nodes, edges, statsFor({ E: 10, A: 10, B: 10 }, edges));
  assert.deepEqual(ids(funnel), ['E', 'A', 'B']);
  assert.deepEqual(funnel.rows[1].fromIds, ['E'], 'the line back from B is not a parent');
});

test('a step reached only by a declined line is not a row', () => {
  const nodes = [node('page', 'landing-page', 0), node('up', 'upsell', 100), node('down', 'upsell', 200, 0, { offerType: 'downsell' })];
  const edges = [edge('e1', 'page', 'up'), edge('e2', 'up', 'down', 'declined')];
  assert.deepEqual(ids(buildJourneyFunnel(nodes, edges, statsFor({ page: 1, up: 1, down: 1 }, edges))), ['page', 'up']);
  assert.equal(stepKindLabel(nodes[2]), 'Downsell');
  assert.equal(stepKindLabel(nodes[1]), 'Upsell');
});

const answerBody = (over = {}) => ({
  success: true, journeyId: 'j1', days: 30, from: 'a', to: 'b', partialSince: null,
  stats: { nodes: { a: { visitors: 1 } } }, coverage: { a: { measured: true } }, ...over
});

test('the server answer is read honestly', () => {
  const read = (a) => readFunnelAnswer(a, 'j1', 30);
  assert.deepEqual(read(null).kind, 'failed');
  assert.equal(read(null).retryable, true);
  assert.equal(read({ status: 401, body: {} }).kind, 'signed-out');
  assert.equal(read({ status: 403, body: {} }).kind, 'signed-out');
  const five = read({ status: 500, body: {} });
  assert.equal(five.kind, 'failed');
  assert.equal(five.retryable, true);
  const four = read({ status: 404, body: {} });
  assert.equal(four.kind, 'failed');
  assert.equal(four.retryable, false);
  assert.equal(read({ status: 200, body: { success: true, stats: { edges: {} } } }).kind, 'failed', 'no node stats');
  assert.equal(read({ status: 200, body: answerBody({ success: false }) }).kind, 'failed');
  assert.equal(read({ status: 200, body: answerBody({ journeyId: 'j2' }) }).kind, 'failed', 'another journey');
  assert.equal(read({ status: 200, body: answerBody({ days: 7 }) }).kind, 'failed', 'another range');
  const ok = read({ status: 200, body: answerBody() });
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.snapshot.nodes.a.visitors, 1);
  for (const a of [null, { status: 401 }, { status: 500 }, { status: 404 }, { status: 200, body: {} }]) {
    assert.match(read(a).message, /^Unavailable\./);
  }
});

test('the funnel counts come from the snapshot by the map\'s own rules', () => {
  const nodes = [
    node('ad', 'ad-source', 0), node('split', 'ab-split', 100), node('pageA', 'landing-page', 200), node('pageB', 'landing-page', 200, 200),
    node('up', 'upsell', 300), node('draft', 'landing-page', 400)
  ];
  const edges = [edge('e0', 'ad', 'split'), edge('ea', 'split', 'pageA', 'branch-a'), edge('eb', 'split', 'pageB', 'branch-b'), edge('eu', 'pageA', 'up')];
  const snapshot = {
    journeyId: 'j1', days: 30, from: '', to: '', partialSince: null,
    nodes: {
      ad: { clicks: null }, split: { branchAVisitors: 60, branchBVisitors: 40 },
      pageA: { visitors: 55 }, pageB: { visitors: 0 }, up: { views: 30, takes: 3 }, draft: { visitors: null }
    },
    coverage: {
      ad: { measured: false, why: 'no_campaign' }, split: { measured: true }, pageA: { measured: true },
      pageB: { measured: true }, up: { measured: true }, draft: { measured: false, why: 'not_published' }
    }
  };
  const stats = funnelStats(nodes, edges, snapshot);
  assert.deepEqual(stats.steps.ad, { count: null, why: 'no_campaign' });
  assert.deepEqual(stats.steps.split, { count: 100 });
  assert.deepEqual(stats.steps.pageB, { count: 0 });
  assert.deepEqual(stats.steps.up, { count: 3 }, 'an upsell counts offers taken');
  assert.deepEqual(stats.steps.draft, { count: null, why: 'not_published' });
  assert.equal(stats.edges.ea.sourceThroughput, 60);
  assert.equal(stats.edges.eb.sourceThroughput, 40);
  assert.equal(stats.edges.e0.sourceThroughput, null);
  assert.equal(stats.edges.eu.sourceThroughput, 55);
  const funnel = buildJourneyFunnel(nodes, edges, stats);
  assert.equal(funnel.rows.find(r => r.nodeId === 'pageB').drop, 1);
  assert.equal(funnel.rows.find(r => r.nodeId === 'split').base, null, 'the ad was not measured');
});

test('the request is the map\'s own request for the chosen range', () => {
  const nodes = [node('split', 'ab-split', 0, 0, { slug: 's', label: 'x', visitors: 500 }), node('a', 'landing-page', 1, 0, { slug: 'a' })];
  const body = funnelStatsRequest('j1', nodes, [edge('e1', 'split', 'a', 'branch-b'), edge('e2', 'a', 'split')], '7d');
  assert.equal(body.journeyId, 'j1');
  assert.equal(body.days, 7);
  assert.deepEqual(body.edges, [
    { id: 'e1', source: 'split', target: 'a', sourceHandle: 'branch-b' },
    { id: 'e2', source: 'a', target: 'split', sourceHandle: null }
  ], 'every edge carries its handle, null when it has none');
  assert.deepEqual(body.nodes[0], { id: 'split', type: 'ab-split', slug: 's', utmCampaign: '', offerType: '', spend: 0, jourvanceFlowId: '' });
  assert.equal(timeframeDays('7d'), 7);
  assert.equal(timeframeDays('30d'), 30);
  assert.equal(timeframeDays('all'), 90, 'all time reads as the longest range the map keeps');
  assert.equal(timeframeDays(undefined), 30);
});

test('the copy has no em dash, names both steps and formats counts', () => {
  const { nodes, edges } = DEFAULT_LEAD_CAPTURE_PROJECT;
  const funnel = buildJourneyFunnel(nodes, edges, statsFor({ 'node-ad-1': 1200, 'node-page-1': 1000, 'node-form-1': 40, 'node-seq-1': 30 }, edges));
  const summary = leakSummary(funnel.rows, funnel.leakIndex);
  assert.equal(summary.nodeId, 'node-form-1');
  assert.equal(summary.sentence, 'The biggest drop is between Lead Capture Lander (1,000 visitors) and Client Intake Form (40 forms sent). 96% did not go on.');
  assert.equal(summary.buttonLabel, 'Show Client Intake Form on the map');
  const strings = [
    summary.sentence, summary.buttonLabel, leakSummary(chain({ page: 3, form: 0, seq: 0 }).rows, -1).sentence,
    ...['no_campaign', 'not_published', 'no_source', undefined].map(unavailableReason),
    ...[null, { status: 401 }, { status: 500 }, { status: 404 }, { status: 200, body: {} }].map(a => readFunnelAnswer(a, 'j1', 30).message),
    ...Object.values(STEP_UNIT)
  ];
  for (const s of strings) {
    assert.ok(!s.includes('—') && !s.includes(' – '), s);
  }
  assert.equal(unavailableReason('no_campaign'), 'Add a UTM campaign to this ad to count its visits.');
  assert.equal(unavailableReason('not_published'), 'Publish this page to count its visits.');
  assert.equal(unavailableReason('no_source'), 'Connect a published page before this step.');
  assert.equal(unavailableReason('whatever'), 'This step cannot be measured.');
});

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('the Attribution page renders the leak finder in place of the fixed funnel', () => {
  const src = read('./src/components/analytics/AttributionReports.tsx');
  assert.ok(!src.includes('report?.funnelSteps.map'));
  assert.ok(!src.includes('Funnel Velocity'));
  assert.match(src, /<JourneyLeakFinder[^>]*timeframe=\{timeframe\}/s);
  assert.ok(src.includes('minmax(min(360px, 100%), 1fr)'));
});

test('the leak finder card uses inline styles, keeps focus rings and has no em dash', () => {
  const src = read('./src/components/analytics/JourneyLeakFinder.tsx');
  assert.ok(!src.includes('className='));
  assert.ok(!src.includes("outline: 'none'"));
  assert.ok(!src.includes('—'));
  assert.ok(!/transition|animation/.test(src));
});

// App.tsx wires these three props. If w3-spine-2 routes the choice through selectStep, the
// pattern below already accepts it.
test('App hands the Attribution view the journey and a way back to the map', () => {
  const src = read('./src/App.tsx');
  const el = src.slice(src.indexOf('<AttributionReports'), src.indexOf('/>', src.indexOf('<AttributionReports')));
  assert.ok(el.includes('journeyId={project.id}'));
  assert.ok(el.includes('edges={project.edges}'));
  assert.match(el, /onSelectStep=\{[^]*(setSelectedNodeId|selectStep)[^]*setActiveView\('canvas'\)/);
});
