// Finding C07: a blueprint's ad spend reached the canvas as the person's own entry. The six
// blueprints seeded $340 to $680, zeroBlueprintMetrics kept it (spend is not a measurement), and
// the ad card labels spend "Spend you entered" and divides it into Est. cost per visit and Est.
// ROAS, while statsRequestBody sent it to the server's ROAS and Attribution's CAC. The Ad editor
// had no spend field, so nobody could correct it.
//
// The AdEditor is bundled with esbuild (installed with Vite) and rendered with react-dom/server,
// like edge-inspector-rest.test.mjs, so the field is read as a person gets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const { ECOM_BLUEPRINTS } = await import('./src/data/ecomBlueprints.ts');
const { zeroBlueprintMetrics, clearTemplateMetrics } = await import('./src/lib/liveStats.ts');
const { statsRequestBody, journeyTotals } = await import('./src/lib/journeyMetrics.ts');

const ROOT = new URL('.', import.meta.url).pathname;
const out = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { AdEditor, spendFromInput } from './src/components/drawers/AdEditor.tsx';
      export { spendFromInput };
      export const render = props => renderToStaticMarkup(React.createElement(AdEditor, props));`,
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
const dir = mkdtempSync(join(tmpdir(), 'jv-ad-editor-'));
const file = join(dir, 'ad-editor.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { render, spendFromInput } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

const adOf = nodes => nodes.find(n => n.type === 'ad-source');

test('no blueprint ships an ad spend', () => {
  for (const bp of ECOM_BLUEPRINTS) {
    const ad = adOf(bp.nodes);
    assert.ok(ad, `${bp.id} has an ad step`);
    assert.equal(ad.data.spend, 0, `${bp.id} seeds no spend`);
  }
});

test('loading a blueprint clears any spend it carries, so nothing reaches ROAS or the stats request', () => {
  // A custom blueprint saved from a journey, or an older copy of the seed data, still carries a figure.
  for (const bp of ECOM_BLUEPRINTS) {
    const nodes = bp.nodes.map(n => (n.type === 'ad-source' ? { ...n, data: { ...n.data, spend: 520 } } : n));
    const z = zeroBlueprintMetrics(nodes, bp.edges);
    assert.equal(adOf(z.nodes).data.spend, 0, `${bp.id} spend after loading`);
    const body = statsRequestBody({ id: 'j1', nodes: z.nodes, edges: z.edges }, 30);
    assert.equal(adOf(body.nodes).spend, 0, `${bp.id} spend sent to the stats route`);
    assert.equal(journeyTotals(z.nodes, null).spend, 0, `${bp.id} header spend`);
    // The blueprint itself is not mutated.
    assert.equal(adOf(nodes).data.spend, 520);
  }
});

test('a step with no spend key does not gain one', () => {
  const bp = ECOM_BLUEPRINTS[0];
  const z = zeroBlueprintMetrics(bp.nodes, bp.edges);
  for (const n of z.nodes) {
    if (n.type !== 'ad-source') assert.equal('spend' in n.data, false, `${n.id} has no spend`);
  }
});

test('the starter map keeps spend the person typed', () => {
  // clearTemplateMetrics runs on the default map; spend there is the person's entry and stays put.
  const project = {
    id: 'p', name: 'p', offerHeadline: 'Offer', updatedAt: '',
    nodes: [{ id: 'node-ad-1', type: 'ad-source', position: { x: 0, y: 0 }, data: { type: 'ad-source', spend: 75, clicks: 40 } }],
    edges: []
  };
  const cleared = clearTemplateMetrics(project);
  assert.equal(cleared.nodes[0].data.spend, 75);
  assert.equal(cleared.nodes[0].data.clicks, 0);
});

const baseAd = { type: 'ad-source', label: 'Ad', platform: 'meta', headline: '', body: '', ctaText: '', utmCampaign: '', impressions: 0, clicks: 0, ctr: 0 };
const props = data => ({ data, onChange() {}, offerHeadline: '', businessType: '' });

/** The Ad Spend input and the ids it points at. */
function spendField(html) {
  const input = html.match(/<input[^>]*type="number"[^>]*>/);
  assert.ok(input, 'the Ad editor has a number field');
  const tag = input[0];
  const id = tag.match(/ id="([^"]+)"/)?.[1];
  const value = tag.match(/ value="([^"]*)"/)?.[1];
  const hintId = tag.match(/ aria-describedby="([^"]+)"/)?.[1];
  const label = html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`))?.[1];
  const hint = hintId ? html.match(new RegExp(`<div id="${hintId}"[^>]*>([^<]*)</div>`))?.[1] : undefined;
  return { tag, id, value, label, hint };
}

test('the Ad editor has a labelled Ad Spend field, blank when nothing was entered', () => {
  for (const spend of [0, undefined]) {
    const f = spendField(render(props({ ...baseAd, spend })));
    assert.ok(f.id, 'the field has an id');
    assert.equal(f.label, 'Ad Spend ($)');
    assert.equal(f.value, '', `spend ${spend} reads blank`);
    assert.match(f.tag, /placeholder="Not entered"/);
    assert.match(f.tag, /min="0"/);
    assert.ok(f.hint && /date range/.test(f.hint), 'the hint says what period the spend covers');
    assert.doesNotMatch(f.hint, /—| – /, 'no em dash or spaced en dash');
  }
});

test('the Ad editor shows the spend the person entered', () => {
  assert.equal(spendField(render(props({ ...baseAd, spend: 520 }))).value, '520');
  assert.equal(spendField(render(props({ ...baseAd, spend: 12.5 }))).value, '12.5');
});

test('what the field stores for what was typed', () => {
  assert.equal(spendFromInput(''), 0, 'blank is not entered');
  assert.equal(spendFromInput('0'), 0);
  assert.equal(spendFromInput('-40'), 0, 'never negative');
  assert.equal(spendFromInput('abc'), 0);
  assert.equal(spendFromInput('12.'), 12);
  assert.equal(spendFromInput('0.5'), 0.5);
  assert.equal(spendFromInput('12.345'), 12.35, 'to the cent');
  assert.equal(spendFromInput('680'), 680);
});
