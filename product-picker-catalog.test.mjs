// C25: the product picker swapped a connected store's catalog for the sample catalog whenever the
// read failed or came back empty, so a merchant could pick an invented product and publish a checkout
// link to a variant their store does not have.
// R14: with no store connected the picker still offered that sample catalog, a pick wrote its invented
// title and price into the page or upsell, and the published page showed them. The picker offers only
// the store's own products now, and a page saved with a sample pick publishes none of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickerCatalog, isDemoVariantId, DEMO_VARIANT_IDS, PRODUCTS_UNAVAILABLE, NO_STORE_CONNECTED } from './src/lib/productPickerCatalog.ts';
import { FAKE_VARIANT_IDS, realVariantId, realStoreDomain } from './server/routes/authWorkspaceRoutes.mjs';
import { setPublicContext, getPublicContext, renderPublicFunnelHtml, renderPublicUpsellHtml, pageTrackFrom } from './server/routes/publicRoutes.mjs';

const LIVE = [{ id: 'p1', title: 'Real', handle: 'r', price: '$20.00', variants: [{ id: '5550001', title: 'x', price: '$20.00', available: true }] }];
const modalSrc = fs.readFileSync(new URL('./src/components/modals/ShopifyProductPickerModal.tsx', import.meta.url), 'utf8');
const upsellSrc = fs.readFileSync(new URL('./src/components/drawers/UpsellEditor.tsx', import.meta.url), 'utf8');
// The variants of the sample catalog the picker used to offer. Journeys saved before R14 still carry them.
const OLD_SAMPLE_IDS = ['42109840101', '42109840102', '42109840201', '42109840202', '42109840301', '42109840302', '42109840401', '42109840501', '42109840502'];
const SAMPLE_TITLE = 'Rosewater Hydration Radiance Elixir';
const SAMPLE_IMAGE = 'https://images.unsplash.com/photo-1608248597359-251c6c06a323?w=500';

test('a connected store whose read threw gets an error and nothing to pick', () => {
  const c = pickerCatalog(true, null);
  assert.equal(c.mode, 'error');
  assert.deepEqual(c.products, []);
  assert.equal(c.message, PRODUCTS_UNAVAILABLE);
});

test('a connected store with an empty answer gets an error, carrying the server notice when sent', () => {
  const notice = 'The store did not return a product list. Nothing is shown in its place.';
  assert.deepEqual(pickerCatalog(true, { products: [], notice }), { mode: 'error', products: [], message: notice });
  // fetchShopifyProducts answers a network failure, a 500 and non-JSON as { products: [] }.
  assert.deepEqual(pickerCatalog(true, { products: [] }), { mode: 'error', products: [], message: PRODUCTS_UNAVAILABLE });
  assert.equal(pickerCatalog(true, { products: undefined }).mode, 'error');
});

test('a connected store with products gets exactly its products', () => {
  assert.deepEqual(pickerCatalog(true, { products: LIVE }), { mode: 'live', products: LIVE, message: '' });
});

test('a workspace with no store gets nothing to pick and a note saying why', () => {
  assert.deepEqual(pickerCatalog(false, null), { mode: 'none', products: [], message: NO_STORE_CONNECTED });
  assert.deepEqual(pickerCatalog(false, { products: LIVE }).products, []);
  assert.doesNotMatch(NO_STORE_CONNECTED, /[—]| – /);
});

test('the modal carries no sample catalog and shows the no-store note instead of products', () => {
  assert.match(modalSrc, /pickerCatalog\(/);
  assert.doesNotMatch(modalSrc, /DEMO_LUXURY_PRODUCTS|Demo Luxury Catalog/);
  for (const id of OLD_SAMPLE_IDS) assert.ok(!modalSrc.includes(id), `the modal still lists sample variant ${id}`);
  assert.ok(!modalSrc.includes(SAMPLE_TITLE));
  assert.match(modalSrc, /\{NO_STORE_CONNECTED\}/);
  assert.match(modalSrc, /role="alert"/);
  assert.match(modalSrc, />\s*Try again\s*</);
});

test('a pick never writes an invented regular price into the upsell', () => {
  assert.doesNotMatch(upsellSrc, /\* 1\.6|calcRegular/);
  const handler = upsellSrc.slice(upsellSrc.indexOf('const handleProductPicked'), upsellSrc.indexOf('return (', upsellSrc.indexOf('const handleProductPicked')));
  assert.doesNotMatch(handler, /regularPrice:/);
});

test('every old sample variant id is refused as a checkout variant on the client and the server', () => {
  for (const id of OLD_SAMPLE_IDS) {
    assert.ok(isDemoVariantId(id), `client refuses ${id}`);
    assert.ok(isDemoVariantId(`gid://shopify/ProductVariant/${id}`), `client refuses gid ${id}`);
    assert.equal(realVariantId(id), '', `server refuses ${id}`);
  }
  assert.deepEqual([...FAKE_VARIANT_IDS].sort(), [...DEMO_VARIANT_IDS].sort(), 'client and server lists agree');
  assert.equal(isDemoVariantId('5550001'), false);
  assert.equal(realVariantId('5550001'), '5550001');
});

function withServerGuards(fn) {
  const prev = getPublicContext();
  setPublicContext({ ...(prev || {}), realVariantId, realStoreDomain });
  try { return fn(); } finally { setPublicContext(prev || {}); }
}
const REQ = { query: {}, headers: {}, params: { slug: 'r14' } };
const SHOP = { storeDomain: 'stub-store.myshopify.com' };

test('a page saved with a sample pick publishes none of its title, price or image', () => {
  withServerGuards(() => {
    const data = { headline: 'My own headline', buttonText: 'Buy now', shopifyProductId: 'prod_rose_elixir', shopifyVariantId: '42109840101', shopifyProductTitle: SAMPLE_TITLE, shopifyProductPrice: '$34.00', shopifyProductImage: SAMPLE_IMAGE };
    const page = { slug: 'r14', userId: 'u', data, shopifyConfig: SHOP };
    const html = renderPublicFunnelHtml(page, REQ, {});
    for (const leak of [SAMPLE_TITLE, '$34.00', SAMPLE_IMAGE, '42109840101']) assert.ok(!html.includes(leak), `published page carries ${leak}`);
    assert.ok(html.includes('My own headline'), 'the user\'s own copy still publishes');
    assert.equal(pageTrackFrom(page).price, '', 'no invented price is reported to tracking');
  });
});

test('an upsell saved with a sample pick publishes none of its title, prices or image', () => {
  withServerGuards(() => {
    const upsell = { headline: 'One more thing', productTitle: `${SAMPLE_TITLE} (60ml Travel Mist)`, productPrice: '$34.00', regularPrice: '$54.40', shopifyVariantId: '42109840101', productImage: SAMPLE_IMAGE };
    const html = renderPublicUpsellHtml({ slug: 'r14', userId: 'u', data: { upsell }, shopifyConfig: SHOP }, REQ, {});
    for (const leak of [SAMPLE_TITLE, '$34.00', '$54.40', SAMPLE_IMAGE, '42109840101']) assert.ok(!html.includes(leak), `published upsell carries ${leak}`);
  });
});

test('a real product still publishes its title, price and image', () => {
  withServerGuards(() => {
    const page = { slug: 'r14', userId: 'u', data: { headline: 'Kit', shopifyVariantId: '5550001', shopifyProductTitle: 'Real Serum', shopifyProductPrice: '$20.00', shopifyProductImage: 'https://cdn.example.com/serum.jpg' }, shopifyConfig: SHOP };
    const html = renderPublicFunnelHtml(page, REQ, {});
    for (const want of ['Real Serum', '$20.00', 'https://cdn.example.com/serum.jpg', '5550001']) assert.ok(html.includes(want), `published page lacks ${want}`);
    assert.equal(pageTrackFrom(page).price, '$20.00');
    const upsell = { productTitle: 'Real Balm', productPrice: '$18.00', regularPrice: '$24.00', shopifyVariantId: '5550002', productImage: 'https://cdn.example.com/balm.jpg' };
    const up = renderPublicUpsellHtml({ slug: 'r14', userId: 'u', data: { upsell }, shopifyConfig: SHOP }, REQ, {});
    for (const want of ['Real Balm', '$18.00', '$24.00', 'https://cdn.example.com/balm.jpg']) assert.ok(up.includes(want), `published upsell lacks ${want}`);
  });
});
