import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';

// GET /api/journeys and GET /api/user/:userId/journeys answered {success, journeys} and read the
// list through an inline listJourneys that turned a hub refusal into [] and stopped at 50. They now
// live in server/routes/journeyListRoutes.mjs over server/journeyList.mjs and say whether the list
// is complete. server.mjs is never imported (it loads .env): these tests mount the route module on a
// bare Express app and read server.mjs as text.

const { setupJourneyListRoutes } = await import('./server/routes/journeyListRoutes.mjs');
const { listJourneyDocs, summarizeJourney } = await import('./server/journeyList.mjs');

const source = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

async function serve(listJourneys) {
  const calls = [];
  const app = express();
  app.use(express.json());
  setupJourneyListRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    listJourneys: async (uid) => { calls.push(uid); return listJourneys(uid); },
    summarize: summarizeJourney
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise(r => { server.closeAllConnections(); server.close(r); });
  return { base, calls, close };
}

const get = (url) => fetch(url, { signal: AbortSignal.timeout(2000) });

// The same hub stub shape journey-list.test.mjs uses: `count` journeys for u1 under the prefix.
function stubHub({ count, list, failBatch = -1 }) {
  const prefix = 'journey.u1.';
  const names = Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
  let batch = 0;
  return {
    store: {
      docs: {
        list: async () => (list !== undefined ? list : { documents: names.map(name => ({ name })) }),
        batchGet: async (asked) => {
          if (batch++ === failBatch) return { error: 'Store unavailable', status: 503 };
          return { documents: asked.map(name => ({ name, found: true, document: { id: name.slice(prefix.length), userId: 'u1', name: `J ${name}`, updatedAt: 't', nodes: [{}, {}] } })) };
        }
      }
    }
  };
}

// What server.mjs's listJourneys does, with the hub and cache passed in.
const listingFrom = (hub, cached = []) => (uid) => listJourneyDocs({ hub, hubReady: true, uid, prefix: `journey.${uid}.`, cached });

test('GET /api/journeys lists more than 50 journeys and says the list is complete', async () => {
  const { base, calls, close } = await serve(listingFrom(stubHub({ count: 60 })));
  try {
    const res = await get(`${base}/api/journeys`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.complete, true);
    assert.equal('reason' in body, false);
    assert.equal(body.journeys.length, 60);
    assert.deepEqual(body.journeys[0], { id: '000', name: 'J journey.u1.000', updatedAt: 't', nodeCount: 2 });
    assert.deepEqual(calls, ['u1'], 'the list is always the verified caller\'s');
  } finally {
    await close();
  }
});

test('a refused hub list is answered as incomplete with a reason, never as an empty complete list', async () => {
  const cached = [{ id: 'c1', userId: 'u1', name: 'Kept here', updatedAt: 't', nodes: [] }];
  const { base, close } = await serve(listingFrom(stubHub({ count: 0, list: { error: 'Store unavailable', status: 503 } }), cached));
  try {
    const body = await (await get(`${base}/api/journeys`)).json();
    assert.equal(body.success, true);
    assert.equal(body.complete, false);
    assert.match(body.reason, /did not answer/);
    assert.deepEqual(body.journeys, [{ id: 'c1', name: 'Kept here', updatedAt: 't', nodeCount: 0 }]);
  } finally {
    await close();
  }
});

test('a partly answered list keeps what arrived and says it is partial', async () => {
  const { base, close } = await serve(listingFrom(stubHub({ count: 45, failBatch: 1 })));
  try {
    const body = await (await get(`${base}/api/user/u1/journeys`)).json();
    assert.equal(body.success, true);
    assert.equal(body.complete, false);
    assert.match(body.reason, /only part/);
    assert.equal(body.journeys.length, 25);
  } finally {
    await close();
  }
});

// C41: a journey whose hub put was refused lives only in this server's cache. The hub list alone
// dropped it while answering complete:true, so another browser's library never showed it.
test('a journey only this server holds is listed, and the list is still complete', async () => {
  const cached = [{ id: 'only-here', userId: 'u1', name: 'Hub put refused', updatedAt: 'u', nodes: [{}] }];
  const { base, close } = await serve(listingFrom(stubHub({ count: 2 }), cached));
  try {
    const body = await (await get(`${base}/api/journeys`)).json();
    assert.equal(body.success, true);
    assert.equal(body.complete, true);
    assert.deepEqual(body.journeys.map(j => j.id), ['000', '001', 'only-here']);
    assert.deepEqual(body.journeys[2], { id: 'only-here', name: 'Hub put refused', updatedAt: 'u', nodeCount: 1 });
  } finally {
    await close();
  }
});

test("GET /api/user/:userId/journeys refuses another user's list without reading it", async () => {
  const { base, calls, close } = await serve(listingFrom(stubHub({ count: 3 })));
  try {
    const res = await get(`${base}/api/user/u2/journeys`);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { success: false, error: 'That is not your account.' });
    assert.deepEqual(calls, []);

    const own = await (await get(`${base}/api/user/u1/journeys`)).json();
    assert.equal(own.complete, true);
    assert.equal(own.journeys.length, 3);
  } finally {
    await close();
  }
});

test('a list that throws is a retryable 503, never an empty list', async () => {
  const { base, close } = await serve(async () => { throw new Error('boom'); });
  try {
    for (const path of ['/api/journeys', '/api/user/u1/journeys']) {
      const res = await get(`${base}${path}`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal('journeys' in body, false);
      assert.ok(body.error.length > 10);
    }
  } finally {
    await close();
  }
});

test('server.mjs passes journeyCache and summarize to the auth routes only after declaring them', () => {
  const call = source.indexOf('setupAuthWorkspaceRoutes(app, {');
  assert.ok(call > 0);
  assert.ok(source.indexOf('let journeyCache') > 0 && call > source.indexOf('let journeyCache'), 'journeyCache is declared first');
  assert.ok(source.indexOf('const summarize') > 0 && call > source.indexOf('const summarize'), 'summarize is declared first');
  // No route is registered between the old and new positions, so route order is unchanged.
  const between = source.slice(source.indexOf('const hubReady'), call);
  assert.doesNotMatch(between, /app\.(get|post|put|delete|use|all)\(|setup[A-Z]\w*Routes\(app/);
});

test('server.mjs reads the list through server/journeyList.mjs and mounts the list routes', () => {
  assert.match(source, /from '\.\/server\/journeyList\.mjs'/);
  assert.match(source, /const summarize = summarizeJourney;/);
  const body = source.slice(source.indexOf('async function listJourneys(uid)'), source.indexOf('const summarize'));
  assert.match(body, /listJourneyDocs\(\{/);
  assert.match(body, /prefix: `journey\.\$\{safe\(uid\)\}\.`/);
  assert.match(body, /Object\.values\(journeyCache\)\.filter\(\(j\) => j\.userId === uid\)/);
  assert.doesNotMatch(body, /slice\(0, 50\)/);
  assert.match(source, /setupJourneyListRoutes\(app, \{ requireUser, listJourneys, summarize \}\)/);
  assert.doesNotMatch(source, /app\.get\(\s*['"`]\/api\/(user\/:userId\/)?journeys['"`]/, 'the list routes live in journeyListRoutes.mjs');
});
