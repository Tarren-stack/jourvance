/**
 * server/routes/woocommerceRoutes.mjs
 *
 * Modular Route Controller for WooCommerce & WordPress Integration:
 * 1. Connect WooCommerce Store via standard WooCommerce REST API (v3).
 * 2. Disconnect WooCommerce Store.
 * 3. Fetch Product Catalog for Jourvance Page Editor and Upsell Pickers.
 * 4. Webhook Intake for Order Events and Attribution.
 */

import crypto from 'node:crypto';
import net from 'node:net';

function isPrivateOrReservedHost(host) {
  const h = String(host || '').toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) {
    return true;
  }
  const ipVersion = net.isIP(h);
  if (ipVersion === 4) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return true;
    }
    return false;
  }
  if (ipVersion === 6) {
    if (
      h === '::1' ||
      h === '::' ||
      h.startsWith('fe80:') ||
      h.startsWith('fc') ||
      h.startsWith('fd') ||
      h.startsWith('::ffff:127.') ||
      h.startsWith('::ffff:10.') ||
      h.startsWith('::ffff:192.168.') ||
      h.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    return false;
  }
  // Public domain names must contain at least one dot and valid label characters.
  if (!h.includes('.') || !/^[a-z0-9.-]+$/.test(h) || h.startsWith('.') || h.endsWith('.')) {
    return true;
  }
  return false;
}

export function cleanWooUrl(raw) {
  if (!raw) return '';
  const trimmed = String(raw)
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/^http:\/\//, 'https://');
  if (!trimmed.startsWith('https://') || trimmed.includes('..')) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return '';
  if (isPrivateOrReservedHost(parsed.hostname)) return '';
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (cleanPath.includes('..') || cleanPath.includes('/wp-json')) return '';
  return `https://${parsed.hostname}${cleanPath}`;
}

export function wooHmacOk(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const digest = crypto.createHmac('sha256', String(secret)).update(buf).digest('base64');
  const left = Buffer.from(digest);
  const right = Buffer.from(String(header).trim());
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function wooMetaMap(payload) {
  const out = {};
  const list = Array.isArray(payload?.meta_data) ? payload.meta_data : [];
  for (const item of list) {
    if (item && item.key != null && item.value != null && typeof item.value !== 'object') {
      const k = String(item.key).replace(/^_/, '');
      out[k] = String(item.value);
    }
  }
  return out;
}

export function setupWooCommerceRoutes(app, ctx) {
  const {
    requireUser,
    loadWorkspace,
    saveWorkspace,
    presentWorkspace,
    workspaceCache,
    recordEvent,
    loadEvents = () => [],
    loadOrders = () => [],
    saveOrders = () => {},
    loadContacts = () => [],
    saveContacts = () => {},
    contactOwnerId = (c) => c?.userId || '',
    publicPageCache = {},
    pageOwnedBy = (slug, uid) => Boolean(slug && uid && publicPageCache?.[slug]?.userId === uid),
    reloadPublicPageCache = () => publicPageCache,
    attachBehavior = () => ({ claimed: [] }),
    assignEmailTouch = () => {},
    channelOf = () => 'direct',
    userProgramBag = () => ({}),
    syncContactRfmTags = () => {},
    DEFAULT_RFM_CONFIG = {},
    sendTransactional = async () => ({ status: 'off' }),
    orderMailVars = () => ({}),
    enrollAutomation = () => {},
    enrollFlowsForTrigger = async () => {}
  } = ctx;

  // 1. Connect WooCommerce Store to Workspace
  app.post('/api/workspace/:wsId/woocommerce/connect', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const rawUrl = req.body?.storeUrl;
    const storeUrl = cleanWooUrl(rawUrl);
    if (!storeUrl || !storeUrl.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        error: 'Provide a valid WordPress URL starting with https://'
      });
    }

    const incomingKey = String(req.body?.consumerKey || '').trim();
    const incomingSecret = String(req.body?.consumerSecret || '').trim();
    const sameStore = ws.woocommerceConfig?.storeUrl === storeUrl;
    const consumerKey = incomingKey || (sameStore ? String(ws.woocommerceConfig?.consumerKey || '').trim() : '');
    const consumerSecret = incomingSecret || (sameStore ? String(ws.woocommerceConfig?.consumerSecret || '').trim() : '');

    if (!consumerKey || !consumerSecret) {
      return res.status(400).json({
        success: false,
        error: 'Paste the WooCommerce Consumer Key and Consumer Secret from your WordPress admin (WooCommerce > Settings > Advanced > REST API).'
      });
    }

    // Verify credentials against WooCommerce REST API
    let storeInfo = null;
    let productsSample = [];
    try {
      const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
      const testResp = await fetch(`${storeUrl}/wp-json/wc/v3/system_status`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(9000)
      });

      if (testResp.ok) {
        const statusData = await testResp.json().catch(() => ({}));
        storeInfo = {
          name: statusData?.environment?.site_title || storeUrl.replace(/^https?:\/\//, ''),
          currency: statusData?.settings?.currency || 'USD'
        };
      } else {
        // Fallback test: attempt reading products endpoint with per_page=1
        const prodResp = await fetch(`${storeUrl}/wp-json/wc/v3/products?per_page=1`, {
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(9000)
        });
        if (!prodResp.ok) {
          return res.status(400).json({
            success: false,
            error: 'WooCommerce refused these API credentials. Verify Consumer Key and Consumer Secret permissions are set to Read or Read/Write.'
          });
        }
        const prodData = await prodResp.json().catch(() => []);
        productsSample = Array.isArray(prodData) ? prodData : [];
      }
    } catch (err) {
      return res.status(502).json({
        success: false,
        error: 'WordPress site did not answer or timed out. Check that your site is online and permits REST API requests.'
      });
    }

    const updatedConfig = {
      storeUrl,
      consumerKey,
      consumerSecret,
      status: 'connected',
      storeName: storeInfo?.name || storeUrl.replace(/^https?:\/\//, ''),
      currency: storeInfo?.currency || 'USD',
      connectedAt: ws.woocommerceConfig?.connectedAt || new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    };

    const updatedWs = {
      ...ws,
      woocommerceConfig: updatedConfig,
      storePlatform: 'woocommerce',
      updatedAt: new Date().toISOString()
    };

    await saveWorkspace(updatedWs);

    res.json({
      success: true,
      workspace: presentWorkspace(updatedWs),
      notice: 'WooCommerce store connected successfully.'
    });
  });

  // 2. Disconnect WooCommerce Store
  app.post('/api/workspace/:wsId/woocommerce/disconnect', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const updatedWs = {
      ...ws,
      woocommerceConfig: {
        storeUrl: '',
        status: 'disconnected'
      },
      storePlatform: ws.shopifyConfig?.status === 'connected' ? 'shopify' : 'none',
      updatedAt: new Date().toISOString()
    };

    await saveWorkspace(updatedWs);
    res.json({ success: true, workspace: presentWorkspace(updatedWs) });
  });

  // 3. Fetch Products from WooCommerce
  app.get('/api/workspace/:wsId/woocommerce/products', requireUser, async (req, res) => {
    const ws = await loadWorkspace(req.user.uid, req.params.wsId);
    if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

    const config = ws.woocommerceConfig;
    if (!config || config.status !== 'connected' || !config.storeUrl || !config.consumerKey || !config.consumerSecret) {
      return res.status(400).json({
        success: false,
        products: [],
        error: 'Connect your WooCommerce store to load products.'
      });
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
      const prodResp = await fetch(`${config.storeUrl}/wp-json/wc/v3/products?status=publish&per_page=50`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!prodResp.ok) {
        return res.status(502).json({
          success: false,
          products: [],
          error: 'WooCommerce returned an error fetching products.'
        });
      }

      const rawProducts = await prodResp.json().catch(() => []);
      const products = (Array.isArray(rawProducts) ? rawProducts : []).map(p => {
        const rawPrice = Number(p.price || 0);
        const formattedPrice = rawPrice > 0 ? `$${rawPrice.toFixed(2)}` : '$0.00';
        return {
          id: String(p.id),
          title: p.name || 'Untitled Product',
          handle: p.slug || String(p.id),
          description: (p.short_description || p.description || '').replace(/<[^>]*>/g, '').slice(0, 240),
          price: formattedPrice,
          imageUrl: p.images?.[0]?.src || '',
          images: (p.images || []).map(img => img.src).filter(Boolean),
          variants: (Array.isArray(p.variations) && p.variations.length > 0)
            ? p.variations.map(vid => ({
                id: String(vid),
                title: 'Variant ' + vid,
                price: formattedPrice,
                available: p.stock_status !== 'outofstock'
              }))
            : [{
                id: String(p.id),
                title: 'Default',
                price: formattedPrice,
                available: p.stock_status !== 'outofstock'
              }]
        };
      });

      res.json({
        success: true,
        products,
        source: 'woocommerce',
        storeDomain: config.storeUrl.replace(/^https?:\/\//, '')
      });
    } catch (err) {
      return res.status(502).json({
        success: false,
        products: [],
        error: 'Could not connect to WooCommerce site to fetch catalog.'
      });
    }
  });

  // 4. Webhook Intake for WooCommerce Orders (HMAC-verified + Full Funnel Attribution)
  app.post('/api/webhooks/woocommerce/:wsId', async (req, res) => {
    const wsId = String(req.params.wsId || '').trim();
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }

    const ws = workspaceCache?.[wsId] || Object.values(workspaceCache || {}).find(w => w && w.id === wsId) || null;
    if (!ws || ws.woocommerceConfig?.status !== 'connected') {
      return res.status(404).json({ success: false, error: 'Connected WooCommerce workspace not found.' });
    }

    const secret = String(ws.woocommerceConfig?.webhookSecret || ws.woocommerceConfig?.consumerSecret || '').trim();
    const signature = (typeof req.get === 'function' ? req.get('x-wc-webhook-signature') : req.headers?.['x-wc-webhook-signature']) || '';
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(body));
    if (!wooHmacOk(rawBody, signature, secret)) {
      return res.status(401).json({
        success: false,
        error: 'WooCommerce webhook signature did not match this store secret.'
      });
    }

    const orderId = String(body.id || body.number || `woo_${Date.now()}`);
    const totalPrice = Number(body.total || body.total_price || 0);
    const subtotalPrice = Number(body.subtotal || totalPrice);
    const currency = String(body.currency || ws.woocommerceConfig?.currency || 'USD');
    const billing = body.billing || {};
    const shipping = body.shipping || {};
    const customerEmail = String(billing.email || shipping.email || body.email || '').toLowerCase().trim();
    const customerName = [billing.first_name || shipping.first_name, billing.last_name || shipping.last_name].filter(Boolean).join(' ')
      || (customerEmail ? customerEmail.split('@')[0] : 'Customer');
    const discountCodes = Array.isArray(body.coupon_lines)
      ? body.coupon_lines.map(c => (typeof c === 'string' ? c : c?.code || '')).filter(Boolean)
      : [];
    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];

    const orders = loadOrders();
    const existingOrder = orders.find(o => String(o.id) === orderId && o.userId === ws.userId);
    if (existingOrder) {
      if (body.status && existingOrder.financialStatus !== body.status) {
        existingOrder.financialStatus = String(body.status);
        saveOrders(orders);
      }
      return res.status(200).json({ success: true, received: true, duplicate: true, orderId });
    }

    const attrs = wooMetaMap(body);
    let attributedSlug = attrs.jv_slug || attrs.slug || attrs.funnel_slug || body.slug || '';
    let attributedNodeId = attrs.jv_node || body.attributedNodeId || '';
    let journeyId = attrs.jv_journey || '';
    const visitorId = String(attrs.jv_vid || '').slice(0, 80);
    let bumpIncluded = Boolean(body.orderBumpIncluded || attrs.bump_accepted === 'true');
    const orderUtm = {
      utm_source: attrs.utm_source || attrs.wc_order_attribution_utm_source || '',
      utm_medium: attrs.utm_medium || attrs.wc_order_attribution_utm_medium || '',
      utm_campaign: attrs.utm_campaign || attrs.wc_order_attribution_utm_campaign || '',
      utm_content: attrs.utm_content || attrs.wc_order_attribution_utm_content || '',
      fbclid: attrs.fbclid || '',
      gclid: attrs.gclid || '',
      ttclid: attrs.ttclid || ''
    };

    if (visitorId) {
      const prior = loadEvents().filter(e => e.visitorId === visitorId && (e.userId === ws.userId || pageOwnedBy(e.slug, ws.userId)));
      const earliest = prior[0];
      const latest = prior[prior.length - 1];
      if (!attributedSlug && latest?.slug) attributedSlug = latest.slug;
      if (!attributedNodeId && latest?.nodeId) attributedNodeId = latest.nodeId;
      if (!journeyId && latest?.journeyId) journeyId = latest.journeyId;
      for (const key of Object.keys(orderUtm)) {
        if (!orderUtm[key] && earliest?.[key]) orderUtm[key] = earliest[key];
      }
    }

    if (!attributedSlug && discountCodes.length > 0) {
      const pages = reloadPublicPageCache() || publicPageCache || {};
      for (const code of discountCodes) {
        const upperCode = String(code).toUpperCase();
        for (const [slugKey, p] of Object.entries(pages)) {
          if (p && typeof p === 'object' && p.userId === ws.userId) {
            const d = p.data || {};
            if (
              (d.discountCode && d.discountCode.toUpperCase() === upperCode) ||
              (d.exitIntentDiscountCode && d.exitIntentDiscountCode.toUpperCase() === upperCode) ||
              (d.bounceBackDiscountCode && d.bounceBackDiscountCode.toUpperCase() === upperCode) ||
              (d.variantB?.discountCode && d.variantB.discountCode.toUpperCase() === upperCode)
            ) {
              attributedSlug = p.slug || slugKey;
              attributedNodeId = p.nodeId || attributedNodeId;
              break;
            }
          }
        }
        if (attributedSlug) break;
      }
    }

    const contacts = loadContacts();
    let contact = customerEmail ? contacts.find(c => c.email === customerEmail && contactOwnerId(c) === ws.userId) : null;
    if (!attributedSlug && contact && contact.sourceSlug && pageOwnedBy(contact.sourceSlug, ws.userId)) {
      attributedSlug = contact.sourceSlug;
    }
    if (attributedSlug && !pageOwnedBy(attributedSlug, ws.userId)) {
      attributedSlug = '';
      attributedNodeId = '';
      journeyId = '';
    }

    if (!bumpIncluded) {
      for (const item of lineItems) {
        const title = String(item.name || item.title || '').toLowerCase();
        if (title.includes('bump') || title.includes('add-on') || title.includes('addon')) {
          bumpIncluded = true;
        }
      }
    }

    if (customerEmail) {
      const linkedOrder = attachBehavior(ws.userId, customerEmail, { visitorId });
      if (contact) {
        contact.ordersCount = (contact.ordersCount || 0) + 1;
        contact.totalSpent = Number(((contact.totalSpent || 0) + totalPrice).toFixed(2));
        contact.lastOrderAt = new Date().toISOString();
        if (!contact.name && customerName) contact.name = customerName;
        if (visitorId && !contact.visitorId) contact.visitorId = visitorId;
        if (linkedOrder?.clientId && !contact.clientId) contact.clientId = linkedOrder.clientId;
        if (!contact.userId) contact.userId = ws.userId;
        if (!Array.isArray(contact.tags)) contact.tags = [];
        if (!contact.tags.includes('WooCommerce Buyer')) contact.tags.push('WooCommerce Buyer');
        if (bumpIncluded && !contact.tags.includes('Order Bump Taker')) contact.tags.push('Order Bump Taker');
        const userRfmConfig = userProgramBag(ws.userId)?.rfmConfig || DEFAULT_RFM_CONFIG;
        syncContactRfmTags(contact, userRfmConfig);
      } else {
        contact = {
          id: `cust_${Date.now()}`,
          email: customerEmail,
          name: customerName,
          phone: billing.phone || shipping.phone || '',
          totalSpent: totalPrice,
          ordersCount: 1,
          acceptsMarketing: false,
          visitorId: visitorId || undefined,
          clientId: linkedOrder?.clientId || undefined,
          userId: ws.userId,
          tags: ['WooCommerce Buyer', ...(bumpIncluded ? ['Order Bump Taker'] : [])],
          source: attributedSlug ? `Funnel /p/${attributedSlug}` : 'WooCommerce Direct',
          firstSeenAt: new Date().toISOString(),
          lastOrderAt: new Date().toISOString()
        };
        const userRfmConfig = userProgramBag(ws.userId)?.rfmConfig || DEFAULT_RFM_CONFIG;
        syncContactRfmTags(contact, userRfmConfig);
        contacts.push(contact);
      }
      saveContacts(contacts);
    }

    const orderRecord = {
      id: orderId,
      orderNumber: body.number ? `#${body.number}` : `#${orderId.slice(-4)}`,
      totalPrice,
      subtotalPrice,
      currency,
      customerEmail,
      customerName,
      discountCode: discountCodes[0] || '',
      financialStatus: String(body.status || 'paid'),
      platform: 'woocommerce',
      lineItems: lineItems.map(it => ({
        title: it.name || it.title || 'Product',
        productId: String(it.product_id || '').replace(/\D/g, '').slice(0, 40),
        variantId: String(it.variation_id || it.product_id || ''),
        quantity: Number(it.quantity || 1),
        price: Number(it.price || it.total || 0)
      })),
      orderBumpIncluded: bumpIncluded,
      attributedSlug: attributedSlug || undefined,
      attributedNodeId: attributedNodeId || undefined,
      visitorId: visitorId || undefined,
      journeyId: journeyId || (attributedSlug && publicPageCache[attributedSlug]?.journeyId) || undefined,
      workspaceId: ws.id,
      userId: ws.userId,
      ...orderUtm,
      checkoutChannel: channelOf(orderUtm),
      createdAt: Number.isFinite(Date.parse(body.date_created_gmt || body.date_created || ''))
        ? new Date(body.date_created_gmt || body.date_created).toISOString()
        : new Date().toISOString()
    };

    assignEmailTouch(orderRecord, ws.userId);
    orders.unshift(orderRecord);
    saveOrders(orders);

    if (typeof recordEvent === 'function') {
      recordEvent({
        type: 'order',
        slug: attributedSlug || '',
        journeyId: orderRecord.journeyId || '',
        nodeId: attributedNodeId || (attributedSlug && publicPageCache[attributedSlug]?.nodeId) || '',
        userId: ws.userId,
        visitorId: visitorId || '',
        email: customerEmail,
        amount: totalPrice,
        bump: bumpIncluded,
        platform: 'woocommerce',
        ...orderUtm
      });
    }

    if (attributedSlug && publicPageCache[attributedSlug]?.data) {
      const page = publicPageCache[attributedSlug];
      page.data.liveRevenue = Number(((page.data.liveRevenue || 0) + totalPrice).toFixed(2));
      page.data.liveOrders = (page.data.liveOrders || 0) + 1;
      if (bumpIncluded) {
        page.data.liveBumpOrders = (page.data.liveBumpOrders || 0) + 1;
      }
    }

    if (customerEmail) {
      try {
        await sendTransactional(ws.userId, 'order_confirmation', {
          to: customerEmail,
          name: customerName,
          dedupeKey: `order_confirmation:${orderId}`,
          vars: orderMailVars(orderRecord),
          visitorId
        });
        enrollAutomation(ws.userId, 'post_purchase', {
          email: customerEmail,
          name: customerName,
          visitorId
        }, orderMailVars(orderRecord));
        await enrollFlowsForTrigger(ws.userId, 'order_paid', {
          email: customerEmail,
          name: customerName,
          visitorId,
          phone: billing.phone || ''
        }, orderMailVars(orderRecord));
      } catch (err) {
        console.warn('[Jourvance] WooCommerce post-purchase flow notice:', err?.message || err);
      }
    }

    return res.status(200).json({ success: true, received: true, orderId });
  });
}
