// Every place that enrolls someone in a shared starter sequence asks first whether this account has
// that starter flow on (EMAIL_STUDIO_PLAN.md Wave 2, decision D5's enrollment points). The plan counted
// seven by grep at 7b6c767; the code at a90f6bb has seven enrollment writes, but not the same seven:
// server.mjs's checkout reminder (the plan's server.mjs:3264) reads the cart sequence's code and
// enrolls nobody, and POST /api/drips/enroll (emailRoutes.mjs) is an enrollment point the plan did not
// list. So this pins what the code does: every write of a drip enrollment is guarded, and there are 7.
// That checkout block does still SEND: its two reminders of its own ask the Cart recovery flow's switch
// too, and a checkout whose reminder comes due while it is off is stopped (pinned by driving the sender
// in email-flow-content-route.test.mjs, "Cart recovery turned off sends neither checkout reminder").
//
// A source pin, then the two route-module points that can be driven on a bare Express app with a stub
// context. server.mjs is never booted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupShopifyRoutes } from './server/routes/shopifyRoutes.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const FILES = ['server.mjs', 'server/routes/publicRoutes.mjs', 'server/routes/shopifyRoutes.mjs', 'server/routes/emailRoutes.mjs'];
const lineAt = (src, index) => src.slice(0, index).split('\n').length;

/** Every write of a drip enrollment: an object starting at step 0 that goes into `dripsData.enrollments`. */
function enrollmentSites() {
  const sites = [];
  for (const file of FILES) {
    const src = read(`./${file}`);
    for (const match of src.matchAll(/currentStepIndex: 0,/g)) {
      // The sequence it enrolls in is looked up just before it; the guard must sit between the two.
      const before = src.slice(0, match.index);
      const lookup = Math.max(before.lastIndexOf('sequences.find('), before.lastIndexOf('sequences || []).find('));
      assert.ok(lookup > 0, `${file}:${lineAt(src, match.index)} enrolls with no sequence lookup before it`);
      sites.push({ where: `${file}:${lineAt(src, match.index)}`, guard: src.slice(lookup, match.index) });
    }
  }
  return sites;
}

test('every drip enrollment write asks starterFlowOnFor first, and there are exactly seven', () => {
  const sites = enrollmentSites();
  const unguarded = sites.filter((site) => !/\bstarterFlowOnFor\(/.test(site.guard)).map((site) => site.where);
  assert.deepEqual(unguarded, [], `enrolls without asking whether the starter flow is on: ${unguarded.join(', ')}`);
  assert.equal(sites.length, 7, `enrollment writes: ${sites.map((site) => site.where).join(', ')}`);
  // Every one goes into the shared drip store, and nothing else adds to it, so none is missed above.
  const writes = FILES.flatMap((file) => [...read(`./${file}`).matchAll(/dripsData\.enrollments\.(push|unshift)\(/g)].map((m) => `${file}:${lineAt(read(`./${file}`), m.index)}`));
  assert.equal(writes.length, 7, `writes into dripsData.enrollments: ${writes.join(', ')}`);
  const perFile = Object.fromEntries(FILES.map((file) => [file, sites.filter((site) => site.where.startsWith(`${file}:`)).length]));
  assert.deepEqual(perFile, { 'server.mjs': 1, 'server/routes/publicRoutes.mjs': 3, 'server/routes/shopifyRoutes.mjs': 2, 'server/routes/emailRoutes.mjs': 1 });
});

test('the helper reaches each route module: on its ctx literal in server.mjs, and taken from it in the module', () => {
  const server = read('./server.mjs');
  assert.match(server, /\nfunction starterFlowOnFor\(uid, seqId\) \{\n  return starterFlowOn\(userProgramBag\(uid\), seqId\);\n\}/);
  // route-context-gate.test.mjs does not see a destructured name missing from its literal (planted: it
  // stayed green with starterFlowOnFor taken out of shopifyCtx), so the literals are read here.
  for (const [literal, setup] of [['const shopifyCtx = {', 'setupShopifyRoutes(app, shopifyCtx);'], ['const emailCtx = {', 'setupEmailRoutes(app, emailCtx);'], ['const publicCtx = {', 'setupPublicRoutes(app, publicCtx);']]) {
    const start = server.indexOf(literal);
    const end = server.indexOf(setup, start);
    assert.ok(start > 0 && end > start, `${literal} ... ${setup}`);
    const keys = server.slice(start, end).split('\n').map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''));
    assert.ok(keys.includes('starterFlowOnFor'), `${literal} does not pass starterFlowOnFor`);
  }
  for (const [file, setup] of [['server/routes/shopifyRoutes.mjs', 'export function setupShopifyRoutes(app, ctx) {'], ['server/routes/emailRoutes.mjs', 'export function setupEmailRoutes(app, ctx) {']]) {
    const src = read(`./${file}`);
    const at = src.indexOf(setup);
    assert.ok(at > 0, `${file} has no ${setup}`);
    const destructure = src.slice(at, src.indexOf('} = ctx;', at));
    assert.match(destructure, /\bstarterFlowOnFor\b/, `${file} does not take starterFlowOnFor from its ctx`);
  }
  assert.match(read('./server/routes/publicRoutes.mjs'), /const starterFlowOnFor = \(uid, seqId\) => \(getCtx\(\)\.starterFlowOnFor \? getCtx\(\)\.starterFlowOnFor\(uid, seqId\) : true\);/);
});

// ---- Driven: the review request after a fulfillment (shopifyRoutes.mjs) ----

function shopifyCtx(drips, on) {
  return new Proxy({
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    acceptShopifyWebhook: () => ({ userId: 'u1' }),
    loadOrders: () => [{ id: 'o1', userId: 'u1', customerEmail: 'a@b.test', customerName: 'Ann' }],
    sendTransactional: async () => ({ ok: true }),
    enrollFlowsForTrigger: async () => ({ added: 0 }),
    orderMailVars: () => ({}),
    loadDrips: () => drips,
    saveDrips: () => {},
    starterFlowOnFor: (uid, id) => { drips.asked.push([uid, id]); return on; }
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

test('a fulfillment enrolls nobody in the review request while this account has it off', async (t) => {
  const saved = process.env.HUB_API_KEY;
  process.env.HUB_API_KEY = 'test-hub-key';
  t.after(() => { if (saved === undefined) delete process.env.HUB_API_KEY; else process.env.HUB_API_KEY = saved; });
  for (const on of [false, true]) {
    const drips = { sequences: [{ id: 'drip_seq_review_request', triggerType: 'fulfillment_review', steps: [{ id: 'review_step_1', delayHours: 168, discountVoucher: '' }] }], enrollments: [], asked: [] };
    const app = express();
    app.use(express.json());
    setupShopifyRoutes(app, shopifyCtx(drips, on));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/shopify/fulfillments-create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'f1', order_id: 'o1', email: 'a@b.test' })
      });
      assert.equal(r.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.deepEqual(drips.asked, [['u1', 'drip_seq_review_request']], 'the webhook did not ask for this account and this flow');
    assert.equal(drips.enrollments.length, on ? 1 : 0, on ? 'the control: with the flow on, the buyer is enrolled' : 'a review request that is off took the buyer');
  }
});

// ---- Driven: enrolling one person by hand (emailRoutes.mjs POST /api/drips/enroll) ----

function emailCtxKeys() {
  const m = read('./server.mjs').match(/const emailCtx = \{([\s\S]*?)\n\};/);
  assert.ok(m, 'emailCtx literal found in server.mjs');
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '').trim().replace(/,$/, '')).filter((l) => /^[A-Za-z_$][\w$]*$/.test(l));
}

test('enrolling one person by hand in a starter flow this account turned off is refused, and nothing is written', async () => {
  for (const on of [false, true]) {
    const drips = { sequences: [{ id: 'drip_seq_default', triggerType: 'lead_capture', steps: [{ id: 'step_1' }] }], enrollments: [] };
    let saves = 0;
    const ctx = {};
    for (const key of emailCtxKeys()) ctx[key] = () => null;
    Object.assign(ctx, {
      hub: null,
      hubReady: false,
      requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
      loadDrips: () => drips,
      saveDrips: () => { saves += 1; },
      starterFlowOnFor: (uid, id) => (uid === 'u1' && id === 'drip_seq_default' ? on : true),
      SAMPLE_MAIL_VARS: {},
      DEFAULT_RFM_CONFIG: {}
    });
    const app = express();
    app.use(express.json());
    setupEmailRoutes(app, ctx);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    let res;
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/drips/enroll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sequenceId: 'drip_seq_default', customerEmail: 'lee@example.test' })
      });
      res = { status: r.status, body: await r.json() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    if (on) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(drips.enrollments.length, 1, 'the control: with the flow on, the person is enrolled');
    } else {
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, { success: false, error: 'That flow is turned off for this account, so nobody was added. Turn it on in Email Studio, Flows, first.' });
      assert.equal(drips.enrollments.length, 0);
      assert.equal(saves, 0);
      assert.doesNotMatch(res.body.error, /—| – /);
    }
  }
});
