// Training off real user data, the pure half (server/assistantTraining.mjs, ASK_JOURVANCE_PLAN.md
// W2.S S3 and S3b): what-worked.md counts with the funnel stats route's ownership predicates over 90
// days, holds facts only and no customer's name, email or phone, names what it could not read, says
// when the event cap is inside the window, fits 16,000 characters and keeps its sha across a day that
// changed no figure; the app patterns keep a group only with 5 accounts and 100 visits and nothing
// from an input but numbers and two fixed word lists reaches the file.
// This file carries no em dash and no en dash; the test builds them with String.fromCharCode.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileWhatWorked,
  compileAppPatterns,
  activeAccounts,
  journeyGoal,
  journeyPlatform,
  biggestDrop,
  eventsPartial,
  trainingWindow,
  WHAT_WORKED_MAX_CHARS,
  PATTERN_MIN_USERS,
  PATTERN_MIN_ACCOUNT_VISITS,
  TRAINING_JOURNEYS_MAX
} from './server/assistantTraining.mjs';
import { performance } from 'node:perf_hooks';
import { EVENTS_KEPT } from './server/assistantContext.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const at = iso(NOW - 5 * DAY);

const JOURNEYS = [
  {
    id: 'j1',
    userId: 'u1',
    name: 'Spring Glaze Sale',
    goal: 'leads',
    nodes: [
      { id: 'a', type: 'ad-source', data: { platform: 'meta' } },
      { id: 'b', type: 'landing-page', data: { slug: 'spring-glaze' } },
      { id: 'c', type: 'lead-form', data: {} }
    ],
    updatedAt: iso(NOW - DAY)
  },
  {
    id: 'j2',
    userId: 'u1',
    name: 'Kiln Kit Shop',
    goal: 'Turn visitors into buyers',
    nodes: [
      { id: 'a', type: 'ad-source', data: { platform: 'google' } },
      { id: 'b', type: 'landing-page', data: { slug: 'kiln-kit', checkoutMode: 'direct' } },
      { id: 'c', type: 'upsell', data: {} }
    ],
    updatedAt: iso(NOW - 2 * DAY)
  },
  { id: 'j9', userId: 'u2', name: 'Their Secret Funnel', goal: 'sales', nodes: [], updatedAt: iso(NOW) }
];
const PAGES = {
  'spring-glaze': { slug: 'spring-glaze', userId: 'u1', journeyId: 'j1' },
  'kiln-kit': { slug: 'kiln-kit', userId: 'u1', journeyId: 'j2' },
  'their-page': { slug: 'their-page', userId: 'u2', journeyId: 'j1' },
  'domain:shop.example': 'spring-glaze'
};
const view = (journeyId, visitorId, extra = {}) => ({ userId: 'u1', journeyId, type: 'page_view', ...(visitorId ? { visitorId } : {}), at, ...extra });
const EVENTS = [
  ...Array.from({ length: 10 }, (_, i) => view('j1', `v${i + 1}`)),
  view('j1', 'v1'),
  view('j1', ''),
  { userId: 'u1', journeyId: 'j1', type: 'lead', visitorId: 'v1', email: 'rosa.customer@example.com', name: 'Rosa Customer', phone: '+1 555 0100 222', at },
  { userId: 'u1', journeyId: 'j1', type: 'lead', visitorId: 'v2', at },
  view('j1', 'v99', { at: iso(NOW - 91 * DAY) }),
  view('j1', 'v98', { at: undefined }),
  { userId: 'u2', journeyId: 'j1', type: 'page_view', visitorId: 'v50', at },
  { userId: 'u1', journeyId: 'j7', type: 'lead', visitorId: 'v60', at },
  ...Array.from({ length: 4 }, (_, i) => view('j2', `w${i}`))
];
const ORDERS = [
  { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: '49.50', createdAt: iso(NOW - 3 * DAY), customerEmail: 'buyer@example.com', customerName: 'Bob Buyer' },
  { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 10, createdAt: iso(NOW - 3 * DAY) },
  { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 999, createdAt: iso(NOW - 100 * DAY) },
  { userId: 'u2', attributedSlug: 'their-page', totalPrice: 500, createdAt: at },
  { userId: 'u1', totalPrice: 500, createdAt: at }
];
const CONTACTS = [
  { email: 'rosa.customer@example.com', name: 'Rosa Customer', phone: '+1 555 0100 222', firstSeenAt: iso(NOW - 10 * DAY) },
  { email: 'old@example.com', subscribedAt: iso(NOW - 200 * DAY) },
  { email: 'nodate@example.com' }
];
const EMAIL = { sent: 200, opened: 80, clicked: 20, unsubscribed: 2, revenue: 59.5, delivered: 190 };
const input = (over = {}) => ({ uid: 'u1', journeys: JOURNEYS, events: EVENTS, orders: ORDERS, contacts: CONTACTS, emailStats: EMAIL, publicPages: PAGES, now: NOW, ...over });

test('what-worked.md counts with the stats route’s ownership: this user, this journey, 90 days, people once, orders through owned pages', () => {
  const out = compileWhatWorked(input());
  const md = out.content;
  assert.deepEqual(out.unavailable, []);
  assert.ok(md.startsWith('# What worked for this account\n'));
  assert.ok(md.includes('Measured by Jourvance over the 90 days to 2026-10-12.'));
  // j1: 10 visitors with an id plus one without (the stats route's countPeople), the old, undated and
  // other users' visits left out; 2 leads; a lead step and no sale, so the stages are visits to leads.
  assert.ok(md.includes('### Spring Glaze Sale\nGoal: leads. Traffic source: meta. Published: yes, 1 live page.'), md);
  assert.ok(md.includes('Visits: 11 people. Leads: 2 people, a lead rate of 18.2%.'));
  assert.ok(md.includes('Orders: 0, an order rate of 0%. Revenue: 0.00.'));
  assert.ok(md.includes('Biggest drop: from visits (11) to leads (2), 81.8% fewer.'));
  // j2: the goal comes from its steps (a direct checkout), orders only through its own live page,
  // inside the window.
  assert.ok(md.includes('### Kiln Kit Shop\nGoal: sales. Traffic source: google. Published: yes, 1 live page.'));
  assert.ok(md.includes('Visits: 4 people. Leads: 0 people, a lead rate of 0%.'));
  assert.ok(md.includes('Orders: 2, an order rate of 50%. Revenue: 59.50.'));
  assert.ok(md.includes('Biggest drop: from visits (4) to orders (2), 50% fewer.'));
  assert.ok(md.indexOf('Spring Glaze Sale') < md.indexOf('Kiln Kit Shop'), 'newest journey first');
  assert.ok(md.includes('Sent: 200. Opened: 80, an open rate of 40%. Clicked: 20, a click rate of 10%. Unsubscribed: 2, an unsubscribe rate of 1%. Revenue from email: 59.50.'));
  assert.ok(md.includes('Contacts: 3. Joined in these 90 days: 1. Without a join date: 1.'));
  assert.ok(!md.includes('Not read'));
  assert.deepEqual(out.row, {
    journeys: [
      { goal: 'leads', platform: 'meta', visits: 11, leads: 2, orders: 0 },
      { goal: 'sales', platform: 'google', visits: 4, leads: 0, orders: 2 }
    ],
    email: { sent: 200, opened: 80, clicked: 20 }
  });
  assert.match(out.sha, /^[0-9a-f]{64}$/);
});

test('what-worked.md carries no customer, no other account and no dash: facts only', () => {
  const md = compileWhatWorked(input()).content;
  for (const leak of ['rosa.customer', 'Rosa Customer', '555', 'buyer@example.com', 'Bob Buyer', 'old@example.com', 'nodate@', 'Their Secret Funnel', 'their-page', 'v50', 'u2', '999', '500']) {
    assert.ok(!md.includes(leak), `${leak} reached the file`);
  }
  assert.ok(!md.includes(EM) && !md.includes(EN));
  for (const advice of ['should', 'try ', 'consider', 'recommend']) assert.ok(!md.toLowerCase().includes(advice), `advice: ${advice}`);
  // A journey name that holds an address or a number to dial is cut down to what it is.
  const named = compileWhatWorked(input({ journeys: [{ ...JOURNEYS[0], name: 'Call 555-010-0222 or mail bob@example.com' }] })).content;
  assert.ok(named.includes('### Call [phone] or mail [email]'), named);
});

test('what could not be read is named and never 0, and such a file has no pattern row', () => {
  const noEvents = compileWhatWorked(input({ events: null }));
  assert.deepEqual(noEvents.unavailable, ['events']);
  assert.equal(noEvents.row, null);
  assert.ok(noEvents.content.includes('Visits and leads: not read.'));
  assert.ok(noEvents.content.includes('## Not read\nThese could not be read, so their figures are missing, never zero: events.'));
  assert.ok(!noEvents.content.includes('Visits: 0'));

  const partial = compileWhatWorked(input({ journeysComplete: false, orders: null, emailStats: null, contacts: null, publicPages: null }));
  assert.deepEqual(partial.unavailable, ['journeys', 'orders', 'publicPages', 'contacts', 'email']);
  assert.ok(partial.content.includes('Orders and revenue: not read.'));
  assert.ok(partial.content.includes('Published: not read.'));
  assert.ok(!partial.content.includes('## Email') && !partial.content.includes('## Contacts'));

  // Nothing to say at all is '', never an empty file.
  assert.deepEqual(compileWhatWorked(input({ journeys: [], emailStats: { sent: null }, contacts: [] })).content, '');
  assert.equal(compileWhatWorked(input({ journeys: [JOURNEYS[2]], emailStats: {}, contacts: [] })).content, '', 'another user’s journey is not this user’s');
});

test('the event cap inside the window is named, by the stats route’s rule and by the per-owner trim recordEvent does', () => {
  const { cutoff } = trainingWindow(NOW);
  const full = Array.from({ length: EVENTS_KEPT }, () => ({ userId: 'u9', journeyId: 'x', type: 'page_view', at }));
  assert.equal(eventsPartial(full, 'u1', cutoff), true, 'the whole store at the cap, oldest inside');
  // The fixture's own events without its 91 day old row, so the store's oldest row is inside the window.
  const recent = EVENTS.filter((e) => Date.parse(e.at || '') > NOW - 90 * DAY);
  const md = compileWhatWorked(input({ events: [...full, ...recent] })).content;
  assert.ok(md.includes('Some visits in this window are missing: the event log keeps a fixed number of the newest events.'));
  // This user's own rows at the cap: the store-wide rule misses it (an old row elsewhere), the owner rule does not.
  const mine = Array.from({ length: EVENTS_KEPT }, () => ({ userId: 'u1', journeyId: 'j1', type: 'page_view', at }));
  const old = { userId: 'u2', journeyId: 'x', type: 'page_view', at: iso(NOW - 200 * DAY) };
  assert.equal(eventsPartial([old, ...mine], 'u1', cutoff), true);
  assert.equal(eventsPartial([old, ...mine.slice(1)], 'u1', cutoff), false, 'one row under the cap is complete');
  assert.equal(eventsPartial(EVENTS, 'u1', cutoff), false);
  assert.ok(!compileWhatWorked(input()).content.includes('Some visits'));
});

test('the sha ignores the date alone, changes with a figure, and the file fits 16,000 characters newest first', () => {
  const today = compileWhatWorked(input());
  const tomorrow = compileWhatWorked(input({ now: NOW + DAY }));
  assert.notEqual(today.content, tomorrow.content, 'the date line moved');
  assert.ok(tomorrow.content.includes('the 90 days to 2026-10-13.'));
  assert.equal(today.sha, tomorrow.sha, 'no figure changed, so no re-send');
  const more = compileWhatWorked(input({ events: [...EVENTS, view('j1', 'v-new')] }));
  assert.notEqual(more.sha, today.sha);

  const many = Array.from({ length: 300 }, (_, i) => ({ ...JOURNEYS[0], id: `m${i}`, name: `Journey ${String(i).padStart(3, '0')} ${'x'.repeat(100)}`, updatedAt: iso(NOW - i * 60000) }));
  const big = compileWhatWorked(input({ journeys: many }));
  assert.ok(big.content.length <= WHAT_WORKED_MAX_CHARS, String(big.content.length));
  assert.ok(big.journeys > 10 && big.journeys < 300, String(big.journeys));
  assert.ok(big.content.includes(`${300 - big.journeys} older journeys are not listed here.`));
  assert.ok(big.content.includes('### Journey 000'), 'the newest is kept');
  assert.ok(!big.content.includes('### Journey 299'), 'the oldest went first');
  assert.equal(big.row.journeys.length, TRAINING_JOURNEYS_MAX, 'only the 200 newest journeys are considered');
});

test('goal, platform and the biggest drop come from fixed rules', () => {
  assert.equal(journeyGoal({ goal: ' Sales ' }), 'sales');
  assert.equal(journeyGoal({ goal: 'grow', nodes: [{ type: 'lead-form' }] }), 'leads');
  assert.equal(journeyGoal({ goal: 'grow', nodes: [{ type: 'landing-page', data: { checkoutMode: 'lead-gate' } }] }), 'leads');
  assert.equal(journeyGoal({ goal: 'grow', nodes: [{ type: 'upsell' }] }), 'sales');
  assert.equal(journeyGoal({ goal: 'grow', nodes: [] }), '');
  assert.equal(journeyPlatform({ nodes: [{ type: 'ad-source', data: { platform: 'tiktok' } }] }), 'tiktok');
  assert.equal(journeyPlatform({ nodes: [{ type: 'ad-source', data: { platform: 'myspace' } }] }), '');
  assert.equal(journeyPlatform({}), '');
  assert.deepEqual(biggestDrop([{ name: 'visits', n: 100 }, { name: 'leads', n: 40 }, { name: 'orders', n: 4 }]), { from: 'leads', to: 'orders', fromN: 40, toN: 4, share: 90 });
  assert.equal(biggestDrop([{ name: 'visits', n: 0 }, { name: 'leads', n: 0 }]), null);
  assert.equal(biggestDrop([{ name: 'visits', n: 5 }, { name: 'leads', n: 9 }]), null, 'a rise is not a drop');
});

test('activeAccounts: the userIds with events or orders inside the window, most events first, never an empty id', () => {
  const events = [
    { userId: 'b', at }, { userId: 'a', at }, { userId: 'a', at }, { userId: 'a', at },
    { userId: 'old', at: iso(NOW - 120 * DAY) }, { userId: '', at }, { at }
  ];
  const orders = [{ userId: 'c', createdAt: at }, { userId: 'olderOrder', createdAt: iso(NOW - 120 * DAY) }];
  assert.deepEqual(activeAccounts({ events, orders, now: NOW }), ['a', 'b', 'c']);
  assert.deepEqual(activeAccounts({ events: null, orders: null, now: NOW }), []);
});

// ---- Adversary round (2026-10-12): orders, names, totals, scale ----

test('an order on a page this user owns but carrying another account\u2019s userId is not this user\u2019s', () => {
  const orders = [
    ...ORDERS,
    { userId: 'u2', attributedSlug: 'kiln-kit', totalPrice: 700, createdAt: iso(NOW - 2 * DAY) },
    { attributedSlug: 'kiln-kit', totalPrice: 5, createdAt: iso(NOW - 2 * DAY) }
  ];
  const md = compileWhatWorked(input({ orders })).content;
  assert.ok(md.includes('Orders: 3, an order rate of 75%. Revenue: 64.50.'), md);
  assert.ok(!md.includes('764.50') && !md.includes('700'));
});

test('a journey name loses a seven digit number, a domain, a path and an email', () => {
  const name = 'Call 5550100 or shop.example.com, code SAVE1234567, kilnhaus.store/spring-sale, ask rosa@kiln.co';
  const md = compileWhatWorked(input({ journeys: [{ ...JOURNEYS[0], name }] })).content;
  const line = md.split('\n').find((l) => l.startsWith('### '));
  for (const leak of ['5550100', '1234567', 'shop.example.com', 'kilnhaus.store', 'spring-sale', 'rosa@kiln.co', 'kiln.co']) assert.ok(!line.includes(leak), `${leak} in ${line}`);
  assert.ok(line.includes('[email]'), line);
});

test('a total that is not finite never renders: no NaN, no Infinity', () => {
  const orders = [
    { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 'abc', createdAt: at },
    { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 1e308, createdAt: at },
    { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 1e308, createdAt: at }
  ];
  const md = compileWhatWorked(input({ orders, emailStats: { sent: 10, opened: Infinity, clicked: NaN, revenue: Infinity } })).content;
  assert.ok(!/NaN|Infinity|\u221e/.test(md), md);
  const fine = compileWhatWorked(input({ orders: [{ userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: 'abc', createdAt: at }, { userId: 'u1', attributedSlug: 'kiln-kit', totalPrice: '12.5', createdAt: at }] })).content;
  assert.ok(fine.includes('Revenue: 12.50.'), 'a total that will not parse is skipped, the rest still add up');
});

test('scale: 1,000 journeys over 200,000 events compile in one pass, the 200 newest considered', () => {
  const journeys = Array.from({ length: 1000 }, (_, i) => ({ ...JOURNEYS[0], id: `s${i}`, name: `Scale ${i}`, updatedAt: iso(NOW - i * 60000) }));
  const events = Array.from({ length: 200000 }, (_, i) => ({ userId: i % 7 ? 'u1' : 'u2', journeyId: `s${i % 1000}`, type: i % 9 ? 'page_view' : 'lead', visitorId: `v${i % 5000}`, at }));
  compileWhatWorked(input({ journeys: journeys.slice(0, 5), events: events.slice(0, 1000) }));
  const t0 = performance.now();
  const out = compileWhatWorked(input({ journeys, events }));
  const ms = performance.now() - t0;
  console.log(`[measure] 1,000 journeys over 200,000 events compiled in ${ms.toFixed(1)} ms`);
  assert.ok(ms < 300, `compiled in ${ms.toFixed(1)} ms`);
  assert.equal(out.row.journeys.length, TRAINING_JOURNEYS_MAX);
  assert.ok(out.content.length <= WHAT_WORKED_MAX_CHARS);
  assert.ok(out.content.includes('### Scale 0\n'));
  assert.ok(/\d+ older journeys are not listed here\./.test(out.content));
  // The one-pass grouping counts what the per-journey filter counted.
  const s0 = events.filter((e) => e.userId === 'u1' && e.journeyId === 's0');
  const people = new Set(s0.filter((e) => e.type === 'page_view').map((e) => e.visitorId)).size;
  assert.ok(out.content.includes(`### Scale 0\nGoal: leads. Traffic source: meta. Published: no.\nVisits: ${people.toLocaleString('en-US')} people.`), out.content.slice(0, 600));
});

// ---- S3b: the app patterns, after the adversary round ----

const MONTH_DIGITS = new Set(['2026', '10']);
function account(i, { goal = 'leads', platform = 'meta', visits = 30, leads = 6, orders = 0, sent = 100, opened = 35, clicked = 3 } = {}) {
  return {
    uid: `PLANTUID${i}`,
    email: 'planted.person@example.com',
    name: 'Planted Person',
    journeys: [
      { goal, platform, visits, leads, orders, name: 'Planted Journey Name', slug: 'planted-slug-xyz', domain: 'planted-domain.example' },
      { goal: 'planted goal', platform: 'planted-domain.example', visits: 999, leads: 999, orders: 999 }
    ],
    email: { sent, opened, clicked, from: 'planted.person@example.com' }
  };
}
const many = (n, over = {}) => Array.from({ length: n }, (_, i) => account(i, typeof over === 'function' ? over(i) : over));

test('the adversary\u2019s construction prints nothing: four accounts at 0% and 100% around one victim', () => {
  const victim = account(99, { leads: 11 });
  const rows = [account(1, { leads: 0 }), account(2, { leads: 0 }), account(3, { leads: 30 }), account(4, { leads: 30 }), victim];
  const out = compileAppPatterns(rows, { now: NOW });
  assert.equal(out.content, '');
  assert.equal(out.groups, 0);
});

test('a group needs ten accounts, each with twenty visits: nine print nothing, ten print a band', () => {
  assert.equal(PATTERN_MIN_USERS, 10);
  assert.equal(PATTERN_MIN_ACCOUNT_VISITS, 20);
  assert.equal(compileAppPatterns(many(9), { now: NOW }).content, '');
  assert.ok(compileAppPatterns(many(10), { now: NOW }).content.includes('## Goal leads, Meta'));
  // Accounts under twenty visits neither count nor shape the median.
  assert.equal(compileAppPatterns([...many(9), account(50, { visits: 19, leads: 19 })], { now: NOW }).content, '');
  // The same account twice is one account.
  assert.equal(compileAppPatterns([...many(9), many(9)[8]], { now: NOW }).content, '');
});

test('ten accounts with one outlier print the band that holds the median, never the outlier\u2019s figure, and no total', () => {
  const leads = [6, 6, 7, 7, 7, 8, 8, 8, 8, 25];
  const rows = many(10, (i) => ({ leads: leads[i], orders: i === 9 ? 10 : 0, opened: 30 + i, clicked: 2 }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.includes('## Goal leads, Meta\nAccounts: 10 or more.\nMedian lead rate: 20 to 30%. Median order rate: 0 to 10%.'), md);
  assert.ok(md.includes('Median email open rate: 30 to 40%. Median email click rate: 0 to 10%.'), md);
  assert.ok(!md.includes('83') && !md.includes('33.3'), 'the outlier\u2019s exact figure is not there');
  assert.ok(!/Visits|visits:/.test(md.split('\n').slice(3).join('\n')), 'no visit total');
  const big = compileAppPatterns(many(37), { now: NOW }).content;
  assert.ok(big.includes('Accounts: 10 or more.') && !big.includes('37'), 'the account count is never exact');
});

test('a middle half wider than forty points prints "varies widely"', () => {
  const rows = many(12, (i) => ({ leads: i < 6 ? 0 : 30 }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.includes('Median lead rate: varies widely.'), md);
  assert.ok(!md.includes('50'), 'no midpoint band is printed for a split group');
});

test('no digit in the file but band bounds and the month, and no planted uid, email, name, slug or domain', () => {
  const rows = many(14, (i) => ({ leads: 3 + i, orders: i % 3, opened: 20 + i * 2, clicked: 1 + (i % 4) }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.length > 0, 'precondition: the group passed, so there is a file to search');
  for (const d of md.match(/\d+/g) || []) {
    const n = Number(d);
    assert.ok(MONTH_DIGITS.has(d) || (n % 10 === 0 && n >= 0 && n <= 100), `digit sequence ${d} in the file`);
  }
  for (const plant of ['PLANTUID', 'planted.person@example.com', 'Planted Person', 'Planted Journey Name', 'planted-slug-xyz', 'planted-domain.example', 'planted goal']) {
    assert.ok(!md.toLowerCase().includes(plant.toLowerCase()), `${plant} reached the patterns`);
  }
  assert.ok(!/planted|999/i.test(md));
  assert.ok(!md.includes(EM) && !md.includes(EN));
  // Email bands need ten senders too.
  const quiet = rows.map((r, i) => (i < 9 ? r : { ...r, email: { sent: null } }));
  assert.ok(compileAppPatterns(quiet, { now: NOW }).content.includes('Email rates: not shown, fewer than ten of these accounts sent email.'));
  assert.equal(compileAppPatterns(null, { now: NOW }).content, '');
  assert.equal(compileAppPatterns(rows, { now: NOW }).filename, 'jourvance-patterns-2026-10.md');
});
