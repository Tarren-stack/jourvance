// Ask Jourvance evaluation, the CI half (ASK_JOURVANCE_PLAN.md Wave 2, S5). No hub and no credits:
// the hub is a stub that records what the route sends. For each of the golden questions in
// test-fixtures/assistant-eval.json, one test() asserts that the guide selection includes the
// sections the fixture names, that the system text carries every FACTS key the fixture names (with
// a value, not null), that the prompt sent to the hub is the question itself, and that the system
// text holds no em dash. The live half (real answers, scored) is scripts/assistant-eval.mjs.
// Dashes in this file are written as \u escapes so it carries none.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { setupAiAssistantRoutes } from './server/routes/aiAssistantRoutes.mjs';
import { buildContextPack } from './server/assistantContext.mjs';
import { loadGuideSections, guideSectionsFor } from './server/assistantGuide.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GUIDE_PATH = path.join(ROOT, 'docs', 'assistant', 'jourvance-guide.md');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-fixtures', 'assistant-eval.json'), 'utf8'));
const FACT_KEYS = ['business', 'journeys', 'last30Days', 'email'];
const BAD_DASH = /—|\s–\s/;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// ---- The fixture account: two journeys with names, 90 days of events and orders, contacts, email stats ----

const UID = 'uEval';
const WORKSPACE = {
  id: 'ws-eval', userId: UID, name: 'Rosa Ceramics', planTier: 'pro',
  shopifyConfig: { storeDomain: 'kilnhaus.myshopify.com', shopName: 'Kilnhaus', status: 'connected', adminAccessToken: 'shpat_EVAL_SECRET' }
};
const node = (id, type, label) => ({ id, type, data: { label } });
const JOURNEYS = [
  { id: 'jA', userId: UID, name: 'Spring Glaze Sale', goal: 'leads', businessType: 'Pottery studio', offerHeadline: 'Free taster class',
    nodes: [node('a1', 'ad-source', 'Instagram Ad'), node('a2', 'landing-page', 'Glaze Picker Page'), node('a3', 'lead-form', 'Taster Signup')], updatedAt: iso(NOW - DAY) },
  { id: 'jB', userId: UID, name: 'Summer Class Waitlist', goal: 'leads', businessType: 'Pottery studio', offerHeadline: 'Join the waitlist',
    nodes: [node('b1', 'landing-page', 'Waitlist Page'), node('b2', 'thank-you', 'Thanks')], updatedAt: iso(NOW - 2 * DAY) }
];
const PAGES = {
  'spring-glaze-sale': { slug: 'spring-glaze-sale', userId: UID, journeyId: 'jA' },
  'summer-waitlist': { slug: 'summer-waitlist', userId: UID, journeyId: 'jB' }
};
const EVENTS = [];
const ORDERS = [];
for (let d = 0; d < 90; d++) {
  const at = iso(NOW - d * DAY - 3600000);
  for (const [jid, n] of [['jA', 3], ['jB', 2]]) {
    for (let i = 0; i < n; i++) EVENTS.push({ type: 'page_view', userId: UID, journeyId: jid, visitorId: `v-${jid}-${d}-${i}`, at });
    if (d % 3 === 0) EVENTS.push({ type: 'lead', userId: UID, journeyId: jid, visitorId: `v-${jid}-${d}-0`, at });
  }
  if (d % 5 === 0) ORDERS.push({ attributedSlug: 'spring-glaze-sale', createdAt: at, totalPrice: '48.50' });
}
const CONTACTS = Array.from({ length: 37 }, (_, i) => ({ email: `c${i}@example.org` }));
const EMAIL_STATS = { sent: 220, opened: 91, clicked: 23, unsubscribed: 3, revenue: 410.25 };

const dirs = [];
const closers = [];
after(async () => {
  await Promise.all(closers.map((c) => c()));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

async function serve() {
  const calls = [];
  const hub = {
    brain: { chat: async (prompt, opts) => { calls.push({ prompt, opts }); return { success: true, text: 'Open Attribution to see it.' }; }, learn: async () => ({ success: true }) },
    api: { post: async () => ({ success: true }) },
    store: { docs: { get: async () => ({ error: 'No such document.', status: 404 }), put: async (name) => ({ name, rev: 1 }) } }
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-eval-'));
  dirs.push(dataDir);
  fs.copyFileSync(GUIDE_PATH, path.join(dataDir, 'jourvance-guide.md'));
  const panelCopy = path.join(path.dirname(GUIDE_PATH), 'panel-copy.md');
  if (fs.existsSync(panelCopy)) fs.copyFileSync(panelCopy, path.join(dataDir, 'panel-copy.md'));
  const app = express();
  app.use(express.json());
  process.env.ASSISTANT_PER_HOUR = '500';
  setupAiAssistantRoutes(app, {
    requireUser: (req, res, next) => { req.user = { uid: UID, email: 'rosa@example.org' }; next(); },
    hub, hubReady: true, hubAppId: 'jourvance',
    listWorkspacesDetailed: async () => ({ workspaces: [WORKSPACE], complete: true }),
    listJourneys: async () => ({ journeys: JOURNEYS, complete: true }),
    loadEvents: () => EVENTS,
    loadOrders: () => ORDERS,
    contactsForUser: () => CONTACTS,
    messageStatsFor: () => EMAIL_STATS,
    publicPageCache: () => PAGES,
    guidePath: GUIDE_PATH,
    dataDir,
    now: () => NOW
  });
  delete process.env.ASSISTANT_PER_HOUR;
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/ai/assistant`;
  closers.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
  const post = async (route, body) => (await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const clear = async () => (await fetch(base + '/thread', { method: 'DELETE' })).json();
  return { calls, ask: (message) => post('/ask', { message }), clear };
}

const factsOf = (system) => {
  const line = system.split('\n').find((l) => l.startsWith('FACTS (data): '));
  assert.ok(line, 'the system text has a FACTS line');
  return JSON.parse(line.slice('FACTS (data): '.length));
};

// ---- The fixture file itself ----

test('the golden file: 30 questions, unique ids, the mix the plan asks for, and every heading is a real guide heading', () => {
  const qs = FIXTURE.questions;
  assert.ok(Array.isArray(qs));
  assert.equal(qs.length, 30);
  assert.equal(new Set(qs.map((q) => q.id)).size, 30, 'ids are unique');
  const headings = new Set(loadGuideSections(GUIDE_PATH).map((s) => s.heading));
  assert.equal(headings.size, 11, 'the guide has eleven sections');
  for (const q of qs) {
    assert.equal(typeof q.question, 'string', q.id);
    assert.ok(q.question.trim().length > 5, q.id);
    assert.ok(Array.isArray(q.expectSections) && Array.isArray(q.expectFacts), q.id);
    assert.equal(typeof q.expectScreenName, 'boolean', q.id);
    for (const h of q.expectSections) assert.ok(headings.has(h), `${q.id}: "${h}" is not a guide heading`);
    for (const k of q.expectFacts) assert.ok(FACT_KEYS.includes(k), `${q.id}: "${k}" is not a FACTS key`);
  }
  const count = (p) => qs.filter((q) => q.id.startsWith(p)).length;
  assert.ok(count('num-') >= 10, 'at least ten about their numbers');
  assert.ok(count('use-') >= 10, 'at least ten about how to use the app');
  assert.ok(count('out-') >= 5, 'at least five mixed or out of scope');
  assert.ok(qs.filter((q) => q.id.startsWith('out-')).every((q) => q.mustNotClaim), 'every out-of-scope question names what it must not claim');
});

test('the fixture account is sound: the pack holds the numbers the golden questions ask about', () => {
  const pack = buildContextPack({ uid: UID, workspaces: [WORKSPACE], journeys: JOURNEYS, events: EVENTS, orders: ORDERS, contacts: CONTACTS, emailStats: EMAIL_STATS, publicPages: PAGES, now: NOW });
  assert.deepEqual(pack.unavailable, []);
  for (const k of FACT_KEYS) assert.ok(pack[k], `pack.${k} is present`);
  assert.deepEqual(pack.journeys.map((j) => j.name), ['Spring Glaze Sale', 'Summer Class Waitlist']);
  const a = pack.last30Days.journeys[0];
  assert.equal(a.name, 'Spring Glaze Sale');
  assert.ok(a.visits > 0 && a.leads > 0 && a.orders > 0 && a.revenue > 0, JSON.stringify(a));
  assert.equal(pack.email.contacts, 37);
  assert.equal(pack.email.sent, 220);
  assert.ok(!JSON.stringify(pack).includes('shpat_EVAL_SECRET'), 'no token in the pack');
});

// ---- One test per golden question ----

let server;
for (const q of FIXTURE.questions) {
  test(`golden ${q.id}: ${q.question}`, async () => {
    server ??= await serve();
    const s = server;
    // Selection: the real function over the real guide.
    const picked = guideSectionsFor(q.question, loadGuideSections(GUIDE_PATH)).map((x) => x.heading);
    for (const h of q.expectSections) assert.ok(picked.includes(h), `selection for "${q.question}" is [${picked.join(' | ')}], missing "${h}"`);

    // The route: the question is the prompt, and the system text is built from the real pieces.
    await s.clear();
    const before = s.calls.length;
    const r = await s.ask(q.question);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(s.calls.length, before + 1, 'exactly one hub call');
    const { prompt, opts } = s.calls[before];
    assert.equal(prompt, q.question, 'the prompt is the question itself');
    assert.equal(typeof opts.system, 'string');
    const facts = factsOf(opts.system);
    for (const k of q.expectFacts) {
      assert.ok(Object.hasOwn(facts, k) && facts[k] !== null, `FACTS carries ${k}`);
    }
    for (const h of q.expectSections) assert.ok(opts.system.includes(`## ${h}`), `the system text carries the "${h}" section`);
    assert.ok(!BAD_DASH.test(opts.system), 'the system text has no em dash or spaced en dash');
    assert.ok(!opts.system.includes('shpat_EVAL_SECRET'), 'no store token reaches the model');
  });
}
