// What the page's button says after a product is picked or synced. The editor used to write
// 'Claim 15% VIP Voucher' over whatever the user had typed: a discount nobody set, on a button the
// user had already worded. Now the user's own words always stay, and the editor only fills a label
// it wrote itself (or an empty one) with something it can stand behind: the product's real price.
// Pure, with no imports, so Node tests can load it without a bundler.

// The labels the editor itself has written into the field: the old lead-gate label, the price
// label journeys saved before the backlog carry ('Buy Now', an em dash, then the price), and the
// current 'Buy now for <price>'. Only a price may follow the prefix, so 'Buy now for the holidays'
// is the user's own words. Empty or one of those is ours to replace; anything else is the user's.
const EDITOR_FILLED_LABELS = new Set(['Claim 15% VIP Voucher']);
const PRICE = String.raw`[^\s\d]{0,3}\s?\d[\d.,]*(?:\s?[A-Z]{3})?`;
const EDITOR_PRICE_LABEL = new RegExp(String.raw`^(?:Buy now for\s+|Buy Now\s*[\u2014\u2013-]\s*)` + PRICE + '$');

export function isEditorFilledButtonText(text: string | undefined | null): boolean {
  const t = String(text ?? '').trim();
  return !t || EDITOR_FILLED_LABELS.has(t) || EDITOR_PRICE_LABEL.test(t);
}

export function buttonTextForProduct(
  current: string | undefined,
  checkoutMode: string | undefined,
  price: string | number | undefined | null
): string {
  if (!isEditorFilledButtonText(current)) return current as string;
  // A lead gate asks for an email before checkout, and no offer is known here, so none is named:
  // the field stays empty with its placeholder and the published page shows 'Continue'.
  if (checkoutMode === 'lead-gate') return '';
  const p = String(price ?? '').trim();
  return p ? `Buy now for ${p}` : '';
}
