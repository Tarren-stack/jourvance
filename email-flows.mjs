/**
 * Flow graph: save-time checks, delay math, split matching, and one step of the runner.
 * Sending, webhooks, and contact writes stay in server.mjs. An enrollment that already
 * has a program array is the old flattened walker and is not read here.
 */
import { createHash } from 'node:crypto';

export const FLOW_LIMIT = 100;
export const FLOW_NODE_LIMIT = 60;
export const FLOW_EDGE_LIMIT = 120;
export const FLOW_PATH_LIMIT = 20;
export const SMART_EMAIL_HOURS = 16;
export const SMART_SMS_HOURS = 24;

export const FLOW_TRIGGERS = new Set([
  'lead_capture', 'exit_intent', 'checkout_abandonment', 'order_paid', 'quiet_buyer', 'manual',
  'list_added', 'segment_entered', 'product_viewed', 'collection_viewed', 'search_submitted',
  'added_to_cart', 'order_fulfilled', 'order_partially_fulfilled', 'order_cancelled', 'order_refunded',
  'date_property', 'price_drop', 'low_inventory', 'back_in_stock'
]);

const EVENT_READY = new Set([
  'lead_capture', 'exit_intent', 'checkout_abandonment', 'order_paid', 'quiet_buyer', 'manual',
  'list_added', 'segment_entered', 'date_property',
  'product_viewed', 'collection_viewed', 'search_submitted', 'added_to_cart',
  'order_fulfilled', 'order_partially_fulfilled', 'order_cancelled', 'order_refunded',
  'price_drop', 'low_inventory', 'back_in_stock'
]);

export const TRIGGER_META = [
  { id: 'lead_capture', label: 'New lead', help: 'Starts when someone joins from a page or signup form.' },
  { id: 'exit_intent', label: 'Exit offer', help: 'Starts when someone submits an exit offer.' },
  { id: 'checkout_abandonment', label: 'Left checkout', help: 'Starts from an unfinished checkout. It can stop if an order is recorded after that.' },
  { id: 'order_paid', label: 'Order paid', help: 'Starts when a paid order is recorded.' },
  { id: 'quiet_buyer', label: 'Quiet buyer', help: 'Starts when their last recorded order is older than the quiet period. It can stop if they order again.' },
  { id: 'manual', label: 'By hand', help: 'Starts only when you enroll an email on a flow that is turned on.' },
  { id: 'list_added', label: 'Added to a list', help: 'Starts when someone is added to a list and was not already on it. Removing them does not unsubscribe them.' },
  { id: 'date_property', label: 'Date on the contact', help: 'Starts at 8:00 in the account timezone on the stored date, or that many days before. Predicted next order is used only when this store has computed that date. Yearly and monthly start again only when re-entry allows another start.' },
  { id: 'segment_entered', label: 'Entered a segment', help: 'Starts when someone newly matches a segment. Leaving and coming back can start it again.' },
  { id: 'product_viewed', label: 'Viewed a product', help: 'Starts when a product view from a Jourvance page or the Shopify pixel is tied to an email.' },
  { id: 'collection_viewed', label: 'Viewed a collection', help: 'Starts when a collection view is tied to an email.' },
  { id: 'search_submitted', label: 'Searched', help: 'Starts when a search from the Shopify pixel is tied to an email.' },
  { id: 'added_to_cart', label: 'Added to cart', help: 'Starts when an add to cart is tied to an email. A checkout link does not count as an add to cart.' },
  { id: 'order_fulfilled', label: 'Order fulfilled', help: 'Starts when Shopify sends a fulfillment that is not marked partial.' },
  { id: 'order_partially_fulfilled', label: 'Order partly fulfilled', help: 'Starts when Shopify sends a fulfillment marked partial.' },
  { id: 'order_cancelled', label: 'Order cancelled', help: 'Starts when Shopify sends a cancellation.' },
  { id: 'order_refunded', label: 'Order refunded', help: 'Starts when Shopify sends a refund.' },
  { id: 'price_drop', label: 'Price drop', help: 'Starts when a stored variant price falls by this flow’s amount or percent, the variant is published, and stock is above zero. A missing stored price does not count.' },
  { id: 'low_inventory', label: 'Low inventory', help: 'Starts when available stock is above zero and at or below this flow’s threshold, for people who viewed or started checkout on that variant.' },
  { id: 'back_in_stock', label: 'Back in stock', help: 'Starts when someone who asked is told that the variant is available again. Each request is used once per restock. Past buyers are not added.' }
].map((row) => ({ ...row, events: EVENT_READY.has(row.id) }));

export const KNOWN_EVENTS = new Set([
  'order', 'email_sent', 'sms_sent', 'lead', 'checkout_start', 'page_view',
  'product_viewed', 'added_to_cart', 'collection_viewed', 'search_submitted',
  'order_fulfilled', 'order_partially_fulfilled', 'order_cancelled', 'order_refunded'
]);

const NODE_TYPES = new Set(['trigger', 'delay', 'email', 'condition', 'sms', 'ab', 'profile', 'list', 'alert', 'webhook', 'restock']);
const WEEKDAY = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

const READABLE_PREDICTION = new Set(['predictedvalue', 'expectednextorderat', 'predictedvalue365', 'churn']);

export function isReadablePredictionField(field) {
  return READABLE_PREDICTION.has(String(field || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function readablePrediction(field) {
  return isReadablePredictionField(field);
}

function hourOrNull(value) {
  if (value == null || value === '') return null;
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

const PREDICTION_KEYS = new Set([
  'predictedvalue', 'predictedclv', 'historicclv', 'totalclv',
  'churn', 'churnrisk', 'churnprobability',
  'expectednextorder', 'expectednextorderat', 'expecteddateofnextorder', 'expectednextorderdate',
  'predictedvalue365',
  'predictedgender', 'predictiveanalytics',
  'averagedaysbetweenorders', 'averagetimebetweenorders', 'predictedordercount'
]);

export function isPredictionKey(key) {
  const flat = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return PREDICTION_KEYS.has(flat);
}

export function isIanaTimezone(value) {
  const zone = String(value || '');
  if (!zone || zone.length > 80 || zone === 'UTC') return zone === 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function flowShapeError(input) {
  if ((Array.isArray(input?.nodes) ? input.nodes.length : 0) > FLOW_NODE_LIMIT) return 'A flow can have 60 steps.';
  return '';
}

function cleanWeekdays(input) {
  const days = [];
  for (const item of Array.isArray(input) ? input : []) {
    const day = typeof item === 'number' ? item : WEEKDAY[String(item || '').toLowerCase()];
    if (day >= 0 && day <= 6 && !days.includes(day)) days.push(day);
  }
  return days.slice(0, 7);
}

function cleanClauses(input) {
  const out = [];
  for (const clause of Array.isArray(input) ? input : []) {
    const kind = String(clause?.kind || '');
    if (kind === 'profile' || kind === 'event_field') {
      const op = ['set', 'unset', 'eq', 'neq', 'gt', 'lt', 'contains'].includes(clause.op) ? clause.op : '';
      const field = String(clause.field || '').slice(0, 60);
      if (!op || !field || (isPredictionKey(field) && !readablePrediction(field))) continue;
      out.push({ kind, field, op, value: cleanValue(clause.value) });
    } else if (kind === 'did') {
      const event = String(clause.event || '').slice(0, 40);
      if (!event) continue;
      const since = clause.since === 'enroll' ? 'enroll' : Math.max(1, Math.min(3650, Number(clause.since) || 0));
      if (since === 0) continue;
      out.push({ kind, event, since, done: clause.done !== false });
    } else if (kind === 'list') {
      const listId = String(clause.listId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
      if (!listId) continue;
      out.push({ kind, listId, member: clause.member !== false });
    } else if (kind === 'consent') {
      out.push({ kind, channel: clause.channel === 'sms' ? 'sms' : 'email', can: clause.can !== false });
    } else if (kind === 'random') {
      out.push({ kind, percent: Math.max(0, Math.min(100, Math.round(Number(clause.percent) || 0))) });
    } else if (kind === 'prediction' || kind === 'unsupported') {
      out.push({ kind, note: String(clause.note || '').slice(0, 240) });
    }
    if (out.length >= 12) break;
  }
  return out;
}

function cleanValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return String(value ?? '').slice(0, 200);
}

function defaultPaths() {
  return [
    { id: 'yes', label: 'Ordered after joining', else: false, clauses: [{ kind: 'did', event: 'order', since: 'enroll', done: true }], note: '' },
    { id: 'no', label: 'Everyone else', else: true, clauses: [], note: '' }
  ];
}

function cleanPaths(node) {
  const source = Array.isArray(node?.paths) && node.paths.length ? node.paths : defaultPaths();
  const paths = [];
  const seen = new Set();
  for (const path of source.slice(0, FLOW_PATH_LIMIT)) {
    let id = String(path?.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!id || seen.has(id)) id = `p${paths.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const clauses = path?.else ? [] : cleanClauses(path?.clauses);
    let label = String(path?.label || (path?.else ? 'Everyone else' : 'Path')).slice(0, 80);
    if (!path?.else && clauses.some((clause) => clause.kind === 'prediction' || readablePrediction(clause.field)) && !/predicted/i.test(label)) {
      label = `${label} (predicted)`.slice(0, 80);
    }
    paths.push({
      id,
      label,
      else: false,
      clauses,
      note: String(path?.note || '').slice(0, 240)
    });
  }
  if (!paths.length) return defaultPaths();
  const last = paths[paths.length - 1];
  last.else = true;
  last.clauses = [];
  if (!last.label) last.label = 'Everyone else';
  return paths;
}

function cleanVariations(node, cleanBlocks) {
  const source = Array.isArray(node?.variations) ? node.variations : [];
  return source.slice(0, 10).map((variation, index) => {
    const id = String(variation?.id || `v${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || `v${index + 1}`;
    return {
      id,
      weight: Math.max(1, Math.min(100, Math.round(Number(variation?.weight) || 1))),
      subject: String(variation?.subject || '').slice(0, 200),
      previewText: String(variation?.previewText || '').slice(0, 140),
      fromName: String(variation?.fromName || '').slice(0, 80),
      blocks: cleanBlocks(variation?.blocks, [])
    };
  });
}

function messageFields(node, cleanBlocks, fallbackText) {
  const fields = {
    subject: String(node.subject || 'A note from the store').slice(0, 200),
    previewText: String(node.previewText || '').slice(0, 140),
    fromName: String(node.fromName || '').slice(0, 80),
    replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(node.replyTo || '')) ? String(node.replyTo).slice(0, 120) : '',
    blocks: cleanBlocks(node.blocks, fallbackText ? [{ id: `${node.id || 'b'}_b`, kind: 'text', text: fallbackText }] : []),
    status: ['draft', 'review', 'live'].includes(node.status) ? node.status : 'live',
    transactional: node.transactional === true,
    smartSkip: node.smartSkip === true,
    sendTime: node.sendTime === 'smart' ? 'smart' : '',
    fallbackHour: hourOrNull(node.fallbackHour),
    filter: cleanClauses(node.filter)
  };
  const percent = node?.holdout?.enabled === true ? Math.round(Number(node.holdout.percent)) : 0;
  if (percent >= 1 && percent <= 90) fields.holdout = { enabled: true, percent };
  return fields;
}

export function cleanFlow(input, deps = {}) {
  const cleanBlocks = typeof deps.cleanBlocks === 'function' ? deps.cleanBlocks : ((blocks) => Array.isArray(blocks) ? blocks : []);
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id || '');
  if (!/^flow_[a-z0-9]+$/.test(id)) return null;
  const trigger = FLOW_TRIGGERS.has(input.trigger) ? input.trigger : 'manual';
  const seen = new Set();
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).slice(0, FLOW_NODE_LIMIT).map((node, index) => {
    const nodeId = String(node?.id || `n_${index}`).replace(/\s/g, '').slice(0, 40);
    if (!nodeId || seen.has(nodeId)) return null;
    seen.add(nodeId);
    const type = NODE_TYPES.has(node?.type) ? node.type : '';
    if (!type) return null;
    const row = { id: nodeId, type };
    if (type === 'delay') {
      const minutes = Number.isFinite(Number(node.delayMinutes)) ? Number(node.delayMinutes) : (Number(node.delayHours) || 0) * 60;
      row.delayMinutes = Math.max(0, Math.min(90 * 24 * 60, Math.round(minutes)));
      row.mode = node.mode === 'clock' || (Array.isArray(node.weekdays) && node.weekdays.length) ? 'clock' : 'duration';
      row.clockHour = Math.max(0, Math.min(23, Math.round(Number(node.clockHour) || 0)));
      row.clockMinute = Math.max(0, Math.min(59, Math.round(Number(node.clockMinute) || 0)));
      row.weekdays = cleanWeekdays(node.weekdays);
      row.timezone = node.timezone === 'profile' ? 'profile' : 'account';
    }
    if (type === 'email') {
      Object.assign(row, messageFields(node, cleanBlocks, String(node.body || '')));
      if (node.klaviyoFlowId) row.klaviyoFlowId = String(node.klaviyoFlowId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    }
    if (type === 'sms') {
      row.message = String(node.message || '').slice(0, 480);
      row.status = ['draft', 'review', 'live'].includes(node.status) ? node.status : 'live';
      row.transactional = node.transactional === true;
      row.smartSkip = node.smartSkip === true;
      if (node.quietHours === true || node.quietHours === false) row.quietHours = node.quietHours;
      const couponName = String(node.coupon?.name || '').replace(/[^\w .'-]/g, '').trim().slice(0, 40);
      if (couponName) {
        row.coupon = {
          name: couponName,
          discountType: node.coupon?.discountType === 'fixed_amount' || node.coupon?.discountType === 'free_shipping' ? node.coupon.discountType : 'percentage',
          value: Math.max(0, Math.min(100000, Number(node.coupon?.value) || 0)),
          prefix: String(node.coupon?.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
        };
      }
      row.filter = cleanClauses(node.filter);
    }
    if (type === 'condition') row.paths = cleanPaths(node);
    if (type === 'ab') {
      Object.assign(row, messageFields(node, cleanBlocks, ''));
      row.variations = cleanVariations(node, cleanBlocks);
    }
    if (type === 'profile') {
      row.update = node.update === 'clear' || node.op === 'clear' ? 'clear' : 'set';
      row.key = String(node.key || '').slice(0, 60);
      row.valueType = ['number', 'boolean'].includes(node.valueType) ? node.valueType : 'string';
      row.value = row.valueType === 'number' ? Number(node.value) : row.valueType === 'boolean' ? node.value === true || node.value === 'true' : String(node.value ?? '').slice(0, 200);
    }
    if (type === 'list') {
      row.update = node.update === 'remove' || node.op === 'remove' ? 'remove' : 'add';
      row.listId = String(node.listId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    }
    if (type === 'alert') row.to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(node.to || '')) ? String(node.to).slice(0, 120) : '';
    if (type === 'webhook') {
      row.url = String(node.url || '').slice(0, 500);
      row.template = String(node.template || '').slice(0, 4000);
    }
    if (type === 'restock') {
      row.variantId = String(node.variantId || '').slice(0, 40);
      row.minimum = Math.max(1, Math.min(100000, Math.round(Number(node.minimum) || 1)));
      row.capDays = Math.max(1, Math.min(90, Math.round(Number(node.capDays) || 30)));
    }
    return row;
  }).filter(Boolean);
  if (nodes.filter((node) => node.type === 'trigger').length !== 1) return null;
  const ids = new Set(nodes.map((node) => node.id));
  const pathIds = new Map(nodes.filter((node) => node.type === 'condition').map((node) => [node.id, new Set(node.paths.map((path) => path.id))]));
  const edgeKeys = new Set();
  const edges = (Array.isArray(input.edges) ? input.edges : []).slice(0, FLOW_EDGE_LIMIT).map((edge, index) => {
    const source = String(edge?.source || '');
    const target = String(edge?.target || '');
    const branch = String(edge?.branch || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!ids.has(source) || !ids.has(target) || source === target) return null;
    const paths = pathIds.get(source);
    if (paths) {
      if (!paths.has(branch)) return null;
    } else if (branch) return null;
    const key = `${source}:${branch}`;
    if (edgeKeys.has(key)) return null;
    edgeKeys.add(key);
    return { id: String(edge?.id || `e_${index}`).slice(0, 40), source, target, branch };
  }).filter(Boolean);
  const reentry = ['once', 'whenever', 'after'].includes(input.reentry) ? input.reentry : 'once';
  const requestedDate = String(input.dateField || '').slice(0, 60);
  const dateField = readablePrediction(requestedDate) && requestedDate.toLowerCase().replace(/[^a-z0-9]/g, '') === 'expectednextorderat'
    ? 'expectedNextOrderAt'
    : (isPredictionKey(requestedDate) ? '' : requestedDate);
  const notes = (Array.isArray(input.notes) ? input.notes : []).map((note) => String(note || '').slice(0, 240)).filter(Boolean).slice(0, 12);
  if (requestedDate && isPredictionKey(requestedDate) && dateField !== 'expectedNextOrderAt') notes.push('A predicted date was not copied. This date flow enrolls nobody until you name a date stored on the contact.');
  const flow = {
    id,
    name: String(input.name || 'Flow').slice(0, 80),
    enabled: Boolean(input.enabled),
    trigger,
    reentry,
    reentryDays: Math.max(1, Math.min(3650, Math.round(Number(input.reentryDays) || 30))),
    exitOnOrder: typeof input.exitOnOrder === 'boolean' ? input.exitOnOrder : (trigger === 'checkout_abandonment' || trigger === 'quiet_buyer'),
    filter: cleanClauses(input.filter),
    dateField,
    dateOffsetDays: Math.max(0, Math.min(364, Math.round(Number(input.dateOffsetDays) || 0))),
    dateRepeat: ['yearly', 'monthly'].includes(input.dateRepeat) ? input.dateRepeat : 'once',
    notes,
    nodes,
    edges
  };
  if (trigger === 'quiet_buyer') flow.quietAfterDays = Math.max(1, Math.min(365, Number(input.quietAfterDays) || 45));
  if (input.sunset === true) {
    flow.sunset = true;
    const days = Number(input.quietAfterDays);
    if (Number.isFinite(days) && days >= 1) flow.quietAfterDays = Math.max(1, Math.min(365, Math.round(days)));
  }
  if (trigger === 'price_drop' || trigger === 'low_inventory' || trigger === 'back_in_stock') {
    flow.lookbackDays = Math.max(1, Math.min(365, Math.round(Number(input.lookbackDays) || 30)));
    flow.variantId = String(input.variantId || '').replace(/\D/g, '').slice(0, 40);
  }
  if (trigger === 'price_drop') {
    flow.dropMode = input.dropMode === 'amount' ? 'amount' : 'percent';
    const value = Number(input.dropValue);
    const cap = flow.dropMode === 'percent' ? 99 : 1000000;
    flow.dropValue = Number.isFinite(value) && value > 0 ? Math.min(cap, value) : (flow.dropMode === 'percent' ? 10 : 0);
  }
  if (trigger === 'low_inventory') {
    flow.stockThreshold = Math.max(1, Math.min(100000, Math.round(Number(input.stockThreshold) || 5)));
  }
  if (trigger === 'back_in_stock') {
    flow.stockMinimum = Math.max(1, Math.min(100000, Math.round(Number(input.stockMinimum) || 1)));
  }
  if (input.klaviyoFlowId) flow.klaviyoFlowId = String(input.klaviyoFlowId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  if (flowUsesPrediction(flow) && !/predicted/i.test(flow.name)) flow.name = `${flow.name} (predicted)`.slice(0, 80);
  return flow;
}

function flowUsesPrediction(flow) {
  if (flow.dateField === 'expectedNextOrderAt') return true;
  const clauses = [...(flow.filter || [])];
  for (const node of flow.nodes || []) {
    for (const path of node.paths || []) clauses.push(...(path.clauses || []));
    clauses.push(...(node.filter || []));
  }
  return clauses.some((clause) => clause?.kind === 'prediction' || readablePrediction(clause?.field));
}

export function outgoingTarget(graph, sourceId, branch) {
  const want = branch || '';
  const edge = (graph?.edges || []).find((item) => item.source === sourceId && (item.branch || '') === want);
  return edge?.target || '';
}

export function firstStepId(flow) {
  const trigger = (flow?.nodes || []).find((node) => node.type === 'trigger');
  return trigger ? outgoingTarget(flow, trigger.id, '') : '';
}

export function countSendNodes(flow) {
  return (flow?.nodes || []).filter((node) => node.type === 'email' || node.type === 'sms' || node.type === 'ab' || node.type === 'alert').length;
}

function hasCycle(flow) {
  const outs = new Map();
  for (const edge of flow.edges) {
    if (!outs.has(edge.source)) outs.set(edge.source, []);
    outs.get(edge.source).push(edge.target);
  }
  const color = new Map();
  const visit = (nodeId) => {
    const state = color.get(nodeId) || 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(nodeId, 1);
    for (const target of outs.get(nodeId) || []) {
      if (visit(target)) return true;
    }
    color.set(nodeId, 2);
    return false;
  };
  return flow.nodes.some((node) => visit(node.id));
}

export function validateFlow(flow) {
  if (!flow) return { ok: false, error: 'That flow could not be saved.' };
  if (flow.nodes.length > FLOW_NODE_LIMIT) return { ok: false, error: 'A flow can have 60 steps.' };
  if (flow.nodes.filter((node) => node.type === 'trigger').length !== 1) return { ok: false, error: 'A flow needs one start.' };
  if (hasCycle(flow)) return { ok: false, error: 'That flow loops back on itself.' };
  for (const node of flow.nodes) {
    if (node.type === 'ab' && (node.variations || []).length < 2) return { ok: false, error: 'An A/B test needs two variations.' };
    if (node.type === 'sms' && node.status !== 'draft' && !String(node.message || '').trim()) return { ok: false, error: 'A text step needs a message before it can send.' };
    if (node.type === 'webhook') {
      const check = publicHttpsUrl(node.url);
      if (!check.ok) return { ok: false, error: check.error };
    }
    if (node.type === 'profile') {
      if (!node.key) return { ok: false, error: 'A profile step needs a field name.' };
      if (isPredictionKey(node.key)) return { ok: false, error: 'That profile field is reserved.' };
    }
    if (node.type === 'list' && !node.listId) return { ok: false, error: 'A list step needs a list id.' };
    if (node.type === 'alert' && !node.to) return { ok: false, error: 'An alert needs an email address.' };
    if (node.type === 'condition' && !(node.paths || []).some((path) => path.else)) return { ok: false, error: 'A check needs an everyone else path.' };
  }
  return { ok: true };
}

export function publicHttpsUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return { ok: false, error: 'The webhook needs an https address.' }; }
  if (url.protocol !== 'https:') return { ok: false, error: 'The webhook needs an https address.' };
  if (url.username || url.password) return { ok: false, error: 'The webhook address cannot include a password.' };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'The webhook address has to be public.' };
  }
  if (isIpLiteral(host) && isPrivateAddress(host)) return { ok: false, error: 'The webhook address has to be public.' };
  return { ok: true, url: url.toString() };
}

export function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function isPrivateAddress(address) {
  const raw = String(address || '').toLowerCase();
  if (raw === '::1' || raw === '0:0:0:0:0:0:0:1') return true;
  if (raw.startsWith('fe80:') || raw.startsWith('fc') || raw.startsWith('fd')) return true;
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  const ipv4 = mapped ? mapped[1] : raw;
  const parts = ipv4.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return raw.includes(':');
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 255 && b === 255) return true;
  return false;
}

function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? 0;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute), weekday };
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
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

function calendarWeekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addCalendarDays(year, month, day, add) {
  const next = new Date(Date.UTC(year, month - 1, day + add));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), weekday: next.getUTCDay() };
}

export function nextClock(nowMs, hour, minute, weekdays, timeZone) {
  const tz = isIanaTimezone(timeZone) ? timeZone : 'UTC';
  const allowed = Array.isArray(weekdays) && weekdays.length ? new Set(weekdays.map((day) => Number(day))) : null;
  const start = zonedParts(nowMs, tz);
  for (let add = 0; add < 8; add++) {
    const day = add === 0 ? { ...start, weekday: calendarWeekday(start.year, start.month, start.day) } : addCalendarDays(start.year, start.month, start.day, add);
    if (allowed && !allowed.has(day.weekday)) continue;
    const utc = zonedTimeToUtc(day.year, day.month, day.day, hour, minute, tz);
    if (utc >= nowMs) return utc;
  }
  return nowMs + 7 * 86400000;
}

export function delayUntil(node, nowMs, accountTz, profileTz) {
  const minutes = Math.max(0, Number(node?.delayMinutes) || 0);
  const tz = node?.timezone === 'profile' && isIanaTimezone(profileTz) ? profileTz : (isIanaTimezone(accountTz) ? accountTz : 'UTC');
  if (node?.mode === 'clock') return nextClock(nowMs + minutes * 60000, Number(node.clockHour) || 0, Number(node.clockMinute) || 0, node.weekdays || [], tz);
  return nowMs + minutes * 60000;
}

function present(value) {
  return value != null && value !== '';
}

function clauseMatches(clause, ctx) {
  if (!clause) return false;
  if (clause.kind === 'prediction' || clause.kind === 'unsupported') return false;
  if (clause.kind === 'random') {
    return stableBucket(`${ctx.enrollmentId || ''}:${ctx.nodeId || ''}:${clause.percent}:${ctx.pathId || ''}`, 100) < clause.percent;
  }
  if (clause.kind === 'consent') {
    const known = clause.channel === 'sms' ? ctx.canText : ctx.canEmail;
    if (known == null) return false;
    return clause.can ? known === true : known === false;
  }
  if (clause.kind === 'list') {
    if (!Array.isArray(ctx.lists)) return false;
    const inside = ctx.lists.includes(clause.listId);
    return clause.member ? inside : !inside;
  }
  if (clause.kind === 'did') {
    if (!KNOWN_EVENTS.has(clause.event)) return false;
    if (clause.since === 'enroll' && !ctx.enrolledAt) return false;
    const sinceMs = clause.since === 'enroll'
      ? new Date(ctx.enrolledAt).getTime()
      : (ctx.now || Date.now()) - clause.since * 86400000;
    const rows = clause.event === 'order' ? (ctx.orders || []) : (ctx.events || []).filter((row) => row.type === clause.event);
    const found = rows.some((row) => new Date(row.at || row.createdAt || 0).getTime() >= sinceMs);
    return clause.done ? found : !found;
  }
  const bag = clause.kind === 'event_field' ? (ctx.event || {}) : { ...(ctx.profile || {}), ...(ctx.properties || {}) };
  if (!Object.prototype.hasOwnProperty.call(bag, clause.field) || !present(bag[clause.field])) {
    return clause.op === 'unset';
  }
  const have = bag[clause.field];
  if (clause.op === 'set') return true;
  if (clause.op === 'unset') return false;
  if (clause.op === 'contains') return String(have).toLowerCase().includes(String(clause.value || '').toLowerCase());
  if (clause.op === 'gt' || clause.op === 'lt') {
    const left = Number(have);
    const right = Number(clause.value);
    if (Number.isFinite(left) && Number.isFinite(right)) return clause.op === 'gt' ? left > right : left < right;
    const leftDate = Date.parse(String(have));
    const rightDate = Date.parse(String(clause.value));
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return clause.op === 'gt' ? leftDate > rightDate : leftDate < rightDate;
    return false;
  }
  const same = String(have) === String(clause.value);
  return clause.op === 'neq' ? !same : same;
}

export function clausesMatch(clauses, ctx) {
  return (clauses || []).every((clause) => clauseMatches(clause, ctx));
}

export function matchPath(node, ctx) {
  const paths = node?.paths || [];
  for (const path of paths) {
    if (path.else) return path;
    if (!path.clauses || !path.clauses.length) continue;
    if (clausesMatch(path.clauses, { ...ctx, nodeId: node.id, pathId: path.id })) return path;
  }
  return paths.find((path) => path.else) || null;
}

export function stableBucket(seed, mod) {
  const size = Math.max(1, Number(mod) || 1);
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) % size;
}

export function pickVariation(enrollmentId, node) {
  const variations = node?.variations || [];
  if (!variations.length) return null;
  const total = variations.reduce((sum, variation) => sum + (Number(variation.weight) || 0), 0) || variations.length;
  let bucket = stableBucket(`${enrollmentId}:${node.id}`, total);
  for (const variation of variations) {
    const weight = Number(variation.weight) || (total === variations.length ? 1 : 0);
    if (bucket < weight) return variation;
    bucket -= weight;
  }
  return variations[variations.length - 1];
}

export function reentryBlocks(flow, rows, email, now) {
  const mine = (rows || []).filter((row) => row.flowId === flow.id && row.email === email);
  if (mine.some((row) => row.status === 'active')) return true;
  const mode = flow.reentry || 'once';
  if (mode === 'whenever') return false;
  if (mode === 'after') {
    const latest = mine.reduce((max, row) => Math.max(max, new Date(row.enrolledAt || 0).getTime()), 0);
    if (!latest) return false;
    return now - latest < (Number(flow.reentryDays) || 30) * 86400000;
  }
  return mine.length > 0;
}

export function parseDateOnly(raw) {
  const text = String(raw ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const year = iso ? Number(iso[1]) : us ? Number(us[3]) : 0;
  const month = iso ? Number(iso[2]) : us ? Number(us[1]) : 0;
  const day = iso ? Number(iso[3]) : us ? Number(us[2]) : 0;
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  return { year, month, day };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateOccurrenceDue(flow, raw, nowMs, timeZone) {
  if (!flow || flow.trigger !== 'date_property') return { due: false };
  if (!flow.dateField) return { due: false, reason: 'absent' };
  if (isPredictionKey(flow.dateField) && flow.dateField !== 'expectedNextOrderAt') return { due: false, reason: 'prediction' };
  const parsed = parseDateOnly(raw);
  if (!parsed) return { due: false, reason: 'absent' };
  const tz = isIanaTimezone(timeZone) ? timeZone : 'UTC';
  const today = zonedParts(nowMs, tz);
  let year = flow.dateRepeat === 'once' ? parsed.year : today.year;
  let month = flow.dateRepeat === 'monthly' ? today.month : parsed.month;
  let day = Math.min(parsed.day, daysInMonth(year, month));
  const offset = Math.max(0, Number(flow.dateOffsetDays) || 0);
  const morning = zonedTimeToUtc(year, month, day, 8, 0, tz) - offset * 86400000;
  const occurrence = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (nowMs < morning || nowMs >= morning + 36 * 3600000) return { due: false, occurrence };
  return { due: true, occurrence };
}

function plainEvent(event) {
  const out = {};
  if (!event || typeof event !== 'object') return out;
  for (const [key, value] of Object.entries(event)) {
    if (Object.keys(out).length >= 20) break;
    const name = String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (!name || isPredictionKey(name)) continue;
    if (typeof value === 'string') out[name] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (typeof value === 'boolean') out[name] = value;
  }
  return out;
}

export function buildEnrollment({ flow, contact, vars, event, now = Date.now(), id, occurrence }) {
  const graph = {
    nodes: (flow.nodes || []).map((node) => structuredClone(node)),
    edges: (flow.edges || []).map((edge) => ({ ...edge }))
  };
  const nodeId = firstStepId(flow);
  return {
    id: id || `fenr_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    flowId: flow.id,
    email: String(contact?.email || '').toLowerCase(),
    name: contact?.name || '',
    visitorId: contact?.visitorId || '',
    phone: contact?.phone || '',
    status: nodeId ? 'active' : 'completed',
    nodeId: nodeId || '',
    waitUntil: new Date(now).toISOString(),
    held: false,
    graph,
    abPicks: {},
    vars: vars && typeof vars === 'object' ? { ...vars } : {},
    event: plainEvent(event),
    exitOnOrder: flow.exitOnOrder === true,
    occurrence: occurrence || '',
    enrolledAt: new Date(now).toISOString(),
    history: []
  };
}

function fillWebhookTemplate(template, vars) {
  const source = String(template || '').trim() || '{}';
  const filled = source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (token, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars || {}, key) || vars[key] == null) return '';
    return String(vars[key]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  });
  const parsed = JSON.parse(filled);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('template');
  return parsed;
}

function gateMessage(node, ctx) {
  if (node.status === 'draft') return { kind: 'advance', branch: '', skip: 'draft', history: { type: 'skip', detail: 'draft' } };
  if (node.status === 'review') return { kind: 'advance', branch: '', skip: 'review', history: { type: 'skip', detail: 'review' } };
  if (node.filter?.length && !clausesMatch(node.filter, ctx)) return { kind: 'advance', branch: '', skip: 'filter', history: { type: 'skip', detail: 'filter' } };
  if (node.smartSkip && node.transactional !== true) {
    const recent = node.type === 'sms' ? ctx.recentSms === true : ctx.recentEmail === true;
    if (recent) return { kind: 'advance', branch: '', skip: 'smart', history: { type: 'skip', detail: 'smart' } };
  }
  return null;
}

export function peekGraph(enr, now, ctx) {
  if (!enr?.graph || Array.isArray(enr.program)) return { ready: false, legacy: Array.isArray(enr?.program) };
  if (enr.status !== 'active') return { ready: false };
  const node = (enr.graph.nodes || []).find((item) => item.id === enr.nodeId);
  if (!node) return { ready: true, kind: 'complete' };
  if (node.type === 'restock' && ctx?.restockReleased === true && enr.held) {
    return { ready: true, kind: 'advance', branch: '', history: { type: 'restock', detail: 'released' } };
  }
  if (new Date(enr.waitUntil || 0).getTime() > now) return { ready: false };
  const local = { ...(ctx || {}), enrollmentId: enr.id, nodeId: node.id, enrolledAt: enr.enrolledAt, now };
  if (node.type === 'trigger') return { ready: true, kind: 'advance', branch: '' };
  if (node.type === 'delay') {
    if (enr.held) return { ready: true, kind: 'advance', branch: '', history: { type: 'delay', detail: 'waited' } };
    const until = delayUntil(node, now, local.accountTimezone, local.profileTimezone);
    if (until > now + 999) return { ready: true, kind: 'hold', waitUntil: until, history: { type: 'delay', detail: 'waiting' } };
    return { ready: true, kind: 'advance', branch: '', history: { type: 'delay', detail: 'waited' } };
  }
  if (node.type === 'restock') {
    if (local.restockReleased === true) return { ready: true, kind: 'advance', branch: '', history: { type: 'restock', detail: 'released' } };
    if (enr.held) return { ready: true, kind: 'advance', branch: '', history: { type: 'restock', detail: 'cap' } };
    return { ready: true, kind: 'hold', waitUntil: now + (Number(node.capDays) || 30) * 86400000, history: { type: 'restock', detail: 'waiting' } };
  }
  if (node.type === 'condition') {
    const path = matchPath(node, local);
    return { ready: true, kind: 'advance', branch: path?.id || '', history: { type: 'condition', detail: path?.label || path?.id || '' } };
  }
  if (node.type === 'ab') {
    const existing = enr.abPicks?.[node.id];
    const variation = (node.variations || []).find((item) => item.id === existing) || pickVariation(enr.id, node);
    if (!variation) return { ready: true, kind: 'advance', branch: '', history: { type: 'ab', detail: 'none' } };
    const gate = gateMessage(node, local);
    if (gate) return { ready: true, ...gate, variationId: variation.id };
    const blocks = variation.blocks?.length ? variation.blocks : node.blocks;
    const subject = variation.subject || node.subject || 'A note from the store';
    if (!subject && !blocks?.length) {
      return { ready: true, kind: 'advance', branch: '', variationId: variation.id, history: { type: 'ab', detail: variation.id } };
    }
    return {
      ready: true, kind: 'email', variationId: variation.id, transactional: node.transactional === true,
      subject, previewText: variation.previewText || node.previewText || '', fromName: variation.fromName || node.fromName || '',
      replyTo: node.replyTo || '', blocks: blocks || [], klaviyoFlowId: '',
      holdout: node.holdout?.enabled === true ? node.holdout : null
    };
  }
  if (node.type === 'email' || node.type === 'sms') {
    if (node.type === 'sms' && !enr.held && Number.isFinite(local.quietOpenAt) && local.quietOpenAt > now + 999) {
      return { ready: true, kind: 'hold', waitUntil: local.quietOpenAt, history: { type: 'quiet', detail: 'waiting' } };
    }
    if (node.type === 'email' && node.sendTime === 'smart' && !enr.held) {
      const at = Date.parse(local.smartSend?.sendAt || '');
      if (!Number.isFinite(at) || at > now + 999) {
        return { ready: true, kind: 'hold', waitUntil: Number.isFinite(at) ? at : now + 3600000, history: { type: 'smart', detail: String(local.smartSend?.rule || 'waiting') } };
      }
    }
    const gate = gateMessage(node, local);
    if (gate) return { ready: true, ...gate };
    if (node.type === 'sms') return { ready: true, kind: 'sms', message: node.message || '', transactional: node.transactional === true, quietHours: node.quietHours, coupon: node.coupon || null };
    return {
      ready: true, kind: 'email', transactional: node.transactional === true, subject: node.subject, previewText: node.previewText || '',
      fromName: node.fromName || '', replyTo: node.replyTo || '', blocks: node.blocks || [], klaviyoFlowId: node.klaviyoFlowId || '',
      holdout: node.holdout?.enabled === true ? node.holdout : null
    };
  }
  if (node.type === 'profile') {
    if (!node.key || isPredictionKey(node.key)) return { ready: true, kind: 'advance', branch: '', history: { type: 'profile', detail: 'refused' } };
    return { ready: true, kind: 'profile', update: node.update === 'clear' ? 'clear' : 'set', key: node.key, valueType: node.valueType || 'string', value: node.value };
  }
  if (node.type === 'list') {
    if (!node.listId) return { ready: true, kind: 'advance', branch: '', history: { type: 'list', detail: 'missing' } };
    return { ready: true, kind: 'list', update: node.update === 'remove' ? 'remove' : 'add', listId: node.listId };
  }
  if (node.type === 'alert') {
    if (!node.to) return { ready: true, kind: 'advance', branch: '', history: { type: 'alert', detail: 'missing' } };
    return { ready: true, kind: 'alert', to: node.to };
  }
  if (node.type === 'webhook') {
    const check = publicHttpsUrl(node.url);
    if (!check.ok) return { ready: true, kind: 'advance', branch: '', history: { type: 'webhook', detail: 'refused' } };
    try {
      const body = fillWebhookTemplate(node.template, { ...(enr.vars || {}), email: enr.email, ...(enr.event || {}) });
      return { ready: true, kind: 'webhook', url: check.url, body };
    } catch {
      return { ready: true, kind: 'advance', branch: '', history: { type: 'webhook', detail: 'template' } };
    }
  }
  return { ready: true, kind: 'advance', branch: '' };
}

export function applyGraph(enr, action, now) {
  const at = new Date(now).toISOString();
  if (action?.variationId && enr.nodeId) enr.abPicks = { ...(enr.abPicks || {}), [enr.nodeId]: action.variationId };
  if (action?.history) enr.history = [...(enr.history || []), { at, ...action.history }].slice(-20);
  if (action?.kind === 'hold') {
    enr.held = true;
    enr.waitUntil = new Date(action.waitUntil).toISOString();
    return enr;
  }
  if (action?.kind === 'exit') {
    enr.status = 'converted_exit';
    enr.held = false;
    return enr;
  }
  if (action?.kind === 'complete') {
    enr.status = 'completed';
    enr.held = false;
    return enr;
  }
  if (action?.kind === 'advance') {
    const target = outgoingTarget(enr.graph, enr.nodeId, action.branch || '');
    enr.held = false;
    if (!target) enr.status = 'completed';
    else {
      enr.nodeId = target;
      enr.waitUntil = at;
    }
    return enr;
  }
  return enr;
}
