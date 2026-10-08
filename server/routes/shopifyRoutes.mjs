/**
 * server/routes/shopifyRoutes.mjs
 *
 * Modular Route Controller for Shopify Integration:
 * 1. Merchant Workspace Admin: connect, disconnect, signals, webhooks registration, product catalogs, customer sync, order sync, discount rules.
 * 2. Real-Time Webhook Engine: orders-create/paid, checkouts-create/update, fulfillments, orders-cancelled, refunds, product & inventory updates, customer profile updates.
 */

import { generateAmbassadorReferralCode } from '../reviewEngine.mjs';
import { reviewUrlFor } from '../reviewTokens.mjs';
import { merchantReviewCode } from '../seededOffers.mjs';

/**
 * Creates or updates a discount rule in Jourvance and provisions the price rule + discount code in Shopify via Admin API.
 */
export async function provisionShopifyDiscount(ws, { code, discountType = 'percentage', value, usageLimit = null, isUniquePerLead = false, oncePerCustomer = true }, ctx) {
  const cleanCode = String(code || '').trim().toUpperCase();
  // The amount is the caller's; none means no code, never one at a value nobody set (R24).
  if (!cleanCode || !(Number(value) > 0)) return null;

  const { realStoreDomain, adminToken, loadDiscounts, saveDiscounts } = ctx;
  const domain = ws ? realStoreDomain(ws.shopifyConfig) : '';
  const token = ws ? adminToken(ws.shopifyConfig) : '';
  let shopifyPriceRuleId = null;
  let syncedToLiveShopify = false;

  if (domain && token) {
    try {
      const priceRuleBody = {
        price_rule: {
          title: cleanCode,
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: discountType === 'percentage' ? 'percentage' : 'fixed_amount',
          value: discountType === 'percentage' ? `-${Math.abs(Number(value))}` : `-${Math.abs(Number(value)).toFixed(2)}`,
          customer_selection: 'all',
          starts_at: new Date().toISOString(),
          usage_limit: isUniquePerLead ? 1 : (usageLimit ? Number(usageLimit) : null),
          once_per_customer: Boolean(oncePerCustomer)
        }
      };

      const prResp = await fetch(`https://${domain}/admin/api/2024-01/price_rules.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(priceRuleBody)
      });
      const prData = await prResp.json();
      if (prData.price_rule?.id) {
        shopifyPriceRuleId = String(prData.price_rule.id);
        const dcResp = await fetch(`https://${domain}/admin/api/2024-01/price_rules/${shopifyPriceRuleId}/discount_codes.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ discount_code: { code: cleanCode } })
        });
        const dcData = await dcResp.json();
        if (dcData.discount_code?.id) {
          syncedToLiveShopify = true;
        }
      }
    } catch (apiErr) {
      console.warn('[Jourvance] Live Shopify discount provisioning warning:', apiErr.message);
    }
  }

  const discounts = loadDiscounts();
  // A rule records its store, so a public page offers a code only where it was defined (R24). A rule
  // saved before rules recorded their store is still matched by code.
  const existingIdx = discounts.findIndex((d) => {
    if (d.code !== cleanCode) return false;
    if (ws?.userId && d.userId && d.userId !== ws.userId) return false;
    return !d.storeDomain || !domain || d.storeDomain === domain;
  });
  const discountRule = {
    id: existingIdx >= 0 ? discounts[existingIdx].id : `disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    code: cleanCode,
    userId: ws?.userId || (existingIdx >= 0 ? discounts[existingIdx].userId : '') || '',
    storeDomain: domain || (existingIdx >= 0 ? discounts[existingIdx].storeDomain : undefined) || null,
    discountType: discountType === 'fixed_amount' ? 'fixed_amount' : 'percentage',
    value: Number(value),
    usageLimit: isUniquePerLead ? 1 : (usageLimit ? Number(usageLimit) : null),
    oncePerCustomer: Boolean(oncePerCustomer),
    shopifyPriceRuleId: shopifyPriceRuleId || (existingIdx >= 0 ? discounts[existingIdx].shopifyPriceRuleId : null),
    createdAt: existingIdx >= 0 ? discounts[existingIdx].createdAt : new Date().toISOString(),
    status: 'active',
    syncedToLiveShopify: syncedToLiveShopify || (existingIdx >= 0 && discounts[existingIdx].syncedToLiveShopify)
  };

  if (existingIdx >= 0) {
    discounts[existingIdx] = { ...discounts[existingIdx], ...discountRule };
  } else {
    discounts.unshift(discountRule);
  }
  saveDiscounts(discounts);
  return discountRule;
}

// This created WELCOMEBACK15, SAVE10, SANCTUARY, REVIEW10 and GIVE15 in the merchant's live store
// at amounts nobody chose whenever the client settings were saved (R24). A code is made only when
// the merchant defines one (create-discount), and a code already in a store is never touched, so
// this creates nothing. Kept so its callers still answer with an empty list.
export async function ensureShopifyCoreDiscounts(_ws, _allowUnlimited = false, _ctx) {
  return [];
}

function trackingLineFrom(payload) {
  const number = payload?.tracking_number || (Array.isArray(payload?.tracking_numbers) ? payload.tracking_numbers[0] : '');
  const url = payload?.tracking_url || (Array.isArray(payload?.tracking_urls) ? payload.tracking_urls[0] : '');
  const parts = [number ? `Tracking number: ${number}` : '', url ? String(url) : ''].filter(Boolean);
  return parts.length ? parts.join('\n') : 'Tracking was not included on this fulfillment.';
}

/**
 * Mounts all Shopify workspace management and webhook ingestion routes.
 */
export function setupShopifyRoutes(app, ctx) {
  const {
    requireUser,
    loadWorkspace,
    saveWorkspace,
    presentWorkspace,
    workspaceCache,
    cleanDomain,
    realStoreDomain,
    adminToken,
    FAKE_STORE_DOMAINS,
    WEBHOOK_TOPICS,
    signalTopicView,
    newPixelKey,
    configuredPublicBase,
    publicBase,
    behaviorSummary,
    pixelSnippet,
    restockSnippet,
    rememberAdminCatalog,
    mapShopifyProducts,
    loadCatalog,
    saveCatalog,
    applyProductUpdate,
    applyInventoryLevel,
    loadContacts,
    saveContacts,
    contactOwnerId,
    loadOrders,
    saveOrders,
    loadCheckouts,
    saveCheckouts,
    loadDrips,
    saveDrips,
    loadEvents,
    syncContactRfmTags,
    cleanRfmConfig,
    DEFAULT_RFM_CONFIG,
    userProgramBag,
    loadDiscounts,
    saveDiscounts,
    acceptShopifyWebhook,
    recordWebhookDelivery,
    getWebhookHealth,
    summarizeWebhookPayload,
    simulateTestPing,
    noteAttrMap,
    pageOwnedBy,
    publicPageCache,
    reloadPublicPageCache,
    recordEvent,
    attachBehavior,
    assignEmailTouch,
    channelOf,
    sendTransactional,
    orderMailVars,
    enrollAutomation,
    enrollFlowsForTrigger,
    enrollClaimedBehavior,
    refreshPredictions,
    noteSegmentChanges,
    handoffMapNodes,
    klaviyoIsSender,
    loadJourney,
    fulfillmentKind,
    addRefund,
    touchRevenue,
    enrollPriceDrops,
    enrollInventorySignals,
    marketingSubscribed
  } = ctx;

  // ── 1. Connect Shopify Store to Workspace ──────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/connect', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const rawDomain = req.body?.storeDomain;
    const domain = cleanDomain(rawDomain);
    if (!domain || FAKE_STORE_DOMAINS.has(domain)) {
      return res.status(400).json({ success: false, error: 'Use that store’s own .myshopify.com domain.' });
    }

    const incomingToken = String(req.body?.adminAccessToken || req.body?.storefrontAccessToken || '').trim();
    const incomingSecret = String(req.body?.webhookSecret || '').trim();
    const sameStore = realStoreDomain(ws.shopifyConfig) === domain;
    const token = incomingToken || (sameStore ? adminToken(ws.shopifyConfig) : '');
    const webhookSecret = incomingSecret || (sameStore ? String(ws.shopifyConfig?.webhookSecret || '').trim() : '');
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Paste the Admin API access token from this Shopify store. Jourvance cannot read its products, orders, or customers without that store’s own token.'
      });
    }

    let shop;
    let scopes = [];
    try {
      const shopResp = await fetch(`https://${domain}/admin/api/2024-10/shop.json`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!shopResp.ok) {
        return res.status(400).json({
          success: false,
          error: 'Shopify refused this token for that store. In the store admin, open Settings → Apps and sales channels → Develop apps, install the app, and paste its Admin API access token.'
        });
      }
      shop = await shopResp.json();
      const scopeResp = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (scopeResp.ok) {
        const scopeData = await scopeResp.json();
        scopes = (scopeData.access_scopes || []).map(s => s.handle).filter(Boolean);
      }
    } catch (err) {
      return res.status(502).json({ success: false, error: 'Shopify did not answer. Check the store domain and try again.' });
    }

    const needed = ['read_products', 'read_orders', 'read_customers', 'write_price_rules'];
    const missingScopes = needed.filter(scope => !scopes.includes(scope));
    const updatedConfig = {
      storeDomain: domain,
      adminAccessToken: token,
      storefrontAccessToken: token,
      shopName: shop?.shop?.name || '',
      currency: shop?.shop?.currency || req.body?.currency || 'USD',
      adminScopes: scopes,
      missingScopes,
      webhookSecret,
      connectedAt: new Date().toISOString(),
      status: 'connected',
      ...(sameStore && ws.shopifyConfig?.pixelKey ? { pixelKey: ws.shopifyConfig.pixelKey } : {}),
      ...(sameStore && ws.shopifyConfig?.webhooks ? { webhooks: ws.shopifyConfig.webhooks } : {})
    };

    const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: updatedConfig });
    const scopeNote = missingScopes.length
      ? ` This store has not granted: ${missingScopes.join(', ')}.`
      : '';
    const webhookNote = webhookSecret
      ? ' Order and checkout webhooks are accepted only when Shopify’s signature matches this app API secret.'
      : ' Order and checkout webhooks stay off until you paste the app API secret from the same custom app.';
    res.json({
      success: true,
      workspace: presentWorkspace(updatedWs),
      shopName: updatedConfig.shopName,
      missingScopes,
      notice: `Shopify accepted the token for ${updatedConfig.shopName || domain}.${scopeNote}${webhookNote}`
    });
  });

  // ── 2. Disconnect Shopify Store ───────────────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/disconnect', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, {
      shopifyConfig: { storeDomain: '', status: 'disconnected' }
    });
    res.json({ success: true, workspace: presentWorkspace(updatedWs) });
  });

  // ── 3. Signals & Pixel Integration ────────────────────────────────────────
  app.get('/api/workspace/:wsId/shopify/signals', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
    const domain = realStoreDomain(ws.shopifyConfig);
    const connected = ws.shopifyConfig?.status === 'connected' && Boolean(domain);
    let pixelKey = String(ws.shopifyConfig?.pixelKey || '');
    if (connected && !pixelKey) {
      pixelKey = newPixelKey();
      await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: { ...ws.shopifyConfig, pixelKey } });
    }
    const base = configuredPublicBase(process.env.PUBLIC_BASE_URL) || publicBase();
    const summary = behaviorSummary(req.user.uid);
    const topics = signalTopicView(ws);
    res.json({
      success: true,
      connected,
      ...topics,
      lastEventAt: summary.lastEventAt,
      todayCount: summary.todayCount,
      pixelSnippet: connected && pixelKey ? pixelSnippet({ endpoint: `${base}/api/public/shopify-pixel`, shop: domain, key: pixelKey }) : '',
      restockSnippet: connected && pixelKey ? restockSnippet({ endpoint: `${base}/api/public/restock-request`, shop: domain, key: pixelKey }) : '',
      notice: topics.publicUrl ? '' : 'These webhooks are not registered. Shopify cannot reach this app until PUBLIC_BASE_URL is a public https address.',
      webhookHealth: typeof getWebhookHealth === 'function' ? getWebhookHealth(ws.id, ws.shopifyConfig) : undefined
    });
  });

  // ── 3.1 Webhook Health & Live Delivery Diagnostic Log ─────────────────────
  app.get('/api/workspace/:wsId/shopify/webhook-health', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
    const health = typeof getWebhookHealth === 'function'
      ? getWebhookHealth(ws.id, ws.shopifyConfig)
      : { status: 'idle', message: 'Ready', metrics: { total24h: 0, valid24h: 0, failed24h: 0, successRate: 100 }, recentDeliveries: [] };
    res.json({ success: true, ...health });
  });

  // ── 3.2 Webhook Test Ping Simulation ──────────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/webhook-test-ping', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
    const topic = String(req.body?.topic || 'orders/create').trim();
    if (typeof simulateTestPing !== 'function') {
      return res.status(500).json({ success: false, error: 'Test ping simulator is not configured.' });
    }
    const result = simulateTestPing({ wsId: ws.id, shopifyConfig: ws.shopifyConfig, topic });
    res.json(result);
  });

  // ── 4. Webhook Registration API ───────────────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/webhooks', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
    const base = configuredPublicBase(process.env.PUBLIC_BASE_URL);
    if (!base) {
      return res.json({
        success: true,
        registered: false,
        ...signalTopicView(ws),
        notice: 'No public https address is set, so nothing was registered.'
      });
    }
    const domain = realStoreDomain(ws.shopifyConfig);
    const token = adminToken(ws.shopifyConfig);
    if (!domain || !token || ws.shopifyConfig?.status !== 'connected') {
      return res.status(400).json({ success: false, error: 'Connect the store before registering webhooks.' });
    }
    const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
    let existing = [];
    try {
      const listed = await fetch(`https://${domain}/admin/api/2024-10/webhooks.json`, { headers, signal: AbortSignal.timeout(8000) });
      const data = await listed.json().catch(() => ({}));
      if (!listed.ok) return res.status(502).json({ success: false, error: 'Shopify did not return the current webhook list.', status: listed.status });
      existing = Array.isArray(data.webhooks) ? data.webhooks : [];
    } catch {
      return res.status(502).json({ success: false, error: 'Shopify did not answer.' });
    }
    const webhooks = {};
    for (const topic of WEBHOOK_TOPICS) {
      const address = `${base}${topic.path}`;
      const found = existing.find((hook) => hook.topic === topic.topic && hook.address === address);
      if (found?.id) {
        webhooks[topic.topic] = { registered: true, status: 200, detail: 'Shopify already has this subscription.' };
        continue;
      }
      try {
        const created = await fetch(`https://${domain}/admin/api/2024-10/webhooks.json`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ webhook: { topic: topic.topic, address, format: 'json' } }),
          signal: AbortSignal.timeout(8000)
        });
        const data = await created.json().catch(() => ({}));
        if (created.ok && data.webhook?.id) webhooks[topic.topic] = { registered: true, status: created.status, detail: 'Shopify created this subscription.' };
        else webhooks[topic.topic] = { registered: false, status: created.status, detail: (data.errors ? JSON.stringify(data.errors) : `Shopify responded ${created.status}.`).slice(0, 180) };
      } catch {
        webhooks[topic.topic] = { registered: false, status: 0, detail: 'Shopify did not answer.' };
      }
    }
    await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: { ...ws.shopifyConfig, webhooks } });
    const fresh = await loadWorkspace(req.user.uid, req.params.wsId);
    res.json({
      success: true,
      registered: Object.values(webhooks).every((row) => row.registered),
      ...signalTopicView(fresh)
    });
  });

  // ── 5. Product Catalog Proxy ──────────────────────────────────────────────
  app.get('/api/workspace/:wsId/shopify/products', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    const domain = realStoreDomain(ws?.shopifyConfig);
    const token = adminToken(ws?.shopifyConfig);

    if (domain && token) {
      try {
        const resp = await fetch(`https://${domain}/admin/api/2024-10/products.json?limit=50`, {
          headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (resp.ok) {
          const data = await resp.json();
          rememberAdminCatalog(req.user.uid, domain, data?.products);
          const products = mapShopifyProducts(data?.products);
          if (products.length) {
            return res.json({ success: true, products, source: 'shopify-admin', storeDomain: domain });
          }
        }
      } catch (err) {
        console.warn(`[Jourvance] Admin product fetch failed for ${domain}:`, err.message);
      }
    }

    if (domain) {
      try {
        const resp = await fetch(`https://${domain}/products.json?limit=50`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        });
        if (resp.ok) {
          const data = await resp.json();
          const products = mapShopifyProducts(data?.products);
          if (products.length) {
            return res.json({ success: true, products, source: 'public-catalog', storeDomain: domain });
          }
        }
      } catch (err) {
        console.warn(`[Jourvance] Public product fetch failed for ${domain}:`, err.message);
      }
    }

    res.json({
      success: true,
      products: [],
      source: 'none',
      storeDomain: domain || '',
      notice: domain
        ? 'The store did not return a product list. Nothing is shown in its place.'
        : 'Connect a Shopify store to load products.'
    });
  });

  // ── 6. Sync Customers from Shopify Store ──────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/sync-customers', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const domain = realStoreDomain(ws.shopifyConfig);
    let contacts = loadContacts();
    let importedCount = 0;
    let storeReached = false;

    if (domain && adminToken(ws.shopifyConfig)) {
      try {
        const resp = await fetch(`https://${domain}/admin/api/2024-01/customers.json?limit=250`, {
          headers: {
            'X-Shopify-Access-Token': adminToken(ws.shopifyConfig),
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data?.customers)) {
            storeReached = true;
            for (const c of data.customers) {
              const email = (c.email || '').toLowerCase().trim();
              if (!email) continue;
              const existing = contacts.find((row) => row.email === email && contactOwnerId(row) === req.user.uid);
              const totalSpent = Number(c.total_spent || 0);
              const ordersCount = Number(c.orders_count || 0);
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || email.split('@')[0];

              if (existing) {
                existing.totalSpent = totalSpent;
                existing.ordersCount = ordersCount;
                existing.name = name || existing.name;
                existing.shopifyCustomerId = String(c.id);
                existing.userId = req.user.uid;
                if (!existing.tags) existing.tags = [];
                if (!existing.tags.includes('Shopify Buyer') && ordersCount > 0) existing.tags.push('Shopify Buyer');
                syncContactRfmTags(existing, userProgramBag(req.user.uid)?.rfmConfig || DEFAULT_RFM_CONFIG);
              } else {
                const newContact = {
                  id: `cust_${req.user.uid}_${c.id}`,
                  userId: req.user.uid,
                  shopifyCustomerId: String(c.id),
                  email,
                  name,
                  phone: c.phone || '',
                  totalSpent,
                  ordersCount,
                  acceptsMarketing: c.email_marketing_consent?.state === 'subscribed',
                  tags: ordersCount > 0 ? ['Shopify Buyer'] : [],
                  source: `Shopify Store (${domain})`,
                  firstSeenAt: c.created_at || new Date().toISOString(),
                  lastOrderAt: c.last_order_name ? new Date().toISOString() : undefined
                };
                syncContactRfmTags(newContact, userProgramBag(req.user.uid)?.rfmConfig || DEFAULT_RFM_CONFIG);
                contacts.push(newContact);
                importedCount++;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[Jourvance] Live customer fetch failed for ${domain}:`, err.message);
      }
    }

    const mine = contacts.filter((row) => contactOwnerId(row) === req.user.uid).length;
    if (storeReached) {
      saveContacts(contacts);
      await saveWorkspace(req.user.uid, req.params.wsId, {
        shopifyConfig: {
          ...(ws.shopifyConfig || {}),
          customerCount: mine,
          lastSyncedAt: new Date().toISOString()
        }
      });
    }

    res.json({
      success: storeReached,
      storeReached,
      importedCount,
      syncedCount: importedCount,
      totalCustomers: mine,
      totalInCrm: mine,
      notice: storeReached
        ? `Imported ${importedCount} customers from Shopify.`
        : 'Shopify was not reached. No customers were imported.'
    });
  });

  // ── 7. Sync Orders from Shopify Store ─────────────────────────────────────
  app.post('/api/workspace/:wsId/shopify/sync-orders', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const domain = realStoreDomain(ws.shopifyConfig);
    const token = adminToken(ws.shopifyConfig);
    const orders = loadOrders();
    let imported = 0;
    let storeReached = false;
    if (domain && token) {
      try {
        const resp = await fetch(`https://${domain}/admin/api/2024-01/orders.json?status=any&limit=50`, {
          headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        });
        if (resp.ok) {
          storeReached = true;
          const data = await resp.json();
          for (const o of data.orders || []) {
            const id = String(o.id);
            if (orders.some(existing => String(existing.id) === id)) continue;
            orders.unshift({
              id,
              orderNumber: o.order_number ? `#${o.order_number}` : `#${id.slice(-4)}`,
              customerEmail: (o.email || o.customer?.email || '').toLowerCase(),
              customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' '),
              totalPrice: Number(o.total_price || 0),
              currency: o.currency || 'USD',
              discountCode: o.discount_codes?.[0]?.code || '',
              orderBumpIncluded: false,
              createdAt: o.created_at || new Date().toISOString(),
              source: 'shopify-sync',
              userId: req.user.uid
            });
            imported++;
          }
          if (imported) {
            saveOrders(orders);
            try { await refreshPredictions(req.user.uid); } catch (err) {
              console.warn('[Jourvance] Prediction refresh failed:', err.message);
            }
          }
        }
      } catch (err) {
        console.warn(`[Jourvance] Live order fetch failed for ${domain}:`, err.message);
      }
    }
    if (storeReached) {
      await saveWorkspace(req.user.uid, req.params.wsId, {
        shopifyConfig: {
          ...(ws.shopifyConfig || {}),
          ordersCount: orders.length,
          lastSyncedAt: new Date().toISOString()
        }
      });
    }

    res.json({
      success: storeReached,
      storeReached,
      imported,
      ordersCount: imported,
      totalOrders: orders.length,
      notice: storeReached
        ? `Imported ${imported} new orders from Shopify.`
        : 'Shopify was not reached. No orders were imported.'
    });
  });

  // ── 8. Discounts Management ───────────────────────────────────────────────
  app.get('/api/workspace/:wsId/shopify/discounts', requireUser, async (req, res) => {
    const discounts = loadDiscounts().filter((row) => row.userId === req.user.uid);
    res.json({ success: true, discounts });
  });

  app.get('/api/discounts/core-status', requireUser, (req, res) => {
    const discounts = loadDiscounts();
    const findCode = (code) => discounts.find(d => d.code === code) || null;
    res.json({
      success: true,
      welcomeback15: findCode('WELCOMEBACK15'),
      save10: findCode('SAVE10'),
      sanctuary: findCode('SANCTUARY')
    });
  });

  app.post('/api/discounts/ensure-core', requireUser, async (req, res) => {
    const bag = userProgramBag(req.user.uid);
    const rfm = cleanRfmConfig(bag.rfmConfig);
    const userWs = Object.values(workspaceCache).find(w => w.userId === req.user.uid && realStoreDomain(w.shopifyConfig));
    const results = await ensureShopifyCoreDiscounts(userWs, rfm.allowUnlimitedDiscountUse, ctx);
    res.json({
      success: true,
      discounts: results,
      syncedToLiveShopify: false,
      notice: 'No codes were created. Create a code with the amount you choose in Shopify Sync.'
    });
  });

  app.post('/api/workspace/:wsId/shopify/create-discount', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const { code, discountType = 'percentage', usageLimit = null, isUniquePerLead = false, oncePerCustomer = true } = req.body || {};
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, error: 'A discount code string is required.' });
    }
    // The amount is the caller's to choose; there is no default, so no code is made at a value nobody set (C18).
    if (discountType !== 'percentage' && discountType !== 'fixed_amount') {
      return res.status(400).json({ success: false, error: 'The discount type must be percentage or fixed_amount.' });
    }
    const value = typeof req.body?.value === 'string' && req.body.value.trim() ? Number(req.body.value) : req.body?.value;
    if (discountType === 'percentage' && !(typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 99)) {
      return res.status(400).json({ success: false, error: 'Enter a percentage from 1 to 99.' });
    }
    if (discountType === 'fixed_amount' && !(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return res.status(400).json({ success: false, error: 'Enter an amount greater than 0.' });
    }

    const cleanCode = code.trim().toUpperCase();
    const discountRule = await provisionShopifyDiscount(ws, {
      code: cleanCode,
      discountType,
      value,
      usageLimit,
      isUniquePerLead,
      oncePerCustomer
    }, ctx);

    res.json({
      success: true,
      discount: discountRule,
      message: discountRule?.syncedToLiveShopify
        ? `Discount code ${cleanCode} is active in Shopify.`
        : `Discount code ${cleanCode} is saved here. Shopify was not updated.`
    });
  });

  // ── 9. Abandoned Checkouts Management ─────────────────────────────────────
  app.get('/api/workspace/:wsId/shopify/abandoned-checkouts', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
    const checkouts = loadCheckouts().filter(c => c.userId === req.user.uid);
    res.json({ success: true, checkouts });
  });

  app.post('/api/workspace/:wsId/shopify/simulate-abandoned-checkout', requireUser, async (req, res) => {
    return res.status(410).json({ success: false, error: 'Checkout simulation is off. Abandoned checkouts show up from the Shopify checkouts webhook.' });
  });

  app.post('/api/workspace/:wsId/shopify/simulate-order', requireUser, async (req, res) => {
    return res.status(410).json({ success: false, error: 'Order simulation is off. Orders show up when Shopify sends a real orders/create webhook.' });
  });

  // ── 10. Webhooks: Orders Create / Paid ─────────────────────────────────────
  app.post(['/api/webhooks/shopify/orders-create', '/api/webhooks/shopify/order-created', '/api/webhooks/shopify/orders-paid'], async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const payload = req.body || {};
    const orderId = String(payload.id || payload.order_id || `ord_${Date.now()}`);
    const totalPrice = Number(payload.total_price || payload.totalPrice || 0);
    const subtotalPrice = Number(payload.subtotal_price || payload.subtotalPrice || totalPrice);
    const currency = payload.currency || 'USD';
    const customer = payload.customer || {};
    const customerEmail = (customer.email || payload.email || payload.customerEmail || '').toLowerCase().trim();
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || payload.name || (customerEmail ? customerEmail.split('@')[0] : 'Customer');
    const discountCodes = Array.isArray(payload.discount_codes)
      ? payload.discount_codes.map(d => (typeof d === 'string' ? d : d.code || '')).filter(Boolean)
      : (payload.discountCode ? [payload.discountCode] : []);
    const lineItems = Array.isArray(payload.line_items) ? payload.line_items : (payload.lineItems || []);

    const orders = loadOrders();
    const existingOrder = orders.find(o => String(o.id) === orderId && o.userId === shopWs.userId);
    if (existingOrder) {
      if (payload.financial_status && existingOrder.financialStatus !== payload.financial_status) {
        existingOrder.financialStatus = payload.financial_status;
        saveOrders(orders);
      }
      return res.status(200).json({ success: true, duplicate: true, message: 'Order already recorded (idempotent)', orderId });
    }

    const attrs = noteAttrMap(payload);
    let attributedSlug = attrs.jv_slug || attrs.slug || attrs.funnel_slug || payload.slug || '';
    let attributedNodeId = attrs.jv_node || payload.attributedNodeId || '';
    let journeyId = attrs.jv_journey || '';
    let visitorId = String(attrs.jv_vid || '').slice(0, 80);
    let attributedAdId = payload.attributedAdId || '';
    let bumpIncluded = Boolean(payload.orderBumpIncluded);
    let variant = attrs.variant || attrs.ab_variant || payload.variant || '';
    if (attrs.bump_accepted === 'true') bumpIncluded = true;
    const orderUtm = {
      utm_source: attrs.utm_source || '',
      utm_medium: attrs.utm_medium || '',
      utm_campaign: attrs.utm_campaign || '',
      utm_content: attrs.utm_content || '',
      fbclid: attrs.fbclid || '',
      gclid: attrs.gclid || '',
      ttclid: attrs.ttclid || ''
    };

    if (visitorId) {
      const prior = loadEvents().filter(e => e.visitorId === visitorId && (e.userId === shopWs.userId || pageOwnedBy(e.slug, shopWs.userId)));
      const earliest = prior[0];
      const latest = prior[prior.length - 1];
      if (!attributedSlug && latest?.slug) attributedSlug = latest.slug;
      if (!attributedNodeId && latest?.nodeId) attributedNodeId = latest.nodeId;
      if (!journeyId && latest?.journeyId) journeyId = latest.journeyId;
      for (const key of Object.keys(orderUtm)) {
        if (!orderUtm[key] && earliest?.[key]) orderUtm[key] = earliest[key];
      }
    }

    // Match discount code against public pages
    if (!attributedSlug && discountCodes.length > 0) {
      const pages = reloadPublicPageCache();
      for (const code of discountCodes) {
        const upperCode = code.toUpperCase();
        for (const [slugKey, p] of Object.entries(pages)) {
          if (p && typeof p === 'object') {
            const d = p.data || {};
            if (p.userId === shopWs.userId && (
                (d.discountCode && d.discountCode.toUpperCase() === upperCode) ||
                (d.exitIntentDiscountCode && d.exitIntentDiscountCode.toUpperCase() === upperCode) ||
                (d.bounceBackDiscountCode && d.bounceBackDiscountCode.toUpperCase() === upperCode) ||
                (d.variantB?.discountCode && d.variantB.discountCode.toUpperCase() === upperCode))) {
              attributedSlug = p.slug || slugKey;
              attributedNodeId = p.nodeId || attributedNodeId;
              break;
            }
          }
        }
        if (attributedSlug) break;
      }
    }

    // Match customer email in contacts.json
    const contacts = loadContacts();
    let contact = contacts.find(c => c.email === customerEmail && contactOwnerId(c) === shopWs.userId);
    if (!attributedSlug && contact && contact.sourceSlug && pageOwnedBy(contact.sourceSlug, shopWs.userId)) {
      attributedSlug = contact.sourceSlug;
    }
    if (attributedSlug && !pageOwnedBy(attributedSlug, shopWs.userId)) {
      attributedSlug = '';
      attributedNodeId = '';
      journeyId = '';
    }

    // Detect bump item in line items
    if (!bumpIncluded) {
      for (const item of lineItems) {
        const title = (item.title || item.name || '').toLowerCase();
        if (title.includes('bump') || title.includes('add-on') || title.includes('addon')) {
          bumpIncluded = true;
        }
      }
    }

    // Update or create customer record in contacts.json
    let claimedOrder = [];
    const refCode = (
      attrs.jv_ref ||
      attrs.ref ||
      attrs.referral_code ||
      discountCodes.find(c => /^GIVE15-/i.test(c)) ||
      (discountCodes.some(c => c.toUpperCase() === 'GIVE15') ? 'GIVE15' : '')
    );
    let referringAmbassador = null;

    if (customerEmail) {
      const linkedOrder = attachBehavior(shopWs.userId, customerEmail, {
        visitorId,
        checkoutToken: String(payload.checkout_token || payload.token || '')
      });
      claimedOrder = linkedOrder.claimed;
      if (contact) {
        contact.ordersCount = (contact.ordersCount || 0) + 1;
        contact.totalSpent = Number(((contact.totalSpent || 0) + totalPrice).toFixed(2));
        contact.lastOrderAt = new Date().toISOString();
        if (!contact.name && customerName) contact.name = customerName;
        if (visitorId && !contact.visitorId) contact.visitorId = visitorId;
        if (linkedOrder.clientId && !contact.clientId) contact.clientId = linkedOrder.clientId;
        if (!contact.userId) contact.userId = shopWs.userId;
        if (!contact.tags) contact.tags = [];
        if (!contact.tags.includes('Shopify Buyer')) contact.tags.push('Shopify Buyer');
        if (bumpIncluded && !contact.tags.includes('Order Bump Taker')) contact.tags.push('Order Bump Taker');
        if (refCode && !contact.tags.includes('Referred-By-VIP')) contact.tags.push('Referred-By-VIP');
        const userRfmConfig = userProgramBag(shopWs.userId)?.rfmConfig || DEFAULT_RFM_CONFIG;
        syncContactRfmTags(contact, userRfmConfig);
      } else {
        contact = {
          id: `cust_${Date.now()}`,
          email: customerEmail,
          name: customerName,
          phone: customer.phone || payload.phone || '',
          totalSpent: totalPrice,
          ordersCount: 1,
          acceptsMarketing: customer.email_marketing_consent?.state === 'subscribed',
          visitorId: visitorId || undefined,
          clientId: linkedOrder.clientId || undefined,
          userId: shopWs.userId,
          tags: ['Shopify Buyer', ...(bumpIncluded ? ['Order Bump Taker'] : []), ...(refCode ? ['Referred-By-VIP'] : [])],
          source: attributedSlug ? `Funnel /p/${attributedSlug}` : 'Shopify Direct',
          firstSeenAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        const userRfmConfig = userProgramBag(shopWs.userId)?.rfmConfig || DEFAULT_RFM_CONFIG;
        syncContactRfmTags(contact, userRfmConfig);
        contacts.push(contact);
      }

      // Credit the Ambassador
      if (refCode) {
        if (refCode.toUpperCase().startsWith('GIVE15-')) {
          referringAmbassador = contacts.find(c => {
            if (!c.email || c.email.toLowerCase() === customerEmail.toLowerCase()) return false;
            const expectedCode = generateAmbassadorReferralCode(c.email);
            return expectedCode.toUpperCase() === refCode.toUpperCase() || c.referralCode === refCode;
          });
        } else if (attrs.ref_email || attrs.ambassador_email) {
          const ambEmail = String(attrs.ref_email || attrs.ambassador_email).toLowerCase().trim();
          referringAmbassador = contacts.find(c => c.email && c.email.toLowerCase() === ambEmail && c.email.toLowerCase() !== customerEmail.toLowerCase());
        }

        if (referringAmbassador) {
          if (!Array.isArray(referringAmbassador.tags)) referringAmbassador.tags = [];
          if (!referringAmbassador.tags.includes('VIP-Ambassador')) referringAmbassador.tags.push('VIP-Ambassador');
          if (!referringAmbassador.tags.includes('Referral-Advocate')) referringAmbassador.tags.push('Referral-Advocate');
          referringAmbassador.referralsCount = (referringAmbassador.referralsCount || 0) + 1;
          referringAmbassador.referralRevenue = Number(((referringAmbassador.referralRevenue || 0) + totalPrice).toFixed(2));
          referringAmbassador.lastReferralAt = new Date().toISOString();

          try {
            recordEvent({
              type: 'referral_converted',
              userId: shopWs.userId,
              ambassadorEmail: referringAmbassador.email,
              buyerEmail: customerEmail,
              orderId,
              amount: totalPrice,
              referralCode: refCode
            });
          } catch (evErr) {
            console.warn('[Jourvance] Warning recording referral event:', evErr.message);
          }
        }
      }
      saveContacts(contacts);

      // Smart Exit on Purchase for Drip Sequences
      try {
        const dripsData = loadDrips();
        let modifiedDrip = false;
        for (const enr of dripsData.enrollments) {
          if (enr.customerEmail === customerEmail && enr.status === 'active' && (!enr.userId || enr.userId === shopWs.userId)) {
            const seq = dripsData.sequences.find(s => s.id === enr.sequenceId);
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
              modifiedDrip = true;
              if (seq) {
                seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
                seq.totalExitedPurchased = (seq.totalExitedPurchased || 0) + 1;
              }
            }
          }
        }
        if (modifiedDrip) {
          saveDrips(dripsData);
        }
      } catch (e) {
        console.warn('[Jourvance] Smart exit on purchase drip error:', e.message);
      }
    }

    const shopifyTagsApplied = ['Jourvance Funnel'];
    if (attributedSlug) shopifyTagsApplied.push(`Funnel: ${attributedSlug}`);
    if (bumpIncluded) shopifyTagsApplied.push('Order-Bump-Accepted');
    if (variant) shopifyTagsApplied.push(`Variant: ${String(variant).toUpperCase()}`);
    if (refCode) shopifyTagsApplied.push(`Referral: ${refCode}`);

    // Closed-Loop Abandoned Checkout Recovery
    let recoveredCheckoutId = null;
    try {
      const checkouts = loadCheckouts();
      let checkoutModified = false;
      for (const chk of checkouts) {
        if (chk.userId === shopWs.userId && chk.recoveryStatus !== 'recovered') {
          const matchesEmail = chk.customerEmail && customerEmail && chk.customerEmail.toLowerCase() === customerEmail.toLowerCase();
          const matchesCartToken = payload.cart_token && chk.token === payload.cart_token;
          const matchesToken = payload.token && chk.token === payload.token;
          const matchesCheckoutToken = payload.checkout_token && chk.token === payload.checkout_token;
          if (matchesEmail || matchesCartToken || matchesToken || matchesCheckoutToken) {
            chk.recoveryStatus = 'recovered';
            chk.recoveredAt = new Date().toISOString();
            chk.recoveredOrderId = orderId;
            recoveredCheckoutId = chk.id;
            checkoutModified = true;
            recordEvent({
              type: 'checkout_recovered',
              userId: shopWs.userId,
              email: customerEmail,
              orderId,
              checkoutId: chk.id,
              value: totalPrice
            });
          }
        }
      }
      if (checkoutModified) {
        saveCheckouts(checkouts);
      }
    } catch (chkErr) {
      console.warn('[Jourvance] Failed to update recovered checkout in orders-create:', chkErr.message);
    }

    // Record Order
    const orderRecord = {
      id: orderId,
      orderNumber: payload.order_number ? `#${payload.order_number}` : `#${orderId.slice(-4)}`,
      totalPrice,
      subtotalPrice,
      currency,
      customerEmail,
      customerName,
      discountCode: discountCodes[0] || '',
      financialStatus: payload.financial_status || 'paid',
      recoveredCheckoutId: recoveredCheckoutId || undefined,
      lineItems: lineItems.map(it => ({
        title: it.title || it.name || 'Product',
        productId: String(it.product_id || it.productId || '').replace(/\D/g, '').slice(0, 40),
        variantId: String(it.variant_id || it.variantId || ''),
        quantity: Number(it.quantity || 1),
        price: Number(it.price || 0)
      })),
      orderBumpIncluded: bumpIncluded,
      attributedSlug: attributedSlug || undefined,
      attributedNodeId: attributedNodeId || undefined,
      attributedAdId: attributedAdId || undefined,
      visitorId: visitorId || undefined,
      journeyId: journeyId || (attributedSlug && publicPageCache[attributedSlug]?.journeyId) || undefined,
      workspaceId: shopWs.id || undefined,
      userId: shopWs.userId,
      ...orderUtm,
      checkoutChannel: channelOf(orderUtm),
      shopifyTagsApplied,
      referralCode: refCode || undefined,
      referredBy: referringAmbassador ? referringAmbassador.email : (refCode || undefined),
      createdAt: Number.isFinite(Date.parse(payload.created_at || payload.createdAt || '')) ? new Date(payload.created_at || payload.createdAt).toISOString() : new Date().toISOString()
    };

    assignEmailTouch(orderRecord, shopWs.userId);
    orders.unshift(orderRecord);
    saveOrders(orders);
    recordEvent({
      type: 'order',
      slug: attributedSlug || '',
      journeyId: orderRecord.journeyId || '',
      nodeId: attributedNodeId || (attributedSlug && publicPageCache[attributedSlug]?.nodeId) || '',
      userId: orderRecord.userId || '',
      visitorId: visitorId || '',
      email: customerEmail,
      amount: totalPrice,
      bump: bumpIncluded,
      ...orderUtm
    });

    if (attributedSlug && publicPageCache[attributedSlug]) {
      const page = publicPageCache[attributedSlug];
      if (page.data) {
        page.data.liveRevenue = Number(((page.data.liveRevenue || 0) + totalPrice).toFixed(2));
        page.data.liveOrders = (page.data.liveOrders || 0) + 1;
        if (bumpIncluded) {
          page.data.liveBumpOrders = (page.data.liveBumpOrders || 0) + 1;
        }
      }
    }

    const orderMail = customerEmail
      ? await sendTransactional(shopWs.userId, 'order_confirmation', {
        to: customerEmail,
        name: customerName,
        dedupeKey: `order_confirmation:${orderId}`,
        vars: orderMailVars(orderRecord),
        visitorId
      })
      : { status: 'no_address' };
    if (customerEmail) {
      enrollAutomation(shopWs.userId, 'post_purchase', {
        email: customerEmail,
        name: customerName,
        visitorId
      }, orderMailVars(orderRecord));
      const handoffContext = {
        reason: 'order',
        dedupe: `order:${orderId}`,
        journeyId: orderRecord.journeyId || '',
        slug: attributedSlug || '',
        orderId,
        value: totalPrice
      };
      await enrollFlowsForTrigger(shopWs.userId, 'order_paid', {
        email: customerEmail,
        name: customerName,
        visitorId,
        phone: ''
      }, orderMailVars(orderRecord), handoffContext);
      await enrollClaimedBehavior(shopWs.userId, { email: customerEmail, name: customerName, visitorId }, claimedOrder);
      try { await refreshPredictions(shopWs.userId); } catch (err) {
        console.warn('[Jourvance] Prediction refresh failed:', err.message);
      }
      await noteSegmentChanges(shopWs.userId);
      await handoffMapNodes(shopWs.userId, 'order_paid', {
        email: customerEmail,
        name: customerName,
        visitorId,
        phone: ''
      }, handoffContext);
    }

    res.status(200).json({
      success: true,
      orderId,
      order: orderRecord,
      recoveredCheckoutId,
      transactional: orderMail,
      attributed: Boolean(attributedSlug || attributedNodeId),
      attributedSlug,
      attributedNodeId,
      attributedToNodeId: attributedNodeId,
      attributedRevenue: totalPrice,
      totalPrice,
      bumpIncluded,
      customer: customerEmail,
      shopifyTagsApplied
    });
  });

  // ── 11. Webhooks: Abandoned Checkouts ──────────────────────────────────────
  app.post(['/api/webhooks/shopify/checkouts-create', '/api/webhooks/shopify/checkouts-update'], async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const payload = req.body || {};
    const attrs = noteAttrMap(payload);
    const token = String(payload.token || payload.id || `tok_${Date.now()}`);
    const customer = payload.customer || {};
    const customerEmail = (payload.email || customer.email || '').toLowerCase().trim();
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || payload.name || (customerEmail ? customerEmail.split('@')[0] : 'Shopper');
    const totalPrice = Number(payload.total_price || payload.subtotal_price || 0);
    const currency = payload.currency || 'USD';
    const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
    const shopDomain = realStoreDomain(shopWs.shopifyConfig);
    const abandonedCheckoutUrl = payload.abandoned_checkout_url || (shopDomain ? `https://${shopDomain}/checkouts/cn/${encodeURIComponent(token)}/recover` : '');
    const checkoutVisitor = String(attrs.jv_vid || '').slice(0, 80);
    const checkoutSlug = pageOwnedBy(attrs.jv_slug, shopWs.userId) ? attrs.jv_slug : '';

    if (!customerEmail || !customerEmail.includes('@')) {
      return res.status(200).json({ success: true, message: 'Checkout logged without email.' });
    }

    const orders = loadOrders();
    const hasBought = orders.some(o => o.userId === shopWs.userId && o.customerEmail === customerEmail && new Date(o.createdAt).getTime() >= new Date(payload.created_at || Date.now() - 300000).getTime());
    if (hasBought) {
      return res.status(200).json({ success: true, message: 'Customer already completed order.' });
    }

    const checkouts = loadCheckouts();
    const existingIdx = checkouts.findIndex(c => c.userId === shopWs.userId && (c.token === token || (c.customerEmail === customerEmail && c.recoveryStatus === 'pending')));

    let checkoutRecord;
    if (existingIdx >= 0) {
      checkouts[existingIdx].totalPrice = totalPrice || checkouts[existingIdx].totalPrice;
      checkouts[existingIdx].lineItems = lineItems.length ? lineItems.map(li => ({
        title: li.title || li.name || '',
        variantTitle: li.variant_title || li.variantTitle || '',
        image: li.image_url || li.featured_image?.url || (typeof li.image === 'string' ? li.image : (li.image?.src || '')),
        variantId: String(li.variant_id || li.variantId || ''),
        quantity: Number(li.quantity || 1),
        price: Number(li.price || 0)
      })) : checkouts[existingIdx].lineItems;
      checkouts[existingIdx].abandonedCheckoutUrl = abandonedCheckoutUrl || checkouts[existingIdx].abandonedCheckoutUrl;
      if (checkoutVisitor && !checkouts[existingIdx].visitorId) checkouts[existingIdx].visitorId = checkoutVisitor;
      if (checkoutSlug && !checkouts[existingIdx].sourceSlug) checkouts[existingIdx].sourceSlug = checkoutSlug;
      checkoutRecord = checkouts[existingIdx];
    } else {
      checkoutRecord = {
        id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        token,
        userId: shopWs.userId,
        visitorId: checkoutVisitor,
        journeyId: attrs.jv_journey || '',
        sourceSlug: checkoutSlug,
        customerEmail,
        customerName,
        totalPrice,
        currency,
        lineItems: lineItems.map(li => ({
          title: li.title || li.name || '',
          variantTitle: li.variant_title || li.variantTitle || '',
          image: li.image_url || li.featured_image?.url || (typeof li.image === 'string' ? li.image : (li.image?.src || '')),
          variantId: String(li.variant_id || li.variantId || ''),
          quantity: Number(li.quantity || 1),
          price: Number(li.price || 0)
        })),
        abandonedCheckoutUrl,
        abandonedAt: new Date().toISOString(),
        recoveryStatus: 'pending'
      };
      checkouts.unshift(checkoutRecord);
    }
    saveCheckouts(checkouts);
    const linkedCheckout = attachBehavior(shopWs.userId, customerEmail, { visitorId: checkoutVisitor, checkoutToken: token });
    if (linkedCheckout.clientId) {
      const contacts = loadContacts();
      const row = contacts.find((item) => item.email === customerEmail && contactOwnerId(item) === shopWs.userId);
      if (row && !row.clientId) {
        row.clientId = linkedCheckout.clientId;
        if (checkoutVisitor && !row.visitorId) row.visitorId = checkoutVisitor;
        saveContacts(contacts);
      }
    }

    try {
      const dripsData = loadDrips();
      const cartSeq = dripsData.sequences.find(s => s.triggerType === 'checkout_abandonment');
      if (cartSeq && !klaviyoIsSender(shopWs.userId)) {
        const alreadyActive = dripsData.enrollments.some(e => e.userId === shopWs.userId && e.customerEmail === customerEmail && e.sequenceId === cartSeq.id && e.status === 'active');
        if (!alreadyActive) {
          dripsData.enrollments.unshift({
            id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sequenceId: cartSeq.id,
            userId: shopWs.userId,
            visitorId: checkoutVisitor,
            customerEmail,
            customerName,
            sourceSlug: checkoutSlug || 'cart_recovery',
            currentStepIndex: 0,
            status: 'active',
            enrolledAt: new Date().toISOString(),
            nextStepDueAt: new Date(Date.now() + 3600000).toISOString(),
            history: []
          });
          cartSeq.activeEnrollments = (cartSeq.activeEnrollments || 0) + 1;
          saveDrips(dripsData);
        }
      }
      let handoffJourney = '';
      if (checkoutSlug && publicPageCache[checkoutSlug]?.userId === shopWs.userId) {
        handoffJourney = publicPageCache[checkoutSlug].journeyId || '';
      }
      if (!handoffJourney && attrs.jv_journey) {
        const journey = await loadJourney(shopWs.userId, attrs.jv_journey);
        if (journey?.userId === shopWs.userId) handoffJourney = journey.id;
      }
      const handoffContext = {
        reason: 'checkout',
        dedupe: `checkout:${token}`,
        journeyId: handoffJourney,
        slug: checkoutSlug,
        checkoutUrl: abandonedCheckoutUrl
      };
      await enrollFlowsForTrigger(shopWs.userId, 'checkout_abandonment', {
        email: customerEmail,
        name: customerName,
        visitorId: checkoutVisitor,
        phone: ''
      }, { first_name: String(customerName || '').trim().split(/\s+/)[0] || 'there' }, handoffContext);
      await enrollClaimedBehavior(shopWs.userId, { email: customerEmail, name: customerName, visitorId: checkoutVisitor }, linkedCheckout.claimed);
      await noteSegmentChanges(shopWs.userId);
      await handoffMapNodes(shopWs.userId, 'checkout_abandonment', {
        email: customerEmail,
        name: customerName,
        visitorId: checkoutVisitor
      }, handoffContext);
    } catch (err) {
      console.warn('[Jourvance] Failed auto-enrolling abandoned checkout in drip:', err.message);
    }

    res.status(200).json({ success: true, message: 'Abandoned checkout captured.', checkout: checkoutRecord });
  });

  // ── 12. Webhooks: Fulfillments ─────────────────────────────────────────────
  app.post(['/api/webhooks/shopify/fulfillments-create', '/api/webhooks/shopify/fulfillments-update'], async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const payload = req.body || {};
    const fulfillmentId = String(payload.id || '');
    const orderId = String(payload.order_id || '');
    const trackingNumber = String(payload.tracking_number || (Array.isArray(payload.tracking_numbers) ? payload.tracking_numbers[0] : '') || '');
    const orders = loadOrders();
    const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
    const email = String(payload.email || payload.destination?.email || order?.customerEmail || '').toLowerCase().trim();
    const name = order?.customerName || '';
    const mail = await sendTransactional(shopWs.userId, 'shipping_confirmation', {
      to: email,
      name,
      dedupeKey: `shipping_confirmation:${fulfillmentId || orderId}:${trackingNumber || 'none'}`,
      vars: orderMailVars(order || { id: orderId, customerName: name, currency: payload.currency }, {
        name,
        trackingLine: trackingLineFrom(payload),
        currency: payload.currency
      }),
      visitorId: order?.visitorId || ''
    });
    const kind = fulfillmentKind(payload);
    let enrolled = 0;
    if (email) {
      recordEvent({ type: kind, userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
      const result = await enrollFlowsForTrigger(shopWs.userId, kind, {
        email,
        name,
        visitorId: order?.visitorId || ''
      }, orderMailVars(order || { id: orderId, customerName: name, currency: payload.currency }, {
        name,
        trackingLine: trackingLineFrom(payload),
        currency: payload.currency
      }), {
        reason: kind,
        dedupe: `${kind}:${fulfillmentId || orderId}`,
        occurrence: `${kind}:${fulfillmentId || orderId}`,
        event: { order_id: orderId, fulfillment_status: String(payload.fulfillment_status || payload.status || '') }
      });
      enrolled = result.added;

      // Post-Purchase Review & Social Proof Drip Enrollment (7-day / 168h delay)
      try {
        const dripsData = loadDrips();
        const reviewSeq = (dripsData.sequences || []).find(s => s.id === 'drip_seq_review_request' || s.triggerType === 'fulfillment_review');
        if (reviewSeq) {
          const alreadyEnrolled = (dripsData.enrollments || []).some(
            e => e.userId === shopWs.userId &&
                 String(e.customerEmail || '').toLowerCase() === email &&
                 (e.sequenceId === reviewSeq.id || e.orderId === orderId) &&
                 (e.status === 'active' || e.status === 'completed' || e.status === 'reviewed_exit')
          );
          if (!alreadyEnrolled) {
            // Signed with this server's own key, never the one written in reviewEngine.mjs (R24).
            const reviewUrl = reviewUrlFor(orderId, email);
            const firstStepDelayHours = reviewSeq.steps?.[0]?.delayHours ?? 168;
            const dueAt = new Date(Date.now() + firstStepDelayHours * 3600000).toISOString();
            dripsData.enrollments.unshift({
              id: `enr_rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              sequenceId: reviewSeq.id,
              userId: shopWs.userId,
              visitorId: order?.visitorId || '',
              customerEmail: email,
              customerName: name,
              orderId,
              reviewUrl,
              currentStepIndex: 0,
              status: 'active',
              enrolledAt: new Date().toISOString(),
              nextStepDueAt: dueAt,
              // The merchant's own code on the review sequence, or none (R24).
              discountCode: merchantReviewCode(dripsData),
              history: []
            });
            reviewSeq.activeEnrollments = (reviewSeq.activeEnrollments || 0) + 1;
            saveDrips(dripsData);
          }
        }
      } catch (revErr) {
        console.warn('[Jourvance] Failed to enroll fulfillment review drip:', revErr.message);
      }
    }
    res.status(200).json({ success: true, transactional: mail, trigger: kind, enrolled });
  });

  // ── 13. Webhooks: Orders Cancelled ─────────────────────────────────────────
  app.post(['/api/webhooks/shopify/orders-cancelled', '/api/webhooks/shopify/orders-canceled'], async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const payload = req.body || {};
    const orderId = String(payload.id || payload.order_id || '');
    const orders = loadOrders();
    const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
    const customer = payload.customer || {};
    const email = String(customer.email || payload.email || order?.customerEmail || '').toLowerCase().trim();
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || order?.customerName || '';
    const mail = await sendTransactional(shopWs.userId, 'order_cancelled', {
      to: email,
      name,
      dedupeKey: orderId ? `order_cancelled:${orderId}` : '',
      vars: orderMailVars(order || {
        id: orderId,
        orderNumber: payload.order_number ? `#${payload.order_number}` : '',
        customerName: name,
        totalPrice: Number(payload.total_price || 0),
        currency: payload.currency || 'USD'
      }),
      visitorId: order?.visitorId || ''
    });
    let enrolled = 0;
    if (email) {
      recordEvent({ type: 'order_cancelled', userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
      const result = await enrollFlowsForTrigger(shopWs.userId, 'order_cancelled', {
        email,
        name,
        visitorId: order?.visitorId || ''
      }, orderMailVars(order || {
        id: orderId,
        orderNumber: payload.order_number ? `#${payload.order_number}` : '',
        customerName: name,
        totalPrice: Number(payload.total_price || 0),
        currency: payload.currency || 'USD'
      }), {
        reason: 'order_cancelled',
        dedupe: orderId ? `order_cancelled:${orderId}` : '',
        occurrence: orderId ? `order_cancelled:${orderId}` : '',
        event: { order_id: orderId }
      });
      enrolled = result.added;
    }
    res.status(200).json({ success: true, transactional: mail, trigger: 'order_cancelled', enrolled });
  });

  // ── 14. Webhooks: Refunds ─────────────────────────────────────────────────
  app.post('/api/webhooks/shopify/refunds-create', async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const payload = req.body || {};
    const refundId = String(payload.id || '');
    const orderId = String(payload.order_id || '');
    const orders = loadOrders();
    const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    const refundAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    if (order) {
      const recorded = addRefund(order, { id: refundId, amount: refundAmount > 0 ? refundAmount : null, at: new Date().toISOString() });
      if (recorded.added) {
        Object.assign(order, recorded.order);
        if (order.emailTouch) {
          const revenue = touchRevenue(order, order.emailTouch);
          if (revenue == null) delete order.emailTouch.revenue;
          else order.emailTouch.revenue = revenue;
        }
        saveOrders(orders);
        try { await refreshPredictions(shopWs.userId); } catch (err) {
          console.warn('[Jourvance] Prediction refresh failed:', err.message);
        }
      }
    }
    const email = String(order?.customerEmail || '').toLowerCase().trim();
    const mail = await sendTransactional(shopWs.userId, 'refund', {
      to: email,
      name: order?.customerName || '',
      dedupeKey: refundId ? `refund:${refundId}` : '',
      vars: orderMailVars(order || { id: orderId }, {
        refundAmount: refundAmount > 0 ? `The amount on the notice is ${refundAmount.toFixed(2)} ${payload.currency || order?.currency || 'USD'}.` : '',
        currency: payload.currency || order?.currency
      }),
      visitorId: order?.visitorId || ''
    });
    let enrolled = 0;
    if (email) {
      recordEvent({ type: 'order_refunded', userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
      const result = await enrollFlowsForTrigger(shopWs.userId, 'order_refunded', {
        email,
        name: order?.customerName || '',
        visitorId: order?.visitorId || ''
      }, orderMailVars(order || { id: orderId }, {
        refundAmount: refundAmount > 0 ? `The amount on the notice is ${refundAmount.toFixed(2)} ${payload.currency || order?.currency || 'USD'}.` : '',
        currency: payload.currency || order?.currency
      }), {
        reason: 'order_refunded',
        dedupe: refundId ? `refund:${refundId}` : '',
        occurrence: refundId ? `order_refunded:${refundId}` : '',
        event: { order_id: orderId, refund_id: refundId }
      });
      enrolled = result.added;
    }
    res.status(200).json({ success: true, transactional: mail, trigger: 'order_refunded', enrolled });
  });

  // ── 15. Webhooks: Products, Inventory, Customers ──────────────────────────
  app.post('/api/webhooks/shopify/products-update', async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const applied = applyProductUpdate(loadCatalog(shopWs.userId), req.body || {}, realStoreDomain(shopWs.shopifyConfig));
    saveCatalog(shopWs.userId, applied.memory);
    const enrolled = await enrollPriceDrops(shopWs.userId, applied.changes);
    res.status(200).json({ success: true, variants: applied.changes.length, enrolled });
  });

  app.post('/api/webhooks/shopify/inventory-levels-update', async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const applied = applyInventoryLevel(loadCatalog(shopWs.userId), req.body || {});
    saveCatalog(shopWs.userId, applied.memory);
    const enrolled = await enrollInventorySignals(shopWs.userId, applied.changes);
    res.status(200).json({ success: true, variants: applied.changes.length, enrolled });
  });

  app.post('/api/webhooks/shopify/customers-update', async (req, res) => {
    const shopWs = acceptShopifyWebhook(req, res);
    if (!shopWs) return;
    const customer = req.body || {};
    const email = String(customer.email || '').trim().toLowerCase();
    const state = marketingSubscribed(customer);
    if (!email || state == null) return res.status(200).json({ success: true, updated: false });
    const contacts = loadContacts();
    const contact = contacts.find((row) => row.email === email && contactOwnerId(row) === shopWs.userId);
    if (!contact) return res.status(200).json({ success: true, updated: false });
    contact.acceptsMarketing = state;
    saveContacts(contacts);
    await noteSegmentChanges(shopWs.userId);
    res.status(200).json({ success: true, updated: true });
  });
}
