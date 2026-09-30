import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { setupDomainRoutes } from './server/routes/domainRoutes.mjs';

// Live-server checks run only when JOURVANCE_LIVE_TEST_URL names a server you started for
// testing. They used to fetch http://localhost:3005 unconditionally, which on a developer machine
// is server.mjs holding the live hub key, and a catch swallowed their own assertion failures.
const LIVE_URL = process.env.JOURVANCE_LIVE_TEST_URL || '';
const LIVE = { skip: LIVE_URL ? false : 'set JOURVANCE_LIVE_TEST_URL to run against a test server' };

function createDomainVerificationSimulator() {
  const publicPageCache = {};
  const domainRegistryCache = {};

  function getDomainVerificationToken(userId, domain) {
    const cleanDomain = String(domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const secret = 'jourvance_test_domain_salt';
    return 'jrv_' + crypto.createHash('sha256').update(`${userId}:${cleanDomain}:${secret}`).digest('hex').slice(0, 16);
  }

  async function loadPublicPage(identifier) {
    if (!identifier) return null;
    const cleanId = String(identifier).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    // Direct slug match
    if (publicPageCache[cleanId]) {
      if (typeof publicPageCache[cleanId] === 'string') {
        return publicPageCache[publicPageCache[cleanId]] || null;
      }
      return publicPageCache[cleanId];
    }

    // Domain pointer match (ensuring verified ownership)
    if (publicPageCache[`domain:${cleanId}`]) {
      const targetSlug = publicPageCache[`domain:${cleanId}`];
      const targetPage = publicPageCache[targetSlug] || null;
      if (targetPage) {
        const reg = domainRegistryCache[cleanId];
        if (reg && reg.verified && reg.userId === targetPage.userId) {
          return targetPage;
        }
      }
    }

    // Deep search cached records for matching customDomain ONLY IF verified for that page's owner
    const reg = domainRegistryCache[cleanId];
    if (reg && reg.verified) {
      for (const page of Object.values(publicPageCache)) {
        if (page && typeof page === 'object' && page.userId === reg.userId) {
          const pageDomain = (page.customDomain || page.data?.customDomain || '').toLowerCase().trim();
          if (pageDomain && pageDomain === cleanId) return page;
        }
      }
    }

    return null;
  }

  async function savePublicPage(slug, data) {
    publicPageCache[slug] = data;
    const customDomain = (data.customDomain || data.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (customDomain) {
      const reg = domainRegistryCache[customDomain];
      const isVerifiedForUser = Boolean(reg && reg.verified && reg.userId === data.userId);
      if (isVerifiedForUser) {
        publicPageCache[`domain:${customDomain}`] = slug;
      }
    }
  }

  async function verifyDomainOwnershipSimulator(domain, requestingUserId, dnsMock = {}) {
    const cleanDomain = String(domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleanDomain || !cleanDomain.includes('.')) {
      return { success: false, verified: false, error: 'A valid subdomain is required.' };
    }

    const expectedTarget = 'cname.jourvance.com';
    const expectedToken = getDomainVerificationToken(requestingUserId, cleanDomain);
    const expectedTxtHost = `_jourvance.${cleanDomain}`;
    const expectedTxtRecord = `jourvance-verification=${expectedToken}`;

    const existingRecord = domainRegistryCache[cleanDomain];
    const isClaimedByOther = Boolean(existingRecord && existingRecord.verified && existingRecord.userId && existingRecord.userId !== requestingUserId);

    // Simulated DNS queries
    const txtRecords = dnsMock.txt || [];
    const txtFound = txtRecords.some(r => r === expectedToken || r === expectedTxtRecord || r.includes(expectedToken));

    const cnames = dnsMock.cnames || [];
    const cnameMatch = Array.isArray(cnames) && cnames.some(c => {
      const lower = c.toLowerCase().replace(/\.$/, '');
      return lower === expectedTarget || lower === 'jourvance.com' || lower.includes('jourvance');
    });

    // Case A: Proven by TXT Challenge (Full Cryptographic Proof)
    if (txtFound) {
      const record = {
        domain: cleanDomain,
        userId: requestingUserId,
        verified: true,
        verifiedAt: new Date().toISOString(),
        verificationToken: expectedToken,
        method: 'txt_challenge',
        sslActive: Boolean(dnsMock.sslActive)
      };
      domainRegistryCache[cleanDomain] = record;
      return {
        success: true,
        verified: true,
        domain: cleanDomain,
        method: 'txt_challenge',
        cnameMatch,
        cnames,
        expectedTarget,
        sslActive: Boolean(dnsMock.sslActive),
        message: 'Domain verified via DNS TXT Challenge! Ownership confirmed for your store.'
      };
    }

    // Case B: CNAME points to Jourvance, but domain is already registered to another tenant
    if (cnameMatch && isClaimedByOther) {
      return {
        success: true,
        verified: false,
        contested: true,
        domain: cleanDomain,
        cnames,
        expectedTarget,
        verificationToken: expectedToken,
        expectedTxtHost,
        expectedTxtRecord,
        error: `This domain is currently connected to another store. To verify and transfer ownership, please add a TXT DNS record at ${expectedTxtHost} with value "${expectedToken}".`,
        message: `Contested Domain: To prove you own ${cleanDomain}, add a TXT record in your DNS provider.`
      };
    }

    // Case C: CNAME points to Jourvance and domain is UNCONTESTED (or already owned by this user)
    if (cnameMatch && !isClaimedByOther) {
      const record = {
        domain: cleanDomain,
        userId: requestingUserId,
        verified: true,
        verifiedAt: new Date().toISOString(),
        verificationToken: expectedToken,
        method: 'cname',
        sslActive: Boolean(dnsMock.sslActive)
      };
      domainRegistryCache[cleanDomain] = record;
      return {
        success: true,
        verified: true,
        domain: cleanDomain,
        method: 'cname',
        cnameMatch: true,
        cnames,
        expectedTarget,
        sslActive: Boolean(dnsMock.sslActive),
        message: 'CNAME Verified! Domain pointed directly to cname.jourvance.com.'
      };
    }

    // Case D: Not pointed to Jourvance
    return {
      success: true,
      verified: false,
      domain: cleanDomain,
      cnameMatch: false,
      cnames,
      expectedTarget,
      verificationToken: expectedToken,
      expectedTxtHost,
      expectedTxtRecord,
      message: `No active CNAME detected for ${cleanDomain}. Add CNAME pointing to ${expectedTarget}.`
    };
  }

  async function publishJourneySimulator(userId, journey) {
    const publishedPages = [];
    const nodes = journey.nodes || [];

    for (const node of nodes) {
      if (node.type === 'landing-page') {
        const d = node.data || {};
        const cleanSlug = d.slug || `offer-${node.id.slice(0, 6)}`;
        const customDomain = (d.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

        const reg = domainRegistryCache[customDomain];
        const isDomainVerified = Boolean(reg && reg.verified && reg.userId === userId);

        const pubUrl = `/p/${cleanSlug}`;
        node.data = {
          ...d,
          slug: cleanSlug,
          publishedUrl: pubUrl,
          published: true,
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified
        };

        const publicRecord = {
          slug: cleanSlug,
          userId,
          journeyId: journey.id,
          nodeId: node.id,
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
          customDomain: customDomain || undefined,
          customDomainVerified: isDomainVerified
        });
      }
    }

    return { status: 200, success: true, publishedPages };
  }

  return {
    publicPageCache,
    domainRegistryCache,
    getDomainVerificationToken,
    loadPublicPage,
    savePublicPage,
    verifyDomainOwnershipSimulator,
    publishJourneySimulator
  };
}

test('Token Generation: Produces deterministic, tenant-isolated verification tokens', () => {
  const sim = createDomainVerificationSimulator();
  const tokenAlice = sim.getDomainVerificationToken('tenant_alice', 'offers.auraglow.com');
  const tokenAliceRepeat = sim.getDomainVerificationToken('tenant_alice', 'offers.auraglow.com');
  const tokenBob = sim.getDomainVerificationToken('tenant_bob', 'offers.auraglow.com');

  assert.ok(tokenAlice.startsWith('jrv_'));
  assert.equal(tokenAlice, tokenAliceRepeat, 'Token must be deterministic for the same tenant and domain');
  assert.notEqual(tokenAlice, tokenBob, 'Different tenants must receive unique, non-colliding verification tokens');
});

test('Hybrid Verification - Case 1: Uncontested domain verified instantly via CNAME', async () => {
  const sim = createDomainVerificationSimulator();
  const res = await sim.verifyDomainOwnershipSimulator('vip.auraglow.com', 'tenant_alice', {
    cnames: ['cname.jourvance.com.'],
    sslActive: true
  });

  assert.equal(res.success, true);
  assert.equal(res.verified, true);
  assert.equal(res.method, 'cname');
  assert.equal(sim.domainRegistryCache['vip.auraglow.com']?.userId, 'tenant_alice');
  assert.equal(sim.domainRegistryCache['vip.auraglow.com']?.verified, true);
});

test('Hybrid Verification - Case 2: Contested domain blocks CNAME takeover without TXT challenge', async () => {
  const sim = createDomainVerificationSimulator();
  // Alice previously verified 'offers.auraglow.com'
  await sim.verifyDomainOwnershipSimulator('offers.auraglow.com', 'tenant_alice', {
    cnames: ['cname.jourvance.com.']
  });
  assert.equal(sim.domainRegistryCache['offers.auraglow.com']?.userId, 'tenant_alice');

  // Bob points CNAME to cname.jourvance.com and attempts to verify Alice's domain
  const bobRes = await sim.verifyDomainOwnershipSimulator('offers.auraglow.com', 'tenant_bob', {
    cnames: ['cname.jourvance.com.']
  });

  assert.equal(bobRes.verified, false, 'Bob must NOT be verified with CNAME alone on contested domain');
  assert.equal(bobRes.contested, true);
  assert.match(bobRes.error, /currently connected to another store/);
  assert.ok(bobRes.verificationToken.startsWith('jrv_'));
  assert.equal(sim.domainRegistryCache['offers.auraglow.com']?.userId, 'tenant_alice', 'Alice remains verified owner');
});

test('Hybrid Verification - Case 3: Legitimate owner reclaims contested domain via TXT challenge token', async () => {
  const sim = createDomainVerificationSimulator();
  // Alice previously had the domain
  await sim.verifyDomainOwnershipSimulator('store.mybrand.com', 'tenant_alice', {
    cnames: ['cname.jourvance.com.']
  });

  // Bob adds a TXT record with Bob's verification token to prove real DNS control
  const bobToken = sim.getDomainVerificationToken('tenant_bob', 'store.mybrand.com');
  const bobRes = await sim.verifyDomainOwnershipSimulator('store.mybrand.com', 'tenant_bob', {
    cnames: ['cname.jourvance.com.'],
    txt: [`jourvance-verification=${bobToken}`]
  });

  assert.equal(bobRes.verified, true, 'Bob is verified via TXT challenge token');
  assert.equal(bobRes.method, 'txt_challenge');
  assert.equal(sim.domainRegistryCache['store.mybrand.com']?.userId, 'tenant_bob', 'Ownership successfully transferred to Bob');
});

test('Host Routing Protection: Unverified domains do NOT route live traffic', async () => {
  const sim = createDomainVerificationSimulator();
  // Alice publishes a journey with an unverified custom domain
  const journey = {
    id: 'jrn_unverified_lp',
    nodes: [
      {
        id: 'node_1',
        type: 'landing-page',
        data: { slug: 'summer-sale', customDomain: 'sale.unverified-brand.com' }
      }
    ]
  };

  const pubResult = await sim.publishJourneySimulator('tenant_alice', journey);
  assert.equal(pubResult.publishedPages[0].customDomainVerified, false);
  assert.equal(sim.publicPageCache['domain:sale.unverified-brand.com'], undefined, 'Domain pointer must NOT be registered for unverified domain');

  // Request to host header 'sale.unverified-brand.com' returns null
  const routedPage = await sim.loadPublicPage('sale.unverified-brand.com');
  assert.equal(routedPage, null, 'Unverified custom domain must not serve funnel pages');

  // However, default slug route is immediately active
  const slugPage = await sim.loadPublicPage('summer-sale');
  assert.ok(slugPage, 'Default slug URL must remain functional and accessible');
  assert.equal(slugPage.slug, 'summer-sale');
});

test('Host Routing Activation: Once verified, host header routing serves the funnel', async () => {
  const sim = createDomainVerificationSimulator();
  // Verify domain first
  await sim.verifyDomainOwnershipSimulator('vip.auraglow.com', 'tenant_alice', {
    cnames: ['cname.jourvance.com.']
  });

  // Publish page with verified domain
  const journey = {
    id: 'jrn_verified_lp',
    nodes: [
      {
        id: 'node_1',
        type: 'landing-page',
        data: { slug: 'vip-access', customDomain: 'vip.auraglow.com' }
      }
    ]
  };

  const pubResult = await sim.publishJourneySimulator('tenant_alice', journey);
  assert.equal(pubResult.publishedPages[0].customDomainVerified, true);
  assert.equal(sim.publicPageCache['domain:vip.auraglow.com'], 'vip-access');

  // Host header lookup now returns the page
  const routedPage = await sim.loadPublicPage('vip.auraglow.com');
  assert.ok(routedPage);
  assert.equal(routedPage.slug, 'vip-access');
  assert.equal(routedPage.userId, 'tenant_alice');
});

test('Tamper Protection: Stolen domain pointer in cache is rejected if registry does not match page owner', async () => {
  const sim = createDomainVerificationSimulator();
  // Malicious user injects domain pointer directly into cache pointing to Bob's page
  sim.publicPageCache['domain:target.com'] = 'bob-page';
  sim.publicPageCache['bob-page'] = { slug: 'bob-page', userId: 'tenant_bob' };

  // But target.com in domainRegistry belongs to Alice (or is missing)
  sim.domainRegistryCache['target.com'] = {
    domain: 'target.com',
    userId: 'tenant_alice',
    verified: true
  };

  // Attempting to route 'target.com' must reject Bob's page
  const routed = await sim.loadPublicPage('target.com');
  assert.equal(routed, null, 'Must reject pointer when target page owner does not match verified domain owner');
});

test('Live Server Verification: GET /api/domain/token and /api/domain/verify require authentication', LIVE, async () => {
  const tokenRes = await fetch(`${LIVE_URL}/api/domain/token?domain=offer.testbrand.com`);
  assert.equal(tokenRes.status, 401, 'Unauthenticated /api/domain/token must return 401');

  const verifyRes = await fetch(`${LIVE_URL}/api/domain/verify?domain=offer.testbrand.com`);
  assert.equal(verifyRes.status, 401, 'Unauthenticated /api/domain/verify must return 401');
});

// T12 / R26: Check DNS in the page editor named no journey, so a verified domain went to whichever
// of the user's journeys asked for it. The route now takes the journey id, records it on the
// verified domain (saved, because the registry file is reread on every route) and serves that
// journey's page. Driven on a bare Express app over the real route module; the DNS answer is
// stubbed and writes a fresh record the way verifyDomainOwnership does. Nothing loads .env.
async function serveDomainRoutes({ uid = 'u1', verifies = true, withPersist = true } = {}) {
  const publicPageCache = {};
  const domainRegistryCache = {};
  let domainsFile = '{}';
  const counts = { persistDomainRegistry: 0 };
  const ctx = {
    requireUser: (req, _res, next) => { req.user = { uid: req.get('x-test-uid') || uid }; next(); },
    domainRegistryCache,
    // Refilled from the saved file in place, like server.mjs: an unsaved field does not survive it.
    reloadDomainRegistry() {
      for (const k of Object.keys(domainRegistryCache)) delete domainRegistryCache[k];
      Object.assign(domainRegistryCache, JSON.parse(domainsFile));
      return domainRegistryCache;
    },
    verifyDomainOwnership: async (domain, requestingUid) => {
      if (!verifies) return { success: true, verified: false, domain };
      domainRegistryCache[domain] = { domain, userId: requestingUid, verified: true, method: 'cname' };
      domainsFile = JSON.stringify(domainRegistryCache);
      return { success: true, verified: true, domain };
    },
    getDomainVerificationToken: () => 'jrv_test',
    publicPageCache,
    persistPublicPages() {}
  };
  if (withPersist) {
    ctx.persistDomainRegistry = () => { counts.persistDomainRegistry += 1; domainsFile = JSON.stringify(domainRegistryCache); };
  }
  const app = express();
  setupDomainRoutes(app, ctx);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const verify = async (query, headers = {}) => {
    const r = await fetch(`${base}/api/domain/verify?${query}`, { headers });
    return { status: r.status, body: await r.json() };
  };
  const saved = () => JSON.parse(domainsFile);
  return {
    verify, saved, counts, publicPageCache, domainRegistryCache, ctx,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

const askingPage = (slug, journeyId, userId = 'u1') => ({ slug, userId, journeyId, customDomain: 'shop.example.com', data: { headline: slug } });

test('Check DNS from a journey records that journey on the verified domain and serves its page', async () => {
  const s = await serveDomainRoutes();
  try {
    s.publicPageCache['first-offer'] = askingPage('first-offer', 'j1');
    s.publicPageCache['second-offer'] = askingPage('second-offer', 'j2');

    const r = await s.verify('domain=shop.example.com&journeyId=j2');
    assert.equal(r.status, 200);
    assert.equal(r.body.verified, true);
    assert.equal(r.body.journeyId, 'j2', 'the reply says which journey the domain is tied to');
    assert.equal(s.saved()['shop.example.com'].journeyId, 'j2', 'the journey is saved with the verified domain');
    assert.equal(s.counts.persistDomainRegistry, 1);
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer', "the domain serves that journey's page");

    // A later check that names no journey (an older client) keeps the tie, and with the pointer
    // gone it goes back to the recorded journey rather than refusing between the two.
    delete s.publicPageCache['domain:shop.example.com'];
    const again = await s.verify('domain=shop.example.com');
    assert.equal(again.body.journeyId, 'j2');
    assert.equal(s.saved()['shop.example.com'].journeyId, 'j2', 'a fresh verification record keeps the journey');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer');

    // Checked again from the other journey: the tie moves, the live page keeps the domain.
    const fromFirst = await s.verify('domain=shop.example.com&journeyId=j1');
    assert.equal(fromFirst.body.journeyId, 'j1');
    assert.equal(s.saved()['shop.example.com'].journeyId, 'j1');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer', 'checking DNS never moves a live domain');
  } finally {
    await s.close();
  }
});

test('Check DNS stores no journey on a domain that did not verify, or that verified for another user', async () => {
  const unverified = await serveDomainRoutes({ verifies: false });
  try {
    const r = await unverified.verify('domain=shop.example.com&journeyId=j2');
    assert.equal(r.body.verified, false);
    assert.equal(r.body.journeyId, undefined);
    assert.deepEqual(unverified.saved(), {});
    assert.equal(unverified.counts.persistDomainRegistry, 0);
  } finally {
    await unverified.close();
  }

  // Another user's earlier tie is not carried onto this user's record.
  const s = await serveDomainRoutes();
  try {
    s.domainRegistryCache['shop.example.com'] = { domain: 'shop.example.com', userId: 'u2', verified: true, journeyId: 'their-journey' };
    s.ctx.persistDomainRegistry();
    const r = await s.verify('domain=shop.example.com');
    assert.equal(r.body.verified, true);
    assert.equal(r.body.journeyId, undefined);
    assert.equal(s.saved()['shop.example.com'].userId, 'u1');
    assert.equal(s.saved()['shop.example.com'].journeyId, undefined);
  } finally {
    await s.close();
  }
});

test('Without a way to save the registry the route stores nothing it would lose', async () => {
  const s = await serveDomainRoutes({ withPersist: false });
  try {
    s.publicPageCache['second-offer'] = askingPage('second-offer', 'j2');
    const r = await s.verify('domain=shop.example.com&journeyId=j2');
    assert.equal(r.body.verified, true);
    assert.equal(s.domainRegistryCache['shop.example.com'].journeyId, undefined, 'no unsaved field');
    assert.equal(s.publicPageCache['domain:shop.example.com'], 'second-offer', 'the named journey still gets the domain');
  } finally {
    await s.close();
  }
});

// The bare-Express tests above hand the route persistDomainRegistry; the live server builds its own
// ctx in server.mjs. Without it the route skips the save (the test above), so the tie is lost on a
// real server, so the live ctx must pass it too.
{
  const fs = await import('node:fs');
  const serverSrc = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  const start = serverSrc.indexOf('setupDomainRoutes(app, {');
  const liveCtx = start < 0 ? '' : serverSrc.slice(start, serverSrc.indexOf('});', start));
  test('The live server gives the domain routes a way to save the registry', () => {
    assert.ok(liveCtx, 'server.mjs mounts the domain routes');
    assert.match(liveCtx, /\bpersistDomainRegistry\b/);
  });
}
