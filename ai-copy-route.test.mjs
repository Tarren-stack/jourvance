// /api/ai/copy returned model copy with no em dash strip and no rule in the prompt, while
// /api/ai/journey-plan already had both. The strip is in code at the route boundary (hub rule).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanModelStrings } from './server/routes/aiJourneyRoutes.mjs';

test('the copy route strips the model answer and names the rule in its prompt', () => {
  const src = fs.readFileSync(new URL('./server/routes/authWorkspaceRoutes.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ cleanModelStrings \} from '\.\/aiJourneyRoutes\.mjs'/);
  const route = src.slice(src.indexOf("app.post('/api/ai/copy'"), src.indexOf("source: 'template' });", src.indexOf("app.post('/api/ai/copy'")));
  assert.match(route, /copy\[f\] = cleanModelStrings\(parsed\[f\]\)/);
  assert.match(route, /no em dashes or spaced en dashes/);
  assert.doesNotMatch(route, /copy\[f\] = parsed\[f\]/);
});

test('cleanModelStrings takes the em dash and the spaced en dash out of a string', () => {
  const out = cleanModelStrings('Fast setup — no code – ready today');
  assert.doesNotMatch(out, /—/);
  assert.doesNotMatch(out, /\s–\s/);
  assert.match(out, /Fast setup/);
  assert.match(out, /ready today/);
});

// ---- W2.S S1: the copy route goes through brainChat (server/aiCall.mjs), over HTTP ----

test('POST /api/ai/copy names the user as the account, carries the CONTEXT rule, retries the account refusal once, and keeps its template fallback and labels', async () => {
  const express = (await import('express')).default;
  const auth = await import('./server/routes/authWorkspaceRoutes.mjs');
  const { resetAccountRefusalForTest, ACCOUNT_REFUSAL, CONTEXT_RULE } = await import('./server/aiCall.mjs');
  assert.notEqual(process.env.NODE_ENV, 'production', 'precondition: the dev test token is accepted');
  resetAccountRefusalForTest();
  const calls = [];
  let reply = () => ({ success: true, text: '{"headline":"Clay \u2014 made simple [1]","body":"Start today.","cta":"Book a class"}' });
  const hub = { brain: { chat: async (prompt, opts) => { calls.push({ prompt, opts }); return reply(prompt, opts); } } };
  const app = express();
  app.use(express.json());
  auth.setupAuthWorkspaceRoutes(app, { hub, hubReady: true });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/copy`;
  const post = async () => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev-test-token' }, body: JSON.stringify({ nodeType: 'ad', businessType: 'Pottery studio', offerHeadline: 'Free class' }) });
    return { status: res.status, body: await res.json() };
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    let r = await post();
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'hub-brain');
    assert.equal(r.body.copy.headline, 'Clay, made simple');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.accountId, 'dev-test-user-id');
    assert.equal(calls[0].opts.json, true);
    assert.ok(calls[0].opts.system.includes(CONTEXT_RULE));
    assert.equal(calls[0].opts.system, auth.COPY_SYSTEM);

    // The account refusal: asked once more without the account, and the copy is still the AI's.
    reply = (prompt, opts) => (Object.hasOwn(opts, 'accountId') ? { error: ACCOUNT_REFUSAL, status: 403 } : { success: true, text: '{"headline":"H","body":"B","cta":"C"}' });
    r = await post();
    assert.equal(r.body.source, 'hub-brain');
    assert.equal(calls.length, 3, 'exactly one retry');
    assert.ok(!Object.hasOwn(calls[2].opts, 'accountId'));

    // A refused wallet, a throw and an unreadable answer each fall back to the template, labelled so.
    for (const bad of [() => ({ error: 'Not enough credits.', status: 402 }), () => { throw new Error('down'); }, () => ({ success: true, text: 'not json' })]) {
      reply = bad;
      r = await post();
      assert.equal(r.status, 200);
      assert.equal(r.body.success, true);
      assert.equal(r.body.source, 'template');
      assert.equal(typeof r.body.copy.headline, 'string');
    }
  } finally {
    console.warn = warn;
    resetAccountRefusalForTest();
    auth.setAuthWorkspaceContext({ hub: null, hubReady: false });
    await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  }
});

// ---- Adversary round (2026-10-12): a token whose parts decode to null ----

test('a crafted token whose header and payload decode to null answers 401 on a user route and 404 on the operator route, within 2 seconds', async () => {
  const express = (await import('express')).default;
  const auth = await import('./server/routes/authWorkspaceRoutes.mjs');
  const token = 'bnVsbA.bnVsbA.x';
  assert.equal(Buffer.from('bnVsbA', 'base64').toString('utf8'), 'null', 'precondition: both parts decode to null');
  assert.equal(await auth.verifyIdToken(token), null);
  for (const odd of ['WzFd.WzFd.x', 'MQ.MQ.x', 'InN0ciI.InN0ciI.x']) assert.equal(await auth.verifyIdToken(odd), null, odd);
  const app = express();
  app.use(express.json());
  auth.setupAuthWorkspaceRoutes(app, { hub: null, hubReady: false });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const user = await fetch(`${base}/api/ai/copy`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}', signal: AbortSignal.timeout(2000) });
    assert.equal(user.status, 401);
    const op = await fetch(`${base}/api/admin/journeys`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    assert.equal(op.status, 404);
  } finally {
    auth.setAuthWorkspaceContext({ hub: null, hubReady: false });
    await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  }
});
