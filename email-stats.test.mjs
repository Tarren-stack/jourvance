import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moneyText, STAT_UNAVAILABLE, statText, withNote } from './src/lib/emailStats.ts';

// T16: Email Studio's flow map (where a sequence step's Email Studio button lands) and the rest
// of the suite printed an em dash for every unmeasured number and joined notes with one.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const map = read('./src/components/campaign/EmailFlowMap.tsx');
const suite = read('./src/components/campaign/HubEmailSuite.tsx');
// D9, Wave 4: the starter row that prints a sequence's revenue lives in the Flows list now.
const list = read('./src/components/campaign/EmailFlowsList.tsx');
const DASH = /—| – /;

test('an unmeasured number reads Unavailable, never a dash or 0', () => {
  assert.equal(STAT_UNAVAILABLE, 'Unavailable');
  for (const missing of [null, undefined, Number.NaN, Infinity]) {
    assert.equal(statText(missing), 'Unavailable');
    assert.equal(moneyText(missing), 'Unavailable');
  }
  // A measured zero is a real zero.
  assert.equal(statText(0), '0');
  assert.equal(moneyText(0), '$0.00');
  assert.equal(statText(1234, (n) => n.toLocaleString('en-US')), '1,234');
  assert.equal(moneyText(12.5), '$12.50');
});

test('a note joins its name with a middle dot, and a blank note leaves no separator', () => {
  assert.equal(withNote('Big spenders', 'Total spent over 100'), 'Big spenders · Total spent over 100');
  assert.equal(withNote('Blank one (0 contacts)', ''), 'Blank one (0 contacts)');
  assert.equal(withNote('Blank one (0 contacts)', undefined), 'Blank one (0 contacts)');
  assert.equal(withNote('Name', '  '), 'Name');
  assert.doesNotMatch(withNote('a', 'b'), DASH);
});

test('neither the flow map nor the email suite carries an em dash or a spaced en dash', () => {
  for (const [name, src] of [['EmailFlowMap.tsx', map], ['HubEmailSuite.tsx', suite]]) {
    const lines = src.split('\n').map((line, i) => `${i + 1}: ${line.trim()}`).filter((line) => DASH.test(line));
    assert.deepEqual(lines, [], `${name} still has a dash`);
  }
});

test('the flow map and the suite print their stats through the shared helper', () => {
  // The flow map's stats line: every figure the server may leave null.
  for (const field of ['current.enrolled', 'current.stats.sent', 'current.stats.delivered', 'current.stats.opened', 'current.stats.clicked', 'current.stats.unsubscribed']) {
    assert.ok(map.includes(`statText(${field})`), `flow map prints ${field} through statText`);
  }
  assert.ok(map.includes('moneyText(current.stats.revenue)'));
  assert.match(map, /withNote\([^\n]*path\.note\)/);
  // The starter row's revenue, in the file the starter row lives in. At least one match, so a moved
  // row is a failure here and never a needle that checks nothing.
  const revenue = list.split('statText(seq.attributedSales').length - 1;
  assert.ok(revenue >= 1, `EmailFlowsList.tsx prints a starter flow's revenue through statText ${revenue} times`);
  assert.ok(!/\$\{?seq\.attributedSales/.test(list), 'a starter row prints its revenue without statText');
  // The suite: the broadcast row, the holdout line and the analytics tiles.
  for (const needle of ['statText(b.sent', 'statText(b.opened)', 'statText(b.clicked)', 'moneyText(b.revenue)', 'statText(b.delivered)', 'statText(b.unsubscribed)', 'moneyText(b.holdoutReport.sent.perPerson)', 'moneyText(b.holdoutReport.held.perPerson)', 'statText(value,']) {
    assert.ok(suite.includes(needle), `suite uses ${needle}`);
  }
  assert.match(suite, /withNote\(`\$\{seg\.name\} \(\$\{seg\.count\} contacts\)`, seg\.definition \|\| seg\.description\)/);
  // No hand-rolled null check left that prints a placeholder string of its own.
  for (const [name, src] of [['EmailFlowMap.tsx', map], ['HubEmailSuite.tsx', suite]]) {
    assert.doesNotMatch(src, /== null \? '[^']{0,3}' :/, `${name} has a hand-rolled placeholder`);
  }
});
