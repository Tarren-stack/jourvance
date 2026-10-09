// POST /api/email/flows (EMAIL_STUDIO_PLAN.md Wave 7): the route module on a bare Express app.
// server.mjs is never booted. Its own program record code (userProgramBag, writeUserPrograms, the
// cleaners they call), cleanFlow, rememberUntranslated and presentCustomFlow are sliced out of the
// file and run over an in-memory store, so what this pins is what the server stores and answers,
// through the real field lists. The graph a funnel step builds comes from src/lib/editorReturn.ts's
// flowFromStepLetters, the function the canvas calls, so the client and the route are checked together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { cleanBlockList, untranslatedInDocument } from './email-doc.mjs';
import { FLOW_LIMIT, cleanFlow as cleanFlowGraph, countSendNodes, flowShapeError, isIanaTimezone, isPredictionKey, validateFlow } from './email-flows.mjs';
import { cleanLists, cleanSegments } from './audience.mjs';
import { cleanAttributionWindows } from './email-feeds.mjs';
import { cleanAccountSequences } from './email-flow-content.mjs';
import { enrollmentCount } from './email-map.mjs';
import { cleanBroadcastDrafts } from './server/routes/broadcastDraftRoutes.mjs';
import { FLOW_GRAPH_DROPPED, FLOW_GRAPH_SHAPE, FLOW_LIMIT_REACHED, FLOW_NOT_CREATED, setupEmailFlowCreateRoutes } from './server/routes/emailFlowCreateRoutes.mjs';

const { flowFromStepLetters } = await import('./src/lib/editorReturn.ts');
const { DEFAULT_LEAD_CAPTURE_PROJECT } = await import('./src/lib/defaultBlueprint.ts');

const SERVER_SRC = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + to.length);
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// server.mjs's program record code over a store held here. `saves` counts every write.
function loadServer(initialStore) {
  const state = { store: clone(initialStore), saves: 0 };
  const build = new Function(
    'state', 'cleanBlockList', 'FLOW_LIMIT', 'cleanFlowGraph', 'isIanaTimezone', 'isPredictionKey',
    'cleanLists', 'cleanSegments', 'cleanAttributionWindows', 'cleanAccountSequences', 'cleanBroadcastDrafts',
    'untranslatedInDocument', 'validateFlow', 'enrollmentCount', 'countSendNodes',
    `
    function loadProgramStore() { return state.store; }
    function saveProgramStore(store) { state.saves += 1; state.store = JSON.parse(JSON.stringify(store)); }
    function messageStatsFor() { return null; }
    ${slice('function block(id, kind, text, extra) {', '\n}\n')}
    ${slice('const TRANSACTIONAL_DEFAULTS = [', '\n];\n')}
    ${slice('const AUTOMATION_DEFAULTS = [', '\n];\n')}
    ${slice('function cleanBlocks(input, fallback) {', '\n}\n')}
    ${slice('function cleanCouponCodes(input) {', '\n}\n')}
    ${slice('function cleanLibrary(input) {', '\n}\n')}
    ${slice('function cleanSteps(input, fallback) {', '\n}\n')}
    ${slice('function userProgramBag(uid) {', '\n}\n')}
    ${slice('function cleanSegmentState(input) {', '\n}\n')}
    ${slice('function cleanProfiles(input) {', '\n}\n')}
    ${slice('function writeUserPrograms(uid, bag, edits = {}) {', '\n}\n')}
    ${slice('function cleanFlow(input) {', '\n}\n')}
    ${slice('function rememberUntranslated(flow) {', '\n}\n')}
    ${slice('function presentCustomFlow(flow, bag, uid) {', '\n}\n')}
    return { userProgramBag, writeUserPrograms, cleanFlow, rememberUntranslated, presentCustomFlow };
    `
  );
  const server = build(state, cleanBlockList, FLOW_LIMIT, cleanFlowGraph, isIanaTimezone, isPredictionKey,
    cleanLists, cleanSegments, cleanAttributionWindows, cleanAccountSequences, cleanBroadcastDrafts,
    untranslatedInDocument, validateFlow, enrollmentCount, countSendNodes);
  return { server, state };
}

async function serve(store = {}) {
  const { server, state } = loadServer(store);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  setupEmailFlowCreateRoutes(app, {
    // Stands in for the real requireUser: no user is 401 and the handler never runs.
    requireUser: (req, res, next) => {
      const uid = req.get('x-test-user');
      if (!uid) return res.status(401).json({ success: false, error: 'Sign in first.' });
      req.user = { uid };
      next();
    },
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanFlow: server.cleanFlow,
    flowShapeError,
    validateFlow,
    rememberUntranslated: server.rememberUntranslated,
    presentCustomFlow: server.presentCustomFlow
  });
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${listener.address().port}/api/email/flows`;
  const post = async (body, uid = 'u1') => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-user': uid } : {}) },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, state, post, close: () => new Promise((r) => listener.close(r)) };
}

const flowsOf = (state, uid) => state.store?.[uid]?.flows || null;
const homeStep = () => clone(DEFAULT_LEAD_CAPTURE_PROJECT.nodes.find((n) => n.id === 'node-seq-1').data);

test('no user is 401 and nothing is written', async () => {
  const s = await serve();
  try {
    const r = await s.post({ name: 'x' }, '');
    assert.equal(r.status, 401);
    assert.equal(s.state.saves, 0);
  } finally { await s.close(); }
});

test('New flow\'s body still makes one empty email, off, first in the list', async () => {
  const s = await serve();
  try {
    const r = await s.post({ name: 'New flow', trigger: 'manual' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.success, true);
    assert.equal(r.body.flow.kind, 'flow');
    assert.equal(r.body.flow.enabled, false);
    assert.deepEqual(r.body.flow.nodes.map((n) => [n.id, n.type]), [['n_start', 'trigger'], ['n_mail', 'email']]);
    assert.equal(r.body.flow.nodes[1].subject, 'A note from the store');
    const stored = flowsOf(s.state, 'u1');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, r.body.flow.id);
  } finally { await s.close(); }
});

test('a funnel step\'s letters are created whole: every email, subject, block and wait, off, on the caller\'s account only', async () => {
  const s = await serve();
  try {
    const plan = flowFromStepLetters(homeStep());
    assert.equal(plan.ok, true);
    // enabled: true in the body is ignored, a new flow is always off.
    const r = await s.post({ ...plan.flow, enabled: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const flow = r.body.flow;
    assert.equal(flow.name, 'Nurture & Booking Flow');
    assert.equal(flow.trigger, 'manual');
    assert.equal(flow.enabled, false);
    assert.equal(flow.stepCount, 3);
    assert.equal(flow.compileError, '');
    assert.deepEqual(flow.nodes.filter((n) => n.type === 'email').map((n) => n.subject), ['You are on the list', 'A follow-up', 'One more note']);
    assert.deepEqual(flow.nodes.filter((n) => n.type === 'delay').map((n) => n.delayMinutes), [1440, 4320]);
    assert.equal(flow.edges.length, plan.flow.edges.length);
    const stored = flowsOf(s.state, 'u1');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].enabled, false);
    assert.deepEqual(stored[0].nodes.map((n) => n.id), plan.flow.nodes.map((n) => n.id));
    assert.equal(flowsOf(s.state, 'u2'), null, 'another account was written');
  } finally { await s.close(); }
});

test('a start from the step\'s kind is kept, and paragraphs arrive as text blocks', async () => {
  const s = await serve();
  try {
    const plan = flowFromStepLetters({
      label: 'Cart step', sequenceType: 'checkout_recovery',
      steps: [{ id: 'a', channel: 'email', delay: '1 Hour', subject: 'Your cart', previewText: 'Still here', body: 'Hi [First Name],\n\n[Checkout Link]' }]
    });
    const r = await s.post(plan.flow);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.flow.trigger, 'checkout_abandonment');
    const mail = r.body.flow.nodes.find((n) => n.type === 'email');
    assert.equal(mail.previewText, 'Still here');
    assert.deepEqual(mail.blocks.map((b) => [b.kind, b.text]), [['text', 'Hi {{first_name}},'], ['text', '{{checkout_url}}']]);
  } finally { await s.close(); }
});

test('a graph the cleaner would shorten, a half graph, a loop and an oversize graph are refused and write nothing', async () => {
  const s = await serve();
  try {
    const good = flowFromStepLetters(homeStep()).flow;
    const cases = [
      [{ ...good, nodes: [...good.nodes, { id: 'n_odd', type: 'teleport' }] }, 400, FLOW_GRAPH_DROPPED],
      [{ ...good, edges: [...good.edges, { id: 'e_x', source: 'n_start', target: 'n_gone', branch: '' }] }, 400, FLOW_GRAPH_DROPPED],
      [{ ...good, edges: undefined, nodes: good.nodes }, 400, FLOW_GRAPH_SHAPE],
      [{ name: 'x', nodes: 'n_start', edges: [] }, 400, FLOW_GRAPH_SHAPE],
      [{ ...good, nodes: good.nodes.filter((n) => n.type !== 'trigger') }, 400, FLOW_NOT_CREATED],
      [{ ...good, edges: [...good.edges, { id: 'e_back', source: 'n_mail_3', target: 'n_mail_1', branch: '' }] }, 400, 'That flow loops back on itself.'],
      [{ ...good, nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, type: i ? 'email' : 'trigger' })), edges: [] }, 400, 'A flow can have 60 steps.']
    ];
    for (const [body, status, error] of cases) {
      const r = await s.post(body);
      assert.equal(r.status, status, `${error}: ${JSON.stringify(r.body)}`);
      assert.deepEqual(r.body, { success: false, error });
    }
    assert.equal(s.state.saves, 0, 'a refused create wrote');
  } finally { await s.close(); }
});

test('at the account\'s flow cap a create is refused, and no flow is pushed off the end', async () => {
  const full = { u1: { flows: Array.from({ length: FLOW_LIMIT }, (_, i) => ({
    id: `flow_old${i}`, name: `Old ${i}`, enabled: false, trigger: 'manual',
    nodes: [{ id: 'n_start', type: 'trigger' }], edges: []
  })) } };
  const s = await serve(full);
  try {
    assert.equal(s.server.userProgramBag('u1').flows.length, FLOW_LIMIT, 'the fixture did not load as a full account');
    const r = await s.post(flowFromStepLetters(homeStep()).flow);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { success: false, error: FLOW_LIMIT_REACHED });
    assert.equal(s.state.saves, 0);
    assert.equal(flowsOf(s.state, 'u1').at(-1).id, `flow_old${FLOW_LIMIT - 1}`, 'the oldest flow is gone');
  } finally { await s.close(); }
});
