import test from 'node:test';
import assert from 'node:assert/strict';
import { setPublicContext, removePublicPage, readPublicPage } from './server/routes/publicRoutes.mjs';

// "Take funnel offline" called hub.store.docs.delete, which the hub SDK does not have (its name is
// docs.remove). The TypeError was swallowed, so on a hub-backed server every page stayed live and
// boot rehydration brought the local copy back. The stub below has exactly the SDK's methods.

function hubStub(answer = async (name) => ({ name, deleted: true }), read = async () => ({ error: 'No such document.', status: 404 })) {
  const removed = [];
  const reads = [];
  const hub = {
    store: {
      docs: {
        get: async (name) => { reads.push(name); return read(name); },
        put: async () => ({}),
        list: async () => ({ documents: [] }),
        batchGet: async () => ({ documents: [] }),
        remove: async (name) => { removed.push(name); return answer(name); }
      }
    }
  };
  return { hub, removed, reads };
}

function withContext(hub, cache) {
  setPublicContext({
    hub,
    hubReady: true,
    publicPageCache: cache,
    persistPublicPages() {},
    reloadDomainRegistry() {},
    reloadPublicPageCache() { return cache; },
    domainRegistryCache: {}
  });
}

test('removing a page removes its hub document through docs.remove', async () => {
  const { hub, removed } = hubStub();
  const cache = { 'my-offer': { userId: 'u1', slug: 'my-offer', data: {} } };
  withContext(hub, cache);
  const ok = await removePublicPage('my-offer', 'u1');
  assert.equal(ok, true);
  assert.deepEqual(removed, ['pubpage.my-offer']);
  assert.equal(cache['my-offer'], undefined);
});

test('a verified custom domain pointer is removed from the hub too', async () => {
  const { hub, removed } = hubStub();
  const cache = {
    'my-offer': { userId: 'u1', slug: 'my-offer', customDomain: 'shop.example.com', data: {} },
    'domain:shop.example.com': 'my-offer'
  };
  withContext(hub, cache);
  assert.equal(await removePublicPage('my-offer', 'u1'), true);
  assert.equal(removed.length, 2);
  assert.ok(removed.includes('pubpage.my-offer'));
  assert.ok(removed.every(n => n.startsWith('pubpage.')));
  assert.equal(cache['domain:shop.example.com'], undefined);
});

test('a hub refusal is reported as a failed removal, and the local copy still goes', async () => {
  const { hub } = hubStub(async () => ({ error: 'HTTP 500', status: 500 }));
  const cache = { 'my-offer': { userId: 'u1', slug: 'my-offer', data: {} } };
  withContext(hub, cache);
  assert.equal(await removePublicPage('my-offer', 'u1'), false);
  assert.equal(cache['my-offer'], undefined);
});

test('a hub that throws is a failed removal too', async () => {
  const { hub } = hubStub(async () => { throw new Error('socket hang up'); });
  const cache = { 'my-offer': { userId: 'u1', slug: 'my-offer', data: {} } };
  withContext(hub, cache);
  assert.equal(await removePublicPage('my-offer', 'u1'), false);
});

test('a document the hub no longer has counts as removed', async () => {
  const { hub } = hubStub(async () => ({ error: 'No such document.', status: 404 }));
  const cache = { 'my-offer': { userId: 'u1', slug: 'my-offer', data: {} } };
  withContext(hub, cache);
  assert.equal(await removePublicPage('my-offer', 'u1'), true);
});

test("another store's page is never removed", async () => {
  const { hub, removed } = hubStub();
  const page = { userId: 'u2', slug: 'their-offer', data: {} };
  const cache = { 'their-offer': page };
  withContext(hub, cache);
  assert.equal(await removePublicPage('their-offer', 'u1'), false);
  assert.deepEqual(removed, []);
  assert.equal(cache['their-offer'], page);
});

// Before the rename the removal did nothing, so a null owner read was harmless. Now it removes,
// and loadPublicPage turned a failed hub read into "no record" whenever the cache missed: the doc
// was removed whoever owned it. A read that fails is not an answer about the owner.

test('a hub read that fails, with nothing cached, removes nothing and reports false', async () => {
  const { hub, removed } = hubStub(undefined, async () => ({ error: 'unavailable', status: 503 }));
  withContext(hub, {});
  assert.equal(await removePublicPage('node-page-1', 'u1'), false);
  assert.deepEqual(removed, []);
});

test('a hub read that throws, with nothing cached, removes nothing', async () => {
  const { hub, removed } = hubStub(undefined, async () => { throw new Error('socket hang up'); });
  withContext(hub, {});
  assert.equal(await removePublicPage('node-page-1', 'u1'), false);
  assert.deepEqual(removed, []);
});

test("a hub document owned by another store is never removed, even with nothing cached", async () => {
  const { hub, removed } = hubStub(undefined, async (name) => ({ name, document: { userId: 'u2', slug: 'sale' } }));
  withContext(hub, {});
  assert.equal(await removePublicPage('sale', 'u1'), false);
  assert.deepEqual(removed, []);
});

test('a hub document this user owns is removed when nothing is cached', async () => {
  const { hub, removed } = hubStub(undefined, async (name) => ({ name, document: { userId: 'u1', slug: 'sale' } }));
  withContext(hub, {});
  assert.equal(await removePublicPage('sale', 'u1'), true);
  assert.deepEqual(removed, ['pubpage.sale']);
});

test('a 404 from the hub is an answer: the key is free and the removal is a no-op success', async () => {
  const { hub, removed } = hubStub();
  withContext(hub, {});
  assert.equal(await removePublicPage('gone', 'u1'), true);
  assert.deepEqual(removed, ['pubpage.gone']);
});

test('readPublicPage says when it does not know', async () => {
  const failing = hubStub(undefined, async () => ({ error: 'HTTP 500', status: 500 }));
  const cache = {};
  withContext(failing.hub, cache);
  assert.deepEqual(await readPublicPage('sale'), { ok: false, page: null });
  const mine = { userId: 'u1', slug: 'sale' };
  cache.sale = mine;
  assert.deepEqual(await readPublicPage('sale'), { ok: true, page: mine }, 'the cached copy answers while the hub is down');

  withContext(hubStub().hub, {});
  assert.deepEqual(await readPublicPage('sale'), { ok: true, page: null }, 'a 404 is a clean "no record"');
  assert.deepEqual(await readPublicPage(''), { ok: true, page: null });
});
