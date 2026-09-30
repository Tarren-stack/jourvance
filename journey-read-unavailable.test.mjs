import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';

// The hub SDK never throws: a 503, a 409 or a network failure comes back as { error, status? }.
// loadJourney only fell back on a throw, so every such answer read as "not there": GET
// /api/journey/:id answered success with journey null (the browser then released autosave over the
// account copy), or with an older copy this server had cached, and publish, unpublish and preview
// answered a non-retryable "Journey not found." or ran on that older copy. server.mjs is read as
// text and its two functions run against a stub hub shaped like the SDK; it is never imported,
// so nothing loads .env or starts a server.

const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
const extract = (name) => {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `server.mjs defines ${name}`);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
};
const fnSrc = extract('readJourney') + extract('loadJourney');

const docName = (uid, id) => `journey.${uid}.${id}`;
const cacheKey = (uid, id) => `${uid}:${id}`;
const OLD = { id: 'j1', userId: 'u1', name: 'OLD copy', nodes: [{ id: 'lp', type: 'landing-page', data: { published: true } }], edges: [], updatedAt: '2026-01-01T00:00:00.000Z' };
const NEW = { ...OLD, name: 'NEW copy', updatedAt: '2026-09-01T00:00:00.000Z' };

function server({ hubAnswer, hubReady = true, cache = {} }) {
  const hub = { store: { docs: { get: async () => (typeof hubAnswer === 'function' ? hubAnswer() : hubAnswer) } } };
  // eslint-disable-next-line no-new-func
  return new Function('hub', 'hubReady', 'docName', 'cacheKey', 'journeyCache', `${fnSrc}\nreturn { readJourney, loadJourney };`)(
    hub, hubReady, docName, cacheKey, structuredClone(cache)
  );
}

// The SDK's answers, as hub-sdk.js builds them.
const unavailable = { error: 'Service unavailable', status: 503, retryable: true };
const network = { error: 'fetch failed' };
const torn = { error: 'holds parts from two different writes', status: 409 };
const missing = { error: 'No such document.', status: 404 };

test('readJourney tells "the hub could not answer" apart from "there is no such journey"', async () => {
  const cached = { 'u1:j1': OLD };
  assert.deepEqual(await server({ hubAnswer: { document: NEW }, cache: cached }).readJourney('u1', 'j1'), { ok: true, journey: NEW });
  for (const hubAnswer of [unavailable, network, torn, () => { throw new Error('boom'); }]) {
    assert.deepEqual(await server({ hubAnswer, cache: cached }).readJourney('u1', 'j1'), { ok: false }, JSON.stringify(hubAnswer));
    assert.deepEqual(await server({ hubAnswer }).readJourney('u1', 'j1'), { ok: false });
  }
  // A 404 is an answer. This server's copy stands in, since it is the only one when a hub put failed.
  assert.deepEqual(await server({ hubAnswer: missing }).readJourney('u1', 'j1'), { ok: true, journey: null });
  assert.deepEqual(await server({ hubAnswer: missing, cache: cached }).readJourney('u1', 'j1'), { ok: true, journey: OLD });
  assert.deepEqual(await server({ hubAnswer: missing, cache: cached }).readJourney('u2', 'j1'), { ok: true, journey: null });
  // With no hub, the cache is the store.
  assert.deepEqual(await server({ hubAnswer: unavailable, hubReady: false, cache: cached }).readJourney('u1', 'j1'), { ok: true, journey: OLD });
});

test('loadJourney, for background enrollment only, still falls back to the cached copy', async () => {
  assert.deepEqual(await server({ hubAnswer: unavailable, cache: { 'u1:j1': OLD } }).loadJourney('u1', 'j1'), OLD);
  assert.equal(await server({ hubAnswer: unavailable }).loadJourney('u1', 'j1'), null);
  assert.deepEqual(await server({ hubAnswer: { document: NEW }, cache: { 'u1:j1': OLD } }).loadJourney('u1', 'j1'), NEW);
});

async function serve(fns) {
  const writes = [];
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: fns.loadJourney,
    readJourney: fns.readJourney,
    saveJourney: async (...a) => { writes.push(['saveJourney', a[1]]); return { durable: true }; },
    loadWorkspace: async () => null,
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key) => { writes.push(['savePublicPage', key]); },
    removePublicPage: async (key) => { writes.push(['removePublicPage', key]); return true; },
    persistPublicPages: () => {},
    publicPageCache: {},
    savePublishLog: async () => { writes.push(['savePublishLog']); return { durable: true }; },
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>'
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const s = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const call = (path, body) => fetch(base + path, body === undefined
    ? { signal: AbortSignal.timeout(3000) }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  const close = () => new Promise(r => { s.closeAllConnections(); s.close(r); });
  return { call, writes, close };
}

const ROUTES = [
  ['GET', '/api/journey/j1', undefined],
  ['publish', '/api/journey/j1/publish', {}],
  ['unpublish', '/api/journey/j1/unpublish', {}],
  ['preview', '/api/journey/j1/preview', { nodeId: 'lp' }],
  ['publication', '/api/journey/j1/publication', undefined]
];

for (const [label, hubAnswer, cache] of [
  ['the hub answers 503 and this server holds an older copy', unavailable, { 'u1:j1': OLD }],
  ['the hub answers 503 and this server holds nothing', unavailable, {}],
  ['the hub cannot be reached', network, {}]
]) {
  test(`when ${label}, every journey route is a retryable 503 and nothing is written`, async () => {
    const { call, writes, close } = await serve(server({ hubAnswer, cache }));
    try {
      for (const [name, path, body] of ROUTES) {
        const res = await call(path, body);
        const answer = await res.json();
        assert.equal(res.status, 503, `${name} answers 503, not ${res.status} ${JSON.stringify(answer)}`);
        assert.equal(res.headers.get('retry-after'), '30', `${name} says when to retry`);
        assert.deepEqual(answer, { success: false, retryable: true, error: 'Your journey could not be read from your account. Try again.' }, name);
      }
      assert.deepEqual(writes, [], 'no page, journey or log was written from a copy the account did not confirm');
    } finally {
      await close();
    }
  });
}

test('a journey the account really does not have is still a plain answer', async () => {
  const { call, writes, close } = await serve(server({ hubAnswer: missing }));
  try {
    const get = await call('/api/journey/j1');
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { success: true, journey: null });
    const publish = await call('/api/journey/j1/publish', {});
    assert.equal(publish.status, 404);
    assert.deepEqual(await publish.json(), { success: false, error: 'Journey not found.' });
    assert.deepEqual(writes, []);
  } finally {
    await close();
  }
});

test("the account's copy wins over this server's older one", async () => {
  const { call, close } = await serve(server({ hubAnswer: { document: NEW }, cache: { 'u1:j1': OLD } }));
  try {
    const res = await call('/api/journey/j1');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).journey.name, 'NEW copy');
  } finally {
    await close();
  }
});

test('a readJourney that throws is answered as unavailable instead of left hanging', async () => {
  const { call, close } = await serve({ loadJourney: async () => OLD, readJourney: async () => { throw new Error('boom'); } });
  try {
    const res = await call('/api/journey/j1');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).retryable, true);
  } finally {
    await close();
  }
});

test('server.mjs hands readJourney to the journey routes', () => {
  const block = src.slice(src.indexOf('setupJourneyRoutes(app, {'));
  assert.match(block.slice(0, block.indexOf('});')), /\breadJourney,/);
});
