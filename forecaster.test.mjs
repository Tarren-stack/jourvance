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
  let coreTitle;
  let bumpTitle;
  let upsellTitle;
  let downsellTitle;

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
    coreTitle,
    bumpTitle,
    upsellTitle,
    downsellTitle
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
    downsellPrice = 0
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
  const grossRevenue = coreRevenue + bumpRevenue + upsellRevenue + downsellRevenue;

  const baseAov = corePrice;
  const effectiveAov = frontEndOrders > 0 ? grossRevenue / frontEndOrders : baseAov;
  const aovLift = Math.max(0, effectiveAov - baseAov);

  const cogsFraction = Math.max(0, Math.min(1, cogsPercentage / 100));
  const estimatedCogs = grossRevenue * cogsFraction;
  const netProfit = grossRevenue - monthlyAdSpend - estimatedCogs;
  const blendedRoas = monthlyAdSpend > 0 ? grossRevenue / monthlyAdSpend : 0;

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
    isProfitable
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
