#!/usr/bin/env node
// Draft this email with AI in a real browser (ASK_JOURVANCE_PLAN.md, Wave 3, W3.B).
// email-draft.test.mjs renders the control's markup and drives its drafting session in node; this
// loads the BUILT app, served by server.mjs itself, in headless Chrome and asserts on what it shows.
//
// Boot 1, hub off (HUB_API_KEY empty): the route over HTTP (401, 400, 503); in the browser the
//   composer's control and its name, the count and "Too long.", the refusal line clearing as the brief
//   comes back under 300, the 503 sentence inside the form card with no Retry; a stubbed draft at
//   1280, 768, 390 and 320 wide, where Keep must be the element at its own centre (never the
//   composer's fixed Save and Send bar) once the proposal arrives, after Playwright scrolls it into
//   view, and after Tab reaches it; Keep keeping a typed preview when the draft has none and adding
//   the paragraphs; Discard; Stop with a reply that lands afterwards; a reply that lands after the
//   broadcast was replaced by a written draft; the flow editor's email step; and the AI Polish card
//   in the sequence drawer at 320, which renders without the grounding line (it wrapped there).
// Boot 2, a loopback stub hub (HUB_URL on 127.0.0.1, AI_COPY_PER_HOUR=3): the preview cap (a
//   150 character preview comes back at most 140, and the kept draft saves), the scrub (a template
//   tag and a link never come back), the hourly 429 with Retry-After, the Security Sentinel's 429
//   with no wait, and in the browser the Sentinel's line with no Retry.
//
// Safety: the check copies the files git tracks or would track (never .env, never a gitignored data
// file) to a temp dir, links node_modules, builds there, and boots server.mjs there with a minimal
// environment, so no hub key and no local data are in reach. The browser can reach only that server;
// it cannot sign in to Firebase, so the check adds the development bearer `dev-test-token` (accepted
// only when NODE_ENV is not production) to the /api calls it lets through. server.mjs does not exit
// on its first SIGTERM (hub-storage.mjs flushes and keeps running), so each boot is ended with
// SIGKILL to its process group and the port is checked closed. The temp dir is removed on exit.
//
// Env: CHROME_PATH, PLAYWRIGHT_MODULE. Exit 0 every assertion passed, 1 a finding, 2 the check
// could not run.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const say = (line) => console.log(line);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UNAVAILABLE = 'AI drafting is not set up on this server. Write the email yourself.';
const TOO_MANY = 'Too many requests from this connection. Wait a minute and try again.';
const BRIEF_PROBLEM = 'Describe the email in up to 300 characters.';
const STOPPED = 'Stopped. Nothing was drafted.';
const PROPOSAL_LINE = 'Draft. Not in your email yet.';
const TOGGLE = 'Draft this email with AI';
const DRAFT = { subject: 'Spring glaze class is open', paragraphs: ['Our spring glaze class is open for booking.', 'Seats are on the class page.'], cta: { label: 'Book a seat' } };

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

const listening = (port) => new Promise((r) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); r(true); });
  s.once('error', () => r(false));
});

/** The files git tracks or would track, copied to `work`, with node_modules linked. */
function copyRepo(work) {
  const listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean);
  for (const rel of listed) {
    if (rel.startsWith('node_modules/')) continue;
    const from = path.join(ROOT, rel);
    let stat;
    try { stat = fs.lstatSync(from); } catch { continue; }
    if (!stat.isFile()) continue;
    const to = path.join(work, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(work, 'node_modules'), 'dir');
}

const children = [];
function killAll() {
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}

async function boot(work, env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: work,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NODE_ENV: 'development', ...env }
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try { up = (await fetch(`${base}/api/health`)).ok; } catch {}
    if (!up) await sleep(200);
  }
  if (!up) throw new Error(`server.mjs did not answer /api/health. Log tail: ${log.split('\n').slice(-5).join(' | ')}`);
  return {
    base,
    port,
    log: () => log,
    stop: async () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      let open = true;
      for (let i = 0; i < 25 && open; i++) { open = await listening(port); if (open) await sleep(200); }
      return !open;
    }
  };
}

const post = async (base, body, token = 'dev-test-token', route = '/api/ai/email-draft') => {
  const r = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => ({})) };
};

/** A browser context that reaches only `base`, with the dev bearer on /api, and an optional draft stub. */
async function openContext(browser, base, viewport, { draft = null, delay = 0, pageErrors, sent }) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin !== base) return route.abort();
    if (u.pathname === '/api/ai/email-draft') {
      sent.push(req.postDataJSON());
      if (draft) {
        if (delay) await sleep(delay);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, draft, grounding: 'account', source: 'hub-brain' }) }).catch(() => {});
      }
    }
    if (u.pathname.startsWith('/api/')) return route.continue({ headers: { ...req.headers(), authorization: 'Bearer dev-test-token' } });
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).split('\n')[0]));
  page.on('dialog', (d) => d.accept());
  return { context, page };
}

async function openComposer(page, base) {
  await page.goto(`${base}/canvas`);
  await page.getByRole('button', { name: /Email Studio/ }).first().click();
  await page.getByRole('tab', { name: /Broadcasts/ }).first().click();
  const newTab = page.getByRole('tab', { name: 'New broadcast', exact: true });
  if (await newTab.count()) await newTab.click();
  else await page.getByRole('button', { name: /New broadcast/ }).first().click();
  const section = page.locator('section[aria-labelledby="bc-h-email"]');
  await section.waitFor({ state: 'visible' });
  return section;
}

/** True when `locator` is the element at its own centre: nothing (the fixed Save and Send bar) is drawn over it. */
const onTop = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { ok: !!hit && (hit === el || el.contains(hit)), by: hit ? (hit.textContent || hit.tagName).trim().slice(0, 30) : null, y: Math.round(r.y), vh: innerHeight };
});

const statusIn = (section) => section.locator('[data-email-draft-form] [data-email-draft-status]');

async function hubOff(browser, work) {
  say('boot 1: hub off');
  const server = await boot(work, { HUB_API_KEY: '' });
  const pageErrors = [];
  try {
    const health = await fetch(`${server.base}/api/health`);
    const h = await health.json();
    check('GET /api/health is 200 and the hub is not configured', health.status === 200 && h.hubConfigured === false, JSON.stringify(h));
    const noToken = await post(server.base, { kind: 'broadcast', brief: 'Spring class is open.' }, '');
    check('no token: 401', noToken.status === 401, String(noToken.status));
    const badKind = await post(server.base, { kind: 'newsletter', brief: 'Spring class is open.' });
    check('a bad kind: 400 "Say whether this is a broadcast or a flow step."', badKind.status === 400 && badKind.body.error === 'Say whether this is a broadcast or a flow step.', JSON.stringify(badKind));
    const off = await post(server.base, { kind: 'broadcast', brief: 'Spring class is open.' });
    check('hub off: 503 with its sentence, not retryable', off.status === 503 && off.body.error === UNAVAILABLE && off.body.retryable === false, JSON.stringify(off));

    // ---- A: the control against the real server ----
    say('browser A: the composer, hub off, 1280 wide');
    {
      const sent = [];
      const { context, page } = await openContext(browser, server.base, { width: 1280, height: 900 }, { pageErrors, sent });
      const section = await openComposer(page, server.base);
      const toggle = section.getByRole('button', { name: TOGGLE, exact: true });
      check(`the composer names the control "${TOGGLE}"`, await toggle.isVisible());
      check('it starts collapsed', (await toggle.getAttribute('aria-expanded')) === 'false');
      await toggle.click();
      check('opened, aria-expanded is "true"', (await toggle.getAttribute('aria-expanded')) === 'true');
      const brief = section.getByLabel('What should this email say?');
      const fonts = await brief.evaluate((el) => ({ box: getComputedStyle(el).fontFamily, page: getComputedStyle(el.closest('section')).fontFamily }));
      check('the brief box uses the page font, not monospace', fonts.box === fonts.page && !/monospace/i.test(fonts.box), JSON.stringify(fonts));
      check('the count reads "0 of 300 characters"', await section.getByText('0 of 300 characters', { exact: true }).isVisible());
      await brief.fill('x'.repeat(301));
      check('over 300 the count says so in words: "301 of 300 characters. Too long."', await section.getByText('301 of 300 characters. Too long.', { exact: true }).isVisible());
      await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
      check(`over 300 the status line in the form says "${BRIEF_PROBLEM}"`, (await statusIn(section).textContent()) === BRIEF_PROBLEM, await statusIn(section).textContent());
      check('over 300 nothing was sent', sent.length === 0);
      await brief.fill('x'.repeat(300));
      check('the refusal line clears as soon as the brief is back to 300', (await statusIn(section).textContent()) === '', await statusIn(section).textContent());
      await brief.fill('Tell regulars the spring glaze class is open for booking.');
      await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
      await page.waitForFunction((t) => document.querySelector('[data-email-draft-form] [data-email-draft-status]')?.textContent === t, UNAVAILABLE).catch(() => {});
      check('hub off, the 503 sentence is said inside the form card', (await statusIn(section).textContent()) === UNAVAILABLE, await statusIn(section).textContent());
      check('the request reached the real route as a broadcast', sent.length === 1 && sent[0]?.kind === 'broadcast');
      check('a refusal Retry cannot change offers no Retry', (await section.getByRole('button', { name: /^Retry/ }).count()) === 0);
      await context.close();
    }

    // ---- B: a stubbed draft at four widths: Keep is never under the fixed bar ----
    for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 800 }, { width: 320, height: 800 }]) {
      const tag = `browser B ${viewport.width}`;
      say(`${tag}: a stubbed draft with no preview text`);
      const sent = [];
      const { context, page } = await openContext(browser, server.base, viewport, { draft: DRAFT, pageErrors, sent });
      try {
        const section = await openComposer(page, server.base);
        const subject = section.getByLabel('Subject', { exact: true });
        const preview = section.getByLabel('Preview text', { exact: true });
        await subject.fill('My own subject');
        await preview.fill('My own preview');
        const blocks = page.getByRole('group', { name: 'Email content' }).getByRole('button', { name: 'Remove', exact: true });
        const startBlocks = await blocks.count();
        await section.getByRole('button', { name: TOGGLE, exact: true }).click();
        await section.getByLabel('What should this email say?').fill('Tell regulars the spring glaze class is open.');
        await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
        const region = section.getByRole('region', { name: 'Email draft' });
        await region.waitFor({ state: 'visible' });
        await page.waitForTimeout(250);
        const keep = region.getByRole('button', { name: 'Keep', exact: true });
        const order = await region.evaluate((el) => {
          const text = el.textContent || '';
          return [text.indexOf('Draft. Not in your email yet.'), text.indexOf('Keep'), text.indexOf('Discard'), text.indexOf('Subject')];
        });
        check(`${tag}: the proposal opens with "${PROPOSAL_LINE}", then Keep and Discard, then the subject`, order[0] === 0 && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], JSON.stringify(order));
        check(`${tag}: focus moved to the proposal`, await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Email draft'));
        let top = await onTop(keep);
        check(`${tag}: once the proposal arrives, Keep is the element at its own centre`, top.ok, JSON.stringify(top));
        await keep.scrollIntoViewIfNeeded();
        top = await onTop(keep);
        check(`${tag}: after Playwright scrolls Keep into view, nothing covers it`, top.ok, JSON.stringify(top));
        await region.focus();
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
        top = await onTop(keep);
        check(`${tag}: Tab from the proposal reaches Keep, and nothing covers it`, focused === 'Keep' && top.ok, JSON.stringify({ focused, ...top }));
        if (viewport.width === 1280) {
          await region.getByRole('button', { name: 'Discard', exact: true }).click();
          check('Discard says "Discarded the draft. Nothing in the email changed."', (await statusIn(section).textContent()) === 'Discarded the draft. Nothing in the email changed.');
          check('after Discard the email is as it was', (await subject.inputValue()) === 'My own subject' && (await blocks.count()) === startBlocks);
          await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
          await region.waitFor({ state: 'visible' });
          await region.getByRole('button', { name: 'Keep', exact: true }).click();
          await page.waitForTimeout(150);
          check(`Keep fills the subject "${DRAFT.subject}"`, (await subject.inputValue()) === DRAFT.subject, await subject.inputValue());
          check('Keep leaves the preview the person typed when the draft has none', (await preview.inputValue()) === 'My own preview', await preview.inputValue());
          check('Keep appends the two paragraphs and the button', (await blocks.count()) === startBlocks + 3, `${startBlocks} then ${await blocks.count()}`);
          const said = await section.locator('[data-email-draft-after]').textContent();
          check('Keep says what it did without claiming the preview, under the button once the form closes', said?.startsWith('Filled in the subject, and added 2 paragraphs and a button at the end of the email.') === true, said);
          check('focus returns to the control', await page.evaluate((t) => document.activeElement?.textContent?.trim() === t, TOGGLE));
        }
      } catch (err) {
        check(`${tag}: could run`, false, String(err?.message || err).split('\n')[0]);
      } finally {
        await context.close();
      }
    }

    // ---- C: Stop, with the reply landing afterwards ----
    say('browser C: Stop, 1280 wide');
    {
      const sent = [];
      const { context, page } = await openContext(browser, server.base, { width: 1280, height: 900 }, { draft: DRAFT, delay: 2500, pageErrors, sent });
      try {
        const section = await openComposer(page, server.base);
        await section.getByRole('button', { name: TOGGLE, exact: true }).click();
        await section.getByLabel('What should this email say?').fill('Tell regulars the spring glaze class is open.');
        await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
        const stop = section.getByRole('button', { name: 'Stop', exact: true });
        await stop.waitFor({ state: 'visible' });
        check('while it writes, the status line is inside the form card', (await statusIn(section).textContent()) === 'Writing a draft. It can take up to a minute.');
        await stop.click();
        check(`Stop says "${STOPPED}"`, (await statusIn(section).textContent()) === STOPPED);
        check('Stop hands focus to Write a draft', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Write a draft'));
        await page.waitForTimeout(3200);
        check('the reply that lands after Stop is dropped: still stopped, no proposal', (await statusIn(section).textContent()) === STOPPED && (await section.getByRole('region', { name: 'Email draft' }).count()) === 0, await statusIn(section).textContent());
      } catch (err) {
        check('browser C: could run', false, String(err?.message || err).split('\n')[0]);
      } finally {
        await context.close();
      }
    }

    // ---- D: the broadcast is replaced while a draft is being written ----
    say('browser D: a written draft replaces the broadcast mid-request, 1280 wide');
    {
      const sent = [];
      const { context, page } = await openContext(browser, server.base, { width: 1280, height: 900 }, { draft: DRAFT, delay: 2500, pageErrors, sent });
      try {
        const section = await openComposer(page, server.base);
        await section.getByRole('button', { name: TOGGLE, exact: true }).click();
        await section.getByLabel('What should this email say?').fill('Tell regulars the spring glaze class is open.');
        await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
        await section.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'visible' });
        await section.locator('summary', { hasText: 'Start from a written draft' }).click();
        await section.getByRole('button', { name: 'VIP thank-you', exact: true }).click();
        await page.waitForTimeout(3200);
        const subject = await section.getByLabel('Subject', { exact: true }).inputValue();
        check('the written draft is in the email', subject === 'A thank-you to our most loyal clients', subject);
        check('the reply for the replaced broadcast is dropped: no proposal', (await section.getByRole('region', { name: 'Email draft' }).count()) === 0);
        check('the control starts fresh for the new email', (await section.getByRole('button', { name: TOGGLE, exact: true }).getAttribute('aria-expanded')) === 'false');
      } catch (err) {
        check('browser D: could run', false, String(err?.message || err).split('\n')[0]);
      } finally {
        await context.close();
      }
    }

    // ---- E: the flow editor's email step ----
    say('browser E: a flow email step, 1280 wide');
    {
      const sent = [];
      const { context, page } = await openContext(browser, server.base, { width: 1280, height: 900 }, { pageErrors, sent });
      try {
        await page.goto(`${server.base}/canvas`);
        await page.getByRole('button', { name: /Email Studio/ }).first().click();
        await page.getByRole('tab', { name: 'Flow map', exact: true }).click();
        const steps = page.locator('ol[data-flow-steps] button');
        await steps.first().waitFor({ state: 'visible' });
        const names = await steps.allTextContents();
        const at = names.findIndex((n) => /^Email/i.test(n.trim()));
        check('the flow map lists an email step', at >= 0, JSON.stringify(names.slice(0, 5)));
        if (at >= 0) {
          await steps.nth(at).click();
          const panel = page.locator('[data-flow-map="panel"]');
          const toggle = panel.getByRole('button', { name: TOGGLE, exact: true });
          await toggle.waitFor({ state: 'visible' });
          check('the email step shows the control', await toggle.isVisible());
          await toggle.click();
          await panel.getByLabel('What should this email say?').fill('Thank them for joining.');
          await panel.getByRole('button', { name: 'Write a draft', exact: true }).click();
          await page.waitForFunction((t) => document.querySelector('[data-flow-map="panel"] [data-email-draft-status]')?.textContent === t, UNAVAILABLE).catch(() => {});
          const said = await panel.locator('[data-email-draft-status]').textContent();
          check('the flow step says the 503 sentence', said === UNAVAILABLE, said);
          check('it sent one flow-step request with the flow’s trigger', sent.length === 1 && sent[0]?.kind === 'flow-step' && typeof sent[0]?.flowTrigger === 'string' && sent[0].flowTrigger !== '', JSON.stringify(sent));
        }
      } catch (err) {
        check('browser E: could run', false, String(err?.message || err).split('\n')[0]);
      } finally {
        await context.close();
      }
    }

    // ---- F: the AI Polish card carries no grounding line ----
    // The plan put the line on this card only if it fits one line. "Uses your business profile, when
    // the AI has it." wrapped to two lines (34.8px at a 17.4px line) in the drawer at 320 wide, so it
    // was taken off the card; this keeps it off while the card itself still renders.
    const { signedInUserFixture, firebaseApiKeyFrom } = await import(pathToFileURL(path.join(ROOT, 'src/lib/canvasCheckRules.ts')).href);
    const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/defaultBlueprint.ts')).href);
    const { GROUNDING_ACCOUNT } = await import(pathToFileURL(path.join(ROOT, 'src/lib/emailDraft.ts')).href);
    const apiKey = firebaseApiKeyFrom(fs.readFileSync(path.join(ROOT, 'src/lib/firebase.ts'), 'utf8'));
    {
      const tag = 'browser F 320';
      const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
      try {
        await context.route('**/*', (route) => {
          const u = new URL(route.request().url());
          if (u.origin !== server.base) return route.abort();
          if (u.pathname === '/api/ai/copy') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, source: 'hub-brain', grounding: 'account', copy: { subject: 'A small thing before your first class', preview: 'Pick a time that suits you.', body: 'Thanks for joining us. Here is how to choose your first session.' } }) });
          }
          if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, journey: null }) });
          return route.continue();
        });
        const user = signedInUserFixture(apiKey, Date.now());
        const project = { ...DEFAULT_LEAD_CAPTURE_PROJECT, updatedAt: new Date().toISOString() };
        await context.addInitScript(([k, v, uk, uv]) => {
          if (sessionStorage.getItem('jv-email-draft-seeded')) return;
          sessionStorage.setItem('jv-email-draft-seeded', '1');
          localStorage.clear();
          localStorage.setItem(k, v);
          localStorage.setItem(uk, uv);
        }, ['jourvance_active_project', JSON.stringify(project), user.key, JSON.stringify(user.value)]);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).split('\n')[0]));
        await page.goto(`${server.base}/canvas`);
        await page.waitForSelector('.react-flow__node', { timeout: 20000 });
        await page.locator('.react-flow__node').filter({ hasText: /sequence|Sequence|Follow/ }).first().click();
        const polish = page.getByRole('button', { name: /AI Polish/ }).first();
        await polish.scrollIntoViewIfNeeded();
        await polish.click();
        const suggested = page.getByText('A small thing before your first class').first();
        await suggested.waitFor({ state: 'visible' }).catch(() => {});
        check(`${tag}: the AI Polish proposal renders`, await suggested.isVisible());
        check(`${tag}: and carries no grounding line, which would wrap here`, (await page.getByText(GROUNDING_ACCOUNT, { exact: true }).count()) === 0);
      } catch (err) {
        check(`${tag}: could run`, false, String(err?.message || err).split('\n')[0]);
      } finally {
        await context.close();
      }
    }
  } finally {
    check('boot 1: no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
    check('boot 1: the port is closed after a SIGKILL to the process group', await server.stop());
  }
}

async function stubHub(browser, work) {
  say('boot 2: a loopback stub hub, AI_COPY_PER_HOUR=3');
  const longPreview = 'Our spring glaze class has a few seats left this week, and we would love to see you at the wheel with your friends and family before the season ends ok';
  const chats = [];
  const stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/brain/chat') {
        chats.push(raw);
        const draft = { subject: 'Spring glaze class is open', previewText: longPreview, paragraphs: ['Hi {{ first_name }}, our class is open.', 'See https://phish.example/book for times.', 'Seats are limited to twelve.'], cta: { label: 'Book a seat' } };
        return res.end(JSON.stringify({ success: true, text: JSON.stringify(draft) }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: 'stub: no such route' }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const server = await boot(work, { HUB_URL: `http://127.0.0.1:${stub.address().port}`, HUB_API_KEY: 'zlk_stub_loopback_only', AI_COPY_PER_HOUR: '3' });
  const pageErrors = [];
  try {
    const first = await post(server.base, { kind: 'broadcast', brief: 'Spring class is open.' });
    check('with the stub hub a draft is 200', first.status === 200 && first.body.source === 'hub-brain', JSON.stringify(first).slice(0, 200));
    check(`a ${longPreview.length} character preview comes back at most 140`, typeof first.body.draft?.previewText === 'string' && first.body.draft.previewText.length <= 140 && first.body.draft.previewText.length > 0, String(first.body.draft?.previewText?.length));
    const text = JSON.stringify(first.body.draft || {});
    check('a template tag and a link never come back', !text.includes('{{') && !text.includes('phish.example') && first.body.draft?.paragraphs?.length === 2, text);
    const blocks = (first.body.draft?.paragraphs || []).map((t, i) => ({ id: `b_k${i}`, kind: 'text', text: t, level: 0 }));
    const saved = await post(server.base, { subject: first.body.draft?.subject, previewText: first.body.draft?.previewText, blocks, settings: {} }, 'dev-test-token', '/api/email/broadcast-drafts');
    check('the kept draft saves as a broadcast draft (no 413 for the preview)', saved.status === 200 && saved.body.success === true, JSON.stringify(saved).slice(0, 200));
    let r;
    for (let i = 0; i < 2; i++) r = await post(server.base, { kind: 'broadcast', brief: 'b' });
    check('calls two and three of the hour are 200', r.status === 200, String(r.status));
    r = await post(server.base, { kind: 'broadcast', brief: 'b' });
    check('the fourth is the hourly 429, naming its wait and with Retry-After', r.status === 429 && r.body.retryAfterSeconds > 0 && Number(r.retryAfter) === r.body.retryAfterSeconds && r.body.retryable === false, JSON.stringify(r));
    let sentinel = null;
    for (let i = 0; i < 40 && !sentinel; i++) {
      r = await post(server.base, { kind: 'broadcast', brief: 'b' });
      if (r.status === 429 && r.body.retryAfterSeconds === undefined) sentinel = r;
    }
    check('within the minute the Security Sentinel answers 429 with no wait named', !!sentinel && !sentinel.retryAfter, JSON.stringify(sentinel));

    say('browser G: the Sentinel limit in the composer, 1280 wide');
    const sent = [];
    const { context, page } = await openContext(browser, server.base, { width: 1280, height: 900 }, { pageErrors, sent });
    try {
      const section = await openComposer(page, server.base);
      await section.getByRole('button', { name: TOGGLE, exact: true }).click();
      await section.getByLabel('What should this email say?').fill('Tell regulars the spring glaze class is open.');
      await section.getByRole('button', { name: 'Write a draft', exact: true }).click();
      await page.waitForFunction((t) => document.querySelector('[data-email-draft-form] [data-email-draft-status]')?.textContent === t, TOO_MANY).catch(() => {});
      check(`the composer says "${TOO_MANY}"`, (await statusIn(section).textContent()) === TOO_MANY, await statusIn(section).textContent());
      check('and offers no Retry', (await section.getByRole('button', { name: /^Retry/ }).count()) === 0);
    } catch (err) {
      check('browser G: could run', false, String(err?.message || err).split('\n')[0]);
    } finally {
      await context.close();
    }
  } finally {
    check('boot 2: no uncaught page error', pageErrors.length === 0, pageErrors.join(' | '));
    check('boot 2: the port is closed after a SIGKILL to the process group', await server.stop());
    stub.close();
  }
}

async function main(cleanup) {
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) { say(`check:email-draft could not run. Playwright was not found at ${pwPath}.`); return 2; }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) { say(`check:email-draft could not run. Chrome was not found at ${chromePath}.`); return 2; }
  const { chromium } = await import(pathToFileURL(pwPath).href);

  // The real path: on macOS the temp dir is under a /var symlink, and Vite refuses an entry it reads
  // as relative to a root it resolved through the link.
  const tmp = fs.realpathSync(os.tmpdir());
  const work = fs.mkdtempSync(path.join(tmp, 'jv-email-draft-check-'));
  const envDir = fs.mkdtempSync(path.join(tmp, 'jv-email-draft-env-'));
  const cacheDir = fs.mkdtempSync(path.join(tmp, 'jv-email-draft-cache-'));
  cleanup.push(work, envDir, cacheDir);
  try {
    copyRepo(work);
  } catch (err) {
    say(`check:email-draft could not run. The repo could not be copied: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  if (fs.existsSync(path.join(work, '.env'))) { say('check:email-draft could not run. The copy holds a .env, so it is not sandboxed.'); return 2; }
  try {
    await build({ root: work, envDir, cacheDir, logLevel: 'error', build: { outDir: path.join(work, 'dist'), emptyOutDir: true } });
  } catch (err) {
    say(`check:email-draft could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    await hubOff(browser, work);
    await stubHub(browser, work);
  } catch (err) {
    say(`check:email-draft could not run: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  } finally {
    await browser.close();
  }
  return findings.length ? 1 : 0;
}

const cleanup = [];
process.on('exit', killAll);
let code = 2;
try {
  code = await main(cleanup);
} catch (err) {
  say(`check:email-draft could not run: ${String(err?.message || err).split('\n')[0]}`);
} finally {
  killAll();
  for (const dir of cleanup) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
say(`Assertions: ${asserted}. Findings: ${findings.length}.`);
for (const f of findings) say(`  finding: ${f}`);
process.exit(code === 0 && findings.length ? 1 : code);
