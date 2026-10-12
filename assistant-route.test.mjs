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
import { setupAiAssistantRoutes, threadDocName, ACCOUNT_REFUSAL, ACCOUNT_REFUSAL_MS, PROFILE_PATH, THREAD_FILE, THREAD_CACHE_USERS, REASONS, bounded, threadLocks } from './server/routes/aiAssistantRoutes.mjs';
import * as auth from './server/routes/authWorkspaceRoutes.mjs';
import { LIMITS } from './server/assistantContext.mjs';
import { limitMessage } from './server/routes/aiJourneyRoutes.mjs';

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
  hub: hubOverride
} = {}) {
  const clock = { t: START };
  const calls = { brain: [], learn: [], profile: [], get: [], put: [] };
  const store = new Map(Object.entries(seed));
  const answer = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
  const hub = hubOverride !== undefined ? hubOverride : {
    brain: {
      chat: async (prompt, opts) => { calls.brain.push({ prompt, opts }); return answer(brain, prompt, opts, calls); },
      learn: async (body) => { calls.learn.push(body); return answer(learn, body); }
    },
    api: { post: async (p, body) => { calls.profile.push({ path: p, body }); return answer(profilePost, body); } },
    store: {
      docs: {
        get: async (name) => {
          calls.get.push(name);
          if (docsGet) return docsGet(name, store);
          return store.has(name) ? { name, document: structuredClone(store.get(name)) } : { error: 'No such document.', status: 404 };
        },
        put: async (name, document) => { calls.put.push({ name, document: structuredClone(document) }); store.set(name, structuredClone(document)); return { name, rev: calls.put.length }; }
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

test('every reason the routes answered was one bare cause, and the named ones were all reached', () => {
  // assertBareReasons ran inside every request above; this proves it saw the reasons that matter.
  const seen = new Set(reasonsSeen);
  for (const r of [REASONS.noHub, REASONS.timeout, REASONS.saveUnconfirmed, REASONS.workspacesIncomplete, REASONS.profileCap, REASONS.profileRefused, REASONS.shareCap, REASONS.shareRefused]) {
    assert.ok(seen.has(r), `never answered: ${r}`);
  }
  for (const r of Object.values(REASONS)) {
    assert.ok(!r.includes('HUB_API_KEY') && !r.includes('Try '), r);
    assert.match(r, /^[A-Z][^.]*\.$/, r);
  }
});
