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

// ============================================================================
// 1. Permutations of isStoreConnected & hasDirectCheckoutLink
// ============================================================================

test('isStoreConnected: Shopify only connected vs disconnected vs error', () => {
  const shopifyConnected = { shopifyConfig: { status: 'connected', storeDomain: 'test.myshopify.com' } };
  const shopifyDisconnected = { shopifyConfig: { status: 'disconnected', storeDomain: 'test.myshopify.com' } };
  const shopifyError = { shopifyConfig: { status: 'error', storeDomain: 'test.myshopify.com' } };
  const shopifyPending = { shopifyConfig: { status: 'pending', storeDomain: 'test.myshopify.com' } };

  assert.equal(isStoreConnected(shopifyConnected), true, 'Shopify connected returns true');
  assert.equal(isStoreConnected(shopifyDisconnected), false, 'Shopify disconnected returns false');
  assert.equal(isStoreConnected(shopifyError), false, 'Shopify error returns false');
  assert.equal(isStoreConnected(shopifyPending), false, 'Shopify pending returns false');
});

test('isStoreConnected: WooCommerce only connected vs disconnected vs error', () => {
  const wooConnected = { woocommerceConfig: { status: 'connected', storeUrl: 'https://woo.example.com' } };
  const wooDisconnected = { woocommerceConfig: { status: 'disconnected', storeUrl: 'https://woo.example.com' } };
  const wooError = { woocommerceConfig: { status: 'error', storeUrl: 'https://woo.example.com' } };
  const wooPending = { woocommerceConfig: { status: 'pending', storeUrl: 'https://woo.example.com' } };

  assert.equal(isStoreConnected(wooConnected), true, 'WooCommerce connected returns true');
  assert.equal(isStoreConnected(wooDisconnected), false, 'WooCommerce disconnected returns false');
  assert.equal(isStoreConnected(wooError), false, 'WooCommerce error returns false');
  assert.equal(isStoreConnected(wooPending), false, 'WooCommerce pending returns false');
});

test('isStoreConnected: Both Shopify and WooCommerce connected, mixed, or disconnected', () => {
  const bothConnected = {
    shopifyConfig: { status: 'connected' },
    woocommerceConfig: { status: 'connected' }
  };
  const shopifyOkWooError = {
    shopifyConfig: { status: 'connected' },
    woocommerceConfig: { status: 'error' }
  };
  const wooOkShopifyDisconnected = {
    shopifyConfig: { status: 'disconnected' },
    woocommerceConfig: { status: 'connected' }
  };
  const bothDisconnected = {
    shopifyConfig: { status: 'disconnected' },
    woocommerceConfig: { status: 'disconnected' }
  };
  const bothError = {
    shopifyConfig: { status: 'error' },
    woocommerceConfig: { status: 'error' }
  };

  assert.equal(isStoreConnected(bothConnected), true, 'Both connected returns true');
  assert.equal(isStoreConnected(shopifyOkWooError), true, 'Shopify ok with Woo error returns true');
  assert.equal(isStoreConnected(wooOkShopifyDisconnected), true, 'Woo ok with Shopify disconnected returns true');
  assert.equal(isStoreConnected(bothDisconnected), false, 'Both disconnected returns false');
  assert.equal(isStoreConnected(bothError), false, 'Both error returns false');
});

test('isStoreConnected & hasDirectCheckoutLink: Direct checkout link only on landing page', () => {
  const project = {
    id: 'p-checkout',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Direct Checkout Course',
          checkoutUrl: 'https://buy.stripe.com/test_checkout_123'
        }
      }
    ]
  };

  assert.equal(hasDirectCheckoutLink(project), true, 'hasDirectCheckoutLink finds checkoutUrl on landing page');
  assert.equal(isStoreConnected(null, project), true, 'isStoreConnected true with null workspace');
  assert.equal(isStoreConnected(undefined, project), true, 'isStoreConnected true with undefined workspace');
  assert.equal(
    isStoreConnected({ shopifyConfig: { status: 'disconnected' } }, project),
    true,
    'isStoreConnected true when Shopify disconnected but direct checkoutUrl present'
  );
  assert.equal(
    isStoreConnected({ woocommerceConfig: { status: 'error' } }, project),
    true,
    'isStoreConnected true when WooCommerce error but direct checkoutUrl present'
  );
});

test('isStoreConnected & hasDirectCheckoutLink: Direct booking link only on landing page (bookingUrl)', () => {
  const project = {
    id: 'p-booking',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Consulting Strategy Session',
          bookingUrl: 'https://calendly.com/consultant/strategy'
        }
      }
    ]
  };

  assert.equal(hasDirectCheckoutLink(project), true, 'hasDirectCheckoutLink finds bookingUrl on landing page');
  assert.equal(isStoreConnected(null, project), true, 'isStoreConnected true with bookingUrl on landing page');
});

test('isStoreConnected & hasDirectCheckoutLink: Direct external link only on landing page (externalUrl)', () => {
  const project = {
    id: 'p-external',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Custom Payment Portal',
          externalUrl: 'https://pay.example.com/invoice/999'
        }
      }
    ]
  };

  assert.equal(hasDirectCheckoutLink(project), true, 'hasDirectCheckoutLink finds externalUrl on landing page');
  assert.equal(isStoreConnected(null, project), true, 'isStoreConnected true with externalUrl on landing page');
});

test('isStoreConnected & hasDirectCheckoutLink: Direct checkout link on upsell node (upsell)', () => {
  const project = {
    id: 'p-upsell',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Content Page'
        }
      },
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          type: 'upsell',
          headline: 'Special VIP Upgrade',
          checkoutUrl: 'https://buy.stripe.com/vip_upgrade'
        }
      }
    ]
  };

  assert.equal(hasDirectCheckoutLink(project), true, 'hasDirectCheckoutLink finds checkoutUrl on upsell node');
  assert.equal(isStoreConnected(null, project), true, 'isStoreConnected true with upsell direct checkout link');
});

test('isStoreConnected & hasDirectCheckoutLink: Direct booking or external link on upsell node', () => {
  const projectBooking = {
    nodes: [
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          bookingUrl: 'https://cal.com/vip-onboarding'
        }
      }
    ]
  };
  assert.equal(hasDirectCheckoutLink(projectBooking), true);
  assert.equal(isStoreConnected(null, projectBooking), true);

  const projectExternal = {
    nodes: [
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          externalUrl: 'https://custom-gateway.io/pay'
        }
      }
    ]
  };
  assert.equal(hasDirectCheckoutLink(projectExternal), true);
  assert.equal(isStoreConnected(null, projectExternal), true);
});

test('isStoreConnected & hasDirectCheckoutLink: Malformed, non-string, or whitespace-only URLs must not count as connected', () => {
  const whitespaceUrls = [
    '',
    '   ',
    '\t\t',
    '\n\n  \r\n',
    null,
    undefined,
    12345,
    true,
    false,
    {},
    []
  ];

  for (const invalidVal of whitespaceUrls) {
    const project = {
      nodes: [
        {
          id: 'node-lp',
          type: 'landing-page',
          data: {
            checkoutUrl: invalidVal,
            bookingUrl: invalidVal,
            externalUrl: invalidVal
          }
        }
      ]
    };
    assert.equal(
      hasDirectCheckoutLink(project),
      false,
      `hasDirectCheckoutLink must return false for invalid value: ${JSON.stringify(invalidVal)}`
    );
    assert.equal(
      isStoreConnected(null, project),
      false,
      `isStoreConnected must return false for invalid value: ${JSON.stringify(invalidVal)}`
    );
  }
});

test('isStoreConnected & hasDirectCheckoutLink: URLs on non-landing, non-upsell nodes do not count', () => {
  const thankYouWithLink = {
    nodes: [
      {
        id: 'node-ty',
        type: 'thank-you',
        data: { checkoutUrl: 'https://buy.stripe.com/ignored' }
      },
      {
        id: 'node-lead',
        type: 'lead-form',
        data: { bookingUrl: 'https://calendly.com/ignored' }
      },
      {
        id: 'node-seq',
        type: 'follow-up-sequence',
        data: { externalUrl: 'https://pay.example.com/ignored' }
      }
    ]
  };

  assert.equal(hasDirectCheckoutLink(thankYouWithLink), false, 'Only landing-page and upsell nodes qualify for direct checkout links');
  assert.equal(isStoreConnected(null, thankYouWithLink), false);
});

test('isStoreConnected & hasDirectCheckoutLink: Neither connected and no links returns false', () => {
  assert.equal(isStoreConnected(null, null), false);
  assert.equal(isStoreConnected(undefined, undefined), false);
  assert.equal(isStoreConnected({}, { nodes: [] }), false);
  assert.equal(
    isStoreConnected(
      { shopifyConfig: { status: 'disconnected' }, woocommerceConfig: { status: 'disconnected' } },
      { id: 'p', nodes: [{ id: 'n', type: 'landing-page', data: { headline: 'Just content' } }] }
    ),
    false
  );
});

// ============================================================================
// 2. Permutations of storeScoreFor & auditFunnel
// ============================================================================

test('storeScoreFor: Project without any store and without direct links returns null', () => {
  const unlinkedProject = {
    id: 'p-bare',
    name: 'Unlinked Brochure Funnel',
    offerHeadline: 'Consulting Brochure',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Welcome to Our Agency',
          published: true
        }
      }
    ],
    edges: []
  };

  assert.equal(storeScoreFor(unlinkedProject, null), null, 'null workspace returns null report');
  assert.equal(storeScoreFor(unlinkedProject, undefined), null, 'undefined workspace returns null report');
  assert.equal(
    storeScoreFor(unlinkedProject, { shopifyConfig: { status: 'disconnected' } }),
    null,
    'disconnected shopify returns null report'
  );
  assert.equal(
    storeScoreFor(unlinkedProject, { woocommerceConfig: { status: 'error' } }),
    null,
    'error woocommerce returns null report'
  );
  assert.equal(
    storeScoreFor(unlinkedProject, {
      shopifyConfig: { status: 'disconnected' },
      woocommerceConfig: { status: 'disconnected' }
    }),
    null,
    'both disconnected returns null report'
  );
});

test('storeScoreFor & auditFunnel: Un-platformed merchant with Stripe link verifies Acquisition breakdown', () => {
  const stripeProject = {
    id: 'p-stripe-only',
    name: 'Stripe Funnel',
    offerHeadline: 'Exclusive Agency Workshop',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Grow Your Agency to $50k/mo',
          checkoutUrl: 'https://buy.stripe.com/agency_workshop_123',
          productPrice: '499.00',
          mobileStickyBarEnabled: true,
          published: false
        }
      }
    ],
    edges: []
  };

  const report = storeScoreFor(stripeProject, null);
  assert.ok(report, 'storeScoreFor returns report for Stripe direct link');

  const acqPillar = report.pillars.find(p => p.id === 'acquisition');
  assert.ok(acqPillar, 'Acquisition pillar present');
  assert.equal(acqPillar.maxScore, 30);

  const headlineItem = acqPillar.items.find(i => i.id === 'headline_defined');
  assert.equal(headlineItem.passed, true);
  assert.equal(headlineItem.points, 10);

  const pricingItem = acqPillar.items.find(i => i.id === 'product_pricing_linked');
  assert.equal(pricingItem.passed, true, 'Product linked to checkout passed via Stripe direct link');
  assert.equal(pricingItem.points, 10, 'Awards 10 pts for linked direct checkout');
  assert.match(pricingItem.summary, /A product is linked/, 'Summary mentions linked product');

  const stickyItem = acqPillar.items.find(i => i.id === 'mobile_sticky_bar');
  assert.equal(stickyItem.passed, true);
  assert.equal(stickyItem.points, 10);

  assert.equal(acqPillar.score, 30, 'Full 30/30 on Acquisition with Stripe direct link');
});

test('storeScoreFor & auditFunnel: Un-platformed merchant verifies AOV pillar with direct upsell link', () => {
  const projectWithUpsellLink = {
    id: 'p-aov-test',
    name: 'AOV Funnel',
    offerHeadline: 'Main Course Offer',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Main Course Offer',
          checkoutUrl: 'https://buy.stripe.com/main_offer',
          productPrice: '197.00',
          orderBumpEnabled: true,
          orderBumpTitle: 'VIP Workbook',
          orderBumpPrice: '27.00'
        }
      },
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          type: 'upsell',
          offerType: 'upsell',
          headline: '1-on-1 Strategy Call',
          bookingUrl: 'https://calendly.com/expert/upsell-call'
        }
      }
    ],
    edges: [
      { id: 'e-1', source: 'node-lp', target: 'node-upsell' }
    ]
  };

  const report = storeScoreFor(projectWithUpsellLink, null);
  assert.ok(report);

  const aovPillar = report.pillars.find(p => p.id === 'aov');
  assert.ok(aovPillar);
  assert.equal(aovPillar.maxScore, 30);

  const bumpItem = aovPillar.items.find(i => i.id === 'order_bump_configured');
  assert.equal(bumpItem.passed, true);
  assert.equal(bumpItem.points, 15);

  const upsellItem = aovPillar.items.find(i => i.id === 'post_purchase_upsell');
  assert.equal(upsellItem.passed, true, 'Upsell passed via direct bookingUrl link');
  assert.equal(upsellItem.points, 15, 'Awards 15 pts for upsell with direct booking link');

  assert.equal(aovPillar.score, 30, 'Full 30/30 on AOV with direct links');
});

test('storeScoreFor & auditFunnel: Full 100/100 score condition for un-platformed merchant', () => {
  const perfectDirectMerchant = {
    id: 'p-100',
    name: 'Full Direct Funnel',
    offerHeadline: 'Comprehensive Digital Marketing Academy',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Transform Your Business with Proven Growth Engines',
          checkoutUrl: 'https://buy.stripe.com/academy_full_pass',
          productPrice: '299.00',
          mobileStickyBarEnabled: true,
          orderBumpEnabled: true,
          orderBumpTitle: 'Plug-and-play email marketing templates',
          orderBumpPrice: '47.00',
          trustBadge: 'Protected by our 100% money back guarantee for 30 days',
          published: true
        }
      },
      {
        id: 'node-upsell',
        type: 'upsell',
        data: {
          type: 'upsell',
          offerType: 'upsell',
          headline: 'Private Mentorship Cohort',
          checkoutUrl: 'https://buy.stripe.com/cohort_upgrade',
          productPrice: '997.00'
        }
      },
      {
        id: 'node-cart-recovery',
        type: 'follow-up-sequence',
        data: {
          type: 'follow-up-sequence',
          sequenceType: 'checkout_recovery',
          label: 'Cart Recovery Email Sequence'
        }
      },
      {
        id: 'node-upsell-rescue',
        type: 'follow-up-sequence',
        data: {
          type: 'follow-up-sequence',
          sequenceType: 'upsell_recovery',
          label: 'Downsell Rescue Email Sequence'
        }
      }
    ],
    edges: [
      { id: 'e-1', source: 'node-lp', target: 'node-upsell' },
      { id: 'e-cart', source: 'node-lp', sourceHandle: 'abandon', target: 'node-cart-recovery', targetHandle: 'retention-in' },
      { id: 'e-rescue', source: 'node-upsell', sourceHandle: 'rescue', target: 'node-upsell-rescue', targetHandle: 'retention-in' }
    ]
  };

  const report = storeScoreFor(perfectDirectMerchant, null);
  assert.ok(report);
  assert.equal(report.overallScore, 100, 'Overall score must be 100');
  assert.equal(report.grade, 'A+', 'Grade must be A+');
  assert.equal(report.tier, 'ready', 'Tier must be ready');
  assert.equal(report.passedChecks, 9, 'All 9 checks passed (3 acq + 2 aov + 2 ret + 2 trust)');
  assert.equal(report.totalChecks, 9, 'Total 9 checks in audit report');
  assert.equal(report.fixableChecks, 0, '0 fixable checks remain');
  assert.match(report.headline, /Every store check passed/);

  // Validate all 4 pillars individually
  const acq = report.pillars.find(p => p.id === 'acquisition');
  assert.equal(acq.score, 30);
  assert.equal(acq.maxScore, 30);

  const aov = report.pillars.find(p => p.id === 'aov');
  assert.equal(aov.score, 30);
  assert.equal(aov.maxScore, 30);

  const ret = report.pillars.find(p => p.id === 'retention');
  assert.equal(ret.score, 25);
  assert.equal(ret.maxScore, 25);

  const trust = report.pillars.find(p => p.id === 'trust');
  assert.equal(trust.score, 15);
  assert.equal(trust.maxScore, 15);
});

test('pageSellsThroughCheckout: detects direct URLs and handles edge cases', () => {
  assert.equal(pageSellsThroughCheckout(undefined), false);

  const landingWithCheckout = { type: 'landing-page', data: { checkoutUrl: 'https://buy.stripe.com/abc' } };
  assert.equal(pageSellsThroughCheckout(landingWithCheckout), true);

  const landingWithBooking = { type: 'landing-page', data: { bookingUrl: 'https://calendly.com/me' } };
  assert.equal(pageSellsThroughCheckout(landingWithBooking), true);

  const landingWithExternal = { type: 'landing-page', data: { externalUrl: 'https://external.io/pay' } };
  assert.equal(pageSellsThroughCheckout(landingWithExternal), true);

  const landingWithShopifyPrice = { type: 'landing-page', data: { shopifyProductPrice: '29.00' } };
  assert.equal(pageSellsThroughCheckout(landingWithShopifyPrice), true);

  const landingWithWhitespace = { type: 'landing-page', data: { checkoutUrl: '   ', bookingUrl: '', externalUrl: '\t' } };
  assert.equal(pageSellsThroughCheckout(landingWithWhitespace), false);

  const landingEmptyData = { type: 'landing-page', data: {} };
  assert.equal(pageSellsThroughCheckout(landingEmptyData), false);
});

test('checkoutEngineLabel logic: verifies all label permutations', () => {
  // Replicates the pure logic in PreFlightAuditDrawer.tsx:69-82
  function computeLabel(isOpen, workspace, project) {
    if (!isOpen) return '';
    if (workspace?.shopifyConfig?.status === 'connected') {
      const shopDomain = workspace.shopifyConfig.storeDomain;
      return shopDomain ? `Shopify: ${shopDomain}` : 'Shopify connected';
    }
    if (workspace?.woocommerceConfig?.status === 'connected') {
      return 'WooCommerce connected';
    }
    if (hasDirectCheckoutLink(project)) {
      return 'Direct checkout or booking link';
    }
    return 'No store connected';
  }

  const directProject = {
    nodes: [{ id: 'n1', type: 'landing-page', data: { checkoutUrl: 'https://stripe.com' } }]
  };
  const emptyProject = { nodes: [] };

  // When closed, returns empty string
  assert.equal(computeLabel(false, null, directProject), '');

  // When open:
  assert.equal(computeLabel(true, null, emptyProject), 'No store connected');
  assert.equal(computeLabel(true, null, directProject), 'Direct checkout or booking link');

  assert.equal(
    computeLabel(true, { shopifyConfig: { status: 'connected', storeDomain: 'shop.myshopify.com' } }, emptyProject),
    'Shopify: shop.myshopify.com'
  );
  assert.equal(
    computeLabel(true, { shopifyConfig: { status: 'connected' } }, emptyProject),
    'Shopify connected'
  );
  assert.equal(
    computeLabel(true, { woocommerceConfig: { status: 'connected', storeUrl: 'https://wp.com' } }, emptyProject),
    'WooCommerce connected'
  );

  // Precedence: Shopify > WooCommerce > Direct Links > None
  const allConnected = {
    shopifyConfig: { status: 'connected', storeDomain: 'top.myshopify.com' },
    woocommerceConfig: { status: 'connected' }
  };
  assert.equal(computeLabel(true, allConnected, directProject), 'Shopify: top.myshopify.com');

  const wooAndDirect = {
    woocommerceConfig: { status: 'connected' }
  };
  assert.equal(computeLabel(true, wooAndDirect, directProject), 'WooCommerce connected');
});

test('auditFunnel: un-platformed landing page without upsell offers add_upsell_node autofix', () => {
  const directNoUpsell = {
    id: 'p-direct-no-upsell',
    name: 'Direct Single Offer',
    offerHeadline: 'Direct Single Offer',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        data: {
          type: 'landing-page',
          headline: 'Direct Single Offer Course',
          checkoutUrl: 'https://buy.stripe.com/course_1',
          productPrice: '49.00'
        }
      }
    ],
    edges: []
  };

  const report = storeScoreFor(directNoUpsell, null);
  assert.ok(report);
  const aov = report.pillars.find(p => p.id === 'aov');
  const upsellCheck = aov.items.find(i => i.id === 'post_purchase_upsell');
  assert.equal(upsellCheck.passed, false);
  assert.equal(upsellCheck.autoFixType, 'add_upsell_node', 'add_upsell_node is offered because pageSellsThroughCheckout is true');
});

// ============================================================================
// 3. Invariants: PreFlightAuditDrawer hook order, verbatim pin, dash rules
// ============================================================================

test('PreFlightAuditDrawer hook invariants and verbatim pin string check', () => {
  const drawerSrc = fs.readFileSync('src/components/drawers/PreFlightAuditDrawer.tsx', 'utf8');

  // Verify the verbatim pin string exists exactly
  const verbatimPin = 'Store checks need a connected store. Sign in and choose a workspace to connect one.';
  assert.ok(
    drawerSrc.includes(verbatimPin),
    `PreFlightAuditDrawer must contain verbatim pin: "${verbatimPin}"`
  );

  // Hook invariant check matching design-checks.test.mjs:393
  const early = drawerSrc.search(/\n\s*if \(!isOpen[^\n]*return null;/);
  assert.ok(early > 0, 'the drawer returns null while closed');

  const beforeReturn = drawerSrc.slice(0, early);
  const afterReturn = drawerSrc.slice(early);

  // Hooks expected before return null:
  assert.match(beforeReturn, /\buseMemo\(/, 'useMemo declared before return null');
  assert.match(beforeReturn, /\buseState[<(]/, 'useState declared before return null');
  assert.match(beforeReturn, /\buseRef[<(]/, 'useRef declared before return null');
  assert.match(beforeReturn, /\buseEffect\(/, 'useEffect declared before return null');
  assert.match(beforeReturn, /\buseDialogFocus[<(]/, 'useDialogFocus declared before return null');

  // No hooks allowed after the first return null:
  assert.doesNotMatch(
    afterReturn,
    /\buse(?:State|Effect|Memo|Ref|Callback|DialogFocus)[<(]/,
    'No hooks after return null'
  );
});

test('Zero em dashes and zero spaced en dashes across all Milestone 3 files', () => {
  const filesToCheck = [
    'src/lib/funnelAuditor.ts',
    'src/components/drawers/PreFlightAuditDrawer.tsx',
    'src/components/drawers/PageEditor.tsx',
    'src/components/preview/LiveFunnelModal.tsx',
    'tests/cross-engine-wiring.test.mjs',
    'tests/previews-cross-engine.test.mjs',
    'tests/m3-challenger-auditor.test.mjs'
  ];

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      content.includes('\u2014'),
      false,
      `File ${filePath} contains forbidden em dash`
    );
    assert.equal(
      content.includes(' \u2013 '),
      false,
      `File ${filePath} contains forbidden spaced en dash`
    );
  }
});
