import type { NodeType } from '../types/journey';
import { isRetentionStep } from './edgeKinds.ts';

// The one place a line on the journey map is named and graded (#9). A line's rate is the source
// step's own measured figure for that branch, and a grade needs three things: the rate was
// measured, the line has a published benchmark, and at least MIN_GRADE_SAMPLE people were at the
// step. Ad lines, split shares, retention lines and estimates are never graded. The value import
// above carries an explicit .ts extension so node tests can load this file.

/** A grade needs at least this many people at the step. Below it the rate is too noisy to judge. */
export const MIN_GRADE_SAMPLE = 100;

export type EdgeMetricId =
  | 'ad-visits'
  | 'split-share'
  | 'retention'
  | 'decline'
  | 'take'
  | 'opt-in'
  | 'conversion'
  | 'sequence-click'
  | 'retention-next'
  | 'continue';

/** Rates in percent: below poor is below the typical range, at or above top is above it. */
export interface MetricBands {
  poor: number;
  healthy: number;
  top: number;
}

export interface EdgeMetricDef {
  id: EdgeMetricId;
  name: string;
  short: string;
  bands: MetricBands | null;
  benchmarkDesc: string;
}

export type EdgeStatusId =
  | 'unavailable'
  | 'no_traffic'
  | 'not_graded'
  | 'too_few'
  | 'needs_work'
  | 'healthy'
  | 'top_performer';

export interface EdgeStatusInfo {
  status: EdgeStatusId;
  label: string;
  color: string;
  bg: string;
  border: string;
}

/** What edgeStatus reads from a line's figure. basis is null when a needed figure was not measured. */
export interface GradeInput {
  count: number | null;
  denominator: number | null;
  rate: number | null;
  basis: 'Measured' | 'Estimated' | 'Demo' | null;
}

/**
 * The range sentence under a grade, written from the same bands edgeStatus grades against, so the
 * pill and the sentence can never name two different ranges. Below poor is below the range and at
 * or above top is above it, so the range shown is poor to top.
 */
export function typicalRangeText(bands: MetricBands): string {
  return `Typical range used here: ${bands.poor}% to ${bands.top}%.`;
}

/** A graded line: what the rate counts, then the range it is graded against. */
function graded(id: EdgeMetricId, name: string, short: string, bands: MetricBands, measures: string): EdgeMetricDef {
  return { id, name, short, bands, benchmarkDesc: `${measures} ${typicalRangeText(bands)}` };
}

const METRICS: Record<EdgeMetricId, EdgeMetricDef> = {
  'ad-visits': {
    id: 'ad-visits',
    name: 'Visits from this ad',
    short: 'VISITS',
    bands: null,
    benchmarkDesc: "Visits to the next page tagged with this ad's campaign. The ad's audience is not measured here, so there is no rate."
  },
  'split-share': {
    id: 'split-share',
    name: 'Share of split traffic',
    short: 'SPLIT',
    bands: null,
    benchmarkDesc: "The part of this split's visitors sent down this branch."
  },
  retention: {
    id: 'retention',
    name: 'Retention flow',
    short: 'RESCUE',
    bands: null,
    benchmarkDesc: 'People sent to this follow-up after they declined or left.'
  },
  decline: {
    id: 'decline',
    name: 'Declined',
    short: 'DECLINE',
    bands: null,
    benchmarkDesc: 'The part of the people who saw this offer and said no.'
  },
  take: graded('take', 'Take rate', 'TAKE', { poor: 9, healthy: 18, top: 28 },
    'The part of the people who saw this offer and accepted it.'),
  'opt-in': graded('opt-in', 'Opt-in rate', 'OPT-IN', { poor: 12, healthy: 22, top: 35 },
    'The part of the visitors to this page who became leads.'),
  conversion: graded('conversion', 'Conversion rate', 'CR', { poor: 2.8, healthy: 5.5, top: 8.5 },
    'The part of the visitors to this page who converted.'),
  'sequence-click': graded('sequence-click', 'Email click rate', 'CLICK', { poor: 6, healthy: 14, top: 24 },
    'The part of the people sent this sequence who clicked.'),
  // A plain line out of a retention step (#30), drawn as a retention flow: its pill says so (R06).
  // It has no measure of its own yet (lineRateMeasured), so it is never graded.
  'retention-next': {
    id: 'retention-next',
    name: 'Retention flow',
    short: 'RESCUE',
    bands: null,
    benchmarkDesc: 'Where people go next from this retention flow, after they declined or left.'
  },
  continue: {
    id: 'continue',
    name: 'Moved on',
    short: 'NEXT',
    bands: null,
    benchmarkDesc: ''
  }
};

/**
 * Names a line from what it connects. The source handle and the target step decide first,
 * because they say what the visitor did. isRetentionStep, not isRetentionLink: a declined line
 * into a downsell is an offer, not a retention flow.
 */
export function edgeMetricFor(
  sourceType?: NodeType | string | null,
  targetType?: NodeType | string | null,
  sourceHandle?: string | null,
  targetData?: unknown,
  drawnAsRetention = false
): EdgeMetricDef {
  if (sourceType === 'ad-source') return METRICS['ad-visits'];
  if (sourceType === 'ab-split') return METRICS['split-share'];
  if (isRetentionStep(targetData) || sourceHandle === 'rescue' || sourceHandle === 'abandon') return METRICS.retention;
  if (sourceType === 'upsell' && sourceHandle === 'declined') return METRICS.decline;
  if (sourceType === 'upsell' && (sourceHandle === 'accepted' || !sourceHandle)) return METRICS.take;
  if (sourceType === 'landing-page' && targetType === 'lead-form') return METRICS['opt-in'];
  if (sourceType === 'landing-page' && (targetType === 'thank-you' || targetType === 'upsell')) return METRICS.conversion;
  if (sourceType === 'follow-up-sequence' && targetType === 'landing-page') return METRICS['sequence-click'];
  return asRetentionLine(METRICS.continue, drawnAsRetention);
}

/**
 * A line the map draws as a retention flow (edgeKind 'retention', amber and dotted) is never
 * named "Moved on": the pill would contradict the legend (R06, bp6's rescue to thank-you line).
 * Pass the same flag the line's colour reads (data.isRetentionEdge). Only the plain fallback is
 * renamed; a line with a real measure (a sequence's click rate) keeps it.
 */
export function asRetentionLine(def: EdgeMetricDef, drawnAsRetention: boolean): EdgeMetricDef {
  return drawnAsRetention && def.id === 'continue' ? METRICS['retention-next'] : def;
}

/** A retention line's pill takes the amber retention look, as its line does. */
export function isRetentionMetric(def: EdgeMetricDef | null | undefined): boolean {
  return def?.id === 'retention' || def?.id === 'retention-next';
}

const GREY = { color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.25)' };
const AMBER = { color: '#FBBF24', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)' };
const INDIGO = { color: '#818CF8', bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.35)' };
const GREEN = { color: '#34D399', bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)' };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The grade on a line, or the plain reason it has none. */
export function edgeStatus(def: EdgeMetricDef, figure: GradeInput): EdgeStatusInfo {
  if (!figure.basis) return { status: 'unavailable', label: 'Unavailable', ...GREY };
  const traffic = finite(figure.denominator) ? figure.denominator : figure.count;
  if (traffic === 0) return { status: 'no_traffic', label: 'No visits in this range', ...GREY };
  if (!def.bands || figure.basis !== 'Measured' || !finite(figure.rate)) {
    return { status: 'not_graded', label: 'Not graded', ...GREY };
  }
  if (!finite(figure.denominator) || figure.denominator < MIN_GRADE_SAMPLE) {
    return { status: 'too_few', label: 'Too few visits to grade', ...GREY };
  }
  if (figure.rate < def.bands.poor) return { status: 'needs_work', label: 'Below typical range', ...AMBER };
  if (figure.rate < def.bands.top) return { status: 'healthy', label: 'Within typical range', ...INDIGO };
  return { status: 'top_performer', label: 'Above typical range', ...GREEN };
}

export interface RevenueLeakageResult<Gain extends number | null = number | null> {
  visitors: number;
  potentialRecoveredConversions: number;
  /** null when there is no order value to price the conversions with. */
  potentialRevenueGain: Gain;
  targetBenchmarkRate: number;
}

/**
 * The conversions a typical rate would have added: visitors x (target - current). With no
 * order value the gain has no dollar figure. There is no default order value.
 */
export function calculateRevenueLeakage(visitors: number, currentRate: number, targetRate: number, aov: number): RevenueLeakageResult<number>;
export function calculateRevenueLeakage(visitors: number, currentRate: number, targetRate: number, aov: number | null): RevenueLeakageResult;
export function calculateRevenueLeakage(
  visitors: number,
  currentRate: number,
  targetRate: number,
  aov: number | null
): RevenueLeakageResult {
  const liftNeeded = Math.max(0, targetRate - currentRate);
  const potentialRecoveredConversions = Math.round(visitors * (liftNeeded / 100));
  const potentialRevenueGain = aov == null || !Number.isFinite(aov)
    ? null
    : Math.round(potentialRecoveredConversions * aov * 100) / 100;

  return {
    visitors,
    potentialRecoveredConversions,
    potentialRevenueGain,
    targetBenchmarkRate: targetRate
  };
}

export interface OptimizationRecommendation {
  title: string;
  description: string;
  badge: string;
  actionText?: string;
  actionTargetNodeId?: string;
}

export function getStepOptimizationTips(
  sourceType?: NodeType,
  targetType?: NodeType
): OptimizationRecommendation[] {
  if (sourceType === 'ad-source' && targetType === 'landing-page') {
    return [
      {
        title: 'Align Ad Hook With Page Hero',
        description: 'Ensure the top headline of your landing page echoes the exact hook angle and promise of your ad creative to minimize initial bounce.',
        badge: 'MESSAGE MATCH'
      },
      {
        title: 'A/B Test Ad Angles',
        description: 'Run 2 or 3 creative variants (problem-aware vs direct social proof) to find the hooks that bring the most visits before scaling ad spend.',
        badge: 'CREATIVE TESTING'
      }
    ];
  }

  if (sourceType === 'landing-page' && (targetType === 'thank-you' || targetType === 'upsell')) {
    return [
      {
        title: 'Enable Mobile Sticky Action Bar',
        description: 'Keep your primary checkout or booking button visible as mobile shoppers scroll past your product details.',
        badge: 'CONVERSION',
        actionText: 'Configure in Page Settings'
      },
      {
        title: 'Split-Test Headline Hook (Variant B)',
        description: 'Test a second headline angle with a 50/50 live split to lift page conversion toward top-quartile benchmarks.',
        badge: 'A/B SPLIT TEST',
        actionText: 'Open Page Editor'
      },
      {
        title: 'Activate Exit-Intent Recovery',
        description: 'Capture abandoning visitors on desktop with an instant courtesy discount code before they leave the page.',
        badge: 'RECOVERY'
      }
    ];
  }

  if (sourceType === 'landing-page' && targetType === 'lead-form') {
    return [
      {
        title: 'Reduce Form Friction',
        description: 'Limit initial form fields to email only (or email + first name). Every extra field asks more of the visitor before they get anything back.',
        badge: 'FRICTION REDUCTION'
      },
      {
        title: 'Highlight Immediate Value',
        description: 'Explicitly state the exact instant benefit or voucher the visitor will receive immediately after submission.',
        badge: 'VALUE STACK'
      }
    ];
  }

  if (sourceType === 'upsell') {
    return [
      {
        title: 'Optimize OTO Price Point',
        description: 'One-click post-purchase offers perform best when priced between 25% and 50% of the initial order total (under $40).',
        badge: 'PRICING'
      },
      {
        title: 'Add a Downsell Safety Net',
        description: 'Route declined upsell traffic to a lower-barrier downsell offer to preserve additional average order value.',
        badge: 'DOWNSELL'
      }
    ];
  }

  if (sourceType === 'ab-split') {
    return [
      {
        title: 'Check Statistical Sample Size',
        description: 'Aim for at least 100 visitors and 10+ conversions per branch before declaring a definitive winning variation.',
        badge: 'CONFIDENCE'
      },
      {
        title: 'Lock In the Winning Branch',
        description: 'Once a variant demonstrates clear conversion or revenue lift, declare the winner to direct 100% of future traffic to it.',
        badge: 'TRAFFIC LOCK'
      }
    ];
  }

  return [
    {
      title: 'Review Transition Context',
      description: 'Ensure the target step delivers logically on the promise established in the previous step of your journey.',
      badge: 'FUNNEL FLOW'
    }
  ];
}
