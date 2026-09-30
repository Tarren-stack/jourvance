/**
 * Hand-written accessibility rules for the journey map browser check (#11).
 *
 * The browser only collects facts (scripts/canvas-browser-check.mjs); every judgement lives here,
 * as pure functions a node test can drive. Each rule is named after the axe-core rule it imitates
 * so a later swap to axe keeps the same vocabulary, but these are NOT axe: they are a WCAG A and AA
 * subset, and the report says so in words.
 *
 * No imports and erasable TypeScript only (no enum, namespace or parameter properties), so Node
 * can strip the types and the tests can import this file directly. The tables are plain arrays
 * and objects because they are handed to page.evaluate, which cannot carry a Set.
 */

export const A11Y_RULES = [
  'button-name',
  'link-name',
  'label',
  'image-alt',
  'aria-command-name',
  'aria-toggle-field-name',
  'aria-input-field-name',
  'aria-valid-attr',
  'aria-valid-attr-value',
  'aria-allowed-attr',
  'aria-prohibited-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-hidden-focus',
  'nested-interactive',
  'list',
  'listitem',
  'scrollable-region-focusable',
  'color-contrast',
  'target-size',
  'html-has-lang',
  'document-title',
  'meta-viewport'
] as const;

export type A11yRule = (typeof A11Y_RULES)[number];

// ---- Facts the collector fills ----

/**
 * What decides which name rule applies: a native button, a link, a form field with a native
 * label, an image, or an element that took an ARIA role (command, toggle or input field).
 */
export type NameKind = 'button' | 'link' | 'label' | 'image' | 'command' | 'toggle' | 'input-field';

export interface NameFacts {
  where: string;
  kind: NameKind;
  /** Text of the elements aria-labelledby points at, joined. Empty when absent. */
  labelledby: string;
  ariaLabel: string | null;
  /** Text of the native <label> elements tied to the field, joined. */
  labels: string;
  /** alt for an image input, value for a button input. Null when there is none. */
  native: string | null;
  /** Text content, with aria-hidden children left out. */
  content: string;
  title: string | null;
  placeholder: string | null;
  /** The raw alt attribute of an <img>, null when missing. */
  altAttr: string | null;
}

export interface AriaFacts {
  where: string;
  tag: string;
  /** The effective role: the explicit one, else the tag's implicit role. */
  role: string;
  attrs: { name: string; value: string }[];
  /** ID reference attributes where none of the ids exist in the page. */
  missingIds: string[];
}

export interface StructureFacts {
  where: string;
  role: string;
  /** True when the role came from a role attribute rather than the tag. */
  explicit: boolean;
  /** Roles of the owned children, looking through generic wrappers. Null when not collected. */
  ownedRoles: string[] | null;
  /** Role of the nearest ancestor that is not a generic wrapper. Null when there is none. */
  contextRole: string | null;
  /** A focusable element inside an aria-hidden="true" subtree. */
  ariaHiddenFocusable: boolean;
  /** A focusable element inside a role whose children are presentational (a button in a button). */
  interactiveAncestor: boolean;
}

export interface ListFacts {
  where: string;
  tag: 'ul' | 'ol' | 'li';
  /** For ul and ol: tags of the direct children that are not li, script or template. */
  badChildren: string[];
  /** For li: whether the parent is a list. */
  parentOk: boolean;
}

export interface TargetFacts {
  where: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A link inside a sentence, which the target-size rule exempts. */
  inline: boolean;
}

export interface ScrollRegionFacts {
  where: string;
  focusable: boolean;
  hasFocusableDescendant: boolean;
}

export interface TextSample {
  where: string;
  color: string;
  /** Background colours from the text's element up through its ancestors. */
  layers: string[];
  /** Why the colour behind the text cannot be read from the ancestor chain, or null. */
  blockedBy: string | null;
  fontSizePx: number;
  fontWeight: number;
}

export interface DocumentFacts {
  lang: string;
  title: string;
  viewportContent: string | null;
}

export interface A11yFacts {
  names: NameFacts[];
  aria: AriaFacts[];
  structure: StructureFacts[];
  lists: ListFacts[];
  targets: TargetFacts[];
  scrollRegions: ScrollRegionFacts[];
  texts: TextSample[];
  document: DocumentFacts | null;
}

export interface A11yFinding {
  rule: A11yRule;
  where: string;
  detail: string;
}

export interface A11yUnmeasured {
  rule: A11yRule;
  where: string;
  reason: string;
}

// ---- Tables (plain data, passed into the browser) ----

export type AriaValueType =
  | 'boolean'
  | 'tristate'
  | 'true-false-undefined'
  | 'idref'
  | 'idrefs'
  | 'integer'
  | 'number'
  | 'string'
  | 'token';

/** Every ARIA 1.2 attribute and the kind of value it takes. */
export const ARIA_ATTRIBUTES: Record<string, AriaValueType> = {
  'aria-activedescendant': 'idref',
  'aria-atomic': 'boolean',
  'aria-autocomplete': 'token',
  'aria-braillelabel': 'string',
  'aria-brailleroledescription': 'string',
  'aria-busy': 'boolean',
  'aria-checked': 'tristate',
  'aria-colcount': 'integer',
  'aria-colindex': 'integer',
  'aria-colindextext': 'string',
  'aria-colspan': 'integer',
  'aria-controls': 'idrefs',
  'aria-current': 'token',
  'aria-describedby': 'idrefs',
  'aria-description': 'string',
  'aria-details': 'idrefs',
  'aria-disabled': 'boolean',
  'aria-dropeffect': 'string',
  'aria-errormessage': 'idrefs',
  'aria-expanded': 'true-false-undefined',
  'aria-flowto': 'idrefs',
  'aria-grabbed': 'true-false-undefined',
  'aria-haspopup': 'token',
  'aria-hidden': 'true-false-undefined',
  'aria-invalid': 'token',
  'aria-keyshortcuts': 'string',
  'aria-label': 'string',
  'aria-labelledby': 'idrefs',
  'aria-level': 'integer',
  'aria-live': 'token',
  'aria-modal': 'boolean',
  'aria-multiline': 'boolean',
  'aria-multiselectable': 'boolean',
  'aria-orientation': 'token',
  'aria-owns': 'idrefs',
  'aria-placeholder': 'string',
  'aria-posinset': 'integer',
  'aria-pressed': 'tristate',
  'aria-readonly': 'boolean',
  'aria-relevant': 'string',
  'aria-required': 'boolean',
  'aria-roledescription': 'string',
  'aria-rowcount': 'integer',
  'aria-rowindex': 'integer',
  'aria-rowindextext': 'string',
  'aria-rowspan': 'integer',
  'aria-selected': 'true-false-undefined',
  'aria-setsize': 'integer',
  'aria-sort': 'string',
  'aria-valuemax': 'number',
  'aria-valuemin': 'number',
  'aria-valuenow': 'number',
  'aria-valuetext': 'string'
};

export const ARIA_TOKEN_VALUES: Record<string, string[]> = {
  'aria-haspopup': ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'],
  'aria-live': ['off', 'polite', 'assertive'],
  'aria-current': ['page', 'step', 'location', 'date', 'time', 'true', 'false'],
  'aria-orientation': ['horizontal', 'vertical', 'undefined'],
  'aria-invalid': ['grammar', 'false', 'spelling', 'true'],
  'aria-autocomplete': ['inline', 'list', 'both', 'none']
};

/** The roles that may carry each state, per ARIA 1.2. */
export const ATTR_ALLOWED_ROLES: Record<string, string[]> = {
  'aria-pressed': ['button'],
  'aria-checked': ['checkbox', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'switch', 'treeitem'],
  'aria-selected': ['columnheader', 'gridcell', 'option', 'row', 'rowheader', 'tab', 'treeitem'],
  'aria-expanded': [
    'application', 'button', 'checkbox', 'columnheader', 'combobox', 'gridcell', 'link', 'listbox',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'row', 'rowheader', 'switch', 'tab', 'treeitem'
  ]
};

/**
 * Implicit roles for the tags the surfaces use. Keys are a tag, `tag[type]` for inputs, or
 * `a[href]`; an element with no entry is 'generic'.
 */
export const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  'a[href]': 'link',
  a: 'generic',
  article: 'article',
  aside: 'complementary',
  b: 'generic',
  button: 'button',
  code: 'code',
  dialog: 'dialog',
  div: 'generic',
  em: 'emphasis',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner',
  hr: 'separator',
  i: 'generic',
  img: 'img',
  'input[button]': 'button',
  'input[checkbox]': 'checkbox',
  'input[email]': 'textbox',
  'input[image]': 'button',
  'input[number]': 'spinbutton',
  'input[radio]': 'radio',
  'input[range]': 'slider',
  'input[reset]': 'button',
  'input[search]': 'searchbox',
  'input[submit]': 'button',
  'input[tel]': 'textbox',
  'input[text]': 'textbox',
  'input[url]': 'textbox',
  input: 'textbox',
  label: 'generic',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  p: 'paragraph',
  section: 'region',
  select: 'combobox',
  small: 'generic',
  span: 'generic',
  strong: 'strong',
  svg: 'graphics-document',
  table: 'table',
  textarea: 'textbox',
  ul: 'list'
};

/** Roles that may not be named with aria-label or aria-labelledby. */
export const NAME_PROHIBITED_ROLES: string[] = ['generic', 'presentation', 'none', 'paragraph', 'strong', 'emphasis', 'code'];

/** A container role and the child roles it needs at least one of. */
export const REQUIRED_CHILDREN: Record<string, string[]> = {
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  tablist: ['tab'],
  listbox: ['option', 'group'],
  list: ['listitem']
};

/** A role and the parents it must sit in. */
export const REQUIRED_CONTEXT: Record<string, string[]> = {
  menuitem: ['menu', 'menubar', 'group'],
  menuitemcheckbox: ['menu', 'menubar', 'group'],
  menuitemradio: ['menu', 'menubar', 'group'],
  tab: ['tablist'],
  option: ['listbox', 'group'],
  listitem: ['list']
};

/** Roles whose children are presentational, so a focusable child is a control in a control. */
export const CHILDREN_PRESENTATIONAL_ROLES: string[] = [
  'button', 'checkbox', 'img', 'math', 'menuitemcheckbox', 'menuitemradio', 'meter', 'option',
  'progressbar', 'radio', 'scrollbar', 'separator', 'slider', 'switch', 'tab'
];

/** Wrappers the structure rules look through. */
export const GENERIC_ROLES: string[] = ['generic', 'none', 'presentation'];

/** Everything the collector needs, in one object for page.evaluate. */
export const A11Y_TABLES = {
  ariaAttributes: ARIA_ATTRIBUTES,
  implicitRoleByTag: IMPLICIT_ROLE_BY_TAG,
  requiredChildren: REQUIRED_CHILDREN,
  requiredContext: REQUIRED_CONTEXT,
  childrenPresentationalRoles: CHILDREN_PRESENTATIONAL_ROLES,
  genericRoles: GENERIC_ROLES
};

// ---- Colour ----

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const channel = (raw: string, scale: number): number | null => {
  const s = raw.trim();
  if (!s) return null;
  const pct = s.endsWith('%');
  const n = Number(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return null;
  return pct ? (n / 100) * scale : n;
};

/**
 * Reads rgb(), rgba(), the space-and-slash form and 'transparent', which is everything Chrome's
 * computed style answers for sRGB colours. Anything else (oklch, color-mix) is null, so the
 * sample is reported as unmeasured rather than guessed.
 */
export function parseCssColor(input: string): Rgba | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const body = m[1].trim();
  let parts: string[];
  let alphaRaw: string | undefined;
  if (body.includes(',')) {
    parts = body.split(',');
    if (parts.length === 4) alphaRaw = parts.pop();
    if (body.includes('/')) return null;
  } else {
    const [rgb, alpha, extra] = body.split('/');
    if (extra !== undefined) return null;
    parts = rgb.trim().split(/\s+/);
    alphaRaw = alpha;
  }
  if (parts.length !== 3) return null;
  const [r, g, b] = parts.map(p => channel(p, 255));
  const a = alphaRaw === undefined ? 1 : channel(alphaRaw, 1);
  if (r === null || g === null || b === null || a === null) return null;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return { r: clamp(r, 255), g: clamp(g, 255), b: clamp(b, 255), a: clamp(a, 1) };
}

/** Paints `top` over `bottom` (source-over). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const luminance = (c: Rgba): number => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
};

/** The WCAG contrast ratio of two opaque colours, from 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 3:1 for large text (24px, or 18.66px at weight 700 or more), 4.5:1 otherwise. */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
}

export type ContrastVerdict =
  | { verdict: 'pass'; ratio: number; required: number }
  | { verdict: 'fail'; ratio: number; required: number }
  | { verdict: 'unmeasured'; reason: string };

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Composites the ancestor backgrounds from the first opaque one up to the text (a white page when
 * none is opaque, as axe assumes), then the text colour over that. A sample the ancestor chain
 * cannot describe is unmeasured with its reason, never a pass.
 */
export function judgeContrast(sample: TextSample): ContrastVerdict {
  if (sample.blockedBy) return { verdict: 'unmeasured', reason: sample.blockedBy };
  const text = parseCssColor(sample.color);
  const layers = sample.layers.map(parseCssColor);
  if (!text || layers.some(l => l === null)) return { verdict: 'unmeasured', reason: 'unparseable colour' };
  const stack = layers as Rgba[];
  let base = WHITE;
  let firstOpaque = stack.findIndex(l => l.a >= 1);
  if (firstOpaque === -1) firstOpaque = stack.length;
  else base = stack[firstOpaque];
  for (let i = firstOpaque - 1; i >= 0; i--) base = composite(stack[i], base);
  const shown = composite(text, base);
  const ratio = contrastRatio(shown, base);
  const required = requiredContrast(sample.fontSizePx, sample.fontWeight);
  // Two decimals, as the WCAG examples are quoted, so 4.499 does not pass as 4.5.
  const rounded = Math.floor(ratio * 100) / 100;
  return rounded >= required ? { verdict: 'pass', ratio, required } : { verdict: 'fail', ratio, required };
}

// ---- Names ----

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Kinds whose name may come from their text content. */
const NAMED_FROM_CONTENT: NameKind[] = ['button', 'link', 'command', 'toggle'];

/**
 * The accessible name in accname order: aria-labelledby, aria-label, the native label, alt or
 * value, content (only for kinds named from content), then title. A placeholder never counts: it
 * disappears as soon as someone types, and screen readers do not all read it.
 */
export function accessibleName(f: NameFacts): string {
  const candidates = [
    f.labelledby,
    f.ariaLabel,
    f.labels,
    f.native,
    NAMED_FROM_CONTENT.includes(f.kind) ? f.content : '',
    f.title
  ];
  for (const c of candidates) {
    const s = clean(c);
    if (s) return s;
  }
  return '';
}

const NAME_RULE: Record<NameKind, A11yRule> = {
  button: 'button-name',
  link: 'link-name',
  label: 'label',
  image: 'image-alt',
  command: 'aria-command-name',
  toggle: 'aria-toggle-field-name',
  'input-field': 'aria-input-field-name'
};

const NAME_DETAIL: Record<NameKind, string> = {
  button: 'This button has no name a screen reader can read. Add visible text or an aria-label.',
  link: 'This link has no name a screen reader can read. Add link text or an aria-label.',
  label: 'This field has no label. A placeholder does not count, so tie a label to it or add an aria-label.',
  image: 'This image has no alt attribute. Add alt text, or alt="" when it is decoration.',
  command: 'This control has a role but no name. Add visible text or an aria-label.',
  toggle: 'This toggle has no name, so a screen reader cannot say what it switches. Add an aria-label.',
  'input-field': 'This input has a role but no name. Add an aria-label or aria-labelledby.'
};

/** The name finding for one element, or null when it has a name. */
export function nameProblem(f: NameFacts): A11yFinding | null {
  if (f.kind === 'image') {
    // alt="" marks decoration and passes. Only a missing alt with no ARIA name fails.
    if (f.altAttr !== null) return null;
    if (clean(f.labelledby) || clean(f.ariaLabel) || clean(f.title)) return null;
    return { rule: 'image-alt', where: f.where, detail: NAME_DETAIL.image };
  }
  if (accessibleName(f)) return null;
  return { rule: NAME_RULE[f.kind], where: f.where, detail: NAME_DETAIL[f.kind] };
}

// ---- ARIA attributes ----

function valueValid(name: string, value: string): boolean {
  const type = ARIA_ATTRIBUTES[name];
  const v = value.trim();
  switch (type) {
    case 'boolean':
      return v === 'true' || v === 'false';
    case 'tristate':
      return v === 'true' || v === 'false' || v === 'mixed';
    case 'true-false-undefined':
      return v === 'true' || v === 'false' || v === 'undefined';
    case 'integer':
      return /^-?\d+$/.test(v);
    case 'number':
      return v !== '' && Number.isFinite(Number(v));
    case 'idref':
    case 'idrefs':
      return v !== '';
    case 'token':
      return (ARIA_TOKEN_VALUES[name] ?? []).includes(v.toLowerCase());
    default:
      return true;
  }
}

export function ariaProblems(f: AriaFacts): A11yFinding[] {
  const out: A11yFinding[] = [];
  for (const { name, value } of f.attrs) {
    if (!(name in ARIA_ATTRIBUTES)) {
      out.push({ rule: 'aria-valid-attr', where: f.where, detail: `${name} is not an ARIA attribute, so it does nothing. Check the spelling.` });
      continue;
    }
    if (!valueValid(name, value)) {
      out.push({ rule: 'aria-valid-attr-value', where: f.where, detail: `${name}="${value}" is not a value this attribute accepts.` });
    } else if (f.missingIds.includes(name)) {
      out.push({ rule: 'aria-valid-attr-value', where: f.where, detail: `${name} points at ids that are not in the page.` });
    }
    const allowed = ATTR_ALLOWED_ROLES[name];
    if (allowed && !allowed.includes(f.role)) {
      out.push({ rule: 'aria-allowed-attr', where: f.where, detail: `${name} is not allowed on role ${f.role}, so a screen reader ignores it. Use a role that supports it.` });
    }
    if ((name === 'aria-label' || name === 'aria-labelledby') && NAME_PROHIBITED_ROLES.includes(f.role)) {
      out.push({ rule: 'aria-prohibited-attr', where: f.where, detail: `${name} is not allowed on a ${f.role} element, so many screen readers skip it. Give the element a role or move the name to a control.` });
    }
  }
  return out;
}

// ---- Structure ----

export function structureProblems(f: StructureFacts): A11yFinding[] {
  const out: A11yFinding[] = [];
  const needs = REQUIRED_CHILDREN[f.role];
  if (f.explicit && needs && f.ownedRoles && !f.ownedRoles.some(r => needs.includes(r))) {
    out.push({ rule: 'aria-required-children', where: f.where, detail: `A ${f.role} needs at least one ${needs[0]} inside it.` });
  }
  const parents = REQUIRED_CONTEXT[f.role];
  if (f.explicit && parents && !(f.contextRole && parents.includes(f.contextRole))) {
    out.push({ rule: 'aria-required-parent', where: f.where, detail: `A ${f.role} must sit inside a ${parents[0]}.` });
  }
  if (f.ariaHiddenFocusable) {
    out.push({ rule: 'aria-hidden-focus', where: f.where, detail: 'This control can take focus but sits inside aria-hidden, so a keyboard user lands on something a screen reader cannot see.' });
  }
  if (f.interactiveAncestor) {
    out.push({ rule: 'nested-interactive', where: f.where, detail: 'This control sits inside another control, so a screen reader does not announce it. Move it out.' });
  }
  return out;
}

export function listProblems(f: ListFacts): A11yFinding[] {
  if (f.tag === 'li') {
    return f.parentOk ? [] : [{ rule: 'listitem', where: f.where, detail: 'This list item is not inside a ul or ol.' }];
  }
  return f.badChildren.length
    ? [{ rule: 'list', where: f.where, detail: `This list holds ${f.badChildren.join(', ')} directly. A list may hold only li elements.` }]
    : [];
}

export function scrollRegionProblems(f: ScrollRegionFacts): A11yFinding[] {
  return f.focusable || f.hasFocusableDescendant
    ? []
    : [{ rule: 'scrollable-region-focusable', where: f.where, detail: 'This region scrolls but nothing in it takes focus, so a keyboard user cannot scroll it. Add tabindex="0".' }];
}

// ---- Target size ----

const MIN_TARGET = 24;
const RADIUS = MIN_TARGET / 2;

const contains = (outer: TargetFacts, inner: TargetFacts) =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

/**
 * WCAG 2.5.8: a target under 24 by 24 passes only when a 24px circle on its centre touches no
 * other target (and no other undersized target's circle). A link inside a sentence is exempt, and
 * a target that wraps this one (a card holding a button) is its container, not a neighbour.
 */
export function targetSizeProblems(targets: TargetFacts[]): A11yFinding[] {
  const out: A11yFinding[] = [];
  const small = (t: TargetFacts) => t.w < MIN_TARGET || t.h < MIN_TARGET;
  for (const t of targets) {
    if (t.inline || !small(t)) continue;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const touches = targets.some(o => {
      if (o === t || o.inline) return false;
      if (contains(o, t) || contains(t, o)) return false;
      if (small(o)) {
        const ox = o.x + o.w / 2;
        const oy = o.y + o.h / 2;
        return Math.hypot(cx - ox, cy - oy) <= MIN_TARGET;
      }
      const dx = Math.max(o.x - cx, 0, cx - (o.x + o.w));
      const dy = Math.max(o.y - cy, 0, cy - (o.y + o.h));
      return Math.hypot(dx, dy) <= RADIUS;
    });
    if (touches) {
      out.push({
        rule: 'target-size',
        where: t.where,
        detail: `This target is ${Math.round(t.w)} by ${Math.round(t.h)}px and too close to another. Make it 24px or give it more space.`
      });
    }
  }
  return out;
}

// ---- Document ----

export function documentProblems(d: DocumentFacts): A11yFinding[] {
  const out: A11yFinding[] = [];
  if (!clean(d.lang)) out.push({ rule: 'html-has-lang', where: 'page', detail: 'The page has no lang attribute, so a screen reader may read it in the wrong language.' });
  if (!clean(d.title)) out.push({ rule: 'document-title', where: 'page', detail: 'The page has no title, so a tab or a screen reader cannot name it.' });
  const vp = (d.viewportContent ?? '').toLowerCase();
  const scalable = /user-scalable\s*=\s*(no|0)\b/.exec(vp);
  const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(vp);
  if (scalable || (maxScale && Number(maxScale[1]) < 2)) {
    out.push({ rule: 'meta-viewport', where: 'page', detail: 'The viewport meta tag stops zooming. Remove user-scalable=no and any maximum-scale below 2.' });
  }
  return out;
}

// ---- Everything ----

export function judgeA11y(facts: A11yFacts): { findings: A11yFinding[]; unmeasured: A11yUnmeasured[] } {
  const findings: A11yFinding[] = [];
  const unmeasured: A11yUnmeasured[] = [];
  for (const f of facts.names) {
    const p = nameProblem(f);
    if (p) findings.push(p);
  }
  for (const f of facts.aria) findings.push(...ariaProblems(f));
  for (const f of facts.structure) findings.push(...structureProblems(f));
  for (const f of facts.lists) findings.push(...listProblems(f));
  for (const f of facts.scrollRegions) findings.push(...scrollRegionProblems(f));
  findings.push(...targetSizeProblems(facts.targets));
  for (const s of facts.texts) {
    const v = judgeContrast(s);
    if (v.verdict === 'unmeasured') unmeasured.push({ rule: 'color-contrast', where: s.where, reason: v.reason });
    else if (v.verdict === 'fail') {
      findings.push({
        rule: 'color-contrast',
        where: s.where,
        detail: `This text has a contrast of ${v.ratio.toFixed(2)} to 1 and needs ${v.required} to 1. Use a lighter text colour or a darker background.`
      });
    }
  }
  if (facts.document) findings.push(...documentProblems(facts.document));
  return { findings, unmeasured };
}

// ---- Controls: every rule must fire on its planted example before any result counts ----

/** A document-level rule's control replaces the whole page, so the harness loads it on its own. */
export const A11Y_DOCUMENT_RULES: A11yRule[] = ['html-has-lang', 'document-title', 'meta-viewport'];

const GOOD_HEAD = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controls</title></head>';

export const A11Y_POSITIVE_CONTROL: { rule: A11yRule; html: string }[] = [
  { rule: 'button-name', html: '<button><svg aria-hidden="true" width="24" height="24"></svg></button>' },
  { rule: 'link-name', html: '<a href="#x" style="display:inline-block;width:30px;height:30px"></a>' },
  { rule: 'label', html: '<input type="text" placeholder="Your email">' },
  { rule: 'image-alt', html: '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="30" height="30">' },
  { rule: 'aria-command-name', html: '<div role="button" tabindex="0" style="width:30px;height:30px"></div>' },
  { rule: 'aria-toggle-field-name', html: '<div role="switch" aria-checked="false" tabindex="0" style="width:30px;height:30px"></div>' },
  { rule: 'aria-input-field-name', html: '<div role="textbox" tabindex="0" style="width:80px;height:30px"></div>' },
  { rule: 'aria-valid-attr', html: '<button aria-lable="Close">Close</button>' },
  { rule: 'aria-valid-attr-value', html: '<button aria-expanded="yes">Open</button>' },
  { rule: 'aria-allowed-attr', html: '<div aria-pressed="true">Pressed</div>' },
  { rule: 'aria-prohibited-attr', html: '<span aria-label="Total">42</span>' },
  { rule: 'aria-required-children', html: '<div role="menu" aria-label="Empty menu"><div>Nothing</div></div>' },
  { rule: 'aria-required-parent', html: '<div><button role="menuitem">Stray item</button></div>' },
  { rule: 'aria-hidden-focus', html: '<div aria-hidden="true"><button>Hidden</button></div>' },
  { rule: 'nested-interactive', html: '<div role="button" tabindex="0" aria-label="Card"><button>Inner</button></div>' },
  { rule: 'list', html: '<ul><div>Not an item</div></ul>' },
  { rule: 'listitem', html: '<div><li>Stray item</li></div>' },
  { rule: 'scrollable-region-focusable', html: '<div style="overflow:auto;height:40px;width:120px"><p style="margin:0">One</p><p style="margin:0">Two</p><p style="margin:0">Three</p><p style="margin:0">Four</p></div>' },
  { rule: 'color-contrast', html: '<p style="background:#0F172A;color:#64748B;font-size:12px;margin:0">Low contrast text</p>' },
  { rule: 'target-size', html: '<div style="position:relative;height:40px"><button aria-label="One" style="position:absolute;left:0;top:0;width:16px;height:16px;padding:0;border:0"></button><button aria-label="Two" style="position:absolute;left:24px;top:0;width:16px;height:16px;padding:0;border:0"></button></div>' },
  { rule: 'html-has-lang', html: `<!doctype html><html lang="">${GOOD_HEAD}<body><p>No language</p></body></html>` },
  { rule: 'document-title', html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title></head><body><p>No title</p></body></html>' },
  { rule: 'meta-viewport', html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"><title>Zoom off</title></head><body><p>No zoom</p></body></html>' }
];

/** Correct markup. Judged on its own page, it must produce no finding at all. */
export const A11Y_NEGATIVE_CONTROL: string = [
  '<main style="background:#0F172A;color:#FFFFFF;padding:24px">',
  '<button aria-label="Close panel" style="width:24px;height:24px;padding:0;border:0;background:#0F172A;color:#FFFFFF"><svg aria-hidden="true" width="16" height="16"></svg></button>',
  '<label for="neg-email" style="display:block;margin-top:24px">Email</label>',
  '<input id="neg-email" type="email" placeholder="you@example.com" style="height:28px;background:#FFFFFF;color:#0F172A">',
  '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="30" height="30">',
  '<p style="font-size:12px;margin:24px 0">Read the <a href="#terms" style="color:#FFFFFF">terms</a> before you start.</p>',
  '<div role="menu" aria-label="Tools" style="margin-top:24px">',
  '<button role="menuitem" style="display:block;width:120px;height:32px;margin-bottom:8px;background:#0F172A;color:#FFFFFF">Rename</button>',
  '<button role="menuitem" style="display:block;width:120px;height:32px;background:#0F172A;color:#FFFFFF">Delete</button>',
  '</div>',
  '<ul style="margin-top:24px"><li>One</li><li>Two</li></ul>',
  '<div tabindex="0" aria-label="Notes" role="region" style="overflow:auto;height:40px;width:120px"><p style="margin:0">One</p><p style="margin:0">Two</p><p style="margin:0">Three</p><p style="margin:0">Four</p></div>',
  '</main>'
].join('');

// ---- Rendered text size (T02) ----
// A computed font-size is the size before any transform. The journey map scales its whole viewport
// by the zoom, and captions and badges counter-scale on top of that, so text on the map is judged at
// the size it is DRAWN: its font-size times the vertical scale of every ancestor. The browser
// collects each ancestor's computed transform, scale and zoom; these read them.

/** One ancestor's computed transform, scale and zoom, as getComputedStyle answers them. */
export interface ScaleLayer {
  transform: string;
  scale: string;
  zoom?: string;
}

/** The vertical scale of a computed transform ('none', matrix() or matrix3d()). */
export function transformScale(transform: string): number {
  const m = /^(matrix3d|matrix)\(([^)]*)\)$/.exec(String(transform || '').trim());
  if (!m) return 1;
  const v = m[2].split(',').map(Number);
  if (v.some(n => !Number.isFinite(n))) return 1;
  // matrix(a, b, c, d, e, f): the y axis maps to (c, d). matrix3d is column-major: y is m21..m23.
  const y = m[1] === 'matrix' ? Math.hypot(v[2], v[3]) : Math.hypot(v[4], v[5], v[6]);
  return y > 0 ? y : 1;
}

/** The vertical factor of a computed `scale` ('none', 'x', 'x y' or 'x y z'; a % reads as a fraction). */
export function scaleProperty(scale: string): number {
  const parts = String(scale || '').trim().split(/\s+/).filter(p => p && p !== 'none');
  if (parts.length === 0) return 1;
  const read = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));
  const y = read(parts.length > 1 ? parts[1] : parts[0]);
  return Number.isFinite(y) && y > 0 ? y : 1;
}

/** Every ancestor's scale multiplied together: how much larger than its font-size text is drawn. */
export function renderedScale(chain: ScaleLayer[]): number {
  let s = 1;
  for (const layer of chain || []) {
    s *= transformScale(layer.transform) * scaleProperty(layer.scale);
    const z = parseFloat(String(layer.zoom ?? '1'));
    if (Number.isFinite(z) && z > 0) s *= z;
  }
  return s;
}

/** A text's size on screen, in px, to two decimals. */
export function renderedFontPx(fontSizePx: number, chain: ScaleLayer[]): number {
  return Math.round(fontSizePx * renderedScale(chain) * 100) / 100;
}
