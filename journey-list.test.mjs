import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// GET /api/journeys reported a hub refusal as an empty list (the SDK answers {error, status}
// rather than throwing, so the catch never ran) and stopped at 50 journeys. server/journeyList.mjs
// now says whether the list is complete, and why not.

const { listJourneyDocs, summarizeJourney, JOURNEY_BATCH } = await import('./server/journeyList.mjs');

const PREFIX = 'journey.u1.';

function stubHub({ count = 0, list, failBatch = -1, throwBatch = -1, foreign = [] } = {}) {
  const names = Array.from({ length: count }, (_, i) => `${PREFIX}${String(i).padStart(3, '0')}`);
  const calls = [];
  const hub = {
    store: {
      docs: {
        list: async () => (list !== undefined ? list : { documents: [...names, 'journey.u2.zzz', 'workspace.u1.a'].map(name => ({ name })) }),
        batchGet: async (asked) => {
          const index = calls.length;
          calls.push(asked);
          if (index === failBatch) return { error: 'Store unavailable', status: 503 };
          if (index === throwBatch) throw new Error('socket hang up');
          return {
            documents: asked.map(name => ({
              name,
              found: true,
              document: { id: name.slice(PREFIX.length), userId: foreign.includes(name) ? 'u2' : 'u1', name: `J ${name}`, nodes: [], edges: [] }
            }))
          };
        }
      }
    }
  };
  return { hub, calls };
}

// The fallback tests pass this; the hub-list tests pass an empty cache, because a cached journey
// the hub lacks is merged into the list (see the C41 tests below).
const cached = [{ id: 'cached-1', userId: 'u1', nodes: [] }];

test('with no hub the local file is the record, so the list is complete', async () => {
  const out = await listJourneyDocs({ hub: null, hubReady: false, uid: 'u1', prefix: PREFIX, cached });
  assert.deepEqual(out, { journeys: cached, complete: true });
});

test('a refused document list is never an empty complete list', async () => {
  const { hub } = stubHub({ list: { error: 'Store unavailable', status: 503 } });
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached });
  assert.deepEqual(out.journeys, cached);
  assert.equal(out.complete, false);
  assert.ok(out.reason && out.reason.length > 10);

  const empty = await listJourneyDocs({ hub: stubHub({ list: null }).hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached });
  assert.equal(empty.complete, false);
  const thrown = await listJourneyDocs({
    hub: { store: { docs: { list: async () => { throw new Error('down'); } } } },
    hubReady: true, uid: 'u1', prefix: PREFIX, cached
  });
  assert.equal(thrown.complete, false);
  assert.deepEqual(thrown.journeys, cached);
});

test('every journey is listed, read in batches of at most 20', async () => {
  const { hub, calls } = stubHub({ count: 60 });
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [] });
  assert.equal(out.journeys.length, 60);
  assert.equal(out.complete, true);
  assert.equal(JOURNEY_BATCH, 20);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.length <= 20));
  assert.ok(calls.flat().every(n => n.startsWith(PREFIX)), 'other users and other stores are never read');
});

test('one failed batch marks the list incomplete and keeps the other batches', async () => {
  const refused = await listJourneyDocs({ hub: stubHub({ count: 60, failBatch: 1 }).hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [] });
  assert.equal(refused.complete, false);
  assert.equal(refused.journeys.length, 40);
  assert.match(refused.reason, /only part/);

  const thrown = await listJourneyDocs({ hub: stubHub({ count: 45, throwBatch: 0 }).hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [] });
  assert.equal(thrown.complete, false);
  assert.equal(thrown.journeys.length, 25);
});

test('a document that belongs to another user is dropped', async () => {
  const { hub } = stubHub({ count: 3, foreign: [`${PREFIX}001`] });
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [] });
  assert.deepEqual(out.journeys.map(j => j.id), ['000', '002']);
  assert.equal(out.complete, true);
});

test('an empty account is an empty complete list', async () => {
  const { hub, calls } = stubHub({ count: 0 });
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [] });
  assert.deepEqual(out, { journeys: [], complete: true });
  assert.equal(calls.length, 0);
});

// C41: a save the hub refused lives only in this server's cache (saveJourney answers
// durable:false). The hub list alone left it out and still said complete, so another browser
// never saw it in the library.
test('a journey only this server holds is listed beside the hub list', async () => {
  const { hub } = stubHub({ count: 2 });
  const onlyHere = { id: 'only-here', userId: 'u1', name: 'Hub put refused', updatedAt: '2026-09-02T00:00:00Z', nodes: [] };
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [onlyHere] });
  assert.deepEqual(out.journeys.map(j => j.id), ['000', '001', 'only-here']);
  assert.equal(out.complete, true);

  const partial = await listJourneyDocs({ hub: stubHub({ count: 25, failBatch: 1 }).hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [onlyHere] });
  assert.equal(partial.complete, false, 'the merge never turns a partial read into a complete one');
  assert.ok(partial.journeys.some(j => j.id === 'only-here'));
});

test('when both copies exist the newer one is listed, once, in the hub order', async () => {
  const older = { id: '000', userId: 'u1', name: 'Older here', updatedAt: '2026-01-01T00:00:00Z', nodes: [] };
  const newer = { id: '001', userId: 'u1', name: 'Newer here', updatedAt: '2999-01-01T00:00:00Z', nodes: [] };
  const hub = {
    store: { docs: {
      list: async () => ({ documents: [{ name: `${PREFIX}000` }, { name: `${PREFIX}001` }] }),
      batchGet: async (asked) => ({ documents: asked.map(name => ({ found: true, document: { id: name.slice(PREFIX.length), userId: 'u1', name: 'On hub', updatedAt: '2026-06-01T00:00:00Z', nodes: [] } })) })
    } }
  };
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [older, newer] });
  assert.deepEqual(out.journeys.map(j => [j.id, j.name]), [['000', 'On hub'], ['001', 'Newer here']]);
});

test('another user\'s cached journey is never merged in', async () => {
  const { hub } = stubHub({ count: 1 });
  const out = await listJourneyDocs({ hub, hubReady: true, uid: 'u1', prefix: PREFIX, cached: [{ id: 'theirs', userId: 'u2', nodes: [] }] });
  assert.deepEqual(out.journeys.map(j => j.id), ['000']);
});

test('summarizeJourney names an untitled journey and counts its steps', () => {
  assert.deepEqual(summarizeJourney({ id: 'a', updatedAt: 't', nodes: [1, 2, 3] }), { id: 'a', name: 'Untitled Journey', updatedAt: 't', nodeCount: 3 });
  assert.equal(summarizeJourney({ id: 'a', metadata: { name: 'Old' } }).name, 'Old');
  assert.equal(summarizeJourney({ id: 'a', name: 'New', metadata: { name: 'Old' } }).nodeCount, 0);
});

// #18 step 0: setupAuthWorkspaceRoutes is called below `const summarize`, never above it.
test('server.mjs passes journeyCache and summarize to the auth routes only after declaring them', () => {
  const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const call = source.indexOf('setupAuthWorkspaceRoutes(app, {');
  assert.ok(call > 0);
  assert.ok(call > source.indexOf('let journeyCache'), 'journeyCache is declared first');
  assert.ok(call > source.indexOf('const summarize'), 'summarize is declared first');
});
