import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { cleanWooUrl, wooHmacOk, setupWooCommerceRoutes } from './server/routes/woocommerceRoutes.mjs';
import { presentWorkspace } from './server/routes/authWorkspaceRoutes.mjs';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import {
  renderPublicFunnelHtml,
  renderPublicUpsellHtml,
  setupPublicRoutes,
  setPublicContext,
  publicPageCache,
  cleanWebhookUrl
} from './server/routes/publicRoutes.mjs';
import { sectionSummary } from './src/lib/pageEditorSections.ts';

function mockApp() {
  const routes = new Map();
  return {
    routes,
    get(p, ...h) { routes.set(`GET ${p}`, h[h.length - 1]); },
    post(p, ...h) { routes.set(`POST ${p}`, h[h.length - 1]); },
    put(p, ...h) { routes.set(`PUT ${p}`, h[h.length - 1]); },
    delete(p, ...h) { routes.set(`DELETE ${p}`, h[h.length - 1]); },
    options(p, ...h) { routes.set(`OPTIONS ${p}`, h[h.length - 1]); },
    use() {}
  };
}

function callHandler(handler, reqOverrides = {}) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers = {};
    const req = {
      params: {},
      query: {},
      headers: {},
      body: {},
      socket: { remoteAddress: '203.0.113.10' },
      ...reqOverrides
    };
    const res = {
      status(code) { statusCode = code; return this; },
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      set(k, v) { headers[k.toLowerCase()] = v; return this; },
      json(payload) { resolve({ status: statusCode, headers, body: payload }); return this; },
      send(payload) { resolve({ status: statusCode, headers, body: payload }); return this; },
      sendStatus(code) { resolve({ status: code, headers, body: null }); return this; }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('cleanWooUrl normalizes WordPress URLs and rejects SSRF / private / malformed hosts', () => {
  assert.equal(cleanWooUrl('https://mystore.com/'), 'https://mystore.com');
  assert.equal(cleanWooUrl('http://mystore.com///'), 'https://mystore.com');
  assert.equal(cleanWooUrl('  https://shop.brand.org/store/  '), 'https://shop.brand.org/store');
  assert.equal(cleanWooUrl(''), '');
  assert.equal(cleanWooUrl(null), '');

  // SSRF and private network rejections
  assert.equal(cleanWooUrl('http://localhost'), '');
  assert.equal(cleanWooUrl('https://127.0.0.1'), '');
  assert.equal(cleanWooUrl('http://169.254.169.254/latest/meta-data'), '');
  assert.equal(cleanWooUrl('https://10.0.0.1'), '');
  assert.equal(cleanWooUrl('https://172.16.0.5'), '');
  assert.equal(cleanWooUrl('https://192.168.1.1'), '');
  assert.equal(cleanWooUrl('https://[::1]'), '');
  assert.equal(cleanWooUrl('https://store.local'), '');
  assert.equal(cleanWooUrl('https://admin:secret@mystore.com'), '');
  assert.equal(cleanWooUrl('https://mystore.com:8080'), '');
  assert.equal(cleanWooUrl('https://mystore.com/?foo=bar'), '');
  assert.equal(cleanWooUrl('https://mystore.com/../secret'), '');
});

test('presentWorkspace strips WooCommerce secrets and sets consumerSecretOnFile', () => {
  const ws = {
    id: 'ws_1',
    name: 'Glow Studio',
    woocommerceConfig: {
      storeUrl: 'https://glow.example.com',
      consumerKey: 'ck_live_123',
      consumerSecret: 'cs_super_secret_value',
      webhookSecret: 'whsec_hidden',
      status: 'connected'
    }
  };
  const out = presentWorkspace(ws);
  assert.equal(out.woocommerceConfig.storeUrl, 'https://glow.example.com');
  assert.equal(out.woocommerceConfig.consumerKey, 'ck_live_123');
  assert.equal(out.woocommerceConfig.consumerSecretOnFile, true);
  assert.equal('consumerSecret' in out.woocommerceConfig, false);
  assert.equal('webhookSecret' in out.woocommerceConfig, false);
  // Original object is not mutated
  assert.equal(ws.woocommerceConfig.consumerSecret, 'cs_super_secret_value');
});

test('wooHmacOk verifies valid HMAC-SHA256 base64 signatures and rejects forgeries', () => {
  const rawBody = Buffer.from(JSON.stringify({ id: 501, total: '64.00' }), 'utf8');
  const secret = 'cs_test_secret_999';
  const validSig = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

  assert.equal(wooHmacOk(rawBody, validSig, secret), true);
  assert.equal(wooHmacOk(rawBody, 'invalid_sig', secret), false);
  assert.equal(wooHmacOk(rawBody, validSig, 'wrong_secret'), false);
  assert.equal(wooHmacOk(rawBody, '', secret), false);
  assert.equal(wooHmacOk(null, validSig, secret), false);
});

test('POST /api/webhooks/woocommerce/:wsId enforces HMAC, attributes orders, updates contacts, and emits analytics events', async () => {
  const app = mockApp();
  const orders = [];
  const contacts = [];
  const events = [];
  const workspaces = {
    ws_woo: {
      id: 'ws_woo',
      userId: 'usr_owner_1',
      woocommerceConfig: {
        storeUrl: 'https://glow.example.com',
        consumerKey: 'ck_123',
        consumerSecret: 'cs_webhook_secret_key',
        status: 'connected'
      }
    }
  };
  const pageCache = {
    'rose-peel': {
      slug: 'rose-peel',
      userId: 'usr_owner_1',
      journeyId: 'j_woo_1',
      nodeId: 'node-page-1',
      data: { headline: 'Rose Peel' }
    }
  };

  setupWooCommerceRoutes(app, {
    requireAuth: (_req, _res, next) => next(),
    loadWorkspace: async (_uid, id) => workspaces[id] || null,
    saveWorkspace: async () => {},
    workspaceCache: workspaces,
    loadOrders: () => orders,
    saveOrders: (next) => { if (next !== orders) { orders.length = 0; orders.push(...next); } },
    loadContacts: () => contacts,
    saveContacts: (next) => { if (next !== contacts) { contacts.length = 0; contacts.push(...next); } },
    recordEvent: (evt) => events.push(evt),
    publicPageCache: pageCache
  });

  const webhookHandler = app.routes.get('POST /api/webhooks/woocommerce/:wsId');
  assert.ok(webhookHandler, 'webhook route is registered');

  // 1. Unknown workspace -> 404
  const notFoundRes = await callHandler(webhookHandler, {
    params: { wsId: 'ws_missing' },
    body: { id: 900 }
  });
  assert.equal(notFoundRes.status, 404);

  // 2. Missing or forged signature -> 401
  const payload = {
    id: 777,
    number: 'WC-777',
    total: '89.00',
    currency: 'USD',
    billing: {
      email: 'Elena@Example.com',
      first_name: 'Elena',
      last_name: 'Rostova',
      phone: '+15550199'
    },
    meta_data: [
      { key: 'jv_slug', value: 'rose-peel' },
      { key: 'jv_vid', value: 'jv_vis_42' },
      { key: 'utm_source', value: 'instagram' },
      { key: 'utm_campaign', value: 'spring_glow' }
    ],
    line_items: [
      { name: 'Rose Hydrating Peel', product_id: 44, quantity: 1, total: '89.00' }
    ]
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

  const unsignedRes = await callHandler(webhookHandler, {
    params: { wsId: 'ws_woo' },
    headers: { 'x-wc-webhook-signature': 'forged_signature' },
    body: payload,
    rawBody
  });
  assert.equal(unsignedRes.status, 401);
  assert.equal(orders.length, 0);

  // 3. Valid HMAC signature -> 200, order saved, contact tagged, analytics event emitted
  const validSig = crypto.createHmac('sha256', 'cs_webhook_secret_key').update(rawBody).digest('base64');
  const validRes = await callHandler(webhookHandler, {
    params: { wsId: 'ws_woo' },
    headers: { 'x-wc-webhook-signature': validSig },
    body: payload,
    rawBody
  });
  assert.equal(validRes.status, 200);
  assert.equal(validRes.body.success, true);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].userId, 'usr_owner_1');
  assert.equal(orders[0].attributedSlug, 'rose-peel');
  assert.equal(orders[0].journeyId, 'j_woo_1');
  assert.equal(orders[0].totalPrice, 89);
  assert.equal(orders[0].platform, 'woocommerce');

  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].email, 'elena@example.com');
  assert.ok(contacts[0].tags.includes('WooCommerce Buyer'));
  assert.equal(contacts[0].totalSpent, 89);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'order');
  assert.equal(events[0].slug, 'rose-peel');
  assert.equal(events[0].amount, 89);
  assert.equal(pageCache['rose-peel'].data.liveOrders, 1);
  assert.equal(pageCache['rose-peel'].data.liveRevenue, 89);

  // 4. Duplicate delivery is idempotent
  const dupRes = await callHandler(webhookHandler, {
    params: { wsId: 'ws_woo' },
    headers: { 'x-wc-webhook-signature': validSig },
    body: payload,
    rawBody
  });
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.body.duplicate, true);
  assert.equal(orders.length, 1);
  assert.equal(events.length, 1);
});

test('renderPublicFunnelHtml, renderPublicUpsellHtml, and POST /api/public/lead wire checkoutUrl and woocommerceConfig', async () => {
  // 1. Landing page with direct checkoutUrl (e.g. Stripe Payment Link or Google Calendar schedule)
  const stripePage = {
    slug: 'bridal-consult',
    userId: 'usr_owner_1',
    journeyId: 'j_1',
    nodeId: 'node-page-1',
    data: {
      headline: 'Bridal Glow Consultation',
      buttonText: 'Book Your Session',
      checkoutUrl: 'https://calendar.google.com/calendar/appointments/schedules/abc123',
      checkoutMode: 'direct'
    }
  };
  const stripeHtml = renderPublicFunnelHtml(stripePage, { query: { var: 'a' }, headers: {} });
  assert.match(stripeHtml, /const leadOnly = false;/);
  assert.match(stripeHtml, /https:\/\/calendar\.google\.com\/calendar\/appointments\/schedules\/abc123/);

  // 2. Landing page with WooCommerce connected and variantId
  const wooPage = {
    slug: 'peptide-cream',
    userId: 'usr_owner_1',
    journeyId: 'j_1',
    nodeId: 'node-page-1',
    woocommerceConfig: {
      storeUrl: 'https://glow.example.com',
      status: 'connected'
    },
    data: {
      headline: 'Peptide Barrier Cream',
      buttonText: 'Order Now',
      shopifyVariantId: '884',
      shopifyProductTitle: 'Peptide Barrier Cream',
      shopifyProductPrice: '54.00',
      checkoutMode: 'lead-gate'
    }
  };
  const wooHtml = renderPublicFunnelHtml(wooPage, { query: { var: 'a' }, headers: {} });
  assert.match(wooHtml, /const leadOnly = false;/);
  assert.match(wooHtml, /https:\/\/glow\.example\.com/);
  assert.match(wooHtml, /add-to-cart/);

  // 3. Upsell page with direct checkoutUrl and with WooCommerce
  const upsellHtml = renderPublicUpsellHtml(
    {
      slug: 'bridal-consult',
      data: {
        upsell: {
          headline: 'Add VIP Touch-Up Kit',
          checkoutUrl: 'https://buy.stripe.com/test_vipkit'
        }
      }
    },
    false,
    { query: {}, headers: {} }
  );
  assert.match(upsellHtml, /https:\/\/buy\.stripe\.com\/test_vipkit/);

  // 4. POST /api/public/lead returns checkoutUrl for direct link and for WooCommerce page
  const app = mockApp();
  const contacts = [];
  setPublicContext({
    publicPageCache: {
      'bridal-consult': stripePage,
      'peptide-cream': wooPage
    },
    loadContacts: () => contacts,
    saveContacts: (next) => { contacts.length = 0; contacts.push(...next); },
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    saveDrips: () => {},
    realVariantId: (id) => String(id || '').trim()
  });
  setupPublicRoutes(app, {
    publicPageCache: {
      'bridal-consult': stripePage,
      'peptide-cream': wooPage
    }
  });
  const leadHandler = app.routes.get('POST /api/public/lead');
  assert.ok(leadHandler, 'POST /api/public/lead is registered');

  const leadStripeRes = await callHandler(leadHandler, {
    body: {
      slug: 'bridal-consult',
      email: 'bride@example.com',
      name: 'Claire',
      utm_source: 'tiktok'
    }
  });
  assert.equal(leadStripeRes.status, 200);
  assert.equal(leadStripeRes.body.success, true);
  assert.match(leadStripeRes.body.checkoutUrl, /^https:\/\/calendar\.google\.com\/calendar\/appointments\/schedules\/abc123\?/);
  assert.match(leadStripeRes.body.checkoutUrl, /utm_source=tiktok/);

  const leadWooRes = await callHandler(leadHandler, {
    body: {
      slug: 'peptide-cream',
      email: 'shopper@example.com',
      name: 'Maya',
      visitorId: 'jv_vis_99'
    }
  });
  assert.equal(leadWooRes.status, 200);
  assert.equal(leadWooRes.body.success, true);
  assert.match(leadWooRes.body.checkoutUrl, /^https:\/\/glow\.example\.com\/checkout\/\?add-to-cart=884&/);
});

test('sectionSummary reports direct destination links truthfully when no store product is linked', () => {
  assert.deepEqual(
    sectionSummary('commerce', { checkoutUrl: 'https://buy.stripe.com/test_123', checkoutMode: 'direct' }, { storeConnected: false }),
    { text: 'Direct destination · Direct link', tone: 'on' }
  );
  assert.deepEqual(
    sectionSummary('commerce', { checkoutUrl: 'https://calendar.google.com/abc', checkoutMode: 'lead-gate' }, { storeConnected: false }),
    { text: 'Direct destination · Email first', tone: 'on' }
  );
});

test('publishJourney attaches sanitized woocommerceConfig to published landing and upsell records', async () => {
  const app = mockApp();
  const savedPages = {};
  const journey = {
    id: 'j_woo_pub',
    name: 'Woo Funnel',
    workspaceId: 'ws_woo_pub',
    nodes: [
      { id: 'n_page', type: 'landing-page', data: { slug: 'woo-serum', headline: 'Woo Serum', shopifyVariantId: '884' } },
      { id: 'n_upsell', type: 'upsell', data: { slug: 'woo-upsell', headline: 'Add Mask', shopifyVariantId: '885' } }
    ],
    edges: [{ id: 'e1', source: 'n_page', target: 'n_upsell' }]
  };

  setupJourneyRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'usr_woo' }; next(); },
    loadJourney: async () => structuredClone(journey),
    readJourney: async () => ({ ok: true, journey: structuredClone(journey) }),
    saveJourney: async () => ({ durable: true }),
    loadWorkspace: async () => ({
      id: 'ws_woo_pub',
      userId: 'usr_woo',
      woocommerceConfig: {
        storeUrl: 'https://glow.example.com/',
        consumerKey: 'ck_secret',
        consumerSecret: 'cs_secret',
        storeName: 'Glow Woo',
        currency: 'EUR',
        status: 'connected'
      }
    }),
    realStoreDomain: () => '',
    validateSlugAvailability: async () => ({ available: true }),
    reloadDomainRegistry: () => ({}),
    domainRegistryCache: {},
    savePublicPage: async (key, rec) => { savedPages[key] = rec; return { durable: true }; },
    removePublicPage: async () => ({ durable: true }),
    persistPublicPages: () => {},
    publicPageCache: savedPages,
    loadPublishLog: async () => ({ ok: true, entries: [] }),
    savePublishLog: async () => ({ durable: true }),
    loadPublicPage: async (k) => savedPages[k] || null,
    readPublicPage: async (k) => ({ ok: true, page: savedPages[k] || null }),
    renderPublicFunnelHtml,
    renderPublicUpsellHtml
  });

  const publishHandler = app.routes.get('POST /api/journey/:id/publish');
  assert.ok(publishHandler, 'publish route is registered');

  const res = await callHandler(publishHandler, {
    params: { id: 'j_woo_pub' },
    user: { uid: 'usr_woo' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(savedPages['woo-serum'].woocommerceConfig, {
    storeUrl: 'https://glow.example.com',
    status: 'connected',
    storeName: 'Glow Woo',
    currency: 'EUR'
  });
  assert.equal('consumerSecret' in savedPages['woo-serum'].woocommerceConfig, false);
  assert.equal('consumerKey' in savedPages['woo-serum'].woocommerceConfig, false);
  assert.deepEqual(savedPages['woo-upsell'].woocommerceConfig, {
    storeUrl: 'https://glow.example.com',
    status: 'connected',
    storeName: 'Glow Woo',
    currency: 'EUR'
  });
});

test('woocommerceRoutes, ShopifyConnectModal, and LiveFunnelModal sources carry no em dashes or spaced en dashes', () => {
  for (const file of [
    'server/routes/woocommerceRoutes.mjs',
    'src/components/shopify/ShopifyConnectModal.tsx',
    'src/components/preview/LiveFunnelModal.tsx',
    'src/components/drawers/ThankYouEditor.tsx'
  ]) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /—/, `${file} has no em dash`);
    assert.doesNotMatch(src, / – /, `${file} has no spaced en dash`);
  }
});

test('cleanWebhookUrl accepts public HTTPS endpoints and blocks SSRF, HTTP, private IPs, and credentials', () => {
  assert.equal(
    cleanWebhookUrl('https://script.google.com/macros/s/AKfycb123/exec'),
    'https://script.google.com/macros/s/AKfycb123/exec'
  );
  assert.equal(
    cleanWebhookUrl('https://hooks.zapier.com/hooks/catch/111/222/'),
    'https://hooks.zapier.com/hooks/catch/111/222/'
  );
  assert.equal(cleanWebhookUrl('http://script.google.com/macros/s/abc/exec'), '');
  assert.equal(cleanWebhookUrl('https://localhost/webhook'), '');
  assert.equal(cleanWebhookUrl('https://127.0.0.1/webhook'), '');
  assert.equal(cleanWebhookUrl('https://169.254.169.254/latest/meta-data'), '');
  assert.equal(cleanWebhookUrl('https://192.168.1.10/webhook'), '');
  assert.equal(cleanWebhookUrl('https://10.0.0.5/webhook'), '');
  assert.equal(cleanWebhookUrl('https://user:pass@hooks.zapier.com/hooks'), '');
  assert.equal(cleanWebhookUrl('https://hooks.zapier.com:8443/hooks'), '');
  assert.equal(cleanWebhookUrl('https://hooks.zapier.com/../admin'), '');
});

test('renderPublicFunnelHtml injects GTM container and WhatsApp/SMS Click-to-Chat button when configured', () => {
  const pageWithGtmAndChat = {
    slug: 'lash-vip',
    userId: 'usr_owner_1',
    journeyId: 'j_1',
    nodeId: 'node-page-1',
    data: {
      headline: 'Silk Volume Lash Set',
      buttonText: 'Reserve My Appointment',
      gtmContainerId: 'GTM-K9LP2QX',
      chatConciergeEnabled: true,
      chatConciergeChannel: 'whatsapp',
      chatConciergePhone: '+1 (555) 890-1234',
      chatConciergeText: 'Questions? Text Our Studio on WhatsApp',
      chatConciergeMessage: 'Hi! Do you have an opening this Friday?'
    }
  };
  const html = renderPublicFunnelHtml(pageWithGtmAndChat, { query: { var: 'a' }, headers: {} });
  assert.match(html, /GTM-K9LP2QX/);
  assert.match(html, /googletagmanager\.com\/gtm\.js/);
  assert.match(html, /googletagmanager\.com\/ns\.html\?id=GTM-K9LP2QX/);
  assert.match(html, /id="jv-chat-concierge-btn"/);
  assert.match(html, /https:\/\/wa\.me\/15558901234\?text=Hi!%20Do%20you%20have%20an%20opening%20this%20Friday%3F/);
  assert.match(html, /Questions\? Text Our Studio on WhatsApp/);
});

test('POST /api/public/lead pre-fills email, name, and prefilled_email on direct booking/payment URLs, and POST /api/public/webhook-test validates SSRF', async () => {
  const app = mockApp();
  const contacts = [];
  const stripePaymentLinkPage = {
    slug: 'deposit-link',
    userId: 'usr_owner_1',
    journeyId: 'j_1',
    nodeId: 'node-page-1',
    data: {
      headline: 'VIP Bridal Deposit',
      checkoutUrl: 'https://buy.stripe.com/test_bridal_deposit',
      checkoutMode: 'lead-gate'
    }
  };
  setPublicContext({
    publicPageCache: { 'deposit-link': stripePaymentLinkPage },
    loadContacts: () => contacts,
    saveContacts: (next) => { contacts.length = 0; contacts.push(...next); },
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    saveDrips: () => {},
    realVariantId: (id) => String(id || '').trim()
  });
  setupPublicRoutes(app, {
    publicPageCache: { 'deposit-link': stripePaymentLinkPage }
  });

  const leadHandler = app.routes.get('POST /api/public/lead');
  const leadRes = await callHandler(leadHandler, {
    body: {
      slug: 'deposit-link',
      email: 'sophia@example.com',
      name: 'Sophia Laurent',
      utm_source: 'instagram'
    }
  });
  assert.equal(leadRes.status, 200);
  assert.equal(leadRes.body.success, true);
  assert.match(leadRes.body.checkoutUrl, /^https:\/\/buy\.stripe\.com\/test_bridal_deposit\?/);
  assert.match(leadRes.body.checkoutUrl, /email=sophia%40example\.com/);
  assert.match(leadRes.body.checkoutUrl, /prefilled_email=sophia%40example\.com/);
  assert.match(leadRes.body.checkoutUrl, /name=Sophia\+Laurent/);

  const testWebhookHandler = app.routes.get('POST /api/public/webhook-test');
  assert.ok(testWebhookHandler, 'POST /api/public/webhook-test is registered');

  const blockedRes = await callHandler(testWebhookHandler, {
    body: { webhookUrl: 'http://127.0.0.1:8080/internal' }
  });
  assert.equal(blockedRes.status, 400);
  assert.equal(blockedRes.body.success, false);
});

test('ThankYouEditor includes 1-click 5-Star Google Review and WhatsApp Concierge presets', () => {
  const src = fs.readFileSync('src/components/drawers/ThankYouEditor.tsx', 'utf8');
  assert.match(src, /5-Star Google Review Preset/);
  assert.match(src, /Leave Us a 5-Star Google Review/);
  assert.match(src, /WhatsApp Concierge Preset/);
  assert.match(src, /Questions\? Chat with Us on WhatsApp/);
});
