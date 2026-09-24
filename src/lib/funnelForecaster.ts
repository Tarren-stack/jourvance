import type { JourneyNode, FunnelForecast, FunnelSimulationResults, PageNodeData, UpsellNodeData } from '../types/journey';

export const DEFAULT_FORECAST: FunnelForecast = {
  monthlyAdSpend: 3000,
  cpc: 1.80,
  conversionRate: 2.8,
  corePrice: 58.00,
  cogsPercentage: 20,
  bumpTakeRate: 28,
  bumpPrice: 28.00,
  upsellTakeRate: 22,
  upsellPrice: 38.00
};

export const SCENARIO_PRESETS: Record<'conservative' | 'target' | 'aggressive', {
  name: string;
  badge: string;
  description: string;
  values: Pick<FunnelForecast, 'monthlyAdSpend' | 'cpc' | 'conversionRate' | 'bumpTakeRate' | 'upsellTakeRate' | 'cogsPercentage'>;
}> = {
  conservative: {
    name: 'Conservative / Testing',
    badge: 'Safe Baseline',
    description: 'High CPC traffic with unoptimized cold conversion rates.',
    values: {
      monthlyAdSpend: 2500,
      cpc: 2.40,
      conversionRate: 1.6,
      bumpTakeRate: 16,
      upsellTakeRate: 12,
      cogsPercentage: 25
    }
  },
  target: {
    name: 'Target / Industry Average',
    badge: 'Expected Sweet Spot',
    description: 'Proven e-commerce benchmark with calibrated order bumps & OTOs.',
    values: {
      monthlyAdSpend: 3500,
      cpc: 1.80,
      conversionRate: 2.8,
      bumpTakeRate: 28,
      upsellTakeRate: 22,
      cogsPercentage: 20
    }
  },
  aggressive: {
    name: 'High-Growth Scale',
    badge: 'Scale Optimization',
    description: 'Winning creative hook, high-converting offer, and optimized AOV flywheel.',
    values: {
      monthlyAdSpend: 7500,
      cpc: 1.25,
      conversionRate: 4.2,
      bumpTakeRate: 38,
      upsellTakeRate: 32,
      cogsPercentage: 18
    }
  }
};

/**
 * Parses numeric price from string like "$58.00", "58.50", "58"
 */
export function parseNumericPrice(val: unknown, fallback: number = 0): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[^0-9.]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Inspects visual canvas nodes to auto-extract core product, bump, and upsell pricing.
 */
export function extractPricingFromNodes(nodes: JourneyNode[]): {
  corePrice: number;
  bumpPrice: number;
  upsellPrice: number;
  hasBump: boolean;
  hasUpsell: boolean;
  coreTitle?: string;
  bumpTitle?: string;
  upsellTitle?: string;
} {
  let corePrice = 58.00;
  let bumpPrice = 28.00;
  let upsellPrice = 38.00;
  let hasBump = false;
  let hasUpsell = false;
  let coreTitle: string | undefined;
  let bumpTitle: string | undefined;
  let upsellTitle: string | undefined;

  for (const node of nodes) {
    if (node.data.type === 'landing-page') {
      const pageData = node.data as PageNodeData;
      if (pageData.shopifyProductPrice) {
        const parsed = parseNumericPrice(pageData.shopifyProductPrice, 0);
        if (parsed > 0) {
          corePrice = parsed;
          coreTitle = pageData.shopifyProductTitle || pageData.headline;
        }
      }
      if (pageData.orderBumpEnabled && pageData.orderBumpPrice) {
        const parsed = parseNumericPrice(pageData.orderBumpPrice, 0);
        if (parsed > 0) {
          bumpPrice = parsed;
          hasBump = true;
          bumpTitle = pageData.orderBumpTitle;
        }
      }
    } else if (node.data.type === 'upsell') {
      const upsellData = node.data as UpsellNodeData;
      if (upsellData.productPrice) {
        const parsed = parseNumericPrice(upsellData.productPrice, 0);
        if (parsed > 0) {
          upsellPrice = parsed;
          hasUpsell = true;
          upsellTitle = upsellData.productTitle || upsellData.headline;
        }
      }
    }
  }

  return {
    corePrice,
    bumpPrice,
    upsellPrice,
    hasBump,
    hasUpsell,
    coreTitle,
    bumpTitle,
    upsellTitle
  };
}

/**
 * Calculates end-to-end unit economics, profit margins, ROAS, and breakeven safety metrics.
 */
export function calculateFunnelForecast(forecast: FunnelForecast): FunnelSimulationResults {
  const {
    monthlyAdSpend,
    cpc,
    conversionRate,
    corePrice,
    cogsPercentage,
    bumpTakeRate,
    bumpPrice,
    upsellTakeRate,
    upsellPrice
  } = forecast;

  // 1. Traffic & Front-End Orders
  const totalClicks = cpc > 0 ? Math.round(monthlyAdSpend / cpc) : 0;
  const frontEndOrders = Math.round(totalClicks * (conversionRate / 100));

  // 2. AOV Add-On Units
  const bumpSales = Math.round(frontEndOrders * (bumpTakeRate / 100));
  const upsellSales = Math.round(frontEndOrders * (upsellTakeRate / 100));

  // 3. Revenue Breakdown
  const coreRevenue = frontEndOrders * corePrice;
  const bumpRevenue = bumpSales * bumpPrice;
  const upsellRevenue = upsellSales * upsellPrice;
  const grossRevenue = coreRevenue + bumpRevenue + upsellRevenue;

  // 4. AOV & Lift
  const baseAov = corePrice;
  const effectiveAov = frontEndOrders > 0 ? grossRevenue / frontEndOrders : baseAov;
  const aovLift = Math.max(0, effectiveAov - baseAov);

  // 5. Cost Structure & Margins
  const cogsFraction = Math.max(0, Math.min(1, cogsPercentage / 100));
  const estimatedCogs = grossRevenue * cogsFraction;
  const netProfit = grossRevenue - monthlyAdSpend - estimatedCogs;
  const blendedRoas = monthlyAdSpend > 0 ? grossRevenue / monthlyAdSpend : 0;

  // 6. Breakeven & Acquisition CAC Guardrails
  // Max ad spend affordable per customer before going into the red
  const breakevenCac = effectiveAov * (1 - cogsFraction);
  // Current projected cost per customer
  const projectedCac = frontEndOrders > 0
    ? monthlyAdSpend / frontEndOrders
    : (cpc > 0 && conversionRate > 0 ? cpc / (conversionRate / 100) : 0);
  const profitBuffer = breakevenCac - projectedCac;

  // 7. Breakeven Conversion Rate %
  // What minimum landing page CVR is needed to achieve net profit = 0
  const breakevenCvr = breakevenCac > 0 ? (cpc / breakevenCac) * 100 : 0;
  const cvrBuffer = conversionRate - breakevenCvr;

  const isProfitable = netProfit > 0;

  // 8. Sensitivity Analysis: +5% Upsell Take Rate Lift
  const extra5PctUpsellSales = Math.round(frontEndOrders * 0.05);
  const leverage5PctUpsellRevenue = extra5PctUpsellSales * upsellPrice;
  const leverage5PctUpsellProfit = leverage5PctUpsellRevenue * (1 - cogsFraction);

  return {
    totalClicks,
    frontEndOrders,
    bumpSales,
    upsellSales,
    coreRevenue,
    bumpRevenue,
    upsellRevenue,
    grossRevenue,
    effectiveAov,
    baseAov,
    aovLift,
    estimatedCogs,
    netProfit,
    blendedRoas,
    breakevenCac,
    projectedCac,
    profitBuffer,
    breakevenCvr,
    cvrBuffer,
    isProfitable,
    leverage5PctUpsellRevenue,
    leverage5PctUpsellProfit
  };
}
