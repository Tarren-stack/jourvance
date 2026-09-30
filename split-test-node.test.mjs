import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { build } from 'esbuild';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';
// The confidence test is the real one the split card and editor read (C23), not a mirror.
import { splitTest, MIN_SPLIT_BRANCH_SAMPLE } from './src/lib/journeyMetrics.ts';
function getStepBenchmark(sourceType, targetType, rate = 0, sourceThroughput = 0, targetCount = 0) {
  let metricName = 'Pass-Through Rate';
  let metricShort = 'FLOW';
  let poorThreshold = 10.0;
  let healthyThreshold = 25.0;
  let topThreshold = 40.0;
  let industryBenchmarkDesc = 'Typical multi-step funnel transition baseline (15–30%).';

  if (sourceType === 'ad-source' && (targetType === 'landing-page' || targetType === 'ab-split')) {
    metricName = 'Click-Through Rate';
    metricShort = 'CTR';
    poorThreshold = 1.2;
    healthyThreshold = 2.0;
    topThreshold = 3.2;
    industryBenchmarkDesc = 'Direct-response ad traffic averages 1.2%–2.5% CTR across Meta & Google.';
  } else if (sourceType === 'ab-split') {
    metricName = 'Traffic Split Allocation';
    metricShort = 'SPLIT';
    poorThreshold = 20.0;
    healthyThreshold = 40.0;
    topThreshold = 50.0;
    industryBenchmarkDesc = 'Portion of total funnel traffic routed down this testing branch.';
  }

  const status = rate >= topThreshold ? 'top_performer' : rate >= healthyThreshold ? 'healthy' : 'needs_work';
  return { metricName, metricShort, poorThreshold, healthyThreshold, topThreshold, status, industryBenchmarkDesc };
}

function getStepOptimizationTips(sourceType, targetType) {
  if (sourceType === 'ab-split') {
    return [
      {
        title: 'Check Statistical Sample Size',
        description: 'Aim for at least 100 visitors and 10+ conversions per branch before declaring a definitive winning variation.',
        badge: 'CONFIDENCE'
      },
      {
        title: 'Lock In the Winning Branch',
        description: 'Once a variant demonstrates clear conversion or revenue lift, declare the winner to direct 100% of future traffic to it.',
        badge: 'TRAFFIC LOCK'
      }
    ];
  }
  return [];
}

/**
 * Server routing simulation logic
 */
function resolveSplitVariantLogic({ splitRatio = 50, winner = null, queryVar = '', cookieHeader = '', slug = 'test' }, randomVal = 0.5) {
  // 1. Query override
  const q = String(queryVar).toLowerCase();
  if (q === 'a' || q === 'b') return q;

  // 2. Cookie stickiness
  const match = cookieHeader.match(new RegExp(`jv_split_${slug}=(a|b)`, 'i'));
  if (match && match[1]) return match[1].toLowerCase();

  // 3. Winner lock
  if (winner === 'a' || splitRatio === 100) return 'a';
  if (winner === 'b' || splitRatio === 0) return 'b';

  // 4. Split ratio allocation
  return (randomVal * 100 < splitRatio) ? 'a' : 'b';
}

function buildRedirectUrl(targetSlug, incomingQuery, slug, variant) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(incomingQuery)) {
    params.set(k, String(v));
  }
  params.set('jv_split', slug);
  params.set('jv_var', variant);
  return `/p/${targetSlug}?${params.toString()}`;
}

test('A/B Split Router respects QA query parameter override (?jv_var=a|b)', () => {
  const resultA = resolveSplitVariantLogic({ queryVar: 'a', slug: 'spring-promo' }, 0.99);
  assert.equal(resultA, 'a', 'Query var=a must override random split');

  const resultB = resolveSplitVariantLogic({ queryVar: 'b', slug: 'spring-promo' }, 0.01);
  assert.equal(resultB, 'b', 'Query var=b must override random split');
});

test('A/B Split Router preserves sticky cookie across repeat requests', () => {
  const headersWithA = `other_cookie=xyz; jv_split_holiday=a; session_id=123`;
  const resultStickyA = resolveSplitVariantLogic({
    cookieHeader: headersWithA,
    slug: 'holiday',
    splitRatio: 50
  }, 0.99); // Even with randomVal at 0.99, cookie 'a' must stick!
  assert.equal(resultStickyA, 'a', 'Existing jv_split cookie must lock visitor to branch a');

  const headersWithB = `jv_split_holiday=b`;
  const resultStickyB = resolveSplitVariantLogic({
    cookieHeader: headersWithB,
    slug: 'holiday',
    splitRatio: 80
  }, 0.05); // Even with 80% A weight and 0.05 random, cookie 'b' must stick!
  assert.equal(resultStickyB, 'b', 'Existing jv_split cookie must lock visitor to branch b');
});

test('A/B Split Router 1-click winner declaration locks 100% of future traffic', () => {
  const winnerA = resolveSplitVariantLogic({ winner: 'a', splitRatio: 100, slug: 'offer' }, 0.95);
  assert.equal(winnerA, 'a');

  const winnerB = resolveSplitVariantLogic({ winner: 'b', splitRatio: 0, slug: 'offer' }, 0.05);
  assert.equal(winnerB, 'b');
});

test('A/B Split Router forwards all incoming UTM params and appends jv_split & jv_var', () => {
  const query = {
    utm_source: 'facebook',
    utm_campaign: 'spring_scale',
    utm_medium: 'cpc',
    fbclid: 'IwAR0123456789'
  };

  const redirectUrl = buildRedirectUrl('offer-control', query, 'spring-split', 'a');
  assert.ok(redirectUrl.startsWith('/p/offer-control?'));
  assert.ok(redirectUrl.includes('utm_source=facebook'));
  assert.ok(redirectUrl.includes('utm_campaign=spring_scale'));
  assert.ok(redirectUrl.includes('fbclid=IwAR0123456789'));
  assert.ok(redirectUrl.includes('jv_split=spring-split'));
  assert.ok(redirectUrl.includes('jv_var=a'));
});

test('Statistical confidence calculator accurately identifies significant lift vs inconclusive noise', () => {
  // Case 1: Small sample (under the per-branch sample) -> the test does not run, so there is no
  // confidence figure at all rather than 0%
  const smallSample = splitTest(5, 1, 6, 2);
  assert.equal(smallSample.ran, false);
  assert.equal(smallSample.reason, 'too_few_visits');
  assert.equal(splitTest(MIN_SPLIT_BRANCH_SAMPLE - 1, 10, 500, 50).ran, false);

  // Case 2: Identical conversion rate (no difference): the test runs and finds nothing
  const identical = splitTest(100, 10, 100, 10);
  assert.equal(identical.isSignificant, false);
  assert.equal(identical.confidence, 0);

  // Case 3: Statistically significant winner (e.g. 500 visitors: 15 conversions (3%) vs 45 conversions (9%))
  const significant = splitTest(500, 15, 500, 45);
  assert.equal(significant.isSignificant, true);
  assert.ok(significant.confidence >= 95.0, `Confidence was ${significant.confidence}%`);
  assert.ok(significant.pValue < 0.05, `pValue was ${significant.pValue}`);
});

test('Step benchmarks support ab-split as a source node with appropriate allocation metrics', () => {
  const benchmark = getStepBenchmark('ab-split', 'landing-page', 50.0, 500, 250);
  assert.equal(benchmark.metricName, 'Traffic Split Allocation');
  assert.equal(benchmark.metricShort, 'SPLIT');
  assert.equal(benchmark.status, 'top_performer');

  const tips = getStepOptimizationTips('ab-split', 'landing-page');
  assert.ok(tips.length >= 2);
  assert.ok(tips.some(t => t.badge === 'CONFIDENCE'));
  assert.ok(tips.some(t => t.badge === 'TRAFFIC LOCK'));
});

// The split card's branch figure (finding C40). The stats route fills branch*Conversions with a
// branch's orders, or with its leads when it has none, so on a lead-gen split the card printed
// sign-ups under "Orders". The card is bundled with esbuild and rendered over the route's own
// answer, so the test reads the label a person sees beside the figure the server counted.
const ROOT = new URL('.', import.meta.url).pathname;
async function splitCardRenderer() {
  const out = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { ReactFlowProvider } from '@xyflow/react';
        import { AbSplitNode } from './src/components/canvas/nodes/AbSplitNode.tsx';
        import { CanvasMetricsContext } from './src/components/canvas/CanvasMetrics.tsx';
        export const splitCard = (measure, data = {}) => renderToStaticMarkup(
          React.createElement(ReactFlowProvider, null,
            React.createElement(CanvasMetricsContext.Provider, { value: { view: null, edges: {}, nodes: { s1: { measure, note: 'Measured, last 30 days' } } } },
              React.createElement(AbSplitNode, { id: 's1', data: { slug: 's', splitRatio: 50, ...data }, selected: false }))));`,
      resolveDir: ROOT,
      loader: 'tsx'
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
  });
  const dir = mkdtempSync(join(tmpdir(), 'jv-split-card-'));
  const file = join(dir, 'split-card.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  try {
    return (await import(pathToFileURL(file).href)).splitCard;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** POST /api/funnel/stats for a split whose two pages took leads and no orders. */
async function leadSplitStats() {
  const at = new Date().toISOString();
  const ev = [];
  for (let i = 0; i < 10; i++) ev.push({ type: 'split_route', nodeId: 'split', variant: i < 5 ? 'a' : 'b', visitorId: `v${i}` });
  ev.push({ type: 'lead', nodeId: 'pa', visitorId: 'v0', email: 'a@x.com' }, { type: 'lead', nodeId: 'pa', visitorId: 'v1', email: 'b@x.com' });
  ev.push({ type: 'lead', nodeId: 'pb', visitorId: 'v5', email: 'c@x.com' });
  const mine = { userId: 'u1', journeyId: 'j1' };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    requireOperator: (_req, _res, next) => next(),
    loadEvents: () => ev.map(e => ({ ...mine, at, ...e })),
    loadOrders: () => [], loadContacts: () => [], loadDrips: () => ({ enrollments: [] }), loadCheckouts: () => [],
    publicPageCache: { 'split:s': mine, a: mine, b: mine },
    journeyCache: {}, contactsForUser: () => [], userProgramBag: () => ({ flows: [], flowEnrollments: [] }),
    writeUserPrograms: () => {}, messageStatsFor: () => ({ sent: 0 }), hubReady: false
  };
  const app = express();
  app.use(express.json());
  setupAnalyticsRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/funnel/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'j1', days: 30,
        nodes: [{ id: 'split', type: 'ab-split', slug: 's' }, { id: 'pa', type: 'landing-page', slug: 'a' }, { id: 'pb', type: 'landing-page', slug: 'b' }],
        edges: [{ id: 'ea', source: 'split', target: 'pa', sourceHandle: 'branch-a' }, { id: 'eb', source: 'split', target: 'pb', sourceHandle: 'branch-b' }]
      })
    });
    assert.equal(res.status, 200);
    return (await res.json()).stats.nodes.split;
  } finally {
    server.close();
  }
}

const cardText = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('a lead-gen split card calls its branch figure conversions, never orders (C40)', async () => {
  const stats = await leadSplitStats();
  // The route counts each branch's leads because neither branch has an order.
  assert.equal(stats.branchAConversions, 2);
  assert.equal(stats.branchBConversions, 1);

  const splitCard = await splitCardRenderer();
  const card = cardText(splitCard(stats));
  assert.doesNotMatch(card, /\bOrders\b/);
  assert.match(card, /Visitors 5 Conversions 2 Conv\. Rate 40\.0%/);
  assert.match(card, /Visitors 5 Conversions 1 Conv\. Rate 20\.0%/);
  assert.match(card, /10 visitors . 3 conversions/);

  // Revenue view still reads sales, from the revenue figure.
  const roas = cardText(splitCard({ ...stats, branchAGrossRevenue: 120, branchBGrossRevenue: 0 }, { canvasViewMode: 'roas' }));
  assert.doesNotMatch(roas, /\bOrders\b/);
  assert.match(roas, /Sales \$120/);
});
