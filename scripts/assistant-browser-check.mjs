#!/usr/bin/env node
// Ask Jourvance in a real browser. assistant-ui.test.mjs reads the sources; this renders them and
// asserts on the words the browser shows.
//
// Part 1, the REAL app (built, served by vite preview), signed out, at 1440x900 and 390x844 on the
//   public page and on the studio: the bubble and its name, the panel opening with the signed-out
//   line, the Sign In button (it opens the auth dialog), where focus lands, Escape closing it and
//   focus returning to the bubble, aria-expanded flipping, computed z-index 25, the bubble clear of
//   the mobile nav trigger at 390, and no console error. Also that the build put the assistant in
//   its own lazy chunk.
// Part 2, a HARNESS (vite dev server, one virtual page that mounts the same lazy entry with a
//   signed-in user), because the app's sign-in is Firebase and this repo has no test token. The hub
//   is a Playwright route stub answering the five /api/ai/assistant/* routes in the server's real
//   shapes (server/routes/aiAssistantRoutes.mjs), so the rendered strings are the ones a person
//   would read: the suggestion, an answer in the log, Helpful and its one-time line, a 502 and
//   Retry, the hourly limit, the notes outcomes, the clear confirm, the unavailable sentence, and
//   that Backspace typed in the panel never reaches a document key listener (the map's delete).
//   It proves the panel against a STUB of the hub, not against server.mjs and not against Firebase.
//
// Safety: nothing is spawned and server.mjs is never started. Vite's envDir and cacheDir are empty
// temp dirs (no .env, no hub key), every request that is not the page's own origin is aborted, and
// every /api route except the stubbed assistant routes is aborted too. Builds go to a temp dir, which
// is removed on exit; the only things written inside the repo are none. Screenshots go to
// ASSISTANT_SHOTS (default: a temp dir, printed).
//
// Env: CHROME_PATH, PLAYWRIGHT_MODULE, ASSISTANT_SHOTS. Exit 0 every assertion passed, 1 a finding,
// 2 the check could not run.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview, createServer } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const say = line => console.log(line);

// The words the browser must show, read from the panel-copy table so a reworded string fails here.
const COPY = {};
for (const line of fs.readFileSync(path.join(ROOT, 'docs/assistant/panel-copy.md'), 'utf8').split('\n')) {
  const m = line.match(/^\| ([A-Za-z]+\.[A-Za-z]+) \| (.*) \|$/);
  if (m) COPY[m[1]] = m[2];
}

let asserted = 0;
const findings = [];
const shownStrings = [];
function check(name, ok, detail = '') {
  asserted++;
  if (!ok) findings.push(`${name}${detail ? ` (${detail})` : ''}`);
  else say(`  ok   ${name}`);
  if (!ok) say(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
}
function sawText(text) {
  if (!shownStrings.includes(text)) shownStrings.push(text);
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

/** Fresh context and page; everything off-origin and every /api call aborted unless a stub answers it. */
async function openPage(browser, { origin, viewport, path: urlPath, stub = null, scriptedRefusals = () => 0, seed = null }) {
  const context = await browser.newContext({ viewport });
  const blocked = [];
  const consoleErrors = [];
  let scriptedSeen = 0;
  await context.route('**/*', route => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin !== origin) { blocked.push(req.url()); return route.abort(); }
    if (u.pathname.startsWith('/api/ai/assistant/') && stub) return stub(route, req, u);
    if (u.pathname === '/api' || u.pathname.startsWith('/api/') || u.pathname === '/p' || u.pathname.startsWith('/p/')) {
      blocked.push(req.url());
      return route.abort();
    }
    return route.continue();
  });
  if (seed) {
    await context.addInitScript(
      ([key, value]) => {
        // Only on the first load of this context, so a reload reads what the app saved.
        if (sessionStorage.getItem('jv-assistant-seeded')) return;
        sessionStorage.setItem('jv-assistant-seeded', '1');
        localStorage.clear();
        localStorage.setItem(key, value);
      },
      ['jourvance_active_project', JSON.stringify(seed)]
    );
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${String(err?.message || err).split('\n')[0]}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    // A refused request logs "Failed to load resource" at the URL this check itself aborted.
    if (/Failed to load resource/.test(msg.text()) && blocked.includes(msg.location().url)) return;
    // The browser also logs each 4xx or 5xx the stub was scripted to send (the 502 and the 429), and only those.
    if (/Failed to load resource/.test(msg.text()) && msg.location().url.includes('/api/ai/assistant/') && scriptedSeen < scriptedRefusals()) { scriptedSeen++; return; }
    consoleErrors.push(msg.text().split('\n')[0]);
  });
  await page.goto(`${origin}${urlPath}`);
  return { context, page, consoleErrors };
}

const active = page =>
  page.evaluate(() => {
    const a = document.activeElement;
    return {
      isBubble: !!a?.hasAttribute?.('data-assistant-bubble'),
      inPanel: !!a?.closest?.('.jv-assistant-panel'),
      tag: a?.tagName ?? null,
      id: a?.id ?? '',
      text: (a?.textContent || '').trim().slice(0, 40)
    };
  });

/** True when the panel's Close button is the topmost element at its own centre (nothing drawn over it). */
const closeOnTop = page =>
  page.evaluate(() => {
    const b = document.querySelector('.jv-assistant-panel button[aria-label="Close"]');
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { found: true, onTop: !!el && (el === b || b.contains(el)), top: el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : null, y: Math.round(r.y), vh: innerHeight };
  });

const overlap = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

// ---- Part 1: the real app, signed out ----

async function realApp(browser, origin, shots) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const urlPath of ['/', '/canvas']) {
      const tag = `real ${viewport.width}x${viewport.height} ${urlPath}`;
      say(tag);
      const { context, page, consoleErrors } = await openPage(browser, { origin, viewport, path: urlPath });
      try {
        const bubble = page.locator('.jv-assistant-bubble');
        await bubble.waitFor({ state: 'visible', timeout: 20000 });
        check(`${tag}: the bubble is visible`, await bubble.isVisible());
        check(`${tag}: the bubble is named "${COPY['bubble.ariaLabel']}"`, (await bubble.getAttribute('aria-label')) === COPY['bubble.ariaLabel']);
        check(`${tag}: aria-expanded is false while closed`, (await bubble.getAttribute('aria-expanded')) === 'false');
        const panel = page.locator('.jv-assistant-panel');
        check(`${tag}: the panel is hidden while closed`, !(await panel.isVisible()));

        const bubbleBox = await bubble.boundingBox();
        if (viewport.width === 390 && urlPath === '/canvas') {
          const trigger = page.locator('.jv-mobile-nav-trigger');
          await trigger.waitFor({ state: 'visible' });
          const triggerBox = await trigger.boundingBox();
          check(`${tag}: the bubble does not intersect the mobile nav trigger`, !!bubbleBox && !!triggerBox && !overlap(bubbleBox, triggerBox), JSON.stringify({ bubbleBox, triggerBox }));
        }

        await bubble.click();
        await panel.waitFor({ state: 'visible' });
        check(`${tag}: aria-expanded is true once open`, (await bubble.getAttribute('aria-expanded')) === 'true');
        const line = panel.getByText(COPY['signedOut.line'], { exact: true });
        check(`${tag}: the signed-out line is on screen: "${COPY['signedOut.line']}"`, await line.isVisible());
        sawText(COPY['signedOut.line']);
        const signIn = panel.getByRole('button', { name: COPY['signedOut.button'], exact: true });
        check(`${tag}: the "${COPY['signedOut.button']}" button is visible`, await signIn.isVisible());
        await signIn.focus();
        check(`${tag}: the Sign In button takes focus`, (await active(page)).text === COPY['signedOut.button'] && (await active(page)).inPanel);
        sawText(COPY['signedOut.button']);

        // Close and reopen to read where focus lands on open, as a keyboard user gets it.
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        await bubble.waitFor({ state: 'visible' });
        const back = await active(page);
        check(`${tag}: Escape closes the panel and focus returns to the bubble`, back.isBubble, JSON.stringify(back));
        check(`${tag}: aria-expanded is false after Escape`, (await bubble.getAttribute('aria-expanded')) === 'false');

        await bubble.focus();
        await page.keyboard.press('Enter');
        await panel.waitFor({ state: 'visible' });
        await page.waitForTimeout(100);
        const inside = await active(page);
        check(`${tag}: focus is inside the panel on open`, inside.inPanel, JSON.stringify(inside));

        const z = await page.evaluate(() => ({
          panel: getComputedStyle(document.querySelector('.jv-assistant-panel')).zIndex,
          bubble: getComputedStyle(document.querySelector('.jv-assistant-bubble')).zIndex
        }));
        check(`${tag}: the panel's computed z-index is 25`, z.panel === '25', z.panel);
        check(`${tag}: the bubble's computed z-index is 25`, z.bubble === '25', z.bubble);

        check(`${tag}: the bubble has no hover-only title`, (await bubble.getAttribute('title')) === null);
        await page.waitForTimeout(250);
        const geometry = await page.evaluate(() => {
          const r = document.querySelector('.jv-assistant-panel').getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, right: Math.round(r.right), bottom: Math.round(r.bottom) };
        });
        if (viewport.width === 1440) check(`${tag}: the panel is 380px wide`, geometry.w === 380, JSON.stringify(geometry));
        else check(`${tag}: signed out the panel is a full-width sheet, no taller than 70%, resting on the window foot`, geometry.w === geometry.vw && geometry.h <= geometry.vh * 0.7 + 2 && geometry.bottom === geometry.vh, JSON.stringify(geometry));
        if (viewport.width === 390) {
          check(`${tag}: the bubble is hidden while the sheet is open`, !(await bubble.isVisible()));
        }
        if (viewport.width === 1440) check(`${tag}: signed out the card is only as tall as its content`, geometry.h < 220, JSON.stringify(geometry));
        const topCheck = await closeOnTop(page);
        check(`${tag}: Close is the top element at its own centre`, topCheck.found && topCheck.onTop, JSON.stringify(topCheck));
        if (urlPath === '/') {
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(shots, `real-${viewport.width}-open.png`) });
        }

        // The Sign In button hands over to the auth dialog.
        await panel.getByRole('button', { name: COPY['signedOut.button'], exact: true }).click();
        const authHeading = page.getByRole('heading', { name: 'Welcome Back' });
        await authHeading.waitFor({ state: 'visible' });
        check(`${tag}: Sign In opens the auth dialog ("Welcome Back")`, await authHeading.isVisible());
        check(`${tag}: Sign In closed the panel first, so the dialog is not behind it`, !(await panel.isVisible()));
        sawText('Welcome Back');

        check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
      } catch (err) {
        findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
        say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
        await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
}

// Short and narrow screens: Close must be reachable (nothing drawn over it) in the real app.
async function smallScreens(browser, origin, shots) {
  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 568 }]) {
    for (const urlPath of ['/', '/canvas']) {
      const tag = `small ${viewport.width}x${viewport.height} ${urlPath}`;
      say(tag);
      const { context, page, consoleErrors } = await openPage(browser, { origin, viewport, path: urlPath });
      try {
        const bubble = page.locator('.jv-assistant-bubble');
        await bubble.waitFor({ state: 'visible', timeout: 20000 });
        await bubble.click();
        const panel = page.locator('.jv-assistant-panel');
        await panel.waitFor({ state: 'visible' });
        await page.waitForTimeout(250);
        const top = await closeOnTop(page);
        check(`${tag}: Close is the top element at its own centre (nothing drawn over it)`, top.found && top.onTop, JSON.stringify(top));
        const box = await panel.boundingBox();
        check(`${tag}: the panel stays inside the window`, !!box && box.y >= 0 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
        await page.screenshot({ path: path.join(shots, `small-${viewport.width}x${viewport.height}${urlPath === '/' ? '-public' : '-studio'}.png`) });
        await panel.getByRole('button', { name: 'Close', exact: true }).click();
        check(`${tag}: Close closes the panel`, !(await panel.isVisible()));
        check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
      } catch (err) {
        findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
        say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
        await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  }
}

// The panel is off the dialog stack and beside a usable map: a canvas step takes a click while it is
// open, and Escape in a step's own field closes the step, not the panel.
async function withCanvas(browser, origin, seed) {
  const tag = 'canvas with the panel open 1440x900';
  say(tag);
  const { context, page, consoleErrors } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/canvas', seed });
  try {
    await page.waitForSelector('.react-flow__node', { timeout: 20000 });
    await page.waitForTimeout(800);
    const bubble = page.locator('.jv-assistant-bubble');
    const panel = page.locator('.jv-assistant-panel');
    await bubble.click();
    await panel.waitFor({ state: 'visible' });
    const node = page.locator('.react-flow__node[data-id="node-page-1"]');
    await node.click();
    await page.waitForTimeout(300);
    check(`${tag}: a step takes a click while the panel is open, and the panel stays open`, (await panel.isVisible()) && (await page.locator('#jv-step-panel-title').count()) === 1);
    const field = page.locator('#page-headline');
    await field.waitFor({ state: 'visible' });
    await field.focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(`${tag}: Escape in the step's headline field closes the step`, (await page.locator('#jv-step-panel-title').count()) === 0);
    check(`${tag}: and the panel is still open (Escape outside it does not close it)`, await panel.isVisible());
    check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (err) {
    findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
  } finally {
    await context.close();
  }
}

// ---- Part 2: the harness, signed in, hub stubbed ----

const THREAD = { success: true, available: true, messages: [], notes: '', profileOnHub: { durable: false, reason: 'Your notes have not been sent to the assistant’s memory yet.' }, accountBrain: { readable: false } };
const json = (status, body, headers = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

function makeStub(script) {
  const calls = [];
  let refusals = 0;
  const stub = async (route, req, u) => {
    const key = `${req.method()} ${u.pathname}`;
    calls.push({ key, body: req.postData() ? JSON.parse(req.postData()) : null });
    const answer = script(key, calls.filter(c => c.key === key).length, calls[calls.length - 1].body);
    if (answer.status >= 400) refusals++;
    return route.fulfill(answer);
  };
  return { stub, calls, refusals: () => refusals };
}

function harnessPlugin() {
  const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>assistant harness</title></head><body style="margin:0;background:#0B0F19"><main id="page" style="height:100vh"></main><div id="root"></div><script type="module">import 'virtual:assistant-harness';</script></body></html>`;
  const MODULE = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import '/src/index.css';
    import AskJourvance from '/src/components/assistant/AskJourvance.tsx';
    window.__authCalls = 0;
    window.__panelKeysSeenByDocument = 0;
    document.addEventListener('keydown', e => { if (e.target && e.target.closest && e.target.closest('.jv-assistant-panel')) window.__panelKeysSeenByDocument++; });
    const params = new URLSearchParams(location.search);
    const user = params.get('signedOut') ? null : { uid: 'user-1', email: 'owner@example.com' };
    createRoot(document.getElementById('root')).render(
      React.createElement(AskJourvance, { user, onOpenAuth: () => { window.__authCalls++; }, businessType: 'E-Commerce Brand' })
    );
  `;
  return {
    name: 'assistant-harness',
    resolveId(id) { return id === 'virtual:assistant-harness' ? '\0virtual:assistant-harness' : null; },
    load(id) { return id === '\0virtual:assistant-harness' ? MODULE : null; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/__assistant-harness')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, HTML));
      });
    }
  };
}

const answerFor = (id, text) => ({ success: true, source: 'hub-brain', answer: { id, role: 'assistant', text, at: '2026-10-11T10:00:00.000Z', grounding: 'app' } });

async function harness(browser, origin, shots) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const tag = `signed in ${viewport.width}x${viewport.height}`;
    say(tag);
    const ANSWER_ONE = 'Open the journey, then press Publish in the toolbar. Jourvance shows which pages went live.';
    const ANSWER_TWO = 'Your emails are in Email Studio, under Broadcasts.';
    const HUB_REASON = 'HUB_API_KEY is not set on this server.';
    const { stub, calls, refusals } = makeStub((key, n, body) => {
      if (key === 'GET /api/ai/assistant/thread') return json(200, THREAD);
      if (key === 'POST /api/ai/assistant/ask') {
        if (n === 1) return json(200, answerFor('a-1', ANSWER_ONE));
        if (n === 2) return json(502, { success: false, error: 'The assistant did not answer. Nothing changed. Try again in a minute.', retryable: true });
        if (n === 3) return json(200, answerFor('a-2', ANSWER_TWO));
        return json(429, { success: false, error: 'limit', retryable: false, reason: 'hourly-ai-limit', retryAfterSeconds: 720 }, { 'Retry-After': '720' });
      }
      if (key === 'POST /api/ai/assistant/feedback') return json(200, { success: true, shared: true });
      if (key === 'POST /api/ai/assistant/notes') {
        return n === 1
          ? json(200, { success: true, notes: body.notes, profileOnHub: { durable: false, reason: HUB_REASON }, saved: { durable: true } })
          : json(200, { success: true, notes: body.notes, profileOnHub: { durable: true }, saved: { durable: true } });
      }
      if (key === 'DELETE /api/ai/assistant/thread') return json(200, { success: true, durable: true });
      return json(404, { success: false });
    });
    const { context, page, consoleErrors } = await openPage(browser, { origin, viewport, path: '/__assistant-harness.html', stub, scriptedRefusals: refusals });
    try {
      const bubble = page.locator('.jv-assistant-bubble');
      await bubble.waitFor({ state: 'visible', timeout: 30000 });
      const panel = page.locator('.jv-assistant-panel');
      await bubble.click();
      await panel.waitFor({ state: 'visible' });
      await page.waitForTimeout(250);

      const start = await active(page);
      if (viewport.width >= 720) check(`${tag}: focus lands in the question box on open`, start.tag === 'TEXTAREA' && start.inPanel, JSON.stringify(start));
      else check(`${tag}: focus lands on the heading on open (no phone keyboard unasked)`, start.tag === 'H2' && start.text === COPY['panel.title'], JSON.stringify(start));
      check(`${tag}: the thread was fetched once the panel opened`, calls.filter(c => c.key === 'GET /api/ai/assistant/thread').length === 1);

      check(`${tag}: the intro is shown: "${COPY['panel.intro']}"`, await panel.getByText(COPY['panel.intro'], { exact: true }).isVisible());
      check(`${tag}: the duplicate empty line "${COPY['thread.empty']}" is not drawn under the suggestions`, (await panel.getByText(COPY['thread.empty'], { exact: true }).count()) === 0);
      check(`${tag}: Close is the top element at its own centre`, (await closeOnTop(page)).onTop);
      for (const k of ['suggest.numbers', 'suggest.email', 'suggest.howto']) {
        check(`${tag}: the suggestion "${COPY[k]}" is a button`, await panel.getByRole('button', { name: COPY[k], exact: true }).isVisible());
        sawText(COPY[k]);
      }
      const log = panel.getByRole('log');
      check(`${tag}: the thread is a polite live log`, (await log.getAttribute('aria-live')) === 'polite');
      const input = panel.getByLabel(COPY['input.label'], { exact: true });
      check(`${tag}: the question box is labelled "${COPY['input.label']}" and has no maxlength (nothing is cut silently)`, (await input.getAttribute('maxlength')) === null);
      const sendBtn = panel.getByRole('button', { name: COPY['send.label'], exact: true });
      check(`${tag}: Send is aria-disabled while the box is empty, and not disabled`, (await sendBtn.getAttribute('aria-disabled')) === 'true' && (await sendBtn.getAttribute('disabled')) === null);

      // A suggestion fills the box and sends nothing.
      await panel.getByRole('button', { name: COPY['suggest.howto'], exact: true }).click();
      check(`${tag}: a suggestion fills the box`, (await input.inputValue()) === COPY['suggest.howto']);
      check(`${tag}: a suggestion sends nothing`, calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length === 0);
      check(`${tag}: focus moves to the box after a suggestion`, (await active(page)).tag === 'TEXTAREA');

      // Keys typed in the panel never reach the document (the map's Backspace delete and undo).
      await page.keyboard.press('Backspace');
      await page.keyboard.type('?');
      const seen = await page.evaluate(() => window.__panelKeysSeenByDocument);
      check(`${tag}: keys typed in the panel do not reach a document key listener`, seen === 0, String(seen));

      // Shift+Enter adds a line; Enter sends.
      await input.fill('How do I publish a funnel?');
      await page.keyboard.press('Shift+Enter');
      check(`${tag}: Shift+Enter adds a line and sends nothing`, (await input.inputValue()).endsWith('\n') && calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length === 0);
      await input.fill('How do I publish a funnel?');
      await page.keyboard.press('Enter');
      const answer1 = log.getByText(ANSWER_ONE, { exact: true });
      await answer1.waitFor({ state: 'visible' });
      check(`${tag}: an answer renders in the log: "${ANSWER_ONE}"`, await answer1.isVisible());
      sawText(ANSWER_ONE);
      check(`${tag}: the question is in the log`, await log.getByText('How do I publish a funnel?', { exact: true }).isVisible());
      check(`${tag}: each message names its speaker for a screen reader`, (await log.locator('.jv-assistant-sr').allTextContents()).join('|') === 'You said:|Ask Jourvance said:');
      check(`${tag}: the box was emptied on send`, (await input.inputValue()) === '');
      check(`${tag}: the asked message reached the route`, calls.some(c => c.key === 'POST /api/ai/assistant/ask' && c.body?.message === 'How do I publish a funnel?'));

      const boxes = await page.evaluate(() => {
        const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
        const head = document.querySelector('.jv-assistant-head');
        const clear = [...head.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clear conversation');
        return { title: r(head.querySelector('h2')), clear: clear ? r(clear) : null };
      });
      check(`${tag}: the title's box and Clear's box do not intersect`, !!boxes.clear && !overlap(boxes.title, boxes.clear), JSON.stringify(boxes));

      // Feedback.
      const group = panel.getByRole('group', { name: COPY['feedback.group'] });
      check(`${tag}: the rating pair is the group "${COPY['feedback.group']}"`, await group.isVisible());
      const helpful = group.getByRole('button', { name: COPY['feedback.helpful'], exact: true });
      const notHelpful = group.getByRole('button', { name: COPY['feedback.notHelpful'], exact: true });
      check(`${tag}: neither toggle is pressed yet`, (await helpful.getAttribute('aria-pressed')) === 'false' && (await notHelpful.getAttribute('aria-pressed')) === 'false');
      await helpful.click();
      await panel.getByText(COPY['feedback.sharedOnce'], { exact: true }).waitFor({ state: 'visible' });
      check(`${tag}: Helpful presses and says the copy was shared, once: "${COPY['feedback.sharedOnce']}"`, (await helpful.getAttribute('aria-pressed')) === 'true' && (await notHelpful.getAttribute('aria-pressed')) === 'false');
      sawText(COPY['feedback.sharedOnce']);
      check(`${tag}: the rating reached the route`, calls.some(c => c.key === 'POST /api/ai/assistant/feedback' && c.body?.answerId === 'a-1' && c.body?.rating === 'up'));

      await notHelpful.click();
      await page.waitForFunction(() => document.querySelector('.jv-assistant-feedback button[aria-pressed="true"]')?.textContent.trim() === 'Not helpful');
      const updated = 'Rating updated. The copy of your question shared earlier stays shared.';
      check(`${tag}: Not helpful after a shared Helpful replaces the line: "${updated}"`, (await panel.getByText(updated, { exact: true }).isVisible()) && (await panel.getByText(COPY['feedback.sharedOnce'], { exact: true }).count()) === 0 && (await helpful.getAttribute('aria-pressed')) === 'false');
      sawText(updated);

      // A 502, then Retry.
      await input.fill('Where are my emails?');
      await page.keyboard.press('Enter');
      const failed = panel.getByText(COPY['failed.line'], { exact: true });
      await failed.waitFor({ state: 'visible' });
      check(`${tag}: a 502 shows "${COPY['failed.line']}"`, await failed.isVisible());
      sawText(COPY['failed.line']);
      check(`${tag}: the failed question is back in the box (draft kept)`, (await input.inputValue()) === 'Where are my emails?');
      const retry = panel.getByRole('button', { name: COPY['failed.retry'], exact: true });
      check(`${tag}: Retry is offered`, await retry.isVisible());
      await retry.click();
      const answer2 = log.getByText(ANSWER_TWO, { exact: true });
      await answer2.waitFor({ state: 'visible' });
      check(`${tag}: Retry asks again and the answer renders: "${ANSWER_TWO}"`, await answer2.isVisible());
      check(`${tag}: the failure line is gone after Retry`, !(await failed.isVisible()));
      check(`${tag}: focus is in the question box after Retry`, (await active(page)).tag === 'TEXTAREA');

      // The hourly limit.
      await input.fill('One more question');
      await page.keyboard.press('Enter');
      const limitLine = 'You have reached this hour’s limit for questions. Try again in 12 minutes.';
      const limit = panel.getByText(limitLine, { exact: true });
      await limit.waitFor({ state: 'visible' });
      check(`${tag}: a 429 shows "${limitLine}"`, await limit.isVisible());
      sawText(limitLine);
      check(`${tag}: Send is aria-disabled during the limit and describes itself with the line`, (await sendBtn.getAttribute('aria-disabled')) === 'true' && !!(await sendBtn.getAttribute('aria-describedby')));
      check(`${tag}: the draft is kept through the limit`, (await input.inputValue()) === 'One more question');
      const askCalls = calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length;
      // Playwright will not click an aria-disabled control unless forced; a person can, so force it.
      await sendBtn.click({ force: true });
      await page.waitForTimeout(150);
      check(`${tag}: clicking a limited Send asks nothing`, calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length === askCalls);

      // Notes.
      const summary = panel.getByText(COPY['notes.heading'], { exact: true });
      check(`${tag}: the notes heading is "${COPY['notes.heading']}"`, await summary.isVisible());
      const chevron = () => page.evaluate(() => getComputedStyle(document.querySelector('.jv-assistant-chev')).transform);
      check(`${tag}: the notes chevron is not turned while closed`, (await chevron()) === 'none');
      await summary.click();
      await page.waitForTimeout(250);
      check(`${tag}: the notes chevron turns when open`, (await chevron()) !== 'none');
      check(`${tag}: the notes help is shown`, await panel.getByText(COPY['notes.help'], { exact: true }).isVisible());
      const notes = panel.locator('details textarea');
      check(`${tag}: the notes box has no maxlength either`, (await notes.getAttribute('maxlength')) === null);
      await notes.fill('We sell loose-leaf tea to cafes.');
      const saveBtn = panel.getByRole('button', { name: COPY['notes.save'], exact: true });
      await notes.fill('n'.repeat(2001));
      check(`${tag}: 2,001 characters in the notes box are kept, never cut`, (await notes.inputValue()).length === 2001);
      check(`${tag}: over the notes limit: line "${COPY['notes.tooLong']}", aria-invalid, Save aria-disabled`, (await panel.getByText(COPY['notes.tooLong'], { exact: true }).isVisible()) && (await notes.getAttribute('aria-invalid')) === 'true' && (await saveBtn.getAttribute('aria-disabled')) === 'true');
      const overColor = await panel.getByText(COPY['notes.tooLong'], { exact: true }).evaluate(el => getComputedStyle(el).color);
      check(`${tag}: the too-long line is #FCA5A5`, overColor === 'rgb(252, 165, 165)', overColor);
      const noteCalls = calls.filter(c => c.key === 'POST /api/ai/assistant/notes').length;
      await saveBtn.click({ force: true });
      await page.waitForTimeout(150);
      check(`${tag}: Save over the limit sends nothing`, calls.filter(c => c.key === 'POST /api/ai/assistant/notes').length === noteCalls);
      await notes.fill('We sell loose-leaf tea to cafes.');
      await saveBtn.click();
      const localOnly = `Your notes are saved on this server, but the AI service did not take them. ${HUB_REASON} Try saving again later.`;
      await panel.getByText(localOnly, { exact: true }).waitFor({ state: 'visible' });
      check(`${tag}: a notes save the hub refused says so: "${localOnly}"`, true);
      sawText(localOnly);
      await saveBtn.click();
      await panel.getByText(COPY['notes.saved'], { exact: true }).waitFor({ state: 'visible' });
      check(`${tag}: a notes save the hub took says "${COPY['notes.saved']}"`, await panel.getByText(COPY['notes.saved'], { exact: true }).isVisible());
      sawText(COPY['notes.saved']);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(shots, `harness-${viewport.width}-open.png`) });

      // The question box over its limit.
      await input.fill('q'.repeat(1001));
      check(`${tag}: 1,001 characters in the question box are kept, never cut`, (await input.inputValue()).length === 1001);
      check(`${tag}: over the question limit: line "${COPY['input.tooLong']}" and aria-invalid`, (await panel.getByText(COPY['input.tooLong'], { exact: true }).isVisible()) && (await input.getAttribute('aria-invalid')) === 'true');
      const askBefore = calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      check(`${tag}: Enter over the limit asks nothing`, calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length === askBefore);
      await input.fill('One more question');

      // Clear, with the inline confirm.
      await panel.locator('.jv-assistant-head').getByRole('button', { name: COPY['clear.label'], exact: true }).click();
      const confirmGroup = panel.getByRole('group', { name: COPY['clear.label'] });
      check(`${tag}: Clear asks first: "${COPY['clear.confirm']}"`, await confirmGroup.getByText(COPY['clear.confirm'], { exact: true }).isVisible());
      sawText(COPY['clear.confirm']);
      const place = await page.evaluate(() => {
        const r = el => el.getBoundingClientRect();
        const c = [...document.querySelectorAll('.jv-assistant-confirm')][0];
        return { headBottom: r(document.querySelector('.jv-assistant-head')).bottom, top: r(c).top, bodyTop: r(document.querySelector('.jv-assistant-body')).top };
      });
      check(`${tag}: the confirm sits directly under the header`, Math.abs(place.top - place.headBottom) <= 1 && place.bodyTop >= place.top, JSON.stringify(place));
      await page.keyboard.press('Escape');
      check(`${tag}: Escape in the confirm is Keep it: the confirm goes, the panel stays, nothing is deleted`, !(await confirmGroup.isVisible()) && (await panel.isVisible()) && !calls.some(c => c.key === 'DELETE /api/ai/assistant/thread'));
      await panel.locator('.jv-assistant-head').getByRole('button', { name: COPY['clear.label'], exact: true }).click();
      await confirmGroup.getByRole('button', { name: COPY['clear.confirmNo'], exact: true }).click();
      check(`${tag}: "${COPY['clear.confirmNo']}" keeps the conversation and sends no DELETE`, !(await confirmGroup.isVisible()) && !calls.some(c => c.key === 'DELETE /api/ai/assistant/thread') && (await log.getByText(ANSWER_ONE, { exact: true }).isVisible()));
      await panel.locator('.jv-assistant-head').getByRole('button', { name: COPY['clear.label'], exact: true }).click();
      await confirmGroup.getByRole('button', { name: COPY['clear.confirmYes'], exact: true }).click();
      const cleared = panel.getByText(COPY['clear.done'], { exact: true });
      await cleared.waitFor({ state: 'visible' });
      check(`${tag}: a confirmed clear says "${COPY['clear.done']}" and empties the log`, (await cleared.isVisible()) && !(await log.getByText(ANSWER_ONE, { exact: true }).isVisible()));
      sawText(COPY['clear.done']);
      check(`${tag}: Clear did not lift the hourly limit`, await panel.getByText(limitLine, { exact: true }).isVisible());
      await page.waitForTimeout(100);
      check(`${tag}: focus is in the question box after Clear`, (await active(page)).tag === 'TEXTAREA');

      // Closing keeps a draft; the bubble gets focus back.
      await input.fill('A draft I have not sent');
      if (viewport.width < 720) {
        let leftAt = -1;
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          if (!(await active(page)).inPanel) { leftAt = i; break; }
        }
        check(`${tag}: 40 Tabs never leave the sheet`, leftAt === -1, `left at Tab ${leftAt}`);
        await page.keyboard.press('Shift+Tab');
        check(`${tag}: Shift+Tab from the first stop wraps inside the sheet`, (await active(page)).inPanel);
      }
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      check(`${tag}: Escape returns focus to the bubble`, (await active(page)).isBubble);
      await bubble.click();
      await panel.waitFor({ state: 'visible' });
      check(`${tag}: the draft survives closing and reopening`, (await input.inputValue()) === 'A draft I have not sent');
      check(`${tag}: reopening does not fetch the thread again`, calls.filter(c => c.key === 'GET /api/ai/assistant/thread').length === 1);
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  // Unavailable on this server: the sentence replaces the box, the notes stay.
  {
    const tag = 'signed in, assistant unavailable';
    say(tag);
    const { stub } = makeStub(key => (key === 'GET /api/ai/assistant/thread' ? json(200, { ...THREAD, available: false, reason: 'ai-unavailable' }) : json(404, { success: false })));
    const { context, page, consoleErrors } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/__assistant-harness.html', stub });
    try {
      await page.locator('.jv-assistant-bubble').click({ timeout: 30000 });
      const panel = page.locator('.jv-assistant-panel');
      const line = panel.getByText(COPY['unavailable.line'], { exact: true });
      await line.waitFor({ state: 'visible' });
      check(`${tag}: shows "${COPY['unavailable.line']}"`, await line.isVisible());
      sawText(COPY['unavailable.line']);
      check(`${tag}: it does not say "${COPY['thread.empty']}" when no box exists`, (await panel.getByText(COPY['thread.empty'], { exact: true }).count()) === 0);
      check(`${tag}: there is no question box and no Retry`, (await panel.getByLabel(COPY['input.label'], { exact: true }).count()) === 0 && (await panel.getByRole('button', { name: COPY['failed.retry'] }).count()) === 0);
      check(`${tag}: the notes are still there`, await panel.getByText(COPY['notes.heading'], { exact: true }).isVisible());
      check(`${tag}: focus was not lost to the page when the box went away`, (await active(page)).inPanel);
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally {
      await context.close();
    }
  }

  // Signed out in the harness: the Sign In button calls onOpenAuth.
  {
    const tag = 'harness signed out';
    say(tag);
    const { context, page } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/__assistant-harness.html?signedOut=1' });
    try {
      await page.locator('.jv-assistant-bubble').click({ timeout: 30000 });
      await page.locator('.jv-assistant-panel').getByRole('button', { name: COPY['signedOut.button'], exact: true }).click();
      check(`${tag}: Sign In calls onOpenAuth once`, (await page.evaluate(() => window.__authCalls)) === 1);
      check(`${tag}: and closes the panel`, !(await page.locator('.jv-assistant-panel').isVisible()));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally {
      await context.close();
    }
  }
}

// ---- Part 0: the build put it in its own chunk ----

function chunkChecks(outDir) {
  const assets = path.join(outDir, 'assets');
  const js = fs.readdirSync(assets).filter(f => f.endsWith('.js'));
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const entry = (html.match(/assets\/([^"]+\.js)/) || [])[1];
  const holders = js.filter(f => fs.readFileSync(path.join(assets, f), 'utf8').includes('jv-assistant-panel'));
  say('build');
  check('the build has a JS chunk holding the assistant panel', holders.length >= 1, holders.join(', '));
  check('that chunk is not the entry chunk (it is lazy)', holders.length >= 1 && !holders.includes(entry), `entry ${entry}, holders ${holders.join(', ')}`);
  const css = fs.readdirSync(assets).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n');
  check('the built CSS carries the assistant rules and the print rule', css.includes('.jv-assistant-panel') && /@media print\s*\{\s*\.jv-assistant-bubble,\s*\.jv-assistant-panel\s*\{\s*display:\s*none/.test(css));
  say(`  assistant chunk(s): ${holders.join(', ')}`);
}

async function main(cleanup) {
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) { say(`check:assistant could not run. Playwright was not found at ${pwPath}.`); return 2; }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) { say(`check:assistant could not run. Chrome was not found at ${chromePath}.`); return 2; }
  const { chromium } = await import(pathToFileURL(pwPath).href);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-assistant-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-assistant-env-'));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-assistant-cache-'));
  cleanup.dirs.push(work, envDir, cacheDir);
  // Not in the cleanup list when it is the default, so the paths printed at the end still exist.
  const shots = process.env.ASSISTANT_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'jv-assistant-shots-'));
  fs.mkdirSync(shots, { recursive: true });
  const outDir = path.join(work, 'dist');

  try {
    await build({ root: ROOT, envDir, cacheDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:assistant could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  chunkChecks(outDir);

  let origin;
  let harnessOrigin;
  try {
    const port = await freePort();
    const server = await preview({ root: ROOT, envDir, cacheDir, logLevel: 'warn', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true, proxy: {}, open: false } });
    cleanup.servers.push(server);
    origin = new URL(server.resolvedUrls.local[0]).origin;
    const devPort = await freePort();
    const dev = await createServer({
      root: ROOT,
      envDir,
      cacheDir,
      logLevel: 'warn',
      configFile: false,
      plugins: [react(), harnessPlugin()],
      server: { host: '127.0.0.1', port: devPort, strictPort: true, hmr: false, watch: null, proxy: {} },
      optimizeDeps: { entries: [], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'lucide-react', 'firebase/app', 'firebase/auth'] }
    });
    await dev.listen();
    cleanup.servers.push(dev);
    harnessOrigin = new URL(dev.resolvedUrls.local[0]).origin;
  } catch (err) {
    say(`check:assistant could not run. A server could not start: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;
  const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/defaultBlueprint.ts')).href);
  await realApp(browser, origin, shots);
  await smallScreens(browser, origin, shots);
  await withCanvas(browser, origin, DEFAULT_LEAD_CAPTURE_PROJECT);
  await harness(browser, harnessOrigin, shots);

  say('');
  say(`Assertions: ${asserted}. Findings: ${findings.length}.`);
  say(`Strings the browser showed and the check asserted on:`);
  for (const s of shownStrings) say(`  "${s}"`);
  say(`Screenshots: ${shots}`);
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
    .catch(err => { say(`check:assistant could not run. ${String(err?.message || err).split('\n')[0]}`); return 2; })
    .then(async code => { await finish(); process.exit(code); });
}
