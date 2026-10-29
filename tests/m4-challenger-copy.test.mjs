import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ECOM_BLUEPRINTS } from '../src/data/ecomBlueprints.ts';
import {
  BUSINESS_TYPES,
  UNIVERSAL_BUSINESS_CATEGORIES,
  ALL_BUSINESS_TYPES,
  compileShapeLearns
} from '../server/assistantTraining.mjs';
import {
  DEFAULT_CURATED_REVIEWS,
  CURATED_UGC_PHOTO_1,
  CURATED_UGC_PHOTO_2,
  renderReviewPortalHtml
} from '../server/reviewEngine.mjs';

// Read source files directly for structural, text, and invariant checks
const blueprintsSrc = fs.readFileSync('src/data/ecomBlueprints.ts', 'utf8');
const welcomeTourSrc = fs.readFileSync('src/components/modals/WelcomeTourModal.tsx', 'utf8');
const stepDockSrc = fs.readFileSync('src/components/drawers/StepDock.tsx', 'utf8');
const reviewEngineSrc = fs.readFileSync('server/reviewEngine.mjs', 'utf8');
const assistantTrainingSrc = fs.readFileSync('server/assistantTraining.mjs', 'utf8');

// ============================================================================
// PART 1: UNIVERSAL BUSINESS COPY IN src/data/ecomBlueprints.ts
// ============================================================================

test('Challenger 1.1: single-product-flash-drop copy neutralization', () => {
  const bp = ECOM_BLUEPRINTS.find(b => b.id === 'single-product-flash-drop');
  assert.ok(bp, 'single-product-flash-drop must exist in ECOM_BLUEPRINTS');

  // Verify universal neutralized phrasing
  assert.equal(
    bp.description,
    'Designed for physical goods, retail products, and direct orders. Eliminates multi-step checkout friction and sends buyers directly into accelerated checkout with an auto-applied incentive.',
    'Description must match neutralized universal business phrasing'
  );

  // Adversarial negative checks: old niche e-commerce terminology must be purged
  assert.ok(!bp.description.includes('retail goods and physical e-commerce brands'), 'Old niche retail goods phrasing eliminated');
  assert.ok(!bp.description.includes('multi-step cart hurdles'), 'Old multi-step cart hurdles phrasing eliminated');
  assert.ok(!bp.description.includes('sends shoppers directly'), 'Old sends shoppers directly phrasing eliminated');
});

test('Challenger 1.2: turnkey-retention-ecosystem copy neutralization', () => {
  const bp = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
  assert.ok(bp, 'turnkey-retention-ecosystem must exist in ECOM_BLUEPRINTS');

  // Verify universal neutralized phrasing
  assert.equal(
    bp.description,
    'Engineered for subscription products, high-retention brands, and digital platforms. Pairs high-converting front-end acquisition and 1-click upgrades with automated 24h courtesy rescue and checkout recovery.',
    'Description must match neutralized universal business phrasing'
  );

  // Adversarial negative checks
  assert.ok(!bp.description.includes('modern high-retention brands'), 'Old modern high-retention brands phrasing eliminated');
  assert.ok(!bp.description.includes('1-click upsells'), 'Old 1-click upsells phrasing replaced with 1-click upgrades in description');
  assert.ok(!bp.description.includes('abandoned cart safety nets'), 'Old abandoned cart safety nets phrasing replaced with checkout recovery');
});

test('Challenger 1.3: bp5-ad headline neutralization and "Save 20%" preservation', () => {
  const bp5 = ECOM_BLUEPRINTS.find(b => b.id === 'oto-upsell-funnel-system');
  assert.ok(bp5, 'oto-upsell-funnel-system must exist in ECOM_BLUEPRINTS');

  const adNode = bp5.nodes.find(n => n.id === 'bp5-ad');
  assert.ok(adNode, 'bp5-ad node must exist in bp5 nodes');

  const headline = adNode.data.headline;
  assert.equal(
    headline,
    'Complete Performance Bundle for Modern Teams: Save 20%',
    'bp5-ad headline must be neutralized and buzzword-free'
  );

  // Must preserve exact string "Save 20%" pinned by design-checks.test.mjs:700
  assert.ok(headline.includes('Save 20%'), 'Headline must retain exact substring "Save 20%"');

  // Adversarial negative checks: no generic AI hype copy
  assert.ok(!headline.toLowerCase().includes('all-in-one'), 'Must eliminate generic "All-in-One" buzzword');
  assert.ok(!headline.toLowerCase().includes('game changer'), 'No hype filler');
});

// ============================================================================
// PART 2: STRICT PRESERVATION OF BLUEPRINT PINS, IDS, SLUGS, OFFERS
// ============================================================================

test('Challenger 2.1: Strict preservation of all 6 canonical blueprint IDs', () => {
  const expectedIds = [
    'single-product-flash-drop',
    'high-ticket-consultation',
    'digital-product-membership',
    'vip-lead-magnet-discount',
    'oto-upsell-funnel-system',
    'turnkey-retention-ecosystem'
  ];
  const actualIds = ECOM_BLUEPRINTS.map(b => b.id);
  assert.deepEqual(actualIds, expectedIds, 'All 6 canonical blueprint IDs must be strictly preserved in exact order');
});

test('Challenger 2.2: Strict preservation of slug "product-flagship-drop"', () => {
  const bp1 = ECOM_BLUEPRINTS.find(b => b.id === 'single-product-flash-drop');
  const landingNode = bp1.nodes.find(n => n.id === 'bp1-page');
  assert.ok(landingNode, 'bp1-page node exists');
  assert.equal(landingNode.data.slug, 'product-flagship-drop', 'Slug product-flagship-drop must be preserved exactly');
});

test('Challenger 2.3: Strict preservation of ad spend === 0 invariant across all blueprints', () => {
  for (const bp of ECOM_BLUEPRINTS) {
    for (const node of bp.nodes) {
      if (node.type === 'ad-source') {
        assert.equal(node.data.spend, 0, `Ad node ${node.id} in blueprint ${bp.id} must have spend === 0`);
      }
    }
  }
});

test('Challenger 2.4: Strict preservation of pinned discount codes across blueprints', () => {
  const bp1 = ECOM_BLUEPRINTS.find(b => b.id === 'single-product-flash-drop');
  assert.equal(bp1.nodes.find(n => n.id === 'bp1-page').data.discountCode, 'WELCOME20');

  const bp3 = ECOM_BLUEPRINTS.find(b => b.id === 'digital-product-membership');
  assert.equal(bp3.nodes.find(n => n.id === 'bp3-page').data.discountCode, 'EARLYBIRD');

  const bp4 = ECOM_BLUEPRINTS.find(b => b.id === 'vip-lead-magnet-discount');
  assert.equal(bp4.nodes.find(n => n.id === 'bp4-page').data.discountCode, 'VIP15');

  const bp5 = ECOM_BLUEPRINTS.find(b => b.id === 'oto-upsell-funnel-system');
  assert.equal(bp5.nodes.find(n => n.id === 'bp5-page').data.discountCode, 'WELCOME20');

  const bp6 = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
  assert.equal(bp6.nodes.find(n => n.id === 'bp6-page').data.discountCode, 'WELCOME10');

  // Verify VIPGLOW15 bounce-back code is preserved
  assert.ok(blueprintsSrc.includes('VIPGLOW15'), 'VIPGLOW15 discount code must remain in blueprint definitions');
});

test('Challenger 2.5: Strict preservation of all test-pinned sample offer strings', () => {
  const pinnedOfferStrings = [
    'Save 20%',
    '3.4x ROI',
    'insured priority tracking',
    'in 30 days',
    '3,200+',
    '15,000+',
    'at half the price',
    'thousands',
    'gift',
    'VIPGLOW15',
    'insured tracking'
  ];

  for (const str of pinnedOfferStrings) {
    assert.ok(
      blueprintsSrc.includes(str),
      `Required test-pinned sample offer string "${str}" must be present in src/data/ecomBlueprints.ts`
    );
  }
});

test('Challenger 2.6: Structural node integrity and connection handles', () => {
  for (const bp of ECOM_BLUEPRINTS) {
    assert.ok(bp.nodes.length >= 3, `Blueprint ${bp.id} must have at least 3 nodes`);
    const nodeIds = new Set();
    for (const node of bp.nodes) {
      assert.ok(node.id, `Node in ${bp.id} must have an id`);
      assert.ok(!nodeIds.has(node.id), `Duplicate node id ${node.id} in ${bp.id}`);
      nodeIds.add(node.id);
      assert.ok(node.data, `Node ${node.id} must have data`);
      assert.ok(node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number');
    }
  }
});

// ============================================================================
// PART 3: WELCOME TOUR MODAL (STEPS 1 & 2 UNIVERSAL COPY + 8 ASSERTIONS PIN)
// ============================================================================

test('Challenger 3.1: WelcomeTourModal Step 1 universal business copy', () => {
  const expectedSummary = 'Whether you run physical retail, client services, consulting, digital courses, or SaaS, you never have to build from a blank screen.';
  const expectedHighlight = 'Browse ready-made turnkey blueprints for physical goods, client bookings, consulting, and digital products.';

  assert.ok(welcomeTourSrc.includes(expectedSummary), 'Step 1 summary must contain universal business categories');
  assert.ok(welcomeTourSrc.includes(expectedHighlight), 'Step 1 highlights[0] must cover physical goods, client bookings, consulting, and digital products');

  // Adversarial negative checks
  assert.ok(!welcomeTourSrc.includes('Only built for Shopify dropshippers'), 'Must not restrict to single business model');
});

test('Challenger 3.2: WelcomeTourModal Step 2 universal business copy', () => {
  const expectedSummary = 'Click any step on the canvas to open its editor in the right-hand Step Panel. Your call-to-action button connects to online stores, payment links, or calendar bookings.';
  const expectedHighlight = 'Copy your Confirmation Redirect URL (/p/your-slug/thank-you) so completed purchases or bookings land on your Thank-You page.';

  assert.ok(welcomeTourSrc.includes(expectedSummary), 'Step 2 summary must reference stores, payment links, and calendar bookings');
  assert.ok(welcomeTourSrc.includes(expectedHighlight), 'Step 2 highlights[2] must instruct on Confirmation Redirect URL');
});

test('Challenger 3.3: Strict preservation of all 8 assertions in launch-playbook.test.mjs:61-72', () => {
  const assertions = [
    'export const WelcomeTourModal',
    'ModalDialog labelledBy="welcome-tour-title"',
    "export const WELCOME_TOUR_STORAGE_KEY = 'jourvance_welcome_tour_seen'",
    'Skip Tour',
    'Start with a Turnkey Blueprint or Draft with AI',
    'Edit Your Page & Connect Checkout or Calendar Links',
    'Simulate as Lead or Buyer & Share Client Pitch Links',
    'Run Pre-Flight Checks & Publish in One Click'
  ];

  for (const snippet of assertions) {
    assert.ok(
      welcomeTourSrc.includes(snippet),
      `WelcomeTourModal must strictly preserve launch-playbook assertion: ${snippet}`
    );
  }

  // Dash assertions from launch-playbook.test.mjs:70-71
  assert.ok(!welcomeTourSrc.includes('\u2014'), 'WelcomeTourModal contains zero em dashes');
  assert.ok(!welcomeTourSrc.includes(' \u2013 '), 'WelcomeTourModal contains zero spaced en dashes');
});

// ============================================================================
// PART 4: STEP DOCK SUBTEXT & 9 ASSERTIONS PIN (launch-playbook.test.mjs:74-84)
// ============================================================================

test('Challenger 4.1: StepDock subtext at line 405 universal business copy', () => {
  const expectedSubtext = 'E-commerce, client services, consulting, digital products, or SaaS';
  assert.ok(stepDockSrc.includes(expectedSubtext), `StepDock must contain exact universal subtext "${expectedSubtext}"`);

  // Adversarial negative check: old niche subtext removed
  assert.ok(
    !stepDockSrc.includes('Beauty salons, e-commerce stores, coaching, or digital products'),
    'Old niche subtext must be completely eliminated'
  );
});

test('Challenger 4.2: Strict preservation of all 9 assertions in launch-playbook.test.mjs:74-84', () => {
  const assertions = [
    'aria-label="Quick-start guide"',
    'Quick-Start & New Features',
    'Take 60s Tour',
    '1. Pick a Business Blueprint',
    '2. Edit Landing Page & Offer',
    '3. Connect Store or Booking Link',
    '4. Simulate Lead vs. Buyer Flow'
  ];

  for (const snippet of assertions) {
    assert.ok(
      stepDockSrc.includes(snippet),
      `StepDock must strictly preserve launch-playbook assertion: ${snippet}`
    );
  }

  // Dash assertions from launch-playbook.test.mjs:82-83
  assert.ok(!stepDockSrc.includes('\u2014'), 'StepDock contains zero em dashes');
  assert.ok(!stepDockSrc.includes(' \u2013 '), 'StepDock contains zero spaced en dashes');
});

// ============================================================================
// PART 5: REVIEW ENGINE CURATED REVIEWS, PORTAL, AND NEGATIVE REGEX
// ============================================================================

test('Challenger 5.1: DEFAULT_CURATED_REVIEWS array integrity and universal neutralization', () => {
  assert.ok(Array.isArray(DEFAULT_CURATED_REVIEWS), 'DEFAULT_CURATED_REVIEWS must be an exported array');
  assert.equal(DEFAULT_CURATED_REVIEWS.length, 3, 'Must contain exactly 3 curated baseline reviews');

  const ids = DEFAULT_CURATED_REVIEWS.map(r => r.id);
  assert.deepEqual(ids, ['curated_1', 'curated_2', 'curated_3'], 'Review IDs must be curated_1, curated_2, curated_3');

  for (const r of DEFAULT_CURATED_REVIEWS) {
    assert.equal(r.rating, 5, `Review ${r.id} rating must be 5`);
    assert.equal(r.verifiedBuyer, true, `Review ${r.id} verifiedBuyer must be true`);
    assert.ok(typeof r.customerName === 'string' && r.customerName.length > 0);
    assert.ok(typeof r.reviewTitle === 'string' && r.reviewTitle.length > 0);
    assert.ok(typeof r.reviewText === 'string' && r.reviewText.length > 0);
    assert.ok(Array.isArray(r.tags) && r.tags.length > 0);
  }

  // Verify tag 'Great Quality' exists (asserted by review-engine.test.mjs:159)
  const allTags = DEFAULT_CURATED_REVIEWS.flatMap(r => r.tags);
  assert.ok(allTags.includes('Great Quality'), 'Must include "Great Quality" tag');
});

test('Challenger 5.2: Neutralized SVG photo badges in reviewEngine.mjs', () => {
  assert.ok(CURATED_UGC_PHOTO_1.includes('VERIFIED CLIENT DETAIL'), 'Photo 1 SVG badge must be VERIFIED CLIENT DETAIL');
  assert.ok(CURATED_UGC_PHOTO_2.includes('PREMIUM QUALITY FINISH'), 'Photo 2 SVG badge must be PREMIUM QUALITY FINISH');

  // Adversarial negative checks: old beauty-specific labels eliminated
  assert.ok(!reviewEngineSrc.includes('ROSEWATER ELIXIR TEXTURE'), 'Old ROSEWATER ELIXIR TEXTURE label eliminated');
  assert.ok(!reviewEngineSrc.includes('GOLDEN PEPTIDE GLOW'), 'Old GOLDEN PEPTIDE GLOW label eliminated');
});

test('Challenger 5.3: Review portal HTML rendering, links, and negative category regex', () => {
  const html = renderReviewPortalHtml({
    orderId: 'ord_challenger_999',
    email: 'client@example.com',
    token: 'valid_test_token',
    storeName: 'Aura Glow Skincare',
    storeDomain: 'aura-skincare.com',
    verified: true
  });

  // Required strings from review-engine.test.mjs:204-205
  assert.ok(html.includes('Your review is saved. Thank you.'), 'Must include thank you confirmation');
  assert.ok(html.includes('href="https://aura-skincare.com" class="jv-shop-link"'), 'Must include valid shop link');
  assert.ok(html.includes('data-tag="Great Quality"'), 'Must include Great Quality tag attribute');

  // Negative category regex test from review-engine.test.mjs:161:
  // Portal must assume no single product category
  assert.ok(
    !/Glowing Results|ritual|your skin|luminous/i.test(html),
    'Review portal HTML must pass negative regex check (!/Glowing Results|ritual|your skin|luminous/i)'
  );
});

test('Challenger 5.4: Review portal refuses unverified link and escapes malicious input', () => {
  const invalidHtml = renderReviewPortalHtml({
    orderId: '<script>alert(1)</script>',
    email: 'client@example.com',
    token: 'invalid_token',
    storeName: 'Aura Glow Skincare',
    storeDomain: 'aura-skincare.com',
    verified: false
  });

  assert.ok(invalidHtml.includes('This review link is not valid'), 'Must display error for unverified review token');
  assert.ok(!invalidHtml.includes('<script>alert(1)</script>'), 'Must not render unescaped script tag');
});

// ============================================================================
// PART 6: ASSISTANT TRAINING FROZEN BUSINESS_TYPES & CATEGORY EXPORTS
// ============================================================================

test('Challenger 6.1: Strict preservation of frozen BUSINESS_TYPES pin (assistant-training.test.mjs:573-574)', () => {
  // assistant-training.test.mjs:573: assert.deepEqual(BUSINESS_TYPES, ['E-Commerce Store'])
  assert.deepEqual(BUSINESS_TYPES, ['E-Commerce Store'], 'BUSINESS_TYPES must equal ["E-Commerce Store"] exactly');
  // assistant-training.test.mjs:574: assert.ok(Object.isFrozen(BUSINESS_TYPES))
  assert.ok(Object.isFrozen(BUSINESS_TYPES), 'BUSINESS_TYPES must be Object.freeze()');
});

test('Challenger 6.2: UNIVERSAL_BUSINESS_CATEGORIES export in server/assistantTraining.mjs', () => {
  const expectedCategories = [
    'E-Commerce & Physical Retail',
    'Local & Client Services',
    'B2B, Agencies & Consulting',
    'Digital Products, Courses & Creators',
    'SaaS, Tech & Events'
  ];

  assert.deepEqual(UNIVERSAL_BUSINESS_CATEGORIES, expectedCategories, 'UNIVERSAL_BUSINESS_CATEGORIES must match 5 canonical categories');
  assert.ok(Object.isFrozen(UNIVERSAL_BUSINESS_CATEGORIES), 'UNIVERSAL_BUSINESS_CATEGORIES must be Object.freeze()');
});

test('Challenger 6.3: ALL_BUSINESS_TYPES combines legacy and universal categories', () => {
  const expectedAll = [
    'E-Commerce Store',
    'E-Commerce & Physical Retail',
    'Local & Client Services',
    'B2B, Agencies & Consulting',
    'Digital Products, Courses & Creators',
    'SaaS, Tech & Events'
  ];

  assert.deepEqual(ALL_BUSINESS_TYPES, expectedAll, 'ALL_BUSINESS_TYPES must combine legacy and universal categories');
  assert.ok(Object.isFrozen(ALL_BUSINESS_TYPES), 'ALL_BUSINESS_TYPES must be Object.freeze()');
});

test('Challenger 6.4: compileShapeLearns recognizes all 5 universal categories in niche', () => {
  const fig = (visits, orders) => ({ visits, orders });
  const shapeJourney = (overrides = {}) => ({
    id: 'jrn_test_shape',
    userId: 'u_challenger',
    name: 'Growth Funnel',
    businessType: 'E-Commerce & Physical Retail',
    nodes: [
      { id: 'ad', type: 'ad-source', position: { x: 0, y: 0 }, data: { type: 'ad-source', platform: 'meta' } },
      { id: 'page', type: 'landing-page', position: { x: 100, y: 0 }, data: { type: 'landing-page', headline: 'Welcome' } }
    ],
    ...overrides
  });

  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    const res = compileShapeLearns({
      uid: 'u_challenger',
      journeys: [shapeJourney({ businessType: cat })],
      figures: new Map([['jrn_test_shape', fig(1000, 100)]])
    });
    assert.ok(res.rows.length > 0, `compileShapeLearns must produce learn row for ${cat}`);
    assert.equal(res.rows[0].niche, cat, `compileShapeLearns must recognize niche as "${cat}"`);
  }

  // Unrecognized category falls back to 'general'
  const fallbackRes = compileShapeLearns({
    uid: 'u_challenger',
    journeys: [shapeJourney({ businessType: 'Unknown Martian Enterprise' })],
    figures: new Map([['jrn_test_shape', fig(1000, 100)]])
  });
  assert.equal(fallbackRes.rows[0].niche, 'general', 'Unrecognized category must fall back to "general"');
});

// ============================================================================
// PART 7: COMPREHENSIVE DASH INVARIANT SCAN ACROSS TOUCHED FILES
// ============================================================================

test('Challenger 7.1: Zero em dashes (\\u2014) and zero spaced en dashes ( \\u2013 ) across touched files', () => {
  const touchedFiles = [
    'src/data/ecomBlueprints.ts',
    'src/components/modals/WelcomeTourModal.tsx',
    'src/components/drawers/StepDock.tsx',
    'server/reviewEngine.mjs',
    'server/assistantTraining.mjs',
    'src/types/journey.ts',
    'src/components/toolbar/CanvasHeader.tsx',
    'src/components/modals/AiJourneyBuilder.tsx',
    'src/lib/journeyAi.ts',
    'src/components/modals/BlueprintModal.tsx',
    'src/App.tsx',
    'src/components/drawers/PageEditor.tsx',
    'server/routes/aiAssistantRoutes.mjs',
    'src/lib/pageThemes.ts',
    'server/routes/publicRoutes.mjs',
    'src/lib/funnelAuditor.ts',
    'src/components/drawers/PreFlightAuditDrawer.tsx',
    'src/components/preview/LiveFunnelModal.tsx'
  ];

  for (const file of touchedFiles) {
    assert.ok(fs.existsSync(file), `Touched file ${file} must exist`);
    const content = fs.readFileSync(file, 'utf8');

    const emCount = (content.match(/\u2014/g) || []).length;
    const spacedEnCount = (content.match(/ \u2013 /g) || []).length;

    assert.equal(
      emCount,
      0,
      `File ${file} contains ${emCount} em dash(es) (\\u2014). Repo rule strictly prohibits em dashes.`
    );
    assert.equal(
      spacedEnCount,
      0,
      `File ${file} contains ${spacedEnCount} spaced en dash(es) ( \\u2013 ). Repo rule strictly prohibits spaced en dashes.`
    );
  }
});

// ============================================================================
// PART 8: MINIMUM FONT SIZE >= 11px ACROSS TOUCHED UI COMPONENTS
// ============================================================================

test('Challenger 8.1: Minimum font size >= 11px across all touched UI components', () => {
  const uiComponentFiles = [
    'src/components/modals/WelcomeTourModal.tsx',
    'src/components/drawers/StepDock.tsx',
    'src/components/toolbar/CanvasHeader.tsx',
    'src/components/modals/AiJourneyBuilder.tsx',
    'src/components/modals/BlueprintModal.tsx',
    'src/components/drawers/PageEditor.tsx',
    'src/components/drawers/PreFlightAuditDrawer.tsx',
    'src/components/preview/LiveFunnelModal.tsx',
    'server/reviewEngine.mjs'
  ];

  for (const file of uiComponentFiles) {
    assert.ok(fs.existsSync(file), `Component file ${file} must exist`);
    const content = fs.readFileSync(file, 'utf8');

    // Parse all instances of fontSize: "XXpx", fontSize: XX, font-size: XXpx
    const fontSizeRegex = /fontSize:\s*['"`]?([0-9.]+)px?['"`]?|font-size:\s*([0-9.]+)px/g;
    let match;
    let matchCount = 0;

    while ((match = fontSizeRegex.exec(content)) !== null) {
      matchCount++;
      const sizeStr = match[1] || match[2];
      const size = parseFloat(sizeStr);
      assert.ok(
        size >= 11,
        `Font size ${size}px in ${file} violates minimum 11px accessibility threshold (match: "${match[0]}")`
      );
    }

    assert.ok(
      matchCount > 0,
      `Component file ${file} should have explicit font-size declarations verified (found ${matchCount})`
    );
  }
});
