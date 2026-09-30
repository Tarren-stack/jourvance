import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setPublicContext, savePublicPage, readPublicPage, loadPublicPage, removePublicPage } from './server/routes/publicRoutes.mjs';

// The hub SDK never throws on a refusal: docs.put answers { error, status }. savePublicPage only
// caught throws and never read the answer, so a publish the store refused said "Published 1
// landing page(s) successfully." and the status check said Live, while nothing was stored and the
// next restart on a fresh disk took the page offline. These drive the real savePublicPage (and,
// through it, the real publish route) against a stub with the SDK's answer shapes.

function hubStub(put) {
  const docs = {};
  const hub = {
    store: {
      docs: {
        put: async (name, doc) => {
          const r = await put(name, doc);
          if (!r || !r.error) docs[name] = doc;
          return r;
        },
        get: async (name) => (docs[name] ? { document: docs[name] } : { error: 'No such document.', status: 404 }),
        remove: async (name) => { delete docs[name]; return { deleted: true }; }
      }
    }
  };
  return { hub, docs };
}

function withContext({ hub, hubReady = true, cache = {}, registry = {} }) {
  const persisted = [];
  setPublicContext({
    hub,
    hubReady,
    publicPageCache: cache,
    persistPublicPages() { persisted.push(structuredClone(cache)); },
    reloadDomainRegistry() { return registry; },
    reloadPublicPageCache() { return cache; },
    domainRegistryCache: registry
  });
  return { cache, persisted };
}

const refuse503 = async () => ({ error: 'HTTP 503', status: 503 });
const accept = async (name) => ({ name });
const page = (over = {}) => ({ userId: 'u1', journeyId: 'j1', nodeId: 'lp1', slug: 'my-offer', data: { headline: 'Hello' }, ...over });

test('a stored page answers durable', async () => {
  const { hub, docs } = hubStub(accept);
  const { cache } = withContext({ hub });
  const rec = page();
  assert.deepEqual(await savePublicPage('my-offer', rec), { durable: true });
  assert.equal(docs['pubpage.my-offer'], rec);
  assert.equal(cache['my-offer'], rec);
});

test('a page the hub refuses is reported and undone on this server', async () => {
  const { hub, docs } = hubStub(refuse503);
  const { cache, persisted } = withContext({ hub });
  const result = await savePublicPage('my-offer', page());
  assert.equal(result.durable, false);
  assert.equal(result.written, false);
  assert.equal(result.reason, 'HTTP 503');
  assert.deepEqual(docs, {});
  assert.equal(cache['my-offer'], undefined, 'nothing this server serves that storage does not hold');
  assert.equal('my-offer' in persisted.at(-1), false, 'the undo reaches the local file too');
  assert.deepEqual(await readPublicPage('my-offer'), { ok: true, page: null });
});

test('a throw from the store is a refusal too', async () => {
  const { hub } = hubStub(async () => { throw new Error('socket hang up'); });
  withContext({ hub });
  const result = await savePublicPage('my-offer', page());
  assert.equal(result.durable, false);
  assert.equal(result.written, false);
  assert.equal(result.reason, 'socket hang up');
});

test('a refused republish puts the previous version back', async () => {
  const { hub } = hubStub(refuse503);
  const older = page({ data: { headline: 'Old' } });
  const { cache } = withContext({ hub, cache: { 'my-offer': older } });
  await savePublicPage('my-offer', page({ data: { headline: 'New' } }));
  assert.equal(cache['my-offer'], older);
});

test('a refused domain pointer keeps the stored page and puts back only the pointer', async () => {
  // The pointer's doc name is hashed (it holds dots), so everything but the page doc is refused.
  const { hub, docs } = hubStub(async (name) => (name === 'pubpage.my-offer' ? { name } : { error: 'HTTP 500', status: 500 }));
  const registry = { 'shop.example.com': { verified: true, userId: 'u1' } };
  const { cache, persisted } = withContext({ hub, registry, cache: { 'domain:shop.example.com': 'older-offer' } });
  const rec = page({ customDomain: 'shop.example.com' });
  const result = await savePublicPage('my-offer', rec);
  assert.equal(result.durable, false);
  assert.equal(result.written, true, 'the page itself was stored, so it is not reported as unsaved');
  assert.equal(result.pointerRefused, true);
  assert.equal(result.domain, 'shop.example.com');
  assert.equal(result.reason, 'HTTP 500');
  assert.equal(docs['pubpage.my-offer'], rec, 'the page doc itself landed');
  assert.equal(cache['my-offer'], rec, 'and this server keeps serving it');
  assert.equal(cache['domain:shop.example.com'], 'older-offer');
  assert.equal(persisted.at(-1)['domain:shop.example.com'], 'older-offer', 'the pointer undo reaches the local file');
  assert.equal(persisted.at(-1)['my-offer'].slug, 'my-offer');
});

test('a refused page never sends its domain pointer and puts both back', async () => {
  const names = [];
  const { hub } = hubStub(async (name) => { names.push(name); return { error: 'HTTP 503', status: 503 }; });
  const registry = { 'shop.example.com': { verified: true, userId: 'u1' } };
  const { cache } = withContext({ hub, registry });
  const result = await savePublicPage('my-offer', page({ customDomain: 'shop.example.com' }));
  assert.equal(result.written, false);
  assert.equal(result.pointerRefused, undefined);
  assert.deepEqual(names, ['pubpage.my-offer']);
  assert.equal(cache['my-offer'], undefined);
  assert.equal(cache['domain:shop.example.com'], undefined);
});

test('a counter saved on the cached record itself keeps the record when the hub refuses', async () => {
  const { hub } = hubStub(refuse503);
  const rec = page();
  const { cache } = withContext({ hub, cache: { 'my-offer': rec } });
  rec.data.liveRevenue = 12;
  const result = await savePublicPage('my-offer', rec);
  assert.equal(result.durable, false);
  assert.notEqual(result.written, false);
  assert.equal(cache['my-offer'], rec);
});

test('with no hub the page is kept on this server and says it is not durable', async () => {
  const { cache } = withContext({ hub: null, hubReady: false });
  const rec = page();
  const result = await savePublicPage('my-offer', rec);
  assert.equal(result.durable, false);
  assert.notEqual(result.written, false);
  assert.match(result.reason, /HUB_API_KEY/);
  assert.equal(cache['my-offer'], rec);
});

// The publish route, with the real savePublicPage and readPublicPage behind it.
async function serveRoutes(put, { hubReady = true, registry = {}, domain = '' } = {}) {
  const { hub, docs } = hubStub(put);
  const cache = {};
  withContext({ hub, hubReady, cache, registry });
  const store = {
    journey: {
      id: 'j1',
      nodes: [
        { id: 'lp1', type: 'landing-page', data: { type: 'landing-page', slug: 'my-offer', headline: 'Hello', ...(domain ? { customDomain: domain } : {}) } },
        { id: 'lp2', type: 'landing-page', data: { type: 'landing-page', slug: 'second-offer', headline: 'Two' } }
      ],
      edges: []
    }
  };
  const logs = {};
  const journeySaves = [];
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_u, _id, j) => { journeySaves.push(j); store.journey = j; return { durable: true }; },
    loadWorkspace: async () => null,
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => registry,
    domainRegistryCache: registry,
    savePublicPage, removePublicPage, readPublicPage, loadPublicPage,
    persistPublicPages: () => {},
    publicPageCache: cache,
    loadPublishLog: async (_u, id) => ({ ok: true, log: logs[id] || null }),
    savePublishLog: async (_u, id, log) => { logs[id] = structuredClone(log); return { durable: true }; },
    renderPublicFunnelHtml: () => '<html><body></body></html>',
    renderPublicUpsellHtml: () => '<html><body></body></html>'
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET') => {
    const res = await fetch(base + path, { method });
    return { status: res.status, body: await res.json() };
  };
  return {
    call, docs, cache, logs, journeySaves,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

test('a publish the store refused is a retryable failure, never "Published successfully"', async () => {
  const quiet = console.error;
  console.error = () => {};
  const s = await serveRoutes(refuse503);
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 503);
    assert.equal(pub.body.success, false);
    assert.equal(pub.body.retryable, true);
    assert.equal(pub.body.error, 'Your pages could not be saved to storage, so nothing new went live. Publish again.');
    assert.doesNotMatch(pub.body.error, /HTTP 503/, 'the store text stays in the server log');
    assert.deepEqual(pub.body.nodeIds.sort(), ['lp1', 'lp2']);
    assert.deepEqual(s.docs, {});

    const status = await s.call('/api/journey/j1/publication');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body.steps, {}, 'the status check does not call a page live that storage does not hold');

    assert.equal(s.journeySaves.length, 0, 'the journey keeps its old copy');
    const entry = s.logs.j1.entries.at(-1);
    assert.equal(entry.status, 'started', 'unpublish can still find what this revision planned');
  } finally {
    console.error = quiet;
    await s.close();
  }
});

test('a publish the store half refused names the pages it could not save', async () => {
  const quiet = console.error;
  console.error = () => {};
  const s = await serveRoutes(async (name) => (name === 'pubpage.second-offer' ? { error: 'HTTP 503', status: 503 } : { name }));
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 503);
    assert.equal(pub.body.error, '1 of 2 pages could not be saved to storage, so only part of this publish went live. Publish again.');
    assert.deepEqual(pub.body.nodeIds, ['lp2']);
    const status = await s.call('/api/journey/j1/publication');
    assert.deepEqual(Object.keys(status.body.steps), ['lp1']);
  } finally {
    console.error = quiet;
    await s.close();
  }
});

test('a publish whose pages were stored but whose custom domain was refused says the page is live', async () => {
  const quiet = console.error;
  console.error = () => {};
  const registry = { 'shop.example.com': { verified: true, userId: 'u1' } };
  // Only the pointer doc (a hashed name) is refused; both page docs land.
  const s = await serveRoutes(async (name) => (name.startsWith('pubpage.') && name.endsWith('offer') ? { name } : { error: 'HTTP 429', status: 429 }), { registry, domain: 'shop.example.com' });
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 503);
    assert.equal(pub.body.retryable, true);
    assert.equal(pub.body.partial, true);
    assert.equal(pub.body.error, 'Your page is live at /p/my-offer, but the custom domain shop.example.com could not be saved to storage. Publish again.');
    assert.doesNotMatch(pub.body.error, /pages? could not be saved|nothing new went live/, 'the stored pages are not reported as unsaved');
    assert.deepEqual(pub.body.nodeIds, ['lp1']);
    assert.deepEqual(Object.keys(s.docs).sort(), ['pubpage.my-offer', 'pubpage.second-offer']);
    assert.equal(s.cache['domain:shop.example.com'], undefined, 'the domain is not pointed on this server when storage refused it');
    const status = await s.call('/api/journey/j1/publication');
    assert.deepEqual(Object.keys(status.body.steps).sort(), ['lp1', 'lp2']);
    assert.equal(s.logs.j1.entries.at(-1).status, 'started', 'the retry finishes the revision');
  } finally {
    console.error = quiet;
    await s.close();
  }
});

test('a refused page and a refused domain in one publish are both named', async () => {
  const quiet = console.error;
  console.error = () => {};
  const registry = { 'shop.example.com': { verified: true, userId: 'u1' } };
  const s = await serveRoutes(async (name) => (name === 'pubpage.my-offer' ? { name } : { error: 'HTTP 503', status: 503 }), { registry, domain: 'shop.example.com' });
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 503);
    assert.equal(pub.body.partial, true);
    assert.equal(pub.body.error, '1 of 2 pages could not be saved to storage, so only part of this publish went live. The custom domain shop.example.com could not be saved either. Publish again.');
    assert.deepEqual(pub.body.nodeIds.sort(), ['lp1', 'lp2']);
  } finally {
    console.error = quiet;
    await s.close();
  }
});

test('a stored publish is a plain success', async () => {
  const s = await serveRoutes(accept);
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.success, true);
    assert.equal(pub.body.durable, undefined);
    assert.equal(pub.body.message, 'Published 2 landing page(s) successfully.');
    assert.deepEqual(Object.keys(s.docs).sort(), ['pubpage.my-offer', 'pubpage.second-offer']);
    assert.equal(s.logs.j1.entries.at(-1).status, 'live');
  } finally {
    await s.close();
  }
});

test('a publish with no store configured is live here and says it was not saved to storage', async () => {
  const s = await serveRoutes(accept, { hubReady: false });
  try {
    const pub = await s.call('/api/journey/j1/publish', 'POST');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.success, true);
    assert.equal(pub.body.durable, false);
    assert.match(pub.body.reason, /HUB_API_KEY/);
    assert.equal(pub.body.message, 'Published 2 landing page(s) on this server only. They were not saved to storage, so a restart could take them offline.');
    assert.doesNotMatch(pub.body.message, /successfully/);
  } finally {
    await s.close();
  }
});
