import test from 'node:test';
import assert from 'node:assert/strict';

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
    if (node?.data?.type === 'landing-page') {
      const pageData = node.data;
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
    } else if (node?.data?.type === 'upsell') {
      const upsellData = node.data;
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
    } else if (node?.data?.type === 'follow-up-sequence') {
      const seqData = node.data;
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

function calculateFunnelForecast(forecast) {
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

  const totalClicks = cpc > 0 ? Math.round(monthlyAdSpend / cpc) : 0;
  const frontEndOrders = Math.round(totalClicks * (conversionRate / 100));

  const bumpSales = Math.round(frontEndOrders * (bumpTakeRate / 100));
  const upsellSales = Math.round(frontEndOrders * (upsellTakeRate / 100));
  const declinedUpsellCount = Math.max(0, frontEndOrders - upsellSales);
  const downsellSales = Math.round(declinedUpsellCount * (downsellTakeRate / 100));

  const coreRevenue = frontEndOrders * corePrice;
  const bumpRevenue = bumpSales * bumpPrice;
  const upsellRevenue = upsellSales * upsellPrice;
  const downsellRevenue = downsellSales * downsellPrice;
  const dayZeroGrossRevenue = coreRevenue + bumpRevenue + upsellRevenue + downsellRevenue;

  // Retention
  const estimatedInitiatedCheckouts = frontEndOrders > 0 ? Math.round(frontEndOrders / 0.30) : 0;
  const abandonedCartCount = Math.max(0, estimatedInitiatedCheckouts - frontEndOrders);

  const recoveredCartOrders = cartRecoveryEnabled
    ? Math.round(abandonedCartCount * (Math.max(0, cartRecoveryRate) / 100))
    : 0;
  const effectiveCartRecoveryPrice = Math.max(0, corePrice * (1 - Math.max(0, cartRecoveryDiscount) / 100));
  const recoveredCartRevenue = recoveredCartOrders * effectiveCartRecoveryPrice;

  const unconvertedDeclinePool = Math.max(0, declinedUpsellCount - downsellSales);
  const recoveredUpsellOrders = upsellRescueEnabled
    ? Math.round(unconvertedDeclinePool * (Math.max(0, upsellRescueRate) / 100))
    : 0;
  const effectiveUpsellRescuePrice = Math.max(0, upsellPrice * (1 - Math.max(0, upsellRescueDiscount) / 100));
  const recoveredUpsellRevenue = recoveredUpsellOrders * effectiveUpsellRescuePrice;

  const totalRetentionRevenue = recoveredCartRevenue + recoveredUpsellRevenue;
  const grossRevenue = dayZeroGrossRevenue + totalRetentionRevenue;

  const baseAov = corePrice;
  const totalCompletedBuyers = frontEndOrders + recoveredCartOrders;
  const effectiveAov = totalCompletedBuyers > 0 ? grossRevenue / totalCompletedBuyers : baseAov;
  const aovLift = Math.max(0, effectiveAov - baseAov);

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

  const breakevenCac = effectiveAov * (1 - cogsFraction);
  const projectedCac = frontEndOrders > 0
    ? monthlyAdSpend / frontEndOrders
    : (cpc > 0 && conversionRate > 0 ? cpc / (conversionRate / 100) : 0);
  const profitBuffer = breakevenCac - projectedCac;

  const breakevenCvr = breakevenCac > 0 ? (cpc / breakevenCac) * 100 : 0;
  const cvrBuffer = conversionRate - breakevenCvr;

  const isProfitable = netProfit > 0;

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

// ── Tests ─────────────────────────────────────────────────────────────

test('extractPricingFromNodes accurately differentiates core product, bump, upsell, and downsell', () => {
  const sampleNodes = [
    {
      id: 'node-lp',
      data: {
        type: 'landing-page',
        shopifyProductTitle: 'Aura Glow Serum',
        shopifyProductPrice: '$48.00',
        orderBumpEnabled: true,
        orderBumpTitle: 'Hydra-Silk Travel Mist',
        orderBumpPrice: '$18.50'
      }
    },
    {
      id: 'node-upsell',
      data: {
        type: 'upsell',
        offerType: 'upsell',
        productTitle: 'VIP Masterclass All-Access',
        productPrice: '$67.00'
      }
    },
    {
      id: 'node-downsell',
      data: {
        type: 'upsell',
        offerType: 'downsell',
        productTitle: 'Mini Starter Toolkit',
        productPrice: '$27.00'
      }
    }
  ];

  const extracted = extractPricingFromNodes(sampleNodes);

  assert.equal(extracted.corePrice, 48.00, 'Extracts core price from landing page');
  assert.equal(extracted.coreTitle, 'Aura Glow Serum');
  assert.equal(extracted.bumpPrice, 18.50, 'Extracts order bump price');
  assert.equal(extracted.hasBump, true);
  assert.equal(extracted.bumpTitle, 'Hydra-Silk Travel Mist');

  assert.equal(extracted.upsellPrice, 67.00, 'Extracts primary upsell price');
  assert.equal(extracted.hasUpsell, true);
  assert.equal(extracted.upsellTitle, 'VIP Masterclass All-Access');

  assert.equal(extracted.downsellPrice, 27.00, 'Extracts distinct downsell price without overwriting upsell');
  assert.equal(extracted.hasDownsell, true);
  assert.equal(extracted.downsellTitle, 'Mini Starter Toolkit');
});

test('calculateFunnelForecast models multi-step AOV expansion and downsell decline pool', () => {
  const forecast = {
    monthlyAdSpend: 3000,
    cpc: 1.50, // 2,000 clicks
    conversionRate: 5.0, // 100 front-end buyers
    corePrice: 50.00, // $5,000 core rev
    cogsPercentage: 20, // 20% product cost
    bumpTakeRate: 30, // 30 bump buyers
    bumpPrice: 20.00, // $600 bump rev
    upsellTakeRate: 20, // 20 upsell buyers
    upsellPrice: 50.00, // $1,000 upsell rev
    downsellTakeRate: 25, // 25% of the 80 declined buyers = 20 buyers
    downsellPrice: 25.00 // $500 downsell rev
  };

  const sim = calculateFunnelForecast(forecast);

  assert.equal(sim.totalClicks, 2000, 'Calculates 2000 clicks');
  assert.equal(sim.frontEndOrders, 100, 'Calculates 100 front-end orders');
  assert.equal(sim.bumpSales, 30, 'Calculates 30 bump buyers');
  assert.equal(sim.upsellSales, 20, 'Calculates 20 upsell buyers');
  assert.equal(sim.downsellSales, 20, 'Calculates 20 downsell buyers from 80 non-upsell buyers');

  assert.equal(sim.coreRevenue, 5000);
  assert.equal(sim.bumpRevenue, 600);
  assert.equal(sim.upsellRevenue, 1000);
  assert.equal(sim.downsellRevenue, 500);

  // Total gross = 5000 + 600 + 1000 + 500 = 7100
  assert.equal(sim.grossRevenue, 7100);
  assert.equal(sim.effectiveAov, 71.00, 'Effective AOV expands from $50.00 to $71.00');
  assert.equal(sim.aovLift, 21.00, 'AOV lift is +$21.00 per buyer');

  // COGS = 7100 * 0.20 = 1420. Ad spend = 3000.
  // Net profit = 7100 - 3000 - 1420 = 2680
  assert.equal(sim.estimatedCogs, 1420);
  assert.equal(sim.netProfit, 2680);
  assert.ok(sim.isProfitable);

  // Blended ROAS = 7100 / 3000 = 2.37x
  assert.equal(Number(sim.blendedRoas.toFixed(2)), 2.37);

  // Breakeven CAC = 71.00 * (1 - 0.20) = 56.80
  assert.equal(Number(sim.breakevenCac.toFixed(2)), 56.80);
  // Projected CAC = 3000 / 100 = 30.00
  assert.equal(sim.projectedCac, 30.00);
  // Profit buffer = 56.80 - 30.00 = 26.80
  assert.equal(Number(sim.profitBuffer.toFixed(2)), 26.80);
});

test('calculateFunnelForecast flags unprofitable campaigns with negative safety buffers', () => {
  const lossForecast = {
    monthlyAdSpend: 5000,
    cpc: 4.00, // 1250 clicks
    conversionRate: 1.0, // 13 buyers
    corePrice: 30.00,
    cogsPercentage: 30,
    bumpTakeRate: 0,
    bumpPrice: 0,
    upsellTakeRate: 0,
    upsellPrice: 0,
    downsellTakeRate: 0,
    downsellPrice: 0
  };

  const sim = calculateFunnelForecast(lossForecast);

  assert.equal(sim.isProfitable, false, 'Flags unprofitable campaign as false');
  assert.ok(sim.netProfit < 0, 'Net profit is negative');
  assert.ok(sim.profitBuffer < 0, 'Profit buffer is negative');
});

test('extractPricingFromNodes extracts automated retention flows and voucher codes from follow-up nodes', () => {
  const canvasNodes = [
    {
      id: 'node-lp',
      data: {
        type: 'landing-page',
        shopifyProductTitle: 'Aura Glow Serum',
        shopifyProductPrice: '58.00',
        orderBumpEnabled: true,
        orderBumpPrice: '28.00'
      }
    },
    {
      id: 'node-upsell',
      data: {
        type: 'upsell',
        offerType: 'upsell',
        productPrice: '48.00'
      }
    },
    {
      id: 'seq-cart',
      data: {
        type: 'follow-up-sequence',
        sequenceType: 'checkout_recovery',
        sequenceTitle: 'High-Intent Cart Recovery Flow',
        voucherCode: 'SAVE10'
      }
    },
    {
      id: 'seq-rescue',
      data: {
        type: 'follow-up-sequence',
        sequenceType: 'upsell_recovery',
        sequenceTitle: '24-Hour VIP Courtesy Offer Rescue',
        voucherCode: 'VIPRESCUE'
      }
    }
  ];

  const extracted = extractPricingFromNodes(canvasNodes);
  assert.equal(extracted.hasCartRecovery, true, 'Detects checkout recovery sequence on canvas');
  assert.equal(extracted.hasUpsellRescue, true, 'Detects upsell recovery sequence on canvas');
  assert.equal(extracted.cartVoucherCode, 'SAVE10', 'Extracts cart voucher code');
  assert.equal(extracted.upsellVoucherCode, 'VIPRESCUE', 'Extracts upsell voucher code');

  // Canvas without sequence nodes
  const nodesWithoutRetention = canvasNodes.slice(0, 2);
  const extractedPlain = extractPricingFromNodes(nodesWithoutRetention);
  assert.equal(extractedPlain.hasCartRecovery, false);
  assert.equal(extractedPlain.hasUpsellRescue, false);
});

test('calculateFunnelForecast: retention disabled yields pure Day-0 results', () => {
  const forecast = {
    monthlyAdSpend: 3000,
    cpc: 1.50, // 2000 clicks
    conversionRate: 5.0, // 100 orders
    corePrice: 50.00,
    cogsPercentage: 20,
    bumpTakeRate: 0,
    bumpPrice: 0,
    upsellTakeRate: 0,
    upsellPrice: 0,
    cartRecoveryEnabled: false,
    upsellRescueEnabled: false
  };

  const sim = calculateFunnelForecast(forecast);
  assert.equal(sim.dayZeroGrossRevenue, 5000);
  assert.equal(sim.grossRevenue, 5000);
  assert.equal(sim.totalRetentionRevenue, 0);
  assert.equal(sim.totalRetentionProfit, 0);
  assert.equal(sim.retentionProfitLift, 0);
  assert.equal(sim.dayZeroRoas, sim.blendedRoas);
  assert.equal(sim.recoveredCartOrders, 0);
  assert.equal(sim.recoveredUpsellOrders, 0);
});

test('calculateFunnelForecast: models cart recovery and 24h courtesy upsell with zero ad cost', () => {
  const forecast = {
    monthlyAdSpend: 3000,
    cpc: 1.50, // 2000 clicks
    conversionRate: 5.0, // 100 front-end buyers
    corePrice: 50.00, // Day 0 core rev = $5,000
    cogsPercentage: 20, // 20% COGS
    bumpTakeRate: 0,
    bumpPrice: 0,
    upsellTakeRate: 20, // 20 take upsell ($1,000 rev); 80 decline
    upsellPrice: 50.00,
    downsellTakeRate: 0,
    downsellPrice: 0,
    // Retention settings
    cartRecoveryEnabled: true,
    cartRecoveryRate: 18, // 18% of abandoned carts recovered
    cartRecoveryDiscount: 10, // 10% courtesy discount ($45 effective core)
    upsellRescueEnabled: true,
    upsellRescueRate: 15, // 15% of 80 decliners = 12 buyers
    upsellRescueDiscount: 10 // 10% courtesy discount ($45 effective upsell)
  };

  const sim = calculateFunnelForecast(forecast);

  // Day 0 validation: 100 orders * $50 + 20 upsells * $50 = $6,000
  assert.equal(sim.dayZeroGrossRevenue, 6000);
  // Day 0 profit: $6,000 rev - $3,000 ad spend - $1,200 COGS = $1,800
  assert.equal(sim.dayZeroNetProfit, 1800);
  // Day 0 ROAS: $6,000 / $3,000 = 2.0x
  assert.equal(sim.dayZeroRoas, 2.0);

  // Checkout abandonment modeling:
  // Initiated checkouts = 100 / 0.30 = 333
  // Abandoned checkouts = 333 - 100 = 233
  // Recovered carts = round(233 * 0.18) = 42
  // Recovered cart price = $50 * 0.90 = $45.00
  // Recovered cart rev = 42 * 45 = $1,890
  assert.equal(sim.abandonedCartCount, 233);
  assert.equal(sim.recoveredCartOrders, 42);
  assert.equal(sim.recoveredCartRevenue, 1890);

  // Upsell decline rescue modeling:
  // Decliner pool = 100 - 20 = 80
  // Recovered upsell orders = round(80 * 0.15) = 12
  // Recovered upsell price = $50 * 0.90 = $45.00
  // Recovered upsell rev = 12 * 45 = $540
  assert.equal(sim.declinedUpsellCount, 80);
  assert.equal(sim.recoveredUpsellOrders, 12);
  assert.equal(sim.recoveredUpsellRevenue, 540);

  // Total retention revenue = 1890 + 540 = $2,430
  assert.equal(sim.totalRetentionRevenue, 2430);
  // Zero extra ad spend: only COGS (20%) is deducted from retention revenue!
  // Retention COGS = $2,430 * 0.20 = $486
  // Retention Net Profit = $2,430 - $486 = $1,944
  assert.equal(sim.totalRetentionProfit, 1944);
  assert.equal(sim.retentionProfitLift, 1944);

  // Blended Gross = $6,000 (Day 0) + $2,430 (Retention) = $8,430
  assert.equal(sim.grossRevenue, 8430);
  // Blended Net Profit = $1,800 (Day 0) + $1,944 (Retention) = $3,744 (Over DOUBLE Day-0 net profit!)
  assert.equal(sim.netProfit, 3744);

  // Blended ROAS = $8,430 / $3,000 = 2.81x (vs 2.0x Day-0)
  assert.equal(Number(sim.blendedRoas.toFixed(2)), 2.81);
  assert.equal(Number(sim.effectiveRoasWithRetention.toFixed(2)), 2.81);
});

test('calculateFunnelForecast: discount adjustments properly adjust unit revenue', () => {
  const baseParams = {
    monthlyAdSpend: 1000,
    cpc: 1.00,
    conversionRate: 10.0, // 100 orders, 233 abandoned carts
    corePrice: 100.00,
    cogsPercentage: 0,
    bumpTakeRate: 0,
    bumpPrice: 0,
    upsellTakeRate: 0,
    upsellPrice: 0,
    cartRecoveryEnabled: true,
    cartRecoveryRate: 10 // 23 recovered orders
  };

  // Scenario 1: Reminder only (0% discount) -> $100/unit
  const sim0 = calculateFunnelForecast({ ...baseParams, cartRecoveryDiscount: 0 });
  assert.equal(sim0.recoveredCartRevenue, 23 * 100);

  // Scenario 2: 20% discount -> $80/unit
  const sim20 = calculateFunnelForecast({ ...baseParams, cartRecoveryDiscount: 20 });
  assert.equal(sim20.recoveredCartRevenue, 23 * 80);
});

function injectRetentionFlows(options) {
  const currentNodes = [...options.nodes];
  const currentEdges = [...options.edges];
  const addedNodes = [];
  const addedEdges = [];

  const extracted = extractPricingFromNodes(currentNodes);

  const getFreePosition = (targetX, preferredY) => {
    let y = preferredY;
    const isOccupied = (testY) =>
      currentNodes.some(n => Math.abs(n.position.x - targetX) < 120 && Math.abs(n.position.y - testY) < 100);
    while (isOccupied(y)) {
      y += 120;
    }
    return { x: targetX, y };
  };

  if (options.addCartRecovery && !extracted.hasCartRecovery) {
    const landingPage = currentNodes.find(n => n?.data?.type === 'landing-page');
    const posX = landingPage ? landingPage.position.x : 420;
    const posY = landingPage ? landingPage.position.y + 280 : 440;
    const position = getFreePosition(posX, posY);

    const discount = typeof options.cartRecoveryDiscount === 'number' && options.cartRecoveryDiscount >= 0
      ? options.cartRecoveryDiscount
      : 10;
    const voucherCode = discount > 0 ? `SAVE${discount}` : 'COMPLETE10';

    const cartRecoveryNode = {
      id: `node-cr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      type: 'follow-up-sequence',
      position,
      data: {
        type: 'follow-up-sequence',
        label: 'Cart Abandonment Recovery',
        sequenceTitle: 'Abandoned Checkout Recovery Sequence',
        sequenceType: 'checkout_recovery',
        isRetentionBranch: true,
        delayHours: 1,
        voucherCode,
        smartExitOnPurchase: true,
        contactsEnrolled: 0,
        avgOpenRate: 0,
        avgClickRate: 0,
        steps: [
          {
            id: `cr-step-1`,
            channel: 'email',
            delay: '1 Hour',
            subject: 'Did you leave your selection behind? ✨',
            previewText: 'Your reserved bag is held for 24 hours',
            body: 'Hi [First Name],\n\nWe noticed you started setting up your order but did not complete checkout.\n\nTo help you get started, we have held your reservation with complimentary shipping:\n[Checkout Link]\n\nWarmly,\nClient Care'
          },
          {
            id: `cr-step-2`,
            channel: 'email',
            delay: '20 Hours',
            subject: `Private courtesy: ${discount}% off your order before it expires`,
            previewText: `Use voucher ${voucherCode} at checkout`,
            body: `Hi [First Name],\n\nYour cart reservation is expiring soon. As a courtesy, enjoy ${discount}% off with code ${voucherCode}:\n[Checkout Link]\n\nWith care,\nClient Care Team`
          }
        ]
      }
    };

    currentNodes.push(cartRecoveryNode);
    addedNodes.push(cartRecoveryNode);

    if (landingPage) {
      const cartEdge = {
        id: `e-cr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        source: landingPage.id,
        target: cartRecoveryNode.id,
        sourceHandle: 'abandon',
        targetHandle: 'retention-in',
        data: {
          isRetentionEdge: true,
          sourceHandle: 'abandon',
          targetHandle: 'retention-in',
          sourceThroughput: 0,
          targetCount: 0,
          rate: 0
        }
      };
      currentEdges.push(cartEdge);
      addedEdges.push(cartEdge);
    }
  }

  if (options.addUpsellRescue && !extracted.hasUpsellRescue) {
    const upsellNode = currentNodes.find(n => n?.data?.type === 'upsell');
    const posX = upsellNode ? upsellNode.position.x : 790;
    const posY = upsellNode ? upsellNode.position.y + 280 : 440;
    const position = getFreePosition(posX, posY);

    const discount = typeof options.upsellRescueDiscount === 'number' && options.upsellRescueDiscount >= 0
      ? options.upsellRescueDiscount
      : 10;
    const voucherCode = discount > 0 ? `SAVE${discount}` : 'SAVE10';

    const upsellRescueNode = {
      id: `node-ur-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      type: 'follow-up-sequence',
      position,
      data: {
        type: 'follow-up-sequence',
        label: '24h Courtesy Rescue (Upsell Decline)',
        sequenceTitle: '24h Post-Decline Companion Rescue',
        sequenceType: 'upsell_recovery',
        isRetentionBranch: true,
        delayHours: 18,
        voucherCode,
        smartExitOnPurchase: true,
        contactsEnrolled: 0,
        avgOpenRate: 0,
        avgClickRate: 0,
        steps: [
          {
            id: `ur-step-1`,
            channel: 'email',
            delay: '18 Hours',
            subject: 'A private courtesy reservation for your recent order ✨',
            previewText: 'We held a companion formula reservation for your ritual',
            body: `Hi [First Name],\n\nThank you again for your order! While our team prepares your package, we noticed you passed on the companion upgrade.\n\nBecause this formula is designed to complement your order, we held a courtesy bottle with a private ${discount}% privilege.\n\nUse voucher code ${voucherCode} at checkout:\n[Offer Link]\n\nThis courtesy reservation remains active for 24 hours.\n\nWarm regards,\nThe Concierge Team`
          }
        ]
      }
    };

    currentNodes.push(upsellRescueNode);
    addedNodes.push(upsellRescueNode);

    if (upsellNode) {
      const rescueInEdge = {
        id: `e-ur-in-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        source: upsellNode.id,
        target: upsellRescueNode.id,
        sourceHandle: 'rescue',
        targetHandle: 'retention-in',
        data: {
          isRetentionEdge: true,
          sourceHandle: 'rescue',
          targetHandle: 'retention-in',
          sourceThroughput: 0,
          targetCount: 0,
          rate: 0
        }
      };
      currentEdges.push(rescueInEdge);
      addedEdges.push(rescueInEdge);

      const tyNode = currentNodes.find(n => n?.data?.type === 'thank-you');
      if (tyNode) {
        const rescueOutEdge = {
          id: `e-ur-out-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          source: upsellRescueNode.id,
          target: tyNode.id,
          data: {
            isRetentionEdge: true,
            sourceThroughput: 0,
            targetCount: 0,
            rate: 0
          }
        };
        currentEdges.push(rescueOutEdge);
        addedEdges.push(rescueOutEdge);
      }
    }
  }

  return {
    nodes: currentNodes,
    edges: currentEdges,
    addedNodes,
    addedEdges
  };
}

test('injectRetentionFlows: injects cart recovery and upsell rescue with custom discounts and golden edges', () => {
  const initialNodes = [
    {
      id: 'page-1',
      type: 'landing-page',
      position: { x: 300, y: 150 },
      data: { type: 'landing-page', label: 'Main Offer', shopifyProductPrice: '$48.00' }
    },
    {
      id: 'upsell-1',
      type: 'upsell',
      position: { x: 650, y: 150 },
      data: { type: 'upsell', label: 'Companion Upgrade', productPrice: '$28.00' }
    },
    {
      id: 'ty-1',
      type: 'thank-you',
      position: { x: 1000, y: 150 },
      data: { type: 'thank-you', label: 'Order Receipt' }
    }
  ];

  const initialEdges = [
    { id: 'e1', source: 'page-1', target: 'upsell-1' },
    { id: 'e2', source: 'upsell-1', target: 'ty-1' }
  ];

  const result = injectRetentionFlows({
    nodes: initialNodes,
    edges: initialEdges,
    addCartRecovery: true,
    addUpsellRescue: true,
    cartRecoveryDiscount: 15,
    upsellRescueDiscount: 20
  });

  // 1. Two new nodes added
  assert.equal(result.addedNodes.length, 2);
  assert.equal(result.nodes.length, 5);

  const cartNode = result.addedNodes.find(n => n.data.sequenceType === 'checkout_recovery');
  assert.ok(cartNode);
  assert.equal(cartNode.position.x, 300);
  assert.equal(cartNode.position.y, 430); // 150 + 280
  assert.equal(cartNode.data.voucherCode, 'SAVE15');
  assert.equal(cartNode.data.isRetentionBranch, true);
  assert.ok(cartNode.data.steps[1].subject.includes('15%'));

  const upsellNode = result.addedNodes.find(n => n.data.sequenceType === 'upsell_recovery');
  assert.ok(upsellNode);
  assert.equal(upsellNode.position.x, 650);
  assert.equal(upsellNode.position.y, 430); // 150 + 280
  assert.equal(upsellNode.data.voucherCode, 'SAVE20');
  assert.equal(upsellNode.data.isRetentionBranch, true);
  assert.ok(upsellNode.data.steps[0].body.includes('20%'));

  // 2. Edges auto-wired with golden rescue styling
  assert.equal(result.addedEdges.length, 3); // cart Edge, upsell in Edge, upsell out Edge
  assert.equal(result.edges.length, 5);

  const cartEdge = result.addedEdges.find(e => e.target === cartNode.id);
  assert.ok(cartEdge);
  assert.equal(cartEdge.source, 'page-1');
  assert.equal(cartEdge.sourceHandle, 'abandon');
  assert.equal(cartEdge.targetHandle, 'retention-in');
  assert.equal(cartEdge.data.isRetentionEdge, true);

  const upsellInEdge = result.addedEdges.find(e => e.target === upsellNode.id);
  assert.ok(upsellInEdge);
  assert.equal(upsellInEdge.source, 'upsell-1');
  assert.equal(upsellInEdge.sourceHandle, 'rescue');
  assert.equal(upsellInEdge.targetHandle, 'retention-in');
  assert.equal(upsellInEdge.data.isRetentionEdge, true);

  const upsellOutEdge = result.addedEdges.find(e => e.source === upsellNode.id);
  assert.ok(upsellOutEdge);
  assert.equal(upsellOutEdge.target, 'ty-1');
  assert.equal(upsellOutEdge.data.isRetentionEdge, true);
});

test('injectRetentionFlows: skips injection if retention nodes already active on canvas (idempotency)', () => {
  const existingRetentionNodes = [
    {
      id: 'page-1',
      type: 'landing-page',
      position: { x: 300, y: 150 },
      data: { type: 'landing-page', label: 'Main Offer' }
    },
    {
      id: 'cr-existing',
      type: 'follow-up-sequence',
      position: { x: 300, y: 430 },
      data: { type: 'follow-up-sequence', sequenceType: 'checkout_recovery', label: 'Existing Cart Recovery' }
    },
    {
      id: 'ur-existing',
      type: 'follow-up-sequence',
      position: { x: 650, y: 430 },
      data: { type: 'follow-up-sequence', sequenceType: 'upsell_recovery', label: 'Existing Upsell Rescue' }
    }
  ];

  const result = injectRetentionFlows({
    nodes: existingRetentionNodes,
    edges: [],
    addCartRecovery: true,
    addUpsellRescue: true
  });

  assert.equal(result.addedNodes.length, 0);
  assert.equal(result.addedEdges.length, 0);
  assert.equal(result.nodes.length, 3);
});

test('injectRetentionFlows: avoids collision when target coordinates are occupied', () => {
  const collisionNodes = [
    {
      id: 'page-1',
      type: 'landing-page',
      position: { x: 300, y: 150 },
      data: { type: 'landing-page', label: 'Main Offer' }
    },
    {
      id: 'obstacle-node',
      type: 'lead-form',
      position: { x: 300, y: 430 }, // exact preferred position
      data: { type: 'lead-form', label: 'Existing Form' }
    }
  ];

  const result = injectRetentionFlows({
    nodes: collisionNodes,
    edges: [],
    addCartRecovery: true
  });

  assert.equal(result.addedNodes.length, 1);
  const cartNode = result.addedNodes[0];
  assert.equal(cartNode.position.x, 300);
  assert.equal(cartNode.position.y, 550); // shifted down past 430
});
