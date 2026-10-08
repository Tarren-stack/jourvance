// Serving a landing page built with the page builder (LANDING_BUILDER_PLAN.md, wave 1b, second half).
// Drives the real public route over HTTP with a PUBLISHED record: the record is made by the real
// publish route (journey-publish.test.mjs style) from the design document's section 1 page, then
// served through setupPublicRoutes. What is held here:
// - the response is a 200 HTML page with the root, the scoped <style>, both media queries, the
//   Google Fonts link for the listed families, the pixels when ids are set, the jv_vid snippet, the
//   lead body fields, the checkout button, and no <script> inside the page body;
// - the number of <script> elements is pinned, so a new one cannot arrive unnoticed;
// - a record without `builder` answers exactly what the legacy snapshot fixtures hold;
// - a record whose builder is invalid (planted after publish) answers 200 with today's page for the
//   same record, never a 500, and says so in the log;
// - the frame pieces (lead modal, exit drawer, sticky bar, review viewer) appear only when asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import {
  renderPublicFunnelHtml,
  setPublicContext,
  setupPublicRoutes,
  withTracking,
  pageTrackFrom
} from './server/routes/publicRoutes.mjs';
import { leadBodyScript, LEAD_BODY_FIELDS } from './server/routes/publicLeadScript.mjs';
import { createNode, insertNode, migrateLegacyPage, validateBuilderDoc } from './src/lib/pageBuilder/model.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';

const VARIANT = 'gid://shopify/ProductVariant/123';
const BUMP = 'gid://shopify/ProductVariant/456';
const SHOP = { storeDomain: 'shop.myshopify.com', currency: 'USD', status: 'connected' };
const starter = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.data.type === 'landing-page');

/** The design doc's section 1 page, with the copy the starter leaves empty filled in, a tablet layer added and a real product. */
function designDoc(extra = {}) {
  const doc = migrateLegacyPage({
    ...starter.data,
    headline: 'Glow in seven days',
    subhead: 'A serum made in small batches.',
    bullets: ['Fragrance free', 'Ships in 2 days'],
    buttonText: 'Get the serum',
    shopifyVariantId: VARIANT,
    shopifyProductId: 'gid://shopify/Product/9',
    shopifyProductTitle: 'Glow Serum',
    shopifyProductPrice: '48.00',
    shopifyProductImage: 'https://cdn.example.com/serum.jpg',
    ...extra
  });
  doc.sections[0].style.tablet = { paddingTop: 20 };
  return doc;
}

function put(doc, columnIndex, widgetType, props = {}, at = 99) {
  const n = createNode('widget', widgetType);
  n.props = { ...n.props, ...props };
  const col = doc.sections[0].children[columnIndex];
  const r = insertNode(doc, col.id, Math.min(at, col.children.length), n);
  assert.equal(r.ok, true, r.reason);
  return r.doc;
}

// ---- publish with the real route, serve with the real public routes ----

function journeyWith(data) {
  return {
    id: 'j1',
    nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', ...data } }],
    edges: []
  };
}

async function publishRecord(data) {
  const saved = {};
  const store = { journey: journeyWith(data) };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_uid, _id, j) => { store.journey = j; return { durable: true }; },
    loadWorkspace: async (_uid, wsId) => ({ id: wsId, shopifyConfig: SHOP }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: async () => ({ ok: true, log: null }),
    savePublishLog: async () => ({ durable: true }),
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.parse('2026-10-08T10:00:00.000Z')
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/journey/j1/publish`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return { record: structuredClone(saved.offer), node: store.journey.nodes[0] };
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

const memoryStore = (rows) => ({
  rows,
  get: (key, _file, fallback) => (key === 'store.reviews' ? rows : fallback),
  set: () => {}
});
const aReview = (id, userId, rating = 5, extra = {}) => ({ id, userId, rating, customerName: `Buyer ${id}`, reviewTitle: `Title ${id}`, reviewText: `Text ${id}`, storeDomain: 'shop.myshopify.com', ...extra });

async function fetchPage(record, { path = '/p/offer', headers = {}, ctx = {}, cacheExtra = {} } = {}) {
  const app = express();
  app.use(express.json());
  const cache = { [record.slug]: record, ...cacheExtra };
  setupPublicRoutes(app, new Proxy({
    publicPageCache: cache,
    domainRegistryCache: {},
    workspaceCache: {},
    loadDiscounts: () => [],
    realStoreDomain: (c) => c?.storeDomain || '',
    realVariantId: (v) => (/^42109840/.test(String(v || '')) ? '' : String(v || '').trim()),
    realTrackingId: (v) => String(v || '').trim(),
    loadContacts: () => [],
    signupFormsFor: () => [],
    publicBase: () => 'http://127.0.0.1',
    ...ctx
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
    return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() };
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    setPublicContext(null);
  }
}

const scripts = (html) => [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

async function builderPage(extraData = {}, doc = designDoc()) {
  const { record, node } = await publishRecord({ headline: 'Glow in seven days', subhead: 'A serum made in small batches.', builder: doc, ...extraData });
  // The publish route takes the store from the workspace; this harness has none, so the record is
  // given the connected store the live workspace would have stamped.
  record.shopifyConfig = { ...SHOP };
  return { record, node, doc };
}

// ---- the page ----

test('a published builder page is served as 200 HTML with the root, its scoped style, both media queries and the fonts', async () => {
  const { record, doc } = await builderPage();
  const r = await fetchPage(record);
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/html/);
  assert.match(r.body, /^<!DOCTYPE html>/);

  const out = render(doc, { slug: 'offer' });
  assert.deepEqual(out.problems, []);
  assert.match(r.body, /<div id="jvb-root" class="jvb">/);
  assert.match(r.body, /<style id="jvb-style">/);
  const style = r.body.match(/<style id="jvb-style">\n([\s\S]*?)\n  <\/style>/)?.[1] || '';
  assert.ok(style.length > 500, 'the page style is there');
  assert.ok(style.split('\n').filter(l => l && !l.startsWith('@media') && !l.startsWith('}')).every(l => l.startsWith('#jvb-root')), 'every rule is scoped to the root');
  assert.match(style, /@media \(max-width: 1024px\)\{/);
  assert.match(style, /@media \(max-width: 640px\)\{/);
  assert.ok(style.indexOf('@media (max-width: 1024px)') < style.indexOf('@media (max-width: 640px)'), 'tablet before mobile');
  assert.equal(style, out.css.replace(/\n$/, ''), 'the style is the renderer\'s css, byte for byte');

  // The Google Fonts link names the families the page lists, and only those.
  assert.deepEqual(out.fonts, ['Playfair Display', 'Outfit']);
  const link = r.body.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css\?family=[^"]+)" rel="stylesheet">/)?.[1];
  assert.ok(link, 'a fonts stylesheet link is there');
  assert.match(link, /family=Playfair\+Display:[0-9,]+\|Outfit:[0-9,]+&display=swap$/);

  // Head tags.
  assert.match(r.body, /<title>Glow in seven days \| Official Store<\/title>/);
  assert.match(r.body, /<meta name="description" content="A serum made in small batches\.">/);
  assert.match(r.body, /<meta property="og:image" content="https:\/\/cdn\.example\.com\/serum\.jpg">/);

  // The widgets the frame binds.
  assert.match(r.body, /<button id="main-cta-btn" type="button"[^>]*data-jvb-cta/);
  assert.match(r.body, />Get the serum</);
  assert.match(r.body, /Glow in seven days<\/h1>/);
  assert.match(r.body, /<img id="product-img" src="https:\/\/cdn\.example\.com\/serum\.jpg"/);
});

test('the tracking frame is wrapped around it: jv_vid, consent, the event beacon and the product the beacon reports', async () => {
  const { record } = await builderPage();
  const r = await fetchPage(record);
  assert.match(r.body, /window\.jourvanceVisitor = function/);
  assert.match(r.body, /jv_vid/);
  assert.match(r.body, /window\.jourvanceCanTrack = function/);
  assert.match(r.body, /Cookie|cookie/);
  assert.match(r.body, /window\.jourvanceTrack\('product_viewed', \{"productId":"[^"]*9","variantId":"[^"]*123","price":"48\.00"\}\)/, 'the beacon reads the first productHero');
  assert.deepEqual(pageTrackFrom(record), { productId: '9', variantId: '123', price: '48.00', collectionId: '' });
});

test('the pixels are written when their ids are set, and not when they are not', async () => {
  const none = await fetchPage((await builderPage()).record);
  for (const needle of ['fbevents.js', 'analytics.tiktok.com', 'googletagmanager.com']) assert.ok(!none.body.includes(needle), `${needle} absent without an id`);
  const { record } = await builderPage({ metaPixelId: '123456789012345', tiktokPixelId: 'C1ABCDEFGHIJKLMNOP', ga4TrackingId: 'G-ABC123XYZ9' });
  const r = await fetchPage(record);
  assert.match(r.body, /connect\.facebook\.net\/en_US\/fbevents\.js/);
  assert.match(r.body, /fbq\('init', "123456789012345"\)/);
  assert.match(r.body, /analytics\.tiktok\.com\/i18n\/pixel\/events\.js/);
  assert.match(r.body, /ttq\.load\("C1ABCDEFGHIJKLMNOP"\)/);
  assert.match(r.body, /googletagmanager\.com\/gtag\/js\?id=G-ABC123XYZ9/);
  assert.match(r.body, /gtag\('config', "G-ABC123XYZ9"\)/);
});

test('the lead modal posts the legacy body: every field of the design, in order', async () => {
  const { record } = await builderPage();
  const r = await fetchPage(record);
  assert.match(r.body, /<div id="lead-modal">/);
  assert.ok(r.body.includes(leadBodyScript()), 'the modal post is publicLeadScript.mjs\'s text');
  const body = leadBodyScript();
  let at = -1;
  for (const f of LEAD_BODY_FIELDS) {
    const i = body.search(new RegExp(`(^|\\s)${f}\\b`, 'm'));
    assert.ok(i > at, `${f} in order`);
    at = i;
  }
});

test('a lead form widget posts the same body from its own inputs and carries the hidden fields', async () => {
  let doc = designDoc();
  doc = put(doc, 1, 'leadForm', { afterSubmit: 'message', successText: 'You are on the list.' });
  const { record } = await builderPage({}, doc);
  const r = await fetchPage(record);
  assert.match(r.body, /<form class="jvb-n-[^"]+ jvb-w jvb-lead" data-jvb-lead data-jvb-after="message" data-jvb-success="You are on the list\."/);
  assert.ok(r.body.includes(leadBodyScript({ emailExpr: 'f.email.value', nameExpr: 'f.name.value', phoneExpr: 'f.phone.value' })));
  for (const hidden of ['slug', 'variant', 'currency', 'order_bump_selected', 'utm_source', 'utm_content', 'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref']) {
    assert.match(r.body, new RegExp(`<input type="hidden" name="${hidden}" value="[^"]*">`), hidden);
  }
});

test('no script element sits inside the page body, and the number of script elements is pinned', async () => {
  const { record, doc } = await builderPage();
  const out = render(doc, { slug: 'offer', formatPrice: p => `$${p}`, currency: 'USD', storeDomain: 'shop.myshopify.com' });
  const r = await fetchPage(record);
  const at = r.body.indexOf('<div id="jvb-root"');
  assert.ok(at > 0);
  assert.equal(r.body.slice(at, at + out.html.length), out.html, 'the root is the renderer\'s markup');
  assert.ok(!out.html.includes('<script'), 'the markup holds no script');

  // The page document alone: one frame script, nothing else (no pixel ids set).
  assert.equal(scripts(renderPublicFunnelHtml(record, { query: {}, headers: {} }, null)).length, 1);
  // With every pixel: meta 1, tiktok 1, ga4 2 (loader and config), plus the frame's 1.
  const all = (await builderPage({ metaPixelId: '123456789012345', tiktokPixelId: 'C1ABCDEFGHIJKLMNOP', ga4TrackingId: 'G-ABC123XYZ9' })).record;
  assert.equal(scripts(renderPublicFunnelHtml(all, { query: {}, headers: {} }, null)).length, 5);
  // Through the route the tracking snippet and the cookie notice add one each: 1 + 1 + 1, pinned.
  const viaRoute = scripts(r.body);
  assert.equal(viaRoute.length, 3, `route page scripts: ${viaRoute.join(' | ')}`);
  // Every one of them parses.
  for (const s of inlineScripts(r.body)) assert.doesNotThrow(() => new vm.Script(s));
});

test('every frame script variant parses, with exit drawer, sticky bar, review viewer and store-less lead form', async () => {
  const { record } = await builderPage({ exitIntentEnabled: true, exitIntentHeadline: 'Wait', exitIntentDiscountCode: 'STAY10' });
  const full = renderPublicFunnelHtml(record, { query: {}, headers: {} }, null);
  for (const s of inlineScripts(full)) assert.doesNotThrow(() => new vm.Script(s));
  const noStore = renderPublicFunnelHtml({ ...record, shopifyConfig: {} }, { query: {}, headers: {} }, null);
  for (const s of inlineScripts(noStore)) assert.doesNotThrow(() => new vm.Script(s));
});

test('the exit drawer and the sticky bar appear only when the page turns them on', async () => {
  const off = await fetchPage((await builderPage({ mobileStickyBarEnabled: false })).record);
  assert.ok(!off.body.includes('id="jv-exit-drawer"'), 'no exit drawer without a headline');
  assert.ok(!off.body.includes('id="jv-mobile-sticky-bar"'), 'no sticky bar when switched off');
  assert.ok(!off.body.includes('id="jvb-lightbox"'), 'no review viewer without a photo');

  const { record } = await builderPage({ exitIntentEnabled: true, exitIntentHeadline: 'Wait, take a code', exitIntentDiscountCode: 'STAY10' });
  const on = await fetchPage(record);
  assert.match(on.body, /<div id="jv-exit-drawer" role="dialog"/);
  assert.match(on.body, /Wait, take a code/);
  assert.match(on.body, /var exitCode = "STAY10";/);
  assert.match(on.body, /<div id="jv-mobile-sticky-bar"/);
  assert.match(on.body, />\s*Get the serum\s*<\/button>\s*<\/div>/, 'the sticky button carries the checkout button\'s label');
  assert.match(on.body, /id="jv-sticky-product-price" data-base-price="48\.00"/);

  // An exit headline with the switch off is not published either.
  const switchedOff = await fetchPage((await builderPage({ exitIntentEnabled: false, exitIntentHeadline: 'Wait' })).record);
  assert.ok(!switchedOff.body.includes('id="jv-exit-drawer"'));
});

test('a verified review reaches the wall and opens the photo viewer; another owner\'s review does not', async () => {
  const doc = designDoc();
  const { record } = await builderPage({}, doc);
  record.userId = 'u1';
  const rows = [
    aReview('r1', 'u1', 5, { photos: ['https://cdn.example.com/p1.jpg'] }),
    aReview('r2', 'u2', 5),
    aReview('r3', 'usr_default', 5)
  ];
  const r = await fetchPage(record, { ctx: { hubStorage: memoryStore(rows) } });
  assert.match(r.body, /Title r1/);
  assert.doesNotMatch(r.body, /Title r2|Title r3/);
  assert.match(r.body, /data-jv-photo="https:\/\/cdn\.example\.com\/p1\.jpg"/);
  assert.match(r.body, /<div id="jvb-lightbox" role="dialog"/);
  assert.match(r.body, /\[data-jv-photo\]/, 'the frame script opens it');
  const none = await fetchPage({ ...record, userId: 'u9' }, { ctx: { hubStorage: memoryStore(rows) } });
  assert.doesNotMatch(none.body, /Title r|id="jvb-lightbox"/);
});

test('a placeholder variant is refused in the one place the frame refuses it: no title, price or id is published', async () => {
  const placeholder = '42109840192';
  const doc = designDoc({ shopifyVariantId: placeholder });
  const { record } = await builderPage({}, doc);
  const r = await fetchPage(record);
  assert.doesNotMatch(r.body, /Glow Serum|48\.00|data-variant-id="42109840192"/);
  assert.deepEqual(pageTrackFrom(record).price, '', 'and the beacon reports no invented price');
});

test('the seeded sample trust line is dropped on a builder page exactly as on the legacy page', async () => {
  const seeded = 'Trusted by 4.9/5 verified customers';
  const own = 'Free returns for 30 days';
  const doc = designDoc({ trustBadge: seeded });
  assert.ok(!JSON.stringify(doc).includes('jvb-trust'));
  const withSeed = put(doc, 1, 'trustBadge', { text: seeded });
  const rb = await fetchPage((await builderPage({}, withSeed)).record);
  assert.doesNotMatch(rb.body, /4\.9\/5/, 'builder page');
  const legacy = renderPublicFunnelHtml({ slug: 'x', data: { headline: 'H', buttonText: 'B', trustBadge: seeded }, shopifyConfig: SHOP }, { query: {}, headers: {} }, null);
  assert.doesNotMatch(legacy, /4\.9\/5/, 'legacy page');
  const withOwn = put(designDoc(), 1, 'trustBadge', { text: own });
  assert.match((await fetchPage((await builderPage({}, withOwn)).record)).body, /Free returns for 30 days/);
});

test('a referral link applies GIVE15 to the cart only when the merchant defined it, as on the legacy page', async () => {
  const { record } = await builderPage();
  const q = '/p/offer?ref=GIVE15-SARAH-4A1B';
  const none = await fetchPage(record, { path: q });
  assert.match(none.body, /const vipCode = "";/);
  assert.match(none.body, /const referralCode = "GIVE15-SARAH-4A1B";/);
  assert.doesNotMatch(none.body, /VIP Friend Invitation/);
  const rule = [{ code: 'GIVE15', discountType: 'percentage', value: 20, status: 'active', storeDomain: 'shop.myshopify.com' }];
  const some = await fetchPage(record, { path: q, ctx: { loadDiscounts: () => rule } });
  assert.match(some.body, /const vipCode = "GIVE15";/);
  assert.match(some.body, /VIP Friend Invitation/);
});

test('with no store the checkout button opens a lead form that says it only saves details', async () => {
  const { record } = await builderPage();
  const r = await fetchPage({ ...record, shopifyConfig: {} });
  assert.match(r.body, /const leadOnly = true;/);
  assert.match(r.body, /Leave your email/);
  assert.match(r.body, /<span id="btn-text">Send<\/span>/);
});

test('a custom domain serves the same builder page', async () => {
  const { record } = await builderPage();
  const page = { ...record, customDomain: 'offer.example.com', customDomainVerified: true, userId: 'u1' };
  const r = await fetchPage(page, {
    path: '/',
    headers: { 'x-forwarded-host': 'offer.example.com' },
    cacheExtra: { 'domain:offer.example.com': 'offer' },
    ctx: { domainRegistryCache: { 'offer.example.com': { verified: true, userId: 'u1' } } }
  });
  assert.equal(r.status, 200);
  assert.match(r.body, /<div id="jvb-root" class="jvb">/);
  assert.match(r.body, /window\.jourvanceVisitor = function/);
});

test('version B is not served: a builder page answers version A, and sets no split cookie', async () => {
  const { record } = await builderPage({ abTestingEnabled: true, splitRatio: 0, variantB: { headline: 'Version B headline' } });
  const html = renderPublicFunnelHtml({ ...record, data: { ...record.data, abTestingEnabled: true, splitRatio: 0, variantB: { headline: 'Version B headline' } } }, { query: { var: 'b' }, headers: {} }, null);
  assert.doesNotMatch(html, /Version B headline/);
  assert.match(html, /const activeVariant = 'a';/);
});

// ---- the record ----

test('the record holds the builder once, at the top, and the fingerprint still moves with the design', async () => {
  const a = await builderPage();
  assert.ok(a.record.builder, 'top level');
  assert.equal('builder' in a.record.data, false);
  assert.equal('builderB' in a.record.data, false);
  assert.ok(a.node.data.builder, 'the journey node keeps its own copy for the editor');
  assert.equal(validateBuilderDoc(a.record.builder).ok, true);

  const changed = designDoc();
  changed.sections[0].children[1].children[0].props.text = 'A different headline';
  const b = await builderPage({}, changed);
  assert.match(a.record.contentFingerprint, /^c\d+:[0-9a-f]+$/);
  assert.notEqual(a.record.contentFingerprint, b.record.contentFingerprint, 'editing the design changes the fingerprint');
});

// ---- legacy, and a builder that is not drawable ----

const FIXTURE = (name) => fs.readFileSync(new URL(`./test-fixtures/legacy-pages/${name}.html`, import.meta.url), 'utf8');

test('a record without builder answers exactly what the legacy snapshot holds, through the route too', async () => {
  const page = { slug: 'min', data: { headline: 'Hello', buttonText: 'Buy' }, shopifyConfig: {} };
  const golden = FIXTURE('landing-minimal-nostore');
  assert.equal(renderPublicFunnelHtml(page, { query: {}, headers: {}, params: {} }, null), golden);
  for (const variant of [{ ...page }, { ...page, builder: null }, { ...page, builder: undefined }]) {
    const r = await fetchPage(variant, { path: '/p/min' });
    assert.equal(r.status, 200);
    assert.ok(r.body.startsWith(golden.slice(0, golden.lastIndexOf('</body>'))), 'the page is the golden up to the frame');
    assert.ok(!r.body.includes('jvb-root'));
  }
});

test('a builder that stopped validating after publish falls back to today\'s page, 200, logged, never a 500', async () => {
  const { record } = await builderPage();
  const planted = structuredClone(record);
  planted.builder.sections[0].children[0].children[0].type = 'notAWidget';
  assert.equal(validateBuilderDoc(planted.builder).ok, false, 'precondition: the planted document is invalid');

  const logged = [];
  const orig = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  let r;
  try {
    r = await fetchPage(planted);
  } finally {
    console.error = orig;
  }
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('jvb-root'), 'no half-drawn builder page');
  const legacy = renderPublicFunnelHtml({ ...record, builder: undefined }, { query: {}, headers: {}, params: {} }, null);
  assert.ok(r.body.startsWith(legacy.slice(0, legacy.lastIndexOf('</body>'))), 'it is the legacy page for the same record');
  assert.match(r.body, /Glow in seven days/, 'data still holds the flat fields');
  assert.ok(logged.some(l => /\[builder\] page "offer"/.test(l)), `logged: ${logged.join(' | ')}`);
  // The beacon falls back to the flat fields too, since the page that is served reads them.
  assert.equal(pageTrackFrom(planted).variantId, '');
});

test('a builder of the wrong shape (a string, an array, a number) is not drawable either and never throws', async () => {
  const { record } = await builderPage();
  const orig = console.error;
  console.error = () => {};
  try {
    for (const bad of ['x', [], 7, { version: 1 }, { version: 9, theme: {}, sections: [] }]) {
      const html = renderPublicFunnelHtml({ ...record, builder: bad }, { query: {}, headers: {} }, null);
      assert.equal(typeof html, 'string');
      assert.ok(!html.includes('jvb-root'), JSON.stringify(bad));
    }
  } finally {
    console.error = orig;
  }
});

test('withTracking is not applied twice: the route adds the frame once', async () => {
  const { record } = await builderPage();
  const r = await fetchPage(record);
  assert.equal((r.body.match(/window\.jourvanceCanTrack = function/g) || []).length, 1);
  const direct = withTracking(renderPublicFunnelHtml(record, { query: {}, headers: {} }, null), 'offer', 'a', true, pageTrackFrom(record), {});
  assert.ok(direct.includes('</body>'));
});

// ---- the lead route reads a builder page's product, bump and code from its widgets ----

async function postLead(record, body) {
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { [record.slug]: record },
    domainRegistryCache: {},
    workspaceCache: {},
    loadDiscounts: () => [],
    realStoreDomain: (c) => c?.storeDomain || '',
    realVariantId: (v) => (/^42109840/.test(String(v || '')) ? '' : String(v || '').trim()),
    loadContacts: () => [],
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    signupFormsFor: () => [],
    attachBehavior: () => ({}),
    publicBase: () => 'http://127.0.0.1'
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/public/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body)
    });
    return { status: r.status, json: await r.json() };
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    setPublicContext(null);
  }
}

test('the lead route builds the cart link from the builder\'s widgets, not from stale flat fields', async () => {
  let doc = designDoc();
  doc = put(doc, 1, 'orderBump', { variantId: BUMP, headline: 'Add the travel size', title: 'Travel size', price: '12.00' });
  doc.sections[0].children[1].children.find(n => n.type === 'checkoutButton').props.discountCode = 'WIDGET10';
  const { record } = await builderPage({ shopifyVariantId: '999', orderBumpVariantId: '888', discountCode: 'FLAT5' }, doc);
  record.data = { ...record.data, shopifyVariantId: '999', orderBumpVariantId: '888', discountCode: 'FLAT5' };
  const withBump = await postLead(record, { slug: 'offer', email: 'ada@example.com', order_bump_selected: true, variant: 'a' });
  assert.equal(withBump.status, 200);
  assert.match(withBump.json.checkoutUrl, /^https:\/\/shop\.myshopify\.com\/cart\/gid:\/\/shopify\/ProductVariant\/123:1,gid:\/\/shopify\/ProductVariant\/456:1\?/);
  assert.match(withBump.json.checkoutUrl, /discount=WIDGET10/);
  assert.doesNotMatch(withBump.json.checkoutUrl, /999|888|FLAT5/);
  const without = await postLead(record, { slug: 'offer', email: 'grace@example.com', order_bump_selected: false, variant: 'a' });
  assert.match(without.json.checkoutUrl, /\/cart\/gid:\/\/shopify\/ProductVariant\/123:1\?/);
  assert.doesNotMatch(without.json.checkoutUrl, /456/);

  // A record with no builder keeps reading its flat fields.
  const legacy = await postLead({ ...record, builder: undefined }, { slug: 'offer', email: 'x@example.com', order_bump_selected: true, variant: 'a' });
  assert.match(legacy.json.checkoutUrl, /\/cart\/999:1,888:1\?/);
  assert.match(legacy.json.checkoutUrl, /discount=FLAT5/);
});
