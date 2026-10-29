// Training off real user data, the pure half (server/assistantTraining.mjs, ASK_JOURVANCE_PLAN.md
// W2.S S3 and S3b): what-worked.md counts with the funnel stats route's ownership predicates over 90
// days, holds facts only and no customer's name, email or phone, names what it could not read, says
// when the event cap is inside the window, fits 16,000 characters and keeps its sha across a day that
// changed no figure; the app patterns keep a group only with 25 accounts of 20 visits each, print a
// band only when no single account decides it, and nothing from an input but numbers and two fixed
// word lists reaches the file; the journey shapes (W3.C) are built from fixed words and a band only.
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
  TRAINING_JOURNEYS_MAX,
  rateBand,
  bandLabel,
  numberWord,
  bandWords,
  compileShapeLearns,
  stepVariantOf,
  canvasOrder,
  stepCountWord,
  STEP_VARIANTS,
  BUSINESS_TYPES,
  UNIVERSAL_BUSINESS_CATEGORIES,
  ALL_BUSINESS_TYPES,
  SHAPE_KIND,
  SHAPE_MIN_VISITS,
  SHAPE_MIN_ORDERS,
  SHAPE_LEARNS_PER_DAY,
  SHAPE_LEARNS_KEPT,
  cleanShapeLearns,
  shapeSentRecently,
  recordShapeLearn,
  shapeSlotsLeft,
  claimShapeDays
} from './server/assistantTraining.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';
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

test('a group needs twenty-five accounts, each with twenty visits: twenty-four print nothing, twenty-five print a band', () => {
  assert.equal(PATTERN_MIN_USERS, 25);
  assert.equal(PATTERN_MIN_ACCOUNT_VISITS, 20);
  assert.equal(compileAppPatterns(many(24), { now: NOW }).content, '');
  const md = compileAppPatterns(many(25), { now: NOW }).content;
  assert.ok(md.includes('## Goal leads, Meta\nAccounts: 25 or more.\nMedian lead rate: 20 to 30%.'), md);
  // Accounts under twenty visits neither count nor shape the median.
  assert.equal(compileAppPatterns([...many(24), account(50, { visits: 19, leads: 19 })], { now: NOW }).content, '');
  // The same account twice is one account.
  assert.equal(compileAppPatterns([...many(24), many(24)[23]], { now: NOW }).content, '');
});

test('the file says both rules in plain words: twenty-five accounts, and a band only when no one account decides it', () => {
  const md = compileAppPatterns(many(25), { now: NOW }).content;
  assert.ok(md.includes('A group is listed only when it holds at least twenty-five accounts with at least twenty visits each.'), md);
  assert.ok(md.includes('printed only when leaving out any one account keeps the median in that same band; otherwise it reads "varies", so no single account can decide a band.'), md);
  assert.ok(md.includes('A figure reads "varies widely" when the middle half of the accounts spreads wider than forty points.'), md);
  assert.ok(!/\bten accounts\b|10 or more/.test(md), 'no stale floor of ten');
  assert.ok(md.includes("A group of colluding accounts that outnumbers the honest ones can learn an honest account's band over several months; the rule here raises the cost, it does not remove it."), md);
});

test('twenty-five accounts with one outlier print the band that holds the median, never the outlier\u2019s figure, and no total', () => {
  const leads = [...Array(6).fill(6), ...Array(6).fill(7), ...Array(12).fill(8), 25];
  const rows = many(25, (i) => ({ leads: leads[i], orders: i === 24 ? 10 : 0, opened: 30 + i, clicked: 2 }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.includes('## Goal leads, Meta\nAccounts: 25 or more.\nMedian lead rate: 20 to 30%. Median order rate: 0 to 10%.'), md);
  assert.ok(md.includes('Median email open rate: 40 to 50%. Median email click rate: 0 to 10%.'), md);
  assert.ok(!md.includes('83') && !md.includes('33.3'), 'the outlier\u2019s exact figure is not there');
  assert.ok(!/Visits|visits:/.test(md.split('\n').slice(3).join('\n')), 'no visit total');
  const big = compileAppPatterns(many(37), { now: NOW }).content;
  assert.ok(big.includes('Accounts: 25 or more.') && !big.includes('37'), 'the account count is never exact');
});

test('a middle half wider than forty points prints "varies widely"', () => {
  const rows = many(30, (i) => ({ leads: i < 15 ? 0 : 30 }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.includes('Median lead rate: varies widely.'), md);
  assert.ok(!md.includes('50'), 'no midpoint band is printed for a split group');
});

test('no digit in the file but band bounds, the account floor and the month, and no planted uid, email, name, slug or domain', () => {
  const rows = many(30, (i) => ({ leads: 6 + (i % 5), orders: i % 3, opened: 20 + (i % 10) * 2, clicked: 1 + (i % 4) }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.length > 0, 'precondition: the group passed, so there is a file to search');
  for (const d of md.match(/\d+/g) || []) {
    const n = Number(d);
    assert.ok(MONTH_DIGITS.has(d) || n === PATTERN_MIN_USERS || (n % 10 === 0 && n >= 0 && n <= 100), `digit sequence ${d} in the file`);
  }
  for (const plant of ['PLANTUID', 'planted.person@example.com', 'Planted Person', 'Planted Journey Name', 'planted-slug-xyz', 'planted-domain.example', 'planted goal']) {
    assert.ok(!md.toLowerCase().includes(plant.toLowerCase()), `${plant} reached the patterns`);
  }
  assert.ok(!/planted|999/i.test(md));
  assert.ok(!md.includes(EM) && !md.includes(EN));
  // Email bands need twenty-five senders too.
  const quiet = rows.map((r, i) => (i < 24 ? r : { ...r, email: { sent: null } }));
  assert.ok(compileAppPatterns(quiet, { now: NOW }).content.includes('Email rates: not shown, fewer than twenty-five of these accounts sent email.'));
  assert.equal(compileAppPatterns(null, { now: NOW }).content, '');
  assert.equal(compileAppPatterns(rows, { now: NOW }).filename, 'jourvance-patterns-2026-10.md');
});

// ---- W3.C: a band no single account decides ----

// The median's band alone, as rateBand printed it before W3.C: what a colluder used to read.
const medianBand = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return bandLabel(m);
};

test('a band that one account decides prints "varies", in rateBand and in the file', () => {
  const rates = [...Array(12).fill(15), 20, ...Array(12).fill(25)];
  assert.equal(medianBand(rates), '20 to 30%', 'precondition: the median alone would print a band');
  assert.equal(rateBand(rates), 'varies');
  // The same set as accounts: 20 visits each, 3, 4 or 5 leads (15%, 20%, 25%).
  const rows = many(25, (i) => ({ visits: 20, leads: i < 12 ? 3 : i === 12 ? 4 : 5 }));
  const md = compileAppPatterns(rows, { now: NOW }).content;
  assert.ok(md.includes('Median lead rate: varies. Median order rate: 0 to 10%.'), md);
  // A single value has no band that survives taking it out; no value at all has none to print.
  assert.equal(rateBand([42]), 'varies');
  assert.equal(rateBand([]), null);
  // The IQR rule is checked first and keeps its own words.
  assert.equal(rateBand([...Array(13).fill(0), ...Array(12).fill(100)]), 'varies widely');
});

test('nine colluders spaced ten points apart around one victim print nothing: a group needs twenty-five accounts', () => {
  const colluders = Array.from({ length: 9 }, (_, i) => account(i, { visits: 100, leads: i * 10 }));
  const victim = account(99, { visits: 100, leads: 37 });
  assert.equal(compileAppPatterns([...colluders, victim], { now: NOW }).content, '');
});

test('twenty-four colluders around one victim: whenever the victim’s value decides the band the file prints "varies", and a printed band is the colluders’ own', () => {
  // 12 colluders at 25% and 12 at 35%, so the median sits on the 30% edge and the victim picks the side.
  const colluders = [...Array(12).fill(25), ...Array(12).fill(35)];
  const without = medianBand(colluders);
  assert.equal(without, '30 to 40%');
  const printed = new Map();
  let decided = 0;
  for (let v = 0; v <= 100; v += 1) {
    const all = [...colluders, v];
    const out = rateBand(all);
    if (medianBand(all) !== without) {
      decided += 1;
      assert.equal(out, 'varies', `the victim at ${v}% decided the band and it printed ${out}`);
    }
    assert.ok(out === 'varies' || out === without, `the victim at ${v}% printed ${out}`);
    printed.set(v, out);
  }
  assert.equal(decided, 30, 'precondition: the old rule printed the victim’s side for every value under 30%');
  // End to end at 27%: the old rule would have printed "20 to 30%", the victim's own side.
  const rows = [...colluders.map((r, i) => account(i, { visits: 100, leads: r })), account(99, { visits: 100, leads: 27 })];
  assert.equal(medianBand([...colluders, 27]), '20 to 30%');
  assert.ok(compileAppPatterns(rows, { now: NOW }).content.includes('Median lead rate: varies.'));
  // NAMED RESIDUAL, pinned so nobody reads more into the rule than it gives: WHETHER a band prints
  // still turns on the victim's value around an edge the colluders chose. Here it prints for 35% and
  // above and "varies" below: one yes or no about one account, per rate, per monthly file. Measured by
  // the W3.C adversary and re-run on this module (scratchpad w3c-adv/p4b-edges.mjs, p4-collusion.mjs):
  // 24 colluders alone in a group with one honest account learn its ten point band in 4 monthly files
  // and its value to within one point in 7. No deterministic rule closes it, noise was ruled out, and
  // the file says so in plain words (the next test pins that sentence).
  assert.deepEqual([...new Set(printed.values())].sort(), ['30 to 40%', 'varies']);
  assert.deepEqual([printed.get(34), printed.get(35)], ['varies', '30 to 40%']);
});

test('an honest group prints its band whatever one account’s figure is', () => {
  const honest = [22, 23, 23, 24, 24, 24, 25, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27, 27, 28, 28, 28, 29, 29, 31, 33];
  assert.equal(rateBand(honest), '20 to 30%');
  const md = compileAppPatterns(many(25, (i) => ({ visits: 100, leads: honest[i] })), { now: NOW }).content;
  assert.ok(md.includes('Median lead rate: 20 to 30%.'), md);
  for (let v = 0; v <= 100; v += 5) assert.equal(rateBand([...honest.slice(0, 24), v]), '20 to 30%', `one account at ${v}%`);
});

// ---- W3.C: journey shapes for the shared brain ----

const TOKEN = 'ZEBRAQUARTZ';
const node = (id, type, x, data = {}, y = 100) => ({ id, type, position: { x, y }, data: { type, ...data } });
function shapeJourney(over = {}) {
  return {
    id: `jrn_${TOKEN}_77`,
    userId: 'u1',
    name: `${TOKEN} Spring Sale`,
    offerHeadline: `${TOKEN} headline`,
    slug: `${TOKEN.toLowerCase()}-sale`,
    url: `https://${TOKEN.toLowerCase()}.example/sale`,
    businessType: `${TOKEN} Pottery`,
    goal: 'sales',
    // Out of canvas order on purpose: the prompt reads them left to right.
    nodes: [
      node('n-ty', 'thank-you', 900, { label: `${TOKEN} thanks` }),
      node('n-ad', 'ad-source', 0, { platform: 'meta', label: `${TOKEN} ad`, headline: `${TOKEN} headline` }),
      node('n-up', 'upsell', 600, { label: `${TOKEN} upsell`, offerType: 'upsell' }),
      node('n-lp', 'landing-page', 300, { label: `${TOKEN} page`, slug: `${TOKEN.toLowerCase()}-sale`, url: `https://${TOKEN.toLowerCase()}.example` })
    ],
    updatedAt: iso(NOW - DAY),
    ...over
  };
}
const fig = (visits, orders, extra = {}) => ({ visits, leads: 0, orders, revenue: 0, live: 1, ...extra });
const shapesOf = (journeys, figures, businessTypes = BUSINESS_TYPES) => compileShapeLearns({ uid: 'u1', journeys, figures: new Map(figures), businessTypes, now: NOW });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('a journey shape is built from fixed words and a band: no name, slug, id, url, headline or exact figure', () => {
  const j = shapeJourney();
  const out = shapesOf([j], [[j.id, fig(1000, 237, { leads: 40, revenue: 12345.67 })]]);
  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  assert.equal(row.prompt, 'Orders per hundred visits: twenty to thirty. A sales journey from Meta with four steps: ad then page then upsell then thank-you.');
  assert.deepEqual(Object.keys(row).sort(), ['journeyId', 'kind', 'niche', 'prompt', 'rating', 'sha']);
  assert.deepEqual([row.kind, row.niche, row.rating, row.journeyId], [SHAPE_KIND, 'general', 4, j.id]);
  // What leaves for the hub: everything but the journey id, which stays on this server.
  const leaving = JSON.stringify({ kind: row.kind, niche: row.niche, prompt: row.prompt, rating: row.rating }).toLowerCase();
  for (const leak of [TOKEN, 'jrn_', '1000', '1,000', '237', '23.7', '24%', '12345', 'http', '.example', 'spring', 'pottery', 'headline', '"u1"']) {
    assert.ok(!leaving.includes(leak.toLowerCase()), `${leak} reached the learn`);
  }
  assert.match(row.prompt, /^[^0-9]*$/, 'no digit at all: the hub would turn it into N');
  assert.ok(!row.prompt.includes(EM) && !row.prompt.includes(EN));
  assert.deepEqual(out.skipped, { fewVisits: 0, fewOrders: 0, noShape: 0 });
});

test('the band, the count in words, the singular, the goal and the source come from fixed rules', () => {
  const one = (nodes, f, over = {}) => shapesOf([shapeJourney({ nodes, ...over })], [[`jrn_${TOKEN}_77`, f]]).rows[0]?.prompt;
  const pages = (n) => Array.from({ length: n }, (_, i) => node(`p${String(i).padStart(2, '0')}`, 'landing-page', i * 10));
  assert.equal(one(pages(1), fig(1000, 300)), 'Orders per hundred visits: thirty to forty. A sales journey from an unnamed source with one step: page.');
  assert.match(one(pages(12), fig(1000, 300)), / with twelve steps: page then /);
  assert.match(one(pages(20), fig(1000, 300)), / with twenty steps: /);
  assert.match(one(pages(21), fig(1000, 300)), / with more than twenty steps: /);
  // Orders past visits are capped, as the patterns cap them.
  assert.match(one(pages(1), fig(300, 400)), /^Orders per hundred visits: ninety to one hundred\. /);
  // A step of no known type is left out of the order and the count.
  assert.match(one([node('a', 'ad-source', 0, { platform: 'organic' }), node('m', 'mystery', 50), node('b', 'landing-page', 100)], fig(1000, 90)), /^Orders per hundred visits: zero to ten\. A sales journey from organic traffic with two steps: ad then page\.$/);
  assert.match(one([node('a', 'ad-source', 0, { platform: 'tiktok' }), node('f', 'lead-form', 100)], fig(1000, 90), { goal: 'grow' }), /\. A leads journey from TikTok with two steps: ad then form\.$/);
  assert.match(one([node('b', 'landing-page', 0)], fig(1000, 90), { goal: '' }), /\. A general journey from an unnamed source /);
  for (const [n, w] of [[0, 'zero'], [1, 'one'], [13, 'thirteen'], [20, 'twenty'], [21, 'more than twenty'], [99, 'more than twenty']]) assert.equal(stepCountWord(n), w);
  for (const [n, w] of [[25, 'twenty-five'], [40, 'forty'], [99, 'ninety-nine'], [100, ''], [-1, ''], [2.5, '']]) assert.equal(numberWord(n), w);
  for (const [v, w] of [[0, 'zero to ten'], [9.99, 'zero to ten'], [23.7, 'twenty to thirty'], [30, 'thirty to forty'], [90, 'ninety to one hundred'], [100, 'ninety to one hundred'], [-5, 'zero to ten']]) assert.equal(bandWords(v), w);
});

test('no shape prompt holds a digit, over every band, count, goal and source', () => {
  const sources = ['meta', 'google', 'tiktok', 'organic', 'myspace', null];
  const kinds = ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split'];
  let checked = 0;
  for (let orders = 5; orders <= 120; orders += 5) {
    for (const [i, platform] of sources.entries()) {
      const steps = 1 + ((orders + i * 7) % 25);
      const nodes = Array.from({ length: steps }, (_, k) => node(`s${k}`, kinds[(k + i) % kinds.length], k * 10, { platform, sequenceType: 'checkout_recovery', offerType: k % 2 ? 'downsell' : 'upsell' }));
      if (platform) nodes.unshift(node('ad', 'ad-source', -10, { platform }));
      const rows = shapesOf([shapeJourney({ nodes, goal: ['sales', 'leads', '', 'grow'][i % 4], businessType: i % 2 ? 'E-Commerce Store' : `${TOKEN} 2026` })], [[`jrn_${TOKEN}_77`, fig(1000, orders * 10, { leads: 77, revenue: 1234.5 })]]).rows;
      assert.equal(rows.length, 1);
      assert.match(rows[0].prompt, /^[^0-9]*$/, rows[0].prompt);
      assert.match(rows[0].niche, /^[^0-9]*$/);
      checked += 1;
    }
  }
  assert.equal(checked, 24 * sources.length);
});

test('the band sentence sits inside the first 220 characters, the hub’s cut, however many steps a journey has', () => {
  const LEARN_PATTERN_MAX = 220;
  // The longest names, the longest source and the top band: the worst case for the cut.
  for (const n of [1, 12, 20, 21, 40]) {
    const nodes = Array.from({ length: n }, (_, k) => node(`r${String(k).padStart(2, '0')}`, 'follow-up-sequence', k * 10, { sequenceType: 'upsell_recovery' }));
    nodes.unshift(node('ad', 'ad-source', -10, { platform: 'organic' }));
    const prompt = shapesOf([shapeJourney({ nodes })], [[`jrn_${TOKEN}_77`, fig(1000, 1000)]]).rows[0].prompt;
    assert.ok(prompt.slice(0, LEARN_PATTERN_MAX).includes('Orders per hundred visits: ninety to one hundred.'), `${n} steps: ${prompt.slice(0, LEARN_PATTERN_MAX)}`);
    if (n >= 20) assert.ok(prompt.length > LEARN_PATTERN_MAX, `precondition: ${n} steps run past the cut (${prompt.length})`);
  }
});

test('rating is 5 only at twice the account median over its journeys with two hundred visits, and 4 with one journey', () => {
  // Each journey its own shape (one, two, three... pages), so no two rows fold into one.
  const j = (id, over = {}) => shapeJourney({ id, nodes: Array.from({ length: 1 + 'abcde'.indexOf(id) }, (_, i) => node(`${id}-p${i}`, 'landing-page', i * 10)), ...over });
  // 10%, 12% and 30%, with a fourth at 0% (no row, too few orders) that still counts in the median:
  // the median is 11, so 22% or more is a 5.
  let out = shapesOf([j('a'), j('b'), j('c'), j('d')], [['a', fig(1000, 100)], ['b', fig(1000, 120)], ['c', fig(1000, 300)], ['d', fig(1000, 0)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['c', 5], ['b', 4], ['a', 4]]);
  // A journey under two hundred visits is not in the median: with it (0%) the median of 0, 4 and 10 would be
  // 4 and 10% a 5; without it the median of 4 and 10 is 7, and 10% stays a 4.
  out = shapesOf([j('a'), j('b', { nodes: [] }), j('e')], [['a', fig(1000, 100)], ['b', fig(1000, 40)], ['e', fig(199, 0)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['a', 4]]);
  // Two journeys at 0% and 10%: the median is 5, and 10% is twice it.
  out = shapesOf([j('a'), j('d')], [['a', fig(1000, 100)], ['d', fig(1000, 0)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['a', 5]]);
  // Exactly twice the median (10%) is a 5; 1.8 times it is a 4.
  out = shapesOf([j('a'), j('b'), j('c')], [['a', fig(1000, 100)], ['b', fig(1000, 100)], ['c', fig(1000, 200)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['c', 5], ['a', 4], ['b', 4]]);
  out = shapesOf([j('a'), j('b'), j('c')], [['a', fig(1000, 100)], ['b', fig(1000, 100)], ['c', fig(1000, 180)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['c', 4], ['a', 4], ['b', 4]]);
  // One journey: no median of two, so 4 however well it did.
  out = shapesOf([j('a')], [['a', fig(1000, 900)]]);
  assert.deepEqual(out.rows.map((r) => r.rating), [4]);
});

test('niche is the journey’s business type only when it is on the app’s list, else general', () => {
  assert.deepEqual(BUSINESS_TYPES, ['E-Commerce Store']);
  assert.ok(Object.isFrozen(BUSINESS_TYPES));
  const niche = (businessType, list) => shapesOf([shapeJourney({ businessType })], [[`jrn_${TOKEN}_77`, fig(1000, 100)]], list).rows[0].niche;
  assert.equal(niche('E-Commerce Store'), 'E-Commerce Store');
  assert.equal(niche('  E-Commerce Store '), 'E-Commerce Store');
  for (const other of ['e-commerce store', 'E-Commerce Brand', 'Pottery studio', '', undefined, 42]) assert.equal(niche(other), 'general', String(other));
  assert.equal(niche('Pottery studio', ['Pottery studio']), 'Pottery studio');
});

test('universal business categories are exported and recognized in shape learns', () => {
  assert.deepEqual(UNIVERSAL_BUSINESS_CATEGORIES, [
    'E-Commerce & Physical Retail',
    'Local & Client Services',
    'B2B, Agencies & Consulting',
    'Digital Products, Courses & Creators',
    'SaaS, Tech & Events'
  ]);
  assert.ok(Object.isFrozen(UNIVERSAL_BUSINESS_CATEGORIES));
  assert.deepEqual(ALL_BUSINESS_TYPES, ['E-Commerce Store', ...UNIVERSAL_BUSINESS_CATEGORIES]);
  assert.ok(Object.isFrozen(ALL_BUSINESS_TYPES));

  for (const cat of UNIVERSAL_BUSINESS_CATEGORIES) {
    const res = compileShapeLearns({
      uid: 'u1',
      journeys: [shapeJourney({ businessType: cat })],
      figures: new Map([[`jrn_${TOKEN}_77`, fig(1000, 100)]])
    });
    assert.equal(res.rows[0].niche, cat);
  }
});

test('the server’s step variants equal stepVariant in src/lib/stepKinds.ts over every node type and every sequenceType', async () => {
  const { stepVariant, STEP_KINDS } = await import('./src/lib/stepKinds.ts');
  const journeyTs = fs.readFileSync('src/types/journey.ts', 'utf8');
  const quoted = (m) => [...m.matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const nodeTypes = quoted(journeyTs.match(/export type NodeType = ([^;]+);/)[1]);
  const seqTypes = quoted(journeyTs.match(/sequenceType\?: ([^;]+);/)[1]);
  assert.ok(nodeTypes.length >= 7 && nodeTypes.includes('follow-up-sequence'), `NodeType read as ${nodeTypes}`);
  assert.ok(seqTypes.length >= 5 && seqTypes.includes('lead_nurture'), `sequenceType read as ${seqTypes}`);
  const types = [...nodeTypes, 'mystery', '', 'constructor', '__proto__', 'toString', undefined, null, 7];
  const datas = [
    undefined, null, {}, 'text',
    { offerType: 'downsell' }, { offerType: 'upsell' }, { offerType: 'DOWNSELL' },
    ...seqTypes.map((s) => ({ sequenceType: s })),
    { sequenceType: 'constructor' }, { sequenceType: '__proto__' }, { sequenceType: 'mystery' }, { sequenceType: null },
    ...nodeTypes.map((t) => ({ type: t })),
    ...nodeTypes.map((t) => ({ type: t, sequenceType: 'checkout_recovery', offerType: 'downsell' }))
  ];
  const produced = new Set();
  let checked = 0;
  for (const t of types) {
    for (const d of datas) {
      const client = stepVariant(t, d);
      assert.equal(stepVariantOf(t, d), client, `${String(t)} ${JSON.stringify(d)}`);
      if (client) produced.add(client);
      checked += 1;
    }
  }
  assert.equal(checked, types.length * datas.length);
  assert.ok(checked >= 400, `checked ${checked}`);
  assert.deepEqual([...STEP_VARIANTS].sort(), Object.keys(STEP_KINDS).sort(), 'the twelve names are the client’s twelve');
  assert.deepEqual([...produced].sort(), [...STEP_VARIANTS].sort(), 'every one of the twelve is reached');
});

test('the canvas order is the app’s orderSteps, and the shape does not depend on the order the nodes are stored in', async () => {
  const { orderSteps } = await import('./src/lib/stepNavigation.ts');
  const types = ['ad-source', 'landing-page', 'lead-form', 'follow-up-sequence', 'thank-you', 'upsell', 'ab-split'];
  const seqs = ['lead_nurture', 'checkout_recovery', 'upsell_recovery', 'at_risk_winback', 'fulfillment_review'];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  for (let trial = 0; trial < 300; trial++) {
    const nodes = Array.from({ length: 1 + Math.floor(rnd() * 9) }, (_, i) => {
      const type = pick(types);
      const data = { type, ...(rnd() < 0.25 ? { isRetentionBranch: true } : {}), ...(type === 'follow-up-sequence' ? { sequenceType: pick(seqs) } : {}) };
      // Coarse grids so x and y tie often, and a 0.4 offset that Math.round must absorb.
      return { id: `n${Math.floor(rnd() * 4)}-${i}`, type, position: { x: Math.floor(rnd() * 3) * 300 + (rnd() < 0.3 ? 0.4 : 0), y: Math.floor(rnd() * 3) * 200 }, data };
    });
    assert.deepEqual(canvasOrder(nodes).map((n) => n.id), orderSteps(nodes).map((n) => n.id), `trial ${trial}`);
    const reversed = [...nodes].reverse();
    assert.deepEqual(canvasOrder(reversed).map((n) => n.id), canvasOrder(nodes).map((n) => n.id));
  }
  // A position that is not a number still sorts the same whatever the stored order.
  const odd = [node('b', 'landing-page', NaN), node('a', 'ad-source', undefined), node('c', 'thank-you', 0, {}, Infinity)];
  assert.deepEqual(canvasOrder(odd).map((n) => n.id), canvasOrder([...odd].reverse()).map((n) => n.id));
  const j = shapeJourney();
  const a = shapesOf([j], [[j.id, fig(1000, 300)]]).rows[0];
  const b = shapesOf([{ ...j, nodes: [...j.nodes].reverse() }], [[j.id, fig(1000, 300)]]).rows[0];
  assert.deepEqual(b, a);
});

test('the sha is sha256 of kind, niche and prompt, stable, and two journeys of one shape are one row with the higher rating', () => {
  const j = shapeJourney({ businessType: 'E-Commerce Store' });
  const row = shapesOf([j], [[j.id, fig(1000, 300)]]).rows[0];
  assert.equal(row.sha, sha256(`${SHAPE_KIND}\n${row.niche}\n${row.prompt}`));
  assert.equal(shapesOf([j], [[j.id, fig(1000, 300)]]).rows[0].sha, row.sha, 'stable');
  assert.notEqual(shapesOf([{ ...j, businessType: 'other' }], [[j.id, fig(1000, 300)]]).rows[0].sha, row.sha, 'the niche is in the sha');
  // 31% and 39% are one shape (one band); with 0% and 2% beside them the median is 16.5, so 39% is a 5.
  // The 2% journey has too few orders (18) to be a row of its own but enough visits to count.
  const twin = (id) => shapeJourney({ id });
  const out = shapesOf([twin('x31'), twin('x39'), twin('z0'), twin('z2')], [['x31', fig(1000, 310)], ['x39', fig(1000, 390)], ['z0', fig(1000, 0)], ['z2', fig(900, 18)]]);
  assert.deepEqual(out.rows.map((r) => [r.journeyId, r.rating]), [['x39', 5]]);
  assert.deepEqual(out.skipped, { fewVisits: 0, fewOrders: 2, noShape: 0 });
});

test('a journey needs two hundred visits, twenty orders and a known step; another account’s or an unmeasured journey is not counted', () => {
  const j = (id, over = {}) => shapeJourney({ id, ...over });
  const out = shapesOf(
    [j('v199'), j('vnull'), j('o19'), j('onull'), j('empty', { nodes: [] }), j('unknown', { nodes: [node('m', 'mystery', 0)] }), j('theirs', { userId: 'u2' }), j('unmeasured'), j('edge')],
    [['v199', fig(199, 100)], ['vnull', fig(null, 100)], ['o19', fig(600, 19)], ['onull', fig(600, null)], ['empty', fig(600, 60)], ['unknown', fig(600, 60)], ['theirs', fig(600, 60)], ['edge', fig(SHAPE_MIN_VISITS, SHAPE_MIN_ORDERS)]]
  );
  assert.deepEqual(out.skipped, { fewVisits: 2, fewOrders: 2, noShape: 2 });
  assert.deepEqual(out.rows.map((r) => r.journeyId), ['edge'], 'exactly two hundred visits and twenty orders qualify');
  assert.deepEqual(compileShapeLearns({ uid: 'u1', journeys: null, figures: null }), { rows: [], skipped: { fewVisits: 0, fewOrders: 0, noShape: 0 } });
  // The 95% interval around 5 orders in 50 visits is wider than a band; around 20 in 200 it is not.
  assert.deepEqual([SHAPE_MIN_VISITS, SHAPE_MIN_ORDERS], [200, 20]);
});

test('the thread record: only sha keys with real past days, ninety kept, aged ones pruned first, thirty days before a resend', () => {
  const sha = (n) => sha256(String(n));
  const day = (ago) => iso(NOW - ago * DAY).slice(0, 10);
  const parsed = JSON.parse(`{"__proto__":"2026-10-01","${sha(1)}":"2026-10-01","${sha(2)}":"yesterday","${sha(3)}":5,"notasha":"2026-10-01","${sha(4)}":"2026-13-45","${sha(5)}":"2026-02-30"}`);
  assert.deepEqual(cleanShapeLearns(parsed), { [sha(1)]: '2026-10-01' });
  assert.deepEqual(cleanShapeLearns(null), {});
  assert.deepEqual(cleanShapeLearns([]), {});
  assert.equal(SHAPE_LEARNS_KEPT, 90, 'three a day for thirty days');
  // Three a day for forty days: ninety kept, the newest, with or without a clock.
  const forty = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [sha(i), day(Math.floor(i / 3))]));
  for (const kept of [cleanShapeLearns(forty), cleanShapeLearns(forty, NOW)]) {
    assert.equal(Object.keys(kept).length, 90);
    assert.ok(kept[sha(0)] && kept[sha(89)] && !kept[sha(90)], 'the newest ninety');
  }
  // The adversary's eviction (p5b-evict.mjs): sixty shapes, three a day over twenty days, all still
  // read as sent on day twenty. With fifty kept, ten of them read as never sent.
  let rec = {};
  for (let i = 0; i < 60; i++) rec = recordShapeLearn(rec, sha(i), NOW + Math.floor(i / 3) * DAY);
  const forgotten = Array.from({ length: 60 }, (_, i) => i).filter((i) => !shapeSentRecently(rec, sha(i), NOW + 20 * DAY));
  assert.deepEqual(forgotten, []);
  // Age first, then count: the aged entries go before any recent one is cut.
  const mixed = { ...Object.fromEntries(Array.from({ length: 89 }, (_, i) => [sha(i), day(Math.floor(i / 3))])), ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [sha(500 + i), day(35)])) };
  const after = recordShapeLearn(mixed, sha(999), NOW);
  assert.equal(Object.keys(after).length, 90);
  assert.ok(after[sha(999)] && after[sha(88)] && !Object.keys(after).some((k) => after[k] === day(35)), 'every aged entry dropped, every recent one kept');
  assert.deepEqual(recordShapeLearn({ [sha(1)]: day(40) }, sha(2), NOW), { [sha(2)]: '2026-10-12' });
  // Thirty days, and a day after today is dropped: it would hold a shape back for longer.
  assert.equal(shapeSentRecently({ [sha(1)]: day(0) }, sha(1), NOW), true);
  assert.equal(shapeSentRecently({ [sha(1)]: day(29) }, sha(1), NOW), true);
  assert.equal(shapeSentRecently({ [sha(1)]: day(30) }, sha(1), NOW), false, 'thirty days on, it may go again');
  assert.equal(shapeSentRecently({ [sha(1)]: day(-3) }, sha(1), NOW), false, 'a future day is dropped');
  assert.deepEqual(cleanShapeLearns({ [sha(1)]: '9999-12-31', [sha(2)]: day(1) }, NOW), { [sha(2)]: day(1) });
  assert.equal(shapeSentRecently({}, sha(1), NOW), false);
});

test('a day count that is not a finite number of 0 or more reads as a full day, never as zero', () => {
  assert.equal(SHAPE_LEARNS_PER_DAY, 3);
  assert.equal(shapeSlotsLeft({}, NOW), 3);
  assert.equal(shapeSlotsLeft({ shapeDays: {} }, NOW), 3);
  assert.equal(shapeSlotsLeft({ shapeDays: { '2026-10-11': 3 } }, NOW), 3, 'yesterday does not count');
  assert.equal(shapeSlotsLeft({ shapeDays: { '2026-10-12': 2 } }, NOW), 1);
  assert.equal(shapeSlotsLeft({ shapeDays: { '2026-10-12': 5 } }, NOW), 0);
  for (const bad of [null, '', [], false, true, 'x', '1', -1, NaN, {}, [1]]) {
    assert.equal(shapeSlotsLeft({ shapeDays: { '2026-10-12': bad } }, NOW), 0, `today = ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, [], ['2026-10-12'], 'x', '', 0, false]) {
    assert.equal(shapeSlotsLeft({ shapeDays: bad }, NOW), 0, `shapeDays = ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(claimShapeDays({ shapeDays: { '2026-10-11': 3, '2026-10-12': 1 } }, 2, NOW), { '2026-10-12': 3 });
});
