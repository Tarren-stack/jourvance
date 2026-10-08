import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The editor's motion (LANDING_BUILDER_MOTION.md section 4, acceptance E1 to E8). The pure pieces
// (motion.ts, the reducer's flash) are run; the React files are pinned by their source, because
// the browser check (scripts/builder-browser-check.mjs) is what proves they draw.

const { flipOffsets, editorMotionOff, readReduceMotionPref, writeReduceMotionPref, REDUCE_MOTION_KEY } =
  await import('./src/components/builder/motion.ts');
const { createBuilderState, builderReducer } = await import('./src/components/builder/builderState.ts');
const model = await import('./src/lib/pageBuilder/model.mjs');
const { migrateLegacyPage, createNode } = model;
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const read = p => fs.readFileSync(p, 'utf8');
const B = 'src/components/builder';
const canvas = read(`${B}/BuilderCanvas.tsx`);
const outline = read(`${B}/BuilderOutline.tsx`);
const shell = read(`${B}/BuilderShell.tsx`);
const panel = read(`${B}/BuilderThemePanel.tsx`);
const inspector = read(`${B}/BuilderInspector.tsx`);
const css = read('src/index.css');

const baseDoc = () => migrateLegacyPage(structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data));

describe('E1 flipOffsets', () => {
  test('old less new for ids in both maps; nothing for one side only or under a pixel', () => {
    const out = flipOffsets(new Map([['a', 100], ['b', 40], ['gone', 5], ['same', 10], ['tiny', 10]]), new Map([['a', 40], ['b', 100], ['new', 7], ['same', 10], ['tiny', 10.6]]));
    assert.deepEqual([...out.entries()], [['a', 60], ['b', -60]]);
  });
  test('exactly one pixel counts', () => {
    assert.equal(flipOffsets(new Map([['a', 11]]), new Map([['a', 10]])).get('a'), 1);
  });
});

describe('E2 editorMotionOff', () => {
  test('off when the OS asks or the preference is on', () => {
    assert.equal(editorMotionOff(false, false), false);
    assert.equal(editorMotionOff(true, false), true);
    assert.equal(editorMotionOff(false, true), true);
    assert.equal(editorMotionOff(true, true), true);
  });
});

describe('E3 the stored preference', () => {
  const store = value => ({ getItem: k => (k === REDUCE_MOTION_KEY ? value : null), setItem() {} });
  test('reads 1 as on and everything else as off', () => {
    assert.equal(readReduceMotionPref(store('1')), true);
    assert.equal(readReduceMotionPref(store('0')), false);
    assert.equal(readReduceMotionPref(store(null)), false);
    assert.equal(readReduceMotionPref(null), false);
  });
  test('a storage that throws reads as off and cannot break a write', () => {
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(readReduceMotionPref(bad), false);
    assert.doesNotThrow(() => writeReduceMotionPref(true, bad));
  });
  test('a write stores 1 or 0 under the documented key', () => {
    const seen = [];
    writeReduceMotionPref(true, { getItem: () => null, setItem: (k, v) => seen.push([k, v]) });
    writeReduceMotionPref(false, { getItem: () => null, setItem: (k, v) => seen.push([k, v]) });
    assert.deepEqual(seen, [['jv_builder_reduce_motion', '1'], ['jv_builder_reduce_motion', '0']]);
  });
});

describe('E4 the reducer flash', () => {
  const heading = () => createNode('widget', 'heading');
  test('insert, move, duplicate, paste and insertSaved flash the node that landed and raise seq', () => {
    const s0 = createBuilderState(baseDoc());
    const node = heading();
    const s1 = builderReducer(s0, { type: 'insert', parentId: 'legacy-offer-media', index: 0, node });
    assert.equal(s1.flash.id, node.id);
    assert.equal(s1.flash.seq, 1);
    const s2 = builderReducer(s1, { type: 'move', id: 'legacy-reviews', parentId: null, index: 0 });
    assert.deepEqual(s2.flash, { id: 'legacy-reviews', seq: 2 });
    const s3 = builderReducer(s2, { type: 'duplicate', id: 'legacy-offer' });
    assert.equal(s3.flash.id, s3.selectedId);
    assert.notEqual(s3.flash.id, 'legacy-offer');
    assert.equal(s3.flash.seq, 3);
    const s4 = builderReducer(builderReducer(s3, { type: 'select', id: node.id }), { type: 'copyNode' });
    const s5 = builderReducer(s4, { type: 'pasteNode' });
    assert.equal(s5.flash.id, s5.selectedId);
    assert.notEqual(s5.flash.id, node.id);
    assert.equal(s5.flash.seq, 4);
    const s6 = builderReducer(s5, { type: 'insertSaved', node: structuredClone(s5.doc.sections[0]), name: 'Hero' });
    assert.equal(s6.flash.id, s6.selectedId);
    assert.equal(s6.flash.seq, 5);
  });
  test('a refused paste, undo, redo, select, setProps, setTheme, loadDoc and replaceDoc leave flash as it was', () => {
    const base = builderReducer(createBuilderState(baseDoc()), { type: 'duplicate', id: 'legacy-offer' });
    const flash = base.flash;
    assert.ok(flash);
    const refused = builderReducer({ ...base, clipboard: null }, { type: 'pasteNode' });
    assert.equal(refused.flash, flash);
    const sel = builderReducer(base, { type: 'select', id: 'legacy-reviews' });
    assert.equal(sel.flash, flash);
    const props = builderReducer(sel, { type: 'setProps', id: 'legacy-reviews', props: { name: 'Proof' } });
    assert.equal(props.flash, flash);
    const theme = builderReducer(props, { type: 'setTheme', theme: { radius: 9 } });
    assert.equal(theme.flash, flash);
    const undone = builderReducer(theme, { type: 'undo' });
    assert.equal(undone.flash, flash);
    const redone = builderReducer(undone, { type: 'redo' });
    assert.equal(redone.flash, flash);
    const replaced = builderReducer(redone, { type: 'replaceDoc', doc: redone.doc });
    assert.equal(replaced.flash, flash);
    const loaded = builderReducer(replaced, { type: 'loadDoc', doc: baseDoc(), sentence: 'Loaded.' });
    assert.equal(loaded.flash, flash);
  });
  test('a fresh state has no flash', () => {
    assert.equal(createBuilderState(baseDoc()).flash, null);
  });
});

describe('E5 source pins: canvas, outline, shell', () => {
  test('the selection outline and the toolbar carry jv-motion-appear and are keyed by selectedId', () => {
    assert.match(canvas, /key=\{`outline:\$\{selectedId\}`\}[\s\S]{0,200}className="jv-motion-appear"/);
    assert.match(canvas, /key=\{`toolbar:\$\{selectedId\}`\}[\s\S]{0,200}className="jv-motion-appear"/);
  });
  test('ZoneView carries jv-motion-appear and jv-motion-zone', () => {
    const zone = canvas.slice(canvas.indexOf('const ZoneView'), canvas.indexOf('const DragHandle'));
    assert.match(zone, /className="jv-motion-appear"/);
    assert.match(zone, /className="jv-motion-zone"/);
  });
  test('a device switch restarts jv-motion-device-in on the layer, on the device and not when motion is off', () => {
    const at = canvas.indexOf("classList.add('jv-motion-device-in')");
    assert.ok(at > 0);
    const block = canvas.slice(canvas.lastIndexOf('useEffect', at), at + 120);
    assert.match(block, /if \(!layer \|\| motionOff\) return/);
    assert.match(block, /\[device\]/);
  });
  test('the flash overlay is aria-hidden, has data-jvbe-flash, and is not drawn when motion is off', () => {
    assert.match(canvas, /flashLive && !motionOff/);
    const at = canvas.indexOf('data-jvbe-flash');
    const tag = canvas.slice(at - 200, at + 400);
    assert.match(tag, /aria-hidden="true"/);
    assert.match(tag, /className="jv-motion-flash"/);
    assert.match(canvas, /FLASH_MAX_MS = 900/);
  });
  test('the preview runner stops adding the hidden state again and never runs when motion is off', () => {
    assert.match(canvas, /if \(motionOff\) return;\n\s+const level/);
    assert.match(canvas, /classList\.remove\('jvb-motion-on'\)/);
  });
  test('the outline imports flipOffsets and returns early when motion is off or dragging', () => {
    assert.match(outline, /import \{[^}]*flipOffsets[^}]*\} from '\.\/motion'/);
    assert.match(outline, /if \(!changed \|\| motionOff \|\| dragging \|\| !tree\) return/);
  });
  test('the shell sets data-reduce-motion from the OS query or the preference', () => {
    assert.match(shell, /'data-reduce-motion': ''/);
    assert.match(shell, /editorMotionOff\(osReduce, reducePref\)/);
    assert.match(shell, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    assert.match(shell, /addEventListener\?\.\('change'/);
  });
});

describe('E6 index.css', () => {
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/g)].map(m => m[1]);
  test('one no-preference block holds the four editor rules with their durations', () => {
    const block = blocks.find(b => b.includes('.jv-motion-appear'));
    assert.ok(block, 'a no-preference block with jv-motion-appear');
    assert.equal(blocks.filter(b => b.includes('.jv-motion-')).length, 1);
    assert.match(block, /\.jv-builder:not\(\[data-reduce-motion\]\) \.jv-motion-appear \{\s*animation: jvbe-appear 120ms/);
    assert.match(block, /\.jv-builder:not\(\[data-reduce-motion\]\) \.jv-motion-zone \{[^}]*150ms/);
    assert.match(block, /\.jv-builder:not\(\[data-reduce-motion\]\) \.jv-motion-flash \{\s*animation: jvbe-flash 600ms/);
    assert.match(block, /\.jv-builder:not\(\[data-reduce-motion\]\) \.jv-motion-device-in \{\s*animation: jvbe-device-in 180ms/);
  });
  test('the preference rule turns animation and transition off', () => {
    assert.match(css, /\.jv-builder\[data-reduce-motion\] \*,[\s\S]{0,120}\{\s*animation: none !important;\s*transition: none !important;/);
  });
  test('the editor rules sit after the builder section and the first reduce block is untouched', () => {
    assert.ok(css.indexOf('.jv-motion-appear') > css.indexOf('.jv-builder-views'));
    const first = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const text = css.slice(first, css.indexOf('/* Path focus'));
    assert.match(text, /\.spin \{\s*animation: none;/);
    assert.match(text, /scroll-behavior: auto !important;/);
    const editorStart = css.indexOf('@keyframes jvbe-appear');
    assert.ok(first < editorStart);
    assert.equal(css.slice(first, editorStart).includes('jv-motion-'), false);
  });
  test('no em dash anywhere in the motion files', () => {
    for (const f of [`${B}/motion.ts`, `${B}/BuilderCanvas.tsx`, `${B}/BuilderOutline.tsx`, `${B}/BuilderThemePanel.tsx`, `${B}/BuilderInspector.tsx`, `${B}/BuilderShell.tsx`, 'src/index.css']) {
      assert.equal(/\u2014| \u2013 /.test(read(f)), false, f);
    }
  });
});

describe('E7 the theme panel', () => {
  test('a Motion select with exactly none, subtle and cinematic', () => {
    assert.match(panel, /label="Motion"/);
    assert.match(panel, /MOTION_OPTIONS = \[\s*\{ value: 'none', label: 'None' \},\s*\{ value: 'subtle', label: 'Subtle' \},\s*\{ value: 'cinematic', label: 'Cinematic' \}\s*\]/);
    assert.match(panel, /set\(\{ motion: v \}/);
    assert.match(panel, /'theme\.motion'/);
  });
  test('Preview motion is a button with aria-disabled and a reason for each way it is off', () => {
    assert.match(panel, /aria-disabled=\{previewOff\}/);
    assert.match(panel, /Preview motion/);
    assert.match(panel, /Page motion is off\./);
    assert.match(panel, /Your device asks for reduced motion/);
    assert.match(panel, /Reduce motion in the editor is on\./);
  });
  test('the Reduce motion in the editor checkbox is there, with its hint', () => {
    assert.match(panel, /label="Reduce motion in the editor"/);
    assert.match(panel, /Only this browser, only the editor\./);
  });
  test('the hints read the preset numbers and write none of their own', () => {
    assert.match(panel, /MOTION_PRESETS\.subtle\.distancePx/);
    assert.match(panel, /MOTION_PRESETS\.cinematic\.distancePx/);
    assert.equal(/10px|24px/.test(panel), false);
  });
});

describe('E8 the inspector', () => {
  test('Advanced has Entrance animation with the four options, for a section only', () => {
    assert.match(inspector, /label="Entrance animation"/);
    assert.match(inspector, /REVEAL_OPTIONS = \[\s*\{ value: 'inherit', label: 'Same as the page' \},\s*\{ value: 'none', label: 'None' \},\s*\{ value: 'fade', label: 'Fade in' \},\s*\{ value: 'rise', label: 'Fade and rise' \}\s*\]/);
    assert.match(inspector, /node\.kind === 'section' && \(\s*<SelectField\s+label="Entrance animation"/);
    assert.match(inspector, /props: \{ reveal: v \}/);
  });
  test('the two hints are the spec wording', () => {
    assert.match(inspector, /The first section never moves, so the top of the page shows at once\./);
    assert.match(inspector, /Page motion is off in Global styles, so this section does not move\./);
  });
  test('the Content tab filter leaves out reveal', () => {
    assert.match(inspector, /k !== 'anchor' && k !== 'reveal'/);
  });
});
