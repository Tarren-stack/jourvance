// Check design's Undo belongs to one opening of the drawer (finding R15). The drawer stays mounted
// while closed, so a fix applied, the drawer closed, Cmd+Z pressed on the map and the drawer
// reopened used to still show "Fix applied. Undo" beside the same issue open again, and that Undo
// then answered "This fix was edited after it was applied", which is false: it was undone.
//
// There is no DOM in this repo's test loop, so the real drawer is bundled with esbuild with
// `react` swapped for a small hook store below. Rendering calls the component as a function,
// runs its effects when their deps change and re-renders until state settles; buttons are found
// in the returned element tree by their text and clicked through their onClick prop. Child
// components (the icons) are never called, and the dialog focus hook has no panel to attach to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('.', import.meta.url).pathname;

const REACT_STUB = `
  // Read per call: each mount installs its own store.
  const hooks = () => globalThis.__hooks;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  export function useState(init) {
    const h = hooks(); const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { v: typeof init === 'function' ? init() : init };
    const s = h.slots[k];
    return [s.v, next => { const v = typeof next === 'function' ? next(s.v) : next; if (!Object.is(v, s.v)) { s.v = v; h.dirty = true; } }];
  }
  export function useRef(init) { const h = hooks(); const k = h.i++; if (!(k in h.slots)) h.slots[k] = { current: init }; return h.slots[k]; }
  export function useMemo(fn, deps) {
    const h = hooks(); const k = h.i++; const s = h.slots[k];
    if (s && same(s.deps, deps)) return s.v;
    h.slots[k] = { v: fn(), deps }; return h.slots[k].v;
  }
  export const useCallback = (fn, deps) => useMemo(() => fn, deps);
  export function useEffect(fn, deps) {
    const h = hooks(); const k = h.i++; const s = h.slots[k];
    if (s && deps && same(s.deps, deps)) return;
    const cleanup = s && s.cleanup;
    h.slots[k] = { deps };
    h.effects.push(() => { if (typeof cleanup === 'function') cleanup(); h.slots[k].cleanup = fn(); });
  }
  export const useLayoutEffect = useEffect;
  export const useId = () => ':r' + (hooks().i++) + ':';
  export const forwardRef = render => props => render(props, null);
  export const memo = c => c;
  export const createContext = value => ({ Provider: 'Provider', value });
  export const useContext = context => context.value;
  export const Fragment = 'Fragment';
  export function createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.length > 1 ? children : children[0] } };
  }
  export const jsx = (type, props) => ({ type, props });
  export const jsxs = jsx;
  export default { useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useId, forwardRef, memo, createContext, useContext, Fragment, createElement };
`;

const out = await build({
  stdin: {
    contents: `export { PreFlightAuditDrawer } from './src/components/drawers/PreFlightAuditDrawer.tsx';
      export { checkJourneyDesign } from './src/lib/designChecks.ts';`,
    resolveDir: ROOT,
    loader: 'tsx'
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  plugins: [{
    name: 'react-stub',
    setup(b) {
      b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, () => ({ path: 'react', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: REACT_STUB, loader: 'js' }));
    }
  }]
});
const dir = mkdtempSync(join(tmpdir(), 'jv-check-design-undo-'));
const file = join(dir, 'drawer.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { PreFlightAuditDrawer, checkJourneyDesign } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

globalThis.requestAnimationFrame = fn => fn();

/** One mounted drawer: render() keeps its hook state between calls, like React does. */
function mount() {
  const hooks = (globalThis.__hooks = { slots: {}, i: 0, effects: [], dirty: false });
  let tree = null;
  const render = props => {
    for (let pass = 0; pass < 10; pass++) {
      globalThis.__hooks = hooks;
      hooks.i = 0; hooks.effects = []; hooks.dirty = false;
      tree = PreFlightAuditDrawer(props);
      for (const run of hooks.effects) run();
      if (!hooks.dirty) return tree;
    }
    throw new Error('the drawer never settled');
  };
  return { render, tree: () => tree };
}

const textOf = el => {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(textOf).join('');
  return textOf(el.props?.children);
};
function* walk(el) {
  if (el == null || typeof el !== 'object') return;
  if (Array.isArray(el)) { for (const c of el) yield* walk(c); return; }
  yield el;
  yield* walk(el.props?.children);
}
const buttons = (tree, name) => [...walk(tree)].filter(e => e.type === 'button' && textOf(e).trim() === name);
const status = tree => {
  const s = [...walk(tree)].find(e => e.props?.role === 'status');
  return s ? textOf(s).trim() : null;
};

// An upsell whose "Declined" line goes nowhere: Check design offers one fix, a new line.
const node = (id, type, x) => ({ id, type, position: { x, y: 0 }, data: { type, label: id, headline: 'Real words', path: '/' + id } });
const PROJECT = {
  id: 'journey_r15',
  name: 'R15',
  nodes: [node('page', 'landing-page', 0), node('offer', 'upsell', 400), node('thanks', 'thank-you', 800)],
  edges: [
    { id: 'e1', source: 'page', target: 'offer' },
    { id: 'e2', source: 'offer', target: 'thanks', sourceHandle: 'accepted' }
  ]
};

/** Opens the drawer on PROJECT, previews and applies the first fix; answers the fixed journey. */
function applyFirstFix(drawer, props) {
  const updates = [];
  const base = { ...props, onUpdateProject: p => updates.push(p) };
  let tree = drawer.render({ ...base, project: PROJECT, isOpen: true });
  const preview = buttons(tree, 'Preview fix');
  assert.ok(preview.length >= 1, 'the fixture has a fix to preview');
  preview[0].props.onClick();
  tree = drawer.render({ ...base, project: PROJECT, isOpen: true });
  buttons(tree, 'Apply fix')[0].props.onClick();
  assert.equal(updates.length, 1, 'Apply fix is one edit');
  const fixed = updates[0];
  assert.ok(fixed.edges.length > PROJECT.edges.length, 'the fix added a line');
  tree = drawer.render({ ...base, project: fixed, isOpen: true });
  return { base, fixed, tree, updates };
}

test('the fixture has an open check with a fix', () => {
  assert.ok(checkJourneyDesign(PROJECT).issues.length >= 1);
});

test('while the drawer stays open, Undo takes the applied fix back', () => {
  const drawer = mount();
  const { base, tree, updates } = applyFirstFix(drawer, { onClose() {} });
  assert.equal(status(tree), 'Fix applied.Undo');
  buttons(tree, 'Undo')[0].props.onClick();
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].edges.map(e => e.id), PROJECT.edges.map(e => e.id), 'the undo removed the added line');
  const after = drawer.render({ ...base, project: updates[1], isOpen: true });
  assert.equal(status(after), 'Fix undone.');
});

test('closed, undone on the map and reopened: no stale "Fix applied. Undo" and no false reason', () => {
  const drawer = mount();
  const { base, fixed } = applyFirstFix(drawer, { onClose() {} });
  // Escape closes the drawer; it stays mounted with isOpen false.
  assert.equal(drawer.render({ ...base, project: fixed, isOpen: false }), null);
  // Cmd+Z on the map puts the journey back as it was before the fix.
  drawer.render({ ...base, project: PROJECT, isOpen: false });
  const reopened = drawer.render({ ...base, project: PROJECT, isOpen: true });
  assert.equal(buttons(reopened, 'Undo').length, 0, 'no Undo for a fix the journey no longer holds');
  assert.doesNotMatch(status(reopened), /Fix applied/);
  assert.doesNotMatch(status(reopened), /edited after it was applied/);
  assert.equal(buttons(reopened, 'Preview fix').length >= 1, true, 'the issue is open again with its fix');
});

test('closed and reopened with nothing changed: the fix stays on the map and the drawer starts fresh', () => {
  const drawer = mount();
  const { base, fixed } = applyFirstFix(drawer, { onClose() {} });
  drawer.render({ ...base, project: fixed, isOpen: false });
  const reopened = drawer.render({ ...base, project: fixed, isOpen: true });
  assert.equal(buttons(reopened, 'Undo').length, 0);
  assert.equal(status(reopened), '');
});
