// GET, POST and DELETE /api/email/broadcast-drafts (EMAIL_STUDIO_PLAN.md Wave 5, D4, owner question 9):
// the route module on a bare Express app. server.mjs is never booted. Its own program record code
// (userProgramBag, writeUserPrograms and the cleaners they call) is sliced out of the file and run over
// an in-memory store, so what this pins is what the server stores, through the real field lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { cleanBlockList } from './email-doc.mjs';
import { FLOW_LIMIT, cleanFlow as cleanFlowGraph, isIanaTimezone, isPredictionKey } from './email-flows.mjs';
import { cleanLists, cleanSegments } from './audience.mjs';
import { cleanAttributionWindows } from './email-feeds.mjs';
import { cleanAccountSequences } from './email-flow-content.mjs';
import {
  BROADCAST_DRAFT_LIMIT, BROADCAST_DRAFT_MAX_BYTES, DRAFT_CLIPPED, DRAFT_EMPTY, DRAFT_FULL, DRAFT_NOT_FOUND, DRAFT_TOO_LARGE,
  cleanBroadcastDrafts, draftBytes, setupBroadcastDraftRoutes
} from './server/routes/broadcastDraftRoutes.mjs';

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
    `
    function loadProgramStore() { return state.store; }
    function saveProgramStore(store) { state.saves += 1; state.store = JSON.parse(JSON.stringify(store)); }
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
    return { userProgramBag, writeUserPrograms, cleanBlocks };
    `
  );
  const server = build(state, cleanBlockList, FLOW_LIMIT, cleanFlowGraph, isIanaTimezone, isPredictionKey,
    cleanLists, cleanSegments, cleanAttributionWindows, cleanAccountSequences, cleanBroadcastDrafts);
  return { server, state };
}

async function serve(store = {}) {
  const { server, state } = loadServer(store);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  setupBroadcastDraftRoutes(app, {
    // Stands in for the real requireUser: no user is 401 and the handler never runs.
    requireUser: (req, res, next) => {
      const uid = req.get('x-test-user');
      if (!uid) return res.status(401).json({ success: false, error: 'Sign in first.' });
      req.user = { uid };
      next();
    },
    userProgramBag: server.userProgramBag,
    writeUserPrograms: server.writeUserPrograms,
    cleanBlocks: server.cleanBlocks
  });
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listener.address().port}/api/email/broadcast-drafts`;
  const call = async (method, path, body, uid = 'u1') => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-user': uid } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    server,
    state,
    get: (uid) => call('GET', '', undefined, uid),
    post: (body, uid) => call('POST', '', body, uid),
    del: (id, uid) => call('DELETE', `/${encodeURIComponent(id)}`, undefined, uid),
    close: () => new Promise((r) => listener.close(r))
  };
}

const DRAFT = {
  subject: 'Spring restock',
  previewText: 'The candles are back',
  blocks: [
    { id: 'h1', kind: 'heading', text: 'Back in stock' },
    { id: 't1', kind: 'text', text: 'Hi {{first_name}}, the spring candles are back.' },
    { id: 'btn', kind: 'button', label: 'Shop now', url: 'https://shop.example.test/spring' }
  ],
  settings: {
    include: 'whales', exclude: 'lapsed', sendWhen: 'clock', sendAt: '2026-12-01T09:30', gradualPercent: 20, gradualEvery: 'minute',
    fallbackHour: '', explore: false, smartGradual: false, smartSkip: true, utmSource: 'jv', utmCampaign: 'spring',
    abVariable: 'subject', abSubject: 'The candles are back', abBody: '', abHours: 4, smsMessage: '', smsConfirm: false,
    holdoutOn: true, holdoutPercent: 15
  }
};

// u2's own draft, in u2's own record, written the way the route writes one.
const U2_DRAFT = { id: 'bd_u2private01', userId: 'u2', subject: 'Theirs', previewText: '', blocks: [{ id: 'x', kind: 'text', text: 'Their words' }], settings: {}, updatedAt: '2026-10-01T00:00:00.000Z' };

test('no signed-in user is 401 on every method, and nothing is written', async () => {
  const s = await serve();
  try {
    for (const res of [await s.get(null), await s.post(DRAFT, null), await s.del('bd_anything01', null)]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    }
    assert.equal(s.state.saves, 0);
  } finally {
    await s.close();
  }
});

test('a draft written is read back: subject, preview text, blocks and every setting, owned by the caller', async () => {
  const s = await serve();
  try {
    const saved = await s.post(DRAFT);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.match(saved.body.draft.id, /^bd_[a-z0-9]{6,40}$/);
    assert.equal(s.state.saves, 1);
    const read = await s.get();
    assert.equal(read.status, 200);
    assert.equal(read.body.drafts.length, 1);
    const row = read.body.drafts[0];
    assert.equal(row.id, saved.body.draft.id);
    assert.equal(row.userId, 'u1');
    assert.equal(row.subject, DRAFT.subject);
    assert.equal(row.previewText, DRAFT.previewText);
    assert.deepEqual(row.blocks.map((b) => [b.kind, b.text || b.label]), [['heading', 'Back in stock'], ['text', 'Hi {{first_name}}, the spring candles are back.'], ['button', 'Shop now']]);
    assert.equal(row.blocks[2].url, 'https://shop.example.test/spring');
    assert.deepEqual(row.settings, DRAFT.settings);
    // The record itself holds it, so the composer's next read and the next unrelated save see it.
    assert.equal(s.state.store.u1.broadcastDrafts.length, 1);
    // A second save naming the id changes that draft, and the count stays one.
    const again = await s.post({ ...DRAFT, id: row.id, subject: 'Spring restock, take two' });
    assert.equal(again.status, 200);
    assert.equal(again.body.draft.id, row.id);
    const after = await s.get();
    assert.deepEqual(after.body.drafts.map((d) => d.subject), ['Spring restock, take two']);
  } finally {
    await s.close();
  }
});

test('a draft id that is missing and one that is another account\'s get the same 404 body, and nothing is written', async () => {
  const s = await serve({ u2: { broadcastDrafts: [U2_DRAFT] } });
  try {
    // u2's draft is really there for u2, so the 404 below is not a miss by accident.
    const theirs = await s.get('u2');
    assert.deepEqual(theirs.body.drafts.map((d) => d.id), [U2_DRAFT.id]);
    const before = clone(s.state.store);
    const missingDel = await s.del('bd_nosuchdraft1');
    const foreignDel = await s.del(U2_DRAFT.id);
    const missingPost = await s.post({ ...DRAFT, id: 'bd_nosuchdraft1' });
    const foreignPost = await s.post({ ...DRAFT, id: U2_DRAFT.id });
    for (const res of [missingDel, foreignDel, missingPost, foreignPost]) {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { success: false, error: DRAFT_NOT_FOUND });
    }
    assert.deepEqual(foreignDel, missingDel);
    assert.deepEqual(foreignPost, missingPost);
    assert.equal(s.state.saves, 0);
    assert.deepEqual(s.state.store, before);
    // u1 sees none of u2's drafts.
    assert.deepEqual((await s.get('u1')).body.drafts, []);
  } finally {
    await s.close();
  }
});

test('a row another account wrote is never read, even inside this account\'s record (the ownership filter)', async () => {
  // A record restored or copied under the wrong account: u1's record holds a row u2 wrote.
  const s = await serve({ u1: { broadcastDrafts: [U2_DRAFT] } });
  try {
    assert.deepEqual((await s.get('u1')).body.drafts, [], 'u1 is shown a draft u2 wrote');
    const del = await s.del(U2_DRAFT.id, 'u1');
    assert.equal(del.status, 404);
    assert.deepEqual(del.body, { success: false, error: DRAFT_NOT_FOUND });
    const post = await s.post({ ...DRAFT, id: U2_DRAFT.id }, 'u1');
    assert.equal(post.status, 404);
    assert.deepEqual(post.body, { success: false, error: DRAFT_NOT_FOUND });
    assert.equal(s.state.saves, 0);
  } finally {
    await s.close();
  }
});

test('the body never names whose record or which draft id: a userId in the body is ignored, the id is the server\'s', async () => {
  const s = await serve();
  try {
    const res = await s.post({ ...DRAFT, userId: 'u2', updatedAt: '1999-01-01' }, 'u1');
    assert.equal(res.status, 200);
    assert.equal(res.body.draft.userId, 'u1');
    assert.notEqual(res.body.draft.updatedAt, '1999-01-01');
    assert.equal(s.state.store.u2, undefined);
    assert.deepEqual((await s.get('u2')).body.drafts, []);
  } finally {
    await s.close();
  }
});

test(`at most ${BROADCAST_DRAFT_LIMIT} drafts: the next new one is refused and nothing is written, an existing one still saves`, async () => {
  const s = await serve();
  try {
    for (let i = 0; i < BROADCAST_DRAFT_LIMIT; i++) {
      const res = await s.post({ ...DRAFT, subject: `Draft ${i}` });
      assert.equal(res.status, 200, `draft ${i}: ${JSON.stringify(res.body)}`);
    }
    const saves = s.state.saves;
    const over = await s.post({ ...DRAFT, subject: 'One too many' });
    assert.equal(over.status, 400);
    assert.deepEqual(over.body, { success: false, error: DRAFT_FULL });
    assert.equal(s.state.saves, saves);
    const list = (await s.get()).body.drafts;
    assert.equal(list.length, BROADCAST_DRAFT_LIMIT);
    assert.ok(!list.some((d) => d.subject === 'One too many'));
    const edit = await s.post({ ...DRAFT, id: list[0].id, subject: 'Changed at the cap' });
    assert.equal(edit.status, 200);
    assert.equal((await s.get()).body.drafts.length, BROADCAST_DRAFT_LIMIT);
  } finally {
    await s.close();
  }
});

test(`a draft over ${BROADCAST_DRAFT_MAX_BYTES} bytes as stored is refused 413 and nothing is written; one just under is kept`, async () => {
  const s = await serve();
  try {
    // One HTML block keeps up to 60000 characters, so two of them clean to well over the cap.
    const big = { ...DRAFT, blocks: [{ id: 'h1', kind: 'html', text: 'a'.repeat(40000) }, { id: 'h2', kind: 'html', text: 'b'.repeat(40000) }] };
    const res = await s.post(big);
    assert.equal(res.status, 413);
    assert.deepEqual(res.body, { success: false, error: DRAFT_TOO_LARGE });
    assert.equal(s.state.saves, 0);
    const fits = { ...DRAFT, blocks: [{ id: 'h1', kind: 'html', text: 'a'.repeat(60000) }] };
    const ok = await s.post(fits);
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.ok(draftBytes(ok.body.draft) <= BROADCAST_DRAFT_MAX_BYTES);
    assert.ok(draftBytes(ok.body.draft) > BROADCAST_DRAFT_MAX_BYTES - 8000, 'the fitting draft is not near the cap, so it proves nothing about the boundary');
  } finally {
    await s.close();
  }
});

test('an empty draft is refused and nothing is written', async () => {
  const s = await serve();
  try {
    const res = await s.post({ subject: '  ', previewText: '', blocks: [{ id: 'h', kind: 'heading', text: '' }, { id: 't', kind: 'text', text: ' ' }], settings: {} });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { success: false, error: DRAFT_EMPTY });
    assert.equal(s.state.saves, 0);
  } finally {
    await s.close();
  }
});

test('an unrelated save keeps the drafts: one with a stale bag and one with none', async () => {
  const s = await serve();
  try {
    // A tick reads the record, then a draft is saved, then the tick writes the bag it read.
    const stale = s.server.userProgramBag('u1');
    const saved = await s.post(DRAFT);
    assert.equal(saved.status, 200);
    s.server.writeUserPrograms('u1', stale);
    assert.deepEqual(s.server.userProgramBag('u1').broadcastDrafts.map((d) => d.id), [saved.body.draft.id], 'a stale unrelated save erased the draft');
    // A save whose bag carries no drafts at all, or an empty list, also keeps them.
    const bag = s.server.userProgramBag('u1');
    s.server.writeUserPrograms('u1', { ...bag, broadcastDrafts: undefined });
    s.server.writeUserPrograms('u1', { ...bag, broadcastDrafts: [] });
    assert.deepEqual((await s.get()).body.drafts.map((d) => d.subject), [DRAFT.subject]);
    // Delete is the drafts route's own write, so it does take one away.
    const del = await s.del(saved.body.draft.id);
    assert.equal(del.status, 200);
    assert.deepEqual(del.body.drafts, []);
    assert.deepEqual((await s.get()).body.drafts, []);
  } finally {
    await s.close();
  }
});

test('server.mjs carries the drafts on both field lists and mounts the route with its own context', () => {
  const bag = slice('function userProgramBag(uid) {', '\n}\n');
  assert.match(bag, /const broadcastDrafts = cleanBroadcastDrafts\(saved\.broadcastDrafts, uid, cleanBlocks\);/);
  assert.match(bag.slice(bag.lastIndexOf('return {')), /\bbroadcastDrafts\b/, 'userProgramBag does not return broadcastDrafts');
  const write = slice('function writeUserPrograms(uid, bag, edits = {}) {', '\n}\n');
  assert.ok(write.includes('broadcastDrafts: cleanBroadcastDrafts(edits.broadcastDrafts ? bag.broadcastDrafts : previous.broadcastDrafts, uid, cleanBlocks)'), 'writeUserPrograms lets an unrelated save write drafts');
  assert.match(SERVER_SRC, /const broadcastDraftCtx = \{[^}]*\};\nsetupBroadcastDraftRoutes\(app, broadcastDraftCtx\);/);
});

test('a draft that cleaning would cut is refused 413 and nothing is written; at each limit it is kept whole', async () => {
  const s = await serve();
  try {
    const lines = (n, kind = 'text') => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, kind, text: `Line ${i}` }));
    const cases = {
      'too large as sent': [{ ...DRAFT, blocks: [{ id: 'h', kind: 'html', text: 'a'.repeat(200000) }] }, DRAFT_TOO_LARGE],
      '25 blocks': [{ ...DRAFT, blocks: lines(25) }, DRAFT_CLIPPED],
      'a text block over 4000': [{ ...DRAFT, blocks: [{ id: 't', kind: 'text', text: 'a'.repeat(4001) }] }, DRAFT_CLIPPED],
      'a heading over 4000': [{ ...DRAFT, blocks: [{ id: 'h', kind: 'heading', text: 'a'.repeat(4001) }] }, DRAFT_CLIPPED],
      'an HTML block over 60000': [{ ...DRAFT, blocks: [{ id: 'h', kind: 'html', text: 'a'.repeat(60001) }] }, DRAFT_CLIPPED],
      'a subject over 200': [{ ...DRAFT, subject: 's'.repeat(201) }, DRAFT_CLIPPED],
      'preview text over 140': [{ ...DRAFT, previewText: 'p'.repeat(141) }, DRAFT_CLIPPED],
      '9 blocks in a column': [{ ...DRAFT, blocks: [{ id: 'c', kind: 'columns', columns: [{ blocks: lines(9) }] }] }, DRAFT_CLIPPED],
      'a split cell over 4000': [{ ...DRAFT, blocks: [{ id: 'p', kind: 'split', cells: [{ kind: 'text', text: 'a'.repeat(4001) }, { kind: 'text', text: '' }] }] }, DRAFT_CLIPPED]
    };
    for (const [name, [body, error]] of Object.entries(cases)) {
      const res = await s.post(body);
      assert.equal(res.status, 413, `${name}: ${JSON.stringify(res.body).slice(0, 200)}`);
      assert.deepEqual(res.body, { success: false, error }, name);
    }
    assert.equal(s.state.saves, 0);
    assert.deepEqual((await s.get()).body.drafts, []);
    // Every limit at once, met and not passed: all of it is stored as sent.
    const full = {
      ...DRAFT,
      subject: 's'.repeat(200),
      previewText: 'p'.repeat(140),
      blocks: [
        { id: 'long', kind: 'text', text: 'a'.repeat(4000) },
        { id: 'html', kind: 'html', text: 'b'.repeat(40000) },
        { id: 'cols', kind: 'columns', columns: [{ blocks: lines(8) }] },
        ...lines(21)
      ]
    };
    const kept = await s.post(full);
    assert.equal(kept.status, 200, JSON.stringify(kept.body).slice(0, 200));
    const row = (await s.get()).body.drafts[0];
    assert.equal(row.subject.length, 200);
    assert.equal(row.previewText.length, 140);
    assert.equal(row.blocks.length, 24);
    assert.equal(row.blocks[0].text.length, 4000);
    assert.equal(row.blocks[1].text.length, 40000);
    assert.equal(row.blocks[2].columns[0].blocks.length, 8);
    assert.match(DRAFT_CLIPPED, /not saved/);
    assert.doesNotMatch(DRAFT_CLIPPED, /—| – /);
  } finally {
    await s.close();
  }
});
