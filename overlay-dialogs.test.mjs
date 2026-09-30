import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The header overlays (Sign In, Connect Shopify, Blueprints, Save as Blueprint, Export Assets,
// Shopify Sync, Billing) and the publish success panel are modal dialogs: each renders through
// ModalDialog, so it is announced by its heading, focus moves in, Tab stays inside, Escape closes
// it and focus goes back to what opened it. They were plain fixed divs: focus stayed behind them,
// Tab walked the hidden page and Escape did nothing.
//
// The first half pins the wiring in each file. The second half renders ModalDialog in real Chrome
// (bundled with esbuild, which Vite already ships) and drives it from the keyboard; it skips when
// Chrome or Playwright is not on this machine.

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const OVERLAYS = [
  { file: './src/components/auth/AuthModal.tsx', heading: 'Welcome Back' },
  { file: './src/components/shopify/ShopifyConnectModal.tsx', heading: 'Shopify Integration & Telemetry' },
  { file: './src/components/modals/BlueprintModal.tsx', heading: 'Journey Blueprint Library' },
  { file: './src/components/modals/SaveBlueprintModal.tsx', heading: 'Save Canvas as Blueprint' },
  { file: './src/components/export/ExportAssetsModal.tsx', heading: 'Export Production Assets' },
  { file: './src/components/modals/ShopifySyncModal.tsx', heading: 'Shopify Automation & Attribution Hub' },
  { file: './src/components/preview/PublishModal.tsx', heading: 'Funnel Successfully Published!' },
  { file: './src/components/billing/BillingModal.tsx', heading: 'Jourvance Growth Pro' }
];

for (const { file, heading } of OVERLAYS) {
  test(`${file} renders through ModalDialog, named by its heading`, () => {
    const source = read(file);
    assert.ok(/^import \{ ModalDialog \} from '\.{1,2}\/(modals\/)?ModalDialog';$/m.test(source), 'imports ModalDialog');
    const title = /^const TITLE_ID = '([\w-]+)';$/m.exec(source);
    assert.ok(title, 'declares one TITLE_ID');
    const returned = source.slice(source.lastIndexOf('\n  return (\n'));
    assert.ok(/^\n  return \(\n    <ModalDialog bare labelledBy=\{TITLE_ID\} onClose=\{/.test(returned), 'the returned element is the ModalDialog');
    assert.ok(returned.trimEnd().endsWith('</ModalDialog>\n  );\n};'), 'and it closes last');
    // The old shape: a full-screen fixed div as the backdrop, with no dialog semantics.
    assert.ok(!/\n    <div\n      style=\{\{\n        position: 'fixed',\n        inset: 0/.test(source), 'no fixed backdrop div left');
    // The id sits on the heading whose text is the dialog's name.
    const tag = new RegExp(`<(h[1-4]) id=\\{TITLE_ID\\}[^>]*>\\s*(\\{[^}]*\\?\\s*')?${heading.replace(/[.*+?^${}()|[\]\\!&]/g, '\\$&')}`);
    assert.ok(tag.test(source), `the heading "${heading}" carries id={TITLE_ID}`);
    assert.equal(source.split('id={TITLE_ID}').length - 1, 1, 'exactly one element carries the title id');
  });

  test(`${file} gives every icon-only close button a name`, () => {
    const source = read(file);
    // An <X /> icon alone inside a button: the focused first control of the dialog on open.
    const buttons = source.match(/<button\b[^]*?<\/button>/g) || [];
    const iconOnly = buttons.filter(b => /<X size=\{\d+\} \/>\s*<\/button>$/.test(b) && !/>\s*[A-Za-z]/.test(b.replace(/<X size=\{\d+\} \/>/, '').replace(/<button\b[^>]*>/, '')));
    assert.ok(iconOnly.length > 0, 'has an icon close button');
    for (const b of iconOnly) assert.ok(/aria-label="[^"]+"/.test(b), `named: ${b.slice(0, 80)}`);
  });
}

test('the publish success panel hands focus back to Publish Funnel, which was disabled while it worked', () => {
  const source = read('./src/components/preview/PublishModal.tsx');
  assert.ok(source.includes("fallbackFocusSelectors={['[data-publish-trigger]', '#journey-map']}"));
});

test('the More-menu overlays fall back to the More button', () => {
  for (const file of ['./src/components/modals/BlueprintModal.tsx', './src/components/modals/SaveBlueprintModal.tsx', './src/components/export/ExportAssetsModal.tsx', './src/components/modals/ShopifySyncModal.tsx']) {
    assert.ok(read(file).includes("fallbackFocusSelectors={['[data-more-trigger]']}"), file);
  }
});

test('Escape in the blueprint library cancels the load prompt before it closes the library', () => {
  const source = read('./src/components/modals/BlueprintModal.tsx');
  assert.ok(source.includes('onClose={() => (showConfirmPrompt ? setShowConfirmPrompt(false) : onClose())}'));
  assert.ok(/ref=\{confirmRef\}/.test(source), 'the prompt is the element focus moves into');
});

test('no em dash or spaced en dash in the files this touches', () => {
  for (const file of [...OVERLAYS.map(o => o.file), './src/components/modals/ModalDialog.tsx', './src/lib/a11yHooks.ts']) {
    const source = read(file);
    assert.equal(source.includes('—'), false, `${file} has no em dash`);
    assert.equal(source.includes(' – '), false, `${file} has no spaced en dash`);
  }
});

// ---- ModalDialog in a real browser ----

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

// A page with an opener, a Publish button that is disabled while it works and then opens the
// dialog (focus is on the body by then, as in the app), a load prompt inside the dialog that the
// dialog's onClose cancels first, and a panel narrower than the dialog so a click beside it lands
// on the bare dialog itself.
const HARNESS = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModalDialog } from './src/components/modals/ModalDialog.tsx';

function App() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [working, setWorking] = useState(false);
  const publish = () => {
    setWorking(true);
    setTimeout(() => { setWorking(false); setOpen(true); }, 50);
  };
  return React.createElement('div', null,
    React.createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Open'),
    React.createElement('button', { id: 'publish', 'data-publish-trigger': '', disabled: working, onClick: publish }, 'Publish'),
    React.createElement('button', { id: 'behind' }, 'Behind'),
    React.createElement('div', { id: 'journey-map', tabIndex: -1 }, 'Map'),
    open && React.createElement(ModalDialog, {
      bare: true,
      labelledBy: 'harness-title',
      maxWidth: 400,
      fallbackFocusSelectors: ['[data-publish-trigger]', '#journey-map'],
      onClose: () => (prompt ? setPrompt(false) : setOpen(false))
    },
      React.createElement('div', { id: 'panel', style: { width: '50%', background: '#fff', padding: 8 } },
        React.createElement('h2', { id: 'harness-title' }, 'Harness dialog'),
        React.createElement('button', { id: 'first' }, 'First'),
        React.createElement('button', { id: 'show-prompt', onClick: () => setPrompt(true) }, 'Show prompt'),
        prompt && React.createElement('p', { id: 'prompt' }, 'Load prompt'),
        React.createElement('button', { id: 'last' }, 'Last')
      )
    )
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
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent'
  });
  return out.outputFiles[0].text;
}

test('ModalDialog is a named modal: focus in, Tab trapped, Escape closes, focus back, click beside a bare panel closes', async t => {
  const browser = await loadBrowser();
  if (!browser) return t.skip('Chrome or Playwright is not available here');
  try {
    const script = await bundle();
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: script });
    const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    const isOpen = () => page.evaluate(() => !!document.querySelector('dialog[open]'));

    // Open from the keyboard.
    await page.focus('#opener');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog[open]');
    const info = await page.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      return { modal: d.matches(':modal'), name: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent };
    });
    assert.deepEqual(info, { modal: true, name: 'Harness dialog' });
    assert.equal(await active(), 'first', 'focus moves to the first control');
    const walked = [];
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); walked.push(await active()); }
    assert.deepEqual(walked, ['show-prompt', 'last', 'first', 'show-prompt', 'last'], 'Tab stays inside');
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(), false, 'Escape closes');
    assert.equal(await active(), 'opener', 'focus goes back to the opener');

    // An onClose that closes something inside the dialog leaves it open, and the next Escape still works.
    await page.click('#opener');
    await page.waitForSelector('dialog[open]');
    await page.click('#show-prompt');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#prompt').count(), 0, 'the first Escape cancels the prompt');
    assert.equal(await isOpen(), true, 'and leaves the dialog open');
    await page.waitForTimeout(20);
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(), false, 'the second Escape closes the dialog');

    // A click on the bare dialog beside its panel is a click outside the panel.
    await page.click('#opener');
    await page.waitForSelector('dialog[open]');
    const box = await page.evaluate(() => {
      const d = document.querySelector('dialog[open]').getBoundingClientRect();
      const p = document.getElementById('panel').getBoundingClientRect();
      return { x: (p.right + d.right) / 2, y: p.top + 10 };
    });
    await page.click('#panel h2');
    assert.equal(await isOpen(), true, 'a click inside the panel keeps it open');
    await page.mouse.click(box.x, box.y);
    assert.equal(await isOpen(), false, 'a click beside the panel closes it');

    // Opened while focus was on the body (Publish was disabled): focus goes to the fallback.
    await page.focus('#publish');
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog[open]');
    await page.keyboard.press('Escape');
    assert.equal(await active(), 'publish', 'focus goes to the first fallback that is on the page');
  } finally {
    await browser.close();
  }
});
