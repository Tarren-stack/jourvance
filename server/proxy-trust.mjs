// The `trust proxy` function for Express: `(address, hopIndex) => boolean`, hop 0 being the
// socket peer. A port of the hub's `platform-kit/proxy-trust.ts` rule for a plain .mjs spoke,
// kept to the same shape so a fix there is a fix here. The rule:
//
//   - the socket peer (Render's load balancer, or loopback) is trusted by index;
//   - beyond it a hop is trusted by ADDRESS only: loopback and private ranges, an operator
//     range in TRUSTED_PROXY_CIDRS, and AT MOST ONE Cloudflare hop (the published tables plus
//     CLOUDFLARE_EXTRA_CIDRS), which ENDS the walk: whatever sits to its left is the client.
//
// Why by address and never by count: every Render service answers through Cloudflare, so a
// count of 1 made `req.ip` the Cloudflare edge node (every visitor through that edge shared one
// rate bucket), and a count of 2 trusted a forged entry on a request that skipped Cloudflare.
// Why one hop: a Cloudflare Worker on a free account arrives from an egress inside the published
// ranges carrying an X-Forwarded-For its author wrote, so walking every Cloudflare hop handed
// the forgery to `req.ip`, a new address per request past every per-IP limiter.
//
// Jourvance did not set `trust proxy` at all before the Security Sentinel was mounted. Without
// it `req.ip` is the load balancer for everyone, and the Sentinel's per-IP rate limit would
// have been one bucket for the whole site.
//
// Cloudflare ranges: https://www.cloudflare.com/ips/ as the hub fetched them on
// CLOUDFLARE_RANGES_FETCHED. A newer range goes in CLOUDFLARE_EXTRA_CIDRS (same one-hop latch),
// never in TRUSTED_PROXY_CIDRS (walked without ending the walk, which reopens the forgery).
import net from 'node:net';

export const TRUSTED_PROXY_CIDRS_VAR = 'TRUSTED_PROXY_CIDRS';
export const CLOUDFLARE_EXTRA_CIDRS_VAR = 'CLOUDFLARE_EXTRA_CIDRS';
export const CLOUDFLARE_IPV4 = Object.freeze([
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
]);
export const CLOUDFLARE_IPV6 = Object.freeze([
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
]);
export const CLOUDFLARE_RANGES_FETCHED = '2026-09-10';

/** An IP literal as node:net wants it, with a mapped v4 (`::ffff:1.2.3.4`) folded to v4. */
function normalize(addr) {
  const raw = String(addr || '').trim().replace(/%.*$/, '');
  if (!raw) return null;
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && net.isIPv4(mapped[1])) return { ip: mapped[1], family: 'ipv4' };
  if (net.isIPv4(raw)) return { ip: raw, family: 'ipv4' };
  if (net.isIPv6(raw)) return { ip: raw, family: 'ipv6' };
  return null;
}

/** Parse one CIDR; null when it is not one. A bare address is a /32 or /128. */
function parseCidr(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const [host, bits] = raw.split('/');
  const n = normalize(host);
  if (!n) return null;
  const max = n.family === 'ipv4' ? 32 : 128;
  if (bits === undefined) return { ip: n.ip, prefix: max, family: n.family };
  if (!/^\d{1,3}$/.test(bits)) return null;
  const prefix = Number(bits);
  if (prefix < 0 || prefix > max) return null;
  return { ip: n.ip, prefix, family: n.family };
}

function buildList(cidrs) {
  const list = new net.BlockList();
  const rejected = [];
  for (const entry of cidrs) {
    const c = parseCidr(entry);
    if (!c) { rejected.push(String(entry).trim()); continue; }
    list.addSubnet(c.ip, c.prefix, c.family);
  }
  return { list, rejected };
}

const cloudflare = buildList([...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6]).list;
// Loopback, RFC1918, link-local and the unspecified address, both families. The same set the
// hub's `isPrivateHost` names for an IP literal.
const privateRanges = buildList([
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '0.0.0.0/8',
  '::1/128', '::/128', 'fc00::/7', 'fe80::/10'
]).list;

/** Split a comma separated CIDR variable; `rejected` names every entry that was not a CIDR. */
export function parseCidrList(raw) {
  const entries = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  const { rejected } = buildList(entries);
  return { cidrs: entries.filter((e) => !rejected.includes(e)), rejected };
}

/** One BlockList per variable, rebuilt whenever the variable's value changes. */
const envLists = new Map();
function envList(name) {
  const raw = process.env[name];
  const cached = envLists.get(name);
  if (cached && cached.raw === raw) return cached.list;
  const list = buildList(parseCidrList(raw).cidrs).list;
  envLists.set(name, { list, raw });
  return list;
}

function inCloudflare(n) {
  return cloudflare.check(n.ip, n.family) || envList(CLOUDFLARE_EXTRA_CIDRS_VAR).check(n.ip, n.family);
}

/** True when `addr` is a Cloudflare address (the published tables or CLOUDFLARE_EXTRA_CIDRS). */
export function isCloudflareAddress(addr) {
  const n = normalize(addr);
  return !!n && inCloudflare(n);
}

/** True for loopback, private, link-local and unspecified literals. Not an address: false. */
export function isPrivateAddress(addr) {
  const n = normalize(addr);
  return !!n && privateRanges.check(n.ip, n.family);
}

// Per-walk state for the one-Cloudflare-hop rule. Express hands the trust function only
// `(address, hop)` and proxy-addr calls it synchronously in hop order from 0, stopping at the
// first false, so no other request can run between two calls of one walk. A walk is new
// whenever `hop <= lastHop`, not only at hop 0: `req.protocol` calls hop 0 alone.
let cloudflareSeen = false;
let lastHop = -1;

export function trustedProxy(addr, hop) {
  if (hop <= lastHop) cloudflareSeen = false; // a new walk
  lastHop = hop;
  if (hop === 0) return true;
  if (cloudflareSeen) return false; // at most one Cloudflare hop: this entry is the client
  const n = normalize(addr);
  if (!n) return false;
  if (inCloudflare(n)) {
    cloudflareSeen = true;
    return true;
  }
  if (privateRanges.check(n.ip, n.family)) return true;
  return envList(TRUSTED_PROXY_CIDRS_VAR).check(n.ip, n.family);
}

/** What the boot log says about the rule, with every rejected CIDR named. */
export function proxyTrustSummary(env = process.env) {
  const trusted = parseCidrList(env[TRUSTED_PROXY_CIDRS_VAR]);
  const extraCf = parseCidrList(env[CLOUDFLARE_EXTRA_CIDRS_VAR]);
  return {
    cloudflareRangesFetched: CLOUDFLARE_RANGES_FETCHED,
    trustedCidrs: trusted.cidrs,
    extraCloudflareCidrs: extraCf.cidrs,
    rejected: [...trusted.rejected.map((e) => `${TRUSTED_PROXY_CIDRS_VAR}: ${e}`), ...extraCf.rejected.map((e) => `${CLOUDFLARE_EXTRA_CIDRS_VAR}: ${e}`)]
  };
}
