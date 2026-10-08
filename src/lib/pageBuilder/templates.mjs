// The page builder's templates (LANDING_BUILDER_PLAN.md, Wave 3): whole pages a merchant starts from.
// Each is a factory that builds a fresh BuilderDoc from the model's createNode and the widget
// registry, so no id is typed by hand and every default is the registry's own.
//
// Words on these pages: none. A template sets structure, layout, switches and the commerce
// widgets, and leaves every heading, text, button label, point, question and quote EMPTY, so the
// canvas shows its hints and the published page shows only what the merchant writes (plus the
// registry's own fallbacks, for example "Continue" on a checkout button). The one exception is a
// SECTION'S NAME, which only the outline shows and visitors never see.
//
// Plain ESM JavaScript on purpose, like the model it builds on: the server could import it, and
// `node --test` loads it as it is. The only import is the model.

import { createEmptyPage, createNode } from './model.mjs';

// ---- Building blocks ----

/** A widget with its registry defaults, `props` laid over them and `style` laid over desktop. */
function widget(type, props = {}, style = {}) {
  const node = createNode('widget', type);
  node.props = { ...node.props, ...props };
  if (Object.keys(style).length) node.style = { ...node.style, desktop: { ...node.style.desktop, ...style } };
  return node;
}

/**
 * A section named for the outline. `columns` is a list of widget lists, one per column; `gap` and
 * the section's own style are optional. A single list is one column.
 */
function section(label, columns, { style = {}, props = {}, widths = [] } = {}) {
  const sec = createNode('section');
  sec.props = { ...sec.props, label, ...props };
  sec.style = { desktop: { ...sec.style.desktop, ...style } };
  const lists = columns.length && Array.isArray(columns[0]) ? columns : [columns];
  sec.children = lists.map((widgets, i) => {
    const col = createNode('column');
    if (widths[i]) col.style = { desktop: { width: widths[i] } };
    col.children = widgets;
    return col;
  });
  return sec;
}

const CENTER = { textAlign: 'center' };
const heading = (level = 2, style = {}) => widget('heading', { level }, style);
const text = (style = {}) => widget('text', {}, style);

/** A page: the default theme and the sections. */
function page(sections) {
  const doc = createEmptyPage();
  doc.sections = sections;
  return doc;
}

/** A dark band for a section, using a theme colour so it follows the merchant's theme. */
const BAND = { backgroundColor: 'theme.surface' };

// ---- The templates ----

/**
 * @typedef {{ id: string, name: string, group: string, description: string, build: () => import('../../types/pageBuilder').BuilderDoc }} PageTemplate
 */

/** @type {ReadonlyArray<PageTemplate>} */
export const TEMPLATES = Object.freeze([
  {
    id: 'product-drop',
    group: 'Sell',
    name: 'Product drop',
    description: 'A product with its price, a countdown, stock count and checkout, then proof and questions.',
    build: () => page([
      section('Hero', [heading(1, CENTER), text(CENTER)], { style: { paddingTop: 64, paddingBottom: 24 } }),
      section('Product', [
        [widget('productHero')],
        [
          widget('countdown'),
          widget('stockCount'),
          widget('checkoutButton'),
          widget('trustBadge')
        ]
      ]),
      section('Proof', [heading(2, CENTER), widget('testimonials')], { style: BAND }),
      section('Reviews', [widget('reviewsWall')]),
      section('Questions', [heading(2, CENTER), widget('faq')])
    ])
  },
  {
    id: 'lead-magnet',
    group: 'Capture',
    name: 'Lead magnet',
    description: 'A free offer with its points beside a sign-up form, then proof.',
    build: () => page([
      section('Hero', [
        [heading(1), text(), widget('iconList')],
        [widget('leadForm', { nameField: 'optional', phoneField: 'hidden' })]
      ], { style: { paddingTop: 64, paddingBottom: 48 } }),
      section('Proof', [heading(2, CENTER), widget('testimonials')], { style: BAND }),
      section('Questions', [heading(2, CENTER), widget('faq')])
    ])
  },
  {
    id: 'consultation-application',
    group: 'Capture',
    name: 'Consultation application',
    description: 'Who it is for and what happens next, beside an application form that asks for a name and phone.',
    build: () => page([
      section('Hero', [heading(1, CENTER), text(CENTER)], { style: { paddingTop: 64, paddingBottom: 24 } }),
      section('Application', [
        [heading(2), widget('iconList'), widget('trustBadge')],
        [widget('leadForm', { nameField: 'required', phoneField: 'required' })]
      ]),
      section('Questions', [heading(2, CENTER), widget('faq')], { style: BAND })
    ])
  },
  {
    id: 'order-bump-offer',
    group: 'Sell',
    name: 'Order bump offer',
    description: 'One product, a one-tick add-on beside the checkout button, and a returns line.',
    build: () => page([
      section('Offer', [
        [widget('productHero')],
        [
          heading(1),
          text(),
          widget('iconList'),
          widget('orderBump'),
          widget('checkoutButton'),
          widget('trustBadge')
        ]
      ], { style: { paddingTop: 56, paddingBottom: 40 } }),
      section('Reviews', [widget('reviewsWall')], { style: BAND })
    ])
  },
  {
    id: 'waitlist',
    group: 'Capture',
    name: 'Waitlist',
    description: 'A short page that collects an email for a launch that is not open yet.',
    build: () => page([
      section('Hero', [
        heading(1, CENTER),
        text(CENTER),
        widget('leadForm', { nameField: 'hidden', phoneField: 'hidden' }),
        widget('trustBadge')
      ], { style: { paddingTop: 96, paddingBottom: 96 } }),
      section('Why join', [widget('iconList')], { style: BAND })
    ])
  },
  {
    id: 'review-wall',
    group: 'Proof',
    name: 'Review wall page',
    description: 'Your verified reviews first, then quotes, then a way to buy.',
    build: () => page([
      section('Hero', [heading(1, CENTER), text(CENTER)], { style: { paddingTop: 56, paddingBottom: 16 } }),
      section('Reviews', [widget('reviewsWall', { minRating: 4, photos: true })]),
      section('Quotes', [widget('testimonials', { layout: 'grid' })], { style: BAND }),
      section('Buy', [widget('productHero'), widget('checkoutButton')], { style: { paddingTop: 48, paddingBottom: 64 } })
    ])
  },
  {
    id: 'countdown-launch',
    group: 'Launch',
    name: 'Countdown launch',
    description: 'A clock to a launch date, a sign-up form while it runs, and the product and checkout under it.',
    build: () => page([
      section('Countdown', [widget('countdown', { mode: 'deadline' })], { style: BAND }),
      section('Hero', [
        heading(1, CENTER),
        text(CENTER),
        widget('leadForm', { nameField: 'optional', phoneField: 'hidden' })
      ], { style: { paddingTop: 72, paddingBottom: 48 } }),
      section('Product', [
        [widget('productHero')],
        [widget('stockCount'), widget('checkoutButton'), widget('trustBadge')]
      ]),
      section('Questions', [heading(2, CENTER), widget('faq')], { style: BAND })
    ])
  },
  {
    id: 'long-form-sales',
    group: 'Sell',
    name: 'Long-form sales page',
    description: 'A full page in the classic order: hook, problem, benefits, product, proof, questions and a final call.',
    build: () => page([
      section('Hook', [heading(1, CENTER), text(CENTER), widget('checkoutButton')], { style: { paddingTop: 72, paddingBottom: 40 } }),
      section('Problem', [heading(2), text()], { style: BAND }),
      section('Benefits', [
        [heading(2), widget('iconList')],
        [widget('image')]
      ]),
      section('Product', [widget('productHero'), widget('orderBump'), widget('checkoutButton')], { style: BAND }),
      section('Proof', [heading(2, CENTER), widget('testimonials'), widget('reviewsWall')]),
      section('Guarantee', [widget('trustBadge')], { style: BAND }),
      section('Questions', [heading(2, CENTER), widget('faq')]),
      section('Final call', [heading(2, CENTER), widget('countdown'), widget('checkoutButton')], { style: { ...BAND, paddingTop: 56, paddingBottom: 72 } })
    ])
  }
]);

/** A template by id, or null. */
export function templateById(id) {
  return TEMPLATES.find(t => t.id === id) ?? null;
}

/** A fresh document for a template id, or null for an unknown id. Every call mints new ids. */
export function buildTemplate(id) {
  const t = templateById(id);
  return t ? t.build() : null;
}
