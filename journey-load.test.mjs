import test from 'node:test';
import assert from 'node:assert/strict';

// App.tsx adopts the signed-in user's server copy only when it is strictly newer than the local
// map. The starter map was stamped at module load and every stats poll re-stamped the local map,
// so on a new device the untouched starter always looked newer and the saved journey never
// loaded; the next save then replaced it with the starter.

// The real loader runs with nothing stored, so it answers the starter map.
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem() {} },
  configurable: true, writable: true
});
const { loadCurrentJourney } = await import('./src/lib/journeyStorage.ts');
const { applyLiveStats } = await import('./src/lib/liveStats.ts');

const serverSaveStamp = '2026-01-01T00:00:00.000Z';

test('an untouched starter map is older than any journey the server has saved', () => {
  const starter = loadCurrentJourney();
  assert.ok(serverSaveStamp > String(starter.updatedAt), `starter updatedAt was ${starter.updatedAt}`);
});

test('applying measured counts does not make the local map look newer', () => {
  const starter = loadCurrentJourney();
  const firstNode = starter.nodes[0];
  const withCounts = applyLiveStats(starter, { nodes: { [firstNode.id]: { clicks: 42 } } });
  assert.notEqual(withCounts, starter, 'the counts were applied');
  assert.equal(withCounts.nodes[0].data.clicks, 42);
  assert.equal(withCounts.updatedAt, starter.updatedAt);
});

// C00: which copy the sign-in load shows. Choosing the later updatedAt let an edit made while the
// load was slow, or a signed-out starter map nudged on a new device, beat the account copy, and
// autosave then wrote the starter map over the account's journey. Lineage decides now.
const store = new Map();
globalThis.localStorage.getItem = k => (store.has(k) ? store.get(k) : null);
globalThis.localStorage.setItem = (k, v) => { store.set(k, String(v)); };
globalThis.localStorage.removeItem = k => { store.delete(k); };
globalThis.localStorage.key = i => [...store.keys()][i] ?? null;
Object.defineProperty(globalThis.localStorage, 'length', { get: () => store.size, configurable: true });
const sync = await import('./src/lib/accountSync.ts');
const { readFileSync } = await import('node:fs');

const ACCOUNT = '2026-09-20T10:00:00.000Z';
const EPOCH = new Date(0).toISOString();

test('C00: the untouched starter map gives way to the account copy', () => {
  assert.equal(sync.chooseOnLoad(EPOCH, ACCOUNT, null), 'adopt');
});

test('C00: an edit made on the starter map while the load was slow is set aside, never saved over the account', () => {
  assert.equal(sync.chooseOnLoad(new Date().toISOString(), ACCOUNT, null), 'set-aside');
});

test('C00: a newer browser copy that never came from the account copy is set aside', () => {
  // The repro: the starter map with one card nudged, stamped a week after the account's save.
  assert.equal(sync.chooseOnLoad('2026-09-29T08:00:00.000Z', ACCOUNT, null), 'set-aside');
  // Lineage from an OLDER account revision with edits on top is a real conflict too.
  const rec = { remoteUpdatedAt: '2026-09-10T00:00:00.000Z', localUpdatedAt: '2026-09-10T00:00:00.000Z' };
  assert.equal(sync.chooseOnLoad('2026-09-29T08:00:00.000Z', ACCOUNT, rec), 'set-aside');
});

test('C00: edits made here on top of the account copy are kept and saved', () => {
  const rec = { remoteUpdatedAt: ACCOUNT, localUpdatedAt: '2026-09-20T09:59:59.500Z' };
  assert.equal(sync.chooseOnLoad('2026-09-29T08:00:00.000Z', ACCOUNT, rec), 'keep');
  assert.equal(sync.chooseOnLoad(ACCOUNT, ACCOUNT, null), 'keep', 'the same revision, opened earlier');
});

test('C00: a newer account copy is shown when nothing changed here since the last sync', () => {
  const rec = { remoteUpdatedAt: '2026-09-10T00:00:00.000Z', localUpdatedAt: '2026-09-10T00:00:00.100Z' };
  assert.equal(sync.chooseOnLoad('2026-09-10T00:00:00.100Z', ACCOUNT, rec), 'adopt');
});

test('C00: an account answer older than what this browser saved does not replace it', () => {
  const rec = { remoteUpdatedAt: '2026-09-25T00:00:00.000Z', localUpdatedAt: '2026-09-25T00:00:00.000Z' };
  assert.equal(sync.chooseOnLoad('2026-09-25T00:00:00.000Z', ACCOUNT, rec), 'keep');
});

// A browser copy byte for byte the account copy, stamped by the browser rather than the server
// (every save before sync records existed), is that revision: no notice, no second journey.
const content = () => ({
  name: 'Account journey', businessType: 'Salon', offerHeadline: '', goal: 'leads', workspaceId: 'ws1',
  shopifyStoreDomain: '', forecast: { visitors: 100 },
  nodes: [{ id: 'a', type: 'page', position: { x: 0, y: 0 }, data: { label: 'Page', clicks: 0 } }],
  edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'r', targetHandle: 'l' }]
});

test('C00: identical content under different stamps keeps the browser copy and never sets it aside', () => {
  const local = { ...content(), updatedAt: '2026-09-20T09:59:59.800Z' };
  // Key order is not content: the server may write fields in another order.
  const remote = { updatedAt: ACCOUNT, ...content(), nodes: [{ data: { clicks: 0, label: 'Page' }, position: { y: 0, x: 0 }, type: 'page', id: 'a' }] };
  const same = sync.adoptChangesNothing(local, remote);
  assert.equal(same, true);
  assert.equal(sync.chooseOnLoad(local.updatedAt, ACCOUNT, null, same), 'keep');
  assert.equal(sync.chooseOnLoad('2026-09-20T10:00:00.300Z', ACCOUNT, null, same), 'keep', 'a browser clock ahead of the server');
  // An empty account field is not a difference: the load keeps this browser's value there.
  assert.equal(sync.adoptChangesNothing(local, { ...remote, businessType: '', forecast: undefined }), true);
});

test('C00: any real difference is still set aside', () => {
  const local = content();
  const differs = [
    { ...content(), name: 'Renamed elsewhere' },
    { ...content(), goal: 'sales' },
    { ...content(), forecast: { visitors: 101 } },
    { ...content(), nodes: [{ ...content().nodes[0], position: { x: 5, y: 0 } }] },
    { ...content(), edges: [] }
  ];
  for (const remote of differs) {
    const same = sync.adoptChangesNothing(local, remote);
    assert.equal(same, false, JSON.stringify(remote).slice(0, 80));
    assert.equal(sync.chooseOnLoad('2026-09-29T08:00:00.000Z', ACCOUNT, null, same), 'set-aside');
  }
});

test('C00: the sync record round-trips and a malformed one reads as none', () => {
  sync.writeSyncRecord('u1', 'j1', ACCOUNT, '2026-09-20T09:00:00.000Z');
  assert.deepEqual(sync.readSyncRecord('u1', 'j1'), { remoteUpdatedAt: ACCOUNT, localUpdatedAt: '2026-09-20T09:00:00.000Z' });
  store.set(sync.syncKey('u1', 'j2'), '{"remoteUpdatedAt":5}');
  assert.equal(sync.readSyncRecord('u1', 'j2'), null);
  assert.equal(sync.readSyncRecord('u1', 'missing'), null);
});

// F1: every account's starter map is 'lead-capture-core', and the record was keyed by the journey
// alone, so a second account on this browser read the first one's record as its own: its load kept
// the first account's map as "edits on top" and autosave wrote it over the second account's copy.
test('F1: a sync record belongs to one account and one journey', () => {
  store.clear();
  assert.equal(sync.syncKey('u1', 'lead-capture-core'), 'jourvance_synced:u1:lead-capture-core');
  assert.equal(sync.syncKey('a:b', 'x/y z'), 'jourvance_synced:a%3Ab:x%2Fy%20z', 'both parts encoded, so the key parses one way');
  sync.writeSyncRecord('u1', 'lead-capture-core', ACCOUNT, ACCOUNT);
  assert.deepEqual(sync.readSyncRecord('u1', 'lead-capture-core'), { remoteUpdatedAt: ACCOUNT, localUpdatedAt: ACCOUNT });
  assert.equal(sync.readSyncRecord('u2', 'lead-capture-core'), null, "another account never reads it");
  assert.equal(sync.readSyncRecord('', 'lead-capture-core'), null, 'nobody signed in reads nothing');
  sync.writeSyncRecord('', 'lead-capture-core', ACCOUNT, ACCOUNT);
  assert.ok(![...store.keys()].some(k => k.endsWith(':lead-capture-core') && !k.includes('u1')), 'no record without a user');
});

test('F1: a record from before the user was in the key is never read as anyone\'s', () => {
  store.clear();
  store.set('jourvance_synced:lead-capture-core', JSON.stringify({ remoteUpdatedAt: ACCOUNT, localUpdatedAt: ACCOUNT }));
  assert.equal(sync.readSyncRecord('u1', 'lead-capture-core'), null);
  assert.equal(sync.readSyncRecord('lead-capture-core', ''), null);
  // With no record, a differing browser copy is set aside, never saved over the account copy.
  assert.equal(sync.chooseOnLoad('2026-09-29T08:00:00.000Z', ACCOUNT, sync.readSyncRecord('u1', 'lead-capture-core')), 'set-aside');
});

test('F1: the second account on a shared browser never keeps the first account\'s copy as its own', () => {
  store.clear();
  // u1 saved the starter map as their journey: this browser's copy is u1's revision.
  const u1Local = '2026-09-29T15:28:40.004Z';
  sync.writeSyncRecord('u1', 'lead-capture-core', '2026-09-29T15:28:40.910Z', u1Local);
  // u2's account copy of the same id is older than u1's save (the skeptic's run).
  const u2Remote = '2026-09-20T10:00:00.000Z';
  assert.equal(sync.chooseOnLoad(u1Local, u2Remote, sync.readSyncRecord('u2', 'lead-capture-core')), 'set-aside');
  // The old unkeyed read handed u2 u1's record, and the load kept u1's map to save over u2's copy.
  assert.equal(sync.chooseOnLoad(u1Local, u2Remote, sync.readSyncRecord('u1', 'lead-capture-core')), 'keep');
  // The library's write for u2 is refused the same way.
  const u2Copy = { ...content(), updatedAt: u2Remote };
  const u1Map = { ...content(), nodes: [{ ...content().nodes[0], id: 'node-ad-1' }], updatedAt: u1Local };
  assert.equal(sync.writeKeepsAccountCopy(u1Map, u2Copy, sync.readSyncRecord('u2', 'lead-capture-core')), false);
});

test('F1: once another account has this browser\'s copy, the first account\'s record no longer describes it', () => {
  store.clear();
  sync.writeSyncRecord('u1', 'lead-capture-core', '2026-09-29T15:00:00.000Z', '2026-09-29T14:59:59.000Z');
  sync.writeSyncRecord('u1', 'journey-other', '2026-09-29T15:00:00.000Z', '2026-09-29T15:00:00.000Z');
  // u2 opens the same id on this browser: u1's record for it is dropped, u1's other journeys are not.
  sync.writeSyncRecord('u2', 'lead-capture-core', ACCOUNT, ACCOUNT);
  assert.equal(sync.readSyncRecord('u1', 'lead-capture-core'), null);
  assert.ok(sync.readSyncRecord('u1', 'journey-other'));
  assert.ok(sync.readSyncRecord('u2', 'lead-capture-core'));
  // So u1 signing in again sets u2's copy aside rather than saving it over u1's account copy.
  assert.equal(sync.chooseOnLoad(ACCOUNT, '2026-09-29T15:00:00.000Z', sync.readSyncRecord('u1', 'lead-capture-core')), 'set-aside');
  // The load forgets too, before any save lands (a u2 session whose saves all failed).
  store.set(sync.syncKey('u1', 'lead-capture-core'), JSON.stringify({ remoteUpdatedAt: '2026-09-29T15:00:00.000Z', localUpdatedAt: '2026-09-29T14:59:59.000Z' }));
  assert.ok(sync.readSyncRecord('u1', 'lead-capture-core'));
  sync.forgetOtherAccounts('u2', 'lead-capture-core');
  assert.equal(sync.readSyncRecord('u1', 'lead-capture-core'), null);
  assert.ok(sync.readSyncRecord('u2', 'lead-capture-core'));
  // A journey whose id is another's suffix is a different journey.
  sync.writeSyncRecord('u1', 'core', ACCOUNT, ACCOUNT);
  sync.forgetOtherAccounts('u2', 'lead-capture-core');
  assert.ok(sync.readSyncRecord('u1', 'core'));
});

// Edits kept at sign-in are this journey's next save. The signed-out save had marked them saved,
// so nothing sent them until the next edit. App hands the account copy to markAccountCopy, which
// baselines the autosaver on it: the kept copy reads as unsaved and autosave sends it.
const { createAutosaver } = await import('./src/lib/journeyAutosave.ts');
function saverWith(results) {
  const timers = [];
  const saved = [];
  let ready = false;
  const saver = createAutosaver({
    save: doc => { saved.push(doc.name); return results.shift() ?? true; },
    fingerprint: d => JSON.stringify([d.name, d.nodes]),
    keyOf: d => d.id,
    delayMs: () => 900,
    canAutosave: () => ready,
    timers: { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} }
  });
  return { saver, saved, timers, release: () => { ready = true; } };
}

test('F1: edits kept on top of the account copy read as unsaved and autosave once released', async () => {
  const { saver, saved, timers, release } = saverWith([]);
  const account = { id: 'j', name: 'Account journey', nodes: ['a'] };
  const kept = { id: 'j', name: 'Edited signed out', nodes: ['a'] };
  saver.baseline(kept); // the signed-out save landed in this browser
  assert.equal(saver.state().dirty, false, 'the old behaviour: nothing to send');
  saver.baseline(account); // markAccountCopy
  saver.schedule(kept);
  assert.equal(saver.state().dirty, true, 'Unsaved changes');
  release(); // the load is reconciled
  saver.schedule(kept);
  assert.equal(saver.state().pending, true);
  timers.shift()();
  await saver.flush();
  assert.deepEqual(saved, ['Edited signed out']);
  assert.equal(saver.state().dirty, false);
});

test('F1: kept edits whose save was refused before the load ran again are sent by the flush', async () => {
  const { saver, saved, release } = saverWith([false, true]);
  const account = { id: 'j', name: 'Account journey', nodes: ['a'] };
  const kept = { id: 'j', name: 'Laptop edit', nodes: ['a'] };
  saver.baseline(account);
  release();
  saver.schedule(kept);
  assert.equal(await saver.flush(), false, 'the 409');
  saver.baseline(account); // the load kept it: markAccountCopy
  saver.schedule(kept);
  assert.equal(saver.state().pending, false, 'schedule holds back content that just failed');
  assert.equal(saver.state().dirty, true);
  assert.equal(await saver.flush(), true, "useJourneyEditing's resave");
  assert.deepEqual(saved, ['Laptop edit', 'Laptop edit']);
});

// The library renames a journey that is not open by reading it, keeping the newer copy and writing
// it back, without passing the load App runs. Scenario A: the held starter map, renamed, was written
// over the account's journey because its stamp was newer.
test('C00: a library write keeps the account copy only when it comes from it', () => {
  const remote = { ...content(), updatedAt: ACCOUNT };
  const renamedAccountCopy = { ...content(), name: 'Renamed from library', updatedAt: '2026-09-29T09:00:00.000Z' };
  assert.equal(sync.writeKeepsAccountCopy(renamedAccountCopy, remote, null), true, 'renaming what the account holds');
  const starter = { ...content(), nodes: [{ ...content().nodes[0], id: 'node-ad-1' }], name: 'Renamed from library', updatedAt: '2026-09-29T09:00:00.000Z' };
  assert.equal(sync.writeKeepsAccountCopy(starter, remote, null), false, 'a browser copy that never came from the account copy');
  assert.equal(sync.writeKeepsAccountCopy(starter, remote, { remoteUpdatedAt: '2026-09-10T00:00:00.000Z', localUpdatedAt: '2026-09-10T00:00:00.000Z' }), false, 'edits on an older revision');
  assert.equal(sync.writeKeepsAccountCopy(starter, remote, { remoteUpdatedAt: ACCOUNT, localUpdatedAt: ACCOUNT }), true, 'edits on this revision');
  assert.equal(sync.writeKeepsAccountCopy(starter, remote, { remoteUpdatedAt: '2026-09-25T00:00:00.000Z', localUpdatedAt: '2026-09-25T00:00:00.000Z' }), true, 'the account is behind a save made here');
});

test('C00: the notices are one sentence with no em dash', () => {
  for (const m of [sync.LOAD_FAILED, sync.LOAD_PENDING, sync.SET_ASIDE_FAILED, sync.WRITE_UNREAD, sync.WRITE_DIVERGED, sync.setAsideNotice(sync.setAsideName('Quick rename'))]) {
    assert.doesNotMatch(m, /—| – /);
    assert.equal(m.split(/\.\s/).length, 1, m);
  }
});

// The wiring, since App cannot be rendered under node: the timestamp rule is gone, the load goes
// through chooseOnLoad, a set-aside copy is parked before the account copy is shown, a held
// journey refuses Save as well as autosave, and every landed save or adopted copy is recorded.
const app = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const editingSrc = readFileSync(new URL('./src/lib/useJourneyEditing.ts', import.meta.url), 'utf8');
const clientSrc = readFileSync(new URL('./src/lib/journeyClient.ts', import.meta.url), 'utf8');
const navSrc = readFileSync(new URL('./src/lib/useJourneyNavigation.ts', import.meta.url), 'utf8');

test('C00: App reconciles the load by lineage, not by the later timestamp', () => {
  assert.doesNotMatch(app, /String\(remote\.updatedAt\)\s*>\s*String\(p\.updatedAt\)/);
  assert.match(app, /const same = !hidden && adoptChangesNothing\(p, repaired\);/);
  assert.match(app, /: chooseOnLoad\(p\.updatedAt, remoteAt, conflict \? recordAfterConflict\(readSyncRecord\(uid, p\.id\), conflict\.base, p\.updatedAt\) : readSyncRecord\(uid, p\.id\), same\);/);
  assert.match(app, /choice === 'keep' && same\) writeSyncRecord\(uid, p\.id, remoteAt, p\.updatedAt\)/);
  assert.match(app, /choice === 'set-aside'[\s\S]{0,200}parkJourney\(kept\)/);
});

// Scenarios G and H: #18's switch keeps the newer copy by timestamp and opens the browser copy when
// the account cannot be read, so the load runs for every journey opened while signed in, not only
// the one open at sign-in, and a copy the switch passed over is set aside rather than lost.
test('C00: every journey opened while signed in is reconciled before anything saves over it', () => {
  assert.match(app, /\}, \[user\?\.uid, project\.id, accountLoadAttempt\]\);/);
  assert.match(app, /const journeyLoadSettled = !user \|\| isReconciled\(project\.id\);/);
  assert.match(app, /if \(isReconciledRef\.current\(requestedId\)\) \{/);
  // Reconciled only once the account answered: never on a failed read or a blocked set-aside.
  const load = app.slice(app.indexOf('// Load the server copy of the open journey.'), app.indexOf('// Auto-save changes locally.'));
  const failed = load.slice(load.indexOf('if (!answered) {'), load.indexOf("const p = projectRef.current;"));
  assert.doesNotMatch(failed, /markReconciled/);
  const blocked = load.slice(load.indexOf('if (!parkJourney(kept)) {'), load.indexOf('// Minted here this moment'));
  assert.doesNotMatch(blocked, /markReconciled/);
  assert.match(blocked, /return;/);
  // Signing out forgets them, so signing in again reads every journey again.
  assert.match(load, /if \(!user\) \{ setReconciled\(\{ uid: '', ids: new Set\(\) \}\);/);
});

test('C00: a switch hands the load the browser copy it passed over', () => {
  assert.match(app, /setProject: openJourneyOnScreen,/);
  assert.match(app, /openedBaseRef\.current = \{ id: next\.id, uid, parked: readParkedJourney\(next\.id\), record: uid \? readSyncRecord\(uid, next\.id\) : null, shownAt: next\.updatedAt \};/);
  // F1: the record is the account's that was signed in at the switch, and only that account uses it.
  assert.match(app, /chooseOnLoad\(hidden\.updatedAt, remoteAt, base!\.uid === uid \? base!\.record : null, false\)/);
  assert.match(app, /const hidden = base\?\.parked && base\.parked\.updatedAt !== base\.shownAt && !adoptChangesNothing\(base\.parked, repaired\) \? base\.parked : null;/);
  // The account copy the switch showed stays; only the passed-over copy is set aside.
  assert.match(app, /if \(choice !== 'keep' && !hidden\) \{/);
});

test('C00: the library write refuses, unsent, to replace an account copy it does not come from', () => {
  const save = clientSrc.slice(clientSrc.indexOf('export async function saveAccountJourney'));
  assert.match(save, /const refused = writeRefusal\(uid, project\);\s*if \(refused\) return refused;/);
  assert.ok(save.indexOf('writeRefusal(uid, project)') < save.indexOf('postAccountJourney('), 'checked before the POST');
  assert.match(clientSrc, /if \(!read\) return \{ status: 503, body: \{ success: false, error: WRITE_UNREAD \} \};/);
  assert.match(clientSrc, /!writeKeepsAccountCopy\(project, read\.copy, readSyncRecord\(uid, project\.id\)\)/);
  // Every read records what it found, a failed one included, per account.
  assert.match(clientSrc, /noteAccountRead\(uid, id, ok \? \(body!\.journey \?\? null\) : undefined\);/);
  assert.match(clientSrc, /accountReads\.set\(readKey\(uid, id\), journey === undefined \? null/);
});

test('C00: a journey whose account copy is not reconciled refuses Save too, with a notice and Try again', () => {
  const save = app.slice(app.indexOf('const saveJourney = async'), app.indexOf('const editing = useJourneyEditing'));
  assert.match(save, /if \(!isReconciledRef\.current\(doc\.id\)\) \{[\s\S]{0,500}return false;/);
  assert.ok(save.indexOf('isReconciledRef.current(doc.id)') < save.indexOf('postAccountJourney('), 'the hold is checked before the POST');
  assert.match(app, /setAccountHold\(\{ id: requestedId, why: 'failed' \}\);\s*setAccountNotice\(\{ id: requestedId, message: LOAD_FAILED, retry: true \}\)/);
  assert.match(app, /const n = shownAccountNotice;\s*if \(n\?\.retry\) \{ setAccountNotice\(null\); setAccountLoadAttempt/);
  assert.match(app, /ready: journeyLoadSettled/);
});

test('C00: landed saves and adopted copies record the account revision', () => {
  // App's save goes through the one save request, which records a landed save (C54).
  assert.match(app, /const answer = await postAccountJourney\(user\.uid, doc\);/);
  assert.match(editingSrc, /why === 'load'[\s\S]{0,300}if \(accountUidRef\.current\) writeSyncRecord\(accountUidRef\.current, project\.id, project\.updatedAt, project\.updatedAt\)/);
  assert.match(clientSrc, /writeSyncRecord\(uid, project\.id, savedAt, project\.updatedAt\)/);
  assert.match(app, /accountUid: user\?\.uid \?\? null,/);
  // Every call names the account: no record is read or written by journey id alone.
  for (const src of [app, editingSrc, clientSrc, navSrc]) {
    assert.doesNotMatch(src, /readSyncRecord\((?:p|next|project)?\.?id\)/);
    assert.doesNotMatch(src, /writeSyncRecord\((?:p|project)\.id,/);
  }
});

test('F1: the load hands this account the browser copy, then kept edits read as unsaved', () => {
  const load = app.slice(app.indexOf('// Load the server copy of the open journey.'), app.indexOf('// Auto-save changes locally.'));
  assert.match(load, /forgetOtherAccounts\(uid, requestedId\);\s*noteAccountRead\(uid, requestedId, raw \?\? null\);/);
  assert.ok(load.indexOf('forgetOtherAccounts(uid, requestedId)') < load.indexOf('const choice ='), 'before the choice');
  assert.match(load, /if \(choice === 'keep' && !same && !hidden\) editing\.markAccountCopy\(asAccount\(p\)\);/);
  assert.match(load, /setProject\(cur => \(cur\.id !== requestedId \? cur : asAccount\(cur\)\)\);/);
  // The copy a switch passed over is weighed once.
  assert.match(load, /consumeBase\(\);\s*consumeConflict\(\);\s*markReconciled\(uid, requestedId\);/);
  assert.match(editingSrc, /const markAccountCopy = useCallback\(\(accountCopy: JourneyProject\) => \{\s*saver\.baseline\(accountCopy\);/);
  assert.match(editingSrc, /if \(ready && resaveRef\.current === project\.id\) \{[\s\S]{0,200}if \(s\.dirty && !s\.pending && !s\.inFlight\) void saver\.flush\(\);/);
});

test('F1: a save the server refuses as a conflict reads the account copy again instead of overwriting', () => {
  const save = app.slice(app.indexOf('const saveJourney = async'), app.indexOf('const editing = useJourneyEditing'));
  const conflict = save.slice(save.indexOf('if (isSaveConflict(answer)) {'), save.indexOf('const status = saveOutcome('));
  assert.ok(conflict.length > 0);
  assert.match(conflict, /ids\.delete\(doc\.id\)/);
  assert.match(conflict, /setAccountHold\(\{ id: doc\.id, why: 'loading' \}\)/);
  assert.match(conflict, /setAccountNotice\(\{ id: doc\.id, message: SAVE_CONFLICT \}\)/);
  assert.match(conflict, /setAccountLoadAttempt\(n => n \+ 1\)/);
  assert.match(conflict, /return false;/);
  assert.equal(sync.isSaveConflict({ status: 409, body: { success: false, conflict: true } }), true);
  assert.equal(sync.isSaveConflict({ status: 409, body: { success: false } }), false, 'a 409 that is not this refusal');
  assert.equal(sync.isSaveConflict(null), false);
});

// Two tabs of one account share the sync record. Tab A saved revision RA and wrote the record
// {RA, A's stamp}; tab B, still on R0, saved and was refused with 409, and the load that ran again
// read tab A's record as tab B's own lineage, kept tab B's copy and saved it over tab A's save.
test("F1: after a refused save, another tab's record is never read as this tab's lineage", () => {
  const R0 = '2026-09-20T10:00:00.000Z';
  const RA = '2026-09-29T12:00:01.000Z';
  const tabA = { remoteUpdatedAt: RA, localUpdatedAt: '2026-09-29T12:00:00.500Z' };
  const tabBEdit = '2026-09-29T12:00:03.000Z';
  // The bug: the shared record says tab B's copy is edits on RA.
  assert.equal(sync.chooseOnLoad(tabBEdit, RA, tabA), 'keep');
  // Tab B's refused save named R0, so tab A's record is not tab B's: its copy is set aside.
  assert.equal(sync.recordAfterConflict(tabA, R0, tabBEdit), null);
  assert.equal(sync.chooseOnLoad(tabBEdit, RA, sync.recordAfterConflict(tabA, R0, tabBEdit)), 'set-aside');
  // With no base to compare, no record is anyone's but the copy it names.
  assert.equal(sync.recordAfterConflict(tabA, null, tabBEdit), null);
  assert.equal(sync.recordAfterConflict(null, R0, tabBEdit), null);
});

test("F1: after a refused save, this tab's own record still keeps its copy", () => {
  // The record names the base this tab's save was made on.
  const own = { remoteUpdatedAt: '2026-09-29T12:00:02.000Z', localUpdatedAt: '2026-09-29T12:00:01.900Z' };
  assert.equal(sync.recordAfterConflict(own, own.remoteUpdatedAt, '2026-09-29T12:00:05.000Z'), own);
  // A refusal the account then answers with an older revision (a hub put that failed) keeps this
  // copy and saves it again: nothing is set aside and nothing is lost.
  assert.equal(sync.chooseOnLoad('2026-09-29T12:00:05.000Z', '2026-09-29T12:00:01.000Z', own), 'keep');
  // Or the record names this tab's copy as it is on screen.
  const mine = { remoteUpdatedAt: '2026-09-29T13:00:00.000Z', localUpdatedAt: '2026-09-29T12:00:05.000Z' };
  assert.equal(sync.recordAfterConflict(mine, '2026-09-20T10:00:00.000Z', '2026-09-29T12:00:05.000Z'), mine);
});

test('F1: the load after a refused save weighs the record by the base that save named', () => {
  const save = app.slice(app.indexOf('const saveJourney = async'), app.indexOf('const editing = useJourneyEditing'));
  const conflict = save.slice(save.indexOf('if (isSaveConflict(answer)) {'), save.indexOf('const status = saveOutcome('));
  assert.match(conflict, /conflictRef\.current = \{ id: doc\.id, uid, base: refusedBase\(uid, doc\.id\) \};/);
  assert.ok(conflict.indexOf('conflictRef.current =') < conflict.indexOf('setAccountLoadAttempt('), 'set before the load runs again');
  const load = app.slice(app.indexOf('// Load the server copy of the open journey.'), app.indexOf('// Auto-save changes locally.'));
  assert.match(load, /const conflict = conflictRef\.current && conflictRef\.current\.id === requestedId && conflictRef\.current\.uid === uid \? conflictRef\.current : null;/);
  // Consumed only where the journey is reconciled, so a failed or blocked load keeps it for the retry.
  assert.equal((load.match(/consumeConflict\(\);\s*markReconciled\(uid, requestedId\);/g) || []).length, 2);
  const failed = load.slice(load.indexOf('if (!answered) {'), load.indexOf('const p = projectRef.current;'));
  assert.doesNotMatch(failed, /consumeConflict/);
});

test('F1: the library chooses between the browser and account copies by lineage, never the later stamp', () => {
  assert.doesNotMatch(navSrc, /pickNewer/);
  const load = navSrc.slice(navSrc.indexOf('const loadBody = async'), navSrc.indexOf('const leaveCurrent'));
  assert.match(load, /getAccountJourney\(id, cur\.user\.uid\)/);
  assert.match(load, /chooseOnLoad\(local\.updatedAt, remote\.updatedAt, readSyncRecord\(cur\.user\.uid, id\), adoptChangesNothing\(local, remote\)\)/);
  // A rename of a journey whose browser copy did not come from the account copy changes neither.
  const rename = navSrc.slice(navSrc.indexOf('const renameJourneyById'));
  assert.match(rename, /if \(diverged\) return renameRefusal\(\{ status: 409, body: \{ success: false, error: WRITE_DIVERGED \} \}\);/);
  assert.ok(rename.indexOf('if (diverged)') < rename.indexOf('saveAccountJourney('));
});

// The hold and its notice belong to one journey id. The hold used to end whenever another journey
// was opened, and #18's switch opens the browser copy when the account read fails, so coming back
// saved the starter map over an account copy nobody had read. The notice's Try again reloaded
// whichever journey was open and cleared the warning without reading the one it described.
test('C00: the hold outlives a switch and the load runs again when its journey is reopened', () => {
  assert.doesNotMatch(app, /setAccountHold\(h => \(h && h\.id !== project\.id \? null : h\)\)/);
  assert.match(app, /if \(p\.id !== requestedId\) return;/);
  // A switch cancels the load, and the id is in its dependencies, so reopening loads again.
  assert.match(app, /return \(\) => \{ cancelled = true; \};\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[user\?\.uid, project\.id, accountLoadAttempt\]\);/);
});

test('C00: the account notice names its journey and shows only while that journey is open', () => {
  assert.match(app, /const shownAccountNotice = accountNotice && accountNotice\.id === project\.id \? accountNotice : null;/);
  assert.match(app, /accountNotice=\{shownAccountNotice && \{/);
  assert.doesNotMatch(app, /accountNotice=\{accountNotice && /);
  const set = [...app.matchAll(/setAccountNotice\((\{[^;]*?)\);/g)].map(m => m[1]).filter(n => n !== '{ id: doc.id, message: SAVE_CONFLICT }');
  assert.ok(set.length >= 3, 'the load sets its three notices');
  for (const n of set) assert.match(n, /^\{ id: requestedId, /, n);
  const refusal = app.slice(app.indexOf('if (!isReconciledRef.current(doc.id)) {'));
  assert.match(refusal.slice(0, 520), /\{ id: hold\.id, message: LOAD_PENDING \}[\s\S]*\{ id: hold\.id, message: LOAD_FAILED, retry: true \}[\s\S]*\{ id: hold\.id, message: SET_ASIDE_FAILED \}/);
});
