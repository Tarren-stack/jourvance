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
//   Wave 2 polish, on the document the close step stored (the builder is opened again):
//   reopen              the builder opens on the stored document
//   desktop-scale       at 1440 the desktop page root is 1280 CSS px wide inside the shadow root
//                       (scaled to fit the frame), the selection outline sits within 2px of the node it
//                       selects (a section and a block in a column), tablet is 1024 scaled, mobile 390
//   narrow-window       a 390px window with Desktop chosen: in each of the Blocks, Page and Settings
//                       views no control sticks out past either edge, with a block selected too
//   contrast-and-names  every text is 4.5 to 1 against what is really behind it (the palette, the
//                       outline, the inspector's three tabs, a refusal, the editor's hints on a white
//                       page) and every control has an accessible name
//   focus-and-announcements  every Tab stop (45) is inside the builder and shows the 2px focus ring; a
//                       refused move and a keyboard move are said in the status region
//   theme               the main colour changes the canvas button's background and the stored theme
//   list-field          an icon list gets two points: stored, and drawn as two items
//   colour-field        a custom background colour: stored, and drawn
//   date-field          a countdown to a date: the stored ISO date with its offset, and drawn
//   hide-on             hide on mobile: gone from the canvas at 390, present on desktop, outline says so
//   grip-drag           a pointer drag from the canvas grip moves a block into another column
//   outline-keyboard    Space, ArrowDown, Space on an outline row moves a block, announced
//   palette-between-sections  a palette widget dropped between two sections gets a section of its own
//   inline-escape       Escape in an inline edit keeps the text; Control Z takes it back
//   Wave 3, on the document the steps above leave:
//   templates           the Templates view draws every template's thumbnail (a shadow root holding
//                       #jvb-root); Use this template asks first (the page has content), then the
//                       canvas and the stored document hold the template's sections; Undo brings the
//                       page back
//   saved-section       Save section on a section's toolbar, a name, Save: the honest durable:false
//                       note is shown and said; the Saved group lists it; adding it puts a copy with
//                       fresh ids right after the section holding the selection
//   clipboard           Copy on the toolbar then Control V pastes a heading with fresh ids into the
//                       same column; Control X cuts it; Paste on the toolbar brings it back with
//                       another fresh id; the canvas follows each step
//   global-style        Space between sections 40: the canvas page root's computed row gap is 40px
//                       and the stored theme holds it
//   history             a seeded revision is listed; Restore puts its sections on the canvas and in
//                       the stored document; Undo brings the previous page back
//   ai-rewrite-off      Rewrite with AI on a heading, when the route answers 503: the route's own
//                       sentence is shown verbatim and said, and the heading is unchanged
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
// Wave 3 routes are answered AT THE ROUTE GUARD with recorded JSON, in the exact shapes the real
// routes send (server/routes/builderLibraryRoutes.mjs, the builder-revisions routes in
// server/routes/journeyRoutes.mjs, POST /api/ai/builder-rewrite in server/routes/aiJourneyRoutes.mjs):
// nothing reaches a server. The library keeps what this run saves in memory and answers a save with
// durable:false and the reason the real route gives when HUB_API_KEY is not set; the revisions list
// holds one seeded revision; the rewrite answers the route's 503 "AI copy is off" body.
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
import { TEMPLATES, buildTemplate } from '../src/lib/pageBuilder/templates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_KEY = 'jourvance_active_project';
const PAGE_NODE = 'node-page-1';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HEADING_TEXT = 'Builder check heading';
/** Longer than the builder's 1.5 s autosave, so a change it would have written has been. */
const AUTOSAVE_WAIT = 1800;

// ---- Recorded answers for the Wave 3 routes (see the header) ----

/** The sentence the real library route carries when the hub key is not set (server.mjs putLibraryItem). */
const LIBRARY_NOT_DURABLE = 'HUB_API_KEY is not set on this server.';
/** The rewrite route's 503 body when AI copy is off (aiJourneyRoutes.mjs REWRITE_OFF). */
const REWRITE_OFF_BODY = { success: false, error: 'AI copy is off until the hub key is set.', reason: 'ai-unavailable', retryable: false };
/** What the control shows for that answer instead (builderRewriteClient.ts REWRITE_UNAVAILABLE). */
const REWRITE_UNAVAILABLE = 'Writing with AI is not available right now. Your text is unchanged, and you can still edit it yourself.';
const TEMPLATE_ID = 'product-drop';
const SEEDED_REV = 7;
const SEEDED_DOC = buildTemplate('review-wall');
const SEEDED_SUMMARY = { rev: SEEDED_REV, nodeId: PAGE_NODE, publishedAt: '2026-10-01T12:00:00.000Z', fingerprint: 'check-fingerprint', userId: 'check-user', hasB: false };

/** Answers a Wave 3 route with recorded JSON, or returns false for anything else. */
function wave3Answer(req, u, library, seen) {
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = u.pathname;
  if (p === '/api/builder/library' && req.method() === 'GET') {
    seen.push('GET library');
    return json(200, { success: true, items: library, complete: true });
  }
  if (p === '/api/builder/library' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    const item = { id: `sec_check${library.length + 1}`, userId: 'check-user', name: String(body.name || '').trim(), section: body.section, createdAt: new Date().toISOString() };
    library.unshift(item);
    seen.push(`POST library ${item.name}`);
    return json(200, { success: true, item, durable: false, reason: LIBRARY_NOT_DURABLE });
  }
  const list = /^\/api\/journey\/[^/]+\/builder-revisions$/.test(p);
  const one = /^\/api\/journey\/[^/]+\/builder-revisions\/(\d+)$/.exec(p);
  if ((list || one) && req.method() === 'GET') {
    seen.push(`GET ${p}?${u.searchParams.toString()}`);
    if (u.searchParams.get('nodeId') !== PAGE_NODE) return json(400, { success: false, error: 'nodeId is required.' });
    if (list) return json(200, { success: true, revisions: [SEEDED_SUMMARY] });
    if (Number(one[1]) !== SEEDED_REV) return json(404, { success: false, error: 'That revision was not found.' });
    return json(200, { success: true, revision: { ...SEEDED_SUMMARY, hasB: undefined, document: SEEDED_DOC } });
  }
  if (p === '/api/ai/builder-rewrite' && req.method() === 'POST') {
    seen.push(`POST rewrite ${req.postData()}`);
    return json(503, REWRITE_OFF_BODY);
  }
  return false;
}

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


// ---- More facts read in the page (Wave 2 polish) ----

/** Runs `code` (a function body taking `root`, the canvas's shadow root, and `a`) in the page. */
const inShadow = (page, code, arg) => page.evaluate(([src, a]) => {
  const host = document.querySelector('dialog[open] [data-jvb-canvas-host]');
  const root = host && host.shadowRoot;
  if (!root) return null;
  return new Function('root', 'a', src)(root, a);
}, [code, arg]);

/** How far the selection outline's box is from the selected node's own box, in CSS pixels. */
const outlineGap = (page, id) => page.evaluate(nodeId => {
  const host = document.querySelector('dialog[open] [data-jvb-canvas-host]');
  const root = host && host.shadowRoot;
  const el = root && root.querySelector(`.jvb-n-${nodeId}`);
  const mark = document.querySelector(`dialog[open] [data-selection-outline="${nodeId}"]`);
  if (!el || !mark) return null;
  const a = el.getBoundingClientRect();
  const b = mark.getBoundingClientRect();
  return { dx: Math.abs(a.left - b.left), dy: Math.abs(a.top - b.top), dw: Math.abs(a.width - b.width), dh: Math.abs(a.height - b.height), width: a.width };
}, id);

/** The page root's laid-out width (what the page sees as its own width) and the frame's scale and box. */
const pageWidths = page => page.evaluate(() => {
  const host = document.querySelector('dialog[open] [data-jvb-canvas-host]');
  const root = host && host.shadowRoot && host.shadowRoot.querySelector('#jvb-root');
  const frame = document.querySelector('dialog[open] [data-canvas-frame]');
  if (!root || !frame) return null;
  const r = frame.getBoundingClientRect();
  return { root: root.offsetWidth, scale: Number(frame.getAttribute('data-canvas-scale')), frame: r.width, frameRight: r.right };
});

/** Every control in the builder (not the page it draws) that sticks out past either edge of the window. */
const controlsPastEdge = page => page.evaluate(() => {
  const w = window.innerWidth;
  const dlg = document.querySelector('dialog[open]');
  const bad = [];
  const sel = 'button, input, select, textarea, summary, a[href], [role="treeitem"], [role="radio"], [role="tab"], [role="toolbar"]';
  let seen = 0;
  for (const el of dlg.querySelectorAll(sel)) {
    if (el.closest('[data-jvb-canvas-host]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    seen++;
    if (r.left < -0.5 || r.right > w + 0.5) {
      bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
  }
  return { bad, seen, width: w, pageScroll: document.documentElement.scrollWidth, dialogScroll: dlg.scrollWidth, dialogClient: dlg.clientWidth };
});


/**
 * The text in the builder (and the editor's own hints inside the canvas) whose colour against what is
 * REALLY behind it, every translucent layer composited, is under 4.5 to 1. Inactive controls are exempt
 * (WCAG 1.4.3) and so is the merchant's own page. `seen` counts the texts measured, so a clean answer
 * from a scan that found nothing cannot pass.
 */
const lowContrast = page => page.evaluate(() => {
  const dlg = document.querySelector('dialog[open]');
  const parse = c => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(c);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = el => {
    const layers = [];
    for (let n = el; n; n = n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null)) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
    }
    let base = { r: 11, g: 15, b: 25, a: 1 };
    if (layers.length && layers[layers.length - 1].a === 1) base = layers.pop();
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const inactive = el => !!el.closest('[disabled], [aria-disabled="true"], .jv-sr-only, [hidden]');
  const bad = [];
  let seen = 0;
  const visit = (el, inShadow) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || inactive(el)) return;
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const field = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'color';
    if ((own || field) && r.width > 0 && r.height > 0) {
      let fg = parse(cs.color);
      const bg = backdrop(el);
      if (fg) {
        fg = over(fg, bg);
        seen++;
        const k = ratio(fg, bg);
        if (k < 4.5) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.value || '').trim().slice(0, 28)}" ${k.toFixed(2)}`);
      }
    }
  };
  for (const el of dlg.querySelectorAll('*')) {
    if (el.matches('[data-jvb-canvas-host]')) {
      const root = el.shadowRoot;
      if (root) for (const hint of root.querySelectorAll('.jvbe-empty')) visit(hint, true);
      continue;
    }
    if (el.closest('[data-jvb-canvas-host]')) continue;
    visit(el, false);
  }
  return { bad: [...new Set(bad)], seen };
});


/** Controls in the builder with no accessible name: no aria-label, aria-labelledby, label, text or title. */
const unnamedControls = page => page.evaluate(() => {
  const dlg = document.querySelector('dialog[open]');
  const bad = [];
  let seen = 0;
  for (const el of dlg.querySelectorAll('button, input, select, textarea, summary, [role="treeitem"], [role="tab"], [role="radio"], [role="textbox"]')) {
    if (el.closest('[data-jvb-canvas-host]') || el.type === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    seen++;
    const byId = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join('').trim();
    const label = el.labels && el.labels.length ? [...el.labels].map(l => l.textContent).join('').trim() : '';
    const text = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? '' : (el.textContent || '').trim();
    const name = (el.getAttribute('aria-label') || '').trim() || byId || label || text || (el.getAttribute('title') || '').trim();
    if (!name) bad.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} at ${Math.round(r.left)},${Math.round(r.top)}`);
  }
  return { bad, seen };
});

const selectedRowId = page => page.evaluate(() => {
  const row = document.querySelector('dialog[open] [role="treeitem"][aria-selected="true"]');
  return row ? row.getAttribute('data-node-id') : null;
});

const liveText = page => page.evaluate(() => (document.querySelector('dialog[open] .jv-sr-only[aria-live]')?.textContent || '').trim());
/** What the drag library's own live region last said (it keeps its own, apart from the shell's). */
const dragText = page => page.evaluate(() => (document.querySelector('dialog[open] [id^="DndLiveRegion"]')?.textContent || '').trim());

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
  const library = [];
  const answered = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => {
    const req = route.request();
    if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
    try {
      const u = new URL(req.url());
      if (req.method() === 'GET' && u.origin === origin && /^\/api\/journey\/[^/]+$/.test(u.pathname)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, journey: null }) });
      }
      if (u.origin === origin) {
        const answer = wave3Answer(req, u, library, answered);
        if (answer) return route.fulfill(answer);
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


  // ---- Wave 2 polish: what the first check never drove. The builder is reopened on the document the
  // close step stored, and every step below asserts on the stored document AND on what the canvas draws.

  /** Waits for the autosave to put a document into this browser's journey that satisfies `test`. */
  const storedWhere = async (test, message) => {
    const doc = await waitUntil(async () => {
      const b = await storedBuilder(page);
      return b && test(b) ? b : null;
    }, 9000, 200);
    expect(doc, message);
    return doc;
  };
  const row = id => page.locator(`dialog[open] [role="treeitem"][data-node-id="${id}"]`);
  const device = name => dialog.getByRole('radiogroup', { name: 'Editing for' }).getByRole('radio', { name });
  const palette = label => page.locator(`dialog[open] button[data-palette-item="${label}"]`);
  const addFromPalette = async label => {
    const before = await selectedRowId(page);
    await palette(label).scrollIntoViewIfNeeded();
    await palette(label).click();
    const id = await waitUntil(async () => {
      const now = await selectedRowId(page);
      return now && now !== before ? now : null;
    }, 3000);
    expect(id, `adding "${label}" did not select the new block`);
    return id;
  };

  await go('reopen', async () => {
    await page.getByRole('button', { name: 'Open page builder' }).click();
    await dialog.waitFor({ state: 'visible' });
    const facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-media', 'legacy-offer');
      return f && f.sections.length ? f : null;
    }, 5000);
    expect(facts && facts.sections.join() === 'legacy-offer,legacy-reviews', 'the canvas did not redraw the stored document');
    return 'reopened on the stored document';
  });

  await go('desktop-scale', async () => {
    const out = [];
    // Desktop is drawn at 1280 and scaled down into the frame; the page lays out as a desktop page.
    const d = await waitUntil(async () => {
      const w = await pageWidths(page);
      return w && w.root === 1280 ? w : null;
    }, 3000);
    expect(d, `the desktop page root is ${JSON.stringify(await pageWidths(page))} wide, not 1280`);
    expect(d.scale < 1 && Math.abs(d.frame - 1280 * d.scale) < 1.5, `the frame is ${d.frame}px at scale ${d.scale}`);
    out.push(`desktop root ${d.root}px at scale ${d.scale} (frame ${Math.round(d.frame)}px)`);
    // The selection outline sits on the node it selects, for a section and for a block inside a column.
    for (const id of ['legacy-offer', 'legacy-checkout']) {
      await row(id).click();
      const gap = await waitUntil(async () => {
        const g = await outlineGap(page, id);
        return g && g.width > 0 ? g : null;
      }, 3000);
      expect(gap, `no selection outline for ${id}`);
      const worst = Math.max(gap.dx, gap.dy, gap.dw, gap.dh);
      expect(worst <= 2, `the outline on ${id} is ${worst.toFixed(1)}px off its node (${JSON.stringify(gap)})`);
      out.push(`outline on ${id} within ${worst.toFixed(2)}px`);
    }
    await shot('8-desktop-scaled-selected');
    // Tablet is scaled the same way, mobile is not.
    await device('Tablet').click();
    const t = await waitUntil(async () => { const w = await pageWidths(page); return w && w.root === 1024 ? w : null; }, 3000);
    expect(t && t.scale < 1, `the tablet page root is ${JSON.stringify(await pageWidths(page))}`);
    await device('Mobile').click();
    const m = await waitUntil(async () => { const w = await pageWidths(page); return w && w.root === 390 ? w : null; }, 3000);
    expect(m && m.scale === 1, `the mobile page is ${JSON.stringify(await pageWidths(page))}, not 390 at scale 1`);
    await device('Desktop').click();
    out.push(`tablet root ${t.root}px at scale ${t.scale}`, 'mobile root 390px at scale 1');
    return out.join('; ');
  });

  await go('narrow-window', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await row('legacy-checkout').scrollIntoViewIfNeeded().catch(() => {});
    const out = [];
    for (const [view, name] of [['blocks', 'Blocks'], ['canvas', 'Page'], ['settings', 'Settings']]) {
      await dialog.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(250);
      if (view === 'canvas') {
        const w = await pageWidths(page);
        expect(w && w.root === 1280 && w.scale < 0.3 && w.frameRight <= 390 + 0.5, `at 390px the desktop page is ${JSON.stringify(w)}`);
        out.push(`canvas: desktop root ${w.root}px at scale ${w.scale}, frame ends at ${Math.round(w.frameRight)}`);
        // A selected block's toolbar stays inside the window too.
        await row('legacy-checkout').count();
      }
      const f = await controlsPastEdge(page);
      expect(f.bad.length === 0, `${view}: ${f.bad.length} control(s) past the edge: ${f.bad.slice(0, 4).join(' | ')}`);
      expect(f.pageScroll <= f.width && f.dialogScroll <= f.dialogClient, `${view}: the window scrolls sideways (${f.pageScroll} > ${f.width}, dialog ${f.dialogScroll} > ${f.dialogClient})`);
      expect(f.seen >= 8, `${view}: the scan saw only ${f.seen} controls, so it proves nothing`);
      out.push(`${view}: ${f.seen} controls, none past either edge`);
    }
    // With a block selected in the page view (the toolbar is drawn).
    await dialog.getByRole('button', { name: 'Blocks', exact: true }).click();
    await row('legacy-checkout').click();
    await dialog.getByRole('button', { name: 'Page', exact: true }).click();
    await page.waitForTimeout(300);
    const withToolbar = await controlsPastEdge(page);
    const tools = await page.locator('dialog[open] [role="toolbar"]').count();
    expect(tools === 1, `no selection toolbar is drawn (${tools})`);
    expect(withToolbar.bad.length === 0, `with a block selected: ${withToolbar.bad.join(' | ')}`);
    out.push('page with a selection and its toolbar: none past the edge');
    await shot('9-narrow-window');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    return out.join('; ');
  });


  await go('contrast-and-names', async () => {
    const out = [];
    const scan = async name => {
      const f = await lowContrast(page);
      expect(f.seen >= 6, `${name}: only ${f.seen} texts were measured`);
      expect(f.bad.length === 0, `${name}: text under 4.5 to 1: ${f.bad.slice(0, 6).join(' | ')}`);
      const n = await unnamedControls(page);
      expect(n.seen >= 8, `${name}: only ${n.seen} controls were checked for a name`);
      expect(n.bad.length === 0, `${name}: controls with no accessible name: ${n.bad.slice(0, 6).join(' | ')}`);
      out.push(`${name} ${f.seen}/${n.seen}`);
    };
    // The page theme (nothing selected), the palette and the outline beside it.
    await row('legacy-offer').click();
    await row('legacy-offer').focus();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open] #jvb-theme-title').waitFor({ state: 'visible' });
    await scan('theme panel with palette and outline');
    // A section and a widget, on each inspector tab (Style with every group open).
    for (const id of ['legacy-offer', 'legacy-checkout']) {
      await row(id).click();
      for (const tab of ['Content', 'Style', 'Advanced']) {
        const t = inspector.getByRole('tab', { name: tab });
        if (!(await t.count())) continue;
        await t.click();
        if (tab === 'Style') {
          await page.evaluate(() => document.querySelectorAll('dialog[open] [data-builder-inspector] details').forEach(d => { d.open = true; }));
        }
        await scan(`${id} ${tab}`);
      }
    }
    // The empty-block hints the canvas draws, and a refusal notice.
    await row('legacy-offer').click();
    await inspector.getByRole('tab', { name: 'Style' }).click();
    await inspector.getByLabel('Padding top (px)', { exact: true }).fill('99999');
    await page.waitForTimeout(250);
    const notice = await page.locator('dialog[open] [role="alert"], dialog[open] [role="note"]').count();
    expect(notice >= 1, 'a refused value shows no message');
    await scan('a refusal shown');
    await inspector.getByLabel('Padding top (px)', { exact: true }).fill('36');
    // The editor's empty-block hints sit on the merchant's own page colour: a light page must not
    // wash them out. Measured on a white page, then put back.
    await row('legacy-offer').focus();
    await page.keyboard.press('Escape');
    const bg = inspector.getByLabel('Page background', { exact: true });
    await bg.waitFor({ state: 'visible', timeout: 3000 });
    const original = await bg.inputValue();
    await bg.fill('#ffffff');
    await page.waitForTimeout(300);
    const hints = await inShadow(page, "return root.querySelectorAll('.jvbe-empty').length;");
    expect(hints >= 1, 'no empty-block hint is on the canvas to measure');
    await scan(`empty-block hints on a white page (${hints})`);
    await bg.fill(original);
    return out.join('; ');
  });


  await go('focus-and-announcements', async () => {
    const out = [];
    // Every Tab stop in the builder shows the cockpit's focus ring (index.css :focus-visible: 2px solid
    // var(--color-focus)), with a block selected so the inspector and the toolbar are in the walk.
    await row('legacy-checkout').click();
    await inspector.getByRole('tab', { name: 'Content' }).click();
    await page.evaluate(() => document.querySelector('dialog[open] [data-dialog-start]').focus());
    const stops = [];
    for (let i = 0; i < 220; i++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate(() => {
        const el = document.activeElement;
        const dlg = document.querySelector('dialog[open]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const again = el.hasAttribute('data-tabseen');
        el.setAttribute('data-tabseen', '');
        return {
          again,
          inside: !!dlg && dlg.contains(el),
          start: el.hasAttribute('data-dialog-start'),
          name: (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30),
          style: cs.outlineStyle,
          width: parseFloat(cs.outlineWidth),
          color: cs.outlineColor
        };
      });
      expect(at, 'focus left the page');
      if (at.again) break;
      stops.push(at);
    }
    await page.evaluate(() => document.querySelectorAll('[data-tabseen]').forEach(e => e.removeAttribute('data-tabseen')));
    expect(stops.length < 200, 'Tab never came back round to the first stop');
    expect(stops.length >= 40, `only ${stops.length} tab stops were reached`);
    expect(stops.every(x => x.inside), `Tab left the builder at ${JSON.stringify(stops.find(x => !x.inside))}`);
    const flat = stops.filter(x => x.style === 'none' || !(x.width >= 2));
    expect(flat.length === 0, `${flat.length} tab stop(s) show no 2px focus ring: ${flat.slice(0, 4).map(x => `${x.name} (${x.style} ${x.width}px)`).join(' | ')}`);
    out.push(`${stops.length} tab stops, every one inside the builder with a 2px ${stops[0].color} ring`);
    // A refusal is said in the status region as well as shown: the first block has nowhere to move up to.
    await row('legacy-headline').click();
    await page.locator('dialog[open] [role="toolbar"]').getByRole('button', { name: 'Move up' }).click();
    const said = await waitUntil(async () => { const t = await liveText(page); return /already first|nowhere/i.test(t) ? t : null; }, 3000);
    expect(said, `a refused move was not said in the status region (it holds "${await liveText(page)}")`);
    const shown = await page.locator('dialog[open] [role="note"]').innerText();
    expect(/already first|nowhere/i.test(shown), `the notice reads "${shown}"`);
    out.push(`refusal said as "${said}" and shown`);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    // A keyboard move is announced too.
    await row('legacy-checkout').click();
    await row('legacy-checkout').focus();
    await page.keyboard.press('Alt+ArrowUp');
    const moved = await waitUntil(async () => { const t = await liveText(page); return /moved/i.test(t) ? t : null; }, 3000);
    expect(moved, `a keyboard move was not said (the region holds "${await liveText(page)}")`);
    await page.keyboard.press('Control+z');
    out.push(`move said as "${moved}"`);
    return out.join('; ');
  });

  await go('theme', async () => {
    // Nothing selected: the inspector is the page theme. Escape clears the selection.
    await row('legacy-offer').click();
    await row('legacy-offer').focus();
    await page.keyboard.press('Escape');
    const panel = page.locator('dialog[open] #jvb-theme-title');
    await panel.waitFor({ state: 'visible', timeout: 3000 });
    const colour = () => inShadow(page, "const b = root.querySelector('.jvb-n-legacy-checkout button, button.jvb-btn, #jvb-root button'); return b ? getComputedStyle(b).backgroundColor : null;");
    const before = await colour();
    expect(before, 'the canvas draws no button to read');
    await inspector.getByLabel('Main colour (buttons and links)', { exact: true }).fill('#0ea5e9');
    const after = await waitUntil(async () => { const c = await colour(); return c && c !== before ? c : null; }, 3000);
    expect(after === 'rgb(14, 165, 233)', `the canvas button is ${after} (was ${before}), not rgb(14, 165, 233)`);
    const doc = await storedWhere(b => b.theme && b.theme.colors && b.theme.colors.primary === '#0ea5e9', 'the stored document never held the new main colour');
    await shot('10-theme');
    return `main colour #0ea5e9: stored theme.colors.primary ${doc.theme.colors.primary}; canvas button ${before} -> ${after}`;
  });

  let listId = null;
  await go('list-field', async () => {
    listId = await addFromPalette('Icon list');
    await inspector.getByRole('tab', { name: 'Content' }).click();
    const add = inspector.getByRole('button', { name: 'Add point' });
    await add.click();
    await inspector.getByLabel('Point 1', { exact: true }).fill('Free shipping');
    await add.click();
    await inspector.getByLabel('Point 2', { exact: true }).fill('Easy returns');
    const drawn = await waitUntil(async () => {
      const f = await inShadow(page, "const w = root.querySelector('.jvb-n-' + a); return w ? [...w.querySelectorAll('li > span:last-child')].map(li => li.textContent.trim()) : null;", listId);
      return f && f.join() === 'Free shipping,Easy returns' ? f : null;
    }, 3000);
    expect(drawn, `the canvas does not draw the two points: ${JSON.stringify(await inShadow(page, "const w = root.querySelector('.jvb-n-' + a); return w ? w.outerHTML.slice(0, 400) : 'no node';", listId))}`);
    const doc = await storedWhere(b => { const n = findIn(b, listId); return n && n.props && Array.isArray(n.props.items) && n.props.items.map(i => i.text).join() === 'Free shipping,Easy returns'; }, 'the stored document does not hold the two points');
    return `stored ${findIn(doc, listId).props.items.length} points; canvas draws ${drawn.join(' and ')}`;
  });

  await go('colour-field', async () => {
    await inspector.getByRole('tab', { name: 'Style' }).click();
    await inspector.getByText('Background', { exact: true }).click();
    await inspector.getByLabel('Background colour', { exact: true }).selectOption('custom');
    await inspector.getByLabel('Background colour, colour code', { exact: true }).fill('#123456');
    const drawn = await waitUntil(async () => {
      const c = await inShadow(page, "const w = root.querySelector('.jvb-n-' + a); return w ? getComputedStyle(w).backgroundColor : null;", listId);
      return c === 'rgb(18, 52, 86)' ? c : null;
    }, 3000);
    expect(drawn, 'the canvas does not draw the new background');
    const doc = await storedWhere(b => { const n = findIn(b, listId); return n && n.style && n.style.desktop && n.style.desktop.backgroundColor === '#123456'; }, 'the stored document does not hold the colour');
    return `stored style.desktop.backgroundColor ${findIn(doc, listId).style.desktop.backgroundColor}; canvas draws ${drawn}`;
  });

  let clockId = null;
  await go('date-field', async () => {
    clockId = await addFromPalette('Countdown');
    await inspector.getByRole('tab', { name: 'Content' }).click();
    await inspector.getByLabel('Counts down', { exact: true }).selectOption('deadline');
    await inspector.getByLabel('Ends at', { exact: true }).fill('2031-05-17T09:30');
    const drawn = await waitUntil(async () => {
      const d = await inShadow(page, "const w = root.querySelector('.jvb-n-' + a); return w && !w.hasAttribute('data-jvbe-empty-hint') ? w.getAttribute('data-jvb-deadline') : null;", clockId);
      return d && d.startsWith('2031-05-17T09:30:00') ? d : null;
    }, 3000);
    expect(drawn, 'the canvas does not draw a countdown to the date');
    const doc = await storedWhere(b => { const n = findIn(b, clockId); return n && n.props && typeof n.props.deadline === 'string' && n.props.deadline.startsWith('2031-05-17T09:30:00') && n.props.mode === 'deadline'; }, 'the stored document does not hold the deadline');
    const stored = findIn(doc, clockId).props.deadline;
    expect(Date.parse(stored) === new Date('2031-05-17T09:30').getTime(), `the stored deadline ${stored} is not 09:30 in this browser's own time zone`);
    return `stored mode deadline and ${stored}; canvas data-jvb-deadline ${drawn}`;
  });

  await go('hide-on', async () => {
    await inspector.getByRole('tab', { name: 'Advanced' }).click();
    await inspector.getByLabel('Hide on mobile', { exact: true }).check();
    const doc = await storedWhere(b => { const n = findIn(b, clockId); return n && n.style && n.style.mobile && n.style.mobile.hidden === true; }, 'the stored document does not hide the countdown on mobile');
    expect(!(findIn(doc, clockId).style.desktop || {}).hidden, 'the countdown is hidden on desktop too');
    const state = id => inShadow(page, "const w = root.querySelector('.jvb-n-' + a); if (!w) return 'absent'; const r = w.getBoundingClientRect(); return getComputedStyle(w).display === 'none' || (!r.width && !r.height) ? 'hidden' : 'shown';", id);
    expect(await state(clockId) === 'shown', `on desktop the countdown is ${await state(clockId)}`);
    await device('Mobile').click();
    const gone = await waitUntil(async () => (await state(clockId)) !== 'shown', 3000);
    expect(gone, 'at 390 the countdown is still on the canvas');
    const label = await row(clockId).getAttribute('aria-label');
    expect(/hidden on this device/.test(label), `the outline row reads "${label}" on mobile`);
    await shot('11-hidden-on-mobile');
    await device('Desktop').click();
    const back = await waitUntil(async () => (await state(clockId)) === 'shown', 3000);
    expect(back, 'on desktop the countdown did not come back');
    return 'stored hidden on mobile only; the canvas drops it at 390 (outline row says hidden) and draws it on desktop';
  });

  await go('grip-drag', async () => {
    await row(listId).click();
    const grip = page.locator(`dialog[open] button[data-place-node="${listId}"]`);
    await grip.waitFor({ state: 'visible', timeout: 3000 });
    const zoneSel = '[data-zone-id="zone:legacy-offer-copy:0"]';
    await pointerDrag(page, grip, async () => {
      const z = await waitUntil(() => page.$(zoneSel), 3000);
      if (!z) return null;
      const b = await z.boundingBox();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    });
    const facts = await waitUntil(async () => {
      const f = await canvasFacts(page, 'legacy-offer-copy', 'legacy-offer');
      return f && f.kids && f.kids[0] && f.kids[0].cls.includes(`jvb-n-${listId}`) ? f : null;
    }, 3000);
    expect(facts, `the canvas does not draw the icon list first in the second column (the drag region says "${await dragText(page)}", the status region "${await liveText(page)}")`);
    const doc = await storedWhere(b => { const c = findIn(b, 'legacy-offer-copy'); return c && c.children[0] && c.children[0].id === listId; }, 'the stored document does not hold the list in the second column');
    const old = findIn(doc, 'legacy-reviews-col');
    const reviewsHolds = (doc.sections.find(x => x.id === 'legacy-reviews')?.children || []).some(c => (c.children || []).some(w => w.id === listId));
    expect(!reviewsHolds, 'the list is still in the Reviews section too');
    return `canvas grip dragged the icon list into Column 2 of Offer: stored order ${findIn(doc, 'legacy-offer-copy').children.map(c => c.id).join(', ')}`;
  });

  await go('outline-keyboard', async () => {
    const order = async () => (await canvasFacts(page, 'legacy-offer-copy', 'legacy-offer')).kids.map(k => (k.cls.match(/jvb-n-([A-Za-z0-9_-]+)/) || [])[1]);
    const before = await order();
    expect(before[0] === listId && before.length >= 2, `before the keyboard drag the column reads ${before.join()}`);
    await page.evaluate(() => {
      const panel = document.querySelector('dialog[open] [data-view="blocks"]');
      if (panel) panel.scrollTop = panel.scrollHeight;
    });
    const r = row(listId);
    await r.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    const picked = await dragText(page);
    expect(/^(Picked up|Icon list is over)/.test(picked), `picking up said "${picked}"`);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    const over = await dragText(page);
    expect(/ is over /.test(over) && !/place of Icon list\./.test(over), `moving said "${over}"`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const dropped = await dragText(page);
    expect(/dropped on/.test(dropped), `dropping said "${dropped}"`);
    const facts = await waitUntil(async () => { const o = await order(); return o.join() !== before.join() ? o : null; }, 3000);
    expect(facts, `the keyboard drag changed nothing on the canvas (${dropped})`);
    const doc = await storedWhere(b => { const c = findIn(b, 'legacy-offer-copy'); return c && c.children.map(x => x.id).join() === facts.join(); }, 'the stored document does not hold the canvas order');
    expect(facts[0] !== listId && facts.includes(listId), `the list is now ${facts.indexOf(listId)}th in ${facts.join()}`);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-node-id'));
    return `Space, ArrowDown, Space on the outline row: announced "${picked}" / "${over}" / "${dropped}"; column now ${facts.join(', ')}; focus on ${focused}`;
  });

  await go('palette-between-sections', async () => {
    const dividerId = await (async () => {
      const item = palette('Divider');
      await item.scrollIntoViewIfNeeded();
      const zoneSel = '[data-zone-id="zone:page:1"]';
      await pointerDrag(page, item, async () => {
        const z = await waitUntil(() => page.$(zoneSel), 3000);
        if (!z) return null;
        const b = await z.boundingBox();
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
      });
      return waitUntil(() => selectedRowId(page), 3000);
    })();
    const facts = await waitUntil(async () => {
      const f = await inShadow(page, "const secs = [...root.querySelectorAll('#jvb-root > section')]; return secs.map(s => ({ id: ([...s.classList].find(c => c.startsWith('jvb-n-')) || '').slice(6), divider: !!s.querySelector('.jvb-divider') }));");
      return f && f.length === 3 && f[1].divider && !f[0].divider && !f[2].divider ? f : null;
    }, 3000);
    expect(facts, `the canvas sections read ${JSON.stringify(await inShadow(page, "return [...root.querySelectorAll('#jvb-root > section')].map(s => [...s.classList].find(c => c.startsWith('jvb-n-')))"))}`);
    const doc = await storedWhere(b => b.sections.length === 3 && JSON.stringify(b.sections[1]).includes('"divider"') && b.sections[0].id === 'legacy-offer' && b.sections[2].id === 'legacy-reviews', 'the stored document does not hold a new section holding a divider between Offer and Reviews');
    return `dropped between Offer and Reviews: stored ${doc.sections.length} sections, the middle one ${doc.sections[1].id} holding the divider; canvas draws it there`;
  });

  await go('inline-escape', async () => {
    await device('Desktop').click();
    await page.evaluate(() => { const f = document.querySelector('dialog[open] [data-canvas-frame]'); if (f && f.parentElement) f.parentElement.scrollTop = 0; });
    await page.waitForTimeout(150);
    const pos = await inShadow(page, "const h = root.querySelector('.jvb-n-legacy-offer-media h2'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };");
    expect(pos, 'the heading is not on the canvas');
    await page.mouse.dblclick(pos.x, pos.y);
    const editor = await waitUntil(() => inShadow(page, "return !!root.querySelector('[data-jvbe-editing]');"), 3000);
    expect(editor, `double-click at ${JSON.stringify(pos)} did not start editing in place (the live region says "${await liveText(page)}")`);
    await page.keyboard.type('Kept on Escape');
    await page.keyboard.press('Escape');
    const open = await dialog.count();
    expect(open === 1, 'Escape while editing closed the builder');
    const typed = await waitUntil(async () => {
      const t = await inShadow(page, "const h = root.querySelector('.jvb-n-legacy-offer-media h2'); return h && !h.hasAttribute('data-jvbe-editing') ? h.textContent : null;");
      return t === 'Kept on Escape' ? t : null;
    }, 3000);
    expect(typed, 'Escape did not keep the typed text on the canvas');
    const doc = await storedWhere(b => { const m = findIn(b, 'legacy-offer-media'); return m && m.children.some(c => c.props && c.props.text === 'Kept on Escape'); }, 'the stored document does not hold the text kept by Escape');
    // Control Z then takes it back.
    await page.keyboard.press('Control+z');
    const back = await waitUntil(async () => {
      const t = await inShadow(page, "const h = root.querySelector('.jvb-n-legacy-offer-media h2'); return h ? h.textContent : null;");
      return t === HEADING_TEXT ? t : null;
    }, 3000);
    expect(back, 'Control Z did not take the kept edit back');
    return 'double-click, typed, Escape kept it on the canvas and in the stored document, the builder stayed open; Control Z took it back';
  });

  // ---- Wave 3 ----

  const sectionIds = async () => (await canvasFacts(page, 'none', 'none'))?.sections ?? null;
  const toolbarButton = name => page.locator('dialog[open] [role="toolbar"]').getByRole('button', { name, exact: true });
  const leftView = id => page.locator(`dialog[open] [data-left-view="${id}"]`);
  const undoButton = () => dialog.getByRole('button', { name: 'Undo', exact: true });
  const waitSections = async (want, message) => {
    const got = await waitUntil(async () => { const s = await sectionIds(); return s && s.join() === want.join() ? s : null; }, 4000);
    expect(got, `${message}: the canvas sections read ${JSON.stringify(await sectionIds())}, wanted ${JSON.stringify(want)}`);
    return got;
  };
  const allIds = doc => { const out = []; const visit = n => { out.push(n.id); (n.children || []).forEach(visit); }; (doc?.sections || []).forEach(visit); return out; };

  await go('templates', async () => {
    const before = await sectionIds();
    expect(before && before.length, 'the canvas draws no section before a template is used');
    await leftView('templates').click();
    const thumbs = await waitUntil(() => page.evaluate(() => {
      const hosts = [...document.querySelectorAll('dialog[open] [data-template-thumb] > div')];
      const drawn = hosts.filter(h => h.shadowRoot && h.shadowRoot.querySelector('#jvb-root'));
      return drawn.length ? { hosts: hosts.length, drawn: drawn.length } : null;
    }), 4000);
    expect(thumbs && thumbs.drawn === TEMPLATES.length && thumbs.hosts === TEMPLATES.length, `thumbnails drawn: ${JSON.stringify(thumbs)} of ${TEMPLATES.length}`);
    const groups = await page.locator('dialog[open] [aria-labelledby="jvb-templates-title"] h4').allInnerTexts();
    await page.waitForTimeout(200);
    await shot('w3-templates');
    const name = TEMPLATES.find(t => t.id === TEMPLATE_ID).name;
    await page.getByRole('button', { name: `Use this template: ${name}`, exact: true }).click();
    const confirm = page.locator(`dialog[open] [data-template-confirm="${TEMPLATE_ID}"]`);
    await confirm.waitFor({ state: 'visible', timeout: 3000 });
    expect(await sectionIds().then(s => s.join()) === before.join(), 'the page changed before the confirm was pressed');
    await confirm.click();
    const want = buildTemplate(TEMPLATE_ID).sections.length;
    const after = await waitUntil(async () => { const s = await sectionIds(); return s && s.join() !== before.join() && s.length === want ? s : null; }, 4000);
    expect(after, `after Use this template the canvas has ${JSON.stringify(await sectionIds())}, wanted ${want} new sections`);
    const stored = await storedWhere(b => b.sections.length === want && b.sections[0].id === after[0], 'the stored document does not hold the template');
    const said = await waitUntil(async () => { const t = await liveText(page); return /template/i.test(t) ? t : null; }, 3000);
    expect(said, `the replace was not said (the region holds "${await liveText(page)}")`);
    await undoButton().click();
    await waitSections(before, 'Undo after a template');
    await storedWhere(b => b.sections.map(x => x.id).join() === before.join(), 'after Undo the stored document is not the page from before the template');
    await leftView('blocks').click();
    return `${thumbs.drawn} thumbnails in groups ${groups.join(', ')}; ${name} after a confirm: canvas ${after.length} sections, stored ${stored.sections.length}; said "${said}"; Undo brought back ${before.join(', ')}`;
  });

  await go('saved-section', async () => {
    const before = await sectionIds();
    const holder = before[before.length - 1];
    await row(holder).click();
    await toolbarButton('Save section').click();
    const nameField = dialog.getByLabel('Name this saved section', { exact: true });
    await nameField.waitFor({ state: 'visible', timeout: 3000 });
    expect(await nameField.evaluate(el => el === document.activeElement), 'focus did not move to the name field');
    await nameField.fill('Check saved block');
    await dialog.locator('[data-save-section] button[type="submit"]').click();
    const note = await waitUntil(async () => { const n = page.locator('dialog[open] [data-saved-note]'); return (await n.count()) ? n.innerText() : null; }, 4000);
    expect(note && note.includes('not to your account yet') && !note.includes(LIBRARY_NOT_DURABLE), `the save note reads "${note}"`);
    const said = await waitUntil(async () => { const t = await liveText(page); return t.includes('not to your account yet') ? t : null; }, 3000);
    expect(said, `the durable:false note was not said (the region holds "${await liveText(page)}")`);
    expect(library.length === 1 && library[0].section && library[0].section.id === holder, `the library route received ${JSON.stringify(library.map(i => [i.name, i.section && i.section.id]))}`);
    const item = page.locator(`dialog[open] button[data-saved-item="${library[0].id}"]`);
    await item.waitFor({ state: 'visible', timeout: 3000 });
    const savedLabel = await item.getAttribute('aria-label');
    await item.click();
    const after = await waitUntil(async () => { const s = await sectionIds(); return s && s.length === before.length + 1 ? s : null; }, 4000);
    expect(after, `adding the saved section left the canvas at ${JSON.stringify(await sectionIds())}`);
    const added = after[after.length - 1];
    expect(after.indexOf(holder) === after.length - 2 && added !== holder, `the copy is not right after ${holder}: ${after.join(', ')}`);
    const doc = await storedWhere(b => b.sections.length === before.length + 1, 'the stored document does not hold the saved section');
    const copyIds = allIds({ sections: [doc.sections[doc.sections.length - 1]] });
    const original = new Set(allIds({ sections: [library[0].section] }));
    expect(copyIds.length === original.size && copyIds.every(id => !original.has(id)), `the copy shares ids with the saved section: ${copyIds.join(', ')}`);
    await undoButton().click();
    await waitSections(before, 'Undo after adding a saved section');
    await page.locator('dialog[open] [data-saved-note]').getByRole('button', { name: 'Close note' }).click();
    return `saved "${library[0].name}" (note: ${note}); palette "${savedLabel}" added ${added} after ${holder} with ${copyIds.length} fresh ids; Undo took it back`;
  });

  await go('clipboard', async () => {
    const column = 'legacy-offer-media';
    const kids = async () => (await canvasFacts(page, column, 'none'))?.kids?.map(k => (k.cls.match(/jvb-n-([^\s]+)/) || [])[1]).filter(Boolean) ?? [];
    const start = await kids();
    const source = (await storedBuilder(page)) && findIn(await storedBuilder(page), column).children[0].id;
    expect(source && start[0] === source, `the column's first block is ${source}, canvas ${start.join(', ')}`);
    await row(source).click();
    await toolbarButton('Copy').click();
    const copied = await waitUntil(async () => { const t = await liveText(page); return /copied/i.test(t) ? t : null; }, 3000);
    expect(copied, `Copy was not said (the region holds "${await liveText(page)}")`);
    await row(source).focus();
    await page.keyboard.press('Control+v');
    const pasted = await waitUntil(async () => { const id = await selectedRowId(page); return id && id !== source ? id : null; }, 3000);
    expect(pasted, 'Control V did not select a pasted block');
    const known = new Set(allIds(await storedBuilder(page)).filter(id => id !== pasted));
    const afterPaste = await waitUntil(async () => { const k = await kids(); return k.includes(pasted) ? k : null; }, 3000);
    expect(afterPaste && afterPaste.indexOf(pasted) === afterPaste.indexOf(source) + 1, `the paste is not right after ${source}: ${JSON.stringify(await kids())}`);
    await row(pasted).focus();
    await page.keyboard.press('Control+x');
    const cut = await waitUntil(async () => { const k = await kids(); return !k.includes(pasted) ? k : null; }, 3000);
    expect(cut, `Control X left ${pasted} on the canvas`);
    await row(source).click();
    await toolbarButton('Paste').click();
    const again = await waitUntil(async () => { const id = await selectedRowId(page); return id && id !== source && id !== pasted ? id : null; }, 3000);
    expect(again, 'Paste on the toolbar did not select a block with a new id');
    expect(!known.has(again), `the second paste reused an id already on the page: ${again}`);
    const drawn = await waitUntil(async () => { const k = await kids(); return k.includes(again) ? k : null; }, 3000);
    expect(drawn, `the canvas does not draw ${again}`);
    await storedWhere(b => { const c = findIn(b, column); return c && c.children.some(x => x.id === again) && !c.children.some(x => x.id === pasted); }, 'the stored document does not hold the toolbar paste');
    return `copied ${source}; Control V pasted ${pasted} after it; Control X cut it; toolbar Paste made ${again}; canvas column ${drawn.join(', ')}`;
  });

  await go('global-style', async () => {
    await row('legacy-offer').click();
    await row('legacy-offer').focus();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open] #jvb-theme-title').waitFor({ state: 'visible' });
    const gap = () => inShadow(page, "const r = root.querySelector('#jvb-root'); return r ? getComputedStyle(r).rowGap : null;");
    const before = await gap();
    await inspector.getByLabel('Space between sections (px)', { exact: true }).fill('40');
    const after = await waitUntil(async () => { const g = await gap(); return g === '40px' ? g : null; }, 3000);
    expect(after, `the canvas page root's row gap is ${await gap()} (was ${before}), not 40px`);
    const doc = await storedWhere(b => b.theme && b.theme.sectionGap === 40, 'the stored theme does not hold sectionGap 40');
    return `Space between sections 40: canvas #jvb-root row gap ${before} -> ${after}; stored theme.sectionGap ${doc.theme.sectionGap}`;
  });

  await go('history', async () => {
    const before = await sectionIds();
    const where = await page.evaluate(() => location.pathname + location.search);
    await leftView('history').click();
    const restore = page.getByRole('button', { name: `Restore version ${SEEDED_REV}`, exact: true });
    await restore.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    expect(await restore.count(), `no Restore for the seeded revision (address ${where}; routes answered: ${answered.filter(a => /revisions/.test(a)).join(' | ') || 'none'})`);
    await page.waitForTimeout(150);
    await shot('w3-history');
    await restore.click();
    const want = SEEDED_DOC.sections.map(x => x.id);
    await waitSections(want, 'after Restore');
    await storedWhere(b => b.sections.map(x => x.id).join() === want.join(), 'the stored document is not the restored revision');
    const said = await waitUntil(async () => { const t = await liveText(page); return /Restored version/.test(t) ? t : null; }, 3000);
    expect(said, `the restore was not said (the region holds "${await liveText(page)}")`);
    await undoButton().click();
    await waitSections(before, 'Undo after Restore');
    await storedWhere(b => b.sections.map(x => x.id).join() === before.join(), 'after Undo the stored document is not the page from before the restore');
    await leftView('blocks').click();
    return `address ${where}; version ${SEEDED_REV} restored: ${want.length} sections on the canvas and stored; said "${said}"; Undo brought back ${before.join(', ')}`;
  });

  await go('ai-rewrite-off', async () => {
    const id = (await storedBuilder(page)) && findIn(await storedBuilder(page), 'legacy-offer-media').children.find(c => c.type === 'heading')?.id;
    expect(id, 'no heading in the first column to rewrite');
    const text = findIn(await storedBuilder(page), id).props.text;
    await row(id).click();
    await inspector.getByRole('tab', { name: 'Content' }).click();
    await inspector.getByRole('button', { name: 'Rewrite with AI: Heading text', exact: true }).click();
    await inspector.locator('[data-rewrite-run="heading"]').click();
    const shown = await waitUntil(async () => { const m = inspector.locator('[data-rewrite-message]'); return (await m.count()) ? (await m.innerText()).trim() : null; }, 4000);
    expect(shown === REWRITE_UNAVAILABLE, `the control shows "${shown}", not "${REWRITE_UNAVAILABLE}"`);
    const said = await waitUntil(async () => { const t = await liveText(page); return t === REWRITE_UNAVAILABLE ? t : null; }, 3000);
    expect(said, `the refusal was not said (the region holds "${await liveText(page)}")`);
    await page.waitForTimeout(AUTOSAVE_WAIT);
    const now = findIn(await storedBuilder(page), id).props.text;
    expect(now === text, `the heading changed from "${text}" to "${now}"`);
    expect(answered.some(a => a.startsWith('POST rewrite') && a.includes('"kind":"heading"')), 'the rewrite route was never asked');
    return `503 answered: shown and said "${shown}"; the heading still reads "${now}"`;
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
