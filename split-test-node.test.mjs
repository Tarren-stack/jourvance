import test from 'node:test';
import assert from 'node:assert/strict';
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
 * Mirror of statistical confidence calculation used in AbSplitEditor.tsx
 */
function calculateStatisticalConfidence(visA, convA, visB, convB) {
  if (visA < 10 || visB < 10 || (convA === 0 && convB === 0)) {
    return { confidence: 0, zScore: 0, pValue: 1, isSignificant: false };
  }
  const p1 = convA / visA;
  const p2 = convB / visB;
  const pPool = (convA + convB) / (visA + visB);
  const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / visA + 1 / visB));
  if (sePool === 0) {
    return { confidence: 0, zScore: 0, pValue: 1, isSignificant: false };
  }
  const z = Math.abs((p1 - p2) / sePool);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014337;
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pValue = 2 * (d * Math.exp(-0.5 * z * z) * poly);
  const confidence = Math.min(99.9, Math.max(0, Number(((1 - pValue) * 100).toFixed(1))));
  return {
    confidence,
    zScore: Number(z.toFixed(2)),
    pValue: Number(pValue.toFixed(4)),
    isSignificant: confidence >= 95.0
  };
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
  // Case 1: Small sample (under 10 visitors) -> should return 0% confidence
  const smallSample = calculateStatisticalConfidence(5, 1, 6, 2);
  assert.equal(smallSample.isSignificant, false);
  assert.equal(smallSample.confidence, 0);

  // Case 2: Identical conversion rate (no difference)
  const identical = calculateStatisticalConfidence(100, 10, 100, 10);
  assert.equal(identical.isSignificant, false);
  assert.equal(identical.confidence, 0);

  // Case 3: Statistically significant winner (e.g. 500 visitors: 15 conversions (3%) vs 45 conversions (9%))
  const significant = calculateStatisticalConfidence(500, 15, 500, 45);
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
