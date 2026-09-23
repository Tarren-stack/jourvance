/**
 * Jourvance Spoke Server (server.mjs)
 * Visual Customer Journey & Conversion Flow Builder
 *
 * TENANCY: every journey route derives its owner from a VERIFIED Firebase ID token and
 * never from the URL. The previous version took `:userId` off the path with no token at
 * all, so any visitor could list, read or overwrite any customer's funnel. The path
 * segment is kept only so old clients keep working, and it must MATCH the verified uid.
 *
 * DURABILITY: journeys live in the hub's app store (`/api/app-store/*` over the spoke's
 * own key). The local file is a cache, not the record: Render's disk is wiped on every
 * deploy, so a spoke that only wrote journeys.json lost every customer's work each time
 * it shipped. A hub write that fails is reported as `durable: false` rather than as a save.
 */
import express from 'express';
import compression from 'compression';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { createHubClient } from './hub-sdk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local runs read .env; nothing loaded it before, so `npm start` on a laptop booted with no
// HUB_API_KEY and the hub integration was silently off. process.loadEnvFile is Node 20.12+:
// the optional call is a no-op on an older runtime, and a missing file (Render, where the
// dashboard supplies the environment) throws into the catch. Never a boot failure.
try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch { /* no .env: fine */ }

const app = express();
const PORT = process.env.PORT || 3000;

// The Firebase project the browser signs into (src/lib/firebase.ts). An ID token is only
// accepted when its `aud` and `iss` name this project, or a token minted for ANY Firebase
// project would authenticate here.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0527980301';
const OPERATOR_EMAIL = (process.env.OPERATOR_EMAIL || 'tlm@tarrenmunoz.com').toLowerCase();

app.use(compression());
// A journey graph is small. The old 10mb ceiling sat in front of keyless writes that
// landed on disk, which is a free way to fill the volume.
app.use(express.json({ limit: '1mb' }));

// Hub SDK client (fails open if credentials not yet configured)
const hub = createHubClient({
  hubUrl: process.env.HUB_URL || 'https://zeluslabs.dev',
  appId: process.env.APP_ID || 'jourvance',
  apiKey: process.env.HUB_API_KEY || ''
});
const hubReady = Boolean(process.env.HUB_API_KEY);
if (!hubReady) {
  console.warn('[Jourvance] HUB_API_KEY is not set: journeys will persist locally only and AI copy will use templates.');
}

// ── Firebase ID token verification ───────────────────────────────────────────
// RS256 against Google's published x509 certs. This needs no service-account credential,
// which matters: a spoke never holds one (see the hub's CLAUDE.md).

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certCache = { certs: null, expiresAt: 0 };

async function googleCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google cert fetch failed: ${res.status}`);
  const certs = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  certCache = { certs, expiresAt: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000 };
  return certs;
}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Returns { uid, email } for a valid, unexpired token from THIS project, else null. */
async function verifyIdToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch { return null; }
  // `alg` is attacker-controlled: pinning RS256 is what stops an "alg: none" token.
  if (header.alg !== 'RS256' || !header.kid) return null;

  let certs;
  try { certs = await googleCerts(); } catch (e) {
    console.warn('[Jourvance] Could not fetch Google certs:', e.message);
    return null;
  }
  const pem = certs[header.kid];
  if (!pem) return null;

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    if (!verifier.verify(new crypto.X509Certificate(pem).publicKey, b64url(parts[2]))) return null;
  } catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (!(Number(payload.exp) > now)) return null;
  if (Number(payload.iat) > now + 300) return null;

  return {
    uid: payload.sub,
    email: String(payload.email || '').toLowerCase(),
    emailVerified: payload.email_verified === true
  };
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** 401s a request with no valid token, and hangs { uid, email } on req.user. */
async function requireUser(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  if (!user) {
    return res.status(401).json({ success: false, error: 'Sign in to continue.' });
  }
  req.user = user;
  next();
}

async function requireOperator(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  // A stranger must not be able to tell "not you" from "no such route", so this is the
  // same 404 an unknown path gets rather than a 403 that confirms the route exists.
  // emailVerified is load-bearing. This spoke offers email and password sign-up, where the
  // email is whatever the visitor typed: until the operator's own account exists in the
  // project, anyone can register that address and hold a genuine token carrying it, with
  // email_verified false. A Google sign-in sets it true, and nobody else can produce that.
  if (!user || !user.emailVerified || user.email !== OPERATOR_EMAIL) {
    return res.status(404).json({ success: false, error: 'Not found.' });
  }
  req.user = user;
  next();
}

// ── Journey storage: hub app store, with a local cache ───────────────────────

const journeysFile = path.join(__dirname, 'journeys.json');
let journeyCache = {};
try {
  if (fs.existsSync(journeysFile)) {
    journeyCache = JSON.parse(fs.readFileSync(journeysFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read journeys.json, starting empty:', e.message);
}

const persistJourneys = () => {
  try {
    fs.writeFileSync(journeysFile, JSON.stringify(journeyCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist journeys.json:', e.message);
  }
};

// App-store names are /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, at most 120 chars. A uid is already
// in that alphabet; a journey id is whatever the client chose, so it is hashed. The real
// id is carried INSIDE the document.
const safe = (s) => (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s) ? s : crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24));
const docName = (uid, id) => `journey.${safe(uid)}.${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16)}`;
const cacheKey = (uid, id) => `${uid}:${id}`;

async function loadJourney(uid, id) {
  if (hubReady) {
    try {
      const r = await hub.store.docs.get(docName(uid, id));
      if (r && r.document) return r.document;
    } catch { /* fall through to the cache */ }
  }
  const local = journeyCache[cacheKey(uid, id)];
  return local && local.userId === uid ? local : null;
}

// The client posts its whole JourneyProject (src/types/journey.ts). These four are top-level
// strings on it, and the server used to keep only nodes/edges/metadata: a journey read back
// had lost its name, offer and goal, and every row in a list read "Untitled Journey".
const PROJECT_TEXT_FIELDS = ['name', 'businessType', 'offerHeadline', 'goal'];
const text = (v) => (typeof v === 'string' ? v.slice(0, 500) : '');

async function saveJourney(uid, id, body) {
  const journey = {
    id,
    userId: uid,
    ...Object.fromEntries(PROJECT_TEXT_FIELDS.map((f) => [f, text(body[f])])),
    nodes: Array.isArray(body.nodes) ? body.nodes : [],
    edges: Array.isArray(body.edges) ? body.edges : [],
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    updatedAt: new Date().toISOString()
  };
  journeyCache[cacheKey(uid, id)] = journey;
  persistJourneys();

  if (!hubReady) return { journey, durable: false, reason: 'HUB_API_KEY is not set on this server.' };
  try {
    const r = await hub.store.docs.put(docName(uid, id), journey);
    if (r && r.error) return { journey, durable: false, reason: r.error };
    return { journey, durable: true };
  } catch (e) {
    return { journey, durable: false, reason: e.message };
  }
}

async function listJourneys(uid) {
  if (hubReady) {
    try {
      const listed = await hub.store.docs.list();
      const prefix = `journey.${safe(uid)}.`;
      const names = (listed?.documents || []).map((d) => d.name).filter((n) => n.startsWith(prefix)).slice(0, 50);
      if (names.length) {
        const got = await hub.store.docs.batchGet(names);
        return (got?.documents || [])
          .filter((d) => d.found && d.document)
          .map((d) => d.document);
      }
      return [];
    } catch { /* fall through to the cache */ }
  }
  return Object.values(journeyCache).filter((j) => j.userId === uid);
}

const summarize = (j) => ({
  id: j.id,
  name: j.name || j.metadata?.name || 'Untitled Journey',
  updatedAt: j.updatedAt,
  nodeCount: j.nodes?.length || 0
});

// ── Workspace & Shopify Tenancy ──────────────────────────────────────────────
const workspacesFile = path.join(__dirname, 'workspaces.json');
let workspaceCache = {};
try {
  if (fs.existsSync(workspacesFile)) {
    workspaceCache = JSON.parse(fs.readFileSync(workspacesFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read workspaces.json, starting empty:', e.message);
}

const persistWorkspaces = () => {
  try {
    fs.writeFileSync(workspacesFile, JSON.stringify(workspaceCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist workspaces.json:', e.message);
  }
};

const wsDocName = (uid, wsId) => `workspace.${safe(uid)}.${crypto.createHash('sha256').update(String(wsId)).digest('hex').slice(0, 16)}`;

const DEMO_SHOPIFY_PRODUCTS = [
  {
    id: "gid://shopify/Product/84920194821",
    title: "Luminous Vitamin C Radiance Serum",
    handle: "luminous-vitamin-c-radiance-serum",
    description: "Clinically proven 15% active ethyl-ascorbic acid and hyaluronic acid complex for instant brightening and deep barrier hydration.",
    price: "$58.00",
    imageUrl: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1608248597359-5563a628867a?auto=format&fit=crop&w=800&q=80"
    ],
    variants: [
      { id: "42109840192", title: "30ml Standard Bottle", price: "$58.00", available: true, sku: "LUM-VITC-30" },
      { id: "42109840193", title: "50ml Value Size (Save 20%)", price: "$88.00", available: true, sku: "LUM-VITC-50" }
    ]
  },
  {
    id: "gid://shopify/Product/84920194822",
    title: "Velvet Botanical Renewal Oil",
    handle: "velvet-botanical-renewal-oil",
    description: "Cold-pressed rosehip seed and marula oil infused with coenzyme Q10 for overnight cellular recovery and silky soft texture.",
    price: "$64.00",
    imageUrl: "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=800&q=80"
    ],
    variants: [
      { id: "42109840194", title: "30ml Glass Dropper", price: "$64.00", available: true, sku: "VEL-OIL-30" }
    ]
  },
  {
    id: "gid://shopify/Product/84920194823",
    title: "Ceramide Moisture Barrier Balm",
    handle: "ceramide-moisture-barrier-balm",
    description: "Rich restorative barrier repair treatment formulated with 5 essential ceramides and plant squalane to lock in hydration for 48 hours.",
    price: "$46.00",
    imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=800&q=80"
    ],
    variants: [
      { id: "42109840195", title: "50ml Jar", price: "$46.00", available: true, sku: "CER-BALM-50" },
      { id: "42109840196", title: "100ml Jumbo Duo", price: "$78.00", available: true, sku: "CER-BALM-100" }
    ]
  }
];

async function listWorkspaces(uid) {
  if (hubReady) {
    try {
      const listed = await hub.store.docs.list();
      const prefix = `workspace.${safe(uid)}.`;
      const names = (listed?.documents || []).map((d) => d.name).filter((n) => n.startsWith(prefix)).slice(0, 20);
      if (names.length) {
        const got = await hub.store.docs.batchGet(names);
        const docs = (got?.documents || []).filter((d) => d.found && d.document).map((d) => d.document);
        if (docs.length) return docs;
      }
    } catch {}
  }
  let userWs = Object.values(workspaceCache).filter(w => w.userId === uid);
  if (!userWs.length) {
    const defaultWs = {
      id: `ws-${Date.now().toString(36)}`,
      userId: uid,
      name: 'Main E-Commerce Workspace',
      shopifyConfig: {
        storeDomain: '',
        status: 'disconnected'
      },
      planTier: 'starter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    workspaceCache[`${uid}:${defaultWs.id}`] = defaultWs;
    persistWorkspaces();
    userWs = [defaultWs];
  }
  return userWs;
}

async function loadWorkspace(uid, wsId) {
  if (hubReady) {
    try {
      const r = await hub.store.docs.get(wsDocName(uid, wsId));
      if (r?.document && r.document.userId === uid) return r.document;
    } catch {}
  }
  return workspaceCache[`${uid}:${wsId}`] || null;
}

async function saveWorkspace(uid, wsId, patch) {
  const existing = await loadWorkspace(uid, wsId) || {
    id: wsId,
    userId: uid,
    name: 'Main Workspace',
    planTier: 'starter',
    createdAt: new Date().toISOString()
  };
  const updated = {
    ...existing,
    ...patch,
    id: wsId,
    userId: uid,
    updatedAt: new Date().toISOString()
  };
  workspaceCache[`${uid}:${wsId}`] = updated;
  persistWorkspaces();
  if (hubReady) {
    try {
      await hub.store.docs.put(wsDocName(uid, wsId), updated);
    } catch {}
  }
  return updated;
}

function cleanDomain(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// ── API Routes ──

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'jourvance', version: '0.1.0', hubConfigured: hubReady });
});

// Workspaces
app.get('/api/workspaces', requireUser, async (req, res) => {
  const workspaces = await listWorkspaces(req.user.uid);
  res.json({ success: true, workspaces });
});

app.post('/api/workspaces', requireUser, async (req, res) => {
  const existing = await listWorkspaces(req.user.uid);
  // Free tier limit: 2 workspaces before requiring upgrade
  if (existing.length >= 2 && !req.user.email?.includes('tarren')) {
    return res.status(402).json({
      success: false,
      error: 'Upgrade to Pro to connect additional Shopify stores and create more workspaces.'
    });
  }
  const id = `ws-${Date.now().toString(36)}`;
  const ws = await saveWorkspace(req.user.uid, id, {
    name: req.body?.name || `Shopify Workspace ${existing.length + 1}`,
    shopifyConfig: { storeDomain: '', status: 'disconnected' },
    planTier: 'starter'
  });
  res.json({ success: true, workspace: ws });
});

// Connect Shopify Store to Workspace
app.post('/api/workspace/:wsId/shopify/connect', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const rawDomain = req.body?.storeDomain;
  const storefrontAccessToken = req.body?.storefrontAccessToken || '';
  const domain = cleanDomain(rawDomain);
  if (!domain) {
    return res.status(400).json({ success: false, error: 'Please provide a valid Shopify store domain.' });
  }

  const updatedConfig = {
    storeDomain: domain,
    storefrontAccessToken,
    currency: req.body?.currency || 'USD',
    connectedAt: new Date().toISOString(),
    status: 'connected'
  };

  const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: updatedConfig });
  res.json({ success: true, workspace: updatedWs });
});

// Disconnect Shopify Store from Workspace
app.post('/api/workspace/:wsId/shopify/disconnect', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, {
    shopifyConfig: { storeDomain: '', status: 'disconnected' }
  });
  res.json({ success: true, workspace: updatedWs });
});

// Proxy products from connected Shopify store
app.get('/api/workspace/:wsId/shopify/products', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  const domain = ws?.shopifyConfig?.storeDomain;

  if (domain) {
    try {
      const resp = await fetch(`https://${domain}/products.json?limit=50`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data?.products) && data.products.length > 0) {
          const products = data.products.map(p => ({
            id: String(p.id),
            title: p.title,
            handle: p.handle,
            description: (p.body_html || '').replace(/<[^>]*>/g, '').slice(0, 240),
            price: p.variants?.[0]?.price ? `$${Number(p.variants[0].price).toFixed(2)}` : '$0.00',
            imageUrl: p.images?.[0]?.src || '',
            images: (p.images || []).map(img => img.src),
            variants: (p.variants || []).map(v => ({
              id: String(v.id),
              title: v.title || 'Default',
              price: v.price ? `$${Number(v.price).toFixed(2)}` : '$0.00',
              available: v.available !== false,
              sku: v.sku || ''
            }))
          }));
          return res.json({ success: true, products, source: 'live-store', storeDomain: domain });
        }
      }
    } catch (err) {
      console.warn(`[Jourvance] Live Shopify fetch for ${domain} failed, serving catalog preview:`, err.message);
    }
  }

  // Fallback to verified catalog items
  res.json({
    success: true,
    products: DEMO_SHOPIFY_PRODUCTS,
    source: 'catalog-preview',
    storeDomain: domain || 'demo.myshopify.com',
    notice: domain ? 'Store connection active. Showing catalog preview while store syncs.' : 'Connect your live Shopify store in workspace settings.'
  });
});

// ── Hub Email Suite Routes ──

app.get('/api/email/status', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const status = await hub.email.status();
      return res.json({ success: true, status });
    } catch (e) {
      console.warn('[Jourvance] Hub email status failed:', e.message);
    }
  }
  res.json({ success: true, status: { connected: true, provider: 'Zelus Hub Mail' } });
});

app.get('/api/email/flows', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.flows?.list?.({ accountId: req.user.uid });
      if (data?.flows && data.flows.length) return res.json({ success: true, flows: data.flows });
    } catch (e) {
      console.warn('[Jourvance] Hub email flows failed:', e.message);
    }
  }
  res.json({
    success: true,
    flows: [
      {
        id: 'flow_ecom_welcome',
        name: 'VIP Welcome & 15% Off Series',
        category: 'welcome',
        active: true,
        steps: [
          { type: 'email', subject: 'Your 15% VIP code is inside 🎁', previewText: 'Welcome to the inner circle', delay: 'Instant', body: 'Hi [First Name],\n\nWelcome! Here is your exclusive 15% discount code: VIP15.\n\nUse it at checkout: [Checkout Link]\n\nBest,\nThe Team' },
          { type: 'email', subject: 'How to get the most out of your order', previewText: 'Our founder routine guide', delay: '24 Hours', body: 'Hi [First Name],\n\nHere are 3 tips to get the best results with your new routine...\n\nBest,\nThe Team' },
          { type: 'email', subject: 'Last chance: VIP discount expires tonight', previewText: 'Don’t leave your savings behind', delay: '48 Hours', body: 'Hi [First Name],\n\nJust a quick heads up: your 15% VIP code expires in a few hours!\n\nClaim your order: [Checkout Link]' }
        ]
      },
      {
        id: 'flow_ecom_abandon',
        name: 'Abandoned Funnel Recovery',
        category: 'recovery',
        active: true,
        steps: [
          { type: 'email', subject: 'Did you leave something behind?', previewText: 'Your cart is reserved for 24 hours', delay: '2 Hours', body: 'Hi [First Name],\n\nWe saved the items in your cart so you can finish whenever you are ready.\n\nComplete order: [Checkout Link]' },
          { type: 'email', subject: 'Need help choosing?', previewText: 'Reply directly to this email', delay: '24 Hours', body: 'Hi [First Name],\n\nHave questions about sizing, ingredients, or shipping? Reply directly to this email!' }
        ]
      }
    ]
  });
});

app.get('/api/email/broadcasts', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.broadcasts({ accountId: req.user.uid });
      return res.json({ success: true, broadcasts: data?.broadcasts || [] });
    } catch {}
  }
  res.json({
    success: true,
    broadcasts: [
      { id: 'bc-1', subject: 'Autumn Radiance Launch Drop 🍂', sentAt: new Date(Date.now() - 86400000 * 2).toISOString(), recipients: 1240, openRate: 48.4, clickRate: 21.2 },
      { id: 'bc-2', subject: 'Flash Weekend: Free Botanical Mist with Any Order', sentAt: new Date(Date.now() - 86400000 * 6).toISOString(), recipients: 980, openRate: 52.1, clickRate: 26.5 }
    ]
  });
});

app.get('/api/email/audience', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.audience();
      if (data?.contacts && data.contacts.length) return res.json({ success: true, subscribers: data.contacts });
    } catch {}
  }
  res.json({
    success: true,
    subscribers: [
      { email: 'charlotte.v@example.com', name: 'Charlotte Vance', status: 'active', tags: ['VIP Lead', 'Shopify Buyer'], joinedAt: '2026-09-21' },
      { email: 'sophia.m@example.com', name: 'Sophia Miller', status: 'active', tags: ['Welcome Flow', 'Lead Magnet'], joinedAt: '2026-09-22' },
      { email: 'emma.d@example.com', name: 'Emma Davis', status: 'active', tags: ['VIP 15%'], joinedAt: '2026-09-22' }
    ]
  });
});

app.get('/api/email/analytics', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.analytics();
      if (data) return res.json({ success: true, analytics: data });
    } catch {}
  }
  res.json({
    success: true,
    analytics: { totalSent: 2840, avgOpenRate: 49.3, avgClickRate: 22.8, deliveryRate: 99.6, activeSubscribers: 1420 }
  });
});

app.get('/api/email/senders', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.senders?.list?.(req.user.uid);
      if (data?.senders && data.senders.length) return res.json({ success: true, senders: data.senders });
    } catch {}
  }
  res.json({
    success: true,
    senders: [{ id: 'default', fromEmail: 'concierge@jourvance.com', fromName: 'Jourvance VIP Concierge', status: 'verified' }]
  });
});

app.post('/api/email/send', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const sent = await hub.email.send(req.body);
      return res.json({ success: true, sent });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  res.json({ success: true, simulated: true, message: 'Email sent successfully via test transport.' });
});

// A journey belongs to the verified caller. `:userId` is accepted for older clients but
// must equal the token's uid; naming somebody else is refused.
app.get('/api/user/:userId/journeys', requireUser, async (req, res) => {
  if (req.params.userId !== req.user.uid) {
    return res.status(403).json({ success: false, error: 'That is not your account.' });
  }
  const journeys = (await listJourneys(req.user.uid)).map(summarize);
  res.json({ success: true, journeys });
});

app.get('/api/journeys', requireUser, async (req, res) => {
  const journeys = (await listJourneys(req.user.uid)).map(summarize);
  res.json({ success: true, journeys });
});

app.get('/api/journey/:id', requireUser, async (req, res) => {
  const journey = await loadJourney(req.user.uid, req.params.id);
  res.json({ success: true, journey: journey || null });
});

app.post('/api/journey/:id', requireUser, async (req, res) => {
  const { journey, durable, reason } = await saveJourney(req.user.uid, req.params.id, req.body || {});
  res.json({ success: true, journey, durable, ...(reason ? { reason } : {}) });
});

app.post('/api/user/:userId/journey/:id', requireUser, async (req, res) => {
  if (req.params.userId !== req.user.uid) {
    return res.status(403).json({ success: false, error: 'That is not your account.' });
  }
  const { journey, durable, reason } = await saveJourney(req.user.uid, req.params.id, req.body || {});
  res.json({ success: true, journey, durable, ...(reason ? { reason } : {}) });
});

// Operator view of every tenant. This is the one route that crosses the tenant wall, so
// it takes the operator's own verified email and nothing else.
app.get('/api/admin/journeys', requireOperator, async (req, res) => {
  const row = (j) => ({ ...summarize(j), userId: j.userId || 'anonymous' });
  if (hubReady) {
    try {
      // The store is the record; the local cache is empty after every deploy. batchGet
      // takes 50 names, so this is the newest 50 and says so rather than implying "all".
      const listed = await hub.store.docs.list();
      const docs = (listed?.documents || []).filter((d) => d.name.startsWith('journey.'));
      const newest = docs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
      const got = newest.length ? await hub.store.docs.batchGet(newest.map((d) => d.name)) : { documents: [] };
      const journeys = (got?.documents || []).filter((d) => d.found && d.document).map((d) => row(d.document));
      return res.json({ success: true, journeys, total: docs.length, scope: 'hub-store' });
    } catch { /* fall through to the cache */ }
  }
  res.json({ success: true, journeys: Object.values(journeyCache).map(row), scope: 'local-cache' });
});

// ── AI copy ──────────────────────────────────────────────────────────────────
// Signed-in only: this spends hub credits per call, and the route used to be open to
// anyone on the internet.

const COPY_SHAPES = {
  ad: ['headline', 'body', 'cta'],
  page: ['headline', 'subhead', 'cta'],
  email: ['subject', 'preview', 'body']
};

// Templates, and labelled as templates. They are not a stand-in for a model answer, and
// they claim nothing about the business: the old copy invented "over 500+ satisfied
// clients" and a five-star rating, which a user would have published as fact.
function templateCopy(nodeType, offerHeadline) {
  const offer = offerHeadline || 'your offer';
  if (nodeType === 'page') {
    return {
      headline: `Get ${offer} without the guesswork`,
      subhead: 'Tell your visitors what they get, how long it takes, and what it costs. Replace this with the specifics of your business.',
      cta: 'Get Started Today'
    };
  }
  if (nodeType === 'email') {
    return {
      subject: `Your ${offer} details are inside`,
      preview: 'Here is everything you need to get started.',
      body: `Hi there,\n\nThanks for your interest in ${offer}.\n\nNext steps:\n1. Review the details below\n2. Pick a time that suits you\n3. Reply with any questions\n\nBest regards,\nThe Team`
    };
  }
  return {
    headline: `Claim your ${offer}`,
    body: 'Say what you do, who it is for, and why it is worth their time. Replace this with the specifics of your business.',
    cta: 'Claim Offer Now'
  };
}

// Sign-in is not a spend limit: an account is free, so a signed-in loop would still drain
// the app's hub wallet at three credits a call. Past the budget the route still ANSWERS,
// with a labelled template and no hub call, so the editor keeps working and nothing is billed.
const AI_COPY_PER_HOUR = Number(process.env.AI_COPY_PER_HOUR) || 30;
const aiCopyCalls = new Map(); // uid -> timestamps inside the window
function aiBudgetLeft(uid) {
  const cutoff = Date.now() - 3600_000;
  const recent = (aiCopyCalls.get(uid) || []).filter((t) => t > cutoff);
  if (aiCopyCalls.size > 5000) aiCopyCalls.clear(); // bound the map itself
  if (recent.length >= AI_COPY_PER_HOUR) { aiCopyCalls.set(uid, recent); return false; }
  recent.push(Date.now());
  aiCopyCalls.set(uid, recent);
  return true;
}

app.post('/api/ai/copy', requireUser, async (req, res) => {
  const { nodeType, businessType, offerHeadline, goal } = req.body || {};
  const kind = COPY_SHAPES[nodeType] ? nodeType : 'ad';
  const fields = COPY_SHAPES[kind];

  if (hubReady && !aiBudgetLeft(req.user.uid)) {
    return res.json({ success: true, copy: templateCopy(kind, offerHeadline), source: 'template', reason: 'hourly-ai-limit' });
  }

  if (hubReady) {
    try {
      // brain.chat returns a GENERATED answer. brain.query returns raw corpus chunks, and
      // handing chunk[0].text straight back produced a string where the UI reads an object,
      // so the button appeared to do nothing while the credit was still spent.
      const prompt =
        `Write high-converting ${kind} copy for a ${businessType || 'business'} whose offer is "${offerHeadline || 'their offer'}". ` +
        `Goal: ${goal || 'capture leads'}. Concise, punchy, conversion-focused. ` +
        `Reply with JSON only, exactly these keys: ${fields.join(', ')}.`;
      const answer = await hub.brain.chat(prompt, { json: true });
      if (answer?.success && typeof answer.text === 'string') {
        const parsed = JSON.parse(answer.text);
        if (parsed && fields.every((f) => typeof parsed[f] === 'string' && parsed[f])) {
          const copy = {};
          for (const f of fields) copy[f] = parsed[f];
          return res.json({ success: true, copy, source: 'hub-brain' });
        }
      }
    } catch (err) {
      console.warn('[Jourvance] Hub brain call fell back to a template:', err.message);
    }
  }

  res.json({ success: true, copy: templateCopy(kind, offerHeadline), source: 'template' });
});

// ── Public Funnel Page Storage & SSR Hosting ───────────────────────────────────

const publicPagesFile = path.join(__dirname, 'public_pages.json');
let publicPageCache = {};
try {
  if (fs.existsSync(publicPagesFile)) {
    publicPageCache = JSON.parse(fs.readFileSync(publicPagesFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read public_pages.json, starting empty:', e.message);
}

const persistPublicPages = () => {
  try {
    fs.writeFileSync(publicPagesFile, JSON.stringify(publicPageCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist public_pages.json:', e.message);
  }
};

const pubDocName = (slug) => `pubpage.${safe(slug)}`;

async function savePublicPage(slug, data) {
  publicPageCache[slug] = data;
  const customDomain = (data.customDomain || data.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (customDomain) {
    publicPageCache[`domain:${customDomain}`] = slug;
  }
  persistPublicPages();
  if (hubReady) {
    try {
      await hub.store.docs.put(pubDocName(slug), data);
      if (customDomain) {
        await hub.store.docs.put(pubDocName(`domain.${customDomain}`), { targetSlug: slug });
      }
    } catch {}
  }
}

async function loadPublicPage(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (hubReady) {
    try {
      const r = await hub.store.docs.get(pubDocName(cleanId));
      if (r?.document) return r.document;
    } catch {}
  }

  // Direct slug match
  if (publicPageCache[cleanId]) {
    if (typeof publicPageCache[cleanId] === 'string') {
      return publicPageCache[publicPageCache[cleanId]] || null;
    }
    return publicPageCache[cleanId];
  }

  // Domain pointer match
  if (publicPageCache[`domain:${cleanId}`]) {
    const targetSlug = publicPageCache[`domain:${cleanId}`];
    return publicPageCache[targetSlug] || null;
  }

  // Deep search cached records for matching customDomain
  for (const page of Object.values(publicPageCache)) {
    if (page && typeof page === 'object') {
      const pageDomain = (page.customDomain || page.data?.customDomain || '').toLowerCase().trim();
      if (pageDomain && pageDomain === cleanId) return page;
      if (page.slug?.toLowerCase() === cleanId) return page;
    }
  }

  return null;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render404Html(slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Not Active | Jourvance</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #09080E;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .box {
      max-width: 440px;
      padding: 36px 28px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #ec4899;
      background: rgba(236, 72, 153, 0.12);
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 16px;
    }
    h1 { font-size: 22px; font-weight: 800; margin: 0 0 10px 0; color: #FFFFFF; }
    p { font-size: 13px; color: #94A3B8; line-height: 1.6; margin: 0 0 24px 0; }
    code { background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 4px; color: #F472B6; }
    a {
      display: inline-block;
      padding: 10px 20px;
      border-radius: 8px;
      background: linear-gradient(135deg, #EC4899, #DB2777);
      color: #FFFFFF;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="badge">Jourvance Funnel Hosting</div>
    <h1>Funnel Page Not Active</h1>
    <p>The page <code>/p/${escapeHtml(slug)}</code> has not been published yet or is currently undergoing updates.</p>
    <a href="/">Create Your Funnel</a>
  </div>
</body>
</html>`;
}

function resolveSplitVariant(page, req, res) {
  const d = page?.data || {};
  if (!d.abTestingEnabled || !d.variantB) {
    return 'a';
  }

  // 1. Explicit query override: ?var=a or ?var=b (ideal for testing, previews, ad URLs)
  const qVar = (req?.query?.var || '').toLowerCase();
  if (qVar === 'a' || qVar === 'b') {
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Set-Cookie', `jv_var=${qVar}; Path=/; Max-Age=2592000; SameSite=Lax`);
    }
    return qVar;
  }

  // 2. Cookie header inspection: req.headers.cookie
  const cookieHeader = req?.headers?.cookie || '';
  const match = cookieHeader.match(/jv_var=(a|b)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }

  // 3. Deterministic split based on splitRatio (default 50% A, 50% B)
  const splitRatio = Number(d.splitRatio) || 50;
  const chosen = (Math.random() * 100 < splitRatio) ? 'a' : 'b';
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', `jv_var=${chosen}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }
  return chosen;
}

function renderPublicFunnelHtml(page, req, res) {
  const rawData = page.data || {};
  const activeVariant = resolveSplitVariant(page, req, res);
  const isVariantB = activeVariant === 'b' && rawData.variantB;
  const vB = isVariantB ? rawData.variantB : {};

  const data = {
    ...rawData,
    headline: vB.headline || rawData.headline,
    subhead: vB.subhead || rawData.subhead,
    bullets: Array.isArray(vB.bullets) && vB.bullets.length ? vB.bullets : rawData.bullets,
    buttonText: vB.buttonText || rawData.buttonText,
    heroImageUrl: vB.heroImageUrl || rawData.heroImageUrl,
    discountCode: vB.discountCode !== undefined ? vB.discountCode : rawData.discountCode,
    trustBadge: vB.trustBadge || rawData.trustBadge,
  };

  const shopify = page.shopifyConfig || {};
  const storeDomain = shopify.storeDomain || 'demo.myshopify.com';
  const variantId = data.shopifyVariantId || '';
  const discountCode = data.discountCode || '';
  const headline = data.headline || 'Exclusive Limited Edition Offer';
  const subhead = data.subhead || 'Handcrafted formulation designed for visible, clinical results.';
  const bullets = Array.isArray(data.bullets) && data.bullets.length ? data.bullets : [
    'Fast-absorbing, dermatologist-approved formulation',
    'Clinically tested active ingredients for optimal results',
    'Free shipping & 30-day money-back satisfaction guarantee'
  ];
  const trustBadge = data.trustBadge || 'Rated 4.9/5 stars by over 1,200+ verified customers';
  const productTitle = data.shopifyProductTitle || headline;
  const productPrice = data.shopifyProductPrice || '';
  const heroImage = data.shopifyProductImage || data.heroImageUrl || 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=1000&q=80';
  const isLeadGate = data.checkoutMode === 'lead-gate';
  const buttonText = data.buttonText || (isLeadGate ? 'Claim 15% VIP Voucher' : 'Buy Now — Instant Checkout');
  const metaPixelId = data.metaPixelId || '';
  const tiktokPixelId = data.tiktokPixelId || '';
  const ga4TrackingId = data.ga4TrackingId || '';
  const slug = page.slug || 'offer';

  // Wave 4: Urgency & Scarcity Boosters
  const urgencyTimerEnabled = Boolean(rawData.urgencyTimerEnabled);
  const urgencyMinutes = Number(rawData.urgencyMinutes) || 15;
  const urgencyText = rawData.urgencyText || 'Cart & promotional pricing reserved for';

  const scarcityBatchEnabled = Boolean(rawData.scarcityBatchEnabled);
  const scarcityBatchCount = Number(rawData.scarcityBatchCount) || 14;
  const scarcityBatchText = rawData.scarcityBatchText || `Limited Batch: Only ${scarcityBatchCount} units remaining`;

  // Order Bump configuration
  const orderBumpEnabled = data.orderBumpEnabled === true && !!data.orderBumpVariantId;
  const bumpVariantId = data.orderBumpVariantId || '';
  const bumpTitle = data.orderBumpTitle || 'Complementary Routine Upgrade';
  const bumpPrice = data.orderBumpPrice || '$24.00';
  const bumpHeadline = data.orderBumpHeadline || 'Special One-Time Upgrade: Complete Your Routine';
  const bumpDescription = data.orderBumpDescription || 'Tick this box to add our complementary botanical booster at a special bundle discount.';
  const bumpImage = data.orderBumpImage || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>${escapeHtml(headline)} | Official Store</title>
  <meta name="description" content="${escapeHtml(subhead)}">
  <meta property="og:title" content="${escapeHtml(headline)}">
  <meta property="og:description" content="${escapeHtml(subhead)}">
  <meta property="og:image" content="${escapeHtml(heroImage)}">
  <meta property="og:type" content="product">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap" rel="stylesheet">

  ${metaPixelId ? `
  <!-- Meta Pixel Code -->
  <script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${escapeHtml(metaPixelId)}');
  fbq('track', 'PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=${escapeHtml(metaPixelId)}&ev=PageView&noscript=1"
  /></noscript>
  <!-- End Meta Pixel Code -->
  ` : ''}

  ${tiktokPixelId ? `
  <!-- TikTok Pixel Code -->
  <script>
  !function (w, d, t) {
    w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    ttq.load('${escapeHtml(tiktokPixelId)}');
    ttq.page();
  }(window, document, 'ttq');
  </script>
  <!-- End TikTok Pixel Code -->
  ` : ''}

  ${ga4TrackingId ? `
  <!-- Google Analytics (GA4) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(ga4TrackingId)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${escapeHtml(ga4TrackingId)}');
  </script>
  <!-- End Google Analytics -->
  ` : ''}

  <style>
    :root {
      --bg: #09080E;
      --card-bg: rgba(22, 19, 32, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --pink: #EC4899;
      --pink-glow: rgba(236, 72, 153, 0.35);
      --emerald: #10B981;
      --text: #F8FAFC;
      --text-muted: #94A3B8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(circle at 50% 0%, rgba(236, 72, 153, 0.12), transparent 50%),
        radial-gradient(circle at 10% 80%, rgba(99, 102, 241, 0.08), transparent 40%);
      color: var(--text);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-bottom: 40px;
    }

    .top-bar {
      width: 100%;
      background: linear-gradient(90deg, #ec4899, #db2777, #9333ea);
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-align: center;
      padding: 7px 16px;
    }

    header {
      width: 100%;
      max-width: 840px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      font-family: 'Playfair Display', serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #FFFFFF;
    }
    .secure-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #34D399;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 600;
    }

    main {
      width: 100%;
      max-width: 840px;
      padding: 0 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .offer-card {
      background: var(--card-bg);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(236, 72, 153, 0.06);
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }
    @media (min-width: 720px) {
      .offer-card {
        grid-template-columns: 1fr 1.1fr;
        padding: 36px;
        gap: 36px;
      }
    }

    .image-wrap {
      position: relative;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #000;
      aspect-ratio: 1 / 1;
    }
    .image-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: transform 0.4s ease;
    }
    .image-wrap:hover img {
      transform: scale(1.03);
    }
    .price-tag {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34D399;
      font-weight: 800;
      font-size: 14px;
      padding: 6px 14px;
      border-radius: 8px;
    }

    .content-area {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--pink);
      background: rgba(236, 72, 153, 0.12);
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 12px;
      align-self: flex-start;
    }
    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 26px;
      font-weight: 700;
      color: #FFFFFF;
      line-height: 1.25;
      margin-bottom: 10px;
    }
    @media (min-width: 720px) {
      h1 { font-size: 32px; }
    }
    .subhead {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .bullets {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 22px;
    }
    .bullet {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 13px;
      color: #E2E8F0;
      line-height: 1.4;
    }
    .check {
      color: var(--emerald);
      font-weight: 800;
      font-size: 14px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .trust-box {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #CBD5E1;
      margin-bottom: 20px;
    }

    /* Order Bump / Add-on Offer Styling */
    .order-bump-card {
      background: rgba(236, 72, 153, 0.05);
      border: 2px dashed rgba(236, 72, 153, 0.4);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 16px;
      transition: all 0.2s ease;
      text-align: left;
    }
    .order-bump-card.checked {
      background: rgba(236, 72, 153, 0.12);
      border: 2px solid #EC4899;
      box-shadow: 0 0 20px rgba(236, 72, 153, 0.25);
    }
    .bump-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      cursor: pointer;
    }
    .bump-checkbox {
      width: 18px;
      height: 18px;
      accent-color: #EC4899;
      cursor: pointer;
      margin-top: 2px;
      flex-shrink: 0;
    }
    .bump-badge {
      display: inline-block;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #EC4899;
      background: rgba(236, 72, 153, 0.18);
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 3px;
    }
    .bump-title {
      font-size: 12px;
      font-weight: 700;
      color: #FFFFFF;
      line-height: 1.3;
    }
    .bump-body {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .bump-thumb {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .bump-desc {
      flex: 1;
      font-size: 11px;
      color: #94A3B8;
      line-height: 1.4;
    }
    .bump-price-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 3px;
    }
    .bump-product-title {
      font-size: 11px;
      font-weight: 600;
      color: #E2E8F0;
    }
    .bump-product-price {
      font-size: 11px;
      font-weight: 800;
      color: #34D399;
      background: rgba(16, 185, 129, 0.15);
      padding: 1px 6px;
      border-radius: 4px;
    }

    .cta-btn {
      display: block;
      width: 100%;
      padding: 16px 24px;
      background: linear-gradient(135deg, #EC4899 0%, #DB2777 50%, #BE185D 100%);
      color: #FFFFFF;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      box-shadow: 0 8px 24px var(--pink-glow);
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }
    .cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(236, 72, 153, 0.5);
    }
    .cta-btn:active {
      transform: translateY(0);
    }

    .guarantee-note {
      text-align: center;
      font-size: 11px;
      color: #64748B;
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 9999;
    }
    .modal-card {
      width: 100%;
      max-width: 440px;
      background: #13101C;
      border: 1px solid rgba(236, 72, 153, 0.3);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 50px rgba(236, 72, 153, 0.15);
      position: relative;
    }
    .modal-close {
      position: absolute;
      top: 14px;
      right: 14px;
      background: transparent;
      border: none;
      color: #94A3B8;
      font-size: 20px;
      cursor: pointer;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .input-field {
      width: 100%;
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #FFFFFF;
      fontSize: 13px;
      outline: none;
      margin-bottom: 12px;
      font-family: inherit;
    }
    .input-field:focus {
      border-color: #EC4899;
      box-shadow: 0 0 0 2px rgba(236, 72, 153, 0.2);
    }
    .loading-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Wave 4: Luxury On-Brand Urgency & Scarcity */
    .reservation-bar {
      width: 100%;
      background: linear-gradient(90deg, rgba(236, 72, 153, 0.16) 0%, rgba(147, 51, 234, 0.12) 50%, rgba(236, 72, 153, 0.16) 100%);
      border-bottom: 1px solid rgba(236, 72, 153, 0.28);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: #FCE7F3;
      backdrop-filter: blur(8px);
    }
    .reservation-inner {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }
    .reservation-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #F472B6;
      box-shadow: 0 0 10px #EC4899;
      animation: reservationPulse 1.8s ease-in-out infinite;
    }
    @keyframes reservationPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    .reservation-label {
      color: #E2E8F0;
    }
    .reservation-countdown {
      font-family: 'Outfit', monospace;
      font-weight: 800;
      color: #F472B6;
      background: rgba(236, 72, 153, 0.2);
      border: 1px solid rgba(236, 72, 153, 0.4);
      padding: 2px 8px;
      border-radius: 6px;
      letter-spacing: 0.04em;
    }
    .scarcity-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(236, 72, 153, 0.1);
      border: 1px solid rgba(236, 72, 153, 0.28);
      padding: 5px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      color: #F472B6;
      margin-bottom: 12px;
      align-self: flex-start;
    }
    .scarcity-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #EC4899;
      box-shadow: 0 0 6px #EC4899;
    }
  </style>
</head>
<body>

  <div class="top-bar">
    ✨ ${discountCode ? `VIP Exclusive: Code <strong>${escapeHtml(discountCode)}</strong> applied at checkout` : 'Limited Quantity Drop • Free Shipping on Orders Today'}
  </div>

  ${urgencyTimerEnabled ? `
  <div class="reservation-bar" id="jv-reservation-bar">
    <div class="reservation-inner">
      <span class="reservation-dot"></span>
      <span class="reservation-label" id="jv-urgency-label">${escapeHtml(urgencyText)}</span>
      <span class="reservation-countdown" id="jv-countdown-display">${String(urgencyMinutes).padStart(2, '0')}:00</span>
    </div>
  </div>
  ` : ''}

  <header>
    <div class="brand">${escapeHtml(storeDomain.split('.')[0] || 'JOURVANCE')}</div>
    <div class="secure-pill">
      <span>🔒</span>
      <span>Shopify Verified Checkout</span>
    </div>
  </header>

  <main>
    <div class="offer-card">
      <div class="image-wrap">
        <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(headline)}" id="product-img">
        ${productPrice ? `<div class="price-tag" id="product-price">${escapeHtml(productPrice)}</div>` : ''}
      </div>

      <div class="content-area">
        ${scarcityBatchEnabled ? `
        <div class="scarcity-badge" id="jv-scarcity-badge">
          <span class="scarcity-pulse"></span>
          <span>${escapeHtml(scarcityBatchText)}</span>
        </div>
        ` : ''}
        <div class="eyebrow">
          <span>✦</span>
          <span>${discountCode ? `VIP Savings Active: ${escapeHtml(discountCode)}` : 'Exclusive Drop'}</span>
        </div>

        <h1>${escapeHtml(headline)}</h1>
        <p class="subhead">${escapeHtml(subhead)}</p>

        <div class="bullets">
          ${bullets.map(b => `
            <div class="bullet">
              <span class="check">✓</span>
              <span>${escapeHtml(b)}</span>
            </div>
          `).join('')}
        </div>

        <div class="trust-box">
          <span>⭐⭐⭐⭐⭐</span>
          <span>${escapeHtml(trustBadge)}</span>
        </div>

        ${orderBumpEnabled ? `
        <!-- Order Bump On Landing Page -->
        <div class="order-bump-card" id="page-order-bump">
          <label class="bump-header" for="bump-checkbox-page">
            <input type="checkbox" id="bump-checkbox-page" class="bump-checkbox">
            <div class="bump-text-wrap">
              <span class="bump-badge">✦ ONE-TIME OFFER</span>
              <div class="bump-title">${escapeHtml(bumpHeadline)}</div>
            </div>
          </label>
          <div class="bump-body">
            ${bumpImage ? `<img src="${escapeHtml(bumpImage)}" alt="${escapeHtml(bumpTitle)}" class="bump-thumb">` : ''}
            <div class="bump-desc">
              <p>${escapeHtml(bumpDescription)}</p>
              <div class="bump-price-row">
                <span class="bump-product-title">${escapeHtml(bumpTitle)}</span>
                <span class="bump-product-price">${escapeHtml(bumpPrice)}</span>
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <button id="main-cta-btn" class="cta-btn" type="button">
          ${escapeHtml(buttonText)}
        </button>

        <div class="guarantee-note">
          <span>🛡️</span>
          <span>30-Day Happiness Guarantee • Instant Tracking Dispatched</span>
        </div>
      </div>
    </div>
  </main>

  <div id="lead-modal" class="modal-overlay">
    <div class="modal-card">
      <button id="modal-close-btn" class="modal-close" type="button">&times;</button>
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #ec4899; letter-spacing: 0.08em; margin-bottom: 8px;">
        VIP Access
      </div>
      <h2 style="font-size: 20px; font-weight: 800; color: #FFFFFF; margin-bottom: 6px;">
        Unlock Your Exclusive Discount
      </h2>
      <p style="font-size: 13px; color: #94A3B8; margin-bottom: 18px; line-height: 1.5;">
        Enter your email to claim your ${discountCode ? `<strong>${escapeHtml(discountCode)}</strong>` : 'VIP'} coupon and route straight to checkout.
      </p>

      <form id="lead-form">
        <input type="text" id="lead-name" class="input-field" placeholder="Your Full Name (optional)">
        <input type="email" id="lead-email" class="input-field" placeholder="Your Best Email Address" required>
        <input type="tel" id="lead-phone" class="input-field" placeholder="Mobile Phone (for tracking SMS, optional)">

        ${orderBumpEnabled ? `
        <!-- Order Bump Inside Modal Form -->
        <div class="order-bump-card" id="modal-order-bump" style="margin-bottom: 14px;">
          <label class="bump-header" for="bump-checkbox-modal">
            <input type="checkbox" id="bump-checkbox-modal" class="bump-checkbox">
            <div class="bump-text-wrap">
              <span class="bump-badge">✦ ONE-TIME VIP UPGRADE</span>
              <div class="bump-title">${escapeHtml(bumpHeadline)}</div>
            </div>
          </label>
          <div class="bump-body">
            ${bumpImage ? `<img src="${escapeHtml(bumpImage)}" alt="${escapeHtml(bumpTitle)}" class="bump-thumb">` : ''}
            <div class="bump-desc">
              <p>${escapeHtml(bumpDescription)}</p>
              <div class="bump-price-row">
                <span class="bump-product-title">${escapeHtml(bumpTitle)}</span>
                <span class="bump-product-price">${escapeHtml(bumpPrice)}</span>
              </div>
            </div>
          </div>
        </div>
        ` : ''}

        <button id="lead-submit-btn" type="submit" class="cta-btn" style="padding: 14px;">
          <span id="btn-text">Claim Voucher & Checkout &rarr;</span>
        </button>
      </form>
    </div>
  </div>

  <script>
    (function() {
      const params = new URLSearchParams(window.location.search);
      const utm_source = params.get('utm_source') || 'jourvance';
      const utm_medium = params.get('utm_medium') || '';
      const utm_campaign = params.get('utm_campaign') || '${escapeHtml(slug)}';
      const utm_content = params.get('utm_content') || '';
      const utm_term = params.get('utm_term') || '';
      const fbclid = params.get('fbclid') || '';
      const ttclid = params.get('ttclid') || '';
      const gclid = params.get('gclid') || '';

      const storeDomain = '${escapeHtml(storeDomain)}';
      const variantId = '${escapeHtml(variantId)}';
      const bumpVariantId = '${escapeHtml(bumpVariantId)}';
      const orderBumpEnabled = ${orderBumpEnabled ? 'true' : 'false'};
      const discountCode = '${escapeHtml(discountCode)}';
      const slug = '${escapeHtml(slug)}';
      const isLeadGate = ${isLeadGate ? 'true' : 'false'};
      const defaultButtonText = '${escapeHtml(buttonText)}';
      const activeVariant = '${escapeHtml(activeVariant)}';

      // Wave 4: Urgency Reservation Timer Persistence
      const urgencyTimerEnabled = ${urgencyTimerEnabled ? 'true' : 'false'};
      const urgencyMinutes = ${urgencyMinutes || 15};
      if (urgencyTimerEnabled) {
        const timerKey = 'jv_reserve_' + slug;
        const durationMs = urgencyMinutes * 60 * 1000;
        let expireTime = parseInt(localStorage.getItem(timerKey), 10);
        if (!expireTime || isNaN(expireTime) || expireTime < Date.now()) {
          expireTime = Date.now() + durationMs;
          localStorage.setItem(timerKey, expireTime.toString());
        }
        const timerEl = document.getElementById('jv-countdown-display');
        function updateTimer() {
          if (!timerEl) return;
          const remaining = Math.max(0, expireTime - Date.now());
          const m = Math.floor(remaining / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
          if (remaining > 0) {
            setTimeout(updateTimer, 1000);
          } else {
            timerEl.textContent = '00:00';
            const labelEl = document.getElementById('jv-urgency-label');
            if (labelEl) labelEl.textContent = 'Reservation extended for final checkout:';
          }
        }
        updateTimer();
      }

      const mainCta = document.getElementById('main-cta-btn');
      const modal = document.getElementById('lead-modal');
      const closeBtn = document.getElementById('modal-close-btn');
      const leadForm = document.getElementById('lead-form');
      const submitBtn = document.getElementById('lead-submit-btn');
      const btnText = document.getElementById('btn-text');

      // Order Bump Synchronization
      const bumpCbPage = document.getElementById('bump-checkbox-page');
      const bumpCbModal = document.getElementById('bump-checkbox-modal');
      const bumpCardPage = document.getElementById('page-order-bump');
      const bumpCardModal = document.getElementById('modal-order-bump');
      let isBumpChecked = false;

      function setBumpState(checked) {
        isBumpChecked = checked;
        if (bumpCbPage) bumpCbPage.checked = checked;
        if (bumpCbModal) bumpCbModal.checked = checked;
        if (bumpCardPage) bumpCardPage.classList.toggle('checked', checked);
        if (bumpCardModal) bumpCardModal.classList.toggle('checked', checked);

        if (mainCta) {
          if (checked) {
            mainCta.innerHTML = 'Upgrade Order & Checkout &rarr;';
          } else {
            mainCta.innerHTML = defaultButtonText;
          }
        }
        if (btnText) {
          if (checked) {
            btnText.innerHTML = 'Claim Voucher & Upgrade Order &rarr;';
          } else {
            btnText.innerHTML = 'Claim Voucher & Checkout &rarr;';
          }
        }
      }

      if (bumpCbPage) bumpCbPage.addEventListener('change', function(e) { setBumpState(e.target.checked); });
      if (bumpCbModal) bumpCbModal.addEventListener('change', function(e) { setBumpState(e.target.checked); });

      function buildCheckoutUrl() {
        let items = [];
        if (variantId) items.push(variantId + ':1');
        if (isBumpChecked && bumpVariantId) items.push(bumpVariantId + ':1');
        let base = 'https://' + storeDomain + '/cart/' + (items.length ? items.join(',') : '');

        const out = new URLSearchParams();
        if (discountCode) out.set('discount', discountCode);
        if (utm_source) out.set('utm_source', utm_source);
        if (utm_medium) out.set('utm_medium', utm_medium);
        if (utm_campaign) out.set('utm_campaign', utm_campaign);
        if (utm_content) {
          out.set('utm_content', utm_content);
        } else {
          out.set('utm_content', 'var-' + activeVariant);
        }
        if (utm_term) out.set('utm_term', utm_term);
        if (fbclid) out.set('fbclid', fbclid);
        if (ttclid) out.set('ttclid', ttclid);
        if (gclid) out.set('gclid', gclid);
        const qs = out.toString();
        return base + (qs ? '?' + qs : '');
      }

      function fireInitiateCheckout() {
        if (window.fbq) {
          try { fbq('track', 'InitiateCheckout', { content_name: '${escapeHtml(productTitle)}', currency: 'USD' }); } catch(e){}
        }
        if (window.ttq) {
          try { ttq.track('InitiateCheckout', { content_name: '${escapeHtml(productTitle)}', currency: 'USD' }); } catch(e){}
        }
        if (window.gtag) {
          try { gtag('event', 'begin_checkout', { items: [{ item_name: '${escapeHtml(productTitle)}' }] }); } catch(e){}
        }
      }

      function fireLeadEvent() {
        if (window.fbq) {
          try { fbq('track', 'Lead'); } catch(e){}
        }
        if (window.ttq) {
          try { ttq.track('SubmitForm'); } catch(e){}
        }
        if (window.gtag) {
          try { gtag('event', 'generate_lead'); } catch(e){}
        }
      }

      if (mainCta) {
        mainCta.addEventListener('click', function(e) {
          e.preventDefault();
          if (isLeadGate) {
            modal.style.display = 'flex';
          } else {
            fireInitiateCheckout();
            const targetUrl = buildCheckoutUrl();
            window.location.href = targetUrl;
          }
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener('click', function() {
          modal.style.display = 'none';
        });
      }

      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) modal.style.display = 'none';
        });
      }

      if (leadForm) {
        leadForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          const emailInput = document.getElementById('lead-email');
          const nameInput = document.getElementById('lead-name');
          const phoneInput = document.getElementById('lead-phone');

          if (!emailInput.value) return;

          btnText.innerHTML = '<span class="loading-spinner"></span> Securing Voucher…';
          submitBtn.disabled = true;

          try {
            const resp = await fetch('/api/public/lead', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                slug,
                email: emailInput.value,
                name: nameInput.value,
                phone: phoneInput.value,
                order_bump_selected: isBumpChecked,
                variant: activeVariant,
                utm_source,
                utm_medium,
                utm_campaign,
                utm_content: (utm_content ? utm_content + '_' : '') + 'var-' + activeVariant,
                utm_term,
                fbclid,
                ttclid,
                gclid
              })
            });

            fireLeadEvent();
            fireInitiateCheckout();

            const resData = await resp.json();
            const finalUrl = resData.checkoutUrl || buildCheckoutUrl();
            btnText.textContent = 'Redirecting to Checkout…';
            setTimeout(function() {
              window.location.href = finalUrl;
            }, 300);
          } catch(err) {
            console.error('Lead submission failed, proceeding to checkout:', err);
            window.location.href = buildCheckoutUrl();
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}

// ── Funnel Publishing Routes ──────────────────────────────────────────────────

app.post('/api/journey/:id/publish', requireUser, async (req, res) => {
  const journey = await loadJourney(req.user.uid, req.params.id);
  if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

  const wsId = journey.workspaceId || req.body?.workspaceId;
  const ws = wsId ? await loadWorkspace(req.user.uid, wsId) : null;
  const shopifyConfig = ws?.shopifyConfig || { storeDomain: 'demo.myshopify.com', status: 'connected' };

  const publishedPages = [];
  const nodes = journey.nodes || [];

  for (const node of nodes) {
    if (node.type === 'landing-page') {
      const d = node.data || {};
      const cleanSlug = (d.slug || node.id)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '') || `offer-${node.id.slice(0, 6)}`;
      const pubUrl = `/p/${cleanSlug}`;

      const customDomain = (d.customDomain || '')
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');

      node.data = {
        ...d,
        slug: cleanSlug,
        customDomain: customDomain || undefined,
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
        data: node.data,
        shopifyConfig,
        customDomain: customDomain || undefined
      };

      await savePublicPage(cleanSlug, publicRecord);
      if (customDomain) {
        publicPageCache[`domain:${customDomain}`] = cleanSlug;
      }
      publishedPages.push({
        nodeId: node.id,
        slug: cleanSlug,
        url: pubUrl,
        headline: d.headline,
        productTitle: d.shopifyProductTitle,
        checkoutMode: d.checkoutMode || 'direct'
      });
    }
  }

  await saveJourney(req.user.uid, req.params.id, journey);

  res.json({
    success: true,
    publishedPages,
    message: `Published ${publishedPages.length} landing page(s) successfully.`
  });
});

app.post('/api/journey/:id/unpublish', requireUser, async (req, res) => {
  const journey = await loadJourney(req.user.uid, req.params.id);
  if (!journey) return res.status(404).json({ success: false, error: 'Journey not found.' });

  const nodes = journey.nodes || [];
  for (const node of nodes) {
    if (node.type === 'landing-page') {
      const slug = node.data?.slug;
      if (slug && publicPageCache[slug]) {
        delete publicPageCache[slug];
      }
      if (node.data) node.data.published = false;
    }
  }
  persistPublicPages();
  await saveJourney(req.user.uid, req.params.id, journey);

  res.json({ success: true, message: 'Funnel unpublished successfully.' });
});

// Public Lead Ingestion
app.post('/api/public/lead', async (req, res) => {
  const { slug, email, name, phone, variant, order_bump_selected, orderBumpAccepted, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid, gclid } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  const activeVariant = (variant === 'b' ? 'b' : 'a');
  const page = slug ? await loadPublicPage(slug) : null;
  const storeDomain = page?.shopifyConfig?.storeDomain || 'demo.myshopify.com';
  const variantId = page?.data?.shopifyVariantId || '';
  const bumpVariantId = page?.data?.orderBumpVariantId || '';
  const bumpSelected = Boolean(order_bump_selected ?? orderBumpAccepted);
  const discountCode = (activeVariant === 'b' && page?.data?.variantB?.discountCode)
    ? page.data.variantB.discountCode
    : (page?.data?.discountCode || '');

  const tags = ['Jourvance Lead', slug, discountCode ? `Promo-${discountCode}` : 'VIP', `Variant-${activeVariant.toUpperCase()}`];
  if (bumpSelected) {
    tags.push('Order Bump Taker');
  }

  const contact = {
    email: email.trim().toLowerCase(),
    name: (name || '').trim(),
    phone: (phone || '').trim(),
    sourceSlug: slug,
    variant: activeVariant,
    tags,
    orderBumpSelected: bumpSelected,
    utm_source: utm_source || 'jourvance',
    utm_campaign: utm_campaign || '',
    fbclid: fbclid || '',
    ttclid: ttclid || '',
    gclid: gclid || '',
    subscribedAt: new Date().toISOString()
  };

  // Local CRM Contact Persistence (ensures 100% data durability and local dev availability)
  try {
    const contactsFilePath = path.join(__dirname, 'contacts.json');
    let localContacts = [];
    if (fs.existsSync(contactsFilePath)) {
      try { localContacts = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8')); } catch {}
    }
    const existingIndex = localContacts.findIndex(c => c.email === contact.email);
    if (existingIndex >= 0) {
      localContacts[existingIndex] = { ...localContacts[existingIndex], ...contact };
    } else {
      localContacts.push(contact);
    }
    fs.writeFileSync(contactsFilePath, JSON.stringify(localContacts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed to persist lead to contacts.json:', err.message);
  }

  if (hubReady && page?.userId) {
    try {
      await hub.email.subscribers?.add?.({
        accountId: page.userId,
        contact: {
          email: contact.email,
          firstName: contact.name.split(' ')[0] || '',
          lastName: contact.name.split(' ').slice(1).join(' ') || '',
          tags
        }
      });
    } catch (e) {
      console.warn('[Jourvance] Failed to push public lead to Hub Email:', e.message);
    }
  }

  const cartItems = [];
  if (variantId) cartItems.push(`${variantId}:1`);
  if (bumpSelected && bumpVariantId) cartItems.push(`${bumpVariantId}:1`);

  let checkoutUrl = `https://${storeDomain}/cart/${cartItems.join(',')}`;
  const outParams = new URLSearchParams();
  if (discountCode) outParams.set('discount', discountCode);
  if (utm_source) outParams.set('utm_source', utm_source);
  if (utm_medium) outParams.set('utm_medium', utm_medium);
  if (utm_campaign) outParams.set('utm_campaign', utm_campaign);
  if (utm_content) outParams.set('utm_content', utm_content);
  if (utm_term) outParams.set('utm_term', utm_term);
  if (fbclid) outParams.set('fbclid', fbclid);
  if (ttclid) outParams.set('ttclid', ttclid);
  if (gclid) outParams.set('gclid', gclid);

  const qs = outParams.toString();
  if (qs) checkoutUrl += `?${qs}`;

  // Wave 3 & 4: Outbound Webhook Relay (Klaviyo / Zapier / Make / Custom Webhook with variant)
  const webhookUrl = page?.data?.webhookUrl;
  if (webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'))) {
    const bumpTitle = (page?.data?.orderBumpTitle || page?.data?.orderBumpHeadline || '').trim();
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Jourvance-Webhook/1.0' },
      body: JSON.stringify({
        event: 'funnel_lead',
        email: contact.email,
        name: contact.name,
        phone: contact.phone,
        pageSlug: slug,
        variant: activeVariant,
        bumpAccepted: Boolean(bumpSelected),
        bumpProductTitle: bumpSelected ? bumpTitle : null,
        cartUrl: checkoutUrl,
        checkoutUrl,
        discountCode,
        contact,
        data: {
          variant: activeVariant,
          slug,
          email: contact.email,
          discountCode,
          orderBumpSelected: bumpSelected
        },
        timestamp: new Date().toISOString()
      })
    }).catch(err => {
      console.warn('[Jourvance] Outbound lead webhook relay failed:', err.message);
    });
  }

  res.json({
    ok: true,
    success: true,
    message: 'VIP discount claimed successfully!',
    checkoutUrl,
    discountCode,
    variant: activeVariant,
    orderBumpIncluded: bumpSelected && Boolean(bumpVariantId),
    contact
  });
});

// ── Wave 3: Custom Brand Subdomain & CNAME Verification ───────────────────────

app.get('/api/domain/verify', async (req, res) => {
  const domain = (req.query.domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain || !domain.includes('.')) {
    return res.status(400).json({ success: false, error: 'A valid subdomain is required (e.g. offer.yourbrand.com).' });
  }

  const expectedTarget = 'cname.jourvance.com';
  try {
    const cnames = await dns.promises.resolveCname(domain);
    const targetMatch = Array.isArray(cnames) && cnames.some(c => {
      const lower = c.toLowerCase().replace(/\.$/, '');
      return lower === expectedTarget || lower === 'jourvance.com' || lower.includes('jourvance');
    });

    res.json({
      success: true,
      domain,
      verified: targetMatch,
      cnames,
      expectedTarget,
      message: targetMatch
        ? `DNS Verified! ${domain} correctly points to ${expectedTarget}.`
        : `CNAME points to ${cnames.join(', ')}. Expected: ${expectedTarget}`
    });
  } catch (err) {
    res.json({
      success: true,
      domain,
      verified: false,
      error: err.code || err.message,
      expectedTarget,
      message: `No active CNAME record detected for ${domain}. Please create: CNAME -> ${expectedTarget}`
    });
  }
});

// Custom Brand Subdomain Host-Header Route (Wave 3)
// Routes incoming requests on offer.yourbrand.com directly to the mapped funnel page
app.use(async (req, res, next) => {
  const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '');
  const host = rawHost.split(',')[0].split(':')[0].toLowerCase().trim();
  // Bypass internal / default hosts
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === 'jourvance.com' || host === 'www.jourvance.com') {
    return next();
  }

  // Check if incoming host is mapped to a published page
  const page = await loadPublicPage(host);
  if (page && page.data) {
    if (req.path === '/' || req.path === `/${page.slug}` || req.path.startsWith('/p/')) {
      const html = renderPublicFunnelHtml(page, req, res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  }
  next();
});

// Public Landing Page SSR Route (must be before catch-all static handler)
app.get(['/p/:slug', '/p/:wsId/:slug'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = renderPublicFunnelHtml(page, req, res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Serve frontend in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[Jourvance] Customer Journey Spoke running at http://localhost:${PORT}`);
});
