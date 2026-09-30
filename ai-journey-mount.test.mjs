// #25 part C: server.mjs mounts POST /api/ai/journey-plan. server.mjs is never imported (it
// loads .env and a live hub key), so these tests read it as text, then mount the route module on
// a bare Express app with the ctx keys server.mjs names, filled with the REAL requireUser and
// aiBudgetLeft it imports. That pins the one thing the route test cannot: the draft shares the
// signed-in wall and the per-user AI budget of /api/ai/copy, not a stub of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
const MOUNT = 'setupAiJourneyRoutes(app, {';

// The keys of the ctx object literal server.mjs passes, in order.
function mountKeys() {
  const at = source.indexOf(MOUNT);
  assert.ok(at > 0, 'server.mjs mounts the AI journey routes');
  const body = source.slice(at + MOUNT.length, source.indexOf('}', at));
  return body.split(',').map(s => s.trim()).filter(Boolean);
}

test('server.mjs imports the route module and the shared AI budget', () => {
  // assert.ok, not assert.match: a failed match prints the whole 4,000-line source.
  assert.ok(/^import \{ setupAiJourneyRoutes \} from '\.\/server\/routes\/aiJourneyRoutes\.mjs';$/m.test(source), 'imports setupAiJourneyRoutes');
  const authImport = source.slice(source.indexOf('import {\n  setupAuthWorkspaceRoutes'), source.indexOf("} from './server/routes/authWorkspaceRoutes.mjs'"));
  assert.match(authImport, /\n  aiBudgetLeft,\n/, 'aiBudgetLeft comes from authWorkspaceRoutes, the counter /api/ai/copy uses');
  assert.match(authImport, /\n  aiBudgetRetryAfter,\n/, 'and the wait it answers when the hour is spent');
  assert.match(authImport, /\n  requireUser,\n/);
});

test('server.mjs mounts the route once, with the ctx the module reads', () => {
  assert.equal(source.split('setupAiJourneyRoutes(app').length - 1, 1, 'mounted exactly once');
  assert.deepEqual(mountKeys(), ['requireUser', 'hub', 'hubReady', 'aiBudgetLeft', 'aiBudgetRetryAfter']);
  // Nothing else in server.mjs claims the path, so the module's handler is the one that answers.
  assert.ok(!/['"]\/api\/ai\/journey-plan['"]/.test(source), 'no second handler for the path');
});

test('server.mjs mounts it after hub and hubReady exist and after the auth routes', () => {
  const call = source.indexOf(MOUNT);
  // Reading a const before its declaration is a TDZ ReferenceError at boot.
  assert.ok(source.indexOf('const hub = createHubClient(') < call, 'hub is declared first');
  assert.ok(source.indexOf('const hubReady =') < call, 'hubReady is declared first');
  const auth = source.indexOf('setupAuthWorkspaceRoutes(app, {');
  assert.ok(auth > 0 && auth < call, 'the auth routes (/api/ai/copy) are registered first');
  // Directly after that block: no other route is registered in between.
  const between = source.slice(source.indexOf('});', auth) + 3, call);
  assert.doesNotMatch(between, /app\.(get|post|put|delete|use|all)\(|setup[A-Z]\w*Routes\(app/);
  // Before the SPA fallback and the static handler, which sit at the bottom.
  const spa = source.indexOf('app.use(express.static(distPath))');
  assert.ok(spa > call, 'mounted before the frontend fallback');
});

// Mount with the ctx server.mjs passes: the real guard and budget, a stubbed hub.
async function serveLikeServer({ brain }) {
  process.env.AI_COPY_PER_HOUR = '3';
  const auth = await import('./server/routes/authWorkspaceRoutes.mjs');
  const { setupAiJourneyRoutes } = await import('./server/routes/aiJourneyRoutes.mjs');
  const calls = [];
  const hub = { brain: { chat: async (prompt, opts) => { calls.push({ prompt, opts }); return brain; } } };
  const scope = { requireUser: auth.requireUser, hub, hubReady: true, aiBudgetLeft: auth.aiBudgetLeft, aiBudgetRetryAfter: auth.aiBudgetRetryAfter };
  const ctx = Object.fromEntries(mountKeys().map(k => {
    assert.ok(k in scope, `server.mjs passes ${k}`);
    return [k, scope[k]];
  }));
  const app = express();
  app.use(express.json());
  setupAiJourneyRoutes(app, ctx);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/journey-plan`;
  const post = async (token) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ goal: 'leads', offer: 'Free pottery taster class.', platform: 'meta' })
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  return { post, calls, auth, close: () => new Promise(r => server.close(r)) };
}

test('the mounted route answers behind the real sign-in wall and the shared hourly budget', async () => {
  const plan = { name: 'Taster class', strategy: 'Collect sign-ups.' };
  const { post, calls, auth, close } = await serveLikeServer({ brain: { success: true, text: JSON.stringify(plan) } });
  try {
    // Signed out: the real requireUser refuses and nothing reaches the hub.
    const out = await post('');
    assert.equal(out.status, 401);
    assert.equal(calls.length, 0);

    // Signed in (the dev token verifyIdToken accepts outside production).
    assert.notEqual(process.env.NODE_ENV, 'production');
    const ok = await post('dev-test-token');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.plan.name, 'Taster class');
    assert.equal(calls.length, 1);

    // The same counter /api/ai/copy draws on: spend the rest of the hour elsewhere, and the
    // draft is refused without a hub call. The clock is held still, so every slot was spent at
    // one instant and the budget's exact wait is the whole hour.
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = () => frozen;
    let limited;
    try {
      while (auth.aiBudgetLeft('dev-test-user-id')) { /* one slot per call, as /api/ai/copy uses them */ }
      limited = await post('dev-test-token');
    } finally {
      Date.now = realNow;
    }
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    assert.equal(calls.length, 1);
  } finally {
    await close();
  }
});
