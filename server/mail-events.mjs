/**
 * Mail-event gate and the shape POST /api/email/provider-event stores.
 * Opens stay blank until a secret of 16–200 characters and a public https
 * PUBLIC_BASE_URL are both set. This module does not send mail or call the hub.
 */
import crypto from 'node:crypto';
import { isIpLiteral, publicHttpsUrl } from '../email-flows.mjs';

export function publicHttpsOrigin(value) {
  const check = publicHttpsUrl(value);
  if (!check.ok) return '';
  let url;
  try { url = new URL(check.url); } catch { return ''; }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host.includes('.') || isIpLiteral(host)) return '';
  return url.origin;
}

export function mailSecretOk(secret) {
  const text = String(secret || '');
  return text.length >= 16 && text.length <= 200 && !/[\r\n]/.test(text);
}

export function mailEventsReady(env = {}) {
  const source = env && typeof env === 'object' ? env : {};
  return mailSecretOk(source.MAIL_EVENT_SECRET) && Boolean(publicHttpsOrigin(source.PUBLIC_BASE_URL));
}

export function mailCallbackPlan(secret, publicBase) {
  const origin = publicHttpsOrigin(publicBase);
  if (!mailSecretOk(secret) || !origin) return null;
  return { url: `${origin}/api/email/provider-event`, secret: String(secret) };
}

export function secretsMatch(header, secret) {
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(String(secret || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const TYPE_ALIASES = {
  open: 'email_opened',
  opened: 'email_opened',
  email_opened: 'email_opened',
  click: 'email_clicked',
  clicked: 'email_clicked',
  email_clicked: 'email_clicked',
  sms_click: 'sms_clicked',
  sms_clicked: 'sms_clicked',
  delivered: 'email_delivered',
  email_delivered: 'email_delivered',
  hard_bounce: 'hard_bounce',
  soft_bounce: 'soft_bounce',
  complaint: 'complaint',
  spamreport: 'complaint',
  unsubscribe: 'unsubscribe',
  group_unsubscribe: 'unsubscribe'
};

function mappedType(raw) {
  const event = String(raw?.event || '').trim();
  const type = String(raw?.type || '').trim();
  if (event === 'dropped' || event === 'deferred' || event === 'processed') return '';
  if (type === 'dropped' || type === 'deferred' || type === 'processed') return '';
  if (event === 'bounce' || type === 'bounce') {
    const sub = String(raw?.bounceType || (event === 'bounce' ? type : '') || '');
    return sub === 'blocked' ? 'soft_bounce' : 'hard_bounce';
  }
  return TYPE_ALIASES[type] || TYPE_ALIASES[event] || '';
}

/** Unix seconds, unix milliseconds, or an ISO string. Blank when it is missing, in the future by more than five minutes, or older than 365 days. */
export function eventAtIso(value, now = Date.now()) {
  if (value == null || value === '') return '';
  let ms;
  if (typeof value === 'string' && value.includes('T')) ms = Date.parse(value);
  else {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    ms = n > 1e12 ? n : n * 1000;
  }
  if (!Number.isFinite(ms)) return '';
  if (ms > now + 5 * 60 * 1000) return '';
  if (ms < now - 365 * 24 * 60 * 60 * 1000) return '';
  return new Date(ms).toISOString();
}

export function readProviderEvents(body) {
  if (Array.isArray(body?.events)) return body.events.slice(0, 1000);
  if (body && typeof body === 'object' && (body.uid || body.email || body.type || body.event)) return [body];
  return [];
}

export function normalizeProviderEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const uid = String(raw.uid || raw.jourvance_uid || raw.account_id || '').replace(/[\r\n]/g, '').slice(0, 128);
  const email = String(raw.email || '').trim().toLowerCase();
  const type = mappedType(raw);
  if (!uid || !email.includes('@') || !type) return null;
  const messageId = String(raw.messageId || raw.jourvance_message_id || '').replace(/[\r\n]/g, '').slice(0, 80);
  const providerEventId = String(raw.providerEventId || raw.sg_event_id || '').replace(/[\r\n]/g, '').slice(0, 120);
  const prefetch = raw.prefetch === true || raw.applePrivacy === true || raw.sg_machine_open === true || raw.sg_machine_open === 'true';
  const at = eventAtIso(raw.at ?? raw.timestamp, now);
  const bounceType = String(raw.bounceType || ((raw.event === 'bounce' || raw.type === 'bounce') ? raw.type : '') || '').slice(0, 40);
  return { uid, email, type, messageId, providerEventId, prefetch, at, bounceType };
}
