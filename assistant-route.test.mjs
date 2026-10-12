// Ask Jourvance over HTTP (server/routes/aiAssistantRoutes.mjs, ASK_JOURVANCE_PLAN.md section 3), on a
// bare Express app with the hub stubbed, the way ai-journey-route.test.mjs drives /api/ai/journey-plan.
// Covers every refusal on ask, the assistant's own hourly budget, the account-scope fallback on an
// injected clock, what the hub is sent, the tenancy of the thread document, THREAD_KEEP, the notes
// and the private profile, the flywheel feedback with its scrub and caps, and the clear.
// Dashes in this file are written as \u escapes so it carries none.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { setupAiAssistantRoutes, threadDocName, ACCOUNT_REFUSAL, ACCOUNT_REFUSAL_MS, PROFILE_PATH, REPLACE_PATH, PATTERNS_DOC, THREAD_FILE, THREAD_CACHE_USERS, REASONS, bounded, threadLocks } from './server/routes/aiAssistantRoutes.mjs';
import * as auth from './server/routes/authWorkspaceRoutes.mjs';
import { LIMITS } from './server/assistantContext.mjs';
import { limitMessage } from './server/routes/aiJourneyRoutes.mjs';
// The account-scope memory is one per process now (server/aiCall.mjs); each mounted app starts fresh,
// as it did when the memory lived in the route module.
import { resetAccountRefusalForTest } from './server/aiCall.mjs';

const EM = '\u2014';
const START = Date.UTC(2026, 9, 11, 12, 0, 0);
const USERS = { A: { uid: 'uA', email: 'rosa.delgado@gmail.com' }, B: { uid: 'uB', email: 'ben@example.org' } };

const WORKSPACE = {
  id: 'ws-1',
  userId: 'uA',
  name: 'Rosa Ceramics',
  planTier: 'pro',
  shopifyConfig: { storeDomain: 'kilnhaus.myshopify.com', shopName: 'Kilnhaus', status: 'connected', adminAccessToken: 'shpat_ROUTE_SECRET', webhookSecret: 'whsec_ROUTE_SECRET', pixelKey: 'pk_ROUTE_SECRET' }
};
const JOURNEY = {
  id: 'j1',
  userId: 'uA',
  name: 'Spring Glaze Sale',
  goal: 'leads',
  businessType: 'Pottery studio',
  offerHeadline: 'Free taster class',
  nodes: [{ id: 'n1', type: 'landing-page', data: { label: 'Glaze Picker Page', slug: 'spring-glaze-sale' } }],
  updatedAt: new Date(START - 86400000).toISOString()
};

// The guide the flywheel allowlist is read from in these tests (with a panel-copy.md beside it).
const GUIDE_FIXTURE = `# Jourvance guide

## Publish and custom domains
Press Publish to put a funnel page live. Each page can have a custom domain.

## Email Studio
Write an email flow after a lead form.
`;
const NEVER = () => new Promise(() => {});

// The client wraps every `reason` in its own sentence, so a reason is ONE bare cause: one sentence,
// one full stop at its end, no advice, no variable name. The two contract codes are not sentences.
const REASON_CODES = new Set(['ai-unavailable', 'hourly-ai-limit']);
const reasonsSeen = [];
function assertBareReasons(value, where) {
  if (Array.isArray(value)) return value.forEach((v) => assertBareReasons(v, where));
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (key === 'reason' && typeof v === 'string' && !REASON_CODES.has(v)) {
      reasonsSeen.push(v);
      assert.ok(!v.includes('HUB_API_KEY'), `${where}: a variable name in a reason: ${v}`);
      assert.ok(!v.includes('Try '), `${where}: advice in a reason: ${v}`);
      assert.match(v, /^[A-Z][^.]*\.$/, `${where}: not one sentence with one full stop at its end: ${v}`);
    } else {
      assertBareReasons(v, where);
    }
  }
}
const SHORT = { store: 40, profile: 40, learn: 40, chat: 40 };

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

/**
 * A bare app with the assistant mounted. `brain`, `learn` and `profilePost` are the hub's answers
 * (a value, or a function of the call). `seed` puts documents in the stubbed app store.
 */
async function serve({
  hubReady = true,
  brain = { success: true, text: 'Open Attribution to see where people leave.' },
  learn = { success: true, ingested: true },
  profilePost = { success: true },
  seed = {},
  docsGet,
  docsPut,
  workspaces = () => [WORKSPACE],
  journeys = () => ({ journeys: [JOURNEY], complete: true }),
  events = () => [],
  orders = () => [],
  contacts = () => [],
  emailStats = () => ({ sent: 10, opened: 4, clicked: 2, unsubscribed: null, revenue: null }),
  pages = {},
  guidePath,
  timeouts,
  cacheSeed,
  extraDeps = {},
  replacePost = { success: true, file: { id: 'f1' }, replaced: 1 },
  ingest = { success: true, file: { id: 'p1' } },
  hub: hubOverride
} = {}) {
  resetAccountRefusalForTest();
  const clock = { t: START };
  // `profile` holds the profile posts only; the training send (a different hub path) has its own list.
  const calls = { brain: [], learn: [], profile: [], replace: [], ingest: [], get: [], put: [] };
  const store = new Map(Object.entries(seed));
  const stamps = new Map();
  const answer = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
  const hub = hubOverride !== undefined ? hubOverride : {
    brain: {
      chat: async (prompt, opts) => { calls.brain.push({ prompt, opts }); return answer(brain, prompt, opts, calls); },
      learn: async (body) => { calls.learn.push(body); return answer(learn, body); },
      ingest: async (body) => { calls.ingest.push(body); return answer(ingest, body); }
    },
    api: {
      post: async (p, body) => {
        if (p === PROFILE_PATH) { calls.profile.push({ path: p, body }); return answer(profilePost, body); }
        calls.replace.push({ path: p, body });
        return answer(replacePost, body);
      }
    },
    store: {
      docs: {
        get: async (name) => {
          calls.get.push(name);
          if (docsGet) return docsGet(name, store);
          return store.has(name) ? { name, document: structuredClone(store.get(name)) } : { error: 'No such document.', status: 404 };
        },
        // The hub's conditional write: with onlyIfNewer, a stored stamp at least as new is a 409 stale.
        put: async (name, document, opts = {}) => {
          if (docsPut) return docsPut(name, document, opts, store);
          const stored = Date.parse(stamps.get(name) || '');
          if (opts?.onlyIfNewer && Number.isFinite(stored) && stored >= Date.parse(opts.sourceUpdatedAt)) {
            return { error: 'The store already holds a copy at least as new as this one, so it was not written.', status: 409, stale: true };
          }
          calls.put.push({ name, document: structuredClone(document), opts });
          store.set(name, structuredClone(document));
          if (opts?.sourceUpdatedAt) stamps.set(name, opts.sourceUpdatedAt);
          return { name, rev: calls.put.length };
        }
      }
    }
  };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-route-'));
  dirs.push(dataDir);
  fs.mkdirSync(path.join(dataDir, 'guide'));
  const defaultGuide = path.join(dataDir, 'guide', 'jourvance-guide.md');
  fs.writeFileSync(defaultGuide, GUIDE_FIXTURE);
  fs.writeFileSync(path.join(dataDir, 'guide', 'panel-copy.md'), '| send.label | Send |');
  if (cacheSeed) fs.writeFileSync(path.join(dataDir, THREAD_FILE), JSON.stringify(cacheSeed));
  const app = express();
  app.use(express.json());
  setupAiAssistantRoutes(app, {
    requireUser: (req, res, next) => {
      const who = USERS[String(req.headers.authorization || '').replace(/^Bearer /, '')];
      if (!who) return res.status(401).json({ success: false, error: 'Sign in to continue.' });
      req.user = { ...who };
      next();
    },
    // The operator is the bearer 'OP'; anyone else gets the 404 requireOperator answers.
    requireOperator: (req, res, next) => {
      if (String(req.headers.authorization || '') !== 'Bearer OP') return res.status(404).json({ success: false, error: 'Not found.' });
      req.user = { uid: 'uOp', email: 'operator@example.com' };
      next();
    },
    hub,
    hubReady,
    hubAppId: 'jourvance',
    listWorkspacesDetailed: async (uid) => {
      const w = await workspaces(uid);
      return Array.isArray(w) ? { workspaces: w, complete: true } : w;
    },
    listJourneys: async (uid) => journeys(uid),
    loadEvents: () => events(),
    loadOrders: () => orders(),
    contactsForUser: (uid) => contacts(uid),
    messageStatsFor: (uid, match) => { assert.equal(typeof match, 'function'); return emailStats(uid); },
    publicPageCache: () => pages,
    guidePath: guidePath || defaultGuide,
    dataDir,
    now: () => clock.t,
    ...(timeouts ? { timeouts } : {}),
    ...extraDeps
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/ai/assistant`;
  const call = async (method, route, body, who = 'A') => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const parsed = await res.json();
    assertBareReasons(parsed, `${method} ${route}`);
    return { status: res.status, headers: res.headers, body: parsed };
  };
  const close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  open.add(close);
  return {
    clock,
    calls,
    store,
    dataDir,
    ask: (message, who) => call('POST', '/ask', { message }, who),
    thread: (who) => call('GET', '/thread', undefined, who),
    clear: (who) => call('DELETE', '/thread', undefined, who),
    notes: (notes, who) => call('POST', '/notes', { notes }, who),
    feedback: (answerId, rating, who) => call('POST', '/feedback', { answerId, rating }, who),
    train: (body, who = 'OP') => call('POST', '/admin/train', body, who),
    call,
    close: () => { open.delete(close); return close(); }
  };
}

const userMsg = (i) => ({ id: `seed-u${i}`, role: 'user', text: `Seeded ${i}: how do I publish a funnel page?`, at: new Date(START - 1000).toISOString() });
const botMsg = (i) => ({ id: `seed-a${i}`, role: 'assistant', text: `Seeded answer ${i}`, at: new Date(START - 1000).toISOString() });

test('401 without a token on all five routes, and the hub is never called', async () => {
  const s = await serve();
  for (const [method, route, body] of [['GET', '/thread'], ['POST', '/ask', { message: 'Hi?' }], ['POST', '/notes', { notes: 'x' }], ['POST', '/feedback', { answerId: 'm', rating: 'up' }], ['DELETE', '/thread']]) {
    const r = await s.call(method, route, body, null);
    assert.equal(r.status, 401, `${method} ${route}`);
    assert.equal(r.body.success, false);
  }
  assert.equal(s.calls.brain.length + s.calls.learn.length + s.calls.profile.length + s.calls.get.length, 0);
  await s.close();
});

test('400 for an empty or over-long question, with no hub call and no budget spent', async () => {
  process.env.ASSISTANT_PER_HOUR = '1';
  const s = await serve();
  delete process.env.ASSISTANT_PER_HOUR;
  for (const bad of ['', '   ', 'x'.repeat(LIMITS.MESSAGE_MAX + 1)]) {
    const r = await s.ask(bad);
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
    assert.match(r.body.error, /^[A-Z].*\.$/);
  }
  assert.equal((await s.call('POST', '/ask', { message: 5 })).status, 400);
  assert.equal(s.calls.brain.length, 0);
  // The one call of the hour is still there.
  assert.equal((await s.ask('How do I publish?')).status, 200);
  await s.close();
});

test('503 ai-unavailable when the hub is off, and when the hub refuses the key or the wallet', async () => {
  const off = await serve({ hubReady: false });
  let r = await off.ask('How do I publish?');
  assert.equal(r.status, 503);
  assert.deepEqual([r.body.success, r.body.reason, r.body.retryable], [false, 'ai-unavailable', false]);
  assert.equal(off.calls.brain.length, 0);
  await off.close();

  for (const refusal of [{ error: 'Invalid API key.', status: 401 }, { error: 'Not enough credits.', status: 402 }, { error: 'Not authorized for this app.', status: 403 }]) {
    const s = await serve({ brain: refusal });
    r = await quiet(() => s.ask('How do I publish?'));
    assert.equal(r.status, 503, JSON.stringify(refusal));
    assert.equal(r.body.reason, 'ai-unavailable');
    assert.equal(r.body.retryable, false);
    assert.equal(s.calls.brain.length, 1, 'a 403 that is not the account refusal is not retried');
    await s.close();
  }
});

test('429 with Retry-After and the limit sentence once the assistant’s OWN hour is spent', async () => {
  process.env.ASSISTANT_PER_HOUR = '2';
  // aiBudgetLeft is not a dependency: handing one in that always refuses changes nothing.
  const s = await serve({ extraDeps: { aiBudgetLeft: () => false, aiBudgetRetryAfter: () => 1 } });
  delete process.env.ASSISTANT_PER_HOUR;
  assert.equal((await s.ask('One?')).status, 200);
  s.clock.t += 10 * 60 * 1000;
  assert.equal((await s.ask('Two?')).status, 200);
  const r = await s.ask('Three?');
  assert.equal(r.status, 429);
  // The first call leaves the window an hour after it was made: 50 minutes from now.
  assert.equal(r.headers.get('retry-after'), String(50 * 60));
  assert.equal(r.body.retryAfterSeconds, 50 * 60);
  assert.equal(r.body.reason, 'hourly-ai-limit');
  assert.equal(r.body.retryable, false);
  assert.equal(r.body.error, limitMessage(50 * 60));
  assert.equal(r.body.error, 'You have reached this hour’s AI limit. Try again in 50 minutes.');
  assert.equal(s.calls.brain.length, 2, 'the refused ask never reached the hub');
  assert.equal((await s.ask('Mine?', 'B')).status, 200, 'another user has their own hour');
  s.clock.t = START + 3600 * 1000;
  assert.equal((await s.ask('Four?')).status, 200, 'the hour has room again');
  await s.close();
  const source = fs.readFileSync(new URL('./server/routes/aiAssistantRoutes.mjs', import.meta.url), 'utf8');
  assert.ok(!/aiBudgetLeft|aiBudgetRetryAfter/.test(source), 'the route never reads the journey drafts’ budget');
});

test('502 retryable when the hub call throws, answers nothing, or answers something unreadable', async () => {
  const cases = [
    () => { throw new Error('socket hang up'); },
    { error: 'Network error reaching the Hub.' },
    { error: 'HTTP 500', status: 500 },
    { success: true, text: '' },
    { success: true, text: 42 },
    { success: true },
    { success: true, text: '  [1] \u2014 ' }
  ];
  for (const brain of cases) {
    const s = await serve({ brain });
    const r = await quiet(() => s.ask('How do I publish?'));
    assert.equal(r.status, 502, String(typeof brain === 'function' ? 'throws' : JSON.stringify(brain)));
    assert.equal(r.body.success, false);
    assert.equal(r.body.retryable, true);
    assert.ok(!r.body.error.includes(EM));
    assert.equal(s.calls.put.length, 0, 'nothing is stored for a failed ask');
    await s.close();
  }
});

test('a loader that throws lands in unavailable and the ask still answers', async () => {
  const s = await serve({
    events: () => { throw new Error('The event log could not be read'); },
    workspaces: () => { throw new Error('hub down'); }
  });
  const r = await quiet(() => s.ask('How many leads did I get?'));
  assert.equal(r.status, 200);
  const facts = JSON.parse(s.calls.brain[0].opts.system.match(/^FACTS \(data\): (.*)$/m)[1]);
  assert.equal(facts.last30Days, null);
  assert.equal(facts.business, null);
  assert.ok(facts.unavailable.includes('last30Days') && facts.unavailable.includes('business'));
  assert.equal(facts.email.sent, 10, 'what could be read is still there');
  await s.close();
});

test('account scope: a refused account is asked again without accountId, remembered for 10 minutes, then tried again', async () => {
  const brain = (prompt, opts) => (Object.hasOwn(opts, 'accountId')
    ? { error: ACCOUNT_REFUSAL, status: 403 }
    : { success: true, text: 'From the app guide.' });
  const s = await serve({ brain });
  let r = await quiet(() => s.ask('How do I publish?'));
  assert.equal(r.status, 200);
  assert.equal(r.body.answer.grounding, 'app');
  assert.equal(s.calls.brain.length, 2, 'exactly one retry');
  assert.equal(s.calls.brain[0].opts.accountId, 'uA');
  assert.ok(!Object.hasOwn(s.calls.brain[1].opts, 'accountId'), 'the retry names no account');
  assert.equal((await s.thread()).body.accountBrain.readable, false);

  r = await s.ask('And then?');
  assert.equal(r.body.answer.grounding, 'app');
  assert.equal(s.calls.brain.length, 3, 'the next ask skips accountId without a second call');
  assert.ok(!Object.hasOwn(s.calls.brain[2].opts, 'accountId'));

  s.clock.t += ACCOUNT_REFUSAL_MS - 1;
  await s.ask('Still remembered?');
  assert.equal(s.calls.brain.length, 4);
  assert.ok(!Object.hasOwn(s.calls.brain[3].opts, 'accountId'));

  s.clock.t += 1;
  r = await quiet(() => s.ask('After ten minutes?'));
  assert.equal(r.status, 200);
  assert.equal(s.calls.brain.length, 6, 'account scope is tried again, refused, and retried once');
  assert.equal(s.calls.brain[4].opts.accountId, 'uA');
  await s.close();

  const allowed = await serve();
  r = await allowed.ask('How do I publish?');
  assert.equal(r.body.answer.grounding, 'account');
  assert.equal(allowed.calls.brain.length, 1);
  assert.equal((await allowed.thread()).body.accountBrain.readable, true);
  await allowed.close();
});

test('a successful ask: the question is the prompt, the system holds FACTS, GUIDE and the history, and both turns are stored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-guide-'));
  dirs.push(dir);
  const guidePath = path.join(dir, 'guide.md');
  fs.writeFileSync(guidePath, '# Guide\n\n## Publish and custom domains\nPress Publish to put pages live.\n\n## Billing\nStarter and Pro.\n');
  let n = 0;
  const s = await serve({ guidePath, brain: () => ({ success: true, text: n++ === 0 ? `You had 12 leads \u2014 a good start [1]. Open Attribution.` : 'Second answer.' }) });
  const first = await s.ask('  How do I publish my spring funnel?  ');
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.equal(first.body.source, 'hub-brain');
  const a = first.body.answer;
  assert.equal(a.role, 'assistant');
  assert.equal(a.grounding, 'account');
  assert.equal(a.text, 'You had 12 leads, a good start. Open Attribution.');
  assert.ok(typeof a.id === 'string' && a.id && !Number.isNaN(Date.parse(a.at)));

  const sent = s.calls.brain[0];
  assert.equal(sent.prompt, 'How do I publish my spring funnel?');
  assert.equal(sent.opts.topK, 4);
  assert.equal(sent.opts.accountId, 'uA');
  const facts = JSON.parse(sent.opts.system.match(/^FACTS \(data\): (.*)$/m)[1]);
  assert.equal(facts.business.name, 'Rosa Ceramics');
  assert.equal(facts.journeys[0].name, 'Spring Glaze Sale');
  assert.equal(facts.email.sent, 10);
  assert.ok(!sent.opts.system.includes('shpat_ROUTE_SECRET') && !sent.opts.system.includes('whsec_ROUTE_SECRET') && !sent.opts.system.includes('pk_ROUTE_SECRET'));
  assert.ok(sent.opts.system.includes('GUIDE (data):\n## Publish and custom domains\nPress Publish to put pages live.'));
  assert.ok(sent.opts.system.includes('RECENT CONVERSATION (data):\nNone yet.'));

  await s.ask('And after that?');
  const second = s.calls.brain[1].opts.system;
  assert.ok(second.includes('RECENT CONVERSATION (data):\nuser: How do I publish my spring funnel?\nassistant: You had 12 leads, a good start. Open Attribution.'));

  const doc = s.store.get(threadDocName('uA'));
  assert.equal(doc.userId, 'uA');
  assert.deepEqual(doc.messages.map((m) => [m.role, m.text]), [
    ['user', 'How do I publish my spring funnel?'],
    ['assistant', 'You had 12 leads, a good start. Open Attribution.'],
    ['user', 'And after that?'],
    ['assistant', 'Second answer.']
  ]);
  const cached = JSON.parse(fs.readFileSync(path.join(s.dataDir, THREAD_FILE), 'utf8'));
  assert.equal(cached.uA.messages.length, 4, 'the local cache holds the thread too');
  const t = await s.thread();
  assert.equal(t.body.available, true);
  assert.equal(t.body.messages.length, 4);
  await s.close();
});

test('tenancy: a stored thread with another user’s userId is treated as missing and never saved over', async () => {
  const foreign = { userId: 'uB', messages: [{ id: 'x1', role: 'user', text: 'B private question', at: new Date(START).toISOString() }], notes: 'B private notes' };
  const s = await serve({ seed: { [threadDocName('uA')]: foreign } });
  const t = await quiet(() => s.thread());
  assert.equal(t.status, 200);
  assert.deepEqual(t.body.messages, []);
  assert.equal(t.body.notes, '');
  assert.equal((await quiet(() => s.ask('Mine?'))).status, 200);
  assert.equal((await quiet(() => s.notes('Mine too.'))).status, 200);
  assert.equal((await quiet(() => s.clear())).status, 200);
  assert.equal(s.calls.put.filter((p) => p.name === threadDocName('uA')).length, 0, 'never saved over');
  assert.deepEqual(s.store.get(threadDocName('uA')), foreign);
  const prompt = s.calls.brain[0].opts.system;
  assert.ok(!prompt.includes('B private'), 'the foreign thread never reaches the model');

  assert.notEqual(threadDocName('uA'), threadDocName('uB'));
  assert.equal(threadDocName('uA'), 'assistant.u.uA');
  assert.notEqual(threadDocName('a/b'), threadDocName('a/c'));
  assert.match(threadDocName('a/b'), /^assistant\.u\.[0-9a-f]{24}$/);
  await s.close();

  // User B's thread is B's own document, and A's questions never land in it.
  const two = await serve();
  await two.ask('A asks.');
  await two.ask('B asks.', 'B');
  assert.deepEqual(two.store.get(threadDocName('uA')).messages.map((m) => m.text).filter((x) => x.endsWith('asks.')), ['A asks.']);
  assert.deepEqual(two.store.get(threadDocName('uB')).messages.map((m) => m.text).filter((x) => x.endsWith('asks.')), ['B asks.']);
  await two.close();
});

test('THREAD_KEEP keeps the newest messages', async () => {
  const seeded = [];
  for (let i = 0; i < 20; i++) seeded.push(userMsg(i), botMsg(i));
  assert.equal(seeded.length, LIMITS.THREAD_KEEP);
  const s = await serve({ seed: { [threadDocName('uA')]: { userId: 'uA', messages: seeded, notes: '' } } });
  await s.ask('Newest question?');
  const kept = s.store.get(threadDocName('uA')).messages;
  assert.equal(kept.length, LIMITS.THREAD_KEEP);
  assert.equal(kept[0].id, 'seed-u1', 'the two oldest are gone');
  assert.equal(kept.at(-2).text, 'Newest question?');
  // Only the newest HISTORY_TURNS reach the model.
  const system = s.calls.brain[0].opts.system;
  assert.ok(system.includes('Seeded answer 19') && system.includes('Seeded 16:'));
  assert.ok(!system.includes('Seeded answer 15'));
  await s.close();
});

test('notes: saved, the profile posted once for an unchanged sha, the daily cap held, a refusal reported with the hub’s reason', async () => {
  const s = await serve();
  let r = await s.notes('We teach wheel throwing.');
  assert.equal(r.status, 200);
  assert.equal(r.body.notes, 'We teach wheel throwing.');
  assert.equal(r.body.profileOnHub.durable, true);
  assert.match(r.body.profileOnHub.sha, /^[0-9a-f]{64}$/);
  assert.equal(s.calls.profile.length, 1);
  const sent = s.calls.profile[0];
  assert.equal(sent.path, PROFILE_PATH);
  assert.equal(sent.body.appId, 'jourvance');
  assert.equal(sent.body.accountId, 'uA');
  assert.ok(sent.body.content.includes('We teach wheel throwing.') && sent.body.content.includes('Business: Rosa Ceramics'));
  assert.ok(!sent.body.content.includes('shpat_ROUTE_SECRET'));
  assert.equal(s.store.get(threadDocName('uA')).notes, 'We teach wheel throwing.');

  r = await s.notes('We teach wheel throwing.');
  assert.equal(r.body.profileOnHub.durable, true);
  assert.equal(s.calls.profile.length, 1, 'an unchanged profile is not sent again');
  assert.equal((await s.thread()).body.notes, 'We teach wheel throwing.');

  for (let i = 2; i <= LIMITS.PROFILE_SYNC_PER_DAY; i++) assert.equal((await s.notes(`Version ${i}.`)).body.profileOnHub.durable, true);
  assert.equal(s.calls.profile.length, LIMITS.PROFILE_SYNC_PER_DAY);
  r = await s.notes('One too many today.');
  assert.equal(r.status, 200);
  assert.equal(r.body.notes, 'One too many today.', 'the notes are still saved');
  assert.equal(r.body.profileOnHub.durable, false);
  assert.equal(r.body.profileOnHub.reason, "The assistant's memory takes 10 updates a day.");
  assert.equal(s.calls.profile.length, LIMITS.PROFILE_SYNC_PER_DAY);
  s.clock.t += 86400000;
  assert.equal((await s.notes('A new day.')).body.profileOnHub.durable, true);
  assert.equal(s.calls.profile.length, LIMITS.PROFILE_SYNC_PER_DAY + 1);
  assert.equal((await s.notes('x'.repeat(LIMITS.NOTES_MAX + 1))).status, 400);
  await s.close();

  const refused = 'Data flow "brainIngest" is disabled for this app in the Connectors panel.';
  const r2 = await serve({ profilePost: { error: refused, status: 403 } });
  r = await r2.notes('We teach wheel throwing.');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.profileOnHub.durable, r.body.profileOnHub.reason], [false, 'The AI service did not take the update.'], 'the hub\u2019s own sentence goes to the log, not the answer');
  assert.equal(r2.store.get(threadDocName('uA')).notes, 'We teach wheel throwing.');
  assert.equal((await r2.thread()).body.profileOnHub.durable, false);
  await r2.close();
});

test('feedback: Helpful shares only the question, cut to guide words, once, with the app as the account; Not helpful never calls', async () => {
  const s = await serve({ brain: { success: true, text: 'Zebrafish Glaze got 7 leads at kilnhaus.myshopify.com. Open Attribution.' } });
  const asked = await s.ask('How do I publish my funnel to a custom domain, Kilnhaus? "Email rosa.delgado@gmail.com" about the 120 visits');
  const id = asked.body.answer.id;
  let r = await s.feedback(id, 'up');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, shared: true });
  assert.equal(s.calls.learn.length, 1);
  const learned = s.calls.learn[0];
  assert.deepEqual(Object.keys(learned).sort(), ['accountId', 'kind', 'niche', 'prompt', 'rating']);
  assert.equal(learned.accountId, 'jourvance');
  assert.equal(learned.kind, 'assistant-question');
  assert.equal(learned.rating, 5);
  assert.equal(learned.niche, 'general', 'the niche is never free text');
  assert.ok(learned.prompt.startsWith('how do i publish my funnel to a custom domain, [word]?'), learned.prompt);
  for (const leak of ['kilnhaus', 'rosa', 'delgado', 'gmail', 'zebrafish', 'glaze', 'attribution', 'leads', '120', '"', 'q:', 'a:']) {
    assert.ok(!learned.prompt.toLowerCase().includes(leak), `${leak} leaked: ${learned.prompt}`);
  }
  assert.doesNotMatch(learned.prompt, /\d/);
  assert.ok(learned.prompt.length <= 200);
  const stored = () => s.store.get(threadDocName('uA')).messages.find((m) => m.id === id);
  assert.equal(stored().shared, true);
  assert.equal(stored().rating, 'up');

  r = await s.feedback(id, 'up');
  assert.deepEqual(r.body, { success: true, shared: true });
  assert.equal(s.calls.learn.length, 1, 'a second Helpful on the same answer is not sent again');

  const other = (await s.ask('How do I publish a funnel page?')).body.answer.id;
  r = await s.feedback(other, 'down');
  assert.deepEqual(r.body, { success: true, shared: false });
  assert.equal(s.calls.learn.length, 1, 'Not helpful writes nothing to the hub');
  assert.equal(s.store.get(threadDocName('uA')).messages.find((m) => m.id === other).rating, 'down');

  assert.equal((await s.feedback('m_nope', 'up')).status, 404);
  assert.equal((await s.feedback(asked.body.answer.id.replace(/./, 'z'), 'up')).status, 404);
  const userTurnId = s.store.get(threadDocName('uA')).messages[0].id;
  assert.equal((await s.feedback(userTurnId, 'up')).status, 404, 'only an answer can be rated');
  assert.equal((await s.feedback(id, 'sideways')).status, 400);
  await s.close();
});

test('feedback: a question of unknown words is refused before the hub, and an empty allowlist shares nothing', async () => {
  const s = await serve();
  const id = (await s.ask('Clayworks Okafor Patel?')).body.answer.id;
  const r = await s.feedback(id, 'up');
  assert.equal(r.body.shared, false);
  assert.equal(r.body.reason, 'The question is mostly about your own business.');
  assert.equal(s.calls.learn.length, 0);
  assert.deepEqual(s.store.get(threadDocName('uA')).feedbackDays, {}, 'a refusal before the hub is not an attempt');
  await s.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-noguide-'));
  dirs.push(dir);
  const none = await serve({ guidePath: path.join(dir, 'missing.md') });
  const id2 = (await none.ask('How do I publish a funnel page?')).body.answer.id;
  const out = await none.feedback(id2, 'up');
  assert.equal(out.body.shared, false);
  assert.equal(out.body.reason, 'The Jourvance guide is not on this server.');
  assert.equal(none.calls.learn.length, 0);
  await none.close();
});

test('feedback: FEEDBACK_PER_DAY counts attempts, a failed send is not stamped and may be retried, and a hub refusal answers its sentence', async () => {
  const seeded = [];
  for (let i = 0; i < LIMITS.FEEDBACK_PER_DAY + 1; i++) seeded.push(userMsg(i), botMsg(i));
  const s = await serve({ seed: { [threadDocName('uA')]: { userId: 'uA', messages: seeded.slice(-LIMITS.THREAD_KEEP), notes: '' } } });
  const answers = s.store.get(threadDocName('uA')).messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  assert.equal(answers.length, LIMITS.FEEDBACK_PER_DAY);
  for (const id of answers) assert.equal((await s.feedback(id, 'up')).body.shared, true);
  assert.equal(s.calls.learn.length, LIMITS.FEEDBACK_PER_DAY);
  const extra = (await s.ask('How do I publish a funnel page today?')).body.answer.id;
  const r = await s.feedback(extra, 'up');
  assert.equal(r.body.shared, false);
  assert.match(r.body.reason, /20 answers today/);
  assert.equal(s.calls.learn.length, LIMITS.FEEDBACK_PER_DAY, 'over the cap nothing is sent');
  s.clock.t += 86400000;
  assert.equal((await s.feedback(extra, 'up')).body.shared, true, 'a capped answer can be shared the next day');
  await s.close();

  // A send that fails leaves the answer unstamped, so a later Helpful tries again; every try counts.
  let ok = false;
  const refused = 'Data flow "brainIngest" is disabled for this app in the Connectors panel.';
  const f = await serve({ learn: () => (ok ? { success: true, ingested: true } : { error: refused, status: 403 }) });
  const fid = (await f.ask('How do I publish a funnel page?')).body.answer.id;
  assert.deepEqual((await f.feedback(fid, 'up')).body, { success: true, shared: false, reason: 'The AI service did not take the answer.' });
  const after1 = f.store.get(threadDocName('uA')).messages.find((m) => m.id === fid);
  assert.equal(Object.hasOwn(after1, 'shared'), false, 'a failed send stamps nothing');
  assert.equal(after1.rating, 'up');
  ok = true;
  assert.deepEqual((await f.feedback(fid, 'up')).body, { success: true, shared: true });
  assert.equal(f.calls.learn.length, 2, 'the retry reached the hub');
  assert.equal((await f.feedback(fid, 'up')).body.shared, true);
  assert.equal(f.calls.learn.length, 2, 'and once shared it is never sent again');
  assert.equal(Object.values(f.store.get(threadDocName('uA')).feedbackDays)[0], 2, 'both attempts were counted');
  await f.close();

  const g = await serve({ learn: { error: refused, status: 403 } });
  const gid = (await g.ask('How do I publish a funnel page?')).body.answer.id;
  for (let i = 0; i < LIMITS.FEEDBACK_PER_DAY; i++) assert.equal((await g.feedback(gid, 'up')).body.shared, false);
  assert.equal(g.calls.learn.length, LIMITS.FEEDBACK_PER_DAY);
  const capped = await g.feedback(gid, 'up');
  assert.match(capped.body.reason, /20 answers today/);
  assert.equal(g.calls.learn.length, LIMITS.FEEDBACK_PER_DAY, 'failed attempts count toward the cap');
  await g.close();
});

test('durable only when the hub says so: a put must answer a revision, a profile post success true', async () => {
  // Put answers without a revision.
  for (const answer of [{}, true, null, 'ok', { name: 'x' }]) {
    const store = new Map();
    const hub = {
      brain: { chat: async () => ({ success: true, text: 'Answer.' }) },
      api: { post: async () => ({ success: true }) },
      store: { docs: { get: async () => ({ error: 'No such document.', status: 404 }), put: async (name, doc) => { store.set(name, doc); return answer; } } }
    };
    const s = await serve({ hub });
    const r = await s.notes('We teach pottery.');
    assert.equal(r.body.saved.durable, false, JSON.stringify(answer));
    assert.equal(r.body.saved.reason, 'The AI service did not confirm the save.');
    const d = await s.clear();
    assert.equal(d.body.durable, false);
    await s.close();
  }
  // Profile answers without success: true.
  for (const answer of [{}, true, null, 'ok', { success: 'yes' }, { ingested: true }]) {
    const s = await serve({ profilePost: answer });
    const r = await s.notes('We teach pottery.');
    assert.equal(r.body.profileOnHub.durable, false, JSON.stringify(answer));
    assert.equal(s.calls.profile.length, 1);
    await s.close();
  }
  const good = await serve();
  const r = await good.notes('We teach pottery.');
  assert.equal(r.body.saved.durable, true);
  assert.equal(r.body.profileOnHub.durable, true);
  await good.close();
});

test('the per-user lock is released in a finally: a writer that throws never holds the next one', async () => {
  const locks = threadLocks();
  const order = [];
  const first = locks.run('uA', async () => { order.push('first'); throw new Error('boom'); });
  const second = locks.run('uA', async () => { order.push('second'); return 2; });
  await assert.rejects(first, /boom/);
  const settled = await Promise.race([second, new Promise((r) => setTimeout(() => r('held'), 500))]);
  assert.equal(settled, 2, 'the second writer ran after the first threw');
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(locks.held(), 0, 'nothing is left holding the user');
  // Writers for one user run one at a time; another user is never held behind them.
  let release;
  const slow = locks.run('uA', () => new Promise((r) => { release = r; }));
  const other = await Promise.race([locks.run('uB', async () => 'b'), new Promise((r) => setTimeout(() => r('held'), 500))]);
  assert.equal(other, 'b');
  release('a');
  assert.equal(await slow, 'a');
});

test('every hub call is bounded: one that never settles is a failed call, and the user\u2019s lock is released', async () => {
  assert.equal(await bounded(Promise.resolve(7), 50, 'x'), 7);
  await assert.rejects(bounded(NEVER(), 20, 'The app store'), (err) => err.timedOut === true && /The app store did not answer within 0\.02 seconds\./.test(err.message));

  // The chat never answers: 502 retryable, quickly, and nothing stored.
  let s = await serve({ timeouts: SHORT, brain: NEVER });
  let t0 = Date.now();
  let r = await quiet(() => s.ask('How do I publish?'));
  assert.equal(r.status, 502);
  assert.equal(r.body.retryable, true);
  assert.ok(Date.now() - t0 < 2000, 'answered within the bound, not after the hub gave up');
  assert.equal(s.calls.put.length, 0);
  await s.close();

  // A put that never settles: the ask still answers, and the same user's next write is not held.
  const hung = {
    brain: { chat: async () => ({ success: true, text: 'Answer.' }), learn: NEVER },
    api: { post: NEVER },
    store: { docs: { get: async () => ({ error: 'No such document.', status: 404 }), put: NEVER } }
  };
  s = await serve({ timeouts: SHORT, hub: hung });
  r = await quiet(() => s.ask('How do I publish a funnel page?'));
  assert.equal(r.status, 200);
  t0 = Date.now();
  const n = await quiet(() => s.notes('We teach pottery.'));
  assert.equal(n.status, 200, 'the lock was released after the hung put');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(n.body.saved.durable, false);
  assert.equal(n.body.saved.reason, 'The AI service did not answer in time.');
  assert.equal(n.body.profileOnHub.durable, false, 'a profile post that never settles is not durable');
  assert.equal(n.body.profileOnHub.reason, 'The AI service did not answer in time.');
  const fb = await quiet(() => s.feedback(r.body.answer.id, 'up'));
  assert.equal(fb.status, 200);
  assert.equal(fb.body.shared, false);
  assert.equal(fb.body.reason, 'The AI service did not answer in time.');
  assert.equal((await quiet(() => s.clear())).status, 200, 'and the lock is free again after every write');
  await s.close();

  // A read that never settles falls back to this server's copy; a list that never settles is unavailable.
  s = await serve({ timeouts: SHORT, docsGet: NEVER, workspaces: NEVER, journeys: NEVER });
  r = await quiet(() => s.ask('How do I publish?'));
  assert.equal(r.status, 200);
  const facts = JSON.parse(s.calls.brain[0].opts.system.match(/^FACTS \(data\): (.*)$/m)[1]);
  assert.equal(facts.business, null);
  assert.ok(facts.unavailable.includes('business') && facts.unavailable.includes('journeys'));
  assert.equal(s.calls.put.length, 0, 'no put after a read that never answered');
  assert.equal((await quiet(() => s.thread())).body.messages.length, 2, 'this server\u2019s copy answers');
  await s.close();
});

test('an incomplete workspace list is never a business: no placeholder, no profile post (real listWorkspacesDetailed)', async () => {
  const wsFile = new URL('./workspaces.json', import.meta.url);
  const before = fs.existsSync(wsFile) ? fs.readFileSync(wsFile) : null;
  assert.ok(!Object.keys(auth.workspaceCache).some((k) => k.startsWith('uA:')), 'precondition: no cached workspace for uA');
  const failing = { store: { docs: { list: async () => ({ error: 'HTTP 503', status: 503 }) } } };
  try {
    auth.setAuthWorkspaceContext({ hub: failing, hubReady: true });
    assert.deepEqual(await auth.listWorkspacesDetailed('uA'), { workspaces: [], complete: false, reason: 'HTTP 503' });
    assert.deepEqual(await auth.listWorkspaces('uA'), [], 'the plain list carries the same answer');
    assert.ok(!Object.keys(auth.workspaceCache).some((k) => k.startsWith('uA:')), 'no default workspace was made');

    const s = await serve({ extraDeps: { listWorkspacesDetailed: auth.listWorkspacesDetailed } });
    const n = await quiet(() => s.notes('We teach pottery.'));
    assert.equal(n.status, 200);
    assert.deepEqual([n.body.profileOnHub.durable, n.body.profileOnHub.reason], [false, 'The workspace list could not be read in full.']);
    assert.equal(s.calls.profile.length, 0, 'nothing was posted over the real profile');
    await quiet(() => s.ask('What is my business called?'));
    const system = s.calls.brain[0].opts.system;
    assert.ok(!/Main E-Commerce Workspace|Main Workspace/.test(system), 'no placeholder name anywhere in the system text');
    const facts = JSON.parse(system.match(/^FACTS \(data\): (.*)$/m)[1]);
    assert.equal(facts.business, null);
    assert.ok(facts.unavailable.includes('business'));
    await s.close();

    // A batch read that fails is incomplete too.
    auth.setAuthWorkspaceContext({ hub: { store: { docs: { list: async () => ({ documents: [{ name: 'workspace.uA.abc' }] }), batchGet: async () => ({ error: 'HTTP 500', status: 500 }) } } }, hubReady: true });
    const partial = await auth.listWorkspacesDetailed('uA');
    assert.deepEqual([partial.complete, partial.workspaces], [false, []]);
    assert.ok(!Object.keys(auth.workspaceCache).some((k) => k.startsWith('uA:')));

    // The positive control: a full read is complete and is the real workspace.
    auth.setAuthWorkspaceContext({ hub: { store: { docs: { list: async () => ({ documents: [{ name: 'workspace.uA.abc' }] }), batchGet: async () => ({ documents: [{ name: 'workspace.uA.abc', found: true, document: { id: 'w1', userId: 'uA', name: 'Real Studio' } }] }) } } }, hubReady: true });
    const full = await auth.listWorkspacesDetailed('uA');
    assert.equal(full.complete, true);
    assert.deepEqual(full.workspaces.map((w) => w.name), ['Real Studio']);
  } finally {
    auth.setAuthWorkspaceContext({ hub: null, hubReady: false });
    const after = fs.existsSync(wsFile) ? fs.readFileSync(wsFile) : null;
    if (before !== null && (after === null || !after.equals(before))) fs.writeFileSync(wsFile, before);
    assert.ok(before === null ? after === null : after.equals(before), 'the working tree\u2019s workspaces.json was not changed');
  }
});

test('the local cache keeps at most THREAD_CACHE_USERS users, dropping the oldest', async () => {
  const seed = {};
  for (let i = 0; i < THREAD_CACHE_USERS; i++) {
    seed[`old${i}`] = { userId: `old${i}`, messages: [], notes: '', updatedAt: new Date(START - (THREAD_CACHE_USERS - i) * 60000).toISOString() };
  }
  const s = await serve({ cacheSeed: seed });
  await s.ask('How do I publish?');
  const cached = JSON.parse(fs.readFileSync(path.join(s.dataDir, THREAD_FILE), 'utf8'));
  assert.equal(Object.keys(cached).length, THREAD_CACHE_USERS);
  assert.ok(cached.uA, 'the newest user is kept');
  assert.equal(cached.old0, undefined, 'the oldest user is dropped');
  assert.ok(cached.old1 && cached[`old${THREAD_CACHE_USERS - 1}`]);
  await s.close();
});

test('GET thread when the hub is off, and DELETE clears the conversation but keeps the notes', async () => {
  const off = await serve({ hubReady: false });
  const t = await off.thread();
  assert.equal(t.status, 200);
  assert.deepEqual([t.body.success, t.body.available, t.body.reason], [true, false, 'ai-unavailable']);
  assert.deepEqual(t.body.messages, []);
  assert.equal(t.body.accountBrain.readable, false);
  const n = await off.notes('Kept locally.');
  assert.equal(n.body.profileOnHub.durable, false);
  assert.equal(n.body.saved.durable, false);
  assert.equal((await off.thread()).body.notes, 'Kept locally.', 'a hub-less server still holds the notes');
  await off.close();

  const s = await serve();
  await s.ask('First?');
  await s.notes('Keep me.');
  assert.equal((await s.thread()).body.messages.length, 2);
  const d = await s.clear();
  assert.equal(d.status, 200);
  assert.equal(d.body.success, true);
  const after = await s.thread();
  assert.deepEqual(after.body.messages, []);
  assert.equal(after.body.notes, 'Keep me.');
  assert.deepEqual(s.store.get(threadDocName('uA')).messages, []);
  await s.close();
});

test('a hub read that fails falls back to this server’s copy and never saves over the stored thread', async () => {
  let failing = false;
  const s = await serve({ docsGet: (name, store) => (failing ? { error: 'HTTP 503', status: 503 } : (store.has(name) ? { name, document: structuredClone(store.get(name)) } : { error: 'No such document.', status: 404 })) });
  await s.ask('Before the outage?');
  const puts = s.calls.put.length;
  failing = true;
  s.clock.t += 60000;
  const t = await quiet(() => s.thread());
  assert.equal(t.body.messages.length, 2, 'the local copy answers');
  assert.equal((await quiet(() => s.ask('During the outage?'))).status, 200);
  assert.equal(s.calls.put.length, puts, 'no put after a failed read');
  failing = false;
  s.clock.t += 60000;
  await s.ask('After it?');
  assert.deepEqual(s.store.get(threadDocName('uA')).messages.filter((m) => m.role === 'user').map((m) => m.text), ['Before the outage?', 'During the outage?', 'After it?']);
  await s.close();
});

// ---- W2.S S2: the screen the user is on ----

const DAY_MS = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 3000, what = 'the condition') {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
const screenQuery = (screen) => `/thread?screen=${encodeURIComponent(JSON.stringify(screen))}`;
const factsIn = (system) => JSON.parse(system.match(/^FACTS \(data\): (.*)$/m)[1]);
const screenIn = (system) => system.match(/^SCREEN \(data\): (.*)$/m)[1];

test('the screen: ask reads it from the body, thread from the query, a journey id is kept only when it is the user’s, and a bad shape is dropped, never a 400', async () => {
  const J2 = { ...JOURNEY, id: 'j2', name: 'Winter Wheel Class', updatedAt: new Date(START - 10 * DAY_MS).toISOString() };
  const B = { ...JOURNEY, id: 'jB', userId: 'uB', name: 'B Private Funnel' };
  const s = await serve({ journeys: (uid) => ({ journeys: uid === 'uA' ? [JOURNEY, J2] : [B], complete: true }) });
  const owned = { view: 'canvas', journeyId: 'j2', journeyName: 'Winter Wheel Class', step: { kind: 'lead-form', name: 'Sign up' } };
  let r = await s.call('POST', '/ask', { message: 'How is this one doing?', screen: owned });
  assert.equal(r.status, 200);
  let system = s.calls.brain.at(-1).opts.system;
  assert.deepEqual(JSON.parse(screenIn(system)), owned);
  let facts = factsIn(system);
  assert.equal(facts.journeys[0].name, 'Winter Wheel Class', 'the journey on screen is first in FACTS');
  assert.equal(facts.last30Days.journeys[0].name, 'Winter Wheel Class', 'and first in last30Days');

  // Another user's journey id, named on the screen, is dropped and changes no order.
  r = await s.call('POST', '/ask', { message: 'And this one?', screen: { view: 'canvas', journeyId: 'jB', journeyName: 'Shown name' } });
  assert.equal(r.status, 200);
  system = s.calls.brain.at(-1).opts.system;
  assert.deepEqual(JSON.parse(screenIn(system)), { view: 'canvas', journeyName: 'Shown name' });
  assert.ok(!system.includes('B Private Funnel'));
  assert.equal(factsIn(system).journeys[0].name, 'Spring Glaze Sale');

  // Every bad shape is dropped silently: the question is answered without a screen.
  for (const bad of [{ view: 'admin' }, 'canvas', '{"view":"canvas"}', [{ view: 'canvas' }], 7, null, { journeyId: 'j2' }]) {
    r = await s.call('POST', '/ask', { message: 'How do I publish?', screen: bad });
    assert.equal(r.status, 200, JSON.stringify(bad));
    assert.equal(screenIn(s.calls.brain.at(-1).opts.system), 'None.', JSON.stringify(bad));
  }
  r = await s.call('POST', '/ask', { message: 'Long?', screen: { view: 'email-studio', journeyName: 'n'.repeat(400), step: { kind: 'k'.repeat(400), name: 'x' } } });
  const long = JSON.parse(screenIn(s.calls.brain.at(-1).opts.system));
  assert.equal(long.journeyName.length, 120);
  assert.equal(long.step.kind.length, 120);

  // GET thread: one JSON value in the query, the same validator.
  let t = await s.call('GET', screenQuery({ view: 'attribution', journeyId: 'j1', journeyName: 'Spring Glaze Sale' }));
  assert.equal(t.status, 200);
  assert.deepEqual(t.body.screen, { view: 'attribution', journeyId: 'j1', journeyName: 'Spring Glaze Sale' });
  t = await s.call('GET', screenQuery({ view: 'canvas', journeyId: 'jB' }));
  assert.deepEqual(t.body.screen, { view: 'canvas' }, 'another user’s journey id is dropped on GET too');
  for (const q of ['/thread?screen=%7Bnot%20json', `/thread?screen=${encodeURIComponent('x'.repeat(3000))}`, screenQuery({ view: 'nope' }), '/thread?screen=a&screen=b', '/thread']) {
    t = await s.call('GET', q);
    assert.equal(t.status, 200, q);
    assert.equal(t.body.screen, null, q);
  }
  // The bracket form a query parser makes is read too.
  t = await s.call('GET', '/thread?screen[view]=email-studio&screen[journeyId]=j1');
  assert.deepEqual(t.body.screen, { view: 'email-studio', journeyId: 'j1' });
  await s.close();
});

// ---- W2.S S3: training off this account's own data ----

const visit = (uid, journeyId, visitorId, extra = {}) => ({ userId: uid, journeyId, type: 'page_view', visitorId, at: new Date(START - 2 * DAY_MS).toISOString(), ...extra });
const A_EVENTS = [
  visit('uA', 'j1', 'v1'), visit('uA', 'j1', 'v2'), visit('uA', 'j1', 'v3'), visit('uA', 'j1', 'v3'),
  { userId: 'uA', journeyId: 'j1', type: 'lead', visitorId: 'v1', email: 'rosa.customer@example.com', name: 'Rosa Customer', at: new Date(START - DAY_MS).toISOString() },
  visit('uB', 'jB', 'b1'), visit('uB', 'jB', 'b2')
];
const B_JOURNEY = { ...JOURNEY, id: 'jB', userId: 'uB', name: 'B Private Funnel' };
const ownJourneys = (uid) => ({ journeys: uid === 'uA' ? [JOURNEY] : uid === 'uB' ? [B_JOURNEY] : [], complete: true });

test('training: after GET thread answers, what-worked.md goes to this user’s own corpus, once a day, and only when it changed', async () => {
  let events = [...A_EVENTS];
  let statsCalls = 0;
  const s = await serve({
    events: () => events,
    journeys: ownJourneys,
    contacts: (uid) => (uid === 'uA' ? [{ email: 'rosa.customer@example.com', name: 'Rosa Customer', phone: '+1 555 0100 222', firstSeenAt: new Date(START - 3 * DAY_MS).toISOString() }] : []),
    emailStats: () => { statsCalls += 1; return { sent: 10, opened: 4, clicked: 2, unsubscribed: null, revenue: null }; },
    pages: { 'spring-glaze-sale': { slug: 'spring-glaze-sale', userId: 'uA', journeyId: 'j1' } }
  });
  const t = await s.thread();
  assert.equal(t.status, 200);
  assert.deepEqual(t.body.trainingOnHub, { durable: false, reason: 'Nothing has been sent yet.' }, 'the answer went before any send');
  await until(() => s.store.get(threadDocName('uA'))?.trainingOnHub?.durable === true, 3000, 'the training record');
  assert.equal(s.calls.replace.length, 1);
  const sent = s.calls.replace[0];
  assert.equal(sent.path, REPLACE_PATH);
  assert.equal(REPLACE_PATH, '/api/brain/studio/replace');
  assert.deepEqual(Object.keys(sent.body).sort(), ['accountId', 'appId', 'content', 'filename']);
  assert.deepEqual([sent.body.appId, sent.body.accountId, sent.body.filename], ['jourvance', 'uA', 'what-worked.md']);
  const md = sent.body.content;
  assert.ok(md.includes('### Spring Glaze Sale'));
  assert.ok(md.includes('Visits: 3 people. Leads: 1 people, a lead rate of 33.3%.'), md);
  assert.ok(md.includes('Sent: 10. Opened: 4, an open rate of 40%.'));
  for (const leak of ['rosa', 'Rosa Customer', '555', 'B Private Funnel', 'uB', 'b1', 'shpat_ROUTE_SECRET', 'kilnhaus']) assert.ok(!md.includes(leak), `${leak} reached the file`);
  const doc = s.store.get(threadDocName('uA'));
  assert.match(doc.trainingSha, /^[0-9a-f]{64}$/);
  assert.deepEqual(doc.trainingDays, { '2026-10-11': 1 });
  assert.deepEqual(doc.trainingOnHub, { durable: true, at: new Date(START).toISOString(), sha: doc.trainingSha });
  assert.deepEqual((await s.thread()).body.trainingOnHub, doc.trainingOnHub, 'GET thread returns the record');

  // The same day: GET thread starts nothing more (only its own thread read).
  const gets = s.calls.get.length;
  await s.thread();
  await sleep(60);
  assert.equal(s.calls.get.length, gets + 1);
  assert.equal(s.calls.replace.length, 1);

  // The next day with the same figures: checked again, and nothing sent (the sha is unchanged).
  s.clock.t += DAY_MS;
  const before = statsCalls;
  await s.thread();
  await until(() => statsCalls > before, 3000, 'the next day’s check');
  await sleep(60);
  assert.equal(s.calls.replace.length, 1, 'an unchanged file is not sent again');

  // A day later a figure moved: sent again, as the same file name.
  s.clock.t += DAY_MS;
  events = [...events, visit('uA', 'j1', 'v4', { at: new Date(s.clock.t - DAY_MS).toISOString() })];
  await s.thread();
  await until(() => s.calls.replace.length === 2, 3000, 'the changed file');
  assert.notEqual(s.calls.replace[1].body.content, md);
  assert.equal(s.calls.replace[1].body.filename, 'what-worked.md');
  await until(() => s.store.get(threadDocName('uA'))?.trainingSha !== doc.trainingSha, 3000, 'the new sha');

  // Another user's GET trains only their own file.
  await s.thread('B');
  await until(() => s.calls.replace.length === 3, 3000, 'B’s file');
  assert.equal(s.calls.replace[2].body.accountId, 'uB');
  assert.ok(s.calls.replace[2].body.content.includes('B Private Funnel'));
  assert.ok(!s.calls.replace[2].body.content.includes('Spring Glaze Sale'));
  assert.ok(s.store.get(threadDocName('uB')).trainingOnHub.durable);
  await s.close();
});

test('training never delays the thread answer and never throws: a send that never settles, and loaders that throw', async () => {
  const rejections = [];
  const onRejection = (err) => rejections.push(err);
  process.on('unhandledRejection', onRejection);
  try {
    const s = await serve({ events: () => A_EVENTS, journeys: ownJourneys, replacePost: NEVER, timeouts: { ...SHORT, profile: 1500 } });
    const t0 = Date.now();
    const t = await s.thread();
    assert.equal(t.status, 200);
    assert.ok(Date.now() - t0 < 1000, `the answer waited ${Date.now() - t0} ms on the send`);
    await until(() => s.calls.replace.length === 1, 3000, 'the send that never settles');
    await quiet(() => until(() => s.store.get(threadDocName('uA'))?.trainingOnHub, 5000, 'the timed out record'));
    assert.deepEqual(s.store.get(threadDocName('uA')).trainingOnHub, { durable: false, at: new Date(START).toISOString(), reason: 'The AI service did not answer in time.' });
    assert.equal(s.store.get(threadDocName('uA')).trainingSha, '', 'a send that did not land records no sha');
    await s.close();

    const broken = await serve({ events: () => { throw new Error('The event log could not be read'); }, journeys: () => { throw new Error('hub down'); } });
    const b = await quiet(() => broken.thread());
    assert.equal(b.status, 200);
    await sleep(80);
    assert.equal(broken.calls.replace.length, 0, 'a partial read sends nothing');
    await broken.close();
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('training: a refused send is recorded and counted for the day, and a partial read is never sent', async () => {
  const refused = 'Data flow "brainIngest" is disabled for this app in the Connectors panel.';
  const s = await serve({ events: () => A_EVENTS, journeys: ownJourneys, replacePost: { error: refused, status: 403 } });
  await s.thread();
  await quiet(() => until(() => s.store.get(threadDocName('uA'))?.trainingOnHub, 3000, 'the refusal record'));
  const doc = s.store.get(threadDocName('uA'));
  assert.deepEqual(doc.trainingOnHub, { durable: false, at: new Date(START).toISOString(), reason: 'The AI service did not take the file.' });
  assert.deepEqual(doc.trainingDays, { '2026-10-11': 1 }, 'the attempt counts');
  assert.equal((await s.thread()).body.trainingOnHub.reason, 'The AI service did not take the file.');
  const again = await s.train({ userIds: ['uA'] });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.users.map((u) => [u.sent, u.reason]), [[false, 'This account was already sent today.']]);
  assert.equal(s.calls.replace.length, 1, 'no second send the same day');
  await s.close();

  const partial = await serve({ events: () => A_EVENTS, journeys: () => ({ journeys: [JOURNEY], complete: false }) });
  const r = await partial.train({ userIds: ['uA'] });
  assert.deepEqual(r.body.users.map((u) => [u.sent, u.reason]), [[false, "Some of this account's data could not be read."]]);
  assert.equal(r.body.counts.skipped, 1);
  assert.equal(partial.calls.replace.length, 0);
  await partial.close();
});

// ---- The operator's training run ----

test('admin/train is the operator’s alone: 404 for a user and for no token, 400 for a bad body', async () => {
  const s = await serve({ events: () => A_EVENTS, journeys: ownJourneys });
  for (const who of ['A', 'B', null]) {
    const r = await s.train({ dryRun: true }, who);
    assert.equal(r.status, 404, String(who));
    assert.equal(r.body.success, false);
  }
  assert.equal(s.calls.get.length + s.calls.replace.length + s.calls.put.length, 0, 'nothing was read or sent');
  for (const bad of [{ limit: 0 }, { limit: 501 }, { limit: 2.5 }, { limit: '10' }, { userIds: 'uA' }, { userIds: [5] }, { userIds: [''] }, { userIds: ['x'.repeat(129)] }]) {
    const r = await s.train(bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.match(r.body.error, /^[A-Z][^.]*\.$/);
  }
  await s.close();

  // A server that mounts no operator guard serves the route to nobody.
  const bare = await serve({ extraDeps: { requireOperator: undefined } });
  assert.equal((await bare.train({ dryRun: true })).status, 404);
  await bare.close();
});

test('admin/train: a dry run sends and writes nothing and names every account by a hash; a run sends; limit and userIds are honoured', async () => {
  const s = await serve({ events: () => [...A_EVENTS, visit('uA', 'j1', 'v9')], journeys: ownJourneys });
  let r = await s.train({ dryRun: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.dryRun, true);
  assert.deepEqual(r.body.counts, { accounts: 2, sent: 0, wouldSend: 2, unchanged: 0, skipped: 0, failed: 0 });
  assert.equal(r.body.users.length, 2);
  for (const u of r.body.users) {
    assert.match(u.uid, /^u_[0-9a-f]{16}$/);
    assert.deepEqual([u.sent, u.reason], [false, 'This was a dry run.']);
  }
  assert.notEqual(r.body.users[0].uid, r.body.users[1].uid);
  const blob = JSON.stringify(r.body);
  for (const raw of ['uA', 'uB', '@', 'rosa', 'Spring Glaze Sale']) assert.ok(!blob.includes(raw), `${raw} in the operator answer`);
  assert.equal(s.calls.replace.length + s.calls.put.length, 0, 'a dry run sends and writes nothing');

  r = await s.train({});
  assert.deepEqual(r.body.counts, { accounts: 2, sent: 2, wouldSend: 0, unchanged: 0, skipped: 0, failed: 0 });
  assert.deepEqual(r.body.users.map((u) => u.sent), [true, true]);
  assert.deepEqual(s.calls.replace.map((c) => c.body.accountId).sort(), ['uA', 'uB']);
  assert.equal(r.body.users[0].uid, (await s.train({ dryRun: true })).body.users[0].uid, 'the hash is stable');

  s.clock.t += DAY_MS;
  r = await s.train({});
  assert.deepEqual(r.body.counts, { accounts: 2, sent: 0, wouldSend: 0, unchanged: 2, skipped: 0, failed: 0 });
  assert.equal(r.body.users[0].reason, 'Nothing changed since the last send.');

  r = await s.train({ limit: 1, dryRun: true });
  assert.equal(r.body.counts.accounts, 1, 'limit caps the run');
  r = await s.train({ userIds: ['uB', 'uB'], dryRun: true });
  assert.equal(r.body.counts.accounts, 1, 'userIds are taken once each');
  await s.close();

  const blind = await serve({ events: () => { throw new Error('The event log could not be read'); } });
  r = await quiet(() => blind.train({}));
  assert.equal(r.status, 503);
  assert.equal(r.body.retryable, true);
  await blind.close();
});

// ---- S3b: the app patterns, operator only ----

function patternAccounts(n) {
  const uids = Array.from({ length: n }, (_, i) => `acct${i}`);
  const events = uids.flatMap((uid, i) => [
    ...Array.from({ length: 30 }, (_, k) => visit(uid, `j-${uid}`, `${uid}-v${k}`)),
    ...Array.from({ length: i + 1 }, (_, k) => ({ userId: uid, journeyId: `j-${uid}`, type: 'lead', visitorId: `${uid}-v${k}`, email: `person${k}@${uid}.example`, at: new Date(START - DAY_MS).toISOString() }))
  ]);
  const journeyOf = (uid) => ({
    id: `j-${uid}`,
    userId: uid,
    name: `Private ${uid} Funnel`,
    goal: 'leads',
    nodes: [{ id: 'a', type: 'ad-source', data: { platform: 'meta' } }, { id: 'b', type: 'landing-page', data: { slug: `slug-${uid}` } }],
    updatedAt: new Date(START - DAY_MS).toISOString()
  });
  return {
    events: () => events,
    journeys: (uid) => ({ journeys: uids.includes(uid) ? [journeyOf(uid)] : [], complete: true }),
    emailStats: () => ({ sent: 100, opened: 30, clicked: 3, unsubscribed: null, revenue: null }),
    pages: Object.fromEntries(uids.map((uid) => [`slug-${uid}`, { slug: `slug-${uid}`, userId: uid, journeyId: `j-${uid}`, domain: `${uid}.example` }]))
  };
}

test('admin/train with patterns: ten accounts make a group, the dry run shows it, the send goes to the app corpus once a month, nine accounts send nothing', async () => {
  const s = await serve(patternAccounts(10));
  let r = await s.train({ dryRun: true, patterns: true });
  assert.equal(r.status, 200);
  const p = r.body.patterns;
  assert.deepEqual([p.sent, p.reason, p.filename, p.groups, p.accounts], [false, 'This was a dry run.', 'jourvance-patterns-2026-10.md', 1, 10]);
  assert.ok(p.content.includes('## Goal leads, Meta\nAccounts: 10 or more.\nMedian lead rate:'), p.content);
  for (const raw of ['acct', 'Private', 'slug-', '.example', 'person']) assert.ok(!JSON.stringify(r.body).includes(raw), `${raw} in the operator answer`);
  assert.equal(s.calls.ingest.length, 0);
  assert.equal(s.store.get(PATTERNS_DOC), undefined, 'a dry run claims no month');

  r = await s.train({ patterns: true });
  assert.equal(r.body.patterns.sent, true);
  assert.equal(s.calls.ingest.length, 1);
  assert.deepEqual(Object.keys(s.calls.ingest[0]).sort(), ['content', 'filename', 'scope']);
  assert.deepEqual([s.calls.ingest[0].scope, s.calls.ingest[0].filename], ['app', 'jourvance-patterns-2026-10.md']);
  assert.ok(!/acct|Private|slug-|\.example|person/.test(s.calls.ingest[0].content));
  assert.equal(s.store.get(PATTERNS_DOC).filename, 'jourvance-patterns-2026-10.md');

  r = await s.train({ patterns: true });
  assert.deepEqual([r.body.patterns.sent, r.body.patterns.reason], [false, "This month's patterns were already sent."]);
  assert.equal(s.calls.ingest.length, 1, 'never stacked twice in a month');
  await s.close();

  const nine = await serve(patternAccounts(9));
  r = await nine.train({ patterns: true });
  assert.deepEqual([r.body.patterns.sent, r.body.patterns.reason, r.body.patterns.groups], [false, 'No group had enough accounts to share.', 0]);
  assert.equal(nine.calls.ingest.length, 0);
  await nine.close();
});

// ---- Adversary round (2026-10-12) ----

test('patterns: the month is claimed before the send, so an overlapping run never sends twice', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await serve({ ...patternAccounts(10), ingest: () => gate });
  const first = s.train({ patterns: true });
  await until(() => s.calls.ingest.length === 1, 3000, 'the first send to start');
  const second = await s.train({ patterns: true });
  assert.equal(second.body.patterns.sent, false);
  assert.ok(["This month's patterns were already sent.", "Another run holds this month's patterns."].includes(second.body.patterns.reason), second.body.patterns.reason);
  release({ success: true, file: { id: 'p1' } });
  assert.equal((await first).body.patterns.sent, true);
  assert.equal(s.calls.ingest.length, 1, 'one file for the month');
  const claim = s.calls.put.find((c) => c.name === PATTERNS_DOC);
  assert.deepEqual([claim.opts.onlyIfNewer, claim.opts.sourceUpdatedAt], [true, '2026-10-01T00:00:00.000Z'], 'claimed with the first instant of the month');
  await s.close();

  // A store answer that is neither a document nor a 404 sends nothing.
  const vague = await serve({ ...patternAccounts(10), docsGet: (name, store) => (name === PATTERNS_DOC ? { success: true } : (store.has(name) ? { name, document: structuredClone(store.get(name)) } : { error: 'No such document.', status: 404 })) });
  let r = await vague.train({ patterns: true });
  assert.deepEqual([r.body.patterns.sent, r.body.patterns.reason], [false, "Whether this month's patterns were sent could not be checked."]);
  assert.equal(vague.calls.ingest.length, 0);
  await vague.close();

  // A claim the store refuses as stale is another run's: nothing is sent.
  const raced = await serve({ ...patternAccounts(10), docsPut: (name, document, opts, store) => {
    if (name === PATTERNS_DOC) return { error: 'The store already holds a copy at least as new as this one, so it was not written.', status: 409, stale: true };
    store.set(name, structuredClone(document));
    return { name, rev: 1 };
  } });
  r = await raced.train({ patterns: true });
  assert.deepEqual([r.body.patterns.sent, r.body.patterns.reason], [false, "Another run holds this month's patterns."]);
  assert.equal(raced.calls.ingest.length, 0);
  await raced.close();
});

test('training: a replace that kept an old copy is not landed and is never recorded as sent', async () => {
  const s = await serve({ events: () => A_EVENTS, journeys: ownJourneys, replacePost: { success: true, undeleted: 1 } });
  await s.thread();
  await quiet(() => until(() => s.store.get(threadDocName('uA'))?.trainingOnHub, 3000, 'the record'));
  const doc = s.store.get(threadDocName('uA'));
  assert.deepEqual(doc.trainingOnHub, { durable: false, at: new Date(START).toISOString(), reason: 'The AI service kept an old copy of the file.' });
  assert.equal(doc.trainingSha, '', 'a stale copy on the hub records no sha, so a later day sends again');
  assert.equal((await s.thread()).body.trainingOnHub.reason, 'The AI service kept an old copy of the file.');
  await s.close();
});

test('training: nothing is sent unless the saved record was read, and the day is claimed by a save that landed', async () => {
  // The thread read fails: no send, and the operator hears why.
  const unread = await serve({ events: () => A_EVENTS, journeys: ownJourneys, docsGet: () => ({ error: 'HTTP 503', status: 503 }) });
  let r = await quiet(() => unread.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users.map((u) => [u.sent, u.reason]), [[false, 'The saved record could not be read.']]);
  // A dry run says so too, rather than promising a send it could not make.
  r = await quiet(() => unread.train({ userIds: ['uA'], dryRun: true }));
  assert.deepEqual(r.body.users.map((u) => [u.sent, u.reason]), [[false, 'The saved record could not be read.']]);
  assert.equal(r.body.counts.wouldSend, 0);
  await quiet(() => unread.thread());
  await sleep(80);
  assert.equal(unread.calls.replace.length, 0, 'neither the run nor GET thread sent');
  await unread.close();

  // The save that claims the day is refused: no send.
  const refused = await serve({ events: () => A_EVENTS, journeys: ownJourneys, docsPut: () => ({}) });
  r = await quiet(() => refused.train({ userIds: ['uA'] }));
  assert.deepEqual(r.body.users.map((u) => [u.sent, u.reason]), [[false, 'The saved record could not be read.']]);
  assert.equal(refused.calls.replace.length, 0);
  await refused.close();
});

test('a loader that never settles is bounded, so a run answers and the account is not held', async () => {
  const s = await serve({ events: () => NEVER(), orders: () => NEVER(), contacts: () => NEVER(), journeys: ownJourneys, timeouts: SHORT });
  const run = () => Promise.race([quiet(() => s.train({ userIds: ['uA'] })), sleep(3000).then(() => 'hung')]);
  const r = await run();
  assert.notEqual(r, 'hung', 'the run answered');
  assert.deepEqual(r.body.users.map((u) => [u.sent, u.reason]), [[false, "Some of this account's data could not be read."]]);
  const again = await run();
  assert.notEqual(again, 'hung');
  assert.notEqual(again.body.users[0].reason, 'A send for this account was already running.', 'the account was let go');
  await s.close();
});

test('every reason the routes answered was one bare cause, and the named ones were all reached', () => {
  // assertBareReasons ran inside every request above; this proves it saw the reasons that matter.
  const seen = new Set(reasonsSeen);
  for (const r of [REASONS.noHub, REASONS.timeout, REASONS.saveUnconfirmed, REASONS.workspacesIncomplete, REASONS.profileCap, REASONS.profileRefused, REASONS.shareCap, REASONS.shareRefused,
    REASONS.trainingRefused, REASONS.trainingSentToday, REASONS.trainingUnchanged, REASONS.dataIncomplete, REASONS.dryRun, REASONS.patternsNone, REASONS.patternsSentThisMonth,
    REASONS.trainingStaleCopy, REASONS.recordUnread, REASONS.patternsClaimed, REASONS.patternsUnchecked]) {
    assert.ok(seen.has(r), `never answered: ${r}`);
  }
  for (const r of Object.values(REASONS)) {
    assert.ok(!r.includes('HUB_API_KEY') && !r.includes('Try '), r);
    assert.match(r, /^[A-Z][^.]*\.$/, r);
  }
});
