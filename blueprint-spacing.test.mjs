// C01: the shipped blueprints opened with cards lying over each other. A blueprint opens exactly
// where ecomBlueprints.ts puts its cards, the cards had grown taller than the 240 to 280 px between
// rows, and the lower card covered the "Left checkout" (bp2, bp6) and "Rescue flow" (bp5, bp6)
// handles, so a drag from them moved the card instead of making a line. Each lower card now sits the
// upper card's own height (BLUEPRINT_CARD_HEIGHTS, by kind) plus BLUEPRINT_LINE_ROOM below it. A
// first fix used one pitch sized for the tallest card, which pushed the short sequence rows 230 px
// down; the taller map then opened with a line pill under the map tools at 1280 and corner cards
// under the legend and the minimap. So the rows are also held close, the whole-map fit keeps room
// for those overlays (src/lib/fitRoom.ts), and npm run check:canvas opens every blueprint in Chrome
// at 1440, 1280 and 390 and fails on a card over a handle, over another card or under an overlay,
// and on a line pill a press cannot reach (the blueprintLayout check).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLUEPRINT_CARD_HEIGHTS, BLUEPRINT_CARD_MAX_WIDTH, BLUEPRINT_LINE_ROOM, ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';
import { MINIMAP_SIZE, OVERLAY_GAP, PANEL_MARGIN, basePaddingPx, overlayFitPadding, wholeMapFit } from './src/lib/fitRoom.ts';
import { blueprintLayoutProblems, blueprintProject, keyboardFindings, BLUEPRINT_LAYOUT_EXTRA_VIEWPORT, CANVAS_KEYBOARD_CHECKS, KEYBOARD_RULES } from './scripts/canvas-browser-check.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'canvas-browser-check.mjs'), 'utf8');
const CANVAS = fs.readFileSync(path.join(ROOT, 'src/components/canvas/JourneyCanvas.tsx'), 'utf8');
const DASHES = /—| – /;

// The tallest card of each kind in the shipped blueprints, top to its lowest handle, in map px,
// measured in Chrome at 1440x900 on 2026-09-29 (bp3-page 328, bp4-seq 280, bp1-ty 336, bp6-upsell 375).
const MEASURED = { 'ad-source': 218, 'landing-page': 328, 'lead-form': 209, 'follow-up-sequence': 280, 'thank-you': 336, upsell: 375 };
// Room for the upper card's bottom handle and a 22 px line pill between the rows.
const LINE_ROOM_MIN = 50;
// How much further apart than needed a row may sit before the map grows for nothing: a lower card
// may line up with the lower card beside it (bp2-ty with bp2-form, bp6-cart-recovery with
// bp6-upsell-rescue), and the first fix's 230 px is far past this.
const SLACK = 60;

const sameColumn = (a, b) => Math.abs(a.position.x - b.position.x) < BLUEPRINT_CARD_MAX_WIDTH;
const stacked = () => {
  const out = [];
  for (const bp of ECOM_BLUEPRINTS) {
    for (const a of bp.nodes) {
      for (const b of bp.nodes) {
        if (a !== b && sameColumn(a, b) && a.position.y < b.position.y) out.push({ bp, upper: a, lower: b });
      }
    }
  }
  return out;
};

test('each kind is given at least its measured height, and the line room fits a pill', () => {
  for (const [kind, h] of Object.entries(MEASURED)) assert.ok(BLUEPRINT_CARD_HEIGHTS[kind] >= h, kind);
  assert.ok(BLUEPRINT_LINE_ROOM >= LINE_ROOM_MIN, `${BLUEPRINT_LINE_ROOM}`);
  // Every kind a blueprint uses has a height.
  for (const bp of ECOM_BLUEPRINTS) for (const n of bp.nodes) assert.ok(BLUEPRINT_CARD_HEIGHTS[n.type] > 0, `${bp.id} ${n.id} ${n.type}`);
  // No card is wider than the column rule assumes.
  for (const f of ['AdNode', 'FormNode', 'SequenceNode', 'ThankYouNode', 'UpsellNode', 'AbSplitNode']) {
    const src = fs.readFileSync(path.join(ROOT, 'src/components/canvas/nodes', `${f}.tsx`), 'utf8');
    const w = /width: '(\d+)px'/.exec(src);
    assert.ok(w && Number(w[1]) <= BLUEPRINT_CARD_MAX_WIDTH, f);
  }
});

test('every shipped blueprint puts a card under another at least the upper card\'s height plus the line room below it', () => {
  const pairs = stacked();
  assert.ok(pairs.length >= 8, `${pairs.length}`);
  const tight = pairs
    .filter(({ upper, lower }) => lower.position.y - upper.position.y < BLUEPRINT_CARD_HEIGHTS[upper.type] + BLUEPRINT_LINE_ROOM)
    .map(({ bp, upper, lower }) => `${bp.id}: ${lower.id} is ${lower.position.y - upper.position.y}px under ${upper.id}`);
  assert.deepEqual(tight, []);
});

test('no row sits further down than its upper card needs, so the map is no taller than it must be', () => {
  // The first fix pushed every lower row 440 px down for the tallest card's sake, and the map that
  // opened was 230 map px taller for the short sequence cards.
  const loose = stacked()
    .filter(({ upper, lower }) => lower.position.y - upper.position.y > BLUEPRINT_CARD_HEIGHTS[upper.type] + BLUEPRINT_LINE_ROOM + SLACK)
    .map(({ bp, upper, lower }) => `${bp.id}: ${lower.id} is ${lower.position.y - upper.position.y}px under ${upper.id}`);
  assert.deepEqual(loose, []);
});

test('the cards the review found covering a handle now sit below the card they covered', () => {
  const pos = new Map(ECOM_BLUEPRINTS.flatMap(bp => bp.nodes.map(n => [n.id, n.position])));
  for (const [upper, lower, kind] of [['bp2-page', 'bp2-form', 'landing-page'], ['bp5-upsell', 'bp5-downsell', 'upsell'], ['bp6-page', 'bp6-cart-recovery', 'landing-page'], ['bp6-upsell', 'bp6-upsell-rescue', 'upsell']]) {
    assert.ok(pos.get(lower).y - pos.get(upper).y >= MEASURED[kind] + LINE_ROOM_MIN, `${lower} under ${upper}`);
  }
});

// ---- The whole-map fit keeps room for the overlays ----

test('a whole-map fit keeps the tools, legend and minimap clear, and never less than the old padding', () => {
  // 1280x800: the pane is 696 px tall, the tools and the open legend reach 124 px down it.
  const p = overlayFitPadding(0.2, 696, 124);
  assert.deepEqual(p, { x: 0.2, top: `${124 + OVERLAY_GAP}px`, bottom: `${PANEL_MARGIN + MINIMAP_SIZE.height + OVERLAY_GAP}px` });
  // A short overlay on a tall pane keeps the old padding at the top.
  const plain = basePaddingPx(0.2, 1400);
  assert.equal(overlayFitPadding(0.2, 1400, 20).top, `${plain}px`);
  assert.equal(basePaddingPx(0.2, 696), 58);
  // Not measured yet: the old number padding.
  assert.equal(overlayFitPadding(0.2, 0, 124), 0.2);
  assert.equal(overlayFitPadding(0.2, 696, 0), 0.2);
  // A fit framed on one selected step keeps its own padding and zoom cap.
  const focus = { padding: 0.2, nodes: [{ id: 'a' }], maxZoom: 1 };
  assert.equal(wholeMapFit(focus, p), focus);
  assert.deepEqual(wholeMapFit({ padding: 0.2 }, p), { padding: p });
});

test('the canvas gives the room to its first fit and to the tidy fit, read as each runs', () => {
  assert.match(CANVAS, /fitViewOptions=\{wholeMapFit\(canvasFitOptions\(selectedNodeId, displayedNodes\.map\(n => n\.id\)\), wholeMapPadding\)\}/);
  assert.match(CANVAS, /const wholeMapPadding = overlayFitPadding\(0\.2, overlayRoom\.pane, overlayRoom\.bottom\);/);
  // Measured in a layout effect, before React Flow measures the cards for its queued first fit.
  assert.match(CANVAS, /useLayoutEffect\(\(\) => \{\n    const box = canvasRef\.current;\n    const overlay = overlayRef\.current;/);
  assert.match(CANVAS, /ref=\{overlayRef\}\n        data-map-overlay="tools"/);
  const tidyFit = CANVAS.slice(CANVAS.indexOf('const fitAfterLayout'), CANVAS.indexOf('const handleTidyLayout'));
  assert.match(tidyFit, /const room = readOverlayRoom\(\);/);
  assert.match(tidyFit, /padding: overlayFitPadding\(0\.2, room\.pane, room\.bottom\)/);
  assert.match(CANVAS, /style=\{\{ width: MINIMAP_SIZE\.width, height: MINIMAP_SIZE\.height \}\}/);
});

// ---- The browser check's judge, on facts written by hand ----

const card = (id, left, top, right, bottom) => ({ id, left, top, right, bottom });
// bp6 at 1440 before the fix, as the review measured it: the recovery card started at y 490 on
// screen, over the landing page's bottom rows and its "abandon" handle at y 504.
const before = {
  width: 1440,
  blueprint: 'turnkey-retention-ecosystem',
  cards: [card('bp6-page', 300, 316, 520, 504), card('bp6-upsell', 560, 316, 790, 550), card('bp6-cart-recovery', 300, 490, 520, 688), card('bp6-upsell-rescue', 560, 490, 790, 660)],
  handles: [
    { card: 'bp6-page', handle: 'abandon', inView: true, topCard: 'bp6-cart-recovery' },
    { card: 'bp6-upsell', handle: 'rescue', inView: true, topCard: 'bp6-upsell-rescue' },
    { card: 'bp6-page', handle: 'main', inView: true, topCard: 'bp6-page' },
    { card: 'bp6-cart-recovery', handle: 'retention-in', inView: true, topCard: null }
  ]
};
const after = {
  ...before,
  cards: [card('bp6-page', 300, 250, 520, 438), card('bp6-upsell', 560, 250, 790, 484), card('bp6-cart-recovery', 300, 530, 520, 728), card('bp6-upsell-rescue', 560, 530, 790, 700)],
  handles: before.handles.map(h => ({ ...h, topCard: h.card === 'bp6-cart-recovery' ? null : h.card }))
};

test('blueprintLayoutProblems names each covered handle and each overlap, and passes the fixed map', () => {
  const problems = blueprintLayoutProblems(before);
  assert.deepEqual(problems, [
    '1440px, turnkey-retention-ecosystem: the "abandon" handle of bp6-page is under the bp6-cart-recovery card, so a drag from it moves that card instead of making a line.',
    '1440px, turnkey-retention-ecosystem: the "rescue" handle of bp6-upsell is under the bp6-upsell-rescue card, so a drag from it moves that card instead of making a line.',
    '1440px, turnkey-retention-ecosystem: the bp6-page and bp6-cart-recovery cards overlap by 220 by 14 px.',
    '1440px, turnkey-retention-ecosystem: the bp6-upsell and bp6-upsell-rescue cards overlap by 230 by 60 px.'
  ]);
  assert.deepEqual(blueprintLayoutProblems(after), []);
  for (const p of problems) assert.doesNotMatch(p, DASHES);
});

test('blueprintLayoutProblems ignores a handle under its own card, one off screen, and cards that only touch', () => {
  const f = {
    width: 390,
    blueprint: 'x',
    cards: [card('a', 0, 0, 100, 100), card('b', 0, 100, 100, 200), card('c', 99.5, 0, 200, 100)],
    handles: [
      { card: 'a', handle: 'main', inView: true, topCard: 'a' },
      { card: 'b', handle: 'main', inView: false, topCard: null },
      { card: 'c', handle: 'main', inView: true, topCard: null }
    ]
  };
  assert.deepEqual(blueprintLayoutProblems(f), []);
});

// bp1 at 1280x800 as the skeptic measured the first fix: the top row's NEXT pill under the map
// tools' Numbers control, the sequence card under the legend, the thank-you card under the minimap.
const crowded = {
  width: 1280,
  blueprint: 'single-product-flash-drop',
  cards: [card('bp1-seq', 624, 120, 822, 320), card('bp1-ty', 624, 500, 822, 740)],
  handles: [
    { card: 'bp1-seq', handle: 'main', inView: true, topCard: 'bp1-seq', topOverlay: null },
    { card: 'bp1-ty', handle: 'main', inView: true, topCard: null, topOverlay: 'minimap' }
  ],
  overlays: [
    { name: 'line legend', left: 735, top: 158, right: 880, bottom: 228 },
    { name: 'minimap', left: 741, top: 695, right: 881, bottom: 785 },
    { name: '"Numbers" tool', left: 525, top: 118, right: 700, bottom: 150 }
  ],
  pills: [
    { label: 'NEXT Unavailable', inView: true, blockedBy: 'map\'s "Numbers" tool' },
    { label: 'VISITS Unavailable', inView: true, blockedBy: null },
    { label: 'CR Unavailable', inView: false, blockedBy: null }
  ]
};

test('blueprintLayoutProblems names a card under an overlay, a handle under one, and a pill a press cannot reach', () => {
  const problems = blueprintLayoutProblems(crowded);
  assert.deepEqual(problems, [
    '1280px, single-product-flash-drop: the "main" handle of bp1-ty is under the map\'s minimap, so a drag from it cannot make a line.',
    '1280px, single-product-flash-drop: the bp1-seq card is under the map\'s line legend by 87 by 70 px.',
    '1280px, single-product-flash-drop: the bp1-seq card is under the map\'s "Numbers" tool by 76 by 30 px.',
    '1280px, single-product-flash-drop: the bp1-ty card is under the map\'s minimap by 81 by 45 px.',
    '1280px, single-product-flash-drop: the "NEXT Unavailable" line pill is under the map\'s "Numbers" tool, so a press on it lands there instead.'
  ]);
  for (const p of problems) assert.doesNotMatch(p, DASHES);
  const clear = { ...crowded, cards: [card('bp1-seq', 560, 250, 720, 450), card('bp1-ty', 560, 500, 720, 670)], handles: crowded.handles.map(h => ({ ...h, topOverlay: null })), pills: crowded.pills.map(p => ({ ...p, blockedBy: null })) };
  assert.deepEqual(blueprintLayoutProblems(clear), []);
});

test('a map that measured nothing never passes', () => {
  assert.deepEqual(blueprintLayoutProblems({ width: 1440, blueprint: 'x', cards: [], handles: [] }), ['1440px, x: the blueprint opened with no step on the map.']);
  assert.deepEqual(blueprintLayoutProblems({ width: 1440, blueprint: 'x', cards: [card('a', 0, 0, 1, 1)], handles: [{ card: 'a', handle: 'main', inView: false, topCard: null }] }), [
    '1440px, x: no handle of any step could be measured on screen.'
  ]);
});

test('the check reports as the zero-only a11y-blueprint-layout rule, at the width each line names', () => {
  assert.ok(KEYBOARD_RULES.includes('a11y-blueprint-layout'));
  assert.equal(typeof CANVAS_KEYBOARD_CHECKS.blueprintLayout, 'function');
  const out = keyboardFindings({ blueprintLayout: [...blueprintLayoutProblems(before), ...blueprintLayoutProblems({ ...before, width: 390 })] });
  assert.equal(out.findings.length, 8);
  assert.ok(out.findings.every(f => f.rule === 'a11y-blueprint-layout' && f.section === 'a11y' && f.scenario === 'blueprintLayout'));
  assert.deepEqual([...new Set(out.findings.map(f => f.viewport))], ['1440', '390']);
});

test('the check opens every shipped blueprint as Use Blueprint does, after a planted control', () => {
  const body = SCRIPT.slice(SCRIPT.indexOf('async function checkBlueprintLayout'), SCRIPT.indexOf('export const CANVAS_KEYBOARD_CHECKS'));
  assert.match(body, /for \(const bp of ECOM_BLUEPRINTS\)/);
  // 1440 and 390 from the harness, and 1280, where the first fix put a pill under the tools.
  assert.match(body, /CHECK_VIEWPORTS\.find\(v => v\.label === '1440'\),\n    BLUEPRINT_LAYOUT_EXTRA_VIEWPORT,\n    CHECK_VIEWPORTS\.find\(v => v\.label === '390'\)/);
  assert.deepEqual(BLUEPRINT_LAYOUT_EXTRA_VIEWPORT, { label: '1280', width: 1280, height: 800 });
  // The control must fire every half of the judge, or the check throws and the section is unproven.
  assert.match(body, /cover\.position = \{ x: page\.position\.x, y: page\.position\.y \+ 150 \}/);
  assert.match(body, /blueprintLayoutFacts\(browser, run, widths\[0\], planted, true\)/);
  assert.match(body, /handle of \$\{page\.id\} is under the \$\{cover\.id\} card/);
  assert.match(body, /cards overlap by/);
  assert.match(body, /card is under the map's "Planted" tool/);
  assert.match(body, /line pill is under the planted cover/);
  assert.match(body, /if \(found\.includes\(false\)\) \{\n    throw new Error\('The planted blueprint control/);
  // The facts read the overlays the fit keeps clear, and every line pill.
  const facts = SCRIPT.slice(SCRIPT.indexOf('async function blueprintLayoutFacts'), SCRIPT.indexOf('async function checkBlueprintLayout'));
  assert.match(facts, /document\.querySelector\('\[data-map-overlay\]'\)/);
  assert.match(facts, /\.react-flow__minimap, \.react-flow__controls/);
  // Line pills render in React Flow's viewport portal and carry their own mark.
  assert.match(facts, /document\.querySelectorAll\('\[data-jv-edge-label\] button'\)/);
  // The journey is seeded the way a signed-out visitor holds it, and only on the first load.
  assert.match(SCRIPT, /project = null \}\) \{/);
  assert.match(SCRIPT, /if \(sessionStorage\.getItem\('jv-check-seeded'\)\) return;/);
  // Same positions and handles as the modal's copy, with the seeded numbers cleared.
  const bp = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
  const project = blueprintProject(bp);
  assert.deepEqual(project.nodes.map(n => n.position), bp.nodes.map(n => n.position));
  assert.equal(project.edges.length, bp.edges.length);
  assert.ok(project.edges.every(e => e.data.rate === 0 && e.data.targetCount === 0));
  assert.notEqual(project.nodes[0], bp.nodes[0], 'the shipped blueprint is not mutated');
  const modal = fs.readFileSync(path.join(ROOT, 'src/components/modals/BlueprintModal.tsx'), 'utf8');
  assert.match(modal, /zeroBlueprintMetrics\(clonedNodes, repairEdgeHandles\(clonedNodes, clonedEdges\)\)/);
});
