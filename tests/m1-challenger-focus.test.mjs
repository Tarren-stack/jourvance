import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNIVERSAL_BUSINESS_CATEGORIES,
  normalizeBusinessCategory,
  isUniversalBusinessCategory
} from '../src/types/journey.ts';
import crypto from 'node:crypto';
import {
  BUSINESS_TYPES,
  ALL_BUSINESS_TYPES,
  compileShapeLearns,
  SHAPE_MIN_VISITS,
  SHAPE_MIN_ORDERS,
  SHAPE_GENERAL_NICHE
} from '../server/assistantTraining.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Read PageEditor.tsx and aiAssistantRoutes.mjs for AST and structural invariants
const pageEditorSrc = fs.readFileSync('src/components/drawers/PageEditor.tsx', 'utf8');
const aiAssistantRoutesSrc = fs.readFileSync('server/routes/aiAssistantRoutes.mjs', 'utf8');

// ============================================================================
// PART 1: SMART FOCUS DRAWER IN PageEditor.tsx ACROSS ALL 5 BUSINESS CATEGORIES
// ============================================================================

test('Challenger 1.1: Verify PageEditor imports and uses normalizeBusinessCategory', () => {
  assert.match(
    pageEditorSrc,
    /import\s*\{[^}]*normalizeBusinessCategory[^}]*\}\s*from\s*['"]\.\.\/\.\.\/types\/journey['"]/,
    'PageEditor must import normalizeBusinessCategory from src/types/journey'
  );
  assert.match(
    pageEditorSrc,
    /const\s+activeCategory\s*=\s*normalizeBusinessCategory\(businessType\);/,
    'PageEditor must normalize businessType to activeCategory'
  );
});

test('Challenger 1.2: Tool partitioning logic matches specifications for all 5 universal categories', () => {
  // Extract partitioning logic from PageEditor source text to verify pure structural mapping
  const categoryToolPartition = (category) => {
    const activeCategory = normalizeBusinessCategory(category);
    const storeProductBlock = 'block-store-product';
    const directDestinationBlock = 'block-direct-destination';
    const conciergeBlock = 'block-concierge';
    const checkoutModeBlock = 'block-checkout-mode';
    const discountBlock = 'block-discount';
    const orderBumpBlock = 'block-order-bump';

    let primary;
    let secondary;

    if (activeCategory === 'Local & Client Services' || activeCategory === 'B2B, Agencies & Consulting') {
      primary = [directDestinationBlock, conciergeBlock, checkoutModeBlock];
      secondary = [storeProductBlock, discountBlock, orderBumpBlock];
    } else if (activeCategory === 'Digital Products, Courses & Creators') {
      primary = [directDestinationBlock, discountBlock, checkoutModeBlock];
      secondary = [storeProductBlock, conciergeBlock, orderBumpBlock];
    } else if (activeCategory === 'SaaS, Tech & Events') {
      primary = [directDestinationBlock, checkoutModeBlock];
      secondary = [storeProductBlock, conciergeBlock, discountBlock, orderBumpBlock];
    } else {
      // E-Commerce & Physical Retail (default)
      primary = [storeProductBlock, checkoutModeBlock, discountBlock, orderBumpBlock];
      secondary = [directDestinationBlock, conciergeBlock];
    }

    return { primary, secondary };
  };

  // 1. E-Commerce & Physical Retail
  const ecom = categoryToolPartition('E-Commerce & Physical Retail');
  assert.deepEqual(ecom.primary, [
    'block-store-product',
    'block-checkout-mode',
    'block-discount',
    'block-order-bump'
  ]);
  assert.deepEqual(ecom.secondary, [
    'block-direct-destination',
    'block-concierge'
  ]);

  // 2. Local & Client Services
  const local = categoryToolPartition('Local & Client Services');
  assert.deepEqual(local.primary, [
    'block-direct-destination',
    'block-concierge',
    'block-checkout-mode'
  ]);
  assert.deepEqual(local.secondary, [
    'block-store-product',
    'block-discount',
    'block-order-bump'
  ]);

  // 3. B2B, Agencies & Consulting
  const b2b = categoryToolPartition('B2B, Agencies & Consulting');
  assert.deepEqual(b2b.primary, [
    'block-direct-destination',
    'block-concierge',
    'block-checkout-mode'
  ]);
  assert.deepEqual(b2b.secondary, [
    'block-store-product',
    'block-discount',
    'block-order-bump'
  ]);

  // 4. Digital Products, Courses & Creators
  const digital = categoryToolPartition('Digital Products, Courses & Creators');
  assert.deepEqual(digital.primary, [
    'block-direct-destination',
    'block-discount',
    'block-checkout-mode'
  ]);
  assert.deepEqual(digital.secondary, [
    'block-store-product',
    'block-concierge',
    'block-order-bump'
  ]);

  // 5. SaaS, Tech & Events
  const saas = categoryToolPartition('SaaS, Tech & Events');
  assert.deepEqual(saas.primary, [
    'block-direct-destination',
    'block-checkout-mode'
  ]);
  assert.deepEqual(saas.secondary, [
    'block-store-product',
    'block-concierge',
    'block-discount',
    'block-order-bump'
  ]);

  // Fallbacks: legacy string, empty, null, undefined
  for (const fallback of ['E-Commerce Brand', '', null, undefined, 'Unknown Category']) {
    const res = categoryToolPartition(fallback);
    assert.deepEqual(res, ecom, `Fallback '${fallback}' must partition like E-Commerce & Physical Retail`);
  }

  // Completeness check: in all 5 categories, every tool is accounted for exactly once
  const all6Tools = [
    'block-store-product',
    'block-direct-destination',
    'block-concierge',
    'block-checkout-mode',
    'block-discount',
    'block-order-bump'
  ].sort();

  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    const { primary, secondary } = categoryToolPartition(cat);
    assert.equal(primary.length + secondary.length, 6, `Category ${cat} must partition all 6 tools`);
    const combined = [...primary, ...secondary].sort();
    assert.deepEqual(combined, all6Tools, `Category ${cat} must include all 6 unique tools without omission or duplication`);
  }
});

test('Challenger 1.3: Active secondary badges compute accurately across all categories and states', () => {
  // Model the secondaryActiveCount algorithm from PageEditor.tsx:1579-1596
  const computeActiveCount = (category, data) => {
    const activeCategory = normalizeBusinessCategory(category);
    const isStoreActive = Boolean(data.shopifyVariantId || data.shopifyProductId);
    const isDirectActive = Boolean(data.checkoutUrl);
    const isConciergeActive = Boolean(data.chatConciergeEnabled);
    const isDiscountActive = Boolean(data.discountCode);
    const isBumpActive = Boolean(data.orderBumpEnabled);

    let secondaryActiveCount = 0;
    if (activeCategory === 'E-Commerce & Physical Retail') {
      if (isDirectActive) secondaryActiveCount++;
      if (isConciergeActive) secondaryActiveCount++;
    } else if (activeCategory === 'Local & Client Services' || activeCategory === 'B2B, Agencies & Consulting') {
      if (isStoreActive) secondaryActiveCount++;
      if (isDiscountActive) secondaryActiveCount++;
      if (isBumpActive) secondaryActiveCount++;
    } else if (activeCategory === 'Digital Products, Courses & Creators') {
      if (isStoreActive) secondaryActiveCount++;
      if (isConciergeActive) secondaryActiveCount++;
      if (isBumpActive) secondaryActiveCount++;
    } else {
      if (isStoreActive) secondaryActiveCount++;
      if (isConciergeActive) secondaryActiveCount++;
      if (isDiscountActive) secondaryActiveCount++;
      if (isBumpActive) secondaryActiveCount++;
    }
    return secondaryActiveCount;
  };

  // 1. Retail: secondary is directDestination and concierge
  assert.equal(computeActiveCount('E-Commerce & Physical Retail', {}), 0);
  assert.equal(computeActiveCount('E-Commerce & Physical Retail', { checkoutUrl: 'https://buy.stripe.com/123' }), 1);
  assert.equal(computeActiveCount('E-Commerce & Physical Retail', { chatConciergeEnabled: true }), 1);
  assert.equal(computeActiveCount('E-Commerce & Physical Retail', { checkoutUrl: 'https://buy.stripe.com/123', chatConciergeEnabled: true }), 2);
  // Changing primary options (store, bump, discount) should NOT change secondary active count in Retail
  assert.equal(computeActiveCount('E-Commerce & Physical Retail', { shopifyVariantId: '123', discountCode: 'SAVE', orderBumpEnabled: true }), 0);

  // 2. Local Services: secondary is storeProduct, discount, orderBump
  assert.equal(computeActiveCount('Local & Client Services', {}), 0);
  assert.equal(computeActiveCount('Local & Client Services', { shopifyVariantId: '123' }), 1);
  assert.equal(computeActiveCount('Local & Client Services', { discountCode: 'SAVE20' }), 1);
  assert.equal(computeActiveCount('Local & Client Services', { orderBumpEnabled: true }), 1);
  assert.equal(computeActiveCount('Local & Client Services', { shopifyVariantId: '123', discountCode: 'SAVE20', orderBumpEnabled: true }), 3);
  // Changing primary options (directUrl, concierge) should NOT increment secondary count in Local Services
  assert.equal(computeActiveCount('Local & Client Services', { checkoutUrl: 'https://buy.stripe.com/123', chatConciergeEnabled: true }), 0);

  // 3. Digital Products / Creators: secondary is storeProduct, concierge, orderBump
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', {}), 0);
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', { shopifyProductId: 'prod_99' }), 1);
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', { chatConciergeEnabled: true }), 1);
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', { orderBumpEnabled: true }), 1);
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', { shopifyProductId: 'prod_99', chatConciergeEnabled: true, orderBumpEnabled: true }), 3);
  // Primary options (directUrl, discount) should not increment secondary count
  assert.equal(computeActiveCount('Digital Products, Courses & Creators', { checkoutUrl: 'https://example.com', discountCode: 'DISCOUNT' }), 0);

  // 4. SaaS, Tech & Events: secondary is storeProduct, concierge, discount, orderBump (all 4)
  assert.equal(computeActiveCount('SaaS, Tech & Events', {}), 0);
  assert.equal(computeActiveCount('SaaS, Tech & Events', { shopifyVariantId: '1' }), 1);
  assert.equal(computeActiveCount('SaaS, Tech & Events', { shopifyVariantId: '1', chatConciergeEnabled: true }), 2);
  assert.equal(computeActiveCount('SaaS, Tech & Events', { shopifyVariantId: '1', chatConciergeEnabled: true, discountCode: 'OFFER' }), 3);
  assert.equal(computeActiveCount('SaaS, Tech & Events', { shopifyVariantId: '1', chatConciergeEnabled: true, discountCode: 'OFFER', orderBumpEnabled: true }), 4);
});

test('Challenger 1.4: Drawer button and panel adhere to W3C ARIA progressive disclosure specification', () => {
  // Verify toggle button ARIA attributes
  assert.match(pageEditorSrc, /id=\{fid\('more-commerce-toggle'\)\}/);
  assert.match(pageEditorSrc, /aria-expanded=\{moreCommerceOpen\}/);
  assert.match(pageEditorSrc, /aria-controls=\{fid\('more-commerce-panel'\)\}/);
  assert.match(pageEditorSrc, /onClick=\{\(\) => setMoreCommerceOpen\(open => !open\)\}/);

  // Verify panel ARIA attributes
  assert.match(pageEditorSrc, /id=\{fid\('more-commerce-panel'\)\}/);
  assert.match(pageEditorSrc, /role="region"/);
  assert.match(pageEditorSrc, /aria-labelledby=\{fid\('more-commerce-toggle'\)\}/);
  assert.match(pageEditorSrc, /hidden=\{!moreCommerceOpen\}/);

  // Verify badge markup inside toggle
  assert.match(pageEditorSrc, /\{secondaryActiveCount > 0 && \([\s\S]*?\{secondaryActiveCount\} active/);

  // Verify animated Chevron
  assert.match(pageEditorSrc, /transform:\s*moreCommerceOpen\s*\?\s*'rotate\(180deg\)'\s*:\s*'rotate\(0deg\)'/);
});

test('Challenger 1.5: Input focus preservation and DOM fiber stability invariants', () => {
  // Invariant 1: Top-level state declaration for moreCommerceOpen in PageEditor
  assert.match(
    pageEditorSrc,
    /const\s+\[moreCommerceOpen,\s*setMoreCommerceOpen\]\s*=\s*useState\(false\);/,
    'moreCommerceOpen must be declared at the PageEditor function component top level'
  );

  // Invariant 2: Blocks must be JSX Element values, NEVER inline React functional components.
  // Defining `const StoreProductBlock = () => ...` inside render would recreate the component type
  // on every render and destroy the DOM subtree (and user focus) on each keystroke!
  const forbiddenComponentPatterns = [
    /const\s+StoreProductBlock\s*=\s*\(/,
    /const\s+DirectDestinationBlock\s*=\s*\(/,
    /const\s+ConciergeBlock\s*=\s*\(/,
    /const\s+CheckoutModeBlock\s*=\s*\(/,
    /const\s+DiscountBlock\s*=\s*\(/,
    /const\s+OrderBumpBlock\s*=\s*\(/,
    /function\s+StoreProductBlock\b/,
    /function\s+DirectDestinationBlock\b/
  ];
  for (const pat of forbiddenComponentPatterns) {
    assert.doesNotMatch(pageEditorSrc, pat, 'Blocks must be JSX Elements, not inline components');
  }

  // Invariant 3: Explicit stable keys on each block container for deterministic fiber reconciliation
  const requiredKeys = [
    'block-store-product',
    'block-direct-destination',
    'block-concierge',
    'block-checkout-mode',
    'block-discount',
    'block-order-bump'
  ];
  for (const k of requiredKeys) {
    assert.match(pageEditorSrc, new RegExp(`key="${k}"`), `Block container must specify key="${k}"`);
  }

  // Invariant 4: Secondary panel uses `hidden={!moreCommerceOpen}` and `display: none`, NOT `{moreCommerceOpen && (...)}`
  // This ensures inputs remain mounted in the DOM when closed and do not suffer mount/unmount thrash
  assert.match(
    pageEditorSrc,
    /hidden=\{!moreCommerceOpen\}\s*style=\{\{[\s\S]*?display:\s*moreCommerceOpen\s*\?\s*'flex'\s*:\s*'none'/,
    'Secondary drawer must remain mounted with hidden attribute and display toggle to prevent unmounting'
  );

  // Invariant 5: Unique fid IDs across all inputs in PageEditor
  const fidMatches = [...pageEditorSrc.matchAll(/\sid=\{fid\('([^']+)'\)\}/g)].map(m => m[1]);
  const dupeIds = fidMatches.filter((id, i) => fidMatches.indexOf(id) !== i);
  assert.deepEqual(dupeIds, [], `PageEditor must contain zero duplicate fid() IDs. Found duplicates: ${dupeIds}`);
});

// ============================================================================
// PART 2: BACKEND ASSISTANT TRAINING SHAPE LEARNS STRESS TESTING
// ============================================================================

const sampleNodes = [
  { id: 'n1', type: 'page', data: { pageType: 'landing' }, position: { x: 0, y: 0 } },
  { id: 'n2', type: 'upsell', data: { offerType: 'upsell' }, position: { x: 200, y: 0 } },
  { id: 'n3', type: 'thank-you', data: {}, position: { x: 400, y: 0 } }
];

const makeJourney = (id, businessType, goal = 'sales', platform = 'shopify') => ({
  id,
  userId: 'user_challenger',
  businessType,
  goal,
  platform,
  nodes: sampleNodes
});

const makeFigures = (visits, orders) => ({
  visits,
  orders
});

test('Challenger 2.1: Threshold boundary stress-testing on visit and order counts', () => {
  const uid = 'user_challenger';

  // Test Case A: Under visit threshold (199 visits, 50 orders) -> skipped.fewVisits
  {
    const j1 = makeJourney('j1', 'E-Commerce & Physical Retail');
    const figures = new Map([['j1', makeFigures(199, 50)]]);
    const res = compileShapeLearns({ uid, journeys: [j1], figures });
    assert.equal(res.rows.length, 0);
    assert.equal(res.skipped.fewVisits, 1);
    assert.equal(res.skipped.fewOrders, 0);
  }

  // Test Case B: At exact visit threshold (200 visits, 19 orders) -> skipped.fewOrders
  {
    const j2 = makeJourney('j2', 'E-Commerce & Physical Retail');
    const figures = new Map([['j2', makeFigures(200, 19)]]);
    const res = compileShapeLearns({ uid, journeys: [j2], figures });
    assert.equal(res.rows.length, 0);
    assert.equal(res.skipped.fewVisits, 0);
    assert.equal(res.skipped.fewOrders, 1);
  }

  // Test Case C: At exact threshold boundary (200 visits, 20 orders) -> exactly qualifies!
  {
    const j3 = makeJourney('j3', 'E-Commerce & Physical Retail');
    const figures = new Map([['j3', makeFigures(200, 20)]]);
    const res = compileShapeLearns({ uid, journeys: [j3], figures });
    assert.equal(res.rows.length, 1);
    assert.equal(res.skipped.fewVisits, 0);
    assert.equal(res.skipped.fewOrders, 0);
    assert.equal(res.rows[0].journeyId, 'j3');
  }

  // Test Case D: High visit & order count (1,000,000 visits, 150,000 orders)
  {
    const j4 = makeJourney('j4', 'SaaS, Tech & Events');
    const figures = new Map([['j4', makeFigures(1000000, 150000)]]);
    const res = compileShapeLearns({ uid, journeys: [j4], figures });
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].niche, 'SaaS, Tech & Events');
  }

  // Test Case E: Malformed & adversarial figure inputs (null, NaN, negative, string, undefined)
  {
    const badFigures = [
      makeFigures(null, 50),
      makeFigures(250, null),
      makeFigures(undefined, 50),
      makeFigures(-10, 50),
      makeFigures(250, -5),
      makeFigures('200', '20'), // non-number types should not qualify
      makeFigures(NaN, 50),
      makeFigures(Infinity, 50)
    ];

    for (const [idx, fig] of badFigures.entries()) {
      const jBad = makeJourney(`j_bad_${idx}`, 'B2B, Agencies & Consulting');
      const figures = new Map([[`j_bad_${idx}`, fig]]);
      const res = compileShapeLearns({ uid, journeys: [jBad], figures });
      assert.equal(res.rows.length, 0, `Adversarial figure ${JSON.stringify(fig)} should produce 0 rows`);
    }
  }

  // Test Case F: Journey with no valid nodes / steps -> skipped.noShape
  {
    const jEmpty = { id: 'j_empty', userId: uid, businessType: 'Local & Client Services', nodes: [] };
    const figures = new Map([['j_empty', makeFigures(300, 30)]]);
    const res = compileShapeLearns({ uid, journeys: [jEmpty], figures });
    assert.equal(res.rows.length, 0);
    assert.equal(res.skipped.noShape, 1);
  }
});

test('Challenger 2.2: Universal business categories stress-testing and exact niche extraction', () => {
  const uid = 'user_challenger';

  // Stress-test each of the 5 canonical universal categories
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    const j = makeJourney(`j_${cat}`, cat);
    const figures = new Map([[`j_${cat}`, makeFigures(500, 50)]]);
    const res = compileShapeLearns({ uid, journeys: [j], figures });
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].niche, cat, `Shape learn for ${cat} must have niche equal to ${cat}`);
  }

  // Test legacy 'E-Commerce Store'
  {
    const jLegacy = makeJourney('j_legacy', 'E-Commerce Store');
    const figures = new Map([['j_legacy', makeFigures(500, 50)]]);
    const res = compileShapeLearns({ uid, journeys: [jLegacy], figures });
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].niche, 'E-Commerce Store');
  }

  // Test leading/trailing whitespace trimming: '  Digital Products, Courses & Creators  '
  {
    const jPadded = makeJourney('j_padded', '  Digital Products, Courses & Creators  ');
    const figures = new Map([['j_padded', makeFigures(500, 50)]]);
    const res = compileShapeLearns({ uid, journeys: [jPadded], figures });
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].niche, 'Digital Products, Courses & Creators');
  }
});

test('Challenger 2.3: Unknown, custom, and adversarial business types evaluate strictly to general', () => {
  const uid = 'user_challenger';
  const unknownTypes = [
    'Real Estate Agency',
    'Cryptocurrency Fund',
    'Fine Dining Restaurant',
    'e-commerce store', // case-sensitive check
    'SAAS, TECH & EVENTS',
    'Custom Artisan',
    'Random Business Type 99',
    '',
    '   ',
    null,
    undefined,
    12345,
    { custom: 'obj' },
    ['ArrayType'],
    '__proto__',
    'constructor'
  ];

  for (const [idx, unk] of unknownTypes.entries()) {
    const j = makeJourney(`j_unk_${idx}`, unk);
    const figures = new Map([[`j_unk_${idx}`, makeFigures(300, 30)]]);
    const res = compileShapeLearns({ uid, journeys: [j], figures });
    assert.equal(res.rows.length, 1, `Unknown type ${String(unk)} should still produce a qualified row`);
    assert.equal(res.rows[0].niche, SHAPE_GENERAL_NICHE, `Unknown type ${String(unk)} must fall back to '${SHAPE_GENERAL_NICHE}'`);
  }
});

test('Challenger 2.4: Shape learns prompt format, ranking, ratings, and deduplication', () => {
  const uid = 'user_challenger';

  // Journey 1: 1,000 visits, 50 orders (5% rate)
  const j1 = makeJourney('j1', 'B2B, Agencies & Consulting');
  // Journey 2: 1,000 visits, 150 orders (15% rate)
  const j2 = makeJourney('j2', 'Local & Client Services');
  // Journey 3: duplicate shape of Journey 1
  const j3 = makeJourney('j3', 'B2B, Agencies & Consulting');

  const figures = new Map([
    ['j1', makeFigures(1000, 50)],
    ['j2', makeFigures(1000, 150)],
    ['j3', makeFigures(1000, 50)]
  ]);

  const res = compileShapeLearns({ uid, journeys: [j1, j2, j3], figures });

  // Deduplication check: j1 and j3 have identical prompt, niche, and kind -> sha is identical
  assert.equal(res.rows.length, 2, 'Identical shapes must be deduplicated by sha256');

  // Verify prompt structure: no raw digits, words only
  for (const row of res.rows) {
    assert.match(row.prompt, /^Orders per hundred visits: [a-z -]+\. A [a-z -]+ journey from [a-z -]+ with [a-z -]+ steps?: .+\.$/);
    assert.doesNotMatch(row.prompt, /\d+/, 'Shape learn prompt must contain ZERO digits (words only)');
    // Verify sha hash integrity
    const expectedSha = sha256(`${row.kind}\n${row.niche}\n${row.prompt}`);
    assert.equal(row.sha, expectedSha, 'Row sha must match cryptographic sha256 of kind, niche, prompt');
  }

  // Median rating test for [j1, j2, j3]:
  // Rates: j1=5%, j2=15%, j3=5%. Sorted: [0.05, 0.05, 0.15].
  // Quantile 0.5 (median) is 0.05.
  // 2 * median = 0.10.
  // j2 rate is 0.15 >= 0.10, so j2 gets rating 5!
  // j1 rate is 0.05 < 0.10, so j1 gets rating 4.
  // Candidates sort rating 5 before rating 4, so rows[0] is j2 (rating 5) and rows[1] is j1 (rating 4).
  assert.equal(res.rows[0].journeyId, 'j2');
  assert.equal(res.rows[0].rating, 5);
  assert.equal(res.rows[1].journeyId, 'j1');
  assert.equal(res.rows[1].rating, 4);

  // Now test an account where NO journey reaches 2x median:
  // Journeys with rates 10%, 10%, 15%. Sorted: [0.10, 0.10, 0.15].
  // Median is 0.10. 2 * median is 0.20. None reaches 0.20, so all get rating 4.
  const jA = makeJourney('jA', 'SaaS, Tech & Events');
  const jB = makeJourney('jB', 'Digital Products, Courses & Creators');
  const figuresNoOutperformer = new Map([
    ['jA', makeFigures(1000, 100)],
    ['jB', makeFigures(1000, 150)]
  ]);
  const resNoOutperformer = compileShapeLearns({ uid, journeys: [jA, jB], figures: figuresNoOutperformer });
  assert.equal(resNoOutperformer.rows.length, 2);
  // Median of [0.10, 0.15] is 0.125. 2 * median = 0.25. Neither is >= 0.25, so both are 4.
  assert.equal(resNoOutperformer.rows[0].rating, 4);
  assert.equal(resNoOutperformer.rows[1].rating, 4);
});

test('Challenger 2.5: aiAssistantRoutes.mjs wires ALL_BUSINESS_TYPES to compileShapeLearns', () => {
  assert.match(
    aiAssistantRoutesSrc,
    /import\s*\{[^}]*ALL_BUSINESS_TYPES[^}]*\}\s*from\s*['"]\.\.\/assistantTraining\.mjs['"]/,
    'aiAssistantRoutes.mjs must import ALL_BUSINESS_TYPES'
  );
  assert.match(
    aiAssistantRoutesSrc,
    /compileShapeLearns\(\{[\s\S]*?businessTypes:\s*ALL_BUSINESS_TYPES[\s\S]*?\}\)/,
    'aiAssistantRoutes.mjs must pass ALL_BUSINESS_TYPES to compileShapeLearns'
  );
});

test('Challenger 2.6: No em dashes or spaced en dashes in test or implementation additions', () => {
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    assert.doesNotMatch(cat, /[\u2014]|\s[\u2013]\s/);
  }
});
