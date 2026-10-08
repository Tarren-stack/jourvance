// server.mjs hands its domains.json and public_pages.json caches to the route modules once, at
// mount. A reload used to REASSIGN the binding, so every route kept reading the boot-time object:
// a custom domain verified after the server started published as unverified (and did not serve)
// until a restart, and a page published after any reload was written to an object the next
// persist no longer saved. These tests run server.mjs's own cache and verification code, sliced
// out of the file, against the real route modules on a bare Express app. server.mjs itself is
// never started and .env is never read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { reloadJsonInPlace } from './server/liveJsonCache.mjs';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setupDomainRoutes } from './server/routes/domainRoutes.mjs';
import { setPublicContext, savePublicPage, domainRegistryCache as publicDomainProxy } from './server/routes/publicRoutes.mjs';

const SERVER_SRC = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + (to.endsWith('\n') ? to.length : 0));
}

// The cache, reload, persist and verification code exactly as server.mjs has it, with DNS and
// the TLS probe stubbed and every file in `dir`.
function loadServerCaches(dir, { cnames = {} } = {}) {
  const src = [
    // The per-process signing key the domain token falls back to with no SESSION_SECRET.
    slice('const processSecrets = new Map();', '\nfunction mailLinkSecrets() {'),
    slice("const publicPagesFile = path.join(__dirname, 'public_pages.json');", 'reloadPublicPageCache();\n'),
    slice('const persistPublicPages = () => {', '\n};\n'),
    slice("const domainsFilePath = path.join(__dirname, 'domains.json');", '// ── Funnel Publishing Routes')
  ].join('\n');
  const dns = {
    promises: {
      resolveTxt: async () => { throw new Error('ENODATA'); },
      resolveCname: async (host) => { if (cnames[host]) return cnames[host]; throw new Error('ENODATA'); }
    }
  };
  const build = new Function(
    'fs', 'path', '__dirname', 'crypto', 'dns', 'checkSslCertificate', 'hub', 'hubReady', 'safe', 'reloadJsonInPlace',
    `${src}
    return {
      pages: () => publicPageCache,
      domains: () => domainRegistryCache,
      reloadPublicPageCache, persistPublicPages, reloadDomainRegistry, persistDomainRegistry,
      getDomainVerificationToken, verifyDomainOwnership
    };`
  );
  return build(fs, path, dir, crypto, dns, async () => ({ sslActive: false }), null, false, (s) => s, reloadJsonInPlace);
}

test('a domain verified after boot publishes, reports and serves as verified, and pages published after a reload are saved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-registry-'));
  // Files that already exist at boot: any server that has ever verified a domain or published a page.
  fs.writeFileSync(path.join(dir, 'domains.json'), JSON.stringify({ 'other.example.com': { domain: 'other.example.com', userId: 'u9', verified: true } }));
  fs.writeFileSync(path.join(dir, 'public_pages.json'), JSON.stringify({ 'old-page': { slug: 'old-page', userId: 'u9' } }));

  const ns = loadServerCaches(dir, { cnames: { 'offer.brand.com': ['cname.jourvance.com'] } });
  // What server.mjs passes to the route modules at mount.
  const bootDomains = ns.domains();
  const bootPages = ns.pages();
  setPublicContext({
    hub: null, hubReady: false,
    publicPageCache: bootPages, persistPublicPages: ns.persistPublicPages, reloadPublicPageCache: ns.reloadPublicPageCache,
    domainRegistryCache: bootDomains, reloadDomainRegistry: ns.reloadDomainRegistry
  });

  const journey = { id: 'j1', nodes: [{ id: 'p1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Offer', customDomain: 'offer.brand.com' } }], edges: [] };
  const requireUser = (req, _res, next) => { req.user = { uid: 'u1' }; next(); };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, {
    requireUser,
    loadJourney: async () => journey, saveJourney: async () => ({ durable: true }),
    loadWorkspace: async () => null, realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: ns.reloadDomainRegistry, domainRegistryCache: bootDomains,
    savePublicPage, removePublicPage: async () => true,
    persistPublicPages: ns.persistPublicPages, publicPageCache: bootPages,
    loadPublicPage: async (k) => bootPages[k] || null,
    renderPublicFunnelHtml: () => '<html><body>x</body></html>', renderPublicUpsellHtml: () => '<html><body>x</body></html>'
  });
  setupDomainRoutes(app, {
    requireUser, domainRegistryCache: bootDomains, reloadDomainRegistry: ns.reloadDomainRegistry,
    verifyDomainOwnership: ns.verifyDomainOwnership, getDomainVerificationToken: ns.getDomainVerificationToken,
    publicPageCache: bootPages, persistPublicPages: ns.persistPublicPages
  });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // A visit to an unknown slug reloads public_pages.json (cachedPublicPage in publicRoutes.mjs).
    ns.reloadPublicPageCache();

    const verify = await (await fetch(`${base}/api/domain/verify?domain=offer.brand.com`)).json();
    assert.equal(verify.verified, true, 'the verification itself succeeds');

    const pub = await (await fetch(`${base}/api/journey/j1/publish`, { method: 'POST' })).json();
    assert.equal(pub.publishedPages?.[0]?.customDomain, 'offer.brand.com');
    assert.equal(pub.publishedPages?.[0]?.customDomainVerified, true, 'publish sees the domain verified after boot');

    const tok = await (await fetch(`${base}/api/domain/token?domain=offer.brand.com`)).json();
    assert.equal(tok.verified, true, 'the token route sees the domain verified after boot');

    assert.equal(publicDomainProxy['offer.brand.com']?.verified, true, 'Host-based serving sees the domain verified after boot');

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'public_pages.json'), 'utf8'));
    assert.equal(onDisk.offer?.userId, 'u1', 'the page published after a reload is in public_pages.json');
    assert.equal(onDisk['domain:offer.brand.com'], 'offer', 'its domain pointer is in public_pages.json');
    assert.equal(onDisk['old-page']?.userId, 'u9', 'the page that was already there is kept');
    assert.strictEqual(ns.domains(), bootDomains, 'the registry the routes hold is the one server.mjs reads');
    assert.strictEqual(ns.pages(), bootPages, 'the page cache the routes hold is the one server.mjs persists');
  } finally {
    setPublicContext(null);
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// savePublicPage undoes a page the store refused only while the cache still holds the object it
// saved. A reload of public_pages.json during the store's await (an upsell action, an order webhook,
// a visit to an unknown slug) must keep that object, or the refused page stays live and the publish
// answers success.
test('a reload during a refused page save does not stop the rollback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-reload-race-'));
  fs.writeFileSync(path.join(dir, 'public_pages.json'), JSON.stringify({ 'old-page': { slug: 'old-page', userId: 'u9' } }));
  const ns = loadServerCaches(dir);
  const bootPages = ns.pages();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let putStarted = false;
  const hub = { store: { docs: { put: async () => { putStarted = true; await gate; return { error: 'Store refused the write (quota).' }; } } } };
  setPublicContext({
    hub, hubReady: true,
    publicPageCache: bootPages, persistPublicPages: ns.persistPublicPages, reloadPublicPageCache: ns.reloadPublicPageCache,
    domainRegistryCache: ns.domains(), reloadDomainRegistry: ns.reloadDomainRegistry
  });
  const journey = { id: 'j1', nodes: [{ id: 'p1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Offer' } }], edges: [] };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => journey, saveJourney: async () => ({ durable: true }),
    loadWorkspace: async () => null, realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: ns.reloadDomainRegistry, domainRegistryCache: ns.domains(),
    savePublicPage, removePublicPage: async () => true,
    persistPublicPages: ns.persistPublicPages, publicPageCache: bootPages,
    loadPublicPage: async (k) => bootPages[k] || null,
    renderPublicFunnelHtml: () => '<html><body>x</body></html>', renderPublicUpsellHtml: () => '<html><body>x</body></html>'
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const quiet = console.error;
  console.error = () => {};
  let pending;
  try {
    pending = fetch(`${base}/api/journey/j1/publish`, { method: 'POST' }).then(async (r) => ({ status: r.status, body: await r.json() }));
    for (let i = 0; i < 400 && !putStarted; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(putStarted, 'the save reached the store');
    const saved = bootPages.offer;
    ns.reloadPublicPageCache();
    assert.strictEqual(bootPages.offer, saved, 'an unchanged page keeps its object across a reload');
    release();
    const out = await pending;
    assert.equal(out.status, 503, 'the publish is not reported as a success');
    assert.equal(out.body.success, false);
    assert.equal(bootPages.offer, undefined, 'the refused page is not live on this server');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'public_pages.json'), 'utf8'));
    assert.equal(onDisk.offer, undefined, 'the refused page is not in public_pages.json');
    assert.equal(onDisk['old-page']?.userId, 'u9', 'the page that was already there is kept');
  } finally {
    release();
    // A failed assertion above must not leave the publish running past the server's close.
    if (pending) await pending.catch(() => {});
    console.error = quiet;
    setPublicContext(null);
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reloadJsonInPlace keeps the object, replaces its contents, and ignores a file it cannot use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-live-json-'));
  const file = path.join(dir, 'x.json');
  try {
    const cache = { stale: 1 };
    assert.strictEqual(reloadJsonInPlace(cache, file), cache, 'a missing file changes nothing');
    assert.deepEqual(cache, { stale: 1 });

    fs.writeFileSync(file, JSON.stringify({ a: { v: 1 }, b: 2 }));
    assert.strictEqual(reloadJsonInPlace(cache, file), cache);
    assert.deepEqual(cache, { a: { v: 1 }, b: 2 }, 'keys the file lacks are gone');

    const a = cache.a;
    fs.writeFileSync(file, JSON.stringify({ a: { v: 1 }, b: 3 }));
    reloadJsonInPlace(cache, file);
    assert.strictEqual(cache.a, a, 'an entry the file did not change keeps its object');
    assert.equal(cache.b, 3);
    fs.writeFileSync(file, JSON.stringify({ a: { v: 2 }, b: 2 }));
    reloadJsonInPlace(cache, file);
    assert.notStrictEqual(cache.a, a, 'an entry the file changed is replaced');
    assert.deepEqual(cache, { a: { v: 2 }, b: 2 });
    fs.writeFileSync(file, JSON.stringify({ a: { v: 1 }, b: 2 }));
    reloadJsonInPlace(cache, file);

    for (const bad of ['{not json', '[1,2]', 'null', '"text"']) {
      fs.writeFileSync(file, bad);
      reloadJsonInPlace(cache, file);
      assert.deepEqual(cache, { a: { v: 1 }, b: 2 }, `${bad} leaves the cache as it was`);
    }

    fs.writeFileSync(file, '{"__proto__": {"polluted": true}, "ok": 1}');
    reloadJsonInPlace(cache, file);
    assert.equal(Object.getPrototypeOf(cache), Object.prototype, 'a __proto__ key never becomes the prototype');
    assert.equal(cache.polluted, undefined);
    assert.deepEqual(Object.keys(cache).sort(), ['__proto__', 'ok']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
