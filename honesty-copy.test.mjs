// Operator check, no fake shopper, and a sentence when opens are not stored.
// Growth Pro stays on the homepage. Checkout is the charge. The waitlist is not the charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the homepage still shows Growth Pro and checkout starts from the billing dialog', () => {
  const home = read('./src/components/public/HomePage.tsx');
  const billing = read('./src/components/billing/BillingModal.tsx');
  assert.match(home, /Growth Pro/);
  assert.match(home, /\$49/);
  assert.match(home, /\$39/);
  assert.match(billing, /Jourvance Growth Pro/);
  assert.match(billing, /\$49/);
  assert.match(billing, /\$39/);
  assert.match(billing, /\/api\/billing\/checkout/);
  assert.doesNotMatch(billing, /onboarding team|No credit card required|VIP Priority List/);
  assert.match(read('./server/billing.mjs'), /cents: 4900/);
  assert.match(read('./server/billing.mjs'), /cents: 46800/);
});

test('the sidebar and the canvas header use isOperator', () => {
  for (const path of ['./src/components/navigation/AppSidebar.tsx', './src/components/toolbar/CanvasHeader.tsx']) {
    const src = read(path);
    assert.match(src, /isOperator\(user\)/);
    assert.doesNotMatch(src, /tlm@tarrenmunoz\.com/);
  }
  const dash = read('./src/components/admin/OperatorDashboard.tsx');
  assert.match(dash, /OPERATOR_EMAIL/);
  assert.doesNotMatch(dash, /Restricted to tlm@/);
});

test('the Shopify dialog no longer posts a simulated order or checkout', () => {
  const src = read('./src/components/modals/ShopifySyncModal.tsx');
  assert.doesNotMatch(src, /Elena Rostova|Marcus Shopper|simulate-order|simulate-abandoned-checkout/);
});

test('opens stay blank until the mail event secret and a public https origin are set', () => {
  const stats = read('./src/lib/emailStats.ts');
  assert.match(stats, /Opens stay blank until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set\./);
  assert.match(read('./src/components/campaign/HubEmailSuite.tsx'), /OPENS_UNSTORED/);
  assert.match(read('./src/components/campaign/SendingSetup.tsx'), /OPENS_UNSTORED/);
  assert.match(read('./server/routes/analyticsRoutes.mjs'), /opensStored: mailEventsReady\(process\.env\)/);
});

test('a waitlist note is not a paid plan', () => {
  const src = read('./server/routes/publicRoutes.mjs');
  const start = src.indexOf("app.post('/api/public/waitlist'");
  const body = src.slice(start, src.indexOf("app.post('/api/public/inquiry'"));
  assert.match(body, /growth_pro_waitlist/);
  assert.doesNotMatch(body, /planTier/);
  const billing = read('./server/billing.mjs');
  assert.match(billing, /mode: 'subscription'/);
  assert.match(billing, /Stripe is not configured/);
});
