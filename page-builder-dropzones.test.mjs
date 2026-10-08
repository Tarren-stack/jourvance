import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Where a dragged thing may land on the page builder's canvas (LANDING_BUILDER_DESIGN.md section 4),
// where a palette click puts it, the order the keyboard walks the zones in, and the box each zone is
// drawn in. Then the canvas's pure parts: no script from the page ever reaches the shadow root, and
// every prop the registry marks as editable in place has an element the canvas can edit.
//
// dropZones.ts and canvasMarkup.ts are pure, so they load here as they are.

const {
  candidateZones,
  dropZonesFor,
  planDrop,
  appendZone,
  readingOrder,
  zoneGeometry,
  zoneId,
  describeZone,
  createLayout,
  LAYOUTS
} = await import('./src/components/builder/dropZones.ts');
const canvas = await import('./src/components/builder/canvasMarkup.ts');
const { createBuilderState, builderReducer, nodeLabel } = await import('./src/components/builder/builderState.ts');
const model = await import('./src/lib/pageBuilder/model.mjs');
const { render, renderWidget } = await import('./src/lib/pageBuilder/render.mjs');
const { migrateLegacyPage, createNode, findNode, insertNode, WIDGET_REGISTRY } = model;
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const startPage = () => structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data);
const baseDoc = () => migrateLegacyPage(startPage());

/**
 * The fixture every rule below is read against:
 *   page: Offer, Reviews, Empty
 *   Offer: media column [product], copy column [inner section, headline, checkout]
 *     inner section: inner-a [text], inner-b (empty)
 *   Reviews: one column [reviews wall]
 *   Empty: one empty column
 */
function fixture() {
  let doc = baseDoc();
  const inner = createNode('section');
  inner.id = 'inner';
  inner.children = [createNode('column'), createNode('column')];
  inner.children[0].id = 'inner-a';
  inner.children[1].id = 'inner-b';
  const text = createNode('widget', 'text');
  text.id = 'inner-text';
  inner.children[0].children = [text];
  let r = insertNode(doc, 'legacy-offer-copy', 0, inner);
  assert.ok(r.ok, r.reason);
  doc = r.doc;
  const empty = createNode('section');
  empty.id = 'empty-sec';
  empty.children[0].id = 'empty-col';
  r = insertNode(doc, null, doc.sections.length, empty);
  assert.ok(r.ok, r.reason);
  return r.doc;
}

/** Props that make every widget draw something. The HTML embed carries hostile markup on purpose. */
const FILL = {
  heading: { text: 'Book a fitting', link: '/book' },
  text: { text: 'Some **bold** and a [link](https://example.com).' },
  image: { src: 'https://example.com/a.jpg', alt: 'A dress', caption: 'Ours' },
  button: { label: 'Go', url: 'https://example.com', newTab: true },
  video: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Our story' },
  htmlEmbed: { html: '<p onclick="alert(1)">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><SCRIPT SRC=//evil></SCRIPT>', title: 'Embed' },
  iconList: { items: [{ text: 'One' }, { text: 'Two' }] },
  testimonials: { items: [{ quote: 'Lovely', name: 'Ana', role: 'Leeds', avatarUrl: '', rating: 5 }] },
  faq: { items: [{ question: 'When?', answer: 'Now.' }] },
  countdown: { minutes: 10 },
  leadForm: { heading: 'Join' },
  productHero: { imageUrl: 'https://example.com/p.jpg', price: '$10', productId: '1', variantId: '2' },
  checkoutButton: { label: 'Buy', discountCode: 'SAVE' },
  orderBump: { variantId: '3', price: '$5', description: 'A small extra.' },
  reviewsWall: { headline: 'Reviews' },
  stockCount: { count: 4 },
  trustBadge: { text: 'Free returns', icon: 'shield' }
};
const REVIEWS = { summary: { averageRating: 4.8, totalCount: 1 }, reviews: [{ rating: 5, reviewText: 'Great', customerName: 'Bo' }] };

const ids = zones => zones.map(z => z.id).sort();
const z = (parent, ...befores) => befores.map(b => zoneId(parent, b));
const sorted = list => [...list].sort();

describe('the candidate gaps', () => {
  test('every container has one gap more than it has children; an empty one has exactly one', () => {
    const doc = fixture();
    const zones = candidateZones(doc);
    assert.equal(zones.length, 26);
    const empties = zones.filter(zone => zone.empty).map(zone => zone.id).sort();
    assert.deepEqual(empties, ['zone:empty-col:0', 'zone:inner-b:0']);
    assert.deepEqual(zones.filter(zone => zone.container === 'page').map(zone => zone.id), z('page', 0, 1, 2, 3));
  });
});

describe('which zones exist for each kind of drag (design section 4)', () => {
  test('a palette widget: any column, top-level or inner, at any place; between sections; never straight into a section', () => {
    const zones = dropZonesFor(fixture(), { kind: 'widget', widgetType: 'heading' });
    assert.deepEqual(ids(zones), sorted([
      ...z('page', 0, 1, 2, 3),
      ...z('legacy-offer-media', 0, 1),
      ...z('legacy-offer-copy', 0, 1, 2, 3),
      ...z('inner-a', 0, 1),
      ...z('inner-b', 0),
      ...z('legacy-reviews-col', 0, 1),
      ...z('empty-col', 0)
    ]));
    assert.ok(zones.every(zone => zone.container !== 'section'));
  });

  test('a palette layout: between sections, or inside a top-level column as an inner section; never inside an inner section\'s column', () => {
    const zones = dropZonesFor(fixture(), { kind: 'layout', columns: [0, 0] });
    assert.deepEqual(ids(zones), sorted([
      ...z('page', 0, 1, 2, 3),
      ...z('legacy-offer-media', 0, 1),
      ...z('legacy-offer-copy', 0, 1, 2, 3),
      ...z('legacy-reviews-col', 0, 1),
      ...z('empty-col', 0)
    ]));
  });

  test('a section with no inner section: between sections, or into a top-level column; never into itself or an inner column', () => {
    const zones = dropZonesFor(fixture(), { kind: 'node', id: 'legacy-reviews' });
    assert.deepEqual(ids(zones), sorted([
      ...z('page', 0, 3),
      ...z('legacy-offer-media', 0, 1),
      ...z('legacy-offer-copy', 0, 1, 2, 3),
      ...z('empty-col', 0)
    ]));
  });

  test('a section holding an inner section: only between sections', () => {
    const zones = dropZonesFor(fixture(), { kind: 'node', id: 'legacy-offer' });
    assert.deepEqual(ids(zones), sorted(z('page', 2, 3)));
  });

  test('a column: beside its siblings, or into another section with room; never onto the page', () => {
    assert.deepEqual(ids(dropZonesFor(fixture(), { kind: 'node', id: 'legacy-offer-copy' })), sorted([
      ...z('legacy-offer', 0),
      ...z('legacy-reviews', 0, 1),
      ...z('empty-sec', 0, 1)
    ]), 'not into the inner section: the copy column holds an inner section of its own');
    assert.deepEqual(ids(dropZonesFor(fixture(), { kind: 'node', id: 'inner-b' })), sorted([
      ...z('inner', 0),
      ...z('legacy-offer', 0, 1, 2),
      ...z('legacy-reviews', 0, 1),
      ...z('empty-sec', 0, 1)
    ]));
  });

  test('a section\'s only column has nowhere to go', () => {
    assert.deepEqual(dropZonesFor(fixture(), { kind: 'node', id: 'legacy-reviews-col' }), []);
  });

  test('a column never goes into a section that already has six', () => {
    let doc = fixture();
    for (let i = 0; i < 5; i++) {
      const r = insertNode(doc, 'legacy-reviews', 1, createNode('column'));
      assert.ok(r.ok, r.reason);
      doc = r.doc;
    }
    assert.equal(findNode(doc, 'legacy-reviews').node.children.length, 6);
    const zones = ids(dropZonesFor(doc, { kind: 'node', id: 'inner-b' }));
    assert.ok(!zones.some(id => id.startsWith('zone:legacy-reviews:')));
  });

  test('a widget: any column at any place, never a section or the page, and never where it already is', () => {
    const zones = dropZonesFor(fixture(), { kind: 'node', id: 'legacy-headline' });
    assert.deepEqual(ids(zones), sorted([
      ...z('legacy-offer-media', 0, 1),
      ...z('legacy-offer-copy', 0, 3),
      ...z('inner-a', 0, 1),
      ...z('inner-b', 0),
      ...z('legacy-reviews-col', 0, 1),
      ...z('empty-col', 0)
    ]));
  });

  test('an inner section: within its column, another top-level column, or out onto the page; never an inner column', () => {
    const zones = dropZonesFor(fixture(), { kind: 'node', id: 'inner' });
    assert.deepEqual(ids(zones), sorted([
      ...z('legacy-offer-copy', 2, 3),
      ...z('legacy-offer-media', 0, 1),
      ...z('legacy-reviews-col', 0, 1),
      ...z('empty-col', 0),
      ...z('page', 0, 1, 2, 3)
    ]));
  });

  test('every zone drawn is one the model accepts, and every refused gap is left out', () => {
    const doc = fixture();
    for (const item of [
      { kind: 'widget', widgetType: 'image' },
      { kind: 'layout', columns: [33, 67] },
      { kind: 'node', id: 'legacy-reviews' },
      { kind: 'node', id: 'inner-b' },
      { kind: 'node', id: 'legacy-checkout' },
      { kind: 'node', id: 'inner' }
    ]) {
      const drawn = new Set(dropZonesFor(doc, item).map(zone => zone.id));
      for (const zone of candidateZones(doc)) {
        const plan = planDrop(doc, item, zone);
        const accepted = plan.ok && (plan.action.type === 'insert'
          ? insertNode(doc, plan.action.parentId, plan.action.index, plan.action.node).ok
          : model.moveNode(doc, plan.action.id, plan.action.parentId, plan.action.index).ok);
        assert.equal(drawn.has(zone.id), accepted, `${JSON.stringify(item)} at ${zone.id}`);
      }
    }
  });
});

describe('where a drop lands', () => {
  test('a palette widget dropped between sections gets a one-column section of its own, and the widget is what gets selected', () => {
    const doc = fixture();
    const plan = planDrop(doc, { kind: 'widget', widgetType: 'heading' }, { id: zoneId(null, 1), parentId: null, before: 1, container: 'page', empty: false });
    assert.ok(plan.ok);
    const { action } = plan;
    assert.equal(action.type, 'insert');
    assert.equal(action.parentId, null);
    assert.equal(action.index, 1);
    assert.equal(action.node.kind, 'section');
    assert.equal(action.node.children.length, 1);
    assert.equal(action.node.children[0].children[0].type, 'heading');
    assert.equal(action.select, action.node.children[0].children[0].id);
    const s = builderReducer(createBuilderState(doc), action);
    assert.equal(s.doc.sections[1].id, action.node.id);
    assert.equal(s.selectedId, action.select);
  });

  test('a palette widget dropped in a column is inserted at that place', () => {
    const doc = fixture();
    const plan = planDrop(doc, { kind: 'widget', widgetType: 'heading' }, { id: zoneId('legacy-offer-media', 0), parentId: 'legacy-offer-media', before: 0, container: 'column', empty: false });
    const s = builderReducer(createBuilderState(doc), plan.action);
    const kids = findNode(s.doc, 'legacy-offer-media').node.children;
    assert.deepEqual(kids.map(k => k.type), ['heading', 'productHero']);
    assert.equal(s.selectedId, kids[0].id);
  });

  test('a palette layout makes a section with its column widths', () => {
    for (const layout of LAYOUTS) {
      const section = createLayout(layout.columns);
      assert.equal(section.children.length, layout.columns.length, layout.label);
      section.children.forEach((col, i) => {
        assert.equal(col.style.desktop.width, layout.columns[i] > 0 ? layout.columns[i] : undefined, `${layout.label} column ${i + 1}`);
      });
      assert.ok(insertNode(fixture(), null, 0, section).ok, layout.label);
    }
  });

  test('a moved node: a gap after its own place counts after it has left, as moveNode counts', () => {
    const doc = fixture();
    const plan = planDrop(doc, { kind: 'node', id: 'legacy-headline' }, { id: zoneId('legacy-offer-copy', 3), parentId: 'legacy-offer-copy', before: 3, container: 'column', empty: false });
    assert.deepEqual(plan.action, { type: 'move', id: 'legacy-headline', parentId: 'legacy-offer-copy', index: 2 });
    const s = builderReducer(createBuilderState(doc), plan.action);
    assert.deepEqual(findNode(s.doc, 'legacy-offer-copy').node.children.map(c => c.id), ['inner', 'legacy-checkout', 'legacy-headline']);
    const up = planDrop(doc, { kind: 'node', id: 'legacy-checkout' }, { id: zoneId('legacy-offer-copy', 0), parentId: 'legacy-offer-copy', before: 0, container: 'column', empty: false });
    assert.equal(up.action.index, 0);
  });

  test('a drop where the node already is changes nothing', () => {
    const doc = fixture();
    for (const before of [1, 2]) {
      const plan = planDrop(doc, { kind: 'node', id: 'legacy-headline' }, { id: zoneId('legacy-offer-copy', before), parentId: 'legacy-offer-copy', before, container: 'column', empty: false });
      assert.equal(plan.ok, false);
      assert.equal(plan.noop, true);
    }
  });

  test('two sections swap through a page zone', () => {
    const doc = fixture();
    const plan = planDrop(doc, { kind: 'node', id: 'legacy-reviews' }, { id: zoneId(null, 0), parentId: null, before: 0, container: 'page', empty: false });
    const s = builderReducer(createBuilderState(doc), plan.action);
    assert.deepEqual(s.doc.sections.map(x => x.id), ['legacy-reviews', 'legacy-offer', 'empty-sec']);
  });

  test('a drop the model refuses through the reducer leaves the document as it was', () => {
    const doc = fixture();
    const s0 = createBuilderState(doc);
    const plan = planDrop(doc, { kind: 'node', id: 'legacy-offer' }, { id: zoneId('inner-b', 0), parentId: 'inner-b', before: 0, container: 'column', empty: true });
    assert.ok(plan.ok, 'the plan is made; the model decides');
    const s = builderReducer(s0, plan.action);
    assert.equal(s.doc, doc);
    assert.ok(s.notice);
  });

  test('an unknown widget type and a node no longer on the page are refused', () => {
    const doc = fixture();
    const zone = { id: zoneId(null, 0), parentId: null, before: 0, container: 'page', empty: false };
    assert.equal(planDrop(doc, { kind: 'widget', widgetType: 'marquee' }, zone).ok, false);
    assert.equal(planDrop(doc, { kind: 'node', id: 'gone' }, zone).ok, false);
  });
});

describe('where a palette click puts it', () => {
  test('a widget goes after the selected widget, at the end of a selected column, or into the selected section\'s last column', () => {
    const doc = fixture();
    const widget = { kind: 'widget', widgetType: 'text' };
    assert.equal(appendZone(doc, widget, 'legacy-headline').id, zoneId('legacy-offer-copy', 2));
    assert.equal(appendZone(doc, widget, 'legacy-offer-media').id, zoneId('legacy-offer-media', 1));
    assert.equal(appendZone(doc, widget, 'legacy-reviews').id, zoneId('legacy-reviews-col', 1));
    assert.equal(appendZone(doc, widget, 'inner-text').id, zoneId('inner-a', 1));
  });

  test('with nothing selected it goes at the end of the last column, and on an empty page into a new section', () => {
    assert.equal(appendZone(fixture(), { kind: 'widget', widgetType: 'text' }, null).id, zoneId('empty-col', 0));
    const empty = model.createEmptyPage();
    const zone = appendZone(empty, { kind: 'widget', widgetType: 'text' }, null);
    assert.equal(zone.id, zoneId(null, 0));
    const s = builderReducer(createBuilderState(empty), planDrop(empty, { kind: 'widget', widgetType: 'text' }, zone).action);
    assert.equal(s.doc.sections.length, 1);
    assert.equal(s.doc.sections[0].children[0].children[0].type, 'text');
  });

  test('a layout goes after the section holding the selection, or at the end of the page', () => {
    const doc = fixture();
    const layout = { kind: 'layout', columns: [0, 0] };
    assert.equal(appendZone(doc, layout, null).id, zoneId(null, 3));
    assert.equal(appendZone(doc, layout, 'legacy-reviews').id, zoneId(null, 2));
    assert.equal(appendZone(doc, layout, 'inner-text').id, zoneId(null, 1));
  });
});

describe('the keyboard walks zones in reading order', () => {
  test('before a section, then inside it column by column, then after it', () => {
    const doc = fixture();
    const zones = dropZonesFor(doc, { kind: 'widget', widgetType: 'text' });
    assert.deepEqual(readingOrder(doc, zones).map(zone => zone.id), [
      'zone:page:0',
      'zone:legacy-offer-media:0', 'zone:legacy-offer-media:1',
      'zone:legacy-offer-copy:0',
      'zone:inner-a:0', 'zone:inner-a:1',
      'zone:inner-b:0',
      'zone:legacy-offer-copy:1', 'zone:legacy-offer-copy:2', 'zone:legacy-offer-copy:3',
      'zone:page:1',
      'zone:legacy-reviews-col:0', 'zone:legacy-reviews-col:1',
      'zone:page:2',
      'zone:empty-col:0',
      'zone:page:3'
    ]);
  });

  test('a zone is described in words, never by id', () => {
    const doc = fixture();
    const label = id => nodeLabel(doc, id);
    const at = (parentId, before, container, empty = false) => describeZone(doc, { id: zoneId(parentId, before), parentId, before, container, empty }, label);
    assert.equal(at(null, 0, 'page'), 'the top of the page');
    assert.equal(at(null, 1, 'page'), 'the page, between Offer and Reviews');
    assert.equal(at(null, 3, 'page'), 'the bottom of the page');
    assert.equal(at('legacy-offer-copy', 1, 'column'), 'Offer, Column 2, position 2 of 4');
    assert.equal(at('empty-col', 0, 'column', true), 'Column 1, which is empty');
  });
});

describe('the box a zone is drawn in', () => {
  const R = (left, top, width, height) => ({ left, top, width, height });

  test('between stacked children: a bar across the container at the middle of the gap', () => {
    const doc = fixture();
    const rects = { 'legacy-offer-copy': R(10, 0, 200, 300), inner: R(10, 0, 200, 50), 'legacy-headline': R(10, 70, 200, 30), 'legacy-checkout': R(10, 120, 200, 40) };
    const rectOf = id => rects[id] ?? null;
    const zone = before => ({ id: zoneId('legacy-offer-copy', before), parentId: 'legacy-offer-copy', before, container: 'column', empty: false });
    const page = R(0, 0, 800, 600);
    assert.deepEqual(zoneGeometry(doc, zone(1), rectOf, page), R(10, 52, 200, 16));
    assert.deepEqual(zoneGeometry(doc, zone(0), rectOf, page), R(10, -8, 200, 16));
    assert.deepEqual(zoneGeometry(doc, zone(3), rectOf, page), R(10, 152, 200, 16));
  });

  test('between columns side by side: an upright bar; stacked on a phone: a bar across', () => {
    const doc = fixture();
    const zone = { id: zoneId('legacy-offer', 1), parentId: 'legacy-offer', before: 1, container: 'section', empty: false };
    const page = R(0, 0, 800, 600);
    const side = { 'legacy-offer': R(0, 0, 400, 300), 'legacy-offer-media': R(0, 0, 180, 300), 'legacy-offer-copy': R(200, 0, 200, 300) };
    assert.deepEqual(zoneGeometry(doc, zone, id => side[id] ?? null, page), R(182, 0, 16, 300));
    const stacked = { 'legacy-offer': R(0, 0, 390, 600), 'legacy-offer-media': R(0, 0, 390, 280), 'legacy-offer-copy': R(0, 300, 390, 300) };
    assert.deepEqual(zoneGeometry(doc, zone, id => stacked[id] ?? null, page), R(0, 282, 390, 16));
  });

  test('an empty column is one zone over its whole box, at least three bars tall', () => {
    const doc = fixture();
    const zone = { id: zoneId('empty-col', 0), parentId: 'empty-col', before: 0, container: 'column', empty: true };
    assert.deepEqual(zoneGeometry(doc, zone, id => (id === 'empty-col' ? R(5, 400, 300, 20) : null), R(0, 0, 800, 600)), R(5, 400, 300, 48));
  });

  test('a child not drawn on this device is skipped; a container not drawn has no zone', () => {
    const doc = fixture();
    const rects = { 'legacy-offer-copy': R(0, 0, 200, 300), inner: R(0, 0, 200, 50), 'legacy-headline': R(0, 0, 0, 0), 'legacy-checkout': R(0, 100, 200, 40) };
    const zone = { id: zoneId('legacy-offer-copy', 2), parentId: 'legacy-offer-copy', before: 2, container: 'column', empty: false };
    assert.deepEqual(zoneGeometry(doc, zone, id => rects[id] ?? null, R(0, 0, 800, 600)), R(0, 67, 200, 16));
    assert.equal(zoneGeometry(doc, zone, () => null, R(0, 0, 800, 600)), null);
  });

  test('page gaps use the page root\'s width', () => {
    const doc = fixture();
    const rects = { 'legacy-offer': R(0, 0, 1000, 400), 'legacy-reviews': R(0, 420, 1000, 200), 'empty-sec': R(0, 640, 1000, 80) };
    const zone = { id: zoneId(null, 1), parentId: null, before: 1, container: 'page', empty: false };
    assert.deepEqual(zoneGeometry(doc, zone, id => rects[id] ?? null, R(0, 0, 1000, 720)), R(0, 402, 1000, 16));
  });
});

describe('the canvas never runs the page\'s script', () => {
  /** A page holding one of every widget, filled in, with hostile markup in the HTML embed. */
  function everyWidget() {
    let doc = model.createEmptyPage();
    doc = insertNode(doc, null, 0, createNode('section')).doc;
    const col = doc.sections[0].children[0].id;
    for (const type of Object.keys(WIDGET_REGISTRY)) {
      const w = createNode('widget', type);
      w.props = { ...w.props, ...(FILL[type] || {}) };
      const r = insertNode(doc, col, findNode(doc, col).node.children.length, w);
      assert.ok(r.ok, `${type}: ${r.reason}`);
      doc = r.doc;
    }
    return doc;
  }
  const reviews = REVIEWS;

  test('the renderer writes no script element and no event handler, on the page or on any canvas device', () => {
    const doc = everyWidget();
    for (const device of [undefined, 'desktop', 'tablet', 'mobile']) {
      const out = render(doc, { device, reviews });
      assert.deepEqual(out.problems, []);
      assert.ok(out.html.length > 2000, 'every widget drew something');
      assert.doesNotMatch(out.html, /<script/i, `no script (${device ?? 'published'})`);
      assert.doesNotMatch(out.html, /\son[a-z]+\s*=/i, `no event handler attribute (${device ?? 'published'})`);
      assert.doesNotMatch(out.html, /javascript:/i);
      assert.doesNotMatch(out.css, /<\/?script/i);
    }
    for (const [type] of Object.entries(WIDGET_REGISTRY)) {
      const id = doc.sections[0].children[0].children.find(w => w.type === type).id;
      assert.ok(render(doc, { reviews }).html.includes(`jvb-n-${id}`), `${type} is drawn`);
    }
  });

  test('stripScripts takes out any script anyway, closed, unclosed or upper case', () => {
    for (const [input, out] of [
      ['<p>a</p><script>alert(1)</script><p>b</p>', '<p>a</p><p>b</p>'],
      ['<SCRIPT SRC="//x"></SCRIPT>ok', 'ok'],
      ['x<script >var a = "</p>";</script >y', 'xy'],
      ['before<script src=x', 'before'],
      ['<scripts>is a tag name the parser keeps</scripts>', '<scripts>is a tag name the parser keeps</scripts>']
    ]) {
      assert.equal(canvas.stripScripts(input), out, input);
    }
    assert.equal(canvas.stripScripts(null), '');
  });

  test('event handler attributes and script links are recognised however they are written', () => {
    for (const name of ['onclick', 'ONERROR', 'onLoad', 'onpointerdown']) assert.equal(canvas.isHandlerAttribute(name), true, name);
    for (const name of ['href', 'class', 'data-on', 'alt']) assert.equal(canvas.isHandlerAttribute(name), false, name);
    for (const v of ['javascript:alert(1)', ' JaVaScRiPt:x', 'java\nscript:x', 'vbscript:x', 'data:text/html,<b>']) assert.equal(canvas.isUnsafeUrl(v), true, v);
    for (const v of ['https://example.com', '/p/x', '#offer', 'data:image/png;base64,AAAA']) assert.equal(canvas.isUnsafeUrl(v), false, v);
  });
});

describe('editing text in place', () => {
  test('every prop the registry marks inline has an element the canvas edits, and nothing else is listed', () => {
    for (const [type, def] of Object.entries(WIDGET_REGISTRY)) {
      const listed = (canvas.INLINE_TARGETS[type] ?? []).map(t => t.path).sort();
      assert.deepEqual(listed, [...def.inlineEditable].sort(), type);
    }
  });

  test('each listed element is really drawn by the renderer, where the canvas looks for it', () => {
    // Every class and tag a selector names must be in that widget's own markup when it is filled
    // in, so a class renamed in render.mjs fails here before it fails on the canvas.
    const parts = selector => selector.split(/[\s>]+/).map(p => p.replace(/:[a-z-]+(\([^)]*\))?/g, '').replace(/\[[^\]]*\]/g, '')).filter(Boolean);
    let checked = 0;
    for (const [type, targets] of Object.entries(canvas.INLINE_TARGETS)) {
      const w = createNode('widget', type);
      w.props = { ...w.props, ...(FILL[type] || {}) };
      const html = renderWidget(w, { reviews: REVIEWS });
      assert.ok(html, `${type} draws something when filled in`);
      for (const t of targets) {
        for (const sel of [t.selector, t.list?.itemSelector].filter(Boolean)) {
          for (const part of parts(sel)) {
            if (part.startsWith('.')) assert.match(html, new RegExp(`class="[^"]*\\b${part.slice(1)}\\b`), `${type} ${t.path}: ${part}`);
            else assert.ok(html.includes(`<${part}`), `${type} ${t.path}: <${part}>`);
            checked += 1;
          }
        }
      }
    }
    assert.ok(checked >= 25, `${checked} selector parts checked`);
  });

  test('a drawn item maps back to its prop index, skipping the items the renderer left out', () => {
    const items = [{ text: 'One' }, { text: '  ' }, { text: '' }, { text: 'Four' }];
    assert.equal(canvas.itemPropIndex(items, 'text', 0), 0);
    assert.equal(canvas.itemPropIndex(items, 'text', 1), 3);
    assert.equal(canvas.itemPropIndex(items, 'text', 2), -1);
    assert.equal(canvas.itemPropIndex(null, 'text', 0), -1);
  });

  test('an inline edit writes one prop, or the whole list with one item\'s field changed', () => {
    const faq = createNode('widget', 'faq');
    faq.props.items = [{ question: 'A?', answer: 'a' }, { question: 'B?', answer: 'b' }];
    const target = canvas.INLINE_TARGETS.faq.find(t => t.path === 'items.*.answer');
    assert.deepEqual(canvas.inlinePatch(faq, target, 1, 'bee'), { items: [{ question: 'A?', answer: 'a' }, { question: 'B?', answer: 'bee' }] });
    assert.equal(canvas.inlinePatch(faq, target, 5, 'x'), null);
    assert.equal(canvas.inlineValue(faq, target, 0), 'a');
    const heading = createNode('widget', 'heading');
    assert.deepEqual(canvas.inlinePatch(heading, canvas.INLINE_TARGETS.heading[0], 0, 'Hi'), { text: 'Hi' });
    assert.equal(canvas.inlineLabel('faq', 'items.*.answer'), 'Answer');
    assert.equal(canvas.inlineLabel('heading', 'text'), 'Text');
    assert.equal(canvas.inlineMultiline('faq', 'items.*.answer'), true);
    assert.equal(canvas.inlineMultiline('button', 'label'), false);
  });

  test('a single-line prop keeps typed line breaks as spaces; a multi-line prop keeps them', () => {
    assert.equal(canvas.cleanInlineText('Buy\nnow\n', false), 'Buy now ');
    assert.equal(canvas.cleanInlineText('Line one\nLine two\n\n', true), 'Line one\nLine two');
    assert.equal(canvas.cleanInlineText('a b\r\nc', true), 'a b\nc');
  });

  test('every widget has an empty-state hint, in plain words with no em dash, shown on the canvas only', () => {
    for (const type of Object.keys(WIDGET_REGISTRY)) {
      const hint = canvas.EMPTY_HINTS[type];
      assert.ok(typeof hint === 'string' && hint.trim(), type);
      assert.doesNotMatch(hint, /\u2014|\s\u2013\s/, type);
    }
    assert.doesNotMatch(canvas.EDITOR_CSS, /<\/?style/i);
    assert.match(canvas.EDITOR_CSS, /pointer-events:none/, 'the page\'s links and buttons take no pointer in the editor');
  });
});
