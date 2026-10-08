import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import {
  priceFor, planName, workspaceCreateBlocked, checkoutFields,
  stripeSignatureOk, applyBillingEvent, setupBillingRoutes
} from './server/billing.mjs';

test('Growth Pro is $49 a month or $468 a year', () => {
  assert.deepEqual(priceFor('monthly'), { cycle: 'monthly', cents: 4900, interval: 'month', description: '$49 a month' });
  assert.equal(priceFor('annual').cents, 46800);
  assert.equal(priceFor('annual').interval, 'year');
  assert.equal(priceFor('nope').cents, 4900);
});

test('a paid account is pro until the subscription is canceled', () => {
  assert.equal(planName(null), 'starter');
  assert.equal(planName({ plan: 'pro', status: 'active' }), 'pro');
  assert.equal(planName({ plan: 'pro', status: 'past_due' }), 'pro');
  assert.equal(planName({ plan: 'pro', status: 'canceled' }), 'starter');
});

test('starter stops at two workspaces and pro does not', () => {
  assert.equal(workspaceCreateBlocked({ count: 1, plan: 'starter', email: 'a@b.co' }), false);
  assert.equal(workspaceCreateBlocked({ count: 2, plan: 'starter', email: 'a@b.co' }), true);
  assert.equal(workspaceCreateBlocked({ count: 5, plan: 'pro', email: 'a@b.co' }), false);
  assert.equal(workspaceCreateBlocked({ count: 5, plan: 'starter', email: 'tarren@example.com' }), false);
});

test('checkout asks Stripe for a Growth Pro subscription at the homepage price', () => {
  const fields = checkoutFields({ userId: 'u1', billingCycle: 'annual', email: 'a@b.co', origin: 'https://jourvance.test' });
  assert.equal(fields.mode, 'subscription');
  assert.equal(fields['line_items[0][price_data][unit_amount]'], '46800');
  assert.equal(fields['line_items[0][price_data][recurring][interval]'], 'year');
  assert.equal(fields['line_items[0][price_data][product_data][name]'], 'Jourvance Growth Pro');
  assert.equal(fields['metadata[userId]'], 'u1');
  assert.equal(fields['metadata[plan]'], 'growth_pro');
  assert.equal(fields.success_url, 'https://jourvance.test/?billing=success&session_id={CHECKOUT_SESSION_ID}');
});

test('a paid checkout marks the account pro, and a deleted subscription marks it starter', () => {
  let accounts = {};
  const paid = applyBillingEvent(accounts, {
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', payment_status: 'paid', status: 'complete', customer: 'cus_1', subscription: 'sub_1', metadata: { userId: 'u1', plan: 'growth_pro', billingCycle: 'monthly' } } }
  });
  assert.equal(paid.applied, true);
  assert.equal(planName(paid.accounts.u1), 'pro');
  accounts = paid.accounts;
  const ended = applyBillingEvent(accounts, {
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', metadata: {} } }
  });
  assert.equal(ended.applied, true);
  assert.equal(planName(ended.accounts.u1), 'starter');
  const unpaid = applyBillingEvent({}, {
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', payment_status: 'unpaid', status: 'open', metadata: { userId: 'u1', plan: 'growth_pro' } } }
  });
  assert.equal(unpaid.applied, false);
});

function sign(raw, secret, stamp) {
  const v1 = crypto.createHmac('sha256', secret).update(`${stamp}.${raw}`).digest('hex');
  return `t=${stamp},v1=${v1}`;
}

test('the webhook accepts a signed event and refuses a bad signature', () => {
  const raw = '{"ok":true}';
  const secret = 'whsec_test';
  const stamp = Math.floor(Date.now() / 1000);
  assert.equal(stripeSignatureOk(raw, sign(raw, secret, stamp), secret), true);
  assert.equal(stripeSignatureOk(raw, sign(raw, 'other', stamp), secret), false);
  assert.equal(stripeSignatureOk(raw, sign(raw, secret, stamp - 1000), secret), false);
});

function memoryStore() {
  let accounts = {};
  return {
    get: (uid) => accounts[uid] || null,
    all: () => accounts,
    save: (next) => { accounts = next; }
  };
}

async function serve(ctx) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  setupBillingRoutes(app, ctx);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test('checkout is refused when Stripe is not configured, and a configured call uses the signed-in user', async () => {
  const calls = [];
  const store = memoryStore();
  const tiers = [];
  const s = await serve({
    stripeSecret: '',
    webhookSecret: 'whsec_test',
    store,
    requireUser: (req, _res, next) => { req.user = { uid: 'u1', email: 'a@b.co' }; next(); },
    listWorkspaces: async () => [{ id: 'ws1', planTier: 'starter' }],
    saveWorkspace: async (_uid, _id, patch) => { tiers.push(patch.planTier); },
    stripeCall: async (_secret, method, stripePath, fields) => {
      calls.push({ method, stripePath, fields });
      return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
    }
  });
  try {
    const off = await fetch(`${s.base}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://jourvance.test' },
      body: JSON.stringify({ billingCycle: 'monthly', email: 'a@b.co' })
    });
    assert.equal(off.status, 503);
    assert.equal(calls.length, 0);
  } finally {
    await s.close();
  }

  const on = await serve({
    stripeSecret: 'sk_test',
    webhookSecret: 'whsec_test',
    store,
    requireUser: (req, _res, next) => { req.user = { uid: 'u1', email: 'a@b.co' }; next(); },
    listWorkspaces: async () => [{ id: 'ws1', planTier: 'starter' }],
    saveWorkspace: async (_uid, _id, patch) => { tiers.push(patch.planTier); },
    stripeCall: async (_secret, method, stripePath, fields) => {
      calls.push({ method, stripePath, fields });
      return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
    }
  });
  try {
    const res = await fetch(`${on.base}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://jourvance.test' },
      body: JSON.stringify({ billingCycle: 'monthly', email: 'a@b.co' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.url, 'https://checkout.stripe.com/c/pay/cs_1');
    assert.equal(calls[0].fields['metadata[userId]'], 'u1');
    assert.equal(calls[0].fields['line_items[0][price_data][unit_amount]'], '4900');

    const event = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', status: 'complete', subscription: 'sub_1', metadata: { userId: 'u1', plan: 'growth_pro', billingCycle: 'monthly' } } } };
    const raw = JSON.stringify(event);
    const stamp = Math.floor(Date.now() / 1000);
    const hook = await fetch(`${on.base}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(raw, 'whsec_test', stamp) },
      body: raw
    });
    assert.equal(hook.status, 200);
    assert.equal((await hook.json()).applied, true);
    assert.equal(planName(store.get('u1')), 'pro');
    assert.deepEqual(tiers, ['pro']);
  } finally {
    await on.close();
  }
});
