import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLISHED_STEP_TYPES,
  NOTHING_CHANGED,
  cleanPublishSlug,
  cleanCustomDomain,
  draftPublishAddress,
  addressClashes,
  planPublishAddresses
} from './src/lib/publishAddresses.ts';

// The pure half of all-or-nothing publishing. The derivations must match the old publish loop
// byte for byte, or a live page moves to a new address on its next publish.

const DASHES = /—| – /;
const page = (id, data = {}) => ({ id, type: 'landing-page', data: { type: 'landing-page', ...data } });
const upsell = (id, data = {}) => ({ id, type: 'upsell', data: { type: 'upsell', ...data } });
const split = (id, data = {}) => ({ id, type: 'ab-split', data: { type: 'ab-split', ...data } });
const free = async (slug) => ({ available: true, cleanSlug: slug });

test('the published step types and the closing sentence', () => {
  assert.deepEqual([...PUBLISHED_STEP_TYPES], ['landing-page', 'upsell', 'ab-split']);
  assert.equal(NOTHING_CHANGED, 'No page was changed.');
});

test('slugs and domains are cleaned exactly as publish always cleaned them', () => {
  assert.equal(cleanPublishSlug('My Offer!'), 'my-offer');
  assert.equal(cleanPublishSlug('--a_b--'), 'a_b');
  assert.equal(cleanPublishSlug(undefined), '');
  assert.equal(cleanCustomDomain(' https://Shop.Example.com/path/x '), 'shop.example.com');
  assert.equal(cleanCustomDomain(null), '');
});

test('draftPublishAddress reproduces the old slug, key and url for every published type', () => {
  assert.deepEqual(draftPublishAddress(page('page-1', { slug: 'VIP Offer', customDomain: 'http://A.com/x' })), {
    nodeId: 'page-1', type: 'landing-page', slug: 'vip-offer', isCustomSlug: true,
    customDomain: 'a.com', key: 'vip-offer', url: '/p/vip-offer'
  });
  const generatedPage = draftPublishAddress(page('Node 1'));
  assert.equal(generatedPage.slug, 'node-1');
  assert.equal(generatedPage.isCustomSlug, false);
  assert.equal(draftPublishAddress(page('!!!abc')).slug, 'abc');
  assert.equal(draftPublishAddress(page('!!!!!!!!')).slug, 'offer-!!!!!!', 'the old fallback, kept verbatim');
  assert.equal(draftPublishAddress(page('p', { slug: '   ' })).isCustomSlug, false);

  const up = draftPublishAddress(upsell('up-1', { customDomain: 'a.com' }));
  assert.equal(up.slug, 'up-1-upsell');
  assert.equal(up.key, 'up-1-upsell');
  assert.equal(up.url, '/p/up-1-upsell');
  assert.equal(up.customDomain, '', 'an upsell never carries a custom domain');
  assert.equal(draftPublishAddress(upsell('up-1', { slug: 'Bonus' })).slug, 'bonus');

  const sp = draftPublishAddress(split('split-1'));
  assert.equal(sp.slug, 'split-1-split');
  assert.equal(sp.key, 'split:split-1-split');
  assert.equal(sp.url, '/p/split/split-1-split');
  const chosenSplit = draftPublishAddress(split('s', { slug: 'Try It' }));
  assert.deepEqual([chosenSplit.slug, chosenSplit.key, chosenSplit.url, chosenSplit.isCustomSlug], ['try-it', 'split:try-it', '/p/split/try-it', true]);

  assert.equal(draftPublishAddress({ id: 'ty', type: 'thank-you', data: { slug: 'x' } }), null);
  assert.equal(draftPublishAddress({ id: 'f', type: 'lead-form', data: {} }), null);
});

test('addressClashes finds a chosen path used twice and lists the landing page first', () => {
  const clashes = addressClashes([upsell('up-1', { slug: 'offer' }), page('page-a', { slug: 'Offer' })]);
  assert.deepEqual(clashes, [{ nodeIds: ['page-a', 'up-1'], address: '/p/offer' }]);
});

test('addressClashes ignores thank-you steps, generated paths, split namespaces and custom domains', () => {
  assert.deepEqual(addressClashes([
    page('page-a', { slug: 'offer' }),
    { id: 'ty', type: 'thank-you', data: { slug: 'offer' } }
  ]), []);
  assert.deepEqual(addressClashes([page('hero'), upsell('up-1', { slug: 'hero' })]), [], 'a generated path gives way later');
  assert.deepEqual(addressClashes([page('page-a', { slug: 'offer' }), split('s', { slug: 'offer' })]), []);
  assert.deepEqual(addressClashes([
    page('page-a', { slug: 'a', customDomain: 'shop.com' }),
    page('page-b', { slug: 'b', customDomain: 'shop.com' })
  ]), []);
  assert.deepEqual(addressClashes([split('s1', { slug: 'x' }), split('s2', { slug: 'x' })]),
    [{ nodeIds: ['s1', 's2'], address: '/p/split/x' }]);
});

test('planPublishAddresses refuses a clash without calling check', async () => {
  let calls = 0;
  const plan = await planPublishAddresses([page('page-a', { slug: 'offer' }), upsell('up-1', { slug: 'offer' })], {
    check: async (slug) => { calls += 1; return { available: true, cleanSlug: slug }; },
    suffix: () => 'beef'
  });
  assert.equal(calls, 0);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.nodeIds, ['page-a', 'up-1']);
  assert.equal(plan.error, `Two steps in this journey use the address /p/offer. Change the Page URL Path on one of them. ${NOTHING_CHANGED}`);
  assert.doesNotMatch(plan.error, DASHES);
});

test('planPublishAddresses checks chosen paths before generated ones and returns node order', async () => {
  const asked = [];
  const plan = await planPublishAddresses([page('hero'), split('s1'), upsell('up-1', { slug: 'hero' }), page('p2', { slug: 'two', customDomain: 'Shop.com' })], {
    check: async (slug, opts) => { asked.push([slug, opts.type, opts.customDomain]); return { available: true, cleanSlug: slug }; },
    suffix: () => 'beef'
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(asked, [
    ['hero', 'page', ''],
    ['two', 'page', 'shop.com'],
    ['hero-beef', 'page', ''],
    ['s1-split', 'ab-split', '']
  ], 'the claimed chosen path is not checked again for the generated step; its suffixed form is');
  assert.deepEqual(plan.addresses.map(a => [a.nodeId, a.key, a.url]), [
    ['hero', 'hero-beef', '/p/hero-beef'],
    ['s1', 'split:s1-split', '/p/split/s1-split'],
    ['up-1', 'hero', '/p/hero'],
    ['p2', 'two', '/p/two']
  ]);
});

test('a generated path refused by the check takes the injected suffix', async () => {
  const plan = await planPublishAddresses([split('s1')], {
    check: async (slug) => slug === 's1-split' ? { available: false, error: 'Taken.' } : { available: true },
    suffix: () => 'beef'
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.addresses[0].key, 'split:s1-split-beef');
  assert.equal(plan.addresses[0].url, '/p/split/s1-split-beef');
});

test('a chosen path that is taken is refused with the check sentence and nothing changed', async () => {
  const plan = await planPublishAddresses([page('a', { slug: 'one' }), page('b', { slug: 'two' })], {
    check: async (slug) => slug === 'two' ? { available: false, error: 'The page slug "two" is already claimed by another store.' } : { available: true },
    suffix: () => 'beef'
  });
  assert.deepEqual(plan, {
    ok: false,
    nodeIds: ['b'],
    error: `The page slug "two" is already claimed by another store. ${NOTHING_CHANGED}`
  });
});

test('a refusal with no sentence from the check still says which address', async () => {
  const plan = await planPublishAddresses([page('a', { slug: 'one' })], { check: async () => ({ available: false }), suffix: () => 'beef' });
  assert.equal(plan.error, `The address /p/one is not available. ${NOTHING_CHANGED}`);
});

test('a generated path still taken after the suffix is refused', async () => {
  const plan = await planPublishAddresses([page('hero')], {
    check: async (slug) => ({ available: false, error: `The page slug "${slug}" is reserved by the system.` }),
    suffix: () => 'beef'
  });
  assert.deepEqual(plan, { ok: false, nodeIds: ['hero'], error: `The page slug "hero-beef" is reserved by the system. ${NOTHING_CHANGED}` });
  assert.doesNotMatch(plan.error, DASHES);
});

test('a suffixed path that another step already claimed is refused without asking the check', async () => {
  const asked = [];
  const plan = await planPublishAddresses([page('hero'), upsell('u', { slug: 'hero' }), upsell('v', { slug: 'hero-beef' })], {
    check: async (slug) => { asked.push(slug); return { available: true }; },
    suffix: () => 'beef'
  });
  assert.deepEqual(asked, ['hero', 'hero-beef']);
  assert.deepEqual(plan, { ok: false, nodeIds: ['hero'], error: `The address /p/hero-beef is not available. ${NOTHING_CHANGED}` });
});

// A check that could not read the owner answers retryable. The plan fails retryable so the route
// can answer 503 with Retry, and a generated path is never suffixed around it: the unread record
// may be this user's own live page, and a suffix would move it to a new URL.
const unreadable = (slug) => ({ available: false, retryable: true, error: `We could not check whether the address "${slug}" is free.` });

test('a chosen path whose owner cannot be read fails the plan as retryable', async () => {
  const plan = await planPublishAddresses([page('a', { slug: 'one' }), page('b', { slug: 'two' })], {
    check: async (slug) => slug === 'two' ? unreadable(slug) : { available: true },
    suffix: () => 'beef'
  });
  assert.deepEqual(plan, {
    ok: false,
    nodeIds: ['b'],
    retryable: true,
    error: `We could not check whether the address "two" is free. ${NOTHING_CHANGED}`
  });
});

test('a generated path whose owner cannot be read is not suffixed', async () => {
  const asked = [];
  const plan = await planPublishAddresses([page('hero')], {
    check: async (slug) => { asked.push(slug); return unreadable(slug); },
    suffix: () => 'beef'
  });
  assert.deepEqual(asked, ['hero']);
  assert.deepEqual(plan, { ok: false, nodeIds: ['hero'], retryable: true, error: `We could not check whether the address "hero" is free. ${NOTHING_CHANGED}` });
});

test('a suffixed path whose owner cannot be read is retryable too, and a plain refusal is not', async () => {
  const plan = await planPublishAddresses([page('hero')], {
    check: async (slug) => slug === 'hero' ? { available: false, error: 'Taken.' } : unreadable(slug),
    suffix: () => 'beef'
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.retryable, true);
  const taken = await planPublishAddresses([page('a', { slug: 'one' })], { check: async () => ({ available: false, error: 'Taken.' }), suffix: () => 'beef' });
  assert.equal('retryable' in taken, false);
});
