import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const auditor = await import('../src/lib/funnelAuditor.ts');
const {
  auditFunnel,
  storeScoreFor,
  isStoreConnected,
  hasDirectCheckoutLink,
  pageSellsThroughCheckout
} = auditor;

const clone = v => JSON.parse(JSON.stringify(v));

test('hasDirectCheckoutLink identifies checkout, booking, and external URLs on landing and upsell nodes', () => {
  assert.equal(hasDirectCheckoutLink(null), false);
  assert.equal(hasDirectCheckoutLink(undefined), false);
  assert.equal(hasDirectCheckoutLink({ nodes: [] }), false);

  const landingWithCheckout = {
    nodes: [
      { id: 'lp-1', type: 'landing-page', data: { checkoutUrl: 'https://buy.stripe.com/test_123' } }
    ]
  };
  assert.equal(hasDirectCheckoutLink(landingWithCheckout), true);

  const landingWithBooking = {
    nodes: [
      { id: 'lp-2', type: 'landing-page', data: { bookingUrl: 'https://calendly.com/consult' } }
    ]
  };
  assert.equal(hasDirectCheckoutLink(landingWithBooking), true);

  const upsellWithExternal = {
    nodes: [
      { id: 'up-1', type: 'upsell', data: { externalUrl: 'https://external.checkout.com/pay' } }
    ]
  };
  assert.equal(hasDirectCheckoutLink(upsellWithExternal), true);

  const emptyStrings = {
    nodes: [
      { id: 'lp-3', type: 'landing-page', data: { checkoutUrl: '   ', bookingUrl: '', externalUrl: ' ' } }
    ]
  };
  assert.equal(hasDirectCheckoutLink(emptyStrings), false);
});

test('isStoreConnected recognizes Shopify, WooCommerce, and direct checkout links', () => {
  const shopifyConnected = { shopifyConfig: { status: 'connected', storeDomain: 'brand.myshopify.com' } };
  const wooConnected = { woocommerceConfig: { status: 'connected', storeUrl: 'https://wp.example.com' } };
  const shopifyDisconnected = { shopifyConfig: { status: 'disconnected' } };
  const wooError = { woocommerceConfig: { status: 'error' } };

  assert.equal(isStoreConnected(shopifyConnected), true);
  assert.equal(isStoreConnected(wooConnected), true);
  assert.equal(isStoreConnected(shopifyDisconnected), false);
  assert.equal(isStoreConnected(wooError), false);
  assert.equal(isStoreConnected(null), false);

  const directProject = {
    nodes: [
      { id: 'lp-1', type: 'landing-page', data: { checkoutUrl: 'https://buy.stripe.com/live_abc' } }
    ]
  };
  assert.equal(isStoreConnected(null, directProject), true);
  assert.equal(isStoreConnected(shopifyDisconnected, directProject), true);
  assert.equal(isStoreConnected(wooError, directProject), true);
});

test('storeScoreFor unlocks pre-flight audit for WooCommerce and direct links', () => {
  const baseProject = {
    id: 'test-p',
    name: 'Test Project',
    nodes: [
      { id: 'node-lp', type: 'landing-page', data: { type: 'landing-page', headline: 'Masterclass Launch' } }
    ],
    edges: []
  };

  assert.equal(storeScoreFor(baseProject, null), null);

  const wooWorkspace = { woocommerceConfig: { status: 'connected', storeUrl: 'https://shop.example.com' } };
  const wooReport = storeScoreFor(baseProject, wooWorkspace);
  assert.ok(wooReport, 'WooCommerce connection generates store audit report');
  assert.equal(typeof wooReport.overallScore, 'number');

  const directProject = {
    ...baseProject,
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Executive Coaching',
          checkoutUrl: 'https://buy.stripe.com/coach_456'
        }
      }
    ]
  };
  const directReport = storeScoreFor(directProject, null);
  assert.ok(directReport, 'Direct checkout link generates store audit report without store connection');
  assert.equal(typeof directReport.overallScore, 'number');
});

test('an un-platformed business with direct links achieves full 100/100 A+ audit score across all 4 pillars', () => {
  const perfectFunnel = {
    id: 'perfect-direct-funnel',
    name: 'Creator Funnel',
    offerHeadline: 'Exclusive Masterclass Program',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Launch Your Signature Offer in 30 Days',
          checkoutUrl: 'https://buy.stripe.com/offer_123',
          productPrice: '197.00',
          mobileStickyBarEnabled: true,
          orderBumpEnabled: true,
          orderBumpTitle: 'Implementation Templates & Swipe Files',
          orderBumpPrice: '37.00',
          trustBadge: 'Backed by our 30-day no-questions-asked refund guarantee',
          published: true
        }
      },
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          type: 'upsell',
          offerType: 'upsell',
          headline: 'Add 1-on-1 Strategy Session',
          checkoutUrl: 'https://buy.stripe.com/upsell_456',
          productPrice: '97.00'
        }
      },
      {
        id: 'node-cart-recovery',
        type: 'follow-up-sequence',
        data: {
          type: 'follow-up-sequence',
          sequenceType: 'checkout_recovery',
          label: 'Cart Recovery Emails'
        }
      },
      {
        id: 'node-upsell-rescue',
        type: 'follow-up-sequence',
        data: {
          type: 'follow-up-sequence',
          sequenceType: 'upsell_recovery',
          label: 'Upsell Rescue Follow-up'
        }
      }
    ],
    edges: [
      { id: 'e-1', source: 'node-lp', target: 'node-upsell' },
      { id: 'e-cart', source: 'node-lp', sourceHandle: 'abandon', target: 'node-cart-recovery', targetHandle: 'retention-in' },
      { id: 'e-rescue', source: 'node-upsell', sourceHandle: 'rescue', target: 'node-upsell-rescue', targetHandle: 'retention-in' }
    ]
  };

  const report = auditFunnel(perfectFunnel, null);
  assert.equal(report.overallScore, 100, 'Reaches 100/100 overall score');
  assert.equal(report.grade, 'A+', 'Awards A+ grade');
  assert.equal(report.tier, 'ready');

  const pillarMap = new Map(report.pillars.map(p => [p.id, p]));

  const acq = pillarMap.get('acquisition');
  assert.equal(acq.score, 30);
  assert.equal(acq.maxScore, 30);

  const aov = pillarMap.get('aov');
  assert.equal(aov.score, 30);
  assert.equal(aov.maxScore, 30);

  const ret = pillarMap.get('retention');
  assert.equal(ret.score, 25);
  assert.equal(ret.maxScore, 25);

  const trust = pillarMap.get('trust');
  assert.equal(trust.score, 15);
  assert.equal(trust.maxScore, 15);
});

test('funnelAuditor and PreFlightAuditDrawer maintain source invariants', () => {
  const auditorSrc = fs.readFileSync('src/lib/funnelAuditor.ts', 'utf8');
  assert.ok(!auditorSrc.includes('\u2014'), 'funnelAuditor has zero em dashes');
  assert.ok(!auditorSrc.includes(' \u2013 '), 'funnelAuditor has zero spaced en dashes');

  const drawerSrc = fs.readFileSync('src/components/drawers/PreFlightAuditDrawer.tsx', 'utf8');
  assert.ok(!drawerSrc.includes('\u2014'), 'PreFlightAuditDrawer has zero em dashes');
  assert.ok(!drawerSrc.includes(' \u2013 '), 'PreFlightAuditDrawer has zero spaced en dashes');
  assert.match(drawerSrc, /Store checks need a connected store\. Sign in and choose a workspace to connect one\./);
  assert.match(drawerSrc, /checkoutEngineLabel/);
});
