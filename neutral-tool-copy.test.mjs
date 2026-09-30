import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupPublicRoutes } from './server/routes/publicRoutes.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';

// U05: copy the tool writes for a merchant never names a product category. The live-page cookie
// banner said "Privacy & Tailored Ritual ... personalize your ritual" on every store, and the
// customer profile advised "a complementary botanical recommendation" for any single-order buyer.
// The merchant sells hoses here, so any category word in the answer came from the tool.

const CATEGORY_WORDS = /ritual|beauty|radiant|self-care|botanical|skincare|serum|glow|complexion|wellness|pamper/i;

async function listen(app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

function hosePage() {
  return {
    slug: 'hose',
    shopifyConfig: { storeDomain: 'hose-shop.myshopify.com', status: 'connected' },
    data: { type: 'landing-page', headline: 'Garden Hose 50ft', productTitle: 'Garden Hose 50ft', productPrice: '$30.00' }
  };
}

test('U05: the live page cookie banner uses neutral words and names no product category', async () => {
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, {
    publicPageCache: { hose: hosePage() },
    publicBase: () => 'https://jv.test'
  });
  const { base, close } = await listen(app);
  try {
    // An EU visitor gets the banner by default.
    const r = await fetch(`${base}/p/hose`, { headers: { 'cf-ipcountry': 'DE' } });
    assert.equal(r.status, 200);
    const html = await r.text();
    const banner = html.slice(html.indexOf('id="jv-consent-banner"'), html.indexOf('</div>\n  </div>', html.indexOf('id="jv-consent-banner"')));
    assert.ok(banner.length > 0, 'the banner is on the page');
    assert.match(banner, /window\.__jvConsentRequired|jv-consent-title/);
    assert.doesNotMatch(banner, CATEGORY_WORDS, banner);
    assert.match(banner, /We use cookies to run this site and, with your permission, to measure visits\./);
    // The banner never claims the tool personalizes anything or secures a checkout it does not run.
    assert.doesNotMatch(banner, /personali[sz]e|secure your checkout/i);
    assert.doesNotMatch(banner, /—| – /, 'no em dash or spaced en dash');
  } finally {
    await close();
  }
});

function emailApp(contact, orders) {
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    contactsForUser: () => [contact],
    accountOrders: () => orders,
    userProgramBag: () => ({ rfmConfig: {}, suppressions: [] }),
    cleanRfmConfig: (c) => ({ atRiskDays: 90, lapsedDays: 180, ...c }),
    computeContactRfm: (c) => ({ tier: 'active', isAtRisk: false, ordersCount: c.ordersCount, totalSpent: c.totalSpent, recencyDays: 5, segment: 'new', badge: 'New', color: '#fff' }),
    loadCheckouts: () => [],
    loadDrips: () => ({ enrollments: [], sequences: [] }),
    loadRedirects: () => [],
    loadEvents: () => []
  });
  return app;
}

test('U05: the single-order buyer advice suggests a follow-up without naming a product category', async () => {
  const contact = { email: 'pat@example.com', name: 'Pat', ordersCount: 1, totalSpent: 30, firstSeenAt: '2026-09-01T10:00:00.000Z' };
  const orders = [{ id: 'o1', orderNumber: '1001', customerEmail: 'pat@example.com', totalPrice: 30, createdAt: '2026-09-02T10:00:00.000Z', lineItems: [{ title: 'Garden Hose 50ft', quantity: 1, price: 30 }] }];
  const { base, close } = await listen(emailApp(contact, orders));
  try {
    const r = await fetch(`${base}/api/email/contact-details?email=pat@example.com`, { signal: AbortSignal.timeout(3000) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.success, true);
    assert.equal(body.strategicAdvice.suggestedTemplate, 'repeat_nurture');
    assert.doesNotMatch(JSON.stringify(body.strategicAdvice), CATEGORY_WORDS);
    assert.doesNotMatch(JSON.stringify(body.strategicAdvice), /—| – /);
  } finally {
    await close();
  }
});

test('U05: the profile route answers when the host does not hand it a redirect log', async () => {
  // server.mjs builds the email ctx without loadRedirects; the route used to reference it as a
  // bare global, threw a ReferenceError for every known contact, and the request never answered.
  const contact = { email: 'sam@example.com', name: 'Sam', ordersCount: 0, totalSpent: 0, firstSeenAt: '2026-09-01T10:00:00.000Z' };
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    contactsForUser: () => [contact],
    accountOrders: () => [],
    userProgramBag: () => ({ rfmConfig: {}, suppressions: [] }),
    cleanRfmConfig: (c) => ({ atRiskDays: 90, ...c }),
    computeContactRfm: () => ({ tier: 'prospect', isAtRisk: false, ordersCount: 0, totalSpent: 0, recencyDays: null }),
    loadCheckouts: () => [],
    loadDrips: () => ({ enrollments: [], sequences: [] }),
    loadEvents: () => []
  });
  const { base, close } = await listen(app);
  try {
    const r = await fetch(`${base}/api/email/contact-details?email=sam@example.com`, { signal: AbortSignal.timeout(3000) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.success, true);
    assert.equal(body.strategicAdvice.suggestedTemplate, 'lead_welcome');
  } finally {
    await close();
  }
});

test('U05: no line of copy in the two route files names a product category', () => {
  // Class and variable names (.ritual-step, ritualTitle) and comments are not copy; every other
  // line can reach a page or a screen, including the text inside multi-line HTML templates.
  for (const file of ['server/routes/publicRoutes.mjs', 'server/routes/emailRoutes.mjs']) {
    const src = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    const hits = src.split('\n')
      .map(line => line.replace(/class="[^"]*"/g, '').replace(/\.ritual-step|ritualTitle/g, ''))
      .filter(line => /\britual\b|beauty|radiant|self-care|botanical|skincare|serum|complexion/i.test(line)
        && !/verified \(beauty lovers/.test(line)); // the filter that REMOVES an old invented badge
    assert.deepEqual(hits, [], `${file} still writes a category word: ${hits.join('\n')}`);
  }
});
