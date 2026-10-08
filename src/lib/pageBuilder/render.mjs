// The landing page builder's renderer (LANDING_BUILDER_PLAN.md Wave 1a, LANDING_BUILDER_DESIGN.md
// section 3): one builder document in, `{ html, css, problems, fonts }` out. The Express server
// imports it for /p/* and the editor's canvas imports it, so the preview is the page.
//
// Plain ESM JavaScript that imports only ./model.mjs. No DOM, no network, no clock, no
// randomness: the same document and context give the same strings, byte for byte.
//
// Rules this file keeps:
// 1. Validate first. A document with problems renders nothing and answers the problems.
// 2. Every text prop is escaped. Every link is checked again with the model's link rule
//    (linkProblem) before it is written. Nothing from the document reaches CSS except a number
//    in its range, a colour, a font family name, an enum value or a link, each re-checked here.
// 3. Every CSS rule starts with #jvb-root, so nothing the merchant sets can reach the frame
//    (consent banner, lead modal, sticky bar) or the cockpit around the canvas.
// 4. The only words the page prints that the merchant did not write are the registry's
//    `fallbacks`, plus a short list of structural words kept from today's page and named in
//    STRUCTURAL_WORDS below. Where the contract says "renders nothing", this renders nothing.
// 5. No output string ever contains a script element. Behaviour (the countdown clock, the
//    checkout click, the lead submit, the review photo viewer) belongs to the fixed frame, which
//    finds the markup by the ids and data attributes written here.

import {
  BREAKPOINTS,
  DEFAULT_THEME,
  DEVICES,
  STYLE_KEYS,
  THEME_COLOR_KEYS,
  WIDGET_REGISTRY,
  linkProblem,
  propsWithDefaults,
  resolveStyle,
  SEEDED_TRUST,
  validateBuilderDoc,
  walk
} from './model.mjs';

/**
 * Every word the renderer writes that is neither the merchant's nor a registry fallback. Each is
 * a label a screen reader or a form needs, kept from today's published page. Listed so a reviewer
 * can see the whole set in one place, and pinned by the render tests.
 */
export const STRUCTURAL_WORDS = Object.freeze({
  /** Lead form field labels (design section 8, question 9: visible labels). */
  fieldName: 'Name',
  fieldEmail: 'Email',
  fieldPhone: 'Phone',
  /** The code line under a checkout button, today's "Code X is ready at checkout". */
  codeBefore: 'Code ',
  codeAfter: ' is ready at checkout',
  /** The reviews wall's summary pill and per-review badge, from reviewEngine.mjs. */
  review: 'review',
  reviews: 'reviews',
  verified: '✓ Verified',
  photoButton: 'Open customer photo',
  /** Star ratings' accessible names. */
  starsAfter: ' out of 5 stars'
});

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes text for an element body or a double-quoted attribute. */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);
}

/** Escaped text with its line breaks kept as <br>. */
function escLines(v) {
  return esc(String(v ?? '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A string prop, or '' for anything else. */
function text(v) {
  return typeof v === 'string' ? v : '';
}

/** A trimmed string prop; '' for blank. */
function trimmed(v) {
  return text(v).trim();
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

/** Numbers are written rounded to four places, never in exponent form. */
function fmt(n) {
  const r = Math.round(Number(n) * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ANCHOR_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FONT_RE = /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/;
const CLASS_LIST_RE = /^[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z_][A-Za-z0-9_-]*)*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const THEME_TOKEN_RE = /^theme\.([A-Za-z]+)$/;

/** Ids the fixed frame owns; an anchor named like one is not written. */
const FRAME_ID_RE = /^(?:jv|jvb|lead|modal|bump|btn)[-_]|^(?:main-cta-btn|page-order-bump|product-img|product-price)$/i;

/**
 * A link as the page may print it, or '' when the model's link rule refuses it. This is the one
 * place the renderer asks the question, and it asks the model.
 */
function safeLink(v) {
  if (typeof v !== 'string' || v === '') return '';
  return linkProblem(v) === null ? v : '';
}

// ---------------------------------------------------------------------------------------------
// HTML entities and the sanitiser
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', tab: '\t', newline: '\n',
  colon: ':', sol: '/', lpar: '(', rpar: ')', period: '.', comma: ',', semi: ';', num: '#',
  excl: '!', quest: '?', equals: '=', lowbar: '_', plus: '+', percnt: '%', commat: '@'
};

/** Decodes numeric and a small set of named entities, with or without the closing semicolon. */
function decodeEntities(s) {
  return String(s).replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, (m, hex, dec, name) => {
    if (hex !== undefined || dec !== undefined) {
      const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
      if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return String.fromCodePoint(cp);
      return '�';
    }
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m;
  });
}

/**
 * A URL attribute as the browser would read it: entities decoded, tab and newlines removed from
 * anywhere in it, leading and trailing control characters and spaces trimmed. The check happens
 * on this form, and this form is what is written.
 */
function cleanUrlAttr(raw) {
  return decodeEntities(raw).replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

const KEEP_TAGS = new Set('p br strong b em i u s small span div blockquote ul ol li h2 h3 h4 h5 h6 hr a img figure figcaption table thead tbody tr th td code pre'.split(' '));
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const DROP_WITH_CONTENT = new Set('script style template noscript iframe frame object embed applet form input button select textarea link meta base svg math'.split(' '));
/** Dropped tags that never have content, so nothing after them is swallowed. */
const DROP_VOID = new Set(['input', 'link', 'meta', 'base', 'frame', 'embed']);
/** Dropped tags whose content a browser reads as raw text up to the matching close tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'noscript', 'iframe']);

/** Reads a tag's attributes from `pos`. Null when the tag never closes. */
function readTag(src, pos) {
  const attrs = [];
  const n = src.length;
  for (;;) {
    while (pos < n && /[\s/]/.test(src[pos])) pos += 1;
    if (pos >= n) return null;
    if (src[pos] === '>') return { attrs, end: pos + 1 };
    const nameMatch = /^[^\s"'<>/=]+/.exec(src.slice(pos, pos + 200));
    if (!nameMatch) {
      pos += 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    pos += nameMatch[0].length;
    while (pos < n && /\s/.test(src[pos])) pos += 1;
    let value = '';
    if (src[pos] === '=') {
      pos += 1;
      while (pos < n && /\s/.test(src[pos])) pos += 1;
      const q = src[pos];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, pos + 1);
        if (close < 0) return null;
        value = src.slice(pos + 1, close);
        pos = close + 1;
      } else {
        const valMatch = /^[^\s>]*/.exec(src.slice(pos));
        value = valMatch ? valMatch[0] : '';
        pos += value.length;
      }
    }
    attrs.push([name, value]);
  }
}

/** Where to resume after a dropped tag that has content. */
function skipContent(src, from, name) {
  const lower = src.toLowerCase();
  if (RAW_TEXT.has(name)) {
    const re = new RegExp(`</${name}(?=[\\s/>])`, 'g');
    re.lastIndex = from;
    const m = re.exec(lower);
    if (!m) return src.length;
    const end = src.indexOf('>', m.index);
    return end < 0 ? src.length : end + 1;
  }
  const re = new RegExp(`<(/?)${name}(?=[\\s/>])`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(lower))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const end = src.indexOf('>', m.index);
      return end < 0 ? src.length : end + 1;
    }
  }
  return src.length;
}

/** The attributes of a kept tag, rebuilt from the allowlist only. */
function keptAttributes(tag, attrs) {
  const seen = new Set();
  let href = '';
  let src = '';
  let alt = null;
  let title = null;
  let width = '';
  let height = '';
  let colspan = '';
  let rowspan = '';
  let loading = '';
  let cls = '';
  let blank = false;
  for (const [rawKey, value] of attrs) {
    const key = rawKey.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key.startsWith('on')) continue;
    switch (key) {
      case 'href': if (tag === 'a') href = safeLink(cleanUrlAttr(value)); break;
      case 'src': if (tag === 'img') src = safeLink(cleanUrlAttr(value)); break;
      case 'alt': if (tag === 'img') alt = decodeEntities(value); break;
      case 'title': title = decodeEntities(value); break;
      case 'width': if (tag === 'img' && /^\d{1,4}$/.test(value.trim())) width = value.trim(); break;
      case 'height': if (tag === 'img' && /^\d{1,4}$/.test(value.trim())) height = value.trim(); break;
      case 'colspan': if ((tag === 'td' || tag === 'th') && /^\d{1,3}$/.test(value.trim()) && Number(value) >= 1) colspan = String(Number(value)); break;
      case 'rowspan': if ((tag === 'td' || tag === 'th') && /^\d{1,3}$/.test(value.trim()) && Number(value) >= 1) rowspan = String(Number(value)); break;
      case 'loading': if (tag === 'img' && /^(?:lazy|eager)$/i.test(value.trim())) loading = value.trim().toLowerCase(); break;
      case 'class': {
        const tokens = decodeEntities(value).split(/\s+/).filter(t => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(t));
        cls = tokens.join(' ');
        break;
      }
      case 'target': if (tag === 'a' && value.trim().toLowerCase() === '_blank') blank = true; break;
      default: break;
    }
  }
  if (tag === 'img' && !src) return null;
  let out = '';
  if (href) out += ` href="${esc(href)}"`;
  if (src) out += ` src="${esc(src)}"`;
  if (alt !== null) out += ` alt="${esc(alt)}"`;
  if (title !== null) out += ` title="${esc(title)}"`;
  if (width) out += ` width="${width}"`;
  if (height) out += ` height="${height}"`;
  if (colspan) out += ` colspan="${colspan}"`;
  if (rowspan) out += ` rowspan="${rowspan}"`;
  if (loading) out += ` loading="${loading}"`;
  if (cls) out += ` class="${esc(cls)}"`;
  // target is only ever written here, and never without rel.
  if (tag === 'a' && href && blank) out += ' target="_blank" rel="noopener noreferrer"';
  return out;
}

/**
 * Cleans a merchant's HTML down to a small safe set and returns a balanced string. It is a
 * tokeniser and a rebuild: input is read tag by tag and only allowlisted tags and attributes
 * are written, so nothing the input does to the parser matters. Kept tags are listed in
 * KEEP_TAGS; script, style, frames, forms, svg and the like are dropped with everything inside;
 * every other tag is dropped and its text kept; comments go. Attributes kept: href, src, alt,
 * title, width, height, colspan, rowspan, loading, class. Every on* attribute, every style and
 * every srcset goes. href and src are decoded, then pass the model's link rule, so javascript:,
 * vbscript: and data: in any case or with entities or whitespace hidden in them are removed.
 * @param {unknown} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  const src = (typeof html === 'string' ? html : '').replace(/\u0000/g, '');
  const n = src.length;
  const stack = [];
  let out = '';
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      out += esc(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) out += esc(decodeEntities(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const next = src[lt + 1];
    if (next === '!' || next === '?') {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:_-]*)/.exec(src.slice(lt, lt + 120));
    if (!m) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const tag = readTag(src, lt + m[0].length);
    if (!tag) {
      // A tag that never closes is dropped with the rest of the input.
      i = n;
      break;
    }
    i = tag.end;
    if (closing) {
      if (KEEP_TAGS.has(name) && !VOID_TAGS.has(name)) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) {
          while (stack.length > at) out += `</${stack.pop()}>`;
        }
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!DROP_VOID.has(name)) i = skipContent(src, i, name);
      continue;
    }
    if (!KEEP_TAGS.has(name)) continue;
    const attrs = keptAttributes(name, tag.attrs);
    if (attrs === null) continue;
    out += `<${name}${attrs}>`;
    if (!VOID_TAGS.has(name)) stack.push(name);
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The text widget's markdown subset
// ---------------------------------------------------------------------------------------------

/** Bold and italic over text that is already escaped; content never spans a tag. */
function formatInline(escaped) {
  return escaped
    .replace(/\*\*(?=[^\s*])([^<>]+?)(?<=[^\s*])\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![*\w])\*(?=[^\s*])([^<>*]+?)(?<=[^\s*])\*(?![*\w])/g, '<em>$1</em>')
    .replace(/(?<!\w)_(?=[^\s_])([^<>_]+?)(?<=[^\s_])_(?!\w)/g, '<em>$1</em>');
}

/** One line of markdown to HTML: escape first, then build the few tags. */
function inlineMarkdown(raw) {
  let out = '';
  let last = 0;
  const re = /\[([^\]\n]{1,300})\]\(([^()\s]{1,2048})\)/g;
  let m;
  while ((m = re.exec(raw))) {
    out += formatInline(esc(raw.slice(last, m.index)));
    const label = formatInline(esc(m[1]));
    const href = safeLink(m[2]);
    out += href ? `<a href="${esc(href)}">${label}</a>` : label;
    last = re.lastIndex;
  }
  out += formatInline(esc(raw.slice(last)));
  return out;
}

/**
 * Paragraphs, bold (**x**), italic (*x* or _x_), links ([label](address)) and lists (- or 1.),
 * and nothing else. Text is escaped first and the tags are built from the escaped text, so a
 * merchant's angle brackets stay text. A link the model's rule refuses prints as its label.
 * @param {unknown} input
 * @returns {string}
 */
export function renderMarkdownSubset(input) {
  const lines = text(input).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push(`<p>${para.map(inlineMarkdown).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map(t => `<li>${inlineMarkdown(t)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const ul = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
    const ol = ul ? null : /^\s{0,3}\d{1,3}[.)]\s+(.*)$/.exec(line);
    const item = ul || ol;
    if (item) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks.join('');
}

// ---------------------------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------------------------

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID_RE = /^\d{1,12}$/;

/**
 * The embed for a YouTube or Vimeo link, or null for anything it cannot read: another host, a
 * link with no video id, an id with characters a video id never has. The frame it returns points
 * at https://www.youtube-nocookie.com/embed/<id> or https://player.vimeo.com/video/<id> only,
 * never at the address the merchant pasted.
 * @param {unknown} url
 * @param {unknown} [title]  the frame's accessible name; omitted from the tag when blank
 * @param {unknown} [startAt]  whole seconds, 0 to 86400
 * @returns {{ provider: 'youtube' | 'vimeo', id: string, src: string, html: string } | null}
 */
export function videoEmbed(url, title = '', startAt = 0) {
  if (typeof url !== 'string' || url === '' || linkProblem(url, { video: true }) !== null) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  /** @type {'youtube' | 'vimeo' | null} */
  let provider = null;
  let id = '';
  if (host === 'youtu.be') {
    provider = 'youtube';
    id = segs[0] || '';
  } else if (host.includes('youtube')) {
    provider = 'youtube';
    if (segs[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['embed', 'shorts', 'live', 'v'].includes(segs[0])) id = segs[1] || '';
  } else if (host === 'player.vimeo.com') {
    provider = 'vimeo';
    if (segs[0] === 'video') id = segs[1] || '';
  } else if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    provider = 'vimeo';
    id = segs.find(s => /^\d+$/.test(s)) || '';
  }
  if (provider === 'youtube' && !YOUTUBE_ID_RE.test(id)) return null;
  if (provider === 'vimeo' && !VIMEO_ID_RE.test(id)) return null;
  if (!provider) return null;
  const start = typeof startAt === 'number' && Number.isInteger(startAt) && startAt > 0 && startAt <= 86400 ? startAt : 0;
  let src;
  if (provider === 'youtube') src = `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
  else src = `https://player.vimeo.com/video/${id}${start ? `#t=${start}s` : ''}`;
  const name = trimmed(title);
  const html = `<iframe src="${esc(src)}"${name ? ` title="${esc(name)}"` : ''} loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  return { provider, id, src, html };
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} RenderReview
 * @property {number} rating
 * @property {string} [reviewTitle]
 * @property {string} [reviewText]
 * @property {string[]} [tags]
 * @property {string[]} [photos]
 * @property {string} [customerName]
 */

/**
 * @typedef {object} RenderContext
 * @property {string} [slug]
 * @property {string} [journeyId]
 * @property {string} [nodeId]
 * @property {string} [storeDomain]
 * @property {string} [currency]
 * @property {'a' | 'b'} [variant]  the A/B version being served
 * @property {(variantId: unknown) => string} [realVariantId]  the server's one test for a real variant; '' means placeholder or none
 * @property {(price: string) => string} [formatPrice]  the price as the visitor's currency shows it
 * @property {{ summary?: { averageRating?: number | null, totalCount?: number }, reviews?: RenderReview[] }} [reviews]
 * @property {'desktop' | 'tablet' | 'mobile'} [device]  the canvas: resolved CSS for one device, no media queries
 */

function normalizeContext(c) {
  const x = isObj(c) ? c : {};
  const rv = isObj(x.reviews) ? x.reviews : {};
  return {
    slug: trimmed(x.slug),
    storeDomain: trimmed(x.storeDomain),
    currency: trimmed(x.currency).toUpperCase().slice(0, 3),
    variant: x.variant === 'b' ? 'b' : 'a',
    realVariantId: typeof x.realVariantId === 'function' ? x.realVariantId : v => (typeof v === 'string' ? v.trim() : ''),
    formatPrice: typeof x.formatPrice === 'function' ? x.formatPrice : v => v,
    reviews: {
      summary: isObj(rv.summary) ? rv.summary : {},
      reviews: Array.isArray(rv.reviews) ? rv.reviews.filter(isObj) : []
    },
    device: x.device
  };
}

function newState(ctx) {
  return { ctx, claimed: new Set(), anchors: new Set() };
}

/** True the first time a name is asked for. The first of a kind owns the frame's element id. */
function claim(st, name) {
  if (st.claimed.has(name)) return false;
  st.claimed.add(name);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------------------------

/** The class attribute of a node: its own class, the base classes, then the merchant's class. */
function cls(node, ...base) {
  const custom = node && isObj(node.style) && isObj(node.style.desktop) ? node.style.desktop.customClass : '';
  const extra = typeof custom === 'string' && custom.length <= 200 && CLASS_LIST_RE.test(custom) ? ` ${custom}` : '';
  return `class="jvb-n-${node.id} ${base.join(' ')}${extra}"`;
}

const ASPECT_CLASS = { '1:1': 'jvb-ar-1-1', '4:3': 'jvb-ar-4-3', '3:4': 'jvb-ar-3-4', '16:9': 'jvb-ar-16-9', '9:16': 'jvb-ar-9-16' };

function savedPrice(v) {
  const raw = trimmed(v);
  if (!raw) return '';
  const amount = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? raw.slice(0, 40) : '';
}


function stars(rating) {
  const n = Math.max(0, Math.min(5, Math.floor(Number(rating) || 0)));
  if (!n) return '';
  return `<span class="jvb-stars" role="img" aria-label="${n}${STRUCTURAL_WORDS.starsAfter}">${'\u2605'.repeat(n)}</span>`;
}

const TRUST_ICONS = {
  shield: '<svg class="jvb-trust-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  lock: '<svg class="jvb-trust-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  star: '<svg class="jvb-trust-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 17l-5.5 2.8 1.1-6.1L3.2 9.4l6.1-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
};

const LIST_ICONS = { check: '✓', star: '★', arrow: '→', dot: '•' };

function wHeading(node, p) {
  const body = trimmed(p.text) ? escLines(p.text) : '';
  if (!body) return '';
  const level = Number.isInteger(p.level) && p.level >= 1 && p.level <= 6 ? p.level : 2;
  const href = safeLink(p.link);
  const inner = href ? `<a href="${esc(href)}">${body}</a>` : body;
  return `<h${level} ${cls(node, 'jvb-w', 'jvb-heading')}>${inner}</h${level}>`;
}

function wText(node, p) {
  const inner = renderMarkdownSubset(p.text);
  return inner ? `<div ${cls(node, 'jvb-w', 'jvb-text')}>${inner}</div>` : '';
}

function wImage(node, p) {
  const src = safeLink(p.src);
  if (!src) return '';
  const fit = pick(p.fit, ['cover', 'contain'], 'cover');
  const aspect = pick(p.aspect, ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'], 'auto');
  const img = `<img src="${esc(src)}" alt="${esc(text(p.alt))}" loading="lazy" class="jvb-fit-${fit}">`;
  const frame = aspect === 'auto' ? img : `<div class="jvb-frame ${ASPECT_CLASS[aspect]}">${img}</div>`;
  const href = safeLink(p.link);
  const linked = href ? `<a href="${esc(href)}">${frame}</a>` : frame;
  const caption = trimmed(p.caption) ? `<figcaption>${escLines(p.caption)}</figcaption>` : '';
  return `<figure ${cls(node, 'jvb-w', 'jvb-image')}>${linked}${caption}</figure>`;
}

function wButton(node, p) {
  const label = trimmed(p.label);
  if (!label) return '';
  const variant = pick(p.variant, ['primary', 'secondary', 'outline'], 'primary');
  const size = pick(p.size, ['sm', 'md', 'lg'], 'md');
  const href = safeLink(p.url);
  const classes = cls(node, 'jvb-w', 'jvb-btn', `jvb-btn-${variant}`, `jvb-btn-${size}`, ...(p.fullWidth === true ? ['jvb-btn-full'] : []));
  if (!href) return `<span ${classes}>${esc(label)}</span>`;
  const blank = p.newTab === true ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a ${classes} href="${esc(href)}"${blank}>${esc(label)}</a>`;
}

function wSpacer(node) {
  return `<div ${cls(node, 'jvb-w', 'jvb-spacer')} aria-hidden="true"></div>`;
}

function wDivider(node) {
  return `<div ${cls(node, 'jvb-w', 'jvb-divider')}><hr></div>`;
}

function wVideo(node, p) {
  const embed = videoEmbed(p.url, p.title, p.startAt);
  if (!embed) return '';
  const aspect = pick(p.aspect, ['16:9', '4:3', '1:1', '9:16'], '16:9');
  return `<div ${cls(node, 'jvb-w', 'jvb-video', ASPECT_CLASS[aspect])}>${embed.html}</div>`;
}

function wHtmlEmbed(node, p) {
  const inner = sanitizeHtml(p.html);
  if (!inner.trim()) return '';
  const name = trimmed(p.title);
  const label = name ? ` role="group" aria-label="${esc(name)}"` : '';
  return `<div ${cls(node, 'jvb-w', 'jvb-embed')}${label}>${inner}</div>`;
}

function wIconList(node, p) {
  const items = (Array.isArray(p.items) ? p.items : []).filter(it => isObj(it) && trimmed(it.text));
  if (!items.length) return '';
  const icon = LIST_ICONS[pick(p.icon, ['check', 'star', 'arrow', 'dot'], 'check')];
  const lis = items.map(it => `<li><span class="jvb-ico" aria-hidden="true">${icon}</span><span>${escLines(it.text)}</span></li>`).join('');
  return `<ul ${cls(node, 'jvb-w', 'jvb-iconlist')}>${lis}</ul>`;
}

function wTestimonials(node, p) {
  const items = (Array.isArray(p.items) ? p.items : []).filter(it => isObj(it) && trimmed(it.quote));
  if (!items.length) return '';
  const layout = pick(p.layout, ['grid', 'stack'], 'grid');
  const cards = items.map(it => {
    const avatar = safeLink(it.avatarUrl);
    const name = trimmed(it.name);
    const role = trimmed(it.role);
    const who = avatar || name || role
      ? `<figcaption class="jvb-tm-who">${avatar ? `<img class="jvb-tm-avatar" src="${esc(avatar)}" alt="" loading="lazy">` : ''}${name || role ? `<span>${name ? `<span class="jvb-tm-name">${esc(name)}</span>` : ''}${role ? `<span class="jvb-tm-role">${esc(role)}</span>` : ''}</span>` : ''}</figcaption>`
      : '';
    return `<figure class="jvb-tm">${stars(it.rating)}<blockquote><p>${escLines(it.quote)}</p></blockquote>${who}</figure>`;
  }).join('');
  return `<div ${cls(node, 'jvb-w', 'jvb-tm-wrap', `jvb-tm-${layout}`)}>${cards}</div>`;
}

function wFaq(node, p) {
  const items = (Array.isArray(p.items) ? p.items : []).filter(it => isObj(it) && trimmed(it.question));
  if (!items.length) return '';
  const rows = items.map((it, i) => {
    const open = p.openFirst === true && i === 0 ? ' open' : '';
    const answer = renderMarkdownSubset(it.answer);
    return `<details class="jvb-faq-item"${open}><summary>${esc(it.question)}</summary>${answer ? `<div class="jvb-faq-a">${answer}</div>` : ''}</details>`;
  }).join('');
  return `<div ${cls(node, 'jvb-w', 'jvb-faq')}>${rows}</div>`;
}

/** A deadline needs a time zone, or the page would count down to a different moment per visitor. */
const OFFSET_DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

function wCountdown(node, p, st) {
  const fb = WIDGET_REGISTRY.countdown.fallbacks;
  const mode = pick(p.mode, ['evergreen', 'deadline'], 'evergreen');
  let attrs;
  let initial = '';
  if (mode === 'deadline') {
    const deadline = trimmed(p.deadline);
    if (!OFFSET_DATE_RE.test(deadline) || !Number.isFinite(Date.parse(deadline))) return '';
    attrs = ` data-jvb-mode="deadline" data-jvb-deadline="${esc(deadline)}"`;
  } else {
    const minutes = Math.floor(Number(p.minutes));
    if (!(minutes >= 1)) return '';
    attrs = ` data-jvb-mode="evergreen" data-jvb-minutes="${minutes}"`;
    initial = `${String(minutes).padStart(2, '0')}:00`;
  }
  const first = claim(st, 'countdown');
  const label = trimmed(p.text) || fb.text;
  const expired = trimmed(p.expiredText) || fb.expiredText;
  return `<div ${cls(node, 'jvb-w', 'jvb-countdown')}${first ? ' id="jv-reservation-bar"' : ''} data-jvb-countdown${attrs} data-jvb-expired="${esc(expired)}">`
    + '<div class="jvb-countdown-inner">'
    + `<span class="jvb-countdown-label"${first ? ' id="jv-urgency-label"' : ''}>${esc(label)}</span>`
    + `<span class="jvb-countdown-clock"${first ? ' id="jv-countdown-display"' : ''} role="timer">${initial}</span>`
    + '</div></div>';
}

/** Hidden fields the lead form carries; the frame fills the empty ones before it posts. */
const LEAD_HIDDEN = ['order_bump_selected', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'ttclid', 'gclid', 'visitorId', 'ref'];

function wLeadForm(node, p, st) {
  const fb = WIDGET_REGISTRY.leadForm.fallbacks;
  const heading = trimmed(p.heading) || fb.heading;
  const button = trimmed(p.buttonText) || fb.buttonText;
  const success = trimmed(p.successText) || fb.successText;
  const after = pick(p.afterSubmit, ['message', 'checkout'], 'message');
  const nameMode = pick(p.nameField, ['hidden', 'optional', 'required'], 'optional');
  const phoneMode = pick(p.phoneField, ['hidden', 'optional', 'required'], 'optional');
  const field = (key, label, type, mode, auto) => `<div class="jvb-field"><label for="jvb-${node.id}-${key}">${esc(label)}</label><input type="${type}" id="jvb-${node.id}-${key}" name="${key}" autocomplete="${auto}"${mode === 'required' ? ' required' : ''}></div>`;
  const fields = [
    nameMode === 'hidden' ? '' : field('name', STRUCTURAL_WORDS.fieldName, 'text', nameMode, 'name'),
    field('email', STRUCTURAL_WORDS.fieldEmail, 'email', 'required', 'email'),
    phoneMode === 'hidden' ? '' : field('phone', STRUCTURAL_WORDS.fieldPhone, 'tel', phoneMode, 'tel')
  ].join('');
  const hidden = [
    `<input type="hidden" name="slug" value="${esc(st.ctx.slug)}">`,
    `<input type="hidden" name="variant" value="${st.ctx.variant}">`,
    `<input type="hidden" name="currency" value="${esc(st.ctx.currency)}">`,
    ...LEAD_HIDDEN.map(k => `<input type="hidden" name="${k}" value="">`)
  ].join('');
  return `<form ${cls(node, 'jvb-w', 'jvb-lead')} data-jvb-lead data-jvb-after="${after}" data-jvb-success="${esc(success)}">`
    + `<h2 class="jvb-lead-title">${esc(heading)}</h2>`
    + fields + hidden
    + `<button type="submit" class="jvb-btn jvb-btn-primary jvb-btn-md jvb-btn-full">${esc(button)}</button>`
    + '<p class="jvb-lead-status" role="status" aria-live="polite" data-jvb-lead-status></p>'
    + '</form>';
}

function wProductHero(node, p, st) {
  const vid = st.ctx.realVariantId(p.variantId);
  const placeholder = trimmed(p.variantId) !== '' && !vid;
  const image = safeLink((!placeholder && trimmed(p.productImage)) || p.imageUrl);
  const baseTitle = placeholder ? '' : trimmed(p.title);
  const basePrice = placeholder ? '' : savedPrice(p.price);
  const showPrice = p.showPrice !== false && basePrice;
  const productId = trimmed(p.productId);
  if (!image && !showPrice && !vid && !productId) return '';
  const first = claim(st, 'product');
  const alt = trimmed(p.imageAlt) || baseTitle;
  const img = image ? `<img${first ? ' id="product-img"' : ''} src="${esc(image)}" alt="${esc(alt)}" loading="eager">` : '';
  const price = showPrice
    ? `<div class="jvb-price"${first ? ' id="product-price"' : ''} data-base-price="${esc(basePrice)}">${esc(st.ctx.formatPrice(basePrice))}</div>`
    : '';
  return `<div ${cls(node, 'jvb-w', 'jvb-product')} data-product-id="${esc(productId)}" data-variant-id="${esc(vid)}" data-collection-id="${esc(trimmed(p.collectionId))}" data-title="${esc(baseTitle)}" data-price="${esc(basePrice)}">`
    + `<div class="jvb-product-media">${img}${price}</div></div>`;
}

function wCheckoutButton(node, p, st) {
  const fb = WIDGET_REGISTRY.checkoutButton.fallbacks;
  const label = trimmed(p.label) || fb.label;
  const code = trimmed(p.discountCode);
  const first = claim(st, 'checkout');
  const mode = pick(p.checkoutMode, ['direct', 'lead-gate'], 'direct');
  const action = pick(p.cartAction, ['checkout', 'add'], 'checkout');
  const note = p.showCodeNote !== false && code
    ? `<p class="jvb-code-note">${STRUCTURAL_WORDS.codeBefore}<strong>${esc(code)}</strong>${STRUCTURAL_WORDS.codeAfter}</p>`
    : '';
  const btn = `<button${first ? ' id="main-cta-btn"' : ''} type="button" class="jvb-btn jvb-btn-primary jvb-btn-lg${p.fullWidth === false ? '' : ' jvb-btn-full'}" data-jvb-cta data-jvb-mode="${mode}" data-jvb-action="${action}" data-jvb-code="${esc(code)}">${esc(label)}</button>`;
  return `<div ${cls(node, 'jvb-w', 'jvb-checkout')}>${note}${btn}</div>`;
}

function wOrderBump(node, p, st) {
  const fb = WIDGET_REGISTRY.orderBump.fallbacks;
  const vid = st.ctx.realVariantId(p.variantId);
  if (!vid) return '';
  const first = claim(st, 'bump');
  const headline = trimmed(p.headline) || fb.headline;
  const title = trimmed(p.title) || fb.title;
  const description = trimmed(p.description);
  const price = trimmed(p.price);
  const image = safeLink(p.image);
  return `<div ${cls(node, 'jvb-w', 'jvb-bump')}${first ? ' id="page-order-bump"' : ''} data-variant-id="${esc(vid)}">`
    + `<label class="jvb-bump-head"><input type="checkbox"${first ? ' id="bump-checkbox-page"' : ''} class="jvb-bump-cb"><span class="jvb-bump-title">${esc(headline)}</span></label>`
    + '<div class="jvb-bump-body">'
    + (image ? `<img class="jvb-bump-thumb" src="${esc(image)}" alt="${esc(title)}" loading="lazy">` : '')
    + `<div class="jvb-bump-desc">${description ? `<p>${escLines(description)}</p>` : ''}`
    + `<div class="jvb-bump-price-row"><span class="jvb-bump-name">${esc(title)}</span>${price ? `<span class="jvb-bump-price" data-base-price="${esc(price)}">${esc(st.ctx.formatPrice(price))}</span>` : ''}</div>`
    + '</div></div></div>';
}

/** A review photo reaches the page only as an https address with nothing a quote or bracket could use. */
function safePhoto(v) {
  const s = trimmed(v);
  return s.length <= 2048 && /^https:\/\/[^\s"'`()<>\\{}]+$/i.test(s) && linkProblem(s) === null ? s : '';
}

function wReviewsWall(node, p, st) {
  const fb = WIDGET_REGISTRY.reviewsWall.fallbacks;
  const min = Number.isFinite(p.minRating) ? p.minRating : 4;
  const reviews = st.ctx.reviews.reviews.filter(r => Number(r.rating) >= min && Number(r.rating) <= 5);
  if (!reviews.length) return '';
  const summary = st.ctx.reviews.summary;
  const rawAvg = Number(summary.averageRating);
  const avg = summary.averageRating != null && Number.isFinite(rawAvg) && rawAvg > 0 ? rawAvg.toFixed(1) : '';
  const rawCount = Number(summary.totalCount);
  const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : reviews.length;
  const title = trimmed(p.headline) || fb.headline;
  const photosOn = p.photos !== false;
  const cards = reviews.map(r => {
    const photos = photosOn && Array.isArray(r.photos) ? r.photos.map(safePhoto).filter(Boolean) : [];
    const tags = Array.isArray(r.tags) ? r.tags.map(trimmed).filter(Boolean) : [];
    const name = trimmed(r.customerName);
    const head = trimmed(r.reviewTitle);
    const body = trimmed(r.reviewText);
    return '<div class="jvb-review">'
      + `<div class="jvb-review-top">${stars(r.rating)}<span class="jvb-verified">${STRUCTURAL_WORDS.verified}</span></div>`
      + (head ? `<div class="jvb-review-head">${esc(head)}</div>` : '')
      + (body ? `<p class="jvb-review-text">${escLines(body)}</p>` : '')
      + (tags.length ? `<div class="jvb-review-tags">${tags.map(t => `<span class="jvb-review-tag">${esc(t)}</span>`).join('')}</div>` : '')
      + (photos.length ? `<div class="jvb-review-photos">${photos.map(ph => `<button type="button" class="jvb-review-photo" data-jv-photo="${esc(ph)}" aria-label="${STRUCTURAL_WORDS.photoButton}"><img src="${esc(ph)}" alt="" loading="lazy"></button>`).join('')}</div>` : '')
      + (name ? `<div class="jvb-review-author"><span class="jvb-review-avatar" aria-hidden="true">${esc([...name][0])}</span><span>${esc(name)}</span></div>` : '')
      + '</div>';
  }).join('');
  const pill = `${avg ? `<span>★ ${avg} / 5.0</span><span aria-hidden="true">·</span>` : ''}<span>${count} ${count === 1 ? STRUCTURAL_WORDS.review : STRUCTURAL_WORDS.reviews}</span>`;
  return `<section ${cls(node, 'jvb-w', 'jvb-reviews')} aria-labelledby="jvb-${node.id}-title">`
    + `<div class="jvb-reviews-head"><div class="jvb-reviews-pill">${pill}</div><h2 class="jvb-reviews-title" id="jvb-${node.id}-title">${esc(title)}</h2></div>`
    + `<div class="jvb-reviews-cards">${cards}</div></section>`;
}

function wStockCount(node, p, st) {
  const fb = WIDGET_REGISTRY.stockCount.fallbacks;
  const count = Number.isFinite(p.count) ? Math.floor(p.count) : 0;
  const custom = trimmed(p.text);
  let line = '';
  if (custom) line = custom;
  else if (count > 0) line = fb.text;
  if (!line) return '';
  line = line.replaceAll('{count}', String(count));
  const first = claim(st, 'stock');
  return `<div ${cls(node, 'jvb-w', 'jvb-stock-wrap')}><div class="jvb-stock"${first ? ' id="jv-scarcity-badge"' : ''}><span class="jvb-pulse" aria-hidden="true"></span><span>${esc(line)}</span></div></div>`;
}

function wTrustBadge(node, p) {
  // Today's page drops a seeded sample trust line ("4.9/5", "verified customers"); so does this.
  const saved = trimmed(p.text);
  const line = SEEDED_TRUST.test(saved) ? '' : saved;
  if (!line) return '';
  const icon = TRUST_ICONS[pick(p.icon, ['none', 'shield', 'lock', 'star'], 'none')] || '';
  return `<div ${cls(node, 'jvb-w', 'jvb-trust')}>${icon}<span>${escLines(line)}</span></div>`;
}

const WIDGET_RENDERERS = {
  heading: wHeading,
  text: wText,
  image: wImage,
  button: wButton,
  spacer: wSpacer,
  divider: wDivider,
  video: wVideo,
  htmlEmbed: wHtmlEmbed,
  iconList: wIconList,
  testimonials: wTestimonials,
  faq: wFaq,
  countdown: wCountdown,
  leadForm: wLeadForm,
  productHero: wProductHero,
  checkoutButton: wCheckoutButton,
  orderBump: wOrderBump,
  reviewsWall: wReviewsWall,
  stockCount: wStockCount,
  trustBadge: wTrustBadge
};

/**
 * The markup of one widget node, or '' where the contract says it renders nothing (an empty
 * heading, text, image or list; an unreadable video; a bump with no real variant; a reviews wall
 * with no reviews). Never throws. The optional third argument is the render in progress, so the
 * first checkout button, bump, product, countdown and stock line of a page own the frame's ids.
 * @param {import('../../types/pageBuilder').BuilderWidget} node
 * @param {RenderContext} [context]
 * @param {object} [state]  internal: the render in progress
 * @returns {string}
 */
export function renderWidget(node, context = {}, state) {
  try {
    if (!isObj(node) || node.kind !== 'widget' || typeof node.id !== 'string' || !ID_RE.test(node.id)) return '';
    if (typeof node.type !== 'string' || !Object.hasOwn(WIDGET_RENDERERS, node.type)) return '';
    const st = state || newState(normalizeContext(context));
    const props = propsWithDefaults(node);
    return WIDGET_RENDERERS[node.type](node, props, st);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Sections and columns
// ---------------------------------------------------------------------------------------------

function renderChildren(children, st) {
  return children.map(child => {
    if (!isObj(child)) return '';
    if (child.kind === 'widget') return renderWidget(child, undefined, st);
    if (child.kind === 'section') return renderSection(child, st);
    if (child.kind === 'column') return renderColumn(child, st);
    return '';
  }).join('');
}

function renderColumn(node, st) {
  return `<div ${cls(node, 'jvb-col')}>${renderChildren(Array.isArray(node.children) ? node.children : [], st)}</div>`;
}

function renderSection(node, st) {
  const p = propsWithDefaults(node);
  let id = '';
  if (typeof p.anchor === 'string' && ANCHOR_RE.test(p.anchor) && !FRAME_ID_RE.test(p.anchor) && !st.anchors.has(p.anchor)) {
    st.anchors.add(p.anchor);
    id = ` id="${esc(p.anchor)}"`;
  }
  const full = p.contentWidth === 'full' ? ' jvb-full' : '';
  return `<section ${cls(node, `jvb-sec${full}`)}${id}><div class="jvb-row">${renderChildren(Array.isArray(node.children) ? node.children : [], st)}</div></section>`;
}

// ---------------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------------

const ROOT = '#jvb-root';

/** Splits a selector list at top-level commas (not inside parentheses). */
function splitSelectors(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** One rule, every selector prefixed with #jvb-root. An empty selector is the root itself. */
function rule(sel, decls) {
  const list = Array.isArray(decls) ? decls.join(';') : decls;
  if (!list) return '';
  const selector = sel === '' ? ROOT : splitSelectors(sel).map(s => `${ROOT} ${s}`).join(',');
  return `${selector}{${list}}`;
}

function cssColor(v) {
  if (typeof v !== 'string') return null;
  if (HEX_RE.test(v)) return v;
  const t = THEME_TOKEN_RE.exec(v);
  return t && /** @type {readonly string[]} */ (THEME_COLOR_KEYS).includes(t[1]) ? `var(--jvb-${t[1]})` : null;
}

function cssFont(v) {
  if (v === 'theme.heading') return 'var(--jvb-font-heading)';
  if (v === 'theme.body') return 'var(--jvb-font-body)';
  return typeof v === 'string' && v.length <= 60 && FONT_RE.test(v) ? `"${v}",sans-serif` : null;
}

/** A background image address made safe inside url("..."): checked, then the few risky characters encoded. */
function cssUrl(v) {
  if (typeof v !== 'string' || v === '' || v.startsWith('#') || linkProblem(v) !== null) return null;
  return v.replace(/["'()<>{}\\`]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,.18)',
  md: '0 4px 12px rgba(0,0,0,.22)',
  lg: '0 10px 30px rgba(0,0,0,.28)',
  xl: '0 20px 50px rgba(0,0,0,.35)'
};
const FLEX_POS = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const V_POS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
/** Widgets whose root is a flex box in the base look; every other widget root is a block. */
const FLEX_WIDGETS = new Set(['iconList', 'checkoutButton', 'leadForm', 'stockCount', 'trustBadge']);

/** The display a node has when nothing hides it; what `hidden: false` writes back. */
function naturalDisplay(node) {
  if (node.kind === 'section' || node.kind === 'column') return 'flex';
  if (node.type === 'testimonials') return /** @type {any} */ (propsWithDefaults(node)).layout === 'stack' ? 'flex' : 'grid';
  return FLEX_WIDGETS.has(node.type) ? 'flex' : 'block';
}

/** Style keys that map to one length property each. */
const LENGTH_PROPS = {
  paddingTop: 'padding-top', paddingRight: 'padding-right', paddingBottom: 'padding-bottom', paddingLeft: 'padding-left',
  marginTop: 'margin-top', marginRight: 'margin-right', marginBottom: 'margin-bottom', marginLeft: 'margin-left',
  borderWidth: 'border-width', borderRadius: 'border-radius', fontSize: 'font-size', letterSpacing: 'letter-spacing',
  width: 'width', maxWidth: 'max-width', minHeight: 'min-height'
};

function inRange(key, v) {
  const spec = STYLE_KEYS[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max;
}

/** The declarations one style key writes, or [] when its value is not one the model allows. */
function declsForKey(node, kind, key, v) {
  if (!Object.hasOwn(STYLE_KEYS, key)) return [];
  if (Object.hasOwn(LENGTH_PROPS, key)) {
    if (!inRange(key, v)) return [];
    const unit = STYLE_KEYS[key].unit === '%' ? '%' : 'px';
    const out = [`${LENGTH_PROPS[key]}:${fmt(v)}${unit}`];
    // A column with a width stops growing to fill the row; the width is its share of it.
    if (key === 'width' && kind === 'column') out.push('flex:0 1 auto');
    return out;
  }
  switch (key) {
    case 'backgroundColor': { const c = cssColor(v); return c ? [`background-color:${c}`] : []; }
    case 'backgroundImage': {
      if (v === '') return ['background-image:none'];
      const u = cssUrl(v);
      return u ? [`background-image:url("${u}")`] : [];
    }
    case 'backgroundFocalX': return inRange(key, v) ? [`--jvb-fx:${fmt(v)}%`] : [];
    case 'backgroundFocalY': return inRange(key, v) ? [`--jvb-fy:${fmt(v)}%`] : [];
    case 'backgroundOverlayColor': { const c = cssColor(v); return c ? [`--jvb-ovc:${c}`] : []; }
    case 'backgroundOverlayOpacity': return inRange(key, v) ? [`--jvb-ovo:${fmt(v / 100)}`] : [];
    case 'borderStyle': return /** @type {any} */ (STYLE_KEYS.borderStyle).values.includes(v) ? [`border-style:${v}`] : [];
    case 'borderColor': { const c = cssColor(v); return c ? [`border-color:${c}`] : []; }
    case 'shadow': return Object.hasOwn(SHADOWS, v) ? [`box-shadow:${SHADOWS[v]}`] : [];
    case 'fontFamily': { const f = cssFont(v); return f ? [`font-family:${f}`] : []; }
    case 'fontWeight': return /** @type {any} */ (STYLE_KEYS.fontWeight).values.includes(v) ? [`font-weight:${v}`] : [];
    case 'lineHeight': return inRange(key, v) ? [`line-height:${fmt(v)}`] : [];
    case 'textAlign': return /** @type {any} */ (STYLE_KEYS.textAlign).values.includes(v) ? [`text-align:${v}`] : [];
    case 'textColor': { const c = cssColor(v); return c ? [`color:${c}`] : []; }
    case 'align': return Object.hasOwn(FLEX_POS, v) ? [`align-self:${FLEX_POS[v]}`] : [];
    case 'verticalAlign': return kind !== 'widget' && Object.hasOwn(V_POS, v) ? [`justify-content:${V_POS[v]}`] : [];
    case 'hidden': return typeof v === 'boolean' ? [`display:${v ? 'none' : naturalDisplay(node)}`] : [];
    default: return [];
  }
}

const STYLE_ORDER = Object.keys(STYLE_KEYS);

/** The declarations of one style layer, in the registry's key order. Only keys the layer sets. */
function layerDecls(node, kind, layer) {
  if (!isObj(layer)) return [];
  const out = [];
  for (const key of STYLE_ORDER) {
    if (!Object.hasOwn(layer, key)) continue;
    const v = layer[key];
    if (v === undefined || v === null) continue;
    out.push(...declsForKey(node, kind, key, v));
  }
  return out;
}

function layersOf(node) {
  const s = isObj(node.style) ? node.style : {};
  return DEVICES.map(d => s[d]).filter(isObj);
}

function anyLayerSets(node, keys) {
  return layersOf(node).some(layer => keys.some(k => layer[k] !== undefined && layer[k] !== null));
}

/** Rules that depend on a node's props or on which style keys it uses at all, not on one device. */
function preludeRules(node, kind) {
  const sel = `.jvb-n-${node.id}`;
  const out = [];
  if (anyLayerSets(node, ['backgroundImage', 'backgroundFocalX', 'backgroundFocalY'])) {
    out.push(rule(sel, 'background-size:cover;background-repeat:no-repeat;background-position:var(--jvb-fx,50%) var(--jvb-fy,50%)'));
  }
  if (anyLayerSets(node, ['backgroundOverlayColor', 'backgroundOverlayOpacity'])) {
    out.push(rule(sel, 'position:relative'));
    out.push(rule(`${sel}::before`, 'content:"";position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none;background-color:var(--jvb-ovc,transparent);opacity:var(--jvb-ovo,.5)'));
    out.push(rule(`${sel} > *`, 'position:relative'));
  }
  if (kind === 'section') {
    const p = propsWithDefaults(node);
    const gap = Number.isFinite(p.columnGap) && p.columnGap >= 0 && p.columnGap <= 120 ? p.columnGap : 24;
    out.push(rule(`${sel} > .jvb-row`, `gap:${fmt(gap)}px`));
  }
  if (kind === 'widget' && node.type === 'divider') {
    const p = /** @type {any} */ (propsWithDefaults(node));
    const color = cssColor(p.color) || 'var(--jvb-muted)';
    const thickness = Number.isInteger(p.thickness) && p.thickness >= 1 && p.thickness <= 20 ? p.thickness : 1;
    const length = Number.isFinite(p.length) && p.length >= 5 && p.length <= 100 ? p.length : 100;
    const line = pick(p.lineStyle, ['solid', 'dashed', 'dotted'], 'solid');
    out.push(rule(`${sel} > hr`, `width:${fmt(length)}%;border-top:${thickness}px ${line} ${color}`));
  }
  return out;
}

/** The rules that stack a section's columns on the devices it names. */
function stackRules(node, device) {
  const p = propsWithDefaults(node);
  const stacked = p.stackOn === 'tablet' ? device !== 'desktop' : p.stackOn === 'mobile' ? device === 'mobile' : false;
  if (!stacked) return [];
  const sel = `.jvb-n-${node.id} > .jvb-row`;
  return [rule(sel, 'flex-direction:column'), rule(`${sel} > .jvb-col`, 'flex:0 0 auto;width:100%')];
}

/** Whether media-query mode writes the stack rules into this device's block (tablet: only a tablet stack; mobile: only a mobile one). */
function stackRulesForBlock(node, block) {
  const p = propsWithDefaults(node);
  if (block === 'tablet' && p.stackOn !== 'tablet') return [];
  if (block === 'mobile' && p.stackOn !== 'mobile') return [];
  return stackRules(node, block);
}

/** A text colour that reads on this background: white or near-black, by contrast ratio. */
function readableOn(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 || h.length === 4 ? h.split('').map(c => c + c).join('') : h;
  const lin = c => {
    const s = parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(full.slice(0, 2)) + 0.7152 * lin(full.slice(2, 4)) + 0.0722 * lin(full.slice(4, 6));
  const withWhite = 1.05 / (lum + 0.05);
  const withBlack = (lum + 0.05) / 0.05;
  return withWhite >= withBlack ? '#ffffff' : '#0b0b10';
}

function resolvedTheme(theme) {
  const t = isObj(theme) ? theme : {};
  return {
    colors: { ...DEFAULT_THEME.colors, ...(isObj(t.colors) ? t.colors : {}) },
    fonts: { ...DEFAULT_THEME.fonts, ...(isObj(t.fonts) ? t.fonts : {}) },
    radius: Number.isFinite(t.radius) ? t.radius : DEFAULT_THEME.radius,
    spacingScale: Number.isFinite(t.spacingScale) ? t.spacingScale : DEFAULT_THEME.spacingScale,
    buttonStyle: pick(t.buttonStyle, ['solid', 'outline', 'pill'], DEFAULT_THEME.buttonStyle),
    containerWidth: Number.isFinite(t.containerWidth) ? t.containerWidth : DEFAULT_THEME.containerWidth,
    headingScale: finiteOr(t.headingScale, DEFAULT_THEME.headingScale),
    headingWeight: finiteOr(t.headingWeight, DEFAULT_THEME.headingWeight),
    headingLineHeight: finiteOr(t.headingLineHeight, DEFAULT_THEME.headingLineHeight),
    bodySize: finiteOr(t.bodySize, DEFAULT_THEME.bodySize),
    bodyWeight: finiteOr(t.bodyWeight, DEFAULT_THEME.bodyWeight),
    bodyLineHeight: finiteOr(t.bodyLineHeight, DEFAULT_THEME.bodyLineHeight),
    linkColor: cssColor(t.linkColor) ? t.linkColor : DEFAULT_THEME.linkColor,
    buttonRadius: Number.isFinite(t.buttonRadius) ? t.buttonRadius : DEFAULT_THEME.buttonRadius,
    buttonShadow: pick(t.buttonShadow, Object.keys(BUTTON_SHADOWS), DEFAULT_THEME.buttonShadow),
    sectionPaddingY: finiteOr(t.sectionPaddingY, DEFAULT_THEME.sectionPaddingY),
    sectionGap: finiteOr(t.sectionGap, DEFAULT_THEME.sectionGap)
  };
}

function finiteOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

/** True when the theme sets `key` to something other than the built-in default. */
function changed(theme, key) {
  return theme[key] !== DEFAULT_THEME[key];
}

const BUTTON_SHADOWS = {
  none: 'none',
  soft: '0 2px 8px rgba(0,0,0,.2)',
  medium: '0 6px 18px rgba(0,0,0,.3)',
  strong: '0 10px 30px rgba(0,0,0,.45)'
};

function rootRule(theme) {
  const c = theme.colors;
  const solid = theme.buttonStyle !== 'outline';
  const vars = [
    ...THEME_COLOR_KEYS.map(k => `--jvb-${k}:${c[k]}`),
    `--jvb-font-heading:"${theme.fonts.heading}",sans-serif`,
    `--jvb-font-body:"${theme.fonts.body}",sans-serif`,
    `--jvb-radius:${fmt(theme.radius)}px`,
    `--jvb-space:${fmt(theme.spacingScale)}px`,
    `--jvb-container:${fmt(theme.containerWidth)}px`,
    `--jvb-btn-radius:${theme.buttonRadius !== null ? `${fmt(theme.buttonRadius)}px` : theme.buttonStyle === 'pill' ? '9999px' : 'var(--jvb-radius)'}`,
    `--jvb-btn-bg:${solid ? c.primary : 'transparent'}`,
    `--jvb-btn-fg:${solid ? readableOn(c.primary) : c.primary}`,
    `--jvb-btn-bd:${c.primary}`,
    `--jvb-btn-sec-fg:${readableOn(c.secondary)}`
  ];
  // A typography, link, shadow or spacing setting adds its custom property only when it differs
  // from the built-in default, so a page that sets none of them keeps its exact earlier bytes.
  if (changed(theme, 'headingScale')) vars.push(`--jvb-h-scale:${fmt(theme.headingScale)}`);
  if (changed(theme, 'headingWeight')) vars.push(`--jvb-h-weight:${fmt(theme.headingWeight)}`);
  if (changed(theme, 'headingLineHeight')) vars.push(`--jvb-h-lh:${fmt(theme.headingLineHeight)}`);
  if (changed(theme, 'bodySize')) vars.push(`--jvb-body-size:${fmt(theme.bodySize)}px`);
  if (changed(theme, 'bodyWeight')) vars.push(`--jvb-body-weight:${fmt(theme.bodyWeight)}`);
  if (changed(theme, 'bodyLineHeight')) vars.push(`--jvb-body-lh:${fmt(theme.bodyLineHeight)}`);
  if (changed(theme, 'linkColor')) vars.push(`--jvb-link:${cssColor(theme.linkColor)}`);
  if (changed(theme, 'buttonShadow')) vars.push(`--jvb-btn-shadow:${BUTTON_SHADOWS[theme.buttonShadow]}`);
  if (changed(theme, 'sectionPaddingY')) vars.push(`--jvb-sec-py:${fmt(theme.sectionPaddingY)}px`);
  const base = [
    'display:flex', 'flex-direction:column', 'width:100%',
    'background-color:var(--jvb-background)', 'color:var(--jvb-text)', 'font-family:var(--jvb-font-body)',
    changed(theme, 'bodySize') ? 'font-size:var(--jvb-body-size)' : 'font-size:16px',
    changed(theme, 'bodyLineHeight') ? 'line-height:var(--jvb-body-lh)' : 'line-height:1.5'
  ];
  if (changed(theme, 'bodyWeight')) base.push('font-weight:var(--jvb-body-weight)');
  if (changed(theme, 'sectionGap')) base.push(`gap:${fmt(theme.sectionGap)}px`);
  return rule('', [...vars, ...base]);
}

const MIX = 'color-mix(in srgb,var(--jvb-muted) 35%,transparent)';

/** The base look of every widget, all under #jvb-root, no media queries. A node's style rules come after and win. */
function staticRules(theme) {
  const hScale = changed(theme, 'headingScale');
  const headSize = rem => (hScale ? `font-size:calc(${rem}rem * var(--jvb-h-scale))` : `font-size:${rem}rem`);
  return [
    rule('*, *::before, *::after', 'box-sizing:border-box'),
    rule(':where(h1,h2,h3,h4,h5,h6,p,figure,blockquote,ul,ol,hr)', 'margin:0'),
    rule('img', 'max-width:100%;height:auto;display:block'),
    rule('.jvb-sec', changed(theme, 'sectionPaddingY')
      ? 'display:flex;flex-direction:column;width:100%;padding-top:var(--jvb-sec-py);padding-bottom:var(--jvb-sec-py)'
      : 'display:flex;flex-direction:column;width:100%'),
    rule('.jvb-row', 'display:flex;flex-direction:row;align-items:stretch;width:100%;max-width:var(--jvb-container);margin-left:auto;margin-right:auto;padding-left:calc(var(--jvb-space) * 2);padding-right:calc(var(--jvb-space) * 2)'),
    rule('.jvb-full > .jvb-row', 'max-width:none'),
    rule('.jvb-col .jvb-row', 'padding-left:0;padding-right:0;max-width:none'),
    rule('.jvb-col', 'display:flex;flex-direction:column;flex:1 1 0;min-width:0;gap:calc(var(--jvb-space) * 2)'),
    rule('.jvb-w', 'min-width:0'),
    rule('.jvb-heading', `font-family:var(--jvb-font-heading);font-weight:${changed(theme, 'headingWeight') ? 'var(--jvb-h-weight)' : '700'};line-height:${changed(theme, 'headingLineHeight') ? 'var(--jvb-h-lh)' : '1.2'};overflow-wrap:anywhere`),
    rule(':where(.jvb-heading:where(h1))', headSize('2.5')),
    rule(':where(.jvb-heading:where(h2))', headSize('2')),
    rule(':where(.jvb-heading:where(h3))', headSize('1.5')),
    rule(':where(.jvb-heading:where(h4))', headSize('1.25')),
    rule(':where(.jvb-heading:where(h5))', headSize('1.125')),
    rule(':where(.jvb-heading:where(h6))', headSize('1')),
    rule('.jvb-heading a', 'color:inherit'),
    rule('.jvb-text > * + *', 'margin-top:.75em'),
    rule('.jvb-text ul, .jvb-text ol', 'padding-left:1.25em'),
    rule('.jvb-text a, .jvb-embed a', `color:var(--jvb-${changed(theme, 'linkColor') ? 'link' : 'primary'});text-decoration:underline`),
    rule('.jvb-image img', 'width:100%'),
    rule('.jvb-image figcaption', 'font-size:.875rem;color:var(--jvb-muted);margin-top:.5em'),
    rule('.jvb-frame', 'position:relative;overflow:hidden;width:100%'),
    rule('.jvb-frame > img', 'width:100%;height:100%'),
    rule('.jvb-fit-cover', 'object-fit:cover'),
    rule('.jvb-fit-contain', 'object-fit:contain'),
    rule('.jvb-ar-1-1', 'aspect-ratio:1 / 1'),
    rule('.jvb-ar-4-3', 'aspect-ratio:4 / 3'),
    rule('.jvb-ar-3-4', 'aspect-ratio:3 / 4'),
    rule('.jvb-ar-16-9', 'aspect-ratio:16 / 9'),
    rule('.jvb-ar-9-16', 'aspect-ratio:9 / 16'),
    rule('.jvb-btn', 'display:block;align-self:flex-start;padding:.7em 1.4em;border:2px solid transparent;border-radius:var(--jvb-btn-radius);font:inherit;font-weight:600;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer' + (changed(theme, 'buttonShadow') ? ';box-shadow:var(--jvb-btn-shadow)' : '')),
    rule('.jvb-btn-sm', 'font-size:.875rem;padding:.5em 1em'),
    rule('.jvb-btn-md', 'font-size:1rem'),
    rule('.jvb-btn-lg', 'font-size:1.125rem;padding:.85em 1.8em'),
    rule('.jvb-btn-full', 'align-self:stretch;width:100%'),
    rule('.jvb-btn-primary', 'background-color:var(--jvb-btn-bg);color:var(--jvb-btn-fg);border-color:var(--jvb-btn-bd)'),
    rule('.jvb-btn-secondary', 'background-color:var(--jvb-secondary);color:var(--jvb-btn-sec-fg);border-color:var(--jvb-secondary)'),
    rule('.jvb-btn-outline', 'background-color:transparent;color:var(--jvb-primary);border-color:var(--jvb-primary)'),
    rule('.jvb-btn:focus-visible, summary:focus-visible, .jvb-field input:focus-visible, .jvb-review-photo:focus-visible', 'outline:3px solid var(--jvb-primary);outline-offset:2px'),
    rule('.jvb-divider > hr', 'border:0;margin-left:auto;margin-right:auto;height:0'),
    rule('.jvb-video', 'position:relative;width:100%'),
    rule('.jvb-video iframe', 'position:absolute;top:0;left:0;width:100%;height:100%;border:0'),
    rule('.jvb-embed table', 'border-collapse:collapse;width:100%'),
    rule('.jvb-embed th, .jvb-embed td', `border:1px solid ${MIX};padding:.4em .6em;text-align:left`),
    rule('.jvb-embed > * + *', 'margin-top:.75em'),
    rule('.jvb-iconlist', 'list-style:none;padding:0;display:flex;flex-direction:column;gap:calc(var(--jvb-space) * 1.5)'),
    rule('.jvb-iconlist li', 'display:flex;align-items:flex-start;gap:.6em'),
    rule('.jvb-ico', 'color:var(--jvb-secondary);font-weight:700;flex:0 0 auto'),
    rule('.jvb-tm-grid', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:calc(var(--jvb-space) * 2)'),
    rule('.jvb-tm-stack', 'display:flex;flex-direction:column;gap:calc(var(--jvb-space) * 2)'),
    rule('.jvb-tm', `display:flex;flex-direction:column;gap:.75em;padding:calc(var(--jvb-space) * 2.5);background-color:var(--jvb-surface);border:1px solid ${MIX};border-radius:var(--jvb-radius)`),
    rule('.jvb-stars', 'display:inline-flex;gap:2px;color:#fbbf24'),
    rule('.jvb-tm-who', 'display:flex;align-items:center;gap:.6em;font-size:.875rem'),
    rule('.jvb-tm-who > span', 'display:flex;flex-direction:column'),
    rule('.jvb-tm-avatar', 'width:36px;height:36px;border-radius:50%;object-fit:cover'),
    rule('.jvb-tm-name', 'font-weight:700'),
    rule('.jvb-tm-role', 'color:var(--jvb-muted);font-size:.8125rem'),
    rule('.jvb-faq-item', `border-bottom:1px solid ${MIX}`),
    rule('.jvb-faq-item summary', 'cursor:pointer;font-weight:600;padding:.8em 0'),
    rule('.jvb-faq-a', 'padding-bottom:.8em;color:var(--jvb-muted)'),
    rule('.jvb-faq-a > * + *', 'margin-top:.5em'),
    rule('.jvb-countdown-inner', 'display:flex;align-items:center;justify-content:center;gap:.6em;flex-wrap:wrap;padding:.6em 1em;background-color:var(--jvb-surface);border-radius:var(--jvb-radius);font-weight:600'),
    rule('.jvb-countdown-clock', 'font-variant-numeric:tabular-nums;font-weight:800;color:var(--jvb-primary)'),
    rule('.jvb-lead', 'display:flex;flex-direction:column;gap:calc(var(--jvb-space) * 1.5)'),
    rule('.jvb-lead-title', 'font-family:var(--jvb-font-heading);font-size:1.25rem;line-height:1.3'),
    rule('.jvb-field label', 'display:block;font-size:.875rem;margin-bottom:.25em'),
    rule('.jvb-field input', `width:100%;padding:.7em .9em;font:inherit;color:inherit;background-color:var(--jvb-surface);border:1px solid ${MIX};border-radius:var(--jvb-radius)`),
    rule('.jvb-lead-status', 'font-size:.875rem;color:var(--jvb-muted)'),
    rule('.jvb-product-media', 'position:relative'),
    rule('.jvb-product-media img', 'width:100%;border-radius:var(--jvb-radius)'),
    rule('.jvb-price', 'position:absolute;top:12px;right:12px;padding:.3em .8em;font-weight:800;color:var(--jvb-btn-fg);background-color:var(--jvb-primary);border-radius:9999px'),
    rule('.jvb-checkout', 'display:flex;flex-direction:column;gap:calc(var(--jvb-space) * 1.25)'),
    rule('.jvb-code-note', 'font-size:.875rem;color:var(--jvb-muted)'),
    rule('.jvb-bump', 'padding:calc(var(--jvb-space) * 2);background-color:var(--jvb-surface);border:2px dashed var(--jvb-primary);border-radius:var(--jvb-radius)'),
    rule('.jvb-bump-head', 'display:flex;align-items:center;gap:.7em;cursor:pointer;font-weight:700'),
    rule('.jvb-bump-cb', 'width:20px;height:20px;flex:0 0 auto;accent-color:var(--jvb-primary)'),
    rule('.jvb-bump-body', 'display:flex;gap:calc(var(--jvb-space) * 1.5);margin-top:.75em'),
    rule('.jvb-bump-thumb', 'width:64px;height:64px;object-fit:cover;border-radius:calc(var(--jvb-radius) / 2);flex:0 0 auto'),
    rule('.jvb-bump-desc', 'display:flex;flex-direction:column;gap:.4em;font-size:.875rem'),
    rule('.jvb-bump-price-row', 'display:flex;justify-content:space-between;gap:1em;font-weight:700'),
    rule('.jvb-stock-wrap', 'display:flex'),
    rule('.jvb-stock', 'display:inline-flex;align-items:center;gap:.5em;padding:.35em .8em;border-radius:9999px;font-size:.8125rem;font-weight:700;color:var(--jvb-secondary);background-color:color-mix(in srgb,var(--jvb-secondary) 14%,transparent)'),
    rule('.jvb-pulse', 'width:.5em;height:.5em;border-radius:50%;background-color:currentColor'),
    rule('.jvb-trust', `display:flex;align-items:center;gap:.5em;padding:.6em .9em;font-size:.875rem;color:var(--jvb-muted);background-color:var(--jvb-surface);border:1px solid ${MIX};border-radius:var(--jvb-radius)`),
    rule('.jvb-trust-icon', 'width:1.2em;height:1.2em;flex:0 0 auto'),
    rule('.jvb-reviews-head', 'display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:calc(var(--jvb-space) * 2.5);text-align:center'),
    rule('.jvb-reviews-pill', 'display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:9999px;font-size:.8125rem;font-weight:700;color:#fbbf24;background-color:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)'),
    rule('.jvb-reviews-title', 'font-family:var(--jvb-font-heading);font-size:1.5rem;line-height:1.3'),
    rule('.jvb-reviews-cards', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:calc(var(--jvb-space) * 2)'),
    rule('.jvb-review', `display:flex;flex-direction:column;gap:.6em;padding:calc(var(--jvb-space) * 2);text-align:left;background-color:var(--jvb-surface);border:1px solid ${MIX};border-radius:var(--jvb-radius)`),
    rule('.jvb-review-top', 'display:flex;align-items:center;justify-content:space-between;gap:.5em'),
    rule('.jvb-verified', 'font-size:.75rem;font-weight:700;color:var(--jvb-secondary)'),
    rule('.jvb-review-head', 'font-weight:700'),
    rule('.jvb-review-text', 'font-size:.875rem;color:var(--jvb-muted)'),
    rule('.jvb-review-tags', 'display:flex;flex-wrap:wrap;gap:4px'),
    rule('.jvb-review-tag', 'font-size:.75rem;font-weight:600;padding:2px 6px;border-radius:4px;color:var(--jvb-primary);background-color:color-mix(in srgb,var(--jvb-primary) 12%,transparent)'),
    rule('.jvb-review-photos', 'display:flex;gap:8px'),
    rule('.jvb-review-photo', `width:52px;height:52px;padding:0;overflow:hidden;cursor:pointer;background-color:var(--jvb-background);border:1px solid ${MIX};border-radius:10px`),
    rule('.jvb-review-photo img', 'width:100%;height:100%;object-fit:cover'),
    rule('.jvb-review-author', 'display:flex;align-items:center;gap:6px;font-size:.75rem;font-weight:700;color:var(--jvb-muted)'),
    rule('.jvb-review-avatar', 'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:.75rem;font-weight:800;color:var(--jvb-btn-fg);background-color:var(--jvb-primary)')
  ].filter(Boolean);
}

function nodeKind(node) {
  return node.kind === 'section' || node.kind === 'column' ? node.kind : 'widget';
}

/** Every Google Fonts family the page uses, once each: the theme's heading and body, then any a style names. */
function collectFonts(doc, theme) {
  const out = [];
  const add = f => {
    if (typeof f === 'string' && f.length <= 60 && FONT_RE.test(f) && !out.includes(f)) out.push(f);
  };
  add(theme.fonts.heading);
  add(theme.fonts.body);
  walk(doc, node => {
    for (const layer of layersOf(node)) {
      if (layer.fontFamily !== 'theme.heading' && layer.fontFamily !== 'theme.body') add(layer.fontFamily);
    }
  });
  return out;
}

function buildCss(doc, ctx) {
  const theme = resolvedTheme(doc.theme);
  const nodes = [];
  walk(doc, node => {
    nodes.push(node);
  });
  const parts = [rootRule(theme), ...staticRules(theme)];
  for (const node of nodes) parts.push(...preludeRules(node, nodeKind(node)));
  const sel = node => `.jvb-n-${node.id}`;

  if (ctx.device) {
    for (const node of nodes) {
      const kind = nodeKind(node);
      parts.push(rule(sel(node), layerDecls(node, kind, resolveStyle(node, ctx.device))));
      if (kind === 'section') parts.push(...stackRules(node, ctx.device));
    }
    return parts.filter(Boolean).join('\n');
  }

  for (const node of nodes) parts.push(rule(sel(node), layerDecls(node, nodeKind(node), isObj(node.style) ? node.style.desktop : null)));
  for (const [block, max] of [['tablet', BREAKPOINTS.tablet], ['mobile', BREAKPOINTS.mobile]]) {
    const inner = [];
    for (const node of nodes) {
      const kind = nodeKind(node);
      inner.push(rule(sel(node), layerDecls(node, kind, isObj(node.style) ? node.style[block] : null)));
      if (kind === 'section') inner.push(...stackRulesForBlock(node, block));
    }
    const body = inner.filter(Boolean);
    if (body.length) parts.push(`@media (max-width: ${max}px){\n${body.join('\n')}\n}`);
  }
  return parts.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------------------------

/**
 * Renders a builder document. Validates first: a document with problems renders nothing and the
 * problems come back. Otherwise `html` is one `<div id="jvb-root" class="jvb">` holding a
 * section per section, a div per column and the widget markup per widget, each node carrying the
 * class `jvb-n-<id>`; `css` is scoped to #jvb-root, with the theme as custom properties and the
 * desktop layer first, then the tablet layer inside `@media (max-width: 1024px)`, then the
 * mobile layer inside `@media (max-width: 640px)`, each holding only the keys that layer sets.
 * With `context.device` the CSS is that one device resolved through resolveStyle and holds no
 * media query. `fonts` lists the Google Fonts families the page uses, once each.
 * @param {unknown} doc
 * @param {RenderContext} [context]
 * @returns {{ html: string, css: string, problems: Array<{ path: string, message: string }>, fonts: string[] }}
 */
export function render(doc, context = {}) {
  const check = validateBuilderDoc(doc);
  if (!check.ok) return { html: '', css: '', problems: check.problems, fonts: [] };
  const ctx = normalizeContext(context);
  if (ctx.device !== undefined && !DEVICES.includes(ctx.device)) {
    return {
      html: '',
      css: '',
      problems: [{ path: 'context.device', message: `${JSON.stringify(String(ctx.device))} is not a device: use desktop, tablet or mobile` }],
      fonts: []
    };
  }
  const st = newState(ctx);
  const page = /** @type {any} */ (doc);
  const html = `<div id="jvb-root" class="jvb">${page.sections.map(section => renderSection(section, st)).join('')}</div>`;
  return { html, css: buildCss(page, ctx), problems: [], fonts: collectFonts(page, resolvedTheme(page.theme)) };
}
