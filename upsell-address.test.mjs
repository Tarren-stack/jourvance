// T11: an upsell card, its spoken name (React Flow's aria-label, stepSpokenName) and the step
// panel's card name (stepShortName) must say the same thing about the step's address. A brand-new
// upsell has no saved address, and the card used to show a default "/upsell" while the name said
// "no address yet". The card is bundled with esbuild and rendered, so the test reads what a
// sighted person sees beside what a screen reader hears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { stepAddress, stepShortName, stepSpokenName } from './src/lib/stepNames.ts';
import { newStepData } from './src/lib/stepDefaults.ts';

const ROOT = new URL('.', import.meta.url).pathname;

async function upsellCardRenderer() {
  const out = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { ReactFlowProvider } from '@xyflow/react';
        import { UpsellNode } from './src/components/canvas/nodes/UpsellNode.tsx';
        export const upsellCard = data => renderToStaticMarkup(
          React.createElement(ReactFlowProvider, null,
            React.createElement(UpsellNode, { id: 'u1', data, selected: false })));`,
      resolveDir: ROOT,
      loader: 'tsx'
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
  });
  const dir = mkdtempSync(join(tmpdir(), 'jv-upsell-card-'));
  const file = join(dir, 'upsell-card.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  try {
    return (await import(pathToFileURL(file).href)).upsellCard;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The card's address line: the data-jv-title inside the top detail row. muted is true when its
 * words sit in the muted placeholder colour.
 */
function cardAddress(html) {
  const m = html.match(/<div data-jv-detail-row[^>]*>[\s\S]*?<div data-jv-title="true" style="[^"]*">([\s\S]*?)<\/div>/);
  assert.ok(m, 'the card has an address line');
  const inner = m[1];
  return { text: inner.replace(/<[^>]*>/g, ''), muted: /^<span style="color:#94A3B8">[^<]*<\/span>$/.test(inner) };
}

/** The zoomed-out summary's name. */
function summaryName(html) {
  const m = html.match(/class="jv-step-summary__text">([^<]*)</);
  assert.ok(m, 'the card has a summary name');
  return m[1];
}

const renderCard = await upsellCardRenderer();

test('a new upsell: the card, its spoken name and the step panel all say it has no address yet', () => {
  const data = newStepData('upsell', 'abc123');
  assert.equal(stepAddress(data), '');
  assert.equal(stepShortName(data), 'Upsell, no address yet');
  assert.equal(stepSpokenName(data, { kind: 'not-published' }), 'Upsell, no address yet, not published');

  const html = renderCard(data);
  const line = cardAddress(html);
  assert.equal(line.text, 'No address yet');
  // Muted, so it does not read as an address.
  assert.equal(line.muted, true);
  assert.equal(summaryName(html), 'No address yet');
  // No default path anywhere on the card.
  assert.doesNotMatch(html, />\/upsell</);
  assert.doesNotMatch(html, /\/upsell/);
});

test('a new downsell with no address says so too, and a blank slug is no address', () => {
  const data = { ...newStepData('upsell', 'abc123'), offerType: 'downsell', slug: '   ' };
  assert.equal(stepShortName(data), 'Downsell, no address yet');
  const html = renderCard(data);
  assert.equal(cardAddress(html).text, 'No address yet');
  assert.doesNotMatch(html, /\/downsell/);
});

test('an upsell with a saved address shows it on the card, in its spoken name and in the panel', () => {
  const data = { ...newStepData('upsell', 'abc123'), slug: 'glow' };
  assert.equal(stepAddress(data), '/glow/upsell');
  assert.equal(stepShortName(data), 'Upsell /glow/upsell');
  assert.equal(stepSpokenName(data, { kind: 'published', revisionNumber: 3, publishedAt: '' }), 'Upsell /glow/upsell, published');
  // Signed out the card says "Status unavailable" whatever the browser's flag says, and so does the name.
  assert.equal(stepSpokenName({ ...data, published: true }, { kind: 'unknown', reason: 'signed-out' }), 'Upsell /glow/upsell, status unavailable');

  const html = renderCard(data);
  const line = cardAddress(html);
  assert.equal(line.text, '/glow/upsell');
  assert.equal(line.muted, false);
  assert.equal(summaryName(html), '/glow/upsell');

  const down = { ...data, offerType: 'downsell', slug: '/glow' };
  assert.equal(stepShortName(down), 'Downsell /glow/downsell');
  assert.equal(cardAddress(renderCard(down)).text, '/glow/downsell');
});

test('stepAddress keeps the page kinds on the rule their names already used', () => {
  assert.equal(stepAddress({ type: 'landing-page', slug: 'vip' }), '/vip');
  assert.equal(stepAddress({ type: 'thank-you', slug: '/thanks' }), '/thanks');
  assert.equal(stepAddress({ type: 'ab-split', slug: '' }), '');
  assert.equal(stepAddress({ type: 'lead-form', slug: 'x' }), '');
  assert.equal(stepAddress({ data: { type: 'upsell', slug: 'glow' } }), '/glow/upsell');
  assert.equal(stepShortName({ type: 'landing-page', slug: 'vip' }), 'Landing page /vip');
  assert.equal(stepShortName({ type: 'ab-split' }), 'A/B split, no address yet');
});
