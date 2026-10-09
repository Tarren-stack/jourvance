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
import { FLOW_LIMIT, TRIGGER_META, cleanFlow as cleanFlowGraph, isIanaTimezone, isPredictionKey } from './email-flows.mjs';
import { cleanLists, cleanSegments } from './audience.mjs';
import { cleanAttributionWindows } from './email-feeds.mjs';
import { cleanAccountSequences, mergeAccountSteps } from './email-flow-content.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import {
  FLOW_CONTENT_EMPTY, FLOW_CONTENT_NO_SUBJECT, FLOW_CONTENT_NOT_FOUND, FLOW_CONTENT_SHAPE, FLOW_CONTENT_WAIT, ORDER_EMAIL_NO_WAIT, firstWaitFixed, setupEmailFlowContentRoutes
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
    ${slice('// D2 and Wave 4: an order email as a one-email flow', '\n}\n')}
    return {
      userProgramBag, writeUserPrograms, cleanSteps, cleanBlocks, sequenceStepsFor, chainGraph,
      presentSequenceRow, presentAutomationRow, presentOrderEmailRow, INITIAL_DRIP_SEQUENCES, STARTER_FLOW_NOTE,
      TRANSACTIONAL_DEFAULTS, ORDER_EMAIL_TRIGGERS
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
    cleanBlocks: server.cleanBlocks,
    sequenceStepsFor: server.sequenceStepsFor,
    presentSequenceRow: server.presentSequenceRow,
    presentAutomationRow: server.presentAutomationRow,
    presentOrderEmailRow: server.presentOrderEmailRow
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
  const letter = bag.transactional.find((row) => row.id === id);
  if (letter) return clone(server.presentOrderEmailRow(letter));
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

// ---- Wave 4: an order email is a one-email flow, and this route saves its subject and blocks ----

const ORDER_IDS = ['order_confirmation', 'shipping_confirmation', 'order_cancelled', 'refund'];
const NEW_ORDER_BLOCKS = [
  { id: 'o1', kind: 'heading', text: 'Order {{order_number}} is in' },
  { id: 'o2', kind: 'image', url: 'https://images.example.test/order.png', alt: 'Your order' },
  { id: 'o3', kind: 'text', text: 'Thanks, {{first_name}}.' }
];

test('an order email is a one-email flow on the map, started by the event that sends it', () => {
  const { server } = loadServer({});
  const bag = server.userProgramBag('u1');
  assert.deepEqual(bag.transactional.map((row) => row.id), ORDER_IDS, 'the four order emails changed');
  const triggers = new Set(TRIGGER_META.map((row) => row.id));
  for (const letter of bag.transactional) {
    const row = server.presentOrderEmailRow(letter);
    assert.equal(row.kind, 'order');
    assert.equal(row.editable, false, 'an order email is not an account flow');
    assert.equal(row.contentEditable, true);
    assert.ok(triggers.has(row.trigger), `${letter.id} starts on "${row.trigger}", which TRIGGER_META does not word`);
    assert.deepEqual(row.nodes.map((node) => node.type), ['trigger', 'email'], `${letter.id} is not one email with no wait`);
    assert.equal(row.nodes[1].subject, letter.subject);
    assert.deepEqual(row.nodes[1].blocks, letter.blocks);
    assert.ok(row.note.includes(letter.shopifyNotification), `${letter.id}'s note does not name its Shopify notification`);
    assert.doesNotMatch(row.note, /—| – /);
  }
});

test('an order email saves its subject and blocks into the caller\'s record and keeps whether it is on', async () => {
  const s = await serve({ store: { u1: { transactional: { order_confirmation: { enabled: true, subject: 'Stored subject', blocks: [{ id: 'k', kind: 'text', text: 'Kept words' }] } } }, u2: U2_RECORD } });
  try {
    const u2Before = clone(s.state.store.u2);
    const before = clone(s.state.store.u1);
    const row = mapRow(s.server, 'order_confirmation');
    assert.equal(emails(row)[0].subject, 'Stored subject', 'the map does not draw the stored subject');
    emails(row)[0].subject = '  Your order is in  ';
    emails(row)[0].previewText = 'An order email keeps no preview text';
    emails(row)[0].blocks = clone(NEW_ORDER_BLOCKS);
    const res = await s.post('order_confirmation', { nodes: row.nodes, edges: row.edges });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stored = s.state.store.u1.transactional.order_confirmation;
    assert.equal(stored.enabled, true, 'saving the email turned the order email off');
    assert.equal(stored.subject, 'Your order is in', 'the subject is not trimmed the way the programs route trims it');
    assert.deepEqual(stored.blocks.map((block) => block.kind), ['heading', 'image', 'text']);
    assert.equal(stored.blocks[1].url, 'https://images.example.test/order.png');
    assert.equal(stored.previewText, undefined, 'an order email stored a preview text nothing sends');
    // The answer is the flow-map row as it now reads.
    assert.equal(res.body.flow.kind, 'order');
    assert.equal(emails(res.body.flow)[0].subject, 'Your order is in');
    assert.deepEqual(emails(res.body.flow)[0].blocks.map((block) => block.kind), ['heading', 'image', 'text']);
    // Nothing else moved: the other order emails, the starter and built-in emails, the other account.
    const untouched = loadServer({}).server.userProgramBag('fresh').transactional;
    for (const id of ORDER_IDS.slice(1)) {
      const def = untouched.find((r) => r.id === id);
      assert.deepEqual(s.state.store.u1.transactional[id], { enabled: false, subject: def.subject, blocks: def.blocks }, `${id} changed`);
    }
    assert.deepEqual(s.state.store.u1.sequences, before.sequences ?? {});
    assert.deepEqual(s.state.store.u2, u2Before);
    assert.deepEqual(s.dripData, s.dripSnapshot);
  } finally { await s.close(); }
});

test('an order email saves exactly what POST /api/email/programs/:id saves for the transactional kind', async () => {
  const subject = 'A refund was made on {{order_number}}';
  // Through the flow-content route, from the chain the map drew.
  const viaMap = await serve();
  const row = mapRow(viaMap.server, 'refund');
  emails(row)[0].subject = subject;
  emails(row)[0].blocks = clone(NEW_ORDER_BLOCKS);
  try {
    assert.equal((await viaMap.post('refund', { nodes: row.nodes, edges: row.edges })).status, 200);
  } finally { await viaMap.close(); }
  // Through the programs route, the way the order letter cards saved it before Wave 4.
  const { server, state } = loadServer({});
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanSteps: server.cleanSteps,
    cleanBlocks: server.cleanBlocks,
    suitePayload: () => ({})
  });
  const listener = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  try {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}/api/email/programs/refund`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'transactional', enabled: false, subject, blocks: clone(NEW_ORDER_BLOCKS) })
    });
    assert.equal(res.status, 200);
  } finally {
    listener.closeAllConnections();
    await new Promise((r) => listener.close(r));
  }
  assert.deepEqual(viaMap.state.store.u1.transactional.refund, state.store.u1.transactional.refund, 'the two routes store an order email differently');
});

test('an order email refuses a wait, a second email, an empty email and a blank subject, and writes nothing', async () => {
  const s = await serve();
  try {
    const cases = {
      'a wait before it': [ORDER_EMAIL_NO_WAIT, (row) => {
        row.nodes.splice(1, 0, { id: 'w', type: 'delay', delayHours: 2 });
        row.edges = [{ id: 'a', source: row.nodes[0].id, target: 'w' }, { id: 'b', source: 'w', target: row.nodes[2].id }];
      }],
      'a second email': [FLOW_CONTENT_SHAPE, (row) => {
        row.nodes.push({ ...clone(emails(row)[0]), id: 'extra' });
        row.edges.push({ id: 'x', source: emails(row)[0].id, target: 'extra' });
      }],
      'an email with nothing in it': [FLOW_CONTENT_EMPTY, (row) => { emails(row)[0].blocks = [{ id: 'd', kind: 'divider' }]; }],
      'a blank subject': [FLOW_CONTENT_NO_SUBJECT, (row) => { emails(row)[0].subject = '   '; }]
    };
    for (const [name, [error, change]] of Object.entries(cases)) {
      const row = mapRow(s.server, 'shipping_confirmation');
      change(row);
      const res = await s.post('shipping_confirmation', { nodes: row.nodes, edges: row.edges });
      assert.equal(res.status, 400, `${name}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { success: false, error }, name);
    }
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, {});
  } finally { await s.close(); }
});

test('another account cannot reach this account\'s order email, even by naming it in the body', async () => {
  const s = await serve({ store: { u1: { transactional: { order_cancelled: { enabled: true, subject: 'U1 cancelled subject', blocks: [{ id: 'u1', kind: 'text', text: 'U1 words' }] } } } } });
  try {
    const u1Before = clone(s.state.store.u1);
    // u2 posts u1's order email id with a body that names u1. The record written is u2's own.
    const row = mapRow(s.server, 'order_cancelled', 'u2');
    emails(row)[0].subject = 'Written by u2';
    const res = await s.post('order_cancelled', { nodes: row.nodes, edges: row.edges, uid: 'u1', userId: 'u1' }, 'u2');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(s.state.store.u1, u1Before, 'u2 changed u1\'s order email');
    assert.equal(s.state.store.u2.transactional.order_cancelled.subject, 'Written by u2');
    assert.equal(emails(res.body.flow)[0].subject, 'Written by u2');
    assert.equal(s.server.userProgramBag('u1').transactional.find((r) => r.id === 'order_cancelled').subject, 'U1 cancelled subject');
  } finally { await s.close(); }
});

test('a bad order email id gets the same 404 body as a missing flow, and nothing is written', async () => {
  const s = await serve();
  try {
    // A chain the route would accept for a real order email, so only the id can refuse it.
    const row = mapRow(s.server, 'order_confirmation');
    const missing = await s.post('drip_seq_does_not_exist', { nodes: row.nodes, edges: row.edges });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { success: false, error: FLOW_CONTENT_NOT_FOUND });
    for (const id of ['order_confirmationx', 'order_confirmation ', 'ORDER_CONFIRMATION', 'order', 'refunds', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.deepEqual(await s.post(id, { nodes: row.nodes, edges: row.edges }), missing, `"${id}" answers differently from a missing flow`);
    }
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, {});
    // The positive control: the real id with the same body saves.
    assert.equal((await s.post('order_confirmation', { nodes: row.nodes, edges: row.edges })).status, 200);
    assert.equal(s.state.saves, 1);
  } finally { await s.close(); }
});

// ---- Wave 4 fix round: a send or a tick that read the record before an order email was saved ----

// POST /api/email/programs/:id over the same in-memory store, for Turn on and Turn off.
async function programRoute(server) {
  const app = express();
  app.use(express.json());
  setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanSteps: server.cleanSteps,
    cleanBlocks: server.cleanBlocks,
    suitePayload: () => ({})
  });
  const listener = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  return {
    post: async (id, body) => {
      const res = await fetch(`http://127.0.0.1:${listener.address().port}/api/email/programs/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json() };
    },
    close: async () => { listener.closeAllConnections(); await new Promise((r) => listener.close(r)); }
  };
}

const STORED_ORDER = { order_confirmation: { enabled: true, subject: 'Stored before the send', blocks: [{ id: 'k', kind: 'text', text: 'Stored words' }] } };

test('a tick or an order send that read the record before an order email was saved cannot put the old email back', async () => {
  const s = await serve({ store: { u1: { transactional: clone(STORED_ORDER) } } });
  const programs = await programRoute(s.server);
  try {
    // What processAccountAutomations and the order sends do: read the whole record, await, write it back.
    const stale = s.server.userProgramBag('u1');

    const row = mapRow(s.server, 'order_confirmation');
    emails(row)[0].subject = 'Saved while the send was out';
    emails(row)[0].blocks = clone(NEW_ORDER_BLOCKS);
    assert.equal((await s.post('order_confirmation', { nodes: row.nodes, edges: row.edges })).status, 200);
    // Turn on, a new subject, and Turn off, through the programs route, the way the list and the cards send them.
    assert.equal((await programs.post('shipping_confirmation', { kind: 'transactional', enabled: true })).status, 200);
    assert.equal((await programs.post('refund', { kind: 'transactional', subject: 'A refund subject saved meanwhile' })).status, 200);
    assert.equal((await programs.post('order_confirmation', { kind: 'transactional', enabled: false })).status, 200);

    // The stale write's own change: a dedupe key.
    stale.sentKeys.push('orders/create:1001');
    s.server.writeUserPrograms('u1', stale);

    const stored = s.state.store.u1.transactional;
    assert.equal(stored.order_confirmation.subject, 'Saved while the send was out', 'the order email\'s subject was put back');
    assert.deepEqual(stored.order_confirmation.blocks.map((block) => block.kind), ['heading', 'image', 'text'], 'its blocks were put back');
    assert.equal(stored.order_confirmation.enabled, false, 'Turn off was put back');
    assert.equal(stored.shipping_confirmation.enabled, true, 'Turn on was put back');
    assert.equal(stored.refund.subject, 'A refund subject saved meanwhile');
    assert.deepEqual(s.state.store.u1.sentKeys, ['orders/create:1001'], 'the stale write\'s own change was not written');
  } finally {
    await programs.close();
    await s.close();
  }
});

test('an order send records only its own key, onto the record as it reads after the send', async () => {
  const s = await serve({ store: { u1: { transactional: clone(STORED_ORDER) } } });
  const programs = await programRoute(s.server);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const delivered = [];
  // server.mjs's own sendTransactional, with the mail itself stood in for: delivery waits on `gate`.
  const sendTransactional = new Function(
    'userProgramBag', 'writeUserPrograms', 'klaviyoIsSender', 'composeForSend', 'fillMailTokens', 'deliverLetter',
    `${slice('async function sendTransactional(', '\n}\n')}\nreturn sendTransactional;`
  )(
    s.server.userProgramBag, s.server.writeUserPrograms, () => false,
    async () => ({ text: 'Text', html: '<p>Text</p>', vars: {} }), (text) => text,
    async (mail) => { delivered.push(mail.subject); await gate; return { ok: true, status: 'sent', messageId: 'msg_1' }; }
  );
  try {
    const sending = sendTransactional('u1', 'order_confirmation', { to: 'buyer@example.test', name: 'Buyer', dedupeKey: 'orders/create:1001', vars: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(delivered, ['Stored before the send'], 'the send did not reach delivery');

    // While it is out: the merchant saves the email and turns another on, and a tick moves someone on.
    const row = mapRow(s.server, 'order_confirmation');
    emails(row)[0].subject = 'Saved during the send';
    assert.equal((await s.post('order_confirmation', { nodes: row.nodes, edges: row.edges })).status, 200);
    assert.equal((await programs.post('order_cancelled', { kind: 'transactional', enabled: true })).status, 200);
    const tick = s.server.userProgramBag('u1');
    tick.enrollments.push({ id: 'penr_meanwhile', automationId: 'post_purchase', email: 'reader@example.test', stepIndex: 1, status: 'active' });
    s.server.writeUserPrograms('u1', tick);

    release();
    assert.equal((await sending).ok, true);
    const stored = s.state.store.u1;
    assert.equal(stored.transactional.order_confirmation.subject, 'Saved during the send', 'the send put the old subject back');
    assert.equal(stored.transactional.order_cancelled.enabled, true, 'the send put Turn on back');
    assert.deepEqual(stored.enrollments.map((row) => row.id), ['penr_meanwhile'], 'the send wrote back the record it read before it was delivered');
    assert.deepEqual(stored.sentKeys, ['orders/create:1001']);
    // The key it recorded stops a second send for the same event (the positive control on the key).
    assert.deepEqual(await sendTransactional('u1', 'order_confirmation', { to: 'buyer@example.test', dedupeKey: 'orders/create:1001', vars: {} }), { status: 'already_sent' });
  } finally {
    release();
    await programs.close();
    await s.close();
  }
});
