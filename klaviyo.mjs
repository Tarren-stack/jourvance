/**
 * Klaviyo private-key client and the mapping into Jourvance records.
 * A profile is marketable here only when Klaviyo says the email consent is SUBSCRIBED
 * and the profile is not suppressed. A placed-order split is stored with Yes meaning
 * they ordered. Other splits keep both paths. Nothing here turns a copied flow on.
 */
import { isPredictionKey, publicHttpsUrl } from './email-flows.mjs';

export const KLAVIYO_REVISION = '2024-10-15';
export const KLAVIYO_FLOW_REVISION = '2024-10-15.pre';

export async function klaviyoSend(apiKey, method, path, body) {
  const response = await fetch(`https://a.klaviyo.com${path}`, {
    method,
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      accept: 'application/vnd.api+json',
      revision: path.startsWith('/api/flows/') && path.includes('definition') ? KLAVIYO_FLOW_REVISION : KLAVIYO_REVISION,
      ...(body ? { 'content-type': 'application/vnd.api+json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || `Klaviyo ${response.status}`;
    const error = new Error(String(detail).slice(0, 240));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function nextPath(payload) {
  const next = payload?.links?.next;
  if (!next || typeof next !== 'string') return '';
  try {
    const url = new URL(next);
    return `${url.pathname}${url.search}`;
  } catch {
    return next.startsWith('/') ? next : '';
  }
}

export function accountFrom(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  const info = row?.attributes?.contact_information || {};
  return {
    accountId: String(row?.id || ''),
    accountName: String(info.organization_name || info.default_sender_name || '').slice(0, 120)
  };
}

export function contactFromProfile(profile) {
  const attributes = profile?.attributes || {};
  const email = String(attributes.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const marketing = attributes.subscriptions?.email?.marketing || {};
  const suppressed = Array.isArray(marketing.suppression) && marketing.suppression.length > 0;
  const consent = String(marketing.consent || '');
  return {
    email,
    name: [attributes.first_name, attributes.last_name].filter(Boolean).join(' ').slice(0, 120),
    phone: String(attributes.phone_number || '').slice(0, 32),
    klaviyoProfileId: String(profile.id || '').slice(0, 64),
    acceptsMarketing: !suppressed && consent === 'SUBSCRIBED',
    klaviyoConsent: suppressed ? 'suppressed' : (consent ? consent.toLowerCase() : 'unknown')
  };
}

const WEEKDAY_NUMBER = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

function delayNodeFrom(action) {
  const data = action?.data || {};
  const unit = String(data.unit || 'hours').toLowerCase();
  let minutes = Math.max(0, Number(data.value) || 0);
  if (unit.startsWith('week')) minutes *= 7 * 24 * 60;
  else if (unit.startsWith('day')) minutes *= 24 * 60;
  else if (unit.startsWith('hour')) minutes *= 60;
  else if (unit.startsWith('month')) minutes *= 30 * 24 * 60;
  const clock = parseClock(data.delay_until_time || data.delayUntilTime);
  const rawDays = data.delay_until_weekdays || data.delayUntilWeekdays || [];
  const weekdays = [];
  for (const day of Array.isArray(rawDays) ? rawDays : []) {
    const number = typeof day === 'number' ? day : WEEKDAY_NUMBER[String(day).toLowerCase()];
    if (number >= 0 && number <= 6 && !weekdays.includes(number)) weekdays.push(number);
  }
  return {
    type: 'delay',
    mode: clock || weekdays.length ? 'clock' : 'duration',
    delayMinutes: Math.min(90 * 24 * 60, Math.round(minutes)),
    clockHour: clock ? clock.hour : 0,
    clockMinute: clock ? clock.minute : 0,
    weekdays,
    timezone: String(data.timezone || '').toLowerCase() === 'profile' ? 'profile' : 'account'
  };
}

function parseClock(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const hour = Number(value.hour ?? value.hours);
    const minute = Number(value.minute ?? value.minutes ?? 0);
    if (!Number.isFinite(hour)) return null;
    return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
  }
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return { hour: Math.max(0, Math.min(23, Number(match[1]))), minute: Math.max(0, Math.min(59, Number(match[2]))) };
}

function jourvanceTrigger(flow, metricName) {
  const trigger = flow?.attributes?.definition?.triggers?.[0] || {};
  const kind = String(flow?.attributes?.trigger_type || trigger.type || '').toLowerCase();
  const name = String(metricName || '').toLowerCase();
  if (kind.includes('date')) return 'date_property';
  if (kind.includes('price')) return 'price_drop';
  if (kind.includes('inventory')) return 'low_inventory';
  if (kind.includes('segment')) return 'segment_entered';
  if (kind.includes('list')) return 'list_added';
  if (/back in stock/.test(name)) return 'back_in_stock';
  if (/started checkout|checkout started/.test(name)) return 'checkout_abandonment';
  if (/placed order|ordered product/.test(name)) return 'order_paid';
  if (/partial/.test(name) && /fulfill/.test(name)) return 'order_partially_fulfilled';
  if (/fulfill/.test(name)) return 'order_fulfilled';
  if (/cancel/.test(name)) return 'order_cancelled';
  if (/refund/.test(name)) return 'order_refunded';
  if (/viewed product/.test(name)) return 'product_viewed';
  if (/viewed collection/.test(name)) return 'collection_viewed';
  if (/submitted search|search submitted/.test(name)) return 'search_submitted';
  if (/added to cart/.test(name)) return 'added_to_cart';
  return 'manual';
}

const PENDING_TRIGGER = {
  segment_entered: 'a segment entry',
  product_viewed: 'a product view tied to an email',
  collection_viewed: 'a collection view tied to an email',
  search_submitted: 'a search tied to an email',
  added_to_cart: 'an add to cart tied to an email',
  order_fulfilled: 'a fulfillment',
  order_partially_fulfilled: 'a partial fulfillment',
  order_cancelled: 'a cancellation',
  order_refunded: 'a refund',
  price_drop: 'a price drop',
  low_inventory: 'a low stock count',
  back_in_stock: 'a back-in-stock request'
};

function linkValue(links, ...keys) {
  for (const key of keys) {
    if (links?.[key]) return String(links[key]);
  }
  return '';
}

function linksOf(action) {
  const links = action?.links || {};
  return {
    next: linkValue(links, 'next'),
    yes: linkValue(links, 'next_if_true', 'nextIfTrue'),
    no: linkValue(links, 'next_if_false', 'nextIfFalse')
  };
}

function conditionsOf(action) {
  const data = action?.data || {};
  const filter = data.profile_filter || data.profileFilter || null;
  const groups = filter?.condition_groups || filter?.conditionGroups || [];
  const conditions = [];
  for (const group of groups) {
    for (const condition of group?.conditions || []) conditions.push(condition);
  }
  return conditions;
}

function metricIdsIn(flow) {
  const ids = [];
  const trigger = flow?.attributes?.definition?.triggers?.[0];
  if (String(trigger?.type || '').toLowerCase().includes('metric') && trigger?.id) ids.push(String(trigger.id));
  for (const action of flow?.attributes?.definition?.actions || []) {
    for (const condition of conditionsOf(action)) {
      const id = condition?.metric_id || condition?.metricId;
      if (id) ids.push(String(id));
    }
  }
  return ids;
}

/**
 * A Klaviyo split can become Jourvance's order check only when it is one
 * "placed order since the flow started" condition. Yes on that check means
 * they ordered. A "zero times" condition is stored the other way around.
 */
function splitOrderPolarity(action, metricNames) {
  const conditions = conditionsOf(action);
  if (conditions.length !== 1) return null;
  const condition = conditions[0];
  const type = String(condition.type || '').replace(/_/g, '-').toLowerCase();
  if (type !== 'profile-metric') return null;
  const metricId = String(condition.metric_id || condition.metricId || '');
  const name = String(metricNames?.[metricId] || '');
  if (!/placed order|ordered product/i.test(name)) return null;
  const timeframe = condition.timeframe_filter || condition.timeframeFilter || {};
  const when = String(timeframe.operator || '').toLowerCase().replace(/_/g, '-');
  if (when && when !== 'flow-start') return null;
  const measurement = condition.measurement_filter || condition.measurementFilter || {};
  const operator = String(measurement.operator || '').toLowerCase().replace(/_/g, '-');
  const value = Number(measurement.value);
  if (!Number.isFinite(value)) return null;
  if ((operator === 'equals' || operator === 'eq') && value === 0) return 'yes-means-not-ordered';
  if (operator === 'less-than' && value <= 1) return 'yes-means-not-ordered';
  if ((operator === 'greater-than' || operator === 'gt') && value === 0) return 'yes-means-ordered';
  if ((operator === 'greater-or-equal' || operator === 'gte') && value >= 1) return 'yes-means-ordered';
  if ((operator === 'equals' || operator === 'eq') && value >= 1) return 'yes-means-ordered';
  return null;
}

/**
 * How a Klaviyo flow can be entered from Jourvance.
 * List flows start when the profile is added to that list.
 * Metric flows start when an event with that metric name is created.
 * There is no Klaviyo call that drops a person into a flow by id.
 */
export function flowEntryFrom(flow) {
  const attrs = flow?.attributes || {};
  const trigger = Array.isArray(attrs.definition?.triggers) ? attrs.definition.triggers[0] : null;
  const raw = String(trigger?.type || attrs.trigger_type || '').toLowerCase();
  let triggerKind = 'other';
  if (raw === 'list' || raw.includes('list')) triggerKind = 'list';
  else if (raw === 'metric' || raw.includes('metric')) triggerKind = 'metric';
  const status = String(attrs.status || '').toLowerCase();
  return {
    id: String(flow?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40),
    name: String(attrs.name || 'Flow').slice(0, 120),
    status: status.slice(0, 20),
    triggerKind,
    listId: triggerKind === 'list' ? String(trigger?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) : '',
    listName: '',
    metricId: triggerKind === 'metric' ? String(trigger?.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) : '',
    metricName: ''
  };
}

const COMMERCE_METRICS = [
  { test: /placed order|ordered product/i, needs: 'order' },
  { test: /cancelled order|canceled order|refunded order|fulfilled order/i, needs: 'order' },
  { test: /started checkout|checkout started/i, needs: 'checkout' }
];

/** A commerce metric is sent only when this visit is that event. Custom metrics are allowed. */
export function metricHandoffAllowed(metricName, reason) {
  const name = String(metricName || '');
  if (!name) return false;
  if (/added to cart|viewed product/i.test(name)) return false;
  for (const row of COMMERCE_METRICS) {
    if (row.test.test(name)) return row.needs === reason;
  }
  return true;
}

async function metricName(apiKey, id, cache) {
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
  try {
    const metric = await klaviyoSend(apiKey, 'GET', `/api/metrics/${encodeURIComponent(id)}/`);
    cache[id] = String(metric?.data?.attributes?.name || '').slice(0, 120);
  } catch {
    cache[id] = '';
  }
  return cache[id];
}

export async function readFlowCatalog(apiKey, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
  let path = '/api/flows/?fields[flow]=name,status,archived,trigger_type&page[size]=50';
  const summaries = [];
  let moreFlows = false;
  while (path && summaries.length < limit) {
    const listed = await klaviyoSend(apiKey, 'GET', path);
    for (const flow of listed?.data || []) {
      if (flow?.attributes?.archived) continue;
      summaries.push(flow);
      if (summaries.length >= limit) break;
    }
    const next = nextPath(listed);
    if (summaries.length >= limit && next) moreFlows = true;
    path = summaries.length >= limit ? '' : next;
  }
  const names = {};
  const rows = [];
  for (const summary of summaries) {
    let detail = null;
    try {
      const full = await klaviyoSend(apiKey, 'GET', `/api/flows/${encodeURIComponent(summary.id)}/?additional-fields[flow]=definition`);
      detail = full?.data || null;
    } catch (err) {
      rows.push({ entry: flowEntryFrom(summary), detail: null, metricNames: {}, error: err.message });
      continue;
    }
    const entry = flowEntryFrom(detail || summary);
    for (const id of metricIdsIn(detail || summary)) await metricName(apiKey, id, names);
    if (entry.metricId) entry.metricName = names[entry.metricId] || '';
    rows.push({ entry, detail, metricNames: { ...names } });
  }
  return { rows, moreFlows };
}

function mapOperator(operator) {
  const op = String(operator || '').toLowerCase().replace(/_/g, '-');
  if (op === 'eq' || op === 'equals' || op === 'equal') return 'eq';
  if (op === 'neq' || op === 'not-equals' || op === 'not-equal' || op.includes('does-not-equal')) return 'neq';
  if (op === 'gt' || op === 'greater-than') return 'gt';
  if (op === 'lt' || op === 'less-than') return 'lt';
  if (op.includes('contain')) return 'contains';
  if (op.includes('not-set') || op.includes('does-not-exist') || op === 'unset') return 'unset';
  if (op.includes('exist') || op === 'set' || op === 'is-set') return 'set';
  return '';
}

function propertyKey(condition) {
  const raw = String(condition?.property || condition?.property_key || condition?.field || condition?.dimension || '');
  const bracket = raw.match(/\[['"]?([^'"\]]+)['"]?\]/);
  return String(bracket ? bracket[1] : raw).replace(/^properties\./, '').slice(0, 60);
}

function metricEventName(name) {
  const text = String(name || '');
  if (/placed order|ordered product/i.test(text)) return 'order';
  if (/partial/i.test(text) && /fulfill/i.test(text)) return 'order_partially_fulfilled';
  if (/fulfill/i.test(text)) return 'order_fulfilled';
  if (/cancel/i.test(text)) return 'order_cancelled';
  if (/refund/i.test(text)) return 'order_refunded';
  if (/viewed product/i.test(text)) return 'product_viewed';
  if (/added to cart/i.test(text)) return 'added_to_cart';
  if (/viewed collection/i.test(text)) return 'collection_viewed';
  if (/search/i.test(text)) return 'search_submitted';
  if (/checkout/i.test(text)) return 'checkout_start';
  return '';
}

function predictionMissing(prediction) {
  return prediction?.missing || 'at least 50 orders, at least 20 customers with two or more orders, and 90 days of history';
}

function translatedPrediction(condition, field) {
  const filter = condition.filter || condition;
  const op = mapOperator(filter.operator || condition.operator) || 'set';
  return { clause: { kind: 'profile', field, op, value: filter.value ?? condition.value ?? '' } };
}

function clauseFromCondition(condition, metricNames, prediction) {
  const type = String(condition?.type || '').replace(/_/g, '-').toLowerCase();
  const blob = JSON.stringify(condition || {}).toLowerCase();
  if (/predictive|predicted/.test(type) || /predicted clv|expected date of next order|churn risk|predicted gender/.test(blob) || isPredictionKey(propertyKey(condition))) {
    if (/gender/.test(blob)) {
      return { note: 'Predicted gender is not computed from this store. This path is everyone else.', clause: { kind: 'prediction', note: 'gender' } };
    }
    if (!prediction?.ready) {
      return { note: `A predictive check needs ${predictionMissing(prediction)}. Until then this path is everyone else.`, clause: { kind: 'prediction', note: 'prediction' } };
    }
    if (/churn/.test(blob)) return translatedPrediction(condition, 'churn');
    if (/next order|expected date/.test(blob)) return translatedPrediction(condition, 'expectedNextOrderAt');
    if (/historic/.test(blob) && !/predicted/.test(blob)) {
      return { note: 'Historic value stays the order total on this store. This path is everyone else.', clause: { kind: 'prediction', note: 'historic' } };
    }
    if (/clv|predicted value|predicted_clv|predictedvalue/.test(blob) || /predictive/.test(type)) return translatedPrediction(condition, 'predictedValue');
    return { note: 'That predictive check is not computed from this store. This path is everyone else.', clause: { kind: 'prediction', note: 'prediction' } };
  }
  if (type.includes('profile-property')) {
    const field = propertyKey(condition);
    const filter = condition.filter || condition;
    const op = mapOperator(filter.operator || condition.operator);
    if (!field || !op || isPredictionKey(field)) return { note: 'A profile field check was not copied.', clause: { kind: 'unsupported', note: 'profile' } };
    return { clause: { kind: 'profile', field, op, value: filter.value ?? condition.value ?? '' } };
  }
  if (type === 'profile-metric') {
    const metricId = String(condition.metric_id || condition.metricId || '');
    const name = String(metricNames?.[metricId] || condition.metric_name || '');
    const event = metricEventName(name);
    const timeframe = condition.timeframe_filter || condition.timeframeFilter || {};
    const when = String(timeframe.operator || '').toLowerCase().replace(/_/g, '-');
    let since = 'enroll';
    if (when && when !== 'flow-start') {
      const quantity = Number(timeframe.quantity || timeframe.value || 0);
      const unit = String(timeframe.unit || 'day').toLowerCase();
      const days = unit.startsWith('hour') ? Math.max(1, Math.ceil(quantity / 24)) : unit.startsWith('week') ? quantity * 7 : quantity;
      if (days > 0) since = Math.round(days);
    }
    const measurement = condition.measurement_filter || condition.measurementFilter || {};
    const operator = String(measurement.operator || '').toLowerCase().replace(/_/g, '-');
    const value = Number(measurement.value);
    const done = !(((operator === 'equals' || operator === 'eq') && value === 0) || (operator === 'less-than' && value <= 1));
    if (!event) {
      const label = name ? `A “${name}” check matches nobody until that event is recorded here.` : 'A has-done check was not copied, so that path is everyone else.';
      return { note: label, clause: { kind: 'unsupported', note: label } };
    }
    return { clause: { kind: 'did', event, since, done } };
  }
  if (type.includes('dimension') || type.includes('event-property') || type.includes('metric-property')) {
    const field = propertyKey(condition);
    const filter = condition.filter || condition;
    const op = mapOperator(filter.operator || condition.operator);
    if (!field || !op) return { note: 'A trigger field check was not copied.', clause: { kind: 'unsupported', note: 'event' } };
    return { clause: { kind: 'event_field', field, op, value: filter.value ?? '' } };
  }
  if (type.includes('consent') || type.includes('marketing')) {
    return { clause: { kind: 'consent', channel: /sms/.test(blob) ? 'sms' : 'email', can: !/cannot|unsub|never|not-consent/.test(blob) } };
  }
  if (type.includes('group') || type.includes('list')) {
    const listId = String(condition.group_id || condition.list_id || condition.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!listId) return { note: 'A list check was not copied.', clause: { kind: 'unsupported', note: 'list' } };
    return { clause: { kind: 'list', listId, member: !/not-in|not in|none/.test(blob) } };
  }
  if (type.includes('random') || type.includes('sample')) {
    return { clause: { kind: 'random', percent: Math.max(0, Math.min(100, Math.round(Number(condition.percentage || condition.percent || condition.value || 50)))) } };
  }
  const note = type ? `A ${type} check was not copied, so that path is everyone else.` : 'A split check was not copied, so that path is everyone else.';
  return { note, clause: { kind: 'unsupported', note } };
}

function clausesFor(conditions, metricNames, note, prediction) {
  const clauses = [];
  for (const condition of conditions || []) {
    const mapped = clauseFromCondition(condition, metricNames, prediction);
    if (mapped.note) note(mapped.note);
    if (mapped.clause) clauses.push(mapped.clause);
  }
  return clauses;
}

function predictedLabel(label, clauses) {
  const uses = (clauses || []).some((clause) => clause.kind === 'prediction' || ['predictedValue', 'expectedNextOrderAt', 'predictedValue365', 'churn'].includes(clause.field));
  if (!uses || /predicted/i.test(label)) return label;
  return `${label} (predicted)`.slice(0, 80);
}

function splitRoutes(action, metricNames, note, prediction) {
  const links = linksOf(action);
  const raw = action.data?.branches || action.data?.paths;
  if (Array.isArray(raw) && raw.length >= 2) {
    const paths = [];
    const routes = {};
    raw.slice(0, 19).forEach((branch, index) => {
      const id = String(branch.id || `p${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `p${index + 1}`;
      const groups = branch.condition_groups || branch.conditionGroups || [];
      if (groups.length > 1) note('A split used more than one or-group. Only the first group was copied.');
      const conditions = groups[0]?.conditions || branch.conditions || [];
      const clauses = clausesFor(conditions, metricNames, note, prediction);
      paths.push({ id, label: predictedLabel(String(branch.name || branch.label || `Path ${index + 1}`).slice(0, 80), clauses), clauses });
      routes[id] = String(branch.next || branch.next_id || branch.action_id || '');
    });
    paths.push({ id: 'else', label: 'Everyone else', else: true, clauses: [] });
    routes.else = links.next;
    return { paths, routes };
  }
  const polarity = splitOrderPolarity(action, metricNames);
  if (polarity) {
    note('An order split was rebuilt. Yes means they ordered after joining.');
    return {
      paths: [
        { id: 'yes', label: 'Ordered after joining', clauses: [{ kind: 'did', event: 'order', since: 'enroll', done: true }] },
        { id: 'no', label: 'Everyone else', else: true, clauses: [] }
      ],
      routes: {
        yes: polarity === 'yes-means-ordered' ? links.yes : links.no,
        no: polarity === 'yes-means-ordered' ? links.no : links.yes
      }
    };
  }
  const filter = action.data?.profile_filter || action.data?.profileFilter || action.data?.trigger_filter || action.data?.triggerFilter || null;
  const groups = filter?.condition_groups || filter?.conditionGroups || [];
  if (groups.length > 1) note('A split used more than one or-group. Only the first group was copied.');
  const conditions = groups[0]?.conditions || conditionsOf(action);
  const clauses = clausesFor(conditions, metricNames, note, prediction);
  return {
    paths: [
      { id: 'yes', label: predictedLabel('Yes', clauses), clauses },
      { id: 'no', label: 'Everyone else', else: true, clauses: [] }
    ],
    routes: { yes: links.yes, no: links.no }
  };
}

function messageStatus(action) {
  const status = String(action?.data?.status || action?.data?.message?.status || action?.status || '').toLowerCase();
  if (status === 'draft') return 'draft';
  if (status === 'manual') return 'review';
  return 'live';
}

function weightOf(variation) {
  const allocation = Number(variation?.allocation);
  if (Number.isFinite(allocation) && allocation > 0 && allocation <= 1) return Math.max(1, Math.round(allocation * 100));
  const weight = Number(variation?.weight);
  if (Number.isFinite(weight) && weight > 0) return Math.max(1, Math.round(weight));
  return 1;
}

function abVariations(action, byId) {
  const lists = [action.data?.variations, action.data?.experiment?.variations, action.data?.current_experiment?.variations].find(Array.isArray) || [];
  const variations = [];
  const absorbed = [];
  for (const variation of lists) {
    const linkedId = String(variation.action_id || variation.path_id || '');
    const message = variation.message || (linkedId ? byId.get(linkedId)?.data?.message : null) || {};
    variations.push({
      id: String(variation.id || `v${variations.length + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `v${variations.length + 1}`,
      weight: weightOf(variation),
      subject: String(message.subject_line || message.subject || '').slice(0, 200),
      previewText: String(message.preview_text || '').slice(0, 140),
      fromName: String(message.from_label || message.from_name || '').slice(0, 80)
    });
    if (linkedId) absorbed.push(linkedId);
  }
  const linkVars = action.links?.variations;
  if (variations.length < 2 && linkVars && typeof linkVars === 'object') {
    for (const [id, actionId] of Object.entries(linkVars)) {
      const message = byId.get(String(actionId))?.data?.message || {};
      variations.push({
        id: String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `v${variations.length + 1}`,
        weight: 1,
        subject: String(message.subject_line || '').slice(0, 200),
        previewText: String(message.preview_text || '').slice(0, 140),
        fromName: String(message.from_label || '').slice(0, 80)
      });
      absorbed.push(String(actionId));
    }
  }
  return { variations, absorbed };
}

function dateSettingsFrom(flow) {
  const trigger = flow?.attributes?.definition?.triggers?.[0] || {};
  const dateField = String(trigger.date_property || trigger.date_field || trigger.property || '').slice(0, 60);
  const unit = String(trigger.before_unit || trigger.offset_unit || 'day').toLowerCase();
  let days = Number(trigger.days_before ?? trigger.before ?? trigger.offset_days ?? trigger.offset ?? 0);
  if (!Number.isFinite(days)) days = 0;
  if (unit.startsWith('week')) days *= 7;
  if (unit.startsWith('month')) days *= 30;
  const repeatRaw = String(trigger.repeat || trigger.recurrence || '').toLowerCase();
  const dateRepeat = repeatRaw.includes('month') ? 'monthly' : (repeatRaw.includes('year') || repeatRaw.includes('annual') ? 'yearly' : 'once');
  return { dateField, dateOffsetDays: Math.max(0, Math.round(days)), dateRepeat, repeatKnown: Boolean(repeatRaw) };
}

/**
 * Rebuild one Klaviyo flow as a Jourvance graph.
 * Waits keep minutes, clock time, and weekdays. Both sides of a split are kept.
 * A/B variations are stored and no winner is chosen. Copied flows stay off.
 * Returns { ok:false, reason } when nothing we can run was copied.
 */
export function flowFromKlaviyo(flow, options = {}) {
  const definition = flow?.attributes?.definition;
  const actions = Array.isArray(definition?.actions) ? definition.actions : [];
  const name = String(flow?.attributes?.name || 'Klaviyo flow').slice(0, 60);
  const triggerLabel = String(flow?.attributes?.trigger_type || definition?.triggers?.[0]?.type || 'trigger');
  const metricNames = options.metricNames || {};
  const triggerMetric = options.metricName || metricNames[String(definition?.triggers?.[0]?.id || '')] || '';
  if (!actions.length) return { ok: false, reason: `${name}: Klaviyo did not include the steps.` };
  const byId = new Map(actions.map((action) => [String(action.id || action.temporary_id || ''), action]));
  const nodes = [{ id: 'n_start', type: 'trigger' }];
  const edges = [];
  const made = new Map();
  const skip = new Set();
  const notes = [];
  const noted = new Set();
  let sendable = false;
  let seq = 1;
  const note = (text) => {
    if (!text || noted.has(text) || notes.length >= 12) return;
    noted.add(text);
    notes.push(text);
  };
  function addEdge(source, target, branch) {
    if (!source || !target) return;
    edges.push({ id: `e${edges.length}_${branch || 'n'}`.slice(0, 40), source, target, branch: branch || '' });
  }
  function addNode(klaviyoId, row) {
    if (nodes.length >= 60) {
      note('The flow was longer than 60 steps, so the rest was left out.');
      return '';
    }
    const id = `n_${seq++}`;
    nodes.push({ id, ...row });
    made.set(String(klaviyoId), id);
    if (['email', 'sms', 'ab', 'profile', 'list', 'alert', 'webhook', 'restock'].includes(row.type)) sendable = true;
    return id;
  }
  function walk(parentId, branch, actionId, stack = new Set()) {
    if (!actionId) return false;
    const key = String(actionId);
    if (made.has(key)) {
      addEdge(parentId, made.get(key), branch);
      return true;
    }
    if (stack.has(key)) {
      note('A loop in the Klaviyo flow was not copied.');
      return false;
    }
    const action = byId.get(key);
    if (!action) return false;
    const nextStack = new Set(stack);
    nextStack.add(key);
    if (skip.has(key)) return walk(parentId, branch, linksOf(action).next, nextStack);
    const type = String(action.type || '').replace(/_/g, '-').toLowerCase();
    const links = linksOf(action);
    if (type === 'conditional-split' || type === 'trigger-split' || type === 'trigger-branch') {
      const split = splitRoutes(action, metricNames, note, options.prediction);
      const id = addNode(key, { type: 'condition', paths: split.paths });
      if (!id) return false;
      addEdge(parentId, id, branch);
      for (const path of split.paths) walk(id, path.id, split.routes[path.id], nextStack);
      return true;
    }
    if (type === 'ab-test') {
      const built = abVariations(action, byId);
      if (built.variations.length < 2) {
        note('An A/B test had fewer than two variations, so the following message was copied. Jourvance does not pick a winner.');
        const chosen = links.next || links.yes || links.no;
        return chosen ? walk(parentId, branch, chosen, nextStack) : false;
      }
      note('An A/B test was copied with its variations. Jourvance does not pick a winner.');
      for (const absorbed of built.absorbed) skip.add(absorbed);
      const id = addNode(key, { type: 'ab', status: messageStatus(action), variations: built.variations });
      if (!id) return false;
      addEdge(parentId, id, branch);
      let next = links.next;
      if (!next || built.absorbed.includes(next)) {
        const successors = built.absorbed.map((item) => linksOf(byId.get(item)).next).filter(Boolean);
        if (successors.length > 1 && successors.some((item) => item !== successors[0])) {
          note('An A/B test’s following steps did not meet again, so the steps after the first variation were kept.');
        }
        next = successors[0] || '';
      }
      return next ? walk(id, '', next, nextStack) : true;
    }
    if (type === 'time-delay' || type === 'countdown-delay') {
      if (type === 'countdown-delay') note('A countdown was copied as a wait. It is not a predicted next-order date.');
      const id = addNode(key, delayNodeFrom(action));
      if (!id) return false;
      addEdge(parentId, id, branch);
      return walk(id, '', links.next, nextStack) || true;
    }
    if (type === 'target-date') {
      note('A target-date step uses the date on the trigger. It was not copied as an extra wait.');
      skip.add(key);
      return walk(parentId, branch, links.next, nextStack);
    }
    if (type === 'back-in-stock-delay') {
      const data = action.data || {};
      const id = addNode(key, {
        type: 'restock',
        variantId: String(data.variant_id || data.variantId || '').slice(0, 40),
        minimum: Number(data.minimum_inventory || data.inventory_minimum || data.minimum || 1),
        capDays: Number(data.cap_days || 30)
      });
      if (!id) return false;
      addEdge(parentId, id, branch);
      return walk(id, '', links.next, nextStack) || true;
    }
    if (type === 'send-email') {
      const message = action.data?.message || {};
      const id = `n_${seq++}`;
      if (nodes.length >= 60) {
        note('The flow was longer than 60 steps, so the rest was left out.');
        return false;
      }
      const preview = String(message.preview_text || '').trim();
      const templateId = String(message.template_id || message.templateId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
      const text = preview || (templateId
        ? 'This step came from Klaviyo. The template was not copied, so only the subject was kept.'
        : 'This step came from Klaviyo. The template HTML was not in the flow definition, so only the subject was copied.');
      nodes.push({
        id, type: 'email',
        subject: String(message.subject_line || message.name || 'A note from the store').slice(0, 200),
        previewText: preview.slice(0, 140),
        fromName: String(message.from_label || message.from_name || '').slice(0, 80),
        replyTo: String(message.reply_to_email || '').slice(0, 120),
        templateId,
        status: messageStatus(action),
        transactional: message.transactional === true || message.is_transactional === true,
        smartSkip: message.smart_sending_enabled === true || action.data?.smart_sending_enabled === true,
        blocks: [{ id: `${id}_b`, kind: 'text', text }]
      });
      made.set(key, id);
      addEdge(parentId, id, branch);
      sendable = true;
      walk(id, '', links.next, nextStack);
      return true;
    }
    if (type === 'send-sms') {
      const body = String(action.data?.message?.body || '').trim();
      if (!body) {
        note('A text step had no message, so it was left out.');
        return walk(parentId, branch, links.next, nextStack);
      }
      const id = addNode(key, { type: 'sms', message: body.slice(0, 480), status: messageStatus(action), smartSkip: action.data?.smart_sending_enabled === true });
      if (!id) return false;
      addEdge(parentId, id, branch);
      walk(id, '', links.next, nextStack);
      return true;
    }
    if (type === 'update-profile') {
      const ops = action.data?.profile_operations || action.data?.profileOperations || [];
      const rows = (Array.isArray(ops) && ops.length ? ops : []).map((op) => ({
        type: 'profile',
        update: /delete|remove|clear/.test(String(op.operator || op.operation || '').toLowerCase()) ? 'clear' : 'set',
        key: String(op.property_key || op.propertyKey || op.key || '').slice(0, 60),
        valueType: ['number', 'boolean'].includes(String(op.property_type || op.propertyType || '').toLowerCase()) ? String(op.property_type || op.propertyType).toLowerCase() : 'string',
        value: op.property_value ?? op.propertyValue ?? op.value ?? ''
      })).filter((row) => row.key);
      const kept = rows.filter((row) => !isPredictionKey(row.key));
      if (kept.length !== rows.length) note('A predicted profile field was not copied.');
      if (!kept.length) return walk(parentId, branch, links.next, nextStack);
      let currentParent = parentId;
      let currentBranch = branch;
      let firstId = '';
      for (const row of kept) {
        const id = addNode(firstId ? `${key}_${row.key}` : key, row);
        if (!id) break;
        if (!firstId) firstId = id;
        addEdge(currentParent, id, currentBranch);
        currentParent = id;
        currentBranch = '';
      }
      return walk(currentParent, '', links.next, nextStack) || true;
    }
    if (type === 'list-update' || type === 'update-list') {
      const data = action.data || {};
      const listId = String(data.list_id || data.listId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      const update = /remove|delete/.test(JSON.stringify(data).toLowerCase()) ? 'remove' : 'add';
      if (!listId) {
        note('A list update had no list, so it was left out.');
        return walk(parentId, branch, links.next, nextStack);
      }
      const id = addNode(key, { type: 'list', update, listId });
      if (!id) return false;
      addEdge(parentId, id, branch);
      return walk(id, '', links.next, nextStack) || true;
    }
    if (type === 'send-internal-alert' || type === 'internal-alert') {
      const message = action.data?.message || action.data || {};
      const list = message.to_emails || message.toEmails || message.emails || [];
      const to = String((Array.isArray(list) ? list[0] : '') || message.to || message.email || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        note('An alert had no email address, so it was left out.');
        skip.add(key);
        return walk(parentId, branch, links.next, nextStack);
      }
      if (Array.isArray(list) && list.length > 1) note('An alert had more than one address. The first address was kept.');
      const id = addNode(key, { type: 'alert', to });
      if (!id) return false;
      addEdge(parentId, id, branch);
      return walk(id, '', links.next, nextStack) || true;
    }
    if (type === 'send-webhook' || type === 'webhook') {
      const message = action.data?.message || {};
      const url = String(message.url || action.data?.url || '');
      const template = String(message.body || action.data?.body || '{"email":"{{email}}"}').slice(0, 4000);
      const check = publicHttpsUrl(url);
      if (!check.ok) {
        note('A webhook was not copied because its address is not public https.');
        skip.add(key);
        return walk(parentId, branch, links.next, nextStack);
      }
      if (message.headers || action.data?.headers) note('Webhook headers were not copied.');
      const id = addNode(key, { type: 'webhook', url: check.url, template });
      if (!id) return false;
      addEdge(parentId, id, branch);
      return walk(id, '', links.next, nextStack) || true;
    }
    if (type) note(`A ${type} step was left out.`);
    skip.add(key);
    return links.next || links.yes ? walk(parentId, branch, links.next || links.yes, nextStack) : false;
  }
  const entry = String(definition.entry_action_id || definition.entryActionId || actions[0]?.id || actions[0]?.temporary_id || '');
  walk('n_start', '', entry);
  const trigger = jourvanceTrigger(flow, triggerMetric);
  const date = trigger === 'date_property' ? dateSettingsFrom(flow) : null;
  if (date && isPredictionKey(date.dateField)) {
    const flat = date.dateField.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nextOrder = /nextorder|expecteddateofnextorder|expectednextorder/.test(flat);
    if (nextOrder && options.prediction?.ready) {
      date.dateField = 'expectedNextOrderAt';
      note('This date flow uses the predicted next order from this store.');
    } else if (!options.prediction?.ready) {
      note(`A predicted date needs ${predictionMissing(options.prediction)}. This date flow enrolls nobody until that date is computed.`);
      date.dateField = '';
    } else {
      note('That predicted date is not computed from this store. This date flow enrolls nobody until you name a date stored on the contact.');
      date.dateField = '';
    }
  }
  if (PENDING_TRIGGER[trigger]) note(`This starts when ${PENDING_TRIGGER[trigger]} is recorded. The flow stays off until you turn it on.`);
  if (date && !date.dateField) note('The date field was not in the Klaviyo trigger, so this date flow enrolls nobody until you name the field.');
  else if (date && !date.repeatKnown) note('Repeat was not on the Klaviyo trigger, so this date flow runs once.');
  if (trigger === 'manual') {
    if (triggerMetric) note(`In Klaviyo this starts on “${triggerMetric}”. It stays manual here until you choose a start.`);
    else if (!/list|segment|date|price|inventory/i.test(triggerLabel)) note(`In Klaviyo this starts on ${triggerLabel}. It stays manual here until you choose a start.`);
  }
  if (!sendable) return { ok: false, reason: `${name}: ${notes[0] || 'No step we can run was in the copied path.'}` };
  const predictive = nodes.some((node) => node.type === 'condition' && (node.paths || []).some((path) => (path.clauses || []).some((clause) => clause.kind === 'prediction' || ['predictedValue', 'expectedNextOrderAt', 'predictedValue365', 'churn'].includes(clause.field)))) || date?.dateField === 'expectedNextOrderAt';
  let flowName = `Klaviyo: ${name}`;
  if (predictive && !/predicted/i.test(flowName)) flowName = `${flowName} (predicted)`;
  return {
    ok: true,
    flow: {
      name: flowName.slice(0, 80),
      trigger,
      reentry: 'once',
      klaviyoFlowId: String(flow.id || '').slice(0, 40),
      nodes,
      edges,
      notes,
      triggerLabel,
      ...(date ? { dateField: date.dateField, dateOffsetDays: date.dateOffsetDays, dateRepeat: date.dateRepeat } : {})
    },
    note: notes.join(' ')
  };
}

export function e164(phone) {
  const raw = String(phone || '').trim();
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : '';
}
