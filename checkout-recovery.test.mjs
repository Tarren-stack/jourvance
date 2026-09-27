import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  buildDiscountCheckoutUrl,
  buildShopifyCartPermalink,
  resolveCheckoutRecoveryUrl,
  renderLineItemCardsHtml
} from './checkout-recovery.mjs';

test('Option A: renderLineItemCardsHtml returns empty string when items array is empty or invalid', () => {
  assert.equal(renderLineItemCardsHtml([]), '');
  assert.equal(renderLineItemCardsHtml(null), '');
  assert.equal(renderLineItemCardsHtml(undefined), '');
});

test('Option A: renderLineItemCardsHtml renders product card with thumbnail, title, variant, qty, and price', () => {
  const lineItems = [
    {
      title: 'Hydrating Botanical Essence',
      variantTitle: '100ml / Rose Water',
      image: 'https://cdn.shopify.com/s/files/1/0001/products/essence.jpg',
      variantId: 'var_123',
      quantity: 1,
      price: 45.00
    }
  ];

  const html = renderLineItemCardsHtml(lineItems, 45.00, 'USD');

  assert.ok(html.includes('Saved In Your Bag'), 'Must include bag header');
  assert.ok(html.includes('Hydrating Botanical Essence'), 'Must include product title');
  assert.ok(html.includes('100ml / Rose Water'), 'Must include variant title');
  assert.ok(html.includes('Qty: 1'), 'Must include quantity badge');
  assert.ok(html.includes('$45.00'), 'Must include formatted price');
  assert.ok(html.includes('https://cdn.shopify.com/s/files/1/0001/products/essence.jpg'), 'Must render image URL');
});

test('Option A: renderLineItemCardsHtml caps visible items at 3 and renders clean overflow badge', () => {
  const lineItems = [
    { title: 'Item 1', variantId: 'v1', quantity: 1, price: 10 },
    { title: 'Item 2', variantId: 'v2', quantity: 1, price: 15 },
    { title: 'Item 3', variantId: 'v3', quantity: 1, price: 20 },
    { title: 'Item 4', variantId: 'v4', quantity: 1, price: 25 },
    { title: 'Item 5', variantId: 'v5', quantity: 1, price: 30 }
  ];

  const html = renderLineItemCardsHtml(lineItems, 100, 'USD');

  assert.ok(html.includes('Item 1'));
  assert.ok(html.includes('Item 2'));
  assert.ok(html.includes('Item 3'));
  assert.equal(html.includes('Item 4'), false, 'Item 4 should be truncated');
  assert.equal(html.includes('Item 5'), false, 'Item 5 should be truncated');
  assert.ok(html.includes('+ 2 more items in your bag'), 'Must show overflow count');
});

test('Option A: renderLineItemCardsHtml enriches image from catalog memory if missing from line item', () => {
  const lineItems = [
    { title: 'Glow Facial Oil', variantId: 'var_glow_99', quantity: 1, price: 58 }
  ];
  const catalog = {
    var_glow_99: {
      title: 'Glow Facial Oil',
      image: 'https://cdn.shopify.com/s/files/catalog/glow-oil.jpg'
    }
  };

  const html = renderLineItemCardsHtml(lineItems, 58, 'USD', { catalog });

  assert.ok(html.includes('https://cdn.shopify.com/s/files/catalog/glow-oil.jpg'), 'Should resolve image from catalog');
});

test('Option A: renderLineItemCardsHtml renders placeholder icon when no image exists', () => {
  const lineItems = [
    { title: 'Velvet Lip Tint', variantId: 'var_no_img', quantity: 1, price: 22 }
  ];

  const html = renderLineItemCardsHtml(lineItems, 22, 'USD');

  assert.ok(html.includes('✦'), 'Should render clean beauty placeholder icon');
});

test('Option A: renderLineItemCardsHtml calculates 10% courtesy discount in Stage 2 incentive', () => {
  const lineItems = [
    { title: 'Restorative Night Cream', quantity: 1, price: 80.00 }
  ];

  const html = renderLineItemCardsHtml(lineItems, 80.00, 'USD', {
    discountPercent: 10,
    discountCode: 'SAVE10'
  });

  assert.ok(html.includes('Bag Subtotal:'));
  assert.ok(html.includes('$80.00'));
  assert.ok(html.includes('Courtesy 10% Off (SAVE10):'));
  assert.ok(html.includes('-$8.00'));
  assert.ok(html.includes('Total Reserved:'));
  assert.ok(html.includes('$72.00'));
});

test('Option A: buildDiscountCheckoutUrl wraps URL with Shopify /discount/{code}?redirect=...', () => {
  const originalUrl = 'https://luxeaesthetics.myshopify.com/checkouts/cn/c1-98765/recover?step=contact_information';
  const discountUrl = buildDiscountCheckoutUrl(originalUrl, 'SAVE10');

  assert.ok(discountUrl.startsWith('https://luxeaesthetics.myshopify.com/discount/SAVE10?redirect='));
  const parsed = new URL(discountUrl);
  const redirectTarget = decodeURIComponent(parsed.searchParams.get('redirect'));
  assert.equal(redirectTarget, '/checkouts/cn/c1-98765/recover?step=contact_information');
});

test('Option A: buildShopifyCartPermalink constructs 1-click /cart/{variantId}:{qty} permalink', () => {
  const shopDomain = 'luxeaesthetics.myshopify.com';
  const lineItems = [
    { variantId: '439812901', quantity: 2 },
    { variantId: '439812902', quantity: 1 }
  ];

  const permalink = buildShopifyCartPermalink(shopDomain, lineItems);
  assert.equal(permalink, 'https://luxeaesthetics.myshopify.com/cart/439812901:2,439812902:1');
});

test('Option A: buildShopifyCartPermalink with discount wraps via /discount/SAVE10?redirect=/cart/...', () => {
  const shopDomain = 'luxeaesthetics.myshopify.com';
  const lineItems = [
    { variantId: '439812901', quantity: 1 }
  ];

  const permalink = buildShopifyCartPermalink(shopDomain, lineItems, 'SAVE10');
  assert.ok(permalink.startsWith('https://luxeaesthetics.myshopify.com/discount/SAVE10?redirect='));
  const parsed = new URL(permalink);
  assert.equal(decodeURIComponent(parsed.searchParams.get('redirect')), '/cart/439812901:1');
});

test('Option A: resolveCheckoutRecoveryUrl prioritizes abandonedCheckoutUrl and applies discount when requested', () => {
  const chk = {
    abandonedCheckoutUrl: 'https://luxeaesthetics.myshopify.com/checkouts/cn/tok_abc/recover',
    lineItems: [{ variantId: '439812901', quantity: 1 }]
  };

  const stage1Url = resolveCheckoutRecoveryUrl(chk, 'luxeaesthetics.myshopify.com', '');
  assert.equal(stage1Url, 'https://luxeaesthetics.myshopify.com/checkouts/cn/tok_abc/recover');

  const stage2Url = resolveCheckoutRecoveryUrl(chk, 'luxeaesthetics.myshopify.com', 'SAVE10');
  assert.ok(stage2Url.includes('/discount/SAVE10?redirect='));
  assert.ok(stage2Url.includes(encodeURIComponent('/checkouts/cn/tok_abc/recover')));
});

test('Option A: resolveCheckoutRecoveryUrl falls back to Shopify cart permalink when abandonedCheckoutUrl is blank', () => {
  const chk = {
    abandonedCheckoutUrl: '',
    lineItems: [
      { variantId: '987654321', quantity: 3 }
    ]
  };

  const fallbackUrl = resolveCheckoutRecoveryUrl(chk, 'beautyboutique.myshopify.com', '');
  assert.equal(fallbackUrl, 'https://beautyboutique.myshopify.com/cart/987654321:3');

  const fallbackDiscountUrl = resolveCheckoutRecoveryUrl(chk, 'beautyboutique.myshopify.com', 'SAVE10');
  assert.equal(
    fallbackDiscountUrl,
    'https://beautyboutique.myshopify.com/discount/SAVE10?redirect=%2Fcart%2F987654321%3A3'
  );
});
