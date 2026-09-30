import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// #19 part B: the follow-up sequence editor, the A/B split editor and the line panel. A screen
// reader heard the line panel as "Step Transition Analytics" with nothing about which line it was,
// and its header fell back to raw node ids. The two editors had labels tied to nothing, tab and
// step buttons that never said which one was on, a letter list read as "#1, times", and text down
// to 9px.
//
// These checks read the source, like a11y-drawers.test.mjs, because the components need a browser
// to render. a11y.test.mjs runs the same scans for every lane of #19 (as todo until each lane is
// marked landed there); this file holds this lane's three files to them as hard failures, plus the
// rules only this lane has.

const { MIN_TEXT_PX } = await import('./src/lib/a11y.ts');
const { stepShortName, describeEdge } = await import('./src/lib/stepNames.ts');
const { lineKindOf } = await import('./src/lib/stepNavigation.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const read = path => fs.readFileSync(path, 'utf8');
const C = 'src/components/drawers';
const SEQUENCE = `${C}/SequenceEditor.tsx`;
const SPLIT = `${C}/AbSplitEditor.tsx`;
const LINE = `${C}/EdgeInspector.tsx`;
const EDITORS = [SEQUENCE, SPLIT];
const ALL = [SEQUENCE, SPLIT, LINE];

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

/** Every fid('name') id a file writes, in order, so a repeat shows up. */
const fieldIds = src => [...src.matchAll(/\sid=\{fid\('([\w-]+)'\)\}/g)].map(m => m[1]);

// ---- Text size ----

test('no text under 11px in the sequence editor, the split editor and the line panel', () => {
  const offenders = [];
  for (const file of ALL) for (const hit of smallText(read(file))) offenders.push(`${file} ${hit}`);
  assert.deepEqual(offenders, []);
});

// ---- Labels ----

test('every label names a control and every control has a name', () => {
  const problems = [];
  for (const file of EDITORS) for (const p of labelProblems(read(file))) problems.push(`${file} ${p}`);
  assert.deepEqual(problems, []);
  // The scanner itself: a bare label and a bare input are both caught.
  assert.deepEqual(labelProblems(`<label style={{ a: 1 }}>Orphan</label>\n<input value={v} />`), [
    'line 1: <label> names no control',
    'line 2: <input> has no label'
  ]);
});

test('each field id is written once and every htmlFor and aria-labelledby finds it', () => {
  for (const file of EDITORS) {
    const src = read(file);
    assert.match(src, /import \{ useFieldIds \} from '\.\.\/\.\.\/lib\/a11yHooks';/, file);
    assert.match(src, /const fid = useFieldIds\(\);/, file);
    const ids = fieldIds(src);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, [], `${file}: an id is written twice`);
    for (const m of src.matchAll(/htmlFor=\{fid\('([\w-]+)'\)\}/g)) {
      assert.ok(ids.includes(m[1]), `${file}: htmlFor={fid('${m[1]}')} has no control with that id`);
    }
    // aria-labelledby may join two ids (a branch name and the words beside the field).
    for (const tag of [...openingTags(src, 'input'), ...openingTags(src, 'div'), ...openingTags(src, 'select')]) {
      const by = attrValue(tag.text, 'aria-labelledby');
      if (by === null) continue;
      const refs = [...by.matchAll(/fid\('([\w-]+)'\)/g)].map(m => m[1]);
      assert.ok(refs.length > 0, `${file} line ${lineOf(src, tag.start)}: aria-labelledby names no fid`);
      for (const ref of refs) assert.ok(ids.includes(ref), `${file}: aria-labelledby fid('${ref}') points at nothing`);
    }
  }
});

test('a label that names a row of buttons is a group heading, not a <label>', () => {
  const groups = [
    [SEQUENCE, 'Pre-built Sequence Blueprints'],
    [SEQUENCE, 'Insert Tag:'],
    [SPLIT, 'Declare Winner (Route 100% Traffic)']
  ];
  for (const [file, text] of groups) {
    const src = read(file);
    const at = src.indexOf(text);
    assert.ok(at !== -1, `${file}: ${text}`);
    const opener = src.lastIndexOf('<', at);
    const heading = src.slice(opener, tagEnd(src, opener) + 1);
    assert.match(heading, /^<(div|span) id=\{fid\('[\w-]+'\)\}/, `${file}: ${text} heading`);
    const id = /fid\('([\w-]+)'\)/.exec(heading)[1];
    assert.ok(src.includes(`role="group" aria-labelledby={fid('${id}')}`), `${file}: ${text} has no group`);
  }
  // Rows with no visible heading are still named groups.
  assert.match(read(SEQUENCE), /role="group"\s+aria-label="Editor view"/);
  assert.match(read(SEQUENCE), /role="group" aria-label="Letters in this sequence"/);
  assert.match(read(SPLIT), /role="group" aria-label="Split presets"/);
});

test('the split slider and each branch field say which branch they belong to', () => {
  const src = read(SPLIT);
  const slider = openingTags(src, 'input').find(t => /type="range"/.test(t.text));
  assert.ok(slider, 'the split slider');
  const sliderId = /fid\('([\w-]+)'\)/.exec(attrValue(slider.text, 'id') ?? '')?.[1];
  assert.ok(sliderId && src.includes(`htmlFor={fid('${sliderId}')}`), 'the slider is tied to "Traffic Distribution"');
  // The value is read as a share, not a bare number from 0 to 100.
  assert.match(slider.text, /\saria-valuetext=\{`\$\{ratioA\}% A, \$\{ratioB\}% B`\}/);
  for (const [field, branch] of [['branchAPageSlug', 'branch-a'], ['branchBPageSlug', 'branch-b']]) {
    const box = openingTags(src, 'input').find(t => t.text.includes(`data.${field}`));
    assert.ok(box, field);
    const by = attrValue(box.text, 'aria-labelledby') ?? '';
    // Both target page boxes sit beside the words "Target Page:", so the branch name comes first.
    assert.ok(by.includes(`fid('${branch}')`) && by.includes(`fid('${branch}-page')`), `${field}: ${by}`);
  }
});

// ---- Pressed toggles ----

// [file, onClick needle, buttons that hold it]. A count that no longer matches means the editor
// changed shape and this table needs the new needle, not that the toggle may go unmarked.
const TOGGLES = [
  [SEQUENCE, 'setEditorTab(', 3],
  [SEQUENCE, 'setActiveStepIdx(idx)', 2],
  [SPLIT, 'splitRatio: preset.ratio', 1],
  [SPLIT, "handleDeclareWinner('a')", 1],
  [SPLIT, "handleDeclareWinner('b')", 1]
];

test('selection buttons say whether they are on', () => {
  const problems = [];
  for (const [file, needle, count] of TOGGLES) {
    const hits = buttonsWith(read(file), needle);
    if (hits.length !== count) problems.push(`${file} ${needle}: ${hits.length} buttons, expected ${count}`);
    for (const h of hits) if (!/\saria-pressed=/.test(h.tag.text)) problems.push(`${file} line ${h.line} ${needle}: no aria-pressed`);
  }
  assert.deepEqual(problems, []);
});

test('a pressed button keeps one name whether it is on or off', () => {
  // "Lock Branch A" turns into "Winner: Branch A" when pressed. Read aloud, that is two different
  // buttons. A fixed aria-label keeps one name and lets aria-pressed carry the state.
  const problems = [];
  for (const [file, needle] of TOGGLES) {
    const src = read(file);
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
  const src = read(SPLIT);
  assert.match(buttonsWith(src, "handleDeclareWinner('a')")[0].tag.text, /\saria-label="Lock Branch A"/);
  assert.match(buttonsWith(src, "handleDeclareWinner('b')")[0].tag.text, /\saria-label="Lock Branch B"/);
});

test('a letter in the list is named by its number, and its remove button says which one', () => {
  const src = read(SEQUENCE);
  // The step bar button's only text is "#1".
  const [preview, bar] = buttonsWith(src, 'setActiveStepIdx(idx)');
  assert.ok(!/\saria-label=/.test(preview.tag.text), 'the preview chip keeps its visible words as its name');
  assert.match(bar.tag.text, /\saria-label=\{`Letter \$\{idx \+ 1\}`\}/);
  const [remove] = buttonsWith(src, 'removeStep(idx)');
  assert.ok(remove, 'remove button');
  assert.match(remove.tag.text, /\saria-label=\{`Remove letter \$\{idx \+ 1\}`\}/);
  // The test send box has no visible label, only a placeholder.
  const email = openingTags(src, 'input').find(t => t.text.includes('setTestEmail(e.target.value)'));
  assert.match(email.text, /\saria-label="Test email address"/);
});

test('every button in the two editors is type="button"', () => {
  for (const file of EDITORS) {
    const src = read(file);
    for (const b of openingTags(src, 'button')) {
      assert.match(b.text, /\stype="button"/, `${file} line ${lineOf(src, b.start)}`);
    }
  }
});

// ---- The line panel ----

test('the line panel is a region named by its heading and described in words', () => {
  const src = read(LINE);
  // It renders inside the docked step panel, which is already on the dialog stack.
  assert.ok(!src.includes('useDialogFocus('), 'no second entry on the dialog stack');
  assert.ok(!src.includes('aria-modal="true"'), 'not modal');
  const panel = openingTags(src, 'div').find(t => /\srole="region"/.test(t.text));
  assert.ok(panel, 'a region');
  const labelledBy = attrValue(panel.text, 'aria-labelledby');
  const describedBy = attrValue(panel.text, 'aria-describedby');
  assert.equal(labelledBy, 'jv-edge-inspector-title');
  assert.equal(describedBy, 'jv-edge-inspector-desc');
  const heading = openingTags(src, 'h3').find(t => attrValue(t.text, 'id') === labelledBy);
  assert.ok(heading, 'the heading carries the id');
  assert.match(heading.text, /\stabIndex=\{-1\}/);
  assert.match(heading.text, /\sdata-dialog-start/);
  assert.match(heading.text, /\sref=\{headingRef\}/, 'the dock still focuses the heading');
  const desc = openingTags(src, 'span').find(t => attrValue(t.text, 'id') === describedBy);
  assert.ok(desc, 'the description element');
  // Hidden outright: aria-describedby reads a hidden element's text, and nothing is drawn or
  // positioned over the panel (step-dock.test forbids position: 'absolute' in the inspectors).
  assert.match(desc.text, /\shidden>$/);
  const body = src.slice(desc.end + 1, src.indexOf('</span>', desc.end));
  assert.equal(body.trim(), '{lineInWords}');
  assert.match(src, /const lineSentence = describeEdge\(\{/);
  assert.match(src, /kind: lineKindOf\(edge, targetNode\)/);
  // Counts only from this line's own measured flow; an estimate never reads as "N of M went on".
  assert.match(src, /const flowMeasured = basis === 'Measured' && !isCount && count !== null && denominator !== null;/);
  assert.match(src, /visitors: flowMeasured \? denominator : null,\s*reached: flowMeasured \? count : null/);
});

test('a line with a shown figure is never described as unmeasured', () => {
  // The panel's rule, run on describeEdge's real output: with a basis but no measured flow (an
  // estimate or a visit count), the closing "No visits measured yet." is dropped, not spoken.
  const src = read(LINE);
  const tail = /const NO_VISITS_TAIL = '([^']+)';/.exec(src)?.[1];
  assert.equal(tail, ' No visits measured yet.');
  const bare = describeEdge({ kind: 'main', from: 'Meta ad', to: 'Landing page /spring', visitors: null, reached: null });
  assert.ok(bare.endsWith(tail), 'describeEdge still ends with the tail the panel trims');
  assert.equal(bare.slice(0, -tail.length), 'Next step: from Meta ad to Landing page /spring.');
  assert.match(src, /basis && !flowMeasured && lineSentence\.endsWith\(NO_VISITS_TAIL\)/);
});

test('the line panel never shows or speaks a node id', () => {
  const src = read(LINE);
  assert.ok(!/sourceNode\?\.id \|\|/.test(src), 'no source id fallback');
  assert.ok(!/targetNode\?\.id \|\|/.test(src), 'no target id fallback');
  assert.match(src, /stepShortName\(sourceNode\)/);
  assert.match(src, /stepShortName\(targetNode\)/);
  const close = openingTags(src, 'button').find(t => t.text.includes('onClick={onClose}'));
  assert.ok(close, 'close button');
  assert.match(close.text, /\saria-label="Close( [^"]+)?"/);
});

test('every shipped line reads in words, with the panel\'s inputs', () => {
  // The same call the panel makes, over every line of every shipped journey: no id, no dash.
  for (const project of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) {
    const byId = new Map(project.nodes.map(n => [n.id, n]));
    for (const edge of project.edges) {
      const source = byId.get(edge.source) ?? null;
      const target = byId.get(edge.target) ?? null;
      const text = describeEdge({
        kind: lineKindOf(edge, target),
        from: source ? stepShortName(source) : 'a step that is gone',
        to: target ? stepShortName(target) : 'a step that is gone',
        visitors: null,
        reached: null
      });
      assert.ok(!text.includes(edge.id) && !text.includes(edge.source) && !text.includes(edge.target), text);
      assert.ok(!text.includes('—') && !/\s–\s/.test(text), text);
      assert.ok(text.endsWith('No visits measured yet.'), text);
    }
  }
});

test('no added accessible name has an em dash or a spaced en dash', () => {
  for (const file of ALL) {
    for (const m of read(file).matchAll(/aria-(?:label|valuetext)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const text = m[1] ?? m[2];
      assert.ok(!text.includes('—') && !/\s–\s/.test(text), `${file}: ${text}`);
    }
  }
});
