// A visitor's lead post for an owned page must be ANSWERED. POST /api/public/lead calls
// noteSegmentChanges(page.userId), and that function lives in emailRoutes.mjs and reads
// predictionAccount from the email route context. When predictionAccount was never destructured
// there, the call threw a ReferenceError inside an async Express 4 handler, which nothing answers,
// so the visitor's request hung forever. This drives the real public route with the REAL
// noteSegmentChanges, wired through the real setupEmailRoutes with a context shaped the way
// server.mjs builds emailCtx (its key list is read from server.mjs, so a key added there is
// stubbed here), and requires a 2xx within 2 seconds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import { setupPublicRoutes, setPublicContext } from './server/routes/publicRoutes.mjs';

function emailCtxKeys() {
  const src = fs.readFileSync('server.mjs', 'utf8');
  const m = src.match(/const emailCtx = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'emailCtx literal found in server.mjs');
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim().replace(/,$/, '')).filter((l) => /^[A-Za-z_$][\w$]*$/.test(l));
}

function buildEmailCtx() {
  const ctx = {};
  for (const key of emailCtxKeys()) ctx[key] = () => null; // inert stub for anything this path does not read
  Object.assign(ctx, {
    hub: null,
    hubReady: false,
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    userProgramBag: () => ({ segments: [], flows: [], suppressions: [], segmentState: {} }),
    writeUserPrograms: () => {},
    loadOrders: () => [],
    isDemoRecord: () => false,
    contactsForUser: () => [{ email: 'lead@example.com', name: 'Lee', userId: 'u1', acceptsMarketing: true }],
    loadEvents: () => [],
    loadBehaviorBag: () => ({ events: [] }),
    loadContacts: () => [],
    loadCheckouts: () => [],
    loadRedirects: () => [],
    // The real shape: an account summary, or null when the store has no usable prediction.
    predictionAccount: () => null,
    SAMPLE_MAIL_VARS: {},
    DEFAULT_RFM_CONFIG: {}
  });
  return ctx;
}

test('POST /api/public/lead for an owned page is answered with a 2xx within 2 seconds', async () => {
  const email = setupEmailRoutes(express(), buildEmailCtx());
  assert.equal(typeof email.noteSegmentChanges, 'function', 'setupEmailRoutes hands noteSegmentChanges back');
  const record = { slug: 'offer', userId: 'u1', type: 'funnel', data: { headline: 'Hi' } };
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { offer: record },
    domainRegistryCache: {},
    workspaceCache: {},
    loadDiscounts: () => [],
    realStoreDomain: () => '',
    realVariantId: (v) => String(v || '').trim(),
    loadContacts: () => [],
    saveContacts: () => {},
    loadDrips: () => ({ sequences: [], enrollments: [] }),
    signupFormsFor: () => [],
    attachBehavior: () => ({}),
    publicBase: () => 'http://127.0.0.1',
    noteSegmentChanges: email.noteSegmentChanges
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/public/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.8.7' },
      body: JSON.stringify({ slug: 'offer', email: 'lead@example.com', name: 'Lee' }),
      signal: AbortSignal.timeout(2000)
    });
    assert.ok(res.status >= 200 && res.status < 300, `lead post answered ${res.status}`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    setPublicContext(null);
  }
});
