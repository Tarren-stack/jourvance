/**
 * server/seededOffers.mjs
 *
 * Offers the server once wrote for the merchant (C18, R24). The drip seeds carried SAVE10,
 * WELCOMEBACK15 and REVIEW10 with 10%, 15% and $10 promises, and the fulfillment webhook stamped
 * REVIEW10 on every review enrolment, none of them a code the merchant chose. The seeds now carry
 * no code; this cleans a stored, unedited copy of an old seed and reads the code a merchant did set.
 * The signup form presets did the same with WELCOME15, SANCTUARY, FREESHIP and WELCOME10 (T13).
 */

import { SEEDED_SIGNUP_FORMS } from '../src/lib/offerPresets.ts';

// Each seeded step that once named an offer: the code it carried and phrases only the old seed's
// words hold. A step whose code or words the merchant changed is theirs and is left alone.
export const SEEDED_OFFER_STEPS = [
  { seqId: 'drip_seq_cart_recovery', stepId: 'cart_step_2', code: 'SAVE10', markers: ['code SAVE10', 'private 10% courtesy voucher'] },
  { seqId: 'drip_seq_upsell_recovery', stepId: 'upsell_rec_step_1', code: 'SAVE10', markers: ['code SAVE10', 'private 10% courtesy voucher'] },
  { seqId: 'drip_seq_at_risk_winback', stepId: 'winback_step_1', code: 'WELCOMEBACK15', markers: ['special 15% courtesy reward'] },
  { seqId: 'drip_seq_review_request', stepId: 'review_step_1', code: 'REVIEW10', markers: ['instantly gift you $10'] },
  { seqId: 'drip_seq_review_request', stepId: 'review_step_2', code: 'REVIEW10', markers: ['private $10 courtesy gift'] }
];

// The old seed descriptions that promised the offer, replaced only while they are word for word.
export const SEEDED_OFFER_DESCRIPTIONS = {
  drip_seq_at_risk_winback: 'Automatically re-engages clients who reach the at-risk inactivity threshold (90 days since last purchase) with a gentle check-in and 15% courtesy treat.',
  drip_seq_review_request: 'Invites verified buyers 7 days after fulfillment to share their ritual feedback in exchange for a complimentary $10 courtesy gift voucher (REVIEW10).'
};

// An earlier R24 winback seed was a "Replace this note" draft. Auto-winback sends that step with no
// one reading it first, so a stored copy of that draft, word for word, takes the finished seed too.
export const SEEDED_DRAFT_STEPS = [
  {
    seqId: 'drip_seq_at_risk_winback',
    stepId: 'winback_step_1',
    body: 'Hello {{first_name}},\n\nWe noticed it has been a little while since your last order, and we wanted to check in.\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.'
  }
];

// Seed words that named a product category or claimed the cart was held (T13). A stored field still
// in these words, word for word, takes the current seed's; one the merchant changed is theirs.
export const SEEDED_WORDING = [
  { seqId: 'drip_seq_cart_recovery', stepId: 'cart_step_1', field: 'subject', old: 'We saved your beauty essentials' },
  {
    seqId: 'drip_seq_cart_recovery',
    stepId: 'cart_step_1',
    field: 'body',
    old: 'Hi {{first_name}},\n\nWe noticed you didn’t get a chance to finish your order. Your selected items have been carefully saved so you can pick right back up where you left off.\n\nReturn to your checkout here:\n{{abandoned_checkout_url}}'
  },
  { seqId: 'drip_seq_upsell_recovery', stepId: 'upsell_rec_step_1', field: 'previewText', old: 'In case you still wanted to complete your ritual' },
  {
    seqId: 'drip_seq_upsell_recovery',
    stepId: 'upsell_rec_step_1',
    field: 'body',
    old: 'Hey {{first_name}},\n\nThank you again for your order {{order_number}}. We are already preparing everything for you.\n\nWhen you checked out, you skipped the upgrade offer. In case you still wanted to add it to your routine, you can review the offer here:\n{{offer_url}}\n\nNo pressure at all, we simply wanted to make sure you had the option before your order ships.\n\nWarmly,\nThe Jourvance Team'
  }
];

export const SEEDED_DRAFT_DESCRIPTIONS = {
  drip_seq_at_risk_winback: 'Checks in with clients who reach the at-risk inactivity threshold (90 days since last purchase). Replace the note before anyone receives it.'
};

/**
 * Gives each stored step that is still an old offer seed the current seed's words and no code, and
 * takes that code off the sequence's active enrolments once no step of it names the code any more.
 * Returns true when anything changed.
 */
export function stripSeededOffers(data, seeds) {
  let changed = false;
  const sequences = Array.isArray(data?.sequences) ? data.sequences : [];
  const cleared = new Map();
  for (const { seqId, stepId, code, markers } of SEEDED_OFFER_STEPS) {
    const seq = sequences.find(s => s.id === seqId);
    const step = (seq?.steps || []).find(st => st.id === stepId);
    const seed = (seeds || []).find(s => s.id === seqId)?.steps.find(st => st.id === stepId);
    if (!step || !seed || step.discountVoucher !== code) continue;
    const body = String(step.body || '');
    if (!markers.some(m => body.includes(m))) continue;
    Object.assign(step, { subject: seed.subject, previewText: seed.previewText, body: seed.body, discountVoucher: '' });
    cleared.set(seqId, code);
    changed = true;
  }
  for (const { seqId, stepId, body } of SEEDED_DRAFT_STEPS) {
    const step = (sequences.find(s => s.id === seqId)?.steps || []).find(st => st.id === stepId);
    const seed = (seeds || []).find(s => s.id === seqId)?.steps.find(st => st.id === stepId);
    if (!step || !seed || step.body !== body || seed.body === body) continue;
    step.body = seed.body;
    changed = true;
  }
  for (const { seqId, stepId, field, old } of SEEDED_WORDING) {
    const step = (sequences.find(s => s.id === seqId)?.steps || []).find(st => st.id === stepId);
    const seed = (seeds || []).find(s => s.id === seqId)?.steps.find(st => st.id === stepId);
    if (!step || !seed || step[field] !== old || seed[field] === old) continue;
    step[field] = seed[field];
    changed = true;
  }
  for (const [seqId, oldDescription] of [...Object.entries(SEEDED_OFFER_DESCRIPTIONS), ...Object.entries(SEEDED_DRAFT_DESCRIPTIONS)]) {
    const seq = sequences.find(s => s.id === seqId);
    const seed = (seeds || []).find(s => s.id === seqId);
    if (seq && seed && seq.description === oldDescription && seed.description !== oldDescription) {
      seq.description = seed.description;
      changed = true;
    }
  }
  for (const [seqId, code] of cleared) {
    const seq = sequences.find(s => s.id === seqId);
    if ((seq?.steps || []).some(st => st.discountVoucher === code)) continue;
    for (const enr of Array.isArray(data.enrollments) ? data.enrollments : []) {
      if (enr.sequenceId === seqId && enr.status === 'active' && enr.discountCode === code) enr.discountCode = '';
    }
  }
  return changed;
}

/** The code the merchant put on their review request sequence, or '' when they set none. */
export function merchantReviewCode(dripsData) {
  const seq = (dripsData?.sequences || []).find(s => s.id === 'drip_seq_review_request' || s.triggerType === 'fulfillment_review');
  const step = (seq?.steps || []).find(st => String(st.discountVoucher || '').trim());
  return step ? String(step.discountVoucher).trim() : '';
}

// The referral links the review portal shares carry ?ref=GIVE15-<name>-<hash> and ?coupon=GIVE15.
// The server used to create GIVE15 ($15 off) in every connected store; it no longer makes any code
// (R24), so a page offers GIVE15 only while the merchant has defined it for that store.
export const REFERRAL_CODE = 'GIVE15';

/** True when a ref or coupon value is one of the referral links. */
export function isReferralLink(ref, coupon = '') {
  return String(ref || '').trim().toUpperCase().startsWith(REFERRAL_CODE) ||
    String(coupon || '').trim().toUpperCase() === REFERRAL_CODE;
}

/**
 * The merchant's own GIVE15 rule for this store, or null. A rule saved for another store does not
 * count; a rule saved before rules recorded their store is read as the merchant's.
 */
export function definedReferralRule(discounts, storeDomain) {
  const domain = String(storeDomain || '').trim().toLowerCase();
  if (!domain) return null;
  return (Array.isArray(discounts) ? discounts : []).find(d =>
    String(d?.code || '').trim().toUpperCase() === REFERRAL_CODE &&
    (d.status || 'active') === 'active' &&
    Number(d.value) > 0 &&
    (!d.storeDomain || String(d.storeDomain).trim().toLowerCase() === domain)
  ) || null;
}

/** "15% off" or "$15.00 off" from the merchant's rule; '' when the amount cannot be stated. */
export function referralAmountText(rule, currency = '') {
  const value = Number(rule?.value);
  if (!(value > 0)) return '';
  if (rule.discountType === 'percentage') return `${value}% off`;
  const code = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return '';
  try {
    return `${new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value)} off`;
  } catch {
    return '';
  }
}

// The words an editor shows the merchant. The teasers were saved by every preset and the + button
// but no editor ever had a field for them, so a teaser still in the preset's words says nothing about
// whether the merchant made the form their own.
const SIGNUP_EDITABLE_FIELDS = ['headline', 'body', 'buttonText', 'successMessage'];
const SIGNUP_COPY_FIELDS = [...SIGNUP_EDITABLE_FIELDS, 'teaser', 'teaserClosed'];

/**
 * The old preset a stored signup form still is, or null. It is one when its success coupon is the
 * preset's own (the same code, percentage and amount, no prefix) and every word the editor shows is
 * still that preset's, word for word: that code was the preset's, not the merchant's (T13). A form
 * whose copy or coupon the merchant changed in any way keeps its code, since a page they rewrote
 * around that code (say "Get 10% off") would otherwise promise a discount and hand out none.
 */
export function seededSignupForm(form) {
  const coupon = form?.coupon;
  const name = String(coupon?.name || '').trim();
  if (!name || String(coupon.prefix || '')) return null;
  return SEEDED_SIGNUP_FORMS.find(seed =>
    seed.code === name &&
    (coupon.discountType || 'percentage') === 'percentage' &&
    Number(coupon.value) === seed.value &&
    SIGNUP_EDITABLE_FIELDS.every(field => String(form?.[field] ?? '') === seed.words[field])
  ) || null;
}

/**
 * A stored signup form with an old preset's code taken off and each field still in that preset's
 * words given the current starter's, so the page no longer promises what no code delivers. Returns
 * the form itself when it is not an old preset, and a new object when it is.
 */
export function stripSeededSignupForm(form) {
  const seed = seededSignupForm(form);
  if (!seed) return form;
  const next = { ...form, coupon: null };
  for (const field of SIGNUP_COPY_FIELDS) {
    if (String(form[field] ?? '') === seed.words[field]) next[field] = seed.replacement[field];
  }
  return next;
}

/**
 * The signup forms a merchant has, as every reader gets them: each stored row cleaned by `clean`,
 * the ones it refuses dropped, an old preset read as its current starter (above), at most 20.
 * server.mjs signupFormsFor is the only reader of the stored rows and goes through this, so the
 * editor, the live page and the lead route all see the same forms.
 */
export function readSignupForms(rows, clean) {
  return (Array.isArray(rows) ? rows : []).map((row) => clean(row)).filter((row) => row && !row.error).map(stripSeededSignupForm).slice(0, 20);
}
