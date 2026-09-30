// T13: the tool never offers a shopper money, a gift or a code the merchant did not set, and never
// assumes their product category. The SMS drafts named WELCOMEBACK15, 15% and 10% off and a free
// gift; the signup presets saved WELCOME15, SANCTUARY, FREESHIP and WELCOME10 on the form, and the
// lead route minted a code of that name in the merchant's store for every visitor who signed up;
// the checkout recovery email said "We saved your beauty essentials"; and the review portal offered
// "Give $15, Get $15" and a GIVE15 link whether or not the store had GIVE15. These pin all four.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { SMS_STARTERS, smsStarterText, SIGNUP_PRESETS, NEW_FORM_COPY, SEEDED_SIGNUP_FORMS } from './src/lib/offerPresets.ts';
import { seededSignupForm, stripSeededSignupForm, stripSeededOffers, SEEDED_WORDING } from './server/seededOffers.mjs';
import { setupPublicRoutes } from './server/routes/publicRoutes.mjs';
import { renderReviewPortalHtml } from './server/reviewEngine.mjs';
import { reviewTokenFor } from './server/reviewTokens.mjs';

// A code, an amount, a gift or shipping offer, or a product category the merchant never wrote.
const INVENTED = /\b(WELCOME1[05]|WELCOMEBACK15|SANCTUARY|FREESHIP|GIVE15|SAVE10|REVIEW10)\b|\d+\s*%|\$\s*\d|\b(free|complimentary)\b|\bgifts?\b|\bsamples?\b|\bshipping\b|\bdelivery\b|\b(beauty|skin|skincare|ritual|botanical|glow|serum)\b/i;
const code = (src) => src.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

test('SMS starters and signup presets carry no code, amount, gift or product category', () => {
  for (const row of SMS_STARTERS) {
    assert.doesNotMatch(row.text, INVENTED, row.id);
    assert.doesNotMatch(row.label, INVENTED, row.id);
    assert.equal(smsStarterText(row.id), row.text, 'no code is added unless the merchant typed one');
  }
  assert.equal(smsStarterText('cart', ' SPRING5 '), `${SMS_STARTERS[2].text} Use code SPRING5 at checkout.`, 'the merchant\'s own code goes in as typed');
  for (const preset of [...SIGNUP_PRESETS, { name: 'new form', summary: '', ...NEW_FORM_COPY }]) {
    assert.equal('coupon' in preset, false, `${preset.name} saves no coupon`);
    for (const field of ['name', 'summary', 'headline', 'body', 'buttonText', 'successMessage', 'teaser', 'teaserClosed']) {
      assert.doesNotMatch(String(preset[field] ?? ''), INVENTED, `${preset.name}.${field}`);
    }
  }
});

test('the SMS panel and signup forms hard-code no offer, fallback code or category', () => {
  const sms = code(fs.readFileSync('src/components/campaign/SmsPanel.tsx', 'utf8'));
  assert.doesNotMatch(sms, /WELCOMEBACK15|courtesy (treat|discount)|complimentary gift|beauty|self-care ritual|jourvance\.com\/r\//i);
  assert.match(sms, /useState<string>\(''\)/, 'the composer starts empty');
  const forms = code(fs.readFileSync('src/components/campaign/SignupForms.tsx', 'utf8'));
  assert.doesNotMatch(forms, /WELCOME1[05]|SANCTUARY|FREESHIP|BEAUTY_PRESETS|Skincare|Botanical|Ritual|samples|surprise gifts/i);
  assert.doesNotMatch(forms, /coupon: \{ name: '|name \|\| '[A-Z]/, 'no form is saved with a coupon the merchant did not type');
  assert.match(forms, /\{code && \(\s*<div[^>]*>\s*<Sparkles[^>]*\/>\s*<span>Exclusive Offer<\/span>/, 'the offer pill shows only with a code');
});

test('the unattended checkout recovery email names no product category', () => {
  const server = fs.readFileSync('server.mjs', 'utf8');
  assert.doesNotMatch(code(server), /beauty essentials|Your items are saved|complete your ritual|to your routine/);
  assert.equal((server.match(/subject: 'You left something in your cart'/g) || []).length, 2, 'the seed and the stage 1 send');
  assert.match(server, /\{ kind: 'heading', text: 'You left something in your cart' \}/);
  // A stored, unedited copy of the old seed takes the new words; the merchant's own words stay.
  const seeds = [
    { id: 'drip_seq_cart_recovery', steps: [{ id: 'cart_step_1', subject: 'You left something in your cart', body: 'new body' }] },
    { id: 'drip_seq_upsell_recovery', steps: [{ id: 'upsell_rec_step_1', previewText: 'In case you still wanted it', body: 'new upsell' }] }
  ];
  const old = (seqId, stepId, field) => SEEDED_WORDING.find(w => w.seqId === seqId && w.stepId === stepId && w.field === field).old;
  const data = {
    sequences: [
      { id: 'drip_seq_cart_recovery', steps: [{ id: 'cart_step_1', subject: old('drip_seq_cart_recovery', 'cart_step_1', 'subject'), body: old('drip_seq_cart_recovery', 'cart_step_1', 'body') }] },
      { id: 'drip_seq_upsell_recovery', steps: [{ id: 'upsell_rec_step_1', previewText: old('drip_seq_upsell_recovery', 'upsell_rec_step_1', 'previewText'), body: 'The merchant wrote this.' }] }
    ],
    enrollments: []
  };
  assert.equal(stripSeededOffers(data, seeds), true);
  assert.deepEqual(data.sequences[0].steps[0], { id: 'cart_step_1', subject: 'You left something in your cart', body: 'new body' });
  assert.equal(data.sequences[1].steps[0].previewText, 'In case you still wanted it');
  assert.equal(data.sequences[1].steps[0].body, 'The merchant wrote this.', 'the merchant\'s own body is left alone');
  assert.equal(stripSeededOffers(data, seeds), false, 'a second pass changes nothing');
});

test('an old preset form is read with no code and plain words; a form the merchant rewrote keeps its code', () => {
  // Each old preset as the old UI saved it: every word, the teasers no editor ever showed, the coupon.
  const asSaved = (seed, extra = {}) => ({ id: 'form_old', enabled: true, coupon: { name: seed.code, discountType: 'percentage', value: seed.value, prefix: '' }, ...seed.words, ...extra });
  for (const seed of SEEDED_SIGNUP_FORMS) {
    const stored = asSaved(seed);
    assert.ok(seededSignupForm(stored), seed.code);
    const read = stripSeededSignupForm(stored);
    assert.equal(read.coupon, null, `${seed.code} is not the merchant's`);
    for (const field of ['headline', 'body', 'buttonText', 'successMessage', 'teaser', 'teaserClosed']) {
      assert.doesNotMatch(read[field], INVENTED, `${seed.code}.${field}`);
    }
    assert.equal(stripSeededSignupForm(read), read, 'reading it again changes nothing');
    assert.equal(stored.coupon.name, seed.code, 'the stored row is not mutated');

    // Anything the merchant changed in the editor makes the form theirs, teasers and all.
    const changed = [
      ['every word the editor shows', { headline: 'Get 10% off with our VIP list', body: 'Sign up and get 10% off your first order.', buttonText: 'Get my 10%', successMessage: 'Your 10% code is below.' }],
      ['only the headline', { headline: 'Get 10% off with our VIP list' }],
      ['only the button', { buttonText: 'Get my code' }],
      ['only the success message', { successMessage: 'Your code is below.' }],
      ['only the amount', { coupon: { name: seed.code, discountType: 'percentage', value: seed.value + 5, prefix: '' } }],
      ['a code prefix', { coupon: { name: seed.code, discountType: 'percentage', value: seed.value, prefix: 'VIP' } }]
    ];
    for (const [what, extra] of changed) {
      const mine = asSaved(seed, extra);
      assert.equal(mine.teaser, seed.words.teaser, 'the old preset teaser is still stored, as it is on every real form');
      assert.equal(seededSignupForm(mine), null, `${seed.code}: ${what}`);
      assert.equal(stripSeededSignupForm(mine), mine, `${seed.code}: ${what} keeps its code and words`);
    }
  }
  const rewritten = { id: 'form_mine', coupon: { name: 'WELCOME15', discountType: 'percentage', value: 15 }, headline: 'Our spring list', body: 'Hear from us.', successMessage: 'Thanks.' };
  assert.equal(seededSignupForm(rewritten), null);
  assert.equal(stripSeededSignupForm(rewritten), rewritten, 'a code on the merchant\'s own copy is theirs, even an old preset name');
  assert.equal(stripSeededSignupForm({ id: 'form_x', coupon: null, headline: SEEDED_SIGNUP_FORMS[0].words.headline }).coupon, null);
});

// The lead route also appends to server/routes/contacts.json (a gitignored local copy); the rows
// this test adds are taken back out afterwards, leaving any other row as it was.
const LOCAL_CONTACTS = new URL('./server/routes/contacts.json', import.meta.url);
function dropLocalContacts(emails) {
  try {
    const rows = JSON.parse(fs.readFileSync(LOCAL_CONTACTS, 'utf8'));
    fs.writeFileSync(LOCAL_CONTACTS, JSON.stringify(rows.filter(row => !emails.includes(row.email)), null, 2), 'utf8');
  } catch {}
}

async function serveLead(forms, emails) {
  // The contact is already on the account when the coupon is granted, as the server's own store has it.
  const contacts = emails.map(email => ({ email, userId: 'u1', properties: {} }));
  const minted = [];
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { glow: { slug: 'glow', userId: 'u1', data: { headline: 'Offer' }, shopifyConfig: {} } },
    domainRegistryCache: {},
    workspaceCache: {},
    hubStorage: { get: (_k, _f, fallback) => fallback, set: () => {} },
    signupFormsFor: () => forms,
    loadContacts: () => contacts,
    saveContacts: (rows) => { if (rows !== contacts) contacts.splice(0, contacts.length, ...rows); },
    mintCoupon: async (_uid, _email, spec) => { minted.push(spec.name); return `${spec.name}-AB12`; },
    userProgramBag: () => ({ couponCodes: [] }),
    realStoreDomain: (c) => c?.storeDomain || '',
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    saveDrips: () => {}
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    minted,
    signup: async (formId, email) => {
      const r = await fetch(`${base}/api/public/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'glow', email, formId }) });
      return { status: r.status, body: await r.json() };
    },
    close: () => new Promise(r => server.close(r))
  };
}

test('a signup mints only a code the merchant set', async (t) => {
  const old = SEEDED_SIGNUP_FORMS[0];
  const forms = [
    { id: 'form_none', enabled: true, optIn: 'single', coupon: null, headline: 'Join our email list', slices: [] },
    { id: 'form_old', enabled: true, optIn: 'single', coupon: { name: old.code, discountType: 'percentage', value: old.value }, ...old.words, slices: [] },
    { id: 'form_mine', enabled: true, optIn: 'single', coupon: { name: 'HELLO20', discountType: 'percentage', value: 20 }, headline: 'Our list', slices: [] },
    // The old preset as saved, teasers included, with every word the editor shows rewritten around its code.
    { id: 'form_kept', enabled: true, optIn: 'single', coupon: { name: old.code, discountType: 'percentage', value: old.value }, ...old.words, headline: 'Get 15% off your first order', body: 'Join our list for 15% off.', buttonText: 'Get my 15%', successMessage: 'Your 15% code is below.', slices: [] }
  ];
  const emails = ['offer-a@example.com', 'offer-b@example.com', 'offer-c@example.com', 'offer-d@example.com'];
  const lead = await serveLead(forms, emails);
  t.after(async () => { await lead.close(); dropLocalContacts(emails); });

  const none = await lead.signup('form_none', emails[0]);
  assert.equal(none.status, 200);
  assert.equal(none.body.coupon, '', 'no code set, none minted');
  const oldPreset = await lead.signup('form_old', emails[1]);
  assert.equal(oldPreset.status, 200);
  assert.equal(oldPreset.body.coupon, '', 'an older saved form carrying the preset coupon mints nothing');
  assert.equal(oldPreset.body.couponNote, '', 'and claims no code failed');
  assert.deepEqual(lead.minted, []);

  const mine = await lead.signup('form_mine', emails[2]);
  assert.equal(mine.body.coupon, 'HELLO20-AB12', 'the merchant\'s own code still works');
  const kept = await lead.signup('form_kept', emails[3]);
  assert.equal(kept.body.coupon, 'WELCOME15-AB12', 'a preset name the merchant kept on their own copy is theirs');
  assert.deepEqual(lead.minted, ['HELLO20', 'WELCOME15']);
});

const portal = (extra = {}) => renderReviewPortalHtml({
  orderId: '1099', email: 'seraphina@example.com', storeName: 'Aura', storeDomain: 'aura.myshopify.com', slug: 'serum', verified: true, ...extra
});

test('the review portal shows the referral card only for the merchant\'s own GIVE15, at their amount', () => {
  const none = portal();
  assert.doesNotMatch(none, /class="jv-ambassador-box"/, 'no rule, no card');
  assert.doesNotMatch(none, /GIVE15(?!-)|\$15|Give \$|gift straight to your inbox/, 'and no GIVE15 link or $15 promise');

  const pct = portal({ referralRule: { code: 'GIVE15', discountType: 'percentage', value: 20 }, currency: 'USD' });
  assert.match(pct, /class="jv-ambassador-box"/);
  assert.match(pct, /your friend gets 20% off with code <strong[^>]*>GIVE15<\/strong>/);
  assert.match(pct, /ref=GIVE15-SERAPHIN-[0-9A-F]{4}&amp;coupon=GIVE15/);
  assert.match(pct, /sms:\?&body=[^"]*20%25%20off/);
  assert.doesNotMatch(pct, /\$15|Give \$|Get \$|to your inbox|ritual|beauty|glow/i, 'no amount the merchant did not set, no reward nothing sends, no category');

  const fixed = portal({ referralRule: { code: 'GIVE15', discountType: 'fixed_amount', value: 12 }, currency: 'USD' });
  assert.match(fixed, /your friend gets \$12\.00 off with code/);
  const unstated = portal({ referralRule: { code: 'GIVE15', discountType: 'fixed_amount', value: 12 }, currency: '' });
  assert.match(unstated, /your friend can check out with code <strong[^>]*>GIVE15/, 'an amount it cannot state is not guessed');
  assert.doesNotMatch(portal({ storeDomain: '', referralRule: { code: 'GIVE15', value: 10 } }), /class="jv-ambassador-box"/, 'no store, no link');
});

test('GET /review passes the store\'s GIVE15 rule to the portal', async (t) => {
  const names = ['REVIEW_SECRET', 'MAIL_LINK_SECRET', 'HUB_API_KEY'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  process.env.REVIEW_SECRET = 'offer-presets-test-key';
  t.after(() => { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } });

  const open = async (discounts) => {
    const app = express();
    setupPublicRoutes(app, new Proxy({
      publicPageCache: {},
      domainRegistryCache: {},
      workspaceCache: { ws1: { userId: 'u1', brandName: 'Aura', shopifyConfig: { storeDomain: 'aura.myshopify.com', currency: 'USD' } } },
      hubStorage: { get: (_k, _f, fallback) => fallback, set: () => {} },
      loadDiscounts: () => discounts,
      realStoreDomain: (c) => c?.storeDomain || '',
      loadOrders: () => [{ id: '1001', userId: 'u1', customerEmail: 'buyer@example.com' }],
      loadDrips: () => ({ sequences: [], enrollments: [] })
    }, { get: (tt, k) => (k in tt ? tt[k] : undefined) }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const token = reviewTokenFor('1001', 'buyer@example.com');
    const r = await fetch(`http://127.0.0.1:${server.address().port}/review?order=1001&email=buyer@example.com&token=${token}`);
    const html = await r.text();
    await new Promise(r2 => server.close(r2));
    return html;
  };
  const without = await open([]);
  assert.match(without, /Submit review/, 'the verified form renders');
  assert.doesNotMatch(without, /class="jv-ambassador-box"/);
  const otherStore = await open([{ code: 'GIVE15', discountType: 'percentage', value: 10, status: 'active', storeDomain: 'other.myshopify.com' }]);
  assert.doesNotMatch(otherStore, /class="jv-ambassador-box"/, 'a rule for another store does not count');
  const withRule = await open([{ code: 'GIVE15', discountType: 'fixed_amount', value: 15, status: 'active', storeDomain: 'aura.myshopify.com' }]);
  assert.match(withRule, /your friend gets \$15\.00 off with code/, 'the merchant\'s own $15, in their currency');
});
