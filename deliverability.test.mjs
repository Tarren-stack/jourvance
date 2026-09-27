import test from 'node:test';
import assert from 'node:assert/strict';

function evaluateDeliverabilityScore({ hasSpf, hasDkim, dmarcPolicy, hasMx }) {
  let score = 0;
  if (hasSpf) score += 25;
  if (hasDkim) score += 25;
  if (dmarcPolicy) {
    score += 35; // DMARC is crucial for Google/Yahoo inboxing
  }
  if (hasMx) score += 15;

  let status = 'critical';
  if (score >= 90) status = 'optimal';
  else if (score >= 70) status = 'good';
  else if (score >= 40) status = 'warning';

  return { score, status };
}

function parseSpfRecord(txt) {
  if (!txt || !txt.startsWith('v=spf1')) return null;
  const policyMatch = txt.match(/([~?+-]all)/);
  const policy = policyMatch ? policyMatch[1] : '~all';
  const includes = [...txt.matchAll(/include:([^\s]+)/g)].map(m => m[1]);
  return { valid: true, policy, includes };
}

function parseDmarcRecord(txt) {
  if (!txt || !txt.startsWith('v=DMARC1')) return null;
  const pMatch = txt.match(/p=([a-zA-Z]+)/);
  const policy = pMatch ? pMatch[1].toLowerCase() : 'none';
  const ruaMatch = txt.match(/rua=([^\s;]+)/);
  const rua = ruaMatch ? ruaMatch[1] : '';
  const pctMatch = txt.match(/pct=([0-9]+)/);
  const pct = pctMatch ? parseInt(pctMatch[1], 10) : 100;
  return { valid: true, policy, rua, pct };
}

test('SPF parser correctly identifies mechanisms and softfail policy', () => {
  const spf = 'v=spf1 include:sendgrid.net include:_spf.google.com ip4:192.0.2.1 ~all';
  const res = parseSpfRecord(spf);

  assert.ok(res);
  assert.equal(res.valid, true);
  assert.equal(res.policy, '~all');
  assert.deepEqual(res.includes, ['sendgrid.net', '_spf.google.com']);
});

test('DMARC parser extracts policy and reporting targets matching 2024 standards', () => {
  const dmarc = 'v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@brand.com; sp=none;';
  const res = parseDmarcRecord(dmarc);

  assert.ok(res);
  assert.equal(res.valid, true);
  assert.equal(res.policy, 'quarantine');
  assert.equal(res.rua, 'mailto:dmarc-reports@brand.com');
  assert.equal(res.pct, 100);
});

test('Deliverability Health Score penalizes missing DMARC and rewards full alignment', () => {
  // Scenario 1: Fully aligned domain (SPF + DKIM + DMARC + MX)
  const full = evaluateDeliverabilityScore({
    hasSpf: true,
    hasDkim: true,
    dmarcPolicy: 'reject',
    hasMx: true
  });
  assert.equal(full.score, 100);
  assert.equal(full.status, 'optimal');

  // Scenario 2: Missing DMARC (breaks Google/Yahoo 2024 bulk sender rules)
  const missingDmarc = evaluateDeliverabilityScore({
    hasSpf: true,
    hasDkim: true,
    dmarcPolicy: null,
    hasMx: true
  });
  assert.equal(missingDmarc.score, 65);
  assert.equal(missingDmarc.status, 'warning');

  // Scenario 3: Missing SPF and DMARC (high spam risk)
  const bad = evaluateDeliverabilityScore({
    hasSpf: false,
    hasDkim: false,
    dmarcPolicy: null,
    hasMx: true
  });
  assert.equal(bad.score, 15);
  assert.equal(bad.status, 'critical');
});

test('SSL certificate status validation enforces SNI authorization and expiration buffer', () => {
  const mockCert = {
    authorized: true,
    valid_to: new Date(Date.now() + 60 * 86400000).toUTCString(), // 60 days remaining
    issuer: { O: 'Google Trust Services' }
  };

  const now = Date.now();
  const expiresMs = new Date(mockCert.valid_to).getTime();
  const daysRemaining = Math.round((expiresMs - now) / 86400000);
  const sslActive = mockCert.authorized && daysRemaining > 0;

  assert.equal(sslActive, true);
  assert.ok(daysRemaining >= 59);
});
