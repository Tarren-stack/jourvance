import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Shopify Sync dialog at phone width (T14). At 390 its view switcher was a no-wrap flex row, so
// "Abandoned Checkouts (0)" ran past the dialog edge and the whole dialog body became a sideways
// scroller (372 wide in a 356 box); at 320 the third view could not be clicked at all. The same
// dialog clipped its two tables inside overflow: hidden, cutting off the checkout's Action link,
// and its webhook URL inputs kept their intrinsic width and pushed Copy past a 320 dialog.
// The browser measurement lives in the lane's scratch script; these pins hold the source shapes
// that made each one fit.

const src = readFileSync(new URL('./src/components/modals/ShopifySyncModal.tsx', import.meta.url), 'utf8');

const VIEWS = ['webhooks', 'discounts', 'abandoned'];

// The source from the nearest opening <tag before index up to index: that element's opening tag.
const openTagBefore = (index, tag) => src.slice(src.lastIndexOf(`<${tag}`, index), index);

test('the view switcher wraps instead of running past the dialog edge', () => {
  const first = src.indexOf(`setActiveTab('${VIEWS[0]}')`);
  assert.ok(first > 0, 'view switcher not found');
  const row = openTagBefore(src.lastIndexOf('<button', first), 'div');
  assert.match(row, /display: 'flex'/, row);
  assert.match(row, /flexWrap: 'wrap'/, 'the switcher row must wrap at phone width');
  assert.doesNotMatch(row, /overflow/, 'the switcher must not become its own clipping or sideways scroller');
  assert.match(row, /aria-label="[^"]+"/, 'the switcher group is named');
});

test('every view button stays a plain button in Tab order and says which view is showing', () => {
  for (const view of VIEWS) {
    const at = src.indexOf(`onClick={() => setActiveTab('${view}')}`);
    assert.ok(at > 0, `${view} button not found`);
    const button = src.slice(src.lastIndexOf('<button', at), src.indexOf('>', src.indexOf('}}', at)) + 1);
    assert.match(button, /type="button"/);
    assert.match(button, new RegExp(`aria-pressed=\\{activeTab === '${view}'\\}`), `${view} must expose its pressed state`);
    assert.doesNotMatch(button, /tabIndex=\{-1\}|role="tab"/, 'no roving tablist was added without its arrow-key contract');
  }
});

test('a URL input sharing a row with its Copy button can shrink below its intrinsic width', () => {
  const inputs = [...src.matchAll(/<input[\s\S]*?\/>/g)].map(m => m[0]).filter(t => /flex: 1\b/.test(t));
  assert.ok(inputs.length >= 3, `expected the webhook URL inputs, found ${inputs.length}`);
  for (const input of inputs) assert.match(input, /minWidth: 0/, input.slice(0, 120));
});

test('the tables scroll sideways in their own labelled, focusable region rather than clipping columns', () => {
  const tables = [...src.matchAll(/<table\b/g)].map(m => m.index);
  assert.equal(tables.length, 2, 'the discounts table and the checkouts table');
  for (const at of tables) {
    const wrap = src.slice(src.lastIndexOf('<div', at), at);
    assert.doesNotMatch(wrap, /overflow: 'hidden'/, 'a clipped table hides its last columns at phone width');
    assert.match(wrap, /overflowX: 'auto'/);
    assert.match(wrap, /role="region"/);
    assert.match(wrap, /aria-label="[^"]+"/);
    assert.match(wrap, /tabIndex=\{0\}/, 'a keyboard user can focus the region to scroll it');
  }
});
