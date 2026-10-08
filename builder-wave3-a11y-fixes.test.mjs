// Wave 3 fix round 1, the builder panels (LANDING_BUILDER_PLAN.md). These components are not
// mounted under node, so, like a11y-editors.test.mjs, this reads their source and pins the shape of
// each fix: focus has somewhere to go when the control holding it unmounts, the loading status is
// a live region that exists before its text, the Rewrite control's name starts with its visible
// words, the library can be emptied from the palette, and no merchant sentence carries a model
// path, a raw store reason or the word "server".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const shell = read('./src/components/builder/BuilderShell.tsx');
const templates = read('./src/components/builder/BuilderTemplates.tsx');
const history = read('./src/components/builder/BuilderHistory.tsx');
const rewrite = read('./src/components/builder/BuilderRewrite.tsx');
const palette = read('./src/components/builder/BuilderPalette.tsx');

/** The body of `const name = useCallback(...)` or `const name = (...) => {...}`, up to the next top-level const. */
function block(src, name) {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} is defined`);
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

test('a successful Save section puts focus back on the canvas', () => {
  const body = block(shell, 'confirmSave');
  const success = body.slice(body.indexOf('setSaving(null)'));
  assert.match(success, /requestAnimationFrame\(\(\) => dialogEl\?\.querySelector<HTMLElement>\('\[data-jvb-canvas-host\]'\)\?\.focus\(\)\)/);
  assert.match(body, /\}, \[saving, say, dialogEl\]\);/);
});

test('the not-durable save note is in the merchant\'s words, with no raw reason', () => {
  const body = block(shell, 'confirmSave');
  const note = body.slice(body.indexOf('const note'), body.indexOf('setSavedNote(note)'));
  assert.doesNotMatch(note, /server|restart|r\.reason/);
  assert.match(note, /not to your account yet/);
});

test('Replace my page puts focus back on the card\'s own button', () => {
  const body = block(templates, 'use');
  assert.match(body, /onUse\(fresh, t\.name\);\s*\n(?:\s*\/\/.*\n)*\s*requestAnimationFrame\(\(\) => document\.querySelector<HTMLElement>\(`\[data-template-use="\$\{CSS\.escape\(t\.id\)\}"\]`\)\?\.focus\(\)\)/);
});

test('a template problem is said without model paths', () => {
  assert.doesNotMatch(templates, /p\.path/);
  assert.match(templates, /This template cannot be used right now\. Choose another one\./);
});

test('History: Try again moves focus to the heading, and the loading status is mounted before its text', () => {
  assert.match(history, /<h3 id="jvb-history-title" ref=\{titleRef\} tabIndex=\{-1\}/);
  const retry = history.slice(history.indexOf('<button', history.indexOf("list.state === 'error'")));
  assert.match(retry.slice(0, retry.indexOf('Try again')), /titleRef\.current\?\.focus\(\);\s*\n\s*void load\(\);/);
  assert.match(history, /<p role="status" style=\{hintStyle\}>\{journeyId && nodeId && list\.state === 'loading' \? 'Loading the history\.' : ''\}<\/p>/);
  assert.doesNotMatch(history, /&& <p role="status"/);
});

test('History: a refused restore names no validator message', () => {
  const body = block(history, 'restore');
  assert.doesNotMatch(body, /check\.problems|builder check/);
  assert.match(body, /Your page has not changed\./);
});

test('Rewrite with AI: the accessible name starts with the visible words, and aria-controls only points at a panel that exists', () => {
  assert.match(rewrite, /aria-label=\{`Rewrite with AI: \$\{name\}`\}/);
  assert.match(rewrite, /<span>Rewrite with AI<\/span>/);
  assert.match(rewrite, /aria-controls=\{open \? `\$\{id\}-panel` : undefined\}/);
});

test('the palette can delete a saved section, asking first, and the shell wires it', () => {
  assert.match(palette, /data-saved-delete=\{item\.id\}/);
  assert.match(palette, /aria-label=\{`Delete saved section \$\{item\.name\}`\}/);
  assert.match(palette, /data-saved-delete-confirm=\{item\.id\}/);
  assert.match(palette, /autoFocus onClick=\{\(\) => keep\(item\.id\)\}/);
  assert.match(palette, /<h4 id="jvb-palette-saved" tabIndex=\{-1\}/);
  assert.match(shell, /onDeleteSaved=\{deleteSaved\}/);
  const del = block(shell, 'deleteSaved');
  assert.match(del, /readLibraryDelete\(await deleteLibraryItem\(item\.id\)\)/);
  assert.match(del, /querySelector<HTMLElement>\('#jvb-palette-saved'\)\?\.focus\(\)/);
});

test('none of these panels carries an em dash or a spaced en dash', () => {
  for (const [name, src] of Object.entries({ shell, templates, history, rewrite, palette })) {
    assert.doesNotMatch(src, /\u2014|\s\u2013\s/, name);
  }
});
