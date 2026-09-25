/**
 * Shopify and page signals for flow triggers.
 * Pixel auth, catalog price and stock memory, and who qualifies.
 * Sending and file storage stay in server.mjs.
 */
import crypto from 'crypto';

export const BEHAVIOR_CAP = 50000;
export const PIXEL_LIMIT = 60;

export const WEBHOOK_TOPICS = [
  { topic: 'orders/create', path: '/api/webhooks/shopify/orders-create' },
  { topic: 'checkouts/create', path: '/api/webhooks/shopify/checkouts-create' },
  { topic: 'checkouts/update', path: '/api/webhooks/shopify/checkouts-update' },
  { topic: 'fulfillments/create', path: '/api/webhooks/shopify/fulfillments-create' },
  { topic: 'fulfillments/update', path: '/api/webhooks/shopify/fulfillments-update' },
  { topic: 'orders/cancelled', path: '/api/webhooks/shopify/orders-cancelled' },
  { topic: 'refunds/create', path: '/api/webhooks/shopify/refunds-create' },
  { topic: 'products/update', path: '/api/webhooks/shopify/products-update' },
  { topic: 'inventory_levels/update', path: '/api/webhooks/shopify/inventory-levels-update' },
  { topic: 'customers/update', path: '/api/webhooks/shopify/customers-update' }
];

export const PIXEL_TYPES = new Set([
  'product_viewed', 'added_to_cart', 'collection_viewed', 'search_submitted', 'checkout_started'
]);

export const BIND_TRIGGERS = new Set([
  'product_viewed', 'collection_viewed', 'search_submitted', 'added_to_cart'
]);

const FAKE_IDS = new Set([
  '42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999', '84920194821'
]);

export function shopifyId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const gid = raw.match(/(\d+)\s*$/);
  const id = raw.startsWith('gid://') && gid ? gid[1] : (/^\d+$/.test(raw) ? raw : raw.slice(0, 40));
  if (!id || FAKE_IDS.has(id)) return '';
  return id.slice(0, 40);
}

export function configuredPublicBase(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return '';
    return raw;
  } catch {
    return '';
  }
}

export function newPixelKey() {
  return crypto.randomBytes(24).toString('hex');
}

export function pixelKeyOk(stored, given) {
  const left = Buffer.from(String(stored || ''));
  const right = Buffer.from(String(given || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function allowPixel(store, clientId, now) {
  const key = String(clientId || '');
  if (!key) return false;
  const start = now - 60000;
  const recent = (store.get(key) || []).filter((at) => at > start);
  if (recent.length >= PIXEL_LIMIT) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

function money(value) {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return '';
  return n.toFixed(2);
}

function httpsText(value) {
  const raw = String(value || '');
  return /^https?:\/\//.test(raw) ? raw.slice(0, 500) : '';
}

function countOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function capMemory(memory) {
  const rows = Object.entries(memory).filter(([key]) => !key.startsWith('_'));
  if (rows.length <= 5000) return memory;
  const keep = rows.slice(-5000);
  const next = {};
  if (memory._byItem) next._byItem = memory._byItem;
  for (const [key, row] of keep) next[key] = row;
  return next;
}

export function applyProductUpdate(memory, payload, domain) {
  const source = memory && typeof memory === 'object' ? memory : {};
  const product = payload && typeof payload === 'object' ? payload : {};
  const productId = shopifyId(product.id);
  const title = String(product.title || '').slice(0, 200);
  const handle = String(product.handle || '').slice(0, 120);
  const status = String(product.status || '').toLowerCase();
  const published = status === 'active';
  const image = httpsText(product.image?.src || product.images?.[0]?.src);
  const url = domain && handle ? `https://${domain}/products/${handle}` : '';
  const next = { ...source };
  const changes = [];
  for (const variant of (Array.isArray(product.variants) ? product.variants : []).slice(0, 100)) {
    const variantId = shopifyId(variant?.id);
    if (!variantId) continue;
    const prev = next[variantId] && typeof next[variantId] === 'object' ? next[variantId] : {};
    const price = money(variant.price);
    const row = {
      ...prev,
      variantId,
      productId: productId || prev.productId || '',
      title: title || prev.title || '',
      url: url || prev.url || '',
      image: image || prev.image || '',
      published,
      updatedAt: new Date().toISOString()
    };
    if (price) row.price = price;
    const created = Date.parse(product.created_at || '');
    if (Number.isFinite(created)) row.createdAt = new Date(created).toISOString();
    else if (prev.createdAt) row.createdAt = prev.createdAt;
    const category = String(product.product_type || '').trim().slice(0, 80);
    if (category) row.category = category;
    else if (prev.category) row.category = prev.category;
    const compare = money(variant.compare_at_price);
    if (compare) row.compareAt = compare;
    const itemId = shopifyId(variant.inventory_item_id);
    if (itemId) row.inventoryItemId = itemId;
    const quantity = countOrNull(variant.inventory_quantity);
    if (quantity != null) row.available = quantity;
    else if (Number.isFinite(prev.available)) row.available = prev.available;
    else if (itemId && source._byItem?.[itemId] && Number.isFinite(source._byItem[itemId].available)) {
      row.available = source._byItem[itemId].available;
      row.locations = source._byItem[itemId].locations || {};
    }
    next[variantId] = row;
    changes.push({
      variantId,
      previousPrice: prev.price || '',
      price: row.price || '',
      previousAvailable: Number.isFinite(prev.available) ? prev.available : null,
      available: Number.isFinite(row.available) ? row.available : null,
      published: row.published === true
    });
  }
  return { memory: capMemory(next), changes };
}

export function applyInventoryLevel(memory, payload) {
  const source = memory && typeof memory === 'object' ? memory : {};
  const body = payload && typeof payload === 'object' ? payload : {};
  const itemId = shopifyId(body.inventory_item_id);
  const available = countOrNull(body.available);
  if (!itemId || available == null) return { memory: source, changes: [] };
  const locationId = shopifyId(body.location_id) || 'all';
  const byItem = { ...(source._byItem || {}) };
  const item = { ...(byItem[itemId] || {}), locations: { ...(byItem[itemId]?.locations || {}) } };
  item.locations[locationId] = available;
  item.available = Object.values(item.locations).reduce((sum, n) => sum + Number(n || 0), 0);
  byItem[itemId] = item;
  const next = { ...source, _byItem: byItem };
  const changes = [];
  for (const [key, row] of Object.entries(source)) {
    if (key.startsWith('_') || !row || row.inventoryItemId !== itemId) continue;
    const previousAvailable = Number.isFinite(row.available) ? row.available : null;
    next[key] = { ...row, available: item.available, locations: item.locations, updatedAt: new Date().toISOString() };
    changes.push({
      variantId: key,
      previousAvailable,
      available: item.available,
      published: row.published === true,
      price: row.price || '',
      previousPrice: row.price || ''
    });
  }
  return { memory: capMemory(next), changes };
}

export function priceDropQualifies(change, flow) {
  const before = Number(change?.previousPrice);
  const after = Number(change?.price);
  if (!Number.isFinite(before) || before <= 0) return false;
  if (!Number.isFinite(after) || after < 0) return false;
  if (after >= before) return false;
  if (change?.published !== true) return false;
  if (!(Number(change?.available) > 0)) return false;
  const mode = flow?.dropMode === 'amount' ? 'amount' : 'percent';
  const value = Number(flow?.dropValue);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (mode === 'amount') return before - after >= value - 1e-9;
  return ((before - after) / before) * 100 >= value - 1e-9;
}

export function lowInventoryQualifies(change, flow) {
  const available = Number(change?.available);
  const threshold = Number(flow?.stockThreshold);
  if (!Number.isFinite(available) || !Number.isFinite(threshold)) return false;
  return available > 0 && available <= threshold;
}

export function restockTransition(previous, available, minimum) {
  if (previous == null || available == null || minimum == null) return false;
  const before = Number(previous);
  const after = Number(available);
  const min = Number(minimum);
  if (!Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(min)) return false;
  return before < min && after >= min;
}

export function variantAudience({ variantId, since, behavior, checkouts, orders }) {
  const id = shopifyId(variantId);
  const emails = new Set();
  if (!id) return [];
  for (const event of behavior || []) {
    const email = String(event?.email || '').toLowerCase();
    if (!email || shopifyId(event.variantId) !== id) continue;
    if (!['product_viewed', 'added_to_cart', 'checkout_started'].includes(event.type)) continue;
    if (new Date(event.at || 0).getTime() < since) continue;
    emails.add(email);
  }
  for (const checkout of checkouts || []) {
    const email = String(checkout?.email || '').toLowerCase();
    if (!email || new Date(checkout.at || 0).getTime() < since) continue;
    if (!(checkout.variantIds || []).map(shopifyId).includes(id)) continue;
    emails.add(email);
  }
  for (const order of orders || []) {
    const email = String(order?.email || '').toLowerCase();
    if (email && (order.variantIds || []).map(shopifyId).includes(id)) emails.delete(email);
  }
  return [...emails];
}

export function restockRecipients(subscriptions, variantId, previous, available, minimum) {
  if (!restockTransition(previous, available, minimum)) return [];
  const id = shopifyId(variantId);
  return (subscriptions || [])
    .filter((row) => shopifyId(row?.variantId) === id && row.email && !row.firedAt)
    .map((row) => String(row.email).toLowerCase());
}

export function stampRestockFired(subscriptions, variantId, emails, at) {
  const id = shopifyId(variantId);
  const want = new Set((emails || []).map((email) => String(email).toLowerCase()));
  return (subscriptions || []).map((row) => (
    shopifyId(row.variantId) === id && want.has(String(row.email || '').toLowerCase())
      ? { ...row, firedAt: at }
      : row
  ));
}

export function rearmRestock(subscriptions, variantId, available, minimum) {
  if (!(Number(available) < Number(minimum))) return subscriptions || [];
  const id = shopifyId(variantId);
  return (subscriptions || []).map((row) => (
    shopifyId(row.variantId) === id ? { ...row, firedAt: '' } : row
  ));
}

export function fulfillmentKind(payload) {
  const status = `${payload?.fulfillment_status || ''} ${payload?.shipment_status || ''} ${payload?.status || ''}`.toLowerCase();
  return status.includes('partial') ? 'order_partially_fulfilled' : 'order_fulfilled';
}

export function marketingSubscribed(customer) {
  const state = customer?.email_marketing_consent?.state;
  if (state == null || state === '') return null;
  return String(state).toLowerCase() === 'subscribed';
}

export function cleanBehaviorEvent(input) {
  const type = String(input?.type || '');
  if (!PIXEL_TYPES.has(type)) return null;
  const event = {
    id: String(input.id || `beh_${Date.now().toString(36)}`).slice(0, 40),
    at: String(input.at || new Date().toISOString()).slice(0, 40),
    userId: String(input.userId || '').slice(0, 80),
    source: input.source === 'page' ? 'page' : 'pixel',
    type,
    visitorId: String(input.visitorId || '').slice(0, 80),
    clientId: String(input.clientId || '').slice(0, 80),
    email: String(input.email || '').trim().toLowerCase().slice(0, 120),
    productId: shopifyId(input.productId),
    variantId: shopifyId(input.variantId),
    collectionId: shopifyId(input.collectionId),
    query: String(input.query || '').slice(0, 120),
    price: money(input.price),
    currency: String(input.currency || '').slice(0, 8),
    checkoutToken: String(input.checkoutToken || '').slice(0, 80),
    url: httpsText(input.url)
  };
  if (type === 'product_viewed' && !event.productId && !event.variantId) return null;
  if (type === 'added_to_cart' && !event.variantId && !event.productId) return null;
  if (type === 'collection_viewed' && !event.collectionId) return null;
  if (type === 'checkout_started' && !event.checkoutToken && !event.clientId) return null;
  return event;
}

export function claimBehavior(events, link) {
  const email = String(link?.email || '').trim().toLowerCase();
  const visitorId = String(link?.visitorId || '');
  const clientId = String(link?.clientId || '');
  const checkoutToken = String(link?.checkoutToken || '');
  const claimed = [];
  let foundClient = clientId;
  for (const event of events || []) {
    if (!foundClient && checkoutToken && event.checkoutToken === checkoutToken && event.clientId) foundClient = event.clientId;
    if (event.email) continue;
    const hit = (visitorId && event.visitorId === visitorId)
      || (clientId && event.clientId === clientId)
      || (checkoutToken && event.checkoutToken === checkoutToken);
    if (!hit) continue;
    event.email = email;
    if (event.clientId && !foundClient) foundClient = event.clientId;
    claimed.push(event);
  }
  return { claimed, clientId: foundClient };
}

export function triggersFromClaim(claimed) {
  return (claimed || []).filter((event) => BIND_TRIGGERS.has(event.type)).slice(0, 20);
}

export function pageBeaconScript(page) {
  const productId = shopifyId(page?.productId);
  const variantId = shopifyId(page?.variantId);
  const collectionId = shopifyId(page?.collectionId);
  const price = money(page?.price);
  const lines = [];
  if (productId || variantId) {
    lines.push(`if (type === 'page_view') window.jourvanceTrack('product_viewed', ${JSON.stringify({ productId, variantId, price })});`);
  }
  if (collectionId) {
    lines.push(`if (type === 'page_view') window.jourvanceTrack('collection_viewed', ${JSON.stringify({ collectionId })});`);
  }
  return lines.join('\n');
}

export function commerceBeaconCall(cartAction) {
  if (cartAction === 'add') {
    return "if (window.jourvanceTrack) window.jourvanceTrack('added_to_cart', { productId: productId, variantId: variantId, price: productPrice });";
  }
  return "if (window.jourvanceTrack) window.jourvanceTrack('checkout_start');";
}

export function pixelSnippet({ endpoint, shop, key }) {
  const endpointJson = JSON.stringify(String(endpoint || ''));
  const shopJson = JSON.stringify(String(shop || ''));
  const keyJson = JSON.stringify(String(key || ''));
  return `const endpoint = ${endpointJson};
const shop = ${shopJson};
const key = ${keyJson};
function jourvancePixel(type, event, fields) {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body: JSON.stringify(Object.assign({ shop: shop, key: key, type: type, clientId: event.clientId || '' }, fields))
  });
}
analytics.subscribe('product_viewed', function (event) {
  var variant = (event.data && event.data.productVariant) || {};
  var price = variant.price || {};
  jourvancePixel('product_viewed', event, {
    productId: variant.product && variant.product.id,
    variantId: variant.id,
    price: price.amount,
    currency: price.currencyCode,
    url: event.context && event.context.document && event.context.document.location && event.context.document.location.href
  });
});
analytics.subscribe('product_added_to_cart', function (event) {
  var line = (event.data && event.data.cartLine && event.data.cartLine.merchandise) || {};
  var price = line.price || {};
  jourvancePixel('added_to_cart', event, {
    productId: line.product && line.product.id,
    variantId: line.id,
    price: price.amount,
    currency: price.currencyCode
  });
});
analytics.subscribe('collection_viewed', function (event) {
  var collection = (event.data && event.data.collection) || {};
  jourvancePixel('collection_viewed', event, { collectionId: collection.id });
});
analytics.subscribe('search_submitted', function (event) {
  var search = (event.data && event.data.searchResult) || {};
  jourvancePixel('search_submitted', event, { query: search.query || '' });
});
analytics.subscribe('checkout_started', function (event) {
  var checkout = (event.data && event.data.checkout) || {};
  jourvancePixel('checkout_started', event, { checkoutToken: checkout.token || '' });
});`;
}

export function restockSnippet({ endpoint, shop, key }) {
  return `<!-- Paste this on the product template. It records a request. It does not send email by itself. -->
<form method="post" action="${String(endpoint || '').replace(/"/g, '')}">
  <input type="hidden" name="shop" value="${String(shop || '').replace(/"/g, '')}">
  <input type="hidden" name="key" value="${String(key || '').replace(/"/g, '')}">
  <input type="hidden" name="variantId" value="{{ product.selected_or_first_available_variant.id }}">
  <label for="jv-restock-email">Email me when this is back</label>
  <input id="jv-restock-email" name="email" type="email" required>
  <label><input name="acceptsMarketing" type="checkbox" value="true"> Also send me store news</label>
  <button type="submit">Tell me</button>
</form>
<script>
document.currentScript.previousElementSibling.addEventListener('submit', function (event) {
  event.preventDefault();
  var form = event.currentTarget;
  var data = {
    shop: form.shop.value,
    key: form.key.value,
    variantId: form.variantId.value,
    email: form.email.value,
    acceptsMarketing: form.acceptsMarketing.checked === true
  };
  fetch(${JSON.stringify(String(endpoint || ''))}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  });
});
</script>`;
}

function starterMail(subject, text) {
  return {
    id: 'n_mail',
    type: 'email',
    status: 'draft',
    subject,
    blocks: [{ id: 'n_mail_b', kind: 'text', text }]
  };
}

function starterGraph(mail) {
  return {
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_wait', type: 'delay', delayMinutes: 60, mode: 'duration' },
      mail
    ],
    edges: [
      { id: 'e_start', source: 'n_start', target: 'n_wait', branch: '' },
      { id: 'e_wait', source: 'n_wait', target: 'n_mail', branch: '' }
    ]
  };
}

export function signalStarterFlows() {
  return [
    {
      id: 'flow_viewedproduct',
      name: 'Viewed a product',
      enabled: false,
      trigger: 'product_viewed',
      reentry: 'once',
      notes: ['Off until you turn it on. A view enrolls someone only after it is tied to an email. The wait is 60 minutes.'],
      ...starterGraph(starterMail('Still looking?', 'Hi {{first_name}},\n\nYou viewed a product on our store. This draft does not send until you turn the flow on and mark the email live.'))
    },
    {
      id: 'flow_addedtocart',
      name: 'Added to cart',
      enabled: false,
      trigger: 'added_to_cart',
      reentry: 'once',
      notes: ['Off until you turn it on. An add to cart enrolls someone only after it is tied to an email. The wait is 60 minutes.'],
      ...starterGraph(starterMail('Your cart is still here', 'Hi {{first_name}},\n\nYou added a product to the cart. This draft does not send until you turn the flow on and mark the email live.'))
    },
    {
      id: 'flow_pricedrop',
      name: 'Price drop',
      enabled: false,
      trigger: 'price_drop',
      reentry: 'once',
      dropMode: 'percent',
      dropValue: 10,
      lookbackDays: 30,
      notes: ['Off until you turn it on. Enrolls when a stored price falls by at least 10 percent, the variant is published, and stock is above zero. A missing stored price does not count.'],
      ...starterGraph(starterMail('A price went down', 'Hi {{first_name}},\n\nA product you viewed now has a lower stored price. This draft does not send until you turn the flow on and mark the email live.'))
    },
    {
      id: 'flow_backinstock',
      name: 'Back in stock',
      enabled: false,
      trigger: 'back_in_stock',
      reentry: 'once',
      stockMinimum: 1,
      notes: ['Off until you turn it on. Enrolls only someone who asked to hear about that variant. Each request is used once per restock. Past buyers are not added.'],
      ...starterGraph(starterMail('It is back', 'Hi {{first_name}},\n\nA variant you asked about is available again. This draft does not send until you turn the flow on and mark the email live.'))
    },
    {
      id: 'flow_sunset',
      name: 'Sunset',
      enabled: false,
      sunset: true,
      trigger: 'manual',
      reentry: 'once',
      notes: ['Off until you turn it on. After the quiet period you set, someone who was sent mail and did not open or click is marked unengaged. This flow sends nothing. The suppress button is the only step that stops mail, and an import does not press it.'],
      nodes: [{ id: 'n_start', type: 'trigger' }],
      edges: []
    }
  ];
}
