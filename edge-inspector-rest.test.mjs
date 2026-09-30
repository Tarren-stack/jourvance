// The line panel's grid (finding C39): the two tiles for the people who did not take a line say
// "drop-off" only where nobody else carries those people. A split branch's other people went down
// the other branch as the split was set up, a decline line's other people took the offer or left,
// and a take line's other people declined (most of them down the decline line) or left. A 20%
// branch used to read "800 did not reach the next step, 80% drop-off" in amber.
//
// The real EdgeInspector is bundled with esbuild (already installed with Vite) and rendered with
// react-dom/server over a ready stats snapshot, so the test reads the tiles a person sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('.', import.meta.url).pathname;
const out = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { EdgeInspector } from './src/components/drawers/EdgeInspector.tsx';
      export const render = props => renderToStaticMarkup(React.createElement(EdgeInspector, props));`,
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
const dir = mkdtempSync(join(tmpdir(), 'jv-edge-inspector-'));
const file = join(dir, 'edge-inspector.mjs');
writeFileSync(file, out.outputFiles[0].text);
const { render } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

const view = nodes => ({
  status: 'ready',
  days: 30,
  snapshot: {
    journeyId: 'j', days: 30, from: '', to: '', partialSince: null, nodes,
    coverage: Object.fromEntries(Object.keys(nodes).map(id => [id, { measured: true }]))
  }
});
const node = (id, type, label) => ({ id, type, position: { x: 0, y: 0 }, data: { type, label } });

/** Each grid tile as { label, value, caption, amber }. */
function tiles(props) {
  const html = render({ ...props, onClose() {} });
  const re = /<div style="font-size:11px;color:#94A3B8">([^<]+)<\/div><div data-metric="true" style="[^"]*color:([^;"]+)[^"]*">([^<]+)<\/div><div[^>]*>([^<]+)<\/div>/g;
  const found = [...html.matchAll(re)].map(m => ({ label: m[1], value: m[3], caption: m[4], amber: m[2] === '#FBBF24' }));
  assert.equal(found.length, 4, 'the grid has four tiles');
  return found;
}

test('a split branch names the other branch, never drop-off, and is not amber', () => {
  const [, went, rest, share] = tiles({
    edge: { id: 'e1', source: 's', target: 'pb', sourceHandle: 'branch-b' },
    sourceNode: node('s', 'ab-split', 'Split'),
    targetNode: node('pb', 'landing-page', 'Page B'),
    metrics: view({ s: { branchAVisitors: 800, branchBVisitors: 200 }, pb: { visitors: 200 } })
  });
  assert.equal(went.value, '200');
  assert.deepEqual([rest.label, rest.value, rest.caption, rest.amber], ['Other branch', '800', 'went down the other branch', false]);
  assert.deepEqual([share.label, share.value, share.amber], ['Other branch share', '80.0%', false]);
});

test('a decline line does not count the people who took the offer as drop-off', () => {
  const [, went, rest, share] = tiles({
    edge: { id: 'e2', source: 'u', target: 'd', sourceHandle: 'declined' },
    sourceNode: node('u', 'upsell', 'Upsell'),
    targetNode: node('d', 'upsell', 'Downsell Alternative'),
    metrics: view({ u: { views: 84, takes: 21, totalDeclines: 63 }, d: { views: 63, takes: 5 } })
  });
  assert.equal(went.value, '63');
  assert.deepEqual([rest.label, rest.value, rest.caption, rest.amber], ['Did not decline', '21', 'took the offer or left', false]);
  assert.deepEqual([share.label, share.value, share.amber], ['Share that did not decline', '25.0%', false]);
});

test('an accepted line does not count the people who declined as drop-off', () => {
  const [, went, rest, share] = tiles({
    edge: { id: 'e4', source: 'u', target: 'ty', sourceHandle: 'accepted' },
    sourceNode: node('u', 'upsell', 'Upsell'),
    targetNode: node('ty', 'thank-you', 'Order Summary'),
    metrics: view({ u: { views: 100, takes: 20, totalDeclines: 70 }, ty: { pageViews: 90 } })
  });
  assert.equal(went.value, '20');
  assert.deepEqual([rest.label, rest.value, rest.caption, rest.amber], ['Did not take it', '80', 'declined or left', false]);
  assert.deepEqual([share.label, share.value, share.amber], ['Share that did not take it', '80.0%', false]);
});

test('a line whose other people really left still reads as drop-off, amber above 75%', () => {
  const [, , rest, share] = tiles({
    edge: { id: 'e3', source: 'p', target: 't' },
    sourceNode: node('p', 'landing-page', 'Page'),
    targetNode: node('t', 'thank-you', 'Thanks'),
    metrics: view({ p: { visitors: 1000, conversions: 100, leads: 100 }, t: { pageViews: 100 } })
  });
  assert.deepEqual([rest.label, rest.value, rest.caption, rest.amber], ['Did not go on', '900', 'did not reach the next step', true]);
  assert.deepEqual([share.label, share.value, share.amber], ['Drop-off rate', '90.0%', true]);
});

test('the split and decline tiles read Unavailable, not 0, with no snapshot', () => {
  const [, , rest, share] = tiles({
    edge: { id: 'e1', source: 's', target: 'pb', sourceHandle: 'branch-b' },
    sourceNode: node('s', 'ab-split', 'Split'),
    targetNode: node('pb', 'landing-page', 'Page B')
  });
  assert.deepEqual([rest.label, rest.value, share.value], ['Other branch', 'Unavailable', 'Unavailable']);
});
