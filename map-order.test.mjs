import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// C34: on the map, Tab and a screen reader met every line pill before any step, because React
// Flow draws its edge label layer BEFORE the steps and the pills were portalled into it. And
// + Before / + Next for the selected step came after the LAST step, because NodeToolbar portals
// after the whole viewport. Now the pills go in React Flow's viewport portal, which comes after
// the steps, and + Before / + Next render inside the selected step's own card wrapper.
//
// The first half pins the wiring and the React Flow DOM order it relies on. The second half
// renders the real JourneyCanvas with the default journey in real Chrome (bundled with esbuild,
// which Vite already ships) and walks it with Tab; it skips when Chrome or Playwright is absent.

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const canvas = read('./src/components/canvas/JourneyCanvas.tsx');
const edge = read('./src/components/canvas/edges/ConversionEdge.tsx');
const layout = read('./src/components/canvas/EdgeLabelLayout.tsx');

test('React Flow draws the edge label layer before the steps and the viewport portal after them', () => {
  // The fix depends on this order inside GraphView. An upgrade that changes it must fail here.
  const lib = read('./node_modules/@xyflow/react/dist/esm/index.js');
  const view = lib.slice(lib.indexOf('function GraphViewComponent('), lib.indexOf("GraphViewComponent.displayName"));
  const labels = view.indexOf('"react-flow__edgelabel-renderer"');
  const steps = view.indexOf('jsx(NodeRenderer');
  const portal = view.indexOf('"react-flow__viewport-portal"');
  assert.ok(labels > 0 && steps > 0 && portal > 0, 'GraphView renders all three');
  assert.ok(labels < steps, 'the edge label layer comes before the steps');
  assert.ok(steps < portal, 'the viewport portal comes after the steps');
});

test('a line pill renders in the viewport portal, and the label layout watches it there', () => {
  assert.ok(!/EdgeLabelRenderer/.test(edge), 'ConversionEdge no longer uses EdgeLabelRenderer');
  assert.match(edge, /const caption = \(\s*<div\s+data-edge-id=\{id\}\s+data-jv-edge-label=\{id\}/);
  assert.match(edge, /createPortal\(caption, portal\)/);
  assert.match(layout, /useStore\(s => viewportPortalOf<HTMLElement>\(s\.domNode\)\)/);
  assert.match(layout, /mutations\?\.observe\(portal as Element/);
  assert.ok(!layout.includes("querySelector('.react-flow__edgelabel-renderer')"), 'the layout does not watch the empty layer');
});

test('+ Before and + Next render inside every kind of step, not in a NodeToolbar', () => {
  const rfImport = canvas.slice(0, canvas.indexOf("} from '@xyflow/react';"));
  assert.ok(!/<NodeToolbar\b/.test(canvas) && !/\bNodeToolbar\b/.test(rfImport), 'no NodeToolbar left');
  const types = canvas.slice(canvas.indexOf('const nodeTypes: NodeTypes = useMemo('), canvas.indexOf('}), []);', canvas.indexOf('const nodeTypes')));
  const entries = types.match(/'[\w-]+': [^,\n]+/g) || [];
  assert.equal(entries.length, 7, 'seven step kinds');
  for (const e of entries) assert.match(e, /: withStepAdd\(\w+Node\)$/, e);
  // The slot follows the card, so Tab goes step, its own controls, + Before, + Next.
  assert.match(canvas, /<Card \{\.\.\.props\} \/>\s*<StepAddSlot nodeId=\{props\.id\} \/>/);
  assert.match(canvas, /className="nodrag nopan nokey"/);
  // The slot sits in the selected step's layer, above the lines, so its gap to the card and the
  // space between the pills must not take clicks meant for a line pill beneath them; the pills do.
  const slot = canvas.slice(canvas.indexOf('const StepAddSlot'), canvas.indexOf('function withStepAdd'));
  assert.match(slot, /pointerEvents: 'none'/, 'the slot itself takes no pointer events');
  const pill = canvas.slice(canvas.indexOf('const addPill'), canvas.indexOf('};', canvas.indexOf('const addPill')));
  assert.match(pill, /pointerEvents: 'auto'/, 'the + pills do');
  assert.match(canvas, /<StepAddContext\.Provider value=\{stepAdd\}>\s*<ReactFlowProvider>/);
});

test('the browser checks find pills by their own mark and walk the map order', async () => {
  for (const file of ['./scripts/a11y-browser-check.mjs', './scripts/canvas-browser-check.mjs']) {
    assert.ok(!read(file).includes("querySelector('.react-flow__edgelabel-renderer"), `${file} does not look for pills in the empty layer`);
  }
  const { CHECKS } = await import('./scripts/a11y-browser-check.mjs');
  assert.equal(typeof CHECKS.mapOrder, 'function');
});

// ---- The real canvas in a real browser ----

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAYWRIGHT = new URL('../../node_modules/playwright/index.mjs', import.meta.url);

async function loadBrowser() {
  if (!fs.existsSync(CHROME) || !fs.existsSync(PLAYWRIGHT)) return null;
  try {
    const { chromium } = await import(PLAYWRIGHT.href);
    return await chromium.launch({ headless: true, executablePath: CHROME });
  } catch {
    return null;
  }
}

// The default journey, selected the way App selects: a click or Enter on a step picks it.
const HARNESS = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';
import { JourneyCanvas } from './src/components/canvas/JourneyCanvas.tsx';
import { DEFAULT_LEAD_CAPTURE_PROJECT as P } from './src/lib/defaultBlueprint.ts';

function App() {
  const [nodes, setNodes] = useState(P.nodes);
  const [edges, setEdges] = useState(P.edges);
  const [selected, setSelected] = useState(null);
  window.__picked = () => selected;
  return React.createElement('div', { style: { width: '1200px', height: '760px' } },
    React.createElement(JourneyCanvas, {
      nodes, edges,
      onNodesChange: setNodes,
      onEdgesChange: setEdges,
      onGraphChange: (n, e) => { setNodes(n); setEdges(e); },
      selectedNodeId: selected,
      onSelectNode: n => setSelected(n ? n.id : null),
      onOpenStep: id => setSelected(id),
      onSelectEdge: () => {}
    })
  );
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;

async function bundle() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: new URL('.', import.meta.url).pathname, loader: 'jsx' },
    bundle: true,
    write: false,
    outdir: '/map-order',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'empty', '.woff': 'empty' },
    logLevel: 'silent'
  });
  return {
    js: out.outputFiles.find(f => f.path.endsWith('.js')).text,
    css: out.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? ''
  };
}

// Where focus is: which step it is in (or on), whether it is a line pill, and its name.
const where = page => page.evaluate(() => {
  const a = document.activeElement;
  const step = a?.closest?.('.react-flow__node');
  return {
    step: step ? step.getAttribute('data-id') : null,
    onStep: !!a?.classList?.contains('react-flow__node'),
    pill: !!a?.closest?.('[data-jv-edge-label]'),
    name: (a?.getAttribute?.('aria-label') || a?.textContent || a?.tagName || '').trim().slice(0, 60)
  };
});

test('Tab meets every step before any line pill, and + Before / + Next right after the selected step', async t => {
  const browser = await loadBrowser();
  if (!browser) return t.skip('Chrome or Playwright is not available here');
  try {
    const { js, css } = await bundle();
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body style="margin:0;background:#0B0F19"><div id="root"></div></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    await page.waitForSelector('.react-flow__node[data-id="node-seq-1"]', { state: 'visible' });
    await page.waitForSelector('[data-jv-edge-label] button');
    await page.waitForTimeout(300);
    assert.deepEqual(errors, [], 'the canvas renders without a page error');

    // Document order, which is both the Tab order and the reading order here.
    const order = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node, [data-jv-edge-label] button')]
      .map(el => (el.classList.contains('react-flow__node') ? 'step' : 'pill')));
    assert.equal(order.filter(k => k === 'step').length, 4);
    assert.equal(order.filter(k => k === 'pill').length, 3);
    assert.deepEqual(order, [...order].sort((a, b) => (a === b ? 0 : a === 'step' ? -1 : 1)), `steps then pills, got ${order.join(', ')}`);

    // Real Tab from the first step: every step is met before the first pill.
    await page.focus('.react-flow__node[data-id="node-ad-1"]');
    const met = new Set(['node-ad-1']);
    let pillAt = null;
    for (let i = 0; i < 12 && pillAt === null; i++) {
      await page.keyboard.press('Tab');
      const w = await where(page);
      if (w.pill) pillAt = met.size;
      else if (w.step) met.add(w.step);
    }
    assert.equal(pillAt, 4, 'the first pill comes after all four steps');

    // Select the landing page from the keyboard, then Tab from it.
    await page.focus('.react-flow__node[data-id="node-page-1"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-step-add="node-page-1"] button');
    await page.focus('.react-flow__node[data-id="node-page-1"]');
    const walk = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      walk.push(await where(page));
    }
    const before = walk.findIndex(w => w.name === 'Add a step before Lead Capture Lander');
    const after = walk.findIndex(w => w.name === 'Add a step after Lead Capture Lander');
    const nextStep = walk.findIndex(w => w.onStep);
    assert.ok(before >= 0 && after === before + 1, `+ Before then + Next follow the step, got ${JSON.stringify(walk.map(w => w.name))}`);
    assert.ok(nextStep === -1 || nextStep > after, 'no other step comes between the selected step and its + pills');
    assert.equal(walk[before].step, 'node-page-1', 'the pills are inside the selected step');

    // They still look and work as the toolbar did: above the card's top-right corner, 11px text
    // at any zoom, on top at their centre, and a click opens the picker without moving the step.
    const box = await page.evaluate(() => {
      const card = document.querySelector('.react-flow__node[data-id="node-page-1"]').getBoundingClientRect();
      const b = [...document.querySelectorAll('[data-step-add="node-page-1"] button')].map(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { bottom: r.bottom, right: r.right, height: r.height, onTop: hit === el || el.contains(hit) };
      });
      const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1]);
      return { cardTop: card.top, cardRight: card.right, zoom, b };
    });
    assert.ok(box.zoom > 0 && box.zoom !== 1, `the fit zoomed the map (zoom ${box.zoom}), so the counter-scale is exercised`);
    for (const b of box.b) {
      assert.ok(b.bottom <= box.cardTop, 'above the card');
      assert.ok(b.onTop, 'nothing covers it');
      assert.ok(Math.abs(b.height - 22) <= 3, `drawn at its own size whatever the zoom (height ${b.height})`);
    }
    assert.ok(Math.abs(box.b[box.b.length - 1].right - box.cardRight) <= 1, "lined up with the card's right edge");
    // Outside its buttons the slot takes no click: at 390px its 8px gap covered the line pill
    // under it and a tap on that pill did nothing.
    const slotHits = await page.evaluate(() => {
      const slot = document.querySelector('[data-step-add="node-page-1"]');
      const r = slot.getBoundingClientRect();
      const hits = [];
      for (let fx = 0.05; fx < 1; fx += 0.1) for (let fy = 0.05; fy < 1; fy += 0.1) {
        const h = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (h === slot) hits.push([fx.toFixed(2), fy.toFixed(2)]);
      }
      return { hits, height: r.height };
    });
    assert.ok(slotHits.height > 22, 'the slot box includes the gap above the card');
    assert.deepEqual(slotHits.hits, [], 'no point of the slot outside a button takes a click');
    const pos = () => page.evaluate(() => document.querySelector('.react-flow__node[data-id="node-page-1"]').style.transform);
    const at = await pos();
    await page.click('[data-step-add="node-page-1"] button:last-child');
    await page.waitForSelector('dialog[open]');
    assert.equal(await pos(), at, 'the step did not move');
  } finally {
    await browser.close();
  }
});
