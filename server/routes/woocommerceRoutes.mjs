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

export function cleanWooUrl(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/^http:\/\//, 'https://');
}

export function setupWooCommerceRoutes(app, ctx) {
  const {
    requireUser,
    loadWorkspace,
    saveWorkspace,
    presentWorkspace,
    recordEvent,
    loadOrders,
    saveOrders
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

  // 4. Webhook Intake for WooCommerce Orders
  app.post('/api/webhooks/woocommerce/:wsId', async (req, res) => {
    const wsId = req.params.wsId;
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid payload.' });
    }

    // Acknowledge webhook immediately to prevent WooCommerce retries
    res.status(200).json({ success: true, received: true });

    // Track completed order event if customer email is present
    const customerEmail = body.billing?.email || body.shipping?.email;
    if (customerEmail && typeof recordEvent === 'function') {
      try {
        const total = parseFloat(body.total || '0') || 0;
        recordEvent({
          type: 'order_completed',
          workspaceId: wsId,
          email: customerEmail,
          revenue: total,
          currency: body.currency || 'USD',
          orderId: String(body.id || ''),
          platform: 'woocommerce',
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.warn('[Jourvance] Failed recording WooCommerce order event:', err);
      }
    }
  });
}
