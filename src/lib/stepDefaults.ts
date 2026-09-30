// The data a brand-new step starts with, decided in one place. The header's Add Step menu, the
// map's + Next / + Before / + Step picker and (later) code that builds a whole map all start a
// step here, so a new card never differs by the button that made it.
// A new step carries no product, price, discount code, image or claim nobody wrote. The upsell
// and thank-you cards used to arrive with a skincare product, "$38.00", "VIPOTO40" and a
// "$15 Off" bounce-back code, and a person who published without reading every field put those
// on a live page. Placeholders here name what to write, never what is true.
// An instruction ("Describe what the visitor gets.") is a placeholder too: stored as a value it
// published to customers word for word, so a field with nothing true to say starts empty and the
// editor's placeholder hint says what to write (R19). STARTER_TEXT lists the ones already saved.
// Metrics start at 0 as before: #9 decides how an unmeasured figure reads on the card.
// Pure, and only `import type`, so `node --test` loads it directly.

import type { JourneyNode, JourneyNodeData, NodeType, ThankYouNodeData } from '../types/journey';

/** The size a card is assumed to have before React Flow has measured it. */
export const STEP_SIZE = { width: 300, height: 320 } as const;

/**
 * Instructions earlier versions of these defaults, the starter map (defaultBlueprint.ts) and the
 * page editor's Add Point stored as field VALUES, lowercase. None can be anyone's real copy, so a
 * published page leaves them out (publicRoutes.mjs) and Check design names them (designChecks.ts).
 * Journeys saved before R19 still hold them. Only instructions belong here: a claim somebody could
 * have kept on purpose is theirs to remove, never ours to hide.
 */
export const STARTER_TEXT: ReadonlySet<string> = new Set([
  'describe what the visitor gets.',
  'describe the offer in words you can stand behind.',
  'describe the add-on in words you can stand behind.',
  'first point you can stand behind',
  'second point you can stand behind',
  'tell your customer what happens next.',
  'new value point'
]);

export function isStarterText(s: unknown): boolean {
  return typeof s === 'string' && STARTER_TEXT.has(s.trim().toLowerCase());
}

/** A copy value as a page publishes it: '' for a non-string, a blank or an instruction, else the value trimmed. */
export function ownCopy(v: unknown): string {
  return typeof v === 'string' && !isStarterText(v) ? v.trim() : '';
}

/** A list of copy lines as a page publishes it: written lines only, no blanks, no instructions. */
export function ownCopyList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '' && !isStarterText(s)) : [];
}

/** A short unique suffix for new ids and slugs: base-36 time plus four random characters. */
export function newStamp(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * What an upsell's countdown field holds after the person types `raw`: whole minutes from 1 to 60,
 * or undefined (no countdown) for an empty box, 0 or anything that is not a number. The field used
 * to turn each of those back into 5, so a countdown could never be removed.
 */
export function timerMinutesFromInput(raw: string): number | undefined {
  const minutes = Math.min(60, Math.floor(Number(raw)));
  return raw.trim() !== '' && Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

/** The starting data for a step of this type. The stamp makes its slug unique where it has one. */
export function newStepData(type: NodeType, stamp: string): JourneyNodeData {
  switch (type) {
    case 'ad-source':
      return {
        type: 'ad-source',
        label: 'New Ad Campaign',
        platform: 'meta',
        // Empty like the starter ad (defaultBlueprint.ts): 'Your ad headline' read as the ad's own
        // words, and a button label and campaign tag are the person's to choose (U04).
        headline: '',
        body: '',
        ctaText: '',
        utmCampaign: '',
        impressions: 0,
        clicks: 0,
        ctr: 0,
        spend: 0
      };
    case 'landing-page':
      return {
        type: 'landing-page',
        label: 'Promotion Landing Page',
        slug: `offer-${stamp}`,
        // No headline, and the starter page's neutral button: 'Claim Offer' named an offer nobody set (U04).
        headline: '',
        subhead: '',
        bullets: [],
        trustBadge: '',
        buttonText: 'Continue',
        visitors: 0,
        conversions: 0,
        conversionRate: 0
      };
    case 'lead-form':
      return {
        type: 'lead-form',
        label: 'Consultation Form',
        // The same neutral words as the starter map (defaultBlueprint.ts): a new form confirms no
        // reservation and promises no email nobody set up.
        formTitle: 'Where should we reach you?',
        submitButtonText: 'Submit',
        successMessage: 'Thanks. We have your details.',
        fields: [
          { id: 'f_name', label: 'Full Name', type: 'text', required: true, enabled: true, placeholder: 'Alex Smith' },
          { id: 'f_email', label: 'Email Address', type: 'email', required: true, enabled: true, placeholder: 'alex@example.com' },
          { id: 'f_phone', label: 'Phone Number', type: 'tel', required: true, enabled: true, placeholder: '(555) 123-4567' }
        ],
        views: 0,
        submissions: 0,
        completionRate: 0
      };
    case 'follow-up-sequence':
      return {
        type: 'follow-up-sequence',
        label: 'Client Welcome Flow',
        sequenceTitle: 'Automated Follow-Up',
        contactsEnrolled: 0,
        avgOpenRate: 0,
        avgClickRate: 0,
        steps: [
          {
            id: 'step-1',
            channel: 'email',
            delay: 'Instant (0m)',
            // Empty: the old default promised a "VIP welcome guide" that does not exist, and the
            // drafts after it ("Write this subject") sat in the letter as its words. The editor's
            // hints say what to write and Check design asks for each part (U04).
            subject: '',
            previewText: '',
            body: ''
          }
        ]
      };
    case 'thank-you':
      return {
        type: 'thank-you',
        label: 'Thank-you page',
        slug: 'thank-you',
        // The subhead starts empty, so the page shows its own line until one is written. A prompt
        // here ("Tell your customer what happens next.") would publish to customers as it is.
        headline: 'Thank you',
        subhead: '',
        badgeText: '',
        bounceBackDiscountCode: '',
        bounceBackDiscountText: '',
        usageGuideTitle: '',
        usageGuideSteps: [],
        storeReturnText: '',
        communityInviteText: '',
        pageViews: 0,
        bounceBackClaims: 0
      };
    case 'upsell':
      return {
        type: 'upsell',
        label: 'Post-Purchase Upsell (OTO)',
        offerType: 'upsell',
        // Empty, so the card reads 'No headline yet' and Check design asks for one. The old
        // 'Your offer headline' drew on the card as if it were the offer's own words (R20).
        headline: '',
        subhead: '',
        badgeText: '',
        // No urgencyMinutes: a countdown is a claim, so a new upsell has none until the person sets one.
        productTitle: '',
        productPrice: '',
        regularPrice: '',
        discountPercentage: 0,
        discountCode: '',
        productImage: '',
        benefits: [],
        acceptButtonText: 'Yes, add this to my order',
        declineButtonText: 'No thanks',
        views: 0,
        takes: 0,
        conversionRate: 0,
        attributedRevenue: 0
      };
    case 'ab-split':
      return {
        type: 'ab-split',
        label: 'A/B Traffic Splitter',
        slug: `split-${stamp}`,
        splitRatio: 50,
        goal: 'conversion_rate',
        branchALabel: 'Branch A (Control)',
        branchBLabel: 'Branch B (Challenger)',
        branchAVisitors: 0,
        branchAConversions: 0,
        branchAGrossRevenue: 0,
        branchBVisitors: 0,
        branchBConversions: 0,
        branchBGrossRevenue: 0
      };
  }
}

/**
 * A whole new step at a position. `patch` overrides fields of the starting data (a downsell or a
 * recovery preset from the picker); the step's type never changes.
 */
export function makeStep(
  type: NodeType,
  position: { x: number; y: number },
  stamp: string,
  patch?: Partial<JourneyNodeData> | Record<string, unknown>
): JourneyNode {
  const data = { ...newStepData(type, stamp), ...(patch ?? {}), type } as JourneyNodeData;
  return { id: `node-${type}-${stamp}`, type, position: { x: position.x, y: position.y }, data };
}

/** What a published thank-you page shows for a thank-you step, part by part. */
export interface ThankYouView {
  badge: string;
  headline: string;
  /** '' when the step has no written subhead: the page then shows no subhead line. */
  subhead: string;
  /** The next-order code block, only with a code. */
  voucher: { title: string; code: string } | null;
  /** The guide, only with at least one written line. Its title only when written. */
  guide: { title: string; steps: string[] } | null;
  /** The store button, only with a store link or a connected store. */
  store: { text: string; url: string } | null;
  /** The community button, only with a community link. */
  community: { text: string; url: string } | null;
}

/**
 * The thank-you page as renderPublicThankYouHtml (server/routes/publicRoutes.mjs) publishes it:
 * the same fallbacks and the same "only when" rules, read from the step's own fields. The editor's
 * Live Customer View draws this, so it never shows a button, a code or a line the live page will
 * not have. storeDomain is the workspace's connected store ('' when none). add-step.test.mjs renders
 * the real page beside it.
 */
export function thankYouView(data: Partial<ThankYouNodeData>, storeDomain = ''): ThankYouView {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const code = text(data.bounceBackDiscountCode);
  const steps = Array.isArray(data.usageGuideSteps) ? data.usageGuideSteps.filter(s => typeof s === 'string' && s) : [];
  const domain = storeDomain.trim().toLowerCase();
  const storeUrl = text(data.storeReturnUrl) || (domain ? `https://${domain}` : '');
  const communityUrl = text(data.communityInviteUrl);
  return {
    badge: text(data.badgeText),
    headline: text(data.headline) || 'Thank you',
    // No stock line: the step also ends lead-only journeys, where an order claim is invented (R17).
    subhead: ownCopy(data.subhead),
    voucher: code ? { title: text(data.bounceBackDiscountText) || code, code } : null,
    guide: steps.length ? { title: text(data.usageGuideTitle), steps } : null,
    store: storeUrl ? { text: text(data.storeReturnText) || 'Back to the store', url: storeUrl } : null,
    community: communityUrl ? { text: text(data.communityInviteText) || 'Open the link', url: communityUrl } : null
  };
}

/**
 * The headline and subhead Test Lead Flow shows for a thank-you step: the live page's own lines
 * (thankYouView), trimmed, with the parts the page fills with its default named so the walk can say
 * so. Only the headline has a default ('Thank you'); a blank subhead publishes no line at all.
 * '' means the live page shows no such line.
 */
export function thankYouWalkLines(data: Partial<ThankYouNodeData>): {
  headline: string;
  subhead: string;
  defaults: Array<'headline'>;
} {
  const view = thankYouView(data);
  const own = (v: unknown) => typeof v === 'string' && v !== '';
  const defaults: Array<'headline'> = [];
  if (!own(data.headline)) defaults.push('headline');
  return { headline: view.headline.trim(), subhead: view.subhead.trim(), defaults };
}
