import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGraph, buildEnrollment, cleanFlow, dateOccurrenceDue, delayUntil, firstStepId,
  flowShapeError, isPredictionKey, matchPath, peekGraph, pickVariation, publicHttpsUrl,
  reentryBlocks, validateFlow
} from './email-flows.mjs';
import { flowFromKlaviyo } from './klaviyo.mjs';

function blocks(input) {
  const source = Array.isArray(input) ? input : [];
  return source.map((block, index) => ({
    id: String(block?.id || `b${index}`),
    kind: block?.kind || 'text',
    text: String(block?.text || '')
  }));
}

function flow(extra) {
  return cleanFlow({
    id: 'flow_test',
    name: 'Test',
    enabled: false,
    trigger: 'manual',
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'Hello', blocks: [{ id: 'b', kind: 'text', text: 'Hi' }] }
    ],
    edges: [{ id: 'e1', source: 'n_start', target: 'n_mail', branch: '' }],
    ...extra
  }, { cleanBlocks: blocks });
}

test('holdout on a flow email stays off outside 1 to 90 percent', () => {
  const on = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'Hello', holdout: { enabled: true, percent: 10 }, blocks: [{ id: 'b', kind: 'text', text: 'Hi' }] }
    ]
  });
  assert.deepEqual(on.nodes.find((node) => node.type === 'email').holdout, { enabled: true, percent: 10 });
  const off = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'Hello', holdout: { enabled: true, percent: 200 }, blocks: [{ id: 'b', kind: 'text', text: 'Hi' }] }
    ]
  });
  assert.equal(off.nodes.find((node) => node.type === 'email').holdout, undefined);
  const enr = buildEnrollment({ flow: on, contact: { email: 'a@example.com' }, now: Date.parse('2026-09-25T12:00:00.000Z') });
  enr.nodeId = 'n_mail';
  enr.waitUntil = '2026-09-25T12:00:00.000Z';
  const peek = peekGraph(enr, Date.parse('2026-09-25T12:00:00.000Z'), {});
  assert.equal(peek.kind, 'email');
  assert.deepEqual(peek.holdout, { enabled: true, percent: 10 });
});

test('old welcome graph still validates and starts at the email', () => {
  const saved = flow();
  assert.equal(validateFlow(saved).ok, true);
  assert.equal(firstStepId(saved), 'n_mail');
  assert.equal(saved.reentry, 'once');
  assert.equal(saved.nodes.find((node) => node.type === 'email').status, 'live');
});

test('an old order check keeps yes and no', () => {
  const saved = cleanFlow({
    id: 'flow_old',
    trigger: 'checkout_abandonment',
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_wait', type: 'delay', delayHours: 2 },
      { id: 'n_check', type: 'condition', field: 'ordered_since_enroll' },
      { id: 'n_yes', type: 'email', subject: 'Yes' },
      { id: 'n_no', type: 'email', subject: 'No' }
    ],
    edges: [
      { id: 'e1', source: 'n_start', target: 'n_wait', branch: '' },
      { id: 'e2', source: 'n_wait', target: 'n_check', branch: '' },
      { id: 'e3', source: 'n_check', target: 'n_yes', branch: 'yes' },
      { id: 'e4', source: 'n_check', target: 'n_no', branch: 'no' }
    ]
  }, { cleanBlocks: blocks });
  assert.equal(saved.nodes.find((node) => node.id === 'n_wait').delayMinutes, 120);
  assert.equal(validateFlow(saved).ok, true);
  assert.equal(saved.exitOnOrder, true);
  const check = saved.nodes.find((node) => node.type === 'condition');
  assert.equal(check.paths[0].clauses[0].event, 'order');
  assert.equal(check.paths[1].else, true);
});

test('weekday clock delay lands on the next Monday at 09:00 UTC', () => {
  const friday = Date.parse('2026-09-25T15:00:00.000Z');
  const until = delayUntil({
    mode: 'clock', delayMinutes: 0, clockHour: 9, clockMinute: 0, weekdays: [1], timezone: 'account'
  }, friday, 'UTC', '');
  assert.equal(new Date(until).toISOString(), '2026-09-28T09:00:00.000Z');
});

test('minutes are kept on a duration delay', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  const until = delayUntil({ mode: 'duration', delayMinutes: 90 }, now, 'UTC', '');
  assert.equal(until - now, 90 * 60000);
});

test('a profile timezone is used only when it is a real zone', () => {
  const now = Date.parse('2026-09-24T15:00:00.000Z');
  const until = delayUntil({
    mode: 'clock', delayMinutes: 0, clockHour: 9, clockMinute: 0, weekdays: [], timezone: 'profile'
  }, now, 'UTC', 'America/New_York');
  assert.equal(new Date(until).toISOString(), '2026-09-25T13:00:00.000Z');
});

test('three paths skip an empty path and fail closed when the field is missing', () => {
  const node = {
    id: 'check',
    paths: [
      { id: 'gold', else: false, clauses: [{ kind: 'profile', field: 'tier', op: 'eq', value: 'gold' }] },
      { id: 'empty', else: false, clauses: [] },
      { id: 'silver', else: false, clauses: [{ kind: 'profile', field: 'tier', op: 'eq', value: 'silver' }] },
      { id: 'else', else: true, clauses: [] }
    ]
  };
  assert.equal(matchPath(node, { properties: { tier: 'silver' } }).id, 'silver');
  assert.equal(matchPath(node, { properties: { tier: 'gold' } }).id, 'gold');
  assert.equal(matchPath(node, { properties: {} }).id, 'else');
  assert.equal(matchPath(node, { properties: { tier: 'gold' }, }).id, 'gold');
  const neq = { id: 'n', paths: [{ id: 'a', clauses: [{ kind: 'profile', field: 'tier', op: 'neq', value: 'gold' }] }, { id: 'else', else: true, clauses: [] }] };
  assert.equal(matchPath(neq, { properties: {} }).id, 'else');
});

test('rejoin is allowed and a cycle is rejected', () => {
  const rejoined = cleanFlow({
    id: 'flow_join',
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_check', type: 'condition' },
      { id: 'n_yes', type: 'email', subject: 'Yes' },
      { id: 'n_no', type: 'email', subject: 'No' },
      { id: 'n_shared', type: 'email', subject: 'Shared' }
    ],
    edges: [
      { source: 'n_start', target: 'n_check', branch: '' },
      { source: 'n_check', target: 'n_yes', branch: 'yes' },
      { source: 'n_check', target: 'n_no', branch: 'no' },
      { source: 'n_yes', target: 'n_shared', branch: '' },
      { source: 'n_no', target: 'n_shared', branch: '' }
    ]
  }, { cleanBlocks: blocks });
  assert.equal(validateFlow(rejoined).ok, true);
  const loop = cleanFlow({
    id: 'flow_loop',
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_a', type: 'email', subject: 'A' },
      { id: 'n_b', type: 'email', subject: 'B' }
    ],
    edges: [
      { source: 'n_start', target: 'n_a', branch: '' },
      { source: 'n_a', target: 'n_b', branch: '' },
      { source: 'n_b', target: 'n_a', branch: '' }
    ]
  }, { cleanBlocks: blocks });
  assert.equal(validateFlow(loop).ok, false);
  assert.match(validateFlow(loop).error, /loops/);
});

test('A/B assignment stays on the same variation', () => {
  const node = { id: 'ab', variations: [{ id: 'v1', weight: 1 }, { id: 'v2', weight: 1 }, { id: 'v3', weight: 1 }] };
  assert.equal(pickVariation('enr_same', node).id, pickVariation('enr_same', node).id);
});

test('draft and smart send skip, and a transactional message does not', () => {
  const saved = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'Hello', status: 'draft', smartSkip: true }
    ]
  });
  const enr = buildEnrollment({ flow: saved, contact: { email: 'a@example.com' }, now: 1_000 });
  assert.equal(enr.program, undefined);
  assert.equal(peekGraph(enr, 1_000, {}).skip, 'draft');
  saved.nodes[1].status = 'live';
  enr.graph = { nodes: saved.nodes, edges: saved.edges };
  assert.equal(peekGraph(enr, 1_000, { recentEmail: true }).skip, 'smart');
  saved.nodes[1].transactional = true;
  enr.graph = { nodes: structuredClone(saved.nodes), edges: saved.edges };
  assert.equal(peekGraph(enr, 1_000, { recentEmail: true }).kind, 'email');
});

test('a delay holds once, then a later tick moves on', () => {
  const saved = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_wait', type: 'delay', delayMinutes: 30 },
      { id: 'n_mail', type: 'email', subject: 'After' }
    ],
    edges: [
      { source: 'n_start', target: 'n_wait', branch: '' },
      { source: 'n_wait', target: 'n_mail', branch: '' }
    ]
  });
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  const enr = buildEnrollment({ flow: saved, contact: { email: 'a@example.com' }, now });
  const hold = peekGraph(enr, now, { accountTimezone: 'UTC' });
  assert.equal(hold.kind, 'hold');
  applyGraph(enr, hold, now);
  assert.equal(peekGraph(enr, now + 60000, {}).ready, false);
  const next = peekGraph(enr, now + 30 * 60000, {});
  assert.equal(next.kind, 'advance');
  applyGraph(enr, next, now + 30 * 60000);
  assert.equal(enr.nodeId, 'n_mail');
});

test('prediction fields are refused and a missing date does not enroll', () => {
  assert.equal(isPredictionKey('expectedNextOrder'), true);
  assert.equal(isPredictionKey('expectedNextOrderAt'), true);
  assert.equal(isPredictionKey('tier'), false);
  const saved = flow({ trigger: 'date_property', dateField: 'expectedNextOrder' });
  assert.equal(saved.dateField, '');
  assert.match(saved.notes.join(' '), /predicted/i);
  const predicted = flow({ trigger: 'date_property', dateField: 'expectedNextOrderAt' });
  assert.equal(predicted.dateField, 'expectedNextOrderAt');
  assert.match(predicted.name, /predicted/i);
  const birthday = flow({ trigger: 'date_property', dateField: 'birthday', dateRepeat: 'yearly' });
  const morning = Date.parse('2026-09-24T08:30:00.000Z');
  assert.equal(dateOccurrenceDue(birthday, '', morning, 'UTC').due, false);
  assert.equal(dateOccurrenceDue(birthday, '1990-09-24', morning, 'UTC').due, true);
  assert.equal(dateOccurrenceDue(predicted, '2026-09-24', morning, 'UTC').due, true);
  const profile = flow({ nodes: [
    { id: 'n_start', type: 'trigger' },
    { id: 'n_set', type: 'profile', key: 'predictedValue', value: '9' }
  ], edges: [{ id: 'e1', source: 'n_start', target: 'n_set', branch: '' }] });
  assert.equal(validateFlow(profile).ok, false);
  const smart = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'Hello', sendTime: 'smart', fallbackHour: 0, blocks: [{ id: 'b', kind: 'text', text: 'Hi' }] }
    ],
    edges: [{ id: 'e1', source: 'n_start', target: 'n_mail', branch: '' }]
  });
  const mail = smart.nodes.find((node) => node.type === 'email');
  assert.equal(mail.sendTime, 'smart');
  assert.equal(mail.fallbackHour, 0);
  const enr = buildEnrollment({ flow: smart, contact: { email: 'a@example.com' }, now: morning });
  const held = peekGraph(enr, morning, { smartSend: { rule: 'merchant', hour: 15, sendAt: new Date(morning + 3600000).toISOString() } });
  assert.equal(held.kind, 'hold');
  const ready = peekGraph(enr, morning, { smartSend: { rule: 'immediate', hour: null, sendAt: new Date(morning).toISOString() } });
  assert.equal(ready.kind, 'email');
  const text = flow({
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_sms', type: 'sms', message: 'Hello', transactional: false, smartSkip: true }
    ],
    edges: [{ id: 'e1', source: 'n_start', target: 'n_sms', branch: '' }]
  });
  const sms = buildEnrollment({ flow: text, contact: { email: 'a@example.com' }, now: morning });
  const quiet = peekGraph(sms, morning, { quietOpenAt: morning + 3600000, recentSms: true });
  assert.equal(quiet.kind, 'hold');
  assert.equal(quiet.history.detail, 'waiting');
  applyGraph(sms, quiet, morning);
  const after = peekGraph(sms, morning + 3600000, { quietOpenAt: morning + 3600000, recentSms: true });
  assert.equal(after.skip, 'smart');
});

test('re-entry blocks a second active run and allows whenever after completion', () => {
  const saved = flow({ reentry: 'once' });
  const rows = [{ flowId: saved.id, email: 'a@example.com', status: 'completed', enrolledAt: '2026-01-01T00:00:00.000Z' }];
  assert.equal(reentryBlocks(saved, rows, 'a@example.com', Date.parse('2026-09-24T00:00:00.000Z')), true);
  saved.reentry = 'whenever';
  assert.equal(reentryBlocks(saved, rows, 'a@example.com', Date.parse('2026-09-24T00:00:00.000Z')), false);
  rows.push({ flowId: saved.id, email: 'a@example.com', status: 'active', enrolledAt: '2026-09-24T00:00:00.000Z' });
  assert.equal(reentryBlocks(saved, rows, 'a@example.com', Date.parse('2026-09-24T00:00:00.000Z')), true);
});

test('webhook addresses have to be public https', () => {
  assert.equal(publicHttpsUrl('http://example.com/hook').ok, false);
  assert.equal(publicHttpsUrl('https://localhost/hook').ok, false);
  assert.equal(publicHttpsUrl('https://10.1.1.1/hook').ok, false);
  assert.equal(publicHttpsUrl('https://example.com/hook').ok, true);
  assert.equal(flowShapeError({ nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}` })) }), 'A flow can have 60 steps.');
});

test('importer keeps both split paths, minutes, weekdays, A/B, profile, and webhook', () => {
  const mapped = flowFromKlaviyo({
    id: 'KLAVIYO1',
    attributes: {
      name: 'Welcome',
      trigger_type: 'Added to List',
      definition: {
        entry_action_id: 'delay1',
        triggers: [{ type: 'list', id: 'LIST1' }],
        actions: [
          {
            id: 'delay1', type: 'time-delay',
            data: { unit: 'minutes', value: 90, delay_until_weekdays: ['monday'], delay_until_time: '09:00', timezone: 'profile' },
            links: { next: 'split1' }
          },
          {
            id: 'split1', type: 'conditional-split',
            data: { profile_filter: { condition_groups: [{ conditions: [{ type: 'profile-property', property: 'tier', filter: { operator: 'equals', value: 'gold' } }] }] } },
            links: { next_if_true: 'mailYes', next_if_false: 'mailNo' }
          },
          { id: 'mailYes', type: 'send-email', data: { message: { subject_line: 'Gold', preview_text: 'For gold' } }, links: { next: 'shared' } },
          { id: 'mailNo', type: 'send-email', data: { message: { subject_line: 'Everyone', preview_text: 'Hello' } }, links: { next: 'shared' } },
          {
            id: 'shared', type: 'ab-test',
            data: { variations: [{ id: 'v1', allocation: 0.5, message: { subject_line: 'Subject A' } }, { id: 'v2', allocation: 0.5, message: { subject_line: 'Subject B' } }] },
            links: { next: 'prop1' }
          },
          {
            id: 'prop1', type: 'update-profile',
            data: { profile_operations: [{ operator: 'update', property_type: 'string', property_key: 'tier_seen', property_value: 'yes' }] },
            links: { next: 'hook1' }
          },
          { id: 'hook1', type: 'send-webhook', data: { url: 'https://example.com/hook', body: '{"email":"{{ email }}"}' }, links: {} }
        ]
      }
    }
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.flow.trigger, 'list_added');
  const delay = mapped.flow.nodes.find((node) => node.type === 'delay');
  assert.equal(delay.delayMinutes, 90);
  assert.deepEqual(delay.weekdays, [1]);
  assert.equal(delay.mode, 'clock');
  const subjects = mapped.flow.nodes.filter((node) => node.type === 'email').map((node) => node.subject);
  assert.ok(subjects.includes('Gold') && subjects.includes('Everyone'));
  const split = mapped.flow.nodes.find((node) => node.type === 'condition');
  const splitEdges = mapped.flow.edges.filter((edge) => edge.source === split.id);
  assert.equal(splitEdges.length, 2);
  assert.equal(mapped.flow.nodes.some((node) => node.type === 'ab' && node.variations.length === 2), true);
  assert.equal(mapped.flow.nodes.some((node) => node.type === 'profile' && node.key === 'tier_seen'), true);
  assert.equal(mapped.flow.nodes.some((node) => node.type === 'webhook' && node.url.startsWith('https://example.com')), true);
  const shared = mapped.flow.nodes.find((node) => node.type === 'ab');
  assert.equal(mapped.flow.edges.filter((edge) => edge.target === shared.id).length, 2);
  assert.match(mapped.note, /does not pick a winner/);
  assert.doesNotMatch(mapped.note, /left out/);
});
