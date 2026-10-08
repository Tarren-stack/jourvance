import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// The page builder's editing state (LANDING_BUILDER_PLAN.md Wave 2): every reducer action, 50 steps
// of undo and redo, style edits that land on the device being edited and nowhere else, and refusals
// that leave the document exactly as it was with the model's reason as the notice.
//
// builderState.ts is pure (no React, no DOM, no clock), so it loads here as it is.

const {
  UNDO_LIMIT,
  COALESCE_MS,
  createBuilderState,
  builderReducer,
  canUndo,
  canRedo,
  nodeLabel,
  placeOf,
  siblingMove,
  crossMove,
  visibilityLayers
} = await import('./src/components/builder/builderState.ts');
const model = await import('./src/lib/pageBuilder/model.mjs');
const { migrateLegacyPage, createNode, findNode, moveNode, insertNode, removeNode, resolveStyle, validateBuilderDoc } = model;
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const startPage = () => structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data);

/** The starter page converted: Offer (product column, copy column) and Reviews. */
const baseDoc = () => migrateLegacyPage(startPage());

/** Every object in the tree frozen, so a reducer that mutates throws (ES modules are strict). */
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const run = (state, ...actions) => actions.reduce(builderReducer, state);
const childIds = (doc, id) => findNode(doc, id).node.children.map(c => c.id);
const sectionIds = doc => doc.sections.map(s => s.id);

/** A page with an inner section in the copy column, holding two inner columns. */
function nestedDoc() {
  const inner = createNode('section');
  inner.id = 'inner';
  inner.children = [createNode('column'), createNode('column')];
  inner.children[0].id = 'inner-a';
  inner.children[1].id = 'inner-b';
  const r = insertNode(baseDoc(), 'legacy-offer-copy', 0, inner);
  assert.ok(r.ok, r.reason);
  return r.doc;
}

describe('starting state and the selectors', () => {
  test('a new state holds the document, no history, nothing dirty', () => {
    const doc = baseDoc();
    const s = createBuilderState(doc);
    assert.equal(s.doc, doc);
    assert.equal(s.savedDoc, doc);
    assert.equal(s.selectedId, null);
    assert.equal(s.hoveredId, null);
    assert.equal(s.device, 'desktop');
    assert.deepEqual([s.past, s.future, s.dirty, s.notice], [[], [], false, null]);
    assert.equal(canUndo(s), false);
    assert.equal(canRedo(s), false);
    assert.equal(createBuilderState(doc, 'mobile').device, 'mobile');
    assert.equal(UNDO_LIMIT, 50);
  });
});

describe('select, hover and setDevice touch no document and no history', () => {
  test('select picks a node on the page and refuses an unknown id as null', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'select', id: 'legacy-headline' });
    assert.equal(s1.selectedId, 'legacy-headline');
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.equal(builderReducer(s1, { type: 'select', id: 'legacy-headline' }), s1, 'the same selection is the same state');
    assert.equal(builderReducer(s1, { type: 'select', id: 'not-on-the-page' }).selectedId, null);
    assert.equal(builderReducer(s1, { type: 'select', id: null }).selectedId, null);
  });

  test('hover follows the pointer and ignores ids that are not on the page', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'hover', id: 'legacy-offer' });
    assert.equal(s1.hoveredId, 'legacy-offer');
    assert.equal(builderReducer(s1, { type: 'hover', id: 'legacy-offer' }), s1);
    assert.equal(builderReducer(s1, { type: 'hover', id: 'ghost' }).hoveredId, null);
    assert.equal(s1.doc, s0.doc);
  });

  test('setDevice changes the device being edited and nothing else', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'setDevice', device: 'tablet' });
    assert.equal(s1.device, 'tablet');
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.equal(builderReducer(s1, { type: 'setDevice', device: 'tablet' }), s1);
  });
});

describe('tree changes go through the model and never mutate', () => {
  test('insert puts a new widget where asked, selects it, says where, and leaves the old document alone', () => {
    const doc = deepFreeze(baseDoc());
    const before = structuredClone(doc);
    const heading = createNode('widget', 'heading');
    const s = builderReducer(createBuilderState(doc), { type: 'insert', parentId: 'legacy-offer-media', index: 0, node: heading });
    assert.notEqual(s.doc, doc);
    assert.deepEqual(doc, before, 'the old document is unchanged');
    assert.deepEqual(childIds(s.doc, 'legacy-offer-media'), [heading.id, 'legacy-product']);
    assert.equal(s.selectedId, heading.id);
    assert.equal(s.past.length, 1);
    assert.equal(s.past[0], doc);
    assert.equal(s.dirty, true);
    assert.equal(s.notice, null);
    assert.equal(s.announcement.text, 'Heading added to Offer, column 1, position 1 of 2.');
  });

  test('insert can select a node inside the inserted one (a palette widget wrapped in a new section)', () => {
    const section = createNode('section');
    const widget = createNode('widget', 'text');
    section.children[0].children = [widget];
    const s = builderReducer(createBuilderState(baseDoc()), { type: 'insert', parentId: null, index: 0, node: section, select: widget.id });
    assert.equal(s.selectedId, widget.id);
    assert.equal(s.doc.sections[0].id, section.id);
  });

  test('a refused insert leaves the document the same object and says the model\'s reason', () => {
    const doc = deepFreeze(baseDoc());
    const widget = createNode('widget', 'heading');
    const s0 = createBuilderState(doc);
    const s = builderReducer(s0, { type: 'insert', parentId: null, index: 0, node: widget });
    const reason = insertNode(doc, null, 0, widget).reason;
    assert.ok(reason, 'the model refuses a widget straight on the page');
    assert.equal(s.doc, doc);
    assert.equal(s.past.length, 0);
    assert.equal(s.dirty, false);
    assert.equal(s.notice.text, `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`);
    assert.equal(s.announcement, s.notice);
  });

  test('move puts a node at its new place and says where it went', () => {
    const s = builderReducer(createBuilderState(baseDoc()), { type: 'move', id: 'legacy-reviews', parentId: null, index: 0 });
    assert.deepEqual(sectionIds(s.doc), ['legacy-reviews', 'legacy-offer']);
    assert.equal(s.selectedId, 'legacy-reviews');
    assert.equal(s.announcement.text, 'Reviews moved to the page, position 1 of 2.');
    assert.equal(s.past.length, 1);
  });

  test('a move to where the node already is changes nothing at all', () => {
    const s0 = createBuilderState(baseDoc());
    assert.equal(builderReducer(s0, { type: 'move', id: 'legacy-offer', parentId: null, index: 0 }), s0);
  });

  for (const [what, id, parentId, index] of [
    ['a section into an inner section\'s column (too deep)', 'legacy-reviews', 'inner-a', 0],
    ['a column straight onto the page', 'legacy-offer-media', null, 0],
    ['a widget straight into a section', 'legacy-headline', 'legacy-reviews', 0],
    ['a section into its own column', 'legacy-offer', 'legacy-offer-copy', 0],
    ['the last column out of its section', 'legacy-reviews-col', 'legacy-offer', 0]
  ]) {
    test(`a refused move (${what}) leaves the document identical and sets the model's reason as the notice`, () => {
      const doc = deepFreeze(nestedDoc());
      const snapshot = structuredClone(doc);
      const s0 = builderReducer(createBuilderState(doc), { type: 'select', id: id });
      const s = builderReducer(s0, { type: 'move', id, parentId, index });
      const reason = moveNode(doc, id, parentId, index).reason;
      assert.ok(reason, 'the model refuses it');
      assert.equal(s.doc, doc, 'the same object');
      assert.deepEqual(s.doc, snapshot, 'and the same content');
      assert.equal(s.past.length, 0, 'no undo step');
      assert.equal(s.dirty, false);
      assert.ok(s.notice, 'a notice is set');
      assert.equal(s.notice.text.toLowerCase().replace(/\.$/, ''), reason.toLowerCase().replace(/\.$/, ''));
      assert.equal(s.selectedId, id, 'the selection stays');
    });
  }

  test('remove takes the node out, selects its neighbour, and says undo brings it back', () => {
    const s0 = builderReducer(createBuilderState(baseDoc()), { type: 'select', id: 'legacy-headline' });
    const s = builderReducer(s0, { type: 'remove', id: 'legacy-headline' });
    assert.equal(findNode(s.doc, 'legacy-headline'), null);
    assert.equal(s.selectedId, 'legacy-checkout', 'the block that took its place');
    assert.equal(s.announcement.text, 'Heading removed. Undo brings it back.');
    const last = builderReducer(builderReducer(s, { type: 'select', id: 'legacy-checkout' }), { type: 'remove', id: 'legacy-checkout' });
    assert.equal(last.selectedId, 'legacy-offer-copy', 'with no sibling left, the parent');
  });

  test('a refused remove (a section\'s only column) changes nothing', () => {
    const s0 = createBuilderState(deepFreeze(baseDoc()));
    const s = builderReducer(s0, { type: 'remove', id: 'legacy-reviews-col' });
    assert.equal(s.doc, s0.doc);
    assert.equal(s.notice.text, `${removeNode(s0.doc, 'legacy-reviews-col').reason.replace(/^./, c => c.toUpperCase())}.`);
  });

  test('duplicate places a copy right after the original with fresh ids and selects it', () => {
    const s = builderReducer(createBuilderState(deepFreeze(baseDoc())), { type: 'duplicate', id: 'legacy-offer' });
    assert.equal(s.doc.sections.length, 3);
    assert.equal(s.doc.sections[0].id, 'legacy-offer');
    const copy = s.doc.sections[1];
    assert.equal(s.selectedId, copy.id);
    assert.notEqual(copy.id, 'legacy-offer');
    const ids = [];
    model.walk(s.doc, n => { ids.push(n.id); });
    assert.equal(new Set(ids).size, ids.length, 'every id is unique');
    assert.ok(validateBuilderDoc(s.doc).ok);
    assert.match(s.announcement.text, /^Offer copied to the page, position 2 of 3\. The copy is selected\.$/);
  });
});

describe('setProps', () => {
  test('writes the props of one node, one undo step', () => {
    const s = builderReducer(createBuilderState(deepFreeze(baseDoc())), { type: 'setProps', id: 'legacy-headline', props: { text: 'Book a fitting' } });
    assert.equal(findNode(s.doc, 'legacy-headline').node.props.text, 'Book a fitting');
    assert.equal(findNode(s.doc, 'legacy-headline').node.props.level, 1, 'the other props stay');
    assert.equal(s.past.length, 1);
  });

  test('a value the model refuses changes nothing and names the field', () => {
    const s0 = createBuilderState(deepFreeze(baseDoc()));
    const s = builderReducer(s0, { type: 'setProps', id: 'legacy-headline', props: { link: 'javascript:alert(1)' }, target: 'props.link' });
    assert.equal(s.doc, s0.doc);
    assert.equal(s.past.length, 0);
    assert.equal(s.notice.target, 'props.link');
    assert.match(s.notice.text, /^Link: .*is not a link/);
  });

  test('an edit that changes nothing is not an undo step', () => {
    const s0 = createBuilderState(baseDoc());
    assert.equal(builderReducer(s0, { type: 'setProps', id: 'legacy-headline', props: { level: 1 } }), s0);
  });

  test('a column has no props to set', () => {
    const s0 = createBuilderState(baseDoc());
    const s = builderReducer(s0, { type: 'setProps', id: 'legacy-offer-copy', props: { label: 'x' } });
    assert.equal(s.doc, s0.doc);
    assert.match(s.notice.text, /column has no settings/);
  });

  test('a section takes its own props', () => {
    const s = builderReducer(createBuilderState(baseDoc()), { type: 'setProps', id: 'legacy-reviews', props: { label: 'What people say', stackOn: 'tablet' } });
    assert.equal(nodeLabel(s.doc, 'legacy-reviews'), 'What people say');
    assert.equal(findNode(s.doc, 'legacy-reviews').node.props.stackOn, 'tablet');
  });
});

describe('setStyle writes the active device layer only', () => {
  test('on mobile it writes the mobile layer and leaves desktop and tablet alone', () => {
    const doc = deepFreeze(baseDoc());
    const s0 = builderReducer(createBuilderState(doc), { type: 'setDevice', device: 'mobile' });
    const s = builderReducer(s0, { type: 'setStyle', id: 'legacy-offer', values: { paddingTop: 8 } });
    const style = findNode(s.doc, 'legacy-offer').node.style;
    assert.equal(style.mobile.paddingTop, 8);
    assert.equal(style.desktop.paddingTop, 36, 'desktop unchanged');
    assert.deepEqual(style.desktop, findNode(doc, 'legacy-offer').node.style.desktop);
    assert.equal(style.tablet, undefined, 'no tablet layer appears');
    assert.equal(resolveStyle(findNode(s.doc, 'legacy-offer').node, 'desktop').paddingTop, 36);
    assert.equal(resolveStyle(findNode(s.doc, 'legacy-offer').node, 'mobile').paddingTop, 8);
  });

  test('on tablet a new layer is made, and clearing its last key removes it again', () => {
    const s0 = builderReducer(createBuilderState(baseDoc()), { type: 'setDevice', device: 'tablet' });
    const s1 = builderReducer(s0, { type: 'setStyle', id: 'legacy-headline', values: { fontSize: 30 } });
    assert.deepEqual(findNode(s1.doc, 'legacy-headline').node.style.tablet, { fontSize: 30 });
    assert.equal(findNode(s1.doc, 'legacy-headline').node.style.mobile, undefined);
    const s2 = builderReducer(s1, { type: 'setStyle', id: 'legacy-headline', values: { fontSize: undefined } });
    assert.equal(findNode(s2.doc, 'legacy-headline').node.style.tablet, undefined, 'an empty tablet layer is dropped');
    assert.deepEqual(findNode(s2.doc, 'legacy-headline').node.style.desktop, { fontFamily: 'theme.heading' });
  });

  test('on desktop it writes desktop, which the smaller devices then inherit unless they say otherwise', () => {
    const s = builderReducer(createBuilderState(baseDoc()), { type: 'setStyle', id: 'legacy-offer', values: { paddingTop: 50 } });
    const node = findNode(s.doc, 'legacy-offer').node;
    assert.equal(node.style.desktop.paddingTop, 50);
    assert.equal(node.style.mobile.paddingTop, 24, 'the mobile layer keeps its own');
    assert.equal(resolveStyle(node, 'tablet').paddingTop, 50);
  });

  test('a value out of range is refused with the style key\'s label, and nothing changes', () => {
    const s0 = builderReducer(createBuilderState(deepFreeze(baseDoc())), { type: 'setDevice', device: 'mobile' });
    const s = builderReducer(s0, { type: 'setStyle', id: 'legacy-offer', values: { paddingTop: 900 }, target: 'style.paddingTop' });
    assert.equal(s.doc, s0.doc);
    assert.equal(s.notice.text, 'Padding top: 900 is outside 0 to 400 px.');
    assert.equal(s.notice.target, 'style.paddingTop');
  });

  test('the CSS class goes on desktop whatever device is being edited', () => {
    const s0 = builderReducer(createBuilderState(baseDoc()), { type: 'setDevice', device: 'mobile' });
    const s = builderReducer(s0, { type: 'setClass', id: 'legacy-offer', className: 'promo hero' });
    const style = findNode(s.doc, 'legacy-offer').node.style;
    assert.equal(style.desktop.customClass, 'promo hero');
    assert.equal('customClass' in (style.mobile || {}), false);
    const cleared = builderReducer(s, { type: 'setClass', id: 'legacy-offer', className: '' });
    assert.equal('customClass' in findNode(cleared.doc, 'legacy-offer').node.style.desktop, false);
    const bad = builderReducer(s, { type: 'setClass', id: 'legacy-offer', className: '9lives' });
    assert.equal(bad.doc, s.doc);
    assert.equal(bad.notice.target, 'style.customClass');
  });
});

describe('setVisibility writes the layers that make three switches true', () => {
  test('every combination of hide on desktop, tablet and mobile reads back exactly through the cascade', () => {
    for (let mask = 0; mask < 8; mask++) {
      const hidden = { desktop: !!(mask & 1), tablet: !!(mask & 2), mobile: !!(mask & 4) };
      const s = builderReducer(createBuilderState(baseDoc()), { type: 'setVisibility', id: 'legacy-headline', hidden });
      const node = findNode(s.doc, 'legacy-headline').node;
      for (const d of ['desktop', 'tablet', 'mobile']) {
        assert.equal(resolveStyle(node, d).hidden === true, hidden[d], `${JSON.stringify(hidden)} on ${d}`);
      }
      assert.ok(validateBuilderDoc(s.doc).ok);
    }
  });

  test('"hide on desktop only" writes hidden on desktop and visible on tablet, as design section 2 says', () => {
    const style = visibilityLayers({ desktop: {} }, { desktop: true, tablet: false, mobile: false });
    assert.deepEqual(style, { desktop: { hidden: true }, tablet: { hidden: false } });
  });
});

describe('setTheme', () => {
  test('merges colours and fonts into the theme', () => {
    const s = builderReducer(createBuilderState(baseDoc()), { type: 'setTheme', theme: { colors: { primary: '#112233' }, fonts: { body: 'Inter' }, radius: 4 } });
    assert.equal(s.doc.theme.colors.primary, '#112233');
    assert.equal(s.doc.theme.colors.secondary, '#10B981', 'the other colours stay');
    assert.equal(s.doc.theme.fonts.body, 'Inter');
    assert.equal(s.doc.theme.fonts.heading, 'Playfair Display');
    assert.equal(s.doc.theme.radius, 4);
  });

  test('a colour or font the model refuses changes nothing', () => {
    const s0 = createBuilderState(deepFreeze(baseDoc()));
    const s1 = builderReducer(s0, { type: 'setTheme', theme: { colors: { primary: 'red' } }, target: 'theme.colors.primary' });
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.notice.target, 'theme.colors.primary');
    const s2 = builderReducer(s0, { type: 'setTheme', theme: { fonts: { heading: 'Evil"; } body {' } } });
    assert.equal(s2.doc, s0.doc);
    assert.ok(s2.notice);
  });
});

describe('undo and redo', () => {
  test('undo restores the document before the change and redo puts it back', () => {
    const doc = baseDoc();
    const s1 = run(createBuilderState(doc), { type: 'move', id: 'legacy-reviews', parentId: null, index: 0 });
    const s2 = builderReducer(s1, { type: 'undo' });
    assert.equal(s2.doc, doc, 'the very document from before');
    assert.equal(s2.dirty, false, 'back at the saved document');
    assert.equal(canUndo(s2), false);
    assert.equal(canRedo(s2), true);
    const s3 = builderReducer(s2, { type: 'redo' });
    assert.equal(s3.doc, s1.doc);
    assert.deepEqual(sectionIds(s3.doc), ['legacy-reviews', 'legacy-offer']);
    assert.equal(canRedo(s3), false);
  });

  test('a new change after an undo clears redo', () => {
    const s = run(createBuilderState(baseDoc()),
      { type: 'setProps', id: 'legacy-headline', props: { text: 'One' } },
      { type: 'undo' },
      { type: 'setProps', id: 'legacy-headline', props: { text: 'Two' } });
    assert.equal(canRedo(s), false);
    assert.equal(findNode(s.doc, 'legacy-headline').node.props.text, 'Two');
  });

  test('undo and redo with nothing to do are the same state', () => {
    const s0 = createBuilderState(baseDoc());
    assert.equal(builderReducer(s0, { type: 'undo' }), s0);
    assert.equal(builderReducer(s0, { type: 'redo' }), s0);
  });

  test('a selection that undo removes from the page is dropped', () => {
    const heading = createNode('widget', 'heading');
    const s = run(createBuilderState(baseDoc()), { type: 'insert', parentId: 'legacy-offer-media', index: 0, node: heading }, { type: 'undo' });
    assert.equal(s.selectedId, null);
  });

  test('undo keeps 50 steps and redo keeps 50 steps', () => {
    const texts = Array.from({ length: 60 }, (_, i) => `Text ${i + 1}`);
    const states = [createBuilderState(baseDoc())];
    for (const text of texts) states.push(builderReducer(states[states.length - 1], { type: 'setProps', id: 'legacy-headline', props: { text } }));
    let s = states[states.length - 1];
    assert.equal(s.past.length, 50, 'only the last 50 are kept');
    const textOf = st => findNode(st.doc, 'legacy-headline').node.props.text;
    for (let i = 0; i < 50; i++) {
      s = builderReducer(s, { type: 'undo' });
      assert.equal(textOf(s), i === 49 ? 'Text 10' : `Text ${59 - i}`, `undo ${i + 1}`);
    }
    assert.equal(canUndo(s), false, 'the 51st step back is gone');
    assert.equal(builderReducer(s, { type: 'undo' }), s);
    assert.equal(s.doc, states[10].doc, 'the oldest kept document is the one after change 10');
    assert.equal(s.future.length, 50);
    for (let i = 0; i < 50; i++) {
      s = builderReducer(s, { type: 'redo' });
      assert.equal(textOf(s), `Text ${11 + i}`, `redo ${i + 1}`);
    }
    assert.equal(canRedo(s), false);
    assert.equal(s.doc, states[60].doc);
  });

  test('edits with the same key less than a second apart are one undo step', () => {
    const at = 1_000_000;
    const typed = run(createBuilderState(baseDoc()),
      { type: 'setProps', id: 'legacy-headline', props: { text: 'B' }, coalesce: 'props:h:text', at },
      { type: 'setProps', id: 'legacy-headline', props: { text: 'Bo' }, coalesce: 'props:h:text', at: at + 300 },
      { type: 'setProps', id: 'legacy-headline', props: { text: 'Boo' }, coalesce: 'props:h:text', at: at + 600 });
    assert.equal(typed.past.length, 1);
    assert.equal(findNode(builderReducer(typed, { type: 'undo' }).doc, 'legacy-headline').node.props.text, '');
    const paused = run(typed, { type: 'setProps', id: 'legacy-headline', props: { text: 'Book' }, coalesce: 'props:h:text', at: at + 600 + COALESCE_MS + 1 });
    assert.equal(paused.past.length, 2, 'a pause starts a new step');
    const other = run(typed, { type: 'setProps', id: 'legacy-headline', props: { level: 2 }, coalesce: 'props:h:level', at: at + 700 });
    assert.equal(other.past.length, 2, 'another field starts a new step');
  });

  test('a run of keyboard moves is one undo step', () => {
    let s = createBuilderState(nestedDoc());
    const doc0 = s.doc;
    assert.deepEqual(childIds(s.doc, 'legacy-offer-copy'), ['inner', 'legacy-headline', 'legacy-checkout']);
    for (const at of [10, 200]) {
      const r = siblingMove(s.doc, 'legacy-checkout', -1, at);
      assert.ok('action' in r, JSON.stringify(r));
      s = builderReducer(s, r.action);
    }
    assert.deepEqual(childIds(s.doc, 'legacy-offer-copy'), ['legacy-checkout', 'inner', 'legacy-headline']);
    assert.equal(s.past.length, 1);
    assert.match(siblingMove(s.doc, 'legacy-checkout', -1, 300).refused, /already first in Column 2/);
    assert.equal(builderReducer(s, { type: 'undo' }).doc, doc0);
  });
});

describe('replaceDoc and markSaved', () => {
  test('replaceDoc clears history, marks the new document saved and drops a selection it lacks', () => {
    const s1 = run(createBuilderState(baseDoc()),
      { type: 'select', id: 'legacy-headline' },
      { type: 'setProps', id: 'legacy-headline', props: { text: 'One' } },
      { type: 'setProps', id: 'legacy-headline', props: { text: 'Two' } },
      { type: 'undo' });
    assert.ok(canUndo(s1) && canRedo(s1));
    const next = migrateLegacyPage({ headline: 'Other page' });
    const s2 = builderReducer(s1, { type: 'replaceDoc', doc: next });
    assert.equal(s2.doc, next);
    assert.equal(s2.savedDoc, next);
    assert.deepEqual([s2.past, s2.future, s2.dirty], [[], [], false]);
    assert.equal(s2.selectedId, 'legacy-headline', 'the same id is on the new page');
    const empty = model.createEmptyPage();
    assert.equal(builderReducer(s2, { type: 'replaceDoc', doc: empty }).selectedId, null);
  });

  test('markSaved clears dirty only when the saved document is the current one', () => {
    const s1 = builderReducer(createBuilderState(baseDoc()), { type: 'setProps', id: 'legacy-headline', props: { text: 'One' } });
    assert.equal(s1.dirty, true);
    const saved = builderReducer(s1, { type: 'markSaved', doc: s1.doc });
    assert.equal(saved.dirty, false);
    assert.equal(saved.past.length, 1, 'saving keeps history');
    const s2 = builderReducer(s1, { type: 'setProps', id: 'legacy-headline', props: { text: 'Two' } });
    assert.equal(builderReducer(s2, { type: 'markSaved', doc: s1.doc }).dirty, true, 'a change made while saving stays unsaved');
    const back = builderReducer(builderReducer(saved, { type: 'setProps', id: 'legacy-headline', props: { text: 'Three' } }), { type: 'undo' });
    assert.equal(back.dirty, false, 'undoing back to the saved document is not a change');
  });

  test('notify and clearNotice', () => {
    const s1 = builderReducer(createBuilderState(baseDoc()), { type: 'notify', text: 'nothing there' });
    assert.equal(s1.notice.text, 'Nothing there.');
    assert.equal(s1.announcement.text, 'Nothing there.');
    assert.equal(builderReducer(s1, { type: 'clearNotice' }).notice, null);
    const s2 = builderReducer(s1, { type: 'setProps', id: 'legacy-headline', props: { text: 'x' } });
    assert.equal(s2.notice, null, 'a change that lands clears the notice');
  });
});

describe('words for places and keyboard moves', () => {
  test('nodes are named the way the outline names them, never by id', () => {
    const doc = nestedDoc();
    assert.equal(nodeLabel(doc, 'legacy-offer'), 'Offer');
    assert.equal(nodeLabel(doc, 'legacy-offer-copy'), 'Column 2');
    assert.equal(nodeLabel(doc, 'inner'), 'Inner section');
    assert.equal(nodeLabel(doc, 'legacy-checkout'), 'Checkout button');
    const unnamed = model.createEmptyPage();
    unnamed.sections.push(createNode('section'));
    assert.equal(nodeLabel(unnamed, unnamed.sections[0].id), 'Section 1');
    assert.equal(placeOf(doc, 'legacy-checkout'), 'Offer, column 2, position 3 of 3');
    assert.equal(placeOf(doc, 'legacy-reviews'), 'the page, position 2 of 2');
    assert.equal(placeOf(doc, 'inner-b'), 'Inner section, position 2 of 2');
  });

  test('siblingMove stops at either end with a sentence', () => {
    const doc = baseDoc();
    assert.match(siblingMove(doc, 'legacy-offer', -1).refused, /already first in the page/);
    assert.match(siblingMove(doc, 'legacy-reviews', 1).refused, /already last in the page/);
    assert.deepEqual(siblingMove(doc, 'legacy-offer', 1, 5).action, { type: 'move', id: 'legacy-offer', parentId: null, index: 1, coalesce: 'keyboard-move:legacy-offer', at: 5 });
  });

  test('crossMove takes a widget into the next or previous column and a column into the next section', () => {
    const doc = baseDoc();
    const down = crossMove(doc, 'legacy-product', 1).action;
    assert.deepEqual([down.parentId, down.index], ['legacy-offer-copy', 0]);
    const up = crossMove(doc, 'legacy-headline', -1).action;
    assert.deepEqual([up.parentId, up.index], ['legacy-offer-media', 1]);
    const col = crossMove(doc, 'legacy-offer-copy', 1).action;
    assert.deepEqual([col.parentId, col.index], ['legacy-reviews', 0]);
    assert.ok(crossMove(doc, 'legacy-offer', 1).refused, 'a top-level section only moves up and down');
    assert.ok(crossMove(doc, 'legacy-reviews-wall', 1).refused, 'nothing after the last column');
    const s = builderReducer(createBuilderState(doc), down);
    assert.deepEqual(childIds(s.doc, 'legacy-offer-copy')[0], 'legacy-product');
  });
});
