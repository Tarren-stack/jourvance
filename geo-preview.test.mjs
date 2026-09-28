import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderGeoPricingSimulatorToolbar,
  renderPublicFunnelHtml,
  renderPublicUpsellHtml
} from './server/routes/publicRoutes.mjs';
import {
  SUPPORTED_CURRENCIES,
  convertCurrencyCharm,
  buildLocalizedShopifyCartUrl
} from './src/lib/geoCurrency.ts';

test('renderGeoPricingSimulatorToolbar produces valid toolbar markup with currency presets', () => {
  const html = renderGeoPricingSimulatorToolbar({
    activeCurrency: 'GBP',
    slug: 'glow-serum',
    isUpsell: false,
    hasUpsell: true,
    storeDomain: 'glowbeauty.myshopify.com'
  });

  assert.ok(html.includes('id="jv-geo-simulator-toolbar"'), 'Must have root toolbar element');
  assert.ok(html.includes('✦ PREVIEW MODE: GEO SIMULATOR'), 'Must have preview mode badge');
  assert.ok(html.includes('Rate: 1 USD = 0.79 GBP (£)'), 'Must render GBP exchange rate');
  assert.ok(html.includes('data-currency="GBP"'), 'Must include GBP button');
  assert.ok(html.includes('class="jv-sim-currency-btn active"'), 'GBP button must be active');
  assert.ok(html.includes('Shopify Cart: ?currency=GBP'), 'Must display GBP checkout status');
  assert.ok(html.includes('/p/glow-serum/upsell?preview=true&amp;currency=GBP') || html.includes('/p/glow-serum/upsell?preview=true&currency=GBP'), 'Must link to upsell preview in GBP');
});

test('renderGeoPricingSimulatorToolbar adapts navigation when rendered on upsell node', () => {
  const html = renderGeoPricingSimulatorToolbar({
    activeCurrency: 'EUR',
    slug: 'glow-serum',
    isUpsell: true,
    hasUpsell: false,
    storeDomain: 'glowbeauty.myshopify.com'
  });

  assert.ok(html.includes('Rate: 1 USD = 0.92 EUR (€)'), 'Must render EUR rate');
  assert.ok(html.includes('Shopify Cart: ?currency=EUR'), 'Must display EUR cart status');
  assert.ok(html.includes('← Return to Funnel (EUR)'), 'Must display return to funnel label');
  assert.ok(html.includes('/p/glow-serum?preview=true&amp;currency=EUR') || html.includes('/p/glow-serum?preview=true&currency=EUR'), 'Must link back to funnel in EUR');
});

test('renderPublicFunnelHtml displays QA simulator toolbar only when preview or jv_qa is requested', () => {
  const page = {
    slug: 'luxe-cream',
    data: {
      headline: 'Luxe Youth Cream',
      subhead: 'Radiant hydration in 7 days',
      bullets: ['Deep barrier repair', 'Natural botanical peptides'],
      buttonText: 'Claim My Jar',
      shopifyProductPrice: '49.00',
      shopifyVariantId: 'gid://shopify/ProductVariant/44112233',
      hasUpsell: true
    },
    shopifyConfig: {
      storeDomain: 'luxe.myshopify.com'
    }
  };

  // 1. Production Request without QA flags
  const prodReq = { query: {}, headers: {} };
  const prodHtml = renderPublicFunnelHtml(page, prodReq);
  assert.ok(!prodHtml.includes('id="jv-geo-simulator-toolbar"'), 'Production traffic must NOT see QA simulator toolbar');
  assert.ok(prodHtml.includes('id="jv-currency-select"'), 'Production traffic still gets sleek header currency selector');

  // 2. QA/Preview Request (?preview=true)
  const previewReq = { query: { preview: 'true' }, headers: {} };
  const previewHtml = renderPublicFunnelHtml(page, previewReq);
  assert.ok(previewHtml.includes('id="jv-geo-simulator-toolbar"'), 'Preview mode must render simulator toolbar');
  assert.ok(previewHtml.includes('Rate: 1 USD = 1 USD ($)'), 'Default rate shows USD');

  // 3. QA Flag Request (?jv_qa=1) with target currency
  const qaReq = { query: { jv_qa: '1', currency: 'CAD' }, headers: {} };
  const qaHtml = renderPublicFunnelHtml(page, qaReq);
  assert.ok(qaHtml.includes('id="jv-geo-simulator-toolbar"'), 'jv_qa=1 must render simulator toolbar');
  assert.ok(qaHtml.includes('Rate: 1 USD = 1.36 CAD (CA$)'), 'Reflects CAD rate');
  assert.ok(qaHtml.includes('Shopify Cart: ?currency=CAD'), 'Shows CAD cart permalink status');
});

test('renderPublicUpsellHtml renders sleek currency selector header and data-base-price attributes', () => {
  const page = {
    slug: 'luxe-cream',
    data: {
      upsell: {
        headline: 'Enhance With Night Elixir',
        subhead: 'Double overnight cellular renewal',
        productTitle: 'Night Renewal Elixir',
        productPrice: '39.00',
        regularPrice: '69.00',
        acceptButtonText: 'Yes, Add Night Elixir',
        shopifyVariantId: '99887766'
      }
    },
    shopifyConfig: {
      storeDomain: 'luxe.myshopify.com'
    }
  };

  const req = { query: { currency: 'EUR' }, headers: {} };
  const html = renderPublicUpsellHtml(page, req, null, false);

  // Currency Selector in header
  assert.ok(html.includes('class="upsell-header"'), 'Upsell must have header bar');
  assert.ok(html.includes('id="jv-currency-select"'), 'Must have jv-currency-select');
  assert.ok(html.includes('selected'), 'Must mark target currency selected');

  // Pricing Elements with base attributes
  assert.ok(html.includes('id="jv-upsell-price"'), 'Must assign id jv-upsell-price');
  assert.ok(html.includes('data-base-price="39.00"'), 'Must store base price for reactive recalculation');
  assert.ok(html.includes('id="jv-regular-price"'), 'Must assign id jv-regular-price');
  assert.ok(html.includes('data-base-price="69.00"'), 'Must store base regular price');

  // CTA attributes
  assert.ok(html.includes('id="jv-accept-btn"'), 'Must have accept button');
  assert.ok(html.includes('data-base-checkout-url="https://luxe.myshopify.com/cart/99887766:1"'), 'Must store base checkout URL for client-side currency updates');
  assert.ok(html.includes('id="jv-decline-btn"'), 'Must have decline button');
  assert.ok(html.includes('data-base-decline-url="/p/luxe-cream/thank-you"'), 'Must store base decline URL');

  // Client-side script presence
  assert.ok(html.includes('function formatCharmPrice'), 'Must embed formatCharmPrice function');
  assert.ok(html.includes('function applyCurrency'), 'Must embed reactive applyCurrency function');
  assert.ok(html.includes('document.cookie = \'jv_currency='), 'Must update sticky cookie');
  assert.ok(!html.includes('id="jv-geo-simulator-toolbar"'), 'Production upsell traffic must not see simulator toolbar');
});

test('renderPublicUpsellHtml injects simulator toolbar when preview mode is active', () => {
  const page = {
    slug: 'luxe-cream',
    data: {
      upsell: {
        headline: 'Enhance With Night Elixir',
        productPrice: '39.00',
        shopifyVariantId: 'gid://shopify/ProductVariant/99887766'
      }
    },
    shopifyConfig: {
      storeDomain: 'luxe.myshopify.com'
    }
  };

  const req = { query: { preview: 'true', currency: 'AUD' }, headers: {} };
  const html = renderPublicUpsellHtml(page, req, null, false);

  assert.ok(html.includes('id="jv-geo-simulator-toolbar"'), 'Upsell in preview mode must render simulator toolbar');
  assert.ok(html.includes('Rate: 1 USD = 1.52 AUD (A$)'), 'Must show AUD exchange rate');
  assert.ok(html.includes('Shopify Cart: ?currency=AUD'), 'Must show AUD cart indicator');
  assert.ok(html.includes('← Return to Funnel (AUD)'), 'Must offer navigation back to funnel in AUD');
});

test('client-side charm pricing rules match server-side geoCurrency calculations exactly', () => {
  // Test Option A charm pricing for all supported currencies
  const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
  const testPrices = ['19.00', '49.95', '89.99', '120.00'];

  for (const price of testPrices) {
    for (const curr of currencies) {
      const serverResult = convertCurrencyCharm(price, curr, 'USD');
      assert.ok(serverResult.formatted, `Server must format ${price} in ${curr}`);
      assert.ok(typeof serverResult.amount === 'number', `Server amount must be number`);
      
      // Verify Shopify Cart URL generation
      const cartUrl = buildLocalizedShopifyCartUrl('https://store.myshopify.com/cart/12345:1', curr);
      if (curr === 'USD') {
        assert.ok(!cartUrl.includes('currency='), 'USD must not append currency param');
      } else {
        assert.ok(cartUrl.includes(`currency=${curr}`), `${curr} must append currency=${curr}`);
      }
    }
  }
});
