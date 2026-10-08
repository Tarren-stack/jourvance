// The map a blueprint shows before Replace or Create new (#33): laid out by rank so no two
// boxes overlap on any shipped blueprint, every line joins two boxes, the words match, and the
// confirm prompt renders it ABOVE the two choices.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';
import { layoutPreview, rankNodes, describePreview, previewLabel, PREVIEW_TYPE_COLORS, PREVIEW_TYPE_NAMES } from './src/lib/blueprintPreview.ts';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('every shipped blueprint lays out inside the frame with no two boxes overlapping', () => {
  assert.ok(ECOM_BLUEPRINTS.length >= 5, `expected the blueprint library, saw ${ECOM_BLUEPRINTS.length}`);
  for (const bp of ECOM_BLUEPRINTS) {
    const l = layoutPreview(bp.nodes, bp.edges);
    assert.equal(l.boxes.length, bp.nodes.length, `${bp.id}: one box per step`);
    for (const b of l.boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height, `${bp.id}: ${b.id} is inside the frame`);
      assert.ok(b.label.length > 0 && b.label.length <= 24, `${bp.id}: ${b.id} has a short label`);
    }
    for (let i = 0; i < l.boxes.length; i++) for (let j = i + 1; j < l.boxes.length; j++) {
      assert.ok(!overlaps(l.boxes[i], l.boxes[j]), `${bp.id}: ${l.boxes[i].id} overlaps ${l.boxes[j].id}`);
    }
    const ids = new Set(l.boxes.map((b) => b.id));
    for (const line of l.lines) assert.ok(ids.has(line.source) && ids.has(line.target), `${bp.id}: ${line.id} joins two boxes`);
    const wanted = bp.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target).length;
    assert.equal(l.lines.length, wanted, `${bp.id}: every line between real steps is drawn`);
  }
});

test('rank follows the lines, a loop ends, and a forward line leaves the right edge', () => {
  const n = (id, type = 'landing-page', y = 0) => ({ id, type, position: { x: 0, y }, data: { type, label: id } });
  const nodes = [n('a', 'ad-source'), n('b'), n('c', 'lead-form', 100), n('d', 'thank-you')];
  const edges = [
    { id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'c' }, { id: '3', source: 'b', target: 'd' },
    { id: '4', source: 'd', target: 'b' } // a loop back
  ];
  const r = rankNodes(nodes, edges);
  assert.deepEqual([r.get('a'), r.get('b'), r.get('c'), r.get('d')], [0, 1, 2, 2]);
  const l = layoutPreview(nodes, edges);
  assert.equal(l.columns, 3);
  const box = (id) => l.boxes.find((b) => b.id === id);
  assert.ok(box('b').x > box('a').x && box('c').x > box('b').x);
  const forward = l.lines.find((x) => x.id === '1');
  assert.equal(forward.back, false);
  assert.equal(forward.x1, box('a').x + box('a').w);
  assert.equal(forward.x2, box('b').x);
  assert.equal(l.lines.find((x) => x.id === '4').back, true);
  assert.match(describePreview(l), /^4 steps in 3 columns: Ad “a”, then Page “b”, then /);
  assert.equal(layoutPreview([], []).boxes.length, 0);
});

test('labels fall back to the headline, then the type name, and are cut with an ellipsis', () => {
  assert.equal(previewLabel({ id: 'x', type: 'upsell', data: { headline: 'Add the serum for 20% off today' } }), 'Add the serum for 20% o…');
  assert.equal(previewLabel({ id: 'x', type: 'lead-form', data: {} }), 'Form');
  for (const t of Object.keys(PREVIEW_TYPE_NAMES)) assert.ok(PREVIEW_TYPE_COLORS[t], `${t} has a colour`);
});

test('the confirm prompt draws the map above the Replace and Create new choices', () => {
  const src = fs.readFileSync(new URL('./src/components/modals/BlueprintModal.tsx', import.meta.url), 'utf8');
  const prompt = src.slice(src.indexOf('{showConfirmPrompt && selectedBlueprint && ('));
  const map = prompt.indexOf('<BlueprintPreviewMap nodes={selectedBlueprint.nodes} edges={selectedBlueprint.edges} />');
  const replace = prompt.indexOf("handleConfirmLoad('replace')");
  const create = prompt.indexOf("handleConfirmLoad('new')");
  assert.ok(map > 0 && replace > map && create > replace, `map ${map}, replace ${replace}, new ${create}`);
  assert.match(src, /import \{ BlueprintPreviewMap \} from '\.\/BlueprintPreviewMap'/);
  const comp = fs.readFileSync(new URL('./src/components/modals/BlueprintPreviewMap.tsx', import.meta.url), 'utf8');
  assert.match(comp, /data-testid="blueprint-preview"/);
  assert.match(comp, /role="img"/);
  assert.match(comp, /<title>\{words\}<\/title>/);
});
