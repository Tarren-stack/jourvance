import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DESIGN_WIDTHS, MIN_CANVAS_SCALE, canvasScale } from './src/components/builder/canvasMarkup.ts';

// The canvas draws a desktop or tablet page at its design width and scales it down into the frame
// (Wave 2 polish): at 1440 the frame is about 790px wide, and a page laid out in 790px is a tablet
// page, so the desktop view was never drawn as desktop. The maths is here; scripts/builder-browser-check.mjs
// measures the 1280px page root, the 2px outline fit and the 390px window in real Chrome.

const canvas = fs.readFileSync('src/components/builder/BuilderCanvas.tsx', 'utf8');

describe('canvasScale', () => {
  test('desktop is drawn at 1280, tablet at 1024, mobile at 390', () => {
    assert.deepEqual({ ...DESIGN_WIDTHS }, { desktop: 1280, tablet: 1024, mobile: 390 });
  });

  test('desktop and tablet scale down to the room, and never up', () => {
    assert.equal(canvasScale('desktop', 1280), 1);
    assert.equal(canvasScale('desktop', 2000), 1, 'a page is not blown up');
    assert.equal(canvasScale('desktop', 640), 0.5);
    assert.equal(canvasScale('desktop', 792), 0.6188);
    assert.equal(canvasScale('tablet', 1024), 1);
    assert.equal(canvasScale('tablet', 512), 0.5);
    assert.equal(canvasScale('tablet', 792), 0.7734);
  });

  test('mobile is drawn as it is, whatever the room', () => {
    for (const room of [0, 100, 342, 390, 900, 3000]) assert.equal(canvasScale('mobile', room), 1);
  });

  test('a room that is not known yet, or nonsense, draws at 1; a tiny room stops at the floor', () => {
    for (const room of [0, -5, NaN, Infinity, undefined]) assert.equal(canvasScale('desktop', room), 1, String(room));
    assert.equal(canvasScale('desktop', 10), MIN_CANVAS_SCALE);
    assert.equal(canvasScale('desktop', 342), 0.2672, 'the 390px window: 390 less the frame padding');
  });
});

describe('the canvas applies the scale where the overlays can follow it', () => {
  test('the page sits in a transformed layer and the editor marks sit OUTSIDE it, in a box the size of the scaled page', () => {
    assert.match(canvas, /data-canvas-layer=""/);
    assert.match(canvas, /transformOrigin: '0 0',\s*transform: scale < 1 \? `scale\(\$\{scale\}\)` : undefined/);
    assert.match(canvas, /data-canvas-scale=\{scale\}/);
    const layerAt = canvas.indexOf('data-canvas-layer=""');
    const marksAt = canvas.indexOf('{showMarks && (');
    assert.ok(layerAt > 0 && marksAt > layerAt, 'the marks follow the layer');
    // The layer closes before the marks open: the marks are its sibling, so they are never scaled twice.
    const between = canvas.slice(layerAt, marksAt);
    const opens = (between.match(/<div\b/g) || []).length;
    const closes = (between.match(/<\/div>/g) || []).length;
    assert.equal(closes, opens, 'every div opened in the layer is closed before the marks');
    assert.match(canvas, /width: `\$\{frameWidth\}px`/, 'the frame is the width of the scaled page');
    assert.match(canvas, /height: layerHeight > 0 \? `\$\{Math\.round\(layerHeight \* scale \* 100\) \/ 100\}px`/, 'and as tall as the scaled page, because a transform does not change layout');
  });

  test('every box the marks use is measured from getBoundingClientRect against the frame, which already reports the scaled box', () => {
    const measure = canvas.slice(canvas.indexOf('const measure = useCallback'), canvas.indexOf('// Draw the page.'));
    assert.match(measure, /frameRef\.current/);
    assert.match(measure, /frame\.getBoundingClientRect\(\)/);
    assert.match(measure, /el\.getBoundingClientRect\(\)/);
    assert.doesNotMatch(measure, /layerRef/, 'not against the transformed layer');
    assert.doesNotMatch(measure, /\/\s*scale|\*\s*scale/, 'no scale to divide out');
  });

  test('a change of scale or of the page height measures the boxes again', () => {
    assert.match(canvas, /\}, \[device, scale, layerHeight, zones, selectedId, measureTick, measure\]\);/);
    assert.match(canvas, /canvasScale\(device, room\)/);
    assert.match(canvas, /scroller\.clientWidth - FRAME_PAD \* 2/);
  });
});

describe('the selection toolbar', () => {
  test('stays mounted during a drag (its grip is the drag source) and is only hidden', () => {
    // Found in Chrome: the toolbar was removed when a drag began, the drag lost the block it carried
    // ("Block dropped on ..."), and a drag from the canvas grip moved nothing.
    assert.doesNotMatch(canvas, /\{!zones && \(\s*<div\s+ref=\{toolbarRef\}/);
    assert.match(canvas, /visibility: zones \? 'hidden' : 'visible'/);
    assert.match(canvas, /pointerEvents: zones \? 'none' : 'auto'/);
  });

  test('keeps inside the frame, and never covers the text of a short block it belongs to', () => {
    assert.match(canvas, /left: Math\.max\(0, Math\.min\(selectedRect\.left, frameWidth - toolbarWidth\)\)/);
    assert.match(canvas, /selectedRect\.top >= 36 \? selectedRect\.top - 34 : selectedRect\.height < 80 \? selectedRect\.top \+ selectedRect\.height \+ 4 : selectedRect\.top \+ 4/);
  });
});
