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
    photoUrl: String(photoUrl || '').slice(0, 500),
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
        tags: selectedTags
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
