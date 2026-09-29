import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPublicFunnelHtml } from './server/routes/publicRoutes.mjs';

describe('Phase 16: Visual Exit-Intent VIP Lead Magnet & Gift Drawer', () => {
  const basePage = {
    slug: 'radiance-elixir',
    userId: 'usr_test',
    shopifyConfig: { storeDomain: 'aura-luxury.myshopify.com' },
    data: {
      headline: 'Radiance Glow Elixir',
      subhead: 'Our signature restorative botanical ritual.',
      shopifyVariantId: 'gid://shopify/ProductVariant/556677',
      shopifyProductPrice: '88.00',
      exitIntentEnabled: true,
      exitIntentBadge: 'Private Courtesy · VIP Access',
      exitIntentHeadline: 'Before You Go: Save Your 15% VIP Formulation Voucher',
      exitIntentSubhead: 'Reserve your private batch discount code now before this allocation concludes.',
      exitIntentDiscountCode: 'SAVE15',
      exitIntentButtonText: 'Claim VIP Gift & Continue'
    }
  };

  it('1. Renders mobile-first bottom slide-up drawer with luxury frosted glass and grab handle', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });

    // Drawer container & accessibility
    assert.ok(html.includes('id="jv-exit-drawer"'), 'Must render #jv-exit-drawer element');
    assert.ok(html.includes('id="jv-exit-backdrop"'), 'Must render backdrop overlay');
    assert.ok(html.includes('role="dialog"'), 'Must include ARIA dialog role');
    assert.ok(html.includes('aria-modal="true"'), 'Must specify aria-modal');

    // Bottom docking & styling
    assert.ok(html.includes('position:fixed; bottom:0'), 'Must be anchored at bottom of screen');
    assert.ok(html.includes('id="jv-exit-drag-handle"'), 'Must include top grab handle for tactile mobile feel');
    assert.ok(html.includes('translateY(100%)'), 'Must start hidden below viewport for smooth slide-up entrance');

    // Custom copy & absence of cheesy emojis
    assert.ok(html.includes('Private Courtesy · VIP Access'), 'Must render refined rescue badge');
    assert.ok(!html.includes('<span>✨</span>'), 'Must eliminate generic cheesy emojis');
    assert.ok(html.includes('Before You Go: Save Your 15% VIP Formulation Voucher'), 'Must render headline');
    assert.ok(html.includes('Claim VIP Gift &amp; Continue') || html.includes('Claim VIP Gift & Continue'), 'Must render button action text');
    assert.ok(html.includes('autocomplete="email"'), 'Must enable browser email autofill');
  });

  it('2. Suppresses exit-intent drawer markup when exitIntentEnabled is false', () => {
    const disabledPage = {
      ...basePage,
      data: {
        ...basePage.data,
        exitIntentEnabled: false
      }
    };
    const html = renderPublicFunnelHtml(disabledPage, { query: {}, headers: {} });

    assert.ok(!html.includes('id="jv-exit-drawer"'), 'Must not render drawer markup when disabled');
    assert.ok(!html.includes('id="jv-exit-backdrop"'), 'Must not render backdrop when disabled');
  });

  it('3. Injects Option 1 Rapid Up-Scroll and 14-second Inactivity Fallback script triggers', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });

    // Script initialization
    assert.ok(html.includes('setupExitIntentDrawer'), 'Must initialize setupExitIntentDrawer function');
    assert.ok(html.includes('sessionStorage.getItem(exitDismissedKey)'), 'Must check sessionStorage frequency cap');

    // Option 1 Rapid Up-Scroll
    assert.ok(html.includes('dy < -45 && dt < 120'), 'Must detect rapid upward scroll flick (<120ms, >=45px)');
    assert.ok(html.includes('maxScrollDepth > 0.20'), 'Must verify visitor scrolled at least 20% down page before triggering on up-scroll');

    // Option 1 14-second Inactivity Fallback
    assert.ok(html.includes('14000'), 'Must configure 14-second inactivity fallback timer');
    assert.ok(html.includes('window.scrollY > 150'), 'Inactivity timer must activate only after scrolling past hero');

    // Desktop cursor exit trigger
    assert.ok(html.includes('e.clientY <= 0'), 'Must retain desktop cursor velocity trigger');

    // Keyboard accessibility
    assert.ok(html.includes("e.key === 'Escape'"), 'Must support closing via Escape key');
  });

  it('4. Successfully reveals discount code and generates pre-applied checkout redirect', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });

    assert.ok(html.includes('id="jv-exit-success-state"'), 'Must include success state card');
    assert.ok(html.includes('VIP Courtesy Code Activated'), 'Must display activation title');
    assert.ok(html.includes('id="jv-exit-continue-btn"'), 'Must include continue to checkout button');
    assert.ok(html.includes('exit_intent: true'), 'Must post exit_intent flag to lead API');
  });
});
