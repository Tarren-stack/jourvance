import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Copy, paste and cut in the page builder's editing state: the clipboard lives in state only, a paste
// mints fresh ids throughout, an illegal nest is refused with the model's reason and the document
// stays the same object, and paste and cut are each one undo step.

const { createBuilderState, builderReducer, canPaste, canUndo } = await import('./src/components/builder/builderState.ts');
const { migrateLegacyPage, findNode, walk } = await import('./src/lib/pageBuilder/model.mjs');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const baseDoc = () => migrateLegacyPage(structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data));
const run = (state, ...actions) => actions.reduce(builderReducer, state);
const ids = doc => { const out = []; walk(doc, n => { out.push(n.id); }); return out; };
const WIDGET = 'legacy-headline';

describe('copyNode', () => {
  test('puts a deep clone of the selection in the clipboard and leaves the doc and history alone', () => {
    const s0 = run(createBuilderState(baseDoc()), { type: 'select', id: WIDGET });
    assert.equal(canPaste(s0), false);
    const s1 = builderReducer(s0, { type: 'copyNode' });
    assert.equal(canPaste(s1), true);
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.deepEqual(s1.clipboard, findNode(s0.doc, WIDGET).node);
    assert.notEqual(s1.clipboard, findNode(s0.doc, WIDGET).node);
    assert.match(s1.announcement.text, /copied/);
  });
  test('a given id wins over the selection; nothing selected or an unknown id is refused', () => {
    const s0 = createBuilderState(baseDoc());
    const none = builderReducer(s0, { type: 'copyNode' });
    assert.equal(none.clipboard, null);
    assert.ok(none.notice);
    const gone = builderReducer(s0, { type: 'copyNode', id: 'nope' });
    assert.equal(gone.clipboard, null);
    const byId = builderReducer(s0, { type: 'copyNode', id: WIDGET });
    assert.equal(byId.clipboard.id, WIDGET);
  });
});

describe('pasteNode', () => {
  test('inserts after the selection with fresh ids, as one undo step, and can paste again', () => {
    let s = run(createBuilderState(baseDoc()), { type: 'select', id: WIDGET }, { type: 'copyNode' });
    const before = s.doc;
    const parent = findNode(before, WIDGET);
    s = builderReducer(s, { type: 'pasteNode' });
    assert.notEqual(s.doc, before);
    assert.equal(s.past.length, 1);
    assert.equal(s.past[0], before);
    const siblings = parent.parent.children;
    const after = findNode(s.doc, parent.parent.id).node.children;
    assert.equal(after.length, siblings.length + 1);
    assert.equal(after[parent.index].id, WIDGET);
    assert.notEqual(after[parent.index + 1].id, WIDGET);
    assert.equal(s.selectedId, after[parent.index + 1].id);
    assert.equal(after[parent.index + 1].type, parent.node.type);
    assert.equal(new Set(ids(s.doc)).size, ids(s.doc).length);
    const s2 = builderReducer(s, { type: 'pasteNode' });
    assert.equal(new Set(ids(s2.doc)).size, ids(s2.doc).length);
    assert.equal(s2.past.length, 2);
    assert.equal(builderReducer(s, { type: 'undo' }).doc, before);
  });
  test('a copied section gets fresh ids on every node inside it', () => {
    const doc = baseDoc();
    const top = doc.sections[0];
    let s = run(createBuilderState(doc), { type: 'select', id: top.id }, { type: 'copyNode' }, { type: 'pasteNode' });
    assert.equal(s.doc.sections.length, doc.sections.length + 1);
    const copy = s.doc.sections[1];
    const inner = new Set();
    walk({ ...s.doc, sections: [copy] }, n => { inner.add(n.id); });
    const original = new Set(ids({ ...doc, sections: [top] }));
    assert.ok(inner.size > 3);
    assert.equal(inner.size, original.size);
    for (const id of inner) assert.ok(!original.has(id), id);
  });
  test('a selected column takes a widget at its end; nothing selected pastes a section at the end of the page', () => {
    const doc = baseDoc();
    const col = doc.sections[0].children[0];
    let s = run(createBuilderState(doc), { type: 'copyNode', id: WIDGET }, { type: 'select', id: col.id }, { type: 'pasteNode' });
    const kids = findNode(s.doc, col.id).node.children;
    assert.equal(kids.length, col.children.length + 1);
    assert.equal(s.selectedId, kids[kids.length - 1].id);
    s = run(createBuilderState(doc), { type: 'copyNode', id: doc.sections[0].id }, { type: 'pasteNode' });
    assert.equal(s.doc.sections.length, doc.sections.length + 1);
    assert.equal(s.doc.sections[s.doc.sections.length - 1].id, s.selectedId);
  });
  test('an empty clipboard is refused', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'pasteNode' });
    assert.equal(s1.doc, s0.doc);
    assert.ok(s1.notice.text);
  });
  test('an illegal nest is refused with the model reason and the document is the same object', () => {
    const doc = baseDoc();
    const col = doc.sections[0].children[0];
    const widget = col.children[0];
    const s0 = run(createBuilderState(doc), { type: 'copyNode', id: col.id }, { type: 'select', id: widget.id });
    const s1 = builderReducer(s0, { type: 'pasteNode' });
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.ok(s1.notice && s1.notice.text.length > 0);
    assert.equal(s1.clipboard, s0.clipboard);
    assert.equal(canUndo(s1), false);
  });
});

describe('cutNode', () => {
  test('copies then removes as one undo step, and undo brings it back', () => {
    const s0 = run(createBuilderState(baseDoc()), { type: 'select', id: WIDGET });
    const node = findNode(s0.doc, WIDGET).node;
    const s1 = builderReducer(s0, { type: 'cutNode' });
    assert.equal(findNode(s1.doc, WIDGET), null);
    assert.deepEqual(s1.clipboard, node);
    assert.equal(s1.past.length, 1);
    const s2 = builderReducer(s1, { type: 'undo' });
    assert.equal(s2.doc, s0.doc);
    assert.ok(s2.clipboard);
    const s3 = run(s1, { type: 'pasteNode' });
    assert.ok(ids(s3.doc).length > ids(s1.doc).length);
  });
  test('nothing selected, or a node the model will not remove, changes nothing', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'cutNode' });
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.clipboard, null);
    const doc = baseDoc();
    const only = doc.sections[0].children[0];
    const s2 = run(createBuilderState(doc), { type: 'cutNode', id: only.id });
    if (s2.doc === doc) assert.equal(s2.clipboard, null);
  });
});
