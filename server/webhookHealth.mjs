/**
 * Webhook Health & Live Delivery Diagnostic Ring Buffer (server/webhookHealth.mjs)
 * 
 * High-performance, zero-cost operational observability for Shopify webhook signals.
 * Stores a bounded rolling FIFO ring buffer (50 items max per workspace) in memory.
 * Provides real-time health grading, 24h delivery counters, signature diagnostics,
 * safe PII-sanitized payload summaries, and zero-ad-cost test ping simulations.
 */
import crypto from 'crypto';

const MAX_RING_BUFFER_ENTRIES = 50;

/**
 * In-memory map of workspace ID -> Array<WebhookDeliveryReceipt>
 * @type {Map<string, Array<object>>}
 */
const webhookDeliveryLogs = new Map();

/**
 * Masks an email address to protect customer PII in diagnostic logs.
 * Example: 'sarah.connor@gmail.com' -> 's***r@gmail.com'
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 1) return '***' + trimmed.slice(atIdx);
  const namePart = trimmed.slice(0, atIdx);
  const domainPart = trimmed.slice(atIdx);
  if (namePart.length <= 2) {
    return namePart[0] + '***' + domainPart;
  }
  return namePart[0] + '***' + namePart[namePart.length - 1] + domainPart;
}

/**
 * Generates a concise, high-level, PII-sanitized summary of a webhook payload.
 */
export function summarizeWebhookPayload(topic, body) {
  if (!body || typeof body !== 'object') {
    return `Shopify event received (${topic || 'general'})`;
  }

  const cleanTopic = String(topic || '').toLowerCase();

  // Orders
  if (cleanTopic.includes('order')) {
    const orderNum = body.order_number || body.name || body.id || 'unknown';
    const total = Number(body.total_price || body.totalPrice || 0).toFixed(2);
    const currency = body.currency || 'USD';
    const itemsCount = Array.isArray(body.line_items) ? body.line_items.length : 1;
    const email = body.email || body.customer?.email || '';
    const masked = email ? ` · ${maskEmail(email)}` : '';
    return `Order #${orderNum} · $${total} ${currency} (${itemsCount} item${itemsCount === 1 ? '' : 's'})${masked}`;
  }

  // Checkouts
  if (cleanTopic.includes('checkout')) {
    const total = Number(body.total_price || body.subtotal_price || 0).toFixed(2);
    const currency = body.currency || 'USD';
    const itemsCount = Array.isArray(body.line_items) ? body.line_items.length : 1;
    const email = body.email || body.customer?.email || '';
    const masked = email ? ` · ${maskEmail(email)}` : '';
    return `Abandoned Checkout · $${total} ${currency} (${itemsCount} item${itemsCount === 1 ? '' : 's'})${masked}`;
  }

  // Fulfillments
  if (cleanTopic.includes('fulfillment')) {
    const fulId = body.id || 'unknown';
    const status = body.shipment_status || body.status || 'created';
    const tracking = body.tracking_number ? ` (Track: ${body.tracking_number})` : '';
    return `Fulfillment #${fulId} · ${status}${tracking}`;
  }

  // Refunds
  if (cleanTopic.includes('refund')) {
    const orderId = body.order_id || 'unknown';
    const amount = body.transactions?.[0]?.amount || body.order_adjustments?.[0]?.amount || '0.00';
    return `Refund on Order #${orderId} · $${Number(amount).toFixed(2)}`;
  }

  // Products
  if (cleanTopic.includes('product')) {
    const title = body.title || body.handle || body.id || 'Catalog item';
    const variants = Array.isArray(body.variants) ? ` (${body.variants.length} variants)` : '';
    return `Product: "${title}"${variants}`;
  }

  // Inventory
  if (cleanTopic.includes('inventory')) {
    const itemId = body.inventory_item_id || 'unknown';
    const qty = typeof body.available === 'number' ? body.available : 'updated';
    return `Inventory Level for item #${itemId} · Stock: ${qty}`;
  }

  // Customers
  if (cleanTopic.includes('customer')) {
    const email = body.email || '';
    const ordersCount = typeof body.orders_count === 'number' ? ` · ${body.orders_count} orders` : '';
    return `Customer profile updated${email ? ' · ' + maskEmail(email) : ''}${ordersCount}`;
  }

  return `Shopify event received (${topic})`;
}

/**
 * Records an incoming webhook delivery receipt into the workspace's ring buffer.
 */
export function recordWebhookDelivery(wsId, entry) {
  if (!wsId) return null;

  let buffer = webhookDeliveryLogs.get(wsId);
  if (!buffer) {
    buffer = [];
    webhookDeliveryLogs.set(wsId, buffer);
  }

  const receipt = {
    id: String(entry.id || entry.webhookId || `wh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
    topic: String(entry.topic || 'unknown'),
    shopDomain: String(entry.shopDomain || ''),
    receivedAt: entry.receivedAt || new Date().toISOString(),
    hmacStatus: entry.hmacStatus || 'valid',
    latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : 0,
    summary: String(entry.summary || ''),
    isTest: Boolean(entry.isTest)
  };

  buffer.unshift(receipt);

  if (buffer.length > MAX_RING_BUFFER_ENTRIES) {
    buffer.length = MAX_RING_BUFFER_ENTRIES;
  }

  return receipt;
}

/**
 * Calculates real-time health grading and delivery statistics for a workspace.
 */
export function getWebhookHealth(wsId, shopifyConfig) {
  const buffer = webhookDeliveryLogs.get(wsId) || [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const deliveries24h = buffer.filter((e) => new Date(e.receivedAt).getTime() >= oneDayAgo);
  const total24h = deliveries24h.length;
  const valid24h = deliveries24h.filter((e) => e.hmacStatus === 'valid').length;
  const failed24h = deliveries24h.filter((e) => e.hmacStatus !== 'valid').length;

  const isConnected = shopifyConfig?.status === 'connected' && Boolean(shopifyConfig?.storeDomain);
  const hasSecret = Boolean(shopifyConfig?.webhookSecret || shopifyConfig?.webhookSecretOnFile);

  let status = 'idle';
  let message = 'Awaiting incoming webhook signals from Shopify.';

  if (!isConnected) {
    status = 'disconnected';
    message = 'Connect your Shopify store to enable live webhook ingestion.';
  } else if (!hasSecret) {
    status = 'missing_secret';
    message = 'App API Webhook Secret is missing. Incoming Shopify orders and checkouts will be rejected.';
  } else if (buffer.length === 0) {
    status = 'idle';
    message = 'Ready and listening. Send a test ping or wait for live customer order activity.';
  } else if (failed24h > 0 && valid24h === 0) {
    status = 'failing';
    message = 'All recent webhook signals failed HMAC signature verification. Check your Shopify App API Secret.';
  } else if (failed24h > 0) {
    status = 'degraded';
    message = `${failed24h} signal(s) failed HMAC verification in the last 24 hours.`;
  } else {
    status = 'healthy';
    message = 'All incoming webhook deliveries verified and healthy.';
  }

  return {
    status,
    message,
    lastReceivedAt: buffer[0]?.receivedAt || null,
    metrics: {
      total24h,
      valid24h,
      failed24h,
      successRate: total24h > 0 ? Math.round((valid24h / total24h) * 100) : 100
    },
    recentDeliveries: buffer.slice(0, MAX_RING_BUFFER_ENTRIES)
  };
}

/**
 * Validates HMAC SHA-256 using timing-safe comparison.
 */
export function verifyShopifyHmac(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const computed = hmac.digest('base64');
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Simulates a self-signed test webhook ping for immediate verification.
 * Does not mutate customer CRM data or trigger external emails.
 */
export function simulateTestPing({ wsId, shopifyConfig, topic = 'orders/create' }) {
  const start = performance.now();
  const secret = String(shopifyConfig?.webhookSecret || '').trim();
  const shopDomain = String(shopifyConfig?.storeDomain || 'demo.myshopify.com');

  if (!secret) {
    const failedReceipt = recordWebhookDelivery(wsId, {
      topic,
      shopDomain,
      hmacStatus: 'missing_secret',
      latencyMs: Math.round(performance.now() - start),
      summary: 'Refused: No App API Webhook Secret configured for store',
      isTest: true
    });
    return {
      success: false,
      error: 'Cannot run test ping: No App API Webhook Secret is saved for this store.',
      delivery: failedReceipt,
      health: getWebhookHealth(wsId, shopifyConfig)
    };
  }

  // Build clean simulated payload
  let mockBody;
  if (topic.includes('checkout')) {
    mockBody = {
      id: `test_chk_${Date.now()}`,
      token: `test_tok_${Math.random().toString(36).slice(2, 8)}`,
      total_price: '64.00',
      currency: 'USD',
      email: 'test-shopper@jourvance.store',
      line_items: [
        { title: 'Test product (Test)', price: '64.00', quantity: 1 }
      ]
    };
  } else if (topic.includes('product')) {
    mockBody = {
      id: 9918239,
      title: 'Test product (Test)',
      handle: 'test-product',
      variants: [{ id: 4410293, title: 'Default', price: '49.00' }]
    };
  } else {
    mockBody = {
      id: `test_ord_${Date.now()}`,
      order_number: 9999,
      name: '#9999-TEST',
      email: 'test-shopper@jourvance.store',
      total_price: '49.00',
      currency: 'USD',
      financial_status: 'paid',
      line_items: [
        { title: 'Test product (Test)', price: '49.00', quantity: 1 }
      ],
      customer: {
        first_name: 'Test',
        last_name: 'Shopper',
        email: 'test-shopper@jourvance.store'
      }
    };
  }

  const rawJson = JSON.stringify(mockBody);
  const signature = crypto.createHmac('sha256', secret).update(rawJson).digest('base64');
  const isValid = verifyShopifyHmac(rawJson, signature, secret);

  const receipt = recordWebhookDelivery(wsId, {
    topic,
    shopDomain,
    hmacStatus: isValid ? 'valid' : 'invalid_signature',
    latencyMs: Math.max(1, Math.round(performance.now() - start)),
    summary: `[Test Ping] ${summarizeWebhookPayload(topic, mockBody)} · Signature Verified`,
    isTest: true
  });

  return {
    success: true,
    message: 'Test ping processed and HMAC signature verified successfully.',
    delivery: receipt,
    health: getWebhookHealth(wsId, shopifyConfig)
  };
}

/**
 * Resets the in-memory ring buffers. Used exclusively by automated test suites.
 */
export function clearWebhookDeliveryLogsForTest() {
  webhookDeliveryLogs.clear();
}
