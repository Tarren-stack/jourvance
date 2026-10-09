#!/usr/bin/env node
// The Email Studio browser check (EMAIL_STUDIO_PLAN.md Wave 1): node scripts/email-studio-browser-check.mjs
//
// What it does, from /canvas, in real Chrome at 1440x900:
//   open             the sidebar's Email Studio opens the studio; its heading is visible
//   counts           the starter cards count their own emails ("Completed all 3 emails", "Completed the
//                    email") and an enrollment reads "Step 1 of 2" for a two-email flow, never a literal 3
//   starter-open     on Automations, "Edit emails" on Welcome sequence: the Flow map tab is active,
//                    Welcome sequence is the chosen flow, its first email is drawn selected, and the
//                    step heading reads "Email 1 of 3" and holds focus
//   email-open       back on Automations, "Email 2 of 3" on the Welcome card (its label also names the
//                    subject): email 2 is selected, on screen, and its subject is in the Subject field
//   node-selected    a click on the Wait node draws it with a border colour an unselected node does not
//                    have, the node stays on screen while focus moves to the step heading, and the panel
//                    shows "Wait, in hours"
//   builder-in-step  on email 1, a new subject and preview text, then "Add image" and "Add button" in
//                    the step panel's builder: both blocks appear
//   save-content     "Unsaved changes" shows; Save, with the stub's answer held: Save reads Saving, the
//                    status says Saving and never Saved until the answer is released; then the stub has
//                    exactly one POST to /api/email/flow-content/drip_seq_default whose email node carries
//                    the new subject, the preview text and both new blocks, the Saved sentence is ON
//                    SCREEN beside a Save that is on screen, stays, and "Unsaved changes" is gone; an edit
//                    after it takes the Saved sentence away and brings "Unsaved changes" back
//   cards-show-edit  on Automations, the Welcome card shows the edited subject
//   built-in         the After the order card has no textarea; its "Edit emails" opens it on the map
//                    with the builder in the step panel
//   account-flow     on Viewed a product, the Email step shows the builder and the advanced options,
//                    and Save posts its blocks to /api/email/flows/flow_viewedproduct
//   save-unanswered  the flow-content request is aborted, and the notice reads
//                    FLOW_MAP_WRITE_UNREACHABLE.content
//   unsaved-kept     with that edit still unsaved, choosing another flow asks first; Cancel keeps the
//                    flow and the edit
//   strip-clears     after Edit emails, the tab strip's Automations then Flow map opens the plain map:
//                    the first flow, nothing selected, not the flow the button asked for
//   keyboard         Tab from the Automations tab reaches "Edit emails", Enter opens the map, and focus
//                    is on the step heading; Enter on a focused step on the map selects it the same way
//   narrow           at 390x844 with the builder open, document.documentElement.scrollWidth is 390, the
//                    studio does not scroll sideways, and no control in it sticks out past either edge
//   no-dash          the studio's visible text and its aria-label, placeholder and title values, read on
//                    every screen above, hold no em dash and no spaced en dash
//   runtime          no uncaught page error
//
// Usage: node scripts/email-studio-browser-check.mjs [--shots <dir>]
// Exit 0 pass, 1 a step failed, 2 could not run (Playwright or Chrome missing, the seeds could not be
// read, the build failed, the port could not be bound).
//
// Safety, as scripts/builder-browser-check.mjs: it never reads .env (Vite's envDir is an empty temp
// dir), never starts server.mjs, sets preview.proxy to {} so the preview forwards nothing, aborts every
// request that leaves the preview origin, builds into a temp dir it removes afterwards, and writes
// nothing inside the repo. It reads server.mjs as TEXT only, for the seeds and chainGraph.
//
// Every /api request the studio makes is answered AT THE ROUTE GUARD with recorded JSON in the real
// routes' shapes: the starter flows are INITIAL_DRIP_SEQUENCES, the built-in flows AUTOMATION_DEFAULTS
// and the order emails TRANSACTIONAL_DEFAULTS, all read out of server.mjs without booting it; the flow
// map rows are drawn by server.mjs's own chainGraph; the account flows are shopify-signals.mjs's
// starter flows and the triggers email-flows.mjs's TRIGGER_META. The flow-content and flows stubs
// record each body and keep what they saved in memory, the way the server keeps it per account. This
// proves the client. The server route is email-flow-content-route.test.mjs's.
//
// Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), CHROME_PATH, CHECK_STUDIO_PORT.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { routeVerdict } from '../src/lib/canvasCheckRules.ts';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../src/lib/defaultBlueprint.ts';
import { FLOW_MAP_WRITE_UNREACHABLE } from '../src/lib/flowMapLoad.ts';
import { TRIGGER_META } from '../email-flows.mjs';
import { signalStarterFlows } from '../shopify-signals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_KEY = 'jourvance_active_project';
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PINK = 'rgb(244, 114, 182)';
const WELCOME = 'drip_seq_default';
const NEW_SUBJECT = 'Welcome, from the studio check';
const NEW_PREVIEW = 'A preview line from the studio check';
const IMAGE_URL = 'https://images.example.test/studio-check.png';
const BUTTON_URL = 'https://shop.example.test/studio-check';
const SAVED_CONTENT = 'Saved. Every email sent from now on uses this version, including for people already in this flow.';
const SAVED_FLOW = 'Saved. It sends only after you turn it on and the queue reaches a due step.';
const SAVING_CONTENT = 'Saving these emails.';
const UNSAVED = 'Unsaved changes';
const UNHEARD_SUBJECT = 'A subject the server never hears about';
/** The step panel's notes on a starter and on a built-in flow (server.mjs STARTER_FLOW_NOTE, BUILT_IN_FLOW_NOTE). */
const STARTER_FLOW_NOTE = 'This starter flow is shared by every account. Your edits to its emails apply to this account only.';
const BUILT_IN_FLOW_NOTE = 'This built-in flow is on this account only. You can edit its emails and waits here. Its steps and what starts it stay fixed. Turn it on or off from Automations.';
/** The flow-content route's refusals (EMAIL_STUDIO_PLAN.md Wave 1, item 3). */
const NOT_ON_ACCOUNT = 'That flow is not on this account.';
const STEPS_CHANGED = "These emails could not be saved, because the flow's steps changed. Reload it and try again.";

const say = line => console.log(line);

// ---- The seeds, read out of server.mjs as text (the way seeded-offers.test.mjs reads them) ----

function readSeeds() {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const literal = name => {
    const start = src.indexOf(`const ${name} = [`);
    const end = src.indexOf('\n];\n', start);
    if (start < 0 || end < start) throw new Error(`server.mjs does not define ${name}`);
    return src.slice(src.indexOf('[', start), end + 2);
  };
  const fn = name => {
    const start = src.indexOf(`function ${name}(`);
    const end = src.indexOf('\nfunction ', start + 1);
    if (start < 0 || end < start) throw new Error(`server.mjs does not define function ${name}`);
    return src.slice(start, end);
  };
  // server.mjs block(): the only helper the two program seeds call.
  const block = (id, kind, text, extra) => ({ id, kind, text: text || '', ...(extra || {}) });
  const sequences = new Function(`return ${literal('INITIAL_DRIP_SEQUENCES')}`)().filter(seq => !seq.userId);
  const automations = new Function('block', `return ${literal('AUTOMATION_DEFAULTS')}`)(block);
  const transactional = new Function('block', `return ${literal('TRANSACTIONAL_DEFAULTS')}`)(block);
  const chainGraph = new Function(`${fn('chainGraph')}\nreturn chainGraph;`)();
  if (!sequences.some(seq => seq.id === WELCOME)) throw new Error(`the seeds have no ${WELCOME}`);
  return { sequences, automations, transactional, chainGraph };
}

// ---- Recorded answers for the studio's routes ----

/** server.mjs cleanSteps, for a seed that has not been edited: the shape the bag holds. */
const programSteps = steps => steps.map((step, i) => ({
  id: String(step.id || `step_${i + 1}`),
  delayHours: Math.max(0, Math.min(2160, Number(step.delayHours) || 0)),
  subject: String(step.subject || 'A note from the store'),
  previewText: String(step.previewText || ''),
  blocks: step.blocks
}));

/** The account's memory: what each stub saved, and what each write carried. */
function newState(seeds) {
  const flows = signalStarterFlows().map(flow => ({ ...flow, enabled: false }));
  return {
    seeds,
    accountSequences: {},
    automationSteps: Object.fromEntries(seeds.automations.map(row => [row.id, programSteps(row.steps)])),
    flows,
    contentMode: 'answer',
    // A promise the flow-content answer waits on, so a step can look at the page while it is open.
    contentHold: null,
    contentPosts: [],
    contentAborted: [],
    flowPosts: [],
    answered: []
  };
}

/** server.mjs sequenceStepsFor: the shared steps, with this account's content laid over them by id. */
function sequenceSteps(state, seq) {
  const own = state.accountSequences[seq.id] || [];
  return seq.steps.map(step => {
    const row = own.find(item => item.id === step.id);
    return row ? { ...step, subject: row.subject, previewText: row.previewText, blocks: row.blocks, delayHours: row.delayHours } : step;
  });
}

const sequenceRow = (state, seq) => ({
  id: seq.id, name: seq.name, kind: 'sequence', editable: false, contentEditable: true, enabled: true,
  trigger: seq.triggerType || 'lead_capture', ...state.seeds.chainGraph(seq.id, sequenceSteps(state, seq)), note: STARTER_FLOW_NOTE
});

const automationRow = (state, row) => ({
  id: row.id, name: row.name, kind: 'automation', editable: false, contentEditable: true, enabled: false,
  trigger: row.trigger, ...state.seeds.chainGraph(row.id, state.automationSteps[row.id]), note: BUILT_IN_FLOW_NOTE
});

/** server.mjs presentCustomFlow, for an account with no sends yet. */
const customRow = flow => ({
  id: flow.id, name: flow.name, kind: 'flow', editable: true, enabled: flow.enabled === true, trigger: flow.trigger,
  quietAfterDays: flow.quietAfterDays || null, reentry: flow.reentry || 'once', reentryDays: flow.reentryDays || 30,
  exitOnOrder: flow.exitOnOrder === true, dateField: '', dateOffsetDays: 0, dateRepeat: 'once', lookbackDays: flow.lookbackDays || null,
  dropMode: flow.dropMode || '', dropValue: flow.dropValue ?? null, stockThreshold: flow.stockThreshold || null,
  stockMinimum: flow.stockMinimum || null, variantId: flow.variantId || '', klaviyoFlowId: '', nodes: flow.nodes, edges: flow.edges,
  sunset: flow.sunset === true, enrolled: 0, note: (flow.notes || []).join(' '), stats: null, active: 0,
  stepCount: flow.nodes.filter(node => node.type === 'email' || node.type === 'sms').length, compileError: ''
});

/**
 * The flow-content route's walk (EMAIL_STUDIO_PLAN.md item 1, stepsFromChain): from the trigger along
 * single edges, each email takes the next base step in order, a wait before it gives its delayHours,
 * and anything else, a branch, a cycle or a different email count is refused.
 */
function stepsFromChain(body, baseSteps) {
  const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
  const edges = Array.isArray(body?.edges) ? body.edges : [];
  let at = nodes.find(node => node.type === 'trigger');
  if (!at) return null;
  const seen = new Set([at.id]);
  const steps = [];
  let wait = 0;
  for (;;) {
    const out = edges.filter(edge => edge.source === at.id);
    if (!out.length) break;
    if (out.length > 1) return null;
    const next = nodes.find(node => node.id === out[0].target);
    if (!next || seen.has(next.id)) return null;
    seen.add(next.id);
    if (next.type === 'delay') wait = Number(next.delayHours) || 0;
    else if (next.type === 'email') {
      const base = baseSteps[steps.length];
      if (!base) return null;
      steps.push({ id: base.id, subject: String(next.subject || ''), previewText: String(next.previewText || ''), blocks: next.blocks || [], delayHours: wait });
      wait = 0;
    } else return null;
    at = next;
  }
  return steps.length === baseSteps.length ? steps : null;
}

/** Answers one studio route with recorded JSON, 'abort' for a request the check refuses on purpose, or false. */
function studioAnswer(req, u, state) {
  const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const p = u.pathname;
  const method = req.method();
  const { seeds } = state;
  state.answered.push(`${method} ${p}`);
  if (method === 'GET' && /^\/api\/journey\/[^/]+$/.test(p)) return json(200, { success: true, journey: null });
  // App's own read (server/routes/authWorkspaceRoutes.mjs): an account with no stored workspace yet.
  if (method === 'GET' && p === '/api/workspaces') return json(200, { success: true, workspaces: [] });
  if (method === 'GET' && p === '/api/email/flow-map') {
    return json(200, {
      success: true, hubConnected: true, timezone: '', triggers: TRIGGER_META,
      flows: [...state.flows.map(customRow), ...seeds.automations.map(row => automationRow(state, row)), ...seeds.sequences.map(seq => sequenceRow(state, seq))]
    });
  }
  const content = /^\/api\/email\/flow-content\/([^/]+)$/.exec(p);
  if (method === 'POST' && content) {
    if (state.contentMode === 'abort') {
      state.contentAborted.push(p);
      return 'abort';
    }
    const body = JSON.parse(req.postData() || '{}');
    state.contentPosts.push({ id: content[1], body });
    const seq = seeds.sequences.find(item => item.id === content[1]);
    const auto = seeds.automations.find(item => item.id === content[1]);
    if (!seq && !auto) return json(404, { success: false, error: NOT_ON_ACCOUNT });
    const steps = stepsFromChain(body, seq ? sequenceSteps(state, seq) : state.automationSteps[auto.id]);
    if (!steps) return json(400, { success: false, error: STEPS_CHANGED });
    if (seq) {
      state.accountSequences[seq.id] = steps;
      return json(200, { success: true, flow: sequenceRow(state, seq) });
    }
    state.automationSteps[auto.id] = steps;
    return json(200, { success: true, flow: automationRow(state, auto) });
  }
  const flowSave = /^\/api\/email\/flows\/([^/]+)$/.exec(p);
  if (method === 'POST' && flowSave) {
    const body = JSON.parse(req.postData() || '{}');
    state.flowPosts.push({ id: flowSave[1], body });
    const index = state.flows.findIndex(flow => flow.id === flowSave[1]);
    if (index < 0) return json(404, { success: false, error: NOT_ON_ACCOUNT });
    state.flows[index] = { ...state.flows[index], ...body, id: state.flows[index].id };
    return json(200, { success: true, flow: customRow(state.flows[index]) });
  }
  if (method === 'GET' && p === '/api/email/suite') {
    return json(200, {
      success: true,
      suite: {
        hubConnected: true, shopifyStillSends: true, postalAddress: '', timezone: '',
        installed: seeds.sequences.map(seq => ({ id: seq.id, name: seq.name, trigger: seq.triggerType, steps: seq.steps.length, source: 'drip' })),
        automations: seeds.automations.map(row => ({
          id: row.id, name: row.name, trigger: row.trigger, description: row.description, enabled: false,
          quietAfterDays: row.quietAfterDays || null, steps: state.automationSteps[row.id], activeEnrollments: 0
        })),
        transactional: seeds.transactional.map(row => ({
          id: row.id, name: row.name, shopifyNotification: row.shopifyNotification, shopifyTopic: row.shopifyTopic,
          enabled: false, subject: row.subject, blocks: row.blocks
        })),
        library: []
      }
    });
  }
  if (method === 'GET' && p === '/api/drips/sequences') {
    return json(200, {
      success: true,
      sequences: seeds.sequences.map(seq => ({ ...seq, steps: sequenceSteps(state, seq), attributedSales: null })),
      revenueNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. Blank until one of those is stored.'
    });
  }
  // One person part way through a two-email starter flow, so the enrollment row's "Step N of M" is drawn.
  if (method === 'GET' && p === '/api/drips/enrollments') {
    const cart = seeds.sequences.find(seq => seq.steps.length === 2);
    return json(200, {
      success: true,
      enrollments: cart ? [{
        id: 'enr_check_1', sequenceId: cart.id, customerEmail: 'reader@example.test', currentStepIndex: 0, status: 'active',
        enrolledAt: '2026-10-01T00:00:00.000Z', nextStepDueAt: '2026-10-02T00:00:00.000Z', history: []
      }] : []
    });
  }
  if (method === 'GET' && p === '/api/email/flows') return json(200, { success: true, flows: [] });
  if (method === 'GET' && p === '/api/email/broadcasts') return json(200, { success: true, broadcasts: [] });
  if (method === 'GET' && p === '/api/email/analytics') {
    return json(200, {
      success: true,
      analytics: {
        totalSent: 0, sent: 0, delivered: null, opened: null, clicked: null, unsubscribed: null, revenue: null, prefetchOpens: null,
        avgOpenRate: null, avgClickRate: null, deliveryRate: null, activeSubscribers: 0,
        windows: { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 }, opensStored: true, windowNote: ''
      }
    });
  }
  if (method === 'GET' && p === '/api/email/audience') {
    return json(200, {
      success: true,
      rfmConfig: { atRiskDays: 90, lapsedDays: 180, vipSilver: 100, vipGold: 250, vipPlatinum: 500, coolingDays: 60, autoWinbackEnabled: false, allowUnlimitedDiscountUse: false },
      rfmSummary: { whales: 0, gold: 0, silver: 0, atRisk: 0, lapsed: 0, repeatBuyers: 0, totalBuyers: 0, leads: 0, totalContacts: 0 },
      subscribers: []
    });
  }
  if (method === 'GET' && p === '/api/email/segments') return json(200, { success: true, totalAudience: 0, segments: [] });
  if (method === 'GET' && p === '/api/email/lists') return json(200, { success: true, lists: [] });
  if (method === 'GET' && /^\/api\/workspace\/[^/]+\/shopify\/abandoned-checkouts$/.test(p)) return json(200, { success: true, checkouts: [] });
  if (method === 'GET' && p === '/api/email/predictions') {
    return json(200, { success: true, ready: false, orders: 0, repeatCustomers: 0, historyDays: null, method: null, sampleSize: null, storeGapDays: null, computedAt: null, missing: 'This account has no orders yet.' });
  }
  if (method === 'GET' && p === '/api/klaviyo') return json(200, { success: true, klaviyo: { connected: false, keyOnFile: false, sendWith: 'jourvance', flows: [] } });
  state.answered.pop();
  return false;
}

// ---- Plumbing (as builder-browser-check.mjs) ----

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

/** The focused element: its tag, text and accessible label. */
const focused = page => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim(), label: el.getAttribute('aria-label') || '' } : null;
});

/** The border of one step on the map (the node's own drawn box). */
const nodeBorder = (page, id) => page.evaluate(nodeId => {
  const box = document.querySelector(`.react-flow__node[data-id="${nodeId}"] > div`);
  if (!box) return null;
  const cs = getComputedStyle(box);
  return { color: cs.borderTopColor, width: cs.borderTopWidth };
}, id);

/** The studio's root (the scroller the title sits in): its visible text, then every aria-label, placeholder and title in it. */
const studioText = page => page.evaluate(() => {
  const h1 = [...document.querySelectorAll('h1')].find(h => /Email Studio/.test(h.textContent || ''));
  let root = h1;
  while (root && root.parentElement && getComputedStyle(root).overflowY !== 'auto') root = root.parentElement;
  if (!root) return '';
  const said = [...root.querySelectorAll('[aria-label], [placeholder], [title]')]
    .flatMap(el => ['aria-label', 'placeholder', 'title'].map(name => el.getAttribute(name)).filter(Boolean));
  return `${root.innerText}\n${said.join('\n')}`;
});

/** Where one element sits against the viewport: on screen means its whole box is inside it. */
const boxOf = (page, selector, text) => page.evaluate(([sel, want]) => {
  const el = [...document.querySelectorAll(sel)].find(e => want == null || (e.textContent || '').trim() === want);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), viewport: window.innerHeight, onScreen: r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight };
}, [selector, text ?? null]);

/** The text of every status region on the page. */
const statusTexts = page => page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map(el => (el.textContent || '').trim()));

/** The chosen flow on the map: the list button drawn with the chosen border. */
const chosenFlow = page => page.evaluate(() => {
  const h2 = [...document.querySelectorAll('h2')].find(h => (h.textContent || '').trim() === 'Flow map');
  if (!h2) return null;
  const scope = h2.closest('div[style*="flex-direction: column"]') || document;
  const chosen = [...scope.querySelectorAll('button')].find(b => /rgba\(244, 114, 182, 0\.7\)/.test(b.getAttribute('style') || ''));
  return chosen ? (chosen.firstElementChild?.textContent || '').trim() : '';
});

/** The studio tab button's colour (the active tab is drawn pink). */
const tabColor = (page, name) => page.evaluate(label => {
  const tab = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === label);
  return tab ? getComputedStyle(tab).color : null;
}, name);

/** Controls in the studio that stick out past either edge, and whether the studio or the page scrolls sideways. */
const studioPastEdge = page => page.evaluate(() => {
  const w = window.innerWidth;
  const h1 = [...document.querySelectorAll('h1')].find(h => /Email Studio/.test(h.textContent || ''));
  let root = h1;
  while (root && root.parentElement && getComputedStyle(root).overflowY !== 'auto') root = root.parentElement;
  const bad = [];
  let seen = 0;
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href], [role="group"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.react-flow__viewport')) continue;
    seen++;
    if (r.left < -0.5 || r.right > w + 0.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return { bad, seen, width: w, pageScroll: document.documentElement.scrollWidth, studioScroll: root.scrollWidth, studioClient: root.clientWidth };
});

// ---- The run ----

async function runChecks(browser, origin, shots, blocked, seeds) {
  const results = [];
  const state = newState(seeds);
  const texts = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request();
    if (routeVerdict(req.url(), origin) === 'continue') return route.continue();
    try {
      const u = new URL(req.url());
      if (u.origin === origin) {
        const answer = studioAnswer(req, u, state);
        if (answer === 'abort') return route.abort();
        // A held flow-content answer: the body is recorded already, the reply waits for the step.
        if (answer && state.contentHold && req.method() === 'POST' && u.pathname.startsWith('/api/email/flow-content/')) await state.contentHold;
        if (answer) return route.fulfill(answer);
      }
    } catch {}
    blocked.push(`${req.method()} ${req.url().slice(0, 100)}`);
    return route.abort();
  });
  await context.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('jv-studio-check-seeded')) return;
    sessionStorage.setItem('jv-studio-check-seeded', '1');
    localStorage.setItem(key, value);
  }, [STORAGE_KEY, JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err?.message || err)));
  // Every dialog is answered Cancel, and its message kept.
  const dialogs = [];
  page.on('dialog', d => {
    dialogs.push(d.message());
    d.dismiss().catch(() => {});
  });

  const shot = async name => {
    if (!shots) return;
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
  };
  const keepText = async where => texts.push({ where, text: await studioText(page) });

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

  const tab = name => page.getByRole('button', { name, exact: true });
  const toAutomations = async () => {
    await tab('Automations').click();
    await page.getByText('Starter flows run for every new lead or checkout.', { exact: false }).first().waitFor({ state: 'visible' });
    // One active tab once the 0.15s colour transition settles: Automations pink, Flow map not.
    const settled = await waitUntil(async () => ((await tabColor(page, 'Automations')) === PINK && (await tabColor(page, 'Flow map')) !== PINK ? true : null), 2000);
    if (!settled) throw new Error(`after Automations the tabs read Automations ${await tabColor(page, 'Automations')}, Flow map ${await tabColor(page, 'Flow map')}`);
  };
  const stepHeading = async text => waitUntil(async () => {
    const f = await focused(page);
    return f && f.tag === 'h3' && f.text === text ? f : null;
  }, 5000);
  const content = () => page.getByRole('group', { name: 'Email content' });
  /**
   * Focuses one map step in the page, at once. Right after a selection the map is drawn again, and a
   * step React Flow has not measured is hidden and refuses focus: every step blanked for a frame until
   * each node carried its last measured size (EmailFlowMap nodeSizes). One try, so that comes back red.
   */
  const focusNode = async id => {
    const t = await page.evaluate(nodeId => {
      const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const visibility = el ? getComputedStyle(el).visibility : 'missing';
      el?.focus();
      return { ok: !!el && document.activeElement === el && el.tabIndex === 0, visibility };
    }, id);
    expect(t.ok, `the map step ${id} did not take focus at once: ${JSON.stringify(t)}`);
    return `${id} took focus at once (visibility ${t.visibility})`;
  };
  const saveButton = () => page.getByRole('button', { name: 'Save', exact: true });

  await go('open', async () => {
    await page.goto(`${origin}/canvas`);
    const studio = page.getByRole('button', { name: 'Switch to Email Studio view' });
    await studio.waitFor({ state: 'visible', timeout: 20000 });
    await studio.click();
    const heading = page.getByRole('heading', { level: 1, name: /Email Studio/ });
    await heading.waitFor({ state: 'visible', timeout: 15000 });
    await page.getByText('Starter flows run for every new lead or checkout.', { exact: false }).first().waitFor({ state: 'visible' });
    await keepText('Automations');
    await shot('1-studio-open');
    return `"${(await heading.textContent()).trim()}" is visible and Automations is showing`;
  });

  await go('counts', async () => {
    const text = await studioText(page);
    const sizes = [...new Set(seeds.sequences.map(seq => seq.steps.length))].sort();
    const want = sizes.map(n => (n === 1 ? 'Completed the email:' : `Completed all ${n} emails:`));
    want.push('Step 1 of 2');
    const missing = want.filter(line => !text.includes(line));
    expect(missing.length === 0, `Automations does not say ${JSON.stringify(missing)}`);
    expect(!/Completed 3-Steps|Step \d+ of 3\b/.test(text.replace(/Email \d+ of 3/g, '')), 'a literal 3 is still counted');
    return `the cards say ${want.join(' | ')}`;
  });

  await go('starter-open', async () => {
    const edit = page.getByRole('button', { name: 'Edit emails in Welcome sequence', exact: true });
    const count = await edit.count();
    expect(count >= 1, 'no "Edit emails in Welcome sequence" button on Automations');
    await edit.first().click();
    const f = await stepHeading('Email 1 of 3');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}, not the "Email 1 of 3" step heading`);
    // The tab strip transitions its colours over 0.15s, so the active colour is read once it settles.
    const active = await waitUntil(async () => ((await tabColor(page, 'Flow map')) === PINK ? true : null), 2000);
    expect(active, `the Flow map tab is ${await tabColor(page, 'Flow map')}, not the active pink`);
    const chosen = await chosenFlow(page);
    expect(chosen === 'Welcome sequence', `the chosen flow is "${chosen}"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, `${WELCOME}_email_0`);
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border && border.width === '2px', `email 1 is drawn ${JSON.stringify(await nodeBorder(page, `${WELCOME}_email_0`))}`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    expect(subject === seeds.sequences.find(s => s.id === WELCOME).steps[0].subject, `the Subject field reads "${subject}"`);
    // The step panel says whose emails these are (D3), right under the heading that holds focus.
    const said = await page.evaluate(() => {
      const h3 = document.activeElement;
      return h3 && h3.nextElementSibling ? (h3.nextElementSibling.textContent || '').trim() : '';
    });
    expect(said === STARTER_FLOW_NOTE, `under the step heading: "${said}"`);
    await keepText('Flow map, Welcome email 1');
    await shot('2-starter-open');
    return `${count} "Edit emails" buttons for Welcome; Flow map active, Welcome chosen, email 1 drawn ${border.width} ${border.color}, focus on h3 "${f.text}"`;
  });

  await go('email-open', async () => {
    await toAutomations();
    const second = seeds.sequences.find(s => s.id === WELCOME).steps[1].subject;
    const tile = page.getByRole('button', { name: `Email 2 of 3 in Welcome sequence: ${second}`, exact: true });
    await tile.click();
    const f = await stepHeading('Email 2 of 3');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}, not "Email 2 of 3"`);
    const border = await waitUntil(async () => {
      const b = await nodeBorder(page, `${WELCOME}_email_1`);
      return b && b.color === PINK ? b : null;
    }, 3000);
    expect(border, 'email 2 is not drawn selected');
    const seen = await boxOf(page, `.react-flow__node[data-id="${WELCOME}_email_1"]`);
    expect(seen?.onScreen, `email 2 is off screen once its heading took focus: ${JSON.stringify(seen)}`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    const want = seeds.sequences.find(s => s.id === WELCOME).steps[1].subject;
    expect(subject === want, `the Subject field reads "${subject}", not "${want}"`);
    return `email 2 selected and drawn ${border.color}; Subject reads "${subject}"`;
  });

  await go('node-selected', async () => {
    const waitId = `${WELCOME}_wait_1`;
    await page.click(`.react-flow__node[data-id="${waitId}"]`);
    const selected = await waitUntil(async () => {
      const b = await nodeBorder(page, waitId);
      return b && b.color === PINK ? b : null;
    }, 3000);
    const other = await nodeBorder(page, `${WELCOME}_email_0`);
    expect(selected, `the Wait node is drawn ${JSON.stringify(await nodeBorder(page, waitId))}`);
    expect(other && other.color !== selected.color, `an unselected node is drawn ${JSON.stringify(other)}, the same as the selected one`);
    const field = page.getByLabel('Wait, in hours', { exact: true });
    await field.waitFor({ state: 'visible' });
    const value = await field.inputValue();
    expect(value === String(seeds.sequences.find(s => s.id === WELCOME).steps[1].delayHours), `the wait field reads ${value}`);
    const f = await stepHeading('Wait before email 2');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}`);
    // The heading takes focus without moving the step just chosen off screen.
    const seen = await boxOf(page, `.react-flow__node[data-id="${waitId}"]`);
    expect(seen?.onScreen, `the Wait step is off screen once its heading took focus: ${JSON.stringify(seen)}`);
    await shot('4-wait-selected');
    return `Wait drawn ${selected.width} ${selected.color}, unselected ${other.width} ${other.color}; "Wait, in hours" reads ${value}`;
  });

  await go('builder-in-step', async () => {
    await page.click(`.react-flow__node[data-id="${WELCOME}_email_0"]`);
    expect(await stepHeading('Email 1 of 3'), 'email 1 did not take the step heading');
    await page.locator('#flow-step-subject').fill(NEW_SUBJECT);
    await page.locator('#flow-step-preview').fill(NEW_PREVIEW);
    const group = content();
    const before = await group.getByRole('button', { name: 'Remove', exact: true }).count();
    await group.getByRole('button', { name: 'Add image', exact: true }).click();
    await group.getByLabel('Image address', { exact: true }).fill(IMAGE_URL);
    await group.getByRole('button', { name: 'Add button', exact: true }).click();
    await group.getByLabel('Button link', { exact: true }).fill(BUTTON_URL);
    const after = await group.getByRole('button', { name: 'Remove', exact: true }).count();
    expect(after === before + 2, `the builder holds ${after} blocks after adding two to ${before}`);
    await keepText('Flow map, builder open');
    await shot('5-builder-in-step');
    return `${before} block, then ${after} after Add image and Add button, with the image address and button link filled`;
  });

  await go('save-content', async () => {
    const unsaved = () => page.getByText(UNSAVED, { exact: true }).isVisible();
    expect(await unsaved(), `"${UNSAVED}" is not shown after the edits`);
    let release = () => {};
    state.contentHold = new Promise(resolve => { release = resolve; });
    try {
      await saveButton().click();
      const reached = await waitUntil(() => (state.contentPosts.length === 1 ? true : null), 5000);
      expect(reached, 'the flow-content POST did not reach the stub');
      // The server has not answered: Save reads Saving, and nothing says Saved.
      const saving = page.getByRole('button', { name: 'Saving', exact: true });
      expect(await saving.isVisible(), 'Save does not read Saving while the request is open');
      expect((await saving.getAttribute('aria-disabled')) === 'true', 'Saving is not aria-disabled');
      await page.waitForTimeout(300);
      const during = await statusTexts(page);
      expect(!during.includes(SAVED_CONTENT), `Saved was said before the server answered: ${JSON.stringify(during)}`);
      expect(during.includes(SAVING_CONTENT), `while the request is open the status says ${JSON.stringify(during)}`);
    } finally {
      release();
      state.contentHold = null;
    }
    const status = await waitUntil(async () => ((await statusTexts(page)).includes(SAVED_CONTENT) ? true : null), 5000);
    expect(status, `no status region says "${SAVED_CONTENT}": ${JSON.stringify(await statusTexts(page))}`);
    // Seen, not only heard: the sentence and the Save that was pressed are both on screen.
    const said = await boxOf(page, '[role="status"]', SAVED_CONTENT);
    const button = await boxOf(page, 'button', 'Save');
    expect(said?.onScreen, `the Saved sentence is off screen: ${JSON.stringify(said)}`);
    expect(button?.onScreen, `Save is off screen: ${JSON.stringify(button)}`);
    await page.waitForTimeout(600);
    expect((await statusTexts(page)).includes(SAVED_CONTENT), 'the Saved sentence went away by itself');
    expect(!(await unsaved()), `"${UNSAVED}" still shows after Saved`);
    expect(state.contentPosts.length === 1, `${state.contentPosts.length} flow-content POSTs, not one`);
    const post = state.contentPosts[0];
    expect(post.id === WELCOME, `the POST went to ${post.id}`);
    const mail = post.body.nodes.find(node => node.id === `${WELCOME}_email_0`);
    expect(mail && mail.subject === NEW_SUBJECT, `the email node's subject is ${JSON.stringify(mail?.subject)}`);
    expect(mail.previewText === NEW_PREVIEW, `the email node's preview text is ${JSON.stringify(mail.previewText)}`);
    const kinds = mail.blocks.map(b => b.kind);
    expect(mail.blocks.some(b => b.kind === 'image' && b.url === IMAGE_URL), `no image block with the address: ${JSON.stringify(kinds)}`);
    expect(mail.blocks.some(b => b.kind === 'button' && b.url === BUTTON_URL), `no button block with the link: ${JSON.stringify(kinds)}`);
    const others = post.body.nodes.filter(node => node.type === 'email' && node.id !== mail.id);
    expect(others.every(node => typeof node.previewText === 'string' && node.previewText.length > 0), 'another email in the POST lost its preview text');
    // An edit after Saved: the sentence no longer covers what is on screen, so it goes.
    await page.locator('#flow-step-preview').fill(`${NEW_PREVIEW}, edited after the save`);
    const cleared = await waitUntil(async () => (!(await statusTexts(page)).includes(SAVED_CONTENT) ? true : null), 2000);
    expect(cleared, `Saved still shows after a new edit: ${JSON.stringify(await statusTexts(page))}`);
    expect(await unsaved(), `"${UNSAVED}" is not shown after the new edit`);
    return `Saving shown and Saved withheld while the answer was held; then one POST to /api/email/flow-content/${post.id}; email 1 carries "${mail.subject}", "${mail.previewText}" and blocks ${kinds.join(', ')}; Saved on screen at ${said.top}..${said.bottom} of ${said.viewport} with Save at ${button.top}; a later edit cleared it`;
  });

  await go('cards-show-edit', async () => {
    await toAutomations();
    const tile = page.getByRole('button', { name: /^Email 1 of 3 in Welcome sequence: / });
    const shown = await waitUntil(async () => ((await tile.textContent()) || '').includes(NEW_SUBJECT) ? true : null, 5000);
    expect(shown, `the Welcome card's email 1 reads "${(await tile.textContent() || '').trim().slice(0, 120)}"`);
    // Its accessible name says the subject too, since aria-label replaces the text inside the button.
    const name = await tile.getAttribute('aria-label');
    expect(name === `Email 1 of 3 in Welcome sequence: ${NEW_SUBJECT}`, `the tile is named "${name}"`);
    await shot('7-card-shows-edit');
    return `the Welcome card's email 1 shows "${NEW_SUBJECT}" and is named "${name}"`;
  });

  await go('built-in', async () => {
    // The card: the nearest box around its Edit emails button that also holds its list of emails.
    const card = page.getByRole('button', { name: 'Edit emails in After the order', exact: true }).locator('xpath=ancestor::div[.//ol][1]');
    await card.waitFor({ state: 'visible' });
    expect((await card.innerText()).includes('A thank-you the day after an order'), 'the located card is not After the order');
    const areas = await card.locator('textarea').count();
    const inputs = await card.locator('input').count();
    expect(areas === 0 && inputs === 0, `the After the order card holds ${areas} textareas and ${inputs} inputs`);
    const listed = (await card.innerText()).match(/Email \d+: [^\n]+/g) || [];
    expect(listed.length === seeds.automations.find(a => a.id === 'post_purchase').steps.length, `the card lists ${JSON.stringify(listed)}`);
    await page.getByRole('button', { name: 'Edit emails in After the order', exact: true }).click();
    const f = await stepHeading('Email 1 of 2');
    expect(f, `focus is on ${JSON.stringify(await focused(page))}`);
    const chosen = await chosenFlow(page);
    expect(chosen === 'After the order', `the chosen flow is "${chosen}"`);
    await content().getByRole('button', { name: 'Add image', exact: true }).waitFor({ state: 'visible' });
    await keepText('Flow map, After the order');
    await shot('8-built-in');
    return `card lists ${listed.join(' | ')} with no textarea or input; Edit emails opened After the order with the builder, focus on "${f.text}"`;
  });

  await go('account-flow', async () => {
    await page.getByRole('button', { name: /^Viewed a product/ }).click();
    await page.click('.react-flow__node[data-id="n_mail"]');
    expect(await stepHeading('Email 1 of 1'), `focus is on ${JSON.stringify(await focused(page))}`);
    const group = content();
    await group.getByRole('button', { name: 'Add divider', exact: true }).click();
    for (const option of ['Send at their hour', 'Transactional, no marketing unsubscribe', 'Skip if this account emailed them in the last 16 hours']) {
      expect(await page.getByText(option, { exact: true }).count() >= 1, `the advanced option "${option}" is not shown`);
    }
    expect(await page.getByRole('button', { name: 'Add wait', exact: true }).count() === 1, 'the flow-level Add wait is not shown on an account flow');
    await saveButton().click();
    const post = await waitUntil(() => state.flowPosts.find(row => row.id === 'flow_viewedproduct') || null, 5000);
    expect(post, 'no POST reached /api/email/flows/flow_viewedproduct');
    const mail = post.body.nodes.find(node => node.id === 'n_mail');
    const kinds = (mail?.blocks || []).map(b => b.kind);
    expect(kinds.includes('text') && kinds.includes('divider'), `the posted email blocks are ${JSON.stringify(kinds)}`);
    const status = await waitUntil(async () => ((await statusTexts(page)).includes(SAVED_FLOW) ? true : null), 5000);
    expect(status, `the status region says ${JSON.stringify(await statusTexts(page))}`);
    await keepText('Flow map, Viewed a product');
    await shot('9-account-flow');
    return `builder and advanced options shown; POST /api/email/flows/flow_viewedproduct carried blocks ${kinds.join(', ')}`;
  });

  await go('save-unanswered', async () => {
    state.contentMode = 'abort';
    try {
      await page.getByRole('button', { name: /^Welcome sequence/ }).click();
      // Email 1: the map keeps the last flow's view when another flow is chosen from the list, and
      // email 1 sits near the top of every chain, so it is on screen.
      await page.click(`.react-flow__node[data-id="${WELCOME}_email_0"]`);
      expect(await stepHeading('Email 1 of 3'), 'email 1 did not take the step heading');
      await page.locator('#flow-step-subject').fill(UNHEARD_SUBJECT);
      const posts = state.contentPosts.length;
      await saveButton().click();
      const status = await waitUntil(async () => ((await statusTexts(page)).includes(FLOW_MAP_WRITE_UNREACHABLE.content) ? true : null), 5000);
      expect(status, `the status region says ${JSON.stringify(await statusTexts(page))}`);
      expect(state.contentAborted.length === 1, `${state.contentAborted.length} flow-content requests were aborted, not one`);
      expect(state.contentPosts.length === posts, 'an aborted save was recorded as answered');
      return `the request to ${state.contentAborted[0]} was aborted and the notice reads "${FLOW_MAP_WRITE_UNREACHABLE.content}"`;
    } finally {
      state.contentMode = 'answer';
    }
  });

  await go('unsaved-kept', async () => {
    expect(await page.getByText(UNSAVED, { exact: true }).isVisible(), `"${UNSAVED}" is not shown after a save the server never answered`);
    const before = dialogs.length;
    await page.getByRole('button', { name: /^Viewed a product/ }).click();
    const asked = await waitUntil(() => (dialogs.length > before ? dialogs[dialogs.length - 1] : null), 3000);
    expect(asked, 'choosing another flow with unsaved edits asked nothing');
    // The check answers Cancel: the flow and the edit stay.
    await page.waitForTimeout(300);
    const chosen = await chosenFlow(page);
    expect(chosen === 'Welcome sequence', `after Cancel the chosen flow is "${chosen}"`);
    const subject = await page.locator('#flow-step-subject').inputValue();
    expect(subject === UNHEARD_SUBJECT, `after Cancel the Subject field reads "${subject}"`);
    return `asked "${asked}"; Cancel kept Welcome sequence and its unsaved subject`;
  });

  await go('strip-clears', async () => {
    await toAutomations();
    await page.getByRole('button', { name: 'Edit emails in Welcome sequence', exact: true }).first().click();
    expect(await stepHeading('Email 1 of 3'), 'Edit emails did not open Welcome on email 1');
    await toAutomations();
    await tab('Flow map').click();
    await page.getByRole('heading', { level: 2, name: 'Flow map', exact: true }).waitFor({ state: 'visible' });
    const first = state.flows[0].name;
    const chosen = await waitUntil(async () => (await chosenFlow(page)) || null, 5000);
    expect(chosen === first, `the plain Flow map tab chose "${chosen}", not the first flow "${first}"`);
    await page.waitForTimeout(400);
    const headings = await page.evaluate(() => [...document.querySelectorAll('h3')].map(h => (h.textContent || '').trim()).filter(t => /^(Email|Wait|Text) /.test(t)));
    expect(headings.length === 0, `a step is selected on the plain Flow map: ${JSON.stringify(headings)}`);
    return `the tab strip opened the plain map on "${chosen}" with no step selected`;
  });

  await go('keyboard', async () => {
    await toAutomations();
    await tab('Automations').focus();
    let reached = null;
    let presses = 0;
    for (; presses < 60 && !reached; presses++) {
      await page.keyboard.press('Tab');
      const f = await focused(page);
      if (f && f.tag === 'button' && /^Edit emails in /.test(f.label)) reached = f;
    }
    expect(reached, `Tab did not reach an "Edit emails" button in ${presses} presses`);
    await page.keyboard.press('Enter');
    const f = await waitUntil(async () => {
      const now = await focused(page);
      return now && now.tag === 'h3' && /^Email 1 of \d+$/.test(now.text) ? now : null;
    }, 5000);
    expect(f, `after Enter focus is on ${JSON.stringify(await focused(page))}`);
    expect(await page.getByRole('heading', { level: 2, name: 'Flow map', exact: true }).isVisible(), 'the Flow map is not showing');
    // On the map itself: Enter on a focused step selects it and hands focus to its heading. Each step
    // is a focusable element (React Flow gives it tabindex 0); it is focused in the page, and the check
    // asserts it holds focus before Enter is pressed.
    const focusWait = await focusNode(`${WELCOME}_wait_1`);
    await page.keyboard.press('Enter');
    const onMap = await stepHeading('Wait before email 2');
    expect(onMap, `Enter on the focused Wait step left focus on ${JSON.stringify(await focused(page))}`);
    // Back to email 1 the same way, so the builder is open for the narrow step.
    const focusEmail = await focusNode(`${WELCOME}_email_0`);
    await page.keyboard.press('Enter');
    expect(await stepHeading('Email 1 of 3'), `Enter on the focused email 1 left focus on ${JSON.stringify(await focused(page))}`);
    return `${presses} Tab presses from the Automations tab reached "${reached.label}"; Enter opened the map with focus on "${f.text}"; Enter on a focused map step moved focus to "${onMap.text}", then back to email 1 (${focusWait}; ${focusEmail}, straight after a selection)`;
  });

  await go('narrow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await content().waitFor({ state: 'visible' });
    const f = await studioPastEdge(page);
    expect(f.seen >= 20, `only ${f.seen} controls were measured, so the scan proves nothing`);
    expect(f.pageScroll === 390, `document.documentElement.scrollWidth is ${f.pageScroll}, not 390`);
    expect(f.studioScroll <= f.studioClient, `the studio scrolls sideways: ${f.studioScroll} > ${f.studioClient}`);
    expect(f.bad.length === 0, `${f.bad.length} controls past an edge: ${f.bad.slice(0, 4).join(' | ')}`);
    await keepText('Flow map at 390');
    await shot('12-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    return `at 390: page scrollWidth ${f.pageScroll}, studio ${f.studioScroll}/${f.studioClient}, ${f.seen} controls, none past either edge`;
  });

  await go('no-dash', async () => {
    expect(texts.length >= 6, `only ${texts.length} screens were read`);
    const dashed = [];
    for (const { where, text } of texts) {
      expect(text.length > 200, `the studio text read on "${where}" is ${text.length} characters, so it proves nothing`);
      for (const line of text.split('\n')) if (/—| – /.test(line)) dashed.push(`${where}: ${line.trim().slice(0, 80)}`);
    }
    expect(dashed.length === 0, `dashes: ${dashed.slice(0, 4).join(' | ')}`);
    return `${texts.length} screens read with their aria-label, placeholder and title values (${texts.map(t => t.where).join('; ')}), no em dash and no spaced en dash`;
  });

  await go('runtime', async () => {
    expect(errors.length === 0, `page errors: ${errors.slice(0, 3).join(' | ')}`);
    return 'no uncaught page error';
  });

  await context.close();
  return { results, state };
}

async function main(cleanup) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    say(`check:email-studio could not run. ${err.message}`);
    return 2;
  }
  let seeds;
  try {
    seeds = readSeeds();
  } catch (err) {
    say(`check:email-studio could not run. The seeds could not be read: ${err.message}`);
    return 2;
  }
  const pwPath = process.env.PLAYWRIGHT_MODULE || path.resolve(ROOT, '../../node_modules/playwright/index.mjs');
  if (!fs.existsSync(pwPath)) {
    say(`check:email-studio could not run. Playwright was not found at ${pwPath}.`);
    return 2;
  }
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  if (!fs.existsSync(chromePath)) {
    say(`check:email-studio could not run. Chrome was not found at ${chromePath}.`);
    return 2;
  }
  const { chromium } = await import(pathToFileURL(pwPath).href);
  if (opts.shots) fs.mkdirSync(opts.shots, { recursive: true });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-studio-check-'));
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-studio-env-'));
  cleanup.dirs.push(work, envDir);
  const outDir = path.join(work, 'dist');
  try {
    await build({ root: ROOT, envDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  } catch (err) {
    say(`check:email-studio could not run. The app did not build: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }
  let origin;
  let port;
  try {
    port = Number(process.env.CHECK_STUDIO_PORT) || (await freePort());
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
    say(`check:email-studio could not run. The preview could not bind port ${port ?? 'on 127.0.0.1'}: ${String(err?.message || err).split('\n')[0]}`);
    return 2;
  }

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  cleanup.browser = browser;
  const blocked = [];
  say('Email Studio browser check: /canvas, then Email Studio, at 1440x900.');
  const { results, state } = await runChecks(browser, origin, opts.shots, blocked, seeds);
  const failed = results.filter(r => !r.ok);
  say(`${results.length - failed.length} of ${results.length} steps passed.`);
  const routes = [...new Set(state.answered)].sort();
  say(`Answered ${state.answered.length} studio requests with recorded JSON (${routes.length} distinct: ${routes.join(', ')}).`);
  const apiBlocked = blocked.filter(b => /\/api\//.test(b) && b.includes(origin));
  const hosts = [...new Set(blocked.map(b => b.split(' ')[1]?.split('/')[2] ?? ''))].filter(Boolean).sort();
  say(`Blocked ${blocked.length} other requests (${hosts.join(', ') || 'none'}), ${apiBlocked.length} of them /api requests on the preview: ${[...new Set(apiBlocked.map(b => b.replace(origin, '')))].join(', ') || 'none'}. Nothing reached a server.`);
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
      say(`check:email-studio could not run. ${String(err?.message || err).split('\n')[0]}`);
      return 2;
    })
    .then(async code => {
      await finish();
      process.exit(code);
    });
}
