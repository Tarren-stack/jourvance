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
      if (on.length > 3) return { text: `${on.length} on`, tone: 'on' };
      return { text: on.join(', '), tone: 'on' };
    }
    case 'privacy': {
      // GDPR & CCPA cookie consent: checked={data.cookieConsentEnabled !== false}.
      const cookie = data.cookieConsentEnabled !== false ? 'on' : 'off';
      // SECTION 3 pixel inputs: metaPixelId, tiktokPixelId, ga4TrackingId.
      const pixels = [data.metaPixelId, data.tiktokPixelId, data.ga4TrackingId].filter(hasText).length;
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
