import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOLLOW_UP_NOTE, abSide, applyListChange, applyUtm, campaignSchedule, campaignUnsent,
  cleanAb, cleanForm, cleanPicks, cleanSegment, dueRecipients, formGate, inBuiltIn,
  nextSegmentState, readConfirm, resolveAudience, segmentMatches, signConfirm, smartSkipReason,
  spinSlice
} from './audience.mjs';

const eligible = { totalSpent: 120, ordersCount: 2, tags: ['Exit-Intent-Rescue'] };

test('built-in segments skip suppressed people and keep the spend rule', () => {
  assert.equal(inBuiltIn('vip', eligible, true), true);
  assert.equal(inBuiltIn('vip', eligible, false), false);
  assert.equal(inBuiltIn('leads', eligible, true), false);
  assert.equal(inBuiltIn('repeat', { ordersCount: 2 }, true), true);
  assert.equal(inBuiltIn('exit_rescue', eligible, true), true);
  assert.equal(inBuiltIn('buyers', { ordersCount: 0 }, true), false);
});

test('segment groups honor and and or, and stop at 100 checks', () => {
  const segment = cleanSegment({
    id: 'seg_testor',
    name: 'Or',
    join: 'any',
    groups: [
      { join: 'all', clauses: [{ kind: 'profile', field: 'email', op: 'eq', value: 'a@example.com' }] },
      { join: 'any', clauses: [{ kind: 'profile', field: 'ordersCount', op: 'gt', value: 1 }] }
    ]
  });
  assert.equal(segment.ok, true);
  const ctx = (email, orders) => ({ contact: {}, eligible: true, profile: { email, ordersCount: orders }, properties: { email, ordersCount: orders }, lists: [], orders: [], events: [] });
  assert.equal(segmentMatches(segment.segment, ctx('b@example.com', 3)), true);
  assert.equal(segmentMatches(segment.segment, ctx('b@example.com', 0)), false);
  const tooMany = cleanSegment({
    id: 'seg_toomany',
    groups: [{ join: 'all', clauses: Array.from({ length: 101 }, () => ({ kind: 'profile', field: 'email', op: 'set' })) }]
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /100/);
});

test('adding to a list fires once and removing does not unsubscribe', () => {
  const first = applyListChange([], 'list_main', 'add');
  assert.equal(first.added, true);
  assert.equal(first.unsubscribed, false);
  const second = applyListChange(first.next, 'list_main', 'add');
  assert.equal(second.added, false);
  const removed = applyListChange(second.next, 'list_main', 'remove');
  assert.equal(removed.removed, true);
  assert.equal(removed.unsubscribed, false);
  assert.deepEqual(removed.next, []);
});

test('a segment entry fires once, and again after they leave and return', () => {
  const quiet = nextSegmentState(null, ['a@example.com'], '2026-01-01T00:00:00.000Z', 'quiet');
  assert.deepEqual(quiet.entered, []);
  const first = nextSegmentState(null, ['a@example.com'], '2026-01-01T00:00:00.000Z', 'enter');
  assert.deepEqual(first.entered, ['a@example.com']);
  const stay = nextSegmentState(first.row, ['a@example.com'], '2026-01-02T00:00:00.000Z', 'enter');
  assert.deepEqual(stay.entered, []);
  const left = nextSegmentState(stay.row, [], '2026-01-03T00:00:00.000Z', 'enter');
  assert.equal(left.row.members['a@example.com'].inside, false);
  const back = nextSegmentState(left.row, ['a@example.com'], '2026-01-04T00:00:00.000Z', 'enter');
  assert.deepEqual(back.entered, ['a@example.com']);
  assert.equal(back.row.members['a@example.com'].enteredAt, '2026-01-04T00:00:00.000Z');
});

test('a clock time in the future stays waiting and an empty include list matches nobody', () => {
  const future = campaignSchedule({ when: 'clock', sendAt: '2030-01-01T09:00', timezone: 'UTC', now: Date.parse('2026-09-25T00:00:00Z') });
  assert.equal(future.ok, true);
  assert.equal(future.waiting, true);
  assert.equal(campaignUnsent({ status: 'scheduled', sendAt: future.sendAt, sentAt: null, sentTo: [] }, Date.parse('2026-09-25T00:00:00Z')), true);
  const now = campaignSchedule({ when: 'now', now: Date.parse('2026-09-25T00:00:00Z') });
  assert.equal(now.waiting, false);
  const gradual = campaignSchedule({ when: 'gradual', sendAt: '2030-01-01T09:00', gradual: { percent: 80, every: 'hour' }, now: Date.parse('2026-09-25T00:00:00Z') });
  assert.equal(gradual.ok, false);
  assert.equal(cleanPicks(Array.from({ length: 16 }, (_, i) => ({ type: 'segment', id: `seg_${i}` }))).ok, false);
  assert.deepEqual(resolveAudience([{ email: 'a@example.com', segments: ['all'], lists: [] }], [], []), []);
  const people = [
    { email: 'a@example.com', segments: ['seg_one'], lists: ['list_a'] },
    { email: 'b@example.com', segments: ['seg_one'], lists: [] }
  ];
  const picked = resolveAudience(people, [{ type: 'segment', id: 'seg_one' }], [{ type: 'list', id: 'list_a' }]);
  assert.deepEqual(picked.map((row) => row.email), ['b@example.com']);
});

test('a campaign A/B uses one variable and a manual winner', () => {
  assert.equal(cleanAb({ variable: 'subject' }).ok, false);
  const ab = cleanAb({ variable: 'send_time', offsetHours: 4 });
  assert.equal(ab.ok, true);
  assert.equal(ab.ab.variable, 'send_time');
  const record = { id: 'camp_1', when: 'clock', sendAt: '2030-01-01T09:00:00.000Z', audience: [{ email: 'a@example.com' }, { email: 'b@example.com' }], sentTo: [], skipped: [], ab: { ...ab.ab, winner: '' } };
  const early = dueRecipients(record, Date.parse('2030-01-01T09:30:00Z'));
  assert.equal(early.due.length + early.waiting.length, 2);
  assert.ok(early.waiting.length >= 0);
  const won = { ...record, ab: { ...record.ab, winner: 'a' } };
  assert.equal(abSide('a@example.com', 'camp_1', won.ab), 'a');
  assert.equal(abSide('b@example.com', 'camp_1', won.ab), 'a');
  const batch = dueRecipients({ ...record, ab: null, when: 'gradual', gradual: { percent: 50, every: 'hour' }, audience: [{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: 'c@example.com' }, { email: 'd@example.com' }] }, Date.parse('2030-01-02T00:00:00Z'));
  assert.equal(batch.due.length, 2);
});

test('UTM is added to links and the unsubscribe link is left alone', () => {
  const html = '<a href="https://shop.example/p">Shop</a><a href="https://jourvance.example/u/abc">Unsubscribe</a>';
  const next = applyUtm(html, { source: 'jourvance', medium: 'email' });
  assert.match(next, /utm_source=jourvance/);
  assert.match(next, /utm_medium=email/);
  assert.match(next, /href="https:\/\/jourvance\.example\/u\/abc"/);
});

test('form rules hide and show, and a new form defaults to double opt-in', () => {
  const form = { delaySeconds: 0, rules: { urlContains: 'jvphase5=1', device: 'any', hideSubmitted: true, scrollPercent: 0, exit: false, showAgainDays: 0 } };
  assert.equal(formGate(form, { url: 'https://x/p?jvphase5=1', mobile: false }).show, true);
  assert.equal(formGate(form, { url: 'https://x/p', mobile: false }).reason, 'url');
  assert.equal(formGate({ ...form, rules: { ...form.rules, device: 'mobile' } }, { url: 'https://x/p?jvphase5=1', mobile: false }).reason, 'device');
  assert.equal(formGate({ ...form, rules: { ...form.rules, device: 'mobile' } }, { url: 'https://x/p?jvphase5=1', mobile: true }).show, true);
  assert.equal(formGate(form, { url: 'https://x/p?jvphase5=1', submitted: true }).reason, 'submitted');
  assert.equal(formGate({ delaySeconds: 10, rules: {} }, { url: 'https://x', elapsed: 1 }).reason, 'delay');
  assert.equal(formGate({ delaySeconds: 0, rules: { scrollPercent: 50 } }, { url: 'https://x', scroll: 10 }).reason, 'scroll');
  assert.equal(formGate({ delaySeconds: 0, rules: { exit: true } }, { url: 'https://x', exit: false }).reason, 'exit');
  assert.equal(formGate({ delaySeconds: 0, rules: { exit: true } }, { url: 'https://x', exit: true }).show, true);
  assert.equal(formGate({ delaySeconds: 0, rules: { showAgainDays: 7 } }, { url: 'https://x', closed: true, closedAt: '2026-09-25T00:00:00Z', now: Date.parse('2026-09-26T00:00:00Z') }).reason, 'again');
  const created = cleanForm({ id: 'form_new', name: 'Popup', type: 'flyout' }, { creating: true });
  assert.equal(created.form.optIn, 'double');
  const legacy = cleanForm({ id: 'form_old', type: 'popup', delaySeconds: 3 });
  assert.equal(legacy.form.optIn, 'single');
  assert.equal(legacy.form.type, 'popup');
});

test('double opt-in confirm tokens fail closed and a slice needs a coupon', () => {
  const token = signConfirm('secret', 'uid_1', 'Ada@Example.com', 'form_new');
  assert.equal(readConfirm('secret', token, Date.now()).email, 'ada@example.com');
  assert.equal(readConfirm('other', token, Date.now()), null);
  assert.equal(readConfirm('secret', token, Date.now() + 8 * 86400000), null);
  const slices = cleanForm({
    id: 'form_spin',
    slices: [{ label: 'Ten', coupon: { name: 'Ten off', discountType: 'percentage', value: 10 } }, { label: 'Empty' }]
  });
  assert.equal(slices.error, 'A slice without a coupon cannot be added.');
  const wheel = cleanForm({
    id: 'form_spin',
    slices: [
      { label: 'Ten', coupon: { name: 'Ten off', discountType: 'percentage', value: 10 } },
      { label: 'Ship', coupon: { name: 'Ship free', discountType: 'free_shipping' } }
    ]
  });
  assert.equal(wheel.form.slices.length, 2);
  const slice = spinSlice(wheel.form, 'ada@example.com');
  assert.ok(slice.coupon.name);
});

test('smart send skip uses the 16-hour and 24-hour windows as flags', () => {
  assert.equal(smartSkipReason('email', { enabled: true, email: true }), 'email');
  assert.equal(smartSkipReason('sms', { enabled: true, email: true, sms: false }), '');
  assert.equal(smartSkipReason('sms', { enabled: true, sms: true }), 'sms');
  assert.equal(smartSkipReason('email', { enabled: false, email: true }), '');
  assert.match(FOLLOW_UP_NOTE, /draft you send/);
  assert.match(FOLLOW_UP_NOTE, /after opens are stored/);
  const smart = campaignSchedule({ when: 'smart', now: Date.parse('2026-09-25T00:00:00Z') });
  assert.equal(smart.ok, true);
  assert.equal(smart.waiting, true);
  assert.equal(smart.gradual, null);
  const wrapped = campaignSchedule({ when: 'smart', gradual: { wrap: true, percent: 80, every: 'hour' }, now: Date.parse('2026-09-25T00:00:00Z') });
  assert.equal(wrapped.ok, false);
  const nowMs = Date.parse('2026-09-25T12:00:00Z');
  const record = {
    id: 'camp_smart',
    when: 'smart',
    audience: [
      { email: 'now@example.com', smart: { sendAt: '2026-09-25T11:00:00.000Z' } },
      { email: 'later@example.com', smart: { sendAt: '2026-09-25T18:00:00.000Z' } },
      { email: 'also@example.com', smart: { sendAt: '2026-09-25T11:30:00.000Z' } },
      { email: 'wait@example.com', smart: { sendAt: '2026-09-26T09:00:00.000Z' } }
    ],
    sentTo: [],
    skipped: [],
    gradual: { percent: 50, every: 'hour' }
  };
  const batch = dueRecipients(record, nowMs);
  assert.equal(batch.due.length, 2);
  assert.ok(batch.due.every((person) => person.email !== 'later@example.com'));
});
