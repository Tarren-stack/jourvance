#!/usr/bin/env node
// The page builder browser check (LANDING_BUILDER_PLAN.md Wave 2): node scripts/builder-browser-check.mjs
//
// What it does, on /canvas with the starter journey, in real Chrome at 1440x900:
//   open      selects the landing page step and presses "Convert to page builder"; the builder is a
//             modal dialog, its heading takes focus
//   drop      drags the Heading palette item into the first column; the outline gains a heading
//             there and the canvas (a shadow root) shows it, then shows its text once written
//   reorder   drags the Reviews section above Offer in the outline; the outline and the canvas both
//             read Reviews first
//   device    on Mobile, sets the hero section's top padding to 8; on Desktop the field and the
//             drawn page still read 36, on Mobile 8
//   undo      Undo twice takes back the padding and the reorder, and nothing else
//   keyboard  Alt+Up moves the selected block and focus stays on its outline row; Delete removes the
//             block and never the journey step behind the builder; Control Z twice puts it back
//   close     Close writes the document into the step: the journey this browser holds (localStorage
//             jourvance_active_project) carries the builder document with the heading, the order and
//             the paddings above, and focus goes back to the button that opened the builder
//   runtime   no uncaught page error
//
// Usage: node scripts/builder-browser-check.mjs [--shots <dir>]
// Exit 0 pass, 1 a step failed, 2 could not run (Playwright or Chrome missing, the build failed, the
// port could not be bound).
//
// Safety, as scripts/canvas-browser-check.mjs: it never reads .env (Vite's envDir is an empty temp
// dir, because .env holds a live hub key), never starts server.mjs, sets preview.proxy to {} so the
// preview forwards nothing, aborts every request that is not the preview origin plus /api/ and /p/
// on it, builds into a temp dir it removes afterwards, and writes nothing inside the repo.
//
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH, CHECK_BUILDER_PORT.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { routeVerdict } from '../src/lib/canvasCheckRules.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_KEY = 'jourvance_active_project';
const PAGE_NODE = 'node-page-1';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HEADING_TEXT = 'Builder check heading';

const say = line => console.log(line);

function parseArgs(argv) {
  const opts = { shots: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shots') opts.shots = path.resolve(argv[++i] ?? '');
    else throw new Error(`Unknown argument ${argv[i]}.`);
  }
  return opts;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitUntil(fn, ms, every = 100) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) return null;
    await new Promise(r => setTimeout(r, every));
  }
}

// ---- Facts read in the page ----

/** The outline's rows, in order: id, level and accessible name. */
const outlineRows = page => page.evaluate(() =>
  [...document.querySelectorAll('dialog[open] [role="tree"] [role="treeitem"]')].map(r => ({
    id: r.getAttribute('data-node-id'),
    level: Number(r.getAttribute('aria-level')),
    name: r.getAttribute('aria-label') || ''
  })));

/** What the canvas's shadow root draws: section order, a column's children and a node's padding. */
const canvasFacts = (page, columnId, nodeId) => page.evaluate(([col, node]) => {
  const host = document.querySelector('dialog[open] [data-jvb-canvas-host]');
  const root = host && host.shadowRoot;
  if (!root) return null;
  const sections = [...root.querySelectorAll('#jvb-root > section')].map(s => ([...s.classList].find(c => c.startsWith('jvb-n-')) || '').slice(6));
  const column = root.querySelector(`.jvb-n-${col}`);
  const kids = column ? [...column.children].map(k => ({ tag: k.tagName.toLowerCase(), cls: k.className, text: (k.textContent || '').trim().slice(0, 80) })) : null;
  const target = root.querySelector(`.jvb-n-${node}`);
  const paddingTop = target ? getComputedStyle(target).paddingTop : null;
  const scripts = root.querySelectorAll('script').length;
  return { sections, kids, paddingTop, scripts, width: host.getBoundingClientRect().width };
}, [columnId, nodeId]);

/** The builder document the journey in this browser holds for the page step, or null. */
const storedBuilder = page => page.evaluate(([key, nodeId]) => {
  try {
    const project = JSON.parse(localStorage.getItem(key) || 'null');
    const node = project && Array.isArray(project.nodes) ? project.nodes.find(n => n.id === nodeId) : null;
    return node && node.data && node.data.builder ? node.data.builder : null;
  } catch {
    return null;
  }
}, [STORAGE_KEY, PAGE_NODE]);

const findIn = (doc, id) => {
  let hit = null;
  const visit = n => {
    if (hit || !n) return;
    if (n.id === id) hit = n;
    else (n.children || []).forEach(visit);
  };
  (doc?.sections || []).forEach(visit);
  return hit;
};

// ---- Drags with a real pointer (dnd-kit's pointer sensor: press, move past 6px, move, release) ----

async function pointerDrag(page, from, toBox, { settle = 120 } = {}) {
  const a = await from.boundingBox();
  if (!a) throw new Error('the thing to drag is not on screen');
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 14, ay + 6, { steps: 4 });
  await page.waitForTimeout(settle);
  const b = typeof toBox === 'function' ? await toBox() : toBox;
  if (!b) {
    await page.mouse.up();
    throw new Error('the drop target never appeared');
  }
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await page.waitForTimeout(settle);
  await page.mouse.move(b.x + 1, b.y + 1, { steps: 2 });
  await page.waitForTimeout(settle);
  await page.mouse.up();
  await page.waitForTimeout(settle * 2);
}

// ---- The run ----

async function runChecks(browser, origin, shots, blocked) {
  const results = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => {
    const req = route.request();
    if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
    try {
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.origin === origin && /^\/api\/journey\/[^/]+$/.test(u.pathname)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, journey: null }) });
      }
    } catch {}
    blocked.push(`${req.method()} ${req.url().slice(0, 80)}`);
    return route.abort();
  });
  await context.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('jv-builder-check-seeded')) return;
    sessionStorage.setItem('jv-builder-check-seeded', '1');
    localStorage.setItem(key, value);
  }, [STORAGE_KEY, JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err?.message || err)));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  const shot = async name => {
    if (!shots) return;
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  };

  const step = async (name, fn) => {
    try {
      const notes = await fn();
      results.push({ name, ok: true, notes: notes || '' });
      say(`ok    ${name}${notes ? `: ${notes}` : ''}`);
      return true;
    } catch (err) {
      results.push({ name, ok: false, notes: String(err?.message || err) });
      say(`FAIL  ${name}: ${String(err?.message || err).split('\n')[0]}`);
      await shot(`failed-${name}`).catch(() => {});
      return false;
    }
  };

  const expect = (cond, message) => {
    if (!cond) throw new Error(message);
  };

  const dialog = page.locator('dialog[open]');
  const inspector = page.locator('dialog[open] [data-builder-inspector]');

  const ran = [];
  const go = async (name, fn) => {
    if (ran.length && ran[ran.length - 1] === false) {
      results.push({ name, ok: false, notes: 'not run: an earlier step failed' });
      say(`skip  ${name}: not run, an earlier step failed`);
      ran.push(false);
      return;
    }
    ran.push(await step(name, fn));
  };

  await go('open', async () => {
    await page.goto(`${origin}/canvas`);
    await page.waitForSelector('.react-flow__node', { timeout: 20000 });
    await page.click(`.react-flow__node[data-id="${PAGE_NODE}"]`);
    const convert = page.getByRole('button', { name: 'Convert to page builder' });
    await convert.waitFor({ state: 'visible', timeout: 8000 });
    await convert.click();
    await dialog.waitFor({ state: 'visible' });
    const heading = await page.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      const label = d && document.getElementById(d.getAttribute('aria-labelledby') || '');
      return { modal: !!d && d.matches(':modal'), label: label?.textContent?.trim(), focused: document.activeElement === label };
    });
    expect(heading.modal, 'the builder is not a modal dialog');
    expect(heading.label === 'Page builder', `the dialog is named "${heading.label}"`);
    expect(heading.focused, 'focus did not move to the builder heading');
    const facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.sections.length ? f : null;
    }, 5000);
    expect(facts, 'the canvas drew nothing');
    expect(facts.scripts === 0, 'the canvas holds a script element');
    expect(JSON.stringify(facts.sections) === JSON.stringify(['legacy-offer', 'legacy-reviews']), `the canvas sections read ${JSON.stringify(facts.sections)}`);
    await page.waitForTimeout(300);
    await shot('1-builder-open');
    return `modal dialog "Page builder", focus on its heading, canvas sections ${facts.sections.join(', ')}`;
  });

  await go('drop', async () => {
    const item = page.locator('dialog[open] button[data-palette-item="Heading"]');
    await item.scrollIntoViewIfNeeded();
    const zoneSel = '[data-zone-id="zone:legacy-offer-media:0"]';
    await pointerDrag(page, item, async () => {
      const zone = await waitUntil(() => page.$(zoneSel), 3000);
      if (!zone) return null;
      const b = await zone.boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    });
    const rows = await outlineRows(page);
    const at = rows.findIndex(r => r.id === 'legacy-offer-media');
    expect(at >= 0, 'the outline has no first column row');
    const next = rows[at + 1];
    expect(next && next.level === rows[at].level + 1 && /^Heading/.test(next.name), `the row under Column 1 is ${JSON.stringify(next)}`);
    const facts = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
    expect(facts.kids && facts.kids[0] && /jvbe-empty/.test(facts.kids[0].cls) && /^Empty heading/.test(facts.kids[0].text), `the first column's first child on the canvas is ${JSON.stringify(facts.kids && facts.kids[0])}`);
    const field = inspector.getByLabel('Text', { exact: true });
    await field.fill(HEADING_TEXT);
    const drawn = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.kids && f.kids[0] && f.kids[0].tag === 'h2' && f.kids[0].text === HEADING_TEXT ? f : null;
    }, 3000);
    expect(drawn, 'the canvas does not show the heading text');
    await shot('2-heading-dropped');
    return `outline row "${next.name}" at level ${next.level} under Column 1; canvas draws <h2>${HEADING_TEXT}</h2> first in that column`;
  });

  await go('reorder', async () => {
    const reviews = page.locator('dialog[open] [role="treeitem"][data-node-id="legacy-reviews"]');
    const offer = page.locator('dialog[open] [role="treeitem"][data-node-id="legacy-offer"]');
    // The outline sits under the palette in the left panel: bring both rows into view first.
    await page.evaluate(() => {
      const panel = document.querySelector('dialog[open] [data-view="blocks"]');
      if (panel) panel.scrollTop = panel.scrollHeight;
    });
    await page.waitForTimeout(100);
    await pointerDrag(page, reviews, async () => {
      const b = await offer.boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    });
    const top = (await outlineRows(page)).filter(r => r.level === 1).map(r => r.id);
    expect(JSON.stringify(top) === JSON.stringify(['legacy-reviews', 'legacy-offer']), `the outline's sections read ${JSON.stringify(top)}`);
    const facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.sections[0] === 'legacy-reviews' ? f : null;
    }, 3000);
    expect(facts, 'the canvas did not redraw Reviews first');
    await shot('3-sections-reordered');
    return `outline and canvas both read ${facts.sections.join(', ')}`;
  });

  await go('device', async () => {
    const devices = dialog.getByRole('radiogroup', { name: 'Editing for' });
    await devices.getByRole('radio', { name: 'Mobile' }).click();
    await page.click('dialog[open] [role="treeitem"][data-node-id="legacy-offer"]');
    await inspector.getByRole('tab', { name: 'Style' }).click();
    const padding = inspector.getByLabel('Padding top (px)', { exact: true });
    await padding.fill('8');
    const mobile = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.paddingTop === '8px' ? f : null;
    }, 3000);
    expect(mobile, 'the mobile canvas does not draw 8px of top padding');
    expect(Math.round(mobile.width) === 390, `the mobile canvas is ${mobile.width}px wide, not 390`);
    const hint = await inspector.getByText('Set for mobile only.').count();
    expect(hint >= 1, 'the field does not say it is set for mobile only');
    await shot('4-mobile-padding');
    await devices.getByRole('radio', { name: 'Desktop' }).click();
    const desktop = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.paddingTop === '36px' ? f : null;
    }, 3000);
    expect(desktop, 'the desktop canvas lost its 36px top padding');
    const desktopField = await inspector.getByLabel('Padding top (px)', { exact: true }).inputValue();
    expect(desktopField === '36', `the desktop field reads ${desktopField}`);
    await devices.getByRole('radio', { name: 'Mobile' }).click();
    const back = await inspector.getByLabel('Padding top (px)', { exact: true }).inputValue();
    expect(back === '8', `the mobile field reads ${back} after switching back`);
    await devices.getByRole('radio', { name: 'Desktop' }).click();
    await shot('5-desktop-unchanged');
    return `mobile draws 8px at ${Math.round(mobile.width)}px wide; desktop field and drawing still 36`;
  });

  await go('undo', async () => {
    const undo = dialog.getByRole('button', { name: 'Undo', exact: true });
    await undo.click();
    await undo.click();
    const top = (await outlineRows(page)).filter(r => r.level === 1).map(r => r.id);
    expect(JSON.stringify(top) === JSON.stringify(['legacy-offer', 'legacy-reviews']), `after two undos the outline reads ${JSON.stringify(top)}`);
    const devices = dialog.getByRole('radiogroup', { name: 'Editing for' });
    await devices.getByRole('radio', { name: 'Mobile' }).click();
    const mobile = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.paddingTop === '24px' ? f : null;
    }, 3000);
    expect(mobile, 'after two undos the mobile top padding is not back to 24px');
    expect(mobile.kids && mobile.kids[0] && mobile.kids[0].text === HEADING_TEXT, 'undo took the heading away too');
    await devices.getByRole('radio', { name: 'Desktop' }).click();
    const saved = await waitUntil(async () => (await page.getAttribute('[data-builder-save-state]', 'data-builder-save-state')) === 'saved', 5000);
    expect(saved, 'the save chip never read Saved after the autosave delay');
    await shot('6-after-undo');
    return 'sections back to Offer, Reviews; mobile padding back to 24px; heading kept; chip reads Saved';
  });

  // Found while exploring: React re-rendered inside the Delete keydown, the focused row left the page,
  // and the journey map's own Delete (React Flow) took the key as its own and deleted the STEP.
  await go('keyboard', async () => {
    await page.evaluate(() => {
      const panel = document.querySelector('dialog[open] [data-view="blocks"]');
      if (panel) panel.scrollTop = panel.scrollHeight;
    });
    const row = page.locator('dialog[open] [role="treeitem"][data-node-id="legacy-checkout"]');
    await row.click();
    await row.focus();
    await page.keyboard.press('Alt+ArrowUp');
    let facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-copy', 'legacy-offer');
      return f && f.kids && /legacy-checkout/.test(f.kids[0]?.cls || '') ? f : null;
    }, 3000);
    expect(facts, 'Alt+ArrowUp did not move the checkout button up');
    await page.waitForTimeout(100);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-node-id'));
    expect(focused === 'legacy-checkout', `after the move focus is on ${focused}, not the moved row`);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      open: !!document.querySelector('dialog[open]'),
      step: !!document.querySelector('.react-flow__node[data-id="node-page-1"]')
    }));
    expect(after.step, 'Delete in the builder deleted the journey step');
    expect(after.open, 'Delete in the builder closed it');
    facts = await canvasFacts(page, 'legacy-offer-copy', 'legacy-offer');
    expect(facts.kids && !facts.kids.some(k => /legacy-checkout/.test(k.cls)), 'Delete did not remove the selected block');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-copy', 'legacy-offer');
      return f && f.kids && f.kids.length === 2 && /legacy-checkout/.test(f.kids[1]?.cls || '') ? f : null;
    }, 3000);
    expect(facts, 'two undos did not put the checkout button back in its place');
    await waitUntil(async () => (await page.getAttribute('[data-builder-save-state]', 'data-builder-save-state')) === 'saved', 5000);
    return 'Alt+ArrowUp moved it and kept focus on its row; Delete removed only the block, the step and the builder stayed; Control Z twice restored it';
  });

  await go('close', async () => {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 5000 });
    const focus = await page.evaluate(() => (document.activeElement && document.activeElement.textContent || '').trim());
    expect(focus === 'Open page builder', `focus went to "${focus}", not back to the opener`);
    const doc = await waitUntil(async () => {
      const b = await storedBuilder(page);
      const media = findIn(b, 'legacy-offer-media');
      return b && media && media.children[0] && media.children[0].props && media.children[0].props.text === HEADING_TEXT ? b : null;
    }, 8000, 200);
    expect(doc, 'the journey in this browser never held the builder document with the heading');
    const order = doc.sections.map(s => s.id);
    expect(JSON.stringify(order) === JSON.stringify(['legacy-offer', 'legacy-reviews']), `the stored order is ${JSON.stringify(order)}`);
    const hero = findIn(doc, 'legacy-offer');
    expect(hero.style.desktop.paddingTop === 36, `stored desktop padding ${hero.style.desktop.paddingTop}`);
    expect(hero.style.mobile && hero.style.mobile.paddingTop === 24, `stored mobile padding ${hero.style.mobile && hero.style.mobile.paddingTop}`);
    const media = findIn(doc, 'legacy-offer-media');
    expect(media.children[0].type === 'heading', 'the stored first child is not a heading');
    await page.waitForTimeout(200);
    await shot('7-closed');
    return `stored builder: sections ${order.join(', ')}; Column 1 starts with heading "${media.children[0].props.text}"; desktop padding 36, mobile 24; focus back on "Open page builder"`;
  });

  await go('runtime', async () => {
    expect(errors.length === 0, `page errors: ${errors.slice(0, 3).join(' | ')}`);
    return 'no uncaught page error';
  });

  await context.close();
  return results;
}

async function main(cleanup) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    say(`check:builder could not run. ${err.message}`);
    return 2;
  }
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) {
    say(`check:builder could not run. Playwright was not found at ${pwPath}.`);
    return 2;
  }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) {
    say(`check:builder could not run. Chrome was not found at ${chromePath}.`);
    return 2;
  }
  const { chromium } = await import(pathToFileURL(pwPath).href);
  if (opts.shots) fs.mkdirSync(opts.shots, { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-builder-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-builder-env-'));
  cleanup.dirs.push(work, envDir);
  const outDir = path.join(work, 'dist');
  try {
    await build({ root: ROOT, envDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:builder could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  let origin;
  let port;
  try {
    port = Number(process.env.CHECK_BUILDER_PORT) || (await freePort());
    const server = await preview({
      root: ROOT,
      envDir,
      logLevel: 'warn',
      build: { outDir },
      preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, open: false }
    });
    cleanup.server = server;
    origin = new URL(server.resolvedUrls.local[0]).origin;
  } catch (err) {
    say(`check:builder could not run. The preview could not bind port ${port ?? 'on 127.0.0.1'}: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;
  const blocked = [];
  say('Page builder browser check: /canvas at 1440x900.');
  const results = await runChecks(browser, origin, opts.shots, blocked);
  const failed = results.filter(r => !r.ok);
  say(`${results.length - failed.length} of ${results.length} steps passed.`);
  const hosts = [...new Set(blocked.map(b => b.split(' ')[1]?.split('/')[2] ?? ''))].filter(Boolean).sort();
  say(`Blocked ${blocked.length} outside requests (${hosts.join(', ') || 'none'}). Nothing reached a server.`);
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cleanup = { dirs: [], server: null, browser: null, done: false };
  const finish = async () => {
    if (cleanup.done) return;
    cleanup.done = true;
    await cleanup.browser?.close().catch(() => {});
    await cleanup.server?.close().catch(() => {});
    for (const d of cleanup.dirs) fs.rmSync(d, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      finish().finally(() => process.exit(2));
    });
  }
  main(cleanup)
    .catch(err => {
      say(`check:builder could not run. ${String(err?.message || err).split('\n')[0]}`);
      return 2;
    })
    .then(async code => {
      await finish();
      process.exit(code);
    });
}
