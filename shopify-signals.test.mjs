import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowPixel, applyInventoryLevel, applyProductUpdate, claimBehavior, commerceBeaconCall,
  configuredPublicBase, fulfillmentKind, lowInventoryQualifies, marketingSubscribed, newPixelKey,
  pageBeaconScript, pixelKeyOk, pixelSnippet, priceDropQualifies, restockRecipients,
  restockTransition, signalStarterFlows, triggersFromClaim, variantAudience
} from './shopify-signals.mjs';

const dropFlow = { dropMode: 'percent', dropValue: 10 };

test('a public base must be https and not localhost', () => {
  assert.equal(configuredPublicBase(''), '');
  assert.equal(configuredPublicBase('http://shop.example'), '');
  assert.equal(configuredPublicBase('https://localhost/app'), '');
  assert.equal(configuredPublicBase('https://jourvance.example'), 'https://jourvance.example');
});

test('a pixel key must match exactly and a minute allows 60 events', () => {
  const key = newPixelKey();
  assert.equal(pixelKeyOk(key, key), true);
  assert.equal(pixelKeyOk(key, 'nope'), false);
  assert.equal(pixelKeyOk('', key), false);
  const store = new Map();
  for (let i = 0; i < 60; i++) assert.equal(allowPixel(store, 'client-1', 1_000 + i), true);
  assert.equal(allowPixel(store, 'client-1', 1_060), false);
  assert.equal(allowPixel(store, 'client-1', 61_061), true);
});

test('a price drop needs a stored price, a published variant, and stock above zero', () => {
  const first = applyProductUpdate({}, {
    id: 11, title: 'Hat', status: 'active', handle: 'hat',
    variants: [{ id: 9, price: '20.00', inventory_quantity: 4, inventory_item_id: 77 }]
  }, 'shop.example');
  assert.equal(first.memory['9'].createdAt, undefined);
  assert.equal(priceDropQualifies(first.changes[0], dropFlow), false);
  const dated = applyProductUpdate({}, {
    id: 11, title: 'Hat', status: 'active', created_at: '2024-01-02T00:00:00Z', product_type: 'Hats',
    variants: [{ id: 9, price: '20.00', inventory_quantity: 4 }]
  }, 'shop.example');
  assert.equal(dated.memory['9'].createdAt, '2024-01-02T00:00:00.000Z');
  assert.equal(dated.memory['9'].category, 'Hats');
  const second = applyProductUpdate(first.memory, {
    id: 11, title: 'Hat', status: 'active', handle: 'hat',
    variants: [{ id: 9, price: '10.00', inventory_quantity: 4, inventory_item_id: 77 }]
  }, 'shop.example');
  assert.equal(priceDropQualifies(second.changes[0], dropFlow), true);
  assert.equal(priceDropQualifies(second.changes[0], { dropMode: 'percent', dropValue: 60 }), false);
  const unpublished = applyProductUpdate(first.memory, {
    id: 11, status: 'draft', variants: [{ id: 9, price: '10.00', inventory_quantity: 4 }]
  }, 'shop.example');
  assert.equal(priceDropQualifies(unpublished.changes[0], dropFlow), false);
  const unsold = applyProductUpdate(first.memory, {
    id: 11, status: 'active', variants: [{ id: 9, price: '10.00', inventory_quantity: 0 }]
  }, 'shop.example');
  assert.equal(priceDropQualifies(unsold.changes[0], dropFlow), false);
});

test('low stock and restock use the counts Shopify sent', () => {
  assert.equal(lowInventoryQualifies({ available: 0 }, { stockThreshold: 5 }), false);
  assert.equal(lowInventoryQualifies({ available: 3 }, { stockThreshold: 5 }), true);
  assert.equal(lowInventoryQualifies({ available: null }, { stockThreshold: 5 }), false);
  let level = applyInventoryLevel({}, { inventory_item_id: 77, available: 2, location_id: 1 });
  assert.equal(level.changes.length, 0);
  level = applyInventoryLevel({
    '9': { variantId: '9', inventoryItemId: '77', available: 0 },
    _byItem: level.memory._byItem
  }, { inventory_item_id: 77, available: 2, location_id: 1 });
  level = applyInventoryLevel(level.memory, { inventory_item_id: 77, available: 3, location_id: 2 });
  assert.equal(level.memory['9'].available, 5);
  assert.equal(restockTransition(null, 5, 1), false);
  assert.equal(restockTransition(0, 5, 1), true);
  assert.deepEqual(restockRecipients([
    { email: 'asked@shop.test', variantId: '9', firedAt: '' },
    { email: 'other@shop.test', variantId: '8', firedAt: '' },
    { email: 'done@shop.test', variantId: '9', firedAt: '2026-01-01' }
  ], '9', 0, 5, 1), ['asked@shop.test']);
});

test('price and stock audiences ignore buyers and people with no email', () => {
  const emails = variantAudience({
    variantId: '9',
    since: 0,
    behavior: [
      { type: 'product_viewed', email: '', variantId: '9', at: '2026-01-02' },
      { type: 'product_viewed', email: 'view@shop.test', variantId: '9', at: '2026-01-02' }
    ],
    checkouts: [{ email: 'cart@shop.test', at: '2026-01-03', variantIds: ['9'] }],
    orders: [{ email: 'view@shop.test', variantIds: ['9'] }]
  });
  assert.deepEqual(emails, ['cart@shop.test']);
});

test('a fulfillment is partial only when the payload says so', () => {
  assert.equal(fulfillmentKind({ status: 'success' }), 'order_fulfilled');
  assert.equal(fulfillmentKind({ fulfillment_status: 'partial' }), 'order_partially_fulfilled');
  assert.equal(fulfillmentKind({}), 'order_fulfilled');
});

test('customer marketing state is copied only when Shopify sent it', () => {
  assert.equal(marketingSubscribed({}), null);
  assert.equal(marketingSubscribed({ email_marketing_consent: { state: 'subscribed' } }), true);
  assert.equal(marketingSubscribed({ email_marketing_consent: { state: 'unsubscribed' } }), false);
});

test('anonymous views attach by visitor or checkout, and checkout itself does not enroll', () => {
  const events = [
    { type: 'product_viewed', visitorId: 'jv_1', email: '', variantId: '9' },
    { type: 'checkout_started', checkoutToken: 'tok', clientId: 'c1', email: '' },
    { type: 'product_viewed', visitorId: 'jv_other', email: '', variantId: '9' }
  ];
  const claimed = claimBehavior(events, { email: 'a@shop.test', visitorId: 'jv_1', checkoutToken: 'tok' });
  assert.equal(claimed.claimed.length, 2);
  assert.equal(claimed.clientId, 'c1');
  assert.deepEqual(triggersFromClaim(claimed.claimed).map((event) => event.type), ['product_viewed']);
  assert.equal(events[2].email, '');
});

test('a page beacon includes a product view only when the page has a product', () => {
  assert.equal(pageBeaconScript({}), '');
  assert.equal(pageBeaconScript({ variantId: '42109840192' }), '');
  const script = pageBeaconScript({ variantId: '55', price: '18.00', collectionId: '7' });
  assert.match(script, /product_viewed/);
  assert.match(script, /collection_viewed/);
  assert.match(script, /55/);
  assert.equal(commerceBeaconCall('checkout'), "if (window.jourvanceTrack) window.jourvanceTrack('checkout_start');");
  assert.match(commerceBeaconCall('add'), /added_to_cart/);
  assert.doesNotMatch(commerceBeaconCall('checkout'), /added_to_cart/);
});

test('the pixel snippet listens for storefront events and does not ask for an email', () => {
  const snippet = pixelSnippet({ endpoint: 'https://jourvance.example/api/public/shopify-pixel', shop: 'shop.example', key: 'abc' });
  assert.match(snippet, /analytics\.subscribe\('product_viewed'/);
  assert.match(snippet, /analytics\.subscribe\('product_added_to_cart'/);
  assert.match(snippet, /analytics\.subscribe\('checkout_started'/);
  assert.doesNotMatch(snippet, /email/);
});

test('browse, cart, price-drop, and restock starters stay off with a visible wait', () => {
  const flows = signalStarterFlows();
  assert.equal(flows.length, 5);
  for (const flow of flows.filter((row) => row.id !== 'flow_sunset')) {
    assert.equal(flow.enabled, false);
    assert.equal(flow.nodes.find((node) => node.type === 'delay').delayMinutes, 60);
    assert.equal(flow.nodes.find((node) => node.type === 'email').status, 'draft');
  }
  const sunset = flows.find((row) => row.id === 'flow_sunset');
  assert.equal(sunset.enabled, false);
  assert.equal(sunset.sunset, true);
  assert.equal(sunset.nodes.some((node) => node.type === 'email' || node.type === 'sms'), false);
});
