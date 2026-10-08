// POST /api/ai/builder-rewrite, driven over HTTP on a bare Express app with the hub stubbed.
// No template fallback, the em dash strip, the prompt rule, the caps, the 503 and the budget refusal.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupAiJourneyRoutes } from './server/routes/aiJourneyRoutes.mjs';
import { readRewriteAnswer } from './src/lib/builderRewriteClient.ts';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const open = new Set();
after(() => Promise.all([...open].map((c) => c())));
const quiet = async (fn) => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

async function serve({ hubReady = true, brain, budget = true } = {}) {
  const calls = { brain: [], budget: 0 };
  const app = express();
  app.use(express.json());
  setupAiJourneyRoutes(app, {
    requireUser: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).json({ success: false });
      req.user = { uid: 'u1' };
      next();
    },
    hubReady,
    hub: { brain: { chat: async (prompt, opts) => { calls.brain.push({ prompt, opts }); return typeof brain === 'function' ? brain(prompt, opts) : brain; } } },
    aiBudgetLeft: () => { calls.budget += 1; return budget; }
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/api/ai/builder-rewrite`;
  const post = async (body, auth = true) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer t' } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, headers: res.headers, body: await res.json() };
  };
  const close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  open.add(close);
  return { post, calls, close: async () => { open.delete(close); await close(); } };
}

const say = (obj) => ({ success: true, text: JSON.stringify(obj) });

test('401 without a token, and the brain is never called', async () => {
  const s = await serve({ brain: say({ text: 'x' }) });
  assert.equal((await s.post({ kind: 'heading', text: 'Hi' }, false)).status, 401);
  assert.equal(s.calls.brain.length, 0);
  await s.close();
});

test('400 for a bad kind or no text, with no budget used', async () => {
  const s = await serve({ brain: say({ text: 'x' }) });
  for (const bad of [{ kind: 'image', text: 'a' }, { text: 'a' }, { kind: 'heading' }, { kind: 'heading', text: 5 }, { kind: 'text', text: 'x'.repeat(4001) }]) {
    const r = await s.post(bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.equal(r.body.success, false);
  }
  assert.equal(s.calls.budget, 0);
  assert.equal(s.calls.brain.length, 0);
  await s.close();
});

test('the answer comes back without an em dash or a spaced en dash', async () => {
  const s = await serve({ brain: say({ text: `Fast setup ${EM} no code ${EN} ready today` }) });
  const r = await s.post({ kind: 'text', text: 'Fast setup' });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.source, 'hub-brain');
  assert.ok(!r.body.text.includes(EM));
  assert.ok(!/\s–\s/.test(r.body.text));
  assert.match(r.body.text, /Fast setup/);
  await s.close();
});

test('the prompt carries the dash rule and asks for json, and the brief and text reach the brain as data', async () => {
  const s = await serve({ brain: say({ text: 'Ok' }) });
  await s.post({ kind: 'button', text: 'Click', brief: 'make it warm' });
  const call = s.calls.brain[0];
  assert.equal(call.opts.json, true);
  assert.ok(call.opts.system.includes('Plain sentences, no em dashes or spaced en dashes.'));
  assert.match(call.prompt, /make it warm/);
  assert.match(call.prompt, /Click/);
  await s.close();
});

test('caps: heading 120, button 40, text 2000', async () => {
  for (const [kind, cap] of [['heading', 120], ['button', 40], ['text', 2000]]) {
    const s = await serve({ brain: say({ text: 'a'.repeat(cap + 500) }) });
    const r = await s.post({ kind, text: 'x' });
    assert.equal(r.status, 200, kind);
    assert.equal(r.body.text.length, cap, kind);
    await s.close();
  }
});

test('a list is capped at 20 items of 80, blanks and non strings dropped, each item stripped', async () => {
  const items = [`One ${EM} two`, '', 7, ...Array.from({ length: 30 }, (_, i) => 'b'.repeat(200) + i)];
  const s = await serve({ brain: say({ items }) });
  const r = await s.post({ kind: 'list', text: 'a\nb' });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 20);
  assert.ok(r.body.items.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 80));
  assert.ok(!r.body.items[0].includes(EM));
  assert.equal('text' in r.body, false);
  await s.close();
});

test('503 with the fixed sentence when the hub is not ready, and never a template', async () => {
  const s = await serve({ hubReady: false, brain: say({ text: 'x' }) });
  const r = await s.post({ kind: 'heading', text: 'Hi' });
  assert.equal(r.status, 503);
  assert.equal(r.body.success, false);
  assert.equal(r.body.error, 'AI copy is off until the hub key is set.');
  assert.equal('text' in r.body, false);
  assert.equal(s.calls.brain.length, 0);
  assert.equal(s.calls.budget, 0);
  await s.close();
});

test('a refused hub key is the same 503, an error answer is 502, an unreadable answer is 502', async () => {
  await quiet(async () => {
    const refused = await serve({ brain: { success: false, status: 402 } });
    const r1 = await refused.post({ kind: 'heading', text: 'Hi' });
    assert.equal(r1.status, 503);
    assert.equal(r1.body.error, 'AI copy is off until the hub key is set.');
    await refused.close();
    for (const brain of [{ success: false, status: 500 }, { success: true, text: 'not json' }, say({ text: '' }), say({ items: [] })]) {
      const s = await serve({ brain });
      const r = await s.post({ kind: brain.text && brain.text.includes('items') ? 'list' : 'heading', text: 'Hi' });
      assert.equal(r.status, 502);
      assert.equal(r.body.success, false);
      assert.equal('text' in r.body, false);
      await s.close();
    }
  });
});

test('an exhausted hourly budget is 429 with Retry-After and the brain is not called', async () => {
  const s = await serve({ budget: false, brain: say({ text: 'x' }) });
  const r = await s.post({ kind: 'heading', text: 'Hi' });
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'hourly-ai-limit');
  assert.equal(r.headers.get('retry-after'), '3600');
  assert.equal(s.calls.budget, 1);
  assert.equal(s.calls.brain.length, 0);
  await s.close();
});

test('the client reads an answer into a result and never invents text', () => {
  assert.deepEqual(readRewriteAnswer({ status: 200, body: { success: true, text: 'Hi' } }), { ok: true, text: 'Hi' });
  assert.deepEqual(readRewriteAnswer({ status: 200, body: { success: true, items: ['a', ''] } }), { ok: true, items: ['a'] });
  const off = readRewriteAnswer({ status: 503, body: { success: false, error: 'AI copy is off until the hub key is set.', retryable: false } });
  assert.deepEqual(off, { ok: false, message: 'AI copy is off until the hub key is set.', retryable: false });
  assert.equal(readRewriteAnswer(null).ok, false);
  assert.equal(readRewriteAnswer({ status: 429, body: { success: false, error: 'x' } }).retryable, false);
});
