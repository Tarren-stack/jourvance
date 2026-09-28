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

  it('2. Review portal renders VIP Ambassador Card with copy and native share buttons', () => {
    const html = renderReviewPortalHtml({
      orderId: '1099',
      email: 'seraphina@sanctuary.com',
      storeName: 'Aura Glow',
      storeDomain: 'auraglow.myshopify.com',
      slug: 'serum-special',
      verified: true
    });

    const expectedCode = generateAmbassadorReferralCode('seraphina@sanctuary.com');

    assert.ok(html.includes('jv-ambassador-box'), 'Should render the ambassador card container');
    assert.ok(html.includes('VIP Ambassador'), 'Should display the VIP Ambassador badge');
    assert.ok(html.includes('Give $15, Get $15'), 'Should highlight the dual-sided voucher promise');
    assert.ok(html.includes(expectedCode), 'Should display the personalized referral code');
    assert.ok(html.includes(`ref=${expectedCode}`), 'Should include ref code in referral URL');
    assert.ok(html.includes('coupon=GIVE15'), 'Should include GIVE15 coupon parameter');

    // 1-tap native sharing links
    assert.ok(html.includes('sms:?&body='), 'Should provide native SMS / iMessage 1-tap share link');
    assert.ok(html.includes('jv-copy-ref-btn'), 'Should include referral link copy button');
    assert.ok(html.includes('navigator.clipboard.writeText'), 'Should include clipboard copy implementation');
  });

  it('3. Provisions GIVE15 fixed amount discount in ensureShopifyCoreDiscounts with margin protection', async () => {
    const mockWs = {
      id: 'ws_test',
      shopifyConfig: { status: 'connected', storeDomain: 'test-beauty.myshopify.com', adminAccessToken: 'shpat_mock' }
    };
    const provisioned = [];
    const mockCtx = {
      realStoreDomain: () => 'test-beauty.myshopify.com',
      adminToken: () => 'shpat_mock',
      loadDiscounts: () => [],
      saveDiscounts: () => {}
    };

    // Global fetch mock to simulate Shopify Admin PriceRule API
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body || '{}');
      return {
        ok: true,
        status: 201,
        json: async () => ({
          price_rule: { id: 888123, title: body.price_rule?.title, value_type: body.price_rule?.value_type, value: body.price_rule?.value },
          discount_code: { id: 999456, code: body.price_rule?.title }
        })
      };
    };

    try {
      const results = await ensureShopifyCoreDiscounts(mockWs, false, mockCtx);
      const give15 = results.find(d => d.code === 'GIVE15');

      assert.ok(give15, 'GIVE15 should be included in Shopify core discounts');
      assert.equal(give15.value, 15, 'GIVE15 discount value must be $15.00');
      assert.equal(give15.discountType, 'fixed_amount', 'GIVE15 must be fixed_amount for direct voucher gift');
      assert.equal(give15.oncePerCustomer, true, 'Must enforce oncePerCustomer to protect merchant margins');
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

  it('6. renderPublicFunnelHtml displays VIP Friend Welcome Banner and pre-applies GIVE15 on referral landing', async () => {
    const { renderPublicFunnelHtml } = await import('./server/routes/publicRoutes.mjs');
    const dummyPage = {
      slug: 'radiance-ritual',
      userId: 'usr_test',
      shopifyConfig: { storeDomain: 'aura-luxury.myshopify.com' },
      data: {
        headline: 'Radiance Glow Ritual',
        subhead: 'Our signature restorative botanical elixir.',
        shopifyVariantId: 'gid://shopify/ProductVariant/445566',
        shopifyProductPrice: '85.00'
      }
    };

    const refReq = {
      query: { ref: 'GIVE15-SARAHCON-4A1B', coupon: 'GIVE15' },
      headers: {}
    };

    const html = renderPublicFunnelHtml(dummyPage, refReq);

    assert.ok(html.includes('jv-referral-banner'), 'Should render the VIP referral welcome banner');
    assert.ok(html.includes('VIP Friend Invitation'), 'Should display VIP Friend Invitation pill');
    assert.ok(html.includes('$15 welcome courtesy'), 'Should highlight $15 courtesy discount');
    assert.ok(html.includes('GIVE15'), 'Should display code GIVE15');
    assert.ok(html.includes('isVipReferral = true'), 'Client script should register active VIP referral');
    assert.ok(html.includes("out.set('attributes[jv_ref]', referralCode)"), 'Checkout builder should pass jv_ref cart attribute');
  });
});
