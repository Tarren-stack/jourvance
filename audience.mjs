/**
 * Lists, segments, campaign timing, and signup-form rules.
 * Sending and contact writes stay in server.mjs.
 * A list add can start list_added once. A remove does not unsubscribe.
 * A segment entry can start segment_entered once per entry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { clausesMatch, isIanaTimezone, isPredictionKey, isReadablePredictionField } from './email-flows.mjs';

export const LIST_LIMIT = 50;
export const SEGMENT_LIMIT = 50;
export const CLAUSE_LIMIT = 100;
export const PICK_LIMIT = 15;
export const FOLLOW_UP_NOTE = 'A follow-up to people who did not open is a draft you send. It appears after opens are stored.';

export const BUILT_INS = [
  { id: 'all', name: 'All marketing', definition: 'Accepts marketing, and is not suppressed or unsubscribed.' },
  { id: 'vip', name: 'Spent at least $100', definition: 'Recorded spend is at least 100, and they are not suppressed or unsubscribed.' },
  { id: 'repeat', name: 'Two or more orders', definition: 'At least two recorded orders, and they are not suppressed or unsubscribed.' },
  { id: 'buyers', name: 'Buyers', definition: 'At least one recorded order, and they are not suppressed or unsubscribed.' },
  { id: 'leads', name: 'Leads', definition: 'No recorded order, and they are not suppressed or unsubscribed.' },
  { id: 'exit_rescue', name: 'Exit rescue', definition: 'Tagged Exit-Intent-Rescue, and they are not suppressed or unsubscribed.' }
];

const BUILT_IN_IDS = new Set(BUILT_INS.map((row) => row.id));
const FORM_TYPES = new Set(['popup', 'bar', 'embed', 'flyout', 'page']);

export function inBuiltIn(id, contact, eligible) {
  if (!BUILT_IN_IDS.has(id) || !eligible || !contact) return false;
  const spent = Number(contact.totalSpent) || 0;
  const orders = Number(contact.ordersCount) || 0;
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  if (id === 'vip') return spent >= 100;
  if (id === 'repeat') return orders >= 2;
  if (id === 'buyers') return orders > 0;
  if (id === 'leads') return orders === 0;
  if (id === 'exit_rescue') return tags.includes('Exit-Intent-Rescue');
  return true;
}

function cleanValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return String(value ?? '').slice(0, 200);
}

function cleanClause(input) {
  if (!input || typeof input !== 'object') return { error: '' };
  const kind = String(input.kind || '');
  if (kind === 'random' || kind === 'prediction' || kind === 'unsupported') {
    return { error: 'A segment cannot use a random split or a prediction.' };
  }
  if (kind === 'list') {
    const listId = String(input.listId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!listId) return { error: 'A list check needs a list.' };
    return { clause: { kind, listId, member: input.member !== false } };
  }
  if (kind === 'consent') {
    return { clause: { kind, channel: input.channel === 'sms' ? 'sms' : 'email', can: input.can !== false } };
  }
  if (kind === 'did') {
    const event = String(input.event || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (!event) return { error: 'An event check needs an event.' };
    if (input.since === 'enroll') return { error: 'A segment check needs a number of days, not since they joined a flow.' };
    const since = Math.max(1, Math.min(3650, Math.round(Number(input.since) || 0)));
    if (!since) return { error: 'A segment check needs a number of days.' };
    return { clause: { kind, event, since, done: input.done !== false } };
  }
  if (kind !== 'profile' && kind !== 'event_field') return { error: '' };
  const op = ['set', 'unset', 'eq', 'neq', 'gt', 'lt', 'contains'].includes(input.op) ? input.op : '';
  const field = String(input.field || '').slice(0, 60);
  if (!op || !field || (isPredictionKey(field) && !isReadablePredictionField(field))) return { error: 'That field cannot be used in a segment.' };
  return { clause: { kind, field, op, value: cleanValue(input.value) } };
}

export function cleanSegment(input) {
  const id = String(input?.id || '');
  if (!/^seg_[a-z0-9]+$/.test(id)) return { ok: false, error: 'That segment could not be saved.' };
  const groups = [];
  let count = 0;
  const source = Array.isArray(input?.groups) ? input.groups : [];
  for (const group of source.slice(0, 20)) {
    const clauses = [];
    for (const raw of Array.isArray(group?.clauses) ? group.clauses : []) {
      count += 1;
      if (count > CLAUSE_LIMIT) return { ok: false, error: 'A segment can have 100 checks.' };
      const cleaned = cleanClause(raw);
      if (cleaned.error) return { ok: false, error: cleaned.error };
      if (cleaned.clause) clauses.push(cleaned.clause);
    }
    if (clauses.length) groups.push({ join: group?.join === 'any' ? 'any' : 'all', clauses });
  }
  if (!groups.length) return { ok: false, error: 'A segment needs at least one check.' };
  return {
    ok: true,
    segment: {
      id,
      name: String(input?.name || 'Segment').slice(0, 80),
      join: input?.join === 'any' ? 'any' : 'all',
      groups
    }
  };
}

export function cleanSegments(input) {
  const out = [];
  for (const row of Array.isArray(input) ? input : []) {
    const cleaned = cleanSegment(row);
    if (cleaned.ok) out.push(cleaned.segment);
    if (out.length >= SEGMENT_LIMIT) break;
  }
  return out;
}

function clauseText(clause) {
  if (clause.kind === 'list') return `${clause.member ? 'On list' : 'Not on list'} ${clause.listId}`;
  if (clause.kind === 'consent') return `${clause.can ? 'Can receive' : 'Cannot receive'} ${clause.channel}`;
  if (clause.kind === 'did') return `${clause.done ? 'Did' : 'Did not do'} ${clause.event} in ${clause.since} days`;
  const op = { set: 'is set', unset: 'is empty', eq: 'is', neq: 'is not', gt: 'is above', lt: 'is below', contains: 'contains' }[clause.op] || clause.op;
  const value = clause.op === 'set' || clause.op === 'unset' ? '' : ` ${clause.value}`;
  const field = clause.field === 'predictedValue' ? 'predicted value'
    : clause.field === 'expectedNextOrderAt' ? 'predicted next order'
      : clause.field === 'predictedValue365' ? 'predicted value over 365 days'
        : clause.field === 'churn' ? 'predicted churn'
          : clause.field;
  return `${field} ${op}${value}`;
}

export function segmentDefinition(segment) {
  const built = BUILT_INS.find((row) => row.id === segment?.id);
  if (built) return built.definition;
  if (!segment?.groups?.length) return '';
  const groups = segment.groups.map((group) => {
    const text = group.clauses.map(clauseText).join(group.join === 'any' ? ' or ' : ' and ');
    return segment.groups.length > 1 ? `(${text})` : text;
  });
  return groups.join(segment.join === 'any' ? ' or ' : ' and ');
}

export function segmentMatches(segment, ctx) {
  if (!segment || segment.builtin || BUILT_IN_IDS.has(segment.id)) return inBuiltIn(segment?.id, ctx?.contact, ctx?.eligible === true);
  const groups = segment.groups || [];
  const results = groups.map((group) => (
    group.join === 'any'
      ? group.clauses.some((clause) => clausesMatch([clause], ctx))
      : clausesMatch(group.clauses, ctx)
  ));
  if (!results.length) return false;
  return segment.join === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function nextSegmentState(prev, matchingEmails, nowIso, first) {
  const members = { ...(prev?.members || {}) };
  const matching = new Set((matchingEmails || []).map((email) => String(email || '').toLowerCase()).filter((email) => email.includes('@')));
  if (prev?.baselined !== true && first === 'quiet') {
    for (const email of matching) members[email] = { inside: true, enteredAt: nowIso, leftAt: '' };
    return { row: { baselined: true, members }, entered: [] };
  }
  const entered = [];
  for (const email of matching) {
    const had = members[email];
    if (!had || had.inside !== true) {
      members[email] = { inside: true, enteredAt: nowIso, leftAt: '' };
      entered.push(email);
    }
  }
  for (const [email, had] of Object.entries(members)) {
    if (had?.inside === true && !matching.has(email)) members[email] = { ...had, inside: false, leftAt: nowIso };
  }
  return { row: { baselined: true, members }, entered };
}

export function cleanLists(input) {
  const out = [];
  for (const row of Array.isArray(input) ? input : []) {
    const id = String(row?.id || '');
    if (!/^list_[a-z0-9]+$/.test(id)) continue;
    out.push({ id, name: String(row?.name || 'List').slice(0, 80), createdAt: String(row?.createdAt || '').slice(0, 40) });
    if (out.length >= LIST_LIMIT) break;
  }
  return out;
}

export function applyListChange(current, listId, update) {
  const id = String(listId || '');
  const list = Array.isArray(current) ? current.filter((item) => item && item !== id) : [];
  const had = Array.isArray(current) && current.includes(id);
  if (update === 'remove') return { next: Array.isArray(current) ? current.filter((item) => item !== id) : [], added: false, removed: had, unsubscribed: false };
  if (had) return { next: Array.isArray(current) ? current.slice() : [], added: false, removed: false, unsubscribed: false };
  return { next: [...list, id].slice(0, 50), added: true, removed: false, unsubscribed: false };
}

export function cleanPicks(input) {
  const picks = [];
  for (const item of Array.isArray(input) ? input : []) {
    const type = item?.type === 'list' ? 'list' : item?.type === 'segment' ? 'segment' : '';
    const id = String(item?.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!type || !id) continue;
    if (picks.some((row) => row.type === type && row.id === id)) continue;
    picks.push({ type, id });
    if (picks.length > PICK_LIMIT) return { ok: false, error: 'Include and exclude can name up to 15 lists or segments.' };
  }
  return { ok: true, picks };
}

export function resolveAudience(people, include, exclude) {
  const want = Array.isArray(include) ? include : [];
  const skip = Array.isArray(exclude) ? exclude : [];
  if (!want.length) return [];
  const match = (person, pick) => (
    pick.type === 'list'
      ? (person.lists || []).includes(pick.id)
      : (person.segments || []).includes(pick.id)
  );
  const seen = new Set();
  const out = [];
  for (const person of people || []) {
    const email = String(person?.email || '').toLowerCase();
    if (!email.includes('@') || seen.has(email)) continue;
    if (!want.some((pick) => match(person, pick))) continue;
    if (skip.some((pick) => match(person, pick))) continue;
    seen.add(email);
    out.push({ email, name: person.name || '', phone: person.phone || '' });
  }
  return out;
}

function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
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

export function campaignSchedule({ when, sendAt, timezone, gradual, now = Date.now() }) {
  if (when === 'smart') {
    let batch = null;
    if (gradual?.wrap === true) {
      const percent = Math.round(Number(gradual?.percent));
      const every = gradual?.every === 'minute' ? 'minute' : gradual?.every === 'hour' ? 'hour' : '';
      if (!percent || percent < 1 || percent > 50) return { ok: false, error: 'Each batch is 1 to 50 percent of the audience.' };
      if (!every) return { ok: false, error: 'Batches run every minute or every hour.' };
      batch = { percent, every };
    }
    return { ok: true, when: 'smart', sendAt: new Date(now).toISOString(), waiting: true, gradual: batch };
  }
  const mode = when === 'clock' || when === 'gradual' ? when : 'now';
  let at = now;
  if (mode !== 'now') {
    const text = String(sendAt || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return { ok: false, error: 'Choose a date and time.' };
    const zone = isIanaTimezone(timezone) ? timezone : 'UTC';
    at = zonedToUtc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), zone);
    if (!Number.isFinite(at)) return { ok: false, error: 'Choose a date and time.' };
  }
  let batch = null;
  if (mode === 'gradual') {
    const percent = Math.round(Number(gradual?.percent));
    const every = gradual?.every === 'minute' ? 'minute' : gradual?.every === 'hour' ? 'hour' : '';
    if (!percent || percent < 1 || percent > 50) return { ok: false, error: 'Each batch is 1 to 50 percent of the audience.' };
    if (!every) return { ok: false, error: 'Batches run every minute or every hour.' };
    batch = { percent, every };
  }
  return {
    ok: true,
    when: mode,
    sendAt: new Date(at).toISOString(),
    waiting: mode !== 'now' && at > now,
    gradual: batch
  };
}

export function cleanAb(input) {
  if (!input || input.variable == null || input.variable === '' || input.variable === 'off') return { ok: true, ab: null };
  const variable = ['subject', 'content', 'send_time'].includes(input.variable) ? input.variable : '';
  if (!variable) return { ok: false, error: 'A/B can change the subject, the content, or the send time.' };
  const offset = Math.round(Number(input.offsetHours) || 0);
  if (variable === 'send_time' && (offset < 1 || offset > 168)) return { ok: false, error: 'The second send time is 1 to 168 hours after the first.' };
  if (variable === 'subject' && !String(input.subjectB || '').trim()) return { ok: false, error: 'The second subject is empty.' };
  if (variable === 'content' && !String(input.bodyB || '').trim()) return { ok: false, error: 'The second version is empty.' };
  const winner = input.winner === 'a' || input.winner === 'b' ? input.winner : '';
  return {
    ok: true,
    ab: {
      variable,
      subjectB: String(input.subjectB || '').slice(0, 200),
      bodyB: String(input.bodyB || '').slice(0, 20000),
      offsetHours: variable === 'send_time' ? offset : 0,
      winner
    }
  };
}

export function variantBucket(seed, mod) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % Math.max(1, Number(mod) || 1);
}

export function abSide(email, campaignId, ab) {
  if (!ab) return 'a';
  if (ab.winner === 'a' || ab.winner === 'b') return ab.winner;
  return variantBucket(`${campaignId}:${String(email || '').toLowerCase()}`, 2) === 0 ? 'a' : 'b';
}

export function dueRecipients(record, nowMs) {
  const audience = Array.isArray(record?.audience) ? record.audience : [];
  const sent = new Set(record?.sentTo || []);
  const skipped = new Set([...(record?.skipped || []), ...(record?.heldOut || []).map((row) => row.email)]);
  const pending = audience.filter((person) => person?.email && !sent.has(person.email) && !skipped.has(person.email));
  if (record?.when === 'smart') {
    const ready = pending.filter((person) => {
      const at = Date.parse(person?.smart?.sendAt || '');
      return Number.isFinite(at) && nowMs >= at;
    });
    let pool = ready;
    if (record.gradual) {
      const percent = Math.max(1, Math.min(50, Number(record.gradual?.percent) || 1));
      const size = Math.max(1, Math.ceil(audience.length * percent / 100));
      pool = ready.slice(0, size);
    }
    const due = pool.map((person) => ({ email: person.email, name: person.name || '', phone: person.phone || '', side: 'a' }));
    return { due, waiting: pending.filter((person) => !due.some((row) => row.email === person.email)), remaining: pending.length - due.length };
  }
  let pool = pending;
  if (record?.when === 'gradual') {
    const percent = Math.max(1, Math.min(50, Number(record.gradual?.percent) || 1));
    const size = Math.max(1, Math.ceil(audience.length * percent / 100));
    pool = pending.slice(0, size);
  }
  const start = new Date(record?.sendAt || 0).getTime();
  const due = [];
  const waiting = [];
  for (const person of pool) {
    const side = abSide(person.email, record.id, record.ab);
    const offset = side === 'b' && record.ab?.variable === 'send_time' ? (Number(record.ab.offsetHours) || 0) * 3600000 : 0;
    const row = { email: person.email, name: person.name || '', phone: person.phone || '', side };
    if (nowMs >= start + offset) due.push(row);
    else waiting.push(row);
  }
  return { due, waiting, remaining: pending.length - due.length };
}

export function nextBatchAt(record, nowMs) {
  const every = record?.gradual?.every === 'minute' ? 60000 : 3600000;
  return new Date(nowMs + every).toISOString();
}

export function campaignUnsent(record, nowMs) {
  if (!record || record.sentAt) return false;
  if ((record.sentTo || []).length) return false;
  if (record.status !== 'scheduled') return false;
  return new Date(record.sendAt || 0).getTime() > nowMs;
}

export function applyUtm(html, utm) {
  const params = [];
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const value = String(utm?.[key] || '').trim().slice(0, 80);
    if (value) params.push([`utm_${key}`, value]);
  }
  if (!params.length) return String(html || '');
  return String(html || '').replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (all, quote, href) => {
    if (/\/u\//.test(href)) return all;
    try {
      const url = new URL(href);
      for (const [key, value] of params) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
      return `href=${quote}${url.toString()}${quote}`;
    } catch {
      return all;
    }
  });
}

export function cleanUtm(input) {
  const out = {};
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const value = String(input?.[key] || '').trim().slice(0, 80);
    if (value) out[key] = value;
  }
  return out;
}

export function smartSkipReason(channel, recent) {
  if (!recent?.enabled) return '';
  if (channel === 'sms') return recent.sms ? 'sms' : '';
  return recent.email ? 'email' : '';
}

function cleanCoupon(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name || '').trim().slice(0, 40);
  if (!name) return { error: 'A slice needs a coupon.' };
  const discountType = input.discountType === 'fixed_amount' || input.discountType === 'free_shipping' ? input.discountType : 'percentage';
  const value = Math.abs(Number(input.value) || 0);
  if (discountType !== 'free_shipping' && !value) return { error: 'A slice needs a coupon.' };
  return { coupon: { name, discountType, value: discountType === 'percentage' ? Math.min(100, value) : value, prefix: String(input.prefix || '').slice(0, 12) } };
}

export function cleanSlices(input) {
  const slices = [];
  for (const row of Array.isArray(input) ? input : []) {
    const coupon = cleanCoupon(row?.coupon || row);
    if (coupon?.error) return { ok: false, error: 'A slice without a coupon cannot be added.' };
    if (!coupon?.coupon) continue;
    slices.push({ label: String(row?.label || coupon.coupon.name).slice(0, 40), coupon: coupon.coupon });
    if (slices.length >= 8) break;
  }
  return { ok: true, slices };
}

function cleanRules(input, delaySeconds) {
  const device = ['mobile', 'desktop', 'any'].includes(input?.device) ? input.device : 'any';
  return {
    urlContains: String(input?.urlContains || '').slice(0, 200),
    utmKey: String(input?.utmKey || '').slice(0, 80),
    utmValue: String(input?.utmValue || '').slice(0, 80),
    device,
    hideSubmitted: input?.hideSubmitted !== false,
    scrollPercent: Math.max(0, Math.min(100, Math.round(Number(input?.scrollPercent) || 0))),
    exit: input?.exit === true,
    showAgainDays: Math.max(0, Math.min(365, Math.round(Number(input?.showAgainDays) || 0))),
    delaySeconds
  };
}

export function cleanForm(input, options = {}) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id || '');
  if (!/^form_[a-z0-9]+$/.test(id)) return null;
  const type = FORM_TYPES.has(input.type) ? input.type : 'embed';
  const delaySeconds = Math.max(0, Math.min(120, Math.round(Number(input.delaySeconds) || 0)));
  const slices = cleanSlices(input.slices);
  if (!slices.ok) return { error: slices.error };
  const coupon = input.coupon ? cleanCoupon(input.coupon) : null;
  if (coupon?.error) return { error: 'The success coupon needs a name and a value.' };
  let optIn = input.optIn === 'double' || input.optIn === 'single' ? input.optIn : '';
  if (!optIn) optIn = options.creating ? 'double' : 'single';
  const variantB = {
    headline: String(input.variantB?.headline || '').slice(0, 140),
    body: String(input.variantB?.body || '').slice(0, 500),
    buttonText: String(input.variantB?.buttonText || '').slice(0, 40),
    successMessage: String(input.variantB?.successMessage || '').slice(0, 180)
  };
  return {
    form: {
      id,
      name: String(input.name || 'Signup form').slice(0, 80),
      type,
      enabled: Boolean(input.enabled),
      headline: String(input.headline || '').slice(0, 140),
      body: String(input.body || '').slice(0, 500),
      buttonText: String(input.buttonText || 'Join').slice(0, 40),
      successMessage: String(input.successMessage || 'You are on the list.').slice(0, 180),
      teaser: String(input.teaser || '').slice(0, 80),
      teaserClosed: String(input.teaserClosed || '').slice(0, 80),
      delaySeconds,
      optIn,
      askPhone: input.askPhone === true,
      askSms: input.askSms === true,
      testEnabled: input.testEnabled === true,
      variantB,
      rules: cleanRules(input.rules, delaySeconds),
      coupon: coupon?.coupon || null,
      slices: slices.slices
    }
  };
}

export function formGate(form, ctx) {
  const rules = form?.rules || {};
  const url = String(ctx?.url || '');
  const contains = String(rules.urlContains || '').trim();
  if (contains && !url.toLowerCase().includes(contains.toLowerCase())) return { show: false, teaser: false, reason: 'url' };
  const utmKey = String(rules.utmKey || '').trim();
  if (utmKey) {
    const have = ctx?.utm ? ctx.utm[utmKey] : '';
    const want = String(rules.utmValue || '');
    if (have == null || have === '') return { show: false, teaser: false, reason: 'utm' };
    if (want && String(have) !== want) return { show: false, teaser: false, reason: 'utm' };
  }
  const device = rules.device || 'any';
  if (device === 'mobile' && !ctx?.mobile) return { show: false, teaser: false, reason: 'device' };
  if (device === 'desktop' && ctx?.mobile) return { show: false, teaser: false, reason: 'device' };
  if (rules.hideSubmitted !== false && ctx?.submitted) return { show: false, teaser: false, reason: 'submitted' };
  const again = Number(rules.showAgainDays) || 0;
  if (ctx?.closed && !ctx?.reopen) {
    const closed = new Date(ctx.closedAt || 0).getTime();
    if (again > 0 && Number.isFinite(closed) && (ctx.now || 0) < closed + again * 86400000) return { show: false, teaser: false, reason: 'again' };
    return { show: false, teaser: true, reason: 'closed' };
  }
  const delay = Math.max(0, Number(form?.delaySeconds) || 0);
  const scroll = Math.max(0, Math.min(100, Number(rules.scrollPercent) || 0));
  if (delay && (Number(ctx?.elapsed) || 0) < delay) return { show: false, teaser: true, reason: 'delay' };
  if (scroll && (Number(ctx?.scroll) || 0) < scroll) return { show: false, teaser: true, reason: 'scroll' };
  if (rules.exit === true && !ctx?.exit) return { show: false, teaser: true, reason: 'exit' };
  return { show: true, teaser: false, reason: '' };
}

export function formVariant(visitorId, formId) {
  return variantBucket(`${visitorId || ''}:${formId || ''}`, 2) === 0 ? 'a' : 'b';
}

export function publicForm(form) {
  return {
    id: form.id,
    type: form.type,
    headline: form.headline,
    body: form.body,
    buttonText: form.buttonText,
    successMessage: form.successMessage,
    teaser: form.teaser,
    teaserClosed: form.teaserClosed,
    delaySeconds: form.delaySeconds,
    rules: form.rules,
    askPhone: form.askPhone === true,
    askSms: form.askSms === true,
    testEnabled: form.testEnabled === true,
    variantB: form.variantB || {},
    slices: (form.slices || []).map((slice) => ({ label: slice.label })),
    optIn: form.optIn === 'double' ? 'double' : 'single',
    hasCoupon: Boolean(form.coupon?.name)
  };
}

export function spinSlice(form, email) {
  const slices = form?.slices || [];
  if (!slices.length) return null;
  return slices[variantBucket(`${email}:${form.id}`, slices.length)] || null;
}

function hmac(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signConfirm(secret, uid, email, formId) {
  const key = String(secret || '');
  const address = String(email || '').trim().toLowerCase();
  const id = String(formId || '');
  if (!key || !uid || !address.includes('@') || !id) return '';
  const body = Buffer.from(JSON.stringify({
    u: String(uid).slice(0, 128),
    e: address,
    f: id.slice(0, 40),
    x: Date.now() + 7 * 86400000
  })).toString('base64url');
  return `${body}.${hmac(key, body)}`;
}

export function readConfirm(secret, token, now = Date.now()) {
  const key = String(secret || '');
  const parts = String(token || '').split('.');
  if (!key || parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = hmac(key, body);
  const left = Buffer.from(sig);
  const right = Buffer.from(expect);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const email = String(parsed?.e || '').trim().toLowerCase();
    const uid = String(parsed?.u || '').trim();
    const formId = String(parsed?.f || '').trim();
    if (!uid || !email.includes('@') || !formId || !Number.isFinite(parsed?.x) || now > parsed.x) return null;
    return { uid, email, formId };
  } catch {
    return null;
  }
}

export function signupPageScript(forms, pageSlug) {
  if (!forms?.length) return '';
  const json = JSON.stringify(forms).replace(/</g, '\\u003c');
  const slug = JSON.stringify(String(pageSlug || ''));
  return `<style>
.jv-signup{font-family:Georgia,serif;color:#111;background:#fff;border:1px solid #d1d5db;border-radius:12px;padding:16px;max-width:420px}
.jv-signup h2{font-size:20px;line-height:1.3;margin:0 0 8px}
.jv-signup p{font-size:14px;line-height:1.45;margin:0 0 8px}
.jv-signup label{display:block;font-size:13px;font-weight:700;margin:8px 0 4px}
.jv-signup input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #9ca3af;border-radius:8px;font-size:16px}
.jv-signup button{margin-top:12px;padding:10px 14px;border-radius:8px;border:0;background:#111;color:#fff;font-weight:700;cursor:pointer}
.jv-signup .jv-close{background:#fff;color:#111;border:1px solid #9ca3af;margin-left:8px}
.jv-bar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;justify-content:center;padding:12px;background:#fff;border-top:1px solid #d1d5db}
.jv-pop{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:16px}
.jv-fly{position:fixed;right:16px;bottom:16px;z-index:45;width:min(360px,calc(100% - 32px))}
.jv-page{margin:24px auto;max-width:640px}
.jv-teaser{position:fixed;left:16px;bottom:16px;z-index:46;padding:10px 14px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:700;cursor:pointer}
@media (max-width:767px){.jv-fly{left:0;right:0;width:auto;bottom:0;border-radius:12px 12px 0 0}.jv-signup{max-width:none}}
</style>
<script type="application/json" id="jv-signup-forms">${json}</script>
<script>
${formGate.toString()}
${variantBucket.toString()}
(function(){
  var raw = document.getElementById('jv-signup-forms');
  if (!raw) return;
  var forms = [];
  try { forms = JSON.parse(raw.textContent || '[]'); } catch (e) { return; }
  var pageSlug = ${slug};
  var started = Date.now();
  var exitSeen = false;
  document.addEventListener('mouseleave', function(e){ if (e.clientY <= 0) exitSeen = true; });
  function el(tag, text){ var n = document.createElement(tag); if (text) n.textContent = text; return n; }
  function params(){
    var out = {};
    var search = new URLSearchParams(location.search);
    search.forEach(function(value, key){ out[key] = value; });
    return out;
  }
  function scrollPct(){
    var height = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return Math.round((window.scrollY / height) * 100);
  }
  forms.forEach(function(form){
    var copy = form;
    var side = 'a';
    if (form.testEnabled) {
      var visitor = window.jourvanceVisitor ? window.jourvanceVisitor() : '';
      side = variantBucket(visitor + ':' + form.id, 2) === 0 ? 'a' : 'b';
      if (side === 'b' && form.variantB) {
        copy = Object.assign({}, form, {
          headline: form.variantB.headline || form.headline,
          body: form.variantB.body || form.body,
          buttonText: form.variantB.buttonText || form.buttonText,
          successMessage: form.variantB.successMessage || form.successMessage
        });
      }
    }
    var box = el('form');
    box.className = 'jv-signup';
    box.setAttribute('data-jv-form', form.id);
    box.setAttribute('aria-label', copy.headline || copy.buttonText || 'Join the list');
    if (copy.headline) box.appendChild(el('h2', copy.headline));
    if (copy.body) box.appendChild(el('p', copy.body));
    if (form.slices && form.slices.length) {
      var list = el('ul');
      form.slices.forEach(function(slice){ list.appendChild(el('li', slice.label)); });
      box.appendChild(list);
    }
    var emailId = form.id + '-email';
    var emailLabel = el('label', 'Email');
    emailLabel.htmlFor = emailId;
    var email = el('input');
    email.id = emailId; email.type = 'email'; email.required = true; email.autocomplete = 'email';
    var nameId = form.id + '-name';
    var nameLabel = el('label', 'Name');
    nameLabel.htmlFor = nameId;
    var name = el('input');
    name.id = nameId; name.autocomplete = 'name';
    box.appendChild(emailLabel); box.appendChild(email);
    box.appendChild(nameLabel); box.appendChild(name);
    var phone = null;
    if (form.askPhone) {
      var phoneId = form.id + '-phone';
      var phoneLabel = el('label', 'Phone');
      phoneLabel.htmlFor = phoneId;
      phone = el('input');
      phone.id = phoneId; phone.type = 'tel'; phone.autocomplete = 'tel';
      box.appendChild(phoneLabel); box.appendChild(phone);
    }
    var sms = null;
    if (form.askSms) {
      var smsWrap = el('label');
      sms = el('input');
      sms.type = 'checkbox';
      smsWrap.appendChild(sms);
      smsWrap.appendChild(document.createTextNode(' Text me. I agree to receive texts.'));
      box.appendChild(smsWrap);
    }
    var submit = el('button', copy.buttonText || (form.slices && form.slices.length ? 'Spin' : 'Join'));
    submit.type = 'submit';
    var note = el('p');
    note.setAttribute('role', 'status');
    box.appendChild(submit); box.appendChild(note);
    var host = box;
    if (form.type === 'bar') { host = el('div'); host.className = 'jv-bar'; host.appendChild(box); }
    if (form.type === 'popup') { host = el('div'); host.className = 'jv-pop'; host.appendChild(box); }
    if (form.type === 'flyout') { host = el('div'); host.className = 'jv-fly'; host.appendChild(box); }
    if (form.type === 'page') { host = el('div'); host.className = 'jv-page'; host.appendChild(box); }
    host.setAttribute('data-jv-host', form.id);
    var teaser = el('button', form.teaser || 'Open');
    teaser.type = 'button';
    teaser.className = 'jv-teaser';
    teaser.hidden = true;
    var reopen = false;
    teaser.addEventListener('click', function(){ reopen = true; paint(); if (email) email.focus(); });
    if (form.type === 'popup' || form.type === 'flyout' || form.type === 'bar') {
      var close = el('button', 'Close');
      close.type = 'button';
      close.className = 'jv-close';
      close.addEventListener('click', function(){
        try { localStorage.setItem('jv_form_closed_' + form.id, new Date().toISOString()); } catch (err) {}
        reopen = false;
        paint();
      });
      submit.insertAdjacentElement('afterend', close);
    }
    document.body.appendChild(host);
    document.body.appendChild(teaser);
    function paint(){
      var closedAt = '';
      var submitted = false;
      try {
        closedAt = localStorage.getItem('jv_form_closed_' + form.id) || '';
        submitted = localStorage.getItem('jv_form_done_' + form.id) === '1';
      } catch (err) {}
      var gate = formGate(form, {
        url: location.href,
        utm: params(),
        mobile: window.matchMedia('(max-width: 767px)').matches,
        submitted: submitted,
        elapsed: (Date.now() - started) / 1000,
        scroll: scrollPct(),
        exit: exitSeen,
        closed: Boolean(closedAt),
        closedAt: closedAt,
        reopen: reopen,
        now: Date.now()
      });
      host.hidden = !gate.show;
      teaser.hidden = !gate.teaser;
      teaser.textContent = (closedAt && form.teaserClosed) ? form.teaserClosed : (form.teaser || 'Open');
    }
    paint();
    window.addEventListener('scroll', paint);
    document.addEventListener('mouseleave', paint);
    setInterval(paint, 500);
    box.addEventListener('submit', function(ev){
      ev.preventDefault();
      submit.disabled = true;
      var body = {
        email: email.value,
        name: name.value,
        slug: pageSlug,
        formId: form.id,
        formVariant: side,
        visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
      };
      if (phone && phone.value) body.phone = phone.value;
      if (sms && sms.checked) body.smsConsent = true;
      fetch('/api/public/lead', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(res){
          if (!res.ok) { note.textContent = (res.d && res.d.error) || 'That signup was not saved.'; submit.disabled = false; return; }
          try { localStorage.setItem('jv_form_done_' + form.id, '1'); } catch (err) {}
          var lines = [];
          if (res.d && res.d.sliceLabel) lines.push(res.d.sliceLabel);
          lines.push((res.d && res.d.message) || copy.successMessage || 'You are on the list.');
          if (res.d && res.d.coupon) lines.push(res.d.coupon);
          if (res.d && res.d.couponNote) lines.push(res.d.couponNote);
          note.textContent = lines.join(' ');
        }).catch(function(){ note.textContent = 'That signup was not saved.'; submit.disabled = false; });
    });
  });
})();
</script>`;
}
