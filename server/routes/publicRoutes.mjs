/**
 * server/routes/publicRoutes.mjs
 *
 * Modular Route Controller for Public Traffic (SSR & Ingestion APIs):
 * 1. Public Funnel SSR HTML: Landing pages, Thank-You portal, Upsells & Downsells, Split routing.
 * 2. Host-Header Custom Domain Middleware: Routes offer.yourbrand.com to mapped funnel pages.
 * 3. Public API Endpoints: Lead capture, exit-intent rescue, waitlist, inquiries, upsell telemetry, event tracking, Shopify web pixel beacon, back-in-stock alerts.
 * 4. Slug & Public Storage Management: Multi-tenant slug collision protection and public page caches.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns';
import { fileURLToPath } from 'url';

import {
  shopifyId,
  cleanBehaviorEvent,
  pageBeaconScript,
  allowPixel,
  pixelKeyOk,
  configuredPublicBase,
  commerceBeaconCall
} from '../../shopify-signals.mjs';
import {
  formVariant,
  spinSlice,
  signConfirm,
  readConfirm
} from '../../audience.mjs';
import {
  storedCoupon
} from '../../email-doc.mjs';
import {
  SUPPORTED_CURRENCIES,
  convertCurrencyCharm,
  detectVisitorCurrency,
  buildLocalizedShopifyCartUrl
} from '../../src/lib/geoCurrency.ts';
import {
  verifyReviewToken,
  submitCustomerReview,
  renderReviewPortalHtml,
  getPublicVerifiedReviews,
  toggleReviewVisibility,
  renderSocialProofWallHtml
} from '../reviewEngine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const safe = (s) => (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s) ? s : crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24));

let publicCtx = null;
let hub = null;
let hubReady = false;

const getCtx = () => publicCtx || {};

export function setPublicContext(ctx) {
  publicCtx = ctx;
  if (ctx) {
    if (ctx.hub !== undefined) hub = ctx.hub;
    if (ctx.hubReady !== undefined) hubReady = Boolean(ctx.hubReady);
  }
}

export function getPublicContext() {
  return publicCtx || {};
}

// Proxied caches for seamless transparent access
export const publicPageCache = new Proxy({}, {
  get(target, prop) { return (getCtx().publicPageCache || target)[prop]; },
  set(target, prop, value) { (getCtx().publicPageCache || target)[prop] = value; return true; },
  deleteProperty(target, prop) { delete (getCtx().publicPageCache || target)[prop]; return true; },
  ownKeys(target) { return Reflect.ownKeys(getCtx().publicPageCache || target); },
  getOwnPropertyDescriptor(target, prop) { return Object.getOwnPropertyDescriptor(getCtx().publicPageCache || target, prop); }
});

export const domainRegistryCache = new Proxy({}, {
  get(target, prop) { return (getCtx().domainRegistryCache || target)[prop]; },
  set(target, prop, value) { (getCtx().domainRegistryCache || target)[prop] = value; return true; },
  deleteProperty(target, prop) { delete (getCtx().domainRegistryCache || target)[prop]; return true; },
  ownKeys(target) { return Reflect.ownKeys(getCtx().domainRegistryCache || target); },
  getOwnPropertyDescriptor(target, prop) { return Object.getOwnPropertyDescriptor(getCtx().domainRegistryCache || target, prop); }
});

export const workspaceCache = new Proxy({}, {
  get(target, prop) { return (getCtx().workspaceCache || target)[prop]; },
  set(target, prop, value) { (getCtx().workspaceCache || target)[prop] = value; return true; },
  deleteProperty(target, prop) { delete (getCtx().workspaceCache || target)[prop]; return true; },
  ownKeys(target) { return Reflect.ownKeys(getCtx().workspaceCache || target); },
  getOwnPropertyDescriptor(target, prop) { return Object.getOwnPropertyDescriptor(getCtx().workspaceCache || target, prop); }
});

// Dynamic context delegates
const loadContacts = () => (getCtx().loadContacts ? getCtx().loadContacts() : []);
const saveContacts = (contacts) => (getCtx().saveContacts ? getCtx().saveContacts(contacts) : undefined);
const contactOwnerId = (contact) => (getCtx().contactOwnerId ? getCtx().contactOwnerId(contact) : contact?.userId || '');
const realStoreDomain = (shopify) => (getCtx().realStoreDomain ? getCtx().realStoreDomain(shopify) : String(shopify?.storeDomain || '').trim().toLowerCase());
const realVariantId = (id) => (getCtx().realVariantId ? getCtx().realVariantId(id) : String(id || '').trim());
const realTrackingId = (id) => (getCtx().realTrackingId ? getCtx().realTrackingId(id) : String(id || '').trim());
const cleanDomain = (raw) => (getCtx().cleanDomain ? getCtx().cleanDomain(raw) : String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
const loadWorkspace = (uid, id) => (getCtx().loadWorkspace ? getCtx().loadWorkspace(uid, id) : null);
const workspaceByShopDomain = (domain) => (getCtx().workspaceByShopDomain ? getCtx().workspaceByShopDomain(domain) : null);
const loadOrders = () => (getCtx().loadOrders ? getCtx().loadOrders() : []);
const saveOrders = (orders) => (getCtx().saveOrders ? getCtx().saveOrders(orders) : undefined);
const loadDrips = () => (getCtx().loadDrips ? getCtx().loadDrips() : { sequences: [], enrollments: [] });
const saveDrips = (drips) => (getCtx().saveDrips ? getCtx().saveDrips(drips) : undefined);
const recordEvent = (evt) => (getCtx().recordEvent ? getCtx().recordEvent(evt) : undefined);
const signupFormsFor = (uid) => (getCtx().signupFormsFor ? getCtx().signupFormsFor(uid) : []);
const signupSnippetForSlug = (slug) => (getCtx().signupSnippetForSlug ? getCtx().signupSnippetForSlug(slug) : '');
const mintCoupon = (uid, email, spec, bag) => (getCtx().mintCoupon ? getCtx().mintCoupon(uid, email, spec, bag) : '');
const userProgramBag = (uid) => (getCtx().userProgramBag ? getCtx().userProgramBag(uid) : {});
const attachBehavior = (uid, email, opts) => (getCtx().attachBehavior ? getCtx().attachBehavior(uid, email, opts) : {});
const enrollFlowsForTrigger = (...args) => (getCtx().enrollFlowsForTrigger ? getCtx().enrollFlowsForTrigger(...args) : undefined);
const enrollLinkedMapFlows = (...args) => (getCtx().enrollLinkedMapFlows ? getCtx().enrollLinkedMapFlows(...args) : undefined);
const enrollClaimedBehavior = (...args) => (getCtx().enrollClaimedBehavior ? getCtx().enrollClaimedBehavior(...args) : undefined);
const handoffMapNodes = (...args) => (getCtx().handoffMapNodes ? getCtx().handoffMapNodes(...args) : undefined);
const pushKlaviyoContact = (...args) => (getCtx().pushKlaviyoContact ? getCtx().pushKlaviyoContact(...args) : Promise.resolve());
const klaviyoRow = (uid) => (getCtx().klaviyoRow ? getCtx().klaviyoRow(uid) : null);
const writeKlaviyoRow = (uid, row) => (getCtx().writeKlaviyoRow ? getCtx().writeKlaviyoRow(uid, row) : undefined);
const klaviyoIsSender = (uid) => (getCtx().klaviyoIsSender ? getCtx().klaviyoIsSender(uid) : false);
const deliverLetter = (...args) => (getCtx().deliverLetter ? getCtx().deliverLetter(...args) : Promise.resolve({ ok: false }));
const noteSegmentChanges = (...args) => (getCtx().noteSegmentChanges ? getCtx().noteSegmentChanges(...args) : Promise.resolve());
const verifyConfirmToken = (token) => (getCtx().verifyConfirmToken ? getCtx().verifyConfirmToken(token) : null);
const publicBase = () => (getCtx().publicBase ? getCtx().publicBase() : '');
const mailLinkSecret = () => (getCtx().mailLinkSecret ? getCtx().mailLinkSecret() : '');
const reloadPublicPageCache = () => (getCtx().reloadPublicPageCache ? getCtx().reloadPublicPageCache() : (getCtx().publicPageCache || {}));
const persistPublicPages = () => (getCtx().persistPublicPages ? getCtx().persistPublicPages() : undefined);
const reloadDomainRegistry = () => (getCtx().reloadDomainRegistry ? getCtx().reloadDomainRegistry() : (getCtx().domainRegistryCache || {}));
const pushBehavior = (uid, evt) => (getCtx().pushBehavior ? getCtx().pushBehavior(uid, evt) : undefined);
const loadBehaviorBag = (uid) => (getCtx().loadBehaviorBag ? getCtx().loadBehaviorBag(uid) : { subscriptions: [] });
const saveBehaviorBag = (uid, bag) => (getCtx().saveBehaviorBag ? getCtx().saveBehaviorBag(uid, bag) : undefined);

const pixelBuckets = new Map();


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

function appendCartAttributes(params, fields) {
  for (const [key, value] of Object.entries(fields || {})) {
    if (value) params.set(`attributes[${key}]`, String(value).slice(0, 200));
  }
}

const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GB', 'IS', 'LI', 'NO', 'CH'
]);

function buildCookieConsentWidget(options = {}) {
  const {
    enabled = true,
    geoTarget = 'eu_uk_only',
    privacyPolicyUrl = '',
    countryCode = ''
  } = options;

  if (enabled === false) return '';

  const upperCountry = String(countryCode || '').trim().toUpperCase();
  let serverRequiresConsent = false;
  let clientDetect = false;

  if (geoTarget === 'all_visitors') {
    serverRequiresConsent = true;
  } else if (upperCountry) {
    serverRequiresConsent = GDPR_COUNTRIES.has(upperCountry);
  } else {
    clientDetect = true;
  }

  const safePrivacyUrl = privacyPolicyUrl ? escapeHtml(privacyPolicyUrl) : '';

  return `
  <!-- Jourvance GDPR / CCPA Cookie Consent (Option A: Floating Frosted Pill) -->
  <style>
    .jv-cookie-consent {
      position: fixed;
      bottom: 24px;
      left: 24px;
      z-index: 99995;
      max-width: 380px;
      width: calc(100vw - 48px);
      background: rgba(18, 16, 23, 0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 14px 18px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(251, 191, 36, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Outfit", "Segoe UI", Roboto, sans-serif;
      color: #f3f4f6;
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }
    .jv-cookie-consent.jv-visible {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .jv-consent-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .jv-consent-header {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .jv-consent-sparkle {
      font-size: 13px;
      color: #fbbf24;
      line-height: 1;
    }
    .jv-consent-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #f8fafc;
    }
    .jv-consent-desc {
      font-size: 11.5px;
      line-height: 1.45;
      color: #94a3b8;
      margin: 0;
    }
    .jv-consent-link {
      color: #38bdf8;
      text-decoration: underline;
      text-underline-offset: 2px;
      transition: color 0.15s;
    }
    .jv-consent-link:hover {
      color: #7dd3fc;
    }
    .jv-consent-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }
    .jv-consent-btn-accept {
      flex: 1;
      padding: 8px 14px;
      border-radius: 9px;
      border: none;
      background: linear-gradient(135deg, #ec4899, #db2777);
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
    }
    .jv-consent-btn-accept:hover {
      opacity: 0.95;
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(236, 72, 153, 0.4);
    }
    .jv-consent-btn-decline {
      padding: 8px 14px;
      border-radius: 9px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.04);
      color: #94a3b8;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .jv-consent-btn-decline:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f1f5f9;
      border-color: rgba(255, 255, 255, 0.25);
    }
    @media (max-width: 767px) {
      .jv-cookie-consent {
        bottom: 16px;
        left: 12px;
        right: 12px;
        width: auto;
        max-width: none;
        padding: 12px 14px;
      }
      body.jv-sticky-bar-active .jv-cookie-consent {
        bottom: 78px;
      }
    }
  </style>

  <div id="jv-consent-banner" class="jv-cookie-consent" role="region" aria-label="Cookie Preferences">
    <div class="jv-consent-content">
      <div class="jv-consent-header">
        <span class="jv-consent-sparkle">✦</span>
        <span class="jv-consent-title">Privacy & Tailored Ritual</span>
      </div>
      <p class="jv-consent-desc">
        We use essential cookies to personalize your ritual, secure your checkout, and optimize performance.
        ${safePrivacyUrl ? ` <a href="${safePrivacyUrl}" target="_blank" rel="noopener noreferrer" class="jv-consent-link">Privacy Policy</a>` : ''}
      </p>
      <div class="jv-consent-actions">
        <button id="jv-consent-accept-btn" type="button" class="jv-consent-btn-accept">Accept All</button>
        <button id="jv-consent-decline-btn" type="button" class="jv-consent-btn-decline">Decline</button>
      </div>
    </div>
  </div>

  <script>
  (function() {
    window.__jvConsentRequired = ${serverRequiresConsent ? 'true' : 'false'};
    var clientDetect = ${clientDetect ? 'true' : 'false'};
    if (clientDetect && !window.__jvConsentRequired) {
      try {
        var tz = (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
        if (/^Europe\\/|London|Dublin|Paris|Berlin|Rome|Madrid|Warsaw|Amsterdam|Brussels|Vienna|Athens|Helsinki|Stockholm|Oslo|Copenhagen|Reykjavik|Zurich/i.test(tz)) {
          window.__jvConsentRequired = true;
        }
      } catch (e) {}
    }

    var banner = document.getElementById('jv-consent-banner');
    if (!banner) return;

    var existingConsent = '';
    try {
      existingConsent = localStorage.getItem('jv_consent') || '';
      if (!existingConsent) {
        var m = document.cookie.match(/(?:^|; )jv_consent=(accepted|declined)/);
        if (m) existingConsent = m[1];
      }
    } catch (e) {}

    if (window.__jvConsentRequired && !existingConsent) {
      banner.style.display = 'block';
      requestAnimationFrame(function() {
        banner.classList.add('jv-visible');
      });
    } else {
      banner.style.display = 'none';
    }

    var acceptBtn = document.getElementById('jv-consent-accept-btn');
    var declineBtn = document.getElementById('jv-consent-decline-btn');

    function closeBanner() {
      banner.classList.remove('jv-visible');
      setTimeout(function() {
        banner.style.display = 'none';
      }, 350);
    }

    if (acceptBtn) {
      acceptBtn.addEventListener('click', function() {
        try {
          localStorage.setItem('jv_consent', 'accepted');
          document.cookie = 'jv_consent=accepted; Path=/; Max-Age=31536000; SameSite=Lax';
          if (window.Shopify && window.Shopify.customerPrivacy && typeof window.Shopify.customerPrivacy.setTrackingConsent === 'function') {
            window.Shopify.customerPrivacy.setTrackingConsent(true, function(){});
          }
        } catch (e) {}
        closeBanner();
        document.dispatchEvent(new CustomEvent('visitorConsentCollected', { detail: { consent: 'accepted' } }));
      });
    }

    if (declineBtn) {
      declineBtn.addEventListener('click', function() {
        try {
          localStorage.setItem('jv_consent', 'declined');
          document.cookie = 'jv_consent=declined; Path=/; Max-Age=31536000; SameSite=Lax';
          if (window.Shopify && window.Shopify.customerPrivacy && typeof window.Shopify.customerPrivacy.setTrackingConsent === 'function') {
            window.Shopify.customerPrivacy.setTrackingConsent(false, function(){});
          }
        } catch (e) {}
        window.__jvPendingEvents = [];
        closeBanner();
        document.dispatchEvent(new CustomEvent('visitorConsentCollected', { detail: { consent: 'declined' } }));
      });
    }
  })();
  </script>`;
}

function pageConsentFrom(page, req) {
  const pData = page?.data || {};
  return {
    enabled: pData.cookieConsentEnabled !== false,
    geoTarget: pData.cookieConsentGeoTarget || 'eu_uk_only',
    privacyPolicyUrl: pData.privacyPolicyUrl || '',
    countryCode: req?.headers?.['cf-ipcountry'] || req?.headers?.['x-country-code'] || '',
    mobileStickyBarEnabled: pData.mobileStickyBarEnabled !== false
  };
}

function trackingSnippet(slug, variant, track) {
  const safeSlug = JSON.stringify(String(slug || ''));
  const safeVariant = JSON.stringify(variant === 'b' ? 'b' : 'a');
  const beacon = pageBeaconScript(track || {});
  return `<script>
window.jourvanceCanTrack = function() {
  try {
    var c = localStorage.getItem('jv_consent');
    if (!c) {
      var m = document.cookie.match(/(?:^|; )jv_consent=(accepted|declined)/);
      if (m) c = m[1];
    }
    if (c === 'declined') return false;
    if (c === 'accepted') return true;
    if (window.__jvConsentRequired && !c) return false;
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
    if (window.jourvanceCanTrack()) {
      localStorage.setItem('jv_vid', id);
      document.cookie = 'jv_vid=' + encodeURIComponent(id) + '; Path=/; Max-Age=31536000; SameSite=Lax';
    }
  } catch (e) {}
  return id;
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

function withTracking(html, slug, variant, includeForms, track, consentOptions = {}) {
  const cookieWidget = buildCookieConsentWidget(consentOptions);
  const snippet = trackingSnippet(slug, variant, track) + (includeForms ? signupSnippetForSlug(slug) : '') + cookieWidget;
  return html.includes('</body>') ? html.replace('</body>', snippet + '\n</body>') : html + snippet;
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

function renderGeoPricingSimulatorToolbar({
  activeCurrency = 'USD',
  slug = 'offer',
  isUpsell = false,
  isDownsell = false,
  hasUpsell = false,
  storeDomain = ''
}) {
  const currentCfg = SUPPORTED_CURRENCIES[activeCurrency] || SUPPORTED_CURRENCIES.USD;
  const navHref = (isUpsell || isDownsell)
    ? `/p/${encodeURIComponent(slug)}?preview=true&currency=${activeCurrency}`
    : `/p/${encodeURIComponent(slug)}/upsell?preview=true&currency=${activeCurrency}`;
  const navBase = (isUpsell || isDownsell)
    ? `/p/${encodeURIComponent(slug)}?preview=true`
    : `/p/${encodeURIComponent(slug)}/upsell?preview=true`;
  const navLabel = (isUpsell || isDownsell)
    ? `← Return to Funnel (${activeCurrency})`
    : (hasUpsell ? `Test Upsell Page (${activeCurrency}) →` : `Preview Node (${activeCurrency}) →`);

  return `
  <!-- Jourvance Multi-Currency Geo-Pricing Simulator Toolbar (Preview Mode Only) -->
  <div id="jv-geo-simulator-toolbar" class="jv-geo-simulator-toolbar" role="region" aria-label="Geo-pricing simulator toolbar">
    <div class="jv-sim-left">
      <span class="jv-sim-badge">✦ PREVIEW MODE: GEO SIMULATOR</span>
      <span class="jv-sim-rate" id="jv-sim-rate-badge">Rate: 1 USD = ${currentCfg.rateAgainstUSD} ${currentCfg.code} (${currentCfg.symbol})</span>
    </div>
    <div class="jv-sim-currencies">
      ${Object.values(SUPPORTED_CURRENCIES).map(c => `
        <button
          type="button"
          class="jv-sim-currency-btn ${c.code === activeCurrency ? 'active' : ''}"
          data-currency="${c.code}"
          title="Simulate visitor from ${c.name}"
        >
          <span>${c.flag}</span>
          <span class="jv-sim-code">${c.code}</span>
          <span class="jv-sim-sym">(${c.symbol})</span>
        </button>
      `).join('')}
    </div>
    <div class="jv-sim-right">
      <span class="jv-sim-pill" id="jv-sim-checkout-badge">Shopify Cart: ${activeCurrency === 'USD' ? 'USD (default)' : `?currency=${activeCurrency}`}</span>
      <a
        id="jv-sim-nav-link"
        href="${navHref}"
        data-base-href="${navBase}"
        class="jv-sim-link"
      >
        ${navLabel}
      </a>
    </div>
  </div>
  `;
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

  // Phase 2: Multi-Currency Geo-Pricing & Charm Pricing (Option A)
  const queryCurrency = String(req?.query?.currency || '').trim().toUpperCase();
  const cookieHeader = req?.headers?.cookie || '';
  const countryHeader = req?.headers?.['cf-ipcountry'] || req?.headers?.['x-country-code'] || '';
  const initialCurrency = (['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(queryCurrency))
    ? queryCurrency
    : detectVisitorCurrency({ cookie: cookieHeader, countryCode: countryHeader });

  const isPreviewMode = req?.query?.preview === 'true' || req?.query?.jv_qa === '1';

  const convertedProduct = productPrice ? convertCurrencyCharm(productPrice, initialCurrency, 'USD') : null;
  const initialProductPrice = convertedProduct ? convertedProduct.formatted : productPrice;
  const convertedBump = bumpPrice ? convertCurrencyCharm(bumpPrice, initialCurrency, 'USD') : null;
  const initialBumpPrice = convertedBump ? convertedBump.formatted : bumpPrice;

  // Phase 13: Live Verified UGC Social Proof Wall (Option 1A & 2A)
  const socialProofEnabled = data.socialProofWallEnabled !== false;
  const socialProofMinRating = Number(data.socialProofMinRating) || 4;
  const socialProofTitle = data.socialProofHeadline || 'Loved by Thousands of Radiant Routines';
  const socialProofData = socialProofEnabled
    ? getPublicVerifiedReviews({
        userId: page.userId,
        storeDomain,
        minRating: socialProofMinRating,
        hubStorage: hub
      })
    : { summary: {}, reviews: [] };

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
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .currency-select-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .currency-select {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #E2E8F0;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 22px 4px 10px;
      border-radius: 9999px;
      cursor: pointer;
      outline: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .currency-select:hover, .currency-select:focus {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(236, 72, 153, 0.4);
      color: #FFFFFF;
    }
    .currency-select-wrap::after {
      content: '▾';
      position: absolute;
      right: 8px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.6);
      pointer-events: none;
    }
    .currency-select option {
      background: #0F172A;
      color: #FFFFFF;
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

    /* Geo-Pricing Simulator Toolbar (Preview Mode Only) */
    .jv-geo-simulator-toolbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999999;
      background: rgba(11, 15, 25, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(244, 114, 182, 0.3);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    }
    .jv-sim-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .jv-sim-badge {
      background: linear-gradient(135deg, rgba(236, 72, 153, 0.25), rgba(147, 51, 234, 0.25));
      border: 1px solid rgba(236, 72, 153, 0.45);
      color: #F472B6;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .jv-sim-rate {
      color: #94A3B8;
      font-size: 11px;
      font-weight: 500;
    }
    .jv-sim-currencies {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .jv-sim-currency-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #CBD5E1;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
      font-family: inherit;
    }
    .jv-sim-currency-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(244, 114, 182, 0.4);
      color: #FFFFFF;
      transform: translateY(-1px);
    }
    .jv-sim-currency-btn.active {
      background: rgba(236, 72, 153, 0.25);
      border-color: #EC4899;
      color: #FFFFFF;
      box-shadow: 0 0 10px rgba(236, 72, 153, 0.35);
    }
    .jv-sim-code {
      font-weight: 700;
    }
    .jv-sim-sym {
      color: #94A3B8;
    }
    .jv-sim-currency-btn.active .jv-sim-sym {
      color: #FCE7F3;
    }
    .jv-sim-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .jv-sim-pill {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34D399;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
    }
    .jv-sim-link {
      color: #38BDF8;
      text-decoration: none;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s ease;
    }
    .jv-sim-link:hover {
      color: #7DD3FC;
      text-decoration: underline;
    }
  </style>
</head>
<body>

  ${isPreviewMode ? renderGeoPricingSimulatorToolbar({ activeCurrency: initialCurrency, slug, isUpsell: false, isDownsell: false, hasUpsell: Boolean(rawData.hasUpsell || rawData.upsell), storeDomain }) : ''}

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
    <div class="header-actions">
      <div class="currency-select-wrap">
        <select id="jv-currency-select" class="currency-select" aria-label="Select currency">
          ${Object.values(SUPPORTED_CURRENCIES).map(c => `
            <option value="${c.code}" ${c.code === initialCurrency ? 'selected' : ''}>
              ${c.flag} ${c.code} (${c.symbol})
            </option>
          `).join('')}
        </select>
      </div>
      ${storeDomain ? `<div class="secure-pill"><span>Checkout continues on ${escapeHtml(storeDomain)}</span></div>` : ''}
    </div>
  </header>

  <main>
    <div class="offer-card">
      <div class="image-wrap">
        <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(headline)}" id="product-img">
        ${productPrice ? `<div class="price-tag" id="product-price" data-base-price="${escapeHtml(productPrice)}">${escapeHtml(initialProductPrice)}</div>` : ''}
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
                <span class="bump-product-price" data-base-price="${escapeHtml(bumpPrice)}">${escapeHtml(initialBumpPrice)}</span>
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

    ${socialProofEnabled ? renderSocialProofWallHtml(socialProofData.summary, socialProofData.reviews, { brandColor: '#ec4899', title: socialProofTitle }) : ''}
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
                <span class="bump-product-price" data-base-price="${escapeHtml(bumpPrice)}">${escapeHtml(initialBumpPrice)}</span>
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

      // Phase 2: Client-Side Multi-Currency Switcher & Charm Pricing Engine
      const CURRENCY_CONFIG = {
        USD: { rate: 1.0, prefix: '$' },
        EUR: { rate: 0.92, prefix: '€' },
        GBP: { rate: 0.79, prefix: '£' },
        CAD: { rate: 1.36, prefix: 'CA$' },
        AUD: { rate: 1.52, prefix: 'A$' }
      };
      let activeCurrency = ${JSON.stringify(initialCurrency)};

      function formatCharmPrice(baseStr, targetCurr) {
        if (!baseStr) return '';
        var cfg = CURRENCY_CONFIG[targetCurr] || CURRENCY_CONFIG.USD;
        var num = parseFloat(String(baseStr).replace(/[^0-9.-]/g, ''));
        if (!num || isNaN(num) || num <= 0) return baseStr;
        var rawClean = String(baseStr);
        var hasDecimals = rawClean.indexOf('.') !== -1;
        var ending = 'raw';
        if (rawClean.endsWith('.99') || rawClean.endsWith('99')) ending = '99';
        else if (rawClean.endsWith('.95') || rawClean.endsWith('95')) ending = '95';
        else if (!hasDecimals || rawClean.endsWith('.00')) ending = '00';

        var rawConverted = num * cfg.rate;
        var charmAmount = rawConverted;
        if (ending === '99') {
          charmAmount = Math.max(1, Math.round(rawConverted - 0.99)) + 0.99;
        } else if (ending === '95') {
          charmAmount = Math.max(1, Math.round(rawConverted - 0.95)) + 0.95;
        } else {
          charmAmount = Math.max(1, Math.round(rawConverted));
        }
        var numStr = (hasDecimals || ending !== '00') ? charmAmount.toFixed(2) : Math.round(charmAmount).toString();
        return cfg.prefix + numStr;
      }

      function syncSimulatorToolbar(code) {
        var simToolbar = document.getElementById('jv-geo-simulator-toolbar');
        if (!simToolbar) return;
        var btns = simToolbar.querySelectorAll('.jv-sim-currency-btn');
        btns.forEach(function(b) {
          if (b.getAttribute('data-currency') === code) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
        var rateBadge = document.getElementById('jv-sim-rate-badge');
        if (rateBadge) {
          var cfg = CURRENCY_CONFIG[code] || CURRENCY_CONFIG.USD;
          rateBadge.textContent = 'Rate: 1 USD = ' + cfg.rate + ' ' + code + ' (' + cfg.symbol + ')';
        }
        var navLink = document.getElementById('jv-sim-nav-link');
        if (navLink) {
          var baseHref = navLink.getAttribute('data-base-href') || navLink.href;
          try {
            var u2 = new URL(baseHref, window.location.origin);
            u2.searchParams.set('currency', code);
            navLink.href = u2.toString();
          } catch(e){}
        }
        var checkoutBadge = document.getElementById('jv-sim-checkout-badge');
        if (checkoutBadge) {
          checkoutBadge.textContent = 'Shopify Cart: ' + (code === 'USD' ? 'USD (default)' : '?currency=' + code);
        }
      }

      function applyCurrency(code) {
        if (!CURRENCY_CONFIG[code]) return;
        activeCurrency = code;
        try {
          document.cookie = 'jv_currency=' + encodeURIComponent(code) + '; path=/; max-age=2592000; SameSite=Lax';
        } catch(e){}

        var selectEl = document.getElementById('jv-currency-select');
        if (selectEl && selectEl.value !== code) {
          selectEl.value = code;
        }

        var priceElements = document.querySelectorAll('[data-base-price]');
        priceElements.forEach(function(el) {
          var base = el.getAttribute('data-base-price');
          if (base) {
            el.textContent = formatCharmPrice(base, code);
          }
        });

        syncSimulatorToolbar(code);
      }

      var currencySelect = document.getElementById('jv-currency-select');
      if (currencySelect) {
        currencySelect.addEventListener('change', function(e) {
          applyCurrency(e.target.value);
        });
      }

      var simButtons = document.querySelectorAll('.jv-sim-currency-btn');
      simButtons.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          var c = this.getAttribute('data-currency');
          if (c) applyCurrency(c);
        });
      });

      // Timezone fallback if initial is USD and no sticky cookie is saved
      (function() {
        if (document.cookie.indexOf('jv_currency=') !== -1) return;
        try {
          var tz = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase();
          var detected = null;
          if (tz.indexOf('london') !== -1 || tz.indexOf('belfast') !== -1) detected = 'GBP';
          else if (tz.indexOf('europe/') === 0) detected = 'EUR';
          else if (tz.indexOf('australia/') === 0 || tz.indexOf('pacific/auckland') === 0) detected = 'AUD';
          else if (tz.indexOf('toronto') !== -1 || tz.indexOf('vancouver') !== -1 || tz.indexOf('montreal') !== -1) detected = 'CAD';
          if (detected && detected !== activeCurrency) {
            applyCurrency(detected);
          }
        } catch(e){}
      })();

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
        if (activeCurrency && activeCurrency !== 'USD') out.set('currency', activeCurrency);
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
          try { fbq('track', 'InitiateCheckout', { content_name: '${escapeHtml(productTitle)}', currency: activeCurrency || 'USD' }); } catch(e){}
        }
        if (window.ttq) {
          try { ttq.track('InitiateCheckout', { content_name: '${escapeHtml(productTitle)}', currency: activeCurrency || 'USD' }); } catch(e){}
        }
        if (window.gtag) {
          try { gtag('event', 'begin_checkout', { items: [{ item_name: '${escapeHtml(productTitle)}' }], currency: activeCurrency || 'USD' }); } catch(e){}
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
                currency: activeCurrency,
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
                  currency: activeCurrency,
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
      <div id="jv-sticky-product-price" data-base-price="${escapeHtml(productPrice)}" style="font-size:12px; font-weight:800; color:#34D399; margin-top:1px;">
        ${escapeHtml(initialProductPrice)}
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
          document.body.classList.add('jv-sticky-bar-active');
        } else {
          stickyBar.style.display = 'none';
          document.body.classList.remove('jv-sticky-bar-active');
        }
      }, { passive: true });
    })();
  </script>
  ` : ''}
</body>
</html>`;
}

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

  // Phase 2: Multi-Currency Geo-Pricing
  const queryCurrency = String(req?.query?.currency || '').trim().toUpperCase();
  const cookieHeader = req?.headers?.cookie || '';
  const countryHeader = req?.headers?.['cf-ipcountry'] || req?.headers?.['x-country-code'] || '';
  const activeCurrency = (['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(queryCurrency))
    ? queryCurrency
    : detectVisitorCurrency({ cookie: cookieHeader, countryCode: countryHeader });

  const isPreviewMode = req?.query?.preview === 'true' || req?.query?.jv_qa === '1';

  // Price calculations with optional courtesy discount & Option A charm pricing
  const numericBasePrice = parseFloat(String(rawProductPrice).replace(/[^0-9.]/g, '')) || 0;
  let finalPriceStr = rawProductPrice ? convertCurrencyCharm(rawProductPrice, activeCurrency, 'USD').formatted : rawProductPrice;
  let finalStrikethroughStr = regularPrice ? convertCurrencyCharm(regularPrice, activeCurrency, 'USD').formatted : regularPrice;
  let recordedAmount = numericBasePrice;

  if (isCourtesyRecovery && numericBasePrice > 0 && !isCourtesyExpired) {
    const discountedNum = Number((numericBasePrice * 0.9).toFixed(2));
    finalPriceStr = convertCurrencyCharm(discountedNum, activeCurrency, 'USD').formatted;
    finalStrikethroughStr = rawProductPrice ? convertCurrencyCharm(rawProductPrice, activeCurrency, 'USD').formatted : regularPrice;
    recordedAmount = discountedNum;
  }

  const acceptText = (isCourtesyRecovery && !isCourtesyExpired)
    ? `${baseAcceptText} (10% Courtesy Off Applied)`
    : baseAcceptText;

  const accentColor = isDownsell ? '#F59E0B' : '#10B981';
  const accentGradient = isDownsell ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'linear-gradient(135deg, #10B981, #059669)';
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  const nextDeclineBase = (!isDownsell && (d.hasDownsell || d.downsell)) ? `/p/${slug}/downsell` : `/p/${slug}/thank-you`;
  const nextDeclineUrl = activeCurrency !== 'USD' ? `${nextDeclineBase}?currency=${activeCurrency}` : nextDeclineBase;
  const rawCheckoutUrl = storeDomain && variantId
    ? `https://${storeDomain}/cart/${variantId}:1${(effectiveCoupon && !isCourtesyExpired) ? `?discount=${encodeURIComponent(effectiveCoupon)}` : ''}`
    : '';
  const checkoutUrl = rawCheckoutUrl ? buildLocalizedShopifyCartUrl(rawCheckoutUrl, activeCurrency) : '';

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
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .currency-select-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .currency-select {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #E2E8F0;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 22px 4px 10px;
      border-radius: 9999px;
      cursor: pointer;
      outline: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.2s ease;
      font-family: inherit;
    }
    .currency-select:hover, .currency-select:focus {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(236, 72, 153, 0.4);
      color: #FFFFFF;
    }
    .currency-select-wrap::after {
      content: '▾';
      position: absolute;
      right: 8px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.6);
      pointer-events: none;
    }
    .currency-select option {
      background: #0F172A;
      color: #FFFFFF;
    }

    /* Geo-Pricing Simulator Toolbar (Preview Mode Only) */
    .jv-geo-simulator-toolbar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      width: 100%;
      z-index: 999999;
      background: rgba(11, 15, 25, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(244, 114, 182, 0.3);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      margin-bottom: 20px;
    }
    .jv-sim-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .jv-sim-badge {
      background: linear-gradient(135deg, rgba(236, 72, 153, 0.25), rgba(147, 51, 234, 0.25));
      border: 1px solid rgba(236, 72, 153, 0.45);
      color: #F472B6;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .jv-sim-rate {
      color: #94A3B8;
      font-size: 11px;
      font-weight: 500;
    }
    .jv-sim-currencies {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .jv-sim-currency-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #CBD5E1;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      outline: none;
      font-family: inherit;
    }
    .jv-sim-currency-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(244, 114, 182, 0.4);
      color: #FFFFFF;
      transform: translateY(-1px);
    }
    .jv-sim-currency-btn.active {
      background: rgba(236, 72, 153, 0.25);
      border-color: #EC4899;
      color: #FFFFFF;
      box-shadow: 0 0 10px rgba(236, 72, 153, 0.35);
    }
    .jv-sim-code {
      font-weight: 700;
    }
    .jv-sim-sym {
      color: #94A3B8;
    }
    .jv-sim-currency-btn.active .jv-sim-sym {
      color: #FCE7F3;
    }
    .jv-sim-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .jv-sim-pill {
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34D399;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 600;
    }
    .jv-sim-link {
      color: #38BDF8;
      text-decoration: none;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s ease;
    }
    .jv-sim-link:hover {
      color: #7DD3FC;
      text-decoration: underline;
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
  ${isPreviewMode ? renderGeoPricingSimulatorToolbar({ activeCurrency, slug, isUpsell: !isDownsell, isDownsell, hasUpsell: false, storeDomain }) : ''}
  <div class="container">
    <header class="upsell-header" style="width: 100%; display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <div class="brand" style="font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.02em;">${escapeHtml(storeDomain.split('.')[0] || 'JOURVANCE')}</div>
      <div class="header-actions" style="display: flex; align-items: center; gap: 10px;">
        <div class="currency-select-wrap">
          <select id="jv-currency-select" class="currency-select" aria-label="Select currency">
            ${Object.values(SUPPORTED_CURRENCIES).map(c => `
              <option value="${c.code}" ${c.code === activeCurrency ? 'selected' : ''}>
                ${c.flag} ${c.code} (${c.symbol})
              </option>
            `).join('')}
          </select>
        </div>
        ${storeDomain ? `<div class="secure-pill"><span>Checkout continues on ${escapeHtml(storeDomain)}</span></div>` : ''}
      </div>
    </header>

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
            ${finalPriceStr ? `<span id="jv-upsell-price" data-base-price="${escapeHtml(rawProductPrice)}" data-discounted-base="${(isCourtesyRecovery && numericBasePrice > 0 && !isCourtesyExpired) ? (numericBasePrice * 0.9).toFixed(2) : ''}" class="price-special">${escapeHtml(finalPriceStr)}</span>` : ''}
            ${finalStrikethroughStr ? `<span id="jv-regular-price" data-base-price="${escapeHtml(regularPrice || rawProductPrice)}" class="price-reg">${escapeHtml(finalStrikethroughStr)}</span>` : ''}
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
        data-base-checkout-url="${escapeHtml(rawCheckoutUrl || '')}"
        class="btn-accept"
      >
        ${escapeHtml(acceptText)}
      </a>

      <!-- Decline Option -->
      <a
        id="jv-decline-btn"
        href="${escapeHtml(nextDeclineUrl)}"
        data-base-decline-url="${escapeHtml(nextDeclineBase)}"
        class="decline-link"
      >
        ${escapeHtml(declineText)}
      </a>
    </div>`}

  </div>

  <script>
    var CURRENCY_CONFIG = {
      USD: { rate: 1.0, prefix: '$', symbol: '$' },
      EUR: { rate: 0.92, prefix: '€', symbol: '€' },
      GBP: { rate: 0.79, prefix: '£', symbol: '£' },
      CAD: { rate: 1.36, prefix: 'CA$', symbol: 'CA$' },
      AUD: { rate: 1.52, prefix: 'A$', symbol: 'A$' }
    };

    let activeCurrency = ${JSON.stringify(activeCurrency)};

    function formatCharmPrice(baseStr, targetCurr) {
      if (!baseStr) return '';
      var cfg = CURRENCY_CONFIG[targetCurr] || CURRENCY_CONFIG.USD;
      var num = parseFloat(String(baseStr).replace(/[^0-9.-]/g, ''));
      if (!num || isNaN(num) || num <= 0) return baseStr;
      var rawClean = String(baseStr);
      var hasDecimals = rawClean.indexOf('.') !== -1;
      var ending = 'raw';
      if (rawClean.endsWith('.99') || rawClean.endsWith('99')) ending = '99';
      else if (rawClean.endsWith('.95') || rawClean.endsWith('95')) ending = '95';
      else if (!hasDecimals || rawClean.endsWith('.00')) ending = '00';

      var rawConverted = num * cfg.rate;
      var charmAmount = rawConverted;
      if (ending === '99') {
        charmAmount = Math.max(1, Math.round(rawConverted - 0.99)) + 0.99;
      } else if (ending === '95') {
        charmAmount = Math.max(1, Math.round(rawConverted - 0.95)) + 0.95;
      } else {
        charmAmount = Math.max(1, Math.round(rawConverted));
      }
      var numStr = (hasDecimals || ending !== '00') ? charmAmount.toFixed(2) : Math.round(charmAmount).toString();
      return cfg.prefix + numStr;
    }

    function syncSimulatorToolbar(code) {
      var simToolbar = document.getElementById('jv-geo-simulator-toolbar');
      if (!simToolbar) return;
      var btns = simToolbar.querySelectorAll('.jv-sim-currency-btn');
      btns.forEach(function(b) {
        if (b.getAttribute('data-currency') === code) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      var rateBadge = document.getElementById('jv-sim-rate-badge');
      if (rateBadge) {
        var cfg = CURRENCY_CONFIG[code] || CURRENCY_CONFIG.USD;
        rateBadge.textContent = 'Rate: 1 USD = ' + cfg.rate + ' ' + code + ' (' + cfg.symbol + ')';
      }
      var navLink = document.getElementById('jv-sim-nav-link');
      if (navLink) {
        var baseHref = navLink.getAttribute('data-base-href') || navLink.href;
        try {
          var u2 = new URL(baseHref, window.location.origin);
          u2.searchParams.set('currency', code);
          navLink.href = u2.toString();
        } catch(e){}
      }
      var checkoutBadge = document.getElementById('jv-sim-checkout-badge');
      if (checkoutBadge) {
        checkoutBadge.textContent = 'Shopify Cart: ' + (code === 'USD' ? 'USD (default)' : '?currency=' + code);
      }
    }

    function applyCurrency(code) {
      if (!CURRENCY_CONFIG[code]) return;
      activeCurrency = code;
      try {
        document.cookie = 'jv_currency=' + encodeURIComponent(code) + '; path=/; max-age=2592000; SameSite=Lax';
      } catch(e){}

      var selectEl = document.getElementById('jv-currency-select');
      if (selectEl && selectEl.value !== code) {
        selectEl.value = code;
      }

      var upsellPriceEl = document.getElementById('jv-upsell-price');
      if (upsellPriceEl) {
        var discBase = upsellPriceEl.getAttribute('data-discounted-base');
        var base = discBase || upsellPriceEl.getAttribute('data-base-price');
        if (base) {
          upsellPriceEl.textContent = formatCharmPrice(base, code);
        }
      }

      var regPriceEl = document.getElementById('jv-regular-price');
      if (regPriceEl) {
        var regBase = regPriceEl.getAttribute('data-base-price');
        if (regBase) {
          regPriceEl.textContent = formatCharmPrice(regBase, code);
        }
      }

      var acceptBtn = document.getElementById('jv-accept-btn');
      if (acceptBtn) {
        var baseCart = acceptBtn.getAttribute('data-base-checkout-url');
        if (baseCart) {
          try {
            var u = new URL(baseCart, window.location.origin);
            if (code !== 'USD') {
              u.searchParams.set('currency', code);
            } else {
              u.searchParams.delete('currency');
            }
            acceptBtn.href = u.toString();
          } catch(e){
            var sep = baseCart.indexOf('?') !== -1 ? '&' : '?';
            acceptBtn.href = code !== 'USD' ? (baseCart + sep + 'currency=' + code) : baseCart;
          }
        }
      }

      var declineBtn = document.getElementById('jv-decline-btn');
      if (declineBtn) {
        var baseDecline = declineBtn.getAttribute('data-base-decline-url');
        if (baseDecline) {
          declineBtn.href = code !== 'USD' ? (baseDecline + '?currency=' + code) : baseDecline;
        }
      }

      syncSimulatorToolbar(code);
    }

    var currencySelect = document.getElementById('jv-currency-select');
    if (currencySelect) {
      currencySelect.addEventListener('change', function(e) {
        applyCurrency(e.target.value);
      });
    }

    var simButtons = document.querySelectorAll('.jv-sim-currency-btn');
    simButtons.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        var c = this.getAttribute('data-currency');
        if (c) applyCurrency(c);
      });
    });

    (function() {
      if (document.cookie.indexOf('jv_currency=') !== -1) return;
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase();
        var detected = null;
        if (tz.indexOf('london') !== -1 || tz.indexOf('belfast') !== -1) detected = 'GBP';
        else if (tz.indexOf('europe/') === 0) detected = 'EUR';
        else if (tz.indexOf('australia/') === 0 || tz.indexOf('pacific/auckland') === 0) detected = 'AUD';
        else if (tz.indexOf('toronto') !== -1 || tz.indexOf('vancouver') !== -1 || tz.indexOf('montreal') !== -1) detected = 'CAD';
        if (detected && detected !== activeCurrency) {
          applyCurrency(detected);
        }
      } catch(e){}
    })();

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
              currency: activeCurrency,
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

const PUBLIC_EVENT_TYPES = new Set(['page_view', 'checkout_start', 'thank_you_view', 'upsell_view', 'product_viewed', 'collection_viewed', 'added_to_cart']);


export {
  savedPrice,
  pageTrackFrom,
  appendCartAttributes,
  trackingSnippet,
  withTracking,
  pubDocName,
  savePublicPage,
  loadPublicPage,
  RESERVED_PUBLIC_SLUGS,
  validateSlugAvailability,
  removePublicPage,
  escapeHtml,
  render404Html,
  resolveSplitVariant,
  renderPublicFunnelHtml,
  renderPublicThankYouHtml,
  renderPublicUpsellHtml,
  renderGeoPricingSimulatorToolbar,
  confirmUrl,
  grantFormCoupon,
  isLeadRateLimited
};

export function setupPublicRoutes(app, ctx) {
  setPublicContext(ctx);


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
    const consent = pageConsentFrom(page, req);
    if (req.path === '/thank-you' || req.path === `/${page.slug}/thank-you`) {
      const html = withTracking(renderPublicThankYouHtml(page, req, res), page.slug, 'a', false, undefined, consent);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/upsell' || req.path === `/${page.slug}/upsell`) {
      const html = withTracking(renderPublicUpsellHtml(page, req, res, false), page.slug, 'a', false, undefined, consent);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/downsell' || req.path === `/${page.slug}/downsell`) {
      const html = withTracking(renderPublicUpsellHtml(page, req, res, true), page.slug, 'a', false, undefined, consent);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    if (req.path === '/' || req.path === `/${page.slug}` || req.path.startsWith('/p/')) {
      const html = withTracking(renderPublicFunnelHtml(page, req, res), page.slug, 'a', true, pageTrackFrom(page), consent);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  }
  next();
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

  // Phase 2: Localize checkout permalink with visitor/selected currency
  const requestedCurrency = req.body?.currency || detectVisitorCurrency({
    cookie: req.headers?.cookie,
    countryCode: req.headers?.['cf-ipcountry'] || req.headers?.['x-country-code']
  });
  if (checkoutUrl) {
    checkoutUrl = buildLocalizedShopifyCartUrl(checkoutUrl, requestedCurrency);
  }

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
        currency: requestedCurrency,
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

// Public Upsell / Downsell SSR Routes (Wave 9)
app.get(['/p/:slug/upsell', '/p/:wsId/:slug/upsell'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicUpsellHtml(page, req, res, false), slug, 'a', false, undefined, pageConsentFrom(page, req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get(['/p/:slug/downsell', '/p/:wsId/:slug/downsell'], async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const page = await loadPublicPage(slug);
  if (!page || !page.data) {
    return res.status(404).send(render404Html(slug));
  }
  const html = withTracking(renderPublicUpsellHtml(page, req, res, true), slug, 'a', false, undefined, pageConsentFrom(page, req));
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
  const html = withTracking(renderPublicThankYouHtml(page, req, res), slug, 'a', false, undefined, pageConsentFrom(page, req));
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
  const html = withTracking(renderPublicFunnelHtml(page, req, res), slug, 'a', true, pageTrackFrom(page), pageConsentFrom(page, req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

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

// ── 14. Review & UGC Portal Routes (Wave 12) ──
app.get(['/review', '/r/review'], (req, res) => {
  const orderId = String(req.query.order || req.query.order_id || req.query.orderId || '').trim();
  const email = String(req.query.email || '').toLowerCase().trim();
  const token = String(req.query.token || '').trim();

  const orders = loadOrders();
  const order = orders.find(o => String(o.id) === orderId || (email && String(o.customerEmail || '').toLowerCase() === email));
  const verified = Boolean(orderId && email && token && verifyReviewToken(orderId, email, token));

  let storeName = 'Jourvance';
  let storeDomain = '';
  if (order?.userId) {
    const ws = Object.values(workspaceCache).find(w => w.userId === order.userId);
    if (ws?.brandName) storeName = ws.brandName;
    if (ws?.shopifyConfig) storeDomain = realStoreDomain(ws.shopifyConfig);
  }

  const html = renderReviewPortalHtml({
    orderId: orderId || order?.id || 'VIP',
    email: email || order?.customerEmail || '',
    token,
    storeName,
    storeDomain,
    verified,
    discountCode: 'REVIEW10'
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/api/public/review', async (req, res) => {
  try {
    const body = req.body || {};
    const orderId = String(body.orderId || body.order_id || '').trim();
    const email = String(body.email || body.customerEmail || '').toLowerCase().trim();
    const token = String(body.token || '').trim();
    const rating = Number(body.rating) || 5;
    const reviewTitle = String(body.reviewTitle || body.title || '').trim();
    const reviewText = String(body.reviewText || body.body || body.text || '').trim();
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const customerName = String(body.customerName || body.name || '').trim();

    if (!orderId || !email) {
      return res.status(400).json({ error: 'Order ID and email are required to verify your review.' });
    }

    // Cryptographic token validation
    const tokenValid = token ? verifyReviewToken(orderId, email, token) : false;
    if (!tokenValid && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Invalid or expired review verification token.' });
    }

    const orders = loadOrders();
    const order = orders.find(o => String(o.id) === orderId || String(o.customerEmail || '').toLowerCase() === email);
    const userId = order?.userId || 'usr_default';
    const ws = Object.values(workspaceCache).find(w => w.userId === userId);
    const storeDomain = ws?.shopifyConfig ? realStoreDomain(ws.shopifyConfig) : '';

    const submissionResult = submitCustomerReview({
      orderId,
      customerEmail: email,
      customerName: customerName || order?.customerName || email.split('@')[0],
      rating,
      reviewTitle,
      reviewText,
      tags,
      storeDomain,
      userId,
      discountCode: 'REVIEW10',
      hubStorage: hub,
      loadDrips,
      saveDrips,
      loadContacts,
      saveContacts
    });

    return res.status(200).json(submissionResult);
  } catch (err) {
    console.error('[Jourvance Review Engine] Error submitting review:', err);
    return res.status(500).json({ error: 'Failed to process review submission: ' + err.message });
  }
});

// ── 15. Live Verified UGC Social Proof Public API ──
app.get('/api/public/reviews/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const page = await loadPublicPage(slug);
    const userId = page?.userId || 'usr_default';
    const storeDomain = page?.shopifyConfig ? realStoreDomain(page.shopifyConfig) : '';
    const minRating = Number(req.query.minRating || page?.data?.socialProofMinRating || 4);

    const reviewsData = getPublicVerifiedReviews({
      userId,
      storeDomain,
      minRating,
      limit: 15,
      hubStorage: hub
    });

    return res.status(200).json({
      success: true,
      slug,
      summary: reviewsData.summary,
      reviews: reviewsData.reviews
    });
  } catch (err) {
    console.error('[Jourvance UGC API] Error fetching public reviews:', err);
    return res.status(500).json({ error: 'Failed to retrieve reviews' });
  }
});

app.post('/api/reviews/:id/visibility', async (req, res) => {
  try {
    const reviewId = String(req.params.id || '').trim();
    const hidden = req.body?.hidden !== false;
    const updated = toggleReviewVisibility(reviewId, hidden, hub);
    if (!updated) {
      return res.status(404).json({ error: 'Review not found' });
    }
    return res.status(200).json({ success: true, review: updated });
  } catch (err) {
    console.error('[Jourvance Review Visibility] Error:', err);
    return res.status(500).json({ error: 'Failed to update review visibility' });
  }
});


  return {
    loadPublicPage,
    savePublicPage,
    removePublicPage,
    validateSlugAvailability,
    renderPublicFunnelHtml,
    renderPublicThankYouHtml,
    renderPublicUpsellHtml,
    renderGeoPricingSimulatorToolbar,
    render404Html,
    resolveSplitVariant,
    withTracking,
    trackingSnippet,
    pageTrackFrom,
    escapeHtml
  };
}
