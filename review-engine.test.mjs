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

  it('5. Submits customer review, triggers smart-exit from drip, tags CRM, and returns $10 reward', () => {
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
    assert.equal(result.reward.code, 'REVIEW10');
    assert.equal(result.reward.value, '$10.00 Off');

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
    assert.ok(html.includes('Glowing Results'), 'Should include attribute tags');
    assert.ok(html.includes('/api/public/review'), 'Should post to public review API');
  });

  it('7. Ensures core Shopify discounts includes $10 REVIEW10 fixed amount code', async () => {
    let mockDiscounts = [];
    const mockCtx = {
      realStoreDomain: () => '',
      adminToken: () => '',
      loadDiscounts: () => mockDiscounts,
      saveDiscounts: (d) => { mockDiscounts = [...d]; }
    };

    const mockWs = { id: 'ws_test', shopifyConfig: {} };
    const provisioned = await ensureShopifyCoreDiscounts(mockWs, false, mockCtx);

    const reviewDiscount = mockDiscounts.find(d => d.code === 'REVIEW10');
    assert.ok(reviewDiscount, 'REVIEW10 code should be provisioned in discounts');
    assert.equal(reviewDiscount.discountType, 'fixed_amount', 'Should be fixed_amount discount');
    assert.equal(reviewDiscount.value, 10, 'Should be $10 value');
    assert.equal(reviewDiscount.oncePerCustomer, true, 'Should be once per customer');
  });
});
