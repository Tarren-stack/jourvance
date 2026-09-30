// The integration half of honest numbers on the journey map (#9). journey-metrics.test.mjs pins
// the pure rules; this file pins that the map actually reads them: every card, line, inspector and
// the toolbar take their figures from ONE stats snapshot held outside the journey, a figure nobody
// measured reads Unavailable, and App no longer writes counts into the saved journey. The
// components are JSX, which node cannot load, so the wiring is pinned in the source; the text a
// line shows and says is pure and tested directly. The browser check drives the rest.
//
// JV_ROOT points the whole file at another tree (the pre-change copy), to watch it fail there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.JV_ROOT ? pathToFileURL(`${process.env.JV_ROOT.replace(/\/$/, '')}/`) : new URL('./', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const lib = await import(new URL('./src/lib/journeyMetrics.ts', ROOT).href);
const { edgeFigure } = lib;

const CARDS = ['AdNode', 'PageNode', 'FormNode', 'SequenceNode', 'ThankYouNode', 'UpsellNode', 'AbSplitNode'];
const card = (name) => read(`./src/components/canvas/nodes/${name}.tsx`);

const snapshot = (over = {}) => ({
  journeyId: 'j1', days: 30, from: 'a', to: 'b', partialSince: null, nodes: {}, coverage: {}, ...over
});
const ready = (snap) => ({ status: 'ready', days: snap.days, snapshot: snap });
const signedOut = { status: 'signed-out', days: 30, snapshot: null };
const fig = (sourceType, targetType, source, target, sourceHandle, targetData) =>
  edgeFigure({ sourceType, targetType, sourceHandle, targetData, source, target });

// ── What a line shows and says ────────────────────────────────────────────────

test('a pill shows a measured rate, an estimate marked Est., a visit count or Unavailable', () => {
  const { edgePillValue, edgePillCount } = lib;
  assert.equal(typeof edgePillValue, 'function');
  const optIn = fig('landing-page', 'lead-form', { visitors: 200, leads: 20 }, null);
  assert.equal(edgePillValue(optIn), '10.0%');
  assert.equal(edgePillCount(optIn), '(20)');
  const estimate = fig('lead-form', 'follow-up-sequence', { submissions: 400 }, { flowEnrolled: 100 });
  assert.equal(edgePillValue(estimate), 'Est. 25.0%');
  const ad = fig('ad-source', 'landing-page', { clicks: 1234 }, null);
  assert.equal(edgePillValue(ad), '1,234');
  assert.equal(edgePillCount(ad), null, 'an ad line has no rate, so nothing to count it against');
  assert.equal(edgePillValue(fig('landing-page', 'lead-form', { visitors: 0, leads: 0 }, null)), '0 visits');
  assert.equal(edgePillValue(fig('landing-page', 'lead-form', null, null)), 'Unavailable');
  assert.equal(edgePillCount(fig('landing-page', 'lead-form', null, null)), null);
  assert.equal(edgePillValue(null), 'Unavailable');
  // A measured rate never shows as a bare 0 and never passes 100.
  for (const f of [optIn, estimate, ad]) assert.doesNotMatch(edgePillValue(f), /^\$?0(\.0)?%?$/);
});

test('a retention line shows the wait set on its follow-up, and only a line into a follow-up does', () => {
  const { edgePillValue, edgePillCount } = lib;
  const set = fig('upsell', 'follow-up-sequence', null, null, 'rescue', { type: 'follow-up-sequence', delayHours: 1 });
  assert.equal(edgePillValue(set), '1h wait');
  assert.equal(edgePillCount(set), null, 'signed out there is no enrolled count to show');
  const unset = fig('upsell', 'follow-up-sequence', null, null, 'rescue', { type: 'follow-up-sequence' });
  assert.equal(edgePillValue(unset), 'Wait not set');
  const counted = fig('upsell', 'follow-up-sequence', null, { flowEnrolled: 7 }, 'rescue', { type: 'follow-up-sequence', delayHours: 0 });
  assert.equal(edgePillValue(counted), 'No wait');
  assert.equal(edgePillCount(counted), '(7)');
  // lineShowsDelay: a rescue line into a thank-you page has no wait to show.
  const intoPage = fig('upsell', 'thank-you', null, null, 'rescue', { type: 'thank-you', delayHours: 5 });
  assert.equal(intoPage.def.id, 'retention');
  assert.equal(intoPage.delayText, undefined);
  assert.equal(edgePillValue(intoPage), 'Unavailable');
});

test('a line out of a follow-up has no estimate until it is measured', () => {
  // lineRateMeasured: enrolments over the next step's count is not a click or a rescue rate.
  const out = fig('follow-up-sequence', 'thank-you', { flowEnrolled: 50 }, { pageViews: 40 });
  assert.equal(out.def.id, 'continue');
  assert.equal(out.basis, null);
  assert.equal(out.rate, null);
  assert.equal(out.status.status, 'unavailable');
  // The click line back to a page IS a measure, from the flow's own sends and clicks.
  assert.equal(fig('follow-up-sequence', 'landing-page', { flowSent: 100, flowClicked: 9 }, null).rate, 9);
});

test('each pill says its name, value, basis and range, or why it is Unavailable', () => {
  const { edgeSentence, rangeText } = lib;
  const snap = snapshot();
  const optIn = fig('landing-page', 'lead-form', { visitors: 200, leads: 20 }, null);
  assert.equal(edgeSentence(optIn, ready(snap)), 'Opt-in rate: 10.0% (20 of 200). Measured, last 30 days. Open for details.');
  const estimate = fig('lead-form', 'follow-up-sequence', { submissions: 400 }, { flowEnrolled: 100 });
  assert.equal(edgeSentence(estimate, ready(snap)), 'Moved on: Est. 25.0% (100 of 400). Estimated, last 30 days. Open for details.');
  const ad = fig('ad-source', 'landing-page', { clicks: 12 }, null);
  assert.equal(edgeSentence(ad, ready(snapshot({ days: 7 }))), 'Visits from this ad: 12 visits. Measured, last 7 days. Open for details.');
  const none = fig('ad-source', 'landing-page', null, null);
  assert.equal(edgeSentence(none, signedOut), 'Visits from this ad: Unavailable. Sign in to see numbers.');
  assert.equal(edgeSentence(none, ready(snap)), 'Visits from this ad: Unavailable. This line has no measured numbers for this range.');
  const rescue = fig('upsell', 'follow-up-sequence', null, null, 'rescue', { type: 'follow-up-sequence', delayHours: 1 });
  assert.equal(edgeSentence(rescue, signedOut), 'Retention flow: 1h wait, set on the step. Enrolled: Unavailable. Sign in to see numbers.');
  assert.equal(edgeSentence(null, { status: 'loading', days: 30, snapshot: null }), 'Line: Unavailable. Loading numbers.');
  assert.match(rangeText(ready(snapshot({ partialSince: '2026-09-12T12:00:00.000Z' }))), /^since Sep 1[123]$/);
  assert.equal(rangeText(null), 'last 30 days');
  for (const s of [edgeSentence(optIn, ready(snap)), edgeSentence(rescue, signedOut)]) {
    assert.doesNotMatch(s, /—| – |CTR|Top 10%/);
  }
});

test('the inspector words the wait as set on the step', () => {
  const { retentionDelaySentence } = lib;
  assert.equal(retentionDelaySentence({ delayHours: 1 }), 'Set on this step: 1h before the first message.');
  assert.equal(retentionDelaySentence({ delayHours: 0 }), 'Set on this step: no wait before the first message.');
  assert.equal(retentionDelaySentence({}), 'No wait is set on this step yet.');
});

// ── Source pins: the map reads the snapshot ──────────────────────────────────

test('App holds the snapshot, sends the one request body and never writes counts into the journey', () => {
  const src = read('./src/App.tsx');
  assert.doesNotMatch(src, /applyLiveStats/);
  assert.match(src, /statsRequestBody\(project, statsDays\)/);
  assert.match(src, /readStatsAnswer\(data, journeyId, days\)/);
  assert.match(src, /metricsView\(metricsState, project\.id, statsDays\)/);
  assert.match(src, /useState<RangeDays>\(\(\) => readStoredRange\(\)\)/);
  assert.match(src, /setMetricsState\(\{ status: 'signed-out' \}\)/);
  assert.match(src, /writeStoredRange\(d\)/);
  // The effect that pulls stats never calls setProject: a poll is not an edit.
  const at = src.indexOf("fetch('/api/funnel/stats'");
  const effect = src.slice(src.lastIndexOf('useEffect(', at), src.indexOf('}, [user?.uid, statsShape]);', at));
  assert.ok(effect.length > 0);
  assert.doesNotMatch(effect, /setProject\(/);
  // The step and line panels sit inside the docked step panel (#7), which passes the snapshot on.
  const dock = read('./src/components/drawers/StepDock.tsx');
  for (const [file, text, tag] of [
    ['App', src, '<CanvasHeader'],
    ['App', src, '<JourneyCanvas'],
    ['App', src, '<StepDock'],
    ['StepDock', dock, '<NodeInspector'],
    ['StepDock', dock, '<EdgeInspector']
  ]) {
    const start = text.indexOf(tag);
    assert.ok(start >= 0, `${file} renders ${tag}`);
    // Up to the '/>' at the tag's own indent: a prop may hold JSX of its own (the dock's navigation).
    const indent = text.slice(text.lastIndexOf('\n', start) + 1, start);
    const end = text.indexOf(`\n${indent}/>`, start);
    const props = text.slice(start, end < 0 ? undefined : end);
    assert.match(props, /metrics=\{metrics\}/, `${file}: ${tag} gets the snapshot`);
  }
});

test('the canvas provides the figures and offers the date range', () => {
  const src = read('./src/components/canvas/JourneyCanvas.tsx');
  assert.match(src, /buildCanvasMetrics\(nodes, edges, metrics \?\? null\)/);
  const provider = src.indexOf('<CanvasMetricsContext.Provider value={canvasMetrics}>');
  assert.ok(provider > 0 && provider < src.indexOf('<ReactFlowProvider>'), 'the provider wraps the flow');
  assert.ok(src.indexOf('</CanvasMetricsContext.Provider>') > src.indexOf('</ReactFlowProvider>'));
  assert.match(src, /aria-label="Date range for the numbers on this map"/);
  assert.match(src, />Numbers</);
  assert.match(src, /'Sign in to see numbers\.'/);
  assert.match(src, /RANGE_DAYS\.map/);
  assert.match(src, /note=\{legendNote\(metrics \?\? null\)\}/);
  // The retention toggle still follows the range control in the same stack.
  assert.ok(src.indexOf('Date range for the numbers') < src.indexOf('onClick={toggleRetention}'));
  assert.match(read('./src/components/canvas/EdgeLegend.tsx'), /note\?: string/);
});

test('the line pill reads its figure from the canvas, never from counts saved on the line', () => {
  const src = read('./src/components/canvas/edges/ConversionEdge.tsx');
  assert.match(src, /useEdgeFigure\(id\)/);
  assert.match(src, /edgeKind\(/);
  assert.match(src, /data-edge-metric=\{figure\?\.def\.id \?\? 'unavailable'\}/);
  assert.match(src, /aria-label=\{sentence\}/);
  assert.match(src, /title=\{sentence\}/);
  assert.match(src, /status\?\.status === 'needs_work'/);
  for (const stale of ['getStepBenchmark', 'sourceThroughput', 'targetCount', 'isFlowing', 'CTR', '18h', 'Ready']) {
    assert.ok(!src.includes(stale), `ConversionEdge still has ${stale}`);
  }
});

test('the edge inspector reads the same figure and has no default order value', () => {
  const src = read('./src/components/drawers/EdgeInspector.tsx');
  assert.match(src, /figureForEdge\(edge, sourceNode, targetNode, view\)/);
  assert.match(src, /leakAov\(/);
  assert.match(src, /status\.status === 'needs_work'/);
  assert.match(src, /Estimated from each step's total\./);
  for (const label of ['Started here', 'Went on', 'Did not go on', 'Drop-off rate']) assert.ok(src.includes(label), label);
  assert.doesNotMatch(src, /\b49\b/);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /getStepBenchmark|edgeData|CTR/);
});

test('every card reads the snapshot, marks its measured cells and ends with one basis line', () => {
  for (const name of CARDS) {
    const src = card(name);
    assert.match(src, /const \{ measure: m, note \} = useNodeMetrics\(id\);/, name);
    assert.match(src, /data-metric/, name);
    assert.equal(src.split('data-metrics-note').length - 1, 1, `${name} has one basis line`);
    for (const literal of ["'0 Visitors'", "'$0 rev'", "'0%'", "'0.0'", "'0 Views'", "'18h delay'", 'd.visitors', 'd.views', 'd.pageViews', 'd.takes', 'd.branchAVisitors', 'd.clicks']) {
      assert.ok(!src.includes(literal), `${name} still has ${literal}`);
    }
    assert.doesNotMatch(src, /—| – /, `${name} has an em dash or a spaced en dash`);
  }
  const ad = card('AdNode');
  assert.match(ad, /data-entered title="Spend you entered"/);
  assert.match(ad, /'Not entered'/);
  assert.match(ad, /Cost per visit/);
  assert.doesNotMatch(ad, /CPC|Clicks/);
  assert.match(card('SequenceNode'), /retentionDelayText\(d\)/);
  assert.doesNotMatch(card('SequenceNode'), /18h/);
  assert.doesNotMatch(card('UpsellNode'), /18h/);
});

test('the split editor reads the snapshot and says when confidence is unavailable', () => {
  const inspector = read('./src/components/drawers/NodeInspector.tsx');
  assert.match(inspector, /measure=\{nodeMeasure\(metrics\?\.snapshot \?\? null, node\.id\)\}/);
  const split = read('./src/components/drawers/AbSplitEditor.tsx');
  assert.match(split, /measure\?: NodeMeasure \| null/);
  assert.match(split, /'Confidence Unavailable'/);
  assert.match(split, /'Numbers for this split are unavailable\.'/);
  assert.doesNotMatch(split, /data\.branch[AB](Visitors|Conversions)/);
});

test('the sequence editor leaves an unset wait blank', () => {
  const src = read('./src/components/drawers/SequenceEditor.tsx');
  assert.match(src, /value=\{data\.delayHours \?\? ''\}/);
  assert.equal(src.split('placeholder="Not set"').length - 1, 1);
  assert.doesNotMatch(src, /delayHours \?\? 18|e\.g\. 18/);
  assert.match(src, /delayHours: v === '' \? undefined : Math\.max\(0, parseInt\(v, 10\) \|\| 0\)/);
  // Switching the branch role keeps a wait of 0 rather than replacing it with a default.
  assert.match(src, /delayHours: data\.delayHours \?\? \(/);
});

test('the toolbar totals come from the snapshot and say when there are none', () => {
  const src = read('./src/components/toolbar/CanvasHeader.tsx');
  assert.match(src, /journeyTotals\(project\.nodes, metrics\?\.snapshot \?\? null\)/);
  assert.match(src, /Numbers unavailable/);
  assert.match(src, /'ROAS Unavailable'/);
  assert.match(src, /Spend not entered/);
  assert.match(src, /Lead rate/);
  assert.doesNotMatch(src, /totalBumpRevenue|blendedRoas|overallRate|ROAS —/);
});
