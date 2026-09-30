// The order-bump price as the map card and the editor preview show it.
// Turning the bump on sets no price, and the published page then shows none
// (publicRoutes.mjs uses `data.orderBumpPrice || ''`), so an empty price reads
// 'No price set' here rather than a figure nobody entered (UpsellNode does the same).
export const NO_BUMP_PRICE = 'No price set';

export function orderBumpPriceText(price: unknown, format?: (price: string) => string): string {
  const raw = typeof price === 'number' ? String(price) : typeof price === 'string' ? price.trim() : '';
  if (!raw) return NO_BUMP_PRICE;
  return format ? format(raw) : raw;
}
