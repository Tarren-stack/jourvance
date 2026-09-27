import type { NodeType } from '../types/journey';

export interface StepBenchmark {
  metricName: string;
  metricShort: string;
  poorThreshold: number;
  healthyThreshold: number;
  topThreshold: number;
  status: 'awaiting_traffic' | 'needs_work' | 'healthy' | 'top_performer';
  statusColor: string;
  statusBg: string;
  statusBorder: string;
  statusLabel: string;
  dropOffCount: number;
  dropOffRate: number;
  industryBenchmarkDesc: string;
}

export function getStepBenchmark(
  sourceType?: NodeType,
  targetType?: NodeType,
  rate: number = 0,
  sourceThroughput: number = 0,
  targetCount: number = 0
): StepBenchmark {
  let metricName = 'Pass-Through Rate';
  let metricShort = 'FLOW';
  let poorThreshold = 10.0;
  let healthyThreshold = 25.0;
  let topThreshold = 40.0;
  let industryBenchmarkDesc = 'Typical multi-step funnel transition baseline (15–30%).';

  if (sourceType === 'ad-source' && targetType === 'landing-page') {
    metricName = 'Click-Through Rate';
    metricShort = 'CTR';
    poorThreshold = 1.2;
    healthyThreshold = 2.0;
    topThreshold = 3.2;
    industryBenchmarkDesc = 'Direct-response ad traffic averages 1.2%–2.5% CTR across Meta & Google.';
  } else if (sourceType === 'landing-page' && targetType === 'lead-form') {
    metricName = 'Opt-In Rate';
    metricShort = 'OPT-IN';
    poorThreshold = 12.0;
    healthyThreshold = 22.0;
    topThreshold = 35.0;
    industryBenchmarkDesc = 'High-converting lead magnets average 15%–30% opt-in from warm page traffic.';
  } else if (sourceType === 'landing-page' && (targetType === 'thank-you' || targetType === 'upsell')) {
    metricName = 'Conversion Rate';
    metricShort = 'CR';
    poorThreshold = 2.8;
    healthyThreshold = 5.5;
    topThreshold = 8.5;
    industryBenchmarkDesc = 'Direct-to-consumer offer pages average 3.0%–7.5% purchase conversion.';
  } else if (sourceType === 'upsell' && (targetType === 'upsell' || targetType === 'thank-you')) {
    metricName = 'Upsell Take Rate';
    metricShort = 'TAKE RATE';
    poorThreshold = 9.0;
    healthyThreshold = 18.0;
    topThreshold = 28.0;
    industryBenchmarkDesc = '1-Click post-purchase upsells average 12%–25% acceptance when priced under $40.';
  } else if (sourceType === 'follow-up-sequence' && targetType === 'landing-page') {
    metricName = 'Sequence Click Rate';
    metricShort = 'CLICK';
    poorThreshold = 6.0;
    healthyThreshold = 14.0;
    topThreshold = 24.0;
    industryBenchmarkDesc = 'Automated recovery drips average 10%–20% click-through back to checkout.';
  }

  const dropOffCount = Math.max(0, sourceThroughput - targetCount);
  const dropOffRate = sourceThroughput > 0 ? Number(((1 - (targetCount / sourceThroughput)) * 100).toFixed(1)) : 0;

  if (sourceThroughput === 0) {
    return {
      metricName,
      metricShort,
      poorThreshold,
      healthyThreshold,
      topThreshold,
      status: 'awaiting_traffic',
      statusColor: '#94A3B8',
      statusBg: 'rgba(148, 163, 184, 0.1)',
      statusBorder: 'rgba(148, 163, 184, 0.25)',
      statusLabel: 'Awaiting Traffic',
      dropOffCount: 0,
      dropOffRate: 0,
      industryBenchmarkDesc
    };
  }

  if (rate < poorThreshold) {
    return {
      metricName,
      metricShort,
      poorThreshold,
      healthyThreshold,
      topThreshold,
      status: 'needs_work',
      statusColor: '#FBBF24',
      statusBg: 'rgba(245, 158, 11, 0.12)',
      statusBorder: 'rgba(245, 158, 11, 0.35)',
      statusLabel: 'Below Benchmark',
      dropOffCount,
      dropOffRate,
      industryBenchmarkDesc
    };
  }

  if (rate < topThreshold) {
    return {
      metricName,
      metricShort,
      poorThreshold,
      healthyThreshold,
      topThreshold,
      status: 'healthy',
      statusColor: '#818CF8',
      statusBg: 'rgba(99, 102, 241, 0.12)',
      statusBorder: 'rgba(99, 102, 241, 0.35)',
      statusLabel: 'Healthy Baseline',
      dropOffCount,
      dropOffRate,
      industryBenchmarkDesc
    };
  }

  return {
    metricName,
    metricShort,
    poorThreshold,
    healthyThreshold,
    topThreshold,
    status: 'top_performer',
    statusColor: '#34D399',
    statusBg: 'rgba(16, 185, 129, 0.12)',
    statusBorder: 'rgba(16, 185, 129, 0.35)',
    statusLabel: 'Top 10% Performer',
    dropOffCount,
    dropOffRate,
    industryBenchmarkDesc
  };
}

export interface RevenueLeakageResult {
  droppedVisitors: number;
  potentialRecoveredConversions: number;
  potentialRevenueGain: number;
  targetBenchmarkRate: number;
}

export function calculateRevenueLeakage(
  droppedVisitors: number,
  currentRate: number,
  targetHealthyRate: number,
  aov: number = 49.0
): RevenueLeakageResult {
  const liftNeeded = Math.max(0, targetHealthyRate - currentRate);
  const potentialRecoveredConversions = Math.round(droppedVisitors * (liftNeeded / 100));
  const potentialRevenueGain = Number((potentialRecoveredConversions * aov).toFixed(2));

  return {
    droppedVisitors,
    potentialRecoveredConversions,
    potentialRevenueGain,
    targetBenchmarkRate: targetHealthyRate
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
        description: 'Run 2–3 creative variants (problem-aware vs direct social proof) to identify high-CTR hooks before scaling ad spend.',
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
        description: 'Limit initial form fields to email only (or email + first name). Every additional field decreases opt-in rates by ~14%.',
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

  return [
    {
      title: 'Review Transition Context',
      description: 'Ensure the target step delivers logically on the promise established in the previous step of your journey.',
      badge: 'FUNNEL FLOW'
    }
  ];
}
