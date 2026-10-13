#!/usr/bin/env node
// The bottom-right overlap check: npm run check:overlaps.
//
// The Ask Jourvance bubble is fixed at the window's bottom right. Three controls can sit in the same
// corner: the edge inspector's "Disconnect Step Connection" (a line is selected), the canvas rule
// notice's "Dismiss" (when the notice docks to the window foot on a phone), and the step dock's
// "Next" (the finder's arrow). Each surface sets data-jv-bottom-surface on <html> while it shows
// (src/lib/bottomSurface.ts) and the bubble's CSS lifts it (src/index.css).
//
// At 320, 390, 768 and 1280 wide this loads the BUILT app on /canvas with the default journey, and
// for each surface it scrolls the named button to the window foot (the worst place it can be),
// reads both rectangles and asserts: the bubble does not intersect the button, the bubble is
// visible, inside the window and takes a click (a trial click and elementFromPoint at its centre),
// the attribute is present while the surface shows and absent after it closes.
//
// Safety, as scripts/assistant-browser-check.mjs: server.mjs is never started, Vite's envDir and
// cacheDir are empty temp dirs (no .env, no hub key), the preview proxies nothing, every request
// that is not the preview origin and every /api and /p call is aborted, the build goes to a temp
// dir that is removed on exit, nothing is written inside the repo.
//
// Env: CHROME_PATH, PLAYWRIGHT_MODULE, OVERLAP_SHOTS (a directory for screenshots),
// OVERLAP_MEASURE=1 (print each button's distance from the window foot, for choosing the rise).
// Exit 0 every assertion passed, 1 a finding, 2 the check could not run.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const say = line => console.log(line);
const ATTR = 'data-jv-bottom-surface';
const VIEWPORTS = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }];

let asserted = 0;
const findings = [];
function check(name, ok, detail = '') {
  asserted++;
  if (ok) say(`  ok   ${name}`);
  else {
    findings.push(`${name}${detail ? ` (${detail})` : ''}`);
    say(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
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

const intersects = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const rectOf = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });

async function openCanvas(browser, origin, viewport, seed) {
  const context = await browser.newContext({ viewport });
  const blocked = [];
  const consoleErrors = [];
  await context.route('**/*', route => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin !== origin) { blocked.push(req.url()); return route.abort(); }
    if (u.pathname === '/api' || u.pathname.startsWith('/api/') || u.pathname === '/p' || u.pathname.startsWith('/p/')) { blocked.push(req.url()); return route.abort(); }
    return route.continue();
  });
  await context.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('jv-overlap-seeded')) return;
      sessionStorage.setItem('jv-overlap-seeded', '1');
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    ['jourvance_active_project', JSON.stringify(seed)]
  );
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err?.message || err).split('\n')[0]}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (/Failed to load resource/.test(msg.text()) && blocked.includes(msg.location().url)) return;
    consoleErrors.push(msg.text().split('\n')[0]);
  });
  await page.goto(`${origin}/canvas`);
  await page.waitForSelector('.react-flow__node', { timeout: 20000 });
  await page.locator('.jv-assistant-bubble').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  return { context, page, consoleErrors };
}

const attrOf = page => page.evaluate(a => document.documentElement.getAttribute(a), ATTR);

/** The bubble against one named button, at the window foot: not touching, visible, in the window, clickable. */
async function judge(page, tag, button, viewport, { scroll = true } = {}) {
  const bubble = page.locator('.jv-assistant-bubble');
  if (scroll) {
    // The worst place a bottom control can be is flush with the window foot. (The docked notice is
    // fixed to the window already, and scrolling would only undock it.)
    await button.scrollIntoViewIfNeeded();
    await button.evaluate(el => el.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await page.waitForTimeout(500);
  }
  const b = await button.boundingBox();
  const q = await bubble.boundingBox();
  check(`${tag}: both rectangles are measurable`, !!b && !!q, JSON.stringify({ b, q }));
  if (!b || !q) return;
  if (process.env.OVERLAP_MEASURE) say(`  MEASURE ${tag}: button top is ${Math.round(viewport.height - b.y)}px above the window foot, ${Math.round(b.width)}x${Math.round(b.height)}; bubble bottom edge ${Math.round(viewport.height - q.y - q.height)}px above it, attr=${await attrOf(page)}`);
  check(`${tag}: the bubble does not intersect the button`, !intersects(rectOf(q), rectOf(b)), JSON.stringify({ bubble: q, button: b }));
  check(`${tag}: the bubble is visible`, await bubble.isVisible());
  check(`${tag}: the bubble is inside the window`, q.x >= 0 && q.y >= 0 && q.x + q.width <= viewport.width && q.y + q.height <= viewport.height, JSON.stringify(q));
  const top = await page.evaluate(() => {
    const el = document.querySelector('.jv-assistant-bubble');
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && (at === el || el.contains(at));
  });
  check(`${tag}: the bubble is the top element at its own centre`, top);
  let clickable = true;
  try { await bubble.click({ trial: true, timeout: 3000 }); } catch { clickable = false; }
  check(`${tag}: the bubble takes a click (trial)`, clickable);
}

async function edgeSurface(browser, origin, viewport, seed, shots) {
  const tag = `${viewport.width}px Disconnect Step Connection`;
  say(tag);
  const { context, page, consoleErrors } = await openCanvas(browser, origin, viewport, seed);
  try {
    check(`${tag}: only the dock (when stacked) is counted before a line is chosen`, (await attrOf(page)) === (viewport.width < 768 ? '1' : null), String(await attrOf(page)));
    await page.locator('.react-flow__edge').first().dispatchEvent('click');
    const button = page.getByRole('button', { name: 'Disconnect Step Connection' });
    await button.waitFor({ state: 'attached', timeout: 5000 });
    check(`${tag}: the edge inspector adds to the count while it is open`, (await attrOf(page)) === (viewport.width < 768 ? '2' : '1'), String(await attrOf(page)));
    await judge(page, tag, button, viewport);
    if (shots) await page.screenshot({ path: path.join(shots, `edge-${viewport.width}.png`) });
    // Close the line panel (its Close button) and the count goes back to the dock alone.
    await page.locator('.jv-step-dock').getByRole('button', { name: /^Close/ }).first().click();
    await page.waitForTimeout(300);
    check(`${tag}: the count returns to the dock's own after the line panel closes`, (await attrOf(page)) === (viewport.width < 768 ? '1' : null), String(await attrOf(page)));
    check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (err) {
    findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    if (shots) await page.screenshot({ path: path.join(shots, `failed-edge-${viewport.width}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function dockSurface(browser, origin, viewport, seed, shots) {
  const tag = `${viewport.width}px step dock Next`;
  say(tag);
  const { context, page, consoleErrors } = await openCanvas(browser, origin, viewport, seed);
  try {
    if (viewport.width >= 768) {
      // Beside the map the dock's Next is nowhere near the window foot, so the bubble stays put.
      check(`${tag}: beside the map the dock is not counted`, (await attrOf(page)) === null, String(await attrOf(page)));
      const q = await page.locator('.jv-assistant-bubble').boundingBox();
      check(`${tag}: the bubble rests 20px above the window foot`, !!q && Math.round(viewport.height - q.y - q.height) === 20, JSON.stringify(q));
    } else {
      check(`${tag}: stacked under the map the dock is counted`, (await attrOf(page)) === '1', String(await attrOf(page)));
    }
    const next = page.locator('.jv-step-dock button[aria-label^="Next"]').first();
    await next.waitFor({ state: 'attached', timeout: 5000 });
    await judge(page, tag, next, viewport);
    if (shots) await page.screenshot({ path: path.join(shots, `dock-${viewport.width}.png`) });
    check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (err) {
    findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    if (shots) await page.screenshot({ path: path.join(shots, `failed-dock-${viewport.width}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

/** The rule notice: it docks to the window foot only on a phone, so it is asserted where it docks and its place is reported elsewhere. */
async function noticeSurface(browser, origin, viewport, seed, shots) {
  const tag = `${viewport.width}px rule notice Dismiss`;
  say(tag);
  const { context, page, consoleErrors } = await openCanvas(browser, origin, viewport, seed);
  try {
        await page.locator('.react-flow__node').first().click();
    await page.waitForTimeout(300);
    // Stacked under the map (below 768px) the person has scrolled down to the opened step, so only a
    // strip of map shows: that is where the notice has no room and docks to the window foot (U01).
    await page.evaluate(() => {
      const layout = document.querySelector('.jv-canvas-layout');
      const pane = document.querySelector('.jv-canvas-pane');
      if (layout && pane && layout.scrollHeight > layout.clientHeight) layout.scrollTop = Math.max(0, pane.getBoundingClientRect().height - 120);
    });
    await page.waitForTimeout(400);
    // A click on one of the selected step's dots starts a line and the notice tells the person to
    // choose a dot on another step, with Dismiss beside it.
    await page.locator('.react-flow__node').first().locator('.react-flow__handle.source').first().dispatchEvent('click');
    const dismiss = page.locator('[data-rule-notice]').locator('xpath=..').getByRole('button', { name: 'Dismiss', exact: true });
    await dismiss.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    const docked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Dismiss');
      let el = b?.parentElement?.parentElement;
      return el ? getComputedStyle(el).position === 'fixed' : false;
    });
    say(`  info ${tag}: the notice is ${docked ? 'docked to the window foot' : 'in the map (not at the window foot)'}`);
    if (shots) await page.screenshot({ path: path.join(shots, `notice-state-${viewport.width}.png`) });
    if (viewport.width <= 390) check(`${tag}: the notice docks to the window foot on a phone`, docked);
    if (docked) {
      check(`${tag}: the notice adds to the count while docked`, Number(await attrOf(page)) >= 2, String(await attrOf(page)));
      await judge(page, tag, dismiss, viewport, { scroll: false });
      if (shots) await page.screenshot({ path: path.join(shots, `notice-${viewport.width}.png`) });
    } else {
      // Not at the foot: the bubble must still be clear of it wherever it is.
      const b = await dismiss.boundingBox();
      const q = await page.locator('.jv-assistant-bubble').boundingBox();
      check(`${tag}: the bubble does not intersect Dismiss`, !!b && !!q && !intersects(rectOf(q), rectOf(b)), JSON.stringify({ b, q }));
    }
    await dismiss.click();
    await page.waitForTimeout(300);
    check(`${tag}: the notice's count is gone after Dismiss`, (await attrOf(page)) === (viewport.width < 768 ? '1' : null), String(await attrOf(page)));
    check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (err) {
    findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    if (shots) await page.screenshot({ path: path.join(shots, `failed-notice-${viewport.width}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function main(cleanup) {
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) { say(`check:overlaps could not run. Playwright was not found at ${pwPath}.`); return 2; }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) { say(`check:overlaps could not run. Chrome was not found at ${chromePath}.`); return 2; }
  const { chromium } = await import(pathToFileURL(pwPath).href);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-overlap-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-overlap-env-'));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-overlap-cache-'));
  cleanup.dirs.push(work, envDir, cacheDir);
  const shots = process.env.OVERLAP_SHOTS || null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const outDir = path.join(work, 'dist');

  try {
    await build({ root: ROOT, envDir, cacheDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:overlaps could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  let origin;
  try {
    const port = await freePort();
    const server = await preview({ root: ROOT, envDir, cacheDir, logLevel: 'warn', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, open: false } });
    cleanup.servers.push(server);
    origin = new URL(server.resolvedUrls.local[0]).origin;
  } catch (err) {
    say(`check:overlaps could not run. The preview server could not start: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/defaultBlueprint.ts')).href);

  {
    // Off the canvas no surface is showing, so the bubble keeps its own place.
    const tag = 'public page';
    say(tag);
    const context = await browser.newContext({ viewport: VIEWPORTS[1] });
    const page = await context.newPage();
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      return u.origin === origin && !u.pathname.startsWith('/api/') ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/`);
    await page.locator('.jv-assistant-bubble').waitFor({ state: 'visible', timeout: 20000 });
    check(`${tag}: no bottom surface is counted off the canvas`, (await attrOf(page)) === null, String(await attrOf(page)));
    const q = await page.locator('.jv-assistant-bubble').boundingBox();
    check(`${tag}: the bubble rests 20px above the window foot`, !!q && Math.round(VIEWPORTS[1].height - q.y - q.height) === 20, JSON.stringify(q));
    await context.close();
  }
  for (const viewport of VIEWPORTS) {
    await edgeSurface(browser, origin, viewport, DEFAULT_LEAD_CAPTURE_PROJECT, shots);
    await dockSurface(browser, origin, viewport, DEFAULT_LEAD_CAPTURE_PROJECT, shots);
    await noticeSurface(browser, origin, viewport, DEFAULT_LEAD_CAPTURE_PROJECT, shots);
  }

  say('');
  say(`Assertions: ${asserted}. Findings: ${findings.length}.`);
  if (shots) say(`Screenshots: ${shots}`);
  if (findings.length) { say('FINDINGS:'); for (const f of findings) say(`  - ${f}`); }
  return findings.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cleanup = { dirs: [], servers: [], browser: null, done: false };
  const finish = async () => {
    if (cleanup.done) return;
    cleanup.done = true;
    await cleanup.browser?.close().catch(() => {});
    for (const s of cleanup.servers) await s.close().catch(() => {});
    for (const d of cleanup.dirs) fs.rmSync(d, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { finish().finally(() => process.exit(2)); });
  main(cleanup)
    .catch(err => { say(`check:overlaps could not run. ${String(err?.message || err).split('\n')[0]}`); return 2; })
    .then(async code => { await finish(); process.exit(code); });
}
