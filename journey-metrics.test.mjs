import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  countText, percentText, moneyText, rateOf, UNAVAILABLE,
  RANGE_DAYS, DEFAULT_RANGE_DAYS, normalizeRangeDays, rangeLabel, readStoredRange, writeStoredRange,
  readStatsAnswer, metricsView, metricsLoading, metricsFailed, statsRequestBody,
  nodeMeasure, measureValue, nodeNote, legendNote, stageTotal,
  edgeFigure, figureForEdge, buildCanvasMetrics, journeyTotals, retentionDelayText, leakAov, AD_FAN_OUT_NOTE,
  edgePillValue, edgeSentence
} from './src/lib/journeyMetrics.ts';
import { edgeMetricFor, edgeStatus, calculateRevenueLeakage, getStepOptimizationTips, MIN_GRADE_SAMPLE } from './src/lib/conversionBenchmarks.ts';

// Every figure on the journey map reads one stats snapshot for this journey and the chosen range.
// A figure nobody measured reads 'Unavailable', never 0, and a line is graded only when its rate
// was measured over enough visits. These tests pin the pure rules in src/lib/journeyMetrics.ts
// and the one place a line is named and graded (src/lib/conversionBenchmarks.ts).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const snapshot = (over = {}) => ({
  journeyId: 'j1',
  days: 30,
  from: '2026-08-29T00:00:00.000Z',
  to: '2026-09-28T00:00:00.000Z',
  partialSince: null,
  nodes: {},
  coverage: {},
  ...over
});
const ready = (snap) => ({ status: 'ready', days: snap.days, snapshot: snap });

// ── Text helpers and range ────────────────────────────────────────────────────

test('text helpers read Unavailable for an unmeasured figure and keep a measured zero', () => {
  assert.equal(UNAVAILABLE, 'Unavailable');
  assert.equal(countText(null), 'Unavailable');
  assert.equal(countText(0), '0');
  assert.equal(countText(1234), '1,234');
  assert.equal(percentText(null), 'Unavailable');
  assert.equal(percentText(12), '12.0%');
  assert.equal(moneyText(null), 'Unavailable');
  assert.equal(moneyText(1500), '$1,500');
  assert.equal(moneyText(12.5, 2), '$12.50');
  assert.equal(rateOf(5, 0), null);
  assert.equal(rateOf(null, 10), null);
  assert.equal(rateOf(5, null), null);
  assert.equal(rateOf(150, 100), 100);
  assert.equal(rateOf(1, 3), 33.3);
});

test('the range is 7, 30 or 90 days and falls back to 30', () => {
  assert.deepEqual(RANGE_DAYS, [7, 30, 90]);
  assert.equal(DEFAULT_RANGE_DAYS, 30);
  assert.equal(normalizeRangeDays(7), 7);
  assert.equal(normalizeRangeDays('30'), 30);
  assert.equal(normalizeRangeDays('90'), 90);
  assert.equal(normalizeRangeDays(45), 30);
  assert.equal(normalizeRangeDays(undefined), 30);
  assert.equal(rangeLabel(30), 'Last 30 days');
  // Node has no localStorage, so the stored range falls back and a write does not throw.
  assert.equal(typeof globalThis.localStorage, 'undefined');
  assert.equal(readStoredRange(), 30);
  assert.doesNotThrow(() => writeStoredRange(90));
});

test('the stored range is read back from localStorage when there is one', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    assert.equal(readStoredRange(), 30);
    writeStoredRange(90);
    assert.equal(store.get('jourvance_stats_days'), '90');
    assert.equal(readStoredRange(), 90);
    store.set('jourvance_stats_days', '12');
    assert.equal(readStoredRange(), 30);
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.equal(readStoredRange(), 30);
    assert.doesNotThrow(() => writeStoredRange(7));
  } finally {
    delete globalThis.localStorage;
  }
});

// ── The answer, the state and the request ─────────────────────────────────────

test('readStatsAnswer keeps only an answer for this journey and range, with finite numbers', () => {
  const body = {
    success: true, journeyId: 'j1', days: 30, from: 'a', to: 'b', partialSince: null,
    stats: { nodes: { p: { visitors: 10, conversionRate: NaN, grossRevenue: '5', leads: null }, q: { visitors: 3 } } },
    coverage: { p: { measured: true }, r: { measured: false, why: 'not_published' } }
  };
  const snap = readStatsAnswer(body, 'j1', 30);
  assert.ok(snap);
  assert.equal(snap.journeyId, 'j1');
  assert.equal(snap.days, 30);
  assert.equal(snap.nodes.p.visitors, 10);
  assert.equal(snap.nodes.p.conversionRate, null);
  assert.equal(snap.nodes.p.grossRevenue, null);
  assert.equal(snap.nodes.p.leads, null);
  // q has a finite value but no coverage row, so it counts as measured.
  assert.equal(snap.coverage.q.measured, true);
  assert.deepEqual(snap.coverage.r, { measured: false, why: 'not_published' });
  // A win-back or review step's reason survives the read, so its card never says 0.
  const pageless = readStatsAnswer({ ...body, coverage: { w: { measured: false, why: 'not_by_page' } } }, 'j1', 30);
  assert.deepEqual(pageless.coverage.w, { measured: false, why: 'not_by_page' });

  assert.equal(readStatsAnswer({ ...body, journeyId: 'j2' }, 'j1', 30), null);
  assert.equal(readStatsAnswer({ ...body, days: 90 }, 'j1', 30), null);
  assert.equal(readStatsAnswer({ ...body, success: false }, 'j1', 30), null);
  assert.equal(readStatsAnswer(null, 'j1', 30), null);
  assert.equal(readStatsAnswer({ ...body, stats: {} }, 'j1', 30), null);
});

test('the metrics state keeps a matching snapshot and never shows another range', () => {
  const snap = snapshot();
  const prev = { status: 'ready', snapshot: snap };
  assert.equal(metricsLoading(prev, 'j1', 30), prev);
  assert.equal(metricsFailed(prev, 'j1', 30), prev);
  assert.deepEqual(metricsLoading(prev, 'j1', 90), { status: 'loading', journeyId: 'j1', days: 90 });
  assert.deepEqual(metricsFailed(prev, 'j2', 30), { status: 'failed', journeyId: 'j2', days: 30 });
  assert.deepEqual(metricsLoading({ status: 'signed-out' }, 'j1', 7), { status: 'loading', journeyId: 'j1', days: 7 });

  assert.equal(metricsView(prev, 'j1', 30).snapshot, snap);
  assert.equal(metricsView(prev, 'j1', 30).status, 'ready');
  const other = metricsView(prev, 'j1', 90);
  assert.equal(other.snapshot, null);
  assert.equal(other.status, 'loading');
  assert.equal(other.days, 90);
  assert.equal(metricsView({ status: 'signed-out' }, 'j1', 30).status, 'signed-out');
  assert.equal(metricsView({ status: 'failed', journeyId: 'j1', days: 30 }, 'j1', 30).status, 'failed');
  assert.equal(metricsView({ status: 'failed', journeyId: 'j1', days: 30 }, 'j1', 7).status, 'loading');
});

test('statsRequestBody carries the journey, the range and each line with its handle', () => {
  const body = statsRequestBody({
    id: 'j1',
    nodes: [{ id: 'ad', type: 'ad-source', position: { x: 0, y: 0 }, data: { utmCampaign: 'spring', spend: 40, visitors: 500 } }],
    edges: [{ id: 'e1', source: 'ad', target: 'p', sourceHandle: 'branch-b', data: { rate: 9 } }]
  }, 90);
  assert.equal(body.journeyId, 'j1');
  assert.equal(body.days, 90);
  assert.deepEqual(body.nodes[0], { id: 'ad', type: 'ad-source', slug: '', utmCampaign: 'spring', offerType: '', spend: 40, jourvanceFlowId: '' });
  // An unlinked follow-up is counted by its own kind of sequence, so the kind goes to the server.
  const seq = statsRequestBody({ id: 'j1', nodes: [{ id: 's', type: 'follow-up-sequence', data: { sequenceType: 'checkout_recovery' } }], edges: [] }, 30);
  assert.equal(seq.nodes[0].sequenceType, 'checkout_recovery');
  assert.equal(statsRequestBody({ id: 'j1', nodes: [{ id: 's', type: 'follow-up-sequence', data: {} }], edges: [] }, 30).nodes[0].sequenceType, '');
  assert.deepEqual(body.edges[0], { id: 'e1', source: 'ad', target: 'p', sourceHandle: 'branch-b' });
});

test('nodeMeasure is null unless the snapshot measured the step', () => {
  const snap = snapshot({
    nodes: { p: { visitors: 0 }, q: { visitors: null } },
    coverage: { p: { measured: true }, q: { measured: false, why: 'not_published' } }
  });
  assert.deepEqual(nodeMeasure(snap, 'p'), { visitors: 0 });
  assert.equal(nodeMeasure(snap, 'q'), null);
  assert.equal(nodeMeasure(snap, 'missing'), null);
  assert.equal(nodeMeasure(null, 'p'), null);
  assert.equal(measureValue({ visitors: 0 }, 'visitors'), 0);
  assert.equal(measureValue({ visitors: NaN }, 'visitors'), null);
  assert.equal(measureValue(null, 'visitors'), null);
});

test('each card carries one basis line naming the range or the reason', () => {
  const snap = snapshot({
    coverage: {
      p: { measured: true },
      u: { measured: false, why: 'not_published' },
      a: { measured: false, why: 'no_campaign' },
      f: { measured: false, why: 'no_source' },
      w: { measured: false, why: 'not_by_page' },
      s: { measured: true, scope: 'flow' }
    }
  });
  assert.equal(nodeNote({ status: 'signed-out', days: 30, snapshot: null }, 'p'), 'Sign in to see numbers.');
  assert.equal(nodeNote({ status: 'loading', days: 30, snapshot: null }, 'p'), 'Loading numbers.');
  assert.equal(nodeNote({ status: 'failed', days: 30, snapshot: null }, 'p'), 'Numbers could not be loaded.');
  assert.equal(nodeNote(ready(snap), 'p'), 'Measured, last 30 days');
  assert.equal(nodeNote(ready(snap), 's'), 'Measured, last 30 days, whole flow');
  assert.equal(nodeNote(ready(snap), 'u'), 'Unavailable. Publish this page to measure it.');
  assert.equal(nodeNote(ready(snap), 'a'), 'Unavailable. Add a campaign tag to this ad to measure it.');
  assert.equal(nodeNote(ready(snap), 'f'), 'Unavailable. Connect a published page before this step.');
  assert.equal(nodeNote(ready(snap), 'w'), 'Unavailable. These emails are not sent from a page, so this journey cannot count them.');
  const partial = snapshot({ partialSince: '2026-09-12T12:00:00.000Z', coverage: { p: { measured: true } } });
  assert.match(nodeNote(ready(partial), 'p'), /^Measured since Sep 1[123]\. Older visits were not kept\.$/);

  assert.equal(legendNote(ready(snap)), 'Last 30 days. Est. marks an estimate.');
  assert.equal(legendNote({ status: 'signed-out', days: 30, snapshot: null }), 'Sign in to see numbers.');
  assert.doesNotMatch(nodeNote(null, 'p'), /\d/);
});

test('stageTotal reads the one count each step shows', () => {
  assert.equal(stageTotal('ad-source', { clicks: 4 }), 4);
  assert.equal(stageTotal('ab-split', { branchAVisitors: 3, branchBVisitors: 2 }), 5);
  assert.equal(stageTotal('ab-split', { branchAVisitors: 3, branchBVisitors: null }), null);
  assert.equal(stageTotal('landing-page', { visitors: 0 }), 0);
  assert.equal(stageTotal('lead-form', { submissions: 7 }), 7);
  assert.equal(stageTotal('follow-up-sequence', { flowEnrolled: 2 }), 2);
  assert.equal(stageTotal('thank-you', { pageViews: 9 }), 9);
  assert.equal(stageTotal('upsell', { takes: 1, views: 50 }), 1);
  assert.equal(stageTotal('landing-page', null), null);
});

// ── Edge figures and grades ───────────────────────────────────────────────────

const fig = (sourceType, targetType, source, target, sourceHandle, targetData) =>
  edgeFigure({ sourceType, targetType, sourceHandle, targetData, source, target });

test('the ad line counts visits from the ad and never grades them', () => {
  const def = edgeMetricFor('ad-source', 'landing-page');
  assert.equal(def.id, 'ad-visits');
  assert.equal(def.name, 'Visits from this ad');
  const f = fig('ad-source', 'landing-page', { clicks: 10000 }, { visitors: 12000 });
  assert.equal(f.count, 10000);
  assert.equal(f.rate, null);
  assert.equal(f.basis, 'Measured');
  assert.equal(f.status.status, 'not_graded');
  assert.equal(fig('ad-source', 'landing-page', null, null).status.status, 'unavailable');
});

test('a page line is graded on the page\'s own measured rate, and only over 100 visits', () => {
  const f = fig('landing-page', 'lead-form', { visitors: 200, leads: 20 }, { submissions: 20 });
  assert.equal(f.def.id, 'opt-in');
  assert.equal(f.rate, 10);
  assert.equal(f.count, 20);
  assert.equal(f.denominator, 200);
  assert.equal(f.basis, 'Measured');
  assert.equal(f.status.status, 'needs_work');
  assert.equal(f.status.label, 'Below typical range');
  assert.equal(fig('landing-page', 'lead-form', { visitors: 50, leads: 5 }, null).status.status, 'too_few');
  const none = fig('landing-page', 'lead-form', { visitors: 0, leads: 0 }, null);
  assert.equal(none.status.status, 'no_traffic');
  assert.equal(none.rate, null);
  assert.equal(fig('landing-page', 'lead-form', null, null).status.status, 'unavailable');

  const cr = fig('landing-page', 'thank-you', { visitors: 500, conversions: 30 }, { pageViews: 900 });
  assert.equal(cr.def.id, 'conversion');
  assert.equal(cr.rate, 6);
  assert.equal(cr.status.status, 'healthy');
  assert.equal(cr.status.label, 'Within typical range');
});

test('an upsell take line uses the upsell\'s own views and takes and stays at or under 100', () => {
  const f = fig('upsell', 'thank-you', { views: 40, takes: 10 }, { pageViews: 400 }, 'accepted');
  assert.equal(f.def.id, 'take');
  assert.equal(f.count, 10);
  assert.equal(f.denominator, 40);
  assert.equal(f.rate, 25);
  const plain = fig('upsell', 'upsell', { views: 10, takes: 3 }, { views: 900 }, null);
  assert.equal(plain.def.id, 'take');
  assert.ok(plain.rate <= 100);
});

test('a continue line is an estimate from step totals, capped at 100 and never graded', () => {
  const f = fig('lead-form', 'follow-up-sequence', { submissions: 120 }, { flowEnrolled: 150 });
  assert.equal(f.def.id, 'continue');
  assert.equal(f.basis, 'Estimated');
  assert.equal(f.count, 120);
  assert.equal(f.denominator, 120);
  assert.equal(f.rate, 100);
  assert.equal(f.status.status, 'not_graded');
  const lower = fig('lead-form', 'follow-up-sequence', { submissions: 400 }, { flowEnrolled: 100 });
  assert.equal(lower.count, 100);
  assert.equal(lower.rate, 25);
  assert.equal(lower.status.status, 'not_graded');
  assert.equal(fig('lead-form', 'follow-up-sequence', { submissions: 400 }, null).basis, null);
});

test('retention, decline and split lines are named from the handle and the step, never graded', () => {
  const recovery = { type: 'follow-up-sequence', sequenceType: 'upsell_recovery', delayHours: 1 };
  const intoRetention = fig('upsell', 'follow-up-sequence', { views: 200, totalDeclines: 50 }, { flowEnrolled: 12 }, 'declined', recovery);
  assert.equal(intoRetention.def.id, 'retention');
  assert.equal(intoRetention.count, 12);
  assert.equal(intoRetention.rate, null);
  assert.equal(intoRetention.delayText, '1h wait');
  assert.notEqual(intoRetention.status.status, 'needs_work');

  // A downsell is an offer, not a retention flow. isRetentionLink would call this 'retention'.
  const downsell = { type: 'upsell', offerType: 'downsell' };
  const decline = fig('upsell', 'upsell', { views: 200, totalDeclines: 50 }, { views: 50 }, 'declined', downsell);
  assert.equal(decline.def.id, 'decline');
  assert.equal(decline.def.short, 'DECLINE');
  assert.equal(decline.rate, 25);
  assert.equal(decline.status.status, 'not_graded');

  assert.equal(fig('upsell', 'follow-up-sequence', { views: 1 }, null, 'rescue', { type: 'follow-up-sequence' }).def.id, 'retention');
  assert.equal(fig('landing-page', 'follow-up-sequence', { visitors: 1 }, null, 'abandon', { type: 'follow-up-sequence' }).def.id, 'retention');

  const split = { branchAVisitors: 300, branchBVisitors: 100 };
  const b = fig('ab-split', 'landing-page', split, null, 'branch-b');
  assert.equal(b.def.id, 'split-share');
  assert.equal(b.rate, 25);
  assert.equal(b.count, 100);
  assert.equal(b.status.status, 'not_graded');
  assert.equal(fig('ab-split', 'landing-page', split, null, 'branch-a').rate, 75);
});

test('an email click line reads the flow\'s own sends and clicks', () => {
  const f = fig('follow-up-sequence', 'landing-page', { flowSent: 400, flowClicked: 20 }, { visitors: 5 });
  assert.equal(f.def.id, 'sequence-click');
  assert.equal(f.rate, 5);
  assert.equal(f.status.status, 'needs_work');
  assert.equal(fig('follow-up-sequence', 'landing-page', { flowSent: null, flowClicked: null }, null).status.status, 'unavailable');
});

test('the canvas figures come from the snapshot, never from counts saved in the journey', () => {
  const nodes = [
    { id: 'p', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', visitors: 500, conversions: 40 } },
    { id: 'f', type: 'lead-form', position: { x: 1, y: 0 }, data: { type: 'lead-form', views: 500, submissions: 40 } }
  ];
  const edges = [{ id: 'e', source: 'p', target: 'f', data: { sourceThroughput: 500, targetCount: 40, rate: 8 } }];
  const signedOut = buildCanvasMetrics(nodes, edges, { status: 'signed-out', days: 30, snapshot: null });
  assert.equal(signedOut.nodes.p.measure, null);
  assert.equal(signedOut.nodes.p.note, 'Sign in to see numbers.');
  assert.equal(signedOut.edges.e.rate, null);
  assert.equal(signedOut.edges.e.status.status, 'unavailable');

  const snap = snapshot({ nodes: { p: { visitors: 300, leads: 60 } }, coverage: { p: { measured: true }, f: { measured: false, why: 'no_source' } } });
  const live = buildCanvasMetrics(nodes, edges, ready(snap));
  assert.equal(live.nodes.p.measure.visitors, 300);
  assert.equal(live.edges.e.rate, 20);
  assert.equal(live.edges.e.basis, 'Measured');
  assert.equal(figureForEdge(edges[0], nodes[0], nodes[1], ready(snap)).rate, 20);
  assert.equal(figureForEdge(edges[0], nodes[0], nodes[1], null).rate, null);
});

// C28: the server counts every visit in the journey tagged with the ad's campaign, so that count
// belongs to the ad's one routing line. A side line into a follow-up, or an older journey whose ad
// fans out to two pages, must read Unavailable rather than claim the whole count on every line.
test('only an ad\'s single routing line into a page claims the ad\'s visits', () => {
  const nodes = [
    { id: 'ad', type: 'ad-source', position: { x: 0, y: 0 }, data: { type: 'ad-source', utmCampaign: 'spring' } },
    { id: 'p1', type: 'landing-page', position: { x: 1, y: 0 }, data: { type: 'landing-page', slug: 'lander' } },
    { id: 'p2', type: 'landing-page', position: { x: 1, y: 1 }, data: { type: 'landing-page', slug: 'second-lander' } },
    { id: 'sq', type: 'follow-up-sequence', position: { x: 1, y: 2 }, data: { type: 'follow-up-sequence' } }
  ];
  const snap = snapshot({
    nodes: { ad: { clicks: 1000 }, p1: { visitors: 800 }, sq: { flowEnrolled: 30 } },
    coverage: { ad: { measured: true }, p1: { measured: true }, p2: { measured: false, why: 'not_published' }, sq: { measured: true } }
  });
  const view = ready(snap);
  const toPage = { id: 'ad-p1', source: 'ad', target: 'p1' };

  // The control: one line into a page shows the ad's visits, measured.
  const lone = buildCanvasMetrics(nodes, [toPage], view).edges['ad-p1'];
  assert.equal(lone.count, 1000);
  assert.equal(lone.basis, 'Measured');
  assert.equal(edgePillValue(lone), '1,000');

  // A side line into a follow-up: the page line keeps the count, the follow-up line does not.
  const side = buildCanvasMetrics(nodes, [toPage, { id: 'ad-sq', source: 'ad', target: 'sq' }], view).edges;
  assert.equal(side['ad-p1'].count, 1000);
  assert.equal(side['ad-sq'].count, null);
  assert.equal(side['ad-sq'].basis, null);
  assert.equal(side['ad-sq'].status.status, 'unavailable');
  assert.equal(edgePillValue(side['ad-sq']), UNAVAILABLE);
  assert.match(edgeSentence(side['ad-sq'], view), /counted on its line into a page/);
  assert.doesNotMatch(edgeSentence(side['ad-sq'], view), /1,000/);
  // edgeFigure alone knows the target, so the inspector agrees without the line list.
  assert.equal(figureForEdge({ id: 'ad-sq', source: 'ad', target: 'sq' }, nodes[0], nodes[3], view).count, null);

  // An older journey whose ad fans out to two pages: neither line can claim the whole count,
  // least of all the line into a page that is not published.
  const fan = buildCanvasMetrics(nodes, [toPage, { id: 'ad-p2', source: 'ad', target: 'p2' }], view).edges;
  for (const id of ['ad-p1', 'ad-p2']) {
    assert.equal(fan[id].count, null, id);
    assert.equal(edgePillValue(fan[id]), UNAVAILABLE, id);
    assert.match(edgeSentence(fan[id], view), /more than one line into a page/, id);
  }
  // Told the fan-out, figureForEdge agrees with the pill; told nothing, it is the lone line.
  assert.equal(figureForEdge(toPage, nodes[0], nodes[1], view, 2).count, null);
  assert.equal(figureForEdge(toPage, nodes[0], nodes[1], view).count, 1000);
  // The line inspector passes no line list. The answer names the ad's routing lines in the map
  // it counted, so the inspector reads the fan-out from the snapshot and agrees with the pill.
  const fanSnap = snapshot({
    nodes: { ad: { clicks: 1000, routingLines: 2 }, p1: { visitors: 800 } },
    coverage: { ad: { measured: true }, p1: { measured: true }, p2: { measured: false, why: 'not_published' } }
  });
  const fanView = ready(fanSnap);
  for (const [id, target] of [['ad-p1', nodes[1]], ['ad-p2', nodes[2]]]) {
    const drawer = figureForEdge({ id, source: 'ad', target: target.id }, nodes[0], target, fanView);
    assert.equal(drawer.count, null, id);
    assert.equal(drawer.basis, null, id);
    assert.equal(drawer.note, AD_FAN_OUT_NOTE, id);
  }
  // The live line list wins whichever says more: a lone line with a stale answer still reads Unavailable.
  assert.equal(figureForEdge(toPage, nodes[0], nodes[1], fanView, 1).count, null);
  const loneSnap = snapshot({ nodes: { ad: { clicks: 1000, routingLines: 1 } }, coverage: { ad: { measured: true } } });
  assert.equal(figureForEdge(toPage, nodes[0], nodes[1], ready(loneSnap)).count, 1000);
  // The same rule straight on edgeFigure.
  assert.equal(fig('ad-source', 'follow-up-sequence', { clicks: 1000 }, { flowEnrolled: 30 }).count, null);
  assert.equal(edgeFigure({ sourceType: 'ad-source', targetType: 'landing-page', source: { clicks: 1000 }, target: null, adRoutingLines: 2 }).count, null);
  assert.equal(edgeFigure({ sourceType: 'ad-source', targetType: 'landing-page', source: { clicks: 1000 }, target: null, adRoutingLines: 1 }).count, 1000);
});

test('no grade label mentions a top 10 percent', () => {
  const def = edgeMetricFor('landing-page', 'thank-you');
  const labels = [
    edgeStatus(def, { count: null, denominator: null, rate: null, basis: null }),
    edgeStatus(def, { count: 0, denominator: 0, rate: null, basis: 'Measured' }),
    edgeStatus(def, { count: 1, denominator: 10, rate: 10, basis: 'Measured' }),
    edgeStatus(def, { count: 1, denominator: 1000, rate: 1, basis: 'Measured' }),
    edgeStatus(def, { count: 60, denominator: 1000, rate: 6, basis: 'Measured' }),
    edgeStatus(def, { count: 90, denominator: 1000, rate: 9, basis: 'Measured' }),
    edgeStatus(def, { count: 90, denominator: 1000, rate: 9, basis: 'Estimated' })
  ].map(s => s.label);
  assert.deepEqual(labels, [
    'Unavailable', 'No visits in this range', 'Too few visits to grade',
    'Below typical range', 'Within typical range', 'Above typical range', 'Not graded'
  ]);
  for (const label of labels) assert.doesNotMatch(label, /Top 10%/);
  assert.equal(MIN_GRADE_SAMPLE, 100);
});

// ── Delay, order value, totals ────────────────────────────────────────────────

test('the retention wait is the step\'s own delay', () => {
  assert.equal(retentionDelayText({ delayHours: 1 }), '1h wait');
  assert.equal(retentionDelayText({ delayHours: 18 }), '18h wait');
  assert.equal(retentionDelayText({ delayHours: 0 }), 'No wait');
  assert.equal(retentionDelayText({}), 'Wait not set');
  assert.equal(retentionDelayText({ delayHours: NaN }), 'Wait not set');
  assert.equal(retentionDelayText(null), 'Wait not set');
});

test('the leak card uses a measured average order, then the step\'s own price, never 49', () => {
  assert.deepEqual(leakAov({ grossRevenue: 500, liveOrders: 10 }, { type: 'landing-page' }), { value: 50, basis: 'Measured' });
  assert.deepEqual(leakAov({ grossRevenue: 0, liveOrders: 0 }, { type: 'landing-page', shopifyProductPrice: '$38.00' }), { value: 38, basis: 'Estimated' });
  assert.deepEqual(leakAov(null, { type: 'upsell', productPrice: '$20' }), { value: 20, basis: 'Estimated' });
  assert.deepEqual(leakAov(null, { type: 'landing-page' }), { value: null, basis: null });
  assert.deepEqual(leakAov(null, { type: 'landing-page', shopifyProductPrice: 'free' }), { value: null, basis: null });

  const leak = calculateRevenueLeakage(1000, 10, 22, null);
  assert.equal(leak.potentialRecoveredConversions, 120);
  assert.equal(leak.potentialRevenueGain, null);
  assert.equal(calculateRevenueLeakage(1000, 30, 22, 10).potentialRecoveredConversions, 0);
});

test('journey totals are null until a page is measured, and spend is what was entered', () => {
  const nodes = [
    { id: 'ad1', type: 'ad-source', position: { x: 0, y: 0 }, data: { type: 'ad-source', spend: 100 } },
    { id: 'ad2', type: 'ad-source', position: { x: 0, y: 0 }, data: { type: 'ad-source', spend: 50 } },
    { id: 'p', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', visitors: 500, grossRevenue: 900 } }
  ];
  const empty = journeyTotals(nodes, null);
  assert.equal(empty.spend, 150);
  for (const key of ['visitors', 'leads', 'leadRate', 'gross', 'bumpRate', 'roas']) assert.equal(empty[key], null, key);

  const snap = snapshot({
    nodes: { p: { visitors: 200, leads: 20, grossRevenue: 300, liveOrders: 10, orderBumpTakes: 2 } },
    coverage: { p: { measured: true } }
  });
  const t = journeyTotals(nodes, snap);
  assert.equal(t.visitors, 200);
  assert.equal(t.leads, 20);
  assert.equal(t.leadRate, 10);
  assert.equal(t.gross, 300);
  assert.equal(t.bumpRate, 20);
  assert.equal(t.roas, 2);
});

test('the benchmark and metrics sources carry no em dash, no spaced en dash and no CTR', () => {
  const bench = read('./src/lib/conversionBenchmarks.ts');
  const metrics = read('./src/lib/journeyMetrics.ts');
  for (const [name, src] of [['conversionBenchmarks.ts', bench], ['journeyMetrics.ts', metrics]]) {
    assert.doesNotMatch(src, /—/, `${name} has an em dash`);
    assert.doesNotMatch(src, / – /, `${name} has a spaced en dash`);
  }
  assert.doesNotMatch(bench, /CTR/);
  assert.doesNotMatch(bench, /Top 10%/);
  assert.doesNotMatch(bench, /\b49\b/);
  for (const tip of getStepOptimizationTips('ad-source', 'landing-page')) assert.doesNotMatch(tip.description, /CTR/);
});

// ── Source pins for the cards, lines and inspectors ──────────────────────────
// The integration lane (w3-spine-2) wired the snapshot into these files.

const CARDS = ['AdNode', 'PageNode', 'FormNode', 'SequenceNode', 'ThankYouNode', 'UpsellNode', 'AbSplitNode'];

test('the line pill reads its figure from the canvas context', () => {
  const src = read('./src/components/canvas/edges/ConversionEdge.tsx');
  assert.match(src, /useEdgeFigure\(/);
  assert.match(src, /edgeKind\(/);
  assert.match(src, /data-edge-metric/);
  assert.doesNotMatch(src, /CTR/);
  assert.doesNotMatch(src, /18h/);
  assert.doesNotMatch(src, /Ready/);
});

test('the edge inspector has no $49 and no em dash', () => {
  const src = read('./src/components/drawers/EdgeInspector.tsx');
  assert.doesNotMatch(src, /\b49\b/);
  assert.doesNotMatch(src, /—/);
  assert.match(src, /figureForEdge\(/);
});

test('every card reads the snapshot and has no zero fallbacks', () => {
  for (const name of CARDS) {
    const src = read(`./src/components/canvas/nodes/${name}.tsx`);
    assert.match(src, /useNodeMetrics\(/, name);
    for (const literal of ["'0 Visitors'", "'$0 rev'", "'0%'", "'0.0'"]) assert.ok(!src.includes(literal), `${name} has ${literal}`);
  }
  assert.doesNotMatch(read('./src/components/canvas/nodes/SequenceNode.tsx'), /18h delay/);
  assert.doesNotMatch(read('./src/components/canvas/nodes/UpsellNode.tsx'), /18h/);
});

test('App reads stats into a snapshot and no longer writes them into the journey', () => {
  const src = read('./src/App.tsx');
  assert.match(src, /statsRequestBody\(/);
  assert.match(src, /readStatsAnswer\(/);
  assert.doesNotMatch(src, /applyLiveStats\(/);
});

test('the split and sequence editors read the snapshot and the step\'s own delay', () => {
  assert.match(read('./src/components/drawers/AbSplitEditor.tsx'), /measure\??:/);
  const seq = read('./src/components/drawers/SequenceEditor.tsx');
  assert.doesNotMatch(seq, /delayHours \?\? 18/);
  assert.doesNotMatch(seq, /e\.g\. 18/);
});
