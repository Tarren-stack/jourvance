// The prose shield the Security Sentinel's own header prescribes.
//
// The Sentinel's virtual-patch middleware scans req.url + req.query + req.body and answers 403
// on an injection shape. That is right for a path or a query string and wrong for a document:
// a pasted email template carries `<script` (email-doc.mjs strips it itself), a journey node
// carries whatever headline a merchant wrote, a Shopify webhook carries a product description,
// and VP-002 fires on a chain token followed by a command verb, so an ordinary note can 403 a
// legitimate save. The header says: mask just those fields for the duration of the scan rather
// than mounting the module in front of the body parser.
//
// Jourvance's prose fields are most of its write surface (the email studio, the journey canvas,
// the page editor, the webhooks, the public lead forms), so the mask is by route prefix: on a
// covered route every STRING in the body is blanked while the Sentinel looks, and the original
// body is put back before the route runs. Numbers, booleans and structure stay visible to the
// scan. The URL and the query string are scanned on every route, covered or not. Routes that
// take no prose (/api/user, /api/discounts, /api/internal, the unsubscribe token) keep the full
// body scan.
const HELD = Symbol('sentinel.shielded-body');

/** A deep copy of `value` with every string blanked. Arrays and plain objects are walked. */
export function maskStrings(value) {
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) return value.map(maskStrings);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskStrings(v);
    return out;
  }
  return value;
}

/**
 * `{ mask, restore, covers }` for a list of path prefixes. Mount `mask` before applySecurity and
 * `restore` right after it. A prefix covers itself and everything under it, compared on the
 * lowercased path with the query removed, because Express routing is case-insensitive and the
 * Sentinel lowercases for the same reason.
 */
export function shieldProse(prefixes) {
  const list = (Array.isArray(prefixes) ? prefixes : []).map((p) => String(p || '').trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean);
  const covers = (req) => {
    const p = String(req.path || (req.url || '').split('?')[0] || '').toLowerCase();
    return list.some((pre) => p === pre || p.startsWith(pre + '/'));
  };
  const mask = (req, _res, next) => {
    if (req.body && typeof req.body === 'object' && covers(req)) {
      req[HELD] = req.body;
      req.body = maskStrings(req.body);
    }
    next();
  };
  const restore = (req, _res, next) => {
    if (req[HELD] !== undefined) {
      req.body = req[HELD];
      delete req[HELD];
    }
    next();
  };
  return { mask, restore, covers, prefixes: list };
}

/** The route prefixes whose bodies are documents or prose. Exported so a test can pin the list. */
export const PROSE_ROUTE_PREFIXES = Object.freeze([
  '/api/email', '/api/journey', '/api/workspace', '/api/workspaces', '/api/templates', '/api/drips',
  '/api/ai', '/api/webhooks', '/api/billing/webhook', '/api/klaviyo', '/api/funnel', '/api/reviews',
  '/api/public', '/api/sms'
]);
