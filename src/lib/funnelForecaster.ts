import type { JourneyNode, JourneyEdge, FunnelForecast, FunnelSimulationResults, PageNodeData, UpsellNodeData } from '../types/journey';

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

export interface InjectRetentionOptions {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  addCartRecovery?: boolean;
  addUpsellRescue?: boolean;
  /** Read by nothing here: the Forecaster's discount is a what-if, never a code in the store (C18). */
  cartRecoveryDiscount?: number;
  /** Read by nothing here, for the same reason as cartRecoveryDiscount. */
  upsellRescueDiscount?: number;
  /**
   * Neutral drafts are the only copy this writes: plain titles, emails that say "Replace this"
   * and no voucher code, and no line out of the rescue sequence, because where a reader goes
   * after the emails is the person's call (#10, C18). The finished-copy branch invented a SAVE
   * code, shipping and a held bag for any caller that left this out, so it is gone (R12).
   * Kept so the callers that still pass true compile.
   */
  placeholderCopy?: boolean;
}

const DRAFT_SUBJECT = 'Write this subject';
const DRAFT_PREVIEW = 'Replace this before anyone receives it';
const DRAFT_BODY =
  'Hi [First Name],\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.\n\nThe Team';

export interface InjectRetentionResult {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  addedNodes: JourneyNode[];
  addedEdges: JourneyEdge[];
}

// The steps injectRetentionFlows wires its sequences to: the first page and the first upsell.
const firstLandingPage = (nodes: JourneyNode[]) => nodes.find(n => n.data?.type === 'landing-page');
const firstUpsell = (nodes: JourneyNode[]) => nodes.find(n => n.data?.type === 'upsell');

/**
 * True when this page sells through a checkout: a linked product or a checkout link. A page
 * without one collects leads, so an upsell after purchase or a cart recovery sequence on its
 * Left checkout exit would describe a checkout that is not there.
 */
export function sellsThroughCheckout(page: JourneyNode | undefined): boolean {
  const d = page?.data as PageNodeData | undefined;
  return Boolean(
    (d?.shopifyProductPrice && d.shopifyProductPrice.trim().length > 0) ||
    (d?.shopifyProductTitle && d.shopifyProductTitle.trim().length > 0) ||
    d?.shopifyProductId ||
    d?.shopifyVariantId ||
    (d?.checkoutUrl && d.checkoutUrl.trim().length > 0)
  );
}

/**
 * Which retention sequences belong on this journey and are not on it yet: cart recovery when the
 * first page sells through a checkout, upsell decline emails when there is an upsell, each only
 * while that step's exit is free. The Forecaster's Sync to Canvas and the store checks' fix both
 * ask this, so they agree on when a sequence belongs (R12). Never add a sequence that nothing
 * leads to. Without edges the exits are not checked.
 */
export function retentionFlowsThatFit(
  nodes: JourneyNode[],
  edges?: JourneyEdge[]
): { cartRecovery: boolean; upsellRescue: boolean } {
  const extracted = extractPricingFromNodes(nodes);
  const exitFree = (step: JourneyNode, handle: string) =>
    !edges || !edges.some(e => e.source === step.id && e.sourceHandle === handle);
  const page = firstLandingPage(nodes);
  const upsell = firstUpsell(nodes);
  return {
    cartRecovery: !extracted.hasCartRecovery && !!page && sellsThroughCheckout(page) && exitFree(page, 'abandon'),
    upsellRescue: !extracted.hasUpsellRescue && !!upsell && exitFree(upsell, 'rescue')
  };
}

/**
 * Adds the retention sequences asked for (cart recovery and/or upsell decline emails) as
 * "Replace this" drafts, each wired from the step it follows: the first page's Left checkout
 * exit or the first upsell's Rescue exit. A sequence already on the map is not added twice, and
 * one with no step to follow is not added at all. Whether it belongs is retentionFlowsThatFit's
 * call, which callers ask first.
 */
export function injectRetentionFlows(options: InjectRetentionOptions): InjectRetentionResult {
  const currentNodes = [...options.nodes];
  const currentEdges = [...options.edges];
  const addedNodes: JourneyNode[] = [];
  const addedEdges: JourneyEdge[] = [];

  const extracted = extractPricingFromNodes(currentNodes);
  const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  // Helper to find a free Y-coordinate directly below a parent node to prevent collisions
  const getFreePosition = (targetX: number, preferredY: number): { x: number; y: number } => {
    let y = preferredY;
    const isOccupied = (testY: number) =>
      currentNodes.some(n => Math.abs(n.position.x - targetX) < 120 && Math.abs(n.position.y - testY) < 100);
    while (isOccupied(y)) {
      y += 120;
    }
    return { x: targetX, y };
  };

  // A draft sequence below its step, and the retention line from that step's exit into it.
  const addBelow = (step: JourneyNode, handle: 'abandon' | 'rescue', id: string, data: JourneyNode['data']) => {
    const node: JourneyNode = {
      id,
      type: 'follow-up-sequence',
      position: getFreePosition(step.position.x, step.position.y + 280),
      data
    };
    currentNodes.push(node);
    addedNodes.push(node);
    const edge: JourneyEdge = {
      id: `e-${handle === 'abandon' ? 'cr' : 'ur-in'}-${token()}`,
      source: step.id,
      target: node.id,
      sourceHandle: handle,
      targetHandle: 'retention-in',
      data: {
        isRetentionEdge: true,
        sourceHandle: handle,
        targetHandle: 'retention-in',
        sourceThroughput: 0,
        targetCount: 0,
        rate: 0
      }
    };
    currentEdges.push(edge);
    addedEdges.push(edge);
  };

  // 1. Cart recovery, on the first page's Left checkout exit
  const landingPage = firstLandingPage(currentNodes);
  if (options.addCartRecovery && !extracted.hasCartRecovery && landingPage) {
    addBelow(landingPage, 'abandon', `node-cr-${token()}`, {
      type: 'follow-up-sequence',
      label: 'Cart Abandonment Recovery',
      sequenceTitle: 'Cart recovery emails',
      sequenceType: 'checkout_recovery',
      isRetentionBranch: true,
      delayHours: 1,
      smartExitOnPurchase: true,
      contactsEnrolled: 0,
      avgOpenRate: 0,
      avgClickRate: 0,
      steps: [
        { id: 'cr-step-1', channel: 'email', delay: '1 Hour', subject: DRAFT_SUBJECT, previewText: DRAFT_PREVIEW, body: DRAFT_BODY },
        { id: 'cr-step-2', channel: 'email', delay: '20 Hours', subject: DRAFT_SUBJECT, previewText: DRAFT_PREVIEW, body: DRAFT_BODY }
      ]
    } as JourneyNode['data']);
  }

  // 2. Upsell decline emails, on the first upsell's Rescue exit
  const upsellNode = firstUpsell(currentNodes);
  if (options.addUpsellRescue && !extracted.hasUpsellRescue && upsellNode) {
    addBelow(upsellNode, 'rescue', `node-ur-${token()}`, {
      type: 'follow-up-sequence',
      label: 'Upsell Decline Follow-up',
      sequenceTitle: 'Upsell decline emails',
      sequenceType: 'upsell_recovery',
      isRetentionBranch: true,
      delayHours: 18,
      smartExitOnPurchase: true,
      contactsEnrolled: 0,
      avgOpenRate: 0,
      avgClickRate: 0,
      steps: [
        { id: 'ur-step-1', channel: 'email', delay: '18 Hours', subject: DRAFT_SUBJECT, previewText: DRAFT_PREVIEW, body: DRAFT_BODY }
      ]
    } as JourneyNode['data']);
  }

  return {
    nodes: currentNodes,
    edges: currentEdges,
    addedNodes,
    addedEdges
  };
}
