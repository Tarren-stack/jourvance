/**
 * Mail document, blocks, the small template language, and unsubscribe tokens.
 * A flat block list is one section with one column. Sections render in reading order.
 * Template tags run in text, table cells, button labels, and imported HTML.
 */
import crypto from 'crypto';
import { clausesMatch } from './email-flows.mjs';

const BLOCK_KINDS = new Set(['heading', 'text', 'button', 'divider', 'image', 'html', 'split', 'columns', 'table', 'spacer', 'social', 'header', 'video', 'product', 'coupon']);
const SOCIAL_NETWORKS = new Set(['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'pinterest', 'linkedin']);
const SOCIAL_LABEL = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest', linkedin: 'LinkedIn' };
const KNOWN_TAGS = new Set(['if', 'elif', 'else', 'endif', 'for', 'endfor', 'catalog', 'coupon_code']);
const KNOWN_FILTERS = new Set(['default', 'lookup']);

export function fillMailTokens(text, vars, keepUnknown) {
  const map = vars && typeof vars === 'object' ? { ...vars } : {};
  if (map.checkout_url && (map.abandoned_checkout_url == null || map.abandoned_checkout_url === '')) {
    map.abandoned_checkout_url = map.checkout_url;
  }
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (token, key) => {
    const value = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
    if (value == null || value === '') return keepUnknown ? token : '';
    return String(value);
  });
}

export function escapeMailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function sanitizeMailHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 60000);
}

export function safeMailUrl(url) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function personFields(name, extra) {
  const full = String(name || extra?.name || '').trim();
  const parts = full.split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || extra?.first_name || 'there',
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : String(extra?.last_name || ''),
    full_name: full
  };
}

function hexColor(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return '';
}

function px(value, max, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, n));
}

function httpsUrl(url) {
  const safe = safeMailUrl(url);
  return safe.toLowerCase().startsWith('https://') ? safe : '';
}

function cleanClause(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = ['profile', 'event_field', 'did', 'list', 'consent', 'random', 'prediction', 'unsupported'].includes(input.kind) ? input.kind : 'profile';
  if (kind === 'prediction' || kind === 'unsupported') return { kind };
  if (kind === 'random') return { kind, percent: Math.max(0, Math.min(100, Math.round(Number(input.percent) || 0))) };
  if (kind === 'consent') return { kind, channel: input.channel === 'sms' ? 'sms' : 'email', can: input.can !== false };
  if (kind === 'list') {
    const listId = String(input.listId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!listId) return null;
    return { kind, listId, member: input.member !== false };
  }
  if (kind === 'did') {
    const event = String(input.event || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (!event) return null;
    const since = input.since === 'enroll' ? 'enroll' : Math.max(1, Math.min(3650, Math.round(Number(input.since) || 30)));
    return { kind, event, since, done: input.done !== false };
  }
  const field = String(input.field || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  if (!field) return null;
  const op = ['set', 'unset', 'eq', 'neq', 'gt', 'lt', 'contains'].includes(input.op) ? input.op : 'eq';
  return { kind, field, op, value: String(input.value ?? '').slice(0, 120) };
}

function cleanGroup(input) {
  if (!input || typeof input !== 'object') return null;
  const clauses = (Array.isArray(input.clauses) ? input.clauses : []).map(cleanClause).filter(Boolean).slice(0, 8);
  if (!clauses.length) return null;
  return { join: input.join === 'any' ? 'any' : 'all', clauses };
}

function cleanDisplay(input) {
  if (!input || typeof input !== 'object') return null;
  const show = cleanGroup(input.show);
  const hide = cleanGroup(input.hide);
  if (!show && !hide) return null;
  return { ...(show ? { show } : {}), ...(hide ? { hide } : {}) };
}

function groupMatches(group, ctx) {
  const clauses = group?.clauses || [];
  if (!clauses.length) return false;
  if (group.join === 'any') return clauses.some((clause) => clausesMatch([clause], ctx));
  return clausesMatch(clauses, ctx);
}

function isShown(display, ctx) {
  if (!display) return true;
  const show = display.show ? groupMatches(display.show, ctx || {}) : null;
  const hide = display.hide ? groupMatches(display.hide, ctx || {}) : null;
  if (show === true && hide === true) return false;
  if (show === false) return false;
  if (hide === true) return false;
  return true;
}

function cleanWidth(value) {
  const raw = String(value || '').trim();
  if (/^\d{1,3}%$/.test(raw)) {
    const n = Number(raw.slice(0, -1));
    if (n >= 1 && n <= 100) return `${n}%`;
  }
  if (/^\d{1,3}$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= 600) return `${n}px`;
  }
  return '';
}

function cleanCouponName(value, fallback) {
  const name = String(value || '').replace(/[^\w .'-]/g, '').trim().slice(0, 40);
  return name || fallback;
}

export function cleanPageSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function pageDeepLink(base, slug, visitorId) {
  const safe = cleanPageSlug(slug);
  const origin = String(base || '').replace(/\/$/, '');
  if (!safe || !/^https?:\/\//.test(origin)) return '';
  let url;
  try { url = new URL(`${origin}/p/${safe}`); } catch { return ''; }
  const vid = String(visitorId || '');
  if (/^[A-Za-z0-9_.-]{6,80}$/.test(vid)) url.searchParams.set('jv_vid', vid);
  return url.toString();
}

function cleanProduct(input) {
  if (!input || typeof input !== 'object') return null;
  const row = {};
  const id = String(input.id || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (id) row.id = id;
  const title = String(input.title || '').trim().slice(0, 200);
  if (title) row.title = title;
  const image = safeMailUrl(input.image || input.imageUrl);
  if (image) row.image = image;
  const price = String(input.price || '').trim().slice(0, 40);
  if (price) row.price = price;
  const compareAt = String(input.compareAt || input.compare_at || '').trim().slice(0, 40);
  if (compareAt) row.compareAt = compareAt;
  const url = safeMailUrl(input.url);
  if (url) row.url = url;
  const currency = String(input.currency || '').trim().slice(0, 8);
  if (currency) row.currency = currency;
  const buttonLabel = String(input.buttonLabel || '').trim().slice(0, 40);
  if (buttonLabel && url) row.buttonLabel = buttonLabel;
  if (!row.title && !row.image && !row.price && !row.url) return null;
  return row;
}

function cleanCell(input) {
  const kind = input?.kind === 'image' ? 'image' : 'text';
  const cell = { kind };
  if (kind === 'image') {
    cell.url = String(input?.url || '').slice(0, 500);
    cell.alt = String(input?.alt || '').slice(0, 140);
    cell.href = String(input?.href || '').slice(0, 500);
  } else {
    cell.text = String(input?.text || '').slice(0, 4000);
  }
  return cell;
}

export function cleanBlock(input, depth = 0, index = 0) {
  if (!input || typeof input !== 'object') return null;
  const requested = BLOCK_KINDS.has(input.kind) ? input.kind : 'text';
  const kind = (requested === 'columns' || requested === 'split') && depth > 0 ? 'text' : requested;
  const row = {
    id: String(input.id || `blk_${index}`).replace(/\s/g, '').slice(0, 40) || `blk_${index}`,
    kind
  };
  const display = cleanDisplay(input.display);
  if (display) row.display = display;
  if (input.repeat === 'event.line_items') row.repeat = 'event.line_items';
  if (kind === 'heading' || kind === 'text' || kind === 'html') {
    row.text = String(input.text || '').slice(0, kind === 'html' ? 60000 : 4000);
    if (kind !== 'html') {
      const background = hexColor(input.background);
      const padding = px(input.padding, 48, null);
      if (background) row.background = background;
      if (padding) row.padding = padding;
    }
    if (kind === 'text') row.level = [1, 2, 3, 4].includes(Number(input.level)) ? Number(input.level) : 0;
  }
  if (kind === 'button') {
    row.label = String(input.label || input.text || 'Open').slice(0, 80);
    row.url = String(input.url || '').slice(0, 500);
    const color = hexColor(input.color);
    const radius = px(input.radius, 40, null);
    const padding = px(input.padding, 32, null);
    if (color) row.color = color;
    if (radius != null) row.radius = radius;
    if (padding != null) row.padding = padding;
  }
  if (kind === 'divider') {
    row.style = ['dashed', 'dotted'].includes(input.style) ? input.style : 'solid';
    const color = hexColor(input.color);
    if (color) row.color = color;
    row.thickness = px(input.thickness, 8, 1) || 1;
  }
  if (kind === 'image') {
    row.url = String(input.url || '').slice(0, 500);
    row.alt = String(input.alt || '').slice(0, 140);
    row.href = String(input.href || '').slice(0, 500);
    const width = cleanWidth(input.width);
    if (width) row.width = width;
    if (['center', 'right'].includes(input.align)) row.align = input.align;
    const eventField = String(input.eventField || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
    if (eventField) row.eventField = eventField;
  }
  if (kind === 'split') {
    const left = px(input.widths?.[0], 90, 50) || 50;
    row.widths = [left, 100 - left];
    row.stack = input.stack !== false;
    const cells = Array.isArray(input.cells) ? input.cells : [];
    row.cells = [0, 1].map((i) => cleanCell(cells[i] || { kind: 'text', text: '' }));
  }
  if (kind === 'columns') {
    row.stack = input.stack !== false;
    const source = Array.isArray(input.columns) && input.columns.length ? input.columns : [{ blocks: [] }, { blocks: [] }];
    row.columns = source.slice(0, 4).map((column) => ({
      blocks: (Array.isArray(column?.blocks) ? column.blocks : []).slice(0, 8).map((block, i) => cleanBlock(block, depth + 1, i)).filter(Boolean)
    }));
  }
  if (kind === 'table') {
    row.headers = (Array.isArray(input.headers) ? input.headers : []).slice(0, 8).map((cell) => String(cell || '').slice(0, 80));
    const rows = (Array.isArray(input.rows) ? input.rows : []).slice(0, row.repeat ? 1 : 20).map((line) => (
      (Array.isArray(line) ? line : []).slice(0, 8).map((cell) => String(cell || '').slice(0, 500))
    ));
    row.rows = rows.length ? rows : [['']];
  }
  if (kind === 'spacer') row.height = px(input.height, 120, 24) || 24;
  if (kind === 'social') {
    const color = hexColor(input.color);
    if (color) row.color = color;
    row.links = (Array.isArray(input.links) ? input.links : []).slice(0, 7).map((link) => ({
      network: SOCIAL_NETWORKS.has(link?.network) ? link.network : '',
      url: String(link?.url || '').slice(0, 500)
    })).filter((link) => link.network);
  }
  if (kind === 'header') {
    row.logoUrl = String(input.logoUrl || '').slice(0, 500);
    row.logoAlt = String(input.logoAlt || '').slice(0, 140);
    row.stack = input.stack !== false;
    row.links = (Array.isArray(input.links) ? input.links : []).slice(0, 6).map((link) => ({
      label: String(link?.label || '').slice(0, 40),
      url: String(link?.url || '').slice(0, 500)
    })).filter((link) => link.label || link.url);
  }
  if (kind === 'video') {
    row.url = String(input.url || '').slice(0, 500);
    row.thumbnail = String(input.thumbnail || '').slice(0, 500);
  }
  if (kind === 'product') {
    row.mode = input.mode === 'feed' ? 'feed' : 'static';
    if (row.mode === 'feed') {
      const sources = ['best_3', 'best_90', 'newest', 'copurchase', 'viewed', 'cart', 'checkout'];
      const num = (value) => {
        if (value == null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      row.feed = {
        source: sources.includes(input.feed?.source) ? input.feed.source : 'best_90',
        fallback: input.feed?.fallback === 'best_3' ? 'best_3' : 'best_90',
        limit: Math.max(1, Math.min(9, Math.round(Number(input.feed?.limit) || 3))),
        category: String(input.feed?.category || '').trim().slice(0, 80),
        minPrice: num(input.feed?.minPrice),
        maxPrice: num(input.feed?.maxPrice),
        minStock: num(input.feed?.minStock),
        hideMissingImage: input.feed?.hideMissingImage !== false,
        hideOutOfStock: input.feed?.hideOutOfStock !== false,
        hidePurchased: input.feed?.hidePurchased !== false,
        hideTrigger: input.feed?.hideTrigger !== false
      };
      row.products = input.feedReady ? (Array.isArray(input.products) ? input.products : []).map(cleanProduct).filter(Boolean).slice(0, 9) : [];
      if (input.feedReady) row.feedReady = true;
      if (input.feedLabel) row.feedLabel = String(input.feedLabel).slice(0, 80);
    } else {
      row.products = (Array.isArray(input.products) ? input.products : []).map(cleanProduct).filter(Boolean).slice(0, 9);
    }
    const pageSlug = cleanPageSlug(input.pageSlug);
    if (pageSlug) row.pageSlug = pageSlug;
  }
  if (kind === 'coupon') {
    row.discountType = input.discountType === 'fixed_amount' || input.discountType === 'free_shipping' ? input.discountType : 'percentage';
    row.value = Math.max(0, Math.min(100000, Number(input.value) || 0));
    row.prefix = String(input.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    row.name = cleanCouponName(input.name, row.prefix || 'Coupon');
    const pageSlug = cleanPageSlug(input.pageSlug);
    if (pageSlug) row.pageSlug = pageSlug;
  }
  return row;
}

export function cleanBlockList(input) {
  const source = Array.isArray(input) ? input : [];
  return source.slice(0, 24).map((block, index) => cleanBlock(block, 0, index)).filter(Boolean);
}

function cleanSection(section, index) {
  const visibility = section?.visibility === 'desktop' || section?.visibility === 'mobile' ? section.visibility : 'both';
  const columns = (Array.isArray(section?.columns) ? section.columns : [{ blocks: section?.blocks }]).slice(0, 4).map((column) => ({
    blocks: cleanBlockList(column?.blocks)
  }));
  const row = {
    id: String(section?.id || `s_${index}`).replace(/\s/g, '').slice(0, 40) || `s_${index}`,
    visibility,
    stack: section?.stack !== false,
    columns: columns.length ? columns : [{ blocks: [] }]
  };
  const background = hexColor(section?.background);
  const border = hexColor(section?.border);
  const padding = px(section?.padding, 48, null);
  if (background) row.background = background;
  if (border) row.border = border;
  if (padding) row.padding = padding;
  const display = cleanDisplay(section?.display);
  if (display) row.display = display;
  return row;
}

/** One section, one column, when the saved letter is still a flat block list. */
export function normalizeDocument(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && Array.isArray(input.sections)) {
    const sections = input.sections.slice(0, 20).map(cleanSection);
    return { sections: sections.length ? sections : [cleanSection({ id: 's_1' }, 1)] };
  }
  return { sections: [cleanSection({ id: 's_1', columns: [{ blocks: cleanBlockList(input) }] }, 1)] };
}

export function lineItemFields(item) {
  const row = {};
  if (!item || typeof item !== 'object') return row;
  const title = String(item.title || item.name || '').trim();
  if (title) row.title = title.slice(0, 200);
  if (item.quantity != null && item.quantity !== '') row.quantity = Number(item.quantity) || 0;
  if (item.price != null && item.price !== '') row.price = String(item.price).slice(0, 40);
  const variant = String(item.variantId || item.variant_id || '').trim();
  if (variant) row.variant_id = variant.slice(0, 40);
  const image = safeMailUrl(item.image);
  if (image) row.image = image;
  const url = safeMailUrl(item.url);
  if (url) row.url = url;
  return row;
}

export function couponPriceRule(spec) {
  const title = String(spec?.name || spec?.prefix || 'Coupon').slice(0, 80);
  if (spec?.discountType === 'free_shipping') {
    return {
      title,
      target_type: 'shipping_line',
      target_selection: 'all',
      allocation_method: 'each',
      value_type: 'percentage',
      value: '-100.0',
      customer_selection: 'all',
      usage_limit: 1
    };
  }
  const amount = Math.abs(Number(spec?.value) || 0);
  if (!amount) return null;
  const percentage = spec?.discountType !== 'fixed_amount';
  return {
    title,
    target_type: 'line_item',
    target_selection: 'all',
    allocation_method: 'across',
    value_type: percentage ? 'percentage' : 'fixed_amount',
    value: percentage ? `-${amount}` : `-${amount.toFixed(2)}`,
    customer_selection: 'all',
    usage_limit: 1
  };
}

export function couponCodeValue(prefix) {
  const stem = String(prefix || 'JV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'JV';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let tail = '';
  for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  return `${stem}-${tail}`;
}

export function storedCoupon(rows, email, name) {
  const address = String(email || '').trim().toLowerCase();
  const found = (Array.isArray(rows) ? rows : []).find((row) => row.email === address && row.name === name && row.code);
  return found?.code || '';
}

function walkBlocks(blocks, visit) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block) continue;
    visit(block);
    if (block.kind === 'columns') {
      for (const column of block.columns || []) walkBlocks(column.blocks, visit);
    }
  }
}

export function couponSpec(blocks, name) {
  let found = null;
  const visit = (block) => {
    if (block?.kind === 'coupon' && block.name === name) {
      found = { name: block.name, discountType: block.discountType, value: block.value, prefix: block.prefix || '' };
    }
  };
  if (Array.isArray(blocks)) walkBlocks(blocks, visit);
  else if (blocks?.sections) {
    for (const section of blocks.sections) for (const column of section.columns || []) walkBlocks(column.blocks, visit);
  }
  return found;
}

function splitPipes(raw) {
  const parts = [];
  let current = '';
  let quote = '';
  for (const ch of String(raw || '')) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '|') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function parseFilter(bit) {
  const text = String(bit || '').trim();
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([\s\S]*))?$/);
  if (!match) return { name: text.slice(0, 40) || 'filter', arg: '' };
  let arg = match[2] != null ? match[2].trim() : '';
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) arg = arg.slice(1, -1);
  return { name: match[1], arg };
}

function firstWord(raw) {
  return String(raw || '').trim().split(/\s+/)[0] || '';
}

function unquote(value) {
  const text = String(value || '').trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) return text.slice(1, -1);
  return text;
}

function scanSource(source, into) {
  const re = /\{\{\s*([\s\S]*?)\s*\}\}|\{%-?\s*([\s\S]*?)\s*-?%\}/g;
  let match;
  while ((match = re.exec(String(source || '')))) {
    if (match[1] != null) {
      const filters = splitPipes(match[1]).slice(1).map(parseFilter);
      for (const filter of filters) {
        if (!KNOWN_FILTERS.has(filter.name)) into.add(filter.name);
      }
      continue;
    }
    const raw = String(match[2] || '').trim();
    const word = firstWord(raw);
    if (!KNOWN_TAGS.has(word)) {
      if (word) into.add(word.slice(0, 40));
      continue;
    }
    if (word === 'for' && !/^for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+\S+/.test(raw)) into.add('for');
    if (word === 'catalog' && !/^catalog\s+\S+/.test(raw)) into.add('catalog');
    if (word === 'coupon_code' && !/^coupon_code\s+(['"])(.+)\1$/.test(raw)) into.add('coupon_code');
  }
}

function sourcesOf(block, into) {
  if (!block) return;
  if (block.kind === 'heading' || block.kind === 'text' || block.kind === 'html') scanSource(block.text, into);
  if (block.kind === 'button') scanSource(block.label, into);
  if (block.kind === 'split') for (const cell of block.cells || []) scanSource(cell.text, into);
  if (block.kind === 'table') for (const line of block.rows || []) for (const cell of line || []) scanSource(cell, into);
  if (block.kind === 'columns') for (const column of block.columns || []) for (const child of column.blocks || []) sourcesOf(child, into);
}

export function untranslatedInDocument(input) {
  const names = new Set();
  const blocks = Array.isArray(input) ? input : [];
  walkBlocks(blocks, (block) => sourcesOf(block, names));
  for (const node of input?.nodes || []) {
    walkBlocks(node.blocks, (block) => sourcesOf(block, names));
    for (const variation of node.variations || []) walkBlocks(variation.blocks, (block) => sourcesOf(block, names));
  }
  if (input?.sections) {
    for (const section of input.sections) for (const column of section.columns || []) walkBlocks(column.blocks, (block) => sourcesOf(block, names));
  }
  return [...names].slice(0, 20);
}

function isEmpty(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function dig(root, parts) {
  let current = root;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    if (!hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function resolvePath(path, env) {
  const parts = String(path || '').trim().split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) return undefined;
  if (hasOwn(env.bindings, parts[0])) return dig(env.bindings[parts[0]], parts.slice(1));
  if (parts[0] === 'event') return dig(env.event, parts.slice(1));
  if (parts[0] === 'item') return dig(env.item, parts.slice(1));
  if (parts[0] === 'person') return dig(env.person, parts.slice(1));
  if (parts.length === 1) {
    if (hasOwn(env.vars, parts[0]) && !isEmpty(env.vars[parts[0]])) return env.vars[parts[0]];
    if (hasOwn(env.person, parts[0]) && !isEmpty(env.person[parts[0]])) return env.person[parts[0]];
    if (hasOwn(env.event, parts[0]) && !isEmpty(env.event[parts[0]])) return env.event[parts[0]];
    if (hasOwn(env.item, parts[0]) && !isEmpty(env.item[parts[0]])) return env.item[parts[0]];
  }
  return undefined;
}

function asText(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item == null || item === '') return '';
      if (typeof item === 'object') return String(item.title || item.name || '');
      return String(item);
    }).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') return '';
  return String(value);
}

function applyFilters(value, filters, env) {
  let current = value;
  for (const filter of filters) {
    if (filter.name === 'default') {
      if (isEmpty(current)) current = filter.arg;
      continue;
    }
    if (filter.name === 'lookup') {
      current = current && typeof current === 'object' && !Array.isArray(current) && hasOwn(current, filter.arg) ? current[filter.arg] : undefined;
      continue;
    }
    env.untranslated.add(filter.name);
    return { drop: true, text: '' };
  }
  return { drop: false, text: asText(current) };
}

function tokenize(source) {
  const parts = [];
  const re = /\{\{\s*([\s\S]*?)\s*\}\}|\{%-?\s*([\s\S]*?)\s*-?%\}|\{#[\s\S]*?#\}/g;
  let last = 0;
  let match;
  const text = String(source || '');
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) });
    if (match[0].startsWith('{#')) parts.push({ type: 'text', text: '' });
    else if (match[1] != null) parts.push({ type: 'var', raw: match[1] });
    else parts.push({ type: 'tag', raw: String(match[2] || '').trim() });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function findClose(parts, from, openWord, closeWord) {
  let depth = 1;
  for (let i = from; i < parts.length; i += 1) {
    if (parts[i].type !== 'tag') continue;
    const word = firstWord(parts[i].raw);
    if (word === openWord) depth += 1;
    else if (word === closeWord) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function conditionTrue(raw, env) {
  const text = String(raw || '').trim();
  const negated = text.startsWith('not ');
  const body = negated ? text.slice(4).trim() : text;
  const cmp = body.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  let ok = false;
  if (cmp) {
    const left = asText(resolvePath(cmp[1].trim(), env));
    const right = unquote(cmp[3]);
    const op = cmp[2];
    if (!left && op !== '==') ok = false;
    else if (op === '==') ok = left === right;
    else if (op === '!=') ok = left !== right;
    else if (op === '>') ok = Number(left) > Number(right);
    else if (op === '<') ok = Number(left) < Number(right);
    else if (op === '>=') ok = Number(left) >= Number(right);
    else if (op === '<=') ok = Number(left) <= Number(right);
  } else {
    const value = resolvePath(body, env);
    ok = !isEmpty(value) && value !== false && value !== 0;
  }
  return negated ? !ok : ok;
}

function insertValue(text, env) {
  return env.html ? escapeMailHtml(text) : text;
}

function catalogSnippet(id, env) {
  const row = env.catalog && id ? env.catalog[String(id)] : null;
  if (!row || typeof row !== 'object') return '';
  const title = String(row.title || '').trim();
  const price = String(row.price || '').trim();
  const image = safeMailUrl(row.image);
  const url = safeMailUrl(row.url);
  if (env.html) {
    const bits = [];
    if (image) bits.push(`<img src="${escapeMailHtml(image)}" alt="${escapeMailHtml(title)}" style="max-width:100%;height:auto;border:0;">`);
    if (title) bits.push(`<div>${escapeMailHtml(title)}</div>`);
    if (price) bits.push(`<div>${escapeMailHtml(price)}</div>`);
    const inner = bits.join('');
    if (!inner) return '';
    return url ? `<a href="${escapeMailHtml(url)}" style="color:#111111;text-decoration:none;">${inner}</a>` : inner;
  }
  return [title, price, url].filter(Boolean).join(' ');
}

function couponText(name, env) {
  if (env.couponNames && !env.couponNames.has(name)) {
    env.untranslated.add(`coupon_code ${name}`.slice(0, 60));
    return '';
  }
  if (env.previewCoupons) return 'Code';
  const code = env.coupons && env.coupons[name];
  if (code) return String(code);
  if (!env.couponsNeeded.includes(name)) env.couponsNeeded.push(name);
  return 'A code was not created.';
}

function renderParts(parts, env) {
  let out = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.type === 'text') {
      out += part.text;
      continue;
    }
    if (part.type === 'var') {
      const bits = splitPipes(part.raw);
      const filters = bits.slice(1).map(parseFilter);
      const unknown = filters.find((filter) => !KNOWN_FILTERS.has(filter.name));
      if (unknown) {
        env.untranslated.add(unknown.name);
        continue;
      }
      const value = resolvePath(bits[0], env);
      if (!filters.length && isEmpty(value)) {
        if (env.keepUnknown) out += insertValue(`{{ ${bits[0].trim()} }}`, env);
        continue;
      }
      const applied = applyFilters(value, filters, env);
      if (!applied.drop) out += insertValue(applied.text, env);
      continue;
    }
    const word = firstWord(part.raw);
    if (word === 'if') {
      if ((env.depth || 0) > 8) {
        env.untranslated.add('if');
        continue;
      }
      const end = findClose(parts, i + 1, 'if', 'endif');
      if (end < 0) {
        env.untranslated.add('if');
        continue;
      }
      const branches = [];
      let start = i + 1;
      let current = { test: part.raw.replace(/^if\s*/, ''), parts: [] };
      for (let j = i + 1; j < end; j += 1) {
        const inner = parts[j];
        const innerWord = inner.type === 'tag' ? firstWord(inner.raw) : '';
        if (innerWord === 'if' || innerWord === 'for') {
          const nested = findClose(parts, j + 1, innerWord, innerWord === 'if' ? 'endif' : 'endfor');
          current.parts.push(...parts.slice(j, (nested < 0 ? j : nested) + 1));
          j = nested < 0 ? j : nested;
          continue;
        }
        if (innerWord === 'elif' || innerWord === 'else') {
          branches.push(current);
          current = { test: innerWord === 'else' ? null : inner.raw.replace(/^elif\s*/, ''), parts: [] };
          start = j + 1;
          continue;
        }
        current.parts.push(inner);
      }
      branches.push(current);
      const child = { ...env, depth: (env.depth || 0) + 1 };
      let chosen = branches.find((branch) => branch.test == null) || null;
      for (const branch of branches) {
        if (branch.test == null) break;
        if (conditionTrue(branch.test, env)) {
          chosen = branch;
          break;
        }
      }
      if (chosen) out += renderParts(chosen.parts, child);
      i = end;
      void start;
      continue;
    }
    if (word === 'for') {
      const spec = part.raw.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(\S+)$/);
      const end = findClose(parts, i + 1, 'for', 'endfor');
      if (!spec || end < 0 || (env.depth || 0) > 8) {
        env.untranslated.add('for');
        if (end >= 0) i = end;
        continue;
      }
      const list = resolvePath(spec[2], env);
      const items = Array.isArray(list) ? list.slice(0, 50) : [];
      const body = parts.slice(i + 1, end);
      for (const item of items) {
        const bindings = { ...(env.bindings || {}), [spec[1]]: item };
        out += renderParts(body, { ...env, bindings, item: spec[1] === 'item' ? item : env.item, depth: (env.depth || 0) + 1 });
      }
      i = end;
      continue;
    }
    if (word === 'catalog') {
      const arg = part.raw.replace(/^catalog\s+/, '');
      const token = unquote(arg);
      const looked = /[A-Za-z_]/.test(token) && (token.includes('.') || resolvePath(token, env) != null) && !/^['"]/.test(arg.trim())
        ? resolvePath(token, env)
        : token;
      out += catalogSnippet(looked == null ? '' : String(looked), env);
      continue;
    }
    if (word === 'coupon_code') {
      const named = part.raw.match(/^coupon_code\s+(['"])(.+)\1$/);
      if (!named) {
        env.untranslated.add('coupon_code');
        continue;
      }
      out += insertValue(couponText(named[2].slice(0, 40), env), env);
      continue;
    }
    if (word && !['elif', 'else', 'endif', 'endfor'].includes(word)) env.untranslated.add(word.slice(0, 40));
  }
  return out.slice(0, 100000);
}

function evaluate(source, env) {
  return renderParts(tokenize(source), env);
}

function buttonTextColor(bg) {
  const hex = bg.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#ffffff';
}

function boxStyle(block, extra) {
  const bits = [extra];
  if (block?.background) bits.push(`background:${block.background}`);
  if (block?.padding) bits.push(`padding:${block.padding}px`);
  return bits.filter(Boolean).join(';');
}

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      id = parsed.searchParams.get('v') || '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (!id && (parts[0] === 'embed' || parts[0] === 'shorts')) id = parts[1] || '';
    }
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function fillUrl(raw, env) {
  const filled = evaluate(String(raw || ''), { ...env, html: false, keepUnknown: false });
  return safeMailUrl(filled);
}

function linkedImage(src, alt, href, width, align) {
  const style = [`max-width:100%`, 'height:auto', 'border:0'];
  if (width) style.push(`width:${width}`);
  const img = `<img src="${escapeMailHtml(src)}" alt="${escapeMailHtml(alt || '')}" style="${style.join(';')}">`;
  const linked = href ? `<a href="${escapeMailHtml(href)}">${img}</a>` : img;
  const alignStyle = align === 'center' || align === 'right' ? `text-align:${align};` : '';
  return `<p style="margin:0 0 16px;${alignStyle}">${linked}</p>`;
}

function columnTable(cells, stack) {
  const width = Math.floor(100 / Math.max(1, cells.length));
  const cls = stack ? ' class="jv-stack"' : '';
  const tds = cells.map((html, index) => `<td${cls} width="${index === cells.length - 1 ? 100 - width * (cells.length - 1) : width}%" valign="top" style="vertical-align:top;">${html}</td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${tds}</tr></table>`;
}

function blockPageUrl(block, env) {
  if (!block?.pageSlug || !env?.ownedSlugs?.has(block.pageSlug)) return '';
  return pageDeepLink(env.pageBase, block.pageSlug, env.visitorId);
}

function renderBlock(block, env) {
  if (!isShown(block.display, env.showContext)) {
    env.stats.hidden += 1;
    return { html: '', text: '' };
  }
  if (block.repeat === 'event.line_items' && block.kind !== 'table') {
    const items = Array.isArray(env.event?.line_items) ? env.event.line_items : [];
    const html = [];
    const text = [];
    for (const item of items.slice(0, 50)) {
      const child = { ...env, item, bindings: { ...(env.bindings || {}), item } };
      const once = renderBlock({ ...block, repeat: '' }, child);
      if (once.html) html.push(once.html);
      if (once.text) text.push(once.text);
    }
    return { html: html.join(''), text: text.join('\n\n') };
  }
  const textEnv = { ...env, html: false };
  const htmlEnv = { ...env, html: true };
  if (block.kind === 'heading') {
    const text = evaluate(block.text, textEnv);
    return { html: `<h1 style="${boxStyle(block, 'font-size:22px;line-height:1.3;margin:0 0 12px;font-weight:600;')}">${escapeMailHtml(text)}</h1>`, text };
  }
  if (block.kind === 'text') {
    const text = evaluate(block.text, textEnv);
    const tag = [1, 2, 3, 4].includes(block.level) ? `h${block.level}` : 'p';
    const size = block.level === 1 ? 22 : block.level === 2 ? 18 : block.level === 3 ? 16 : block.level === 4 ? 15 : 15;
    return {
      html: `<${tag} style="${boxStyle(block, `font-size:${size}px;line-height:1.55;margin:0 0 12px;font-weight:${block.level ? 600 : 400};`)}">${escapeMailHtml(text).replace(/\n/g, '<br>')}</${tag}>`,
      text
    };
  }
  if (block.kind === 'divider') {
    const style = ['dashed', 'dotted'].includes(block.style) ? block.style : 'solid';
    const color = block.color || '#e5e7eb';
    const thickness = block.thickness || 1;
    return { html: `<hr style="border:none;border-top:${thickness}px ${style} ${color};margin:16px 0;">`, text: '---' };
  }
  if (block.kind === 'button') {
    const label = evaluate(block.label || 'Open', textEnv);
    const href = fillUrl(block.url, textEnv);
    if (!href) return { html: '', text: label };
    const bg = block.color || '#111111';
    const radius = block.radius != null ? block.radius : 6;
    const pad = block.padding != null ? block.padding : 12;
    const horizontal = block.padding != null ? Math.round(pad * 1.5) : 18;
    return {
      html: `<p style="margin:0 0 16px;"><a href="${escapeMailHtml(href)}" style="display:inline-block;padding:${pad}px ${horizontal}px;background:${bg};color:${buttonTextColor(bg)};text-decoration:none;border-radius:${radius}px;">${escapeMailHtml(label)}</a></p>`,
      text: [label, href].filter(Boolean).join(' ')
    };
  }
  if (block.kind === 'image') {
    const fromEvent = block.eventField ? (env.item && env.item[block.eventField] != null ? env.item[block.eventField] : env.event?.[block.eventField]) : '';
    const src = block.eventField ? safeMailUrl(fromEvent) : fillUrl(block.url, textEnv);
    if (!src) return { html: '', text: '' };
    const href = fillUrl(block.href, textEnv);
    return { html: linkedImage(src, block.alt, href, block.width, block.align), text: '' };
  }
  if (block.kind === 'html') {
    const clean = sanitizeMailHtml(block.text || '');
    const html = sanitizeMailHtml(evaluate(clean, htmlEnv));
    const text = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    return { html: html ? `<div>${html}</div>` : '', text };
  }
  if (block.kind === 'split') {
    const cells = (block.cells || []).map((cell) => {
      if (cell.kind === 'image') {
        const src = safeMailUrl(cell.url);
        return src ? { html: linkedImage(src, cell.alt, safeMailUrl(cell.href), '', ''), text: '' } : { html: '', text: '' };
      }
      const text = evaluate(cell.text || '', textEnv);
      return { html: `<p style="font-size:15px;line-height:1.55;margin:0;">${escapeMailHtml(text).replace(/\n/g, '<br>')}</p>`, text };
    });
    return { html: columnTable(cells.map((cell) => cell.html), block.stack !== false && env.sectionStack !== false), text: cells.map((cell) => cell.text).filter(Boolean).join('\n\n') };
  }
  if (block.kind === 'columns') {
    const rendered = (block.columns || []).map((column) => {
      const inner = (column.blocks || []).map((child) => renderBlock(child, env));
      return { html: inner.map((part) => part.html).join(''), text: inner.map((part) => part.text).filter(Boolean).join('\n\n') };
    });
    return { html: columnTable(rendered.map((part) => part.html), block.stack !== false && env.sectionStack !== false), text: rendered.map((part) => part.text).filter(Boolean).join('\n\n') };
  }
  if (block.kind === 'table') {
    const headers = (block.headers || []).map((cell) => `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;">${escapeMailHtml(cell)}</th>`).join('');
    const lines = [];
    const textLines = [];
    const rows = block.repeat === 'event.line_items' ? [] : (block.rows || []);
    const templates = block.rows || [];
    const source = block.repeat === 'event.line_items'
      ? (Array.isArray(env.event?.line_items) ? env.event.line_items : []).slice(0, 50)
      : rows;
    if (block.repeat === 'event.line_items') {
      for (const item of source) {
        const child = { ...textEnv, item, bindings: { ...(env.bindings || {}), item } };
        const cells = (templates[0] || []).map((cell) => evaluate(cell, child));
        lines.push(`<tr>${cells.map((cell) => `<td style="padding:6px 8px;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeMailHtml(cell)}</td>`).join('')}</tr>`);
        textLines.push(cells.filter(Boolean).join(' · '));
      }
    } else {
      for (const line of source) {
        const cells = (line || []).map((cell) => evaluate(cell, textEnv));
        lines.push(`<tr>${cells.map((cell) => `<td style="padding:6px 8px;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeMailHtml(cell)}</td>`).join('')}</tr>`);
        textLines.push(cells.filter(Boolean).join(' · '));
      }
    }
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px;">${headers ? `<tr>${headers}</tr>` : ''}${lines.join('')}</table>`;
    return { html, text: textLines.filter(Boolean).join('\n') };
  }
  if (block.kind === 'spacer') {
    const height = block.height || 24;
    return { html: `<div style="height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</div>`, text: '' };
  }
  if (block.kind === 'social') {
    const color = block.color || '#111111';
    const links = (block.links || []).map((link) => {
      const href = safeMailUrl(link.url);
      if (!href || !SOCIAL_NETWORKS.has(link.network)) return null;
      const label = SOCIAL_LABEL[link.network] || link.network;
      return { html: `<a href="${escapeMailHtml(href)}" style="color:${color};text-decoration:none;margin-right:12px;">${escapeMailHtml(label)}</a>`, text: `${label} ${href}` };
    }).filter(Boolean);
    return { html: links.length ? `<p style="margin:0 0 16px;">${links.map((link) => link.html).join('')}</p>` : '', text: links.map((link) => link.text).join('\n') };
  }
  if (block.kind === 'header') {
    const logo = safeMailUrl(block.logoUrl);
    const logoHtml = logo ? `<img src="${escapeMailHtml(logo)}" alt="${escapeMailHtml(block.logoAlt || '')}" style="max-width:160px;height:auto;border:0;">` : '';
    const links = (block.links || []).map((link) => {
      const href = safeMailUrl(link.url);
      if (!href || !link.label) return null;
      return { html: `<a href="${escapeMailHtml(href)}" style="color:#111111;text-decoration:none;margin-right:12px;">${escapeMailHtml(link.label)}</a>`, text: `${link.label} ${href}` };
    }).filter(Boolean);
    const linkHtml = links.map((link) => link.html).join('');
    if (!logoHtml && !linkHtml) return { html: '', text: '' };
    return { html: columnTable([logoHtml, linkHtml], block.stack !== false && env.sectionStack !== false), text: links.map((link) => link.text).join('\n') };
  }
  if (block.kind === 'video') {
    const href = httpsUrl(block.url);
    if (!href) return { html: '', text: '' };
    const yt = youtubeId(href);
    const thumb = yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : httpsUrl(block.thumbnail);
    if (thumb) return { html: linkedImage(thumb, 'Video', href, '', 'center'), text: href };
    return { html: `<p style="margin:0 0 16px;"><a href="${escapeMailHtml(href)}">Watch</a></p>`, text: href };
  }
  if (block.kind === 'product') {
    const caption = block.feedLabel === 'This checkout' ? '<p style="margin:0 0 8px;font-size:13px;">From this checkout</p>' : '';
    const captionText = block.feedLabel === 'This checkout' ? 'From this checkout' : '';
    const pageUrl = blockPageUrl(block, env);
    const cards = (block.products || []).slice(0, 9).map((product) => {
      const bits = [];
      const textBits = [];
      if (product.image) bits.push(`<img src="${escapeMailHtml(product.image)}" alt="${escapeMailHtml(product.title || '')}" style="max-width:100%;height:auto;border:0;">`);
      if (product.title) {
        bits.push(`<div style="font-weight:600;margin-top:6px;">${escapeMailHtml(product.title)}</div>`);
        textBits.push(product.title);
      }
      if (product.compareAt || product.price) {
        const price = [product.price, product.currency].filter(Boolean).join(' ');
        const struck = product.compareAt ? `<span style="text-decoration:line-through;color:#6b7280;margin-right:6px;">${escapeMailHtml(product.compareAt)}</span>` : '';
        bits.push(`<div style="margin-top:4px;">${struck}${price ? escapeMailHtml(price) : ''}</div>`);
        if (price) textBits.push(price);
      }
      const href = pageUrl || product.url;
      const buttonLabel = product.buttonLabel || (pageUrl ? 'View' : '');
      if (href && buttonLabel) {
        bits.push(`<p style="margin:8px 0 0;"><a href="${escapeMailHtml(href)}" style="display:inline-block;padding:12px 18px;background:#111111;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeMailHtml(buttonLabel)}</a></p>`);
        textBits.push(`${buttonLabel} ${href}`);
      }
      return { html: `<div style="margin:0 0 16px;">${bits.join('')}</div>`, text: textBits.join('\n') };
    });
    return { html: `${caption}${cards.map((card) => card.html).join('')}`, text: [captionText, cards.map((card) => card.text).filter(Boolean).join('\n\n')].filter(Boolean).join('\n\n') };
  }
  if (block.kind === 'coupon') {
    const text = couponText(block.name || 'Coupon', textEnv);
    const pageUrl = blockPageUrl(block, env);
    const link = pageUrl ? `<p style="margin:0 0 16px;"><a href="${escapeMailHtml(pageUrl)}">Open the page</a></p>` : '';
    const html = `${text ? `<p style="margin:0 0 16px;font-weight:600;">${escapeMailHtml(text)}</p>` : ''}${link}`;
    return { html, text: [text, pageUrl].filter(Boolean).join('\n') };
  }
  const text = evaluate(block.text || '', textEnv);
  return { html: `<p style="font-size:15px;line-height:1.55;margin:0 0 12px;">${escapeMailHtml(text).replace(/\n/g, '<br>')}</p>`, text };
}

export function tagOutboundLinks(text, contact) {
  return String(text || '').replace(/https?:\/\/[^\s)"']+/g, (url) => tagOneUrl(url, contact));
}

function tagOneUrl(url, contact) {
  try {
    const u = new URL(url);
    if (!u.searchParams.get('utm_source')) u.searchParams.set('utm_source', 'email');
    if (!u.searchParams.get('utm_medium')) u.searchParams.set('utm_medium', 'email');
    if (contact?.visitorId && u.pathname.includes('/cart/')) {
      u.searchParams.set('attributes[jv_vid]', contact.visitorId);
      if (contact.sourceSlug) u.searchParams.set('attributes[jv_slug]', contact.sourceSlug);
      if (contact.journeyId) u.searchParams.set('attributes[jv_journey]', contact.journeyId);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function tagHtmlHrefs(html, contact) {
  return String(html || '').replace(/href="(https?:\/\/[^"]+)"/g, (full, url) => `href="${escapeMailHtml(tagOneUrl(url, contact))}"`);
}

export function preheaderHtml(previewText) {
  const line = String(previewText || '').trim().slice(0, 140);
  if (!line) return '';
  return `<div lang="en" style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${escapeMailHtml(line)}</div>`;
}

export function footerHtml({ physicalAddress, unsubscribeUrl, marketing }) {
  const address = String(physicalAddress || '').trim().slice(0, 300);
  const link = safeMailUrl(unsubscribeUrl);
  const lines = ['<p style="font-size:12px;color:#6b7280;margin:24px 0 0;">Sent by Jourvance for this store.</p>'];
  if (address) lines.push(`<p style="font-size:12px;color:#6b7280;margin:4px 0 0;">${escapeMailHtml(address)}</p>`);
  if (marketing && link) {
    lines.push(`<p style="font-size:12px;color:#6b7280;margin:4px 0 0;"><a href="${escapeMailHtml(link)}" style="color:#6b7280;">Unsubscribe</a></p>`);
  } else if (marketing) {
    lines.push('<p style="font-size:12px;color:#6b7280;margin:4px 0 0;">An unsubscribe link is added for each person when this sends.</p>');
  }
  return `<div data-jourvance-footer="1">${lines.join('')}</div>`;
}

export function renderLetter({ blocks, vars, keepUnknown, previewText, physicalAddress, unsubscribeUrl, marketing = true, embedPreheader = false, contact, event, person, catalog, coupons, previewCoupons = false, showContext, pageBase = '', ownedSlugs = [], visitorId = '' }) {
  const doc = normalizeDocument(blocks);
  const map = vars && typeof vars === 'object' ? { ...vars } : {};
  if (map.checkout_url && (map.abandoned_checkout_url == null || map.abandoned_checkout_url === '')) {
    map.abandoned_checkout_url = map.checkout_url;
  }
  const mailEvent = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') mailEvent[key] = value;
  }
  if (event && typeof event === 'object') {
    for (const [key, value] of Object.entries(event)) {
      if (key === 'line_items' && Array.isArray(value)) mailEvent.line_items = value.map(lineItemFields);
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') mailEvent[key] = value;
    }
  }
  const couponNames = new Set();
  const untranslated = new Set(untranslatedInDocument(doc));
  for (const section of doc.sections) {
    for (const column of section.columns) walkBlocks(column.blocks, (block) => { if (block.kind === 'coupon' && block.name) couponNames.add(block.name); });
  }
  const env = {
    vars: map,
    event: mailEvent,
    person: person && typeof person === 'object' ? person : {},
    item: null,
    bindings: {},
    catalog: catalog && typeof catalog === 'object' ? catalog : {},
    coupons: coupons && typeof coupons === 'object' ? coupons : {},
    couponNames,
    couponsNeeded: [],
    previewCoupons: previewCoupons === true,
    keepUnknown: keepUnknown === true,
    untranslated,
    showContext: showContext || { profile: person || {}, properties: person || {}, event: mailEvent, lists: [], orders: [], events: [], enrollmentId: person?.email || '' },
    stats: { hidden: 0 },
    depth: 0,
    sectionStack: true,
    pageBase,
    ownedSlugs: new Set(Array.isArray(ownedSlugs) ? ownedSlugs : []),
    visitorId: visitorId || contact?.visitorId || ''
  };
  const htmlParts = [];
  const textParts = [];
  for (const section of doc.sections) {
    if (!isShown(section.display, env.showContext)) {
      env.stats.hidden += section.columns.reduce((sum, column) => sum + column.blocks.length, 0);
      continue;
    }
    const sectionEnv = { ...env, sectionStack: section.stack !== false };
    const columns = section.columns.map((column) => {
      const rendered = column.blocks.map((block) => renderBlock(block, sectionEnv));
      return { html: rendered.map((part) => part.html).join(''), text: rendered.map((part) => part.text).filter(Boolean).join('\n\n') };
    });
    const inner = columns.length > 1 ? columnTable(columns.map((column) => column.html), section.stack !== false) : columns.map((column) => column.html).join('');
    const vis = section.visibility === 'desktop' ? ' class="jv-desktop"' : section.visibility === 'mobile' ? ' class="jv-mobile"' : '';
    const style = [section.background ? `background:${section.background}` : '', section.padding ? `padding:${section.padding}px` : '', section.border ? `border:1px solid ${section.border}` : ''].filter(Boolean).join(';');
    htmlParts.push(`<div${vis}${style ? ` style="${style}"` : ''}>${inner}</div>`);
    textParts.push(columns.map((column) => column.text).filter(Boolean).join('\n\n'));
  }
  const css = '<style>.jv-mobile{display:none;max-height:0;overflow:hidden;}@media only screen and (max-width:480px){.jv-stack{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;}.jv-desktop{display:none!important;max-height:0!important;overflow:hidden!important;}.jv-mobile{display:block!important;max-height:none!important;overflow:visible!important;}}</style>';
  let html = `${css}<div style="font-family:Georgia,serif;color:#111111;max-width:560px;margin:0 auto;">${embedPreheader ? preheaderHtml(previewText) : ''}${htmlParts.join('')}${footerHtml({ physicalAddress, unsubscribeUrl, marketing })}</div>`;
  if (contact) html = tagHtmlHrefs(html, contact);
  const textFooter = [
    'Sent by Jourvance for this store.',
    String(physicalAddress || '').trim(),
    marketing && unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''
  ].filter(Boolean).join('\n');
  const text = tagOutboundLinks([textParts.filter(Boolean).join('\n\n'), textFooter].filter(Boolean).join('\n\n'), contact);
  return { html, text, document: doc, untranslated: [...untranslated].slice(0, 20), couponsNeeded: env.couponsNeeded, hidden: env.stats.hidden };
}

export function signUnsubscribe(secret, uid, email) {
  const key = String(secret || '');
  const address = String(email || '').trim().toLowerCase();
  if (!key || !uid || !address.includes('@')) return '';
  const body = Buffer.from(JSON.stringify({ u: String(uid).slice(0, 128), e: address })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readUnsubscribe(secret, token) {
  const key = String(secret || '');
  const parts = String(token || '').split('.');
  if (!key || parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = crypto.createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const email = String(parsed?.e || '').trim().toLowerCase();
    const uid = String(parsed?.u || '').trim();
    if (!uid || !email.includes('@')) return null;
    return { uid, email };
  } catch {
    return null;
  }
}

export function noteSuppression(rows, email, reason) {
  const address = String(email || '').trim().toLowerCase();
  const list = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  if (!address.includes('@')) return list;
  const known = new Set(['hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'sunset']);
  if (!known.has(reason)) return list;
  const existing = list.find((row) => row.email === address && row.reason === reason);
  if (existing) {
    if (reason === 'soft_bounce') existing.count = Math.min(99, Number(existing.count || 1) + 1);
    existing.at = new Date().toISOString();
    return list;
  }
  list.push({ email: address, reason, count: 1, at: new Date().toISOString() });
  return list.slice(-2000);
}

/** Hard bounces block every letter. Complaints, unsubscribes, and seven soft bounces block marketing. */
export function sendBlockReason(contact, rows, marketing) {
  const address = String(contact?.email || '').trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  const mine = list.filter((row) => row.email === address);
  if (mine.some((row) => row.reason === 'hard_bounce')) return 'hard_bounce';
  if (!marketing) return '';
  if (contact && contact.acceptsMarketing === false) return 'unsubscribed';
  if (mine.some((row) => row.reason === 'complaint' || row.reason === 'unsubscribe' || row.reason === 'sunset')) return 'unsubscribed';
  const soft = mine.find((row) => row.reason === 'soft_bounce');
  if (soft && Number(soft.count || 0) >= 7) return 'soft_bounce';
  return '';
}
