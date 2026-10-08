// The saved sections library routes (LANDING_BUILDER_PLAN.md, wave 3), driven over HTTP with the
// store stubbed, in the style of page-builder-publish.test.mjs. What is held here:
// - a merchant sees and deletes only its own entries (another user's id never appears; 404 on delete);
// - the 100 entry cap, the 200 KB entry cap and the name rules are refused with 400;
// - an invalid section is refused with the page model's own paths, and nothing is stored;
// - `durable` is exactly what the store said, with its reason, and the entry is still answered.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  setupBuilderLibraryRoutes, LIBRARY_MAX_ITEMS, LIBRARY_MAX_BYTES
} from './server/routes/builderLibraryRoutes.mjs';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';

function validSection(text = 'Hello') {
  let doc = createEmptyPage();
  const section = createNode('section');
  doc = insertNode(doc, null, 0, section).doc;
  const heading = createNode('widget', 'heading');
  heading.props = { ...heading.props, text };
  doc = insertNode(doc, section.children[0].id, 0, heading).doc;
  return doc.sections[0];
}

async function serve({ durable = true, reason, listComplete = true } = {}) {
  const rows = [];
  const calls = { put: 0, remove: 0 };
  const ctx = {
    requireUser: (req, res, next) => {
      const uid = req.get('x-uid');
      if (!uid) return res.status(401).json({ success: false });
      req.user = { uid };
      next();
    },
    // Deliberately returns every user's rows: the route must still show only the caller's.
    listLibrary: async () => ({ items: rows.map((r) => structuredClone(r)), complete: listComplete }),
    putLibraryItem: async (_uid, item) => { calls.put += 1; rows.push(structuredClone(item)); return durable ? { durable: true } : { durable: false, reason }; },
    removeLibraryItem: async (_uid, id) => {
      calls.remove += 1;
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
      return durable ? { durable: true } : { durable: false, reason };
    }
  };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  setupBuilderLibraryRoutes(app, ctx);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (uid, method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(uid ? { 'x-uid': uid } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { rows, calls, call, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

test('a merchant lists only its own saved sections', async () => {
  const s = await serve();
  try {
    const a = await s.call('alice', 'POST', '/api/builder/library', { name: 'Alice hero', section: validSection('A') });
    const b = await s.call('bob', 'POST', '/api/builder/library', { name: 'Bob hero', section: validSection('B') });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const listA = await s.call('alice', 'GET', '/api/builder/library');
    assert.deepEqual(listA.body.items.map((i) => i.name), ['Alice hero']);
    assert.ok(!JSON.stringify(listA.body).includes(b.body.item.id));
    const listB = await s.call('bob', 'GET', '/api/builder/library');
    assert.deepEqual(listB.body.items.map((i) => i.name), ['Bob hero']);
    assert.equal((await s.call(null, 'GET', '/api/builder/library')).status, 401);
  } finally { await s.close(); }
});

test('deleting another merchant\'s entry is a 404 and removes nothing; deleting your own works', async () => {
  const s = await serve();
  try {
    const a = await s.call('alice', 'POST', '/api/builder/library', { name: 'Mine', section: validSection() });
    const foreign = await s.call('bob', 'DELETE', `/api/builder/library/${a.body.item.id}`);
    assert.equal(foreign.status, 404);
    const missing = await s.call('bob', 'DELETE', '/api/builder/library/sec_nope');
    assert.equal(missing.status, 404);
    assert.deepEqual(foreign.body, missing.body, 'a foreign id and a missing id answer the same');
    assert.equal(s.calls.remove, 0);
    assert.equal(s.rows.length, 1);
    const own = await s.call('alice', 'DELETE', `/api/builder/library/${a.body.item.id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.durable, true);
    assert.equal(s.rows.length, 0);
  } finally { await s.close(); }
});

test('the list is capped at 100 entries and the 101st is refused with 400', async () => {
  const s = await serve();
  try {
    for (let i = 0; i < LIBRARY_MAX_ITEMS; i += 1) {
      s.rows.push({ id: `sec_${i}`, userId: 'alice', name: `n${i}`, section: {}, createdAt: new Date(i).toISOString() });
    }
    s.rows.push({ id: 'sec_bob', userId: 'bob', name: 'bob', section: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    const over = await s.call('alice', 'POST', '/api/builder/library', { name: 'One too many', section: validSection() });
    assert.equal(over.status, 400);
    assert.equal(s.calls.put, 0);
    // Another account's entries do not count against this one.
    const bob = await s.call('bob', 'POST', '/api/builder/library', { name: 'Fine', section: validSection() });
    assert.equal(bob.status, 200);
  } finally { await s.close(); }
});

test('an entry over 200 KB, and a bad name, are refused with 400 and nothing is stored', async () => {
  const s = await serve();
  try {
    const big = validSection();
    const widget = big.children[0].children[0];
    widget.props = { ...widget.props, text: 'x'.repeat(19000) };
    const widgets = [];
    for (let i = 0; i < 12; i += 1) {
      const w = structuredClone(widget);
      w.id = `wbig${i}`;
      widgets.push(w);
    }
    big.children[0].children = widgets;
    assert.ok(Buffer.byteLength(JSON.stringify(big)) > LIBRARY_MAX_BYTES);
    const tooBig = await s.call('alice', 'POST', '/api/builder/library', { name: 'Big', section: big });
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.body.error, /200 KB/);
    assert.equal((await s.call('alice', 'POST', '/api/builder/library', { name: '   ', section: validSection() })).status, 400);
    assert.equal((await s.call('alice', 'POST', '/api/builder/library', { name: 'n'.repeat(81), section: validSection() })).status, 400);
    assert.equal((await s.call('alice', 'POST', '/api/builder/library', { section: validSection() })).status, 400);
    assert.equal(s.calls.put, 0);
  } finally { await s.close(); }
});

test('an invalid section is refused with the model\'s paths and nothing is stored', async () => {
  const s = await serve();
  try {
    const bad = validSection();
    bad.children[0].children[0].props = { ...bad.children[0].children[0].props, text: 12345 };
    const wrong = await s.call('alice', 'POST', '/api/builder/library', { name: 'Bad', section: bad });
    assert.equal(wrong.status, 400);
    assert.ok(Array.isArray(wrong.body.problems) && wrong.body.problems.length > 0);
    assert.match(wrong.body.problems[0].path, /^sections\[0\]/);
    assert.ok(wrong.body.problems[0].message.length > 0);
    for (const section of [null, 'text', [], { type: 'nonsense' }]) {
      const r = await s.call('alice', 'POST', '/api/builder/library', { name: 'Bad', section });
      assert.equal(r.status, 400, JSON.stringify(section));
      assert.ok(r.body.problems.length > 0);
    }
    assert.equal(s.calls.put, 0);
  } finally { await s.close(); }
});

test('durable is what the store said, with its reason, on save and on delete', async () => {
  const local = await serve({ durable: false, reason: 'HUB_API_KEY is not set on this server.' });
  try {
    const saved = await local.call('alice', 'POST', '/api/builder/library', { name: 'Local', section: validSection() });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.durable, false);
    assert.equal(saved.body.reason, 'HUB_API_KEY is not set on this server.');
    assert.ok(saved.body.item.id);
    const gone = await local.call('alice', 'DELETE', `/api/builder/library/${saved.body.item.id}`);
    assert.equal(gone.body.durable, false);
    assert.equal(gone.body.reason, 'HUB_API_KEY is not set on this server.');
  } finally { await local.close(); }
  const hub = await serve({ durable: true });
  try {
    const saved = await hub.call('alice', 'POST', '/api/builder/library', { name: 'Hub', section: validSection() });
    assert.equal(saved.body.durable, true);
    assert.equal('reason' in saved.body, false);
  } finally { await hub.close(); }
});

test('a list the store answered only in part is reported incomplete, and a save or delete on it is a retryable 503', async () => {
  const s = await serve({ listComplete: false });
  try {
    s.rows.push({ id: 'sec_1', userId: 'alice', name: 'x', section: {}, createdAt: '2026-01-01T00:00:00.000Z' });
    const list = await s.call('alice', 'GET', '/api/builder/library');
    assert.equal(list.body.complete, false);
    assert.equal((await s.call('alice', 'POST', '/api/builder/library', { name: 'n', section: validSection() })).status, 503);
    assert.equal((await s.call('alice', 'DELETE', '/api/builder/library/sec_zzz')).status, 503);
    assert.equal(s.calls.put, 0);
  } finally { await s.close(); }
});
