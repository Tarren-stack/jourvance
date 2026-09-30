// R24 follow-up: once reviews were really stored, POST /api/public/review was an anonymous write onto
// every merchant's public page. It skipped the token whenever NODE_ENV was not "production", found the
// order by email alone, signed with a key written in reviewEngine.mjs, saved a missing rating as five
// stars, and took any "https://" photo, which the wall put into an inline onclick string where the
// browser decodes an escaped quote back before the script runs. These pin the route and the wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import express from 'express';
import { renderPublicFunnelHtml, setPublicContext, setupPublicRoutes } from './server/routes/publicRoutes.mjs';
import { reviewTokenFor, reviewTokenValid, reviewSigningKey } from './server/reviewTokens.mjs';
import { generateReviewToken } from './server/reviewEngine.mjs';

const EVIL = "https://img.example/a.png');alert('XSS:'+document.domain);('";
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const page = () => ({ slug: 'glow', userId: 'u1', data: { headline: 'Night Serum', shopifyVariantId: '4444444444' }, shopifyConfig: { storeDomain: 'demo.myshopify.com', currency: 'USD' } });
const memoryStore = (rows) => ({
  get: (key, _file, fallback) => (key === 'store.reviews' ? rows : fallback),
  set: (key, _file, data) => { if (key === 'store.reviews') rows.splice(0, rows.length, ...data); }
});

function withKey(t, env) {
  const names = ['REVIEW_SECRET', 'MAIL_LINK_SECRET', 'HUB_API_KEY'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  Object.assign(process.env, env);
  t.after(() => { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } });
}

async function serve(rows, drips = { sequences: [], enrollments: [] }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { glow: page() },
    domainRegistryCache: {},
    workspaceCache: { ws1: { userId: 'u1', shopifyConfig: { storeDomain: 'demo.myshopify.com' } } },
    hubStorage: memoryStore(rows),
    loadDiscounts: () => [],
    realStoreDomain: (c) => c?.storeDomain || '',
    loadOrders: () => [
      { id: '1001', userId: 'u1', customerEmail: 'buyer@example.com', customerName: 'Real Buyer' },
      { id: '2002', userId: 'u1', customerEmail: 'other@example.com', customerName: 'Other Buyer' }
    ],
    loadDrips: () => drips,
    saveDrips: () => {},
    loadContacts: () => [],
    saveContacts: () => {}
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    post: async (body) => {
      const r = await fetch(`${base}/api/public/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    },
    close: () => new Promise(r => server.close(r))
  };
}

const review = (extra) => ({ email: 'buyer@example.com', name: 'Real Buyer', rating: 4, title: 'Nice', text: 'Works', ...extra });

test('no key on the server issues no token and accepts none, the source key included', (t) => {
  withKey(t, {});
  assert.equal(reviewSigningKey(), '');
  assert.equal(reviewTokenFor('1001', 'buyer@example.com'), '');
  assert.equal(reviewTokenValid('1001', 'buyer@example.com', generateReviewToken('1001', 'buyer@example.com', 'jourvance_review_sig_2026')), false);
});

test('the key is derived from the hub key and is never the hub key itself', (t) => {
  withKey(t, { HUB_API_KEY: 'zlk_test_value' });
  assert.ok(reviewSigningKey());
  assert.notEqual(reviewSigningKey(), 'zlk_test_value');
  const token = reviewTokenFor('1001', 'Buyer@Example.com');
  assert.ok(reviewTokenValid('1001', 'buyer@example.com', token));
  assert.equal(reviewTokenValid('1002', 'buyer@example.com', token), false, 'bound to the order');
});

test('an unsigned, forged or mismatched review is refused and nothing is stored', async (t) => {
  withKey(t, { HUB_API_KEY: 'zlk_test_value' });
  const rows = [];
  const s = await serve(rows);
  try {
    // NODE_ENV is unset here, as it is in the app's .env: that once waved every unsigned post through.
    assert.equal(process.env.NODE_ENV === 'production', false);
    for (let i = 0; i < 3; i++) assert.equal((await s.post(review({ orderId: `anything-${i}` }))).status, 403);
    const sourceKey = generateReviewToken('1001', 'buyer@example.com', 'jourvance_review_sig_2026');
    assert.equal((await s.post(review({ orderId: '1001', token: sourceKey }))).status, 403, 'the key written in the source signs nothing');
    assert.equal((await s.post(review({ orderId: '9999', token: reviewTokenFor('9999', 'buyer@example.com') }))).status, 403, 'a signed pair with no such order');
    assert.equal((await s.post(review({ orderId: '2002', token: reviewTokenFor('2002', 'buyer@example.com') }))).status, 403, 'the order is another buyer\'s');
    const noRating = await s.post(review({ orderId: '1001', rating: undefined, token: reviewTokenFor('1001', 'buyer@example.com') }));
    assert.equal(noRating.status, 400, 'a missing rating is not five stars');
    assert.equal(noRating.body.error, 'Choose a rating from 1 to 5 stars.');
    assert.deepEqual(rows, []);
  } finally {
    await s.close();
  }
});

test('a signed review for a real order saves once, with no invented reward and only safe photos', async (t) => {
  withKey(t, { HUB_API_KEY: 'zlk_test_value' });
  const rows = [];
  const s = await serve(rows);
  try {
    const token = reviewTokenFor('1001', 'buyer@example.com');
    const ok = await s.post(review({ orderId: '1001', token, rating: 2, photos: [EVIL, PNG] }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.reward, null, 'no code the merchant set, so no reward and no "$10 off"');
    assert.doesNotMatch(JSON.stringify(ok.body), /\$10|REVIEW10/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'u1');
    assert.equal(rows[0].rating, 2);
    assert.deepEqual(rows[0].photos, [PNG]);
    assert.equal(rows[0].discountCodeAwarded, '');
    const again = await s.post(review({ orderId: '1001', token }));
    assert.equal(again.status, 409);
    assert.equal(rows.length, 1, 'one link, one review');
  } finally {
    await s.close();
  }
});

test('a stored photo that could break out of its attribute never reaches the page, and photos are buttons', () => {
  const rows = [{ id: 'r1', userId: 'u1', rating: 5, customerName: 'Ann Lee', reviewTitle: 'Great', reviewText: 'Works', storeDomain: 'demo.myshopify.com', photos: [EVIL, 'https://img.example/ok.png?a=1&b=2'] }];
  setPublicContext({ hubStorage: memoryStore(rows), loadDiscounts: () => [] });
  let html;
  try {
    html = renderPublicFunnelHtml(page(), { query: {}, headers: {} });
  } finally {
    setPublicContext(null);
  }
  assert.doesNotMatch(html, /alert\(|img\.example\/a\.png/);
  assert.doesNotMatch(html, /openJvLightbox\('/, 'no photo URL inside a script string');
  assert.match(html, /<button type="button" class="jv-ugc-photo-thumb" data-jv-photo="https:\/\/img\.example\/ok\.png\?a=1&amp;b=2" aria-label="Open customer photo">/);
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Customer photo"/);
  assert.match(html, /<span>1 review<\/span>/);
  assert.doesNotMatch(html, /\d\+ Verified Client Reviews|verified community/);
  const wall = html.slice(html.indexOf('<section class="jv-ugc-wall"'), html.indexOf('</section>', html.indexOf('<section class="jv-ugc-wall"')));
  assert.ok(wall.length > 0);
  for (const m of wall.matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(m[1]) >= 11, `no wall text under 11px (${m[0]})`);
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
});

test('the rating covers reviews below the star threshold, so a low average is not shown as 5.0', () => {
  const rows = [5, 2, 1].map((rating, i) => ({ id: `r${i}`, userId: 'u1', rating, customerName: 'Ann Lee', reviewTitle: `T${i}`, reviewText: 'x', storeDomain: 'demo.myshopify.com' }));
  setPublicContext({ hubStorage: memoryStore(rows), loadDiscounts: () => [] });
  try {
    const html = renderPublicFunnelHtml(page(), { query: {}, headers: {} });
    assert.match(html, /★ 2\.7 \/ 5\.0/);
    assert.match(html, /<span>3 reviews<\/span>/);
    assert.match(html, /T0/);
    assert.doesNotMatch(html, /T1|T2/, 'the merchant\'s 4 star threshold still picks the cards');
  } finally {
    setPublicContext(null);
  }
});
