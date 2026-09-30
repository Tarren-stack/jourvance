// One save request (finding C54). App's save and the journey library's writes each built
// POST /api/user/:uid/journey/:id by hand, and journeyClient.ts kept a private copy of
// saveOutcome's requestAnswer, so a header or body change could land in only one of them.
//
// The real journeyClient.ts is bundled with esbuild (already installed with Vite) against a stub
// firebase, so the request it sends runs in Node against a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FIREBASE_STUB = `export async function authHeaders() { return { Authorization: 'Bearer token-1' }; }`;
const bundled = await build({
  entryPoints: [new URL('./src/lib/journeyClient.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /\/firebase$/ }, () => ({ path: 'firebase', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: FIREBASE_STUB, loader: 'js' }));
    }
  }]
});
const client = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); }
};

const journey = (id, updatedAt = '2026-09-29T10:00:00.000Z') => ({
  id, name: 'Spring launch', businessType: 'shop', offerHeadline: '', goal: 'sales', updatedAt,
  nodes: [{ id: 'node-page-1', type: 'landing-page', position: { x: 0, y: 0 }, data: { type: 'landing-page', label: 'Page' } }],
  edges: []
});

async function withFetch(answer, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('C54: postAccountJourney sends the one save request and records a landed save', async () => {
  store.clear();
  const doc = journey('journey a/b');
  const saved = { success: true, durable: true, journey: { updatedAt: '2026-09-29T10:00:05.000Z' } };
  await withFetch({ status: 200, body: saved }, async calls => {
    const answer = await client.postAccountJourney('uid 1', doc);
    assert.deepEqual(answer, { status: 200, body: saved });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/user/uid%201/journey/journey%20a%2Fb');
    assert.deepEqual(calls[0].init, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify(doc)
    });
  });
  assert.deepEqual(JSON.parse(store.get('jourvance_synced:uid%201:journey%20a%2Fb')), {
    remoteUpdatedAt: '2026-09-29T10:00:05.000Z',
    localUpdatedAt: doc.updatedAt
  });
});

test('C54: a save that did not land records nothing, and no answer is null', async () => {
  store.clear();
  await withFetch({ status: 503, body: { success: false, error: 'Busy.' } }, async () => {
    assert.deepEqual(await client.postAccountJourney('uid-1', journey('j1')), { status: 503, body: { success: false, error: 'Busy.' } });
  });
  await withFetch({ status: 200, body: { success: false, journey: { updatedAt: 'x' } } }, async () => {
    await client.postAccountJourney('uid-1', journey('j1'));
  });
  await withFetch(new TypeError('Failed to fetch'), async () => {
    assert.equal(await client.postAccountJourney('uid-1', journey('j1')), null);
  });
  assert.equal(store.size, 0);
});

// App gates its own save on the load it reconciled; only the library's write is refused here.
test('C54: saveAccountJourney refuses unsent after a failed read, postAccountJourney does not refuse', async () => {
  store.clear();
  await withFetch(new TypeError('Failed to fetch'), async () => {
    assert.equal(await client.getAccountJourney('j2', 'uid-1'), null);
  });
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T11:00:00.000Z' } } }, async calls => {
    const refused = await client.saveAccountJourney('uid-1', journey('j2'));
    assert.equal(refused.status, 503);
    assert.equal(calls.length, 0, 'the library write is never sent');
    await client.postAccountJourney('uid-1', journey('j2'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
  });
});

test('C54: the library write is postAccountJourney behind its refusal, and a landed one is the new account copy', async () => {
  store.clear();
  const doc = journey('j3');
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T12:00:00.000Z' } } }, async calls => {
    assert.equal((await client.saveAccountJourney('uid-1', doc)).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/user/uid-1/journey/j3');
    assert.equal(calls[0].init.body, JSON.stringify(doc));
  });
  assert.ok(store.has('jourvance_synced:uid-1:j3'));
});

// F1: the server refuses a save whose base is not the stored revision, so every save names the
// account revision it was made on: the one this tab read, or the one its last landed save became.
const bodyOf = call => JSON.parse(call.init.body);

test('F1: a save names the account revision it replaces, per account', async () => {
  store.clear();
  const R1 = '2026-09-20T10:00:00.000Z';
  await withFetch({ status: 200, body: { success: true, journey: { ...journey('j4', R1) } } }, async () => {
    await client.getAccountJourney('j4', 'u1');
  });
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T12:00:01.000Z' } } }, async calls => {
    await client.postAccountJourney('u1', journey('j4', '2026-09-29T12:00:00.000Z'));
    assert.equal(bodyOf(calls[0]).baseUpdatedAt, R1, 'the revision read');
    await client.postAccountJourney('u1', journey('j4', '2026-09-29T12:00:02.000Z'));
    assert.equal(bodyOf(calls[1]).baseUpdatedAt, '2026-09-29T12:00:01.000Z', 'the revision the last save became');
    // Another account signed in on this browser has read nothing of its own: no base, not u1's.
    await client.postAccountJourney('u2', journey('j4', '2026-09-29T12:00:03.000Z'));
    assert.equal('baseUpdatedAt' in bodyOf(calls[2]), false);
  });
  // A journey the account does not hold, and one never read, name no base.
  await withFetch({ status: 200, body: { success: true, journey: null } }, async () => {
    await client.getAccountJourney('j5', 'u1');
  });
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T12:00:05.000Z' } } }, async calls => {
    await client.postAccountJourney('u1', journey('j5'));
    await client.postAccountJourney('u1', journey('j6'));
    assert.equal('baseUpdatedAt' in bodyOf(calls[0]), false);
    assert.equal('baseUpdatedAt' in bodyOf(calls[1]), false);
  });
  // App's load reads without this module and records what it found the same way.
  client.noteAccountRead('u1', 'j7', journey('j7', R1));
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T12:00:06.000Z' } } }, async calls => {
    await client.postAccountJourney('u1', journey('j7'));
    assert.equal(bodyOf(calls[0]).baseUpdatedAt, R1);
  });
});

test('F1: a save refused as a conflict records nothing and keeps the old base', async () => {
  store.clear();
  const R1 = '2026-09-20T10:00:00.000Z';
  client.noteAccountRead('u1', 'j8', journey('j8', R1));
  const conflict = { success: false, conflict: true, error: 'Your account copy of this journey was changed somewhere else, so this copy was not saved over it.' };
  await withFetch({ status: 409, body: conflict }, async calls => {
    const answer = await client.postAccountJourney('u1', journey('j8'));
    assert.equal(answer.status, 409);
    await client.postAccountJourney('u1', journey('j8'));
    assert.equal(bodyOf(calls[1]).baseUpdatedAt, R1);
  });
  assert.equal(store.size, 0);
});

// The load that runs again after a conflict needs the base this tab's save named, because the sync
// record it would otherwise read is shared with every other tab of this browser.
test('F1: a save refused as a conflict remembers the base it named, per account, until one lands', async () => {
  store.clear();
  const R0 = '2026-09-20T10:00:00.000Z';
  client.noteAccountRead('u1', 'j9', journey('j9', R0));
  assert.equal(client.refusedBase('u1', 'j9'), null);
  const conflict = { success: false, conflict: true, error: 'Your account copy of this journey was changed somewhere else, so this copy was not saved over it.' };
  await withFetch({ status: 409, body: conflict }, async () => {
    await client.postAccountJourney('u1', journey('j9'));
  });
  assert.equal(client.refusedBase('u1', 'j9'), R0);
  assert.equal(client.refusedBase('u2', 'j9'), null, 'another account');
  // Another tab of this browser writing the shared record changes nothing here.
  store.set('jourvance_synced:u1:j9', JSON.stringify({ remoteUpdatedAt: '2026-09-29T12:00:01.000Z', localUpdatedAt: 'a' }));
  assert.equal(client.refusedBase('u1', 'j9'), R0);
  // A 409 that is not this refusal, and a save naming no base, remember nothing.
  await withFetch({ status: 409, body: { success: false, error: 'Other.' } }, async () => {
    await client.postAccountJourney('u1', journey('j10'));
    client.noteAccountRead('u1', 'j11', journey('j11', R0));
    await client.postAccountJourney('u1', journey('j11'));
  });
  assert.equal(client.refusedBase('u1', 'j10'), null);
  assert.equal(client.refusedBase('u1', 'j11'), null);
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: '2026-09-29T12:00:09.000Z' } } }, async () => {
    await client.postAccountJourney('u1', journey('j9'));
  });
  assert.equal(client.refusedBase('u1', 'j9'), null, 'a landed save clears it');
});

// The shared-browser case through the library write: u1's record said this browser's copy was
// a revision NEWER than u2's account copy, which read as "the account is behind" for u2 too.
test("F1: the library write never uses another account's record", async () => {
  store.clear();
  const u1Map = { ...journey('lead-capture-core', '2026-09-29T15:28:40.004Z'), name: "User one's journey" };
  store.set('jourvance_synced:lead-capture-core', JSON.stringify({ remoteUpdatedAt: '2026-09-29T15:28:40.910Z', localUpdatedAt: u1Map.updatedAt }));
  store.set('jourvance_synced:u1:lead-capture-core', JSON.stringify({ remoteUpdatedAt: '2026-09-29T15:28:40.910Z', localUpdatedAt: u1Map.updatedAt }));
  const u2Copy = { ...journey('lead-capture-core', '2026-09-20T10:00:00.000Z'), name: "User two's journey", nodes: [{ id: 'bp5-ad', type: 'ad', position: { x: 0, y: 0 }, data: {} }] };
  await withFetch({ status: 200, body: { success: true, journey: u2Copy } }, async () => {
    await client.getAccountJourney('lead-capture-core', 'u2');
  });
  await withFetch({ status: 200, body: { success: true, journey: { updatedAt: 'x' } } }, async calls => {
    const refused = await client.saveAccountJourney('u2', { ...u1Map, name: 'Renamed by u2' });
    assert.equal(refused.status, 409);
    assert.equal(calls.length, 0, "u1's map is never sent into u2's account");
  });
});

test('C54: one requestAnswer, one builder for the save request, and no dead usePublishState', () => {
  const clientSrc = read('./src/lib/journeyClient.ts');
  assert.match(clientSrc, /import \{[^}]*\brequestAnswer\b[^}]*\} from '\.\/saveOutcome'/);
  assert.doesNotMatch(clientSrc, /function requestAnswer/, 'no private copy');
  // Only journeyClient.ts builds the save URL; App's save calls it.
  for (const file of ['src/App.tsx', 'src/lib/useJourneyNavigation.ts', 'src/lib/useJourneyEditing.ts']) {
    assert.doesNotMatch(read('./' + file), /\/api\/user\/\$\{[^}]*\}\/journey\//, file);
  }
  assert.equal((clientSrc.match(/\/api\/user\/\$\{/g) || []).length, 1);
  const app = read('./src/App.tsx');
  assert.match(app, /import \{ noteAccountRead, postAccountJourney, refusedBase \} from '\.\/lib\/journeyClient';/);
  const save = app.slice(app.indexOf('const saveJourney = async'), app.indexOf('const editing = useJourneyEditing'));
  assert.match(save, /await postAccountJourney\(user\.uid, doc\)/);
  assert.doesNotMatch(read('./src/components/canvas/PublishStatus.tsx'), /usePublishState/);
});
