// What a step on the journey map is, decided in one place (Aura's shape rule).
// The icon's shape says what a step is: a diamond is a test, a circle is traffic or a message, and
// a rounded square is a page or money. Its colour says which kind it is. The cards and the minimap
// both read this file, so a step looks the same on its card and on the map, and selection is one
// colour on every card rather than the kind's own.
// Only type imports here, so node --test can load this file with type stripping.
import type { CSSProperties } from 'react';

export type StepShape = 'diamond' | 'square' | 'circle';

export type StepVariant =
  | 'ad'
  | 'page'
  | 'form'
  | 'nurture'
  | 'upsell-rescue'
  | 'cart-recovery'
  | 'winback'
  | 'review'
  | 'thank-you'
  | 'upsell'
  | 'downsell'
  | 'split';

export interface StepKindStyle {
  color: string;
  shape: StepShape;
}

// The colours are the ones each card's icon already used in Edit mode, so no card changed colour.
// Every one is at least 3:1 against the card (#0F172A) and the minimap (#111827).
export const STEP_KINDS: Record<StepVariant, StepKindStyle> = {
  ad: { color: '#60A5FA', shape: 'circle' },
  page: { color: '#818CF8', shape: 'square' },
  form: { color: '#34D399', shape: 'square' },
  nurture: { color: '#FBBF24', shape: 'circle' },
  'upsell-rescue': { color: '#F59E0B', shape: 'circle' },
  'cart-recovery': { color: '#10B981', shape: 'circle' },
  winback: { color: '#8B5CF6', shape: 'circle' },
  review: { color: '#EC4899', shape: 'circle' },
  'thank-you': { color: '#F472B6', shape: 'square' },
  upsell: { color: '#10B981', shape: 'square' },
  downsell: { color: '#F59E0B', shape: 'square' },
  split: { color: '#A78BFA', shape: 'diamond' }
};

export const UNKNOWN_STEP: StepKindStyle = { color: '#94A3B8', shape: 'square' };

// A Map, so a saved sequenceType such as 'constructor' cannot reach an object's prototype.
const SEQUENCE_VARIANTS = new Map<string, StepVariant>([
  ['upsell_recovery', 'upsell-rescue'],
  ['checkout_recovery', 'cart-recovery'],
  ['at_risk_winback', 'winback'],
  ['fulfillment_review', 'review'],
  ['lead_nurture', 'nurture']
]);

const TYPE_VARIANTS = new Map<string, StepVariant>([
  ['ad-source', 'ad'],
  ['landing-page', 'page'],
  ['lead-form', 'form'],
  ['thank-you', 'thank-you'],
  ['ab-split', 'split']
]);

export function stepVariant(type: unknown, data?: unknown): StepVariant | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const t = typeof type === 'string' ? type : d.type;
  if (typeof t !== 'string') return null;
  if (t === 'upsell') return d.offerType === 'downsell' ? 'downsell' : 'upsell';
  // An unknown or missing sequenceType is a nurture sequence, as SequenceNode draws it.
  if (t === 'follow-up-sequence') return SEQUENCE_VARIANTS.get(String(d.sequenceType)) ?? 'nurture';
  return TYPE_VARIANTS.get(t) ?? null;
}

// The kind is the step's identity, so Live ROAS and a page's own A/B test never change it.
export function stepKind(type: unknown, data?: unknown): StepKindStyle {
  const variant = stepVariant(type, data);
  return variant ? STEP_KINDS[variant] : UNKNOWN_STEP;
}

// Must equal --color-primary in src/index.css (step-kinds.test.mjs pins this). No kind uses it.
export const SELECTION_COLOR = '#6366F1';

export const SELECTED_CARD_FRAME = {
  border: '1.5px solid #6366F1',
  boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.3), 0 0 20px rgba(99, 102, 241, 0.3)'
};

// The one selected state for every card. A card passes its own resting border and shadow.
export function cardFrame(selected: boolean, resting: { border: string; boxShadow: string }) {
  return selected ? SELECTED_CARD_FRAME : resting;
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The 28px icon slot every card header uses. A diamond is a 20px square turned 45 degrees, whose
// 28.3px diagonal fills the same slot, with the glyph turned back upright and small enough to fit
// the upright square inside it.
export function iconTile(
  shape: StepShape,
  color: string
): { box: CSSProperties; shape: CSSProperties; glyph: CSSProperties; glyphSize: number } {
  const box: CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
  const face: CSSProperties = {
    background: withAlpha(color, 0.15),
    border: `1px solid ${withAlpha(color, 0.35)}`,
    color,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
  if (shape === 'diamond') {
    return {
      box,
      shape: { width: 20, height: 20, borderRadius: 4, transform: 'rotate(45deg)', ...face },
      glyph: { display: 'flex', transform: 'rotate(-45deg)' },
      glyphSize: 12
    };
  }
  return {
    box,
    shape: { width: 28, height: 28, borderRadius: shape === 'circle' ? '50%' : 8, ...face },
    glyph: { display: 'flex' },
    glyphSize: 15
  };
}
