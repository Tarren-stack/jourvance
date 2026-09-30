import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneySaveRoutes, SAVE_CONFLICT, SAVE_UNCHECKED } from './server/routes/journeySaveRoutes.mjs';

// F1, defence in depth: the browser decides by lineage whether its copy may replace the account
// copy, and it cannot know about a save another device made after it read. A save naming
// baseUpdatedAt is refused with 409 when the stored copy is another revision, and nothing is written.
// The real routes, mounted on a bare Express app with the storage stubbed.

async function serve({ stored = {}, readFails = false, saveDelayMs = 0 } = {}) {
  const store = { ...stored };
  const writes = [];
  let clock = Date.parse('2026-09-29T12:00:00.000Z');
  const app = express();
  app.use(express.json());
  setupJourneySaveRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    readJourney: async (uid, id) => {
      if (readFails) return { ok: false };
      return { ok: true, journey: store[`${uid}:${id}`] || null };
    },
    saveJourney: async (uid, id, body) => {
      if (saveDelayMs) await new Promise(r => setTimeout(r, saveDelayMs));
      clock += 1000;
      const journey = { id, userId: uid, name: body.name, nodes: body.nodes || [], edges: body.edges || [], updatedAt: new Date(clock).toISOString() };
      store[`${uid}:${id}`] = journey;
      writes.push(body);
      return { journey, durable: true };
    }
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  return { post, store, writes, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

const R1 = '2026-09-20T10:00:00.000Z';
const account = { id: 'lead-capture-core', userId: 'u1', name: 'Account journey', nodes: [{ id: 'bp5-ad' }], edges: [], updatedAt: R1 };

test('F1: a save made on the stored revision lands', async () => {
  const s = await serve({ stored: { 'u1:lead-capture-core': account } });
  try {
    const r = await s.post('/api/user/u1/journey/lead-capture-core', { name: 'Edited', nodes: [{ id: 'bp5-ad' }], edges: [], baseUpdatedAt: R1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(s.store['u1:lead-capture-core'].name, 'Edited');
    assert.equal('baseUpdatedAt' in s.store['u1:lead-capture-core'], false, 'the base is not stored');
  } finally { await s.close(); }
});

test('F1: a save made on another revision is refused with 409 and writes nothing', async () => {
  const phone = { ...account, name: 'Phone edit', updatedAt: '2026-09-29T11:00:00.000Z' };
  const s = await serve({ stored: { 'u1:lead-capture-core': phone } });
  try {
    for (const path of ['/api/user/u1/journey/lead-capture-core', '/api/journey/lead-capture-core']) {
      const r = await s.post(path, { name: 'Laptop edit', nodes: [], edges: [], baseUpdatedAt: R1 });
      assert.equal(r.status, 409, path);
      assert.deepEqual(r.body, { success: false, conflict: true, error: SAVE_CONFLICT });
    }
    assert.equal(s.writes.length, 0);
    assert.equal(s.store['u1:lead-capture-core'].name, 'Phone edit');
  } finally { await s.close(); }
});

test('F1: a save naming no base, or a base with nothing stored, is written as before', async () => {
  const s = await serve({ stored: { 'u1:lead-capture-core': account } });
  try {
    assert.equal((await s.post('/api/user/u1/journey/lead-capture-core', { name: 'Old client', nodes: [], edges: [] })).status, 200);
    assert.equal((await s.post('/api/user/u1/journey/new-one', { name: 'New', nodes: [], edges: [], baseUpdatedAt: R1 })).status, 200);
    assert.equal((await s.post('/api/user/u1/journey/blank-base', { name: 'Blank', nodes: [], edges: [], baseUpdatedAt: '' })).status, 200);
    assert.equal(s.writes.length, 3);
  } finally { await s.close(); }
});

test('F1: a base the store could not be read to check is refused with 503, not written over', async () => {
  const s = await serve({ stored: { 'u1:lead-capture-core': account }, readFails: true });
  try {
    const r = await s.post('/api/user/u1/journey/lead-capture-core', { name: 'x', nodes: [], edges: [], baseUpdatedAt: R1 });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { success: false, retryable: true, error: SAVE_UNCHECKED });
    assert.equal(s.writes.length, 0);
  } finally { await s.close(); }
});

test('F1: two saves on the same base cannot both pass the check', async () => {
  const s = await serve({ stored: { 'u1:lead-capture-core': account }, saveDelayMs: 30 });
  try {
    const [a, b] = await Promise.all([
      s.post('/api/user/u1/journey/lead-capture-core', { name: 'Tab A', nodes: [], edges: [], baseUpdatedAt: R1 }),
      s.post('/api/user/u1/journey/lead-capture-core', { name: 'Tab B', nodes: [], edges: [], baseUpdatedAt: R1 })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(s.writes.length, 1);
  } finally { await s.close(); }
});

test("F1: another user's path is still refused before anything is read", async () => {
  const s = await serve({ stored: { 'u1:lead-capture-core': account } });
  try {
    const r = await s.post('/api/user/u2/journey/lead-capture-core', { name: 'x', nodes: [], edges: [], baseUpdatedAt: R1 });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { success: false, error: 'That is not your account.' });
    assert.equal(s.writes.length, 0);
  } finally { await s.close(); }
});

test('F1: the refusals are one sentence with no em dash, and the browser reads the same one', async () => {
  const { SAVE_CONFLICT: clientConflict } = await import('./src/lib/accountSync.ts');
  assert.equal(clientConflict, SAVE_CONFLICT);
  for (const m of [SAVE_CONFLICT, SAVE_UNCHECKED]) {
    assert.doesNotMatch(m, /—| – /);
    assert.equal(m.split(/\.\s/).length, 1, m);
  }
});

test('F1: server.mjs mounts the save routes and keeps no inline copy of them', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(src, /setupJourneySaveRoutes\(app, \{ requireUser, readJourney, saveJourney \}\);/);
  assert.doesNotMatch(src, /app\.post\('\/api\/user\/:userId\/journey\/:id'/);
  assert.doesNotMatch(src, /app\.post\('\/api\/journey\/:id',/);
});

// A save whose hub put failed is on this server's copy only, with a later updatedAt than the hub's
// document, and its answer hands the browser that stamp as the next base. readJourney answered the
// hub's older document, so the next save was refused as changed somewhere else when nobody had
// saved. server.mjs's own readJourney and saveJourney run here against a stub hub shaped like the
// SDK, read as text (as journey-read-unavailable.test.mjs does), so nothing loads .env.
const { readFileSync } = await import('node:fs');
const serverSrc = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
const extract = (name) => {
  const start = serverSrc.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `server.mjs defines ${name}`);
  return serverSrc.slice(start, serverSrc.indexOf('\n}\n', start) + 3);
};
const line = (re) => { const m = re.exec(serverSrc); assert.ok(m, String(re)); return m[0]; };
const storageSrc = [line(/const PROJECT_TEXT_FIELDS = [^\n]+/), line(/const text = [^\n]+/), extract('readJourney'), extract('saveJourney')].join('\n');

function serverStorage() {
  const docs = {};
  const hub = { putFails: false, docs, store: { docs: {
    get: async name => (docs[name] ? { document: structuredClone(docs[name]) } : { error: 'No such document.', status: 404 }),
    put: async (name, doc) => { if (hub.putFails) return { error: 'Service unavailable', status: 503 }; docs[name] = structuredClone(doc); return { success: true }; }
  } } };
  // eslint-disable-next-line no-new-func
  const fns = new Function('hub', 'hubReady', 'docName', 'cacheKey', 'journeyCache', 'persistJourneys', `${storageSrc}\nreturn { readJourney, saveJourney };`)(
    hub, true, (uid, id) => `journey.${uid}.${id}`, (uid, id) => `${uid}:${id}`, {}, () => {}
  );
  return { hub, ...fns };
}

test('F1: readJourney answers the later of the hub document and this server\'s copy', async () => {
  const s = serverStorage();
  const first = await s.saveJourney('u1', 'j1', { name: 'first' });
  assert.equal(first.durable, true);
  await new Promise(r => setTimeout(r, 5));
  s.hub.putFails = true;
  const second = await s.saveJourney('u1', 'j1', { name: 'second' });
  assert.equal(second.durable, false);
  assert.equal(s.hub.docs['journey.u1.j1'].name, 'first', 'the hub still holds the older save');
  const read = await s.readJourney('u1', 'j1');
  assert.equal(read.journey.name, 'second');
  assert.equal(read.journey.updatedAt, second.journey.updatedAt);
  // Once a save reaches the hub again, its document is the later one.
  await new Promise(r => setTimeout(r, 5));
  s.hub.putFails = false;
  await s.saveJourney('u1', 'j1', { name: 'third' });
  assert.equal((await s.readJourney('u1', 'j1')).journey.name, 'third');
  // Another account's copy of the same journey id is never this account's.
  assert.equal((await s.readJourney('u2', 'j1')).journey, null);
});

test('F1: a save after one whose hub put failed is not refused as a conflict', async () => {
  const s = serverStorage();
  const app = express();
  app.use(express.json());
  setupJourneySaveRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    readJourney: s.readJourney,
    saveJourney: s.saveJourney
  });
  const server = await new Promise(resolve => { const x = app.listen(0, () => resolve(x)); });
  const url = `http://127.0.0.1:${server.address().port}/api/user/u1/journey/j1`;
  const post = b => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
  const tick = () => new Promise(r => setTimeout(r, 5));
  try {
    const one = await post({ name: 'first' });
    assert.equal(one.body.durable, true);
    await tick();
    s.hub.putFails = true;
    const two = await post({ name: 'second', baseUpdatedAt: one.body.journey.updatedAt });
    assert.equal(two.status, 200);
    assert.equal(two.body.durable, false);
    await tick();
    s.hub.putFails = false;
    const three = await post({ name: 'third', baseUpdatedAt: two.body.journey.updatedAt });
    assert.equal(three.status, 200, JSON.stringify(three.body));
    assert.equal(s.hub.docs['journey.u1.j1'].name, 'third');
    // The hub's older revision is still refused as a base: that copy was saved over since.
    const stale = await post({ name: 'stale', baseUpdatedAt: one.body.journey.updatedAt });
    assert.equal(stale.status, 409);
  } finally { await new Promise(r => server.close(r)); }
});
