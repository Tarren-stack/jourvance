// POST /api/email/flow-content/:id (EMAIL_STUDIO_PLAN.md, Wave 1): the route module on a bare
// Express app. server.mjs is never booted. Its own program record code (userProgramBag,
// writeUserPrograms, cleanSteps), sequenceStepsFor, chainGraph and the flow-map presenters are
// sliced out of the file and run over an in-memory store, so what this pins is what the server
// stores and what it answers, through the real field lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { cleanBlockList } from './email-doc.mjs';
import { FLOW_LIMIT, cleanFlow as cleanFlowGraph, isIanaTimezone, isPredictionKey } from './email-flows.mjs';
import { cleanLists, cleanSegments } from './audience.mjs';
import { cleanAttributionWindows } from './email-feeds.mjs';
import { cleanAccountSequences, mergeAccountSteps } from './email-flow-content.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import {
  FLOW_CONTENT_EMPTY, FLOW_CONTENT_NO_SUBJECT, FLOW_CONTENT_NOT_FOUND, FLOW_CONTENT_SHAPE, FLOW_CONTENT_WAIT, firstWaitFixed, setupEmailFlowContentRoutes
} from './server/routes/emailFlowContentRoutes.mjs';

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
    'cleanLists', 'cleanSegments', 'cleanAttributionWindows', 'cleanAccountSequences', 'mergeAccountSteps',
    `
    function loadProgramStore() { return state.store; }
    function saveProgramStore(store) { state.saves += 1; state.store = JSON.parse(JSON.stringify(store)); }
    ${slice('function block(id, kind, text, extra) {', '\n}\n')}
    ${slice('const TRANSACTIONAL_DEFAULTS = [', '\n];\n')}
    ${slice('const AUTOMATION_DEFAULTS = [', '\n];\n')}
    ${slice('const INITIAL_DRIP_SEQUENCES = [', '\n];\n')}
    ${slice('function cleanBlocks(input, fallback) {', '\n}\n')}
    ${slice('function cleanCouponCodes(input) {', '\n}\n')}
    ${slice('function cleanLibrary(input) {', '\n}\n')}
    ${slice('function cleanSteps(input, fallback) {', '\n}\n')}
    ${slice('function userProgramBag(uid) {', '\n}\n')}
    ${slice('function sequenceStepsFor(seq, bag) {', '\n}\n')}
    ${slice('function cleanSegmentState(input) {', '\n}\n')}
    ${slice('function cleanProfiles(input) {', '\n}\n')}
    ${slice('function writeUserPrograms(uid, bag, edits = {}) {', '\n}\n')}
    ${slice('function cleanFlow(input) {', '\n}\n')}
    ${slice('function chainGraph(prefix, steps) {', '\n}\n')}
    ${slice('// D3: what the step panel says', '\n}\n')}
    ${slice('function presentAutomationRow(row) {', '\n}\n')}
    return {
      userProgramBag, writeUserPrograms, cleanSteps, sequenceStepsFor, chainGraph,
      presentSequenceRow, presentAutomationRow, INITIAL_DRIP_SEQUENCES, STARTER_FLOW_NOTE
    };
    `
  );
  const server = build(state, cleanBlockList, FLOW_LIMIT, cleanFlowGraph, isIanaTimezone, isPredictionKey,
    cleanLists, cleanSegments, cleanAttributionWindows, cleanAccountSequences, mergeAccountSteps);
  return { server, state };
}

// Another account's own sequence, beside the five shared seeds.
const FOREIGN = {
  id: 'drip_seq_u2_private',
  userId: 'u2',
  name: 'Their private series',
  triggerType: 'lead_capture',
  steps: [{ id: 'p_step_1', stepNumber: 1, delayHours: 0, subject: 'Theirs', previewText: 'Theirs', body: 'Theirs', discountVoucher: '' }]
};

const U2_RECORD = { automations: { post_purchase: { enabled: true, steps: [] } }, sequences: { drip_seq_default: { steps: [{ id: 'step_1', subject: 'U2 subject', previewText: '', delayHours: 0, blocks: [{ id: 'u2', kind: 'text', text: 'U2 words' }] }] } } };

async function serve({ store = {}, drips } = {}) {
  const { server, state } = loadServer(store);
  const dripData = clone(drips || { sequences: [...server.INITIAL_DRIP_SEQUENCES, FOREIGN], enrollments: [] });
  const dripSnapshot = clone(dripData);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  setupEmailFlowContentRoutes(app, {
    // Stands in for the real requireUser: no user is 401 and the handler never runs.
    requireUser: (req, res, next) => {
      const uid = req.get('x-test-user');
      if (!uid) return res.status(401).json({ success: false, error: 'Sign in first.' });
      req.user = { uid };
      next();
    },
    loadDrips: () => dripData,
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanSteps: server.cleanSteps,
    sequenceStepsFor: server.sequenceStepsFor,
    presentSequenceRow: server.presentSequenceRow,
    presentAutomationRow: server.presentAutomationRow
  });
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const post = async (id, body, uid = 'u1') => {
    const res = await fetch(`${base}/api/email/flow-content/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-user': uid } : {}) },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  return { server, state, dripData, dripSnapshot, post, close: () => new Promise((r) => listener.close(r)) };
}

// The flow as the map draws it for this account, which is what the client edits and posts back.
function mapRow(server, id, uid = 'u1', dripData) {
  const bag = server.userProgramBag(uid);
  const seq = (dripData?.sequences || server.INITIAL_DRIP_SEQUENCES).find((row) => row.id === id);
  if (seq) return clone(server.presentSequenceRow(seq, bag));
  return clone(server.presentAutomationRow(bag.automations.find((row) => row.id === id)));
}
const emails = (flow) => flow.nodes.filter((node) => node.type === 'email');

test('no signed-in user is 401, and nothing is written', async () => {
  const s = await serve();
  try {
    const row = mapRow(s.server, 'drip_seq_default');
    const res = await s.post('drip_seq_default', { nodes: row.nodes, edges: row.edges }, null);
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(s.state.saves, 0);
  } finally { await s.close(); }
});

test('a save on a shared starter flow writes only the caller\'s record, and the shared sequence is unchanged', async () => {
  const s = await serve({ store: { u2: U2_RECORD } });
  try {
    const u2Before = clone(s.state.store.u2);
    const row = mapRow(s.server, 'drip_seq_default');
    emails(row)[1].subject = 'My second subject';
    emails(row)[1].previewText = 'My second preview';
    const res = await s.post('drip_seq_default', { nodes: row.nodes, edges: row.edges });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(s.state.saves, 1);

    // The caller's record holds the one email it changed; the other two still follow the shared copy.
    const mine = s.state.store.u1.sequences.drip_seq_default.steps;
    assert.deepEqual(mine.map((step) => step.id), ['step_2']);
    assert.equal(mine[0].subject, 'My second subject');
    assert.equal(mine[0].previewText, 'My second preview');
    // Another account's record and the shared sequence are untouched.
    assert.deepEqual(s.state.store.u2, u2Before);
    assert.deepEqual(s.dripData, s.dripSnapshot);
    // So the caller sends its version and the other account still sends its own.
    const shared = s.dripData.sequences.find((seq) => seq.id === 'drip_seq_default');
    assert.equal(s.server.sequenceStepsFor(shared, s.server.userProgramBag('u1'))[1].subject, 'My second subject');
    assert.equal(s.server.sequenceStepsFor(shared, s.server.userProgramBag('u2'))[1].subject, shared.steps[1].subject);
    assert.equal(s.server.sequenceStepsFor(shared, s.server.userProgramBag('u2'))[0].subject, 'U2 subject');
    assert.equal(s.server.sequenceStepsFor(shared, s.server.userProgramBag('u3'))[1].subject, shared.steps[1].subject);
  } finally { await s.close(); }
});

test('another account\'s sequence gets the same 404 body as a missing id, and nothing is written', async () => {
  const s = await serve({ store: { u2: U2_RECORD } });
  try {
    // A chain the route would accept for that sequence, so only the ownership check can refuse it.
    const row = mapRow(s.server, FOREIGN.id, 'u2', s.dripData);
    emails(row)[0].subject = 'Overwritten by u1';
    const storeBefore = clone(s.state.store);
    const foreign = await s.post(FOREIGN.id, { nodes: row.nodes, edges: row.edges }, 'u1');
    const missing = await s.post('drip_seq_does_not_exist', { nodes: row.nodes, edges: row.edges }, 'u1');
    const accountFlow = await s.post('flow_abc123', { nodes: row.nodes, edges: row.edges }, 'u1');
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, { success: false, error: FLOW_CONTENT_NOT_FOUND });
    assert.deepEqual(foreign, missing, 'a foreign sequence and a missing id answer alike');
    assert.deepEqual(accountFlow, missing, 'an account flow saves through its own route');
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, storeBefore);
    assert.deepEqual(s.dripData, s.dripSnapshot);

    // Its owner can save it (the positive control for the refusal above).
    const own = await s.post(FOREIGN.id, { nodes: row.nodes, edges: row.edges }, 'u2');
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(s.state.store.u2.sequences[FOREIGN.id].steps[0].subject, 'Overwritten by u1');
    assert.equal(s.state.store.u1, undefined);
  } finally { await s.close(); }
});

test('a built-in flow saves its steps and keeps whether it is turned on', async () => {
  const s = await serve({ store: { u1: { automations: { post_purchase: { enabled: true }, winback: { enabled: false } } } } });
  try {
    const row = mapRow(s.server, 'post_purchase');
    emails(row)[0].subject = 'Thanks, from us';
    const res = await s.post('post_purchase', { nodes: row.nodes, edges: row.edges });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(s.state.store.u1.automations.post_purchase.enabled, true);
    assert.equal(s.state.store.u1.automations.post_purchase.steps[0].subject, 'Thanks, from us');
    assert.equal(res.body.flow.enabled, true);

    const quiet = mapRow(s.server, 'winback');
    emails(quiet)[0].subject = 'We miss you';
    const off = await s.post('winback', { nodes: quiet.nodes, edges: quiet.edges });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(s.state.store.u1.automations.winback.enabled, false);
    assert.equal(s.state.store.u1.automations.post_purchase.enabled, true, 'the other built-in flow is untouched');
    assert.equal(s.server.userProgramBag('u1').automations.find((a) => a.id === 'winback').steps[0].subject, 'We miss you');
  } finally { await s.close(); }
});

test('a malformed graph is 400 with one sentence and writes nothing', async () => {
  const s = await serve();
  try {
    const sends = {
      'a branch': (row) => { row.edges.push({ id: 'b', source: row.nodes[0].id, target: emails(row)[2].id, branch: 'yes' }); },
      'an extra email': (row) => {
        row.nodes.push({ id: 'more', type: 'email', subject: 'More', blocks: [{ id: 'm', kind: 'text', text: 'm' }] });
        row.edges.push({ id: 'em', source: emails(row)[2].id, target: 'more', branch: '' });
      },
      'a text step': (row) => { row.nodes[2].type = 'sms'; },
      'no nodes': (row) => { delete row.nodes; },
      'a body that is a list': null
    };
    for (const [name, change] of Object.entries(sends)) {
      const row = mapRow(s.server, 'drip_seq_default');
      const body = change ? (change(row), { nodes: row.nodes, edges: row.edges }) : [row.nodes];
      const res = await s.post('drip_seq_default', body);
      assert.equal(res.status, 400, name);
      assert.deepEqual(res.body, { success: false, error: FLOW_CONTENT_SHAPE }, name);
    }
    const zero = mapRow(s.server, 'drip_seq_default');
    zero.nodes.find((node) => node.type === 'delay').delayHours = 0;
    assert.deepEqual((await s.post('drip_seq_default', { nodes: zero.nodes, edges: zero.edges })).body, { success: false, error: FLOW_CONTENT_WAIT });
    const blank = mapRow(s.server, 'drip_seq_default');
    emails(blank)[0].blocks = [];
    assert.deepEqual((await s.post('drip_seq_default', { nodes: blank.nodes, edges: blank.edges })).body, { success: false, error: FLOW_CONTENT_EMPTY });
    const junk = mapRow(s.server, 'drip_seq_default');
    emails(junk)[0].blocks = [null, 'text'];
    assert.deepEqual((await s.post('drip_seq_default', { nodes: junk.nodes, edges: junk.edges })).body,
      { success: false, error: FLOW_CONTENT_EMPTY }, 'blocks that clean to nothing are an empty email');
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, {});
  } finally { await s.close(); }
});

test('the answer is a flow-map row carrying the saved subject, preview text, blocks and waits', async () => {
  const s = await serve();
  try {
    const row = mapRow(s.server, 'drip_seq_cart_recovery');
    const mail = emails(row)[0];
    mail.subject = 'Your cart, still here';
    mail.previewText = 'Pick up where you left off';
    mail.blocks = [
      { id: 'h', kind: 'heading', text: 'Still thinking?' },
      { id: 'img', kind: 'image', url: 'https://cdn.example.org/cart.png', alt: 'Your cart' },
      { id: 'btn', kind: 'button', label: 'Return to checkout', url: '{{abandoned_checkout_url}}' }
    ];
    // Cart recovery: a 1 hour wait, email 1, a 24 hour wait, email 2. The second wait is the account's.
    row.nodes.filter((node) => node.type === 'delay')[1].delayHours = 30;
    const res = await s.post('drip_seq_cart_recovery', { nodes: row.nodes, edges: row.edges });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const flow = res.body.flow;
    assert.equal(flow.id, 'drip_seq_cart_recovery');
    assert.equal(flow.kind, 'sequence');
    assert.equal(flow.editable, false);
    assert.equal(flow.contentEditable, true);
    assert.equal(flow.note, s.server.STARTER_FLOW_NOTE);
    const saved = emails(flow)[0];
    assert.equal(saved.subject, 'Your cart, still here');
    assert.equal(saved.previewText, 'Pick up where you left off');
    assert.deepEqual(saved.blocks.map((b) => b.kind), ['heading', 'image', 'button']);
    assert.equal(saved.blocks[1].url, 'https://cdn.example.org/cart.png');
    assert.equal(saved.blocks[2].label, 'Return to checkout');
    assert.deepEqual(flow.nodes.filter((node) => node.type === 'delay').map((node) => node.delayHours), [1, 30]);
    assert.equal(emails(flow)[1].subject, emails(mapRow(s.server, 'drip_seq_cart_recovery'))[1].subject);
    // The answer is the map row this account now reads.
    assert.deepEqual(flow, mapRow(s.server, 'drip_seq_cart_recovery'));
    // And the sender's steps keep the shared id, step number and voucher with the account's words.
    const shared = s.dripData.sequences.find((seq) => seq.id === 'drip_seq_cart_recovery');
    const sent = s.server.sequenceStepsFor(shared, s.server.userProgramBag('u1'));
    assert.deepEqual(sent.map((step) => [step.id, step.stepNumber, step.discountVoucher]), shared.steps.map((step) => [step.id, step.stepNumber, step.discountVoucher]));
    assert.deepEqual(sent.map((step) => step.delayHours), [1, 30]);
    assert.equal(sent[0].blocks[1].kind, 'image');
  } finally { await s.close(); }
});

test('a starter flow\'s first wait is set at enrollment, so a change to it is refused and nothing is written', async () => {
  const s = await serve();
  try {
    const cart = mapRow(s.server, 'drip_seq_cart_recovery');
    cart.nodes.filter((node) => node.type === 'delay')[0].delayHours = 5;
    const res = await s.post('drip_seq_cart_recovery', { nodes: cart.nodes, edges: cart.edges });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { success: false, error: firstWaitFixed(1) });
    assert.match(res.body.error, /at 1 hours/);

    // Welcome's first email sends at once, so a wait put in front of it is refused the same way.
    const welcome = mapRow(s.server, 'drip_seq_default');
    const first = emails(welcome)[0].id;
    const edge = welcome.edges.find((e) => e.target === first);
    welcome.nodes.push({ id: 'front_wait', type: 'delay', delayHours: 2 });
    welcome.edges.push({ id: 'front_wait_edge', source: 'front_wait', target: first, branch: '' });
    edge.target = 'front_wait';
    const welcomeRes = await s.post('drip_seq_default', { nodes: welcome.nodes, edges: welcome.edges });
    assert.equal(welcomeRes.status, 400);
    assert.deepEqual(welcomeRes.body, { success: false, error: firstWaitFixed(0) });
    assert.equal(s.state.saves, 0);

    // A built-in flow times its first email from its own steps, so its first wait is the account's.
    const after = mapRow(s.server, 'post_purchase');
    after.nodes.filter((node) => node.type === 'delay')[0].delayHours = 6;
    const builtIn = await s.post('post_purchase', { nodes: after.nodes, edges: after.edges });
    assert.equal(builtIn.status, 200, JSON.stringify(builtIn.body));
    assert.equal(s.state.store.u1.automations.post_purchase.steps[0].delayHours, 6);
  } finally { await s.close(); }
});

test('GET /api/drips/sequences lists only the sequences the caller can see, each with its own emails', async () => {
  const { server } = loadServer({ u1: { sequences: { drip_seq_default: { steps: [{ id: 'step_2', subject: 'Listed edit', previewText: 'Listed preview', blocks: [{ id: 'l', kind: 'text', text: 'Listed words' }] }] } } } });
  const drips = { sequences: [...clone(server.INITIAL_DRIP_SEQUENCES), clone(FOREIGN)], enrollments: [] };
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: req.get('x-test-user') }; next(); },
    loadDrips: () => drips,
    userProgramBag: server.userProgramBag,
    sequenceStepsFor: server.sequenceStepsFor,
    sequenceRevenue: () => null
  });
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const list = async (uid) => {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}/api/drips/sequences`, { headers: { 'x-test-user': uid } });
    return { status: res.status, body: await res.json() };
  };
  try {
    const mine = await list('u1');
    assert.equal(mine.status, 200);
    const ids = mine.body.sequences.map((seq) => seq.id);
    assert.deepEqual(ids, server.INITIAL_DRIP_SEQUENCES.map((seq) => seq.id), 'another account\'s sequence is not listed');
    const welcome = mine.body.sequences.find((seq) => seq.id === 'drip_seq_default');
    assert.deepEqual(welcome.steps.map((step) => step.subject), ['You are on the list', 'Listed edit', 'Still thinking it over?']);
    assert.equal(welcome.steps[1].previewText, 'Listed preview');
    assert.equal(welcome.steps[1].stepNumber, 2, 'the shared step number stays');
    assert.equal(welcome.steps[1].blocks[0].text, 'Listed words');

    const theirs = await list('u2');
    assert.ok(theirs.body.sequences.some((seq) => seq.id === FOREIGN.id), 'its owner sees it');
    const shared = theirs.body.sequences.find((seq) => seq.id === 'drip_seq_default');
    assert.equal(shared.steps[1].subject, 'What happens after you opt in', 'another account reads the shared emails');
  } finally {
    listener.closeAllConnections();
    await new Promise((r) => listener.close(r));
  }
});

test('the saved emails survive the next unrelated save, made from a full or a partial record', async () => {
  const s = await serve();
  try {
    const row = mapRow(s.server, 'drip_seq_default');
    emails(row)[2].subject = 'Kept through other saves';
    assert.equal((await s.post('drip_seq_default', { nodes: row.nodes, edges: row.edges })).status, 200);

    // An unrelated save: the timezone, from a bag read the ordinary way.
    const bag = s.server.userProgramBag('u1');
    bag.timezone = 'Europe/London';
    s.server.writeUserPrograms('u1', bag);
    // A save from a record built without the starter-flow layer.
    const partial = { ...s.server.userProgramBag('u1') };
    delete partial.sequences;
    s.server.writeUserPrograms('u1', partial);

    assert.equal(s.state.store.u1.timezone, 'Europe/London');
    const shared = s.dripData.sequences.find((seq) => seq.id === 'drip_seq_default');
    assert.equal(s.server.sequenceStepsFor(shared, s.server.userProgramBag('u1'))[2].subject, 'Kept through other saves');
  } finally { await s.close(); }
});

// ---- Fix round (EMAIL_STUDIO_PLAN.md Wave 1 review) ----

test('an email that cleans to nothing, or has no subject, is refused, and nothing is written', async () => {
  const s = await serve();
  try {
    const empties = {
      'junk the cleaner keeps as one blank text block': [1, null, 'a', []],
      'a text block of spaces': [{ id: 't', kind: 'text', text: '   ' }],
      'a divider and a spacer': [{ id: 'd', kind: 'divider' }, { id: 'sp', kind: 'spacer' }],
      'an image with no address': [{ id: 'i', kind: 'image', url: '' }],
      'an unknown kind with no text': [{ id: 'u', kind: 'bogus' }]
    };
    for (const id of ['drip_seq_default', 'post_purchase']) {
      for (const [name, blocks] of Object.entries(empties)) {
        const row = mapRow(s.server, id);
        emails(row)[1].blocks = blocks;
        const res = await s.post(id, { nodes: row.nodes, edges: row.edges });
        assert.equal(res.status, 400, `${id}, ${name}: ${JSON.stringify(res.body)}`);
        assert.deepEqual(res.body, { success: false, error: FLOW_CONTENT_EMPTY }, `${id}, ${name}`);
      }
      for (const subject of ['', '   ']) {
        const row = mapRow(s.server, id);
        emails(row)[0].subject = subject;
        const res = await s.post(id, { nodes: row.nodes, edges: row.edges });
        assert.equal(res.status, 400, `${id}, subject ${JSON.stringify(subject)}`);
        assert.deepEqual(res.body, { success: false, error: FLOW_CONTENT_NO_SUBJECT });
      }
    }
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, {});
    // The positive control: the same route takes an email with one word in it.
    const ok = mapRow(s.server, 'drip_seq_default');
    emails(ok)[1].blocks = [{ id: 'w', kind: 'text', text: 'One word' }];
    assert.equal((await s.post('drip_seq_default', { nodes: ok.nodes, edges: ok.edges })).status, 200);
  } finally { await s.close(); }
});

test('the wait between two emails cannot be taken out (the review\'s delayHours [0, 0, 48] case)', async () => {
  const s = await serve();
  try {
    for (const id of ['drip_seq_default', 'post_purchase']) {
      const row = mapRow(s.server, id);
      const wait = row.nodes.filter((node) => node.type === 'delay').at(-1);
      const into = row.edges.find((edge) => edge.target === wait.id);
      const out = row.edges.find((edge) => edge.source === wait.id);
      row.nodes = row.nodes.filter((node) => node.id !== wait.id);
      row.edges = row.edges.filter((edge) => edge.id !== out.id);
      into.target = out.target;
      const res = await s.post(id, { nodes: row.nodes, edges: row.edges });
      assert.equal(res.status, 400, `${id}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { success: false, error: FLOW_CONTENT_SHAPE }, id);
    }
    assert.equal(s.state.saves, 0);
  } finally { await s.close(); }
});

test('a tick that read the record before a save, and writes after it, cannot put the old emails back', async () => {
  const s = await serve({ store: { u1: { automations: { post_purchase: { enabled: true } } } } });
  try {
    // What processAccountAutomations and sendTransactional do: read the whole record, then await
    // sends, then write that same object back.
    const stale = s.server.userProgramBag('u1');

    const welcome = mapRow(s.server, 'drip_seq_default');
    emails(welcome)[1].subject = 'Edited while the tick was sending';
    assert.equal((await s.post('drip_seq_default', { nodes: welcome.nodes, edges: welcome.edges })).status, 200);
    const after = mapRow(s.server, 'post_purchase');
    emails(after)[0].subject = 'Built-in edited while the tick was sending';
    assert.equal((await s.post('post_purchase', { nodes: after.nodes, edges: after.edges })).status, 200);

    // The tick's own change: an enrollment moved on.
    stale.enrollments.push({ id: 'penr_1', automationId: 'post_purchase', email: 'reader@example.test', stepIndex: 1, status: 'active' });
    s.server.writeUserPrograms('u1', stale);

    const bag = s.server.userProgramBag('u1');
    assert.equal(bag.enrollments.length, 1, 'the tick\'s own change was written');
    const shared = s.dripData.sequences.find((seq) => seq.id === 'drip_seq_default');
    assert.equal(s.server.sequenceStepsFor(shared, bag)[1].subject, 'Edited while the tick was sending', 'the starter-flow edit was put back');
    const builtIn = bag.automations.find((row) => row.id === 'post_purchase');
    assert.equal(builtIn.steps[0].subject, 'Built-in edited while the tick was sending', 'the built-in edit was put back');
    assert.equal(builtIn.enabled, true);
  } finally { await s.close(); }
});

test('only the emails that differ from the shared copy are stored, so the others still follow it', async () => {
  const s = await serve();
  try {
    const shared = s.dripData.sequences.find((seq) => seq.id === 'drip_seq_default');
    const original = clone(shared.steps);

    // A save with nothing changed stores nothing.
    const same = mapRow(s.server, 'drip_seq_default');
    assert.equal((await s.post('drip_seq_default', { nodes: same.nodes, edges: same.edges })).status, 200);
    assert.equal(s.state.store.u1?.sequences?.drip_seq_default, undefined, 'an unchanged save stored a row');

    const row = mapRow(s.server, 'drip_seq_default');
    emails(row)[0].subject = 'Only this one is mine';
    assert.equal((await s.post('drip_seq_default', { nodes: row.nodes, edges: row.edges })).status, 200);
    assert.deepEqual(s.state.store.u1.sequences.drip_seq_default.steps.map((step) => step.id), ['step_1']);

    // Put back as the shared copy, the account's row goes.
    const back = mapRow(s.server, 'drip_seq_default');
    emails(back)[0].subject = original[0].subject;
    assert.equal((await s.post('drip_seq_default', { nodes: back.nodes, edges: back.edges })).status, 200);
    assert.equal(s.state.store.u1.sequences.drip_seq_default, undefined, 'the row stayed after the edit was put back');

    // Edited again, then the shared copy is corrected (server.mjs recomputeDripCounters rewrites
    // shared text): the emails this account never touched send the corrected copy.
    const again = mapRow(s.server, 'drip_seq_default');
    emails(again)[0].subject = 'Only this one is mine';
    assert.equal((await s.post('drip_seq_default', { nodes: again.nodes, edges: again.edges })).status, 200);
    shared.steps[2].subject = 'The shared subject, corrected later';
    shared.steps[2].body = 'The shared words, corrected later.';
    const sent = s.server.sequenceStepsFor(shared, s.server.userProgramBag('u1'));
    assert.equal(sent[0].subject, 'Only this one is mine');
    assert.equal(sent[2].subject, 'The shared subject, corrected later');
    assert.equal(sent[2].body, 'The shared words, corrected later.');
    assert.equal(sent[2].blocks, undefined, 'email 3 carries frozen blocks, so the sender would not read the corrected body');
  } finally { await s.close(); }
});

test('POST /api/email/programs/:id still writes a built-in flow\'s steps when it sends them, and only then', async () => {
  // A record that already holds its own steps: writeUserPrograms keeps those unless the caller opts
  // in, so this is the record on which a missing opt-in would drop the steps the route was sent.
  const stored = [
    { id: 'pp1', delayHours: 24, subject: 'Stored first subject', previewText: '', blocks: [{ id: 's1', kind: 'text', text: 'Stored words', level: 0 }] },
    { id: 'pp2', delayHours: 72, subject: 'Stored second subject', previewText: '', blocks: [{ id: 's2', kind: 'text', text: 'More stored words', level: 0 }] }
  ];
  const { server, state } = loadServer({ u1: { automations: { post_purchase: { enabled: false, steps: stored } } } });
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanSteps: server.cleanSteps,
    suitePayload: () => ({})
  });
  const listener = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  const post = async (body) => {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}/api/email/programs/post_purchase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const steps = clone(server.userProgramBag('u1').automations.find((row) => row.id === 'post_purchase').steps);
    assert.equal(steps[0].subject, 'Stored first subject', 'the record starts with its own stored steps');
    steps[0].subject = 'Sent through the program route';
    assert.equal((await post({ kind: 'automation', steps })).status, 200);
    assert.equal(state.store.u1.automations.post_purchase.steps[0].subject, 'Sent through the program route', 'the program route no longer writes the steps it was sent');
    // Turning it on sends no steps, and the stored ones stay.
    assert.equal((await post({ kind: 'automation', enabled: true })).status, 200);
    assert.equal(state.store.u1.automations.post_purchase.enabled, true);
    assert.equal(state.store.u1.automations.post_purchase.steps[0].subject, 'Sent through the program route');
  } finally {
    listener.closeAllConnections();
    await new Promise((r) => listener.close(r));
  }
});
