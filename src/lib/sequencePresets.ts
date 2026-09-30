import type { SequenceNodeData, SequenceStep } from '../types/journey';

// The "Pre-built Sequence Blueprints" buttons in the sequence editor. A preset sets the structure
// (how many emails, their timing, the retention flags) and writes "Replace this" drafts, never
// finished copy: the old presets promised a $10 gift, 10% and 15% credits, a "clinical team" and
// voucher codes (REVIEW10, SAVE10, WELCOMEBACK15, COMPLETE10) the person's store may not have (C46).
// The words, and any discount, are the person's to write. No voucher code is ever filled in.
// The sequence titles are the builder's own labels on the map and are never sent.

export type SequencePresetType = 'vip-welcome' | 'cart-recovery' | 'upsell-recovery' | 'winback' | 'review-request';

export const PRESET_DRAFT_SUBJECT = 'Write this subject';
export const PRESET_DRAFT_PREVIEW = 'Replace this before anyone receives it';

const draftBody = (what: string, link?: string, hint = 'Mention a discount only if the code exists in your store.') =>
  `Hi [First Name],\n\nReplace this note with ${what} before anyone receives it. ${hint}\n\n${link ? `${link}\n\n` : ''}The Team`;

const draft = (id: string, delay: string, what: string, link?: string, hint?: string): SequenceStep => ({
  id,
  channel: 'email',
  delay,
  subject: PRESET_DRAFT_SUBJECT,
  previewText: PRESET_DRAFT_PREVIEW,
  body: draftBody(what, link, hint)
});

/** The fields a preset sets on the sequence. It never sets voucherCode, so the person's own code (or none) stays. */
export function sequencePreset(type: SequencePresetType, stamp: number = Date.now()): Partial<SequenceNodeData> {
  const id = (n: number) => `step-${stamp}-${n}`;
  if (type === 'review-request') {
    return {
      sequenceTitle: 'Post-Purchase Review & Social Proof Engine',
      sequenceType: 'fulfillment_review',
      isRetentionBranch: true,
      delayHours: 168,
      smartExitOnPurchase: false,
      steps: [
        draft(id(1), '7 Days (168h)', 'your request for a review of their order', '[Review Link]'),
        draft(id(2), '3 Days (72h)', 'a short reminder about the review request', '[Review Link]')
      ]
    };
  }
  if (type === 'upsell-recovery') {
    return {
      sequenceTitle: '24h Courtesy Rescue (Upsell Decline)',
      sequenceType: 'upsell_recovery',
      isRetentionBranch: true,
      delayHours: 18,
      smartExitOnPurchase: true,
      steps: [
        draft(id(1), '18 Hours', 'what you want to say about the offer they passed on', '[Offer Link]'),
        draft(id(2), '36 Hours', 'a last reminder about that offer', '[Offer Link]', 'Name a deadline or a discount only if it is real.')
      ]
    };
  }
  if (type === 'winback') {
    return {
      sequenceTitle: 'VIP Winback & Re-Engagement',
      sequenceType: 'at_risk_winback',
      isRetentionBranch: true,
      delayHours: 72,
      smartExitOnPurchase: true,
      steps: [draft(id(1), '72 Hours', 'your invitation for a past customer to come back', '[Offer Link]')]
    };
  }
  if (type === 'vip-welcome') {
    return {
      sequenceTitle: 'VIP Welcome Sequence',
      sequenceType: 'lead_nurture',
      isRetentionBranch: false,
      steps: [
        draft(id(1), 'Instant (0m)', 'your welcome message'),
        draft(id(2), '24 Hours', 'something useful about your offer'),
        draft(id(3), '48 Hours', 'an invitation to reply with any questions')
      ]
    };
  }
  return {
    sequenceTitle: 'Abandoned Checkout Recovery',
    sequenceType: 'checkout_recovery',
    isRetentionBranch: true,
    delayHours: 1,
    smartExitOnPurchase: true,
    steps: [
      draft(id(1), '1 Hour', 'a reminder that their checkout is not finished', '[Checkout Link]'),
      draft(id(2), '24 Hours', 'a second reminder about their checkout', '[Checkout Link]')
    ]
  };
}

/**
 * Puts the person's voucher code where a letter says [Voucher Code]. With no code set, the token
 * stays visible in the preview and the exports, so the gap is seen and fixed rather than filled
 * with a code the store may not have (the old fallback wrote SAVE10).
 */
export function fillVoucherCode(text: string, code: string | undefined): string {
  const c = (code || '').trim();
  return c ? text.replace(/\[Voucher Code\]/g, c) : text;
}
