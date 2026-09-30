import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The journey library's rules (src/lib/journeyLibrary.ts): copying a journey without carrying its
// live pages or its counts, renaming, choosing the newer of two copies, and reading the account
// list so that a failed or partial answer is never shown as an empty or complete one.

const lib = await import('./src/lib/journeyLibrary.ts');
const {
  duplicateJourney, renameJourney, pickNewer, fromServerJourney, mergeLibrary, hasUnsavedEdits,
  readJourneyList, newJourneyId, journeyToken, switchUnsaved,
  browserCopyHasOwnChanges, removalConsequence, removedNotice, removeOpenElsewhere, removeNotSavedHere, REMOVE_OPEN, REMOVE_REFUSED, RESTORE_REFUSED
} = lib;

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function fixture() {
  return {
    id: 'journey-src',
    name: 'Spring launch',
    businessType: 'shop',
    offerHeadline: 'Offer',
    goal: 'sales',
    updatedAt: '2026-09-01T00:00:00.000Z',
    nodes: [
      {
        id: 'node-page-1', type: 'landing-page', position: { x: 0, y: 0 },
        data: {
          type: 'landing-page', label: 'Page', slug: 'vip', published: true, publishedAt: '2026-08-01T00:00:00.000Z',
          publishedUrl: '/p/vip', customDomain: 'offer.example.com', customDomainVerified: true,
          visitors: 120, conversions: 30, headline: 'Money-back guarantee on every order'
        }
      },
      {
        id: 'node-up-1', type: 'upsell', position: { x: 100, y: 0 },
        data: { type: 'upsell', label: 'Upsell', slug: '', published: true, publishedUrl: '/p/node-up-1-upsell', takes: 4 }
      },
      {
        id: 'node-page-9', type: 'landing-page', position: { x: 200, y: 0 },
        data: { type: 'landing-page', label: 'Odd', slug: '***', visitors: 5 }
      },
      {
        id: 'node-split-1', type: 'ab-split', position: { x: 300, y: 0 },
        data: { type: 'ab-split', label: 'Split', slug: 'try', branchAPageSlug: 'vip', branchBPageSlug: 'elsewhere', branchAVisitors: 7 }
      },
      {
        id: 'node-ad-1', type: 'ad-source', position: { x: 400, y: 0 },
        data: { type: 'ad-source', label: 'Ad', spend: 50, clicks: 9, impressions: 1000, utmCampaign: 'spring' }
      }
    ],
    edges: [
      { id: 'e1', source: 'node-ad-1', target: 'node-page-1', data: { sourceThroughput: 9, targetCount: 3, rate: 33 } },
      { id: 'e2', source: 'node-page-1', target: 'node-up-1', data: { sourceThroughput: 3, targetCount: 1, rate: 33, dropOffAlert: true } }
    ]
  };
}

const node = (p, id) => p.nodes.find(n => n.id === id);

test('duplicate: new id and name, same step ids, own publish paths, no counts, text kept', () => {
  const src = fixture();
  const before = structuredClone(src);
  const copy = duplicateJourney(src, { id: 'journey-x', now: '2026-09-28T00:00:00.000Z', token: 'k3f9' });

  assert.equal(copy.id, 'journey-x');
  assert.equal(copy.name, 'Spring launch copy');
  assert.equal(copy.updatedAt, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(copy.nodes.map(n => n.id), src.nodes.map(n => n.id));

  assert.equal(node(copy, 'node-page-1').data.slug, 'vip-copy-k3f9');
  assert.equal(node(copy, 'node-up-1').data.slug, 'node-up-1-upsell-copy-k3f9');
  // '***' cleans to nothing, so the publish route's own fallback is the base.
  assert.equal(node(copy, 'node-page-9').data.slug, 'offer-node-p-copy-k3f9');
  assert.equal(node(copy, 'node-split-1').data.slug, 'try-copy-k3f9');
  assert.equal(node(copy, 'node-split-1').data.branchAPageSlug, 'vip-copy-k3f9');
  assert.equal(node(copy, 'node-split-1').data.branchBPageSlug, 'elsewhere', 'a slug no page of this journey owns is left alone');

  const page = node(copy, 'node-page-1').data;
  assert.equal(page.published, false);
  for (const key of ['publishedAt', 'publishedUrl', 'customDomain', 'customDomainVerified']) {
    assert.equal(key in page, false, `${key} is removed`);
  }
  assert.equal(node(copy, 'node-up-1').data.published, false);
  assert.equal('publishedUrl' in node(copy, 'node-up-1').data, false);

  assert.equal(page.visitors, 0);
  assert.equal(page.conversions, 0);
  assert.equal(node(copy, 'node-up-1').data.takes, 0);
  assert.equal(node(copy, 'node-split-1').data.branchAVisitors, 0);
  const ad = node(copy, 'node-ad-1').data;
  assert.equal(ad.clicks, 0);
  assert.equal(ad.impressions, 0);
  assert.equal(ad.spend, 50, 'ad spend is typed by the person, not measured');
  assert.equal(ad.utmCampaign, 'spring');
  assert.equal(page.headline, 'Money-back guarantee on every order', 'copy text is never scrubbed');

  for (const e of copy.edges) {
    assert.equal(e.data.sourceThroughput, 0);
    assert.equal(e.data.targetCount, 0);
    assert.equal(e.data.rate, 0);
  }
  assert.equal(copy.edges[1].data.dropOffAlert, true);

  assert.deepEqual(src, before, 'the original is not changed');
});

test('the duplicate zeroes every measured key liveStats.ts knows', async () => {
  const { MEASURED_KEYS } = await import('./src/lib/liveStats.ts');
  const keys = [...MEASURED_KEYS];
  assert.ok(keys.length > 20);
  const data = Object.fromEntries(keys.map(k => [k, 7]));
  const copy = duplicateJourney(
    { id: 'j', name: 'J', businessType: '', offerHeadline: '', goal: '', updatedAt: '', edges: [], nodes: [{ id: 'n', type: 'lead-form', position: { x: 0, y: 0 }, data: { ...data } }] },
    { id: 'j2', now: 'now', token: 'abcd' }
  );
  for (const k of keys) assert.equal(copy.nodes[0].data[k], 0, `${k} is zeroed`);
});

test('duplicate caps the name at 100 characters', () => {
  const src = { ...fixture(), name: 'n'.repeat(100) };
  assert.equal(duplicateJourney(src, { id: 'j', now: 'x', token: 'aaaa' }).name.length, 100);
});

test('newJourneyId and journeyToken', () => {
  assert.equal(newJourneyId(1_700_000_000_000, 'k3f9'), `journey-${(1_700_000_000_000).toString(36)}-k3f9`);
  for (let i = 0; i < 50; i += 1) assert.match(journeyToken(), /^[a-z0-9]{4}$/);
});

test('renameJourney trims, caps, refuses blank or unchanged names, and stamps updatedAt', () => {
  const p = fixture();
  const renamed = renameJourney(p, '  Autumn  ', 'now');
  assert.equal(renamed.name, 'Autumn');
  assert.equal(renamed.updatedAt, 'now');
  assert.equal(p.name, 'Spring launch');
  assert.equal(renameJourney(p, 'x'.repeat(130), 'now').name.length, 100);
  assert.equal(renameJourney(p, '   ', 'now'), null);
  assert.equal(renameJourney(p, ' Spring launch ', 'now'), null);
});

test('pickNewer: a strictly newer remote wins, an equal one keeps local, null gives the other', () => {
  const local = { id: 'a', updatedAt: '2026-09-02' };
  assert.equal(pickNewer(local, { id: 'a', updatedAt: '2026-09-03' }).updatedAt, '2026-09-03');
  const same = { id: 'a', updatedAt: '2026-09-02' };
  assert.equal(pickNewer(local, same), local);
  assert.equal(pickNewer(local, { id: 'a', updatedAt: '2026-09-01' }), local);
  assert.equal(pickNewer(null, same), same);
  assert.equal(pickNewer(local, null), local);
  assert.equal(pickNewer(null, null), null);
});

test('fromServerJourney refuses a body without node and edge arrays, and names an untitled one', () => {
  assert.equal(fromServerJourney(null), null);
  assert.equal(fromServerJourney({ id: 'a', nodes: [] }), null);
  assert.equal(fromServerJourney({ id: 'a', edges: [] }), null);
  assert.equal(fromServerJourney({ nodes: [], edges: [] }), null);
  const p = fromServerJourney({ id: 'a', nodes: [], edges: [], updatedAt: '2026-09-02', forecast: { x: 1 } });
  assert.equal(p.name, 'Untitled Journey');
  assert.equal(p.businessType, '');
  assert.deepEqual(p.forecast, { x: 1 });
  assert.equal(p.updatedAt, '2026-09-02');
});

test('mergeLibrary: one row per id, where each copy lives, the open one first, then newest', () => {
  const local = [
    { id: 'a', name: 'A local', updatedAt: '2026-09-05', nodes: [1, 2], edges: [] },
    { id: 'b', name: 'B', updatedAt: '2026-09-01', nodes: [1], edges: [] },
    { id: 'c', name: 'C', updatedAt: '2026-09-09', nodes: [], edges: [] }
  ];
  const account = [
    { id: 'a', name: 'A account', updatedAt: '2026-09-03', nodeCount: 9 },
    { id: 'b', name: 'B renamed', updatedAt: '2026-09-04', nodeCount: 3 },
    { id: 'd', name: 'D', updatedAt: '2026-09-08', nodeCount: 4 }
  ];
  const rows = mergeLibrary(local, account, 'b');
  assert.deepEqual(rows.map(r => r.id), ['b', 'c', 'd', 'a']);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(byId.a, { id: 'a', name: 'A local', updatedAt: '2026-09-05', nodeCount: 2, inBrowser: true, inAccount: true, newerInBrowser: true });
  assert.deepEqual(byId.b, { id: 'b', name: 'B renamed', updatedAt: '2026-09-04', nodeCount: 3, inBrowser: true, inAccount: true, newerInBrowser: false });
  assert.deepEqual(byId.c, { id: 'c', name: 'C', updatedAt: '2026-09-09', nodeCount: 0, inBrowser: true, inAccount: false, newerInBrowser: false });
  assert.deepEqual(byId.d, { id: 'd', name: 'D', updatedAt: '2026-09-08', nodeCount: 4, inBrowser: false, inAccount: true, newerInBrowser: false });

  const signedOut = mergeLibrary(local, null, 'a');
  assert.deepEqual(signedOut.map(r => r.id), ['a', 'c', 'b']);
  assert.ok(signedOut.every(r => r.inBrowser && !r.inAccount && !r.newerInBrowser));
});

test('hasUnsavedEdits', () => {
  assert.equal(hasUnsavedEdits({ kind: 'failed', message: 'x', retryable: true }, 't1', 't1'), true);
  assert.equal(hasUnsavedEdits({ kind: 'saved', savedUpdatedAt: 't2' }, 't2', 't1'), false);
  assert.equal(hasUnsavedEdits({ kind: 'saved', savedUpdatedAt: 't2' }, 't3', 't1'), true);
  assert.equal(hasUnsavedEdits({ kind: 'not-backed-up', savedUpdatedAt: 't2' }, 't3', 't1'), true);
  assert.equal(hasUnsavedEdits({ kind: 'idle' }, 't1', 't1'), false);
  assert.equal(hasUnsavedEdits({ kind: 'idle' }, 't2', 't1'), true);
  assert.equal(hasUnsavedEdits({ kind: 'browser-only', savedUpdatedAt: 't2' }, 't2', 't1'), true);
});

test('readJourneyList never reads a failed or partial answer as a complete list', () => {
  const offline = readJourneyList(null);
  assert.equal(offline.rows, null);
  assert.equal(offline.complete, false);
  assert.deepEqual(offline.notice, {
    message: 'Your account list could not be loaded because the server could not be reached. Journeys kept in this browser are shown.',
    retryable: true
  });

  const expired = readJourneyList({ status: 401, body: { success: false, error: 'Unauthorized' } });
  assert.equal(expired.rows, null);
  assert.equal(expired.complete, false);
  assert.deepEqual(expired.notice, { message: 'Your sign-in has expired. Sign in again to see the journeys in your account.', retryable: false });

  const down = readJourneyList({ status: 503, body: { success: false, error: 'Store unavailable.' } });
  assert.equal(down.rows, null);
  assert.equal(down.complete, false);
  assert.deepEqual(down.notice, { message: 'Store unavailable.', retryable: true });

  const refused = readJourneyList({ status: 403, body: {} });
  assert.deepEqual(refused.notice, { message: 'Your account list could not be loaded. The server answered with status 403.', retryable: false });

  const partial = readJourneyList({ status: 200, body: { success: true, journeys: [], complete: false } });
  assert.deepEqual(partial.rows, []);
  // Rows came back, but not all of them: the list is not complete.
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.notice, {
    message: 'This list may be missing some journeys, because the journey store did not answer in full. Try again in a minute.',
    retryable: true
  });

  const whole = readJourneyList({ status: 200, body: { success: true, journeys: [{ id: 'a', name: '', updatedAt: 't', nodeCount: 2 }, { name: 'no id' }], complete: true } });
  assert.deepEqual(whole.rows, [{ id: 'a', name: 'Untitled Journey', updatedAt: 't', nodeCount: 2 }]);
  assert.equal(whole.notice, null);
  assert.equal(whole.complete, true);

  const noList = readJourneyList({ status: 200, body: { success: true } });
  assert.equal(noList.rows, null);
  assert.equal(noList.complete, false);
  assert.ok(noList.notice);
});

test('a failed or partial account list is said once and tags no journey as "This browser only"', () => {
  // The 503 journeyListRoutes.mjs sends when the list throws. Its sentence already says the list
  // failed, so the lead is not put in front of it (that read as the same failure twice).
  const server = read('./server/routes/journeyListRoutes.mjs');
  const sentence = /const LIST_FAILED = '([^']+)'/.exec(server)?.[1];
  assert.ok(sentence, 'the server names its list failure');
  const failed = readJourneyList({ status: 503, body: { success: false, error: sentence } });
  assert.equal(failed.rows, null);
  assert.deepEqual(failed.notice, { message: sentence, retryable: true });
  assert.equal(failed.notice.message.includes(lib.LIST_FAILED_LEAD), false);
  // No reason given: the lead says what failed, then the status.
  const bare = readJourneyList({ status: 500, body: { success: false, error: '  ' } });
  assert.deepEqual(bare.notice, { message: 'Your account list could not be loaded. The server answered with status 500.', retryable: true });

  // A partial answer (listJourneyDocs' complete:false) still carries rows, so a journey missing
  // from it may well be in the account.
  const partial = readJourneyList({ status: 200, body: { success: true, journeys: [{ id: 'other', name: 'Other', updatedAt: 't', nodeCount: 1 }], complete: false } });
  assert.equal(Array.isArray(partial.rows), true);
  assert.equal(partial.complete, false);

  // The account was not read in full, so the dialog must not claim a journey is missing from it:
  // the tag is gated on the complete flag, never on rows merely being an array.
  const dialog = read('./src/components/modals/JourneyLibraryDialog.tsx');
  const tag = dialog.split('\n').find(line => line.includes('>This browser only<'));
  assert.ok(tag, 'the dialog renders the tag');
  assert.match(tag, /\{uid && accountComplete && !row\.inAccount && </);
  assert.match(dialog, /const \{ rows, complete, notice \} = readJourneyList\(answer\);\s*setAccountRows\(rows\);\s*setAccountComplete\(complete\);/);
  assert.match(dialog, /setAccountRows\(null\);\s*setAccountComplete\(false\);/, 'signing out forgets the full read');
});

test('a retry that clears the list notice hands focus to the dialog title', () => {
  // The Try again button unmounts once the list loads, so focus would fall to the page behind.
  const dialog = read('./src/components/modals/JourneyLibraryDialog.tsx');
  assert.match(dialog, /<h2 id=\{TITLE_ID\} ref=\{titleRef\} tabIndex=\{-1\}/);
  assert.match(dialog, /ref=\{retryRef\}[^>]*onClick=\{\(\) => \{ retried\.current = true; void loadAccount/);
  assert.match(dialog, /if \(!retried\.current \|\| loading\) return;\s*retried\.current = false;\s*if \(!retryRef\.current\) titleRef\.current\?\.focus\(\);/);
});

test('notices are plain sentences with no em dash or spaced en dash', () => {
  assert.equal(lib.NOT_IN_BROWSER, 'That journey is not in this browser. Sign in to open it from your account.');
  assert.equal(lib.NOT_IN_ACCOUNT, 'That journey was not found in your account or in this browser.');
  assert.equal(lib.STEP_GONE, 'That step is not in this journey any more, so the whole map is shown.');
  assert.equal(lib.SWITCH_REFUSED, 'Still on this journey, because it could not be kept in this browser or saved to your account. Try again once it is saved.');
  assert.equal(
    switchUnsaved('Spring launch'),
    '"Spring launch" was not saved to your account, so its latest changes are kept in this browser only. Open it again and save to keep them.'
  );
  for (const file of [
    './src/lib/journeyLibrary.ts',
    './src/lib/journeyRoute.ts',
    './src/lib/journeyClient.ts',
    './src/lib/useJourneyNavigation.ts',
    './src/components/modals/ModalDialog.tsx',
    './src/components/modals/JourneyLibraryDialog.tsx',
    './server/journeyList.mjs'
  ]) {
    const source = read(file);
    assert.equal(source.includes('—'), false, `${file} has no em dash`);
    assert.equal(source.includes(' – '), false, `${file} has no spaced en dash`);
  }
});

// ---- F4: what removing a browser copy costs ----

test('a browser copy holds its own changes unless lineage says the account has them', () => {
  const acct = '2026-09-10T00:00:00.000Z';
  assert.equal(browserCopyHasOwnChanges(acct, acct, null), false, 'the account revision itself');
  assert.equal(browserCopyHasOwnChanges('1970-01-01T00:00:00.000Z', acct, null), false, 'the untouched starter map');
  assert.equal(browserCopyHasOwnChanges('L1', acct, { remoteUpdatedAt: acct, localUpdatedAt: 'L1' }), false, 'nothing changed here since the last match');
  assert.equal(browserCopyHasOwnChanges('L1', 'later', { remoteUpdatedAt: acct, localUpdatedAt: 'L1' }), false, 'the account moved on from this copy');
  assert.equal(browserCopyHasOwnChanges('L2', acct, { remoteUpdatedAt: acct, localUpdatedAt: 'L1' }), true, 'edited here since');
  assert.equal(browserCopyHasOwnChanges('2026-09-12T00:00:00.000Z', acct, null), true, 'no record: read as holding changes');
  // Lineage, never the clock: an older browser stamp with no record still warns.
  assert.equal(browserCopyHasOwnChanges('2026-09-01T00:00:00.000Z', acct, null), true);
});

test('the confirm says what a removal costs, for every case', () => {
  const says = (f) => removalConsequence({ signedIn: true, accountListed: true, inAccount: true, ownChanges: false, ...f });
  assert.equal(says({}), 'Your account copy is not affected.');
  assert.match(says({ ownChanges: true }), /^Your account copy is not affected, but this browser has changes your account copy does not, and those changes will be lost\.$/);
  assert.match(says({ inAccount: false }), /not in your account, so this is the only copy/);
  assert.match(says({ accountListed: false }), /could not be read, so this may be the only copy/);
  assert.match(says({ signedIn: false }), /signed out, so this is the only copy/);
  // The account copy is never promised when nobody is signed in or the list is unread.
  for (const f of [{ signedIn: false }, { accountListed: false }, { inAccount: false }]) assert.doesNotMatch(says(f), /not affected/);
  for (const text of [says({}), says({ ownChanges: true }), says({ inAccount: false }), says({ accountListed: false }), says({ signedIn: false }),
    removedNotice('Spring launch'), removeOpenElsewhere('Spring launch'), REMOVE_OPEN, REMOVE_REFUSED, RESTORE_REFUSED]) {
    assert.doesNotMatch(text, /—|\s–\s/, text);
  }
  assert.equal(removedNotice('Spring launch'), 'Removed "Spring launch" from this browser.');
  assert.doesNotMatch(REMOVE_REFUSED, /try again/i, 'retrying a refused change of storage cannot help');
  // Another tab holds the slot: the advice is about that tab, never "open another journey" here
  // (this tab already has one open), and never "close it" (closing does not free the slot).
  assert.equal(removeOpenElsewhere('Spring launch'),
    '"Spring launch" was last opened in another tab of this browser, so it is not removed. Open a different journey in that tab first.');
  assert.doesNotMatch(removeOpenElsewhere('Spring launch'), /close/i);
  assert.notEqual(removeOpenElsewhere('Spring launch'), REMOVE_OPEN);
  // F4: this tab could not write the open journey over the slot. No other tab is claimed, and making
  // room is advised only when it is out of space and another copy can be removed.
  assert.equal(removeNotSavedHere('Alpha', true, true),
    '"Alpha" is not removed, because this browser ran out of space before it could save the open journey in its place. Remove a different journey to make room, then try again.');
  assert.equal(removeNotSavedHere('Alpha', true, false),
    '"Alpha" is not removed, because this browser ran out of space before it could save the open journey in its place.');
  assert.equal(removeNotSavedHere('Alpha', false, true),
    '"Alpha" is not removed, because this browser has not saved the open journey in its place.');
  for (const [full, room] of [[true, true], [true, false], [false, true], [false, false]]) {
    const text = removeNotSavedHere('Alpha', full, room);
    assert.doesNotMatch(text, /another tab|—|\s–\s/, text);
  }
});
