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
    persistPublicPages
  } = ctx;

  // Real-time custom domain verification
  app.get('/api/domain/verify', requireUser, async (req, res) => {
    const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) {
      return res.status(400).json({ success: false, error: 'A valid subdomain is required (e.g. offer.yourbrand.com).' });
    }

    const result = await verifyDomainOwnership(domain, req.user.uid);
    if (result.verified) {
      // If user has published pages using this custom domain, immediately activate domain routing
      for (const [slug, page] of Object.entries(publicPageCache)) {
        if (page && typeof page === 'object' && page.userId === req.user.uid) {
          const pageDomain = (page.customDomain || page.data?.customDomain || '').toLowerCase().trim();
          if (pageDomain === domain) {
            publicPageCache[`domain:${domain}`] = slug;
            persistPublicPages();
            break;
          }
        }
      }
    }
    return res.json(result);
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
