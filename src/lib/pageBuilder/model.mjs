// The landing page builder's document model: what a valid page is, how its styles cascade across
// devices, and the tree operations the editor makes (LANDING_BUILDER_PLAN.md, Wave 0).
//
// Plain ESM JavaScript on purpose: the Express server imports the builder's renderer, and the
// renderer imports this file, so nothing here may need a TypeScript loader on a Node version
// nobody pinned. The types are in src/types/pageBuilder.ts and model.d.mts declares this file's
// exports against them. No imports at all, so the browser, the server and `node --test` load it
// the same way.
//
// Three rules hold everywhere below:
// 1. validateBuilderDoc never throws. It answers every problem it finds with the path to it.
// 2. A tree operation never mutates the document it was given and never throws. It answers
//    { ok: true, doc, id } with a new document, or { ok: false, reason } and changes nothing.
// 3. Every value that can reach CSS or an href is checked here first: colours, fonts, lengths,
//    links. The renderer checks again; neither trusts the other.

/** @typedef {import('../../types/pageBuilder').PropSpec} PropSpec */
/** @typedef {import('../../types/pageBuilder').StyleSpec} StyleSpec */

/** The document version this model reads and writes. */
export const BUILDER_VERSION = 1;

/** Where the tablet and mobile layers start: max-width media queries at these widths. */
export const BREAKPOINTS = Object.freeze({ tablet: 1024, mobile: 640 });

/** The devices, largest first: the order the style cascade runs in. */
export const DEVICES = Object.freeze(['desktop', 'tablet', 'mobile']);

/** The bounds a document must stay within. */
export const LIMITS = Object.freeze({
  /** Every section, column and widget counts. */
  maxNodes: 200,
  /** Characters in any one string. */
  maxString: 20000,
  /** Columns in one section. */
  maxColumns: 6,
  /** Items in one list prop (icon list, FAQ, testimonials). */
  maxListItems: 50,
  /** Characters in one link. */
  maxUrl: 2048
});

/** The theme colour slots; a colour value names one as `theme.<slot>`. */
export const THEME_COLOR_KEYS = Object.freeze(['primary', 'secondary', 'background', 'surface', 'text', 'muted']);

/**
 * The theme a new or converted page starts with: the colours and fonts today's published page
 * uses (renderPublicFunnelHtml's :root variables and its Google Fonts link).
 */
export const DEFAULT_THEME = deepFreeze(/** @satisfies {import('../../types/pageBuilder').BuilderTheme} */ ({
  colors: {
    primary: '#EC4899',
    secondary: '#10B981',
    background: '#09080E',
    surface: '#161320',
    text: '#F8FAFC',
    muted: '#94A3B8'
  },
  fonts: { heading: 'Playfair Display', body: 'Outfit' },
  radius: 16,
  spacingScale: 8,
  buttonStyle: 'solid',
  containerWidth: 840,
  headingScale: 1,
  headingWeight: 700,
  headingLineHeight: 1.2,
  bodySize: 16,
  bodyWeight: 400,
  bodyLineHeight: 1.5,
  linkColor: 'theme.primary',
  buttonRadius: null,
  buttonShadow: 'none',
  sectionPaddingY: 0,
  sectionGap: 0
}));

/** The button shadow presets a theme may name. */
export const THEME_BUTTON_SHADOWS = Object.freeze(['none', 'soft', 'medium', 'strong']);

/**
 * The numeric theme settings added after the first release, each with its range. A document that
 * leaves one out gets DEFAULT_THEME's value, which reproduces the page as it rendered before.
 */
export const THEME_NUMBER_RANGES = Object.freeze({
  headingScale: Object.freeze({ min: 0.5, max: 2, unit: 'x' }),
  headingWeight: Object.freeze({ min: 100, max: 900, unit: '', integer: true, step: 100 }),
  headingLineHeight: Object.freeze({ min: 0.8, max: 2.5, unit: '' }),
  bodySize: Object.freeze({ min: 10, max: 28, unit: 'px' }),
  bodyWeight: Object.freeze({ min: 100, max: 900, unit: '', integer: true, step: 100 }),
  bodyLineHeight: Object.freeze({ min: 1, max: 2.5, unit: '' }),
  buttonRadius: Object.freeze({ min: 0, max: 64, unit: 'px' }),
  sectionPaddingY: Object.freeze({ min: 0, max: 240, unit: 'px' }),
  sectionGap: Object.freeze({ min: 0, max: 160, unit: 'px' })
});

/**
 * The only hosts a video widget may play from. The page's Content Security Policy keeps
 * frame-src closed apart from these, so any other host would publish a frame that never loads.
 */
export const VIDEO_HOSTS = Object.freeze([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com'
]);

// ---- Value rules ----

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const THEME_TOKEN = /^theme\.([A-Za-z]+)$/;
/** An id is safe as a CSS class and an HTML attribute without escaping. */
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ANCHOR_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** A Google Fonts family name: letters, digits and single spaces, nothing CSS could read as syntax. */
const FONT_RE = /^[A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+)*$/;
const CLASS_RE = /^[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z_][A-Za-z0-9_-]*)*$/;
const URL_UNSAFE = /[\s\u0000-\u001f\u007f\\]/;

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @template T
 * @param {T} v
 * @returns {T}
 */
function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const key of Object.keys(v)) deepFreeze(v[key]);
    Object.freeze(v);
  }
  return v;
}

/** A deep copy of plain JSON-shaped data. Anything else is copied by reference. */
function cloneJson(v) {
  if (Array.isArray(v)) return v.map(cloneJson);
  if (isPlainObject(v)) {
    const out = {};
    // defineProperty, so a key named __proto__ stays a key (and is refused) instead of a prototype.
    for (const key of Object.keys(v)) {
      Object.defineProperty(out, key, { value: cloneJson(v[key]), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return v;
}

function quote(v) {
  const s = typeof v === 'string' ? v : String(v);
  return JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);
}

function colorProblem(v) {
  if (typeof v !== 'string') return 'a colour is text such as #ec4899 or theme.primary';
  if (HEX_COLOR.test(v)) return null;
  const token = THEME_TOKEN.exec(v);
  if (token) {
    return THEME_COLOR_KEYS.includes(token[1])
      ? null
      : `${quote(v)} names no theme colour: use one of ${THEME_COLOR_KEYS.map(k => `theme.${k}`).join(', ')}`;
  }
  return `${quote(v)} is not a colour: use #rgb, #rrggbb, #rrggbbaa or a theme colour such as theme.primary`;
}

function fontProblem(v) {
  if (typeof v !== 'string') return 'a font is a family name or theme.heading or theme.body';
  if (v === 'theme.heading' || v === 'theme.body') return null;
  if (v.length <= 60 && FONT_RE.test(v)) return null;
  return `${quote(v)} is not a font family name: use letters, digits and spaces, or theme.heading or theme.body`;
}

/**
 * Why a link is refused, or null when it is allowed. Allowed: empty (no link), http:// or
 * https:// with a host, a site-relative path starting with one slash, or a same-page anchor.
 * A video link must be http(s) on one of VIDEO_HOSTS.
 */
function urlProblem(v, { video = false } = {}) {
  if (typeof v !== 'string') return 'a link is text';
  if (v === '') return null;
  if (v.length > LIMITS.maxUrl) return `a link is at most ${LIMITS.maxUrl} characters`;
  if (URL_UNSAFE.test(v)) return 'a link holds no spaces, control characters or backslashes';
  if (v.startsWith('#')) {
    if (video) return 'a video link is a YouTube or Vimeo address, not an anchor';
    return ANCHOR_RE.test(v.slice(1)) ? null : `${quote(v)} is not an anchor: use # and then letters, digits, hyphens or underscores`;
  }
  if (v.startsWith('/')) {
    if (v.startsWith('//')) return `${quote(v)} leaves the site: write the address in full with https://`;
    if (video) return 'a video link is a YouTube or Vimeo address, not a path on this site';
    return null;
  }
  if (!/^https?:\/\//i.test(v)) return `${quote(v)} is not a link: use an http or https address, or a path on this site starting with /`;
  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    return `${quote(v)} is not a link the browser can read`;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return `${quote(v)} is not an http or https address with a host`;
  }
  if (video && !VIDEO_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return `a video plays from YouTube or Vimeo only, not ${parsed.hostname}`;
  }
  return null;
}

/**
 * The link rule as a function the renderer can call: why a link is refused, or null when it is
 * allowed (empty, http(s) with a host, a site path starting with one slash, or a same-page
 * anchor). `video: true` also requires a host on VIDEO_HOSTS. The same function validation uses.
 * @param {unknown} v
 * @param {{ video?: boolean }} [options]
 * @returns {string | null}
 */
export function linkProblem(v, options) {
  return urlProblem(v, options);
}

function stringProblem(v) {
  if (typeof v !== 'string') return 'this is text';
  if (v.length > LIMITS.maxString) return `text is at most ${LIMITS.maxString} characters; this has ${v.length}`;
  return null;
}

function numberProblem(v, spec) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return `${quote(v)} is not a finite number`;
  if (spec.integer && !Number.isInteger(v)) return `${v} is not a whole number`;
  if (v < spec.min || v > spec.max) return `${v} is outside ${spec.min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}`;
  return null;
}

// ---- Style keys ----

/** @type {(label: string, min: number) => StyleSpec} */
const spacing = (label, min) => ({ kind: 'number', group: 'spacing', label, min, max: 400, unit: 'px' });

/**
 * Every style key a device layer may hold, with how it is checked and where the inspector shows
 * it. A key that is not here is refused, so nothing unchecked reaches CSS.
 */
export const STYLE_KEYS = deepFreeze(/** @satisfies {Record<keyof import('../../types/pageBuilder').StyleValues, import('../../types/pageBuilder').StyleSpec>} */ ({
  paddingTop: spacing('Padding top', 0),
  paddingRight: spacing('Padding right', 0),
  paddingBottom: spacing('Padding bottom', 0),
  paddingLeft: spacing('Padding left', 0),
  marginTop: spacing('Margin top', -400),
  marginRight: spacing('Margin right', -400),
  marginBottom: spacing('Margin bottom', -400),
  marginLeft: spacing('Margin left', -400),

  backgroundColor: { kind: 'color', group: 'background', label: 'Background colour' },
  backgroundImage: { kind: 'url', group: 'background', label: 'Background image' },
  backgroundFocalX: { kind: 'number', group: 'background', label: 'Focal point, left to right', min: 0, max: 100, unit: '%' },
  backgroundFocalY: { kind: 'number', group: 'background', label: 'Focal point, top to bottom', min: 0, max: 100, unit: '%' },
  backgroundOverlayColor: { kind: 'color', group: 'background', label: 'Overlay colour' },
  backgroundOverlayOpacity: { kind: 'number', group: 'background', label: 'Overlay strength', min: 0, max: 100, unit: '%' },

  borderWidth: { kind: 'number', group: 'border', label: 'Border width', min: 0, max: 40, unit: 'px' },
  borderStyle: { kind: 'enum', group: 'border', label: 'Border style', values: ['none', 'solid', 'dashed', 'dotted'] },
  borderColor: { kind: 'color', group: 'border', label: 'Border colour' },
  borderRadius: { kind: 'number', group: 'border', label: 'Corner radius', min: 0, max: 400, unit: 'px' },
  shadow: { kind: 'enum', group: 'border', label: 'Shadow', values: ['none', 'sm', 'md', 'lg', 'xl'] },

  fontFamily: { kind: 'font', group: 'typography', label: 'Font' },
  fontSize: { kind: 'number', group: 'typography', label: 'Size', min: 8, max: 200, unit: 'px' },
  fontWeight: { kind: 'enum', group: 'typography', label: 'Weight', values: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
  lineHeight: { kind: 'number', group: 'typography', label: 'Line height', min: 0.5, max: 4, unit: '' },
  letterSpacing: { kind: 'number', group: 'typography', label: 'Letter spacing', min: -10, max: 40, unit: 'px' },
  textAlign: { kind: 'enum', group: 'typography', label: 'Alignment', values: ['left', 'center', 'right', 'justify'] },
  textColor: { kind: 'color', group: 'typography', label: 'Text colour' },

  width: { kind: 'number', group: 'layout', label: 'Width', min: 1, max: 100, unit: '%' },
  maxWidth: { kind: 'number', group: 'layout', label: 'Maximum width', min: 40, max: 4000, unit: 'px' },
  align: { kind: 'enum', group: 'layout', label: 'Position across', values: ['start', 'center', 'end', 'stretch'] },
  verticalAlign: { kind: 'enum', group: 'layout', label: 'Content top to bottom', values: ['top', 'middle', 'bottom'] },
  minHeight: { kind: 'number', group: 'layout', label: 'Minimum height', min: 0, max: 2000, unit: 'px' },

  hidden: { kind: 'boolean', group: 'advanced', label: 'Hide on this device' },
  customClass: { kind: 'className', group: 'advanced', label: 'CSS class', desktopOnly: true }
}));

function styleValueProblem(key, v, layerName) {
  const spec = Object.hasOwn(STYLE_KEYS, key) ? STYLE_KEYS[key] : null;
  if (!spec) return `${quote(key)} is not a style key this builder knows`;
  switch (spec.kind) {
    case 'number': return numberProblem(v, spec);
    case 'color': return colorProblem(v);
    case 'url': return urlProblem(v);
    case 'font': return fontProblem(v);
    case 'boolean': return typeof v === 'boolean' ? null : `${quote(v)} is not true or false`;
    case 'enum': return spec.values.includes(v) ? null : `${quote(v)} is not one of ${spec.values.join(', ')}`;
    case 'className':
      if (layerName !== 'desktop') return 'a CSS class is set on the desktop layer and applies to every device';
      if (typeof v !== 'string' || v.length > 200 || !CLASS_RE.test(v)) return `${quote(v)} is not a list of CSS class names`;
      return null;
    default: return `${quote(key)} has no rule`;
  }
}

// ---- Props ----

/** @type {(label: string, extra?: { multiline?: boolean, markdown?: boolean }) => PropSpec} */
const str = (label, extra = {}) => ({ kind: 'string', label, ...extra });
/** @type {(label: string, extra?: { video?: boolean }) => PropSpec} */
const link = (label, extra = {}) => ({ kind: 'url', label, ...extra });
/** @type {(label: string, min: number, max: number, extra?: { integer?: boolean, unit?: string }) => PropSpec} */
const num = (label, min, max, extra = {}) => ({ kind: 'number', label, min, max, ...extra });
/** @type {(label: string) => PropSpec} */
const bool = label => ({ kind: 'boolean', label });
/** @type {(label: string, values: ReadonlyArray<string | number>) => PropSpec} */
const oneOf = (label, values) => ({ kind: 'enum', label, values });
/** @type {(label: string, itemLabel: string, item: Record<string, PropSpec>) => PropSpec} */
const listOf = (label, itemLabel, item) => ({ kind: 'list', label, itemLabel, max: LIMITS.maxListItems, item });

/** The props a section takes. Columns take none. */
export const SECTION_PROPS = deepFreeze(/** @satisfies {Record<keyof import('../../types/pageBuilder').SectionProps, import('../../types/pageBuilder').PropSpec>} */ ({
  label: str('Name in the outline'),
  anchor: { kind: 'anchor', label: 'Anchor for links (#name)' },
  contentWidth: oneOf('Content width', ['boxed', 'full']),
  columnGap: num('Space between columns', 0, 120, { integer: true, unit: 'px' }),
  stackOn: oneOf('Stack columns on', ['tablet', 'mobile', 'never'])
}));

export const SECTION_DEFAULTS = deepFreeze(/** @satisfies {import('../../types/pageBuilder').SectionProps} */ ({
  label: '',
  anchor: '',
  contentWidth: 'boxed',
  columnGap: 24,
  stackOn: 'mobile'
}));

function propValueProblem(spec, v) {
  switch (spec.kind) {
    case 'string':
    case 'html':
      return stringProblem(v);
    case 'anchor':
      if (typeof v !== 'string') return 'an anchor is text';
      return v === '' || ANCHOR_RE.test(v) ? null : `${quote(v)} is not an anchor name: use letters, digits, hyphens and underscores, starting with a letter`;
    case 'url': return urlProblem(v, { video: spec.video === true });
    case 'color': return colorProblem(v);
    case 'number': return numberProblem(v, spec);
    case 'boolean': return typeof v === 'boolean' ? null : `${quote(v)} is not true or false`;
    case 'enum': return spec.values.includes(v) ? null : `${quote(v)} is not one of ${spec.values.join(', ')}`;
    case 'datetime':
      if (typeof v !== 'string') return 'a date is text';
      if (v === '') return null;
      return v.length <= 40 && Number.isFinite(Date.parse(v)) ? null : `${quote(v)} is not a date and time`;
    default: return 'this prop has no rule';
  }
}

/** Checks one props object against its spec. Absent props read as their defaults. */
function checkProps(props, specs, path, state) {
  if (!isPlainObject(props)) {
    report(state, path, 'props is an object');
    return;
  }
  for (const key of Object.keys(props)) {
    const spec = Object.hasOwn(specs, key) ? specs[key] : null;
    const at = `${path}.${key}`;
    if (!spec) {
      report(state, at, `${quote(key)} is not a prop of this node`);
      continue;
    }
    const v = props[key];
    if (spec.kind === 'list') {
      if (!Array.isArray(v)) {
        report(state, at, `${spec.label} is a list`);
        continue;
      }
      if (v.length > spec.max) report(state, at, `${spec.label} holds at most ${spec.max} items; this has ${v.length}`);
      v.slice(0, spec.max).forEach((item, i) => {
        const itemAt = `${at}[${i}]`;
        if (!isPlainObject(item)) {
          report(state, itemAt, `each ${spec.itemLabel} is an object`);
          return;
        }
        for (const field of Object.keys(item)) {
          const fieldSpec = Object.hasOwn(spec.item, field) ? spec.item[field] : null;
          if (!fieldSpec) {
            report(state, `${itemAt}.${field}`, `${quote(field)} is not a field of a ${spec.itemLabel}`);
            continue;
          }
          const problem = propValueProblem(fieldSpec, item[field]);
          if (problem) report(state, `${itemAt}.${field}`, problem);
        }
      });
      continue;
    }
    const problem = propValueProblem(spec, v);
    if (problem) report(state, at, problem);
  }
}

// ---- The widget registry ----

/** @returns {import('../../types/pageBuilder').DeviceStyle} */
const NO_STYLE = () => ({ desktop: {} });

/** The longest evergreen countdown, in minutes (a year). */
const COUNTDOWN_MAX_MINUTES = 525600;
/** The largest stock count. */
const STOCK_MAX = 1000000;

/**
 * Every widget type: its palette label and group, a one-line description, the props and style a
 * new one starts with, the props the canvas edits in place, the words today's renderer shows when
 * a prop is empty (`fallbacks`), and how each prop is checked (`props`).
 *
 * A new widget starts with no copy, no product, no price and no claim: an empty prop is a hint
 * in the editor, never words on the page. The fallbacks are the only words a page shows that the
 * merchant did not write, and each is word for word what renderPublicFunnelHtml shows today.
 */
export const WIDGET_REGISTRY = deepFreeze(/** @satisfies {import('../../types/pageBuilder').WidgetRegistry} */ ({
  heading: {
    type: 'heading', label: 'Heading', group: 'basic',
    description: 'A title for the page or a section.',
    defaultProps: { text: '', level: 2, link: '' },
    defaultStyle: { desktop: { fontFamily: 'theme.heading' } },
    inlineEditable: ['text'],
    fallbacks: {},
    props: { text: str('Text', { multiline: true }), level: oneOf('Level', [1, 2, 3, 4, 5, 6]), link: link('Link') }
  },
  text: {
    type: 'text', label: 'Text', group: 'basic',
    description: 'Paragraphs with bold, italic, links and lists.',
    defaultProps: { text: '' },
    defaultStyle: { desktop: { fontFamily: 'theme.body' } },
    inlineEditable: ['text'],
    fallbacks: {},
    props: { text: str('Text', { multiline: true, markdown: true }) }
  },
  image: {
    type: 'image', label: 'Image', group: 'basic',
    description: 'A picture, with alt text for screen readers.',
    defaultProps: { src: '', alt: '', caption: '', link: '', fit: 'cover', aspect: 'auto' },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['caption'],
    fallbacks: {},
    props: {
      src: link('Image'), alt: str('Alt text'), caption: str('Caption'), link: link('Link'),
      fit: oneOf('Fit', ['cover', 'contain']), aspect: oneOf('Shape', ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'])
    }
  },
  button: {
    type: 'button', label: 'Button', group: 'basic',
    description: 'A link that looks like a button.',
    defaultProps: { label: '', url: '', newTab: false, variant: 'primary', size: 'md', fullWidth: false },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['label'],
    fallbacks: {},
    props: {
      label: str('Label'), url: link('Link'), newTab: bool('Open in a new tab'),
      variant: oneOf('Look', ['primary', 'secondary', 'outline']), size: oneOf('Size', ['sm', 'md', 'lg']),
      fullWidth: bool('Full width')
    }
  },
  spacer: {
    type: 'spacer', label: 'Spacer', group: 'basic',
    description: 'Empty space. Set its height for each device in Style.',
    defaultProps: {},
    defaultStyle: { desktop: { minHeight: 40 } },
    inlineEditable: [],
    fallbacks: {},
    props: {}
  },
  divider: {
    type: 'divider', label: 'Divider', group: 'basic',
    description: 'A line between blocks.',
    defaultProps: { lineStyle: 'solid', thickness: 1, color: 'theme.muted', length: 100 },
    defaultStyle: NO_STYLE(),
    inlineEditable: [],
    fallbacks: {},
    props: {
      lineStyle: oneOf('Line', ['solid', 'dashed', 'dotted']),
      thickness: num('Thickness', 1, 20, { integer: true, unit: 'px' }),
      color: { kind: 'color', label: 'Colour' },
      length: num('Length', 5, 100, { unit: '%' })
    }
  },
  video: {
    type: 'video', label: 'Video', group: 'media',
    description: 'A YouTube or Vimeo video.',
    defaultProps: { url: '', title: '', aspect: '16:9', startAt: 0 },
    defaultStyle: NO_STYLE(),
    inlineEditable: [],
    fallbacks: {},
    props: {
      url: link('YouTube or Vimeo address', { video: true }), title: str('Title for screen readers'),
      aspect: oneOf('Shape', ['16:9', '4:3', '1:1', '9:16']), startAt: num('Start at', 0, 86400, { integer: true, unit: 's' })
    }
  },
  htmlEmbed: {
    type: 'htmlEmbed', label: 'HTML embed', group: 'media',
    description: 'Your own HTML. Scripts, event handlers and javascript: links are removed.',
    defaultProps: { html: '', title: '' },
    defaultStyle: NO_STYLE(),
    inlineEditable: [],
    fallbacks: {},
    props: { html: { kind: 'html', label: 'HTML' }, title: str('Name for screen readers') }
  },
  iconList: {
    type: 'iconList', label: 'Icon list', group: 'content',
    description: 'Short points, each with an icon.',
    defaultProps: { icon: 'check', items: [] },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['items.*.text'],
    fallbacks: {},
    props: { icon: oneOf('Icon', ['check', 'star', 'arrow', 'dot']), items: listOf('Points', 'point', { text: str('Point') }) }
  },
  testimonials: {
    type: 'testimonials', label: 'Testimonials', group: 'proof',
    description: 'Quotes from customers, in their own words.',
    defaultProps: { layout: 'grid', items: [] },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['items.*.quote', 'items.*.name', 'items.*.role'],
    fallbacks: {},
    props: {
      layout: oneOf('Layout', ['grid', 'stack']),
      items: listOf('Testimonials', 'testimonial', {
        quote: str('Quote', { multiline: true }), name: str('Name'), role: str('Role or place'),
        avatarUrl: link('Photo'), rating: num('Stars', 0, 5, { integer: true })
      })
    }
  },
  faq: {
    type: 'faq', label: 'FAQ', group: 'content',
    description: 'Questions that open to show their answers.',
    defaultProps: { items: [], openFirst: false },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['items.*.question', 'items.*.answer'],
    fallbacks: {},
    props: {
      items: listOf('Questions', 'question', { question: str('Question'), answer: str('Answer', { multiline: true }) }),
      openFirst: bool('Open the first answer')
    }
  },
  countdown: {
    type: 'countdown', label: 'Countdown', group: 'commerce',
    description: 'A timer that counts down for each visitor, or to one date.',
    defaultProps: { text: '', mode: 'evergreen', minutes: 0, deadline: '', expiredText: '' },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['text'],
    fallbacks: { text: 'This offer timer runs for', expiredText: 'Reservation extended for final checkout:' },
    props: {
      text: str('Line before the clock'), mode: oneOf('Counts down', ['evergreen', 'deadline']),
      minutes: num('Minutes for each visitor', 0, COUNTDOWN_MAX_MINUTES, { unit: 'min' }),
      deadline: { kind: 'datetime', label: 'Ends at' }, expiredText: str('Line once it ends')
    }
  },
  leadForm: {
    type: 'leadForm', label: 'Lead form', group: 'commerce',
    description: 'Asks for an email, and a name or phone if you choose, and saves the lead.',
    defaultProps: { heading: '', buttonText: '', nameField: 'optional', phoneField: 'optional', successText: '', afterSubmit: 'message' },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['heading', 'buttonText'],
    fallbacks: { heading: 'Leave your email', buttonText: 'Send', successText: 'Thanks. Your details were received.' },
    props: {
      heading: str('Heading'), buttonText: str('Button'),
      nameField: oneOf('Name', ['hidden', 'optional', 'required']), phoneField: oneOf('Phone', ['hidden', 'optional', 'required']),
      successText: str('Thanks line'), afterSubmit: oneOf('After sending', ['message', 'checkout'])
    }
  },
  productHero: {
    type: 'productHero', label: 'Product', group: 'commerce',
    description: 'Your store product, with its image and price.',
    defaultProps: { productId: '', variantId: '', collectionId: '', title: '', price: '', productImage: '', imageUrl: '', imageAlt: '', showPrice: true },
    defaultStyle: NO_STYLE(),
    inlineEditable: [],
    fallbacks: {},
    props: {
      productId: str('Product'), variantId: str('Variant'), collectionId: str('Collection'),
      title: str('Product name'), price: str('Price'), productImage: link('Product image'),
      imageUrl: link('Image'), imageAlt: str('Alt text'), showPrice: bool('Show the price')
    }
  },
  checkoutButton: {
    type: 'checkoutButton', label: 'Checkout button', group: 'commerce',
    description: 'Sends the visitor to checkout, or asks for an email first.',
    defaultProps: { label: '', discountCode: '', checkoutMode: 'direct', cartAction: 'checkout', showCodeNote: true, fullWidth: true },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['label'],
    fallbacks: { label: 'Continue' },
    props: {
      label: str('Button'), discountCode: str('Discount code'),
      checkoutMode: oneOf('Checkout', ['direct', 'lead-gate']), cartAction: oneOf('Counts as', ['checkout', 'add']),
      showCodeNote: bool('Say the code is ready at checkout'), fullWidth: bool('Full width')
    }
  },
  orderBump: {
    type: 'orderBump', label: 'Order bump', group: 'commerce',
    description: 'A one-tick add-on beside the checkout button.',
    defaultProps: { productId: '', variantId: '', headline: '', description: '', title: '', price: '', image: '' },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['headline', 'description'],
    fallbacks: { headline: 'Add this to the order', title: 'Add-on' },
    props: {
      productId: str('Product'), variantId: str('Variant'), headline: str('Headline'),
      description: str('Description', { multiline: true }), title: str('Add-on name'), price: str('Price'), image: link('Image')
    }
  },
  reviewsWall: {
    type: 'reviewsWall', label: 'Reviews wall', group: 'proof',
    description: 'Verified reviews from your store. Shows only when there are some.',
    defaultProps: { headline: '', minRating: 4, photos: true },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['headline'],
    fallbacks: { headline: 'Customer reviews' },
    props: { headline: str('Heading'), minRating: num('Lowest rating shown', 1, 5, { unit: 'stars' }), photos: bool('Show review photos') }
  },
  stockCount: {
    type: 'stockCount', label: 'Stock count', group: 'commerce',
    description: 'How many units are left, in your words.',
    defaultProps: { text: '', count: 0 },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['text'],
    fallbacks: { text: 'Limited batch: {count} units remaining' },
    props: { text: str('Stock line'), count: num('Units left', 0, STOCK_MAX) }
  },
  trustBadge: {
    type: 'trustBadge', label: 'Trust badge', group: 'proof',
    description: 'One reassuring line, such as your returns promise.',
    defaultProps: { text: '', icon: 'none' },
    defaultStyle: NO_STYLE(),
    inlineEditable: ['text'],
    fallbacks: {},
    props: { text: str('Line'), icon: oneOf('Icon', ['none', 'shield', 'lock', 'star']) }
  }
}));

/** The palette's groups, in the order it shows them. */
export const WIDGET_GROUPS = deepFreeze([
  { id: 'basic', label: 'Basic' },
  { id: 'content', label: 'Content' },
  { id: 'media', label: 'Media' },
  { id: 'proof', label: 'Proof' },
  { id: 'commerce', label: 'Sell' }
]);

const WIDGET_TYPES = Object.freeze(Object.keys(WIDGET_REGISTRY));

// ---- Validation ----

const MAX_PROBLEMS = 200;

function newState() {
  return { problems: [], ids: new Map(), seen: new Set(), truncated: 0 };
}

function report(state, path, message) {
  if (state.problems.length >= MAX_PROBLEMS) {
    state.truncated += 1;
    return;
  }
  state.problems.push({ path, message });
}

function checkStyle(style, path, state) {
  if (!isPlainObject(style)) {
    report(state, path, 'style is an object with a desktop layer');
    return;
  }
  if (!('desktop' in style)) report(state, `${path}.desktop`, 'style has a desktop layer, even an empty one');
  for (const layerName of Object.keys(style)) {
    const layerAt = `${path}.${layerName}`;
    if (!DEVICES.includes(layerName)) {
      report(state, layerAt, `${quote(layerName)} is not a device: use desktop, tablet or mobile`);
      continue;
    }
    const layer = style[layerName];
    if (layer === undefined && layerName !== 'desktop') continue;
    if (!isPlainObject(layer)) {
      report(state, layerAt, 'a style layer is an object');
      continue;
    }
    for (const key of Object.keys(layer)) {
      const problem = styleValueProblem(key, layer[key], layerName);
      if (problem) report(state, `${layerAt}.${key}`, problem);
    }
  }
}

/** What may sit at each depth: 0 the page's sections, 1 their columns, 2 widgets or inner sections, 3 inner columns, 4 widgets. */
function kindsAt(depth) {
  if (depth === 0) return ['section'];
  if (depth === 1 || depth === 3) return ['column'];
  if (depth === 2) return ['widget', 'section'];
  if (depth === 4) return ['widget'];
  return [];
}

const TOO_DEEP = 'too deep: a page nests at most section > column > inner section > column > widget, so an inner section cannot hold another section';

function misplaced(kind, depth) {
  if (depth === 0) {
    return kind === 'column'
      ? 'a column sits inside a section, not straight on the page'
      : 'a widget sits inside a column of a section, not straight on the page';
  }
  if (depth === 1 || depth === 3) return `a section holds columns only, so this ${kind} needs a column around it`;
  if (kind === 'section') return TOO_DEEP;
  if (kind === 'column') return 'a column sits inside a section, not inside another column';
  return TOO_DEEP;
}

/** Checks one node and everything under it as if it sat at `depth`. */
function checkNode(node, path, depth, state) {
  if (!isPlainObject(node)) {
    report(state, path, 'a node is an object with an id, a kind, props and a style');
    return;
  }
  if (state.seen.has(node)) {
    report(state, path, 'this node appears twice in the tree');
    return;
  }
  state.seen.add(node);

  if (typeof node.id !== 'string' || !ID_RE.test(node.id)) {
    report(state, `${path}.id`, `${quote(node.id)} is not an id: use a letter, then letters, digits, hyphens or underscores, at most 64`);
  } else if (state.ids.has(node.id)) {
    report(state, `${path}.id`, `id ${quote(node.id)} is already used at ${state.ids.get(node.id) || 'another node'}`);
  } else {
    state.ids.set(node.id, path);
  }

  const kind = node.kind;
  if (kind !== 'section' && kind !== 'column' && kind !== 'widget') {
    report(state, `${path}.kind`, `${quote(kind)} is not a kind: use section, column or widget`);
    return;
  }
  if (!kindsAt(depth).includes(kind)) {
    report(state, path, misplaced(kind, depth));
    return;
  }

  const allowed = kind === 'widget' ? ['id', 'kind', 'type', 'props', 'style'] : ['id', 'kind', 'props', 'style', 'children'];
  for (const key of Object.keys(node)) {
    if (allowed.includes(key)) continue;
    if (kind === 'widget' && key === 'children') report(state, `${path}.children`, 'a widget holds no children');
    else report(state, `${path}.${key}`, `${quote(key)} is not a field of a ${kind}`);
  }

  checkStyle(node.style, `${path}.style`, state);

  if (kind === 'widget') {
    const def = typeof node.type === 'string' && Object.hasOwn(WIDGET_REGISTRY, node.type) ? WIDGET_REGISTRY[node.type] : null;
    if (!def) {
      report(state, `${path}.type`, `${quote(node.type)} is not a widget type: use one of ${WIDGET_TYPES.join(', ')}`);
      return;
    }
    checkProps(node.props, def.props, `${path}.props`, state);
    return;
  }

  checkProps(node.props, kind === 'section' ? SECTION_PROPS : {}, `${path}.props`, state);

  const children = node.children;
  if (!Array.isArray(children)) {
    report(state, `${path}.children`, `a ${kind} has a children list`);
    return;
  }
  if (kind === 'section') {
    if (children.length === 0) report(state, `${path}.children`, 'a section holds at least one column');
    if (children.length > LIMITS.maxColumns) {
      report(state, `${path}.children`, `a section holds at most ${LIMITS.maxColumns} columns; this has ${children.length}`);
    }
  }
  children.forEach((child, i) => checkNode(child, `${path}.children[${i}]`, depth + 1, state));
}

function checkTheme(theme, state) {
  const path = 'theme';
  if (!isPlainObject(theme)) {
    report(state, path, 'theme is an object');
    return;
  }
  const known = [
    'colors', 'fonts', 'radius', 'spacingScale', 'buttonStyle', 'containerWidth',
    ...Object.keys(THEME_NUMBER_RANGES), 'linkColor', 'buttonShadow'
  ];
  for (const key of Object.keys(theme)) {
    if (!known.includes(key)) report(state, `${path}.${key}`, `${quote(key)} is not a theme setting`);
  }
  if ('colors' in theme) {
    if (!isPlainObject(theme.colors)) report(state, `${path}.colors`, 'theme colours are an object');
    else {
      for (const key of Object.keys(theme.colors)) {
        const at = `${path}.colors.${key}`;
        if (!THEME_COLOR_KEYS.includes(key)) report(state, at, `${quote(key)} is not a theme colour slot`);
        else if (typeof theme.colors[key] !== 'string' || !HEX_COLOR.test(theme.colors[key])) {
          report(state, at, `${quote(theme.colors[key])} is not a colour: a theme colour is #rgb, #rrggbb or #rrggbbaa`);
        }
      }
    }
  }
  if ('fonts' in theme) {
    if (!isPlainObject(theme.fonts)) report(state, `${path}.fonts`, 'theme fonts are an object');
    else {
      for (const key of Object.keys(theme.fonts)) {
        const at = `${path}.fonts.${key}`;
        const v = theme.fonts[key];
        if (key !== 'heading' && key !== 'body') report(state, at, `${quote(key)} is not a theme font: use heading or body`);
        else if (typeof v !== 'string' || v.length > 60 || !FONT_RE.test(v)) report(state, at, `${quote(v)} is not a font family name`);
      }
    }
  }
  const numbers = { radius: [0, 64], spacingScale: [2, 24], containerWidth: [480, 1920] };
  for (const [key, [min, max]] of Object.entries(numbers)) {
    if (!(key in theme)) continue;
    const problem = numberProblem(theme[key], { min, max, unit: 'px' });
    if (problem) report(state, `${path}.${key}`, problem);
  }
  if ('buttonStyle' in theme && !['solid', 'outline', 'pill'].includes(theme.buttonStyle)) {
    report(state, `${path}.buttonStyle`, `${quote(theme.buttonStyle)} is not one of solid, outline, pill`);
  }
  for (const [key, spec] of Object.entries(THEME_NUMBER_RANGES)) {
    if (!(key in theme)) continue;
    const v = theme[key];
    // buttonRadius null means "follow the theme radius", so it is a valid, explicit way to say so.
    if (key === 'buttonRadius' && v === null) continue;
    let problem = numberProblem(v, spec);
    if (!problem && spec.step && v % spec.step !== 0) problem = `${v} is not a multiple of ${spec.step}`;
    if (problem) report(state, `${path}.${key}`, problem);
  }
  if ('linkColor' in theme) {
    const problem = colorProblem(theme.linkColor);
    if (problem) report(state, `${path}.linkColor`, problem);
  }
  if ('buttonShadow' in theme && !THEME_BUTTON_SHADOWS.includes(theme.buttonShadow)) {
    report(state, `${path}.buttonShadow`, `${quote(theme.buttonShadow)} is not one of ${THEME_BUTTON_SHADOWS.join(', ')}`);
  }
}

/** How many sections, columns and widgets a document or node holds. */
export function countNodes(docOrNode) {
  const seen = new Set();
  const count = node => {
    if (!isPlainObject(node) || seen.has(node)) return 0;
    seen.add(node);
    let n = 1;
    if (Array.isArray(node.children)) for (const child of node.children) n += count(child);
    return n;
  };
  if (isPlainObject(docOrNode) && Array.isArray(docOrNode.sections) && !('kind' in docOrNode)) {
    return docOrNode.sections.reduce((n, s) => n + count(s), 0);
  }
  return count(docOrNode);
}

/**
 * Every problem with a document, each with the path to it. Never throws: a value it cannot read
 * is a problem like any other. `ok` is true only when there are none.
 *
 * Refused: a version this model does not read; unknown kinds, widget types, props, style keys
 * and devices; ids that are not CSS-safe or are used twice; a widget with children; a section
 * that holds anything but columns, or no column, or more than LIMITS.maxColumns; nesting deeper
 * than section > column > inner section > column > widget; numbers that are not finite or are
 * out of range; colours that are not #rgb, #rrggbb, #rrggbbaa or a theme token such as
 * theme.primary; links that are not http(s), site-relative or a same-page anchor; video links
 * off VIDEO_HOSTS; strings over LIMITS.maxString; more than LIMITS.maxNodes nodes.
 * A prop that is absent is not a problem: it reads as the widget's default.
 */
export function validateBuilderDoc(doc) {
  const state = newState();
  try {
    if (!isPlainObject(doc)) {
      report(state, '', 'a builder document is an object with a version, a theme and sections');
      return finish(state);
    }
    for (const key of Object.keys(doc)) {
      if (!['version', 'theme', 'sections'].includes(key)) report(state, key, `${quote(key)} is not a field of a builder document`);
    }
    if (doc.version !== BUILDER_VERSION) {
      const newer = typeof doc.version === 'number' && doc.version > BUILDER_VERSION;
      report(state, 'version', newer
        ? `this page was saved by a newer builder (version ${doc.version}); this one reads version ${BUILDER_VERSION}`
        : doc.version === undefined
          ? `a builder document has a version; this one reads version ${BUILDER_VERSION}`
          : `${quote(doc.version)} is not a builder version: this one reads version ${BUILDER_VERSION}`);
    }
    checkTheme(doc.theme, state);
    if (!Array.isArray(doc.sections)) {
      report(state, 'sections', 'sections is a list');
      return finish(state);
    }
    doc.sections.forEach((section, i) => checkNode(section, `sections[${i}]`, 0, state));
    const total = countNodes(doc);
    if (total > LIMITS.maxNodes) report(state, 'sections', `a page holds at most ${LIMITS.maxNodes} sections, columns and widgets; this has ${total}`);
  } catch (err) {
    report(state, '', `the document could not be read: ${err && err.message ? err.message : String(err)}`);
  }
  return finish(state);
}

function finish(state) {
  const problems = state.problems.slice();
  if (state.truncated) problems.push({ path: '', message: `and ${state.truncated} more problems` });
  return { ok: problems.length === 0, problems };
}

// ---- The cascade ----

const CASCADE = Object.freeze({
  desktop: Object.freeze(['desktop']),
  tablet: Object.freeze(['desktop', 'tablet']),
  mobile: Object.freeze(['desktop', 'tablet', 'mobile'])
});

/**
 * The style a node has on one device, as one flat object: desktop, then the tablet layer over it,
 * then the mobile layer over that. A layer that leaves a key out inherits it; an absent layer
 * inherits everything. Null and undefined values count as left out. Throws a TypeError for a
 * device that is not desktop, tablet or mobile, which is a programming error, not bad data.
 */
export function resolveStyle(node, device) {
  const order = Object.hasOwn(CASCADE, device) ? CASCADE[device] : null;
  if (!order) throw new TypeError(`resolveStyle: ${quote(device)} is not desktop, tablet or mobile`);
  const style = node && isPlainObject(node.style) ? node.style : {};
  const out = {};
  for (const layerName of order) {
    const layer = style[layerName];
    if (!isPlainObject(layer)) continue;
    for (const key of Object.keys(layer)) {
      const v = layer[key];
      if (v === undefined || v === null) continue;
      out[key] = v;
    }
  }
  return out;
}

// ---- Reading the tree ----

/**
 * Visits every node, parents before children, sections in page order. The visitor gets the node
 * and { parent, index, depth, path }; returning false skips that node's children.
 */
export function walk(doc, visitor) {
  if (!isPlainObject(doc) || !Array.isArray(doc.sections) || typeof visitor !== 'function') return;
  const seen = new Set();
  const visit = (node, parent, index, depth, path) => {
    if (!isPlainObject(node) || seen.has(node)) return;
    seen.add(node);
    const descend = visitor(node, { parent, index, depth, path });
    if (descend === false || !Array.isArray(node.children)) return;
    node.children.forEach((child, i) => visit(child, node, i, depth + 1, `${path}.children[${i}]`));
  };
  doc.sections.forEach((section, i) => visit(section, null, i, 0, `sections[${i}]`));
}

/** The node with this id, the section or column holding it (null for a top-level section) and its index there. */
export function findNode(doc, id) {
  const found = locate(doc, id);
  return found ? { node: found.node, parent: found.parent, index: found.index } : null;
}

function locate(doc, id) {
  /** @type {any} */
  let found = null;
  walk(doc, (node, info) => {
    if (found) return false;
    if (node.id === id) {
      found = { node, parent: info.parent, index: info.index, depth: info.depth, path: info.path };
      return false;
    }
    return true;
  });
  if (!found) return null;
  found.list = found.parent ? found.parent.children : doc.sections;
  return found;
}

function collectIds(docOrNode) {
  const ids = new Set();
  const add = node => {
    if (!isPlainObject(node)) return;
    if (typeof node.id === 'string') ids.add(node.id);
    if (Array.isArray(node.children)) node.children.forEach(add);
  };
  if (isPlainObject(docOrNode) && Array.isArray(docOrNode.sections) && !('kind' in docOrNode)) docOrNode.sections.forEach(add);
  else add(docOrNode);
  return ids;
}

function isInside(node, id) {
  let inside = false;
  const look = n => {
    if (inside || !isPlainObject(n) || !Array.isArray(n.children)) return;
    for (const child of n.children) {
      if (isPlainObject(child) && child.id === id) { inside = true; return; }
      look(child);
    }
  };
  look(node);
  return inside;
}

/**
 * Why `node` cannot sit at `depth`, or null. Only the shape: kinds by depth and the nesting
 * limit. Used by moves, where the node's own content is not changing.
 */
function shapeProblem(node, depth) {
  if (!isPlainObject(node)) return 'that is not a node';
  if (!kindsAt(depth).includes(node.kind)) {
    return node.kind === 'section' || node.kind === 'column' || node.kind === 'widget'
      ? misplaced(node.kind, depth)
      : `${quote(node.kind)} is not a kind`;
  }
  if (node.kind === 'widget') return null;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const problem = shapeProblem(child, depth + 1);
    if (problem) return problem;
  }
  return null;
}

/** Where children of `parentId` go: the list, the depth they sit at, and the parent node. */
function slotFor(doc, parentId) {
  if (parentId === null || parentId === undefined) return { list: doc.sections, depth: 0, parent: null };
  const found = locate(doc, parentId);
  if (!found) return { error: `no node has id ${quote(parentId)}` };
  if (found.node.kind === 'widget') return { error: 'a widget holds no children' };
  if (!Array.isArray(found.node.children)) found.node.children = [];
  return { list: found.node.children, depth: found.depth + 1, parent: found.node };
}

function indexProblem(index, length) {
  if (!Number.isInteger(index) || index < 0 || index > length) return `position ${quote(index)} is outside 0 to ${length}`;
  return null;
}

function refuse(reason) {
  return { ok: false, reason };
}

function usableDoc(doc) {
  return isPlainObject(doc) && Array.isArray(doc.sections);
}

// ---- Changing the tree ----

/**
 * A copy of `doc` with `node` (and everything under it) inserted under `parentId` at `index`.
 * `parentId` null inserts a section on the page. The node is checked in full where it would sit:
 * its shape, its ids against the page's, its props and its style.
 */
export function insertNode(doc, parentId, index, node) {
  try {
    if (!usableDoc(doc)) return refuse('the document has no sections list');
    const next = cloneJson(doc);
    const slot = slotFor(next, parentId);
    if (slot.error) return refuse(slot.error);
    const indexWrong = indexProblem(index, slot.list.length);
    if (indexWrong) return refuse(indexWrong);
    const copy = cloneJson(node);
    const shapeWrong = shapeProblem(copy, slot.depth);
    if (shapeWrong) return refuse(shapeWrong);
    const state = newState();
    for (const id of collectIds(next)) state.ids.set(id, 'the page');
    checkNode(copy, 'node', slot.depth, state);
    if (state.problems.length) {
      const first = state.problems[0];
      return refuse(first.path === 'node' ? first.message : `${first.message} (at ${first.path.replace(/^node\.?/, '')})`);
    }
    if (slot.parent && slot.parent.kind === 'section' && slot.list.length + 1 > LIMITS.maxColumns) {
      return refuse(`a section holds at most ${LIMITS.maxColumns} columns`);
    }
    if (countNodes(next) + countNodes(copy) > LIMITS.maxNodes) return refuse(`a page holds at most ${LIMITS.maxNodes} sections, columns and widgets`);
    slot.list.splice(index, 0, copy);
    return { ok: true, doc: next, id: copy.id };
  } catch (err) {
    return refuse(`the insert could not be made: ${err && err.message ? err.message : String(err)}`);
  }
}

/**
 * A copy of `doc` with the node `id` moved under `parentId` (null for the page) so it ends up at
 * `index` there. The index counts the target's children after the node has left its old place,
 * so moving a node one place down in the same parent is its index plus one.
 * Refused: a move into the node itself or its own contents, a move that breaks the nesting rule,
 * taking the last column out of a section, and more columns than a section holds.
 */
export function moveNode(doc, id, parentId, index) {
  try {
    if (!usableDoc(doc)) return refuse('the document has no sections list');
    const next = cloneJson(doc);
    const from = locate(next, id);
    if (!from) return refuse(`no node has id ${quote(id)}`);
    if (parentId === id) return refuse('a node cannot move into itself');
    if (parentId !== null && parentId !== undefined && isInside(from.node, parentId)) return refuse('a node cannot move into its own contents');
    const sameParent = (from.parent ? from.parent.id : null) === (parentId ?? null);
    if (from.node.kind === 'column' && !sameParent && from.list.length === 1) {
      return refuse('a section keeps at least one column: move or remove the section instead');
    }
    from.list.splice(from.index, 1);
    const slot = slotFor(next, parentId);
    if (slot.error) return refuse(slot.error);
    const shapeWrong = shapeProblem(from.node, slot.depth);
    if (shapeWrong) return refuse(shapeWrong);
    if (slot.parent && slot.parent.kind === 'section' && slot.list.length + 1 > LIMITS.maxColumns) {
      return refuse(`a section holds at most ${LIMITS.maxColumns} columns`);
    }
    const indexWrong = indexProblem(index, slot.list.length);
    if (indexWrong) return refuse(indexWrong);
    slot.list.splice(index, 0, from.node);
    return { ok: true, doc: next, id: from.node.id };
  } catch (err) {
    return refuse(`the move could not be made: ${err && err.message ? err.message : String(err)}`);
  }
}

/** A copy of `doc` without the node `id` and everything under it. A section's last column stays. */
export function removeNode(doc, id) {
  try {
    if (!usableDoc(doc)) return refuse('the document has no sections list');
    const next = cloneJson(doc);
    const found = locate(next, id);
    if (!found) return refuse(`no node has id ${quote(id)}`);
    if (found.node.kind === 'column' && found.list.length === 1) {
      return refuse('a section keeps at least one column: remove the section instead');
    }
    found.list.splice(found.index, 1);
    return { ok: true, doc: next, id: found.node.id };
  } catch (err) {
    return refuse(`the remove could not be made: ${err && err.message ? err.message : String(err)}`);
  }
}

function idPrefixFor(node) {
  if (node.kind === 'section') return 'sec';
  if (node.kind === 'column') return 'col';
  return typeof node.type === 'string' ? node.type : 'w';
}

/**
 * A copy of `doc` with a copy of the node `id` placed right after it. Every node in the copy gets
 * a fresh id, unique on the page. Answers the copy's id.
 */
export function duplicateNode(doc, id) {
  try {
    if (!usableDoc(doc)) return refuse('the document has no sections list');
    const next = cloneJson(doc);
    const found = locate(next, id);
    if (!found) return refuse(`no node has id ${quote(id)}`);
    const copy = cloneJson(found.node);
    if (countNodes(next) + countNodes(copy) > LIMITS.maxNodes) return refuse(`a page holds at most ${LIMITS.maxNodes} sections, columns and widgets`);
    if (copy.kind === 'column' && found.list.length + 1 > LIMITS.maxColumns) return refuse(`a section holds at most ${LIMITS.maxColumns} columns`);
    const taken = collectIds(next);
    const renumber = node => {
      if (!isPlainObject(node)) return;
      let fresh = mintId(idPrefixFor(node));
      while (taken.has(fresh)) fresh = mintId(idPrefixFor(node));
      taken.add(fresh);
      node.id = fresh;
      if (Array.isArray(node.children)) node.children.forEach(renumber);
    };
    renumber(copy);
    found.list.splice(found.index + 1, 0, copy);
    return { ok: true, doc: next, id: copy.id };
  } catch (err) {
    return refuse(`the copy could not be made: ${err && err.message ? err.message : String(err)}`);
  }
}

// ---- Making nodes ----

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new id: the prefix (letters and digits, starting with a letter) and ten random characters. */
export function mintId(prefix = 'n') {
  const cleaned = String(prefix ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  const head = /^[A-Za-z]/.test(cleaned) ? cleaned : `n${cleaned}`;
  const bytes = new Uint8Array(10);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let tail = '';
  for (const b of bytes) tail += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${head}-${tail}`;
}

/**
 * A new node with fresh ids and its defaults: a section comes with one empty column, a column
 * with nothing in it, a widget with its registry props and style. Throws a TypeError for a kind
 * or widget type that does not exist, which is a programming error, not bad data.
 */
export function createNode(kind, type) {
  if (kind === 'section') {
    return {
      id: mintId('sec'),
      kind: 'section',
      props: cloneJson(SECTION_DEFAULTS),
      style: { desktop: { paddingTop: 40, paddingBottom: 40 } },
      children: [createNode('column')]
    };
  }
  if (kind === 'column') return { id: mintId('col'), kind: 'column', props: {}, style: { desktop: {} }, children: [] };
  if (kind === 'widget') {
    if (typeof type !== 'string' || !Object.hasOwn(WIDGET_REGISTRY, type)) {
      throw new TypeError(`createNode: ${quote(type)} is not a widget type`);
    }
    const def = WIDGET_REGISTRY[type];
    return { id: mintId(type), kind: 'widget', type, props: cloneJson(def.defaultProps), style: cloneJson(def.defaultStyle) };
  }
  throw new TypeError(`createNode: ${quote(kind)} is not section, column or widget`);
}

/** A node's props with every absent prop filled from its defaults, as the renderer reads them. */
export function propsWithDefaults(node) {
  if (!isPlainObject(node)) return {};
  const own = isPlainObject(node.props) ? node.props : {};
  if (node.kind === 'section') return { ...cloneJson(SECTION_DEFAULTS), ...cloneJson(own) };
  if (node.kind === 'widget' && typeof node.type === 'string' && Object.hasOwn(WIDGET_REGISTRY, node.type)) {
    return { ...cloneJson(WIDGET_REGISTRY[node.type].defaultProps), ...cloneJson(own) };
  }
  return cloneJson(own);
}

/** An empty page: version, a theme (DEFAULT_THEME with `theme` laid over it) and no sections. */
export function createEmptyPage(theme) {
  const over = isPlainObject(theme) ? theme : {};
  const merged = { ...cloneJson(DEFAULT_THEME), ...cloneJson(over) };
  merged.colors = { ...cloneJson(DEFAULT_THEME.colors), ...(isPlainObject(over.colors) ? cloneJson(over.colors) : {}) };
  merged.fonts = { ...cloneJson(DEFAULT_THEME.fonts), ...(isPlainObject(over.fonts) ? cloneJson(over.fonts) : {}) };
  return { version: BUILDER_VERSION, theme: merged, sections: [] };
}

// ---- Converting a page made with the simple editor ----

/**
 * Instructions earlier versions stored as copy values (lowercase). The published page leaves them
 * out, so a converted page does too. Held equal to STARTER_TEXT in src/lib/stepDefaults.ts by
 * page-builder-model.test.mjs: this file cannot import TypeScript.
 */
export const LEGACY_STARTER_TEXT = Object.freeze([
  'describe what the visitor gets.',
  'describe the offer in words you can stand behind.',
  'describe the add-on in words you can stand behind.',
  'first point you can stand behind',
  'second point you can stand behind',
  'tell your customer what happens next.',
  'new value point'
]);

/**
 * Variant ids from the sample catalog and old blueprints. A product picked with one has an
 * invented name, price and image, which the published page drops. Held equal to DEMO_VARIANT_IDS
 * (src/lib/productPickerCatalog.ts) and FAKE_VARIANT_IDS (server/routes/authWorkspaceRoutes.mjs)
 * by page-builder-model.test.mjs.
 */
export const LEGACY_PLACEHOLDER_VARIANT_IDS = Object.freeze([
  '42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999',
  '42109840101', '42109840102', '42109840201', '42109840202', '42109840301', '42109840302',
  '42109840401', '42109840501', '42109840502'
]);

// Seeded sample lines the published page drops (publicRoutes.mjs trustBadge and scarcitySeed,
// pagePreviewCopy.ts SEEDED_TRUST and SEEDED_SCARCITY). The test pins the behaviour against
// previewPageCopy.
export const SEEDED_TRUST = /4\.9\/5|verified (beauty lovers|customers|buyers|clients)/i;
const SEEDED_SCARCITY = /hand-blended batch #22|only 14 units remaining/i;

const text = v => (typeof v === 'string' ? v : '');
const anId = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const isStarter = v => typeof v === 'string' && LEGACY_STARTER_TEXT.includes(v.trim().toLowerCase());
const ownCopy = v => (typeof v === 'string' && !isStarter(v) ? v.trim() : '');
const ownCopyList = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s.trim() !== '' && !isStarter(s)) : []);
const placeholderVariant = v => {
  const id = anId(v).trim();
  return id !== '' && LEGACY_PLACEHOLDER_VARIANT_IDS.includes(id);
};
/** A link the builder accepts, or '' for one it refuses. The flat field keeps the original. */
const linkOrEmpty = v => (typeof v === 'string' && v !== '' && urlProblem(v) === null ? v : '');
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function legacyWidget(id, type, props, style) {
  return { id, kind: 'widget', type, props: { ...cloneJson(WIDGET_REGISTRY[type].defaultProps), ...props }, style: style || cloneJson(WIDGET_REGISTRY[type].defaultStyle) };
}

function legacySection(id, label, props, style, columns) {
  return { id, kind: 'section', props: { ...cloneJson(SECTION_DEFAULTS), label, ...props }, style, children: columns };
}

function legacyColumn(id, style, widgets) {
  return { id, kind: 'column', props: {}, style, children: widgets };
}

/**
 * Converts a page made with the simple editor (PageNodeData) into a builder document that shows
 * what the published page shows today. Pure, deterministic (the same page gives the same ids) and
 * never throws: anything that is not an object reads as an empty page. The flat fields are not
 * touched, so the conversion can be undone until the builder page is published.
 *
 * Copy is the merchant's own, carried as written. What today's page already leaves out stays
 * out: instructions saved as values (LEGACY_STARTER_TEXT), the seeded sample trust and stock
 * lines, and the name, price and image of a product picked with a placeholder variant. Words the
 * page shows only when a field is empty (Continue, Customer reviews and the rest) are not written
 * into props: they are the widgets' `fallbacks`. A link the builder refuses (not http(s) or
 * site-relative) is left empty in the widget. A number outside a widget's range is clamped to it.
 *
 * Sections, top to bottom:
 *
 * 1. Countdown (`legacy-countdown`), only when urgencyTimerEnabled is on and urgencyMinutes is a
 *    positive number, as today:
 *    - urgencyText    -> countdown `legacy-countdown-timer` props.text
 *    - urgencyMinutes -> countdown props.minutes (mode evergreen, one clock per visitor)
 * 2. Offer (`legacy-offer`), always: today's offer card, two columns.
 *    Product column `legacy-offer-media`:
 *    - shopifyProductId    -> productHero `legacy-product` props.productId
 *    - shopifyVariantId    -> productHero props.variantId
 *    - shopifyCollectionId -> productHero props.collectionId
 *    - shopifyProductTitle -> productHero props.title (empty for a placeholder variant)
 *    - shopifyProductPrice -> productHero props.price (empty for a placeholder variant)
 *    - shopifyProductImage -> productHero props.productImage (empty for a placeholder variant)
 *    - heroImageUrl        -> productHero props.imageUrl
 *    Copy column `legacy-offer-copy`, in today's order:
 *    - scarcityBatchText   -> stockCount `legacy-stock` props.text, and scarcityBatchCount ->
 *      props.count; the widget exists only when scarcityBatchEnabled is on and the page shows a
 *      stock line (a seeded sample line shows none)
 *    - headline            -> heading `legacy-headline` props.text (level 1)
 *    - subhead             -> text `legacy-subhead` props.text, when the page shows one
 *    - bullets             -> iconList `legacy-bullets` props.items[n].text, when the page shows any
 *    - trustBadge          -> trustBadge `legacy-trust` props.text, when the page shows one
 *    - orderBumpEnabled    -> an orderBump `legacy-bump` exists only when it is true, and
 *      orderBumpProductId, orderBumpVariantId, orderBumpHeadline, orderBumpDescription,
 *      orderBumpTitle, orderBumpPrice, orderBumpImage -> its props productId, variantId, headline,
 *      description, title, price, image (title, price and image empty for a placeholder variant)
 *    - buttonText          -> checkoutButton `legacy-checkout` props.label
 *    - discountCode        -> checkoutButton props.discountCode
 *    - checkoutMode        -> checkoutButton props.checkoutMode (lead-gate, else direct)
 *    - cartAction          -> checkoutButton props.cartAction (add, else checkout)
 * 3. Reviews (`legacy-reviews`), unless socialProofWallEnabled is false (it is on by default):
 *    - socialProofHeadline     -> reviewsWall `legacy-reviews-wall` props.headline
 *    - socialProofMinRating    -> reviewsWall props.minRating (4 when unset, as today)
 *    - socialProofPhotosEnabled -> reviewsWall props.photos (on unless false)
 *
 * Version B: with `{ variant: 'b' }` the variantB fields are laid over version A the way the live
 * page lays them (headline, subhead, bullets, buttonText, heroImageUrl, discountCode, trustBadge),
 * and land in the same props. The ids are the same in both documents.
 *
 * Not converted, because the fixed frame around the blocks reads them from the node: slug and
 * label, pixels (metaPixelId, tiktokPixelId, ga4TrackingId), exit intent (exitIntent*), the
 * mobile sticky bar, cookie consent and privacyPolicyUrl, A/B settings (abTestingEnabled,
 * splitRatio, variantB itself), publishing and domains, metrics. Not converted because today's
 * page never reads them: postSubmitAction, customRedirectUrl, postSubmitExperience, checkoutUrl.
 */
export function migrateLegacyPage(pageData, options) {
  const raw = isPlainObject(pageData) ? pageData : {};
  const useB = isPlainObject(options) && options.variant === 'b' && isPlainObject(raw.variantB);
  const vB = useB ? raw.variantB : {};

  // The merge renderPublicFunnelHtml makes for the version it serves.
  const headline = text(vB.headline) || text(raw.headline);
  const subhead = ownCopy(vB.subhead) || ownCopy(raw.subhead);
  const bullets = ownCopyList(vB.bullets).length ? ownCopyList(vB.bullets) : ownCopyList(raw.bullets);
  const buttonText = text(vB.buttonText) || text(raw.buttonText);
  const heroImageUrl = text(vB.heroImageUrl) || text(raw.heroImageUrl);
  const discountCode = text(vB.discountCode !== undefined ? vB.discountCode : raw.discountCode);
  const trustSaved = text(vB.trustBadge) || text(raw.trustBadge);
  const trustBadge = SEEDED_TRUST.test(trustSaved) ? '' : trustSaved;

  const placeholderProduct = placeholderVariant(raw.shopifyVariantId);

  const sections = [];

  // 1. Countdown
  const minutesRaw = Number(raw.urgencyMinutes);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 0;
  if (raw.urgencyTimerEnabled && minutes > 0) {
    sections.push(legacySection('legacy-countdown', 'Countdown', { contentWidth: 'full' }, { desktop: { paddingTop: 0, paddingBottom: 0 } }, [
      legacyColumn('legacy-countdown-col', { desktop: {} }, [
        legacyWidget('legacy-countdown-timer', 'countdown', {
          text: text(raw.urgencyText),
          mode: 'evergreen',
          minutes: clamp(minutes, 0, COUNTDOWN_MAX_MINUTES)
        })
      ])
    ]));
  }

  // 2. Offer
  const copyWidgets = [];

  const scarcitySaved = text(raw.scarcityBatchText).trim();
  const scarcitySeeded = SEEDED_SCARCITY.test(scarcitySaved);
  const scarcityCount = Number(raw.scarcityBatchCount);
  const scarcityCountSet = raw.scarcityBatchCount !== undefined && raw.scarcityBatchCount !== null &&
    String(raw.scarcityBatchCount) !== '' && Number.isFinite(scarcityCount) && scarcityCount > 0;
  const stockText = scarcitySaved && !scarcitySeeded ? scarcitySaved : '';
  const stockCount = scarcityCountSet && !scarcitySeeded ? clamp(scarcityCount, 0, STOCK_MAX) : 0;
  if (raw.scarcityBatchEnabled && (stockText || stockCount > 0)) {
    copyWidgets.push(legacyWidget('legacy-stock', 'stockCount', { text: stockText, count: stockCount }));
  }

  copyWidgets.push(legacyWidget('legacy-headline', 'heading', { text: headline, level: 1 }));
  if (subhead) copyWidgets.push(legacyWidget('legacy-subhead', 'text', { text: subhead }));
  if (bullets.length) copyWidgets.push(legacyWidget('legacy-bullets', 'iconList', { icon: 'check', items: bullets.map(b => ({ text: b })) }));
  if (trustBadge) copyWidgets.push(legacyWidget('legacy-trust', 'trustBadge', { text: trustBadge }));

  if (raw.orderBumpEnabled === true) {
    const placeholderBump = placeholderVariant(raw.orderBumpVariantId);
    copyWidgets.push(legacyWidget('legacy-bump', 'orderBump', {
      productId: anId(raw.orderBumpProductId),
      variantId: anId(raw.orderBumpVariantId),
      headline: text(raw.orderBumpHeadline),
      description: text(raw.orderBumpDescription),
      title: placeholderBump ? '' : text(raw.orderBumpTitle),
      price: placeholderBump ? '' : text(raw.orderBumpPrice),
      image: placeholderBump ? '' : linkOrEmpty(raw.orderBumpImage)
    }));
  }

  copyWidgets.push(legacyWidget('legacy-checkout', 'checkoutButton', {
    label: buttonText,
    discountCode,
    checkoutMode: raw.checkoutMode === 'lead-gate' ? 'lead-gate' : 'direct',
    cartAction: raw.cartAction === 'add' ? 'add' : 'checkout'
  }));

  const product = legacyWidget('legacy-product', 'productHero', {
    productId: anId(raw.shopifyProductId),
    variantId: anId(raw.shopifyVariantId),
    collectionId: anId(raw.shopifyCollectionId),
    title: placeholderProduct ? '' : text(raw.shopifyProductTitle),
    price: placeholderProduct ? '' : text(raw.shopifyProductPrice),
    productImage: placeholderProduct ? '' : linkOrEmpty(raw.shopifyProductImage),
    imageUrl: linkOrEmpty(heroImageUrl)
  });

  // Today's offer card: surface background, a hairline border, 20px corners, 24px padding on a
  // phone and 36px from 720px up.
  const card = {
    desktop: {
      backgroundColor: 'theme.surface', borderWidth: 1, borderStyle: 'solid', borderColor: '#ffffff14', borderRadius: 20,
      shadow: 'lg', paddingTop: 36, paddingRight: 36, paddingBottom: 36, paddingLeft: 36
    },
    mobile: { paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }
  };
  sections.push(legacySection('legacy-offer', 'Offer', { columnGap: 36, stackOn: 'mobile' }, card, [
    legacyColumn('legacy-offer-media', { desktop: { width: 48 } }, [product]),
    legacyColumn('legacy-offer-copy', { desktop: { width: 52 } }, copyWidgets)
  ]));

  // 3. Reviews
  if (raw.socialProofWallEnabled !== false) {
    const ratingRaw = Number(raw.socialProofMinRating) || 4;
    sections.push(legacySection('legacy-reviews', 'Reviews', {}, { desktop: { paddingTop: 24, paddingBottom: 24 } }, [
      legacyColumn('legacy-reviews-col', { desktop: {} }, [
        legacyWidget('legacy-reviews-wall', 'reviewsWall', {
          headline: text(raw.socialProofHeadline),
          minRating: clamp(ratingRaw, 1, 5),
          photos: raw.socialProofPhotosEnabled !== false
        })
      ])
    ]));
  }

  return { version: BUILDER_VERSION, theme: cloneJson(DEFAULT_THEME), sections };
}
