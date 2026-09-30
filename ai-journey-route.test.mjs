// POST /api/ai/journey-plan (#25), driven over HTTP on a bare Express app with the hub stubbed.
// The route never answers with a template plan, reads a hub refusal as 'unavailable', and strips
// citation markers and em dashes. The drift guard pins the server's role list, brief caps and
// skeleton to the client's, since the plain .mjs server cannot import src/.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  setupAiJourneyRoutes,
  readJourneyBrief,
  planRolesFor,
  planSkeleton,
  journeyPlanPrompt,
  journeyPlanSystem,
  extractPlanJson,
  cleanModelStrings,
  hubRefusalKind,
  limitMessage,
  limitWaitSeconds,
  BRIEF_LIMITS as SERVER_LIMITS
} from './server/routes/aiJourneyRoutes.mjs';
import { requiredPlanRoles, readAiPlan, BRIEF_LIMITS as CLIENT_LIMITS } from './src/lib/journeyAi.ts';

const EM = '—';
const EN = '–';

const BRIEF = {
  goal: 'sales',
  offer: 'Pottery kit, $49.',
  audience: 'Beginners',
  businessType: 'Pottery studio',
  platform: 'meta',
  abTest: true,
  upsell: true
};

function filledPlan(brief) {
  const fill = v => {
    if (typeof v === 'string') return 'Words';
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'role' ? x : fill(x)]));
    return v;
  };
  return fill(planSkeleton(brief));
}

async function serve({ hubReady = true, brain, budget = true, hub, retryAfter } = {}) {
  const calls = { brain: [], budget: 0 };
  const app = express();
  app.use(express.json());
  setupAiJourneyRoutes(app, {
    requireUser: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).json({ success: false, error: 'Sign in.' });
      req.user = { uid: 'u1' };
      next();
    },
    hubReady,
    hub: hub !== undefined ? hub : {
      brain: {
        chat: async (prompt, opts) => {
          calls.brain.push({ prompt, opts });
          if (typeof brain === 'function') return brain(prompt, opts);
          return brain;
        }
      }
    },
    aiBudgetLeft: uid => {
      calls.budget += 1;
      assert.equal(uid, 'u1');
      return budget;
    },
    ...(retryAfter !== undefined ? { aiBudgetRetryAfter: retryAfter } : {})
  });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/journey-plan`;
  const post = async (body, { auth = true } = {}) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) },
      body: JSON.stringify(body)
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  const close = () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); });
  open.add(close);
  return { post, calls, close: () => { open.delete(close); return close(); } };
}

// A failed assertion skips a test's own close, and an open server would keep the run alive.
const open = new Set();
after(() => Promise.all([...open].map(close => close())));

const quiet = async fn => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

test('401 without a token, and the brain is never called', async () => {
  const s = await serve({ brain: { success: true, text: '{}' } });
  const r = await s.post(BRIEF, { auth: false });
  assert.equal(r.status, 401);
  assert.equal(s.calls.brain.length, 0);
  assert.equal(s.calls.budget, 0);
  await s.close();
});

test('400 for a bad brief, with no budget used', async () => {
  const s = await serve({ brain: { success: true, text: '{}' } });
  for (const bad of [{ ...BRIEF, goal: 'bookings' }, { ...BRIEF, offer: '   ' }, { ...BRIEF, offer: 'x'.repeat(1001) }, { ...BRIEF, platform: 'myspace' }]) {
    const r = await s.post(bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal(r.body.success, false);
    assert.match(r.body.error, /\.$/);
  }
  assert.equal(s.calls.budget, 0);
  assert.equal(s.calls.brain.length, 0);
  await s.close();
});

test('503 ai-unavailable when the hub is not set up, with no budget used', async () => {
  for (const opts of [{ hubReady: false }, { hub: null }, { hub: { brain: {} } }]) {
    const s = await serve({ ...opts, brain: { success: true, text: '{}' } });
    const r = await s.post(BRIEF);
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'ai-unavailable');
    assert.equal(r.body.retryable, false);
    assert.equal(r.body.success, false);
    assert.equal(s.calls.budget, 0);
    assert.equal(s.calls.brain.length, 0);
    await s.close();
  }
});

// Retry is offered only when it can help (F2): pressing it inside the hour cannot, so the answer
// is not retryable and says when to try again, matching Retry-After.
test('429 with Retry-After when the hourly budget is used up, not retryable, saying when', async () => {
  const s = await serve({ budget: false, brain: { success: true, text: '{}' } });
  const r = await s.post(BRIEF);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '3600');
  assert.equal(r.body.retryable, false);
  assert.equal(r.body.reason, 'hourly-ai-limit');
  assert.equal(r.body.retryAfterSeconds, 3600);
  assert.equal(r.body.error, 'You have reached this hour\u2019s AI limit. Try again in 1 hour.');
  assert.ok(!r.body.error.includes(EM) && !r.body.error.includes(` ${EN} `));
  assert.equal(s.calls.brain.length, 0);
  await s.close();
});

test('429 takes the budget\u2019s own wait when it gives one, and the full hour when it cannot', async () => {
  const cases = [[125, '125', 'Try again in 3 minutes.'], [30, '30', 'Try again in 1 minute.'], [9999, '3600', 'Try again in 1 hour.'], [NaN, '3600', 'Try again in 1 hour.']];
  for (const [said, header, sentence] of cases) {
    const s = await serve({ budget: false, retryAfter: () => said, brain: { success: true, text: '{}' } });
    const r = await s.post(BRIEF);
    assert.equal(r.headers.get('retry-after'), header, String(said));
    assert.equal(r.body.retryAfterSeconds, Number(header));
    assert.ok(r.body.error.endsWith(sentence), r.body.error);
    await s.close();
  }
  assert.equal(limitWaitSeconds(undefined), 3600);
  assert.equal(limitWaitSeconds(-5), 3600);
  assert.equal(limitWaitSeconds(59.2), 60);
  assert.equal(limitMessage(3600), 'You have reached this hour\u2019s AI limit. Try again in 1 hour.');
  assert.equal(limitMessage(61), 'You have reached this hour\u2019s AI limit. Try again in 2 minutes.');
});

// The wait the refusal names must not be early, or the builder's Retry (offered once it passes)
// meets another 429. Driven with the REAL aiBudgetLeft server.mjs mounts, a one-hour sliding
// window, and a faked clock: a guessed 10 minutes was refused at every point up to the hour.
test('with the real hourly budget, the named wait is never early and the draft works once it passes', async () => {
  const auth = await import('./server/routes/authWorkspaceRoutes.mjs');
  const realNow = Date.now;
  const start = Date.UTC(2026, 8, 29, 12, 0, 0);
  let now = start;
  Date.now = () => now;
  const app = express();
  app.use(express.json());
  const brain = { success: true, text: JSON.stringify(filledPlan(BRIEF)) };
  setupAiJourneyRoutes(app, { requireUser: auth.requireUser, hub: { brain: { chat: async () => brain } }, hubReady: true, aiBudgetLeft: auth.aiBudgetLeft });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/journey-plan`;
  const post = async () => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev-test-token' }, body: JSON.stringify(BRIEF) });
    return { status: res.status, wait: Number(res.headers.get('retry-after')) };
  };
  try {
    assert.notEqual(process.env.NODE_ENV, 'production');
    const uid = 'dev-test-user-id';
    // One burst: every call of the hour made at once. The wait is exact, so a moment before it
    // is still refused and the moment it passes a draft works.
    while (auth.aiBudgetLeft(uid)) { /* spend the hour, as /api/ai/copy would */ }
    let limited = await post();
    assert.equal(limited.status, 429);
    let refusedAt = now;
    for (const at of [60_000, 10 * 60_000, 30 * 60_000, limited.wait * 1000 - 1]) {
      now = refusedAt + at;
      assert.equal((await post()).status, 429, `still refused ${at}ms after`);
    }
    now = refusedAt + limited.wait * 1000;
    assert.equal((await post()).status, 200, 'a draft works once the named wait has passed');

    // Spread across the hour: one call, then the rest 50 minutes later. The named wait may be
    // longer than needed, never shorter.
    now += 2 * 3600_000;
    assert.equal(auth.aiBudgetLeft(uid), true);
    now += 50 * 60_000;
    while (auth.aiBudgetLeft(uid)) { /* spend the rest */ }
    limited = await post();
    assert.equal(limited.status, 429);
    refusedAt = now;
    now = refusedAt + limited.wait * 1000;
    assert.equal((await post()).status, 200, 'a spread-out hour is also open once the named wait has passed');
  } finally {
    Date.now = realNow;
    await new Promise(r => server.close(r));
  }
});

test('a hub refusal of the key or the wallet is 503 unavailable, not try again', async () => {
  await quiet(async () => {
    for (const status of [401, 402, 403]) {
      const s = await serve({ brain: { error: 'x', status } });
      const r = await s.post(BRIEF);
      assert.equal(r.status, 503, String(status));
      assert.equal(r.body.reason, 'ai-unavailable');
      assert.equal(r.body.retryable, false);
      assert.ok(!JSON.stringify(r.body).includes('"x"'), 'the hub error stays on the server');
      await s.close();
    }
  });
});

test('502 retryable when the brain fails otherwise or answers something unreadable', async () => {
  await quiet(async () => {
    const answers = [
      { success: false },
      { error: 'x' },
      { error: 'x', status: 500 },
      { success: true, text: 'no json here' },
      { success: true, text: 42 },
      { success: true, text: '[1, 2]' },
      { success: true, text: `{"a":"${'x'.repeat(70000)}"}` },
      () => { throw new Error('boom'); },
      () => Promise.reject(new Error('down'))
    ];
    for (const brain of answers) {
      const s = await serve({ brain });
      const r = await s.post(BRIEF);
      assert.equal(r.status, 502, `${r.status} for ${String(brain).slice(0, 40)}`);
      assert.equal(r.body.success, false);
      assert.equal(r.body.retryable, true);
      assert.equal(r.body.plan, undefined, 'never a template plan');
      await s.close();
    }
  });
});

test('200 with a cleaned plan from a fenced answer, and the call is shaped as the contract says', async () => {
  const plan = filledPlan(BRIEF);
  plan.pages[0].headline = `Clay ${EM} made simple [1]`;
  plan.pages[0].subhead = `Start today ${EN} no mess [2, 3]`;
  plan.emails[0].messages[0].body = 'Hi [First Name], welcome [4].';
  plan.ad.headline = `${EM} Big news`;
  const text = 'Here you go:\n```json\n' + JSON.stringify(plan, null, 2) + '\n```';
  const s = await serve({ brain: { success: true, text } });
  const r = await s.post({ ...BRIEF, offer: `  ${BRIEF.offer}  `, extra: 'ignored' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.source, 'hub-brain');
  const out = JSON.stringify(r.body.plan);
  assert.ok(!out.includes(EM), 'no em dash');
  assert.ok(!out.includes(` ${EN} `), 'no spaced en dash');
  assert.ok(!/\[\d+(?:,\s*\d+)*\]/.test(out), 'no citation marker');
  assert.ok(out.includes('[First Name]'));
  assert.equal(r.body.plan.pages[0].headline, 'Clay, made simple');
  assert.equal(r.body.plan.pages[0].subhead, 'Start today, no mess');
  assert.equal(r.body.plan.ad.headline, 'Big news');
  assert.equal(r.body.plan.emails[0].messages[0].body, 'Hi [First Name], welcome.');
  assert.ok('plan' in readAiPlan(r.body.plan, BRIEF), 'the cleaned plan reads on the client');

  assert.equal(s.calls.brain.length, 1, 'exactly one brain call');
  assert.equal(s.calls.budget, 1);
  const { prompt, opts } = s.calls.brain[0];
  assert.equal(opts.json, true);
  assert.equal(opts.topK, 3);
  assert.ok(prompt.includes(JSON.stringify(BRIEF)), 'the prompt carries the trimmed brief as JSON');
  assert.ok(!prompt.includes('extra'));
  assert.ok(!opts.system.includes(EM));
  assert.ok(opts.system.includes('CONTEXT'));
  for (const role of [...requiredPlanRoles(BRIEF).pages, ...requiredPlanRoles(BRIEF).emails]) assert.ok(opts.system.includes(role), role);
  await s.close();
});

test('the prompt stays under 2,000 characters at every cap, and the system text names the roles', () => {
  for (const goal of ['leads', 'sales']) {
    const brief = readJourneyBrief({
      goal,
      offer: 'x'.repeat(SERVER_LIMITS.offer),
      audience: 'y'.repeat(SERVER_LIMITS.audience),
      businessType: 'z'.repeat(SERVER_LIMITS.businessType),
      platform: 'organic',
      abTest: true,
      upsell: true
    }).brief;
    assert.ok(brief);
    assert.ok(journeyPlanPrompt(brief).length < 2000, String(journeyPlanPrompt(brief).length));
    const system = journeyPlanSystem(brief);
    assert.ok(!system.includes(EM) && !system.includes(` ${EN} `));
    assert.ok(system.includes(JSON.stringify(planSkeleton(brief))));
    for (const role of [...requiredPlanRoles(brief).pages, ...requiredPlanRoles(brief).emails]) assert.ok(system.includes(role), role);
    assert.ok(system.includes(goal === 'leads' ? 'Include "form"' : 'Set "form" to null'));
  }
});

test('readJourneyBrief cleans and defaults the brief', () => {
  assert.deepEqual(readJourneyBrief({ goal: 'leads', offer: ' Class ', upsell: true, abTest: 'yes' }).brief, {
    goal: 'leads', offer: 'Class', audience: '', businessType: '', platform: 'meta', abTest: false, upsell: false
  });
  assert.ok(readJourneyBrief(null).error);
  assert.ok(readJourneyBrief({ goal: 'sales', offer: 'x', audience: 'a'.repeat(301) }).error);
  assert.ok(readJourneyBrief({ goal: 'sales', offer: 'x', businessType: 'b'.repeat(121) }).error);
  assert.equal(readJourneyBrief({ goal: 'sales', offer: 'x'.repeat(1000) }).brief.offer.length, 1000);
});

test('extractPlanJson, cleanModelStrings and hubRefusalKind', () => {
  assert.deepEqual(extractPlanJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractPlanJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractPlanJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractPlanJson('Sure! {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  assert.equal(extractPlanJson('[1,2]'), null);
  assert.equal(extractPlanJson('nothing'), null);
  assert.equal(extractPlanJson(null), null);
  assert.deepEqual(cleanModelStrings({ a: [` x ${EM} y [1]`, 3, null], b: { c: `p ${EN} q [2-4]` }, d: `range 3${EN}5 stays` }), {
    a: ['x, y', 3, null], b: { c: 'p, q' }, d: `range 3${EN}5 stays`
  });
  assert.equal(hubRefusalKind({ status: 401 }), 'unavailable');
  assert.equal(hubRefusalKind({ status: 402 }), 'unavailable');
  assert.equal(hubRefusalKind({ status: 403 }), 'unavailable');
  assert.equal(hubRefusalKind({ status: 500 }), 'failed');
  assert.equal(hubRefusalKind(null), 'failed');
});

// ---- Drift guard ----

test('the server and the client agree on roles, caps and the skeleton for every brief shape', () => {
  assert.deepEqual(SERVER_LIMITS, CLIENT_LIMITS);
  for (const goal of ['leads', 'sales']) {
    for (const abTest of [false, true]) {
      for (const upsell of [false, true]) {
        const { brief } = readJourneyBrief({ goal, offer: 'x', abTest, upsell });
        assert.deepEqual(planRolesFor(brief), requiredPlanRoles(brief), `${goal} ${abTest} ${upsell}`);
        const read = readAiPlan(filledPlan(brief), brief);
        assert.ok('plan' in read, JSON.stringify(read));
      }
    }
  }
});

test('the route file carries no em dash or spaced en dash', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./server/routes/aiJourneyRoutes.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes(EM) && !src.includes(EN));
});
