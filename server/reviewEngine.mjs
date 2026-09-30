/**
 * Review & Social Proof UGC Engine (server/reviewEngine.mjs)
 * 
 * Manages post-purchase review collection, cryptographic token verification,
 * verified reviewer tagging, and the merchant's own thank-you code when they set one.
 * Fully self-contained with $0 third-party app or subscription dependencies.
 */
import crypto from 'crypto';
import { REFERRAL_CODE, referralAmountText } from './seededOffers.mjs';

/**
 * Generates an order-bound cryptographic token for verified buyer review submission.
 * The caller supplies the key (server/reviewTokens.mjs). With no key it answers '' and signs
 * nothing: a key written here in the source let anyone mint a "verified buyer" token (R24).
 */
export function generateReviewToken(orderId, email, secret) {
  const key = String(secret || '');
  if (!key) return '';
  const cleanOrder = String(orderId || '').trim();
  const cleanEmail = String(email || '').toLowerCase().trim();
  return crypto
    .createHmac('sha256', key)
    .update(`${cleanOrder}:${cleanEmail}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Verifies that a review submission token matches the order and purchaser email.
 */
export function verifyReviewToken(orderId, email, token, secret) {
  if (!secret || !orderId || !email || !token) return false;
  try {
    const expected = generateReviewToken(orderId, email, secret);
    const a = Buffer.from(String(token).trim());
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Generates a deterministic, personalized VIP Ambassador referral code for a reviewer.
 * Example: GIVE15-SARAH-4A1B
 */
export function generateAmbassadorReferralCode(email) {
  const cleanEmail = String(email || '').toLowerCase().trim();
  const namePart = cleanEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'VIP';
  const hash = crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 4).toUpperCase();
  return `GIVE15-${namePart}-${hash}`;
}

/**
 * Loads all stored reviews from hubStorage / memory cache.
 */
export function loadReviews(hubStorage) {
  if (hubStorage?.get) {
    const data = hubStorage.get('store.reviews', 'reviews.json', []);
    return Array.isArray(data) ? data : [];
  }
  return [];
}

/**
 * Persists a review record to hubStorage.
 */
export function saveReview(review, hubStorage) {
  const all = loadReviews(hubStorage);
  all.unshift(review);
  if (hubStorage?.set) {
    hubStorage.set('store.reviews', 'reviews.json', all);
  }
  return review;
}

/**
 * Processes a verified customer review submission:
 * 1. Saves review record
 * 2. Marks review drip sequence as reviewed_exit (suppressing follow-up reminder)
 * 3. Tags CRM contact with Verified-Reviewer & 5-Star-Advocate
 * 4. Returns the merchant's own discount code as the reward, or no reward when they set none
 *
 * A missing or out of range rating is refused rather than saved as five stars, and a photo is kept
 * only as a base64 image or an https URL with no quote, bracket, parenthesis or backslash (R24).
 */
export function submitCustomerReview({
  orderId,
  customerEmail,
  customerName,
  rating,
  reviewTitle = '',
  reviewText = '',
  tags = [],
  photos = [],
  photoUrl = '',
  storeDomain = '',
  userId = 'usr_default',
  discountCode = '',
  hubStorage,
  loadDrips,
  saveDrips,
  loadContacts,
  saveContacts
}) {
  const cleanEmail = String(customerEmail || '').toLowerCase().trim();
  const cleanRating = Number(rating);
  if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
    return { success: false, error: 'Choose a rating from 1 to 5 stars.' };
  }

  // Validate and sanitize photos (max 2, base64 or https, max 350k chars each)
  const rawPhotos = Array.isArray(photos) ? photos : (photoUrl ? [photoUrl] : []);
  const validPhotos = [];
  for (const p of rawPhotos) {
    if (typeof p !== 'string') continue;
    const trimmed = p.trim();
    if (!trimmed) continue;
    const isDataUri = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i.test(trimmed);
    const isHttps = /^https:\/\/[^\s"'`()<>\\{}]+$/i.test(trimmed);
    if (!isDataUri && !isHttps) continue;
    if (trimmed.length > 350000) continue; // Size cap ~250KB binary
    validPhotos.push(trimmed);
    if (validPhotos.length >= 2) break;
  }

  const reviewRecord = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: userId || 'usr_default',
    orderId: String(orderId || ''),
    customerEmail: cleanEmail,
    customerName: String(customerName || 'Verified Client').trim(),
    rating: cleanRating,
    reviewTitle: String(reviewTitle || '').slice(0, 120),
    reviewText: String(reviewText || '').slice(0, 1500),
    tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
    photos: validPhotos,
    photoUrl: validPhotos[0] || '',
    storeDomain: String(storeDomain || ''),
    discountCodeAwarded: String(discountCode || ''),
    verifiedBuyer: true,
    createdAt: new Date().toISOString()
  };

  saveReview(reviewRecord, hubStorage);

  // Smart Exit from Review Sequence
  if (typeof loadDrips === 'function' && typeof saveDrips === 'function') {
    try {
      const dripsData = loadDrips();
      let modified = false;
      for (const enr of dripsData.enrollments || []) {
        if (
          enr.customerEmail &&
          enr.customerEmail.toLowerCase() === cleanEmail &&
          enr.status === 'active' &&
          (enr.sequenceId === 'drip_seq_review_request' || enr.orderId === String(orderId || ''))
        ) {
          enr.status = 'reviewed_exit';
          enr.reviewedAt = new Date().toISOString();
          const seq = (dripsData.sequences || []).find((s) => s.id === enr.sequenceId);
          if (seq) {
            seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
            seq.totalCompleted = (seq.totalCompleted || 0) + 1;
          }
          modified = true;
        }
      }
      if (modified) saveDrips(dripsData);
    } catch (dripErr) {
      console.warn('[Jourvance Review] Warning during sequence exit:', dripErr.message);
    }
  }

  // Tag CRM Contact
  if (typeof loadContacts === 'function' && typeof saveContacts === 'function') {
    try {
      const contacts = loadContacts();
      const contact = contacts.find((c) => c.email && c.email.toLowerCase() === cleanEmail);
      if (contact) {
        if (!Array.isArray(contact.tags)) contact.tags = [];
        if (!contact.tags.includes('Verified-Reviewer')) contact.tags.push('Verified-Reviewer');
        if (cleanRating >= 4 && !contact.tags.includes('5-Star-Advocate')) contact.tags.push('5-Star-Advocate');
        contact.lastReviewedAt = new Date().toISOString();
        saveContacts(contacts);
      }
    } catch (crmErr) {
      console.warn('[Jourvance Review] Warning during CRM contact tagging:', crmErr.message);
    }
  }

  return {
    success: true,
    review: reviewRecord,
    reward: discountCode ? { code: String(discountCode) } : null
  };
}

/**
 * Renders the high-converting luxury mobile-first Review Submission Portal HTML.
 * The thank-you block shows only the merchant's own code (discountCode) and offers no reward when
 * they set none. A link that did not verify says so instead of showing a form the review route
 * will refuse (R24).
 * The referral card shows only when the merchant has defined GIVE15 for this store (referralRule,
 * from definedReferralRule), states their amount, and promises the reviewer nothing: it used to
 * offer "Give $15, Get $15" and a $15 gift to the reviewer's inbox that nothing sends (T13).
 */
export function renderReviewPortalHtml({
  orderId = '',
  email = '',
  token = '',
  storeName = 'Jourvance',
  storeDomain = '',
  slug = '',
  verified = true,
  discountCode = '',
  referralRule = null,
  currency = ''
}) {
  const cleanOrder = String(orderId || '').replace(/^#/, '');
  const cleanEmail = String(email || '').trim();
  const safeStoreName = escapeHtml(String(storeName || 'Jourvance'));
  const code = String(discountCode || '').trim();
  const referralCode = generateAmbassadorReferralCode(cleanEmail);
  slug = String(slug || '').replace(/[^a-z0-9_-]/gi, '');
  // A referral link needs the store it checks out on and the merchant's own GIVE15 rule.
  const referralOn = Boolean(storeDomain && referralRule);
  const referralAmount = referralOn ? referralAmountText(referralRule, currency) : '';
  const referralUrl = referralOn
    ? (slug ? `https://${storeDomain}/p/${slug}?ref=${referralCode}&coupon=${REFERRAL_CODE}` : `https://${storeDomain}?ref=${referralCode}&discount=${REFERRAL_CODE}`)
    : '';
  const referralOffer = referralAmount ? `${referralAmount} with code ${REFERRAL_CODE}` : `code ${REFERRAL_CODE}`;
  const shareText = `I thought of you. Here is ${referralOffer} at ${String(storeName || '').trim() || 'this store'}: ${referralUrl}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Share Your Experience · ${safeStoreName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #0b0b10;
      color: #f3f4f6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      background-image: 
        radial-gradient(circle at 50% 0%, rgba(236, 72, 153, 0.12) 0%, transparent 60%),
        radial-gradient(circle at 100% 100%, rgba(245, 158, 11, 0.08) 0%, transparent 50%);
    }
    .jv-container {
      width: 100%;
      maxWidth: 540px;
      background: rgba(18, 18, 24, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 36px 28px;
      box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      position: relative;
    }
    .jv-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(236, 72, 153, 0.15);
      color: #f472b6;
      border: 1px solid rgba(236, 72, 153, 0.3);
      margin-bottom: 16px;
    }
    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 26px;
      font-weight: 600;
      color: #ffffff;
      line-height: 1.25;
      margin-bottom: 8px;
    }
    p.jv-subtitle {
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .jv-stars-container {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
      justify-content: center;
    }
    .jv-star {
      width: 40px;
      height: 40px;
      cursor: pointer;
      color: #374151;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .jv-star.active, .jv-star:hover {
      color: #fbbf24;
      transform: scale(1.12);
      filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.5));
    }
    .jv-star-label {
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      color: #fbbf24;
      min-height: 18px;
      margin-bottom: 24px;
    }
    .jv-field {
      margin-bottom: 18px;
      text-align: left;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #d1d5db;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    input[type="text"], textarea {
      width: 100%;
      background: rgba(11, 11, 16, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 12px 14px;
      color: #ffffff;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s ease;
    }
    input[type="text"]:focus, textarea:focus {
      border-color: #ec4899;
      box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.2);
    }
    textarea {
      min-height: 100px;
      resize: vertical;
    }
    .jv-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 24px;
    }
    .jv-tag-chip {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #d1d5db;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .jv-tag-chip.selected {
      background: rgba(236, 72, 153, 0.2);
      border-color: #ec4899;
      color: #f472b6;
      font-weight: 600;
    }
    .jv-submit-btn {
      width: 100%;
      padding: 14px 20px;
      background: linear-gradient(135deg, #ec4899 0%, #db2777 100%);
      color: #ffffff;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 8px 24px -4px rgba(236, 72, 153, 0.4);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .jv-submit-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 28px -4px rgba(236, 72, 153, 0.5);
    }
    .jv-submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .jv-reward-card {
      display: none;
      text-align: center;
      animation: fadeIn 0.4s ease forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .jv-code-box {
      background: rgba(16, 185, 129, 0.12);
      border: 1px dashed rgba(16, 185, 129, 0.4);
      border-radius: 12px;
      padding: 18px;
      margin: 20px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .jv-code {
      font-family: monospace;
      font-size: 24px;
      font-weight: 800;
      color: #34d399;
      letter-spacing: 0.1em;
    }
    .jv-copy-btn {
      padding: 8px 16px;
      background: #10b981;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .jv-shop-link {
      display: inline-block;
      margin-top: 14px;
      color: #ec4899;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }
    .jv-photo-dropzone {
      border: 1px dashed rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 14px;
      text-align: center;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.02);
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .jv-photo-dropzone:hover {
      border-color: #ec4899;
      background: rgba(236, 72, 153, 0.05);
    }
    .jv-photo-previews {
      display: flex;
      gap: 10px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .jv-photo-thumb-wrap {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .jv-photo-thumb-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .jv-photo-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.8);
      color: #ffffff;
      border: none;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      line-height: 1;
    }
    .jv-ambassador-box {
      margin-top: 24px;
      padding: 20px 18px;
      background: rgba(236, 72, 153, 0.08);
      border: 1px solid rgba(236, 72, 153, 0.28);
      border-radius: 16px;
      text-align: center;
      position: relative;
    }
    .jv-ambassador-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: rgba(236, 72, 153, 0.2);
      color: #f472b6;
      border: 1px solid rgba(236, 72, 153, 0.35);
      margin-bottom: 10px;
    }
    .jv-ref-input-group {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .jv-ref-input {
      flex: 1;
      padding: 10px 12px;
      font-size: 12px;
      font-family: monospace;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: #f3f4f6;
      outline: none;
    }
    .jv-copy-ref-btn {
      padding: 10px 16px;
      background: #ec4899;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease;
    }
    .jv-copy-ref-btn:hover {
      background: #db2777;
    }
    .jv-quick-share-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .jv-quick-share-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 9px 12px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: #f1f5f9;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .jv-quick-share-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      transform: translateY(-1px);
    }
    .jv-quick-share-wa:hover {
      border-color: #25D366;
      color: #86efac;
    }
  </style>
</head>
<body>
  <div class="jv-container">
${verified ? `    <!-- Review Form View -->
    <div id="jv-form-view">
      <div class="jv-badge">
        ✦ ${safeStoreName} · Verified Order #${escapeHtml(cleanOrder)}
      </div>
      <h1>How was your order?</h1>
      <p class="jv-subtitle">
        Share a short review of your order.
      </p>

      <form id="jv-review-form">
        <input type="hidden" id="jv-rating" value="5" />
        <div class="jv-stars-container" id="jv-stars">
          <svg class="jv-star active" data-val="1" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
          <svg class="jv-star active" data-val="2" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
          <svg class="jv-star active" data-val="3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
          <svg class="jv-star active" data-val="4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
          <svg class="jv-star active" data-val="5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
        </div>
        <div class="jv-star-label" id="jv-star-desc">Excellent</div>

        <div class="jv-field">
          <label>Your Display Name</label>
          <input type="text" id="jv-name" placeholder="e.g. Sarah C." />
        </div>

        <div class="jv-field">
          <label>Headline</label>
          <input type="text" id="jv-title" placeholder="Sum up your review in a few words" required />
        </div>

        <div class="jv-field">
          <label>Your Experience</label>
          <textarea id="jv-body" placeholder="What did you like, and what could be better?" required></textarea>
        </div>

        <div class="jv-field">
          <label>Highlights (Optional)</label>
          <div class="jv-tags">
            <button type="button" class="jv-tag-chip" data-tag="Great Quality" aria-pressed="false">Great Quality</button>
            <button type="button" class="jv-tag-chip" data-tag="Good Value" aria-pressed="false">Good Value</button>
            <button type="button" class="jv-tag-chip" data-tag="As Described" aria-pressed="false">As Described</button>
            <button type="button" class="jv-tag-chip" data-tag="Would Buy Again" aria-pressed="false">Would Buy Again</button>
            <button type="button" class="jv-tag-chip" data-tag="Fast Delivery" aria-pressed="false">Fast Delivery</button>
          </div>
        </div>

        <div class="jv-field">
          <label>Add Photos (Optional · Up to 2)</label>
          <input type="file" id="jv-photos-input" accept="image/*" multiple style="display: none;" />
          <div class="jv-photo-dropzone" id="jv-dropzone" role="button" tabindex="0">
            <svg width="22" height="22" fill="none" stroke="#f472b6" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style="font-size: 12px; font-weight: 600; color: #e5e7eb;">+ Add a Photo</span>
            <span style="font-size: 11px; color: #9ca3af;">Auto-compressed for fast upload · Max 2 photos</span>
          </div>
          <div class="jv-photo-previews" id="jv-photo-previews"></div>
        </div>

        <button type="submit" class="jv-submit-btn" id="jv-submit-btn">
          <span>Submit review</span>
        </button>
      </form>
    </div>

    <!-- Reward Reveal View -->
    <div id="jv-reward-view" class="jv-reward-card">
      <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; border: 1px solid rgba(16,185,129,0.3);">
        <svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      </div>
      <h1>With Deep Gratitude</h1>
      <p class="jv-subtitle" id="jv-reward-thankyou">
        ${code ? 'Your review is saved. Here is your thank-you code:' : 'Your review is saved. Thank you.'}
      </p>
${code ? `
      <div class="jv-code-box">
        <span style="font-size: 11px; text-transform: uppercase; color: #9ca3af; font-weight: 700;">Your code</span>
        <div class="jv-code" id="jv-revealed-code">${escapeHtml(code)}</div>
        <button type="button" class="jv-copy-btn" id="jv-copy-btn">Copy code</button>
      </div>
` : ''}
${referralOn ? `      <!-- Referral card (Phase 15): only for the merchant's own GIVE15, at their amount -->
      <div class="jv-ambassador-box">
        <div class="jv-ambassador-badge">
          ✦ Refer a friend
        </div>
        <h2 style="font-family: 'Playfair Display', serif; font-size: 19px; color: #ffffff; margin-bottom: 6px;">Share with a friend</h2>
        <p style="font-size: 13px; color: #cbd5e1; line-height: 1.45; margin-bottom: 14px;">
          ${referralAmount
            ? `Share your link and your friend gets ${escapeHtml(referralAmount)} with code <strong style="color: #f472b6;">${REFERRAL_CODE}</strong>.`
            : `Share your link and your friend can check out with code <strong style="color: #f472b6;">${REFERRAL_CODE}</strong>.`}
        </p>

        <div class="jv-ref-input-group">
          <input type="text" id="jv-ref-url" value="${escapeHtml(referralUrl)}" aria-label="Your referral link" readonly class="jv-ref-input" />
          <button type="button" id="jv-copy-ref-btn" class="jv-copy-ref-btn">Copy Link</button>
        </div>

        <div class="jv-quick-share-row">
          <a href="sms:?&body=${encodeURIComponent(shareText)}" class="jv-quick-share-btn">
            💬 Text a Friend
          </a>
          <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener" class="jv-quick-share-btn jv-quick-share-wa">
            🌿 WhatsApp
          </a>
        </div>
      </div>
` : ''}
      ${storeDomain ? `<a href="${escapeHtml(`https://${storeDomain}${code ? `?discount=${encodeURIComponent(code)}` : ''}`)}" class="jv-shop-link" id="jv-shop-link">
        Continue to ${safeStoreName} →
      </a>` : ''}
    </div>
  </div>

  <script>
    const stars = document.querySelectorAll('.jv-star');
    const ratingInput = document.getElementById('jv-rating');
    const starDesc = document.getElementById('jv-star-desc');
    const labels = {
      1: 'Needs Improvement',
      2: 'Fair',
      3: 'Good',
      4: 'Very Good',
      5: 'Excellent'
    };

    stars.forEach(s => {
      s.addEventListener('click', () => {
        const val = parseInt(s.dataset.val);
        ratingInput.value = val;
        starDesc.textContent = labels[val] || '';
        stars.forEach(st => {
          const stVal = parseInt(st.dataset.val);
          st.classList.toggle('active', stVal <= val);
        });
      });
    });

    document.querySelectorAll('.jv-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => chip.setAttribute('aria-pressed', String(chip.classList.toggle('selected'))));
    });

    // Zero-Cost Client-Side WebP Photo Compression
    let uploadedPhotos = [];
    const dropzone = document.getElementById('jv-dropzone');
    const photoInput = document.getElementById('jv-photos-input');
    const previewsWrap = document.getElementById('jv-photo-previews');

    if (dropzone && photoInput) {
      dropzone.addEventListener('click', () => {
        if (uploadedPhotos.length >= 2) {
          alert('You can upload up to 2 photos per review.');
          return;
        }
        photoInput.click();
      });

      photoInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          if (uploadedPhotos.length >= 2) break;
          if (!file.type.startsWith('image/')) continue;
          try {
            const compressed = await compressImageToWebP(file);
            if (compressed && uploadedPhotos.length < 2) {
              uploadedPhotos.push(compressed);
            }
          } catch (err) {
            console.warn('Could not compress photo:', err);
          }
        }
        photoInput.value = '';
        renderPreviews();
      });
    }

    function compressImageToWebP(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (re) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width;
            let h = img.height;
            const maxDim = 1200;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            let dataUrl = canvas.toDataURL('image/webp', 0.82);
            if (!dataUrl.startsWith('data:image/webp')) {
              dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            }
            resolve(dataUrl);
          };
          img.onerror = reject;
          img.src = re.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function renderPreviews() {
      if (!previewsWrap) return;
      previewsWrap.innerHTML = '';
      uploadedPhotos.forEach((src, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'jv-photo-thumb-wrap';
        wrap.innerHTML = '<img src="' + src + '" alt="Upload preview" /><button type="button" class="jv-photo-remove" title="Remove photo" onclick="removePhoto(' + idx + ')">×</button>';
        previewsWrap.appendChild(wrap);
      });
      if (dropzone) {
        dropzone.style.display = uploadedPhotos.length >= 2 ? 'none' : 'flex';
      }
    }

    window.removePhoto = function(index) {
      uploadedPhotos.splice(index, 1);
      renderPreviews();
    };

    const form = document.getElementById('jv-review-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('jv-submit-btn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Saving Review...</span>';

      const selectedTags = Array.from(document.querySelectorAll('.jv-tag-chip.selected')).map(c => c.dataset.tag);
      const payload = {
        orderId: ${jsString(cleanOrder)},
        email: ${jsString(cleanEmail)},
        token: ${jsString(token)},
        rating: parseInt(ratingInput.value),
        customerName: document.getElementById('jv-name').value || ${jsString(cleanEmail.split('@')[0])},
        reviewTitle: document.getElementById('jv-title').value,
        reviewText: document.getElementById('jv-body').value,
        tags: selectedTags,
        photos: uploadedPhotos
      };

      try {
        const res = await fetch('/api/public/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          document.getElementById('jv-form-view').style.display = 'none';
          document.getElementById('jv-reward-view').style.display = 'block';
          const revealed = document.getElementById('jv-revealed-code');
          if (revealed && data.reward && data.reward.code) {
            revealed.textContent = data.reward.code;
          }
        } else {
          alert(data.error || 'Could not submit review. Please check your network and try again.');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit review</span>';
        }
      } catch (err) {
        alert('Network error submitting review.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Submit review</span>';
      }
    });

    const copyCodeBtn = document.getElementById('jv-copy-btn');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', () => {
        const code = document.getElementById('jv-revealed-code').textContent.trim();
        navigator.clipboard.writeText(code).then(() => {
          copyCodeBtn.textContent = 'Copied';
          setTimeout(() => { copyCodeBtn.textContent = 'Copy code'; }, 2500);
        });
      });
    }

    const copyRefBtn = document.getElementById('jv-copy-ref-btn');
    if (copyRefBtn) {
      copyRefBtn.addEventListener('click', () => {
        const refUrl = document.getElementById('jv-ref-url').value;
        navigator.clipboard.writeText(refUrl).then(() => {
          copyRefBtn.textContent = 'Copied!';
          copyRefBtn.style.background = '#10b981';
          setTimeout(() => {
            copyRefBtn.textContent = 'Copy Link';
            copyRefBtn.style.background = '#ec4899';
          }, 2500);
        });
      });
    }
  </script>
` : `    <div id="jv-invalid-view">
      <h1>This review link is not valid</h1>
      <p class="jv-subtitle">Open the link from your review email.</p>
    </div>
  </div>
`}
</body>
</html>`;
}

// A value for a JS string literal inside an inline <script>: quoted, escaped, and unable to close the tag.
function jsString(value) {
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
}

/**
 * High-converting baseline luxury beauty reviews for new merchants
 * before they collect their first live order submissions.
 */
export const CURATED_UGC_PHOTO_1 = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g1" cx="40%" cy="35%" r="65%"><stop offset="0%" stop-color="%23fce7f3"/><stop offset="45%" stop-color="%23f472b6"/><stop offset="85%" stop-color="%23db2777"/><stop offset="100%" stop-color="%23831843"/></radialGradient></defs><rect width="400" height="400" rx="24" fill="%23181824"/><circle cx="200" cy="190" r="110" fill="url(%23g1)"/><ellipse cx="170" cy="150" rx="35" ry="20" fill="%23ffffff" opacity="0.45" transform="rotate(-25 170 150)"/><text x="200" y="340" fill="%23f9a8d4" font-family="system-ui,sans-serif" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="middle">ROSEWATER ELIXIR TEXTURE</text></svg>`;

export const CURATED_UGC_PHOTO_2 = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><radialGradient id="g2" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="%23fef3c7"/><stop offset="50%" stop-color="%23f59e0b"/><stop offset="85%" stop-color="%23d97706"/><stop offset="100%" stop-color="%2378350f"/></radialGradient></defs><rect width="400" height="400" rx="24" fill="%23181824"/><circle cx="200" cy="190" r="105" fill="url(%23g2)"/><ellipse cx="165" cy="155" rx="30" ry="16" fill="%23ffffff" opacity="0.5" transform="rotate(-20 165 155)"/><text x="200" y="340" fill="%23fcd34d" font-family="system-ui,sans-serif" font-size="13" font-weight="700" letter-spacing="1.5" text-anchor="middle">GOLDEN PEPTIDE GLOW</text></svg>`;

export const DEFAULT_CURATED_REVIEWS = [
  {
    id: 'curated_1',
    customerName: 'Elena V.',
    rating: 5,
    reviewTitle: 'My skin hasn’t felt this supple in years',
    reviewText: 'The texture is weightless yet deeply nourishing. Absorbed within seconds and left my morning routine glowing without any greasy residue.',
    tags: ['Glowing Results', 'Luxury Texture'],
    photos: [CURATED_UGC_PHOTO_1],
    verifiedBuyer: true,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString()
  },
  {
    id: 'curated_2',
    customerName: 'Camilla R.',
    rating: 5,
    reviewTitle: 'Replaced my entire morning serum lineup',
    reviewText: 'Visible reduction in fine dehydration lines within 10 days. Soft, calm, and exquisitely formulated. Worth every single penny.',
    tags: ['Fast Absorption', 'Daily Essential'],
    photos: [CURATED_UGC_PHOTO_2],
    verifiedBuyer: true,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString()
  },
  {
    id: 'curated_3',
    customerName: 'Marcus L.',
    rating: 5,
    reviewTitle: 'Noticeable morning clarity in under two weeks',
    reviewText: 'Gentle on sensitive skin with noticeable morning clarity. My partner commented on how radiant my complexion looked before I even mentioned switching formulas.',
    tags: ['Gentle & Hydrating', 'Glowing Results'],
    photos: [],
    verifiedBuyer: true,
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString()
  }
];

/**
 * Retrieves sanitized public approved verified reviews for storefront social proof walls.
 * Only stored reviews with a real 1 to 5 rating, and with a userId only that owner's: the written
 * sample reviews above and a "148 reviews, 4.9 stars, 97%" summary once stood in for an empty store,
 * and reviews filed under usr_default or under nobody reached every merchant's page (R24).
 */
export function getPublicVerifiedReviews({
  userId,
  storeDomain,
  minRating = 4,
  limit = 12,
  hubStorage
} = {}) {
  const all = loadReviews(hubStorage);
  const min = Math.max(1, Math.min(5, Number(minRating) || 4));

  // Filter reviews: must not be hidden and must meet minimum star threshold
  let matched = all.filter((r) => {
    if (!r || r.hidden === true) return false;
    const rating = Number(r.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || rating < min) return false;
    if (userId && r.userId !== userId) return false;
    if (storeDomain && r.storeDomain && r.storeDomain !== storeDomain) return false;
    return true;
  });

  const sliced = matched.slice(0, Math.max(1, Number(limit) || 12));

  // Sanitize customer names for privacy: "First L."
  const sanitizedReviews = sliced.map((r) => {
    let displayName = 'Verified Client';
    if (r.customerName) {
      const parts = String(r.customerName).trim().split(/\s+/);
      if (parts.length === 1) {
        displayName = parts[0];
      } else if (parts.length > 1) {
        displayName = `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
      }
    }
    return {
      id: r.id,
      customerName: displayName,
      rating: Number(r.rating),
      reviewTitle: String(r.reviewTitle || ''),
      reviewText: String(r.reviewText || ''),
      tags: Array.isArray(r.tags) ? r.tags : [],
      photos: Array.isArray(r.photos) ? r.photos.slice(0, 2) : (r.photoUrl ? [r.photoUrl] : []),
      verifiedBuyer: Boolean(r.verifiedBuyer !== false),
      createdAt: r.createdAt || new Date().toISOString()
    };
  });

  const totalCount = matched.length;
  const averageRating = totalCount
    ? Number((matched.reduce((acc, r) => acc + Number(r.rating), 0) / totalCount).toFixed(1))
    : null;
  const fiveStarPercentage = totalCount
    ? Math.round((matched.filter(r => Number(r.rating) === 5).length / totalCount) * 100)
    : null;

  return {
    summary: {
      averageRating,
      totalCount,
      fiveStarPercentage
    },
    reviews: sanitizedReviews
  };
}

/**
 * Toggles visibility of a customer review (hide / unhide).
 */
export function toggleReviewVisibility(reviewId, hidden = true, hubStorage) {
  const all = loadReviews(hubStorage);
  const review = all.find(r => r.id === String(reviewId || ''));
  if (review) {
    review.hidden = Boolean(hidden);
    if (hubStorage?.set) {
      hubStorage.set('store.reviews', 'reviews.json', all);
    }
    return review;
  }
  return null;
}

/**
 * Generates the high-converting Social Proof Wall HTML & CSS
 * Mobile: Swipeable horizontal card carousel with scroll snap
 * Desktop: 3-column responsive card grid
 * The summary states the exact count and the stored average, and shows no rating when there is none.
 * Each photo is a button carrying its URL in a data attribute and opened by a listener: an inline
 * onclick string once carried it, and the browser decodes an escaped quote before the script runs,
 * so a submitted photo URL could run code on the merchant's page (R24).
 */
export function renderSocialProofWallHtml(summary = {}, reviews = [], {
  brandColor = '#ec4899',
  title = 'Customer reviews',
  photosEnabled = true
} = {}) {
  const rawAvg = Number(summary?.averageRating);
  const avg = summary?.averageRating != null && Number.isFinite(rawAvg) && rawAvg > 0 ? rawAvg.toFixed(1) : '';
  const rawCount = Number(summary?.totalCount);
  const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : reviews.length;
  const safeTitle = String(title || 'Customer reviews');

  const starSvg = `<svg style="width: 14px; height: 14px; color: #fbbf24; fill: currentColor; flex-shrink: 0;" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
  const starsGroup = (rating) => Array.from({ length: rating }).map(() => starSvg).join('');

  return `
<!-- ── Jourvance Live Verified UGC Social Proof Wall (Phase 13) ── -->
<section class="jv-ugc-wall" aria-label="Customer Reviews & Testimonials">
  <style>
    .jv-ugc-wall {
      width: 100%;
      margin: 28px 0 12px 0;
      text-align: center;
      position: relative;
    }
    .jv-ugc-header {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .jv-ugc-summary-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 14px;
      background: rgba(251, 191, 36, 0.12);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      color: #fbbf24;
      letter-spacing: 0.02em;
    }
    .jv-ugc-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 22px;
      font-weight: 600;
      color: #ffffff;
      line-height: 1.3;
    }
    .jv-ugc-sub {
      font-size: 13px;
      color: #94a3b8;
      max-width: 520px;
      line-height: 1.5;
    }
    /* Mobile-first: Swipeable horizontal card carousel with scroll snap */
    .jv-ugc-cards-wrap {
      display: flex;
      gap: 14px;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      padding: 4px 2px 14px 2px;
      margin: 0 -4px;
    }
    .jv-ugc-cards-wrap::-webkit-scrollbar {
      height: 4px;
    }
    .jv-ugc-cards-wrap::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 4px;
    }
    .jv-ugc-cards-wrap::-webkit-scrollbar-thumb {
      background: rgba(236, 72, 153, 0.3);
      border-radius: 4px;
    }
    .jv-ugc-card {
      flex: 0 0 260px;
      scroll-snap-align: start;
      background: rgba(18, 18, 24, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 18px 16px;
      display: flex;
      flex-direction: column;
      text-align: left;
      box-shadow: 0 10px 24px -6px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .jv-ugc-card:hover {
      transform: translateY(-2px);
      border-color: rgba(236, 72, 153, 0.35);
    }
    .jv-ugc-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .jv-ugc-stars {
      display: flex;
      gap: 2px;
    }
    .jv-ugc-verified {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #34d399;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.25);
      padding: 2px 7px;
      border-radius: 12px;
    }
    .jv-ugc-headline {
      font-size: 14px;
      font-weight: 700;
      color: #f1f5f9;
      line-height: 1.35;
      margin-bottom: 6px;
    }
    .jv-ugc-quote {
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
      flex-grow: 1;
      margin-bottom: 12px;
    }
    .jv-ugc-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 10px;
    }
    .jv-ugc-tag {
      font-size: 11px;
      font-weight: 600;
      color: #f472b6;
      background: rgba(236, 72, 153, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .jv-ugc-photos {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .jv-ugc-photo-thumb {
      position: relative;
      width: 52px;
      height: 52px;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
      cursor: pointer;
      background: #111;
      transition: transform 0.15s ease, border-color 0.15s ease;
      flex-shrink: 0;
      padding: 0;
      font: inherit;
      color: inherit;
    }
    .jv-ugc-photo-thumb:focus-visible {
      outline: 2px solid #f9a8d4;
      outline-offset: 2px;
    }
    .jv-ugc-photo-thumb:hover {
      transform: scale(1.05);
      border-color: #ec4899;
    }
    .jv-ugc-photo-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .jv-ugc-photo-zoom-icon {
      position: absolute;
      bottom: 2px;
      right: 2px;
      font-size: 11px;
      background: rgba(0, 0, 0, 0.65);
      border-radius: 4px;
      padding: 1px 2px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .jv-ugc-photo-thumb:hover .jv-ugc-photo-zoom-icon,
    .jv-ugc-photo-thumb:focus-visible .jv-ugc-photo-zoom-icon {
      opacity: 1;
    }
    .jv-ugc-author {
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 8px;
    }
    .jv-ugc-author-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ec4899, #f59e0b);
      color: #ffffff;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
    }
    /* Desktop: 3-column responsive grid */
    @media (min-width: 640px) {
      .jv-ugc-cards-wrap {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        overflow-x: visible;
        margin: 0;
      }
      .jv-ugc-card {
        flex: 1 1 auto;
      }
    }
    /* Luxury Lightbox Overlay */
    .jv-lightbox-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(8, 7, 12, 0.88);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 999999;
      align-items: center;
      justify-content: center;
      padding: 20px;
      box-sizing: border-box;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .jv-lightbox-overlay.active {
      display: flex;
      opacity: 1;
    }
    .jv-lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: jvZoomIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes jvZoomIn {
      from { transform: scale(0.92); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .jv-lightbox-img {
      max-width: 100%;
      max-height: 80vh;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.8);
      object-fit: contain;
    }
    .jv-lightbox-close {
      position: absolute;
      top: -38px;
      right: 0;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      transition: background 0.15s ease;
    }
    .jv-lightbox-close:hover {
      background: #ec4899;
    }
  </style>

  <div class="jv-ugc-header">
    <div class="jv-ugc-summary-pill">
      ${avg ? `<span>★ ${avg} / 5.0</span>
      <span style="opacity: 0.5;" aria-hidden="true">·</span>
      ` : ''}<span>${count} ${count === 1 ? 'review' : 'reviews'}</span>
    </div>
    <h2 class="jv-ugc-title">${escapeHtml(safeTitle)}</h2>
  </div>

  <div class="jv-ugc-cards-wrap">
    ${reviews.map(r => `
      <div class="jv-ugc-card">
        <div class="jv-ugc-card-top">
          <div class="jv-ugc-stars" role="img" aria-label="${Number(r.rating)} out of 5 stars">${starsGroup(Number(r.rating))}</div>
          <span class="jv-ugc-verified">✓ Verified</span>
        </div>
        <div class="jv-ugc-headline">${escapeHtml(r.reviewTitle)}</div>
        <p class="jv-ugc-quote">“${escapeHtml(r.reviewText)}”</p>
        ${r.tags && r.tags.length ? `
          <div class="jv-ugc-tags">
            ${r.tags.map(t => `<span class="jv-ugc-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
        ${photosEnabled !== false && r.photos && r.photos.length ? `
          <div class="jv-ugc-photos">
            ${r.photos.map(p => `
              <button type="button" class="jv-ugc-photo-thumb" data-jv-photo="${escapeHtml(p)}" aria-label="Open customer photo">
                <img src="${escapeHtml(p)}" alt="" loading="lazy" />
                <span class="jv-ugc-photo-zoom-icon" aria-hidden="true">🔍</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div class="jv-ugc-author">
          <span class="jv-ugc-author-avatar" aria-hidden="true">${escapeHtml((r.customerName || 'V')[0])}</span>
          <span>${escapeHtml(r.customerName)}</span>
        </div>
      </div>
    `).join('')}
  </div>

  <!-- Lightbox Modal -->
  <div id="jv-ugc-lightbox" class="jv-lightbox-overlay" role="dialog" aria-modal="true" aria-label="Customer photo">
    <div class="jv-lightbox-content">
      <button type="button" class="jv-lightbox-close" aria-label="Close photo">×</button>
      <img id="jv-lightbox-target" class="jv-lightbox-img" src="" alt="Customer photo" />
    </div>
  </div>

  <script>
    (function () {
      var opener = null;
      function modal() { return document.getElementById('jv-ugc-lightbox'); }
      window.openJvLightbox = function (src) {
        var box = modal();
        var target = document.getElementById('jv-lightbox-target');
        if (!box || !target) return;
        target.src = src;
        box.classList.add('active');
        document.body.style.overflow = 'hidden';
        var close = box.querySelector('.jv-lightbox-close');
        if (close) close.focus();
      };
      window.closeJvLightbox = function () {
        var box = modal();
        var target = document.getElementById('jv-lightbox-target');
        if (!box || !target || !box.classList.contains('active')) return;
        box.classList.remove('active');
        target.src = '';
        document.body.style.overflow = '';
        if (opener) { opener.focus(); opener = null; }
      };
      document.addEventListener('click', function (e) {
        var el = e.target;
        var thumb = el && el.closest ? el.closest('[data-jv-photo]') : null;
        if (thumb) {
          opener = thumb;
          window.openJvLightbox(thumb.getAttribute('data-jv-photo'));
          return;
        }
        var box = modal();
        if (box && (el === box || (el.closest && el.closest('.jv-lightbox-close')))) window.closeJvLightbox();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') window.closeJvLightbox();
      });
    })();
  </script>
</section>
`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
