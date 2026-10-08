// Page motion, published side, fix round 3: "visitors whose device asks for less motion see none"
// (the Motion hint in BuilderThemePanel.tsx). A reviewer measured the exit drawer still sliding and
// its backdrop still fading under prefers-reduced-motion: reduce, and the cookie banner did the same.
// What these hold, over the CSS each piece writes and over a page served by the real routes:
// - every transition and animation the builder frame writes sits inside
//   `@media screen and (prefers-reduced-motion: no-preference)`, and none is left in a style attribute;
// - the cookie banner (withTracking, shared with legacy pages and pinned by the legacy snapshot, so its
//   CSS cannot move) is turned off by the frame in the exact complement of that query, and the banner's
//   markup sits where that rule reaches it;
// - on a served builder page with motion, an exit drawer, a lead modal and the banner, every moving
//   declaration in every <style> is behind the no-preference query or is the banner's, and every
//   hover or press transform is too;
// - render() itself, at subtle and cinematic over every widget type, moves nothing outside a
//   no-preference block.
// The same promise is driven in Chrome by scripts/builder-serve-browser-check.mjs (reduced motion, frame).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setPublicContext, setupPublicRoutes } from './server/routes/publicRoutes.mjs';
import { exitDrawerHtml, frameCss, leadModalHtml, lightboxHtml, stickyBarHtml } from './server/routes/publicBuilderScript.mjs';
import { WIDGET_REGISTRY, createNode, insertNode, migrateLegacyPage } from './src/lib/pageBuilder/model.mjs';
import { render } from './src/lib/pageBuilder/render.mjs';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';

const NO_PREF = '@media screen and (prefers-reduced-motion: no-preference)';
const COMPLEMENT = '@media not screen and (prefers-reduced-motion: no-preference)';

// ---- a small CSS reader: every rule with the at-rules around it ----

/** Each style rule as { at: [enclosing at-rule preludes], selector, decls: [[prop, value]] }. */
function cssRules(css) {
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (prelude.startsWith('@')) {
        stack.push(prelude);
        continue;
      }
      const end = src.indexOf('}', i);
      const decls = src.slice(i + 1, end).split(';').map(d => d.trim()).filter(Boolean).map(d => {
        const k = d.indexOf(':');
        return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()];
      });
      out.push({ at: [...stack], selector: prelude, decls });
      i = end;
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

/** A declaration that makes something move over time. */
function moving([prop, value]) {
  if (prop === 'transition' || prop === 'animation' || prop === 'animation-name') return !/^none\b/i.test(value);
  if (prop === 'transition-duration' || prop === 'animation-duration') return !/^0m?s$/i.test(value);
  return false;
}
const inKeyframes = r => r.at.some(a => a.startsWith('@keyframes'));
const behindNoPreference = r => r.at.some(a => a.startsWith('@media') && !/^@media not\b/.test(a) && a.includes('(prefers-reduced-motion: no-preference)'));
const interactive = r => /:(hover|active|focus-visible)\b/.test(r.selector);
const movingTransform = ([prop, value]) => (prop === 'transform' || prop === 'text-underline-offset') && !/^none$/i.test(value);

/** Every style="" attribute in some markup, as its declarations. */
function inlineDecls(html) {
  return [...String(html).matchAll(/\sstyle="([^"]*)"/g)].map(m => m[1].split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const k = d.indexOf(':');
    return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()];
  }));
}

// ---- the frame CSS and the frame markup ----

describe('the builder frame moves only for a visitor with no reduced-motion preference', () => {
  const rules = cssRules(frameCss('#09080E'));

  it('every transition and animation in frameCss sits inside the screen + no-preference block', () => {
    const moves = rules.filter(r => !inKeyframes(r) && r.decls.some(moving));
    assert.ok(moves.length >= 3, `the reader found ${moves.length} moving rules; the drawer, the backdrop and the spinner are three`);
    for (const r of moves) assert.ok(r.at.includes(NO_PREF), `${r.selector} moves outside ${NO_PREF} (inside ${JSON.stringify(r.at)})`);
  });

  it('the drawer slides, the backdrop fades and the spinner turns there, at their old durations', () => {
    const get = sel => rules.find(r => r.selector === sel && r.at.includes(NO_PREF));
    assert.deepEqual(get('#jv-exit-drawer')?.decls, [['transition', 'transform 0.38s cubic-bezier(0.16, 1, 0.3, 1)']]);
    assert.deepEqual(get('#jv-exit-backdrop')?.decls, [['transition', 'opacity 0.3s ease']]);
    assert.deepEqual(get('#lead-modal .loading-spinner')?.decls, [['animation', 'jvf-spin 0.8s linear infinite']]);
    const base = rules.find(r => r.selector === '#lead-modal .loading-spinner' && r.at.length === 0);
    assert.ok(base, 'the spinner keeps its shape outside the block');
    assert.equal(base.decls.some(([p]) => p.startsWith('animation')), false, 'and no animation there');
  });

  it('the cookie banner is turned off in the exact complement of that query: every transition, and the accept button\'s hover lift', () => {
    const off = rules.filter(r => r.at.includes(COMPLEMENT));
    const all = off.find(r => r.selector === '#jv-consent-banner, #jv-consent-banner *');
    assert.ok(all, JSON.stringify(off.map(r => r.selector)));
    assert.deepEqual(all.decls, [['transition', 'none']]);
    const lift = off.find(r => r.selector === '#jv-consent-banner .jv-consent-btn-accept:hover');
    assert.ok(lift);
    assert.deepEqual(lift.decls, [['transform', 'none']]);
    assert.equal(off.length, 2, 'nothing else is switched off there');
  });

  it('no frame piece carries a transition or an animation in a style attribute', () => {
    const pieces = {
      'exit drawer': exitDrawerHtml({ headline: 'Wait', badge: 'b', subhead: 's', code: 'C10', storeDomain: 'x.myshopify.com', hasVariant: true }),
      'exit drawer, lead only': exitDrawerHtml({ headline: 'Wait', leadOnly: true }),
      'lead modal': leadModalHtml({ leadHasCode: true, code: 'C10' }),
      'lead modal, lead only': leadModalHtml({ leadOnly: true }),
      'sticky bar': stickyBarHtml({ title: 't', price: '1.00', initialPrice: '$1.00', buttonText: 'Go' }),
      lightbox: lightboxHtml()
    };
    let read = 0;
    for (const [name, html] of Object.entries(pieces)) {
      const decls = inlineDecls(html).flat();
      read += decls.length;
      for (const d of decls) assert.equal(moving(d), false, `${name}: style="${d[0]}: ${d[1]}"`);
    }
    assert.ok(read > 50, `the reader found ${read} inline declarations (the lightbox has none of its own)`);
  });
});

// ---- a page served by the real publish and public routes ----

const SHOP = { storeDomain: 'shop.myshopify.com', currency: 'USD', status: 'connected' };
const starter = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.data.type === 'landing-page');

function motionDoc() {
  let doc = migrateLegacyPage({
    ...starter.data,
    headline: 'Glow in seven days',
    subhead: 'A serum made in small batches.',
    buttonText: 'Get the serum',
    shopifyVariantId: 'gid://shopify/ProductVariant/123',
    shopifyProductId: 'gid://shopify/Product/9',
    shopifyProductTitle: 'Glow Serum',
    shopifyProductPrice: '48.00',
    shopifyProductImage: 'https://cdn.example.com/serum.jpg'
  });
  doc.theme = { ...doc.theme, motion: 'subtle' };
  const col = doc.sections[0].children[1];
  for (const [type, props] of [['text', { text: 'Read [the guide](https://example.com/g) first.' }], ['orderBump', { variantId: 'gid://shopify/ProductVariant/456', headline: 'Add one', title: 'Travel size', price: '12.00' }], ['countdown', { text: 'Ends in', mode: 'evergreen', minutes: 15 }]]) {
    const n = createNode('widget', type);
    n.props = { ...n.props, ...props };
    const r = insertNode(doc, col.id, 0, n);
    assert.equal(r.ok, true, r.reason);
    doc = r.doc;
  }
  return doc;
}

async function servedPage(doc) {
  const saved = {};
  const store = { journey: { id: 'j1', nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: 'offer', headline: 'Glow in seven days', exitIntentEnabled: true, exitIntentHeadline: 'Wait, take a code', exitIntentDiscountCode: 'STAY10', builder: doc } }], edges: [] } };
  const publishApp = express();
  publishApp.use(express.json());
  setupJourneyRoutes(publishApp, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_u, _i, j) => { store.journey = j; return { durable: true }; },
    loadWorkspace: async (_u, wsId) => ({ id: wsId, shopifyConfig: SHOP }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: async () => ({ ok: true, log: null }),
    savePublishLog: async () => ({ durable: true }),
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.parse('2026-10-08T10:00:00.000Z')
  });
  const listen = app => new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const close = async s => { s.closeAllConnections(); await new Promise(r => s.close(r)); };
  let server = await listen(publishApp);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/journey/j1/publish`, { method: 'POST' });
    assert.equal(res.status, 200, await res.text());
  } finally {
    await close(server);
  }
  const record = structuredClone(saved.offer);
  record.shopifyConfig = { ...SHOP };
  const app = express();
  app.use(express.json());
  setupPublicRoutes(app, new Proxy({
    publicPageCache: { offer: record },
    domainRegistryCache: {},
    workspaceCache: {},
    loadDiscounts: () => [],
    realStoreDomain: (c) => c?.storeDomain || '',
    realVariantId: (v) => String(v || '').trim(),
    realTrackingId: (v) => String(v || '').trim(),
    loadContacts: () => [],
    signupFormsFor: () => [],
    publicBase: () => 'http://127.0.0.1'
  }, { get: (t, k) => (k in t ? t[k] : undefined) }));
  server = await listen(app);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/p/offer`);
    assert.equal(r.status, 200);
    return await r.text();
  } finally {
    await close(server);
    setPublicContext(null);
  }
}

describe('a served builder page with motion, an exit drawer, a lead modal and the cookie banner', async () => {
  const html = await servedPage(motionDoc());
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  const rules = styles.flatMap(cssRules).filter(r => !inKeyframes(r));
  const consentSelector = sel => sel.split(',').every(s => /^\.(jv-cookie-consent|jv-consent-)/.test(s.trim()));

  it('is the page these checks are about: the motion root, the drawer, the modal and the banner are all served', () => {
    assert.ok(html.includes('<div id="jvb-root" class="jvb" data-jvb-motion="subtle">'));
    assert.match(html, /<div id="jv-exit-drawer" role="dialog"/);
    assert.match(html, /<div id="lead-modal"/);
    assert.match(html, /<div id="jv-consent-banner" class="jv-cookie-consent"/);
    assert.ok(styles.length >= 3, `${styles.length} style elements`);
  });

  it('every moving declaration in every style element is behind the no-preference query, or is the banner\'s', () => {
    const moves = rules.filter(r => r.decls.some(moving));
    assert.ok(moves.some(r => r.selector.startsWith('#jvb-root')), 'the page\'s own motion block is among them');
    assert.ok(moves.some(r => r.selector === '#jv-exit-drawer'), 'the drawer is among them');
    const loose = moves.filter(r => !behindNoPreference(r) && !consentSelector(r.selector));
    assert.deepEqual(loose.map(r => r.selector), []);
  });

  it('every hover, press or focus transform is behind the query too, or is the banner\'s', () => {
    const lifts = rules.filter(r => interactive(r) && r.decls.some(movingTransform));
    assert.ok(lifts.some(r => r.selector.includes('.jvb-btn:hover')), 'the page\'s button lift is among them');
    const loose = lifts.filter(r => !behindNoPreference(r) && !consentSelector(r.selector));
    assert.deepEqual(loose.map(r => r.selector), []);
  });

  it('what the banner moves is switched off by the frame outside the query, and its markup sits under #jv-consent-banner', () => {
    const bannerMoves = rules.filter(r => !behindNoPreference(r) && consentSelector(r.selector) && (r.decls.some(moving) || (interactive(r) && r.decls.some(movingTransform))));
    assert.ok(bannerMoves.length >= 1, 'the banner moves somewhere, or this check reads nothing');
    const off = rules.filter(r => r.at.includes(COMPLEMENT));
    assert.ok(off.some(r => r.selector === '#jv-consent-banner, #jv-consent-banner *' && r.decls.some(([p, v]) => p === 'transition' && v === 'none')));
    for (const r of bannerMoves.filter(r => interactive(r) && r.decls.some(movingTransform))) {
      assert.ok(off.some(o => o.selector === `#jv-consent-banner ${r.selector}` && o.decls.some(([p, v]) => p === 'transform' && v === 'none')), `${r.selector} lifts with nothing to stop it`);
    }
    const open = html.indexOf('<div id="jv-consent-banner"');
    const end = html.indexOf('<script', open);
    const classAt = [...html.matchAll(/class="(?:jv-cookie-consent|jv-consent-)/g)].map(m => m.index);
    assert.ok(classAt.length >= 3);
    for (const at of classAt) assert.ok(at >= open && at < end, `a banner class at ${at} is outside #jv-consent-banner (${open} to ${end})`);
  });

  it('no style attribute on the served page moves anything', () => {
    const decls = inlineDecls(html).flat();
    assert.ok(decls.length > 20, `${decls.length} inline declarations read`);
    assert.deepEqual(decls.filter(moving), []);
  });
});

// ---- render() over every widget type ----

describe('render() moves nothing outside a no-preference block, at either level, over every widget type', () => {
  const CTX = { slug: 's', realVariantId: v => String(v ?? ''), formatPrice: p => `$${p}`, reviews: { summary: { averageRating: 4.5, totalCount: 1 }, reviews: [{ rating: 5, reviewTitle: 'Great', reviewText: 'Loved it', customerName: 'Ann' }] } };
  const widgets = Object.keys(WIDGET_REGISTRY).map((type, i) => ({ id: `w${i}`, kind: 'widget', type, props: { ...WIDGET_REGISTRY[type].defaultProps }, style: { desktop: {} } }));
  const page = motion => ({ version: 1, theme: { ...JSON.parse(JSON.stringify(migrateLegacyPage(starter.data).theme)), motion }, sections: [
    { id: 's1', kind: 'section', props: {}, style: { desktop: {} }, children: [{ id: 'c1', kind: 'column', props: {}, style: { desktop: {} }, children: widgets.slice(0, 8) }] },
    { id: 's2', kind: 'section', props: {}, style: { desktop: {} }, children: [{ id: 'c2', kind: 'column', props: {}, style: { desktop: {} }, children: widgets.slice(8) }] }
  ] });
  for (const level of ['subtle', 'cinematic']) {
    for (const ctx of [{}, { device: 'desktop' }, { device: 'tablet' }, { device: 'mobile' }]) {
      it(`${level}, ${ctx.device || 'published'}`, () => {
        const out = render(page(level), { ...CTX, ...ctx });
        assert.deepEqual(out.problems, []);
        const rules = cssRules(out.css).filter(r => !inKeyframes(r));
        const moves = rules.filter(r => r.decls.some(moving) || (interactive(r) && r.decls.some(movingTransform)));
        assert.ok(moves.length >= 5, `${moves.length} moving rules read`);
        assert.deepEqual(moves.filter(r => !behindNoPreference(r)).map(r => r.selector), []);
      });
    }
  }
});
