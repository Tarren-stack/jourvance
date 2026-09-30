import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setupDomainRoutes } from './server/routes/domainRoutes.mjs';
import * as pub from './server/routes/publicRoutes.mjs';
import { chosenAddressKeys, withFreshAddresses } from './src/lib/blueprintAddresses.ts';
import { ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';

// A second journey of the same user used to publish straight over the first journey's live page
// when both asked for one address: the address check refused only ANOTHER user's record. The
// shipped blueprints carry fixed paths and "Create as New Journey" keeps them, so two journeys
// from one blueprint met at one /p/ address, the second publish answered success and the first
// journey flipped to Not published with no warning. These tests drive the real journey routes
// and the real address check (publicRoutes.mjs) over a stubbed hub doc store. Nothing loads .env.

const journeyOf = (id, { name = '', slug = 'product-flagship-drop', headline = id, nodeId = 'lp-1' } = {}) => ({
  id,
  name,
  nodes: [{ id: nodeId, type: 'landing-page', data: { ...(slug ? { slug } : {}), headline } }],
  edges: []
});

async function serve() {
  const docs = new Map();
  const hub = { store: { docs: {
    get: async (n) => (docs.has(n) ? { name: n, document: structuredClone(docs.get(n)) } : { error: 'No such document.', status: 404 }),
    put: async (n, d) => { docs.set(n, structuredClone(d)); return { name: n }; },
    remove: async (n) => ({ name: n, deleted: docs.delete(n) }),
    list: async () => ({ documents: [...docs.keys()].map(name => ({ name })) }),
    batchGet: async (names) => ({ documents: names.map(n => (docs.has(n) ? { name: n, found: true, document: docs.get(n) } : { name: n, found: false })) })
  } } };
  const publicPageCache = {};
  const domainRegistryCache = {};
  const journeys = {};
  const logs = {};
  const hooks = { afterLogSave: null, failJourneyRead: new Set() };
  const counts = { savePublishLog: 0 };
  const ctxPub = {
    hub, hubReady: true, publicPageCache, domainRegistryCache,
    persistPublicPages() {}, reloadDomainRegistry() {}, reloadPublicPageCache() { return publicPageCache; },
    realStoreDomain: (s) => String(s?.storeDomain || ''),
    recordEvent() {}, loadEvents: () => [], loadOrders: () => [], loadDrips: () => ({ sequences: [], enrollments: [] })
  };
  pub.setPublicContext(ctxPub);
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async (uid, id) => journeys[`${uid}:${id}`] || null,
    readJourney: async (uid, id) => (hooks.failJourneyRead.has(id) ? { ok: false } : { ok: true, journey: journeys[`${uid}:${id}`] || null }),
    saveJourney: async (uid, id, j) => { journeys[`${uid}:${id}`] = { ...j, id }; return { durable: true }; },
    loadWorkspace: async () => null,
    realStoreDomain: () => '',
    validateSlugAvailability: pub.validateSlugAvailability,
    reloadDomainRegistry() {},
    domainRegistryCache,
    savePublicPage: pub.savePublicPage,
    removePublicPage: pub.removePublicPage,
    persistPublicPages() {},
    publicPageCache,
    loadPublishLog: async (uid, id) => ({ ok: true, log: logs[`${uid}:${id}`] || null }),
    savePublishLog: async (uid, id, log) => {
      counts.savePublishLog += 1;
      logs[`${uid}:${id}`] = structuredClone(log);
      if (hooks.afterLogSave) hooks.afterLogSave();
      return { durable: true };
    },
    loadPublicPage: pub.loadPublicPage,
    readPublicPage: pub.readPublicPage,
    renderPublicFunnelHtml: pub.renderPublicFunnelHtml,
    renderPublicUpsellHtml: pub.renderPublicUpsellHtml
  });
  // The DNS answer is stubbed: every domain verifies for the asking user, as a real CNAME would.
  setupDomainRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    domainRegistryCache,
    reloadDomainRegistry() {},
    verifyDomainOwnership: async (domain, uid) => {
      domainRegistryCache[domain] = { domain, userId: uid, verified: true, method: 'cname' };
      return { success: true, verified: true, domain };
    },
    getDomainVerificationToken: () => 'jrv_test',
    publicPageCache,
    persistPublicPages() {}
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const put = (j) => { journeys[`u1:${j.id}`] = j; };
  return {
    call, put, hub, docs, publicPageCache, domainRegistryCache, journeys, hooks, counts,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

test('a second journey asking for the address the first journey is live at is refused, and the first page stays', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1', { name: 'Spring drop', headline: 'First headline' }));
    s.put(journeyOf('j2', { name: 'Copy', headline: 'Second headline' }));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);

    const logSavesBefore = s.counts.savePublishLog;
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 409);
    assert.equal(r.body.success, false);
    assert.equal(
      r.body.error,
      'The address /p/product-flagship-drop is live on your journey "Spring drop". Change the Page URL Path, then publish again. No page was changed.'
    );
    assert.deepEqual(r.body.nodeIds, ['lp-1']);
    assert.doesNotMatch(r.body.error, /—| – /);

    // Nothing was written: the record, the first journey's status and the second journey's log.
    assert.equal(s.publicPageCache['product-flagship-drop'].journeyId, 'j1');
    assert.equal(s.publicPageCache['product-flagship-drop'].data.headline, 'First headline');
    assert.equal(s.counts.savePublishLog, logSavesBefore, 'a refusal reserves no revision');
    const status = await s.call('GET', '/api/journey/j1/publication');
    assert.equal(status.body.steps['lp-1'].live, true);
    assert.equal(s.journeys['u1:j2'].nodes[0].data.published, undefined);
  } finally {
    await s.close();
  }
});

test('the refusal also holds when the record is only in the hub, and names no journey when it has no name', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1'));
    s.put(journeyOf('j2'));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    delete s.publicPageCache['product-flagship-drop']; // a fresh server: the record lives in the hub
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 409);
    assert.match(r.body.error, /^The address \/p\/product-flagship-drop is live on another of your journeys\. /);
    const doc = [...s.docs.values()].find(d => d.slug === 'product-flagship-drop');
    assert.equal(doc.journeyId, 'j1');
  } finally {
    await s.close();
  }
});

test('a generated address another journey holds takes a suffix instead of replacing that page', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1', { slug: '', headline: 'First' }));
    s.put(journeyOf('j2', { slug: '', headline: 'Second' }));
    const first = await s.call('POST', '/api/journey/j1/publish');
    assert.equal(first.status, 200);
    assert.equal(first.body.publishedPages[0].url, '/p/lp-1');
    const second = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(second.status, 200);
    assert.match(second.body.publishedPages[0].url, /^\/p\/lp-1-[0-9a-f]{4}$/);
    assert.equal(s.publicPageCache['lp-1'].journeyId, 'j1');
    assert.equal(s.publicPageCache['lp-1'].data.headline, 'First');
  } finally {
    await s.close();
  }
});

test('republishing the journey that owns the address still replaces its own page', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1', { headline: 'Before' }));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    s.journeys['u1:j1'].nodes[0].data.headline = 'After';
    const r = await s.call('POST', '/api/journey/j1/publish');
    assert.equal(r.status, 200);
    assert.equal(s.publicPageCache['product-flagship-drop'].data.headline, 'After');
  } finally {
    await s.close();
  }
});

test('a page left by a journey that no longer exists, or published before records named a journey, may be replaced as before', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1', { headline: 'Old' }));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    delete s.journeys['u1:j1'];
    s.put(journeyOf('j2', { headline: 'New' }));
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 200, 'the last look does not refuse an address the plan found free');
    assert.equal(s.publicPageCache['product-flagship-drop'].journeyId, 'j2');

    s.publicPageCache['legacy-path'] = { slug: 'legacy-path', userId: 'u1', data: { headline: 'Legacy' } };
    s.put(journeyOf('j3', { slug: 'legacy-path', headline: 'Now' }));
    assert.equal((await s.call('POST', '/api/journey/j3/publish')).status, 200);
    assert.equal(s.publicPageCache['legacy-path'].journeyId, 'j3');
  } finally {
    await s.close();
  }
});

test('when the journey holding the address cannot be read, nothing is written and trying again is offered', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1', { headline: 'First' }));
    s.put(journeyOf('j2', { headline: 'Second' }));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    s.hooks.failJourneyRead.add('j1');
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 503);
    assert.equal(r.body.retryable, true);
    assert.match(r.body.error, /No page was changed\.$/);
    assert.equal(s.publicPageCache['product-flagship-drop'].journeyId, 'j1');
  } finally {
    await s.close();
  }
});

test('the last look refuses an address another of the same user\'s journeys published while this one was planning', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j2', { headline: 'Second' }));
    const other = { slug: 'product-flagship-drop', userId: 'u1', journeyId: 'j1', nodeId: 'lp-1', data: { headline: 'First' } };
    s.hooks.afterLogSave = () => { s.publicPageCache['product-flagship-drop'] = other; s.hooks.afterLogSave = null; };
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 409);
    assert.equal(
      r.body.error,
      'The address /p/product-flagship-drop was just published by another of your journeys. Change the Page URL Path, then publish again. No page was changed.'
    );
    assert.equal(s.publicPageCache['product-flagship-drop'], other);
  } finally {
    await s.close();
  }
});

test('the advisory slug check reads another journey\'s address as taken only when it is told which journey asks', async () => {
  const s = await serve();
  try {
    s.put(journeyOf('j1'));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    const asked = await s.call('GET', '/api/journey/check-slug?slug=product-flagship-drop&journeyId=j2');
    assert.equal(asked.status, 409);
    assert.match(asked.body.error, /live on another of your journeys/);
    const own = await s.call('GET', '/api/journey/check-slug?slug=product-flagship-drop&journeyId=j1');
    assert.equal(own.status, 200);
    const unnamed = await s.call('GET', '/api/journey/check-slug?slug=product-flagship-drop');
    assert.equal(unnamed.status, 200);
    // Asked without a journey, the answer still says whose page is live there.
    assert.equal(unnamed.body.liveOnJourneyId, 'j1');
    assert.equal((await s.call('GET', '/api/journey/check-slug?slug=nobody-has-this')).body.liveOnJourneyId, undefined);
  } finally {
    await s.close();
  }
});

test('a split another journey is live at is refused under its own /p/split/ address', async () => {
  const s = await serve();
  try {
    s.publicPageCache['split:try-it'] = { type: 'ab-split', slug: 'try-it', userId: 'u1', journeyId: 'j1', data: {} };
    s.put({ id: 'j1', name: 'First', nodes: [], edges: [] });
    const r = await pub.validateSlugAvailability('try-it', 'u1', { type: 'ab-split', journeyId: 'j2' });
    assert.equal(r.available, false);
    assert.equal(r.otherJourneyId, 'j1');
    assert.match(r.error, /^The address \/p\/split\/try-it is live on another of your journeys\./);
    const same = await pub.validateSlugAvailability('try-it', 'u1', { type: 'ab-split', journeyId: 'j1' });
    assert.equal(same.available, true);
  } finally {
    await s.close();
  }
});

// ---- R26: blueprint addresses and custom domains ----

const domainJourney = (id, slug, headline) => ({
  id,
  name: `Journey ${id}`,
  nodes: [{ id: 'lp-1', type: 'landing-page', data: { slug, headline, customDomain: 'shop.example.com' } }],
  edges: []
});

test('two journeys made from one blueprint with "Create as New Journey" both publish, each at its own address', async () => {
  const s = await serve();
  try {
    const bp = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.data?.slug === 'product-flagship-drop'));
    let n = 0;
    const suffix = () => `s${++n}`.padEnd(4, '0');
    const first = { id: 'j1', name: 'First', nodes: await withFreshAddresses(bp.nodes, { taken: new Set(), suffix }), edges: bp.edges };
    const second = { id: 'j2', name: 'Second', nodes: await withFreshAddresses(bp.nodes, { taken: chosenAddressKeys([first]), suffix }), edges: bp.edges };
    const landing = (j) => j.nodes.find(x => x.type === 'landing-page').data.slug;
    assert.equal(landing(first), 'product-flagship-drop', 'the first journey keeps the blueprint path');
    assert.equal(landing(second), 'product-flagship-drop-s100');
    s.put(first);
    s.put(second);
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 200, r.body?.error);
    assert.equal(s.publicPageCache['product-flagship-drop'].journeyId, 'j1');
    assert.equal(s.publicPageCache['product-flagship-drop-s100'].journeyId, 'j2');
  } finally {
    await s.close();
  }
});

test('a verified custom domain live on one journey is not taken over by another journey of the same user', async () => {
  const s = await serve();
  try {
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u1', verified: true };
    s.put(domainJourney('j1', 'first-offer', 'First headline'));
    s.put(domainJourney('j2', 'second-offer', 'Second headline'));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');

    const asked = await s.call('GET', '/api/journey/check-slug?slug=second-offer&customDomain=shop.example.com&journeyId=j2');
    assert.equal(asked.status, 409);
    assert.match(asked.body.error, /^The custom domain shop\.example\.com is live on another of your journeys\./);

    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 409);
    assert.equal(
      r.body.error,
      'The custom domain shop.example.com is live on your journey "Journey j1". Remove it from this page or take that journey offline, then publish again. No page was changed.'
    );
    assert.doesNotMatch(r.body.error, /—| – /);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');
    assert.equal(s.publicPageCache['second-offer'], undefined, 'nothing of the second journey was written');
    assert.equal((await pub.loadPublicPage('shop.example.com')).data.headline, 'First headline');

    // The journey that holds the domain republishes as before.
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    // Once that journey is gone, its leftover page no longer holds the domain.
    delete s.journeys['u1:j1'];
    const after = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(after.status, 200, after.body?.error);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');
    assert.equal(after.body.publishedPages[0].journeyId, 'j2', 'the publish dialog can name the journey on a DNS check');
  } finally {
    await s.close();
  }
});

test('the last look refuses a custom domain another journey took while this one was planning', async () => {
  const s = await serve();
  try {
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u1', verified: true };
    s.put(domainJourney('j2', 'second-offer', 'Second'));
    s.hooks.afterLogSave = () => {
      s.publicPageCache['first-offer'] = { slug: 'first-offer', userId: 'u1', journeyId: 'j1', customDomain: 'shop.example.com', data: { headline: 'First' } };
      s.publicPageCache['domain:shop.example.com'] = 'first-offer';
      s.hooks.afterLogSave = null;
    };
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 409);
    assert.equal(
      r.body.error,
      'The custom domain shop.example.com was just published by another of your journeys. Remove it from this page or take that journey offline, then publish again. No page was changed.'
    );
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');
    assert.equal(s.publicPageCache['second-offer'], undefined);
  } finally {
    await s.close();
  }
});

test('checking DNS never moves a domain off a live page, and picks a page only when one journey asks for the domain', async () => {
  const s = await serve();
  try {
    const page = (slug, journeyId, userId = 'u1') => ({ slug, userId, journeyId, customDomain: 'shop.example.com', data: { headline: slug } });
    s.publicPageCache['first-offer'] = page('first-offer', 'j1');
    s.publicPageCache['second-offer'] = page('second-offer', 'j2');
    s.publicPageCache['domain:shop.example.com'] = 'first-offer';

    // Checked from the second journey: the first journey's page keeps the domain.
    assert.equal((await s.call('GET', '/api/domain/verify?domain=shop.example.com&journeyId=j2')).body.verified, true);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');

    // With no pointer and two journeys asking, an unnamed check picks neither, a named one its own.
    delete s.publicPageCache['domain:shop.example.com'];
    await s.call('GET', '/api/domain/verify?domain=shop.example.com');
    assert.equal(s.publicPageCache['domain:shop.example.com'], undefined);
    assert.equal(await pub.loadPublicPage('shop.example.com'), null, 'serving never guesses between two journeys');
    await s.call('GET', '/api/domain/verify?domain=shop.example.com&journeyId=j2');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');
    assert.equal((await pub.loadPublicPage('shop.example.com')).journeyId, 'j2');

    // One journey asking: an unnamed check switches it on, as before.
    delete s.publicPageCache['domain:shop.example.com'];
    delete s.publicPageCache['second-offer'];
    await s.call('GET', '/api/domain/verify?domain=shop.example.com');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');

    // A pointer at ANOTHER store's page is replaced once this user proves the domain.
    s.publicPageCache['theirs'] = page('theirs', 'jx', 'u2');
    s.publicPageCache['domain:shop.example.com'] = 'theirs';
    await s.call('GET', '/api/domain/verify?domain=shop.example.com');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');
  } finally {
    await s.close();
  }
});

// A pointer the user already took off a page must not hold the domain: that left the domain stuck
// on the first journey, and the only way to move it was to take that whole journey offline.
// The stored pointer's doc name, as savePublicPage builds it (a name with a dot is hashed).
const pointerDoc = `pubpage.${crypto.createHash('sha256').update('domain.shop.example.com').digest('hex').slice(0, 24)}`;
const withoutDomain = (j) => ({ ...j, nodes: j.nodes.map(n => ({ ...n, data: { ...n.data, customDomain: '' } })) });

test('a journey republished without its custom domain lets go of it, so another journey can take it', async () => {
  const s = await serve();
  try {
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u1', verified: true };
    s.put(domainJourney('j1', 'first-offer', 'First headline'));
    s.put(domainJourney('j2', 'second-offer', 'Second headline'));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    assert.equal(s.docs.get(pointerDoc)?.targetSlug, 'first-offer');

    s.put(withoutDomain(domainJourney('j1', 'first-offer', 'First headline')));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);
    assert.equal(s.publicPageCache['domain:shop.example.com'], undefined);
    assert.equal(s.docs.has(pointerDoc), false, 'the stored pointer goes too');
    assert.equal(await pub.loadPublicPage('shop.example.com'), null, 'the domain no longer serves the first journey');
    assert.equal(s.publicPageCache['first-offer'].journeyId, 'j1', 'its /p/ page stays live');

    const chk = await s.call('GET', '/api/journey/check-slug?slug=second-offer&customDomain=shop.example.com&journeyId=j2');
    assert.equal(chk.status, 200, chk.body?.error);
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 200, r.body?.error);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');
    assert.equal((await pub.loadPublicPage('shop.example.com')).journeyId, 'j2');
  } finally {
    await s.close();
  }
});

test('a pointer left on a page that no longer asks for the domain holds nothing', async () => {
  const s = await serve();
  try {
    // What an older server left behind: the pointer still on the first journey's page, which the
    // user republished without the domain.
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u1', verified: true };
    s.publicPageCache['first-offer'] = { slug: 'first-offer', userId: 'u1', journeyId: 'j1', data: { headline: 'First' } };
    s.publicPageCache['domain:shop.example.com'] = 'first-offer';
    assert.equal(await pub.loadPublicPage('shop.example.com'), null, 'the stale pointer serves nothing');

    const chk = await s.call('GET', '/api/journey/check-slug?slug=second-offer&customDomain=shop.example.com&journeyId=j2');
    assert.equal(chk.status, 200, chk.body?.error);

    // Checking DNS from the second journey moves the domain to the page that asks for it.
    s.publicPageCache['second-offer'] = { slug: 'second-offer', userId: 'u1', journeyId: 'j2', customDomain: 'shop.example.com', data: { headline: 'Second' } };
    await s.call('GET', '/api/domain/verify?domain=shop.example.com&journeyId=j2');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');

    // And publishing moves it, the last look included.
    s.publicPageCache['domain:shop.example.com'] = 'first-offer';
    delete s.publicPageCache['second-offer'];
    s.put(domainJourney('j2', 'second-offer', 'Second headline'));
    s.hooks.afterLogSave = () => { s.publicPageCache['domain:shop.example.com'] = 'first-offer'; s.hooks.afterLogSave = null; };
    const r = await s.call('POST', '/api/journey/j2/publish');
    assert.equal(r.status, 200, r.body?.error);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');
  } finally {
    await s.close();
  }
});

test('a republish the store refuses keeps the domain on the page it puts back', async () => {
  const s = await serve();
  try {
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u1', verified: true };
    s.put(domainJourney('j1', 'first-offer', 'First headline'));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 200);

    const put = s.hub.store.docs.put;
    s.hub.store.docs.put = async (n, d) => (n === 'pubpage.first-offer' ? { error: 'Refused.', status: 503 } : put(n, d));
    s.put(withoutDomain(domainJourney('j1', 'first-offer', 'First headline')));
    assert.equal((await s.call('POST', '/api/journey/j1/publish')).status, 503);
    assert.equal(s.publicPageCache['first-offer'].customDomain, 'shop.example.com');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'first-offer');
    assert.equal(s.docs.get(pointerDoc)?.targetSlug, 'first-offer');
    assert.equal((await pub.loadPublicPage('shop.example.com')).journeyId, 'j1');
  } finally {
    await s.close();
  }
});
