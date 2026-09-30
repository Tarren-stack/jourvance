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
      exitIntentHeadline: 'Before you go, take your code with you',
      exitIntentSubhead: 'One email, and the code is yours.',
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
    assert.ok(html.includes('Before you go, take your code with you'), 'Must render headline');
    assert.ok(html.includes('aria-labelledby="jv-exit-title"'), 'The dialog is named by its headline');
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
    assert.ok(html.includes('id="jv-exit-code-block"'), 'Must include the code block');
    assert.match(html, /id="jv-exit-code-display"[^>]*>SAVE15</, 'Shows the code the user set');
    assert.ok(html.includes('var exitCode = "SAVE15";'), 'The script starts from the code the user set');
    assert.ok(html.includes('id="jv-exit-continue-btn"'), 'Must include continue to checkout button');
    assert.ok(html.includes('exit_intent: true'), 'Must post exit_intent flag to lead API');
  });

  // C21: the drawer used to publish a 15% voucher headline and the code GIVE15 that nobody set.
  const drawerOf = html => {
    const start = html.indexOf('<!-- Exit-Intent VIP Lead Magnet');
    if (start === -1) return '';
    const end = html.indexOf('<!-- Mobile Sticky Action Bar', start);
    return html.slice(start, end === -1 ? undefined : end);
  };

  it('5. Publishes no drawer while the headline is empty, and invents no offer or code', () => {
    const page = { ...basePage, data: { ...basePage.data, exitIntentHeadline: '  ', exitIntentBadge: '', exitIntentSubhead: '', exitIntentDiscountCode: '', exitIntentButtonText: '' } };
    const html = renderPublicFunnelHtml(page, { query: {}, headers: {} });
    assert.ok(!html.includes('id="jv-exit-drawer"'), 'No drawer without the user\'s own headline');
    assert.ok(!html.includes('15% VIP Formulation Voucher'), 'No invented 15% headline');
    assert.ok(!html.includes('GIVE15'), 'No invented code anywhere on the page');
  });

  it('6. With a headline and no code set anywhere, shows no code and invents no copy', () => {
    const page = { ...basePage, data: { ...basePage.data, exitIntentBadge: '', exitIntentSubhead: '', exitIntentDiscountCode: '', exitIntentButtonText: '' } };
    const html = renderPublicFunnelHtml(page, { query: {}, headers: {} });
    const drawer = drawerOf(html);
    assert.ok(drawer.includes('id="jv-exit-drawer"'), 'The drawer is published with its headline');
    assert.ok(!html.includes('GIVE15'), 'No invented code in the markup or the script');
    assert.ok(html.includes('var exitCode = "";'), 'The script starts with no code');
    assert.match(drawer, /id="jv-exit-code-display"[^>]*><\/div>/, 'The code slot is empty');
    assert.match(drawer, /id="jv-exit-code-block" style="display:none;/, 'The code block stays hidden until a real code exists');
    assert.ok(drawer.includes('Thanks, your email is saved.'), 'A plain saved state stands in for the code');
    for (const invented of ['Parting Courtesy', 'VIP Privilege', 'allocation concludes', 'Claim VIP Gift', 'VIP Courtesy Code Activated', 'No spam', '1-tap checkout']) {
      assert.ok(!drawer.includes(invented), `No invented copy: ${invented}`);
    }
    assert.match(drawer, /id="jv-exit-submit-btn"[^>]*>\s*Continue\s*</, 'A neutral button label');
  });

  it('7. Never shows the success state for an email the server did not save', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });
    const script = html.slice(html.indexOf('function setupExitIntentDrawer'), html.indexOf('<!-- Exit-Intent VIP Lead Magnet'));
    assert.ok(script.includes("if (!exitResp.ok || !exitData || exitData.success === false) throw new Error('Lead not saved');"), 'A refused or broken answer is a failure');
    const catchBody = script.slice(script.indexOf("console.error('Exit lead submission error:'"));
    const catchEnd = catchBody.indexOf('});');
    assert.ok(!catchBody.slice(0, catchEnd).includes("successState.style.display = 'block'"), 'The failure path does not claim success');
    assert.ok(catchBody.slice(0, catchEnd).includes("exitError.style.display = 'block'"), 'The failure path says so');
    assert.ok(html.includes('id="jv-exit-error" role="alert"'), 'The error is announced');
  });

  it('8. Wires the drawer once its markup exists, since the markup comes after the script', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });
    const setupAt = html.indexOf('function setupExitIntentDrawer');
    const markupAt = html.indexOf('id="jv-exit-drawer"');
    assert.ok(setupAt !== -1 && markupAt > setupAt, 'The drawer markup follows the script');
    // An immediately run setup found no drawer, returned early, and the drawer never opened.
    assert.ok(!html.includes('(function setupExitIntentDrawer()'), 'The setup is not run before the markup is parsed');
    assert.ok(html.includes("if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupExitIntentDrawer);"), 'The setup waits for the document');
  });

  it('9. Moves focus into the drawer, keeps Tab inside it, and announces a saved email', () => {
    const html = renderPublicFunnelHtml(basePage, { query: {}, headers: {} });
    const script = html.slice(html.indexOf('function setupExitIntentDrawer'), html.indexOf('<!-- Exit-Intent VIP Lead Magnet'));
    const show = script.slice(script.indexOf('function showExitDrawer'), script.indexOf('function closeExitDrawer'));
    assert.ok(show.includes('emailInput.focus('), 'Opening focuses the email field');
    assert.ok(script.includes("if (e.key !== 'Tab') return;"), 'Tab is kept inside the open dialog');
    assert.ok(script.includes('focusBeforeDrawer.focus('), 'Closing hands focus back');
    assert.ok(script.includes('continueBtn.focus('), 'After a save, focus moves to Continue');
    assert.ok(html.includes('id="jv-exit-status" role="status"'), 'A status line present from load announces the save');
    assert.ok(html.includes('aria-label="Email address"'), 'The email field has a name');
  });
});

// C21: the lead-gate modal promised 'Your Exclusive Discount' and a 'VIP coupon' on a page with no code.
describe('Lead-gate modal names a discount only when the page has a code', () => {
  const page = data => ({ slug: 'kit', userId: 'usr_test', shopifyConfig: { storeDomain: 'demo-shop.myshopify.com' }, data: { headline: 'H', checkoutMode: 'lead-gate', buttonText: '', shopifyVariantId: 'gid://shopify/ProductVariant/42', shopifyProductPrice: '10.00', ...data } });
  const modalOf = html => html.slice(html.indexOf('id="lead-modal"'), html.indexOf('</form>', html.indexOf('id="lead-form"')));
  const scriptOf = html => html.slice(html.indexOf('function setBumpState'), html.indexOf('function buildCheckoutUrl'));

  it('with no code, promises no discount, coupon, voucher or VIP access', () => {
    const html = renderPublicFunnelHtml(page({}), { query: {}, headers: {} });
    const text = modalOf(html).replace(/<[^>]+>/g, ' ');
    for (const re of [/discount/i, /coupon/i, /voucher/i, /VIP Access/, /exclusive/i]) assert.doesNotMatch(text, re);
    assert.match(text, /Continue to checkout/);
    assert.match(text, /Enter your email to go straight to checkout\./);
    assert.doesNotMatch(scriptOf(html), /Voucher/, 'The bump toggle labels promise no voucher');
    assert.ok(!html.includes('Securing Voucher'), 'The loading label promises no voucher');
    assert.ok(!html.includes('GIVE15'));
  });

  it('with a code, names that code', () => {
    const html = renderPublicFunnelHtml(page({ discountCode: 'WELCOME10' }), { query: {}, headers: {} });
    const modal = modalOf(html);
    assert.ok(modal.includes('Enter your email to claim your <strong>WELCOME10</strong> coupon and route straight to checkout.'));
    assert.ok(modal.includes('Claim Voucher & Checkout'));
  });
});
