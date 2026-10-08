// The landing page builder's document model (LANDING_BUILDER_PLAN.md, Wave 0):
// src/lib/pageBuilder/model.mjs. What these tests hold:
// - validateBuilderDoc refuses every bad shape with the path to it, and never throws;
// - resolveStyle cascades desktop, then tablet, then mobile, and an absent layer inherits;
// - every tree operation keeps ids unique and the document valid, never touches its input, and
//   refuses an illegal nest with a reason instead of throwing;
// - migrateLegacyPage carries every field today's page shows into exactly one widget prop,
//   pinned against previewPageCopy (src/lib/pagePreviewCopy.ts), the editor's copy of what
//   renderPublicFunnelHtml shows.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDER_VERSION,
  BREAKPOINTS,
  LIMITS,
  DEFAULT_THEME,
  WIDGET_REGISTRY,
  WIDGET_GROUPS,
  STYLE_KEYS,
  LEGACY_STARTER_TEXT,
  LEGACY_PLACEHOLDER_VARIANT_IDS,
  createEmptyPage,
  createNode,
  mintId,
  validateBuilderDoc,
  resolveStyle,
  walk,
  findNode,
  insertNode,
  moveNode,
  removeNode,
  duplicateNode,
  countNodes,
  propsWithDefaults,
  migrateLegacyPage
} from './src/lib/pageBuilder/model.mjs';
import {
  previewPageCopy,
  HEADLINE_FALLBACK,
  BUTTON_FALLBACK,
  URGENCY_FALLBACK,
  BUMP_HEADLINE_FALLBACK,
  BUMP_TITLE_FALLBACK,
  SOCIAL_PROOF_FALLBACK
} from './src/lib/pagePreviewCopy.ts';
import { STARTER_TEXT } from './src/lib/stepDefaults.ts';
import { DEMO_VARIANT_IDS } from './src/lib/productPickerCatalog.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';
import { FAKE_VARIANT_IDS } from './server/routes/authWorkspaceRoutes.mjs';

// ---- helpers ----

const W = 'sections[0].children[0].children[0]';

function widget(type, props = {}, extra = {}) {
  return { id: 'w1', kind: 'widget', type, props: { ...WIDGET_REGISTRY[type].defaultProps, ...props }, style: { desktop: {} }, ...extra };
}

function column(id, children, extra = {}) {
  return { id, kind: 'column', props: {}, style: { desktop: {} }, children, ...extra };
}

function section(id, children, extra = {}) {
  return { id, kind: 'section', props: {}, style: { desktop: {} }, children, ...extra };
}

/** One section, one column, the given children in the column. */
function pageWith(...children) {
  return { version: BUILDER_VERSION, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [column('c1', children)])] };
}

/** The document has exactly one problem, at `path`, and its message matches `re`. */
function assertOnlyProblem(doc, path, re) {
  const v = validateBuilderDoc(doc);
  assert.equal(v.ok, false, `expected a problem at ${path}`);
  assert.equal(v.problems.length, 1, `expected one problem at ${path}, got ${JSON.stringify(v.problems)}`);
  assert.equal(v.problems[0].path, path, JSON.stringify(v.problems));
  if (re) assert.match(v.problems[0].message, re);
}

function assertValid(doc, label = '') {
  const v = validateBuilderDoc(doc);
  assert.deepEqual(v.problems, [], `${label} should be valid`);
  assert.equal(v.ok, true);
}

function allIds(doc) {
  const ids = [];
  walk(doc, node => { ids.push(node.id); });
  return ids;
}

function assertValidAndUnique(doc, label) {
  assertValid(doc, label);
  const ids = allIds(doc);
  assert.equal(new Set(ids).size, ids.length, `${label}: ids are unique`);
  assert.equal(ids.length, countNodes(doc), `${label}: walk visits every node`);
}

/** Runs a tree op and checks it left its input alone. */
function op(fn, doc, ...args) {
  const before = structuredClone(doc);
  const result = fn(doc, ...args);
  assert.deepEqual(doc, before, `${fn.name} must not change the document it was given`);
  return result;
}

function ok(result, label) {
  assert.equal(result.ok, true, `${label}: ${result.reason}`);
  assertValidAndUnique(result.doc, label);
  return result;
}

function refused(result, re, label) {
  assert.equal(result.ok, false, `${label} should be refused`);
  assert.equal(result.doc, undefined);
  assert.equal(typeof result.reason, 'string');
  assert.match(result.reason, re, label);
}

// ---- the contract ----

describe('page builder model: constants', () => {
  it('reads version 1 and breaks at 1024 and 640', () => {
    assert.equal(BUILDER_VERSION, 1);
    assert.deepEqual({ ...BREAKPOINTS }, { tablet: 1024, mobile: 640 });
  });

  it('registers exactly the Wave 1a widgets, each complete and self-consistent', () => {
    const expected = ['heading', 'text', 'image', 'button', 'spacer', 'divider', 'video', 'iconList', 'testimonials', 'faq',
      'countdown', 'htmlEmbed', 'leadForm', 'productHero', 'checkoutButton', 'orderBump', 'reviewsWall', 'stockCount', 'trustBadge'];
    assert.deepEqual(Object.keys(WIDGET_REGISTRY).sort(), expected.sort());
    const groups = WIDGET_GROUPS.map(g => g.id);
    for (const [type, def] of Object.entries(WIDGET_REGISTRY)) {
      assert.equal(def.type, type);
      assert.ok(def.label && def.description, `${type} has a label and a description`);
      assert.ok(!/\n/.test(def.description), `${type}: the description is one line`);
      assert.ok(groups.includes(def.group), `${type}: group ${def.group} is a palette group`);
      assert.deepEqual(Object.keys(def.defaultProps).sort(), Object.keys(def.props).sort(), `${type}: a default for every prop and no other`);
      for (const key of Object.keys(def.fallbacks)) assert.ok(key in def.props, `${type}: fallback ${key} is a prop`);
      for (const path of def.inlineEditable) {
        const [head, star, tail] = path.split('.');
        const spec = def.props[head];
        assert.ok(spec, `${type}: inline ${path} names a prop`);
        const leaf = star === '*' ? spec.item?.[tail] : spec;
        assert.equal(leaf?.kind, 'string', `${type}: inline ${path} is text`);
      }
      // The defaults themselves form a valid widget.
      assertValid(pageWith(createNode('widget', type)), `a new ${type}`);
    }
  });

  it('starts a new widget with no copy, no product and no price', () => {
    for (const [type, def] of Object.entries(WIDGET_REGISTRY)) {
      for (const [key, value] of Object.entries(def.defaultProps)) {
        if (typeof value === 'string') {
          const spec = def.props[key];
          if (spec.kind === 'string' || spec.kind === 'url' || spec.kind === 'html') assert.equal(value, '', `${type}.${key} starts empty`);
        }
        if (Array.isArray(value)) assert.equal(value.length, 0, `${type}.${key} starts with no items`);
      }
    }
  });

  it('words its fallbacks exactly as today\'s page does', () => {
    assert.equal(WIDGET_REGISTRY.checkoutButton.fallbacks.label, BUTTON_FALLBACK);
    assert.equal(WIDGET_REGISTRY.countdown.fallbacks.text, URGENCY_FALLBACK);
    assert.equal(WIDGET_REGISTRY.orderBump.fallbacks.headline, BUMP_HEADLINE_FALLBACK);
    assert.equal(WIDGET_REGISTRY.orderBump.fallbacks.title, BUMP_TITLE_FALLBACK);
    assert.equal(WIDGET_REGISTRY.reviewsWall.fallbacks.headline, SOCIAL_PROOF_FALLBACK);
    // The rest are read straight from the renderer's source.
    const renderer = fs.readFileSync(new URL('./server/routes/publicRoutes.mjs', import.meta.url), 'utf8');
    assert.ok(renderer.includes(`'${WIDGET_REGISTRY.countdown.fallbacks.expiredText}'`));
    assert.ok(renderer.includes('`Limited batch: ${scarcityCount} units remaining`'));
    assert.equal(WIDGET_REGISTRY.stockCount.fallbacks.text, 'Limited batch: {count} units remaining');
    assert.ok(renderer.includes(WIDGET_REGISTRY.leadForm.fallbacks.heading));
    assert.ok(renderer.includes(`'${WIDGET_REGISTRY.leadForm.fallbacks.successText}'`));
    assert.ok(renderer.includes(`leadOnly ? '${WIDGET_REGISTRY.leadForm.fallbacks.buttonText}'`));
  });

  it('keeps its copies of the legacy lists equal to the ones the app and the server use', () => {
    assert.deepEqual([...LEGACY_STARTER_TEXT].sort(), [...STARTER_TEXT].sort());
    assert.deepEqual([...LEGACY_PLACEHOLDER_VARIANT_IDS].sort(), [...DEMO_VARIANT_IDS].sort());
    assert.deepEqual([...LEGACY_PLACEHOLDER_VARIANT_IDS].sort(), [...FAKE_VARIANT_IDS].sort());
  });

  it('mints ids that are unique and safe in CSS', () => {
    const ids = new Set();
    for (let i = 0; i < 2000; i++) ids.add(mintId('heading'));
    assert.equal(ids.size, 2000);
    for (const id of ids) assert.match(id, /^heading-[a-z0-9]{10}$/);
    assert.match(mintId(''), /^n-[a-z0-9]{10}$/);
    assert.match(mintId('9 lives!'), /^n9lives-[a-z0-9]{10}$/);
  });
});

describe('page builder model: validateBuilderDoc', () => {
  it('passes a well formed page, the control every refusal below differs from by one change', () => {
    assertValid(pageWith(widget('heading', { text: 'Hello', level: 1 })), 'the control page');
    assertValid(createEmptyPage(), 'an empty page');
    assertValid(createEmptyPage({ colors: { primary: '#123456' }, radius: 4 }), 'an empty page with its own theme');
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [null, undefined, 42, 'page', [], () => {}, { version: 1 }]) {
      const v = validateBuilderDoc(bad);
      assert.equal(v.ok, false);
      assert.ok(v.problems.length > 0);
    }
    const cyclic = pageWith(widget('spacer'));
    cyclic.sections[0].children[0].children.push(cyclic.sections[0]);
    const vc = validateBuilderDoc(cyclic);
    assert.equal(vc.ok, false);
    const exploding = { version: 1, theme: structuredClone(DEFAULT_THEME), get sections() { throw new Error('boom'); } };
    const ve = validateBuilderDoc(exploding);
    assert.equal(ve.ok, false);
    assert.deepEqual(ve.problems.map(p => p.path), ['']);
    assert.match(ve.problems[0].message, /could not be read: boom/);
  });

  it('refuses a version it does not read and fields a document does not have', () => {
    const doc = createEmptyPage();
    doc.version = 2;
    assertOnlyProblem(doc, 'version', /newer builder \(version 2\)/);
    const doc2 = createEmptyPage();
    delete doc2.version;
    assertOnlyProblem(doc2, 'version', /has a version/);
    const doc3 = createEmptyPage();
    doc3.extra = true;
    assertOnlyProblem(doc3, 'extra', /not a field/);
  });

  it('refuses an unknown kind', () => {
    const doc = pageWith(widget('heading'));
    doc.sections[0].children[0].children[0].kind = 'row';
    assertOnlyProblem(doc, `${W}.kind`, /"row" is not a kind/);
  });

  it('refuses an unknown widget type', () => {
    assertOnlyProblem(pageWith({ id: 'w1', kind: 'widget', type: 'carousel', props: {}, style: { desktop: {} } }), `${W}.type`, /"carousel" is not a widget type/);
  });

  it('refuses an id used twice, naming where it was first used', () => {
    const doc = pageWith(widget('spacer'), { ...widget('spacer') });
    assertOnlyProblem(doc, 'sections[0].children[0].children[1].id', new RegExp(`already used at ${W.replace(/[[\]]/g, '\\$&')}`));
  });

  it('refuses an id that is not safe in CSS', () => {
    assertOnlyProblem(pageWith(widget('spacer', {}, { id: '1"><script>' })), `${W}.id`, /not an id/);
  });

  it('refuses a widget with children, even an empty list', () => {
    assertOnlyProblem(pageWith(widget('heading', {}, { children: [widget('spacer', {}, { id: 'w2' })] })), `${W}.children`, /widget holds no children/);
    assertOnlyProblem(pageWith(widget('heading', {}, { children: [] })), `${W}.children`, /widget holds no children/);
  });

  it('refuses a section that holds anything but columns, or no column, or too many', () => {
    const direct = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [widget('heading')])] };
    assertOnlyProblem(direct, 'sections[0].children[0]', /section holds columns only, so this widget needs a column/);
    const empty = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [])] };
    assertOnlyProblem(empty, 'sections[0].children', /at least one column/);
    const cols = Array.from({ length: LIMITS.maxColumns + 1 }, (_, i) => column(`c${i}`, []));
    const crowded = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', cols)] };
    assertOnlyProblem(crowded, 'sections[0].children', /at most 6 columns; this has 7/);
  });

  it('refuses a column or a widget straight on the page, and a column inside a column', () => {
    const colOnPage = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [column('c1', [])] };
    assertOnlyProblem(colOnPage, 'sections[0]', /column sits inside a section, not straight on the page/);
    const widgetOnPage = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [widget('spacer')] };
    assertOnlyProblem(widgetOnPage, 'sections[0]', /widget sits inside a column of a section/);
    assertOnlyProblem(pageWith(column('c2', [])), W, /column sits inside a section, not inside another column/);
  });

  it('accepts one inner section and refuses nesting deeper than section > column > inner section > column > widget', () => {
    const inner = section('i1', [column('ic1', [widget('heading', {}, { id: 'w2' })])]);
    assertValid(pageWith(inner), 'one inner section');
    const tooDeep = section('i1', [column('ic1', [section('i2', [column('ic2', [])])])]);
    assertOnlyProblem(pageWith(tooDeep), `${W}.children[0].children[0]`, /too deep: a page nests at most section > column > inner section > column > widget/);
  });

  it('refuses numbers that are not finite, in style and in props', () => {
    for (const bad of [NaN, Infinity, -Infinity, '12', null]) {
      assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { paddingTop: bad } } })), `${W}.style.desktop.paddingTop`, /not a finite number/);
      assertOnlyProblem(pageWith(widget('divider', { thickness: bad })), `${W}.props.thickness`, /not a finite number/);
    }
    assertOnlyProblem(pageWith(widget('countdown', { minutes: NaN })), `${W}.props.minutes`, /not a finite number/);
  });

  it('refuses numbers out of range and enum values off the list', () => {
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { fontSize: 2 } } })), `${W}.style.desktop.fontSize`, /outside 8 to 200 px/);
    assertOnlyProblem(pageWith(widget('heading', { level: 7 })), `${W}.props.level`, /not one of 1, 2, 3, 4, 5, 6/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { textAlign: 'middle' } } })), `${W}.style.desktop.textAlign`, /not one of/);
  });

  it('accepts #rgb, #rrggbb, #rrggbbaa and theme tokens, and refuses every other colour', () => {
    for (const good of ['#abc', '#A1B2C3', '#a1b2c3d4', 'theme.primary', 'theme.muted']) {
      assertValid(pageWith(widget('spacer', {}, { style: { desktop: { backgroundColor: good } } })), good);
      assertValid(pageWith(widget('divider', { color: good })), good);
    }
    for (const bad of ['red', '#12', '#12345', '#1234567', '#ggg', 'rgb(0,0,0)', 'theme.nope', 'theme.', 'var(--x)', '#fff;background:url(x)', '']) {
      assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { textColor: bad } } })), `${W}.style.desktop.textColor`, /not a colour|names no theme colour/);
      assertOnlyProblem(pageWith(widget('divider', { color: bad })), `${W}.props.color`, /not a colour|names no theme colour/);
    }
    const doc = createEmptyPage();
    doc.theme.colors.primary = 'theme.secondary';
    assertOnlyProblem(doc, 'theme.colors.primary', /theme colour is #rgb/);
  });

  it('accepts http(s), site-relative and anchor links, and refuses every other link', () => {
    for (const good of ['', 'https://example.com', 'http://example.com/a?b=c#d', '/p/offer', '/', '#offer']) {
      assertValid(pageWith(widget('button', { url: good })), `link ${good}`);
    }
    const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
      '//evil.example/x', 'ftp://example.com/f', 'mailto:a@example.com', 'https:example.com', ' https://example.com',
      'https://exa mple.com', 'https://example.com/\\x', '#', '#1abc', 'example.com', 'https://', 'p/offer'];
    for (const b of bad) {
      assertOnlyProblem(pageWith(widget('button', { url: b })), `${W}.props.url`);
      assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { backgroundImage: b } } })), `${W}.style.desktop.backgroundImage`);
    }
    assertOnlyProblem(pageWith(widget('button', { url: `https://example.com/${'a'.repeat(LIMITS.maxUrl)}` })), `${W}.props.url`, /at most 2048/);
  });

  it('plays video from YouTube and Vimeo only', () => {
    assertValid(pageWith(widget('video', { url: 'https://www.youtube.com/watch?v=abc' })), 'youtube');
    assertValid(pageWith(widget('video', { url: 'https://player.vimeo.com/video/1' })), 'vimeo');
    assertOnlyProblem(pageWith(widget('video', { url: 'https://evil.example/v.mp4' })), `${W}.props.url`, /YouTube or Vimeo only/);
    assertOnlyProblem(pageWith(widget('video', { url: '/media/v.mp4' })), `${W}.props.url`, /YouTube or Vimeo/);
  });

  it('refuses a string over 20,000 characters, wherever it is', () => {
    assertValid(pageWith(widget('heading', { text: 'x'.repeat(LIMITS.maxString) })), 'exactly the limit');
    assertOnlyProblem(pageWith(widget('heading', { text: 'x'.repeat(LIMITS.maxString + 1) })), `${W}.props.text`, /at most 20000 characters; this has 20001/);
    assertOnlyProblem(pageWith(widget('htmlEmbed', { html: 'x'.repeat(LIMITS.maxString + 1) })), `${W}.props.html`, /at most 20000/);
    assertOnlyProblem(pageWith(widget('faq', { items: [{ question: 'q', answer: 'x'.repeat(LIMITS.maxString + 1) }] })), `${W}.props.items[0].answer`, /at most 20000/);
  });

  it('refuses more than 200 nodes', () => {
    const widgets = Array.from({ length: LIMITS.maxNodes - 2 }, (_, i) => widget('spacer', {}, { id: `w${i}` }));
    assertValid(pageWith(...widgets), 'exactly 200 nodes');
    widgets.push(widget('spacer', {}, { id: 'one-more' }));
    assertOnlyProblem(pageWith(...widgets), 'sections', /at most 200 sections, columns and widgets; this has 201/);
  });

  it('refuses unknown props, list fields, style keys and devices, and a class off the desktop layer', () => {
    assertOnlyProblem(pageWith(widget('heading', { colour: 'red' })), `${W}.props.colour`, /not a prop/);
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const odd = () => JSON.parse(`{"${key}": 1}`);
      assertOnlyProblem(pageWith({ id: 'w1', kind: 'widget', type: 'heading', props: odd(), style: { desktop: {} } }), `${W}.props.${key}`, /not a prop/);
      assertOnlyProblem(pageWith({ id: 'w1', kind: 'widget', type: 'heading', props: {}, style: { desktop: odd() } }), `${W}.style.desktop.${key}`, /not a style key/);
      refused(insertNode(pageWith(), 'c1', 0, { id: 'w1', kind: 'widget', type: 'heading', props: odd(), style: { desktop: {} } }), /not a prop/, `inserting a widget with a ${key} prop`);
    }
    assert.equal(Object.prototype.polluted, undefined);
    assertOnlyProblem(pageWith(widget('faq', { items: [{ question: 'q', answer: 'a', extra: 1 }] })), `${W}.props.items[0].extra`, /not a field of a question/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { zIndex: 9 } } })), `${W}.style.desktop.zIndex`, /not a style key/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: {}, watch: {} } })), `${W}.style.watch`, /not a device/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: {}, mobile: { customClass: 'hero' } } })), `${W}.style.mobile.customClass`, /desktop layer/);
    assertValid(pageWith(widget('spacer', {}, { style: { desktop: { customClass: 'hero big' } } })), 'a class on desktop');
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { customClass: 'a{}' } } })), `${W}.style.desktop.customClass`, /class names/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: {} })), `${W}.style.desktop`, /desktop layer/);
    assertOnlyProblem(pageWith(widget('spacer', {}, { style: { desktop: { fontFamily: 'Comic Sans; color: red' } } })), `${W}.style.desktop.fontFamily`, /font family/);
    assertOnlyProblem(pageWith(widget('faq', { items: Array.from({ length: LIMITS.maxListItems + 1 }, () => ({ question: 'q', answer: 'a' })) })), `${W}.props.items`, /at most 50 items/);
  });

  it('reads an absent prop as its default rather than refusing it', () => {
    const doc = pageWith({ id: 'w1', kind: 'widget', type: 'checkoutButton', props: {}, style: { desktop: {} } });
    assertValid(doc, 'a widget with no props written');
    const props = propsWithDefaults(doc.sections[0].children[0].children[0]);
    assert.deepEqual(props, { ...WIDGET_REGISTRY.checkoutButton.defaultProps });
  });
});

describe('page builder model: resolveStyle', () => {
  const node = {
    style: {
      desktop: { paddingTop: 40, paddingBottom: 40, fontSize: 18, textAlign: 'left' },
      tablet: { paddingTop: 24, fontSize: 16 },
      mobile: { paddingTop: 12, textAlign: 'center', fontSize: undefined, paddingBottom: null }
    }
  };

  it('a mobile value wins over tablet, which wins over desktop', () => {
    assert.equal(resolveStyle(node, 'desktop').paddingTop, 40);
    assert.equal(resolveStyle(node, 'tablet').paddingTop, 24);
    assert.equal(resolveStyle(node, 'mobile').paddingTop, 12);
  });

  it('a key a layer leaves out is inherited, and undefined or null counts as left out', () => {
    assert.deepEqual(resolveStyle(node, 'desktop'), { paddingTop: 40, paddingBottom: 40, fontSize: 18, textAlign: 'left' });
    assert.deepEqual(resolveStyle(node, 'tablet'), { paddingTop: 24, paddingBottom: 40, fontSize: 16, textAlign: 'left' });
    assert.deepEqual(resolveStyle(node, 'mobile'), { paddingTop: 12, paddingBottom: 40, fontSize: 16, textAlign: 'center' });
  });

  it('an absent layer inherits everything, so mobile with no tablet layer inherits desktop', () => {
    const noTablet = { style: { desktop: { marginTop: 8, hidden: true }, mobile: { hidden: false } } };
    assert.deepEqual(resolveStyle(noTablet, 'tablet'), { marginTop: 8, hidden: true });
    assert.deepEqual(resolveStyle(noTablet, 'mobile'), { marginTop: 8, hidden: false });
    const desktopOnly = { style: { desktop: { width: 50 } } };
    assert.deepEqual(resolveStyle(desktopOnly, 'mobile'), { width: 50 });
  });

  it('answers a new object each time and leaves the node alone', () => {
    const before = structuredClone(node.style);
    const a = resolveStyle(node, 'mobile');
    a.paddingTop = 999;
    assert.equal(resolveStyle(node, 'mobile').paddingTop, 12);
    assert.deepEqual({ desktop: node.style.desktop, tablet: node.style.tablet }, { desktop: before.desktop, tablet: before.tablet });
    assert.deepEqual(resolveStyle({}, 'mobile'), {});
    assert.deepEqual(resolveStyle(null, 'tablet'), {});
  });

  it('throws on a device that does not exist, which is a programming error', () => {
    assert.throws(() => resolveStyle(node, 'watch'), TypeError);
  });

  it('covers every style key the types name', () => {
    const types = fs.readFileSync(new URL('./src/types/pageBuilder.ts', import.meta.url), 'utf8');
    const block = types.slice(types.indexOf('export interface StyleValues {'), types.indexOf('export interface DeviceStyle'));
    const named = [...block.matchAll(/^\s{2}(\w+)\?:/gm)].map(m => m[1]).sort();
    assert.deepEqual(Object.keys(STYLE_KEYS).sort(), named);
  });
});

describe('page builder model: tree operations', () => {
  it('builds, rearranges and trims a page, valid with unique ids after every step', () => {
    let doc = createEmptyPage();
    const sA = createNode('section');
    const colA1 = sA.children[0].id;
    doc = ok(op(insertNode, doc, null, 0, sA), 'insert section A').doc;
    const colA2 = createNode('column');
    doc = ok(op(insertNode, doc, sA.id, 1, colA2), 'insert a second column').doc;
    const h1 = createNode('widget', 'heading');
    const t1 = createNode('widget', 'text');
    doc = ok(op(insertNode, doc, colA1, 0, h1), 'insert a heading').doc;
    doc = ok(op(insertNode, doc, colA1, 1, t1), 'insert a text').doc;
    const inner = createNode('section');
    const innerCol = inner.children[0].id;
    doc = ok(op(insertNode, doc, colA2.id, 0, inner), 'insert an inner section').doc;
    const b1 = createNode('widget', 'button');
    doc = ok(op(insertNode, doc, innerCol, 0, b1), 'insert a button in the inner section').doc;
    const sB = createNode('section');
    const colB = sB.children[0].id;
    doc = ok(op(insertNode, doc, null, 1, sB), 'insert section B').doc;

    doc = ok(op(moveNode, doc, h1.id, colB, 0), 'move the heading to section B').doc;
    assert.deepEqual(findNode(doc, colB).node.children.map(n => n.id), [h1.id]);
    doc = ok(op(moveNode, doc, t1.id, innerCol, 1), 'move the text into the inner section').doc;
    assert.deepEqual(findNode(doc, innerCol).node.children.map(n => n.id), [b1.id, t1.id]);
    doc = ok(op(moveNode, doc, t1.id, innerCol, 0), 'reorder inside a column').doc;
    assert.deepEqual(findNode(doc, innerCol).node.children.map(n => n.id), [t1.id, b1.id]);
    doc = ok(op(moveNode, doc, sB.id, null, 0), 'reorder the sections').doc;
    assert.deepEqual(doc.sections.map(s => s.id), [sB.id, sA.id]);
    doc = ok(op(moveNode, doc, colA2.id, sA.id, 0), 'reorder columns').doc;
    assert.deepEqual(findNode(doc, sA.id).node.children.map(c => c.id), [colA2.id, colA1]);
    doc = ok(op(moveNode, doc, inner.id, null, 2), 'lift the inner section onto the page').doc;
    assert.equal(findNode(doc, inner.id).parent, null);
    doc = ok(op(moveNode, doc, inner.id, colA1, 0), 'put it back in a column').doc;
    assert.equal(findNode(doc, inner.id).parent.id, colA1);

    const dup = ok(op(duplicateNode, doc, sA.id), 'duplicate section A with its inner section');
    doc = dup.doc;
    assert.equal(doc.sections[2].id, dup.id, 'the copy sits right after the original');
    doc = ok(op(removeNode, doc, colA2.id), 'remove a column').doc;
    assert.equal(findNode(doc, colA2.id), null);
    doc = ok(op(removeNode, doc, sB.id), 'remove section B').doc;
    assert.equal(findNode(doc, h1.id), null, 'its contents went with it');
    doc = ok(op(removeNode, doc, b1.id), 'remove a widget').doc;
    assert.equal(findNode(doc, b1.id), null);
    assert.equal(doc.sections.length, 2);
  });

  it('removeNode takes the node and everything under it out of the document', () => {
    const page = pageWith(widget('heading', {}, { id: 'keep' }), widget('text', {}, { id: 'gone' }));
    const r = ok(op(removeNode, page, 'gone'), 'remove');
    assert.equal(r.id, 'gone');
    assert.deepEqual(allIds(r.doc), ['s1', 'c1', 'keep']);
    const r2 = ok(op(removeNode, r.doc, 's1'), 'remove the only section');
    assert.deepEqual(r2.doc.sections, []);
  });

  it('findNode answers the node, its parent and its index, or null', () => {
    const page = pageWith(widget('heading', {}, { id: 'a' }), widget('text', {}, { id: 'b' }));
    const found = findNode(page, 'b');
    assert.equal(found.node.id, 'b');
    assert.equal(found.parent.id, 'c1');
    assert.equal(found.index, 1);
    assert.equal(findNode(page, 's1').parent, null);
    assert.equal(findNode(page, 'nope'), null);
  });

  it('walk visits parents before children and can skip a subtree', () => {
    const page = pageWith(widget('heading', {}, { id: 'a' }), section('i1', [column('ic1', [widget('text', {}, { id: 'b' })])]));
    const seen = [];
    walk(page, (node, info) => { seen.push(`${node.id}@${info.depth}`); });
    assert.deepEqual(seen, ['s1@0', 'c1@1', 'a@2', 'i1@2', 'ic1@3', 'b@4']);
    const skipped = [];
    walk(page, node => { skipped.push(node.id); return node.id !== 'i1'; });
    assert.deepEqual(skipped, ['s1', 'c1', 'a', 'i1']);
  });

  it('moveNode refuses every illegal nest with a reason and changes nothing', () => {
    const page = {
      version: 1, theme: structuredClone(DEFAULT_THEME), sections: [
        section('sA', [column('cA1', [widget('heading', {}, { id: 'h' }), section('iA', [column('icA', [widget('text', {}, { id: 't' })])])]), column('cA2', [])]),
        section('sB', [column('cB', [section('iB', [column('icB', [])])])]),
        section('sC', [column('cC', [widget('spacer', {}, { id: 'sp' })])])
      ]
    };
    assertValid(page, 'the fixture');
    refused(op(moveNode, page, 'h', 'sA', 0), /section holds columns only, so this widget needs a column/, 'a widget into a section');
    refused(op(moveNode, page, 'cA2', 'cA1', 0), /column sits inside a section, not inside another column/, 'a column into a column');
    refused(op(moveNode, page, 'cA2', null, 0), /column sits inside a section, not straight on the page/, 'a column onto the page');
    refused(op(moveNode, page, 'h', null, 0), /widget sits inside a column of a section, not straight on the page/, 'a widget onto the page');
    refused(op(moveNode, page, 'iA', 'icB', 0), /too deep/, 'an inner section into an inner column');
    refused(op(moveNode, page, 'sA', 'cB', 0), /too deep/, 'a section holding an inner section into a column');
    refused(op(moveNode, page, 'sA', 'sA', 0), /into itself/, 'a section into itself');
    refused(op(moveNode, page, 'sA', 'icA', 0), /own contents/, 'a section into its own inner column');
    refused(op(moveNode, page, 'cB', 'sA', 0), /keeps at least one column/, 'the last column out of a section');
    refused(op(moveNode, page, 'icA', 'sA', 0), /keeps at least one column/, 'the last column out of an inner section');
    refused(op(moveNode, page, 't', 'h', 0), /widget holds no children/, 'into a widget');
    refused(op(moveNode, page, 'h', 'cA2', 5), /outside 0 to 0/, 'past the end');
    refused(op(moveNode, page, 'h', 'cA2', -1), /outside/, 'a negative position');
    refused(op(moveNode, page, 'h', 'cA2', 0.5), /outside/, 'a fractional position');
    refused(op(moveNode, page, 'nope', 'cA2', 0), /no node has id "nope"/, 'a node that is not there');
    refused(op(moveNode, page, 'h', 'nope', 0), /no node has id "nope"/, 'a parent that is not there');
    // The legal cousins of those moves, so the refusals above are about the nest and not the ids.
    ok(op(moveNode, page, 'h', 'cA2', 0), 'a widget into another column');
    ok(op(moveNode, page, 'iA', 'cA2', 0), 'an inner section into another column');
    ok(op(moveNode, page, 'cA2', 'iB', 1), 'a column into an inner section');
    ok(op(moveNode, page, 'sC', 'cA2', 0), 'a section holding no inner section into a column');
  });

  it('insertNode checks the new node in full where it would sit', () => {
    const page = pageWith(widget('heading', {}, { id: 'h' }));
    refused(op(insertNode, page, 'c1', 0, widget('text', {}, { id: 'h' })), /already used/, 'an id the page already has');
    refused(op(insertNode, page, 'c1', 0, widget('heading', { level: 9 }, { id: 'h2' })), /not one of.*\(at props\.level\)/, 'a bad prop');
    refused(op(insertNode, page, 'c1', 0, widget('heading', {}, { id: 'h2', children: [] })), /widget holds no children/, 'a widget with children');
    refused(op(insertNode, page, 's1', 1, widget('spacer', {}, { id: 'w9' })), /columns only/, 'a widget into a section');
    refused(op(insertNode, page, null, 0, createNode('column')), /not straight on the page/, 'a column onto the page');
    refused(op(insertNode, page, 'c1', 2, createNode('widget', 'text')), /outside 0 to 1/, 'past the end');
    refused(op(insertNode, page, 'h', 0, createNode('widget', 'text')), /widget holds no children/, 'into a widget');
    const twin = createNode('section');
    twin.children.push({ ...twin.children[0] });
    refused(op(insertNode, page, null, 1, twin), /already used/, 'a node whose own subtree repeats an id');
    let full = pageWith();
    for (let i = 1; i < LIMITS.maxColumns; i++) full = ok(insertNode(full, 's1', i, createNode('column')), `column ${i + 1}`).doc;
    refused(op(insertNode, full, 's1', 0, createNode('column')), /at most 6 columns/, 'a seventh column');
    const many = pageWith(...Array.from({ length: LIMITS.maxNodes - 2 }, (_, i) => widget('spacer', {}, { id: `w${i}` })));
    refused(op(insertNode, many, 'c1', 0, createNode('widget', 'spacer')), /at most 200/, 'the 201st node');
    refused(op(duplicateNode, many, 'w0'), /at most 200/, 'a copy that makes 201');
  });

  it('every widget type from createNode inserts into a column and stays valid', () => {
    let doc = pageWith();
    let index = 0;
    for (const type of Object.keys(WIDGET_REGISTRY)) {
      doc = ok(op(insertNode, doc, 'c1', index++, createNode('widget', type)), `insert ${type}`).doc;
    }
    assert.equal(countNodes(doc), 2 + Object.keys(WIDGET_REGISTRY).length);
  });

  it('removeNode keeps a section\'s last column and refuses an id that is not there', () => {
    const page = pageWith(widget('spacer'));
    refused(op(removeNode, page, 'c1'), /keeps at least one column: remove the section instead/, 'the last column');
    refused(op(removeNode, page, 'nope'), /no node has id/, 'a missing node');
    refused(op(removeNode, null, 'c1'), /no sections list/, 'no document');
  });

  it('duplicateNode mints a fresh id for every node in the copy', () => {
    const page = pageWith(widget('heading', { text: 'Hi' }, { id: 'h' }), section('i1', [column('ic1', [widget('text', { text: 'Body' }, { id: 't' }), widget('button', { label: 'Go' }, { id: 'b' })])]));
    const original = new Set(allIds(page));
    const r = ok(op(duplicateNode, page, 's1'), 'duplicate the section');
    const copy = r.doc.sections[1];
    assert.equal(copy.id, r.id);
    const copyIds = allIds({ sections: [copy] });
    assert.equal(copyIds.length, 7, 'section, column, heading, inner section, inner column, text, button');
    for (const id of copyIds) assert.ok(!original.has(id), `${id} is new`);
    const strip = n => { const { id, children, ...rest } = n; return children ? { ...rest, children: children.map(strip) } : rest; };
    assert.deepEqual(strip(copy), strip(page.sections[0]), 'the copy is the same apart from its ids');
    const again = ok(op(duplicateNode, r.doc, 'i1'), 'duplicate the inner section too');
    assert.equal(findNode(again.doc, again.id).index, 2, 'right after the original in its column');
    const widgetCopy = ok(op(duplicateNode, page, 'h'), 'duplicate a widget');
    assert.match(widgetCopy.id, /^heading-[a-z0-9]{10}$/);
  });

  it('no operation throws on a document it cannot read', () => {
    for (const bad of [null, 42, {}, { sections: 'x' }]) {
      refused(insertNode(bad, null, 0, createNode('section')), /no sections list/, 'insert');
      refused(moveNode(bad, 'a', null, 0), /no sections list/, 'move');
      refused(removeNode(bad, 'a'), /no sections list/, 'remove');
      refused(duplicateNode(bad, 'a'), /no sections list/, 'duplicate');
    }
  });
});

describe('page builder model: createEmptyPage', () => {
  it('validates, with the default theme or a partial one laid over it', () => {
    const empty = createEmptyPage();
    assertValid(empty, 'empty page');
    assert.deepEqual(empty.sections, []);
    assert.deepEqual(empty.theme, structuredClone(DEFAULT_THEME));
    const themed = createEmptyPage({ colors: { primary: '#000' }, fonts: { heading: 'Inter' } });
    assertValid(themed, 'themed page');
    assert.equal(themed.theme.colors.primary, '#000');
    assert.equal(themed.theme.colors.surface, DEFAULT_THEME.colors.surface);
    assert.equal(themed.theme.fonts.heading, 'Inter');
    assert.equal(themed.theme.fonts.body, DEFAULT_THEME.fonts.body);
    themed.theme.colors.text = '#111';
    assert.notEqual(DEFAULT_THEME.colors.text, '#111', 'the default theme is never shared');
  });
});

// ---- migration ----

/** Every leaf of every widget's props, as [path, value], where path is `<widget id>.props.<...>`. */
function widgetLeaves(doc) {
  const out = [];
  const visit = (value, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
    else out.push([path, value]);
  };
  walk(doc, node => { if (node.kind === 'widget') visit(node.props, `${node.id}.props`); });
  return out;
}

function pathsOf(doc, value) {
  return widgetLeaves(doc).filter(([, v]) => v === value).map(([p]) => p);
}

function prop(doc, id) {
  const found = findNode(doc, id);
  assert.ok(found, `widget ${id} exists`);
  return found.node.props;
}

// A page that sets every field, each string to a value found nowhere else, so where a value
// lands can be counted.
const FULL = {
  type: 'landing-page',
  label: 'S-label',
  slug: 's-slug',
  headline: 'S-headline',
  subhead: 'S-subhead',
  bullets: ['S-bullet-1', 'S-bullet-2'],
  trustBadge: 'S-trust',
  buttonText: 'S-button',
  heroImageUrl: 'https://img.example.com/S-hero.jpg',
  shopifyProductId: 'S-product-id',
  shopifyVariantId: 'S-variant-id',
  shopifyCollectionId: 'S-collection-id',
  cartAction: 'add',
  shopifyProductTitle: 'S-product-title',
  shopifyProductPrice: 'S-29.00',
  shopifyProductImage: 'https://img.example.com/S-product.jpg',
  discountCode: 'S-CODE',
  checkoutMode: 'lead-gate',
  checkoutUrl: 'https://S-checkout-url.example.com/',
  published: true,
  publishedAt: 'S-published-at',
  publishedUrl: 'https://S-published-url.example.com/',
  customDomain: 'S-domain.example.com',
  customDomainVerified: true,
  webhookUrl: 'https://S-webhook.example.com/',
  metaPixelId: 'S-meta-pixel',
  tiktokPixelId: 'S-tiktok-pixel',
  ga4TrackingId: 'S-ga4',
  postSubmitAction: 'custom_url',
  customRedirectUrl: 'https://S-redirect.example.com/',
  orderBumpEnabled: true,
  orderBumpProductId: 'S-bump-product-id',
  orderBumpVariantId: 'S-bump-variant-id',
  orderBumpTitle: 'S-bump-title',
  orderBumpPrice: 'S-7.00',
  orderBumpImage: 'https://img.example.com/S-bump.jpg',
  orderBumpHeadline: 'S-bump-headline',
  orderBumpDescription: 'S-bump-description',
  abTestingEnabled: true,
  splitRatio: 50,
  variantB: {
    headline: 'S-B-headline',
    subhead: 'S-B-subhead',
    bullets: ['S-B-bullet'],
    buttonText: 'S-B-button',
    heroImageUrl: 'https://img.example.com/S-B-hero.jpg',
    discountCode: 'S-B-CODE',
    trustBadge: 'S-B-trust',
    visitors: 11,
    conversions: 3,
    conversionRate: 27,
    grossRevenue: 99
  },
  variantAVisitors: 12,
  variantAConversions: 4,
  variantAGrossRevenue: 98,
  variantBVisitors: 13,
  variantBConversions: 5,
  variantBGrossRevenue: 97,
  urgencyTimerEnabled: true,
  urgencyMinutes: 17,
  urgencyText: 'S-urgency',
  scarcityBatchEnabled: true,
  scarcityBatchCount: 23,
  scarcityBatchText: 'S-scarcity',
  postSubmitExperience: 'vip_voucher_modal',
  exitIntentEnabled: true,
  exitIntentHeadline: 'S-exit-headline',
  exitIntentSubhead: 'S-exit-subhead',
  exitIntentDiscountCode: 'S-EXIT-CODE',
  exitIntentButtonText: 'S-exit-button',
  exitIntentBadge: 'S-exit-badge',
  mobileStickyBarEnabled: true,
  cookieConsentEnabled: true,
  cookieConsentGeoTarget: 'all_visitors',
  privacyPolicyUrl: 'https://S-privacy.example.com/',
  socialProofWallEnabled: true,
  socialProofMinRating: 3,
  socialProofHeadline: 'S-reviews-headline',
  socialProofPhotosEnabled: false,
  visitors: 101,
  conversions: 7,
  conversionRate: 6.9,
  grossRevenue: 500,
  orderBumpRevenue: 40,
  orderBumpTakes: 6,
  bumpTakeRate: 0.3,
  aov: 71,
  liveRevenue: 300,
  liveOrders: 4,
  liveBumpOrders: 2
};

// Where each field the page shows lands, as `<widget id>.props.<prop>`.
const LANDS = {
  headline: 'legacy-headline.props.text',
  subhead: 'legacy-subhead.props.text',
  trustBadge: 'legacy-trust.props.text',
  buttonText: 'legacy-checkout.props.label',
  heroImageUrl: 'legacy-product.props.imageUrl',
  shopifyProductId: 'legacy-product.props.productId',
  shopifyVariantId: 'legacy-product.props.variantId',
  shopifyCollectionId: 'legacy-product.props.collectionId',
  shopifyProductTitle: 'legacy-product.props.title',
  shopifyProductPrice: 'legacy-product.props.price',
  shopifyProductImage: 'legacy-product.props.productImage',
  discountCode: 'legacy-checkout.props.discountCode',
  orderBumpProductId: 'legacy-bump.props.productId',
  orderBumpVariantId: 'legacy-bump.props.variantId',
  orderBumpTitle: 'legacy-bump.props.title',
  orderBumpPrice: 'legacy-bump.props.price',
  orderBumpImage: 'legacy-bump.props.image',
  orderBumpHeadline: 'legacy-bump.props.headline',
  orderBumpDescription: 'legacy-bump.props.description',
  urgencyText: 'legacy-countdown-timer.props.text',
  scarcityBatchText: 'legacy-stock.props.text',
  socialProofHeadline: 'legacy-reviews-wall.props.headline'
};

// Fields the fixed frame reads from the node (or nothing reads today): they stay on the node and
// reach no widget.
const FRAME = ['label', 'slug', 'checkoutUrl', 'publishedAt', 'publishedUrl', 'customDomain', 'webhookUrl', 'metaPixelId',
  'tiktokPixelId', 'ga4TrackingId', 'customRedirectUrl', 'exitIntentHeadline', 'exitIntentSubhead', 'exitIntentDiscountCode',
  'exitIntentButtonText', 'exitIntentBadge', 'privacyPolicyUrl'];

describe('page builder model: migrateLegacyPage', () => {
  const doc = migrateLegacyPage(FULL);

  it('turns a page that sets every field into a valid document', () => {
    assertValidAndUnique(doc, 'the full page');
    assert.deepEqual(doc.sections.map(s => s.id), ['legacy-countdown', 'legacy-offer', 'legacy-reviews']);
    assert.deepEqual(findNode(doc, 'legacy-offer-copy').node.children.map(w => w.id),
      ['legacy-stock', 'legacy-headline', 'legacy-subhead', 'legacy-bullets', 'legacy-trust', 'legacy-bump', 'legacy-checkout'],
      'the copy column keeps today\'s order');
    assert.deepEqual(findNode(doc, 'legacy-offer-media').node.children.map(w => w.id), ['legacy-product']);
  });

  it('carries each text field into exactly one widget prop', () => {
    for (const [field, path] of Object.entries(LANDS)) {
      assert.deepEqual(pathsOf(doc, FULL[field]), [path], `${field} lands at ${path} and nowhere else`);
    }
    assert.deepEqual(pathsOf(doc, 'S-bullet-1'), ['legacy-bullets.props.items[0].text']);
    assert.deepEqual(pathsOf(doc, 'S-bullet-2'), ['legacy-bullets.props.items[1].text']);
  });

  it('carries the choices and the numbers into their props', () => {
    assert.equal(prop(doc, 'legacy-checkout').checkoutMode, 'lead-gate');
    assert.equal(prop(doc, 'legacy-checkout').cartAction, 'add');
    assert.equal(prop(doc, 'legacy-countdown-timer').minutes, 17);
    assert.equal(prop(doc, 'legacy-countdown-timer').mode, 'evergreen');
    assert.equal(prop(doc, 'legacy-stock').count, 23);
    assert.equal(prop(doc, 'legacy-reviews-wall').minRating, 3);
    assert.equal(prop(doc, 'legacy-reviews-wall').photos, false);
    assert.equal(prop(doc, 'legacy-headline').level, 1);
    const checkout = migrateLegacyPage({ ...FULL, checkoutMode: undefined, cartAction: undefined });
    assert.equal(prop(checkout, 'legacy-checkout').checkoutMode, 'direct');
    assert.equal(prop(checkout, 'legacy-checkout').cartAction, 'checkout');
  });

  it('leaves the frame\'s fields, version B and the metrics on the node', () => {
    const json = JSON.stringify(doc);
    for (const field of FRAME) assert.ok(!json.includes(String(FULL[field])), `${field} stays on the node`);
    for (const [key, value] of Object.entries(FULL.variantB)) {
      if (typeof value === 'string') assert.ok(!json.includes(value), `variantB.${key} is not in version A`);
    }
    assert.equal(FULL.builder, undefined, 'the input is not changed');
  });

  it('shows what today\'s page shows, pinned against previewPageCopy', () => {
    const preview = previewPageCopy(FULL);
    assert.equal(prop(doc, 'legacy-headline').text, preview.headline);
    assert.equal(prop(doc, 'legacy-subhead').text, preview.subhead);
    assert.deepEqual(prop(doc, 'legacy-bullets').items.map(i => i.text), preview.bullets);
    assert.equal(prop(doc, 'legacy-checkout').label, preview.buttonText);
    assert.equal(prop(doc, 'legacy-checkout').discountCode, preview.discountCode);
    assert.equal(prop(doc, 'legacy-trust').text, preview.trustBadge);
    assert.deepEqual({ text: prop(doc, 'legacy-countdown-timer').text, minutes: prop(doc, 'legacy-countdown-timer').minutes }, preview.urgency);
    assert.equal(prop(doc, 'legacy-stock').text, preview.scarcity);
    const bump = prop(doc, 'legacy-bump');
    assert.deepEqual({ headline: bump.headline, description: bump.description, title: bump.title, price: bump.price }, preview.bump);
    assert.equal(prop(doc, 'legacy-product').price, preview.productPrice);
    const product = prop(doc, 'legacy-product');
    assert.equal(product.productImage || product.imageUrl, preview.heroImage);
  });

  it('builds version B the way the live page merges it, with the same ids', () => {
    const b = migrateLegacyPage(FULL, { variant: 'b' });
    assertValidAndUnique(b, 'version B');
    assert.deepEqual(allIds(b), allIds(doc), 'the same ids in both versions');
    const landsB = {
      headline: 'legacy-headline.props.text', subhead: 'legacy-subhead.props.text', buttonText: 'legacy-checkout.props.label',
      heroImageUrl: 'legacy-product.props.imageUrl', discountCode: 'legacy-checkout.props.discountCode', trustBadge: 'legacy-trust.props.text'
    };
    for (const [field, path] of Object.entries(landsB)) {
      assert.deepEqual(pathsOf(b, FULL.variantB[field]), [path], `variantB.${field} lands at ${path}`);
      assert.deepEqual(pathsOf(b, FULL[field]), [], `version A's ${field} is replaced`);
    }
    assert.deepEqual(prop(b, 'legacy-bullets').items, [{ text: 'S-B-bullet' }]);
    const preview = previewPageCopy(FULL, FULL.variantB);
    assert.equal(prop(b, 'legacy-headline').text, preview.headline);
    assert.equal(prop(b, 'legacy-subhead').text, preview.subhead);
    assert.deepEqual(prop(b, 'legacy-bullets').items.map(i => i.text), preview.bullets);
    assert.equal(prop(b, 'legacy-checkout').label, preview.buttonText);
    assert.equal(prop(b, 'legacy-checkout').discountCode, preview.discountCode);
    assert.equal(prop(b, 'legacy-trust').text, preview.trustBadge);
    // A blank code in version B is version B's choice, as on the live page.
    const noCode = migrateLegacyPage({ ...FULL, variantB: { ...FULL.variantB, discountCode: '' } }, { variant: 'b' });
    assert.equal(prop(noCode, 'legacy-checkout').discountCode, '');
    assert.equal(previewPageCopy(FULL, { ...FULL.variantB, discountCode: '' }).discountCode, '');
    // Asking for B on a page without one gives version A.
    assert.deepEqual(migrateLegacyPage({ ...FULL, variantB: undefined }, { variant: 'b' }), migrateLegacyPage({ ...FULL, variantB: undefined }));
  });

  it('turns an empty node, nothing at all, and the starter map\'s page into valid documents', () => {
    for (const input of [{}, { type: 'landing-page' }, undefined, null, 'page', 42]) {
      const empty = migrateLegacyPage(input);
      assertValidAndUnique(empty, `migrate ${JSON.stringify(input)}`);
      // The reviews wall is on unless switched off, as today; it shows only when reviews exist.
      assert.deepEqual(empty.sections.map(s => s.id), ['legacy-offer', 'legacy-reviews']);
      assert.deepEqual(findNode(empty, 'legacy-offer-copy').node.children.map(w => w.id), ['legacy-headline', 'legacy-checkout']);
      assert.equal(prop(empty, 'legacy-headline').text, '', `today's page shows "${HEADLINE_FALLBACK}" here; the builder shows a hint and writes no copy`);
      assert.equal(prop(empty, 'legacy-checkout').label, '', 'the label falls back at render time, never in the document');
    }
    const starter = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.data.type === 'landing-page');
    assert.ok(starter, 'the starter map has a landing page');
    const fromStarter = migrateLegacyPage(starter.data);
    assertValidAndUnique(fromStarter, 'the starter map\'s page');
    assert.equal(prop(fromStarter, 'legacy-checkout').checkoutMode, 'lead-gate');
    assert.equal(prop(fromStarter, 'legacy-product').imageUrl, starter.data.heroImageUrl);
  });

  it('is deterministic', () => {
    assert.deepEqual(migrateLegacyPage(FULL), migrateLegacyPage(FULL));
  });

  it('leaves out what today\'s page leaves out, as previewPageCopy does', () => {
    const seeded = {
      ...FULL,
      subhead: 'Describe what the visitor gets.',
      bullets: ['New value point', '  ', 'S-real-bullet'],
      trustBadge: 'Rated 4.9/5 by verified customers',
      scarcityBatchText: 'Only 14 units remaining',
      shopifyVariantId: ' 42109840192 ',
      orderBumpVariantId: '42109840999'
    };
    const m = migrateLegacyPage(seeded);
    assertValidAndUnique(m, 'the seeded page');
    const preview = previewPageCopy(seeded);
    assert.equal(findNode(m, 'legacy-subhead'), null);
    assert.equal(preview.subhead, '');
    assert.deepEqual(prop(m, 'legacy-bullets').items.map(i => i.text), ['S-real-bullet']);
    assert.deepEqual(preview.bullets, ['S-real-bullet']);
    assert.equal(findNode(m, 'legacy-trust'), null);
    assert.equal(preview.trustBadge, '');
    assert.equal(findNode(m, 'legacy-stock'), null, 'a seeded stock line shows nothing, count or not');
    assert.equal(preview.scarcity, '');
    const product = prop(m, 'legacy-product');
    assert.equal(product.title, '');
    assert.equal(product.price, '');
    assert.equal(product.price, preview.productPrice);
    assert.equal(product.productImage, '');
    assert.equal(product.productImage || product.imageUrl, preview.heroImage);
    assert.equal(product.variantId, ' 42109840192 ', 'the id itself is kept; checkout refuses it as today');
    const bump = prop(m, 'legacy-bump');
    assert.deepEqual([bump.title, bump.price, bump.image], ['', '', '']);
    assert.equal(bump.headline, 'S-bump-headline', 'the merchant\'s own words on the bump stay');
    assert.equal(preview.bump, null);
    assert.equal(preview.bumpNeedsProduct, true);
  });

  it('creates the countdown, stock line, bump and reviews only when the page shows them', () => {
    const off = migrateLegacyPage({ ...FULL, urgencyTimerEnabled: false, scarcityBatchEnabled: false, orderBumpEnabled: 'yes', socialProofWallEnabled: false });
    assertValid(off, 'all switched off');
    for (const id of ['legacy-countdown', 'legacy-stock', 'legacy-bump', 'legacy-reviews']) assert.equal(findNode(off, id), null, `${id} is absent`);
    const noMinutes = migrateLegacyPage({ ...FULL, urgencyMinutes: 0 });
    assert.equal(findNode(noMinutes, 'legacy-countdown'), null);
    assert.equal(previewPageCopy({ ...FULL, urgencyMinutes: 0 }).urgency, null);
    const countOnly = migrateLegacyPage({ ...FULL, scarcityBatchText: '' });
    assert.deepEqual(prop(countOnly, 'legacy-stock'), { text: '', count: 23 });
    assert.equal(previewPageCopy({ ...FULL, scarcityBatchText: '' }).scarcity, 'Limited batch: 23 units remaining');
    assert.equal(WIDGET_REGISTRY.stockCount.fallbacks.text.replace('{count}', '23'), 'Limited batch: 23 units remaining');
    const reviewsDefault = migrateLegacyPage({ ...FULL, socialProofWallEnabled: undefined, socialProofMinRating: undefined, socialProofPhotosEnabled: undefined });
    assert.deepEqual(prop(reviewsDefault, 'legacy-reviews-wall'), { headline: 'S-reviews-headline', minRating: 4, photos: true });
  });

  it('keeps every converted document valid when a field holds something the builder refuses', () => {
    const odd = {
      ...FULL,
      heroImageUrl: 'javascript:alert(1)',
      shopifyProductImage: 'data:image/png;base64,AAAA',
      orderBumpImage: '//cdn.example.com/x.png',
      urgencyMinutes: 9e9,
      scarcityBatchCount: '40',
      socialProofMinRating: 9,
      headline: 42,
      bullets: 'not a list',
      shopifyProductId: 1234567
    };
    const m = migrateLegacyPage(odd);
    assertValidAndUnique(m, 'odd values');
    assert.equal(prop(m, 'legacy-product').imageUrl, '');
    assert.equal(prop(m, 'legacy-product').productImage, '');
    assert.equal(prop(m, 'legacy-bump').image, '');
    assert.equal(prop(m, 'legacy-countdown-timer').minutes, 525600);
    assert.equal(prop(m, 'legacy-stock').count, 40);
    assert.equal(prop(m, 'legacy-reviews-wall').minRating, 5);
    assert.equal(prop(m, 'legacy-headline').text, '');
    assert.equal(findNode(m, 'legacy-bullets'), null);
    assert.equal(prop(m, 'legacy-product').productId, '1234567');
  });
});

describe('page builder model: house rules', () => {
  it('has no em dash and no spaced en dash in its source, types or design notes', () => {
    for (const file of ['./src/lib/pageBuilder/model.mjs', './src/lib/pageBuilder/model.d.mts', './src/types/pageBuilder.ts', './LANDING_BUILDER_DESIGN.md']) {
      const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.ok(!text.includes('\u2014'), `${file} has an em dash`);
      assert.ok(!/\s–\s/.test(text), `${file} has a spaced en dash`);
    }
  });

  it('adds builder to the page node and nothing else to journey.ts\'s imports', () => {
    const journey = fs.readFileSync(new URL('./src/types/journey.ts', import.meta.url), 'utf8');
    assert.match(journey, /^import type \{ BuilderDoc \} from '\.\/pageBuilder';$/m);
    const pageNode = journey.slice(journey.indexOf('export interface PageNodeData'), journey.indexOf('export interface PageVariantData'));
    assert.match(pageNode, /^\s+builder\?: BuilderDoc;$/m);
  });
});
