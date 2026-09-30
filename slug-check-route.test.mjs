import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';

// GET /api/journey/check-slug was registered after GET /api/journey/:id, so Express answered it as
// a journey load for the id "check-slug" and the slug validator never ran. Every GET under
// /api/journey/ now lives in journeyRoutes.mjs, with the literal paths above /:id. These tests
// mount only that module on a bare Express app, and read server.mjs as text without importing it.

async function serve(overrides = {}) {
  const calls = { loadJourney: [], validate: [] };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async (uid, id) => { calls.loadJourney.push([uid, id]); return { id, nodes: [], edges: [] }; },
    saveJourney: async () => ({ durable: true }),
    loadWorkspace: async () => null,
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug, uid, opts) => {
      calls.validate.push([slug, uid, opts]);
      return { available: true, cleanSlug: slug };
    },
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async () => {},
    removePublicPage: async () => {},
    persistPublicPages: () => {},
    publicPageCache: {},
    ...overrides
  };
  // Overrides replace a stub whole, so wrap them to keep recording calls.
  if (overrides.loadJourney) {
    const inner = overrides.loadJourney;
    ctx.loadJourney = async (uid, id) => { calls.loadJourney.push([uid, id]); return inner(uid, id); };
  }
  if (overrides.validateSlugAvailability) {
    const inner = overrides.validateSlugAvailability;
    ctx.validateSlugAvailability = async (slug, uid, opts) => { calls.validate.push([slug, uid, opts]); return inner(slug, uid, opts); };
  }
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // A request left hanging by a handler must not stall teardown.
  const close = () => new Promise(r => { server.closeAllConnections(); server.close(r); });
  return { base, calls, close };
}

const get = (url) => fetch(url, { signal: AbortSignal.timeout(2000) });

test("GET /api/journey/j1 is answered by journeyRoutes.mjs with the caller's journey", async () => {
  const { base, calls, close } = await serve();
  try {
    const res = await get(`${base}/api/journey/j1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.journey.id, 'j1');
    assert.deepEqual(calls.loadJourney, [['u1', 'j1']]);
  } finally {
    await close();
  }

  const missing = await serve({ loadJourney: async () => null });
  try {
    const res = await get(`${missing.base}/api/journey/nope`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, journey: null });
    assert.deepEqual(missing.calls.loadJourney, [['u1', 'nope']]);
  } finally {
    await missing.close();
  }
});

test('the slug check runs the validator and never loads a journey, even though the module also owns /api/journey/:id', async () => {
  const { base, calls, close } = await serve();
  try {
    const res = await get(`${base}/api/journey/check-slug?slug=offer`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { success: true, available: true, cleanSlug: 'offer' });
    assert.deepEqual(calls.validate, [['offer', 'u1', { type: 'page', customDomain: '' }]]);
    assert.equal(calls.loadJourney.length, 0);

    const split = await get(`${base}/api/journey/check-slug?slug=try-it&type=ab-split&customDomain=offer.example.com`);
    assert.equal(split.status, 200);
    const splitBody = await split.json();
    assert.equal(splitBody.available, true);
    assert.deepEqual(calls.validate[1], ['try-it', 'u1', { type: 'ab-split', customDomain: 'offer.example.com' }]);
    assert.equal(calls.loadJourney.length, 0);
  } finally {
    await close();
  }
});

test("a taken address is 409 with available false and the validator's own sentence", async () => {
  const sentence = 'The page slug "offer" is already claimed by another store. Please choose a unique custom slug.';
  const { base, close } = await serve({
    validateSlugAvailability: async () => ({ available: false, error: sentence })
  });
  try {
    const res = await get(`${base}/api/journey/check-slug?slug=offer`);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.available, false);
    assert.equal(body.error, sentence);
  } finally {
    await close();
  }
});

test('a slug check that throws is answered once, in words, and marked retryable', async () => {
  const { base, close } = await serve({
    validateSlugAvailability: async () => { throw new Error('store unreachable'); }
  });
  const logged = console.error;
  console.error = () => {};
  try {
    const res = await get(`${base}/api/journey/check-slug?slug=offer`);
    assert.equal(res.status, 500);
    const raw = await res.text();
    const body = JSON.parse(raw);
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.match(body.error, /^The address check did not finish/);
    assert.ok(!raw.includes('store unreachable'), 'no internal error text reaches the caller');
    assert.doesNotMatch(raw, /\u2014/);
    assert.doesNotMatch(raw, / \u2013 /);
  } finally {
    console.error = logged;
    await close();
  }
});

test('server.mjs registers no GET under /api/journey/', () => {
  const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  // Matches /api/journey/ with its slash, so the plural /api/journeys list route is not caught.
  const hits = source.split('\n')
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter(({ text }) => /app\.get\(\s*['"`]\/api\/journey\//.test(text));
  assert.deepEqual(hits, [], 'register every GET under /api/journey/ in server/routes/journeyRoutes.mjs');
});

test('in journeyRoutes.mjs every literal /api/journey/<name> GET is registered above /api/journey/:id', () => {
  const source = fs.readFileSync(new URL('./server/routes/journeyRoutes.mjs', import.meta.url), 'utf8');
  const paths = [...source.matchAll(/app\.get\(\s*['"`](\/api\/journey\/[^'"`]*)['"`]/g)].map(m => m[1]);
  const idAt = paths.indexOf('/api/journey/:id');
  assert.ok(idAt >= 0, 'GET /api/journey/:id is registered in journeyRoutes.mjs');
  paths.forEach((p, i) => {
    const first = p.slice('/api/journey/'.length).split('/')[0];
    if (!first.startsWith(':')) {
      assert.ok(i < idAt, `${p} must be registered above /api/journey/:id`);
    }
  });
});
