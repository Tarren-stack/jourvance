// What the page editor's Preview tab may show: the words the published page shows, worked out the
// way renderPublicFunnelHtml (server/routes/publicRoutes.mjs) works them out, and nothing else.
// The preview used to fill every empty field with copy of its own ("EXCLUSIVE OFFER", "Clear,
// concise subheadline addressing customer pain.", "One-Time Upgrade") and listed instructions
// saved as values ("New value point") as benefits, so it showed a page nobody would ever see
// (R19, T12). Where the page shows nothing, the editor shows a muted hint instead, never copy.
// Pure, with type-only imports or .ts-suffixed ones, so Node tests can load it without a bundler.

import type { PageNodeData, PageVariantData } from '../types/journey';
import { ownCopy, ownCopyList } from './stepDefaults.ts';
import { DEMO_VARIANT_IDS } from './productPickerCatalog.ts';

/** What Add Point stores: an empty benefit. The field's placeholder says what to write. */
export const NEW_BENEFIT = '';
export const BENEFIT_HINT = 'A benefit you can stand behind';

// The page's own fallbacks, word for word from renderPublicFunnelHtml. Each is what a visitor
// reads when the field is empty, so a field's placeholder may say it too.
export const HEADLINE_FALLBACK = 'Offer';
export const BUTTON_FALLBACK = 'Continue';
export const URGENCY_FALLBACK = 'This offer timer runs for';
export const BUMP_HEADLINE_FALLBACK = 'Add this to the order';
export const BUMP_TITLE_FALLBACK = 'Add-on';
/** The review wall's heading when the merchant wrote none: it names the section and claims nothing. */
export const SOCIAL_PROOF_FALLBACK = 'Customer reviews';

// Seeded lines the page drops (publicRoutes.mjs trustBadge and scarcitySeed).
const SEEDED_TRUST = /4\.9\/5|verified (beauty lovers|customers|buyers|clients)/i;
const SEEDED_SCARCITY = /hand-blended batch #22|only 14 units remaining/i;

// A variant id the page will send to checkout: saved, and not one of the placeholder ids the
// server's realVariantId() refuses (FAKE_VARIANT_IDS, the same list as DEMO_VARIANT_IDS). Compared
// the way the server compares it, trimmed and nothing more, so the two never disagree.
function realVariant(id: unknown): string {
  const value = String(id || '').trim();
  return value && !DEMO_VARIANT_IDS.has(value) ? value : '';
}

export interface PreviewBump {
  headline: string;
  description: string;
  title: string;
  price: string;
}

export interface PreviewCopy {
  headline: string;
  /** '' when the page shows no subheadline. */
  subhead: string;
  bullets: string[];
  buttonText: string;
  /** '' when the page names no code. */
  discountCode: string;
  trustBadge: string;
  /** The countdown bar, or null when the page shows none. */
  urgency: { text: string; minutes: number } | null;
  /** '' when the page shows no stock line. */
  scarcity: string;
  /** The add-on card, or null when the page shows none. */
  bump: PreviewBump | null;
  /** The add-on is switched on but the page leaves it out: it has no store product yet. */
  bumpNeedsProduct: boolean;
  /**
   * The price tag on the hero image, or '' when the page shows none. A product picked with a
   * placeholder variant (an old blueprint id, or the sample catalog) has an invented price, so the
   * page drops it, and saved journeys still carry such picks (R14, T12).
   */
  productPrice: string;
  /** The hero image, or '' when the page has none. A placeholder product's image is not used. */
  heroImage: string;
}

/**
 * The page's words for version A, or version B when `variantB` is passed, as the published page
 * shows them.
 */
export function previewPageCopy(data: PageNodeData, variantB?: PageVariantData | null): PreviewCopy {
  const vB: PageVariantData = variantB || {};
  const bBullets = ownCopyList(vB.bullets);

  const minutesRaw = Number(data.urgencyMinutes);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 0;

  const scarcitySaved = String(data.scarcityBatchText || '').trim();
  const seeded = SEEDED_SCARCITY.test(scarcitySaved);
  const count = Number(data.scarcityBatchCount);
  const countSet = data.scarcityBatchCount !== undefined && data.scarcityBatchCount !== null &&
    String(data.scarcityBatchCount) !== '' && Number.isFinite(count) && count > 0;
  const scarcityText = scarcitySaved && !seeded
    ? scarcitySaved
    : (countSet && !seeded ? `Limited batch: ${count} units remaining` : '');

  const bumpVariant = String(data.orderBumpVariantId || '').trim();
  const bumpOn = data.orderBumpEnabled === true;
  const bumpShown = bumpOn && realVariant(bumpVariant) !== '';

  // renderPublicFunnelHtml's placeholderProduct: a variant id is saved but it is not a real one.
  const placeholderProduct = String(data.shopifyVariantId || '').trim() !== '' && !realVariant(data.shopifyVariantId);

  const trust = vB.trustBadge || data.trustBadge || '';

  return {
    headline: vB.headline || data.headline || HEADLINE_FALLBACK,
    subhead: ownCopy(vB.subhead) || ownCopy(data.subhead),
    bullets: bBullets.length ? bBullets : ownCopyList(data.bullets),
    buttonText: vB.buttonText || data.buttonText || BUTTON_FALLBACK,
    discountCode: (vB.discountCode !== undefined ? vB.discountCode : data.discountCode) || '',
    trustBadge: SEEDED_TRUST.test(trust) ? '' : trust,
    urgency: data.urgencyTimerEnabled && minutes > 0
      ? { text: data.urgencyText || URGENCY_FALLBACK, minutes }
      : null,
    scarcity: data.scarcityBatchEnabled ? scarcityText : '',
    bump: bumpShown
      ? {
          headline: data.orderBumpHeadline || BUMP_HEADLINE_FALLBACK,
          description: data.orderBumpDescription || '',
          title: data.orderBumpTitle || BUMP_TITLE_FALLBACK,
          price: data.orderBumpPrice || ''
        }
      : null,
    bumpNeedsProduct: bumpOn && !bumpShown,
    productPrice: placeholderProduct ? '' : String(data.shopifyProductPrice || ''),
    heroImage: (!placeholderProduct && data.shopifyProductImage) || vB.heroImageUrl || data.heroImageUrl || ''
  };
}
