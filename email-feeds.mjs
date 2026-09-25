/**
 * Product feeds, text quiet hours, one redirect, and last-touch revenue.
 * Counts come from this account's orders, behavior, and stored opens or clicks.
 * A missing click or open leaves attributed revenue absent.
 */
import { isIanaTimezone } from './email-flows.mjs';
import { netOrderValue } from './email-predict.mjs';

export const FEED_SOURCES = ['best_3', 'best_90', 'newest', 'copurchase', 'viewed', 'cart', 'checkout'];
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 11;
export const LINK_DAYS = 90;
export const EMAIL_CLICK_DAYS = 5;
export const EMAIL_OPEN_DAYS = 5;
export const SMS_CLICK_DAYS = 5;

const PERSONAL = new Set(['copurchase', 'viewed', 'cart']);
const DAY = 86400000;
const EMAIL_CLICK = new Set(['email_clicked', 'clicked']);
const EMAIL_OPEN = new Set(['email_opened', 'opened']);
const SMS_CLICK = new Set(['sms_clicked']);
const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
const COUPON_TAG = /\{%\s*coupon_code\s+(['"])([^'"]+)\1\s*%\}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const TRACKER = /sendgrid\.net|\/wf\/open|list-manage\.com|ctrk\.klaviyo|klclick/i;

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function itemKey(row) {
  const product = String(row?.productId || '').trim();
  if (product) return `p:${product}`;
  const variant = String(row?.variantId || row?.id || '').trim();
  if (variant) return `v:${variant}`;
  return '';
}

function priceOf(row) {
  const n = Number(String(row?.price ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function unitsOf(line) {
  const qty = Number(line?.quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function orderAt(order) {
  const at = Date.parse(order?.createdAt || order?.at || '');
  return Number.isFinite(at) ? at : null;
}

export function cleanFeed(input) {
  const source = FEED_SOURCES.includes(input?.source) ? input.source : 'best_90';
  const fallback = input?.fallback === 'best_3' ? 'best_3' : 'best_90';
  const limit = Math.max(1, Math.min(9, Math.round(Number(input?.limit) || 3)));
  const num = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    source,
    fallback,
    limit,
    category: String(input?.category || '').trim().slice(0, 80),
    minPrice: num(input?.minPrice),
    maxPrice: num(input?.maxPrice),
    minStock: num(input?.minStock),
    hideMissingImage: input?.hideMissingImage !== false,
    hideOutOfStock: input?.hideOutOfStock !== false,
    hidePurchased: input?.hidePurchased !== false,
    hideTrigger: input?.hideTrigger !== false
  };
}

function feedLabel(source) {
  if (source === 'best_3') return 'Best sellers, last 3 days';
  if (source === 'best_90') return 'Best sellers, last 90 days';
  if (source === 'newest') return 'Newest';
  if (source === 'copurchase') return 'Co-purchase';
  if (source === 'viewed') return 'Recently viewed';
  if (source === 'cart') return 'Added to cart';
  if (source === 'checkout') return 'This checkout';
  return '';
}

function bareId(value) {
  return String(value || '').replace(/^[pv]:/, '');
}

function tallyLines(orders, since, until) {
  const product = new Map();
  const variant = new Map();
  for (const order of orders || []) {
    const at = orderAt(order);
    if (at == null || at < since || at > until) continue;
    for (const line of order.lineItems || []) {
      const key = line?.productId ? `p:${line.productId}` : itemKey(line);
      if (key) product.set(key, (product.get(key) || 0) + unitsOf(line));
      if (line?.variantId) variant.set(String(line.variantId), (variant.get(String(line.variantId)) || 0) + unitsOf(line));
    }
  }
  return { product, variant };
}

function purchasedKeys(orders, email) {
  const want = String(email || '').toLowerCase();
  const keys = new Set();
  if (!want) return keys;
  for (const order of orders || []) {
    if (String(order.customerEmail || order.email || '').toLowerCase() !== want) continue;
    for (const line of order.lineItems || []) {
      if (line?.productId) keys.add(`p:${line.productId}`);
      if (line?.variantId) keys.add(`v:${line.variantId}`);
    }
  }
  return keys;
}

function isTrigger(variant, triggerKey) {
  const bare = bareId(triggerKey);
  if (!bare) return false;
  return String(variant?.productId || '') === bare || String(variant?.variantId || '') === bare || itemKey(variant) === triggerKey;
}

function passes(variant, filters, purchased, triggerKey) {
  const key = itemKey(variant);
  if (!key) return false;
  if (filters.hideTrigger && isTrigger(variant, triggerKey)) return false;
  if (filters.hidePurchased && [key, variant.productId ? `p:${variant.productId}` : '', variant.variantId ? `v:${variant.variantId}` : ''].some((id) => id && purchased.has(id))) return false;
  if (filters.hideMissingImage && !/^https?:\/\//.test(String(variant.image || ''))) return false;
  if (filters.hideOutOfStock && Number.isFinite(Number(variant.available)) && Number(variant.available) <= 0) return false;
  if (filters.category) {
    const want = filters.category.toLowerCase();
    if (String(variant.category || '').trim().toLowerCase() !== want) return false;
  }
  const price = priceOf(variant);
  if (filters.minPrice != null && (price == null || price < filters.minPrice)) return false;
  if (filters.maxPrice != null && (price == null || price > filters.maxPrice)) return false;
  if (filters.minStock != null && (!Number.isFinite(Number(variant.available)) || Number(variant.available) < filters.minStock)) return false;
  return true;
}

function pictureOf(group) {
  const variants = [...group.variants].sort((a, b) => (b.units || 0) - (a.units || 0) || String(a.variantId || a.id || '').localeCompare(String(b.variantId || b.id || '')));
  const row = variants[0];
  if (!row) return null;
  const product = {};
  const id = String(row.variantId || row.productId || row.id || '').slice(0, 40);
  if (id) product.id = id;
  if (row.title) product.title = String(row.title).slice(0, 200);
  if (row.image) product.image = String(row.image).slice(0, 500);
  if (row.price != null && String(row.price) !== '') product.price = String(row.price).slice(0, 40);
  if (row.compareAt) product.compareAt = String(row.compareAt).slice(0, 40);
  if (row.url) product.url = String(row.url).slice(0, 500);
  if (row.currency) product.currency = String(row.currency).slice(0, 8);
  if (product.url) product.buttonLabel = 'View';
  if (!product.title && !product.image && !product.price && !product.url) return null;
  return product;
}

function catalogVariants(catalog, orders) {
  const rows = [];
  for (const row of catalog || []) {
    if (!row || typeof row !== 'object') continue;
    rows.push(row);
  }
  const seen = new Set(rows.map(itemKey));
  for (const order of orders || []) {
    for (const line of order.lineItems || []) {
      const key = itemKey(line);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(line);
    }
  }
  return rows;
}

function groupsFrom(variants, filters, purchased, triggerKey, tally) {
  const product = tally?.product || new Map();
  const variantUnits = tally?.variant || new Map();
  const groups = new Map();
  for (const variant of variants) {
    if (!passes(variant, filters, purchased, triggerKey)) continue;
    const key = variant.productId ? `p:${variant.productId}` : itemKey(variant);
    if (!groups.has(key)) groups.set(key, { key, units: product.get(key) || 0, createdAt: 0, variants: [] });
    const group = groups.get(key);
    const created = Date.parse(variant.createdAt || '');
    if (Number.isFinite(created) && created > group.createdAt) group.createdAt = created;
    group.variants.push({
      ...variant,
      units: variantUnits.get(String(variant.variantId || '')) || product.get(itemKey(variant)) || 0
    });
  }
  for (const group of groups.values()) {
    if (product.has(group.key)) continue;
    const seen = new Set();
    group.units = 0;
    for (const variant of group.variants) {
      const id = String(variant.variantId || variant.id || itemKey(variant));
      if (seen.has(id)) continue;
      seen.add(id);
      group.units += Number(variant.units) || 0;
    }
  }
  return [...groups.values()];
}

function behaviorKeys(behavior, email, type, now) {
  const want = String(email || '').toLowerCase();
  const since = now - 90 * DAY;
  const rows = [];
  for (const event of behavior || []) {
    if (event?.type !== type) continue;
    if (String(event.email || '').toLowerCase() !== want) continue;
    const at = Date.parse(event.at || '');
    if (!Number.isFinite(at) || at < since || at > now) continue;
    const key = itemKey(event);
    if (!key) continue;
    rows.push({ key, at });
  }
  rows.sort((a, b) => b.at - a.at);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row.key);
  }
  return out;
}

function takeProducts(groups, limit, rank) {
  const sorted = [...groups].sort(rank);
  const products = [];
  for (const group of sorted) {
    if (products.length >= limit) break;
    const picture = pictureOf(group);
    if (picture) products.push(picture);
  }
  return products;
}

function bestGroups(input, days) {
  const now = Number(input.now) || 0;
  const tally = tallyLines(input.orders, now - days * DAY, now);
  const purchased = purchasedKeys(input.orders, input.email);
  const trigger = input.triggerProductId ? `p:${bareId(input.triggerProductId)}` : '';
  return groupsFrom(catalogVariants(input.catalog, input.orders), input.filters, purchased, trigger, tally);
}

export function selectFeed(raw) {
  const filters = cleanFeed(raw);
  const source = FEED_SOURCES.includes(raw?.source) ? raw.source : filters.source;
  const fallback = raw?.fallback === 'best_3' || raw?.fallback === 'best_90' ? raw.fallback : (PERSONAL.has(source) ? '' : filters.fallback);
  const limit = filters.limit;
  const now = Number(raw?.now) || 0;
  const empty = { products: [], label: feedLabel(source), usedFallback: false, unavailable: '' };
  if (PERSONAL.has(source) && fallback !== 'best_3' && fallback !== 'best_90') {
    return { ...empty, unavailable: 'A personalized feed needs a best-seller fallback.' };
  }
  if (source === 'newest') {
    const dated = (raw?.catalog || []).some((row) => Number.isFinite(Date.parse(row?.createdAt || '')));
    if (!dated) return { ...empty, unavailable: 'Newest is unavailable until the store returns a created date.' };
  }
  const input = { ...raw, filters, now };
  let primary = [];
  if (source === 'best_3' || source === 'best_90') {
    const days = source === 'best_3' ? 3 : 90;
    primary = takeProducts(bestGroups(input, days).filter((group) => group.units > 0), limit, (a, b) => b.units - a.units || a.key.localeCompare(b.key));
  } else if (source === 'newest') {
    const purchased = purchasedKeys(input.orders, input.email);
    const groups = groupsFrom(catalogVariants(input.catalog, []), input.filters, purchased, '', { product: new Map(), variant: new Map() }).filter((group) => group.createdAt > 0);
    primary = takeProducts(groups, limit, (a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
  } else if (source === 'checkout') {
    const lines = raw?.checkout?.lineItems || [];
    const tally = tallyLines([{ createdAt: new Date(now || Date.now()).toISOString(), lineItems: lines }], (now || Date.now()) - DAY, now || Date.now());
    const checkoutFilters = { ...filters, hideMissingImage: false, hidePurchased: false, hideTrigger: false, hideOutOfStock: false };
    const groups = groupsFrom(lines, checkoutFilters, new Set(), '', tally);
    primary = takeProducts(groups, limit, (a, b) => b.units - a.units || a.key.localeCompare(b.key));
    return { products: primary, label: 'This checkout', usedFallback: false, unavailable: primary.length ? '' : 'This checkout has no products to show.' };
  } else if (source === 'copurchase' || source === 'viewed' || source === 'cart') {
    const keys = source === 'copurchase' ? null : behaviorKeys(raw?.behavior, raw?.email, source === 'viewed' ? 'product_viewed' : 'added_to_cart', now);
    const product = source === 'copurchase' ? coPurchaseUnits(input) : new Map((keys || []).map((key, index) => [key, 100000 - index]));
    const purchased = purchasedKeys(input.orders, input.email);
    const trigger = input.triggerProductId ? `p:${bareId(input.triggerProductId)}` : '';
    const groups = groupsFrom(catalogVariants(input.catalog, source === 'copurchase' ? input.orders : []), input.filters, purchased, source === 'copurchase' ? trigger : '', { product, variant: product });
    const wanted = keys ? new Set(keys) : null;
    const matched = wanted
      ? groups.filter((group) => wanted.has(group.key) || group.variants.some((variant) => wanted.has(itemKey(variant)) || wanted.has(`v:${variant.variantId}`) || wanted.has(`p:${variant.productId}`)))
      : groups.filter((group) => group.units > 0);
    primary = takeProducts(matched, limit, (a, b) => b.units - a.units || a.key.localeCompare(b.key));
  }
  if (primary.length >= limit || !PERSONAL.has(source)) {
    return { products: primary, label: feedLabel(source), usedFallback: false, unavailable: '' };
  }
  const days = fallback === 'best_3' ? 3 : 90;
  const extra = takeProducts(bestGroups(input, days).filter((group) => group.units > 0), limit, (a, b) => b.units - a.units || a.key.localeCompare(b.key));
  const seen = new Set(primary.map((row) => row.id));
  const filled = [...primary];
  for (const row of extra) {
    if (filled.length >= limit) break;
    if (row.id && seen.has(row.id)) continue;
    filled.push(row);
  }
  return {
    products: filled,
    label: primary.length ? feedLabel(source) : feedLabel(fallback),
    usedFallback: filled.length > primary.length,
    unavailable: ''
  };
}

function coPurchaseUnits(input) {
  const trigger = bareId(input.triggerProductId);
  const map = new Map();
  if (!trigger) return map;
  for (const order of input.orders || []) {
    const lines = order.lineItems || [];
    const hit = lines.some((line) => String(line.productId || '') === trigger || String(line.variantId || '') === trigger);
    if (!hit) continue;
    for (const line of lines) {
      if (String(line.productId || '') === trigger || String(line.variantId || '') === trigger) continue;
      const key = line.productId ? `p:${line.productId}` : itemKey(line);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + unitsOf(line));
      if (line.variantId) map.set(String(line.variantId), (map.get(String(line.variantId)) || 0) + unitsOf(line));
    }
  }
  return map;
}

export function resolveFeedDocument(blocks, context) {
  const walk = (list) => (Array.isArray(list) ? list : []).map((block) => {
    if (!block || typeof block !== 'object') return block;
    const next = { ...block };
    if (Array.isArray(block.columns)) next.columns = block.columns.map((column) => ({ ...column, blocks: walk(column.blocks) }));
    if (block.kind === 'product' && block.mode === 'feed') {
      const result = selectFeed({ ...(context || {}), ...(block.feed || {}), source: block.feed?.source, fallback: block.feed?.fallback });
      next.products = result.products;
      next.feedLabel = result.label;
      next.feedNote = result.unavailable || (result.usedFallback ? 'Filled from best sellers.' : '');
      next.feedReady = true;
    }
    return next;
  });
  return walk(blocks);
}

function zonedParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms));
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour'), minute: pick('minute') };
}

function zonedToUtc(year, month, day, hour, minute, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let pass = 0; pass < 4; pass++) {
    const got = zonedParts(utc, timeZone);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    const have = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute);
    if (want - have === 0) return utc;
    utc += want - have;
  }
  return utc;
}

function addDay(parts) {
  const at = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

/** Milliseconds when the text window opens, or null when sending is allowed now. */
export function quietOpenAt(now, timeZone) {
  const zone = isIanaTimezone(timeZone) ? timeZone : 'UTC';
  const parts = zonedParts(now, zone);
  const blocked = parts.hour >= QUIET_START_HOUR || parts.hour < QUIET_END_HOUR;
  if (!blocked) return null;
  const day = parts.hour >= QUIET_START_HOUR ? addDay(parts) : parts;
  return zonedToUtc(day.year, day.month, day.day, QUIET_END_HOUR, 0, zone);
}

export function smsQuietEnabled(node) {
  if (!node || node.quietHours === false) return false;
  if (node.quietHours === true) return true;
  return node.transactional !== true;
}

function gsmUnits(text) {
  let count = 0;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) count += 1;
    else if (GSM_EXT.includes(char)) count += 2;
    else return null;
  }
  return count;
}

export function smsDraft({ message, storeName }) {
  const name = String(storeName || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const prefix = name ? `${name}: ` : '';
  const body = String(message || '');
  const text = prefix && body.startsWith(prefix) ? body : `${prefix}${body}`;
  const gsm = gsmUnits(text);
  const unicode = gsm == null;
  const units = unicode ? Array.from(text).length : gsm;
  const limit = unicode ? 70 : 160;
  return {
    text,
    prefix,
    prefixed: Boolean(prefix),
    prefixNote: prefix ? '' : 'No store name is saved, so this text has no company prefix.',
    encoding: unicode ? 'unicode' : 'gsm',
    units,
    limit,
    warning: units > limit
      ? (unicode
        ? `This text is ${units} characters and includes an emoji or another character outside GSM. One text holds 70.`
        : `This text is ${units} GSM characters. One text holds 160.`)
      : ''
  };
}

export function smsCouponPlan(message) {
  const names = [];
  const text = String(message || '');
  for (const match of text.matchAll(COUPON_TAG)) names.push(match[2].trim());
  return { first: names[0] || '', extra: names.slice(1) };
}

export function applySmsCoupon(message, replacement) {
  let seen = false;
  return String(message || '').replace(COUPON_TAG, () => {
    if (seen) return '';
    seen = true;
    return replacement == null ? '' : String(replacement);
  });
}

export function rewriteFirstLink(text, shortUrl) {
  const source = String(text || '');
  const match = source.match(URL_RE);
  if (!match || match.index == null) return { text: source, url: '', rewritten: false };
  const raw = match[0];
  const url = raw.replace(/[),.;]+$/, '');
  const next = source.slice(0, match.index) + shortUrl + source.slice(match.index + url.length);
  return { text: next, url, rewritten: true };
}

export function applyLinkUtm(url, utm) {
  try {
    const next = new URL(url);
    const source = utm && typeof utm === 'object' ? utm : {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      if (source[key] && !next.searchParams.get(key)) next.searchParams.set(key, String(source[key]).slice(0, 80));
    }
    return next.toString();
  } catch {
    return url;
  }
}

export function redirectStatus(row, now) {
  if (!row?.url || !/^https?:\/\//i.test(String(row.url))) return 'missing';
  const exp = Date.parse(row.expiresAt || '');
  if (!Number.isFinite(exp) || exp <= now) return 'expired';
  return 'ok';
}

export function describeSentHtml(html) {
  const text = String(html || '');
  const hrefs = [...text.matchAll(/href="([^"]+)"/gi)].map((match) => match[1]);
  const pixel = /<img\b[^>]{0,400}(?:width|height)\s*=\s*["']?1\b[^>]*>/i.test(text) || /sendgrid\.net\/wf\/open|open\.gif/i.test(text);
  let rewritten = 0;
  let plain = 0;
  for (const href of hrefs) {
    if (TRACKER.test(href)) rewritten += 1;
    else if (/^https?:\/\//i.test(href) && !/\/u\//.test(href) && !/\/r\//.test(href)) plain += 1;
  }
  return { pixel, rewritten, plain, addPixel: false };
}

export function linksToRewrite(html) {
  const info = describeSentHtml(html);
  if (!info.pixel && info.rewritten === 0) return [];
  const hrefs = [...String(html || '').matchAll(/href="([^"]+)"/gi)].map((match) => match[1]);
  return [...new Set(hrefs.filter((href) => /^https?:\/\//i.test(href) && !TRACKER.test(href) && !/\/u\//.test(href) && !/\/r\//.test(href)))];
}

function dayCount(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(30, Math.round(n)));
}

export function cleanAttributionWindows(input) {
  return {
    emailClickDays: dayCount(input?.emailClickDays, EMAIL_CLICK_DAYS),
    emailOpenDays: dayCount(input?.emailOpenDays, EMAIL_OPEN_DAYS),
    smsClickDays: dayCount(input?.smsClickDays, SMS_CLICK_DAYS)
  };
}

function latestEvent(events, types, since, until) {
  let best = null;
  for (const event of events || []) {
    if (!types.has(String(event?.type || ''))) continue;
    const at = Date.parse(event?.at || '');
    if (!Number.isFinite(at) || at < since || at > until) continue;
    if (!best || at > Date.parse(best.at)) best = event;
  }
  return best;
}

export function lastTouch({ at, email, events, windows }) {
  const address = String(email || '').toLowerCase();
  const when = Number(at);
  if (!address.includes('@') || !Number.isFinite(when)) return null;
  const span = cleanAttributionWindows(windows);
  const own = (events || []).filter((event) => String(event?.email || '').toLowerCase() === address);
  const emailClick = latestEvent(own, EMAIL_CLICK, when - span.emailClickDays * DAY, when);
  const smsClick = latestEvent(own, SMS_CLICK, when - span.smsClickDays * DAY, when);
  let click = emailClick;
  if (smsClick && (!click || Date.parse(smsClick.at) > Date.parse(click.at))) click = smsClick;
  const chosen = click || latestEvent(own, EMAIL_OPEN, when - span.emailOpenDays * DAY, when);
  if (!chosen) return null;
  const kind = SMS_CLICK.has(chosen.type) ? 'sms_click' : (EMAIL_CLICK.has(chosen.type) ? 'email_click' : 'email_open');
  return {
    kind,
    at: chosen.at,
    windowDays: kind === 'sms_click' ? span.smsClickDays : (kind === 'email_click' ? span.emailClickDays : span.emailOpenDays),
    campaignId: String(chosen.campaignId || ''),
    flowId: String(chosen.flowId || ''),
    nodeId: String(chosen.nodeId || ''),
    sequenceId: String(chosen.sequenceId || ''),
    messageId: String(chosen.messageId || '')
  };
}

export function touchRevenue(order, touch) {
  if (!touch) return null;
  const net = netOrderValue(order);
  return net == null ? null : net;
}

export function tallyMessages(events, orders) {
  const count = (types) => {
    const n = (events || []).filter((event) => types.has(String(event?.type || ''))).length;
    return n > 0 ? n : null;
  };
  const touched = (orders || []).filter((order) => order?.emailTouch && order.emailTouch.revenue != null);
  const revenue = touched.length ? money(touched.reduce((sum, order) => sum + Number(order.emailTouch.revenue || 0), 0)) : null;
  const prefetch = (events || []).filter((event) => (event.type === 'email_opened' || event.type === 'opened') && event.prefetch === true).length;
  return {
    sent: count(new Set(['email_sent', 'sms_sent'])),
    delivered: count(new Set(['email_delivered', 'delivered'])),
    opened: count(EMAIL_OPEN),
    clicked: count(new Set([...EMAIL_CLICK, ...SMS_CLICK])),
    unsubscribed: count(new Set(['unsubscribe'])),
    revenue,
    prefetchOpens: prefetch > 0 ? prefetch : null
  };
}

export function sunsetCandidates({ contacts, events, quietDays, now }) {
  const days = Number(quietDays);
  if (!Number.isFinite(days) || days < 1 || !Number.isFinite(Number(now))) return [];
  const cutoff = now - days * DAY;
  const out = [];
  for (const contact of contacts || []) {
    const email = String(contact?.email || '').toLowerCase();
    if (!email.includes('@')) continue;
    const flag = contact?.properties?.unengaged;
    if (flag === true || flag === 'true') continue;
    const mine = (events || []).filter((event) => String(event?.email || '').toLowerCase() === email);
    const sends = mine.filter((event) => (event.type === 'email_sent' || event.type === 'sms_sent') && event.transactional !== true && Date.parse(event.at || '') <= cutoff);
    if (!sends.length) continue;
    const lastSend = Math.max(...sends.map((event) => Date.parse(event.at || '')));
    const engaged = mine.some((event) => {
      const at = Date.parse(event.at || '');
      return Number.isFinite(at) && at >= lastSend && (EMAIL_OPEN.has(event.type) || EMAIL_CLICK.has(event.type) || SMS_CLICK.has(event.type));
    });
    if (!engaged) out.push(email);
  }
  return out;
}

export function unengagedEmails(contacts) {
  const out = [];
  for (const contact of contacts || []) {
    const email = String(contact?.email || '').toLowerCase();
    const flag = contact?.properties?.unengaged;
    if (email.includes('@') && (flag === true || flag === 'true')) out.push(email);
  }
  return [...new Set(out)];
}
