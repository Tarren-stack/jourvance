import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BROADCASTS_LIST, BROADCASTS_READ, FORMS_LIST, FORMS_READ, INBOX_HOLDS, KLAVIYO_READ, LISTS_LIST, LIST_LOADING, NOT_CONNECTED_ERROR, PEOPLE_LIST, PEOPLE_READ,
  PHONES_READ, POSTAL_NOT_SAVED, POSTAL_READ, REPLIES_LIST, REPLIES_READ, REPLY_POLICY_HOLDS, REPLY_POLICY_READ, RESULTS_LIST, RESULTS_READ, SEGMENTS_READ,
  SENDING_READ, STARTER_PEOPLE_LIST, STARTER_PEOPLE_READ, TEXTS_HOLDS, TEXTS_READ, UNANSWERED_TAIL, listLine, nothingSent, readOutcome, resultsLine,
  retryLabel, studioRead
} from './src/lib/studioLoad.ts';
import { FLOWS_EMPTY, FLOWS_FAILED, FLOWS_NOT_CONNECTED, FLOWS_SIGN_IN, flowRows, flowsListLoad, noOwnFlows } from './src/lib/emailFlowsList.ts';
import { FLOW_MAP_UNREACHABLE } from './src/lib/flowMapLoad.ts';

// EMAIL_STUDIO_PLAN.md D6, Wave 6: honest states. A read that failed never says "none", "no replies"
// or a 0: each studio list is loading, loaded or failed, and only a list the server answered with,
// empty, says its empty sentence. The rules and the words are src/lib/studioLoad.ts (and, for the
// Flows list, src/lib/emailFlowsList.ts), driven here through every way a read ends: unanswered, 401,
// 500, 503 "not connected", a 200 that holds no list, and an empty list. The components are pinned
// to print the line those rules give and no empty sentence of their own. The rendered screens are
// scripts/email-studio-browser-check.mjs's states-401, states-500, states-unanswered and states-empty.

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
/** The source without its comments, so a sentence a comment quotes is not read as one the page prints. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
const suite = read('./src/components/campaign/HubEmailSuite.tsx');
const inbox = read('./src/components/campaign/EmailInbox.tsx');
const sms = read('./src/components/campaign/SmsPanel.tsx');
const list = read('./src/components/campaign/EmailFlowsList.tsx');
const map = read('./src/components/campaign/EmailFlowMap.tsx');
const desk = read('./src/components/campaign/AudienceDesk.tsx');
const forms = read('./src/components/campaign/SignupForms.tsx');
const klaviyo = read('./src/components/campaign/KlaviyoSync.tsx');
const sending = read('./src/components/campaign/SendingSetup.tsx');
const lineSrc = read('./src/components/campaign/StudioListLine.tsx');
const composer = read('./src/components/campaign/BroadcastComposer.tsx');

/** The source from `start` up to (not including) `end`. Both must be found, in that order. */
function between(src, start, end, name) {
  const from = src.indexOf(start);
  assert.ok(from > -1, `${name}: "${start}" was not found`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `${name}: "${end}" was not found after "${start}"`);
  return src.slice(from, to);
}

/** Every way one read can end, for a list whose answer carries `key`. */
const endings = (key, item) => ({
  unanswered: { answered: false },
  401: { answered: true, status: 401, data: { success: false, error: 'Sign in to continue.' } },
  500: { answered: true, status: 500, data: { success: false, error: 'Something broke.' } },
  notConnected: { answered: true, status: 503, data: { success: false, error: 'Email sending is not connected.' } },
  refused: { answered: true, status: 200, data: { success: false, error: 'Refused.' } },
  noList: { answered: true, status: 200, data: { success: true } },
  notJson: { answered: true, status: 502, data: {} },
  empty: { answered: true, status: 200, data: { success: true, [key]: [] } },
  some: { answered: true, status: 200, data: { success: true, [key]: [item] } }
});

// Each list the studio draws: its words, what its answer holds, and its empty sentence.
const LISTS = [
  { name: 'Broadcasts', read: BROADCASTS_READ, list: BROADCASTS_LIST, key: 'broadcasts' },
  { name: 'People', read: PEOPLE_READ, list: PEOPLE_LIST, key: 'subscribers' },
  { name: 'People in starter flows', read: STARTER_PEOPLE_READ, list: STARTER_PEOPLE_LIST, key: 'enrollments' },
  { name: 'Replies', read: REPLIES_READ, list: REPLIES_LIST, key: 'messages' },
  { name: 'Lists', read: SEGMENTS_READ, list: LISTS_LIST, key: 'lists' },
  { name: 'Sign-up forms', read: FORMS_READ, list: FORMS_LIST, key: 'forms' }
];

test('each list: a failed read says its failure and never its empty sentence; an empty answer says the empty sentence', () => {
  let cases = 0;
  for (const row of LISTS) {
    const ends = endings(row.key, { id: 'x' });
    const holds = (data) => Array.isArray(data[row.key]);
    const lineFor = (end) => {
      const outcome = readOutcome(ends[end], row.read, holds);
      const count = outcome.state === 'loaded' ? ends[end].data[row.key].length : 0;
      return listLine(outcome, count, row.list);
    };
    for (const end of ['unanswered', '401', '500', 'notConnected', 'refused', 'noList', 'notJson']) {
      const line = lineFor(end);
      cases++;
      assert.equal(line.kind, 'failed', `${row.name}, ${end}: ${JSON.stringify(line)}`);
      assert.notEqual(line.text, row.list.empty, `${row.name}, ${end}: a failed read says "${row.list.empty}"`);
      assert.ok(!line.text.includes(row.list.empty), `${row.name}, ${end}: "${line.text}" holds the empty sentence`);
    }
    assert.deepEqual(lineFor('unanswered'), { kind: 'failed', text: `${row.read.failed} ${UNANSWERED_TAIL}`, retry: true }, row.name);
    assert.deepEqual(lineFor('401'), { kind: 'failed', text: row.read.signIn, retry: false }, `${row.name}: signed out, Retry cannot help`);
    assert.deepEqual(lineFor('500'), { kind: 'failed', text: row.read.failed, retry: true }, row.name);
    assert.deepEqual(lineFor('empty'), { kind: 'empty', text: row.list.empty }, `${row.name}: an empty answer is the one place the empty sentence is said`);
    assert.deepEqual(lineFor('some'), { kind: 'none', text: '' }, row.name);
    assert.deepEqual(listLine(LIST_LOADING, 0, row.list), { kind: 'loading', text: row.list.loading }, row.name);
    cases += 5;
  }
  assert.ok(cases >= 60, `only ${cases} cases ran`);
});

test('Replies and Texts: email sending not connected is its own sentence, with no Retry; any other 503 is a failure', () => {
  for (const words of [REPLIES_READ, REPLY_POLICY_READ, TEXTS_READ]) {
    const outcome = readOutcome({ answered: true, status: 503, data: { success: false, error: 'Email sending is not connected.' } }, words, () => true);
    assert.deepEqual(outcome, { state: 'failed', text: words.notConnected, retry: false });
    const other = readOutcome({ answered: true, status: 503, data: { success: false, error: 'The hub is busy.' } }, words, () => true);
    assert.deepEqual(other, { state: 'failed', text: words.failed, retry: true });
  }
  assert.equal(REPLIES_READ.notConnected, 'Replies cannot be read while email sending is not connected.');
  assert.equal(TEXTS_READ.failed, 'Text messaging status could not be loaded.');
  // server.mjs proxyHub says exactly this.
  assert.ok(read('./server.mjs').includes("if (!hubReady) return res.status(503).json({ success: false, error: 'Email sending is not connected.' });"));
  assert.match('Email sending is not connected.', NOT_CONNECTED_ERROR);
  // A list with no notConnected words reads a not-connected 503 as a plain failure.
  assert.deepEqual(readOutcome({ answered: true, status: 503, data: { error: 'Email sending is not connected.' } }, BROADCASTS_READ, () => true), { state: 'failed', text: BROADCASTS_READ.failed, retry: true });
});

test('Results is never blank: loading, failed with Retry, nothing sent, or the figures', () => {
  assert.deepEqual(resultsLine(LIST_LOADING, null), { kind: 'loading', text: 'Loading results.' });
  const failed = readOutcome({ answered: true, status: 500, data: {} }, RESULTS_READ, (data) => Boolean(data.analytics));
  assert.deepEqual(resultsLine(failed, null), { kind: 'failed', text: 'Results could not be loaded.', retry: true });
  assert.deepEqual(resultsLine({ state: 'loaded' }, { sent: 0, totalSent: 0 }), { kind: 'empty', text: 'Nothing has been sent yet, so there are no results.' });
  assert.deepEqual(resultsLine({ state: 'loaded' }, { sent: 4 }), { kind: 'none', text: '' });
  // Only a counted 0 is "nothing sent": a figure nobody measured is not.
  assert.equal(nothingSent({ sent: null, totalSent: null }), false);
  assert.equal(nothingSent({ totalSent: 0 }), true);
  assert.equal(nothingSent(null), false);
  assert.deepEqual(resultsLine({ state: 'loaded' }, { sent: null, totalSent: null }), { kind: 'none', text: '' });
  // A failed read never says "nothing sent", even when an earlier read counted none.
  assert.equal(resultsLine(failed, { sent: 0 }).kind, 'failed');
  // A load that says loaded with no figures in hand is not a blank panel either.
  assert.equal(resultsLine({ state: 'loaded' }, null).kind, 'failed');
  assert.equal(RESULTS_LIST.empty, 'Nothing has been sent yet, so there are no results.');
  assert.equal(RESULTS_LIST.loading, 'Loading results.');
});

test('the Flows list: 401, other errors, the server not answering, and "no flows of your own" only of a list that loaded', () => {
  assert.deepEqual(flowsListLoad({ answered: false }), { state: 'failed', text: FLOW_MAP_UNREACHABLE, retry: true });
  assert.deepEqual(flowsListLoad({ answered: true, status: 401, data: { success: false } }), { state: 'failed', text: FLOWS_SIGN_IN, retry: false });
  assert.deepEqual(flowsListLoad({ answered: true, status: 500, data: { success: false } }), { state: 'failed', text: FLOWS_FAILED, retry: true });
  for (const failure of [FLOW_MAP_UNREACHABLE, FLOWS_SIGN_IN, FLOWS_FAILED]) assert.notEqual(failure, FLOWS_EMPTY);
  assert.equal(FLOWS_SIGN_IN, "Sign in to see this account's flows.");
  assert.equal(FLOWS_EMPTY, 'No flows of your own yet. New flow starts one that stays off until you turn it on.');
  assert.equal(FLOWS_NOT_CONNECTED, 'Email sending is not connected on this server, so nothing in these flows sends yet. Your changes still save.');
  // Starter, built-in and order rows are not the account's own: with only those, the empty sentence is said.
  const shared = flowRows([
    { id: 'drip_seq_default', name: 'Welcome', kind: 'sequence', nodes: [] },
    { id: 'post_purchase', name: 'After the order', kind: 'automation', nodes: [] },
    { id: 'order_confirmation', name: 'Order confirmation', kind: 'order', nodes: [] }
  ], []);
  assert.equal(noOwnFlows(shared), true);
  assert.equal(noOwnFlows(flowRows([{ id: 'flow_a', name: 'Mine', kind: 'flow', nodes: [] }], [])), false);
  assert.equal(noOwnFlows([]), true);
  // The component says it only once the list loaded; a failed read shows its alert instead.
  assert.ok(list.includes("{load.state === 'loaded' && noOwnFlows(rows) && ("), 'the empty sentence is not gated on a loaded list');
  assert.equal((code(list).match(/FLOWS_EMPTY/g) || []).length, 2, 'FLOWS_EMPTY is printed somewhere other than its one gated line');
  // The editor reads the status too: signed out it says so instead of drawing an empty map.
  const load = between(map, 'const load = async', 'useEffect(() => {\n    load(', 'the flow map load');
  assert.ok(load.includes("const outcome = flowsListLoad({ answered: true, status, data: read.data });"));
  assert.ok(load.indexOf("if (outcome.state === 'failed') {") < load.indexOf('setFlows('), 'a failed answer can still empty the map');
  assert.match(load, /setLoadRetry\(outcome\.retry\);\s*setLoadError\(outcome\.text\);\s*return;/);
  assert.match(map, /\{loadRetry && <button type="button"/);
  assert.ok(map.includes('{!loadError && !hubConnected && <p'), 'the editor does not say email sending is not connected');
});

test('Replies: a failed read says so and never "No replies have arrived" beside it', () => {
  // The words live in studioLoad.ts; the inbox prints them only through listLine.
  assert.doesNotMatch(code(inbox), /No replies/, 'EmailInbox.tsx prints a "No replies" sentence of its own');
  assert.equal((code(inbox).match(/REPLIES_LIST/g) || []).length, 2, 'REPLIES_LIST is used other than in its import and its one listLine call');
  assert.ok(inbox.includes('<StudioListLine line={listLine(boxLoad, messages.length, REPLIES_LIST)} onRetry={load} busy={reading} />'));
  const load = between(inbox, 'const load = async () => {', 'useEffect(() => { load(); }, []);', 'the inbox load');
  assert.ok(load.includes("readOutcome(box, REPLIES_READ,"), 'the inbox read does not go through readOutcome');
  assert.ok(load.indexOf("if (boxOutcome.state === 'loaded'") < load.indexOf('setMessages('), 'a failed read can empty the inbox');
  assert.doesNotMatch(load, /catch \{/, 'a failure is swallowed into a notice');
  // The policy buttons choose nothing from a policy read that failed.
  assert.ok(inbox.includes("style={policyLoad.state === 'loaded' && policy === id ? solidBtn : ghostBtn}"));
});

test('Texts: a failed status read says so on screen, and the phone count is never a 0 nobody measured', () => {
  assert.doesNotMatch(code(sms), /console\.warn\('Failed to load SMS status/, 'the failure is still a console warning only');
  assert.ok(sms.includes('readOutcome(stateRead, TEXTS_READ, TEXTS_HOLDS)'));
  assert.match(sms, /\{statusLoad\.state === 'failed' && \(\s*<div[^>]*>\s*<StudioListLine line=\{\{ kind: 'failed', text: statusLoad\.text, retry: statusLoad\.retry \}\} onRetry=\{load\} busy=\{reading\} \/>/);
  assert.match(sms, /\{audienceLoad\.state === 'loaded'\s*\? <><strong>\{phoneCount\}<\/strong> of \{totalContacts\} contacts have phones on file<\/>/);
  // offer-presets.test.mjs still finds the composer starting empty.
  assert.match(sms, /useState<string>\(''\)/);
});

test("HubEmailSuite: loadData keeps a loading, loaded or failed state per list, and no read is caught into an empty object", () => {
  const load = between(suite, 'const loadData = async', 'const refreshSequences', 'loadData');
  assert.doesNotMatch(load, /\.then\(r => r\.json\(\)\)\.catch\(\(\) => \(\{\}\)\)/, 'a read is still caught into {}');
  for (const url of ['/api/email/flows', '/api/email/broadcasts', '/api/email/analytics', '/api/email/audience', '/api/email/segments', '/api/email/lists', '/api/drips/sequences', '/api/drips/enrollments', '/api/email/predictions']) {
    assert.ok(load.includes(`studioRead('${url}', headers)`), `${url} is not read through studioRead`);
  }
  for (const [key, words] of [['broadcasts', 'BROADCASTS_READ'], ['analytics', 'RESULTS_READ'], ['audience', 'PEOPLE_READ'], ['enrollments', 'STARTER_PEOPLE_READ']]) {
    assert.match(load, new RegExp(`${key}: readOutcome\\(\\w+, ${words},`), `${key} has no read state`);
    assert.ok(load.includes(`outcomes.${key}.state === 'loaded'`), `${key} is set from a read that did not load`);
  }
  assert.ok(load.includes('setLoads(outcomes);'));
  // The lists say their line, never an empty sentence of their own.
  assert.doesNotMatch(code(suite), /No broadcasts/, 'HubEmailSuite.tsx says "No broadcasts" itself');
  assert.ok(suite.includes('const broadcastsLine = listLine(loads.broadcasts, broadcasts.length, BROADCASTS_LIST);'));
  assert.ok(suite.includes("{broadcastsLine.kind !== 'none' && ("));
  assert.ok(suite.includes('const peopleLine = listLine(loads.audience, subscribers.length, PEOPLE_LIST);'));
  assert.ok(suite.includes("const peopleShown = loads.audience.state === 'loaded' || subscribers.length > 0;"));
  assert.ok(suite.includes('<StudioListLine line={listLine(loads.enrollments, dripEnrollments.length, STARTER_PEOPLE_LIST)} onRetry={loadData} busy={loading} />'));
  // Results draws its panel whatever the read did; the figures need a read that counted sends.
  assert.match(suite, /\{activeTab === 'analytics' && \(\s*<div/, 'the Results panel is still gated on a loaded read (a blank panel)');
  assert.doesNotMatch(suite, /activeTab === 'analytics' && analytics &&/);
  assert.ok(suite.includes('<StudioListLine line={resultsLine(loads.analytics, analytics)} onRetry={loadData} busy={loading} />'));
  assert.ok(suite.includes('{analytics && !nothingSent(analytics) && ('));
  // The opens sentence only from a Results read that answered.
  assert.ok(suite.includes('{analytics && analytics.opensStored !== true && ('));
});

test('Lists, sign-up forms, Klaviyo and Sending say a failed read, and no empty sentence or "Not connected" from one', () => {
  assert.ok(desk.includes("readOutcome(listRead, SEGMENTS_READ, (data) => Array.isArray(data.lists))"));
  assert.doesNotMatch(code(desk), /No lists on this account yet/, 'AudienceDesk.tsx says the empty sentence itself');
  assert.ok(desk.includes('const line = listLine(listsLoad, lists.length, LISTS_LIST);'));
  assert.ok(forms.includes("{!forms.length && formsLoad.state === 'loaded' && ("), 'the sign-up forms empty card shows on a failed read');
  assert.ok(forms.includes("readOutcome(read, FORMS_READ, (data) => Array.isArray(data.forms))"));
  assert.ok(klaviyo.includes("readOutcome(answer, KLAVIYO_READ,"));
  assert.match(klaviyo, /\{state && \(\s*<p[^>]*>\s*\{state\.connected \?/, '"Not connected." is said without a Klaviyo answer');
  assert.ok(sending.includes("readOutcome(senderRead, SENDING_READ, (data) => Array.isArray(data.senders))"));
  assert.ok(sending.includes('{opensStored === false && ('), 'the opens sentence is said from a failed read');
  for (const words of [KLAVIYO_READ, SENDING_READ, FORMS_READ, SEGMENTS_READ]) {
    assert.match(words.signIn, /^Sign in to see /);
    assert.match(words.failed, / could not be loaded\.$/);
  }
});

test('studioRead settles: no answer is unanswered, and an answer is kept with its status whatever its body', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    assert.deepEqual(await studioRead('/api/email/inbox', {}), { answered: false });
    globalThis.fetch = async () => new Response('<html>502</html>', { status: 502 });
    assert.deepEqual(await studioRead('/api/email/inbox', {}), { answered: true, status: 502, data: {} });
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Sign in to continue.' }), { status: 401 });
    assert.deepEqual(await studioRead('/api/email/inbox', {}), { answered: true, status: 401, data: { success: false, error: 'Sign in to continue.' } });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('every state sentence is plain: no em dash, no spaced en dash, one or two sentences', () => {
  const sentences = [
    ...[BROADCASTS_READ, RESULTS_READ, PEOPLE_READ, STARTER_PEOPLE_READ, REPLIES_READ, REPLY_POLICY_READ, TEXTS_READ, SEGMENTS_READ, FORMS_READ, SENDING_READ, KLAVIYO_READ].flatMap((w) => Object.values(w)),
    ...[BROADCASTS_LIST, RESULTS_LIST, PEOPLE_LIST, STARTER_PEOPLE_LIST, REPLIES_LIST, LISTS_LIST, FORMS_LIST].flatMap((w) => Object.values(w)),
    UNANSWERED_TAIL, FLOWS_EMPTY, FLOWS_SIGN_IN, FLOWS_FAILED
  ];
  assert.ok(sentences.length >= 40, `only ${sentences.length} sentences`);
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, /—| – /, sentence);
    assert.match(sentence, /\.$/, `"${sentence}" does not end as a sentence`);
  }
});

// ---- Wave 6 fix round: what the review found ----

test('every Retry is named for the read it tries again, with the word on the button first, and none says Try again', () => {
  assert.equal(retryLabel('Broadcasts could not be loaded.'), 'Retry: Broadcasts could not be loaded.');
  assert.equal(retryLabel('Broadcasts could not be loaded.', true), 'Retrying: Broadcasts could not be loaded.');
  // Two lists on one screen are two names.
  assert.notEqual(retryLabel(BROADCASTS_READ.failed), retryLabel(STARTER_PEOPLE_READ.failed));
  // The shared line: named, and while its read runs the button still says the word Retry starts with.
  assert.ok(lineSrc.includes('aria-label={retryLabel(line.text, busy)}'), 'StudioListLine names its Retry by its failure');
  assert.ok(lineSrc.includes("{busy ? 'Retrying' : 'Retry'}"), "StudioListLine's busy Retry drops the word Retry");
  // Every one-line Retry button in the studio carries a name built by retryLabel.
  const files = { 'EmailFlowsList.tsx': list, 'EmailFlowMap.tsx': map, 'BroadcastComposer.tsx': composer, 'HubEmailSuite.tsx': suite, 'EmailInbox.tsx': inbox, 'SmsPanel.tsx': sms, 'SendingSetup.tsx': sending, 'AudienceDesk.tsx': desk, 'SignupForms.tsx': forms, 'KlaviyoSync.tsx': klaviyo };
  let named = 0;
  for (const [name, src] of Object.entries(files)) {
    const buttons = code(src).match(/<button\b[^\n]*?>Retry<\/button>/g) || [];
    for (const button of buttons) {
      assert.match(button, /aria-label=\{retryLabel\(/, `${name}: a Retry is named only "Retry": ${button.slice(0, 120)}`);
      named++;
    }
    assert.doesNotMatch(code(src), /'Try again'|>\s*Try again\s*</, `${name}: a button says Try again`);
  }
  // Wave 8: All flows draws the shared line now (its Retry is named above), so three one-line buttons remain.
  assert.ok(named >= 3, `only ${named} one-line Retry buttons were read`);
  assert.ok(list.includes('<StudioListLine') && list.includes('onRetry={read}') && list.includes('busy={reading}'), 'All flows does not draw its failure through StudioListLine');
  // Open checkouts uses the shared line instead of its own Try again button.
  assert.ok(suite.includes("<StudioListLine line={{ kind: 'failed', text: checkoutsLoad.text, retry: checkoutsLoad.retry }} onRetry={() => { void loadData(); }} busy={loading} />"));
});

test('a Retry that fails again with the same words draws the failure as a new node, and Retry keeps its focus', () => {
  // The failure's span is keyed by a round that moves on each time a running read ends.
  assert.ok(lineSrc.includes('<span key={round}>{line.text}</span>'), 'the failure text is not re-drawn after a retry');
  assert.match(lineSrc, /if \(wasBusy\.current && !busy\) setRound\(\(n\) => n \+ 1\);\s*wasBusy\.current = Boolean\(busy\);\s*\}, \[busy\]\);/);
  // The button is not keyed, so it stays the node keyboard focus is on.
  assert.doesNotMatch(lineSrc, /<button\s+key=/);
});

test('a read relayed from the email service that does not say success is a failure, never an empty inbox or a loaded status', () => {
  const answered200 = (data) => ({ answered: true, status: 200, data });
  for (const [words, holds, list] of [[REPLIES_READ, INBOX_HOLDS, REPLIES_LIST], [REPLY_POLICY_READ, REPLY_POLICY_HOLDS, null], [TEXTS_READ, TEXTS_HOLDS, null]]) {
    // What studioRead hands back for a 200 whose body is HTML or empty.
    const outcome = readOutcome(answered200({}), words, holds);
    assert.deepEqual(outcome, { state: 'failed', text: words.failed, retry: true }, words.failed);
    if (list) assert.notEqual(listLine(outcome, 0, list).text, list.empty);
    // A body with no success field is not proxyHub's either.
    assert.equal(readOutcome(answered200({ messages: [], policy: {} }), words, holds).state, 'failed', words.failed);
  }
  // What proxyHub does answer still loads, including an inbox that says success and holds no messages field.
  assert.deepEqual(readOutcome(answered200({ success: true }), REPLIES_READ, INBOX_HOLDS), { state: 'loaded' });
  assert.deepEqual(readOutcome(answered200({ success: true, messages: [], counts: {} }), REPLIES_READ, INBOX_HOLDS), { state: 'loaded' });
  assert.deepEqual(readOutcome(answered200({ success: true, policy: { autopilot: 'off' } }), REPLY_POLICY_READ, REPLY_POLICY_HOLDS), { state: 'loaded' });
  assert.deepEqual(readOutcome(answered200({ success: true, configured: false, live: false }), TEXTS_READ, TEXTS_HOLDS), { state: 'loaded' });
  assert.equal(readOutcome(answered200({ success: true, messages: 'none' }), REPLIES_READ, INBOX_HOLDS).state, 'failed');
  // server.mjs proxyHub answers every relayed 2xx with success: true, which is what the rule leans on.
  const server = read('./server.mjs');
  const proxy = between(server, 'async function proxyHub(res, run) {', '\n}\n', 'proxyHub');
  assert.ok(proxy.includes("if (!data || typeof data !== 'object') return res.json({ success: true });"));
  assert.ok(proxy.includes('return res.json({ success: true, ...data });'));
  // The screens read through these rules.
  assert.ok(inbox.includes('readOutcome(box, REPLIES_READ, INBOX_HOLDS)'));
  assert.ok(inbox.includes('readOutcome(pol, REPLY_POLICY_READ, REPLY_POLICY_HOLDS)'));
});

test('one cause, one alert: Replies, Texts and Sending say a shared failure once', () => {
  // Replies: the policy alert only when the replies read did not fail too.
  assert.ok(inbox.includes("{policyLoad.state === 'failed' && boxLoad.state !== 'failed' && <p role=\"alert\""), 'the reply policy alert shows beside the replies alert');
  // Texts: the phone count's own alert only when the status read did not fail too.
  assert.match(sms, /\{audienceLoad\.state === 'failed' && statusLoad\.state !== 'failed' \? \(\s*<StudioListLine/);
  // Sending: the postal address alert only when the senders read did not fail too.
  assert.ok(sending.includes("{postalLoad.state === 'failed' && setupLoad.state !== 'failed' && ("));
});

test('Texts: a failed phone count says so with Retry, even when the status read loaded', () => {
  assert.ok(sms.includes('readOutcome(audRead, PHONES_READ, (data) => Array.isArray(data.subscribers))'));
  assert.match(sms, /\{audienceLoad\.state === 'failed' && statusLoad\.state !== 'failed' \? \(\s*<StudioListLine line=\{\{ kind: 'failed', text: audienceLoad\.text, retry: audienceLoad\.retry \}\} onRetry=\{load\} busy=\{reading\} \/>/);
  assert.doesNotMatch(code(sms), /could not be counted/, 'SmsPanel.tsx says the failure in words of its own');
  assert.equal(PHONES_READ.failed, 'Contacts with a phone could not be counted.');
  assert.deepEqual(readOutcome({ answered: true, status: 401, data: { success: false } }, PHONES_READ, () => true), { state: 'failed', text: PHONES_READ.signIn, retry: false });
});

test('Sending: a failed postal address read says so, and Save Postal Footer saves nothing until it loaded', () => {
  assert.ok(sending.includes("readOutcome(suiteRead, POSTAL_READ, (data) => typeof data.suite?.postalAddress === 'string')"));
  assert.match(sending, /if \(postalOutcome\.state === 'loaded'\) \{\s*setAddress\(body\(suiteRead\)\.suite\.postalAddress\);/);
  // The refusal is taken back once the address loads, so it never says "has not loaded" of one that has.
  assert.ok(sending.includes('setNotice((said) => (said === POSTAL_NOT_SAVED ? \'\' : said));'));
  assert.doesNotMatch(sending, /typeof suiteRes\?\.suite\?\.postalAddress === 'string'/, 'the old read that dropped its failure is back');
  assert.match(sending, /<StudioListLine line=\{\{ kind: 'failed', text: postalLoad\.text, retry: postalLoad\.retry \}\} onRetry=\{load\} busy=\{reading\} \/>/);
  // The guard runs before the POST, in the one button that posts the address alone.
  const save = between(sending, "aria-disabled={postalLoad.state !== 'loaded' || undefined}", 'Save Postal Footer', 'Save Postal Footer');
  assert.match(save, /if \(postalLoad\.state !== 'loaded'\) \{\s*setNotice\(POSTAL_NOT_SAVED\);\s*return;\s*\}\s*post\('\/api\/email\/postal'/);
  assert.equal(POSTAL_READ.failed, 'The saved postal address could not be loaded.');
  assert.doesNotMatch(POSTAL_NOT_SAVED, /—| – /);
});

test('the not-connected line on Flows is a status, so it is not only a colour', () => {
  assert.ok(list.includes("<p role=\"status\" style={{ margin: 0, fontSize: 13, color: '#fbbf24' }}>{FLOWS_NOT_CONNECTED}</p>"), 'EmailFlowsList.tsx');
  assert.ok(map.includes("{!loadError && !hubConnected && <p role=\"status\" style={{ margin: 0, fontSize: 13, color: '#fbbf24' }}>{FLOWS_NOT_CONNECTED}</p>}"), 'EmailFlowMap.tsx');
});

// ---- Open list (2026-10-09): a refused manual enrol in the customer drawer says why ----

test('the customer drawer says why Enroll did not add someone, in a status region beside the control, cleared on the next try', () => {
  const drawer = read('./src/components/campaign/CustomerProfileDrawer.tsx');
  const enroll = between(drawer, 'const handleManualEnroll = async () => {', 'const getInitials', 'the manual enrol');
  // Cleared as the next attempt starts, before anything is sent.
  assert.ok(enroll.indexOf("setEnrollSaid('');") > -1 && enroll.indexOf("setEnrollSaid('');") < enroll.indexOf("fetch('/api/drips/enroll'"), 'the last sentence is not cleared before the next attempt');
  // A refusal says the server's own sentence (the route's 409 names why: the flow is off), never nothing.
  assert.match(enroll, /\} else \{\s*\/\/[^\n]*\n\s*setEnrollSaid\(typeof data\.error === 'string' && data\.error \? data\.error : 'They were not added to that flow\.'\);/);
  assert.match(enroll, /catch \{\s*setEnrollSaid\('The server did not answer, so they may not have been added\.'\);/);
  // Always mounted under the control, so a sentence that appears is announced.
  const picker = between(drawer, '{/* Manual Enroll Picker */}', '{/* Enrollments List */}', 'the enrol control');
  assert.match(picker, /<p role="status" data-enroll-said=""[^>]*>\{enrollSaid\}<\/p>/);
  assert.match(picker, /<select\s+aria-label="Flow to add them to"/, 'the flow picker has no name');
  // The 409 the route answers is a sentence the drawer can show as it is.
  const route = between(read('./server/routes/emailRoutes.mjs'), "app.post('/api/drips/enroll'", "app.post('/api/drips/enrollment-toggle'", 'the enrol route');
  const said = route.match(/return res\.status\(409\)\.json\(\{ success: false, error: '([^']+)' \}\);/);
  assert.ok(said, 'the enrol route no longer answers a turned-off flow with a 409 sentence');
  assert.match(said[1], /turned off/);
  assert.doesNotMatch(said[1], /\u2014| \u2013 /);
});
