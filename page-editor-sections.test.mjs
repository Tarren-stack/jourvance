import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_EDITOR_SECTIONS,
  PAGE_FIELD_IDS,
  OPEN_SECTIONS_STORAGE_KEY,
  sectionSummary,
  parseOpenSections,
  toggleSection
} from './src/lib/pageEditorSections.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './src/lib/defaultBlueprint.ts';

// The page editor keeps the words open and folds everything else into five sections. A closed
// section must still say what is set inside it, using the editor's own predicates, or a live
// countdown or a missing product hides behind a collapsed header.

const defaultPage = () => structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.id === 'node-page-1').data);
const summary = (id, data, storeConnected = false) => sectionSummary(id, data, { storeConnected });

test('the five sections, in order, with their titles', () => {
  assert.deepEqual(PAGE_EDITOR_SECTIONS.map(s => s.id), ['commerce', 'ab-test', 'extras', 'privacy', 'hosting']);
  assert.deepEqual(PAGE_EDITOR_SECTIONS.map(s => s.title), [
    'Product and checkout',
    'A/B test',
    'Urgency and extras',
    'Privacy and tracking',
    'Hosting and domain'
  ]);
  assert.equal(OPEN_SECTIONS_STORAGE_KEY, 'jourvance_page_editor_open');
});

test('PAGE_FIELD_IDS names the four copy inputs', () => {
  assert.deepEqual({ ...PAGE_FIELD_IDS }, {
    headline: 'page-headline',
    subhead: 'page-subhead',
    buttonText: 'page-button-text',
    slug: 'page-slug'
  });
});

test('the default blueprint page reads truthfully when closed', () => {
  const data = defaultPage();
  assert.deepEqual(summary('commerce', data, false), { text: 'No store connected', tone: 'neutral' });
  assert.deepEqual(summary('commerce', data, true), { text: 'No product linked', tone: 'warn' });
  assert.equal(summary('ab-test', data).text, 'Off');
  assert.equal(summary('extras', data).text, 'Sticky bar, Reviews wall');
  assert.equal(summary('privacy', data).text, 'Cookie notice on · No pixels');
  assert.equal(summary('hosting', data).text, 'Not published');
});

test('turning A/B on changes its summary at once', () => {
  const data = { ...defaultPage(), abTestingEnabled: true };
  assert.equal(summary('ab-test', data).text, 'On · 50% A / 50% B');
});

test('a configured page reads its real settings', () => {
  const data = {
    ...defaultPage(),
    shopifyProductTitle: 'Serum',
    shopifyVariantId: '555',
    checkoutMode: 'lead-gate',
    orderBumpEnabled: true,
    abTestingEnabled: true,
    splitRatio: 70,
    metaPixelId: '123',
    ga4TrackingId: 'G-1',
    tiktokPixelId: '  ',
    published: true,
    customDomain: 'offer.brand.com',
    customDomainVerified: false,
    urgencyTimerEnabled: true,
    exitIntentEnabled: true
  };
  assert.deepEqual(summary('commerce', data, true), { text: 'Serum · Email first · Add-on on', tone: 'on' });
  assert.equal(summary('ab-test', data).text, 'On · 70% A / 30% B');
  assert.match(summary('privacy', data).text, /2 pixels/);
  assert.equal(summary('hosting', data).text, 'Published · offer.brand.com not verified');
  assert.equal(summary('extras', data).text, '4 on');

  const direct = { ...data, checkoutMode: undefined, orderBumpEnabled: false };
  assert.equal(summary('commerce', direct, true).text, 'Serum · Direct checkout');

  const placeholder = { ...data, shopifyVariantId: '42109840192' };
  assert.deepEqual(summary('commerce', placeholder, true), { text: 'No product linked', tone: 'warn' });
});

test('extras says All off when nothing is on, and privacy counts one pixel', () => {
  const data = { ...defaultPage(), mobileStickyBarEnabled: false, socialProofWallEnabled: false, cookieConsentEnabled: false, metaPixelId: 'x' };
  assert.equal(summary('extras', data).text, 'All off');
  assert.equal(summary('privacy', data).text, 'Cookie notice off · 1 pixel');
  const verified = { ...data, customDomain: 'go.brand.com', customDomainVerified: true };
  assert.equal(summary('hosting', verified).text, 'Not published · go.brand.com verified');
});

test('parseOpenSections accepts only a JSON array of known ids', () => {
  for (const raw of [null, '', 'nope', '{"a":1}', '"commerce"', '[1,2]']) {
    assert.deepEqual(parseOpenSections(raw), []);
  }
  assert.deepEqual(parseOpenSections('["commerce","bogus","commerce"]'), ['commerce']);
  assert.deepEqual(parseOpenSections('["hosting","ab-test"]'), ['hosting', 'ab-test']);
});

test('toggleSection adds and removes an id', () => {
  assert.deepEqual(toggleSection([], 'extras'), ['extras']);
  assert.deepEqual(toggleSection(['extras', 'hosting'], 'extras'), ['hosting']);
});

test('no title or summary carries an em dash', () => {
  const pages = [
    defaultPage(),
    { ...defaultPage(), shopifyProductTitle: 'Serum', shopifyVariantId: '9', abTestingEnabled: true, published: true, customDomain: 'a.b.com' }
  ];
  for (const s of PAGE_EDITOR_SECTIONS) {
    assert.doesNotMatch(s.title, /—|\s–\s/);
    for (const p of pages) {
      for (const connected of [true, false]) {
        assert.doesNotMatch(summary(s.id, p, connected).text, /—|\s–\s/);
      }
    }
  }
});
