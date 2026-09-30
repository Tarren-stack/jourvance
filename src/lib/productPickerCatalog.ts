import type { ShopifyProduct } from '../types/journey';

// Variant ids that belong to no merchant: the old blueprint placeholders and every variant of the
// sample catalog the product picker used to offer, which saved journeys may still carry. A page
// carrying one must never become a checkout link, and the server publishes no product title, price
// or image picked with one. The server keeps the same list as FAKE_VARIANT_IDS in
// server/routes/authWorkspaceRoutes.mjs, and product-picker-catalog.test.mjs holds the two in step.
export const DEMO_VARIANT_IDS: ReadonlySet<string> = new Set([
  '42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999',
  '42109840101', '42109840102', '42109840201', '42109840202', '42109840301', '42109840302',
  '42109840401', '42109840501', '42109840502'
]);

export function isDemoVariantId(id: string | undefined | null): boolean {
  const clean = String(id || '').trim().replace(/^gid:\/\/shopify\/ProductVariant\//, '');
  return DEMO_VARIANT_IDS.has(clean);
}

export const PRODUCTS_UNAVAILABLE = "Your store's products could not be loaded.";
export const NO_STORE_CONNECTED = 'Connect your Shopify store to pick one of its products.';

export interface PickerCatalog {
  /** live: the store's own products. none: no store is connected. error: a connected store's read gave nothing. */
  mode: 'live' | 'none' | 'error';
  products: ShopifyProduct[];
  message: string;
}

/**
 * What the product picker may offer: only the connected store's own products. A connected store
 * whose read fails or comes back empty gets an error and nothing to pick, and a workspace with no
 * store gets nothing to pick either. The picker used to offer a sample catalog in both cases, and a
 * pick wrote its invented title, price and variant id into the merchant's page or upsell, which then
 * published them (C25, R14). `result` is null when the read threw or was not made.
 */
export function pickerCatalog(
  connected: boolean,
  result: { products?: ShopifyProduct[]; notice?: string } | null
): PickerCatalog {
  if (!connected) return { mode: 'none', products: [], message: NO_STORE_CONNECTED };
  const products = Array.isArray(result?.products) ? result!.products : [];
  if (products.length) return { mode: 'live', products, message: '' };
  const notice = typeof result?.notice === 'string' ? result.notice.trim() : '';
  return { mode: 'error', products: [], message: notice || PRODUCTS_UNAVAILABLE };
}
