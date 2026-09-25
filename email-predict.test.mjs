import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHURN_NOTE, METHOD, addRefund, assignSmartSend, churnFromRate, commitPredictions, historicSpend,
  missingHistory, netOrderValue, overlayPrediction, predictStore, predictionLine, smartSendConflict, smartSendReport, storeReadiness
} from './email-predict.mjs';
import { flowFromKlaviyo } from './klaviyo.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-09-25T12:00:00.000Z');

function order(email, at, total, refunds) {
  return { customerEmail: email, createdAt: new Date(at).toISOString(), totalPrice: total, refunds: refunds || [] };
}

function readyOrders() {
  const cutoff = NOW - 90 * DAY;
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const email = `repeat${i}@example.com`;
    rows.push(order(email, cutoff - 40 * DAY, 40));
    rows.push(order(email, cutoff - 10 * DAY, 40));
    if (i < 10) rows.push(order(email, cutoff + 30 * DAY, 40));
  }
  for (let i = 0; i < 20; i++) {
    const email = `recent${i}@example.com`;
    const refunds = i === 0 ? [{ id: 'r1', amount: 10 }] : i === 1 ? [{ id: 'r2' }] : [];
    rows.push(order(email, NOW - 5 * DAY, 40, refunds));
  }
  return rows;
}

test('a store under 50 orders has no prediction row', () => {
  const few = [order('a@example.com', NOW - 10 * DAY, 20), order('a@example.com', NOW - 2 * DAY, 20)];
  const result = predictStore(few, NOW);
  assert.equal(result.ready, false);
  assert.equal(result.rows, null);
  assert.match(missingHistory(result), /at least 50 orders/);
  const committed = commitPredictions({ other: { method: METHOD } }, 'dev', few, NOW);
  assert.equal(committed.store.dev, undefined);
  assert.equal(committed.store.other.method, METHOD);
  const file = '/tmp/jourvance-phase6-predictions.json';
  fs.writeFileSync(file, JSON.stringify(committed.store));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.dev, undefined);
  fs.unlinkSync(file);
});

test('a ready store writes a date, a rate only for a bucket of 20, and a lower value after a refund', () => {
  const result = predictStore(readyOrders(), NOW);
  assert.equal(result.ready, true);
  assert.equal(result.method, METHOD);
  assert.equal(result.rates.under_half, 0.5);
  assert.equal(result.rates.half_to_one, undefined);
  assert.equal(result.rates.one_to_two, undefined);
  assert.equal(result.rates.over_two, undefined);
  const recent = result.rows['recent0@example.com'];
  const untouched = result.rows['recent1@example.com'];
  const late = result.rows['repeat10@example.com'];
  assert.equal(recent.historicValue, 30);
  assert.equal(untouched.historicValue, 40);
  assert.ok(recent.predictedValue < untouched.predictedValue);
  assert.equal(recent.predictedValue, 15);
  assert.equal(recent.churn, 'medium');
  assert.equal(recent.churnNote, CHURN_NOTE);
  assert.equal(recent.method, METHOD);
  assert.ok(recent.computedAt);
  assert.equal(recent.predictedValue365, undefined);
  assert.ok(late.expectedNextOrderAt);
  assert.ok(Date.parse(late.expectedNextOrderAt) < NOW);
  assert.ok(late.daysOverdue > 0);
  assert.equal(late.predictedValue, undefined);
  const line = predictionLine(recent);
  assert.match(line, /Historic spend \$30\.00/);
  assert.match(line, /sample/);
  assert.match(line, /predicted value \$15\.00/);
  assert.equal(predictionLine({ orderCount: 0 }), '');
  const stored = commitPredictions({}, 'shop', readyOrders(), NOW).store.shop;
  assert.equal(stored.method, METHOD);
  assert.equal(stored.rows['recent0@example.com'].historicValue, 30);
});

test('a refund with no amount does not change historic value, and 365 days adds a figure', () => {
  assert.equal(netOrderValue({ totalPrice: 40, refunds: [{ id: 'x' }] }), 40);
  assert.equal(historicSpend([order('a@example.com', NOW, 40, [{ id: 'x' }])]).historicValue, 40);
  const added = addRefund({ totalPrice: 40, refunds: [] }, { id: 'x', amount: null });
  assert.equal(added.order.refunds[0].amount, undefined);
  const again = addRefund(added.order, { id: 'x', amount: 5 });
  assert.equal(again.added, false);
  const rows = [];
  for (let i = 0; i < 20; i++) {
    const email = `year${i}@example.com`;
    rows.push(order(email, NOW - 400 * DAY, 10));
    rows.push(order(email, NOW - 380 * DAY, 10));
  }
  for (let i = 0; i < 10; i++) rows.push(order(`extra${i}@example.com`, NOW - 2 * DAY, 10));
  const young = predictStore(readyOrders(), NOW);
  assert.equal(young.rows['recent0@example.com'].predictedValue365, undefined);
  const older = predictStore(rows, NOW);
  assert.equal(older.ready, true);
  assert.ok(older.historyDays >= 365);
  assert.equal(older.rows['year0@example.com'].predictedValue365, 182.5);
});

test('churn labels follow this store’s repurchase rate', () => {
  assert.equal(churnFromRate(0.32), 'high');
  assert.equal(churnFromRate(0.33), 'medium');
  assert.equal(churnFromRate(0.66), 'medium');
  assert.equal(churnFromRate(0.67), 'low');
  assert.equal(churnFromRate(null), '');
});

test('a typed prediction is ignored until a computed row exists', () => {
  const blocked = overlayPrediction({ predictedValue: 99, birthday: '1990-01-01', churn: 'high' }, null);
  assert.equal(blocked.predictedValue, undefined);
  assert.equal(blocked.churn, undefined);
  assert.equal(blocked.birthday, '1990-01-01');
  const open = overlayPrediction(blocked, { computedAt: '2026-09-25T00:00:00.000Z', predictedValue: 12, expectedNextOrderAt: '2026-10-01T00:00:00.000Z', churn: 'low' });
  assert.equal(open.predictedValue, 12);
  assert.equal(open.churn, 'low');
  assert.equal(open.birthday, '1990-01-01');
});

test('smart send uses the recipient, the store, the merchant hour, or the next send', () => {
  const noon = NOW;
  const opensAt = (hour) => Array.from({ length: 5 }, (_, i) => ({ type: 'email_opened', at: new Date(Date.UTC(2026, 8, 20 + i, hour, 5)).toISOString() }));
  const own = assignSmartSend({
    people: [{ email: 'own@example.com', events: opensAt(9), timezone: '', phone: '+15555550100', ip: '1.2.3.4' }],
    events: [],
    now: noon,
    accountTimezone: 'UTC',
    fallbackHour: 15
  });
  assert.equal(own.assignments[0].rule, 'recipient');
  assert.equal(own.assignments[0].hour, 9);
  assert.equal(own.assignments[0].sampleSize, 5);
  const zoned = assignSmartSend({
    people: [{ email: 'ny@example.com', timezone: 'America/New_York', events: opensAt(13) }],
    events: [],
    now: noon,
    accountTimezone: 'UTC'
  });
  assert.equal(zoned.assignments[0].hour, 9);
  const storeEvents = Array.from({ length: 200 }, (_, i) => ({ type: 'email_clicked', email: `s${i}@example.com`, at: new Date(Date.UTC(2026, 8, 20, 11, i % 50)).toISOString() }));
  const store = assignSmartSend({
    people: [{ email: 'quiet@example.com', events: opensAt(9).slice(0, 2) }],
    events: storeEvents,
    now: noon,
    accountTimezone: 'UTC',
    fallbackHour: 15
  });
  assert.equal(store.assignments[0].rule, 'store');
  assert.equal(store.assignments[0].hour, 11);
  assert.equal(store.assignments[0].sampleSize, 200);
  const merchant = assignSmartSend({
    people: [{ email: 'set@example.com' }],
    events: storeEvents.slice(0, 10),
    now: noon,
    accountTimezone: 'UTC',
    fallbackHour: 15
  });
  assert.equal(merchant.assignments[0].rule, 'merchant');
  assert.equal(merchant.assignments[0].hour, 15);
  assert.equal(merchant.assignments[0].sampleSize, null);
  const immediate = assignSmartSend({
    people: [{ email: 'now@example.com' }],
    events: [],
    now: noon,
    accountTimezone: 'UTC',
    fallbackHour: null
  });
  assert.equal(immediate.assignments[0].rule, 'immediate');
  assert.equal(immediate.assignments[0].hour, null);
  assert.equal(Date.parse(immediate.assignments[0].sendAt), noon);
  const report = smartSendReport([
    ...Array.from({ length: 42 }, () => ({ rule: 'recipient', hour: 9, sampleSize: 5 })),
    ...Array.from({ length: 310 }, () => ({ rule: 'store', hour: 11, sampleSize: 860 })),
    ...Array.from({ length: 15 }, () => ({ rule: 'merchant', hour: 15, sampleSize: null }))
  ]);
  assert.equal(report, '42 people at 9:00 from their own opens. 310 people at 11:00 from 860 store opens in 90 days. 15 people at the hour you set.');
  assert.doesNotMatch(report, /optimal/i);
  assert.doesNotMatch(immediate.report, /optimal/i);
});

test('explore is 10 percent and smart send does not combine with a send-time test', () => {
  const people = Array.from({ length: 10 }, (_, i) => ({ email: `p${i}@example.com` }));
  const plan = assignSmartSend({ people, events: [], now: NOW, accountTimezone: 'UTC', fallbackHour: 10, explore: true, seed: 'camp' });
  const exploring = plan.assignments.filter((row) => row.rule === 'explore');
  assert.equal(exploring.length, 1);
  assert.ok(exploring[0].hour >= 9 && exploring[0].hour <= 17);
  assert.equal(plan.assignments.filter((row) => row.rule === 'merchant').length, 9);
  assert.equal(assignSmartSend({ people: people.slice(0, 1), events: [], now: NOW, explore: false, fallbackHour: 10 }).assignments[0].rule, 'merchant');
  assert.equal(smartSendConflict('smart', { variable: 'send_time' }), true);
  assert.equal(smartSendConflict('smart', { variable: 'subject' }), false);
  assert.equal(smartSendConflict('clock', { variable: 'send_time' }), false);
});

test('a predictive split names the missing history until this store is ready', () => {
  const flow = {
    id: 'KL1',
    attributes: {
      name: 'Predict',
      trigger_type: 'Added to List',
      definition: {
        entry_action_id: 'split1',
        triggers: [{ type: 'list' }],
        actions: [
          {
            id: 'split1', type: 'conditional-split',
            data: { profile_filter: { condition_groups: [{ conditions: [{ type: 'profile-predictive-analytics', property: 'predicted_clv', filter: { operator: 'greater-than', value: 10 } }] }] } },
            links: { next_if_true: 'mail1', next_if_false: 'mail2' }
          },
          { id: 'mail1', type: 'send-email', data: { message: { subject_line: 'High' } }, links: {} },
          { id: 'mail2', type: 'send-email', data: { message: { subject_line: 'Else' } }, links: {} }
        ]
      }
    }
  };
  const thin = storeReadiness([order('a@example.com', NOW, 10)], NOW);
  const waiting = flowFromKlaviyo(flow, { prediction: { ready: false, missing: missingHistory(thin) } });
  assert.match(waiting.note, /at least 50 orders/);
  assert.match(waiting.note, /everyone else/i);
  const split = waiting.flow.nodes.find((node) => node.type === 'condition');
  assert.equal(split.paths[0].clauses[0].kind, 'prediction');
  assert.match(split.paths[0].label, /predicted/i);
  const ready = flowFromKlaviyo(flow, { prediction: { ready: true, missing: '' } });
  const translated = ready.flow.nodes.find((node) => node.type === 'condition');
  assert.equal(translated.paths[0].clauses[0].field, 'predictedValue');
  assert.match(translated.paths[0].label, /predicted/i);
  assert.match(ready.flow.name, /predicted/i);
});
