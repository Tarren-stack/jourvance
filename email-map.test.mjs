import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributionTouches, channelOf, cleanHoldout, emailTouchFields, enrollChoice,
  enrollmentCount, holdoutReport, inHoldout, linkedFlowIds, orderBelongsTo,
  splitHoldout, visitorFromLink
} from './email-map.mjs';

test('holdout stays off until a percent from 1 to 90 is saved', () => {
  assert.equal(cleanHoldout({}).holdout, null);
  assert.equal(cleanHoldout({ enabled: false, percent: 10 }).holdout, null);
  assert.equal(cleanHoldout({ enabled: true, percent: 0 }).ok, false);
  assert.equal(cleanHoldout({ enabled: true, percent: 100 }).ok, false);
  assert.deepEqual(cleanHoldout({ enabled: true, percent: 10 }).holdout, { enabled: true, percent: 10 });
});

test('a held-out person is left out of the send, and the same person stays held', () => {
  const spec = { enabled: true, percent: 40 };
  const people = Array.from({ length: 80 }, (_, i) => ({ email: `p${i}@example.com`, name: 'P' }));
  const split = splitHoldout(people, spec, 'camp_phase8', '2026-09-25T12:00:00.000Z');
  assert.ok(split.held.length > 0);
  assert.ok(split.send.length > 0);
  assert.equal(split.send.length + split.held.length, people.length);
  const heldEmail = split.held[0].email;
  assert.equal(split.send.some((person) => person.email === heldEmail), false);
  assert.equal(inHoldout(`camp_phase8:${heldEmail}`, 40), true);
  const again = splitHoldout([{ email: heldEmail }], spec, 'camp_phase8', '2026-09-25T12:00:00.000Z');
  assert.equal(again.send.length, 0);
  assert.equal(again.held.length, 1);
  const off = splitHoldout([{ email: heldEmail }], { enabled: false, percent: 40 }, 'camp_phase8', '2026-09-25T12:00:00.000Z');
  assert.equal(off.send.length, 1);
  assert.equal(off.held.length, 0);
});

test('holdout revenue is later orders per person and names no winner', () => {
  const at = '2026-09-25T12:00:00.000Z';
  const report = holdoutReport(
    [{ email: 'sent@example.com', at }],
    [{ email: 'held@example.com', at }],
    [
      { customerEmail: 'sent@example.com', createdAt: '2026-09-20T00:00:00.000Z', totalPrice: 99 },
      { customerEmail: 'sent@example.com', createdAt: '2026-09-26T00:00:00.000Z', totalPrice: 40, refunds: [{ amount: 10 }] },
      { customerEmail: 'held@example.com', createdAt: '2026-09-26T00:00:00.000Z', totalPrice: 10 },
      { customerEmail: 'other@example.com', createdAt: '2026-09-26T00:00:00.000Z', totalPrice: 80 }
    ]
  );
  assert.equal(report.sent.sample, 1);
  assert.equal(report.sent.revenue, 30);
  assert.equal(report.sent.perPerson, 30);
  assert.equal(report.held.sample, 1);
  assert.equal(report.held.perPerson, 10);
  assert.equal(Object.hasOwn(report, 'winner'), false);
  const empty = holdoutReport([], [], []);
  assert.equal(empty.sent.perPerson, null);
  assert.equal(empty.held.sample, 0);
});

test('a map lead, a page form, and the flow trigger share one run', () => {
  const flow = { id: 'flow_welcome', enabled: true, reentry: 'once' };
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  const first = enrollChoice({ flow, rows: [], email: 'a@example.com', now, sender: 'jourvance' });
  assert.equal(first.enroll, true);
  const rows = [{ flowId: 'flow_welcome', email: 'a@example.com', status: 'active', visitorId: '' }];
  const again = enrollChoice({ flow, rows, email: 'a@example.com', now, sender: 'jourvance' });
  assert.equal(again.enroll, false);
  assert.equal(again.reason, 'reentry');
  assert.equal(again.stitch, true);
  const kept = enrollChoice({
    flow,
    rows: [{ flowId: 'flow_welcome', email: 'a@example.com', status: 'active', visitorId: 'jv_abc123' }],
    email: 'a@example.com',
    now,
    sender: 'jourvance'
  });
  assert.equal(kept.stitch, false);
  assert.equal(enrollChoice({ flow, rows: [], email: 'a@example.com', now, sender: 'klaviyo' }).reason, 'klaviyo');
  assert.equal(enrollChoice({ flow: { ...flow, enabled: false }, rows: [], email: 'a@example.com', now, sender: 'jourvance' }).reason, 'off');
  assert.equal(enrollChoice({ flow: { ...flow, sunset: true, enabled: true }, rows: [], email: 'a@example.com', now, sender: 'jourvance' }).reason, 'sunset');
  const nodes = [
    { type: 'follow-up-sequence', data: { jourvanceFlowId: 'flow_welcome' } },
    { type: 'follow-up-sequence', data: { jourvanceFlowId: 'flow_welcome' } },
    { type: 'follow-up-sequence', data: { jourvanceFlowId: 'not a flow' } },
    { type: 'landing-page', data: { jourvanceFlowId: 'flow_other' } }
  ];
  assert.deepEqual(linkedFlowIds(nodes, 'lead_capture'), ['flow_welcome']);
  assert.deepEqual(linkedFlowIds(nodes, 'exit_intent'), ['flow_welcome']);
  assert.deepEqual(linkedFlowIds(nodes, 'order_paid'), []);
  assert.equal(enrollmentCount(rows, 'flow_welcome'), 1);
  assert.equal(enrollmentCount([], 'flow_welcome'), null);
  assert.equal(enrollmentCount([{ flowId: 'flow_welcome', status: 'handed_to_klaviyo' }], 'flow_welcome'), null);
});

test('email send and email click are touches, and a discount code stays off the channel', () => {
  assert.equal(channelOf({ discountCode: 'SAVE10' }), 'direct');
  assert.equal(channelOf({ fbclid: 'abc', discountCode: 'SAVE10' }), 'meta');
  assert.equal(channelOf({ utm_source: 'email', type: 'email_sent' }), 'email');
  assert.equal(channelOf({ type: 'email_clicked' }), 'direct');
  assert.deepEqual(emailTouchFields('email_clicked'), { utm_source: 'email', utm_medium: 'email' });
  assert.equal(channelOf({ ...emailTouchFields('email_clicked'), type: 'email_clicked' }), 'email');
  const order = { customerEmail: 'a@example.com', visitorId: 'jv_abc123', discountCode: 'SAVE10' };
  const touches = attributionTouches([
    { type: 'page_view', email: 'a@example.com', at: '2026-09-25T10:00:00.000Z', utm_source: 'meta' },
    { type: 'email_sent', email: 'a@example.com', at: '2026-09-25T11:00:00.000Z', utm_source: 'email', utm_medium: 'broadcast' },
    { type: 'email_clicked', visitorId: 'jv_abc123', at: '2026-09-25T12:00:00.000Z', utm_source: 'email' },
    { type: 'sms_clicked', email: 'a@example.com', at: '2026-09-25T12:30:00.000Z' },
    { type: 'email_sent', email: 'other@example.com', at: '2026-09-25T12:00:00.000Z' }
  ], order);
  assert.deepEqual(touches.map((event) => event.type), ['page_view', 'email_sent', 'email_clicked']);
  assert.equal(orderBelongsTo({ userId: 'other', discountCode: 'SAVE10' }, 'me', ''), false);
  assert.equal(orderBelongsTo({ userId: 'me', discountCode: 'SAVE10' }, 'me', ''), true);
  assert.equal(orderBelongsTo({ attributedSlug: 'wave', discountCode: 'SAVE10' }, 'me', 'other'), false);
  assert.equal(orderBelongsTo({ attributedSlug: 'wave' }, 'me', 'me'), true);
});

test('a link visitor id is kept when it is already a visitor id', () => {
  assert.equal(visitorFromLink('jv_abc123', 'jv_other1'), 'jv_abc123');
  assert.equal(visitorFromLink('no', 'jv_stored1'), 'jv_stored1');
  assert.equal(visitorFromLink('', ''), '');
});
