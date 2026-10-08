// Wave 3 fix round 1 (LANDING_BUILDER_PLAN.md): the defects a review found in the page history,
// the saved sections library and the AI rewrite, each pinned here by behaviour.
// - a node id that is an Object.prototype key ('__proto__', 'constructor', 'toString') is an
//   ordinary page id: the history routes answer it, and a publish keeps every page's revision;
// - a history read that throws answers 500 instead of leaving the request hanging;
// - a journey id ending in '#builder-revisions' cannot be published over another journey's history;
// - a publish whose history write was not durable says so, in the answer and in publishWarning;
// - a library delete the store refused keeps the entry everywhere and answers 503;
// - the library's invalid-section sentence carries no model paths;
// - a one-sided en dash from the model is cleaned, a digit range keeps its en dash;
// - the rewrite control's "AI is off" sentence is the merchant's, not the hub key's.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { addRevisions, listRevisions, getRevision, revisionsLogId, isRevisionsLogJourneyId } from './server/builderRevisions.mjs';
import { setupBuilderLibraryRoutes, removeLibraryEntry } from './server/routes/builderLibraryRoutes.mjs';
import { cleanModelStrings, REWRITE_OFF } from './server/routes/aiJourneyRoutes.mjs';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';

const { readRewriteAnswer, REWRITE_UNAVAILABLE } = await import('./src/lib/builderRewriteClient.ts');
const { publishWarning } = await import('./src/lib/saveOutcome.ts');

const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

function validDoc(text) {
  let doc = createEmptyPage();
  const section = createNode('section');
  doc = insertNode(doc, null, 0, section).doc;
  const heading = createNode('widget', 'heading');
  heading.props = { ...heading.props, text };
  return insertNode(doc, section.children[0].id, 0, heading).doc;
}

const page = (id, slug) => ({ id, type: 'landing-page', data: { type: 'landing-page', slug, headline: 'Offer', builder: validDoc(slug) } });

async function serve({ journey, logs = {}, loadPublishLog, savePublishLog }) {
  const saved = {};
  const store = { journey };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_u, _id, j) => { store.journey = j; return { durable: true }; },
    loadWorkspace: async (_u, wsId) => ({ id: wsId, shopifyConfig: { storeDomain: 'real-shop.myshopify.com', status: 'connected' } }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: loadPublishLog || (async (u, id) => ({ ok: true, log: logs[`${u}:${id}`] || null })),
    savePublishLog: savePublishLog || (async (u, id, log) => { logs[`${u}:${id}`] = JSON.parse(JSON.stringify(log)); return { durable: true }; }),
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.parse('2026-10-08T10:00:00.000Z')
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path) => {
    const res = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(4000) });
    return { status: res.status, body: await res.json() };
  };
  return { logs, store, call, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

test('a prototype-named node id reads as an ordinary page id in the pure log functions', () => {
  for (const key of PROTO_KEYS) {
    assert.deepEqual(listRevisions(null, key), [], key);
    assert.equal(getRevision(null, key, 1), null, key);
  }
  const log = addRevisions(null, {
    number: 1, publishedAt: 't', userId: 'u1',
    entries: [...PROTO_KEYS, 'page-1'].map(nodeId => ({ nodeId, document: { v: nodeId } }))
  });
  const back = JSON.parse(JSON.stringify(log));
  for (const key of [...PROTO_KEYS, 'page-1']) {
    assert.equal(listRevisions(back, key).length, 1, key);
    assert.deepEqual(getRevision(back, key, 1).document, { v: key });
  }
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
});

test('the history routes answer a prototype-named nodeId, and a throwing read is a 500, never a hang', async () => {
  const s = await serve({ journey: { id: 'j1', nodes: [page('page-1', 'offer')], edges: [] } });
  try {
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    for (const key of PROTO_KEYS) {
      const list = await s.call('GET', `/api/journey/j1/builder-revisions?nodeId=${encodeURIComponent(key)}`);
      assert.equal(list.status, 200, key);
      assert.deepEqual(list.body.revisions, []);
      const one = await s.call('GET', `/api/journey/j1/builder-revisions/1?nodeId=${encodeURIComponent(key)}`);
      assert.equal(one.status, 404, key);
    }
  } finally { await s.close(); }
  const boom = await serve({
    journey: { id: 'j1', nodes: [page('page-1', 'offer')], edges: [] },
    loadPublishLog: async () => ({ ok: true, log: { lastNumber: 1, get pages() { throw new Error('boom'); } } })
  });
  try {
    for (const path of ['/api/journey/j1/builder-revisions?nodeId=page-1', '/api/journey/j1/builder-revisions/1?nodeId=page-1']) {
      const r = await boom.call('GET', path);
      assert.equal(r.status, 500, path);
      assert.equal(r.body.success, false);
      assert.equal(r.body.retryable, true);
    }
  } finally { await boom.close(); }
});

test('a publish with a prototype-named node keeps the revision of every page', async () => {
  const s = await serve({ journey: { id: 'j1', nodes: [page('constructor', 'one'), page('page-1', 'two')], edges: [] } });
  try {
    const p = await s.call('POST', '/api/journey/j1/publish');
    assert.equal(p.status, 200);
    assert.equal('historySaved' in p.body, false);
    for (const nodeId of ['constructor', 'page-1']) {
      const list = await s.call('GET', `/api/journey/j1/builder-revisions?nodeId=${nodeId}`);
      assert.equal(list.body.revisions.length, 1, nodeId);
    }
  } finally { await s.close(); }
});

test('a journey id ending in #builder-revisions is refused before any publish log is touched', async () => {
  assert.equal(isRevisionsLogJourneyId(revisionsLogId('j1')), true);
  assert.equal(isRevisionsLogJourneyId('j1'), false);
  const id = revisionsLogId('j1');
  const s = await serve({ journey: { id, nodes: [page('page-1', 'offer')], edges: [] } });
  try {
    s.logs[`u1:${id}`] = { lastNumber: 1, pages: { 'page-1': [{ rev: 1, nodeId: 'page-1', document: {} }] } };
    const before = JSON.stringify(s.logs);
    for (const [method, path] of [['POST', 'publish'], ['POST', 'unpublish'], ['GET', 'publication']]) {
      const r = await s.call(method, `/api/journey/${encodeURIComponent(id)}/${path}`);
      assert.equal(r.status, 400, path);
      assert.equal(r.body.success, false);
      assert.match(r.body.error, /#builder-revisions/);
    }
    assert.equal(JSON.stringify(s.logs), before, 'the other journey\'s history is untouched');
  } finally { await s.close(); }
});

test('a publish whose history was not saved for good says so, and publishWarning carries it', async () => {
  for (const [label, savePublishLog] of [
    ['kept here only', async (_u, id) => (id.endsWith('#builder-revisions') ? { durable: false, reason: 'store unavailable' } : { durable: true })],
    ['threw', async (_u, id) => { if (id.endsWith('#builder-revisions')) throw new Error('down'); return { durable: true }; }]
  ]) {
    const s = await serve({ journey: { id: 'j1', nodes: [page('page-1', 'offer')], edges: [] }, savePublishLog });
    try {
      const p = await s.call('POST', '/api/journey/j1/publish');
      assert.equal(p.status, 200, label);
      assert.equal(p.body.historySaved, false, label);
      assert.match(p.body.historyNote, /page history/);
      assert.ok(p.body.message.endsWith(p.body.historyNote), label);
      assert.doesNotMatch(p.body.historyNote, /store unavailable|server|\u2014/);
      const warn = publishWarning({ status: 200, body: p.body });
      assert.ok(warn && warn.includes(p.body.historyNote), label);
    } finally { await s.close(); }
  }
});

test('a library delete the store refused keeps the entry in this server\'s copy too', async () => {
  const make = () => ({ u1: [{ id: 'a', userId: 'u1' }, { id: 'b', userId: 'u1' }] });
  let writes = 0;
  const persist = () => { writes += 1; };
  for (const remove of [async () => ({ error: 'store unavailable' }), async () => { throw new Error('down'); }]) {
    const cache = make();
    writes = 0;
    const out = await removeLibraryEntry({ cache, uid: 'u1', id: 'a', persist, hubReady: true, remove, docId: 'builderlib.u1.a' });
    assert.equal(out.ok, false);
    assert.deepEqual(cache.u1.map(i => i.id), ['a', 'b']);
    assert.equal(writes, 0);
  }
  const cache = make();
  let asked = null;
  const ok = await removeLibraryEntry({ cache, uid: 'u1', id: 'a', persist, hubReady: true, remove: async (d) => { asked = d; return {}; }, docId: 'builderlib.u1.a' });
  assert.deepEqual(ok, { ok: true, durable: true });
  assert.equal(asked, 'builderlib.u1.a');
  assert.deepEqual(cache.u1.map(i => i.id), ['b']);
  const local = make();
  const off = await removeLibraryEntry({ cache: local, uid: 'u1', id: 'a', persist, hubReady: false, remove: async () => { throw new Error('never'); }, docId: 'x' });
  assert.equal(off.ok, true);
  assert.equal(off.durable, false);
  assert.deepEqual(local.u1.map(i => i.id), ['b']);
});

async function serveLibrary(removeLibraryItem) {
  const rows = [{ id: 'sec_1', userId: 'u1', name: 'One', section: {}, createdAt: 't' }];
  const app = express();
  app.use(express.json());
  setupBuilderLibraryRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    listLibrary: async () => ({ items: rows.map(r => ({ ...r })), complete: true }),
    putLibraryItem: async () => ({ durable: true }),
    removeLibraryItem
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json(), retryAfter: res.headers.get('retry-after') };
  };
  return { call, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

test('the delete route answers 503 when the store refused, and the save refusal carries no model paths', async () => {
  const s = await serveLibrary(async () => ({ ok: false, durable: false, reason: 'store unavailable' }));
  try {
    const r = await s.call('DELETE', '/api/builder/library/sec_1');
    assert.equal(r.status, 503);
    assert.equal(r.body.success, false);
    assert.equal(r.body.retryable, true);
    assert.equal(r.retryAfter, '30');
    assert.match(r.body.error, /still in your library/);
    const bad = await s.call('POST', '/api/builder/library', { name: 'Bad', section: { type: 'nonsense' } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.problems.length > 0, 'the paths stay in problems');
    assert.doesNotMatch(bad.body.error, /sections\[|First:|section:/);
  } finally { await s.close(); }
});

test('a one-sided or letter-to-letter en dash is cleaned; a digit range keeps its en dash', () => {
  const out = cleanModelStrings('Ready \u2013now, or later\u2013 later\u2014then');
  assert.doesNotMatch(out, /[\u2013\u2014]/);
  assert.equal(out, 'Ready, now, or later, later, then');
  assert.equal(cleanModelStrings('a well\u2013known shop'), 'a well-known shop');
  assert.equal(cleanModelStrings('range 3\u20135 stays'), 'range 3\u20135 stays');
});

test('the rewrite control says AI is off in the merchant\'s words, not the hub key\'s', () => {
  const r = readRewriteAnswer({ status: 503, body: { success: false, error: REWRITE_OFF, reason: 'ai-unavailable', retryable: false } });
  assert.deepEqual(r, { ok: false, message: REWRITE_UNAVAILABLE, retryable: false });
  assert.doesNotMatch(REWRITE_UNAVAILABLE, /hub|key|server|\u2014/i);
  const other = readRewriteAnswer({ status: 400, body: { success: false, error: 'Too long.' } });
  assert.equal(other.message, 'Too long.');
});
