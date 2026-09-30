import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The step and line panels were 420px overlays that covered the map's right side, a step opened
// only from a mouse click, and Backspace on a panel button deleted the selected step. The docked
// panel (StepDock, with StepFinder and StepConnections) sits beside the map instead. These checks
// read the sources, like edge-kinds.test.mjs, because the components need a browser to render.
//
// The dock's own files are pinned first, then its wiring into App, JourneyCanvas, the two
// inspectors and index.css (#7's integration step, lane w3-spine-2).

const read = path => (fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '');
const dock = read('src/components/drawers/StepDock.tsx');
const finder = read('src/components/drawers/StepFinder.tsx');
const connections = read('src/components/drawers/StepConnections.tsx');

test('the dock and its parts exist', () => {
  assert.ok(dock, 'StepDock.tsx');
  assert.ok(finder, 'StepFinder.tsx');
  assert.ok(connections, 'StepConnections.tsx');
  assert.match(dock, /export const StepDock\b/);
  assert.match(finder, /export const StepFinder\b/);
  assert.match(connections, /export const StepConnections\b/);
});

test('the dock is a labelled aside that React Flow ignores keys from', () => {
  assert.match(dock, /<aside className="jv-step-dock nokey" aria-label="Step panel"[\s>]/);
});

test('the dock remounts the step editor per step and moves focus to the heading from a counter', () => {
  assert.match(dock, /<NodeInspector\s+key=\{node\.id\}/);
  assert.match(dock, /<EdgeInspector\s+key=\{edge\.id\}/);
  assert.match(dock, /headingRef=\{headingRef\}/);
  assert.match(dock, /navigation=\{\s*<StepConnections/);
  // A focus request from App or a jump from a connection row focuses the new heading.
  assert.match(dock, /focusRequest: number/);
  assert.match(dock, /setJumpTick\(t => t \+ 1\)/);
  assert.match(dock, /headingRef\.current\?\.focus\(\)/);
  assert.match(dock, /\[focusRequest, jumpTick, node\?\.id, edge\?\.id\]/);
  // Close returns focus to the step on the map, and a delete to the search field.
  assert.match(dock, /\.react-flow__node\[data-id=/);
  assert.match(dock, /CSS\.escape/);
  assert.match(dock, /if \(!focusMapStep\(id\)\) searchRef\.current\?\.focus\(\)/);
  assert.match(dock, /requestDelete\('node', id\)/);
  assert.match(dock, /requestDelete\('edge', id\)/);
  assert.match(dock, /No step selected\./);
});

test('deleting the last step keeps focus in the panel and shows only the no-steps text', () => {
  // The delete is settled after the render that removes the step. The search field is not
  // rendered once the journey is empty, so focus falls back to the finder's empty message,
  // which can take focus. Focusing the field in the click handler dropped focus to <body>.
  assert.match(dock, /useLayoutEffect\(\(\) => \{\s*const pending = pendingDelete\.current;/);
  assert.match(dock, /hasSearch: Boolean\(searchRef\.current\?\.isConnected\)/);
  assert.match(dock, /\(to === 'search' \? searchRef\.current : emptyRef\.current\)\?\.focus\(\)/);
  assert.match(dock, /emptyRef=\{emptyRef\}/);
  assert.match(finder, /<p ref=\{emptyRef\} tabIndex=\{-1\}[^>]*>\s*This journey has no steps yet\./);
  // With zero steps the no-selection hint would point at an empty list and an empty map.
  assert.match(dock, /: nodes\.length === 0 \? null : \(/);
});

test('the finder has visible labels, a grouped Step list and ends that keep focus', () => {
  assert.match(finder, /<section\s+aria-label="Find a step"/);
  assert.match(finder, /htmlFor="jv-step-search"[^>]*>Search steps</);
  assert.match(finder, /type="search"/);
  assert.match(finder, /htmlFor="jv-step-filter"[^>]*>Show</);
  assert.match(finder, /const showFilter = list\.filters\.length > 1;/);
  assert.match(finder, /\{showFilter && \(/);
  assert.match(finder, /htmlFor="jv-step-select"[^>]*>Step</);
  assert.match(finder, /<optgroup key=\{group\} label=\{group\}>/);
  assert.match(finder, /Choose a step/);
  // aria-disabled, never disabled, so focus stays on a Previous or Next that has reached an end.
  assert.match(finder, /aria-disabled=\{target \? undefined : 'true'\}/);
  assert.doesNotMatch(finder, /\sdisabled=\{/);
  assert.match(finder, /role="status"/);
  assert.match(finder, /Clear filters/);
  assert.match(finder, /This journey has no steps yet\. Add one with Add Step in the toolbar\./);
  for (const s of ['No step selected', 'Not in this list', 'No step matches.']) assert.ok(finder.includes(s), s);
});

test('the connections list names each line the way the map draws it, with no numbers', () => {
  assert.match(connections, /<section\s+aria-label="Connections"/);
  assert.match(connections, /'Comes from'/);
  assert.match(connections, /'Leads to'/);
  assert.match(connections, /Nothing leads here yet\./);
  assert.match(connections, /This step does not lead anywhere yet\./);
  assert.match(connections, /stepConnections\(/);
  assert.match(connections, /EDGE_KINDS\[link\.kind\]/);
  assert.match(connections, /strokeDasharray=\{k\.dash\}/);
  assert.match(connections, /aria-hidden="true"/);
  assert.doesNotMatch(connections, /sourceThroughput|targetCount|\brate\b/);
});

test('no new panel file has an em dash, a spaced en dash or a removed focus outline', () => {
  for (const [name, src] of [['StepDock', dock], ['StepFinder', finder], ['StepConnections', connections]]) {
    assert.ok(!src.includes('—'), `${name} has an em dash`);
    assert.ok(!/\s–\s/.test(src), `${name} has a spaced en dash`);
    assert.ok(!/outline:\s*['"]none['"]/.test(src), `${name} removes the focus outline`);
  }
});

// ---- #7 integration (w3-spine-2) ----

const app = read('src/App.tsx');
const canvas = read('src/components/canvas/JourneyCanvas.tsx');
const nodeInspector = read('src/components/drawers/NodeInspector.tsx');
const edgeInspector = read('src/components/drawers/EdgeInspector.tsx');
const css = read('src/index.css');
// Short failure messages: a regex failure on a 1,000-line file otherwise prints the whole file.
const has = (src, re, label = String(re)) => assert.ok(re.test(src), `missing ${label}`);
const hasNot = (src, re, label = String(re)) => assert.ok(!re.test(src), `still has ${label}`);

test('the inspectors are panels inside the dock, not overlays', () => {
  for (const [name, src] of [['NodeInspector', nodeInspector], ['EdgeInspector', edgeInspector]]) {
    hasNot(src, /position: 'absolute'/, `${name} position: 'absolute'`);
    hasNot(src, /width: '420px'/, `${name} width: '420px'`);
  }
  has(nodeInspector, /<h2[^>]*id="jv-step-panel-title"/);
  has(nodeInspector, /<h2[^>]*tabIndex=\{-1\}/);
  has(nodeInspector, /headingRef\?: React\.Ref<HTMLHeadingElement>/);
  has(nodeInspector, /navigation\?: React\.ReactNode/);
  has(edgeInspector, /headingRef/);
  // The heading reads the step's own name, with the old type title as a small line above it.
  has(nodeInspector, /id="jv-step-panel-title"[\s\S]{0,200}\{stepName\(node\)\}/, 'the heading shows stepName(node)');
  // Under it, the card wording the map and Check design use, so both names are on screen (C53).
  has(nodeInspector, /import \{ stepShortName \} from '\.\.\/\.\.\/lib\/stepNames';/, 'NodeInspector imports stepShortName');
  has(nodeInspector, /\{stepName\(node\)\}\s*<\/h2>\s*\{showCardName && \(\s*<p style=\{\{[^}]*fontSize: '11px'[^}]*\}\}>\s*\{cardName\}/, 'the card wording under the heading');
  has(nodeInspector, /const cardName = stepShortName\(node\);/, 'cardName is stepShortName(node)');
  has(nodeInspector, /aria-label="Delete this step"/);
  has(nodeInspector, /aria-label="Close step panel"/);
  has(nodeInspector, /\{navigation\}/);
  has(edgeInspector, /<h3 ref=\{headingRef\} tabIndex=\{-1\}/);
  has(edgeInspector, /aria-label="Close line panel"/);
  // The stats snapshot (#9) still reaches both panels through the dock.
  assert.equal((dock.match(/metrics=\{metrics\}/g) || []).length, 2, 'StepDock passes metrics to both panels');
});

test('App renders the dock beside the map and routes every step choice through selectStep', () => {
  has(app, /import\('\.\/components\/drawers\/StepDock'\)/);
  has(app, /className="jv-canvas-layout"/);
  hasNot(app, /<NodeInspector\b/);
  hasNot(app, /<EdgeInspector\b/);
  has(app, /<StepDock[\s\S]*?onSelectStep=\{selectStep\}/);
  has(app, /<PreFlightAuditDrawer[\s\S]*?onSelectNode=\{openStep\}/);
  has(app, /<JourneyCanvas[\s\S]*?onOpenStep=\{openStep\}/);
  has(app, /<JourneyCanvas[\s\S]*?focusRequest=\{inspectorFocus\}/);
});

test('the map opens a step from the keyboard, pans it into view and speaks its name', () => {
  has(canvas, /canvasKeyAction\(/);
  has(canvas, /onKeyDown=\{handleCanvasKeyDown\}/);
  has(canvas, /requestAnimationFrame\(/);
  has(canvas, /function FocusSelectedStep\b/);
  has(canvas, /<ReactFlow[\s\S]*<FocusSelectedStep[\s\S]*<\/ReactFlow>/);
  has(canvas, /setCenter\(/);
  has(canvas, /PAN_DURATION_MS/);
  has(canvas, /prefers-reduced-motion/);
  has(canvas, /ariaLabel: stepSpokenName\(/);
  // The spoken name is for the map only: it is stripped before the steps go back to App.
  has(canvas, /\.map\(stripA11yDecorations\)/);
  has(canvas, /onNodesChange\(persistedNodes\(dragged\)\.map\(stripA11yDecorations\)/);
  has(canvas, /onOpenStep\?: \(nodeId: string\) => void/);
  has(canvas, /focusRequest\?: number/);
  // A node rebuilt without its measured size is hidden until re-measured, and a hidden step loses
  // focus: Escape then dropped focus to <body> about half the time. The sync keeps the last size.
  has(canvas, /measured: n\.measured \?\? measuredMap\.get\(n\.id\)/);
  // #19 widens the config to JOURNEY_ARIA_LABELS, which carries the same step description.
  has(canvas, /ariaLabelConfig=\{(STEP|JOURNEY)_ARIA_LABELS\}/);
});

test('the layout stacks under the map on a phone and a focused step shows an outline', () => {
  has(css, /\.jv-step-dock\s*\{/);
  has(css, /@media \(max-width: 767px\)\s*\{[\s\S]*?\.jv-canvas-layout\s*\{[^}]*flex-direction:\s*column/);
  const focusRule = css.match(/\.react-flow__node[^{]*:focus-visible\s*\{([^}]*)\}/);
  assert.ok(focusRule, 'a :focus-visible rule for map steps');
  assert.match(focusRule[1], /outline:\s*(?!none)\S/);
});

// ---- R02: the panel stacked under the map at phone width ----
// A tap on a step or line opened its panel below the fold with no scroll, and a tapped Disconnect
// focused the search field and scrolled the map away. The rules live in dockReveal.ts (run here
// without a browser); the pins below check StepDock applies them.

const { mapTapId, tapOpensPanel, tapReopensPanel, TAP_REVEAL_WINDOW_MS, boxInView, dockStacked, deleteFocusTarget } =
  await import('./src/lib/dockReveal.ts');

// A stand-in for an Element: closest() answers from a table of selector -> attributes.
const fakeTarget = table => ({
  closest: sel => {
    const hit = Object.entries(table).find(([key]) => sel.split(',').map(x => x.trim()).includes(key));
    return hit ? { getAttribute: name => hit[1][name] ?? null } : null;
  }
});

test('R02: a tap on a step card or a line reads its id, and a keyboard press or a card control does not', () => {
  const card = fakeTarget({ '.react-flow__node': { 'data-id': 'node-page-1' } });
  const edge = fakeTarget({ '.react-flow__edge': { 'data-id': 'e1' } });
  const pill = fakeTarget({ '[data-jv-edge-label]': { 'data-jv-edge-label': 'e2' } });
  const plusNext = fakeTarget({ '.react-flow__node button': {}, '.react-flow__node': { 'data-id': 'node-page-1' } });
  assert.equal(mapTapId(card, 1), 'node-page-1');
  assert.equal(mapTapId(edge, 1), 'e1');
  assert.equal(mapTapId(pill, 1), 'e2');
  // detail 0 is Enter or Space: that path moves focus into the panel instead.
  assert.equal(mapTapId(card, 0), null);
  assert.equal(mapTapId(pill, 0), null);
  // + Next, a badge or a link inside the card is its own action.
  assert.equal(mapTapId(plusNext, 1), null);
  assert.equal(mapTapId(fakeTarget({}), 1), null);
  assert.equal(mapTapId(null, 1), null);
});

test('R02: only the step or line tapped a moment ago scrolls its panel into view', () => {
  const tap = { id: 'node-page-1', at: 1000 };
  assert.equal(tapOpensPanel(tap, 'node-page-1', 1200), true);
  assert.equal(tapOpensPanel(tap, 'node-page-1', 1000 + TAP_REVEAL_WINDOW_MS + 1), false);
  // + Next selects the NEW step, a different id from the card that was tapped.
  assert.equal(tapOpensPanel(tap, 'node-new', 1200), false);
  // A choice from the finder or the keyboard leaves no tap behind.
  assert.equal(tapOpensPanel(null, 'node-page-1', 1200), false);
  assert.equal(tapOpensPanel(tap, null, 1200), false);
  // The panel heading at y=1041 in an 844px window (the evidence) is out of view; beside the map it is in.
  assert.equal(boxInView({ top: 1041, bottom: 1063 }, 844), false);
  assert.equal(boxInView({ top: 333, bottom: 355 }, 900), true);
});

test('R02: a tap on the step or line already open reveals its panel again, and nothing else does', () => {
  // The skeptic's repro: tap node-page-1, scroll back up to the map, tap node-page-1 again. The
  // selection does not change, so tapOpensPanel is never asked; this rule is.
  assert.equal(tapReopensPanel('node-page-1', 'node-page-1'), true);
  assert.equal(tapReopensPanel('e2', 'e2'), true);
  // A different step is a new selection, which tapOpensPanel handles.
  assert.equal(tapReopensPanel('node-page-2', 'node-page-1'), false);
  // A keyboard press or a card control reads as no tap; with nothing open there is nothing to show.
  assert.equal(tapReopensPanel(null, 'node-page-1'), false);
  assert.equal(tapReopensPanel('node-page-1', null), false);
  assert.equal(tapReopensPanel(null, null), false);
});

test('R02: a pointer delete in the stacked layout returns to the map, and every other delete keeps its rule', () => {
  // Stacked: the dock starts where the map ends (390px: map 288 to 811, dock from 811).
  assert.equal(dockStacked({ top: 811, bottom: 1600 }, { top: 288, bottom: 811 }), true);
  // Beside the map (1440px): the dock starts level with the map.
  assert.equal(dockStacked({ top: 104, bottom: 900 }, { top: 104, bottom: 900 }), false);
  assert.equal(dockStacked(null, { top: 0, bottom: 1 }), false);
  const base = { byPointer: true, stacked: true, hasSearch: true, hasMap: true };
  assert.equal(deleteFocusTarget(base), 'map');
  // The keyboard keeps the search field, as does a wide screen.
  assert.equal(deleteFocusTarget({ ...base, byPointer: false }), 'search');
  assert.equal(deleteFocusTarget({ ...base, stacked: false }), 'search');
  assert.equal(deleteFocusTarget({ ...base, hasMap: false }), 'search');
  // The last step is gone: the finder's no-steps message says what to do next.
  assert.equal(deleteFocusTarget({ ...base, hasSearch: false }), 'empty');
  assert.equal(deleteFocusTarget({ ...base, byPointer: false, hasSearch: false }), 'empty');
});

test('R02: StepDock records map taps and the input used, then applies the rules', () => {
  const reveal = read('src/lib/dockReveal.ts');
  assert.ok(!reveal.includes('\u2014') && !/\s\u2013\s/.test(reveal), 'dockReveal.ts has an em dash or spaced en dash');
  // The map tap is recorded in the capture phase, before the selection it causes renders.
  has(dock, /document\.addEventListener\('click', onClick, true\)/, 'a capture-phase click listener');
  has(dock, /document\.removeEventListener\('click', onClick, true\)/, 'the listener is removed');
  has(dock, /mapTapId\(e\.target instanceof Element \? e\.target : null, e\.detail\)/, 'mapTapId reads the click');
  // The heading scrolls into view after a tap, where a keyboard open puts it.
  has(dock, /tapOpensPanel\(mapTap\.current, openedId, performance\.now\(\)\)/, 'tapOpensPanel');
  has(dock, /boxInView\(heading\.getBoundingClientRect\(\), window\.innerHeight\)\) return;/, 'only when out of view');
  has(dock, /heading\.scrollIntoView\(\{ block: 'center', behavior: scrollBehavior\(\) \}\)/, 'scrolls the heading in');
  has(dock, /\}, \[openedId\]\);/, 'runs when the opened step or line changes');
  // A tap on the step or line already open changes no selection, so the click reveals it itself,
  // after the click settles and only while that panel is still the open one.
  has(dock, /openRef\.current = openedId;/, 'the open id is kept for the click listener');
  has(dock, /if \(tapReopensPanel\(id, openRef\.current\)\) \{/, 'tapReopensPanel');
  has(dock, /requestAnimationFrame\(\(\) => \{ if \(openRef\.current === id\) revealHeading\(\); \}\)/, 'reveals after the click settles');
  has(dock, /prefers-reduced-motion: reduce/, 'reduced motion is instant');
  // How the delete was pressed decides where focus goes once it has settled.
  has(dock, /onPointerDownCapture=\{\(\) => \{ lastInput\.current = 'pointer'; \}\}/, 'pointer input recorded');
  has(dock, /onKeyDownCapture=\{\(\) => \{ lastInput\.current = 'keyboard'; \}\}/, 'keyboard input recorded');
  has(dock, /byPointer: lastInput\.current === 'pointer'/, 'the delete carries its input');
  has(dock, /map\.focus\(\{ preventScroll: true \}\);\s*map\.scrollIntoView\(\{ block: 'start'/, 'the map is focused and scrolled into view');
});

// ---- R11: the finder is one row, so a page's words fit at 1280x720 ----
//
// Stacked as four rows (search, Step, Previous/Next, then an empty status row whose grid gap a
// negative margin could not cancel) the finder took 201px, and at 1280x720 the page editor's
// Button text and Page address sat below the fold. Measured in Chrome after the change: 66px, and
// Page address ends at 674 of 720 on the default journey (712 on the retention blueprint, whose
// Show filter adds a row). The browser check is scratch/followup/w1-dock-and-dialogs/r2/pin.mjs,
// which also fails when the search hint is clipped at any dock width.

test('R11: search, Previous, the Step list and Next share one row', () => {
  const grid = finder.indexOf('gridTemplateColumns');
  const search = finder.indexOf('id="jv-step-search"');
  const prev = finder.indexOf('{navButton(-1, prevId)}');
  const select = finder.indexOf('id="jv-step-select"');
  const next = finder.indexOf('{navButton(1, nextId)}');
  const filter = finder.indexOf('id="jv-step-filter"');
  assert.ok(grid !== -1 && grid < search && search < prev && prev < select && select < next, 'one row: search, then Previous, Step, Next');
  // The arrows sit right beside the list, not in a row of their own under it.
  has(finder, /\{navButton\(-1, prevId\)\}\s*<select\s+id="jv-step-select"/, 'Previous directly before the Step list');
  has(finder, /<\/select>\s*\{navButton\(1, nextId\)\}/, 'Next directly after the Step list');
  // The Show filter, when there is one, goes below that row with the match count.
  assert.ok(filter > next, 'the Show filter comes after the main row');
  // The position text is on the Step list's label line and still reads 'Step i of n'.
  has(finder, /htmlFor="jv-step-select"[^>]*>Step<\/label>\s*<span[^>]*>\{position\}<\/span>/, 'position beside the Step label');
  has(finder, /`Step \$\{selectedIndex \+ 1\} of \$\{list\.matchIds\.length\}`/, "'Step i of n'");
});

test('R11: an empty status row takes no space, and the arrows always have a name', () => {
  // A grid gap stays even under an empty row, so the section has none and the row adds its own
  // margin only when it shows something.
  // The last one: the first is the empty-journey message.
  const section = [...finder.matchAll(/<section\s+aria-label="Find a step"\s+style=\{\{([^}]*)\}\}/g)].at(-1);
  assert.ok(section, 'the finder section style');
  assert.doesNotMatch(section[1], /\bgap:/, 'the finder section has no grid gap');
  hasNot(finder, /marginTop:[^\n]*'-\d+px'/, 'a negative margin');
  has(finder, /marginTop: narrowed \|\| showFilter \? '6px' : 0/, 'the row margin only when it shows something');
  // The arrows show no word, so the name is set at an end too, where it used to be undefined.
  has(finder, /const label = target \? `\$\{word\}: \$\{stepName\(target\)\}` : word;/, 'a name at either end');
  has(finder, /aria-label=\{label\}/, 'aria-label is always set');
  has(finder, /<ChevronLeft size=\{16\} aria-hidden="true" \/> : <ChevronRight size=\{16\} aria-hidden="true" \/>/, 'decorative arrows');
});

test('R11: the finder at rest fits a 72px budget', () => {
  // padding + label line + gap + control + border, read from the source's own numbers. The label
  // line is 11px text on the page's line height (13px measured in Chrome), rounded up to 16.
  const pad = Number([...finder.matchAll(/<section\s+aria-label="Find a step"\s+style=\{\{ padding: '(\d+)px/g)].at(-1)?.[1]);
  const field = Number(/const fieldStyle[^}]*minHeight: '(\d+)px'/.exec(finder)?.[1]);
  const nav = Number(/const navButtonStyle[\s\S]*?minHeight: '(\d+)px'/.exec(finder)?.[1]);
  const labelGap = Number(/const labelStyle[^}]*marginBottom: '(\d+)px'/.exec(finder)?.[1]);
  for (const [name, n] of [['padding', pad], ['field', field], ['nav', nav], ['label gap', labelGap]]) assert.ok(Number.isFinite(n), name);
  const rest = pad * 2 + 16 + labelGap + Math.max(field, nav) + 1;
  assert.ok(rest <= 72, `the finder at rest is about ${rest}px`);
  // Still at least a 24px target (WCAG 2.5.8).
  assert.ok(field >= 24 && nav >= 24, 'controls stay 24px or taller');
});

test('R11: the search hint fits a 360px dock, and the rest of the row goes to the Step list', () => {
  // The dock is 360px for every window from 768 to 1200px. A share of the row (0.8fr) gave the
  // search 106px there, and type=search keeps room for its cancel button, so "Name or type" read
  // "Name or typ". The field renders in Arial and Chrome needs 113px for that hint in it (measured
  // in the app), so the column is a fixed width past that, and the Step list takes all the rest.
  const cols = /gridTemplateColumns: '(\d+)px minmax\(0, 1fr\)'/.exec(finder);
  assert.ok(cols, 'a fixed search column, then the Step list');
  assert.ok(Number(cols[1]) >= 113, `the search column is ${cols[1]}px, and the hint needs 113`);
  has(finder, /placeholder="Name or type"/, 'the hint that 113px was measured for');
  // The arrows give the list 8px back and stay past the 24px target size.
  const arrowW = Number(/style=\{\{ \.\.\.navButtonStyle\(!target\), minWidth: '(\d+)px'/.exec(finder)?.[1]);
  assert.ok(arrowW >= 24 && arrowW < 32, `arrows ${arrowW}px wide`);
});
