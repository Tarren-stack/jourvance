// Caption layout cost (C52): the canvas rebuilds its edges array on every keystroke because each
// line carries its cards' data, and the caption layout effect keyed on that array's identity, so
// every keystroke tore down its observers and re-placed every caption (about 20 ms a key at 120
// steps) without moving one. It now keys on edgeLineKey, which changes only when the lines do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { edgeLineKey } from './src/lib/edgeLineKey.ts';

const line = (id, source, target, extra = {}) => ({ id, source, target, type: 'conversion', ...extra });
const base = () => [
  line('e1', 'ad', 'page', { data: { sourceNodeData: { headline: 'A' } } }),
  line('e2', 'page', 'form', { sourceHandle: null, targetHandle: null, selected: false, data: { rate: 0.2 } })
];

test('a rebuilt edges array with the same lines keeps its key', () => {
  const a = base();
  const b = base();
  b[0].data.sourceNodeData.headline = 'A new headline typed into the landing page';
  b[1].selected = true;
  b[1].data = { rate: 0.4, label: 'changed' };
  b[1].style = { stroke: '#fff' };
  b[1].sourceHandle = undefined; // undefined and null both mean the main handle
  assert.notEqual(a, b);
  assert.equal(edgeLineKey(a), edgeLineKey(b));
});

test('the key changes when a line is added, removed, rejoined, retyped, hidden or shown', () => {
  const k = edgeLineKey(base());
  const changes = [
    es => es.push(line('e3', 'form', 'thanks')),
    es => es.pop(),
    es => { es[1].target = 'thanks'; },
    es => { es[1].source = 'ad'; },
    es => { es[1].sourceHandle = 'abandon'; },
    es => { es[1].targetHandle = 'retention-in'; },
    es => { es[1].type = 'loop'; },
    es => { es[1].hidden = true; },
    es => { es[1].id = 'e2b'; },
    es => es.reverse()
  ];
  for (const change of changes) {
    const es = base();
    change(es);
    assert.notEqual(edgeLineKey(es), k, String(change));
  }
  const hidden = base();
  hidden[1].hidden = true;
  const shown = base();
  shown[1].hidden = false;
  assert.notEqual(edgeLineKey(hidden), edgeLineKey(shown));
});

test('ids holding separator characters never collide', () => {
  assert.notEqual(
    edgeLineKey([line('a|b', 'c', 'd')]),
    edgeLineKey([line('a', 'b|c', 'd')])
  );
  assert.notEqual(
    edgeLineKey([line('a', 'b', 'c;d')]),
    edgeLineKey([line('a', 'b', 'c'), line('d', '', '')])
  );
  assert.equal(edgeLineKey([]), '[]');
});

test('source pin: the caption layout keys on edgeLineKey, never on the edges array', () => {
  const src = readFileSync(new URL('./src/components/canvas/EdgeLabelLayout.tsx', import.meta.url), 'utf8');
  assert.match(src, /useStore\(s => edgeLineKey\(s\.edges\)\)/);
  assert.ok(!/useStore\(s => s\.edges\)/.test(src), 'no subscription to the edges array itself');
  const deps = src.match(/\}, \[([^\]]*)\]\);\s*\n\s*return <PlacementContext/);
  assert.ok(deps, 'the layout effect deps are found');
  const names = deps[1].split(',').map(s => s.trim());
  assert.ok(!names.includes('edges'), `layout effect deps: ${names.join(', ')}`);
  assert.ok(names.includes('key') && names.includes('lines'), `layout effect deps: ${names.join(', ')}`);
});
