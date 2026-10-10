import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// #19 part A: the drawers and editors a keyboard and a screen reader could not use. The Audit, the
// ROAS Forecaster and the Shopify product picker were plain divs, so focus stayed behind them and
// Escape closed the step panel around the picker as well. The Ad, Form, Upsell, Thank-you and Page
// editors had about 100 labels tied to nothing, 32 selection buttons that never said which one was
// on, and text down to 9px.
//
// These checks read the source, like edge-kinds.test.mjs, because the components need a browser to
// render. a11y.test.mjs runs the same scans for every lane of #19; this file holds this lane's
// files to them as hard failures, plus the rules only this lane has (the drawer focus ring, ids
// that pair up, names that do not change with state).

const { MIN_TEXT_PX } = await import('./src/lib/a11y.ts');

const read = path => fs.readFileSync(path, 'utf8');
const C = 'src/components';
const EDITORS = ['AdEditor', 'FormEditor', 'UpsellEditor', 'ThankYouEditor', 'PageEditor'].map(f => `${C}/drawers/${f}.tsx`);
const AUDIT = `${C}/drawers/PreFlightAuditDrawer.tsx`;
const FORECASTER = `${C}/drawers/FinancialSimulatorDrawer.tsx`;
const PICKER = `${C}/modals/ShopifyProductPickerModal.tsx`;
const MODALS = [AUDIT, FORECASTER, PICKER];
const ALL = [...EDITORS, ...MODALS];

// ---- Source scans: brace, quote and comment aware, so a `>` or `{` in an expression is not a tag end ----

/** Index just past the brace that closes the one at `open`, skipping strings, templates and comments. */
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

/** The index of the '>' that ends the JSX opening tag starting at `start`. */
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

/** The raw text of an attribute's value: the inside of "..." or of {...}. */
function attrValue(tag, name) {
  const m = new RegExp(`\\s${name}=`).exec(tag);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (tag[at] === '"' || tag[at] === "'") return tag.slice(at + 1, tag.indexOf(tag[at], at + 1));
  if (tag[at] === '{') return tag.slice(at + 1, skipBraces(tag, at) - 1).trim();
  return null;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Line comments and block comments blanked out, so a comment cannot satisfy or trip a scan. */
const withoutComments = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead) => lead);

function smallText(src) {
  const found = [];
  const add = (index, px) => { if (px < MIN_TEXT_PX) found.push(`line ${lineOf(src, index)}: ${px}px`); };
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
    const pxs = [...m[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => Number(x[1]));
    if (pxs.length) pxs.forEach(px => add(m.index, px));
    else if (/^\s*\d+(?:\.\d+)?\s*$/.test(m[1])) add(m.index, Number(m[1]));
  }
  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) add(m.index, Number(m[1]));
  for (const m of src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) add(m.index, Number(m[1]));
  return found;
}

function labelProblems(src) {
  const problems = [];
  const ranges = [];
  const targets = new Set();
  for (const label of openingTags(src, 'label')) {
    const close = src.indexOf('</label>', label.end);
    const inner = close === -1 ? '' : src.slice(label.end + 1, close);
    ranges.push([label.end, close === -1 ? label.end : close]);
    const htmlFor = attrValue(label.text, 'htmlFor');
    if (htmlFor !== null) targets.add(htmlFor);
    else if (!/<(input|select|textarea)(?=[\s>/])/.test(inner)) problems.push(`line ${lineOf(src, label.start)}: <label> names no control`);
  }
  for (const kind of ['input', 'select', 'textarea']) {
    for (const tag of openingTags(src, kind)) {
      if (/\stype="hidden"/.test(tag.text)) continue;
      if (/\saria-label=/.test(tag.text) || /\saria-labelledby=/.test(tag.text)) continue;
      const id = attrValue(tag.text, 'id');
      if (id !== null && targets.has(id)) continue;
      if (ranges.some(([from, to]) => tag.start > from && tag.start < to)) continue;
      problems.push(`line ${lineOf(src, tag.start)}: <${kind}> has no label`);
    }
  }
  return problems;
}

/** Every <button> whose opening tag holds `needle`, and the tag itself. */
function buttonsWith(src, needle) {
  const buttons = openingTags(src, 'button');
  const hits = [];
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + needle.length)) {
    const tag = buttons.filter(b => b.start < at && at < b.end).pop();
    if (tag) hits.push({ line: lineOf(src, at), tag, close: src.indexOf('</button>', tag.end) });
  }
  return hits;
}

/** The source before the component's first early `return null`, comments ignored. */
function beforeReturnNull(src) {
  const code = withoutComments(src);
  const at = code.indexOf('return null');
  return code.slice(0, at === -1 ? code.length : at);
}

// ---- Text size ----

test('no text under 11px in the drawers, the editors and the product picker', () => {
  const offenders = [];
  for (const file of ALL) for (const hit of smallText(read(file))) offenders.push(`${file} ${hit}`);
  assert.deepEqual(offenders, []);
});

test('the text-size scan sees every way these files write a size', () => {
  assert.deepEqual(smallText(`fontSize: '10px', fontSize: 9, x: 'text-[10px] text-[11px]', fontSize: a ? '14px' : '8px'`), [
    'line 1: 10px', 'line 1: 9px', 'line 1: 8px', 'line 1: 10px'
  ]);
  assert.deepEqual(smallText(`fontSize: '11px', className="text-[11px] text-xs"`), []);
});

// ---- Labels ----

test('every label names a control and every control has a name', () => {
  const problems = [];
  for (const file of [...EDITORS, FORECASTER, PICKER]) for (const p of labelProblems(read(file))) problems.push(`${file} ${p}`);
  assert.deepEqual(problems, []);
});

test('each field id is written once and every htmlFor finds its control', () => {
  for (const file of EDITORS) {
    const src = read(file);
    assert.match(src, /import \{ useFieldIds \} from '\.\.\/\.\.\/lib\/a11yHooks';/, file);
    assert.match(src, /const fid = useFieldIds\(\);/, file);
    const ids = [...src.matchAll(/\sid=\{fid\(([^)]+)\)\}/g)].map(m => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `${file}: an id is written twice`);
    for (const m of src.matchAll(/htmlFor=\{fid\(([^)]+)\)\}/g)) {
      assert.ok(ids.includes(m[1]), `${file}: htmlFor={fid(${m[1]})} has no control with that id`);
    }
    for (const m of src.matchAll(/aria-labelledby=\{fid\(([^)]+)\)\}/g)) {
      assert.ok(ids.includes(m[1]), `${file}: aria-labelledby={fid(${m[1]})} points at nothing`);
    }
  }
});

test('a label that names a row of buttons is a group heading, not a <label>', () => {
  const groups = [
    ['AdEditor', 'Ad Channel'],
    ['UpsellEditor', 'Offer Funnel Position'],
    ['FormEditor', 'Form Fields ('],
    ['PageEditor', 'Checkout Flow Mode:'],
    ['PageEditor', 'Minimum Star Rating Filter'],
    ['PageEditor', 'Visitor Targeting Mode']
  ];
  for (const [file, text] of groups) {
    const src = read(`${C}/drawers/${file}.tsx`);
    const at = src.indexOf(text);
    assert.ok(at !== -1, `${file}: ${text}`);
    const opener = src.lastIndexOf('<', at);
    const heading = src.slice(opener, tagEnd(src, opener) + 1);
    assert.match(heading, /^<div id=\{fid\('[\w-]+'\)\}/, `${file}: ${text} heading`);
    const id = /fid\('([\w-]+)'\)/.exec(heading)[1];
    assert.ok(src.includes(`role="group" aria-labelledby={fid('${id}')}`), `${file}: ${text} has no group`);
  }
});

test('the Forecaster ties each slider to its row label and nests no button in a label', () => {
  const src = read(FORECASTER);
  const ranges = openingTags(src, 'input').filter(t => /type="range"/.test(t.text));
  assert.equal(ranges.length, 10);
  for (const r of ranges) {
    const by = attrValue(r.text, 'aria-labelledby');
    const name = attrValue(r.text, 'aria-label');
    assert.ok(by || name, `line ${lineOf(src, r.start)}: a slider with no name`);
    if (by) assert.ok(src.includes(`id="${by}"`), `aria-labelledby="${by}" points at nothing`);
  }
  for (const label of openingTags(src, 'label')) {
    const inner = src.slice(label.end + 1, src.indexOf('</label>', label.end));
    assert.ok(!/<button(?=[\s>])/.test(inner), `line ${lineOf(src, label.start)}: a button inside a label`);
  }
});

// ---- Pressed toggles ----

// [file, onClick needle, buttons that hold it]. A count that no longer matches means the editor
// changed shape and this table needs the new needle, not that the toggle may go unmarked.
const TOGGLES = [
  ['drawers/AdEditor.tsx', 'setEditorTab(', 2],
  ['drawers/AdEditor.tsx', 'setAdFormat(', 3],
  ['drawers/AdEditor.tsx', "handleFieldChange('platform', p)", 1],
  ['drawers/FormEditor.tsx', 'setEditorTab(', 2],
  ['drawers/FormEditor.tsx', 'toggleRequired(f.id)', 1],
  ['drawers/UpsellEditor.tsx', 'setEditorTab(', 2],
  ['drawers/UpsellEditor.tsx', "offerType: 'upsell'", 1],
  ['drawers/UpsellEditor.tsx', "offerType: 'downsell'", 1],
  ['drawers/ThankYouEditor.tsx', 'setEditorTab(', 2],
  ['drawers/PageEditor.tsx', 'setEditorTab(', 2],
  ['drawers/PageEditor.tsx', 'setPreviewDevice(', 2],
  ['drawers/PageEditor.tsx', 'setPreviewVariant(', 2],
  ['drawers/PageEditor.tsx', 'setPreviewViewMode(', 2],
  ['drawers/PageEditor.tsx', 'setPreviewCurrency(code)', 1],
  ['drawers/PageEditor.tsx', "handleFieldChange('checkoutMode'", 2],
  ['drawers/PageEditor.tsx', "handleFieldChange('cookieConsentGeoTarget'", 2],
  ['drawers/PageEditor.tsx', "handleFieldChange('socialProofMinRating'", 2],
  ['drawers/PageEditor.tsx', 'setActiveVariantTab(', 2],
  ['drawers/FinancialSimulatorDrawer.tsx', 'applyPreset(', 3]
];

test('selection buttons say whether they are on', () => {
  const problems = [];
  for (const [file, needle, count] of TOGGLES) {
    const hits = buttonsWith(read(`${C}/${file}`), needle);
    if (hits.length !== count) problems.push(`${file} ${needle}: ${hits.length} buttons, expected ${count}`);
    for (const h of hits) if (!/\saria-pressed=/.test(h.tag.text)) problems.push(`${file} line ${h.line} ${needle}: no aria-pressed`);
  }
  assert.deepEqual(problems, []);
});

test('a pressed button keeps one name whether it is on or off', () => {
  // Its words must not be chosen by the state it reports: a screen reader would hear "Required,
  // pressed" and then "Optional, not pressed" for one button. A fixed aria-label settles it.
  const problems = [];
  for (const [file, needle] of TOGGLES) {
    const src = read(`${C}/${file}`);
    for (const h of buttonsWith(src, needle)) {
      if (/\saria-label=/.test(h.tag.text)) continue;
      const pressed = attrValue(h.tag.text, 'aria-pressed');
      if (pressed === null) continue; // reported by the test above
      const inner = src.slice(h.tag.end + 1, h.close);
      const flips = [...inner.matchAll(/\{([^{}]*\?[^{}]*:[^{}]*)\}/g)].map(m => m[1]);
      if (flips.some(expr => expr.replace(/[!()\s]/g, '').startsWith(pressed.replace(/[!()\s]/g, '')))) {
        problems.push(`${file} line ${h.line}: its text follows ${pressed}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  const required = buttonsWith(read(`${C}/drawers/FormEditor.tsx`), 'toggleRequired(f.id)')[0].tag.text;
  assert.match(required, /aria-label=\{`\$\{f\.label\} required`\}/);
});

test('an on and off checkbox is named for its setting, not for the word beside it', () => {
  const src = read(`${C}/drawers/PageEditor.tsx`);
  // Each of these sits in a <label> whose only text is Active, Off, Shown or Hidden.
  for (const field of ['orderBumpEnabled', 'abTestingEnabled', 'exitIntentEnabled', 'mobileStickyBarEnabled', 'socialProofWallEnabled', 'socialProofPhotosEnabled', 'cookieConsentEnabled']) {
    const box = openingTags(src, 'input').find(t => /type="checkbox"/.test(t.text) && t.text.includes(`data.${field}`) && /\schecked=/.test(t.text));
    assert.ok(box, field);
    assert.match(box.text, /\saria-label="[A-Z][^"]+"/, field);
  }
});

// ---- The three modal dialogs ----

test('the Audit, the Forecaster and the product picker are modal dialogs on the shared stack', () => {
  for (const file of MODALS) {
    const src = read(file);
    const head = beforeReturnNull(src);
    assert.match(head, /useDialogFocus<HTMLDivElement>\(isOpen, onClose, \{[^;]*modal: true/, `${file}: useDialogFocus modal: true before the early return`);
    const panel = openingTags(src, 'div').find(t => /\sref=\{panelRef\}/.test(t.text));
    assert.ok(panel, `${file}: the panel carries the hook's ref`);
    assert.match(panel.text, /\srole="dialog"/, file);
    assert.match(panel.text, /\saria-modal="true"/, file);
    const labelledBy = attrValue(panel.text, 'aria-labelledby');
    assert.ok(labelledBy, `${file}: aria-labelledby`);
    // The heading it points at takes focus on open (tabIndex -1: focusable, never tabbable).
    const heading = ['h2', 'h3'].flatMap(h => openingTags(src, h)).find(t => attrValue(t.text, 'id') === labelledBy);
    assert.ok(heading, `${file}: no heading with id ${labelledBy}`);
    assert.match(heading.text, /\stabIndex=\{-1\}/, file);
    assert.match(heading.text, /\sdata-dialog-start/, file);
  }
});

test('the drawers keep their generated-stylesheet root, and fall back to the map when their opener is gone', () => {
  for (const file of [AUDIT, FORECASTER]) {
    const src = read(file);
    assert.match(src, /className="jv-utility fixed inset-0/, file);
    assert.match(beforeReturnNull(src), /fallbackFocusId: 'journey-map'/, file);
    // The dialog is the inner panel, never the backdrop that carries the scope class.
    const root = openingTags(src, 'div').find(t => t.text.includes('jv-utility fixed inset-0'));
    assert.ok(!/role="dialog"/.test(root.text), file);
  }
});

test('the product picker takes focus at its heading and names its controls', () => {
  const src = read(PICKER);
  // autoFocus on the search box would win the race with the heading and skip the title.
  assert.ok(!/\sautoFocus/.test(src), 'no autoFocus');
  const search = openingTags(src, 'input').find(t => t.text.includes('setSearchQuery(e.target.value)'));
  assert.match(search.text, /\saria-label="Search products"/);
  const clear = openingTags(src, 'button').find(t => t.text.includes("setSearchQuery('')"));
  assert.match(clear.text, /\saria-label="Clear search"/);
  // A product photo sits beside the product's own title, so it adds nothing when read aloud.
  for (const img of openingTags(src, 'img')) assert.match(img.text, /\salt=""/);
});

test('icon-only close buttons have names', () => {
  for (const file of [FORECASTER, PICKER]) {
    const close = openingTags(read(file), 'button').find(t => t.text.includes('onClick={onClose}'));
    assert.ok(close, `${file} has a close button`);
    // "Close", or "Close" plus what it closes (forecaster-phone.test.mjs pins the Forecaster's).
    assert.match(close.text, /\saria-label="Close( [^"]+)?"/, file);
    assert.match(close.text, /\stype="button"/, file);
  }
  const audit = openingTags(read(AUDIT), 'button').find(t => t.text.includes('onClick={onClose}'));
  assert.match(audit.text, /\saria-label="[^"]+"/);
  // Remove buttons in a list say which row they remove.
  assert.match(read(`${C}/drawers/UpsellEditor.tsx`), /aria-label=\{`Remove value point \$\{idx \+ 1\}`\}/);
  assert.match(read(`${C}/drawers/ThankYouEditor.tsx`), /aria-label=\{`Remove step \$\{i \+ 1\}`\}/);
  assert.match(read(`${C}/drawers/PageEditor.tsx`), /aria-label=\{`Remove key benefit \$\{idx \+ 1\}`\}/);
});

test('no added accessible name has an em dash or a spaced en dash', () => {
  for (const file of ALL) {
    for (const m of read(file).matchAll(/aria-label=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const text = m[1] ?? m[2];
      assert.ok(!text.includes('\u2014') && !/\s\u2013\s/.test(text), `${file}: ${text}`);
    }
  }
});

// Open list, second round (2026-10-09): the People row that opens the customer drawer was a div with an
// onClick, so a keyboard could not reach the drawer at all.
test('the People row is a button named for the person, keeps its grid, and closing the drawer puts focus back on it', () => {
  const suite = read(`${C}/campaign/HubEmailSuite.tsx`);
  const rows = openingTags(suite, 'button').filter(t => /\sdata-person-row=/.test(t.text));
  assert.equal(rows.length, 1, 'the People row is not one button');
  const row = rows[0].text;
  assert.match(row, /\stype="button"/);
  // Fix round: the name says the email as well, so two people with one name are told apart.
  assert.equal(attrValue(row, 'aria-label'), 'sub.name ? `Open ${sub.name}, ${sub.email}` : `Open ${sub.email}`');
  assert.equal(attrValue(row, 'onClick'), '() => setSelectedCustomerEmail(sub.email)');
  // Nothing else opens the drawer for a row.
  assert.equal((suite.match(/setSelectedCustomerEmail\(sub\.email\)/g) || []).length, 1, 'another element opens the drawer');
  // The same six columns as the header row, read left to right, with no button chrome.
  assert.match(row, /gridTemplateColumns: '1\.5fr 1\.5fr 1\.2fr 1fr 1\.8fr 36px'/);
  for (const rule of ["width: '100%'", "textAlign: 'left'", "backgroundColor: 'transparent'", "borderTop: 'none'", "color: 'inherit'", "fontFamily: 'inherit'"]) assert.ok(row.includes(rule), `the row lost ${rule}`);
  // Closing the drawer finds that row by its person and focuses it, once the drawer is gone.
  const at = suite.indexOf('<CustomerProfileDrawer');
  assert.ok(at > -1, 'the drawer is not rendered');
  const onClose = attrValue(openingTags(suite.slice(at), 'CustomerProfileDrawer')[0].text, 'onClose');
  assert.match(onClose, /const email = selectedCustomerEmail;\s*setSelectedCustomerEmail\(null\);/);
  assert.match(onClose, /requestAnimationFrame\(\(\) => \{[\s\S]*querySelectorAll<HTMLButtonElement>\('button\[data-person-row\]'\)[\s\S]*el\.dataset\.personRow === email[\s\S]*row\?\.focus\(\);/);
  // Fix round: a button holds phrasing content only, so every cell and line inside the row is a span.
  const inside = suite.slice(rows[0].end, suite.indexOf('</button>', rows[0].end));
  assert.ok(inside.includes('{sub.email}</span>') && inside.includes('<ChevronRight size={13} />'), 'the row\'s content was not found, so this checks nothing');
  assert.deepEqual(openingTags(inside, 'div').map(t => `HubEmailSuite.tsx:${lineOf(suite, rows[0].end + t.start)}`), [], 'a div inside the People row button');
  // The table clips its overflow, so the row's ring is drawn inside it (the global ring sits 2px outside).
  assert.match(read('src/index.css'), /button\[data-person-row\]:focus-visible \{\s*outline-offset: -2px !important;\s*\}/);
});
