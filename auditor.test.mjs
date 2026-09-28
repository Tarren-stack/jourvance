import test from 'node:test';
import assert from 'node:assert/strict';

// Helper price parser matching funnelForecaster & funnelAuditor
function parseNumericPrice(val, fallback = 0) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val !== 'string') return fallback;
  const cleaned = val.replace(/[^0-9.]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? fallback : parsed;
}

function extractPricingFromNodes(nodes) {
  let corePrice = 58.00;
  let bumpPrice = 28.00;
  let upsellPrice = 38.00;
  let downsellPrice = 19.00;
  let hasBump = false;
  let hasUpsell = false;
  let hasDownsell = false;
  let hasCartRecovery = false;
  let hasUpsellRescue = false;
  let coreTitle;
  let bumpTitle;
  let upsellTitle;
  let downsellTitle;
  let cartVoucherCode;
  let upsellVoucherCode;

  for (const node of nodes) {
    if (node?.type === 'landing-page') {
      const pageData = node.data || {};
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
    } else if (node?.type === 'upsell') {
      const upsellData = node.data || {};
      if (upsellData.offerType === 'downsell') {
        if (upsellData.productPrice) {
          const parsed = parseNumericPrice(upsellData.productPrice, 0);
          if (parsed > 0) {
            downsellPrice = parsed;
            hasDownsell = true;
            downsellTitle = upsellData.productTitle || upsellData.headline;
          }
        }
      } else {
        if (upsellData.productPrice) {
          const parsed = parseNumericPrice(upsellData.productPrice, 0);
          if (parsed > 0) {
            upsellPrice = parsed;
            hasUpsell = true;
            upsellTitle = upsellData.productTitle || upsellData.headline;
          }
        }
      }
    } else if (node?.type === 'follow-up-sequence') {
      const seqData = node.data || {};
      if (seqData.sequenceType === 'checkout_recovery') {
        hasCartRecovery = true;
        if (seqData.voucherCode) cartVoucherCode = seqData.voucherCode;
      } else if (seqData.sequenceType === 'upsell_recovery') {
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

function injectRetentionFlows({
  nodes,
  edges,
  addCartRecovery = false,
  addUpsellRescue = false,
  cartRecoveryDiscount = 10,
  upsellRescueDiscount = 10
}) {
  const currentNodes = [...nodes];
  const currentEdges = [...edges];

  const landingPageNode = currentNodes.find(n => n.type === 'landing-page');
  const upsellNodes = currentNodes.filter(n => n.type === 'upsell');
  const primaryUpsell = upsellNodes.find(n => n.data?.offerType !== 'downsell') || upsellNodes[0];

  const hasExistingCartRecovery = currentNodes.some(
    n => n.type === 'follow-up-sequence' && n.data?.sequenceType === 'checkout_recovery'
  );
  const hasExistingUpsellRescue = currentNodes.some(
    n => n.type === 'follow-up-sequence' && n.data?.sequenceType === 'upsell_recovery'
  );

  let updatedNodes = [...currentNodes];
  let updatedEdges = [...currentEdges];

  if (addCartRecovery && !hasExistingCartRecovery && landingPageNode) {
    const cartSeqId = `node-cart-recovery-${Date.now().toString(36)}`;
    const targetX = landingPageNode.position.x;
    let targetY = landingPageNode.position.y + 240;

    while (updatedNodes.some(n => Math.abs(n.position.x - targetX) < 50 && Math.abs(n.position.y - targetY) < 50)) {
      targetY += 120;
    }

    const cartRecoveryNode = {
      id: cartSeqId,
      type: 'follow-up-sequence',
      position: { x: targetX, y: targetY },
      data: {
        type: 'follow-up-sequence',
        label: 'Automated Cart Recovery',
        sequenceTitle: 'Abandoned Checkout Courtesy Series',
        sequenceType: 'checkout_recovery',
        isRetentionBranch: true,
        delayHours: 1,
        voucherCode: `RECOVER${cartRecoveryDiscount}`,
        smartExitOnPurchase: true,
        steps: [
          {
            id: 'cr-s1',
            channel: 'email',
            delay: '1 Hour',
            subject: 'Did you leave your ritual behind? Your cart is reserved.',
            previewText: `We saved your order details and reserved your items. Use code RECOVER${cartRecoveryDiscount} for ${cartRecoveryDiscount}% off.`,
            body: `Hi [First Name],\n\nWe noticed you didn't complete your order. Use code RECOVER${cartRecoveryDiscount} at checkout.\n\n[Offer Link]`
          }
        ]
      }
    };

    const cartRecoveryEdge = {
      id: `e-abandon-${landingPageNode.id}-${cartSeqId}`,
      source: landingPageNode.id,
      target: cartSeqId,
      sourceHandle: 'abandoned',
      animated: true,
      style: { stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '5,5' },
      data: {
        sourceHandle: 'abandoned',
        label: 'Cart Abandoned (1h)',
        rate: 0.18
      }
    };

    updatedNodes.push(cartRecoveryNode);
    updatedEdges.push(cartRecoveryEdge);
  }

  if (addUpsellRescue && !hasExistingUpsellRescue && (primaryUpsell || landingPageNode)) {
    const parentNode = primaryUpsell || landingPageNode;
    const upsellSeqId = `node-upsell-rescue-${Date.now().toString(36)}`;
    const targetX = parentNode.position.x;
    let targetY = parentNode.position.y + 240;

    while (updatedNodes.some(n => Math.abs(n.position.x - targetX) < 50 && Math.abs(n.position.y - targetY) < 50)) {
      targetY += 120;
    }

    const upsellRescueNode = {
      id: upsellSeqId,
      type: 'follow-up-sequence',
      position: { x: targetX, y: targetY },
      data: {
        type: 'follow-up-sequence',
        label: '24h Courtesy Upsell Rescue',
        sequenceTitle: 'Post-Decline VIP Courtesy Series',
        sequenceType: 'upsell_recovery',
        isRetentionBranch: true,
        delayHours: 24,
        voucherCode: `VIPRESCUE${upsellRescueDiscount}`,
        smartExitOnPurchase: true,
        steps: [
          {
            id: 'ur-s1',
            channel: 'email',
            delay: '24 Hours',
            subject: 'Private courtesy reservation for your recent order',
            previewText: `We held a private reservation on your companion treatment. Take an extra ${upsellRescueDiscount}% off with code VIPRESCUE${upsellRescueDiscount}.`,
            body: `Hi [First Name],\n\nThank you for your order! As a courtesy, use code VIPRESCUE${upsellRescueDiscount} for ${upsellRescueDiscount}% off:\n\n[Offer Link]`
          }
        ]
      }
    };

    const upsellRescueEdge = {
      id: `e-declined-${parentNode.id}-${upsellSeqId}`,
      source: parentNode.id,
      target: upsellSeqId,
      sourceHandle: 'rescue',
      animated: true,
      style: { stroke: '#F59E0B', strokeWidth: 2, strokeDasharray: '5,5' },
      data: {
        sourceHandle: 'rescue',
        label: 'Upsell Declined (24h)',
        rate: 0.12
      }
    };

    updatedNodes.push(upsellRescueNode);
    updatedEdges.push(upsellRescueEdge);
  }

  return { nodes: updatedNodes, edges: updatedEdges };
}

// Deterministic Auditor Engine matching src/lib/funnelAuditor.ts
function auditFunnel(project, workspace) {
  const nodes = project.nodes || [];
  const edges = project.edges || [];
  const pricing = extractPricingFromNodes(nodes);

  const landingPageNode = nodes.find(n => n.type === 'landing-page');
  const lpData = landingPageNode?.data || {};

  const upsellNodes = nodes.filter(n => n.type === 'upsell');
  const primaryUpsell = upsellNodes.find(n => n.data?.offerType !== 'downsell') || upsellNodes[0];

  // Pillar 1: Acquisition & Mobile (30 pts)
  const isHeadlineDefined = Boolean(
    (project.offerHeadline && project.offerHeadline !== 'Your offer' && project.offerHeadline.trim().length > 3) ||
    (lpData.headline && lpData.headline !== 'Your offer headline' && lpData.headline.trim().length > 3)
  );

  const isProductLinked = Boolean(
    (lpData.shopifyProductPrice && lpData.shopifyProductPrice.trim().length > 0) ||
    (lpData.shopifyProductTitle && lpData.shopifyProductTitle.trim().length > 0) ||
    lpData.shopifyProductId ||
    lpData.shopifyVariantId ||
    (lpData.checkoutUrl && lpData.checkoutUrl.trim().length > 0)
  );

  const isMobileStickyEnabled = Boolean(lpData.mobileStickyBarEnabled);

  const acquisitionItems = [
    {
      id: 'headline_defined',
      pillarId: 'acquisition',
      title: 'Compelling Hero Headline',
      points: isHeadlineDefined ? 10 : 0,
      maxPoints: 10,
      passed: isHeadlineDefined,
      severity: 'critical',
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
      autoFixType: landingPageNode ? 'enable_mobile_sticky' : undefined,
      autoFixLabel: '✦ Enable Sticky Bar',
      targetNodeId: landingPageNode?.id
    }
  ];

  // Pillar 2: Day-0 AOV Expansion (30 pts)
  const isBumpActive = Boolean(lpData.orderBumpEnabled && pricing.hasBump && pricing.bumpPrice > 0);
  const isUpsellActive = Boolean(pricing.hasUpsell && pricing.upsellPrice > 0);

  const aovItems = [
    {
      id: 'order_bump_configured',
      pillarId: 'aov',
      title: '1-Click Order Bump (Checkout Add-On)',
      points: isBumpActive ? 15 : 0,
      maxPoints: 15,
      passed: isBumpActive,
      severity: 'recommended',
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
      autoFixType: landingPageNode && !isUpsellActive ? 'add_upsell_node' : undefined,
      autoFixLabel: '✦ Add 1-Click Upsell',
      targetNodeId: primaryUpsell?.id
    }
  ];

  // Pillar 3: Automated Retention Safety Nets (25 pts)
  const isCartRecoveryActive = Boolean(pricing.hasCartRecovery);
  const isUpsellRescueActive = Boolean(pricing.hasUpsellRescue);

  const retentionItems = [
    {
      id: 'cart_recovery_flow',
      pillarId: 'retention',
      title: 'Cart Abandonment Recovery Safety Net',
      points: isCartRecoveryActive ? 15 : 0,
      maxPoints: 15,
      passed: isCartRecoveryActive,
      severity: 'recommended',
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
      autoFixType: !isUpsellRescueActive ? 'sync_upsell_rescue' : undefined,
      autoFixLabel: '✦ Wire Upsell Rescue',
      targetNodeId: primaryUpsell?.id
    }
  ];

  // Pillar 4: Trust & Technical Clearance (15 pts)
  const isTrustBadgePresent = Boolean(
    lpData.trustBadge && lpData.trustBadge.trim().length > 3
  );

  const isPublishOrDomainReady = Boolean(
    lpData.published ||
    lpData.customDomainVerified ||
    workspace?.shopifyConfig?.status === 'connected' ||
    Boolean(project.shopifyStoreDomain)
  );

  const trustItems = [
    {
      id: 'trust_badge_guarantee',
      pillarId: 'trust',
      title: 'Trust Badge & Guarantee Statement',
      points: isTrustBadgePresent ? 5 : 0,
      maxPoints: 5,
      passed: isTrustBadgePresent,
      severity: 'optional',
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
      severity: 'critical'
    }
  ];

  const pillars = [
    {
      id: 'acquisition',
      title: 'Acquisition & Mobile Experience',
      score: acquisitionItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: acquisitionItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: acquisitionItems
    },
    {
      id: 'aov',
      title: 'Day-0 AOV Expansion',
      score: aovItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: aovItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: aovItems
    },
    {
      id: 'retention',
      title: 'Automated Retention Safety Nets',
      score: retentionItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: retentionItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: retentionItems
    },
    {
      id: 'trust',
      title: 'Trust & Technical Clearance',
      score: trustItems.reduce((sum, item) => sum + item.points, 0),
      maxScore: trustItems.reduce((sum, item) => sum + item.maxPoints, 0),
      items: trustItems
    }
  ];

  const overallScore = Math.min(100, Math.max(0, pillars.reduce((sum, p) => sum + p.score, 0)));
  const allItems = [...acquisitionItems, ...aovItems, ...retentionItems, ...trustItems];
  const passedChecks = allItems.filter(item => item.passed).length;
  const fixableChecks = allItems.filter(item => !item.passed && item.autoFixType).length;

  let grade = 'D';
  let tier = 'leaking';
  let headline = 'Funnel Has Hidden Revenue Leaks';
  let subhead = 'Implement available quick-wins below before launching paid ads to maximize your return on ad spend.';

  if (overallScore >= 95) {
    grade = 'A+';
    tier = 'ready';
    headline = 'Peak Conversion Architecture — Scale Ready';
  } else if (overallScore >= 90) {
    grade = 'A';
    tier = 'ready';
    headline = 'Launch Ready — High Conversion Architecture';
  } else if (overallScore >= 75) {
    grade = 'B';
    tier = 'good';
    headline = 'Solid Foundation — Quick AOV Wins Available';
  } else if (overallScore >= 60) {
    grade = 'C';
    tier = 'good';
    headline = 'Moderate Optimization Needed';
  }

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

function applyAuditFix(project, fixType, options) {
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
              ...n.data,
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
      const pData = landingPageNode.data || {};
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
              orderBumpDescription: pData.orderBumpDescription || 'Revitalize and brighten delicate eye contours.',
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
      const pData = landingPageNode.data || {};
      const updatedNodes = currentNodes.map(n => {
        if (n.id === landingPageNode.id) {
          return {
            ...n,
            data: {
              ...pData,
              trustBadge: pData.trustBadge || 'Handcrafted with botanical actives • 30-Day Ritual Guarantee'
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
          ...(project.forecast || {}),
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
          ...(project.forecast || {}),
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
          ...(project.forecast || {}),
          cartRecoveryEnabled: true,
          upsellRescueEnabled: true
        },
        updatedAt: new Date().toISOString()
      };
    }

    case 'add_upsell_node': {
      if (!landingPageNode) return project;
      const newUpsellId = `node-upsell-${Date.now().toString(36)}`;
      const newUpsellNode = {
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
          subhead: 'Formulated with pure botanical lipids.',
          badgeText: 'PRIVATE 40% VIP PRIVILEGE',
          urgencyMinutes: 5,
          productTitle: 'Overnight Barrier Recovery Elixir (30ml)',
          productPrice: '$38.00',
          regularPrice: '$64.00',
          discountPercentage: 40,
          acceptButtonText: 'Yes! Add Overnight Elixir to My Order ($38.00)',
          declineButtonText: 'No thank you, I will stick with my daytime treatment'
        }
      };

      const newEdge = {
        id: `e-page-upsell-${Date.now().toString(36)}`,
        source: landingPageNode.id,
        target: newUpsellId,
        sourceHandle: 'accepted',
        data: {
          sourceHandle: 'accepted',
          rate: 0
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

// -------------------------------------------------------------
// Test Suites
// -------------------------------------------------------------

test('auditFunnel: scores bare/unconfigured funnel in leaking tier with actionable quick-wins', () => {
  const bareProject = {
    id: 'proj-1',
    name: 'Unconfigured Funnel',
    offerHeadline: '',
    nodes: [
      {
        id: 'node-lp',
        type: 'landing-page',
        position: { x: 100, y: 100 },
        data: {
          headline: '',
          shopifyProductPrice: ''
        }
      }
    ],
    edges: []
  };

  const audit = auditFunnel(bareProject, null);

  assert.equal(audit.overallScore < 30, true, `Score should be low for unconfigured funnel, got ${audit.overallScore}`);
  assert.equal(audit.grade, 'D');
  assert.equal(audit.tier, 'leaking');
  assert.equal(audit.fixableChecks >= 3, true);
  assert.equal(audit.estimatedMarginAtRisk > 3000, true, `Estimated margin at risk should be > $3,000, got $${audit.estimatedMarginAtRisk}`);

  // Pillar scores check
  const acqPillar = audit.pillars.find(p => p.id === 'acquisition');
  const aovPillar = audit.pillars.find(p => p.id === 'aov');
  const retPillar = audit.pillars.find(p => p.id === 'retention');
  const trustPillar = audit.pillars.find(p => p.id === 'trust');

  assert.equal(acqPillar.score, 0); // No headline, no price, no mobile sticky
  assert.equal(aovPillar.score, 0); // No bump, no upsell
  assert.equal(retPillar.score, 0); // No cart recovery, no upsell rescue
  assert.equal(trustPillar.score, 0); // No guarantee, no domain/publishing
});

test('auditFunnel: scores flagship 6-node beauty funnel with perfect 100 score and A+ grade', () => {
  const completeProject = {
    id: 'proj-flagship',
    name: 'Flagship Botanical Funnel',
    offerHeadline: 'The Botanical Restorative Ritual',
    shopifyStoreDomain: 'botanical.myshopify.com',
    nodes: [
      {
        id: 'lp-1',
        type: 'landing-page',
        position: { x: 100, y: 100 },
        data: {
          headline: 'Experience Ageless Radiance In 14 Days',
          shopifyProductPrice: '$68.00',
          shopifyProductTitle: 'Daytime Youth Elixir',
          mobileStickyBarEnabled: true,
          orderBumpEnabled: true,
          orderBumpPrice: '$24.00',
          orderBumpTitle: 'Illuminating Eye Elixir',
          trustBadge: 'Certified Organic • 30-Day Ritual Guarantee',
          published: true
        }
      },
      {
        id: 'upsell-1',
        type: 'upsell',
        position: { x: 480, y: 100 },
        data: {
          offerType: 'upsell',
          productTitle: 'Overnight Barrier Cream',
          productPrice: '$42.00'
        }
      },
      {
        id: 'cr-1',
        type: 'follow-up-sequence',
        position: { x: 100, y: 340 },
        data: {
          sequenceType: 'checkout_recovery',
          voucherCode: 'SAVE10'
        }
      },
      {
        id: 'ur-1',
        type: 'follow-up-sequence',
        position: { x: 480, y: 340 },
        data: {
          sequenceType: 'upsell_recovery',
          voucherCode: 'COURTESY10'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'lp-1', target: 'upsell-1', sourceHandle: 'accepted' },
      { id: 'e2', source: 'lp-1', target: 'cr-1', sourceHandle: 'abandoned' },
      { id: 'e3', source: 'upsell-1', target: 'ur-1', sourceHandle: 'rescue' }
    ]
  };

  const audit = auditFunnel(completeProject, { shopifyConfig: { status: 'connected' } });

  assert.equal(audit.overallScore, 100);
  assert.equal(audit.grade, 'A+');
  assert.equal(audit.tier, 'ready');
  assert.equal(audit.fixableChecks, 0);
  assert.equal(audit.estimatedMarginAtRisk, 0);
  assert.equal(audit.passedChecks, audit.totalChecks);
});

test('applyAuditFix: enable_mobile_sticky updates landing page and increases score by 10 pts', () => {
  const project = {
    id: 'proj-sticky',
    offerHeadline: 'Luxe Hair Oil',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 0, y: 0 },
        data: {
          headline: 'Luxe Hair Oil',
          shopifyProductPrice: '$45.00',
          mobileStickyBarEnabled: false
        }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'enable_mobile_sticky');
  const after = auditFunnel(fixed, null);

  const lp = fixed.nodes.find(n => n.id === 'lp-node');
  assert.equal(lp.data.mobileStickyBarEnabled, true);
  assert.equal(after.overallScore - before.overallScore, 10);
  assert.equal(before.estimatedMarginAtRisk - after.estimatedMarginAtRisk, 650);
});

test('applyAuditFix: enable_order_bump configures bump fields and increases score by 15 pts', () => {
  const project = {
    id: 'proj-bump',
    offerHeadline: 'Botanical Cleanser',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 0, y: 0 },
        data: {
          headline: 'Botanical Cleanser',
          shopifyProductPrice: '$35.00',
          orderBumpEnabled: false
        }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'enable_order_bump');
  const after = auditFunnel(fixed, null);

  const lp = fixed.nodes.find(n => n.id === 'lp-node');
  assert.equal(lp.data.orderBumpEnabled, true);
  assert.equal(lp.data.orderBumpPrice, '$24.00');
  assert.equal(typeof lp.data.orderBumpTitle, 'string');
  assert.equal(after.overallScore - before.overallScore, 15);
  assert.equal(before.estimatedMarginAtRisk - after.estimatedMarginAtRisk, 1150);
});

test('applyAuditFix: add_trust_badge injects botanical guarantee and awards 5 pts', () => {
  const project = {
    id: 'proj-trust',
    offerHeadline: 'Active Vitamin C',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 0, y: 0 },
        data: {
          headline: 'Active Vitamin C',
          shopifyProductPrice: '$55.00',
          trustBadge: ''
        }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'add_trust_badge');
  const after = auditFunnel(fixed, null);

  const lp = fixed.nodes.find(n => n.id === 'lp-node');
  assert.equal(typeof lp.data.trustBadge, 'string');
  assert.equal(lp.data.trustBadge.includes('Guarantee'), true);
  assert.equal(after.overallScore - before.overallScore, 5);
});

test('applyAuditFix: sync_cart_recovery wires follow-up node and golden edge', () => {
  const project = {
    id: 'proj-cr',
    offerHeadline: 'Rosewater Mist',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 100, y: 100 },
        data: {
          headline: 'Rosewater Mist',
          shopifyProductPrice: '$28.00'
        }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'sync_cart_recovery');
  const after = auditFunnel(fixed, null);

  assert.equal(fixed.nodes.length, 2);
  const recoveryNode = fixed.nodes.find(n => n.data?.sequenceType === 'checkout_recovery');
  assert.ok(recoveryNode, 'Cart recovery node should be present');
  assert.equal(recoveryNode.position.x, 100);
  assert.equal(recoveryNode.position.y, 340);

  const recoveryEdge = fixed.edges.find(e => e.sourceHandle === 'abandoned');
  assert.ok(recoveryEdge, 'Abandoned cart edge should be connected');
  assert.equal(recoveryEdge.source, 'lp-node');
  assert.equal(recoveryEdge.target, recoveryNode.id);

  assert.equal(after.overallScore - before.overallScore, 15);
  assert.equal(before.estimatedMarginAtRisk - after.estimatedMarginAtRisk, 880);
});

test('applyAuditFix: sync_upsell_rescue wires 24h courtesy recovery to upsell', () => {
  const project = {
    id: 'proj-ur',
    offerHeadline: 'Lash Serum',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 100, y: 100 },
        data: { headline: 'Lash Serum', shopifyProductPrice: '$48.00' }
      },
      {
        id: 'upsell-node',
        type: 'upsell',
        position: { x: 460, y: 100 },
        data: { offerType: 'upsell', productTitle: 'Brow Sculptor', productPrice: '$32.00' }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'sync_upsell_rescue');
  const after = auditFunnel(fixed, null);

  assert.equal(fixed.nodes.length, 3);
  const rescueNode = fixed.nodes.find(n => n.data?.sequenceType === 'upsell_recovery');
  assert.ok(rescueNode, 'Upsell rescue node should be present');
  assert.equal(rescueNode.position.x, 460);
  assert.equal(rescueNode.position.y, 340);

  const rescueEdge = fixed.edges.find(e => e.sourceHandle === 'rescue');
  assert.ok(rescueEdge, 'Rescue edge should be connected');
  assert.equal(rescueEdge.source, 'upsell-node');
  assert.equal(rescueEdge.target, rescueNode.id);

  assert.equal(after.overallScore - before.overallScore, 10);
  assert.equal(before.estimatedMarginAtRisk - after.estimatedMarginAtRisk, 420);
});

test('applyAuditFix: add_upsell_node creates OTO node and connects accepted edge', () => {
  const project = {
    id: 'proj-oto',
    offerHeadline: 'Hydra Glow Kit',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 200, y: 150 },
        data: {
          headline: 'Hydra Glow Kit',
          shopifyProductPrice: '$54.00'
        }
      }
    ],
    edges: []
  };

  const before = auditFunnel(project, null);
  const fixed = applyAuditFix(project, 'add_upsell_node');
  const after = auditFunnel(fixed, null);

  assert.equal(fixed.nodes.length, 2);
  const newUpsell = fixed.nodes.find(n => n.type === 'upsell');
  assert.ok(newUpsell, 'New upsell node should be generated');
  assert.equal(newUpsell.position.x, 200 + 360);
  assert.equal(newUpsell.position.y, 150);
  assert.equal(newUpsell.data.productPrice, '$38.00');

  const edge = fixed.edges.find(e => e.source === 'lp-node' && e.target === newUpsell.id);
  assert.ok(edge, 'Edge connecting landing page to upsell should exist');
  assert.equal(edge.sourceHandle, 'accepted');

  assert.equal(after.overallScore - before.overallScore, 15);
  assert.equal(before.estimatedMarginAtRisk - after.estimatedMarginAtRisk, 1400);
});

test('Sequential Quick Wins: Taking a funnel from 20 to 95+ points systematically', () => {
  let project = {
    id: 'proj-remediation',
    offerHeadline: 'Rose Renewal Serum',
    nodes: [
      {
        id: 'lp-node',
        type: 'landing-page',
        position: { x: 100, y: 100 },
        data: {
          headline: 'Rose Renewal Serum',
          shopifyProductPrice: '$48.00',
          published: true
        }
      }
    ],
    edges: []
  };

  // Baseline audit
  let audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 30); // headline 10, product 10, domain/publish 10
  assert.equal(audit.tier, 'leaking');

  // Step 1: Fix mobile sticky (+10)
  project = applyAuditFix(project, 'enable_mobile_sticky');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 40);

  // Step 2: Fix order bump (+15)
  project = applyAuditFix(project, 'enable_order_bump');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 55);

  // Step 3: Add upsell node (+15)
  project = applyAuditFix(project, 'add_upsell_node');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 70);

  // Step 4: Wire cart recovery (+15)
  project = applyAuditFix(project, 'sync_cart_recovery');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 85);

  // Step 5: Wire upsell rescue (+10)
  project = applyAuditFix(project, 'sync_upsell_rescue');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 95);

  // Step 6: Add botanical trust badge (+5)
  project = applyAuditFix(project, 'add_trust_badge');
  audit = auditFunnel(project, null);
  assert.equal(audit.overallScore, 100);
  assert.equal(audit.grade, 'A+');
  assert.equal(audit.tier, 'ready');
  assert.equal(audit.estimatedMarginAtRisk, 0);
  assert.equal(audit.fixableChecks, 0);
});
