// T06: at 390px a tap on a step scrolled the step panel into view (R02) and pushed the tapped card
// up behind the header, so the strip of map left on screen showed only the zoom controls and the
// minimap. The map now pans, with no zoom change, so the card sits centred in that strip; the
// selected card carries a ring that stays 3px on screen at any zoom; and on a narrow map the tools
// row and the Lines legend fold into one "Map tools" button. The rules are pure
// (src/lib/tapReveal.ts) and pinned by behaviour here, with the measured 390x844 geometry from the
// regression pass; the wiring is TSX and CSS, so it is pinned by source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  REVEAL_MIN_BAND_PX,
  MAP_TOOLS_COMPACT_BELOW_PX,
  mapToolsCompact,
  revealShift,
  unionBox,
  visibleBand
} = await import('./src/lib/tapReveal.ts');

const read = p => fs.readFileSync(p, 'utf8');
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const move = (b, s) => box(b.left + s.dx, b.top + s.dy, b.right + s.dx, b.bottom + s.dy);
const inside = (a, b) => a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom;
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// 390x844 after tapping node-page-1 (repro-before.json): the map element runs from 216 - 313 to
// 216 - 313 + 523, the scroller (main) starts under the header at 216, and the card was drawn at
// y 133 to 193, behind the header.
const VIEW = { width: 390, height: 844 };
const MAP = box(0, 216 - 313, 390, 216 - 313 + 523);
const MAIN = box(0, 216, 390, 844);
const CARD = box(114, 133, 178, 193);
const PILLS = box(129, 103, 178, 125);
const CONTROLS = box(15, 331, 43, 411);
const MINIMAP = box(235, 321, 375, 411);

test('the visible strip is the map clipped by its scroller and the window', () => {
  assert.deepEqual(visibleBand(MAP, MAIN, VIEW), box(0, 216, 390, 426));
  assert.equal(visibleBand(box(0, 900, 390, 1400), MAIN, VIEW), null, 'a map scrolled wholly off screen');
  assert.deepEqual(visibleBand(box(0, 100, 1440, 900), null, { width: 1440, height: 900 }), box(0, 100, 1440, 900));
});

test('the tapped card and its + Before / + Next pills move together', () => {
  assert.deepEqual(unionBox([CARD, PILLS]), box(114, 103, 178, 193));
  assert.equal(unionBox([]), null);
  assert.deepEqual(unionBox([CARD, box(0, 0, 0, 0)]), CARD, 'an empty box adds nothing');
});

test('a card pushed behind the header is panned into the strip still on screen, clear of the controls', () => {
  const band = visibleBand(MAP, MAIN, VIEW);
  const target = unionBox([CARD, PILLS]);
  assert.ok(!inside(target, band), 'the regression: the card was off the strip');
  const shift = revealShift(target, band, [CONTROLS, MINIMAP]);
  assert.ok(shift, 'the map moves');
  const after = move(target, shift);
  assert.ok(inside(after, band), `card ${JSON.stringify(after)} in strip ${JSON.stringify(band)}`);
  assert.ok(!meets(after, MINIMAP) && !meets(after, CONTROLS), 'clear of the minimap and zoom controls');
  // Centred across the strip; the minimap and controls sit either side of that column, so the card
  // is centred down the whole strip.
  assert.equal(Math.round((after.left + after.right) / 2), 195);
  assert.equal(Math.round((after.top + after.bottom) / 2), 321);
});

test('a card wide enough to reach the minimap is centred in the room above it', () => {
  const band = box(0, 216, 390, 426);
  const wide = box(40, 120, 240, 190);
  const shift = revealShift(wide, band, [CONTROLS, MINIMAP]);
  const after = move(wide, shift);
  assert.ok(!meets(after, MINIMAP) && !meets(after, CONTROLS));
  assert.ok(Math.abs((after.top + after.bottom) / 2 - (band.top + MINIMAP.top - 8) / 2) <= 0.5, 'whole pixels');
});

test('the map is left alone when the card already shows, or when too little of the map does', () => {
  const band = box(0, 216, 390, 426);
  assert.equal(revealShift(box(150, 250, 214, 310), band, [CONTROLS, MINIMAP]), null, 'already on screen and clear');
  assert.equal(revealShift(CARD, null), null, 'no map on screen');
  assert.equal(revealShift(CARD, box(0, 216, 390, 216 + REVEAL_MIN_BAND_PX - 1)), null, 'a sliver of map');
  // A card under the minimap is moved even though it is inside the strip.
  assert.ok(revealShift(box(250, 330, 314, 390), band, [MINIMAP]));
});

test('with no room beside the controls the card is centred in the whole strip', () => {
  const band = box(0, 216, 390, 300);
  const tall = box(114, 100, 278, 180);
  const shift = revealShift(tall, band, [box(0, 250, 390, 300)]);
  const after = move(tall, shift);
  assert.equal((after.top + after.bottom) / 2, 258);
});

test('the tools fold on a narrow map and never from 1024px up', () => {
  assert.equal(mapToolsCompact(390), true, 'a phone');
  assert.equal(mapToolsCompact(408), true, '768px with the step panel beside the map');
  assert.equal(mapToolsCompact(664), false, '1024px: nothing changes');
  assert.equal(mapToolsCompact(1080), false, '1440px: nothing changes');
  assert.equal(mapToolsCompact(0), false, 'not measured yet');
  assert.ok(MAP_TOOLS_COMPACT_BELOW_PX <= 664);
});

const CANVAS = read('./src/components/canvas/JourneyCanvas.tsx');

test('a tap on a card, and only a tap, asks the map to keep it on screen', () => {
  const click = CANVAS.slice(CANVAS.indexOf('const handleNodeClick'), CANVAS.indexOf('const handleEdgeClick'));
  assert.match(click, /e\.detail > 0 && !onControl\) setTapRequest\(t => t \+ 1\)/);
  // FocusSelectedStep runs it, so it stays the one pan that follows the selection (#7, #21).
  assert.match(CANVAS, /<FocusSelectedStep nodeId=\{selectedNodeId\} request=\{focusRequest \?\? 0\} tap=\{tapRequest\} \/>/);
  const focus = CANVAS.slice(CANVAS.indexOf('function FocusSelectedStep'), CANVAS.indexOf('function SemanticZoom'));
  assert.match(focus, /useKeepTappedStepOnScreen\(nodeId, tap\);/);
  const reveal = CANVAS.slice(CANVAS.indexOf('function useKeepTappedStepOnScreen'), CANVAS.indexOf('function FocusSelectedStep'));
  assert.match(reveal, /if \(!tap \|\| !nodeId \|\| !flow\) return;/, 'a first fit or a return from Email Studio never asks');
  // #7's pan zooms in to MIN_FOCUS_ZOOM for a card near the edge, which on a phone made it taller
  // than the strip above the panel: a tap there is left to the no-zoom pan, and a re-tap of the open
  // step still asks #7 for nothing, as before.
  assert.match(focus, /if \(tap !== prev\.tap\) \{[\s\S]*?if \(flow && scrollBoxOf\(flow\)\) return;\n\s*if \(prev\.nodeId === nodeId && prev\.ready === ready && prev\.request === request\) return;\n\s*\}/);
  assert.match(focus, /\}, \[nodeId, ready, request, tap\]\);/);
  assert.match(reveal, /const scroller = scrollBoxOf\(flow\);\n    if \(!scroller\) return;/, 'only where something scrolls the map');
  assert.match(reveal, /zoom: transform\[2\] \}/, 'no zoom change');
  assert.match(reveal, /duration: reduceMotion\(\) \? 0 : PAN_DURATION_MS/);
  assert.match(reveal, /revealShift\(target, band, obstacles\)/);
});

test('the map tools fold into one disclosure that keyboard and touch can open', () => {
  const toggle = CANVAS.slice(CANVAS.indexOf('{compactTools && ('), CANVAS.indexOf('<span>Map tools</span>'));
  assert.match(toggle, /aria-expanded=\{toolsOpen\}/);
  assert.match(toggle, /aria-controls="jv-map-tools jv-map-legend"/);
  assert.match(toggle, /type="button"/);
  assert.doesNotMatch(toggle, /outline:|tabIndex/);
  assert.match(CANVAS, /const toolsShown = !compactTools \|\| toolsOpen;/);
  assert.match(CANVAS, /<div id="jv-map-tools" style=\{\{ display: toolsShown \? 'flex' : 'none'/);
  assert.match(CANVAS, /<div id="jv-map-legend" style=\{\{ display: toolsShown \? 'contents' : 'none' \}\}>\n\s*<EdgeLegend/);
  // The tidy notice stays outside the fold, and its X never drops focus on a hidden button.
  assert.ok(CANVAS.indexOf('<div role="status" aria-live="polite">') > CANVAS.indexOf('<div id="jv-map-tools"'));
  assert.ok(CANVAS.indexOf('<div role="status" aria-live="polite">') < CANVAS.indexOf('<div id="jv-map-legend"'));
  assert.match(CANVAS, /else toolsToggleRef\.current\?\.focus\(\);/);
  assert.match(CANVAS, /setCompactTools\(mapToolsCompact\(box\.clientWidth\)\)/);
  assert.match(CANVAS, /\}, \[readOverlayRoom, compactTools\]\);/, 'the fit reads the folded height');
});

test('the selected card ring is 3px on screen at any zoom, below 768px only', () => {
  const css = read('./src/index.css');
  const at = css.indexOf('.react-flow .react-flow__node.selected:not(:focus-visible)');
  assert.ok(at > 0);
  const media = css.lastIndexOf('@media', at);
  assert.match(css.slice(media, at), /^@media \(max-width: 767px\) \{\s*$/);
  const rule = css.slice(at, css.indexOf('}', at));
  assert.match(rule, /outline: calc\(3px \/ var\(--jv-zoom, 1\)\) solid #C7D2FE;/);
  assert.match(rule, /outline-offset: calc\(3px \/ var\(--jv-zoom, 1\)\);/);
});

test('no em dash in what this adds', () => {
  for (const src of [read('./src/lib/tapReveal.ts'), CANVAS]) assert.doesNotMatch(src, /—| – /);
});
