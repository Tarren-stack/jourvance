import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupShopifyRoutes, ensureShopifyCoreDiscounts, provisionShopifyDiscount } from './server/routes/shopifyRoutes.mjs';
import { stripSeededOffers, merchantReviewCode, definedReferralRule, referralAmountText, SEEDED_DRAFT_STEPS } from './server/seededOffers.mjs';
import { renderPublicFunnelHtml, setPublicContext, setupPublicRoutes } from './server/routes/publicRoutes.mjs';
import { reviewTokenValid } from './server/reviewTokens.mjs';
import { generateReviewToken } from './server/reviewEngine.mjs';

// R24: the server made WELCOMEBACK15, SAVE10, SANCTUARY, REVIEW10 and GIVE15 in the merchant's live
// Shopify store without being asked, seeded the winback and review drips with 15% and $10 offers,
// stamped REVIEW10 on every review enrolment, filled WELCOMEBACK15 into every broadcast, and told
// cart abandoners "inventory is limited". None of it was the merchant's to say.

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const OFFER = /WELCOMEBACK15|REVIEW10|SAVE10|SANCTUARY|GIVE15|\d+\s?%|\$\s?\d|\{\{\s*discount_code\s*\}\}|courtesy (gift|reward|treat)/i;

// The seeds as server.mjs defines them, evaluated without booting the server.
function initialDripSequences() {
  const src = read('./server.mjs');
  const start = src.indexOf('const INITIAL_DRIP_SEQUENCES = [');
  const end = src.indexOf('\n];\n', start);
  assert.ok(start > 0 && end > start, 'server.mjs defines INITIAL_DRIP_SEQUENCES');
  return new Function(`return ${src.slice(src.indexOf('[', start), end + 2)}`)();
}

function stubCtx(extra = {}) {
  return new Proxy({
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    realStoreDomain: (cfg) => cfg?.storeDomain || '',
    adminToken: (cfg) => cfg?.token || '',
    loadDiscounts: () => [],
    saveDiscounts: () => {},
    workspaceCache: {},
    FAKE_STORE_DOMAINS: new Set(),
    WEBHOOK_TOPICS: [],
    publicPageCache: {},
    DEFAULT_RFM_CONFIG: {},
    userProgramBag: () => ({ rfmConfig: {} }),
    cleanRfmConfig: (c) => ({ allowUnlimitedDiscountUse: false, ...c }),
    // Wave 2: every starter flow is on unless an account turned it off (server.mjs starterFlowOnFor).
    starterFlowOnFor: () => true,
    ...extra
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

async function serve(ctx) {
  const app = express();
  app.use(express.json());
  setupShopifyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

// Records every call that would reach a Shopify store; lets loopback calls through.
function watchShopify() {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (/myshopify\.com/.test(String(url))) {
      calls.push(String(url));
      const body = JSON.parse(init?.body || '{}');
      return new Response(JSON.stringify(body.price_rule ? { price_rule: { id: 1 } } : { discount_code: { id: 2, code: body.discount_code?.code } }), { status: 201 });
    }
    return realFetch(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; }, realFetch };
}

test('saving the client settings or asking for core codes creates no code in a connected store', async () => {
  const ws = { id: 'ws1', userId: 'u1', shopifyConfig: { storeDomain: 'demo.myshopify.com', token: 'tok' } };
  const saved = [];
  const shop = watchShopify();
  try {
    for (const allow of [false, true]) {
      const made = await ensureShopifyCoreDiscounts(ws, allow, stubCtx({ saveDiscounts: (d) => saved.push(d) }));
      assert.deepEqual(made, []);
    }
    const s = await serve(stubCtx({ workspaceCache: { ws1: ws }, saveDiscounts: (d) => saved.push(d) }));
    try {
      const r = await shop.realFetch(`${s.base}/api/discounts/ensure-core`, { method: 'POST' });
      const body = await r.json();
      assert.equal(r.status, 200);
      assert.deepEqual(body.discounts, []);
      assert.equal(body.syncedToLiveShopify, false);
      assert.match(body.notice, /No codes were created/);
    } finally {
      await s.close();
    }
    assert.deepEqual(shop.calls, [], 'no request reached the store');
    assert.equal(saved.length, 0, 'no code was saved here either');
  } finally {
    shop.restore();
  }
});

test('a code with no amount is never provisioned, and a chosen amount still is', async () => {
  const ws = { id: 'ws1', shopifyConfig: { storeDomain: 'demo.myshopify.com', token: 'tok' } };
  const saved = [];
  const shop = watchShopify();
  try {
    const ctx = stubCtx({ saveDiscounts: (d) => saved.push(d) });
    assert.equal(await provisionShopifyDiscount(ws, { code: 'MINE' }, ctx), null);
    assert.equal(await provisionShopifyDiscount(ws, { code: 'MINE', value: 0 }, ctx), null);
    assert.deepEqual(shop.calls, []);
    const rule = await provisionShopifyDiscount(ws, { code: 'mine', value: 12 }, ctx);
    assert.equal(rule.code, 'MINE');
    assert.equal(rule.value, 12);
    assert.equal(shop.calls.length, 2, 'the chosen code reaches the store');
  } finally {
    shop.restore();
  }
});

test('the winback and review seeds carry no code, amount or offer', () => {
  const seeds = initialDripSequences();
  for (const id of ['drip_seq_at_risk_winback', 'drip_seq_review_request']) {
    const seq = seeds.find(s => s.id === id);
    assert.ok(seq, id);
    assert.doesNotMatch(`${seq.name} ${seq.description}`, OFFER, id);
    for (const step of seq.steps) {
      assert.equal(step.discountVoucher, '', `${id}/${step.id}`);
      assert.doesNotMatch(`${step.subject}\n${step.previewText}\n${step.body}`, OFFER, `${id}/${step.id}`);
      assert.doesNotMatch(`${step.subject}\n${step.previewText}\n${step.body}`, /—|\s–\s/, 'no em dash or spaced en dash');
    }
  }
  assert.match(seeds.find(s => s.id === 'drip_seq_review_request').steps[0].body, /\{\{review_url\}\}/);
});

test('the first checkout reminder makes no scarcity claim, and broadcasts fill no code', () => {
  const src = read('./server.mjs');
  const stage1 = src.slice(src.indexOf('// Stage 1:'), src.indexOf('// Stage 2:'));
  assert.ok(stage1.length > 100);
  assert.doesNotMatch(stage1, /inventory|limited|selling fast|only \d+ left/i);
  // Code only: a comment may name the old code to say why it is gone.
  const code = (p) => read(p).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const hits = (text, re) => text.split('\n').filter(l => re.test(l));
  assert.deepEqual(hits(code('./server/routes/emailRoutes.mjs'), /WELCOMEBACK15|SAVE10|SANCTUARY|15% (courtesy|winback)/), []);
  assert.deepEqual(hits(code('./server/routes/publicRoutes.mjs'), /discountCode: 'REVIEW10'/), []);
  assert.deepEqual(hits(code('./server/routes/shopifyRoutes.mjs'), /(code|discountCode): '(WELCOMEBACK15|SAVE10|SANCTUARY|REVIEW10|GIVE15)'/), []);
});

// The stored copy of the old seeds, word for word, as drips.json held them.
function oldStoredDrips() {
  return {
    sequences: [
      {
        id: 'drip_seq_at_risk_winback',
        description: 'Automatically re-engages clients who reach the at-risk inactivity threshold (90 days since last purchase) with a gentle check-in and 15% courtesy treat.',
        steps: [{ id: 'winback_step_1', subject: 'We miss you — a private 15% courtesy treat for your next ritual', previewText: 'x', body: 'Hello {{first_name}},\n\nTo welcome you back, we’ve placed a special 15% courtesy reward on your profile for your next restock:\n\nUse code {{discount_code}} at checkout.', discountVoucher: 'WELCOMEBACK15' }]
      },
      {
        id: 'drip_seq_review_request',
        description: 'Invites verified buyers 7 days after fulfillment to share their ritual feedback in exchange for a complimentary $10 courtesy gift voucher (REVIEW10).',
        steps: [
          { id: 'review_step_1', subject: 'How is your new ritual feeling? (A $10 treat inside)', previewText: 'x', body: 'As a heartfelt thank you, we will instantly gift you $10 toward your next replenishment.\n\n{{review_url}}', discountVoucher: 'REVIEW10' },
          { id: 'review_step_2', subject: 'Quick reminder: Your $10 beauty treat is waiting', previewText: 'x', body: 'Just a gentle reminder that your private $10 courtesy gift is still waiting for you.\n\n{{review_url}}', discountVoucher: 'REVIEW10' }
        ]
      }
    ],
    enrollments: [
      { id: 'e1', sequenceId: 'drip_seq_at_risk_winback', status: 'active', discountCode: 'WELCOMEBACK15' },
      { id: 'e2', sequenceId: 'drip_seq_review_request', status: 'active', discountCode: 'REVIEW10' },
      { id: 'e3', sequenceId: 'drip_seq_review_request', status: 'completed', discountCode: 'REVIEW10' }
    ]
  };
}

test('a stored, unedited copy of an old offer seed takes the new words and loses the code', () => {
  const seeds = initialDripSequences();
  const data = oldStoredDrips();
  assert.equal(stripSeededOffers(data, seeds), true);
  for (const seq of data.sequences) {
    const seed = seeds.find(s => s.id === seq.id);
    assert.equal(seq.description, seed.description);
    for (const step of seq.steps) {
      const fresh = seed.steps.find(st => st.id === step.id);
      assert.deepEqual({ subject: step.subject, body: step.body, discountVoucher: step.discountVoucher }, { subject: fresh.subject, body: fresh.body, discountVoucher: '' });
    }
  }
  assert.equal(data.enrollments[0].discountCode, '');
  assert.equal(data.enrollments[1].discountCode, '');
  assert.equal(data.enrollments[2].discountCode, 'REVIEW10', 'a finished enrolment is history and is left alone');
  assert.equal(stripSeededOffers(data, seeds), false, 'a second pass changes nothing');
});

test('a step the merchant rewrote, or a code they kept, stays theirs', () => {
  const seeds = initialDripSequences();
  const data = oldStoredDrips();
  data.sequences[0].steps[0].body = 'Our own words. Use {{discount_code}} for 15% off.';
  data.sequences[1].steps[1].body = 'Our own reminder with {{discount_code}}.';
  stripSeededOffers(data, seeds);
  assert.equal(data.sequences[0].steps[0].discountVoucher, 'WELCOMEBACK15');
  assert.equal(data.sequences[0].steps[0].body, 'Our own words. Use {{discount_code}} for 15% off.');
  assert.equal(data.enrollments[0].discountCode, 'WELCOMEBACK15');
  // Step 1 of the review sequence was the seed and is cleaned; step 2 still names REVIEW10, so the
  // enrolments keep the code the merchant's own letter uses.
  assert.equal(data.sequences[1].steps[0].discountVoucher, '');
  assert.equal(data.sequences[1].steps[1].discountVoucher, 'REVIEW10');
  assert.equal(data.enrollments[1].discountCode, 'REVIEW10');
  assert.equal(merchantReviewCode(data), 'REVIEW10');
});

test('a fulfillment enrols the review request with the merchant code, or none', async (t) => {
  const saved = process.env.HUB_API_KEY;
  process.env.HUB_API_KEY = 'test-hub-key';
  t.after(() => { if (saved === undefined) delete process.env.HUB_API_KEY; else process.env.HUB_API_KEY = saved; });
  const seeds = initialDripSequences();
  for (const [voucher, expected] of [['', ''], ['THANKS5', 'THANKS5']]) {
    const drips = { sequences: structuredClone(seeds), enrollments: [] };
    drips.sequences.find(s => s.id === 'drip_seq_review_request').steps[0].discountVoucher = voucher;
    const ctx = stubCtx({
      acceptShopifyWebhook: () => ({ userId: 'u1' }),
      loadOrders: () => [{ id: 'o1', userId: 'u1', customerEmail: 'a@b.test', customerName: 'Ann' }],
      sendTransactional: async () => ({ ok: true }),
      enrollFlowsForTrigger: async () => ({ added: 0 }),
      orderMailVars: () => ({}),
      loadDrips: () => drips,
      saveDrips: () => {}
    });
    const s = await serve(ctx);
    try {
      const r = await fetch(`${s.base}/api/webhooks/shopify/fulfillments-create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'f1', order_id: 'o1', email: 'a@b.test' })
      });
      assert.equal(r.status, 200);
    } finally {
      await s.close();
    }
    const enr = drips.enrollments.find(e => e.sequenceId === 'drip_seq_review_request');
    assert.ok(enr, 'the buyer was enrolled');
    assert.equal(enr.discountCode, expected);
    // The link is signed with this server's key, which the review route accepts; the key written in
    // reviewEngine.mjs is not it (a key in the source is a key anyone can sign with).
    const token = new URL(enr.reviewUrl, 'https://x.test').searchParams.get('token');
    assert.ok(reviewTokenValid('o1', 'a@b.test', token), 'the emailed link can save a review');
    assert.notEqual(token, generateReviewToken('o1', 'a@b.test', 'jourvance_review_sig_2026'));
  }
});

test('Email Studio drafts and labels name no code, amount or gift the merchant did not set', () => {
  const src = read('./src/components/campaign/HubEmailSuite.tsx');
  // D9, Wave 5: the written broadcast drafts moved with the composer, so both files are read.
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  // A placeholder that says "e.g." is a hint, never sent.
  const offers = `${src}\n${composer}`.split('\n').filter(l => !/placeholder="e\.g\./.test(l)).filter(l => /WELCOMEBACK15|SAVE10|SANCTUARY|REVIEW10|\d+% (off|courtesy|reconnect|winback)|15% Winback|complimentary|courtesy gift/i.test(l));
  assert.deepEqual(offers, []);
  // The single-use safeguard only steered the codes the server made on its own.
  assert.doesNotMatch(src, /unlimitedDiscountToggle|Auto-Synced|Shopify Voucher:/);
  // At least one match, so a moved draft is a failure here and never a scan that checks nothing.
  const drafts = composer.match(/setBroadcast(Subject|PreviewText|Body)\([^;]*\);/g) || [];
  assert.ok(drafts.length > 0, 'BroadcastComposer.tsx holds no setBroadcastSubject, setBroadcastPreviewText or setBroadcastBody call');
  for (const draft of drafts) {
    assert.doesNotMatch(draft, /—|\s–\s/, draft);
  }
});

test('Shopify Sync sends the amount as typed and shows the reason a code was refused', () => {
  const src = read('./src/components/modals/ShopifySyncModal.tsx');
  assert.doesNotMatch(src, /parseFloat\(discValue\)\s*\|\|/);
  assert.match(src, /const \[discValue, setDiscValue\] = useState\(''\)/);
  assert.match(src, /setDiscountError\(data\?\.error \|\| /);
  assert.match(src, /\{discountError && \(\s*<div role="alert"/);
});

// The referral links the review portal shares (?ref=GIVE15-<name>&coupon=GIVE15) used to put a $15
// banner on the page and GIVE15 on the checkout, a code the server created in every store. It no
// longer creates it, so the page offers GIVE15 only where the merchant has defined it (R24).
const REF_QUERY = { ref: 'GIVE15-SARAH-4A1B', coupon: 'GIVE15' };
const refPage = () => ({
  slug: 'glow', userId: 'u1',
  data: { headline: 'Night Serum', discountCode: '', shopifyVariantId: '4444444444' },
  shopifyConfig: { storeDomain: 'demo.myshopify.com', currency: 'USD' }
});
const renderWith = (discounts, query = REF_QUERY) => {
  setPublicContext({ loadDiscounts: () => discounts, realStoreDomain: (c) => c?.storeDomain || '', realVariantId: (v) => String(v || '') });
  try {
    return renderPublicFunnelHtml(refPage(), { query, headers: {} });
  } finally {
    setPublicContext(null);
  }
};
const bannerText = (html) => {
  const m = html.match(/class="jv-referral-banner"[\s\S]*?<\/div>/);
  return m ? m[0].replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

test('a referral link offers nothing when the merchant has not defined GIVE15', () => {
  for (const discounts of [[], [{ code: 'GIVE15', value: 15, status: 'active', storeDomain: 'other.myshopify.com' }], [{ code: 'GIVE15', value: 15, status: 'inactive' }]]) {
    const html = renderWith(discounts);
    assert.equal(bannerText(html), '');
    assert.match(html, /const discountCode = "";/);
    assert.doesNotMatch(html, /\$15|welcome courtesy|Code: <strong>GIVE15/);
    // The ref itself still tags the cart for attribution; it is not an offer.
    assert.match(html, /const referralCode = "GIVE15-SARAH-4A1B";/);
    assert.deepEqual(html.split('\n').filter(l => l.includes('GIVE15')).map(l => l.trim()), ['const referralCode = "GIVE15-SARAH-4A1B";']);
  }
});

test('a referral link offers GIVE15 at the amount the merchant set for this store', () => {
  let html = renderWith([{ code: 'GIVE15', discountType: 'percentage', value: 20, status: 'active', storeDomain: 'demo.myshopify.com' }]);
  assert.equal(bannerText(html), "VIP Friend Invitation Your friend's code GIVE15 (20% off) is applied at checkout");
  assert.match(html, /const discountCode = "GIVE15";/);
  html = renderWith([{ code: 'GIVE15', discountType: 'fixed_amount', value: 15, status: 'active' }]);
  assert.match(bannerText(html), /GIVE15 \(\$15\.00 off\) is applied at checkout/, 'a rule saved before rules recorded their store still counts');
  assert.doesNotMatch(bannerText(html), /—|\s–\s/);
  // With no store currency a fixed amount is not guessed at.
  assert.equal(referralAmountText({ discountType: 'fixed_amount', value: 15 }, ''), '');
  assert.equal(definedReferralRule([{ code: 'GIVE15', value: 15 }], ''), null, 'no store, no checkout, no offer');
});

test('the lead form sends GIVE15 to checkout only when the merchant defined it', async () => {
  const page = refPage();
  const run = async (discounts, ref) => {
    const app = express();
    app.use(express.json());
    setupPublicRoutes(app, new Proxy({
      publicPageCache: { glow: page },
      domainRegistryCache: {},
      workspaceCache: {},
      loadDiscounts: () => discounts,
      realStoreDomain: (c) => c?.storeDomain || '',
      realVariantId: (v) => String(v || ''),
      realTrackingId: (v) => String(v || ''),
      loadContacts: () => [],
      loadDrips: () => ({ sequences: [], enrollments: [] }),
      userProgramBag: () => ({}),
      signupFormsFor: () => [],
      attachBehavior: () => ({}),
      deliverLetter: async () => ({ ok: false }),
      pushKlaviyoContact: async () => {},
      noteSegmentChanges: async () => {},
      klaviyoIsSender: () => false,
      publicBase: () => 'http://127.0.0.1'
    }, { get: (t, k) => (k in t ? t[k] : undefined) }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/public/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
        body: JSON.stringify({ slug: 'glow', email: 'friend@example.com', name: 'Friend', ref })
      });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return new URL(body.checkoutUrl).searchParams.get('discount');
    } finally {
      await new Promise(r => server.close(r));
      setPublicContext(null);
    }
  };
  assert.equal(await run([], 'GIVE15-SARAH-4A1B'), null, 'no code the store lacks');
  assert.equal(await run([{ code: 'GIVE15', value: 15, status: 'active', storeDomain: 'demo.myshopify.com' }], 'GIVE15-SARAH-4A1B'), 'GIVE15');
  assert.equal(await run([{ code: 'GIVE15', value: 15, status: 'active', storeDomain: 'demo.myshopify.com' }], 'recovery'), null, 'a ref that is not a referral link applies no referral code');
});

test('a discount rule records its store and never takes over another store\'s rule', async () => {
  const stored = [{ id: 'd_other', code: 'GIVE15', value: 10, discountType: 'percentage', storeDomain: 'other.myshopify.com', status: 'active' }];
  const ws = { id: 'ws1', shopifyConfig: { storeDomain: 'demo.myshopify.com', token: 'tok' } };
  const shop = watchShopify();
  try {
    let saved = null;
    const rule = await provisionShopifyDiscount(ws, { code: 'GIVE15', value: 15, discountType: 'fixed_amount' }, stubCtx({ loadDiscounts: () => stored.map(d => ({ ...d })), saveDiscounts: (d) => { saved = d; } }));
    assert.equal(rule.storeDomain, 'demo.myshopify.com');
    assert.equal(saved.length, 2);
    assert.deepEqual(saved.find(d => d.id === 'd_other'), stored[0], 'the other store keeps its rule');
  } finally {
    shop.restore();
  }
});

test('the winback step auto-winback sends unattended is a finished note, and the earlier draft heals', () => {
  const seeds = initialDripSequences();
  const seq = seeds.find(s => s.id === 'drip_seq_at_risk_winback');
  for (const text of [seq.description, ...seq.steps.flatMap(st => [st.subject, st.previewText, st.body])]) {
    assert.doesNotMatch(text, /Replace (this|it|the|each)|before anyone receives it/i, text);
  }
  const data = { sequences: [{ id: 'drip_seq_at_risk_winback', description: 'Checks in with clients who reach the at-risk inactivity threshold (90 days since last purchase). Replace the note before anyone receives it.', steps: [{ id: 'winback_step_1', subject: 'It has been a little while', body: SEEDED_DRAFT_STEPS[0].body, discountVoucher: '' }] }], enrollments: [] };
  assert.equal(stripSeededOffers(data, seeds), true);
  assert.equal(data.sequences[0].steps[0].body, seq.steps[0].body);
  assert.equal(data.sequences[0].description, seq.description);
  assert.equal(stripSeededOffers(data, seeds), false);
  const edited = { sequences: [{ id: 'drip_seq_at_risk_winback', steps: [{ id: 'winback_step_1', body: 'Our own note.', discountVoucher: '' }] }], enrollments: [] };
  assert.equal(stripSeededOffers(edited, seeds), false, 'the merchant\'s own note is left alone');
});

// The social proof wall fell back to written sample reviews ("Elena V.", verified buyer) and a
// "148+ Verified Client Reviews, 4.9" summary on every page, and read the review store through the
// hub SDK client, which has no get or set, so no real review was ever stored or shown (R24).
const memoryStore = (rows) => ({
  rows,
  get: (key, _file, fallback) => (key === 'store.reviews' ? rows : fallback),
  set: (key, _file, data) => { if (key === 'store.reviews') { rows.splice(0, rows.length, ...data); } }
});
const review = (id, userId, rating = 5, extra = {}) => ({ id, userId, rating, customerName: `Buyer ${id}`, reviewTitle: `Title ${id}`, reviewText: `Text ${id}`, storeDomain: 'demo.myshopify.com', ...extra });
const wallOf = (rows) => {
  setPublicContext({ hubStorage: memoryStore(rows), loadDiscounts: () => [] });
  try {
    return renderPublicFunnelHtml(refPage(), { query: {}, headers: {} });
  } finally {
    setPublicContext(null);
  }
};

test('a page with no stored review shows no reviews, rating or count', () => {
  for (const rows of [[], [review('r_def', 'usr_default'), review('r_none', undefined), review('r_other', 'u2')]]) {
    const html = wallOf(rows);
    assert.doesNotMatch(html, /Verified Client Reviews|Elena V\.|Camilla R\.|148|4\.9 \/ 5|Loved by Thousands/);
    assert.doesNotMatch(html, /Title r_def|Title r_none|Title r_other/, 'another merchant\'s or an unowned review is not this page\'s');
  }
});

test('a page shows its own stored reviews, counted and averaged from all of them', () => {
  const html = wallOf([review('r1', 'u1', 5), review('r2', 'u1', 4), review('r3', 'u1', 2), review('r_def', 'usr_default', 5), review('r_hidden', 'u1', 5, { hidden: true })]);
  assert.match(html, /Title r1/);
  assert.match(html, /Title r2/);
  assert.doesNotMatch(html, /Title r3|Title r_def|Title r_hidden/);
  // The star threshold and hiding choose the cards; the rating covers every review the owner holds:
  // (5 + 4 + 2 + 5) / 4. Worked out from the shown cards alone it read 4.5, and before that 5.0 for
  // a merchant whose reviews averaged 2.7.
  assert.match(html, /4\.0 \/ 5\.0/);
  assert.match(html, /<span>4 reviews<\/span>/);
  assert.doesNotMatch(html, /\d\+ Verified Client Reviews|verified community/);
  assert.doesNotMatch(html, /Elena V\.|148|Loved by Thousands/);
  assert.match(html, /Customer reviews/);
});

test('the public reviews API answers with real reviews only, and hiding one takes its owner', async () => {
  const rows = [review('r1', 'u1'), review('r_other', 'u2')];
  const app = express();
  app.use(express.json());
  const signedIn = (uid) => (req, res, next) => { if (!uid) return res.status(401).json({ success: false }); req.user = { uid }; next(); };
  let who = '';
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { glow: refPage(), empty: { ...refPage(), slug: 'empty', userId: 'u3' } },
    domainRegistryCache: {},
    workspaceCache: {},
    hubStorage: memoryStore(rows),
    requireUser: (req, res, next) => signedIn(who)(req, res, next),
    realStoreDomain: (c) => c?.storeDomain || ''
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await (await fetch(`${base}/api/public/reviews/glow`)).json();
    assert.deepEqual(r.reviews.map(x => x.id), ['r1']);
    assert.equal(r.summary.totalCount, 1);
    r = await (await fetch(`${base}/api/public/reviews/empty`)).json();
    assert.deepEqual(r.reviews, []);
    assert.deepEqual(r.summary, { averageRating: null, totalCount: 0 });
    const hide = (id) => fetch(`${base}/api/reviews/${id}/visibility`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: true }) });
    assert.equal((await hide('r1')).status, 401, 'signed out');
    who = 'u2';
    assert.equal((await hide('r1')).status, 404, 'another merchant\'s review answers like a missing one');
    assert.equal(rows.find(x => x.id === 'r1').hidden, undefined);
    who = 'u1';
    assert.equal((await hide('r1')).status, 200);
    assert.equal(rows.find(x => x.id === 'r1').hidden, true);
  } finally {
    await new Promise(r => server.close(r));
    setPublicContext(null);
  }
});
