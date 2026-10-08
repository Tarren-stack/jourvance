// The page builder canvas's pure parts (LANDING_BUILDER_DESIGN.md sections 3 and 7): what it does
// to the renderer's HTML before the shadow root gets it, which element inside a widget each
// in-place editable prop is drawn in, and the hint an empty widget shows in the editor only.
//
// No React and no DOM, so `node --test` loads it as it is.

import { WIDGET_REGISTRY } from '../../lib/pageBuilder/model.mjs';
import type { BuilderDevice, BuilderWidget, WidgetType } from '../../types/pageBuilder';

/**
 * The width each device's page is DRAWN at, in CSS pixels, whatever room the frame has. Desktop and
 * tablet are drawn at their design width and scaled down to fit (`canvasScale`), as page builders do,
 * so the page lays out as a desktop page does even in a narrow window. Mobile is drawn as it is.
 */
export const DESIGN_WIDTHS: Readonly<Record<BuilderDevice, number>> = Object.freeze({ desktop: 1280, tablet: 1024, mobile: 390 });

/** The smallest the canvas is ever scaled to: below this a page cannot be read at all. */
export const MIN_CANVAS_SCALE = 0.1;

/**
 * How much the page is scaled to fit `available` CSS pixels of frame: never above 1 (a page is not
 * blown up), never for mobile (a phone-sized page is drawn at its own size and the frame scrolls),
 * and 1 when the room is not known yet.
 */
export function canvasScale(device: BuilderDevice, available: number): number {
  if (device === 'mobile') return 1;
  if (!Number.isFinite(available) || available <= 0) return 1;
  const raw = Math.min(1, available / DESIGN_WIDTHS[device]);
  return Math.round(Math.max(MIN_CANVAS_SCALE, raw) * 10000) / 10000;
}

/**
 * The renderer writes no script (render.mjs rule 5, pinned by page-builder-dropzones.test.mjs), and
 * the canvas strips any anyway, with everything inside it, before the markup is parsed. The parse
 * itself happens in an inert <template>, and the canvas then removes event handler attributes and
 * javascript: links from what it holds, so nothing the page carries runs in the cockpit.
 */
export function stripScripts(html: string): string {
  return String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>?/gi, '');
}

/** Attribute names the canvas removes from every element: event handlers. */
export const isHandlerAttribute = (name: string): boolean => /^on/i.test(name);

/** A link value the canvas removes: a script or data address, however it is spelled. */
export function isUnsafeUrl(value: string): boolean {
  const v = String(value ?? '').replace(/[\u0000- \u007f]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:text/html');
}

/**
 * One prop the canvas edits in place, and the element it is drawn in. `selector` is read inside the
 * widget's own element (":scope" is that element). A list prop (`items.*.text`) names the element of
 * each item and the field the renderer keeps items by: it leaves out an item whose field is empty,
 * so the third item drawn is not always items[2].
 */
export interface InlineTarget {
  /** The registry's inline path: `text`, or `items.*.quote`. */
  path: string;
  selector: string;
  list?: { prop: string; field: string; keepField: string; itemSelector: string };
}

const one = (path: string, selector: string): InlineTarget => ({ path, selector });
const item = (prop: string, field: string, keepField: string, itemSelector: string, selector: string): InlineTarget => ({
  path: `${prop}.*.${field}`,
  selector,
  list: { prop, field, keepField, itemSelector }
});

/** Every in-place editable prop the registry names, and where render.mjs draws it. */
export const INLINE_TARGETS: Readonly<Partial<Record<WidgetType, InlineTarget[]>>> = Object.freeze({
  heading: [one('text', ':scope')],
  text: [one('text', ':scope')],
  image: [one('caption', 'figcaption')],
  button: [one('label', ':scope')],
  iconList: [item('items', 'text', 'text', ':scope > li', ':scope > span:last-child')],
  testimonials: [
    item('items', 'quote', 'quote', ':scope > .jvb-tm', 'blockquote > p'),
    item('items', 'name', 'quote', ':scope > .jvb-tm', '.jvb-tm-name'),
    item('items', 'role', 'quote', ':scope > .jvb-tm', '.jvb-tm-role')
  ],
  faq: [
    item('items', 'question', 'question', ':scope > .jvb-faq-item', 'summary'),
    item('items', 'answer', 'question', ':scope > .jvb-faq-item', '.jvb-faq-a')
  ],
  countdown: [one('text', '.jvb-countdown-label')],
  leadForm: [one('heading', '.jvb-lead-title'), one('buttonText', 'button[type="submit"]')],
  checkoutButton: [one('label', 'button')],
  orderBump: [one('headline', '.jvb-bump-title'), one('description', '.jvb-bump-desc > p')],
  reviewsWall: [one('headline', '.jvb-reviews-title')],
  stockCount: [one('text', '.jvb-stock > span:last-child')],
  trustBadge: [one('text', ':scope > span')]
});

/** The index in the prop list of the `drawn`th item the renderer drew (it skips items whose keep field is blank). */
export function itemPropIndex(items: unknown, keepField: string, drawn: number): number {
  if (!Array.isArray(items)) return -1;
  let seen = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const v = it && typeof it === 'object' ? (it as Record<string, unknown>)[keepField] : '';
    if (typeof v === 'string' && v.trim() !== '') {
      seen += 1;
      if (seen === drawn) return i;
    }
  }
  return -1;
}

/** The prop's label, for the inline textbox's accessible name. */
export function inlineLabel(type: WidgetType, path: string): string {
  const def = (WIDGET_REGISTRY as unknown as Record<string, { props: Record<string, { label: string; item?: Record<string, { label: string }> }> }>)[type];
  if (!def) return 'Text';
  const [prop, , field] = path.split('.');
  const spec = def.props[prop];
  if (!spec) return 'Text';
  if (field && spec.item?.[field]) return spec.item[field].label;
  return spec.label;
}

/** Whether a prop takes more than one line (Enter then commits and Shift+Enter breaks the line). */
export function inlineMultiline(type: WidgetType, path: string): boolean {
  const def = (WIDGET_REGISTRY as unknown as Record<string, { props: Record<string, { multiline?: boolean; item?: Record<string, { multiline?: boolean }> }> }>)[type];
  if (!def) return false;
  const [prop, , field] = path.split('.');
  const spec = def.props[prop];
  if (!spec) return false;
  if (field) return spec.item?.[field]?.multiline === true;
  return spec.multiline === true;
}

/** The value a prop holds now, read the way the inline editor starts from it. */
export function inlineValue(widget: BuilderWidget, target: InlineTarget, propIndex: number): string {
  const props = (widget.props || {}) as Record<string, unknown>;
  if (target.list) {
    const list = props[target.list.prop];
    const it = Array.isArray(list) ? list[propIndex] : null;
    const v = it && typeof it === 'object' ? (it as Record<string, unknown>)[target.list.field] : '';
    return typeof v === 'string' ? v : '';
  }
  const v = props[target.path];
  return typeof v === 'string' ? v : '';
}

/** The props patch an inline edit writes: the one prop, or the whole list with one item's field changed. */
export function inlinePatch(widget: BuilderWidget, target: InlineTarget, propIndex: number, value: string): Record<string, unknown> | null {
  const props = (widget.props || {}) as Record<string, unknown>;
  if (!target.list) return { [target.path]: value };
  const list = props[target.list.prop];
  if (!Array.isArray(list) || propIndex < 0 || propIndex >= list.length) return null;
  const next = list.map((it, i) => (i === propIndex ? { ...(it as Record<string, unknown>), [target.list!.field]: value } : it));
  return { [target.list.prop]: next };
}

/** What a single-line prop keeps from typed text: line breaks become spaces. */
export function cleanInlineText(value: string, multiline: boolean): string {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  return multiline ? text.replace(/\n+$/, '') : text.replace(/\n+/g, ' ');
}

/**
 * What an empty widget shows on the canvas, and only there: the published page shows nothing for it
 * (design section 1, "An empty heading, text, image or list renders nothing").
 */
export const EMPTY_HINTS: Readonly<Record<WidgetType, string>> = Object.freeze({
  heading: 'Empty heading. Double-click to write it.',
  text: 'Empty text. Double-click to write it.',
  image: 'No image yet. Add its address in the panel.',
  button: 'Button with no label. Double-click to write it.',
  spacer: 'Space',
  divider: 'Line',
  video: 'No video yet. Paste a YouTube or Vimeo address in the panel.',
  htmlEmbed: 'No HTML yet. Add it in the panel.',
  iconList: 'No points yet. Add them in the panel.',
  testimonials: 'No testimonials yet. Add them in the panel.',
  faq: 'No questions yet. Add them in the panel.',
  countdown: 'Countdown off. Set its minutes or an end date in the panel.',
  leadForm: 'Lead form',
  productHero: 'No product yet. Pick one or add an image in the panel.',
  checkoutButton: 'Checkout button',
  orderBump: 'Order bump. Shows once a real add-on product is linked in the panel.',
  reviewsWall: 'Reviews wall. Shows your verified reviews once you have some.',
  stockCount: 'No stock line yet. Write it or set the units left in the panel.',
  trustBadge: 'Empty trust line. Double-click to write it.'
});

/**
 * The editor's own look inside the shadow root. Hints and outlines only; never the page's look. A hint's
 * backdrop is OPAQUE: it sits on the merchant's own page colour, and a translucent one over a white page
 * left its text at 2.7 to 1.
 */
export const EDITOR_CSS = [
  ':host{display:block}',
  '#jvb-root{min-height:100%}',
  // The page's links, buttons and fields stay drawn but take no pointer: a click selects the block.
  '#jvb-root :is(a,button,input,select,textarea,summary,label,iframe,details){pointer-events:none}',
  '#jvb-root [data-jvbe-editing]{pointer-events:auto;cursor:text;white-space:pre-wrap;-webkit-user-select:text;user-select:text;outline:2px solid #818CF8;outline-offset:3px}',
  '#jvb-root .jvb-col:empty{min-height:72px;outline:1px dashed rgba(148,163,184,.55);outline-offset:-6px}',
  '#jvb-root .jvbe-empty{display:block;padding:12px 14px;border:1px dashed rgba(148,163,184,.65);border-radius:8px;color:#CBD5E1;background-color:#0F172A;font:500 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;text-align:left}',
  '#jvb-root .jvbe-empty[data-jvbe-hidden]{display:none}'
].join('\n');
