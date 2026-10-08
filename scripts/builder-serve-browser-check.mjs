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
//   3b. Motion (LANDING_BUILDER_MOTION.md): a second published page with theme.motion subtle, five
//      tall sections. The served root carries data-jvb-motion and the five custom properties, every
//      section but the first carries data-jvb-reveal (the first none); after load the root has
//      jvb-motion-on, a below-the-fold section is hidden and gains jvb-in within 1 s of scrolling into
//      view, settling at opacity 1 and transform none; the motion-less page gets none of it. Under
//      emulated reduced motion every section reads opacity 1 at load, the root never gets
//      jvb-motion-on and nothing transitions. --shots saves builder-serve-motion.png with a revealed
//      section on screen. About 80 ms after the section gains jvb-in it is sampled mid-reveal (0 <
//      opacity < 1, transition 0.24s); once settled the frame script takes jvb-motion-on off, and the
//      transition with it, so the settled check asks for opacity 1 and transform none only. The
//      motion-less page is read where motion would be written (the root tag, the section tags and
//      <style id="jvb-style">), because the frame script's own text names --jvb-motion-duration on
//      every builder page; in Chrome its frame script never adds jvb-motion-on or jvb-in (a class
//      recorder installed before any page script, proven live on the motion page).
//   3c. Reduced motion, the whole page and its frame (fix round 3): a third page, the first one's
//      document at subtle with a link, under emulated reduced motion: nothing in the body has a
//      transition or an animation at rest or after hovering the button and the link, ticking the
//      bump and opening the exit drawer; the drawer is in place on its first frames; the lead modal's
//      spinner does not turn. The same page with no preference is the control (drawer 0.38s, backdrop
//      0.3s, cookie banner 0.35s, button 0.18s, the spinner and the bump tick, a drawer mid-slide).
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
import { MOTION_PRESETS, createEmptyPage, createNode, insertNode, migrateLegacyPage } from '../src/lib/pageBuilder/model.mjs';
import { render } from '../src/lib/pageBuilder/render.mjs';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/Users/tarrenmunoz/antigravity/Local-AI-App-Builder/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '';
const SLUG = 'bld-demo';
const MOTION_SLUG = 'bld-motion';
const MOTION_FULL_SLUG = 'bld-motion-full';
const VARIANT = 'gid://shopify/ProductVariant/123';
const BUMP = 'gid://shopify/ProductVariant/456';
const SHOP = { storeDomain: 'shop.myshopify.com', currency: 'USD', status: 'connected' };

/** Records, from before any page script runs, every time the root gains jvb-motion-on or a section gains jvb-in. */
const CLASS_RECORDER = () => {
  window.__jvbClassLog = [];
  new MutationObserver(list => {
    for (const m of list) {
      const t = m.target;
      if (!t || !t.classList) continue;
      if (t.id === 'jvb-root' && t.classList.contains('jvb-motion-on')) window.__jvbClassLog.push('root:jvb-motion-on');
      if (t.tagName === 'SECTION' && t.classList.contains('jvb-in')) window.__jvbClassLog.push('section:jvb-in');
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
};

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

/** Five tall sections at motion subtle; the third has its own reveal (fade), the fifth opts out (none). */
function buildMotionDoc() {
  let doc = createEmptyPage({ motion: 'subtle' });
  for (let i = 0; i < 5; i++) {
    const sec = createNode('section');
    sec.style = { desktop: { paddingTop: 40, paddingBottom: 40, minHeight: 700 } };
    if (i === 2) sec.props = { ...sec.props, reveal: 'fade' };
    if (i === 4) sec.props = { ...sec.props, reveal: 'none' };
    const h = createNode('widget', 'heading');
    h.props = { ...h.props, text: `Motion section ${i + 1}`, level: i === 0 ? 1 : 2 };
    sec.children[0].children.push(h);
    const r = insertNode(doc, null, doc.sections.length, sec);
    if (!r.ok) die(`could not add motion section ${i + 1}: ${r.reason}`);
    doc = r.doc;
  }
  return doc;
}

/** The first page's document at motion subtle with a link in a text widget: every part of a page that can move. */
function buildFullMotionDoc() {
  const doc = buildDoc();
  doc.theme = { ...doc.theme, motion: 'subtle' };
  const text = createNode('widget', 'text');
  text.props = { ...text.props, text: 'Read [the guide](https://example.com/guide) first.' };
  const r = insertNode(doc, doc.sections[0].children[1].id, 0, text);
  if (!r.ok) die(`could not add the text link: ${r.reason}`);
  return r.doc;
}

async function publishRecord(doc, slug = SLUG) {
  const saved = {};
  const store = {
    journey: { id: 'j1', nodes: [{ id: 'page-1', type: 'landing-page', data: { type: 'landing-page', slug, headline: 'Glow in seven days', subhead: 'A serum made in small batches.', exitIntentEnabled: true, exitIntentHeadline: 'Wait, take a code', exitIntentDiscountCode: 'STAY10', builder: doc } }], edges: [] }
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
    if (res.status !== 200 || !saved[slug]) die(`the publish route answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  const record = structuredClone(saved[slug]);
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
  const motionDoc = buildMotionDoc();
  const motionRecord = await publishRecord(motionDoc, MOTION_SLUG);
  const fullRecord = await publishRecord(buildFullMotionDoc(), MOTION_FULL_SLUG);
  const dir = makeSandbox();
  fs.writeFileSync(path.join(dir, 'public_pages.json'), JSON.stringify({ [SLUG]: record, [MOTION_SLUG]: motionRecord, [MOTION_FULL_SLUG]: fullRecord }));
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

    // ---- motion (LANDING_BUILDER_MOTION.md sections 2 and 5) ----
    {
      const P = MOTION_PRESETS.subtle;
      const props = `--jvb-motion-duration:${P.durationMs}ms;--jvb-motion-fast:${P.fastMs}ms;--jvb-motion-distance:${P.distancePx}px;--jvb-motion-lift:${P.liftPx}px;--jvb-motion-ease:${P.ease}`;
      const raw = await (await fetch(`${base}/p/${MOTION_SLUG}`)).text();
      check('motion: the served HTML carries data-jvb-motion="subtle" on the root', raw.includes('<div id="jvb-root" class="jvb" data-jvb-motion="subtle">'));
      check('motion: the served CSS carries the five custom properties in order', raw.includes(props), props);
      // The frame script is the same on every builder page, so its own text names what it reads
      // (getAttribute('data-jvb-motion'), --jvb-motion-duration in jvbSettle). What a motion-less page
      // must not carry is in its markup and its CSS: the root tag, the section tags and jvb-style.
      const plain = await (await fetch(`${base}/p/${SLUG}`)).text();
      const plainRoot = (plain.match(/<div id="jvb-root"[^>]*>/) || ['(no root)'])[0];
      const plainSections = plain.match(/<section\b[^>]*>/g) || [];
      const plainStyle = (plain.match(/<style id="jvb-style">([\s\S]*?)<\/style>/) || [null, null])[1];
      check('motion: the motion-less page\'s root tag is plain, no section tag carries data-jvb-reveal, and <style id="jvb-style"> holds no motion property or rule',
        plainRoot === '<div id="jvb-root" class="jvb">' && plainSections.length > 0 && !plainSections.some(t => /data-jvb-reveal=/.test(t)) && plainStyle !== null && !/--jvb-motion-|jvb-motion-on|data-jvb-reveal|@keyframes jvb-|prefers-reduced-motion/.test(plainStyle),
        `root ${plainRoot}; ${plainSections.length} section tags; jvb-style ${plainStyle === null ? 'missing' : `${plainStyle.length} chars`}`);
      {
        // In the browser: the frame script runs on the motion-less page and never touches a section.
        const { page, seen, ctx } = await newPage(1280, 800);
        await page.addInitScript(CLASS_RECORDER);
        await page.goto(`${base}/p/${SLUG}`, { waitUntil: 'load' });
        await page.waitForSelector('#jvb-root', { state: 'visible', timeout: 10000 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        const got = await page.evaluate(() => ({ log: window.__jvbClassLog || null, on: document.getElementById('jvb-root').classList.contains('jvb-motion-on'), ins: document.querySelectorAll('#jvb-root section.jvb-in').length, reveals: document.querySelectorAll('[data-jvb-reveal]').length }));
        check('motion: on the motion-less page the frame script never adds jvb-motion-on or jvb-in (loaded, scrolled to the bottom and back)', got.log !== null && got.log.length === 0 && !got.on && got.ins === 0 && got.reveals === 0, JSON.stringify(got));
        check('motion: the motion-less page loads with no page error', seen.pageErrors.length === 0, seen.pageErrors.join(' | '));
        await ctx.close();
      }

      const { page, seen, ctx } = await newPage(1280, 800);
      await page.addInitScript(CLASS_RECORDER);
      await page.goto(`${base}/p/${MOTION_SLUG}`, { waitUntil: 'load' });
      await page.waitForSelector('#jvb-root', { state: 'visible', timeout: 10000 });
      const recorded = await page.evaluate(() => window.__jvbClassLog || null);
      check('motion: the class recorder sees the frame script at work on the motion page (positive control for the motion-less check)', recorded !== null && recorded.includes('root:jvb-motion-on') && recorded.includes('section:jvb-in'), JSON.stringify(recorded));
      const state = () => page.evaluate(() => {
        const r = document.getElementById('jvb-root');
        return {
          on: r.classList.contains('jvb-motion-on'),
          secs: [...r.querySelectorAll(':scope > section')].map(s => {
            const cs = getComputedStyle(s);
            return { reveal: s.getAttribute('data-jvb-reveal'), in: s.classList.contains('jvb-in'), opacity: cs.opacity, transform: cs.transform, td: cs.transitionDuration, top: Math.round(s.getBoundingClientRect().top) };
          })
        };
      });
      const atLoad = await state();
      const reveals = atLoad.secs.map(s => s.reveal);
      check('motion: five sections served, the first with no data-jvb-reveal', atLoad.secs.length === 5 && reveals[0] === null, JSON.stringify(reveals));
      check('motion: the others carry rise, rise, fade and none (the opt-out writes no attribute)', JSON.stringify(reveals.slice(1)) === JSON.stringify(['rise', 'fade', 'rise', null]), JSON.stringify(reveals));
      check('motion: after load the frame script set jvb-motion-on on the root', atLoad.on);
      check('motion: the first section is visible at load and never carries jvb-in', atLoad.secs[0].opacity === '1' && !atLoad.secs[0].in, JSON.stringify(atLoad.secs[0]));
      const far = atLoad.secs[3];
      check('motion: a below-the-fold rise section is hidden (opacity 0, 10px down) before it scrolls in', far.top >= 800 && !far.in && far.opacity === '0' && far.transform === `matrix(1, 0, 0, 1, 0, ${P.distancePx})`, JSON.stringify(far));
      // A sample taken about 80 ms after the section gains jvb-in, timed in the page (a MutationObserver
      // on its class, then animation frames until 80 ms have passed), so the polling below cannot delay it.
      await page.evaluate((at) => {
        const s = document.querySelectorAll('#jvb-root > section')[3];
        window.__jvbMid = null;
        const mo = new MutationObserver(() => {
          if (!s.classList.contains('jvb-in')) return;
          mo.disconnect();
          const t0 = performance.now();
          const sample = () => {
            const now = performance.now();
            if (now - t0 < at) { requestAnimationFrame(sample); return; }
            const cs = getComputedStyle(s);
            window.__jvbMid = { ms: Math.round(now - t0), opacity: cs.opacity, transform: cs.transform, td: cs.transitionDuration };
          };
          requestAnimationFrame(sample);
        });
        mo.observe(s, { attributes: true, attributeFilter: ['class'] });
      }, 80);
      const t0 = Date.now();
      await page.evaluate(() => document.querySelectorAll('#jvb-root > section')[3].scrollIntoView({ block: 'center' }));
      let gained = null;
      while (Date.now() - t0 < 1000) {
        const s = await state();
        if (s.secs[3].in) { gained = Date.now() - t0; break; }
        await page.waitForTimeout(25);
      }
      check('motion: the section gains jvb-in within 1 s of scrolling into view', gained !== null, gained === null ? 'never in 1000 ms' : `${gained} ms`);
      let mid = null;
      for (const until = Date.now() + 1500; !mid && Date.now() < until;) {
        mid = await page.evaluate(() => window.__jvbMid);
        if (!mid) await page.waitForTimeout(25);
      }
      const midOpacity = mid ? Number(mid.opacity) : NaN;
      check(`motion: about 80 ms after it gains jvb-in it is mid-reveal (0 < opacity < 1) with the ${P.durationMs / 1000}s transition`,
        mid !== null && mid.ms < P.durationMs && midOpacity > 0 && midOpacity < 1 && mid.td.split(',').map(x => x.trim()).includes(`${P.durationMs / 1000}s`),
        mid ? JSON.stringify(mid) : 'no sample in 1500 ms');
      await page.waitForTimeout(P.durationMs + 200);
      const settled = (await state()).secs[3];
      // Once nothing is hidden and the last reveal has had its time, the frame script takes
      // jvb-motion-on off (jvbSettle), and the transition rule with it, so the duration is not asked here.
      const rootOn = await page.evaluate(() => document.getElementById('jvb-root').classList.contains('jvb-motion-on'));
      check('motion: it settles at opacity 1 and transform none', settled.opacity === '1' && settled.transform === 'none', `${JSON.stringify(settled)}; root jvb-motion-on ${rootOn}`);
      await page.screenshot({ path: shotsAt ? path.join(shotsAt, 'builder-serve-motion.png') : path.join(dir, 'motion.png'), fullPage: false });
      await page.evaluate(() => document.querySelectorAll('#jvb-root > section')[2].scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(P.durationMs + 400);
      const fade = (await state()).secs[2];
      check('motion: the fade section reveals without moving (opacity 1, transform none)', fade.in && fade.opacity === '1' && fade.transform === 'none', JSON.stringify(fade));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      check('motion: scrolled back to the top, the revealed section keeps jvb-in', (await state()).secs[3].in);
      check('motion: no page error and no CSP violation', seen.pageErrors.length === 0 && seen.csp.length === 0, [...seen.pageErrors, ...seen.csp].join(' | '));
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));
      await ctx.route('**/*', route => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
      await page.goto(`${base}/p/${MOTION_SLUG}`, { waitUntil: 'load' });
      await page.waitForSelector('#jvb-root', { state: 'visible', timeout: 10000 });
      const read = () => page.evaluate(() => {
        const r = document.getElementById('jvb-root');
        return {
          on: r.classList.contains('jvb-motion-on'),
          secs: [...r.querySelectorAll(':scope > section')].map(s => { const cs = getComputedStyle(s); return `${cs.opacity}/${cs.transform}/${cs.transitionDuration}`; }),
          btn: (() => { const b = r.querySelector('.jvb-btn'); return b ? getComputedStyle(b).transitionDuration : 'no button'; })(),
          animations: document.getAnimations().length
        };
      });
      const r1 = await read();
      check('reduced motion: every section is visible at load with no transform and no transition', r1.secs.every(v => v === '1/none/0s'), r1.secs.join(', '));
      check('reduced motion: the root never gets jvb-motion-on', !r1.on);
      await page.evaluate(() => document.querySelectorAll('#jvb-root > section')[3].scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(600);
      const r2 = await read();
      check('reduced motion: after scrolling, still every section visible and nothing animating', r2.secs.every(v => v === '1/none/0s') && !r2.on && r2.animations === 0, `${r2.secs.join(', ')}; animations ${r2.animations}`);
      check('reduced motion: no page error', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ---- reduced motion, the whole page and its frame (fix round 3) ----
    // The Motion hint promises that a visitor whose device asks for less motion sees none. On a subtle
    // page with a button, a link, the bump, a countdown, the lead modal, the exit drawer and the cookie
    // banner, nothing may have a transition or an animation at rest or after use, and the exit drawer
    // must be in place on its first frame. The same page with no preference is the control: the motion
    // is still there for everyone else, and this scan can see it.
    for (const [label, reducedMotion] of [['reduced motion (frame)', 'reduce'], ['no preference (frame control)', 'no-preference']]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));
      await ctx.route('**/*', route => (new URL(route.request().url()).origin === base ? route.continue() : route.abort()));
      await page.goto(`${base}/p/${MOTION_FULL_SLUG}`, { waitUntil: 'load' });
      await page.waitForSelector('#jvb-root', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
      const scan = () => page.evaluate(() => [...document.querySelectorAll('body, body *')].filter(el => {
        const cs = getComputedStyle(el);
        return cs.transitionDuration.split(',').some(x => parseFloat(x) > 0) || cs.animationName !== 'none';
      }).map(el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} ${getComputedStyle(el).transitionDuration}/${getComputedStyle(el).animationName}`));
      const parts = await page.evaluate(() => ({
        button: !!document.querySelector('#jvb-root .jvb-btn'), link: !!document.querySelector('#jvb-root .jvb-text a'), bump: !!document.getElementById('bump-checkbox-page'),
        countdown: !!document.querySelector('#jvb-root .jvb-countdown-clock'), modal: !!document.getElementById('lead-modal'), drawer: !!document.getElementById('jv-exit-drawer'), banner: !!document.getElementById('jv-consent-banner')
      }));
      check(`${label}: the page holds every part that can move`, Object.values(parts).every(Boolean), JSON.stringify(parts));
      const atRest = await scan();
      await page.locator('#jvb-root .jvb-btn').first().hover();
      await page.locator('#jvb-root .jvb-text a').first().hover();
      await page.locator('#bump-checkbox-page').check();
      await page.waitForTimeout(30);
      const used = await page.evaluate(() => ({
        lift: getComputedStyle(document.querySelector('#jvb-root .jvb-btn')).transform,
        anims: document.getAnimations().map(a => a.animationName || a.transitionProperty || a.constructor.name)
      }));
      const spin = await page.evaluate(() => {
        const s = document.createElement('span');
        s.className = 'loading-spinner';
        document.getElementById('lead-modal').appendChild(s);
        const name = getComputedStyle(s).animationName;
        s.remove();
        return name;
      });
      await page.mouse.move(640, 400);
      const drawerBefore = await page.evaluate(() => getComputedStyle(document.getElementById('jv-exit-drawer')).display);
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave', { clientY: -1 })));
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const drawer = await page.evaluate(() => {
        const d = document.getElementById('jv-exit-drawer');
        const b = document.getElementById('jv-exit-backdrop');
        return { display: getComputedStyle(d).display, transform: getComputedStyle(d).transform, backdrop: getComputedStyle(b).opacity, anims: document.getAnimations().length };
      });
      drawer.before = drawerBefore;
      const afterUse = await scan();
      if (reducedMotion === 'reduce') {
        check(`${label}: nothing on the page or its frame has a transition or an animation at rest`, atRest.length === 0, atRest.join(' | ') || 'none');
        check(`${label}: hovering the button and the link and ticking the bump start nothing, and the button does not lift`, used.anims.length === 0 && used.lift === 'none', JSON.stringify(used));
        check(`${label}: the lead modal's spinner does not turn`, spin === 'none', spin);
        check(`${label}: the exit drawer is in place on its first frames, with its backdrop, and nothing is animating`, drawer.before === 'none' && drawer.display === 'block' && drawer.transform === 'matrix(1, 0, 0, 1, 0, 0)' && drawer.backdrop === '1' && drawer.anims === 0, JSON.stringify(drawer));
        check(`${label}: still nothing with a transition or an animation after all of that`, afterUse.length === 0, afterUse.join(' | ') || 'none');
      } else {
        const has = (list, re) => list.some(x => re.test(x));
        check(`${label}: the scan sees the motion everyone else still gets (drawer 0.38s, backdrop 0.3s, banner 0.35s, the page's button 0.18s)`,
          has(atRest, /^div#jv-exit-drawer 0\.38s/) && has(atRest, /^div#jv-exit-backdrop 0\.3s/) && has(atRest, /^div#jv-consent-banner\.jv-cookie-consent 0\.35s/) && has(atRest, /\.jvb-btn\b.* 0\.18s/), atRest.join(' | '));
        check(`${label}: the spinner turns and the bump ticks`, spin === 'jvf-spin' && used.anims.includes('jvb-tick'), `${spin}; ${JSON.stringify(used.anims)}`);
        const y = Number((drawer.transform.match(/matrix\(1, 0, 0, 1, 0, ([-\d.]+)\)/) || [])[1]);
        check(`${label}: the exit drawer is still sliding in two frames after it opens`, drawer.before === 'none' && drawer.display === 'block' && y > 1, JSON.stringify(drawer));
      }
      check(`${label}: no page error`, errors.length === 0, errors.join(' | '));
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
