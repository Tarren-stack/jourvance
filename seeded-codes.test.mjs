import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupShopifyRoutes } from './server/routes/shopifyRoutes.mjs';

// C18: the server seeded SAVE10 into the cart and upsell recovery letters, fell back to it when a
// step had no code, sent it on every checkout reminder, counted any SAVE10 accept as a recovered
// sale, and made a 20% Shopify code when a caller named no amount. None of those codes was the
// merchant's choice.

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

async function serveDiscounts() {
  const saved = [];
  const ctx = new Proxy({
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadWorkspace: async (_uid, wsId) => ({ id: wsId, shopifyConfig: {} }),
    realStoreDomain: () => '',
    adminToken: () => '',
    loadDiscounts: () => [],
    saveDiscounts: (list) => { saved.push(list); },
    workspaceCache: {},
    FAKE_STORE_DOMAINS: new Set(),
    WEBHOOK_TOPICS: [],
    publicPageCache: {},
    DEFAULT_RFM_CONFIG: {}
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const app = express();
  app.use(express.json());
  setupShopifyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const r = await fetch(`${base}/api/workspace/ws1/shopify/create-discount`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: r.status, body: await r.json() };
  };
  return { post, saved, close: () => new Promise(r => server.close(r)) };
}

test('create-discount makes no code at an amount nobody chose', async () => {
  const s = await serveDiscounts();
  try {
    for (const body of [{ code: 'MINE' }, { code: 'MINE', value: 0 }, { code: 'MINE', value: 100 }, { code: 'MINE', value: 'abc' }, { code: 'MINE', discountType: 'bogus', value: 10 }, { code: 'MINE', discountType: 'fixed_amount' }]) {
      const r = await s.post(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.success, false);
    }
    assert.equal(s.saved.length, 0, 'a refused call saves nothing');
    const ok = await s.post({ code: 'mine', discountType: 'percentage', value: 12 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.discount.value, 12);
    assert.equal(ok.body.discount.code, 'MINE');
    const fixed = await s.post({ code: 'FIVE', discountType: 'fixed_amount', value: 5 });
    assert.equal(fixed.status, 200);
  } finally {
    await s.close();
  }
});

test('the recovery seeds, the sender and the checkout reminder carry no SAVE10 or 10% claim', () => {
  const src = read('./server.mjs');
  const seeds = src.slice(src.indexOf('const INITIAL_DRIP_SEQUENCES'), src.indexOf('function stripSeededVoucher'));
  const cart = seeds.slice(seeds.indexOf("id: 'drip_seq_cart_recovery'"), seeds.indexOf("id: 'drip_seq_upsell_recovery'"));
  const upsell = seeds.slice(seeds.indexOf("id: 'drip_seq_upsell_recovery'"), seeds.indexOf("id: 'drip_seq_at_risk_winback'"));
  for (const part of [cart, upsell]) {
    assert.doesNotMatch(part, /SAVE10|10%|\{\{discount_code\}\}/);
    assert.doesNotMatch(part, /discountVoucher: '[^']/);
  }
  assert.doesNotMatch(src, /\|\| 'SAVE10'/);
  const stage2 = src.slice(src.indexOf('// Stage 2:'), src.indexOf('chk.recoveryStatus = \'incentive_sent\''));
  assert.doesNotMatch(stage2, /SAVE10|10%|discountPercent: 10/);
  assert.match(stage2, /triggerType === 'checkout_abandonment'/);
  // loadDrips cleans a stored, unedited copy of the old seed as well as adding missing ones.
  assert.match(src, /if \(stripSeededVoucher\(data\)\) modified = true;/);
});

test('drips.json holds no seeded SAVE10, and analytics counts only a code a recovery enrolment was sent', () => {
  const drips = JSON.parse(read('./drips.json'));
  assert.ok(!JSON.stringify(drips).includes('SAVE10'));
  const analytics = read('./server/routes/analyticsRoutes.mjs');
  assert.doesNotMatch(analytics, /=== 'SAVE10'/);
  assert.match(analytics, /recoveryCodes\.has\(a\.discountCode\)/);
});
