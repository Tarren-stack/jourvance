import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// U08. Email Studio's "Soon" badge (and fifteen other labels) rendered at 10px, under the 11px floor;
// at 320 signed out its banner was a no-wrap flex row, so "Back to Canvas" ran past the edge inside an
// unlabelled sideways scroller; and Shopify Sync read "Abandoned Checkouts (0)" before, or without,
// ever loading the checkouts. The browser measurement lives in the lane's scratch script (u08.mjs);
// these pins hold the source shapes and the count rule.

const suite = readFileSync(new URL('./src/components/campaign/HubEmailSuite.tsx', import.meta.url), 'utf8');
const shopify = readFileSync(new URL('./src/components/modals/ShopifySyncModal.tsx', import.meta.url), 'utf8');

// Every inline font size, as px. A bare number is px in React's style object.
const fontSizes = src => [...src.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)(px)?['"]?/g)].map(m => ({ px: Number(m[1]), at: src.slice(0, m.index).split('\n').length }));

test('no text in Email Studio or Shopify Sync is set under 11px', () => {
  for (const [name, src] of [['HubEmailSuite.tsx', suite], ['ShopifySyncModal.tsx', shopify]]) {
    const sizes = fontSizes(src);
    assert.ok(sizes.length > 50 || name !== 'HubEmailSuite.tsx', 'font sizes not found');
    const small = sizes.filter(s => s.px < 11).map(s => `${name}:${s.at} ${s.px}px`);
    assert.deepEqual(small, [], `text under the 11px floor: ${small.join(', ')}`);
  }
});

test('the Soon badge on the Texts view is 11px or more', () => {
  const at = suite.indexOf('{tab.badge}');
  assert.ok(at > 0, 'badge not found');
  const badge = suite.slice(suite.lastIndexOf('<span', at), at);
  const px = Number(badge.match(/fontSize:\s*'(\d+)px'/)?.[1]);
  assert.ok(px >= 11, `the badge is ${px}px`);
});

test('the Email Studio banner wraps at phone width instead of pushing its buttons off the edge', () => {
  const h1 = suite.indexOf('<h1');
  assert.ok(h1 > 0 && /Email Studio/.test(suite.slice(h1, h1 + 200)), 'studio title not found');
  // The banner is the div opened just after the "Top Banner" comment.
  const bannerAt = suite.indexOf('Top Banner');
  const banner = suite.slice(suite.indexOf('<div', bannerAt), suite.indexOf('>', suite.indexOf('}}', bannerAt)) + 1);
  assert.match(banner, /display: 'flex'/);
  assert.match(banner, /flexWrap: 'wrap'/, 'the banner row must wrap so the buttons drop below the title');
  assert.doesNotMatch(banner, /overflowX/, 'the banner must not become its own sideways scroller');
  // The title row (h1 + Hub Engine badge) and the button group wrap too.
  const titleRow = suite.slice(suite.lastIndexOf('<div', h1), h1);
  assert.match(titleRow, /flexWrap: 'wrap'/, 'the title row must wrap');
  const back = suite.indexOf('Back to Canvas', h1);
  const group = suite.slice(suite.lastIndexOf("<div style={{ display: 'flex'", suite.indexOf('{isConnected ?', h1)), suite.indexOf('{isConnected ?', h1));
  assert.match(group, /flexWrap: 'wrap'/, 'the button group must wrap');
  assert.ok(back > 0);
  // "E-Commerce" is kept whole, so the title never breaks as "E-" / "Commerce".
  assert.match(suite.slice(h1, h1 + 300), /whiteSpace: 'nowrap' }}>E-Commerce</);
});

test('a list count is shown only once the list was loaded, never a 0 nobody measured', async () => {
  const { loadedCountSuffix } = await import('./src/lib/loadedCount.ts');
  assert.equal(loadedCountSuffix('loading', 0), '');
  assert.equal(loadedCountSuffix('failed', 0), '');
  assert.equal(loadedCountSuffix('failed', 3), '');
  assert.equal(loadedCountSuffix('loaded', 0), ' (0)', 'a list that was read and is empty is a real 0');
  assert.equal(loadedCountSuffix('loaded', 2), ' (2)');
  assert.equal(loadedCountSuffix('loaded', Number.NaN), '');
});

test('Shopify Sync counts abandoned checkouts only after they were read, and says so when they were not', () => {
  assert.doesNotMatch(shopify, /Abandoned Checkouts \(\{checkouts\.length\}\)/, 'the tab counted an empty default array as 0');
  assert.match(shopify, /Abandoned Checkouts\{loadedCountSuffix\(checkoutsLoad, checkouts\.length\)\}/);
  // The load starts as 'loading' and a failed read never lands as an empty, loaded list.
  assert.match(shopify, /useState<ListLoad>\('loading'\)/);
  const load = shopify.slice(shopify.indexOf('const loadAbandonedCheckouts'), shopify.indexOf('const handleCopy'));
  assert.match(load, /setCheckoutsLoad\('failed'\)/);
  assert.match(load, /request !== checkoutsRequest\.current/, 'a stale answer must not settle the list');
  // "No abandoned checkouts recorded yet." is said only of a list that was read.
  assert.match(shopify, /checkoutsLoad === 'loaded' && 'No abandoned checkouts recorded yet\.'/);
  // The message sits outside the sideways table, so at 320 it is not centred off-screen in a wide cell.
  const view = shopify.slice(shopify.indexOf("activeTab === 'abandoned' && ("));
  assert.doesNotMatch(view.slice(0, view.indexOf('{/* Footer */}')), /colSpan=/, 'the empty or failed message must not live in a table cell');
  // Retry only where retrying can help: not for a signed-out 401.
  assert.match(shopify, /checkoutsLoad === 'failed' && checkoutsFailure === 'retry' &&/);
});
