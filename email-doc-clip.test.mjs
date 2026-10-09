// blocksWouldClip (email-doc.mjs, EMAIL_STUDIO_PLAN.md Wave 8): true when cleanBlockList would cut
// something a caller sent. The broadcast drafts route and the flow-content route refuse such a save
// with 413 rather than store a shorter copy under a Saved (the adversarial review found a 606-character
// link stored at 500, a different and broken link, with a 200).
//
// The check keeps its own list of the lengths cleanBlock cuts to. This file holds that list to cleanBlock
// itself: every field cleanBlock reads off a block and cuts is found by cleaning a long value through
// the real cleaner, and blocksWouldClip must answer true one past that length and false at it. A new cap
// in cleanBlock that the check does not know fails here. The nested lists (cells, table rows, links,
// products, a column's blocks, a display rule) are named one by one below, each anchored the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { blocksWouldClip, cleanBlock, cleanBlockList } from './email-doc.mjs';

const SRC = fs.readFileSync(new URL('./email-doc.mjs', import.meta.url), 'utf8');
const KINDS = [...SRC.match(/const BLOCK_KINDS = new Set\(\[([^\]]+)\]\)/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const CLEANER = SRC.slice(SRC.indexOf('export function cleanBlock('), SRC.indexOf('export function cleanBlockList('));
const FIELDS = [...new Set([...CLEANER.matchAll(/input\.([A-Za-z]+)/g)].map((m) => m[1]))];
// Sevens survive every character filter cleanBlock applies (upper and lower case, slugs, ids), so a
// field that keeps fewer of them than were sent was cut, not cleaned.
const LONG = '7'.repeat(70000);

test('the source read is the cleaner: fifteen block kinds and the fields it reads', () => {
  assert.equal(KINDS.length, 15, KINDS.join(', '));
  for (const field of ['text', 'label', 'url', 'alt', 'href', 'logoUrl', 'logoAlt', 'thumbnail', 'prefix']) {
    assert.ok(FIELDS.includes(field), `cleanBlock no longer reads input.${field}`);
  }
});

test('every string field cleanBlock cuts, on every kind, is one blocksWouldClip refuses past its length and keeps at it', () => {
  const found = [];
  for (const kind of KINDS) {
    for (const field of FIELDS) {
      if (field === 'id' || field === 'kind') continue;
      const kept = cleanBlock({ kind, [field]: LONG }, 0, 0);
      const cut = kept && typeof kept[field] === 'string' && kept[field].length > 0 && kept[field].length < LONG.length && LONG.startsWith(kept[field])
        ? kept[field].length
        : 0;
      if (!cut) continue;
      found.push(`${kind}.${field}@${cut}`);
      assert.equal(blocksWouldClip([{ id: 'b', kind, [field]: '7'.repeat(cut + 1) }]), true, `${kind}.${field}: ${cut + 1} characters are cut to ${cut} and not refused`);
      assert.equal(blocksWouldClip([{ id: 'b', kind, [field]: '7'.repeat(cut) }]), false, `${kind}.${field}: ${cut} characters are kept whole and still refused`);
    }
  }
  // The fields this walk must reach, so an empty walk cannot pass.
  for (const want of ['text.text@4000', 'heading.text@4000', 'html.text@60000', 'button.label@80', 'button.url@500', 'image.url@500', 'image.alt@140', 'image.href@500', 'header.logoUrl@500', 'header.logoAlt@140', 'video.url@500', 'video.thumbnail@500', 'coupon.prefix@12']) {
    assert.ok(found.includes(want), `the walk did not reach ${want}: ${found.join(', ')}`);
  }
});

// Each nested list and its fields: [what, a block one past the limit, the same block at the limit, how to read the kept length].
const NESTED = [
  ['a split cell\'s words', (n) => ({ kind: 'split', cells: [{ kind: 'text', text: '7'.repeat(n) }, { kind: 'text', text: 'b' }] }), 4000, (b) => b.cells[0].text.length],
  ['a split image cell\'s link', (n) => ({ kind: 'split', cells: [{ kind: 'image', url: 'https://i.example.test/a.png', href: '7'.repeat(n) }, { kind: 'text', text: 'b' }] }), 500, (b) => b.cells[0].href.length],
  ['a table heading', (n) => ({ kind: 'table', headers: ['7'.repeat(n)], rows: [['x']] }), 80, (b) => b.headers[0].length],
  ['a table cell', (n) => ({ kind: 'table', headers: ['h'], rows: [['7'.repeat(n)]] }), 500, (b) => b.rows[0][0].length],
  ['a social link', (n) => ({ kind: 'social', links: [{ network: 'facebook', url: '7'.repeat(n) }] }), 500, (b) => b.links[0].url.length],
  ['a header link\'s words', (n) => ({ kind: 'header', links: [{ label: '7'.repeat(n), url: 'https://x.example.test' }] }), 40, (b) => b.links[0].label.length],
  ['a header link', (n) => ({ kind: 'header', links: [{ label: 'Shop', url: '7'.repeat(n) }] }), 500, (b) => b.links[0].url.length],
  ['a product title', (n) => ({ kind: 'product', products: [{ title: '7'.repeat(n) }] }), 200, (b) => b.products[0].title.length],
  ['a feed category', (n) => ({ kind: 'product', mode: 'feed', feed: { category: '7'.repeat(n) } }), 80, (b) => b.feed.category.length],
  ['a display rule\'s value', (n) => ({ kind: 'text', text: 'x', display: { show: { join: 'all', clauses: [{ kind: 'profile', field: 'f', op: 'eq', value: '7'.repeat(n) }] } } }), 120, (b) => b.display.show.clauses[0].value.length],
  ['a link inside a column', (n) => ({ kind: 'columns', columns: [{ blocks: [{ id: 'c', kind: 'button', label: 'Buy', url: '7'.repeat(n) }] }] }), 500, (b) => b.columns[0].blocks[0].url.length]
];

test('the nested fields: each is cut by cleanBlock at the length named, refused one past it and kept at it', () => {
  for (const [what, make, limit, keptLength] of NESTED) {
    assert.equal(keptLength(cleanBlock(make(limit + 1), 0, 0)), limit, `${what}: cleanBlock no longer cuts it at ${limit}`);
    assert.equal(blocksWouldClip([{ id: 'n', ...make(limit + 1) }]), true, `${what}: ${limit + 1} characters are not refused`);
    assert.equal(blocksWouldClip([{ id: 'n', ...make(limit) }]), false, `${what}: ${limit} characters are refused`);
  }
});

// Each list cleanBlockList or cleanBlock cuts to a count: [what, make(count), the count it keeps, how to read the kept count].
const line = (i) => ({ id: `b${i}`, kind: 'text', text: `Line ${i}` });
const LISTS = [
  ['blocks in an email', (n) => Array.from({ length: n }, (_, i) => line(i)), 24, (blocks) => cleanBlockList(blocks).length, true],
  ['blocks in a column', (n) => [{ id: 'c', kind: 'columns', columns: [{ blocks: Array.from({ length: n }, (_, i) => line(i)) }] }], 8, (blocks) => cleanBlockList(blocks)[0].columns[0].blocks.length],
  ['columns', (n) => [{ id: 'c', kind: 'columns', columns: Array.from({ length: n }, () => ({ blocks: [] })) }], 4, (blocks) => cleanBlockList(blocks)[0].columns.length],
  ['split cells', (n) => [{ id: 's', kind: 'split', cells: Array.from({ length: n }, () => ({ kind: 'text', text: 'x' })) }], 2, (blocks) => cleanBlockList(blocks)[0].cells.length],
  ['table headings', (n) => [{ id: 't', kind: 'table', headers: Array.from({ length: n }, () => 'h'), rows: [['x']] }], 8, (blocks) => cleanBlockList(blocks)[0].headers.length],
  ['table rows', (n) => [{ id: 't', kind: 'table', headers: ['h'], rows: Array.from({ length: n }, () => ['x']) }], 20, (blocks) => cleanBlockList(blocks)[0].rows.length],
  ['cells in a table row', (n) => [{ id: 't', kind: 'table', headers: ['h'], rows: [Array.from({ length: n }, () => 'x')] }], 8, (blocks) => cleanBlockList(blocks)[0].rows[0].length],
  ['social links', (n) => [{ id: 's', kind: 'social', links: Array.from({ length: n }, () => ({ network: 'facebook', url: 'https://f.example.test' })) }], 7, (blocks) => cleanBlockList(blocks)[0].links.length],
  ['header links', (n) => [{ id: 'h', kind: 'header', links: Array.from({ length: n }, () => ({ label: 'Shop', url: 'https://s.example.test' })) }], 6, (blocks) => cleanBlockList(blocks)[0].links.length],
  ['products', (n) => [{ id: 'p', kind: 'product', products: Array.from({ length: n }, (_, i) => ({ title: `Product ${i}` })) }], 9, (blocks) => cleanBlockList(blocks)[0].products.length]
];

test('every list cut to a count: refused one past it and kept at it', () => {
  for (const [what, make, limit, keptCount] of LISTS) {
    assert.equal(keptCount(make(limit + 1)), limit, `${what}: the cleaner no longer keeps ${limit}`);
    assert.equal(blocksWouldClip(make(limit + 1)), true, `${what}: ${limit + 1} are not refused`);
    assert.equal(blocksWouldClip(make(limit)), false, `${what}: ${limit} are refused`);
  }
});

test('nothing is refused that the cleaner keeps whole: the seeded emails, cleaned characters, an id, a nested columns block refused', () => {
  const src = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const literal = (name) => {
    const start = src.indexOf(`const ${name} = [`);
    assert.ok(start >= 0, `server.mjs no longer defines ${name}`);
    return src.slice(src.indexOf('[', start), src.indexOf('\n];\n', start) + 2);
  };
  const block = (id, kind, text, extra) => ({ id, kind, text: text || '', ...(extra || {}) });
  const seeded = [
    ...new Function('block', `return ${literal('AUTOMATION_DEFAULTS')}`)(block).flatMap((row) => row.steps.map((step) => step.blocks)),
    ...new Function('block', `return ${literal('TRANSACTIONAL_DEFAULTS')}`)(block).map((row) => row.blocks)
  ];
  assert.ok(seeded.length >= 6, `only ${seeded.length} seeded emails were read`);
  for (const blocks of seeded) assert.equal(blocksWouldClip(blocks), false, JSON.stringify(blocks).slice(0, 160));
  // Cleaned, not cut: characters a field does not keep, a colour, an unknown kind, an id longer than 40.
  assert.equal(blocksWouldClip([{ id: 'c', kind: 'coupon', name: 'Spring sale!!', prefix: 'save-20' }]), false);
  assert.equal(blocksWouldClip([{ id: 'x'.repeat(80), kind: 'text', text: 'Hello', background: '#FFFFFF80' }]), false);
  assert.equal(blocksWouldClip([{ id: 'u', kind: 'not-a-kind', text: 'Hello' }]), false);
  assert.equal(blocksWouldClip([{ id: 'b', kind: 'button', label: '', url: '' }]), false);
  assert.equal(blocksWouldClip(undefined), false);
  // A columns block inside a column is kept as an empty text block: refused.
  const nested = [{ id: 'c', kind: 'columns', columns: [{ blocks: [{ id: 'n', kind: 'columns', columns: [{ blocks: [line(1)] }] }] }] }];
  assert.equal(cleanBlockList(nested)[0].columns[0].blocks[0].kind, 'text');
  assert.equal(blocksWouldClip(nested), true);
});
