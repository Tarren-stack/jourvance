// U01: a press on a card body selects the card and never starts a line, and the notice a line
// waiting for its second dot shows never covers the selected card.
//
// T03 slid each handle's hit area back into its own card, so at the phone's fit an input reached
// about 21px and an output about 17px into a 64px card. On a touch screen the browser snaps a tap
// onto a target that near, and 12 of 18 off-centre taps on a card armed a line; the connecting
// notice then sat over 82 to 90% of the card the tap had just selected. The in-card reach is now
// capped (HANDLE_IN_REACH_*_SCREEN_PX in src/lib/semanticZoom.ts: 8px with a mouse, nothing past
// the dot on a coarse pointer), a touch the browser snaps from the card body onto a dot reaches no
// handle (touchOffDot in JourneyCanvas.tsx), and the notice moves off the selected card and the map's
// controls, docking at the window's foot when a phone's strip of map has no room (noticePlace in
// src/lib/tapReveal.ts). The maths is pinned by behaviour here, with the geometry measured at
// 390x844 on a touch screen; the CSS and the wiring are pinned by source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  HANDLE_DOT_PX,
  HANDLE_HIT_SCREEN_PX,
  HANDLE_IN_REACH_FINE_SCREEN_PX,
  HANDLE_IN_REACH_COARSE_SCREEN_PX,
  HANDLE_OUT_REACH_SOURCE_FLOW_PX,
  HANDLE_OUT_REACH_TARGET_FLOW_PX,
  COARSE_POINTER_QUERY,
  handleHitPx,
  handleHitReach,
  handleInReachCap,
  handleTargetsTight
} = await import('./src/lib/semanticZoom.ts');
const { noticePlace, NOTICE_DOCK_GAP } = await import('./src/lib/tapReveal.ts');

const read = f => fs.readFileSync(f, 'utf8');
const cssRule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? null : css.slice(at, css.indexOf('}', at) + 1);
};
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The fit zooms measured in Chrome (390x844, 768x1024, 1024x768, 1440x900), and the whole zoom range.
const FIT_ZOOMS = [0.235, 0.245, 0.247, 0.255, 0.4, 0.415, 0.62, 0.64];
const ZOOMS = [0.1, 0.17, ...FIT_ZOOMS, 0.85, 1, 1.2, 1.6, 1.8];

test('with a mouse a hit area reaches at most 8px into its card, and past the dot on a finger not at all', () => {
  assert.equal(HANDLE_IN_REACH_FINE_SCREEN_PX, 8);
  assert.equal(HANDLE_IN_REACH_COARSE_SCREEN_PX, 0);
  for (const z of ZOOMS) {
    for (const kind of ['source', 'target']) {
      const fine = handleHitReach(z, kind, 'fine');
      const coarse = handleHitReach(z, kind, 'coarse');
      const dotHalf = (HANDLE_DOT_PX / 2) * z;
      // The zoom variable is rounded down to 0.005, so the cap reads a hair over 8px on screen.
      assert.ok(fine.in * z <= Math.max(HANDLE_IN_REACH_FINE_SCREEN_PX * 1.03, dotHalf) + 1e-9, `zoom ${z} ${kind}: ${(fine.in * z).toFixed(2)}px in with a mouse`);
      assert.equal(coarse.in, HANDLE_DOT_PX / 2, `zoom ${z} ${kind}: only the dot on a coarse pointer`);
      // The outward reach and the width along the edge are T03's, whatever the pointer.
      const d = handleHitPx(z);
      const out = Math.min(d / 2, kind === 'source' ? HANDLE_OUT_REACH_SOURCE_FLOW_PX : HANDLE_OUT_REACH_TARGET_FLOW_PX);
      for (const r of [fine, coarse]) {
        assert.equal(r.out, out, `zoom ${z} ${kind}: out`);
        assert.equal(r.across, d, `zoom ${z} ${kind}: across`);
        assert.ok(r.across * z >= HANDLE_HIT_SCREEN_PX - 1e-9 || d === 104, `zoom ${z} ${kind}: 24px across the dot`);
      }
    }
  }
  // The cap is what holds it: at the phone's fit the T03 slide alone reached 21px into the card.
  const z = 0.247;
  const d = handleHitPx(z);
  assert.ok((d - HANDLE_OUT_REACH_TARGET_FLOW_PX) * z > 20, 'the control: the old input reach');
  assert.ok(handleHitReach(z, 'target').in * z < 8.2);
  // The dot itself is never cut: from zoom 1.6 up the dot alone reaches past 8px.
  assert.equal(handleHitReach(1.8, 'target', 'fine').in, HANDLE_DOT_PX / 2);
  assert.ok(Math.abs(handleInReachCap(0.247, 'fine') - 8 / 0.245) < 1e-9, 'from the rounded zoom, as index.css reads --jv-zoom');
  assert.equal(handleInReachCap(0.247, 'coarse'), 0);
});

test('the stylesheet caps the in-card reach by pointer and keeps the T03 outward reach', () => {
  const css = read('src/index.css');
  const flow = cssRule(css, '.react-flow');
  assert.ok(flow, '.react-flow carries the cap');
  assert.ok(flow.includes(`--jv-hit-in-max: calc(${HANDLE_IN_REACH_FINE_SCREEN_PX}px / var(--jv-zoom, 1));`), flow);
  const media = css.indexOf(`@media ${COARSE_POINTER_QUERY} {`);
  assert.ok(media >= 0, `the coarse rule sits under ${COARSE_POINTER_QUERY}`);
  assert.ok(cssRule(css.slice(media), '  .react-flow').includes(`--jv-hit-in-max: ${HANDLE_IN_REACH_COARSE_SCREEN_PX}px;`));
  const base = cssRule(css, '.custom-handle::before');
  assert.ok(base.includes('--jv-hit-in: min(var(--jv-handle-hit, 24px) / 2 + var(--jv-hit-slide), var(--jv-hit-in-max, 8px));'), base);
  assert.ok(base.includes('border-radius: min(calc(var(--jv-handle-hit, 24px) / 2 - var(--jv-hit-slide)), var(--jv-hit-in));'), 'no corner rounds past the shorter reach');
  // Still grown out of the dot's own box, so neither the dot nor where a line attaches moves.
  assert.match(base, /inset: calc\(\(100% - var\(--jv-handle-hit, 24px\)\) \/ 2\);/);
  assert.doesNotMatch(base, /background|border:|transform|translate|scale/);
  const edge = 'calc((100% - var(--jv-handle-hit, 24px)) / 2';
  for (const [pos, outSide, inSide] of [['right', 'right', 'left'], ['left', 'left', 'right'], ['bottom', 'bottom', 'top'], ['top', 'top', 'bottom']]) {
    const rule = cssRule(css, `.custom-handle.react-flow__handle-${pos}::before`);
    assert.ok(rule.includes(`${outSide}: ${edge} + var(--jv-hit-slide));`), `${pos}: out of the card as T03 left it`);
    assert.ok(rule.includes(`${inSide}: calc(50% - var(--jv-hit-in));`), `${pos}: into the card no further than the cap`);
    assert.ok(!rule.includes(`${inSide}: ${edge} - var(--jv-hit-slide));`), `${pos}: the old uncapped reach is gone`);
  }
  // React Flow's own classes pick the side, so "custom-handle" stays the only className a card sets.
  for (const card of ['AdNode.tsx', 'PageNode.tsx', 'FormNode.tsx', 'SequenceNode.tsx', 'ThankYouNode.tsx', 'UpsellNode.tsx', 'AbSplitNode.tsx']) {
    for (const m of read(`src/components/canvas/nodes/${card}`).matchAll(/<Handle[\s\S]*?\/>/g)) assert.match(m[0], /className="custom-handle"\n/, card);
  }
});

test('on a touch screen zoomed out, the connecting notice says to zoom in', () => {
  assert.equal(handleTargetsTight(0.247, 'coarse'), true);
  assert.equal(handleTargetsTight(0.64, 'coarse'), true);
  assert.equal(handleTargetsTight(1, 'coarse'), false);
  assert.equal(handleTargetsTight(1.8, 'coarse'), false);
  for (const z of ZOOMS) assert.equal(handleTargetsTight(z, 'fine'), false, `never with a mouse (zoom ${z})`);
  const canvas = read('src/components/canvas/JourneyCanvas.tsx');
  const show = canvas.slice(canvas.indexOf('const showConnectingNotice = useCallback('), canvas.indexOf('[nodeMap]', canvas.indexOf('const showConnectingNotice = useCallback(')));
  assert.match(show, /window\.matchMedia\(COARSE_POINTER_QUERY\)\.matches/);
  assert.match(show, /handleTargetsTight\(flowRef\.current\?\.getZoom\(\) \?\? 1, coarse \? 'coarse' : 'fine'\)/);
  assert.match(show, /\$\{tight \? ' Zoom in if a dot is too small to tap\.' : ''\}/);
  assert.match(show, /Choose a dot on another step to finish the line \$\{way\} \$\{name\}, or press Escape to cancel\./);
  assert.ok(!/—| – /.test(show));
});

// 390x844 on a touch screen (hasTouch, isMobile) after a tap on a dot, once the T06 pan has settled
// (r5/geom.mjs). The connecting notice is 358 wide and, with "Zoom in if a dot is too small to tap.",
// four lines (91px) or, naming a long step, five (109px). Home is 116 above the map's foot.
const VIEW = { height: 844 };
const noticeOf = h => box(16, 0, 374, h);
const at = (top, n) => box(n.left, top, n.right, top + (n.bottom - n.top));
// The default map, the landing page: the strip runs 216 to 426 and the zoom controls and minimap
// sit across its foot.
const DEF = {
  band: box(0, 216, 390, 426),
  card: box(107, 256, 259, 346),
  home: 220,
  obstacles: [box(15, 331, 43, 411), box(235, 321, 375, 411)]
};
// bp6, the step panel has a Show row, so the strip is 172px: cart recovery and the landing page.
const BP6_CONTROLS = [box(15, 293, 43, 373), box(235, 283, 375, 373)];
const BP6_CART = { band: box(0, 216, 390, 388), card: box(60, 235, 259, 311), home: 163, obstacles: BP6_CONTROLS };
const BP6_PAGE = { band: box(0, 216, 390, 388), card: box(131, 251, 259, 353), home: 182, obstacles: BP6_CONTROLS };

test('on a phone the notice covers neither the card, its pills nor the zoom controls: it docks at the window\'s foot', () => {
  for (const [name, g, h] of [['default page', DEF, 91], ['bp6 cart', BP6_CART, 109], ['bp6 cart, four lines', BP6_CART, 91], ['bp6 page', BP6_PAGE, 91], ['bp6 page, five lines', BP6_PAGE, 109]]) {
    const n = noticeOf(h);
    // The regression: in the strip, every place meets the card and pills or the controls.
    for (let top = g.band.top; top + h <= g.band.bottom; top++) {
      const b = at(top, n);
      assert.ok(meets(b, g.card) || g.obstacles.some(o => meets(b, o)), `${name}: ${top} would have fitted`);
    }
    const p = noticePlace(n, g.home, g.band, g.card, g.obstacles, VIEW);
    assert.equal(p.docked, true, name);
    assert.equal(p.top, VIEW.height - NOTICE_DOCK_GAP - h, `${name}: ${NOTICE_DOCK_GAP}px above the window's edge`);
    assert.ok(p.top >= g.band.bottom, `${name}: wholly under the strip`);
    const b = at(p.top, n);
    assert.ok(!meets(b, g.card) && !g.obstacles.some(o => meets(b, o)), name);
  }
});

test('the notice keeps a place in the strip clear of the card and the controls whenever there is one', () => {
  // A taller strip (the panel scrolled part way, or a taller phone), controls across its foot.
  const tall = { band: box(0, 216, 390, 620), home: 620 - 116 - 91, obstacles: [box(15, 525, 43, 605), box(235, 515, 375, 605)] };
  const n = noticeOf(91);
  // Home clear of the card: kept.
  assert.deepEqual(noticePlace(n, tall.home, tall.band, box(107, 230, 259, 320), tall.obstacles, VIEW), { top: tall.home, docked: false });
  // Home on the card, and under it the minimap: just over the card.
  const card = box(107, 360, 259, 450);
  assert.ok(meets(at(tall.home, n), card) && meets(at(card.bottom + 8, n), tall.obstacles[1]), 'the control');
  assert.deepEqual(noticePlace(n, tall.home, tall.band, card, tall.obstacles, VIEW), { top: card.top - 8 - 91, docked: false });
  // Wherever the card sits, the notice never covers it or a control: in the strip, or docked.
  let inStrip = 0;
  let docked = 0;
  for (const g of [DEF, tall]) {
    for (const h of [54, 72, 91, 109]) {
      const note = noticeOf(h);
      for (let y = g.band.top; y + 90 <= g.band.bottom; y += 3) {
        const c = box(107, y, 259, y + 90);
        // Home, as the canvas works it out: 116 above the map's foot, whatever the notice's height.
        const q = noticePlace(note, g.band.bottom - 116 - h, g.band, c, g.obstacles, VIEW);
        const b = at(q.top, note);
        assert.ok(!meets(b, c), `h ${h}, card at ${y}: notice at ${q.top} meets the card`);
        assert.ok(!g.obstacles.some(o => meets(b, o)), `h ${h}, card at ${y}: notice at ${q.top} meets a control`);
        if (q.docked) {
          docked++;
          assert.ok(q.top >= g.band.bottom, `h ${h}, card at ${y}: docked over the strip`);
        } else {
          inStrip++;
          assert.ok(q.top >= g.band.top && q.top + h <= g.band.bottom, `h ${h}, card at ${y}: off the strip`);
        }
      }
    }
  }
  assert.ok(inStrip > 10 && docked > 10, `${inStrip} in the strip, ${docked} docked`);
});

test('the notice stays home when home is clear, and never docks on a map that fills the window', () => {
  // Desktop, side by side: the card is well above the home spot.
  const desk = box(0, 60, 1000, 900);
  const deskNotice = box(280, 700, 720, 736);
  const deskView = { height: 900 };
  assert.deepEqual(noticePlace(deskNotice, 700, desk, box(400, 200, 560, 360), [], deskView), { top: 700, docked: false });
  // No selected card, or no strip on screen: home.
  assert.deepEqual(noticePlace(noticeOf(91), DEF.home, DEF.band, null, [], VIEW), { top: DEF.home, docked: false });
  assert.deepEqual(noticePlace(noticeOf(91), DEF.home, null, DEF.card, [], VIEW), { top: DEF.home, docked: false });
  // A card low in a desktop map moves the notice above it rather than over it, clear of the tools.
  const low = box(400, 640, 560, 780);
  const tools = box(700, 68, 990, 100);
  const t = noticePlace(deskNotice, 700, desk, low, [tools], deskView);
  assert.equal(t.docked, false);
  assert.ok(!meets(at(t.top, deskNotice), low) && !meets(at(t.top, deskNotice), tools) && t.top >= desk.top, `desktop: ${t.top}`);
  // Home clear of the card but hidden above the strip (under the header) is not kept.
  const hidden = noticePlace(noticeOf(91), BP6_PAGE.home, BP6_PAGE.band, box(131, 300, 259, 380), [], VIEW);
  assert.ok(!meets(at(BP6_PAGE.home, noticeOf(91)), box(131, 300, 259, 380)), 'the control: home is clear of this card');
  assert.ok(hidden.top >= BP6_PAGE.band.top, `not left under the header: ${hidden.top}`);
  // No room under the strip either: a place clear of the card, then the least of the card covered.
  const full = { height: 426 };
  const q = noticePlace(noticeOf(91), DEF.home, DEF.band, DEF.card, DEF.obstacles, full);
  assert.equal(q.docked, false);
  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  assert.ok(area(at(q.top, noticeOf(91)), DEF.card) <= area(at(DEF.home, noticeOf(91)), DEF.card));
  const shortBand = box(0, 216, 390, 330);
  const cramped = box(131, 240, 259, 300);
  const s = noticePlace(noticeOf(72), 250, shortBand, cramped, [], { height: 330 });
  assert.ok(area(at(s.top, noticeOf(72)), cramped) < area(at(250, noticeOf(72)), cramped), 'less of the card than home when it can');
});

test('the canvas places the notice from the measured card, strip, controls and window, and docks it fixed', () => {
  const canvas = read('src/components/canvas/JourneyCanvas.tsx');
  assert.match(canvas, /import \{ mapToolsCompact, noticePlace, revealShift,[^}]*NOTICE_DOCK_GAP/);
  const place = canvas.slice(canvas.indexOf('const placeNotice = useCallback('), canvas.indexOf('const scheduleNotice = useCallback('));
  assert.match(place, /visibleBand\(rootBox, scroller \? scroller\.getBoundingClientRect\(\) : null/);
  assert.match(place, /unionBox\(\[card, \.\.\.card\.querySelectorAll\('\.jv-add-next'\)\]/, 'the + Before / + Next row counts as the card');
  assert.match(place, /mapOverlayRects\(root,/);
  assert.match(place, /const home = rootBox\.bottom - 116 - drawn\.height;/);
  assert.match(place, /noticePlace\(drawn, home, band, target, obstacles, \{ height: window\.innerHeight \}\)/);
  assert.match(place, /place\.docked \? 'docked'/);
  // Home is still the spot above the controls; a move sets a top, and a dock pins it to the window.
  assert.match(canvas, /position: noticeAt === 'docked' \? 'fixed' : 'absolute',/);
  assert.match(canvas, /\.\.\.\(noticeAt === null \? \{ bottom: 116 \} : noticeAt === 'docked' \? \{ bottom: NOTICE_DOCK_GAP \} : \{ top: noticeAt \}\),/);
  assert.match(canvas, /<div\s+ref=\{noticeBoxRef\}/);
  // Placed again when the view, a card or the page's scroll moves, and after the T06 pan.
  assert.match(canvas, /<MapMoved onMove=\{scheduleNotice\} \/>/);
  assert.match(canvas, /window\.addEventListener\('scroll', scheduleNotice, \{ capture: true, passive: true \}\)/);
  assert.match(canvas, /new MutationObserver\(scheduleNotice\)/);
  // The connecting notice still lets taps through to the map beneath it.
  assert.match(canvas, /pointerEvents: ruleNotice\.tone === 'connecting' \? 'none' : 'auto'/);
});

test('a touch the browser snaps from a card body onto a dot starts no line and arms none', () => {
  const canvas = read('src/components/canvas/JourneyCanvas.tsx');
  const off = canvas.slice(canvas.indexOf('function touchOffDot('), canvas.indexOf('}', canvas.indexOf('return within(', canvas.indexOf('function touchOffDot('))) + 1);
  // On the card and off the drawn dot, measured at the finger's own point.
  assert.match(off, /handle\.closest\('\.react-flow__node'\)/);
  assert.match(off, /return within\(card\.getBoundingClientRect\(\)\) && !within\(handle\.getBoundingClientRect\(\)\);/);
  const guard = canvas.slice(canvas.indexOf('function useTouchSnapGuard('), canvas.indexOf('function ClickConnectCancel('));
  assert.ok(guard.length > 0, 'the guard sits ahead of ClickConnectCancel');
  // React Flow starts a drawn line on the handle's touchstart: stopped at the window, before it.
  assert.match(guard, /window\.addEventListener\('touchstart', onTouch, \{ capture: true, passive: true \}\)/);
  assert.match(guard, /touchOffDot\(handle, point\.clientX, point\.clientY\)/);
  assert.match(guard, /if \(offDot\) e\.stopPropagation\(\);/);
  assert.match(guard, /window\.removeEventListener\('touchstart', onTouch, \{ capture: true \}\)/);
  // A mouse or pen press forgets the touch, so neither is ever refused.
  assert.match(guard, /if \(e\.pointerType !== 'touch'\) press\.current = null;/);
  // Only a line armed on that same handle, by that touch's tap.
  assert.match(guard, /dot\.getAttribute\('data-nodeid'\) === from\.nodeId/);
  assert.match(guard, /dot\.classList\.contains\(from\.type\)/);
  assert.match(guard, /\(dot\.getAttribute\('data-handleid'\) \?\? null\) === from\.id/);
  // The notice drops it unsaid, after React Flow's own update; the armed payload names the handle.
  const show = canvas.slice(canvas.indexOf('const showConnectingNotice = useCallback('), canvas.indexOf('[nodeMap]', canvas.indexOf('const showConnectingNotice = useCallback(')));
  assert.match(show, /if \(snappedFromCard\(from\)\) \{\s*queueMicrotask\(\(\) => cancelClickConnect\.current\(\)\);\s*return;/);
  assert.match(canvas, /const snappedFromCard = useTouchSnapGuard\(\);/);
  assert.match(canvas, /if \(now\) armed\.current\(\{ nodeId: now\.nodeId, type: now\.type, id: now\.id \?\? null \}\);/);
});
