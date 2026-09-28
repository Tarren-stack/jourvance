import type { JourneyProject, JourneyNode, JourneyEdge, Workspace, PageNodeData, UpsellNodeData } from '../types/journey';
import { extractPricingFromNodes, injectRetentionFlows } from './funnelForecaster';

export interface AuditCheckItem {
  id: string;
  pillarId: 'acquisition' | 'aov' | 'retention' | 'trust';
  title: string;
  points: number;
  maxPoints: number;
  passed: boolean;
  severity: 'critical' | 'recommended' | 'optional';
  summary: string;
  conversionImpact: string;
  autoFixType?: 'enable_mobile_sticky' | 'enable_order_bump' | 'add_trust_badge' | 'sync_cart_recovery' | 'sync_upsell_rescue' | 'sync_all_retention' | 'add_upsell_node';
  autoFixLabel?: string;
  targetNodeId?: string;
}

export interface AuditPillar {
  id: 'acquisition' | 'aov' | 'retention' | 'trust';
  title: string;
  description: string;
  score: number;
  maxScore: number;
  items: AuditCheckItem[];
}

export interface FunnelAuditReport {
  overallScore: number; // 0 to 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  tier: 'ready' | 'good' | 'leaking';
  headline: string;
  subhead: string;
  pillars: AuditPillar[];
  totalChecks: number;
  passedChecks: number;
  fixableChecks: number;
  estimatedMarginAtRisk: number;
}

/**
 * Pure deterministic auditor that evaluates a journey graph across 4 empirical
 * e-commerce conversion pillars, calculating a 100-point Conversion Readiness Score.
 */
export function auditFunnel(project: JourneyProject, workspace?: Workspace | null): FunnelAuditReport {
  const nodes = project.nodes || [];
  const edges = project.edges || [];
  const pricing = extractPricingFromNodes(nodes);

  const landingPageNode = nodes.find(n => n.type === 'landing-page');
  const lpData = (landingPageNode?.data as PageNodeData) || undefined;

  const upsellNodes = nodes.filter(n => n.type === 'upsell');
  const primaryUpsell = upsellNodes.find(n => (n.data as UpsellNodeData)?.offerType !== 'downsell') || upsellNodes[0];
  const upsellData = (primaryUpsell?.data as UpsellNodeData) || undefined;

  // -------------------------------------------------------------
  // Pillar 1: Front-End Acquisition & Mobile (30 pts)
  // -------------------------------------------------------------
  const isHeadlineDefined = Boolean(
    (project.offerHeadline && project.offerHeadline !== 'Your offer' && project.offerHeadline.trim().length > 3) ||
    (lpData?.headline && lpData.headline !== 'Your offer headline' && lpData.headline.trim().length > 3)
  );

  const isProductLinked = Boolean(
    (lpData?.shopifyProductPrice && lpData.shopifyProductPrice.trim().length > 0) ||
    (lpData?.shopifyProductTitle && lpData.shopifyProductTitle.trim().length > 0) ||
    lpData?.shopifyProductId ||
    lpData?.shopifyVariantId ||
    (lpData?.checkoutUrl && lpData.checkoutUrl.trim().length > 0)
  );

  const isMobileStickyEnabled = Boolean(lpData?.mobileStickyBarEnabled);

  const acquisitionItems: AuditCheckItem[] = [
    {
      id: 'headline_defined',
      pillarId: 'acquisition',
      title: 'Compelling Hero Headline',
      points: isHeadlineDefined ? 10 : 0,
      maxPoints: 10,
      passed: isHeadlineDefined,
      severity: 'critical',
      summary: isHeadlineDefined 
        ? 'Clear value proposition anchors incoming paid ad traffic.' 
        : 'Landing page has default or missing headline.',
      conversionImpact: 'Establishes instant emotional resonance; reduces immediate mobile bounce rates.',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'product_pricing_linked',
      pillarId: 'acquisition',
      title: 'Shopify Product & Price Linkage',
      points: isProductLinked ? 10 : 0,
      maxPoints: 10,
      passed: isProductLinked,
      severity: 'critical',
      summary: isProductLinked 
        ? `Primary offer configured ($${pricing.corePrice.toFixed(2)}).` 
        : 'No product or checkout price assigned.',
      conversionImpact: 'Ensures instantaneous 1-click cart creation with zero checkout errors.',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'mobile_sticky_bar',
      pillarId: 'acquisition',
      title: 'Mobile Sticky Checkout Bar',
      points: isMobileStickyEnabled ? 10 : 0,
      maxPoints: 10,
      passed: isMobileStickyEnabled,
      severity: 'recommended',
      summary: isMobileStickyEnabled 
        ? 'Persistent bottom action bar active on mobile viewports.' 
        : 'Mobile sticky action bar is disabled.',
      conversionImpact: 'Over 75% of paid traffic is mobile. A sticky bar lifts mobile conversions by 18-24%.',
      autoFixType: landingPageNode ? 'enable_mobile_sticky' : undefined,
      autoFixLabel: '✦ Enable Sticky Bar',
      targetNodeId: landingPageNode?.id
    }
  ];

  // -------------------------------------------------------------
  // Pillar 2: Day-0 AOV Expansion (30 pts)
  // -------------------------------------------------------------
  const isBumpActive = Boolean(lpData?.orderBumpEnabled && pricing.hasBump && pricing.bumpPrice > 0);
  const isUpsellActive = Boolean(pricing.hasUpsell && pricing.upsellPrice > 0);

  const aovItems: AuditCheckItem[] = [
    {
      id: 'order_bump_configured',
      pillarId: 'aov',
      title: '1-Click Order Bump (Checkout Add-On)',
      points: isBumpActive ? 15 : 0,
      maxPoints: 15,
      passed: isBumpActive,
      severity: 'recommended',
      summary: isBumpActive 
        ? `Order bump active (${pricing.bumpTitle || 'Add-on'} @ $${pricing.bumpPrice.toFixed(2)}).` 
        : 'No order bump attached to hero landing page.',
      conversionImpact: 'Pure-margin revenue booster taken by 25-35% of buyers at checkout with $0 extra ad spend.',
      autoFixType: landingPageNode ? 'enable_order_bump' : undefined,
      autoFixLabel: '✦ Attach $24 Order Bump',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'post_purchase_upsell',
      pillarId: 'aov',
      title: '1-Click Post-Purchase Upsell (OTO)',
      points: isUpsellActive ? 15 : 0,
      maxPoints: 15,
      passed: isUpsellActive,
      severity: 'recommended',
      summary: isUpsellActive 
        ? `Post-purchase upgrade configured ($${pricing.upsellPrice.toFixed(2)}).` 
        : 'No post-purchase 1-click upsell present in journey.',
      conversionImpact: 'Increases customer Average Order Value (AOV) by +25% to +40% before order fulfillment.',
      autoFixType: landingPageNode && !isUpsellActive ? 'add_upsell_node' : undefined,
      autoFixLabel: '✦ Add 1-Click Upsell',
      targetNodeId: primaryUpsell?.id
    }
  ];

  // -------------------------------------------------------------
  // Pillar 3: Automated Retention Safety Nets (25 pts)
  // -------------------------------------------------------------
  const isCartRecoveryActive = Boolean(pricing.hasCartRecovery);
  const isUpsellRescueActive = Boolean(pricing.hasUpsellRescue);

  const retentionItems: AuditCheckItem[] = [
    {
      id: 'cart_recovery_flow',
      pillarId: 'retention',
      title: 'Cart Abandonment Recovery Safety Net',
      points: isCartRecoveryActive ? 15 : 0,
      maxPoints: 15,
      passed: isCartRecoveryActive,
      severity: 'recommended',
      summary: isCartRecoveryActive 
        ? 'Automated 2-touch cart recovery sequence active on canvas.' 
        : 'Cart abandonment recovery flow is missing.',
      conversionImpact: 'Reclaims 15-20% of abandoned carts with automated courtesy vouchers ($0 extra ad cost).',
      autoFixType: !isCartRecoveryActive ? 'sync_cart_recovery' : undefined,
      autoFixLabel: '✦ Wire Cart Recovery',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'upsell_rescue_flow',
      pillarId: 'retention',
      title: '24h Courtesy Upsell Rescue Safety Net',
      points: isUpsellRescueActive ? 10 : 0,
      maxPoints: 10,
      passed: isUpsellRescueActive,
      severity: 'optional',
      summary: isUpsellRescueActive 
        ? '24h post-decline courtesy sequence active on canvas.' 
        : '24h courtesy upsell rescue flow is missing.',
      conversionImpact: 'Recaptures up to 18% of upsell decliners using a time-limited courtesy voucher.',
      autoFixType: !isUpsellRescueActive ? 'sync_upsell_rescue' : undefined,
      autoFixLabel: '✦ Wire Upsell Rescue',
      targetNodeId: primaryUpsell?.id
    }
  ];

  // -------------------------------------------------------------
  // Pillar 4: Trust & Technical Clearance (15 pts)
  // -------------------------------------------------------------
  const isTrustBadgePresent = Boolean(
    lpData?.trustBadge && lpData.trustBadge.trim().length > 3
  );

  const isPublishOrDomainReady = Boolean(
    lpData?.published ||
    lpData?.customDomainVerified ||
    workspace?.shopifyConfig?.status === 'connected' ||
    Boolean(project.shopifyStoreDomain)
  );

  const trustItems: AuditCheckItem[] = [
    {
      id: 'trust_badge_guarantee',
      pillarId: 'trust',
      title: 'Trust Badge & Guarantee Statement',
      points: isTrustBadgePresent ? 5 : 0,
      maxPoints: 5,
      passed: isTrustBadgePresent,
      severity: 'optional',
      summary: isTrustBadgePresent 
        ? 'Reassuring guarantee badge active on landing page.' 
        : 'No trust badge or satisfaction guarantee displayed.',
      conversionImpact: 'Reduces visitor perceived purchase risk and increases add-to-cart velocity.',
      autoFixType: landingPageNode && !isTrustBadgePresent ? 'add_trust_badge' : undefined,
      autoFixLabel: '✦ Add Botanical Guarantee',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'domain_and_publishing',
      pillarId: 'trust',
      title: 'Store Connection & Live Hosting',
      points: isPublishOrDomainReady ? 10 : 0,
      maxPoints: 10,
      passed: isPublishOrDomainReady,
      severity: 'critical',
      summary: isPublishOrDomainReady 
        ? 'Store connection and live publication routes verified.' 
        : 'Funnel is unpublished and not linked to a live store.',
      conversionImpact: 'Required for real customer order processing and live payment handling.'
    }
  ];

  // -------------------------------------------------------------
  // Pillar Construction & Aggregation
  // -------------------------------------------------------------
  const pillars: AuditPillar[] = [
    {
      id: 'acquisition',
      title: 'Acquisition & Mobile Experience',
      description: 'First impressions, offer clarity, and mobile viewport optimization.',
      score: acquisitionItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: acquisitionItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: acquisitionItems
    },
    {
      id: 'aov',
      title: 'Day-0 AOV Expansion',
      description: 'Order bumps and 1-click upsells maximizing front-end customer value.',
      score: aovItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: aovItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: aovItems
    },
    {
      id: 'retention',
      title: 'Automated Retention Safety Nets',
      description: 'Automated courtesy follow-ups capturing revenue from abandoners and decliners.',
      score: retentionItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: retentionItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: retentionItems
    },
    {
      id: 'trust',
      title: 'Trust & Technical Clearance',
      description: 'Guarantees, domain verification, and live checkout readiness.',
      score: trustItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: trustItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: trustItems
    }
  ];

  const overallScore = Math.min(100, Math.max(0, pillars.reduce((sum, p) => sum + p.score, 0)));
  const allItems = [...acquisitionItems, ...aovItems, ...retentionItems, ...trustItems];
  const passedChecks = allItems.filter(item => item.passed).length;
  const fixableChecks = allItems.filter(item => !item.passed && item.autoFixType).length;

  let grade: FunnelAuditReport['grade'] = 'D';
  let tier: FunnelAuditReport['tier'] = 'leaking';
  let headline = 'Funnel Has Hidden Revenue Leaks';
  let subhead = 'Implement available quick-wins below before launching paid ads to maximize your return on ad spend.';

  if (overallScore >= 95) {
    grade = 'A+';
    tier = 'ready';
    headline = 'Peak Conversion Architecture — Scale Ready';
    subhead = 'Your funnel incorporates all core acquisition, AOV expansion, and automated courtesy safety nets.';
  } else if (overallScore >= 90) {
    grade = 'A';
    tier = 'ready';
    headline = 'Launch Ready — High Conversion Architecture';
    subhead = 'Your funnel is in great shape for ad traffic with robust revenue safeguards.';
  } else if (overallScore >= 75) {
    grade = 'B';
    tier = 'good';
    headline = 'Solid Foundation — Quick AOV Wins Available';
    subhead = 'Your core offer is active, but you are leaving valuable backend margin on the table.';
  } else if (overallScore >= 60) {
    grade = 'C';
    tier = 'good';
    headline = 'Moderate Optimization Needed';
    subhead = 'Key conversion boosters are missing. Activating them will significantly reduce your breakeven CPA.';
  }

  // Calculate estimated monthly margin at risk (for average $3,000/mo ad spend)
  let estimatedMarginAtRisk = 0;
  if (!isMobileStickyEnabled) estimatedMarginAtRisk += 650;
  if (!isBumpActive) estimatedMarginAtRisk += 1150;
  if (!isUpsellActive) estimatedMarginAtRisk += 1400;
  if (!isCartRecoveryActive) estimatedMarginAtRisk += 880;
  if (!isUpsellRescueActive) estimatedMarginAtRisk += 420;

  return {
    overallScore,
    grade,
    tier,
    headline,
    subhead,
    pillars,
    totalChecks: allItems.length,
    passedChecks,
    fixableChecks,
    estimatedMarginAtRisk
  };
}

/**
 * Pure function to apply 1-click audit remediations to a JourneyProject.
 */
export function applyAuditFix(
  project: JourneyProject,
  fixType: AuditCheckItem['autoFixType'],
  options?: { targetNodeId?: string }
): JourneyProject {
  const currentNodes = [...project.nodes];
  const currentEdges = [...project.edges];
  const landingPageNode = currentNodes.find(n => 
    options?.targetNodeId ? n.id === options.targetNodeId : n.type === 'landing-page'
  );

  switch (fixType) {
    case 'enable_mobile_sticky': {
      if (!landingPageNode) return project;
      const updatedNodes = currentNodes.map(n => {
        if (n.id === landingPageNode.id) {
          return {
            ...n,
            data: {
              ...(n.data as PageNodeData),
              mobileStickyBarEnabled: true
            }
          };
        }
        return n;
      });
      return {
        ...project,
        nodes: updatedNodes,
        updatedAt: new Date().toISOString()
      };
    }

    case 'enable_order_bump': {
      if (!landingPageNode) return project;
      const pData = landingPageNode.data as PageNodeData;
      const updatedNodes = currentNodes.map(n => {
        if (n.id === landingPageNode.id) {
          return {
            ...n,
            data: {
              ...pData,
              orderBumpEnabled: true,
              orderBumpTitle: pData.orderBumpTitle || 'Illuminating Botanical Eye Elixir (15ml)',
              orderBumpPrice: pData.orderBumpPrice || '$24.00',
              orderBumpHeadline: pData.orderBumpHeadline || 'One-Time Privilege: Illuminating Eye Elixir',
              orderBumpDescription: pData.orderBumpDescription || 'Revitalize and brighten delicate eye contours with concentrated green tea and active botanicals.',
              orderBumpImage: pData.orderBumpImage || 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80'
            }
          };
        }
        return n;
      });
      return {
        ...project,
        nodes: updatedNodes,
        updatedAt: new Date().toISOString()
      };
    }

    case 'add_trust_badge': {
      if (!landingPageNode) return project;
      const pData = landingPageNode.data as PageNodeData;
      const updatedNodes = currentNodes.map(n => {
        if (n.id === landingPageNode.id) {
          return {
            ...n,
            data: {
              ...pData,
              trustBadge: pData.trustBadge || 'Handcrafted in small batches with sustainably sourced botanical actives • 30-Day Ritual Guarantee'
            }
          };
        }
        return n;
      });
      return {
        ...project,
        nodes: updatedNodes,
        updatedAt: new Date().toISOString()
      };
    }

    case 'sync_cart_recovery': {
      const result = injectRetentionFlows({
        nodes: currentNodes,
        edges: currentEdges,
        addCartRecovery: true,
        cartRecoveryDiscount: project.forecast?.cartRecoveryDiscount ?? 10
      });
      return {
        ...project,
        nodes: result.nodes,
        edges: result.edges,
        forecast: {
          ...(project.forecast || {} as any),
          cartRecoveryEnabled: true
        },
        updatedAt: new Date().toISOString()
      };
    }

    case 'sync_upsell_rescue': {
      const result = injectRetentionFlows({
        nodes: currentNodes,
        edges: currentEdges,
        addUpsellRescue: true,
        upsellRescueDiscount: project.forecast?.upsellRescueDiscount ?? 10
      });
      return {
        ...project,
        nodes: result.nodes,
        edges: result.edges,
        forecast: {
          ...(project.forecast || {} as any),
          upsellRescueEnabled: true
        },
        updatedAt: new Date().toISOString()
      };
    }

    case 'sync_all_retention': {
      const result = injectRetentionFlows({
        nodes: currentNodes,
        edges: currentEdges,
        addCartRecovery: true,
        addUpsellRescue: true,
        cartRecoveryDiscount: project.forecast?.cartRecoveryDiscount ?? 10,
        upsellRescueDiscount: project.forecast?.upsellRescueDiscount ?? 10
      });
      return {
        ...project,
        nodes: result.nodes,
        edges: result.edges,
        forecast: {
          ...(project.forecast || {} as any),
          cartRecoveryEnabled: true,
          upsellRescueEnabled: true
        },
        updatedAt: new Date().toISOString()
      };
    }

    case 'add_upsell_node': {
      if (!landingPageNode) return project;
      const newUpsellId = `node-upsell-${Date.now().toString(36)}`;
      const newUpsellNode: JourneyNode = {
        id: newUpsellId,
        type: 'upsell',
        position: {
          x: landingPageNode.position.x + 360,
          y: landingPageNode.position.y
        },
        data: {
          type: 'upsell',
          label: '1-Click Upsell (OTO)',
          offerType: 'upsell',
          headline: 'Complete Your Ritual With The Overnight Recovery Elixir',
          subhead: 'Formulated with pure botanical lipids to replenish skin barrier overnight. Add before your parcel seals.',
          badgeText: 'PRIVATE 40% VIP PRIVILEGE',
          urgencyMinutes: 5,
          productTitle: 'Overnight Barrier Recovery Elixir (30ml)',
          productPrice: '$38.00',
          regularPrice: '$64.00',
          discountPercentage: 40,
          benefits: [
            'Works in synergy with your primary daytime treatment',
            'Zero additional shipping fee — packed directly into your parcel',
            'Small-batch botanical formula bottled fresh'
          ],
          acceptButtonText: 'Yes! Add Overnight Elixir to My Order ($38.00)',
          declineButtonText: 'No thank you, I will stick with my daytime treatment'
        } as UpsellNodeData
      };

      // Connect landing page -> upsell
      const newEdge: JourneyEdge = {
        id: `e-page-upsell-${Date.now().toString(36)}`,
        source: landingPageNode.id,
        target: newUpsellId,
        sourceHandle: 'accepted',
        data: {
          sourceThroughput: 0,
          targetCount: 0,
          rate: 0,
          sourceHandle: 'accepted'
        }
      };

      return {
        ...project,
        nodes: [...currentNodes, newUpsellNode],
        edges: [...currentEdges, newEdge],
        updatedAt: new Date().toISOString()
      };
    }

    default:
      return project;
  }
}
