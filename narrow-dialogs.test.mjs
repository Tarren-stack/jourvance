import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Finding R05: at 390px the Export Assets and Blueprints dialogs ran their controls past the
// panel's right edge. The Download button sat in a footer the panel clipped, the JSON Blueprint tab
// and the page picker were in sideways scrollers, and "Import via Share Code" was squeezed to
// "Im.. Sh.. C..". The public site's header ran 917px wide inside a 390px page, so Home, About and
// the start of Blog were all a phone showed and Sign In could only be reached by scrolling sideways.
//
// Layout is a browser property, so the three components are bundled with esbuild (which Vite
// already ships), rendered in real Chrome at 390px and measured, like overlay-dialogs.test.mjs.
// It skips when Chrome or Playwright is not on this machine.

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

// One page per view, chosen by window.__view. The export gets a journey with a split, two landing pages
// (one with a long file name), two upsells and a form, so every strip and the router's fields show.
const HARNESS = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExportAssetsModal } from './src/components/export/ExportAssetsModal.tsx';
import { BlueprintModal } from './src/components/modals/BlueprintModal.tsx';
import { PublicHeader } from './src/components/public/PublicHeader.tsx';
import { ECOM_BLUEPRINTS } from './src/data/ecomBlueprints.ts';

const view = window.__view;
const oto = ECOM_BLUEPRINTS.find(b => b.id === 'oto-upsell-funnel-system');
const consult = ECOM_BLUEPRINTS.find(b => b.id === 'high-ticket-consultation');
const lander = oto.nodes.find(n => n.type === 'landing-page');
const nodes = [
  ...oto.nodes,
  { ...lander, id: 'lander-b', data: { ...lander.data, label: 'Evening Workshop Lander', slug: 'evening-workshop-registration-variant-b' } },
  { id: 'split', type: 'ab-split', position: { x: 0, y: 0 }, data: { label: 'Traffic Split', splitRatio: 50, branchALabel: 'Variant A', branchBLabel: 'Variant B', branchANodeId: lander.id, branchBNodeId: 'lander-b' } },
  ...consult.nodes.filter(n => n.type === 'lead-form')
];
const noop = () => {};
let el;
if (view === 'export') el = React.createElement(ExportAssetsModal, { isOpen: true, onClose: noop, nodes, journeyTitle: 'Narrow check' });
else if (view === 'export-one') el = React.createElement(ExportAssetsModal, { isOpen: true, onClose: noop, nodes: consult.nodes, journeyTitle: 'Narrow check' });
else if (view === 'blueprints') el = React.createElement(BlueprintModal, { isOpen: true, onClose: noop, onLoadBlueprint: noop, workspace: null });
else {
  const user = view === 'header-user' ? { uid: 'u1', email: 'someone.with.a.long.name@example.com', displayName: 'Someone Longname' } : null;
  // The public site scrolls inside this box in App.tsx, which is where the 917px showed.
  el = React.createElement('div', { id: 'page', style: { display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' } },
    React.createElement(PublicHeader, { activePage: 'home', onNavigate: noop, onTestJourney: noop, user, onOpenAuth: noop, onOpenBilling: noop, onSignOut: noop }),
    React.createElement('main', { style: { height: '2000px' } }, 'Page'));
}
createRoot(document.getElementById('root')).render(el);
`;

async function bundle() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: new URL('.', import.meta.url).pathname, loader: 'jsx' },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    logLevel: 'silent'
  });
  return out.outputFiles[0].text;
}

// Everything that sits past the edges of `root`, every box inside or around it that holds more
// width than it shows (a sideways scroller, or content the panel clips), and every box that cuts
// off content below it with no way to scroll to it. Text inputs are left out of the last two (their
// own text scrolls), and so is text cut with an ellipsis on purpose.
function measure(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return { missing: rootSelector };
  const box = root.getBoundingClientRect();
  const label = el => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const outside = [...root.querySelectorAll('button, a, input, select, textarea, [role="tab"]')]
    .filter(visible)
    .filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < Math.max(0, box.left) - 1 || r.right > Math.min(innerWidth, box.right) + 1;
    })
    .map(el => `"${label(el)}" ${Math.round(el.getBoundingClientRect().left)} to ${Math.round(el.getBoundingClientRect().right)}`);
  const around = [];
  for (let el = root; el && el !== document.documentElement; el = el.parentElement) around.push(el);
  const wide = [...around, ...root.querySelectorAll('*')]
    .filter(el => !/^(INPUT|TEXTAREA)$/.test(el.tagName) && getComputedStyle(el).textOverflow !== 'ellipsis')
    .filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
    .map(el => `${el.tagName} "${label(el)}" ${el.scrollWidth} in ${el.clientWidth}`);
  const cut = [...around, ...root.querySelectorAll('*')]
    .filter(el => !/^(INPUT|TEXTAREA)$/.test(el.tagName) && getComputedStyle(el).textOverflow !== 'ellipsis')
    .filter(el => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(getComputedStyle(el).overflowY))
    .map(el => `${el.tagName} "${label(el)}" ${el.scrollHeight} in ${el.clientHeight}`);
  return { page: document.documentElement.scrollWidth - innerWidth, outside, wide, cut };
}

const clean = { page: 0, outside: [], wide: [], cut: [] };

// The app's own stylesheet, less the React Flow import, so text and boxes size as they do in the app.
const APP_CSS = fs.readFileSync(new URL('./src/index.css', import.meta.url), 'utf8').replace(/^@import[^\n]*$/gm, '');

async function openView(browser, view, width) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: APP_CSS });
  await page.evaluate(v => { window.__view = v; }, view);
  return page;
}

let script;
const harness = async () => (script ??= await bundle());

test('Export Assets keeps every control inside the panel at 390px, on every tab and every page', async t => {
  const browser = await loadBrowser();
  if (!browser) return t.skip('Chrome or Playwright is not available here');
  try {
    const code = await harness();
    for (const view of ['export', 'export-one']) {
      const page = await openView(browser, view, 390);
      await page.addScriptTag({ content: code });
      await page.waitForSelector('dialog[open] h2');
      const panel = 'dialog[open] > *';
      for (const tab of ['HTML Funnel Pages', 'Email Sequence', 'Ad Copy + UTMs', 'JSON Blueprint']) {
        await page.getByRole('button', { name: tab }).click();
        if (tab === 'HTML Funnel Pages') {
          const pills = page.locator('dialog[open] button:has(span:text-matches("\\\\.html$"))');
          const count = await pills.count();
          assert.ok(count >= (view === 'export' ? 6 : 1), `${view}: the page picker lists the pages (${count})`);
          for (let i = 0; i < count; i++) {
            await pills.nth(i).click();
            assert.deepEqual(await page.evaluate(measure, panel), clean, `${view}, page ${i + 1}`);
          }
        } else {
          assert.deepEqual(await page.evaluate(measure, panel), clean, `${view}, ${tab}`);
        }
      }
      // The primary action can be brought whole onto the screen, not cut by the panel.
      const downloadButton = page.getByRole('button', { name: /^Download (?!All)/ });
      await downloadButton.scrollIntoViewIfNeeded();
      const download = await downloadButton.boundingBox();
      assert.ok(download.x >= 16 && download.x + download.width <= 374, `${view}: Download spans ${download.x} to ${download.x + download.width}`);
      assert.ok(download.y >= 0 && download.y + download.height <= 844, `${view}: Download spans ${download.y} to ${download.y + download.height} down the screen`);
      // The code preview keeps a readable height rather than being squeezed out by the wrapped rows.
      const preview = await page.locator('dialog[open] pre').evaluate(p => p.parentElement.parentElement.getBoundingClientRect().height);
      assert.ok(preview >= 150, `${view}: the code preview is ${preview}px tall`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('the Blueprints library keeps its tabs and cards inside the panel at 390px', async t => {
  const browser = await loadBrowser();
  if (!browser) return t.skip('Chrome or Playwright is not available here');
  try {
    const code = await harness();
    const page = await openView(browser, 'blueprints', 390);
    await page.addScriptTag({ content: code });
    await page.waitForSelector('dialog[open] h2');
    const panel = 'dialog[open] > *';
    for (const tab of ['Turnkey Library', 'My Team Blueprints', 'Import via Share Code']) {
      await page.getByRole('button', { name: tab }).click();
      assert.deepEqual(await page.evaluate(measure, panel), clean, tab);
      // Each tab's label stays on one line rather than a word per line.
      const lines = await page.getByRole('button', { name: tab }).evaluate(b => {
        const range = document.createRange();
        range.selectNodeContents([...b.querySelectorAll('span')].find(s => s.textContent.trim() && isNaN(Number(s.textContent))));
        return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
      });
      assert.equal(lines, 1, `${tab} is one line`);
    }
    // On the library tab a card's Use Blueprint button drops under the text, which keeps its width.
    await page.getByRole('button', { name: 'Turnkey Library' }).click();
    const card = await page.locator('dialog[open] h3').first().evaluate(h => Math.round(h.parentElement.getBoundingClientRect().width));
    assert.ok(card >= 240, `the first card's text column is ${card}px wide`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('the public header fits a 390px screen with Sign In and the account menu reachable, and stays pinned from a tablet up', async t => {
  const browser = await loadBrowser();
  if (!browser) return t.skip('Chrome or Playwright is not available here');
  try {
    const code = await harness();
    for (const view of ['header', 'header-user']) {
      const page = await openView(browser, view, 390);
      await page.addScriptTag({ content: code });
      await page.waitForSelector('header nav');
      assert.deepEqual(await page.evaluate(measure, 'header'), clean, `${view} at 390`);
      const wrapper = await page.evaluate(() => { const p = document.getElementById('page'); return p.scrollWidth - p.clientWidth; });
      assert.equal(wrapper, 0, `${view}: the page box does not scroll sideways`);
      for (const name of ['Home', 'About', 'Blog', 'Contact', 'Pricing', 'Preview the page', 'Studio Canvas', view === 'header' ? 'Sign In' : 'Someone Longname']) {
        const b = await page.getByRole('button', { name }).boundingBox();
        assert.ok(b.x >= 0 && b.x + b.width <= 390, `${view}: ${name} spans ${b.x} to ${b.x + b.width}`);
      }
      // The header grows to hold its rows: nothing hangs below it over the page.
      const below = await page.evaluate(() => {
        const h = document.querySelector('header');
        const bottom = h.getBoundingClientRect().bottom;
        return [...h.querySelectorAll('button')].filter(b => b.getBoundingClientRect().bottom > bottom + 1).map(b => b.textContent.trim());
      });
      assert.deepEqual(below, [], `${view}: buttons below the header's edge`);
      // A header of several rows is not pinned over a phone's screen.
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('header')).position), 'relative');
      if (view === 'header-user') {
        await page.getByRole('button', { name: 'Someone Longname' }).click();
        const menu = await page.getByRole('button', { name: 'Sign Out' }).evaluate(b => { const r = b.parentElement.getBoundingClientRect(); return [r.left, r.right]; });
        assert.ok(menu[0] >= 0 && menu[1] <= 390, `the account menu spans ${menu[0]} to ${menu[1]}`);
      }
      await page.close();
    }
    // A tablet gets two pinned rows, a desktop the one 68px pinned row it always had.
    for (const [width, most] of [[768, 110], [1280, 68]]) {
      const page = await openView(browser, 'header', width);
      await page.addScriptTag({ content: code });
      await page.waitForSelector('header nav');
      const box = await page.evaluate(() => { const h = document.querySelector('header'); return { height: h.getBoundingClientRect().height, position: getComputedStyle(h).position }; });
      assert.equal(box.position, 'sticky', `pinned at ${width}`);
      assert.ok(box.height <= most, `${box.height}px tall at ${width}`);
      assert.deepEqual(await page.evaluate(measure, 'header'), clean, `header at ${width}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('no em dash or spaced en dash in the files this touches', () => {
  for (const file of ['./src/components/export/ExportAssetsModal.tsx', './src/components/modals/BlueprintModal.tsx', './src/components/public/PublicHeader.tsx']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal(source.includes('—'), false, `${file} has no em dash`);
    assert.equal(source.includes(' – '), false, `${file} has no spaced en dash`);
  }
});
