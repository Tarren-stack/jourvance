// bottomSurfaceCount: the counter behind data-jv-bottom-surface (src/lib/bottomSurface.ts).
// The source pins at the end tie the helper to its three surfaces, the CSS and the viewport meta.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bottomSurfaceCount, BOTTOM_SURFACE_ATTR } from './src/lib/bottomSurface.ts';

const fake = (initial = null) => {
  const attrs = new Map(initial === null ? [] : [[BOTTOM_SURFACE_ATTR, initial]]);
  return {
    attrs,
    getAttribute: n => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => attrs.set(n, v),
    removeAttribute: n => attrs.delete(n)
  };
};

test('the first surface sets the attribute to "1", the second to "2"', () => {
  const el = fake();
  assert.equal(bottomSurfaceCount(el, 1), 1);
  assert.equal(el.getAttribute(BOTTOM_SURFACE_ATTR), '1');
  assert.equal(bottomSurfaceCount(el, 1), 2);
  assert.equal(el.getAttribute(BOTTOM_SURFACE_ATTR), '2');
});

test('one surface closing does not clear another', () => {
  const el = fake('2');
  assert.equal(bottomSurfaceCount(el, -1), 1);
  assert.equal(el.getAttribute(BOTTOM_SURFACE_ATTR), '1');
});

test('zero removes the attribute, and it never goes below zero', () => {
  const el = fake('1');
  assert.equal(bottomSurfaceCount(el, -1), 0);
  assert.equal(el.attrs.has(BOTTOM_SURFACE_ATTR), false);
  assert.equal(bottomSurfaceCount(el, -1), 0);
  assert.equal(el.attrs.has(BOTTOM_SURFACE_ATTR), false);
});

test('a garbage value reads as zero', () => {
  const el = fake('banana');
  assert.equal(bottomSurfaceCount(el, 1), 1);
  assert.equal(el.getAttribute(BOTTOM_SURFACE_ATTR), '1');
});

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('the three surfaces call useBottomSurface', () => {
  for (const f of ['./src/components/drawers/EdgeInspector.tsx', './src/components/drawers/StepDock.tsx', './src/components/canvas/JourneyCanvas.tsx']) {
    assert.match(read(f), /useBottomSurface\(/, f);
  }
  assert.match(read('./src/components/drawers/StepDock.tsx'), /useBottomSurface\(stacked\)/);
  assert.doesNotMatch(read('./src/components/drawers/StepDock.tsx'), /useBottomSurface\(true\)/);
});

test('the bubble CSS reads the attribute and the viewport meta lets the keyboard resize content', () => {
  assert.match(read('./src/index.css'), /html\[data-jv-bottom-surface\] \.jv-assistant-bubble/);
  assert.match(read('./index.html'), /<meta name="viewport" content="width=device-width, initial-scale=1\.0, interactive-widget=resizes-content" \/>/);
});
