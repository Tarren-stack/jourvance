// The proof that a page WITHOUT a `builder` field renders exactly as it did before the landing
// page builder existed (LANDING_BUILDER_PLAN.md, wave 1b). Each fixture below is rendered by the
// real renderers and the output is compared byte for byte with a golden file committed under
// test-fixtures/legacy-pages/. The goldens were written from the renderer BEFORE any wave 1b
// change. A later wave that alters one byte of a legacy page fails here and must say why.
//
// Normalisation: NONE. The renderers were run twice per fixture and gave identical bytes (the
// "renders the same twice" test keeps pinning that), so nothing needs masking. The only sources
// of randomness in the template are the A/B coin flip (every fixture names ?var= so it never
// flips) and Date.now() calls that live inside the browser script text, never evaluated here.
//
// To rewrite the goldens on purpose: UPDATE_LEGACY_SNAPSHOTS=1 node --test page-builder-legacy-snapshot.test.mjs
// then read the diff in git. A missing golden is a failure, not a write.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml,
  withTracking
} from './server/routes/publicRoutes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, 'test-fixtures', 'legacy-pages');
const UPDATE = process.env.UPDATE_LEGACY_SNAPSHOTS === '1';

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
  // The frame the route wraps a page in: tracking, signup snippet and the consent widget.
  ['landing-with-tracking', () => withTracking(
    renderPublicFunnelHtml({ slug: 'full', userId: 'u1', data: fullLanding, shopifyConfig: shop }, req({ var: 'a' }), null),
    'full', 'a', true, { productId: 'gid://shopify/Product/9', price: '48.00' }, {})]
];

describe('legacy pages render byte for byte as before the builder', () => {
  if (UPDATE) fs.mkdirSync(DIR, { recursive: true });
  for (const [name, render] of FIXTURES) {
    it(`${name} matches its golden file`, () => {
      const html = render();
      assert.equal(typeof html, 'string');
      assert.ok(html.length > 500, 'the renderer produced a page');
      const file = path.join(DIR, `${name}.html`);
      if (UPDATE) fs.writeFileSync(file, html);
      assert.ok(fs.existsSync(file), `golden file missing: ${file}`);
      const golden = fs.readFileSync(file, 'utf8');
      if (html !== golden) {
        let i = 0;
        while (i < html.length && html[i] === golden[i]) i += 1;
        assert.fail(`${name} differs from its golden at byte ${i}: now ${JSON.stringify(html.slice(i, i + 120))} was ${JSON.stringify(golden.slice(i, i + 120))}`);
      }
    });
  }

  it('renders the same twice, so no normalisation is needed', () => {
    for (const [name, render] of FIXTURES) assert.equal(render(), render(), name);
  });

  it('no fixture carries a builder field', () => {
    assert.equal('builder' in fullLanding, false);
  });
});
