import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DEFAULT_RFM_CONFIG, cleanRfmConfig, syncContactRfmTags } from './rfm-engine.mjs';

function computeShopifyHmac(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function createWebhookSimulator() {
  const store = {
    orders: [],
    contacts: [],
    drips: {
      sequences: [
        {
          id: 'seq_abandoned_cart',
          name: 'Cart Recovery Nurture',
          triggerType: 'checkout_abandonment',
          smartExitOnPurchase: true,
          activeEnrollments: 1,
          totalExitedPurchased: 0
        },
        {
          id: 'seq_upsell_rec',
          name: 'VIP Upsell Recovery',
          triggerType: 'upsell_recovery',
          smartExitOnPurchase: true,
          activeEnrollments: 1,
          totalExitedPurchased: 0
        },
        {
          id: 'seq_post_purchase_ritual',
          name: 'Post-Purchase Welcome Ritual (5-Step)',
          triggerType: 'post_purchase',
          smartExitOnPurchase: false,
          activeEnrollments: 1,
          totalExitedPurchased: 0
        }
      ],
      enrollments: [
        {
          id: 'enr_cart_1',
          sequenceId: 'seq_abandoned_cart',
          userId: 'ws_tenant_a',
          customerEmail: 'eva@example.com',
          status: 'active',
          enrolledAt: '2026-09-20T10:00:00.000Z'
        },
        {
          id: 'enr_upsell_1',
          sequenceId: 'seq_upsell_rec',
          userId: 'ws_tenant_a',
          customerEmail: 'eva@example.com',
          status: 'active',
          enrolledAt: '2026-09-21T10:00:00.000Z'
        },
        {
          id: 'enr_post_purchase_1',
          sequenceId: 'seq_post_purchase_ritual',
          userId: 'ws_tenant_a',
          customerEmail: 'eva@example.com',
          status: 'active',
          enrolledAt: '2026-09-22T10:00:00.000Z'
        }
      ]
    },
    checkouts: [
      {
        id: 'chk_eva_1',
        userId: 'ws_tenant_a',
        customerEmail: 'eva@example.com',
        token: 'cart_token_eva_123',
        recoveryStatus: 'pending',
        totalPrice: 125
      },
      {
        id: 'chk_other_tenant',
        userId: 'ws_tenant_b',
        customerEmail: 'eva@example.com',
        token: 'cart_token_other',
        recoveryStatus: 'pending',
        totalPrice: 200
      }
    ],
    events: []
  };

  const ws = {
    id: 'ws_tenant_a',
    userId: 'ws_tenant_a',
    shopifyConfig: {
      webhookSecret: 'shpss_secret_beauty_key_99'
    }
  };

  function handleOrderWebhook(payload, headers) {
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const hmacHeader = headers['x-shopify-hmac-sha256'];
    const expectedHmac = computeShopifyHmac(rawBody, ws.shopifyConfig.webhookSecret);

    if (hmacHeader !== expectedHmac) {
      return { status: 401, body: { success: false, error: 'Shopify signature did not match this store’s app API secret.' } };
    }

    const orderId = String(parsedPayload.id || parsedPayload.order_id || `ord_${Date.now()}`);
    const totalPrice = Number(parsedPayload.total_price || parsedPayload.totalPrice || 0);
    const customer = parsedPayload.customer || {};
    const customerEmail = (customer.email || parsedPayload.email || '').toLowerCase().trim();
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer';
    const lineItems = Array.isArray(parsedPayload.line_items) ? parsedPayload.line_items : [];

    // Tenant-isolated idempotency check
    const existingOrder = store.orders.find(o => String(o.id) === orderId && o.userId === ws.userId);
    if (existingOrder) {
      if (parsedPayload.financial_status && existingOrder.financialStatus !== parsedPayload.financial_status) {
        existingOrder.financialStatus = parsedPayload.financial_status;
      }
      return { status: 200, body: { success: true, duplicate: true, message: 'Order already recorded (idempotent)', orderId } };
    }

    // Bump item detection
    let bumpIncluded = Boolean(parsedPayload.orderBumpIncluded);
    for (const it of lineItems) {
      const title = (it.title || it.name || '').toLowerCase();
      if (title.includes('bump') || title.includes('add-on') || title.includes('addon')) {
        bumpIncluded = true;
      }
    }

    // Update or insert CRM Contact
    let contact = store.contacts.find(c => c.email === customerEmail && c.userId === ws.userId);
    const rfmConfig = DEFAULT_RFM_CONFIG;
    if (contact) {
      contact.ordersCount = (contact.ordersCount || 0) + 1;
      contact.totalSpent = Number(((contact.totalSpent || 0) + totalPrice).toFixed(2));
      contact.lastOrderAt = new Date().toISOString();
      if (!contact.tags) contact.tags = [];
      if (!contact.tags.includes('Shopify Buyer')) contact.tags.push('Shopify Buyer');
      if (bumpIncluded && !contact.tags.includes('Order Bump Taker')) contact.tags.push('Order Bump Taker');
      syncContactRfmTags(contact, rfmConfig);
    } else {
      contact = {
        id: `cust_${Date.now()}`,
        email: customerEmail,
        name: customerName,
        totalSpent: totalPrice,
        ordersCount: 1,
        userId: ws.userId,
        tags: ['Shopify Buyer', ...(bumpIncluded ? ['Order Bump Taker'] : [])],
        firstSeenAt: new Date().toISOString(),
        lastOrderAt: new Date().toISOString()
      };
      syncContactRfmTags(contact, rfmConfig);
      store.contacts.push(contact);
    }

    // Selective Drip Smart-Exit
    for (const enr of store.drips.enrollments) {
      if (enr.customerEmail === customerEmail && enr.status === 'active' && enr.userId === ws.userId) {
        const seq = store.drips.sequences.find(s => s.id === enr.sequenceId);
        const isPrePurchaseOrExit = Boolean(
          seq && (
            seq.smartExitOnPurchase ||
            seq.triggerType === 'checkout_abandonment' ||
            seq.triggerType === 'abandoned_checkout' ||
            seq.triggerType === 'browse_abandonment' ||
            seq.triggerType === 'upsell_recovery'
          )
        );
        if (isPrePurchaseOrExit) {
          enr.status = 'converted_exit';
          enr.convertedAt = new Date().toISOString();
          if (seq) {
            seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
            seq.totalExitedPurchased = (seq.totalExitedPurchased || 0) + 1;
          }
        }
      }
    }

    // Tenant-isolated Checkout Recovery
    let recoveredCheckoutId = null;
    for (const chk of store.checkouts) {
      if (chk.userId === ws.userId && chk.recoveryStatus !== 'recovered') {
        const matchesEmail = chk.customerEmail && customerEmail && chk.customerEmail.toLowerCase() === customerEmail.toLowerCase();
        const matchesCartToken = parsedPayload.cart_token && chk.token === parsedPayload.cart_token;
        const matchesToken = parsedPayload.token && chk.token === parsedPayload.token;
        if (matchesEmail || matchesCartToken || matchesToken) {
          chk.recoveryStatus = 'recovered';
          chk.recoveredAt = new Date().toISOString();
          chk.recoveredOrderId = orderId;
          recoveredCheckoutId = chk.id;
          store.events.push({
            type: 'checkout_recovered',
            userId: ws.userId,
            email: customerEmail,
            orderId,
            checkoutId: chk.id,
            value: totalPrice
          });
        }
      }
    }

    // Record order
    const orderRecord = {
      id: orderId,
      orderNumber: `#${orderId.slice(-4)}`,
      totalPrice,
      customerEmail,
      customerName,
      financialStatus: parsedPayload.financial_status || 'paid',
      orderBumpIncluded: bumpIncluded,
      recoveredCheckoutId: recoveredCheckoutId || undefined,
      userId: ws.userId,
      createdAt: new Date().toISOString()
    };
    store.orders.unshift(orderRecord);

    return {
      status: 200,
      body: {
        success: true,
        orderId,
        order: orderRecord,
        recoveredCheckoutId,
        bumpIncluded,
        customer: customerEmail
      }
    };
  }

  return { store, ws, handleOrderWebhook };
}

test('Shopify Order Ingestion: HMAC validation succeeds for matching secret and rejects invalid signatures', () => {
  const sim = createWebhookSimulator();
  const payload = {
    id: 'ord_1001',
    total_price: '85.00',
    customer: { email: 'charlotte@example.com', first_name: 'Charlotte' }
  };
  const bodyStr = JSON.stringify(payload);

  // Invalid HMAC
  const badRes = sim.handleOrderWebhook(bodyStr, { 'x-shopify-hmac-sha256': 'invalid_signature_hash' });
  assert.equal(badRes.status, 401);
  assert.equal(badRes.body.success, false);

  // Valid HMAC
  const validHmac = computeShopifyHmac(bodyStr, sim.ws.shopifyConfig.webhookSecret);
  const goodRes = sim.handleOrderWebhook(bodyStr, { 'x-shopify-hmac-sha256': validHmac });
  assert.equal(goodRes.status, 200);
  assert.equal(goodRes.body.success, true);
  assert.equal(goodRes.body.orderId, 'ord_1001');
});

test('Shopify Order Ingestion: Auto-syncs customer CRM profile, bump tag, and RFM intelligence', () => {
  const sim = createWebhookSimulator();
  const payload = {
    id: 'ord_whale_99',
    total_price: '550.00',
    customer: { email: 'eva@example.com', first_name: 'Eva', last_name: 'Rostova' },
    line_items: [
      { title: 'Rose Silk Regenerative Serum', quantity: 2, price: 220 },
      { title: 'Hydra-Firming Eye Balm (Add-on Ritual Bump)', quantity: 1, price: 110 }
    ]
  };
  const bodyStr = JSON.stringify(payload);
  const hmac = computeShopifyHmac(bodyStr, sim.ws.shopifyConfig.webhookSecret);

  const res = sim.handleOrderWebhook(bodyStr, { 'x-shopify-hmac-sha256': hmac });
  assert.equal(res.status, 200);
  assert.equal(res.body.bumpIncluded, true);

  // Check CRM Contact
  const contact = sim.store.contacts.find(c => c.email === 'eva@example.com');
  assert.ok(contact, 'Contact should be created in CRM');
  assert.equal(contact.ordersCount, 1);
  assert.equal(contact.totalSpent, 550);
  assert.ok(contact.tags.includes('Shopify Buyer'));
  assert.ok(contact.tags.includes('Order Bump Taker'), 'Should have Order Bump Taker tag');

  // Verify RFM tags: $550 spend >= $500 platinum threshold
  assert.ok(contact.tags.includes('VIP-Platinum'), 'Should have VIP-Platinum tag');
  assert.ok(contact.tags.includes('VIP Customer'), 'Should have VIP Customer tag');
  assert.ok(contact.tags.includes('First-Time Buyer'), 'Should have First-Time Buyer tag');
});

test('Shopify Order Ingestion: Selectively exits pre-purchase drips while protecting post-purchase nurture', () => {
  const sim = createWebhookSimulator();
  const payload = {
    id: 'ord_nurture_check',
    total_price: '95.00',
    customer: { email: 'eva@example.com', first_name: 'Eva' }
  };
  const bodyStr = JSON.stringify(payload);
  const hmac = computeShopifyHmac(bodyStr, sim.ws.shopifyConfig.webhookSecret);

  sim.handleOrderWebhook(bodyStr, { 'x-shopify-hmac-sha256': hmac });

  // 1. Abandoned Cart drip MUST be converted_exit
  const cartEnr = sim.store.drips.enrollments.find(e => e.id === 'enr_cart_1');
  assert.equal(cartEnr.status, 'converted_exit', 'Abandoned cart drip should exit on order');
  assert.ok(cartEnr.convertedAt);

  // 2. Upsell Recovery drip MUST be converted_exit
  const upsellEnr = sim.store.drips.enrollments.find(e => e.id === 'enr_upsell_1');
  assert.equal(upsellEnr.status, 'converted_exit', 'Upsell recovery drip should exit on order');
  assert.ok(upsellEnr.convertedAt);

  // 3. Post-Purchase Ritual MUST REMAIN ACTIVE
  const postPurchaseEnr = sim.store.drips.enrollments.find(e => e.id === 'enr_post_purchase_1');
  assert.equal(postPurchaseEnr.status, 'active', 'Post-purchase nurture sequence must NOT exit on purchase');
});

test('Shopify Order Ingestion: Closed-loop abandoned checkout recovery with tenant isolation', () => {
  const sim = createWebhookSimulator();
  const payload = {
    id: 'ord_recovery_test',
    total_price: '125.00',
    cart_token: 'cart_token_eva_123',
    customer: { email: 'eva@example.com' }
  };
  const bodyStr = JSON.stringify(payload);
  const hmac = computeShopifyHmac(bodyStr, sim.ws.shopifyConfig.webhookSecret);

  const res = sim.handleOrderWebhook(bodyStr, { 'x-shopify-hmac-sha256': hmac });
  assert.equal(res.status, 200);
  assert.equal(res.body.recoveredCheckoutId, 'chk_eva_1');

  // Verify Store A checkout is recovered
  const chkA = sim.store.checkouts.find(c => c.id === 'chk_eva_1');
  assert.equal(chkA.recoveryStatus, 'recovered');
  assert.equal(chkA.recoveredOrderId, 'ord_recovery_test');
  assert.ok(chkA.recoveredAt);

  // Verify checkout_recovered event was logged
  const recoveryEv = sim.store.events.find(e => e.type === 'checkout_recovered');
  assert.ok(recoveryEv);
  assert.equal(recoveryEv.checkoutId, 'chk_eva_1');
  assert.equal(recoveryEv.orderId, 'ord_recovery_test');

  // Verify Store B checkout was NOT affected (tenant isolation)
  const chkB = sim.store.checkouts.find(c => c.id === 'chk_other_tenant');
  assert.equal(chkB.recoveryStatus, 'pending', 'Other tenant checkout must remain pending');
});

test('Shopify Order Ingestion: Idempotency protects against duplicate events and updates financial status', () => {
  const sim = createWebhookSimulator();
  const payload1 = {
    id: 'ord_idempotent_1',
    total_price: '150.00',
    financial_status: 'pending',
    customer: { email: 'charlotte@example.com' }
  };
  const bodyStr1 = JSON.stringify(payload1);
  const hmac1 = computeShopifyHmac(bodyStr1, sim.ws.shopifyConfig.webhookSecret);

  const res1 = sim.handleOrderWebhook(bodyStr1, { 'x-shopify-hmac-sha256': hmac1 });
  assert.equal(res1.status, 200);
  assert.equal(res1.body.orderId, 'ord_idempotent_1');
  assert.equal(sim.store.orders.length, 1);
  assert.equal(sim.store.orders[0].financialStatus, 'pending');

  // Send duplicate / orders-paid with financial_status: 'paid'
  const payload2 = {
    id: 'ord_idempotent_1',
    total_price: '150.00',
    financial_status: 'paid',
    customer: { email: 'charlotte@example.com' }
  };
  const bodyStr2 = JSON.stringify(payload2);
  const hmac2 = computeShopifyHmac(bodyStr2, sim.ws.shopifyConfig.webhookSecret);

  const res2 = sim.handleOrderWebhook(bodyStr2, { 'x-shopify-hmac-sha256': hmac2 });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.duplicate, true, 'Should be flagged as duplicate order');
  assert.equal(sim.store.orders.length, 1, 'Should NOT insert duplicate order record');
  assert.equal(sim.store.orders[0].financialStatus, 'paid', 'Should update financialStatus to paid');
});
