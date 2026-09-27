/**
 * Jourvance Checkout Recovery Engine
 * Generates visual line-item card components, 1-click Shopify cart rebuild links,
 * and pre-applied discount redirects for abandoned checkout emails.
 */

export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds a Shopify redirect URL that auto-applies a discount code before sending
 * the customer to their checkout recovery URL or cart.
 */
export function buildDiscountCheckoutUrl(baseCheckoutUrl, discountCode = 'SAVE10') {
  if (!baseCheckoutUrl || typeof baseCheckoutUrl !== 'string') return '';
  const trimmed = baseCheckoutUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!discountCode) return trimmed;

  try {
    const u = new URL(trimmed);
    const shopDomain = u.hostname;
    const pathAndQuery = u.pathname + u.search + u.hash;
    return `https://${shopDomain}/discount/${encodeURIComponent(discountCode)}?redirect=${encodeURIComponent(pathAndQuery)}`;
  } catch {
    const sep = trimmed.includes('?') ? '&' : '?';
    return `${trimmed}${sep}discount=${encodeURIComponent(discountCode)}`;
  }
}

/**
 * Constructs a direct Shopify 1-click cart permalink from line items:
 * e.g., https://mystore.myshopify.com/cart/{variantId}:{qty},{variantId}:{qty}
 * If a discountCode is provided, wraps via /discount/{code}?redirect=...
 */
export function buildShopifyCartPermalink(shopDomain, lineItems = [], discountCode = '') {
  if (!shopDomain) return '';
  const cleanDomain = String(shopDomain).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const items = Array.isArray(lineItems) ? lineItems : [];
  const validItems = items.filter(li => li && li.variantId && String(li.variantId) !== '0');

  let cartPath = '/cart';
  if (validItems.length > 0) {
    const itemsSlug = validItems.map(li => `${encodeURIComponent(li.variantId)}:${Math.max(1, Number(li.quantity || 1))}`).join(',');
    cartPath = `/cart/${itemsSlug}`;
  }

  if (discountCode) {
    return `https://${cleanDomain}/discount/${encodeURIComponent(discountCode)}?redirect=${encodeURIComponent(cartPath)}`;
  }
  return `https://${cleanDomain}${cartPath}`;
}

/**
 * Resolves the optimal checkout URL:
 * - If abandonedCheckoutUrl is present, wraps with discountCode if requested.
 * - If abandonedCheckoutUrl is missing/expired, falls back to direct Shopify cart permalink.
 */
export function resolveCheckoutRecoveryUrl(chk, defaultShopDomain = '', discountCode = '') {
  if (!chk || typeof chk !== 'object') return '';
  const rawUrl = String(chk.abandonedCheckoutUrl || '').trim();

  // If valid URL present on checkout record
  if (/^https?:\/\//i.test(rawUrl)) {
    if (discountCode) {
      return buildDiscountCheckoutUrl(rawUrl, discountCode);
    }
    return rawUrl;
  }

  // Derive domain from defaultShopDomain or fallback
  let domain = defaultShopDomain;
  if (!domain && rawUrl) {
    try {
      domain = new URL(rawUrl).hostname;
    } catch {}
  }

  if (domain) {
    return buildShopifyCartPermalink(domain, chk.lineItems, discountCode);
  }

  return rawUrl;
}

/**
 * Renders responsive, email-client safe HTML table cards for line items in cart.
 * - Caps visible items at 3, rendering a clean "+ X more items in your bag" badge for overflow.
 * - Supports product thumbnails, variant details, quantity badges, and subtotal/discount calculations.
 */
export function renderLineItemCardsHtml(lineItems, totalPrice = 0, currency = 'USD', options = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  if (!items.length) return '';

  const maxVisible = 3;
  const visibleItems = items.slice(0, maxVisible);
  const extraCount = items.length > maxVisible ? items.length - maxVisible : 0;
  const catalog = options.catalog && typeof options.catalog === 'object' ? options.catalog : {};
  const discountPercent = Number(options.discountPercent || 0);
  const discountCode = options.discountCode || '';

  const currencySymbol = currency === 'EUR' ? '€' : (currency === 'GBP' ? '£' : '$');

  const rowsHtml = visibleItems.map((item) => {
    const title = escapeHtml(item.title || item.name || 'Selected Item');
    const variant = item.variantTitle ? escapeHtml(item.variantTitle) : '';
    const qty = Math.max(1, Number(item.quantity || 1));
    const price = Number(item.price || 0);
    const lineTotal = price * qty;
    const formattedPrice = lineTotal > 0 ? `${currencySymbol}${lineTotal.toFixed(2)}` : (price > 0 ? `${currencySymbol}${price.toFixed(2)}` : '');

    // Resolve thumbnail: direct item image -> catalog variant image -> neutral beauty placeholder
    let img = item.image || '';
    if (!img && item.variantId && catalog[item.variantId]?.image) {
      img = catalog[item.variantId].image;
    }
    const cleanImg = /^https?:\/\//i.test(img) ? escapeHtml(img) : '';

    const thumbHtml = cleanImg
      ? `<img src="${cleanImg}" alt="${title}" width="56" height="56" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #f0e6e0;display:block;" />`
      : `<div style="width:56px;height:56px;border-radius:8px;background:#fbf3ee;border:1px solid #eedfd7;text-align:center;line-height:56px;font-size:18px;color:#a07885;">✦</div>`;

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f3ece6;">
        <tr>
          <td width="64" valign="middle" style="width:64px;padding-right:12px;">
            ${thumbHtml}
          </td>
          <td valign="middle" style="text-align:left;">
            <div style="font-size:14px;font-weight:600;color:#2d2426;line-height:1.3;">${title}</div>
            ${variant ? `<div style="font-size:12px;color:#847277;margin-top:2px;">${variant}</div>` : ''}
            <div style="font-size:12px;color:#a07885;margin-top:3px;font-weight:500;">Qty: ${qty}</div>
          </td>
          <td width="80" valign="middle" style="width:80px;text-align:right;white-space:nowrap;">
            <div style="font-size:14px;font-weight:700;color:#2d2426;">${formattedPrice}</div>
          </td>
        </tr>
      </table>
    `;
  }).join('');

  // Extra items badge: "+ X more items in your bag"
  const extraBadgeHtml = extraCount > 0
    ? `<div style="text-align:center;font-size:12px;font-weight:600;color:#a07885;padding:8px 0 4px;border-top:1px dashed #eedfd7;">+ ${extraCount} more item${extraCount > 1 ? 's' : ''} in your bag</div>`
    : '';

  // Calculate Subtotal & Discount
  let computedSubtotal = Number(totalPrice || 0);
  if (computedSubtotal <= 0) {
    computedSubtotal = items.reduce((acc, it) => acc + (Number(it.price || 0) * Math.max(1, Number(it.quantity || 1))), 0);
  }

  let totalsHtml = '';
  if (computedSubtotal > 0) {
    if (discountPercent > 0) {
      const discountVal = computedSubtotal * (discountPercent / 100);
      const finalVal = Math.max(0, computedSubtotal - discountVal);
      totalsHtml = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;font-size:13px;">
          <tr>
            <td style="color:#6d5d62;padding-bottom:4px;">Bag Subtotal:</td>
            <td style="text-align:right;color:#6d5d62;padding-bottom:4px;font-weight:500;">${currencySymbol}${computedSubtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color:#059669;font-weight:600;padding-bottom:6px;">Courtesy ${discountPercent}% Off (${escapeHtml(discountCode || 'PROMO')}):</td>
            <td style="text-align:right;color:#059669;font-weight:700;padding-bottom:6px;">-${currencySymbol}${discountVal.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color:#2d2426;font-weight:700;font-size:14px;padding-top:6px;border-top:1px solid #eedfd7;">Total Reserved:</td>
            <td style="text-align:right;color:#2d2426;font-weight:800;font-size:16px;padding-top:6px;border-top:1px solid #eedfd7;">${currencySymbol}${finalVal.toFixed(2)}</td>
          </tr>
        </table>
      `;
    } else {
      totalsHtml = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;font-size:13px;">
          <tr>
            <td style="color:#6d5d62;font-weight:600;">Bag Subtotal:</td>
            <td style="text-align:right;color:#2d2426;font-weight:700;font-size:15px;">${currencySymbol}${computedSubtotal.toFixed(2)}</td>
          </tr>
        </table>
      `;
    }
  }

  return `
    <div style="background:#fdfbf9;border:1px solid #f2e9e4;border-radius:12px;padding:14px 16px;margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#a07885;margin-bottom:12px;">Saved In Your Bag</div>
      ${rowsHtml}
      ${extraBadgeHtml}
      ${totalsHtml}
    </div>
  `;
}
