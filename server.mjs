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
import { accountFrom, contactFromProfile, e164, flowFromKlaviyo, klaviyoSend, metricHandoffAllowed, nextPath, readFlowCatalog } from './klaviyo.mjs';
import {
  cleanBlockList, couponCodeValue, couponPriceRule, couponSpec, fillMailTokens, footerHtml,
  lineItemFields, noteSuppression, personFields, readUnsubscribe, renderLetter, sendBlockReason,
  signUnsubscribe, storedCoupon, tagOutboundLinks, untranslatedInDocument
} from './email-doc.mjs';
import {
  FLOW_LIMIT, FLOW_TRIGGERS, SMART_EMAIL_HOURS, SMART_SMS_HOURS, TRIGGER_META, applyGraph, buildEnrollment,
  clausesMatch, cleanFlow as cleanFlowGraph, countSendNodes, dateOccurrenceDue, flowShapeError,
  isIanaTimezone, isIpLiteral, isPredictionKey, isPrivateAddress, peekGraph, publicHttpsUrl,
  reentryBlocks, validateFlow
} from './email-flows.mjs';
import {
  WEBHOOK_TOPICS, allowPixel, applyInventoryLevel, applyProductUpdate, claimBehavior,
  cleanBehaviorEvent, commerceBeaconCall, configuredPublicBase, fulfillmentKind,
  lowInventoryQualifies, marketingSubscribed, newPixelKey, pageBeaconScript, pixelKeyOk,
  pixelSnippet, priceDropQualifies, rearmRestock, restockRecipients, restockSnippet,
  shopifyId, signalStarterFlows, stampRestockFired, triggersFromClaim, variantAudience
} from './shopify-signals.mjs';
import {
  BUILT_INS, FOLLOW_UP_NOTE, applyListChange, applyUtm, campaignSchedule, cleanAb, cleanForm, cleanLists,
  cleanPicks, cleanSegment, cleanSegments, cleanUtm, dueRecipients, formVariant, inBuiltIn,
  nextBatchAt, nextSegmentState, publicForm, readConfirm, resolveAudience, segmentDefinition,
  segmentMatches, signConfirm, signupPageScript, smartSkipReason, spinSlice
} from './audience.mjs';
import {
  addRefund, assignSmartSend, commitPredictions, historicSpend, missingHistory, overlayPrediction,
  predictStore, predictionLine, smartSendConflict, storeReadiness
} from './email-predict.mjs';
import {
  applyLinkUtm, applySmsCoupon, cleanAttributionWindows, describeSentHtml, lastTouch, linksToRewrite,
  quietOpenAt, redirectStatus, resolveFeedDocument, rewriteFirstLink, selectFeed, smsCouponPlan, smsDraft,
  smsQuietEnabled, sunsetCandidates, tallyMessages, touchRevenue, unengagedEmails
} from './email-feeds.mjs';
import {
  attributionTouches, channelOf, cleanHoldout, emailTouchFields, enrollChoice,
  enrollmentCount, holdoutReport, inHoldout, linkedFlowIds, orderBelongsTo, splitHoldout
} from './email-map.mjs';

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
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    if (String(req.originalUrl || '').startsWith('/api/webhooks/shopify')) req.rawBody = buf;
  }
}));

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

const FAKE_STORE_DOMAINS = new Set([
  'demo.myshopify.com',
  'scaletech.myshopify.com',
  'luxeglow.myshopify.com',
  'glowbotanics.myshopify.com',
  'rosebotanics.myshopify.com'
]);
const FAKE_VARIANT_IDS = new Set([
  '42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999'
]);
const FAKE_TRACKING_IDS = new Set(['123456789012345', 'C9ABCD123456', 'G-TEST999999']);

function realStoreDomain(shopify) {
  const domain = String(shopify?.storeDomain || '').trim().toLowerCase();
  if (!domain || FAKE_STORE_DOMAINS.has(domain)) return '';
  return domain;
}

function realVariantId(id) {
  const value = String(id || '').trim();
  if (!value || FAKE_VARIANT_IDS.has(value)) return '';
  return value;
}

function realTrackingId(id) {
  const value = String(id || '').trim();
  if (!value || FAKE_TRACKING_IDS.has(value)) return '';
  return value;
}

function adminToken(shopify) {
  return String(shopify?.adminAccessToken || shopify?.storefrontAccessToken || '').trim();
}

function mapShopifyProducts(list) {
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

function sanitizeWorkspace(ws) {
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
function presentWorkspace(ws) {
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

function shopifyHmacOk(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const left = Buffer.from(digest);
  const right = Buffer.from(String(header));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function workspaceByShopDomain(domain) {
  const clean = cleanDomain(domain);
  if (!clean || FAKE_STORE_DOMAINS.has(clean)) return null;
  for (const ws of Object.values(workspaceCache)) {
    if (ws?.shopifyConfig?.status === 'connected' && realStoreDomain(ws.shopifyConfig) === clean) return ws;
  }
  return null;
}

function acceptShopifyWebhook(req, res) {
  const shopDomain = cleanDomain(req.get('x-shopify-shop-domain') || '');
  const ws = workspaceByShopDomain(shopDomain);
  const secret = String(ws?.shopifyConfig?.webhookSecret || '').trim();
  if (!ws || !secret) {
    res.status(401).json({ success: false, error: 'This store has no app API secret saved, so the webhook was refused.' });
    return null;
  }
  if (!shopifyHmacOk(req.rawBody, req.get('x-shopify-hmac-sha256') || '', secret)) {
    res.status(401).json({ success: false, error: 'Shopify signature did not match this store’s app API secret.' });
    return null;
  }
  return ws;
}

const catalogMemoryPath = path.join(__dirname, 'catalog_memory.json');
const behaviorPath = path.join(__dirname, 'behavior.json');
const pixelBuckets = new Map();

function readJsonObject(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function loadCatalog(uid) {
  const bag = readJsonObject(catalogMemoryPath)[uid];
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
}

function saveCatalog(uid, memory) {
  const all = readJsonObject(catalogMemoryPath);
  all[uid] = memory && typeof memory === 'object' ? memory : {};
  try { fs.writeFileSync(catalogMemoryPath, JSON.stringify(all)); } catch (err) {
    console.warn('[Jourvance] Failed saving catalog memory:', err.message);
  }
}

function rememberAdminCatalog(uid, domain, products) {
  if (!uid || !Array.isArray(products) || !products.length) return;
  let memory = loadCatalog(uid);
  for (const product of products.slice(0, 50)) memory = applyProductUpdate(memory, product, domain).memory;
  saveCatalog(uid, memory);
}

function loadBehaviorBag(uid) {
  const bag = readJsonObject(behaviorPath)[uid];
  return {
    events: Array.isArray(bag?.events) ? bag.events : [],
    subscriptions: Array.isArray(bag?.subscriptions) ? bag.subscriptions : []
  };
}

function saveBehaviorBag(uid, bag) {
  const all = readJsonObject(behaviorPath);
  all[uid] = {
    events: (bag?.events || []).slice(-50000),
    subscriptions: (bag?.subscriptions || []).slice(-20000)
  };
  try { fs.writeFileSync(behaviorPath, JSON.stringify(all)); } catch (err) {
    console.warn('[Jourvance] Failed saving behavior:', err.message);
  }
}

function pushBehavior(uid, event) {
  const bag = loadBehaviorBag(uid);
  bag.events.push(event);
  saveBehaviorBag(uid, bag);
}

function behaviorSummary(uid) {
  const events = loadBehaviorBag(uid).events;
  const today = new Date().toISOString().slice(0, 10);
  const last = events.length ? String(events[events.length - 1].at || '') : '';
  return {
    todayCount: events.filter((event) => String(event.at || '').slice(0, 10) === today).length,
    lastEventAt: last || null
  };
}

function savedPrice(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const amount = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return raw.slice(0, 40);
}

function pageTrackFrom(page) {
  const data = page?.data || {};
  return {
    productId: shopifyId(data.shopifyProductId),
    variantId: shopifyId(data.shopifyVariantId),
    price: savedPrice(data.shopifyProductPrice),
    collectionId: shopifyId(data.shopifyCollectionId)
  };
}

function behaviorFields(event) {
  return {
    product_id: event?.productId || '',
    variant_id: event?.variantId || '',
    collection_id: event?.collectionId || '',
    query: event?.query || '',
    price: event?.price || ''
  };
}

function attachBehavior(uid, email, link) {
  const bag = loadBehaviorBag(uid);
  const result = claimBehavior(bag.events, { email, ...(link || {}) });
  if (result.claimed.length) saveBehaviorBag(uid, bag);
  return result;
}

async function enrollClaimedBehavior(uid, contact, claimed) {
  for (const event of triggersFromClaim(claimed)) {
    await enrollFlowsForTrigger(uid, event.type, {
      email: contact.email,
      name: contact.name || '',
      visitorId: contact.visitorId || '',
      phone: contact.phone || ''
    }, personFields(contact.name || ''), {
      reason: event.type,
      dedupe: `${event.type}:${event.id}`,
      occurrence: `${event.type}:${event.id}`,
      event: behaviorFields(event)
    });
  }
}

function watchersForVariant(uid, variantId, since) {
  const behavior = loadBehaviorBag(uid).events;
  const checkouts = loadCheckouts().filter((row) => row.userId === uid).map((row) => ({
    email: row.customerEmail,
    at: row.abandonedAt,
    variantIds: (row.lineItems || []).map((item) => item.variantId || item.variant_id).filter(Boolean)
  }));
  const orders = loadOrders().filter((row) => row.userId === uid && !isDemoRecord(row)).map((row) => ({
    email: row.customerEmail,
    variantIds: (row.lineItems || []).map((item) => item.variantId).filter(Boolean)
  }));
  return variantAudience({ variantId, since, behavior, checkouts, orders });
}

function contactForEnroll(uid, email) {
  const found = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === email);
  return found || { email, name: '', phone: '' };
}

async function enrollPriceDrops(uid, changes) {
  const bag = userProgramBag(uid);
  const flows = bag.flows.filter((flow) => flow.enabled && flow.trigger === 'price_drop');
  if (!flows.length) return 0;
  let added = 0;
  for (const change of changes) {
    for (const flow of flows) {
      if (flow.variantId && flow.variantId !== change.variantId) continue;
      if (!priceDropQualifies(change, flow)) continue;
      const emails = watchersForVariant(uid, change.variantId, Date.now() - flow.lookbackDays * 86400000);
      for (const email of emails) {
        const contact = contactForEnroll(uid, email);
        const result = await enrollFlowsForTrigger(uid, 'price_drop', contact, personFields(contact.name || ''), {
          flowId: flow.id,
          occurrence: `price:${change.variantId}:${change.price}`,
          reason: 'price_drop',
          dedupe: `price:${change.variantId}:${change.price}`,
          event: { variant_id: change.variantId, price: change.price, previous_price: change.previousPrice }
        }, bag);
        added += result.added;
      }
    }
  }
  if (added) writeUserPrograms(uid, bag);
  return added;
}

async function enrollInventorySignals(uid, changes) {
  const bag = userProgramBag(uid);
  const behavior = loadBehaviorBag(uid);
  let added = 0;
  let subsChanged = false;
  for (const change of changes) {
    const lowFlows = bag.flows.filter((flow) => flow.enabled && flow.trigger === 'low_inventory' && (!flow.variantId || flow.variantId === change.variantId) && lowInventoryQualifies(change, flow));
    for (const flow of lowFlows) {
      const emails = watchersForVariant(uid, change.variantId, Date.now() - flow.lookbackDays * 86400000);
      for (const email of emails) {
        const contact = contactForEnroll(uid, email);
        const result = await enrollFlowsForTrigger(uid, 'low_inventory', contact, personFields(contact.name || ''), {
          flowId: flow.id,
          occurrence: `low:${change.variantId}:${change.available}`,
          reason: 'low_inventory',
          event: { variant_id: change.variantId, available: change.available }
        }, bag);
        added += result.added;
      }
    }
    const restockFlows = bag.flows.filter((flow) => flow.enabled && flow.trigger === 'back_in_stock' && (!flow.variantId || flow.variantId === change.variantId));
    for (const flow of restockFlows) {
      const emails = restockRecipients(behavior.subscriptions, change.variantId, change.previousAvailable, change.available, flow.stockMinimum);
      if (emails.length) {
        behavior.subscriptions = stampRestockFired(behavior.subscriptions, change.variantId, emails, new Date().toISOString());
        subsChanged = true;
      }
      for (const email of emails) {
        const contact = contactForEnroll(uid, email);
        const result = await enrollFlowsForTrigger(uid, 'back_in_stock', contact, personFields(contact.name || ''), {
          flowId: flow.id,
          occurrence: `restock:${change.variantId}:${change.available}`,
          reason: 'back_in_stock',
          event: { variant_id: change.variantId, available: change.available }
        }, bag);
        added += result.added;
      }
    }
    const minimums = restockFlows.map((flow) => Number(flow.stockMinimum) || 1);
    if (minimums.length && Number(change.available) < Math.min(...minimums)) {
      behavior.subscriptions = rearmRestock(behavior.subscriptions, change.variantId, change.available, Math.min(...minimums));
      subsChanged = true;
    }
  }
  if (subsChanged) saveBehaviorBag(uid, behavior);
  if (added) writeUserPrograms(uid, bag);
  return added;
}

function signalTopicView(ws) {
  const base = configuredPublicBase(process.env.PUBLIC_BASE_URL);
  const stored = ws?.shopifyConfig?.webhooks && typeof ws.shopifyConfig.webhooks === 'object' ? ws.shopifyConfig.webhooks : {};
  return {
    publicUrl: Boolean(base),
    topics: WEBHOOK_TOPICS.map((topic) => {
      const row = stored[topic.topic] || {};
      const registered = Boolean(base && row.registered === true);
      return {
        topic: topic.topic,
        path: topic.path,
        address: base ? `${base}${topic.path}` : '',
        registered,
        status: registered ? Number(row.status) || 0 : 0,
        detail: registered
          ? (row.detail || 'Shopify has this subscription.')
          : (base ? (row.detail || 'Not registered.') : 'Not registered. A public https address is required before Shopify can send this.')
      };
    })
  };
}

function variantStock(uid, variantId) {
  const row = loadCatalog(uid)[shopifyId(variantId)];
  return row && Number.isFinite(Number(row.available)) ? Number(row.available) : null;
}

function restockReady(uid, enr) {
  const node = (enr?.graph?.nodes || []).find((item) => item.id === enr.nodeId);
  if (!node || node.type !== 'restock' || !node.variantId) return false;
  const available = variantStock(uid, node.variantId);
  if (available == null) return false;
  return available >= (Number(node.minimum) || 1);
}

async function listWorkspaces(uid) {
  if (hubReady) {
    try {
      const listed = await hub.store.docs.list();
      const prefix = `workspace.${safe(uid)}.`;
      const names = (listed?.documents || []).map((d) => d.name).filter((n) => n.startsWith(prefix)).slice(0, 20);
      if (names.length) {
        const got = await hub.store.docs.batchGet(names);
        const docs = (got?.documents || []).filter((d) => d.found && d.document).map((d) => d.document);
        if (docs.length) return docs.map(sanitizeWorkspace);
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

async function loadWorkspace(uid, wsId) {
  if (hubReady) {
    try {
      const r = await hub.store.docs.get(wsDocName(uid, wsId));
      if (r?.document && r.document.userId === uid) return sanitizeWorkspace(r.document);
    } catch {}
  }
  if (workspaceCache[`${uid}:${wsId}`]) return sanitizeWorkspace(workspaceCache[`${uid}:${wsId}`]);
  return null;
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
  const workspaces = (await listWorkspaces(req.user.uid)).map(presentWorkspace);
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
  const domain = cleanDomain(rawDomain);
  if (!domain || FAKE_STORE_DOMAINS.has(domain)) {
    return res.status(400).json({ success: false, error: 'Use that store’s own .myshopify.com domain.' });
  }

  const incomingToken = String(req.body?.adminAccessToken || req.body?.storefrontAccessToken || '').trim();
  const incomingSecret = String(req.body?.webhookSecret || '').trim();
  const sameStore = realStoreDomain(ws.shopifyConfig) === domain;
  const token = incomingToken || (sameStore ? adminToken(ws.shopifyConfig) : '');
  const webhookSecret = incomingSecret || (sameStore ? String(ws.shopifyConfig?.webhookSecret || '').trim() : '');
  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Paste the Admin API access token from this Shopify store. Jourvance cannot read its products, orders, or customers without that store’s own token.'
    });
  }

  let shop;
  let scopes = [];
  try {
    const shopResp = await fetch(`https://${domain}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!shopResp.ok) {
      return res.status(400).json({
        success: false,
        error: 'Shopify refused this token for that store. In the store admin, open Settings → Apps and sales channels → Develop apps, install the app, and paste its Admin API access token.'
      });
    }
    shop = await shopResp.json();
    const scopeResp = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (scopeResp.ok) {
      const scopeData = await scopeResp.json();
      scopes = (scopeData.access_scopes || []).map(s => s.handle).filter(Boolean);
    }
  } catch (err) {
    return res.status(502).json({ success: false, error: 'Shopify did not answer. Check the store domain and try again.' });
  }

  const needed = ['read_products', 'read_orders', 'read_customers', 'write_price_rules'];
  const missingScopes = needed.filter(scope => !scopes.includes(scope));
  const updatedConfig = {
    storeDomain: domain,
    adminAccessToken: token,
    storefrontAccessToken: token,
    shopName: shop?.shop?.name || '',
    currency: shop?.shop?.currency || req.body?.currency || 'USD',
    adminScopes: scopes,
    missingScopes,
    webhookSecret,
    connectedAt: new Date().toISOString(),
    status: 'connected',
    ...(sameStore && ws.shopifyConfig?.pixelKey ? { pixelKey: ws.shopifyConfig.pixelKey } : {}),
    ...(sameStore && ws.shopifyConfig?.webhooks ? { webhooks: ws.shopifyConfig.webhooks } : {})
  };

  const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: updatedConfig });
  const scopeNote = missingScopes.length
    ? ` This store has not granted: ${missingScopes.join(', ')}.`
    : '';
  const webhookNote = webhookSecret
    ? ' Order and checkout webhooks are accepted only when Shopify’s signature matches this app API secret.'
    : ' Order and checkout webhooks stay off until you paste the app API secret from the same custom app.';
  res.json({
    success: true,
    workspace: presentWorkspace(updatedWs),
    shopName: updatedConfig.shopName,
    missingScopes,
    notice: `Shopify accepted the token for ${updatedConfig.shopName || domain}.${scopeNote}${webhookNote}`
  });
});

// Disconnect Shopify Store from Workspace
app.post('/api/workspace/:wsId/shopify/disconnect', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const updatedWs = await saveWorkspace(req.user.uid, req.params.wsId, {
    shopifyConfig: { storeDomain: '', status: 'disconnected' }
  });
  res.json({ success: true, workspace: presentWorkspace(updatedWs) });
});

app.get('/api/workspace/:wsId/shopify/signals', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
  const domain = realStoreDomain(ws.shopifyConfig);
  const connected = ws.shopifyConfig?.status === 'connected' && Boolean(domain);
  let pixelKey = String(ws.shopifyConfig?.pixelKey || '');
  if (connected && !pixelKey) {
    pixelKey = newPixelKey();
    await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: { ...ws.shopifyConfig, pixelKey } });
  }
  const base = configuredPublicBase(process.env.PUBLIC_BASE_URL) || publicBase();
  const summary = behaviorSummary(req.user.uid);
  const topics = signalTopicView(ws);
  res.json({
    success: true,
    connected,
    ...topics,
    lastEventAt: summary.lastEventAt,
    todayCount: summary.todayCount,
    pixelSnippet: connected && pixelKey ? pixelSnippet({ endpoint: `${base}/api/public/shopify-pixel`, shop: domain, key: pixelKey }) : '',
    restockSnippet: connected && pixelKey ? restockSnippet({ endpoint: `${base}/api/public/restock-request`, shop: domain, key: pixelKey }) : '',
    notice: topics.publicUrl ? '' : 'These webhooks are not registered. Shopify cannot reach this app until PUBLIC_BASE_URL is a public https address.'
  });
});

app.post('/api/workspace/:wsId/shopify/webhooks', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
  const base = configuredPublicBase(process.env.PUBLIC_BASE_URL);
  if (!base) {
    return res.json({
      success: true,
      registered: false,
      ...signalTopicView(ws),
      notice: 'No public https address is set, so nothing was registered.'
    });
  }
  const domain = realStoreDomain(ws.shopifyConfig);
  const token = adminToken(ws.shopifyConfig);
  if (!domain || !token || ws.shopifyConfig?.status !== 'connected') {
    return res.status(400).json({ success: false, error: 'Connect the store before registering webhooks.' });
  }
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
  let existing = [];
  try {
    const listed = await fetch(`https://${domain}/admin/api/2024-10/webhooks.json`, { headers, signal: AbortSignal.timeout(8000) });
    const data = await listed.json().catch(() => ({}));
    if (!listed.ok) return res.status(502).json({ success: false, error: 'Shopify did not return the current webhook list.', status: listed.status });
    existing = Array.isArray(data.webhooks) ? data.webhooks : [];
  } catch {
    return res.status(502).json({ success: false, error: 'Shopify did not answer.' });
  }
  const webhooks = {};
  for (const topic of WEBHOOK_TOPICS) {
    const address = `${base}${topic.path}`;
    const found = existing.find((hook) => hook.topic === topic.topic && hook.address === address);
    if (found?.id) {
      webhooks[topic.topic] = { registered: true, status: 200, detail: 'Shopify already has this subscription.' };
      continue;
    }
    try {
      const created = await fetch(`https://${domain}/admin/api/2024-10/webhooks.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ webhook: { topic: topic.topic, address, format: 'json' } }),
        signal: AbortSignal.timeout(8000)
      });
      const data = await created.json().catch(() => ({}));
      if (created.ok && data.webhook?.id) webhooks[topic.topic] = { registered: true, status: created.status, detail: 'Shopify created this subscription.' };
      else webhooks[topic.topic] = { registered: false, status: created.status, detail: (data.errors ? JSON.stringify(data.errors) : `Shopify responded ${created.status}.`).slice(0, 180) };
    } catch {
      webhooks[topic.topic] = { registered: false, status: 0, detail: 'Shopify did not answer.' };
    }
  }
  await saveWorkspace(req.user.uid, req.params.wsId, { shopifyConfig: { ...ws.shopifyConfig, webhooks } });
  const fresh = await loadWorkspace(req.user.uid, req.params.wsId);
  res.json({
    success: true,
    registered: Object.values(webhooks).every((row) => row.registered),
    ...signalTopicView(fresh)
  });
});

// Proxy products from connected Shopify store
app.get('/api/workspace/:wsId/shopify/products', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  const domain = realStoreDomain(ws?.shopifyConfig);
  const token = adminToken(ws?.shopifyConfig);

  if (domain && token) {
    try {
      const resp = await fetch(`https://${domain}/admin/api/2024-10/products.json?limit=50`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const data = await resp.json();
        rememberAdminCatalog(req.user.uid, domain, data?.products);
        const products = mapShopifyProducts(data?.products);
        if (products.length) {
          return res.json({ success: true, products, source: 'shopify-admin', storeDomain: domain });
        }
      }
    } catch (err) {
      console.warn(`[Jourvance] Admin product fetch failed for ${domain}:`, err.message);
    }
  }

  if (domain) {
    try {
      const resp = await fetch(`https://${domain}/products.json?limit=50`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const products = mapShopifyProducts(data?.products);
        if (products.length) {
          return res.json({ success: true, products, source: 'public-catalog', storeDomain: domain });
        }
      }
    } catch (err) {
      console.warn(`[Jourvance] Public product fetch failed for ${domain}:`, err.message);
    }
  }

  res.json({
    success: true,
    products: [],
    source: 'none',
    storeDomain: domain || '',
    notice: domain
      ? 'The store did not return a product list. Nothing is shown in its place.'
      : 'Connect a Shopify store to load products.'
  });
});

// ── Wave 6: Persistent CRM Storage Helpers (Contacts, Orders, Campaigns) ────────
const publicPagesFile = path.join(__dirname, 'public_pages.json');
let publicPageCache = {};
function reloadPublicPageCache() {
  try {
    if (fs.existsSync(publicPagesFile)) {
      publicPageCache = JSON.parse(fs.readFileSync(publicPagesFile, 'utf8'));
    }
  } catch (e) {}
  return publicPageCache;
}
reloadPublicPageCache();

const contactsFilePath = path.join(__dirname, 'contacts.json');
const ordersFilePath = path.join(__dirname, 'orders.json');
const campaignsFilePath = path.join(__dirname, 'campaigns.json');

const SEEDED_EMAILS = new Set([
  'charlotte.v@example.com', 'sophia.m@example.com', 'marcus.t@example.com', 'elena.r@example.com',
  'claire@vipbeauty.com', 'david.k@enterprise.com', 'maya.s@growthlab.io', 'alex.lead@venture.co'
]);
const SEEDED_IDS = new Set([
  'ord_shop_101', 'ord_shop_102', 'ord_shop_103', 'ord_shop_104',
  'cust_shop_101', 'cust_shop_102', 'cust_shop_103', 'cust_shop_104', 'cust_shop_105',
  'camp_1', 'camp_2', 'chk_101', 'chk_102',
  'disc_welcome20', 'disc_growth20', 'disc_vip15',
  'enr_101', 'enr_102', 'enr_103'
]);

function isDemoRecord(row) {
  if (!row || typeof row !== 'object') return false;
  if (SEEDED_IDS.has(row.id)) return true;
  if (typeof row.id === 'string' && /^(sim_|test_order_|ord_shop_|ord_recovered_|ord_w\d+_)/.test(row.id)) return true;
  const email = String(row.email || row.customerEmail || '').toLowerCase();
  if (SEEDED_EMAILS.has(email)) return true;
  if (/^subscriber_\d+@example\.com$/.test(email)) return true;
  if (typeof row.abandonedCheckoutUrl === 'string' && row.abandonedCheckoutUrl.includes('demo.myshopify.com')) return true;
  if (row.shopifyPriceRuleId === 'pr_981240192' || row.shopifyPriceRuleId === 'pr_981240193' || row.shopifyPriceRuleId === 'pr_981240194') return true;
  if (row.openRate === 52.4 && row.clickRate === 24.8) return true;
  return false;
}

function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function loadContacts() {
  return readJsonArray(contactsFilePath).filter(row => !isDemoRecord(row));
}

function saveContacts(contacts) {
  try {
    fs.writeFileSync(contactsFilePath, JSON.stringify(contacts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving contacts:', err.message);
  }
}

function loadOrders() {
  return readJsonArray(ordersFilePath).filter(row => !isDemoRecord(row));
}

function contactOwnerId(c) {
  if (c?.userId) return c.userId;
  const slug = c?.sourceSlug;
  if (slug && publicPageCache[slug]?.userId) return publicPageCache[slug].userId;
  return '';
}

function contactsForUser(uid) {
  return loadContacts().filter(c => contactOwnerId(c) === uid);
}

function pageOwnedBy(slug, uid) {
  return Boolean(slug && publicPageCache[slug]?.userId === uid);
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving orders:', err.message);
  }
}

const predictionsFilePath = path.join(__dirname, 'predictions.json');

function loadPredictionStore() {
  if (!fs.existsSync(predictionsFilePath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(predictionsFilePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function savePredictionStore(store) {
  try {
    fs.writeFileSync(predictionsFilePath, JSON.stringify(store));
  } catch (err) {
    console.warn('[Jourvance] Failed saving predictions:', err.message);
  }
}

function predictionAccount(uid) {
  const account = loadPredictionStore()[uid];
  if (!account || account.method !== 'store_gap_curve' || !account.computedAt) return null;
  return account;
}

function accountOrders(uid) {
  return loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
}

function publicPrediction(result) {
  return {
    ready: result.ready === true,
    orders: result.orders,
    repeatCustomers: result.repeatCustomers,
    historyDays: result.historyDays == null ? null : Math.floor(result.historyDays),
    method: result.ready ? 'store_gap_curve' : null,
    sampleSize: result.ready ? result.sampleSize : null,
    storeGapDays: result.ready ? result.storeGapDays : null,
    computedAt: result.ready ? result.computedAt : null,
    missing: result.ready ? '' : (result.missing || missingHistory(result))
  };
}

async function refreshPredictions(uid) {
  const previous = loadPredictionStore();
  const committed = commitPredictions(previous, uid, accountOrders(uid), Date.now());
  if (JSON.stringify(previous) !== JSON.stringify(committed.store)) savePredictionStore(committed.store);
  const bag = userProgramBag(uid);
  bag.predictionCheckedAt = new Date().toISOString();
  writeUserPrograms(uid, bag);
  await noteSegmentChanges(uid);
  return committed.result;
}

async function refreshPredictionsIfDue(uid) {
  const checked = Date.parse(userProgramBag(uid).predictionCheckedAt || '');
  if (Number.isFinite(checked) && Date.now() - checked < 86400000) return null;
  return refreshPredictions(uid);
}

function cleanFallbackHour(value) {
  if (value == null || value === '') return { ok: true, hour: null };
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { ok: false, error: 'The fallback hour is 0 through 23, or leave it empty.' };
  return { ok: true, hour };
}

function loadCampaigns() {
  return readJsonArray(campaignsFilePath).filter(row => !isDemoRecord(row));
}

function saveCampaigns(campaigns) {
  try {
    fs.writeFileSync(campaignsFilePath, JSON.stringify(campaigns, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving campaigns:', err.message);
  }
}

// ── Wave 7: Persistent Drip Nurture Queue & Sequences ─────────────────────────
const dripsFilePath = path.join(__dirname, 'drips.json');

const INITIAL_DRIP_SEQUENCES = [
  {
    id: 'drip_seq_default',
    name: 'Welcome sequence',
    description: 'Starts when someone joins the list. Replace each note before anyone receives it.',
    triggerType: 'lead_capture',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'step_1',
        stepNumber: 1,
        delayHours: 0,
        subject: 'You are on the list',
        previewText: 'We saved your place',
        body: 'Hey {{first_name}},\n\nThanks for signing up. This is the first note in the sequence. Replace it with the real next step for your offer before anyone receives it.',
        discountVoucher: ''
      },
      {
        id: 'step_2',
        stepNumber: 2,
        delayHours: 24,
        subject: 'What happens after you opt in',
        previewText: 'Replace this with something true about your offer',
        body: 'Hey {{first_name}},\n\nThis is the second note in the sequence. Replace it with a real detail about your offer before anyone receives it.',
        discountVoucher: ''
      },
      {
        id: 'step_3',
        stepNumber: 3,
        delayHours: 48,
        subject: 'Still thinking it over?',
        previewText: 'The last note in this sequence',
        body: 'Hey {{first_name}},\n\nThis is the last note in the sequence. Replace it with a real deadline only if you actually have one.',
        discountVoucher: ''
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'drip_seq_cart_recovery',
    name: 'Shopify Abandoned Cart & Checkout Recovery',
    description: 'Recovers shoppers who entered their details at checkout but dropped off before completing payment.',
    triggerType: 'checkout_abandonment',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'cart_step_1',
        stepNumber: 1,
        delayHours: 1,
        subject: 'Your checkout is still open',
        previewText: 'You can pick up where you left off',
        body: 'Hey {{first_name}},\n\nYou started a checkout and did not finish it. The items were not held aside.\n\nYou can return to the checkout here:\n{{abandoned_checkout_url}}',
        discountVoucher: ''
      },
      {
        id: 'cart_step_2',
        stepNumber: 2,
        delayHours: 24,
        subject: 'Your checkout is still open',
        previewText: 'A reminder to finish the checkout if you still want it',
        body: 'Hey {{first_name}},\n\nThis is a reminder that the checkout was not completed. Nothing was held in inventory.\n\nYou can return to it here:\n{{abandoned_checkout_url}}',
        discountVoucher: ''
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function loadDrips() {
  if (fs.existsSync(dripsFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dripsFilePath, 'utf8'));
      if (data && Array.isArray(data.sequences)) {
        let modified = false;
        for (const initSeq of INITIAL_DRIP_SEQUENCES) {
          if (!data.sequences.some(s => s.id === initSeq.id)) {
            data.sequences.push(initSeq);
            modified = true;
          }
        }
        if (modified) {
          saveDrips(data);
        }
        const cleaned = recomputeDripCounters({
          sequences: data.sequences,
          enrollments: (Array.isArray(data.enrollments) ? data.enrollments : []).filter(row => !isDemoRecord(row))
        });
        saveDrips(cleaned);
        return cleaned;
      }
    } catch {}
  }
  const initial = recomputeDripCounters({
    sequences: INITIAL_DRIP_SEQUENCES,
    enrollments: []
  });
  saveDrips(initial);
  return initial;
}

function recomputeDripCounters(data) {
  for (const seq of data.sequences) {
    if (seq.id === 'drip_seq_default' && /social proof|High-Converting|urgency deadline/i.test(`${seq.name || ''} ${seq.description || ''}`)) {
      seq.name = 'Welcome sequence';
      seq.description = 'Starts when someone joins the list. Replace each note before anyone receives it.';
    }
    for (const step of seq.steps || []) {
      if (typeof step.subject === 'string' && step.subject.includes('1,400+')) {
        step.subject = 'What happens after you opt in';
        step.previewText = 'Replace this with something true about your offer';
        step.body = 'Hey {{first_name}},\n\nThis is a follow-up in the sequence. Replace it with a real detail about your offer before anyone receives it.';
      }
      if (typeof step.body === 'string' && step.body.includes('WELCOME20')) {
        step.subject = 'You are on the list';
        step.previewText = 'We saved your place';
        step.body = 'Hey {{first_name}},\n\nThanks for signing up. Replace this note with the real next step for your offer before anyone receives it.';
        step.discountVoucher = '';
      }
      if (typeof step.body === 'string' && /reserved your order|general inventory|priority dispatch/i.test(step.body)) {
        step.subject = 'Your checkout is still open';
        step.previewText = 'You can pick up where you left off';
        step.body = 'Hey {{first_name}},\n\nYou started a checkout and did not finish it. The items were not held aside.\n\nYou can return to the checkout here:\n{{abandoned_checkout_url}}';
      }
    }
    const mine = data.enrollments.filter(e => e.sequenceId === seq.id);
    seq.activeEnrollments = mine.filter(e => e.status === 'active').length;
    seq.totalCompleted = mine.filter(e => e.status === 'completed').length;
    seq.totalExitedPurchased = mine.filter(e => e.status === 'converted_exit').length;
    seq.attributedSales = null;
  }
  return data;
}

function saveDrips(drips) {
  try {
    fs.writeFileSync(dripsFilePath, JSON.stringify(drips, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving drips:', err.message);
  }
}

// ── Wave 8: Shopify Native Discounts & Abandoned Checkouts Stores ────────────
const discountsFilePath = path.join(__dirname, 'discounts.json');
const checkoutsFilePath = path.join(__dirname, 'checkouts.json');

function loadDiscounts() {
  return readJsonArray(discountsFilePath).filter(row => !isDemoRecord(row));
}

function saveDiscounts(discounts) {
  try {
    fs.writeFileSync(discountsFilePath, JSON.stringify(discounts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving discounts:', err.message);
  }
}

function loadCheckouts() {
  return readJsonArray(checkoutsFilePath).filter(row => !isDemoRecord(row));
}

function saveCheckouts(checkouts) {
  try {
    fs.writeFileSync(checkoutsFilePath, JSON.stringify(checkouts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving checkouts:', err.message);
  }
}

const eventsFilePath = path.join(__dirname, 'events.json');

function loadEvents() {
  return readJsonArray(eventsFilePath);
}

function recordEvent(evt) {
  const events = loadEvents();
  events.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...evt
  });
  const trimmed = events.length > 20000 ? events.slice(-20000) : events;
  try {
    fs.writeFileSync(eventsFilePath, JSON.stringify(trimmed), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving events:', err.message);
  }
}

function mailLinkSecret() {
  return process.env.MAIL_LINK_SECRET || process.env.HUB_API_KEY || '';
}

const redirectsFilePath = path.join(__dirname, 'redirects.json');

function loadRedirects() {
  return readJsonArray(redirectsFilePath);
}

function saveRedirects(rows) {
  try {
    fs.writeFileSync(redirectsFilePath, JSON.stringify((rows || []).slice(-20000)));
  } catch (err) {
    console.warn('[Jourvance] Failed saving redirects:', err.message);
  }
}

function rememberRedirect(uid, url, meta) {
  const code = crypto.randomBytes(9).toString('base64url');
  const sentAt = new Date().toISOString();
  const rows = loadRedirects();
  rows.push({
    code,
    uid: uid || '',
    url,
    email: String(meta?.email || '').toLowerCase(),
    channel: meta?.channel === 'email' ? 'email' : 'sms',
    campaignId: meta?.campaignId || '',
    flowId: meta?.flowId || '',
    nodeId: meta?.nodeId || '',
    sequenceId: meta?.sequenceId || '',
    messageId: meta?.messageId || '',
    sentAt,
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    utm: meta?.utm || {}
  });
  saveRedirects(rows);
  return `${publicBase()}/r/${code}`;
}

function rewritePlainMailLinks(html, meta) {
  let next = String(html || '');
  for (const url of linksToRewrite(next)) {
    const short = rememberRedirect(meta.userId, url, { ...meta, channel: 'email', utm: { utm_source: 'email', utm_medium: meta.medium || 'email' } });
    next = next.split(`href="${url}"`).join(`href="${short}"`);
  }
  return next;
}

function assignEmailTouch(order, uid) {
  const at = Date.parse(order?.createdAt || '');
  const touch = lastTouch({
    at,
    email: order?.customerEmail,
    events: loadEvents().filter((event) => event.userId === uid),
    windows: cleanAttributionWindows(userProgramBag(uid).attributionWindows)
  });
  const revenue = touchRevenue(order, touch);
  if (!touch || revenue == null) return order;
  order.emailTouch = { ...touch, revenue };
  return order;
}

function messageStatsFor(uid, match) {
  const events = loadEvents().filter((event) => event.userId === uid && match(event));
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order) && order.emailTouch && match(order.emailTouch));
  const stats = tallyMessages(events, orders);
  return stats;
}

function sequenceRevenue(uid, sequenceId) {
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order) && order.emailTouch?.sequenceId === sequenceId && order.emailTouch.revenue != null);
  if (!orders.length) return null;
  return Number(orders.reduce((sum, order) => sum + Number(order.emailTouch.revenue), 0).toFixed(2));
}

function catalogRows(uid) {
  const memory = loadCatalog(uid);
  const rows = [];
  for (const [key, row] of Object.entries(memory)) {
    if (key.startsWith('_') || !row || typeof row !== 'object') continue;
    rows.push({
      productId: row.productId || '',
      variantId: row.variantId || key,
      title: row.title || '',
      price: row.price || '',
      compareAt: row.compareAt || '',
      image: row.image || '',
      url: row.url || '',
      createdAt: row.createdAt || '',
      category: row.category || '',
      available: Number.isFinite(row.available) ? row.available : null
    });
  }
  return rows;
}

function feedContextFor(uid, contact, event) {
  if (!uid) return null;
  const email = String(contact?.email || event?.email || '').toLowerCase();
  const checkout = loadCheckouts().find((row) => row.userId === uid && String(row.customerEmail || '').toLowerCase() === email);
  return {
    orders: loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order)),
    catalog: catalogRows(uid),
    behavior: loadBehaviorBag(uid).events,
    checkout: checkout ? { lineItems: checkout.lineItems || [] } : null,
    email,
    triggerProductId: event?.product_id || event?.productId || '',
    now: Date.now()
  };
}

function resolveMailBlocks(blocks, context) {
  if (!context) return blocks;
  if (blocks && typeof blocks === 'object' && !Array.isArray(blocks) && Array.isArray(blocks.sections)) {
    return {
      ...blocks,
      sections: blocks.sections.map((section) => ({
        ...section,
        columns: (section.columns || []).map((column) => ({ ...column, blocks: resolveFeedDocument(column.blocks, context) }))
      }))
    };
  }
  return resolveFeedDocument(Array.isArray(blocks) ? blocks : [], context);
}

async function storeNameFor(uid) {
  const local = Object.values(workspaceCache).find((ws) => ws.userId === uid && ws.shopifyConfig?.shopName);
  if (local?.shopifyConfig?.shopName) return String(local.shopifyConfig.shopName).trim().slice(0, 40);
  try {
    const listed = await listWorkspaces(uid);
    const named = (listed || []).find((ws) => ws?.shopifyConfig?.shopName);
    return String(named?.shopifyConfig?.shopName || '').trim().slice(0, 40);
  } catch {
    return '';
  }
}

async function prepareSmsMessage(uid, message, meta) {
  const draft = smsDraft({ message, storeName: await storeNameFor(uid) });
  let text = draft.text;
  const plan = smsCouponPlan(text);
  const notes = [];
  if (draft.prefixNote) notes.push(draft.prefixNote);
  if (draft.warning) notes.push(draft.warning);
  if (plan.extra.length) notes.push('Only the first coupon tag is used.');
  if (plan.first) {
    const spec = meta?.coupon && meta.coupon.name === plan.first ? meta.coupon : null;
    let code = '';
    if (spec) code = await mintCoupon(uid, meta.email, spec, meta.bag || userProgramBag(uid));
    else notes.push('No matching coupon is saved on this text, so no code was created.');
    if (spec && !code) notes.push('A code was not created.');
    text = applySmsCoupon(text, code || '');
  }
  const found = rewriteFirstLink(text, '\u0000jvlink\u0000');
  if (found.rewritten) {
    const short = rememberRedirect(uid, found.url, { ...meta, channel: 'sms', utm: meta?.utm || { utm_source: 'sms', utm_medium: 'sms' } });
    text = found.text.replace('\u0000jvlink\u0000', short);
  }
  return { text, notes };
}

function knownSend(uid, messageId) {
  const id = String(messageId || '');
  if (!id) return null;
  return loadEvents().find((event) => event.userId === uid && event.messageId === id && (event.type === 'email_sent' || event.type === 'sms_sent')) || null;
}

function publicBase() {
  return String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
}

function unsubscribeUrlFor(uid, email) {
  const token = signUnsubscribe(mailLinkSecret(), uid, email);
  return token ? `${publicBase()}/u/${encodeURIComponent(token)}` : '';
}

function appendCartAttributes(params, fields) {
  for (const [key, value] of Object.entries(fields || {})) {
    if (value) params.set(`attributes[${key}]`, String(value).slice(0, 200));
  }
}

function noteAttrMap(payload) {
  const out = {};
  const list = Array.isArray(payload?.note_attributes) ? payload.note_attributes : [];
  for (const attr of list) {
    if (attr && attr.name != null) out[String(attr.name)] = attr.value == null ? '' : String(attr.value);
  }
  return out;
}



function trackingSnippet(slug, variant, track) {
  const safeSlug = JSON.stringify(String(slug || ''));
  const safeVariant = JSON.stringify(variant === 'b' ? 'b' : 'a');
  const beacon = pageBeaconScript(track || {});
  return `<script>
window.jourvanceVisitor = function() {
  var id = '';
  try {
    var fromLink = new URLSearchParams(location.search).get('jv_vid') || '';
    if (/^[A-Za-z0-9_.-]{6,80}$/.test(fromLink)) id = fromLink;
    if (!id) {
      var m = document.cookie.match(/(?:^|; )jv_vid=([^;]+)/);
      if (m) id = decodeURIComponent(m[1]);
    }
    if (!id) id = localStorage.getItem('jv_vid') || '';
    if (!id) id = 'jv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('jv_vid', id);
    document.cookie = 'jv_vid=' + encodeURIComponent(id) + '; Path=/; Max-Age=31536000; SameSite=Lax';
  } catch (e) {}
  return id;
};
window.jourvanceTrack = function(type, extra) {
  try {
    var params = new URLSearchParams(location.search);
    var body = Object.assign({
      type: type,
      slug: ${safeSlug},
      variant: window.__jvVariant || ${safeVariant},
      visitorId: window.jourvanceVisitor(),
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
      fbclid: params.get('fbclid') || '',
      gclid: params.get('gclid') || '',
      ttclid: params.get('ttclid') || ''
    }, extra || {});
    var payload = JSON.stringify(body);
    if (navigator.sendBeacon) navigator.sendBeacon('/api/public/event', new Blob([payload], { type: 'application/json' }));
    else fetch('/api/public/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
  } catch (e) {}
};
(function() {
  var key = 'jv_seen_' + ${safeSlug} + location.pathname;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch (e) {}
  var path = location.pathname;
  var type = path.indexOf('/thank-you') !== -1 ? 'thank_you_view'
    : (path.indexOf('/upsell') !== -1 || path.indexOf('/downsell') !== -1) ? 'upsell_view'
    : 'page_view';
  var offerType = path.indexOf('/downsell') !== -1 ? 'downsell' : (path.indexOf('/upsell') !== -1 ? 'upsell' : '');
  window.jourvanceTrack(type, offerType ? { offerType: offerType } : undefined);
  ${beacon}
})();
</script>`;
}

function withTracking(html, slug, variant, includeForms, track) {
  const snippet = trackingSnippet(slug, variant, track) + (includeForms ? signupSnippetForSlug(slug) : '');
  return html.includes('</body>') ? html.replace('</body>', snippet + '\n</body>') : html + snippet;
}

// ── Shopify Customer Sync ─────────────────────────────────────────────────────
app.post('/api/workspace/:wsId/shopify/sync-customers', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const domain = realStoreDomain(ws.shopifyConfig);
  let contacts = loadContacts();
  let importedCount = 0;
  let storeReached = false;

  if (domain && adminToken(ws.shopifyConfig)) {
    try {
      const resp = await fetch(`https://${domain}/admin/api/2024-01/customers.json?limit=250`, {
        headers: {
          'X-Shopify-Access-Token': adminToken(ws.shopifyConfig),
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data?.customers)) {
          storeReached = true;
          for (const c of data.customers) {
            const email = (c.email || '').toLowerCase().trim();
            if (!email) continue;
            const existing = contacts.find(existingContact => existingContact.email === email);
            const totalSpent = Number(c.total_spent || 0);
            const ordersCount = Number(c.orders_count || 0);
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || email.split('@')[0];

            if (existing) {
              existing.totalSpent = totalSpent;
              existing.ordersCount = ordersCount;
              existing.name = name || existing.name;
              existing.shopifyCustomerId = String(c.id);
              if (!existing.tags) existing.tags = [];
              if (!existing.tags.includes('Shopify Buyer') && ordersCount > 0) existing.tags.push('Shopify Buyer');
              if (ordersCount >= 2 && !existing.tags.includes('Repeat Buyer')) existing.tags.push('Repeat Buyer');
              if (totalSpent >= 100 && !existing.tags.includes('VIP Customer')) existing.tags.push('VIP Customer');
            } else {
              contacts.push({
                id: `cust_${c.id}`,
                shopifyCustomerId: String(c.id),
                email,
                name,
                phone: c.phone || '',
                totalSpent,
                ordersCount,
                acceptsMarketing: c.email_marketing_consent?.state === 'subscribed',
                tags: [
                  ...(ordersCount > 0 ? ['Shopify Buyer'] : []),
                  ...(totalSpent >= 100 ? ['VIP Customer'] : []),
                  ...(ordersCount >= 2 ? ['Repeat Buyer'] : [])
                ],
                source: `Shopify Store (${domain})`,
                firstSeenAt: c.created_at || new Date().toISOString(),
                lastOrderAt: c.last_order_name ? new Date().toISOString() : undefined
              });
              importedCount++;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[Jourvance] Live customer fetch failed for ${domain}:`, err.message);
    }
  }

  if (storeReached) {
    saveContacts(contacts);
    await saveWorkspace(req.user.uid, req.params.wsId, {
      shopifyConfig: {
        ...(ws.shopifyConfig || {}),
        customerCount: contacts.length,
        lastSyncedAt: new Date().toISOString()
      }
    });
  }

  res.json({
    success: storeReached,
    storeReached,
    importedCount,
    syncedCount: importedCount,
    totalCustomers: contacts.length,
    totalInCrm: contacts.length,
    notice: storeReached
      ? `Imported ${importedCount} customers from Shopify.`
      : 'Shopify was not reached. No customers were imported.'
  });
});

// ── Shopify Orders Sync ───────────────────────────────────────────────────────
app.post('/api/workspace/:wsId/shopify/sync-orders', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const domain = realStoreDomain(ws.shopifyConfig);
  const token = adminToken(ws.shopifyConfig);
  const orders = loadOrders();
  let imported = 0;
  let storeReached = false;
  if (domain && token) {
    try {
      const resp = await fetch(`https://${domain}/admin/api/2024-01/orders.json?status=any&limit=50`, {
        headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        storeReached = true;
        const data = await resp.json();
        for (const o of data.orders || []) {
          const id = String(o.id);
          if (orders.some(existing => String(existing.id) === id)) continue;
          orders.unshift({
            id,
            orderNumber: o.order_number ? `#${o.order_number}` : `#${id.slice(-4)}`,
            customerEmail: (o.email || o.customer?.email || '').toLowerCase(),
            customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' '),
            totalPrice: Number(o.total_price || 0),
            currency: o.currency || 'USD',
            discountCode: o.discount_codes?.[0]?.code || '',
            orderBumpIncluded: false,
            createdAt: o.created_at || new Date().toISOString(),
            source: 'shopify-sync',
            userId: req.user.uid
          });
          imported++;
        }
        if (imported) {
          saveOrders(orders);
          try { await refreshPredictions(req.user.uid); } catch (err) {
            console.warn('[Jourvance] Prediction refresh failed:', err.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[Jourvance] Live order fetch failed for ${domain}:`, err.message);
    }
  }
  if (storeReached) {
    await saveWorkspace(req.user.uid, req.params.wsId, {
      shopifyConfig: {
        ...(ws.shopifyConfig || {}),
        ordersCount: orders.length,
        lastSyncedAt: new Date().toISOString()
      }
    });
  }

  res.json({
    success: storeReached,
    storeReached,
    imported,
    ordersCount: imported,
    totalOrders: orders.length,
    notice: storeReached
      ? `Imported ${imported} new orders from Shopify.`
      : 'Shopify was not reached. No orders were imported.'
  });
});

// ── Wave 8: Shopify Native Discount Code Provisioning API ─────────────────────
app.get('/api/workspace/:wsId/shopify/discounts', requireUser, async (req, res) => {
  const discounts = loadDiscounts();
  res.json({ success: true, discounts });
});

app.post('/api/workspace/:wsId/shopify/create-discount', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });

  const { code, discountType = 'percentage', value = 20, usageLimit = null, isUniquePerLead = false } = req.body || {};
  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ success: false, error: 'A discount code string is required.' });
  }

  const cleanCode = code.trim().toUpperCase();
  const domain = realStoreDomain(ws.shopifyConfig);
  const token = adminToken(ws.shopifyConfig);
  let shopifyPriceRuleId = null;
  let syncedToLiveShopify = false;

  if (domain && token) {
    try {
      const priceRuleBody = {
        price_rule: {
          title: cleanCode,
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: discountType === 'percentage' ? 'percentage' : 'fixed_amount',
          value: discountType === 'percentage' ? `-${Math.abs(Number(value))}` : `-${Math.abs(Number(value)).toFixed(2)}`,
          customer_selection: 'all',
          starts_at: new Date().toISOString(),
          usage_limit: isUniquePerLead ? 1 : (usageLimit ? Number(usageLimit) : null)
        }
      };

      const prResp = await fetch(`https://${domain}/admin/api/2024-01/price_rules.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(priceRuleBody)
      });
      const prData = await prResp.json();
      if (prData.price_rule?.id) {
        shopifyPriceRuleId = String(prData.price_rule.id);
        const dcResp = await fetch(`https://${domain}/admin/api/2024-01/price_rules/${shopifyPriceRuleId}/discount_codes.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ discount_code: { code: cleanCode } })
        });
        const dcData = await dcResp.json();
        if (dcData.discount_code?.id) {
          syncedToLiveShopify = true;
        }
      }
    } catch (apiErr) {
      console.warn('[Jourvance] Live Shopify discount provisioning warning:', apiErr.message);
    }
  }

  const discounts = loadDiscounts();
  const existingIdx = discounts.findIndex(d => d.code === cleanCode);
  const discountRule = {
    id: `disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    code: cleanCode,
    discountType: discountType === 'fixed_amount' ? 'fixed_amount' : 'percentage',
    value: Number(value) || 20,
    usageLimit: isUniquePerLead ? 1 : (usageLimit ? Number(usageLimit) : null),
    isUniquePerLead: Boolean(isUniquePerLead),
    shopifyPriceRuleId,
    createdAt: new Date().toISOString(),
    status: 'active',
    syncedToLiveShopify
  };

  if (existingIdx >= 0) {
    discounts[existingIdx] = { ...discounts[existingIdx], ...discountRule };
  } else {
    discounts.unshift(discountRule);
  }
  saveDiscounts(discounts);

  res.json({
    success: true,
    discount: discountRule,
    message: syncedToLiveShopify
      ? `Discount code ${cleanCode} is active in Shopify.`
      : `Discount code ${cleanCode} is saved here. Shopify was not updated.`
  });
});

// ── Real-Time Shopify Order Ingestion Webhook (Closed-Loop Attribution) ────────
app.post(['/api/webhooks/shopify/orders-create', '/api/webhooks/shopify/order-created'], async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const payload = req.body || {};
  const orderId = String(payload.id || payload.order_id || `ord_${Date.now()}`);
  const totalPrice = Number(payload.total_price || payload.totalPrice || 0);
  const subtotalPrice = Number(payload.subtotal_price || payload.subtotalPrice || totalPrice);
  const currency = payload.currency || 'USD';
  const customer = payload.customer || {};
  const customerEmail = (customer.email || payload.email || payload.customerEmail || '').toLowerCase().trim();
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || payload.name || (customerEmail ? customerEmail.split('@')[0] : 'Customer');
  const discountCodes = Array.isArray(payload.discount_codes)
    ? payload.discount_codes.map(d => (typeof d === 'string' ? d : d.code || '')).filter(Boolean)
    : (payload.discountCode ? [payload.discountCode] : []);
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : (payload.lineItems || []);

  const orders = loadOrders();
  const existingOrder = orders.find(o => String(o.id) === orderId);
  if (existingOrder) {
    return res.status(200).json({ success: true, duplicate: true, message: 'Order already recorded (idempotent)', orderId });
  }

  const attrs = noteAttrMap(payload);
  let attributedSlug = attrs.jv_slug || attrs.slug || attrs.funnel_slug || payload.slug || '';
  let attributedNodeId = attrs.jv_node || payload.attributedNodeId || '';
  let journeyId = attrs.jv_journey || '';
  let visitorId = String(attrs.jv_vid || '').slice(0, 80);
  let attributedAdId = payload.attributedAdId || '';
  let bumpIncluded = Boolean(payload.orderBumpIncluded);
  let variant = attrs.variant || attrs.ab_variant || payload.variant || '';
  if (attrs.bump_accepted === 'true') bumpIncluded = true;
  const orderUtm = {
    utm_source: attrs.utm_source || '',
    utm_medium: attrs.utm_medium || '',
    utm_campaign: attrs.utm_campaign || '',
    utm_content: attrs.utm_content || '',
    fbclid: attrs.fbclid || '',
    gclid: attrs.gclid || '',
    ttclid: attrs.ttclid || ''
  };

  if (visitorId) {
    const prior = loadEvents().filter(e => e.visitorId === visitorId && (e.userId === shopWs.userId || pageOwnedBy(e.slug, shopWs.userId)));
    const earliest = prior[0];
    const latest = prior[prior.length - 1];
    if (!attributedSlug && latest?.slug) attributedSlug = latest.slug;
    if (!attributedNodeId && latest?.nodeId) attributedNodeId = latest.nodeId;
    if (!journeyId && latest?.journeyId) journeyId = latest.journeyId;
    for (const key of Object.keys(orderUtm)) {
      if (!orderUtm[key] && earliest?.[key]) orderUtm[key] = earliest[key];
    }
  }

  // 2. Check discount code match against public pages
  if (!attributedSlug && discountCodes.length > 0) {
    const pages = reloadPublicPageCache();
    for (const code of discountCodes) {
      const upperCode = code.toUpperCase();
      for (const [slugKey, p] of Object.entries(pages)) {
        if (p && typeof p === 'object') {
          const d = p.data || {};
          if (p.userId === shopWs.userId && (
              (d.discountCode && d.discountCode.toUpperCase() === upperCode) ||
              (d.exitIntentDiscountCode && d.exitIntentDiscountCode.toUpperCase() === upperCode) ||
              (d.bounceBackDiscountCode && d.bounceBackDiscountCode.toUpperCase() === upperCode) ||
              (d.variantB?.discountCode && d.variantB.discountCode.toUpperCase() === upperCode))) {
            attributedSlug = p.slug || slugKey;
            attributedNodeId = p.nodeId || attributedNodeId;
            break;
          }
        }
      }
      if (attributedSlug) break;
    }
  }

  // 3. Fallback: match customer email in contacts.json
  const contacts = loadContacts();
  let contact = contacts.find(c => c.email === customerEmail && contactOwnerId(c) === shopWs.userId);
  if (!attributedSlug && contact && contact.sourceSlug && pageOwnedBy(contact.sourceSlug, shopWs.userId)) {
    attributedSlug = contact.sourceSlug;
  }
  if (attributedSlug && !pageOwnedBy(attributedSlug, shopWs.userId)) {
    attributedSlug = '';
    attributedNodeId = '';
    journeyId = '';
  }

  // 4. Detect order bump item in line items
  if (!bumpIncluded) {
    for (const item of lineItems) {
      const title = (item.title || item.name || '').toLowerCase();
      if (title.includes('bump') || title.includes('add-on') || title.includes('addon')) {
        bumpIncluded = true;
      }
    }
  }

  // Update or create customer record in contacts.json
  let claimedOrder = [];
  if (customerEmail) {
    const linkedOrder = attachBehavior(shopWs.userId, customerEmail, {
      visitorId,
      checkoutToken: String(payload.checkout_token || payload.token || '')
    });
    claimedOrder = linkedOrder.claimed;
    if (contact) {
      contact.ordersCount = (contact.ordersCount || 0) + 1;
      contact.totalSpent = Number(((contact.totalSpent || 0) + totalPrice).toFixed(2));
      contact.lastOrderAt = new Date().toISOString();
      if (!contact.name && customerName) contact.name = customerName;
      if (visitorId && !contact.visitorId) contact.visitorId = visitorId;
      if (linkedOrder.clientId && !contact.clientId) contact.clientId = linkedOrder.clientId;
      if (!contact.userId) contact.userId = shopWs.userId;
      if (!contact.tags) contact.tags = [];
      if (!contact.tags.includes('Shopify Buyer')) contact.tags.push('Shopify Buyer');
      if (contact.ordersCount >= 2 && !contact.tags.includes('Repeat Buyer')) contact.tags.push('Repeat Buyer');
      if (contact.totalSpent >= 100 && !contact.tags.includes('VIP Customer')) contact.tags.push('VIP Customer');
      if (bumpIncluded && !contact.tags.includes('Order Bump Taker')) contact.tags.push('Order Bump Taker');
    } else {
      contact = {
        id: `cust_${Date.now()}`,
        email: customerEmail,
        name: customerName,
        phone: customer.phone || payload.phone || '',
        totalSpent: totalPrice,
        ordersCount: 1,
        acceptsMarketing: customer.email_marketing_consent?.state === 'subscribed',
      visitorId: visitorId || undefined,
      clientId: linkedOrder.clientId || undefined,
      userId: shopWs.userId,
        tags: ['Shopify Buyer', ...(totalPrice >= 100 ? ['VIP Customer'] : []), ...(bumpIncluded ? ['Order Bump Taker'] : [])],
        source: attributedSlug ? `Funnel /p/${attributedSlug}` : 'Shopify Direct',
        firstSeenAt: new Date().toISOString(),
        lastOrderAt: new Date().toISOString()
      };
      contacts.push(contact);
    }
    saveContacts(contacts);

    // Smart Exit on Purchase for Drip Sequences
    try {
      const dripsData = loadDrips();
      let modifiedDrip = false;
      for (const enr of dripsData.enrollments) {
        if (enr.customerEmail === customerEmail && enr.status === 'active' && (!enr.userId || enr.userId === shopWs.userId)) {
          enr.status = 'converted_exit';
          enr.convertedAt = new Date().toISOString();
          modifiedDrip = true;
          const seq = dripsData.sequences.find(s => s.id === enr.sequenceId);
          if (seq) {
            seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
            seq.totalExitedPurchased = (seq.totalExitedPurchased || 0) + 1;
          }
        }
      }
      if (modifiedDrip) {
        saveDrips(dripsData);
      }
    } catch (e) {
      console.warn('[Jourvance] Smart exit on purchase drip error:', e.message);
    }
  }

  // Wave 8: Shopify Admin Order Tagging
  const shopifyTagsApplied = ['Jourvance Funnel'];
  if (attributedSlug) shopifyTagsApplied.push(`Funnel: ${attributedSlug}`);
  if (bumpIncluded) shopifyTagsApplied.push('Order-Bump-Accepted');
  if (variant) shopifyTagsApplied.push(`Variant: ${String(variant).toUpperCase()}`);

  // Wave 8: Closed-Loop Abandoned Checkout Recovery
  let recoveredCheckoutId = null;
  try {
    const checkouts = loadCheckouts();
    let checkoutModified = false;
    for (const chk of checkouts) {
      if ((chk.customerEmail === customerEmail || (payload.cart_token && chk.token === payload.cart_token) || (payload.token && chk.token === payload.token)) && chk.recoveryStatus !== 'recovered') {
        chk.recoveryStatus = 'recovered';
        chk.recoveredAt = new Date().toISOString();
        chk.recoveredOrderId = orderId;
        recoveredCheckoutId = chk.id;
        checkoutModified = true;
      }
    }
    if (checkoutModified) {
      saveCheckouts(checkouts);
    }
  } catch (chkErr) {
    console.warn('[Jourvance] Failed to update recovered checkout in orders-create:', chkErr.message);
  }

  // Record Order
  const orderRecord = {
    id: orderId,
    orderNumber: payload.order_number ? `#${payload.order_number}` : `#${orderId.slice(-4)}`,
    totalPrice,
    subtotalPrice,
    currency,
    customerEmail,
    customerName,
    discountCode: discountCodes[0] || '',
    lineItems: lineItems.map(it => ({
      title: it.title || it.name || 'Product',
      productId: String(it.product_id || it.productId || '').replace(/\D/g, '').slice(0, 40),
      variantId: String(it.variant_id || it.variantId || ''),
      quantity: Number(it.quantity || 1),
      price: Number(it.price || 0)
    })),
    orderBumpIncluded: bumpIncluded,
    attributedSlug: attributedSlug || undefined,
    attributedNodeId: attributedNodeId || undefined,
    attributedAdId: attributedAdId || undefined,
    visitorId: visitorId || undefined,
    journeyId: journeyId || (attributedSlug && publicPageCache[attributedSlug]?.journeyId) || undefined,
    userId: shopWs.userId,
    ...orderUtm,
    checkoutChannel: channelOf(orderUtm),
    shopifyTagsApplied,
    createdAt: Number.isFinite(Date.parse(payload.created_at || payload.createdAt || '')) ? new Date(payload.created_at || payload.createdAt).toISOString() : new Date().toISOString()
  };

  assignEmailTouch(orderRecord, shopWs.userId);
  orders.unshift(orderRecord);
  saveOrders(orders);
  recordEvent({
    type: 'order',
    slug: attributedSlug || '',
    journeyId: orderRecord.journeyId || '',
    nodeId: attributedNodeId || (attributedSlug && publicPageCache[attributedSlug]?.nodeId) || '',
    userId: orderRecord.userId || '',
    visitorId: visitorId || '',
    email: customerEmail,
    amount: totalPrice,
    bump: bumpIncluded,
    ...orderUtm
  });

  // If matched to a public page, update live financial stats
  if (attributedSlug && publicPageCache[attributedSlug]) {
    const page = publicPageCache[attributedSlug];
    if (page.data) {
      page.data.liveRevenue = Number(((page.data.liveRevenue || 0) + totalPrice).toFixed(2));
      page.data.liveOrders = (page.data.liveOrders || 0) + 1;
      if (bumpIncluded) {
        page.data.liveBumpOrders = (page.data.liveBumpOrders || 0) + 1;
      }
    }
  }

  const orderMail = customerEmail
    ? await sendTransactional(shopWs.userId, 'order_confirmation', {
      to: customerEmail,
      name: customerName,
      dedupeKey: `order_confirmation:${orderId}`,
      vars: orderMailVars(orderRecord),
      visitorId
    })
    : { status: 'no_address' };
  if (customerEmail) {
    enrollAutomation(shopWs.userId, 'post_purchase', {
      email: customerEmail,
      name: customerName,
      visitorId
    }, orderMailVars(orderRecord));
    const handoffContext = {
      reason: 'order',
      dedupe: `order:${orderId}`,
      journeyId: orderRecord.journeyId || '',
      slug: attributedSlug || '',
      orderId,
      value: totalPrice
    };
    await enrollFlowsForTrigger(shopWs.userId, 'order_paid', {
      email: customerEmail,
      name: customerName,
      visitorId,
      phone: ''
    }, orderMailVars(orderRecord), handoffContext);
    await enrollClaimedBehavior(shopWs.userId, { email: customerEmail, name: customerName, visitorId }, claimedOrder);
    try { await refreshPredictions(shopWs.userId); } catch (err) {
      console.warn('[Jourvance] Prediction refresh failed:', err.message);
    }
    await noteSegmentChanges(shopWs.userId);
    await handoffMapNodes(shopWs.userId, 'order_paid', {
      email: customerEmail,
      name: customerName,
      visitorId,
      phone: ''
    }, handoffContext);
  }

  res.status(200).json({
    success: true,
    orderId,
    order: orderRecord,
    recoveredCheckoutId,
    transactional: orderMail,
    attributed: Boolean(attributedSlug || attributedNodeId),
    attributedSlug,
    attributedNodeId,
    attributedToNodeId: attributedNodeId,
    attributedRevenue: totalPrice,
    totalPrice,
    bumpIncluded,
    customer: customerEmail,
    shopifyTagsApplied
  });
});

// ── Interactive Order Simulator (For 1-Click Testing) ─────────────────────────
app.post('/api/workspace/:wsId/shopify/simulate-order', requireUser, async (req, res) => {
  return res.status(410).json({ success: false, error: 'Order simulation is off. Orders show up when Shopify sends a real orders/create webhook.' });
});

// ── Wave 8: Shopify Abandoned Checkout Ingestion Webhooks ─────────────────────
app.post(['/api/webhooks/shopify/checkouts-create', '/api/webhooks/shopify/checkouts-update'], async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const payload = req.body || {};
  const attrs = noteAttrMap(payload);
  const token = String(payload.token || payload.id || `tok_${Date.now()}`);
  const customer = payload.customer || {};
  const customerEmail = (payload.email || customer.email || '').toLowerCase().trim();
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || payload.name || (customerEmail ? customerEmail.split('@')[0] : 'Shopper');
  const totalPrice = Number(payload.total_price || payload.subtotal_price || 0);
  const currency = payload.currency || 'USD';
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const shopDomain = realStoreDomain(shopWs.shopifyConfig);
  const abandonedCheckoutUrl = payload.abandoned_checkout_url || (shopDomain ? `https://${shopDomain}/checkouts/cn/${encodeURIComponent(token)}/recover` : '');
  const checkoutVisitor = String(attrs.jv_vid || '').slice(0, 80);
  const checkoutSlug = pageOwnedBy(attrs.jv_slug, shopWs.userId) ? attrs.jv_slug : '';

  if (!customerEmail || !customerEmail.includes('@')) {
    return res.status(200).json({ success: true, message: 'Checkout logged without email.' });
  }

  // Check if this shopper already bought recently
  const orders = loadOrders();
  const hasBought = orders.some(o => o.userId === shopWs.userId && o.customerEmail === customerEmail && new Date(o.createdAt).getTime() >= new Date(payload.created_at || Date.now() - 300000).getTime());
  if (hasBought) {
    return res.status(200).json({ success: true, message: 'Customer already completed order.' });
  }

  const checkouts = loadCheckouts();
  const existingIdx = checkouts.findIndex(c => c.userId === shopWs.userId && (c.token === token || (c.customerEmail === customerEmail && c.recoveryStatus === 'pending')));

  let checkoutRecord;
  if (existingIdx >= 0) {
    checkouts[existingIdx].totalPrice = totalPrice || checkouts[existingIdx].totalPrice;
    checkouts[existingIdx].lineItems = lineItems.length ? lineItems.map(li => ({
      title: li.title || li.name || '',
      variantId: String(li.variant_id || li.variantId || ''),
      quantity: Number(li.quantity || 1),
      price: Number(li.price || 0)
    })) : checkouts[existingIdx].lineItems;
    checkouts[existingIdx].abandonedCheckoutUrl = abandonedCheckoutUrl || checkouts[existingIdx].abandonedCheckoutUrl;
    if (checkoutVisitor && !checkouts[existingIdx].visitorId) checkouts[existingIdx].visitorId = checkoutVisitor;
    if (checkoutSlug && !checkouts[existingIdx].sourceSlug) checkouts[existingIdx].sourceSlug = checkoutSlug;
    checkoutRecord = checkouts[existingIdx];
  } else {
    checkoutRecord = {
      id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      token,
      userId: shopWs.userId,
      visitorId: checkoutVisitor,
      journeyId: attrs.jv_journey || '',
      sourceSlug: checkoutSlug,
      customerEmail,
      customerName,
      totalPrice,
      currency,
      lineItems: lineItems.map(li => ({
        title: li.title || li.name || '',
        variantId: String(li.variant_id || li.variantId || ''),
        quantity: Number(li.quantity || 1),
        price: Number(li.price || 0)
      })),
      abandonedCheckoutUrl,
      abandonedAt: new Date().toISOString(),
      recoveryStatus: 'pending'
    };
    checkouts.unshift(checkoutRecord);
  }
  saveCheckouts(checkouts);
  const linkedCheckout = attachBehavior(shopWs.userId, customerEmail, { visitorId: checkoutVisitor, checkoutToken: token });
  if (linkedCheckout.clientId) {
    const contacts = loadContacts();
    const row = contacts.find((item) => item.email === customerEmail && contactOwnerId(item) === shopWs.userId);
    if (row && !row.clientId) {
      row.clientId = linkedCheckout.clientId;
      if (checkoutVisitor && !row.visitorId) row.visitorId = checkoutVisitor;
      saveContacts(contacts);
    }
  }

  // Auto-enroll in cart recovery drip sequence
  try {
    const dripsData = loadDrips();
    const cartSeq = dripsData.sequences.find(s => s.triggerType === 'checkout_abandonment');
    if (cartSeq && !klaviyoIsSender(shopWs.userId)) {
      const alreadyActive = dripsData.enrollments.some(e => e.userId === shopWs.userId && e.customerEmail === customerEmail && e.sequenceId === cartSeq.id && e.status === 'active');
      if (!alreadyActive) {
        dripsData.enrollments.unshift({
          id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sequenceId: cartSeq.id,
          userId: shopWs.userId,
          visitorId: checkoutVisitor,
          customerEmail,
          customerName,
          sourceSlug: checkoutSlug || 'cart_recovery',
          currentStepIndex: 0,
          status: 'active',
          enrolledAt: new Date().toISOString(),
          nextStepDueAt: new Date(Date.now() + 3600000).toISOString(),
          history: []
        });
        cartSeq.activeEnrollments = (cartSeq.activeEnrollments || 0) + 1;
        saveDrips(dripsData);
      }
    }
    let handoffJourney = '';
    if (checkoutSlug && publicPageCache[checkoutSlug]?.userId === shopWs.userId) {
      handoffJourney = publicPageCache[checkoutSlug].journeyId || '';
    }
    if (!handoffJourney && attrs.jv_journey) {
      const journey = await loadJourney(shopWs.userId, attrs.jv_journey);
      if (journey?.userId === shopWs.userId) handoffJourney = journey.id;
    }
    const handoffContext = {
      reason: 'checkout',
      dedupe: `checkout:${token}`,
      journeyId: handoffJourney,
      slug: checkoutSlug,
      checkoutUrl: abandonedCheckoutUrl
    };
    await enrollFlowsForTrigger(shopWs.userId, 'checkout_abandonment', {
      email: customerEmail,
      name: customerName,
      visitorId: checkoutVisitor,
      phone: ''
    }, { first_name: String(customerName || '').trim().split(/\s+/)[0] || 'there' }, handoffContext);
    await enrollClaimedBehavior(shopWs.userId, { email: customerEmail, name: customerName, visitorId: checkoutVisitor }, linkedCheckout.claimed);
    await noteSegmentChanges(shopWs.userId);
    await handoffMapNodes(shopWs.userId, 'checkout_abandonment', {
      email: customerEmail,
      name: customerName,
      visitorId: checkoutVisitor
    }, handoffContext);
  } catch (err) {
    console.warn('[Jourvance] Failed auto-enrolling abandoned checkout in drip:', err.message);
  }

  res.status(200).json({ success: true, message: 'Abandoned checkout captured.', checkout: checkoutRecord });
});

function trackingLineFrom(payload) {
  const number = payload?.tracking_number || (Array.isArray(payload?.tracking_numbers) ? payload.tracking_numbers[0] : '');
  const url = payload?.tracking_url || (Array.isArray(payload?.tracking_urls) ? payload.tracking_urls[0] : '');
  const parts = [number ? `Tracking number: ${number}` : '', url ? String(url) : ''].filter(Boolean);
  return parts.length ? parts.join('\n') : 'Tracking was not included on this fulfillment.';
}

app.post(['/api/webhooks/shopify/fulfillments-create', '/api/webhooks/shopify/fulfillments-update'], async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const payload = req.body || {};
  const fulfillmentId = String(payload.id || '');
  const orderId = String(payload.order_id || '');
  const trackingNumber = String(payload.tracking_number || (Array.isArray(payload.tracking_numbers) ? payload.tracking_numbers[0] : '') || '');
  const orders = loadOrders();
  const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
  const email = String(payload.email || payload.destination?.email || order?.customerEmail || '').toLowerCase().trim();
  const name = order?.customerName || '';
  const mail = await sendTransactional(shopWs.userId, 'shipping_confirmation', {
    to: email,
    name,
    dedupeKey: `shipping_confirmation:${fulfillmentId || orderId}:${trackingNumber || 'none'}`,
    vars: orderMailVars(order || { id: orderId, customerName: name, currency: payload.currency }, {
      name,
      trackingLine: trackingLineFrom(payload),
      currency: payload.currency
    }),
    visitorId: order?.visitorId || ''
  });
  const kind = fulfillmentKind(payload);
  let enrolled = 0;
  if (email) {
    recordEvent({ type: kind, userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
    const result = await enrollFlowsForTrigger(shopWs.userId, kind, {
      email,
      name,
      visitorId: order?.visitorId || ''
    }, orderMailVars(order || { id: orderId, customerName: name, currency: payload.currency }, {
      name,
      trackingLine: trackingLineFrom(payload),
      currency: payload.currency
    }), {
      reason: kind,
      dedupe: `${kind}:${fulfillmentId || orderId}`,
      occurrence: `${kind}:${fulfillmentId || orderId}`,
      event: { order_id: orderId, fulfillment_status: String(payload.fulfillment_status || payload.status || '') }
    });
    enrolled = result.added;
  }
  res.status(200).json({ success: true, transactional: mail, trigger: kind, enrolled });
});

app.post(['/api/webhooks/shopify/orders-cancelled', '/api/webhooks/shopify/orders-canceled'], async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const payload = req.body || {};
  const orderId = String(payload.id || payload.order_id || '');
  const orders = loadOrders();
  const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
  const customer = payload.customer || {};
  const email = String(customer.email || payload.email || order?.customerEmail || '').toLowerCase().trim();
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || order?.customerName || '';
  const mail = await sendTransactional(shopWs.userId, 'order_cancelled', {
    to: email,
    name,
    dedupeKey: orderId ? `order_cancelled:${orderId}` : '',
    vars: orderMailVars(order || {
      id: orderId,
      orderNumber: payload.order_number ? `#${payload.order_number}` : '',
      customerName: name,
      totalPrice: Number(payload.total_price || 0),
      currency: payload.currency || 'USD'
    }),
    visitorId: order?.visitorId || ''
  });
  let enrolled = 0;
  if (email) {
    recordEvent({ type: 'order_cancelled', userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
    const result = await enrollFlowsForTrigger(shopWs.userId, 'order_cancelled', {
      email,
      name,
      visitorId: order?.visitorId || ''
    }, orderMailVars(order || {
      id: orderId,
      orderNumber: payload.order_number ? `#${payload.order_number}` : '',
      customerName: name,
      totalPrice: Number(payload.total_price || 0),
      currency: payload.currency || 'USD'
    }), {
      reason: 'order_cancelled',
      dedupe: orderId ? `order_cancelled:${orderId}` : '',
      occurrence: orderId ? `order_cancelled:${orderId}` : '',
      event: { order_id: orderId }
    });
    enrolled = result.added;
  }
  res.status(200).json({ success: true, transactional: mail, trigger: 'order_cancelled', enrolled });
});

app.post('/api/webhooks/shopify/refunds-create', async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const payload = req.body || {};
  const refundId = String(payload.id || '');
  const orderId = String(payload.order_id || '');
  const orders = loadOrders();
  const order = orders.find((row) => row.userId === shopWs.userId && String(row.id) === orderId);
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  const refundAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  if (order) {
    const recorded = addRefund(order, { id: refundId, amount: refundAmount > 0 ? refundAmount : null, at: new Date().toISOString() });
    if (recorded.added) {
      Object.assign(order, recorded.order);
      if (order.emailTouch) {
        const revenue = touchRevenue(order, order.emailTouch);
        if (revenue == null) delete order.emailTouch.revenue;
        else order.emailTouch.revenue = revenue;
      }
      saveOrders(orders);
      try { await refreshPredictions(shopWs.userId); } catch (err) {
        console.warn('[Jourvance] Prediction refresh failed:', err.message);
      }
    }
  }
  const email = String(order?.customerEmail || '').toLowerCase().trim();
  const mail = await sendTransactional(shopWs.userId, 'refund', {
    to: email,
    name: order?.customerName || '',
    dedupeKey: refundId ? `refund:${refundId}` : '',
    vars: orderMailVars(order || { id: orderId }, {
      refundAmount: refundAmount > 0 ? `The amount on the notice is ${refundAmount.toFixed(2)} ${payload.currency || order?.currency || 'USD'}.` : '',
      currency: payload.currency || order?.currency
    }),
    visitorId: order?.visitorId || ''
  });
  let enrolled = 0;
  if (email) {
    recordEvent({ type: 'order_refunded', userId: shopWs.userId, email, visitorId: order?.visitorId || '', orderId });
    const result = await enrollFlowsForTrigger(shopWs.userId, 'order_refunded', {
      email,
      name: order?.customerName || '',
      visitorId: order?.visitorId || ''
    }, orderMailVars(order || { id: orderId }, {
      refundAmount: refundAmount > 0 ? `The amount on the notice is ${refundAmount.toFixed(2)} ${payload.currency || order?.currency || 'USD'}.` : '',
      currency: payload.currency || order?.currency
    }), {
      reason: 'order_refunded',
      dedupe: refundId ? `refund:${refundId}` : '',
      occurrence: refundId ? `order_refunded:${refundId}` : '',
      event: { order_id: orderId, refund_id: refundId }
    });
    enrolled = result.added;
  }
  res.status(200).json({ success: true, transactional: mail, trigger: 'order_refunded', enrolled });
});

app.post('/api/webhooks/shopify/products-update', async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const applied = applyProductUpdate(loadCatalog(shopWs.userId), req.body || {}, realStoreDomain(shopWs.shopifyConfig));
  saveCatalog(shopWs.userId, applied.memory);
  const enrolled = await enrollPriceDrops(shopWs.userId, applied.changes);
  res.status(200).json({ success: true, variants: applied.changes.length, enrolled });
});

app.post('/api/webhooks/shopify/inventory-levels-update', async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const applied = applyInventoryLevel(loadCatalog(shopWs.userId), req.body || {});
  saveCatalog(shopWs.userId, applied.memory);
  const enrolled = await enrollInventorySignals(shopWs.userId, applied.changes);
  res.status(200).json({ success: true, variants: applied.changes.length, enrolled });
});

app.post('/api/webhooks/shopify/customers-update', async (req, res) => {
  const shopWs = acceptShopifyWebhook(req, res);
  if (!shopWs) return;
  const customer = req.body || {};
  const email = String(customer.email || '').trim().toLowerCase();
  const state = marketingSubscribed(customer);
  if (!email || state == null) return res.status(200).json({ success: true, updated: false });
  const contacts = loadContacts();
  const contact = contacts.find((row) => row.email === email && contactOwnerId(row) === shopWs.userId);
  if (!contact) return res.status(200).json({ success: true, updated: false });
  contact.acceptsMarketing = state;
  saveContacts(contacts);
  await noteSegmentChanges(shopWs.userId);
  res.status(200).json({ success: true, updated: true });
});

app.get('/api/workspace/:wsId/shopify/abandoned-checkouts', requireUser, async (req, res) => {
  const ws = await loadWorkspace(req.user.uid, req.params.wsId);
  if (!ws) return res.status(404).json({ success: false, error: 'Workspace not found.' });
  const checkouts = loadCheckouts().filter(c => c.userId === req.user.uid);
  res.json({ success: true, checkouts });
});

app.post('/api/workspace/:wsId/shopify/simulate-abandoned-checkout', requireUser, async (req, res) => {
  return res.status(410).json({ success: false, error: 'Checkout simulation is off. Abandoned checkouts show up from the Shopify checkouts webhook.' });
});

// ── Email programs: automations + Shopify transactional letters ───────────────
// Letters stay off until this account turns them on. A send happens only after the
// hub accepts it. Shopify keeps its own notification until the merchant turns that
// one off in Shopify admin; these routes never claim that happened.

const emailProgramsFilePath = path.join(__dirname, 'email_programs.json');

function block(id, kind, text, extra) {
  return { id, kind, text: text || '', ...(extra || {}) };
}

const TRANSACTIONAL_DEFAULTS = [
  {
    id: 'order_confirmation',
    name: 'Order confirmation',
    shopifyNotification: 'Order confirmation',
    shopifyTopic: 'orders/create',
    subject: 'We received order {{order_number}}',
    blocks: [
      block('oc_h', 'heading', 'Order {{order_number}}'),
      block('oc_b', 'text', 'Hi {{first_name}},\n\nWe received your order for {{order_total}} {{currency}}.\n\n{{line_items}}\n\nReply to this email if something needs to change.')
    ]
  },
  {
    id: 'shipping_confirmation',
    name: 'Shipping confirmation',
    shopifyNotification: 'Shipping confirmation',
    shopifyTopic: 'fulfillments/create',
    subject: 'Order {{order_number}} has a fulfillment',
    blocks: [
      block('sc_h', 'heading', 'A fulfillment was created'),
      block('sc_b', 'text', 'Hi {{first_name}},\n\nOrder {{order_number}} has a fulfillment from the store.\n\n{{tracking_line}}')
    ]
  },
  {
    id: 'order_cancelled',
    name: 'Order cancelled',
    shopifyNotification: 'Order canceled',
    shopifyTopic: 'orders/cancelled',
    subject: 'Order {{order_number}} was cancelled',
    blocks: [
      block('cc_h', 'heading', 'Order {{order_number}} was cancelled'),
      block('cc_b', 'text', 'Hi {{first_name}},\n\nOrder {{order_number}} was cancelled. Reply to this email if you were not expecting that.')
    ]
  },
  {
    id: 'refund',
    name: 'Refund',
    shopifyNotification: 'Order refund',
    shopifyTopic: 'refunds/create',
    subject: 'A refund was recorded on order {{order_number}}',
    blocks: [
      block('rf_h', 'heading', 'Refund on order {{order_number}}'),
      block('rf_b', 'text', 'Hi {{first_name}},\n\nA refund was recorded on order {{order_number}}.\n\n{{refund_amount}}')
    ]
  }
];

const AUTOMATION_DEFAULTS = [
  {
    id: 'post_purchase',
    name: 'After the order',
    trigger: 'order_paid',
    description: 'A thank-you the day after an order, then a note asking how it went.',
    steps: [
      { id: 'pp1', delayHours: 24, subject: 'Thank you for order {{order_number}}', blocks: [block('pp1b', 'text', 'Hi {{first_name}},\n\nThank you for order {{order_number}}. Reply if you need anything about it.')] },
      { id: 'pp2', delayHours: 72, subject: 'How was order {{order_number}}?', blocks: [block('pp2b', 'text', 'Hi {{first_name}},\n\nIf you have a minute, reply and tell us how order {{order_number}} went.')] }
    ]
  },
  {
    id: 'winback',
    name: 'Quiet buyers',
    trigger: 'quiet_buyer',
    quietAfterDays: 45,
    description: 'One note to someone whose last recorded order is at least 45 days old. The queue tick enrolls them.',
    steps: [
      { id: 'wb1', delayHours: 0, subject: 'It has been a while since your last order', blocks: [block('wb1b', 'text', 'Hi {{first_name}},\n\nYour last order with us was a while ago. Reply if you want help with the next one.')] }
    ]
  }
];

const SAMPLE_MAIL_VARS = {
  first_name: 'Alex',
  order_number: '#1001',
  order_total: '48.00',
  currency: 'USD',
  line_items: '1 × Example product',
  tracking_line: 'Tracking was not included on this sample.',
  refund_amount: '48.00'
};

function loadProgramStore() {
  try {
    if (!fs.existsSync(emailProgramsFilePath)) return {};
    const data = JSON.parse(fs.readFileSync(emailProgramsFilePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveProgramStore(store) {
  try {
    fs.writeFileSync(emailProgramsFilePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving email programs:', err.message);
  }
}

function cleanBlocks(input, fallback) {
  return cleanBlockList(Array.isArray(input) ? input : fallback);
}

function cleanCouponCodes(input) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(input) ? input : []) {
    const email = String(row?.email || '').trim().toLowerCase();
    const name = String(row?.name || '').slice(0, 40);
    const code = String(row?.code || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    if (!email.includes('@') || !name || !code) continue;
    const key = `${email}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name, code, at: String(row?.at || '').slice(0, 40) });
  }
  return out.slice(-5000);
}

function cleanLibrary(input) {
  const out = [];
  for (const [index, row] of (Array.isArray(input) ? input : []).slice(0, 40).entries()) {
    const block = cleanBlockList([row?.block])[0];
    if (!block) continue;
    out.push({
      id: String(row?.id || `lib_${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `lib_${index}`,
      name: String(row?.name || block.kind).slice(0, 80),
      block
    });
  }
  return out;
}

function cleanSteps(input, fallback) {
  const source = Array.isArray(input) && input.length ? input : fallback;
  return source.slice(0, 8).map((step, i) => ({
    id: String(step?.id || `step_${i + 1}`).slice(0, 40),
    delayHours: Math.max(0, Math.min(24 * 90, Number(step?.delayHours) || 0)),
    subject: String(step?.subject || 'A note from the store').slice(0, 200),
    previewText: String(step?.previewText || '').slice(0, 140),
    blocks: cleanBlocks(step?.blocks, [block(`sb_${i}`, 'text', String(step?.body || ''))])
  }));
}

function userProgramBag(uid) {
  const store = loadProgramStore();
  const saved = store[uid] && typeof store[uid] === 'object' ? store[uid] : {};
  const savedTx = saved.transactional && typeof saved.transactional === 'object' ? saved.transactional : {};
  const savedAu = saved.automations && typeof saved.automations === 'object' ? saved.automations : {};
  const transactional = TRANSACTIONAL_DEFAULTS.map((def) => {
    const over = savedTx[def.id] || {};
    return {
      ...def,
      enabled: Boolean(over.enabled),
      subject: String(over.subject || def.subject).slice(0, 200),
      blocks: cleanBlocks(over.blocks, def.blocks)
    };
  });
  const automations = AUTOMATION_DEFAULTS.map((def) => {
    const over = savedAu[def.id] || {};
    return {
      ...def,
      enabled: Boolean(over.enabled),
      quietAfterDays: def.quietAfterDays,
      steps: cleanSteps(over.steps, def.steps)
    };
  });
  const enrollments = Array.isArray(saved.enrollments) ? saved.enrollments : [];
  const sentKeys = Array.isArray(saved.sentKeys) ? saved.sentKeys.map(k => String(k)).slice(-4000) : [];
  const flows = (Array.isArray(saved.flows) ? saved.flows : []).map(cleanFlow).filter(Boolean).slice(0, FLOW_LIMIT);
  const flowEnrollments = (Array.isArray(saved.flowEnrollments) ? saved.flowEnrollments : []).slice(0, 2000);
  const postalAddress = String(saved.postalAddress || '').slice(0, 300);
  const suppressions = (Array.isArray(saved.suppressions) ? saved.suppressions : []).slice(-2000);
  const timezone = isIanaTimezone(saved.timezone) ? String(saved.timezone) : '';
  const profiles = cleanProfiles(saved.profiles);
  const library = cleanLibrary(saved.library);
  const couponCodes = cleanCouponCodes(saved.couponCodes);
  const lists = cleanLists(saved.lists);
  const segments = cleanSegments(saved.segments);
  const segmentState = cleanSegmentState(saved.segmentState);
  const predictionCheckedAt = String(saved.predictionCheckedAt || '').slice(0, 40);
  const attributionWindows = cleanAttributionWindows(saved.attributionWindows);
  return { transactional, automations, enrollments, sentKeys, flows, flowEnrollments, postalAddress, suppressions, timezone, profiles, library, couponCodes, lists, segments, segmentState, signalStartersSeeded: saved.signalStartersSeeded === true, predictionCheckedAt, attributionWindows };
}

function cleanSegmentState(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, row] of Object.entries(input).slice(0, 80)) {
    if (!row || typeof row !== 'object') continue;
    const members = {};
    const source = row.members && typeof row.members === 'object' ? row.members : {};
    for (const [email, member] of Object.entries(source).slice(0, 5000)) {
      if (!String(email).includes('@')) continue;
      members[String(email).toLowerCase()] = {
        inside: member?.inside === true,
        enteredAt: String(member?.enteredAt || '').slice(0, 40),
        leftAt: String(member?.leftAt || '').slice(0, 40)
      };
    }
    out[String(id).slice(0, 40)] = { baselined: row.baselined === true, members };
  }
  return out;
}

function ensureSignalStarters(uid) {
  const bag = userProgramBag(uid);
  const ids = new Set(bag.flows.map((flow) => flow.id));
  let added = false;
  for (const starter of signalStarterFlows()) {
    if (ids.has(starter.id) || bag.flows.length >= FLOW_LIMIT) continue;
    if (bag.signalStartersSeeded && starter.id !== 'flow_sunset') continue;
    const flow = cleanFlow(starter);
    if (!flow) continue;
    flow.enabled = false;
    bag.flows.push(flow);
    added = true;
  }
  if (!bag.signalStartersSeeded || added) {
    bag.signalStartersSeeded = true;
    writeUserPrograms(uid, bag);
    return userProgramBag(uid);
  }
  return bag;
}

function cleanProfiles(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [email, row] of Object.entries(input).slice(0, 2000)) {
    const address = String(email || '').trim().toLowerCase();
    if (!address.includes('@')) continue;
    const properties = {};
    const source = row?.properties && typeof row.properties === 'object' ? row.properties : {};
    for (const [key, value] of Object.entries(source).slice(0, 30)) {
      const name = String(key || '').slice(0, 60);
      if (!name || isPredictionKey(name)) continue;
      if (typeof value === 'string') properties[name] = value.slice(0, 200);
      else if (typeof value === 'number' && Number.isFinite(value)) properties[name] = value;
      else if (typeof value === 'boolean') properties[name] = value;
    }
    const lists = (Array.isArray(row?.lists) ? row.lists : [])
      .map((id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40))
      .filter(Boolean)
      .slice(0, 50);
    if (Object.keys(properties).length || lists.length) out[address] = { properties, lists };
  }
  return out;
}

function writeUserPrograms(uid, bag) {
  const store = loadProgramStore();
  const previous = store[uid] && typeof store[uid] === 'object' ? store[uid] : {};
  const transactional = {};
  for (const row of bag.transactional || []) {
    transactional[row.id] = { enabled: Boolean(row.enabled), subject: row.subject, blocks: row.blocks };
  }
  const automations = {};
  for (const row of bag.automations || []) {
    automations[row.id] = { enabled: Boolean(row.enabled), steps: row.steps };
  }
  store[uid] = {
    transactional,
    automations,
    enrollments: (bag.enrollments || []).slice(0, 2000),
    sentKeys: (bag.sentKeys || []).slice(-4000),
    flows: (bag.flows || []).map(cleanFlow).filter(Boolean).slice(0, FLOW_LIMIT),
    flowEnrollments: (bag.flowEnrollments || []).slice(0, 2000),
    postalAddress: String(bag.postalAddress || '').slice(0, 300),
    suppressions: (bag.suppressions || []).slice(-2000),
    timezone: isIanaTimezone(bag.timezone) ? String(bag.timezone) : '',
    profiles: cleanProfiles(bag.profiles),
    library: cleanLibrary(bag.library),
    couponCodes: cleanCouponCodes(bag.couponCodes),
    lists: cleanLists(bag.lists !== undefined ? bag.lists : previous.lists),
    segments: cleanSegments(bag.segments !== undefined ? bag.segments : previous.segments),
    segmentState: cleanSegmentState(bag.segmentState !== undefined ? bag.segmentState : previous.segmentState),
    signalStartersSeeded: bag.signalStartersSeeded === true || previous.signalStartersSeeded === true,
    predictionCheckedAt: String(bag.predictionCheckedAt || previous.predictionCheckedAt || '').slice(0, 40),
    attributionWindows: cleanAttributionWindows(bag.attributionWindows || previous.attributionWindows)
  };
  saveProgramStore(store);
}

function cleanFlow(input) {
  return cleanFlowGraph(input, { cleanBlocks });
}

function stepAt(program, stack) {
  let list = program;
  for (let i = 0; i < stack.length; i++) {
    const part = stack[i];
    if (part === 'yes' || part === 'no') {
      const parent = list[stack[i - 1]];
      if (!parent || parent.type !== 'condition') return null;
      list = part === 'yes' ? (parent.yes || []) : (parent.no || []);
      continue;
    }
    if (i === stack.length - 1) return { list, index: part, step: list[part] || null };
  }
  return null;
}

function stackAfter(program, stack) {
  const here = stepAt(program, stack);
  if (!here?.step) return null;
  if (here.index + 1 < here.list.length) return stack.slice(0, -1).concat(here.index + 1);
  if (stack.length <= 1) return null;
  return stackAfter(program, stack.slice(0, -2));
}

async function enrollFlowsForTrigger(uid, trigger, contact, vars, context, bagIn) {
  const empty = { added: 0, errors: [], skipped: '' };
  if (!uid || !contact?.email || !FLOW_TRIGGERS.has(trigger)) return empty;
  const bag = bagIn || userProgramBag(uid);
  const email = String(contact.email).toLowerCase();
  const now = Date.now();
  let added = 0;
  let skipped = '';
  const errors = [];
  const viaKlaviyo = klaviyoIsSender(uid);
  const named = context?.named === true && context?.flowId;
  let stitched = false;
  const stitchVisitor = (flow) => {
    if (!contact.visitorId) return;
    const open = bag.flowEnrollments.find((row) => row.flowId === flow.id && row.email === email && row.status === 'active' && !row.visitorId);
    if (!open) return;
    open.visitorId = String(contact.visitorId).slice(0, 80);
    stitched = true;
  };
  for (const flow of bag.flows) {
    if (named) {
      if (flow.id !== context.flowId) continue;
      const choice = enrollChoice({ flow, rows: bag.flowEnrollments, email, now, sender: viaKlaviyo ? 'klaviyo' : 'jourvance' });
      if (!choice.enroll) {
        if (choice.stitch) stitchVisitor(flow);
        skipped = choice.reason;
        continue;
      }
    } else if (!flow.enabled || flow.trigger !== trigger) continue;
    if (!named && context?.flowId && flow.id !== context.flowId) continue;
    if (!named && context?.occurrence && bag.flowEnrollments.some((row) => row.flowId === flow.id && row.email === email && row.occurrence === context.occurrence)) {
      skipped = 'reentry';
      continue;
    }
    if (!named && reentryBlocks(flow, bag.flowEnrollments, email, now)) {
      stitchVisitor(flow);
      skipped = 'reentry';
      continue;
    }
    if (!named && viaKlaviyo && flow.klaviyoFlowId) {
      const handed = await enterKlaviyoFlow(uid, flow.klaviyoFlowId, contact, {
        ...(context || {}),
        reason: context?.reason || (trigger === 'order_paid' ? 'order' : (trigger === 'checkout_abandonment' ? 'checkout' : 'lead')),
        dedupe: context?.dedupe || trigger
      });
      if (handed.entered) {
        bag.flowEnrollments.unshift({
          id: `fenr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          flowId: flow.id,
          email,
          name: contact.name || '',
          status: 'handed_to_klaviyo',
          enrolledAt: new Date().toISOString(),
          history: [{ at: new Date().toISOString(), type: 'klaviyo', detail: handed.detail || handed.status }]
        });
        added++;
      } else if (handed.error) errors.push(handed.error);
      continue;
    }
    const linkedEmail = flow.nodes.some((node) => (node.type === 'email' || node.type === 'ab') && node.klaviyoFlowId);
    const hasLocalWork = flow.nodes.some((node) => node.type === 'sms' || node.type === 'profile' || node.type === 'list' || node.type === 'alert' || node.type === 'webhook' || node.type === 'restock');
    if (!named && viaKlaviyo && !linkedEmail && !hasLocalWork) continue;
    const gate = graphContext(uid, bag, { email, name: contact.name || '', phone: contact.phone || '', event: context?.event || {}, enrolledAt: new Date(now).toISOString() }, [], [], now, null);
    if (flow.filter?.length && !clausesMatch(flow.filter, gate)) {
      skipped = 'filter';
      continue;
    }
    bag.flowEnrollments.unshift(buildEnrollment({
      flow,
      contact,
      vars,
      event: context?.event,
      now,
      occurrence: context?.occurrence || '',
      id: `fenr_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
    }));
    if (bag.flowEnrollments.length > 2000) bag.flowEnrollments.length = 2000;
    added++;
  }
  if ((added || stitched) && !bagIn) writeUserPrograms(uid, bag);
  return { added, errors, skipped, stitched };
}

async function enrollLinkedMapFlows(uid, journeyId, when, contact, vars) {
  if (!uid || !journeyId) return { added: 0 };
  const journey = await loadJourney(uid, journeyId);
  if (!journey || journey.userId !== uid) return { added: 0 };
  let added = 0;
  for (const flowId of linkedFlowIds(journey.nodes, when)) {
    const result = await enrollFlowsForTrigger(uid, when, contact, vars, {
      flowId,
      named: true,
      reason: 'map',
      dedupe: `map:${flowId}`,
      journeyId
    });
    added += result.added;
  }
  return { added };
}

function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

async function sendFlowSms(email, phone, message) {
  if (!hubReady) return { ok: false, status: 'not_connected', error: 'Texting is not connected, so nothing was sent.' };
  const audience = await hub.email.sms.audience();
  const people = Array.isArray(audience?.audience) ? audience.audience : [];
  const wantEmail = String(email || '').toLowerCase();
  const wantPhone = phoneKey(phone);
  const hit = people.find((person) => {
    if (wantEmail && String(person.email || '').toLowerCase() === wantEmail) return true;
    return wantPhone && phoneKey(person.phone) === wantPhone;
  });
  if (!hit?.phone) return { ok: false, status: 'no_consent', error: 'This person has not opted in to texts, so nothing was sent.' };
  const sent = await hub.email.sms.send({ message, recipients: [{ phone: hit.phone }] });
  if (!sent || sent.success === false) return { ok: false, status: 'failed', error: sent?.error || 'The text service rejected the send.' };
  const blast = sent.blast || {};
  if ((blast.sent || 0) > 0) return { ok: true, status: 'sent' };
  if ((blast.sandbox || 0) > 0) return { ok: false, status: 'sandbox', error: 'The text service is in sandbox, so this text was not delivered.' };
  if ((blast.deferred || 0) > 0) return { ok: false, status: 'deferred', error: 'The text is waiting for the service sending window.' };
  return { ok: false, status: 'failed', error: 'The text service did not deliver this message.' };
}

async function processCustomFlows(uid) {
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
  let enrolled = markSunset(uid, bag, Date.now());
  const now = Date.now();
  for (const flow of bag.flows) {
    if (!flow.enabled || flow.trigger !== 'quiet_buyer') continue;
    const days = Number(flow.quietAfterDays) || 45;
    const cutoff = now - days * 86400000;
    const latest = new Map();
    for (const order of orders) {
      const email = String(order.customerEmail || '').toLowerCase();
      if (!email) continue;
      const prev = latest.get(email);
      if (!prev || new Date(order.createdAt || 0) > new Date(prev.createdAt || 0)) latest.set(email, order);
    }
    for (const [email, order] of latest) {
      if (new Date(order.createdAt || 0).getTime() > cutoff) continue;
      const result = await enrollFlowsForTrigger(uid, 'quiet_buyer', {
        email,
        name: order.customerName || '',
        visitorId: order.visitorId || ''
      }, orderMailVars(order), { reason: 'quiet', dedupe: `quiet:${flow.id}`, journeyId: order.journeyId || '' }, bag);
      if (result.added) enrolled = true;
    }
  }
  for (const flow of bag.flows) {
    if (!flow.enabled || flow.trigger !== 'date_property' || !flow.dateField) continue;
    const predicted = flow.dateField === 'expectedNextOrderAt' ? predictionAccount(uid) : null;
    for (const contact of contactsForUser(uid)) {
      const email = String(contact.email || '').toLowerCase();
      if (!email) continue;
      const row = predicted?.rows?.[email];
      if (flow.dateField === 'expectedNextOrderAt' && (!row?.computedAt || !row.expectedNextOrderAt)) continue;
      const raw = flow.dateField === 'expectedNextOrderAt'
        ? row.expectedNextOrderAt
        : (contact.properties?.[flow.dateField] ?? bag.profiles?.[email]?.properties?.[flow.dateField]);
      const due = dateOccurrenceDue(flow, raw, now, bag.timezone);
      if (!due.due) continue;
      const result = await enrollFlowsForTrigger(uid, 'date_property', contact, personFields(contact.name || ''), {
        occurrence: due.occurrence,
        event: { date: due.occurrence },
        reason: 'date',
        dedupe: `date:${flow.id}:${due.occurrence}`
      }, bag);
      if (result.added) enrolled = true;
    }
  }
  let sent = 0;
  let failed = 0;
  let dirty = enrolled;
  const behaviorEvents = loadBehaviorBag(uid).events.filter((evt) => evt.email).map((evt) => ({
    type: evt.type, at: evt.at, userId: uid, email: evt.email, transactional: false
  }));
  const events = [...loadEvents(), ...behaviorEvents];
  const seen = new Set();
  for (let guard = 0; guard < 8; guard++) {
    const pending = bag.flowEnrollments.filter((enr) => enr.status === 'active' && !seen.has(enr.id));
    if (!pending.length) break;
    let spawned = false;
    for (const enr of pending) {
      seen.add(enr.id);
      const flow = bag.flows.find((row) => row.id === enr.flowId);
      if (!flow) { enr.status = 'stopped'; dirty = true; continue; }
      if (!flow.enabled) continue;
      if (!Array.isArray(enr.program)) {
        const step = await advanceGraphEnrollment(uid, bag, enr, orders, events, now);
        sent += step.sent;
        failed += step.failed;
        if (step.dirty) dirty = true;
        if (step.spawned) spawned = true;
        continue;
      }
      if (new Date(enr.nextDueAt || 0).getTime() > now) continue;
    const program = Array.isArray(enr.program) ? enr.program : [];
    const here = stepAt(program, Array.isArray(enr.stack) ? enr.stack : [0]);
    const step = here?.step;
    if (!step) { enr.status = 'completed'; dirty = true; continue; }
    const boughtSince = orders.some((order) => String(order.customerEmail || '').toLowerCase() === enr.email && new Date(order.createdAt || 0).getTime() >= new Date(enr.enrolledAt || 0).getTime());
    if ((flow.trigger === 'quiet_buyer' || flow.trigger === 'checkout_abandonment') && boughtSince) {
      enr.status = 'converted_exit';
      dirty = true;
      continue;
    }
    if (step.type === 'condition') {
      const branch = boughtSince ? 'yes' : 'no';
      const children = branch === 'yes' ? (step.yes || []) : (step.no || []);
      enr.history = [...(enr.history || []), { at: new Date().toISOString(), type: 'condition', branch }].slice(-20);
      dirty = true;
      if (!children.length) {
        const nxt = stackAfter(program, enr.stack);
        if (!nxt) enr.status = 'completed';
        else {
          enr.stack = nxt;
          const next = stepAt(program, nxt);
          enr.nextDueAt = new Date(now + (Number(next?.step?.delayHours) || 0) * 3600000).toISOString();
        }
      } else {
        enr.stack = [...enr.stack, branch, 0];
        enr.nextDueAt = new Date(now + (Number(children[0].delayHours) || 0) * 3600000).toISOString();
      }
      continue;
    }
    const vars = enr.vars || {};
    let result;
    if (step.type === 'sms') {
      const until = smsQuietEnabled(step) ? quietOpenAt(now, bag.timezone) : null;
      if (until && until > now + 999) {
        enr.nextDueAt = new Date(until).toISOString();
        dirty = true;
        continue;
      }
      const messageId = `msg_${crypto.randomBytes(6).toString('hex')}`;
      const prepared = await prepareSmsMessage(uid, fillMailTokens(step.message, vars).slice(0, 480), {
        email: enr.email, coupon: step.coupon, bag, flowId: enr.flowId, messageId, utm: { utm_source: 'sms', utm_medium: 'flow' }
      });
      result = await sendFlowSms(enr.email, enr.phone, prepared.text);
      if (result.ok) {
        recordEvent({ type: 'sms_sent', userId: uid, email: enr.email, visitorId: enr.visitorId || '', utm_source: 'sms', utm_medium: 'flow', messageId, flowId: enr.flowId || '' });
      }
    } else if (klaviyoIsSender(uid)) {
      const target = step.klaviyoFlowId || '';
      if (!target) {
        result = { ok: false, status: 'not_linked', error: 'Klaviyo is the sender and this email is not linked to a Klaviyo flow, so nothing was sent.' };
      } else {
        const handed = await enterKlaviyoFlow(uid, target, {
          email: enr.email,
          name: enr.name,
          visitorId: enr.visitorId,
          phone: enr.phone
        }, {
          reason: flow.trigger === 'order_paid' ? 'order' : (flow.trigger === 'checkout_abandonment' ? 'checkout' : 'lead'),
          dedupe: flow.trigger
        });
        result = handed.entered
          ? { ok: true, status: handed.status }
          : { ok: false, status: handed.status, error: handed.error || 'Klaviyo did not take this email.' };
      }
    } else {
      const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === enr.email) || { email: enr.email, name: enr.name, visitorId: enr.visitorId };
      const letter = await composeForSend(uid, contact, step.blocks, vars, { bag, previewText: step.previewText, marketing: true });
      result = await deliverLetter({
        to: enr.email,
        name: enr.name,
        subject: fillMailTokens(step.subject, letter.vars || vars).slice(0, 200),
        text: letter.text,
        html: letter.html,
        previewText: step.previewText,
        userId: uid,
        visitorId: enr.visitorId,
        medium: `flow:${enr.flowId}`,
        marketing: true,
        flowId: enr.flowId || ''
      });
    }
    if (!result?.ok) {
      enr.lastError = result?.error || result?.status || 'failed';
      failed++;
      dirty = true;
      continue;
    }
    sent++;
    dirty = true;
    enr.lastError = '';
    const nxt = stackAfter(program, enr.stack);
    if (!nxt) enr.status = 'completed';
    else {
      enr.stack = nxt;
      const next = stepAt(program, nxt);
      enr.nextDueAt = new Date(now + (Number(next?.step?.delayHours) || 0) * 3600000).toISOString();
    }
    }
    if (!spawned) break;
  }
  if (dirty) writeUserPrograms(uid, bag);
  return { sent, failed, active: bag.flowEnrollments.filter((row) => row.status === 'active').length };
}

function graphContext(uid, bag, enr, orders, events, now, canText, restockReleased) {
  const email = String(enr.email || '').toLowerCase();
  const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === email);
  const stored = bag.profiles?.[email] || { properties: {}, lists: [] };
  const properties = overlayPrediction(
    { ...(stored.properties || {}), ...(contact?.properties && typeof contact.properties === 'object' ? contact.properties : {}) },
    predictionAccount(uid)?.rows?.[email]
  );
  const lists = [...new Set([...(stored.lists || []), ...(Array.isArray(contact?.lists) ? contact.lists : [])])];
  const profileTimezone = isIanaTimezone(contact?.timezone) ? contact.timezone : (isIanaTimezone(properties.timezone) ? properties.timezone : '');
  const sinceEmail = now - SMART_EMAIL_HOURS * 3600000;
  const sinceSms = now - SMART_SMS_HOURS * 3600000;
  const own = (events || []).filter((evt) => evt.userId === uid && String(evt.email || '').toLowerCase() === email && evt.transactional !== true);
  return {
    properties,
    profile: {
      email,
      name: contact?.name || enr.name || '',
      phone: contact?.phone || enr.phone || '',
      acceptsMarketing: contact ? contact.acceptsMarketing === true : false
    },
    lists,
    event: enr.event || {},
    orders: (orders || []).filter((order) => String(order.customerEmail || '').toLowerCase() === email).map((order) => ({ at: order.createdAt, type: 'order' })),
    events: (events || []).filter((evt) => evt.userId === uid && String(evt.email || '').toLowerCase() === email).map((evt) => ({ type: evt.type, at: evt.at })),
    canEmail: contact ? !sendBlockReason(contact, bag.suppressions, true) : false,
    canText,
    recentEmail: own.some((evt) => evt.type === 'email_sent' && new Date(evt.at || 0).getTime() >= sinceEmail),
    recentSms: own.some((evt) => evt.type === 'sms_sent' && new Date(evt.at || 0).getTime() >= sinceSms),
    accountTimezone: bag.timezone || '',
    profileTimezone,
    enrolledAt: enr.enrolledAt,
    now,
    restockReleased: restockReleased === true
  };
}

function markSunset(uid, bag, now) {
  const flow = (bag.flows || []).find((row) => row.sunset === true && row.enabled === true && Number(row.quietAfterDays) >= 1);
  if (!flow) return false;
  const emails = sunsetCandidates({
    contacts: contactsForUser(uid),
    events: loadEvents().filter((event) => event.userId === uid),
    quietDays: flow.quietAfterDays,
    now
  });
  let dirty = false;
  for (const email of emails) {
    const written = writeFlowProperty(uid, bag, email, { key: 'unengaged', value: true, valueType: 'boolean', update: 'set' });
    if (written.ok) dirty = true;
  }
  return dirty;
}

function writeFlowProperty(uid, bag, email, action) {
  if (!action?.key || isPredictionKey(action.key)) return { ok: false, error: 'That field is reserved.' };
  const value = action.valueType === 'number'
    ? Number(action.value)
    : action.valueType === 'boolean'
      ? action.value === true || action.value === 'true'
      : String(action.value ?? '').slice(0, 200);
  const contacts = loadContacts();
  const contact = contacts.find((row) => contactOwnerId(row) === uid && String(row.email || '').toLowerCase() === email);
  if (contact) {
    if (!contact.properties || typeof contact.properties !== 'object' || Array.isArray(contact.properties)) contact.properties = {};
    if (action.update === 'clear') delete contact.properties[action.key];
    else contact.properties[action.key] = value;
    saveContacts(contacts);
    return { ok: true };
  }
  const row = bag.profiles[email] || { properties: {}, lists: [] };
  if (action.update === 'clear') delete row.properties[action.key];
  else row.properties[action.key] = value;
  bag.profiles[email] = row;
  return { ok: true };
}

function writeFlowList(uid, bag, email, action) {
  const contacts = loadContacts();
  const contact = contacts.find((row) => contactOwnerId(row) === uid && String(row.email || '').toLowerCase() === email);
  const current = contact
    ? (Array.isArray(contact.lists) ? contact.lists : [])
    : (bag.profiles[email]?.lists || []);
  const had = current.includes(action.listId);
  let next = current;
  if (action.update === 'add' && !had) next = [...current, action.listId].slice(0, 50);
  if (action.update === 'remove' && had) next = current.filter((id) => id !== action.listId);
  if (contact) {
    contact.lists = next;
    saveContacts(contacts);
  } else if (next.length || bag.profiles[email]) {
    const row = bag.profiles[email] || { properties: {}, lists: [] };
    row.lists = next;
    bag.profiles[email] = row;
  }
  return { ok: true, added: action.update === 'add' && !had };
}

async function postFlowWebhook(url, body) {
  const check = publicHttpsUrl(url);
  if (!check.ok) return { ok: true, history: { type: 'webhook', detail: 'refused' } };
  const host = new URL(check.url).hostname;
  if (!isIpLiteral(host)) {
    let records = [];
    try { records = await dns.promises.lookup(host, { all: true }); } catch { return { ok: false, error: 'The webhook address did not resolve.' }; }
    if (records.some((record) => isPrivateAddress(record.address))) return { ok: false, error: 'The webhook address is not public.' };
  }
  try {
    const response = await fetch(check.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body).slice(0, 20000),
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { ok: false, error: `The webhook responded ${response.status}.` };
    return { ok: true, history: { type: 'webhook', detail: 'posted' } };
  } catch {
    return { ok: false, error: 'The webhook did not answer.' };
  }
}

async function textConsentKnown(email, phone) {
  if (!hubReady) return null;
  try {
    const audience = await hub.email.sms.audience();
    const people = Array.isArray(audience?.audience) ? audience.audience : [];
    const wantEmail = String(email || '').toLowerCase();
    const wantPhone = phoneKey(phone);
    return people.some((person) => (wantEmail && String(person.email || '').toLowerCase() === wantEmail) || (wantPhone && phoneKey(person.phone) === wantPhone));
  } catch {
    return null;
  }
}

async function advanceGraphEnrollment(uid, bag, enr, orders, events, now) {
  let sent = 0;
  let failed = 0;
  let dirty = false;
  let spawned = false;
  if (!enr.graph) {
    enr.status = 'stopped';
    enr.lastError = 'This enrollment has no saved steps.';
    return { sent, failed, dirty: true, spawned };
  }
  const flow = bag.flows.find((row) => row.id === enr.flowId);
  const visited = new Set();
  for (let step = 0; step < 24; step++) {
    if (enr.status !== 'active') break;
    const due = new Date(enr.waitUntil || 0).getTime() <= now;
    const boughtSince = orders.some((order) => String(order.customerEmail || '').toLowerCase() === enr.email && new Date(order.createdAt || 0).getTime() >= new Date(enr.enrolledAt || 0).getTime());
    if (due && enr.exitOnOrder && boughtSince) {
      applyGraph(enr, { kind: 'exit', history: { type: 'exit', detail: 'ordered' } }, now);
      dirty = true;
      break;
    }
    const node = (enr.graph.nodes || []).find((item) => item.id === enr.nodeId);
    let smartSend = node?.id ? enr.smartPlans?.[node.id] || null : null;
    if (node?.type === 'email' && node.sendTime === 'smart' && !smartSend) {
      const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === enr.email);
      const zone = isIanaTimezone(contact?.timezone) ? contact.timezone : (isIanaTimezone(contact?.properties?.timezone) ? contact.properties.timezone : '');
      const plan = assignSmartSend({
        people: [{ email: enr.email, timezone: zone }],
        events: (events || []).filter((evt) => evt.userId === uid),
        now,
        accountTimezone: bag.timezone,
        fallbackHour: node.fallbackHour,
        explore: false,
        seed: `${enr.id}:${node.id}`
      });
      const assigned = plan.assignments[0];
      if (assigned) {
        smartSend = { rule: assigned.rule, hour: assigned.hour, sampleSize: assigned.sampleSize, sendAt: assigned.sendAt };
        enr.smartPlans = { ...(enr.smartPlans || {}), [node.id]: smartSend };
        dirty = true;
      }
    }
    const needsText = node && JSON.stringify(node).includes('"channel":"sms"');
    const canText = needsText ? await textConsentKnown(enr.email, enr.phone) : null;
    const quietOpenAtMs = node?.type === 'sms' && smsQuietEnabled(node) ? quietOpenAt(now, bag.timezone) : null;
    const action = peekGraph(enr, now, { ...graphContext(uid, bag, enr, orders, events, now, canText, restockReady(uid, enr)), smartSend, quietOpenAt: quietOpenAtMs });
    if (!action.ready) break;
    if (!enr.held && visited.has(enr.nodeId) && action.kind !== 'hold') {
      enr.status = 'stopped';
      enr.lastError = 'That flow loops back on itself.';
      dirty = true;
      break;
    }
    visited.add(enr.nodeId);
    if (action.kind === 'email' || action.kind === 'sms' || action.kind === 'alert' || action.kind === 'webhook' || action.kind === 'profile' || action.kind === 'list') {
      const performed = await performGraphAction(uid, bag, enr, flow, action);
      if (action.variationId) enr.abPicks = { ...(enr.abPicks || {}), [enr.nodeId]: action.variationId };
      if (!performed.ok) {
        enr.lastError = performed.error || 'failed';
        failed++;
        dirty = true;
        break;
      }
      if (performed.holdUntil) {
        applyGraph(enr, { kind: 'hold', waitUntil: performed.holdUntil, history: performed.history }, now);
        dirty = true;
        break;
      }
      if (performed.sent) sent++;
      if (performed.spawned) spawned = true;
      applyGraph(enr, { kind: 'advance', branch: '', history: performed.history }, now);
      dirty = true;
      enr.lastError = '';
      continue;
    }
    applyGraph(enr, action, now);
    dirty = true;
    if (action.kind === 'hold' || action.kind === 'exit' || enr.status !== 'active') break;
  }
  return { sent, failed, dirty, spawned };
}

async function performGraphAction(uid, bag, enr, flow, action) {
  if (action.kind === 'profile') {
    const written = writeFlowProperty(uid, bag, enr.email, action);
    if (!written.ok) return { ok: true, history: { type: 'profile', detail: 'refused' } };
    return { ok: true, history: { type: 'profile', detail: action.update === 'clear' ? 'cleared' : action.key } };
  }
  if (action.kind === 'list') {
    const written = writeFlowList(uid, bag, enr.email, action);
    if (written.added) {
      const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === enr.email) || { email: enr.email, name: enr.name, phone: enr.phone, visitorId: enr.visitorId };
      const started = await enrollFlowsForTrigger(uid, 'list_added', contact, enr.vars || {}, { listId: action.listId, reason: 'list', dedupe: `list:${action.listId}`, event: { list_id: action.listId } }, bag);
      return { ok: true, spawned: started.added > 0, history: { type: 'list', detail: 'added' } };
    }
    return { ok: true, history: { type: 'list', detail: action.update } };
  }
  if (action.kind === 'webhook') {
    return postFlowWebhook(action.url, action.body);
  }
  if (action.kind === 'alert') {
    const letter = composeLetter(uid, { email: action.to }, [{ id: 'alert', kind: 'text', text: `${enr.email} reached an alert in ${flow?.name || 'a flow'}.` }], {}, { marketing: false });
    const result = await deliverLetter({
      to: action.to,
      name: '',
      subject: 'Flow alert',
      text: letter.text,
      html: letter.html,
      userId: uid,
      medium: `flow-alert:${enr.flowId}`,
      marketing: false
    });
    return result.ok ? { ok: true, history: { type: 'alert', detail: 'sent' } } : { ok: false, error: result.error || 'The alert was not sent.' };
  }
  if (action.kind === 'sms') {
    const until = smsQuietEnabled(action) ? quietOpenAt(Date.now(), bag.timezone) : null;
    if (until && until > Date.now() + 999) return { ok: true, holdUntil: until, history: { type: 'quiet', detail: 'waiting' } };
    const messageId = `msg_${crypto.randomBytes(6).toString('hex')}`;
    const prepared = await prepareSmsMessage(uid, fillMailTokens(action.message, enr.vars || {}).slice(0, 480), {
      email: enr.email, coupon: action.coupon, bag, campaignId: '', flowId: enr.flowId, nodeId: enr.nodeId, messageId,
      utm: { utm_source: 'sms', utm_medium: 'flow' }
    });
    const result = await sendFlowSms(enr.email, enr.phone, prepared.text);
    if (!result.ok) return { ok: false, error: result.error || 'The text was not sent.' };
    recordEvent({ type: 'sms_sent', userId: uid, email: enr.email, visitorId: enr.visitorId || '', utm_source: 'sms', utm_medium: 'flow', transactional: action.transactional === true, messageId, flowId: enr.flowId, nodeId: enr.nodeId || '' });
    return { ok: true, sent: true, history: { type: 'sms', detail: 'sent' } };
  }
  const marketing = action.transactional !== true;
  if (action.holdout?.enabled && inHoldout(`${enr.flowId}:${enr.nodeId}:${enr.email}`, action.holdout.percent)) {
    recordEvent({
      type: 'email_held',
      userId: uid,
      email: enr.email,
      visitorId: enr.visitorId || '',
      flowId: enr.flowId || '',
      nodeId: enr.nodeId || ''
    });
    return { ok: true, sent: false, history: { type: 'holdout', detail: 'held' } };
  }
  if (klaviyoIsSender(uid)) {
    const target = action.klaviyoFlowId || '';
    if (!target) return { ok: false, error: 'Klaviyo is the sender and this email is not linked to a Klaviyo flow, so nothing was sent.' };
    const handed = await enterKlaviyoFlow(uid, target, {
      email: enr.email, name: enr.name, visitorId: enr.visitorId, phone: enr.phone
    }, {
      reason: flow?.trigger === 'order_paid' ? 'order' : (flow?.trigger === 'checkout_abandonment' ? 'checkout' : 'lead'),
      dedupe: flow?.trigger || 'flow'
    });
    return handed.entered
      ? { ok: true, sent: true, history: { type: 'klaviyo', detail: handed.detail || handed.status } }
      : { ok: false, error: handed.error || 'Klaviyo did not take this email.' };
  }
  const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === enr.email) || { email: enr.email, name: enr.name, visitorId: enr.visitorId };
  const letter = await composeForSend(uid, contact, action.blocks, enr.vars || {}, { bag, previewText: action.previewText, marketing });
  const result = await deliverLetter({
    to: enr.email,
    name: enr.name,
    subject: fillMailTokens(action.subject, letter.vars || enr.vars || {}).slice(0, 200),
    text: letter.text,
    html: letter.html,
    previewText: action.previewText,
    userId: uid,
    visitorId: enr.visitorId,
    medium: `flow:${enr.flowId}`,
    marketing,
    flowId: enr.flowId || '',
    nodeId: enr.nodeId || ''
  });
  return result.ok ? { ok: true, sent: true, history: { type: 'email', detail: 'sent' } } : { ok: false, error: result.error || result.status || 'The email was not sent.' };
}

function catalogFor(uid) {
  try {
    const file = path.join(__dirname, 'catalog_memory.json');
    if (!uid || !fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bag = data?.[uid];
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {};
    const out = {};
    for (const [id, row] of Object.entries(bag).slice(0, 5000)) {
      if (!row || typeof row !== 'object') continue;
      const item = {};
      if (row.title) item.title = String(row.title).slice(0, 200);
      const url = String(row.url || '');
      const image = String(row.image || '');
      if (/^https?:\/\//.test(url)) item.url = url.slice(0, 500);
      if (/^https?:\/\//.test(image)) item.image = image.slice(0, 500);
      if (row.price) item.price = String(row.price).slice(0, 40);
      if (Object.keys(item).length) out[String(id).slice(0, 40)] = item;
    }
    return out;
  } catch {
    return {};
  }
}

function mailShowContext(uid, contact, event, bagIn) {
  const email = String(contact?.email || '').toLowerCase();
  const bag = bagIn || (uid ? userProgramBag(uid) : { profiles: {}, suppressions: [] });
  const stored = bag.profiles?.[email]?.properties || {};
  const props = contact?.properties && typeof contact.properties === 'object' ? contact.properties : {};
  const properties = { ...stored, ...props };
  const orders = email && uid
    ? loadOrders().filter((order) => order.userId === uid && String(order.customerEmail || '').toLowerCase() === email && !isDemoRecord(order)).map((order) => ({ at: order.createdAt, createdAt: order.createdAt }))
    : [];
  return {
    profile: properties,
    properties,
    event: event || {},
    lists: [...(bag.profiles?.[email]?.lists || []), ...(Array.isArray(contact?.lists) ? contact.lists : [])],
    canEmail: email ? sendBlockReason({ ...(contact || {}), email }, bag.suppressions || [], true) === '' : null,
    canText: null,
    orders,
    events: [],
    enrollmentId: email,
    now: Date.now()
  };
}

function ownedPageSlugs(uid) {
  if (!uid) return [];
  const slugs = [];
  for (const page of Object.values(publicPageCache)) {
    if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
    if (page.userId !== uid || !page.slug) continue;
    slugs.push(String(page.slug));
  }
  return slugs;
}

function composeLetter(uid, contact, blocks, vars, options = {}) {
  const bag = options.bag || (uid ? userProgramBag(uid) : { postalAddress: '' });
  const marketing = options.marketing !== false;
  const publicVars = vars && typeof vars === 'object' ? { ...vars } : {};
  const lineItems = Array.isArray(publicVars.eventLineItems) ? publicVars.eventLineItems : [];
  delete publicVars.eventLineItems;
  const email = contact?.email || publicVars.email || '';
  const unsubscribeUrl = marketing ? unsubscribeUrlFor(uid, email) : '';
  const who = options.keepUnknown ? {} : personFields(contact?.name || publicVars.full_name, { first_name: publicVars.first_name, last_name: publicVars.last_name });
  const merged = {
    ...who,
    ...publicVars,
    ...(options.keepUnknown ? {} : {
      email,
      phone: contact?.phone || publicVars.phone || '',
      unsubscribe_url: unsubscribeUrl
    })
  };
  const event = options.event && typeof options.event === 'object' ? { ...options.event } : {};
  if (lineItems.length) event.line_items = lineItems;
  const profile = bag.profiles?.[String(email || '').toLowerCase()]?.properties || {};
  const person = {
    ...(options.keepUnknown ? {} : who),
    ...(options.keepUnknown ? {} : { email, phone: contact?.phone || '' }),
    ...profile,
    ...(contact?.properties && typeof contact.properties === 'object' ? contact.properties : {})
  };
  const rendered = renderLetter({
    blocks: resolveMailBlocks(blocks, options.feedContext === false ? null : (options.feedContext || feedContextFor(uid, contact, event))),
    vars: merged,
    keepUnknown: options.keepUnknown === true,
    previewText: options.previewText || '',
    physicalAddress: options.physicalAddress ?? bag.postalAddress,
    unsubscribeUrl,
    marketing,
    embedPreheader: options.embedPreheader === true,
    contact,
    event,
    person,
    catalog: options.catalog || catalogFor(uid),
    coupons: options.coupons || {},
    previewCoupons: options.previewCoupons === true,
    pageBase: publicBase(),
    ownedSlugs: ownedPageSlugs(uid),
    visitorId: String(contact?.visitorId || '').slice(0, 80),
    showContext: options.showContext || mailShowContext(uid, contact, event, bag)
  });
  return { ...rendered, vars: merged };
}

async function shopForCoupons(uid) {
  const match = (ws) => Boolean(realStoreDomain(ws?.shopifyConfig) && adminToken(ws?.shopifyConfig) && ws?.shopifyConfig?.status === 'connected');
  const local = Object.values(workspaceCache).find((ws) => ws.userId === uid && match(ws));
  if (local) return local;
  const listed = await listWorkspaces(uid);
  return listed.find(match) || null;
}

async function mintCoupon(uid, email, spec, bag) {
  const address = String(email || '').trim().toLowerCase();
  const existing = storedCoupon(bag.couponCodes, address, spec.name);
  if (existing) return existing;
  const rule = couponPriceRule(spec);
  if (!rule) return '';
  const shop = await shopForCoupons(uid);
  if (!shop) return '';
  const scopes = shop.shopifyConfig?.adminScopes;
  if (Array.isArray(scopes) && scopes.length && !scopes.includes('write_price_rules')) return '';
  const domain = realStoreDomain(shop.shopifyConfig);
  const token = adminToken(shop.shopifyConfig);
  const code = couponCodeValue(spec.prefix || spec.name);
  try {
    const prResp = await fetch(`https://${domain}/admin/api/2024-10/price_rules.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ price_rule: { ...rule, starts_at: new Date().toISOString() } }),
      signal: AbortSignal.timeout(8000)
    });
    const prData = await prResp.json().catch(() => ({}));
    const ruleId = prData?.price_rule?.id;
    if (!prResp.ok || !ruleId) return '';
    const dcResp = await fetch(`https://${domain}/admin/api/2024-10/price_rules/${ruleId}/discount_codes.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ discount_code: { code } }),
      signal: AbortSignal.timeout(8000)
    });
    const dcData = await dcResp.json().catch(() => ({}));
    if (!dcResp.ok || !dcData?.discount_code?.code) return '';
    const saved = String(dcData.discount_code.code);
    const rows = Array.isArray(bag.couponCodes) ? bag.couponCodes : [];
    rows.push({ email: address, name: spec.name, code: saved, at: new Date().toISOString() });
    bag.couponCodes = rows.slice(-5000);
    const store = loadProgramStore();
    const current = store[uid] && typeof store[uid] === 'object' ? store[uid] : {};
    current.couponCodes = cleanCouponCodes(bag.couponCodes);
    store[uid] = current;
    saveProgramStore(store);
    return saved;
  } catch {
    return '';
  }
}

async function composeForSend(uid, contact, blocks, vars, options = {}) {
  const bag = options.bag || userProgramBag(uid);
  const email = String(contact?.email || '').toLowerCase();
  const known = {};
  for (const row of bag.couponCodes || []) {
    if (row.email === email && row.code) known[row.name] = row.code;
  }
  const first = composeLetter(uid, contact, blocks, vars, { ...options, bag, coupons: known, previewCoupons: false });
  let stored = false;
  for (const name of first.couponsNeeded || []) {
    if (known[name]) continue;
    const spec = couponSpec(first.document, name);
    if (!spec) continue;
    const code = await mintCoupon(uid, email, spec, bag);
    if (code) {
      known[name] = code;
      stored = true;
    }
  }
  if (!stored) return first;
  return composeLetter(uid, contact, blocks, vars, { ...options, bag, coupons: known, previewCoupons: false });
}

function orderMailVars(order, extra) {
  const name = String(order?.customerName || extra?.name || '').trim();
  const who = personFields(name, extra);
  const items = Array.isArray(order?.lineItems) && order.lineItems.length
    ? order.lineItems.map((it) => `${Number(it.quantity || 1)} × ${it.title || 'Item'}`).join('\n')
    : 'The item list was not on this notice.';
  return {
    ...who,
    email: order?.customerEmail || extra?.email || '',
    phone: extra?.phone || '',
    order_number: order?.orderNumber || (order?.id ? `#${String(order.id).slice(-6)}` : ''),
    order_total: Number(order?.totalPrice || 0).toFixed(2),
    currency: order?.currency || extra?.currency || 'USD',
    line_items: items,
    tracking_line: extra?.trackingLine || 'Tracking was not included on this fulfillment.',
    refund_amount: extra?.refundAmount || 'The refund notice did not include an amount.',
    checkout_url: extra?.checkoutUrl || '',
    eventLineItems: Array.isArray(order?.lineItems) ? order.lineItems.map(lineItemFields) : []
  };
}

async function deliverLetter({ to, name, subject, text, html, userId, visitorId, medium, previewText, marketing = true, campaignId = '', flowId = '', nodeId = '', sequenceId = '' }) {
  if (!to || !String(to).includes('@')) return { ok: false, status: 'no_address' };
  const bag = userId ? userProgramBag(userId) : { suppressions: [] };
  const known = userId ? contactsForUser(userId).find((row) => String(row.email || '').toLowerCase() === String(to).toLowerCase()) : null;
  const reason = sendBlockReason({ ...(known || {}), email: to }, bag.suppressions, marketing !== false);
  if (reason) {
    const status = reason === 'hard_bounce' || reason === 'soft_bounce' ? 'suppressed' : 'unsubscribed';
    return { ok: false, status, error: status === 'suppressed' ? 'This address is suppressed, so nothing was sent.' : 'This address is unsubscribed, so nothing was sent.' };
  }
  if (!hubReady) return { ok: false, status: 'not_connected', error: 'Email sending is not connected, so nothing was sent.' };
  const messageId = `msg_${crypto.randomBytes(6).toString('hex')}`;
  const tracked = describeSentHtml(html);
  const outbound = tracked.pixel || tracked.rewritten ? rewritePlainMailLinks(html, { userId, email: to, messageId, campaignId, flowId, nodeId, sequenceId }) : html;
  const sent = await hub.email.send({
    subject,
    text,
    html: outbound,
    ...(previewText ? { previewText: String(previewText).slice(0, 140) } : {}),
    recipients: [{ email: to, name: name || '' }]
  });
  if (!sent || sent.error || sent.success === false) {
    return { ok: false, status: 'failed', error: sent?.error || 'The email service rejected the send.' };
  }
  if (sent.sandbox === true || sent.broadcast?.status === 'sandbox') {
    return { ok: false, status: 'sandbox', error: 'The email service is in sandbox, so this letter was not delivered.' };
  }
  recordEvent({
    type: 'email_sent',
    userId: userId || '',
    email: to,
    visitorId: visitorId || '',
    utm_source: 'email',
    utm_medium: medium || 'transactional',
    transactional: marketing === false,
    messageId,
    campaignId: campaignId || '',
    flowId: flowId || '',
    nodeId: nodeId || '',
    sequenceId: sequenceId || ''
  });
  return { ok: true, status: 'sent', messageId };
}

async function sendTransactional(uid, programId, { to, name, dedupeKey, vars, visitorId }) {
  if (klaviyoIsSender(uid)) return { status: 'klaviyo', ok: false };
  const bag = userProgramBag(uid);
  const program = bag.transactional.find((row) => row.id === programId);
  if (!program) return { status: 'missing' };
  if (!program.enabled) return { status: 'off' };
  if (dedupeKey && bag.sentKeys.includes(dedupeKey)) return { status: 'already_sent' };
  const contact = { email: to, name, visitorId };
  const letter = await composeForSend(uid, contact, program.blocks, vars, { bag, marketing: false });
  const subject = fillMailTokens(program.subject, letter.vars).slice(0, 200);
  const result = await deliverLetter({
    to, name, subject, text: letter.text, html: letter.html, userId: uid, visitorId, medium: programId, marketing: false
  });
  if (!result.ok) return result;
  if (dedupeKey) {
    bag.sentKeys.push(dedupeKey);
    writeUserPrograms(uid, bag);
  }
  return result;
}

function enrollAutomation(uid, automationId, contact, vars) {
  if (klaviyoIsSender(uid)) return false;
  const bag = userProgramBag(uid);
  const auto = bag.automations.find((row) => row.id === automationId);
  if (!auto?.enabled || !contact?.email) return false;
  const email = String(contact.email).toLowerCase();
  if (bag.enrollments.some((e) => e.automationId === automationId && e.email === email && (e.status === 'active' || e.status === 'completed'))) return false;
  const delayMs = Math.max(0, Number(auto.steps[0]?.delayHours) || 0) * 3600000;
  bag.enrollments.unshift({
    id: `penr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    automationId,
    email,
    name: contact.name || '',
    visitorId: contact.visitorId || '',
    stepIndex: 0,
    status: 'active',
    nextDueAt: new Date(Date.now() + delayMs).toISOString(),
    vars: vars || {},
    enrolledAt: new Date().toISOString()
  });
  writeUserPrograms(uid, bag);
  return true;
}

async function processAccountAutomations(uid) {
  if (klaviyoIsSender(uid)) {
    const flowTick = await processCustomFlows(uid);
    return { sent: flowTick.sent, failed: flowTick.failed, active: flowTick.active, heldForKlaviyo: true };
  }
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((o) => o.userId === uid && !isDemoRecord(o));
  const winback = bag.automations.find((row) => row.id === 'winback');
  if (winback?.enabled) {
    const days = Number(winback.quietAfterDays) || 45;
    const cutoff = Date.now() - days * 86400000;
    const latest = new Map();
    for (const order of orders) {
      const email = String(order.customerEmail || '').toLowerCase();
      if (!email || isDemoRecord(order)) continue;
      const prev = latest.get(email);
      if (!prev || new Date(order.createdAt || 0) > new Date(prev.createdAt || 0)) latest.set(email, order);
    }
    let enrolled = false;
    for (const [email, order] of latest) {
      if (new Date(order.createdAt || 0).getTime() > cutoff) continue;
      const already = bag.enrollments.some((e) => e.automationId === 'winback' && e.email === email);
      if (already) continue;
      const delayMs = Math.max(0, Number(winback.steps[0]?.delayHours) || 0) * 3600000;
      bag.enrollments.unshift({
        id: `penr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        automationId: 'winback',
        email,
        name: order.customerName || '',
        visitorId: order.visitorId || '',
        stepIndex: 0,
        status: 'active',
        nextDueAt: new Date(Date.now() + delayMs).toISOString(),
        vars: orderMailVars(order),
        enrolledAt: new Date().toISOString()
      });
      enrolled = true;
    }
    if (enrolled) writeUserPrograms(uid, bag);
  }

  const fresh = userProgramBag(uid);
  let sent = 0;
  let failed = 0;
  const now = Date.now();
  for (const enr of fresh.enrollments) {
    if (enr.status !== 'active') continue;
    if (new Date(enr.nextDueAt || 0).getTime() > now) continue;
    const auto = fresh.automations.find((row) => row.id === enr.automationId);
    const step = auto?.steps?.[enr.stepIndex];
    if (!auto?.enabled || !step) {
      enr.status = 'stopped';
      continue;
    }
    if (enr.automationId === 'winback') {
      const newer = orders.some((o) => String(o.customerEmail || '').toLowerCase() === enr.email && new Date(o.createdAt || 0).getTime() >= new Date(enr.enrolledAt || 0).getTime());
      if (newer) {
        enr.status = 'converted_exit';
        continue;
      }
    }
    const vars = enr.vars || {};
    const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === enr.email) || { email: enr.email, name: enr.name, visitorId: enr.visitorId };
    const letter = await composeForSend(uid, contact, step.blocks, vars, { bag: fresh, marketing: true });
    const result = await deliverLetter({
      to: enr.email,
      name: enr.name,
      subject: fillMailTokens(step.subject, letter.vars).slice(0, 200),
      text: letter.text,
      html: letter.html,
      userId: uid,
      visitorId: enr.visitorId,
      medium: enr.automationId,
      marketing: true
    });
    if (!result.ok) {
      enr.lastError = result.error || result.status;
      failed++;
      continue;
    }
    sent++;
    enr.lastError = '';
    enr.stepIndex += 1;
    if (enr.stepIndex >= auto.steps.length) enr.status = 'completed';
    else enr.nextDueAt = new Date(now + (Number(auto.steps[enr.stepIndex]?.delayHours) || 24) * 3600000).toISOString();
  }
  writeUserPrograms(uid, fresh);
  const flowTick = await processCustomFlows(uid);
  return {
    sent: sent + flowTick.sent,
    failed: failed + flowTick.failed,
    active: fresh.enrollments.filter((e) => e.status === 'active').length + flowTick.active
  };
}

function suitePayload(uid) {
  const bag = userProgramBag(uid);
  const drips = loadDrips();
  const installed = (drips.sequences || []).filter((seq) => !seq.userId || seq.userId === uid).map((seq) => ({
    id: seq.id,
    name: seq.name,
    trigger: seq.triggerType,
    steps: (seq.steps || []).length,
    source: 'drip'
  }));
  return {
    hubConnected: hubReady,
    shopifyStillSends: true,
    postalAddress: bag.postalAddress || '',
    timezone: bag.timezone || '',
    installed,
    automations: bag.automations.map((row) => ({
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      description: row.description,
      enabled: row.enabled,
      quietAfterDays: row.quietAfterDays || null,
      steps: row.steps,
      activeEnrollments: bag.enrollments.filter((e) => e.automationId === row.id && e.status === 'active').length
    })),
    transactional: bag.transactional.map((row) => ({
      id: row.id,
      name: row.name,
      shopifyNotification: row.shopifyNotification,
      shopifyTopic: row.shopifyTopic,
      enabled: row.enabled,
      subject: row.subject,
      blocks: row.blocks
    })),
    library: bag.library || []
  };
}

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
  res.json({ success: true, status: { connected: false, provider: null, notice: 'Email sending is not connected.' } });
});

app.get('/api/email/suite', requireUser, (req, res) => {
  ensureSignalStarters(req.user.uid);
  res.json({ success: true, suite: suitePayload(req.user.uid) });
});

app.post('/api/email/programs/preview', requireUser, (req, res) => {
  const blocks = cleanBlocks(req.body?.blocks, []);
  const mode = req.body?.merge === 'keep' ? 'keep' : req.body?.merge === 'person' ? 'person' : 'sample';
  const previewText = String(req.body?.previewText || '').slice(0, 140);
  const marketing = req.body?.marketing !== false;
  if (mode === 'person') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const contact = contactsForUser(req.user.uid).find((row) => String(row.email || '').toLowerCase() === email);
    if (!contact) return res.status(404).json({ success: false, error: 'That person is not in this account.' });
    const orders = loadOrders().filter((order) => order.userId === req.user.uid && String(order.customerEmail || '').toLowerCase() === email && !isDemoRecord(order));
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const checkouts = loadCheckouts().filter((row) => row.userId === req.user.uid && String(row.customerEmail || '').toLowerCase() === email);
    checkouts.sort((a, b) => new Date(b.abandonedAt || 0) - new Date(a.abandonedAt || 0));
    const vars = orders[0]
      ? orderMailVars(orders[0], contact)
      : checkouts[0]
        ? { ...personFields(contact.name, contact), email, phone: contact.phone || '', checkout_url: checkouts[0].abandonedCheckoutUrl || '', eventLineItems: checkouts[0].lineItems || [] }
        : { ...personFields(contact.name, contact), email, phone: contact.phone || '' };
    const letter = composeLetter(req.user.uid, contact, blocks, vars, { previewText, marketing, embedPreheader: true, previewCoupons: true });
    return res.json({
      success: true,
      sample: false,
      label: `Preview for ${email}. Nothing was sent.`,
      subject: fillMailTokens(String(req.body?.subject || ''), letter.vars, false).slice(0, 200),
      html: letter.html,
      text: letter.text,
      untranslated: letter.untranslated || [],
      hidden: letter.hidden || 0
    });
  }
  const keep = mode === 'keep';
  const vars = keep ? {} : { ...SAMPLE_MAIL_VARS };
  const letter = composeLetter(req.user.uid, keep ? { email: '' } : { email: 'preview@example.com', name: 'Alex Sample' }, blocks, vars, {
    keepUnknown: keep,
    marketing,
    previewText,
    embedPreheader: true,
    previewCoupons: true,
    event: keep ? {} : { line_items: [{ title: 'Example product', quantity: 1, price: '48.00' }] }
  });
  const subject = fillMailTokens(String(req.body?.subject || ''), keep ? {} : letter.vars, keep).slice(0, 200);
  res.json({
    success: true,
    sample: !keep,
    label: keep ? '' : 'Sample preview. The name and example product are samples.',
    subject,
    html: letter.html,
    text: letter.text,
    untranslated: letter.untranslated || [],
    hidden: letter.hidden || 0
  });
});

function honestCatalogProduct(product, domain, currency) {
  if (!product || typeof product !== 'object') return null;
  const variant = Array.isArray(product.variants) ? product.variants[0] || {} : {};
  const image = product.images?.[0]?.src || product.image?.src || '';
  const row = { id: String(product.id || '').slice(0, 40) };
  const title = String(product.title || '').trim();
  if (title) row.title = title.slice(0, 200);
  if (typeof image === 'string' && /^https?:\/\//.test(image)) row.image = image.slice(0, 500);
  if (variant.price != null && String(variant.price) !== '') row.price = String(variant.price).slice(0, 40);
  if (variant.compare_at_price != null && String(variant.compare_at_price) !== '') row.compareAt = String(variant.compare_at_price).slice(0, 40);
  if (domain && product.handle) row.url = `https://${domain}/products/${String(product.handle).slice(0, 120)}`;
  if (currency && row.price) row.currency = String(currency).slice(0, 8);
  if (!row.title && !row.image && !row.price && !row.url) return null;
  return row;
}

app.get('/api/email/products', requireUser, async (req, res) => {
  const shops = await listWorkspaces(req.user.uid);
  const shop = shops.find((ws) => realStoreDomain(ws?.shopifyConfig) && adminToken(ws?.shopifyConfig) && ws?.shopifyConfig?.status === 'connected');
  const domain = realStoreDomain(shop?.shopifyConfig);
  const token = adminToken(shop?.shopifyConfig);
  if (!domain || !token) {
    return res.json({ success: true, products: [], notice: 'Connect a Shopify store to choose products.' });
  }
  try {
    const resp = await fetch(`https://${domain}/admin/api/2024-10/products.json?limit=50`, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return res.json({ success: true, products: [], notice: 'The store did not return a product list.' });
    const data = await resp.json();
    rememberAdminCatalog(req.user.uid, domain, data?.products);
    const products = (Array.isArray(data?.products) ? data.products : []).map((product) => honestCatalogProduct(product, domain, shop.shopifyConfig?.currency)).filter(Boolean);
    return res.json({ success: true, products, notice: products.length ? '' : 'The store returned no products.' });
  } catch {
    return res.json({ success: true, products: [], notice: 'The store did not answer.' });
  }
});

app.post('/api/email/library', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const block = cleanBlockList([req.body?.block])[0];
  if (!block) return res.status(400).json({ success: false, error: 'That block could not be saved.' });
  const row = {
    id: `lib_${Date.now().toString(36)}`,
    name: String(req.body?.name || block.kind).slice(0, 80),
    block
  };
  bag.library = cleanLibrary([...(bag.library || []), row]).slice(0, 40);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, library: bag.library });
});

app.delete('/api/email/library/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.library = (bag.library || []).filter((row) => row.id !== req.params.id);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, library: bag.library });
});

app.post('/api/email/postal', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.postalAddress = String(req.body?.physicalAddress || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, physicalAddress: bag.postalAddress });
});

app.post('/api/email/timezone', requireUser, (req, res) => {
  const zone = String(req.body?.timezone || '').trim();
  if (zone && !isIanaTimezone(zone)) {
    return res.status(400).json({ success: false, error: 'Enter a timezone like America/New_York, or leave it empty to use UTC.' });
  }
  const bag = userProgramBag(req.user.uid);
  bag.timezone = zone;
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, timezone: zone });
});

function applyUnsubscribe(uid, email) {
  const all = loadContacts();
  let found = false;
  for (const contact of all) {
    if (contactOwnerId(contact) !== uid) continue;
    if (String(contact.email || '').toLowerCase() !== email) continue;
    contact.acceptsMarketing = false;
    found = true;
  }
  if (found) saveContacts(all);
  const bag = userProgramBag(uid);
  bag.suppressions = noteSuppression(bag.suppressions, email, 'unsubscribe');
  writeUserPrograms(uid, bag);
  return found;
}

function unsubscribeResponse(req, res) {
  const parsed = readUnsubscribe(mailLinkSecret(), req.params.token);
  if (!parsed) {
    const message = 'This unsubscribe link is not valid.';
    if (req.method === 'POST') return res.status(400).type('text/plain').send(message);
    return res.status(400).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head><body style="font-family:Georgia,serif;padding:40px;"><p>${message}</p></body></html>`);
  }
  applyUnsubscribe(parsed.uid, parsed.email);
  const message = 'You are unsubscribed. Marketing mail from this store will stop for this address.';
  if (req.method === 'POST') return res.status(200).type('text/plain').send(message);
  return res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:Georgia,serif;padding:40px;max-width:36rem;"><p>${message}</p></body></html>`);
}

app.get('/u/:token', unsubscribeResponse);
app.post('/u/:token', unsubscribeResponse);

app.post('/api/email/provider-event', (req, res) => {
  const secret = process.env.MAIL_EVENT_SECRET || '';
  if (!secret) return res.status(401).json({ success: false, error: 'Mail event secret is not configured, so bounces are not recorded.' });
  const header = String(req.get('x-jourvance-mail-secret') || '');
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, error: 'The mail event secret did not match, so this event was not recorded.' });
  }
  const uid = String(req.body?.uid || '').slice(0, 128);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const aliases = {
    open: 'email_opened', opened: 'email_opened', email_opened: 'email_opened',
    click: 'email_clicked', clicked: 'email_clicked', email_clicked: 'email_clicked',
    sms_click: 'sms_clicked', sms_clicked: 'sms_clicked',
    delivered: 'email_delivered', email_delivered: 'email_delivered',
    hard_bounce: 'hard_bounce', soft_bounce: 'soft_bounce', complaint: 'complaint', unsubscribe: 'unsubscribe'
  };
  const type = aliases[String(req.body?.type || '')];
  if (!uid || !email.includes('@') || !type) {
    return res.status(400).json({ success: false, error: 'uid, email, and an open, click, delivered, bounce, complaint, or unsubscribe type are required.' });
  }
  const known = knownSend(uid, req.body?.messageId);
  if (type === 'unsubscribe') applyUnsubscribe(uid, email);
  else if (type === 'hard_bounce' || type === 'soft_bounce' || type === 'complaint') {
    const bag = userProgramBag(uid);
    bag.suppressions = noteSuppression(bag.suppressions, email, type);
    writeUserPrograms(uid, bag);
  }
  const event = {
    type, userId: uid, email,
    messageId: known?.messageId || '',
    campaignId: known?.campaignId || '',
    flowId: known?.flowId || '',
    nodeId: known?.nodeId || '',
    sequenceId: known?.sequenceId || '',
    ...emailTouchFields(type)
  };
  if (req.body?.prefetch === true || req.body?.applePrivacy === true) event.prefetch = true;
  recordEvent(event);
  res.json({ success: true, recorded: type, attached: Boolean(known) });
});

app.post('/api/email/programs/:id', requireUser, (req, res) => {
  const id = String(req.params.id || '');
  const kind = req.body?.kind === 'automation' ? 'automation' : 'transactional';
  const bag = userProgramBag(req.user.uid);
  if (kind === 'automation') {
    const row = bag.automations.find((item) => item.id === id);
    if (!row) return res.status(404).json({ success: false, error: 'That automation is not in the suite.' });
    if (req.body?.enabled !== undefined) row.enabled = Boolean(req.body.enabled);
    if (req.body?.steps) row.steps = cleanSteps(req.body.steps, row.steps);
  } else {
    const row = bag.transactional.find((item) => item.id === id);
    if (!row) return res.status(404).json({ success: false, error: 'That letter is not in the suite.' });
    if (req.body?.enabled !== undefined) row.enabled = Boolean(req.body.enabled);
    if (typeof req.body?.subject === 'string' && req.body.subject.trim()) row.subject = req.body.subject.trim().slice(0, 200);
    if (req.body?.blocks) row.blocks = cleanBlocks(req.body.blocks, row.blocks);
  }
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, suite: suitePayload(req.user.uid) });
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
  res.json({ success: true, flows: [] });
});

app.get('/api/email/broadcasts', requireUser, async (req, res) => {
  const campaigns = loadCampaigns().filter(c => c.userId === req.user.uid);
  res.json({
    success: true,
    broadcasts: campaigns.map(presentCampaign),
    followUpNote: FOLLOW_UP_NOTE
  });
});

// Dynamic Audience API reading directly from contacts.json
app.get('/api/email/audience', requireUser, async (req, res) => {
  const contacts = contactsForUser(req.user.uid);
  const suppressions = userProgramBag(req.user.uid).suppressions;
  const orders = accountOrders(req.user.uid);
  const live = predictStore(orders, Date.now());
  res.json({
    success: true,
    subscribers: contacts.map(c => {
      const reason = sendBlockReason(c, suppressions, true);
      const status = reason === 'hard_bounce' || reason === 'soft_bounce' ? 'suppressed' : (c.acceptsMarketing === false || reason === 'unsubscribed' ? 'unsubscribed' : 'active');
      const email = String(c.email || '').toLowerCase();
      const row = live.ready ? live.rows?.[email] : null;
      const spent = historicSpend(orders.filter((order) => String(order.customerEmail || '').toLowerCase() === email));
      return {
      email: c.email,
      name: c.name || c.email.split('@')[0],
      phone: c.phone || '',
      status,
      tags: c.tags || ['Customer'],
      totalSpent: c.totalSpent || 0,
      ordersCount: c.ordersCount || 0,
      joinedAt: c.firstSeenAt || c.subscribedAt || new Date().toISOString(),
      predictionLine: predictionLine(row || spent)
      };
    })
  });
});

function segmentContext(contact, bag, orders, events, account) {
  const email = String(contact?.email || '').toLowerCase();
  const stored = bag.profiles?.[email]?.properties || {};
  const props = contact?.properties && typeof contact.properties === 'object' && !Array.isArray(contact.properties) ? contact.properties : {};
  const profile = overlayPrediction({
    email,
    name: contact?.name || '',
    totalSpent: Number(contact?.totalSpent) || 0,
    ordersCount: Number(contact?.ordersCount) || 0,
    acceptsMarketing: contact?.acceptsMarketing === true,
    tags: Array.isArray(contact?.tags) ? contact.tags.join(',') : '',
    ...stored,
    ...props
  }, account?.rows?.[email]);
  const lists = [...new Set([...(Array.isArray(contact?.lists) ? contact.lists : []), ...(bag.profiles?.[email]?.lists || [])])];
  return {
    contact,
    eligible: !sendBlockReason(contact, bag.suppressions, true),
    profile,
    properties: profile,
    lists,
    event: {},
    orders: (orders || []).filter((order) => String(order.customerEmail || '').toLowerCase() === email).map((order) => ({ at: order.createdAt, createdAt: order.createdAt })),
    events: (events || []).filter((evt) => String(evt.email || '').toLowerCase() === email).map((evt) => ({ type: evt.type, at: evt.at })),
    canEmail: !sendBlockReason(contact, bag.suppressions, true),
    canText: null,
    now: Date.now()
  };
}

function accountEvents(uid) {
  const behavior = loadBehaviorBag(uid).events.filter((evt) => evt.email).map((evt) => ({ type: evt.type, at: evt.at, email: evt.email, userId: uid }));
  return [...loadEvents().filter((evt) => evt.userId === uid), ...behavior];
}

function audienceRows(uid) {
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
  const events = accountEvents(uid);
  const account = predictionAccount(uid);
  return contactsForUser(uid).map((contact) => {
    const ctx = segmentContext(contact, bag, orders, events, account);
    const segments = [
      ...BUILT_INS.filter((row) => inBuiltIn(row.id, contact, ctx.eligible)).map((row) => row.id),
      ...bag.segments.filter((segment) => segmentMatches(segment, ctx)).map((segment) => segment.id)
    ];
    return {
      email: String(contact.email || '').toLowerCase(),
      name: contact.name || '',
      phone: contact.phone || '',
      lists: ctx.lists,
      segments,
      eligible: ctx.eligible,
      ctx
    };
  }).filter((row) => row.email.includes('@'));
}

async function noteSegmentChanges(uid) {
  if (!uid) return { entered: 0, byId: {} };
  const bag = userProgramBag(uid);
  const orders = loadOrders().filter((order) => order.userId === uid && !isDemoRecord(order));
  const events = accountEvents(uid);
  const contacts = contactsForUser(uid);
  const account = predictionAccount(uid);
  const contexts = contacts.map((contact) => segmentContext(contact, bag, orders, events, account));
  const nowIso = new Date().toISOString();
  const state = { ...(bag.segmentState || {}) };
  const byId = {};
  const consider = [
    ...BUILT_INS.map((row) => ({ id: row.id, builtin: true })),
    ...bag.segments.map((segment) => ({ id: segment.id, builtin: false, segment }))
  ];
  for (const item of consider) {
    const matching = [];
    for (const ctx of contexts) {
      const hit = item.builtin ? inBuiltIn(item.id, ctx.contact, ctx.eligible) : segmentMatches(item.segment, ctx);
      if (hit) matching.push(String(ctx.contact.email || '').toLowerCase());
    }
    const next = nextSegmentState(state[item.id], matching, nowIso, item.builtin ? 'quiet' : 'enter');
    state[item.id] = next.row;
    byId[item.id] = next.entered.length;
    for (const email of next.entered) {
      const ctx = contexts.find((row) => String(row.contact.email || '').toLowerCase() === email);
      await enrollFlowsForTrigger(uid, 'segment_entered', ctx?.contact || { email }, {}, {
        reason: 'segment',
        dedupe: `segment:${item.id}:${nowIso}`,
        occurrence: `segment:${item.id}:${nowIso}`,
        event: { segment_id: item.id }
      }, bag);
    }
  }
  bag.segmentState = state;
  writeUserPrograms(uid, bag);
  return { entered: Object.values(byId).reduce((sum, count) => sum + count, 0), byId };
}

function segmentMembers(uid, segmentId) {
  return audienceRows(uid).filter((row) => row.eligible && row.segments.includes(segmentId || 'all')).map((row) => (
    contactsForUser(uid).find((contact) => String(contact.email || '').toLowerCase() === row.email)
  )).filter(Boolean);
}

function presentCampaign(row) {
  const stats = messageStatsFor(row.userId, (item) => item.campaignId === row.id);
  if (stats.sent == null && Array.isArray(row.sentTo) && row.sentTo.length) stats.sent = row.sentTo.length;
  return {
    id: row.id,
    subject: row.subject,
    previewText: row.previewText || '',
    body: row.body || '',
    segment: row.segment || '',
    segmentName: row.segmentName || '',
    recipients: Number(row.recipients) || 0,
    recipientsCount: Number(row.recipientsCount ?? row.recipients) || 0,
    sentAt: row.sentAt || null,
    openRate: null,
    clickRate: null,
    attributedSales: stats.revenue,
    sent: stats.sent,
    delivered: stats.delivered,
    opened: stats.opened,
    clicked: stats.clicked,
    unsubscribed: stats.unsubscribed,
    revenue: stats.revenue,
    prefetchOpens: stats.prefetchOpens,
    holdout: row.holdout || null,
    holdoutReport: row.holdout?.enabled ? holdoutReport(
      (row.sentTo || []).map((email) => ({ email, at: row.holdoutAssignedAt || row.sentAt || '' })),
      row.heldOut || [],
      loadOrders().filter((order) => order.userId === row.userId && !isDemoRecord(order))
    ) : null,
    status: row.status || '',
    sendMode: row.sendMode,
    when: row.when || '',
    sendAt: row.sendAt || null,
    gradual: row.gradual || null,
    ab: row.ab ? { variable: row.ab.variable, winner: row.ab.winner || '', offsetHours: row.ab.offsetHours || 0 } : null,
    smartSkip: row.smartSkip === true,
    smartReport: row.smart?.report || '',
    followUp: null,
    followUpNote: FOLLOW_UP_NOTE,
    shopifyTagApplied: row.shopifyTagApplied,
    scheduledCount: Array.isArray(row.audience) ? row.audience.length : (Number(row.recipients) || 0),
    lastError: row.lastError || ''
  };
}

function knownPick(uid, pick) {
  const bag = userProgramBag(uid);
  if (pick.type === 'list') return bag.lists.some((list) => list.id === pick.id);
  return BUILT_INS.some((row) => row.id === pick.id) || bag.segments.some((segment) => segment.id === pick.id);
}

async function recentMarketing(uid, email, now) {
  const sinceEmail = now - SMART_EMAIL_HOURS * 3600000;
  const sinceSms = now - SMART_SMS_HOURS * 3600000;
  const own = loadEvents().filter((evt) => evt.userId === uid && String(evt.email || '').toLowerCase() === email && evt.transactional !== true);
  return {
    email: own.some((evt) => evt.type === 'email_sent' && new Date(evt.at || 0).getTime() >= sinceEmail),
    sms: own.some((evt) => evt.type === 'sms_sent' && new Date(evt.at || 0).getTime() >= sinceSms)
  };
}

async function deliverCampaignParts(uid, record, emailPeople, smsPeople, now) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let held = 0;
  let lastError = '';
  record.sentTo = Array.isArray(record.sentTo) ? record.sentTo : [];
  record.skipped = Array.isArray(record.skipped) ? record.skipped : [];
  record.heldOut = Array.isArray(record.heldOut) ? record.heldOut : [];
  record.smsSentTo = Array.isArray(record.smsSentTo) ? record.smsSentTo : [];
  record.smsSkipped = Array.isArray(record.smsSkipped) ? record.smsSkipped : [];
  if (record.holdout?.enabled) {
    const at = record.holdoutAssignedAt || new Date(now).toISOString();
    record.holdoutAssignedAt = at;
    const already = new Set(record.heldOut.map((row) => row.email));
    const split = splitHoldout(emailPeople.filter((person) => !already.has(person.email)), record.holdout, record.id, at);
    for (const row of split.held) {
      record.heldOut.push(row);
      record.skipped.push(row.email);
      recordEvent({ type: 'email_held', userId: uid, email: row.email, campaignId: record.id, at });
      held += 1;
    }
    emailPeople = split.send;
  }
  for (const person of emailPeople) {
    const recent = await recentMarketing(uid, person.email, now);
    if (smartSkipReason('email', { enabled: record.smartSkip === true, ...recent })) {
      record.skipped.push(person.email);
      skipped += 1;
      continue;
    }
    const contact = contactsForUser(uid).find((row) => String(row.email || '').toLowerCase() === person.email) || person;
    const subject = person.side === 'b' && record.ab?.variable === 'subject' ? record.ab.subjectB : record.subject;
    const body = person.side === 'b' && record.ab?.variable === 'content' ? record.ab.bodyB : (record.body || '');
    const useBlocks = Array.isArray(record.blocks) && record.blocks.length && !(person.side === 'b' && record.ab?.variable === 'content');
    const sourceBlocks = useBlocks ? record.blocks : [{ kind: 'text', text: body || record.html || '' }];
    const letter = await composeForSend(uid, contact, sourceBlocks, {}, { previewText: record.previewText, marketing: true });
    const result = await deliverLetter({
      to: person.email,
      name: person.name,
      subject: fillMailTokens(subject, letter.vars).slice(0, 200),
      text: letter.text,
      html: applyUtm(letter.html, record.utm),
      previewText: record.previewText,
      userId: uid,
      visitorId: contact.visitorId,
      medium: 'broadcast',
      marketing: true,
      campaignId: record.id
    });
    if (!result.ok) {
      if (result.status === 'unsubscribed' || result.status === 'suppressed') record.skipped.push(person.email);
      failed += 1;
      lastError = result.error || result.status;
      continue;
    }
    record.sentTo.push(person.email);
    sent += 1;
  }
  for (const person of smsPeople) {
    const until = smsQuietEnabled({ transactional: false, quietHours: record.sms?.quietHours }) ? quietOpenAt(now, userProgramBag(uid).timezone) : null;
    if (until && until > now + 999) {
      record.smsQuietUntil = new Date(until).toISOString();
      record.smsNote = 'Quiet hours. This text waits until the window opens.';
      continue;
    }
    if (record.sms?.confirm !== true) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      record.smsNote = 'The text was not sent because opt-in was not confirmed.';
      continue;
    }
    const recent = await recentMarketing(uid, person.email, now);
    if (smartSkipReason('sms', { enabled: record.smartSkip === true, ...recent })) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      continue;
    }
    const optedIn = await textConsentKnown(person.email, person.phone);
    if (optedIn !== true || !person.phone) {
      record.smsSkipped.push(person.email);
      skipped += 1;
      record.smsNote = 'The text was not sent because this number is not on the opted-in list.';
      continue;
    }
    try {
      const messageId = `msg_${crypto.randomBytes(6).toString('hex')}`;
      const prepared = await prepareSmsMessage(uid, record.sms.message, {
        email: person.email, coupon: record.sms.coupon, messageId, campaignId: record.id, utm: { utm_source: 'sms', utm_medium: 'broadcast' }
      });
      const sentSms = await hub.email.sms.send({ message: prepared.text, recipients: [{ email: person.email, phone: person.phone, name: person.name || '' }] });
      const blast = sentSms?.blast;
      if (!sentSms || sentSms.success === false || sentSms.error || (blast && (blast.sent || 0) === 0)) {
        failed += 1;
        lastError = sentSms?.error || 'The text was not sent.';
        continue;
      }
      recordEvent({ type: 'sms_sent', userId: uid, email: person.email, utm_source: 'sms', utm_medium: 'broadcast', transactional: false, messageId, campaignId: record.id });
      record.smsSentTo.push(person.email);
      sent += 1;
    } catch (err) {
      failed += 1;
      lastError = err.message || 'The text was not sent.';
    }
  }
  record.recipients = (record.sentTo.length || 0);
  record.recipientsCount = record.recipients;
  record.lastError = lastError;
  return { sent, failed, skipped, held, lastError };
}

function unfinishedPeople(audience, sentTo, skipped) {
  const done = new Set([...(sentTo || []), ...(skipped || [])]);
  return (audience || []).filter((person) => person?.email && !done.has(person.email));
}

function finishCampaign(record, now) {
  const emailLeft = unfinishedPeople(record.audience, record.sentTo, record.skipped);
  const smsLeft = unfinishedPeople(record.smsAudience, record.smsSentTo, record.smsSkipped);
  if (!emailLeft.length && !smsLeft.length) {
    record.status = record.recipients && record.lastError ? 'partial' : 'sent';
    record.sentAt = record.sentAt || new Date(now).toISOString();
    record.nextAt = '';
    record.smsQuietUntil = '';
    return;
  }
  if (record.smsQuietUntil && Date.parse(record.smsQuietUntil) > now && smsLeft.length) {
    record.status = 'sending';
    record.nextAt = record.smsQuietUntil;
    return;
  }
  record.status = 'sending';
  if (record.when === 'smart' && record.gradual) record.nextAt = nextBatchAt(record, now);
  else if (record.when === 'smart') {
    const times = [...emailLeft, ...smsLeft].map((person) => Date.parse(person?.smart?.sendAt || '')).filter((at) => Number.isFinite(at));
    record.nextAt = times.length ? new Date(Math.min(...times)).toISOString() : new Date(now).toISOString();
  } else record.nextAt = record.when === 'gradual' ? nextBatchAt(record, now) : (record.sendAt || new Date(now).toISOString());
}

async function processDueCampaigns(uid) {
  const now = Date.now();
  const campaigns = loadCampaigns();
  let sent = 0;
  let changed = false;
  for (const record of campaigns) {
    if (record.userId !== uid || record.sendMode === 'shopify_push') continue;
    if (record.status !== 'scheduled' && record.status !== 'sending') continue;
    if (record.nextAt && record.status === 'sending' && new Date(record.nextAt).getTime() > now) continue;
    const emailDue = dueRecipients(record, now);
    const smsRecord = { ...record, audience: record.smsAudience || [], sentTo: record.smsSentTo || [], skipped: record.smsSkipped || [] };
    const smsDue = record.sms?.message ? dueRecipients(smsRecord, now) : { due: [] };
    if (!emailDue.due.length && !smsDue.due.length) continue;
    const result = await deliverCampaignParts(uid, record, emailDue.due, smsDue.due, now);
    finishCampaign(record, now);
    sent += result.sent;
    changed = true;
  }
  if (changed) saveCampaigns(campaigns);
  return { sent };
}

function segmentLabel(uid, id) {
  return BUILT_INS.find((row) => row.id === id)?.name
    || userProgramBag(uid).segments.find((row) => row.id === id)?.name
    || userProgramBag(uid).lists.find((row) => row.id === id)?.name
    || id;
}

app.get('/api/email/segments', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const rows = audienceRows(req.user.uid);
  const segments = [
    ...BUILT_INS.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.definition,
      definition: row.definition,
      count: rows.filter((person) => person.segments.includes(row.id)).length,
      filterKey: row.id,
      builtin: true
    })),
    ...bag.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      description: segmentDefinition(segment),
      definition: segmentDefinition(segment),
      count: rows.filter((person) => person.segments.includes(segment.id)).length,
      filterKey: 'custom',
      builtin: false,
      join: segment.join,
      groups: segment.groups
    }))
  ];
  res.json({
    success: true,
    totalAudience: contactsForUser(req.user.uid).length,
    segments,
    followUpNote: FOLLOW_UP_NOTE
  });
});

app.get('/api/email/lists', requireUser, (req, res) => {
  const lists = userProgramBag(req.user.uid).lists.map((list) => ({
    ...list,
    count: contactsForUser(req.user.uid).filter((contact) => (contact.lists || []).includes(list.id)).length
  }));
  res.json({ success: true, lists });
});

app.post('/api/email/lists', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  if (bag.lists.length >= 50) return res.status(400).json({ success: false, error: 'This account already has 50 lists.' });
  const list = { id: `list_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: String(req.body?.name || 'List').slice(0, 80), createdAt: new Date().toISOString() };
  bag.lists.unshift(list);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, list: { ...list, count: 0 } });
});

app.delete('/api/email/lists/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.lists = bag.lists.filter((list) => list.id !== req.params.id);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true });
});

app.post('/api/email/lists/:id/members', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const list = bag.lists.find((row) => row.id === req.params.id);
  if (!list) return res.status(404).json({ success: false, error: 'That list is not on this account.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const contacts = loadContacts();
  const contact = contacts.find((row) => String(row.email || '').toLowerCase() === email && contactOwnerId(row) === req.user.uid);
  if (!contact) return res.status(404).json({ success: false, error: 'That person is not on this account.' });
  const update = req.body?.update === 'remove' ? 'remove' : 'add';
  const change = applyListChange(contact.lists, list.id, update);
  contact.lists = change.next;
  saveContacts(contacts);
  let started = 0;
  if (change.added) {
    const enrolled = await enrollFlowsForTrigger(req.user.uid, 'list_added', contact, {}, {
      listId: list.id,
      reason: 'list',
      dedupe: `list:${list.id}`,
      occurrence: `list:${list.id}:${new Date().toISOString()}`,
      event: { list_id: list.id }
    });
    started = enrolled.added;
  }
  await noteSegmentChanges(req.user.uid);
  const saved = loadContacts().find((row) => String(row.email || '').toLowerCase() === email && contactOwnerId(row) === req.user.uid);
  res.json({
    success: true,
    added: change.added,
    removed: change.removed,
    acceptsMarketing: saved?.acceptsMarketing === true,
    enrolled: started
  });
});

app.post('/api/email/segments', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  if (bag.segments.length >= 50) return res.status(400).json({ success: false, error: 'This account already has 50 segments.' });
  const id = `seg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cleaned = cleanSegment({ ...req.body, id });
  if (!cleaned.ok) return res.status(400).json({ success: false, error: cleaned.error });
  bag.segments.unshift(cleaned.segment);
  writeUserPrograms(req.user.uid, bag);
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, segment: { ...cleaned.segment, definition: segmentDefinition(cleaned.segment) }, entered: noted.byId[id] || 0 });
});

app.post('/api/email/segments/:id', requireUser, async (req, res) => {
  if (BUILT_INS.some((row) => row.id === req.params.id)) return res.status(400).json({ success: false, error: 'That built-in segment stays as it is.' });
  const bag = userProgramBag(req.user.uid);
  const index = bag.segments.findIndex((row) => row.id === req.params.id);
  if (index < 0) return res.status(404).json({ success: false, error: 'That segment is not on this account.' });
  const cleaned = cleanSegment({ ...bag.segments[index], ...req.body, id: req.params.id });
  if (!cleaned.ok) return res.status(400).json({ success: false, error: cleaned.error });
  bag.segments[index] = cleaned.segment;
  writeUserPrograms(req.user.uid, bag);
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, segment: cleaned.segment, entered: noted.byId[req.params.id] || 0 });
});

app.post('/api/email/segments/:id/refresh', requireUser, async (req, res) => {
  const known = BUILT_INS.some((row) => row.id === req.params.id) || userProgramBag(req.user.uid).segments.some((row) => row.id === req.params.id);
  if (!known) return res.status(404).json({ success: false, error: 'That segment is not on this account.' });
  const noted = await noteSegmentChanges(req.user.uid);
  res.json({ success: true, entered: noted.byId[req.params.id] || 0 });
});

app.delete('/api/email/segments/:id', requireUser, (req, res) => {
  if (BUILT_INS.some((row) => row.id === req.params.id)) return res.status(400).json({ success: false, error: 'That built-in segment stays as it is.' });
  const bag = userProgramBag(req.user.uid);
  bag.segments = bag.segments.filter((row) => row.id !== req.params.id);
  if (bag.segmentState) delete bag.segmentState[req.params.id];
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true });
});

app.delete('/api/email/campaigns/:id', requireUser, (req, res) => {
  const campaigns = loadCampaigns();
  const row = campaigns.find((item) => item.id === req.params.id && item.userId === req.user.uid);
  if (!row) return res.status(404).json({ success: false, error: 'That campaign is not on this account.' });
  if (row.sentAt || (row.sentTo || []).length || (row.smsSentTo || []).length) {
    return res.status(400).json({ success: false, error: 'That campaign already sent, so it was left in place.' });
  }
  saveCampaigns(campaigns.filter((item) => item.id !== row.id));
  res.json({ success: true });
});

app.post('/api/email/campaigns/:id/winner', requireUser, (req, res) => {
  const winner = req.body?.winner === 'a' || req.body?.winner === 'b' ? req.body.winner : '';
  if (!winner) return res.status(400).json({ success: false, error: 'Choose version A or version B.' });
  const campaigns = loadCampaigns();
  const row = campaigns.find((item) => item.id === req.params.id && item.userId === req.user.uid);
  if (!row?.ab) return res.status(400).json({ success: false, error: 'This campaign has no A/B test.' });
  row.ab.winner = winner;
  saveCampaigns(campaigns);
  res.json({ success: true, campaign: presentCampaign(row), message: 'Winner saved. Nothing was sent.' });
});

// Send Segmented Campaign (Direct Delivery or 1-Click Shopify Email Segment Push)
app.post('/api/email/campaign/send', requireUser, async (req, res) => {
  const { subject, previewText, body, bodyText, html, segmentId, sendMode } = req.body || {};
  const blocks = Array.isArray(req.body?.blocks) ? cleanBlocks(req.body.blocks, []) : [];
  const emailBody = body || bodyText || '';
  const emailHtml = typeof html === 'string' ? html : '';
  const smsMessage = String(req.body?.smsMessage || '').trim().slice(0, 480);
  const hasEmail = Boolean(subject && (emailBody || emailHtml.trim() || blocks.length));
  const hasSms = Boolean(smsMessage);
  if (!hasEmail && !hasSms) return res.status(400).json({ success: false, error: 'Subject and email body are required.' });
  const holdout = cleanHoldout(req.body?.holdout);
  if (!holdout.ok) return res.status(400).json({ success: false, error: holdout.error });
  const mode = sendMode === 'shopify_push' ? 'shopify_push' : 'direct';
  const schedule = campaignSchedule({
    when: req.body?.when,
    sendAt: req.body?.sendAt,
    timezone: userProgramBag(req.user.uid).timezone,
    gradual: req.body?.gradual
  });
  if (!schedule.ok) return res.status(400).json({ success: false, error: schedule.error });
  if (mode === 'shopify_push' && schedule.when !== 'now') {
    return res.status(400).json({ success: false, error: 'Scheduling sends from Jourvance. Shopify tagging runs when you choose send now.' });
  }
  const ab = cleanAb(req.body?.ab);
  if (!ab.ok) return res.status(400).json({ success: false, error: ab.error });
  if (smartSendConflict(schedule.when, ab.ab)) {
    return res.status(400).json({ success: false, error: 'Smart send does not combine with a send-time A/B.' });
  }
  const fallback = schedule.when === 'smart' ? cleanFallbackHour(req.body?.fallbackHour) : { ok: true, hour: null };
  if (!fallback.ok) return res.status(400).json({ success: false, error: fallback.error });
  let include = cleanPicks(req.body?.include);
  if (!include.ok) return res.status(400).json({ success: false, error: include.error });
  if (!include.picks.length) include = { ok: true, picks: [{ type: 'segment', id: String(segmentId || 'all').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'all' }] };
  const exclude = cleanPicks(req.body?.exclude);
  if (!exclude.ok) return res.status(400).json({ success: false, error: exclude.error });
  let smsInclude = cleanPicks(req.body?.smsInclude);
  if (!smsInclude.ok) return res.status(400).json({ success: false, error: smsInclude.error });
  if (!smsInclude.picks.length) smsInclude = include;
  for (const pick of [...include.picks, ...exclude.picks, ...smsInclude.picks]) {
    if (!knownPick(req.user.uid, pick)) return res.status(400).json({ success: false, error: 'That list or segment is not on this account.' });
  }
  const eligible = audienceRows(req.user.uid).filter((row) => row.eligible);
  const people = hasEmail ? resolveAudience(eligible, include.picks, exclude.picks) : [];
  const smsPeople = hasSms ? resolveAudience(eligible, smsInclude.picks, exclude.picks) : [];
  if ((hasEmail && !people.length) || (!hasEmail && !smsPeople.length)) {
    return res.status(400).json({ success: false, error: 'No contacts match that segment, so nothing was sent.' });
  }
  if (mode === 'shopify_push') {
    const tagToApply = `jourvance-segment-${include.picks[0]?.id || 'all'}`;
    const all = loadContacts();
    const wanted = new Set(people.map((person) => person.email));
    for (const contact of all) {
      if (contactOwnerId(contact) !== req.user.uid || !wanted.has(String(contact.email || '').toLowerCase())) continue;
      if (!contact.tags) contact.tags = [];
      if (!contact.tags.includes(tagToApply)) contact.tags.push(tagToApply);
    }
    saveContacts(all);
    const campaignRecord = {
      id: `camp_${Date.now()}`,
      subject,
      previewText: previewText || '',
      body: emailBody,
      segment: include.picks[0]?.id || 'all',
      segmentName: include.picks.map((pick) => segmentLabel(req.user.uid, pick.id)).join(', '),
      recipients: people.length,
      recipientsCount: people.length,
      sentAt: null,
      openRate: null,
      clickRate: null,
      attributedSales: null,
      status: 'tagged-locally',
      sendMode: mode,
      userId: req.user.uid,
      shopifyTagApplied: tagToApply,
      followUp: null
    };
    const campaigns = loadCampaigns();
    campaigns.unshift(campaignRecord);
    saveCampaigns(campaigns);
    return res.json({
      success: true,
      campaign: presentCampaign(campaignRecord),
      recipientCount: people.length,
      recipientsCount: people.length,
      followUp: null,
      followUpNote: FOLLOW_UP_NOTE,
      appliedShopifyTag: tagToApply,
      message: `Tagged ${people.length} contacts here as ${tagToApply}. Shopify was not emailed.`
    });
  }
  const record = {
    id: `camp_${Date.now().toString(36)}`,
    userId: req.user.uid,
    subject: String(subject || 'Text message').slice(0, 200),
    previewText: String(previewText || '').slice(0, 140),
    body: emailBody,
    html: emailHtml,
    blocks,
    segment: include.picks[0]?.id || 'all',
    segmentName: include.picks.map((pick) => segmentLabel(req.user.uid, pick.id)).join(', ').slice(0, 180),
    include: include.picks,
    exclude: exclude.picks,
    when: schedule.when,
    sendAt: schedule.sendAt,
    gradual: schedule.gradual,
    ab: ab.ab,
    utm: cleanUtm(req.body?.utm),
    smartSkip: req.body?.smartSkip === true,
    holdout: holdout.holdout,
    heldOut: [],
    audience: people,
    smsAudience: smsPeople,
    sms: hasSms ? { message: smsMessage, confirm: req.body?.smsConfirm === 'opted-in' || req.body?.confirm === 'opted-in' } : null,
    sentTo: [],
    skipped: [],
    smsSentTo: [],
    smsSkipped: [],
    recipients: 0,
    recipientsCount: 0,
    sentAt: null,
    openRate: null,
    clickRate: null,
    attributedSales: null,
    status: 'scheduled',
    sendMode: 'direct',
    followUp: null,
    nextAt: ''
  };
  if (schedule.when === 'smart') {
    const zoneFor = (email) => {
      const contact = contactsForUser(req.user.uid).find((row) => String(row.email || '').toLowerCase() === email);
      const zone = contact?.timezone || contact?.properties?.timezone;
      return isIanaTimezone(zone) ? zone : '';
    };
    const seen = new Set();
    const recipients = [];
    for (const person of [...people, ...smsPeople]) {
      if (seen.has(person.email)) continue;
      seen.add(person.email);
      recipients.push({ email: person.email, timezone: zoneFor(person.email) });
    }
    const plan = assignSmartSend({
      people: recipients,
      events: accountEvents(req.user.uid),
      now: Date.now(),
      accountTimezone: userProgramBag(req.user.uid).timezone,
      fallbackHour: fallback.hour,
      explore: req.body?.explore === true,
      seed: record.id
    });
    const byEmail = new Map(plan.assignments.map((row) => [row.email, { rule: row.rule, hour: row.hour, sampleSize: row.sampleSize, sendAt: row.sendAt }]));
    record.audience = people.map((person) => ({ ...person, smart: byEmail.get(person.email) || null }));
    record.smsAudience = smsPeople.map((person) => ({ ...person, smart: byEmail.get(person.email) || null }));
    record.smart = { fallbackHour: fallback.hour, explore: req.body?.explore === true, batches: plan.batches, report: plan.report };
  }
  const campaigns = loadCampaigns();
  if (schedule.waiting) {
    campaigns.unshift(record);
    saveCampaigns(campaigns);
    return res.json({
      success: true,
      campaign: presentCampaign(record),
      recipientCount: 0,
      recipientsCount: 0,
      followUp: null,
      followUpNote: FOLLOW_UP_NOTE,
      smartReport: record.smart?.report || '',
      message: 'Scheduled. Nothing was sent.'
    });
  }
  if (hasEmail && !hubReady) return res.status(503).json({ success: false, error: 'Email sending is not connected, so nothing was sent.' });
  const now = Date.now();
  const emailDue = dueRecipients(record, now);
  const smsDue = record.sms?.message ? dueRecipients({ ...record, audience: record.smsAudience, sentTo: [], skipped: [] }, now) : { due: [] };
  const result = await deliverCampaignParts(req.user.uid, record, emailDue.due, smsDue.due, now);
  if (!result.sent && result.failed && !result.skipped && !result.held) {
    return res.status(502).json({ success: false, error: result.lastError || 'The email service rejected the send.', failed: result.failed, followUp: null, followUpNote: FOLLOW_UP_NOTE });
  }
  finishCampaign(record, now);
  campaigns.unshift(record);
  saveCampaigns(campaigns);
  res.json({
    success: true,
    campaign: presentCampaign(record),
    recipientCount: result.sent,
    recipientsCount: result.sent,
    failed: result.failed,
    skipped: result.skipped,
    followUp: null,
    followUpNote: FOLLOW_UP_NOTE,
    message: `Sent to ${result.sent} recipients.${result.failed ? ` ${result.failed} were not sent.` : ''}${result.skipped ? ` ${result.skipped} were skipped.` : ''}${result.held ? ` ${result.held} were held out and received nothing.` : ''}`
  });
});

// ── Wave 7: Automated Lead Nurture Drips API ──────────────────────────────────

app.get('/api/drips/sequences', requireUser, async (req, res) => {
  const { sequences } = loadDrips();
  res.json({
    success: true,
    sequences: sequences.map((seq) => ({ ...seq, attributedSales: sequenceRevenue(req.user.uid, seq.id) })),
    revenueNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. Blank until one of those is stored.'
  });
});

app.post('/api/drips/sequences', requireUser, async (req, res) => {
  const { name, description, triggerType, smartExitOnPurchase, steps } = req.body || {};
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: 'Sequence name and at least one step are required.' });
  }

  const dripsData = loadDrips();
  const newSeq = {
    id: `drip_seq_${Date.now()}`,
    name,
    description: description || 'Automated lead nurture drip workflow.',
    triggerType: triggerType || 'lead_capture',
    smartExitOnPurchase: smartExitOnPurchase !== false,
    steps: steps.map((st, idx) => ({
      id: st.id || `step_${idx + 1}`,
      stepNumber: idx + 1,
      delayHours: Number(st.delayHours ?? (idx * 24)),
      subject: st.subject || 'Automated Nurture Step',
      previewText: st.previewText || '',
      body: st.body || '',
      discountVoucher: st.discountVoucher || ''
    })),
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  dripsData.sequences.unshift(newSeq);
  saveDrips(dripsData);

  res.json({ success: true, sequence: newSeq });
});

app.get('/api/drips/enrollments', requireUser, async (req, res) => {
  const { enrollments } = loadDrips();
  const mine = enrollments.filter(e => e.userId === req.user.uid);
  res.json({ success: true, enrollments: mine.slice(0, 100) });
});

app.post('/api/drips/enroll', requireUser, async (req, res) => {
  const { sequenceId, customerEmail, customerName, sourceSlug } = req.body || {};
  if (!customerEmail || !customerEmail.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid customer email is required.' });
  }

  const dripsData = loadDrips();
  const seq = dripsData.sequences.find(s => s.id === (sequenceId || 'drip_seq_default')) || dripsData.sequences[0];
  if (!seq) {
    return res.status(404).json({ success: false, error: 'Drip sequence not found.' });
  }

  const alreadyActive = dripsData.enrollments.find(e => e.customerEmail === customerEmail.toLowerCase().trim() && e.sequenceId === seq.id && e.status === 'active');
  if (alreadyActive) {
    return res.json({ success: true, message: 'Contact is already active in this sequence.', enrollment: alreadyActive });
  }

  const enrollment = {
    id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sequenceId: seq.id,
    userId: req.user.uid,
    customerEmail: customerEmail.toLowerCase().trim(),
    customerName: customerName || customerEmail.split('@')[0],
    sourceSlug: sourceSlug || 'direct',
    currentStepIndex: 0,
    status: 'active',
    enrolledAt: new Date().toISOString(),
    nextStepDueAt: new Date().toISOString(),
    history: []
  };

  dripsData.enrollments.unshift(enrollment);
  seq.activeEnrollments = (seq.activeEnrollments || 0) + 1;
  saveDrips(dripsData);

  res.json({ success: true, enrollment });
});

app.get('/api/email/predictions', requireUser, (req, res) => {
  const result = predictStore(accountOrders(req.user.uid), Date.now());
  res.json({ success: true, ...publicPrediction(result) });
});

app.post('/api/email/predictions/refresh', requireUser, async (req, res) => {
  try {
    const result = await refreshPredictions(req.user.uid);
    res.json({
      success: true,
      ...publicPrediction(result),
      message: result.ready ? 'Predicted value was recomputed from this store’s orders.' : 'Predicted value was not saved. This store’s history is still too thin.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Predicted value was not computed.' });
  }
});

app.post('/api/drips/process-tick', requireUser, async (req, res) => {
  try { await refreshPredictionsIfDue(req.user.uid); } catch (err) {
    console.warn('[Jourvance] Prediction refresh failed:', err.message);
  }
  const dripsData = loadDrips();
  const orders = loadOrders().filter(o => o.userId === req.user.uid);
  const programTick = await processAccountAutomations(req.user.uid);
  const campaignTick = await processDueCampaigns(req.user.uid);
  const holdForKlaviyo = klaviyoIsSender(req.user.uid);
  const now = Date.now();
  let processedCount = 0;
  let convertedExitCount = 0;
  let completedCount = 0;

  for (const enr of dripsData.enrollments) {
    if (holdForKlaviyo) break;
    if (enr.status !== 'active' || enr.userId !== req.user.uid) continue;

    const seq = dripsData.sequences.find(s => s.id === enr.sequenceId);
    if (!seq) continue;

    // 1. Smart Exit on Purchase Check
    if (seq.smartExitOnPurchase) {
      const hasBought = orders.some(o => o.customerEmail === enr.customerEmail && new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() - 60000);
      if (hasBought) {
        enr.status = 'converted_exit';
        enr.convertedAt = new Date().toISOString();
        seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
        seq.totalExitedPurchased = (seq.totalExitedPurchased || 0) + 1;
        convertedExitCount++;
        continue;
      }
    }

    // 2. Due Date Check
    const dueDate = new Date(enr.nextStepDueAt || enr.enrolledAt).getTime();
    if (dueDate <= now) {
      const step = seq.steps[enr.currentStepIndex];
      if (step) {
        if (!hubReady || !enr.customerEmail) continue;
        const dripContact = loadContacts().find(c => c.email === enr.customerEmail && contactOwnerId(c) === req.user.uid) || { email: enr.customerEmail, name: enr.customerName };
        const checkout = loadCheckouts().find((row) => row.userId === req.user.uid && String(row.customerEmail || '').toLowerCase() === String(enr.customerEmail || '').toLowerCase() && row.abandonedCheckoutUrl);
        const letter = await composeForSend(req.user.uid, dripContact, [{ kind: 'text', text: step.body || '' }], {
          checkout_url: checkout?.abandonedCheckoutUrl || '',
          first_name: personFields(dripContact.name || enr.customerName).first_name,
          eventLineItems: Array.isArray(checkout?.lineItems) ? checkout.lineItems : []
        }, { marketing: true, previewText: step.previewText });
        const result = await deliverLetter({
          to: enr.customerEmail,
          name: dripContact.name || enr.customerName,
          subject: fillMailTokens(step.subject || '', letter.vars).slice(0, 200),
          text: letter.text,
          html: letter.html,
          previewText: step.previewText,
          userId: req.user.uid,
          visitorId: dripContact.visitorId,
          medium: 'drip',
          marketing: true,
          sequenceId: seq.id
        });
        if (!result.ok) {
          enr.history.push({
            stepNumber: step.stepNumber,
            subject: step.subject,
            sentAt: new Date().toISOString(),
            status: 'failed',
            error: result.error || result.status
          });
          continue;
        }
        enr.history.push({
          stepNumber: step.stepNumber,
          subject: step.subject,
          sentAt: new Date().toISOString(),
          status: 'sent'
        });
        enr.lastStepSentAt = new Date().toISOString();
        processedCount++;

        // Advance or complete
        if (enr.currentStepIndex + 1 < seq.steps.length) {
          enr.currentStepIndex++;
          const nextStep = seq.steps[enr.currentStepIndex];
          const delayMs = (nextStep.delayHours || 24) * 3600000;
          enr.nextStepDueAt = new Date(now + delayMs).toISOString();
        } else {
          enr.status = 'completed';
          seq.activeEnrollments = Math.max(0, (seq.activeEnrollments || 1) - 1);
          seq.totalCompleted = (seq.totalCompleted || 0) + 1;
          completedCount++;
        }
      }
    }
  }

  // 3. Wave 8: Abandoned Checkout Recovery Processing
  const checkouts = loadCheckouts();
  let checkoutsModified = false;
  let cartRecoverySentCount = 0;

  for (const chk of checkouts) {
    if (chk.recoveryStatus === 'pending' && chk.userId === req.user.uid) {
      const abandonedTime = new Date(chk.abandonedAt).getTime();
      if (now - abandonedTime >= 2700000) {
        const bought = orders.some(o => o.customerEmail === chk.customerEmail && new Date(o.createdAt).getTime() >= abandonedTime - 60000);
        if (bought) {
          chk.recoveryStatus = 'recovered';
          chk.recoveredAt = new Date().toISOString();
        } else if (!holdForKlaviyo && hubReady && chk.customerEmail) {
          const recoveryContact = loadContacts().find(c => c.email === chk.customerEmail && contactOwnerId(c) === req.user.uid) || { email: chk.customerEmail };
          const letter = composeLetter(req.user.uid, recoveryContact, [{ kind: 'text', text: `You can finish checking out here: ${chk.abandonedCheckoutUrl || ''}` }], {
            checkout_url: chk.abandonedCheckoutUrl || ''
          }, { marketing: true });
          const result = await deliverLetter({
            to: chk.customerEmail,
            name: recoveryContact.name || '',
            subject: 'Your checkout is still open',
            text: letter.text,
            html: letter.html,
            userId: req.user.uid,
            visitorId: recoveryContact.visitorId || chk.visitorId,
            medium: 'drip',
            marketing: true
          });
          if (result.ok) {
            chk.recoveryStatus = 'email_sent';
            chk.recoveryEmailSentAt = new Date().toISOString();
            cartRecoverySentCount++;
          }
        }
        checkoutsModified = true;
      }
    }
  }
  if (checkoutsModified) {
    saveCheckouts(checkouts);
  }

  saveDrips(dripsData);

  res.json({
    success: true,
    processedCount,
    convertedExitCount,
    completedCount,
    cartRecoverySentCount,
    programSent: programTick.sent,
    programFailed: programTick.failed,
    campaignSent: campaignTick.sent,
    activeRemaining: dripsData.enrollments.filter(e => e.status === 'active' && e.userId === req.user.uid).length + programTick.active
  });
});

// ── Wave 7: Multi-Channel Attribution Analytics API ───────────────────────────

app.get('/api/reports/attribution', requireUser, async (req, res) => {
  const model = req.query.model || 'last_touch'; // 'first_touch' | 'last_touch' | 'linear'
  const timeframe = req.query.timeframe || '30d'; // '7d' | '30d' | 'all'

  const uid = req.user.uid;
  const now = Date.now();
  const daysLimit = timeframe === '7d' ? 7 : (timeframe === '30d' ? 30 : 9999);
  const cutoff = now - (daysLimit * 86400000);
  const inWindow = (iso) => new Date(iso || 0).getTime() >= cutoff;
  const eventOwner = (e) => e.userId || (e.slug && publicPageCache[e.slug]?.userId) || '';
  const reportEvents = loadEvents().filter(e => eventOwner(e) === uid && inWindow(e.at));
  const filteredOrders = loadOrders().filter(o => {
    if (!inWindow(o.createdAt)) return false;
    const slugOwner = o.attributedSlug ? publicPageCache[o.attributedSlug]?.userId : '';
    return orderBelongsTo(o, uid, slugOwner);
  });
  const channels = {
    meta: {
      channelId: 'meta',
      channelName: 'Meta Ads (Facebook & IG)',
      iconName: 'meta',
      spend: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      revenue: 0,
      roas: 0,
      cac: 0,
      conversionRate: 0
    },
    google: {
      channelId: 'google',
      channelName: 'Google Ads & Search',
      iconName: 'google',
      spend: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      revenue: 0,
      roas: 0,
      cac: 0,
      conversionRate: 0
    },
    tiktok: {
      channelId: 'tiktok',
      channelName: 'TikTok Ads',
      iconName: 'tiktok',
      spend: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      revenue: 0,
      roas: 0,
      cac: 0,
      conversionRate: 0
    },
    email: {
      channelId: 'email',
      channelName: 'Email Nurture & Drips',
      iconName: 'email',
      spend: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      revenue: 0,
      roas: 0,
      cac: 0,
      conversionRate: 0
    },
    direct: {
      channelId: 'direct',
      channelName: 'Direct & Organic',
      iconName: 'direct',
      spend: 0,
      clicks: 0,
      leads: 0,
      orders: 0,
      revenue: 0,
      roas: 0,
      cac: 0,
      conversionRate: 0
    }
  };

  for (const journey of Object.values(journeyCache)) {
    if (journey.userId !== uid) continue;
    for (const node of journey.nodes || []) {
      if (node.type !== 'ad-source') continue;
      const platform = node.data?.platform;
      const key = platform === 'meta' || platform === 'google' || platform === 'tiktok' ? platform : 'direct';
      channels[key].spend += Number(node.data?.spend || 0);
    }
  }

  const leadEmails = new Set();
  for (const e of reportEvents) {
    const key = channelOf(e);
    if (e.type === 'page_view' || e.type === 'email_clicked') channels[key].clicks++;
    if (e.type === 'lead') {
      channels[key].leads++;
      if (e.email) leadEmails.add(String(e.email).toLowerCase());
    }
  }
  for (const c of loadContacts()) {
    const owner = c.userId || (c.sourceSlug && publicPageCache[c.sourceSlug]?.userId) || '';
    if (owner !== uid || !inWindow(c.firstSeenAt || c.subscribedAt)) continue;
    const email = String(c.email || '').toLowerCase();
    if (email && leadEmails.has(email)) continue;
    channels[channelOf(c)].leads++;
  }

  const recentAttributions = [];

  for (const o of filteredOrders) {
    const amount = Number(o.totalPrice || 0);
    const touches = attributionTouches(reportEvents, o);
    if (o.utm_source || o.fbclid || o.gclid || o.ttclid) touches.push(o);
    touches.sort((a, b) => Date.parse(a.at || a.createdAt || 0) - Date.parse(b.at || b.createdAt || 0));
    const labeled = touches.map(channelOf);
    const firstIdx = labeled.findIndex(c => c !== 'direct');
    let lastIdx = -1;
    labeled.forEach((c, i) => { if (c !== 'direct') lastIdx = i; });
    const firstTouch = firstIdx >= 0 ? labeled[firstIdx] : (o.checkoutChannel || 'direct');
    const lastTouch = lastIdx >= 0 ? labeled[lastIdx] : firstTouch;
    const distinct = new Set(labeled.filter(c => c !== 'direct'));

    if (model === 'first_touch') {
      channels[firstTouch].orders += 1;
      channels[firstTouch].revenue += amount;
    } else if (model === 'last_touch') {
      channels[lastTouch].orders += 1;
      channels[lastTouch].revenue += amount;
    } else if (firstTouch === lastTouch) {
      channels[lastTouch].orders += 1;
      channels[lastTouch].revenue += amount;
    } else {
      channels[firstTouch].orders += 0.5;
      channels[firstTouch].revenue += amount * 0.5;
      channels[lastTouch].orders += 0.5;
      channels[lastTouch].revenue += amount * 0.5;
    }

    recentAttributions.push({
      orderId: o.id,
      orderNumber: o.orderNumber || `#${String(o.id).slice(-4)}`,
      amount,
      customerEmail: o.customerEmail || '',
      channel: model === 'first_touch' ? channels[firstTouch].channelName : channels[lastTouch].channelName,
      touchpointCount: Math.max(1, distinct.size),
      linked: Boolean(o.visitorId),
      createdAt: o.createdAt
    });
  }

  let totalRevenue = 0;
  let totalSpend = 0;
  let totalOrders = 0;
  let totalLeads = 0;

  const channelList = Object.values(channels).map(ch => {
    ch.revenue = Number(ch.revenue.toFixed(2));
    ch.orders = Number(ch.orders.toFixed(1));
    ch.roas = ch.spend > 0 ? Number((ch.revenue / ch.spend).toFixed(2)) : 0;
    ch.cac = ch.orders > 0 ? Number((ch.spend / ch.orders).toFixed(2)) : 0;
    ch.conversionRate = ch.clicks > 0 ? Number(((ch.orders / ch.clicks) * 100).toFixed(2)) : 0;

    totalRevenue += ch.revenue;
    totalSpend += ch.spend;
    totalOrders += ch.orders;
    totalLeads += ch.leads;
    return ch;
  });

  const ordersByEmail = {};
  for (const o of filteredOrders) {
    const email = String(o.customerEmail || '').toLowerCase();
    if (!email) continue;
    ordersByEmail[email] = (ordersByEmail[email] || 0) + 1;
  }
  const buyerCount = Object.keys(ordersByEmail).length;
  const repeatCount = Object.values(ordersByEmail).filter(n => n >= 2).length;
  const repeatBuyerRate = buyerCount > 0 ? Number(((repeatCount / buyerCount) * 100).toFixed(1)) : 0;

  const summary = {
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalSpend: Number(totalSpend.toFixed(2)),
    blendedRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
    blendedCac: totalOrders > 0 ? Number((totalSpend / totalOrders).toFixed(2)) : 0,
    blendedAov: totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0,
    totalOrders: Math.round(totalOrders),
    totalLeads,
    repeatBuyerRate,
    netProfit: Number((totalRevenue - totalSpend).toFixed(2))
  };

  const viewCount = reportEvents.filter(e => e.type === 'page_view').length;
  const leadCount = Math.max(totalLeads, reportEvents.filter(e => e.type === 'lead').length);
  const checkoutCount = reportEvents.filter(e => e.type === 'checkout_start').length;
  const bumpCount = filteredOrders.filter(o => o.orderBumpIncluded).length;
  const share = (count, base) => base > 0 ? Number(((count / base) * 100).toFixed(1)) : 0;
  const drop = (count, prev) => prev > 0 ? Number((Math.max(0, prev - count) / prev * 100).toFixed(1)) : 0;
  const funnelSteps = [
    { id: 'views', name: 'Landing Page Views', count: viewCount, percentage: viewCount > 0 ? 100 : 0, dropoffRate: 0 },
    { id: 'leads', name: 'Leads Captured', count: leadCount, percentage: share(leadCount, viewCount), dropoffRate: drop(leadCount, viewCount) },
    { id: 'checkouts', name: 'Checkouts Started', count: checkoutCount, percentage: share(checkoutCount, viewCount), dropoffRate: drop(checkoutCount, leadCount) },
    { id: 'orders', name: 'Orders Placed', count: Math.round(totalOrders), percentage: share(totalOrders, viewCount), dropoffRate: drop(totalOrders, checkoutCount) },
    { id: 'bumps', name: 'Orders With a Bump', count: bumpCount, percentage: share(bumpCount, viewCount), dropoffRate: drop(bumpCount, totalOrders) }
  ];

  const countOrBlank = (type) => {
    const count = reportEvents.filter((event) => event.type === type).length;
    return count > 0 ? count : null;
  };
  res.json({
    success: true,
    report: {
      timeframe,
      model,
      summary,
      channels: channelList,
      funnelSteps,
      touchCounts: {
        pageViews: countOrBlank('page_view'),
        emailSends: countOrBlank('email_sent'),
        emailClicks: countOrBlank('email_clicked')
      },
      recentAttributions: recentAttributions.slice(0, 10)
    }
  });
});

app.get('/api/reports/attribution/export-csv', requireUser, async (req, res) => {
  const model = req.query.model || 'last_touch';
  const timeframe = req.query.timeframe || '30d';
  const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : null;
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const orders = loadOrders().filter(o => {
    if (cutoff && new Date(o.createdAt || 0).getTime() < cutoff) return false;
    const slugOwner = o.attributedSlug ? publicPageCache[o.attributedSlug]?.userId : '';
    return orderBelongsTo(o, req.user.uid, slugOwner);
  });
  const lines = ['Order,Email,Amount,Created,Discount,Slug,Visitor,Channel'];
  for (const o of orders) {
    lines.push([
      o.orderNumber || o.id,
      o.customerEmail || '',
      Number(o.totalPrice || 0).toFixed(2),
      o.createdAt || '',
      o.discountCode || '',
      o.attributedSlug || '',
      o.visitorId || '',
      o.checkoutChannel || channelOf(o)
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="jourvance-orders-${timeframe}-${model}.csv"`);
  res.send(lines.join('\n'));
});

app.get('/api/email/analytics', requireUser, async (req, res) => {
  const uid = req.user.uid;
  const stats = messageStatsFor(uid, () => true);
  const sent = stats.sent;
  const rate = (part) => (sent && part != null ? Number(((part / sent) * 100).toFixed(1)) : null);
  res.json({
    success: true,
    analytics: {
      totalSent: sent,
      sent,
      delivered: stats.delivered,
      opened: stats.opened,
      clicked: stats.clicked,
      unsubscribed: stats.unsubscribed,
      revenue: stats.revenue,
      prefetchOpens: stats.prefetchOpens,
      avgOpenRate: rate(stats.opened),
      avgClickRate: rate(stats.clicked),
      deliveryRate: rate(stats.delivered),
      activeSubscribers: contactsForUser(uid).length,
      windows: cleanAttributionWindows(userProgramBag(uid).attributionWindows),
      windowNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. A text click uses 5 days. These are the defaults. Changing them does not change an order already attributed.'
    }
  });
});

app.post('/api/email/attribution-windows', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.attributionWindows = cleanAttributionWindows(req.body || {});
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, windows: bag.attributionWindows, note: 'Orders already attributed keep the window stored on them.' });
});

app.get('/api/email/senders', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const data = await hub.email.senders?.list?.(req.user.uid);
      if (data?.senders) return res.json({ success: true, senders: data.senders, hubConnected: true });
    } catch (e) {
      return res.status(502).json({ success: false, error: e.message || 'Sender identities could not be loaded.', senders: [] });
    }
  }
  res.json({ success: true, senders: [], hubConnected: hubReady });
});

const signupFormsFilePath = path.join(__dirname, 'signup_forms.json');

function loadSignupStore() {
  try {
    if (!fs.existsSync(signupFormsFilePath)) return {};
    const data = JSON.parse(fs.readFileSync(signupFormsFilePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveSignupStore(store) {
  try {
    fs.writeFileSync(signupFormsFilePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving signup forms:', err.message);
  }
}

function cleanSignupForm(input, options = {}) {
  const cleaned = cleanForm(input, options);
  if (!cleaned || cleaned.error) return cleaned?.error ? cleaned : null;
  return cleaned.form;
}

function signupFormsFor(uid) {
  const rows = loadSignupStore()[uid];
  return (Array.isArray(rows) ? rows : []).map((row) => cleanSignupForm(row)).filter((row) => row && !row.error).slice(0, 20);
}

function writeSignupForms(uid, forms) {
  const store = loadSignupStore();
  store[uid] = (forms || []).map((row) => cleanSignupForm(row)).filter((row) => row && !row.error).slice(0, 20);
  saveSignupStore(store);
}

function signupSnippetForSlug(slug) {
  const page = publicPageCache[String(slug || "").toLowerCase()];
  if (!page?.userId) return "";
  const forms = signupFormsFor(page.userId).filter((form) => form.enabled).map(publicForm);
  return signupPageScript(forms, slug);
}

function presentSignupForm(uid, form) {
  const submissions = contactsForUser(uid).filter((contact) => (contact.tags || []).includes(`form:${form.id}`)).length;
  return {
    ...form,
    submissions,
    optInLabel: form.optIn === 'double'
      ? 'Double opt-in. The address is saved and is not marketable until they open the confirm link.'
      : 'Single opt-in. A submit can mark them as accepting marketing.'
  };
}

function chainGraph(prefix, steps) {
  const nodes = [{ id: `${prefix}_start`, type: 'trigger' }];
  const edges = [];
  let prev = nodes[0].id;
  (steps || []).forEach((step, index) => {
    const hours = Number(step.delayHours) || 0;
    if (hours > 0) {
      const waitId = `${prefix}_wait_${index}`;
      nodes.push({ id: waitId, type: 'delay', delayHours: hours });
      edges.push({ id: `${prev}__${waitId}`, source: prev, target: waitId, branch: '' });
      prev = waitId;
    }
    const emailId = `${prefix}_email_${index}`;
    const blocks = Array.isArray(step.blocks) && step.blocks.length
      ? step.blocks
      : [{ id: `${emailId}_b`, kind: 'text', text: step.body || '' }];
    nodes.push({ id: emailId, type: 'email', subject: step.subject || '', blocks });
    edges.push({ id: `${prev}__${emailId}`, source: prev, target: emailId, branch: '' });
    prev = emailId;
  });
  return { nodes, edges };
}

function rememberUntranslated(flow) {
  if (!flow) return flow;
  const names = untranslatedInDocument(flow);
  const notes = (flow.notes || []).filter((note) => !String(note).startsWith('Not translated:'));
  const kept = notes.slice(0, names.length ? 11 : 12);
  if (names.length) kept.push(`Not translated: ${names.join(', ')}`.slice(0, 240));
  flow.notes = kept;
  return flow;
}

function presentCustomFlow(flow, bag, uid) {
  const check = validateFlow(flow);
  return {
    id: flow.id,
    name: flow.name,
    kind: 'flow',
    editable: true,
    enabled: flow.enabled,
    trigger: flow.trigger,
    quietAfterDays: flow.quietAfterDays || null,
    reentry: flow.reentry || 'once',
    reentryDays: flow.reentryDays || 30,
    exitOnOrder: flow.exitOnOrder === true,
    dateField: flow.dateField || '',
    dateOffsetDays: flow.dateOffsetDays || 0,
    dateRepeat: flow.dateRepeat || 'once',
    lookbackDays: flow.lookbackDays || null,
    dropMode: flow.dropMode || '',
    dropValue: flow.dropValue ?? null,
    stockThreshold: flow.stockThreshold || null,
    stockMinimum: flow.stockMinimum || null,
    variantId: flow.variantId || '',
    klaviyoFlowId: flow.klaviyoFlowId || '',
    nodes: flow.nodes,
    edges: flow.edges,
    sunset: flow.sunset === true,
    enrolled: uid ? enrollmentCount(bag.flowEnrollments, flow.id) : null,
    note: (flow.notes || []).join(' '),
    stats: uid ? messageStatsFor(uid, (item) => item.flowId === flow.id) : null,
    active: (bag.flowEnrollments || []).filter((row) => row.flowId === flow.id && row.status === 'active').length,
    stepCount: countSendNodes(flow),
    compileError: check.ok ? '' : check.error
  };
}

async function proxyHub(res, run) {
  if (!hubReady) return res.status(503).json({ success: false, error: 'Email sending is not connected.' });
  try {
    const data = await run();
    if (!data || typeof data !== 'object') return res.json({ success: true });
    if (data.success === false) return res.status(data.status || 502).json({ success: false, error: data.error || 'The email service refused that.' });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.message || 'The email service did not answer.' });
  }
}

app.get('/api/email/forms', requireUser, async (req, res) => {
  const forms = signupFormsFor(req.user.uid).map((form) => presentSignupForm(req.user.uid, form));
  let hubForms = [];
  let hubError = '';
  if (hubReady) {
    try {
      const data = await hub.email.forms.list();
      hubForms = Array.isArray(data?.forms) ? data.forms : [];
    } catch (err) {
      hubError = err.message || 'Forms on the email service could not be loaded.';
    }
  }
  res.json({ success: true, forms, hubForms, hubError, hubConnected: hubReady });
});

app.post('/api/email/forms', requireUser, (req, res) => {
  const id = `form_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const form = cleanSignupForm({ ...req.body, id, enabled: false }, { creating: true });
  if (!form || form.error) return res.status(400).json({ success: false, error: form?.error || 'That form could not be saved.' });
  const forms = signupFormsFor(req.user.uid);
  forms.unshift(form);
  writeSignupForms(req.user.uid, forms);
  res.json({ success: true, form: presentSignupForm(req.user.uid, form) });
});

app.post('/api/email/forms/:id', requireUser, (req, res) => {
  const forms = signupFormsFor(req.user.uid);
  const index = forms.findIndex((form) => form.id === req.params.id);
  if (index < 0) return res.status(404).json({ success: false, error: 'That form is not on this account.' });
  const next = cleanSignupForm({ ...forms[index], ...req.body, id: forms[index].id });
  if (!next || next.error) return res.status(400).json({ success: false, error: next?.error || 'That form could not be saved.' });
  forms[index] = next;
  writeSignupForms(req.user.uid, forms);
  res.json({ success: true, form: presentSignupForm(req.user.uid, next) });
});

app.delete('/api/email/forms/:id', requireUser, (req, res) => {
  const forms = signupFormsFor(req.user.uid).filter((form) => form.id !== req.params.id);
  writeSignupForms(req.user.uid, forms);
  res.json({ success: true });
});

app.get('/api/email/pages', requireUser, (req, res) => {
  const pages = ownedPageSlugs(req.user.uid).map((slug) => {
    const page = publicPageCache[slug];
    return { slug, name: String(page?.data?.headline || slug).slice(0, 80) };
  });
  res.json({ success: true, pages });
});

app.get('/api/email/flow-map', requireUser, (req, res) => {
  const bag = ensureSignalStarters(req.user.uid);
  const drips = loadDrips();
  const sequences = (drips.sequences || []).filter((seq) => !seq.userId || seq.userId === req.user.uid).map((seq) => ({
    id: seq.id,
    name: seq.name,
    kind: 'sequence',
    editable: false,
    enabled: true,
    trigger: seq.triggerType || 'lead_capture',
    ...chainGraph(seq.id, seq.steps || []),
    note: 'Shared queue sequence. A new lead or checkout enrolls it. Build a flow on this account when this one should differ.'
  }));
  const automations = bag.automations.map((row) => ({
    id: row.id,
    name: row.name,
    kind: 'automation',
    editable: false,
    enabled: row.enabled,
    trigger: row.trigger,
    ...chainGraph(row.id, row.steps || []),
    note: 'Turn this on from Automations. The queue tick sends the next due step.'
  }));
  res.json({
    success: true,
    hubConnected: hubReady,
    timezone: bag.timezone || '',
    triggers: TRIGGER_META,
    flows: [...bag.flows.map((flow) => presentCustomFlow(flow, bag, req.user.uid)), ...automations, ...sequences]
  });
});

app.post('/api/email/flows', requireUser, (req, res) => {
  const id = `flow_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const flow = cleanFlow({
    id,
    name: req.body?.name || 'New flow',
    enabled: false,
    trigger: req.body?.trigger || 'manual',
    quietAfterDays: req.body?.quietAfterDays,
    nodes: [
      { id: 'n_start', type: 'trigger' },
      { id: 'n_mail', type: 'email', subject: 'A note from the store', blocks: [{ id: 'n_mail_b', kind: 'text', text: '' }] }
    ],
    edges: [{ id: 'e_start', source: 'n_start', target: 'n_mail', branch: '' }]
  });
  if (!flow) return res.status(400).json({ success: false, error: 'That flow could not be created.' });
  flow.enabled = false;
  const bag = userProgramBag(req.user.uid);
  bag.flows.unshift(flow);
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, flow: presentCustomFlow(flow, bag, req.user.uid) });
});

app.post('/api/email/flows/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const index = bag.flows.findIndex((flow) => flow.id === req.params.id);
  if (index < 0) return res.status(404).json({ success: false, error: 'That flow is not on this account.' });
  const shape = flowShapeError(req.body);
  if (shape) return res.status(400).json({ success: false, error: shape });
  const next = cleanFlow({ ...bag.flows[index], ...req.body, id: bag.flows[index].id });
  if (!next) return res.status(400).json({ success: false, error: 'That flow could not be saved.' });
  rememberUntranslated(next);
  const check = validateFlow(next);
  if (!check.ok) return res.status(400).json({ success: false, error: check.error });
  bag.flows[index] = next;
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true, flow: presentCustomFlow(next, bag, req.user.uid) });
});

app.delete('/api/email/flows/:id', requireUser, (req, res) => {
  const bag = userProgramBag(req.user.uid);
  bag.flows = bag.flows.filter((flow) => flow.id !== req.params.id);
  for (const row of bag.flowEnrollments) {
    if (row.flowId === req.params.id && row.status === 'active') row.status = 'stopped';
  }
  writeUserPrograms(req.user.uid, bag);
  res.json({ success: true });
});

app.post('/api/email/flows/:id/enroll', requireUser, async (req, res) => {
  const bag = userProgramBag(req.user.uid);
  const flow = bag.flows.find((row) => row.id === req.params.id);
  if (!flow) return res.status(404).json({ success: false, error: 'That flow is not on this account.' });
  if (flow.sunset) return res.status(400).json({ success: false, error: 'This flow sends nothing. Set the quiet period, then use the suppress button for people already marked unengaged.' });
  if (!flow.enabled) return res.status(400).json({ success: false, error: 'Turn the flow on before enrolling someone.' });
  if (flow.trigger !== 'manual') return res.status(400).json({ success: false, error: 'This flow enrolls from its trigger.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ success: false, error: 'A valid email is required.' });
  const result = await enrollFlowsForTrigger(req.user.uid, 'manual', {
    email,
    name: String(req.body?.name || ''),
    phone: String(req.body?.phone || '')
  }, { first_name: String(req.body?.name || '').trim().split(/\s+/)[0] || 'there' }, { reason: 'lead', dedupe: `manual:${Date.now()}` });
  if (!result.added && result.errors.length) {
    return res.status(502).json({ success: false, error: result.errors[0], enrolled: false, viaKlaviyo: true });
  }
  if (!result.added && result.skipped === 'filter') {
    return res.status(400).json({ success: false, error: 'They do not match this flow’s filter.', enrolled: false });
  }
  res.json({ success: true, enrolled: result.added > 0, viaKlaviyo: klaviyoIsSender(req.user.uid) });
});

app.post('/api/email/lint', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.lint({ subject: String(req.body?.subject || ''), html: String(req.body?.html || '') }));
});

app.get('/api/email/live', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.live.list());
});

app.post('/api/email/live', requireUser, async (req, res) => {
  const body = req.body || {};
  await proxyHub(res, () => hub.email.live.create({
    name: body.name, kind: body.kind, deadline: body.deadline,
    beforeUrl: body.beforeUrl, afterUrl: body.afterUrl,
    stockUrl: body.stockUrl, stockPath: body.stockPath, stockThreshold: body.stockThreshold
  }));
});

app.delete('/api/email/live/:id', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.live.remove(req.params.id));
});

app.post('/api/email/senders', requireUser, async (req, res) => {
  const body = req.body || {};
  await proxyHub(res, () => hub.email.senders.create({
    type: body.type === 'single_sender' ? 'single_sender' : 'domain',
    accountId: req.user.uid,
    domain: body.domain,
    fromEmail: body.fromEmail,
    fromName: body.fromName,
    replyTo: body.replyTo,
    physicalAddress: body.physicalAddress
  }));
});

app.post('/api/email/senders/:id/verify', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.senders.verify(req.params.id));
});

app.get('/api/email/senders/:id/auth', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.senders.auth(req.params.id));
});

app.delete('/api/email/senders/:id', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.senders.remove(req.params.id));
});

app.post('/api/email/domain-connect', requireUser, async (req, res) => {
  const body = req.body || {};
  await proxyHub(res, () => hub.email.connectDomain({ domain: body.domain, fromEmail: body.fromEmail, accountId: req.user.uid }));
});

app.get('/api/email/inbound', requireUser, async (req, res) => {
  await proxyHub(res, async () => {
    const status = await hub.email.inboundParse.status();
    const hostname = status?.hostname || status?.settings?.[0]?.hostname || '';
    return { ...status, accountAddress: hostname ? `acct-${req.user.uid}@${hostname}` : '' };
  });
});

app.post('/api/email/inbound', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.inboundParse.setup(String(req.body?.hostname || '')));
});

app.get('/api/email/events-webhook', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.webhook.status());
});

app.post('/api/email/events-webhook', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.webhook.setup({}));
});

app.get('/api/email/inbox', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.inbox.list({ accountId: req.user.uid, status: String(req.query.status || '') }));
});

app.get('/api/email/inbox/policy', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.inbox.policy(req.user.uid));
});

app.post('/api/email/inbox/policy', requireUser, async (req, res) => {
  const autopilot = ['off', 'draft', 'auto'].includes(req.body?.autopilot) ? req.body.autopilot : 'off';
  await proxyHub(res, () => hub.email.inbox.setPolicy({ accountId: req.user.uid, autopilot }));
});

app.post('/api/email/inbox/:id/draft', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.inbox.draft(req.params.id, { accountId: req.user.uid, direction: req.body?.direction }));
});

app.post('/api/email/inbox/:id/reply', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.inbox.reply(req.params.id, {
    accountId: req.user.uid,
    text: req.body?.text,
    useDraft: req.body?.useDraft === true
  }));
});

app.post('/api/email/inbox/:id/status', requireUser, async (req, res) => {
  const status = ['archived', 'ignored', 'new'].includes(req.body?.status) ? req.body.status : 'archived';
  await proxyHub(res, () => hub.email.inbox.setStatus(req.params.id, { accountId: req.user.uid, status }));
});

app.get('/api/sms/status', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.sms.status());
});

app.get('/api/sms/audience', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.sms.audience());
});

app.get('/api/sms/history', requireUser, async (req, res) => {
  await proxyHub(res, () => hub.email.sms.history());
});

app.post('/api/sms/consent', requireUser, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  if (!email.includes('@') || !phone) return res.status(400).json({ success: false, error: 'An email and a phone number are required.' });
  const consent = req.body?.consent === 'opted_out' ? 'opted_out' : 'opted_in';
  await proxyHub(res, () => hub.email.sms.consent({ email, phone, consent, name: req.body?.name || '' }));
});

app.post('/api/sms/preview', requireUser, async (req, res) => {
  const draft = smsDraft({ message: String(req.body?.message || ''), storeName: await storeNameFor(req.user.uid) });
  const plan = smsCouponPlan(draft.text);
  const until = quietOpenAt(Date.now(), userProgramBag(req.user.uid).timezone);
  res.json({
    success: true,
    ...draft,
    text: plan.first ? applySmsCoupon(draft.text, 'Code') : draft.text,
    quietUntil: until ? new Date(until).toISOString() : null,
    channel: 'sms',
    media: false
  });
});

app.post('/api/email/feed-preview', requireUser, async (req, res) => {
  const shop = await shopForCoupons(req.user.uid);
  if (!shop) return res.json({ success: true, products: [], notice: 'Connect a Shopify store to preview this feed.' });
  const ctx = feedContextFor(req.user.uid, { email: req.body?.email || '' }, req.body?.event || {});
  const feed = req.body?.feed || {};
  const result = selectFeed({ ...ctx, ...feed, source: feed.source, fallback: feed.fallback, now: Date.now() });
  res.json({
    success: true,
    products: result.products,
    label: result.label,
    usedFallback: result.usedFallback,
    notice: result.unavailable || (result.products.length ? '' : 'No products matched this feed.')
  });
});

app.post('/api/email/flows/:id/suppress', requireUser, (req, res) => {
  if (req.params.id !== 'flow_sunset') return res.status(404).json({ success: false, error: 'That flow has no suppress button.' });
  const bag = userProgramBag(req.user.uid);
  const contacts = contactsForUser(req.user.uid).map((contact) => {
    const email = String(contact.email || '').toLowerCase();
    return { email, properties: { ...(bag.profiles?.[email]?.properties || {}), ...(contact.properties || {}) } };
  });
  const emails = unengagedEmails(contacts);
  for (const email of emails) bag.suppressions = noteSuppression(bag.suppressions, email, 'sunset');
  if (emails.length) writeUserPrograms(req.user.uid, bag);
  const message = emails.length
    ? `Suppressed ${emails.length} ${emails.length === 1 ? 'person' : 'people'} marked unengaged. Nothing was sent.`
    : 'Nobody marked unengaged is on this account, so nobody was suppressed.';
  res.json({ success: true, suppressed: emails.length, message });
});

app.get('/r/:code', (req, res) => {
  const code = String(req.params.code || '');
  const rows = loadRedirects();
  const row = rows.find((item) => item.code === code);
  const status = redirectStatus(row, Date.now());
  if (status === 'missing') return res.status(404).type('text/plain').send('This link was not found.');
  if (status === 'expired') return res.status(410).type('text/plain').send('This link has expired.');
  recordEvent({
    type: row.channel === 'sms' ? 'sms_clicked' : 'email_clicked',
    userId: row.uid || '',
    email: row.email || '',
    messageId: row.messageId || '',
    campaignId: row.campaignId || '',
    flowId: row.flowId || '',
    nodeId: row.nodeId || '',
    sequenceId: row.sequenceId || ''
  });
  row.clicks = Number(row.clicks || 0) + 1;
  saveRedirects(rows);
  res.redirect(302, applyLinkUtm(row.url, row.utm));
});

app.post('/api/sms/send', requireUser, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ success: false, error: 'A message is required.' });
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients.slice(0, 50) : [];
  if (!recipients.length && req.body?.confirm !== 'opted-in') {
    return res.status(400).json({ success: false, error: 'Name the phone numbers, or confirm the send is only to numbers that already opted in.' });
  }
  const until = quietOpenAt(Date.now(), userProgramBag(req.user.uid).timezone);
  if (until && until > Date.now() + 999) {
    return res.status(409).json({ success: false, error: `Quiet hours run until ${new Date(until).toISOString()} in the account timezone. Nothing was sent.` });
  }
  const prepared = await prepareSmsMessage(req.user.uid, message, { email: recipients[0]?.email || '', utm: { utm_source: 'sms', utm_medium: 'broadcast' } });
  await proxyHub(res, async () => {
    const sent = await hub.email.sms.send(recipients.length ? { message: prepared.text, recipients } : { message: prepared.text });
    const blast = sent?.blast;
    if (blast && (blast.sent || 0) === 0 && (blast.sandbox || 0) > 0) {
      return { success: false, status: 502, error: 'The text service is in sandbox, so nothing was delivered.', blast };
    }
    return sent;
  });
});

// ── Klaviyo import and sync ──────────────────────────────────────────────────
// The private key stays on the server. Pull copies profiles, list names, and flow
// steps Klaviyo actually returned. Push creates or updates a Klaviyo profile and
// does not subscribe the person or change a Klaviyo flow.

const klaviyoFilePath = path.join(__dirname, 'klaviyo.json');

function loadKlaviyoStore() {
  try {
    if (!fs.existsSync(klaviyoFilePath)) return {};
    const data = JSON.parse(fs.readFileSync(klaviyoFilePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function saveKlaviyoStore(store) {
  try {
    fs.writeFileSync(klaviyoFilePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed saving Klaviyo connections:', err.message);
  }
}

function klaviyoRow(uid) {
  const row = loadKlaviyoStore()[uid];
  return row && typeof row === 'object' ? row : null;
}

function presentKlaviyo(row) {
  if (!row?.apiKey) return { connected: false, keyOnFile: false, sendWith: 'jourvance', flows: [] };
  return {
    connected: true,
    keyOnFile: true,
    accountName: row.accountName || '',
    accountId: row.accountId || '',
    connectedAt: row.connectedAt || '',
    lastSyncAt: row.lastSyncAt || '',
    lastError: row.lastError || '',
    catalogError: row.catalogError || '',
    sendWith: row.sendWith === 'klaviyo' ? 'klaviyo' : 'jourvance',
    moreProfiles: Boolean(row.profileNext),
    lists: Array.isArray(row.lists) ? row.lists : [],
    flows: (Array.isArray(row.flows) ? row.flows : []).map(presentFlowEntry),
    lastHandoffs: Array.isArray(row.lastHandoffs) ? row.lastHandoffs.slice(0, 20) : [],
    lastResult: row.lastResult || null
  };
}

function writeKlaviyoRow(uid, row) {
  const store = loadKlaviyoStore();
  store[uid] = row;
  saveKlaviyoStore(store);
}

function addContactTag(contact, tag) {
  const clean = String(tag || '').slice(0, 80);
  if (!clean) return;
  if (!Array.isArray(contact.tags)) contact.tags = [];
  if (!contact.tags.includes(clean)) contact.tags.push(clean);
}

function upsertKlaviyoContact(contacts, uid, incoming, listTag) {
  const email = incoming.email;
  let contact = contacts.find((row) => String(row.email || '').toLowerCase() === email);
  if (contact) {
    const owner = contactOwnerId(contact);
    if (owner && owner !== uid) return 'other-account';
    if (incoming.name) contact.name = incoming.name;
    if (incoming.phone) contact.phone = incoming.phone;
    contact.userId = uid;
    contact.klaviyoProfileId = incoming.klaviyoProfileId || contact.klaviyoProfileId || '';
    contact.klaviyoConsent = incoming.klaviyoConsent;
    contact.acceptsMarketing = incoming.acceptsMarketing;
    contact.klaviyoDirty = false;
    addContactTag(contact, 'Klaviyo');
    if (listTag) addContactTag(contact, listTag);
    return 'updated';
  }
  contact = {
    id: `klaviyo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    email,
    name: incoming.name || '',
    phone: incoming.phone || '',
    userId: uid,
    source: 'Klaviyo',
    tags: ['Klaviyo', ...(listTag ? [listTag] : [])],
    acceptsMarketing: incoming.acceptsMarketing,
    klaviyoProfileId: incoming.klaviyoProfileId || '',
    klaviyoConsent: incoming.klaviyoConsent,
    klaviyoDirty: false,
    subscribedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString()
  };
  contacts.push(contact);
  return 'imported';
}

async function pullKlaviyoProfiles(apiKey, startPath) {
  let path = startPath;
  let pages = 0;
  const people = [];
  while (path && pages < 15) {
    const payload = await klaviyoSend(apiKey, 'GET', path);
    for (const profile of payload?.data || []) {
      const contact = contactFromProfile(profile);
      if (contact) people.push(contact);
    }
    path = nextPath(payload);
    pages += 1;
  }
  return { people, next: path || '' };
}

async function pullKlaviyoLists(apiKey) {
  const payload = await klaviyoSend(apiKey, 'GET', '/api/lists/?fields[list]=name&page[size]=20');
  return (payload?.data || []).slice(0, 20).map((list) => ({
    id: String(list.id || ''),
    name: String(list?.attributes?.name || 'List').slice(0, 80)
  })).filter((list) => list.id);
}

async function pullListEmails(apiKey, listId) {
  const emails = [];
  let path = `/api/lists/${encodeURIComponent(listId)}/profiles/?fields[profile]=email&page[size]=100`;
  for (let page = 0; path && page < 3; page++) {
    const payload = await klaviyoSend(apiKey, 'GET', path);
    for (const profile of payload?.data || []) {
      const email = String(profile?.attributes?.email || '').trim().toLowerCase();
      if (email.includes('@')) emails.push(email);
    }
    path = nextPath(payload);
  }
  return emails;
}

async function importKlaviyoFlows(uid, apiKey, catalogRows) {
  const rows = Array.isArray(catalogRows) ? catalogRows : (await readFlowCatalog(apiKey)).rows;
  const predictionReady = storeReadiness(accountOrders(uid));
  const bag = userProgramBag(uid);
  const notes = [];
  let imported = 0;
  let leftOn = 0;
  let templatesCopied = 0;
  const templates = new Map();
  async function templateHtml(id) {
    if (!id) return '';
    if (templates.has(id)) return templates.get(id);
    try {
      const payload = await klaviyoSend(apiKey, 'GET', `/api/templates/${encodeURIComponent(id)}/`);
      const html = sanitizeMailHtml(payload?.data?.attributes?.html || '');
      templates.set(id, html);
      return html;
    } catch {
      templates.set(id, '');
      return '';
    }
  }
  for (const row of rows.slice(0, FLOW_LIMIT)) {
    const label = row.entry?.name || 'Flow';
    if (!row.detail) {
      notes.push(`${label}: steps were not readable${row.error ? ` (${row.error})` : ''}.`);
      continue;
    }
    const mapped = flowFromKlaviyo(row.detail, {
      metricName: row.entry?.metricName || '',
      metricNames: row.metricNames || {},
      prediction: { ready: predictionReady.ready, missing: predictionReady.ready ? '' : missingHistory(predictionReady) }
    });
    if (!mapped.ok) {
      notes.push(mapped.reason);
      continue;
    }
    for (const node of mapped.flow.nodes) {
      if (node.type !== 'email' || !node.templateId) continue;
      const html = await templateHtml(node.templateId);
      if (!html) continue;
      node.blocks = [{ id: `${node.id}_html`, kind: 'html', text: html }];
      templatesCopied += 1;
    }
    const detailId = String(row.detail.id || mapped.flow.klaviyoFlowId || '');
    const flowId = `flow_k${detailId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const existing = bag.flows.find((flow) => flow.klaviyoFlowId === mapped.flow.klaviyoFlowId || flow.id === flowId);
    if (existing?.enabled) {
      leftOn += 1;
      notes.push(`${label}: left as it is because that flow is turned on here.`);
      continue;
    }
    const next = cleanFlow({
      id: existing?.id || flowId,
      name: mapped.flow.name,
      enabled: false,
      trigger: mapped.flow.trigger,
      reentry: mapped.flow.reentry || 'once',
      dateField: mapped.flow.dateField,
      dateOffsetDays: mapped.flow.dateOffsetDays,
      dateRepeat: mapped.flow.dateRepeat,
      notes: mapped.flow.notes,
      nodes: mapped.flow.nodes,
      edges: mapped.flow.edges,
      klaviyoFlowId: mapped.flow.klaviyoFlowId
    });
    if (!next) {
      notes.push(`${label}: the copied steps could not be saved.`);
      continue;
    }
    rememberUntranslated(next);
    const check = validateFlow(next);
    if (!check.ok) {
      notes.push(`${label}: ${check.error}`);
      continue;
    }
    if (existing) Object.assign(existing, next, { enabled: false });
    else bag.flows.unshift(next);
    imported += 1;
    if (mapped.note) notes.push(`${label}: ${mapped.note}`);
  }
  if (imported) writeUserPrograms(uid, bag);
  return { seen: rows.length, imported, leftOn, templatesCopied, notes: notes.slice(0, 16) };
}

async function pushKlaviyoContact(uid, contact) {
  const row = klaviyoRow(uid);
  if (!row?.apiKey || !contact?.email || !String(contact.email).includes('@')) return { pushed: false };
  const parts = String(contact.name || '').trim().split(/\s+/).filter(Boolean);
  const attributes = { email: String(contact.email).toLowerCase() };
  if (parts[0]) attributes.first_name = parts[0].slice(0, 80);
  if (parts.length > 1) attributes.last_name = parts.slice(1).join(' ').slice(0, 80);
  const phone = e164(contact.phone);
  if (phone) attributes.phone_number = phone;
  let payload;
  try {
    payload = await klaviyoSend(row.apiKey, 'POST', '/api/profile-import/', { data: { type: 'profile', attributes } });
  } catch (err) {
    if (!phone || err.status !== 400) throw err;
    delete attributes.phone_number;
    payload = await klaviyoSend(row.apiKey, 'POST', '/api/profile-import/', { data: { type: 'profile', attributes } });
  }
  const profileId = String(payload?.data?.id || '');
  const contacts = loadContacts();
  const saved = contacts.find((item) => String(item.email || '').toLowerCase() === attributes.email && contactOwnerId(item) === uid);
  if (saved) {
    saved.klaviyoProfileId = profileId || saved.klaviyoProfileId || '';
    saved.klaviyoPushedAt = new Date().toISOString();
    saved.klaviyoDirty = false;
    addContactTag(saved, 'Klaviyo');
    saveContacts(contacts);
  }
  return { pushed: true, id: profileId };
}

function klaviyoIsSender(uid) {
  return klaviyoRow(uid)?.sendWith === 'klaviyo';
}

function nameFlowLists(entries, lists) {
  for (const entry of entries) {
    if (!entry?.listId) continue;
    entry.listName = (lists || []).find((list) => list.id === entry.listId)?.name || entry.listName || '';
  }
  return entries;
}

function presentFlowEntry(entry) {
  const status = String(entry?.status || '');
  const triggerKind = entry?.triggerKind === 'list' || entry?.triggerKind === 'metric' ? entry.triggerKind : 'other';
  const canEnter = status === 'live' && ((triggerKind === 'list' && entry.listId) || (triggerKind === 'metric' && entry.metricName));
  let handoff = 'Jourvance cannot place someone in this flow. It does not start from a list or an event.';
  if (status !== 'live') handoff = `This flow is ${status || 'not live'} in Klaviyo. A handoff will not add anyone until it is live.`;
  else if (triggerKind === 'list') {
    handoff = entry.listName
      ? `Adds the person to the list “${entry.listName}”. This does not subscribe them.`
      : 'Adds the person to the list that starts this flow. This does not subscribe them.';
  } else if (triggerKind === 'metric' && entry.metricName) {
    handoff = `Sends the Klaviyo event “${entry.metricName}”. This does not subscribe them.`;
  }
  return {
    id: entry.id,
    name: entry.name || 'Flow',
    status,
    triggerKind,
    listName: entry.listName || '',
    metricName: entry.metricName || '',
    canEnter,
    handoff
  };
}

function rememberHandoff(uid, contact, info) {
  const row = klaviyoRow(uid);
  if (!row) return;
  const item = {
    at: new Date().toISOString(),
    email: String(contact?.email || '').slice(0, 120),
    flowId: info.flowId || '',
    flowName: info.flowName || '',
    status: info.status || '',
    detail: String(info.detail || info.error || '').slice(0, 240),
    entered: Boolean(info.entered)
  };
  row.lastHandoffs = [item, ...(Array.isArray(row.lastHandoffs) ? row.lastHandoffs : [])].slice(0, 20);
  writeKlaviyoRow(uid, row);
  if (!info.entered) return;
  recordEvent({
    type: 'klaviyo_handoff',
    userId: uid,
    email: item.email,
    visitorId: contact?.visitorId || '',
    journeyId: info.journeyId || '',
    nodeId: info.nodeId || '',
    slug: info.slug || '',
    entered: true
  });
}

async function enterKlaviyoFlow(uid, klaviyoFlowId, contact, context = {}) {
  const flowId = String(klaviyoFlowId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const fail = (status, error) => {
    rememberHandoff(uid, contact, { status, error, flowId, entered: false, journeyId: context.journeyId, nodeId: context.nodeId, slug: context.slug });
    return { entered: false, status, error };
  };
  const row = klaviyoRow(uid);
  if (!row?.apiKey) return fail('not_connected', 'Klaviyo is not connected, so nobody was added.');
  if (row.sendWith !== 'klaviyo') return { entered: false, status: 'jourvance_sends' };
  const catalog = (row.flows || []).find((flow) => flow.id === flowId);
  if (!catalog) return fail('unknown_flow', 'That flow is not on the last Klaviyo sync.');
  if (catalog.status !== 'live') return fail('not_live', `“${catalog.name}” is ${catalog.status || 'not live'} in Klaviyo, so nobody was added.`);
  if (contact?.klaviyoConsent === 'suppressed') return fail('suppressed', 'This person is suppressed in Klaviyo, so they were not added.');
  const email = String(contact?.email || '').trim().toLowerCase();
  if (!email.includes('@')) return fail('no_address', 'There is no email to add.');
  let profileId = String(contact.klaviyoProfileId || '');
  try {
    const pushed = await pushKlaviyoContact(uid, { ...contact, email });
    profileId = pushed.id || profileId;
  } catch (err) {
    return fail('profile', err.message || 'Klaviyo did not accept the profile.');
  }
  const saved = loadContacts().find((item) => String(item.email || '').toLowerCase() === email && contactOwnerId(item) === uid);
  if (saved?.klaviyoConsent === 'suppressed') return fail('suppressed', 'This person is suppressed in Klaviyo, so they were not added.');
  try {
    if (catalog.triggerKind === 'list') {
      if (!catalog.listId || !profileId) return fail('no_list', 'Klaviyo did not name the list that starts this flow.');
      await klaviyoSend(row.apiKey, 'POST', `/api/lists/${encodeURIComponent(catalog.listId)}/relationships/profiles/`, {
        data: [{ type: 'profile', id: profileId }]
      });
      const detail = catalog.listName
        ? `Added to the list “${catalog.listName}”. They were not subscribed.`
        : 'Added to the list that starts this flow. They were not subscribed.';
      rememberHandoff(uid, contact, { status: 'added_to_list', detail, flowId, flowName: catalog.name, entered: true, journeyId: context.journeyId, nodeId: context.nodeId, slug: context.slug });
      return { entered: true, status: 'added_to_list', flowName: catalog.name, detail };
    }
    if (catalog.triggerKind === 'metric') {
      if (!catalog.metricName) return fail('no_metric', 'Klaviyo did not name the event that starts this flow.');
      if (!metricHandoffAllowed(catalog.metricName, context.reason || 'lead')) {
        return fail('metric_mismatch', `“${catalog.name}” starts when Klaviyo records “${catalog.metricName}”. This visit was not that event, so nothing was sent.`);
      }
      const properties = { source: 'jourvance' };
      if (context.slug) properties.page = String(context.slug).slice(0, 120);
      if (context.reason === 'checkout' && context.checkoutUrl) properties.checkout_url = String(context.checkoutUrl).slice(0, 500);
      if (context.reason === 'order' && context.orderId) {
        properties.order_id = String(context.orderId).slice(0, 80);
        const value = Number(context.value);
        if (Number.isFinite(value)) properties.$value = value;
      }
      await klaviyoSend(row.apiKey, 'POST', '/api/events/', {
        data: {
          type: 'event',
          attributes: {
            properties,
            time: new Date().toISOString(),
            unique_id: `jv:${flowId}:${email}:${context.dedupe || context.reason || 'enter'}`.slice(0, 255),
            metric: { data: { type: 'metric', attributes: { name: catalog.metricName } } },
            profile: { data: { type: 'profile', attributes: { email } } }
          }
        }
      });
      const detail = `Sent the event “${catalog.metricName}”. They were not subscribed.`;
      rememberHandoff(uid, contact, { status: 'event_sent', detail, flowId, flowName: catalog.name, entered: true, journeyId: context.journeyId, nodeId: context.nodeId, slug: context.slug });
      return { entered: true, status: 'event_sent', flowName: catalog.name, detail };
    }
    return fail('unsupported', `“${catalog.name}” does not start from a list or an event, so nobody was added.`);
  } catch (err) {
    return fail('rejected', err.message || 'Klaviyo refused the handoff.');
  }
}

async function handoffMapNodes(uid, when, contact, context) {
  if (!klaviyoIsSender(uid) || !context?.journeyId) return [];
  const journey = await loadJourney(uid, context.journeyId);
  if (!journey || journey.userId !== uid) return [];
  const row = klaviyoRow(uid);
  const explicit = new Map();
  for (const link of row?.nodeLinks || []) {
    if (link.journeyId === journey.id) explicit.set(link.nodeId, link);
  }
  const chosen = [];
  const seen = new Set();
  const add = (nodeId, flowId) => {
    const id = String(flowId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
    if (!nodeId || !id || seen.has(nodeId)) return;
    seen.add(nodeId);
    chosen.push({ nodeId, klaviyoFlowId: id });
  };
  for (const [nodeId, link] of explicit) {
    if ((link.when || 'lead_capture') === when) add(nodeId, link.klaviyoFlowId);
  }
  for (const node of journey.nodes || []) {
    if (node?.type !== 'follow-up-sequence' || explicit.has(node.id)) continue;
    const data = node.data || {};
    if ((data.klaviyoWhen || 'lead_capture') === when) add(node.id, data.klaviyoFlowId);
  }
  const results = [];
  for (const link of chosen) {
    results.push(await enterKlaviyoFlow(uid, link.klaviyoFlowId, contact, { ...context, nodeId: link.nodeId, journeyId: journey.id }));
  }
  return results;
}

async function syncKlaviyo(uid) {
  const row = klaviyoRow(uid);
  if (!row?.apiKey) {
    const error = new Error('Connect a Klaviyo private key first.');
    error.status = 400;
    throw error;
  }
  const result = {
    profilesRead: 0,
    imported: 0,
    updated: 0,
    skippedOtherAccount: 0,
    suppressed: 0,
    lists: 0,
    listTags: 0,
    flowsSeen: 0,
    flowsImported: 0,
    flowsLeftOn: 0,
    templatesCopied: 0,
    pushed: 0,
    pushFailed: 0,
    moreProfiles: false,
    notes: []
  };
  const start = row.profileNext
    || (row.lastSyncAt
      ? `/api/profiles/?page[size]=100&additional-fields[profile]=subscriptions&filter=${encodeURIComponent(`greater-than(updated,${row.lastSyncAt})`)}`
      : '/api/profiles/?page[size]=100&additional-fields[profile]=subscriptions');
  let pulled;
  try {
    pulled = await pullKlaviyoProfiles(row.apiKey, start);
  } catch (err) {
    if (!row.profileNext && row.lastSyncAt && /filter|updated/i.test(err.message)) {
      pulled = await pullKlaviyoProfiles(row.apiKey, '/api/profiles/?page[size]=100&additional-fields[profile]=subscriptions');
      result.notes.push('Klaviyo rejected the updated-since filter, so this pass read from the start of the list.');
    } else throw err;
  }
  result.profilesRead = pulled.people.length;
  result.moreProfiles = Boolean(pulled.next);
  result.suppressed = pulled.people.filter((person) => person.klaviyoConsent === 'suppressed').length;
  const contacts = loadContacts();
  for (const person of pulled.people) {
    const outcome = upsertKlaviyoContact(contacts, uid, person);
    if (outcome === 'imported') result.imported += 1;
    else if (outcome === 'updated') result.updated += 1;
    else result.skippedOtherAccount += 1;
  }
  try {
    const lists = await pullKlaviyoLists(row.apiKey);
    result.lists = lists.length;
    row.lists = lists;
    for (const list of lists) {
      const tag = `Klaviyo: ${list.name}`.slice(0, 80);
      const emails = await pullListEmails(row.apiKey, list.id);
      for (const email of emails) {
        const contact = contacts.find((item) => String(item.email || '').toLowerCase() === email && (!contactOwnerId(item) || contactOwnerId(item) === uid));
        if (!contact || (contactOwnerId(contact) && contactOwnerId(contact) !== uid)) continue;
        if (!contact.userId) contact.userId = uid;
        const before = (contact.tags || []).length;
        addContactTag(contact, 'Klaviyo');
        addContactTag(contact, tag);
        if ((contact.tags || []).length > before) result.listTags += 1;
      }
    }
  } catch (err) {
    result.notes.push(`Lists were not read (${err.message}).`);
  }
  saveContacts(contacts);
  try {
    const catalog = await readFlowCatalog(row.apiKey);
    const catalogRows = catalog.rows || [];
    row.flows = nameFlowLists(catalogRows.map((item) => item.entry).filter((entry) => entry.id), row.lists || []);
    row.catalogError = '';
    const flows = await importKlaviyoFlows(uid, row.apiKey, catalogRows);
    if (catalog.moreFlows) result.notes.push('Klaviyo has more than 40 flows. The first 40 were rebuilt into this account.');
    result.flowsSeen = flows.seen;
    result.flowsImported = flows.imported;
    result.flowsLeftOn = flows.leftOn;
    result.templatesCopied = flows.templatesCopied;
    result.notes.push(...flows.notes);
  } catch (err) {
    row.catalogError = err.message || 'Flows could not be listed.';
    result.notes.push(`Flows were not read (${err.message}).`);
  }
  const mine = contactsForUser(uid).filter((contact) => {
    if (contact.klaviyoConsent === 'suppressed') return false;
    if (contact.klaviyoDirty) return true;
    return !contact.klaviyoProfileId && contact.acceptsMarketing === true;
  });
  for (const contact of mine.slice(0, 40)) {
    if (contact.klaviyoConsent === 'suppressed') continue;
    try {
      const pushed = await pushKlaviyoContact(uid, contact);
      if (pushed.pushed) result.pushed += 1;
    } catch (err) {
      result.pushFailed += 1;
      if (result.notes.length < 14) result.notes.push(`Push failed for one profile (${err.message}).`);
    }
  }
  if (mine.length > 40) result.notes.push(`${mine.length - 40} local profiles are still waiting for the next sync.`);
  row.profileNext = pulled.next || '';
  row.lastSyncAt = new Date().toISOString();
  row.lastError = '';
  row.lastResult = result;
  writeKlaviyoRow(uid, row);
  return result;
}

app.get('/api/klaviyo', requireUser, (req, res) => {
  res.json({ success: true, klaviyo: presentKlaviyo(klaviyoRow(req.user.uid)) });
});

app.post('/api/klaviyo/connect', requireUser, async (req, res) => {
  const current = klaviyoRow(req.user.uid);
  const typed = String(req.body?.apiKey || '').trim();
  const apiKey = typed || current?.apiKey || '';
  if (!apiKey) return res.status(400).json({ success: false, error: 'Paste a Klaviyo private API key.' });
  try {
    const account = accountFrom(await klaviyoSend(apiKey, 'GET', '/api/accounts/'));
    let flows = current?.flows || [];
    let lists = current?.lists || [];
    let catalogError = '';
    try {
      const catalog = await readFlowCatalog(apiKey, { limit: 20 });
      lists = await pullKlaviyoLists(apiKey);
      flows = nameFlowLists((catalog.rows || []).map((item) => item.entry).filter((entry) => entry.id), lists);
    } catch (err) {
      catalogError = err.message || 'Flows could not be listed.';
    }
    writeKlaviyoRow(req.user.uid, {
      ...(current || {}),
      apiKey,
      accountName: account.accountName,
      accountId: account.accountId,
      connectedAt: current?.connectedAt || new Date().toISOString(),
      sendWith: current?.sendWith === 'klaviyo' ? 'klaviyo' : 'jourvance',
      flows,
      lists,
      catalogError,
      lastError: ''
    });
    res.json({ success: true, klaviyo: presentKlaviyo(klaviyoRow(req.user.uid)) });
  } catch (err) {
    res.status(err.status || 502).json({ success: false, error: err.message || 'Klaviyo did not accept that key.' });
  }
});

app.post('/api/klaviyo/role', requireUser, (req, res) => {
  const row = klaviyoRow(req.user.uid);
  if (!row?.apiKey) return res.status(400).json({ success: false, error: 'Connect a Klaviyo private key first.' });
  row.sendWith = req.body?.sendWith === 'klaviyo' ? 'klaviyo' : 'jourvance';
  row.lastError = '';
  writeKlaviyoRow(req.user.uid, row);
  res.json({ success: true, klaviyo: presentKlaviyo(row) });
});

app.post('/api/klaviyo/link', requireUser, (req, res) => {
  const row = klaviyoRow(req.user.uid);
  if (!row?.apiKey) return res.status(400).json({ success: false, error: 'Connect Klaviyo before linking a flow.' });
  const journeyId = String(req.body?.journeyId || '').slice(0, 80);
  const nodeId = String(req.body?.nodeId || '').slice(0, 80);
  const when = ['lead_capture', 'exit_intent', 'checkout_abandonment', 'order_paid'].includes(req.body?.when) ? req.body.when : 'lead_capture';
  const flowId = String(req.body?.klaviyoFlowId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  if (!journeyId || !nodeId) return res.status(400).json({ success: false, error: 'This email node is not on a saved map.' });
  if (flowId && !(row.flows || []).some((flow) => flow.id === flowId)) {
    return res.status(400).json({ success: false, error: 'Sync Klaviyo so this flow is on the list, then choose it again.' });
  }
  const links = (Array.isArray(row.nodeLinks) ? row.nodeLinks : []).filter((link) => !(link.journeyId === journeyId && link.nodeId === nodeId));
  links.unshift({ journeyId, nodeId, klaviyoFlowId: flowId, when });
  row.nodeLinks = links.slice(0, 40);
  writeKlaviyoRow(req.user.uid, row);
  res.json({ success: true, klaviyo: presentKlaviyo(row) });
});

app.post('/api/klaviyo/disconnect', requireUser, (req, res) => {
  const store = loadKlaviyoStore();
  delete store[req.user.uid];
  saveKlaviyoStore(store);
  res.json({ success: true, klaviyo: { connected: false, keyOnFile: false } });
});

app.post('/api/klaviyo/sync', requireUser, async (req, res) => {
  try {
    const result = await syncKlaviyo(req.user.uid);
    res.json({ success: true, klaviyo: presentKlaviyo(klaviyoRow(req.user.uid)), result });
  } catch (err) {
    const row = klaviyoRow(req.user.uid);
    if (row) {
      row.lastError = err.message || 'Sync failed.';
      writeKlaviyoRow(req.user.uid, row);
    }
    res.status(err.status || 502).json({ success: false, error: err.message || 'Klaviyo sync failed.' });
  }
});

app.post('/api/email/send', requireUser, async (req, res) => {
  if (hubReady) {
    try {
      const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      if (String(body.sendTime || '').toLowerCase() === 'optimal') delete body.sendTime;
      const sent = await hub.email.send(body);
      if (sent && sent.success === false) {
        return res.status(sent.status || 502).json({ success: false, error: sent.error || 'Email was not sent.', sent });
      }
      return res.json({ success: true, sent });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
  res.status(503).json({ success: false, error: 'Email sending is not connected, so nothing was sent.' });
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

  // Sync from disk if not yet in cache
  if (!publicPageCache[cleanId] && !publicPageCache[`domain:${cleanId}`]) {
    reloadPublicPageCache();
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
  const storeDomain = realStoreDomain(shopify);
  const variantId = realVariantId(data.shopifyVariantId);
  const productId = shopifyId(data.shopifyProductId);
  const beaconPrice = savedPrice(data.shopifyProductPrice);
  const cartAction = data.cartAction === 'add' ? 'add' : 'checkout';
  const discountCode = data.discountCode || '';
  const headline = data.headline || 'Offer';
  const subhead = data.subhead || '';
  const bullets = Array.isArray(data.bullets) ? data.bullets : [];
  const trustBadge = /4\.9\/5|verified (beauty lovers|customers|buyers|clients)/i.test(String(data.trustBadge || '')) ? '' : (data.trustBadge || '');
  const productTitle = data.shopifyProductTitle || headline;
  const productPrice = data.shopifyProductPrice || '';
  const heroImage = data.shopifyProductImage || data.heroImageUrl || '';
  const isLeadGate = data.checkoutMode === 'lead-gate';
  const buttonText = data.buttonText || 'Continue';
  const metaPixelId = realTrackingId(data.metaPixelId);
  const tiktokPixelId = realTrackingId(data.tiktokPixelId);
  const ga4TrackingId = realTrackingId(data.ga4TrackingId);
  const slug = page.slug || 'offer';

  // Wave 4: Urgency & Scarcity Boosters
  const urgencyMinutesRaw = Number(rawData.urgencyMinutes);
  const urgencyMinutes = Number.isFinite(urgencyMinutesRaw) && urgencyMinutesRaw > 0 ? urgencyMinutesRaw : 0;
  const showUrgency = Boolean(rawData.urgencyTimerEnabled) && urgencyMinutes > 0;
  const urgencyText = rawData.urgencyText || 'This offer timer runs for';

  const scarcitySaved = String(rawData.scarcityBatchText || '').trim();
  const scarcitySeed = /hand-blended batch #22|only 14 units remaining/i.test(scarcitySaved);
  const scarcityCount = Number(rawData.scarcityBatchCount);
  const scarcityCountSet = rawData.scarcityBatchCount !== undefined && rawData.scarcityBatchCount !== null && String(rawData.scarcityBatchCount) !== '' && Number.isFinite(scarcityCount) && scarcityCount > 0;
  const scarcityBatchText = (scarcitySaved && !scarcitySeed)
    ? scarcitySaved
    : (scarcityCountSet && !scarcitySeed ? `Limited batch: ${scarcityCount} units remaining` : '');
  const showScarcity = Boolean(rawData.scarcityBatchEnabled) && Boolean(scarcityBatchText);

  // Order Bump configuration
  const bumpVariantId = realVariantId(data.orderBumpVariantId);
  const orderBumpEnabled = data.orderBumpEnabled === true && !!bumpVariantId;
  const bumpTitle = data.orderBumpTitle || 'Add-on';
  const bumpPrice = data.orderBumpPrice || '';
  const bumpHeadline = data.orderBumpHeadline || 'Add this to the order';
  const bumpDescription = data.orderBumpDescription || '';
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

  ${discountCode ? `<div class="top-bar">Code <strong>${escapeHtml(discountCode)}</strong> is ready at checkout</div>` : ''}

  ${showUrgency ? `
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
    ${storeDomain ? `<div class="secure-pill"><span>Checkout continues on ${escapeHtml(storeDomain)}</span></div>` : ''}
  </header>

  <main>
    <div class="offer-card">
      <div class="image-wrap">
        <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(headline)}" id="product-img">
        ${productPrice ? `<div class="price-tag" id="product-price">${escapeHtml(productPrice)}</div>` : ''}
      </div>

      <div class="content-area">
        ${showScarcity ? `
        <div class="scarcity-badge" id="jv-scarcity-badge">
          <span class="scarcity-pulse"></span>
          <span>${escapeHtml(scarcityBatchText)}</span>
        </div>
        ` : ''}
        ${discountCode ? `<div class="eyebrow"><span>Code ${escapeHtml(discountCode)} is ready at checkout</span></div>` : ''}

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

        ${trustBadge ? `<div class="trust-box"><span>${escapeHtml(trustBadge)}</span></div>` : ''}

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
        ${variantId ? `
        <form id="jv-restock-form" style="margin-top:14px; display:flex; flex-direction:column; gap:8px;">
          <label for="jv-restock-email" style="font-size:13px; color:#e5e7eb;">Email me when this is back</label>
          <input id="jv-restock-email" type="email" required autocomplete="email" style="padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:#0b0b10; color:#fff;">
          <label style="font-size:12px; color:#9ca3af;"><input id="jv-restock-marketing" type="checkbox"> Also send me store news</label>
          <button type="submit" style="padding:10px; border:0; border-radius:8px; background:#10b981; color:#fff; font-weight:600;">Tell me</button>
          <p id="jv-restock-note" style="margin:0; font-size:12px; color:#9ca3af;"></p>
        </form>` : ''}


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
      const utm_source = params.get('utm_source') || '';
      const utm_medium = params.get('utm_medium') || '';
      const utm_campaign = params.get('utm_campaign') || '';
      const jvJourney = '${escapeHtml(page.journeyId || '')}';
      const jvNode = '${escapeHtml(page.nodeId || '')}';
      const utm_content = params.get('utm_content') || '';
      const utm_term = params.get('utm_term') || '';
      const fbclid = params.get('fbclid') || '';
      const ttclid = params.get('ttclid') || '';
      const gclid = params.get('gclid') || '';

      const storeDomain = '${escapeHtml(storeDomain)}';
      const variantId = '${escapeHtml(variantId)}';
      const productId = '${escapeHtml(productId)}';
      const productPrice = '${escapeHtml(beaconPrice)}';
      const bumpVariantId = '${escapeHtml(bumpVariantId)}';
      const orderBumpEnabled = ${orderBumpEnabled ? 'true' : 'false'};
      const discountCode = '${escapeHtml(discountCode)}';
      const slug = '${escapeHtml(slug)}';
      const isLeadGate = ${isLeadGate ? 'true' : 'false'};
      const defaultButtonText = '${escapeHtml(buttonText)}';
      const activeVariant = '${escapeHtml(activeVariant)}';
      window.__jvVariant = activeVariant;

      // Wave 4: Urgency Reservation Timer Persistence
      const urgencyTimerEnabled = ${showUrgency ? 'true' : 'false'};
      const urgencyMinutes = ${urgencyMinutes};
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
        var vid = window.jourvanceVisitor ? window.jourvanceVisitor() : '';
        if (vid) out.set('attributes[jv_vid]', vid);
        if (slug) out.set('attributes[jv_slug]', slug);
        if (jvJourney) out.set('attributes[jv_journey]', jvJourney);
        if (jvNode) out.set('attributes[jv_node]', jvNode);
        if (utm_source) out.set('attributes[utm_source]', utm_source);
        if (utm_medium) out.set('attributes[utm_medium]', utm_medium);
        if (utm_campaign) out.set('attributes[utm_campaign]', utm_campaign);
        if (utm_content) out.set('attributes[utm_content]', utm_content);
        if (fbclid) out.set('attributes[fbclid]', fbclid);
        if (ttclid) out.set('attributes[ttclid]', ttclid);
        if (gclid) out.set('attributes[gclid]', gclid);
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
        ${commerceBeaconCall(cartAction)}
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
            if (!storeDomain) return;
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

      const restockForm = document.getElementById('jv-restock-form');
      if (restockForm) {
        restockForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          const note = document.getElementById('jv-restock-note');
          const response = await fetch('/api/public/restock-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: slug,
              email: document.getElementById('jv-restock-email').value,
              variantId: variantId,
              visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : '',
              acceptsMarketing: document.getElementById('jv-restock-marketing').checked === true
            })
          });
          const data = await response.json().catch(function() { return {}; });
          if (note) note.textContent = data.message || (response.ok ? 'Request saved. Nothing was sent yet.' : 'That request was not saved.');
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
                gclid,
                visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
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

      // Exit-Intent Trigger Engine (Wave 5)
      (function() {
        var exitDismissedKey = 'jv_exit_dismissed_' + slug;
        var overlay = document.getElementById('jv-exit-overlay');
        if (!overlay) return;

        var closeBtn = document.getElementById('jv-exit-close');
        var submitBtn = document.getElementById('jv-exit-submit-btn');
        var emailInput = document.getElementById('jv-exit-email');
        var formState = document.getElementById('jv-exit-form-state');
        var successState = document.getElementById('jv-exit-success-state');
        var continueBtn = document.getElementById('jv-exit-continue-btn');
        var hasTriggered = false;

        function showExitModal() {
          if (hasTriggered || sessionStorage.getItem(exitDismissedKey)) return;
          hasTriggered = true;
          overlay.style.display = 'flex';
        }

        function closeExitModal() {
          overlay.style.display = 'none';
          sessionStorage.setItem(exitDismissedKey, '1');
        }

        if (closeBtn) closeBtn.addEventListener('click', closeExitModal);
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) closeExitModal();
        });

        // Desktop mouseout trigger (user moves cursor above viewport)
        document.addEventListener('mouseleave', function(e) {
          if (e.clientY <= 0) {
            showExitModal();
          }
        });

        // Mobile fallback scroll trigger
        var scrollTriggered = false;
        window.addEventListener('scroll', function() {
          var scrolled = (window.scrollY + window.innerHeight) / (document.documentElement.scrollHeight || 1);
          if (scrolled > 0.4 && !scrollTriggered) {
            scrollTriggered = true;
          }
        });

        setTimeout(function() {
          if (window.innerWidth < 768 && scrollTriggered) {
            showExitModal();
          }
        }, 25000);

        if (submitBtn && emailInput) {
          submitBtn.addEventListener('click', async function() {
            var val = (emailInput.value || '').trim();
            if (!val || !val.includes('@')) {
              emailInput.style.borderColor = '#EF4444';
              return;
            }
            submitBtn.disabled = true;
            submitBtn.textContent = 'Securing VIP Code…';

            try {
              var exitCode = "${escapeHtml(data.exitIntentDiscountCode || data.discountCode || '')}";
              var exitResp = await fetch('/api/public/lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slug: slug,
                  email: val,
                  variant: activeVariant,
                  exit_intent: true,
                  utm_source: utm_source,
                  utm_campaign: utm_campaign,
                  fbclid: fbclid,
                  ttclid: ttclid,
                  gclid: gclid,
                  visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
                })
              });
              var exitData = await exitResp.json();
              if (exitData && exitData.discountCode) {
                exitCode = exitData.discountCode;
                var codeDisplay = document.getElementById('jv-exit-code-display');
                if (codeDisplay) codeDisplay.textContent = exitCode;
              }

              formState.style.display = 'none';
              successState.style.display = 'block';

              if (continueBtn) {
                continueBtn.addEventListener('click', function() {
                  var checkoutUrl = (exitData && exitData.checkoutUrl) ? exitData.checkoutUrl : buildCheckoutUrl();
                  window.location.href = checkoutUrl;
                });
              }
            } catch(e) {
              console.error('Exit lead submission error:', e);
              formState.style.display = 'none';
              successState.style.display = 'block';
            }
          });
        }
      })();
    })();
  </script>

  ${data.exitIntentEnabled ? `
  <!-- Exit-Intent Conversion Rescue Modal (Wave 5) -->
  <div id="jv-exit-overlay" style="display:none; position:fixed; inset:0; background:rgba(10, 14, 26, 0.85); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:99999; align-items:center; justify-content:center; padding:20px;">
    <div id="jv-exit-card" style="position:relative; width:100%; max-width:480px; background:linear-gradient(145deg, rgba(26, 18, 34, 0.98), rgba(15, 23, 42, 0.99)); border:1px solid rgba(236, 72, 153, 0.35); border-radius:20px; padding:32px 28px; box-shadow:0 30px 80px rgba(0, 0, 0, 0.8), 0 0 50px rgba(236, 72, 153, 0.15); text-align:center; color:#FFFFFF;">
      <button id="jv-exit-close" aria-label="Close" style="position:absolute; top:14px; right:16px; background:none; border:none; color:#94A3B8; font-size:26px; cursor:pointer; padding:4px 8px; line-height:1; border-radius:8px;">&times;</button>
      
      <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(236, 72, 153, 0.15); border:1px solid rgba(236, 72, 153, 0.3); color:#F472B6; padding:4px 12px; border-radius:9999px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:14px;">
        <span>✨</span> ${escapeHtml(data.exitIntentBadge || 'Before you go')}
      </div>

      <h3 style="font-size:22px; font-weight:800; line-height:1.3; margin:0 0 10px; color:#F8FAFC;">
        ${escapeHtml(data.exitIntentHeadline || 'Leave your email before you go')}
      </h3>

      <p style="font-size:13px; color:#CBD5E1; line-height:1.5; margin:0 0 22px;">
        ${escapeHtml(data.exitIntentSubhead || 'Leave an email if you want a follow-up.')}
      </p>

      <div id="jv-exit-form-state">
        <input type="email" id="jv-exit-email" placeholder="Enter your best email address" style="width:100%; box-sizing:border-box; padding:14px 16px; border-radius:10px; border:1px solid rgba(255, 255, 255, 0.18); background:rgba(15, 23, 42, 0.8); color:#FFFFFF; font-size:14px; margin-bottom:12px; outline:none;" />
        <button id="jv-exit-submit-btn" style="width:100%; padding:14px 20px; border-radius:10px; border:none; background:linear-gradient(135deg, #EC4899, #DB2777); color:#FFFFFF; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 10px 25px rgba(236, 72, 153, 0.35);">
          ${escapeHtml(data.exitIntentButtonText || 'Save my email')}
        </button>
      </div>

      <div id="jv-exit-success-state" style="display:none; text-align:center; padding:6px 0;">
        <div style="background:rgba(236, 72, 153, 0.12); border:1px dashed rgba(236, 72, 153, 0.4); border-radius:12px; padding:16px; margin-bottom:18px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#F472B6; font-weight:700; margin-bottom:4px;">VIP Code Unlocked</div>
          <div id="jv-exit-code-display" style="font-size:22px; font-weight:800; color:#FFFFFF; letter-spacing:0.08em; font-family:monospace;">${escapeHtml(data.exitIntentDiscountCode || data.discountCode || 'Saved')}</div>
          <div style="font-size:11px; color:#94A3B8; margin-top:4px;">${storeDomain && variantId && (data.exitIntentDiscountCode || data.discountCode) ? 'This code is added to the checkout link.' : 'Saved. A store checkout is not connected yet.'}</div>
        </div>
        <button id="jv-exit-continue-btn" style="width:100%; padding:14px 20px; border-radius:10px; border:none; background:linear-gradient(135deg, #10B981, #059669); color:#FFFFFF; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 10px 25px rgba(16, 185, 129, 0.35);">
          Continue
        </button>
      </div>

      <div style="margin-top:14px; font-size:11px; color:#64748B;">
        🔒 Private & confidential. No spam. You can unsubscribe anytime.
      </div>
    </div>
  </div>
  ` : ''}
</body>
</html>`;
}

// Wave 5: Post-Purchase / Thank You VIP Portal SSR
function renderPublicThankYouHtml(page, req, res) {
  const d = page.data || {};
  const shopify = page.shopifyConfig || {};
  const storeDomain = realStoreDomain(shopify);
  const headline = d.thankYouHeadline || 'Thank you';
  const subhead = d.thankYouSubhead || 'Your order is confirmed.';
  const badge = d.thankYouBadge || '';
  const bounceCode = d.bounceBackDiscountCode || '';
  const bounceText = d.bounceBackDiscountText || '';
  const ritualTitle = d.usageGuideTitle || '';
  const steps = Array.isArray(d.usageGuideSteps) ? d.usageGuideSteps.filter(Boolean) : [];
  const communityUrl = d.communityInviteUrl || '';
  const communityText = d.communityInviteText || 'Open the link';
  const storeUrl = d.storeReturnUrl || (storeDomain ? `https://${storeDomain}` : '');
  const storeText = d.storeReturnText || 'Back to the store';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headline)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0B0F19;
      color: #F8FAFC;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      width: 100%;
      max-width: 680px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .card {
      background: linear-gradient(145deg, rgba(26, 18, 34, 0.7), rgba(15, 23, 42, 0.85));
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px 28px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .hero-header {
      text-align: center;
      padding: 10px 0 10px;
    }
    .check-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.05));
      border: 1.5px solid #10B981;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 30px;
      color: #10B981;
      box-shadow: 0 0 30px rgba(16, 185, 129, 0.3);
      margin-bottom: 20px;
    }
    .vip-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(236, 72, 153, 0.15);
      border: 1px solid rgba(236, 72, 153, 0.3);
      color: #F472B6;
      padding: 4px 14px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 28px;
      font-weight: 800;
      line-height: 1.3;
      color: #FFFFFF;
      margin-bottom: 12px;
    }
    .subhead {
      font-size: 14px;
      color: #94A3B8;
      max-width: 520px;
      margin: 0 auto;
    }
    .voucher-card {
      border: 1px dashed rgba(236, 72, 153, 0.45);
      background: linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(15, 23, 42, 0.6));
      border-radius: 16px;
      padding: 24px;
      text-align: center;
    }
    .voucher-code-wrap {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: rgba(0, 0, 0, 0.4);
      padding: 10px 20px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      margin: 14px 0;
    }
    .code-text {
      font-family: monospace;
      font-size: 22px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: 0.1em;
    }
    .copy-btn {
      background: rgba(236, 72, 153, 0.25);
      border: 1px solid rgba(236, 72, 153, 0.5);
      color: #F472B6;
      font-weight: 700;
      font-size: 11px;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: rgba(236, 72, 153, 0.4);
      color: #FFFFFF;
    }
    .ritual-step {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ritual-step:last-child {
      border-bottom: none;
    }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(236, 72, 153, 0.15);
      border: 1px solid rgba(236, 72, 153, 0.3);
      color: #F472B6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 600px) {
      .actions-grid { grid-template-columns: 1fr; }
    }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 20px;
      border-radius: 12px;
      background: linear-gradient(135deg, #EC4899, #DB2777);
      color: #FFFFFF;
      font-weight: 700;
      font-size: 13px;
      text-decoration: none;
      box-shadow: 0 10px 25px rgba(236, 72, 153, 0.35);
      transition: transform 0.15s ease;
      text-align: center;
    }
    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 20px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #F1F5F9;
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
      transition: background 0.15s ease;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card hero-header">
      <div class="check-icon">✓</div>
      <br>
      ${badge ? `<div class="vip-pill">${escapeHtml(badge)}</div>` : ''}
      <h1>${escapeHtml(headline)}</h1>
      <p class="subhead">${escapeHtml(subhead)}</p>
    </div>

    ${bounceCode ? `
    <div class="card voucher-card">
      <div style="font-size:12px; font-weight:700; color:#F472B6; text-transform:uppercase; letter-spacing:0.06em;">Next order</div>
      <div style="font-size:16px; font-weight:700; color:#FFFFFF; margin-top:4px;">${escapeHtml(bounceText || bounceCode)}</div>
      <div class="voucher-code-wrap">
        <span class="code-text" id="jv-code-val">${escapeHtml(bounceCode)}</span>
        <button class="copy-btn" id="jv-copy-btn" onclick="navigator.clipboard.writeText('${escapeHtml(bounceCode)}'); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy', 2000);">Copy</button>
      </div>
    </div>` : ''}

    ${steps.length ? `
    <div class="card">
      ${ritualTitle ? `<h3 style="font-size:16px; font-weight:700; color:#F8FAFC; margin-bottom:14px;">${escapeHtml(ritualTitle)}</h3>` : ''}
      <div>
        ${steps.map((st, i) => `
          <div class="ritual-step">
            <div class="step-num">${String(i + 1).padStart(2, '0')}</div>
            <div style="font-size:13px; color:#E2E8F0; line-height:1.5;">${escapeHtml(st)}</div>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    ${(storeUrl || communityUrl) ? `
    <div class="actions-grid">
      ${storeUrl ? `<a href="${escapeHtml(storeUrl)}" target="_blank" rel="noopener" class="btn-primary">${escapeHtml(storeText)}</a>` : ''}
      ${communityUrl ? `<a href="${escapeHtml(communityUrl)}" target="_blank" rel="noopener" class="btn-secondary">${escapeHtml(communityText)}</a>` : ''}
    </div>` : ''}

    <div style="text-align:center; padding:10px 0; font-size:11px; color:#64748B;">
      Powered by Jourvance
    </div>
  </div>
</body>
</html>`;
}

// Wave 9: SSR Post-Purchase Upsell & Downsell Engine
function renderPublicUpsellHtml(page, req, res, isDownsell = false) {
  const d = page.data || {};
  const upsell = isDownsell ? (d.downsell || {}) : (d.upsell || {});
  const shopify = page.shopifyConfig || {};
  const storeDomain = realStoreDomain(shopify);
  const slug = page.slug || req.params.slug || 'offer';

  const headline = upsell.headline || (isDownsell ? (d.downsellHeadline || 'Another offer') : (d.upsellHeadline || 'Another offer'));
  const subhead = upsell.subhead || (isDownsell ? (d.downsellSubhead || '') : (d.upsellSubhead || ''));
  const badge = upsell.badgeText || (isDownsell ? (d.downsellBadge || '') : (d.upsellBadge || ''));
  const urgencyRaw = Number(upsell.urgencyMinutes || d.upsellUrgencyMinutes);
  const urgencyMins = Number.isFinite(urgencyRaw) && urgencyRaw > 0 ? urgencyRaw : 0;
  const productTitle = upsell.productTitle || (isDownsell ? (d.downsellProductTitle || '') : (d.upsellProductTitle || ''));
  const productPrice = upsell.productPrice || (isDownsell ? (d.downsellProductPrice || '') : (d.upsellProductPrice || ''));
  const regularPrice = upsell.regularPrice || (isDownsell ? (d.downsellRegularPrice || '') : (d.upsellRegularPrice || ''));
  const discountCode = upsell.discountCode || (isDownsell ? (d.downsellDiscountCode || '') : (d.upsellDiscountCode || ''));
  const productImage = upsell.productImage || (isDownsell ? (d.downsellProductImage || '') : (d.upsellProductImage || ''));
  const benefits = (Array.isArray(upsell.benefits) && upsell.benefits.length) ? upsell.benefits : (Array.isArray(d.upsellBenefits) ? d.upsellBenefits : []);
  const acceptText = upsell.acceptButtonText || (isDownsell ? (d.downsellAcceptText || 'Continue') : (d.upsellAcceptText || 'Continue'));
  const declineText = upsell.declineButtonText || (isDownsell ? 'No thanks, continue to my order confirmation' : 'No thanks, skip this offer');
  const variantId = realVariantId(upsell.shopifyVariantId || d.upsellVariantId);

  const accentColor = isDownsell ? '#F59E0B' : '#10B981';
  const accentGradient = isDownsell ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'linear-gradient(135deg, #10B981, #059669)';
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  const nextDeclineUrl = (!isDownsell && (d.hasDownsell || d.downsell)) ? `/p/${slug}/downsell` : `/p/${slug}/thank-you`;
  const explicitPrice = isDownsell
    ? (upsell.productPrice || d.downsellProductPrice || '')
    : (upsell.productPrice || d.upsellProductPrice || '');
  const checkoutUrl = storeDomain && variantId
    ? `https://${storeDomain}/cart/${variantId}:1${discountCode ? `?discount=${encodeURIComponent(discountCode)}` : ''}`
    : '';
  const recordedAmount = checkoutUrl ? (parseFloat(String(explicitPrice).replace(/[^0-9.]/g, '')) || 0) : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headline)} — ${isDownsell ? 'Downsell Offer' : 'One-Time Offer'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0B0F19;
      color: #F8FAFC;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      width: 100%;
      max-width: 620px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .reassurance-banner {
      background: rgba(234, 179, 8, 0.12);
      border: 1px solid rgba(234, 179, 8, 0.3);
      border-radius: 12px;
      padding: 12px 16px;
      text-align: center;
      font-size: 13px;
      color: #FACC15;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .card {
      background: linear-gradient(145deg, rgba(26, 18, 34, 0.7), rgba(15, 23, 42, 0.85));
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 32px 28px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .badge-pill {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      background: ${badgeBg};
      border: 1px solid ${badgeBorder};
      color: ${accentColor};
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    h1 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 26px;
      line-height: 1.3;
      color: #FFFFFF;
      margin-bottom: 10px;
    }
    p.subhead {
      font-size: 14px;
      color: #94A3B8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .product-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 24px;
    }
    .product-img {
      width: 90px;
      height: 90px;
      border-radius: 10px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .product-info {
      flex: 1;
      min-width: 0;
    }
    .product-title {
      font-size: 15px;
      font-weight: 700;
      color: #F8FAFC;
      margin-bottom: 6px;
    }
    .pricing-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 8px;
    }
    .price-special {
      font-size: 22px;
      font-weight: 800;
      color: ${accentColor};
    }
    .price-reg {
      font-size: 14px;
      color: #64748B;
      text-decoration: line-through;
    }
    .benefits-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 26px;
    }
    .benefit-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #CBD5E1;
    }
    .benefit-icon {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .btn-accept {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 16px 24px;
      border-radius: 12px;
      background: ${accentGradient};
      color: #FFFFFF;
      font-size: 15px;
      font-weight: 800;
      text-decoration: none;
      border: none;
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.35);
      transition: all 0.2s ease;
    }
    .btn-accept:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(16, 185, 129, 0.45);
    }
    .decline-link {
      display: block;
      text-align: center;
      margin-top: 14px;
      font-size: 12px;
      color: #94A3B8;
      text-decoration: underline;
      cursor: pointer;
      background: transparent;
      border: none;
    }
    .decline-link:hover {
      color: #CBD5E1;
    }
  </style>
</head>
<body>
  <div class="container">
    ${urgencyMins > 0 ? `
    <div class="reassurance-banner">
      <span>This offer timer runs for <span id="jv-timer">${String(urgencyMins).padStart(2, '0')}:00</span>.</span>
    </div>` : ''}

    <!-- Main Presentation Card -->
    <div class="card">
      <div style="text-align:center;">
        ${badge ? `<span class="badge-pill">${escapeHtml(badge)}</span>` : ''}
        <h1>${escapeHtml(headline)}</h1>
        <p class="subhead">${escapeHtml(subhead)}</p>
      </div>

      <!-- Product Box -->
      <div class="product-box">
        ${productImage ? `<img src="${escapeHtml(productImage)}" alt="${escapeHtml(productTitle || headline)}" class="product-img" />` : ''}
        <div class="product-info">
          ${productTitle ? `<div class="product-title">${escapeHtml(productTitle)}</div>` : ''}
          ${(productPrice || regularPrice) ? `<div class="pricing-row">
            ${productPrice ? `<span class="price-special">${escapeHtml(productPrice)}</span>` : ''}
            ${regularPrice ? `<span class="price-reg">${escapeHtml(regularPrice)}</span>` : ''}
          </div>` : ''}
          ${checkoutUrl ? `<div style="font-size:11px; color:#94A3B8; font-weight:600;">Checkout opens on the connected store.</div>` : `<div style="font-size:11px; color:#94A3B8; font-weight:600;">No store checkout is connected for this offer.</div>`}
        </div>
      </div>

      <!-- Benefit Bullets -->
      ${benefits.length ? `<div class="benefits-list">
        ${benefits.map(b => `
          <div class="benefit-item">
            <div class="benefit-icon">✓</div>
            <div>${escapeHtml(b)}</div>
          </div>
        `).join('')}
      </div>` : ''}

      <!-- Accept CTA -->
      <a
        id="jv-accept-btn"
        href="${escapeHtml(checkoutUrl || '#')}"
        class="btn-accept"
      >
        ${escapeHtml(acceptText)}
      </a>

      <!-- Decline Option -->
      <a
        id="jv-decline-btn"
        href="${escapeHtml(nextDeclineUrl)}"
        class="decline-link"
      >
        ${escapeHtml(declineText)}
      </a>
    </div>


  </div>

  <script>
    (function() {
      var duration = ${urgencyMins} * 60;
      if (!duration) return;
      var key = 'jv_timer_${slug}_${isDownsell ? 'down' : 'up'}';
      var now = Math.floor(Date.now() / 1000);
      var endTime = sessionStorage.getItem(key);
      if (!endTime) {
        endTime = now + duration;
        sessionStorage.setItem(key, endTime);
      } else {
        endTime = parseInt(endTime, 10);
      }

      function update() {
        var current = Math.floor(Date.now() / 1000);
        var rem = Math.max(0, endTime - current);
        var m = Math.floor(rem / 60);
        var s = rem % 60;
        var el = document.getElementById('jv-timer');
        if (el) {
          el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
      }
      setInterval(update, 1000);
      update();
    })();

    // Track accept action
    document.getElementById('jv-accept-btn').addEventListener('click', function(e) {
      if (!${JSON.stringify(checkoutUrl)}) {
        e.preventDefault();
      } else {
        try {
          var url = new URL(this.href, window.location.origin);
          var params = new URLSearchParams(location.search);
          var vid = window.jourvanceVisitor ? window.jourvanceVisitor() : '';
          if (vid) url.searchParams.set('attributes[jv_vid]', vid);
          url.searchParams.set('attributes[jv_slug]', ${JSON.stringify(slug)});
          var journey = ${JSON.stringify(page.journeyId || '')};
          if (journey) url.searchParams.set('attributes[jv_journey]', journey);
          ['utm_source','utm_medium','utm_campaign','fbclid','gclid','ttclid'].forEach(function(key) {
            var value = params.get(key);
            if (value) url.searchParams.set('attributes[' + key + ']', value);
          });
          this.href = url.toString();
        } catch (err) {}
      }
      try {
        fetch('/api/public/upsell-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: ${JSON.stringify(slug)},
            action: 'accept',
            offerType: ${JSON.stringify(isDownsell ? 'downsell' : 'upsell')},
            amount: ${recordedAmount},
            visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
          })
        }).catch(function(){});
      } catch(err) {}
    });
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
  const nodes = Array.isArray(journey.nodes) ? journey.nodes : [];
  const connectedDomain = realStoreDomain(ws?.shopifyConfig);
  const shopifyConfig = connectedDomain
    ? { ...ws.shopifyConfig, storeDomain: connectedDomain }
    : { storeDomain: '', status: 'disconnected' };

  const publishedPages = [];
  const upsellNodes = nodes.filter(n => n.type === 'upsell');
  const thankYouNodes = nodes.filter(n => n.type === 'thank-you');

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

      const upsellNode = upsellNodes.find(u => u.data?.offerType !== 'downsell');
      const downsellNode = upsellNodes.find(u => u.data?.offerType === 'downsell');
      const thankYouNode = thankYouNodes[0];

      node.data = {
        ...d,
        slug: cleanSlug,
        customDomain: customDomain || undefined,
        published: true,
        publishedAt: new Date().toISOString(),
        publishedUrl: pubUrl,
        upsell: upsellNode?.data ? { ...upsellNode.data } : d.upsell,
        downsell: downsellNode?.data ? { ...downsellNode.data } : d.downsell,
        hasDownsell: Boolean(downsellNode?.data || d.downsell),
        thankYou: thankYouNode?.data ? { ...thankYouNode.data } : d.thankYou
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
    } else if (node.type === 'upsell') {
      const d = node.data || {};
      const cleanSlug = (d.slug || `${node.id}-upsell`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '');
      const pubUrl = `/p/${cleanSlug}`;
      node.data = {
        ...d,
        slug: cleanSlug,
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
        data: {
          ...node.data,
          upsell: d.offerType !== 'downsell' ? node.data : undefined,
          downsell: d.offerType === 'downsell' ? node.data : undefined
        },
        shopifyConfig
      };
      await savePublicPage(cleanSlug, publicRecord);
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

function confirmUrl(uid, email, formId) {
  const base = configuredPublicBase(process.env.PUBLIC_BASE_URL);
  if (!base) return '';
  const token = signConfirm(mailLinkSecret(), uid, email, formId);
  return token ? `${base}/api/public/form-confirm/${encodeURIComponent(token)}` : '';
}

async function grantFormCoupon(uid, contact, form) {
  if (!uid || !contact || !form) return { code: '', note: '', label: '' };
  const slice = spinSlice(form, contact.email);
  if (!contact.properties || typeof contact.properties !== 'object' || Array.isArray(contact.properties)) contact.properties = {};
  if (slice?.label) contact.properties.spinSlice = slice.label;
  if (form.testEnabled) contact.properties.formVariant = formVariant(contact.visitorId || '', form.id);
  const spec = slice?.coupon || form.coupon;
  if (!spec?.name) return { code: '', note: '', label: slice?.label || '' };
  const once = `${form.id}:${spec.name}`;
  const bag = userProgramBag(uid);
  if (contact.properties.formCoupon === once) {
    const code = storedCoupon(bag.couponCodes, contact.email, spec.name);
    return { code, note: code ? '' : 'A code was not created.', label: slice?.label || '' };
  }
  const code = await mintCoupon(uid, contact.email, spec, bag);
  contact.properties.formCoupon = once;
  return { code, note: code ? '' : 'A code was not created.', label: slice?.label || '' };
}

// Public Lead Ingestion
app.post('/api/public/lead', async (req, res) => {
  const { slug, email, name, phone, variant, order_bump_selected, orderBumpAccepted, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, ttclid, gclid, visitorId } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  const activeVariant = (variant === 'b' ? 'b' : 'a');
  const page = slug ? await loadPublicPage(slug) : null;
  const storeDomain = realStoreDomain(page?.shopifyConfig);
  const storeConnected = Boolean(storeDomain);
  const variantId = realVariantId(page?.data?.shopifyVariantId);
  const bumpVariantId = realVariantId(page?.data?.orderBumpVariantId);
  const bumpSelected = Boolean(order_bump_selected ?? orderBumpAccepted);
  const discountCode = (activeVariant === 'b' && page?.data?.variantB?.discountCode)
    ? page.data.variantB.discountCode
    : (page?.data?.discountCode || '');

  const exitIntent = Boolean(req.body?.exit_intent || req.body?.exitIntent);
  const tags = ['Jourvance Lead', `Variant-${activeVariant.toUpperCase()}`];
  if (slug) tags.push(slug);
  if (discountCode) tags.push(`Promo-${discountCode}`);
  if (bumpSelected) {
    tags.push('Order Bump Taker');
  }
  if (exitIntent) {
    tags.push('Exit-Intent-Rescue');
  }
  const signupFormId = String(req.body?.formId || '').slice(0, 40);
  let signupForm = null;
  if (signupFormId) {
    signupForm = page?.userId ? signupFormsFor(page.userId).find((form) => form.id === signupFormId && form.enabled) : null;
    if (!signupForm) return res.status(404).json({ success: false, error: 'That signup form is not on this page.' });
    tags.push(`form:${signupForm.id}`);
  }
  const doubleOpt = signupForm?.optIn === 'double';

  const contact = {
    email: email.trim().toLowerCase(),
    name: (name || '').trim(),
    phone: (phone || '').trim(),
    sourceSlug: slug,
    variant: activeVariant,
    exitIntent,
    tags,
    orderBumpSelected: bumpSelected,
    utm_source: utm_source || '',
    utm_medium: utm_medium || '',
    utm_campaign: utm_campaign || '',
    fbclid: fbclid || '',
    ttclid: ttclid || '',
    gclid: gclid || '',
    visitorId: String(visitorId || '').slice(0, 80),
    userId: page?.userId || '',
    journeyId: page?.journeyId || '',
    acceptsMarketing: doubleOpt ? false : true,
    pendingConfirm: doubleOpt ? signupForm.id : '',
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
      const prev = localContacts[existingIndex];
      localContacts[existingIndex] = {
        ...prev,
        ...contact,
        acceptsMarketing: doubleOpt ? prev.acceptsMarketing === true : true,
        pendingConfirm: doubleOpt ? signupForm.id : '',
        properties: { ...(prev.properties || {}), ...(contact.properties || {}) },
        visitorId: contact.visitorId || prev.visitorId || '',
        fbclid: prev.fbclid || contact.fbclid,
        gclid: prev.gclid || contact.gclid,
        ttclid: prev.ttclid || contact.ttclid,
        utm_source: prev.utm_source || contact.utm_source,
        utm_campaign: prev.utm_campaign || contact.utm_campaign,
        firstSeenAt: prev.firstSeenAt || prev.subscribedAt || contact.subscribedAt,
        userId: prev.userId || contact.userId
      };
      contact.acceptsMarketing = localContacts[existingIndex].acceptsMarketing;
    } else {
      contact.firstSeenAt = contact.subscribedAt;
      localContacts.push(contact);
    }
    fs.writeFileSync(contactsFilePath, JSON.stringify(localContacts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Jourvance] Failed to persist lead to contacts.json:', err.message);
  }

  // Auto-Enroll Lead in Drip Nurture Sequence
  try {
    const dripsData = loadDrips();
    const activeSeq = dripsData.sequences.find(s => s.triggerType === (exitIntent ? 'exit_intent' : 'lead_capture'));
    if (activeSeq && !(doubleOpt && contact.acceptsMarketing !== true) && !(page?.userId && klaviyoIsSender(page.userId))) {
      const alreadyActive = dripsData.enrollments.some(e => e.customerEmail === contact.email && e.sequenceId === activeSeq.id && e.status === 'active' && (!e.userId || e.userId === (page?.userId || '')));
      if (!alreadyActive) {
        const enrollment = {
          id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sequenceId: activeSeq.id,
          userId: page?.userId || '',
          customerEmail: contact.email,
          customerName: contact.name,
          sourceSlug: slug,
          currentStepIndex: 0,
          status: 'active',
          enrolledAt: new Date().toISOString(),
          nextStepDueAt: new Date().toISOString(),
          history: []
        };
        dripsData.enrollments.unshift(enrollment);
        activeSeq.activeEnrollments = (activeSeq.activeEnrollments || 0) + 1;
        saveDrips(dripsData);
      }
    }
  } catch (dripErr) {
    console.warn('[Jourvance] Failed to auto-enroll lead into drip:', dripErr.message);
  }

  if (page?.userId) {
    const linkedLead = attachBehavior(page.userId, contact.email, { visitorId: contact.visitorId || '' });
    if (linkedLead.clientId) {
      const contacts = loadContacts();
      const row = contacts.find((item) => item.email === contact.email && contactOwnerId(item) === page.userId);
      if (row && !row.clientId) {
        row.clientId = linkedLead.clientId;
        saveContacts(contacts);
      }
    }
    const handoffContext = {
      reason: 'lead',
      dedupe: 'lead',
      journeyId: page.journeyId || '',
      slug: slug || ''
    };
    const leadVars = { first_name: String(contact.name || '').trim().split(/\s+/)[0] || 'there' };
    const leadContact = {
      email: contact.email,
      name: contact.name,
      visitorId: contact.visitorId,
      phone: contact.phone
    };
    await enrollFlowsForTrigger(page.userId, exitIntent ? 'exit_intent' : 'lead_capture', leadContact, leadVars, handoffContext);
    await enrollLinkedMapFlows(page.userId, page.journeyId, exitIntent ? 'exit_intent' : 'lead_capture', leadContact, leadVars);
    await enrollClaimedBehavior(page.userId, contact, linkedLead.claimed);
    await handoffMapNodes(page.userId, exitIntent ? 'exit_intent' : 'lead_capture', {
      email: contact.email,
      name: contact.name,
      visitorId: contact.visitorId,
      phone: contact.phone
    }, handoffContext);
    const savedLead = loadContacts().find((row) => row.email === contact.email && contactOwnerId(row) === page.userId);
    if (savedLead) {
      savedLead.klaviyoDirty = true;
      saveContacts(loadContacts().map((row) => row.email === savedLead.email && contactOwnerId(row) === page.userId ? savedLead : row));
      pushKlaviyoContact(page.userId, savedLead).catch((err) => {
        const row = klaviyoRow(page.userId);
        if (row) {
          row.lastError = err.message || 'The latest lead was not pushed to Klaviyo.';
          writeKlaviyoRow(page.userId, row);
        }
      });
    }
  }

  let formCoupon = { code: '', note: '', label: '' };
  let confirmSent = false;
  if (signupForm && page?.userId && !doubleOpt) {
    const contacts = loadContacts();
    const row = contacts.find((item) => item.email === contact.email && contactOwnerId(item) === page.userId);
    if (row) {
      formCoupon = await grantFormCoupon(page.userId, row, signupForm);
      saveContacts(contacts);
    }
  }
  if (doubleOpt && contact.acceptsMarketing !== true && page?.userId) {
    const url = confirmUrl(page.userId, contact.email, signupForm.id);
    if (url && hubReady) {
      const letter = await deliverLetter({
        to: contact.email,
        name: contact.name,
        subject: 'Confirm your email',
        text: `Confirm this address: ${url}`,
        html: `<p>Confirm this address.</p><p><a href="${escapeHtml(url)}">Confirm</a></p>`,
        userId: page.userId,
        visitorId: contact.visitorId,
        medium: 'form-confirm',
        marketing: false
      });
      confirmSent = letter.ok === true;
    }
  }
  if (req.body?.smsConsent === true && contact.phone && page?.userId && hubReady) {
    try {
      await hub.email.sms.consent({ email: contact.email, phone: contact.phone, consent: 'opted_in', name: contact.name || '' });
    } catch (err) {
      console.warn('[Jourvance] Text consent was not recorded:', err.message);
    }
  }
  if (page?.userId) await noteSegmentChanges(page.userId);

  if (hubReady && page?.userId && !(doubleOpt && contact.acceptsMarketing !== true)) {
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

  let checkoutUrl = storeConnected && cartItems.length ? `https://${storeDomain}/cart/${cartItems.join(',')}` : null;
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
  appendCartAttributes(outParams, {
    jv_vid: visitorId,
    jv_slug: slug,
    jv_journey: page?.journeyId,
    jv_node: page?.nodeId,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    fbclid,
    gclid,
    ttclid
  });

  const qs = outParams.toString();
  if (qs && checkoutUrl) checkoutUrl += `?${qs}`;

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
        exitIntent,
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
          exitIntent,
          discountCode,
          orderBumpSelected: bumpSelected
        },
        timestamp: new Date().toISOString()
      })
    }).catch(err => {
      console.warn('[Jourvance] Outbound lead webhook relay failed:', err.message);
    });
  }

  recordEvent({
    type: 'lead',
    slug: slug || '',
    journeyId: page?.journeyId || '',
    nodeId: page?.nodeId || '',
    userId: page?.userId || '',
    email: contact.email,
    variant: activeVariant,
    visitorId: contact.visitorId || '',
    utm_source: contact.utm_source || '',
    utm_medium: contact.utm_medium || '',
    utm_campaign: contact.utm_campaign || '',
    fbclid: contact.fbclid || '',
    gclid: contact.gclid || '',
    ttclid: contact.ttclid || ''
  });
  if (bumpSelected) {
    recordEvent({
      type: 'bump',
      slug: slug || '',
      journeyId: page?.journeyId || '',
      nodeId: page?.nodeId || '',
      userId: page?.userId || '',
      email: contact.email
    });
  }

  const confirmMessage = doubleOpt && contact.acceptsMarketing !== true
    ? (confirmSent
      ? 'Saved. Open the confirm link before this address can receive marketing.'
      : 'Saved. This address is not marketable until the confirm link is opened. The confirm email was not sent because no public https address is set.')
    : 'Lead saved.';
  res.json({
    ok: true,
    success: true,
    message: confirmMessage,
    checkoutUrl,
    discountCode,
    variant: activeVariant,
    exitIntent,
    orderBumpIncluded: bumpSelected && Boolean(bumpVariantId),
    acceptsMarketing: contact.acceptsMarketing === true,
    sliceLabel: formCoupon.label || '',
    coupon: formCoupon.code || '',
    couponNote: formCoupon.note || '',
    contact
  });
});

app.get('/api/public/form-confirm/:token', async (req, res) => {
  const parsed = readConfirm(mailLinkSecret(), req.params.token);
  if (!parsed) return res.status(400).type('html').send('<!doctype html><title>Confirm</title><p>This confirm link is not valid.</p>');
  const form = signupFormsFor(parsed.uid).find((item) => item.id === parsed.formId);
  const contacts = loadContacts();
  const contact = contacts.find((row) => String(row.email || '').toLowerCase() === parsed.email && contactOwnerId(row) === parsed.uid);
  if (!contact) return res.status(404).type('html').send('<!doctype html><title>Confirm</title><p>That address is not on this account.</p>');
  contact.acceptsMarketing = true;
  contact.pendingConfirm = '';
  const coupon = form ? await grantFormCoupon(parsed.uid, contact, form) : { code: '', note: '', label: '' };
  saveContacts(contacts);
  await noteSegmentChanges(parsed.uid);
  try {
    const dripsData = loadDrips();
    const activeSeq = dripsData.sequences.find((seq) => seq.triggerType === 'lead_capture');
    const already = dripsData.enrollments.some((row) => row.customerEmail === contact.email && row.sequenceId === activeSeq?.id && row.status === 'active' && (!row.userId || row.userId === parsed.uid));
    if (activeSeq && !already && !klaviyoIsSender(parsed.uid)) {
      dripsData.enrollments.unshift({
        id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sequenceId: activeSeq.id,
        userId: parsed.uid,
        customerEmail: contact.email,
        customerName: contact.name || '',
        sourceSlug: contact.sourceSlug || '',
        currentStepIndex: 0,
        status: 'active',
        enrolledAt: new Date().toISOString(),
        nextStepDueAt: new Date().toISOString(),
        history: []
      });
      activeSeq.activeEnrollments = (activeSeq.activeEnrollments || 0) + 1;
      saveDrips(dripsData);
    }
  } catch (err) {
    console.warn('[Jourvance] Confirm did not enroll the welcome sequence:', err.message);
  }
  const extra = [coupon.label, coupon.code, coupon.note].filter(Boolean).join(' ');
  res.type('html').send(`<!doctype html><title>Confirmed</title><p>This address is confirmed.</p>${extra ? `<p>${escapeHtml(extra)}</p>` : ''}`);
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
    if (req.path === '/thank-you' || req.path === `/${page.slug}/thank-you`) {
      const html = withTracking(renderPublicThankYouHtml(page, req, res), page.slug, 'a');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/upsell' || req.path === `/${page.slug}/upsell`) {
      const html = withTracking(renderPublicUpsellHtml(page, req, res, false), page.slug, 'a');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/downsell' || req.path === `/${page.slug}/downsell`) {
      const html = withTracking(renderPublicUpsellHtml(page, req, res, true), page.slug, 'a');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/' || req.path === `/${page.slug}` || req.path.startsWith('/p/')) {
      const html = withTracking(renderPublicFunnelHtml(page, req, res), page.slug, 'a', true, pageTrackFrom(page));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  }
  next();
});

// Public Upsell / Downsell SSR Routes (Wave 9)
app.get(['/p/:slug/upsell', '/p/:wsId/:slug/upsell'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicUpsellHtml(page, req, res, false), slug, 'a');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get(['/p/:slug/downsell', '/p/:wsId/:slug/downsell'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicUpsellHtml(page, req, res, true), slug, 'a');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Wave 9: Upsell Action & Telemetry API
app.post('/api/public/upsell-action', async (req, res) => {
  const { slug, action, offerType, amount, customerEmail } = req.body || {};
  const isDownsell = offerType === 'downsell';
  const pages = reloadPublicPageCache();
  const page = slug ? pages[slug] : null;

  if (page && page.data) {
    const targetObj = isDownsell ? (page.data.downsell = page.data.downsell || {}) : (page.data.upsell = page.data.upsell || {});
    if (action === 'view') {
      return res.json({ success: true, recorded: false });
    } else if (action === 'accept') {
      targetObj.takes = (targetObj.takes || 0) + 1;
      const parsedAmount = Number(amount);
      const addedRevenue = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
      targetObj.attributedRevenue = Number(((targetObj.attributedRevenue || 0) + addedRevenue).toFixed(2));
      page.data.liveRevenue = Number(((page.data.liveRevenue || 0) + addedRevenue).toFixed(2));
      savePublicPage(slug, page);
    }
  }
  if (slug && (action === 'accept' || action === 'decline')) {
    recordEvent({
      type: action === 'accept' ? 'upsell_accept' : 'upsell_decline',
      slug,
      journeyId: page?.journeyId || '',
      nodeId: page?.nodeId || '',
      userId: page?.userId || '',
      visitorId: String(req.body?.visitorId || '').slice(0, 80),
      offerType: isDownsell ? 'downsell' : 'upsell',
      amount: Number.isFinite(Number(amount)) ? Number(amount) : 0,
      email: customerEmail || ''
    });
  }

  // Tag customer if email provided
  if (customerEmail && action === 'accept') {
    try {
      const contacts = loadContacts();
      const contact = contacts.find(c => c.email.toLowerCase() === customerEmail.toLowerCase());
      if (contact) {
        if (!contact.tags) contact.tags = [];
        const tagName = isDownsell ? 'Downsell-Accepted' : 'Upsell-Accepted';
        if (!contact.tags.includes(tagName)) contact.tags.push(tagName);
        const parsedAmount = Number(amount);
        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          contact.totalSpent = Number(((contact.totalSpent || 0) + parsedAmount).toFixed(2));
        }
        saveContacts(contacts);
      }
    } catch (e) {
      console.warn('[Jourvance] Upsell customer tagging error:', e.message);
    }
  }

  res.status(200).json({ success: true, action, offerType });
});

// Public Thank-You / VIP Onboarding Portal SSR Route (Wave 5)
app.get(['/p/:slug/thank-you', '/p/:wsId/:slug/thank-you'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicThankYouHtml(page, req, res), slug, 'a');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Public Landing Page SSR Route (must be before catch-all static handler)
app.get(['/p/:slug', '/p/:wsId/:slug'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicFunnelHtml(page, req, res), slug, 'a', true, pageTrackFrom(page));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Serve frontend in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PUBLIC_EVENT_TYPES = new Set(['page_view', 'checkout_start', 'thank_you_view', 'upsell_view', 'product_viewed', 'collection_viewed', 'added_to_cart']);

app.post('/api/public/event', (req, res) => {
  const body = req.body || {};
  const type = String(body.type || '');
  const slug = String(body.slug || '').toLowerCase();
  if (!PUBLIC_EVENT_TYPES.has(type) || !slug) {
    return res.status(400).json({ success: false, error: 'Unknown event.' });
  }
  const page = publicPageCache[slug];
  if (!page) return res.status(404).json({ success: false, error: 'That page is not published.' });
  if (type === 'product_viewed' || type === 'collection_viewed' || type === 'added_to_cart') {
    const saved = pageTrackFrom(page);
    if (type === 'added_to_cart' && page.data?.cartAction !== 'add') {
      return res.status(400).json({ success: false, error: 'This page’s button is a checkout link.' });
    }
    if (type === 'product_viewed' && !saved.productId && !saved.variantId) {
      return res.status(400).json({ success: false, error: 'This page has no product to view.' });
    }
    if (type === 'collection_viewed' && !saved.collectionId) {
      return res.status(400).json({ success: false, error: 'This page has no collection.' });
    }
    const event = cleanBehaviorEvent({
      source: 'page',
      userId: page.userId || '',
      type,
      visitorId: body.visitorId,
      productId: saved.productId,
      variantId: saved.variantId,
      collectionId: type === 'collection_viewed' ? saved.collectionId : '',
      price: saved.price
    });
    if (!event) return res.status(400).json({ success: false, error: 'That event was not stored.' });
    event.slug = slug;
    pushBehavior(page.userId || '', event);
    return res.json({ success: true, stored: true });
  }
  recordEvent({
    type,
    slug,
    journeyId: page.journeyId || '',
    nodeId: page.nodeId || '',
    userId: page.userId || '',
    variant: body.variant === 'b' ? 'b' : 'a',
    offerType: body.offerType === 'downsell' ? 'downsell' : (body.offerType === 'upsell' ? 'upsell' : ''),
    visitorId: String(body.visitorId || '').slice(0, 80),
    utm_source: String(body.utm_source || ''),
    utm_medium: String(body.utm_medium || ''),
    utm_campaign: String(body.utm_campaign || ''),
    utm_content: String(body.utm_content || ''),
    utm_term: String(body.utm_term || ''),
    fbclid: String(body.fbclid || ''),
    gclid: String(body.gclid || ''),
    ttclid: String(body.ttclid || '')
  });
  res.json({ success: true });
});

app.post('/api/public/shopify-pixel', (req, res) => {
  const body = req.body || {};
  const ws = workspaceByShopDomain(cleanDomain(body.shop || ''));
  if (!ws || !pixelKeyOk(ws.shopifyConfig?.pixelKey, body.key)) {
    return res.status(401).json({ success: false, error: 'That pixel key was refused.' });
  }
  const clientId = String(body.clientId || '').slice(0, 80);
  if (!clientId) return res.status(400).json({ success: false, error: 'The pixel event needs a client id.' });
  if (!allowPixel(pixelBuckets, clientId, Date.now())) return res.status(202).json({ success: true, stored: false });
  const event = cleanBehaviorEvent({
    source: 'pixel',
    userId: ws.userId,
    type: body.type,
    clientId,
    productId: body.productId,
    variantId: body.variantId,
    collectionId: body.collectionId,
    query: body.query,
    price: body.price,
    currency: body.currency,
    checkoutToken: body.checkoutToken,
    url: body.url,
    email: ''
  });
  if (!event) return res.status(400).json({ success: false, error: 'That pixel event was not stored.' });
  event.email = '';
  pushBehavior(ws.userId, event);
  res.json({ success: true, stored: true });
});

app.post('/api/public/restock-request', (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ success: false, error: 'An email is required.' });
  let uid = '';
  let variantId = '';
  if (body.slug) {
    const page = publicPageCache[String(body.slug || '').toLowerCase()];
    if (!page?.userId) return res.status(404).json({ success: false, error: 'That page is not published.' });
    variantId = shopifyId(page.data?.shopifyVariantId);
    const asked = shopifyId(body.variantId);
    if (!variantId || (asked && asked !== variantId)) return res.status(400).json({ success: false, error: 'That page has no matching variant.' });
    uid = page.userId;
  } else {
    const ws = workspaceByShopDomain(cleanDomain(body.shop || ''));
    if (!ws || !pixelKeyOk(ws.shopifyConfig?.pixelKey, body.key)) {
      return res.status(401).json({ success: false, error: 'That restock key was refused.' });
    }
    variantId = shopifyId(body.variantId);
    if (!variantId) return res.status(400).json({ success: false, error: 'A variant is required.' });
    uid = ws.userId;
  }
  const bag = loadBehaviorBag(uid);
  const now = new Date().toISOString();
  const existing = bag.subscriptions.find((row) => row.email === email && row.variantId === variantId);
  if (existing) {
    existing.at = now;
    existing.firedAt = '';
  } else {
    bag.subscriptions.push({ email, variantId, at: now, firedAt: '' });
  }
  saveBehaviorBag(uid, bag);
  const optIn = body.acceptsMarketing === true;
  const contacts = loadContacts();
  const contact = contacts.find((row) => row.email === email && contactOwnerId(row) === uid);
  if (contact) {
    if (optIn) contact.acceptsMarketing = true;
    if (body.visitorId && !contact.visitorId) contact.visitorId = String(body.visitorId).slice(0, 80);
  } else {
    contacts.push({
      id: `cust_${Date.now()}`,
      email,
      name: email.split('@')[0],
      userId: uid,
      acceptsMarketing: optIn,
      visitorId: String(body.visitorId || '').slice(0, 80),
      tags: [],
      source: 'Restock request',
      firstSeenAt: now
    });
  }
  saveContacts(contacts);
  res.json({ success: true, message: 'Request saved. Nothing was sent yet.' });
});

function round1(n) {
  return Math.round(n * 10) / 10;
}

app.post('/api/funnel/stats', requireUser, (req, res) => {
  const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
  const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];
  const journeyId = String(req.body?.journeyId || '');
  const events = loadEvents().filter(e => e.userId === req.user.uid && (!journeyId || e.journeyId === journeyId));
  const orders = loadOrders().filter(o => {
    if (!o.attributedSlug) return false;
    const page = publicPageCache[o.attributedSlug];
    return page && page.userId === req.user.uid && (!journeyId || page.journeyId === journeyId);
  });
  const drips = loadDrips();
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const nodeStats = {};

  const eventsFor = (node) => events.filter(e => e.nodeId === node.id || (node.slug && e.slug === node.slug));
  const ordersFor = (node) => orders.filter(o => o.attributedNodeId === node.id || (node.slug && o.attributedSlug === node.slug));

  for (const node of nodes) {
    const mine = eventsFor(node);
    const mineOrders = ordersFor(node);
    if (node.type === 'ad-source') {
      const campaign = String(node.utmCampaign || '');
      const clicks = campaign
        ? events.filter(e => e.type === 'page_view' && e.utm_campaign === campaign).length
        : 0;
      const revenue = orders
        .filter(o => campaign && publicPageCache[o.attributedSlug])
        .reduce((sum, o) => sum, 0);
      const matchedOrders = events.filter(e => e.type === 'order' && campaign && e.utm_campaign === campaign);
      const orderRevenue = matchedOrders.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const spend = Number(node.spend || 0);
      nodeStats[node.id] = {
        clicks,
        impressions: 0,
        ctr: 0,
        roas: spend > 0 ? round1(orderRevenue / spend) : 0
      };
      void revenue;
    } else if (node.type === 'landing-page') {
      const visitors = mine.filter(e => e.type === 'page_view').length;
      const leads = mine.filter(e => e.type === 'lead').length;
      const orderCount = mineOrders.length;
      const conversions = orderCount || leads;
      const grossRevenue = Number(mineOrders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));
      const bumpOrders = mineOrders.filter(o => o.orderBumpIncluded);
      nodeStats[node.id] = {
        visitors,
        conversions,
        conversionRate: visitors > 0 ? round1((conversions / visitors) * 100) : 0,
        grossRevenue,
        liveRevenue: grossRevenue,
        liveOrders: orderCount,
        orderBumpTakes: bumpOrders.length,
        liveBumpOrders: bumpOrders.length,
        variantAVisitors: mine.filter(e => e.type === 'page_view' && e.variant !== 'b').length,
        variantBVisitors: mine.filter(e => e.type === 'page_view' && e.variant === 'b').length,
        variantAConversions: mine.filter(e => e.type === 'lead' && e.variant !== 'b').length,
        variantBConversions: mine.filter(e => e.type === 'lead' && e.variant === 'b').length
      };
    } else if (node.type === 'lead-form') {
      const sourceId = edges.find(e => e.target === node.id)?.source;
      const source = sourceId ? byId[sourceId] : null;
      const upstream = source ? eventsFor(source) : [];
      const views = upstream.filter(e => e.type === 'page_view').length;
      const submissions = upstream.filter(e => e.type === 'lead').length;
      nodeStats[node.id] = {
        views,
        submissions,
        completionRate: views > 0 ? round1((submissions / views) * 100) : 0
      };
    } else if (node.type === 'follow-up-sequence') {
      const flowId = String(node.jourvanceFlowId || '');
      const bag = userProgramBag(req.user.uid);
      if (flowId && bag.flows.some((flow) => flow.id === flowId)) {
        const stats = messageStatsFor(req.user.uid, (item) => item.flowId === flowId);
        nodeStats[node.id] = {
          flowEnrolled: enrollmentCount(bag.flowEnrollments, flowId),
          flowSent: stats.sent,
          flowClicked: stats.clicked,
          flowOpened: stats.opened,
          flowRevenue: stats.revenue,
          jourvanceFlowName: bag.flows.find((flow) => flow.id === flowId)?.name || ''
        };
      } else {
        const sourceId = edges.find(e => e.target === node.id)?.source;
        const source = sourceId ? byId[sourceId] : null;
        const slug = source?.slug || '';
        const emails = new Set();
        for (const enr of drips.enrollments) {
          if (enr.userId === req.user.uid && slug && enr.sourceSlug === slug && enr.customerEmail) emails.add(String(enr.customerEmail).toLowerCase());
        }
        for (const evt of events) {
          if (evt.type === 'klaviyo_handoff' && evt.entered && evt.nodeId === node.id && evt.email) emails.add(String(evt.email).toLowerCase());
        }
        nodeStats[node.id] = {
          flowEnrolled: emails.size > 0 ? emails.size : null,
          flowSent: null,
          flowClicked: null,
          flowOpened: null,
          flowRevenue: null
        };
      }
    } else if (node.type === 'thank-you') {
      const thankYous = nodes.filter(n => n.type === 'thank-you');
      const views = thankYous.length === 1
        ? events.filter(e => e.type === 'thank_you_view').length
        : events.filter(e => e.type === 'thank_you_view' && e.slug === node.slug).length;
      nodeStats[node.id] = { pageViews: views, bounceBackClaims: 0 };
    } else if (node.type === 'upsell') {
      const offer = node.offerType === 'downsell' ? 'downsell' : 'upsell';
      const views = events.filter(e => e.type === 'upsell_view' && (e.offerType || 'upsell') === offer).length;
      const accepts = events.filter(e => e.type === 'upsell_accept' && (e.offerType || 'upsell') === offer);
      const takes = accepts.length;
      const attributedRevenue = Number(accepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
      nodeStats[node.id] = {
        views,
        takes,
        conversionRate: views > 0 ? round1((takes / views) * 100) : 0,
        attributedRevenue
      };
    }
  }

  const throughput = (node) => {
    const s = nodeStats[node.id] || {};
    if (node.type === 'ad-source') return s.clicks || 0;
    if (node.type === 'landing-page') return s.visitors || 0;
    if (node.type === 'lead-form') return s.submissions || 0;
    if (node.type === 'follow-up-sequence') return s.flowEnrolled || 0;
    if (node.type === 'thank-you') return s.pageViews || 0;
    if (node.type === 'upsell') return s.takes || 0;
    return 0;
  };
  const edgeStats = {};
  for (const edge of edges) {
    const source = byId[edge.source];
    const target = byId[edge.target];
    const sourceThroughput = source ? throughput(source) : 0;
    const targetCount = target ? throughput(target) : 0;
    edgeStats[edge.id] = {
      sourceThroughput,
      targetCount,
      rate: sourceThroughput > 0 ? round1((targetCount / sourceThroughput) * 100) : 0
    };
  }

  res.json({ success: true, stats: { nodes: nodeStats, edges: edgeStats } });
});

app.get('/api/admin/summary', requireOperator, (req, res) => {
  const events = loadEvents();
  res.json({
    success: true,
    leads: loadContacts().length,
    orders: loadOrders().length,
    pageViews: events.filter(e => e.type === 'page_view').length,
    events: events.length,
    hubConfigured: hubReady
  });
});

function purgeSeededFiles() {
  const pairs = [
    [contactsFilePath, saveContacts],
    [ordersFilePath, saveOrders],
    [campaignsFilePath, saveCampaigns],
    [discountsFilePath, saveDiscounts],
    [checkoutsFilePath, saveCheckouts]
  ];
  for (const [file, save] of pairs) {
    const raw = readJsonArray(file);
    const cleaned = raw.filter(row => !isDemoRecord(row));
    if (cleaned.length !== raw.length) save(cleaned);
  }
  loadDrips();
  const orders = loadOrders();
  const contacts = loadContacts();
  let changed = false;
  for (const contact of contacts) {
    const mine = orders.filter(o => String(o.customerEmail || '').toLowerCase() === String(contact.email || '').toLowerCase());
    const count = mine.length;
    const spent = Number(mine.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));
    if ((contact.ordersCount || 0) !== count || Number(contact.totalSpent || 0) !== spent) {
      contact.ordersCount = count;
      contact.totalSpent = spent;
      changed = true;
    }
  }
  if (changed) saveContacts(contacts);
  let workspacesChanged = false;
  for (const [key, ws] of Object.entries(workspaceCache)) {
    const clean = sanitizeWorkspace(ws);
    if (clean !== ws) {
      workspaceCache[key] = clean;
      workspacesChanged = true;
    }
  }
  if (workspacesChanged) persistWorkspaces();
  const dripsData = loadDrips();
  let dripsChanged = false;
  for (const enr of dripsData.enrollments || []) {
    if (enr.userId) continue;
    const owner = contactOwnerId(loadContacts().find(c => c.email === enr.customerEmail));
    if (!owner) continue;
    enr.userId = owner;
    dripsChanged = true;
  }
  if (dripsChanged) saveDrips(dripsData);
}
purgeSeededFiles();

app.listen(PORT, () => {
  console.log(`[Jourvance] Customer Journey Spoke running at http://localhost:${PORT}`);
});
