// The account record's size cap (open list, 2026-10-09; email-flow-content.mjs, THE ACCOUNT RECORD'S
// SIZE). One account's whole email record is one hub document, and the hub refuses a document over
// 6,400,000 bytes, so a record past that lived on this server's disk only and the next deploy brought
// back the hub's older copy. server.mjs's own program record code, its REAL loadProgramStore and
// saveProgramStore over a stand-in for hubStorage that hands back one cached object as the real one does,
// and the real route modules on a bare Express app. server.mjs is never booted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { cleanBlockList } from './email-doc.mjs';
import { FLOW_LIMIT, cleanFlow as cleanFlowGraph, isIanaTimezone, isPredictionKey } from './email-flows.mjs';
import { cleanLists, cleanSegments } from './audience.mjs';
import { cleanAttributionWindows } from './email-feeds.mjs';
import { FLOW_TRIGGERS, buildEnrollment, clausesMatch, reentryBlocks } from './email-flows.mjs';
import { enrollChoice } from './email-map.mjs';
import { signalStarterFlows } from './shopify-signals.mjs';
import { storedWaitHours } from './email-flow-content.mjs';
import {
  HUB_DOCUMENT_MAX_BYTES, PROGRAM_RECORD_FULL, PROGRAM_RECORD_MAX_BYTES, cleanAccountSequences, isStarterDraft, mergeAccountSteps,
  programRecordBytes, programRecordCheck, programWriteRefusal, starterFlowOn
} from './email-flow-content.mjs';
import { cleanBroadcastDrafts, setupBroadcastDraftRoutes } from './server/routes/broadcastDraftRoutes.mjs';
import { setupEmailFlowContentRoutes } from './server/routes/emailFlowContentRoutes.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import { setupEmailFlowCreateRoutes } from './server/routes/emailFlowCreateRoutes.mjs';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const SERVER_SRC = read('./server.mjs');

function slice(from, to) {
  const start = SERVER_SRC.indexOf(from);
  assert.ok(start >= 0, `server.mjs no longer contains ${JSON.stringify(from)}`);
  const end = SERVER_SRC.indexOf(to, start + from.length);
  assert.ok(end > start, `server.mjs no longer contains ${JSON.stringify(to)} after ${JSON.stringify(from)}`);
  return SERVER_SRC.slice(start, end + to.length);
}

// server.mjs's program record code. `state.memory` is what hubStorage.get hands back (one object, kept
// across reads, as the real cache is); `state.sets` counts saves and `state.persisted` is the last one.
function loadServer(initialStore = {}) {
  const state = { memory: JSON.parse(JSON.stringify(initialStore)), sets: 0, persisted: null, warnings: [] };
  const hubStorage = {
    get: () => state.memory,
    set: (_key, _file, data) => { state.sets += 1; state.memory = data; state.persisted = JSON.parse(JSON.stringify(data)); }
  };
  const quiet = { warn: (line) => state.warnings.push(String(line)) };
  const build = new Function(
    'hubStorage', 'console', 'cleanBlockList', 'FLOW_LIMIT', 'cleanFlowGraph', 'isIanaTimezone', 'isPredictionKey',
    'cleanLists', 'cleanSegments', 'cleanAttributionWindows', 'cleanAccountSequences', 'mergeAccountSteps',
    'isStarterDraft', 'starterFlowOn', 'cleanBroadcastDrafts', 'programRecordCheck', 'PROGRAM_RECORD_MAX_BYTES', 'HUB_DOCUMENT_MAX_BYTES',
    `
    ${slice('function loadProgramStore() {', '\n}\n')}
    ${slice('function saveProgramStore(store, changed) {', '\n}\n')}
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
      userProgramBag, writeUserPrograms, cleanSteps, cleanBlocks, cleanLibrary, sequenceStepsFor,
      presentSequenceRow, presentAutomationRow, presentOrderEmailRow, INITIAL_DRIP_SEQUENCES
    };
    `
  );
  const server = build(hubStorage, quiet, cleanBlockList, FLOW_LIMIT, cleanFlowGraph, isIanaTimezone, isPredictionKey,
    cleanLists, cleanSegments, cleanAttributionWindows, cleanAccountSequences, mergeAccountSteps,
    isStarterDraft, starterFlowOn, cleanBroadcastDrafts, programRecordCheck, PROGRAM_RECORD_MAX_BYTES, HUB_DOCUMENT_MAX_BYTES);
  return { server, state };
}

// One account's record filled to `room` bytes under the cap, through the real writer. A sent key has no
// length cap of its own, so one long key brings the record to an exact size.
function fillTo(server, state, room) {
  const bag = server.userProgramBag('u1');
  bag.sentKeys = [''];
  server.writeUserPrograms('u1', bag);
  const base = programRecordBytes(state.memory.u1);
  bag.sentKeys = ['k'.repeat(PROGRAM_RECORD_MAX_BYTES - room - base)];
  const saved = server.writeUserPrograms('u1', bag);
  assert.equal(saved?.ok, true, `the fill itself was refused: ${JSON.stringify(saved)}`);
  assert.equal(programRecordBytes(state.memory.u1), PROGRAM_RECORD_MAX_BYTES - room, 'the fill did not land where it was measured to');
}

async function listen(mount) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mount(app);
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const call = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}${route}`, {
      method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000)
    });
    return { status: res.status, body: await res.json() };
  };
  return { call, close: () => new Promise((r) => { listener.closeAllConnections(); listener.close(r); }) };
}
const requireUser = (req, _res, next) => { req.user = { uid: 'u1' }; next(); };

test('the cap sits under the hub document limit with room to spare, and its sentence names what to delete with no dash', () => {
  assert.equal(HUB_DOCUMENT_MAX_BYTES, 6400000, 'the hub SDK says 413 over 6,400,000 bytes (hub-sdk.js, store.docs.put)');
  assert.match(read('./hub-sdk.js'), /413 over 6,400,000 bytes/, 'the hub SDK no longer states the limit this cap is under');
  assert.ok(PROGRAM_RECORD_MAX_BYTES <= HUB_DOCUMENT_MAX_BYTES - 1000000, 'the cap leaves less than a megabyte for the writes that are never refused');
  assert.match(PROGRAM_RECORD_FULL, /not saved/);
  assert.match(PROGRAM_RECORD_FULL, /delete flows, saved blocks, broadcast drafts or segments/);
  assert.doesNotMatch(PROGRAM_RECORD_FULL, /—| – /);
  assert.equal(PROGRAM_RECORD_FULL.split(/[.!?](\s|$)/).filter((part) => part && part.trim()).length, 1, 'more than one sentence');
});

test('the rule at its edges: at the cap lands, one byte over is refused, smaller than before lands, `always` lands', () => {
  const sized = (n) => ({ k: 'x'.repeat(n - 8) }); // {"k":""} is 8 bytes
  assert.equal(programRecordBytes(sized(100)), 100);
  assert.deepEqual(programRecordCheck(sized(100), undefined, { maxBytes: 100 }), { ok: true, bytes: 100, over: false });
  assert.deepEqual(programRecordCheck(sized(101), sized(100), { maxBytes: 100 }), { ok: false, reason: 'too_large', bytes: 101, maxBytes: 100, error: PROGRAM_RECORD_FULL });
  assert.equal(programRecordCheck(sized(101), undefined, { maxBytes: 100 }).ok, false, 'a new record over the cap landed');
  assert.deepEqual(programRecordCheck(sized(150), sized(160), { maxBytes: 100 }), { ok: true, bytes: 150, over: true });
  assert.deepEqual(programRecordCheck(sized(160), sized(160), { maxBytes: 100 }), { ok: true, bytes: 160, over: true });
  assert.deepEqual(programRecordCheck(sized(170), sized(100), { maxBytes: 100, always: true }), { ok: true, bytes: 170, over: true });
  assert.equal(programWriteRefusal({ ok: true }), null);
  assert.equal(programWriteRefusal(undefined), null);
  assert.deepEqual(programWriteRefusal({ ok: false, bytes: 7, maxBytes: 5, error: PROGRAM_RECORD_FULL }), { success: false, error: PROGRAM_RECORD_FULL, bytes: 7, maxBytes: 5 });
  // Multibyte text is counted in bytes, as the hub counts it, never in characters.
  assert.equal(JSON.stringify({ k: 'é' }).length, 9);
  assert.equal(programRecordBytes({ k: 'é' }), 10);
});

test('a route write that would take the record past the cap is 413 with the sentence, and nothing is saved', async () => {
  const { server, state } = loadServer();
  fillTo(server, state, 20);
  const before = JSON.stringify(state.memory.u1);
  const setsBefore = state.sets;
  const drips = { sequences: JSON.parse(JSON.stringify(server.INITIAL_DRIP_SEQUENCES)), enrollments: [] };
  const ctx = {};
  for (const line of SERVER_SRC.match(/const emailCtx = \{([\s\S]*?)\n\};/)[1].split('\n')) {
    const key = line.replace(/\/\/.*$/, '').trim().replace(/,$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(key)) ctx[key] = () => null;
  }
  Object.assign(ctx, { hub: null, hubReady: false, requireUser, userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms, cleanLibrary: server.cleanLibrary, SAMPLE_MAIL_VARS: {}, DEFAULT_RFM_CONFIG: {} });
  const s = await listen((app) => {
    setupBroadcastDraftRoutes(app, { requireUser, userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms, cleanBlocks: server.cleanBlocks });
    setupEmailFlowContentRoutes(app, {
      requireUser,
      loadDrips: () => drips,
      userProgramBag: server.userProgramBag,
      writeUserPrograms: server.writeUserPrograms,
      cleanSteps: server.cleanSteps,
      cleanBlocks: server.cleanBlocks,
      sequenceStepsFor: server.sequenceStepsFor,
      presentSequenceRow: server.presentSequenceRow,
      presentAutomationRow: server.presentAutomationRow,
      presentOrderEmailRow: server.presentOrderEmailRow
    });
    setupEmailRoutes(app, ctx);
  });
  try {
    const refusal = { success: false, error: PROGRAM_RECORD_FULL };
    const draft = await s.call('POST', '/api/email/broadcast-drafts', { subject: 'Spring restock', blocks: [{ id: 'b', kind: 'text', text: 'The candles are back, and there are more of them this time.' }] });
    assert.equal(draft.status, 413, JSON.stringify(draft.body).slice(0, 200));
    const flow = server.presentAutomationRow(server.userProgramBag('u1').automations.find((row) => row.id === 'post_purchase'));
    flow.nodes.find((node) => node.type === 'email').subject = `Thank you for your order, ${'and for choosing a small shop '.repeat(4)}`.trim();
    const content = await s.call('POST', '/api/email/flow-content/post_purchase', { nodes: flow.nodes, edges: flow.edges });
    assert.equal(content.status, 413, JSON.stringify(content.body).slice(0, 200));
    const library = await s.call('POST', '/api/email/library', { name: 'Footer', block: { id: 'f', kind: 'text', text: 'A footer worth keeping for every email this shop sends.' } });
    assert.equal(library.status, 413, JSON.stringify(library.body).slice(0, 200));
    for (const res of [draft, content, library]) {
      assert.equal(res.body.success, false);
      assert.equal(res.body.error, refusal.error);
      assert.ok(res.body.bytes > PROGRAM_RECORD_MAX_BYTES && res.body.maxBytes === PROGRAM_RECORD_MAX_BYTES, JSON.stringify({ bytes: res.body.bytes, maxBytes: res.body.maxBytes }));
    }
    assert.equal(state.sets, setsBefore, 'a refused write was saved');
    assert.equal(JSON.stringify(state.memory.u1), before, 'a refused write changed the record in memory');
    assert.equal(state.warnings.filter((line) => line.startsWith('[Jourvance] Not saved')).length, 3);

    // The control: a write that makes it smaller (a saved block deleted) lands at once.
    const removed = await s.call('DELETE', '/api/email/library/nothing_here');
    assert.equal(removed.status, 200, JSON.stringify(removed.body).slice(0, 200));
    assert.equal(state.sets, setsBefore + 1);
  } finally {
    await s.close();
  }
});

test('a background writer over the cap keeps the stored copy and logs; a write that records a send or stops mail lands and logs', () => {
  const { server, state } = loadServer();
  fillTo(server, state, 50);
  const stored = JSON.stringify(state.memory.u1);
  const grown = server.userProgramBag('u1');
  grown.postalAddress = `1 Main Street, Springfield, ${'Suite 100, '.repeat(8)}`.trim();
  const refused = server.writeUserPrograms('u1', grown);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, PROGRAM_RECORD_FULL);
  assert.equal(JSON.stringify(state.memory.u1), stored, 'the stored copy was not kept');
  assert.match(state.warnings.at(-1), /^\[Jourvance\] Not saved: account u1's email record would be \d+ bytes, over its 5000000 byte cap\. The stored copy is kept\.$/);

  // An enrolment moved on after its email went out: refusing it would send that email again.
  const sent = server.userProgramBag('u1');
  const key = `order_confirmation:${'1001'.repeat(25)}`;
  sent.sentKeys = [...sent.sentKeys, key];
  const kept = server.writeUserPrograms('u1', sent, { always: true });
  assert.equal(kept.ok, true);
  assert.equal(kept.over, true, 'the send record did not take the record over the cap, so this proves nothing');
  assert.ok(server.userProgramBag('u1').sentKeys.includes(key), 'a sent key over the cap was dropped, so the email goes again');
  assert.match(state.warnings.at(-1), /over its 5000000 byte cap, and was saved because it records an email already sent or stops mail\.$/);
});

test('a record from before the cap, already over it, can still be made smaller', async () => {
  const { server, state } = loadServer();
  fillTo(server, state, 0);
  const bag = server.userProgramBag('u1');
  bag.broadcastDrafts = [{ id: 'bd_old001', userId: 'u1', subject: 'An old draft', previewText: '', blocks: [{ id: 'b', kind: 'text', text: 'x'.repeat(3000) }], settings: {}, updatedAt: '2026-10-01T00:00:00.000Z' }];
  assert.equal(server.writeUserPrograms('u1', bag, { broadcastDrafts: true, always: true }).ok, true);
  const over = programRecordBytes(state.memory.u1);
  assert.ok(over > PROGRAM_RECORD_MAX_BYTES, 'the fixture is not over the cap, so this proves nothing');
  const s = await listen((app) => setupBroadcastDraftRoutes(app, { requireUser, userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms, cleanBlocks: server.cleanBlocks }));
  try {
    const res = await s.call('DELETE', '/api/email/broadcast-drafts/bd_old001');
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
    assert.ok(programRecordBytes(state.memory.u1) < over);
    assert.deepEqual(server.userProgramBag('u1').broadcastDrafts, []);
  } finally {
    await s.close();
  }
});

// The three routes that answered 200 over a refused write (open list, second round): New flow and
// Build a flow (POST /api/email/flows), Results' Save windows (POST /api/email/attribution-windows) and
// a segment's refresh (POST /api/email/segments/:id/refresh, whose one write is noteSegmentChanges').
async function mountCapRoutes(server) {
  const ctx = {};
  for (const line of SERVER_SRC.match(/const emailCtx = \{([\s\S]*?)\n\};/)[1].split('\n')) {
    const key = line.replace(/\/\/.*$/, '').trim().replace(/,$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(key)) ctx[key] = () => null;
  }
  // noteSegmentChanges over an account with no people, orders or events: only the segment state changes.
  Object.assign(ctx, {
    hub: null, hubReady: false, requireUser, userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms,
    cleanLibrary: server.cleanLibrary, SAMPLE_MAIL_VARS: {}, DEFAULT_RFM_CONFIG: {},
    loadOrders: () => [], loadEvents: () => [], loadBehaviorBag: () => ({ events: [] }), contactsForUser: () => [], isDemoRecord: () => false
  });
  return listen((app) => {
    setupEmailFlowCreateRoutes(app, {
      requireUser,
      userProgramBag: server.userProgramBag,
      writeUserPrograms: server.writeUserPrograms,
      cleanFlow: (input) => cleanFlowGraph(input, { cleanBlocks: server.cleanBlocks }),
      flowShapeError: () => '',
      validateFlow: () => ({ ok: true }),
      rememberUntranslated: () => {},
      presentCustomFlow: (flow) => ({ id: flow.id, name: flow.name, enabled: flow.enabled })
    });
    setupAnalyticsRoutes(app, { requireUser, requireOperator: (_req, res) => res.status(403).end(), userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms });
    setupEmailRoutes(app, ctx);
  });
}
const WIDER_WINDOWS = { emailClickDays: 30, emailOpenDays: 30, smsClickDays: 30 };

test('New flow, Save windows and a segment refresh over the cap are 413 with the sentence, and nothing is saved', async () => {
  const { server, state } = loadServer();
  // Two bytes of room: the three wider windows add one byte each, so even that is over.
  fillTo(server, state, 2);
  const before = JSON.stringify(state.memory.u1);
  const setsBefore = state.sets;
  const s = await mountCapRoutes(server);
  try {
    const created = await s.call('POST', '/api/email/flows', { name: 'Restock note', trigger: 'manual' });
    const windows = await s.call('POST', '/api/email/attribution-windows', WIDER_WINDOWS);
    const refreshed = await s.call('POST', '/api/email/segments/all/refresh');
    for (const [name, res] of Object.entries({ created, windows, refreshed })) {
      assert.equal(res.status, 413, `${name}: ${JSON.stringify(res.body).slice(0, 200)}`);
      assert.equal(res.body.success, false, name);
      assert.equal(res.body.error, PROGRAM_RECORD_FULL, name);
      assert.ok(res.body.bytes > PROGRAM_RECORD_MAX_BYTES && res.body.maxBytes === PROGRAM_RECORD_MAX_BYTES, `${name}: ${JSON.stringify({ bytes: res.body.bytes, maxBytes: res.body.maxBytes })}`);
    }
    assert.equal(state.sets, setsBefore, 'a refused write was saved');
    assert.equal(JSON.stringify(state.memory.u1), before, 'a refused write changed the record in memory');
    assert.equal(state.warnings.filter((line) => line.startsWith('[Jourvance] Not saved')).length, 3);
    const bag = server.userProgramBag('u1');
    assert.equal(bag.flows.length, 0, 'the refused flow is on the account');
    assert.deepEqual(bag.attributionWindows, { emailClickDays: 5, emailOpenDays: 5, smsClickDays: 5 }, 'the refused windows are stored');
    assert.deepEqual(bag.segmentState, {}, 'the refused segment state is stored');
  } finally {
    await s.close();
  }
});

test('the control: with room, New flow, Save windows and a segment refresh each land and answer 200', async () => {
  const { server, state } = loadServer();
  const s = await mountCapRoutes(server);
  try {
    const created = await s.call('POST', '/api/email/flows', { name: 'Restock note', trigger: 'manual' });
    assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 200));
    assert.equal(server.userProgramBag('u1').flows[0]?.id, created.body.flow.id);
    const windows = await s.call('POST', '/api/email/attribution-windows', WIDER_WINDOWS);
    assert.equal(windows.status, 200, JSON.stringify(windows.body).slice(0, 200));
    assert.deepEqual(server.userProgramBag('u1').attributionWindows, WIDER_WINDOWS);
    const refreshed = await s.call('POST', '/api/email/segments/all/refresh');
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body).slice(0, 200));
    assert.deepEqual(refreshed.body, { success: true, entered: 0 });
    assert.ok(Object.keys(server.userProgramBag('u1').segmentState).includes('all'), 'the refresh saved no segment state');
    assert.equal(state.sets, 3);
  } finally {
    await s.close();
  }
});

test('source: every write a route makes answers 413 when refused, or is one that stops mail and is never refused', () => {
  // Every write in these modules is read (noteSegmentChanges included: it is the segment refresh
  // route's one write), or is one that stops mail. The minimum is how many writes each module has.
  const files = { 'server/routes/emailRoutes.mjs': 2, 'server/routes/emailFlowContentRoutes.mjs': 2, 'server/routes/broadcastDraftRoutes.mjs': 2, 'server/routes/emailFlowCreateRoutes.mjs': 1, 'server/routes/analyticsRoutes.mjs': 1 };
  for (const [file, least] of Object.entries(files)) {
    const lines = read(`./${file}`).split('\n').map((line, i) => ({ line, at: i + 1 })).filter(({ line }) => /writeUserPrograms\(/.test(line) && !/^\s*(\*|\/\/)/.test(line));
    assert.ok(lines.length >= least, `${file}: only ${lines.length} writes found, so this checks too little`);
    const loose = lines.filter(({ line }) => !/programWriteRefusal\(writeUserPrograms\(/.test(line) && !/always: true/.test(line));
    assert.deepEqual(loose.map(({ line, at }) => `${file}:${at}: ${line.trim()}`), []);
  }
  const route = (head) => {
    const start = SERVER_SRC.indexOf(head);
    assert.ok(start >= 0, `server.mjs no longer has ${head}`);
    return SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n});\n', start));
  };
  assert.match(route("app.post('/api/email/flows/:id', requireUser,"), /const refused = programWriteRefusal\(writeUserPrograms\(req\.user\.uid, bag\)\);\n\s+if \(refused\) return res\.status\(413\)\.json\(refused\);/);
  assert.match(route("app.delete('/api/email/flows/:id', requireUser,"), /writeUserPrograms\(req\.user\.uid, bag, \{ always: true \}\)/);
  assert.match(route("app.post('/api/email/flows/:id/suppress', requireUser,"), /writeUserPrograms\(req\.user\.uid, bag, \{ always: true \}\)/);
  // An unsubscribe and a bounce or complaint are never refused for size.
  const email = read('./server/routes/emailRoutes.mjs');
  assert.match(email, /noteSuppression\(bag\.suppressions, email, 'unsubscribe'\);\n[^\n]*\n\s+writeUserPrograms\(uid, bag, \{ always: true \}\);/);
  assert.match(email, /noteSuppression\(bag\.suppressions, event\.email, event\.type\);\n\s+writeUserPrograms\(event\.uid, bag, \{ always: true \}\);/);
});

test('source: each write that records an email already sent is never refused for size', () => {
  const body = (head) => slice(head, '\n}\n');
  // A refused write here leaves the enrolment or the sent key where it was, so the next pass sends again.
  const built = body('async function processAccountAutomations(uid) {');
  assert.match(built, /if \(untracked\) writeUserPrograms\(uid, fresh, \{ always: true \}\);/);
  assert.match(built, /writeUserPrograms\(uid, latest, \{ always: true \}\);/);
  const custom = body('async function processCustomFlows(uid) {');
  assert.match(custom, /if \(layFlowPass\(latest, bag, before, knownIds\)\) writeUserPrograms\(uid, latest, \{ always: true \}\);\n\s+else writeUserPrograms\(uid, bag, \{ always: true \}\);/);
  assert.match(body('async function sendTransactional(uid, programId, { to, name, dedupeKey, vars, visitorId }) {'), /writeUserPrograms\(uid, fresh, \{ always: true \}\);/);
  // A person handed to Klaviyo is recorded whatever the size.
  assert.match(body('async function enrollFlowsForTrigger(uid, trigger, contact, vars, context, bagIn) {'), /writeUserPrograms\(uid, bag, \{ always: handedOff > 0 \}\)/);
});

// Fix round of the open list: the writers outside a route. Each one built its enrolments on the bag,
// wrote it, and went on as if the write had landed. userProgramBag handed back the stored record's own
// enrolments array, so an enrolment a refused write had added stayed on the record in memory, and the
// next pass mailed it and then saved it with `always`. The webhooks' price drop and stock enrolments
// counted the people a refused write had dropped, and a hand-off to Klaviyo made there or in the segment
// pass was written without `always`, so a refusal dropped the record of it and the next signal handed
// the same people off again.
const QUIET_BUYER = 'quiet@example.test';
const WATCHER = 'watcher@example.test';

function automationsPass(server, sent) {
  const deps = {
    Date,
    composeForSend: async () => ({ text: 't', html: '<p>t</p>', vars: {} }),
    contactsForUser: () => [],
    deliverLetter: async (mail) => { sent.push(mail.to); return { ok: true, status: 'sent' }; },
    fillMailTokens: (text) => text,
    isDemoRecord: () => false,
    klaviyoIsSender: () => false,
    loadOrders: () => [{ userId: 'u1', customerEmail: QUIET_BUYER, customerName: 'Quiet', createdAt: '2026-01-01T00:00:00.000Z' }],
    orderMailVars: () => ({}),
    processCustomFlows: async () => ({ sent: 0, failed: 0, active: 0 }),
    storedWaitHours,
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms
  };
  const names = Object.keys(deps);
  return new Function(...names, `${slice('async function processAccountAutomations(uid) {', '\n}\n')}\nreturn processAccountAutomations;`)(...names.map((n) => deps[n]));
}

function builtInsOn(server) {
  const bag = server.userProgramBag('u1');
  for (const id of ['post_purchase', 'winback']) bag.automations.find((row) => row.id === id).enabled = true;
  assert.equal(server.writeUserPrograms('u1', bag).ok, true);
}

test('an enrolment a refused write added is on no record, in memory or saved, and the pass after it mails nobody', async () => {
  const { server, state } = loadServer();
  builtInsOn(server);
  fillTo(server, state, 20);
  const stored = JSON.stringify(state.memory.u1);
  // An order's post-purchase flow (enrollAutomation, the orders webhook): refused, so it answers false.
  const enrollAutomation = new Function('klaviyoIsSender', 'userProgramBag', 'writeUserPrograms',
    `${slice('function enrollAutomation(uid, automationId, contact, vars) {', '\n}\n')}\nreturn enrollAutomation;`
  )(() => false, server.userProgramBag, server.writeUserPrograms);
  assert.equal(enrollAutomation('u1', 'post_purchase', { email: 'buyer@example.test', name: 'Buyer' }, {}), false);
  assert.deepEqual(server.userProgramBag('u1').enrollments, [], 'an enrolment the write refused is on the record in memory');
  // The built-in flows' pass enrols a quiet buyer in the win-back flow, whose one email is due at once.
  const sent = [];
  const result = await automationsPass(server, sent)('u1');
  assert.deepEqual(sent, [], 'an enrolment the write refused was mailed');
  assert.equal(result.sent, 0);
  assert.deepEqual(server.userProgramBag('u1').enrollments, [], 'an enrolment the write refused is on the record');
  assert.equal(JSON.stringify(state.memory.u1), stored, 'the record in memory changed');
  // The pass's own last write (`always`) saves the record unchanged.
  assert.equal(JSON.stringify(state.persisted.u1), stored, 'a refused enrolment was saved');
});

test('the control: with room, the win-back buyer is enrolled, mailed once, and the enrolment is saved', async () => {
  const { server } = loadServer();
  builtInsOn(server);
  const sent = [];
  const result = await automationsPass(server, sent)('u1');
  assert.deepEqual(sent, [QUIET_BUYER]);
  assert.equal(result.sent, 1);
  const row = server.userProgramBag('u1').enrollments.find((r) => r.email === QUIET_BUYER);
  assert.equal(row?.status, 'completed', JSON.stringify(row));
});

// server.mjs's own enrollFlowsForTrigger, with Klaviyo the sender (`klaviyo`) or not. `handed` lists
// every person handed to Klaviyo.
function realEnroll(server, klaviyo) {
  const handed = [];
  const enterKlaviyoFlow = async (_uid, _flowId, contact) => { handed.push(contact.email); return { entered: true, status: 'added_to_list', detail: 'Added to the list.' }; };
  const enrollFlowsForTrigger = new Function(
    'FLOW_TRIGGERS', 'klaviyoIsSender', 'enrollChoice', 'reentryBlocks', 'enterKlaviyoFlow', 'graphContext', 'clausesMatch', 'buildEnrollment', 'writeUserPrograms', 'userProgramBag',
    `${slice('async function enrollFlowsForTrigger(uid, trigger, contact, vars, context, bagIn) {', '\n}\n')}\nreturn enrollFlowsForTrigger;`
  )(FLOW_TRIGGERS, () => klaviyo, enrollChoice, reentryBlocks, enterKlaviyoFlow, () => ({}), clausesMatch, buildEnrollment, server.writeUserPrograms, server.userProgramBag);
  return { enrollFlowsForTrigger, handed };
}

// A starter signal flow turned on, linked to a Klaviyo flow when Klaviyo sends.
function signalFlowOn(server, id, klaviyo) {
  const bag = server.userProgramBag('u1');
  const flow = signalStarterFlows().find((row) => row.id === id);
  bag.flows = [{ ...flow, enabled: true, ...(klaviyo ? { klaviyoFlowId: 'KlFlow1' } : {}) }];
  assert.equal(server.writeUserPrograms('u1', bag).ok, true);
  assert.equal(server.userProgramBag('u1').flows[0]?.enabled, true, `${id} did not stay on`);
}

// The webhooks' two signal writers (products/update and inventory_levels/update), from server.mjs.
function signalWriters(server, enrollFlowsForTrigger) {
  const deps = {
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    enrollFlowsForTrigger,
    priceDropQualifies: () => true,
    lowInventoryQualifies: () => true,
    watchersForVariant: () => [WATCHER],
    contactForEnroll: (_uid, email) => ({ email, name: 'Watcher', phone: '' }),
    personFields: () => ({}),
    loadBehaviorBag: () => ({ events: [], subscriptions: [] }),
    saveBehaviorBag: () => {},
    restockRecipients: () => [WATCHER],
    stampRestockFired: (subs) => subs,
    rearmRestock: (subs) => subs
  };
  const names = Object.keys(deps);
  return new Function(...names, `
    ${slice('async function enrollPriceDrops(uid, changes) {', '\n}\n')}
    ${slice('async function enrollInventorySignals(uid, changes) {', '\n}\n')}
    return { enrollPriceDrops, enrollInventorySignals };
  `)(...names.map((n) => deps[n]));
}

const SIGNALS = [
  { flowId: 'flow_pricedrop', writer: 'enrollPriceDrops', change: { variantId: 'v1', price: 18, previousPrice: 24 } },
  { flowId: 'flow_backinstock', writer: 'enrollInventorySignals', change: { variantId: 'v1', available: 5, previousAvailable: 0 } }
];

test('a price drop or stock enrolment a refused write dropped counts nobody, and with room it counts and is saved', async () => {
  for (const { flowId, writer, change } of SIGNALS) {
    const full = loadServer();
    signalFlowOn(full.server, flowId, false);
    fillTo(full.server, full.state, 20);
    const stored = JSON.stringify(full.state.memory.u1);
    const count = await signalWriters(full.server, realEnroll(full.server, false).enrollFlowsForTrigger)[writer]('u1', [change]);
    assert.equal(count, 0, `${writer} counted ${count} enrolled over a refused write`);
    assert.equal(JSON.stringify(full.state.memory.u1), stored, `${writer}: the stored copy changed`);
    assert.deepEqual(full.server.userProgramBag('u1').flowEnrollments, [], `${writer}: a refused enrolment is on the record`);

    const room = loadServer();
    signalFlowOn(room.server, flowId, false);
    const counted = await signalWriters(room.server, realEnroll(room.server, false).enrollFlowsForTrigger)[writer]('u1', [change]);
    assert.equal(counted, 1, `the control: ${writer} counted ${counted}`);
    assert.deepEqual(room.server.userProgramBag('u1').flowEnrollments.map((row) => [row.flowId, row.email, row.status]), [[flowId, WATCHER, 'active']], `the control: ${writer} saved no enrolment`);
  }
});

test('a hand-off to Klaviyo from a price drop or stock signal is recorded over the cap, so the next signal does not hand off again', async () => {
  for (const { flowId, writer, change } of SIGNALS) {
    const { server, state } = loadServer();
    signalFlowOn(server, flowId, true);
    fillTo(server, state, 20);
    const { enrollFlowsForTrigger, handed } = realEnroll(server, true);
    const writers = signalWriters(server, enrollFlowsForTrigger);
    const count = await writers[writer]('u1', [change]);
    assert.deepEqual(handed, [WATCHER], `${writer}: the fixture handed off ${JSON.stringify(handed)}, so this proves nothing`);
    assert.equal(count, 1, `${writer}: a person handed to Klaviyo was counted ${count}`);
    assert.deepEqual(server.userProgramBag('u1').flowEnrollments.map((row) => [row.email, row.status]), [[WATCHER, 'handed_to_klaviyo']], `${writer}: the hand-off was not recorded`);
    assert.match(state.warnings.at(-1), /was saved because it records an email already sent or stops mail\.$/, `${writer}: ${state.warnings.at(-1)}`);
    await writers[writer]('u1', [change]);
    assert.deepEqual(handed, [WATCHER], `${writer}: the same person was handed to Klaviyo again`);
  }
});

test('a hand-off to Klaviyo from the segment pass is recorded over the cap, so the next pass does not hand off again', async () => {
  const { server, state } = loadServer();
  const bag = server.userProgramBag('u1');
  bag.flows = [{ ...signalStarterFlows().find((row) => row.id === 'flow_pricedrop'), id: 'flow_segment', name: 'Entered All marketing', trigger: 'segment_entered', enabled: true, klaviyoFlowId: 'KlFlow1' }];
  // All marketing already counted once, empty: whoever matches it now has newly entered it.
  bag.segmentState = { all: { baselined: true, members: {} } };
  assert.equal(server.writeUserPrograms('u1', bag).ok, true);
  assert.equal(server.userProgramBag('u1').flows[0]?.trigger, 'segment_entered', 'the segment flow was not kept');
  fillTo(server, state, 20);
  const { enrollFlowsForTrigger, handed } = realEnroll(server, true);
  const ctx = {};
  for (const line of SERVER_SRC.match(/const emailCtx = \{([\s\S]*?)\n\};/)[1].split('\n')) {
    const key = line.replace(/\/\/.*$/, '').trim().replace(/,$/, '');
    if (/^[A-Za-z_$][\w$]*$/.test(key)) ctx[key] = () => null;
  }
  Object.assign(ctx, {
    hub: null, hubReady: false, requireUser, userProgramBag: server.userProgramBag, writeUserPrograms: server.writeUserPrograms, enrollFlowsForTrigger,
    SAMPLE_MAIL_VARS: {}, DEFAULT_RFM_CONFIG: {}, loadOrders: () => [], loadEvents: () => [], loadBehaviorBag: () => ({ events: [] }), isDemoRecord: () => false,
    contactsForUser: () => [{ email: WATCHER, name: 'Watcher', userId: 'u1', acceptsMarketing: true }]
  });
  const { noteSegmentChanges } = setupEmailRoutes(express(), ctx);
  const noted = await noteSegmentChanges('u1');
  assert.deepEqual(handed, [WATCHER], `the fixture handed off ${JSON.stringify(handed)}, so this proves nothing`);
  assert.equal(noted.refused, undefined, `the pass that handed someone off was refused: ${JSON.stringify(noted).slice(0, 200)}`);
  assert.equal(noted.byId.all, 1);
  assert.deepEqual(server.userProgramBag('u1').flowEnrollments.map((row) => [row.email, row.status]), [[WATCHER, 'handed_to_klaviyo']], 'the hand-off was not recorded');
  await noteSegmentChanges('u1');
  assert.deepEqual(handed, [WATCHER], 'the same person was handed to Klaviyo again');
});
