// Training off real user data (ASK_JOURVANCE_PLAN.md, Wave 2, S3 and S3b). Pure: no I/O. The route
// module (server/routes/aiAssistantRoutes.mjs) reads the stores, hands the rows in and sends what
// comes out.
//
// compileWhatWorked renders one user's `what-worked.md` for THEIR private corpus on the hub: per
// journey, what was measured over the last 90 days, with the funnel stats route's own ownership
// predicates. Facts only, no advice, no customer name, email or phone, every number computed here.
//
// compileAppPatterns renders `jourvance-patterns-YYYY-MM.md` for Jourvance's APP corpus: ten point
// bands around the medians, by journey goal and traffic source, for a group of at least
// PATTERN_MIN_USERS accounts with PATTERN_MIN_ACCOUNT_VISITS visits each, and no total or exact
// figure. A band is printed only when leaving out any ONE account keeps the median in the same band,
// so the printed band never depends on one account's figure (W3.C). It reads only numbers and two
// fixed lists of words, so no uid, name, email, slug or domain in its input can reach its output.
//
// compileShapeLearns (W3.C) turns each journey that earned at least SHAPE_MIN_VISITS visits and
// SHAPE_MIN_ORDERS orders into one learn for the hub's shared brain: a prompt built only from fixed
// words (the goal, the traffic source, the twelve step variants of src/lib/stepKinds.ts, a count
// spelled out) and a ten point band. Nothing typed by the user, no name, slug, id, url or exact figure.
//
// This file carries no em dash and no en dash, in strings or in comments.

import crypto from 'crypto';
// The funnel stats route's own people count and rate (server/routes/analyticsRoutes.mjs:39, :51).
import { countPeople, rateOr } from './routes/analyticsRoutes.mjs';
import { EVENTS_KEPT, dayKey } from './assistantContext.mjs';

export const WHAT_WORKED_FILE = 'what-worked.md';
export const WHAT_WORKED_MAX_CHARS = 16000;
export const TRAINING_WINDOW_DAYS = 90;
/** At most one what-worked.md send per user per UTC day. */
export const TRAINING_PER_DAY = 1;
/**
 * k-anonymity for the app patterns: a group needs this many accounts, each with this many visits.
 * 25 since W3.C (it was 10): a colluder needs 24 accounts of their own, each with real visits.
 */
export const PATTERN_MIN_USERS = 25;
export const PATTERN_MIN_ACCOUNT_VISITS = 20;
/** A rate whose middle half spreads wider than this many points prints "varies widely". */
export const PATTERN_WIDE_IQR = 40;
/** what-worked.md considers only this many journeys, the most recently updated. */
export const TRAINING_JOURNEYS_MAX = 200;
export const PATTERN_GOALS = Object.freeze(['leads', 'sales']);
export const PATTERN_PLATFORMS = Object.freeze(['meta', 'google', 'tiktok', 'organic']);

// ---- Shape learns (W3.C) ----
/** The learn kind every journey shape is sent as. */
export const SHAPE_KIND = 'journey-shape';
/**
 * A journey teaches its shape only with this many visits and this many orders inside the window, so
 * the band is a measurement and not noise: the 95% interval around 5 orders in 50 visits runs from 4.3
 * to 21.4 points, wider than the ten point band it would print; around 20 in 200 it runs from 6.6 to
 * 14.9 (W3.C adversary round).
 */
export const SHAPE_MIN_VISITS = 200;
export const SHAPE_MIN_ORDERS = 20;
/** At most this many shape learns per user per UTC day (claimed on the thread before any send). */
export const SHAPE_LEARNS_PER_DAY = 3;
/**
 * At most this many shape learns per UTC day for the whole app, claimed in one app-store document, so
 * shapes can never use up the hub's per-app learn cap (200 a day) and starve the question shares.
 */
export const SHAPE_LEARNS_APP_PER_DAY = 100;
/** A shape this spoke sent is not sent again for this many days. */
export const SHAPE_RESEND_DAYS = 30;
/** The thread keeps this many sent shapes: SHAPE_LEARNS_PER_DAY for SHAPE_RESEND_DAYS days. */
export const SHAPE_LEARNS_KEPT = 90;
/** The niche of a journey whose businessType is not one of BUSINESS_TYPES. */
export const SHAPE_GENERAL_NICHE = 'general';
/**
 * The business types a shape's niche may name. Jourvance has no fixed list: a journey's businessType
 * is free text (the Draft with AI brief is a text input, src/components/modals/AiJourneyBuilder.tsx),
 * so anything else is 'general' and nothing a user typed can become a niche. The app's own defaults
 * differ by screen (App.tsx stamps 'E-Commerce Brand' on a new journey, defaultBlueprint.ts uses
 * 'Professional & Local Services', SequenceEditor.tsx falls back to 'E-Commerce Store'); this list
 * holds the one value W3.C named, and widening it is a product decision.
 */
export const BUSINESS_TYPES = Object.freeze(['E-Commerce Store']);

const DAY_MS = 86400000;
/** The date in the window line. The sha is taken with this token in place, so a day passing alone never re-sends. */
const DATE_TOKEN = '{{AS_OF_DATE}}';
const NAME_MAX = 120;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fmt = (n) => Number(n).toLocaleString('en-US');
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const timeOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * The 90 day window: its cutoff and the in-range test, written as the stats route writes it
 * (server/routes/analyticsRoutes.mjs:767-771): an undated row cannot be placed, so it is left out.
 */
export function trainingWindow(now = Date.now()) {
  const cutoff = now - TRAINING_WINDOW_DAYS * DAY_MS;
  const inWindow = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) && t >= cutoff;
  };
  return { cutoff, inWindow };
}

/**
 * True when the event store's cap may have dropped visits inside the window for this user. Two rules,
 * either one is enough, so the file never claims a complete count it does not have:
 * - the stats route's rule (analyticsRoutes.mjs:783-794): the whole store is at the cap and its
 *   oldest row is inside the window;
 * - the rule recordEvent in server.mjs actually trims by (trimLastPerOwner, at most EVENTS_KEPT
 *   rows per userId): this user holds that many rows and their oldest is inside the window.
 */
export function eventsPartial(events, uid, cutoff) {
  if (!Array.isArray(events)) return false;
  const oldestOf = (rows) => {
    let oldest = Infinity;
    for (const e of rows) {
      const t = Date.parse(e?.at || '');
      if (Number.isFinite(t) && t < oldest) oldest = t;
    }
    return oldest;
  };
  if (events.length >= EVENTS_KEPT) {
    const oldest = oldestOf(events);
    if (Number.isFinite(oldest) && oldest > cutoff) return true;
  }
  const mine = events.filter((e) => e && e.userId === uid);
  if (mine.length >= EVENTS_KEPT) {
    const oldest = oldestOf(mine);
    if (Number.isFinite(oldest) && oldest > cutoff) return true;
  }
  return false;
}

/** A journey's goal, from a fixed list: its own goal when it is one, else what its steps say, else ''. */
export function journeyGoal(journey) {
  const g = typeof journey?.goal === 'string' ? journey.goal.trim().toLowerCase() : '';
  if (PATTERN_GOALS.includes(g)) return g;
  const nodes = Array.isArray(journey?.nodes) ? journey.nodes.filter(isPlainObject) : [];
  if (nodes.some((n) => n.type === 'lead-form' || (n.type === 'landing-page' && n.data?.checkoutMode === 'lead-gate'))) return 'leads';
  if (nodes.some((n) => n.type === 'upsell' || (n.type === 'landing-page' && n.data?.checkoutMode === 'direct'))) return 'sales';
  return '';
}

/** The traffic source of a journey's first ad step, from a fixed list, or ''. */
export function journeyPlatform(journey) {
  const nodes = Array.isArray(journey?.nodes) ? journey.nodes.filter(isPlainObject) : [];
  const ad = nodes.find((n) => n.type === 'ad-source');
  const p = typeof ad?.data?.platform === 'string' ? ad.data.platform : '';
  return PATTERN_PLATFORMS.includes(p) ? p : '';
}

/**
 * A journey name as a line of text, with anything shaped like an address, a link, a domain or a long
 * number taken out: an email, an http link, a host with a path, a host on a common ending, a dialled
 * number with separators, and any run of seven or more digits (a phone, an order number, a code).
 */
function nameLine(journey) {
  const raw = typeof journey?.name === 'string' && journey.name.trim()
    ? journey.name
    : (typeof journey?.metadata?.name === 'string' ? journey.metadata.name : '');
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/\S+\.\S+\/\S+/g, '[link]')
    .replace(/\S+\.(?:com|net|org|io|co|app|shop|store|dev)\b\S*/gi, '[link]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
    .replace(/\S*\d{7,}\S*/g, '[number]')
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned || 'Untitled Journey';
}

/**
 * The biggest fall between two measured stages in a row, or null. Stages are visits, then leads when
 * the journey collects them, then orders when it sells. The fall is the share of the earlier stage
 * that the later one does not reach; a stage of 0 has nothing to fall from.
 */
export function biggestDrop(stages) {
  let best = null;
  for (let i = 0; i + 1 < stages.length; i++) {
    const a = stages[i];
    const b = stages[i + 1];
    if (!(a.n > 0) || !(b.n < a.n)) continue;
    const share = rateOr(a.n - b.n, a.n);
    if (share === null) continue;
    if (!best || share > best.share) best = { from: a.name, to: b.name, fromN: a.n, toN: b.n, share };
  }
  return best;
}

/**
 * Every figure for the given journeys in ONE pass over the events, one over the orders and one over
 * the pages, with the funnel stats route's ownership predicates:
 * - events: e.userId === uid && e.journeyId === id, inside the window (analyticsRoutes.mjs:782);
 * - pages: page.userId === uid && page.journeyId === id (ownsPage, analyticsRoutes.mjs:796, :798);
 * - orders: an attributedSlug whose page this user owns on that journey, inside the window
 *   (analyticsRoutes.mjs:797), AND, where the order carries a userId, that userId is this user.
 *   This is stricter than the stats route on purpose: a slug reused after its page changed hands
 *   left an older order of another account on a page this user now owns, and the stats route still
 *   counts it there (left alone here, named so the two can be compared).
 * A total that is not finite (a price that will not parse, a sum that overflows) is skipped.
 * Answers Map(journeyId -> { visits, leads, orders, revenue, live }); a figure not read is null.
 */
export function figuresByJourney({ uid, journeyIds, events, orders, pages, inWindow }) {
  const ids = new Set(journeyIds);
  const pagesRead = isPlainObject(pages);
  const byId = new Map();
  for (const id of ids) byId.set(id, { views: [], leads: [], orders: Array.isArray(orders) && pagesRead ? 0 : null, revenue: Array.isArray(orders) && pagesRead ? 0 : null, live: pagesRead ? 0 : null });
  if (pagesRead) {
    for (const page of Object.values(pages)) {
      if (page && typeof page === 'object' && page.userId === uid && ids.has(page.journeyId)) byId.get(page.journeyId).live += 1;
    }
  }
  if (Array.isArray(events)) {
    for (const e of events) {
      if (!e || e.userId !== uid || !ids.has(e.journeyId)) continue;
      if (e.type !== 'page_view' && e.type !== 'lead') continue;
      if (!inWindow(e.at)) continue;
      const row = byId.get(e.journeyId);
      (e.type === 'page_view' ? row.views : row.leads).push(e);
    }
  }
  if (Array.isArray(orders) && pagesRead) {
    for (const o of orders) {
      if (!o || !o.attributedSlug) continue;
      if (o.userId !== undefined && o.userId !== null && o.userId !== '' && o.userId !== uid) continue;
      const page = pages[o.attributedSlug];
      if (!page || typeof page !== 'object' || page.userId !== uid || !ids.has(page.journeyId)) continue;
      if (!inWindow(o.createdAt)) continue;
      const row = byId.get(page.journeyId);
      row.orders += 1;
      const price = Number(o.totalPrice || 0);
      if (Number.isFinite(price)) row.revenue += price;
    }
  }
  const out = new Map();
  for (const [id, row] of byId) {
    const revenue = row.revenue === null || !Number.isFinite(row.revenue) ? null : Number(row.revenue.toFixed(2));
    out.set(id, {
      visits: Array.isArray(events) ? countPeople(row.views) : null,
      leads: Array.isArray(events) ? countPeople(row.leads) : null,
      orders: row.orders,
      revenue,
      live: row.live
    });
  }
  return out;
}

function journeySection(journey, f) {
  const goal = journeyGoal(journey);
  const platform = journeyPlatform(journey);
  const nodes = Array.isArray(journey?.nodes) ? journey.nodes.filter(isPlainObject) : [];
  const lines = [`### ${nameLine(journey)}`];
  const head = [
    goal ? `Goal: ${goal}.` : 'Goal: not set.',
    platform ? `Traffic source: ${platform}.` : 'Traffic source: no ad step.',
    f.live === null ? 'Published: not read.' : f.live > 0 ? `Published: yes, ${fmt(f.live)} live ${f.live === 1 ? 'page' : 'pages'}.` : 'Published: no.'
  ];
  lines.push(head.join(' '));
  if (f.visits === null) {
    lines.push('Visits and leads: not read.');
  } else {
    const leadRate = rateOr(f.leads, f.visits);
    lines.push(`Visits: ${fmt(f.visits)} people. Leads: ${fmt(f.leads)} people${leadRate === null ? '' : `, a lead rate of ${leadRate}%`}.`);
  }
  if (f.orders === null) {
    lines.push('Orders and revenue: not read.');
  } else {
    const orderRate = f.visits === null ? null : rateOr(f.orders, f.visits);
    lines.push(`Orders: ${fmt(f.orders)}${orderRate === null ? '' : `, an order rate of ${orderRate}%`}.${f.revenue === null ? '' : ` Revenue: ${money(f.revenue)}.`}`);
  }
  if (f.visits !== null) {
    const collectsLeads = goal === 'leads' || f.leads > 0 || nodes.some((n) => n.type === 'lead-form');
    const sells = goal === 'sales' || (f.orders !== null && f.orders > 0);
    const stages = [{ name: 'visits', n: f.visits }];
    if (collectsLeads) stages.push({ name: 'leads', n: f.leads });
    if (sells && f.orders !== null) stages.push({ name: 'orders', n: f.orders });
    const drop = biggestDrop(stages);
    if (drop) lines.push(`Biggest drop: from ${drop.from} (${fmt(drop.fromN)}) to ${drop.to} (${fmt(drop.toN)}), ${drop.share}% fewer.`);
    else if (stages.length > 1) lines.push('Biggest drop: none measured.');
  }
  return lines.join('\n');
}

function emailSection(emailStats) {
  if (!isPlainObject(emailStats)) return null;
  const sent = finite(emailStats.sent);
  const opened = finite(emailStats.opened);
  const clicked = finite(emailStats.clicked);
  const unsubscribed = finite(emailStats.unsubscribed);
  const revenue = finite(emailStats.revenue);
  if (sent === null && opened === null && clicked === null && unsubscribed === null && revenue === null) return 'No email or text was recorded as sent.';
  const part = (label, n, rateLabel) => {
    if (n === null) return `${label}: none recorded.`;
    const r = sent === null ? null : rateOr(n, sent);
    return `${label}: ${fmt(n)}${r === null ? '' : `, ${rateLabel} of ${r}%`}.`;
  };
  return [
    sent === null ? 'Sent: none recorded.' : `Sent: ${fmt(sent)}.`,
    part('Opened', opened, 'an open rate'),
    part('Clicked', clicked, 'a click rate'),
    part('Unsubscribed', unsubscribed, 'an unsubscribe rate'),
    revenue === null ? 'Revenue from email: none recorded.' : `Revenue from email: ${money(revenue)}.`
  ].join(' ');
}

function contactSection(contacts, inWindow) {
  if (!Array.isArray(contacts)) return null;
  let joined = 0;
  let undated = 0;
  for (const c of contacts) {
    const at = c?.firstSeenAt || c?.subscribedAt || '';
    if (!Number.isFinite(Date.parse(at))) undated += 1;
    else if (inWindow(at)) joined += 1;
  }
  const parts = [`Contacts: ${fmt(contacts.length)}.`, `Joined in these ${TRAINING_WINDOW_DAYS} days: ${fmt(joined)}.`];
  if (undated) parts.push(`Without a join date: ${fmt(undated)}.`);
  return parts.join(' ');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * One user's what-worked.md. Answers { content, sha, unavailable, row, journeys }:
 * - content: the file, under WHAT_WORKED_MAX_CHARS, or '' when there is nothing to say;
 * - sha: of the file with the date token in place, so only a change in the figures re-sends it;
 * - unavailable: the inputs that could not be read (null in, named here, never counted as 0);
 * - row: the numbers compileAppPatterns reads (goal, platform, visits, leads, orders per journey,
 *   and the email counts), or null when anything was unavailable;
 * - journeys: how many journey sections the file holds;
 * - figures: figuresByJourney's Map for the journeys considered, so compileShapeLearns reads the same
 *   counts without a second pass over the events.
 * Only the TRAINING_JOURNEYS_MAX most recently updated journeys are considered, the events, orders
 * and pages are each read once, and sections are cut by running length, so the cost is one pass.
 * `journeysComplete: false` means the journey store answered only part of the list.
 */
export function compileWhatWorked({
  uid,
  journeys,
  journeysComplete = true,
  events,
  orders,
  contacts,
  emailStats,
  publicPages,
  now = Date.now()
} = {}) {
  const { cutoff, inWindow } = trainingWindow(now);
  const unavailable = [];
  if (!Array.isArray(journeys) || journeysComplete === false) unavailable.push('journeys');
  if (!Array.isArray(events)) unavailable.push('events');
  if (!Array.isArray(orders)) unavailable.push('orders');
  if (!isPlainObject(publicPages)) unavailable.push('publicPages');
  if (!Array.isArray(contacts)) unavailable.push('contacts');
  if (!isPlainObject(emailStats)) unavailable.push('email');

  const pages = isPlainObject(publicPages) ? publicPages : null;
  const own = (Array.isArray(journeys) ? journeys : [])
    // listJourneys already filters by owner; this checks again, so a stray row never counts.
    .filter((j) => isPlainObject(j) && j.userId === uid && typeof j.id === 'string' && j.id)
    .map((j, i) => ({ j, i, t: timeOf(j.updatedAt) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.j);
  const mine = own.slice(0, TRAINING_JOURNEYS_MAX);
  const byJourney = figuresByJourney({ uid, journeyIds: mine.map((j) => j.id), events, orders, pages, inWindow });
  const figures = mine.map((j) => ({ j, f: byJourney.get(j.id) }));

  const email = emailSection(emailStats);
  const contactLine = contactSection(contacts, inWindow);
  const emailSent = isPlainObject(emailStats) && [emailStats.sent, emailStats.opened, emailStats.clicked].some((v) => finite(v) !== null);
  const nothing = !own.length && !emailSent && !(Array.isArray(contacts) && contacts.length);
  const row = unavailable.length
    ? null
    : {
        journeys: figures.map(({ j, f }) => ({ goal: journeyGoal(j), platform: journeyPlatform(j), visits: f.visits, leads: f.leads, orders: f.orders })),
        email: { sent: finite(emailStats.sent), opened: finite(emailStats.opened), clicked: finite(emailStats.clicked) }
      };
  if (nothing) return { content: '', sha: '', unavailable, row, journeys: 0, figures: byJourney };

  const head = [
    '# What worked for this account',
    '',
    `Measured by Jourvance over the ${TRAINING_WINDOW_DAYS} days to ${DATE_TOKEN}. Every figure is counted in code from this account's own visits, sign-ups, orders and email events, and each person is counted once.`
  ];
  if (eventsPartial(events, uid, cutoff)) head.push('Some visits in this window are missing: the event log keeps a fixed number of the newest events.');
  const tail = [];
  if (email !== null) tail.push('', '## Email', email);
  if (contactLine !== null) tail.push('', '## Contacts', contactLine);
  if (unavailable.length) tail.push('', '## Not read', `These could not be read, so their figures are missing, never zero: ${unavailable.join(', ')}.`);

  // Sections are kept in order while the running length fits, with room held for the date, the
  // headers and the line that counts what was left out. No re-render loop.
  const date = dayKey(now);
  const fixed = [...head, '', '## Journeys', '', ...tail].join('\n').length + (date.length - DATE_TOKEN.length) + 120;
  const sections = [];
  let used = fixed;
  for (const { j, f } of figures) {
    const section = journeySection(j, f);
    const cost = section.length + 2;
    if (used + cost > WHAT_WORKED_MAX_CHARS) break;
    sections.push(section);
    used += cost;
  }
  const left = own.length - sections.length;
  const out = [...head];
  if (own.length) {
    out.push('', '## Journeys');
    if (sections.length) out.push('', sections.join('\n\n'));
    if (left > 0) out.push('', `${fmt(left)} older ${left === 1 ? 'journey is' : 'journeys are'} not listed here.`);
  }
  out.push(...tail);
  const template = out.join('\n').trim() + '\n';
  let content = template.replace(DATE_TOKEN, date);
  // The budget above holds room for every fixed part, so this only guards a future change.
  if (content.length > WHAT_WORKED_MAX_CHARS) content = content.slice(0, WHAT_WORKED_MAX_CHARS);
  return { content, sha: sha256(template), unavailable, row, journeys: sections.length, figures: byJourney };
}

// ---- The app patterns (S3b) ----

const PLATFORM_WORDS = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', organic: 'organic traffic', none: 'no ad step' };
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** A whole number from 0 to 99 in words ("twenty-five"), or '' for anything else. */
export function numberWord(n) {
  if (!Number.isInteger(n) || n < 0 || n > 99) return '';
  if (n < 20) return ONES[n];
  return n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[n / 10];
}

/** The value at quantile p of sorted numbers, interpolated between neighbours. */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The ten point band that holds one value, floored to ten and kept inside 0 to 100: "20 to 30%". */
export function bandLabel(value) {
  const lo = Math.min(90, Math.max(0, Math.floor(value / 10) * 10));
  return `${lo} to ${lo + 10}%`;
}

/**
 * The printed form of one rate across a group's accounts. Two rules, in this order:
 * - "varies widely" when the middle half of the accounts spreads wider than PATTERN_WIDE_IQR points;
 * - the ten point band that holds the median ("20 to 30%"), printed only when the median of every
 *   set left after taking out any ONE account falls in that same band; otherwise "varies".
 * Never the median itself. The second rule (W3.C) means the printed band is the band every group
 * without one account agrees on, so a band can never be the one a single account decided: a colluder
 * who places the other accounts on both sides of a band edge, so that one victim's value picks the
 * band, gets "varies". What it cannot hide is WHETHER a band prints: around a colluder's chosen edge
 * that choice can still turn on the victim's value (one yes or no per rate a month), which
 * assistant-training.test.mjs pins as a named residual. A single value has no stable band: "varies".
 */
export function rateBand(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (quantile(v, 0.75) - quantile(v, 0.25) > PATTERN_WIDE_IQR) return 'varies widely';
  const band = bandLabel(quantile(v, 0.5));
  for (let i = 0; i < v.length; i++) {
    // Taking out equal values leaves the same set, so each distinct value is tried once.
    if (i > 0 && v[i] === v[i - 1]) continue;
    const rest = v.slice(0, i).concat(v.slice(i + 1));
    if (!rest.length || bandLabel(quantile(rest, 0.5)) !== band) return 'varies';
  }
  return band;
}

/**
 * jourvance-patterns-YYYY-MM.md from per-user rows (compileWhatWorked's `row`). Answers
 * { filename, content, groups, accounts }; content is '' when no group passes the rule.
 *
 * Only `goal` and `platform` (each matched against a fixed list) and finite numbers are read from a
 * row, so nothing else in it can reach the file. A row that names a uid is counted once however often
 * it appears. Each account adds its journeys in a group together and counts once in it.
 *
 * k-anonymity, after an adversary showed four accounts at 0% and 100% around one victim print the
 * victim's exact median: a group is kept only with PATTERN_MIN_USERS distinct accounts, each with at
 * least PATTERN_MIN_ACCOUNT_VISITS visits (an account under that neither counts nor shapes a median);
 * the file prints no total and no exact figure, only "25 or more" accounts and a ten point band per
 * rate that survives leaving out any one account (rateBand), or "varies", or "varies widely"; the
 * email bands need the same number of accounts that sent email.
 */
export function compileAppPatterns(perUser, { now = Date.now() } = {}) {
  const month = dayKey(now).slice(0, 7);
  const filename = `jourvance-patterns-${month}.md`;
  const seen = new Set();
  const rows = [];
  for (const u of Array.isArray(perUser) ? perUser : []) {
    if (!isPlainObject(u)) continue;
    if (typeof u.uid === 'string' && u.uid) {
      if (seen.has(u.uid)) continue;
      seen.add(u.uid);
    }
    rows.push(u);
  }

  const groups = new Map();
  for (const u of rows) {
    const mail = isPlainObject(u.email) ? u.email : {};
    const sent = count(mail.sent);
    const openRate = sent > 0 && count(mail.opened) !== null ? (Math.min(count(mail.opened), sent) / sent) * 100 : null;
    const clickRate = sent > 0 && count(mail.clicked) !== null ? (Math.min(count(mail.clicked), sent) / sent) * 100 : null;
    const mineByGroup = new Map();
    for (const j of Array.isArray(u.journeys) ? u.journeys : []) {
      if (!isPlainObject(j)) continue;
      const goal = PATTERN_GOALS.includes(j.goal) ? j.goal : null;
      if (!goal) continue;
      const platform = PATTERN_PLATFORMS.includes(j.platform) ? j.platform : 'none';
      const visits = count(j.visits);
      const leads = count(j.leads);
      const orders = count(j.orders);
      if (visits === null || leads === null || orders === null) continue;
      const key = `${goal}|${platform}`;
      const acc = mineByGroup.get(key) || { goal, platform, visits: 0, leads: 0, orders: 0 };
      acc.visits += visits;
      acc.leads += leads;
      acc.orders += orders;
      mineByGroup.set(key, acc);
    }
    for (const [key, acc] of mineByGroup) {
      if (!(acc.visits >= PATTERN_MIN_ACCOUNT_VISITS)) continue;
      const g = groups.get(key) || { goal: acc.goal, platform: acc.platform, accounts: [] };
      g.accounts.push({
        leadRate: (Math.min(acc.leads, acc.visits) / acc.visits) * 100,
        orderRate: (Math.min(acc.orders, acc.visits) / acc.visits) * 100,
        openRate,
        clickRate
      });
      groups.set(key, g);
    }
  }

  const platformOrder = Object.keys(PLATFORM_WORDS);
  const kept = [...groups.values()]
    .filter((g) => g.accounts.length >= PATTERN_MIN_USERS)
    .sort((a, b) => PATTERN_GOALS.indexOf(a.goal) - PATTERN_GOALS.indexOf(b.goal) || platformOrder.indexOf(a.platform) - platformOrder.indexOf(b.platform));
  if (!kept.length) return { filename, content: '', groups: 0, accounts: rows.length };

  const out = [
    `# Jourvance patterns for ${month}`,
    '',
    `Medians across Jourvance accounts over the last ninety days, by journey goal and traffic source. A group is listed only when it holds at least ${numberWord(PATTERN_MIN_USERS)} accounts with at least ${numberWord(PATTERN_MIN_ACCOUNT_VISITS)} visits each. Each figure is a ten point band that holds the median, printed only when leaving out any one account keeps the median in that same band; otherwise it reads "varies", so no single account can decide a band. A figure reads "varies widely" when the middle half of the accounts spreads wider than ${numberWord(PATTERN_WIDE_IQR)} points. Lead and order rates are shares of visits; email rates are shares of emails sent. A group of colluding accounts that outnumbers the honest ones can learn an honest account's band over several months; the rule here raises the cost, it does not remove it.`
  ];
  for (const g of kept) {
    const opens = g.accounts.map((a) => a.openRate).filter((x) => x !== null);
    const clicks = g.accounts.map((a) => a.clickRate).filter((x) => x !== null);
    out.push('', `## Goal ${g.goal}, ${PLATFORM_WORDS[g.platform]}`);
    out.push(`Accounts: ${PATTERN_MIN_USERS} or more.`);
    out.push(`Median lead rate: ${rateBand(g.accounts.map((a) => a.leadRate))}. Median order rate: ${rateBand(g.accounts.map((a) => a.orderRate))}.`);
    if (opens.length >= PATTERN_MIN_USERS) {
      out.push(`Median email open rate: ${rateBand(opens)}. Median email click rate: ${clicks.length >= PATTERN_MIN_USERS ? rateBand(clicks) : 'not shown'}.`);
    } else {
      out.push(`Email rates: not shown, fewer than ${numberWord(PATTERN_MIN_USERS)} of these accounts sent email.`);
    }
  }
  return { filename, content: out.join('\n').trim() + '\n', groups: kept.length, accounts: rows.length };
}

/**
 * The accounts with something to train on: the userIds on events or orders inside the window, most
 * events first. Rows with no userId are nobody's and never counted.
 */
export function activeAccounts({ events, orders, now = Date.now() } = {}) {
  const { inWindow } = trainingWindow(now);
  const tally = new Map();
  const add = (uid, n) => {
    if (typeof uid !== 'string' || !uid) return;
    tally.set(uid, (tally.get(uid) || 0) + n);
  };
  for (const e of Array.isArray(events) ? events : []) if (e && inWindow(e.at)) add(e.userId, 1);
  for (const o of Array.isArray(orders) ? orders : []) if (o && inWindow(o.createdAt)) add(o.userId, 0);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([uid]) => uid);
}

// ---- Shape learns: results teach the main brain (W3.C) ----

// The twelve step variants, a SERVER copy of stepVariant in src/lib/stepKinds.ts (a browser module the
// server cannot import). assistant-training.test.mjs pins this copy equal to that function over every
// node type and every sequenceType, so the two cannot drift. Maps, so a saved sequenceType such as
// 'constructor' cannot reach an object's prototype.
export const STEP_VARIANTS = Object.freeze(['ad', 'page', 'form', 'nurture', 'upsell-rescue', 'cart-recovery', 'winback', 'review', 'thank-you', 'upsell', 'downsell', 'split']);
const SEQUENCE_VARIANTS = new Map([
  ['upsell_recovery', 'upsell-rescue'],
  ['checkout_recovery', 'cart-recovery'],
  ['at_risk_winback', 'winback'],
  ['fulfillment_review', 'review'],
  ['lead_nurture', 'nurture']
]);
const TYPE_VARIANTS = new Map([
  ['ad-source', 'ad'],
  ['landing-page', 'page'],
  ['lead-form', 'form'],
  ['thank-you', 'thank-you'],
  ['ab-split', 'split']
]);

/** The step's variant name, exactly as stepVariant in src/lib/stepKinds.ts answers it, or null. */
export function stepVariantOf(type, data) {
  const d = data && typeof data === 'object' ? data : {};
  const t = typeof type === 'string' ? type : d.type;
  if (typeof t !== 'string') return null;
  if (t === 'upsell') return d.offerType === 'downsell' ? 'downsell' : 'upsell';
  // An unknown or missing sequenceType is a nurture sequence, as SequenceNode draws it.
  if (t === 'follow-up-sequence') return SEQUENCE_VARIANTS.get(String(d.sequenceType)) ?? 'nurture';
  return TYPE_VARIANTS.get(t) ?? null;
}

// The canvas order is the app's own: orderSteps in src/lib/stepNavigation.ts (the order the step
// finder and the Previous and Next walk use): the main path first, then retention flows, each left to
// right, then top to bottom, then by id so ties never shuffle. Copied here (the server cannot import
// it) and pinned equal to it in the test. One difference, for determinism only: a position that is
// not a finite number reads as 0, where the client's comparison would answer NaN for it.
const RETENTION_SEQUENCES = new Set(['upsell_recovery', 'checkout_recovery', 'at_risk_winback']);
const isRetentionStep = (data) => Boolean(data?.isRetentionBranch || RETENTION_SEQUENCES.has(String(data?.sequenceType)));
const coord = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const idOf = (n) => (typeof n?.id === 'string' ? n.id : '');

/** A journey's nodes in canvas order (see above). */
export function canvasOrder(nodes) {
  return (Array.isArray(nodes) ? nodes.filter(isPlainObject) : []).sort((a, b) => {
    const group = Number(isRetentionStep(a.data)) - Number(isRetentionStep(b.data));
    if (group !== 0) return group;
    const x = Math.round(coord(a.position?.x)) - Math.round(coord(b.position?.x));
    if (x !== 0) return x;
    const y = coord(a.position?.y) - coord(b.position?.y);
    if (y !== 0) return y;
    const ia = idOf(a);
    const ib = idOf(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

const SHAPE_SOURCE_WORDS = Object.freeze({ meta: 'Meta', google: 'Google', tiktok: 'TikTok', organic: 'organic traffic', none: 'an unnamed source' });
const SHAPE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * A rate's ten point band in words, with no digit: "thirty to forty", "zero to ten", "ninety to one
 * hundred". The hub turns every digit run of a shared pattern into N (scrubLearnPattern), so a band in
 * digits reached the main brain as "N to N" and every band of one shape folded into one dedupe key.
 */
export function bandWords(value) {
  const lo = Math.min(90, Math.max(0, Math.floor(value / 10) * 10));
  const hi = lo + 10;
  return `${numberWord(lo)} to ${hi === 100 ? 'one hundred' : numberWord(hi)}`;
}

/** A step count as the prompt says it: the number in words up to twenty, "more than twenty" above. */
export function stepCountWord(n) {
  return n > 20 ? 'more than twenty' : numberWord(n);
}

/** An order rate in percent, orders capped at visits, the way compileAppPatterns reads one. */
const orderRateOf = (f) => (Math.min(f.orders, f.visits) / f.visits) * 100;

/**
 * One learn row per journey that earned at least SHAPE_MIN_VISITS visits and SHAPE_MIN_ORDERS orders
 * in the window, from figuresByJourney's Map (compileWhatWorked answers it as `figures`, so the events
 * are read once; the window is already applied there, so `now` is not read again here). Answers
 * { rows: [{ kind, niche, prompt, rating, sha, journeyId }], skipped: { fewVisits, fewOrders, noShape } }.
 *
 * The prompt is built ONLY from fixed words and a band, and holds no digit:
 *   "Orders per hundred visits: <band>. A <goal> journey from <source> with <count> steps: <variant>
 *   then <variant>."
 * the order rate's ten point band in words (bandWords), FIRST so the hub's 220 character cut never
 * drops it; goal from PATTERN_GOALS (else 'general'), source from PATTERN_PLATFORMS, the variants of
 * stepVariantOf in canvasOrder (a step of no known type is left out), and the count in words. No
 * name, slug, id, url, headline, exact figure, digit or anything typed.
 * rating: 5 when this journey's order rate is at least twice the median order rate of this account's
 * journeys with SHAPE_MIN_VISITS or more visits (a median of at least two journeys), else 4.
 * niche: the journey's businessType when it is one of `businessTypes`, else 'general'.
 * sha: sha256 of kind, niche and prompt, one per line; two journeys of the same shape are one row.
 * Rows come highest rating first, then highest order rate, then journey id.
 */
export function compileShapeLearns({ uid, journeys, figures, businessTypes = BUSINESS_TYPES } = {}) {
  const skipped = { fewVisits: 0, fewOrders: 0, noShape: 0 };
  const byId = figures instanceof Map ? figures : new Map();
  const allowed = new Set((Array.isArray(businessTypes) ? businessTypes : []).filter((t) => typeof t === 'string' && t));
  const own = (Array.isArray(journeys) ? journeys : [])
    .filter((j) => isPlainObject(j) && j.userId === uid && typeof j.id === 'string' && j.id && byId.has(j.id));
  const measured = own.map((j) => ({ j, f: byId.get(j.id) || {} }));

  // The account's median order rate, over its journeys with enough visits and a readable order count.
  const rates = measured
    .filter(({ f }) => count(f.visits) !== null && f.visits >= SHAPE_MIN_VISITS && count(f.orders) !== null)
    .map(({ f }) => orderRateOf(f))
    .sort((a, b) => a - b);
  const median = rates.length >= 2 ? quantile(rates, 0.5) : null;

  const candidates = [];
  for (const { j, f } of measured) {
    if (count(f.visits) === null || f.visits < SHAPE_MIN_VISITS) { skipped.fewVisits += 1; continue; }
    if (count(f.orders) === null || f.orders < SHAPE_MIN_ORDERS) { skipped.fewOrders += 1; continue; }
    const steps = canvasOrder(j.nodes).map((n) => stepVariantOf(n.type, n.data)).filter(Boolean);
    if (!steps.length) { skipped.noShape += 1; continue; }
    const rate = orderRateOf(f);
    const goal = journeyGoal(j) || 'general';
    const source = SHAPE_SOURCE_WORDS[journeyPlatform(j) || 'none'];
    // The band first, so the hub's 220 character cut of a shared pattern never drops it; no digit anywhere.
    const prompt = `Orders per hundred visits: ${bandWords(rate)}. A ${goal} journey from ${source} with ${stepCountWord(steps.length)} ${steps.length === 1 ? 'step' : 'steps'}: ${steps.join(' then ')}.`;
    const type = typeof j.businessType === 'string' ? j.businessType.trim() : '';
    const niche = allowed.has(type) ? type : SHAPE_GENERAL_NICHE;
    const rating = median !== null && rate >= 2 * median ? 5 : 4;
    candidates.push({ row: { kind: SHAPE_KIND, niche, prompt, rating, sha: sha256(`${SHAPE_KIND}\n${niche}\n${prompt}`), journeyId: j.id }, rate });
  }
  candidates.sort((a, b) => b.row.rating - a.row.rating || b.rate - a.rate || (a.row.journeyId < b.row.journeyId ? -1 : a.row.journeyId > b.row.journeyId ? 1 : 0));
  const seen = new Set();
  const rows = [];
  for (const { row } of candidates) {
    if (seen.has(row.sha)) continue;
    seen.add(row.sha);
    rows.push(row);
  }
  return { rows, skipped };
}

const shapeDayMs = (day) => Date.parse(`${day}T00:00:00.000Z`);

/**
 * A thread's shapeLearns cleaned to sha keys and real 'YYYY-MM-DD' days. Given `now`, a day after
 * today is dropped (it would hold a shape back past the thirty days), and so is one SHAPE_RESEND_DAYS
 * or more old, before the newest SHAPE_LEARNS_KEPT are kept; without `now` (cleanThread has no
 * clock) only the count is cut, newest first, so the age rule is applied wherever a decision is made.
 */
export function cleanShapeLearns(value, now) {
  if (!isPlainObject(value)) return {};
  const today = now === undefined ? null : shapeDayMs(dayKey(now));
  const entries = Object.entries(value).filter(([sha, day]) => {
    if (!SHA_RE.test(sha) || typeof day !== 'string' || !SHAPE_DAY_RE.test(day)) return false;
    const ms = shapeDayMs(day);
    // A day that will not parse, or one Date rolls over ('2026-02-30'), is not a day.
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return false;
    return today === null || (ms <= today && today - ms < SHAPE_RESEND_DAYS * DAY_MS);
  });
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(entries.slice(0, SHAPE_LEARNS_KEPT));
}

/** True when this sha was sent today or on a day less than SHAPE_RESEND_DAYS ago. */
export function shapeSentRecently(shapeLearns, sha, now = Date.now()) {
  return Object.hasOwn(cleanShapeLearns(shapeLearns, now), sha);
}

/** shapeLearns with this sha stamped today, aged entries pruned first, then the newest SHAPE_LEARNS_KEPT kept. */
export function recordShapeLearn(shapeLearns, sha, now = Date.now()) {
  return cleanShapeLearns({ ...cleanShapeLearns(shapeLearns, now), [sha]: dayKey(now) }, now);
}

/**
 * Today's shape count on a thread: 0 when there is no count for today, and the whole cap, never a
 * zero, for anything that is not a finite number of 0 or more (null, '', [], false, a string) or a
 * shapeDays that is not a plain object at all (an array, a string).
 */
function shapesUsedToday(doc, now) {
  const days = isPlainObject(doc) ? doc.shapeDays : undefined;
  if (days === undefined) return 0;
  if (!isPlainObject(days)) return SHAPE_LEARNS_PER_DAY;
  if (!Object.hasOwn(days, dayKey(now))) return 0;
  const used = days[dayKey(now)];
  return typeof used === 'number' && Number.isFinite(used) && used >= 0 ? used : SHAPE_LEARNS_PER_DAY;
}

/** How many shape learns this thread may still send today. */
export function shapeSlotsLeft(doc, now = Date.now()) {
  return Math.max(0, SHAPE_LEARNS_PER_DAY - shapesUsedToday(doc, now));
}

/** shapeDays with today's count raised by n and every other day dropped (countDaily, for n slots). */
export function claimShapeDays(doc, n, now = Date.now()) {
  return { [dayKey(now)]: shapesUsedToday(doc, now) + n };
}
