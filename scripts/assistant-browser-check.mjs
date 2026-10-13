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
// Part 4, the REAL app signed in (built, vite preview), for the suggested actions (W3.A): the
//   Firebase user is seeded where Firebase Auth keeps a persisted user (signedInUserFixture, the
//   canvas check's fixture) with every request aborted, and the account read of the open journey
//   answers with no copy. The assistant routes are stubbed, and each answer's actions are built by
//   the SERVER's own readReply (server/assistantActions.mjs), so the button text is the label the
//   route would send. Asserted on what the app shows: the buttons, Email Studio's own heading after
//   "Open Email Studio", one more step on the map after the add-step button and one fewer after the
//   editor's Undo, the new name in the header's Journey name box after a rename and the old one after
//   Undo, the notOpen line for a journey that is not the open one, the latest-answer-only rule, and
//   the buttons inside the sheet at 320px.
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
  const m = line.match(/^\| ([A-Za-z0-9.-]+\.[A-Za-z0-9-]+) \| (.*) \|$/);
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
async function openPage(browser, { origin, viewport, path: urlPath, stub = null, scriptedRefusals = () => 0, seed = null, signedIn = null, stubFunnel = true }) {
  const context = await browser.newContext({ viewport });
  const blocked = [];
  const consoleErrors = [];
  let scriptedSeen = 0;
  await context.route('**/*', route => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin !== origin) { blocked.push(req.url()); return route.abort(); }
    if ((u.pathname.startsWith('/api/ai/assistant/') || (u.pathname === '/api/funnel/stats' && stubFunnel)) && stub) return stub(route, req, u);
    // Signed in, the account read of the open journey answers with no copy, so the journey is not held.
    if (signedIn && req.method() === 'GET' && /^\/api\/journey\/[^/]+$/.test(u.pathname)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, journey: null }) });
    }
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
  // After the seed, which clears localStorage on the first load: the Firebase user goes in last.
  if (signedIn) {
    await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [signedIn.key, JSON.stringify(signedIn.value)]);
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
        check(`${tag}: the page says the assistant is mounted (data-jv-ask-ready on <html>)`, await page.evaluate(() => document.documentElement.hasAttribute('data-jv-ask-ready')));
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
        // The card is 25, below the toolbar's menus; the sheet under 720px is 35, over the toolbar row and the header.
        const panelZ = viewport.width < 720 ? '35' : '25';
        check(`${tag}: the panel's computed z-index is ${panelZ}`, z.panel === panelZ, z.panel);
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
    import { AttributionReports } from '/src/components/analytics/AttributionReports.tsx';
    import { DEFAULT_LEAD_CAPTURE_PROJECT } from '/src/lib/defaultBlueprint.ts';
    window.__authCalls = 0;
    window.__panelKeysSeenByDocument = 0;
    document.addEventListener('keydown', e => { if (e.target && e.target.closest && e.target.closest('.jv-assistant-panel')) window.__panelKeysSeenByDocument++; });
    const params = new URLSearchParams(location.search);
    const user = params.get('signedOut') ? null : { uid: 'user-1', email: 'owner@example.com' };
    const screen = {};
    for (const k of ['view', 'journeyId', 'journeyName', 'stepKind', 'stepName']) if (params.get(k)) screen[k] = params.get(k);
    const children = params.get('noAsk') ? [] : [React.createElement(AskJourvance, { key: 'ask', user, onOpenAuth: () => { window.__authCalls++; }, businessType: 'E-Commerce Brand', ...screen })];
    // The attribution screen's own components, so the two buttons are the shipped ones. They show only while the assistant is mounted.
    if (params.get('mount') === 'attribution') {
      const nodes = DEFAULT_LEAD_CAPTURE_PROJECT.nodes;
      const edges = DEFAULT_LEAD_CAPTURE_PROJECT.edges;
      children.push(React.createElement('div', { key: 'attr', style: { padding: 16, maxWidth: 900 } },
        React.createElement(AttributionReports, { workspace: null, nodes, edges, journeyId: params.get('journeyId') || '' })));
    }
    createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null, ...children));
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
      for (const k of ['suggest.public.1', 'suggest.public.2', 'suggest.public.3']) {
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
      await panel.getByRole('button', { name: COPY['suggest.public.3'], exact: true }).click();
      check(`${tag}: a suggestion fills the box`, (await input.inputValue()) === COPY['suggest.public.3']);
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

// ---- Part 3: the screen, the per-view suggestions and "Ask about this" (harness, hub stubbed) ----

const FUNNEL_BODY = {
  success: true, journeyId: 'j-1', days: 30, from: '2026-09-11', to: '2026-10-11', partialSince: null,
  stats: { nodes: { 'node-ad-1': { clicks: 1200 }, 'node-page-1': { visitors: 1000 }, 'node-form-1': { submissions: 40 }, 'node-seq-1': { flowEnrolled: 30 } } },
  coverage: Object.fromEntries(['node-ad-1', 'node-page-1', 'node-form-1', 'node-seq-1'].map(id => [id, { measured: true }]))
};

async function screens(browser, origin, shots) {
  const stubFor = () => makeStub((key, n) => {
    if (key === 'GET /api/ai/assistant/thread') return json(200, THREAD);
    if (key === 'POST /api/ai/assistant/ask') return json(200, answerFor(`a-${n}`, 'Your leads are in the funnel report.'));
    if (key === 'POST /api/funnel/stats') return json(200, FUNNEL_BODY);
    return json(404, { success: false });
  });
  const sugKeys = v => [1, 2, 3].map(i => COPY[`suggest.${v}.${i}`]);

  // (a) The suggestions follow the screen, on the canvas and on the public page, and the ask carries it.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `screen ${viewport.width}x${viewport.height}`;
    say(tag);
    const { stub, calls, refusals } = stubFor();
    const q = '?view=canvas&journeyId=j-1&journeyName=Spring%20launch&stepKind=landing-page&stepName=Lead%20Capture%20Lander';
    const { context, page, consoleErrors } = await openPage(browser, { origin, viewport, path: `/__assistant-harness.html${q}`, stub, scriptedRefusals: refusals });
    try {
      await page.locator('.jv-assistant-bubble').click();
      const panel = page.locator('.jv-assistant-panel');
      await panel.waitFor({ state: 'visible' });
      await panel.getByRole('button', { name: COPY['suggest.canvas.1'], exact: true }).waitFor({ state: 'visible' });
      for (const text of sugKeys('canvas')) { check(`${tag}: the canvas suggestion "${text}" is a button`, await panel.getByRole('button', { name: text, exact: true }).isVisible()); sawText(text); }
      for (const text of sugKeys('public')) check(`${tag}: the public suggestion "${text}" is not offered on the canvas`, (await panel.getByRole('button', { name: text, exact: true }).count()) === 0);
      await panel.getByRole('button', { name: COPY['suggest.canvas.3'], exact: true }).click();
      await page.keyboard.press('Enter');
      await panel.getByText('Your leads are in the funnel report.', { exact: true }).waitFor({ state: 'visible' });
      const asked = calls.find(c => c.key === 'POST /api/ai/assistant/ask');
      check(`${tag}: the thread call carried the screen`, calls.some(c => c.key === 'GET /api/ai/assistant/thread'));
      check(`${tag}: the ask carried screen.view "canvas"`, asked?.body?.screen?.view === 'canvas', JSON.stringify(asked?.body));
      check(`${tag}: the ask carried the journey id`, asked?.body?.screen?.journeyId === 'j-1' && asked?.body?.screen?.journeyName === 'Spring launch', JSON.stringify(asked?.body?.screen));
      check(`${tag}: the ask carried the selected step`, asked?.body?.screen?.step?.kind === 'landing-page' && asked?.body?.screen?.step?.name === 'Lead Capture Lander', JSON.stringify(asked?.body?.screen));
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally { await context.close(); }
  }
  {
    const tag = 'screen public page';
    say(tag);
    const { stub, calls, refusals } = stubFor();
    const { context, page } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/__assistant-harness.html?view=public&journeyId=j-1', stub, scriptedRefusals: refusals });
    try {
      await page.locator('.jv-assistant-bubble').click();
      const panel = page.locator('.jv-assistant-panel');
      await panel.getByRole('button', { name: COPY['suggest.public.1'], exact: true }).waitFor({ state: 'visible' });
      for (const text of sugKeys('public')) check(`${tag}: the public suggestion "${text}" is a button`, await panel.getByRole('button', { name: text, exact: true }).isVisible());
      for (const text of sugKeys('canvas')) check(`${tag}: the canvas suggestion "${text}" is not offered here`, (await panel.getByRole('button', { name: text, exact: true }).count()) === 0);
      await panel.getByRole('button', { name: COPY['suggest.public.3'], exact: true }).click();
      await page.keyboard.press('Enter');
      await panel.locator('.jv-assistant-log').getByText('Your leads are in the funnel report.').waitFor({ state: 'visible' });
      const asked = calls.find(c => c.key === 'POST /api/ai/assistant/ask');
      check(`${tag}: the public page asks with screen.view "public" and no journey`, asked?.body?.screen?.view === 'public' && !('journeyId' in asked.body.screen), JSON.stringify(asked?.body?.screen));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally { await context.close(); }
  }

  // (b) The attribution screen's two buttons open the panel with the question in the box, and send nothing.
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `ask about this ${viewport.width}x${viewport.height}`;
    say(tag);
    const { stub, calls, refusals } = stubFor();
    const q = '?mount=attribution&view=attribution&journeyId=j-1&journeyName=Spring%20launch';
    const { context, page, consoleErrors } = await openPage(browser, { origin, viewport, path: `/__assistant-harness.html${q}`, stub, scriptedRefusals: refusals });
    try {
      const panel = page.locator('.jv-assistant-panel');
      const numbers = page.getByRole('button', { name: 'Ask about these numbers', exact: true });
      await numbers.waitFor({ state: 'visible', timeout: 15000 });
      check(`${tag}: "Ask about these numbers" is a visible <button type="button">`, (await numbers.getAttribute('type')) === 'button' && (await numbers.textContent()).trim() === 'Ask about these numbers');
      sawText('Ask about these numbers');
      check(`${tag}: the panel is closed before the click`, !(await panel.isVisible()));
      await numbers.click();
      await panel.waitFor({ state: 'visible' });
      const input = panel.getByLabel(COPY['input.label']);
      await input.waitFor({ state: 'visible' });
      // The thread loads first on the first open; the question lands in the box once it has.
      await page.waitForFunction(() => (document.querySelector('.jv-assistant-panel textarea') || {}).value, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(100);
      const text = await input.inputValue();
      check(`${tag}: the box holds a question naming the range: "${text}"`, text === 'What do my attribution numbers for the last 30 days say?', text);
      sawText(text);
      check(`${tag}: focus is in the box`, (await active(page)).tag === 'TEXTAREA' && (await active(page)).inPanel, JSON.stringify(await active(page)));
      check(`${tag}: pressing the button sent nothing`, calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length === 0);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(shots, `ask-numbers-${viewport.width}.png`) });
      await page.keyboard.press('Enter');
      await panel.getByText('Your leads are in the funnel report.', { exact: true }).waitFor({ state: 'visible' });
      let asked = calls.filter(c => c.key === 'POST /api/ai/assistant/ask').at(-1);
      check(`${tag}: the ask carried screen.view "attribution" and the journey id`, asked?.body?.screen?.view === 'attribution' && asked?.body?.screen?.journeyId === 'j-1', JSON.stringify(asked?.body?.screen));
      check(`${tag}: and the question the box held`, asked?.body?.message === text, asked?.body?.message);

      // The leak finder's button, beside the named drop.
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      const leakBtn = page.getByRole('button', { name: 'Ask why this step loses people', exact: true });
      await leakBtn.scrollIntoViewIfNeeded();
      await leakBtn.waitFor({ state: 'visible', timeout: 15000 });
      check(`${tag}: "Ask why this step loses people" is a visible <button type="button">`, (await leakBtn.getAttribute('type')) === 'button');
      sawText('Ask why this step loses people');
      await leakBtn.click();
      await panel.waitFor({ state: 'visible' });
      await page.waitForFunction(() => (document.querySelector('.jv-assistant-panel textarea') || {}).value, null, { timeout: 8000 }).catch(() => {});
      const text2 = await input.inputValue();
      check(`${tag}: the box holds a question naming the step: "${text2}"`, text2 === 'Why does Client Intake Form lose people in this journey?', text2);
      sawText(text2);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(shots, `ask-leak-${viewport.width}.png`) });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.jv-assistant-panel [role="log"] *').length > 0 && [...document.querySelectorAll('.jv-assistant-panel [role="log"] p, .jv-assistant-panel [role="log"] div')].filter(e => e.children.length === 0 && e.textContent === 'Your leads are in the funnel report.').length >= 2, null, { timeout: 8000 });
      asked = calls.filter(c => c.key === 'POST /api/ai/assistant/ask').at(-1);
      check(`${tag}: that ask carried the leaking step`, asked?.body?.screen?.step?.name === 'Client Intake Form' && asked?.body?.screen?.view === 'attribution', JSON.stringify(asked?.body?.screen));
      // The step is for that one question: the next ask goes back to the mount's own reading.
      await input.fill('And what else?');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('.jv-assistant-panel [role="log"] *')].filter(e => e.children.length === 0 && e.textContent === 'Your leads are in the funnel report.').length >= 3, null, { timeout: 8000 });
      asked = calls.filter(c => c.key === 'POST /api/ai/assistant/ask').at(-1);
      check(`${tag}: the next ask no longer names the step`, asked?.body?.message === 'And what else?' && !asked?.body?.screen?.step, JSON.stringify(asked?.body));
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
    } finally { await context.close(); }
  }

  // (c) Signed out: the button opens the panel on its sign-in line, with no box to fill. Unmounted: no button.
  {
    const tag = 'ask about this, assistant not mounted';
    say(tag);
    const { stub, refusals } = stubFor();
    const { context, page } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/__assistant-harness.html?mount=attribution&view=attribution&journeyId=j-1&noAsk=1', stub, scriptedRefusals: refusals });
    try {
      await page.getByText('Export CSV').first().waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(800);
      check(`${tag}: the toolbar is drawn but has no "Ask about these numbers"`, (await page.getByRole('button', { name: 'Ask about these numbers' }).count()) === 0);
      check(`${tag}: and the leak finder has no "Ask why this step loses people"`, (await page.getByRole('button', { name: 'Ask why this step loses people' }).count()) === 0);
      check(`${tag}: <html> carries no ready mark`, !(await page.evaluate(() => document.documentElement.hasAttribute('data-jv-ask-ready'))));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally { await context.close(); }
  }
  {
    const tag = 'ask about this signed out';
    say(tag);
    const { stub, calls, refusals } = stubFor();
    const { context, page } = await openPage(browser, { origin, viewport: { width: 1440, height: 900 }, path: '/__assistant-harness.html?mount=attribution&view=attribution&journeyId=j-1&signedOut=1', stub, scriptedRefusals: refusals });
    try {
      const numbers = page.getByRole('button', { name: 'Ask about these numbers', exact: true });
      await numbers.waitFor({ state: 'visible', timeout: 15000 });
      await numbers.click();
      const panel = page.locator('.jv-assistant-panel');
      await panel.waitFor({ state: 'visible' });
      check(`${tag}: the panel opens on "${COPY['signedOut.line']}"`, await panel.getByText(COPY['signedOut.line'], { exact: true }).isVisible());
      check(`${tag}: there is no question box`, (await panel.getByLabel(COPY['input.label']).count()) === 0);
      check(`${tag}: nothing was sent to the assistant`, calls.filter(c => c.key.includes('/api/ai/assistant/')).length === 0, JSON.stringify(calls.map(c => c.key)));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally { await context.close(); }
  }
}

// ---- Part 4: suggested actions in the real app, signed in (W3.A) ----

const ACT_JOURNEY = 'journey-actions-check';
const ACT_NAME = 'Spring launch';
const ACT_RENAME = 'Autumn launch';
// At 320px the journey has a long name, so the label is long enough that it must wrap in the sheet.
const ACT_LONG_NAME = 'Spring launch for the north studio, the kiln club and the summer fair';

async function actionsInApp(browser, origin, shots, baseProject) {
  const { readReply, relabelStoredActions } = await import(pathToFileURL(path.join(ROOT, 'server/assistantActions.mjs')).href);
  const { cleanModelStrings } = await import(pathToFileURL(path.join(ROOT, 'server/aiCall.mjs')).href);
  const { signedInUserFixture, firebaseApiKeyFrom } = await import(pathToFileURL(path.join(ROOT, 'src/lib/canvasCheckRules.ts')).href);
  const apiKey = firebaseApiKeyFrom(fs.readFileSync(path.join(ROOT, 'src/lib/firebase.ts'), 'utf8'));
  check('actions: a Firebase apiKey was found, so the app can be signed in', !!apiKey);
  if (!apiKey) return;
  const project = { ...baseProject, id: ACT_JOURNEY, name: ACT_NAME, updatedAt: new Date().toISOString() };
  // What the route answers, with the actions read and labelled by the server's own readReply from
  // what a model might send (the delete is not in the vocabulary, so it never reaches the panel).
  const serverAnswer = (id, modelText, screen, journeys) => {
    const r = readReply(modelText, screen, { journeys, clean: cleanModelStrings });
    return { success: true, source: 'hub-brain', answer: { id, role: 'assistant', text: cleanModelStrings(r.answer), at: new Date().toISOString(), grounding: 'account', ...(r.actions.length ? { actions: r.actions } : {}) } };
  };
  const onCanvas = { view: 'canvas', journeyId: ACT_JOURNEY };
  const FIRST_TEXT = 'You can do all three from here. Press a button below when you are ready.';
  const firstFor = (journeyName) => serverAnswer('act-1', JSON.stringify({ answer: FIRST_TEXT, actions: [
    { kind: 'add-step', type: 'landing-page', journeyId: ACT_JOURNEY },
    { kind: 'delete', journeyId: ACT_JOURNEY },
    { kind: 'rename-journey', name: ACT_RENAME, journeyId: ACT_JOURNEY },
    { kind: 'open', view: 'email-studio' }
  ] }), onCanvas, [{ id: ACT_JOURNEY, name: journeyName }]);
  // Asked on the canvas, pressed after Email Studio opened: one step for a journey that is not the
  // open one, one for the open journey whose map is no longer on screen, and the way back.
  const SECOND_TEXT = 'Here are two steps and the way back to the map.';
  const second = serverAnswer('act-2', 'Sure:\n```json5\n' + JSON.stringify({ answer: SECOND_TEXT, actions: [
    { kind: 'add-step', type: 'lead-form', journeyId: 'journey-not-open' },
    { kind: 'add-step', type: 'upsell', journeyId: ACT_JOURNEY },
    { kind: 'open', view: 'canvas' }
  ] }) + '\n```', { view: 'canvas', journeyId: ACT_JOURNEY }, [{ id: ACT_JOURNEY, name: ACT_NAME }]);
  // The server kept the other journey's step only because the screen named it when it was asked.
  const otherStep = serverAnswer('x', JSON.stringify({ answer: 'x', actions: [{ kind: 'add-step', type: 'lead-form', journeyId: 'journey-not-open' }] }), { view: 'canvas', journeyId: 'journey-not-open' }, [{ id: 'journey-not-open', name: 'Old funnel' }]).answer.actions[0];
  second.answer.actions = [otherStep, ...second.answer.actions];
  const THIRD_TEXT = 'Attribution has the numbers.';
  const third = serverAnswer('act-3', JSON.stringify({ answer: THIRD_TEXT, actions: [
    { kind: 'open', view: 'attribution' },
    { kind: 'add-step', type: 'thank-you', journeyId: ACT_JOURNEY },
    { kind: 'rename-journey', name: 'Never pressed', journeyId: ACT_JOURNEY }
  ] }), onCanvas, [{ id: ACT_JOURNEY, name: ACT_NAME }]);
  const FOURTH_TEXT = 'Nothing to do here.';
  const fourth = serverAnswer('act-4', FOURTH_TEXT, onCanvas, []);
  const labelsOf = (answer) => (answer.answer.actions || []).map(a => a.label);
  check('actions: the server reader kept three of the four proposed and labelled them from the journey list',
    JSON.stringify(labelsOf(firstFor(ACT_NAME))) === JSON.stringify([`Add a landing page step to ${ACT_NAME}`, `Rename this journey to "${ACT_RENAME}"`, 'Open Email Studio']), JSON.stringify(labelsOf(firstFor(ACT_NAME))));
  check('actions: a journey name over 60 characters is cut with an ellipsis in the label',
    labelsOf(firstFor(ACT_LONG_NAME))[0] === `Add a landing page step to ${ACT_LONG_NAME.slice(0, 59).trimEnd()}\u2026`, labelsOf(firstFor(ACT_LONG_NAME))[0]);
  check('actions: the second answer, prose and a json5 fence around it, was read as JSON',
    second.answer.text === SECOND_TEXT && JSON.stringify(labelsOf(second)) === JSON.stringify(['Add a lead form step to Old funnel', `Add an upsell step to ${ACT_NAME}`, 'Open the canvas']), JSON.stringify(second.answer));
  // The thread a reload reads back: every answer above, its actions rebuilt as GET thread rebuilds them.
  const storedThread = () => {
    const at = new Date().toISOString();
    const msgs = [];
    // The newest stored answer carries actions, so a reload must show even those as lines.
    [['Q4', fourth], ['Q1', firstFor(ACT_NAME)], ['Q2', second], ['Q3', third]].forEach(([q, a], i) => {
      msgs.push({ id: `stored-u${i}`, role: 'user', text: q, at });
      const actions = relabelStoredActions(a.answer.actions || [], [{ id: ACT_JOURNEY, name: ACT_NAME, userId: 'u' }]);
      msgs.push({ ...a.answer, ...(actions.length ? { actions } : {}) });
    });
    return { ...THREAD, messages: msgs };
  };

  const nodesOf = page => page.locator('.react-flow__node').count();
  // The element at the centre of the first match is that element or inside it: nothing is drawn over it.
  const onTop = (page, selector) => page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, onTop: !!hit && (hit === el || el.contains(hit)), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  }, selector);
  // The words AskJourvance's always-mounted status holds (outside the panel).
  const outsideSaid = page => page.evaluate(() => [...document.querySelectorAll('span.jv-assistant-sr[role="status"]')].filter(s => !s.closest('.jv-assistant-panel')).map(s => s.textContent).join('|'));
  const focusInfo = page => page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? null, inCard: !!a?.closest?.('.react-flow__node'), line: a?.getAttribute?.('data-action-line') ?? null, live: a?.getAttribute?.('aria-live') ?? null, text: (a?.textContent || '').trim().slice(0, 60) };
  });
  const triggerShown = page => page.evaluate(() => {
    const t = document.querySelector('.jv-mobile-nav-trigger');
    return !!t && getComputedStyle(t).display !== 'none' && t.getClientRects().length > 0;
  });

  // ---- Desktop: nothing closes; a new step takes focus on the map; every other result takes focus in place ----
  {
    const viewport = { width: 1440, height: 900 };
    const tag = `actions ${viewport.width}x${viewport.height}`;
    say(tag);
    const { stub, calls, refusals } = makeStub((key, n) => {
      if (key === 'GET /api/ai/assistant/thread') return json(200, n === 1 ? THREAD : storedThread());
      if (key === 'POST /api/ai/assistant/ask') return json(200, [firstFor(ACT_NAME), second, third, fourth][n - 1] || fourth);
      return json(404, { success: false });
    });
    const { context, page, consoleErrors } = await openPage(browser, {
      origin, viewport, path: '/canvas', stub, scriptedRefusals: refusals, seed: { ...project, name: ACT_NAME }, signedIn: signedInUserFixture(apiKey, Date.now()), stubFunnel: false
    });
    try {
      await page.waitForSelector('.react-flow__node', { timeout: 20000 });
      await page.waitForTimeout(500);
      const nameBox = page.getByLabel('Journey name', { exact: true });
      const studioHeading = page.getByRole('heading', { level: 1, name: /Email Studio/ });
      const attributionHeading = page.getByRole('heading', { level: 1, name: /Attribution/ });
      const asks = () => calls.filter(c => c.key === 'POST /api/ai/assistant/ask').length;
      const before = await nodesOf(page);
      check(`${tag}: the journey on the canvas is "${ACT_NAME}"`, (await nameBox.inputValue()) === ACT_NAME, await nameBox.inputValue());
      const bubble = page.locator('.jv-assistant-bubble');
      const panel = page.locator('.jv-assistant-panel');
      await bubble.click();
      await panel.waitFor({ state: 'visible' });
      const input = panel.getByLabel(COPY['input.label'], { exact: true });
      await input.waitFor({ state: 'visible', timeout: 15000 });
      // The step panel's helper text lies under the panel's head at this size. During the 160ms fade-in
      // it shows through (the panel is not yet opaque); the stacking order is what this measures.
      const under = await page.evaluate(() => {
        const p = document.querySelector('.jv-assistant-panel');
        const pr = p.getBoundingClientRect();
        const t = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && /^Choose one above/.test((e.textContent || '').trim()));
        if (!t) return { found: false, opacity: getComputedStyle(p).opacity };
        const r = t.getBoundingClientRect();
        const x = Math.max(r.left, pr.left) + 10;
        const y = Math.min(Math.max(r.top + r.height / 2, pr.top + 4), pr.bottom - 4);
        const hit = document.elementFromPoint(x, y);
        return { found: true, opacity: getComputedStyle(p).opacity, overlaps: r.bottom > pr.top && r.right > pr.left, panelOnTop: !!hit && p.contains(hit) };
      });
      say(`  info ${tag}: panel opacity just after it opened: ${under.opacity}`);
      check(`${tag}: where the step panel's helper text lies under the panel, the panel is drawn over it`, under.found && under.overlaps && under.panelOnTop, JSON.stringify(under));
      await page.waitForTimeout(300);
      check(`${tag}: signed in, the panel offers the question box`, await input.isVisible());
      const head = await onTop(page, '.jv-assistant-panel .jv-assistant-title');
      check(`${tag}: once open, the panel's title is the element at its own point (the step panel's words under it are covered)`, head.onTop, JSON.stringify(head));
      check(`${tag}: opening the panel ran nothing`, (await nodesOf(page)) === before && (await studioHeading.count()) === 0);
      await input.fill('Add a landing page, rename this journey and open Email Studio.');
      await page.keyboard.press('Enter');
      const log = panel.getByRole('log');
      await log.getByText(FIRST_TEXT, { exact: true }).waitFor({ state: 'visible' });
      sawText(FIRST_TEXT);
      const labels1 = labelsOf(firstFor(ACT_NAME));
      const group = panel.getByRole('group', { name: COPY['action.group'], exact: true });
      check(`${tag}: the answer's actions sit in the group "${COPY['action.group']}"`, await group.isVisible());
      for (const label of labels1) {
        check(`${tag}: the button "${label}" is shown`, await group.getByRole('button', { name: label, exact: true }).isVisible());
        sawText(label);
      }
      check(`${tag}: three buttons, so the delete the model proposed is not offered`, (await group.getByRole('button').count()) === 3);
      check(`${tag}: the answer rendering ran nothing (same steps, same name, no Email Studio)`, (await nodesOf(page)) === before && (await nameBox.inputValue()) === ACT_NAME && (await studioHeading.count()) === 0);
      await input.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      check(`${tag}: Enter in the empty question box sends nothing and runs nothing`, asks() === 1 && (await nodesOf(page)) === before && (await studioHeading.count()) === 0);

      // Add a step: one more on the map, its line in place of the button, focus on the new step, the result said outside.
      await group.getByRole('button', { name: labels1[0], exact: true }).click();
      const addedText = 'Added a landing page step. Undo is in the editor toolbar.';
      const addedLine = group.getByText(addedText, { exact: true });
      await addedLine.waitFor({ state: 'visible' });
      sawText(addedText);
      check(`${tag}: "${labels1[0]}" put one more step on the map`, (await nodesOf(page)) === before + 1, `${before} then ${await nodesOf(page)}`);
      check(`${tag}: its button became the line "${addedText}" in the ok tone`, (await group.getByRole('button', { name: labels1[0], exact: true }).count()) === 0 && /jv-assistant-action-line--ok/.test(await addedLine.getAttribute('class')));
      check(`${tag}: the panel stays open at this width`, await panel.isVisible());
      const onCard = await page.waitForFunction(() => !!document.activeElement?.closest?.('.react-flow__node'), null, { timeout: 3000 }).then(() => true, () => false);
      check(`${tag}: focus went to the new step on the map, as the header's Add Step sends it`, onCard, JSON.stringify(await focusInfo(page)));
      const said = await page.waitForFunction(t => [...document.querySelectorAll('span.jv-assistant-sr[role="status"]')].some(s => !s.closest('.jv-assistant-panel') && s.textContent === t), addedText, { timeout: 3000 }).then(() => true, () => false);
      check(`${tag}: focus left the panel, so the result is said by the status outside it`, said, await outsideSaid(page));
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.waitForFunction(n => document.querySelectorAll('.react-flow__node').length === n, before, { timeout: 5000 }).catch(() => {});
      check(`${tag}: the editor toolbar's Undo takes the added step back`, (await nodesOf(page)) === before, String(await nodesOf(page)));

      // Rename: the header shows the new name, focus moves to the line, which is not live.
      await group.getByRole('button', { name: labels1[1], exact: true }).click();
      const renamedText = `Renamed to "${ACT_RENAME}". Undo is in the editor toolbar.`;
      await group.getByText(renamedText, { exact: true }).waitFor({ state: 'visible' });
      sawText(renamedText);
      check(`${tag}: "${labels1[1]}" put "${ACT_RENAME}" in the header`, (await nameBox.inputValue()) === ACT_RENAME, await nameBox.inputValue());
      const onLine = await page.waitForFunction(() => document.activeElement?.hasAttribute('data-action-line') === true, null, { timeout: 2000 }).then(() => true, () => false);
      const f = await focusInfo(page);
      check(`${tag}: the pressed button is gone, so focus moved to the line that took its place`, onLine, JSON.stringify(f));
      check(`${tag}: the focused line is not live (aria-live="off"), so it is said once`, f.live === 'off', JSON.stringify(f));
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.waitForTimeout(200);
      check(`${tag}: the editor toolbar's Undo brings "${ACT_NAME}" back`, (await nameBox.inputValue()) === ACT_NAME, await nameBox.inputValue());

      // Open Email Studio: the studio's heading, and at this width the panel stays open beside it.
      await group.getByRole('button', { name: labels1[2], exact: true }).click();
      await studioHeading.waitFor({ state: 'visible', timeout: 15000 });
      check(`${tag}: "${labels1[2]}" switched the view: Email Studio's heading is shown`, await studioHeading.isVisible());
      sawText('Email Studio & E-Commerce Flows');
      check(`${tag}: its button became "${COPY['action.done.open']}"`, await group.getByText(COPY['action.done.open'], { exact: true }).isVisible());
      check(`${tag}: the panel stays open over the studio`, await panel.isVisible());
      check(`${tag}: all three ran once, and no button is left on that answer`, (await group.getByRole('button').count()) === 0);

      // A second answer while Email Studio shows: the first answer's actions keep their results as lines.
      await input.fill('Add steps to my journeys.');
      await page.keyboard.press('Enter');
      await log.getByText(SECOND_TEXT, { exact: true }).waitFor({ state: 'visible' });
      check(`${tag}: prose and a json5 fence around the reply never reach the log`, (await log.getByText(/json5|"answer"/).count()) === 0);
      const groups = panel.getByRole('group', { name: COPY['action.group'], exact: true });
      check(`${tag}: one action group, under the newest answer`, (await groups.count()) === 1);
      for (const line of [addedText, renamedText, COPY['action.done.open']]) {
        check(`${tag}: the older answer keeps "${line}" as its result, not a suggestion`, (await log.getByText(line, { exact: true }).count()) === 1);
      }
      for (const label of labels1) check(`${tag}: no "${COPY['action.suggested']} ${label}" line and no button for it`, (await log.getByText(`${COPY['action.suggested']} ${label}`, { exact: true }).count()) === 0 && (await panel.getByRole('button', { name: label, exact: true }).count()) === 0);
      const labels2 = labelsOf(second);
      for (const label of labels2) check(`${tag}: the newest answer offers "${label}"`, await groups.getByRole('button', { name: label, exact: true }).isVisible());
      // The open journey's own step, pressed while its map is not on screen, runs nothing.
      await groups.getByRole('button', { name: labels2[1], exact: true }).click();
      await page.waitForTimeout(300);
      const warnLines = groups.getByText(COPY['action.notOpen'], { exact: true });
      check(`${tag}: "${labels2[1]}" pressed on Email Studio says "${COPY['action.notOpen']}"`, (await warnLines.count()) === 1);
      sawText(COPY['action.notOpen']);
      check(`${tag}: and it is a warning, not a failure`, /jv-assistant-action-line--warn/.test(await warnLines.first().getAttribute('class')) && (await warnLines.first().evaluate(el => getComputedStyle(el).color)) === 'rgb(253, 230, 138)');
      await groups.getByRole('button', { name: labels2[0], exact: true }).click();
      await page.waitForTimeout(300);
      check(`${tag}: "${labels2[0]}", a journey that is not open, says it too`, (await warnLines.count()) === 2);
      await groups.getByRole('button', { name: labels2[2], exact: true }).click();
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
      await page.waitForTimeout(300);
      check(`${tag}: "${labels2[2]}" brought the map back, and Email Studio is gone`, (await studioHeading.count()) === 0 && (await nodesOf(page)) > 0);
      check(`${tag}: neither step was added: the map has the steps it started with`, (await nodesOf(page)) === before, `${before} then ${await nodesOf(page)}`);

      // A third answer: Open attribution, then the open journey's step on Attribution runs nothing.
      await input.fill('Show me attribution.');
      await page.keyboard.press('Enter');
      await log.getByText(THIRD_TEXT, { exact: true }).waitFor({ state: 'visible' });
      const labels3 = labelsOf(third);
      await groups.getByRole('button', { name: labels3[0], exact: true }).click();
      await attributionHeading.waitFor({ state: 'visible', timeout: 15000 });
      check(`${tag}: "${labels3[0]}" shows Attribution`, await attributionHeading.isVisible());
      await groups.getByRole('button', { name: labels3[1], exact: true }).click();
      await page.waitForTimeout(300);
      check(`${tag}: "${labels3[1]}" pressed on Attribution says "${COPY['action.notOpen']}"`, (await groups.getByText(COPY['action.notOpen'], { exact: true }).count()) === 1);
      // A fourth answer: the third's action that never ran is a suggestion, the two that ran are results.
      await input.fill('Anything else?');
      await page.keyboard.press('Enter');
      await log.getByText(FOURTH_TEXT, { exact: true }).waitFor({ state: 'visible' });
      const unrun = `${COPY['action.suggested']} ${labels3[2]}`;
      check(`${tag}: an older action that never ran reads "${unrun}"`, await log.getByText(unrun, { exact: true }).isVisible());
      sawText(unrun);
      check(`${tag}: and no button is left anywhere`, (await panel.locator('.jv-assistant-action').count()) === 0);
      await page.getByRole('button', { name: 'Funnel Canvas', exact: true }).first().click();
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
      await page.waitForTimeout(300);
      check(`${tag}: back on the map, no step was added on Attribution`, (await nodesOf(page)) === before, `${before} then ${await nodesOf(page)}`);
      check(`${tag}: four questions were asked in all`, asks() === 4);
      await page.screenshot({ path: path.join(shots, `actions-${viewport.width}.png`) });
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));

      // A reload reads the stored answers back: their actions are lines, never buttons, and nothing runs.
      await page.reload();
      await page.waitForSelector('.react-flow__node', { timeout: 20000 });
      await page.waitForTimeout(500);
      const reloaded = await nodesOf(page);
      await page.locator('.jv-assistant-bubble').click();
      await panel.getByRole('log').getByText(THIRD_TEXT, { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
      check(`${tag}: after a reload the thread was read back, its newest answer one with actions`, calls.filter(c => c.key === 'GET /api/ai/assistant/thread').length === 2 && (await panel.locator('.jv-assistant-msg--assistant').last().getByText(THIRD_TEXT, { exact: true }).count()) === 1);
      check(`${tag}: after a reload no answer offers a button`, (await panel.locator('.jv-assistant-action').count()) === 0 && (await panel.getByRole('group', { name: COPY['action.group'], exact: true }).count()) === 0);
      for (const label of [labels1[0], labels2[1], labels3[1]]) {
        check(`${tag}: after a reload "${label}" is the line "${COPY['action.suggested']} ${label}"`, await panel.getByText(`${COPY['action.suggested']} ${label}`, { exact: true }).isVisible());
      }
      check(`${tag}: and the map has the same steps`, (await nodesOf(page)) === reloaded && reloaded === before, `${before}, ${reloaded}`);
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  // ---- The sheet (under 720px): a successful add-step or open closes it; rename stays; nothing hides the sheet's head or box ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const tag = `actions ${viewport.width}x${viewport.height}`;
    say(tag);
    const name = viewport.width === 320 ? ACT_LONG_NAME : ACT_NAME;
    const first = firstFor(name);
    const labels1 = labelsOf(first);
    const { stub, refusals } = makeStub((key, n) => {
      if (key === 'GET /api/ai/assistant/thread') return json(200, THREAD);
      if (key === 'POST /api/ai/assistant/ask') return json(200, first);
      return json(404, { success: false });
    });
    const { context, page, consoleErrors } = await openPage(browser, {
      origin, viewport, path: '/canvas', stub, scriptedRefusals: refusals, seed: { ...project, name }, signedIn: signedInUserFixture(apiKey, Date.now()), stubFunnel: false
    });
    try {
      await page.waitForSelector('.react-flow__node', { timeout: 20000 });
      await page.waitForTimeout(500);
      const before = await nodesOf(page);
      check(`${tag}: before the sheet opens the mobile nav trigger is shown`, await triggerShown(page));
      const bubble = page.locator('.jv-assistant-bubble');
      const panel = page.locator('.jv-assistant-panel');
      await bubble.click();
      await panel.waitFor({ state: 'visible' });
      const input = panel.getByLabel(COPY['input.label'], { exact: true });
      await input.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(350);
      const title = await onTop(page, '.jv-assistant-panel .jv-assistant-title');
      check(`${tag}: the sheet's title is the element at its own point (the toolbar row no longer covers it)`, title.onTop, JSON.stringify(title));
      const closeBtn = await onTop(page, '.jv-assistant-panel button[aria-label="Close"]');
      check(`${tag}: Close is the element at its own point`, closeBtn.onTop, JSON.stringify(closeBtn));
      check(`${tag}: <html> says the sheet is open`, await page.evaluate(() => document.documentElement.hasAttribute('data-jv-sheet-open')));
      check(`${tag}: the mobile nav trigger is hidden while the sheet is open`, !(await triggerShown(page)));
      const hint = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.jv-assistant-panel .jv-assistant-meta span')].find(s => s.textContent.startsWith('Enter sends'));
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        // The right end of the hint, where the trigger sat.
        const hit = document.elementFromPoint(Math.min(r.right - 4, innerWidth - 2), r.top + r.height / 2);
        return { found: true, onTop: !!hit && (hit === el || el.contains(hit) || hit.contains(el)), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
      });
      check(`${tag}: the question box hint is not covered at its right end`, hint.onTop, JSON.stringify(hint));
      await input.fill('Add a landing page, rename this journey and open Email Studio.');
      await page.keyboard.press('Enter');
      await panel.getByRole('log').getByText(FIRST_TEXT, { exact: true }).waitFor({ state: 'visible' });
      const group = panel.getByRole('group', { name: COPY['action.group'], exact: true });
      if (viewport.width === 320) {
        // The sheet at 320px: every button inside it, at least 44px tall, its label wrapped, not cut.
        const geo = await page.evaluate(() => {
          const p = document.querySelector('.jv-assistant-panel').getBoundingClientRect();
          const bs = [...document.querySelectorAll('.jv-assistant-actions button')].map(b => {
            const r = b.getBoundingClientRect();
            return { left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), overflow: b.scrollWidth > b.clientWidth + 1, text: b.textContent };
          });
          return { panel: { left: Math.round(p.left), right: Math.round(p.right) }, bs, vw: innerWidth };
        });
        check(`${tag}: each action button sits inside the sheet`, geo.bs.length === 3 && geo.bs.every(b => b.left >= geo.panel.left && b.right <= geo.panel.right && b.right <= geo.vw), JSON.stringify(geo));
        check(`${tag}: each action button is at least 44px tall`, geo.bs.every(b => b.h >= 44), JSON.stringify(geo.bs.map(b => b.h)));
        check(`${tag}: no label runs out of its button (it wraps)`, geo.bs.every(b => !b.overflow), JSON.stringify(geo.bs));
        const longest = geo.bs.reduce((a, b) => (b.text.length > a.text.length ? b : a), geo.bs[0] || { h: 0, text: '' });
        check(`${tag}: the longest label wraps onto more than one line`, longest.h > 50, JSON.stringify(longest));
      }
      // Add a step: the sheet closes, the new step is on screen and has focus, and the result is said outside.
      await group.getByRole('button', { name: labels1[0], exact: true }).click();
      await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      check(`${tag}: a successful add-step closes the sheet`, !(await panel.isVisible()));
      check(`${tag}: one more step on the map`, (await nodesOf(page)) === before + 1, `${before} then ${await nodesOf(page)}`);
      const onCard = await page.waitForFunction(() => !!document.activeElement?.closest?.('.react-flow__node'), null, { timeout: 3000 }).then(() => true, () => false);
      check(`${tag}: focus is on the new step`, onCard, JSON.stringify(await focusInfo(page)));
      const cardSeen = await page.evaluate(() => {
        const card = document.activeElement?.closest?.('.react-flow__node');
        if (!card) return { found: false };
        const r = card.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        return { found: true, visible: !!hit && card.contains(hit), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
      });
      check(`${tag}: and the focused step is not behind the sheet: it is the element at its own centre`, cardSeen.visible, JSON.stringify(cardSeen));
      const said = await page.waitForFunction(() => [...document.querySelectorAll('span.jv-assistant-sr[role="status"]')].some(s => !s.closest('.jv-assistant-panel') && s.textContent.startsWith('Added a landing page step.')), null, { timeout: 3000 }).then(() => true, () => false);
      check(`${tag}: the result is said by the status outside the closed sheet`, said, await outsideSaid(page));
      check(`${tag}: with the sheet closed <html> no longer says it is open, and the trigger is back`, !(await page.evaluate(() => document.documentElement.hasAttribute('data-jv-sheet-open'))) && (await triggerShown(page)));
      // Rename: the sheet stays open and focus goes to the line.
      await bubble.click();
      await panel.waitFor({ state: 'visible' });
      check(`${tag}: reopened, the add-step's line is in place of its button`, await group.getByText('Added a landing page step. Undo is in the editor toolbar.', { exact: true }).isVisible());
      await group.getByRole('button', { name: labels1[1], exact: true }).click();
      await group.getByText(`Renamed to "${ACT_RENAME}". Undo is in the editor toolbar.`, { exact: true }).waitFor({ state: 'visible' });
      const onLine = await page.waitForFunction(() => document.activeElement?.hasAttribute('data-action-line') === true, null, { timeout: 2000 }).then(() => true, () => false);
      check(`${tag}: a rename keeps the sheet open with focus on its line`, (await panel.isVisible()) && onLine, JSON.stringify(await focusInfo(page)));
      // Open Email Studio: the sheet closes and the studio's heading takes focus.
      await group.getByRole('button', { name: labels1[2], exact: true }).click();
      const studio = page.getByRole('heading', { level: 1, name: /Email Studio/ });
      await studio.waitFor({ state: 'visible', timeout: 15000 });
      await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      check(`${tag}: a successful open closes the sheet`, !(await panel.isVisible()));
      const onHeading = await page.waitForFunction(() => document.activeElement?.tagName === 'H1' && /Email Studio/.test(document.activeElement.textContent), null, { timeout: 5000 }).then(() => true, () => false);
      check(`${tag}: focus is on Email Studio's main heading`, onHeading, JSON.stringify(await focusInfo(page)));
      await page.screenshot({ path: path.join(shots, `actions-${viewport.width}.png`) });
      check(`${tag}: no console error`, consoleErrors.length === 0, consoleErrors.join(' | '));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      await page.screenshot({ path: path.join(shots, `failed-${tag.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  // ---- A short window under 720px: the conversation keeps room ----
  {
    const viewport = { width: 640, height: 400 };
    const tag = `actions ${viewport.width}x${viewport.height}`;
    say(tag);
    const { stub, refusals } = makeStub(key => (key === 'GET /api/ai/assistant/thread' ? json(200, THREAD) : json(404, { success: false })));
    const { context, page } = await openPage(browser, { origin, viewport, path: '/canvas', stub, scriptedRefusals: refusals, seed: { ...project, name: ACT_NAME }, signedIn: signedInUserFixture(apiKey, Date.now()), stubFunnel: false });
    try {
      await page.waitForSelector('.react-flow__node', { timeout: 20000 });
      await page.locator('.jv-assistant-bubble').click();
      const panel = page.locator('.jv-assistant-panel');
      await panel.getByLabel(COPY['input.label'], { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(350);
      const m = await page.evaluate(() => ({ body: document.querySelector('.jv-assistant-body').clientHeight, panel: Math.round(document.querySelector('.jv-assistant-panel').getBoundingClientRect().height), vh: innerHeight }));
      check(`${tag}: the conversation keeps at least 100px (it was 32px)`, m.body >= 100, JSON.stringify(m));
      check(`${tag}: and the sheet stays inside the window`, m.panel <= m.vh, JSON.stringify(m));
    } catch (err) {
      findings.push(`${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
      say(`  FAIL ${tag}: could not run (${String(err?.message || err).split('\n')[0]})`);
    } finally {
      await context.close();
    }
  }
}

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
  await actionsInApp(browser, origin, shots, DEFAULT_LEAD_CAPTURE_PROJECT);
  await harness(browser, harnessOrigin, shots);
  await screens(browser, harnessOrigin, shots);

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
