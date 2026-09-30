// The starter words behind the SMS composer's draft buttons and the signup form presets, and the
// old ones a stored form may still carry. The old SMS drafts named WELCOMEBACK15, 15% and 10% off
// and a free gift; the old signup presets saved WELCOME15, SANCTUARY, FREESHIP (as 10% off, under a
// free shipping headline) and WELCOME10 on the form, so every visitor who signed up had a code of
// that name minted in the merchant's store, and their copy promised samples, gifts, "VIP member
// privileges" and skincare the merchant never offered (T13).
// A starter sets the format and the trigger and says only what is true of any store: someone is
// joining a list. It carries no code, amount, gift, shipping offer or product category. A code
// appears only when the merchant types one, and only that code is ever minted.
// Pure data with no imports, so server/seededOffers.mjs and `node --test` load it directly.

export type SmsStarterId = 'winback' | 'vip' | 'cart';

export const SMS_STARTERS: { id: SmsStarterId; label: string; text: string }[] = [
  { id: 'winback', label: 'Winback check-in', text: 'Hi {{first_name}}, it has been a while since your last order and we wanted to say hello.' },
  { id: 'vip', label: 'Thank a top customer', text: 'Hi {{first_name}}, thank you for being one of our best customers.' },
  { id: 'cart', label: 'Cart reminder', text: 'Hi {{first_name}}, you left something in your cart. Finish your order whenever you are ready.' }
];

/** A starter text, with the merchant's own code added only when they typed one. */
export function smsStarterText(id: SmsStarterId, discountCode = ''): string {
  const base = SMS_STARTERS.find((row) => row.id === id)?.text || '';
  const code = String(discountCode || '').trim();
  return code ? `${base} Use code ${code} at checkout.` : base;
}

export interface SignupPreset {
  /** The form the preset makes, as the merchant sees it in the list. */
  name: string;
  /** What the preset card says the preset does. */
  summary: string;
  type: 'popup' | 'bar' | 'embed' | 'flyout' | 'page';
  headline: string;
  body: string;
  buttonText: string;
  successMessage: string;
  teaser: string;
  teaserClosed: string;
  delaySeconds: number;
  rules: {
    exit: boolean;
    scrollPercent: number;
    device: 'any';
    hideSubmitted: boolean;
    showAgainDays: number;
    urlContains: string;
    utmKey: string;
    utmValue: string;
  };
}

const rules = (exit: boolean, scrollPercent: number, showAgainDays: number): SignupPreset['rules'] => ({
  exit, scrollPercent, device: 'any', hideSubmitted: true, showAgainDays, urlContains: '', utmKey: '', utmValue: ''
});

/** The copy every starter shares. The headline differs so the three read apart in the list. */
const LIST_COPY = {
  body: 'Join our email list to hear from us.',
  buttonText: 'Sign up',
  successMessage: 'Thanks for signing up.',
  teaser: 'Join our email list',
  teaserClosed: 'Sign up'
};

export const SIGNUP_PRESETS: SignupPreset[] = [
  { name: 'Exit-intent popup', summary: 'Opens when a visitor moves to leave', type: 'popup', headline: 'Before you go', ...LIST_COPY, delaySeconds: 5, rules: rules(true, 0, 7) },
  { name: 'Scroll flyout', summary: 'Slides in once a visitor scrolls down the page', type: 'flyout', headline: 'Stay in touch', ...LIST_COPY, delaySeconds: 8, rules: rules(false, 35, 14) },
  { name: 'Top bar', summary: 'A slim bar across the top of the page', type: 'bar', headline: 'Join our email list', ...LIST_COPY, delaySeconds: 2, rules: rules(false, 0, 3) }
];

/** The copy a form made with the + buttons starts with. */
export const NEW_FORM_COPY = { headline: 'Join our email list', ...LIST_COPY };

/**
 * The presets and the + button default as they were saved before T13, each with the coupon it put
 * on the form (always a percentage) and the preset whose words replace its own. A stored form that
 * still has that coupon and all four of the words an editor shows (headline, body, button, success
 * message), word for word, is the old seed: its code is not the merchant's. The teasers are not
 * part of that test, because no editor ever showed them, so every preset form still has them.
 */
export const SEEDED_SIGNUP_FORMS: {
  code: string;
  value: number;
  replacement: typeof NEW_FORM_COPY;
  words: { headline: string; body: string; buttonText: string; successMessage: string; teaser: string; teaserClosed: string };
}[] = [
  {
    code: 'WELCOME15',
    value: 15,
    replacement: SIGNUP_PRESETS[0],
    words: {
      headline: 'Claim Your 15% Welcome Ritual',
      body: 'Join our private botanical community to receive 15% off your first order, complimentary samples, and early access to limited seasonal formulations.',
      buttonText: 'Unlock My 15% Gift',
      successMessage: 'Your 15% courtesy code is unlocked below. Welcome to the ritual.',
      teaser: '15% Off Your First Order',
      teaserClosed: 'Unlock 15% Off'
    }
  },
  {
    code: 'SANCTUARY',
    value: 10,
    replacement: SIGNUP_PRESETS[1],
    words: {
      headline: 'Private VIP Sanctuary Access',
      body: 'Be the first to experience small-batch drops, private skincare masterclasses, and secret subscriber-only archival sales.',
      buttonText: 'Enter The Sanctuary',
      successMessage: 'Welcome to the Sanctuary. Your VIP member privileges are now active.',
      teaser: 'VIP Private Access',
      teaserClosed: 'VIP Access'
    }
  },
  {
    code: 'FREESHIP',
    value: 10,
    replacement: SIGNUP_PRESETS[2],
    words: {
      headline: 'Complimentary Express Shipping on Orders $50+',
      body: 'Subscribe today to unlock free priority delivery and a complimentary botanical travel bag with your first order.',
      buttonText: 'Unlock Free Delivery',
      successMessage: 'Free shipping voucher unlocked! Use code FREESHIP at checkout.',
      teaser: 'Free Express Delivery Available',
      teaserClosed: 'Free Shipping Voucher'
    }
  },
  {
    code: 'WELCOME10',
    value: 10,
    replacement: NEW_FORM_COPY,
    words: {
      headline: 'Join Our Private Community',
      body: 'Subscribe to receive exclusive beauty perks, seasonal formula previews, and surprise gifts.',
      buttonText: 'Claim My Gift',
      successMessage: 'Welcome to our community! Your coupon is unlocked below.',
      teaser: 'Special Gift Inside',
      teaserClosed: 'Unlock Offer'
    }
  }
];
