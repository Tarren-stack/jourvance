import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const HUB = path.resolve(ROOT, '../..');

// ============================================================================
// Section 1: Legacy Snapshot Zero-Drift & Fixture Integrity
// ============================================================================
describe('Empirical Challenge: Legacy Snapshot Zero-Drift & Fixture Preservation', async () => {
  const {
    renderPublicFunnelHtml,
    renderPublicThankYouHtml,
    renderPublicUpsellHtml,
    withTracking
  } = await import('../server/routes/publicRoutes.mjs');

  const DIR = path.join(ROOT, 'test-fixtures', 'legacy-pages');
  const shop = { storeDomain: 'shop.myshopify.com', currency: 'USD' };
  const VARIANT = 'gid://shopify/ProductVariant/123';
  const BUMP = 'gid://shopify/ProductVariant/456';
  const req = (query = {}, headers = {}) => ({ query, headers, params: {} });

  const fullLanding = {
    headline: 'Glow in seven days',
    subhead: 'A serum made in small batches.',
    bullets: ['Fragrance free', 'Dermatologist tested', 'Ships in 2 days'],
    buttonText: 'Get the serum',
    heroImageUrl: 'https://cdn.example.com/hero.jpg',
    shopifyVariantId: VARIANT,
    shopifyProductId: 'gid://shopify/Product/9',
    shopifyProductTitle: 'Glow Serum',
    shopifyProductPrice: '48.00',
    shopifyProductImage: 'https://cdn.example.com/serum.jpg',
    discountCode: 'WELCOME10',
    trustBadge: 'Free returns for 30 days',
    orderBumpEnabled: true,
    orderBumpVariantId: BUMP,
    orderBumpTitle: 'Travel size',
    orderBumpPrice: '12.00',
    orderBumpHeadline: 'Add a travel size',
    orderBumpDescription: 'Fits a carry-on.',
    urgencyTimerEnabled: true,
    urgencyMinutes: 15,
    urgencyText: 'This offer ends in',
    scarcityBatchEnabled: true,
    scarcityBatchCount: 40,
    exitIntentEnabled: true,
    exitIntentHeadline: 'Wait, take 10 percent off',
    exitIntentDiscountCode: 'STAY10',
    metaPixelId: '123456789012345',
    tiktokPixelId: 'C1ABCDEFGHIJKLMNOP',
    ga4TrackingId: 'G-ABC123XYZ9',
    abTestingEnabled: true,
    splitRatio: 50,
    variantB: { headline: 'Glow in a week', buttonText: 'Start glowing', subhead: 'Small batches, big results.' }
  };

  const FIXTURES = [
    ['landing-minimal-nostore', () => renderPublicFunnelHtml(
      { slug: 'min', data: { headline: 'Hello', buttonText: 'Buy' }, shopifyConfig: {} }, req(), null)],
    ['landing-full-a', () => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop }, req({ var: 'a' }), null)],
    ['landing-full-b', () => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop }, req({ var: 'b' }), null)],
    ['landing-full-eur', () => renderPublicFunnelHtml(
      { slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop }, req({ var: 'a', currency: 'EUR' }), null)],
    ['landing-lead-gate', () => renderPublicFunnelHtml(
      { slug: 'gate', data: { headline: 'Free guide', buttonText: 'Send it', checkoutMode: 'lead-gate', shopifyVariantId: VARIANT, shopifyProductPrice: '0' }, shopifyConfig: shop }, req(), null)],
    ['landing-lead-gate-nocode', () => renderPublicFunnelHtml(
      { slug: 'gate2', data: { headline: 'Join', buttonText: 'Join', checkoutMode: 'lead-gate', shopifyVariantId: VARIANT }, shopifyConfig: shop }, req(), null)],
    ['landing-referral', () => renderPublicFunnelHtml(
      { slug: 'ref', data: { headline: 'Refer', buttonText: 'Buy', shopifyVariantId: VARIANT, discountCode: 'SAVE5' }, shopifyConfig: shop }, req({ ref: 'friend42', utm_source: 'fb' }), null)],
    ['thank-you', () => renderPublicThankYouHtml(
      { slug: 'ty', data: { headline: 'Thank you', subhead: 'Your order is on its way.' }, shopifyConfig: shop }, req(), null)],
    ['upsell', () => renderPublicUpsellHtml(
      { slug: 'up', data: { headline: 'One more thing', subhead: 'Add the refill.', buttonText: 'Add it', shopifyVariantId: VARIANT, shopifyProductPrice: '20.00' }, shopifyConfig: shop }, req(), null, false)],
    ['downsell', () => renderPublicUpsellHtml(
      { slug: 'down', data: { headline: 'How about this', offerType: 'downsell', buttonText: 'Yes please', shopifyVariantId: VARIANT, shopifyProductPrice: '9.00' }, shopifyConfig: shop }, req(), null, true)],
    ['landing-with-tracking', () => withTracking(
      renderPublicFunnelHtml({ slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop }, req({ var: 'a' }), null),
      'full', 'a', true, { productId: 'gid://shopify/Product/9', price: '48.00' }, {})]
  ];

  it('all 11 legacy golden files exist and match byte-for-byte with 0 bytes drift', () => {
    assert.equal(fs.existsSync(DIR), true, 'legacy-pages directory must exist');
    const existingFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
    assert.equal(existingFiles.length, 11, 'exactly 11 golden html files expected');

    for (const [name, render] of FIXTURES) {
      const p = path.join(DIR, `${name}.html`);
      assert.ok(fs.existsSync(p), `golden snapshot exists: ${name}.html`);
      const golden = fs.readFileSync(p, 'utf8');
      const rendered = render();
      assert.equal(rendered.length, golden.length, `${name}: byte length matches exactly (${rendered.length})`);
      assert.equal(rendered, golden, `${name}: byte-for-byte identical, 0 drift`);
    }
  });

  it('no fixture carries a builder field or theme field', () => {
    for (const [name] of FIXTURES) {
      const golden = fs.readFileSync(path.join(DIR, `${name}.html`), 'utf8');
      assert.doesNotMatch(golden, /data-builder-version/i);
      assert.doesNotMatch(golden, /jv-page-theme/i);
    }
  });

  it('explicit undefined, empty string, or unset theme produces identical legacy bytes', () => {
    const basePage = { slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop };
    const defaultRender = renderPublicFunnelHtml(basePage, req({ var: 'a' }), null);
    const explicitUndefined = renderPublicFunnelHtml({ ...basePage, data: { ...fullLanding, theme: undefined } }, req({ var: 'a' }), null);
    const explicitEmpty = renderPublicFunnelHtml({ ...basePage, data: { ...fullLanding, theme: '' } }, req({ var: 'a' }), null);
    const explicitUnknown = renderPublicFunnelHtml({ ...basePage, data: { ...fullLanding, theme: 'nonexistent-theme' } }, req({ var: 'a' }), null);

    assert.equal(explicitUndefined, defaultRender, 'explicit undefined theme matches default render');
    assert.equal(explicitEmpty, defaultRender, 'explicit empty string theme matches default render');
    assert.equal(explicitUnknown, defaultRender, 'unknown theme falls back to default render with 0 drift');
  });

  it('setting an active theme activates CSS variables without corrupting legacy layout structure', () => {
    const themedPage = {
      slug: 'full',
      userId: 'u1',
      data: { ...fullLanding, theme: 'clean-executive' },
      shopifyConfig: shop
    };
    const themed = renderPublicFunnelHtml(themedPage, req({ var: 'a' }), null);
    assert.match(themed, /id="jv-page-theme"/, 'themed page contains theme style block');
    assert.match(themed, /--font-heading:/, 'themed page contains font-heading variable');
    assert.match(themed, /--primary:/, 'themed page contains primary color variable');
    // Ensure core legacy HTML elements still exist inside themed page
    assert.match(themed, /<body/);
    assert.match(themed, /Glow in seven days/);
    assert.match(themed, /Get the serum/);
  });
});

// ============================================================================
// Section 2: Security Sentinel & Vendored Dists Byte Integrity
// ============================================================================
describe('Empirical Challenge: Security Sentinel & Vendored Dists Byte Integrity', () => {
  it('security-sentinel.js and hub-sdk.js are exact byte copies of hub dists', (t) => {
    const pairs = [
      ['security-sentinel.js', 'sentinel-dist/security-sentinel.js'],
      ['hub-sdk.js', 'hub-sdk-dist/hub-sdk.js']
    ];
    const present = pairs.filter(([, hub]) => fs.existsSync(path.join(HUB, hub)));
    if (present.length === 0) {
      return t.skip('the hub checkout is not beside this one');
    }
    for (const [local, hub] of present) {
      const localBuf = fs.readFileSync(path.join(ROOT, local));
      const hubBuf = fs.readFileSync(path.join(HUB, hub));
      assert.ok(localBuf.equals(hubBuf), `${local} differs from hub's ${hub}: byte-for-byte equality required`);
    }
  });

  it('server.mjs mounts Security Sentinel in the exact required middleware sequence', () => {
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');

    const parser = serverSrc.indexOf('app.use(express.json(');
    const trust = serverSrc.indexOf("app.set('trust proxy', trustedProxy)");
    const mask = serverSrc.indexOf('app.use(sentinelShield.mask)');
    const sentinel = serverSrc.indexOf('applySecurity(app, {');
    const restore = serverSrc.indexOf('app.use(sentinelShield.restore)');
    const firstRoute = serverSrc.search(/^app\.(get|post|put|delete)\(/m);

    assert.ok(parser > 0, 'express.json parser is mounted');
    assert.ok(trust > parser, 'trust proxy is mounted after body parser');
    assert.ok(mask > trust, 'sentinelShield.mask is mounted after trust proxy');
    assert.ok(sentinel > mask, 'applySecurity is mounted after shield mask');
    assert.ok(restore > sentinel, 'sentinelShield.restore is mounted after applySecurity');
    assert.ok(firstRoute > restore, 'routes are mounted after shield restore');

    // Trust proxy must be set by address function, never boolean true or numeric
    assert.doesNotMatch(serverSrc, /app\.set\('trust proxy', (true|\d+)\)/);
  });

  it('CSP configuration in server.mjs includes all essential origins', () => {
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
    const sentinelIdx = serverSrc.indexOf('applySecurity(app, {');
    const opts = serverSrc.slice(sentinelIdx, serverSrc.indexOf('});', sentinelIdx));

    // Frame sources
    for (const origin of [
      'https://gen-lang-client-0527980301.firebaseapp.com',
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com'
    ]) {
      assert.ok(opts.includes(`'${origin}'`), `extraFrameSrc must contain ${origin}`);
    }

    // Script sources
    for (const origin of [
      'https://zeluslabs.dev',
      'https://connect.facebook.net',
      'https://analytics.tiktok.com',
      'https://www.googletagmanager.com'
    ]) {
      assert.ok(opts.includes(`'${origin}'`), `extraScriptSrc must contain ${origin}`);
    }
  });
});

// ============================================================================
// Section 3: Running Audit Log (`JOURVANCE_RUNNING_AUDIT.md`) Strict Verification
// ============================================================================
describe('Empirical Challenge: Running Audit Log Compliance', () => {
  const auditPath = path.join(ROOT, 'JOURVANCE_RUNNING_AUDIT.md');
  assert.ok(fs.existsSync(auditPath), 'JOURVANCE_RUNNING_AUDIT.md exists');
  const auditContent = fs.readFileSync(auditPath, 'utf8');
  const auditLines = auditContent.split(/\r?\n/);

  it('line 5 contains the updated summary for Milestone 4', () => {
    const line5 = auditLines[4] || '';
    assert.match(
      line5,
      /^Checked: 2026-10-29\. Multi-Industry Universal Themes/
    );
    assert.ok(line5.includes('R1 Universal Categories & Smart Focus'), 'summary contains R1');
    assert.ok(line5.includes('R2 5 Page Themes & Zero-Drift Legacy Snapshots'), 'summary contains R2');
    assert.ok(line5.includes('R3 Cross-Engine Wiring & Previews'), 'summary contains R3');
    assert.ok(line5.includes('R4 Copy Neutralization'), 'summary contains R4');
  });

  it('newest audit entry begins with dated section ## 2026-10-29', () => {
    const firstSectionHeading = auditLines.find(l => l.startsWith('## '));
    assert.equal(
      firstSectionHeading,
      '## 2026-10-29: Multi-Industry Universal Themes, Cross-Engine Wiring, and Universal Copy Neutralization'
    );
  });

  it('top audit section places limits first with accurate test counts and browser verification', () => {
    const sectionIndex = auditLines.findIndex(l => l.startsWith('## 2026-10-29:'));
    const sectionText = auditLines.slice(sectionIndex, sectionIndex + 30).join('\n');

    assert.match(sectionText, /\*\*Limits first\.\*\*/, 'Audit entry must start with "Limits first."');
    assert.match(sectionText, /not deployed/i, 'Mentions deployment status');
    assert.match(sectionText, /tsc --noEmit.*exited 0/i, 'Documents TypeScript verification');
    assert.match(sectionText, /3,243 tests across 130 test suites/, 'Documents accurate test count (3,243)');
    assert.match(sectionText, /0 failures/, 'Documents 0 failures');
    assert.match(sectionText, /3 skips gated on `JOURVANCE_LIVE_TEST_URL`/, 'Documents the 3 JOURVANCE_LIVE_TEST_URL skips');
    assert.match(sectionText, /page-builder-legacy-snapshot\.test\.mjs.*passed 13\/13/i, 'Documents legacy snapshots 13/13');
    assert.match(sectionText, /sentinel-adoption\.test\.mjs.*passed 6\/6/i, 'Documents sentinel 6/6');
    assert.match(sectionText, /npm run check:a11y.*passed 22\/22/i, 'Documents headless Chrome check:a11y');
    assert.match(sectionText, /npm run check:canvas/, 'Documents headless Chrome check:canvas');
    assert.match(sectionText, /npm run check:overlaps.*passed 102\/102/i, 'Documents headless Chrome check:overlaps');
    assert.match(sectionText, /Zero em dashes/, 'Documents zero em dash invariant');
    assert.match(sectionText, /11px font size standard/, 'Documents 11px font size standard');
  });

  it('top audit entry contains details for R1, R2, R3, and R4', () => {
    const sectionIndex = auditLines.findIndex(l => l.startsWith('## 2026-10-29:'));
    const nextSectionIndex = auditLines.findIndex((l, idx) => idx > sectionIndex && l.startsWith('## 2026-10-28:'));
    const m4AuditText = auditLines.slice(sectionIndex, nextSectionIndex).join('\n');

    assert.ok(m4AuditText.includes('R1: Universal Business Categories'), 'contains R1 detail');
    assert.ok(m4AuditText.includes('R2: 5 All-Industry Published Page Themes'), 'contains R2 detail');
    assert.ok(m4AuditText.includes('R3: Cross-Engine Wiring'), 'contains R3 detail');
    assert.ok(m4AuditText.includes('R4: Universal Copy Neutralization'), 'contains R4 detail');
  });
});

// ============================================================================
// Section 4: M4 Copy Neutralization & Pinned Invariant Preservation
// ============================================================================
describe('Empirical Challenge: M4 Copy Neutralization & Strict Test Pin Preservation', async () => {
  const { renderReviewPortalHtml } = await import('../server/reviewEngine.mjs');

  it('src/data/ecomBlueprints.ts neutralizes niche copy while preserving test pins', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/data/ecomBlueprints.ts'), 'utf8');

    // Neutralized phrases present
    assert.ok(src.includes('physical goods, retail products, and direct orders'), 'neutralized single-product description');
    assert.ok(src.includes('Complete Performance Bundle for Modern Teams: Save 20%'), 'neutralized bp5-ad headline');
    assert.ok(src.includes('subscription products, high-retention brands, and digital platforms'), 'neutralized retention description');
    assert.ok(src.includes('checkout recovery'), 'neutralized checkout recovery');

    // Niche hype phrases absent
    assert.doesNotMatch(src, /The All-in-One Solution/);
    assert.doesNotMatch(src, /retail goods and physical e-commerce brands/);

    // Test pins from design-checks.test.mjs & blueprint tests preserved
    assert.ok(src.includes('Save 20%'), 'Save 20% pinned by design-checks.test.mjs:700');
    assert.ok(src.includes('single-product-flash-drop'), 'single-product-flash-drop id preserved');
    assert.ok(src.includes('turnkey-retention-ecosystem'), 'turnkey-retention-ecosystem id preserved');
    assert.ok(src.includes('product-flagship-drop'), 'slug preserved');
    assert.ok(src.includes('3.4x ROI'), 'sample metric preserved');
    assert.ok(src.includes('VIPGLOW15'), 'discount code preserved');
  });

  it('src/components/modals/WelcomeTourModal.tsx preserves all 8 test assertions from launch-playbook.test.mjs', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/components/modals/WelcomeTourModal.tsx'), 'utf8');

    // Universal copy present
    assert.ok(src.includes('physical retail, client services, consulting, digital courses, or SaaS'));
    assert.ok(src.includes('online stores, payment links, or calendar bookings'));

    // 8 pinned assertions from launch-playbook.test.mjs:61-72
    assert.ok(src.includes('export const WelcomeTourModal'));
    assert.ok(src.includes('ModalDialog labelledBy="welcome-tour-title"'));
    assert.ok(src.includes("export const WELCOME_TOUR_STORAGE_KEY = 'jourvance_welcome_tour_seen'"));
    assert.ok(src.includes('Skip Tour'));
    assert.ok(src.includes('Start with a Turnkey Blueprint or Draft with AI'));
    assert.ok(src.includes('Edit Your Page & Connect Checkout or Calendar Links'));
    assert.ok(src.includes('Simulate as Lead or Buyer & Share Client Pitch Links'));
    assert.ok(src.includes('Run Pre-Flight Checks & Publish in One Click'));
  });

  it('src/components/drawers/StepDock.tsx preserves all 9 assertions from launch-playbook.test.mjs', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/components/drawers/StepDock.tsx'), 'utf8');

    // Neutralized copy at line 405
    assert.ok(src.includes('E-commerce, client services, consulting, digital products, or SaaS'));

    // Pinned assertions from launch-playbook.test.mjs:74-84
    assert.ok(src.includes('aria-label="Quick-start guide"'));
    assert.ok(src.includes('Quick-Start & New Features'));
    assert.ok(src.includes('Take 60s Tour'));
    assert.ok(src.includes('1. Pick a Business Blueprint'));
    assert.ok(src.includes('2. Edit Landing Page & Offer'));
    assert.ok(src.includes('3. Connect Store or Booking Link'));
    assert.ok(src.includes('4. Simulate Lead vs. Buyer Flow'));
  });

  it('server/reviewEngine.mjs preserves curated reviews structure and negative regex invariants', async () => {
    const { DEFAULT_CURATED_REVIEWS } = await import('../server/reviewEngine.mjs');
    const src = fs.readFileSync(path.join(ROOT, 'server/reviewEngine.mjs'), 'utf8');

    // IDs and rating
    assert.ok(src.includes("'curated_1'"));
    assert.ok(src.includes("'curated_2'"));
    assert.ok(src.includes("'curated_3'"));

    // Verify imported array
    assert.equal(Array.isArray(DEFAULT_CURATED_REVIEWS), true);
    assert.equal(DEFAULT_CURATED_REVIEWS.length, 3);
    assert.deepEqual(DEFAULT_CURATED_REVIEWS.map(r => r.id), ['curated_1', 'curated_2', 'curated_3']);
    assert.ok(DEFAULT_CURATED_REVIEWS.every(r => r.rating === 5 && r.verifiedBuyer === true));

    // Pinned strings from review-engine.test.mjs and social-proof.test.mjs
    assert.ok(src.includes('Great Quality'));
    assert.ok(src.includes('Your review is saved. Thank you.'));
    assert.ok(src.includes('This review link is not valid'));

    // Test renderReviewPortalHtml with storeDomain
    const portalHtml = renderReviewPortalHtml({
      orderId: 'ord_123',
      email: 'test@example.com',
      token: 't_abc',
      storeName: 'Aura Glow Skincare',
      storeDomain: 'aura-skincare.com',
      verified: true
    });
    assert.match(portalHtml, /href="https:\/\/aura-skincare\.com" class="jv-shop-link"/);

    // Skincare-specific strings absent in DEFAULT_CURATED_REVIEWS
    for (const rev of DEFAULT_CURATED_REVIEWS) {
      assert.doesNotMatch(rev.reviewTitle + ' ' + rev.reviewText, /Glowing Results|ritual|your skin|luminous/i);
    }
  });

  it('server/assistantTraining.mjs strictly preserves frozen BUSINESS_TYPES', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server/assistantTraining.mjs'), 'utf8');
    assert.ok(
      src.includes("export const BUSINESS_TYPES = Object.freeze(['E-Commerce Store']);"),
      'BUSINESS_TYPES is preserved verbatim for assistant-training.test.mjs:571'
    );
    assert.ok(src.includes('export const UNIVERSAL_BUSINESS_CATEGORIES = Object.freeze(['), 'exports universal categories');
    assert.ok(src.includes('export const ALL_BUSINESS_TYPES = Object.freeze(['), 'exports all business types');
  });
});

// ============================================================================
// Section 5: Universal Dash Invariant & Typography Standards
// ============================================================================
describe('Empirical Challenge: Universal Typography and Invariant Standards', () => {
  const touchedFiles = [
    'src/data/ecomBlueprints.ts',
    'src/components/modals/WelcomeTourModal.tsx',
    'src/components/drawers/StepDock.tsx',
    'server/reviewEngine.mjs',
    'server/assistantTraining.mjs',
    'src/lib/pageThemes.ts',
    'src/types/journey.ts',
    'src/lib/funnelAuditor.ts',
    'src/components/drawers/PreFlightAuditDrawer.tsx',
    'src/components/preview/LiveFunnelModal.tsx',
    'src/components/toolbar/CanvasHeader.tsx',
    'src/components/modals/AiJourneyBuilder.tsx',
    'src/components/modals/BlueprintModal.tsx',
    'src/App.tsx',
    'src/components/drawers/PageEditor.tsx',
    'server/routes/publicRoutes.mjs',
    'server/routes/aiAssistantRoutes.mjs'
  ];

  it('zero em dashes (\\u2014) and zero spaced en dashes ( \\u2013 ) across all touched files', () => {
    for (const rel of touchedFiles) {
      const fullPath = path.join(ROOT, rel);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');

      const emDashes = content.match(/\u2014/g) || [];
      const spacedEnDashes = content.match(/ \u2013 /g) || [];

      assert.equal(
        emDashes.length,
        0,
        `Forbidden em dash found in ${rel}: count=${emDashes.length}`
      );
      assert.equal(
        spacedEnDashes.length,
        0,
        `Forbidden spaced en dash found in ${rel}: count=${spacedEnDashes.length}`
      );
    }
  });

  it('minimum font size >= 11px across touched UI components', () => {
    const uiFiles = [
      'src/components/modals/WelcomeTourModal.tsx',
      'src/components/drawers/StepDock.tsx',
      'src/components/drawers/PreFlightAuditDrawer.tsx',
      'src/components/preview/LiveFunnelModal.tsx',
      'src/components/toolbar/CanvasHeader.tsx',
      'src/components/modals/AiJourneyBuilder.tsx',
      'src/components/modals/BlueprintModal.tsx'
    ];

    for (const rel of uiFiles) {
      const fullPath = path.join(ROOT, rel);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check for inline fontSize less than 11px
      const smallFontMatch = content.match(/fontSize:\s*['"]?([0-9]|10)px['"]?/g);
      assert.equal(
        smallFontMatch,
        null,
        `Font size smaller than 11px found in ${rel}: ${JSON.stringify(smallFontMatch)}`
      );

      // Check for Tailwind sub-11px font sizes
      const tailwindSmallMatch = content.match(/text-\[(8|9|10)px\]/g);
      assert.equal(
        tailwindSmallMatch,
        null,
        `Tailwind font size smaller than 11px found in ${rel}: ${JSON.stringify(tailwindSmallMatch)}`
      );
    }
  });
});
