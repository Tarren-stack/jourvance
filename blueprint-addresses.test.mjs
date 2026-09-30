import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chosenAddressKeys, withFreshAddresses } from './src/lib/blueprintAddresses.ts';
import { ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';

// "Create as New Journey" used to keep every blueprint's fixed page paths, so two journeys made
// from one blueprint asked for one /p/ address and the second publish was refused (R26). A new
// journey now keeps the blueprint's path only while nothing else holds it.

const bp1 = ECOM_BLUEPRINTS.find(b => b.nodes.some(n => n.data?.slug === 'product-flagship-drop'));
const slugOf = (nodes, type) => nodes.find(n => n.type === type)?.data?.slug;
const counter = () => {
  let n = 0;
  return () => String(++n).padStart(4, '0');
};

test('a blueprint path nothing holds is kept as it is', async () => {
  const nodes = await withFreshAddresses(bp1.nodes, { taken: new Set(), suffix: counter() });
  assert.equal(slugOf(nodes, 'landing-page'), 'product-flagship-drop');
  assert.equal(slugOf(bp1.nodes, 'landing-page'), 'product-flagship-drop', 'the blueprint itself is never changed');
});

test('a path another journey asks for takes a short suffix, and the thank-you step follows its page', async () => {
  const first = { id: 'j1', nodes: await withFreshAddresses(bp1.nodes, { taken: new Set(), suffix: counter() }) };
  const taken = chosenAddressKeys([first]);
  assert.ok(taken.has('product-flagship-drop'));
  const nodes = await withFreshAddresses(bp1.nodes, { taken, suffix: counter() });
  assert.equal(slugOf(nodes, 'landing-page'), 'product-flagship-drop-0001');
  assert.equal(slugOf(nodes, 'thank-you'), 'product-flagship-drop-0001');
});

test('every shipped blueprint made twice gives the second journey addresses the first does not use', async () => {
  for (const bp of ECOM_BLUEPRINTS) {
    const first = { id: 'a', nodes: await withFreshAddresses(bp.nodes, { taken: new Set(), suffix: counter() }) };
    const second = { id: 'b', nodes: await withFreshAddresses(bp.nodes, { taken: chosenAddressKeys([first]), suffix: counter() }) };
    const a = chosenAddressKeys([first]);
    for (const key of chosenAddressKeys([second])) assert.ok(!a.has(key), `${bp.id}: ${key} is asked for twice`);
  }
});

test('the account check decides: free keeps the path, taken or unanswered takes a suffix', async () => {
  const asked = [];
  const answer = (map) => async (slug, type) => { asked.push([slug, type]); return map[slug] || 'free'; };

  const free = await withFreshAddresses(bp1.nodes, { taken: new Set(), check: answer({}), suffix: counter() });
  assert.equal(slugOf(free, 'landing-page'), 'product-flagship-drop');
  assert.deepEqual(asked[0], ['product-flagship-drop', 'page']);

  const live = await withFreshAddresses(bp1.nodes, { taken: new Set(), check: answer({ 'product-flagship-drop': 'taken' }), suffix: counter() });
  assert.equal(slugOf(live, 'landing-page'), 'product-flagship-drop-0001');

  const offline = await withFreshAddresses(bp1.nodes, { taken: new Set(), check: async () => 'unknown', suffix: counter() });
  assert.equal(slugOf(offline, 'landing-page'), 'product-flagship-drop-0001', 'an address not known to be free is not kept');

  const busy = await withFreshAddresses(bp1.nodes, {
    taken: new Set(),
    check: answer({ 'product-flagship-drop': 'taken', 'product-flagship-drop-0001': 'taken' }),
    suffix: counter()
  });
  assert.equal(slugOf(busy, 'landing-page'), 'product-flagship-drop-0002', 'a suffixed address the account holds is tried again');
});

test('an A/B split keeps pointing at the pages it splits, and its own path moves in the split namespace', async () => {
  const nodes = [
    { id: 'a', type: 'landing-page', position: { x: 0, y: 0 }, data: { slug: 'offer-a' } },
    { id: 'b', type: 'landing-page', position: { x: 0, y: 0 }, data: { slug: 'offer-b' } },
    { id: 's', type: 'ab-split', position: { x: 0, y: 0 }, data: { slug: 'try-it', branchAPageSlug: 'offer-a', branchBPageSlug: 'offer-b' } }
  ];
  const out = await withFreshAddresses(nodes, { taken: new Set(['offer-a', 'split:try-it']), suffix: counter() });
  assert.equal(out[0].data.slug, 'offer-a-0001');
  assert.equal(out[1].data.slug, 'offer-b', 'a free path is kept');
  assert.equal(out[2].data.slug, 'try-it-0002');
  assert.equal(out[2].data.branchAPageSlug, 'offer-a-0001');
  assert.equal(out[2].data.branchBPageSlug, 'offer-b');
});

test('the blueprint dialog asks the account with a journey id, for "Create as New Journey" only', () => {
  const src = fs.readFileSync(new URL('./src/components/modals/BlueprintModal.tsx', import.meta.url), 'utf8');
  assert.match(src, /new URLSearchParams\(\{ slug, type, journeyId: probeId \}\)/);
  assert.match(src, /\/api\/journey\/check-slug\?\$\{params\}/);
  assert.match(src, /if \(mode === 'new'\) \{[\s\S]{0,120}await newJourneyAddresses\(prepared\.nodes\)/);
});
