// The broadcast composer's payload (EMAIL_STUDIO_PLAN.md Wave 5, D4): New broadcast sends through
// POST /api/email/campaign/send with the builder's blocks, never a flattened body, together with the
// schedule, A/B, holdout and the text add-on the retired modal sent. This holds src/lib/broadcastComposer.ts
// to the shape that route reads, and then posts what it builds to the REAL route on a bare Express app
// (server/routes/emailRoutes.mjs, its own cleaners from audience.mjs, email-doc.mjs and email-map.mjs),
// so "the route reads it" is the route's answer and the campaign it stores, not a second copy of its rules.
// The browser half (the composer on screen, the stubs receiving it) is scripts/email-studio-browser-check.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { cleanBlockList, fillMailTokens } from './email-doc.mjs';
import {
  FOLLOW_UP_NOTE, SCHEDULE_PASSED, SCHEDULE_PAST_GRACE_MS, applyUtm, campaignSchedule, cleanPicks, resolveAudience, smartSkipReason
} from './audience.mjs';
import { cleanHoldout } from './email-map.mjs';
import { smartSendConflict } from './email-predict.mjs';
import { SMART_EMAIL_HOURS, SMART_SMS_HOURS } from './email-flows.mjs';
import { emailHasContent } from './email-flow-content.mjs';
import { CAMPAIGN_DUPLICATE, CAMPAIGN_EMAIL_EMPTY, CAMPAIGN_REQUEST_ID, setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import { cleanDraftSettings } from './server/routes/broadcastDraftRoutes.mjs';

const {
  DEFAULT_BROADCAST_SETTINGS, audienceOptions, blocksHaveContent, campaignSendBody, confirmSendText, draftFromStored, draftHasContent,
  draftRequestBody, emptyBroadcastDraft, lintSummary, previewKey, testSendBody
} = await import('./src/lib/broadcastComposer.ts');

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const BLOCKS = [
  { id: 'b_h', kind: 'heading', text: 'Back in stock' },
  { id: 'b_t', kind: 'text', text: 'Hi {{first_name}}, the spring candles are back.', level: 0 },
  { id: 'b_img', kind: 'image', url: 'https://images.example.test/spring.png', alt: 'Three candles', href: '' },
  { id: 'b_btn', kind: 'button', label: 'Shop the spring candles', url: 'https://shop.example.test/spring' }
];

function draftWith(settings) {
  return { ...emptyBroadcastDraft(), subject: 'Spring restock', previewText: 'The candles are back', blocks: BLOCKS, settings: { ...DEFAULT_BROADCAST_SETTINGS, ...settings } };
}

test('the body carries the blocks, never a body string, with the schedule, A/B, holdout and text add-on as campaign/send reads them', () => {
  const body = campaignSendBody(draftWith({
    include: 'whales', exclude: 'list_vip', sendWhen: 'clock', sendAt: '2030-01-15T09:30', smartSkip: true,
    utmSource: 'jv', utmCampaign: 'spring', abVariable: 'subject', abSubject: 'Spring is back', abHours: 6,
    smsMessage: 'Spring candles are back.', smsConfirm: true, holdoutOn: true, holdoutPercent: 15
  }), 'ws_1');
  assert.deepEqual(body.blocks, BLOCKS);
  assert.ok(!('body' in body) && !('bodyText' in body) && !('html' in body), `a flattened body rides along: ${Object.keys(body).join(', ')}`);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...body, blocks: undefined })), {
    subject: 'Spring restock',
    previewText: 'The candles are back',
    segmentId: 'whales',
    include: [{ type: 'segment', id: 'whales' }],
    exclude: [{ type: 'list', id: 'list_vip' }],
    sendMode: 'direct',
    when: 'clock',
    sendAt: '2030-01-15T09:30',
    fallbackHour: '',
    explore: false,
    smartSkip: true,
    utm: { source: 'jv', medium: 'email', campaign: 'spring' },
    ab: { variable: 'subject', subjectB: 'Spring is back', bodyB: '', offsetHours: 6 },
    smsMessage: 'Spring candles are back.',
    smsConfirm: 'opted-in',
    holdout: { enabled: true, percent: 15 },
    workspaceId: 'ws_1'
  });
});

test('each schedule and each A/B variable has the shape the route checks', () => {
  const now = campaignSendBody(draftWith({}));
  assert.equal(now.when, 'now');
  assert.equal(now.gradual, undefined);
  assert.deepEqual(now.ab, { variable: 'off' });
  assert.deepEqual(now.holdout, { enabled: false });
  assert.deepEqual(now.exclude, []);
  assert.equal(now.smsConfirm, '');
  const gradual = campaignSendBody(draftWith({ sendWhen: 'gradual', sendAt: '2030-01-15T09:30', gradualPercent: 20, gradualEvery: 'minute' }));
  assert.deepEqual(gradual.gradual, { percent: 20, every: 'minute' });
  const smart = campaignSendBody(draftWith({ sendWhen: 'smart', fallbackHour: '8', explore: true, smartGradual: true, gradualPercent: 25 }));
  assert.equal(smart.when, 'smart');
  assert.deepEqual(smart.gradual, { percent: 25, every: 'hour', wrap: true });
  assert.equal(smart.fallbackHour, 8);
  assert.equal(smart.explore, true);
  // explore and the fallback hour belong to smart sends only.
  assert.equal(campaignSendBody(draftWith({ explore: true, fallbackHour: '8' })).explore, false);
  assert.equal(campaignSendBody(draftWith({ explore: true, fallbackHour: '8' })).fallbackHour, '');
  assert.deepEqual(campaignSendBody(draftWith({ abVariable: 'content', abBody: 'Version B words' })).ab, { variable: 'content', subjectB: '', bodyB: 'Version B words', offsetHours: 4 });
  assert.deepEqual(campaignSendBody(draftWith({ abVariable: 'send_time', abHours: 12 })).ab.offsetHours, 12);
  assert.deepEqual(campaignSendBody(draftWith({ include: 'list_abc' })).include, [{ type: 'list', id: 'list_abc' }]);
});

test('a saved draft opens as it was saved: every setting the composer sends survives the drafts route', () => {
  const draft = draftWith({
    include: 'list_vip', exclude: 'lapsed', sendWhen: 'smart', fallbackHour: '7', explore: true, smartGradual: true, gradualPercent: 30,
    gradualEvery: 'minute', smartSkip: true, utmSource: 'jv', utmCampaign: 'spring', abVariable: 'subject', abSubject: 'B', abHours: 9,
    smsMessage: 'Text', smsConfirm: true, holdoutOn: true, holdoutPercent: 20
  });
  const sent = draftRequestBody({ ...draft, id: 'bd_abc123def' });
  assert.equal(sent.id, 'bd_abc123def');
  assert.ok(!('id' in draftRequestBody(draft)), 'a new draft names an id');
  // What the server keeps (cleanDraftSettings), read back by the composer (draftFromStored).
  const stored = { id: 'bd_abc123def', subject: sent.subject, previewText: sent.previewText, blocks: cleanBlockList(sent.blocks), settings: cleanDraftSettings(sent.settings) };
  const opened = draftFromStored(stored);
  assert.deepEqual(opened.settings, draft.settings, 'a setting the composer sends is not kept by the drafts route under the same key');
  assert.deepEqual(campaignSendBody(opened).ab, campaignSendBody(draft).ab);
  assert.deepEqual(campaignSendBody(opened).gradual, campaignSendBody(draft).gradual);
  assert.deepEqual(Object.keys(cleanDraftSettings({})).sort(), Object.keys(DEFAULT_BROADCAST_SETTINGS).sort(), 'the server and the composer name different settings');
});

// ---- The real campaign/send handler, on a bare app ----

const CONTACTS = [
  { email: 'whale@example.test', name: 'Wendy Whale', totalSpent: 900, ordersCount: 6, acceptsMarketing: true, status: 'subscribed', userId: 'u1', lists: [] },
  { email: 'whale-on-list@example.test', name: 'Lee List', totalSpent: 800, ordersCount: 5, acceptsMarketing: true, status: 'subscribed', userId: 'u1', lists: ['list_vip'] },
  { email: 'small@example.test', name: 'Sam Small', totalSpent: 20, ordersCount: 1, acceptsMarketing: true, status: 'subscribed', userId: 'u1', lists: [] }
];

// `extra` replaces parts of the context: the fix round's 'now' sends need a hub and a delivery stand-in.
async function serveSend(extra = {}) {
  const saved = [];
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Wave 8: the handlers it hands back (processDueCampaigns, the scheduled sender) are kept for the tick test.
  const handlers = setupEmailRoutes(app, {
    requireUser: (req, _res, next) => { req.user = { uid: 'u1' }; next(); },
    hubReady: false,
    cleanBlocks: (input, fallback) => cleanBlockList(Array.isArray(input) ? input : fallback),
    cleanHoldout,
    smartSendConflict,
    cleanFallbackHour: () => ({ ok: true, hour: null }),
    cleanPicks,
    resolveAudience,
    FOLLOW_UP_NOTE,
    userProgramBag: () => ({ timezone: '', lists: [{ id: 'list_vip', name: 'VIP list' }], segments: [], suppressions: [], profiles: {} }),
    contactsForUser: () => CONTACTS,
    loadOrders: () => [],
    isDemoRecord: () => false,
    loadBehaviorBag: () => ({ events: [] }),
    loadEvents: () => [],
    predictionAccount: () => null,
    overlayPrediction: (profile) => profile,
    loadCampaigns: () => saved.slice(),
    saveCampaigns: (rows) => { saved.splice(0, saved.length, ...rows); },
    messageStatsFor: () => ({ sent: null, delivered: null, opened: null, clicked: null, unsubscribed: null, revenue: null, prefetchOpens: null }),
    holdoutReport: () => null,
    ...extra
  });
  const listener = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const post = async (body) => {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}/api/email/campaign/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });
    return { status: res.status, body: await res.json() };
  };
  // Any method and path on the same app (Wave 8: DELETE /api/email/campaigns/:id during a send).
  const call = async (method, route) => {
    const res = await fetch(`http://127.0.0.1:${listener.address().port}${route}`, { method, signal: AbortSignal.timeout(5000) });
    return { status: res.status, body: await res.json() };
  };
  return { saved, post, call, handlers, close: () => new Promise((r) => { listener.closeAllConnections(); listener.close(r); }) };
}

test('campaign/send stores what the composer sends: its blocks, the clock time, A/B, holdout, the picks and the text', async () => {
  const s = await serveSend();
  try {
    const res = await s.post(campaignSendBody(draftWith({
      include: 'whales', exclude: 'list_vip', sendWhen: 'clock', sendAt: '2030-01-15T09:30', abVariable: 'subject', abSubject: 'Spring is back',
      holdoutOn: true, holdoutPercent: 15, smsMessage: 'Spring candles are back.', smsConfirm: true, smartSkip: true, utmSource: 'jv', utmCampaign: 'spring'
    })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, 'Scheduled. Nothing was sent.');
    assert.equal(s.saved.length, 1);
    const row = s.saved[0];
    assert.deepEqual(row.blocks.map((b) => [b.kind, b.text || b.label || b.url]), [
      ['heading', 'Back in stock'], ['text', 'Hi {{first_name}}, the spring candles are back.'], ['image', 'https://images.example.test/spring.png'], ['button', 'Shop the spring candles']
    ]);
    assert.equal(row.body, '', 'the campaign stored a flattened body beside the blocks');
    assert.equal(row.subject, 'Spring restock');
    assert.equal(row.previewText, 'The candles are back');
    assert.equal(row.when, 'clock');
    assert.equal(row.sendAt, '2030-01-15T09:30:00.000Z', 'with no account timezone the route reads the clock time as UTC');
    assert.equal(row.status, 'scheduled');
    assert.deepEqual(row.ab, { variable: 'subject', subjectB: 'Spring is back', bodyB: '', offsetHours: 0, winner: '' });
    assert.deepEqual(row.holdout, { enabled: true, percent: 15 });
    assert.deepEqual(row.include, [{ type: 'segment', id: 'whales' }]);
    assert.deepEqual(row.exclude, [{ type: 'list', id: 'list_vip' }]);
    // The two big spenders are the whales; the one on the VIP list is left out.
    assert.deepEqual(row.audience.map((p) => p.email), ['whale@example.test']);
    assert.deepEqual(row.sms, { message: 'Spring candles are back.', confirm: true });
    assert.equal(row.smartSkip, true);
  } finally {
    await s.close();
  }
});

test('campaign/send takes a gradual schedule from the composer, and refuses a send with no blocks and no body', async () => {
  const s = await serveSend();
  try {
    const res = await s.post(campaignSendBody(draftWith({ include: 'all', sendWhen: 'gradual', sendAt: '2030-02-01T08:00', gradualPercent: 20, gradualEvery: 'minute' })));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(s.saved[0].gradual, { percent: 20, every: 'minute' });
    assert.equal(s.saved[0].when, 'gradual');
    // The control: the same email with its blocks taken off is not an email at all to this route.
    const bare = campaignSendBody({ ...draftWith({ sendWhen: 'clock', sendAt: '2030-01-15T09:30' }), blocks: [] });
    const refused = await s.post(bare);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Subject and email body are required.');
  } finally {
    await s.close();
  }
});

// ---- What the composer says ----

const OPTIONS = audienceOptions(
  [{ id: 'all', name: 'All marketing', count: 7, definition: 'Accepts marketing.' }, { id: 'whales', name: 'VIP Whales (Platinum)', count: 3 }, { id: 'odd', name: 'Not counted', count: null }],
  [{ id: 'list_vip', name: 'VIP list', count: 2 }]
);

test('Send asks first, naming the count the server reported, and never a count nobody measured', () => {
  const now = confirmSendText(draftWith({ include: 'whales' }), OPTIONS);
  assert.match(now, /^Send "Spring restock" now to VIP Whales \(Platinum\)\?/);
  assert.match(now, /The server counted 3 contacts in this segment who accept marketing\./);
  const list = confirmSendText(draftWith({ include: 'list_vip', sendWhen: 'clock', sendAt: '2030-01-15T09:30' }), OPTIONS);
  assert.match(list, /^Schedule "Spring restock" for VIP list on 2030-01-15 at 09:30/);
  assert.match(list, /The server counted 2 contacts on this list\. Anyone who cannot receive marketing is skipped\./);
  const left = confirmSendText(draftWith({ include: 'all', exclude: 'whales', holdoutOn: true, holdoutPercent: 10, smsMessage: 'Hi' }), OPTIONS);
  assert.match(left, /7 contacts/);
  assert.match(left, /Anyone in VIP Whales \(Platinum\) is left out, so it may reach fewer\./);
  assert.match(left, /10% are held out and get nothing\./);
  assert.match(left, /The text message goes out with it\./);
  // A segment the server gave no number for, and one it did not list at all, say so and print no number.
  for (const include of ['odd', 'gone_segment']) {
    const unknown = confirmSendText(draftWith({ include }), OPTIONS);
    assert.match(unknown, /The server has not reported how many people are in /);
    assert.doesNotMatch(unknown, /\d/, `an unmeasured count was printed: ${unknown}`);
  }
  // With nothing loaded at all (the reads failed), still no number.
  assert.doesNotMatch(confirmSendText(draftWith({ include: 'all' }), []), /\d/);
  for (const text of [now, list, left]) assert.doesNotMatch(text, /—| – /);
});

test('a test goes to one address, as the html the preview route rendered from the blocks', () => {
  assert.deepEqual(testSendBody(' me@example.test ', 'Spring restock', '<p>Back in stock</p>'), {
    recipients: [{ email: 'me@example.test', name: 'Test' }], subject: 'Test: Spring restock', html: '<p>Back in stock</p>'
  });
});

test('the check result reads the hub lint answer, whatever shape its rows take', () => {
  assert.equal(lintSummary({ success: true, score: 92, warnings: ['No plain text part.'], checks: [{ id: 'a', label: 'Unsubscribe link', level: 'pass' }, { id: 'b', label: 'Link', level: 'warn', detail: 'One link has no https.' }] }), 'Check score 92. No plain text part. One link has no https.');
  assert.equal(lintSummary({ success: false, error: 'Email sending is not connected.' }), 'Email sending is not connected.');
  assert.equal(lintSummary({ success: true }), 'The check found nothing to fix.');
});

test('an empty new broadcast has nothing to lose; a subject or a word does', () => {
  assert.equal(draftHasContent(emptyBroadcastDraft()), false);
  assert.equal(draftHasContent({ ...emptyBroadcastDraft(), subject: 'x' }), true);
  assert.equal(draftHasContent({ ...emptyBroadcastDraft(), blocks: [{ id: 'i', kind: 'image', url: '' }] }), true);
});

// ---- Source: the composer is the builder, with the library, and the modal is gone ----

test('source: the composer mounts the builder with the saved-block library, sends through campaignSendBody, and the modal and Builder tab are gone', () => {
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  const suite = read('./src/components/campaign/HubEmailSuite.tsx');
  assert.match(composer, /<BlockEditor blocks=\{draft\.blocks\} onChange=\{\(blocks\) => patch\(\{ blocks \}\)\} library=\{library\} onSaveCopy=\{saveCopy\} onDeleteCopy=\{deleteCopy\} \/>/);
  assert.doesNotMatch(composer, /library=\{\[\]\}/);
  assert.match(composer, /fetch\('\/api\/email\/suite'/, 'the library is not read the way the old Builder read it');
  assert.match(composer, /body: JSON\.stringify\(campaignSendBody\(draft, workspaceId, requestId\)\)/);
  assert.match(composer, /window\.confirm\(confirmSendText\(draft, options\)\)/, 'Send does not ask first');
  assert.doesNotMatch(composer, /count: 0/, 'an unmeasured 0 is offered as a count');
  // The retired textarea modal and the Builder tab's component.
  assert.doesNotMatch(suite, /showBroadcastModal|handleSendBroadcast|Create Segmented Campaign Broadcast|<EmailPrograms/);
  assert.match(suite, /\{activeTab === 'builder' && \(\s*<BroadcastComposer/);
  assert.ok(!fs.existsSync(new URL('./src/components/campaign/EmailPrograms.tsx', import.meta.url)), 'EmailPrograms.tsx is back');
});

test('source: every id the composer puts on an element is used once, so each label names its own control', () => {
  // A section heading and the select under it once shared id="bc-when", so the "When to send" label
  // named the heading and the select had no label at all (found by the browser check).
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  const ids = [...composer.matchAll(/<[a-z][a-z0-9]*\b[^>]*?\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 9, `only ${ids.length} element ids were found, so this checks too little`);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(twice, [], `ids used twice: ${twice.join(', ')}`);
  // Each Pick labels a select with the same id.
  for (const m of composer.matchAll(/<Pick id="([^"]+)"/g)) assert.ok(ids.includes(m[1]), `the label for ${m[1]} names no element`);
});

test('source: no text in the composer is under 11px, and no copy in it or its rules has an em dash or a spaced en dash', () => {
  for (const name of ['./src/components/campaign/BroadcastComposer.tsx', './src/lib/broadcastComposer.ts', './server/routes/broadcastDraftRoutes.mjs']) {
    const src = read(name);
    const small = [...src.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((px) => px < 11);
    assert.deepEqual(small, [], `${name} sets text under 11px`);
    const dashed = src.split('\n').map((line, i) => `${i + 1}: ${line.trim()}`).filter((line) => /—| – /.test(line));
    assert.deepEqual(dashed, [], `${name} has a dash`);
  }
});

// ---- Fix round: an empty email, a time that passed, a repeat, the test's sender, the copy ----

test('an email whose blocks hold nothing is refused by the composer and by campaign/send, with or without a text beside it', async () => {
  // The composer's rule (blocksHaveContent) and the route's (emailHasContent) are one answer on the same blocks.
  const cases = {
    blank: emptyBroadcastDraft().blocks,
    spaces: [{ id: 'a', kind: 'text', text: '   ' }],
    dividerAndSpacer: [{ id: 'd', kind: 'divider' }, { id: 's', kind: 'spacer' }],
    imageWithNoAddress: [{ id: 'i', kind: 'image', url: '  ' }],
    emptyColumns: [{ id: 'c', kind: 'columns', columns: [{ blocks: [{ kind: 'text', text: '' }] }, { blocks: [] }] }],
    emptySplit: [{ id: 'p', kind: 'split', cells: [{ kind: 'text', text: '' }, { kind: 'image', url: '' }] }],
    junk: [null, 3, 'text', {}],
    notAList: 'Back in stock',
    words: [{ id: 'b_heading', kind: 'heading', text: '' }, { id: 't', kind: 'text', text: 'Back in stock' }],
    html: [{ id: 'h', kind: 'html', text: '<p>Hi</p>' }],
    image: [{ id: 'i', kind: 'image', url: 'https://images.example.test/a.png' }],
    button: [{ id: 'b', kind: 'button', label: 'Shop', url: 'https://shop.example.test' }],
    filledColumn: [{ id: 'c', kind: 'columns', columns: [{ blocks: [] }, { blocks: [{ kind: 'heading', text: 'Hello' }] }] }],
    filledSplit: [{ id: 'p', kind: 'split', cells: [{ kind: 'text', text: '' }, { kind: 'image', url: 'https://images.example.test/b.png' }] }]
  };
  const answers = Object.entries(cases).map(([name, blocks]) => {
    assert.equal(blocksHaveContent(blocks), emailHasContent(blocks), `${name}: the composer and campaign/send disagree`);
    return blocksHaveContent(blocks);
  });
  assert.ok(answers.includes(true) && answers.includes(false), 'the matrix holds only one answer, so it checks too little');
  assert.equal(blocksHaveContent(emptyBroadcastDraft().blocks), false, 'a new broadcast counts as written');
  const s = await serveSend();
  try {
    const blank = (smsMessage) => campaignSendBody({
      ...emptyBroadcastDraft(), subject: 'Spring restock', settings: { ...DEFAULT_BROADCAST_SETTINGS, sendWhen: 'clock', sendAt: '2030-01-15T09:30', smsMessage }
    });
    for (const smsMessage of ['', 'Spring candles are back.']) {
      const res = await s.post(blank(smsMessage));
      assert.equal(res.status, 400, `with text "${smsMessage}": ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { success: false, error: CAMPAIGN_EMAIL_EMPTY });
    }
    assert.equal(s.saved.length, 0, 'an empty email was saved as a broadcast');
    // The control: one word in the same email and it is scheduled.
    const written = await s.post({ ...blank(''), blocks: [{ id: 'b_text', kind: 'text', text: 'Back in stock', level: 0 }] });
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.equal(s.saved.length, 1);
  } finally {
    await s.close();
  }
});

test('a clock or gradual time that has passed is refused and never sent at once; the minutes just begun still go', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const gradual = { percent: 10, every: 'hour' };
  assert.equal(SCHEDULE_PAST_GRACE_MS, 5 * 60 * 1000);
  for (const when of ['clock', 'gradual']) {
    assert.deepEqual(campaignSchedule({ when, sendAt: '2026-10-08T11:54', timezone: 'UTC', gradual, now }), { ok: false, error: SCHEDULE_PASSED }, `${when} six minutes ago`);
    assert.deepEqual(campaignSchedule({ when, sendAt: '2020-01-15T09:30', timezone: 'UTC', gradual, now }), { ok: false, error: SCHEDULE_PASSED }, `${when} years ago`);
    const begun = campaignSchedule({ when, sendAt: '2026-10-08T11:56', timezone: 'UTC', gradual, now });
    assert.equal(begun.ok, true, `${when} four minutes ago`);
    assert.equal(begun.waiting, false);
    assert.equal(campaignSchedule({ when, sendAt: '2026-10-08T12:30', timezone: 'UTC', gradual, now }).waiting, true, `${when} later today`);
  }
  // Read in the account's zone: 12:00 UTC is 08:00 in New York that day, so 07:50 there has passed and 08:30 has not.
  assert.deepEqual(campaignSchedule({ when: 'clock', sendAt: '2026-10-08T07:50', timezone: 'America/New_York', now }), { ok: false, error: SCHEDULE_PASSED });
  assert.equal(campaignSchedule({ when: 'clock', sendAt: '2026-10-08T08:30', timezone: 'America/New_York', now }).waiting, true);
  assert.doesNotMatch(SCHEDULE_PASSED, /—| – /);
  const s = await serveSend();
  try {
    for (const sendWhen of ['clock', 'gradual']) {
      const res = await s.post(campaignSendBody(draftWith({ include: 'whales', sendWhen, sendAt: '2020-01-15T09:30' })));
      assert.equal(res.status, 400, `${sendWhen}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { success: false, error: SCHEDULE_PASSED });
    }
    assert.equal(s.saved.length, 0);
  } finally {
    await s.close();
  }
});

test('one send per requestId: a repeat is refused once the first is saved, ids differ, and no id keeps the old behaviour', async () => {
  const s = await serveSend();
  try {
    const body = campaignSendBody(draftWith({ include: 'whales', sendWhen: 'clock', sendAt: '2030-01-15T09:30' }), undefined, 'req-check-1');
    assert.equal(body.requestId, 'req-check-1');
    assert.ok(!('requestId' in campaignSendBody(draftWith({}))), 'a body with no id names one');
    assert.equal((await s.post(body)).status, 200);
    const again = await s.post(body);
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.deepEqual(again.body, { success: false, duplicate: true, error: CAMPAIGN_DUPLICATE });
    assert.equal(s.saved.length, 1);
    assert.equal(s.saved[0].requestId, 'req-check-1');
    assert.equal((await s.post({ ...body, requestId: 'req-check-2' })).status, 200);
    const { requestId, ...noId } = body;
    assert.equal((await s.post(noId)).status, 200);
    assert.equal((await s.post(noId)).status, 200);
    assert.equal(s.saved.length, 4);
    const ids = s.saved.map((row) => row.id);
    assert.equal(new Set(ids).size, 4, `ids repeat: ${ids.join(', ')}`);
    for (const id of ids) {
      // camp_ + the time in base 36 + six hex characters, so two sends in one millisecond still differ.
      assert.match(id, /^camp_[a-z0-9]+[0-9a-f]{6}$/, id);
      assert.ok(Math.abs(parseInt(id.slice(5, -6), 36) - Date.now()) < 60000, `${id} has no random tail after its time`);
    }
  } finally {
    await s.close();
  }
});

test('two copies of one send at once: the second is refused while the first is still going out, and after it is saved', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const delivered = [];
  const s = await serveSend({
    hubReady: true,
    smartSkipReason,
    applyUtm,
    fillMailTokens,
    SMART_EMAIL_HOURS,
    SMART_SMS_HOURS,
    workspaceCache: {},
    rememberRedirectsBatch: () => {},
    recordEvent: () => {},
    composeForSend: async () => ({ html: '<p>Back in stock</p>', text: 'Back in stock', vars: {} }),
    deliverLetter: async (letter) => {
      delivered.push(letter.to);
      await gate;
      return { ok: true, status: 'sent', messageId: 'msg_check' };
    }
  });
  try {
    const body = campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip' }), undefined, 'req-burst');
    const first = s.post(body);
    for (let i = 0; i < 200 && !delivered.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(delivered, ['whale@example.test'], 'the first send never reached delivery, so this proves nothing');
    const second = await s.post(body);
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.deepEqual(second.body, { success: false, duplicate: true, error: CAMPAIGN_DUPLICATE });
    release();
    const done = await first;
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.message, 'Sent to 1 recipients.');
    assert.deepEqual(delivered, ['whale@example.test'], 'the audience was mailed twice');
    assert.equal(s.saved.length, 1);
    assert.equal((await s.post(body)).status, 409, 'once saved, the same send is not refused');
  } finally {
    release();
    await s.close();
  }
});

// Wave 8 (adversarial review): a send's record is saved after its whole audience was mailed, and the list
// it was saved into used to be the one read BEFORE those awaits. A second send saved in between was
// erased, and with it the requestId that refuses the second send's retry.
const nowSendContext = (delivered, gateFirst) => {
  let calls = 0;
  return {
    hubReady: true,
    smartSkipReason,
    applyUtm,
    fillMailTokens,
    SMART_EMAIL_HOURS,
    SMART_SMS_HOURS,
    workspaceCache: {},
    rememberRedirectsBatch: () => {},
    recordEvent: () => {},
    composeForSend: async () => ({ html: '<p>Back in stock</p>', text: 'Back in stock', vars: {} }),
    deliverLetter: async (letter) => {
      delivered.push(letter.to);
      calls += 1;
      if (calls === 1) await gateFirst;
      return { ok: true, status: 'sent', messageId: `msg_${calls}` };
    }
  };
};
const waitFor = async (ready, what) => {
  for (let i = 0; i < 300 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(ready(), `${what} never happened, so this proves nothing`);
};

test('a send saved while another is still mailing is kept, and its retry is still refused', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const delivered = [];
  const s = await serveSend(nowSendContext(delivered, gate));
  try {
    const a = campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip' }), undefined, 'req-held-a');
    const b = campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip' }), undefined, 'req-quick-b');
    const first = s.post(a);
    await waitFor(() => delivered.length === 1, 'the first send reaching delivery');
    const second = await s.post(b);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.deepEqual(s.saved.map((row) => row.requestId), ['req-quick-b']);
    release();
    assert.equal((await first).status, 200);
    assert.deepEqual(s.saved.map((row) => row.requestId).sort(), ['req-held-a', 'req-quick-b'], 'the first send, saved last, erased the second send\'s record');
    const retry = await s.post(b);
    assert.equal(retry.status, 409, `a retry of the second send was ${retry.status}: ${JSON.stringify(retry.body)}`);
    assert.deepEqual(retry.body, { success: false, duplicate: true, error: CAMPAIGN_DUPLICATE });
    assert.equal(delivered.length, 2, `${delivered.length} emails went out for two sends to one person each`);
  } finally {
    release();
    await s.close();
  }
});

test('the scheduled sender saves only the broadcasts it sent: a broadcast deleted and one sent meanwhile stay as they were left', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const delivered = [];
  const s = await serveSend(nowSendContext(delivered, gate));
  try {
    const due = await s.post(campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip', sendWhen: 'clock', sendAt: '2030-01-15T09:30' }), undefined, 'req-due'));
    assert.equal(due.status, 200, JSON.stringify(due.body));
    const later = await s.post(campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip', sendWhen: 'clock', sendAt: '2030-01-16T09:30' }), undefined, 'req-later'));
    assert.equal(later.status, 200, JSON.stringify(later.body));
    const dueRow = s.saved.find((row) => row.requestId === 'req-due');
    const laterId = s.saved.find((row) => row.requestId === 'req-later').id;
    // Its time has come: the sender picks it up on its next pass.
    dueRow.sendAt = '2020-01-01T00:00:00.000Z';
    const tick = s.handlers.processDueCampaigns('u1');
    await waitFor(() => delivered.length === 1, 'the scheduled send reaching delivery');
    const removed = await s.call('DELETE', `/api/email/campaigns/${laterId}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    const meanwhile = await s.post(campaignSendBody(draftWith({ include: 'whales', exclude: 'list_vip' }), undefined, 'req-meanwhile'));
    assert.equal(meanwhile.status, 200, JSON.stringify(meanwhile.body));
    release();
    assert.equal((await tick).sent, 1);
    const ids = s.saved.map((row) => row.requestId).sort();
    assert.deepEqual(ids, ['req-due', 'req-meanwhile'], `after the scheduled pass the list holds ${JSON.stringify(ids)}`);
    assert.equal(s.saved.find((row) => row.requestId === 'req-due').status, 'sent');
  } finally {
    release();
    await s.close();
  }
});

test('a requestId the route cannot keep whole is refused, never cut or coerced into another send\'s id', async () => {
  const s = await serveSend();
  try {
    const body = campaignSendBody(draftWith({ include: 'whales', sendWhen: 'clock', sendAt: '2030-01-15T09:30' }));
    const long = 'x'.repeat(64);
    assert.equal((await s.post({ ...body, requestId: long })).status, 200, 'a 64-character id is kept');
    for (const requestId of [`${long}A`, `${long}B`, { a: 1 }, ['x'], 12345, 'has space', 'ümlaut']) {
      const res = await s.post({ ...body, requestId });
      assert.equal(res.status, 400, `${JSON.stringify(requestId)} answered ${res.status}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { success: false, error: CAMPAIGN_REQUEST_ID });
    }
    assert.equal(s.saved.length, 1, 'a refused id stored a broadcast');
    assert.equal((await s.post({ ...body, requestId: crypto.randomUUID() })).status, 200, 'the composer\'s own id (a UUID) is refused');
    assert.equal((await s.post({ ...body, requestId: '' })).status, 200, 'an empty id is no id');
  } finally {
    await s.close();
  }
});

test("a test send names the caller's own account to the hub, so it leaves from the sender the broadcast uses, never one the body names", async () => {
  // server.mjs's own /api/email/send handler, sliced out of the file and mounted on a bare app.
  const src = read('./server.mjs');
  const head = "app.post('/api/email/send', requireUser, async (req, res) => {";
  const start = src.indexOf(head);
  assert.ok(start >= 0, 'server.mjs no longer defines POST /api/email/send as this test reads it');
  const route = src.slice(start, src.indexOf('\n});\n', start) + 4);
  const handed = [];
  const hub = { email: { send: async (body) => { handed.push(body); return { success: true }; } } };
  const app = express();
  app.use(express.json());
  new Function('app', 'requireUser', 'hub', 'hubReady', route)(app, (req, _res, next) => { req.user = { uid: 'u1' }; next(); }, hub, true);
  const listener = await new Promise((resolve) => { const l = app.listen(0, '127.0.0.1', () => resolve(l)); });
  try {
    const post = async (body) => (await fetch(`http://127.0.0.1:${listener.address().port}/api/email/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
    })).json();
    const test = testSendBody('me@example.test', 'Spring restock', '<p>Back in stock</p>');
    assert.equal((await post(test)).success, true);
    assert.equal((await post({ ...test, accountId: 'u2' })).success, true);
    assert.equal(handed.length, 2);
    for (const body of handed) {
      assert.equal(body.accountId, 'u1', `the hub was asked to send as ${JSON.stringify(body.accountId)}`);
      assert.deepEqual(body.recipients, test.recipients);
      assert.equal(body.subject, test.subject);
      assert.equal(body.html, test.html);
    }
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test('a preview is keyed on what it was made from, so an edit to the email shows it is stale and a change of audience does not', () => {
  const draft = draftWith({});
  assert.equal(previewKey(draft), previewKey({ ...draft, settings: { ...draft.settings, include: 'whales', sendWhen: 'clock' } }));
  assert.notEqual(previewKey(draft), previewKey({ ...draft, subject: 'Another subject' }));
  assert.notEqual(previewKey(draft), previewKey({ ...draft, previewText: 'Other preview text' }));
  assert.notEqual(previewKey(draft), previewKey({ ...draft, blocks: [...BLOCKS.slice(0, 1), { ...BLOCKS[1], text: 'Edited.' }, ...BLOCKS.slice(2)] }));
});

test('source: Send checks the blocks and the audience before it asks, carries the requestId, busy buttons dim, and the preview speaks beside its button', () => {
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  const send = composer.slice(composer.indexOf('  const send = async () => {'), composer.indexOf('  const startWritten = '));
  const asks = send.indexOf('window.confirm(');
  assert.ok(asks > 0, 'Send no longer asks');
  for (const guard of ['if (!blocksHaveContent(draft.blocks)) {', "if (audience.state !== 'loaded') {"]) {
    const at = send.indexOf(guard);
    assert.ok(at > 0 && at < asks, `Send does not check ${guard} before it asks`);
  }
  // The id is dropped only on an answer that is not a duplicate; an unanswered send keeps it for the retry.
  assert.ok(send.indexOf('if (!sent.answered) {') < send.indexOf('if (!sent.data?.duplicate) pendingSend.current = null;'), 'the requestId is dropped before an unanswered send is reported');
  const busyButtons = [...composer.matchAll(/<button[^>]*aria-disabled=\{busy !== ''\}[^>]*>/g)].map((m) => m[0]);
  assert.equal(busyButtons.length, 5, `${busyButtons.length} buttons wait on busy`);
  for (const button of busyButtons) assert.match(button, /\.\.\.dim \}\}/, `a busy button does not dim: ${button.slice(0, 90)}`);
  const preview = composer.slice(composer.indexOf('  const showPreview = '), composer.indexOf('  const runCheck = '));
  assert.doesNotMatch(preview, /setStatus\(/, 'a preview failure is said in the sticky bar, far from the Preview button');
  assert.match(composer, /<p role="status" style=\{said\}>\{previewSaid\}<\/p>/);
});

test('source: the written drafts the composer starts from never call an email a note (D2)', () => {
  const composer = read('./src/components/campaign/BroadcastComposer.tsx');
  const drafts = composer.match(/setBroadcast(Subject|PreviewText|Body)\([^;]*\);/g) || [];
  assert.ok(drafts.length >= 20, `only ${drafts.length} written-draft lines were found, so this checks too little`);
  assert.deepEqual(drafts.filter((line) => /\bnotes?\b/i.test(line)), []);
});
