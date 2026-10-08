// The landing page builder's renderer (LANDING_BUILDER_PLAN.md, Wave 1a):
// src/lib/pageBuilder/render.mjs. What these tests hold:
// - a golden HTML string per widget, and the "renders nothing" cases the contract names;
// - the CSS: scoped under #jvb-root, desktop then @media 1024 then @media 640, each block holding
//   only the keys its layer sets, and the cascade of those blocks equal to resolveStyle for every
//   style key; the canvas (device) branch emits no media query and agrees with the cascade;
// - the sanitiser against every fixture public-inline-script.test.mjs uses plus its own attacks;
// - videoEmbed over the allowlisted hosts and its refusals;
// - determinism, validate-first, fonts listed once, and no script element from any widget.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_THEME,
  DEVICES,
  STYLE_KEYS,
  WIDGET_REGISTRY,
  createEmptyPage,
  linkProblem,
  migrateLegacyPage,
  resolveStyle,
  validateBuilderDoc,
  walk
} from './src/lib/pageBuilder/model.mjs';
import {
  STRUCTURAL_WORDS,
  render,
  renderMarkdownSubset,
  renderWidget,
  sanitizeHtml,
  videoEmbed
} from './src/lib/pageBuilder/render.mjs';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';

// ---- helpers ----

function node(type, props = {}, id = 'w1', style = { desktop: {} }) {
  return { id, kind: 'widget', type, props: { ...WIDGET_REGISTRY[type].defaultProps, ...props }, style };
}

function column(id, children, style = { desktop: {} }) {
  return { id, kind: 'column', props: {}, style, children };
}

function section(id, children, props = {}, style = { desktop: {} }) {
  return { id, kind: 'section', props, style, children };
}

function pageWith(...children) {
  return { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [column('c1', children)])] };
}

const rw = (type, props, context) => renderWidget(node(type, props), context);

/** The text a visitor reads: tags removed, entities decoded, runs of space collapsed. */
function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, '\n')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[k])
    .split('\n').map(s => s.trim()).filter(Boolean);
}

/** Splits a selector list at top-level commas, written here and not shared with the renderer. */
function splitTop(sel) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/**
 * The stylesheet as blocks: { top: Rule[], tablet: Rule[], mobile: Rule[] } where a Rule is
 * { selector, body }. Throws on a line that is neither a rule, a media opener nor a closer.
 */
function parseCss(css) {
  const blocks = { top: [], tablet: [], mobile: [] };
  let into = 'top';
  let medias = 0;
  for (const line of css.split('\n')) {
    if (!line.trim()) continue;
    const media = /^@media \(max-width: (\d+)px\)\{$/.exec(line);
    if (media) {
      medias += 1;
      into = media[1] === '1024' ? 'tablet' : media[1] === '640' ? 'mobile' : 'other';
      assert.ok(into !== 'other', `unexpected breakpoint ${media[1]}`);
      continue;
    }
    if (line === '}') { into = 'top'; continue; }
    const rule = /^([^{]+)\{([^}]*)\}$/.exec(line);
    assert.ok(rule, `a line that is not a rule: ${line.slice(0, 120)}`);
    blocks[into].push({ selector: rule[1], body: rule[2] });
  }
  return { ...blocks, medias };
}

/**
 * The declarations of the rule that carries node `id`'s style layer in one block. A node can have
 * structural rules on the same selector before it (a background image's size, an overlay's
 * position); the layer's own rule is always the last one.
 */
function declsOf(rules, id) {
  const out = new Map();
  const mine = rules.filter(r => r.selector === `#jvb-root .jvb-n-${id}`);
  if (!mine.length) return out;
  for (const d of mine[mine.length - 1].body.split(';')) {
    const i = d.indexOf(':');
    out.set(d.slice(0, i), d.slice(i + 1));
  }
  return out;
}

/** The names of every attribute on every tag, read with quotes respected (so text inside a value is not one). */
function attributeNames(html) {
  const names = [];
  for (const tag of html.matchAll(/<[A-Za-z][^\s>/]*((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
    for (const a of tag[1].matchAll(/\s+([^\s=>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)) names.push(a[1].toLowerCase());
  }
  return names;
}

function mapOf(entries) {
  return new Map(Object.entries(entries));
}

// ---- golden HTML per widget ----

describe('widget markup, golden', () => {
  it('heading: level, escaped multi-line text, a link only when the model allows it', () => {
    assert.equal(
      rw('heading', { text: 'Hello <World> & "you"\nline two', level: 1, link: '/offer' }),
      '<h1 class="jvb-n-w1 jvb-w jvb-heading"><a href="/offer">Hello &lt;World&gt; &amp; &quot;you&quot;<br>line two</a></h1>'
    );
    assert.equal(rw('heading', { text: 'Plain' }), '<h2 class="jvb-n-w1 jvb-w jvb-heading">Plain</h2>');
    assert.equal(rw('heading', { text: 'Bad link', link: 'javascript:alert(1)' }), '<h2 class="jvb-n-w1 jvb-w jvb-heading">Bad link</h2>');
  });

  it('text: the markdown subset inside one div', () => {
    assert.equal(
      rw('text', { text: 'A **bold** and *italic* and [link](https://example.com/a?b=1&c=2) and [bad](javascript:alert).\n\n- one\n- two\n\n1. first\n2. second' }),
      '<div class="jvb-n-w1 jvb-w jvb-text"><p>A <strong>bold</strong> and <em>italic</em> and <a href="https://example.com/a?b=1&amp;c=2">link</a> and bad.</p><ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol></div>'
    );
  });

  it('image: alt always present, frame only for a shape, link wraps, caption escaped', () => {
    assert.equal(
      rw('image', { src: 'https://img.example.com/a.png', alt: 'A "pic"', caption: 'Cap <1>', link: '/x', aspect: '4:3', fit: 'contain' }),
      '<figure class="jvb-n-w1 jvb-w jvb-image"><a href="/x"><div class="jvb-frame jvb-ar-4-3"><img src="https://img.example.com/a.png" alt="A &quot;pic&quot;" loading="lazy" class="jvb-fit-contain"></div></a><figcaption>Cap &lt;1&gt;</figcaption></figure>'
    );
    assert.equal(
      rw('image', { src: 'https://img.example.com/a.png' }),
      '<figure class="jvb-n-w1 jvb-w jvb-image"><img src="https://img.example.com/a.png" alt="" loading="lazy" class="jvb-fit-cover"></figure>'
    );
  });

  it('button: an anchor with target only when asked and never without rel; a span with no link', () => {
    assert.equal(
      rw('button', { label: 'Go', url: 'https://example.com/', newTab: true, variant: 'outline', size: 'lg', fullWidth: true }),
      '<a class="jvb-n-w1 jvb-w jvb-btn jvb-btn-outline jvb-btn-lg jvb-btn-full" href="https://example.com/" target="_blank" rel="noopener noreferrer">Go</a>'
    );
    assert.equal(rw('button', { label: 'Same tab', url: '#offer' }), '<a class="jvb-n-w1 jvb-w jvb-btn jvb-btn-primary jvb-btn-md" href="#offer">Same tab</a>');
    assert.equal(rw('button', { label: 'No link', newTab: true }), '<span class="jvb-n-w1 jvb-w jvb-btn jvb-btn-primary jvb-btn-md">No link</span>');
  });

  it('spacer and divider are always drawn', () => {
    assert.equal(rw('spacer'), '<div class="jvb-n-w1 jvb-w jvb-spacer" aria-hidden="true"></div>');
    assert.equal(rw('divider'), '<div class="jvb-n-w1 jvb-w jvb-divider"><hr></div>');
  });

  it('video: the frame is the renderer\'s, on the nocookie or player origin', () => {
    assert.equal(
      rw('video', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Demo "reel"', startAt: 30 }),
      '<div class="jvb-n-w1 jvb-w jvb-video jvb-ar-16-9"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30" title="Demo &quot;reel&quot;" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
    );
    assert.equal(
      rw('video', { url: 'https://vimeo.com/76979871', aspect: '4:3' }),
      '<div class="jvb-n-w1 jvb-w jvb-video jvb-ar-4-3"><iframe src="https://player.vimeo.com/video/76979871" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
    );
  });

  it('icon list: one row per point with text, the chosen icon', () => {
    assert.equal(
      rw('iconList', { icon: 'star', items: [{ text: 'One' }, { text: '  ' }, { text: 'Two & three' }] }),
      '<ul class="jvb-n-w1 jvb-w jvb-iconlist"><li><span class="jvb-ico" aria-hidden="true">★</span><span>One</span></li><li><span class="jvb-ico" aria-hidden="true">★</span><span>Two &amp; three</span></li></ul>'
    );
  });

  it('testimonials: the merchant\'s own words, stars only when rated, nothing about verification', () => {
    const html = rw('testimonials', { layout: 'stack', items: [
      { quote: 'Great\nstuff', name: 'Ann', role: 'Owner', avatarUrl: 'https://a.example.com/a.jpg', rating: 5 },
      { quote: '', name: 'No quote' },
      { quote: 'Plain', rating: 0 }
    ] });
    assert.equal(
      html,
      '<div class="jvb-n-w1 jvb-w jvb-tm-wrap jvb-tm-stack">'
      + '<figure class="jvb-tm"><span class="jvb-stars" role="img" aria-label="5 out of 5 stars">★★★★★</span><blockquote><p>Great<br>stuff</p></blockquote><figcaption class="jvb-tm-who"><img class="jvb-tm-avatar" src="https://a.example.com/a.jpg" alt="" loading="lazy"><span><span class="jvb-tm-name">Ann</span><span class="jvb-tm-role">Owner</span></span></figcaption></figure>'
      + '<figure class="jvb-tm"><blockquote><p>Plain</p></blockquote></figure></div>'
    );
    assert.doesNotMatch(html, /verified/i);
  });

  it('faq: details elements, the first open on request, an answer is optional', () => {
    assert.equal(
      rw('faq', { openFirst: true, items: [{ question: 'Q1?', answer: 'A **1**' }, { question: 'Q2?', answer: '' }, { question: '', answer: 'orphan' }] }),
      '<div class="jvb-n-w1 jvb-w jvb-faq"><details class="jvb-faq-item" open><summary>Q1?</summary><div class="jvb-faq-a"><p>A <strong>1</strong></p></div></details><details class="jvb-faq-item"><summary>Q2?</summary></details></div>'
    );
  });

  it('countdown: evergreen carries minutes and the frame\'s ids; deadline needs a time zone', () => {
    assert.equal(
      rw('countdown', { minutes: 15 }),
      '<div class="jvb-n-w1 jvb-w jvb-countdown" id="jv-reservation-bar" data-jvb-countdown data-jvb-mode="evergreen" data-jvb-minutes="15" data-jvb-expired="Reservation extended for final checkout:"><div class="jvb-countdown-inner"><span class="jvb-countdown-label" id="jv-urgency-label">This offer timer runs for</span><span class="jvb-countdown-clock" id="jv-countdown-display" role="timer">15:00</span></div></div>'
    );
    assert.equal(
      rw('countdown', { mode: 'deadline', deadline: '2030-01-01T00:00:00Z', text: 'Ends <soon>', expiredText: 'Gone' }),
      '<div class="jvb-n-w1 jvb-w jvb-countdown" id="jv-reservation-bar" data-jvb-countdown data-jvb-mode="deadline" data-jvb-deadline="2030-01-01T00:00:00Z" data-jvb-expired="Gone"><div class="jvb-countdown-inner"><span class="jvb-countdown-label" id="jv-urgency-label">Ends &lt;soon&gt;</span><span class="jvb-countdown-clock" id="jv-countdown-display" role="timer"></span></div></div>'
    );
    assert.equal(rw('countdown', { mode: 'deadline', deadline: '2030-01-01T00:00:00' }), '', 'a date with no time zone is nobody\'s moment');
    assert.equal(rw('countdown', { mode: 'deadline', deadline: '' }), '');
    assert.equal(rw('countdown', { minutes: 0 }), '');
    assert.equal(rw('countdown', { minutes: 0.4 }), '');
  });

  it('html embed: sanitised, named for screen readers when titled', () => {
    assert.equal(
      rw('htmlEmbed', { html: '<p onclick="x()">Hi <a href="javascript:alert(1)" target="_blank">l</a><script>alert(1)</script></p>', title: 'My "embed"' }),
      '<div class="jvb-n-w1 jvb-w jvb-embed" role="group" aria-label="My &quot;embed&quot;"><p>Hi <a>l</a></p></div>'
    );
    assert.equal(rw('htmlEmbed', { html: '<script>alert(1)</script>' }), '', 'nothing left after sanitising is nothing');
  });

  it('lead form: the fields, the visible labels, and the hidden fields of the lead modal\'s body', () => {
    assert.equal(
      rw('leadForm', { nameField: 'required', phoneField: 'hidden', afterSubmit: 'checkout' }, { slug: 's<1>', variant: 'b', currency: 'eur' }),
      '<form class="jvb-n-w1 jvb-w jvb-lead" data-jvb-lead data-jvb-after="checkout" data-jvb-success="Thanks. Your details were received."><h2 class="jvb-lead-title">Leave your email</h2>'
      + '<div class="jvb-field"><label for="jvb-w1-name">Name</label><input type="text" id="jvb-w1-name" name="name" autocomplete="name" required></div>'
      + '<div class="jvb-field"><label for="jvb-w1-email">Email</label><input type="email" id="jvb-w1-email" name="email" autocomplete="email" required></div>'
      + '<input type="hidden" name="slug" value="s&lt;1&gt;"><input type="hidden" name="variant" value="b"><input type="hidden" name="currency" value="EUR">'
      + ['order_bump_selected', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref'].map(k => `<input type="hidden" name="${k}" value="">`).join('')
      + '<button type="submit" class="jvb-btn jvb-btn-primary jvb-btn-md jvb-btn-full">Send</button><p class="jvb-lead-status" role="status" aria-live="polite" data-jvb-lead-status></p></form>'
    );
  });

  it('lead form: every field of the modal\'s POST body is a named input or is the frame\'s to add', () => {
    // The body today's modal posts (publicRoutes.mjs, the lead-form submit handler), minus the
    // three visitor-typed fields, which are the visible inputs.
    const modalBody = ['slug', 'email', 'name', 'phone', 'order_bump_selected', 'variant', 'currency', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref'];
    const html = rw('leadForm', {}, { slug: 's' });
    const names = [...html.matchAll(/<input [^>]*name="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(names.slice().sort(), modalBody.slice().sort());
  });

  it('lead form: a hidden name or phone is not drawn, and the email is always required', () => {
    const html = rw('leadForm', { nameField: 'hidden', phoneField: 'optional' });
    assert.doesNotMatch(html, /name="name"/);
    assert.match(html, /name="phone" autocomplete="tel">/);
    assert.match(html, /name="email" autocomplete="email" required>/);
  });

  it('product: the first one owns product-img and product-price; a placeholder variant publishes no title, price or product image', () => {
    const props = { productId: '123', variantId: '456', title: 'Serum', price: '$29.00', productImage: 'https://i.example.com/shop.png', imageUrl: 'https://i.example.com/p.png', imageAlt: 'Serum bottle' };
    assert.equal(
      rw('productHero', props, { formatPrice: p => `${p}!` }),
      '<div class="jvb-n-w1 jvb-w jvb-product" data-product-id="123" data-variant-id="456" data-collection-id="" data-title="Serum" data-price="$29.00"><div class="jvb-product-media"><img id="product-img" src="https://i.example.com/shop.png" alt="Serum bottle" loading="eager"><div class="jvb-price" id="product-price" data-base-price="$29.00">$29.00!</div></div></div>'
    );
    assert.equal(
      rw('productHero', props, { realVariantId: () => '' }),
      '<div class="jvb-n-w1 jvb-w jvb-product" data-product-id="123" data-variant-id="" data-collection-id="" data-title="" data-price=""><div class="jvb-product-media"><img id="product-img" src="https://i.example.com/p.png" alt="Serum bottle" loading="eager"></div></div>'
    );
    assert.equal(rw('productHero', { ...props, showPrice: false }).includes('product-price'), false);
    assert.equal(rw('productHero', {}), '', 'a product with nothing to show or bind draws nothing');
  });

  it('checkout button: main-cta-btn, the mode and code for the frame, the code note when asked', () => {
    assert.equal(
      rw('checkoutButton', { discountCode: 'SAVE<10>', checkoutMode: 'lead-gate', cartAction: 'add' }),
      '<div class="jvb-n-w1 jvb-w jvb-checkout"><p class="jvb-code-note">Code <strong>SAVE&lt;10&gt;</strong> is ready at checkout</p><button id="main-cta-btn" type="button" class="jvb-btn jvb-btn-primary jvb-btn-lg jvb-btn-full" data-jvb-cta data-jvb-mode="lead-gate" data-jvb-action="add" data-jvb-code="SAVE&lt;10&gt;">Continue</button></div>'
    );
    assert.equal(
      rw('checkoutButton', { label: 'Buy now', discountCode: 'X', showCodeNote: false, fullWidth: false }),
      '<div class="jvb-n-w1 jvb-w jvb-checkout"><button id="main-cta-btn" type="button" class="jvb-btn jvb-btn-primary jvb-btn-lg" data-jvb-cta data-jvb-mode="direct" data-jvb-action="checkout" data-jvb-code="X">Buy now</button></div>'
    );
  });

  it('order bump: page-order-bump and bump-checkbox-page, only with a real variant', () => {
    assert.equal(
      rw('orderBump', { variantId: '789', description: 'Extra\nline', price: '$5', image: 'https://i.example.com/b.png' }),
      '<div class="jvb-n-w1 jvb-w jvb-bump" id="page-order-bump" data-variant-id="789"><label class="jvb-bump-head"><input type="checkbox" id="bump-checkbox-page" class="jvb-bump-cb"><span class="jvb-bump-title">Add this to the order</span></label><div class="jvb-bump-body"><img class="jvb-bump-thumb" src="https://i.example.com/b.png" alt="Add-on" loading="lazy"><div class="jvb-bump-desc"><p>Extra<br>line</p><div class="jvb-bump-price-row"><span class="jvb-bump-name">Add-on</span><span class="jvb-bump-price" data-base-price="$5">$5</span></div></div></div></div>'
    );
    assert.equal(rw('orderBump', { variantId: '' }), '');
    assert.equal(rw('orderBump', { variantId: 'gid://placeholder' }, { realVariantId: () => '' }), '');
  });

  it('reviews wall: the wall\'s own pill, cards and photo buttons; only reviews at or above the lowest rating', () => {
    const reviews = {
      summary: { averageRating: 4.7, totalCount: 12 },
      reviews: [
        { rating: 5, reviewTitle: 'Love it', reviewText: 'So <good>', tags: ['skin'], photos: ['https://p.example.com/1.jpg', 'http://p.example.com/insecure.jpg', 'https://p.example.com/q".jpg'], customerName: 'Bea' },
        { rating: 3, reviewText: 'below the line' }
      ]
    };
    assert.equal(
      rw('reviewsWall', {}, { reviews }),
      '<section class="jvb-n-w1 jvb-w jvb-reviews" aria-labelledby="jvb-w1-title"><div class="jvb-reviews-head"><div class="jvb-reviews-pill"><span>★ 4.7 / 5.0</span><span aria-hidden="true">·</span><span>12 reviews</span></div><h2 class="jvb-reviews-title" id="jvb-w1-title">Customer reviews</h2></div>'
      + '<div class="jvb-reviews-cards"><div class="jvb-review"><div class="jvb-review-top"><span class="jvb-stars" role="img" aria-label="5 out of 5 stars">★★★★★</span><span class="jvb-verified">✓ Verified</span></div><div class="jvb-review-head">Love it</div><p class="jvb-review-text">So &lt;good&gt;</p><div class="jvb-review-tags"><span class="jvb-review-tag">skin</span></div><div class="jvb-review-photos"><button type="button" class="jvb-review-photo" data-jv-photo="https://p.example.com/1.jpg" aria-label="Open customer photo"><img src="https://p.example.com/1.jpg" alt="" loading="lazy"></button></div><div class="jvb-review-author"><span class="jvb-review-avatar" aria-hidden="true">B</span><span>Bea</span></div></div></div></section>'
    );
    assert.doesNotMatch(rw('reviewsWall', { photos: false }, { reviews }), /data-jv-photo/);
    assert.match(rw('reviewsWall', { headline: 'What people say', minRating: 1 }, { reviews }), /What people say<\/h2>.*below the line/);
    assert.equal(rw('reviewsWall', {}, {}), '', 'no reviews, no wall');
    assert.equal(rw('reviewsWall', { minRating: 5 }, { reviews: { reviews: [{ rating: 4 }] } }), '');
    assert.match(rw('reviewsWall', {}, { reviews: { summary: { averageRating: null, totalCount: 1 }, reviews: [{ rating: 5, customerName: 'Zed' }] } }), /<span>1 review<\/span>/);
  });

  it('stock count: the merchant\'s line with {count} filled, the fallback only when a count is set', () => {
    assert.equal(
      rw('stockCount', { text: 'Only {count} left, {count}!', count: 7 }),
      '<div class="jvb-n-w1 jvb-w jvb-stock-wrap"><div class="jvb-stock" id="jv-scarcity-badge"><span class="jvb-pulse" aria-hidden="true"></span><span>Only 7 left, 7!</span></div></div>'
    );
    assert.match(rw('stockCount', { count: 14 }), /<span>Limited batch: 14 units remaining<\/span>/);
    assert.equal(rw('stockCount', { count: 0 }), '');
  });

  it('trust badge: one line, an icon only when chosen', () => {
    assert.equal(rw('trustBadge', { text: '30 day returns' }), '<div class="jvb-n-w1 jvb-w jvb-trust"><span>30 day returns</span></div>');
    assert.match(rw('trustBadge', { text: 'Safe', icon: 'lock' }), /^<div class="jvb-n-w1 jvb-w jvb-trust"><svg class="jvb-trust-icon" [^>]*aria-hidden="true"[^>]*>.*<\/svg><span>Safe<\/span><\/div>$/);
    assert.equal(rw('trustBadge', { text: '', icon: 'shield' }), '');
  });

  it('an empty heading, text, image or list renders nothing', () => {
    assert.equal(rw('heading', {}), '');
    assert.equal(rw('heading', { text: '   ' }), '');
    assert.equal(rw('text', {}), '');
    assert.equal(rw('image', {}), '');
    assert.equal(rw('image', { src: 'javascript:alert(1)' }), '');
    assert.equal(rw('button', {}), '');
    assert.equal(rw('iconList', {}), '');
    assert.equal(rw('iconList', { items: [{ text: '' }] }), '');
    assert.equal(rw('testimonials', {}), '');
    assert.equal(rw('faq', {}), '');
    assert.equal(rw('video', {}), '');
    assert.equal(rw('video', { url: 'https://example.com/video.mp4' }), '');
    assert.equal(rw('htmlEmbed', {}), '');
  });

  it('a node that is not a widget the renderer knows renders nothing and never throws', () => {
    for (const bad of [null, undefined, 3, 'x', {}, { id: 'x', kind: 'widget', type: 'nope', props: {}, style: {} }, { id: 'bad id', kind: 'widget', type: 'text', props: {} }, { id: 'a', kind: 'column' }]) {
      assert.equal(renderWidget(bad, {}), '');
    }
    assert.equal(renderWidget(node('heading', { text: 'x' }), null), '<h2 class="jvb-n-w1 jvb-w jvb-heading">x</h2>');
  });
});

// ---- the frame's ids ----

describe('commerce widgets keep the frame\'s ids, and only the first of a kind owns them', () => {
  it('two checkout buttons, bumps, products, countdowns and stock lines: one id each', () => {
    const doc = pageWith(
      node('productHero', { variantId: '1', imageUrl: 'https://i.example.com/1.png' }, 'p1'),
      node('productHero', { variantId: '2', imageUrl: 'https://i.example.com/2.png' }, 'p2'),
      node('checkoutButton', {}, 'k1'),
      node('checkoutButton', {}, 'k2'),
      node('orderBump', { variantId: '3' }, 'b1'),
      node('orderBump', { variantId: '4' }, 'b2'),
      node('countdown', { minutes: 5 }, 'd1'),
      node('countdown', { minutes: 6 }, 'd2'),
      node('stockCount', { count: 3 }, 't1'),
      node('stockCount', { count: 4 }, 't2')
    );
    const { html, problems } = render(doc, {});
    assert.deepEqual(problems, []);
    for (const id of ['main-cta-btn', 'bump-checkbox-page', 'page-order-bump', 'product-img', 'product-price', 'jv-reservation-bar', 'jv-urgency-label', 'jv-countdown-display', 'jv-scarcity-badge']) {
      assert.equal(html.split(`id="${id}"`).length - 1, id === 'product-price' ? 0 : 1, `${id} appears once`);
    }
    // the first of each kind owns it
    assert.ok(html.indexOf('id="main-cta-btn"') < html.indexOf('jvb-n-k2'));
    assert.ok(html.indexOf('id="page-order-bump"') < html.indexOf('jvb-n-b2'));
    assert.ok(html.indexOf('id="product-img"') < html.indexOf('jvb-n-p2'));
    const all = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(all).size, all.length, 'no id is used twice on the page');
  });

  it('every id the frame looks up is written by the widget that owns it', () => {
    const { html } = render(pageWith(
      node('productHero', { variantId: '1', price: '$5', imageUrl: 'https://i.example.com/1.png' }, 'p1'),
      node('checkoutButton', {}, 'k1'),
      node('orderBump', { variantId: '3' }, 'b1'),
      node('countdown', { minutes: 5 }, 'd1'),
      node('stockCount', { count: 3 }, 't1')
    ), {});
    for (const id of ['main-cta-btn', 'bump-checkbox-page', 'page-order-bump', 'product-img', 'product-price', 'jv-reservation-bar', 'jv-urgency-label', 'jv-countdown-display', 'jv-scarcity-badge']) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
  });

  it('an anchor named like a frame id is not written, and an anchor is written once', () => {
    const doc = {
      version: 1, theme: structuredClone(DEFAULT_THEME),
      sections: [
        section('s1', [column('c1', [])], { anchor: 'main-cta-btn' }),
        section('s2', [column('c2', [])], { anchor: 'offer' }),
        section('s3', [column('c3', [])], { anchor: 'offer' }),
        section('s4', [column('c4', [])], { anchor: 'jv-countdown-display' }),
        section('s5', [column('c5', [])], { anchor: 'lead-modal' })
      ]
    };
    const { html } = render(doc, {});
    assert.equal((html.match(/ id="offer"/g) || []).length, 1);
    assert.doesNotMatch(html, /id="main-cta-btn"|id="jv-countdown-display"|id="lead-modal"/);
  });
});

// ---- the page ----

describe('render', () => {
  const starter = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.data.type === 'landing-page');

  it('answers the page from the design document (the starter map\'s landing page) with no problems', () => {
    const doc = migrateLegacyPage(starter.data);
    const out = render(doc, { slug: 'lead-capture', storeDomain: 'shop.example.com' });
    assert.deepEqual(out.problems, []);
    assert.match(out.html, /^<div id="jvb-root" class="jvb">/);
    assert.match(out.html, /<\/div>$/);
    assert.equal((out.html.match(/<section /g) || []).length, 2);
    assert.match(out.html, /id="main-cta-btn"/);
    assert.match(out.html, /data-jvb-mode="lead-gate"/);
    assert.match(out.html, /<img id="product-img" src="https:\/\/images\.unsplash\.com\/photo-1522071820081-009f0129c71c/);
    assert.deepEqual(out.fonts, ['Playfair Display', 'Outfit']);
    for (const n of (() => { const ids = []; walk(doc, x => { ids.push(x.id); }); return ids; })()) {
      if (n === 'legacy-reviews-wall' || n === 'legacy-headline') continue; // no reviews, no headline: nothing to draw
      assert.ok(out.html.includes(`jvb-n-${n}`), `${n} is drawn`);
    }
    assert.ok(!out.html.includes('jvb-n-legacy-reviews-wall'), 'a wall with no reviews is not drawn');
  });

  it('gives the same strings twice, and for a deep copy of the document', () => {
    const doc = migrateLegacyPage(starter.data);
    const a = render(doc, { slug: 'x' });
    const b = render(structuredClone(doc), { slug: 'x' });
    assert.deepEqual(a, b);
    assert.equal(a.html, render(doc, { slug: 'x' }).html);
    assert.equal(a.css, render(doc, { slug: 'x' }).css);
  });

  it('does not change the document or the context it was given', () => {
    const doc = migrateLegacyPage(starter.data);
    const ctx = { slug: 'x', reviews: { reviews: [{ rating: 5 }] } };
    const docBefore = structuredClone(doc);
    const ctxBefore = structuredClone(ctx);
    render(doc, ctx);
    assert.deepEqual(doc, docBefore);
    assert.deepEqual(ctx, ctxBefore);
  });

  it('renders an invalid document as nothing and answers the problems the model found', () => {
    const doc = pageWith(node('heading', { text: 'x' }));
    doc.sections[0].children[0].children[0].props.level = 9;
    doc.sections[0].children[0].children[0].type = 'heading';
    const expected = validateBuilderDoc(doc).problems;
    assert.ok(expected.length > 0);
    assert.deepEqual(render(doc, {}), { html: '', css: '', problems: expected, fonts: [] });
    for (const bad of [null, undefined, 3, 'x', [], {}, { version: 2, theme: {}, sections: [] }]) {
      const out = render(bad, {});
      assert.equal(out.html, '');
      assert.equal(out.css, '');
      assert.ok(out.problems.length > 0, JSON.stringify(bad));
    }
  });

  it('renders an empty page as a bare root and a context-free call works', () => {
    const out = render(createEmptyPage());
    assert.deepEqual(out.problems, []);
    assert.equal(out.html, '<div id="jvb-root" class="jvb"></div>');
    assert.ok(out.css.startsWith('#jvb-root{--jvb-primary:#EC4899;'));
  });

  it('refuses a device that is not one, as a problem, not a throw', () => {
    const out = render(createEmptyPage(), { device: 'watch' });
    assert.equal(out.html, '');
    assert.equal(out.problems[0].path, 'context.device');
  });

  it('one root, a section per section, a div per column, every node carries jvb-n-<id>', () => {
    const doc = {
      version: 1, theme: structuredClone(DEFAULT_THEME),
      sections: [
        section('s1', [column('c1', [node('heading', { text: 'A' }, 'h1'), section('inner', [column('ic1', [node('text', { text: 'B' }, 't1')])])]), column('c2', [])], { anchor: 'top' }),
        section('s2', [column('c3', [])], { contentWidth: 'full' })
      ]
    };
    const { html, problems } = render(doc, {});
    assert.deepEqual(problems, []);
    assert.equal(html.split('id="jvb-root"').length - 1, 1);
    assert.equal((html.match(/<section /g) || []).length, 3);
    for (const id of ['s1', 'c1', 'c2', 'h1', 'inner', 'ic1', 't1', 's2', 'c3']) assert.ok(html.includes(`jvb-n-${id} `) || html.includes(`jvb-n-${id}"`), id);
    assert.match(html, /<section class="jvb-n-s1 jvb-sec" id="top"><div class="jvb-row"><div class="jvb-n-c1 jvb-col"><h2 /);
    assert.match(html, /<section class="jvb-n-s2 jvb-sec jvb-full">/);
    // the tags balance
    const opens = (html.match(/<(section|div|h2|p)[ >]/g) || []).length;
    const closes = (html.match(/<\/(section|div|h2|p)>/g) || []).length;
    assert.equal(opens, closes);
  });

  it('writes a custom class after the node\'s own, from the desktop layer only', () => {
    const doc = pageWith(node('text', { text: 'x' }, 't1', { desktop: { customClass: 'my-class other' }, mobile: {} }));
    assert.match(render(doc, {}).html, /class="jvb-n-t1 jvb-w jvb-text my-class other"/);
  });

  it('every widget in one page: no problems, no script element, the same strings twice', () => {
    const all = Object.keys(WIDGET_REGISTRY).map((type, i) => {
      const props = {
        heading: { text: 'H' }, text: { text: 'T' }, image: { src: '/i.png' }, button: { label: 'B', url: '/b' },
        video: { url: 'https://youtu.be/dQw4w9WgXcQ' }, htmlEmbed: { html: '<p>E</p>' }, iconList: { items: [{ text: 'I' }] },
        testimonials: { items: [{ quote: 'Q' }] }, faq: { items: [{ question: 'F', answer: 'A' }] }, countdown: { minutes: 3 },
        leadForm: {}, productHero: { productId: '1', variantId: '2' }, checkoutButton: {}, orderBump: { variantId: '3' },
        reviewsWall: {}, stockCount: { count: 2 }, trustBadge: { text: 'T' }, spacer: {}, divider: {}
      }[type];
      return node(type, props, `w${i}`);
    });
    const doc = pageWith(...all);
    assert.deepEqual(validateBuilderDoc(doc).problems, []);
    const ctx = { slug: 's', reviews: { summary: { averageRating: 5, totalCount: 1 }, reviews: [{ rating: 5, customerName: 'A' }] } };
    const a = render(doc, ctx);
    assert.deepEqual(a.problems, []);
    for (const w of all) assert.ok(a.html.includes(`jvb-n-${w.id} `), `${w.type} is drawn`);
    assert.doesNotMatch(a.html + a.css, /<script/i);
    assert.deepEqual(a, render(doc, ctx));
  });
});

// ---- CSS ----

describe('css', () => {
  /** A section with a value on every style key, differing across the three layers. */
  function styledDoc() {
    const style = {
      desktop: {
        paddingTop: 10, paddingRight: 11, paddingBottom: 12, paddingLeft: 13,
        marginTop: -5, marginRight: 6, marginBottom: 7, marginLeft: 8,
        backgroundColor: 'theme.surface', backgroundImage: 'https://img.example.com/bg.jpg',
        backgroundFocalX: 20, backgroundFocalY: 30, backgroundOverlayColor: '#000', backgroundOverlayOpacity: 40,
        borderWidth: 2, borderStyle: 'solid', borderColor: '#ff000080', borderRadius: 9, shadow: 'md',
        fontFamily: 'theme.heading', fontSize: 30, fontWeight: 700, lineHeight: 1.25, letterSpacing: 0.5, textAlign: 'left', textColor: 'theme.text',
        width: 90, maxWidth: 900, align: 'center', verticalAlign: 'middle', minHeight: 300,
        hidden: false, customClass: 'wide'
      },
      tablet: {
        paddingTop: 20, marginTop: 0, backgroundColor: '#112233', backgroundFocalX: 50, borderStyle: 'dashed',
        fontFamily: 'Open Sans', fontSize: 24, textAlign: 'center', width: 100, align: 'start', hidden: true
      },
      mobile: {
        paddingTop: 30, paddingLeft: 0, backgroundImage: '', backgroundOverlayOpacity: 10, shadow: 'none',
        fontWeight: 400, lineHeight: 1.5, letterSpacing: -1, textColor: '#fafafa', maxWidth: 400, verticalAlign: 'bottom', minHeight: 0, hidden: false
      }
    };
    return { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [column('c1', [])], {}, style)] };
  }

  /** The CSS properties each style key writes, from the design document's table, written by hand. */
  const PROP_OF = {
    paddingTop: ['padding-top'], paddingRight: ['padding-right'], paddingBottom: ['padding-bottom'], paddingLeft: ['padding-left'],
    marginTop: ['margin-top'], marginRight: ['margin-right'], marginBottom: ['margin-bottom'], marginLeft: ['margin-left'],
    backgroundColor: ['background-color'], backgroundImage: ['background-image'],
    backgroundFocalX: ['--jvb-fx'], backgroundFocalY: ['--jvb-fy'], backgroundOverlayColor: ['--jvb-ovc'], backgroundOverlayOpacity: ['--jvb-ovo'],
    borderWidth: ['border-width'], borderStyle: ['border-style'], borderColor: ['border-color'], borderRadius: ['border-radius'], shadow: ['box-shadow'],
    fontFamily: ['font-family'], fontSize: ['font-size'], fontWeight: ['font-weight'], lineHeight: ['line-height'], letterSpacing: ['letter-spacing'],
    textAlign: ['text-align'], textColor: ['color'], width: ['width'], maxWidth: ['max-width'], align: ['align-self'], verticalAlign: ['justify-content'],
    minHeight: ['min-height'], hidden: ['display'], customClass: []
  };

  it('the table above covers every style key the model has', () => {
    assert.deepEqual(Object.keys(PROP_OF).sort(), Object.keys(STYLE_KEYS).sort());
  });

  it('golden: a node with all three layers, exactly', () => {
    const doc = {
      version: 1, theme: structuredClone(DEFAULT_THEME),
      sections: [section('s1', [column('c1', [node('heading', { text: 'x' }, 'h1', {
        desktop: { fontFamily: 'theme.heading', fontSize: 40, textColor: 'theme.primary', paddingTop: 16, marginBottom: 8 },
        tablet: { fontSize: 32, paddingTop: 12 },
        mobile: { fontSize: 24, textAlign: 'center', hidden: true }
      })])])]
    };
    const lines = render(doc, {}).css.split('\n');
    const at = lines.findIndex(l => l.startsWith('#jvb-root .jvb-n-h1{'));
    assert.deepEqual(lines.slice(at), [
      '#jvb-root .jvb-n-h1{padding-top:16px;margin-bottom:8px;font-family:var(--jvb-font-heading);font-size:40px;color:var(--jvb-primary)}',
      '@media (max-width: 1024px){',
      '#jvb-root .jvb-n-h1{padding-top:12px;font-size:32px}',
      '}',
      '@media (max-width: 640px){',
      '#jvb-root .jvb-n-s1 > .jvb-row{flex-direction:column}',
      '#jvb-root .jvb-n-s1 > .jvb-row > .jvb-col{flex:0 0 auto;width:100%}',
      '#jvb-root .jvb-n-h1{font-size:24px;text-align:center;display:none}',
      '}'
    ]);
  });

  it('the theme becomes custom properties on the root and a token becomes var(--jvb-...)', () => {
    const { css } = render(pageWith(node('text', { text: 'x' }, 't1', { desktop: { textColor: 'theme.muted', backgroundColor: 'theme.primary', borderColor: 'theme.secondary' } })), {});
    const root = css.split('\n')[0];
    for (const [k, v] of Object.entries(DEFAULT_THEME.colors)) assert.ok(root.includes(`--jvb-${k}:${v};`), k);
    assert.ok(root.includes('--jvb-font-heading:"Playfair Display",sans-serif;'));
    assert.ok(root.includes('--jvb-font-body:"Outfit",sans-serif;'));
    assert.ok(root.includes('--jvb-container:840px;'));
    assert.ok(css.includes('#jvb-root .jvb-n-t1{background-color:var(--jvb-primary);border-color:var(--jvb-secondary);color:var(--jvb-muted)}'));
  });

  it('media queries: desktop first, then 1024, then 640, nothing else', () => {
    const { css } = render(styledDoc(), {});
    const t = css.indexOf('@media (max-width: 1024px){');
    const m = css.indexOf('@media (max-width: 640px){');
    const d = css.indexOf('#jvb-root .jvb-n-s1{padding-top:10px');
    assert.ok(d > 0 && d < t && t < m, `desktop ${d}, tablet ${t}, mobile ${m}`);
    assert.equal((css.match(/@media/g) || []).length, 2);
    assert.equal(css.indexOf('@media (max-width: 1024px){', t + 1), -1);
    const parsed = parseCss(css);
    assert.equal(parsed.medias, 2);
  });

  it('each block holds only the keys its layer sets', () => {
    const doc = styledDoc();
    const parsed = parseCss(render(doc, {}).css);
    const style = doc.sections[0].style;
    for (const [block, layerName] of [['top', 'desktop'], ['tablet', 'tablet'], ['mobile', 'mobile']]) {
      const props = new Set(declsOf(parsed[block], 's1').keys());
      const expected = new Set(Object.keys(style[layerName]).flatMap(k => PROP_OF[k]));
      assert.deepEqual([...props].sort(), [...expected].sort(), `${block} block`);
    }
    // a tablet-only key never leaks into the desktop block, a mobile one never into tablet
    assert.ok(declsOf(parsed.top, 's1').has('border-color'));
    assert.ok(!declsOf(parsed.tablet, 's1').has('max-width'));
    assert.ok(!declsOf(parsed.mobile, 's1').has('width'));
  });

  it('the cascade of the blocks is resolveStyle, for every style key and every device', () => {
    const doc = styledDoc();
    const parsed = parseCss(render(doc, {}).css);
    const sec = doc.sections[0];
    for (const device of DEVICES) {
      const cascaded = declsOf(parsed.top, 's1');
      if (device !== 'desktop') for (const [k, v] of declsOf(parsed.tablet, 's1')) cascaded.set(k, v);
      if (device === 'mobile') for (const [k, v] of declsOf(parsed.mobile, 's1')) cascaded.set(k, v);
      // 1. the properties present are exactly the ones resolveStyle's keys write
      const resolved = resolveStyle(sec, device);
      const expectedProps = new Set(Object.keys(resolved).flatMap(k => PROP_OF[k]));
      assert.deepEqual([...cascaded.keys()].sort(), [...expectedProps].sort(), `${device}: properties`);
      // 2. and the canvas branch writes the very same declarations
      const canvas = parseCss(render(doc, { device }).css);
      assert.deepEqual(Object.fromEntries(declsOf(canvas.top, 's1')), Object.fromEntries(cascaded), `${device}: canvas equals cascade`);
    }
  });

  it('pins the resolved values on each device', () => {
    const doc = styledDoc();
    const at = device => declsOf(parseCss(render(doc, { device }).css).top, 's1');
    assert.deepEqual(at('desktop'), mapOf({
      'padding-top': '10px', 'padding-right': '11px', 'padding-bottom': '12px', 'padding-left': '13px',
      'margin-top': '-5px', 'margin-right': '6px', 'margin-bottom': '7px', 'margin-left': '8px',
      'background-color': 'var(--jvb-surface)', 'background-image': 'url("https://img.example.com/bg.jpg")',
      '--jvb-fx': '20%', '--jvb-fy': '30%', '--jvb-ovc': '#000', '--jvb-ovo': '0.4',
      'border-width': '2px', 'border-style': 'solid', 'border-color': '#ff000080', 'border-radius': '9px', 'box-shadow': '0 4px 12px rgba(0,0,0,.22)',
      'font-family': 'var(--jvb-font-heading)', 'font-size': '30px', 'font-weight': '700', 'line-height': '1.25', 'letter-spacing': '0.5px', 'text-align': 'left', color: 'var(--jvb-text)',
      width: '90%', 'max-width': '900px', 'align-self': 'center', 'justify-content': 'center', 'min-height': '300px', display: 'flex'
    }));
    const tablet = at('tablet');
    assert.equal(tablet.get('padding-top'), '20px');
    assert.equal(tablet.get('margin-top'), '0px');
    assert.equal(tablet.get('background-color'), '#112233');
    assert.equal(tablet.get('--jvb-fx'), '50%');
    assert.equal(tablet.get('border-style'), 'dashed');
    assert.equal(tablet.get('font-family'), '"Open Sans",sans-serif');
    assert.equal(tablet.get('font-size'), '24px');
    assert.equal(tablet.get('text-align'), 'center');
    assert.equal(tablet.get('width'), '100%');
    assert.equal(tablet.get('align-self'), 'flex-start');
    assert.equal(tablet.get('display'), 'none', 'hidden true writes display none');
    assert.equal(tablet.get('padding-right'), '11px', 'a key the tablet layer leaves out is inherited');
    const mobile = at('mobile');
    assert.equal(mobile.get('padding-top'), '30px');
    assert.equal(mobile.get('padding-left'), '0px');
    assert.equal(mobile.get('background-image'), 'none');
    assert.equal(mobile.get('--jvb-ovo'), '0.1');
    assert.equal(mobile.get('box-shadow'), 'none');
    assert.equal(mobile.get('font-weight'), '400');
    assert.equal(mobile.get('letter-spacing'), '-1px');
    assert.equal(mobile.get('color'), '#fafafa');
    assert.equal(mobile.get('justify-content'), 'flex-end');
    assert.equal(mobile.get('min-height'), '0px');
    assert.equal(mobile.get('display'), 'flex', 'hidden false writes the natural display back');
    assert.equal(mobile.get('font-size'), '24px', 'inherited from tablet');
    assert.equal(mobile.get('align-self'), 'flex-start', 'inherited from tablet');
  });

  it('the natural display hidden:false writes back matches the node it is on', () => {
    const hide = (n) => ({ desktop: { hidden: true }, mobile: { hidden: false } });
    const doc = {
      version: 1, theme: structuredClone(DEFAULT_THEME),
      sections: [section('s1', [column('c1', [
        node('text', { text: 'x' }, 't1', hide()),
        node('testimonials', { items: [{ quote: 'q' }] }, 'g1', hide()),
        node('testimonials', { layout: 'stack', items: [{ quote: 'q' }] }, 'g2', hide()),
        node('checkoutButton', {}, 'k1', hide())
      ], hide())], {}, hide())]
    };
    const mobile = parseCss(render(doc, {}).css).mobile;
    const display = id => declsOf(mobile, id).get('display');
    assert.equal(display('s1'), 'flex');
    assert.equal(display('c1'), 'flex');
    assert.equal(display('t1'), 'block');
    assert.equal(display('g1'), 'grid');
    assert.equal(display('g2'), 'flex');
    assert.equal(display('k1'), 'flex');
  });

  it('the canvas branch: no media query, for every device, and the same html as the published page', () => {
    const doc = styledDoc();
    const published = render(doc, {});
    for (const device of DEVICES) {
      const canvas = render(doc, { device });
      assert.doesNotMatch(canvas.css, /@media/, device);
      assert.equal(canvas.html, published.html, `${device}: the html is byte for byte the published html`);
      assert.deepEqual(canvas.problems, []);
    }
    assert.notEqual(render(doc, { device: 'mobile' }).css, render(doc, { device: 'desktop' }).css);
  });

  it('the canvas stacks columns on the devices the section names; the page does it inside the query', () => {
    const doc = (stackOn) => ({ version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [column('c1', []), column('c2', [])], { stackOn })] });
    const stack = '#jvb-root .jvb-n-s1 > .jvb-row{flex-direction:column}';
    for (const [stackOn, expected] of [['tablet', { desktop: false, tablet: true, mobile: true }], ['mobile', { desktop: false, tablet: false, mobile: true }], ['never', { desktop: false, tablet: false, mobile: false }]]) {
      for (const device of DEVICES) assert.equal(render(doc(stackOn), { device }).css.includes(stack), expected[device], `${stackOn} on ${device}`);
    }
    const parsed = parseCss(render(doc('tablet'), {}).css);
    assert.ok(parsed.tablet.some(r => r.selector === '#jvb-root .jvb-n-s1 > .jvb-row' && r.body === 'flex-direction:column'));
    assert.ok(!parsed.mobile.some(r => r.selector === '#jvb-root .jvb-n-s1 > .jvb-row'), 'a tablet stack is not repeated inside the phone block');
    assert.ok(!parsed.top.some(r => r.body === 'flex-direction:column' && r.selector.includes('jvb-n-s1')));
    const mob = parseCss(render(doc('mobile'), {}).css);
    assert.equal(mob.tablet.length, 0);
    assert.ok(mob.mobile.some(r => r.selector === '#jvb-root .jvb-n-s1 > .jvb-row' && r.body === 'flex-direction:column'));
  });

  it('every rule starts with #jvb-root: static, per-node, inside the queries, and on the canvas', () => {
    const everything = pageWith(...Object.keys(WIDGET_REGISTRY).map((type, i) => node(type, {}, `w${i}`, { desktop: { fontSize: 20, hidden: false }, tablet: { fontSize: 18 }, mobile: { fontSize: 16 } })));
    everything.sections[0].style = styledDoc().sections[0].style;
    for (const css of [render(styledDoc(), {}).css, render(everything, {}).css, render(everything, { device: 'tablet' }).css]) {
      for (const line of css.split('\n')) {
        if (/^@media \(max-width: \d+px\)\{$/.test(line) || line === '}') continue;
        const m = /^([^{]+)\{([^}]*)\}$/.exec(line);
        assert.ok(m, `a rule: ${line.slice(0, 100)}`);
        for (const part of splitTop(m[1])) {
          assert.ok(part === '#jvb-root' || part.startsWith('#jvb-root '), `scoped: ${part}`);
        }
      }
    }
  });

  it('the static widget css holds no media query and nothing but #jvb-root rules', () => {
    const css = render(createEmptyPage(), {}).css;
    assert.doesNotMatch(css, /@media|@import|@font-face|url\(|expression|javascript:/i);
  });

  it('a background image address cannot leave its url("...")', () => {
    const nasty = 'https://img.example.com/a"b)c\'d{e}<f>.jpg';
    const doc = pageWith(node('text', { text: 'x' }, 't1', { desktop: { backgroundImage: nasty } }));
    assert.deepEqual(validateBuilderDoc(doc).problems, [], 'the model allows these characters');
    const { css } = render(doc, {});
    const decl = [...declsOf(parseCss(css).top, 't1')].find(([k]) => k === 'background-image')[1];
    assert.equal(decl, 'url("https://img.example.com/a%22b%29c%27d%7Be%7D%3Cf%3E.jpg")');
    assert.doesNotMatch(css, /<f>|"b\)/);
  });

  it('an overlay adds its own pseudo-element rules and lifts the content above it', () => {
    const doc = pageWith(node('text', { text: 'x' }, 't1', { desktop: { backgroundOverlayColor: '#000000', backgroundOverlayOpacity: 60 } }));
    const css = render(doc, {}).css;
    assert.ok(css.includes('#jvb-root .jvb-n-t1{position:relative}'));
    assert.ok(css.includes('#jvb-root .jvb-n-t1::before{content:"";position:absolute;'));
    assert.ok(css.includes('#jvb-root .jvb-n-t1 > *{position:relative}'));
    assert.ok(css.includes('#jvb-root .jvb-n-t1{--jvb-ovc:#000000;--jvb-ovo:0.6}'));
  });

  it('a column with a width stops growing; a stacked column ignores it', () => {
    const doc = { version: 1, theme: structuredClone(DEFAULT_THEME), sections: [section('s1', [column('c1', [], { desktop: { width: 40 } }), column('c2', [])], { stackOn: 'mobile' })] };
    const css = render(doc, {}).css;
    assert.ok(css.includes('#jvb-root .jvb-n-c1{width:40%;flex:0 1 auto}'));
    assert.ok(css.includes('#jvb-root .jvb-n-s1 > .jvb-row > .jvb-col{flex:0 0 auto;width:100%}'));
  });

  it('the section\'s column gap and the divider\'s props become scoped rules', () => {
    const doc = {
      version: 1, theme: structuredClone(DEFAULT_THEME),
      sections: [section('s1', [column('c1', [node('divider', { lineStyle: 'dotted', thickness: 4, color: 'theme.primary', length: 60 }, 'd1')])], { columnGap: 48 })]
    };
    const css = render(doc, {}).css;
    assert.ok(css.includes('#jvb-root .jvb-n-s1 > .jvb-row{gap:48px}'));
    assert.ok(css.includes('#jvb-root .jvb-n-d1 > hr{width:60%;border-top:4px dotted var(--jvb-primary)}'));
  });

  it('theme button style: pill rounds, outline keeps the fill off', () => {
    const themed = buttonStyle => render({ ...createEmptyPage({ buttonStyle }) }, {}).css.split('\n')[0];
    assert.ok(themed('pill').includes('--jvb-btn-radius:9999px;'));
    assert.ok(themed('outline').includes('--jvb-btn-bg:transparent;'));
    assert.ok(themed('solid').includes('--jvb-btn-bg:#EC4899;'));
    assert.ok(themed('solid').includes('--jvb-btn-fg:#0b0b10;'));
    assert.ok(render(createEmptyPage({ colors: { primary: '#102030' } }), {}).css.split('\n')[0].includes('--jvb-btn-fg:#ffffff;'), 'dark primary gets light text');
  });
});

// ---- fonts ----

describe('fonts', () => {
  it('lists each family once: the theme\'s heading and body, then any a style names', () => {
    const doc = pageWith(
      node('heading', { text: 'a' }, 'h1', { desktop: { fontFamily: 'Open Sans' }, tablet: { fontFamily: 'Lora' } }),
      node('heading', { text: 'b' }, 'h2', { desktop: { fontFamily: 'Open Sans' }, mobile: { fontFamily: 'theme.body' } }),
      node('text', { text: 'c' }, 't1', { desktop: { fontFamily: 'Outfit' } })
    );
    const { fonts } = render(doc, {});
    assert.deepEqual(fonts, ['Playfair Display', 'Outfit', 'Open Sans', 'Lora']);
    assert.equal(new Set(fonts).size, fonts.length);
  });

  it('one family for heading and body is listed once; a theme token is not a family', () => {
    const doc = createEmptyPage({ fonts: { heading: 'Inter', body: 'Inter' } });
    assert.deepEqual(render(doc, {}).fonts, ['Inter']);
    const tokens = pageWith(node('heading', { text: 'a' }, 'h1', { desktop: { fontFamily: 'theme.heading' } }));
    assert.deepEqual(render(tokens, {}).fonts, ['Playfair Display', 'Outfit']);
  });

  it('an invalid document lists none', () => {
    assert.deepEqual(render({}, {}).fonts, []);
  });
});

// ---- the sanitiser ----

// The strings public-inline-script.test.mjs puts through the published page, checked to still be
// there so these cannot drift from the file they claim to come from.
const BS = '\\';
const INLINE_FIXTURES = [
  `Ends with a backslash ${BS}`,
  `Buy "now" & save ${BS}`,
  `A&B${BS}`,
  `C:${BS}new path`,
  `abc${BS}`,
  '</script><script>alert(1)</script>',
  `SAVE'10${BS}`,
  `Upgrade ${BS}`,
  `Serum ${BS}`
];

describe('sanitizeHtml', () => {
  it('the fixtures come from public-inline-script.test.mjs as written there', () => {
    const src = fs.readFileSync(new URL('./public-inline-script.test.mjs', import.meta.url), 'utf8');
    for (const needle of [
      'Ends with a backslash ${BS}', 'Buy "now" & save ${BS}', 'A&B${BS}', 'C:${BS}new path', 'abc${BS}',
      "'</script><script>alert(1)</script>'", "SAVE'10${BS}", 'Upgrade ${BS}', 'Serum ${BS}'
    ]) assert.ok(src.includes(needle), needle);
  });

  it('the inline-script fixtures stay text: as markup, as a widget prop, never a script element', () => {
    for (const fixture of INLINE_FIXTURES) {
      const clean = sanitizeHtml(fixture);
      assert.doesNotMatch(clean, /<script/i, fixture);
      assert.doesNotMatch(clean, /<\/script/i, fixture);
      // every character that is not markup survives
      const wrapped = sanitizeHtml(`<p>${fixture}</p>`);
      assert.doesNotMatch(wrapped, /<script/i);
      for (const [type, props, key] of [['heading', { text: fixture }], ['button', { label: fixture }], ['checkoutButton', { label: fixture, discountCode: fixture }], ['stockCount', { text: fixture }], ['trustBadge', { text: fixture }], ['countdown', { minutes: 2, text: fixture, expiredText: fixture }], ['text', { text: fixture }]]) {
        const html = rw(type, props);
        assert.doesNotMatch(html, /<script/i, `${type}: ${fixture}`);
        assert.doesNotMatch(html, /<\/script/i, `${type}: ${fixture}`);
        void key;
      }
      // the backslash and quote fixtures keep their characters as text
      assert.ok(visibleText(rw('heading', { text: fixture }))[0].includes(fixture.replace(/<.*$/, '')), fixture);
    }
    assert.ok(visibleText(rw('heading', { text: INLINE_FIXTURES[0] }))[0] === INLINE_FIXTURES[0]);
    assert.equal(visibleText(rw('button', { label: INLINE_FIXTURES[1] }))[0], INLINE_FIXTURES[1]);
    assert.equal(visibleText(rw('heading', { text: INLINE_FIXTURES[5] }))[0], INLINE_FIXTURES[5], 'the script-closing string reads back as the text it was typed as');
  });

  const FORBIDDEN = /<script|<iframe|<svg|<math|<style|<form|<input|<button|<link|<meta|<object|<embed|javascript:|vbscript:|data:|<!--/i;

  const ATTACKS = [
    ['javascript: in mixed case', '<a href="JaVaScRiPt:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with a numeric entity', '<a href="&#106;avascript:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with hex entities and named colon', '<a href="&#x6A;&#x61;vascript&colon;alert(1)">safe text</a>', 'safe text'],
    ['javascript: with entities and no semicolons', '<a href="&#106avascript:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with a tab inside', '<a href="java\tscript:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with a newline inside', '<a href="java\nscript:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with entity tab and newline', '<a href="java&#9;scr&#10;ipt:alert(1)">safe text</a>', 'safe text'],
    ['javascript: with leading control characters and spaces', '<a href=" \u0001\u0002 javascript:alert(1)">safe text</a>', 'safe text'],
    ['javascript: unquoted', '<a href=javascript:alert(1)>safe text</a>', 'safe text'],
    ['javascript: single quoted', "<a href='javascript:alert(1)'>safe text</a>", 'safe text'],
    ['vbscript:', '<a href="vbscript:msgbox(1)">safe text</a>', 'safe text'],
    ['data: html link', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">safe text</a>', 'safe text'],
    ['data: image src', '<img src="data:image/png;base64,iVBORw0KGgo=" alt="pic">safe text', 'safe text'],
    ['data: image src in mixed case', '<img src="DaTa:image/svg+xml,<svg onload=alert(1)>">safe text', 'safe text'],
    ['protocol-relative link', '<a href="//evil.example/x">safe text</a>', 'safe text'],
    ['srcset', '<img src="/ok.png" srcset="javascript:alert(1) 1x, /b.png 2x" alt="pic">safe text', 'safe text'],
    ['onerror', '<img src="/missing.png" onerror="alert(1)" alt="pic">safe text', 'safe text'],
    ['onerror, unquoted and unclosed', '<img src=x onerror=alert(1)', null],
    ['onclick on a kept tag', '<b onclick="alert(1)" onmouseover=alert(2)>safe text</b>', 'safe text'],
    ['an on* attribute in upper case', '<p ONCLICK="alert(1)" OnLoad="alert(2)">safe text</p>', 'safe text'],
    ['a script inside a paragraph', '<p>before<script>alert(1)</script>safe text</p>', 'safe text'],
    ['a script in upper case', '<SCRIPT>alert(1)</SCRIPT>safe text', 'safe text'],
    ['a script that closes with a space', '<script >alert(1)</script >safe text', 'safe text'],
    ['a script with a src', '<script src="https://evil.example/x.js"></script>safe text', 'safe text'],
    ['a split script tag', '<scr<script>ipt>alert(1)</scr</script>ipt>safe text', 'safe text'],
    ['a doubled bracket', '<<script>script>alert(1)<</script>/script>safe text', 'safe text'],
    ['an iframe', '<iframe src="https://evil.example/"></iframe>safe text', 'safe text'],
    ['an iframe with srcdoc', '<iframe srcdoc="<script>alert(1)</script>">fallback</iframe>safe text', 'safe text'],
    ['an object and an embed', '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x.swf">safe text', 'safe text'],
    ['an svg with onload', '<svg onload="alert(1)"><circle r="1"/></svg>safe text', 'safe text'],
    ['a nested svg with a script', '<svg><svg><script>alert(1)</script></svg><g onload="x()"></g></svg>safe text', 'safe text'],
    ['a math element', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>safe text', 'safe text'],
    ['a style element', '<style>body{display:none}</style>safe text', 'safe text'],
    ['a style attribute', '<p style="background:url(javascript:alert(1))">safe text</p>', 'safe text'],
    ['a comment hiding a script', '<!-- <script>alert(1)</script> -->safe text', 'safe text'],
    ['an unterminated comment', 'safe text<!-- <script>alert(1)</script>', 'safe text'],
    ['a conditional comment', '<!--[if IE]><script>alert(1)</script><![endif]-->safe text', 'safe text'],
    ['a cdata section', '<![CDATA[<script>alert(1)</script>]]>safe text', null],
    ['a link with target blank and no rel', '<a href="https://ok.example/" target="_blank">safe text</a>', 'safe text'],
    ['a link with target blank and a hostile rel', '<a href="https://ok.example/" target="_blank" rel="opener">safe text</a>', 'safe text'],
    ['a nested form', '<form action="https://evil.example/steal"><form><input name="x"></form>hidden</form>safe text', 'safe text'],
    ['a form with a button and select', '<form><button formaction="javascript:alert(1)">go</button><select><option>x</option></select></form>safe text', 'safe text'],
    ['a template', '<template><script>alert(1)</script></template>safe text', 'safe text'],
    ['a noscript', '<noscript><p title="</noscript><script>alert(1)</script>"></noscript>safe text', 'safe text'],
    ['a textarea hiding markup', '<textarea></textarea><script>alert(1)</script>safe text', 'safe text'],
    ['a base tag', '<base href="https://evil.example/">safe text', 'safe text'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">safe text', 'safe text'],
    ['a link stylesheet', '<link rel="stylesheet" href="https://evil.example/x.css">safe text', 'safe text'],
    ['an img with a null byte in the scheme', '<a href="java\u0000script:alert(1)">safe text</a>', 'safe text'],
    ['escaped markup stays text', '&lt;script&gt;alert(1)&lt;/script&gt;safe text', 'safe text'],
    ['a lone angle bracket', 'a < b and c > d, safe text', 'safe text']
  ];

  for (const [name, input, safe] of ATTACKS) {
    it(`attack: ${name}`, () => {
      const out = sanitizeHtml(input);
      assert.doesNotMatch(out, FORBIDDEN, out);
      for (const name of attributeNames(out)) assert.ok(!name.startsWith('on') && name !== 'style' && name !== 'srcset', `attribute ${name} in ${out}`);
      if (safe) assert.ok(out.includes(safe), `the safe text survives: ${out}`);
      // the same string through the widget, which is where a merchant types it
      const widget = rw('htmlEmbed', { html: input });
      assert.doesNotMatch(widget, FORBIDDEN, widget);
      for (const name of attributeNames(widget)) assert.ok(!name.startsWith('on') && name !== 'style' && name !== 'srcset', `attribute ${name} in ${widget}`);
    });
  }

  it('keeps the tags and attributes it promises', () => {
    assert.equal(
      sanitizeHtml('<p class="note x">One <strong>two</strong> <em>three</em><br>four <a href="https://ok.example/p?a=1&amp;b=2" title="T">link</a></p><ul><li>x</li></ul><img src="/a.png" alt="A" width="10" height="20" loading="lazy">'),
      '<p class="note x">One <strong>two</strong> <em>three</em><br>four <a href="https://ok.example/p?a=1&amp;b=2" title="T">link</a></p><ul><li>x</li></ul><img src="/a.png" alt="A" width="10" height="20" loading="lazy">'
    );
    assert.equal(
      sanitizeHtml('<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table><blockquote>q</blockquote><pre><code>c</code></pre><hr><h2>x</h2>'),
      '<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table><blockquote>q</blockquote><pre><code>c</code></pre><hr><h2>x</h2>'
    );
    assert.equal(sanitizeHtml('<a href="#offer">a</a> <a href="/p">b</a> <a href="https://ok.example/">c</a>'), '<a href="#offer">a</a> <a href="/p">b</a> <a href="https://ok.example/">c</a>');
  });

  it('drops an unlisted tag and keeps its text; drops the h1', () => {
    assert.equal(sanitizeHtml('<h1>Title</h1><center>mid</center><font color="red">f</font>'), 'Titlemidf');
  });

  it('writes target only itself and never without rel', () => {
    assert.equal(
      sanitizeHtml('<a href="https://ok.example/" target="_blank" rel="opener">x</a>'),
      '<a href="https://ok.example/" target="_blank" rel="noopener noreferrer">x</a>'
    );
    assert.equal(sanitizeHtml('<a href="https://ok.example/" target="_top">x</a>'), '<a href="https://ok.example/">x</a>');
    assert.equal(sanitizeHtml('<a target="_blank">x</a>'), '<a>x</a>');
    for (const out of [sanitizeHtml('<a href="/a" target="_blank">1</a><a href="/b" target=" _BLANK ">2</a>')]) {
      for (const a of out.match(/<a [^>]*>/g)) assert.match(a, /target="_blank" rel="noopener noreferrer"/);
    }
  });

  it('decodes entities in a link before the check and writes the decoded address, escaped', () => {
    assert.equal(sanitizeHtml('<a href="https://ok.example/?a=1&amp;b=2">x</a>'), '<a href="https://ok.example/?a=1&amp;b=2">x</a>');
    assert.equal(sanitizeHtml('<a href="&#x68;ttps://ok.example/">x</a>'), '<a href="https://ok.example/">x</a>');
    assert.equal(sanitizeHtml('<a href="ht&#9;tps://ok.example/">x</a>'), '<a href="https://ok.example/">x</a>');
  });

  it('always answers balanced markup', () => {
    assert.equal(sanitizeHtml('</div></div><b>x'), '<b>x</b>');
    assert.equal(sanitizeHtml('<p><b>x</p>y'), '<p><b>x</b></p>y');
    assert.equal(sanitizeHtml('<div><div>a</div>'), '<div><div>a</div></div>');
    assert.equal(sanitizeHtml('x</p>'), 'x');
  });

  it('handles non-strings, empty input and a very long run without throwing', () => {
    for (const v of [undefined, null, 3, {}, [], '']) assert.equal(sanitizeHtml(v), '');
    const long = '<p>' + 'a<b>'.repeat(4000) + '</p>' + '<' .repeat(4000);
    assert.doesNotThrow(() => sanitizeHtml(long));
    assert.doesNotMatch(sanitizeHtml(long), /<<|<(?![a-z/])/);
  });
});

describe('renderMarkdownSubset', () => {
  it('escapes first: markup the merchant typed stays text', () => {
    assert.equal(renderMarkdownSubset('<script>alert(1)</script> & <b>x</b>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;</p>');
    assert.equal(renderMarkdownSubset('**<i>bold</i>**'), '<p><strong>&lt;i&gt;bold&lt;/i&gt;</strong></p>');
  });

  it('paragraphs, line breaks, bold, italic, links and lists', () => {
    assert.equal(renderMarkdownSubset('One\ntwo\n\nThree'), '<p>One<br>two</p><p>Three</p>');
    assert.equal(renderMarkdownSubset('**b** *i* _j_ 2 * 3 * 4'), '<p><strong>b</strong> <em>i</em> <em>j</em> 2 * 3 * 4</p>');
    assert.equal(renderMarkdownSubset('* a\n* b\n\n1. c\n2) d'), '<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>');
    assert.equal(renderMarkdownSubset('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('a link goes through the model\'s rule; a refused one prints its label', () => {
    assert.equal(renderMarkdownSubset('[a](https://ok.example/x) [b](/p) [c](#top) [d](javascript:alert) [e](//evil.example) [f](data:text/html,x)'),
      '<p><a href="https://ok.example/x">a</a> <a href="/p">b</a> <a href="#top">c</a> d e f</p>');
    assert.equal(renderMarkdownSubset('[**x**](https://ok.example/)'), '<p><a href="https://ok.example/"><strong>x</strong></a></p>');
  });

  it('emphasis never spans a link or produces crossed tags', () => {
    for (const s of ['**a *b** c*', '*a **b* c**', '**a [b](/x) c**', '_a *b_ c*']) {
      const out = renderMarkdownSubset(s);
      const stack = [];
      for (const m of out.matchAll(/<(\/?)(strong|em|a|p)\b[^>]*>/g)) {
        if (m[1]) assert.equal(stack.pop(), m[2], `${s} -> ${out}`);
        else stack.push(m[2]);
      }
      assert.deepEqual(stack, [], `${s} -> ${out}`);
    }
  });

  it('empty and non-string input is empty', () => {
    for (const v of [undefined, null, 3, '', '  \n\n  ']) assert.equal(renderMarkdownSubset(v), '');
  });
});

// ---- video ----

describe('videoEmbed', () => {
  const YT = 'dQw4w9WgXcQ';
  const NOCOOKIE = `https://www.youtube-nocookie.com/embed/${YT}`;

  it('reads every YouTube spelling the allowlist names, with query strings and fragments', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${YT}`,
      `https://youtube.com/watch?v=${YT}&t=10s&list=PL1`,
      `https://m.youtube.com/watch?feature=share&v=${YT}`,
      `https://www.youtube.com/watch?v=${YT}#t=5`,
      `https://youtu.be/${YT}`,
      `https://youtu.be/${YT}?si=abc&t=3`,
      `https://youtu.be/${YT}#frag`,
      `https://www.youtube.com/embed/${YT}`,
      `https://www.youtube.com/embed/${YT}?rel=0#x`,
      `https://www.youtube-nocookie.com/embed/${YT}`,
      `https://youtube-nocookie.com/embed/${YT}?controls=0`,
      `HTTPS://WWW.YOUTUBE.COM/watch?v=${YT}`,
      `http://www.youtube.com/watch?v=${YT}`,
      `https://www.youtube.com/shorts/${YT}`
    ]) {
      const v = videoEmbed(url, 'T');
      assert.ok(v, url);
      assert.equal(v.provider, 'youtube', url);
      assert.equal(v.id, YT, url);
      assert.equal(v.src, NOCOOKIE, url);
    }
  });

  it('reads Vimeo links', () => {
    for (const url of [
      'https://vimeo.com/76979871',
      'https://www.vimeo.com/76979871',
      'https://vimeo.com/76979871?share=copy#t=10s',
      'https://vimeo.com/channels/staffpicks/76979871',
      'https://player.vimeo.com/video/76979871',
      'https://player.vimeo.com/video/76979871?h=abc&autoplay=1#t=5s'
    ]) {
      const v = videoEmbed(url, 'T');
      assert.ok(v, url);
      assert.equal(v.provider, 'vimeo', url);
      assert.equal(v.id, '76979871', url);
      assert.equal(v.src, 'https://player.vimeo.com/video/76979871', url);
    }
  });

  it('writes the frame itself: title escaped, start in the provider\'s own form, no address of the merchant\'s', () => {
    const v = videoEmbed(`https://www.youtube.com/watch?v=${YT}&autoplay=1&evil="><script>`, 'A "title" <b>', 65);
    assert.equal(v.html, `<iframe src="${NOCOOKIE}?start=65" title="A &quot;title&quot; &lt;b&gt;" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`);
    assert.equal(videoEmbed('https://vimeo.com/123', '', 7).src, 'https://player.vimeo.com/video/123#t=7s');
    assert.doesNotMatch(videoEmbed('https://vimeo.com/123').html, /title=/);
    for (const bad of [-1, 1.5, 86401, '30', NaN, null]) assert.equal(videoEmbed(`https://youtu.be/${YT}`, '', bad).src, NOCOOKIE);
  });

  it('refuses another host, a missing id, an illegal id, and anything that is not a web link', () => {
    for (const url of [
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://evil.example/https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch?v=',
      'https://www.youtube.com/',
      'https://www.youtube.com/channel/UC1234567890',
      'https://youtu.be/',
      'https://www.youtube.com/embed/',
      'https://www.youtube.com/watch?v=abc',
      'https://www.youtube.com/watch?v=abc"def"ghijk',
      'https://www.youtube.com/watch?v=abc<def>ghijk',
      'https://www.youtube.com/watch?v=abc%22def%22ghijk',
      'https://www.youtube.com/watch?v=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'https://youtu.be/ab cdef',
      'https://vimeo.com/',
      'https://vimeo.com/channels/staffpicks',
      'https://vimeo.com/abc123',
      'https://player.vimeo.com/video/abc',
      'https://player.vimeo.com/',
      'https://player.vimeo.com/video/1234567890123',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
      '//www.youtube.com/watch?v=dQw4w9WgXcQ',
      '/watch?v=dQw4w9WgXcQ',
      '#top',
      'https://user:pw@evil.example/',
      ''
    ]) assert.equal(videoEmbed(url, 't'), null, JSON.stringify(url));
    for (const v of [undefined, null, 3, {}, []]) assert.equal(videoEmbed(v), null);
  });

  it('a video widget with an unreadable link draws nothing', () => {
    assert.equal(rw('video', { url: 'https://example.com/x' }), '');
    assert.equal(rw('video', { url: 'https://www.youtube.com/watch?v=abc' }), '');
  });
});

// ---- no script, from any widget ----

describe('no widget ever writes a script element', () => {
  const HOSTILE = '</script><script>alert(1)</script><img src=x onerror=alert(1)>';

  /** Props with every text field set to the hostile string, and one item in each list. */
  function hostileProps(type) {
    const out = {};
    for (const [key, spec] of Object.entries(WIDGET_REGISTRY[type].props)) {
      if (spec.kind === 'string' || spec.kind === 'html') out[key] = HOSTILE;
      else if (spec.kind === 'list') {
        const item = {};
        for (const [field, fieldSpec] of Object.entries(spec.item)) item[field] = fieldSpec.kind === 'string' ? HOSTILE : fieldSpec.kind === 'number' ? 3 : '';
        out[key] = [item];
      } else if (spec.kind === 'url') out[key] = type === 'video' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://ok.example/p.png';
    }
    if (type === 'orderBump') out.variantId = '99';
    if (type === 'productHero') out.variantId = '99';
    if (type === 'countdown') out.minutes = 3;
    if (type === 'stockCount') out.count = 3;
    return out;
  }

  for (const type of Object.keys(WIDGET_REGISTRY)) {
    it(`${type}`, () => {
      const html = rw(type, hostileProps(type), { slug: HOSTILE, currency: HOSTILE, storeDomain: HOSTILE, reviews: { summary: { averageRating: 5, totalCount: 2 }, reviews: [{ rating: 5, reviewTitle: HOSTILE, reviewText: HOSTILE, customerName: HOSTILE, tags: [HOSTILE], photos: [`https://p.example.com/${HOSTILE}`] }] } });
      // a hostile embed is sanitised to nothing, which draws nothing; every other widget draws
      if (type !== 'htmlEmbed') assert.ok(html.length > 0, `${type} draws something with this input`);
      else assert.equal(html, '');
      assert.doesNotMatch(html, /<script/i, type);
      for (const name of attributeNames(html)) assert.ok(!name.startsWith('on') && name !== 'style' && name !== 'srcset', `${type}: attribute ${name}`);
      // text from the merchant is escaped, never raw
      assert.ok(!html.includes(HOSTILE), `${type}: the hostile string is not written raw`);
    });
  }

  it('the whole page is script-free and so is its css, with hostile text everywhere', () => {
    const doc = pageWith(...Object.keys(WIDGET_REGISTRY).map((type, i) => node(type, hostileProps(type), `w${i}`)));
    const out = render(doc, { slug: HOSTILE });
    assert.deepEqual(out.problems, []);
    assert.ok(out.html.length > 1000);
    assert.doesNotMatch(out.html, /<script/i);
    assert.doesNotMatch(out.css, /<script|<\/style/i);
    for (const name of attributeNames(out.html)) assert.ok(!name.startsWith('on') && name !== 'style' && name !== 'srcset', name);
  });
});

// ---- words the merchant did not write ----

describe('words the merchant did not write', () => {
  const FALLBACKS = Object.values(WIDGET_REGISTRY).flatMap(def => Object.values(def.fallbacks));

  it('no fallback and no structural word carries an em dash or a spaced en dash', () => {
    assert.ok(FALLBACKS.length >= 10, `${FALLBACKS.length} fallbacks`);
    for (const word of [...FALLBACKS, ...Object.values(STRUCTURAL_WORDS)]) {
      assert.doesNotMatch(word, /\u2014|\u2013| - /, word);
    }
  });

  it('a widget with default props draws only registry fallbacks and the listed structural words', () => {
    const allowed = new Set([...FALLBACKS, ...Object.values(STRUCTURAL_WORDS).map(w => w.trim())].filter(Boolean));
    allowed.add('0'); // a count the merchant set to zero is a number, not a word
    const ctx = { slug: 's', realVariantId: () => 'v' };
    for (const type of Object.keys(WIDGET_REGISTRY)) {
      const html = renderWidget(node(type, {}), ctx);
      for (const piece of visibleText(html)) assert.ok(allowed.has(piece), `${type} wrote "${piece}"`);
    }
  });

  it('fallbacks appear where the registry says and nowhere else', () => {
    const fb = type => WIDGET_REGISTRY[type].fallbacks;
    assert.ok(rw('countdown', { minutes: 5 }).includes(fb('countdown').text));
    assert.ok(rw('countdown', { minutes: 5 }).includes(fb('countdown').expiredText));
    assert.ok(rw('leadForm').includes(fb('leadForm').heading));
    assert.ok(rw('leadForm').includes(`>${fb('leadForm').buttonText}</button>`));
    assert.ok(rw('leadForm').includes(fb('leadForm').successText));
    assert.ok(rw('checkoutButton').includes(`>${fb('checkoutButton').label}</button>`));
    assert.ok(rw('orderBump', { variantId: '1' }).includes(fb('orderBump').headline));
    assert.ok(rw('orderBump', { variantId: '1' }).includes(fb('orderBump').title));
    assert.ok(rw('reviewsWall', {}, { reviews: { reviews: [{ rating: 5 }] } }).includes(fb('reviewsWall').headline));
    assert.ok(rw('stockCount', { count: 9 }).includes('Limited batch: 9 units remaining'));
    // the merchant's words replace them
    assert.ok(!rw('checkoutButton', { label: 'Buy' }).includes(fb('checkoutButton').label));
    assert.ok(!rw('leadForm', { heading: 'Hi', buttonText: 'Go', successText: 'Done' }).includes('Leave your email'));
  });

  it('a heading with no text has no fallback: it draws nothing', () => {
    assert.equal(rw('heading', {}), '');
    assert.equal(rw('text', {}), '');
  });
});

// ---- agreement with the model's link rule ----

describe('links', () => {
  const LINKS = [
    '', '/p', '/p?x=1#y', '#offer', '#', 'https://ok.example/', 'http://ok.example/a b', 'https://ok.example/a"b', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)',
    'data:text/html,x', '//evil.example', 'ftp://x.example/', 'https:///nohost', '/\\evil', 'https://ok.example/\n', 'mailto:a@b.co', 'tel:+15551234'
  ];

  it('a heading link, a button link and an image link are written exactly when the model allows them', () => {
    for (const link of LINKS) {
      const allowed = link !== '' && linkProblem(link) === null;
      const heading = rw('heading', { text: 'x', link });
      assert.equal(heading.includes('<a '), allowed, `heading ${JSON.stringify(link)}`);
      const button = rw('button', { label: 'x', url: link });
      assert.equal(button.startsWith('<a '), allowed, `button ${JSON.stringify(link)}`);
      const image = rw('image', { src: '/i.png', link });
      assert.equal(image.includes('<a '), allowed, `image ${JSON.stringify(link)}`);
    }
  });

  it('every href and src the page writes passes the model\'s rule', () => {
    const doc = pageWith(
      node('heading', { text: 'h', link: 'https://ok.example/a?b=1&c=2' }, 'h1'),
      node('text', { text: '[x](https://ok.example/a?b=1&c=2) [y](/p)' }, 't1'),
      node('image', { src: 'https://ok.example/i.png', link: '#top' }, 'i1'),
      node('htmlEmbed', { html: '<a href="https://ok.example/&amp;x">a</a><img src="/i.png">' }, 'e1'),
      node('testimonials', { items: [{ quote: 'q', avatarUrl: 'https://ok.example/a.png' }] }, 'g1')
    );
    const { html } = render(doc, {});
    const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
    assert.ok(urls.length >= 7, `${urls.length} urls`);
    for (const url of urls) assert.equal(linkProblem(url), null, url);
  });
});

// ---- context ----

describe('context', () => {
  it('the A/B version and slug reach the lead form; the currency is upper case and three letters', () => {
    const html = rw('leadForm', {}, { slug: 'my-page', variant: 'b', currency: 'gbpx' });
    assert.match(html, /name="slug" value="my-page"/);
    assert.match(html, /name="variant" value="b"/);
    assert.match(html, /name="currency" value="GBP"/);
    assert.match(rw('leadForm', {}, { variant: 'zzz' }), /name="variant" value="a"/);
  });

  it('a placeholder variant is refused in one place: the context\'s realVariantId', () => {
    const calls = [];
    const realVariantId = v => { calls.push(v); return v === 'real' ? 'real' : ''; };
    assert.equal(rw('orderBump', { variantId: 'fake' }, { realVariantId }), '');
    assert.ok(rw('orderBump', { variantId: 'real' }, { realVariantId }).includes('data-variant-id="real"'));
    assert.deepEqual(calls, ['fake', 'real']);
  });

  it('formatPrice shows the visitor\'s currency and the base price stays in data-base-price', () => {
    const html = rw('productHero', { variantId: '1', price: '$10.00', imageUrl: '/p.png' }, { formatPrice: p => `EUR ${p}` });
    assert.match(html, /data-base-price="\$10\.00">EUR \$10\.00</);
  });
});
