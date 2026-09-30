import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// #19's canvas pass (lane w5-final): the map, its cards and lines, the step panel, the header,
// index.css and the line type. a11y.test.mjs holds the same contract as todo checks until this
// lane lands; these are the hard versions, plus what this lane added on top of the spec:
//   - a line's words come from the figure its pill shows (#9), never from counts saved on the line,
//     so the map, the pill and the line panel cannot disagree;
//   - stripA11yDecorations removes data.description from a line only, so a step's own data keeps it;
//   - the step panel inside the dock is a region, not a second dialog on the stack.
// Like edge-kinds.test.mjs, the component checks read the source, because they need a browser to
// render. scripts/a11y-browser-check.mjs is the same contract in a real browser.

const { describeEdge, stepShortName, stripA11yDecorations } = await import('./src/lib/stepNames.ts');
const { MIN_TEXT_PX } = await import('./src/lib/a11y.ts');
const { buildCanvasMetrics } = await import('./src/lib/journeyMetrics.ts');
const { lineKindOf } = await import('./src/lib/stepNavigation.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');
const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');

const read = path => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '');
const C = 'src/components';
const canvas = read(`${C}/canvas/JourneyCanvas.tsx`);
const edge = read(`${C}/canvas/edges/ConversionEdge.tsx`);
const inspector = read(`${C}/drawers/NodeInspector.tsx`);
const header = read(`${C}/toolbar/CanvasHeader.tsx`);
const css = read('src/index.css');
const EM_DASH = '—';
const SPACED_EN_DASH = /\s–\s/;

// ---- Source scanners (the same rules as a11y.test.mjs) ----

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

/** Every JSX opening tag of one element name, with its full text (attributes may span lines). */
function openingTags(src, name) {
  const re = new RegExp(`<${name}(?=[\\s>/])`, 'g');
  const tags = [];
  for (let m; (m = re.exec(src)); ) {
    let end = src.length;
    for (let i = m.index + 1; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { i = skipBraces(src, i) - 1; continue; }
      if (c === '"' || c === "'") { i = src.indexOf(c, i + 1); continue; }
      if (c === '>') { end = i; break; }
    }
    tags.push({ start: m.index, end, text: src.slice(m.index, end + 1) });
  }
  return tags;
}

/** The body of `const name = useCallback(...)` or `const name = (...) => {...}`. */
function bodyOf(src, name) {
  const at = src.indexOf(`const ${name} =`);
  if (at === -1) return '';
  const open = src.indexOf('{', src.indexOf('=>', at));
  return src.slice(open, skipBraces(src, open));
}

/** Every onNodesChange( / onEdgesChange( call's arguments in a body. */
function changeCalls(body) {
  const calls = [];
  for (const m of body.matchAll(/on(Nodes|Edges)Change\(/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')' && --depth === 0) break;
    }
    calls.push(body.slice(m.index + m[0].length, i).trim());
  }
  return calls;
}

/** The declarations inside the first block whose selector matches. */
function cssBlock(src, selectorRe) {
  const m = selectorRe.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  return src.slice(open + 1, skipBraces(src, open) - 1);
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every font size under MIN_TEXT_PX: fontSize strings and numbers, text-[Npx], font-size. */
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

// ---- Lines in words ----

test('a line on the map is described from the figure its pill shows, never from saved counts', () => {
  const line = { kind: 'accepted', from: 'Upsell /glow/upsell', to: 'Thank-you page /thanks' };
  const head = 'Accepted: from Upsell /glow/upsell to Thank-you page /thanks.';
  const measured = { def: { id: 'accept-rate' }, basis: 'Measured', count: 41, denominator: 340 };
  assert.equal(describeEdge({ ...line, figure: measured }), `${head} 41 of 340 visitors went on.`);
  // No figure, or one with nothing measured: said so, whatever counts the saved line carries.
  assert.equal(describeEdge({ ...line, visitors: 900, reached: 12, figure: null }), `${head} No visits measured yet.`);
  assert.equal(describeEdge({ ...line, figure: { ...measured, basis: null, count: null, denominator: null } }), `${head} No visits measured yet.`);
  // An estimate or a visit count is on the pill, so "no visits" would be untrue and "N of M went
  // on" would claim the same people moved: the line is named with no closing sentence.
  assert.equal(describeEdge({ ...line, figure: { ...measured, basis: 'Estimated' } }), head);
  assert.equal(describeEdge({ ...line, figure: { ...measured, def: { id: 'ad-visits' } } }), head);
  assert.equal(describeEdge({ ...line, figure: { ...measured, def: { id: 'retention' } } }), head);
  // Without a figure key the old inputs still work (the line panel and the tests use them).
  assert.equal(describeEdge({ ...line, visitors: 340, reached: 41 }), `${head} 41 of 340 visitors went on.`);
});

test('signed out, every shipped line reads in words with no ids and no invented numbers', () => {
  let lines = 0;
  for (const journey of [DEFAULT_LEAD_CAPTURE_PROJECT, ...ECOM_BLUEPRINTS]) {
    const metrics = buildCanvasMetrics(journey.nodes, journey.edges, null);
    const byId = new Map(journey.nodes.map(n => [n.id, n]));
    for (const e of journey.edges) {
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      const text = describeEdge({
        kind: lineKindOf(e, target),
        from: source ? stepShortName(source.data) : 'a step that is gone',
        to: target ? stepShortName(target.data) : 'a step that is gone',
        figure: metrics.edges[e.id] ?? null
      });
      // A step named by a question closes the sentence itself, so it never reads "?." (T09, describeEdge).
      assert.match(text, /^(Next step|Accepted|Declined or left|Retention flow|Split A|Split B): from .+ to .+(?:\.|[?!]["”]?) No visits measured yet\.$/, text);
      assert.ok(!/[?!]["”]?\./.test(text), `${text} reads "?."`);
      for (const id of [e.id, e.source, e.target]) assert.ok(!text.includes(id), `${text} names ${id}`);
      assert.ok(!text.includes(EM_DASH) && !SPACED_EN_DASH.test(text), text);
      lines++;
    }
  }
  assert.ok(lines >= 15, `only ${lines} lines checked`);
});

test('stripA11yDecorations takes the words off a line and leaves a step its own data', () => {
  const line = { id: 'e1', source: 'a', target: 'b', ariaLabel: 'x', focusable: false, domAttributes: { 'aria-hidden': true }, data: { rate: 0, description: 'x' } };
  assert.deepEqual(stripA11yDecorations(line), { id: 'e1', source: 'a', target: 'b', data: { rate: 0 } });
  // The canvas never sets data.description on a step, so a step's own field of that name stays.
  const step = { id: 'n1', position: { x: 0, y: 0 }, ariaLabel: 'Step', domAttributes: { 'aria-roledescription': 'step' }, data: { type: 'upsell', description: 'Kept' } };
  assert.deepEqual(stripA11yDecorations(step), { id: 'n1', position: { x: 0, y: 0 }, data: { type: 'upsell', description: 'Kept' } });
});

// ---- The map ----

test('the map names its steps, hides its lines and speaks Jourvance', () => {
  // Steps: a spoken name and a role description on React Flow's own focusable wrapper.
  assert.match(canvas, /ariaLabel: stepSpokenName\(n, publishStates\.get\(n\.id\)\),/);
  assert.match(canvas, /domAttributes: \{ 'aria-roledescription': 'step' \}/);
  // Lines: named in words, never focusable, hidden from assistive tech, words on the data.
  const sync = canvas.slice(canvas.indexOf('setRfEdges(\n'), canvas.indexOf('const handleNodesChange'));
  assert.ok(sync.length > 100, 'the edge sync effect');
  assert.match(sync, /const description = describeEdge\(\{/);
  assert.match(sync, /figure: canvasMetrics\.edges\[e\.id\] \?\? null/);
  assert.doesNotMatch(sync.slice(sync.indexOf('describeEdge('), sync.indexOf('return {')), /sourceThroughput|targetCount/,
    'the words never read counts saved on the line');
  assert.match(sync, /ariaLabel: description,/);
  assert.match(sync, /focusable: false,/);
  assert.match(sync, /domAttributes: \{ 'aria-hidden': true \}/);
  assert.match(sync, /\n\s*description\n\s*\}/, 'description rides inside data');
  assert.match(canvas, /\}, \[edges, nodeMap, loopEdgeIds, canvasMetrics,/, 'the words redraw when the figures change');
  // Every React Flow string in plain words, not only the step description.
  assert.match(canvas, /ariaLabelConfig=\{JOURNEY_ARIA_LABELS\}/);
  assert.doesNotMatch(canvas, /ariaLabelConfig=\{STEP_ARIA_LABELS\}/);
  // The map is a named region dialogs fall back to when their opener is gone.
  const root = openingTags(canvas, 'div').find(t => t.text.includes('id="journey-map"'));
  assert.ok(root, 'the #journey-map root');
  for (const attr of ['ref={canvasRef}', 'tabIndex={-1}', 'role="region"', 'aria-label="Journey map"', 'onKeyDown={handleCanvasKeyDown}']) {
    assert.ok(root.text.includes(attr), `#journey-map ${attr}`);
  }
  assert.match(canvas, /canvasKeyAction\(/);
});

test('everything the map hands back to App is clean', () => {
  for (const handler of ['handleNodeDragStop', 'handleNodesChange', 'handleEdgesChange', 'handleConnect']) {
    const body = bodyOf(canvas, handler);
    assert.ok(body, `${handler} not found`);
    for (const args of changeCalls(body)) {
      assert.ok(args.includes('stripA11yDecorations'), `${handler} passes ${args} back to App with its decorations`);
    }
  }
  // The two removal paths and the drag each do hand something back.
  for (const handler of ['handleNodeDragStop', 'handleNodesChange', 'handleEdgesChange']) {
    assert.ok(changeCalls(bodyOf(canvas, handler)).length > 0, `${handler} calls App`);
  }
});

test('the retention toggle keeps one name and says whether it is on', () => {
  const toggle = openingTags(canvas, 'button').find(t => t.text.includes('onClick={toggleRetention}'));
  assert.ok(toggle, 'the retention toggle');
  assert.match(toggle.text, /aria-pressed=\{effectiveShowRetention\}/);
  assert.match(toggle.text, /aria-label="Retention flows"/);
});

test('a rate pill is the line\'s one keyboard stop and reads the line in words', () => {
  const pill = openingTags(edge, 'button').find(t => t.text.includes('onClick={handleClick}'));
  assert.ok(pill, 'the rate pill');
  // #9's sentence stays the name; #19's words are the description.
  assert.match(pill.text, /aria-label=\{sentence\}/);
  assert.match(pill.text, /aria-describedby=\{d\?\.description \? `jv-edge-desc-\$\{id\}` : undefined\}/);
  const span = openingTags(edge, 'span').find(t => t.text.includes('jv-edge-desc-'));
  assert.ok(span, 'the description span');
  assert.match(span.text, /id=\{`jv-edge-desc-\$\{id\}`\}/);
  assert.match(span.text, /className="jv-sr-only"/);
  assert.match(edge, /\{d\.description\}/);
  assert.doesNotMatch(edge, /infinite/);
});

test('no text under 11px on the map, its cards and lines, the step panel and the header', () => {
  const files = [
    ...fs.readdirSync(`${C}/canvas/nodes`).filter(f => f.endsWith('.tsx')).map(f => `${C}/canvas/nodes/${f}`),
    `${C}/canvas/edges/ConversionEdge.tsx`,
    `${C}/canvas/EdgeLegend.tsx`,
    `${C}/canvas/JourneyCanvas.tsx`,
    `${C}/drawers/NodeInspector.tsx`,
    `${C}/toolbar/CanvasHeader.tsx`,
    `${C}/toolbar/WorkspaceSelector.tsx`
  ];
  const offenders = [];
  for (const file of files) {
    const src = read(file);
    if (!src) { offenders.push(`${file}: missing`); continue; }
    for (const hit of smallText(src)) offenders.push(`${file} ${hit}`);
  }
  assert.deepEqual(offenders, []);
});

test('the product picture on an upsell card is decoration', () => {
  const imgs = openingTags(read(`${C}/canvas/nodes/UpsellNode.tsx`), 'img');
  assert.ok(imgs.length > 0);
  for (const img of imgs) assert.match(img.text, /\salt=""/, 'the product title sits beside it');
});

// ---- The step panel ----

test('the step panel is a region named by its heading and described by the step', () => {
  const root = openingTags(inspector, 'div').find(t => t.text.includes('role="region"'));
  assert.ok(root, 'a region');
  assert.match(root.text, /aria-labelledby="jv-step-panel-title"/);
  assert.match(root.text, /aria-describedby="jv-inspector-step"/);
  const heading = openingTags(inspector, 'h2').find(t => t.text.includes('id="jv-step-panel-title"'));
  assert.ok(heading, 'the heading');
  assert.match(heading.text, /tabIndex=\{-1\}/);
  assert.match(heading.text, /data-dialog-start/);
  assert.match(inspector, /<span id="jv-inspector-step" hidden>\s*\{stepSpokenName\(node, publishStatus\.states\.get\(node\.id\)\)\}/);
  // StepDock already puts the panel on the dialog stack; a second entry would eat Escape.
  assert.ok(!inspector.includes('useDialogFocus('));
  assert.ok(!inspector.includes('aria-modal'));
  const tags = openingTags(inspector, 'button');
  assert.match(tags.find(t => t.text.includes('onClick={onClose}'))?.text ?? '', /\saria-label="Close step panel"/);
  assert.match(tags.find(t => t.text.includes('onDeleteNode'))?.text ?? '', /\saria-label="Delete this step"/);
});

// ---- The header ----

test('a header menu hands focus to its button before an item acts', () => {
  assert.match(header, /import React, \{[^}]*useRef[^}]*\} from 'react';/);
  const buttons = openingTags(header, 'button');
  const more = buttons.find(t => t.text.includes('data-more-trigger'));
  assert.ok(more && more.text.includes('ref={moreButtonRef}'), 'the More button holds moreButtonRef');
  const item = buttons.find(t => t.text.includes('item.onClick()'));
  assert.ok(item, 'a More menu item');
  assert.match(item.text, /moreButtonRef\.current\?\.focus\(\);[^}]*item\.onClick\(\)/);
  const add = buttons.find(t => t.text.includes('setShowAddMenu(!showAddMenu)'));
  assert.ok(add && add.text.includes('ref={addButtonRef}'), 'the Add Step button holds addButtonRef');
  const adders = buttons.filter(t => t.text.includes('onAddNode('));
  assert.equal(adders.length, 7, 'one Add Step item per step type');
  for (const a of adders) {
    assert.match(a.text, /addButtonRef\.current\?\.focus\(\); onAddNode\(/, a.text.slice(0, 120));
    assert.match(a.text, /role="menuitem"/);
    assert.match(a.text, /type="button"/);
  }
});

// ---- The stylesheet and the type ----

test('keyboard focus is always visible, in one colour', () => {
  assert.match(css, /--color-focus:\s*#818CF8;/i);
  const ring = cssBlock(css, /(^|\n)\s*:focus-visible\s*\{/);
  assert.ok(ring, 'a global :focus-visible rule');
  assert.match(ring, /outline:\s*2px solid var\(--color-focus\)\s*!important/);
  assert.match(ring, /outline-offset:[^;]*!important/);
  const step = cssBlock(css, /(^|\n)\.react-flow__node:focus-visible\s*\{/);
  assert.ok(step, 'a step ring');
  assert.match(step, /outline:\s*2px solid var\(--color-focus\)\s*!important/);
  assert.match(step, /outline-offset:\s*4px\s*!important/);
  // An !important ring in a more specific rule would beat the global one, so any that exists must
  // use the same colour.
  for (const m of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
    const outline = /outline:([^;]*)!important/.exec(m[2]);
    if (outline) assert.match(outline[1], /var\(--color-focus\)/, m[1].trim());
  }
  const sr = cssBlock(css, /\.jv-sr-only\s*\{/);
  assert.ok(sr, '.jv-sr-only');
  assert.match(sr, /position:\s*absolute/);
  assert.match(sr, /width:\s*1px/);
  assert.match(sr, /clip:\s*rect\(0 0 0 0\)/);
  const attribution = cssBlock(css, /\.react-flow__attribution\s*\{/);
  const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(attribution ?? '');
  assert.ok(size && Number(size[1]) >= MIN_TEXT_PX, 'attribution at 11px or more');
});

test('reduced motion is one switch that stops the line dash too', () => {
  const block = cssBlock(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
  assert.ok(block, 'a prefers-reduced-motion: reduce block');
  assert.ok(cssBlock(block, /\.spin\s*\{/), 'the spinner rule stays');
  const universal = cssBlock(block, /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/);
  assert.ok(universal, 'a universal selector');
  assert.match(universal, /animation:\s*none\s*!important/);
  assert.match(universal, /transition:\s*none\s*!important/);
  assert.match(universal, /scroll-behavior:\s*auto\s*!important/);
  const dash = cssBlock(block, /\.react-flow__edge\.animated path\s*,\s*\.react-flow__connection \.animated\s*\{/);
  assert.ok(dash, 'the animated line and the line being drawn');
  assert.match(dash, /animation:\s*none\s*!important/);
});

test('a line carries its words as an optional field of its data', () => {
  const types = read('src/types/journey.ts');
  const iface = types.slice(types.indexOf('export interface ConversionEdgeData'), types.indexOf('export type JourneyEdge'));
  assert.match(iface, /\n\s*description\?: string;/);
});

test('no accessible name this lane added has an em dash or a spaced en dash', () => {
  for (const [file, src] of [['JourneyCanvas', canvas], ['ConversionEdge', edge], ['NodeInspector', inspector], ['CanvasHeader', header]]) {
    for (const m of src.matchAll(/aria-(?:label|roledescription)(?:=|': )["']([^"'\n]*)["']/g)) {
      assert.ok(!m[1].includes(EM_DASH) && !SPACED_EN_DASH.test(m[1]), `${file}: ${m[1]}`);
    }
  }
});
