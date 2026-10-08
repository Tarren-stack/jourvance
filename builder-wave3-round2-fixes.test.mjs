// Wave 3, fix round 2 (LANDING_BUILDER_PLAN.md). Each test pins one reviewer finding:
// - the 100 entry library cap holds against saves sent at the same time;
// - a publish whose publish record the store refused says so, and the next number clears the
//   page history's, so a lost record can never make a new version take an old version's number;
// - the history never writes a number it already holds;
// - a model answer that ends in a dash ends cleanly, not in a comma;
// - a body over the limit is a JSON 413, not Express's HTML page;
// - the builder's library and history panels speak in the merchant's words and colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { setupBuilderLibraryRoutes, LIBRARY_MAX_ITEMS, oneAtATime } from './server/routes/builderLibraryRoutes.mjs';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { revisionsLogId } from './server/builderRevisions.mjs';
import { cleanModelStrings } from './server/routes/aiJourneyRoutes.mjs';
import { jsonBodyTooLarge, BODY_TOO_LARGE } from './server/bodyErrors.mjs';
import { publishWarning } from './src/lib/saveOutcome.ts';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const close = (server) => new Promise((r) => { server.closeAllConnections(); server.close(r); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function validDoc(text) {
  let doc = createEmptyPage();
  const section = createNode('section');
  doc = insertNode(doc, null, 0, section).doc;
  const heading = createNode('widget', 'heading');
  heading.props = { ...heading.props, text };
  return insertNode(doc, section.children[0].id, 0, heading).doc;
}

// ---- The library cap under a burst ----

test('twenty saves sent together stop at the 100 entry cap', async () => {
  const rows = [];
  for (let i = 0; i < 95; i++) rows.push({ id: `seed${i}`, userId: 'u1', name: `s${i}`, section: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  rows.push({ id: 'other', userId: 'u2', name: 'x', section: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  setupBuilderLibraryRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: req.get('x-uid') }; next(); },
    // The hub round trip, so every request in the burst is inside its read at once.
    listLibrary: async () => { await wait(20); return { items: rows.map((r) => ({ ...r })), complete: true }; },
    putLibraryItem: async (_uid, item) => { await wait(5); rows.push(item); return { durable: true }; },
    removeLibraryItem: async () => ({ ok: true, durable: true })
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const section = validDoc('Burst').sections[0];
  try {
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${base}/api/builder/library`, {
      method: 'POST',
      headers: { 'x-uid': 'u1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `burst ${i}`, section })
    }).then((r) => r.status)));
    assert.equal(answers.filter((s) => s === 200).length, 5, `statuses: ${answers.join(',')}`);
    assert.equal(answers.filter((s) => s === 400).length, 15);
    assert.equal(rows.filter((r) => r.userId === 'u1').length, LIBRARY_MAX_ITEMS);
  } finally { await close(server); }
});

test('oneAtATime runs one key in order, lets other keys through, and survives a throw', async () => {
  const run = oneAtATime();
  const seen = [];
  const a1 = run('a', async () => { await wait(30); seen.push('a1'); });
  const a2 = run('a', async () => { seen.push('a2'); throw new Error('boom'); });
  const a3 = run('a', async () => { seen.push('a3'); return 3; });
  const b1 = run('b', async () => { seen.push('b1'); });
  await b1;
  assert.deepEqual(seen, ['b1'], 'another key does not wait');
  await a1;
  await assert.rejects(a2, /boom/);
  assert.equal(await a3, 3);
  assert.deepEqual(seen, ['b1', 'a1', 'a2', 'a3']);
});

// ---- Publish numbers and the publish record ----

const journeyWith = (doc) => ({
  id: 'j1',
  nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Offer', builder: doc } }],
  edges: []
});

async function servePublish({ logs, refuseMainLog = () => false, failHistoryReadOnce = false }) {
  const saved = {};
  const store = { journey: null };
  let historyReads = 0;
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
    loadPublishLog: async (u, id) => {
      if (failHistoryReadOnce && id.endsWith('#builder-revisions') && historyReads++ === 0) return { ok: false };
      return { ok: true, log: logs[`${u}:${id}`] ? structuredClone(logs[`${u}:${id}`]) : null };
    },
    savePublishLog: async (u, id, log) => {
      if (!id.endsWith('#builder-revisions') && refuseMainLog()) return { durable: false, reason: 'hub refused the put' };
      logs[`${u}:${id}`] = structuredClone(log);
      return { durable: true };
    },
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.parse('2026-10-08T10:00:00.000Z')
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    publish: async (text) => {
      store.journey = journeyWith(validDoc(text));
      const res = await fetch(`${base}/api/journey/j1/publish`, { method: 'POST' });
      return { status: res.status, body: await res.json() };
    },
    history: () => (logs[`u1:${revisionsLogId('j1')}`]?.pages?.['page-1'] || []).map((r) => [r.rev, r.document.sections[0].children[0].children[0].props.text]),
    close: () => close(server)
  };
}

test('a publish record the store refused is said, and a lost record never reuses a history number', async () => {
  const logs = {};
  let refuse = false;
  const s = await servePublish({ logs, refuseMainLog: () => refuse });
  try {
    const one = await s.publish('VERSION-ONE');
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal(one.body.revision.number, 1);
    assert.equal(one.body.publishLogSaved, undefined, 'a kept record says nothing extra');

    refuse = true;
    const two = await s.publish('VERSION-TWO');
    assert.equal(two.status, 200);
    assert.equal(two.body.revision.number, 2);
    assert.equal(two.body.publishLogSaved, false);
    assert.match(two.body.publishLogNote, /could not be recorded/);
    assert.ok(two.body.message.includes(two.body.publishLogNote));
    assert.doesNotMatch(two.body.publishLogNote, /hub refused|\u2014/);
    const warn = publishWarning({ status: 200, body: two.body });
    assert.ok(warn && warn.includes(two.body.publishLogNote));

    // A fresh disk after a redeploy: the store still holds the record of publish 1 only.
    refuse = false;
    const three = await s.publish('VERSION-THREE');
    assert.equal(three.status, 200);
    assert.equal(three.body.revision.number, 3, 'the number clears the history, not only the record');
    assert.deepEqual(s.history(), [[3, 'VERSION-THREE'], [2, 'VERSION-TWO'], [1, 'VERSION-ONE']]);
  } finally { await s.close(); }
});

test('the history never writes over a number it already holds', async () => {
  // Publish 1 is stored. Then the publish record is lost and the history read that sets the floor
  // fails once, so the publish takes number 1 again: the history must keep VERSION-ONE.
  const logs = {};
  const first = await servePublish({ logs });
  try {
    assert.equal((await first.publish('VERSION-ONE')).body.revision.number, 1);
  } finally { await first.close(); }
  delete logs['u1:j1'];
  const s = await servePublish({ logs, failHistoryReadOnce: true });
  try {
    const again = await s.publish('VERSION-CLASH');
    assert.equal(again.status, 200);
    assert.equal(again.body.revision.number, 1, 'precondition: the floor read failed, so the number came round');
    assert.equal(again.body.historySaved, false);
    assert.deepEqual(s.history(), [[1, 'VERSION-ONE']]);
  } finally { await s.close(); }
});

// ---- A trailing dash ----

test('a model answer ending in a dash ends cleanly', () => {
  assert.equal(cleanModelStrings('Fast \u2014 simple \u2013 done [1] and A\u2013B, 3\u20135 days \u2014'), 'Fast, simple, done and A-B, 3\u20135 days');
  assert.equal(cleanModelStrings('Ready now\u2013'), 'Ready now');
  assert.equal(cleanModelStrings('Ready now \u2014 [2]'), 'Ready now');
  assert.equal(cleanModelStrings('range 3\u20135'), 'range 3\u20135');
});

// ---- The 413 ----

test('a body over the limit is a JSON 413, and server.mjs mounts the handler right after the parser', async () => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.use(jsonBodyTooLarge);
  app.post('/x', (_req, res) => res.json({ success: true }));
  app.use((err, _req, res, _next) => res.status(500).type('text').send(`fallthrough ${err.type}`));
  const server = await listen(app);
  try {
    const url = `http://127.0.0.1:${server.address().port}/x`;
    const big = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(4096) }) });
    assert.equal(big.status, 413);
    assert.match(big.headers.get('content-type') || '', /json/);
    assert.deepEqual(await big.json(), { success: false, error: BODY_TOO_LARGE });
    const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 500, 'other parser errors pass through untouched');
    const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(ok.status, 200);
  } finally { await close(server); }
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const parser = src.indexOf("app.use(express.json({\n  limit: '1mb'");
  const handler = src.search(/^app\.use\(jsonBodyTooLarge\);$/m);
  assert.ok(parser > 0 && handler > parser, 'mounted after the global parser');
  assert.ok(!/app\.(use|get|post|put|delete)\(/.test(src.slice(src.indexOf('}));', parser) + 4, handler).replace(/^\/\/.*$/gm, '')), 'nothing mounted between them');
  assert.doesNotMatch(BODY_TOO_LARGE, /\u2014|PayloadTooLarge/);
});

// ---- The panels ----

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('a refused library delete is a red alert, and a not-durable delete says so', () => {
  const shell = read('./src/components/builder/BuilderShell.tsx');
  const del = shell.slice(shell.indexOf('const deleteSaved'), shell.indexOf('const addSaved'));
  assert.match(del, /setSavedNote\(\{ text: r\.error, error: true \}\)/);
  assert.match(del, /r\.durable/);
  assert.match(del, /never stored in your account/);
  const note = shell.slice(shell.indexOf('{savedNote && ('), shell.indexOf('Close note'));
  assert.match(note, /role=\{savedNote\.error \? 'alert' : 'note'\}/);
  assert.match(note, /#FCA5A5/);
});

test('a part-read library is said without the server\'s reason', () => {
  const shell = read('./src/components/builder/BuilderShell.tsx');
  const palette = read('./src/components/builder/BuilderPalette.tsx');
  assert.match(shell, /partial: true/);
  assert.doesNotMatch(shell, /account store answered only part/);
  assert.doesNotMatch(palette, /\$\{saved\.partial\}/);
  const note = palette.match(/export const SAVED_PARTIAL_NOTE = '([^']+)'/);
  assert.ok(note, 'the note is a fixed sentence');
  assert.doesNotMatch(note[1], /journey|store|cache|server|\u2014/i);
});

test('History says Variant B in the step editor\'s words and announces a restore in progress', () => {
  const history = read('./src/components/builder/BuilderHistory.tsx');
  assert.doesNotMatch(history, /with a B version/);
  assert.match(history, /HAS_SPLIT_TEST_NOTE = ', with Variant B of its A\/B test'/);
  const status = history.match(/<p role="status" data-history-restoring=""[^>]*>\{([^\n]+)\}<\/p>/);
  assert.ok(status, 'the restore status line is mounted from the start');
  assert.match(status[1], /^busy !== null \? `Restoring version \$\{busy\}\.` : ''$/);
});
