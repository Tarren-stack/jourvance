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
// figure. It reads only numbers and two fixed lists of words, so no uid, name, email, slug or domain
// in its input can reach its output.
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
/** k-anonymity for the app patterns: a group needs this many accounts, each with this many visits. */
export const PATTERN_MIN_USERS = 10;
export const PATTERN_MIN_ACCOUNT_VISITS = 20;
/** A rate whose middle half spreads wider than this many points prints "varies widely". */
export const PATTERN_WIDE_IQR = 40;
/** what-worked.md considers only this many journeys, the most recently updated. */
export const TRAINING_JOURNEYS_MAX = 200;
export const PATTERN_GOALS = Object.freeze(['leads', 'sales']);
export const PATTERN_PLATFORMS = Object.freeze(['meta', 'google', 'tiktok', 'organic']);

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
 * - journeys: how many journey sections the file holds.
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
  if (nothing) return { content: '', sha: '', unavailable, row, journeys: 0 };

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
  return { content, sha: sha256(template), unavailable, row, journeys: sections.length };
}

// ---- The app patterns (S3b) ----

const PLATFORM_WORDS = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', organic: 'organic traffic', none: 'no ad step' };
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** The value at quantile p of sorted numbers, interpolated between neighbours. */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The printed form of one rate across a group's accounts: the ten point band that holds the median
 * ("20 to 30%"), or "varies widely" when the middle half of the accounts spreads wider than
 * PATTERN_WIDE_IQR points. Never the median itself, so no one account's figure can be read back.
 */
export function rateBand(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (quantile(v, 0.75) - quantile(v, 0.25) > PATTERN_WIDE_IQR) return 'varies widely';
  const m = quantile(v, 0.5);
  const lo = Math.min(90, Math.max(0, Math.floor(m / 10) * 10));
  return `${lo} to ${lo + 10}%`;
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
 * the file prints no total and no exact figure, only "10 or more" accounts and a ten point band per
 * rate, or "varies widely"; the email bands need the same number of accounts that sent email.
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
    'Medians across Jourvance accounts over the last ninety days, by journey goal and traffic source. A group is listed only when it holds at least ten accounts with at least twenty visits each. Each figure is a ten point band that holds the median, or "varies widely" when the middle half of the accounts spreads wider than forty points. Lead and order rates are shares of visits; email rates are shares of emails sent.'
  ];
  for (const g of kept) {
    const opens = g.accounts.map((a) => a.openRate).filter((x) => x !== null);
    const clicks = g.accounts.map((a) => a.clickRate).filter((x) => x !== null);
    out.push('', `## Goal ${g.goal}, ${PLATFORM_WORDS[g.platform]}`);
    out.push('Accounts: 10 or more.');
    out.push(`Median lead rate: ${rateBand(g.accounts.map((a) => a.leadRate))}. Median order rate: ${rateBand(g.accounts.map((a) => a.orderRate))}.`);
    if (opens.length >= PATTERN_MIN_USERS) {
      out.push(`Median email open rate: ${rateBand(opens)}. Median email click rate: ${clicks.length >= PATTERN_MIN_USERS ? rateBand(clicks) : 'not shown'}.`);
    } else {
      out.push('Email rates: not shown, fewer than ten of these accounts sent email.');
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
