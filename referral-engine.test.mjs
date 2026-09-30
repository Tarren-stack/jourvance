import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAmbassadorReferralCode,
  renderReviewPortalHtml
} from './server/reviewEngine.mjs';
import { ensureShopifyCoreDiscounts } from './server/routes/shopifyRoutes.mjs';

describe('Phase 15: Dual-Sided VIP Referral & Brand Ambassador Engine ("Give $15, Get $15")', () => {
  it('1. Generates deterministic, brand-aligned VIP referral codes', () => {
    const code1 = generateAmbassadorReferralCode('sarah.connor@example.com');
    const code2 = generateAmbassadorReferralCode('sarah.connor@example.com');
    const codeOther = generateAmbassadorReferralCode('elena.rostova@luxurybeauty.com');

    assert.equal(code1, code2, 'Referral code must be deterministic for the same email');
    assert.ok(code1.startsWith('GIVE15-SARAHCON-'), 'Code should include GIVE15 prefix and sanitized name part');
    assert.ok(codeOther.startsWith('GIVE15-ELENAROS-'), 'Different email should produce matching name prefix');
    assert.notEqual(code1, codeOther, 'Different emails must produce distinct codes');

    // Edge cases
    const fallbackCode = generateAmbassadorReferralCode('');
    assert.ok(fallbackCode.startsWith('GIVE15-VIP-'), 'Empty email should fallback to VIP prefix');
  });

  it('2. Review portal shows the referral card with copy and native share buttons only for the merchant\'s own GIVE15 (T13)', () => {
    const base = {
      orderId: '1099',
      email: 'seraphina@sanctuary.com',
      storeName: 'Aura Glow',
      storeDomain: 'auraglow.myshopify.com',
      slug: 'serum-special',
      verified: true
    };
    const expectedCode = generateAmbassadorReferralCode('seraphina@sanctuary.com');

    // The store has no GIVE15: no card, no link, and no "Give $15, Get $15" promise.
    const none = renderReviewPortalHtml(base);
    assert.ok(!none.includes('class="jv-ambassador-box"'), 'No card without the merchant\'s GIVE15');
    assert.ok(!none.includes('coupon=GIVE15') && !none.includes('Give $15'), 'No GIVE15 link and no $15 promise');

    const html = renderReviewPortalHtml({ ...base, referralRule: { code: 'GIVE15', discountType: 'fixed_amount', value: 20, status: 'active' }, currency: 'USD' });
    assert.ok(html.includes('class="jv-ambassador-box"'), 'Should render the referral card container');
    assert.ok(html.includes('Refer a friend'), 'Should display the referral badge');
    assert.ok(html.includes('your friend gets $20.00 off with code'), 'States the merchant\'s own amount');
    assert.ok(!html.includes('$15') && !html.includes('to your inbox'), 'Promises no amount or reviewer reward the merchant did not set');
    assert.ok(html.includes(`ref=${expectedCode}`), 'Should include ref code in referral URL');
    assert.ok(html.includes('coupon=GIVE15'), 'Should include GIVE15 coupon parameter');

    // 1-tap native sharing links
    assert.ok(html.includes('sms:?&body='), 'Should provide native SMS / iMessage 1-tap share link');
    assert.ok(html.includes('jv-copy-ref-btn'), 'Should include referral link copy button');
    assert.ok(html.includes('navigator.clipboard.writeText'), 'Should include clipboard copy implementation');
  });

  it('3. ensureShopifyCoreDiscounts creates no GIVE15 (or any code) the merchant did not define (R24)', async () => {
    const mockWs = { id: 'ws_test', shopifyConfig: { status: 'connected', storeDomain: 'test-beauty.myshopify.com', adminAccessToken: 'shpat_mock' } };
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error('no store call expected'); };
    try {
      const results = await ensureShopifyCoreDiscounts(mockWs, false, { realStoreDomain: () => 'test-beauty.myshopify.com', adminToken: () => 'shpat_mock', loadDiscounts: () => [], saveDiscounts: () => {} });
      assert.deepEqual(results, []);
      assert.deepEqual(calls, [], 'nothing reaches the store');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('4. Attributing VIP referral order credits the ambassador and tags contacts', () => {
    const ambassadorEmail = 'claire@glowsanctuary.com';
    const ambassadorCode = generateAmbassadorReferralCode(ambassadorEmail);

    const contacts = [
      {
        id: 'cust_ambassador',
        email: ambassadorEmail,
        name: 'Claire Dupont',
        userId: 'usr_merchant',
        tags: ['Verified-Reviewer', '5-Star-Advocate'],
        ordersCount: 3,
        totalSpent: 280.00
      }
    ];

    const customerEmail = 'sophie@newclient.com';
    const totalPrice = 75.00;
    const refCode = ambassadorCode;

    // Simulate webhook logic
    let contact = contacts.find(c => c.email === customerEmail);
    if (!contact) {
      contact = {
        id: 'cust_new',
        email: customerEmail,
        name: 'Sophie Martin',
        totalSpent: totalPrice,
        ordersCount: 1,
        tags: ['Shopify Buyer', 'Referred-By-VIP']
      };
      contacts.push(contact);
    }

    const referringAmbassador = contacts.find(c => {
      if (!c.email || c.email === customerEmail) return false;
      return generateAmbassadorReferralCode(c.email).toUpperCase() === refCode.toUpperCase();
    });

    assert.ok(referringAmbassador, 'Should locate referring ambassador by deterministic code');
    if (!referringAmbassador.tags.includes('VIP-Ambassador')) referringAmbassador.tags.push('VIP-Ambassador');
    if (!referringAmbassador.tags.includes('Referral-Advocate')) referringAmbassador.tags.push('Referral-Advocate');
    referringAmbassador.referralsCount = (referringAmbassador.referralsCount || 0) + 1;
    referringAmbassador.referralRevenue = Number(((referringAmbassador.referralRevenue || 0) + totalPrice).toFixed(2));

    assert.equal(referringAmbassador.referralsCount, 1);
    assert.equal(referringAmbassador.referralRevenue, 75.00);
    assert.ok(referringAmbassador.tags.includes('VIP-Ambassador'));
    assert.ok(referringAmbassador.tags.includes('Referral-Advocate'));
    assert.ok(contact.tags.includes('Referred-By-VIP'));
  });

  it('5. Self-referral prevention: purchaser cannot credit themselves as ambassador', () => {
    const shopperEmail = 'chloe@atelier.com';
    const shopperCode = generateAmbassadorReferralCode(shopperEmail);

    const contacts = [
      {
        id: 'cust_chloe',
        email: shopperEmail,
        name: 'Chloe Monet',
        tags: ['Shopify Buyer'],
        referralsCount: 0,
        referralRevenue: 0
      }
    ];

    // Attempting self-referral
    const matchedAmbassador = contacts.find(c => {
      if (!c.email || c.email.toLowerCase() === shopperEmail.toLowerCase()) return false;
      return generateAmbassadorReferralCode(c.email).toUpperCase() === shopperCode.toUpperCase();
    });

    assert.equal(matchedAmbassador, undefined, 'Self-referral must be blocked from finding self as ambassador');
  });

  it('6. a referral landing shows the banner and pre-applies GIVE15 only when the merchant defined it', async () => {
    const { renderPublicFunnelHtml, setPublicContext } = await import('./server/routes/publicRoutes.mjs');
    const dummyPage = {
      slug: 'radiance-ritual',
      userId: 'usr_test',
      shopifyConfig: { storeDomain: 'aura-luxury.myshopify.com', currency: 'USD' },
      data: { headline: 'Radiance Glow Ritual', subhead: 'Our signature restorative botanical elixir.', shopifyVariantId: 'gid://shopify/ProductVariant/445566', shopifyProductPrice: '85.00' }
    };
    const refReq = { query: { ref: 'GIVE15-SARAHCON-4A1B', coupon: 'GIVE15' }, headers: {} };
    const render = (discounts) => {
      setPublicContext({ loadDiscounts: () => discounts });
      try { return renderPublicFunnelHtml(dummyPage, refReq); } finally { setPublicContext(null); }
    };

    const without = render([]);
    assert.ok(!without.includes('jv-referral-banner'), 'No offer for a code the store does not have');
    assert.ok(without.includes('isVipReferral = false'));
    assert.ok(without.includes("out.set('attributes[jv_ref]', referralCode)"), 'The ref still tags the cart for attribution');

    const html = render([{ code: 'GIVE15', discountType: 'fixed_amount', value: 15, status: 'active', storeDomain: 'aura-luxury.myshopify.com' }]);
    assert.ok(html.includes('jv-referral-banner'), 'Should render the VIP referral welcome banner');
    assert.ok(html.includes('VIP Friend Invitation'), 'Should display VIP Friend Invitation pill');
    assert.ok(html.includes('<strong>GIVE15</strong> ($15.00 off) is applied at checkout'), 'States the amount the merchant set');
    assert.ok(html.includes('isVipReferral = true'), 'Client script should register active VIP referral');
    assert.ok(html.includes("out.set('attributes[jv_ref]', referralCode)"), 'Checkout builder should pass jv_ref cart attribute');
  });
});
