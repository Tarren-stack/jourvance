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
import { reloadJsonInPlace } from './server/liveJsonCache.mjs';
import { stripSeededOffers, readSignupForms } from './server/seededOffers.mjs';
import { setupShopifyRoutes, ensureShopifyCoreDiscounts as ensureShopifyCoreDiscountsModular } from './server/routes/shopifyRoutes.mjs';
import { reviewUrlFor } from './server/reviewTokens.mjs';
import {
  recordWebhookDelivery,
  getWebhookHealth,
  summarizeWebhookPayload,
  simulateTestPing
} from './server/webhookHealth.mjs';
import { setupEmailRoutes } from './server/routes/emailRoutes.mjs';
import { mailCallbackPlan } from './server/mail-events.mjs';

import { setupJourneyRoutes } from './server/routes/journeyRoutes.mjs';
import { setupJourneySaveRoutes } from './server/routes/journeySaveRoutes.mjs';
import { setupJourneyListRoutes } from './server/routes/journeyListRoutes.mjs';
import { listJourneyDocs, summarizeJourney } from './server/journeyList.mjs';
import { setupAnalyticsRoutes } from './server/routes/analyticsRoutes.mjs';
import { setupAiJourneyRoutes } from './server/routes/aiJourneyRoutes.mjs';
import { setupBillingRoutes, billingAccounts, planName } from './server/billing.mjs';
import {
  setupAuthWorkspaceRoutes,
  requireUser,
  aiBudgetLeft,
  aiBudgetRetryAfter,
  requireOperator,
  verifyIdToken,
  listWorkspaces,
  loadWorkspace,
  saveWorkspace,
  presentWorkspace,
  sanitizeWorkspace,
  workspaceByShopDomain,
  realStoreDomain,
  realVariantId,
  realTrackingId,
  adminToken,
  mapShopifyProducts,
  shopifyHmacOk,
  persistWorkspaces,
  workspaceCache,
  wsDocName,
  FAKE_STORE_DOMAINS,
  FAKE_VARIANT_IDS,
  FAKE_TRACKING_IDS
} from './server/routes/authWorkspaceRoutes.mjs';
import {
  setupPublicRoutes,
  reportSamplePages,
  loadPublicPage,
  readPublicPage,
  savePublicPage,
  removePublicPage,
  validateSlugAvailability,
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml,
  render404Html,
  resolveSplitVariant,
  withTracking,
  trackingSnippet,
  pageTrackFrom,
  savedPrice,
  escapeHtml
} from './server/routes/publicRoutes.mjs';

import { applySecurity } from './security-sentinel.js';
import { trustedProxy, proxyTrustSummary } from './server/proxy-trust.mjs';
import { shieldProse, PROSE_ROUTE_PREFIXES } from './server/sentinel-shield.mjs';

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
    const url = String(req.originalUrl || '');
    if (url.startsWith('/api/webhooks/shopify') || url.startsWith('/api/billing/webhook')) req.rawBody = buf;
  }
}));

// Security Sentinel: the hub's vendored drop-in (security-sentinel.js is a byte copy of the
// hub's sentinel-dist, pinned by sentinel-adoption.test.mjs). Hardened headers and a CSP, the
// virtual patches, the per-address rate limit, and a posture report to the hub. Mounted AFTER
// the body parser on purpose: the virtual-patch scan reads req.body, so in front of the parser
// the POST half of it is dead code while the fleet dashboard reports it live. The prose shield
// (server/sentinel-shield.mjs) blanks the strings of a document route for the duration of the
// scan and puts them back before the route runs; the URL and the query string are scanned on
// every route.
//
// `trust proxy` is set by ADDRESS (server/proxy-trust.mjs), never by count: the Sentinel keys
// its rate limit on req.ip, and with no trust setting at all, which is what this server had,
// every visitor behind Render's load balancer was one address and one bucket.
app.set('trust proxy', trustedProxy);
for (const bad of proxyTrustSummary().rejected) console.warn(`[Jourvance] Ignored proxy range ${bad}: not a CIDR.`);
const sentinelShield = shieldProse(PROSE_ROUTE_PREFIXES);
app.use(sentinelShield.mask);
applySecurity(app, {
  hubUrl: process.env.HUB_URL,
  appId: process.env.APP_ID,
  appName: 'Jourvance',
  // Firebase Auth keeps a helper iframe on the project's auth domain. With no frame-src
  // directive a frame falls back to default-src 'self', and sign-in would fail silently.
  extraFrameSrc: ['https://gen-lang-client-0527980301.firebaseapp.com'],
  // index.html loads the hub's tracker.js from this origin by a hard-coded tag, whatever
  // HUB_URL says. The Sentinel adds HUB_URL's origin to script-src on its own, so this only
  // matters when HUB_URL is unset or points elsewhere (a local hub, a sandboxed boot), and
  // then it is what keeps the page's own telemetry tag from being refused. Seen blocked in
  // the browser on the first sandboxed boot.
  extraScriptSrc: ['https://zeluslabs.dev'],
  // The cockpit fetches many small resources on a tab change and its sign-in is a bearer
  // token the Sentinel cannot verify cheaply, so the fairness bucket is the address. This is
  // the Sentinel default doubled; the per-address machine ceiling sits ten times above it.
  localRateLimit: 240
});
app.use(sentinelShield.restore);

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

// ok:false only when the hub was asked and answered neither a document nor a 404. The SDK never
// throws: a 503, a 409 or a network failure comes back as { error }, and reading that as "not
// there" answered GET with journey null (which released the browser's autosave over the account
// copy) and let publish and unpublish run on an older cached copy. A 404 falls back to this
// server's copy, which is the only one when a hub put failed.
async function readJourney(uid, id) {
  const local = journeyCache[cacheKey(uid, id)];
  const cached = local && local.userId === uid ? local : null;
  if (!hubReady) return { ok: true, journey: cached };
  try {
    const r = await hub.store.docs.get(docName(uid, id));
    if (r && r.document) {
      // A later save whose hub put failed is on this server's copy only, and that save's answer gave
      // the browser its stamp as the next base: the hub's older document is not the stored copy, and
      // reading it refused the next save as changed somewhere else (F1). Both stamps are a server's.
      const newer = cached && Date.parse(cached.updatedAt) > Date.parse(r.document.updatedAt);
      return { ok: true, journey: newer ? cached : r.document };
    }
    if (r && r.status === 404) return { ok: true, journey: cached };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// Best effort, for background reads that only look up which flows a map links (enrollment and
// the Klaviyo handoff): a hub that cannot answer falls back to this server's copy rather than
// dropping a real customer's enrollment. Anything a user sees or that writes goes through
// readJourney.
async function loadJourney(uid, id) {
  const read = await readJourney(uid, id);
  if (read.ok) return read.journey;
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

// ── Publish logs: one per journey, hub app store with a local cache ─────────
// Each publish reserves the next revision number here before it writes a page. The doc name
// starts 'journeypub.', which the 'journey.' prefix filters below do not match.

const publishLogsFile = path.join(__dirname, 'journey_publish_logs.json');
let publishLogCache = {};
try {
  if (fs.existsSync(publishLogsFile)) {
    publishLogCache = JSON.parse(fs.readFileSync(publishLogsFile, 'utf8'));
  }
} catch (e) {
  console.warn('[Jourvance] Failed to read journey_publish_logs.json, starting empty:', e.message);
}

const persistPublishLogs = () => {
  try {
    fs.writeFileSync(publishLogsFile, JSON.stringify(publishLogCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist journey_publish_logs.json:', e.message);
  }
};

const publishLogDocName = (uid, id) => `journeypub.${safe(uid)}.${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16)}`;
const logNumber = (log) => (log && Number.isFinite(log.lastNumber) ? log.lastNumber : -1);

// ok:false only when the hub was asked and could not answer. A 404 is "no log yet". When both
// copies exist the one with the higher lastNumber wins, so a hub put that failed can never make
// a revision number come round again.
async function loadPublishLog(uid, id) {
  const local = publishLogCache[cacheKey(uid, id)] || null;
  if (!hubReady) return { ok: true, log: local };
  try {
    const r = await hub.store.docs.get(publishLogDocName(uid, id));
    if (r && r.document) return { ok: true, log: logNumber(local) > logNumber(r.document) ? local : r.document };
    if (r && r.status === 404) return { ok: true, log: local };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function savePublishLog(uid, id, log) {
  publishLogCache[cacheKey(uid, id)] = log;
  persistPublishLogs();
  if (!hubReady) return { durable: false, reason: 'HUB_API_KEY is not set on this server.' };
  try {
    const r = await hub.store.docs.put(publishLogDocName(uid, id), log);
    if (r && r.error) return { durable: false, reason: r.error };
    return { durable: true };
  } catch (e) {
    return { durable: false, reason: e.message };
  }
}

// Answers {journeys, complete, reason?}: a hub that refused or answered part of the list is
// reported as such, never as an empty list, and there is no 50-journey cap.
async function listJourneys(uid) {
  return listJourneyDocs({ hub, hubReady, uid, prefix: `journey.${safe(uid)}.`, cached: Object.values(journeyCache).filter((j) => j.userId === uid) });
}

const summarize = summarizeJourney;

// ── Modular Auth & Workspace Multi-Tenancy Routes (server/routes/authWorkspaceRoutes.mjs) ──
// Registered here, below `let journeyCache` and `const summarize`: reading either before its
// declaration is a TDZ ReferenceError at boot. These are still the first routes registered.
setupAuthWorkspaceRoutes(app, {
  hub,
  hubReady,
  FIREBASE_PROJECT_ID,
  OPERATOR_EMAIL,
  journeyCache,
  summarize,
  accountPlan: (uid) => planName(billingAccounts().get(uid))
});

// POST /api/ai/journey-plan (#25): one AI draft of a journey's copy. Signed-in only, and it
// draws on the same per-user hourly budget as /api/ai/copy above. No template fallback.
setupAiJourneyRoutes(app, { requireUser, hub, hubReady, aiBudgetLeft, aiBudgetRetryAfter });
setupBillingRoutes(app, {
  requireUser,
  listWorkspaces,
  saveWorkspace,
  store: billingAccounts()
});

// ── Workspace & Shopify Tenancy ──────────────────────────────────────────────
function acceptShopifyWebhook(req, res) {
  const startTime = performance.now();
  const shopDomain = cleanDomain(req.get('x-shopify-shop-domain') || '');
  const ws = workspaceByShopDomain(shopDomain);
  const secret = String(ws?.shopifyConfig?.webhookSecret || '').trim();
  const topic = req.get('x-shopify-topic') || req.path.replace(/^\/api\/webhooks\/shopify\//, '');
  const webhookId = req.get('x-shopify-webhook-id') || `wh_${Date.now()}`;

  if (!ws) {
    recordWebhookDelivery('unknown', {
      topic,
      webhookId,
      shopDomain,
      hmacStatus: 'store_not_found',
      latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
      summary: `Refused: Store ${shopDomain || 'unknown'} not found in any workspace`
    });
    res.status(401).json({ success: false, error: 'This store has no app API secret saved, so the webhook was refused.' });
    return null;
  }

  if (!secret) {
    recordWebhookDelivery(ws.id, {
      topic,
      webhookId,
      shopDomain,
      hmacStatus: 'missing_secret',
      latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
      summary: 'Refused: No App API secret saved on store connection'
    });
    res.status(401).json({ success: false, error: 'This store has no app API secret saved, so the webhook was refused.' });
    return null;
  }

  const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
  if (!shopifyHmacOk(req.rawBody, hmacHeader, secret)) {
    recordWebhookDelivery(ws.id, {
      topic,
      webhookId,
      shopDomain,
      hmacStatus: 'invalid_signature',
      latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
      summary: 'Refused: Shopify signature mismatch (verify App API Secret)'
    });
    res.status(401).json({ success: false, error: 'Shopify signature did not match this store’s app API secret.' });
    return null;
  }

  recordWebhookDelivery(ws.id, {
    topic,
    webhookId,
    shopDomain,
    hmacStatus: 'valid',
    latencyMs: Math.max(1, Math.round(performance.now() - startTime)),
    summary: summarizeWebhookPayload(topic, req.body)
  });

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

function cleanDomain(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

// ── API Routes ──

// (Shopify workspace routes mounted via server/routes/shopifyRoutes.mjs)


// ── Wave 6: Persistent CRM Storage Helpers (Contacts, Orders, Campaigns) ────────
const publicPagesFile = path.join(__dirname, 'public_pages.json');
// The route modules hold this object from mount, so a reload refills it rather than replacing it.
const publicPageCache = {};
function reloadPublicPageCache() {
  return reloadJsonInPlace(publicPageCache, publicPagesFile);
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

// Stand-in addresses that shipped in the local store. A real merchant domain is not in this set.
// example.com is reserved and is never a customer. The rest are the fixture stores on this disk.
const FIXTURE_MAIL_DOMAINS = new Set([
  'example.com',
  'botanicalglow.com',
  'growthbrand.io',
  'acmecommerce.com',
  'scaletech.io',
  'enterprise.org',
  'scaleb2b.io',
  'luxbrand.com',
  'brand.io',
  'beautyglow.com',
  'auraglow.co',
  'luxeaesthetics.com',
  'beautybrand.com',
  'vipbeauty.com',
  'growthlab.io',
  'venture.co'
]);

function isFixtureEnrollment(row) {
  const email = String(row?.customerEmail || row?.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  return FIXTURE_MAIL_DOMAINS.has(domain);
}

// Active fixture enrolments are due on this disk. Stop them before the runner can send.
function holdFixtureEnrollments(rows) {
  let held = false;
  for (const row of rows) {
    if (!row || row.status !== 'active' || !isFixtureEnrollment(row)) continue;
    row.status = 'stopped';
    row.stoppedAt = row.stoppedAt || new Date().toISOString();
    row.stoppedReason = 'fixture';
    held = true;
  }
  return held;
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
        // Plain words for any store: the old subject named "beauty essentials" and said the items were
        // saved, which step 2 contradicts (T13). A stored copy of the old words takes these.
        subject: 'You left something in your cart',
        previewText: 'Your order is waiting for you',
        body: 'Hi {{first_name}},\n\nWe noticed you did not get a chance to finish your order. You can pick up where you left off.\n\nReturn to your checkout here:\n{{abandoned_checkout_url}}',
        discountVoucher: ''
      },
      {
        id: 'cart_step_2',
        stepNumber: 2,
        delayHours: 24,
        subject: 'Your checkout is still open',
        previewText: 'You can pick up where you left off',
        body: 'Hey {{first_name}},\n\nYou started a checkout and did not finish it. The items were not held aside.\n\nYou can return to the checkout here:\n{{abandoned_checkout_url}}',
        // No code is seeded: a discount is the merchant's own to set (C18).
        discountVoucher: ''
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
    description: 'Reaches out to clients who passed on their post-purchase upgrade with a gentle second chance at the offer.',
    triggerType: 'upsell_recovery',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'upsell_rec_step_1',
        stepNumber: 1,
        delayHours: 18,
        subject: 'About the offer on your recent order',
        previewText: 'In case you still wanted it',
        body: 'Hey {{first_name}},\n\nThank you again for your order {{order_number}}. We are already preparing everything for you.\n\nWhen you checked out, you skipped the upgrade offer. In case you still wanted to add it to your order, you can review the offer here:\n{{offer_url}}\n\nNo pressure at all, we simply wanted to make sure you had the option before your order ships.\n\nWarmly,\nThe Jourvance Team',
        // No code is seeded, so the letter names none (C18).
        discountVoucher: ''
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
    description: 'Checks in with clients who reach the at-risk inactivity threshold (90 days since last purchase).',
    triggerType: 'at_risk_inactivity',
    smartExitOnPurchase: true,
    steps: [
      {
        id: 'winback_step_1',
        stepNumber: 1,
        delayHours: 0,
        subject: 'It has been a little while',
        previewText: "We'd love to welcome you back",
        body: 'Hello {{first_name}},\n\nWe noticed it has been a little while since your last order, and we wanted to check in.\n\nWhenever you are ready, we would be glad to see you again.',
        // Auto-winback sends this unattended, so it is a finished note with no offer and no code (R24).
        discountVoucher: ''
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'drip_seq_review_request',
    name: 'Post-Purchase Review & Social Proof Engine',
    description: 'Invites verified buyers 7 days after fulfillment to share a review of their order.',
    triggerType: 'fulfillment_review',
    smartExitOnPurchase: false,
    steps: [
      {
        id: 'review_step_1',
        stepNumber: 1,
        delayHours: 168,
        subject: 'How is your order working for you?',
        previewText: 'We would love your thoughts on your recent order',
        body: 'Hi {{first_name}},\n\nIt has been a week since your order {{order_number}} arrived. Could you share your honest experience?\n\nShare your review here:\n{{review_url}}',
        // No code is seeded: a thank-you gift is the merchant's to set, and only if it exists (R24).
        discountVoucher: ''
      },
      {
        id: 'review_step_2',
        stepNumber: 2,
        delayHours: 72,
        subject: 'A quick reminder about your review',
        previewText: 'Whenever you have a moment',
        body: 'Hi {{first_name}},\n\nA gentle reminder: whenever you have a moment, we would love to hear how your order is working for you.\n\nShare your review here:\n{{review_url}}',
        discountVoucher: ''
      }
    ],
    activeEnrollments: 0,
    totalCompleted: 0,
    totalExitedPurchased: 0,
    attributedSales: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// The cart and upsell recovery seeds used to carry SAVE10 and promise 10% off, the winback seed
// WELCOMEBACK15 and 15%, and the review seed REVIEW10 and $10, none a code the merchant chose (C18,
// R24). A stored step that is still that seed, unedited, takes the new seed's words and no code, and
// its active enrolments stop carrying the code. A step the merchant rewrote is theirs and is left alone.
function stripSeededVoucher(data) {
  return stripSeededOffers(data, INITIAL_DRIP_SEQUENCES);
}

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
    if (stripSeededVoucher(data)) modified = true;
    const enrollments = (Array.isArray(data.enrollments) ? data.enrollments : []).filter(row => !isDemoRecord(row));
    if (holdFixtureEnrollments(enrollments)) modified = true;
    const cleaned = recomputeDripCounters({
      sequences: data.sequences,
      enrollments
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
  const raw = hubStorage.get('store.events', 'events.json', null);
  if (!Array.isArray(raw)) throw new Error('The event log could not be read');
  return raw;
}

function trimLastPerOwner(rows, field, cap) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= cap) return list;
  const seen = new Map();
  const kept = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const id = String(list[i]?.[field] || '').trim();
    const n = seen.get(id) || 0;
    if (n >= cap) continue;
    seen.set(id, n + 1);
    kept.push(list[i]);
  }
  return kept.reverse();
}

function recordEvent(evt) {
  const events = loadEvents();
  events.push({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...evt
  });
  hubStorage.set('store.events', 'events.json', trimLastPerOwner(events, 'userId', 20000));
}

// A secret that falls back to a literal in the source is a secret everyone has. With neither
// its own variable nor HUB_API_KEY set, a signing key is minted once per process and the boot
// log says so: what it signed will not verify after a restart, which is honest, where the old
// literal was a key anyone could read off the repo and forge an unsubscribe or a domain token
// with. Same rule as INTERNAL_CRON_SECRET, whose route no longer mounts without a value.
const processSecrets = new Map();
function processSecret(name, what) {
  let value = processSecrets.get(name);
  if (!value) {
    value = crypto.randomBytes(32).toString('hex');
    processSecrets.set(name, value);
    console.warn(`[Jourvance] ${name} is not set: ${what} are signed with a key minted for this process and will not verify after a restart. Set ${name}.`);
  }
  return value;
}

function mailLinkSecrets() {
  const current = process.env.MAIL_LINK_SECRET || process.env.HUB_API_KEY || processSecret('MAIL_LINK_SECRET', 'unsubscribe and tracked mail links');
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
  hubStorage.set('store.redirects', 'redirects.json', trimLastPerOwner(rows, 'uid', 20000));
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

let noteSegmentChanges = async () => {};
let processDueCampaigns = async () => ({ sent: 0 });

function noteAttrMap(payload) {
  const out = {};
  const list = Array.isArray(payload?.note_attributes) ? payload.note_attributes : [];
  for (const attr of list) {
    if (attr && attr.name != null) out[String(attr.name)] = attr.value == null ? '' : String(attr.value);
  }
  return out;
}

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
  recordWebhookDelivery,
  getWebhookHealth,
  summarizeWebhookPayload,
  simulateTestPing,
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
    recipients: [{ email: to, name: name || '' }],
    // Name the account so the hub sends from this merchant's own VERIFIED sender when one
    // exists, and from the app default otherwise (resolveSenderIdentity in the hub). Without
    // it every letter left as noreply@zeluslabs.dev however many domains the merchant verified.
    ...(userId ? { accountId: userId } : {}),
    ...(userId ? { jourvanceUid: userId, jourvanceMessageId: messageId } : {})
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
  loadRedirects,
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
  loadBehaviorBag,
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
  knownSend,
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
        // Only a code the merchant set on the step, or the one the enrolment carries; never a made-up one (C18).
        const discountCode = String(step.discountVoucher || enr.discountCode || '').trim();
        const resolvedCheckoutUrl = checkout ? resolveCheckoutRecoveryUrl(checkout, defaultDomain, (seq.triggerType === 'checkout_abandonment' && step.stepNumber > 1) ? discountCode : '') : '';
        if (offerUrl && seq.triggerType === 'upsell_recovery') {
          const sep = offerUrl.includes('?') ? '&' : '?';
          const expTime = Date.now() + 24 * 3600000;
          if (!offerUrl.includes('coupon=') && !offerUrl.includes('ref=recovery')) {
            const coupon = discountCode ? `coupon=${encodeURIComponent(discountCode)}&` : '';
            offerUrl += `${sep}${coupon}email=${encodeURIComponent(enr.customerEmail)}&ref=recovery&exp=${expTime}`;
          } else if (!offerUrl.includes('exp=')) {
            offerUrl += `&exp=${expTime}`;
          }
        }
        const effectiveCheckoutUrl = resolvedCheckoutUrl || checkout?.abandonedCheckoutUrl || offerUrl;
        // Signed now with this server's key: a stored link may carry a token from the key once written
        // in reviewEngine.mjs, which the review route no longer accepts (R24).
        const reviewUrl = enr.orderId ? reviewUrlFor(enr.orderId, enr.customerEmail) : (enr.reviewUrl || '/review');
        const letter = await composeForSend(uid, dripContact, [{ kind: 'text', text: step.body || '' }], {
          checkout_url: effectiveCheckoutUrl,
          abandoned_checkout_url: effectiveCheckoutUrl,
          offer_url: offerUrl,
          review_url: reviewUrl,
          discount_code: discountCode,
          order_number: customerOrder?.orderNumber || (customerOrder?.id ? `#${String(customerOrder.id).slice(-6)}` : (enr.orderId ? `#${String(enr.orderId).slice(-6)}` : '')),
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
    if (isFixtureEnrollment(chk)) {
      if (chk.recoveryStatus === 'pending' || chk.recoveryStatus === 'email_sent') {
        chk.recoveryStatus = 'stopped';
        chk.stoppedReason = 'fixture';
        checkoutsModified = true;
      }
      continue;
    }
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
            // Plain words for any store: no product category, and no claim the cart was held (T13).
            { kind: 'heading', text: 'You left something in your cart' },
            { kind: 'text', text: `Hi ${recoveryContact.name || 'there'},\n\nWe noticed you did not finish your order. You can pick up where you left off.` },
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
            subject: 'You left something in your cart',
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
    // Stage 2: a second reminder 24 hours after the Stage 1 email. It names a code only when the
    // merchant set one on the cart recovery sequence's later step, and claims no percentage (C18).
    else if (chk.recoveryStatus === 'email_sent') {
      const sentTime = new Date(chk.recoveryEmailSentAt || chk.abandonedAt).getTime();
      if (now - sentTime >= 86400000) {
        if (!holdForKlaviyo && hubReady && chk.customerEmail) {
          const recoveryContact = loadContacts().find(c => c.email === chk.customerEmail && contactOwnerId(c) === uid) || { email: chk.customerEmail };
          const cartSeq = dripsData.sequences.find(s => s.triggerType === 'checkout_abandonment');
          const merchantCode = String((cartSeq?.steps || []).find(st => Number(st.stepNumber) > 1 && String(st.discountVoucher || '').trim())?.discountVoucher || '').trim();
          const resolvedUrl2 = resolveCheckoutRecoveryUrl(chk, userStoreDomain, merchantCode);
          const cartCardsHtml2 = renderLineItemCardsHtml(chk.lineItems, chk.totalPrice, chk.currency, {
            discountPercent: 0,
            discountCode: merchantCode,
            catalog: catalogFor(uid)
          });
          const incentiveBlocks = [
            { kind: 'heading', text: 'Your checkout is still open' },
            { kind: 'text', text: `Hi ${recoveryContact.name || 'there'},\n\nYou started a checkout and did not finish it. You can pick up where you left off.${merchantCode ? ` Use code ${merchantCode} at checkout.` : ''}` },
            ...(cartCardsHtml2 ? [{ kind: 'html', text: cartCardsHtml2 }] : []),
            { kind: 'button', label: 'Complete My Checkout', url: resolvedUrl2, color: '#EC4899', radius: 8, padding: 12 },
            { kind: 'text', text: 'If you have any questions, simply reply to this email and our team will be glad to help.' }
          ];
          const letter2 = composeLetter(uid, recoveryContact, incentiveBlocks, {
            checkout_url: resolvedUrl2,
            abandoned_checkout_url: resolvedUrl2,
            discount_code: merchantCode,
            eventLineItems: chk.lineItems || []
          }, { marketing: true });
          const result2 = await deliverLetter({
            to: chk.customerEmail,
            name: recoveryContact.name || '',
            subject: 'Your checkout is still open',
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

// No fallback. A secret in source would let anyone who can read the repo run the sender.
const INTERNAL_CRON_SECRET = String(process.env.INTERNAL_CRON_SECRET || '').trim();
if (INTERNAL_CRON_SECRET) {
  app.post('/api/internal/cron/drips', async (req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${INTERNAL_CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized cron token' });
    }
    await runBackgroundAutomations();
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
} else {
  console.log('[Jourvance Automations] Cron route is off until INTERNAL_CRON_SECRET is set.');
}

app.post('/api/drips/process-tick', requireUser, async (req, res) => {
  const summary = await processUserAutomationsTick(req.user.uid);
  res.json({
    success: true,
    ...summary
  });
});

// ── Modular Analytics & Reporting Controller (server/routes/analyticsRoutes.mjs) ─
const analyticsCtx = {
  requireUser,
  requireOperator,
  loadEvents,
  loadOrders,
  loadContacts,
  loadDrips,
  loadCheckouts,
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

// A form saved from an old preset carries the preset's code (WELCOME15, SANCTUARY, FREESHIP,
// WELCOME10), which minted a code of that name for every visitor. Read with its coupon and words
// unedited, it has no code and the current starter's words; a form the merchant changed keeps its
// own (T13). Every reader of the stored forms comes through here (signup-forms-read.test.mjs).
function signupFormsFor(uid) {
  return readSignupForms(loadSignupStore()[uid], cleanSignupForm);
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
  let contact = contacts.find((row) => String(row.email || '').toLowerCase() === email && contactOwnerId(row) === uid);
  if (contact) {
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
        const contact = contacts.find((item) => String(item.email || '').toLowerCase() === email && contactOwnerId(item) === uid);
        if (!contact) continue;
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

// GET /api/user/:userId/journeys and GET /api/journeys: {success, journeys, complete, reason?}.
setupJourneyListRoutes(app, { requireUser, listJourneys, summarize });

// GET /api/journey/:id is mounted by setupJourneyRoutes, below the literal /api/journey/check-slug, so the literal route answers first.

// POST /api/journey/:id and POST /api/user/:userId/journey/:id: a save naming baseUpdatedAt is
// refused with 409 when the stored copy is another revision (F1).
setupJourneySaveRoutes(app, { requireUser, readJourney, saveJourney });

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
// ── Public Funnel Page Storage & SSR Hosting ───────────────────────────────────

const persistPublicPages = () => {
  try {
    fs.writeFileSync(publicPagesFile, JSON.stringify(publicPageCache, null, 2), 'utf8');
  } catch (e) {
    console.error('[Jourvance] Failed to persist public_pages.json:', e.message);
  }
};

const domainsFilePath = path.join(__dirname, 'domains.json');
// Refilled in place, like publicPageCache: a domain verified after boot is verified for every route.
const domainRegistryCache = {};
function reloadDomainRegistry() {
  return reloadJsonInPlace(domainRegistryCache, domainsFilePath);
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
  const secret = process.env.SESSION_SECRET || process.env.HUB_API_KEY || processSecret('SESSION_SECRET', 'domain verification tokens');
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

// ── Funnel Publishing Routes (Modular Controller: server/routes/journeyRoutes.mjs) ──
setupJourneyRoutes(app, {
  requireUser,
  loadJourney,
  readJourney,
  saveJourney,
  loadWorkspace,
  realStoreDomain,
  validateSlugAvailability,
  reloadDomainRegistry,
  domainRegistryCache,
  savePublicPage,
  removePublicPage,
  persistPublicPages,
  publicPageCache,
  loadPublishLog,
  savePublishLog,
  loadPublicPage,
  readPublicPage,
  renderPublicFunnelHtml,
  renderPublicUpsellHtml
});


// ── Custom Brand Subdomain & CNAME Verification (Modular Controller: server/routes/domainRoutes.mjs) ──
setupDomainRoutes(app, {
  requireUser,
  domainRegistryCache,
  reloadDomainRegistry,
  verifyDomainOwnership,
  getDomainVerificationToken,
  publicPageCache,
  persistPublicPages,
  persistDomainRegistry
});

// ── Modular Public Funnel SSR & Ingestion Routes (server/routes/publicRoutes.mjs) ──
const publicCtx = {
  hub,
  hubReady,
  publicPageCache,
  persistPublicPages,
  reloadPublicPageCache,
  domainRegistryCache,
  reloadDomainRegistry,
  workspaceCache,
  realStoreDomain,
  realVariantId,
  realTrackingId,
  cleanDomain,
  pushBehavior,
  loadBehaviorBag,
  saveBehaviorBag,
  workspaceByShopDomain,
  loadContacts,
  saveContacts,
  contactOwnerId,
  loadOrders,
  saveOrders,
  loadDrips,
  saveDrips,
  recordEvent,
  signupFormsFor,
  signupSnippetForSlug,
  mintCoupon,
  userProgramBag,
  attachBehavior,
  enrollFlowsForTrigger,
  enrollLinkedMapFlows,
  enrollClaimedBehavior,
  handoffMapNodes,
  pushKlaviyoContact,
  klaviyoRow,
  writeKlaviyoRow,
  klaviyoIsSender,
  deliverLetter,
  noteSegmentChanges,
  verifyConfirmToken,
  publicBase,
  mailLinkSecret,
  loadDiscounts,
  hubStorage,
  requireUser
};
setupPublicRoutes(app, publicCtx);

// Serve frontend in production
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

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

// Express 4 does not catch a rejected async route handler, and Node exits on an unhandled
// rejection by default, so one throwing route stopped the server for every tenant. Log it and
// keep serving; the route itself still owes its caller an answer.
process.on('unhandledRejection', (reason) => {
  console.error('[Jourvance] Unhandled rejection (server kept running):', reason);
});

function registerMailEventCallback() {
  const plan = mailCallbackPlan(process.env.MAIL_EVENT_SECRET, process.env.PUBLIC_BASE_URL);
  if (!plan) {
    console.log('[Jourvance] Mail events stay off until MAIL_EVENT_SECRET and a public https PUBLIC_BASE_URL are set.');
    return;
  }
  if (!hubReady) {
    console.log('[Jourvance] Mail events stay off until the hub is connected.');
    return;
  }
  hub.email.webhook.setCallback({ url: plan.url, secret: plan.secret }).then((out) => {
    if (!out || out.error || out.success === false) console.warn('[Jourvance] Mail event callback was not registered.');
  }).catch(() => {
    console.warn('[Jourvance] Mail event callback was not registered.');
  });
}

(async () => {
  try {
    await hubStorage.rehydrateAll({
      workspaceCache,
      publicPageCache,
      sanitizeWorkspace,
      persistWorkspaces,
      persistPublicPages
    });
  } catch (err) {
    console.warn('[Jourvance] Startup rehydration notice:', err.message);
  }
  reportSamplePages();
  purgeSeededFiles();

  app.listen(PORT, () => {
    console.log(`[Jourvance] Customer Journey Spoke running at http://localhost:${PORT}`);
    startAutomationRunner();
    registerMailEventCallback();
  });
})();

