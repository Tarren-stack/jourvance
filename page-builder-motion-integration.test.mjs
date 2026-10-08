// Page motion, where the editor meets the page (LANDING_BUILDER_MOTION.md sections 4 and 5). What
// these hold:
// - the editor reads theme.motion and props.reveal through the shared types, never through a local
//   cast written while the page half did not exist yet;
// - the canvas draws every reveal SETTLED: writeShadow gives each [data-jvb-reveal] section the class
//   the frame script gives a published section once it has scrolled in, so the canvas shows the
//   published page's resting state and a redraw never plays an entrance;
// - the selector and the class the canvas uses are the ones render.mjs and the frame script use.
// The browser half is the motion-canvas-settled step of scripts/builder-browser-check.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';
import { builderFrameScript } from './server/routes/publicBuilderScript.mjs';

const B = 'src/components/builder';
const read = f => readFileSync(f, 'utf8');
const canvas = read(`${B}/BuilderCanvas.tsx`);

function twoSectionDoc(motion) {
  let doc = createEmptyPage(motion ? { motion } : {});
  for (let i = 0; i < 2; i++) {
    const r = insertNode(doc, null, doc.sections.length, createNode('section'));
    assert.ok(r.ok, r.reason);
    doc = r.doc;
  }
  return doc;
}

describe('the editor reads motion through the shared types', () => {
  it('no builder component casts theme or props to reach motion or reveal', () => {
    const files = readdirSync(B).filter(f => /\.tsx?$/.test(f));
    assert.ok(files.length >= 10, `only ${files.length} builder files found`);
    for (const f of files) {
      const src = read(`${B}/${f}`);
      assert.doesNotMatch(src, /as unknown as \{ (motion|reveal)\?/, `${f} still reads motion or reveal through a local cast`);
    }
  });
  it('the theme panel and the inspector name ThemeMotion and read the key straight off the theme', () => {
    const panel = read(`${B}/BuilderThemePanel.tsx`);
    const inspector = read(`${B}/BuilderInspector.tsx`);
    assert.match(panel, /const motion: ThemeMotion = theme\.motion \?\? 'none';/);
    assert.match(inspector, /function pageMotionOf\(doc: BuilderDoc\): ThemeMotion \{\n\s+return doc\.theme\.motion \?\? 'none';/);
    assert.match(inspector, /\(node as BuilderSection\)\.props\?\.reveal \?\? 'inherit'/);
    assert.match(canvas, /const level = docRef\.current\.theme\.motion;/);
  });
});

describe('the canvas draws every reveal settled', () => {
  it('writeShadow adds the revealed class to every reveal section before the content reaches the shadow root', () => {
    const start = canvas.indexOf('export function writeShadow(');
    const end = canvas.indexOf('root.replaceChildren(style, content);', start);
    assert.ok(start > 0 && end > start, 'writeShadow and its replaceChildren are there');
    const body = canvas.slice(start, end);
    assert.match(body, /content\.querySelectorAll\(REVEAL_SELECTOR\)\.forEach\(el => el\.classList\.add\(REVEALED_CLASS\)\);/);
  });
  it('the selector and the class are the page\'s own', () => {
    assert.match(canvas, /export const REVEAL_SELECTOR = '\[data-jvb-reveal\]';/);
    assert.match(canvas, /export const REVEALED_CLASS = 'jvb-in';/);
    const script = builderFrameScript({ slug: 's' });
    assert.ok(script.includes("querySelectorAll('[data-jvb-reveal]')"), 'the frame script finds sections by [data-jvb-reveal]');
    assert.ok(script.includes("classList.add('jvb-in')"), 'the frame script reveals a section with jvb-in');
    const { html, css } = render(twoSectionDoc('subtle'), { device: 'desktop' });
    assert.match(html, /<section [^>]*data-jvb-reveal="rise">/);
    assert.ok(css.includes('#jvb-root.jvb-motion-on [data-jvb-reveal]:not(.jvb-in){opacity:0}'), 'the hidden state is keyed on the same class');
  });
  it('the canvas css for a subtle page carries the motion custom properties on the root rule', () => {
    const { css } = render(twoSectionDoc('subtle'), { device: 'tablet' });
    const line1 = css.split('\n')[0];
    assert.ok(line1.startsWith('#jvb-root{'), line1.slice(0, 40));
    assert.ok(line1.includes('--jvb-motion-duration:240ms;--jvb-motion-fast:180ms;--jvb-motion-distance:10px'), line1);
  });
  it('a motion-less canvas has no reveal to settle', () => {
    const { html } = render(twoSectionDoc(null), { device: 'desktop' });
    assert.equal(html.includes('data-jvb-reveal'), false);
  });
});
