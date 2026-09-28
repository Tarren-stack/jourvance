import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitCustomerReview,
  getPublicVerifiedReviews,
  toggleReviewVisibility,
  renderSocialProofWallHtml,
  DEFAULT_CURATED_REVIEWS
} from './server/reviewEngine.mjs';

describe('Live Verified UGC Social Proof Wall & Testimonial Injector (Phase 13 & 14)', () => {
  it('1. Provides high-converting default curated reviews when storage is empty', () => {
    const mockHub = {
      get: () => []
    };
    const result = getPublicVerifiedReviews({ hubStorage: mockHub });
    assert.ok(result.summary);
    assert.equal(result.summary.averageRating, 4.9);
    assert.ok(result.reviews.length >= 3, 'Should provide at least 3 curated beauty reviews');
    assert.equal(result.reviews[0].customerName, 'Elena V.');
    assert.ok(result.reviews[0].verifiedBuyer, 'Curated reviews should be verified');
  });

  it('2. Sanitizes customer names to First L. and completely hides email PII', () => {
    const storageData = [
      {
        id: 'rev_101',
        customerName: 'Victoria Beckham',
        customerEmail: 'v.beckham@luxury.com',
        rating: 5,
        reviewTitle: 'Exquisite formula',
        reviewText: 'My daily essential.',
        verifiedBuyer: true
      }
    ];
    const mockHub = {
      get: () => storageData
    };

    const result = getPublicVerifiedReviews({ hubStorage: mockHub });
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].customerName, 'Victoria B.');
    assert.equal(result.reviews[0].customerEmail, undefined, 'Customer email must never be exposed publicly');
  });

  it('3. Filters out reviews below minRating (e.g. 3-star and below excluded when minRating=4)', () => {
    const storageData = [
      { id: 'rev_1', rating: 5, reviewTitle: 'Loved it' },
      { id: 'rev_2', rating: 4, reviewTitle: 'Very good' },
      { id: 'rev_3', rating: 3, reviewTitle: 'Average' },
      { id: 'rev_4', rating: 2, reviewTitle: 'Not for me' }
    ];
    const mockHub = {
      get: () => storageData
    };

    const result4 = getPublicVerifiedReviews({ minRating: 4, hubStorage: mockHub });
    assert.equal(result4.reviews.length, 2);
    assert.ok(result4.reviews.every(r => r.rating >= 4));

    const result5 = getPublicVerifiedReviews({ minRating: 5, hubStorage: mockHub });
    assert.equal(result5.reviews.length, 1);
    assert.equal(result5.reviews[0].rating, 5);
  });

  it('4. Computes accurate average rating and count summaries', () => {
    const storageData = [
      { id: 'rev_1', rating: 5 },
      { id: 'rev_2', rating: 5 },
      { id: 'rev_3', rating: 4 }
    ];
    const mockHub = {
      get: () => storageData
    };

    const result = getPublicVerifiedReviews({ minRating: 4, hubStorage: mockHub });
    // (5 + 5 + 4) / 3 = 4.67 -> 4.7
    assert.equal(result.summary.averageRating, 4.7);
    assert.equal(result.summary.totalCount, 3);
  });

  it('5. toggleReviewVisibility hides review and excludes it from public wall', () => {
    let storageData = [
      { id: 'rev_good', rating: 5, reviewTitle: 'Great' },
      { id: 'rev_bad', rating: 5, reviewTitle: 'Private dispute', hidden: false }
    ];
    const mockHub = {
      get: () => storageData,
      set: (space, key, val) => { storageData = val; }
    };

    // Hide the review
    const toggled = toggleReviewVisibility('rev_bad', true, mockHub);
    assert.ok(toggled);
    assert.equal(toggled.hidden, true);

    // Fetch public reviews
    const result = getPublicVerifiedReviews({ hubStorage: mockHub });
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0].id, 'rev_good');
  });

  it('6. renderSocialProofWallHtml generates luxury responsive HTML with swipeable carousel and desktop grid', () => {
    const summary = { averageRating: 4.9, totalCount: 180 };
    const reviews = [
      {
        id: 'rev_test',
        customerName: 'Sarah K.',
        rating: 5,
        reviewTitle: 'Luminous Glow',
        reviewText: 'My skin looks and feels renewed every morning.',
        tags: ['Glowing Results']
      }
    ];

    const html = renderSocialProofWallHtml(summary, reviews, {
      title: 'Loved by Thousands of Radiant Routines'
    });

    assert.ok(html.includes('jv-ugc-wall'), 'Must include wall section');
    assert.ok(html.includes('Loved by Thousands of Radiant Routines'), 'Must include title');
    assert.ok(html.includes('4.9 / 5.0'), 'Must include average rating');
    assert.ok(html.includes('180+ Verified Client Reviews'), 'Must include count');
    assert.ok(html.includes('jv-ugc-cards-wrap'), 'Must include horizontal cards container');
    assert.ok(html.includes('scroll-snap-type: x mandatory'), 'Must include mobile scroll snap CSS');
    assert.ok(html.includes('grid-template-columns: repeat(3, 1fr)'), 'Must include desktop 3-column grid CSS');
    assert.ok(html.includes('Sarah K.'), 'Must include reviewer name');
    assert.ok(html.includes('Glowing Results'), 'Must include tag');
    assert.ok(html.includes('✓ Verified'), 'Must include verified badge');
  });

  it('7. submitCustomerReview validates, sanitizes, and stores up to 2 compressed photos', () => {
    let saved = null;
    const mockHub = {
      get: () => [],
      set: (space, key, val) => { saved = val; }
    };

    const validPhoto1 = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA';
    const validPhoto2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const extraPhoto3 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const result = {
      ...submitCustomerReview({
        orderId: 'ORD_991',
        customerEmail: 'alex@glow.com',
        customerName: 'Alex Rivers',
        rating: 5,
        reviewTitle: 'Stunning unboxing experience',
        reviewText: 'Before and after results speak for themselves.',
        photos: [validPhoto1, validPhoto2, extraPhoto3],
        hubStorage: mockHub
      })
    };

    assert.ok(result.success);
    assert.equal(result.review.photos.length, 2, 'Must clamp to maximum 2 photos');
    assert.equal(result.review.photos[0], validPhoto1);
    assert.equal(result.review.photos[1], validPhoto2);
    assert.equal(result.review.photoUrl, validPhoto1, 'photoUrl backward compatibility must point to first photo');
  });

  it('8. submitCustomerReview rejects oversized photo payloads and non-image strings', () => {
    let saved = null;
    const mockHub = {
      get: () => [],
      set: (space, key, val) => { saved = val; }
    };

    const oversizedPhoto = 'data:image/webp;base64,' + 'A'.repeat(360000);
    const nonImageScript = 'javascript:alert(1)';
    const validPhoto = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA';

    const result = submitCustomerReview({
      orderId: 'ORD_992',
      customerEmail: 'taylor@glow.com',
      photos: [oversizedPhoto, nonImageScript, validPhoto],
      hubStorage: mockHub
    });

    assert.ok(result.success);
    assert.equal(result.review.photos.length, 1, 'Only valid non-oversized image data URIs should be accepted');
    assert.equal(result.review.photos[0], validPhoto);
  });

  it('9. renderSocialProofWallHtml renders photo thumbnails and zero-dependency lightbox modal', () => {
    const summary = { averageRating: 5.0, totalCount: 42 };
    const reviews = [
      {
        id: 'rev_with_photo',
        customerName: 'Helena P.',
        rating: 5,
        reviewTitle: 'Visible difference in 7 days',
        reviewText: 'See attached texture shot.',
        photos: ['data:image/webp;base64,testphotodata']
      }
    ];

    const html = renderSocialProofWallHtml(summary, reviews, { photosEnabled: true });
    assert.ok(html.includes('jv-ugc-photos'), 'Must include thumbnail strip');
    assert.ok(html.includes('jv-ugc-photo-thumb'), 'Must include photo thumbnail card');
    assert.ok(html.includes('openJvLightbox'), 'Must include lightbox open handler');
    assert.ok(html.includes('jv-ugc-lightbox'), 'Must include lightbox modal container');
    assert.ok(html.includes('jv-lightbox-overlay'), 'Must include frosted glass lightbox overlay');
  });

  it('10. renderSocialProofWallHtml suppresses photo thumbnails when photosEnabled is false', () => {
    const summary = { averageRating: 5.0, totalCount: 42 };
    const reviews = [
      {
        id: 'rev_with_photo',
        customerName: 'Helena P.',
        rating: 5,
        reviewTitle: 'Visible difference in 7 days',
        reviewText: 'See attached texture shot.',
        photos: ['data:image/webp;base64,testphotodata']
      }
    ];

    const html = renderSocialProofWallHtml(summary, reviews, { photosEnabled: false });
    assert.ok(!html.includes('class="jv-ugc-photos"'), 'Must not render photo thumbnail markup when photosEnabled is false');
    assert.ok(!html.includes('testphotodata'), 'Must not render photo src data when photosEnabled is false');
  });
});
