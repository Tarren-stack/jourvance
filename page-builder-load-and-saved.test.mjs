import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Wave 3's two whole-page and library actions in the page builder's editing state: loadDoc (a
// template or a restored revision) replaces the page as ONE undo step, so Undo brings the previous
// page back, and a document that fails the model is refused with the page untouched; insertSaved
// (a section from the saved library) goes in with fresh ids, after the top-level section that holds
// the selection, as one undo step.

const { createBuilderState, builderReducer, canUndo } = await import('./src/components/builder/builderState.ts');
const { migrateLegacyPage, findNode, walk } = await import('./src/lib/pageBuilder/model.mjs');
const { buildTemplate, TEMPLATES } = await import('./src/lib/pageBuilder/templates.mjs');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const baseDoc = () => migrateLegacyPage(structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data));
const ids = doc => { const out = []; walk(doc, n => { out.push(n.id); }); return out; };

describe('loadDoc', () => {
  test('replaces the page as one undo step; Undo brings the previous page back, Redo the template', () => {
    const before = baseDoc();
    const s0 = builderReducer(createBuilderState(before), { type: 'select', id: 'legacy-headline' });
    const tpl = buildTemplate(TEMPLATES[0].id);
    const s1 = builderReducer(s0, { type: 'loadDoc', doc: tpl, sentence: 'Page replaced.' });
    assert.equal(s1.doc, tpl);
    assert.equal(s1.past.length, s0.past.length + 1);
    assert.equal(s1.past[s1.past.length - 1], before);
    assert.equal(s1.selectedId, null);
    assert.equal(s1.dirty, true);
    assert.equal(s1.announcement.text, 'Page replaced.');
    assert.ok(canUndo(s1));
    const s2 = builderReducer(s1, { type: 'undo' });
    assert.equal(s2.doc, before);
    const s3 = builderReducer(s2, { type: 'redo' });
    assert.equal(s3.doc, tpl);
  });

  test('a document that fails the model is refused and the page stays the same object', () => {
    const s0 = createBuilderState(baseDoc());
    const bad = structuredClone(s0.doc);
    bad.theme.colors.primary = 'not a colour';
    const s1 = builderReducer(s0, { type: 'loadDoc', doc: bad, sentence: 'never said' });
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.ok(s1.notice, 'the refusal is a notice');
    assert.notEqual(s1.announcement?.text, 'never said');
  });

  test('loading the page you already have changes nothing and says so', () => {
    const s0 = createBuilderState(baseDoc());
    const s1 = builderReducer(s0, { type: 'loadDoc', doc: structuredClone(s0.doc), sentence: 'x' });
    assert.equal(s1.doc, s0.doc);
    assert.equal(s1.past.length, 0);
    assert.match(s1.notice.text, /Nothing changed/);
  });
});

describe('insertSaved', () => {
  test('a saved section goes in after the top-level section holding the selection, with fresh ids', () => {
    const doc = baseDoc();
    const saved = structuredClone(doc.sections[0]);
    const s0 = builderReducer(createBuilderState(doc), { type: 'select', id: 'legacy-headline' });
    const holder = doc.sections.findIndex(sec => findNode({ ...doc, sections: [sec] }, 'legacy-headline'));
    assert.ok(holder >= 0);
    const s1 = builderReducer(s0, { type: 'insertSaved', node: saved, name: 'Hero' });
    assert.equal(s1.doc.sections.length, doc.sections.length + 1);
    const added = s1.doc.sections[holder + 1];
    assert.equal(s1.selectedId, added.id);
    const before = new Set(ids(doc));
    const fresh = ids({ ...doc, sections: [added] });
    assert.ok(fresh.length > 1);
    assert.ok(fresh.every(id => !before.has(id)), 'every id in the inserted copy is new to the page');
    assert.equal(new Set(fresh).size, fresh.length, 'no id repeats inside the copy');
    assert.match(s1.announcement.text, /Saved section Hero added/);
    assert.equal(s1.past.length, 1);
    assert.equal(builderReducer(s1, { type: 'undo' }).doc, doc);
  });

  test('with nothing selected it goes at the end of the page', () => {
    const doc = baseDoc();
    const s1 = builderReducer(createBuilderState(doc), { type: 'insertSaved', node: structuredClone(doc.sections[0]), name: 'Hero' });
    assert.equal(s1.doc.sections.length, doc.sections.length + 1);
    assert.equal(s1.doc.sections[s1.doc.sections.length - 1].id, s1.selectedId);
  });
});
