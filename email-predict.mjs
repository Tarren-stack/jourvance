/**
 * Predicted value and smart send time from one store's own orders and recorded opens.
 * A store under the minimums produces no prediction row. Send time uses the
 * recipient hour, the store hour, the hour the merchant set, or the next send.
 */
import { isIanaTimezone, isPredictionKey } from './email-flows.mjs';

export const MIN_ORDERS = 50;
export const MIN_REPEAT_CUSTOMERS = 20;
export const MIN_HISTORY_DAYS = 90;
export const MIN_BUCKET = 20;
export const MIN_PERSON_OPENS = 5;
export const MIN_STORE_OPENS = 200;
export const STORE_OPEN_DAYS = 90;
export const CHURN_NOTE = "from this store's repurchase history";
export const METHOD = 'store_gap_curve';

const DAY = 86400000;
const OPEN_TYPES = new Set(['email_opened', 'email_clicked', 'opened', 'clicked']);
const READABLE = new Set(['predictedvalue', 'expectednextorderat', 'predictedvalue365', 'churn']);

export function isReadablePredictionField(field) {
  const flat = String(field || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return READABLE.has(flat);
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

export function orderTime(order) {
  const at = Date.parse(order?.createdAt || '');
  return Number.isFinite(at) ? at : null;
}

export function netOrderValue(order) {
  const total = Number(order?.totalPrice);
  if (!Number.isFinite(total)) return null;
  let net = total;
  for (const refund of Array.isArray(order?.refunds) ? order.refunds : []) {
    if (!refund || refund.amount == null || refund.amount === '') continue;
    const amount = Number(refund.amount);
    if (!Number.isFinite(amount)) continue;
    net -= amount;
  }
  return money(net);
}

export function addRefund(order, refund) {
  const next = { ...(order || {}), refunds: (Array.isArray(order?.refunds) ? order.refunds : []).map((row) => ({ ...row })) };
  const id = String(refund?.id || '').slice(0, 40);
  if (id && next.refunds.some((row) => row.id === id)) return { order: next, added: false };
  const row = { at: String(refund?.at || new Date().toISOString()).slice(0, 40) };
  if (id) row.id = id;
  const amount = Number(refund?.amount);
  if (refund?.amount != null && refund.amount !== '' && Number.isFinite(amount) && amount > 0) row.amount = money(amount);
  next.refunds.push(row);
  return { order: next, added: true };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function byCustomer(orders) {
  const groups = new Map();
  for (const order of orders || []) {
    if (orderTime(order) == null) continue;
    const email = String(order.customerEmail || order.email || '').toLowerCase();
    if (!email.includes('@')) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(order);
  }
  for (const rows of groups.values()) rows.sort((a, b) => orderTime(a) - orderTime(b));
  return groups;
}

function gapsOf(orders) {
  const gaps = [];
  for (let i = 1; i < orders.length; i++) gaps.push((orderTime(orders[i]) - orderTime(orders[i - 1])) / DAY);
  return gaps;
}

function customerGap(orders) {
  return median(gapsOf(orders));
}

function storeGap(groups) {
  const gaps = [];
  for (const orders of groups.values()) {
    if (orders.length < 2) continue;
    const gap = customerGap(orders);
    if (gap != null) gaps.push(gap);
  }
  return median(gaps);
}

function datedOrders(orders) {
  return (orders || []).filter((order) => orderTime(order) != null);
}

export function storeReadiness(orders, now = Date.now()) {
  const rows = datedOrders(orders);
  const times = rows.map(orderTime);
  const oldest = times.length ? Math.min(...times) : null;
  const historyDays = oldest == null ? null : (now - oldest) / DAY;
  let repeatCustomers = 0;
  for (const list of byCustomer(rows).values()) {
    if (list.length >= 2) repeatCustomers += 1;
  }
  const ready = rows.length >= MIN_ORDERS && repeatCustomers >= MIN_REPEAT_CUSTOMERS && historyDays != null && historyDays >= MIN_HISTORY_DAYS;
  return {
    ready,
    orders: rows.length,
    repeatCustomers,
    historyDays,
    oldestAt: oldest == null ? null : new Date(oldest).toISOString()
  };
}

export function missingHistory(readiness) {
  const row = readiness || { orders: 0, repeatCustomers: 0, historyDays: null };
  const parts = [];
  if (row.orders < MIN_ORDERS) parts.push(`at least 50 orders (this account has ${row.orders})`);
  if (row.repeatCustomers < MIN_REPEAT_CUSTOMERS) parts.push(`at least 20 customers with two or more orders (this account has ${row.repeatCustomers})`);
  if (row.historyDays == null || row.historyDays < MIN_HISTORY_DAYS) {
    const seen = row.historyDays == null ? 'no recorded order date' : `${Math.floor(row.historyDays)} days of history`;
    parts.push(`90 days of history (${seen})`);
  }
  return parts.join(', ');
}

export function bucketName(daysSince, gapDays) {
  if (!(gapDays > 0)) return 'over_two';
  const ratio = daysSince / gapDays;
  if (ratio < 0.5) return 'under_half';
  if (ratio < 1) return 'half_to_one';
  if (ratio < 2) return 'one_to_two';
  return 'over_two';
}

export function churnFromRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '';
  if (rate < 0.33) return 'high';
  if (rate <= 0.66) return 'medium';
  return 'low';
}

function ratesAt(groups, now) {
  const cutoff = now - 90 * DAY;
  const priorGroups = new Map();
  for (const [email, orders] of groups) {
    const prior = orders.filter((order) => orderTime(order) <= cutoff);
    if (prior.length) priorGroups.set(email, prior);
  }
  const gapThen = storeGap(priorGroups);
  const buckets = { under_half: [], half_to_one: [], one_to_two: [], over_two: [] };
  for (const [email, orders] of groups) {
    const prior = priorGroups.get(email);
    if (!prior?.length) continue;
    const gap = prior.length >= 3 ? customerGap(prior) : gapThen;
    if (gap == null) continue;
    const days = (cutoff - orderTime(prior[prior.length - 1])) / DAY;
    const again = orders.some((order) => {
      const at = orderTime(order);
      return at > cutoff && at <= now;
    });
    buckets[bucketName(days, gap)].push(again);
  }
  const rates = {};
  for (const [name, rows] of Object.entries(buckets)) {
    if (rows.length >= MIN_BUCKET) rates[name] = rows.filter(Boolean).length / rows.length;
  }
  return rates;
}

function yearShare(groups, now) {
  let observed = 0;
  let again = 0;
  for (const orders of groups.values()) {
    const first = orderTime(orders[0]);
    if (now - first < 365 * DAY) continue;
    observed += 1;
    const second = orders[1] ? orderTime(orders[1]) : null;
    if (second != null && second - first <= 365 * DAY) again += 1;
  }
  if (!observed) return null;
  return { share: again / observed, observed };
}

export function historicSpend(orders) {
  const rows = datedOrders(orders);
  if (!rows.length) return { orderCount: 0, historicValue: null };
  let value = 0;
  let valued = 0;
  for (const order of rows) {
    const net = netOrderValue(order);
    if (net == null) continue;
    value += net;
    valued += 1;
  }
  return { orderCount: rows.length, historicValue: valued ? money(value) : null };
}

export function predictStore(orders, now = Date.now()) {
  const readiness = storeReadiness(orders, now);
  const base = {
    ready: readiness.ready,
    orders: readiness.orders,
    repeatCustomers: readiness.repeatCustomers,
    historyDays: readiness.historyDays,
    oldestAt: readiness.oldestAt,
    missing: readiness.ready ? '' : missingHistory(readiness)
  };
  if (!readiness.ready) return { ...base, method: null, computedAt: null, sampleSize: null, storeGapDays: null, rows: null, rates: {} };
  const groups = byCustomer(datedOrders(orders));
  const gap = storeGap(groups);
  const rates = ratesAt(groups, now);
  const computedAt = new Date(now).toISOString();
  const year = readiness.historyDays >= 365 ? yearShare(groups, now) : null;
  const rows = {};
  for (const [email, list] of groups) {
    const own = list.length >= 3 ? customerGap(list) : null;
    const gapDays = own != null ? own : gap;
    if (gapDays == null) continue;
    const spent = historicSpend(list);
    const last = orderTime(list[list.length - 1]);
    const expected = last + gapDays * DAY;
    const overdue = Math.floor((now - expected) / DAY);
    const bucket = bucketName((now - last) / DAY, gapDays);
    const rate = Object.prototype.hasOwnProperty.call(rates, bucket) ? rates[bucket] : null;
    const row = {
      method: METHOD,
      sampleSize: readiness.orders,
      computedAt,
      gapDays: round4(gapDays),
      orderCount: list.length
    };
    if (spent.historicValue != null) row.historicValue = spent.historicValue;
    row.expectedNextOrderAt = new Date(expected).toISOString();
    if (overdue > 0) row.daysOverdue = overdue;
    if (spent.historicValue != null && list.length) {
      const average = spent.historicValue / list.length;
      if (rate != null) {
        row.repurchaseRate90 = Math.round(rate * 10000) / 10000;
        row.churn = churnFromRate(rate);
        row.churnNote = CHURN_NOTE;
        row.predictedValue = money(average * rate);
      }
      if (year && gap > 0) row.predictedValue365 = money(average * year.share * (365 / gap));
    }
    rows[email] = row;
  }
  return {
    ...base,
    method: METHOD,
    computedAt,
    sampleSize: readiness.orders,
    storeGapDays: gap == null ? null : round4(gap),
    rows,
    rates
  };
}

export function commitPredictions(store, uid, orders, now = Date.now()) {
  const next = { ...(store && typeof store === 'object' ? store : {}) };
  const result = predictStore(orders, now);
  if (!result.ready) delete next[uid];
  else {
    next[uid] = {
      method: METHOD,
      computedAt: result.computedAt,
      sampleSize: result.sampleSize,
      storeGapDays: result.storeGapDays,
      rows: result.rows
    };
  }
  return { store: next, result };
}

export function overlayPrediction(profile, row) {
  const next = { ...(profile || {}) };
  for (const key of Object.keys(next)) {
    if (isPredictionKey(key)) delete next[key];
  }
  if (!row?.computedAt) return next;
  if (row.predictedValue != null) next.predictedValue = row.predictedValue;
  if (row.predictedValue365 != null) next.predictedValue365 = row.predictedValue365;
  if (row.expectedNextOrderAt) next.expectedNextOrderAt = row.expectedNextOrderAt;
  if (row.churn) next.churn = row.churn;
  return next;
}

function trimDays(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function predictionLine(input) {
  const orderCount = Number(input?.orderCount) || 0;
  const parts = [];
  if (orderCount > 0 && input?.historicValue != null) parts.push(`Historic spend $${Number(input.historicValue).toFixed(2)}`);
  if (orderCount > 0) parts.push(`${orderCount} ${orderCount === 1 ? 'order' : 'orders'}`);
  if (input?.computedAt) {
    if (input.gapDays != null) parts.push(`gap ${trimDays(input.gapDays)} days`);
    if (input.sampleSize != null) parts.push(`sample ${input.sampleSize}`);
    parts.push(`computed ${String(input.computedAt).slice(0, 10)}`);
    if (input.predictedValue != null) parts.push(`predicted value $${Number(input.predictedValue).toFixed(2)}`);
  }
  return parts.join(' · ');
}

function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute) };
}

function zonedToUtc(year, month, day, hour, minute, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let pass = 0; pass < 4; pass++) {
    const got = zonedParts(utc, timeZone);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const have = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    const diff = want - have;
    if (diff === 0) return utc;
    utc += diff;
  }
  return utc;
}

function addDay(parts) {
  const at = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

export function hourInZone(at, timeZone) {
  const ms = Date.parse(at || '');
  if (!Number.isFinite(ms)) return null;
  const zone = isIanaTimezone(timeZone) ? timeZone : 'UTC';
  return zonedParts(ms, zone).hour;
}

export function nextHourAt(now, hour, timeZone) {
  const zone = isIanaTimezone(timeZone) ? timeZone : 'UTC';
  const parts = zonedParts(now, zone);
  const today = zonedToUtc(parts.year, parts.month, parts.day, hour, 0, zone);
  if (today > now + 999) return new Date(today).toISOString();
  if (now >= today && now < today + 3600000) return new Date(now).toISOString();
  const next = addDay(parts);
  return new Date(zonedToUtc(next.year, next.month, next.day, hour, 0, zone)).toISOString();
}

export function engagementEvents(events) {
  return (events || []).filter((evt) => OPEN_TYPES.has(String(evt?.type || '')) && Number.isFinite(Date.parse(evt?.at || '')));
}

export function peakHour(events, timeZone) {
  const counts = new Array(24).fill(0);
  let sample = 0;
  for (const evt of engagementEvents(events)) {
    const hour = hourInZone(evt.at, timeZone);
    if (hour == null) continue;
    counts[hour] += 1;
    sample += 1;
  }
  let best = 0;
  let hour = null;
  for (let i = 0; i < 24; i++) {
    if (counts[i] > best) {
      best = counts[i];
      hour = i;
    }
  }
  if (!best) return null;
  return { hour, sampleSize: sample };
}

function mix(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function personEvents(person, events) {
  if (Array.isArray(person?.events)) return engagementEvents(person.events);
  const email = String(person?.email || '').toLowerCase();
  return engagementEvents(events).filter((evt) => String(evt.email || '').toLowerCase() === email);
}

export function smartSendReport(assignments) {
  const recipient = new Map();
  const store = new Map();
  const merchant = new Map();
  const explore = new Map();
  let immediate = 0;
  for (const row of assignments || []) {
    if (row?.rule === 'recipient') recipient.set(row.hour, (recipient.get(row.hour) || 0) + 1);
    else if (row?.rule === 'store') store.set(`${row.hour}:${row.sampleSize}`, (store.get(`${row.hour}:${row.sampleSize}`) || 0) + 1);
    else if (row?.rule === 'merchant') merchant.set(row.hour, (merchant.get(row.hour) || 0) + 1);
    else if (row?.rule === 'explore') explore.set(row.hour, (explore.get(row.hour) || 0) + 1);
    else if (row?.rule === 'immediate') immediate += 1;
  }
  const people = (count) => (count === 1 ? '1 person' : `${count} people`);
  const sentences = [];
  for (const hour of [...recipient.keys()].sort((a, b) => a - b)) sentences.push(`${people(recipient.get(hour))} at ${hour}:00 from their own opens.`);
  for (const key of [...store.keys()].sort()) {
    const [hour, sample] = key.split(':');
    sentences.push(`${people(store.get(key))} at ${hour}:00 from ${sample} store opens in 90 days.`);
  }
  for (const hour of [...merchant.keys()].sort((a, b) => a - b)) sentences.push(`${people(merchant.get(hour))} at the hour you set.`);
  for (const hour of [...explore.keys()].sort((a, b) => a - b)) sentences.push(`${people(explore.get(hour))} at ${hour}:00 to explore another hour.`);
  if (immediate) sentences.push(`${people(immediate)} on the next send.`);
  return sentences.join(' ');
}

export function smartBatches(assignments) {
  const map = new Map();
  for (const row of assignments || []) {
    const sample = row.sampleSize == null ? '' : row.sampleSize;
    const key = `${row.rule}|${row.hour ?? ''}|${sample}`;
    const hit = map.get(key) || { rule: row.rule, hour: row.hour ?? null, sampleSize: row.sampleSize ?? null, count: 0 };
    hit.count += 1;
    map.set(key, hit);
  }
  return [...map.values()];
}

export function assignSmartSend({ people, events, now = Date.now(), accountTimezone, fallbackHour, explore = false, seed = '' }) {
  const zone = isIanaTimezone(accountTimezone) ? accountTimezone : 'UTC';
  const storeEvents = engagementEvents(events).filter((evt) => {
    const at = Date.parse(evt.at);
    return at >= now - STORE_OPEN_DAYS * DAY && at <= now;
  });
  const storePeak = storeEvents.length >= MIN_STORE_OPENS ? peakHour(storeEvents, zone) : null;
  const fallback = Number.isInteger(fallbackHour) && fallbackHour >= 0 && fallbackHour <= 23 ? fallbackHour : null;
  const list = (people || []).map((person) => ({ ...person, email: String(person?.email || '').toLowerCase() })).filter((person) => person.email.includes('@'));
  const exploreCount = explore ? Math.round(list.length * 0.1) : 0;
  const exploreSet = new Set([...list].sort((a, b) => mix(`${seed}:${a.email}`) - mix(`${seed}:${b.email}`) || a.email.localeCompare(b.email)).slice(0, exploreCount).map((person) => person.email));
  const assignments = list.map((person) => {
    const personalZone = isIanaTimezone(person.timezone) ? person.timezone : zone;
    const own = personEvents(person, events);
    if (exploreSet.has(person.email)) {
      const hour = 9 + (mix(`${seed}:${person.email}:hour`) % 9);
      return { email: person.email, rule: 'explore', hour, sampleSize: null, sendAt: nextHourAt(now, hour, zone), timezone: zone };
    }
    if (own.length >= MIN_PERSON_OPENS) {
      const peak = peakHour(own, personalZone);
      return { email: person.email, rule: 'recipient', hour: peak.hour, sampleSize: own.length, sendAt: nextHourAt(now, peak.hour, personalZone), timezone: personalZone };
    }
    if (storePeak) {
      return { email: person.email, rule: 'store', hour: storePeak.hour, sampleSize: storeEvents.length, sendAt: nextHourAt(now, storePeak.hour, zone), timezone: zone };
    }
    if (fallback != null) {
      return { email: person.email, rule: 'merchant', hour: fallback, sampleSize: null, sendAt: nextHourAt(now, fallback, zone), timezone: zone };
    }
    return { email: person.email, rule: 'immediate', hour: null, sampleSize: null, sendAt: new Date(now).toISOString(), timezone: zone };
  });
  return { assignments, batches: smartBatches(assignments), report: smartSendReport(assignments) };
}

export function smartSendConflict(when, ab) {
  return when === 'smart' && ab?.variable === 'send_time';
}
