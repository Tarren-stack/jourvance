import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// No text under 11px in the Blueprint library and the Export Assets modal. The library drew its
// category badges ("Fastest Checkout", "Post-Purchase Upsell"), the "Includes 24h Rescue & Cart
// Recovery" tag, the saved-blueprint id and every arrow between step chips at 10px, and Export
// Assets drew each page's file name at 0.675rem (10.8px on the 16px root). The browser minText
// check never opens these two modals, so the scan reads their inline styles instead: a px size,
// a bare number (React reads it as px) and a rem size (times the 16px root) must all reach 11px.

const MIN_TEXT_PX = 11;
const ROOT_PX = 16;

const FILES = [
  './src/components/modals/BlueprintModal.tsx',
  './src/components/export/ExportAssetsModal.tsx'
];

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

function smallText(src) {
  const found = [];
  for (const m of src.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
    const value = m[1].trim();
    const sizes = [
      ...[...value.matchAll(/(\d*\.?\d+)px/g)].map(x => Number(x[1])),
      ...[...value.matchAll(/(\d*\.?\d+)rem/g)].map(x => Number(x[1]) * ROOT_PX)
    ];
    if (!sizes.length && /^\d*\.?\d+$/.test(value)) sizes.push(Number(value));
    for (const px of sizes) if (px < MIN_TEXT_PX) found.push(`line ${lineOf(src, m.index)}: ${value}`);
  }
  return found;
}

test('the scanner catches px, rem and bare-number sizes under 11px', () => {
  const src = [
    "<span style={{ fontSize: '10px' }}>a</span>",
    "<span style={{ fontSize: '0.675rem' }}>b</span>",
    '<span style={{ fontSize: 9 }}>c</span>',
    "<span style={{ fontSize: '11px' }}>d</span>",
    "<span style={{ fontSize: '0.6875rem' }}>e</span>",
    '<span style={{ fontSize: 12 }}>f</span>'
  ].join('\n');
  assert.deepEqual(smallText(src), ["line 1: '10px'", "line 2: '0.675rem'", 'line 3: 9']);
});

test('no text under 11px in the Blueprint library and the Export Assets modal', () => {
  const offenders = [];
  for (const file of FILES) for (const hit of smallText(fs.readFileSync(file, 'utf8'))) offenders.push(`${file} ${hit}`);
  assert.deepEqual(offenders, []);
});
