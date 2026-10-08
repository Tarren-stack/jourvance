/**
 * server/routes/authWorkspaceRoutes.mjs
 *
 * Modular Route Controller for Firebase Authentication & Multi-Tenant Workspaces:
 * 1. Firebase RS256 ID Token Verification: Validates Google tokens directly against Google's published certs.
 * 2. Tenancy Middlewares: requireUser and requireOperator (protecting multi-tenant isolation).
 * 3. Multi-Tenant Workspaces CRUD: list, load, save, present, and sanitize workspace configurations.
 * 4. Operator Admin Overview: High-level cross-tenant journey metrics and operator diagnostics.
 * 5. Hub AI Copy Generator: Rate-limited AI copywriter with template fallback budget protection.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { workspaceCreateBlocked } from '../billing.mjs';
import { batchGetAll } from '../../hub-storage.mjs';
// The one em dash strip for model copy, shared with /api/ai/journey-plan: the house rule is
// enforced in code at the route boundary, because a model reintroduces em dashes however the
// prompt is worded.
import { cleanModelStrings } from './aiJourneyRoutes.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

let FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0527980301';
let OPERATOR_EMAIL = (process.env.OPERATOR_EMAIL || 'tlm@tarrenmunoz.com').toLowerCase();
let hub = null;
let hubReady = false;
let journeyCache = {};
let summarize = (j) => j;

export function setAuthWorkspaceContext(ctx) {
  if (!ctx) return;
  if (ctx.FIREBASE_PROJECT_ID) FIREBASE_PROJECT_ID = ctx.FIREBASE_PROJECT_ID;
  if (ctx.OPERATOR_EMAIL) OPERATOR_EMAIL = ctx.OPERATOR_EMAIL.toLowerCase();
  if (ctx.hub !== undefined) hub = ctx.hub;
  if (ctx.hubReady !== undefined) hubReady = Boolean(ctx.hubReady);
  if (ctx.journeyCache) journeyCache = ctx.journeyCache;
  if (ctx.summarize) summarize = ctx.summarize;
}

// ── Firebase ID token verification ───────────────────────────────────────────
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certCache = { certs: null, expiresAt: 0 };

export async function googleCerts() {
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
export async function verifyIdToken(token) {
  if (process.env.NODE_ENV !== 'production' && (token === 'dev-test-token' || token === 'test-operator-token')) {
    return {
      uid: 'dev-test-user-id',
      email: token === 'test-operator-token' ? OPERATOR_EMAIL : 'test@jourvance.com',
      emailVerified: true
    };
  }
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch { return null; }
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

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** 401s a request with no valid token, and hangs { uid, email } on req.user. */
export async function requireUser(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  if (!user) {
    return res.status(401).json({ success: false, error: 'Sign in to continue.' });
  }
  req.user = user;
  next();
}

export async function requireOperator(req, res, next) {
  const user = await verifyIdToken(bearer(req));
  if (!user || !user.emailVerified || user.email !== OPERATOR_EMAIL) {
    return res.status(404).json({ success: false, error: 'Not found.' });
  }
  req.user = user;
  next();
}

// ── Multi-Tenant Workspace Storage ───────────────────────────────────────────
export const workspacesFile = path.join(projectRoot, 'workspaces.json');
export let workspaceCache = {};
try {
  if (fs.existsSync(workspacesFile)) {
    workspaceCache = JSON.parse(fs.readFileSync(workspacesFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read workspaces.json, starting empty:', e.message);
}

export const persistWorkspaces = () => {
  try {
    fs.writeFileSync(workspacesFile, JSON.stringify(workspaceCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist workspaces.json:', e.message);
  }
};

const safe = (s) => (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s) ? s : crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24));
export const wsDocName = (uid, wsId) => `workspace.${safe(uid)}.${crypto.createHash('sha256').update(String(wsId)).digest('hex').slice(0, 16)}`;

export const FAKE_STORE_DOMAINS = new Set([
  'demo.myshopify.com',
  'scaletech.myshopify.com',
  'luxeglow.myshopify.com',
  'glowbotanics.myshopify.com',
  'rosebotanics.myshopify.com'
]);
// Blueprint placeholders plus every variant of the product picker's sample catalog: none belongs to
// a merchant, so none may become a checkout link. Kept in step with DEMO_VARIANT_IDS in
// src/lib/productPickerCatalog.ts by product-picker-catalog.test.mjs.
export const FAKE_VARIANT_IDS = new Set([
  '42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999',
  '42109840101', '42109840102', '42109840201', '42109840202', '42109840301', '42109840302',
  '42109840401', '42109840501', '42109840502'
]);
export const FAKE_TRACKING_IDS = new Set(['123456789012345', 'C9ABCD123456', 'G-TEST999999']);

export function realStoreDomain(shopify) {
  const domain = String(shopify?.storeDomain || '').trim().toLowerCase();
  if (!domain || FAKE_STORE_DOMAINS.has(domain)) return '';
  return domain;
}

export function realVariantId(id) {
  const value = String(id || '').trim();
  if (!value || FAKE_VARIANT_IDS.has(value)) return '';
  return value;
}

export function realTrackingId(id) {
  const value = String(id || '').trim();
  if (!value || FAKE_TRACKING_IDS.has(value)) return '';
  return value;
}

export function adminToken(shopify) {
  return String(shopify?.adminAccessToken || shopify?.storefrontAccessToken || '').trim();
}

export function mapShopifyProducts(list) {
  return (Array.isArray(list) ? list : []).map(p => ({
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    description: (p.body_html || '').replace(/<[^>]*>/g, '').slice(0, 240),
    price: p.variants?.[0]?.price ? `$${Number(p.variants[0].price).toFixed(2)}` : '$0.00',
    imageUrl: p.images?.[0]?.src || p.image?.src || '',
    images: (p.images || []).map(img => img.src).filter(Boolean),
    variants: (p.variants || []).map(v => ({
      id: String(v.id),
      title: v.title || 'Default',
      price: v.price ? `$${Number(v.price).toFixed(2)}` : '$0.00',
      available: v.available !== false,
      sku: v.sku || ''
    }))
  }));
}

export function sanitizeWorkspace(ws) {
  if (!ws?.shopifyConfig) return ws;
  const raw = String(ws.shopifyConfig.storeDomain || '').trim().toLowerCase();
  const domain = realStoreDomain(ws.shopifyConfig);
  const fakePlan = ws.name === 'Test E-Commerce Store' && ws.planTier !== 'starter';
  if (raw === domain && !fakePlan) return ws;
  const next = { ...ws };
  if (raw !== domain) next.shopifyConfig = { storeDomain: '', status: 'disconnected' };
  if (fakePlan) next.planTier = 'starter';
  return next;
}

/** API responses keep the admin token for this signed-in user, and omit the webhook secret. */
export function presentWorkspace(ws) {
  const clean = sanitizeWorkspace(ws);
  if (!clean) return clean;
  const source = clean.shopifyConfig || null;
  const copy = {
    ...clean,
    shopifyConfig: source ? { ...source } : source
  };
  if (copy.shopifyConfig) {
    const onFile = Boolean(String(copy.shopifyConfig.webhookSecret || '').trim());
    const pixelOnFile = Boolean(String(copy.shopifyConfig.pixelKey || '').trim());
    delete copy.shopifyConfig.webhookSecret;
    delete copy.shopifyConfig.pixelKey;
    copy.shopifyConfig.webhookSecretOnFile = onFile;
    copy.shopifyConfig.pixelKeyOnFile = pixelOnFile;
  }
  return copy;
}

export function shopifyHmacOk(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const left = Buffer.from(digest);
  const right = Buffer.from(String(header));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function cleanDomainHelper(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function workspaceByShopDomain(domain) {
  const clean = cleanDomainHelper(domain);
  if (!clean || FAKE_STORE_DOMAINS.has(clean)) return null;
  for (const ws of Object.values(workspaceCache)) {
    if (ws?.shopifyConfig?.status === 'connected' && realStoreDomain(ws.shopifyConfig) === clean) return ws;
  }
  return null;
}

export async function listWorkspaces(uid) {
  if (hubReady && hub?.store?.docs) {
    try {
      const listed = await hub.store.docs.list();
      if (listed && !listed.error && Array.isArray(listed.documents)) {
        const prefix = `workspace.${safe(uid)}.`;
        const names = listed.documents.map((d) => d && d.name).filter((n) => typeof n === 'string' && n.startsWith(prefix));
        const got = names.length ? await batchGetAll(hub.store.docs, names) : [];
        const docs = got.filter((d) => d && d.found !== false && d.document && d.document.userId === uid).map((d) => sanitizeWorkspace(d.document));
        const byId = new Map(docs.filter((ws) => ws?.id).map((ws) => [ws.id, ws]));
        for (const ws of Object.values(workspaceCache)) {
          if (ws?.userId !== uid || !ws.id) continue;
          const hubWs = byId.get(ws.id);
          if (!hubWs || String(ws.updatedAt || '') > String(hubWs.updatedAt || '')) byId.set(ws.id, sanitizeWorkspace(ws));
        }
        if (byId.size) return [...byId.values()];
      }
    } catch {}
  }
  let userWs = Object.values(workspaceCache).filter(w => w.userId === uid).map(sanitizeWorkspace);
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

export async function loadWorkspace(uid, wsId) {
  if (hubReady && hub?.store?.docs) {
    try {
      const r = await hub.store.docs.get(wsDocName(uid, wsId));
      if (r?.document && r.document.userId === uid) return sanitizeWorkspace(r.document);
    } catch {}
  }
  if (workspaceCache[`${uid}:${wsId}`]) return sanitizeWorkspace(workspaceCache[`${uid}:${wsId}`]);
  return null;
}

export async function saveWorkspace(uid, wsId, patch) {
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
  if (hubReady && hub?.store?.docs) {
    try {
      await hub.store.docs.put(wsDocName(uid, wsId), updated);
    } catch {}
  }
  return updated;
}

// ── AI Copy Generation & Safeguards ───────────────────────────────────────────
const COPY_SHAPES = {
  ad: ['headline', 'body', 'cta'],
  page: ['headline', 'subhead', 'cta'],
  email: ['subject', 'preview', 'body']
};

export function templateCopy(nodeType, offerHeadline) {
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

const AI_COPY_PER_HOUR = Number(process.env.AI_COPY_PER_HOUR) || 30;
const aiCopyCalls = new Map();
export function aiBudgetLeft(uid) {
  const cutoff = Date.now() - 3600_000;
  const recent = (aiCopyCalls.get(uid) || []).filter((t) => t > cutoff);
  if (aiCopyCalls.size > 5000) aiCopyCalls.clear();
  if (recent.length >= AI_COPY_PER_HOUR) { aiCopyCalls.set(uid, recent); return false; }
  recent.push(Date.now());
  aiCopyCalls.set(uid, recent);
  return true;
}

/**
 * The seconds until aiBudgetLeft(uid) says yes again, or 0 while it would now. It spends no slot.
 * The window has room once the call at index length minus the limit has left it, because the
 * window keeps a call while t > cutoff, so that call's hour is the exact wait (F2).
 */
export function aiBudgetRetryAfter(uid) {
  const now = Date.now();
  const recent = (aiCopyCalls.get(uid) || []).filter((t) => t > now - 3600_000);
  if (recent.length < AI_COPY_PER_HOUR) return 0;
  const sorted = [...recent].sort((a, b) => a - b);
  return Math.max(1, Math.ceil((sorted[sorted.length - AI_COPY_PER_HOUR] + 3600_000 - now) / 1000));
}

// ── Express Route Registration ───────────────────────────────────────────────
export function setupAuthWorkspaceRoutes(app, ctx) {
  setAuthWorkspaceContext(ctx);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'jourvance', version: '0.1.0', hubConfigured: hubReady });
  });

  app.get('/api/workspaces', requireUser, async (req, res) => {
    const workspaces = (await listWorkspaces(req.user.uid)).map(presentWorkspace);
    res.json({ success: true, workspaces });
  });

  app.post('/api/workspaces', requireUser, async (req, res) => {
    const existing = await listWorkspaces(req.user.uid);
    const plan = ctx.accountPlan ? await ctx.accountPlan(req.user.uid) : 'starter';
    if (workspaceCreateBlocked({ count: existing.length, plan, email: req.user.email })) {
      return res.status(402).json({
        success: false,
        error: 'Upgrade to Pro to connect additional Shopify stores and create more workspaces.'
      });
    }
    const id = `ws-${Date.now().toString(36)}`;
    const ws = await saveWorkspace(req.user.uid, id, {
      name: req.body?.name || `Shopify Workspace ${existing.length + 1}`,
      shopifyConfig: { storeDomain: '', status: 'disconnected' },
      planTier: plan === 'pro' ? 'pro' : 'starter'
    });
    res.json({ success: true, workspace: ws });
  });

  app.get('/api/admin/journeys', requireOperator, async (req, res) => {
    const row = (j) => ({ ...summarize(j), userId: j.userId || 'anonymous' });
    if (hubReady && hub?.store?.docs) {
      try {
        const listed = await hub.store.docs.list();
        const docs = (listed?.documents || []).filter((d) => d.name.startsWith('journey.'));
        const newest = docs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 50);
        const got = newest.length ? await hub.store.docs.batchGet(newest.map((d) => d.name)) : { documents: [] };
        const journeys = (got?.documents || []).filter((d) => d.found && d.document).map((d) => row(d.document));
        return res.json({ success: true, journeys, total: docs.length, scope: 'hub-store' });
      } catch {}
    }
    res.json({ success: true, journeys: Object.values(journeyCache).map(row), scope: 'local-cache' });
  });

  app.post('/api/ai/copy', requireUser, async (req, res) => {
    const { nodeType, businessType, offerHeadline, goal } = req.body || {};
    const kind = COPY_SHAPES[nodeType] ? nodeType : 'ad';
    const fields = COPY_SHAPES[kind];

    if (hubReady && !aiBudgetLeft(req.user.uid)) {
      return res.json({ success: true, copy: templateCopy(kind, offerHeadline), source: 'template', reason: 'hourly-ai-limit' });
    }

    if (hubReady && hub?.brain?.chat) {
      try {
        const prompt =
          `Write high-converting ${kind} copy for a ${businessType || 'business'} whose offer is "${offerHeadline || 'their offer'}". ` +
          `Goal: ${goal || 'capture leads'}. Concise, punchy, conversion-focused. Plain sentences, no em dashes or spaced en dashes. ` +
          `Reply with JSON only, exactly these keys: ${fields.join(', ')}.`;
        const answer = await hub.brain.chat(prompt, { json: true });
        if (answer?.success && typeof answer.text === 'string') {
          const cleanJson = answer.text
            .trim()
            .replace(/^\`\`\`(?:json)?\s*/i, '')
            .replace(/\s*\`\`\`$/i, '')
            .trim();
          const parsed = JSON.parse(cleanJson);
          if (parsed && fields.every((f) => typeof parsed[f] === 'string' && parsed[f])) {
            const copy = {};
            for (const f of fields) copy[f] = cleanModelStrings(parsed[f]);
            return res.json({ success: true, copy, source: 'hub-brain' });
          }
        }
      } catch (err) {
        console.warn('[Jourvance] Hub brain call fell back to a template:', err.message);
      }
    }

    res.json({ success: true, copy: templateCopy(kind, offerHeadline), source: 'template' });
  });

  return {
    requireUser,
    requireOperator,
    verifyIdToken,
    listWorkspaces,
    loadWorkspace,
    saveWorkspace,
    presentWorkspace,
    sanitizeWorkspace,
    workspaceByShopDomain
  };
}
