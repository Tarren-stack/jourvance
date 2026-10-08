// Pins for the motion review's second fix round (LANDING_BUILDER_MOTION.md). Each test names the
// defect it holds shut:
//   - the root's overflow clip (jvb-motion-on) comes off once nothing is held hidden and the last
//     reveal has had its time, so static shadows and negative margins at the root's edges are not
//     clipped for the page's whole life;
//   - the editor's device fade (jv-motion-device-in) is taken off the layer once it has played, so
//     unticking "Reduce motion in the editor" (or the OS setting) never replays it with no switch;
//   - the keyed selection toolbar carries keyboard focus to the same button of its replacement when
//     Duplicate, Paste, Delete or Cut moves the selection.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builderFrameScript } from './server/routes/publicBuilderScript.mjs';

const {
  removeClassWhenPlayed, DEVICE_IN_MAX_MS, toolbarFocusMemo, toolbarFocusTarget, TOOLBAR_FOCUS_WINDOW_MS
} = await import('./src/components/builder/motion.ts');

// ---- the frame script over a stub DOM that keeps its timers and its observer callback ----

function el(extra = {}) {
  const e = {
    classes: new Set(),
    style: { transition: '' },
    attrs: {},
    getAttribute: n => (n in e.attrs ? e.attrs[n] : null),
    setAttribute: (n, v) => { e.attrs[n] = String(v); },
    classList: {
      add: c => e.classes.add(c),
      remove: c => e.classes.delete(c),
      contains: c => e.classes.has(c)
    },
    get offsetWidth() { return 100; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    ...extra
  };
  return e;
}

function runFrame({ motion = 'subtle', tops = [], duration = '240ms' } = {}) {
  const winListeners = {};
  const timers = [];
  let ioCallback = null;
  const observed = new Set();
  const sections = [];
  const root = el({
    listeners: {},
    getAttribute: n => (n === 'data-jvb-motion' ? motion : null),
    addEventListener: (n, f) => { root.listeners[n] = f; },
    contains: t => sections.includes(t),
    querySelectorAll: s => {
      if (s === '[data-jvb-reveal]') return sections;
      if (s === '[data-jvb-reveal]:not(.jvb-in)') return sections.filter(x => !x.classes.has('jvb-in'));
      return [];
    }
  });
  tops.forEach((top, i) => {
    const s = el({ top, id: `s${i}` });
    s.getBoundingClientRect = () => ({ top: s.top });
    s.closest = q => (q === '[data-jvb-reveal]' ? s : null);
    sections.push(s);
  });
  const documentElement = { clientHeight: 800, scrollHeight: 5000, scrollTop: 0 };
  const document = {
    documentElement,
    getElementById: id => (id === 'jvb-root' ? root : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    cookie: ''
  };
  const win = {
    innerHeight: 800,
    pageYOffset: 0,
    location: { search: '', hash: '', href: 'http://jvb.test/p/s' },
    matchMedia: () => ({ matches: true }),
    addEventListener: (n, f) => { winListeners[n] = f; },
    getComputedStyle: t => ({ getPropertyValue: p => (t === root && p === '--jvb-motion-duration' ? ` ${duration}` : '') }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    IntersectionObserver: function IO(cb) {
      ioCallback = cb;
      this.observe = x => observed.add(x);
      this.unobserve = x => observed.delete(x);
    }
  };
  const src = builderFrameScript({ slug: 's' });
  const fn = new Function('window', 'document', 'localStorage',
    `with (window) { ${src.replace(/^\(function\(\) \{/, '(function() { try {').replace(/\}\)\(\);?\s*$/, '} catch (e) { window.__err = e; } })();')} }`);
  fn(win, document, { getItem: () => null, setItem() {} });
  const intersect = targets => ioCallback(targets.map(target => ({ target, isIntersecting: true })));
  return { root, sections, observed, win, timers, winListeners, intersect };
}

const on = r => r.root.classes.has('jvb-motion-on');

describe('the root clip comes off once nothing is held hidden', () => {
  it('every section shown at load: one timer, the level duration plus a margin, then the class is off', () => {
    const r = runFrame({ tops: [100, 300] });
    assert.equal(r.win.__err, undefined, String(r.win.__err));
    assert.ok(on(r), 'on while the timer runs');
    assert.equal(r.timers.length, 1);
    assert.equal(r.timers[0].ms, 240 + 120);
    r.timers[0].fn();
    assert.ok(!on(r), 'off once the reveals have had their time');
  });

  it('a cinematic page waits for its longer reveal', () => {
    const r = runFrame({ motion: 'cinematic', duration: '560ms', tops: [100] });
    assert.equal(r.timers[0].ms, 560 + 120);
  });

  it('while any section is hidden nothing is scheduled and the class stays on', () => {
    const r = runFrame({ tops: [100, 2000, 3000] });
    assert.ok(on(r));
    assert.equal(r.timers.length, 0);
    r.intersect([r.sections[1]]);
    assert.equal(r.timers.length, 0, 'sections[2] is still hidden');
    assert.ok(on(r));
  });

  it('the observer revealing the last hidden section schedules it, once', () => {
    const r = runFrame({ tops: [100, 2000, 3000] });
    r.intersect([r.sections[1], r.sections[2]]);
    assert.equal(r.timers.length, 1);
    r.intersect([r.sections[2]]);
    assert.equal(r.timers.length, 1, 'scheduled once');
    assert.ok(on(r), 'still on while the last reveal runs');
    r.timers[0].fn();
    assert.ok(!on(r));
  });

  it('the bottom of the page and keyboard focus schedule it too', () => {
    const a = runFrame({ tops: [100, 4950] });
    a.win.pageYOffset = 4200;
    a.winListeners.scroll();
    assert.equal(a.timers.length, 1);
    a.timers[0].fn();
    assert.ok(!on(a));
    const b = runFrame({ tops: [100, 2000] });
    b.root.listeners.focusin({ target: { closest: () => b.sections[1] } });
    assert.equal(b.timers.length, 1);
    b.timers[0].fn();
    assert.ok(!on(b));
  });

  it('a duration it cannot read waits a full second rather than cutting a reveal short', () => {
    const r = runFrame({ tops: [100], duration: '' });
    assert.equal(r.timers[0].ms, 1000);
  });
});

// ---- the editor's device fade ----

function fakeLayer() {
  const listeners = new Map();
  const layer = {
    classes: new Set(['jv-motion-device-in']),
    classList: { remove: c => layer.classes.delete(c) },
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => listeners.get(t)?.delete(f),
    fire: (t, e) => [...(listeners.get(t) || [])].forEach(f => f(e)),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  };
  return layer;
}

function fakeTimers() {
  const list = [];
  return {
    list,
    set: (fn, ms) => { const h = { fn, ms, cleared: false }; list.push(h); return h; },
    clear: h => { h.cleared = true; },
    runAll: () => list.filter(h => !h.cleared).forEach(h => h.fn())
  };
}

describe('the device fade is taken off once it has played', () => {
  it('its own animationend takes the class off and the listeners with it', () => {
    const layer = fakeLayer();
    const t = fakeTimers();
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    layer.fire('animationend', { target: {}, animationName: 'jvbe-device-in' });
    layer.fire('animationend', { target: layer, animationName: 'jvbe-appear' });
    assert.ok(layer.classes.has('jv-motion-device-in'), 'another element or another animation is ignored');
    layer.fire('animationend', { target: layer, animationName: 'jvbe-device-in' });
    assert.ok(!layer.classes.has('jv-motion-device-in'));
    assert.equal(layer.count(), 0);
    assert.ok(t.list[0].cleared, 'the fallback is cleared');
  });

  it('when no animation runs (motion off by the OS) the fallback takes it off', () => {
    const layer = fakeLayer();
    const t = fakeTimers();
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    assert.equal(t.list[0].ms, DEVICE_IN_MAX_MS);
    assert.ok(DEVICE_IN_MAX_MS > 180, 'longer than the 180ms fade');
    t.runAll();
    assert.ok(!layer.classes.has('jv-motion-device-in'));
  });

  it('a cancel is ignored (a restart fires the old fade\'s cancel after the new one began); the fallback still ends it', () => {
    const layer = fakeLayer();
    const t = fakeTimers();
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    layer.fire('animationcancel', { target: layer, animationName: 'jvbe-device-in' });
    assert.ok(layer.classes.has('jv-motion-device-in'));
    t.runAll();
    assert.ok(!layer.classes.has('jv-motion-device-in'));
  });

  it('a fade that starts late gets its full time: animationstart re-arms the fallback', () => {
    const layer = fakeLayer();
    const t = fakeTimers();
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    layer.fire('animationstart', { target: layer, animationName: 'jvbe-device-in' });
    assert.equal(t.list.length, 2);
    assert.ok(t.list[0].cleared, 'the first fallback is replaced');
    assert.equal(t.list[1].ms, DEVICE_IN_MAX_MS);
  });

  it('a second switch supersedes the first: the first fallback never cuts the second fade', () => {
    const layer = fakeLayer();
    const t = fakeTimers();
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS, t.set, t.clear);
    t.list[0].fn();
    assert.ok(layer.classes.has('jv-motion-device-in'), 'the first fallback leaves the second fade alone');
    t.list[1].fn();
    assert.ok(!layer.classes.has('jv-motion-device-in'));
  });

  it('the canvas arms it before restarting the class, inside the device effect', () => {
    const canvas = readFileSync(new URL('./src/components/builder/BuilderCanvas.tsx', import.meta.url), 'utf8');
    const add = canvas.indexOf("layer.classList.add('jv-motion-device-in')");
    const arm = canvas.indexOf("removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS)");
    const remove = canvas.indexOf("layer.classList.remove('jv-motion-device-in')");
    const guard = canvas.lastIndexOf('if (!layer || motionOff) return;', add);
    assert.ok(guard > 0 && guard < arm && arm < remove && remove < add, `${guard} ${arm} ${remove} ${add}`);
  });
});

// ---- the toolbar's focus across its remount ----

function button(label) {
  return { label, getAttribute: n => (n === 'aria-label' ? label : null), isConnected: true };
}
function toolbar(labels) {
  const buttons = labels.map(button);
  return { buttons, contains: x => buttons.includes(x), querySelectorAll: s => (s === 'button' ? buttons : []) };
}

describe('the selection toolbar keeps keyboard focus when it is replaced', () => {
  const labels = ['Drag Heading to a new place', 'Move up', 'Move down', 'Duplicate', 'Delete', 'Copy', 'Cut', 'Paste'];
  const body = { isConnected: true };

  it('the memo names the focused button; focus elsewhere gives none', () => {
    const old = toolbar(labels);
    assert.deepEqual(toolbarFocusMemo(old, old.buttons[3], 10), { label: 'Duplicate', index: 3, at: 10 });
    assert.equal(toolbarFocusMemo(old, body, 10), null);
    assert.equal(toolbarFocusMemo(null, old.buttons[3], 10), null);
  });

  it('the new toolbar focuses the same button by name, else by place, else the first', () => {
    const old = toolbar(labels);
    const next = toolbar(['Drag Copy of Heading to a new place', ...labels.slice(1)]);
    assert.equal(toolbarFocusTarget(next, toolbarFocusMemo(old, old.buttons[3], 0), body, body, 5), next.buttons[3]);
    assert.equal(toolbarFocusTarget(next, toolbarFocusMemo(old, old.buttons[0], 0), body, body, 5), next.buttons[0], 'the drag handle by place');
    assert.equal(toolbarFocusTarget(toolbar(['A']), { label: 'Gone', index: 9, at: 0 }, null, body, 5)?.label, 'A');
  });

  it('only when focus was lost and the memo is fresh, so a click elsewhere never pulls focus in', () => {
    const old = toolbar(labels);
    const next = toolbar(labels);
    const memo = toolbarFocusMemo(old, old.buttons[4], 0);
    assert.equal(toolbarFocusTarget(next, memo, { isConnected: true }, body, 5), null, 'focus is on something real');
    assert.equal(toolbarFocusTarget(next, memo, { isConnected: false }, body, 5), next.buttons[4], 'a detached element is lost focus');
    assert.equal(toolbarFocusTarget(next, memo, body, body, TOOLBAR_FOCUS_WINDOW_MS + 1), null, 'stale');
    assert.equal(toolbarFocusTarget(next, null, body, body, 5), null);
  });

  it('the keyed toolbar mounts through attachToolbar, which takes the memo on leave and focuses on arrival', () => {
    const canvas = readFileSync(new URL('./src/components/builder/BuilderCanvas.tsx', import.meta.url), 'utf8');
    assert.match(canvas, /key=\{`toolbar:\$\{selectedId\}`\}\s*ref=\{attachToolbar\}/);
    const at = canvas.indexOf('const attachToolbar = useCallback(');
    assert.ok(at > 0);
    const body = canvas.slice(at, canvas.indexOf('}, []);', at));
    assert.match(body, /toolbarFocusTarget\(el, toolbarFocus\.current, document\.activeElement, document\.body, Date\.now\(\)\)/);
    assert.match(body, /target instanceof HTMLElement\) target\.focus\(\)/);
    assert.match(body, /toolbarFocus\.current = toolbarFocusMemo\(toolbarRef\.current, document\.activeElement, Date\.now\(\)\)/);
    assert.match(body, /toolbarRef\.current = el;/);
  });
});
