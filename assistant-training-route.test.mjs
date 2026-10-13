// Journey shapes over HTTP (W3.C, ASK_JOURVANCE_PLAN.md "Results teach the main brain"): the operator's
// training run and the background run after GET thread send each qualifying journey's SHAPE to the
// hub's shared brain through hub.brain.learn, on a bare Express app with the hub stubbed. The harness
// is a copy of assistant-route.test.mjs's (that file is not edited here). Covers: the learn names the
// APP's account and never the user, carries exactly five fields and nothing a user typed; three a day
// per user, claimed before any send; a shape sent inside thirty days is not sent again; a duplicate is
// landed and recorded, a refusal and a timeout record nothing and report failed; a dry run sends and
// writes nothing and lists the rows with hashed journey ids; the operator report carries the shapes.
// Adversary round: a capped event log sends nothing; the app-wide day budget and every claim are
// conditional puts, so two servers sharing one store never send twice; the GET thread job never
// holds the answer and runs once a day.
// This file carries no em dash and no en dash.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { setupAiAssistantRoutes, threadDocName, PROFILE_PATH, REASONS, SHAPES_DAY_DOC } from './server/routes/aiAssistantRoutes.mjs';
import { compileShapeLearns, figuresByJourney, trainingWindow, eventsPartial, SHAPE_LEARNS_PER_DAY, SHAPE_LEARNS_APP_PER_DAY, SHAPE_MIN_VISITS, SHAPE_MIN_ORDERS } from './server/assistantTraining.mjs';
import { EVENTS_KEPT } from './server/assistantContext.mjs';
import { resetAccountRefusalForTest } from './server/aiCall.mjs';

const START = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY_MS = 86400000;
const TODAY = '2026-10-11';
const TOKEN = 'ZEBRAQUARTZ';
const USERS = { A: { uid: 'uA', email: 'rosa.delgado@gmail.com' }, B: { uid: 'uB', email: 'ben@example.org' } };
const NEVER = () => new Promise(() => {});
const GUIDE_FIXTURE = '# Jourvance guide\n\n## Publish and custom domains\nPress Publish to put a funnel page live.\n';

// Every `reason` an answer carries is one bare cause (the house rule assistant-route.test.mjs pins).
const REASON_CODES = new Set(['ai-unavailable', 'hourly-ai-limit']);
const reasonsSeen = [];
function assertBareReasons(value, where) {
  if (Array.isArray(value)) return value.forEach((v) => assertBareReasons(v, where));
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (key === 'reason' && typeof v === 'string' && !REASON_CODES.has(v)) {
      reasonsSeen.push(v);
      assert.ok(!v.includes('Try '), `${where}: advice in a reason: ${v}`);
      assert.match(v, /^[A-Z][^.]*\.$/, `${where}: not one sentence with one full stop at its end: ${v}`);
    } else {
      assertBareReasons(v, where);
    }
  }
}

const dirs = [];
const open = new Set();
after(async () => {
  await Promise.all([...open].map((close) => close()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// ---- The fixture: five journeys per account, each its own shape, each past 200 visits and 20 orders ----

const at = new Date(START - DAY_MS).toISOString();
const node = (id, type, x, data = {}) => ({ id, type, position: { x, y: 100 }, data: { type, label: `${TOKEN} ${id}`, ...data } });
function journeyOf(id, { goal, nodes, businessType = `${TOKEN} Pottery`, userId }) {
  return { id, userId, name: `${TOKEN} ${id} funnel`, offerHeadline: `${TOKEN} headline ${id}`, businessType, goal, nodes, updatedAt: at };
}
const slugOf = (id) => `${TOKEN.toLowerCase()}-${id}`;
const lp = (id, x, extra = {}) => node(`${id}-lp`, 'landing-page', x, { slug: slugOf(id), url: `https://${TOKEN.toLowerCase()}.example/${id}`, ...extra });
const VISITORS = 240;
// Order rates: 10%, 16.7%, 33.3%, 11.7%, 8.3%; the median is 11.7%, so the third is a 5.
const PLAN = [
  { key: 'jz1', orders: 24, journey: (id, userId) => journeyOf(id, { userId, goal: 'sales', businessType: 'E-Commerce Store', nodes: [node(`${id}-ad`, 'ad-source', 0, { platform: 'meta' }), lp(id, 300, { checkoutMode: 'direct' }), node(`${id}-up`, 'upsell', 600), node(`${id}-ty`, 'thank-you', 900)] }) },
  { key: 'jz2', orders: 40, journey: (id, userId) => journeyOf(id, { userId, goal: 'leads', nodes: [node(`${id}-ad`, 'ad-source', 0, { platform: 'google' }), lp(id, 300), node(`${id}-form`, 'lead-form', 600), node(`${id}-seq`, 'follow-up-sequence', 900, { sequenceType: 'lead_nurture' }), node(`${id}-ty`, 'thank-you', 1200)] }) },
  { key: 'jz3', orders: 80, journey: (id, userId) => journeyOf(id, { userId, goal: 'sales', nodes: [node(`${id}-ad`, 'ad-source', 0, { platform: 'tiktok' }), lp(id, 300), node(`${id}-down`, 'upsell', 600, { offerType: 'downsell' }), node(`${id}-ty`, 'thank-you', 900)] }) },
  { key: 'jz4', orders: 28, journey: (id, userId) => journeyOf(id, { userId, goal: 'sales', nodes: [node(`${id}-ad`, 'ad-source', 0, { platform: 'organic' }), lp(id, 300), node(`${id}-ty`, 'thank-you', 600)] }) },
  { key: 'jz5', orders: 20, journey: (id, userId) => journeyOf(id, { userId, goal: '', nodes: [lp(id, 0), node(`${id}-seq`, 'follow-up-sequence', 300, { sequenceType: 'checkout_recovery' })] }) }
];
// uA's journeys are jz1..jz5; uB's are the same shapes under other ids, for the app-wide budget.
function accountData(uid, prefix) {
  const plan = PLAN.map((p) => ({ ...p, id: `${prefix}${p.key}` }));
  const journeys = plan.map((p) => p.journey(p.id, uid));
  const pages = Object.fromEntries(plan.map((p) => [slugOf(p.id), { slug: slugOf(p.id), userId: uid, journeyId: p.id, domain: `${TOKEN.toLowerCase()}.example` }]));
  const events = plan.flatMap((p) => Array.from({ length: VISITORS }, (_, k) => ({ userId: uid, journeyId: p.id, type: 'page_view', visitorId: `${p.id}-v${k}`, at })));
  const orders = plan.flatMap((p) => Array.from({ length: p.orders }, (_, k) => ({ userId: uid, attributedSlug: slugOf(p.id), totalPrice: 41.37, createdAt: at, customerEmail: `buyer${k}@${TOKEN.toLowerCase()}.example`, customerName: `${TOKEN} Buyer` })));
  return { journeys, pages, events, orders };
}
const A = accountData('uA', '');
const B = accountData('uB', 'b-');
const JOURNEYS = A.journeys;
const PAGES = { ...A.pages, ...B.pages };
const EVENTS = A.events;
const ORDERS = A.orders;
// The rows the route should send, computed by the pure function over the same inputs.
const EXPECTED = (() => {
  const { inWindow } = trainingWindow(START);
  const figures = figuresByJourney({ uid: 'uA', journeyIds: JOURNEYS.map((j) => j.id), events: EVENTS, orders: ORDERS, pages: PAGES, inWindow });
  return compileShapeLearns({ uid: 'uA', journeys: JOURNEYS, figures }).rows;
})();
const BOTH = { journeys: (uid) => ({ journeys: uid === 'uA' ? A.journeys : uid === 'uB' ? B.journeys : [], complete: true }), events: () => [...A.events, ...B.events], orders: () => [...A.orders, ...B.orders] };

/**
 * One hub stub, shareable by two servers (two processes during a deploy). Its conditional put is the
 * hub's (server-app-store.ts staleRefusal): with onlyIfNewer, a stored stamp at least as new as the
 * offered one is 409 stale and nothing is written; a put without a stamp leaves none, as the hub does.
 */
function makeKit({ learn = { success: true, ingested: true }, docsGet, docsPut, replacePost = { success: true, file: { id: 'f1' }, replaced: 1 }, latency = 0 } = {}) {
  const kit = { clock: { t: START }, calls: { learn: [], replace: [], get: [], put: [], events: 0 }, store: new Map(), stamps: new Map(), rev: 0 };
  const answer = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
  kit.hub = {
    brain: {
      chat: async () => ({ success: true, text: 'Open Attribution.' }),
      // The SDK's own wrapper adds `appId` from its config at post time; the route passes the rest.
      learn: async (body) => { kit.calls.learn.push(structuredClone(body)); return answer(learn, body, kit.calls.learn.length); },
      ingest: async () => ({ success: true, file: { id: 'p1' } })
    },
    api: {
      post: async (p, body) => {
        if (p === PROFILE_PATH) return { success: true };
        kit.calls.replace.push({ path: p, body });
        return answer(replacePost, body);
      }
    },
    store: {
      docs: {
        get: async (name) => {
          if (latency) await sleep(latency);
          kit.calls.get.push(name);
          if (docsGet) return docsGet(name, kit.store);
          return kit.store.has(name) ? { name, document: structuredClone(kit.store.get(name)), rev: kit.rev } : { error: 'No such document.', status: 404 };
        },
        put: async (name, document, opts = {}) => {
          if (latency) await sleep(latency);
          if (docsPut) {
            const r = docsPut(name, document, opts, kit.store);
            if (r !== undefined) return r;
          }
          const stored = Date.parse(kit.stamps.get(name) || '');
          if (opts?.onlyIfNewer && Number.isFinite(stored) && stored >= Date.parse(opts.sourceUpdatedAt)) {
            return { error: 'The store already holds a copy at least as new as this one, so it was not written.', status: 409, stale: true };
          }
          kit.calls.put.push({ name, document: structuredClone(document), opts });
          kit.store.set(name, structuredClone(document));
          if (opts?.sourceUpdatedAt) kit.stamps.set(name, opts.sourceUpdatedAt);
          else kit.stamps.delete(name);
          kit.rev += 1;
          return { name, rev: kit.rev };
        }
      }
    }
  };
  return kit;
}

async function serve({
  kit = makeKit(),
  hubReady = true,
  journeys = (uid) => ({ journeys: uid === 'uA' ? JOURNEYS : [], complete: true }),
  events = () => EVENTS,
  orders = () => ORDERS,
  pages = PAGES,
  timeouts
} = {}) {
  resetAccountRefusalForTest();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-training-route-'));
  dirs.push(dataDir);
  const guidePath = path.join(dataDir, 'jourvance-guide.md');
  fs.writeFileSync(guidePath, GUIDE_FIXTURE);
  fs.writeFileSync(path.join(dataDir, 'panel-copy.md'), '| send.label | Send |');
  const app = express();
  app.use(express.json());
  setupAiAssistantRoutes(app, {
    requireUser: (req, res, next) => {
      const who = USERS[String(req.headers.authorization || '').replace(/^Bearer /, '')];
      if (!who) return res.status(401).json({ success: false, error: 'Sign in to continue.' });
      req.user = { ...who };
      next();
    },
    requireOperator: (req, res, next) => {
      if (String(req.headers.authorization || '') !== 'Bearer OP') return res.status(404).json({ success: false, error: 'Not found.' });
      req.user = { uid: 'uOp', email: 'operator@example.com' };
      next();
    },
    hub: kit.hub,
    hubReady,
    hubAppId: 'jourvance',
    listWorkspacesDetailed: async () => ({ workspaces: [], complete: true }),
    listJourneys: async (uid) => journeys(uid),
    loadEvents: () => { kit.calls.events += 1; return events(); },
    loadOrders: () => orders(),
    contactsForUser: () => [],
    messageStatsFor: () => ({ sent: 10, opened: 4, clicked: 2, unsubscribed: null, revenue: null }),
    publicPageCache: () => pages,
    guidePath,
    dataDir,
    now: () => kit.clock.t,
    ...(timeouts ? { timeouts } : {})
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/ai/assistant`;
  const call = async (method, route, body, who) => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const parsed = await res.json();
    assertBareReasons(parsed, `${method} ${route}`);
    return { status: res.status, body: parsed };
  };
  const close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  open.add(close);
  return {
    kit,
    clock: kit.clock,
    calls: kit.calls,
    store: kit.store,
    train: (body) => call('POST', '/admin/train', body, 'OP'),
    thread: (who = 'A') => call('GET', '/thread', undefined, who),
    doc: (uid = 'uA') => kit.store.get(threadDocName(uid)),
    close: () => { open.delete(close); return close(); }
  };
}
const serveWith = (kitOpts, opts = {}) => serve({ kit: makeKit(kitOpts), ...opts });
const dayStamp = (count) => new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + count).toISOString();

test('precondition: the fixture makes five shapes, the 33% journey the only 5, highest first', () => {
  assert.equal(EXPECTED.length, 5, JSON.stringify(EXPECTED.map((r) => r.prompt)));
  assert.deepEqual(EXPECTED.map((r) => [r.journeyId, r.rating]), [['jz3', 5], ['jz2', 4], ['jz4', 4], ['jz1', 4], ['jz5', 4]]);
  assert.deepEqual([SHAPE_LEARNS_PER_DAY, SHAPE_LEARNS_APP_PER_DAY, SHAPE_MIN_VISITS, SHAPE_MIN_ORDERS], [3, 100, 200, 20]);
  assert.equal(SHAPES_DAY_DOC, 'assistant.shapes-day');
});

test('a training run sends the shapes to the shared brain on the app’s own account, with exactly five fields and nothing a user typed', async () => {
  const s = await serve();
  const r = await s.train({ userIds: ['uA'] });
  assert.equal(r.status, 200);
  assert.equal(s.calls.learn.length, 3, 'three a day');
  for (const body of s.calls.learn) {
    assert.deepEqual(Object.keys(body).sort(), ['accountId', 'kind', 'niche', 'prompt', 'rating']);
    assert.equal(body.accountId, 'jourvance', 'the app’s own account, never the user');
    assert.equal(body.kind, 'journey-shape');
    const blob = JSON.stringify(body).toLowerCase();
    for (const leak of [TOKEN, 'uA', 'jz', 'rosa', 'buyer', '.example', 'http', '41.37', 'pottery', 'funnel', 'headline']) {
      assert.ok(!blob.includes(leak.toLowerCase()), `${leak} reached the learn: ${blob}`);
    }
    assert.match(body.prompt, /^Orders per hundred visits: [a-z]+ to [a-z ]+\. A (sales|leads|general) journey from (Meta|Google|TikTok|organic traffic|an unnamed source) with [a-z -]+ steps?: [a-z-]+( then [a-z-]+)*\.$/);
    assert.match(body.prompt, /^[^0-9]*$/, 'no digit reaches the hub');
  }
  // The highest rated first: the 33% TikTok journey, then the next two by rate.
  assert.deepEqual(s.calls.learn.map((b) => [b.prompt, b.niche, b.rating]), EXPECTED.slice(0, 3).map((e) => [e.prompt, e.niche, e.rating]));
  assert.equal(s.calls.learn[0].prompt, 'Orders per hundred visits: thirty to forty. A sales journey from TikTok with four steps: ad then page then downsell then thank-you.');
  const doc = s.doc();
  assert.deepEqual(doc.shapeDays, { [TODAY]: 3 });
  assert.deepEqual(doc.shapeLearns, Object.fromEntries(EXPECTED.slice(0, 3).map((e) => [e.sha, TODAY])));
  assert.deepEqual(s.store.get(SHAPES_DAY_DOC), { day: TODAY, count: 3 }, 'the app-wide budget counted them');
  // The report: per user and in total, beside a `counts` that kept its shape.
  assert.deepEqual(r.body.users[0].shapes, { sent: 3, skipped: 2, failed: 0 });
  assert.deepEqual(r.body.shapes, { sent: 3, skipped: 2, failed: 0 });
  assert.deepEqual(Object.keys(r.body.counts).sort(), ['accounts', 'failed', 'sent', 'skipped', 'unchanged', 'wouldSend']);
  assert.ok(!JSON.stringify(r.body).includes('uA') && !JSON.stringify(r.body).includes(TOKEN));
  await s.close();
});

test('three a day: a second run the same day sends nothing, the next day sends the other two, and a shape sent inside thirty days is not sent again', async () => {
  const s = await serve();
  await s.train({ userIds: ['uA'] });
  let r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 3, 'the cap held');
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeCap });
  s.clock.t += DAY_MS;
  r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 5);
  assert.deepEqual(s.calls.learn.slice(3).map((b) => b.prompt), EXPECTED.slice(3).map((e) => e.prompt), 'only the two not yet sent');
  assert.deepEqual(r.body.users[0].shapes, { sent: 2, skipped: 3, failed: 0 });
  assert.deepEqual(s.doc().shapeDays, { '2026-10-12': 2 });
  assert.deepEqual(s.store.get(SHAPES_DAY_DOC), { day: '2026-10-12', count: 2 }, 'a new day, a new app count');
  s.clock.t += DAY_MS;
  r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 5);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeSentRecently });
  // Thirty days after the first send, the first three may go again.
  s.clock.t = START + 30 * DAY_MS;
  r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 8);
  assert.deepEqual(s.calls.learn.slice(5).map((b) => b.prompt), EXPECTED.slice(0, 3).map((e) => e.prompt));
  await s.close();
});

test('the background run after GET thread: the answer never waits on it, it sends the shapes, and it runs once a day', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await serveWith({ learn: () => gate }, { timeouts: { learn: 4000 } });
  try {
    // A learn that has not answered must not hold the thread answer (planted: GET awaiting the job).
    const first = await Promise.race([s.thread(), sleep(1500).then(() => 'late')]);
    assert.notEqual(first, 'late', 'the thread answer waited on the training job');
    assert.equal(first.status, 200);
    await until(() => s.calls.learn.length === 1, 3000, 'the background job to reach the first learn');
    assert.deepEqual(s.doc()?.shapeLearns || {}, {}, 'nothing recorded before the hub answered');
  } finally {
    release({ success: true, ingested: true });
  }
  await until(() => Object.keys(s.doc()?.shapeLearns || {}).length === 3, 3000, 'the shapes record');
  assert.equal(s.calls.learn.length, 3);
  // The same day: one thread read and no training job (planted: the once-a-day gate removed).
  const gets = s.calls.get.length;
  const loads = s.calls.events;
  await s.thread();
  await sleep(80);
  assert.equal(s.calls.get.length, gets + 1, 'only the thread was read');
  assert.equal(s.calls.events, loads, 'no training job read the event log again the same day');
  assert.equal(s.calls.learn.length, 3);
  // The next day the job runs again (the positive control for the gate).
  s.clock.t += DAY_MS;
  await s.thread();
  await until(() => s.calls.events > loads, 3000, 'the next day’s job');
  await s.close();
});

test('a duplicate is landed and its sha recorded; a refusal records nothing and reports failed; a learn that never answers is a timeout', async () => {
  const dup = await serveWith({ learn: { success: true, ingested: false, reason: 'duplicate' } });
  let r = await dup.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 3, skipped: 2, failed: 0 });
  assert.deepEqual(Object.keys(dup.doc().shapeLearns).sort(), EXPECTED.slice(0, 3).map((e) => e.sha).sort());
  await dup.close();

  // Below the hub's threshold is not a duplicate: not landed.
  const below = await serveWith({ learn: { success: true, ingested: false, reason: 'below winner threshold (needs >= 4).' } });
  r = await quiet(() => below.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 2, failed: 3, reason: REASONS.shapeRefused });
  assert.deepEqual(below.doc().shapeLearns, {});
  await below.close();

  const refused = await serveWith({ learn: { error: 'Data flow "brainIngest" is disabled for this app in the Connectors panel.', status: 403 } });
  r = await quiet(() => refused.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 2, failed: 3, reason: REASONS.shapeRefused });
  assert.deepEqual(r.body.shapes, { sent: 0, skipped: 2, failed: 3 });
  const doc = refused.doc();
  assert.deepEqual(doc.shapeLearns, {}, 'a refused shape is never recorded as sent');
  assert.deepEqual(doc.shapeDays, { [TODAY]: 3 }, 'the attempts count');
  await refused.close();

  // One lands, one is refused: only the one that landed is recorded.
  const mixed = await serveWith({ learn: (body, n) => (n === 2 ? { error: 'HTTP 500', status: 500 } : { success: true, ingested: true }) });
  r = await quiet(() => mixed.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 2, skipped: 2, failed: 1, reason: REASONS.shapeRefused });
  assert.deepEqual(Object.keys(mixed.doc().shapeLearns).sort(), [EXPECTED[0].sha, EXPECTED[2].sha].sort());
  await mixed.close();

  const hung = await serveWith({ learn: NEVER }, { timeouts: { learn: 40 } });
  r = await quiet(() => hung.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 4, failed: 1, reason: REASONS.timeout }, 'a hub that does not answer is not asked again in this job');
  assert.equal(hung.calls.learn.length, 1);
  assert.deepEqual(hung.doc().shapeLearns, {});
  await hung.close();
});

test('a dry run sends and writes nothing and lists the rows that would leave, each journey named by a hash', async () => {
  const s = await serve();
  const r = await s.train({ userIds: ['uA'], dryRun: true });
  assert.equal(r.status, 200);
  assert.equal(s.calls.learn.length + s.calls.put.length + s.calls.replace.length, 0, 'nothing sent, nothing written');
  const shapes = r.body.users[0].shapes;
  assert.deepEqual([shapes.sent, shapes.skipped, shapes.failed, shapes.reason], [0, 2, 0, REASONS.dryRun]);
  assert.equal(shapes.rows.length, 3);
  const hashed = (id) => `j_${crypto.createHash('sha256').update(`jourvance-assistant-train-journey:${id}`).digest('hex').slice(0, 16)}`;
  assert.deepEqual(shapes.rows, EXPECTED.slice(0, 3).map((e) => ({ prompt: e.prompt, niche: e.niche, rating: e.rating, journeyId: hashed(e.journeyId) })));
  for (const row of shapes.rows) assert.match(row.journeyId, /^j_[0-9a-f]{16}$/);
  const blob = JSON.stringify(r.body);
  for (const raw of ['jz1', 'jz2', 'jz3', 'uA', TOKEN, '@']) assert.ok(!blob.includes(raw), `${raw} in the operator answer`);
  assert.deepEqual(r.body.shapes, { sent: 0, skipped: 2, failed: 0 });
  // A real run afterwards sends exactly the rows the dry run listed.
  await s.train({ userIds: ['uA'] });
  assert.deepEqual(s.calls.learn.map((b) => b.prompt), shapes.rows.map((row) => row.prompt));
  await s.close();
});

test('nothing leaves unless the record was read and the day claimed by a save that landed, and the file’s outcome never stops the shapes', async () => {
  const unread = await serveWith({ docsGet: () => ({ error: 'HTTP 503', status: 503 }) });
  let r = await quiet(() => unread.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.recordUnread });
  assert.equal(unread.calls.learn.length, 0);
  await unread.close();

  // A thread claim the store does not confirm sends nothing (the app budget is claimed first and stays spent).
  const unsaved = await serveWith({ docsPut: (name) => (name.startsWith('assistant.u.') ? {} : undefined) });
  r = await quiet(() => unsaved.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.recordUnread });
  assert.equal(unsaved.calls.learn.length, 0, 'a claim the store did not confirm sends nothing');
  await unsaved.close();

  // The what-worked file is refused; the shapes still go.
  const fileRefused = await serveWith({ replacePost: { error: 'Refused.', status: 403 } });
  r = await quiet(() => fileRefused.train({ userIds: ['uA'] }));
  assert.equal(r.body.users[0].sent, false);
  assert.deepEqual(r.body.users[0].shapes, { sent: 3, skipped: 2, failed: 0 });
  await fileRefused.close();

  // A partial read sends no shape: a rate from part of the orders is not this journey's rate.
  const partial = await serve({ orders: () => { throw new Error('orders down'); } });
  r = await quiet(() => partial.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 0, failed: 0, reason: REASONS.dataIncomplete });
  assert.equal(partial.calls.learn.length, 0);
  await partial.close();

  // No hub: nothing is sent and the report says why.
  const off = await serve({ hubReady: false });
  r = await off.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.noHub });
  await off.close();

  // An account with nothing past two hundred visits and twenty orders has no shape to share.
  const none = await serve({ orders: () => [] });
  r = await none.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 0, failed: 0, reason: REASONS.shapesNone });
  await none.close();
});

test('a capped event log sends no shape: the trim dropped visits and kept every order (the adversary’s p1b-partial.mjs)', async () => {
  // One journey whose newest 250 visits survived the per-user trim while its 50 orders all did: 20%
  // on the page, far above what was measured, so the shape would teach an inflated band.
  const keep = 250;
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ userId: 'uA', journeyId: 'jp2', type: 'page_view', visitorId: `w${i}`, at }));
  const journeys = [journeyOf('jp1', { userId: 'uA', goal: 'sales', nodes: [lp('jp1', 0)] }), journeyOf('jp2', { userId: 'uA', goal: 'leads', nodes: [] })];
  const pages = { [slugOf('jp1')]: { slug: slugOf('jp1'), userId: 'uA', journeyId: 'jp1' } };
  const orders = Array.from({ length: 50 }, () => ({ userId: 'uA', attributedSlug: slugOf('jp1'), totalPrice: 10, createdAt: at }));
  const views = Array.from({ length: keep }, (_, i) => ({ userId: 'uA', journeyId: 'jp1', type: 'page_view', visitorId: `v${i}`, at }));
  const capped = [...views, ...filler(EVENTS_KEPT - keep)];
  assert.equal(eventsPartial(capped, 'uA', trainingWindow(START).cutoff), true, 'precondition: the log is at the cap inside the window');
  let s = await serve({ journeys: () => ({ journeys, complete: true }), events: () => capped, orders: () => orders, pages });
  let r = await s.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 0, failed: 0, reason: REASONS.dataIncomplete });
  assert.equal(s.calls.learn.length, 0);
  await s.close();
  // One row under the cap is a complete log, and the same journey's shape goes (the positive control).
  const whole = capped.slice(0, -1);
  assert.equal(eventsPartial(whole, 'uA', trainingWindow(START).cutoff), false);
  s = await serve({ journeys: () => ({ journeys, complete: true }), events: () => whole, orders: () => orders, pages });
  r = await s.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 1, skipped: 0, failed: 0 });
  await s.close();
});

test('the app-wide budget: the hundred and first shape of a day is skipped, a claim another run holds sends nothing, an unreadable budget sends nothing', async () => {
  // 99 already sent today: one slot left, so one of uA's three goes and the app count reaches 100.
  let s = await serve();
  s.store.set(SHAPES_DAY_DOC, { day: TODAY, count: 99 });
  s.kit.stamps.set(SHAPES_DAY_DOC, dayStamp(97));
  let r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 1);
  assert.deepEqual(r.body.users[0].shapes, { sent: 1, skipped: 4, failed: 0, reason: REASONS.shapeAppCap });
  assert.deepEqual(s.store.get(SHAPES_DAY_DOC), { day: TODAY, count: 100 });
  assert.deepEqual(s.doc().shapeDays, { [TODAY]: 1 }, 'the account is charged only what the app granted');
  await s.close();
  // The 101st: nothing goes, and the account's own slots are not spent.
  s = await serve({ ...BOTH });
  s.store.set(SHAPES_DAY_DOC, { day: TODAY, count: 100 });
  r = await s.train({ userIds: ['uB'] });
  assert.equal(s.calls.learn.length, 0);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeAppCap });
  assert.equal(s.doc('uB')?.shapeDays?.[TODAY], undefined, 'no slot of the account was claimed');
  await s.close();

  // Yesterday's count does not hold today back.
  s = await serve();
  s.store.set(SHAPES_DAY_DOC, { day: '2026-10-10', count: 100 });
  r = await s.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 3, skipped: 2, failed: 0 });
  await s.close();

  // A count that will not parse is a full day, never zero.
  s = await serve();
  s.store.set(SHAPES_DAY_DOC, { day: TODAY, count: 'lots' });
  r = await s.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeAppCap });
  await s.close();

  // Another run holds the claim (the store answers 409 stale): nothing is sent this pass.
  s = await serveWith({ docsPut: (name, document, opts) => (name === SHAPES_DAY_DOC && opts.onlyIfNewer ? { error: 'The store already holds a copy at least as new as this one, so it was not written.', status: 409, stale: true } : undefined) });
  r = await s.train({ userIds: ['uA'] });
  assert.equal(s.calls.learn.length, 0);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeAppClaimed });
  assert.equal(s.doc()?.shapeDays?.[TODAY], undefined);
  await s.close();

  // The budget cannot be read: nothing is sent.
  s = await serveWith({ docsGet: (name, store) => (name === SHAPES_DAY_DOC ? { error: 'HTTP 503', status: 503 } : (store.has(name) ? { name, document: structuredClone(store.get(name)) } : { error: 'No such document.', status: 404 })) });
  r = await quiet(() => s.train({ userIds: ['uA'] }));
  assert.equal(s.calls.learn.length, 0);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.shapeAppUnchecked });
  await s.close();
});

test('two servers sharing one store: the app budget holds across accounts, and one account is claimed once', async () => {
  // Three slots left today; uA and uB each want three, on two servers at once, with store latency.
  const kit = makeKit({ latency: 25 });
  kit.store.set(SHAPES_DAY_DOC, { day: TODAY, count: 97 });
  kit.stamps.set(SHAPES_DAY_DOC, dayStamp(95));
  const s1 = await serve({ kit, ...BOTH });
  const s2 = await serve({ kit, ...BOTH });
  let [r1, r2] = await quiet(() => Promise.all([s1.train({ userIds: ['uA'] }), s2.train({ userIds: ['uB'] })]));
  assert.equal(kit.calls.learn.length, 3, 'never more than the app had left');
  assert.deepEqual(kit.store.get(SHAPES_DAY_DOC), { day: TODAY, count: 100 });
  assert.equal(r1.body.users[0].shapes.sent + r2.body.users[0].shapes.sent, 3);

  await s1.close();
  await s2.close();

  // The adversary's race (p3b-race.test.mjs, 6 learns and 2 sends before the fix): one account
  // trained by both servers at once, on a fresh store.
  const raceKit = makeKit({ latency: 25 });
  const t1 = await serve({ kit: raceKit });
  const t2 = await serve({ kit: raceKit });
  [r1, r2] = await quiet(() => Promise.all([t1.train({ userIds: ['uA'] }), t2.train({ userIds: ['uA'] })]));
  assert.equal(raceKit.calls.learn.length, 3, 'one account, three shapes, whichever server claimed first');
  assert.equal(raceKit.calls.replace.length, 1, 'one what-worked send');
  assert.deepEqual(raceKit.store.get(threadDocName('uA')).shapeDays, { [TODAY]: 3 });
  const reasons = [r1, r2].flatMap((r) => [r.body.users[0].reason, r.body.users[0].shapes.reason]);
  assert.ok(reasons.includes(REASONS.claimTaken), `the loser says another run claimed it: ${reasons}`);
  await t1.close();
  await t2.close();
});

test('a thread claim the store refuses as stale is another run’s: no file and no shape is sent', async () => {
  const s = await serveWith({ docsPut: (name, document, opts) => (name.startsWith('assistant.u.') && opts.onlyIfNewer ? { error: 'The store already holds a copy at least as new as this one, so it was not written.', status: 409, stale: true } : undefined) });
  const r = await quiet(() => s.train({ userIds: ['uA'] }));
  assert.deepEqual([r.body.users[0].sent, r.body.users[0].reason], [false, REASONS.claimTaken]);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 5, failed: 0, reason: REASONS.claimTaken });
  assert.equal(s.calls.learn.length + s.calls.replace.length, 0);
  await s.close();
});

test('another user’s run never sends this user’s shapes', async () => {
  const s = await serve();
  const r = await s.train({ userIds: ['uB'] });
  assert.equal(s.calls.learn.length, 0);
  assert.deepEqual(r.body.users[0].shapes, { sent: 0, skipped: 0, failed: 0, reason: REASONS.shapesNone });
  assert.equal(s.doc('uA'), undefined);
  await s.close();
});

test('every shape reason the routes answered was one bare cause, and each was reached', () => {
  const seen = new Set(reasonsSeen);
  for (const r of [REASONS.shapesNone, REASONS.shapeSentRecently, REASONS.shapeCap, REASONS.shapeRefused, REASONS.dryRun, REASONS.recordUnread, REASONS.dataIncomplete, REASONS.timeout, REASONS.noHub,
    REASONS.claimTaken, REASONS.shapeAppCap, REASONS.shapeAppClaimed, REASONS.shapeAppUnchecked]) {
    assert.ok(seen.has(r), `never answered: ${r}`);
  }
});
