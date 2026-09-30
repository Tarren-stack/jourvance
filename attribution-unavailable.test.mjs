import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';

// The Attribution page's four top cards (finding C10). A report that failed or never arrived
// read "$0 | 0x | $0.00 vs $58.00 AOV | 0%", the $58.00 being the default product price, and a
// failed range change kept the previous range's numbers under the new range label. The server
// also answered 0 for ratios it had no denominator for. Now: a ratio without a denominator is
// null, the page clears the report on every request, only the newest reply may land, and a
// missing figure reads Unavailable with one alert and Try again.

const DAY = 86400000;
const ago = days => new Date(Date.now() - days * DAY).toISOString();

async function report(fixture = {}) {
  return (await fullReport(fixture)).summary;
}

async function fullReport(fixture = {}) {
  const { status, json } = await rawReport(fixture);
  assert.equal(status, 200);
  assert.equal(json.success, true);
  return json.report;
}

async function rawReport({ orders = [], journeys = {}, events = [], checkouts = [], loadEvents = () => events, hubReady = false } = {}) {
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    requireOperator: (_req, _res, next) => next(),
    loadEvents,
    loadOrders: () => orders,
    loadContacts: () => [],
    loadDrips: () => ({ enrollments: [] }),
    loadCheckouts: () => checkouts,
    publicPageCache: {},
    journeyCache: journeys,
    contactsForUser: () => [],
    userProgramBag: () => ({ flows: [], flowEnrollments: [] }),
    writeUserPrograms: () => {},
    messageStatsFor: () => ({ sent: 0, clicked: 0, opened: 0, revenue: 0 }),
    hubReady
  };
  const app = express();
  setupAnalyticsRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    // A handler that throws never answers, so a hang reads as a failure rather than a stall.
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/attribution?timeframe=30d`, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, json: await res.json() };
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }
}

test('with no orders and no spend, ROAS, CAC, AOV and repeat rate are unmeasured (null), not 0', async () => {
  const s = await report();
  assert.equal(s.blendedRoas, null);
  assert.equal(s.blendedCac, null);
  assert.equal(s.blendedAov, null);
  assert.equal(s.repeatBuyerRate, null);
  assert.equal(s.totalRevenue, 0, 'a sum over no orders is a real 0');
  assert.equal(s.totalOrders, 0);
});

test('orders without spend: CAC and AOV are measured, ROAS is not', async () => {
  const s = await report({
    orders: [
      { id: 'o1', userId: 'u1', totalPrice: 40, customerEmail: 'a@x.test', createdAt: ago(1) },
      { id: 'o2', userId: 'u1', totalPrice: 60, customerEmail: 'a@x.test', createdAt: ago(2) }
    ]
  });
  assert.equal(s.blendedRoas, null);
  assert.equal(s.blendedCac, 0, 'no spend over 2 orders is a real $0 CAC');
  assert.equal(s.blendedAov, 50);
  assert.equal(s.repeatBuyerRate, 100);
});

test('orders with no customer email leave the repeat rate unmeasured', async () => {
  const s = await report({
    orders: [{ id: 'o1', userId: 'u1', totalPrice: 40, createdAt: ago(1) }],
    journeys: { j1: { userId: 'u1', nodes: [{ type: 'ad-source', data: { platform: 'meta', spend: 20 } }] } }
  });
  assert.equal(s.repeatBuyerRate, null);
  assert.equal(s.blendedRoas, 2);
  assert.equal(s.blendedCac, 20);
});

const src = fs.readFileSync(new URL('./src/components/analytics/AttributionReports.tsx', import.meta.url), 'utf8');
const fetchBody = src.slice(src.indexOf('const fetchAttribution'), src.indexOf('useEffect(() => {\n    fetchAttribution'));

test('each request clears the report, and only the newest reply may set it', () => {
  assert.match(fetchBody, /const seq = \+\+requestSeq\.current;/);
  assert.match(fetchBody, /setReport\(null\);/, 'the previous range is cleared before the new one loads');
  assert.match(fetchBody, /if \(seq !== requestSeq\.current\) return;[\s\S]*setReport\(next\);[\s\S]*setFailed\(!next\);/,
    'a stale reply is dropped, and a missing report is a failure');
});

test('a failed report shows one alert with Try again', () => {
  assert.match(src, /\{failed && \(\s*<div role="alert"/);
  assert.match(src, /Attribution numbers for this range are unavailable because the report could not be loaded\./);
  assert.match(src, /onClick=\{\(\) => \{ fetchAttribution\(\); \}\}[\s\S]{0,400}Try again/);
});

test('the top cards never fall back to literal zeros, the product price, or the reply\'s model', () => {
  for (const old of [
    "summary.totalRevenue.toLocaleString() : '0'",
    "`${summary.blendedRoas}x` : '0x'",
    "summary.blendedCac.toFixed(2) : '0.00'",
    "`${summary.repeatBuyerRate}%` : '0%'",
    'From {summary?.totalOrders || 0} verified',
    'Ad Spend: ${summary?.totalSpend || 0}'
  ]) {
    assert.equal(src.includes(old), false, `no zero fallback: ${old}`);
  }
  assert.doesNotMatch(src, /baseAov[^\n]*extractedPricing\.corePrice/, 'AOV is never the list price');
  assert.doesNotMatch(src, /report\?\.model === /, 'the model label follows the selected model');
  assert.match(src, /const missingText = loading \? 'Loading' : 'Unavailable';/);
  assert.match(src, /\{effectiveAov != null && \(\s*<span[^>]*>\s*vs \$\{effectiveAov\.toFixed\(2\)\} AOV/);
});

// R03: at 390px the header's control row did not wrap, so the page scrolled sideways and Export
// CSV and Shopify sat off-screen (content 556px wide in a 390px view). A fixed grid minimum did
// the same at 320px: the page pads 36px a side and cards pad again, so 240px was already too wide.

test('the header controls wrap on a phone instead of scrolling sideways', () => {
  const at = src.indexOf('{/* Attribution Model Switcher */}');
  assert.ok(at > 0, 'the model switcher is still in the header');
  const open = src.lastIndexOf('<div style={{', at);
  const style = src.slice(open, src.indexOf('}}>', open));
  assert.match(style, /display: 'flex'/);
  assert.match(style, /flexWrap: 'wrap'/, 'the row holding Export CSV and Shopify wraps');
  const row = src.slice(open, src.indexOf('{failed && (', open));
  assert.match(row, /Export CSV/);
  assert.match(row, /<span>Shopify<\/span>/);
});

test('every grid column minimum gives way to a narrower container', () => {
  const minimums = [...src.matchAll(/minmax\(([^,]+),/g)].map(m => m[1].trim());
  assert.ok(minimums.length >= 6, 'the card grids are still auto-fit grids');
  for (const min of minimums) {
    assert.match(min, /^min\(\d+px$/, `minmax(${min}, ...) can outgrow a phone; use minmax(min(Npx, 100%), 1fr)`);
  }
  assert.doesNotMatch(src, /minmax\(\d+px/);
});

// R04: with the report missing or failed, the retention and AOV sections still read $0.00, 0%,
// "(0 orders)", "100.0% share" and "Safety Nets Active: Listening for abandoned checkouts...",
// because `retention` fell back to a zero-filled object and the streams to a zero-filled list.
// Unmeasured touch counts and channel cells printed an em dash. Now every figure the report did
// not measure reads Unavailable (Loading while it loads), a rate needs its denominator, and the
// section claims nothing about what is connected.

const view = src.slice(src.indexOf('  return (\n    <div style={{'));

test('no em dash or spaced en dash stands in for an unmeasured number', () => {
  assert.equal(src.includes('—'), false, 'no em dash anywhere in the view');
  assert.doesNotMatch(src, / – /);
  assert.match(src, /Page views \{report\?\.touchCounts\?\.pageViews \?\? missingText\}/);
  assert.match(src, /Email sends \{report\?\.touchCounts\?\.emailSends \?\? missingText\}/);
  assert.match(src, /Email clicks \{report\?\.touchCounts\?\.emailClicks \?\? missingText\}/);
});

test('retention figures come only from the report, never a zero-filled stand-in', () => {
  assert.doesNotMatch(src, /retentionTelemetry \|\| \{/, 'no zero-filled fallback object');
  assert.match(src, /const retention = report\?\.retentionTelemetry \?\? null;/);
  // Every read of a retention figure in the view sits behind a null check.
  const reads = [...view.matchAll(/retention\.(\w+)/g)];
  assert.ok(reads.length >= 8, 'the section still renders the retention figures');
  for (const m of reads) {
    const before = view.slice(Math.max(0, m.index - 160), m.index);
    assert.match(before, /retention (\?|&&)/, `retention.${m[1]} is read without a null check`);
  }
  assert.match(src, /const pacingPercent: number \| null = retention &&/);
  assert.match(view, /pacingPercent != null \? `\$\{pacingPercent\}% Pace` : `Pace \$\{missingText\}`/);
});

test('a recovery or rescue rate needs its denominator', () => {
  assert.match(src, /const checkoutRate = retention && retention\.abandonedCheckoutsCount > 0 \?/);
  assert.match(src, /const upsellRate = retention && retention\.upsellDeclinesCount > 0 \?/);
  assert.match(view, /checkoutRate != null \? `\$\{checkoutRate\}% Recovery Rate` : retention \? 'No abandoned checkouts' : `Recovery rate \$\{missingText\}`/);
  assert.match(view, /upsellRate != null \? `\$\{upsellRate\}% Rescue Rate` : retention \? 'No declined upsells' : `Rescue rate \$\{missingText\}`/);
  assert.match(view, /\{checkoutRate != null && \(\s*<span[^>]*>\s*\{cartAhead \?/, 'no "Pacing (0% vs 18%)" without a rate');
  assert.match(view, /\{upsellRate != null && \(\s*<span[^>]*>\s*\{upsellAhead \?/);
});

test('the section claims nothing it cannot back', () => {
  for (const claim of ['Listening for abandoned checkouts', 'Safety Nets Active', '100% Margin', 'Modeled Lift', '$0 ad cost deducted']) {
    assert.equal(src.includes(claim), false, `no claim: ${claim}`);
  }
  assert.match(view, /\{retention && retention\.totalRetentionOrders === 0 && \(/, 'the zero-state needs a report');
});

test('revenue streams read Unavailable without the report, and a share or take rate needs a denominator', () => {
  assert.match(src, /const streamsMeasured = Boolean\(aovExp\?\.streams\);/);
  assert.match(src, /const streamShareMeasured = streamsMeasured && \(aovExp\?\.combinedRevenue \|\| 0\) > 0;/);
  assert.match(src, /const streamTakeMeasured = streamsMeasured && totalOrders > 0;/);
  assert.match(view, /\{streamsMeasured \? money\(stream\.revenue\) : missingText\}/);
  assert.match(view, /\{streamShareMeasured && stream\.percentageOfTotal !== null && \(\s*<span[^>]*>\s*\{stream\.percentageOfTotal\.toFixed\(1\)\}% share/);
  assert.match(view, /!streamsMeasured \? missingText : isCore \?/);
  assert.match(view, /!streamTakeMeasured \|\| stream\.aovContribution === null \? missingText : isCore \?/);
  assert.match(view, /const width = streamShareMeasured && stream\.percentageOfTotal !== null \? Math\.max\(0, stream\.percentageOfTotal\) : 0;/);
  assert.match(view, /Total Attributed: \{totalAttributed != null \? money\(totalAttributed\) : missingText\}/);
  assert.doesNotMatch(src, /summary\?\.totalRevenue \|\| 0\)\)\.toLocaleString/);
  assert.match(view, /baseAov == null \? `AOV lift \$\{missingText\}` : 'Baseline Offer Active'/);
});

test('channel cells without orders, spend or clicks say so instead of 0 or a dash', () => {
  assert.match(view, /const hasOrders = ch\.orders > 0;/);
  assert.match(view, /\{ch\.spend > 0 \? \(ch\.roas === null \? missingText : `\$\{ch\.roas\}x`\) : 'No spend'\}/);
  assert.match(view, /\{hasOrders && ch\.cac !== null \? `\$\$\{ch\.cac\.toFixed\(2\)\}` : missingText\}/);
  assert.match(view, /\{ch\.clicks > 0 \? `\$\{ch\.conversionRate\}%` : missingText\}/);
  assert.match(view, /\{hasOrders \? `\$\$\{baseVal\.toFixed\(2\)\}` : unmeasured\}/);
  assert.match(view, /\{hasOrders \? `\$\$\{aovVal\.toFixed\(2\)\}` : unmeasured\}/);
});

test('no text in the view is under 11px', () => {
  assert.doesNotMatch(src, /fontSize: '(?:[0-9]|10)px'/);
});

// T05: with no report, on the default lead journey (no checkout, no upsell), the safety-net card
// still read "Standard 18% / 15%  $1,215 /mo modeled target", built from DEFAULT_FORECAST's traffic
// and prices with both recovery flows forced on, above "Checkout Cart Recovery" and "24-Hour
// Courtesy Upsell Rescue" cards and the claim "... with zero additional ad spend". The route also
// answered 0 for every rate it had no denominator for. Now: the section shows only on a journey
// with a checkout or an upsell, each flow card only for its own step, a target only from a forecast
// the user saved, profit only from the product cost they entered, and a rate without a denominator
// is null.

test('the route answers null, never 0, for every rate with no denominator', async () => {
  const r = await fullReport();
  const t = r.retentionTelemetry;
  assert.equal(t.checkoutRecoveryRate, null, 'no abandoned checkouts');
  assert.equal(t.upsellRecoveryRate, null, 'no declined upsells');
  // Counts and sums read from streams that were read are measured zeros.
  assert.equal(t.abandonedCheckoutsCount, 0);
  assert.equal(t.upsellDeclinesCount, 0);
  assert.equal(t.totalRetentionRevenue, 0);
  const a = r.aovExpansion;
  for (const key of ['baseAov', 'effectiveAov', 'aovLiftDollars', 'aovLiftPercent', 'recoveryRate']) {
    assert.equal(a[key], null, `aovExpansion.${key}`);
  }
  assert.equal(a.totalOrders, 0);
  assert.equal(a.combinedRevenue, 0);
  for (const stream of a.streams) {
    assert.equal(stream.percentageOfTotal, null, `${stream.tier} share of no revenue`);
    assert.equal(stream.attachRate, null, `${stream.tier} take rate of no orders`);
    assert.equal(stream.aovContribution, null, `${stream.tier} per-order value of no orders`);
    assert.equal(stream.revenue, 0);
  }
  for (const step of r.funnelSteps) {
    assert.equal(step.percentage, null, `${step.id} share of no views`);
    assert.equal(step.dropoffRate, null, `${step.id} drop from no previous step`);
    assert.equal(step.count, 0);
  }
  for (const ch of r.channels) {
    for (const key of ['roas', 'cac', 'conversionRate', 'baseAov', 'aov', 'aovLift', 'bumpAttachRate', 'upsellAttachRate']) {
      assert.equal(ch[key], null, `${ch.channelId}.${key}`);
    }
  }
});

test('an upsell viewed with no orders has no drop-off, and a measured rate is still a number', async () => {
  const r = await fullReport({
    events: [
      { type: 'page_view', userId: 'u1', at: ago(1) },
      { type: 'upsell_view', userId: 'u1', at: ago(1) },
      { type: 'upsell_decline', userId: 'u1', email: 'a@x.test', at: ago(1) }
    ],
    checkouts: [{ userId: 'u1', abandonedAt: ago(1), recoveryStatus: 'recovered', totalPrice: 30 }, { userId: 'u1', abandonedAt: ago(2) }]
  });
  const upsell = r.funnelSteps.find(step => step.id === 'upsells');
  assert.ok(upsell, 'the upsell step is listed');
  assert.equal(upsell.dropoffRate, null, 'no orders to drop from, where Math.max(1, 0) used to read 100%');
  assert.equal(r.funnelSteps[0].percentage, 100);
  assert.equal(r.funnelSteps[1].percentage, 0, 'a share of a real denominator stays a measured 0');
  assert.equal(r.retentionTelemetry.checkoutRecoveryRate, 50);
  assert.equal(r.retentionTelemetry.upsellRecoveryRate, 0, 'one decline and no rescue is a measured 0%');
});

test('orders give the streams and channels measured shares, take rates and averages', async () => {
  const r = await fullReport({
    orders: [{ id: 'o1', userId: 'u1', totalPrice: 40, customerEmail: 'a@x.test', createdAt: ago(1) }]
  });
  const core = r.aovExpansion.streams.find(stream => stream.tier === 'core');
  assert.equal(core.percentageOfTotal, 100);
  assert.equal(core.attachRate, 100);
  assert.equal(core.aovContribution, 40);
  const bump = r.aovExpansion.streams.find(stream => stream.tier === 'bump');
  assert.equal(bump.attachRate, 0, 'no bump on a real order is a measured 0%');
  assert.equal(bump.percentageOfTotal, 0);
  assert.equal(r.aovExpansion.baseAov, 40);
  assert.equal(r.aovExpansion.aovLiftDollars, 0);
  const direct = r.channels.find(ch => ch.orders > 0);
  assert.equal(direct.cac, 0, 'no spend over a real order is a real $0 CAC');
  assert.equal(direct.roas, null, 'no spend, no return on it');
  assert.equal(direct.aov, 40);
});

test('the recovery section shows only on a journey with a checkout or an upsell, one card per step', () => {
  assert.match(src, /const hasCheckoutStep = nodes\.some\(n => n\.data\?\.type === 'landing-page' && sellsThroughCheckout\(n\)\);/);
  assert.match(src, /const hasUpsellStep = nodes\.some\(n => n\.data\?\.type === 'upsell'\);/);
  assert.match(src, /const showRecovery = hasCheckoutStep \|\| hasUpsellStep;/);
  assert.match(view, /\{showRecovery && \(\s*<div style=\{\{[\s\S]{0,1400}Retention Safety Nets/, 'the whole section is gated');
  assert.match(view, /\{hasCheckoutStep && \(\s*<div[\s\S]{0,1600}Checkout Cart Recovery/);
  assert.match(view, /\{hasUpsellStep && \(\s*<div[\s\S]{0,1600}24-Hour Courtesy Upsell Rescue/);
});

test('the target comes only from a saved forecast, counting only the flows the journey has', () => {
  assert.match(src, /const hasSavedForecast = Boolean\(forecast\?\.savedAt\);/);
  assert.match(src, /const savedForecast: FunnelForecast \| null = hasSavedForecast && forecast \?/);
  assert.match(src, /cartRecoveryEnabled: hasCheckoutStep,\s*upsellRescueEnabled: hasUpsellStep/);
  assert.doesNotMatch(src, /cartRecoveryEnabled: true|upsellRescueEnabled: true/, 'no flow is forced on');
  assert.match(src, /const simulatedTarget = savedForecast \? calculateFunnelForecast\(savedForecast\) : null;/);
  assert.doesNotMatch(src, /Standard 18% \/ 15%/);
  assert.doesNotMatch(src, /\|\| 18\b|\|\| 15\b/, 'no default benchmark rate');
  assert.match(view, /\{monthlyTarget != null\s*\?[\s\S]{0,200}: 'Unavailable'\}/);
  assert.match(view, /Save a forecast in the Forecaster to set this target\./);
  assert.match(src, /const pacingPercent: number \| null = retention && monthlyTarget != null && monthlyTarget > 0/);
  assert.match(view, /\{targetCartRecoveryRate != null && \(/);
  assert.match(view, /\{targetUpsellRescueRate != null && \(/);
});

test('profit uses the product cost the user entered, and the section makes no claim', () => {
  assert.doesNotMatch(src, /retentionNetProfit/, 'the route\'s assumed 80% margin is not shown');
  assert.doesNotMatch(src, /80% of reclaimed revenue/);
  assert.match(src, /const recoveredProfit: number \| null = retention && productCostPercent != null/);
  assert.match(view, /Enter your product cost in the Forecaster to see this\./);
  for (const claim of ['zero additional ad spend', 'Zero extra ad cost', 'Pure Net Profit']) {
    assert.equal(src.includes(claim), false, `no claim: ${claim}`);
  }
  assert.match(view, /Orders that came back after a checkout was left or an upsell was declined, and the revenue from them\./);
});

test('a rate the route leaves null is never printed as "null%" or 0%', () => {
  assert.match(view, /stream\.recoveryRate != null \? ` \(\$\{stream\.recoveryRate\}% recovery rate/);
  assert.doesNotMatch(src, /stream\.recoveryRate \|\| 0/);
  assert.match(view, /ch\.bumpAttachRate != null \? `\$\{ch\.bumpAttachRate\}%` : missingText/);
  assert.match(view, /ch\.upsellAttachRate != null \? `\$\{ch\.upsellAttachRate\}%` : missingText/);
});

// T04: at 390px the channel table scrolls sideways inside a box that had no name, no tab stop
// and no role, so a keyboard user could reach it only where the browser makes scrollers
// focusable on its own. Its card also clipped (overflow hidden), and in the view's scrolling
// column a clipping card may shrink to its borders: the whole table rendered 2px tall at every
// width, and the clipping cut off the scroller's focus ring. With the report missing, the table
// was headers over nothing.

const channelCard = src.slice(src.indexOf('{/* Channel Breakdown Table'), src.indexOf('{/* Two-Column Grid'));

test('the channel table scroller is a named region with a tab stop while it scrolls', () => {
  assert.ok(channelCard.length > 0, 'the channel card is still in the view');
  const open = channelCard.indexOf('ref={channelScrollRef}');
  assert.ok(open > 0, 'the scroller is measured');
  const scroller = channelCard.slice(channelCard.lastIndexOf('<div', open), channelCard.indexOf('>', channelCard.indexOf('style={{', open)));
  assert.match(scroller, /role="region"/);
  assert.match(scroller, /aria-labelledby=\{channelTableTitleId\}/, 'the region is named by the table heading');
  assert.match(scroller, /tabIndex=\{channelTableScrolls \? 0 : undefined\}/, 'a tab stop exactly while it scrolls');
  assert.match(scroller, /overflowX: 'auto'/);
  assert.match(channelCard, /<h2 id=\{channelTableTitleId\}[^>]*>\s*Acquisition & Conversion Channel Breakdown/);
  assert.match(channelCard, /<table aria-labelledby=\{channelTableTitleId\}/, 'the table carries the same name');
  assert.match(src, /const channelTableTitleId = useId\(\);/);
  // The tab stop follows the table's real width, and is read again when the view or data changes.
  assert.match(src, /setChannelTableScrolls\(box\.scrollWidth > box\.clientWidth \+ 1\)/);
  assert.match(src, /new ResizeObserver\(read\)[\s\S]{0,200}ro\.observe\(box\)[\s\S]{0,200}\}, \[channelViewMode, report, loading, nodes\]\);/);
});

test('the channel card neither clips nor shrinks, so the table and its focus ring show', () => {
  const card = channelCard.slice(channelCard.indexOf('<div style={{'), channelCard.indexOf('}}>') + 3);
  assert.doesNotMatch(card, /overflow/, 'a clipping card collapsed to its borders and cut off the ring');
  assert.match(card, /flexShrink: 0/);
  assert.match(channelCard, /borderRadius: '0 0 11px 11px'/, 'the scroller rounds its own corners instead');
});

test('the table view buttons say which is on, and their row wraps on a phone', () => {
  assert.match(channelCard, /<div role="group" aria-label="Table view" style=\{\{\s*display: 'flex',\s*flexWrap: 'wrap'/);
  for (const mode of ['offers', 'roi', 'all']) {
    assert.match(channelCard, new RegExp(`type="button"\\s*aria-pressed=\\{channelViewMode === '${mode}'\\}\\s*onClick=\\{\\(\\) => setChannelViewMode\\('${mode}'\\)\\}`));
  }
  assert.match(channelCard, /<div style=\{\{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' \}\}>\s*\{\/\* Table View Switcher/);
});

test('without a report the channel table says so instead of showing headers over nothing', () => {
  assert.match(channelCard, /\{!report\?\.channels\?\.length && \(\s*<tr>\s*<td\s*colSpan=\{tableMode === 'all' \? 12 : 9\}/);
  assert.match(channelCard, /\{report \? 'No channels in this range\.' : missingText\}/);
  // The column counts the header renders in each view: offers 9, roi 9, all 12.
  const head = channelCard.slice(channelCard.indexOf('<thead>'), channelCard.indexOf('</thead>'));
  const count = mode => {
    let n = 0;
    const cond = { "tableMode !== 'offers'": mode !== 'offers', "tableMode === 'roi'": mode === 'roi', "tableMode !== 'roi'": mode !== 'roi' };
    // Walk the header: a {cond && (...)} block counts its <th> only when cond holds for this view.
    const re = /\{(tableMode [!=]== '\w+') && \(|<th\b|\)\}/g;
    const stack = [];
    for (const m of head.matchAll(re)) {
      if (m[1]) stack.push(cond[m[1]]);
      else if (m[0] === ')}') stack.pop();
      else if (stack.every(Boolean)) n++;
    }
    return n;
  };
  assert.equal(count('offers'), 9);
  assert.equal(count('roi'), 9);
  assert.equal(count('all'), 12);
});

// U06: under Effective Blended AOV the page read "Allowable CAC: up to $22.50", the measured $50.00
// AOV times a hard-coded 45% the user never entered, and the route still sent a profit figure from
// an assumed 20% product cost. On a lead journey (no checkout, no upsell, no priced bump) the page
// still showed the whole offer revenue section and the channel table's AOV and attach columns,
// every figure Unavailable, for offers the journey does not have. And the header read Unavailable
// for page views, sends and clicks when the log was read and simply had none. Now: the CAC line
// needs the product cost saved in the Forecaster, a lead journey shows lead measures only, and a
// count from a stream that was read is a number, 0 included.

test('a stream that was read with no events counts 0, and email reads Unavailable only while it is not connected', async () => {
  const connected = await fullReport({ hubReady: true });
  assert.deepEqual(connected.touchCounts, { pageViews: 0, emailSends: 0, emailClicks: 0 });
  const offline = await fullReport({ hubReady: false });
  assert.deepEqual(offline.touchCounts, { pageViews: 0, emailSends: null, emailClicks: null }, 'email is not connected, so its stream was never there');
  const logged = await fullReport({
    hubReady: false,
    events: ['page_view', 'page_view', 'email_sent', 'email_clicked'].map(type => ({ type, userId: 'u1', at: ago(1) }))
  });
  assert.deepEqual(logged.touchCounts, { pageViews: 2, emailSends: 1, emailClicks: 1 }, 'what the log holds is measured whatever the connection says now');
});

test('an event log that cannot be read answers 503 with one sentence, never a report of zeros', async () => {
  for (const loadEvents of [() => { throw new Error('disk gone'); }, () => null]) {
    const { status, json } = await rawReport({ hubReady: true, loadEvents });
    assert.equal(status, 503);
    assert.equal(json.success, false);
    assert.equal(json.report, undefined);
    assert.equal(json.error, 'The event log could not be read, so this report is unavailable.');
  }
});

test('the route sends no profit figure built on an assumed product cost', async () => {
  const r = await fullReport({ checkouts: [{ userId: 'u1', abandonedAt: ago(1), recoveryStatus: 'recovered', totalPrice: 100 }] });
  assert.equal(r.retentionTelemetry.totalRetentionRevenue, 100);
  assert.equal('retentionNetProfit' in r.retentionTelemetry, false);
  const route = fs.readFileSync(new URL('./server/routes/analyticsRoutes.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /\* 0\.80\b/);
});

test('the Allowable CAC line needs the product cost the user saved', () => {
  assert.doesNotMatch(src, /0\.45/, 'no hard-coded 45%');
  assert.match(src, /const productCostPercent = savedForecast \? measuredNumber\(savedForecast\.cogsPercentage\) : null;/);
  assert.match(src, /const allowableCac: number \| null = effectiveAov != null && productCostShare != null\s*\? Number\(\(effectiveAov \* \(1 - productCostShare \/ 100\)\)\.toFixed\(2\)\)\s*: null;/);
  const line = view.match(/\{(\w+) != null && \(\s*<span[^>]*>\s*Allowable CAC: up to \$\{(\w+)\.toFixed\(2\)\} at your \{productCostShare\}% product cost/);
  assert.ok(line, 'the line is gated and names the cost it used');
  assert.equal(line[1], 'allowableCac');
  assert.equal(line[2], 'allowableCac');
  assert.equal((view.match(/Allowable CAC/g) || []).length, 1);
});

test('a lead journey shows no offer revenue section and no AOV columns', () => {
  assert.match(src, /const sellsOffers = showRecovery \|\| extractedPricing\.hasBump;/);
  assert.match(src, /const tableMode = sellsOffers \? channelViewMode : 'roi';/);
  // The whole revenue section, streams, allocation bar and AOV banner included, sits behind it.
  const section = view.slice(view.indexOf('{/* Funnel Revenue Streams & AOV Expansion Section'), view.indexOf('{/* Channel Breakdown Table'));
  assert.match(section, /^\{\/\* Funnel Revenue Streams & AOV Expansion Section[^}]*\*\/\}\s*\{sellsOffers && \(/);
  for (const text of ['Funnel Revenue Streams & AOV Expansion', 'Funnel Revenue Stream Allocation', 'Effective Blended AOV', 'streams.map']) {
    assert.ok(section.includes(text), `${text} is inside the gated section`);
    assert.equal(view.indexOf(text), view.indexOf(section) + section.indexOf(text), `${text} appears nowhere else`);
  }
  assert.match(section, /\)\}\s*$/, 'the gate closes after the section');
  // The table's offer view and switcher exist only when the journey sells something.
  assert.match(channelCard, /\{sellsOffers && \(\s*<div role="group" aria-label="Table view"/);
  assert.doesNotMatch(channelCard.slice(channelCard.indexOf('<table')), /channelViewMode/, 'the table renders the effective view');
});
