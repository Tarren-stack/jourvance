#!/usr/bin/env node
// Browser proof of the published page's motion (LANDING_BUILDER_MOTION.md section 7, A7).
//   node scripts/builder-motion-page-check.mjs [--only step,step]
//
// Builds each page in node from render(), frameCss() and builderFrameScript() the way
// server/routes/publicRoutes.mjs assembles a builder page (minus pixels, banner, modal and drawer,
// which this page has no part in), serves it from a fake http://jvb.test/ origin through
// page.route (so localStorage works), aborts every other request, and drives real Chrome (the
// hub's Playwright). Chrome is 1280x800 unless a step names another size.
//
// The spec's steps: page-unset, page-subtle-reveal, page-above-fold, page-focus-reveal,
// page-cinematic, page-reduced, page-no-js, page-print, page-button, page-link, page-bump-tick,
// runtime.
// The motion review's fix round added: fix-short-last (a section shorter than the observer's
// bottom margin, last on the page, is revealed at the bottom), fix-inner (an inner section never
// moves on its own, not even inside the first section), fix-anchor-load and fix-anchor-click (a
// jump to an anchor lands on the untransformed box and nothing plays on arrival), fix-bottom-shift
// (the page does not shrink under the visitor when the last section reveals) and
// fix-countdown-offset (a deadline stored with +0000 counts).
//
// Exit 0 every step passed, 1 a step failed, 2 the run could not be made.
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createEmptyPage, createNode, insertNode } from '../src/lib/pageBuilder/model.mjs';
import { render } from '../src/lib/pageBuilder/render.mjs';
import { builderFrameScript, frameCss } from '../server/routes/publicBuilderScript.mjs';

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/Users/tarrenmunoz/antigravity/Local-AI-App-Builder/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://jvb.test';
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] || '' : '';
const ONLY = onlyArg ? new Set(onlyArg.split(',').map(s => s.trim()).filter(Boolean)) : null;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const die = (msg) => { console.error(`COULD NOT RUN: ${msg}`); process.exit(2); };

// ---- documents ----

function widget(type, props = {}, style) {
  const w = createNode('widget', type);
  w.props = { ...w.props, ...props };
  if (style) w.style = style;
  return w;
}
function section({ minHeight, padTop, padBottom, props = {}, children = [] } = {}) {
  const s = createNode('section');
  const desktop = {};
  if (minHeight !== undefined) desktop.minHeight = minHeight;
  if (padTop !== undefined) desktop.paddingTop = padTop;
  if (padBottom !== undefined) desktop.paddingBottom = padBottom;
  if (Object.keys(desktop).length) s.style = { desktop };
  Object.assign(s.props, props);
  for (const c of children) s.children[0].children.push(c);
  return s;
}
const textSec = (text, opts = {}) => section({ ...opts, children: [widget('text', { text }), ...(opts.children || [])] });
function build(sections, motion) {
  let doc = createEmptyPage(motion ? { motion } : undefined);
  for (const s of sections) {
    const r = insertNode(doc, null, doc.sections.length, s);
    if (!r.ok) die(`insert: ${r.reason}`);
    doc = r.doc;
  }
  return doc;
}
function pageHtml(doc) {
  const out = render(doc);
  if (out.problems.length) die(`render problems: ${JSON.stringify(out.problems)}`);
  const css = out.css.replace(/<\/style/gi, '<\\/style');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Motion check</title>
  <style id="jv-frame-style">
    ${frameCss(doc.theme?.colors?.background)}
  </style>
  <style id="jvb-style">
${css}
  </style>
</head>
<body>
  ${out.html}
  <script>
    ${builderFrameScript({ slug: 'motion-check' })}
  </script>
</body>
</html>`;
}

const six = (motion) => build([0, 1, 2, 3, 4, 5].map(i => textSec(`Section ${i + 1}`, { minHeight: 700 })), motion);
const widgetsDoc = (motion) => build([
  section({ minHeight: 700, children: [
    widget('button', { label: 'Buy now', url: 'https://example.com/buy' }),
    widget('text', { text: 'Read [the details](https://example.com/details) first.' })
  ] }),
  textSec('Tall', { minHeight: 900 }),
  section({ minHeight: 500, children: [widget('orderBump', { variantId: 'gid://shopify/ProductVariant/9', headline: 'Add the mini', title: 'Mini' })] })
], motion);
const countdownDoc = (deadline) => build([
  section({ minHeight: 300, children: [widget('countdown', { mode: 'deadline', deadline })] })
], 'subtle');
const isoAhead = (ms, offset) => new Date(Date.now() + ms).toISOString().slice(0, 19) + offset;
const headSec = (text, opts = {}) => section({ ...opts, children: [widget('heading', { text, level: 2 })] });
const anchorDoc = (motion) => build([
  section({ minHeight: 600, children: [widget('button', { label: 'Jump to offer', url: '#offer' })] }),
  headSec('Two', { minHeight: 900, padTop: 0 }),
  headSec('The offer heading', { minHeight: 900, padTop: 0, props: { anchor: 'offer' } }),
  headSec('Four', { minHeight: 900, padTop: 0 }),
  headSec('Last', { minHeight: 300 })
], motion);
function innerDoc() {
  const heroInner = textSec('Inner section inside the first section');
  const hero = section({ children: [widget('spacer', {}, { desktop: { minHeight: 900 } }), heroInner] });
  const laterInner = textSec('Inner section inside a later one');
  const later = section({ children: [widget('text', { text: 'Outer' }), laterInner] });
  return { doc: build([hero, textSec('Tall', { minHeight: 900 }), later], 'cinematic'), heroInnerId: heroInner.id, laterInnerId: laterInner.id, laterId: later.id };
}

// Each request path names a document; a step registers what it serves before it loads it.
const served = new Map();
const serve = (path, doc) => { served.set(path, pageHtml(doc)); return `${ORIGIN}${path}`; };

// ---- the browser ----

if (!fs.existsSync(PLAYWRIGHT)) die(`no Playwright at ${PLAYWRIGHT} (set PLAYWRIGHT_MODULE)`);
let chromium;
try { ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href)); } catch (e) { die(`Playwright would not load: ${e.message}`); }
let browser;
try { browser = await chromium.launch({ executablePath: CHROME, headless: true }); } catch (e) { die(`Chrome would not start: ${e.message}`); }

const runtimeErrors = [];
async function open(path, { width = 1280, height = 800, ...opts } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...opts });
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === ORIGIN && served.has(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: served.get(u.pathname) });
    return route.abort();
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => runtimeErrors.push(`${path}: ${e}`));
  p.on('console', m => { if (m.type() === 'error') runtimeErrors.push(`${path}: ${m.text()}`); });
  return { ctx, p };
}
const secs = (p, sel = '#jvb-root > section') => p.evaluate((sel) => [...document.querySelectorAll(sel)].map(s => {
  const cs = getComputedStyle(s);
  return { reveal: s.getAttribute('data-jvb-reveal'), in: s.classList.contains('jvb-in'), op: cs.opacity, tf: cs.transform, td: cs.transitionDuration, top: Math.round(s.getBoundingClientRect().top) };
}), sel);
const allDurations = (td, want) => td.split(',').every(t => t.trim() === want);
const rootClass = p => p.evaluate(() => document.getElementById('jvb-root').className);
async function waitFor(p, fn, arg, ms) {
  try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; }
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('page-unset', async () => {
  const url = serve('/unset', widgetsDoc());
  const { ctx, p } = await open('/unset');
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({
    motion: document.getElementById('jvb-root').hasAttribute('data-jvb-motion'),
    reveals: document.querySelectorAll('[data-jvb-reveal]').length,
    td: getComputedStyle(document.querySelector('.jvb-btn')).transitionDuration
  }));
  const cls = await rootClass(p);
  check('page-unset', !r.motion && r.reveals === 0 && !cls.includes('jvb-motion-on') && r.td === '0s' && !served.get('/unset').includes('data-jvb-motion="'), `root "${cls}", ${JSON.stringify(r)}`);
  await ctx.close();
});

step('page-subtle-reveal', async () => {
  const url = serve('/six-subtle', six('subtle'));
  const { ctx, p } = await open('/six-subtle');
  await p.goto(url, { waitUntil: 'load' });
  const s = await secs(p);
  const cls = await rootClass(p);
  const atLoad = s[0].reveal === null && s[0].op === '1' && cls.includes('jvb-motion-on') && s[3].op === '0' && s[3].tf === 'matrix(1, 0, 0, 1, 0, 10)';
  await p.evaluate(() => document.querySelectorAll('#jvb-root > section')[3].scrollIntoView());
  const gotIn = await waitFor(p, () => document.querySelectorAll('#jvb-root > section')[3].classList.contains('jvb-in'), null, 1000);
  await p.waitForTimeout(400);
  const after = (await secs(p))[3];
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  const back = (await secs(p))[3];
  check('page-subtle-reveal', atLoad && gotIn && after.op === '1' && after.tf === 'none' && allDurations(after.td, '0.24s') && back.in,
    `load ${JSON.stringify([s[0], s[3]])}, in ${gotIn}, after ${JSON.stringify(after)}, back in ${back.in}`);
  await ctx.close();
});

step('page-above-fold', async () => {
  const url = serve('/fold', build([textSec('One', { minHeight: 200 }), textSec('Two', { minHeight: 200 }), textSec('Three', { minHeight: 900 })], 'subtle'));
  const { ctx, p } = await open('/fold');
  await p.goto(url, { waitUntil: 'load' });
  const r = await p.evaluate(() => ({ anims: document.getAnimations().length, in: document.querySelectorAll('#jvb-root > section')[1].classList.contains('jvb-in') }));
  check('page-above-fold', r.in && r.anims === 0, JSON.stringify(r));
  await ctx.close();
});

step('page-focus-reveal', async () => {
  const url = serve('/focus', build([
    textSec('One', { minHeight: 700 }), textSec('Two', { minHeight: 700 }),
    section({ minHeight: 700, children: [widget('button', { label: 'Inside a hidden section', url: 'https://example.com/x' })] })
  ], 'subtle'));
  const { ctx, p } = await open('/focus');
  await p.goto(url, { waitUntil: 'load' });
  const before = (await secs(p))[2];
  await p.keyboard.press('Tab');
  const r = await p.evaluate(() => {
    const a = document.activeElement;
    const s = a && a.closest('#jvb-root > section');
    return { tag: a && a.tagName, idx: s ? [...document.querySelectorAll('#jvb-root > section')].indexOf(s) : -1, in: s ? s.classList.contains('jvb-in') : false, op: s ? getComputedStyle(s).opacity : '' };
  });
  // At once: in the same task as the focus, already at full opacity, so focus never sits on a fade.
  check('page-focus-reveal', !before.in && r.idx === 2 && r.in && r.op === '1', `before ${before.in}, after ${JSON.stringify(r)}`);
  await ctx.close();
});

step('page-cinematic', async () => {
  const url = serve('/six-cinematic', six('cinematic'));
  const { ctx, p } = await open('/six-cinematic');
  await p.goto(url, { waitUntil: 'load' });
  const hidden = (await secs(p))[3];
  await p.evaluate(() => document.querySelectorAll('#jvb-root > section')[3].scrollIntoView());
  await waitFor(p, () => document.querySelectorAll('#jvb-root > section')[3].classList.contains('jvb-in'), null, 1000);
  await p.waitForTimeout(800);
  const shown = (await secs(p))[3];
  check('page-cinematic', hidden.tf === 'matrix(1, 0, 0, 1, 0, 24)' && allDurations(shown.td, '0.56s') && shown.tf === 'none' && shown.op === '1', `hidden ${hidden.tf}, shown ${JSON.stringify(shown)}`);
  await ctx.close();
});

step('page-reduced', async () => {
  const url = serve('/reduced', widgetsDoc('subtle'));
  const { ctx, p } = await open('/reduced', { reducedMotion: 'reduce' });
  await p.goto(url, { waitUntil: 'load' });
  const cls = await rootClass(p);
  const load = await secs(p);
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(300);
  const scrolled = await secs(p);
  await p.evaluate(() => window.scrollTo(0, 0));
  const td = await p.evaluate(() => getComputedStyle(document.querySelector('.jvb-btn')).transitionDuration);
  await p.hover('.jvb-btn');
  await p.waitForTimeout(300);
  const tf = await p.evaluate(() => getComputedStyle(document.querySelector('.jvb-btn')).transform);
  check('page-reduced', !cls.includes('jvb-motion-on') && load.every(s => s.op === '1') && scrolled.every(s => s.op === '1') && td === '0s' && tf === 'none',
    `root "${cls}", load ${load.map(s => s.op)}, scrolled ${scrolled.map(s => s.op)}, button ${td} ${tf}`);
  await ctx.close();
});

step('page-no-js', async () => {
  const url = serve('/nojs', six('subtle'));
  const { ctx, p } = await open('/nojs', { javaScriptEnabled: false });
  await p.goto(url, { waitUntil: 'load' });
  const s = await secs(p);
  check('page-no-js', s.length === 6 && s.every(x => x.op === '1'), s.map(x => x.op).join(','));
  await ctx.close();
});

step('page-print', async () => {
  const url = serve('/print', six('subtle'));
  const { ctx, p } = await open('/print');
  await p.goto(url, { waitUntil: 'load' });
  const screen = (await secs(p))[3].op;
  await p.emulateMedia({ media: 'print' });
  const print = (await secs(p))[3].op;
  check('page-print', screen === '0' && print === '1', `screen ${screen}, print ${print}`);
  await ctx.close();
});

step('page-button', async () => {
  const url = serve('/button', widgetsDoc('subtle'));
  const { ctx, p } = await open('/button');
  await p.goto(url, { waitUntil: 'load' });
  await p.hover('.jvb-btn');
  await p.waitForTimeout(300);
  const tf = await p.evaluate(() => getComputedStyle(document.querySelector('.jvb-btn')).transform);
  check('page-button', tf === 'matrix(1, 0, 0, 1, 0, -1)', tf);
  await ctx.close();
});

step('page-link', async () => {
  const url = serve('/link', widgetsDoc('subtle'));
  const { ctx, p } = await open('/link');
  await p.goto(url, { waitUntil: 'load' });
  const rest = await p.evaluate(() => getComputedStyle(document.querySelector('.jvb-text a')).textUnderlineOffset);
  await p.hover('.jvb-text a');
  await p.waitForTimeout(300);
  const hover = await p.evaluate(() => getComputedStyle(document.querySelector('.jvb-text a')).textUnderlineOffset);
  check('page-link', parseFloat(hover) > parseFloat(rest), `rest ${rest}, hover ${hover}`);
  await ctx.close();
});

step('page-bump-tick', async () => {
  const url = serve('/bump', widgetsDoc('subtle'));
  const { ctx, p } = await open('/bump');
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(() => document.querySelector('.jvb-bump-cb').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(700);
  await p.click('.jvb-bump-cb');
  const names = await p.evaluate(() => document.querySelector('.jvb-bump-cb').getAnimations().map(a => a.animationName));
  check('page-bump-tick', names.includes('jvb-tick'), JSON.stringify(names));
  await ctx.close();
});

step('fix-short-last', async () => {
  const cases = [
    { width: 1920, height: 1080, pad: 40 },
    { width: 2560, height: 1300, pad: 40 },
    { width: 1280, height: 800, pad: 16 },
    { width: 390, height: 844, pad: 16 }
  ];
  const out = [];
  for (const c of cases) {
    const path = `/short-${c.width}-${c.pad}`;
    const url = serve(path, build([textSec('One', { minHeight: 700 }), textSec('Two', { minHeight: 1400 }), textSec('Footer line', { padTop: c.pad, padBottom: c.pad })], 'subtle'));
    const { ctx, p } = await open(path, { width: c.width, height: c.height });
    await p.goto(url, { waitUntil: 'load' });
    const h = await p.evaluate(() => Math.round(document.querySelectorAll('#jvb-root > section')[2].getBoundingClientRect().height));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const s = document.querySelectorAll('#jvb-root > section')[2];
      const d = document.documentElement;
      return { in: s.classList.contains('jvb-in'), op: getComputedStyle(s).opacity, atMax: Math.round(window.scrollY + window.innerHeight) >= d.scrollHeight - 1 };
    });
    out.push({ size: `${c.width}x${c.height}`, h, ...r, short: h < c.height * 0.1 });
    await ctx.close();
  }
  check('fix-short-last', out.every(r => r.in && r.op === '1' && r.atMax) && out.every(r => r.short), JSON.stringify(out));
});

step('fix-inner', async () => {
  const d = innerDoc();
  const html = pageHtml(d.doc);
  const innerTags = [d.heroInnerId, d.laterInnerId].map(id => (html.match(new RegExp(`<section[^>]*jvb-n-${id}[ "][^>]*>`)) || [''])[0]);
  const url = serve('/inner', d.doc);
  const { ctx, p } = await open('/inner', { width: 390, height: 844 });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const st = (id) => p.evaluate((id) => {
    const s = document.querySelector(`.jvb-n-${id}`);
    const cs = getComputedStyle(s);
    return { op: cs.opacity, tf: cs.transform, top: Math.round(s.getBoundingClientRect().top), reveal: s.getAttribute('data-jvb-reveal') };
  }, id);
  const heroInner = await st(d.heroInnerId);
  const laterInnerHidden = await st(d.laterInnerId);
  const laterHidden = await st(d.laterId);
  await p.evaluate((id) => document.querySelector(`.jvb-n-${id}`).scrollIntoView(), d.laterId);
  await p.waitForTimeout(1200);
  const laterInnerShown = await st(d.laterInnerId);
  const ok = innerTags.every(t => t && !t.includes('data-jvb-reveal'))
    && heroInner.top > 844 && heroInner.op === '1' && heroInner.tf === 'none'
    && laterHidden.tf === 'matrix(1, 0, 0, 1, 0, 24)' && laterInnerHidden.tf === 'none'
    && laterInnerShown.op === '1' && laterInnerShown.tf === 'none';
  check('fix-inner', ok, JSON.stringify({ innerTags, heroInner, laterHidden, laterInnerHidden, laterInnerShown }));
  await ctx.close();
});

async function anchorState(p) {
  return p.evaluate(() => {
    const s = document.getElementById('offer');
    const h = s.querySelector('h2');
    return { y: Math.round(window.scrollY), top: Math.round(s.getBoundingClientRect().top), head: Math.round(h.getBoundingClientRect().top), in: s.classList.contains('jvb-in'), runs: (window.__runs || []).filter(r => r === 'offer').length };
  });
}
const recordTransitions = () => {
  window.__runs = [];
  document.addEventListener('transitionrun', e => { if (e.target && e.target.id) window.__runs.push(e.target.id); }, true);
};

step('fix-anchor-load', async () => {
  const out = {};
  for (const motion of ['cinematic', 'subtle', undefined]) {
    const key = motion || 'none';
    const path = `/anchor-${key}`;
    serve(path, anchorDoc(motion));
    const { ctx, p } = await open(path);
    await p.addInitScript(recordTransitions);
    await p.goto(`${ORIGIN}${path}#offer`, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    out[key] = await anchorState(p);
    await ctx.close();
  }
  const ok = ['cinematic', 'subtle'].every(k => Math.abs(out[k].top) <= 1 && Math.abs(out[k].head) <= 1 && out[k].y === out.none.y && out[k].runs === 0);
  check('fix-anchor-load', ok, JSON.stringify(out));
});

step('fix-anchor-click', async () => {
  const out = {};
  for (const motion of ['cinematic', 'subtle']) {
    const path = `/anchor-click-${motion}`;
    const url = serve(path, anchorDoc(motion));
    const { ctx, p } = await open(path);
    await p.addInitScript(recordTransitions);
    await p.goto(url, { waitUntil: 'load' });
    await p.click('a.jvb-btn[href="#offer"]');
    await p.waitForTimeout(1200);
    out[motion] = await anchorState(p);
    await ctx.close();
  }
  check('fix-anchor-click', Object.values(out).every(r => Math.abs(r.top) <= 1 && Math.abs(r.head) <= 1 && r.in && r.runs === 0), JSON.stringify(out));
});

step('fix-bottom-shift', async () => {
  const url = serve('/bottom', build([textSec('One', { minHeight: 700 }), textSec('Two', { minHeight: 1400 }), textSec('Three', { minHeight: 1400 }), textSec('Last', { minHeight: 300 })], 'cinematic'));
  const { ctx, p } = await open('/bottom');
  await p.goto(url, { waitUntil: 'load' });
  const log = await p.evaluate(() => new Promise(resolve => {
    const d = document.documentElement;
    window.scrollTo(0, d.scrollHeight);
    const t0 = performance.now();
    const rows = [];
    const frame = () => {
      rows.push([Math.round(performance.now() - t0), Math.round(window.scrollY), d.scrollHeight]);
      if (performance.now() - t0 < 900) requestAnimationFrame(frame); else resolve(rows);
    };
    requestAnimationFrame(frame);
  }));
  const last = (await secs(p))[3];
  const ys = log.map(r => r[1]);
  const hs = log.map(r => r[2]);
  const ok = last.in && Math.max(...ys) - Math.min(...ys) === 0 && Math.max(...hs) - Math.min(...hs) === 0;
  check('fix-bottom-shift', ok, `last in ${last.in}, scrollY ${Math.min(...ys)}..${Math.max(...ys)}, scrollHeight ${Math.min(...hs)}..${Math.max(...hs)}`);
  await ctx.close();
});

step('fix-countdown-offset', async () => {
  const deadline = isoAhead(2 * 3600 * 1000 + 30 * 60 * 1000, '+0000');
  const url = serve('/countdown-offset', countdownDoc(deadline));
  const { ctx, p } = await open('/countdown-offset');
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const text = await p.evaluate(() => document.querySelector('.jvb-countdown-clock').textContent);
  check('fix-countdown-offset', /^02:(29|30):\d\d$/.test(text), `deadline ${deadline}, clock "${text}"`);
  await ctx.close();
});

for (const s of steps) {
  if (ONLY && !ONLY.has(s.name)) continue;
  try { await s.fn(); } catch (e) { check(s.name, false, `threw: ${e.message}`); }
}
if (!ONLY || ONLY.has('runtime')) check('runtime', runtimeErrors.length === 0, runtimeErrors.slice(0, 5).join(' | '));
await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} steps passed${failed.length ? `; failed: ${failed.map(r => r.name).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
