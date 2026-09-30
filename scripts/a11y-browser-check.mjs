#!/usr/bin/env node
// Accessibility checks for the journey map in a real browser (#19). a11y.test.mjs reads the
// sources; this drives the built app with a keyboard and reads what the browser computes: spoken
// step names, lines in words, dialog round trips, focus rings, the 11px floor (map text measured
// as drawn), zoomed-out step names that fit their cards, line captions and design badges readable
// at fit (T02), every handle's hit area at fit (T03), tied labels, aria-pressed, reduced motion,
// button names and clean saved data.
//
// Usage: node scripts/a11y-browser-check.mjs
//   Builds to its own temp dir, previews on 127.0.0.1:A11Y_PORT (default 4731, --strictPort), runs
//   every check and kills the preview's process group on exit. When the preview cannot answer it
//   says what did (another program's status, or vite's own words) instead of going quiet.
//   A11Y_BASE=http://127.0.0.1:NNNN reuses a server that is already running instead. A11Y_ONLY=stepNames,modalTrap runs a subset.
//   A11Y_SHOTS=<dir> is where screenshots go (default: the temp dir). CHROME_PATH picks Chrome.
// Exit 0 when every check passes, 1 when there are findings, 2 when the checks could not run.
//
// Every non-localhost request and every /api request is aborted, so this never reaches the hub,
// never starts server.mjs and never reads .env. The one exception is a check that asks for a
// connected store: GET /api/workspaces is answered in the page with STORE_WORKSPACES. A signed-out visitor keeps one journey in
// localStorage ("jourvance_active_project"), which is how a check seeds or reads a journey.
//
// Each check is exported as `async (browser, options) => string[]` (the findings, empty when it
// passes) so #11's canvas harness can call them too. Checks open their own browser context. The
// harness passes `blocked` (an array) to count what the guard aborted. child_process is loaded only
// by this file's own main(), so importing the checks never brings in a way to start a process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_TEXT_PX = 11;
const FOCUS_RGB = 'rgb(129, 140, 248)';
const STORAGE_KEY = 'jourvance_active_project';

/** The step panel: a non-modal dialog, or #7's docked aside. */
export const STEP_PANEL = '[role="dialog"]:not([aria-modal="true"]), aside[aria-label="Step panel"]';
export const MODAL = '[role="dialog"][aria-modal="true"]';
// Line pills sit in React Flow's viewport portal, after the steps (C34), so find them by their own mark.
const PILLS = '[data-jv-edge-label] button';
/** The Audit's header button, now "Check design" (#10), whose name carries the open check count. */
const AUDIT = 'button[aria-label^="Check design"]';
// A step named by a question closes the sentence itself (T09, describeEdge), so the sentence ends
// in a full stop or in that name's own ? or !, and never reads "?." (a11y-canvas.test.mjs pins the same).
const LINE_WORDS = /^(Next step|Accepted|Declined or left|Retention flow|Split A|Split B): from .+ to .+(?:\.|[?!]["”]?) /;
const DOUBLE_STOP = /[?!]["”]?\./;

// ---- Setup helpers ----

/**
 * The route guard: only the preview's own files load. Anything on another origin (the hub, Google,
 * localhost:3005) and /api or /p on the preview itself is aborted. The same rule as #11's
 * routeVerdict, written here too so this file runs without the TypeScript sources.
 */
export function allowedRequest(url, base) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== new URL(base).origin) return false;
  const p = u.pathname;
  return !(p === '/api' || p.startsWith('/api/') || p === '/p' || p.startsWith('/p/'));
}

/**
 * What GET /api/workspaces answers when a check asks for a connected store (`store: true`), so the
 * header shows the Store score. Nothing else under /api is answered.
 */
export const STORE_WORKSPACES = {
  success: true,
  workspaces: [{ id: 'ws-check', name: 'Check store', shopifyConfig: { storeDomain: 'check-store.myshopify.com', status: 'connected' } }]
};

/** A fresh context and page on the canvas, with outside requests, /api and /p aborted. */
export async function openApp(browser, { base, viewport = { width: 1440, height: 900 }, seed = null, reducedMotion = 'no-preference', blocked = null, store = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.route('**/*', route => {
    const req = route.request();
    if (allowedRequest(req.url(), base)) return route.continue();
    if (store && req.method() === 'GET' && req.url() === `${base.replace(/\/$/, '')}/api/workspaces`) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(STORE_WORKSPACES) });
    }
    if (blocked) {
      try {
        const u = new URL(req.url());
        blocked.push(`${req.method()} ${u.host}${u.pathname}`);
      } catch {
        blocked.push(`${req.method()} ${String(req.url()).slice(0, 80)}`);
      }
    }
    return route.abort();
  });
  await context.addInitScript(
    ([key, value]) => {
      // Only on the first load of this context, so a reload reads what the app saved.
      if (sessionStorage.getItem('jv-a11y-seeded')) return;
      sessionStorage.setItem('jv-a11y-seeded', '1');
      localStorage.clear();
      if (value) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, seed ? JSON.stringify(seed) : null]
  );
  const page = await context.newPage();
  // A control that cannot be clicked is a finding, not a 30 second stall.
  page.setDefaultTimeout(5000);
  page.on('dialog', d => d.accept());
  await page.goto(`${base.replace(/\/$/, '')}/canvas`);
  await page.waitForSelector('.react-flow__node', { timeout: 15000 });
  await settle(page);
  return { context, page };
}

/** Waits for the map's opening fit to finish, so measured positions stay true. */
export async function settle(page) {
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform ?? '');
    if (now && now === last) return;
    last = now;
    await page.waitForTimeout(150);
  }
}

async function withApp(browser, options, fn) {
  const { context, page } = await openApp(browser, options);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

/** Where focus is, described in plain fields. */
export function activeInfo(page) {
  return page.evaluate(([panelSel, modalSel]) => {
    const a = document.activeElement;
    return {
      tag: a?.tagName ?? null,
      id: a?.id || null,
      dataId: a?.getAttribute?.('data-id') ?? null,
      label: a?.getAttribute?.('aria-label') ?? null,
      text: (a?.textContent || '').trim().slice(0, 50),
      isBody: a === document.body || !a,
      inPanel: Boolean(a?.closest?.(panelSel)),
      inModal: Boolean(a?.closest?.(modalSel))
    };
  }, [STEP_PANEL, MODAL]);
}

/** The type line above an open step panel's heading ("Landing Page Editor"), or null. The heading
 *  itself is the step's own name (#7), so this is what says which kind of step is open. */
function stepPanelType(page) {
  return page.evaluate(() => {
    const h = document.getElementById('jv-step-panel-title');
    const line = h?.previousElementSibling;
    return line && line.textContent.trim() ? line.textContent.trim() : null;
  });
}

/** The heading text of the open step or line panel, or null. */
function panelTitle(page) {
  return page.evaluate(sel => {
    for (const panel of document.querySelectorAll(sel)) {
      const h = panel.querySelector('#jv-step-panel-title, #jv-inspector-title, #jv-edge-inspector-title, h2, h3');
      if (h && h.textContent.trim()) return h.textContent.trim();
    }
    return null;
  }, STEP_PANEL);
}

const stepSel = id => `.react-flow__node[data-id="${id}"]`;

/** Runs one part of a check; a part that throws becomes a finding and the check goes on. */
let SHOTS_DIR = null;

async function part(f, label, fn, page = null) {
  try {
    await fn();
  } catch (err) {
    f.push(`${label}: could not run (${String(err?.message || err).split('\n')[0]})`);
    if (page && SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `failed-${label.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
  }
}

/** Closes a modal that Escape left open, so the next part of a check can reach the page. */
async function dismissModals(page) {
  for (const sel of [`${MODAL} button[aria-label^="Close"]`, 'button[aria-label="Close design checks"]', 'button[aria-label="Close ROAS Forecaster"]']) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible())) await btn.click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(150);
}

/** Opens a line's panel the keyboard way: focus its rate pill and press Enter. Cards can cover a pill. */
async function openPill(page, index = 0) {
  const pills = await page.$$(PILLS);
  const pill = pills[index];
  if (!pill) return null;
  const before = await panelTitle(page);
  await keyboardFocus(page, pill);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  // Before the keyboard path is wired, a click still opens the panel so later parts can run.
  // lineRoundTrip is the check that holds the keyboard path to account.
  if ((await panelTitle(page)) === before) {
    const again = (await page.$$(PILLS))[index];
    if (again) await again.click({ force: true });
    await page.waitForTimeout(250);
  }
  return pill;
}

/** Put the page in keyboard mode, so programmatic focus shows :focus-visible as a Tab would. */
async function keyboardFocus(page, selectorOrHandle) {
  await page.keyboard.press('Shift');
  const handle = typeof selectorOrHandle === 'string' ? await page.$(selectorOrHandle) : selectorOrHandle;
  if (!handle) return false;
  await handle.evaluate(el => el.focus());
  return true;
}

function buttonByText(page, text, scope = 'body') {
  return page.evaluateHandle(
    ([t, s]) => [...document.querySelectorAll(`${s} button`)].find(b => b.textContent.trim() === t || b.getAttribute('aria-label') === t) ?? null,
    [text, scope]
  );
}

async function clickButton(page, text, scope) {
  const h = (await buttonByText(page, text, scope)).asElement();
  if (!h) return false;
  await h.click();
  await page.waitForTimeout(150);
  return true;
}

const ADD_ITEMS = [
  ['ad-source', 'Ad Source'],
  ['landing-page', 'Landing Page'],
  ['ab-split', 'A/B Traffic Splitter'],
  ['lead-form', 'Lead Capture Form'],
  ['follow-up-sequence', 'Follow-Up Sequence'],
  ['thank-you', 'Thank-you page'],
  ['upsell', 'Upsell']
];

/** Adds a step from the Add Step menu by the words on its menu item. */
async function addStep(page, words) {
  if (!(await clickButton(page, 'Add Step'))) return false;
  const item = (await page.evaluateHandle(w => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('+') && b.textContent.includes(w)) ?? null, words)).asElement();
  if (!item) return false;
  await item.click();
  await page.waitForTimeout(250);
  return true;
}

// ---- Page-side scans ----

/**
 * Every ancestor's computed transform, scale and zoom that is not the identity, collected in the
 * page for renderedFontPx (src/lib/a11yRules.ts). Passed into page.evaluate as source, since a
 * function cannot be handed across; `new Function` rebuilds it there.
 */
const SCALE_CHAIN_SRC = `el => {
  const out = [];
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.transform !== 'none' || (cs.scale && cs.scale !== 'none') || (cs.zoom && cs.zoom !== '1')) out.push({ transform: cs.transform, scale: cs.scale || 'none', zoom: cs.zoom || '1' });
  }
  return out;
}`;

let rulesModule = null;
/** src/lib/a11yRules.ts, loaded on first use so importing this file needs no TypeScript. */
async function a11yRules() {
  rulesModule ??= await import(pathToFileURL(path.join(ROOT, 'src/lib/a11yRules.ts')).href);
  return rulesModule;
}

/**
 * Visible text under the roots whose size is under the floor. Text on the journey map is measured
 * as DRAWN (T02): its computed size times the scale of every ancestor (renderedFontPx in
 * src/lib/a11yRules.ts), because the map's viewport scales by the zoom and line captions and
 * design-check badges counter-scale inside it. A card's step name ([data-jv-title], F3) was the
 * first text measured this way; captions and badges drew at 7px at fit while their computed 11px
 * passed. Other text keeps its computed size.
 */
async function smallTextIn(page, roots) {
  const { renderedFontPx } = await a11yRules();
  const texts = await page.evaluate(([sel, chainSrc]) => {
    const chainOf = new Function(`return (${chainSrc})`)();
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim();
        const el = n.parentElement;
        if (!text || !el || el.closest('svg')) continue;
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden') continue;
        const title = el.closest('.react-flow__node [data-jv-title]');
        // A title that is faded out is not drawn, so its size is not read either.
        if (title && typeof title.checkVisibility === 'function' && !title.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        // Nor is a name drawn at 0: a short card far out keeps its icon and drops its name rather
        // than draw it under the floor (index.css, .jv-step-summary__text).
        if (title && parseFloat(style.fontSize) === 0) continue;
        // Nor text that only a screen reader gets (.jv-sr-only), whose drawn size is nothing.
        if (el.closest('.jv-sr-only')) continue;
        const onMap = Boolean(el.closest('.react-flow__viewport'));
        out.push({ text: text.slice(0, 40), fontSizePx: parseFloat(style.fontSize), chain: onMap ? chainOf(el) : null, title: Boolean(title) });
      }
    }
    return out;
  }, [roots, SCALE_CHAIN_SRC]);
  const out = [];
  for (const t of texts) {
    const px = t.chain ? renderedFontPx(t.fontSizePx, t.chain) : t.fontSizePx;
    if (px >= MIN_TEXT_PX) continue;
    const kind = t.title ? 'a step name' : 'map text';
    out.push(`${px}px${t.chain ? ` rendered (${t.fontSizePx}px times the map's scale), ${kind}` : ''} "${t.text}"`);
  }
  return [...new Set(out)];
}

/** Visible controls with no programmatic label. */
function unlabelledIn(page, roots) {
  return page.evaluate(sel => {
    const out = [];
    const named = el => {
      if (el.labels && el.labels.length) return true;
      if ((el.getAttribute('aria-label') || '').trim()) return true;
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      return ids.some(id => (document.getElementById(id)?.textContent || '').trim());
    };
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('input, select, textarea')) {
        if (el.type === 'hidden' || !el.getClientRects().length) continue;
        if (!named(el)) out.push(`<${el.tagName.toLowerCase()} ${el.type || ''} id="${el.id}" placeholder="${el.getAttribute('placeholder') || ''}">`);
      }
    }
    return out;
  }, roots);
}

/** Visible buttons with no name and images with no alt. */
function unnamedIn(page, roots) {
  return page.evaluate(sel => {
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const b of root.querySelectorAll('button, [role="button"], [role="menuitem"]')) {
        if (!b.getClientRects().length) continue;
        const ids = (b.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const name = (b.getAttribute('aria-label') || '').trim() || ids.map(id => document.getElementById(id)?.textContent || '').join('').trim() || (b.innerText || '').trim() || (b.getAttribute('title') || '').trim();
        if (!name) out.push(`button: ${b.outerHTML.slice(0, 90)}`);
      }
      for (const img of root.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`img without alt: ${img.src.slice(0, 60)}`);
    }
    return [...new Set(out)];
  }, roots);
}

/** The panel's tab buttons: Settings, Preview and Export in their editor wording. */
function tabButtons(page) {
  return page.evaluateHandle(sel => {
    const panel = document.querySelector(sel);
    if (!panel) return [];
    return [...panel.querySelectorAll('button')].filter(b => /settings|edit page|preview|export/i.test(b.textContent.trim()) && b.textContent.trim().length < 40 && b.hasAttribute('aria-pressed'));
  }, STEP_PANEL);
}

async function eachPanelTab(page, fn) {
  const handles = await tabButtons(page);
  const count = await handles.evaluate(list => list.length);
  if (count === 0) {
    await fn('(no aria-pressed tabs found)');
    return;
  }
  for (let i = 0; i < count; i++) {
    const tab = (await (await tabButtons(page)).evaluateHandle((list, j) => list[j], i)).asElement();
    if (!tab) continue;
    const name = await tab.evaluate(b => b.textContent.trim());
    await tab.click();
    await page.waitForTimeout(120);
    await fn(name);
  }
}

const VIEW_ROOTS = `.react-flow, header, [role="toolbar"], ${STEP_PANEL}, [role="dialog"]`;

// ---- Checks ----

export async function checkStepNames(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    const nodes = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(n => ({
      id: n.getAttribute('data-id'),
      label: n.getAttribute('aria-label'),
      role: n.getAttribute('aria-roledescription'),
      described: (n.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim(),
      // The card's own status strip (PublishStatusStrip): "Not published", "Published · Rev 3".
      strip: n.querySelector('[data-publish-status]')?.textContent?.trim() ?? null
    })));
    // The status word is the one the card's strip shows (U07), so the page's name is read off it.
    const landing = nodes.find(n => n.id === 'node-page-1');
    if (landing && !landing.strip) f.push('node-page-1 shows no publish status strip, so its spoken status could not be compared');
    const pageStatus = landing?.strip ? `, ${landing.strip.split(' · ')[0].toLowerCase()}` : '';
    const expected = {
      'node-ad-1': 'Meta ad',
      'node-page-1': `Landing page /vip-consultation${pageStatus}`,
      'node-form-1': 'Lead form "Where should we reach you?", 4 fields',
      'node-seq-1': 'Nurture sequence "New Client 3-Part Follow-Up", 3 messages'
    };
    for (const n of nodes) {
      if (!n.label) f.push(`${n.id} has no aria-label`);
      if (n.role !== 'step') f.push(`${n.id} aria-roledescription is ${JSON.stringify(n.role)}, not "step"`);
      if (expected[n.id] && n.label !== expected[n.id]) f.push(`${n.id} is named ${JSON.stringify(n.label)}, expected ${JSON.stringify(expected[n.id])}`);
      if (!n.described.startsWith('Press Enter to open this step')) f.push(`${n.id} description reads ${JSON.stringify(n.described)}`);
    }
    const leaks = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label')).filter(l => /node-|edge-/.test(l)));
    for (const l of leaks) f.push(`an aria-label names an id: ${JSON.stringify(l)}`);
    return f;
  });
}

export async function checkEdgeWords(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    const raw = await page.evaluate(() => document.querySelectorAll('[aria-label^="Edge from"]').length);
    if (raw) f.push(`${raw} elements still read "Edge from ..."`);
    const lines = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map(e => ({ id: e.getAttribute('data-id') || e.id, hidden: e.getAttribute('aria-hidden'), tab: e.getAttribute('tabindex') })));
    for (const l of lines) {
      if (l.hidden !== 'true') f.push(`line ${l.id} is not aria-hidden`);
      if (l.tab !== null) f.push(`line ${l.id} has tabindex ${l.tab}`);
    }
    const pills = await page.evaluate(sel => [...document.querySelectorAll(sel)].map(b => ({
      name: b.getAttribute('aria-label') || b.innerText.trim(),
      desc: (b.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim()
    })), PILLS);
    if (!pills.length) f.push('no rate pill buttons found');
    for (const p of pills) {
      if (!LINE_WORDS.test(p.desc)) f.push(`pill ${JSON.stringify(p.name)} is described as ${JSON.stringify(p.desc)}`);
      if (DOUBLE_STOP.test(p.desc)) f.push(`pill ${JSON.stringify(p.name)} description reads "?.": ${JSON.stringify(p.desc)}`);
      if (p.desc.includes('\u2014')) f.push(`pill description has an em dash: ${p.desc}`);
      if (/node-|edge-/.test(p.desc)) f.push(`pill description names an id: ${p.desc}`);
    }
    return f;
  });
}

async function stepRoundTrip(page, key, f, label) {
  await keyboardFocus(page, stepSel('node-page-1'));
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  const type = await stepPanelType(page);
  if (type !== 'Landing Page Editor') f.push(`${label}: ${key === ' ' ? 'Space' : key} on the landing page opened ${JSON.stringify(type ?? (await panelTitle(page)))}`);
  const a = await activeInfo(page);
  if (!a.inPanel) f.push(`${label}: focus is not inside the step panel after ${key === ' ' ? 'Space' : key} (${a.tag} ${a.label ?? a.text})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const after = await activeInfo(page);
  if ((await stepPanelType(page)) === 'Landing Page Editor') f.push(`${label}: Escape did not close the step panel`);
  if (after.dataId !== 'node-page-1') f.push(`${label}: after Escape focus is on ${after.tag} ${after.id ?? after.label ?? after.text}, not the step`);
}

export async function checkStepRoundTrip(browser, { base }) {
  const f = [];
  for (const width of [1440, 390]) {
    await withApp(browser, { base, viewport: { width, height: width > 500 ? 900 : 844 } }, async page => {
      await stepRoundTrip(page, 'Enter', f, `${width}px`);
      await stepRoundTrip(page, ' ', f, `${width}px`);
      // Escape while the step itself keeps focus closes its panel and leaves focus on the step.
      await keyboardFocus(page, stepSel('node-page-1'));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      await keyboardFocus(page, stepSel('node-page-1'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      if ((await stepPanelType(page)) === 'Landing Page Editor') f.push(`${width}px: Escape on the focused step left its panel open`);
      const a = await activeInfo(page);
      if (a.dataId !== 'node-page-1') f.push(`${width}px: Escape on the step moved focus to ${a.isBody ? '<body>' : a.tag}`);
    });
  }
  return f;
}

export async function checkLineRoundTrip(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    const first = await page.$(PILLS);
    if (!first) return ['no rate pill button to open'];
    const name = await first.evaluate(b => b.getAttribute('aria-label') || b.innerText);
    await openPill(page);
    const title = await panelTitle(page);
    if (title !== 'Step Transition Analytics') f.push(`Enter on a pill opened ${JSON.stringify(title)}`);
    if (!(await activeInfo(page)).inPanel) f.push('focus is not inside the line panel');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const back = await page.evaluate(n => { const a = document.activeElement; return (a?.getAttribute('aria-label') || a?.innerText) === n && a.closest('[data-jv-edge-label]') !== null; }, name);
    if (!back) f.push(`Escape did not return focus to the pill (${JSON.stringify((await activeInfo(page)))})`);
    return f;
  });
}

// C34: Tab and a screen reader meet the steps first and the lines after them, and a selected
// step's + Before and + Next right after that step, never after the last step on the map.
export async function checkMapOrder(browser, { base }) {
  const f = [];
  for (const width of [1440, 390]) {
    await withApp(browser, { base, viewport: { width, height: width > 500 ? 900 : 844 } }, async page => {
      const order = await page.evaluate(sel => [...document.querySelectorAll(`.react-flow__node, ${sel}`)]
        .map(el => (el.classList.contains('react-flow__node') ? 'step' : 'pill')), PILLS);
      const lastStep = order.lastIndexOf('step');
      const firstPill = order.indexOf('pill');
      if (firstPill === -1) f.push(`${width}px: no line pill on the map`);
      else if (firstPill < lastStep) f.push(`${width}px: a line pill comes before a step in Tab order (${order.join(' ')})`);
      await keyboardFocus(page, stepSel('node-page-1'));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      await keyboardFocus(page, stepSel('node-page-1'));
      const walk = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        walk.push(await page.evaluate(() => {
          const a = document.activeElement;
          return { name: a?.getAttribute('aria-label') || '', step: a?.closest('.react-flow__node')?.getAttribute('data-id') ?? null };
        }));
      }
      const plus = walk.findIndex(w => /^Add a step (before|after) /.test(w.name));
      const other = walk.findIndex(w => w.step && w.step !== 'node-page-1');
      if (plus === -1) f.push(`${width}px: + Before / + Next are not the next Tab stops after the selected step (${walk.map(w => w.name).join(' > ')})`);
      else if (other !== -1 && other < plus) f.push(`${width}px: another step comes before the selected step's + Before / + Next`);
    });
  }
  return f;
}

export async function checkDeletionFallback(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    await keyboardFocus(page, stepSel('node-page-1'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const del = (await buttonByText(page, 'Delete this step', STEP_PANEL.split(',')[1].trim())).asElement() ?? (await buttonByText(page, 'Delete this step')).asElement();
    if (!del) return ['no "Delete this step" button in the step panel'];
    await del.click();
    await page.waitForTimeout(250);
    const a = await activeInfo(page);
    // The docked panel (#7) keeps focus in its finder; a floating dialog falls back to the map.
    if (a.isBody) f.push('after deleting a step, focus fell to <body>');
    else if (a.id !== 'journey-map' && !a.inPanel) f.push(`after deleting a step, focus is on ${a.tag} ${a.id ?? a.label}`);
    return f;
  });
}

async function trapped(page, presses, key, f, label) {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    if (!(await activeInfo(page)).inModal) {
      f.push(`${label}: ${key} press ${i + 1} left the modal`);
      return;
    }
  }
}

export async function checkModalTrap(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    await keyboardFocus(page, AUDIT);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    if (!(await page.$(MODAL))) f.push('the Audit is not a [role=dialog][aria-modal=true]');
    if (!(await activeInfo(page)).inModal) f.push('focus did not move into the Audit');
    await trapped(page, 60, 'Tab', f, 'Audit');
    await trapped(page, 60, 'Shift+Tab', f, 'Audit');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (await page.$(MODAL)) f.push('Escape did not close the Audit');
    const a = await activeInfo(page);
    if (!a.label?.startsWith('Check design')) f.push(`after the Audit, focus is on ${a.isBody ? '<body>' : `${a.tag} ${a.label ?? a.text}`}`);
    await dismissModals(page);

    const more = (await buttonByText(page, 'More')).asElement();
    if (!more) return [...f, 'no More button'];
    await keyboardFocus(page, more);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const item = (await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('ROAS Forecaster')) ?? null)).asElement();
    if (!item) return [...f, 'no ROAS Forecaster menu item'];
    await item.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    if (!(await page.$(MODAL))) f.push('the Forecaster is not a [role=dialog][aria-modal=true]');
    if (!(await activeInfo(page)).inModal) f.push('focus did not move into the Forecaster');
    await trapped(page, 60, 'Tab', f, 'Forecaster');
    await trapped(page, 60, 'Shift+Tab', f, 'Forecaster');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    if (await page.$(MODAL)) f.push('Escape did not close the Forecaster');
    const b = await activeInfo(page);
    if (b.text !== 'More') f.push(`after the Forecaster, focus is on ${b.isBody ? '<body>' : `${b.tag} ${b.label ?? b.text}`}, not More`);
    return f;
  });
}

/** The header's Add Step and More menus by keyboard (C30): opening one puts focus on its first
 *  item, the arrow keys, Home and End move between items, and Escape from an item closes the menu
 *  and hands focus back to its button instead of dropping it on the page body. */
export async function checkHeaderMenus(browser, { base }) {
  const f = [];
  for (const width of [1440, 390]) {
    await withApp(browser, { base, viewport: { width, height: 900 } }, async page => {
      for (const name of ['Add Step', 'More']) {
        await part(f, `${width}px ${name}`, async () => {
          const trigger = (await buttonByText(page, name)).asElement();
          if (!trigger) { f.push(`${width}px: no ${name} button`); return; }
          const items = () => page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(b => b.textContent.trim()));
          const focused = async () => { const a = await activeInfo(page); return a.isBody ? '<body>' : a.text; };
          await keyboardFocus(page, trigger);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(150);
          const list = await items();
          if (list.length < 2) { f.push(`${width}px: ${name} opened ${list.length} menu items`); return; }
          if ((await focused()) !== list[0]) f.push(`${width}px: opening ${name} left focus on ${await focused()}, not its first item`);
          await page.keyboard.press('ArrowDown');
          if ((await focused()) !== list[1]) f.push(`${width}px: ArrowDown in ${name} moved focus to ${await focused()}, not ${list[1]}`);
          await page.keyboard.press('End');
          if ((await focused()) !== list[list.length - 1]) f.push(`${width}px: End in ${name} moved focus to ${await focused()}`);
          await page.keyboard.press('Home');
          if ((await focused()) !== list[0]) f.push(`${width}px: Home in ${name} moved focus to ${await focused()}`);
          // Escape from an item, however focus got there, which is what unmounts under the focus.
          await page.locator('[role="menu"] [role="menuitem"]').last().focus();
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
          if ((await items()).length) f.push(`${width}px: Escape did not close ${name}`);
          if ((await focused()) !== name) f.push(`${width}px: Escape from a ${name} item left focus on ${await focused()}, not ${name}`);
        }, page);
      }
    });
  }
  return f;
}

export async function checkStacking(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    await part(f, 'Audit over the step panel', async () => {
      await keyboardFocus(page, stepSel('node-page-1'));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      if ((await stepPanelType(page)) !== 'Landing Page Editor') {
        await page.click(stepSel('node-page-1'));
        await page.waitForTimeout(250);
      }
      await page.click(AUDIT);
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      if (await page.$(MODAL)) f.push('Escape did not close the Audit over the step panel');
      if ((await stepPanelType(page)) !== 'Landing Page Editor') f.push('Escape on the Audit also closed the step panel');
      await dismissModals(page);
    });
    await part(f, 'product picker over the upsell panel', async () => {
      if (!(await addStep(page, 'Upsell'))) { f.push('could not add an Upsell from Add Step'); return; }
      if (!/Upsell/.test((await panelTitle(page)) ?? '')) {
        // A new step may not open by itself; open the newest upsell card.
        const cards = await page.$$('.react-flow__node-upsell');
        if (cards.length) await cards[cards.length - 1].click({ force: true });
        await page.waitForTimeout(250);
      }
      const browse = (await buttonByText(page, 'Browse Catalog')).asElement();
      if (!browse) { f.push('no Browse Catalog button in the upsell panel'); return; }
      await keyboardFocus(page, browse);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      if (!(await page.$(MODAL))) f.push('the product picker is not a [role=dialog][aria-modal=true]');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      if (await page.$(MODAL)) f.push('Escape did not close the product picker');
      if (!/Upsell/.test((await panelTitle(page)) ?? '')) f.push('Escape on the picker also closed the upsell panel');
      const a = await activeInfo(page);
      if (a.text !== 'Browse Catalog') f.push(`after the picker, focus is on ${a.isBody ? '<body>' : `${a.tag} ${a.label ?? a.text}`}`);
    });
    return f;
  });
}

async function ringOn(page, handle, label, f) {
  if (!handle) { f.push(`${label}: not found`); return; }
  await keyboardFocus(page, handle);
  // Controls with `transition: all` ease the ring in; read it once it has settled.
  await page.waitForTimeout(300);
  const s = await handle.evaluate(el => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; });
  if (s.style !== 'solid' || s.width !== '2px' || s.color !== FOCUS_RGB) f.push(`${label}: outline is ${s.style} ${s.width} ${s.color}`);
}

export async function checkFocusRings(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    await ringOn(page, await page.$(stepSel('node-page-1')), 'a step', f);
    await ringOn(page, await page.$(PILLS), 'a rate pill', f);
    await ringOn(page, await page.$('button[aria-label="Retention flows"]') ?? (await buttonByText(page, 'Retention Flows')).asElement(), 'the retention toggle', f);
    await keyboardFocus(page, stepSel('node-page-1'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    await ringOn(page, await page.$(`#page-headline`), 'the page headline input', f);
    await page.click(AUDIT);
    await page.waitForTimeout(300);
    const close = await page.$(`${MODAL} button[aria-label="Close"], ${MODAL} button[aria-label^="Close"], button[aria-label="Close Audit Drawer"]`);
    await ringOn(page, close, 'the Audit close button', f);
    return f;
  });
}

async function minTextHere(page, where, f) {
  await guardPanel(page, where, f);
  for (const hit of await smallTextIn(page, VIEW_ROOTS)) f.push(`${where}: ${hit}`);
}

/** A panel state with nothing to scan is a finding: a clean result there would prove nothing. */
async function guardPanel(page, where, f) {
  if (!/mode$/.test(where) && !(await page.$(`${STEP_PANEL}, ${MODAL}`))) f.push(`${where}: no step panel or dialog to scan`);
}

async function labelsHere(page, where, f) {
  await guardPanel(page, where, f);
  for (const hit of await unlabelledIn(page, VIEW_ROOTS)) f.push(`${where}: ${hit}`);
}

/** Runs `scan` in every state the spec names: modes, every step's tabs, the line panel and the modals. */
async function everyState(browser, base, scan) {
  const f = [];
  await withApp(browser, { base }, async page => {
    await part(f, 'adding one of each step', async () => {
      for (const [, words] of ADD_ITEMS) if (!(await addStep(page, words))) f.push(`could not add ${words}`);
      await page.keyboard.press('Escape');
    }, page);
    await part(f, 'edit mode', () => scan(page, 'edit mode', f), page);
    await part(f, 'Live ROAS mode', async () => {
      if (!(await page.$('button[aria-label="Live ROAS"]'))) return;
      await page.click('button[aria-label="Live ROAS"]');
      await page.waitForTimeout(300);
      await scan(page, 'Live ROAS mode', f);
      await page.click('button[aria-label="Edit Canvas"]');
      await page.waitForTimeout(300);
    }, page);
    const ids = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')));
    const seenTypes = new Set();
    for (const id of ids) {
      const type = await page.evaluate(sel => [...document.querySelector(sel).classList].find(c => c.startsWith('react-flow__node-'))?.slice(17), stepSel(id));
      if (seenTypes.has(type)) continue;
      seenTypes.add(type);
      await part(f, `${type} panel`, async () => {
        await keyboardFocus(page, stepSel(id));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        await eachPanelTab(page, tab => scan(page, `${type} panel, ${tab}`, f));
        if (type === 'upsell' && (await clickButton(page, 'Browse Catalog'))) {
          await scan(page, 'product picker', f);
          await page.keyboard.press('Escape');
          await dismissModals(page);
        }
      }, page);
    }
    await part(f, 'line panel', async () => {
      if (await openPill(page)) await scan(page, 'line panel', f);
    }, page);
    await part(f, 'Audit', async () => {
      await page.click(AUDIT);
      await page.waitForTimeout(300);
      await scan(page, 'Audit', f);
      await page.keyboard.press('Escape');
      await dismissModals(page);
    }, page);
    await part(f, 'Forecaster', async () => {
      if (!(await clickButton(page, 'More'))) return;
      const item = (await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('ROAS Forecaster')) ?? null)).asElement();
      if (!item) return;
      // The keyboard path, so a panel that overlaps the menu cannot block the choice.
      await item.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      await scan(page, 'Forecaster', f);
    }, page);
  });
  return [...new Set(f)];
}

export async function checkMinText(browser, { base }) {
  return everyState(browser, base, minTextHere);
}

/**
 * A zoomed-out card's step name (F3) ends in whole lines inside its card and never draws under the
 * floor, however far out the map's own Zoom out button takes it. At fit it is 14px on screen; one
 * press on a phone (about 0.2) is where the ad card's name used to be cut through its second line,
 * because the icon made the first line taller than the name's line-height. Further out a short
 * card's name draws at 0 and the card keeps its icon.
 */
export async function checkStepNamesFit(browser, { base }) {
  const f = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await withApp(browser, { base, viewport }, async page => {
      await dismissModals(page);
      let last = null;
      for (let press = 0; press <= 4; press++) {
        if (press) {
          await page.click('.react-flow__controls-zoomout');
          await page.waitForTimeout(500);
          await settle(page);
        }
        const r = await page.evaluate(() => {
          const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '')?.[1] ?? 1) || 1;
          const names = [];
          for (const node of document.querySelectorAll('.react-flow__node')) {
            const title = [...node.querySelectorAll('[data-jv-title]')].find(t => t.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
            if (!title) { names.push({ id: node.dataset.id, missing: true }); continue; }
            const text = title.querySelector('.jv-step-summary__text') ?? title;
            const box = (title.closest('.jv-step-summary') ?? node).getBoundingClientRect();
            const at = title.getBoundingClientRect();
            // A line of text is cut when the clip (the name's own box, or the card's) crosses it
            // above its baseline, about three quarters down the line's text box. A line wholly
            // below the clip is one the two-line clamp left out, which is what the ellipsis is for.
            const clip = Math.min(at.bottom, box.bottom);
            const range = document.createRange();
            range.selectNodeContents(text);
            const cut = [...range.getClientRects()].some(l => l.height > 0 && l.top < clip - 1 && clip < l.top + 0.75 * l.height);
            names.push({
              id: node.dataset.id,
              px: Math.round(parseFloat(getComputedStyle(text).fontSize) * zoom * 100) / 100,
              cut,
              inside: at.top >= box.top - 0.5 && at.bottom <= box.bottom + 0.5 && at.left >= box.left - 0.5 && at.right <= box.right + 0.5
            });
          }
          return { zoom: Math.round(zoom * 1000) / 1000, names };
        });
        const where = `${viewport.width}px zoom ${r.zoom}`;
        if (press && last !== null && r.zoom >= last) f.push(`${where}: Zoom out did not zoom out`);
        last = r.zoom;
        for (const n of r.names) {
          if (n.missing) { f.push(`${where}: ${n.id} shows no step name`); continue; }
          if (n.px > 0 && n.px < MIN_TEXT_PX) f.push(`${where}: ${n.id}'s name draws at ${n.px}px, under the ${MIN_TEXT_PX}px floor`);
          if (n.cut) f.push(`${where}: ${n.id}'s name is cut through a line of text`);
          if (!n.inside) f.push(`${where}: ${n.id}'s name reaches outside its card`);
        }
      }
      // The control: the presses must reach the zoom the phone's name was cut at.
      if (viewport.width === 390 && !(last <= 0.2)) f.push(`390px: Zoom out stopped at ${last}, above 0.2, so the cut name was never reached`);
    });
  }
  return f;
}

/**
 * T02: at fit-to-screen on the default map and on bp6, at 1440 and 390, every line caption and every
 * design-check badge that is drawn renders at 11px or more on screen (font-size times every ancestor
 * scale, not the computed 11px that used to pass while they drew at 7px and under 3px), and no drawn
 * caption overlaps a card, a handle, a badge or another caption. A caption that has no room shows its
 * figure only or is not drawn (opacity 0), so it is not measured, but its button must still be in the
 * page with the line's words as its name. The same holds one and two presses of the map's own Zoom
 * out past fit, where the 11px badge is bigger than its card: no drawn badge may overlap a card other
 * than its own, any handle or another badge, and no handle's centre may sit under a badge or a caption
 * (a press there opened Check design instead of starting a line). A badge with no room shows as a dot
 * or not at all, and keeps its name. The controls: the map must be zoomed out (a scale above 1 is what
 * is being checked), each press must zoom further out, and at fit there must be captions and badge
 * text to measure.
 */
export async function checkMapCaptions(browser, { base }) {
  const f = [];
  const { renderedFontPx } = await a11yRules();
  const { findCollisions } = await import(pathToFileURL(path.join(ROOT, 'src/lib/edgeLabelLayout.ts')).href);
  const { ECOM_BLUEPRINTS } = await import(pathToFileURL(path.join(ROOT, 'src/data/ecomBlueprints.ts')).href);
  const { zeroBlueprintMetrics } = await import(pathToFileURL(path.join(ROOT, 'src/lib/liveStats.ts')).href);
  const { repairEdgeHandles } = await import(pathToFileURL(path.join(ROOT, 'src/lib/stepHandles.ts')).href);
  const bp = ECOM_BLUEPRINTS.find(b => b.id === 'turnkey-retention-ecosystem');
  // As Use Blueprint opens it (canvas-browser-check's blueprintProject): its own positions, no seeded numbers.
  const bpNodes = structuredClone(bp.nodes);
  const blank = zeroBlueprintMetrics(bpNodes, repairEdgeHandles(bpNodes, structuredClone(bp.edges)));
  const bp6 = { id: `check-${bp.id}`, name: bp.title, businessType: 'ecom', offerHeadline: '', goal: '', nodes: blank.nodes, edges: blank.edges, updatedAt: new Date(0).toISOString() };
  for (const [map, seed] of [['default map', null], ['bp6', bp6]]) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await part(f, `${map} ${viewport.width}px`, () => withApp(browser, { base, viewport, seed }, async page => {
        await dismissModals(page);
        let last = null;
        for (let press = 0; press <= 2; press++) {
          if (press) {
            await page.click('.react-flow__controls-zoomout');
            await page.waitForTimeout(500);
            await settle(page);
            // Off the map, so no pill or badge is hovered while it is measured.
            await page.mouse.move(1, viewport.height - 1);
          }
          // The caption layout places captions a frame after the fit settles, and badges and captions
          // again once the map has been still for a moment after a zoom.
          await page.waitForTimeout(400);
          const r = await page.evaluate(chainSrc => {
            const chainOf = new Function(`return (${chainSrc})`)();
            const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '')?.[1] ?? 1) || 1;
            const drawn = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
            const rect = (el, id) => {
              const b = el.getBoundingClientRect();
              return { id, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
            };
            const texts = [];
            const pills = [...document.querySelectorAll('[data-jv-edge-label] > button')];
            // Found by its name ("N design checks on <step>"), the contract a screen reader relies on.
            const badges = [...document.querySelectorAll('.react-flow__node button[aria-label*=" design check"]')];
            for (const root of [...pills, ...badges]) {
              if (!drawn(root)) continue;
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const el = n.parentElement;
                const text = n.textContent.trim();
                if (!text || !el || !el.getClientRects().length || !drawn(el)) continue;
                texts.push({ text, kind: badges.includes(root) ? 'badge' : 'caption', fontSizePx: parseFloat(getComputedStyle(el).fontSize), chain: chainOf(el) });
              }
            }
            const shown = pills.filter(drawn);
            const nodeOf = el => el.closest('.react-flow__node')?.dataset.id;
            // A handle whose centre, on screen, is under a badge or a caption rather than the handle.
            const covered = [];
            for (const h of document.querySelectorAll('.react-flow__handle')) {
              const b = h.getBoundingClientRect();
              const x = b.left + b.width / 2;
              const y = b.top + b.height / 2;
              if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
              const at = document.elementFromPoint(x, y);
              const over = at && !h.contains(at) ? at.closest('[data-jv-design-badge], [data-jv-edge-label]') : null;
              if (over) covered.push(`a ${nodeOf(h)} handle's centre is under ${over.matches('[data-jv-design-badge]') ? `the ${over.dataset.jvDesignBadge} design-check badge` : 'a line caption'}`);
            }
            return {
              zoom,
              texts,
              pills: pills.length,
              // The figure in words as its name, and where the line goes as its description.
              unnamed: pills.filter(p => {
                const words = document.getElementById(p.getAttribute('aria-describedby') || '')?.textContent || '';
                return !/: .+\./.test(p.getAttribute('aria-label') || '') || !words.includes(': from ');
              }).length,
              badges: badges.length,
              unnamedBadges: badges.filter(b => !/^\d+ design checks? on .+/.test(b.getAttribute('aria-label') || '')).length,
              forms: pills.map(p => p.parentElement.dataset.jvCaptionForm || 'full'),
              captions: shown.map((p, i) => rect(p, `caption "${p.textContent.trim().slice(0, 24)}" #${i}`)),
              badgeRects: badges.filter(b => drawn(b) && b.getBoundingClientRect().width > 0.5).map(b => ({ ...rect(b, `the ${nodeOf(b)} design-check badge`), card: `the ${nodeOf(b)} card` })),
              cards: [...document.querySelectorAll('.react-flow__node')].map(n => rect(n, `the ${n.dataset.id} card`)),
              handles: [...document.querySelectorAll('.react-flow__handle')].map(h => rect(h, `a ${nodeOf(h)} handle`)),
              covered
            };
          }, SCALE_CHAIN_SRC);
          const zoom = Math.round(r.zoom * 1000) / 1000;
          const where = press ? `${map}, ${viewport.width}px, ${press} Zoom out ${press === 1 ? 'press' : 'presses'} past fit (zoom ${zoom})` : `${map}, ${viewport.width}px, fit zoom ${zoom}`;
          if (!press && !(r.zoom < 1)) f.push(`${where}: the fit is not zoomed out, so nothing scaled was measured`);
          if (press && last !== null && !(r.zoom < last)) f.push(`${where}: Zoom out did not zoom out`);
          last = r.zoom;
          if (r.pills === 0) f.push(`${where}: no line captions to measure`);
          if (r.badges === 0) f.push(`${where}: no design-check badge to measure`);
          if (r.unnamed) f.push(`${where}: ${r.unnamed} line pill(s) lost the line's words from their name or description`);
          if (r.unnamedBadges) f.push(`${where}: ${r.unnamedBadges} design-check badge(s) lost their name`);
          if (!press && !r.texts.some(t => t.kind === 'badge')) f.push(`${where}: no badge text was drawn`);
          const small = new Set();
          for (const t of r.texts) {
            const px = renderedFontPx(t.fontSizePx, t.chain);
            if (px < MIN_TEXT_PX) small.add(`${where}: the ${t.kind} text "${t.text}" draws at ${px}px (${t.fontSizePx}px times the map's scale), under the ${MIN_TEXT_PX}px floor`);
          }
          f.push(...small);
          for (const hit of findCollisions({ captions: r.captions, cards: r.cards, handles: r.handles, badges: r.badgeRects })) f.push(`${where}: ${hit.replace(' / ', ' overlaps ')}`);
          for (const c of r.covered) f.push(`${where}: ${c}, so a press there does not start a line`);
          if (SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `captions-${map.replace(/\W+/g, '-')}-${viewport.width}${press ? `-out${press}` : ''}.png`) });
        }
      }), null);
    }
  }
  return f;
}

/** A blueprint as Use Blueprint opens it (canvas-browser-check's blueprintProject): its own positions, no seeded numbers. */
async function blueprintSeed(id) {
  const { ECOM_BLUEPRINTS } = await import(pathToFileURL(path.join(ROOT, 'src/data/ecomBlueprints.ts')).href);
  const { zeroBlueprintMetrics } = await import(pathToFileURL(path.join(ROOT, 'src/lib/liveStats.ts')).href);
  const { repairEdgeHandles } = await import(pathToFileURL(path.join(ROOT, 'src/lib/stepHandles.ts')).href);
  const bp = ECOM_BLUEPRINTS.find(b => b.id === id);
  const nodes = structuredClone(bp.nodes);
  const blank = zeroBlueprintMetrics(nodes, repairEdgeHandles(nodes, structuredClone(bp.edges)));
  return { id: `check-${bp.id}`, name: bp.title, businessType: 'ecom', offerHeadline: '', goal: '', nodes: blank.nodes, edges: blank.edges, updatedAt: new Date(0).toISOString() };
}

/** Where every handle's hit area is measured (T03): the phone, the tablet both ways and a desktop, each at fit. */
export const HANDLE_TARGET_VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }];

/**
 * T03: zoomed out, facing handles on neighbouring cards sit closer than their hit areas are wide,
 * and on a phone a press just right of a card's output dot started a line from the next card's
 * input. On the default map and bp6, at fit at every HANDLE_TARGET_VIEWPORTS width, every handle:
 * lies over no other handle's dot; is at least 24px across its dot; and reaches where
 * handleHitReach (src/lib/semanticZoom.ts) says for the page's pointer, so the CSS and the maths
 * cannot drift apart. Into its card that is U01's cap (8px on screen with a mouse, half the dot on
 * a finger), so a press on a card body selects the card; card-press.test.mjs pins those floors.
 * An input never takes a press nearer an output's dot than its own (the old fault); in the gap
 * between two facing dots the output, which starts a line, wins. Areas are read with
 * elementsFromPoint, so one drawn under another card is still measured. The control: every map is
 * zoomed out at fit, and at 390px the areas have slid (an output reaches out less than it reaches in).
 */
export async function checkHandleTargets(browser, { base }) {
  const f = [];
  const { handleHitReach, COARSE_POINTER_QUERY } = await import(pathToFileURL(path.join(ROOT, 'src/lib/semanticZoom.ts')).href);
  const bp6 = await blueprintSeed('turnkey-retention-ecosystem');
  for (const [map, seed] of [['default map', null], ['bp6', bp6]]) {
    for (const viewport of HANDLE_TARGET_VIEWPORTS) {
      await part(f, `${map} ${viewport.width}px`, () => withApp(browser, { base, viewport, seed }, async page => {
        await dismissModals(page);
        await page.mouse.move(1, viewport.height - 1);
        const r = await page.evaluate(coarseQuery => {
          const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '')?.[1] ?? 1) || 1;
          const OUT = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] };
          const all = [...document.querySelectorAll('.react-flow__handle')].map(el => {
            const b = el.getBoundingClientRect();
            const id = el.dataset.handleid;
            const node = el.closest('.react-flow__node')?.dataset.id;
            return { el, pos: el.dataset.handlepos, source: el.classList.contains('source'), x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.width / 2, name: `the ${node} ${el.dataset.handlepos}${id ? ` "${id}"` : ''} ${el.classList.contains('source') ? 'output' : 'input'}` };
          });
          const inView = (x, y) => x >= 1 && y >= 1 && x < innerWidth - 1 && y < innerHeight - 1;
          const owns = (h, t) => !!t && (t === h.el || h.el.contains(t));
          const under = (h, x, y) => document.elementsFromPoint(x, y).includes(h.el);
          return {
            zoom,
            handles: all.map(h => {
              const [ox, oy] = OUT[h.pos] ?? [1, 0];
              const reach = (vx, vy) => {
                let last = 0;
                for (let s = 0; s <= 120; s += 0.25) {
                  const x = h.x + vx * s;
                  const y = h.y + vy * s;
                  if (!inView(x, y) || !under(h, x, y)) break;
                  last = s;
                }
                return last;
              };
              // Another handle's dot this area lies over (its centre or 90% of the way to its edge).
              const covers = all.filter(o => o !== h && [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]].some(([dx, dy]) => inView(o.x + dx * o.r, o.y + dy * o.r) && under(h, o.x + dx * o.r, o.y + dy * o.r))).map(o => o.name);
              // For an output: a press within 10px, nearer its dot than any other, that an input takes.
              const stolen = new Set();
              if (h.source) {
                for (let d = 1; d <= 10; d++) {
                  for (let a = 0; a < 360; a += 15) {
                    const x = h.x + Math.cos((a * Math.PI) / 180) * d;
                    const y = h.y + Math.sin((a * Math.PI) / 180) * d;
                    if (!inView(x, y) || all.some(o => o !== h && Math.hypot(o.x - x, o.y - y) <= d)) continue;
                    const taker = all.find(o => o !== h && !o.source && owns(o, document.elementFromPoint(x, y)));
                    if (taker) stolen.add(taker.name);
                  }
                }
              }
              const out = reach(ox, oy);
              const inward = reach(-ox, -oy);
              return { name: h.name, source: h.source, out, in: inward, across: reach(-oy, ox) + reach(oy, -ox), covers, stolen: [...stolen] };
            }),
            pointer: matchMedia(coarseQuery).matches ? 'coarse' : 'fine'
          };
        }, COARSE_POINTER_QUERY);
        const where = `${map}, ${viewport.width}px, fit zoom ${Math.round(r.zoom * 1000) / 1000}`;
        if (!(r.zoom < 1)) f.push(`${where}: the fit is not zoomed out, so no enlarged hit area was measured`);
        if (!r.handles.length) f.push(`${where}: no handles to measure`);
        if (viewport.width === 390 && !r.handles.some(h => h.out + 1 < h.in)) f.push(`${where}: no hit area slid into its card, so the T03 geometry was not exercised`);
        for (const h of r.handles) {
          const want = handleHitReach(r.zoom, h.source ? 'source' : 'target', r.pointer);
          for (const o of h.covers) f.push(`${where}: ${h.name}'s hit area lies over ${o}'s dot`);
          for (const o of h.stolen) f.push(`${where}: ${o} takes a press nearer ${h.name}'s dot than its own`);
          if (h.across < 24 - 0.5) f.push(`${where}: ${h.name} takes presses over ${h.across.toFixed(1)}px across its dot, under 24px`);
          for (const [side, got, px] of [['out of its card', h.out, want.out * r.zoom], ['into its card', h.in, want.in * r.zoom]]) {
            if (Math.abs(got - px) > 1.5) f.push(`${where}: ${h.name}'s hit area reaches ${got.toFixed(1)}px ${side}, where handleHitReach says ${px.toFixed(1)}px`);
          }
        }
        if (SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `handles-${map.replace(/\W+/g, '-')}-${viewport.width}.png`) });
      }), null);
    }
  }
  return f;
}

export async function checkLabels(browser, { base }) {
  return everyState(browser, base, labelsHere);
}

export async function checkButtonNames(browser, { base }) {
  return everyState(browser, base, async (page, where, f) => {
    await guardPanel(page, where, f);
    for (const hit of await unnamedIn(page, VIEW_ROOTS)) f.push(`${where}: ${hit}`);
  });
}

// 1720 and 1920 are where Test Lead Flow and the stats strip join the row: the Live ROAS ribbon is
// about 450px wider than the lead stats, and at those widths it used to push Add Step, Save and
// Publish onto a second row (C26). An edit adds the save status, so each width is checked both ways.
// 1024 is a tablet, where the edited row now fits on one row too (R01).
export const HEADER_FIT_WIDTHS = [1024, 1280, 1440, 1720, 1920];
// From here up Live ROAS shows a ROAS figure in the row, the ribbon or the pill that stands in for it,
// with or without a store: the compact row keeps the ROAS pill when the Store score pill is there too
// (T08; header-row-fit.test.mjs pins it from COMPACT_BELOW_PX up).
const ROAS_SHOWN_FROM_PX = 1720;
// With a store connected Check design carries the Store score pill (about 113px), and after an edit
// the row used to wrap at every one of these widths (C27). The edited state is the widest one.
export const STORE_FIT_WIDTHS = [1180, 1240, 1280, 1440, 1720, 1920];

export async function checkHeaderFits(browser, { base }) {
  const f = [];
  const cases = [];
  for (const width of HEADER_FIT_WIDTHS) for (const edited of [false, true]) cases.push({ width, edited, store: false });
  for (const width of STORE_FIT_WIDTHS) cases.push({ width, edited: true, store: true });
  for (const { width, edited, store } of cases) {
    await withApp(browser, { base, viewport: { width, height: 900 }, store }, async page => {
      if (edited) {
        await page.fill('input[aria-label="Journey name"]', 'Renamed journey');
        await page.waitForTimeout(1200);
      }
      const state = (edited ? ' after an edit' : '') + (store ? ' with a store connected' : '');
      if (store) {
        // Check design's name says the store score exactly where its pill shows it (R07), never a
        // score the row does not show.
        const { name, text } = await page.$eval('button[aria-label^="Check design"]', b => ({ name: b.getAttribute('aria-label'), text: b.textContent })).catch(() => ({}));
        const named = /store score \d+ out of 100$/.test(name ?? '');
        const shown = /Store score \d+\/100/.test(text ?? '');
        if (named && !shown) f.push(`${width}px${state}: Check design's name "${name}" says a store score the row does not show`);
        else if (shown && !named) f.push(`${width}px${state}: Check design's name "${name}" leaves out the store score its pill shows`);
      }
      for (const mode of ['Edit Canvas', 'Live ROAS']) {
        const toggle = await page.$(`button[aria-label="${mode}"]`);
        if (toggle) { await toggle.click(); await page.waitForTimeout(250); }
        const r = await page.evaluate(() => {
          const bar = document.querySelector('[aria-label="Journey tools"]');
          if (!bar) return null;
          // One row when every item shares a horizontal band (align-items: center moves tops apart).
          // The items inside each group count too: a group that wraps inside itself grows taller
          // while the other group stays centred beside it, so the two groups alone still overlap.
          // An empty item (the save status before any edit) has no height and is left out.
          const rects = [...bar.children].flatMap(c => [c, ...c.children]).map(c => c.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
          const band = Math.min(...rects.map(r => r.bottom)) - Math.max(...rects.map(r => r.top));
          const inView = t => { const b = [...bar.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(t)); if (!b) return 'missing'; const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; };
          // A ROAS figure (the ribbon's headline or the pill's), never the Live ROAS toggle's label.
          const roas = [...bar.querySelectorAll('[data-metric]')].some(el => { const r = el.getBoundingClientRect(); return /ROAS/.test(el.textContent) && r.width > 0 && r.left >= 0 && r.right <= innerWidth; });
          return { oneRow: band > 0, save: inView('Save'), publish: inView('Publish'), roas };
        });
        if (!r) { f.push(`${width}px: no toolbar named "Journey tools"`); continue; }
        if (!r.oneRow) f.push(`${width}px ${mode}${state}: the toolbar wraps onto more than one row`);
        if (r.save !== true) f.push(`${width}px ${mode}${state}: Save is ${r.save === 'missing' ? 'missing' : 'off screen'}`);
        if (r.publish !== true) f.push(`${width}px ${mode}${state}: Publish is ${r.publish === 'missing' ? 'missing' : 'off screen'}`);
        if (mode === 'Live ROAS' && width >= ROAS_SHOWN_FROM_PX && !r.roas) f.push(`${width}px ${mode}${state}: the toolbar shows no ROAS figure`);
      }
      if (store) {
        // The control: a store case that never connected would pass on the plain row. Below the
        // pill's width nothing in the row names the store, so the drawer's store score proves it.
        await page.click('button[aria-label^="Check design"]');
        const scored = await page.waitForFunction(() => /\d+ of \d+ store checks passed/.test(document.getElementById('jv-store-checks-title')?.parentElement?.textContent ?? ''), null, { timeout: 3000 }).then(() => true, () => false);
        if (!scored) f.push(`${width}px${state}: the store did not connect (Check design shows no store score)`);
      }
    });
  }
  await withApp(browser, { base, viewport: { width: 390, height: 844 } }, async page => {
    const reach = await page.evaluate(() => ['Save', 'Publish'].map(t => [...document.querySelectorAll('button, [role="menuitem"]')].some(b => b.textContent.trim().startsWith(t) && b.getClientRects().length)));
    const inMore = async t => {
      if (!(await clickButton(page, 'More'))) return false;
      const found = await page.evaluate(w => [...document.querySelectorAll('[role="menuitem"]')].some(b => b.textContent.includes(w)), t);
      await page.keyboard.press('Escape');
      return found;
    };
    if (!reach[0] && !(await inMore('Save'))) f.push('390px: Save cannot be reached');
    if (!reach[1] && !(await inMore('Publish'))) f.push('390px: Publish cannot be reached');
  });
  return f;
}

export async function checkAriaPressed(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    const toggle = await page.$('button[aria-label="Retention flows"]');
    if (!toggle) f.push('no button named "Retention flows"');
    else {
      const before = await toggle.getAttribute('aria-pressed');
      await toggle.click();
      await page.waitForTimeout(200);
      const after = await toggle.getAttribute('aria-pressed');
      const name = await toggle.getAttribute('aria-label');
      if (before !== 'true' || after !== 'false') f.push(`retention toggle aria-pressed went ${before} to ${after}`);
      if (name !== 'Retention flows') f.push(`retention toggle name changed to ${name}`);
    }
    await keyboardFocus(page, stepSel('node-page-1'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const pressedPair = async (texts, label) => {
      // An exact match first, so "Preview changes" (the publish panel) is never taken for the Preview tab.
      const states = async () => page.evaluate(([sel, t]) => t.map(x => {
        const buttons = [...document.querySelector(sel)?.querySelectorAll('button') ?? []];
        const text = b => b.textContent.trim().toLowerCase();
        return (buttons.find(b => text(b) === x) ?? buttons.find(b => text(b).startsWith(x)))?.getAttribute('aria-pressed') ?? 'missing';
      }), [STEP_PANEL, texts]);
      const s1 = await states();
      if (s1.includes('missing') || s1.includes(null)) { f.push(`${label}: aria-pressed ${JSON.stringify(s1)}`); return; }
      const off = texts[s1.indexOf('false')];
      const btn = (await page.evaluateHandle(([sel, t]) => {
        const buttons = [...document.querySelector(sel).querySelectorAll('button')];
        const text = b => b.textContent.trim().toLowerCase();
        return buttons.find(b => text(b) === t) ?? buttons.find(b => text(b).startsWith(t));
      }, [STEP_PANEL, off])).asElement();
      await btn.click();
      await page.waitForTimeout(150);
      const s2 = await states();
      if (JSON.stringify(s2) !== JSON.stringify([...s1].reverse())) f.push(`${label}: aria-pressed ${JSON.stringify(s1)} then ${JSON.stringify(s2)}`);
    };
    // The page editor's tabs read "Edit page" and "Preview" since #17.
    await pressedPair(['edit page', 'preview'], 'page editor tabs');
    const tabs = await tabButtons(page);
    const first = (await tabs.evaluateHandle(list => list[0] ?? null)).asElement();
    if (first) { await first.click(); await page.waitForTimeout(150); }
    // The checkout mode buttons sit in the collapsed "Product and checkout" section (#17).
    const section = (await page.evaluateHandle(sel => [...document.querySelector(sel)?.querySelectorAll('button') ?? []].find(b => b.textContent.trim().startsWith('Product and checkout')) ?? null, STEP_PANEL)).asElement();
    if (section && (await section.getAttribute('aria-expanded')) !== 'true') { await section.click(); await page.waitForTimeout(150); }
    await pressedPair(['direct to checkout', '2-step lead gate'], 'checkout mode');
    return f;
  });
}

export async function checkReducedMotion(browser, { base, seed }) {
  const f = [];
  const journey = structuredClone(seed);
  const edge = journey.edges.find(e => e.id === 'edge-ad-page');
  if (!edge) return ['the default journey has no edge-ad-page'];
  edge.animated = true;
  const nameOf = page => page.evaluate(() => { const p = document.querySelector('.react-flow__edge[data-id="edge-ad-page"] .react-flow__edge-path, [data-testid="rf__edge-edge-ad-page"] .react-flow__edge-path'); return p ? getComputedStyle(p).animationName : 'missing'; });
  await withApp(browser, { base, seed: journey, reducedMotion: 'no-preference' }, async page => {
    const name = await nameOf(page);
    if (name !== 'dashdraw') f.push(`positive control: with no preference the animated line shows ${name}, not dashdraw`);
  });
  await withApp(browser, { base, seed: journey, reducedMotion: 'reduce' }, async page => {
    const name = await nameOf(page);
    if (name !== 'none') f.push(`with reduced motion the animated line still shows ${name}`);
    const pill = await page.$(PILLS);
    if (pill) await pill.hover();
    await page.click(AUDIT);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const running = await page.evaluate(() => document.getAnimations().map(a => a.animationName || a.transitionProperty || a.constructor.name));
    if (running.length) f.push(`with reduced motion ${running.length} animations remain: ${[...new Set(running)].join(', ')}`);
  });
  return f;
}

/** Drags from one point to another with real mouse moves, as React Flow expects. */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

const centre = async handle => { const b = await handle.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

/** Findings for any canvas-only field in a saved journey. */
function decorationsIn(journey, stage) {
  const f = [];
  for (const item of [...journey.nodes, ...journey.edges]) {
    for (const key of ['ariaLabel', 'domAttributes', 'focusable']) if (key in item) f.push(`${stage}: ${item.id} was saved with ${key}`);
  }
  for (const e of journey.edges) if (e.data && 'description' in e.data) f.push(`${stage}: ${e.id} was saved with data.description`);
  return f;
}

export async function checkSavedData(browser, { base }) {
  return withApp(browser, { base }, async page => {
    const f = [];
    const readSaved = async () => {
      await page.waitForTimeout(800);
      const raw = await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    };
    const ids = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('data-id')));

    // 1. Drag a step 40px (handleNodeDragStop).
    await part(f, 'drag', async () => {
      const c = await centre(await page.$(stepSel('node-form-1')));
      await drag(page, { x: c.x, y: c.y - 30 }, { x: c.x, y: c.y + 10 });
      const saved = await readSaved();
      const form = saved?.nodes.find(n => n.id === 'node-form-1');
      if (!form || form.position.y === 170) f.push('drag: the moved step did not reach the save (positive control)');
      if (saved) f.push(...decorationsIn(saved, 'after a drag'));
    });

    // 2. Connect a new line (handleConnect) between two handles nothing covers; a rate pill can
    // sit on a right handle, and the map may refuse a pairing, so try a few. An exit that already
    // has a line asks "Replace?" (#13) and adds nothing, so exits with no line are tried first, and
    // a question that opens anyway is dismissed so it cannot block the parts after this one.
    await part(f, 'connect', async () => {
      const pairs = await page.evaluate(key => {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        const used = new Set((saved?.edges ?? []).map(e => `${e.source}|${e.sourceHandle ?? ''}`));
        const free = h => { const r = h.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; return document.elementFromPoint(x, y) === h ? { x, y } : null; };
        const handles = [...document.querySelectorAll('.react-flow__handle')];
        const out = [];
        for (const s of handles.filter(h => h.classList.contains('source'))) {
          const from = free(s);
          if (!from) continue;
          const node = s.closest('.react-flow__node');
          const exitUsed = used.has(`${node.getAttribute('data-id')}|${s.getAttribute('data-handleid') ?? ''}`);
          for (const t of handles.filter(h => h.classList.contains('target') && h.closest('.react-flow__node') !== node)) {
            const to = free(t);
            if (to) out.push({ from, to, exitUsed });
          }
        }
        return out.sort((a, b) => Number(a.exitUsed) - Number(b.exitUsed));
      }, STORAGE_KEY);
      const before = await ids();
      for (const pair of pairs.slice(0, 6)) {
        await drag(page, pair.from, pair.to);
        if (await page.$('dialog[open]')) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
        if ((await ids()).length > before.length) break;
      }
      const added = (await ids()).filter(id => !before.includes(id));
      if (!added.length) { f.push('connect: no line was added, so handleConnect was not exercised'); return; }
      const saved = await readSaved();
      if (!saved?.edges.some(e => e.id === added[0])) f.push('connect: the new line did not reach the save (positive control)');
      if (saved) f.push(...decorationsIn(saved, 'after a connect'));
    });

    // 3. Delete a step with Backspace (handleNodesChange). A click selects it; Escape would unselect it.
    await part(f, 'delete a step', async () => {
      await page.click(stepSel('node-seq-1'));
      await keyboardFocus(page, stepSel('node-seq-1'));
      await page.keyboard.press('Backspace');
      const saved = await readSaved();
      if (saved?.nodes.some(n => n.id === 'node-seq-1')) f.push('delete a step: the deleted step is still saved (positive control)');
      if (saved) f.push(...decorationsIn(saved, 'after deleting a step'));
    });

    // 4. Delete a line from its panel (handleEdgesChange).
    await part(f, 'delete a line', async () => {
      const before = await ids();
      if (!(await openPill(page))) { f.push('delete a line: no rate pill to open'); return; }
      const del = (await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && /disconnect/i.test(`${b.textContent} ${b.getAttribute('aria-label') || ''}`)) ?? null)).asElement();
      if (!del) { f.push('delete a line: no disconnect control in the line panel'); return; }
      await del.click();
      const saved = await readSaved();
      if (!saved || saved.edges.length >= before.length) f.push('delete a line: the removal did not reach the save (positive control)');
      if (saved) f.push(...decorationsIn(saved, 'after deleting a line'));
    });
    return [...new Set(f)];
  });
}

export async function checkLayout(browser, { base, shots }) {
  const f = [];
  await withApp(browser, { base }, async page => {
    for (const [, words] of ADD_ITEMS) await addStep(page, words);
    await page.keyboard.press('Escape');
    const clipped = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.react-flow__node *')) {
        if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const s = getComputedStyle(el);
        if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') continue;
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.push(`${el.closest('.react-flow__node').getAttribute('data-id')}: "${el.textContent.trim().slice(0, 30)}"`);
      }
      return out;
    });
    for (const c of clipped) f.push(`text clipped in a card: ${c}`);
    const ab = await page.evaluate(() => {
      const card = document.querySelector('.react-flow__node-ab-split');
      if (!card) return null;
      const res = {};
      for (const [handle, words] of [['branch-a', 'Branch A'], ['branch-b', 'Branch B']]) {
        const h = card.querySelector(`.react-flow__handle[data-handleid="${handle}"]`);
        const text = [...card.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim().startsWith(words));
        let pod = text;
        while (pod && pod !== card && pod.getBoundingClientRect().height < 30) pod = pod.parentElement;
        if (!h || !pod) { res[handle] = 'missing'; continue; }
        const hr = h.getBoundingClientRect();
        const pr = pod.getBoundingClientRect();
        const y = hr.top + hr.height / 2;
        res[handle] = y >= pr.top && y <= pr.bottom;
      }
      return res;
    });
    if (!ab) f.push('no A/B split card to measure');
    else for (const [h, ok] of Object.entries(ab)) if (ok !== true) f.push(`A/B split handle ${h} is ${ok === 'missing' ? 'missing' : 'not level with its pod'}`);
    if (shots) {
      for (const card of await page.$$('.react-flow__node')) {
        const type = await card.evaluate(n => [...n.classList].find(c => c.startsWith('react-flow__node-'))?.slice(17) + '-' + n.getAttribute('data-id'));
        // Added steps can land on top of each other, so hide the others while this one is taken.
        await page.evaluate(el => document.querySelectorAll('.react-flow__node, [data-jv-edge-label]').forEach(n => { if (n !== el) n.style.visibility = 'hidden'; }), card);
        await card.screenshot({ path: path.join(shots, `card-${type}.png`) }).catch(() => {});
        await page.evaluate(() => document.querySelectorAll('.react-flow__node, [data-jv-edge-label]').forEach(n => { n.style.visibility = ''; }));
      }
    }
  });
  for (const width of [1440, 768, 390]) {
    await withApp(browser, { base, viewport: { width, height: 900 } }, async page => {
      const over = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      if (over > 0) f.push(`${width}px: the page scrolls sideways by ${over}px`);
      if (shots) await page.screenshot({ path: path.join(shots, `canvas-${width}.png`) });
    });
  }
  return f;
}

// R22: a selected step's + Before and + Next never cover a line's rate pill (or its + Step), another
// step's card or any handle, so every one stays whole and clickable, and the row sits nearer its own
// step than any other, so it never reads as another step's buttons. Every step of the default map
// and of each shipped blueprint (whose branches put one card under another), at three widths.
export async function checkStepAddClear(browser, { base, seed }) {
  const f = [];
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/defaultBlueprint.ts')).href);
  const { ECOM_BLUEPRINTS } = await import(pathToFileURL(path.join(ROOT, 'src/data/ecomBlueprints.ts')).href);
  const home = seed ?? DEFAULT_LEAD_CAPTURE_PROJECT;
  const maps = [{ id: 'default map', seed: home }];
  for (const bp of ECOM_BLUEPRINTS) {
    maps.push({ id: bp.id, seed: { ...structuredClone(home), id: `check-${bp.id}`, name: bp.title, nodes: structuredClone(bp.nodes), edges: structuredClone(bp.edges) } });
  }
  for (const map of maps) {
    for (const width of [1280, 1440, 1920]) {
      const viewport = { width, height: { 1280: 720, 1440: 900, 1920: 1080 }[width] };
      await withApp(browser, { base, viewport, seed: map.seed }, async page => {
        const ids = await page.$$eval('.react-flow__node', ns => ns.map(n => n.dataset.id));
        for (const id of ids) {
          await part(f, `${map.id} ${width}px ${id}`, async () => {
            // A step behind the header, the step panel or off the map cannot be clicked where it is drawn.
            const box = await page.locator(stepSel(id)).boundingBox();
            if (!box || box.y < 110 || box.x < 0 || box.x + box.width > width - 20) return;
            await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 40));
            await page.waitForTimeout(300);
            const hits = await page.evaluate(id => {
              const out = [];
              const rect = e => e.getBoundingClientRect();
              const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
              const gap = (a, b) => Math.hypot(Math.max(0, b.left - a.right, a.left - b.right), Math.max(0, b.top - a.bottom, a.top - b.bottom));
              const adds = [...document.querySelectorAll('[data-step-add] button')];
              if (adds.length === 0) return ['no + Before / + Next'];
              const captions = [...document.querySelectorAll('[data-jv-edge-label], [data-jv-edge-label] .jv-add-next')];
              const cards = [...document.querySelectorAll('.react-flow__node')];
              const own = cards.find(c => c.dataset.id === id);
              const lineOf = el => el.closest('[data-jv-edge-label]')?.dataset.jvEdgeLabel;
              const handleOf = h => `${h.closest('.react-flow__node')?.dataset.id} ${h.dataset.handlepos} handle`;
              for (const a of adds) {
                const r = rect(a);
                const name = `"${a.textContent.trim()}"`;
                for (const c of captions) if (meets(r, rect(c))) out.push(`${name} covers the ${lineOf(c)} caption`);
                for (const c of cards) if (c !== own && meets(r, rect(c))) out.push(`${name} covers the ${c.dataset.id} card`);
                for (const h of document.querySelectorAll('.react-flow__handle')) if (meets(r, rect(h))) out.push(`${name} covers the ${handleOf(h)}`);
                const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                if (r.width && r.top >= 0 && r.bottom <= innerHeight && !a.contains(at)) out.push(`${name} is covered at its centre`);
              }
              // A handle is what a new line is dragged from, so the row must never be what a pointer reaches there.
              for (const h of document.querySelectorAll('.react-flow__handle')) {
                const r = rect(h);
                const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                if (at && adds.some(a => a.contains(at))) out.push(`the ${handleOf(h)} is under ${at.closest('button').textContent.trim()}`);
              }
              const row = { left: Math.min(...adds.map(a => rect(a).left)), right: Math.max(...adds.map(a => rect(a).right)), top: Math.min(...adds.map(a => rect(a).top)), bottom: Math.max(...adds.map(a => rect(a).bottom)) };
              const mine = gap(row, rect(own));
              for (const c of cards) if (c !== own && gap(row, rect(c)) <= mine) out.push(`the row sits nearer the ${c.dataset.id} card than its own`);
              return out;
            }, id);
            for (const h of hits) f.push(`${map.id}, ${width}px, ${id} selected: ${h}`);
            if (hits.length && SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `step-add-${map.id.replace(/\W+/g, '-')}-${width}-${id}.png`) });
          }, page);
        }
      });
    }
  }
  return f;
}

export const CHECKS = {
  stepNames: checkStepNames,
  edgeWords: checkEdgeWords,
  stepRoundTrip: checkStepRoundTrip,
  lineRoundTrip: checkLineRoundTrip,
  mapOrder: checkMapOrder,
  deletionFallback: checkDeletionFallback,
  modalTrap: checkModalTrap,
  headerMenus: checkHeaderMenus,
  stacking: checkStacking,
  focusRings: checkFocusRings,
  minText: checkMinText,
  stepNamesFit: checkStepNamesFit,
  mapCaptions: checkMapCaptions,
  handleTargets: checkHandleTargets,
  headerFits: checkHeaderFits,
  labels: checkLabels,
  ariaPressed: checkAriaPressed,
  reducedMotion: checkReducedMotion,
  buttonNames: checkButtonNames,
  savedData: checkSavedData,
  layout: checkLayout,
  stepAddClear: checkStepAddClear
};

/** Runs the named checks (all by default) and answers { name: findings | { error } }. */
export async function runA11yChecks(browser, options, only = Object.keys(CHECKS)) {
  SHOTS_DIR = options.shots ?? null;
  const results = {};
  for (const name of only) {
    try {
      results[name] = await CHECKS[name](browser, options);
    } catch (err) {
      results[name] = { error: String(err?.message || err).split('\n')[0] };
    }
  }
  return results;
}

// ---- Main ----

/**
 * The preview binds 127.0.0.1 and the checks visit 127.0.0.1, never "localhost". On macOS the
 * AirPlay Receiver holds *:5000 (and *:7000), a bare `vite preview` then bound only [::1], and a
 * visit to localhost reached AirPlay's 403 on 127.0.0.1 while the preview sat unvisited (R09). A
 * specific address takes its connections ahead of a wildcard one, the way check:canvas binds.
 */
export const PREVIEW_HOST = '127.0.0.1';

export function previewCommand(outDir, port) {
  return {
    args: ['vite', 'preview', '--outDir', outDir, '--host', PREVIEW_HOST, '--port', String(port), '--strictPort'],
    base: `http://${PREVIEW_HOST}:${port}`
  };
}

/**
 * One GET of `base` on a NEW connection. fetch() keeps its sockets alive, so a poll that first
 * reached the wildcard holder (AirPlay answers on 127.0.0.1:5000 until the preview binds) kept
 * asking AirPlay on that pooled socket after the preview was up, and every answer stayed 403.
 */
async function probe(base) {
  const u = new URL(base);
  const lib = await import(u.protocol === 'https:' ? 'node:https' : 'node:http');
  return new Promise((resolve, reject) => {
    const req = lib.get(u, { agent: false, timeout: 5000 }, res => {
      res.resume();
      resolve({ status: res.statusCode, server: res.headers.server ?? null });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

/**
 * Polls `base` until it answers 2xx. Answers { ok: true } or { ok: false, reason }, where the
 * reason says what was there instead: another program's HTTP status and Server header, the
 * preview exiting (`exited()` answers its code, or null while it runs), or the last connection
 * error. "Nothing answered" hid an AirPlay 403 for as long as the wait lasted.
 */
export async function waitForServer(base, { ms = 30000, exited = () => null } = {}) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    const code = exited();
    if (code !== null && code !== undefined) return { ok: false, reason: `was never served, because the preview stopped (exit ${code})` };
    try {
      const r = await probe(base);
      if (r.status >= 200 && r.status < 300) return { ok: true };
      last = `answered HTTP ${r.status}${r.server ? ` from "${r.server}"` : ''} instead of the app`;
    } catch (err) {
      last = `did not answer (${err?.code || err?.name || 'no connection'})`;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return { ok: false, reason: last ?? 'did not answer' };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-a11y-'));
  const shots = process.env.A11Y_SHOTS || tmp;
  fs.mkdirSync(shots, { recursive: true });
  const port = Number(process.env.A11Y_PORT || 4731);
  let base = process.env.A11Y_BASE;
  let preview = null;
  let previewExit = null;
  const previewOutput = [];
  const stop = () => {
    if (preview?.pid) {
      try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* already gone */ }
      preview = null;
    }
  };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(2); });

  if (!base) {
    const { spawn, spawnSync } = await import('node:child_process');
    const outDir = path.join(tmp, 'jv-a11y-dist');
    const build = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) { console.error('a11y check: the build failed'); process.exit(2); }
    const cmd = previewCommand(outDir, port);
    // Piped, not ignored, so a port-in-use refusal can be shown when the preview never answers.
    preview = spawn('npx', cmd.args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = chunk => {
      for (const line of String(chunk).replace(/\x1b\[[0-9;]*m/g, '').split('\n')) if (line.trim()) previewOutput.push(line.trimEnd());
      previewOutput.splice(0, Math.max(0, previewOutput.length - 20));
    };
    preview.stdout.on('data', keep);
    preview.stderr.on('data', keep);
    preview.on('exit', (code, signal) => { previewExit = code ?? signal; });
    base = cmd.base;
  }
  const up = await waitForServer(base, { exited: () => previewExit });
  if (!up.ok) {
    const fix = process.env.A11Y_BASE ? 'check A11Y_BASE' : 'set A11Y_PORT to a free port';
    console.error(`a11y check: ${base} ${up.reason}, so the checks cannot run; ${fix}.`);
    if (previewOutput.length) console.error(`vite preview said:\n${previewOutput.map(l => `  ${l}`).join('\n')}`);
    process.exit(2);
  }

  const { chromium } = await import(pathToFileURL(path.resolve(ROOT, '../../node_modules/playwright/index.mjs')).href);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/defaultBlueprint.ts')).href);
  const only = process.env.A11Y_ONLY ? process.env.A11Y_ONLY.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const unknown = (only ?? []).filter(n => !CHECKS[n]);
  if (unknown.length) { console.error(`a11y check: unknown check ${unknown.join(', ')}`); await browser.close(); process.exit(2); }

  const results = await runA11yChecks(browser, { base, shots, seed: DEFAULT_LEAD_CAPTURE_PROJECT }, only);
  await browser.close();

  let findings = 0;
  let errors = 0;
  for (const [name, result] of Object.entries(results)) {
    if (!Array.isArray(result)) { errors++; console.log(`ERROR ${name}: ${result.error}`); continue; }
    findings += result.length;
    console.log(`${result.length ? 'FAIL' : 'PASS'} ${name}${result.length ? ` (${result.length})` : ''}`);
    for (const line of result.slice(0, 40)) console.log(`  - ${line}`);
    if (result.length > 40) console.log(`  ... and ${result.length - 40} more`);
  }
  console.log(`screenshots: ${shots}`);
  stop();
  process.exit(errors && !findings ? 2 : findings || errors ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => {
    console.error(err);
    process.exit(2);
  });
}
