#!/usr/bin/env node
// Ask Jourvance evaluation, the LIVE half (ASK_JOURVANCE_PLAN.md Wave 2, S5): npm run eval:assistant.
//
// It boots a sandboxed copy of this tree with the REAL hub key, asks the golden questions in
// test-fixtures/assistant-eval.json through the real route one at a time, and scores each answer:
//   invented   a number in the answer (digits, or a plain word such as "twelve") that appears in
//              neither FACTS nor NOTES of the very system text the hub was sent for that question
//              (a number the question itself contains is allowed: restating it is not inventing it;
//              a figure FACTS holds as a decimal also passes rounded)
//   em dash    an em dash or a spaced en dash
//   long       more than 180 words
//   no-screen  a question that expects a screen name and the answer names none (a guide heading
//              or a backticked label from docs/assistant/jourvance-guide.md)
//   claim      the answer asserts the question's mustNotClaim phrase (a mention inside a sentence
//              that also says no/not/never/cannot is not an assertion)
// It exits 1 on any invented number or em dash, and 2 when a question got no answer at all (an
// unanswered question certifies nothing). long, no-screen and claim are printed, not fatal.
//
// SPENDS REAL CREDITS: 3 per question. It refuses without HUB_API_KEY in the environment (it never
// reads .env, so a stray key on disk cannot start a spend) and without --spend, and prints the
// cost first. The sandbox is a copy without the data JSON files, so the live numbers are the
// sandbox's own (an empty account: the table says so). The hub-side effects are real though: the
// fixture notes save syncs the assistant's private profile, and journeys/threads of the sandbox
// user (dev-test-user-id) are written to the hub's app store under this app's key.
//
// How it sees FACTS: the sandbox's HUB_URL is a loopback relay in this process that forwards every
// call, unchanged, to the real HUB_URL and keeps each /api/brain/chat body. Scoring reads the
// system text out of that body, so it judges the pack the model was really given.
//
// Usage: HUB_API_KEY=... npm run eval:assistant -- --spend [--only <id>] [--limit <n>]

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = path.join(ROOT, 'test-fixtures', 'assistant-eval.json');
const GUIDE_PATH = path.join(ROOT, 'docs', 'assistant', 'jourvance-guide.md');
const CREDITS_PER_QUESTION = 3;
const MAX_WORDS = 180;
const NOTES_TEXT = 'We run two pottery classes a week and our goal is 20 new students a month. Our best seller is the glaze kit.';
const PACE_MS = 4300;
const BAD_DASH = /—|\s–\s/;

// ---- Pure scoring (exported for the mock-driven checks) ----

const WORD_VALUES = Object.freeze({
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000
});
// "one" is also a pronoun and the assistant is told to name "one next step": only these uses count as a number.
const ONE_NOT_A_NUMBER = /\b(?:no|any|every|some|each|which|the|this|that|another|which)\s+one\b|\bone\s+(?:of|next|step|thing|place|screen|more|way|click|button|at)\b/i;

export function numbersIn(text, ignore = []) {
  let t = String(text || '');
  for (const label of ignore) if (label) t = t.split(label).join(' ');
  const found = [];
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const v = parseFloat(m[0].replace(/,/g, ''));
    if (Number.isFinite(v)) found.push({ token: m[0], value: v });
  }
  const lower = t.toLowerCase();
  for (const m of lower.matchAll(/\b[a-z]+\b/g)) {
    const w = m[0];
    if (w === 'one') {
      const around = lower.slice(Math.max(0, m.index - 12), m.index + 16);
      if (!ONE_NOT_A_NUMBER.test(around)) found.push({ token: w, value: 1 });
    } else if (Object.hasOwn(WORD_VALUES, w)) {
      found.push({ token: w, value: WORD_VALUES[w] });
    }
  }
  return found;
}

/** The set of values the system text's FACTS and NOTES lines (and the question) allow. */
export function allowedNumbers(system, question = '') {
  const lines = String(system || '').split('\n').filter((l) => l.startsWith('FACTS (data): ') || l.startsWith('NOTES (typed by the owner'));
  const allowed = new Set();
  const add = (v) => { allowed.add(v); };
  for (const n of numbersIn(`${lines.join('\n')}\n${question}`)) {
    add(n.value);
    if (!Number.isInteger(n.value)) { add(Math.round(n.value)); add(Math.floor(n.value)); add(Math.round(n.value * 10) / 10); }
  }
  return allowed;
}

export function inventedNumbers(answer, system, question, labels = []) {
  const allowed = allowedNumbers(system, question);
  return numbersIn(answer, labels).filter((n) => !allowed.has(n.value)).map((n) => n.token);
}

const NEGATION = /\b(?:no|not|never|cannot|can't|cant|don't|dont|doesn't|doesnt|isn't|isnt|won't|without|unable|nothing)\b/i;
export function assertsClaim(answer, phrase) {
  if (!phrase) return false;
  const p = phrase.toLowerCase();
  return String(answer || '').split(/(?<=[.!?])\s+/).some((s) => s.toLowerCase().includes(p) && !NEGATION.test(s));
}

export function guideLabels(markdown) {
  const src = String(markdown || '');
  const headings = [...src.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const ticks = [...src.matchAll(/`([^`\n]{2,60})`/g)].map((m) => m[1].trim());
  return { headings, labels: [...new Set([...headings, ...ticks])].sort((a, b) => b.length - a.length) };
}

export function namesScreen(answer, labels) {
  const a = String(answer || '').toLowerCase();
  return labels.some((l) => a.includes(l.toLowerCase()));
}

export function scoreAnswer({ q, answer, system, labels }) {
  const invented = inventedNumbers(answer, system, q.question, labels);
  const words = String(answer || '').trim().split(/\s+/).filter(Boolean).length;
  const emDash = BAD_DASH.test(answer || '');
  const screen = namesScreen(answer, labels);
  const claim = assertsClaim(answer, q.mustNotClaim);
  const flags = [];
  if (invented.length) flags.push('INVENTED');
  if (emDash) flags.push('EMDASH');
  if (words > MAX_WORDS) flags.push('LONG');
  if (q.expectScreenName && !screen) flags.push('NO-SCREEN');
  if (claim) flags.push('CLAIM');
  return { invented, words, emDash, screen, claim, verdict: flags.length ? flags.join('+') : 'PASS' };
}

// ---- The run ----

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(name);

function die(msg, code = 2) { console.error(msg); process.exit(code); }

function pickQuestions() {
  const all = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')).questions;
  const only = arg('--only');
  let qs = only ? all.filter((q) => q.id === only) : all;
  if (only && !qs.length) die(`No golden question has the id "${only}".`);
  const limit = arg('--limit');
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) die('--limit needs a whole number of at least 1.');
    qs = qs.slice(0, n);
  }
  return qs;
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-assistant-eval-'));
  for (const f of fs.readdirSync(ROOT)) {
    const full = path.join(ROOT, f);
    if (!fs.statSync(full).isFile()) continue;
    if ((/\.(mjs|ts)$/.test(f) && !/\.test\.mjs$/.test(f)) || f === 'hub-sdk.js' || f === 'security-sentinel.js' || f === 'package.json') fs.copyFileSync(full, path.join(dir, f));
  }
  for (const d of ['server', 'src', 'public']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'docs', 'assistant'), path.join(dir, 'docs', 'assistant'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/** A loopback relay to the real hub that keeps every brain/chat body. */
async function startRelay(realHub) {
  const chats = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(parts);
      if (req.method === 'POST' && req.url.startsWith('/api/brain/chat')) {
        try { chats.push(JSON.parse(body.toString('utf8'))); } catch { /* not JSON: the hub will say so */ }
      }
      try {
        const headers = {};
        for (const k of ['content-type', 'authorization']) if (req.headers[k]) headers[k] = req.headers[k];
        const r = await fetch(realHub.replace(/\/$/, '') + req.url, { method: req.method, headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body }), signal: AbortSignal.timeout(60000) });
        const out = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
        res.end(out);
      } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `relay: ${e?.message || e}` }));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { chats, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

const pad = (s, n) => String(s).padEnd(n).slice(0, Math.max(n, String(s).length));

async function main() {
  const qs = pickQuestions();
  console.log(`Ask Jourvance evaluation: ${qs.length} question${qs.length === 1 ? '' : 's'} x ${CREDITS_PER_QUESTION} credits = ${qs.length * CREDITS_PER_QUESTION} credits of REAL hub spend.`);
  if (!process.env.HUB_API_KEY) die('Refusing to run: HUB_API_KEY is not set in the environment. This script never reads .env.');
  if (!has('--spend')) die('Refusing to run without --spend. Re-run with --spend to pay the cost above.');

  const realHub = process.env.HUB_URL || 'https://zeluslabs.dev';
  const { headings, labels } = guideLabels(fs.readFileSync(GUIDE_PATH, 'utf8'));
  const relay = await startRelay(realHub);
  const dir = makeSandbox();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(dir, 'server.log'), 'w');
  const emptied = ['MAIL_EVENT_SECRET', 'PUBLIC_BASE_URL', 'INTERNAL_CRON_SECRET', 'SENDGRID_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const env = { ...process.env, ...Object.fromEntries(emptied.map((k) => [k, ''])), HUB_URL: `http://127.0.0.1:${relay.port}`, APP_ID: 'jourvance', PORT: String(port), NODE_ENV: 'development', ASSISTANT_PER_HOUR: '200' };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env, stdio: ['ignore', log, log], detached: true });
  const killServer = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
  process.on('exit', killServer);
  const cleanup = async () => { killServer(); await relay.close(); fs.rmSync(dir, { recursive: true, force: true }); };

  const call = async (method, route, body) => {
    const res = await fetch(`${base}/api/ai/assistant${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev-test-token' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120000)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  let rows = [];
  try {
    const started = Date.now();
    let up = false;
    while (Date.now() - started < 60000) {
      try { if ((await call('GET', '/thread')).status === 200) { up = true; break; } } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!up) { await cleanup(); die(`The sandboxed server did not answer in 60 s; log: ${fs.readFileSync(path.join(dir, 'server.log'), 'utf8').slice(-600)}`); }
    console.log(`sandbox ${dir}, server pid ${child.pid} on ${base} (up in ${Date.now() - started} ms), hub relay to ${realHub}`);
    const saved = await call('POST', '/notes', { notes: NOTES_TEXT });
    console.log(`fixture notes saved: HTTP ${saved.status}. The account is the sandbox's own (no seeded journeys, events or orders), so the numbers below are whatever that account really holds.`);

    // The sandbox's own Security Sentinel allows 30 requests a minute on /api/ai per address, and
    // each question is two (clear the thread, ask): pace to 14 questions a minute, and wait out a
    // Sentinel 429 (the hourly-limit 429 carries a reason and stops the run instead).
    let lastAt = 0;
    for (const q of qs) {
      const wait = PACE_MS - (Date.now() - lastAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      await call('DELETE', '/thread');
      const before = relay.chats.length;
      let r;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { r = await call('POST', '/ask', { message: q.question }); } catch (e) { r = { status: 0, body: { error: String(e?.message || e) } }; }
        if (r.status !== 429 || r.body?.reason) break;
        await new Promise((res) => setTimeout(res, 20000));
      }
      const answer = r.body?.answer?.text;
      const sent = relay.chats.slice(before).filter((c) => c && c.prompt === q.question && typeof c.system === 'string').pop();
      if (r.status !== 200 || typeof answer !== 'string' || !sent) {
        rows.push({ q, error: `HTTP ${r.status} ${r.body?.reason || r.body?.error || (sent ? '' : 'the hub was not called')}`.trim() });
        if (r.status === 429) break;
        continue;
      }
      rows.push({ q, grounding: r.body.answer.grounding || '-', answer, ...scoreAnswer({ q, answer, system: sent.system, labels }) });
    }
  } finally {
    await cleanup();
  }

  console.log('');
  console.log(`${pad('id', 22)} ${pad('grounding', 9)} ${pad('words', 5)} ${pad('invented', 14)} ${pad('screen', 6)} verdict`);
  for (const r of rows) {
    if (r.error) { console.log(`${pad(r.q.id, 22)} ${pad('-', 9)} ${pad('-', 5)} ${pad('-', 14)} ${pad('-', 6)} ERROR ${r.error}`); continue; }
    console.log(`${pad(r.q.id, 22)} ${pad(r.grounding, 9)} ${pad(r.words, 5)} ${pad(r.invented.join(',') || '-', 14)} ${pad(r.q.expectScreenName ? (r.screen ? 'yes' : 'NO') : (r.screen ? 'yes' : '-'), 6)} ${r.verdict}`);
  }
  const answered = rows.filter((r) => !r.error);
  const errors = rows.length - answered.length + (qs.length - rows.length);
  const invented = answered.filter((r) => r.invented.length).length;
  const dashes = answered.filter((r) => r.emDash).length;
  console.log('');
  console.log(`Totals: ${qs.length} asked, ${answered.length} answered, ${errors} unanswered; ${invented} with invented numbers, ${dashes} with an em dash, ${answered.filter((r) => r.words > MAX_WORDS).length} over ${MAX_WORDS} words, ${answered.filter((r) => r.verdict.includes('NO-SCREEN')).length} missing an expected screen, ${answered.filter((r) => r.claim).length} asserting a forbidden claim, ${answered.filter((r) => r.verdict === 'PASS').length} clean.`);
  void headings;
  process.exitCode = invented || dashes ? 1 : errors ? 2 : 0;
}

// Run only when executed, so the scoring functions can be imported.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
