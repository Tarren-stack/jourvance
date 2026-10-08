// Editor motion, fix round 3 (LANDING_BUILDER_MOTION.md section 4). Source pins, read from the files:
// - "Reduce motion in the editor" (and the device's own setting) reaches the canvas shadow root. The
//   light-DOM rule `.jv-builder[data-reduce-motion] *` cannot cross the shadow boundary, so the drawn
//   page's button and link transitions and its keyframes still played there. The host carries
//   data-jvbe-motion-off whenever the editor's motion is off, and writeShadow writes a rule keyed on it
//   LAST into the shadow root, turning every transition and animation of the drawn page off.
// - Preview motion is said as well as shown: the canvas reports the run's start and end, and the shell
//   speaks "Previewing <level> motion" and "Preview finished" in its one polite live region.
// The behaviour is driven in Chrome by scripts/builder-browser-check.mjs (motion-preview,
// motion-reduced-os and motion-reduced-pref).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const B = './src/components/builder';
const canvas = read(`${B}/BuilderCanvas.tsx`);
const shell = read(`${B}/BuilderShell.tsx`);

/** The JSX opening tag that holds `marker`, braces and strings skipped. */
function tagAround(src, marker) {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${marker} is in the file`);
  const start = src.lastIndexOf('<', at);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`no end to the tag around ${marker}`);
}

describe('the editor preference reaches the canvas shadow root', () => {
  const ruleAt = canvas.indexOf('export const CANVAS_MOTION_OFF_CSS = ');
  const rule = ruleAt > 0 ? canvas.slice(ruleAt, canvas.indexOf('\n', ruleAt)) : '';

  it('a kill rule keyed on the host attribute covers the root, every element in it and their pseudo-elements', () => {
    assert.ok(rule, 'CANVAS_MOTION_OFF_CSS is exported');
    const css = rule.slice(rule.indexOf("'") + 1, rule.lastIndexOf("'"));
    const [selectors, body] = css.split('{');
    assert.deepEqual(selectors.split(','), [
      ':host([data-jvbe-motion-off]) #jvb-root',
      ':host([data-jvbe-motion-off]) #jvb-root *',
      ':host([data-jvbe-motion-off]) #jvb-root *::before',
      ':host([data-jvbe-motion-off]) #jvb-root *::after'
    ]);
    assert.equal(body, 'animation:none!important;transition:none!important}');
  });

  it('writeShadow writes it last into the shadow root, after the editor CSS and the page\'s own CSS', () => {
    const start = canvas.indexOf('export function writeShadow(');
    const body = canvas.slice(start, canvas.indexOf('root.replaceChildren(style, content);', start));
    assert.match(body, /style\.textContent = `\$\{EDITOR_CSS\}\\n\$\{css\}\\n\$\{CANVAS_MOTION_OFF_CSS\}`;/);
  });

  it('the canvas host carries data-jvbe-motion-off exactly when the editor\'s motion is off', () => {
    const host = tagAround(canvas, 'ref={hostRef}');
    assert.match(host, /\sdata-jvb-canvas-host=""/);
    assert.match(host, /\sdata-jvbe-motion-off=\{motionOff \? '' : undefined\}/);
  });

  it('motionOff is the shell\'s reduceMotion: the device asks for less, or the preference is on', () => {
    assert.match(shell, /const reduceMotion = editorMotionOff\(osReduce, reducePref\);/);
    const tag = tagAround(shell, 'motionPreview={motionPreview}');
    assert.ok(tag.startsWith('<BuilderCanvas'), tag.slice(0, 40));
    assert.match(tag, /\smotionOff=\{reduceMotion\}/);
  });
});

describe('Preview motion is said, not only shown', () => {
  const start = canvas.indexOf('const onMotionPreviewRef = useRef(onMotionPreview);');
  const effect = start > 0 ? canvas.slice(start, canvas.indexOf('}, [motionPreview?.seq]);', start)) : '';

  it('the canvas reports the start once every section is playing, and the end when the hidden state comes off', () => {
    assert.ok(effect, 'the preview effect is there, with its callback held in a ref');
    assert.match(canvas, /onMotionPreviewRef\.current = onMotionPreview;/);
    const playing = effect.indexOf("sections.forEach(el => el.classList.add('jvb-in'));");
    const said = effect.indexOf("onMotionPreviewRef.current?.('start', playing);");
    assert.ok(playing > 0 && said > playing, 'start is said after every section has jvb-in');
    const timer = effect.slice(effect.indexOf('const timer = window.setTimeout('), effect.indexOf('return () =>'));
    assert.match(timer, /root\.classList\.remove\('jvb-motion-on'\);\s*onMotionPreviewRef\.current\?\.\('end', playing\);/);
  });

  it('nothing is said for a run that never plays: motion off, no level, or no root', () => {
    const said = effect.indexOf("('start', playing)");
    for (const guard of ['if (motionOff) return;', 'if (!preset || !root) return;']) {
      const at = effect.indexOf(guard);
      assert.ok(at > 0 && at < said, `${guard} comes before the start is said`);
    }
    assert.match(effect, /const playing: 'subtle' \| 'cinematic' = level === 'cinematic' \? 'cinematic' : 'subtle';/);
  });

  it('the shell speaks both in its polite live region, in the merchant\'s words', () => {
    assert.match(shell, /onMotionPreview=\{\(phase, level\) => say\(phase === 'start' \? `Previewing \$\{level\} motion` : 'Preview finished'\)\}/);
    assert.match(shell, /const say = useCallback\(\(text: string\) => setSpoken\(prev => \(\{ text, n: prev\.n \+ 1 \}\)\), \[\]\);/);
    const region = tagAround(shell, 'role="status" aria-live="polite" className="jv-sr-only"');
    assert.match(region, /aria-live="polite"/);
    const after = shell.slice(shell.indexOf(region) + region.length, shell.indexOf('</div>', shell.indexOf(region)));
    assert.match(after, /\{spoken\.text\}/);
  });

  it('the prop is declared on the canvas with the two phases and the two levels', () => {
    assert.match(canvas, /onMotionPreview\?: \(phase: 'start' \| 'end', level: 'subtle' \| 'cinematic'\) => void;/);
  });
});
