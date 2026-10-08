// The Security Sentinel is the hub's drop-in every spoke vendors, and this server had none: no
// CSP, no hardened headers, no rate limit, no posture report, and no `trust proxy` setting at
// all. These pins cover the mount (order, options, the shield), the vendored copies, and the
// address-based proxy walk, through real Express apps on a loopback socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { applySecurity } from './security-sentinel.js';
import { shieldProse, maskStrings, PROSE_ROUTE_PREFIXES } from './server/sentinel-shield.mjs';
import { trustedProxy, isCloudflareAddress, isPrivateAddress, parseCidrList, proxyTrustSummary, CLOUDFLARE_IPV4, CLOUDFLARE_IPV6 } from './server/proxy-trust.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.resolve(ROOT, '../..');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
const close = (server) => new Promise((r) => server.close(r));
function rawGet(base, rawPath, headers = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server.mjs mounts the Sentinel after the body parser, inside the shield, with trust proxy by address', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  assert.match(src, /import \{ applySecurity \} from '\.\/security-sentinel\.js'/);
  assert.match(src, /import \{ trustedProxy, proxyTrustSummary \} from '\.\/server\/proxy-trust\.mjs'/);
  assert.match(src, /import \{ shieldProse, PROSE_ROUTE_PREFIXES \} from '\.\/server\/sentinel-shield\.mjs'/);
  const parser = src.indexOf('app.use(express.json(');
  const trust = src.indexOf("app.set('trust proxy', trustedProxy)");
  const mask = src.indexOf('app.use(sentinelShield.mask)');
  const sentinel = src.indexOf('applySecurity(app, {');
  const restore = src.indexOf('app.use(sentinelShield.restore)');
  const firstRoute = src.search(/^app\.(get|post|put|delete)\(/m);
  assert.ok(parser > 0 && trust > parser && mask > trust && sentinel > mask && restore > sentinel && firstRoute > restore,
    `order: parser ${parser}, trust ${trust}, mask ${mask}, sentinel ${sentinel}, restore ${restore}, first route ${firstRoute}`);
  const opts = src.slice(sentinel, src.indexOf('});', sentinel));
  assert.match(opts, /hubUrl: process\.env\.HUB_URL/);
  assert.match(opts, /appId: process\.env\.APP_ID/);
  assert.match(opts, /extraFrameSrc: \['https:\/\/gen-lang-client-0527980301\.firebaseapp\.com'\]/);
  assert.match(opts, /extraScriptSrc: \['https:\/\/zeluslabs\.dev'\]/, 'the hard-coded tracker tag needs its origin whatever HUB_URL says');
  assert.doesNotMatch(opts, /enabled: false/);
  assert.doesNotMatch(src, /app\.set\('trust proxy', (true|\d+)\)/);
});

test('security-sentinel.js and hub-sdk.js are byte copies of the hub dists', (t) => {
  const pairs = [['security-sentinel.js', 'sentinel-dist/security-sentinel.js'], ['hub-sdk.js', 'hub-sdk-dist/hub-sdk.js']];
  const present = pairs.filter(([, hub]) => fs.existsSync(path.join(HUB, hub)));
  // A skip is counted and reported; a return would count as a pass (truth protocol, 3).
  if (present.length === 0) return t.skip('the hub checkout is not beside this one');
  for (const [local, hub] of present) {
    assert.ok(fs.readFileSync(path.join(ROOT, local)).equals(fs.readFileSync(path.join(HUB, hub))), `${local} differs from the hub's ${hub}: change the hub, then copy`);
  }
});

test('the shield covers the document routes and leaves the token routes scanned', () => {
  for (const p of ['/api/email', '/api/journey', '/api/webhooks', '/api/public', '/api/ai', '/api/billing/webhook']) assert.ok(PROSE_ROUTE_PREFIXES.includes(p), p);
  for (const p of ['/api/user', '/api/internal', '/api/discounts', '/u']) assert.ok(!PROSE_ROUTE_PREFIXES.includes(p), p);
  const { covers } = shieldProse(PROSE_ROUTE_PREFIXES);
  assert.equal(covers({ path: '/api/email/send' }), true);
  assert.equal(covers({ path: '/API/Email/send' }), true, 'Express routes case-insensitively, so the shield must too');
  assert.equal(covers({ path: '/api/emails' }), false, 'a prefix covers itself and its children, not a longer name');
  assert.equal(covers({ path: '/api/user/erase' }), false);
  assert.deepEqual(maskStrings({ a: 'x', n: 2, ok: true, list: ['y', { z: 'w' }], nil: null }), { a: '', n: 2, ok: true, list: ['', { z: '' }], nil: null });
});

test('through a real app: a document route keeps its body, a token route is scanned, the URL is scanned everywhere', async () => {
  const app = express();
  app.use(express.json());
  const shield = shieldProse(PROSE_ROUTE_PREFIXES);
  app.use(shield.mask);
  applySecurity(app, { hubUrl: '', appId: '', appName: 'test', extraFrameSrc: ['https://gen-lang-client-0527980301.firebaseapp.com'] });
  app.use(shield.restore);
  app.post('/api/email/echo', (req, res) => res.json({ success: true, got: req.body }));
  app.post('/api/user/echo', (req, res) => res.json({ success: true, got: req.body }));
  app.get('/api/ping', (_req, res) => res.json({ success: true }));
  const { server, base } = await listen(app);
  try {
    const doc = { text: '<script>alert(1)</script>', note: 'CO alarm; cat is in the attic', n: 2 };
    const post = (p) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
    let r = await post('/api/email/echo');
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).got, doc, 'the route sees the original body, not the mask');
    r = await post('/API/Email/echo');
    assert.equal(r.status, 200, 'uppercase spelling reaches the same route and the same shield');
    r = await post('/api/user/echo');
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /Security Sentinel/);
    r = await post('/api/email/echo?q=<script>');
    assert.equal(r.status, 403, 'the query string is scanned on a shielded route too');
    const raw = await rawGet(base, '/api/x/../ping');
    assert.equal(raw.status, 403, 'path traversal in the URL is refused everywhere');
    r = await fetch(base + '/api/ping');
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-src 'self' https:\/\/gen-lang-client-0527980301\.firebaseapp\.com/);
    assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
    r = await fetch(base + '/__sentinel/status');
    assert.equal((await r.json()).success, true);
  } finally {
    await close(server);
  }
});

test('trust proxy by address: the client is what sits left of one Cloudflare hop, forgeries are never reached', async () => {
  const app = express();
  app.set('trust proxy', trustedProxy);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const { server, base } = await listen(app);
  const ipFor = async (xff) => JSON.parse((await rawGet(base, '/ip', xff ? { 'x-forwarded-for': xff } : {})).body).ip;
  try {
    assert.equal(await ipFor(''), '127.0.0.1', 'no header: the socket peer');
    assert.equal(await ipFor('203.0.113.5'), '203.0.113.5', 'a public address beyond the peer is the client');
    assert.equal(await ipFor('203.0.113.5, 104.16.1.1'), '203.0.113.5', 'one Cloudflare edge is walked through');
    assert.equal(await ipFor('203.0.113.5, 2606:4700::1'), '203.0.113.5', 'a Cloudflare v6 edge too');
    assert.equal(await ipFor('198.51.100.9, 203.0.113.5, 104.16.1.1'), '203.0.113.5', 'a forged entry left of the client is never reached');
    assert.equal(await ipFor('127.0.0.1, 104.16.1.1, 104.16.2.2'), '104.16.1.1', 'a Worker chain answers the Worker egress, never the forged loopback');
    assert.equal(await ipFor('203.0.113.5, 10.0.0.7'), '203.0.113.5', 'a private hop is walked through');
    assert.equal(await ipFor('203.0.113.5, 198.51.100.9'), '198.51.100.9', 'an unknown public hop stops the walk');
    process.env.TRUSTED_PROXY_CIDRS = '198.51.100.0/24';
    try {
      assert.equal(await ipFor('203.0.113.5, 198.51.100.9'), '203.0.113.5', 'a TRUSTED_PROXY_CIDRS hop is walked through');
    } finally {
      delete process.env.TRUSTED_PROXY_CIDRS;
    }
    process.env.CLOUDFLARE_EXTRA_CIDRS = '192.0.2.0/24';
    try {
      assert.equal(await ipFor('198.51.100.9, 203.0.113.5, 192.0.2.8'), '203.0.113.5', 'an extra Cloudflare range ends the walk like any Cloudflare hop');
    } finally {
      delete process.env.CLOUDFLARE_EXTRA_CIDRS;
    }
  } finally {
    await close(server);
  }
});

test('the address helpers and the range tables', () => {
  assert.equal(CLOUDFLARE_IPV4.length, 15);
  assert.equal(CLOUDFLARE_IPV6.length, 7);
  assert.equal(isCloudflareAddress('104.16.1.1'), true);
  assert.equal(isCloudflareAddress('2606:4700::1'), true);
  assert.equal(isCloudflareAddress('::ffff:104.16.1.1'), true, 'a mapped v4 is the v4');
  assert.equal(isCloudflareAddress('203.0.113.5'), false);
  assert.equal(isCloudflareAddress('not an address'), false);
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '::', 'fc00::1', 'fe80::1%en0', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '2606:4700::1', '']) assert.equal(isPrivateAddress(a), false, a);
  assert.deepEqual(parseCidrList('bad, 10.0.0.0/8, 1.2.3.4, 10.0.0.0/99'), { cidrs: ['10.0.0.0/8', '1.2.3.4'], rejected: ['bad', '10.0.0.0/99'] });
  const summary = proxyTrustSummary({ TRUSTED_PROXY_CIDRS: 'nope', CLOUDFLARE_EXTRA_CIDRS: '192.0.2.0/24' });
  assert.deepEqual(summary.rejected, ['TRUSTED_PROXY_CIDRS: nope']);
  assert.deepEqual(summary.extraCloudflareCidrs, ['192.0.2.0/24']);
  assert.equal(summary.cloudflareRangesFetched, '2026-09-10');
});
