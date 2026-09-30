import tls from 'tls';
import dns from 'dns';

/**
 * Non-blocking TLS SNI handshake to test live SSL certificate validity.
 */
export function checkSslCertificate(domain, timeoutMs = 3500) {
  return new Promise((resolve) => {
    let finished = false;
    const socket = tls.connect({
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
      timeout: timeoutMs
    }, () => {
      if (finished) return;
      finished = true;
      try {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const validTo = cert ? cert.valid_to : null;
        const validFrom = cert ? cert.valid_from : null;
        const issuer = cert && cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Unknown') : 'Unknown';
        const now = Date.now();
        const expiresMs = validTo ? new Date(validTo).getTime() : 0;
        const daysRemaining = expiresMs > now ? Math.round((expiresMs - now) / 86400000) : 0;
        const sslActive = authorized && daysRemaining > 0;

        socket.end();
        resolve({
          sslActive,
          authorized,
          issuer,
          validFrom,
          validTo,
          daysRemaining
        });
      } catch (err) {
        socket.destroy();
        resolve({ sslActive: false, error: err.message });
      }
    });

    socket.on('error', (err) => {
      if (finished) return;
      finished = true;
      resolve({ sslActive: false, error: err.code || err.message });
    });

    socket.on('timeout', () => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ sslActive: false, error: 'SSL Handshake timed out' });
    });
  });
}

/**
 * Mounts domain verification, pre-flight tokens, SSL inspection, and DNS deliverability routes.
 */
export function setupDomainRoutes(app, ctx) {
  const {
    requireUser,
    domainRegistryCache,
    reloadDomainRegistry,
    verifyDomainOwnership,
    getDomainVerificationToken,
    publicPageCache,
    persistPublicPages,
    persistDomainRegistry
  } = ctx;

  // Once a domain verifies, a published page already asking for it is served on it at once. A
  // domain is verified per user, not per journey, so this never moves a domain already serving
  // one of the user's pages (verifying again from another journey handed it to that journey's page
  // with no warning), and it picks a page only when one journey asks for the domain: the asking
  // journey when the caller names it, otherwise the journey it was last verified from when that
  // journey still asks for it, otherwise the only one. Anything else waits for a publish, whose
  // address check refuses a domain another journey is live on. A page the pointer was left on
  // after the user took the domain off it holds nothing, so the domain moves.
  const asksFor = (page, domain) =>
    String(page.customDomain || page.data?.customDomain || '').toLowerCase().trim() === domain;
  const activateDomain = (domain, uid, journeyId, storedJourneyId) => {
    const pointerKey = `domain:${domain}`;
    const held = publicPageCache[publicPageCache[pointerKey]];
    if (held && typeof held === 'object' && held.userId === uid && asksFor(held, domain)) return;
    const userAsking = Object.entries(publicPageCache).filter(([, page]) =>
      page && typeof page === 'object' && page.userId === uid && asksFor(page, domain));
    const ofJourney = (id) => userAsking.filter(([, page]) => String(page.journeyId || '') === id);
    const asking = journeyId
      ? ofJourney(journeyId)
      : (storedJourneyId && ofJourney(storedJourneyId).length ? ofJourney(storedJourneyId) : userAsking);
    if (!asking.length || new Set(asking.map(([, page]) => String(page.journeyId || ''))).size !== 1) return;
    publicPageCache[pointerKey] = asking[0][0];
    persistPublicPages();
  };

  // Real-time custom domain verification
  app.get('/api/domain/verify', requireUser, async (req, res) => {
    const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({ success: false, error: 'A valid subdomain is required (e.g. offer.yourbrand.com).' });
    }

    // The journey the check was made from (the page editor's Check DNS names it, as the address
    // check does). A verified domain records it, so an older client's check that names none still
    // goes to that journey's page rather than to whichever journey asks. verifyDomainOwnership
    // writes a fresh record, so the journey already recorded is read before it runs.
    const uid = req.user.uid;
    const journeyId = String(req.query.journeyId || '').trim().slice(0, 200);
    reloadDomainRegistry();
    const before = domainRegistryCache[domain];
    const recordedJourneyId = before && typeof before === 'object' && before.userId === uid
      ? String(before.journeyId || '')
      : '';
    const result = await verifyDomainOwnership(domain, uid);
    if (!result.verified) return res.json(result);
    const reg = domainRegistryCache[domain];
    const ownRecord = Boolean(reg && typeof reg === 'object' && reg.verified && reg.userId === uid);
    const tiedJourneyId = journeyId || recordedJourneyId;
    // Stored only where it survives: the registry file is reread on every route, so an unsaved
    // field would be gone by the next request.
    if (ownRecord && tiedJourneyId && reg.journeyId !== tiedJourneyId && typeof persistDomainRegistry === 'function') {
      reg.journeyId = tiedJourneyId;
      persistDomainRegistry();
    }
    activateDomain(domain, uid, journeyId, ownRecord ? recordedJourneyId : '');
    return res.json(ownRecord && reg.journeyId ? { ...result, journeyId: reg.journeyId } : result);
  });

  // Pre-flight challenge token generation & retrieval
  app.get('/api/domain/token', requireUser, (req, res) => {
    const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({ success: false, error: 'A valid subdomain is required.' });
    }
    const token = getDomainVerificationToken(req.user.uid, domain);
    reloadDomainRegistry();
    const reg = domainRegistryCache[domain];
    return res.json({
      success: true,
      domain,
      token,
      txtHost: `_jourvance.${domain}`,
      txtRecord: `jourvance-verification=${token}`,
      cnameHost: domain.split('.')[0],
      cnameTarget: 'cname.jourvance.com',
      verified: Boolean(reg && reg.verified && reg.userId === req.user.uid),
      contested: Boolean(reg && reg.verified && reg.userId && reg.userId !== req.user.uid)
    });
  });

  // Live TLS SNI Certificate Probe
  app.get('/api/domain/ssl-probe', requireUser, async (req, res) => {
    const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({ success: false, error: 'A valid domain is required.' });
    }
    const ssl = await checkSslCertificate(domain);
    return res.json({ success: true, domain, ...ssl });
  });

  // Email Deliverability & DNS Authentication (SPF, DKIM, DMARC, MX)
  app.get('/api/email/dns-check', requireUser, async (req, res) => {
    const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({ success: false, error: 'A valid root domain or subdomain is required (e.g. yourbrand.com).' });
    }

    // 1. SPF Check
    let spfResult = { valid: false, record: '', policy: '', includes: [], error: null };
    try {
      const txts = await dns.promises.resolveTxt(domain);
      const flat = (txts || []).map(chunks => chunks.join(''));
      const spfRecord = flat.find(r => r.startsWith('v=spf1'));
      if (spfRecord) {
        spfResult.record = spfRecord;
        spfResult.valid = true;
        const policyMatch = spfRecord.match(/([~?+-]all)/);
        spfResult.policy = policyMatch ? policyMatch[1] : '~all';
        const incMatches = [...spfRecord.matchAll(/include:([^\s]+)/g)].map(m => m[1]);
        spfResult.includes = incMatches;
      } else {
        spfResult.error = 'No SPF (v=spf1) TXT record found.';
      }
    } catch (e) {
      spfResult.error = e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? 'No SPF record found on domain.' : (e.message || 'DNS query failed');
    }

    // 2. DMARC Check (Mandatory for Google & Yahoo bulk delivery)
    let dmarcResult = { valid: false, record: '', policy: '', rua: '', pct: 100, error: null };
    try {
      const dmarcDomain = `_dmarc.${domain}`;
      const txts = await dns.promises.resolveTxt(dmarcDomain);
      const flat = (txts || []).map(chunks => chunks.join(''));
      const dmarcRecord = flat.find(r => r.startsWith('v=DMARC1'));
      if (dmarcRecord) {
        dmarcResult.record = dmarcRecord;
        dmarcResult.valid = true;
        const pMatch = dmarcRecord.match(/p=([a-zA-Z]+)/);
        dmarcResult.policy = pMatch ? pMatch[1].toLowerCase() : 'none';
        const ruaMatch = dmarcRecord.match(/rua=([^\s;]+)/);
        dmarcResult.rua = ruaMatch ? ruaMatch[1] : '';
        const pctMatch = dmarcRecord.match(/pct=([0-9]+)/);
        dmarcResult.pct = pctMatch ? parseInt(pctMatch[1], 10) : 100;
      } else {
        dmarcResult.error = `No DMARC (v=DMARC1) record found at _dmarc.${domain}`;
      }
    } catch (e) {
      dmarcResult.error = e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? 'Missing DMARC policy record.' : (e.message || 'DNS query failed');
    }

    // 3. DKIM Check (Probes common ESP selectors)
    const selectors = ['s1', 'k1', 'sg', 'default', 'google', 'smtp', 'mail', 'krs'];
    let dkimResult = { valid: false, selector: null, record: '', error: null };
    for (const sel of selectors) {
      try {
        const dkimHost = `${sel}._domainkey.${domain}`;
        const txts = await dns.promises.resolveTxt(dkimHost);
        const flat = (txts || []).map(chunks => chunks.join(''));
        const dkimRecord = flat.find(r => r.startsWith('v=DKIM1') || r.includes('p='));
        if (dkimRecord) {
          dkimResult = { valid: true, selector: sel, record: dkimRecord, error: null };
          break;
        }
      } catch (e) {}
    }
    if (!dkimResult.valid) {
      dkimResult.error = `No DKIM record found on common selectors (${selectors.slice(0, 4).join(', ')}...).`;
    }

    // 4. MX Check
    let mxResult = { valid: false, records: [], error: null };
    try {
      const mx = await dns.promises.resolveMx(domain);
      if (Array.isArray(mx) && mx.length > 0) {
        mxResult.valid = true;
        mxResult.records = mx.sort((a, b) => a.priority - b.priority);
      } else {
        mxResult.error = 'No MX records found.';
      }
    } catch (e) {
      mxResult.error = e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? 'No MX records found on domain.' : (e.message || 'DNS query failed');
    }

    const overallValid = spfResult.valid && dmarcResult.valid;
    return res.json({
      success: true,
      domain,
      overallValid,
      spf: spfResult,
      dmarc: dmarcResult,
      dkim: dkimResult,
      mx: mxResult,
      checkedAt: new Date().toISOString()
    });
  });
}
