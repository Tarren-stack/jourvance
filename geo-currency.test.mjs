import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_CURRENCIES,
  parsePriceAmount,
  convertCurrencyCharm,
  detectVisitorCurrency,
  buildLocalizedShopifyCartUrl
} from './src/lib/geoCurrency.ts';

test('parsePriceAmount accurately detects amounts and charm endings', () => {
  assert.deepEqual(parsePriceAmount('$49.00'), { amount: 49, hasDecimals: true, ending: '00' });
  assert.deepEqual(parsePriceAmount('$49'), { amount: 49, hasDecimals: false, ending: '00' });
  assert.deepEqual(parsePriceAmount('$49.95'), { amount: 49.95, hasDecimals: true, ending: '95' });
  assert.deepEqual(parsePriceAmount('49.99'), { amount: 49.99, hasDecimals: true, ending: '99' });
  assert.deepEqual(parsePriceAmount('€34.50'), { amount: 34.5, hasDecimals: true, ending: 'raw' });
  assert.deepEqual(parsePriceAmount(''), { amount: 0, hasDecimals: false, ending: '00' });
});

test('convertCurrencyCharm applies Option A psychological charm pricing', () => {
  // $49.00 USD -> EUR (rate 0.92) -> 49 * 0.92 = 45.08 -> €45.00
  const eurWhole = convertCurrencyCharm('$49.00', 'EUR', 'USD');
  assert.equal(eurWhole.currency, 'EUR');
  assert.equal(eurWhole.symbol, '€');
  assert.equal(eurWhole.amount, 45);
  assert.equal(eurWhole.formatted, '€45.00');

  // $49 USD -> EUR -> €45
  const eurNoDec = convertCurrencyCharm('$49', 'EUR', 'USD');
  assert.equal(eurNoDec.amount, 45);
  assert.equal(eurNoDec.formatted, '€45');

  // $49.00 USD -> GBP (rate 0.79) -> 49 * 0.79 = 38.71 -> £39.00
  const gbpWhole = convertCurrencyCharm('$49.00', 'GBP', 'USD');
  assert.equal(gbpWhole.currency, 'GBP');
  assert.equal(gbpWhole.symbol, '£');
  assert.equal(gbpWhole.amount, 39);
  assert.equal(gbpWhole.formatted, '£39.00');

  // $49.00 USD -> CAD (rate 1.36) -> 49 * 1.36 = 66.64 -> CA$67.00
  const cadWhole = convertCurrencyCharm('$49.00', 'CAD', 'USD');
  assert.equal(cadWhole.currency, 'CAD');
  assert.equal(cadWhole.amount, 67);
  assert.equal(cadWhole.formatted, 'CA$67.00');

  // $49.00 USD -> AUD (rate 1.52) -> 49 * 1.52 = 74.48 -> A$74.00
  const audWhole = convertCurrencyCharm('$49.00', 'AUD', 'USD');
  assert.equal(audWhole.currency, 'AUD');
  assert.equal(audWhole.amount, 74);
  assert.equal(audWhole.formatted, 'A$74.00');

  // Charm .95 preservation: $49.95 USD -> EUR (49.95 * 0.92 = 45.954 -> €45.95)
  const eur95 = convertCurrencyCharm('$49.95', 'EUR', 'USD');
  assert.equal(eur95.amount, 45.95);
  assert.equal(eur95.formatted, '€45.95');

  // Charm .99 preservation: $49.99 USD -> EUR (49.99 * 0.92 = 45.9908 -> €45.99)
  const eur99 = convertCurrencyCharm('$49.99', 'EUR', 'USD');
  assert.equal(eur99.amount, 45.99);
  assert.equal(eur99.formatted, '€45.99');
});

test('detectVisitorCurrency prioritizes cookie > country header > timezone', () => {
  // 1. Cookie takes precedence
  assert.equal(detectVisitorCurrency({ cookie: 'jv_currency=GBP', countryCode: 'FR', timezone: 'America/New_York' }), 'GBP');
  assert.equal(detectVisitorCurrency({ cookie: 'jv_currency=eur; path=/' }), 'EUR');

  // 2. Country code mapping
  assert.equal(detectVisitorCurrency({ countryCode: 'GB' }), 'GBP');
  assert.equal(detectVisitorCurrency({ countryCode: 'UK' }), 'GBP');
  assert.equal(detectVisitorCurrency({ countryCode: 'CA' }), 'CAD');
  assert.equal(detectVisitorCurrency({ countryCode: 'AU' }), 'AUD');
  assert.equal(detectVisitorCurrency({ countryCode: 'DE' }), 'EUR');
  assert.equal(detectVisitorCurrency({ countryCode: 'FR' }), 'EUR');
  assert.equal(detectVisitorCurrency({ countryCode: 'US' }), 'USD');

  // 3. Timezone mapping fallback
  assert.equal(detectVisitorCurrency({ timezone: 'Europe/London' }), 'GBP');
  assert.equal(detectVisitorCurrency({ timezone: 'Europe/Paris' }), 'EUR');
  assert.equal(detectVisitorCurrency({ timezone: 'Europe/Berlin' }), 'EUR');
  assert.equal(detectVisitorCurrency({ timezone: 'America/Toronto' }), 'CAD');
  assert.equal(detectVisitorCurrency({ timezone: 'America/Vancouver' }), 'CAD');
  assert.equal(detectVisitorCurrency({ timezone: 'Australia/Sydney' }), 'AUD');
  assert.equal(detectVisitorCurrency({ timezone: 'America/New_York' }), 'USD');
});

test('buildLocalizedShopifyCartUrl injects currency parameter into Shopify cart permalinks', () => {
  const baseCart = 'https://myshop.myshopify.com/cart/42109840192:1?discount=SAVE10&attributes[jv_vid]=vid_123';
  
  // Non-USD appends ?currency=CODE
  const eurCart = buildLocalizedShopifyCartUrl(baseCart, 'EUR');
  assert.match(eurCart, /currency=EUR/);
  assert.match(eurCart, /discount=SAVE10/);
  assert.match(eurCart, /attributes%5Bjv_vid%5D=vid_123/);

  // GBP cart
  const gbpCart = buildLocalizedShopifyCartUrl(baseCart, 'GBP');
  assert.match(gbpCart, /currency=GBP/);

  // USD removes or leaves clean
  const usdCart = buildLocalizedShopifyCartUrl(eurCart, 'USD');
  assert.doesNotMatch(usdCart, /currency=EUR/);
});

test('renderPublicFunnelHtml SSR renders localized currency pill and charm prices via cookie', async () => {
  const { renderPublicFunnelHtml } = await import('./server/routes/publicRoutes.mjs');
  const dummyPage = {
    slug: 'glow-serum-offer',
    shopifyConfig: { storeDomain: 'aura-beauty.myshopify.com' },
    data: {
      headline: 'Hydra-Glow Elixir',
      subhead: 'Deep cellular hydration for estheticians',
      shopifyVariantId: 'gid://shopify/ProductVariant/99887766',
      shopifyProductPrice: '$49.00',
      orderBumpEnabled: true,
      orderBumpVariantId: 'gid://shopify/ProductVariant/11223344',
      orderBumpPrice: '$19.00',
      orderBumpHeadline: 'Add Rose Quartz Gua Sha'
    }
  };

  const req = {
    headers: { cookie: 'jv_currency=EUR' },
    query: {}
  };
  const res = { cookie: () => {} };

  const html = renderPublicFunnelHtml(dummyPage, req, res);

  // 1. Selector pill renders with EUR selected
  assert.match(html, /<select id="jv-currency-select"/);
  assert.match(html, /<option value="EUR" selected>/);

  // 2. Initial SSR prices are charm converted to EUR (€45.00 for $49.00; €17.00 for $19.00)
  assert.match(html, /data-base-price="\$49\.00">€45\.00<\/div>/);
  assert.match(html, /data-base-price="\$19\.00">€17\.00<\/span>/);

  // 3. Client switcher engine and checkout builder are embedded
  assert.match(html, /CURRENCY_CONFIG/);
  assert.match(html, /out\.set\('currency', activeCurrency\)/);
});

test('renderPublicFunnelHtml SSR detects visitor country header and localizes to GBP', async () => {
  const { renderPublicFunnelHtml } = await import('./server/routes/publicRoutes.mjs');
  const dummyPage = {
    slug: 'lash-lift-kit',
    shopifyConfig: { storeDomain: 'aura-beauty.myshopify.com' },
    data: {
      headline: 'Pro Lash Lift Kit',
      shopifyVariantId: 'gid://shopify/ProductVariant/55443322',
      shopifyProductPrice: '$49.00'
    }
  };

  const req = {
    headers: { 'cf-ipcountry': 'GB' },
    query: {}
  };
  const res = { cookie: () => {} };

  const html = renderPublicFunnelHtml(dummyPage, req, res);

  // GBP detected and selected
  assert.match(html, /<option value="GBP" selected>/);
  // $49.00 * 0.79 = 38.71 -> £39.00 charm pricing
  assert.match(html, /data-base-price="\$49\.00">£39\.00<\/div>/);
});

test('renderPublicUpsellHtml localizes 1-click upsell prices and Shopify accept permalinks', async () => {
  const { renderPublicUpsellHtml } = await import('./server/routes/publicRoutes.mjs');
  const dummyPage = {
    slug: 'glow-serum-offer',
    shopifyConfig: { storeDomain: 'aura-beauty.myshopify.com' },
    data: {
      upsell: {
        headline: 'Exclusive Masterclass Upgrade',
        subhead: 'Master the treatment in 60 minutes',
        productPrice: '$49.95',
        regularPrice: '$99.00',
        shopifyVariantId: '77889900',
        acceptButtonText: 'Yes, Add To My Order'
      }
    }
  };

  const req = {
    query: { currency: 'EUR' },
    headers: {}
  };
  const res = {};

  const html = renderPublicUpsellHtml(dummyPage, req, res, false);

  // 1. Converted charm price: $49.95 * 0.92 = 45.954 -> €45.95 (.95 preserved)
  assert.match(html, /class="price-special">€45\.95<\/span>/);
  // Regular price: $99.00 * 0.92 = 91.08 -> €91.00 (.00 preserved)
  assert.match(html, /class="price-reg">€91\.00<\/span>/);

  // 2. Accept CTA has localized checkout URL with currency=EUR
  assert.match(html, /href="https:\/\/aura-beauty\.myshopify\.com\/cart\/77889900:1\?currency=EUR"/);

  // 3. Decline link passes through currency parameter to thank you page
  assert.match(html, /href="\/p\/glow-serum-offer\/thank-you\?currency=EUR"/);
});

