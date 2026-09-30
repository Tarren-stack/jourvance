import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The journey used to live in one browser slot ('jourvance_active_project'), so opening a second
// journey overwrote the first. #18 gives every journey its own copy ('jourvance_journey:<id>'),
// written on every autosave beside the active slot, so switching, a reload of /canvas/<id> and a
// second tab never find a stale or missing copy. src/lib/journeyStorage.ts is the one place that
// reads and writes them.

// A Map-backed localStorage with the parts the module uses, and a switch that makes every write
// throw the way a full or blocked browser store does. Installed before the import.
const store = new Map();
let quotaFull = false;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (quotaFull) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    store.set(String(k), String(v));
  },
  removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
};

const {
  STORAGE_KEY,
  PARKED_PREFIX,
  saveCurrentJourney,
  loadCurrentJourney,
  parkJourney,
  readParkedJourney,
  listLocalJourneys,
  loadInitialJourney,
  keepJourney,
  isStorageFull,
  removeBrowserJourney,
  activeSlotHold,
  restoreBrowserJourney,
  browserStorageUsage,
  storageUsageLine,
  formatStorageMb,
  formatStorageAmount,
  STORAGE_KB_BELOW,
  BROWSER_STORAGE_LIMIT_CHARS
} = await import('./src/lib/journeyStorage.ts');
const { syncKey, writeSyncRecord, readSyncRecord } = await import('./src/lib/accountSync.ts');

const journey = (id, name, updatedAt = '2026-09-01T00:00:00.000Z') => ({
  id,
  name,
  businessType: '',
  offerHeadline: '',
  goal: '',
  nodes: [{ id: `${id}-page`, type: 'landing-page', position: { x: 0, y: 0 }, data: { label: 'Page' } }],
  edges: [],
  updatedAt
});

// A map saved before #6: the landing page's line names an 'accepted' handle it does not have.
const legacy = (id) => ({
  ...journey(id, 'Legacy'),
  nodes: [
    { id: 'p', type: 'landing-page', position: { x: 0, y: 0 }, data: { label: 'Page' } },
    { id: 'u', type: 'upsell', position: { x: 300, y: 0 }, data: { label: 'Upsell' } }
  ],
  edges: [{ id: 'e1', source: 'p', target: 'u', sourceHandle: 'accepted', data: { sourceThroughput: 0, targetCount: 0, rate: 0 } }]
});

const logged = [];
const quiet = (fn) => {
  const { warn, error } = console;
  console.warn = (...a) => logged.push(a);
  console.error = (...a) => logged.push(a);
  try { return fn(); } finally { console.warn = warn; console.error = error; }
};

beforeEach(() => {
  store.clear();
  quotaFull = false;
});

test('the active slot keeps its name, and each journey has its own key', () => {
  assert.equal(STORAGE_KEY, 'jourvance_active_project');
  assert.equal(PARKED_PREFIX, 'jourvance_journey:');
});

test('saveCurrentJourney writes the active slot and the journey\'s own copy, with the same body', () => {
  const a = journey('A', 'Spring launch');
  assert.equal(saveCurrentJourney(a), true);
  assert.equal(store.get('jourvance_active_project'), store.get('jourvance_journey:A'));
  assert.deepEqual(JSON.parse(store.get('jourvance_journey:A')), a);
  // An edit that follows overwrites both, so the own copy is never stale.
  const edited = { ...a, name: 'Spring launch 2', updatedAt: '2026-09-02T00:00:00.000Z' };
  assert.equal(saveCurrentJourney(edited), true);
  assert.deepEqual(readParkedJourney('A'), edited);
  assert.deepEqual(loadCurrentJourney(), edited);
});

test('parkJourney and readParkedJourney round-trip', () => {
  const b = journey('B', 'Holiday offer');
  assert.equal(parkJourney(b), true);
  assert.deepEqual(readParkedJourney('B'), b);
  assert.equal(store.has('jourvance_active_project'), false, 'parking never touches the active slot');
  assert.equal(readParkedJourney('nope'), null);
});

test('readParkedJourney refuses a copy it cannot trust', () => {
  store.set('jourvance_journey:broken', '{"id":"broken", nodes');
  assert.equal(quiet(() => readParkedJourney('broken')), null, 'broken JSON');
  store.set('jourvance_journey:half', JSON.stringify({ ...journey('half', 'Half'), edges: null }));
  assert.equal(readParkedJourney('half'), null, 'edges is not an array');
  store.set('jourvance_journey:nonodes', JSON.stringify({ ...journey('nonodes', 'No nodes'), nodes: {} }));
  assert.equal(readParkedJourney('nonodes'), null, 'nodes is not an array');
  store.set('jourvance_journey:C', JSON.stringify(journey('D', 'Someone else')));
  assert.equal(readParkedJourney('C'), null, 'the body names another journey than its key');
  store.set('jourvance_journey:null', 'null');
  assert.equal(readParkedJourney('null'), null);
});

test('a parked copy saved before #6 is repaired on read, like the active slot', () => {
  store.set('jourvance_journey:L', JSON.stringify(legacy('L')));
  const read = readParkedJourney('L');
  assert.equal(read.edges[0].sourceHandle, undefined, 'the handle the page does not have is dropped');
  assert.equal(read.updatedAt, legacy('L').updatedAt, 'a repair is not an edit');
});

test('loadInitialJourney opens the journey the address names from its own copy, and keeps the active one', () => {
  const a = journey('A', 'Spring launch');
  const b = journey('B', 'Holiday offer');
  // A is in the active slot only (saved before #18), B has its own copy.
  store.set('jourvance_active_project', JSON.stringify(a));
  parkJourney(b);
  const { project, missing } = loadInitialJourney('B');
  assert.equal(missing, false);
  assert.deepEqual(project, b);
  assert.deepEqual(readParkedJourney('A'), a, 'the journey that was open is kept under its own key');
});

test('loadInitialJourney answers the active journey for no id, its own id, or an id it does not hold', () => {
  const a = journey('A', 'Spring launch');
  saveCurrentJourney(a);
  assert.deepEqual(loadInitialJourney(null), { project: a, missing: false });
  assert.deepEqual(loadInitialJourney('A'), { project: a, missing: false });
  assert.deepEqual(loadInitialJourney('X'), { project: a, missing: true });
});

test('loadInitialJourney repairs a parked copy saved before #6', () => {
  saveCurrentJourney(journey('A', 'Spring launch'));
  store.set('jourvance_journey:L', JSON.stringify(legacy('L')));
  const { project, missing } = loadInitialJourney('L');
  assert.equal(missing, false);
  assert.equal(project.id, 'L');
  assert.equal(project.edges[0].sourceHandle, undefined);
});

test('with nothing stored, an address naming a parked journey does not park the starter map', () => {
  parkJourney(journey('B', 'Holiday offer'));
  const { project } = loadInitialJourney('B');
  assert.equal(project.id, 'B');
  assert.deepEqual([...store.keys()], ['jourvance_journey:B'], 'the starter map is not a journey anybody kept');
});

test('listLocalJourneys lists each journey once, the active copy winning over an older parked one', () => {
  parkJourney(journey('A', 'Old name', '2026-09-01T00:00:00.000Z'));
  parkJourney(journey('B', 'Holiday offer'));
  store.set('jourvance_active_project', JSON.stringify(journey('A', 'New name', '2026-09-03T00:00:00.000Z')));
  store.set('jourvance_journey:bad', 'not json');
  store.set('someone_else_key', JSON.stringify(journey('Z', 'Not ours')));
  const list = quiet(() => listLocalJourneys());
  assert.deepEqual(list.map(p => p.id).sort(), ['A', 'B']);
  assert.equal(list.find(p => p.id === 'A').name, 'New name');
});

test('listLocalJourneys is empty when this browser holds nothing', () => {
  assert.deepEqual(listLocalJourneys(), []);
});

test('a full or blocked browser store is reported as false, never thrown', () => {
  quotaFull = true;
  const a = journey('A', 'Spring launch');
  assert.equal(quiet(() => parkJourney(a)), false);
  assert.equal(quiet(() => saveCurrentJourney(a)), false);
  assert.equal(store.size, 0);
});

test('saveCurrentJourney is false when only the journey\'s own copy was refused', () => {
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => {
    if (String(k).startsWith('jourvance_journey:')) throw new Error('The quota has been exceeded.');
    realSet(k, v);
  };
  try {
    assert.equal(quiet(() => saveCurrentJourney(journey('A', 'Spring launch'))), false);
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
});

// ---- F4: removing a browser copy when the person asks, and saying when storage is full ----

test('isStorageFull knows the quota error by name and by code, and a blocked store is not full', () => {
  assert.equal(isStorageFull(Object.assign(new Error('x'), { name: 'QuotaExceededError' })), true);
  assert.equal(isStorageFull({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true, 'older Firefox');
  assert.equal(isStorageFull({ name: 'Error', code: 22 }), true);
  assert.equal(isStorageFull({ name: 'Error', code: 1014 }), true);
  assert.equal(isStorageFull(Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError', code: 18 })), false);
  assert.equal(isStorageFull(null), false);
  assert.equal(isStorageFull('QuotaExceededError'), false);
});

test('keepJourney says whether storage was full, apart from any other refusal', () => {
  assert.deepEqual(keepJourney(journey('A', 'Spring launch')), { kept: true, full: false });
  quotaFull = true;
  assert.deepEqual(quiet(() => keepJourney(journey('B', 'Holiday offer'))), { kept: false, full: true });
  quotaFull = false;
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  try {
    assert.deepEqual(quiet(() => keepJourney(journey('C', 'Blocked'))), { kept: false, full: false });
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
});

test('removeBrowserJourney takes the copy and its lineage records, and restore puts back the exact bytes', () => {
  saveCurrentJourney(journey('A', 'Open one'));
  const b = journey('B', 'Holiday offer');
  // Stored with odd spacing, so "exact" means the stored text, not a re-serialized journey.
  store.set('jourvance_journey:B', JSON.stringify(b, null, 1));
  writeSyncRecord('uid-1', 'B', '2026-09-01T00:00:00.000Z', b.updatedAt);
  store.set(syncKey('uid-2', 'B'), '{"remoteUpdatedAt":"r2","localUpdatedAt":"l2"}');
  store.set(syncKey('uid-1', 'A'), '{"remoteUpdatedAt":"ra","localUpdatedAt":"la"}');
  store.set('jourvance_synced:B', 'a record from before the user was in the key');
  const before = new Map(store);

  const result = removeBrowserJourney('B', 'A');
  assert.equal(result.ok, true);
  assert.equal(store.has('jourvance_journey:B'), false);
  assert.equal(readSyncRecord('uid-1', 'B'), null);
  assert.equal(store.has(syncKey('uid-2', 'B')), false);
  assert.equal(store.get(syncKey('uid-1', 'A')), before.get(syncKey('uid-1', 'A')), 'another journey\'s record stays');
  assert.equal(store.get('jourvance_synced:B'), before.get('jourvance_synced:B'), 'a key that is not <uid>:<id> is not touched');
  assert.deepEqual(listLocalJourneys().map(p => p.id), ['A']);

  assert.equal(restoreBrowserJourney(result.removed), true);
  assert.deepEqual(new Map(store), before, 'every key and every byte is back');
});

test('the open journey is never removed, nor the one another tab has in the active slot', () => {
  parkJourney(journey('B', 'Open here'));
  saveCurrentJourney(journey('B', 'Open here'));
  // Another tab of this browser writes the slot after this tab's own write landed.
  store.set(STORAGE_KEY, JSON.stringify(journey('A', 'Opened in another tab')));
  store.set(PARKED_PREFIX + 'A', JSON.stringify(journey('A', 'Opened in another tab')));
  const before = new Map(store);
  assert.deepEqual(removeBrowserJourney('B', 'B'), { ok: false, reason: 'open' }, 'the journey on screen');
  assert.deepEqual(removeBrowserJourney('A', 'B'), { ok: false, reason: 'active-slot', hold: { kind: 'another-tab' } }, 'the active slot, written since by another tab');
  assert.deepEqual(removeBrowserJourney('', 'A'), { ok: false, reason: 'open' });
  assert.deepEqual(removeBrowserJourney('X', 'B'), { ok: false, reason: 'missing' });
  assert.deepEqual(new Map(store), before, 'a refusal changes nothing');
});

test('activeSlotHold names another tab only when this tab\'s own write to the slot landed', () => {
  parkJourney(journey('B', 'Open here'));
  saveCurrentJourney(journey('B', 'Open here'));
  store.set(STORAGE_KEY, JSON.stringify(journey('A', 'Opened in another tab')));
  store.set(PARKED_PREFIX + 'A', JSON.stringify(journey('A', 'Opened in another tab')));
  assert.deepEqual(activeSlotHold('A', 'B'), { kind: 'another-tab' });
  assert.equal(activeSlotHold('A', 'A'), null, 'the journey on screen is this tab\'s own');
  assert.equal(activeSlotHold('B', 'A'), null, 'a parked copy is in no tab\'s slot');
  assert.equal(activeSlotHold('', 'B'), null);
  // This tab saving its own journey takes the slot back, and the other one becomes removable.
  saveCurrentJourney(journey('B', 'Open here'));
  assert.equal(activeSlotHold('A', 'B'), null);
  assert.equal(removeBrowserJourney('A', 'B').ok, true);
});

test('F4: one tab, full storage: the slot this tab could not write over is never blamed on another tab', () => {
  // This tab had Alpha open, then opened Bravo while the browser was full: the autosave's write of
  // Bravo into the active slot was refused, so the slot still holds Alpha and no other tab exists.
  saveCurrentJourney(journey('A', 'Alpha'));
  parkJourney(journey('B', 'Bravo'));
  parkJourney(journey('C', 'Charlie'));
  quotaFull = true;
  assert.deepEqual(keepJourney(journey('B', 'Bravo')), { kept: false, full: true });
  quotaFull = false;
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).id, 'A', 'the slot is stale');
  assert.deepEqual(activeSlotHold('A', 'B'), { kind: 'not-saved-here', full: true });
  const before = new Map(store);
  assert.deepEqual(removeBrowserJourney('A', 'B'), { ok: false, reason: 'active-slot', hold: { kind: 'not-saved-here', full: true } });
  assert.deepEqual(new Map(store), before, 'a refusal changes nothing');
  // Making room (removing Charlie) lets the open journey's next write land; then Alpha is removable.
  assert.equal(removeBrowserJourney('C', 'B').ok, true);
  assert.deepEqual(keepJourney(journey('B', 'Bravo')), { kept: true, full: false });
  assert.equal(activeSlotHold('A', 'B'), null);
  assert.equal(removeBrowserJourney('A', 'B').ok, true);
});

test('a slot write refused for another reason than space is not called full, nor another tab', () => {
  saveCurrentJourney(journey('A', 'Alpha'));
  parkJourney(journey('B', 'Bravo'));
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('blocked'); };
  try {
    assert.deepEqual(keepJourney(journey('B', 'Bravo')), { kept: false, full: false });
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
  assert.deepEqual(activeSlotHold('A', 'B'), { kind: 'not-saved-here', full: false });
});

test('a browser that refuses the removal reports it and keeps everything', () => {
  parkJourney(journey('B', 'Holiday offer'));
  const realRemove = globalThis.localStorage.removeItem;
  globalThis.localStorage.removeItem = () => { throw new Error('blocked'); };
  try {
    assert.deepEqual(quiet(() => removeBrowserJourney('B', 'A')), { ok: false, reason: 'refused' });
  } finally {
    globalThis.localStorage.removeItem = realRemove;
  }
  assert.equal(store.has('jourvance_journey:B'), true);
});

test('restore reports a refusal rather than claiming the journey is back', () => {
  parkJourney(journey('B', 'Holiday offer'));
  const { removed } = removeBrowserJourney('B', 'A');
  quotaFull = true;
  assert.equal(quiet(() => restoreBrowserJourney(removed)), false);
  assert.equal(store.has('jourvance_journey:B'), false);
});

test('nothing in the storage module removes a journey on its own', () => {
  // Only removeBrowserJourney calls removeItem on a journey key, and nothing in the module calls it.
  const src = readFileSync(new URL('./src/lib/journeyStorage.ts', import.meta.url), 'utf8');
  const calls = src.match(/removeBrowserJourney\(/g) || [];
  assert.equal(calls.length, 1, 'declared, never called here');
  const removes = src.match(/localStorage\.removeItem\(/g) || [];
  assert.equal(removes.length, 2, 'the copy and its lineage records, both inside removeBrowserJourney');
  const body = src.slice(src.indexOf('export function removeBrowserJourney'), src.indexOf('export function restoreBrowserJourney'));
  assert.equal((body.match(/localStorage\.removeItem\(/g) || []).length, 2);
});

test('the usage estimate counts every key and value, and journeys apart', () => {
  assert.deepEqual(browserStorageUsage(), { usedChars: 0, journeyChars: 0 });
  store.set('jourvance_active_project', 'x'.repeat(100));
  store.set('jourvance_journey:A', 'y'.repeat(200));
  store.set('jourvance_range', '30');
  const usage = browserStorageUsage();
  assert.equal(usage.journeyChars, 'jourvance_active_project'.length + 100 + 'jourvance_journey:A'.length + 200);
  assert.equal(usage.usedChars, usage.journeyChars + 'jourvance_range'.length + 2);
});

test('the usage line is an estimate against about 5 MB, and changes after a removal', () => {
  assert.equal(BROWSER_STORAGE_LIMIT_CHARS, 5 * 1024 * 1024);
  assert.equal(formatStorageMb(BROWSER_STORAGE_LIMIT_CHARS), '5 MB');
  assert.equal(formatStorageMb(3.14 * 1024 * 1024), '3.1 MB');
  assert.equal(storageUsageLine(null), null, 'a browser that will not say gets no line, never a zero');
  assert.equal(storageUsageLine({ usedChars: 3.1 * 1024 * 1024, journeyChars: 0 }), 'About 3.1 MB of 5 MB used in this browser.');

  saveCurrentJourney({ ...journey('A', 'Open one'), padding: 'a'.repeat(400 * 1024) });
  store.set('jourvance_journey:B', JSON.stringify({ ...journey('B', 'Big one'), padding: 'b'.repeat(1024 * 1024) }));
  const before = storageUsageLine(browserStorageUsage());
  assert.equal(before, 'About 1.8 MB of 5 MB used in this browser.');
  removeBrowserJourney('B', 'A');
  assert.equal(storageUsageLine(browserStorageUsage()), 'About 801 KB of 5 MB used in this browser.');
  for (const line of [before, storageUsageLine(browserStorageUsage())]) assert.doesNotMatch(line, /—|\s–\s/);
});

test('small totals count in KB and large ones in MB, each worded as an estimate', () => {
  const line = chars => storageUsageLine({ usedChars: chars, journeyChars: 0 });
  const KB = 1024;
  // Nothing and a few characters are a bound, never "About 0 KB".
  assert.equal(line(0), 'Less than 1 KB of 5 MB used in this browser.');
  assert.equal(line(10), 'Less than 1 KB of 5 MB used in this browser.');
  assert.equal(line(511), 'Less than 1 KB of 5 MB used in this browser.');
  // Whole KB from where the count rounds to 1 up to the last KB below the switch.
  assert.equal(line(512), 'About 1 KB of 5 MB used in this browser.');
  assert.equal(line(14 * KB), 'About 14 KB of 5 MB used in this browser.');
  assert.equal(line(999 * KB), 'About 999 KB of 5 MB used in this browser.');
  assert.equal(STORAGE_KB_BELOW, 1000);
  // From 1000 KB it is MB to one decimal, so the line never reads "1000 KB" or "0.9 MB".
  assert.equal(line(1000 * KB), 'About 1 MB of 5 MB used in this browser.');
  assert.equal(line(1.25 * KB * KB), 'About 1.3 MB of 5 MB used in this browser.');
  assert.equal(line(BROWSER_STORAGE_LIMIT_CHARS), 'About 5 MB of 5 MB used in this browser.');
  assert.equal(formatStorageAmount(999.4 * KB), '999 KB');
  assert.equal(formatStorageAmount(999.6 * KB), '1 MB');
});

test('removing an ordinary journey changes the usage line, and Undo changes it back', () => {
  // Two journeys the size of the starter blueprint (about 5 KB each), as a user's library holds.
  const ordinary = (id, name) => ({ ...journey(id, name), notes: 'n'.repeat(5 * 1024) });
  saveCurrentJourney(ordinary('A', 'Open one'));
  store.set('jourvance_journey:B', JSON.stringify(ordinary('B', 'Spring journey')));
  const before = storageUsageLine(browserStorageUsage());
  assert.match(before, /^About \d+ KB of 5 MB used in this browser\.$/);
  const result = removeBrowserJourney('B', 'A');
  assert.equal(result.ok, true, 'the journey was removed');
  const after = storageUsageLine(browserStorageUsage());
  assert.notEqual(after, before, 'the line moves when a journey leaves this browser');
  assert.equal(restoreBrowserJourney(result.removed), true);
  assert.equal(storageUsageLine(browserStorageUsage()), before, 'Undo puts the line back');
});

test('a usage read the browser refuses is null, not zero', () => {
  parkJourney(journey('B', 'Holiday offer'));
  const realKey = globalThis.localStorage.key;
  globalThis.localStorage.key = () => { throw new Error('blocked'); };
  try {
    assert.equal(browserStorageUsage(), null);
  } finally {
    globalThis.localStorage.key = realKey;
  }
});
