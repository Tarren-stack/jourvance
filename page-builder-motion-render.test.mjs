// Page motion, published side (LANDING_BUILDER_MOTION.md sections 1, 2, 3 and 5). What these hold:
// - a page with motion absent or "none" renders the exact bytes the renderer wrote before motion
//   existed (test-fixtures/page-builder-motion-before.json, captured at c69860a);
// - subtle and cinematic write the five custom properties, the root attribute, the per-section
//   reveal attribute (never on the first section) and the motion block as the CSS tail;
// - every motion rule sits behind the reduced-motion query, and nothing is hidden by CSS alone;
// - the frame script reveals sections, and does so last.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_THEME, MOTION_PRESETS, SECTION_DEFAULTS, THEME_MOTION_LEVELS, SECTION_REVEALS,
  WIDGET_REGISTRY, createNode, validateBuilderDoc, walk
} from './src/lib/pageBuilder/model.mjs';
import { TEMPLATES } from './src/lib/pageBuilder/templates.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';
import { builderFrameScript } from './server/routes/publicBuilderScript.mjs';

const BEFORE = JSON.parse(readFileSync(new URL('./test-fixtures/page-builder-motion-before.json', import.meta.url), 'utf8'));

// ---- the corpus the fixture was captured from ----

const CTX = {
  slug: 's',
  realVariantId: v => String(v ?? ''),
  formatPrice: p => `$${p}`,
  reviews: { summary: { averageRating: 4.5, totalCount: 2 }, reviews: [
    { rating: 5, reviewTitle: 'Great', reviewText: 'Loved it', customerName: 'Ann' },
    { rating: 4, reviewTitle: 'Good', reviewText: 'Nice', customerName: 'Bo' }
  ] }
};
const w = (type, id, props = {}) => ({ id, kind: 'widget', type, props: { ...WIDGET_REGISTRY[type].defaultProps, ...props }, style: { desktop: {} } });
const themePage = theme => ({ version: 1, theme, sections: [{ id: 's1', kind: 'section', props: {}, style: { desktop: {} }, children: [{ id: 'c1', kind: 'column', props: {}, style: { desktop: {} }, children: [w('heading', 'h1', { text: 'Hello' }), w('text', 't1', { text: 'Body [link](/x)' }), w('button', 'b1', { label: 'Go' })] }] }] });

function corpus() {
  const out = {};
  for (const t of TEMPLATES) {
    const d = t.build();
    let n = 0;
    walk(d, node => { node.id = `m${n++}`; });
    out[`template-${t.id}`] = d;
  }
  const widgets = Object.keys(WIDGET_REGISTRY).map(type => { const n = createNode('widget', type); n.id = `w-${type}`; return n; });
  out.widgets = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [{ id: 'ws', kind: 'section', props: {}, style: { desktop: {} }, children: [{ id: 'wc', kind: 'column', props: {}, style: { desktop: {} }, children: widgets }] }] };
  const t = structuredClone(DEFAULT_THEME);
  out['theme-default'] = themePage(t);
  out['theme-outline'] = themePage({ ...t, buttonStyle: 'outline' });
  out['theme-pill'] = themePage({ ...t, buttonStyle: 'pill', radius: 4, spacingScale: 10, containerWidth: 700 });
  return out;
}

const sha = s => createHash('sha256').update(s).digest('hex');
const CONTEXTS = ['', 'desktop', 'tablet', 'mobile'];
const ctxOf = c => (c ? { ...CTX, device: c } : { ...CTX });
const keyOf = c => c || 'published';

function assertMatchesBefore(name, doc) {
  for (const c of CONTEXTS) {
    const r = render(doc, ctxOf(c));
    assert.deepEqual(r.problems, [], `${name} ${keyOf(c)}`);
    const want = BEFORE[name][keyOf(c)];
    assert.deepEqual([sha(r.html), r.html.length], want.html, `${name} ${keyOf(c)} html`);
    assert.deepEqual([sha(r.css), r.css.length], want.css, `${name} ${keyOf(c)} css`);
    assert.deepEqual(r.fonts, want.fonts, `${name} ${keyOf(c)} fonts`);
  }
}

// ---- a four-section page ----

function section(id, props = {}, text = id) {
  return { id, kind: 'section', props, style: { desktop: {} }, children: [{ id: `${id}-c`, kind: 'column', props: {}, style: { desktop: {} }, children: [w('heading', `${id}-h`, { text }), w('button', `${id}-b`, { label: 'Go' })] }] };
}
function fourSections(motion) {
  const theme = structuredClone(DEFAULT_THEME);
  if (motion !== undefined) theme.motion = motion;
  return {
    version: 1,
    theme,
    sections: [
      section('a', { reveal: 'fade' }),
      section('b', {}),
      section('c', { reveal: 'fade', anchor: 'offer' }),
      section('d', { reveal: 'none' })
    ]
  };
}
const sectionTag = (html, id) => html.match(new RegExp(`<section [^>]*jvb-n-${id}[^>]*>`))[0];
const BLOCK_START = '@media (hover: hover) and (prefers-reduced-motion: no-preference){';

const SUBTLE_VARS = '--jvb-motion-duration:240ms;--jvb-motion-fast:180ms;--jvb-motion-distance:10px;--jvb-motion-lift:-1px;--jvb-motion-ease:cubic-bezier(.2,0,0,1);display:flex';
const CINEMATIC_VARS = '--jvb-motion-duration:560ms;--jvb-motion-fast:220ms;--jvb-motion-distance:24px;--jvb-motion-lift:-2px;--jvb-motion-ease:cubic-bezier(.16,1,.3,1);display:flex';

const EXPECTED_BLOCK = `@media (hover: hover) and (prefers-reduced-motion: no-preference){
#jvb-root .jvb-btn:hover:not(:disabled){transform:translateY(var(--jvb-motion-lift))}
#jvb-root .jvb-text a:hover,#jvb-root .jvb-embed a:hover{text-underline-offset:.3em}
}
@media (prefers-reduced-motion: no-preference){
#jvb-root .jvb-btn{transition:transform var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-btn:active:not(:disabled){transform:scale(.98);transition-duration:80ms}
#jvb-root .jvb-text a,#jvb-root .jvb-embed a{text-underline-offset:.15em;transition:text-underline-offset var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-text a:focus-visible,#jvb-root .jvb-embed a:focus-visible{text-underline-offset:.3em}
#jvb-root .jvb-bump-cb:checked{animation:jvb-tick var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-countdown-clock[data-jvb-tick="a"]{animation:jvb-digit-a var(--jvb-motion-fast) var(--jvb-motion-ease)}
#jvb-root .jvb-countdown-clock[data-jvb-tick="b"]{animation:jvb-digit-b var(--jvb-motion-fast) var(--jvb-motion-ease)}
@keyframes jvb-tick{0%{transform:scale(.8)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes jvb-digit-a{from{opacity:.35}to{opacity:1}}
@keyframes jvb-digit-b{from{opacity:.35}to{opacity:1}}
}
@media screen and (prefers-reduced-motion: no-preference){
#jvb-root.jvb-motion-on [data-jvb-reveal]:not(.jvb-in){opacity:0}
#jvb-root.jvb-motion-on [data-jvb-reveal="rise"]:not(.jvb-in){transform:translateY(var(--jvb-motion-distance))}
#jvb-root.jvb-motion-on [data-jvb-reveal].jvb-in{transition:opacity var(--jvb-motion-duration) var(--jvb-motion-ease),transform var(--jvb-motion-duration) var(--jvb-motion-ease)}
}`;

// ---- tests ----

describe('R1: motion off is byte-identical to the renderer before motion existed', () => {
  const docs = corpus();
  it('the fixture covers every corpus document and context', () => {
    assert.deepEqual(Object.keys(BEFORE).sort(), Object.keys(docs).sort());
    assert.equal(Object.keys(docs).length, TEMPLATES.length + 4);
    for (const name of Object.keys(BEFORE)) assert.deepEqual(Object.keys(BEFORE[name]).sort(), ['desktop', 'mobile', 'published', 'tablet']);
  });
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name}: motion absent`, () => assertMatchesBefore(name, doc));
    it(`${name}: motion none`, () => {
      const d = structuredClone(doc);
      d.theme.motion = 'none';
      assertMatchesBefore(name, d);
    });
    it(`${name}: reveal rise on every section while motion is absent`, () => {
      const d = structuredClone(doc);
      for (const s of d.sections) s.props = { ...s.props, reveal: 'rise' };
      assertMatchesBefore(name, d);
    });
  }
});

describe('R2: theme.motion validation', () => {
  const check = motion => validateBuilderDoc({ ...fourSections(), theme: { ...structuredClone(DEFAULT_THEME), motion } });
  for (const v of ['none', 'subtle', 'cinematic']) it(`accepts ${v}`, () => assert.equal(check(v).ok, true));
  for (const v of ['fast', 1, null, '', 'Subtle']) {
    it(`refuses ${JSON.stringify(v)} with one problem at theme.motion`, () => {
      const r = check(v);
      assert.equal(r.ok, false);
      assert.equal(r.problems.length, 1);
      assert.equal(r.problems[0].path, 'theme.motion');
      assert.ok(r.problems[0].message.includes('none, subtle, cinematic'), r.problems[0].message);
    });
  }
  it('a key that is not a theme setting is still refused', () => {
    const r = validateBuilderDoc({ ...fourSections(), theme: { ...structuredClone(DEFAULT_THEME), speed: 'fast' } });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some(p => p.path === 'theme.speed'));
  });
  it('the level list matches the spec', () => assert.deepEqual([...THEME_MOTION_LEVELS], ['none', 'subtle', 'cinematic']));
});

describe('R3: section reveal validation and defaults', () => {
  for (const v of ['inherit', 'none', 'fade', 'rise']) {
    it(`accepts ${v}`, () => {
      const d = fourSections('subtle');
      d.sections[1].props.reveal = v;
      assert.equal(validateBuilderDoc(d).ok, true);
    });
  }
  it('refuses slide at sections[1].props.reveal', () => {
    const d = fourSections('subtle');
    d.sections[1].props.reveal = 'slide';
    const r = validateBuilderDoc(d);
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].path, 'sections[1].props.reveal');
  });
  it('createNode(section) and DEFAULT_THEME carry neither key', () => {
    assert.equal('reveal' in createNode('section').props, false);
    assert.equal('reveal' in SECTION_DEFAULTS, false);
    assert.equal('motion' in DEFAULT_THEME, false);
    assert.deepEqual([...SECTION_REVEALS], ['inherit', 'none', 'fade', 'rise']);
  });
});

describe('R4: the presets', () => {
  it('subtle and cinematic sit inside the spec ranges', () => {
    const s = MOTION_PRESETS.subtle;
    const c = MOTION_PRESETS.cinematic;
    assert.ok(s.durationMs >= 180 && s.durationMs <= 260);
    assert.ok(s.distancePx >= 8 && s.distancePx <= 12);
    assert.ok(c.durationMs >= 420 && c.durationMs <= 600);
    assert.ok(c.distancePx >= 20 && c.distancePx <= 28);
    assert.ok(s.fastMs < s.durationMs);
    assert.ok(c.fastMs < c.durationMs);
  });
  it('are frozen, all the way down', () => {
    assert.ok(Object.isFrozen(MOTION_PRESETS));
    assert.ok(Object.isFrozen(MOTION_PRESETS.subtle));
    assert.ok(Object.isFrozen(MOTION_PRESETS.cinematic));
  });
});

describe('R5: the markup', () => {
  const doc = fourSections('subtle');
  const pub = render(doc, { ...CTX });
  it('opens the root with the level and writes the reveal attribute where the table says', () => {
    assert.deepEqual(pub.problems, []);
    assert.ok(pub.html.startsWith('<div id="jvb-root" class="jvb" data-jvb-motion="subtle">'));
    assert.ok(!sectionTag(pub.html, 'a').includes('data-jvb-reveal'));
    assert.ok(sectionTag(pub.html, 'b').endsWith(' data-jvb-reveal="rise">'));
    assert.ok(sectionTag(pub.html, 'c').endsWith(' id="offer" data-jvb-reveal="fade">'));
    assert.ok(!sectionTag(pub.html, 'd').includes('data-jvb-reveal'));
    assert.equal(pub.html.split('data-jvb-reveal').length - 1, 2);
  });
  it('the first section never moves, whatever it asks for', () => {
    for (const v of ['rise', 'fade', 'inherit']) {
      const d = fourSections('cinematic');
      d.sections[0].props.reveal = v;
      assert.ok(!sectionTag(render(d, { ...CTX }).html, 'a').includes('data-jvb-reveal'), v);
    }
  });
  it('the canvas html is the published html for each device', () => {
    for (const device of ['desktop', 'tablet', 'mobile']) assert.equal(render(doc, { ...CTX, device }).html, pub.html, device);
  });
  it('cinematic writes its own level on the root', () => {
    assert.ok(render(fourSections('cinematic'), { ...CTX }).html.startsWith('<div id="jvb-root" class="jvb" data-jvb-motion="cinematic">'));
  });
  it('page motion none keeps a per-section choice for later and renders nothing', () => {
    const d = fourSections('none');
    const r = render(d, { ...CTX });
    assert.ok(!r.html.includes('data-jvb'));
    assert.ok(!r.css.includes('jvb-motion'));
  });
  it('the per-section override wins: none beats the page, fade beats rise', () => {
    const d = fourSections('subtle');
    d.sections[1].props.reveal = 'none';
    d.sections[3].props.reveal = 'rise';
    const html = render(d, { ...CTX }).html;
    assert.ok(!sectionTag(html, 'b').includes('data-jvb-reveal'));
    assert.ok(sectionTag(html, 'd').endsWith(' data-jvb-reveal="rise">'));
    assert.ok(sectionTag(html, 'c').endsWith(' data-jvb-reveal="fade">'));
  });
});

describe('R6: the root custom properties', () => {
  it('subtle', () => {
    const line1 = render(fourSections('subtle'), { ...CTX }).css.split('\n')[0];
    assert.ok(line1.includes(SUBTLE_VARS), line1);
  });
  it('cinematic', () => {
    const line1 = render(fourSections('cinematic'), { ...CTX }).css.split('\n')[0];
    assert.ok(line1.includes(CINEMATIC_VARS), line1);
  });
});

describe('R7: the CSS tail', () => {
  for (const level of ['subtle', 'cinematic']) {
    for (const c of CONTEXTS) {
      it(`${level} ${keyOf(c)}: ends with the block; the rest is the motion-less CSS apart from line 1`, () => {
        const on = render(fourSections(level), ctxOf(c)).css;
        const off = render(fourSections(), ctxOf(c)).css;
        assert.ok(on.endsWith(EXPECTED_BLOCK), 'tail');
        const head = on.slice(0, on.length - EXPECTED_BLOCK.length - 1);
        const [on1, ...onRest] = head.split('\n');
        const [off1, ...offRest] = off.split('\n');
        assert.deepEqual(onRest, offRest);
        const vars = (level === 'subtle' ? SUBTLE_VARS : CINEMATIC_VARS).replace(';display:flex', '');
        assert.equal(on1, off1.replace(';display:flex', `;${vars};display:flex`));
      });
    }
  }
});

describe('R8: the structure of the motion CSS', () => {
  const css = render(fourSections('subtle'), { ...CTX }).css;
  const at = css.indexOf(BLOCK_START);
  const before = css.slice(0, at);
  const block = css.slice(at);
  it('no transition, animation, transform or keyframes outside the motion blocks', () => {
    // The page's own node styles may set transform through a style key, so this reads the
    // motion-less render for what existed before and asks the motion render to add nothing to it.
    const off = render(fourSections(), { ...CTX }).css;
    const hits = s => s.split('\n').filter(l => /transition|animation|transform|@keyframes/.test(l));
    assert.deepEqual(hits(before), hits(off));
  });
  it('no !important, @import or url( in the block', () => {
    assert.ok(!/!important|@import|url\(/.test(block));
  });
  it('every keyframe name starts with jvb- and every rule line starts with #jvb-root, @keyframes, @media or a brace', () => {
    for (const m of block.matchAll(/@keyframes ([^{\s]+)/g)) assert.ok(m[1].startsWith('jvb-'), m[1]);
    for (const line of block.split('\n')) assert.ok(/^(#jvb-root|@keyframes |@media |\})/.test(line), line);
  });
  it('opacity:0 appears only in the screen + no-preference block and only with .jvb-motion-on', () => {
    const lines = block.split('\n').filter(l => l.includes('opacity:0'));
    assert.ok(lines.length >= 1);
    for (const l of lines) assert.ok(l.startsWith('#jvb-root.jvb-motion-on '), l);
    const open = block.indexOf('@media screen and (prefers-reduced-motion: no-preference){');
    assert.ok(open > 0);
    assert.ok(block.indexOf('opacity:0') > open);
    assert.equal(block.slice(0, open).includes('opacity:0'), false);
  });
  it('every motion media query carries the reduced-motion condition', () => {
    const medias = block.split('\n').filter(l => l.startsWith('@media'));
    assert.equal(medias.length, 3);
    for (const m of medias) assert.ok(m.includes('(prefers-reduced-motion: no-preference)'), m);
  });
});

describe('R9: the frame script', () => {
  const script = builderFrameScript({ slug: 's' });
  it('parses', () => assert.doesNotThrow(() => new Function(script)));
  it('holds the motion contract', () => {
    for (const token of ["getAttribute('data-jvb-motion')", "matchMedia('(prefers-reduced-motion: no-preference)')", 'IntersectionObserver', 'focusin', 'data-jvb-tick']) {
      assert.ok(script.includes(token), token);
    }
  });
  it('turns the hidden state on last, in a try that sits between the root lookup and the countdowns', () => {
    const on = script.indexOf("classList.add('jvb-motion-on')");
    const observe = script.indexOf('.observe(');
    const root = script.indexOf("getElementById('jvb-root')");
    const countdowns = script.indexOf('[data-jvb-countdown]');
    assert.ok(on > observe && observe > 0);
    const tryAt = script.lastIndexOf('try {', on);
    assert.ok(tryAt > root && tryAt < countdowns, 'try placement');
    assert.ok(on < countdowns);
  });
});

// ---- the frame script, run against a stub DOM ----

function runFrame({ motion, reduced, io = true, tops = [] }) {
  const root = {
    classes: new Set(),
    listeners: {},
    getAttribute: n => (n === 'data-jvb-motion' ? motion : null),
    classList: { add: c => root.classes.add(c) },
    addEventListener: (n, f) => { root.listeners[n] = f; },
    querySelectorAll: s => (s === '[data-jvb-reveal]' ? sections : [])
  };
  const sections = tops.map(top => {
    const el = { top, classes: new Set(), getBoundingClientRect: () => ({ top }), classList: { add: c => el.classes.add(c) } };
    return el;
  });
  const observed = [];
  const document = {
    documentElement: { clientHeight: 800 },
    getElementById: id => (id === 'jvb-root' ? root : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const stubWindow = {
    innerHeight: 800,
    location: { search: '' },
    matchMedia: () => ({ matches: !reduced }),
    addEventListener() {},
    setTimeout
  };
  if (io) stubWindow.IntersectionObserver = function IO() { this.observe = el => observed.push(el); this.unobserve = () => {}; };
  const src = builderFrameScript({ slug: 's' });
  const fn = new Function('window', 'document', 'URLSearchParams', 'localStorage', 'setTimeout', 'IntersectionObserver',
    `with (window) { ${src.replace(/^\(function\(\) \{/, '(function() { try {').replace(/\}\)\(\);?\s*$/, '} catch (e) { window.__err = e; } })();')} }`);
  try {
    fn(stubWindow, document, URLSearchParams, { getItem: () => null, setItem() {} }, () => 0, stubWindow.IntersectionObserver);
  } catch (e) {
    stubWindow.__err = e;
  }
  return { root, sections, observed, win: stubWindow };
}

describe('the frame script marks sections', () => {
  it('on screen sections are shown at once, the rest are watched, and the hidden state comes on last', () => {
    const r = runFrame({ motion: 'subtle', reduced: false, tops: [100, 300, 2000, 3000] });
    assert.ok(r.root.classes.has('jvb-motion-on'));
    assert.ok(r.sections[0].classes.has('jvb-in'));
    assert.ok(r.sections[1].classes.has('jvb-in'));
    assert.ok(!r.sections[2].classes.has('jvb-in'));
    assert.equal(r.observed.length, 2);
    assert.equal(typeof r.root.listeners.focusin, 'function');
  });
  it('focus on a hidden section reveals it', () => {
    const r = runFrame({ motion: 'subtle', reduced: false, tops: [2000] });
    const inner = { closest: s => (s === '[data-jvb-reveal]' ? r.sections[0] : null) };
    r.root.listeners.focusin({ target: inner });
    assert.ok(r.sections[0].classes.has('jvb-in'));
  });
  it('removes the reveal under reduced motion: nothing is observed and the hidden state never comes on', () => {
    const r = runFrame({ motion: 'subtle', reduced: true, tops: [2000, 3000] });
    assert.ok(!r.root.classes.has('jvb-motion-on'));
    assert.equal(r.observed.length, 0);
  });
  it('does nothing without IntersectionObserver, and nothing when the page asked for no motion', () => {
    assert.ok(!runFrame({ motion: 'subtle', reduced: false, io: false, tops: [2000] }).root.classes.has('jvb-motion-on'));
    const none = runFrame({ motion: '', reduced: false, tops: [2000] });
    assert.ok(!none.root.classes.has('jvb-motion-on'));
    assert.equal(none.observed.length, 0);
  });
});
