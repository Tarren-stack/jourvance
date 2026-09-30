import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';

// Drives the real publish and unpublish routes over HTTP with the storage stubbed. Publishing a
// journey that holds an A/B split referenced an undefined `splitRecord`, and because Express 4
// does not catch a rejected async handler, that one request exited the server for every tenant.

function journeyWithSplit() {
  return {
    id: 'j1',
    nodes: [
      { id: 'split-1', type: 'ab-split', data: { type: 'ab-split', slug: 'try-it', splitRatio: 60 } },
      { id: 'page-a', type: 'landing-page', data: { type: 'landing-page', slug: 'offer-a', headline: 'A' } },
      { id: 'page-b', type: 'landing-page', data: { type: 'landing-page', slug: 'offer-b', headline: 'B' } }
    ],
    edges: [
      { id: 'e1', source: 'split-1', sourceHandle: 'branch-a', target: 'page-a' },
      { id: 'e2', source: 'split-1', sourceHandle: 'branch-b', target: 'page-b' }
    ]
  };
}

async function serve(overrides = {}) {
  const saved = { ...(overrides.records || {}) };
  const cache = overrides.publicPageCache || {};
  const counts = { persist: 0, saveJourney: 0, savePublicPage: 0, savePublishLog: 0 };
  const journeySaves = [];
  const removed = [];
  const workspaceCalls = [];
  const rendered = [];
  const logs = { store: overrides.initialLog ? { ...overrides.initialLog } : {}, failRead: false };
  const clock = { t: Date.parse('2026-09-01T10:00:00.000Z') };
  // A journey fixture is handed back by reference, as loadJourney does with the hub off, so a
  // test can see whether publish changed the object it loaded. A save replaces what later loads see.
  const { journey, records, initialLog, ...rest } = overrides;
  const store = { journey: journey || journeyWithSplit() };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_uid, _id, j) => { counts.saveJourney += 1; journeySaves.push(j); store.journey = j; return { durable: true }; },
    loadWorkspace: async (uid, wsId) => { workspaceCalls.push([uid, wsId]); return { id: wsId, shopifyConfig: { storeDomain: 'real-shop.myshopify.com', status: 'connected' } }; },
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { counts.savePublicPage += 1; cache[key] = record; await null; saved[key] = record; },
    removePublicPage: async (key) => { removed.push(key); delete saved[key]; delete cache[key]; return true; },
    loadPublicPage: async (key) => saved[key] || cache[key] || null,
    loadPublishLog: async (uid, id) => (logs.failRead ? { ok: false } : { ok: true, log: logs.store[`${uid}:${id}`] || null }),
    savePublishLog: async (uid, id, log) => { counts.savePublishLog += 1; logs.store[`${uid}:${id}`] = structuredClone(log); return { durable: true }; },
    renderPublicFunnelHtml: (record, req, res) => {
      rendered.push({ record, req, res });
      const d = record.data;
      return `<html><head><title>t</title></head><body class="x"><h1>${d.headline}</h1><p>pixels:${d.metaPixelId}|${d.tiktokPixelId}|${d.ga4TrackingId}|${d.variantB?.metaPixelId ?? ''}</p><p>store:${record.shopifyConfig?.storeDomain}</p></body></html>`;
    },
    renderPublicUpsellHtml: (record, req, res, isDownsell) => {
      rendered.push({ record, req, res, isDownsell });
      return `<html><head></head><body><h1>${record.data.headline}</h1></body></html>`;
    },
    persistPublicPages: () => { counts.persist += 1; },
    publicPageCache: cache,
    now: () => clock.t,
    ...rest
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, saved, cache, counts, journeySaves, removed, workspaceCalls, rendered, logs, clock, store,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

async function publish(overrides) {
  const ctx = await serve(overrides);
  try {
    const res = await fetch(`${ctx.base}/api/journey/j1/publish`, { method: 'POST' });
    return { ...ctx, status: res.status, body: await res.json() };
  } finally {
    await ctx.close();
  }
}

test('publishing a journey with an A/B split answers 200 and stores the split record', async () => {
  const { base, saved, cache, close } = await serve();
  try {
    const res = await fetch(`${base}/api/journey/j1/publish`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const split = saved['split:try-it'];
    assert.ok(split, 'the split record was saved under split:<slug>');
    assert.equal(split.type, 'ab-split');
    assert.equal(split.data.branchAPageSlug, 'offer-a');
    assert.equal(split.data.branchBPageSlug, 'offer-b');
    assert.equal(cache['split:try-it'], split);
    assert.ok(body.publishedPages.some(p => p.url === '/p/split/try-it'));
  } finally {
    await close();
  }
});

test('a failure partway through publishing is answered once, in words, and marked retryable', async () => {
  const { base, close } = await serve({
    savePublicPage: async () => { throw new Error('store unreachable'); }
  });
  try {
    const res = await fetch(`${base}/api/journey/j1/publish`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.match(body.error, /^Publishing did not finish/);
    assert.doesNotMatch(body.error, /store unreachable/, 'internal error text stays in the server log');
    assert.match(body.error, /Some pages may have changed/, 'a throw after writes start says so');
  } finally {
    await close();
  }
});

test('a failure while unpublishing is answered instead of left hanging', async () => {
  const { base, close } = await serve({
    loadJourney: async () => { throw new Error('store unreachable'); }
  });
  try {
    const res = await fetch(`${base}/api/journey/j1/unpublish`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.success, false);
    assert.match(body.error, /^Unpublishing did not finish/);
  } finally {
    await close();
  }
});

// ---- All or nothing (#26) ----
// Publish used to check and write one step at a time, so a refusal on the second page left the
// first live while the reply said "Not published". Every address is now planned first.

const DASHES = /—| – /;

function twoPages() {
  return {
    id: 'j1',
    nodes: [
      { id: 'page-a', type: 'landing-page', data: { type: 'landing-page', slug: 'offer-a', headline: 'A' } },
      { id: 'page-b', type: 'landing-page', data: { type: 'landing-page', slug: 'offer-b', headline: 'B' } }
    ],
    edges: []
  };
}

const refuseOfferB = async (slug) => slug === 'offer-b'
  ? { available: false, error: 'The page slug "offer-b" is already claimed by another store. Please choose a unique custom slug.' }
  : { available: true, cleanSlug: slug };

test('a taken address on the second page writes nothing', async () => {
  const r = await publish({ journey: twoPages(), validateSlugAvailability: refuseOfferB });
  assert.equal(r.status, 409);
  assert.equal(r.body.success, false);
  assert.deepEqual(r.saved, {});
  assert.deepEqual(r.cache, {}, 'publicPageCache is unchanged');
  assert.equal(r.counts.persist, 0);
  assert.equal(r.counts.saveJourney, 0);
  assert.deepEqual(r.body.nodeIds, ['page-b']);
  assert.ok(r.body.error.endsWith('No page was changed.'), r.body.error);
  assert.doesNotMatch(r.body.error, DASHES);
});

test('a refused publish leaves the loaded journey as it was', async () => {
  const journey = twoPages();
  const before = structuredClone(journey);
  const r = await publish({ journey, validateSlugAvailability: refuseOfferB });
  assert.equal(r.status, 409);
  assert.deepEqual(journey, before);
});

test('a successful publish saves new nodes and leaves the loaded object alone', async () => {
  const journey = twoPages();
  const before = structuredClone(journey);
  const r = await publish({ journey });
  assert.equal(r.status, 200);
  assert.deepEqual(journey, before);
  assert.equal(r.counts.saveJourney, 1);
  const savedNodes = r.journeySaves[0].nodes;
  for (const n of savedNodes) {
    assert.equal(n.data.published, true);
    assert.ok(n.data.publishedAt);
    assert.equal(n.data.publishedUrl, `/p/${n.data.slug}`);
  }
});

test('two steps with the same chosen address are refused before any write', async () => {
  const checked = [];
  const r = await publish({
    journey: {
      id: 'j1',
      nodes: [
        { id: 'up-1', type: 'upsell', data: { type: 'upsell', slug: 'offer' } },
        { id: 'page-a', type: 'landing-page', data: { type: 'landing-page', slug: 'offer' } }
      ],
      edges: []
    },
    validateSlugAvailability: async (slug) => { checked.push(slug); return { available: true, cleanSlug: slug }; }
  });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.nodeIds, ['page-a', 'up-1'], 'the step with a path field comes first');
  assert.deepEqual(r.saved, {});
  assert.equal(r.counts.persist, 0);
  assert.equal(r.counts.saveJourney, 0);
  assert.deepEqual(checked, [], 'no address is checked once a clash is found');
  assert.match(r.body.error, /\/p\/offer/);
  assert.ok(r.body.error.endsWith('No page was changed.'));
  assert.doesNotMatch(r.body.error, DASHES);
});

test('a generated address gives way to a chosen one in either order', async () => {
  const page = { id: 'hero', type: 'landing-page', data: { type: 'landing-page', headline: 'Hero' } };
  const upsell = { id: 'up-1', type: 'upsell', data: { type: 'upsell', slug: 'hero' } };
  for (const nodes of [[page, upsell], [upsell, page]]) {
    const r = await publish({ journey: { id: 'j1', nodes: structuredClone(nodes), edges: [] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.saved.hero.nodeId, 'up-1');
    const landing = r.body.publishedPages.find(p => p.nodeId === 'hero');
    assert.match(landing.url, /^\/p\/hero-[0-9a-f]{4}$/);
    assert.ok(r.saved[landing.slug], 'the reply points at a key that was saved');
    assert.equal(r.saved[landing.slug].nodeId, 'hero');
  }
});

test('a page another store claims during the check is not overwritten', async () => {
  const cache = {};
  const r = await publish({
    journey: twoPages(),
    publicPageCache: cache,
    validateSlugAvailability: async (slug) => {
      if (slug === 'offer-b') cache['offer-b'] = { userId: 'u2', slug: 'offer-b' };
      return { available: true, cleanSlug: slug };
    }
  });
  assert.equal(r.status, 409);
  assert.deepEqual(r.saved, {});
  assert.equal(cache['offer-b'].userId, 'u2');
  assert.equal(cache['offer-a'], undefined);
  assert.deepEqual(r.body.nodeIds, ['page-b']);
  assert.equal(r.counts.persist, 0);
  assert.equal(r.counts.saveJourney, 0);
  assert.ok(r.body.error.endsWith('No page was changed.'));
  assert.doesNotMatch(r.body.error, DASHES);
});

test('the split sends traffic to the address its branch page was published at', async () => {
  const journey = journeyWithSplit();
  delete journey.nodes[1].data.slug;
  const r = await publish({ journey });
  assert.equal(r.status, 200);
  assert.equal(r.saved['split:try-it'].data.branchAPageSlug, 'page-a');
  assert.equal(r.saved['split:try-it'].data.branchBPageSlug, 'offer-b');
  assert.ok(r.saved['page-a'] && r.saved['offer-b']);
});

test('a failure before any write says no page was changed', async () => {
  const r = await publish({
    journey: twoPages(),
    validateSlugAvailability: async () => { throw new Error('store unreachable'); }
  });
  assert.equal(r.status, 500);
  assert.equal(r.body.retryable, true);
  assert.equal(r.body.error, 'Publishing did not finish on the server. No page was changed, so try again.');
  assert.doesNotMatch(r.body.error, /Some pages may have changed/);
  assert.doesNotMatch(r.body.error, /store unreachable/);
  assert.deepEqual(r.saved, {});
});

test('shipped blueprints publish at the same addresses', async () => {
  const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
  const expected = {
    default: ['vip-consultation'],
    'single-product-flash-drop': ['product-flagship-drop'],
    'high-ticket-consultation': ['private-consultation-application'],
    'digital-product-membership': ['digital-mastery-pass'],
    'vip-lead-magnet-discount': ['vip-audit-checklist'],
    'oto-upsell-funnel-system': ['core-flagship-offer', 'vip-bundle-upsell', 'mini-essentials-downsell'],
    'turnkey-retention-ecosystem': ['radiance-ritual-flagship', 'overnight-recovery-elixir']
  };
  const maps = [['default', DEFAULT_LEAD_CAPTURE_PROJECT], ...ECOM_BLUEPRINTS.map(b => [b.id, b])];
  assert.deepEqual(maps.map(([name]) => name).sort(), Object.keys(expected).sort(), 'every blueprint is listed');
  for (const [name, map] of maps) {
    const r = await publish({ journey: { id: 'j1', nodes: structuredClone(map.nodes), edges: structuredClone(map.edges) } });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(Object.keys(r.saved).sort(), [...expected[name]].sort(), name);
  }
});

test('a page and a split may share a slug', async () => {
  const r = await publish({
    journey: {
      id: 'j1',
      nodes: [
        { id: 'split-1', type: 'ab-split', data: { type: 'ab-split', slug: 'offer' } },
        { id: 'page-a', type: 'landing-page', data: { type: 'landing-page', slug: 'offer' } }
      ],
      edges: [{ id: 'e1', source: 'split-1', sourceHandle: 'branch-a', target: 'page-a' }]
    }
  });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.saved).sort(), ['offer', 'split:offer']);
});

test('one custom domain on two landing pages still publishes', async () => {
  const journey = twoPages();
  for (const n of journey.nodes) n.data.customDomain = 'https://Shop.Example.com/landing';
  const r = await publish({ journey });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.saved).sort(), ['offer-a', 'offer-b']);
  assert.ok(r.body.publishedPages.every(p => p.customDomain === 'shop.example.com'));
});

// ---- Revisions, checked status and preview links (#23) ----
// The server now decides what is live. Each record carries its revision and a fingerprint of the
// step it was built from; GET /publication reads the records; the client compares fingerprints.

const {
  applyPublishResult,
  publicationRead,
  stepPublishStates
} = await import('./src/lib/publishState.ts');
const { unpublishRefusal } = await import('./src/lib/saveOutcome.ts');

function fullFunnel() {
  return {
    id: 'j1',
    nodes: [
      { id: 'split-1', type: 'ab-split', data: { type: 'ab-split', slug: 'try', splitRatio: 50 } },
      { id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'My Offer!', headline: 'One', metaPixelId: '123', variantB: { headline: 'One B', metaPixelId: '456' }, abTestingEnabled: true } },
      { id: 'page-2', type: 'landing-page', data: { type: 'landing-page', headline: 'Two' } },
      { id: 'up-1', type: 'upsell', data: { type: 'upsell', offerType: 'upsell', headline: 'Add this' } },
      { id: 'ty-1', type: 'thank-you', data: { type: 'thank-you', headline: 'Thanks' } },
      { id: 'form-1', type: 'lead-form', data: { type: 'lead-form', formTitle: 'Form' } }
    ],
    edges: [
      { id: 'e1', source: 'split-1', sourceHandle: 'branch-a', target: 'page-1' },
      { id: 'e2', source: 'split-1', sourceHandle: 'branch-b', target: 'page-2' },
      { id: 'e3', source: 'page-1', target: 'up-1' },
      { id: 'e4', source: 'up-1', target: 'ty-1' }
    ]
  };
}

// The default-slug landing page's first address is taken, so it takes a suffix.
function refuseFirstPage2() {
  let refused = false;
  return async (slug) => {
    if (slug === 'page-2' && !refused) { refused = true; return { available: false, error: 'taken' }; }
    return { available: true, cleanSlug: slug };
  };
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
});

async function readStatus(base) {
  const res = await fetch(`${base}/api/journey/j1/publication`);
  return publicationRead({ status: res.status, body: await res.json() });
}

const kinds = (states) => Object.fromEntries([...states].map(([id, s]) => [id, s.kind]));

test('every published step reads Published right after a publish, whatever the server did to its slug', async () => {
  const client = fullFunnel();
  const ctx = await serve({ journey: structuredClone(client), validateSlugAvailability: refuseFirstPage2() });
  try {
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.revision.number, 1);
    assert.ok(body.steps.some(s => s.nodeId === 'up-1' && s.slug === 'up-1-upsell'), 'the upsell is reported');
    assert.ok(body.publishedPages.every(p => p.revisionNumber === 1));
    assert.ok(body.steps.find(s => s.nodeId === 'page-2').slug.startsWith('page-2-'));

    const project = applyPublishResult(client, body.steps);
    const read = await readStatus(ctx.base);
    assert.equal(read.kind, 'read');
    assert.equal(read.report.liveRevision.number, 1);
    assert.deepEqual(kinds(stepPublishStates(project.nodes, project.edges, read)), {
      'split-1': 'published', 'page-1': 'published', 'page-2': 'published', 'up-1': 'published', 'ty-1': 'published'
    });

    const edited = {
      ...project,
      nodes: project.nodes.map(n => (n.id === 'ty-1' ? { ...n, data: { ...n.data, headline: 'Thank you!' } } : n))
    };
    assert.deepEqual(kinds(stepPublishStates(edited.nodes, edited.edges, read)), {
      'split-1': 'published', 'page-1': 'published', 'page-2': 'published', 'up-1': 'published', 'ty-1': 'changed'
    });

    // Re-pointing branch B changes only the split.
    const repointed = { ...project, edges: project.edges.map(e => (e.id === 'e2' ? { ...e, target: 'up-1' } : e)) };
    assert.equal(stepPublishStates(repointed.nodes, repointed.edges, read).get('split-1').kind, 'changed');
    assert.equal(stepPublishStates(repointed.nodes, repointed.edges, read).get('page-1').kind, 'published');
  } finally {
    await ctx.close();
  }
});

test('a second publish is revision 2, and the log keeps 1 as replaced', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    const first = await (await post(ctx.base, '/api/journey/j1/publish')).json();
    const second = await (await post(ctx.base, '/api/journey/j1/publish')).json();
    assert.equal(first.revision.number, 1);
    assert.equal(second.revision.number, 2);
    const read = await readStatus(ctx.base);
    assert.equal(read.report.liveRevision.number, 2);
    for (const [key, rec] of Object.entries(ctx.saved)) {
      assert.equal(rec.revisionId, second.revision.id, key);
      assert.equal(rec.revisionNumber, 2, key);
      assert.match(rec.contentFingerprint, /^c1:/, key);
    }
    assert.equal(ctx.saved['my-offer'].servedThankYou.nodeId, 'ty-1');
    const log = ctx.logs.store['u1:j1'];
    assert.deepEqual(log.entries.map(e => [e.number, e.status]), [[1, 'replaced'], [2, 'live']]);
    assert.equal(log.liveRevisionId, second.revision.id);
  } finally {
    await ctx.close();
  }
});

test('the status read skips a record another store owns under the same key', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.saved['my-offer'] = { ...ctx.saved['my-offer'], userId: 'u2' };
    const read = await readStatus(ctx.base);
    assert.equal(read.report.steps['page-1'], undefined);
    assert.ok(read.report.steps['page-2']);
  } finally {
    await ctx.close();
  }
});

test('a page published before fingerprints is found and reads "Live, changes unknown"', async () => {
  const journey = {
    id: 'j1',
    nodes: [{ id: 'up-9', type: 'upsell', data: { type: 'upsell', headline: 'Old' } }],
    edges: []
  };
  const ctx = await serve({
    journey,
    records: { 'up-9-upsell': { slug: 'up-9-upsell', journeyId: 'j1', userId: 'u1', nodeId: 'up-9', publishedAt: '2026-01-01T00:00:00.000Z', data: { headline: 'Old' } } }
  });
  try {
    const read = await readStatus(ctx.base);
    assert.deepEqual(read.report.steps['up-9'], { live: true, url: '/p/up-9-upsell', fingerprint: null, revisionNumber: null, publishedAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(stepPublishStates(journey.nodes, [], read).get('up-9').kind, 'untracked');
  } finally {
    await ctx.close();
  }
});

test('two publishes at once get different revision numbers', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    const answers = await Promise.all([post(ctx.base, '/api/journey/j1/publish'), post(ctx.base, '/api/journey/j1/publish')]);
    const bodies = await Promise.all(answers.map(r => r.json()));
    assert.deepEqual(bodies.map(b => b.revision.number).sort(), [1, 2]);
  } finally {
    await ctx.close();
  }
});

test('a publish history that cannot be read refuses the publish before any write', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  ctx.logs.failRead = true;
  try {
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.match(body.error, /publish history could not be read/);
    assert.doesNotMatch(body.error, DASHES);
    assert.equal(ctx.counts.savePublicPage, 0);
    assert.equal(ctx.counts.saveJourney, 0);
    assert.equal(ctx.counts.savePublishLog, 0);
    assert.deepEqual(ctx.saved, {});
  } finally {
    await ctx.close();
  }
});

test('a publish that stops partway leaves a "started" entry and the next one takes the next number', async () => {
  let calls = 0;
  const ctx = await serve({
    journey: fullFunnel(),
    savePublicPage: async () => { calls += 1; if (calls === 2) throw new Error('disk full'); }
  });
  try {
    const res = await post(ctx.base, '/api/journey/j1/publish');
    assert.equal(res.status, 500);
    const log = ctx.logs.store['u1:j1'];
    assert.deepEqual(log.entries.map(e => [e.number, e.status]), [[1, 'started']]);
    assert.ok(log.entries[0].pages.length > 0, 'the planned pages are on the entry');
  } finally {
    await ctx.close();
  }
  const again = await serve({ journey: fullFunnel(), initialLog: ctx.logs.store });
  try {
    const body = await (await post(again.base, '/api/journey/j1/publish')).json();
    assert.equal(body.revision.number, 2);
  } finally {
    await again.close();
  }
});

test('unpublish takes down the live revision even after a slug edit, and default-slug upsells', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    // The page's path was edited after it went live and the upsell never had one.
    ctx.store.journey = {
      ...ctx.store.journey,
      nodes: ctx.store.journey.nodes.map(n => {
        if (n.id === 'page-1') return { ...n, data: { ...n.data, slug: 'renamed' } };
        if (n.id === 'up-1') return { ...n, data: { ...n.data, slug: undefined } };
        return n;
      })
    };
    const res = await post(ctx.base, '/api/journey/j1/unpublish');
    assert.equal(res.status, 200);
    assert.ok(ctx.removed.includes('my-offer'));
    assert.ok(ctx.removed.includes('up-1-upsell'));
    assert.deepEqual(Object.keys(ctx.saved), []);
    const read = await readStatus(ctx.base);
    assert.deepEqual(read.report.steps, {});
    assert.equal(read.report.liveRevision, null);
    assert.ok(ctx.store.journey.nodes.filter(n => n.type !== 'thank-you' && n.type !== 'lead-form').every(n => n.data.published === false));
  } finally {
    await ctx.close();
  }
});

test('unpublish leaves another store\'s page alone and answers a retryable failure when the hub refuses', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.saved['try'] = { slug: 'try', userId: 'u2', journeyId: 'jx', nodeId: 'z' };
    const removePublicPage = async (key) => { ctx.removed.push(key); return key !== 'my-offer'; };
    const refusing = await serve({ journey: ctx.store.journey, records: ctx.saved, initialLog: ctx.logs.store, removePublicPage });
    try {
      const res = await post(refusing.base, '/api/journey/j1/unpublish');
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.retryable, true);
      assert.equal(unpublishRefusal({ status: res.status, body }).message, 'Still live. Some pages could not be taken offline. Try again.');
      assert.equal(refusing.counts.saveJourney, 0, 'the journey still says live');
      assert.ok(refusing.logs.store['u1:j1'].liveRevisionId, 'the log keeps its live revision for the retry');
      assert.ok(!ctx.removed.includes('try'), 'a page of another store is never removed');
    } finally {
      await refusing.close();
    }
  } finally {
    await ctx.close();
  }
});

test('a preview link shows the saved copy for one hour, with no tracking and no writes', async () => {
  const ctx = await serve({ journey: fullFunnel(), realStoreDomain: (cfg) => cfg?.storeDomain || '' });
  try {
    const res = await post(ctx.base, '/api/journey/j1/preview', { nodeId: 'page-1', workspaceId: 'ws-9' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.match(body.url, /^\/p\/preview\/[A-Za-z0-9_-]{32}$/);
    assert.equal(Date.parse(body.expiresAt), ctx.clock.t + 3_600_000);
    assert.deepEqual(ctx.workspaceCalls, [['u1', 'ws-9']]);

    // A later edit to the saved journey does not change a link already handed out.
    ctx.store.journey = { ...ctx.store.journey, nodes: ctx.store.journey.nodes.map(n => (n.id === 'page-1' ? { ...n, data: { ...n.data, headline: 'Changed' } } : n)) };

    const page = await fetch(`${ctx.base}${body.url}?variant=b`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<h1>One<\/h1>/);
    assert.match(html, /pixels:\|\|\|</, 'every pixel id is blank, variant B too');
    assert.match(html, /store:real-shop\.myshopify\.com/, 'the workspace named in the body supplies the store');
    assert.match(html, /role="note"[^>]*>Preview\. This page is not live, and it sends no data\. Store buttons still open your real checkout\. This link works for 60 more minutes\./);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.doesNotMatch(html, DASHES);
    const last = ctx.rendered.at(-1);
    assert.equal(last.res, null, 'the renderer cannot set a cookie');
    assert.equal(last.req.query.var, 'b');
    assert.equal(page.headers.get('content-security-policy'), "connect-src 'none'; form-action 'none'");
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('set-cookie'), null);

    await fetch(`${ctx.base}${body.url}`);
    assert.equal(ctx.rendered.at(-1).req.query.var, 'a');

    assert.equal(ctx.counts.savePublicPage, 0);
    assert.equal(ctx.counts.saveJourney, 0);
    assert.equal(ctx.counts.savePublishLog, 0);
    assert.deepEqual(ctx.saved, {});

    ctx.clock.t += 3_600_000;
    const expired = await fetch(`${ctx.base}${body.url}`);
    const expiredHtml = await expired.text();
    assert.equal(expired.status, 410);
    assert.match(expiredHtml, /This preview link has expired/);
    assert.equal(expired.headers.get('content-security-policy'), "connect-src 'none'; form-action 'none'");
    const unknown = await fetch(`${ctx.base}/p/preview/${'A'.repeat(32)}`);
    assert.equal(unknown.status, 410);
    assert.equal(await unknown.text(), expiredHtml, 'an unknown token gets the same bytes');
    const malformed = await fetch(`${ctx.base}/p/preview/short`);
    assert.equal(malformed.status, 410);
    assert.equal(await malformed.text(), expiredHtml);
    assert.doesNotMatch(expiredHtml, new RegExp(body.url.split('/').pop()));
  } finally {
    await ctx.close();
  }
});

test('an upsell preview renders the upsell page', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    const body = await (await post(ctx.base, '/api/journey/j1/preview', { nodeId: 'up-1' })).json();
    const html = await (await fetch(`${ctx.base}${body.url}`)).text();
    assert.match(html, /<h1>Add this<\/h1>/);
    assert.equal(ctx.rendered.at(-1).isDownsell, false);
    assert.equal(ctx.rendered.at(-1).record.slug, 'up-1-upsell');
  } finally {
    await ctx.close();
  }
});

test('a preview is only for a landing or upsell step of the saved journey', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    const form = await post(ctx.base, '/api/journey/j1/preview', { nodeId: 'form-1' });
    assert.equal(form.status, 400);
    assert.equal((await form.json()).error, 'Previews are for landing pages and upsell pages.');
    const missing = await post(ctx.base, '/api/journey/j1/preview', { nodeId: 'nope' });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'That step is not in the saved journey. Save, then try again.');
  } finally {
    await ctx.close();
  }
});

// ---- A failed ownership read is not "no record" (#23 review) ----
// loadPublicPage turns a hub read that fails into the local cache's answer, and with nothing
// cached that is null. Unpublish read null as "nobody owns this key" and removed the hub doc, so a
// hiccup could take down another store's live page. The status read called the same null
// "Not published".

const publicRoutes = await import('./server/routes/publicRoutes.mjs');

function hubPages(pages, { failing = false } = {}) {
  const removed = [];
  const puts = [];
  const hub = {
    store: {
      docs: {
        get: async (name) => {
          if (failing) return { error: 'unavailable', status: 503 };
          const hit = Object.entries(pages).find(([slug]) => publicRoutes.pubDocName(slug) === name);
          return hit ? { name, document: hit[1] } : { error: 'No such document.', status: 404 };
        },
        put: async (name) => { puts.push(name); return {}; },
        list: async () => ({ documents: [] }),
        batchGet: async () => ({ documents: [] }),
        remove: async (name) => { removed.push(name); return { name, deleted: true }; }
      }
    }
  };
  const cache = {};
  publicRoutes.setPublicContext({
    hub,
    hubReady: true,
    publicPageCache: cache,
    persistPublicPages() {},
    reloadDomainRegistry() {},
    reloadPublicPageCache() { return cache; },
    domainRegistryCache: {}
  });
  return { removed, puts, cache };
}

const saleJourney = () => ({
  id: 'j1',
  nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'sale', headline: 'Sale' } }],
  edges: []
});

const realPageStore = () => ({
  loadPublicPage: publicRoutes.loadPublicPage,
  readPublicPage: publicRoutes.readPublicPage,
  removePublicPage: publicRoutes.removePublicPage
});

test("unpublish during a failed hub read removes nothing, not even another store's page on the same slug", async () => {
  // Store B owns /p/sale. User A's step is named "sale" too, because A's publish was refused.
  const { removed } = hubPages({ sale: { slug: 'sale', userId: 'u2', journeyId: 'jb', nodeId: 'b1' } }, { failing: true });
  const ctx = await serve({ journey: saleJourney(), ...realPageStore() });
  try {
    const res = await post(ctx.base, '/api/journey/j1/unpublish');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.retryable, true);
    assert.equal(unpublishRefusal({ status: res.status, body }).message, 'Still live. Some pages could not be taken offline. Try again.');
    assert.deepEqual(removed, [], 'no hub doc was removed while its owner was unknown');
    assert.equal(ctx.counts.saveJourney, 0);
  } finally {
    await ctx.close();
  }
});

test("once the hub answers, unpublish skips the other store's page and succeeds", async () => {
  const { removed } = hubPages({ sale: { slug: 'sale', userId: 'u2', journeyId: 'jb', nodeId: 'b1' } });
  const ctx = await serve({ journey: saleJourney(), ...realPageStore() });
  try {
    const res = await post(ctx.base, '/api/journey/j1/unpublish');
    assert.equal(res.status, 200);
    assert.deepEqual(removed, []);
  } finally {
    await ctx.close();
  }
});

test('the status read answers unavailable, never "Not published", when a record cannot be read', async () => {
  hubPages({ sale: { slug: 'sale', userId: 'u1', journeyId: 'j1', nodeId: 'page-1', publishedAt: '2026-09-01T10:00:00.000Z' } }, { failing: true });
  const journey = saleJourney();
  const ctx = await serve({ journey, ...realPageStore() });
  try {
    const res = await fetch(`${ctx.base}/api/journey/j1/publication`);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.doesNotMatch(body.error, DASHES);
    const read = publicationRead({ status: res.status, body });
    assert.equal(read.kind, 'unavailable');
    assert.deepEqual(kinds(stepPublishStates(journey.nodes, [], read)), { 'page-1': 'unknown' });
  } finally {
    await ctx.close();
  }
});

test('the status read still answers from a cached record while the hub is down', async () => {
  const { cache } = hubPages({}, { failing: true });
  cache.sale = { slug: 'sale', userId: 'u1', journeyId: 'j1', nodeId: 'page-1', publishedAt: '2026-09-01T10:00:00.000Z' };
  const ctx = await serve({ journey: saleJourney(), ...realPageStore(), publicPageCache: cache });
  try {
    const read = await readStatus(ctx.base);
    assert.equal(read.kind, 'read');
    assert.equal(read.report.steps['page-1'].url, '/p/sale');
  } finally {
    await ctx.close();
  }
});

// ── Old addresses ──
// A republish used to leave the address of an earlier revision live once its Page URL Path was
// edited or its step deleted, and unpublish read only the live revision's pages, so it answered
// "Funnel unpublished successfully." while /p/<old path> still served the page.

const oneOffer = (slug) => ({
  id: 'j1',
  nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug, headline: 'Offer' } }],
  edges: []
});

const renamed = (journey, slug) => ({
  ...journey,
  nodes: journey.nodes.map(n => (n.id === 'page-1' ? { ...n, data: { ...n.data, slug } } : n))
});

test('a republish after a Page URL Path edit takes the old address down', async () => {
  const ctx = await serve({ journey: oneOffer('old-offer') });
  try {
    assert.equal((await post(ctx.base, '/api/journey/j1/publish')).status, 200);
    ctx.store.journey = renamed(ctx.store.journey, 'new-offer');
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.stillLive, []);
    assert.equal(body.message, 'Published 1 landing page(s) successfully.');
    assert.deepEqual(Object.keys(ctx.saved), ['new-offer']);
    assert.ok(ctx.removed.includes('old-offer'));
  } finally {
    await ctx.close();
  }
});

test('a republish after a step is deleted takes that step\'s address down', async () => {
  const ctx = await serve({ journey: fullFunnel() });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    assert.ok(ctx.saved['up-1-upsell']);
    ctx.store.journey = { ...ctx.store.journey, nodes: ctx.store.journey.nodes.filter(n => n.id !== 'up-1'), edges: ctx.store.journey.edges.filter(e => e.source !== 'up-1' && e.target !== 'up-1') };
    const body = await (await post(ctx.base, '/api/journey/j1/publish')).json();
    assert.equal(body.success, true);
    assert.equal(ctx.saved['up-1-upsell'], undefined);
    assert.ok(ctx.removed.includes('up-1-upsell'));
  } finally {
    await ctx.close();
  }
});

test('an old address the hub will not remove is reported, and unpublish still takes it down later', async () => {
  const ctx = await serve({
    journey: oneOffer('old-offer'),
    removePublicPage: async (key) => { ctx.removed.push(key); return false; }
  });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.store.journey = renamed(ctx.store.journey, 'new-offer');
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 200, 'the new address is live, so the publish itself succeeded');
    assert.deepEqual(body.stillLive, ['/p/old-offer']);
    assert.match(body.message, /old address may still be live: \/p\/old-offer/);
    assert.doesNotMatch(body.message, DASHES);
    assert.ok(ctx.saved['old-offer'], 'the stub kept the record it refused to remove');
  } finally {
    await ctx.close();
  }
  // The old path is on no step any more; only the replaced revision in the log still names it.
  const later = await serve({ journey: ctx.store.journey, records: ctx.saved, initialLog: ctx.logs.store });
  try {
    const log = later.logs.store['u1:j1'];
    assert.deepEqual(log.entries.map(e => [e.number, e.status]), [[1, 'replaced'], [2, 'live']]);
    const res = await post(later.base, '/api/journey/j1/unpublish');
    assert.equal(res.status, 200);
    assert.ok(later.removed.includes('old-offer'));
    assert.ok(later.removed.includes('new-offer'));
    assert.deepEqual(Object.keys(later.saved), []);
    const read = await readStatus(later.base);
    assert.deepEqual(read.report.steps, {});
  } finally {
    await later.close();
  }
});

test('a republish never takes down another store\'s or another journey\'s page at an old address', async () => {
  const ctx = await serve({ journey: oneOffer('old-offer') });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.store.journey = renamed(ctx.store.journey, 'new-offer');
    // After this journey moved off it, the address went to another store.
    ctx.saved['old-offer'] = { slug: 'old-offer', userId: 'u2', journeyId: 'jx', nodeId: 'z' };
    const body = await (await post(ctx.base, '/api/journey/j1/publish')).json();
    assert.deepEqual(body.stillLive, []);
    assert.ok(!ctx.removed.includes('old-offer'));
    assert.equal(ctx.saved['old-offer'].userId, 'u2');
    // The same user's other journey took it.
    ctx.saved['old-offer'] = { slug: 'old-offer', userId: 'u1', journeyId: 'j2', nodeId: 'z' };
    await post(ctx.base, '/api/journey/j1/publish');
    assert.ok(!ctx.removed.includes('old-offer'));
    assert.equal(ctx.saved['old-offer'].journeyId, 'j2');
  } finally {
    await ctx.close();
  }
});

test('unpublish reads the pages of revisions trimmed out of the log', async () => {
  const log = {
    lastNumber: 60,
    liveRevisionId: 'r60',
    entries: [{ id: 'r60', number: 60, startedAt: 't', finishedAt: 't', status: 'live', pages: [{ nodeId: 'page-1', type: 'landing-page', key: 'sale', url: '/p/sale' }] }],
    retiredPages: [{ nodeId: 'page-1', type: 'landing-page', key: 'ancient', url: '/p/ancient' }]
  };
  const ctx = await serve({
    journey: saleJourney(),
    initialLog: { 'u1:j1': log },
    records: {
      sale: { slug: 'sale', userId: 'u1', journeyId: 'j1', nodeId: 'page-1' },
      ancient: { slug: 'ancient', userId: 'u1', journeyId: 'j1', nodeId: 'page-1' }
    }
  });
  try {
    const res = await post(ctx.base, '/api/journey/j1/unpublish');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(ctx.saved), []);
    assert.equal('retiredPages' in ctx.logs.store['u1:j1'], false);
  } finally {
    await ctx.close();
  }
});

test('unpublish with a publish history it cannot read changes nothing and says so', async () => {
  const ctx = await serve({ journey: oneOffer('old-offer') });
  try {
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.store.journey = renamed(ctx.store.journey, 'new-offer');
    await post(ctx.base, '/api/journey/j1/publish');
    ctx.logs.failRead = true;
    const saves = ctx.counts.saveJourney;
    const removed = ctx.removed.length;
    const res = await post(ctx.base, '/api/journey/j1/unpublish');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.doesNotMatch(body.error, DASHES);
    assert.equal(unpublishRefusal({ status: res.status, body }).retryable, true);
    assert.equal(ctx.removed.length, removed, 'nothing was taken down');
    assert.equal(ctx.counts.saveJourney, saves, 'the journey still says live');
    assert.ok(ctx.saved['new-offer']);
  } finally {
    await ctx.close();
  }
});

// ── An address whose owner could not be read ──
// validateSlugAvailability read through loadPublicPage, which turns a failed hub read into null
// when nothing is cached (another instance wrote the page, or boot rehydration stopped short). So
// a timeout or a 409 on another store's pubpage doc read as "free", and publish wrote over it.

const { publishRefusal } = await import('./src/lib/saveOutcome.ts');

const realAddressCheck = () => ({
  ...realPageStore(),
  validateSlugAvailability: publicRoutes.validateSlugAvailability,
  savePublicPage: publicRoutes.savePublicPage
});

test("publish refuses with a retryable 503 and writes nothing when another store's address cannot be read", async () => {
  const { puts } = hubPages({ sale: { slug: 'sale', userId: 'u2', journeyId: 'jb', nodeId: 'b1', data: { headline: 'B live' } } }, { failing: true });
  const ctx = await serve({ journey: saleJourney(), ...realAddressCheck() });
  try {
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '30');
    assert.equal(body.success, false);
    assert.equal(body.retryable, true);
    assert.deepEqual(body.nodeIds, ['page-1']);
    assert.equal(body.error, 'We could not check whether the address "sale" is free. No page was changed.');
    assert.doesNotMatch(body.error, DASHES);
    assert.equal(publishRefusal({ status: res.status, body }).retryable, true);
    assert.deepEqual(puts, [], 'no hub doc was written while the owner was unknown');
    assert.deepEqual(ctx.cache, {});
    assert.equal(ctx.counts.saveJourney, 0);
    assert.equal(ctx.counts.savePublishLog, 0);
  } finally {
    await ctx.close();
  }
});

test('a generated address whose owner cannot be read is not swapped for a suffixed one', async () => {
  // The unread record may be this user's own live page; a suffix would move it to a new URL.
  const { puts } = hubPages({}, { failing: true });
  const journey = { id: 'j1', nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', headline: 'Sale' } }], edges: [] };
  const ctx = await serve({ journey, ...realAddressCheck() });
  try {
    const res = await post(ctx.base, '/api/journey/j1/publish');
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.retryable, true);
    assert.match(body.error, /"page-1"/);
    assert.deepEqual(puts, []);
  } finally {
    await ctx.close();
  }
});

test("once the hub answers, publish refuses the other store's address and publishes over the caller's own", async () => {
  hubPages({ sale: { slug: 'sale', userId: 'u2', journeyId: 'jb', nodeId: 'b1' } });
  const taken = await serve({ journey: saleJourney(), ...realAddressCheck() });
  try {
    const res = await post(taken.base, '/api/journey/j1/publish');
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already claimed by another store/);
  } finally {
    await taken.close();
  }

  const { puts } = hubPages({ sale: { slug: 'sale', userId: 'u1', journeyId: 'j1', nodeId: 'page-1' } });
  const own = await serve({ journey: saleJourney(), ...realAddressCheck() });
  try {
    const res = await post(own.base, '/api/journey/j1/publish');
    assert.equal(res.status, 200);
    assert.ok(puts.includes(publicRoutes.pubDocName('sale')));
  } finally {
    await own.close();
  }
});

test('check-slug answers a retryable 503, never "available", when the owner cannot be read', async () => {
  hubPages({ sale: { slug: 'sale', userId: 'u2' } }, { failing: true });
  const down = await serve({ ...realAddressCheck() });
  try {
    const res = await fetch(`${down.base}/api/journey/check-slug?slug=sale`);
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '30');
    assert.deepEqual(body, { success: false, available: false, retryable: true, error: 'We could not check whether the address "sale" is free.' });
  } finally {
    await down.close();
  }

  hubPages({ sale: { slug: 'sale', userId: 'u2' } });
  const up = await serve({ ...realAddressCheck() });
  try {
    const res = await fetch(`${up.base}/api/journey/check-slug?slug=sale`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).available, false);
  } finally {
    await up.close();
  }
});

test('a cached record still answers the address check while the hub is down', async () => {
  const { cache } = hubPages({}, { failing: true });
  cache.sale = { slug: 'sale', userId: 'u2' };
  assert.equal((await publicRoutes.validateSlugAvailability('sale', 'u1')).available, false);
  assert.equal((await publicRoutes.validateSlugAvailability('sale', 'u1')).retryable, undefined);
  cache.sale = { slug: 'sale', userId: 'u1' };
  assert.deepEqual(await publicRoutes.validateSlugAvailability('sale', 'u1'), { available: true, cleanSlug: 'sale' });
});
