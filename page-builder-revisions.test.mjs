// Builder revisions (LANDING_BUILDER_PLAN.md, wave 3, part E). Drives the real publish route and
// the two read routes over HTTP with storage stubbed, in the style of page-builder-publish.test.mjs.
// What is held here:
// - a publish of a page with a builder document stores it as a revision (time, fingerprint, user);
// - the 21st publish drops the oldest, newest first, 20 kept;
// - another user's journey is a 404, and so is a revision that does not exist;
// - a legacy page (no builder) stores nothing;
// - the listing carries no document bodies, the single read does.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { revisionsLogId } from './server/builderRevisions.mjs';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';

function validDoc(text) {
  let doc = createEmptyPage();
  const section = createNode('section');
  doc = insertNode(doc, null, 0, section).doc;
  const heading = createNode('widget', 'heading');
  heading.props = { ...heading.props, text };
  return insertNode(doc, section.children[0].id, 0, heading).doc;
}

const journeyWith = (data) => ({
  id: 'j1',
  nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Offer', ...data } }],
  edges: []
});

async function serve({ journey, uid = 'u1', logs = {}, failRevisionRead = false }) {
  const saved = {};
  const store = { journey };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: req.headers['x-uid'] || uid }; next(); },
    loadJourney: async (u) => (u === 'u1' ? store.journey : null),
    saveJourney: async (_u, _id, j) => { store.journey = j; return { durable: true }; },
    loadWorkspace: async (_u, wsId) => ({ id: wsId, shopifyConfig: { storeDomain: 'real-shop.myshopify.com', status: 'connected' } }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: async (u, id) => (failRevisionRead && id.endsWith('#builder-revisions')
      ? { ok: false }
      : { ok: true, log: logs[`${u}:${id}`] || null }),
    savePublishLog: async (u, id, log) => { logs[`${u}:${id}`] = structuredClone(log); return { durable: true }; },
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
  return {
    base, store, logs, saved,
    publish: async () => {
      const res = await fetch(`${base}/api/journey/j1/publish`, { method: 'POST' });
      return { status: res.status, body: await res.json() };
    },
    get: async (path, headers = {}) => {
      const res = await fetch(`${base}${path}`, { headers });
      return { status: res.status, body: await res.json() };
    },
    setBuilder: (doc) => { store.journey = journeyWith({ builder: doc }); },
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

const LIST = '/api/journey/j1/builder-revisions?nodeId=page-1';

test('a publish stores the builder document as a revision with time, fingerprint and user', async () => {
  const doc = validDoc('First');
  const s = await serve({ journey: journeyWith({ builder: doc }) });
  try {
    const p = await s.publish();
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const stored = s.logs[`u1:${revisionsLogId('j1')}`];
    assert.ok(stored, 'a revisions log was saved beside the publish log');
    const row = stored.pages['page-1'][0];
    assert.equal(row.rev, p.body.revision.number);
    assert.equal(row.publishedAt, '2026-10-08T10:00:00.000Z');
    assert.equal(row.userId, 'u1');
    assert.equal(row.fingerprint, s.saved.offer.contentFingerprint);
    assert.ok(row.fingerprint, 'precondition: the record has a fingerprint');
    assert.equal(JSON.stringify(row.document), JSON.stringify(doc));

    const one = await s.get(`/api/journey/j1/builder-revisions/${row.rev}?nodeId=page-1`);
    assert.equal(one.status, 200);
    assert.equal(JSON.stringify(one.body.revision.document), JSON.stringify(doc), 'the single read returns the document');
    assert.equal((await s.get(`/api/journey/j1/builder-revisions/999?nodeId=page-1`)).status, 404);
    assert.equal((await s.get(`/api/journey/j1/builder-revisions/abc?nodeId=page-1`)).status, 400);
  } finally { await s.close(); }
});

test('the 21st publish drops the oldest, newest first', async () => {
  const s = await serve({ journey: journeyWith({ builder: validDoc('v1') }) });
  try {
    for (let i = 1; i <= 21; i++) {
      s.setBuilder(validDoc(`v${i}`));
      const p = await s.publish();
      assert.equal(p.status, 200, `publish ${i}: ${JSON.stringify(p.body)}`);
    }
    const list = await s.get(LIST);
    assert.equal(list.status, 200);
    const revs = list.body.revisions.map(r => r.rev);
    assert.equal(revs.length, 20);
    assert.deepEqual(revs, Array.from({ length: 20 }, (_, i) => 21 - i), 'newest first, revision 1 gone');
    assert.equal((await s.get(`/api/journey/j1/builder-revisions/1?nodeId=page-1`)).status, 404);
    const newest = await s.get(`/api/journey/j1/builder-revisions/21?nodeId=page-1`);
    assert.equal(newest.body.revision.document.sections[0].children[0].children[0].props.text, 'v21');
  } finally { await s.close(); }
});

test('another user\'s journey is a 404 on both routes', async () => {
  const s = await serve({ journey: journeyWith({ builder: validDoc('mine') }) });
  try {
    assert.equal((await s.publish()).status, 200);
    const list = await s.get(LIST, { 'x-uid': 'u2' });
    assert.equal(list.status, 404);
    assert.equal(list.body.success, false);
    assert.equal((await s.get(`/api/journey/j1/builder-revisions/1?nodeId=page-1`, { 'x-uid': 'u2' })).status, 404);
    assert.equal((await s.get(LIST)).status, 200, 'positive control: the owner reads it');
    assert.equal((await s.get('/api/journey/j1/builder-revisions')).status, 400, 'nodeId is required');
  } finally { await s.close(); }
});

test('a legacy page stores nothing', async () => {
  const s = await serve({ journey: journeyWith({}) });
  try {
    assert.equal((await s.publish()).status, 200);
    assert.equal(s.logs[`u1:${revisionsLogId('j1')}`], undefined, 'no revisions log was written');
    const list = await s.get(LIST);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.revisions, []);
  } finally { await s.close(); }
});

test('the listing carries no document bodies', async () => {
  const s = await serve({ journey: journeyWith({ builder: validDoc('Secret body text'), builderB: validDoc('B body') }) });
  try {
    assert.equal((await s.publish()).status, 200);
    const list = await s.get(LIST);
    assert.equal(list.body.revisions.length, 1);
    assert.equal(list.body.revisions[0].hasB, true);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes('Secret body text') && !text.includes('B body'));
    for (const r of list.body.revisions) assert.ok(!('document' in r) && !('documentB' in r));
  } finally { await s.close(); }
});

test('a revisions log that cannot be read is never written over and never fails the publish', async () => {
  const s = await serve({ journey: journeyWith({ builder: validDoc('x') }), failRevisionRead: true });
  try {
    const p = await s.publish();
    assert.equal(p.status, 200, 'the pages are live, so the publish still answers success');
    assert.equal(s.logs[`u1:${revisionsLogId('j1')}`], undefined);
    const list = await s.get(LIST);
    assert.equal(list.status, 503);
    assert.equal(list.body.success, false);
  } finally { await s.close(); }
});
