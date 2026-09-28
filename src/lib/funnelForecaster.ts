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
  upsellPrice: 38.00,
  downsellTakeRate: 15,
  downsellPrice: 19.00,
  cartRecoveryEnabled: false,
  cartRecoveryRate: 18,
  cartRecoveryDiscount: 10,
  upsellRescueEnabled: false,
  upsellRescueRate: 15,
  upsellRescueDiscount: 10
};

export const SCENARIO_PRESETS: Record<'conservative' | 'target' | 'aggressive', {
  name: string;
  badge: string;
  description: string;
  values: Pick<FunnelForecast, 'monthlyAdSpend' | 'cpc' | 'conversionRate' | 'bumpTakeRate' | 'upsellTakeRate' | 'downsellTakeRate' | 'cogsPercentage' | 'cartRecoveryRate' | 'cartRecoveryDiscount' | 'upsellRescueRate' | 'upsellRescueDiscount'>;
}> = {
  conservative: {
    name: 'Conservative / Testing',
    badge: 'Safe Baseline',
    description: 'Sample rates with a higher cost per click and a lower conversion rate.',
    values: {
      monthlyAdSpend: 2500,
      cpc: 2.40,
      conversionRate: 1.6,
      bumpTakeRate: 16,
      upsellTakeRate: 12,
      downsellTakeRate: 10,
      cogsPercentage: 25,
      cartRecoveryRate: 12,
      cartRecoveryDiscount: 10,
      upsellRescueRate: 10,
      upsellRescueDiscount: 10
    }
  },
  target: {
    name: 'Example: middle assumptions',
    badge: 'Example',
    description: 'Sample rates you can replace. These are not measured results.',
    values: {
      monthlyAdSpend: 3500,
      cpc: 1.80,
      conversionRate: 2.8,
      bumpTakeRate: 28,
      upsellTakeRate: 22,
      downsellTakeRate: 15,
      cogsPercentage: 20,
      cartRecoveryRate: 18,
      cartRecoveryDiscount: 10,
      upsellRescueRate: 15,
      upsellRescueDiscount: 10
    }
  },
  aggressive: {
    name: 'High-Growth Scale',
    badge: 'Scale Optimization',
    description: 'Sample rates with a lower cost per click and a higher conversion rate.',
    values: {
      monthlyAdSpend: 7500,
      cpc: 1.25,
      conversionRate: 4.2,
      bumpTakeRate: 38,
      upsellTakeRate: 32,
      downsellTakeRate: 22,
      cogsPercentage: 18,
      cartRecoveryRate: 24,
      cartRecoveryDiscount: 15,
      upsellRescueRate: 20,
      upsellRescueDiscount: 15
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
 * Inspects visual canvas nodes to auto-extract core product, bump, upsell, downsell pricing,
 * and automated retention safety nets (cart recovery & 24h courtesy rescue).
 */
export function extractPricingFromNodes(nodes: JourneyNode[]): {
  corePrice: number;
  bumpPrice: number;
  upsellPrice: number;
  downsellPrice: number;
  hasBump: boolean;
  hasUpsell: boolean;
  hasDownsell: boolean;
  hasCartRecovery: boolean;
  hasUpsellRescue: boolean;
  coreTitle?: string;
  bumpTitle?: string;
  upsellTitle?: string;
  downsellTitle?: string;
  cartVoucherCode?: string;
  upsellVoucherCode?: string;
} {
  let corePrice = 58.00;
  let bumpPrice = 28.00;
  let upsellPrice = 38.00;
  let downsellPrice = 19.00;
  let hasBump = false;
  let hasUpsell = false;
  let hasDownsell = false;
  let hasCartRecovery = false;
  let hasUpsellRescue = false;
  let coreTitle: string | undefined;
  let bumpTitle: string | undefined;
  let upsellTitle: string | undefined;
  let downsellTitle: string | undefined;
  let cartVoucherCode: string | undefined;
  let upsellVoucherCode: string | undefined;

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
      const isDown = upsellData.offerType === 'downsell';
      if (upsellData.productPrice) {
        const parsed = parseNumericPrice(upsellData.productPrice, 0);
        if (parsed > 0) {
          if (isDown) {
            downsellPrice = parsed;
            hasDownsell = true;
            downsellTitle = upsellData.productTitle || upsellData.headline;
          } else {
            upsellPrice = parsed;
            hasUpsell = true;
            upsellTitle = upsellData.productTitle || upsellData.headline;
          }
        }
      }
    } else if (node.data.type === 'follow-up-sequence') {
      const seqData = node.data as any;
      const sType = seqData?.sequenceType;
      const sTitle = String(seqData?.sequenceTitle || seqData?.label || '');
      if (sType === 'checkout_recovery' || /cart|checkout/i.test(sTitle)) {
        hasCartRecovery = true;
        if (seqData.voucherCode) cartVoucherCode = seqData.voucherCode;
      }
      if (sType === 'upsell_recovery' || /rescue|second.?chance|oto.?recovery/i.test(sTitle)) {
        hasUpsellRescue = true;
        if (seqData.voucherCode) upsellVoucherCode = seqData.voucherCode;
      }
    }
  }

  return {
    corePrice,
    bumpPrice,
    upsellPrice,
    downsellPrice,
    hasBump,
    hasUpsell,
    hasDownsell,
    hasCartRecovery,
    hasUpsellRescue,
    coreTitle,
    bumpTitle,
    upsellTitle,
    downsellTitle,
    cartVoucherCode,
    upsellVoucherCode
  };
}

/**
 * Calculates end-to-end unit economics, profit margins, ROAS, and breakeven safety metrics,
 * incorporating automated retention recovery from cart abandonment and 24h courtesy upsell rescue.
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
    upsellPrice,
    downsellTakeRate = 0,
    downsellPrice = 0,
    cartRecoveryEnabled = false,
    cartRecoveryRate = 18,
    cartRecoveryDiscount = 10,
    upsellRescueEnabled = false,
    upsellRescueRate = 15,
    upsellRescueDiscount = 10
  } = forecast;

  // 1. Traffic & Front-End Orders
  const totalClicks = cpc > 0 ? Math.round(monthlyAdSpend / cpc) : 0;
  const frontEndOrders = Math.round(totalClicks * (conversionRate / 100));

  // 2. AOV Add-On Units
  const bumpSales = Math.round(frontEndOrders * (bumpTakeRate / 100));
  const upsellSales = Math.round(frontEndOrders * (upsellTakeRate / 100));
  // In authentic direct-response funnels, the downsell is presented to buyers who decline the upsell
  const declinedUpsellCount = Math.max(0, frontEndOrders - upsellSales);
  const downsellSales = Math.round(declinedUpsellCount * (downsellTakeRate / 100));

  // 3. Day 0 Front-End Revenue Breakdown
  const coreRevenue = frontEndOrders * corePrice;
  const bumpRevenue = bumpSales * bumpPrice;
  const upsellRevenue = upsellSales * upsellPrice;
  const downsellRevenue = downsellSales * downsellPrice;
  const dayZeroGrossRevenue = coreRevenue + bumpRevenue + upsellRevenue + downsellRevenue;

  // 4. Automated Retention Recovery Calculations ($0 additional ad spend)
  // Checkout abandonment estimation: In e-commerce, ~70% of initiated checkouts are abandoned.
  // When frontEndOrders complete at a ~30% checkout completion rate, estimated abandoned checkouts:
  const estimatedInitiatedCheckouts = frontEndOrders > 0 ? Math.round(frontEndOrders / 0.30) : 0;
  const abandonedCartCount = Math.max(0, estimatedInitiatedCheckouts - frontEndOrders);

  const recoveredCartOrders = cartRecoveryEnabled
    ? Math.round(abandonedCartCount * (Math.max(0, cartRecoveryRate) / 100))
    : 0;
  const effectiveCartRecoveryPrice = Math.max(0, corePrice * (1 - Math.max(0, cartRecoveryDiscount) / 100));
  const recoveredCartRevenue = recoveredCartOrders * effectiveCartRecoveryPrice;

  // 24h Courtesy Upsell Rescue: Targeted at buyers who declined the initial upsell and did not take downsell
  const unconvertedDeclinePool = Math.max(0, declinedUpsellCount - downsellSales);
  const recoveredUpsellOrders = upsellRescueEnabled
    ? Math.round(unconvertedDeclinePool * (Math.max(0, upsellRescueRate) / 100))
    : 0;
  const effectiveUpsellRescuePrice = Math.max(0, upsellPrice * (1 - Math.max(0, upsellRescueDiscount) / 100));
  const recoveredUpsellRevenue = recoveredUpsellOrders * effectiveUpsellRescuePrice;

  const totalRetentionRevenue = recoveredCartRevenue + recoveredUpsellRevenue;

  // 5. Blended Gross Totals
  const grossRevenue = dayZeroGrossRevenue + totalRetentionRevenue;
  const baseAov = corePrice;
  const totalCompletedBuyers = frontEndOrders + recoveredCartOrders;
  const effectiveAov = totalCompletedBuyers > 0 ? grossRevenue / totalCompletedBuyers : baseAov;
  const aovLift = Math.max(0, effectiveAov - baseAov);

  // 6. Cost Structure & Margins
  const cogsFraction = Math.max(0, Math.min(1, cogsPercentage / 100));
  const dayZeroCogs = dayZeroGrossRevenue * cogsFraction;
  const totalRetentionCogs = totalRetentionRevenue * cogsFraction;
  const estimatedCogs = grossRevenue * cogsFraction;

  const dayZeroNetProfit = dayZeroGrossRevenue - monthlyAdSpend - dayZeroCogs;
  const totalRetentionProfit = totalRetentionRevenue - totalRetentionCogs;
  const netProfit = grossRevenue - monthlyAdSpend - estimatedCogs;
  const retentionProfitLift = totalRetentionProfit;

  const dayZeroRoas = monthlyAdSpend > 0 ? dayZeroGrossRevenue / monthlyAdSpend : 0;
  const blendedRoas = monthlyAdSpend > 0 ? grossRevenue / monthlyAdSpend : 0;
  const effectiveRoasWithRetention = blendedRoas;

  // 7. Breakeven & Acquisition CAC Guardrails
  const breakevenCac = effectiveAov * (1 - cogsFraction);
  const projectedCac = frontEndOrders > 0
    ? monthlyAdSpend / frontEndOrders
    : (cpc > 0 && conversionRate > 0 ? cpc / (conversionRate / 100) : 0);
  const profitBuffer = breakevenCac - projectedCac;

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
    downsellSales,
    coreRevenue,
    bumpRevenue,
    upsellRevenue,
    downsellRevenue,
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
    leverage5PctUpsellProfit,
    // Automated Retention & Second-Chance Outputs
    abandonedCartCount,
    recoveredCartOrders,
    recoveredCartRevenue,
    declinedUpsellCount,
    recoveredUpsellOrders,
    recoveredUpsellRevenue,
    totalRetentionRevenue,
    totalRetentionProfit,
    dayZeroGrossRevenue,
    dayZeroNetProfit,
    dayZeroRoas,
    effectiveRoasWithRetention,
    retentionProfitLift
  };
}

