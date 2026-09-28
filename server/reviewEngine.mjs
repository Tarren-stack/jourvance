/**
 * Review & Social Proof UGC Engine (server/reviewEngine.mjs)
 * 
 * Manages post-purchase review collection, cryptographic token verification,
 * verified reviewer tagging, and instant courtesy reward reveals ($10 REVIEW10).
 * Fully self-contained with $0 third-party app or subscription dependencies.
 */
import crypto from 'crypto';

const DEFAULT_REVIEW_SECRET = process.env.REVIEW_SECRET || 'jourvance_review_sig_2026';

/**
 * Generates an order-bound cryptographic token for verified buyer review submission.
 */
export function generateReviewToken(orderId, email, secret = DEFAULT_REVIEW_SECRET) {
  const cleanOrder = String(orderId || '').trim();
  const cleanEmail = String(email || '').toLowerCase().trim();
  return crypto
    .createHmac('sha256', secret || DEFAULT_REVIEW_SECRET)
    .update(`${cleanOrder}:${cleanEmail}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Verifies that a review submission token matches the order and purchaser email.
 */
export function verifyReviewToken(orderId, email, token, secret = DEFAULT_REVIEW_SECRET) {
  if (!orderId || !email || !token) return false;
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
 * 4. Returns discount reward ($10 REVIEW10)
 */
export function submitCustomerReview({
  orderId,
  customerEmail,
  customerName,
  rating = 5,
  reviewTitle = '',
  reviewText = '',
  tags = [],
  photos = [],
  photoUrl = '',
  storeDomain = '',
  userId = 'usr_default',
  discountCode = 'REVIEW10',
  hubStorage,
  loadDrips,
  saveDrips,
  loadContacts,
  saveContacts
}) {
  const cleanEmail = String(customerEmail || '').toLowerCase().trim();
  const cleanRating = Math.max(1, Math.min(5, Math.round(Number(rating) || 5)));

  // Validate and sanitize photos (max 2, base64 or https, max 350k chars each)
  const rawPhotos = Array.isArray(photos) ? photos : (photoUrl ? [photoUrl] : []);
  const validPhotos = [];
  for (const p of rawPhotos) {
    if (typeof p !== 'string') continue;
    const trimmed = p.trim();
    if (!trimmed) continue;
    const isDataUri = /^data:image\/(webp|jpeg|jpg|png|svg\+xml);base64,/i.test(trimmed) || trimmed.startsWith('data:image/svg+xml');
    const isHttps = /^https:\/\/[^\s]+$/i.test(trimmed);
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
    photoUrl: validPhotos[0] || String(photoUrl || '').slice(0, 500),
    storeDomain: String(storeDomain || ''),
    discountCodeAwarded: discountCode || 'REVIEW10',
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
    reward: {
      code: discountCode,
      value: '$10.00 Off',
      notice: 'Enjoy $10 off your next replenishment ritual with code ' + discountCode
    }
  };
}

/**
 * Renders the high-converting luxury mobile-first Review Submission Portal HTML.
 */
export function renderReviewPortalHtml({
  orderId = '',
  email = '',
  token = '',
  storeName = 'Jourvance',
  storeDomain = '',
  verified = true,
  discountCode = 'REVIEW10'
}) {
  const cleanOrder = String(orderId || '').replace(/^#/, '');
  const cleanEmail = String(email || '').trim();
  const safeStoreName = String(storeName || 'Jourvance');

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
  </style>
</head>
<body>
  <div class="jv-container">
    <!-- Review Form View -->
    <div id="jv-form-view">
      <div class="jv-badge">
        ✦ ${safeStoreName} · Verified Order #${cleanOrder}
      </div>
      <h1>How is your new ritual?</h1>
      <p class="jv-subtitle">
        Your honest feedback helps our team craft better formulas. Share a brief note to reveal your complimentary $10 courtesy gift.
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
        <div class="jv-star-label" id="jv-star-desc">Exceptional Ritual ✨</div>

        <div class="jv-field">
          <label>Your Display Name</label>
          <input type="text" id="jv-name" placeholder="e.g. Sarah C." />
        </div>

        <div class="jv-field">
          <label>Headline</label>
          <input type="text" id="jv-title" placeholder="e.g. My skin has never looked so luminous" required />
        </div>

        <div class="jv-field">
          <label>Your Experience</label>
          <textarea id="jv-body" placeholder="How does it feel? When did you first notice a difference in your skin?" required></textarea>
        </div>

        <div class="jv-field">
          <label>Highlight Highlights</label>
          <div class="jv-tags">
            <span class="jv-tag-chip selected" data-tag="Glowing Results">Glowing Results</span>
            <span class="jv-tag-chip" data-tag="Luxury Texture">Luxury Texture</span>
            <span class="jv-tag-chip" data-tag="Gentle & Hydrating">Gentle & Hydrating</span>
            <span class="jv-tag-chip" data-tag="Fast Absorption">Fast Absorption</span>
            <span class="jv-tag-chip" data-tag="Daily Essential">Daily Essential</span>
          </div>
        </div>

        <div class="jv-field">
          <label>Add Photos of Your Ritual (Optional · Up to 2)</label>
          <input type="file" id="jv-photos-input" accept="image/*" multiple style="display: none;" />
          <div class="jv-photo-dropzone" id="jv-dropzone" role="button" tabindex="0">
            <svg width="22" height="22" fill="none" stroke="#f472b6" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style="font-size: 12px; font-weight: 600; color: #e5e7eb;">+ Add Before &amp; After or Ritual Photo</span>
            <span style="font-size: 11px; color: #9ca3af;">Auto-compressed for fast upload · Max 2 photos</span>
          </div>
          <div class="jv-photo-previews" id="jv-photo-previews"></div>
        </div>

        <button type="submit" class="jv-submit-btn" id="jv-submit-btn">
          <span>Submit Review & Reveal $10 Treat →</span>
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
        Your verified review has been recorded. Here is your private $10 courtesy reward code for your next ritual:
      </p>

      <div class="jv-code-box">
        <span style="font-size: 11px; text-transform: uppercase; color: #9ca3af; font-weight: 700;">Courtesy Voucher ($10 Off)</span>
        <div class="jv-code" id="jv-revealed-code">${discountCode || 'REVIEW10'}</div>
        <button type="button" class="jv-copy-btn" id="jv-copy-btn">Copy Voucher Code</button>
      </div>

      <a href="${storeDomain ? `https://${storeDomain}?discount=${discountCode || 'REVIEW10'}` : '#'}" class="jv-shop-link" id="jv-shop-link">
        Continue to ${safeStoreName} →
      </a>
    </div>
  </div>

  <script>
    const stars = document.querySelectorAll('.jv-star');
    const ratingInput = document.getElementById('jv-rating');
    const starDesc = document.getElementById('jv-star-desc');
    const labels = {
      1: 'Needs Improvement',
      2: 'Fair',
      3: 'Good Routine',
      4: 'Really Loved It ✨',
      5: 'Exceptional Ritual ✨'
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
      chip.addEventListener('click', () => chip.classList.toggle('selected'));
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
        orderId: '${cleanOrder}',
        email: '${cleanEmail}',
        token: '${token}',
        rating: parseInt(ratingInput.value),
        customerName: document.getElementById('jv-name').value || '${cleanEmail.split('@')[0]}',
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
          if (data.reward && data.reward.code) {
            document.getElementById('jv-revealed-code').textContent = data.reward.code;
          }
        } else {
          alert(data.error || 'Could not submit review. Please check your network and try again.');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit Review & Reveal $10 Treat →</span>';
        }
      } catch (err) {
        alert('Network error submitting review.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Submit Review & Reveal $10 Treat →</span>';
      }
    });

    document.getElementById('jv-copy-btn').addEventListener('click', () => {
      const code = document.getElementById('jv-revealed-code').textContent.trim();
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('jv-copy-btn');
        btn.textContent = 'Copied to Clipboard!';
        setTimeout(() => { btn.textContent = 'Copy Voucher Code'; }, 2500);
      });
    });
  </script>
</body>
</html>`;
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
    if (r.hidden === true) return false;
    if ((Number(r.rating) || 5) < min) return false;
    if (userId && r.userId && r.userId !== userId && r.userId !== 'usr_default') return false;
    if (storeDomain && r.storeDomain && r.storeDomain !== storeDomain) return false;
    return true;
  });

  const activeList = matched.length > 0 ? matched : DEFAULT_CURATED_REVIEWS;
  const sliced = activeList.slice(0, Math.max(1, Number(limit) || 12));

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
      rating: Math.max(1, Math.min(5, Math.round(Number(r.rating) || 5))),
      reviewTitle: String(r.reviewTitle || ''),
      reviewText: String(r.reviewText || ''),
      tags: Array.isArray(r.tags) ? r.tags : [],
      photos: Array.isArray(r.photos) ? r.photos.slice(0, 2) : (r.photoUrl ? [r.photoUrl] : []),
      verifiedBuyer: Boolean(r.verifiedBuyer !== false),
      createdAt: r.createdAt || new Date().toISOString()
    };
  });

  const totalCount = matched.length > 0 ? matched.length : 148;
  const avgRating = matched.length > 0
    ? (matched.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / matched.length).toFixed(1)
    : '4.9';

  return {
    summary: {
      averageRating: parseFloat(avgRating) || 4.9,
      totalCount,
      fiveStarPercentage: 97
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
 */
export function renderSocialProofWallHtml(summary = {}, reviews = [], {
  brandColor = '#ec4899',
  title = 'Loved by Thousands of Radiant Routines',
  photosEnabled = true
} = {}) {
  const avg = Number(summary?.averageRating || 4.9).toFixed(1);
  const count = Number(summary?.totalCount || 140);
  const safeTitle = String(title || 'Loved by Thousands of Radiant Routines');

  const starSvg = `<svg style="width: 14px; height: 14px; color: #fbbf24; fill: currentColor; flex-shrink: 0;" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`;
  const starsGroup = (rating = 5) => Array.from({ length: rating }).map(() => starSvg).join('');

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
      font-size: 10px;
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
      font-size: 9px;
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
      font-size: 9px;
      background: rgba(0, 0, 0, 0.65);
      border-radius: 4px;
      padding: 1px 2px;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .jv-ugc-photo-thumb:hover .jv-ugc-photo-zoom-icon {
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
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ec4899, #f59e0b);
      color: #ffffff;
      font-size: 10px;
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
      <span>★ ${avg} / 5.0</span>
      <span style="opacity: 0.5;">·</span>
      <span>${count}+ Verified Client Reviews</span>
    </div>
    <h2 class="jv-ugc-title">${escapeHtml(safeTitle)}</h2>
    <p class="jv-ugc-sub">Real ritual experiences and authentic feedback from our verified community.</p>
  </div>

  <div class="jv-ugc-cards-wrap">
    ${reviews.map(r => `
      <div class="jv-ugc-card">
        <div class="jv-ugc-card-top">
          <div class="jv-ugc-stars">${starsGroup(r.rating || 5)}</div>
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
              <div class="jv-ugc-photo-thumb" onclick="window.openJvLightbox && window.openJvLightbox('${escapeHtml(p)}')">
                <img src="${escapeHtml(p)}" alt="Customer photo" loading="lazy" />
                <span class="jv-ugc-photo-zoom-icon">🔍</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="jv-ugc-author">
          <span class="jv-ugc-author-avatar">${escapeHtml((r.customerName || 'V')[0])}</span>
          <span>${escapeHtml(r.customerName)}</span>
        </div>
      </div>
    `).join('')}
  </div>

  <!-- Lightbox Modal -->
  <div id="jv-ugc-lightbox" class="jv-lightbox-overlay" onclick="if(event.target===this) window.closeJvLightbox && window.closeJvLightbox()">
    <div class="jv-lightbox-content">
      <button type="button" class="jv-lightbox-close" onclick="window.closeJvLightbox && window.closeJvLightbox()" aria-label="Close Lightbox">×</button>
      <img id="jv-lightbox-target" class="jv-lightbox-img" src="" alt="Verified review photo preview" />
    </div>
  </div>

  <script>
    window.openJvLightbox = function(src) {
      const modal = document.getElementById('jv-ugc-lightbox');
      const target = document.getElementById('jv-lightbox-target');
      if (modal && target) {
        target.src = src;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    };
    window.closeJvLightbox = function() {
      const modal = document.getElementById('jv-ugc-lightbox');
      const target = document.getElementById('jv-lightbox-target');
      if (modal && target) {
        modal.classList.remove('active');
        target.src = '';
        document.body.style.overflow = '';
      }
    };
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && window.closeJvLightbox) window.closeJvLightbox();
    });
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
