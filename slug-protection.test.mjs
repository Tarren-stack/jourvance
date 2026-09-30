import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Live-server checks run only when JOURVANCE_LIVE_TEST_URL names a server you started for
// testing. They used to fetch http://localhost:3005 unconditionally, which on a developer machine
// is server.mjs holding the live hub key, and a catch swallowed their own assertion failures.
const LIVE_URL = process.env.JOURVANCE_LIVE_TEST_URL || '';
const LIVE = { skip: LIVE_URL ? false : 'set JOURVANCE_LIVE_TEST_URL to run against a test server' };

const RESERVED_PUBLIC_SLUGS = new Set([
  'api', 'admin', 'r', 'o', 'u', 'p', 'split', 'assets', 'favicon.ico', 
  'health', 'webhooks', 'login', 'signup', 'dashboard', 'preview', 'checkout', 'cart'
]);

function createSlugManagerSimulator() {
  const publicPageCache = {};

  async function loadPublicPage(identifier) {
    if (!identifier) return null;
    const cleanId = String(identifier).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (publicPageCache[cleanId]) {
      if (typeof publicPageCache[cleanId] === 'string') {
        return publicPageCache[publicPageCache[cleanId]] || null;
      }
      return publicPageCache[cleanId];
    }
    if (publicPageCache[`domain:${cleanId}`]) {
      const targetSlug = publicPageCache[`domain:${cleanId}`];
      return publicPageCache[targetSlug] || null;
    }
    for (const page of Object.values(publicPageCache)) {
      if (page && typeof page === 'object') {
        const pageDomain = (page.customDomain || page.data?.customDomain || '').toLowerCase().trim();
        if (pageDomain && pageDomain === cleanId) return page;
        if (page.slug?.toLowerCase() === cleanId) return page;
      }
    }
    return null;
  }

  async function savePublicPage(slug, data) {
    publicPageCache[slug] = data;
    const customDomain = (data.customDomain || data.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (customDomain) {
      const existingDomainSlug = publicPageCache[`domain:${customDomain}`];
      const existingDomainPage = existingDomainSlug ? (publicPageCache[existingDomainSlug] || await loadPublicPage(existingDomainSlug)) : null;
      if (!existingDomainPage || !existingDomainPage.userId || existingDomainPage.userId === data.userId) {
        publicPageCache[`domain:${customDomain}`] = slug;
      }
    }
  }

  async function validateSlugAvailability(slug, requestingUserId, { type = 'page', customDomain = '' } = {}) {
    const cleanSlug = String(slug || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!cleanSlug) {
      return { available: false, error: 'Slug cannot be empty.' };
    }
    if (RESERVED_PUBLIC_SLUGS.has(cleanSlug)) {
      return { available: false, error: `The slug "${cleanSlug}" is reserved by the system. Please pick another name.` };
    }

    const lookupKey = type === 'ab-split' ? `split:${cleanSlug}` : cleanSlug;
    const existingPage = publicPageCache[lookupKey] || await loadPublicPage(lookupKey);

    if (existingPage && existingPage.userId && existingPage.userId !== requestingUserId) {
      return {
        available: false,
        error: `The ${type === 'ab-split' ? 'split-test' : 'page'} slug "${cleanSlug}" is already claimed by another store. Please choose a unique custom slug.`
      };
    }

    if (type !== 'ab-split') {
      const directExisting = publicPageCache[cleanSlug] || await loadPublicPage(cleanSlug);
      if (directExisting && directExisting.userId && directExisting.userId !== requestingUserId) {
        return {
          available: false,
          error: `The page slug "${cleanSlug}" is already claimed by another store. Please choose a unique custom slug.`
        };
      }
    }

    if (customDomain) {
      const cleanDomain = String(customDomain).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (cleanDomain) {
        const existingDomainSlug = publicPageCache[`domain:${cleanDomain}`];
        if (existingDomainSlug) {
          const existingDomainPage = publicPageCache[existingDomainSlug] || await loadPublicPage(existingDomainSlug);
          if (existingDomainPage && existingDomainPage.userId && existingDomainPage.userId !== requestingUserId) {
            return {
              available: false,
              error: `The custom domain "${cleanDomain}" is already connected to another store. Please use a unique domain or remove it from the other store first.`
            };
          }
        }
      }
    }

    return { available: true, cleanSlug };
  }

  async function removePublicPage(slug, requestingUserId) {
    if (!slug) return false;
    const cleanSlug = String(slug).toLowerCase().trim();
    const page = publicPageCache[cleanSlug] || await loadPublicPage(cleanSlug);
    if (page && page.userId && page.userId !== requestingUserId) {
      return false;
    }
    const customDomain = (page?.customDomain || page?.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (customDomain && publicPageCache[`domain:${customDomain}`] === cleanSlug) {
      delete publicPageCache[`domain:${customDomain}`];
    }
    delete publicPageCache[cleanSlug];
    return true;
  }

  async function publishJourneySimulator(userId, journey) {
    const publishedPages = [];
    const nodes = journey.nodes || [];

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

        let slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'page', customDomain });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return { status: 409, error: slugCheck.error };
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'page', customDomain });
          if (!slugCheck.available) {
            return { status: 409, error: slugCheck.error };
          }
        }

        const pubUrl = `/p/${cleanSlug}`;
        node.data = { ...d, slug: cleanSlug, publishedUrl: pubUrl, published: true };
        const record = { slug: cleanSlug, userId, journeyId: journey.id, nodeId: node.id, customDomain: customDomain || undefined };
        await savePublicPage(cleanSlug, record);
        publishedPages.push({ nodeId: node.id, slug: cleanSlug, url: pubUrl });
      } else if (node.type === 'upsell') {
        const d = node.data || {};
        const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
        let cleanSlug = (d.slug || `${node.id}-upsell`)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '') || `upsell-${node.id.slice(0, 6)}`;

        let slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'page' });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return { status: 409, error: slugCheck.error };
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'page' });
          if (!slugCheck.available) {
            return { status: 409, error: slugCheck.error };
          }
        }

        const pubUrl = `/p/${cleanSlug}`;
        node.data = { ...d, slug: cleanSlug, publishedUrl: pubUrl, published: true };
        const record = { slug: cleanSlug, userId, journeyId: journey.id, nodeId: node.id, offerType: d.offerType || 'upsell' };
        await savePublicPage(cleanSlug, record);
        publishedPages.push({ nodeId: node.id, slug: cleanSlug, url: pubUrl });
      } else if (node.type === 'ab-split') {
        const d = node.data || {};
        const isCustomSlug = Boolean(d.slug && String(d.slug).trim());
        let cleanSlug = (d.slug || `${node.id}-split`)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '-')
          .replace(/^-+|-+$/g, '') || `split-${node.id.slice(0, 6)}`;

        let slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'ab-split' });
        if (!slugCheck.available) {
          if (isCustomSlug) {
            return { status: 409, error: slugCheck.error };
          }
          cleanSlug = `${cleanSlug}-${crypto.randomBytes(2).toString('hex')}`;
          slugCheck = await validateSlugAvailability(cleanSlug, userId, { type: 'ab-split' });
          if (!slugCheck.available) {
            return { status: 409, error: slugCheck.error };
          }
        }

        const pubUrl = `/p/split/${cleanSlug}`;
        node.data = { ...d, slug: cleanSlug, publishedUrl: pubUrl, published: true };
        const record = { slug: cleanSlug, userId, journeyId: journey.id, nodeId: node.id, isSplitRouter: true };
        await savePublicPage(`split:${cleanSlug}`, record);
        publishedPages.push({ nodeId: node.id, slug: cleanSlug, url: pubUrl });
      }
    }

    return { status: 200, success: true, publishedPages };
  }

  async function unpublishJourneySimulator(userId, journey) {
    const nodes = journey.nodes || [];
    for (const node of nodes) {
      if (node.type === 'landing-page' || node.type === 'upsell') {
        const slug = node.data?.slug;
        if (slug) {
          await removePublicPage(slug, userId);
        }
        if (node.data) node.data.published = false;
      } else if (node.type === 'ab-split') {
        const slug = node.data?.slug;
        if (slug) {
          await removePublicPage(`split:${slug}`, userId);
        }
        if (node.data) node.data.published = false;
      }
    }
    return { status: 200, success: true };
  }

  return {
    publicPageCache,
    loadPublicPage,
    savePublicPage,
    validateSlugAvailability,
    removePublicPage,
    publishJourneySimulator,
    unpublishJourneySimulator
  };
}

test('Reserved Slugs: Blocks registration of internal system routes', async () => {
  const mgr = createSlugManagerSimulator();
  for (const reserved of ['api', 'admin', 'r', 'o', 'u', 'p', 'split', 'assets', 'checkout', 'cart', 'login', 'signup', 'dashboard', 'preview']) {
    const res = await mgr.validateSlugAvailability(reserved, 'tenant_alice');
    assert.equal(res.available, false, `Expected reserved slug "${reserved}" to be blocked`);
    assert.match(res.error, /reserved by the system/);
  }
});

test('Multi-Tenant Page Slug Isolation: Tenant B cannot overwrite Tenant A landing page', async () => {
  const mgr = createSlugManagerSimulator();
  await mgr.savePublicPage('summer-glow', {
    slug: 'summer-glow',
    userId: 'tenant_alice',
    headline: 'Alice Radiance Serum'
  });

  // Alice checking her own slug should be valid
  const aliceCheck = await mgr.validateSlugAvailability('summer-glow', 'tenant_alice');
  assert.equal(aliceCheck.available, true);
  assert.equal(aliceCheck.cleanSlug, 'summer-glow');

  // Bob attempting to claim Alice's slug must be rejected
  const bobCheck = await mgr.validateSlugAvailability('summer-glow', 'tenant_bob');
  assert.equal(bobCheck.available, false);
  assert.match(bobCheck.error, /already claimed by another store/);
});

test('Cross-Node Namespace Protection: Upsell slug collides with Landing Page slug', async () => {
  const mgr = createSlugManagerSimulator();
  // Alice registers an upsell node with slug 'vip-glow-kit'
  await mgr.savePublicPage('vip-glow-kit', {
    slug: 'vip-glow-kit',
    userId: 'tenant_alice',
    offerType: 'upsell'
  });

  // Bob attempts to publish a landing page with 'vip-glow-kit'
  const bobPageCheck = await mgr.validateSlugAvailability('vip-glow-kit', 'tenant_bob', { type: 'page' });
  assert.equal(bobPageCheck.available, false);
  assert.match(bobPageCheck.error, /already claimed by another store/);

  // Bob attempts to publish an upsell with 'vip-glow-kit'
  const bobUpsellCheck = await mgr.validateSlugAvailability('vip-glow-kit', 'tenant_bob', { type: 'upsell' });
  assert.equal(bobUpsellCheck.available, false);
  assert.match(bobUpsellCheck.error, /already claimed by another store/);
});

test('A/B Split Test Slug Isolation: Tenant B cannot hijack Tenant A split route', async () => {
  const mgr = createSlugManagerSimulator();
  // Alice registers an ab-split router
  await mgr.savePublicPage('split:hero-headline-test', {
    slug: 'hero-headline-test',
    userId: 'tenant_alice',
    isSplitRouter: true
  });

  // Alice checking her own split router is allowed
  const aliceCheck = await mgr.validateSlugAvailability('hero-headline-test', 'tenant_alice', { type: 'ab-split' });
  assert.equal(aliceCheck.available, true);

  // Bob attempting to hijack split route is blocked
  const bobCheck = await mgr.validateSlugAvailability('hero-headline-test', 'tenant_bob', { type: 'ab-split' });
  assert.equal(bobCheck.available, false);
  assert.match(bobCheck.error, /already claimed by another store/);
});

test('Custom Domain Hijacking Prevention: Tenant B cannot steal custom domain pointer', async () => {
  const mgr = createSlugManagerSimulator();
  // Alice binds custom domain 'offers.auraglow.com' to her offer
  await mgr.savePublicPage('summer-offer', {
    slug: 'summer-offer',
    userId: 'tenant_alice',
    customDomain: 'offers.auraglow.com'
  });

  assert.equal(mgr.publicPageCache['domain:offers.auraglow.com'], 'summer-offer');

  // Bob attempts to validate and claim Alice's custom domain
  const bobCheck = await mgr.validateSlugAvailability('bob-promo', 'tenant_bob', {
    type: 'page',
    customDomain: 'https://offers.auraglow.com/'
  });
  assert.equal(bobCheck.available, false);
  assert.match(bobCheck.error, /already connected to another store/);

  // Bob attempts to publish a journey hijacking the domain
  const bobJourney = {
    id: 'jrn_bob_1',
    nodes: [
      {
        id: 'node_bob_lp',
        type: 'landing-page',
        data: {
          slug: 'bob-promo',
          customDomain: 'offers.auraglow.com'
        }
      }
    ]
  };

  const publishRes = await mgr.publishJourneySimulator('tenant_bob', bobJourney);
  assert.equal(publishRes.status, 409);
  assert.match(publishRes.error, /already connected to another store/);

  // Alice's domain pointer remains intact
  assert.equal(mgr.publicPageCache['domain:offers.auraglow.com'], 'summer-offer');
});

test('Publishing Auto-Resolution vs Explicit Custom Slug Conflicts', async () => {
  const mgr = createSlugManagerSimulator();
  // Alice has existing page 'glow-serum'
  await mgr.savePublicPage('glow-serum', {
    slug: 'glow-serum',
    userId: 'tenant_alice'
  });

  // Bob explicitly specifies custom slug 'glow-serum' -> Must 409 Conflict
  const bobCustomJourney = {
    id: 'jrn_bob_custom',
    nodes: [
      {
        id: 'node_1001',
        type: 'landing-page',
        data: { slug: 'glow-serum' }
      }
    ]
  };
  const resConflict = await mgr.publishJourneySimulator('tenant_bob', bobCustomJourney);
  assert.equal(resConflict.status, 409);
  assert.match(resConflict.error, /already claimed by another store/);

  // Bob uses default system-generated slug that collides (node.id is 'node_1001')
  await mgr.savePublicPage('node_1001', {
    slug: 'node_1001',
    userId: 'tenant_alice'
  });

  const bobDefaultJourney = {
    id: 'jrn_bob_default',
    nodes: [
      {
        id: 'node_1001',
        type: 'landing-page',
        data: {} // No explicit custom slug
      }
    ]
  };
  const resAuto = await mgr.publishJourneySimulator('tenant_bob', bobDefaultJourney);
  assert.equal(resAuto.status, 200);
  assert.equal(resAuto.success, true);
  // Slug auto-resolved with suffix
  const bobPublishedSlug = resAuto.publishedPages[0].slug;
  assert.ok(bobPublishedSlug.startsWith('node_1001-'));
  assert.notEqual(bobPublishedSlug, 'node_1001');
  assert.equal(mgr.publicPageCache[bobPublishedSlug].userId, 'tenant_bob');
  assert.equal(mgr.publicPageCache['node_1001'].userId, 'tenant_alice');
});

test('Clean Unpublish: Tenant B cannot unpublish Tenant A page; Tenant A cleans domain pointers', async () => {
  const mgr = createSlugManagerSimulator();
  await mgr.savePublicPage('alice-fest', {
    slug: 'alice-fest',
    userId: 'tenant_alice',
    customDomain: 'vip.auraglow.com'
  });
  assert.ok(mgr.publicPageCache['alice-fest']);
  assert.equal(mgr.publicPageCache['domain:vip.auraglow.com'], 'alice-fest');

  // Bob tries to unauthorized delete Alice's page
  const unauthorizedRemoval = await mgr.removePublicPage('alice-fest', 'tenant_bob');
  assert.equal(unauthorizedRemoval, false);
  assert.ok(mgr.publicPageCache['alice-fest'], 'Alice page must not be removed by Bob');
  assert.equal(mgr.publicPageCache['domain:vip.auraglow.com'], 'alice-fest');

  // Alice unpublishes her journey
  const aliceJourney = {
    id: 'jrn_alice',
    nodes: [
      {
        id: 'node_alice_lp',
        type: 'landing-page',
        data: { slug: 'alice-fest', published: true }
      }
    ]
  };
  const unpublishRes = await mgr.unpublishJourneySimulator('tenant_alice', aliceJourney);
  assert.equal(unpublishRes.status, 200);

  // Both slug and domain pointer are purged
  assert.equal(mgr.publicPageCache['alice-fest'], undefined);
  assert.equal(mgr.publicPageCache['domain:vip.auraglow.com'], undefined);

  // Bob can now claim the freed slug if desired
  const bobRecheck = await mgr.validateSlugAvailability('alice-fest', 'tenant_bob');
  assert.equal(bobRecheck.available, true);
});

test('Live Pre-Flight Check Endpoint: GET /api/journey/check-slug responds accurately', LIVE, async () => {
  const resReserved = await fetch(`${LIVE_URL}/api/journey/check-slug?slug=checkout`);
  // If endpoint requires user auth, 401 is expected without cookie; if auth mocked or present, 409 is expected
  assert.ok(resReserved.status === 401 || resReserved.status === 409, `Expected 401 or 409 on reserved slug, got ${resReserved.status}`);
});
