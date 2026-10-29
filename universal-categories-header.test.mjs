import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNIVERSAL_BUSINESS_CATEGORIES,
  isUniversalBusinessCategory,
  normalizeBusinessCategory
} from './src/types/journey.ts';

const header = fs.readFileSync('src/components/toolbar/CanvasHeader.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

test('UNIVERSAL_BUSINESS_CATEGORIES contains the 5 canonical categories', () => {
  assert.deepEqual(UNIVERSAL_BUSINESS_CATEGORIES, [
    'E-Commerce & Physical Retail',
    'Local & Client Services',
    'B2B, Agencies & Consulting',
    'Digital Products, Courses & Creators',
    'SaaS, Tech & Events'
  ]);
  assert.equal(isUniversalBusinessCategory('E-Commerce & Physical Retail'), true);
  assert.equal(isUniversalBusinessCategory('Custom Industry'), false);
  assert.equal(normalizeBusinessCategory('E-Commerce Brand'), 'E-Commerce & Physical Retail');
  assert.equal(normalizeBusinessCategory('Professional & Local Services'), 'Local & Client Services');
  assert.equal(normalizeBusinessCategory('Consulting Agency'), 'B2B, Agencies & Consulting');
  assert.equal(normalizeBusinessCategory('Course Creator'), 'Digital Products, Courses & Creators');
  assert.equal(normalizeBusinessCategory('SaaS Software'), 'SaaS, Tech & Events');
  assert.equal(normalizeBusinessCategory(null), 'E-Commerce & Physical Retail');
});

test('CanvasHeader includes accessible business category selector and prop', () => {
  assert.match(header, /\bonUpdateBusinessType\??:\s*\(category:\s*string\)\s*=>\s*void/);
  assert.match(header, /aria-label="Business category"/);
  assert.match(header, /UNIVERSAL_BUSINESS_CATEGORIES\.map\(/);
  assert.match(header, /fontSize:\s*'11px'/);

  // Keyboard focus visibility: Business category <select> must not suppress browser/global :focus-visible outline
  const selectIdx = header.indexOf('aria-label="Business category"');
  assert.ok(selectIdx !== -1, 'Business category select must exist');
  const selectTagSlice = header.slice(selectIdx, header.indexOf('>', selectIdx));
  assert.doesNotMatch(selectTagSlice, /outline:\s*['"]none['"]/, 'Business category select must preserve focus outline');
});

test('App.tsx defines handleUpdateBusinessType and passes it to CanvasHeader', () => {
  assert.match(app, /const handleUpdateBusinessType\s*=\s*\(businessType:\s*string\)\s*=>/);
  const headerSlice = app.slice(app.indexOf('<CanvasHeader'), app.indexOf('/>', app.indexOf('<CanvasHeader')));
  assert.match(headerSlice, /onUpdateBusinessType=\{handleUpdateBusinessType\}/);
});

test('No em dashes or spaced en dashes introduced in category strings', () => {
  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    assert.doesNotMatch(cat, /[\u2014]|\s[\u2013]\s/);
  }
});
