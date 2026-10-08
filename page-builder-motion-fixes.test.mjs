// Pins for the motion review's fix round (LANDING_BUILDER_MOTION.md). Each test names the defect it
// holds shut:
//   - an inner section never gets a reveal (the first section never moves, and a nested section
//     never travels twice); the inspector offers Entrance animation on top level sections only;
//   - a page opened on a #fragment, and a click on an in-page anchor, show the target's section and
//     whatever will be on screen with it at once, before the browser measures the jump;
//   - the bottom of the page reveals whatever is still hidden there, so a short last section can
//     never stay invisible;
//   - while sections are held hidden the root clips its vertical overflow, so a hidden section's
//     translateY never lengthens the page;
//   - a deadline whose offset has no colon (+0000) still starts the clock.
// The browser half of the same pins is scripts/builder-motion-page-check.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyPage, createNode, insertNode } from './src/lib/pageBuilder/model.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';
import { builderFrameScript, frameCss } from './server/routes/publicBuilderScript.mjs';

function textSection(text) {
  const s = createNode('section');
  const t = createNode('widget', 'text');
  t.props = { ...t.props, text };
  s.children[0].children.push(t);
  return s;
}

function pageOf(sections, motion) {
  let doc = createEmptyPage(motion ? { motion } : undefined);
  for (const s of sections) {
    const r = insertNode(doc, null, doc.sections.length, s);
    assert.ok(r.ok, r.reason);
    doc = r.doc;
  }
  return doc;
}

const sectionTags = html => html.match(/<section[^>]*>/g) || [];

describe('an inner section never gets a reveal', () => {
  // sections[0] holds an inner section, and so does sections[2] (a page nests one level at most).
  const hero = textSection('Hero');
  const heroInner = textSection('Inner in the hero');
  hero.children[0].children.push(heroInner);
  const outer = textSection('Outer');
  const mid = textSection('Mid');
  outer.children[0].children.push(mid);
  const sections = [hero, textSection('Second'), outer];

  for (const motion of ['subtle', 'cinematic']) {
    const doc = pageOf(structuredClone(sections), motion);
    for (const ctx of [{}, { device: 'desktop' }, { device: 'tablet' }, { device: 'mobile' }]) {
      it(`${motion} ${ctx.device || 'published'}: only the top level sections after the first carry it`, () => {
        const out = render(doc, ctx);
        assert.equal(out.problems.length, 0, JSON.stringify(out.problems));
        const tags = sectionTags(out.html);
        assert.equal(tags.length, 5, tags.join(' | '));
        const top = doc.sections.map(s => tags.find(t => t.includes(`jvb-n-${s.id} `) || t.includes(`jvb-n-${s.id}"`)));
        assert.ok(top.every(Boolean), 'each top level section is found');
        assert.ok(!top[0].includes('data-jvb-reveal'), top[0]);
        assert.ok(top[1].includes('data-jvb-reveal="rise"'), top[1]);
        assert.ok(top[2].includes('data-jvb-reveal="rise"'), top[2]);
        assert.equal((out.html.match(/data-jvb-reveal=/g) || []).length, 2, 'exactly two reveals: sections[1] and sections[2]');
        for (const t of tags.filter(t => !top.includes(t))) assert.ok(!t.includes('data-jvb-reveal'), `inner: ${t}`);
      });
    }
  }

  it('an inner section that asks for a reveal of its own still gets none', () => {
    const s = structuredClone(sections);
    s[2].children[0].children[1].props.reveal = 'fade';
    s[0].children[0].children[1].props.reveal = 'rise';
    const out = render(pageOf(s, 'subtle'));
    assert.equal((out.html.match(/data-jvb-reveal=/g) || []).length, 2);
  });

  it('the inspector offers Entrance animation on a top level section only, and says why on an inner one', () => {
    const src = readFileSync(new URL('./src/components/builder/BuilderInspector.tsx', import.meta.url), 'utf8');
    assert.match(src, /\{!isInner && node\.kind === 'section' && \(\s*<SelectField\s+label="Entrance animation"/);
    assert.match(src, /\{isInner && \(\s*<p style=\{hintStyle\}>An inner section moves with the section around it/);
    assert.match(src, /<AdvancedTab [^>]*isInner=\{isInner\}/);
  });
});

// ---- the frame script, run against a stub DOM ----

function stubElement(extra = {}) {
  const el = {
    classes: new Set(),
    style: { transition: '' },
    transitionWhenShown: undefined,
    reflows: 0,
    attrs: {},
    getAttribute: n => (n in el.attrs ? el.attrs[n] : null),
    setAttribute: (n, v) => { el.attrs[n] = String(v); },
    classList: {
      add: c => { if (c === 'jvb-in' && !el.classes.has(c)) el.transitionWhenShown = el.style.transition; el.classes.add(c); },
      remove: c => el.classes.delete(c),
      contains: c => el.classes.has(c),
      toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c))
    },
    get offsetWidth() { el.reflows++; return 100; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    ...extra
  };
  return el;
}

/**
 * Runs builderFrameScript over a stub DOM. `tops` are the sections' viewport tops at load; `hash`
 * the location hash; `targetIndex` the section the hash names (its id is `offer`).
 */
function runFrame({ motion = 'subtle', tops = [], hash = '', countdown = null, href = 'http://jvb.test/p/s' } = {}) {
  const docListeners = {};
  const winListeners = {};
  const root = stubElement({
    listeners: {},
    getAttribute: n => (n === 'data-jvb-motion' ? motion : null),
    addEventListener: (n, f) => { root.listeners[n] = f; },
    contains: t => sections.includes(t) || sections.some(s => s.children.includes(t)),
    querySelectorAll: s => {
      if (s === '[data-jvb-reveal]') return sections;
      if (s === '[data-jvb-reveal]:not(.jvb-in)') return sections.filter(x => !x.classes.has('jvb-in'));
      return [];
    }
  });
  const sections = tops.map((top, i) => {
    const el = stubElement({ top, id: `s${i}`, children: [] });
    el.getBoundingClientRect = () => ({ top: el.top });
    el.closest = s => (s === '[data-jvb-reveal]' ? el : null);
    return el;
  });
  const observed = new Set();
  const documentElement = { clientHeight: 800, scrollHeight: 5000, scrollTop: 0 };
  const document = {
    documentElement,
    getElementById: id => (id === 'jvb-root' ? root : sections.find(s => s.id === id) || null),
    querySelector: () => null,
    querySelectorAll: s => (s === '[data-jvb-countdown]' && countdown ? [countdown] : []),
    addEventListener: (n, f) => { docListeners[n] = f; },
    cookie: ''
  };
  const stubWindow = {
    innerHeight: 800,
    pageYOffset: 0,
    location: { search: '', hash, href: href + hash },
    matchMedia: () => ({ matches: true }),
    addEventListener: (n, f) => { winListeners[n] = f; },
    setTimeout: () => 0,
    IntersectionObserver: function IO() {
      this.observe = el => observed.add(el);
      this.unobserve = el => observed.delete(el);
    }
  };
  const src = builderFrameScript({ slug: 's' });
  const fn = new Function('window', 'document', 'localStorage',
    `with (window) { ${src.replace(/^\(function\(\) \{/, '(function() { try {').replace(/\}\)\(\);?\s*$/, '} catch (e) { window.__err = e; } })();')} }`);
  fn(stubWindow, document, { getItem: () => null, setItem() {} });
  return { root, sections, observed, win: stubWindow, documentElement, docListeners, winListeners };
}

describe('the frame script', () => {
  it('runs to the end over the stub, so the pins below see the real flow', () => {
    const r = runFrame({ tops: [100, 2000] });
    assert.equal(r.win.__err, undefined, String(r.win.__err));
    assert.ok(r.root.classes.has('jvb-motion-on'));
  });

  it('opened on a #fragment: the target and everything on screen with it are shown at load, the rest are watched', () => {
    // fold 800; the target (sections[2]) at 2600, so anything above 3400 is shown.
    const r = runFrame({ tops: [100, 2000, 2600, 3300, 4000], hash: '#s2' });
    assert.equal(r.win.__err, undefined, String(r.win.__err));
    assert.deepEqual(r.sections.map(s => s.classes.has('jvb-in')), [true, true, true, true, false]);
    assert.deepEqual([...r.observed], [r.sections[4]]);
    assert.ok(r.root.classes.has('jvb-motion-on'));
  });

  it('a #fragment that names nothing on the root changes nothing', () => {
    const r = runFrame({ tops: [100, 2000, 2600], hash: '#nowhere' });
    assert.deepEqual(r.sections.map(s => s.classes.has('jvb-in')), [true, false, false]);
    assert.equal(r.observed.size, 2);
  });

  it('a click on an in-page anchor shows its section with no transition before the jump', () => {
    const r = runFrame({ tops: [100, 2000, 2600, 4000] });
    assert.equal(typeof r.docListeners.click, 'function');
    const link = { hash: '#s3', href: 'http://jvb.test/p/s#s3' };
    link.closest = () => link;
    r.docListeners.click({ defaultPrevented: false, target: link });
    const target = r.sections[3];
    assert.ok(target.classes.has('jvb-in'), 'the target is shown');
    assert.equal(target.transitionWhenShown, 'none', 'shown with the transition off');
    assert.ok(target.reflows > 0, 'a style read lands between the class and the restore');
    assert.equal(target.style.transition, '', 'the inline transition is put back');
    assert.ok(!r.observed.has(target), 'no longer watched');
    // 4000 + 800: everything above that will be on screen or passed over, so it is shown at once too.
    assert.ok(r.sections[1].classes.has('jvb-in') && r.sections[2].classes.has('jvb-in'));
    assert.equal(r.sections[1].transitionWhenShown, 'none');
  });

  it('keyboard focus inside a hidden section shows it with no transition, so focus never sits on a fade', () => {
    const r = runFrame({ tops: [100, 2000] });
    const button = { closest: s => (s === '[data-jvb-reveal]' ? r.sections[1] : null) };
    r.root.listeners.focusin({ target: button });
    assert.ok(r.sections[1].classes.has('jvb-in'));
    assert.equal(r.sections[1].transitionWhenShown, 'none');
    assert.ok(!r.observed.has(r.sections[1]));
  });

  it('a click that was handled already, or a link to another page, settles nothing', () => {
    const r = runFrame({ tops: [100, 2000] });
    const own = { hash: '#s1', href: 'http://jvb.test/p/s#s1' };
    own.closest = () => own;
    r.docListeners.click({ defaultPrevented: true, target: own });
    const other = { hash: '#s1', href: 'http://jvb.test/p/other#s1' };
    other.closest = () => other;
    r.docListeners.click({ defaultPrevented: false, target: other });
    assert.ok(!r.sections[1].classes.has('jvb-in'));
  });

  it('reaching the bottom of the page reveals whatever is still hidden, and nothing earlier does', () => {
    const r = runFrame({ tops: [100, 2000, 4950] });
    assert.equal(typeof r.winListeners.scroll, 'function');
    assert.equal(typeof r.winListeners.resize, 'function');
    r.win.pageYOffset = 1000;
    r.winListeners.scroll();
    assert.ok(!r.sections[2].classes.has('jvb-in'), 'not at the bottom yet');
    r.win.pageYOffset = 4200; // 4200 + 800 = scrollHeight 5000
    r.winListeners.scroll();
    assert.ok(r.sections[1].classes.has('jvb-in') && r.sections[2].classes.has('jvb-in'));
    assert.equal(r.observed.size, 0);
  });

  it('a deadline whose offset has no colon still starts the clock', () => {
    const clock = stubElement({ textContent: '' });
    const end = new Date(Date.now() + 2 * 3600 * 1000 + 30 * 60 * 1000);
    const deadline = end.toISOString().slice(0, 19) + '+0000';
    const box = stubElement({
      attrs: { 'data-jvb-mode': 'deadline', 'data-jvb-deadline': deadline, 'data-jvb-expired': '' },
      querySelector: s => (s === '.jvb-countdown-clock' ? clock : null)
    });
    runFrame({ motion: '', countdown: box });
    assert.match(clock.textContent, /^02:(29|30):\d\d$/, `clock read "${clock.textContent}" for ${deadline}`);
  });
});

describe('the root clips its vertical overflow while sections are held hidden', () => {
  const css = frameCss('#09080E');
  it('the rule is there, keyed on the class only the frame script sets, screen and no-preference only', () => {
    assert.ok(css.includes('@media screen and (prefers-reduced-motion: no-preference) { #jvb-root.jvb-motion-on { overflow-y: clip; } }'));
  });
  it('it is the only rule in the frame CSS that reaches the root', () => {
    const hits = css.split('\n').filter(l => l.includes('#jvb-root'));
    assert.equal(hits.length, 1, hits.join(' | '));
  });
});
