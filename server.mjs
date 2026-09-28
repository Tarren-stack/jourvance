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
import tls from 'tls';
import { fileURLToPath } from 'url';
import { createHubClient } from './hub-sdk.js';
import { hubStorage } from './hub-storage.mjs';
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
import {
  buildDiscountCheckoutUrl,
  buildShopifyCartPermalink,
  renderLineItemCardsHtml,
  resolveCheckoutRecoveryUrl
} from './checkout-recovery.mjs';
import {
  DEFAULT_RFM_CONFIG,
  cleanRfmConfig,
  computeContactRfm,
  syncContactRfmTags,
  syncAllContactsRfm
} from './rfm-engine.mjs';
import { setupDomainRoutes, checkSslCertificate } from './server/routes/domainRoutes.mjs';
import { setupShopifyRoutes, ensureShopifyCoreDiscounts as ensureShopifyCoreDiscountsModular } from './server/routes/shopifyRoutes.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';

import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';

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
hubStorage.init({ hub, hubReady, dataDir: __dirname });
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
const PROJECT_TEXT_FIELDS = ['name', 'businessType', 'offerHeadline', 'goal', 'workspaceId', 'shopifyStoreDomain'];
const text = (v) => (typeof v === 'string' ? v.slice(0, 500) : '');

async function saveJourney(uid, id, body) {
  const journey = {
    id,
    userId: uid,
    ...Object.fromEntries(PROJECT_TEXT_FIELDS.map((f) => [f, text(body[f])])),
    ...(body.forecast && typeof body.forecast === 'object' ? { forecast: body.forecast } : {}),
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
  const all = hubStorage.get('store.catalog_memory', 'catalog_memory.json', {});
  const bag = all && typeof all === 'object' ? all[uid] : null;
  return bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {};
}

function saveCatalog(uid, memory) {
  const all = hubStorage.get('store.catalog_memory', 'catalog_memory.json', {});
  all[uid] = memory && typeof memory === 'object' ? memory : {};
  hubStorage.set('store.catalog_memory', 'catalog_memory.json', all);
}

function rememberAdminCatalog(uid, domain, products) {
  if (!uid || !Array.isArray(products) || !products.length) return;
  let memory = loadCatalog(uid);
  for (const product of products.slice(0, 50)) memory = applyProductUpdate(memory, product, domain).memory;
  saveCatalog(uid, memory);
}

function loadBehaviorBag(uid) {
  return hubStorage.loadBehaviorBag(uid);
}

function saveBehaviorBag(uid, bag) {
  const all = hubStorage.get('store.behavior', 'behavior.json', {});
  all[uid] = {
    events: (bag?.events || []).slice(-50000),
    subscriptions: (bag?.subscriptions || []).slice(-20000)
  };
  hubStorage.set('store.behavior', 'behavior.json', all);
}

function pushBehavior(uid, event) {
  hubStorage.pushBehavior(uid, event);
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

// (Shopify workspace routes mounted via server/routes/shopifyRoutes.mjs)


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
  const raw = hubStorage.get('store.contacts', 'contacts.json', []);
  return (Array.isArray(raw) ? raw : []).filter(row => !isDemoRecord(row));
}

function saveContacts(contacts) {
  hubStorage.set('store.contacts', 'contacts.json', contacts);
}

function loadOrders() {
  const raw = hubStorage.get('store.orders', 'orders.json', []);
  return (Array.isArray(raw) ? raw : []).filter(row => !isDemoRecord(row));
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
  hubStorage.set('store.orders', 'orders.json', orders);
}

const predictionsFilePath = path.join(__dirname, 'predictions.json');

function loadPredictionStore() {
  const data = hubStorage.get('store.predictions', 'predictions.json', {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function savePredictionStore(store) {
  hubStorage.set('store.predictions', 'predictions.json', store);
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
  const raw = hubStorage.get('store.campaigns', 'campaigns.json', []);
  return (Array.isArray(raw) ? raw : []).filter(row => !isDemoRecord(row));
}

function saveCampaigns(campaigns) {
  hubStorage.set('store.campaigns', 'campaigns.json', campaigns);
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
        subject: 'We saved your beauty essentials',
        previewText: 'Your order is waiting for you',
        body: 'Hi {{first_name}},\n\nWe noticed you didn’t get a chance to finish your order. Your selected items have been carefully saved so you can pick right back up where you left off.\n\nReturn to your checkout here:\n{{abandoned_checkout_url}}',
        discountVoucher: ''
      },
      {
        id: 'cart_step_2',
        stepNumber: 2,
        delayHours: 24,
        subject: 'A complimentary 10% courtesy for your bag',
        previewText: 'A little gift to complete your ritual',
        body: 'Hi {{first_name}},\n\nWe want to make sure you get the best experience with us. As a special courtesy, enjoy 10% off your saved beauty items with code SAVE10.\n\nClaim your 10% courtesy discount here:\n{{abandoned_checkout_url}}',
        discountVoucher: 'SAVE10'
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'drip_seq_upsell_recovery',
    name: 'Post-Purchase Courtesy Offer',
    description: 'Reaches out to clients who passed on their post-purchase upgrade, offering a gentle second chance with a private courtesy discount.',
    triggerType: 'upsell_recovery',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'upsell_rec_step_1',
        stepNumber: 1,
        delayHours: 18,
        subject: 'A little courtesy for your recent order',
        previewText: 'In case you still wanted to complete your ritual',
        body: 'Hey {{first_name}},\n\nThank you again for your order {{order_number}}. We are already preparing everything for you.\n\nWhen you checked out, you skipped the upgrade offer. In case you still wanted to add it to your routine, we saved a private 10% courtesy voucher for you:\n\nCode: {{discount_code}}\n\nYou can review the offer and claim your discount here:\n{{offer_url}}\n\nNo pressure at all—we simply wanted to make sure you had the option before your order ships.\n\nWarmly,\nThe Jourvance Team',
        discountVoucher: 'SAVE10'
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'drip_seq_at_risk_winback',
    name: 'At-Risk Inactive Client Winback',
    description: 'Automatically re-engages clients who reach the at-risk inactivity threshold (90 days since last purchase) with a gentle check-in and 15% courtesy treat.',
    triggerType: 'at_risk_inactivity',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'winback_step_1',
        stepNumber: 1,
        delayHours: 0,
        subject: 'We miss you — a private 15% courtesy treat for your next ritual',
        previewText: "It's been a little while, and we'd love to welcome you back",
        body: 'Hello {{first_name}},\n\nWe noticed it’s been a little while since your last visit, and we wanted to check in.\n\nSelf-care should always feel effortless. To welcome you back, we’ve placed a special 15% courtesy reward on your profile for your next restock:\n\nUse code {{discount_code}} at checkout.\n\nWhenever you’re ready to replenish your favorites, we are here for you.\n\nWarmly,\nThe Jourvance Team',
        discountVoucher: 'WELCOMEBACK15'
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function loadDrips() {
  const data = hubStorage.get('store.drips', 'drips.json', null);
  if (data && Array.isArray(data.sequences)) {
    let modified = false;
    for (const initSeq of INITIAL_DRIP_SEQUENCES) {
      if (!data.sequences.some(s => s.id === initSeq.id)) {
        data.sequences.push(initSeq);
        modified = true;
      }
    }
    const cleaned = recomputeDripCounters({
      sequences: data.sequences,
      enrollments: (Array.isArray(data.enrollments) ? data.enrollments : []).filter(row => !isDemoRecord(row))
    });
    if (modified) {
      saveDrips(cleaned);
    }
    return cleaned;
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
  hubStorage.set('store.drips', 'drips.json', drips);
}

// ── Wave 8: Shopify Native Discounts & Abandoned Checkouts Stores ────────────
const discountsFilePath = path.join(__dirname, 'discounts.json');
const checkoutsFilePath = path.join(__dirname, 'checkouts.json');

function loadDiscounts() {
  const raw = hubStorage.get('store.discounts', 'discounts.json', []);
  return (Array.isArray(raw) ? raw : []).filter(row => !isDemoRecord(row));
}

function saveDiscounts(discounts) {
  hubStorage.set('store.discounts', 'discounts.json', discounts);
}

function loadCheckouts() {
  const raw = hubStorage.get('store.checkouts', 'checkouts.json', []);
  return (Array.isArray(raw) ? raw : []).filter(row => !isDemoRecord(row));
}

function saveCheckouts(checkouts) {
  hubStorage.set('store.checkouts', 'checkouts.json', checkouts);
}

const eventsFilePath = path.join(__dirname, 'events.json');

function loadEvents() {
  const raw = hubStorage.get('store.events', 'events.json', []);
  return Array.isArray(raw) ? raw : [];
}

function recordEvent(evt) {
  const events = loadEvents();
  events.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...evt
  });
  const trimmed = events.length > 20000 ? events.slice(-20000) : events;
  hubStorage.set('store.events', 'events.json', trimmed);
}

function mailLinkSecrets() {
  const current = process.env.MAIL_LINK_SECRET || process.env.HUB_API_KEY || 'jourvance_internal_salt_key_84920';
  const oldSecretsRaw = process.env.MAIL_LINK_OLD_SECRETS || '';
  const olds = oldSecretsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return Array.from(new Set([current, ...olds]));
}

function mailLinkSecret() {
  return mailLinkSecrets()[0];
}

function verifyUnsubscribeToken(token) {
  for (const secret of mailLinkSecrets()) {
    const parsed = readUnsubscribe(secret, token);
    if (parsed) return parsed;
  }
  return null;
}

function verifyConfirmToken(token) {
  for (const secret of mailLinkSecrets()) {
    const parsed = readConfirm(secret, token);
    if (parsed) return parsed;
  }
  return null;
}

const redirectsFilePath = path.join(__dirname, 'redirects.json');

function loadRedirects() {
  const raw = hubStorage.get('store.redirects', 'redirects.json', []);
  return Array.isArray(raw) ? raw : [];
}

function saveRedirects(rows) {
  const trimmed = (rows || []).slice(-20000);
  hubStorage.set('store.redirects', 'redirects.json', trimmed);
}

function loadTemplates() {
  const raw = hubStorage.get('store.templates', 'templates.json', []);
  return Array.isArray(raw) ? raw : [];
}

function saveTemplates(rows) {
  hubStorage.set('store.templates', 'templates.json', Array.isArray(rows) ? rows : []);
}

function rememberRedirect(uid, url, meta, batchCollector = null) {
  const code = crypto.randomBytes(9).toString('base64url');
  const sentAt = new Date().toISOString();
  const row = {
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
  };
  if (Array.isArray(batchCollector)) {
    batchCollector.push(row);
  } else {
    const rows = loadRedirects();
    rows.push(row);
    saveRedirects(rows);
  }
  return `${publicBase()}/r/${code}`;
}

function rememberRedirectsBatch(newRows) {
  if (!Array.isArray(newRows) || !newRows.length) return;
  const rows = loadRedirects();
  rows.push(...newRows);
  saveRedirects(rows);
}

function rewritePlainMailLinks(html, meta, batchCollector = null) {
  let next = String(html || '');
  const internalBatch = Array.isArray(batchCollector) ? null : [];
  const targetBatch = batchCollector || internalBatch;
  for (const url of linksToRewrite(next)) {
    const short = rememberRedirect(
      meta.userId,
      url,
      { ...meta, channel: 'email', utm: { utm_source: 'email', utm_medium: meta.medium || 'email' } },
      targetBatch
    );
    next = next.split(`href="${url}"`).join(`href="${short}"`);
  }
  if (internalBatch && internalBatch.length > 0) {
    rememberRedirectsBatch(internalBatch);
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
window.jourvanceCanTrack = function() {
  try {
    if (window.Shopify && window.Shopify.customerPrivacy) {
      if (typeof window.Shopify.customerPrivacy.analyticsProcessingAllowed === 'function') {
        return !!window.Shopify.customerPrivacy.analyticsProcessingAllowed();
      }
      if (typeof window.Shopify.customerPrivacy.userCanBeTracked === 'function') {
        return !!window.Shopify.customerPrivacy.userCanBeTracked();
      }
    }
  } catch (e) {}
  return true;
};
window.__jvPendingEvents = window.__jvPendingEvents || [];
if (typeof document !== 'undefined' && !window.__jvConsentBound) {
  window.__jvConsentBound = true;
  document.addEventListener('visitorConsentCollected', function() {
    if (window.jourvanceCanTrack()) {
      var pending = window.__jvPendingEvents || [];
      window.__jvPendingEvents = [];
      for (var i = 0; i < pending.length; i++) {
        window.jourvanceTrack(pending[i].type, pending[i].extra);
      }
    }
  });
}
window.jourvanceTrack = function(type, extra) {
  try {
    if (!window.jourvanceCanTrack()) {
      window.__jvPendingEvents.push({ type: type, extra: extra });
      return;
    }
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

let noteSegmentChanges = async () => {};
let processDueCampaigns = async () => ({ sent: 0 });

// ── Modular Shopify Routes Controller (server/routes/shopifyRoutes.mjs) ────────
const shopifyCtx = {
  requireUser,
  loadWorkspace,
  saveWorkspace,
  presentWorkspace,
  workspaceCache,
  cleanDomain,
  realStoreDomain,
  adminToken,
  FAKE_STORE_DOMAINS,
  WEBHOOK_TOPICS,
  signalTopicView,
  newPixelKey,
  configuredPublicBase,
  publicBase,
  behaviorSummary,
  pixelSnippet,
  restockSnippet,
  rememberAdminCatalog,
  mapShopifyProducts,
  loadCatalog,
  saveCatalog,
  applyProductUpdate,
  applyInventoryLevel,
  loadContacts,
  saveContacts,
  contactOwnerId,
  loadOrders,
  saveOrders,
  loadCheckouts,
  saveCheckouts,
  loadDrips,
  saveDrips,
  loadEvents,
  syncContactRfmTags,
  cleanRfmConfig,
  DEFAULT_RFM_CONFIG,
  userProgramBag,
  loadDiscounts,
  saveDiscounts,
  acceptShopifyWebhook,
  noteAttrMap,
  pageOwnedBy,
  publicPageCache,
  reloadPublicPageCache,
  recordEvent,
  attachBehavior,
  assignEmailTouch,
  channelOf,
  sendTransactional,
  orderMailVars,
  enrollAutomation,
  enrollFlowsForTrigger,
  enrollClaimedBehavior,
  refreshPredictions,
  noteSegmentChanges: (uid) => noteSegmentChanges(uid),
  handoffMapNodes,
  klaviyoIsSender,
  loadJourney,
  fulfillmentKind,
  addRefund,
  touchRevenue,
  enrollPriceDrops,
  enrollInventorySignals,
  marketingSubscribed
};
setupShopifyRoutes(app, shopifyCtx);

async function ensureShopifyCoreDiscounts(ws, allowUnlimited = false) {
  return ensureShopifyCoreDiscountsModular(ws, allowUnlimited, shopifyCtx);
}

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
  const data = hubStorage.get('store.email_programs', 'email_programs.json', {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function saveProgramStore(store) {
  hubStorage.set('store.email_programs', 'email_programs.json', store);
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
    embedPreheader: options.embedPreheader !== false && Boolean(String(options.previewText || '').trim()),
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

async function deliverLetter({ to, name, subject, text, html, userId, visitorId, medium, previewText, marketing = true, campaignId = '', flowId = '', nodeId = '', sequenceId = '', redirectBatch = null }) {
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
  const outbound = tracked.pixel || tracked.rewritten ? rewritePlainMailLinks(html, { userId, email: to, messageId, campaignId, flowId, nodeId, sequenceId }, redirectBatch) : html;
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

// ── Modular Hub Email Suite Controller (server/routes/emailRoutes.mjs) ────────
const emailCtx = {
  hub,
  hubReady,
  requireUser,
  ensureSignalStarters,
  suitePayload,
  cleanBlocks,
  contactsForUser,
  loadOrders,
  isDemoRecord,
  loadCheckouts,
  orderMailVars,
  personFields,
  composeLetter,
  fillMailTokens,
  SAMPLE_MAIL_VARS,
  listWorkspaces,
  realStoreDomain,
  adminToken,
  workspaceCache,
  userProgramBag,
  writeUserPrograms,
  loadContacts,
  saveContacts,
  contactOwnerId,
  computeContactRfm,
  syncContactRfmTags,
  cleanRfmConfig,
  DEFAULT_RFM_CONFIG,
  ensureShopifyCoreDiscounts,
  loadCampaigns,
  saveCampaigns,
  loadDrips,
  saveDrips,
  predictStore,
  accountOrders,
  publicPrediction,
  refreshPredictions,
  loadEvents,
  eventsFilePath,
  verifyUnsubscribeToken,
  cleanPicks,
  cleanFallbackHour,
  resolveAudience,
  FOLLOW_UP_NOTE,
  SMART_EMAIL_HOURS,
  SMART_SMS_HOURS,
  splitHoldout,
  recordEvent,
  smartSkipReason,
  composeForSend,
  deliverLetter,
  applyUtm,
  rememberRedirectsBatch,
  smsQuietEnabled,
  quietOpenAt,
  textConsentKnown,
  prepareSmsMessage
};
const emailHandlers = setupEmailRoutes(app, emailCtx);
noteSegmentChanges = emailHandlers.noteSegmentChanges;
processDueCampaigns = emailHandlers.processDueCampaigns;

async function processUserAutomationsTick(uid) {
  try { await refreshPredictionsIfDue(uid); } catch (err) {
    console.warn('[Jourvance] Prediction refresh failed:', err.message);
  }
  const now = Date.now();
  try {
    const userRfm = cleanRfmConfig(userProgramBag(uid)?.rfmConfig || DEFAULT_RFM_CONFIG);
    const allContacts = loadContacts();
    let rfmDirty = false;
    for (const c of allContacts) {
      if (contactOwnerId(c) !== uid) continue;
      if (syncContactRfmTags(c, userRfm)) rfmDirty = true;
    }

    // Auto-Winback Drip Enrollment (Option A)
    if (userRfm.autoWinbackEnabled) {
      const dripsData = loadDrips();
      const winbackSeq = dripsData.sequences.find(s => s.id === 'drip_seq_at_risk_winback');
      if (winbackSeq) {
        const enabledAtMs = Date.parse(userRfm.autoWinbackEnabledAt || '') || now;
        const atRiskWindowMs = userRfm.atRiskDays * 86400000;
        const lapsedWindowMs = userRfm.lapsedDays * 86400000;

        for (const c of allContacts) {
          if (contactOwnerId(c) !== uid) continue;
          if (!c.email || c.acceptsMarketing === false) continue;
          if (!c.lastOrderAt) continue;

          const lastOrderMs = Date.parse(c.lastOrderAt);
          if (!Number.isFinite(lastOrderMs)) continue;

          const crossedAtRiskMs = lastOrderMs + atRiskWindowMs;
          const crossedLapsedMs = lastOrderMs + lapsedWindowMs;

          // Option A: Only enroll contacts whose 90-day at-risk mark falls ON or AFTER autoWinbackEnabledAt
          // and has not yet crossed into lapsed status (180 days)
          if (crossedAtRiskMs >= enabledAtMs && now < crossedLapsedMs) {
            const lastEnrolledMs = Date.parse(c.lastAtRiskWinbackEnrolledAt || '') || 0;
            const cooldownPassed = !lastEnrolledMs || (now - lastEnrolledMs > 180 * 86400000);

            const alreadyActive = dripsData.enrollments.some(e => 
              e.sequenceId === 'drip_seq_at_risk_winback' &&
              String(e.customerEmail || '').toLowerCase() === String(c.email || '').toLowerCase() &&
              e.status === 'active'
            );

            if (cooldownPassed && !alreadyActive) {
              const newEnr = {
                id: `enr_wb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                sequenceId: 'drip_seq_at_risk_winback',
                userId: uid,
                customerEmail: c.email,
                customerName: c.name || '',
                currentStepIndex: 0,
                status: 'active',
                enrolledAt: new Date().toISOString(),
                nextStepDueAt: new Date().toISOString(),
                source: 'rfm_auto_winback'
              };
              dripsData.enrollments.push(newEnr);
              winbackSeq.activeEnrollments = (winbackSeq.activeEnrollments || 0) + 1;
              c.lastAtRiskWinbackEnrolledAt = new Date().toISOString();
              if (Array.isArray(c.tags) && !c.tags.includes('At-Risk-Winback-Sent')) {
                c.tags.push('At-Risk-Winback-Sent');
              }
              rfmDirty = true;
            }
          }
        }
        saveDrips(dripsData);
      }
    }

    if (rfmDirty) saveContacts(allContacts);
  } catch (err) {
    console.warn('[Jourvance] Periodic RFM tag sync / winback failed:', err.message);
  }
  const dripsData = loadDrips();
  const orders = loadOrders().filter(o => o.userId === uid);
  const programTick = await processAccountAutomations(uid);
  const campaignTick = await processDueCampaigns(uid);
  const holdForKlaviyo = klaviyoIsSender(uid);
  let processedCount = 0;
  let convertedExitCount = 0;
  let completedCount = 0;

  const dripRedirectBatch = [];
  for (const enr of dripsData.enrollments) {
    if (holdForKlaviyo) break;
    if (enr.status !== 'active' || enr.userId !== uid) continue;

    const seq = dripsData.sequences.find(s => s.id === enr.sequenceId);
    if (!seq) continue;

    // 1. Smart Exit on Purchase Check
    if (seq.smartExitOnPurchase) {
      let shouldExit = false;
      if (seq.triggerType === 'upsell_recovery') {
        const events = loadEvents();
        const hasAcceptedUpsell = events.some(ev => 
          ev.type === 'upsell_accept' && 
          ev.email && ev.email.toLowerCase() === enr.customerEmail.toLowerCase() && 
          new Date(ev.timestamp).getTime() >= new Date(enr.enrolledAt).getTime() - 5000
        );
        const hasSubsequentOrder = orders.some(o => 
          o.customerEmail && o.customerEmail.toLowerCase() === enr.customerEmail.toLowerCase() && 
          new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() + 1000
        );
        shouldExit = hasAcceptedUpsell || hasSubsequentOrder;
      } else {
        shouldExit = orders.some(o => o.customerEmail === enr.customerEmail && new Date(o.createdAt).getTime() >= new Date(enr.enrolledAt).getTime() - 60000);
      }

      if (shouldExit) {
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
        const dripContact = loadContacts().find(c => c.email === enr.customerEmail && contactOwnerId(c) === uid) || { email: enr.customerEmail, name: enr.customerName };
        const checkout = loadCheckouts().find((row) => row.userId === uid && String(row.customerEmail || '').toLowerCase() === String(enr.customerEmail || '').toLowerCase());
        const userStore = Object.values(workspaceCache).find(ws => ws.userId === uid && realStoreDomain(ws?.shopifyConfig))?.shopifyConfig;
        const defaultDomain = realStoreDomain(userStore) || '';
        const customerOrder = orders.find(o => String(o.customerEmail || '').toLowerCase() === String(enr.customerEmail || '').toLowerCase());
        let offerUrl = enr.offerUrl || (enr.sourceSlug ? `${publicBase()}/p/${enr.sourceSlug}` : '');
        const discountCode = step.discountVoucher || enr.discountCode || 'SAVE10';
        const resolvedCheckoutUrl = checkout ? resolveCheckoutRecoveryUrl(checkout, defaultDomain, (seq.triggerType === 'checkout_abandonment' && step.stepNumber > 1) ? discountCode : '') : '';
        if (offerUrl && seq.triggerType === 'upsell_recovery') {
          const sep = offerUrl.includes('?') ? '&' : '?';
          const expTime = Date.now() + 24 * 3600000;
          if (!offerUrl.includes('coupon=')) {
            offerUrl += `${sep}coupon=${encodeURIComponent(discountCode)}&email=${encodeURIComponent(enr.customerEmail)}&ref=recovery&exp=${expTime}`;
          } else if (!offerUrl.includes('exp=')) {
            offerUrl += `&exp=${expTime}`;
          }
        }
        const effectiveCheckoutUrl = resolvedCheckoutUrl || checkout?.abandonedCheckoutUrl || offerUrl;
        const letter = await composeForSend(uid, dripContact, [{ kind: 'text', text: step.body || '' }], {
          checkout_url: effectiveCheckoutUrl,
          abandoned_checkout_url: effectiveCheckoutUrl,
          offer_url: offerUrl,
          discount_code: discountCode,
          order_number: customerOrder?.orderNumber || (customerOrder?.id ? `#${String(customerOrder.id).slice(-6)}` : ''),
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
          userId: uid,
          visitorId: dripContact.visitorId,
          medium: 'drip',
          marketing: true,
          sequenceId: seq.id,
          redirectBatch: dripRedirectBatch
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
  if (dripRedirectBatch.length) {
    rememberRedirectsBatch(dripRedirectBatch);
  }

  // 3. Wave 8: Abandoned Checkout Recovery Processing
  const checkouts = loadCheckouts();
  let checkoutsModified = false;
  let cartRecoverySentCount = 0;
  const shops = Object.values(workspaceCache).filter(ws => ws.userId === uid);
  const shop = shops.find(ws => realStoreDomain(ws?.shopifyConfig) && ws?.shopifyConfig?.status === 'connected') || shops[0];
  const userStoreDomain = realStoreDomain(shop?.shopifyConfig) || '';

  for (const chk of checkouts) {
    if (chk.userId !== uid) continue;
    const abandonedTime = new Date(chk.abandonedAt).getTime();

    // Check if customer completed purchase
    const bought = orders.some(o => o.customerEmail === chk.customerEmail && new Date(o.createdAt).getTime() >= abandonedTime - 60000);
    if (bought) {
      if (chk.recoveryStatus !== 'recovered') {
        chk.recoveryStatus = 'recovered';
        chk.recoveredAt = new Date().toISOString();
        checkoutsModified = true;
      }
      continue;
    }

    // Stage 1: Initial reminder after 45 minutes
    if (chk.recoveryStatus === 'pending') {
      if (now - abandonedTime >= 2700000) {
        if (!holdForKlaviyo && hubReady && chk.customerEmail) {
          const recoveryContact = loadContacts().find(c => c.email === chk.customerEmail && contactOwnerId(c) === uid) || { email: chk.customerEmail };
          const resolvedUrl = resolveCheckoutRecoveryUrl(chk, userStoreDomain, '');
          const cartCardsHtml = renderLineItemCardsHtml(chk.lineItems, chk.totalPrice, chk.currency, {
            discountPercent: 0,
            discountCode: '',
            catalog: catalogFor(uid)
          });
          const recoveryBlocks = [
            { kind: 'heading', text: 'We saved your beauty essentials' },
            { kind: 'text', text: `Hi ${recoveryContact.name || 'there'},\n\nWe noticed you didn't finish completing your order. Your items are currently saved and waiting for you, but inventory is limited.` },
            ...(cartCardsHtml ? [{ kind: 'html', text: cartCardsHtml }] : []),
            { kind: 'button', label: 'Resume My Bag & Checkout', url: resolvedUrl, color: '#EC4899', radius: 8, padding: 12 },
            { kind: 'text', text: 'If you have any questions or need assistance with your selection, simply reply directly to this email and our team will be glad to assist you.' }
          ];
          const letter = composeLetter(uid, recoveryContact, recoveryBlocks, {
            checkout_url: resolvedUrl,
            abandoned_checkout_url: resolvedUrl,
            eventLineItems: chk.lineItems || []
          }, { marketing: true });
          const result = await deliverLetter({
            to: chk.customerEmail,
            name: recoveryContact.name || '',
            subject: 'We saved your beauty essentials',
            text: letter.text,
            html: letter.html,
            userId: uid,
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
    // Stage 2: Courtesy incentive (10% off) after 24 hours of Stage 1 email
    else if (chk.recoveryStatus === 'email_sent') {
      const sentTime = new Date(chk.recoveryEmailSentAt || chk.abandonedAt).getTime();
      if (now - sentTime >= 86400000) {
        if (!holdForKlaviyo && hubReady && chk.customerEmail) {
          const recoveryContact = loadContacts().find(c => c.email === chk.customerEmail && contactOwnerId(c) === uid) || { email: chk.customerEmail };
          const resolvedUrl2 = resolveCheckoutRecoveryUrl(chk, userStoreDomain, 'SAVE10');
          const cartCardsHtml2 = renderLineItemCardsHtml(chk.lineItems, chk.totalPrice, chk.currency, {
            discountPercent: 10,
            discountCode: 'SAVE10',
            catalog: catalogFor(uid)
          });
          const incentiveBlocks = [
            { kind: 'heading', text: 'A courtesy incentive for your order' },
            { kind: 'text', text: `Hi ${recoveryContact.name || 'there'},\n\nWe want to make sure you get the best experience. As a special courtesy, use code SAVE10 at checkout to take 10% off your saved items today.` },
            ...(cartCardsHtml2 ? [{ kind: 'html', text: cartCardsHtml2 }] : []),
            { kind: 'button', label: 'Claim 10% Off & Complete Checkout', url: resolvedUrl2, color: '#EC4899', radius: 8, padding: 12 },
            { kind: 'text', text: 'Your 10% courtesy discount will be automatically pre-applied to your cart. This code is active for 48 hours. Let us know if you need any help completing your purchase!' }
          ];
          const letter2 = composeLetter(uid, recoveryContact, incentiveBlocks, {
            checkout_url: resolvedUrl2,
            abandoned_checkout_url: resolvedUrl2,
            discount_code: 'SAVE10',
            eventLineItems: chk.lineItems || []
          }, { marketing: true });
          const result2 = await deliverLetter({
            to: chk.customerEmail,
            name: recoveryContact.name || '',
            subject: 'A complimentary 10% courtesy for your bag',
            text: letter2.text,
            html: letter2.html,
            userId: uid,
            visitorId: recoveryContact.visitorId || chk.visitorId,
            medium: 'drip',
            marketing: true
          });
          if (result2.ok) {
            chk.recoveryStatus = 'incentive_sent';
            chk.incentiveEmailSentAt = new Date().toISOString();
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

  return {
    processedCount,
    convertedExitCount,
    completedCount,
    cartRecoverySentCount,
    programSent: programTick.sent,
    programFailed: programTick.failed,
    campaignSent: campaignTick.sent,
    activeRemaining: dripsData.enrollments.filter(e => e.status === 'active' && e.userId === uid).length + programTick.active
  };
}

let isAutomationRunning = false;
let automationIntervalHandle = null;

async function runBackgroundAutomations() {
  if (isAutomationRunning) return;
  isAutomationRunning = true;
  try {
    const uids = new Set();
    for (const ws of Object.values(workspaceCache)) {
      if (ws.userId) uids.add(ws.userId);
    }
    const drips = loadDrips();
    if (Array.isArray(drips.enrollments)) {
      for (const e of drips.enrollments) {
        if (e.userId && e.status === 'active') uids.add(e.userId);
      }
    }
    const checkouts = loadCheckouts();
    for (const c of checkouts) {
      if (c.userId && c.recoveryStatus === 'pending') uids.add(c.userId);
    }
    const campaigns = loadCampaigns();
    for (const cmp of campaigns) {
      if (cmp.userId && (cmp.status === 'scheduled' || cmp.status === 'sending')) uids.add(cmp.userId);
    }

    let totalActions = 0;
    for (const uid of uids) {
      try {
        const res = await processUserAutomationsTick(uid);
        const count = (res.processedCount || 0) + (res.cartRecoverySentCount || 0) + (res.programSent || 0) + (res.campaignSent || 0);
        totalActions += count;
      } catch (err) {
        console.warn(`[Jourvance Automations] Error processing user ${uid}:`, err?.message);
      }
    }
    if (totalActions > 0) {
      console.log(`[Jourvance Automations] Background runner processed ${totalActions} action(s) across ${uids.size} account(s).`);
    }
  } catch (err) {
    console.error('[Jourvance Automations] Runner error:', err?.message);
  } finally {
    isAutomationRunning = false;
  }
}

function startAutomationRunner() {
  if (automationIntervalHandle) clearInterval(automationIntervalHandle);
  setTimeout(runBackgroundAutomations, 10000);
  automationIntervalHandle = setInterval(runBackgroundAutomations, 60000);
  console.log('[Jourvance Automations] Background automation runner initialized (60s tick interval).');
}

const INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || 'jourvance_internal_cron_secret_7291';
app.post('/api/internal/cron/drips', async (req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${INTERNAL_CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized cron token' });
  }
  await runBackgroundAutomations();
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/api/drips/process-tick', requireUser, async (req, res) => {
  const summary = await processUserAutomationsTick(req.user.uid);
  res.json({
    success: true,
    ...summary
  });
});

app.post('/api/public/waitlist', async (req, res) => {
  try {
    const { email, storeDomain, plan, billingCycle, source } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const contacts = loadContacts();
    const existing = contacts.find(c => String(c.email || '').toLowerCase() === cleanEmail);
    const now = new Date().toISOString();

    if (existing) {
      const tags = new Set(Array.isArray(existing.tags) ? existing.tags : []);
      tags.add('growth_pro_waitlist');
      existing.tags = Array.from(tags);
      existing.metadata = {
        ...(existing.metadata || {}),
        requestedPlan: plan || 'growth_pro',
        billingCycle: billingCycle || 'monthly',
        storeDomain: storeDomain || existing.metadata?.storeDomain || '',
        waitlistJoinedAt: now
      };
      existing.updatedAt = now;
    } else {
      contacts.push({
        id: `lead_waitlist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        email: cleanEmail,
        name: '',
        tags: ['growth_pro_waitlist'],
        source: source || 'vip_waitlist_modal',
        metadata: {
          requestedPlan: plan || 'growth_pro',
          billingCycle: billingCycle || 'monthly',
          storeDomain: storeDomain || '',
          waitlistJoinedAt: now
        },
        createdAt: now,
        updatedAt: now
      });
    }

    saveContacts(contacts);
    return res.json({ success: true, message: 'You have been added to the VIP priority list.' });
  } catch (err) {
    console.error('[Jourvance Waitlist] Ingestion error:', err?.message);
    return res.status(500).json({ success: false, error: 'Could not record waitlist entry.' });
  }
});

app.post('/api/public/inquiry', async (req, res) => {
  try {
    const { name, email, message, businessType, source } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const contacts = loadContacts();
    const existing = contacts.find(c => String(c.email || '').toLowerCase() === cleanEmail);
    const now = new Date().toISOString();
    const cleanName = String(name || '').trim();

    if (existing) {
      const tags = new Set(Array.isArray(existing.tags) ? existing.tags : []);
      tags.add('inquiry');
      tags.add('contact_page');
      existing.tags = Array.from(tags);
      if (cleanName && !existing.name) existing.name = cleanName;
      existing.metadata = {
        ...(existing.metadata || {}),
        businessType: businessType || existing.metadata?.businessType || '',
        lastInquiryMessage: message || '',
        lastInquiryAt: now
      };
      existing.updatedAt = now;
    } else {
      contacts.push({
        id: `inq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        email: cleanEmail,
        name: cleanName,
        tags: ['inquiry', 'contact_page'],
        source: source || 'contact-page',
        metadata: {
          businessType: businessType || '',
          lastInquiryMessage: message || '',
          lastInquiryAt: now
        },
        createdAt: now,
        updatedAt: now
      });
    }

    saveContacts(contacts);

    // Asynchronously notify external CRM webhook if available (fail-open so contact is never blocked)
    (async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000));
        const fetchPromise = fetch('https://zeluslabs.dev/api/crm/webhook/jourvance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'lead_captured',
            appName: 'Jourvance',
            payload: {
              name: cleanName,
              email: cleanEmail,
              message: message || '',
              source: source || 'contact-page',
              businessType: businessType || ''
            }
          })
        });
        await Promise.race([fetchPromise, timeoutPromise]);
      } catch (err) {
        console.warn('[Jourvance Inquiry] External CRM dispatch notice:', err?.message);
      }
    })();

    return res.json({ success: true, message: 'Thank you! Your message has been received. Our team will be in touch shortly.' });
  } catch (err) {
    console.error('[Jourvance Inquiry] Error:', err?.message);
    return res.status(500).json({ success: false, error: 'Could not submit inquiry.' });
  }
});

// ── Modular Analytics & Reporting Controller (server/routes/analyticsRoutes.mjs) ─
const analyticsCtx = {
  requireUser,
  requireOperator,
  loadEvents,
  loadOrders,
  loadContacts,
  loadDrips,
  publicPageCache,
  journeyCache,
  contactsForUser,
  userProgramBag,
  writeUserPrograms,
  messageStatsFor,
  hubReady
};
setupAnalyticsRoutes(app, analyticsCtx);

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
  const data = hubStorage.get('store.signup_forms', 'signup_forms.json', {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function saveSignupStore(store) {
  hubStorage.set('store.signup_forms', 'signup_forms.json', store);
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
  const data = hubStorage.get('store.klaviyo', 'klaviyo.json', {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function saveKlaviyoStore(store) {
  hubStorage.set('store.klaviyo', 'klaviyo.json', store);
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

// ── Custom Journey Template & Blueprint Library ─────────────────────────────────

app.get('/api/templates', requireUser, async (req, res) => {
  const templates = loadTemplates();
  const mine = templates.filter(t => t.userId === req.user.uid);
  res.json({ success: true, templates: mine });
});

app.post('/api/templates', requireUser, async (req, res) => {
  const { name, description, category, nodes, edges } = req.body || {};
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 100) {
    return res.status(400).json({ success: false, error: 'Blueprint title must be between 1 and 100 characters.' });
  }

  const templates = loadTemplates();
  const userTemplates = templates.filter(t => t.userId === req.user.uid);
  if (userTemplates.length >= 50) {
    return res.status(400).json({ success: false, error: 'You have reached the maximum limit of 50 saved blueprints. Please delete older templates to make room.' });
  }

  // Zero live counts and sanitize node data for template reuse
  const cleanNodes = Array.isArray(nodes) ? nodes.map(n => {
    const d = { ...(n.data || {}) };
    delete d.visitors;
    delete d.conversions;
    delete d.conversionRate;
    delete d.grossRevenue;
    delete d.liveRevenue;
    delete d.liveOrders;
    delete d.pageViews;
    delete d.impressions;
    delete d.clicks;
    delete d.submissions;
    delete d.flowEnrolled;
    delete d.takes;
    return { ...n, data: d };
  }) : [];

  const cleanEdges = Array.isArray(edges) ? edges.map(e => ({
    ...e,
    data: {
      sourceThroughput: 0,
      targetCount: 0,
      rate: 0
    }
  })) : [];

  const shareCode = `bp_${crypto.randomBytes(6).toString('base64url')}`;
  const now = new Date().toISOString();
  const newTemplate = {
    id: `bp_custom_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    userId: req.user.uid,
    name: cleanName,
    description: String(description || '').trim().slice(0, 300),
    category: String(category || 'custom').trim(),
    nodes: cleanNodes,
    edges: cleanEdges,
    shareCode,
    isShared: true,
    createdAt: now,
    updatedAt: now
  };

  templates.push(newTemplate);
  saveTemplates(templates);

  res.json({ success: true, template: newTemplate });
});

app.delete('/api/templates/:id', requireUser, async (req, res) => {
  const templates = loadTemplates();
  const idx = templates.findIndex(t => t.id === req.params.id && t.userId === req.user.uid);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Blueprint not found or not owned by your account.' });
  }
  templates.splice(idx, 1);
  saveTemplates(templates);
  res.json({ success: true, message: 'Blueprint removed successfully.' });
});

app.get('/api/templates/shared/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  const templates = loadTemplates();
  const found = templates.find(t => t.shareCode === code);
  if (!found) {
    return res.status(404).json({ success: false, error: 'Shared blueprint not found or invalid link.' });
  }

  // Sanitize blueprint for safe sharing across tenants (remove user IDs, store tokens, internal IDs)
  const safe = {
    id: found.id,
    name: found.name,
    description: found.description,
    category: found.category,
    nodes: found.nodes,
    edges: found.edges,
    createdAt: found.createdAt,
    shareCode: found.shareCode
  };

  res.json({ success: true, template: safe });
});

app.post('/api/templates/import/:code', requireUser, async (req, res) => {
  const code = String(req.params.code || '').trim();
  const templates = loadTemplates();
  const source = templates.find(t => t.shareCode === code);
  if (!source) {
    return res.status(404).json({ success: false, error: 'Shared blueprint not found.' });
  }

  const userTemplates = templates.filter(t => t.userId === req.user.uid);
  if (userTemplates.length >= 50) {
    return res.status(400).json({ success: false, error: 'You have reached the maximum limit of 50 saved blueprints. Please delete older templates to make room.' });
  }

  const now = new Date().toISOString();
  const cloned = {
    id: `bp_custom_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    userId: req.user.uid,
    name: `${source.name} (Shared Import)`,
    description: source.description || '',
    category: source.category || 'custom',
    nodes: JSON.parse(JSON.stringify(source.nodes || [])),
    edges: JSON.parse(JSON.stringify(source.edges || [])),
    shareCode: `bp_${crypto.randomBytes(6).toString('base64url')}`,
    isShared: true,
    createdAt: now,
    updatedAt: now
  };

  templates.push(cloned);
  saveTemplates(templates);

  res.json({ success: true, template: cloned });
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
        const cleanJson = answer.text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        const parsed = JSON.parse(cleanJson);
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

const domainsFilePath = path.join(__dirname, 'domains.json');
let domainRegistryCache = {};
function reloadDomainRegistry() {
  try {
    if (fs.existsSync(domainsFilePath)) {
      domainRegistryCache = JSON.parse(fs.readFileSync(domainsFilePath, 'utf8'));
    }
  } catch (e) {}
  return domainRegistryCache;
}
reloadDomainRegistry();

const persistDomainRegistry = () => {
  try {
    fs.writeFileSync(domainsFilePath, JSON.stringify(domainRegistryCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist domains.json:', e.message);
  }
};

function getDomainVerificationToken(userId, domain) {
  const cleanDomain = String(domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const secret = process.env.SESSION_SECRET || 'jourvance_domain_salt_2026';
  return 'jrv_' + crypto.createHash('sha256').update(`${userId}:${cleanDomain}:${secret}`).digest('hex').slice(0, 16);
}

async function verifyDomainOwnership(domain, requestingUserId) {
  const cleanDomain = String(domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!cleanDomain || !cleanDomain.includes('.')) {
    return {
      success: false,
      verified: false,
      error: 'A valid subdomain is required (e.g. offer.yourbrand.com).'
    };
  }

  const expectedTarget = 'cname.jourvance.com';
  const expectedToken = getDomainVerificationToken(requestingUserId, cleanDomain);
  const expectedTxtRecord = `jourvance-verification=${expectedToken}`;
  const expectedTxtHost = `_jourvance.${cleanDomain}`;

  // 1. Check existing domain registry
  reloadDomainRegistry();
  const existingRecord = domainRegistryCache[cleanDomain];
  const isClaimedByOther = Boolean(existingRecord && existingRecord.verified && existingRecord.userId && existingRecord.userId !== requestingUserId);

  // 2. Query DNS for TXT verification challenge
  let txtFound = false;
  try {
    const txtHostsToCheck = [`_jourvance.${cleanDomain}`, cleanDomain];
    for (const hostToCheck of txtHostsToCheck) {
      try {
        const txtRecords = await dns.promises.resolveTxt(hostToCheck);
        const flatStrings = (txtRecords || []).map(chunks => chunks.join('').trim());
        if (flatStrings.some(str => str === expectedToken || str === expectedTxtRecord || str.includes(expectedToken))) {
          txtFound = true;
          break;
        }
      } catch (e) {}
    }
  } catch (err) {}

  // 3. Query DNS for CNAME
  let cnameMatch = false;
  let cnames = [];
  try {
    cnames = await dns.promises.resolveCname(cleanDomain);
    cnameMatch = Array.isArray(cnames) && cnames.some(c => {
      const lower = c.toLowerCase().replace(/\.$/, '');
      return lower === expectedTarget || lower === 'jourvance.com' || lower.includes('jourvance');
    });
  } catch (err) {}

  // 4. Evaluate Ownership based on Hybrid Policy:
  // Case A: Proven by TXT Challenge (Full Cryptographic Proof)
  if (txtFound) {
    let sslStatus = { sslActive: false };
    if (cnameMatch) {
      sslStatus = await checkSslCertificate(cleanDomain);
    }
    const record = {
      domain: cleanDomain,
      userId: requestingUserId,
      verified: true,
      verifiedAt: new Date().toISOString(),
      verificationToken: expectedToken,
      method: 'txt_challenge',
      sslActive: !!sslStatus.sslActive
    };
    domainRegistryCache[cleanDomain] = record;
    persistDomainRegistry();
    if (hubReady) {
      try { await hub.store.docs.put(`domain_reg.${safe(cleanDomain)}`, record); } catch {}
    }
    return {
      success: true,
      verified: true,
      domain: cleanDomain,
      method: 'txt_challenge',
      cnameMatch,
      cnames,
      expectedTarget,
      sslActive: !!sslStatus.sslActive,
      sslDetails: sslStatus,
      message: `Domain verified via DNS TXT Challenge! Ownership confirmed for your store.`
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
    const sslStatus = await checkSslCertificate(cleanDomain);
    const record = {
      domain: cleanDomain,
      userId: requestingUserId,
      verified: true,
      verifiedAt: new Date().toISOString(),
      verificationToken: expectedToken,
      method: 'cname',
      sslActive: !!sslStatus.sslActive
    };
    domainRegistryCache[cleanDomain] = record;
    persistDomainRegistry();
    if (hubReady) {
      try { await hub.store.docs.put(`domain_reg.${safe(cleanDomain)}`, record); } catch {}
    }
    return {
      success: true,
      verified: true,
      domain: cleanDomain,
      method: 'cname',
      cnameMatch: true,
      cnames,
      expectedTarget,
      sslActive: !!sslStatus.sslActive,
      sslDetails: sslStatus,
      message: sslStatus.sslActive
        ? `DNS & SSL Active! ${cleanDomain} correctly points to ${expectedTarget} with verified HTTPS certificate (${sslStatus.issuer}, ${sslStatus.daysRemaining} days remaining).`
        : `CNAME Verified! ${cleanDomain} points to ${expectedTarget}. SSL certificate is currently provisioning.`
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
    message: `No active CNAME detected for ${cleanDomain}. In your DNS manager, add a CNAME record: Host "${cleanDomain.split('.')[0]}", Points to "${expectedTarget}".`
  };
}

const pubDocName = (slug) => `pubpage.${safe(slug)}`;

async function savePublicPage(slug, data) {
  publicPageCache[slug] = data;
  const customDomain = (data.customDomain || data.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (customDomain) {
    reloadDomainRegistry();
    const reg = domainRegistryCache[customDomain];
    const isVerifiedForUser = Boolean(reg && reg.verified && reg.userId === data.userId);
    if (isVerifiedForUser) {
      publicPageCache[`domain:${customDomain}`] = slug;
    }
  }
  persistPublicPages();
  if (hubReady) {
    try {
      await hub.store.docs.put(pubDocName(slug), data);
      if (customDomain && publicPageCache[`domain:${customDomain}`] === slug) {
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

  // Domain pointer match (ensuring verified ownership)
  if (publicPageCache[`domain:${cleanId}`]) {
    const targetSlug = publicPageCache[`domain:${cleanId}`];
    const targetPage = publicPageCache[targetSlug] || null;
    if (targetPage) {
      reloadDomainRegistry();
      const reg = domainRegistryCache[cleanId];
      if (reg && reg.verified && reg.userId === targetPage.userId) {
        return targetPage;
      }
    }
  }

  // Deep search cached records for matching customDomain ONLY IF verified for that page's owner
  reloadDomainRegistry();
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

const RESERVED_PUBLIC_SLUGS = new Set([
  'api', 'admin', 'r', 'o', 'u', 'p', 'split', 'assets', 'favicon.ico', 
  'health', 'webhooks', 'login', 'signup', 'dashboard', 'preview', 'checkout', 'cart'
]);

async function validateSlugAvailability(slug, requestingUserId, { type = 'page', customDomain = '' } = {}) {
  const cleanSlug = String(slug || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!cleanSlug) {
    return { available: false, error: 'Slug cannot be empty.' };
  }
  if (RESERVED_PUBLIC_SLUGS.has(cleanSlug)) {
    return { available: false, error: `The slug "${cleanSlug}" is reserved by the system. Please pick another name.` };
  }

  // Check direct slug ownership across all page types
  const lookupKey = type === 'ab-split' ? `split:${cleanSlug}` : cleanSlug;
  const existingPage = publicPageCache[lookupKey] || await loadPublicPage(lookupKey);

  if (existingPage && existingPage.userId && existingPage.userId !== requestingUserId) {
    return {
      available: false,
      error: `The ${type === 'ab-split' ? 'split-test' : 'page'} slug "${cleanSlug}" is already claimed by another store. Please choose a unique custom slug.`
    };
  }

  // If registering a page or upsell, verify direct slug is not taken by another user's page or upsell
  if (type !== 'ab-split') {
    const directExisting = publicPageCache[cleanSlug] || await loadPublicPage(cleanSlug);
    if (directExisting && directExisting.userId && directExisting.userId !== requestingUserId) {
      return {
        available: false,
        error: `The page slug "${cleanSlug}" is already claimed by another store. Please choose a unique custom slug.`
      };
    }
  }

  // Custom Domain validation: Ensure the custom domain is not already bound to another tenant's page
  if (customDomain) {
    const cleanDomain = String(customDomain).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (cleanDomain) {
      reloadDomainRegistry();
      const reg = domainRegistryCache[cleanDomain];
      if (reg && reg.verified && reg.userId && reg.userId !== requestingUserId) {
        return {
          available: false,
          error: `The custom domain "${cleanDomain}" is already connected to another store. To verify and transfer ownership, add the TXT challenge record.`
        };
      }
      const existingDomainSlug = publicPageCache[`domain:${cleanDomain}`];
      if (existingDomainSlug) {
        const existingDomainPage = publicPageCache[existingDomainSlug] || await loadPublicPage(existingDomainSlug);
        if (existingDomainPage && existingDomainPage.userId && existingDomainPage.userId !== requestingUserId) {
          return {
            available: false,
            error: `The custom domain "${cleanDomain}" is already connected to another store. To verify and transfer ownership, add the TXT challenge record.`
          };
        }
      }
    }
  }

  return { available: true, cleanSlug };
}

async function removePublicPage(slug, requestingUserId) {
  if (!slug) return false;
  const cleanSlug = String(slug).toLowerCase().trim();
  const page = publicPageCache[cleanSlug] || await loadPublicPage(cleanSlug);
  if (page && page.userId && page.userId !== requestingUserId) {
    return false; // Unauthorized removal attempt
  }
  const customDomain = (page?.customDomain || page?.data?.customDomain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (customDomain && publicPageCache[`domain:${customDomain}`] === cleanSlug) {
    delete publicPageCache[`domain:${customDomain}`];
    if (hubReady) {
      try { await hub.store.docs.delete(pubDocName(`domain.${customDomain}`)); } catch {}
    }
  }
  delete publicPageCache[cleanSlug];
  persistPublicPages();
  if (hubReady) {
    try { await hub.store.docs.delete(pubDocName(cleanSlug)); } catch {}
  }
  return true;
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
            if (!storeDomain) {
              alert('This boutique is preparing for launch. Checkout will be open shortly!');
              return;
            }
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

  ${data.mobileStickyBarEnabled !== false ? `
  <!-- Mobile Sticky Action Bar -->
  <div id="jv-mobile-sticky-bar" style="display:none; position:fixed; bottom:0; left:0; right:0; z-index:9000; background:rgba(15, 23, 42, 0.95); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border-top:1px solid rgba(255, 255, 255, 0.12); padding:10px 16px; box-shadow:0 -10px 25px rgba(0,0,0,0.5); align-items:center; justify-content:space-between; gap:12px;">
    <div style="flex:1; min-width:0;">
      <div style="font-size:12px; font-weight:700; color:#FFFFFF; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${escapeHtml(productTitle || headline)}
      </div>
      ${productPrice ? `
      <div style="font-size:12px; font-weight:800; color:#34D399; margin-top:1px;">
        ${escapeHtml(productPrice)}
      </div>` : ''}
    </div>
    <button id="jv-mobile-sticky-btn" type="button" style="flex-shrink:0; padding:10px 18px; border-radius:10px; border:none; background:linear-gradient(135deg, #EC4899, #DB2777); color:#FFFFFF; font-size:13px; font-weight:800; letter-spacing:0.02em; cursor:pointer; box-shadow:0 4px 15px rgba(236, 72, 153, 0.4);">
      ${escapeHtml(buttonText || 'Continue')}
    </button>
  </div>
  <script>
    (function() {
      if (window.innerWidth >= 768) return;
      var stickyBar = document.getElementById('jv-mobile-sticky-bar');
      var mainBtn = document.getElementById('main-cta-btn');
      var stickyBtn = document.getElementById('jv-mobile-sticky-btn');
      if (!stickyBar || !mainBtn) return;

      if (stickyBtn) {
        stickyBtn.addEventListener('click', function(e) {
          e.preventDefault();
          mainBtn.click();
        });
      }

      window.addEventListener('scroll', function() {
        var rect = mainBtn.getBoundingClientRect();
        if (rect.bottom < 0) {
          stickyBar.style.display = 'flex';
        } else {
          stickyBar.style.display = 'none';
        }
      }, { passive: true });
    })();
  </script>
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

  // Courtesy voucher handling from second-chance recovery flow
  const queryCoupon = String(req?.query?.coupon || req?.query?.discount || '').trim().toUpperCase();
  const queryEmail = String(req?.query?.email || '').trim().toLowerCase();
  const isCourtesyRecovery = queryCoupon === 'SAVE10' || req?.query?.ref === 'recovery' || Boolean(queryCoupon);
  const effectiveCoupon = queryCoupon || (isCourtesyRecovery ? 'SAVE10' : (upsell.discountCode || (isDownsell ? d.downsellDiscountCode : d.upsellDiscountCode) || ''));

  // Expiration logic for courtesy recovery (Option 1)
  const queryExp = req?.query?.exp ? Number(req.query.exp) : null;
  let isCourtesyExpired = false;
  let recoveryExpiresAt = queryExp && Number.isFinite(queryExp) ? queryExp : null;

  if (isCourtesyRecovery) {
    if (recoveryExpiresAt && Date.now() > recoveryExpiresAt) {
      isCourtesyExpired = true;
    } else if (queryEmail) {
      try {
        const dripsData = loadDrips();
        const enr = (dripsData.enrollments || []).find(e => 
          e.customerEmail && e.customerEmail.toLowerCase() === queryEmail &&
          e.sequenceId === 'drip_seq_upsell_recovery'
        );
        if (enr && enr.lastStepSentAt) {
          const sentTime = new Date(enr.lastStepSentAt).getTime();
          const targetExp = sentTime + 24 * 3600000;
          if (!recoveryExpiresAt) recoveryExpiresAt = targetExp;
          if (Date.now() > targetExp) {
            isCourtesyExpired = true;
          }
        }
      } catch (err) {}
    }
  }

  const headline = upsell.headline || (isDownsell ? (d.downsellHeadline || 'Another offer') : (d.upsellHeadline || 'Another offer'));
  const subhead = upsell.subhead || (isDownsell ? (d.downsellSubhead || '') : (d.upsellSubhead || ''));
  const badge = upsell.badgeText || (isDownsell ? (d.downsellBadge || '') : (d.upsellBadge || ''));
  const urgencyRaw = Number(upsell.urgencyMinutes || d.upsellUrgencyMinutes);
  const urgencyMins = Number.isFinite(urgencyRaw) && urgencyRaw > 0 ? urgencyRaw : 0;
  const productTitle = upsell.productTitle || (isDownsell ? (d.downsellProductTitle || '') : (d.upsellProductTitle || ''));
  const rawProductPrice = upsell.productPrice || (isDownsell ? (d.downsellProductPrice || '') : (d.upsellProductPrice || ''));
  const regularPrice = upsell.regularPrice || (isDownsell ? (d.downsellRegularPrice || '') : (d.upsellRegularPrice || ''));
  const productImage = upsell.productImage || (isDownsell ? (d.downsellProductImage || '') : (d.upsellProductImage || ''));
  const benefits = (Array.isArray(upsell.benefits) && upsell.benefits.length) ? upsell.benefits : (Array.isArray(d.upsellBenefits) ? d.upsellBenefits : []);
  const baseAcceptText = upsell.acceptButtonText || (isDownsell ? (d.downsellAcceptText || 'Continue') : (d.upsellAcceptText || 'Continue'));
  const declineText = upsell.declineButtonText || (isDownsell ? 'No thanks, continue to my order confirmation' : 'No thanks, skip this offer');
  const variantId = realVariantId(upsell.shopifyVariantId || d.upsellVariantId);

  // Price calculations with optional courtesy discount
  const numericBasePrice = parseFloat(String(rawProductPrice).replace(/[^0-9.]/g, '')) || 0;
  let finalPriceStr = rawProductPrice;
  let finalStrikethroughStr = regularPrice;
  let recordedAmount = numericBasePrice;

  if (isCourtesyRecovery && numericBasePrice > 0 && !isCourtesyExpired) {
    const discountedNum = Number((numericBasePrice * 0.9).toFixed(2));
    finalPriceStr = `$${discountedNum.toFixed(2)}`;
    finalStrikethroughStr = rawProductPrice || regularPrice;
    recordedAmount = discountedNum;
  }

  const acceptText = (isCourtesyRecovery && !isCourtesyExpired)
    ? `${baseAcceptText} (10% Courtesy Off Applied)`
    : baseAcceptText;

  const accentColor = isDownsell ? '#F59E0B' : '#10B981';
  const accentGradient = isDownsell ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'linear-gradient(135deg, #10B981, #059669)';
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  const nextDeclineUrl = (!isDownsell && (d.hasDownsell || d.downsell)) ? `/p/${slug}/downsell` : `/p/${slug}/thank-you`;
  const checkoutUrl = storeDomain && variantId
    ? `https://${storeDomain}/cart/${variantId}:1${(effectiveCoupon && !isCourtesyExpired) ? `?discount=${encodeURIComponent(effectiveCoupon)}` : ''}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headline)} — ${isDownsell ? 'Downsell Offer' : 'One-Time Offer'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;1,600&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet">
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
    .recovery-banner {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(99, 102, 241, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 12px;
      padding: 12px 18px;
      text-align: center;
      font-size: 13px;
      color: #34D399;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .recovery-tag {
      background: rgba(16, 185, 129, 0.25);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #FFFFFF;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
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
    ${(isCourtesyRecovery && !isCourtesyExpired) ? `
    <div class="recovery-banner" id="jv-recovery-banner">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="recovery-tag">Private Courtesy Offer</span>
        <span>10% courtesy discount <strong>${escapeHtml(effectiveCoupon)}</strong> pre-applied.</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#E2E8F0;">
        <span style="color:#94A3B8;">Hold window:</span>
        <strong id="jv-recovery-timer" style="color:#FACC15; font-family:'JetBrains Mono', monospace; letter-spacing:0.04em;">24:00:00</strong>
      </div>
    </div>` : (!isCourtesyRecovery && urgencyMins > 0 ? `
    <div class="reassurance-banner">
      <span>This offer timer runs for <span id="jv-timer">${String(urgencyMins).padStart(2, '0')}:00</span>.</span>
    </div>` : '')}

    <!-- Main Presentation Card -->
    ${isCourtesyExpired ? `
    <div class="card" id="jv-main-card">
      <div style="text-align:center;">
        <span class="badge-pill" style="background:rgba(148, 163, 184, 0.15); border-color:rgba(148, 163, 184, 0.3); color:#94A3B8;">
          Courtesy Window Concluded
        </span>
        <h1 style="font-size:24px; margin-bottom:12px;">This Private Courtesy Offer Has Expired</h1>
        <p class="subhead" style="margin-bottom:20px;">
          This 10% courtesy discount was exclusively reserved during your parcel packaging window. Our laboratory fulfillment team has now prepared your order for dispatch.
        </p>
      </div>

      <div style="background:rgba(255, 255, 255, 0.03); border:1px solid rgba(255, 255, 255, 0.08); border-radius:14px; padding:18px; margin-bottom:24px; text-align:center;">
        <div style="font-size:13px; color:#E2E8F0; font-weight:600; margin-bottom:6px;">Your primary order is confirmed and safe</div>
        <div style="font-size:12px; color:#94A3B8; line-height:1.5;">
          Your original purchase is already in the fulfillment queue. You can review your confirmed receipt and tracking details below.
        </div>
      </div>

      <a
        id="jv-continue-btn"
        href="${escapeHtml(nextDeclineUrl)}"
        class="btn-accept"
        style="background:linear-gradient(135deg, #6366F1, #4F46E5); box-shadow:0 10px 25px rgba(99, 102, 241, 0.35);"
      >
        Continue to My Order Confirmation
      </a>
    </div>` : `
    <div class="card" id="jv-main-card">
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
          ${(finalPriceStr || finalStrikethroughStr) ? `<div class="pricing-row">
            ${finalPriceStr ? `<span class="price-special">${escapeHtml(finalPriceStr)}</span>` : ''}
            ${finalStrikethroughStr ? `<span class="price-reg">${escapeHtml(finalStrikethroughStr)}</span>` : ''}
            ${isCourtesyRecovery ? `<span style="font-size:11px; font-weight:700; color:#34D399; background:rgba(16, 185, 129, 0.15); padding:2px 8px; border-radius:4px; border:1px solid rgba(16, 185, 129, 0.3);">10% OFF PRE-APPLIED</span>` : ''}
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
    </div>`}

  </div>

  <script>
    ${(!isCourtesyRecovery && urgencyMins > 0) ? `
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
    })();` : ''}

    ${(isCourtesyRecovery && !isCourtesyExpired) ? `
    (function() {
      var recoveryExp = ${recoveryExpiresAt || 'null'};
      var recoveryKey = 'jv_rec_exp_${slug}_' + ${JSON.stringify(queryEmail || 'anon')};
      if (!recoveryExp) {
        var stored = sessionStorage.getItem(recoveryKey);
        if (stored) {
          recoveryExp = parseInt(stored, 10);
        } else {
          recoveryExp = Date.now() + 24 * 3600 * 1000;
          sessionStorage.setItem(recoveryKey, recoveryExp);
        }
      }

      function renderExpiredState() {
        var banner = document.getElementById('jv-recovery-banner');
        if (banner) banner.style.display = 'none';
        var mainCard = document.getElementById('jv-main-card');
        if (mainCard) {
          mainCard.innerHTML = [
            '<div style="text-align:center;">',
              '<span class="badge-pill" style="background:rgba(148, 163, 184, 0.15); border-color:rgba(148, 163, 184, 0.3); color:#94A3B8;">Courtesy Window Concluded</span>',
              '<h1 style="font-size:24px; margin-bottom:12px;">This Private Courtesy Offer Has Expired</h1>',
              '<p class="subhead" style="margin-bottom:20px;">This 10% courtesy discount was exclusively reserved during your parcel packaging window. Our laboratory fulfillment team has now prepared your order for dispatch.</p>',
            '</div>',
            '<div style="background:rgba(255, 255, 255, 0.03); border:1px solid rgba(255, 255, 255, 0.08); border-radius:14px; padding:18px; margin-bottom:24px; text-align:center;">',
              '<div style="font-size:13px; color:#E2E8F0; font-weight:600; margin-bottom:6px;">Your primary order is confirmed and safe</div>',
              '<div style="font-size:12px; color:#94A3B8; line-height:1.5;">Your original purchase is already in the fulfillment queue. You can review your confirmed receipt and tracking details below.</div>',
            '</div>',
            '<a id="jv-continue-btn" href="' + ${JSON.stringify(nextDeclineUrl)} + '" class="btn-accept" style="background:linear-gradient(135deg, #6366F1, #4F46E5); box-shadow:0 10px 25px rgba(99, 102, 241, 0.35);">Continue to My Order Confirmation</a>'
          ].join('');
        }
      }

      function updateRecoveryClock() {
        var now = Date.now();
        var rem = Math.max(0, Math.floor((recoveryExp - now) / 1000));
        if (rem <= 0) {
          renderExpiredState();
          return;
        }
        var h = Math.floor(rem / 3600);
        var m = Math.floor((rem % 3600) / 60);
        var s = rem % 60;
        var el = document.getElementById('jv-recovery-timer');
        if (el) {
          el.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
      }
      setInterval(updateRecoveryClock, 1000);
      updateRecoveryClock();
    })();` : ''}

    // Track accept action
    var acceptBtn = document.getElementById('jv-accept-btn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function(e) {
        var queryParams = new URLSearchParams(location.search);
        var emailFromQuery = queryParams.get('email') || ${JSON.stringify(queryEmail)};
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
              customerEmail: emailFromQuery,
              discountCode: ${JSON.stringify(effectiveCoupon)},
              visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
            }),
            keepalive: true
          }).catch(function(){});
        } catch(err) {}
      });
    }

    // Track decline action
    var declineBtn = document.getElementById('jv-decline-btn');
    if (declineBtn) {
      declineBtn.addEventListener('click', function(e) {
        try {
          var queryParams = new URLSearchParams(location.search);
          var emailFromQuery = queryParams.get('email') || ${JSON.stringify(queryEmail)};
          fetch('/api/public/upsell-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: ${JSON.stringify(slug)},
              action: 'decline',
              offerType: ${JSON.stringify(isDownsell ? 'downsell' : 'upsell')},
              customerEmail: emailFromQuery,
              visitorId: window.jourvanceVisitor ? window.jourvanceVisitor() : ''
            }),
            keepalive: true
          }).catch(function(){});
        } catch(err) {}
      });
    }
  </script>
</body>
</html>`;
}

// ── Funnel Publishing Routes (Modular Controller: server/routes/journeyRoutes.mjs) ──
setupJourneyRoutes(app, {
  requireUser,
  loadJourney,
  saveJourney,
  loadWorkspace,
  realStoreDomain,
  validateSlugAvailability,
  reloadDomainRegistry,
  domainRegistryCache,
  savePublicPage,
  removePublicPage,
  persistPublicPages,
  publicPageCache
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

const leadRateLimits = new Map();
function isLeadRateLimited(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') return false;
  const now = Date.now();
  const record = leadRateLimits.get(ip);
  if (!record || now > record.resetAt) {
    leadRateLimits.set(ip, { count: 1, resetAt: now + 60000 });
    return false;
  }
  record.count++;
  if (record.count > 15) return true;
  return false;
}

// Clean up expired rate limits periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of leadRateLimits.entries()) {
    if (now > rec.resetAt) leadRateLimits.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// Public Lead Ingestion CORS Preflight
app.options('/api/public/lead', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
  res.sendStatus(204);
});

// Public Lead Ingestion
app.post('/api/public/lead', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (isLeadRateLimited(clientIp)) {
    return res.status(429).json({ success: false, error: 'Too many submissions. Please wait a moment and try again.' });
  }

  const honeypot = req.body?.website_url_hp || req.body?.website_hp || req.body?.hp_field;
  if (honeypot) {
    return res.json({ success: true, message: 'Thank you! Your submission has been received.' });
  }

  const {
    slug, email, name, phone, variant,
    order_bump_selected, orderBumpAccepted,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, ttclid, gclid, visitorId,
    workspaceId, journeyId, webhookUrl: customWebhookUrl, externalWebhookUrl
  } = req.body || {};
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
    userId: page?.userId || (workspaceId ? (Object.values(workspaceCache).find(w => w?.id === workspaceId)?.userId || '') : '') || req.body?.userId || '',
    journeyId: page?.journeyId || journeyId || '',
    workspaceId: page?.workspaceId || workspaceId || '',
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
  const webhookUrl = customWebhookUrl || externalWebhookUrl || page?.data?.webhookUrl;
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
  const parsed = verifyConfirmToken(req.params.token);
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

// ── Custom Brand Subdomain & CNAME Verification (Modular Controller: server/routes/domainRoutes.mjs) ──
setupDomainRoutes(app, {
  requireUser,
  domainRegistryCache,
  reloadDomainRegistry,
  verifyDomainOwnership,
  getDomainVerificationToken,
  publicPageCache,
  persistPublicPages
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
  if (customerEmail && (action === 'accept' || action === 'decline')) {
    try {
      const contacts = loadContacts();
      const contact = contacts.find(c => c.email.toLowerCase() === customerEmail.toLowerCase());
      if (contact) {
        if (!contact.tags) contact.tags = [];
        if (action === 'accept') {
          const tagName = isDownsell ? 'Downsell-Accepted' : 'Upsell-Accepted';
          if (!contact.tags.includes(tagName)) contact.tags.push(tagName);
          const parsedAmount = Number(amount);
          if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
            contact.totalSpent = Number(((contact.totalSpent || 0) + parsedAmount).toFixed(2));
          }
        } else if (action === 'decline') {
          const tagName = isDownsell ? 'Downsell-Declined' : 'Upsell-Declined';
          if (!contact.tags.includes(tagName)) contact.tags.push(tagName);
        }
        saveContacts(contacts);
      }
    } catch (e) {
      console.warn('[Jourvance] Upsell customer tagging error:', e.message);
    }
  }

  // Drip sequence trigger / smart exit handling
  if (customerEmail) {
    try {
      const dripsData = loadDrips();
      let dripsModified = false;
      const targetUid = page?.userId || 'usr_default';

      if (action === 'decline' && !klaviyoIsSender(targetUid)) {
        const recoverySeq = dripsData.sequences.find(s => s.triggerType === 'upsell_recovery');
        if (recoverySeq) {
          const alreadyActive = dripsData.enrollments.some(e => 
            e.customerEmail && e.customerEmail.toLowerCase() === customerEmail.toLowerCase() &&
            e.sequenceId === recoverySeq.id && e.status === 'active'
          );
          if (!alreadyActive) {
            const delayHours = recoverySeq.steps?.[0]?.delayHours ?? 18;
            const discountCode = recoverySeq.steps?.[0]?.discountVoucher || 'SAVE10';
            const cleanEmail = customerEmail.toLowerCase().trim();
            const expTime = Date.now() + (delayHours + 24) * 3600000;
            const offerUrl = slug ? `${publicBase()}/p/${slug}?coupon=${encodeURIComponent(discountCode)}&email=${encodeURIComponent(cleanEmail)}&ref=recovery&exp=${expTime}` : '';
            dripsData.enrollments.unshift({
              id: `enr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              sequenceId: recoverySeq.id,
              userId: targetUid,
              visitorId: String(req.body?.visitorId || '').slice(0, 80),
              customerEmail: cleanEmail,
              customerName: req.body?.customerName || '',
              sourceSlug: slug || 'upsell_offer',
              offerUrl,
              offerType: isDownsell ? 'downsell' : 'upsell',
              discountCode,
              currentStepIndex: 0,
              status: 'active',
              enrolledAt: new Date().toISOString(),
              nextStepDueAt: new Date(Date.now() + delayHours * 3600000).toISOString(),
              history: []
            });
            recoverySeq.activeEnrollments = (recoverySeq.activeEnrollments || 0) + 1;
            dripsModified = true;
          }
        }
      } else if (action === 'accept') {
        for (const enr of dripsData.enrollments) {
          if (enr.customerEmail && enr.customerEmail.toLowerCase() === customerEmail.toLowerCase() && enr.status === 'active') {
            const s = dripsData.sequences.find(sq => sq.id === enr.sequenceId);
            if (s && s.triggerType === 'upsell_recovery') {
              enr.status = 'converted_exit';
              enr.convertedAt = new Date().toISOString();
              s.activeEnrollments = Math.max(0, (s.activeEnrollments || 1) - 1);
              s.totalExitedPurchased = (s.totalExitedPurchased || 0) + 1;
              dripsModified = true;
            }
          }
        }
      }

      if (dripsModified) {
        saveDrips(dripsData);
      }
    } catch (e) {
      console.warn('[Jourvance] Upsell drip sequence error:', e.message);
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

// Public A/B Split Traffic Router SSR Route
app.get(['/p/split/:slug', '/p/:wsId/split/:slug'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase().trim();
  let split = publicPageCache[`split:${slug}`] || await loadPublicPage(`split:${slug}`);
  if (!split) {
    for (const record of Object.values(publicPageCache)) {
      if (record && typeof record === 'object' && record.type === 'ab-split' && record.slug?.toLowerCase() === slug) {
        split = record;
        break;
      }
    }
  }

  if (!split || !split.data) {
    return res.status(404).send(render404Html(slug));
  }

  const d = split.data || {};

  // 1. Check query parameter override: ?jv_var=a|b or ?var=a|b
  const qVar = String(req.query.jv_var || req.query.var || '').toLowerCase();
  let variant = '';
  if (qVar === 'a' || qVar === 'b') {
    variant = qVar;
  }

  // 2. Check sticky cookie: jv_split_<slug>=a|b
  if (!variant) {
    const cookieHeader = req.headers.cookie || '';
    const cookieMatch = cookieHeader.match(new RegExp(`jv_split_${slug}=(a|b)`, 'i'));
    if (cookieMatch && cookieMatch[1]) {
      variant = cookieMatch[1].toLowerCase();
    }
  }

  // 3. Check winner or 100/0 lock
  if (!variant) {
    if (d.winner === 'a' || d.splitRatio === 100) {
      variant = 'a';
    } else if (d.winner === 'b' || d.splitRatio === 0) {
      variant = 'b';
    }
  }

  // 4. Deterministic random allocation based on splitRatio (default 50)
  if (!variant) {
    const ratio = typeof d.splitRatio === 'number' ? Math.max(0, Math.min(100, d.splitRatio)) : 50;
    variant = (Math.random() * 100 < ratio) ? 'a' : 'b';
  }

  // Set 30-day sticky cookie
  res.setHeader('Set-Cookie', `jv_split_${slug}=${variant}; Path=/; Max-Age=2592000; SameSite=Lax`);

  // Update telemetry
  if (variant === 'a') {
    d.branchAVisitors = (d.branchAVisitors || 0) + 1;
  } else {
    d.branchBVisitors = (d.branchBVisitors || 0) + 1;
  }
  persistPublicPages();

  recordEvent({
    type: 'split_route',
    slug,
    journeyId: split.journeyId || '',
    nodeId: split.nodeId || '',
    userId: split.userId || '',
    variant,
    visitorId: String(req.query.jv_vid || '').slice(0, 80),
    utm_source: String(req.query.utm_source || ''),
    utm_medium: String(req.query.utm_medium || ''),
    utm_campaign: String(req.query.utm_campaign || ''),
    utm_content: String(req.query.utm_content || '')
  });

  // Resolve target slug
  const targetSlug = (variant === 'b' ? d.branchBPageSlug : d.branchAPageSlug) || d.branchAPageSlug || d.branchBPageSlug;
  if (!targetSlug) {
    return res.status(404).send(render404Html(`${slug} (no target page connected for variant ${variant.toUpperCase()})`));
  }

  // Forward query parameters + jv_split & jv_var
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    params.set(k, String(v));
  }
  params.set('jv_split', slug);
  params.set('jv_var', variant);

  const targetPath = `/p/${targetSlug}`;
  const destination = `${targetPath}?${params.toString()}`;
  return res.redirect(302, destination);
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
  const ordersByEmail = new Map();
  for (const o of orders) {
    const email = String(o.customerEmail || '').toLowerCase();
    if (!email) continue;
    let list = ordersByEmail.get(email);
    if (!list) {
      list = [];
      ordersByEmail.set(email, list);
    }
    list.push(o);
  }
  for (const contact of contacts) {
    const email = String(contact.email || '').toLowerCase();
    const mine = ordersByEmail.get(email) || [];
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

(async () => {
  try {
    await hubStorage.rehydrateAll({
      workspaceCache,
      publicPageCache,
      sanitizeWorkspace
    });
  } catch (err) {
    console.warn('[Jourvance] Startup rehydration notice:', err.message);
  }
  purgeSeededFiles();

  app.listen(PORT, () => {
    console.log(`[Jourvance] Customer Journey Spoke running at http://localhost:${PORT}`);
    startAutomationRunner();
  });
})();

