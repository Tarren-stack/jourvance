import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanWooUrl } from './server/routes/woocommerceRoutes.mjs';

test('cleanWooUrl normalizes WordPress URLs and strips trailing slashes', () => {
  assert.equal(cleanWooUrl('https://mystore.com/'), 'https://mystore.com');
  assert.equal(cleanWooUrl('http://mystore.com///'), 'https://mystore.com');
  assert.equal(cleanWooUrl('  https://shop.brand.org  '), 'https://shop.brand.org');
  assert.equal(cleanWooUrl(''), '');
  assert.equal(cleanWooUrl(null), '');
});

test('woocommerceRoutes source carries no em dashes or spaced en dashes', () => {
  const src = fs.readFileSync('server/routes/woocommerceRoutes.mjs', 'utf8');
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, / – /);
});

test('ShopifyConnectModal source carries no em dashes or spaced en dashes', () => {
  const src = fs.readFileSync('src/components/shopify/ShopifyConnectModal.tsx', 'utf8');
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, / – /);
});

test('LiveFunnelModal source carries no em dashes or spaced en dashes', () => {
  const src = fs.readFileSync('src/components/preview/LiveFunnelModal.tsx', 'utf8');
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, / – /);
});
