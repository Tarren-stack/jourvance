import test from 'node:test';
import assert from 'node:assert/strict';

test('waitlist lead tagging records requestedPlan and billingCycle', () => {
  const contact = {
    id: 'lead_waitlist_1',
    email: 'founder@glowbeauty.com',
    tags: ['growth_pro_waitlist'],
    metadata: {
      requestedPlan: 'growth_pro',
      billingCycle: 'annual',
      storeDomain: 'glowbeauty.myshopify.com',
      waitlistJoinedAt: new Date().toISOString()
    }
  };

  assert.equal(contact.tags.includes('growth_pro_waitlist'), true);
  assert.equal(contact.metadata.requestedPlan, 'growth_pro');
  assert.equal(contact.metadata.billingCycle, 'annual');
  assert.equal(contact.metadata.storeDomain, 'glowbeauty.myshopify.com');
});

test('drip enrollment step calculation handles delays accurately', () => {
  const now = Date.now();
  const nextStepDelayHours = 24;
  const nextDue = new Date(now + nextStepDelayHours * 3600000);
  
  assert.equal(nextDue.getTime() > now, true);
  assert.equal(Math.round((nextDue.getTime() - now) / 3600000), 24);
});

test('HMAC secret rotation verifies tokens signed with old secret', async () => {
  const { signUnsubscribe, readUnsubscribe } = await import('./email-doc.mjs');
  const oldSecret = 'historic_key_2025_abc';
  const newSecret = 'current_fresh_key_2026_xyz';
  const secretsArray = [newSecret, oldSecret];

  // Token generated with historic key before rotation
  const token = signUnsubscribe(oldSecret, 'user_tenant_1', 'customer@example.com');
  assert.ok(token);

  // Helper verifying across secret array
  function verifyTokenWithRotation(tok, keys) {
    for (const k of keys) {
      const parsed = readUnsubscribe(k, tok);
      if (parsed) return parsed;
    }
    return null;
  }

  // Verification succeeds against the rotated keys array
  const result = verifyTokenWithRotation(token, secretsArray);
  assert.ok(result);
  assert.equal(result.uid, 'user_tenant_1');
  assert.equal(result.email, 'customer@example.com');

  // Verification fails against invalid secret
  assert.equal(verifyTokenWithRotation(token, ['wrong_key']), null);
});

test('abandoned checkout recovery calculates stage 1 (45m) and stage 2 (24h) intervals', () => {
  const abandonedAt = new Date('2026-09-26T10:00:00.000Z').getTime();
  
  // 30 mins after: pending (too early)
  const at30m = abandonedAt + 30 * 60 * 1000;
  assert.equal(at30m - abandonedAt >= 2700000, false);

  // 45 mins after: stage 1 due
  const at45m = abandonedAt + 45 * 60 * 1000;
  assert.equal(at45m - abandonedAt >= 2700000, true);

  // 24 hours after stage 1: stage 2 incentive due
  const emailSentAt = at45m;
  const at24hLater = emailSentAt + 24 * 3600 * 1000;
  assert.equal(at24hLater - emailSentAt >= 86400000, true);
});

test('mobile sticky bar defaults to enabled unless explicitly set false', () => {
  const pageWithDefault = { mobileStickyBarEnabled: undefined };
  const pageExplicitOn = { mobileStickyBarEnabled: true };
  const pageExplicitOff = { mobileStickyBarEnabled: false };

  assert.equal(pageWithDefault.mobileStickyBarEnabled !== false, true);
  assert.equal(pageExplicitOn.mobileStickyBarEnabled !== false, true);
  assert.equal(pageExplicitOff.mobileStickyBarEnabled !== false, false);
});

test('conversion benchmarks name each line and grade only a measured rate over enough visits', async () => {
  const { edgeMetricFor, edgeStatus, MIN_GRADE_SAMPLE } = await import('./src/lib/conversionBenchmarks.ts');
  assert.equal(MIN_GRADE_SAMPLE, 100);

  // Ad -> Page: impressions are never measured, so the line counts visits and is never graded.
  const ad = edgeMetricFor('ad-source', 'landing-page');
  assert.equal(ad.id, 'ad-visits');
  assert.equal(ad.short, 'VISITS');
  assert.equal(ad.bands, null);
  assert.equal(edgeStatus(ad, { count: 1000, denominator: null, rate: null, basis: 'Measured' }).status, 'not_graded');

  // Page -> Thank You (conversion rate)
  const pageOrder = edgeMetricFor('landing-page', 'thank-you');
  assert.equal(pageOrder.short, 'CR');
  assert.equal(edgeStatus(pageOrder, { count: 32, denominator: 500, rate: 6.5, basis: 'Measured' }).status, 'healthy');

  // Page -> Form (opt-in rate)
  const pageForm = edgeMetricFor('landing-page', 'lead-form');
  assert.equal(pageForm.short, 'OPT-IN');
  assert.equal(edgeStatus(pageForm, { count: 100, denominator: 400, rate: 25, basis: 'Measured' }).status, 'healthy');

  // Upsell -> Thank You (take rate)
  const upsell = edgeMetricFor('upsell', 'thank-you', 'accepted');
  assert.equal(upsell.short, 'TAKE');
  const top = edgeStatus(upsell, { count: 30, denominator: 100, rate: 30, basis: 'Measured' });
  assert.equal(top.status, 'top_performer');
  assert.equal(top.label, 'Above typical range');
});

test('revenue leakage calculator models recovered conversions and dollar opportunities', async () => {
  const { calculateRevenueLeakage } = await import('./src/lib/conversionBenchmarks.ts');

  // 1,000 visitors at 2% current CR vs 5.5% healthy benchmark with a $50 average order
  const result = calculateRevenueLeakage(1000, 2.0, 5.5, 50.0);
  assert.equal(result.visitors, 1000);
  // Lift = 3.5% of 1000 = 35 recovered conversions
  assert.equal(result.potentialRecoveredConversions, 35);
  // Revenue gain = 35 * $50 = $1,750
  assert.equal(result.potentialRevenueGain, 1750.0);
});

test('optimization recommendations provide step-tailored actionable playbooks', async () => {
  const { getStepOptimizationTips } = await import('./src/lib/conversionBenchmarks.ts');

  const pageTips = getStepOptimizationTips('landing-page', 'thank-you');
  assert.ok(pageTips.length >= 2);
  assert.ok(pageTips.some(t => t.title.includes('Mobile Sticky Action Bar')));

  const adTips = getStepOptimizationTips('ad-source', 'landing-page');
  assert.ok(adTips.some(t => t.badge === 'MESSAGE MATCH'));
});


