import type { PageNodeData } from '../types/journey';
import { isDemoVariantId } from './productPickerCatalog.ts';

// The page editor's layout contract: the page words stay open at the top, and everything else
// sits in five collapsible sections whose closed headers still say what is set inside them.
// Pure, with type-only imports or .ts-suffixed ones, so Node tests can load it without a bundler.

export type SectionId = 'commerce' | 'ab-test' | 'extras' | 'privacy' | 'hosting';

export const PAGE_EDITOR_SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'commerce', title: 'Product and checkout' },
  { id: 'ab-test', title: 'A/B test' },
  { id: 'extras', title: 'Urgency and extras' },
  { id: 'privacy', title: 'Privacy and tracking' },
  { id: 'hosting', title: 'Hosting and domain' }
];

// The ids of the four copy inputs, so a design check, the step dock or a label can reach the
// exact field instead of guessing at the editor's DOM.
export const PAGE_FIELD_IDS = {
  headline: 'page-headline',
  subhead: 'page-subhead',
  buttonText: 'page-button-text',
  slug: 'page-slug'
} as const;

// Which sections a viewer left open. A per-viewer convenience, so it lives in localStorage.
export const OPEN_SECTIONS_STORAGE_KEY = 'jourvance_page_editor_open';

export type SummaryTone = 'neutral' | 'on' | 'warn';
export interface SectionSummary {
  text: string;
  tone: SummaryTone;
}

const SECTION_IDS = new Set<string>(PAGE_EDITOR_SECTIONS.map(s => s.id));

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

// One line for a closed section header. Each predicate mirrors the one the editor itself uses,
// so a summary can never say "on" while the control inside says "off".
export function sectionSummary(
  id: SectionId,
  data: PageNodeData,
  ctx: { storeConnected: boolean }
): SectionSummary {
  switch (id) {
    case 'commerce': {
      const hasProduct = ctx.storeConnected && !isDemoVariantId(data.shopifyVariantId) && Boolean(data.shopifyVariantId) && Boolean(data.shopifyProductTitle);
      if (!hasProduct && hasText(data.checkoutUrl)) {
        return {
          text: data.checkoutMode === 'lead-gate' ? 'Direct destination · Email first' : 'Direct destination · Direct link',
          tone: 'on'
        };
      }
      if (!ctx.storeConnected) return { text: 'No store connected', tone: 'neutral' };
      // PageEditor.tsx "Placeholder / Missing Variant Warning" predicate.
      if (isDemoVariantId(data.shopifyVariantId) || !data.shopifyVariantId || !data.shopifyProductTitle) {
        return { text: 'No product linked', tone: 'warn' };
      }
      const parts = [
        String(data.shopifyProductTitle),
        // Checkout Mode Toggle: 'lead-gate' is the email-first mode, anything else is direct.
        data.checkoutMode === 'lead-gate' ? 'Email first' : 'Direct checkout',
        // SECTION 1.5 order bump toggle: checked={Boolean(data.orderBumpEnabled)}.
        data.orderBumpEnabled ? 'Add-on on' : null
      ].filter(Boolean);
      return { text: parts.join(' · '), tone: 'on' };
    }
    case 'ab-test': {
      if (!data.abTestingEnabled) return { text: 'Off', tone: 'neutral' };
      // SECTION 1.6 split label: data.splitRatio || 50.
      const r = Number(data.splitRatio) || 50;
      return { text: `On · ${r}% A / ${100 - r}% B`, tone: 'on' };
    }
    case 'extras': {
      const on: string[] = [];
      // SECTION 1.7 Toggle 1: checked={data.urgencyTimerEnabled || false}.
      if (data.urgencyTimerEnabled) on.push('Countdown');
      // SECTION 1.7 Toggle 2: checked={data.scarcityBatchEnabled || false}.
      if (data.scarcityBatchEnabled) on.push('Stock count');
      // SECTION 1.8: checked={data.exitIntentEnabled || false}.
      if (data.exitIntentEnabled) on.push('Exit offer');
      // Mobile Sticky Action Bar Toggle: on unless explicitly false.
      if (data.mobileStickyBarEnabled !== false) on.push('Sticky bar');
      // UGC SOCIAL PROOF WALL: on unless explicitly false.
      if (data.socialProofWallEnabled !== false) on.push('Reviews wall');
      if (on.length === 0) return { text: 'All off', tone: 'neutral' };
      return { text: on.join(', '), tone: 'on' };
    }
    case 'privacy': {
      // GDPR & CCPA cookie consent: checked={data.cookieConsentEnabled !== false}.
      const cookie = data.cookieConsentEnabled !== false ? 'on' : 'off';
      // SECTION 3 pixel inputs: metaPixelId, tiktokPixelId, ga4TrackingId, gtmContainerId.
      const pixels = [data.metaPixelId, data.tiktokPixelId, data.ga4TrackingId, data.gtmContainerId].filter(hasText).length;
      const pixelText = pixels === 0 ? 'No pixels' : pixels === 1 ? '1 pixel' : `${pixels} pixels`;
      return { text: `Cookie notice ${cookie} · ${pixelText}`, tone: 'neutral' };
    }
    case 'hosting': {
      // SECTION 2 status pill: data.published.
      let text = data.published ? 'Published' : 'Not published';
      if (hasText(data.customDomain)) {
        text += ` · ${String(data.customDomain).trim()} ${data.customDomainVerified ? 'verified' : 'not verified'}`;
      }
      return { text, tone: data.published ? 'on' : 'neutral' };
    }
  }
}

// Reads the stored list back. Anything that is not a JSON array of known ids is ignored, so a
// hand-edited or stale value can never break the editor.
export function parseOpenSections(raw: string | null): SectionId[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SectionId[] = [];
  for (const v of parsed) {
    if (typeof v === 'string' && SECTION_IDS.has(v) && !out.includes(v as SectionId)) {
      out.push(v as SectionId);
    }
  }
  return out;
}

export function toggleSection(open: SectionId[], id: SectionId): SectionId[] {
  return open.includes(id) ? open.filter(s => s !== id) : [...open, id];
}

// Builds a client-side WhatsApp (https://wa.me/...) or SMS (sms:...) link when Click-to-Chat is enabled.
export function buildChatConciergeHref(data?: Partial<PageNodeData> | null): string {
  if (!data || !data.chatConciergeEnabled) return '';
  const digits = String(data.chatConciergePhone || '').replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 16) return '';
  const msg = String(data.chatConciergeMessage || '').trim();
  if (data.chatConciergeChannel === 'sms') {
    return msg ? `sms:+${digits}?body=${encodeURIComponent(msg)}` : `sms:+${digits}`;
  }
  return msg ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : `https://wa.me/${digits}`;
}

// Converts Google Drive share links (drive.google.com/file/d/<ID>/view or drive.google.com/open?id=<ID>)
// into direct fast-loading image URLs (https://lh3.googleusercontent.com/d/<ID>).
export function normalizeGoogleDriveImageUrl(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const fileMatch = /^https?:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})(?:\/.*|\?.*)?$/i.exec(trimmed);
  if (fileMatch) return `https://lh3.googleusercontent.com/d/${fileMatch[1]}`;
  const openMatch = /^https?:\/\/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})(?:[&#].*)?$/i.exec(trimmed);
  if (openMatch) return `https://lh3.googleusercontent.com/d/${openMatch[1]}`;
  return trimmed;
}

export function isConvertedGoogleDriveImageUrl(raw?: string | null): boolean {
  const trimmed = String(raw || '').trim();
  return /^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]{10,}$/i.test(trimmed);
}

export function buildGoogleCalendarPresetUrl(title?: string | null, details?: string | null): string {
  const cleanTitle = String(title || '').trim() || 'Onboarding & Strategy Session';
  const cleanDetails = String(details || '').trim() || 'Confirmed session booked through our official page.';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(cleanTitle)}&details=${encodeURIComponent(cleanDetails)}`;
}

export interface DirectCheckoutValidation {
  valid: boolean;
  normalized: string;
  message: string;
}

export function validateDirectCheckoutUrl(raw?: string | null): DirectCheckoutValidation {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { valid: true, normalized: '', message: '' };
  if (/[\s\u0000-\u001f\u007f\\]/.test(trimmed)) {
    return {
      valid: false,
      normalized: trimmed,
      message: 'Remove spaces or line breaks from the destination URL.'
    };
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { valid: true, normalized: trimmed, message: '' };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname && (parsed.hostname.includes('.') || parsed.hostname === 'localhost')) {
        return { valid: true, normalized: trimmed, message: '' };
      }
    } catch {
      // Fall through to invalid message below
    }
  }
  return {
    valid: false,
    normalized: trimmed,
    message: 'Enter a full https:// checkout link (such as Stripe, Calendly, or Square) or a site path starting with /.'
  };
}

export const GOOGLE_SHEETS_APPS_SCRIPT = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var p = JSON.parse(e.postData.contents || '{}');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Event', 'Name', 'Email', 'Phone', 'Offer Slug', 'Variant', 'Order Bump', 'UTM Source', 'UTM Campaign']);
  }
  sheet.appendRow([
    p.timestamp || new Date().toISOString(),
    p.event || 'funnel_lead',
    p.name || '',
    p.email || '',
    p.phone || '',
    p.pageSlug || '',
    p.variant || 'a',
    p.bumpAccepted ? (p.bumpProductTitle || 'Yes') : 'No',
    (p.contact && p.contact.utm_source) || '',
    (p.contact && p.contact.utm_campaign) || ''
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}`;

export const GOOGLE_FORMS_APPS_SCRIPT = `function onFormSubmit(e) {
  var responses = (e && e.namedValues) || {};
  var pick = function(keys) {
    for (var i = 0; i < keys.length; i++) {
      var val = responses[keys[i]];
      if (val && val[0]) return String(val[0]).trim();
    }
    return '';
  };
  var payload = {
    email: pick(['Email', 'Email Address', 'Work Email', 'email']),
    name: pick(['Name', 'Full Name', 'Your Name', 'name']),
    phone: pick(['Phone', 'Phone Number', 'Mobile', 'phone']),
    slug: 'offer',
    utm_source: 'google_forms'
  };
  UrlFetchApp.fetch('https://YOUR-JOURVANCE-DOMAIN/api/public/lead', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}`;
