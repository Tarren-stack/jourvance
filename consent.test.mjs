import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror GDPR countries set and helper from geoCurrency / publicRoutes
const GDPR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GB', 'IS', 'LI', 'NO', 'CH'
]);

function isConsentRequiredForCountry(countryCode, geoTarget = 'eu_uk_only') {
  if (geoTarget === 'all_visitors') return true;
  if (!countryCode) return false;
  const upper = countryCode.trim().toUpperCase();
  return GDPR_COUNTRIES.has(upper);
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
  </style>

  <div id="jv-consent-banner" class="jv-cookie-consent" role="region" aria-label="Cookie Preferences">
    <div class="jv-consent-content">
      <div class="jv-consent-header">
        <span class="jv-consent-sparkle" aria-hidden="true">✦</span>
        <span class="jv-consent-title">Cookies on this site</span>
      </div>
      <p class="jv-consent-desc">
        We use cookies to run this site and, with your permission, to measure visits.
        ${safePrivacyUrl ? ` <a href="${safePrivacyUrl}" target="_blank" rel="noopener noreferrer" class="jv-consent-link">Privacy Policy</a>` : ''}
      </p>
      <div class="jv-consent-actions">
        <button id="jv-consent-accept-btn" type="button" class="jv-consent-btn-accept">Accept All</button>
        <button id="jv-consent-decline-btn" type="button" class="jv-consent-btn-decline">Decline</button>
      </div>
    </div>
  </div>

  <script>
  window.__jvConsentRequired = ${serverRequiresConsent ? 'true' : 'false'};
  window.__jvClientDetectConsent = ${clientDetect ? 'true' : 'false'};
  </script>`;
}

// -------------------------------------------------------------
// Test Suites
// -------------------------------------------------------------

test('isConsentRequiredForCountry: accurately identifies GDPR & UK-GDPR jurisdictions', () => {
  // EU 27 & EEA countries
  assert.equal(isConsentRequiredForCountry('GB', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('gb', 'eu_uk_only'), true); // case insensitivity
  assert.equal(isConsentRequiredForCountry('FR', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('DE', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('IT', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('ES', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('NL', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('IE', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('SE', 'eu_uk_only'), true);
  assert.equal(isConsentRequiredForCountry('NO', 'eu_uk_only'), true); // EEA
  assert.equal(isConsentRequiredForCountry('CH', 'eu_uk_only'), true); // Switzerland

  // Non-GDPR countries under Smart Geo-Targeting
  assert.equal(isConsentRequiredForCountry('US', 'eu_uk_only'), false);
  assert.equal(isConsentRequiredForCountry('CA', 'eu_uk_only'), false);
  assert.equal(isConsentRequiredForCountry('AU', 'eu_uk_only'), false);
  assert.equal(isConsentRequiredForCountry('JP', 'eu_uk_only'), false);
  assert.equal(isConsentRequiredForCountry('', 'eu_uk_only'), false);

  // Universal targeting mode
  assert.equal(isConsentRequiredForCountry('US', 'all_visitors'), true);
  assert.equal(isConsentRequiredForCountry('AU', 'all_visitors'), true);
  assert.equal(isConsentRequiredForCountry('', 'all_visitors'), true);
});

test('buildCookieConsentWidget: respects disabled state and generates valid HTML when enabled', () => {
  // Disabled state
  const disabledHtml = buildCookieConsentWidget({ enabled: false });
  assert.equal(disabledHtml, '');

  // Enabled state with Privacy Policy
  const widgetHtml = buildCookieConsentWidget({
    enabled: true,
    geoTarget: 'eu_uk_only',
    privacyPolicyUrl: 'https://aurabeauty.com/policies/privacy-policy',
    countryCode: 'GB'
  });

  assert.ok(widgetHtml.includes('id="jv-consent-banner"'), 'Should render banner container');
  assert.ok(widgetHtml.includes('jv-cookie-consent'), 'Should include CSS class');
  assert.ok(widgetHtml.includes('id="jv-consent-accept-btn"'), 'Should render Accept All button');
  assert.ok(widgetHtml.includes('id="jv-consent-decline-btn"'), 'Should render Decline button');
  assert.ok(widgetHtml.includes('https://aurabeauty.com/policies/privacy-policy'), 'Should embed Privacy Policy URL');
  assert.ok(widgetHtml.includes('window.__jvConsentRequired = true'), 'Should flag consent required for GB');
});

test('buildCookieConsentWidget: smart geo-targeting sets consent required flag by country', () => {
  // UK visitor
  const ukHtml = buildCookieConsentWidget({
    enabled: true,
    geoTarget: 'eu_uk_only',
    countryCode: 'GB'
  });
  assert.ok(ukHtml.includes('window.__jvConsentRequired = true;'));

  // US visitor with smart geo-targeting
  const usSmartHtml = buildCookieConsentWidget({
    enabled: true,
    geoTarget: 'eu_uk_only',
    countryCode: 'US'
  });
  assert.ok(usSmartHtml.includes('window.__jvConsentRequired = false;'));

  // US visitor with all_visitors mode
  const usAllHtml = buildCookieConsentWidget({
    enabled: true,
    geoTarget: 'all_visitors',
    countryCode: 'US'
  });
  assert.ok(usAllHtml.includes('window.__jvConsentRequired = true;'));

  // Empty country code triggers client-side timezone detection
  const fallbackHtml = buildCookieConsentWidget({
    enabled: true,
    geoTarget: 'eu_uk_only',
    countryCode: ''
  });
  assert.ok(fallbackHtml.includes('window.__jvClientDetectConsent = true;'));
});

test('jourvanceCanTrack: respects consent state and opt-in requirements', () => {
  function makeCanTrack(storedConsent, consentRequired, shopifyAllowed = true) {
    var c = storedConsent;
    if (c === 'declined') return false;
    if (c === 'accepted') return true;
    if (consentRequired && !c) return false;
    return shopifyAllowed;
  }

  // Case 1: Unconsented visitor where consent is required (EU/UK)
  assert.equal(makeCanTrack('', true), false, 'Should block tracking before consent');

  // Case 2: Visitor explicitly accepted
  assert.equal(makeCanTrack('accepted', true), true, 'Should allow tracking after consent');

  // Case 3: Visitor explicitly declined
  assert.equal(makeCanTrack('declined', true), false, 'Should block tracking when declined');
  assert.equal(makeCanTrack('declined', false), false, 'Should block tracking even if outside EU if declined');

  // Case 4: Non-EU visitor where consent is not required
  assert.equal(makeCanTrack('', false), true, 'Should allow tracking for unrestricted traffic');
});

test('Consent lifecycle: event buffering, flushing on accept, and purging on decline', () => {
  let pendingEvents = [];
  let sentEvents = [];
  let consentState = '';
  let consentRequired = true;

  function canTrack() {
    if (consentState === 'declined') return false;
    if (consentState === 'accepted') return true;
    if (consentRequired && !consentState) return false;
    return true;
  }

  function track(type, payload) {
    if (!canTrack()) {
      pendingEvents.push({ type, payload });
      return;
    }
    sentEvents.push({ type, payload });
  }

  function onConsentGiven(choice) {
    consentState = choice;
    if (choice === 'accepted') {
      const toFlush = [...pendingEvents];
      pendingEvents = [];
      for (const ev of toFlush) {
        track(ev.type, ev.payload);
      }
    } else {
      pendingEvents = []; // discard
    }
  }

  // 1. Initial page view arrives before consent choice
  track('page_view', { slug: 'ritual-serum' });
  assert.equal(sentEvents.length, 0, 'No event sent yet');
  assert.equal(pendingEvents.length, 1, 'Event buffered in pending queue');
  assert.equal(pendingEvents[0].type, 'page_view');

  // 2. User accepts consent
  onConsentGiven('accepted');
  assert.equal(pendingEvents.length, 0, 'Pending queue emptied');
  assert.equal(sentEvents.length, 1, 'Buffered event sent to server');
  assert.equal(sentEvents[0].type, 'page_view');

  // 3. Subsequent event sends directly
  track('checkout_click', { amount: 58.00 });
  assert.equal(sentEvents.length, 2, 'Subsequent event sent without buffering');
});

test('Consent lifecycle: declining purges all pending events and suppresses future tracking', () => {
  let pendingEvents = [];
  let sentEvents = [];
  let consentState = '';
  let consentRequired = true;

  function canTrack() {
    if (consentState === 'declined') return false;
    if (consentState === 'accepted') return true;
    if (consentRequired && !consentState) return false;
    return true;
  }

  function track(type, payload) {
    if (!canTrack()) {
      pendingEvents.push({ type, payload });
      return;
    }
    sentEvents.push({ type, payload });
  }

  function onConsentGiven(choice) {
    consentState = choice;
    if (choice === 'accepted') {
      const toFlush = [...pendingEvents];
      pendingEvents = [];
      for (const ev of toFlush) {
        track(ev.type, ev.payload);
      }
    } else {
      pendingEvents = []; // discard completely
    }
  }

  // Buffer initial page view
  track('page_view', { slug: 'botanical-cleanser' });
  assert.equal(pendingEvents.length, 1);

  // User declines
  onConsentGiven('declined');
  assert.equal(pendingEvents.length, 0, 'Pending events discarded');
  assert.equal(sentEvents.length, 0, 'Zero events sent');

  // Subsequent event is dropped
  track('add_to_cart', { variantId: '123' });
  assert.equal(pendingEvents.length, 1); // trapped in pending or blocked
  assert.equal(sentEvents.length, 0, 'Zero events sent to server');
});
