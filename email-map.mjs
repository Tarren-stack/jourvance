/**
 * Phase 8: one flow run from the map, the page form, or the flow trigger,
 * plus holdout math and the email touches on an attribution path.
 * A missing sample stays blank. Holdout does not name a winner.
 */
import { reentryBlocks, stableBucket } from './email-flows.mjs';
import { netOrderValue } from './email-predict.mjs';

const TOUCH_TYPES = new Set([
  'page_view', 'lead', 'checkout_start', 'thank_you_view', 'upsell_view', 'upsell_accept',
  'email_sent', 'email_clicked'
]);

export function cleanHoldout(input) {
  if (!input || input.enabled !== true) return { ok: true, holdout: null };
  const percent = Math.round(Number(input.percent));
  if (!Number.isFinite(percent) || percent < 1 || percent > 90) {
    return { ok: false, error: 'Holdout is 1 to 90 percent. It stays off until you turn it on.' };
  }
  return { ok: true, holdout: { enabled: true, percent } };
}

export function inHoldout(seed, percent) {
  const pct = Math.round(Number(percent));
  if (!pct || pct < 1) return false;
  return stableBucket(String(seed), 100) < Math.min(90, pct);
}

export function splitHoldout(people, holdout, seed, at) {
  const list = Array.isArray(people) ? people : [];
  if (!holdout?.enabled || !(Number(holdout.percent) >= 1)) return { send: list.slice(), held: [] };
  const send = [];
  const held = [];
  for (const person of list) {
    const email = String(person?.email || '').toLowerCase();
    if (!email) continue;
    if (inHoldout(`${seed}:${email}`, holdout.percent)) held.push({ email, at: at || '' });
    else send.push(person);
  }
  return { send, held };
}

function laterRevenue(people, orders) {
  const sample = people.length;
  if (!sample) return { sample: 0, orders: null, revenue: null, perPerson: null };
  const assigned = new Map(people.map((person) => [String(person.email || '').toLowerCase(), Date.parse(person.at || '')]));
  let revenue = 0;
  let count = 0;
  for (const order of orders || []) {
    const email = String(order?.customerEmail || order?.email || '').toLowerCase();
    const start = assigned.get(email);
    const placed = Date.parse(order?.createdAt || '');
    if (!Number.isFinite(start) || !Number.isFinite(placed) || placed < start) continue;
    const value = netOrderValue(order);
    if (value == null) continue;
    revenue += value;
    count += 1;
  }
  const total = Math.round(revenue * 100) / 100;
  return { sample, orders: count, revenue: total, perPerson: Math.round((total / sample) * 100) / 100 };
}

export function holdoutReport(sentPeople, heldPeople, orders) {
  return {
    sent: laterRevenue(sentPeople || [], orders),
    held: laterRevenue(heldPeople || [], orders)
  };
}

export function enrollChoice({ flow, rows, email, now, sender }) {
  if (!flow) return { enroll: false, reason: 'missing', stitch: false };
  if (flow.sunset === true) return { enroll: false, reason: 'sunset', stitch: false };
  if (flow.enabled !== true) return { enroll: false, reason: 'off', stitch: false };
  if (sender === 'klaviyo') return { enroll: false, reason: 'klaviyo', stitch: false };
  const address = String(email || '').toLowerCase();
  if (reentryBlocks(flow, rows, address, now)) {
    const open = (rows || []).find((row) => row.flowId === flow.id && row.email === address && row.status === 'active' && !row.visitorId);
    return { enroll: false, reason: 'reentry', stitch: Boolean(open) };
  }
  return { enroll: true, reason: '', stitch: false };
}

export function linkedFlowIds(nodes, when) {
  if (when !== 'lead_capture' && when !== 'exit_intent') return [];
  const ids = [];
  const seen = new Set();
  for (const node of nodes || []) {
    if (node?.type !== 'follow-up-sequence') continue;
    const id = String(node.data?.jourvanceFlowId || '').trim();
    if (!/^flow_[a-z0-9]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function enrollmentCount(rows, flowId) {
  const count = (rows || []).filter((row) => row.flowId === flowId && row.status !== 'handed_to_klaviyo').length;
  return count > 0 ? count : null;
}

export function channelOf(touch) {
  if (!touch) return 'direct';
  const src = String(touch.utm_source || touch.source || '').toLowerCase();
  const medium = String(touch.utm_medium || '').toLowerCase();
  if (touch.fbclid || src.includes('meta') || src.includes('facebook') || src.includes('instagram') || src === 'fb') return 'meta';
  if (touch.gclid || src.includes('google')) return 'google';
  if (touch.ttclid || src.includes('tiktok')) return 'tiktok';
  if (src.includes('email') || medium.includes('email') || medium === 'drip') return 'email';
  return 'direct';
}

export function emailTouchFields(type) {
  if (type !== 'email_sent' && type !== 'email_clicked') return {};
  return { utm_source: 'email', utm_medium: 'email' };
}

export function attributionTouches(events, order) {
  const email = String(order?.customerEmail || '').toLowerCase();
  const visitor = String(order?.visitorId || '');
  return (events || []).filter((event) => {
    if (!TOUCH_TYPES.has(event?.type)) return false;
    if (visitor && event.visitorId && event.visitorId === visitor) return true;
    return Boolean(email && event.email && String(event.email).toLowerCase() === email);
  }).sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
}

export function orderBelongsTo(order, uid, slugOwner) {
  if (!uid || !order) return false;
  if (order.userId) return order.userId === uid;
  return Boolean(order.attributedSlug && slugOwner === uid);
}

export function visitorFromLink(queryId, storedId) {
  const query = String(queryId || '');
  if (/^[A-Za-z0-9_.-]{6,80}$/.test(query)) return query;
  const stored = String(storedId || '');
  return stored || '';
}
