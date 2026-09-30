// Semantic zoom on the journey map (F3). At fit-to-screen a card's 13px step name drew at about 8px
// at 1440 and 3px at 390. Below FULL_DETAIL_MIN_ZOOM each card swaps its detail rows for a summary
// whose name stays 14px on screen; at 1 and above nothing changes. The maths is pure
// (src/lib/semanticZoom.ts) and pinned by behaviour here; the wiring is TSX and CSS, so it is
// pinned by source like edge-kinds.test.mjs. scripts/a11y-browser-check.mjs measures the rendered
// size of every card title in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  CARD_TITLE_PX,
  TITLE_MIN_RENDERED_PX,
  FULL_DETAIL_MIN_ZOOM,
  COMPACT_MAX_ZOOM,
  SUMMARY_TITLE_SCREEN_PX,
  COMPACT_TITLE_SCREEN_PX,
  HANDLE_HIT_SCREEN_PX,
  HANDLE_DOT_PX,
  HANDLE_HIT_MAX_FLOW_PX,
  ZOOM_VAR_STEP,
  detailLevel,
  titleScale,
  compactTitleScale,
  handleHitPx,
  zoomVar,
  semanticZoomVars,
  renderedTitlePx,
  CAPTION_PX,
  CAPTION_SCREEN_PX,
  CAPTION_LAYOUT_STEP,
  captionScale,
  captionLayoutScale
} = await import('./src/lib/semanticZoom.ts');

const read = f => fs.readFileSync(f, 'utf8');
const NODE_DIR = 'src/components/canvas/nodes';
const CARDS = ['AdNode.tsx', 'PageNode.tsx', 'FormNode.tsx', 'SequenceNode.tsx', 'ThankYouNode.tsx', 'UpsellNode.tsx', 'AbSplitNode.tsx'];

// The fit-to-screen zooms measured in Chrome on the default journey and bp6 (1440x900, 390x844).
const FIT_ZOOMS = { 'default@1440': 0.643939, 'default@390': 0.24697, 'bp6@1440': 0.620438, 'bp6@390': 0.237956 };

test('at 1 and above every card keeps its full detail, as it looked before', () => {
  for (const z of [1, 1.2, 1.8]) {
    assert.equal(detailLevel(z), 'full', `zoom ${z}`);
    assert.equal(titleScale(z) >= 1, true);
  }
  assert.equal(detailLevel(FULL_DETAIL_MIN_ZOOM), 'full');
  assert.equal(detailLevel(0.849), 'summary');
  assert.equal(detailLevel(COMPACT_MAX_ZOOM), 'summary');
  assert.equal(detailLevel(COMPACT_MAX_ZOOM - 0.001), 'compact');
  // A zoom that is not a number is read as 1, never as a reason to hide the detail.
  for (const z of [NaN, 0, -1, Infinity]) assert.equal(detailLevel(z), 'full', String(z));
});

test('a card title never renders under the 11px floor at full detail', () => {
  assert.ok(renderedTitlePx(CARD_TITLE_PX, FULL_DETAIL_MIN_ZOOM) >= TITLE_MIN_RENDERED_PX);
  assert.equal(renderedTitlePx(13, 0.5), 6.5);
});

test('at every fit-to-screen zoom the summary name renders at 13px or more', () => {
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    assert.notEqual(detailLevel(z), 'full', `${where} shows the summary`);
    const onScreen = renderedTitlePx(CARD_TITLE_PX * titleScale(z), z);
    assert.ok(onScreen >= 13, `${where}: ${onScreen.toFixed(2)}px`);
    assert.ok(onScreen >= SUMMARY_TITLE_SCREEN_PX, `${where}: ${onScreen.toFixed(2)}px`);
    assert.ok(onScreen < SUMMARY_TITLE_SCREEN_PX + 0.7, `${where}: stepped no further than it needs`);
  }
  // The phone's fit keeps the icon and name: the figure would not fit a readable size too.
  assert.equal(detailLevel(FIT_ZOOMS['default@390']), 'compact');
  assert.equal(detailLevel(FIT_ZOOMS['default@1440']), 'summary');
});

test('the scale moves in twentieths, so a smooth zoom writes the variable in steps', () => {
  for (let z = 0.1; z < 1.8; z += 0.013) {
    const s = titleScale(z);
    assert.equal(Math.round(s * 20), Math.round(s * 20 * 1e6) / 1e6, `zoom ${z}: ${s}`);
    assert.ok(s >= 1);
  }
  assert.ok(titleScale(0.3) > titleScale(0.6), 'further out, larger');
});

test('a connection handle takes at least 24px of screen, and never less than its dot', () => {
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    assert.ok(handleHitPx(z) * z >= HANDLE_HIT_SCREEN_PX, `${where}: ${(handleHitPx(z) * z).toFixed(1)}px`);
  }
  for (let z = HANDLE_HIT_SCREEN_PX / HANDLE_HIT_MAX_FLOW_PX; z <= 1.8; z += 0.01) {
    assert.ok(handleHitPx(z) * z >= HANDLE_HIT_SCREEN_PX - 1e-9, `zoom ${z}`);
  }
  assert.equal(handleHitPx(0.1), HANDLE_HIT_MAX_FLOW_PX, 'capped, so a far-out card can still be dragged');
  assert.ok(handleHitPx(1.8) >= HANDLE_DOT_PX);
  assert.deepEqual(semanticZoomVars(1), { detail: 'full', titleScale: 1.1, compactTitleScale: 1, handleHitPx: 24, zoom: 1, captionScale: 1 });
});

test('--jv-zoom is the zoom rounded down, so the CSS floor check can only hide a name early', () => {
  for (let z = 0.1; z < 1.8; z += 0.0037) {
    const v = zoomVar(z);
    assert.ok(v <= z + 1e-9, `zoom ${z}: ${v} is not above it`);
    assert.ok(z - v < ZOOM_VAR_STEP + 1e-9, `zoom ${z}: ${v} is within a step`);
    assert.equal(Math.round(v / ZOOM_VAR_STEP), Math.round((v / ZOOM_VAR_STEP) * 1e6) / 1e6, `zoom ${z}: ${v} is on a step`);
  }
  // The skeptic's phone zooms (F3): one Zoom out press from fit, and the next.
  assert.equal(zoomVar(0.205808), 0.205);
  assert.equal(zoomVar(0.2), 0.2, 'an exact step is not read as the one below');
  assert.equal(zoomVar(0.171), 0.17);
  for (const z of [NaN, 0, -1]) assert.equal(zoomVar(z), 1, String(z));
});

// ---- Wiring ----

test('the canvas writes the zoom onto the map without re-rendering a card', () => {
  const src = read('src/components/canvas/JourneyCanvas.tsx');
  const start = src.indexOf('function SemanticZoom()');
  assert.ok(start > 0, 'a SemanticZoom component');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /useStoreApi\(\)/);
  assert.match(body, /store\.subscribe\(/, 'it subscribes rather than selecting, so it never renders on a zoom frame');
  assert.doesNotMatch(body, /useStore\(/);
  assert.doesNotMatch(body, /useState\(/);
  assert.match(body, /requestAnimationFrame\(write\)/, 'at most one write per frame');
  assert.match(body, /cancelAnimationFrame\(frame\)/);
  assert.match(body, /dataset\.jvDetail = v\.detail/);
  assert.match(body, /setProperty\('--jv-title-scale'/);
  assert.match(body, /setProperty\('--jv-handle-hit'/);
  assert.match(body, /setProperty\('--jv-zoom', String\(v\.zoom\)\)/);
  assert.match(body, /setProperty\('--jv-caption-scale', String\(v\.captionScale\)\)/, 'T02: captions and badges read it');
  assert.match(body, /setProperty\('--jv-compact-title-scale', String\(v\.compactTitleScale\)\)/, 'U02: the compact name reads it');
  assert.match(body, /const key = `\$\{v\.detail\} \$\{v\.titleScale\} \$\{v\.compactTitleScale\} \$\{v\.handleHitPx\} \$\{v\.zoom\} \$\{v\.captionScale\}`;/, 'a new zoom step is written');
  const flow = src.slice(src.indexOf('<ReactFlow\n'), src.indexOf('</ReactFlow>'));
  assert.equal((flow.match(/<SemanticZoom \/>/g) || []).length, 1, 'rendered once, inside <ReactFlow>');
});

test('every card marks its name, its detail rows and its summary', () => {
  for (const file of CARDS) {
    const src = read(`${NODE_DIR}/${file}`);
    assert.match(src, /import \{ StepSummary \} from '\.\.\/StepSummary';/, file);
    // One in-flow name, the card's own 13px line.
    const titles = [...src.matchAll(/<div data-jv-title style=\{\{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC'/g)];
    assert.equal(titles.length, 1, `${file}: one 13px title marked`);
    assert.ok((src.match(/data-jv-detail-row/g) || []).length >= 3, `${file}: its detail rows are marked`);
    // The summary is the root's last child, so the root is not positioned and the badge stays first.
    assert.equal(src.split('<StepSummary').length - 1, 1, `${file}: one summary`);
    const tail = src.slice(src.indexOf('<StepSummary'));
    assert.match(tail, /^<StepSummary[\s\S]*?\/>\n {4}<\/div>\n {2}\);\n\};/, `${file}: the summary closes the card`);
    assert.match(tail, /nodeId=\{id\}/);
    assert.match(tail, /kind=\{kind\}/);
    assert.match(tail, /name=\{name\}/);
    assert.match(tail, /figure=\{/);
    // A handle is never inside a detail row, so fading the rows never hides a handle.
    for (const block of src.split('<Handle').slice(1)) assert.doesNotMatch(block.slice(0, block.indexOf('/>')), /data-jv-detail-row/);
  }
});

test('the summary is decoration for the pointer and for a screen reader', () => {
  const src = read('src/components/canvas/StepSummary.tsx');
  assert.match(src, /className="jv-step-summary" aria-hidden="true"/);
  assert.match(src, /<div data-jv-title className=\{`jv-step-summary__name[^\n]*\n\s*<SummaryIcon kind=\{kind\} icon=\{icon\} \/>\n\s*<span className="jv-step-summary__text">\{name\}<\/span>\n\s*<\/div>/);
  // The icon is an SVG 1em square drawn from the same tile table as StepIcon, so it scales with the
  // name's own font, capped or not (a px tile scaled by --jv-title-scale made line one taller).
  assert.match(src, /const t = iconTile\(kind\.shape, kind\.color\);/);
  assert.match(src, /<svg className="jv-step-summary__icon" data-step-shape=\{kind\.shape\} viewBox="0 0 28 28"/);
  assert.doesNotMatch(src, /<button|tabIndex|onClick/);
  const strip = read('src/components/canvas/PublishStatus.tsx');
  assert.match(strip, /data-publish-status=\{state\.kind\}\n[^\n]*\n\s*data-jv-detail-row/, 'the publish strip fades with the rows');
});

const cssRule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? null : css.slice(at, css.indexOf('}', at) + 1);
};

test('the stylesheet fades the rows and shows the summary only below full detail', () => {
  const css = read('src/index.css');
  const hide = cssRule(css, ".react-flow[data-jv-detail='summary'] [data-jv-detail-row],\n.react-flow[data-jv-detail='compact'] [data-jv-detail-row]");
  assert.ok(hide, 'rows hidden at summary and compact');
  assert.match(hide, /opacity: 0;/);
  assert.match(hide, /visibility: hidden;/);
  assert.doesNotMatch(hide, /display|height|margin|padding/, 'hidden rows keep their space, so no handle moves');
  assert.match(cssRule(css, '[data-jv-detail-row]'), /transition: opacity 0\.15s ease, visibility 0\.15s ease;/);
  const summary = cssRule(css, '.jv-step-summary');
  assert.match(summary, /position: absolute;/);
  assert.match(summary, /inset: 0;/);
  assert.match(summary, /pointer-events: none;/);
  assert.match(summary, /visibility: hidden;/, 'hidden at full detail');
  assert.match(summary, /overflow: hidden;/);
  const name = cssRule(css, '.jv-step-summary__name');
  assert.match(name, /font-size: min\(calc\(13px \* var\(--jv-title-scale, 1\)\), \d+cqh\);/);
  assert.match(name, /-webkit-line-clamp: 2;/);
  assert.match(name, /text-overflow: ellipsis;/);
  assert.match(name, /line-height: 1\.15;/);
  assert.match(name, /flex-shrink: 0;/, 'a name the summary shrank was cut mid-glyph, not clamped');
  const icon = cssRule(css, '.jv-step-summary__icon');
  assert.match(icon, /width: 1em;/);
  assert.match(icon, /height: 1em;/);
  assert.doesNotMatch(icon, /zoom|px/, 'sized by the name, never by the zoom variable');
  // Two lines of the compact name fit its summary's content box: 2 x 1.15 x cap <= 100cqh.
  const compact = cssRule(css, ".react-flow[data-jv-detail='compact'] .jv-step-summary__name");
  const cap = Number(/font-size: min\(calc\(13px \* var\(--jv-compact-title-scale, 1\)\), (\d+)cqh\);/.exec(compact)?.[1]);
  assert.ok(cap > 0 && 2 * 1.15 * cap <= 100, `compact cap ${cap}cqh`);
  // Under the floor a compact name draws at 0 rather than small: 1em while 1em x zoom is over 11px.
  const text = cssRule(css, ".react-flow[data-jv-detail='compact'] .jv-step-summary__text");
  assert.match(text, /font-size: clamp\(0px, calc\(\(1em \* var\(--jv-zoom, 1\) - 11px\) \* 1000000000\), 1em\);/);
  // An address breaks after a hyphen or slash, never mid-word where a hyphen break fits.
  assert.doesNotMatch(css, /line-break: anywhere/);
  assert.match(cssRule(css, '.jv-step-summary__name--address'), /text-indent: 1\.2em;/);
  assert.match(cssRule(css, '.jv-step-summary__row'), /font-size: min\(calc\(11px \* var\(--jv-title-scale, 1\)\), \d+cqh\);/);
  // Reduced motion: the one universal switch (#19) still stops every transition, the fade included.
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(motion, /\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition: none !important;/);
});

test('the handle hit area grows from the dot without moving it', () => {
  const css = read('src/index.css');
  const hit = cssRule(css, '.custom-handle::before');
  assert.ok(hit);
  assert.match(hit, /inset: calc\(\(100% - var\(--jv-handle-hit, 24px\)\) \/ 2\);/);
  assert.doesNotMatch(hit, /background|border:|transform|translate|scale/);
});

test('the browser check reads map text, card titles, captions and badges at their rendered size', async () => {
  const src = read('scripts/a11y-browser-check.mjs');
  const fn = src.slice(src.indexOf('async function smallTextIn('), src.indexOf('/** Visible controls with no programmatic label. */'));
  assert.match(fn, /closest\('\.react-flow__node \[data-jv-title\]'\)/);
  // T02: every ancestor's scale, not only the viewport's, so a counter-scaled caption reads true.
  assert.match(fn, /const onMap = Boolean\(el\.closest\('\.react-flow__viewport'\)\);/);
  assert.match(fn, /chain: onMap \? chainOf\(el\) : null/);
  assert.match(fn, /t\.chain \? renderedFontPx\(t\.fontSizePx, t\.chain\) : t\.fontSizePx/);
  assert.match(fn, /if \(title && parseFloat\(style\.fontSize\) === 0\) continue;/, 'a name drawn at 0 is not drawn');
  const { CHECKS } = await import('./scripts/a11y-browser-check.mjs');
  assert.equal(CHECKS.mapCaptions.name, 'checkMapCaptions');
  const check = src.slice(src.indexOf('export async function checkMapCaptions('), src.indexOf('export async function checkLabels('));
  for (const vp of ['{ width: 1440, height: 900 }', '{ width: 390, height: 844 }']) assert.ok(check.includes(vp), vp);
  assert.match(check, /b\.id === 'turnkey-retention-ecosystem'/, 'on bp6 as well as the default map');
  assert.match(check, /renderedFontPx\(t\.fontSizePx, t\.chain\)/);
  assert.match(check, /findCollisions\(\{ captions: r\.captions, cards: r\.cards, handles: r\.handles, badges: r\.badgeRects \}\)/);
  assert.match(check, /if \(!press && !\(r\.zoom < 1\)\)/, 'the control: it measured a zoomed-out map');
  // Past fit as well (the skeptic's regression: at one press on a phone a badge took a handle's press).
  assert.match(check, /for \(let press = 0; press <= 2; press\+\+\)/);
  assert.match(check, /page\.click\('\.react-flow__controls-zoomout'\)/, "through the map's own Zoom out button");
  assert.match(check, /if \(press && last !== null && !\(r\.zoom < last\)\)/, 'and proves each press zoomed out');
  assert.match(check, /document\.elementFromPoint\(x, y\)/, 'a handle centre is tested for what takes the pointer there');
  assert.match(check, /at\.closest\('\[data-jv-design-badge\], \[data-jv-edge-label\]'\)/);
});

test('the browser check zooms out past where a phone cut the ad card\'s name', async () => {
  const src = read('scripts/a11y-browser-check.mjs');
  const fn = src.slice(src.indexOf('export async function checkStepNamesFit('), src.indexOf('export async function checkLabels('));
  assert.match(fn, /\{ width: 390, height: 844 \}/);
  assert.match(fn, /page\.click\('\.react-flow__controls-zoomout'\)/, 'through the map\'s own Zoom out button');
  assert.match(fn, /!\(last <= 0\.2\)/, 'and proves it reached 0.2');
  assert.match(fn, /range\.getClientRects\(\)/, 'a cut is read from the lines of text themselves');
  const { CHECKS } = await import('./scripts/a11y-browser-check.mjs');
  assert.equal(CHECKS.stepNamesFit.name, 'checkStepNamesFit');
});

// ---- Line captions and design-check badges (T02) ----
// At fit the captions and the "! N" badge drew their 11px text at 7px at 1440 and under 3px at 390.
// Below zoom 1 both counter-scale by --jv-caption-scale; the caption layout places captions at a
// stepped copy of that scale, so it re-runs a handful of times over a zoom, never once a frame.

test('T02: at every fit zoom a caption and a badge render at 11px or more on screen', () => {
  assert.equal(CAPTION_SCREEN_PX, 11);
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    const onScreen = CAPTION_PX * captionScale(z) * z;
    assert.ok(onScreen >= CAPTION_SCREEN_PX, `${where}: ${onScreen.toFixed(2)}px`);
    assert.ok(onScreen < CAPTION_SCREEN_PX + 0.2, `${where}: ${onScreen.toFixed(2)}px is no larger than it needs`);
  }
  // And at every zoom in between, however far out.
  for (let z = 0.05; z < 1.8; z += 0.0017) {
    assert.ok(CAPTION_PX * captionScale(z) * z >= CAPTION_SCREEN_PX - 1e-9, `zoom ${z}`);
  }
});

test('T02: from zoom 1 up nothing changes', () => {
  for (const z of [1, 1.2, 1.8, 4]) {
    assert.equal(captionScale(z), 1, `zoom ${z}`);
    assert.equal(captionLayoutScale(z), 1, `zoom ${z}`);
  }
  // A zoom that is not a number is read as 1.
  for (const z of [NaN, 0, -1]) assert.equal(captionScale(z), 1, String(z));
});

test('T02: the layout scale is never under the drawn one and moves in steps', () => {
  const seen = new Set();
  for (let z = 1; z >= 0.1; z -= 0.0007) {
    const drawn = captionScale(z);
    const laid = captionLayoutScale(z);
    assert.ok(laid >= drawn, `zoom ${z}: laid out at ${laid}, drawn at ${drawn}`);
    assert.ok(laid <= drawn * CAPTION_LAYOUT_STEP + 1e-3, `zoom ${z}: no more than a step larger`);
    seen.add(laid);
  }
  assert.ok(seen.size <= 30, `a zoom from 1 to 0.1 lays captions out ${seen.size} times`);
  assert.ok(seen.size >= 20, 'and still follows the zoom');
});

test('T02: captions and badges draw at the 11px the scale is worked out from', () => {
  const edge = read('src/components/canvas/edges/ConversionEdge.tsx');
  const badge = read('src/components/canvas/DesignIssueBadge.tsx');
  assert.equal(CAPTION_PX, 11);
  assert.match(badge, /fontSize: 11,/);
  const pill = edge.slice(edge.indexOf('const caption = ('), edge.indexOf('{/* The line in words'));
  for (const m of pill.matchAll(/fontSize: ([^,\n]+)/g)) assert.match(m[1], /^'11px'$|^value === UNAVAILABLE \? '11px' : undefined$/, m[1]);
});

test('T02: a caption scales about its own centre, and the badge stays on its card corner', () => {
  const edge = read('src/components/canvas/edges/ConversionEdge.tsx');
  assert.match(edge, /transform: `translate\(\$\{captionX\}px,\$\{captionY\}px\) scale\(var\(--jv-caption-scale, 1\)\) translate\(-50%, -50%\)`,\n\s*transformOrigin: '0 0',/);
  assert.match(edge, /data-jv-caption-form=\{form\}/);
  assert.match(edge, /const form = fit\?\.form \?\? 'full';/);
  assert.equal((edge.match(/data-jv-caption-part="value"/g) || []).length, 1, 'one figure a compact caption keeps');
  for (const part of ['code', 'count', 'leak', 'loop']) assert.match(edge, new RegExp(`data-jv-caption-part="${part}"`));
  // The words stay whole in the pill's accessible name, whatever form is drawn.
  assert.match(edge, /aria-label=\{sentence\}/);
  const badge = read('src/components/canvas/DesignIssueBadge.tsx');
  assert.match(badge, /data-jv-design-badge=\{nodeId\}/);
  const css = read('src/index.css');
  const b = cssRule(css, '.react-flow [data-jv-design-badge]');
  assert.match(b, /scale: var\(--jv-caption-scale, 1\);/);
  assert.match(b, /transform-origin: 100% 100%;/, 'from its bottom-right corner, up off the step name');
  assert.match(cssRule(css, "[data-jv-caption-form='compact'] [data-jv-caption-part]:not([data-jv-caption-part='value'])"), /display: none;/);
  const hidden = cssRule(css, "[data-jv-caption-form='hidden']:not(:focus-within)");
  assert.match(hidden, /opacity: 0;/);
  assert.match(hidden, /scale: 0;/, 'no box a pointer could land on');
  assert.match(hidden, /pointer-events: none !important;/);
  assert.doesNotMatch(hidden, /display|visibility/, 'a hidden caption keeps its place in the tab order');
});

test('T02: the caption layout follows the stepped scale, not every zoom frame', () => {
  const src = read('src/components/canvas/EdgeLabelLayout.tsx');
  assert.match(src, /const scale = useStore\(s => captionLayoutScale\(s\.transform\[2\]\)\);/);
  assert.match(src, /placeEdgeLabels\(labels, \[\.\.\.obstaclesFor\(geometry, scale\), \.\.\.badges, \.\.\.overlays\(\)\], \{ scale \}\)/);
  assert.match(src, /\}, \[domNode, portal, key, lines, store, scale, badged\]\);/);
  // Badges are decided only zoomed out: from zoom 1 up their form is cleared, so zoom 1 is unchanged.
  assert.match(src, /if \(scale <= 1\) \{\n\s*delete el\.dataset\.jvBadgeForm;\n\s*return;\n\s*\}/);
  // At the scale they are drawn at, and re-decided once the map is still (the settle below).
  assert.match(src, /placeBadges\(requests, geometry, captionScale\(store\.getState\(\)\.transform\[2\]\)\)/);
  // Written straight onto the badge, so no card re-renders for it, and only when it changes.
  assert.match(src, /if \(el && el\.dataset\.jvBadgeForm !== p\.form\) el\.dataset\.jvBadgeForm = p\.form;/);
  assert.match(src, /if \(p\.box\) badges\.push\(p\.box\);/, 'captions keep clear of what each badge covers in its form');
  assert.doesNotMatch(src, /setState|useState<[^>]*Badge/, 'no React state for the badges');
});

test('T02: a badge with no room past fit is a dot or hidden, keeps its name and shows whole on focus', () => {
  const css = read('src/index.css');
  assert.match(cssRule(css, ".react-flow [data-jv-badge-form='full-right']"), /transform-origin: 0% 100%;/, 'up and right, from its bottom-left corner');
  const dot = cssRule(css, ".react-flow [data-jv-badge-form='dot']:not(:focus-visible)");
  assert.match(dot, /scale: calc\(var\(--jv-caption-scale, 1\) \* 0\.5\);/);
  assert.doesNotMatch(dot, /transform-origin/, 'on the same corner the whole badge grows from');
  // Its text is not drawn, and keeps its box, so the layout's measure of the badge does not change.
  assert.match(cssRule(css, ".react-flow [data-jv-badge-form='dot']:not(:focus-visible) [data-jv-badge-text]"), /visibility: hidden;/);
  const hidden = cssRule(css, ".react-flow [data-jv-badge-form='hidden']:not(:focus-visible)");
  assert.match(hidden, /opacity: 0;/);
  assert.match(hidden, /scale: 0;/);
  assert.match(hidden, /pointer-events: none !important;/);
  assert.doesNotMatch(hidden, /display|visibility/, 'a hidden badge keeps its place in the tab order');
  // Zoomed out, a card's own handles draw above its badge, so their hit circles keep the pointer.
  assert.match(cssRule(css, ".react-flow:not([data-jv-detail='full']) .react-flow__node .react-flow__handle"), /z-index: 6;/);
  const badge = read('src/components/canvas/DesignIssueBadge.tsx');
  assert.match(badge, /<span data-jv-badge-text="">! \{n\}<\/span>/);
  assert.match(badge, /zIndex: 5,/);
  assert.match(badge, /aria-label=\{`\$\{n\} design \$\{n === 1 \? 'check' : 'checks'\} on \$\{entry\.name\}`\}/, 'its name says the count in every form');
});

// ---- U02: at the phone's fit a name breaks only between words ----

test('U02: a zoomed-out step name breaks only between words, never inside one', () => {
  const css = read('src/index.css');
  const name = cssRule(css, '.jv-step-summary__name');
  // '/radia' over 'nce-' and 'Abando' over 'ned' read as neither word: overflow-wrap: anywhere
  // broke any word wider than what was left of its line.
  assert.match(name, /overflow-wrap: normal;/);
  assert.match(name, /word-break: normal;/);
  assert.match(name, /hyphens: none;/, 'no hyphen is invented inside a word either');
  // A word wider than its line keeps its line and ends in the ellipsis there.
  assert.match(name, /overflow: hidden;/);
  assert.match(name, /text-overflow: ellipsis;/);
  assert.match(name, /-webkit-line-clamp: 2;/, 'still two lines at most');
  // Nothing else that styles the name, its text or an address puts a mid-word break back.
  const rules = [...css.matchAll(/([^{}]*\.jv-step-summary__(?:name|text)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 4, 'the name, the address, the compact name and its text');
  for (const [, selector, body] of rules) {
    assert.doesNotMatch(body, /overflow-wrap: (anywhere|break-word)|word-break: (break-all|break-word)|line-break: anywhere|hyphens: auto/, selector.trim());
  }
});

test('U02: the compact name renders at 13px on screen, so a whole word fits a phone\'s card more often', () => {
  assert.equal(COMPACT_TITLE_SCREEN_PX, 13);
  for (const [where, z] of Object.entries(FIT_ZOOMS)) {
    const onScreen = renderedTitlePx(CARD_TITLE_PX * compactTitleScale(z), z);
    assert.ok(onScreen >= 13, `${where}: ${onScreen.toFixed(2)}px`);
    assert.ok(onScreen < 13 + 0.7, `${where}: ${onScreen.toFixed(2)}px, stepped no further than it needs`);
    // Smaller than the summary's name at the same zoom: the width is what a phone lacks.
    assert.ok(compactTitleScale(z) <= titleScale(z), where);
  }
  for (let z = 0.1; z < 1.8; z += 0.013) {
    const s = compactTitleScale(z);
    assert.equal(Math.round(s * 20), Math.round(s * 20 * 1e6) / 1e6, `zoom ${z}: in twentieths`);
    assert.ok(s >= 1);
  }
  assert.equal(compactTitleScale(1), 1, 'at zoom 1 nothing changes');
  const css = read('src/index.css');
  assert.match(
    cssRule(css, ".react-flow[data-jv-detail='compact'] .jv-step-summary__name"),
    /font-size: min\(calc\(13px \* var\(--jv-compact-title-scale, 1\)\), 43cqh\);/
  );
  // The summary level keeps its 14px name.
  assert.match(cssRule(css, '.jv-step-summary__name'), /font-size: min\(calc\(13px \* var\(--jv-title-scale, 1\)\), 30cqh\);/);
});
