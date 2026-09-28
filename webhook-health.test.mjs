import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  maskEmail,
  summarizeWebhookPayload,
  recordWebhookDelivery,
  getWebhookHealth,
  verifyShopifyHmac,
  simulateTestPing,
  clearWebhookDeliveryLogsForTest
} from './server/webhookHealth.mjs';

test('maskEmail obfuscates email addresses while protecting PII', () => {
  assert.equal(maskEmail('sarah.connor@gmail.com'), 's***r@gmail.com');
  assert.equal(maskEmail('al@jourvance.store'), 'a***@jourvance.store');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail(null), '');
});

test('summarizeWebhookPayload creates informative, sanitized summaries for all topics', () => {
  // Order
  const orderSummary = summarizeWebhookPayload('orders/create', {
    order_number: 1042,
    total_price: '89.50',
    currency: 'USD',
    email: 'emma.watson@beauty.com',
    line_items: [{ title: 'Peptide Serum' }, { title: 'Eye Balm' }]
  });
  assert.match(orderSummary, /Order #1042/);
  assert.match(orderSummary, /\$89.50 USD/);
  assert.match(orderSummary, /2 items/);
  assert.match(orderSummary, /e\*\*\*n@beauty\.com/);
  assert.doesNotMatch(orderSummary, /emma\.watson/);

  // Checkout
  const checkoutSummary = summarizeWebhookPayload('checkouts/update', {
    subtotal_price: '64.00',
    currency: 'USD',
    email: 'shopper@test.com',
    line_items: [{ title: 'Night Cream' }]
  });
  assert.match(checkoutSummary, /Abandoned Checkout/);
  assert.match(checkoutSummary, /\$64.00 USD/);
  assert.match(checkoutSummary, /1 item/);

  // Fulfillment
  const fulfillmentSummary = summarizeWebhookPayload('fulfillments/create', {
    id: 5501,
    shipment_status: 'in_transit',
    tracking_number: 'TRACK12345'
  });
  assert.match(fulfillmentSummary, /Fulfillment #5501/);
  assert.match(fulfillmentSummary, /in_transit/);
  assert.match(fulfillmentSummary, /TRACK12345/);

  // Refund
  const refundSummary = summarizeWebhookPayload('refunds/create', {
    order_id: 1042,
    transactions: [{ amount: '25.00' }]
  });
  assert.match(refundSummary, /Refund on Order #1042/);
  assert.match(refundSummary, /\$25.00/);

  // Product
  const productSummary = summarizeWebhookPayload('products/update', {
    title: 'Rose Glow Peptide Serum',
    variants: [{}, {}]
  });
  assert.match(productSummary, /Rose Glow Peptide Serum/);
  assert.match(productSummary, /2 variants/);
});

test('recordWebhookDelivery enforces bounded 50-entry FIFO rolling ring buffer', () => {
  clearWebhookDeliveryLogsForTest();
  const wsId = 'ws-test-buffer';

  // Insert 60 webhook receipts
  for (let i = 1; i <= 60; i++) {
    recordWebhookDelivery(wsId, {
      topic: 'orders/create',
      shopDomain: 'brand.myshopify.com',
      hmacStatus: 'valid',
      latencyMs: i,
      summary: `Order #${i}`
    });
  }

  const health = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com', webhookSecret: 'secret' });
  
  // Max entries capped at 50
  assert.equal(health.recentDeliveries.length, 50);

  // Latest delivery is at the top (Order #60)
  assert.equal(health.recentDeliveries[0].summary, 'Order #60');
  assert.equal(health.recentDeliveries[0].latencyMs, 60);

  // Oldest retained is Order #11 (1-10 were evicted)
  assert.equal(health.recentDeliveries[49].summary, 'Order #11');
});

test('getWebhookHealth accurately computes connection status and metrics', () => {
  clearWebhookDeliveryLogsForTest();
  const wsId = 'ws-health-calc';

  // 1. Disconnected
  const disconnectedHealth = getWebhookHealth(wsId, { status: 'disconnected', storeDomain: '' });
  assert.equal(disconnectedHealth.status, 'disconnected');

  // 2. Missing secret
  const missingSecretHealth = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com' });
  assert.equal(missingSecretHealth.status, 'missing_secret');

  // 3. Idle (connected with secret, 0 events)
  const idleHealth = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com', webhookSecret: 'shpss_123' });
  assert.equal(idleHealth.status, 'idle');
  assert.equal(idleHealth.metrics.total24h, 0);
  assert.equal(idleHealth.metrics.successRate, 100);

  // 4. Healthy (all valid)
  recordWebhookDelivery(wsId, {
    topic: 'orders/create',
    shopDomain: 'brand.myshopify.com',
    hmacStatus: 'valid',
    summary: 'Order #101'
  });
  const healthy = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com', webhookSecret: 'shpss_123' });
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.metrics.total24h, 1);
  assert.equal(healthy.metrics.valid24h, 1);
  assert.equal(healthy.metrics.failed24h, 0);
  assert.equal(healthy.metrics.successRate, 100);

  // 5. Degraded (some failures)
  recordWebhookDelivery(wsId, {
    topic: 'orders/create',
    shopDomain: 'brand.myshopify.com',
    hmacStatus: 'invalid_signature',
    summary: 'Refused: Bad Signature'
  });
  const degraded = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com', webhookSecret: 'shpss_123' });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.metrics.total24h, 2);
  assert.equal(degraded.metrics.valid24h, 1);
  assert.equal(degraded.metrics.failed24h, 1);
  assert.equal(degraded.metrics.successRate, 50);

  // 6. Failing (all failing)
  clearWebhookDeliveryLogsForTest();
  recordWebhookDelivery(wsId, {
    topic: 'orders/create',
    shopDomain: 'brand.myshopify.com',
    hmacStatus: 'invalid_signature',
    summary: 'Refused: Bad Signature'
  });
  const failing = getWebhookHealth(wsId, { status: 'connected', storeDomain: 'brand.myshopify.com', webhookSecret: 'shpss_123' });
  assert.equal(failing.status, 'failing');
  assert.equal(failing.metrics.successRate, 0);
});

test('verifyShopifyHmac performs timing-safe cryptographic SHA-256 verification', () => {
  const secret = 'shpss_test_secret_key_8849';
  const body = JSON.stringify({ id: 1049, total_price: '49.00' });
  const validSignature = crypto.createHmac('sha256', secret).update(body).digest('base64');

  assert.equal(verifyShopifyHmac(body, validSignature, secret), true);
  assert.equal(verifyShopifyHmac(body, 'invalid_sig', secret), false);
  assert.equal(verifyShopifyHmac(body, validSignature, 'wrong_secret'), false);
  assert.equal(verifyShopifyHmac('', validSignature, secret), false);
});

test('simulateTestPing dispatches verified mock delivery without polluting customer data', () => {
  clearWebhookDeliveryLogsForTest();
  const wsId = 'ws-test-ping';
  const shopifyConfig = {
    status: 'connected',
    storeDomain: 'beauty-luxe.myshopify.com',
    webhookSecret: 'shpss_sample_secret_key'
  };

  // Run test ping
  const result = simulateTestPing({ wsId, shopifyConfig, topic: 'orders/create' });
  assert.equal(result.success, true);
  assert.match(result.message, /verified successfully/i);
  assert.equal(result.delivery.isTest, true);
  assert.equal(result.delivery.hmacStatus, 'valid');
  assert.match(result.delivery.summary, /\[Test Ping\]/);

  // Check health is updated
  assert.equal(result.health.status, 'healthy');
  assert.equal(result.health.metrics.valid24h, 1);
  assert.equal(result.health.recentDeliveries.length, 1);

  // Test ping with missing secret fails gracefully
  const missingResult = simulateTestPing({ wsId: 'ws-no-secret', shopifyConfig: { status: 'connected' }, topic: 'orders/create' });
  assert.equal(missingResult.success, false);
  assert.match(missingResult.error, /No App API Webhook Secret/i);
  assert.equal(missingResult.delivery.hmacStatus, 'missing_secret');
});

test('setupShopifyRoutes registers and executes webhook-health and webhook-test-ping routes', async () => {
  const { setupShopifyRoutes } = await import('./server/routes/shopifyRoutes.mjs');

  const routes = {};
  const mockApp = {
    get(path, ...handlers) {
      routes[`GET ${path}`] = handlers[handlers.length - 1];
    },
    post(path, ...handlers) {
      if (Array.isArray(path)) {
        for (const p of path) routes[`POST ${p}`] = handlers[handlers.length - 1];
      } else {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      }
    }
  };

  const mockWs = {
    id: 'ws-route-test',
    userId: 'usr_test',
    shopifyConfig: {
      status: 'connected',
      storeDomain: 'glow.myshopify.com',
      webhookSecret: 'shpss_valid_secret'
    }
  };

  const mockCtx = {
    requireUser: (req, res, next) => next(),
    loadWorkspace: async (uid, wsId) => (wsId === 'ws-route-test' ? mockWs : null),
    saveWorkspace: async () => {},
    presentWorkspace: (w) => w,
    workspaceCache: new Map(),
    cleanDomain: (d) => d,
    realStoreDomain: (cfg) => cfg?.storeDomain || '',
    adminToken: () => 'shpat_test',
    FAKE_STORE_DOMAINS: new Set(),
    WEBHOOK_TOPICS: [],
    signalTopicView: () => ({ topics: [], publicUrl: true }),
    newPixelKey: () => 'px_123',
    configuredPublicBase: () => 'https://jourvance.com',
    publicBase: () => 'https://jourvance.com',
    behaviorSummary: () => ({ todayCount: 0, lastEventAt: null }),
    pixelSnippet: () => '',
    restockSnippet: () => '',
    rememberAdminCatalog: () => {},
    mapShopifyProducts: () => [],
    loadCatalog: () => ({}),
    saveCatalog: () => {},
    applyProductUpdate: () => ({ memory: {} }),
    applyInventoryLevel: () => ({ memory: {} }),
    loadContacts: () => [],
    saveContacts: () => {},
    contactOwnerId: () => '',
    loadOrders: () => [],
    saveOrders: () => {},
    loadCheckouts: () => [],
    saveCheckouts: () => {},
    loadDrips: () => ({}),
    saveDrips: () => {},
    loadEvents: () => [],
    syncContactRfmTags: () => {},
    cleanRfmConfig: () => ({}),
    DEFAULT_RFM_CONFIG: {},
    userProgramBag: () => ({}),
    loadDiscounts: () => [],
    saveDiscounts: () => {},
    acceptShopifyWebhook: () => mockWs,
    recordWebhookDelivery,
    getWebhookHealth,
    summarizeWebhookPayload,
    simulateTestPing,
    noteAttrMap: () => ({}),
    pageOwnedBy: () => true,
    publicPageCache: new Map(),
    reloadPublicPageCache: () => {},
    recordEvent: () => {},
    attachBehavior: () => {},
    assignEmailTouch: () => {},
    channelOf: () => 'shopify',
    sendTransactional: () => {},
    orderMailVars: () => ({}),
    enrollAutomation: () => {},
    enrollFlowsForTrigger: () => {},
    enrollClaimedBehavior: () => {},
    refreshPredictions: () => {},
    noteSegmentChanges: () => {},
    handoffMapNodes: () => [],
    klaviyoIsSender: () => false,
    loadJourney: () => ({}),
    fulfillmentKind: () => 'standard',
    addRefund: () => {},
    touchRevenue: () => {},
    enrollPriceDrops: () => {},
    enrollInventorySignals: () => {},
    marketingSubscribed: () => true
  };

  setupShopifyRoutes(mockApp, mockCtx);

  // 1. Verify routes are registered
  assert.ok(routes['GET /api/workspace/:wsId/shopify/webhook-health'], 'webhook-health route should be registered');
  assert.ok(routes['POST /api/workspace/:wsId/shopify/webhook-test-ping'], 'webhook-test-ping route should be registered');

  // 2. Execute GET /api/workspace/:wsId/shopify/webhook-health
  let healthJson = null;
  const mockResHealth = {
    json(data) { healthJson = data; return this; },
    status() { return this; }
  };
  await routes['GET /api/workspace/:wsId/shopify/webhook-health']({
    user: { uid: 'usr_test' },
    params: { wsId: 'ws-route-test' }
  }, mockResHealth);

  assert.ok(healthJson);
  assert.equal(healthJson.success, true);
  assert.ok(healthJson.status);
  assert.ok(healthJson.metrics);

  // 3. Execute POST /api/workspace/:wsId/shopify/webhook-test-ping
  let pingJson = null;
  const mockResPing = {
    json(data) { pingJson = data; return this; },
    status() { return this; }
  };
  await routes['POST /api/workspace/:wsId/shopify/webhook-test-ping']({
    user: { uid: 'usr_test' },
    params: { wsId: 'ws-route-test' },
    body: { topic: 'orders/create' }
  }, mockResPing);

  assert.ok(pingJson);
  assert.equal(pingJson.success, true);
  assert.equal(pingJson.delivery?.isTest, true);
  assert.equal(pingJson.delivery?.hmacStatus, 'valid');
});

