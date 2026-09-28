import crypto from 'crypto';

/**
 * Mounts journey publishing, unpublishing, and slug collision validation routes.
 */
export function setupJourneyRoutes(app, ctx) {
  const {
    requireUser,
    loadJourney,
    saveJourney,
    loadWorkspace,
    realStoreDomain,
    validateSlugAvailability,
    reloadDomainRegistry,
    domainRegistryCache,
    savePublicPage,
    removePublicPage,
    persistPublicPages,
    publicPageCache
  } = ctx;

  // Real-time pre-flight slug check endpoint
  app.get('/api/journey/check-slug', requireUser, async (req, res) => {
    const slug = String(req.query.slug || '').trim();
    const type = String(req.query.type || 'page').trim();
    const customDomain = String(req.query.customDomain || '').trim();
    const result = await validateSlugAvailability(slug, req.user.uid, { type, customDomain });
    if (!result.available) {
      return res.status(409).json({ success: false, error: result.error });
    }
    return res.json({ success: true, cleanSlug: result.cleanSlug });
  });

  // Funnel Publishing Route
  app.post('/api/journey/:id/publish', requireUser, async (req, res) => {
    const journey = await loadJourney(req.user.uid, req.params.id);
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

    const wsId = journey.workspaceId || req.body?.workspaceId;
    const ws = wsId ? await loadWorkspace(req.user.uid, wsId) : null;
    const nodes = Array.isArray(journey.nodes) ? journey.nodes : [];
    const connectedDomain = realStoreDomain(ws?.shopifyConfig);
    const shopifyConfig = connectedDomain
      ? { ...ws.shopifyConfig, storeDomain: connectedDomain }
      : { storeDomain: '', status: 'disconnected' };

    const publishedPages = [];
    const upsellNodes = nodes.filter(n => n.type === 'upsell');
    const thankYouNodes = nodes.filter(n => n.type === 'thank-you');

    for (const node of nodes) {
      if (node.type === 'landing-page') {
        const d = node.data || {};
        const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
        let cleanSlug = (d.slug || node.id)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '') || `offer-${node.id.slice(0, 6)}`;

        const customDomain = (d.customDomain || '')
          .toLowerCase()
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, '');

        let slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'page', customDomain });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'page', customDomain });
          if (!slugCheck.available) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
        }

        const pubUrl = `/p/${cleanSlug}`;
        const upsellNode = upsellNodes.find(u => u.data?.offerType !== 'downsell');
        const downsellNode = upsellNodes.find(u => u.data?.offerType === 'downsell');
        const thankYouNode = thankYouNodes[0];

        let isDomainVerified = false;
        if (customDomain) {
          reloadDomainRegistry();
          const reg = domainRegistryCache[customDomain];
          isDomainVerified = Boolean(reg && reg.verified && reg.userId === req.user.uid);
        }

        node.data = {
          ...d,
          slug: cleanSlug,
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified,
          published: true,
          publishedAt: new Date().toISOString(),
          publishedUrl: pubUrl,
          upsell: upsellNode?.data ? { ...upsellNode.data } : d.upsell,
          downsell: downsellNode?.data ? { ...downsellNode.data } : d.downsell,
          hasDownsell: Boolean(downsellNode?.data || d.downsell),
          thankYou: thankYouNode?.data ? { ...thankYouNode.data } : d.thankYou
        };

        const publicRecord = {
          slug: cleanSlug,
          journeyId: journey.id,
          workspaceId: wsId || 'default',
          userId: req.user.uid,
          nodeId: node.id,
          publishedAt: new Date().toISOString(),
          data: node.data,
          shopifyConfig,
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified
        };

        await savePublicPage(cleanSlug, publicRecord);
        if (customDomain && isDomainVerified) {
          publicPageCache[`domain:${customDomain}`] = cleanSlug;
        }
        publishedPages.push({
          nodeId: node.id,
          slug: cleanSlug,
          url: pubUrl,
          headline: d.headline,
          productTitle: d.shopifyProductTitle,
          checkoutMode: d.checkoutMode || 'direct',
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified
        });
      } else if (node.type === 'upsell') {
        const d = node.data || {};
        const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
        let cleanSlug = (d.slug || `${node.id}-upsell`)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '') || `upsell-${node.id.slice(0, 6)}`;

        let slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'page' });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'page' });
          if (!slugCheck.available) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
        }

        const pubUrl = `/p/${cleanSlug}`;
        node.data = {
          ...d,
          slug: cleanSlug,
          published: true,
          publishedAt: new Date().toISOString(),
          publishedUrl: pubUrl
        };
        const publicRecord = {
          slug: cleanSlug,
          journeyId: journey.id,
          workspaceId: wsId || 'default',
          userId: req.user.uid,
          nodeId: node.id,
          publishedAt: new Date().toISOString(),
          data: {
            ...node.data,
            upsell: d.offerType !== 'downsell' ? node.data : undefined,
            downsell: d.offerType === 'downsell' ? node.data : undefined
          },
          shopifyConfig
        };
        await savePublicPage(cleanSlug, publicRecord);
      } else if (node.type === 'ab-split') {
        const d = node.data || {};
        const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
        let cleanSlug = (d.slug || `${node.id}-split`)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '') || `split-${node.id.slice(0, 6)}`;

        let slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'ab-split' });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, req.user.uid, { type: 'ab-split' });
          if (!slugCheck.available) {
            return res.status(409).json({ success: false, error: slugCheck.error });
          }
        }

        const pubUrl = `/p/split/${cleanSlug}`;

        // Resolve target pages from outgoing edges or data fields
        const edges = Array.isArray(journey.edges) ? journey.edges : [];
        const outgoingEdges = edges.filter(e => e.source === node.id);
        const edgeA = outgoingEdges.find(e => e.sourceHandle === 'branch-a') || outgoingEdges[0];
        const edgeB = outgoingEdges.find(e => e.sourceHandle === 'branch-b') || outgoingEdges[1];

        let targetASlug = d.branchAPageSlug || '';
        let targetBSlug = d.branchBPageSlug || '';

        if (edgeA) {
          const targetNodeA = nodes.find(n => n.id === edgeA.target);
          if (targetNodeA?.data?.slug) targetASlug = targetNodeA.data.slug;
        }
        if (edgeB) {
          const targetNodeB = nodes.find(n => n.id === edgeB.target);
          if (targetNodeB?.data?.slug) targetBSlug = targetNodeB.data.slug;
        }

        node.data = {
          ...d,
          slug: cleanSlug,
          branchAPageSlug: targetASlug,
          branchBPageSlug: targetBSlug,
          published: true,
          publishedAt: new Date().toISOString(),
          publishedUrl: pubUrl
        };

        const publicRecord = {
          type: 'ab-split',
          slug: cleanSlug,
          journeyId: journey.id,
          workspaceId: wsId || 'default',
          userId: req.user.uid,
          nodeId: node.id,
          publishedAt: new Date().toISOString(),
          data: node.data,
          shopifyConfig
        };

        await savePublicPage(`split:${cleanSlug}`, splitRecord);
        publicPageCache[`split:${cleanSlug}`] = splitRecord;

        publishedPages.push({
          nodeId: node.id,
          slug: cleanSlug,
          url: pubUrl,
          headline: d.label || 'A/B Traffic Splitter',
          productTitle: `A/B Split (${d.splitRatio ?? 50}% / ${100 - (d.splitRatio ?? 50)}%)`,
          checkoutMode: 'ab-split'
        });
      }
    }

    persistPublicPages();
    await saveJourney(req.user.uid, req.params.id, journey);

    res.json({
      success: true,
      publishedPages,
      message: `Published ${publishedPages.length} landing page(s) successfully.`
    });
  });

  // Funnel Unpublishing Route
  app.post('/api/journey/:id/unpublish', requireUser, async (req, res) => {
    const journey = await loadJourney(req.user.uid, req.params.id);
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

    const nodes = journey.nodes || [];
    for (const node of nodes) {
      if (node.type === 'landing-page' || node.type === 'upsell') {
        const slug = node.data?.slug;
        if (slug) {
          await removePublicPage(slug, req.user.uid);
        }
        if (node.data) node.data.published = false;
      } else if (node.type === 'ab-split') {
        const slug = node.data?.slug;
        if (slug) {
          await removePublicPage(`split:${slug}`, req.user.uid);
        }
        if (node.data) node.data.published = false;
      }
    }
    persistPublicPages();
    await saveJourney(req.user.uid, req.params.id, journey);

    res.json({ success: true, message: 'Funnel unpublished successfully.' });
  });
}
