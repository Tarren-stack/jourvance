import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateReviewToken,
  verifyReviewToken,
  loadReviews,
  saveReview,
  submitCustomerReview,
  renderReviewPortalHtml
} from './server/reviewEngine.mjs';
import { ensureShopifyCoreDiscounts } from './server/routes/shopifyRoutes.mjs';

describe('Review & Social Proof UGC Engine (Phase 12)', () => {
  const testOrderId = '789102';
  const testEmail = 'emily.skincare@example.com';
  const testSecret = 'test_secret_key_123';

  it('1. Generates deterministic, order-bound cryptographic tokens', () => {
    const token1 = generateReviewToken(testOrderId, testEmail, testSecret);
    const token2 = generateReviewToken(testOrderId, testEmail, testSecret);
    assert.ok(token1, 'Token should not be empty');
    assert.equal(token1.length, 24, 'Token should be 24 hex characters');
    assert.equal(token1, token2, 'Identical inputs must yield identical tokens');
  });

  it('2. Verifies matching tokens accurately and timing-safely', () => {
    const token = generateReviewToken(testOrderId, testEmail, testSecret);
    const valid = verifyReviewToken(testOrderId, testEmail, token, testSecret);
    assert.equal(valid, true, 'Verification should succeed for genuine token');
  });

  it('3. Rejects tampered tokens, mismatched emails, or invalid orders', () => {
    const validToken = generateReviewToken(testOrderId, testEmail, testSecret);
    
    // Tampered token
    const tampered = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');
    assert.equal(verifyReviewToken(testOrderId, testEmail, tampered, testSecret), false);

    // Mismatched email
    assert.equal(verifyReviewToken(testOrderId, 'other@example.com', validToken, testSecret), false);

    // Mismatched order ID
    assert.equal(verifyReviewToken('999999', testEmail, validToken, testSecret), false);

    // Empty parameters
    assert.equal(verifyReviewToken('', testEmail, validToken, testSecret), false);
    assert.equal(verifyReviewToken(testOrderId, '', validToken, testSecret), false);
    assert.equal(verifyReviewToken(testOrderId, testEmail, '', testSecret), false);
  });

  it('4. Correctly saves and loads reviews in storage', () => {
    const storageMap = new Map();
    const mockHubStorage = {
      get: (space, key, def) => storageMap.get(`${space}:${key}`) || def,
      set: (space, key, val) => storageMap.set(`${space}:${key}`, val)
    };

    const initial = loadReviews(mockHubStorage);
    assert.deepEqual(initial, []);

    const review = {
      id: 'rev_1',
      orderId: testOrderId,
      customerEmail: testEmail,
      rating: 5,
      reviewTitle: 'Glowing and smooth',
      reviewText: 'My skin tone evened out in under two weeks.'
    };
    saveReview(review, mockHubStorage);

    const loaded = loadReviews(mockHubStorage);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].reviewTitle, 'Glowing and smooth');
  });

  it('5. Submits customer review, triggers smart-exit from drip, tags CRM, and returns the merchant\'s own code', () => {
    const storageMap = new Map();
    const mockHubStorage = {
      get: (space, key, def) => storageMap.get(`${space}:${key}`) || def,
      set: (space, key, val) => storageMap.set(`${space}:${key}`, val)
    };

    // Mock drips data
    let dripsState = {
      sequences: [
        { id: 'drip_seq_review_request', activeEnrollments: 1, totalCompleted: 0 }
      ],
      enrollments: [
        {
          id: 'enr_1',
          sequenceId: 'drip_seq_review_request',
          customerEmail: testEmail,
          status: 'active',
          orderId: testOrderId
        }
      ]
    };

    // Mock CRM contacts
    let contactsState = [
      {
        id: 'c_1',
        email: testEmail,
        name: 'Emily S.',
        tags: ['Customer']
      }
    ];

    const result = submitCustomerReview({
      orderId: testOrderId,
      customerEmail: testEmail,
      customerName: 'Emily S.',
      rating: 5,
      reviewTitle: 'Pure magic in a bottle',
      reviewText: 'Silky texture, absorbs instantly, zero irritation.',
      tags: ['Glowing Results', 'Luxury Texture'],
      storeDomain: 'aura-beauty.myshopify.com',
      discountCode: 'REVIEW10',
      hubStorage: mockHubStorage,
      loadDrips: () => dripsState,
      saveDrips: (next) => { dripsState = next; },
      loadContacts: () => contactsState,
      saveContacts: (next) => { contactsState = next; }
    });

    assert.equal(result.success, true);
    // The merchant's own code, with no invented "$10 off" value or notice (R24).
    assert.deepEqual(result.reward, { code: 'REVIEW10' });

    // Verify smart-exit from review drip
    assert.equal(dripsState.enrollments[0].status, 'reviewed_exit');
    assert.ok(dripsState.enrollments[0].reviewedAt);
    assert.equal(dripsState.sequences[0].activeEnrollments, 0);
    assert.equal(dripsState.sequences[0].totalCompleted, 1);

    // Verify CRM tagging
    const contact = contactsState[0];
    assert.ok(contact.tags.includes('Verified-Reviewer'), 'Should have Verified-Reviewer tag');
    assert.ok(contact.tags.includes('5-Star-Advocate'), 'Should have 5-Star-Advocate tag');
    assert.ok(contact.lastReviewedAt);
  });

  it('6. Renders luxury mobile-friendly Review Portal HTML with order context and discount reveal', () => {
    const html = renderReviewPortalHtml({
      orderId: testOrderId,
      email: testEmail,
      token: 'mock_token',
      storeName: 'Aura Glow Skincare',
      storeDomain: 'aura-skincare.com',
      verified: true,
      discountCode: 'REVIEW10'
    });

    assert.ok(html.includes('Aura Glow Skincare'), 'Should include store name');
    assert.ok(html.includes(testOrderId), 'Should include order number');
    assert.ok(html.includes('REVIEW10'), 'Should include discount code');
    assert.ok(html.includes('jv-stars-container'), 'Should include interactive star container');
    // Tags any store's buyer could pick, none chosen for them, and no product category assumed (T13).
    assert.ok(html.includes('data-tag="Great Quality"'), 'Should include attribute tags');
    assert.ok(!html.includes('jv-tag-chip selected'), 'No tag is pre-selected on the reviewer\'s behalf');
    assert.ok(!/Glowing Results|ritual|your skin|luminous/i.test(html), 'Assumes no product category');
    assert.ok(html.includes('/api/public/review'), 'Should post to public review API');
  });

  it('7. Provisions no REVIEW10 or any other code the merchant did not define (R24)', async () => {
    let mockDiscounts = [];
    const mockCtx = {
      realStoreDomain: () => '',
      adminToken: () => '',
      loadDiscounts: () => mockDiscounts,
      saveDiscounts: (d) => { mockDiscounts = [...d]; }
    };

    const mockWs = { id: 'ws_test', shopifyConfig: {} };
    const provisioned = await ensureShopifyCoreDiscounts(mockWs, false, mockCtx);

    assert.deepEqual(provisioned, [], 'nothing is provisioned on the merchant\'s behalf');
    assert.deepEqual(mockDiscounts, [], 'no REVIEW10 or other code is saved');
  });
  it('8. With no key, a token is never signed and never accepted (R24)', () => {
    assert.equal(generateReviewToken(testOrderId, testEmail), '');
    assert.equal(generateReviewToken(testOrderId, testEmail, ''), '');
    const sourceKeyToken = generateReviewToken(testOrderId, testEmail, 'jourvance_review_sig_2026');
    assert.equal(verifyReviewToken(testOrderId, testEmail, sourceKeyToken), false);
    assert.equal(verifyReviewToken(testOrderId, testEmail, sourceKeyToken, ''), false);
  });

  it('9. A missing rating is refused, not saved as five stars (R24)', () => {
    const rows = [];
    const store = { get: () => rows, set: (_k, _f, v) => { rows.splice(0, rows.length, ...v); } };
    const result = submitCustomerReview({ orderId: '1', customerEmail: 'a@b.test', hubStorage: store });
    assert.equal(result.success, false);
    assert.deepEqual(rows, []);
    const noCode = submitCustomerReview({ orderId: '2', customerEmail: 'a@b.test', rating: 3, hubStorage: store });
    assert.equal(noCode.reward, null);
    assert.equal(noCode.review.discountCodeAwarded, '');
  });

  it('10. The portal offers no invented reward and refuses a link that did not verify (R24)', () => {
    const base = { orderId: testOrderId, email: testEmail, token: 't', storeName: 'Aura Glow Skincare', storeDomain: 'aura-skincare.com' };
    const noCode = renderReviewPortalHtml({ ...base, verified: true });
    assert.doesNotMatch(noCode, /\$10|REVIEW10|Treat/);
    assert.doesNotMatch(noCode, /jv-code-box">/);
    assert.match(noCode, /Your review is saved\. Thank you\./);
    assert.match(noCode, /href="https:\/\/aura-skincare\.com" class="jv-shop-link"/);

    const withCode = renderReviewPortalHtml({ ...base, verified: true, discountCode: 'THANKS5' });
    assert.match(withCode, /id="jv-revealed-code">THANKS5</);
    assert.match(withCode, /\?discount=THANKS5/);

    const invalid = renderReviewPortalHtml({ ...base, orderId: '1"><img src=x>', verified: false });
    assert.match(invalid, /This review link is not valid/);
    assert.doesNotMatch(invalid, /jv-review-form|<script|<img src=x>/);
  });
});
