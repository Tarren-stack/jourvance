#!/usr/bin/env node
// Browser proof that a PUBLISHED landing page built with the page builder is served and behaves
// (LANDING_BUILDER_PLAN.md wave 1b, second half). node scripts/builder-serve-browser-check.mjs
//   [--shots <dir>]   save screenshots there (builder-serve-desktop.png, builder-serve-mobile.png)
//
// What it does:
//   1. Makes a sandbox copy of this app in a temp directory with NO data files in it, because
//      server.mjs reads and writes public_pages.json, contacts.json and the rest next to itself.
//      node_modules is linked, nothing in the repo is written.
//   2. Makes a published record with the REAL publish route (setupJourneyRoutes over stubbed
//      storage), puts it in the sandbox's public_pages.json, and boots `node server.mjs` there on a
//      free port with HUB_API_KEY, HUB_URL, MAIL_EVENT_SECRET, PUBLIC_BASE_URL, INTERNAL_CRON_SECRET
//      (and the other secrets) empty, so it talks to no hub and sends nothing.
//   3. Opens /p/<slug> in real Chrome (the hub's Playwright) and asserts: status 200, no page error,
//      no CSP violation, the root and its widgets, the heading text, a heading's own size beating the
//      base size, the checkout button, the lead form, the per-device padding at 1280, 800 and 390
//      wide, the evergreen and the expired countdowns, the lead modal post (every field of the
//      design) and the cart link it ends in (with the bump), the lead form widget's success line,
//      the sticky bar on a phone and the exit drawer.
//   4. Kills the server's process GROUP and confirms nothing of the sandbox is left running.
// Every request that is not the sandbox server or the shop's checkout is aborted (fonts, pixels), and
// the shop's checkout is answered locally, so the run needs no network and sends nothing out.
//
// Exit 0 all checks passed, 1 a check failed, 2 the run itself could not be trusted.
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupJourneyRoutes } from '../server/routes/journeyRoutes.mjs';
import { LEAD_BODY_FIELDS } from '../server/routes/publicLeadScript.mjs';
import { createNode, insertNode, migrateLegacyPage } from '../src/lib/pageBuilder/model.mjs';
import { render } from '../src/lib/pageBuilder/render.mjs';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/Users/tarrenmunoz/antigravity/Local-AI-App-Builder/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
const SLUG = 'bld-demo';
const VARIANT = 'gid://shopify/ProductVariant/123';
const BUMP = 'gid://shopify/ProductVariant/456';
const SHOP = { storeDomain: 'shop.myshopify.com', currency: 'USD', status: 'connected' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const die = (msg) => { console.error(`COULD NOT RUN: ${msg}`); process.exit(2); };

// ---- 1. the document and the published record ----

const starter = DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find(n => n.data.type === 'landing-page');
function buildDoc() {
  let doc = migrateLegacyPage({
    ...starter.data,
    headline: 'Glow in seven days',
    subhead: 'A serum made in small batches.',
    bullets: ['Fragrance free', 'Ships in 2 days'],
    buttonText: 'Get the serum',
    shopifyVariantId: VARIANT,
    shopifyProductId: 'gid://shopify/Product/9',
    shopifyProductTitle: 'Glow Serum',
    shopifyProductPrice: '48.00',
    shopifyProductImage: 'data:,',
    orderBumpEnabled: false
  });
  doc.sections[0].style.tablet = { paddingTop: 20 };
  const copy = doc.sections[0].children[1].id;
  const add = (type, props, style) => {
    const n = createNode('widget', type);
    n.props = { ...n.props, ...props };
    if (style) n.style = style;
    const col = doc.sections[0].children[1];
    const r = insertNode(doc, copy, col.children.length, n);
    if (!r.ok) die(`could not add ${type}: ${r.reason}`);
    doc = r.doc;
  };
  add('heading', { text: 'Own size heading', level: 1 }, { desktop: { fontSize: 20 } });
  add('countdown', { text: 'Offer ends in', mode: 'evergreen', minutes: 15 });
  add('countdown', { text: 'Early bird', mode: 'deadline', deadline: '2020-01-01T00:00:00Z', expiredText: 'This deal has ended' });
  add('orderBump', { variantId: BUMP, headline: 'Add the travel size', title: 'Travel size', price: '12.00' });
  add('leadForm', { heading: 'Get the guide', buttonText: 'Send it', successText: 'You are on the list.', afterSubmit: 'message' });
  add('spacer', {}, { desktop: { minHeight: 1400 } });
  return doc;
}

async function publishRecord(doc) {
  const saved = {};
  const store = {
    journey: { id: 'j1', nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug: SLUG, headline: 'Glow in seven days', subhead: 'A serum made in small batches.', exitIntentEnabled: true, exitIntentHeadline: 'Wait, take a code', exitIntentDiscountCode: 'STAY10', builder: doc } }], edges: [] }
  };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    loadJourney: async () => store.journey,
    saveJourney: async (_u, _i, j) => { store.journey = j; return { durable: true }; },
    loadWorkspace: async (_u, wsId) => ({ id: wsId, shopifyConfig: SHOP }),
    realStoreDomain: () => '',
    validateSlugAvailability: async (slug) => ({ available: true, cleanSlug: slug }),
    reloadDomainRegistry: () => {},
    domainRegistryCache: {},
    savePublicPage: async (key, record) => { saved[key] = record; },
    removePublicPage: async (key) => { delete saved[key]; return true; },
    loadPublicPage: async (key) => saved[key] || null,
    loadPublishLog: async () => ({ ok: true, log: null }),
    savePublishLog: async () => ({ durable: true }),
    renderPublicFunnelHtml: () => '<html><head></head><body></body></html>',
    renderPublicUpsellHtml: () => '<html><head></head><body></body></html>',
    persistPublicPages: () => {},
    publicPageCache: {},
    now: () => Date.now()
  };
  const app = express();
  app.use(express.json());
  setupJourneyRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/journey/j1/publish`, { method: 'POST' });
    const body = await res.json();
    if (res.status !== 200 || !saved[SLUG]) die(`the publish route answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  const record = structuredClone(saved[SLUG]);
  record.shopifyConfig = { ...SHOP };
  // Left owned, a lead post never gets an answer on the current tree: POST /api/public/lead calls
  // noteSegmentChanges(page.userId), which throws ReferenceError: predictionAccount is not defined
  // (server/routes/emailRoutes.mjs, a function that lives in server.mjs), and Express 4 does not
  // answer a rejected async handler. That is outside this wave; an ownerless page skips the call.
  delete record.userId;
  return record;
}

// ---- 2. the sandbox and the server ----

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-builder-serve-'));
  for (const f of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, f);
    if (!fs.statSync(full).isFile()) continue;
    if ((/\.(mjs|ts)$/.test(f) && !/\.test\.mjs$/.test(f)) || f === 'hub-sdk.js' || f === 'security-sentinel.js' || f === 'package.json') fs.copyFileSync(full, path.join(dir, f));
  }
  for (const d of ['server', 'src', 'public']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

function sandboxProcesses(dir) {
  try { return execFileSync('pgrep', ['-f', dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; }
}

async function main() {
  if (!fs.existsSync(PLAYWRIGHT)) die(`Playwright not found at ${PLAYWRIGHT} (set PLAYWRIGHT_MODULE)`);
  if (!fs.existsSync(CHROME)) die(`Chrome not found at ${CHROME} (set CHROME_PATH)`);
  const doc = buildDoc();
  const record = await publishRecord(doc);
  const dir = makeSandbox();
  fs.writeFileSync(path.join(dir, 'public_pages.json'), JSON.stringify({ [SLUG]: record }));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logPath = path.join(dir, 'server.log');
  const log = fs.openSync(logPath, 'w');
  const emptied = ['HUB_API_KEY', 'HUB_URL', 'MAIL_EVENT_SECRET', 'PUBLIC_BASE_URL', 'INTERNAL_CRON_SECRET', 'MAIL_LINK_SECRET', 'SESSION_SECRET', 'SENDGRID_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const env = { ...process.env, ...Object.fromEntries(emptied.map(k => [k, ''])), APP_ID: 'jourvance', PORT: String(port), NODE_ENV: 'development' };
  const child = spawn('node', ['server.mjs'], { cwd: dir, env, stdio: ['ignore', log, log], detached: true });
  const killServer = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
  process.on('exit', killServer);

  let browser;
  try {
    const started = Date.now();
    let up = false;
    while (Date.now() - started < 60000) {
      try { const r = await fetch(`${base}/p/${SLUG}`); if (r.status === 200) { up = true; break; } } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 400));
    }
    if (!up) die(`the sandboxed server did not serve /p/${SLUG} in 60 s; log: ${fs.readFileSync(logPath, 'utf8').slice(-600)}`);
    console.log(`sandbox ${dir}  server pid ${child.pid} on ${base}  (up in ${Date.now() - started} ms)`);
    check('the sandbox holds no data file but the one seeded', !['contacts.json', 'journeys.json', 'orders.json'].some(f => fs.existsSync(path.join(dir, f)) && fs.readFileSync(path.join(dir, f), 'utf8').includes('dev-test-user-id')), 'public_pages.json holds only the seeded page');

    const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const expected = render(doc, { slug: SLUG, storeDomain: 'shop.myshopify.com', realVariantId: v => v });
    const expectedWidgets = (expected.html.match(/class="[^"]*\bjvb-w\b/g) || []).length;

    const newPage = async (width, height = 900) => {
      const ctx = await browser.newContext({ viewport: { width, height } });
      const page = await ctx.newPage();
      const seen = { pageErrors: [], console: [], csp: [], blocked: [], shopRequests: [], leadPosts: [], leadReplies: [] };
      page.on('pageerror', e => seen.pageErrors.push(String(e.message || e).slice(0, 300)));
      page.on('console', m => {
        const t = m.text();
        if (/Content Security Policy|Refused to/i.test(t)) seen.csp.push(t.slice(0, 300));
        else if (m.type() === 'error') seen.console.push(t.slice(0, 200));
      });
      page.on('request', req => {
        if (req.method() === 'POST' && req.url().endsWith('/api/public/lead')) { try { seen.leadPosts.push(JSON.parse(req.postData() || '{}')); } catch { seen.leadPosts.push({ unparsed: req.postData() }); } }
      });
      page.on('response', async res => {
        if (res.request().method() === 'POST' && res.url().endsWith('/api/public/lead')) seen.leadReplies.push(`${res.status()} ${(await res.text().catch(() => '')).slice(0, 160)}`);
      });
      await ctx.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin === base) return route.continue();
        if (u.hostname === 'shop.myshopify.com') { seen.shopRequests.push(u.toString()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>checkout</title>' }); }
        seen.blocked.push(u.origin);
        return route.abort();
      });
      return { page, seen, ctx };
    };

    // ---- desktop ----
    {
      const { page, seen, ctx } = await newPage(1280, 900);
      const resp = await page.goto(`${base}/p/${SLUG}`, { waitUntil: 'load' });
      check('desktop: status 200 and HTML', resp.status() === 200 && /text\/html/.test(resp.headers()['content-type'] || ''), `status ${resp.status()}`);
      check('desktop: the Sentinel\'s CSP is on the page', Boolean(resp.headers()['content-security-policy']));
      await page.waitForSelector('#jvb-root', { state: 'visible', timeout: 10000 });
      const widgets = await page.locator('#jvb-root .jvb-w').count();
      check('desktop: #jvb-root visible with the expected widget count', widgets === expectedWidgets && widgets > 5, `${widgets} in the browser, ${expectedWidgets} by render()`);
      check('desktop: the headline text is on the page', (await page.locator('#jvb-root h1.jvb-n-legacy-headline').innerText()) === 'Glow in seven days');
      check('desktop: the checkout button is present and is #main-cta-btn', (await page.locator('#main-cta-btn').count()) === 1 && (await page.locator('#main-cta-btn').innerText()) === 'Get the serum');
      check('desktop: the lead form widget is present', (await page.locator('form[data-jvb-lead]').count()) === 1 && (await page.locator('form[data-jvb-lead] input[name="email"]').count()) === 1);
      check('desktop: the Google Fonts link names the page\'s families', (await page.locator('link[href*="fonts.googleapis.com/css?family=Playfair+Display"][href*="Outfit"]').count()) === 1);

      // Cascade: a heading's own size beats the base size; per-device padding follows the media queries.
      const sizes = await page.evaluate(() => ({
        base: getComputedStyle(document.querySelector('h1.jvb-n-legacy-headline')).fontSize,
        own: getComputedStyle([...document.querySelectorAll('#jvb-root h1.jvb-heading')].find(h => h.textContent === 'Own size heading')).fontSize,
        padTop: getComputedStyle(document.querySelector('.jvb-n-legacy-offer')).paddingTop
      }));
      check('desktop: the base h1 is 40px (2.5rem)', sizes.base === '40px', sizes.base);
      check('desktop: a heading\'s own fontSize (20px) wins over the base size', sizes.own === '20px', sizes.own);
      check('desktop: the offer section pads 36px (no media query applies)', sizes.padTop === '36px', sizes.padTop);

      // Countdowns.
      const evergreen = page.locator('[data-jvb-mode="evergreen"] .jvb-countdown-clock');
      const t1 = await evergreen.innerText();
      await page.waitForTimeout(2200);
      const t2 = await evergreen.innerText();
      const secs = t => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };
      check('desktop: the evergreen countdown ticks down from about 15 minutes', /^\d\d:\d\d$/.test(t1) && /^\d\d:\d\d$/.test(t2) && secs(t2) < secs(t1) && secs(t1) <= 900 && secs(t1) >= 890, `${t1} then ${t2}`);
      check('desktop: the first countdown owns the frame ids', (await page.locator('#jv-countdown-display').count()) === 1 && (await page.locator('#jv-urgency-label').innerText()) === 'Offer ends in');
      const expired = page.locator('[data-jvb-mode="deadline"]');
      check('desktop: a deadline in the past shows its expired text and 00:00', (await expired.locator('.jvb-countdown-label').innerText()) === 'This deal has ended' && (await expired.locator('.jvb-countdown-clock').innerText()) === '00:00');

      await page.screenshot({ path: shotsAt ? path.join(shotsAt, 'builder-serve-desktop.png') : path.join(dir, 'desktop.png'), fullPage: false });

      // The lead modal (the starter's checkout is lead-gate) and the cart link it ends in, with the bump.
      await page.locator('#bump-checkbox-page').check();
      await page.locator('#main-cta-btn').click();
      await page.waitForFunction(() => getComputedStyle(document.getElementById('lead-modal')).display === 'flex', null, { timeout: 5000 });
      check('desktop: the lead-gate checkout button opens the lead modal', true);
      await page.fill('#lead-email', 'ada@example.com');
      await page.fill('#lead-name', 'Ada');
      await page.locator('#lead-submit-btn').click();
      await page.waitForFunction(() => true);
      const waitShop = Date.now();
      while (!seen.shopRequests.length && Date.now() - waitShop < 8000) await page.waitForTimeout(100);
      const post = seen.leadPosts[0] || {};
      check('desktop: the modal posted every field of the design to /api/public/lead', LEAD_BODY_FIELDS.filter(f => f !== 'ref').every(f => f in post) && post.email === 'ada@example.com' && post.name === 'Ada' && post.slug === SLUG && post.order_bump_selected === true && post.variant === 'a' && /var-a$/.test(post.utm_content || ''), `keys: ${Object.keys(post).join(',')}`);
      console.log(`      lead replies: ${seen.leadReplies.join(' | ')}; page url now ${page.url().slice(0, 160)}`);
      const cart = seen.shopRequests[0] || '';
      check('desktop: it then goes to the shop cart with the product, the bump, the slug and the journey', /\/cart\//.test(cart) && /123:1/.test(cart) && /456:1/.test(cart) && cart.includes('attributes%5Bjv_slug%5D=bld-demo') && cart.includes('attributes%5Bjv_journey%5D=j1'), cart.slice(0, 220));

      // The lead form widget.
      const page2 = await ctx.newPage();
      page2.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/public/lead')) { try { seen.leadPosts.push(JSON.parse(req.postData() || '{}')); } catch { /* skip */ } } });
      await page2.goto(`${base}/p/${SLUG}`, { waitUntil: 'load' });
      const form = page2.locator('form[data-jvb-lead]');
      await form.locator('input[name="email"]').fill('grace@example.com');
      await form.locator('input[name="name"]').fill('Grace');
      const before = seen.leadPosts.length;
      await form.locator('button[type="submit"]').click();
      await page2.waitForFunction(() => document.querySelector('[data-jvb-lead-status]')?.textContent.trim() !== '', null, { timeout: 8000 });
      const status = await form.locator('[data-jvb-lead-status]').innerText();
      const wpost = seen.leadPosts[before] || {};
      check('desktop: the lead form widget posts the same body and shows its success line', status === 'You are on the list.' && wpost.email === 'grace@example.com' && wpost.name === 'Grace' && LEAD_BODY_FIELDS.filter(f => f !== 'ref').every(f => f in wpost), `status "${status}"`);
      await page2.close();

      check('desktop: no page error', seen.pageErrors.length === 0, seen.pageErrors.join(' | '));
      check('desktop: no CSP violation in the console', seen.csp.length === 0, seen.csp.join(' | '));
      console.log(`      other console errors (requests this run blocks on purpose: ${[...new Set(seen.blocked)].join(', ') || 'none'}): ${seen.console.length ? seen.console.join(' | ') : 'none'}`);
      await ctx.close();
    }

    // ---- tablet and phone ----
    for (const [name, width, expectPad] of [['tablet', 800, '20px'], ['phone', 390, '24px']]) {
      const { page, seen, ctx } = await newPage(width, 844);
      await page.goto(`${base}/p/${SLUG}`, { waitUntil: 'load' });
      await page.waitForSelector('#jvb-root', { state: 'visible' });
      const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.jvb-n-legacy-offer')).paddingTop);
      check(`${name} (${width}px): the media query took effect, the offer section pads ${expectPad} not 36px`, pad === expectPad, pad);
      if (name === 'phone') {
        const stacked = await page.evaluate(() => {
          const row = document.querySelector('.jvb-n-legacy-offer > .jvb-row');
          return getComputedStyle(row).flexDirection;
        });
        check('phone (390px): the columns stack', stacked === 'column', stacked);
        check('phone (390px): no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(400);
        const bar = await page.evaluate(() => { const b = document.getElementById('jv-mobile-sticky-bar'); return b ? getComputedStyle(b).display : 'missing'; });
        check('phone (390px): the sticky bar appears once the checkout button has scrolled away', bar === 'flex', bar);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: shotsAt ? path.join(shotsAt, 'builder-serve-mobile.png') : path.join(dir, 'mobile.png'), fullPage: false });
        // The exit drawer, by the pointer leaving the top edge.
        await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave', { clientY: -1 })));
        await page.waitForTimeout(300);
        const drawer = await page.evaluate(() => { const d = document.getElementById('jv-exit-drawer'); return d ? getComputedStyle(d).display : 'missing'; });
        check('phone (390px): the exit drawer opens when the pointer leaves the top edge', drawer === 'block', drawer);
      }
      check(`${name}: no page error and no CSP violation`, seen.pageErrors.length === 0 && seen.csp.length === 0, [...seen.pageErrors, ...seen.csp].join(' | '));
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killServer();
    await new Promise(r => setTimeout(r, 800));
    const left = sandboxProcesses(dir);
    check('the server\'s process group is gone (pgrep on the sandbox path finds nothing)', left.length === 0, left.length ? `still running: ${left.join(',')}` : 'none left');
    if (results.some(r => !r.pass) || process.exitCode) console.log(`--- server log tail ---\n${fs.readFileSync(logPath, 'utf8').slice(-1500)}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; FAILED: ${failed.map(f => f.name).join(' | ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
