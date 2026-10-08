import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// The page builder's keyboard and screen reader contract (LANDING_BUILDER_DESIGN.md section 7, and
// JOURNEY_UI_HANDOFF.md's house rules), read from the source in the style of a11y-drawers.test.mjs
// because the components need a browser to render. The device switch also runs for real, through
// the React stand-in check-design-undo.test.mjs uses, so its keys are pinned by behaviour.
// scripts/builder-browser-check.mjs is the same editor driven in Chrome.

const { MIN_TEXT_PX } = await import('./src/lib/a11y.ts');

const read = path => fs.readFileSync(path, 'utf8');
const B = 'src/components/builder';
const COMPONENTS = ['BuilderShell', 'BuilderCanvas', 'BuilderPalette', 'BuilderOutline', 'BuilderInspector', 'BuilderThemePanel', 'BuilderFields'].map(f => `${B}/${f}.tsx`);
const PURE = ['builderState', 'dropZones', 'canvasMarkup'].map(f => `${B}/${f}.ts`);
const ALL = [...COMPONENTS, ...PURE];
const shell = read(`${B}/BuilderShell.tsx`);
const canvasSrc = read(`${B}/BuilderCanvas.tsx`);
const outline = read(`${B}/BuilderOutline.tsx`);
const inspector = read(`${B}/BuilderInspector.tsx`);
const palette = read(`${B}/BuilderPalette.tsx`);
const fields = read(`${B}/BuilderFields.tsx`);

// ---- Source scans: brace, quote and comment aware (the a11y-drawers.test.mjs scanners) ----

function skipBraces(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) return src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') {
      for (i++; i < src.length && src[i] !== '`'; i++) {
        if (src[i] === '\\') i++;
        else if (src[i] === '$' && src[i + 1] === '{') i = skipBraces(src, i + 1) - 1;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return src.length;
}

function tagEnd(src, start) {
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { i = skipBraces(src, i) - 1; continue; }
    if (c === '"' || c === "'") { i = src.indexOf(c, i + 1); if (i === -1) return src.length; continue; }
    if (c === '>') return i;
  }
  return src.length;
}

function openingTags(src, name) {
  const re = new RegExp(`<${name}(?=[\\s>/])`, 'g');
  const tags = [];
  for (let m; (m = re.exec(src)); ) {
    const end = tagEnd(src, m.index);
    tags.push({ start: m.index, end, text: src.slice(m.index, end + 1) });
  }
  return tags;
}

function attrValue(tag, name) {
  const m = new RegExp(`\\s${name}=`).exec(tag);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (tag[at] === '"' || tag[at] === "'") return tag.slice(at + 1, tag.indexOf(tag[at], at + 1));
  if (tag[at] === '{') return tag.slice(at + 1, skipBraces(tag, at) - 1).trim();
  return null;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * What a reader hears inside a button: its text, plus any {expression} that is not JSX (a label
 * variable or a string). An icon component, or an expression that only picks between icons, is
 * nothing.
 */
function visibleText(inner) {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') { i = tagEnd(inner, i); continue; }
    if (c === '{') {
      const end = skipBraces(inner, i);
      const expr = inner.slice(i + 1, end - 1);
      if (!expr.includes('<') && expr.trim()) out += ' EXPR ';
      i = end - 1;
      continue;
    }
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Buttons with no text and no aria-label or aria-labelledby, as `file line N`. */
function unnamedButtons(src, file = 'src') {
  const found = [];
  for (const tag of openingTags(src, 'button')) {
    if (/\saria-label(ledby)?=/.test(tag.text)) continue;
    if (/\/>$/.test(tag.text)) { found.push(`${file} line ${lineOf(src, tag.start)}`); continue; }
    const close = src.indexOf('</button>', tag.end);
    const inner = close === -1 ? '' : src.slice(tag.end + 1, close);
    if (!/[A-Za-z]/.test(visibleText(inner))) found.push(`${file} line ${lineOf(src, tag.start)}`);
  }
  return found;
}

function smallText(src) {
  const found = [];
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
    for (const x of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) if (Number(x[1]) < MIN_TEXT_PX) found.push(`line ${lineOf(src, m.index)}: ${x[1]}px`);
  }
  for (const m of src.matchAll(/(?:font-size:|font:\s*\d+\s+)(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < MIN_TEXT_PX) found.push(`line ${lineOf(src, m.index)}: ${m[1]}px`);
  return found;
}

/** The body of a function or arrow assigned to `name`, from its first brace. */
function bodyOf(src, marker) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `${marker} is in the source`);
  const open = src.indexOf('{', at + marker.length);
  return src.slice(open, skipBraces(src, open));
}

/**
 * The branch a Tab check opens: the braces after its condition, or the one statement when there are
 * none (`if (e.key === 'Tab') return;`).
 */
function tabBranch(src, at) {
  const close = src.indexOf(')', at);
  let i = close + 1;
  while (/\s/.test(src[i])) i++;
  if (src[i] === '{') return src.slice(i, skipBraces(src, i));
  return src.slice(i, src.indexOf(';', i) + 1);
}

// ---- The scanners see what they exist for (positive and negative controls) ----

test('the button scanner flags an icon-only button and passes a named one', () => {
  const src = [
    '<button type="button" onClick={go}><Trash2 size={12} aria-hidden="true" /></button>',
    '<button type="button" aria-label="Delete"><Trash2 size={12} /></button>',
    '<button type="button">{label}</button>',
    '<button type="button">{a ? <X /> : <Y />}</button>',
    '<button type="button"><Eye size={14} /><span>Preview</span></button>',
    '<button type="button" {...attributes} />'
  ].join('\n');
  assert.deepEqual(unnamedButtons(src), ['src line 1', 'src line 4', 'src line 6']);
  assert.deepEqual(smallText(`fontSize: '10px', x: 'font-size:9px', y: 'font:500 10px/1 a'`), ['line 1: 10px', 'line 1: 9px', 'line 1: 10px']);
  const keys = `if (e.key === 'Tab') return;\nif (e.key === 'Tab') { e.preventDefault(); }\nif (e.key === 'Tab') { setX(null); return true; }`;
  const branches = [...keys.matchAll(/'Tab'/g)].map(m => tabBranch(keys, m.index));
  assert.deepEqual(branches.map(b => /preventDefault/.test(b)), [false, true, false]);
});

// ---- The shell ----

describe('the builder is a full-screen modal dialog on the shared stack', () => {
  test('a <dialog> labelled by its heading, which takes focus on open and is never a tab stop', () => {
    const dialogs = openingTags(shell, 'dialog');
    assert.equal(dialogs.length, 1);
    const dialog = dialogs[0].text;
    assert.equal(attrValue(dialog, 'aria-labelledby'), 'titleId');
    assert.equal(attrValue(dialog, 'aria-modal'), 'true');
    assert.match(shell, /const titleId = 'jvb-builder-title';/);
    const heading = openingTags(shell, 'h2').find(t => attrValue(t.text, 'id') === 'titleId');
    assert.ok(heading, 'the heading the dialog names');
    assert.match(heading.text, /\stabIndex=\{-1\}/);
    assert.match(heading.text, /\sdata-dialog-start/);
    assert.match(shell.slice(heading.end, shell.indexOf('</h2>', heading.end)), /Page builder/);
  });

  test('it joins the dialog stack as a modal (Escape for the top one only, Tab kept inside, focus back to the opener) and opens with showModal', () => {
    assert.match(shell, /useDialogFocus<HTMLDialogElement>\(true, requestClose, \{ modal: true, initialFocus: false \}\)/);
    assert.match(shell, /dialog\.showModal\(\)/);
    assert.match(shell, /querySelector<HTMLElement>\('\[data-dialog-start\]'\)\?\.focus\(\{ preventScroll: true \}\)/);
    assert.ok(shell.indexOf('useDialogFocus<HTMLDialogElement>(') < shell.indexOf('dialog.showModal()'), 'the hook records the opener before showModal moves focus');
    // The drag library's live region lives in the dialog: outside it, a modal makes it inert and unheard.
    assert.match(shell, /container: dialogEl \?\? undefined/);
  });

  test('Escape: a drag first, then inline editing, then the selection, then the builder itself', () => {
    const handler = bodyOf(shell, 'const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) =>');
    const esc = handler.slice(handler.indexOf("if (e.key === 'Escape')"));
    const drag = esc.indexOf('if (drag || inlineEditing) {');
    const select = esc.indexOf("dispatch({ type: 'select', id: null })");
    const close = esc.indexOf('requestClose();');
    assert.ok(drag > 0 && select > drag && close > select, 'drag and inline edit, then clear the selection, then close');
    const dragBranch = esc.slice(drag, esc.indexOf('}', drag) + 1);
    assert.match(dragBranch, /e\.preventDefault\(\);/);
    assert.doesNotMatch(dragBranch, /stopPropagation|handled\(\)/, 'a drag in progress still gets its Escape: the sensor listens on the document');
    assert.match(canvasSrc, /if \(e\.key === 'Escape'\) \{[^}]*e\.preventDefault\(\);\s*state\.finish\(true\);/, 'the inline editor answers its own Escape by keeping the text (design section 7); undo takes it back');
    assert.doesNotMatch(canvasSrc, /state\.finish\(false\)/, 'nothing in the canvas reverts an inline edit');
    // The native dialog's own Escape (cancel) never closes behind the reducer's back.
    const cancel = shell.slice(shell.indexOf('onCancel={e => {'), shell.indexOf('style={{', shell.indexOf('onCancel={e => {')));
    assert.match(cancel, /e\.preventDefault\(\);/);
    assert.match(cancel, /dispatch\(\{ type: 'select', id: null \}\)/);
  });

  test('the editing keys of design section 7 each have a handler', () => {
    const handler = bodyOf(shell, 'const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) =>');
    for (const [what, re] of [
      ['Delete and Backspace remove', /\(e\.key === 'Delete' \|\| e\.key === 'Backspace'\) && !mod && !e\.altKey[\s\S]{0,120}type: 'remove'/],
      ['Cmd or Ctrl+D duplicates', /mod && !e\.altKey && key === 'd'[\s\S]{0,120}type: 'duplicate'/],
      ['Cmd or Ctrl+Z undoes and with Shift redoes', /mod && !e\.altKey && key === 'z'[\s\S]{0,160}e\.shiftKey \? 'redo' : 'undo'/],
      ['Ctrl+Y redoes', /key === 'y'[\s\S]{0,120}type: 'redo'/],
      ['Alt+Up and Alt+Down move among siblings', /e\.altKey && !mod && \(e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'\)[\s\S]{0,260}siblingMove\(/],
      ['Alt+Shift+Up and Alt+Shift+Down move into the next column or section', /e\.shiftKey \? crossMove\(/],
      ['Enter on the canvas edits in place', /e\.key === 'Enter'[\s\S]{0,200}data-jvb-canvas-host[\s\S]{0,200}setInlineRequest/],
      ['Space on a palette item or a drag handle picks it up', /e\.code === 'Space'[\s\S]{0,200}placeItemOf\(e\.target/]
    ]) {
      assert.match(handler, re, what);
    }
    // Typing in a field keeps its own keys: Delete, Backspace and Cmd Z belong to the text there.
    assert.ok(handler.indexOf('if (typing) return;') < handler.indexOf("type: 'remove'"));
  });

  test('keyboard placing walks the zones with the arrows and drops with Space or Enter', () => {
    const placing = bodyOf(shell, 'const placingKey = (e: React.KeyboardEvent): boolean =>');
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Enter', 'Escape']) assert.ok(placing.includes(`'${key}'`), key);
    assert.match(placing, /e\.code === 'Space'/);
    assert.match(palette, /data-place-label=\{label\}/);
    assert.match(canvasSrc, /data-place-node=\{id\}/);
  });

  test('every change and refusal is said in one polite live region', () => {
    const region = openingTags(shell, 'div').find(t => /role="status"/.test(t.text) && /aria-live="polite"/.test(t.text));
    assert.ok(region, 'a polite status region');
    assert.match(region.text, /className="jv-sr-only"/);
    for (const handler of ['onDragStart', 'onDragOver', 'onDragEnd', 'onDragCancel']) assert.match(shell, new RegExp(`${handler}: \\(`), handler);
    assert.match(shell, /screenReaderInstructions: SCREEN_READER_INSTRUCTIONS/);
    // The save chip says Saved or Unsaved changes, and is a status too.
    const chip = openingTags(shell, 'span').find(t => /data-builder-save-state=/.test(t.text));
    assert.match(chip.text, /role="status"/);
    assert.match(shell, /\{state\.dirty \? 'Unsaved changes' : 'Saved'\}/);
  });

  test('Preview and the narrow view switch say whether they are on', () => {
    const previewButton = openingTags(shell, 'button').find(t => t.text.includes('setPreview('));
    assert.match(previewButton.text, /aria-pressed=\{preview\}/);
    assert.match(shell, /aria-pressed=\{view === id\}/);
  });
});

describe('every control has a name', () => {
  test('no icon-only button in the builder is without an accessible name', () => {
    const problems = [];
    for (const file of COMPONENTS) problems.push(...unnamedButtons(read(file), file));
    assert.deepEqual(problems, []);
    // And the real files hold icon buttons, so the clean scan is not vacuous.
    assert.ok(openingTags(shell, 'button').length >= 5);
    assert.match(canvasSrc, /aria-label="Delete"/);
    assert.match(canvasSrc, /aria-label="Duplicate"/);
    assert.match(canvasSrc, /aria-label=\{across \? 'Move left' : 'Move up'\}/);
    assert.match(shell, /aria-label="Undo"/);
    assert.match(shell, /aria-label="Redo"/);
  });

  test('every field has a visible label tied to it, and every colour picker has a hex text field beside it', () => {
    for (const label of openingTags(fields, 'label')) assert.match(label.text, /\shtmlFor=/, `line ${lineOf(fields, label.start)}`);
    for (const kind of ['input', 'select', 'textarea']) {
      for (const tag of openingTags(fields, kind)) {
        assert.ok(/\sid=/.test(tag.text) || /\saria-label=/.test(tag.text) || /\{\.\.\.common\}/.test(tag.text), `${kind} at line ${lineOf(fields, tag.start)} has no name`);
      }
    }
    const color = openingTags(fields, 'input').find(t => /type="color"/.test(t.text));
    assert.match(color.text, /aria-label=\{`\$\{label\}, colour picker`\}/);
    const hex = fields.slice(fields.indexOf('type="color"'));
    assert.match(hex, /id=\{`\$\{id\}-hex`\}/, 'the hex field sits beside the picker');
  });

  test('the device switch is a radio group named "Editing for", one tab stop', () => {
    const fn = inspector.slice(inspector.indexOf('export function DeviceSwitch('), inspector.indexOf('export interface BuilderInspectorProps'));
    assert.ok(fn.length > 500, 'the DeviceSwitch source was found');
    assert.match(inspector, /export function DeviceSwitch\(\{ device, onDevice, label = 'Editing for'/);
    assert.match(fn, /role="radiogroup"/);
    assert.match(fn, /aria-label=\{label\}/);
    assert.match(fn, /role="radio"/);
    assert.match(fn, /aria-checked=\{checked\}/);
    assert.match(fn, /tabIndex=\{checked \? 0 : -1\}/);
    const top = openingTags(shell, 'DeviceSwitch');
    assert.equal(top.length, 1, 'the top bar has one');
    assert.equal(attrValue(top[0].text, 'label'), null, 'and it keeps the name Editing for');
  });

  test('the canvas host is a named region with one tab stop', () => {
    const host = openingTags(canvasSrc, 'div').find(t => /\sref=\{hostRef\}/.test(t.text));
    assert.ok(host);
    assert.match(host.text, /\srole="region"/);
    assert.match(host.text, /\saria-label="Page canvas"/);
    assert.match(host.text, /\stabIndex=\{0\}/);
    assert.match(host.text, /\saria-describedby="jvb-canvas-help"/);
    assert.match(canvasSrc, /el\.setAttribute\('role', 'textbox'\);/, 'an inline edit is a textbox');
    assert.match(canvasSrc, /el\.setAttribute\('aria-label', inlineLabel\(widget\.type, target\.path\)\);/, 'named by its prop\'s label');
    // The page's own links and fields are no tab stops inside the editor.
    assert.match(canvasSrc, /if \(el\.matches\(FOCUSABLE_IN_PAGE\)\) el\.setAttribute\('tabindex', '-1'\);/);
  });

  test('the outline is a tree with one tab stop and the tree keys', () => {
    assert.match(outline, /role="tree"/);
    const row = openingTags(outline, 'div').find(t => /role="treeitem"/.test(t.text));
    assert.ok(row);
    for (const attr of ['aria-level', 'aria-setsize', 'aria-posinset', 'aria-selected', 'aria-expanded']) assert.match(row.text, new RegExp(`\\s${attr}=`), attr);
    assert.match(row.text, /tabIndex=\{focused \? 0 : -1\}/);
    const keys = bodyOf(outline, 'const onKey = (e: React.KeyboardEvent<HTMLDivElement>, row: Row) =>');
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']) assert.ok(keys.includes(`case '${key}':`), key);
    // Alt and the command keys pass through to the builder's move, undo and duplicate.
    assert.match(keys, /if \(dragging \|\| e\.altKey \|\| e\.metaKey \|\| e\.ctrlKey\) return;/);
  });

  test('the inspector tabs are a tablist with arrow keys', () => {
    assert.match(inspector, /role="tablist" aria-label="Block settings"/);
    const tab = openingTags(inspector, 'button').find(t => /role="tab"/.test(t.text));
    assert.match(tab.text, /aria-selected=\{tab === t\.id\}/);
    assert.match(tab.text, /aria-controls=/);
    assert.match(tab.text, /tabIndex=\{tab === t\.id \? 0 : -1\}/);
    assert.match(inspector, /role="tabpanel"/);
  });
});

describe('nothing takes Tab', () => {
  test('no handler in the builder prevents Tab, and no element has a positive tab order', () => {
    for (const file of ALL) {
      const src = read(file);
      for (const m of src.matchAll(/['"]Tab['"]/g)) {
        assert.doesNotMatch(tabBranch(src, m.index), /preventDefault/, `${file} line ${lineOf(src, m.index)} prevents Tab`);
      }
      assert.doesNotMatch(src, /tabIndex=\{\s*[1-9]/, `${file}: a positive tabIndex`);
      assert.doesNotMatch(src, /tabindex=["'][1-9]/i, `${file}: a positive tabindex`);
    }
    // The drag sensor ends a drag on Space or Enter only, so a drag in progress never eats Tab.
    assert.match(shell, /export const KEYBOARD_CODES = Object\.freeze\(\{ start: \['Space'\], cancel: \['Escape'\], end: \['Space', 'Enter'\] \}\);/);
    assert.match(canvasSrc, /if \(e\.key === 'Tab'\) return; \/\/ Tab moves on, and blur keeps the text/);
  });
});

describe('house rules', () => {
  test('text is 11px or larger everywhere in the builder', () => {
    const offenders = [];
    for (const file of ALL) for (const hit of smallText(read(file))) offenders.push(`${file} ${hit}`);
    assert.deepEqual(offenders, []);
  });

  test('no em dash and no spaced en dash in any builder file', () => {
    for (const file of [...ALL, 'src/components/drawers/PageEditor.tsx']) {
      const src = read(file);
      assert.ok(!src.includes('\u2014'), `${file} has an em dash`);
      assert.doesNotMatch(src, /\s–\s/, `${file} has a spaced en dash`);
    }
  });

  test('no dangerouslySetInnerHTML; the page\'s markup is parsed only in the canvas\'s inert template', () => {
    for (const file of ALL) {
      const src = read(file);
      assert.ok(!src.includes('dangerouslySetInnerHTML'), file);
      const writes = [...src.matchAll(/\.innerHTML\s*=/g)];
      if (file.endsWith('BuilderCanvas.tsx')) {
        assert.equal(writes.length, 1, 'one innerHTML write');
        assert.match(src, /template\.innerHTML = stripScripts\(html\);/);
      } else {
        assert.equal(writes.length, 0, file);
      }
    }
  });

  test('no Tailwind class names: inline styles and index.css only (nokey is React Flow\'s own opt-out)', () => {
    for (const file of COMPONENTS) {
      for (const m of read(file).matchAll(/className="([^"]*)"/g)) {
        for (const cls of m[1].split(/\s+/)) assert.match(cls, /^(jv-|nokey$)/, `${file}: ${cls}`);
      }
    }
  });

  test('no key in the builder reaches the journey map behind it, where Delete removes the step', () => {
    // Found in Chrome: a keyboard move reordered the outline, React moved the focused row, focus fell
    // to the page body, and the next Delete went to React Flow, which deleted the landing page step.
    const dialog = openingTags(shell, 'dialog')[0].text;
    assert.match(dialog, /className="jv-builder nokey"/, 'React Flow ignores keys from inside .nokey');
    assert.match(shell, /window\.addEventListener\('keydown', guard, true\);/, 'a capture guard for keys outside the builder');
    const guard = bodyOf(shell, 'const guard = (e: KeyboardEvent) =>');
    assert.match(guard, /if \(e\.target instanceof Node && dialog\.contains\(e\.target\)\) return;\s*e\.stopPropagation\(\);\s*if \(e\.key === 'Tab'\) return;/);
    assert.match(shell, /dialog\.addEventListener\('focusout', onFocusOut\);/, 'focus lost to a re-render is put back');
    // A key the builder acts on stops at the dialog: its target may be gone by the time the map sees it.
    const handler = bodyOf(shell, 'const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) =>');
    assert.match(handler, /const handled = \(\) => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*\};/);
    for (const action of ["type: 'remove'", "type: 'duplicate'", "e.shiftKey ? 'redo' : 'undo'", 'siblingMove(', 'setInlineRequest(', 'startPlacing(']) {
      const at = handler.indexOf(action);
      assert.ok(at > 0, action);
      assert.ok(handler.lastIndexOf('handled();', at) > handler.lastIndexOf('return;', at), `${action} is preceded by handled()`);
    }
    assert.match(shell, /\[role="treeitem"\]\[data-node-id="\$\{CSS\.escape\(nodeId\)\}"\]/, 'on the same outline row');
  });
});

describe('one save path, through the page editor', () => {
  test('the builder writes the step only through the onChange it was given', () => {
    for (const file of ALL) {
      const src = read(file);
      for (const banned of ['fetch(', 'localStorage', 'sessionStorage', 'appStore', 'authHeaders']) {
        assert.ok(!src.includes(banned), `${file} uses ${banned}`);
      }
    }
    assert.match(shell, /onChangeRef\.current\(\{ \.\.\.dataRef\.current, builder: s\.doc \}\);/);
    assert.match(shell, /export const AUTOSAVE_MS = 1500;/);
    assert.match(shell, /const timer = window\.setTimeout\(save, AUTOSAVE_MS\);/);
    assert.match(bodyOf(shell, 'const requestClose = useCallback(() =>'), /save\(\);\s*onCloseRef\.current\(\);/, 'saves on close');
  });

  test('PageEditor mounts the builder with its own onChange, converts with migrateLegacyPage, and keeps a way back', () => {
    const editor = read('src/components/drawers/PageEditor.tsx');
    const block = editor.slice(editor.indexOf('{/* PAGE BUILDER:'), editor.indexOf("{editorTab === 'preview' ? ("));
    assert.ok(block.length > 200, 'the button block sits before the preview and settings branch');
    assert.match(block, /if \(!data\.builder\) onChange\(\{ \.\.\.data, builder: migrateLegacyPage\(data\) \}\);/);
    assert.match(block, /\{data\.builder \? 'Open page builder' : 'Convert to page builder'\}/);
    assert.match(block, /Back to simple editor/);
    assert.match(block, /window\.confirm\(/);
    assert.match(block, /<BuilderShell data=\{data\} onChange=\{onChange\} onClose=\{\(\) => setBuilderOpen\(false\)\} \/>/);
    assert.equal((editor.match(/<BuilderShell\b/g) || []).length, 1);
  });
});

// ---- The device switch, run ----

const REACT_STUB = `
  const hooks = () => globalThis.__hooks;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  export function useState(init) {
    const h = hooks(); const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { v: typeof init === 'function' ? init() : init };
    const s = h.slots[k];
    return [s.v, next => { const v = typeof next === 'function' ? next(s.v) : next; if (!Object.is(v, s.v)) { s.v = v; h.dirty = true; } }];
  }
  export function useRef(init) { const h = hooks(); const k = h.i++; if (!(k in h.slots)) h.slots[k] = { current: init }; return h.slots[k]; }
  export function useMemo(fn, deps) {
    const h = hooks(); const k = h.i++; const s = h.slots[k];
    if (s && same(s.deps, deps)) return s.v;
    h.slots[k] = { v: fn(), deps }; return h.slots[k].v;
  }
  export const useCallback = (fn, deps) => useMemo(() => fn, deps);
  export function useEffect(fn, deps) {
    const h = hooks(); const k = h.i++; const s = h.slots[k];
    if (s && deps && same(s.deps, deps)) return;
    const cleanup = s && s.cleanup;
    h.slots[k] = { deps };
    h.effects.push(() => { if (typeof cleanup === 'function') cleanup(); h.slots[k].cleanup = fn(); });
  }
  export const useLayoutEffect = useEffect;
  export const useId = () => ':r' + (hooks().i++) + ':';
  export const forwardRef = render => props => render(props, null);
  export const memo = c => c;
  export const createContext = value => ({ Provider: 'Provider', value });
  export const useContext = context => context.value;
  export const Fragment = 'Fragment';
  export function createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.length > 1 ? children : children[0] } };
  }
  export const jsx = (type, props) => ({ type, props });
  export const jsxs = jsx;
  export default { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useId, forwardRef, memo, createContext, useContext, Fragment, createElement };
`;

async function loadDeviceSwitch() {
  const out = await build({
    stdin: { contents: `export { DeviceSwitch } from './src/components/builder/BuilderInspector.tsx';`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    jsx: 'automatic',
    plugins: [{
      name: 'react-stub',
      setup(b) {
        b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, () => ({ path: 'react', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: REACT_STUB, loader: 'js' }));
      }
    }]
  });
  const dir = mkdtempSync(join(tmpdir(), 'jv-builder-a11y-'));
  const file = join(dir, 'switch.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  try {
    return (await import(pathToFileURL(file).href)).DeviceSwitch;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function* walk(el) {
  if (el == null || typeof el !== 'object') return;
  if (Array.isArray(el)) { for (const c of el) yield* walk(c); return; }
  yield el;
  yield* walk(el.props?.children);
}

describe('the device switch, run with a React stand-in', () => {
  test('one checked radio and one tab stop; the arrows move and choose, wrapping at either end; Tab is left alone', async () => {
    const DeviceSwitch = await loadDeviceSwitch();
    globalThis.requestAnimationFrame = fn => fn();
    const draw = device => {
      globalThis.__hooks = { slots: {}, i: 0, effects: [], dirty: false };
      const chosen = [];
      const tree = DeviceSwitch({ device, onDevice: d => chosen.push(d) });
      return { tree, chosen };
    };
    const { tree, chosen } = draw('desktop');
    const group = [...walk(tree)].find(e => e.props?.role === 'radiogroup');
    assert.ok(group, 'a radiogroup');
    assert.equal(group.props['aria-label'], 'Editing for');
    const radios = [...walk(tree)].filter(e => e.props?.role === 'radio');
    assert.deepEqual(radios.map(r => r.props['aria-label']), ['Desktop', 'Tablet', 'Mobile']);
    assert.deepEqual(radios.map(r => r.props['aria-checked']), [true, false, false]);
    assert.deepEqual(radios.map(r => r.props.tabIndex), [0, -1, -1]);

    const press = (radio, key) => {
      let prevented = false;
      radio.props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    assert.equal(press(radios[0], 'ArrowRight'), true);
    assert.equal(press(radios[0], 'ArrowLeft'), true);
    assert.equal(press(radios[0], 'Tab'), false, 'Tab is not prevented');
    assert.deepEqual(chosen, ['tablet', 'mobile'], 'right goes on, left from the first wraps to the last');
    radios[2].props.onClick();
    assert.deepEqual(chosen.at(-1), 'mobile');

    const mobile = draw('mobile');
    const mRadios = [...walk(mobile.tree)].filter(e => e.props?.role === 'radio');
    assert.deepEqual(mRadios.map(r => r.props.tabIndex), [-1, -1, 0]);
    press(mRadios[2], 'ArrowDown');
    assert.deepEqual(mobile.chosen, ['desktop'], 'down from the last wraps to the first');
    assert.equal([...walk(draw('tablet').tree)].find(e => e.props?.role === 'radiogroup').props['aria-label'], 'Editing for');
    globalThis.__hooks = { slots: {}, i: 0, effects: [], dirty: false };
    const named = DeviceSwitch({ device: 'tablet', onDevice: () => {}, label: 'Style for' });
    assert.equal([...walk(named)].find(e => e.props?.role === 'radiogroup').props['aria-label'], 'Style for');
  });
});
