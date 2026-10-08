// Growth Pro checkout. Prices match the homepage: $49 a month, or $39 a month
// billed once a year ($468). A missing Stripe key charges nothing.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BILLING_FILE = path.join(__dirname, '..', 'billing.json');

export function priceFor(cycle) {
  if (cycle === 'annual') {
    return { cycle: 'annual', cents: 46800, interval: 'year', description: '$39 a month, billed once a year' };
  }
  return { cycle: 'monthly', cents: 4900, interval: 'month', description: '$49 a month' };
}

export function planName(account) {
  if (!account || account.plan !== 'pro' || account.status === 'canceled') return 'starter';
  return 'pro';
}

// Starter stops at two workspaces. Pro does not. The email bypass is the one
// already in this route; a paid plan is the other way through.
export function workspaceCreateBlocked({ count, plan, email }) {
  if (plan === 'pro') return false;
  if (String(email || '').toLowerCase().includes('tarren')) return false;
  return Number(count) >= 2;
}

export function checkoutFields({ userId, billingCycle, email, storeDomain, origin }) {
  const price = priceFor(billingCycle);
  const base = String(origin || '').replace(/\/$/, '');
  const fields = {
    mode: 'subscription',
    client_reference_id: userId,
    success_url: `${base}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?billing=cancelled`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(price.cents),
    'line_items[0][price_data][recurring][interval]': price.interval,
    'line_items[0][price_data][product_data][name]': 'Jourvance Growth Pro',
    'line_items[0][price_data][product_data][description]': price.description,
    'metadata[userId]': userId,
    'metadata[plan]': 'growth_pro',
    'metadata[billingCycle]': price.cycle,
    'subscription_data[metadata][userId]': userId,
    'subscription_data[metadata][plan]': 'growth_pro',
    'subscription_data[metadata][billingCycle]': price.cycle
  };
  if (email) fields.customer_email = email;
  if (storeDomain) fields['metadata[storeDomain]'] = String(storeDomain).slice(0, 200);
  return fields;
}

export function stripeSignatureOk(raw, header, secret, now = Date.now()) {
  if (!secret || raw == null) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map((piece) => {
    const i = piece.indexOf('=');
    return i < 0 ? [piece, ''] : [piece.slice(0, i), piece.slice(i + 1)];
  }));
  const stamp = parts.t;
  const v1 = parts.v1;
  if (!stamp || !v1) return false;
  const age = Math.abs(now / 1000 - Number(stamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const signed = crypto.createHmac('sha256', secret).update(`${stamp}.${raw}`).digest('hex');
  const left = Buffer.from(signed);
  const right = Buffer.from(String(v1));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function userIdForSubscription(accounts, subscriptionId) {
  if (!subscriptionId) return '';
  for (const [uid, row] of Object.entries(accounts || {})) {
    if (row?.stripeSubscriptionId === subscriptionId) return uid;
  }
  return '';
}

export function applyBillingEvent(accounts, event) {
  const next = { ...(accounts || {}) };
  const type = String(event?.type || '');
  const obj = event?.data?.object || {};
  if (type === 'checkout.session.completed') {
    const uid = String(obj.metadata?.userId || '');
    if (obj.mode !== 'subscription' || obj.metadata?.plan !== 'growth_pro' || !uid) return { accounts: next, applied: false };
    if (obj.payment_status !== 'paid' && obj.status !== 'complete') return { accounts: next, applied: false };
    next[uid] = {
      ...(next[uid] || {}),
      plan: 'pro',
      billingCycle: obj.metadata.billingCycle === 'annual' ? 'annual' : 'monthly',
      status: 'active',
      stripeCustomerId: obj.customer || next[uid]?.stripeCustomerId || '',
      stripeSubscriptionId: obj.subscription || next[uid]?.stripeSubscriptionId || '',
      requestedStoreDomain: obj.metadata.storeDomain || next[uid]?.requestedStoreDomain || '',
      updatedAt: new Date().toISOString()
    };
    return { accounts: next, applied: true, userId: uid, plan: 'pro' };
  }
  if (type === 'customer.subscription.deleted') {
    const uid = String(obj.metadata?.userId || '') || userIdForSubscription(next, obj.id);
    if (!uid) return { accounts: next, applied: false };
    next[uid] = {
      ...(next[uid] || {}),
      plan: 'starter',
      status: 'canceled',
      updatedAt: new Date().toISOString()
    };
    return { accounts: next, applied: true, userId: uid, plan: 'starter' };
  }
  return { accounts: next, applied: false };
}

export function formBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== '') params.append(key, String(value));
  }
  return params;
}

export function createFileBillingStore(file = BILLING_FILE) {
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed.accounts === 'object' && parsed.accounts ? parsed.accounts : {};
    } catch {
      return {};
    }
  };
  return {
    get(uid) { return read()[uid] || null; },
    all: read,
    save(accounts) {
      fs.writeFileSync(file, JSON.stringify({ accounts }, null, 2));
    }
  };
}

let sharedStore = null;
export function billingAccounts() {
  if (!sharedStore) sharedStore = createFileBillingStore();
  return sharedStore;
}

function stripeSecret(ctx) {
  if (ctx && Object.prototype.hasOwnProperty.call(ctx, 'stripeSecret')) return String(ctx.stripeSecret || '').trim();
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

function webhookSecret(ctx) {
  if (ctx && Object.prototype.hasOwnProperty.call(ctx, 'webhookSecret')) return String(ctx.webhookSecret || '').trim();
  return String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

function returnOrigin(req) {
  const origin = String(req.get('origin') || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(origin) ? origin : '';
}

async function defaultStripe(secret, method, stripePath, fields) {
  const res = await fetch(`https://api.stripe.com/v1${stripePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: method === 'POST' ? formBody(fields) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Stripe refused the request.');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function writePlan(ctx, store, result) {
  if (!result.applied) return;
  store.save(result.accounts);
  if (!ctx.listWorkspaces || !ctx.saveWorkspace) return;
  const rows = await ctx.listWorkspaces(result.userId);
  for (const ws of rows || []) {
    const tier = result.plan === 'pro' ? 'pro' : 'starter';
    if (ws?.planTier === tier) continue;
    await ctx.saveWorkspace(result.userId, ws.id, { planTier: tier });
  }
}

export function setupBillingRoutes(app, ctx = {}) {
  const store = ctx.store || billingAccounts();
  const requireUser = ctx.requireUser || ((_req, res) => res.status(401).json({ success: false, error: 'Sign in to start Growth Pro.' }));
  const stripeCall = ctx.stripeCall || defaultStripe;

  app.get('/api/billing', requireUser, (req, res) => {
    const row = store.get(req.user.uid);
    res.json({
      success: true,
      plan: planName(row),
      billingCycle: row?.billingCycle || '',
      status: row?.status || 'none'
    });
  });

  app.post('/api/billing/checkout', requireUser, async (req, res) => {
    const secret = stripeSecret(ctx);
    if (!secret) return res.status(503).json({ success: false, error: 'Stripe is not configured.' });
    const origin = returnOrigin(req);
    if (!origin) return res.status(400).json({ success: false, error: 'A return address is required.' });
    const cycle = req.body?.billingCycle === 'annual' ? 'annual' : 'monthly';
    const email = String(req.body?.email || req.user.email || '').trim();
    const fields = checkoutFields({
      userId: req.user.uid,
      billingCycle: cycle,
      email,
      storeDomain: req.body?.storeDomain,
      origin
    });
    try {
      const session = await stripeCall(secret, 'POST', '/checkout/sessions', fields);
      if (!session?.url) return res.status(502).json({ success: false, error: 'Stripe did not return a checkout page.' });
      res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message || 'Stripe refused the checkout.' });
    }
  });

  app.get('/api/billing/session', requireUser, async (req, res) => {
    const secret = stripeSecret(ctx);
    if (!secret) return res.status(503).json({ success: false, error: 'Stripe is not configured.' });
    const sessionId = String(req.query.session_id || req.query.sessionId || '');
    if (!sessionId) return res.status(400).json({ success: false, error: 'session_id is required.' });
    try {
      const session = await stripeCall(secret, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (String(session?.metadata?.userId || '') !== req.user.uid) {
        return res.status(403).json({ success: false, error: 'This checkout belongs to another account.' });
      }
      const result = applyBillingEvent(store.all(), { type: 'checkout.session.completed', data: { object: session } });
      await writePlan(ctx, store, result);
      res.json({ success: true, plan: planName(store.get(req.user.uid)), applied: result.applied });
    } catch (err) {
      res.status(502).json({ success: false, error: err.message || 'Stripe did not return that checkout.' });
    }
  });

  app.post('/api/billing/webhook', async (req, res) => {
    const secret = webhookSecret(ctx);
    if (!secret) return res.status(503).json({ success: false, error: 'Stripe webhook secret is not configured.' });
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    if (!stripeSignatureOk(raw, req.get('stripe-signature'), secret)) {
      return res.status(400).json({ success: false, error: 'Invalid Stripe signature.' });
    }
    let event = req.body;
    if (req.rawBody) {
      try { event = JSON.parse(raw); } catch { return res.status(400).json({ success: false, error: 'Invalid Stripe event.' }); }
    }
    const result = applyBillingEvent(store.all(), event);
    await writePlan(ctx, store, result);
    res.json({ success: true, received: true, applied: result.applied });
  });
}
