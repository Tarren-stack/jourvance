// T03: zoomed out, a connection handle's hit area (24px on screen, F3) was a circle about its dot,
// and two facing handles on neighbouring cards (an output on one card's right edge, the next card's
// input on its left) sit closer on screen than that circle is wide. At 390px the default map's ad
// output and landing page input are 14px apart with 98 flow px circles, so a press 3px right of the
// ad's dot started a line from the landing page's input. Each area now keeps its size and slides
// back into its own card: an output reaches no more than HANDLE_OUT_REACH_SOURCE_FLOW_PX out of its
// card, an input no more than HANDLE_OUT_REACH_TARGET_FLOW_PX. The maths is pure
// (src/lib/semanticZoom.ts) and pinned by behaviour here against the facing pairs measured on the
// default map and bp6; the CSS that draws it is pinned by source; scripts/a11y-browser-check.mjs
// (handleTargets) measures every drawn area in Chrome at 390, 768, 1024 and 1440. U01 then capped
// how far an area reaches INTO its card (8px on screen with a mouse, the dot alone on a finger), so
// the floors along the axis and on the card's side are pinned in card-press.test.mjs, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  HANDLE_HIT_SCREEN_PX,
  HANDLE_DOT_PX,
  HANDLE_OUT_REACH_SOURCE_FLOW_PX,
  HANDLE_OUT_REACH_TARGET_FLOW_PX,
  HANDLE_IN_REACH_FINE_SCREEN_PX,
  handleHitPx,
  handleHitReach,
  zoomVar
} = await import('./src/lib/semanticZoom.ts');

const read = f => fs.readFileSync(f, 'utf8');
const cssRule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? null : css.slice(at, css.indexOf('}', at) + 1);
};

// The fit zooms measured in Chrome (390x844, 768x1024, 1024x768, 1440x900).
const FIT_ZOOMS = {
  'default@390': 0.245, 'default@768': 0.255, 'default@1024': 0.415, 'default@1440': 0.64,
  'bp6@390': 0.235, 'bp6@768': 0.245, 'bp6@1024': 0.4, 'bp6@1440': 0.62
};
// The closest facing pairs, in flow px between dot centres along the output's axis (every
// blueprint and the default map were measured; these are the nearest two, and the default map's ad
// and landing page are the closest pair the app opens).
const FACING = [
  { where: "default map: ad output to landing page input", gap: 58 },
  { where: 'bp6: upsell rescue output to the rescue sequence top input', gap: 64 },
  { where: 'bp5: upsell output to thank-you input', gap: 58 }
];

test('facing handles never meet across the gap, and the output keeps it up to the middle', () => {
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    const src = handleHitReach(z, 'source');
    const tgt = handleHitReach(z, 'target');
    for (const pair of FACING) {
      const at = `${where}, ${pair.where}`;
      assert.ok(src.out + tgt.out < pair.gap, `${at}: the areas meet (${src.out} + ${tgt.out} of ${pair.gap})`);
      assert.ok(src.out < pair.gap - HANDLE_DOT_PX / 2, `${at}: the output's area lies over the input's dot`);
      assert.ok(tgt.out < pair.gap - HANDLE_DOT_PX / 2, `${at}: the input's area lies over the output's dot`);
      assert.ok(src.out <= pair.gap / 2, `${at}: the output reaches past the middle of the gap`);
    }
    assert.ok(tgt.out <= src.out, `${where}: an input never keeps more of the gap than an output`);
  }
  // The old circle: half its diameter out of the card, whichever kind, and the ad and landing page
  // circles overlapped by 40 flow px at the phone's fit (the fault this pins).
  const d = handleHitPx(FIT_ZOOMS['default@390']);
  assert.ok(d / 2 + d / 2 > FACING[0].gap, 'the control: a centred circle did overlap here');
});

test('every area keeps 24px on screen across its own axis, and the whole dot', () => {
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    for (const kind of ['source', 'target']) {
      const r = handleHitReach(z, kind);
      assert.ok(r.across * z >= HANDLE_HIT_SCREEN_PX - 1e-9, `${where} ${kind}: ${(r.across * z).toFixed(1)}px across`);
      assert.ok(r.out >= HANDLE_DOT_PX / 2, `${where} ${kind}: the whole dot is still in the area`);
    }
  }
});

test('at zoom 1 and above nothing slides out: every area is the 24px circle about its dot, capped into the card', () => {
  for (const z of [1, 1.2, 1.8]) {
    for (const kind of ['source', 'target']) {
      const r = handleHitReach(z, kind);
      const d = handleHitPx(z);
      // Into the card only as far as U01's cap: 8px on screen with a mouse, never under half the dot.
      const inward = Math.max(HANDLE_DOT_PX / 2, Math.min(d / 2, HANDLE_IN_REACH_FINE_SCREEN_PX / zoomVar(z)));
      assert.deepEqual(r, { out: d / 2, in: inward, across: d }, `zoom ${z} ${kind}`);
    }
  }
  // An output keeps its circle down to zoom 0.43 (24 / (2 x 28)), so the 1440 fit only moves inputs.
  assert.deepEqual(handleHitReach(0.43, 'source').out, handleHitPx(0.43) / 2);
  assert.equal(HANDLE_OUT_REACH_TARGET_FLOW_PX * 2, 24, 'an input is the 24 flow px circle it is at zoom 1');
});

test('the stylesheet slides each area into its own card by what handleHitReach says', () => {
  const css = read('src/index.css');
  const base = cssRule(css, '.custom-handle::before');
  assert.ok(base);
  // Still grown out of the dot's own box, so neither the dot nor where a line attaches moves.
  assert.match(base, /inset: calc\(\(100% - var\(--jv-handle-hit, 24px\)\) \/ 2\);/);
  assert.doesNotMatch(base, /background|border:|transform|translate|scale/);
  const slide = cap => `--jv-hit-slide: max(0px, var(--jv-handle-hit, 24px) / 2 - ${cap}px);`;
  assert.ok(base.includes(slide(HANDLE_OUT_REACH_TARGET_FLOW_PX)), 'an input by the target cap');
  assert.ok(cssRule(css, '.custom-handle.source::before')?.includes(slide(HANDLE_OUT_REACH_SOURCE_FLOW_PX)), 'an output by the source cap');
  // Rounded by what is left of the reach, never more than the reach into the card (U01).
  assert.ok(base.includes('border-radius: min(calc(var(--jv-handle-hit, 24px) / 2 - var(--jv-hit-slide)), var(--jv-hit-in));'), 'rounded by the shorter reach');
  // Each side slides INTO its card: the inset facing out grows by the slide, and the one behind
  // reaches --jv-hit-in past the dot's centre (U01's cap).
  const edge = 'calc((100% - var(--jv-handle-hit, 24px)) / 2';
  for (const [pos, outSide, inSide] of [['right', 'right', 'left'], ['left', 'left', 'right'], ['bottom', 'bottom', 'top'], ['top', 'top', 'bottom']]) {
    const rule = cssRule(css, `.custom-handle.react-flow__handle-${pos}::before`);
    assert.ok(rule, pos);
    assert.ok(rule.includes(`${outSide}: ${edge} + var(--jv-hit-slide));`), `${pos}: pulled in from the side facing out`);
    assert.ok(rule.includes(`${inSide}: calc(50% - var(--jv-hit-in));`), `${pos}: grown into the card as far as the cap`);
  }
  // React Flow's own classes pick the side, so "custom-handle" stays the only className a card sets.
  for (const card of ['AdNode.tsx', 'PageNode.tsx', 'FormNode.tsx', 'SequenceNode.tsx', 'ThankYouNode.tsx', 'UpsellNode.tsx', 'AbSplitNode.tsx']) {
    const src = read(`src/components/canvas/nodes/${card}`);
    for (const m of src.matchAll(/<Handle[\s\S]*?\/>/g)) assert.match(m[0], /className="custom-handle"\n/, card);
  }
});

test('the browser check measures every handle on both maps at every width', async () => {
  const { CHECKS, HANDLE_TARGET_VIEWPORTS } = await import('./scripts/a11y-browser-check.mjs');
  assert.equal(CHECKS.handleTargets.name, 'checkHandleTargets');
  assert.deepEqual(HANDLE_TARGET_VIEWPORTS.map(v => v.width), [390, 768, 1024, 1440]);
  const src = read('scripts/a11y-browser-check.mjs');
  const fn = src.slice(src.indexOf('export async function checkHandleTargets('), src.indexOf('export async function checkLabels('));
  assert.match(fn, /blueprintSeed\('turnkey-retention-ecosystem'\)/, 'bp6 as well as the default map');
  assert.match(fn, /document\.elementsFromPoint\(x, y\)\.includes\(h\.el\)/, 'an area under another card is still measured');
  assert.match(fn, /handleHitReach\(r\.zoom, h\.source \? 'source' : 'target', r\.pointer\)/, 'against the maths, for the page\'s pointer');
  assert.match(fn, /takes a press nearer \$\{h\.name\}'s dot than its own/, 'the old fault by name');
  assert.match(fn, /if \(viewport\.width === 390 && !r\.handles\.some\(h => h\.out \+ 1 < h\.in\)\)/, 'the control');
});
