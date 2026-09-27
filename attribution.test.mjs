import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure calculation logic matching server.mjs /api/reports/attribution
 */
function computeAovExpansion(filteredOrders, reportEvents, publicPageCache = {}) {
  const totalFrontEndOrders = filteredOrders.length;
  let bumpRevenue = 0;
  let bumpOrdersCount = 0;
  let coreRevenue = 0;

  for (const o of filteredOrders) {
    const orderTotal = Number(o.totalPrice || 0);
    if (o.orderBumpIncluded) {
      bumpOrdersCount++;
      let bPrice = 0;
      if (Array.isArray(o.lineItems) && o.lineItems.length > 1) {
        const bumpItem = o.lineItems.find(it => /bump/i.test(it.title || '')) || o.lineItems[1];
        if (bumpItem && Number(bumpItem.price) > 0) {
          bPrice = Number(bumpItem.price) * Number(bumpItem.quantity || 1);
        }
      }
      if (bPrice <= 0 && o.attributedSlug && publicPageCache[o.attributedSlug]?.data?.orderBumpPrice) {
        const parsed = parseFloat(String(publicPageCache[o.attributedSlug].data.orderBumpPrice).replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) bPrice = parsed;
      }
      if (bPrice <= 0) {
        bPrice = Math.min(orderTotal * 0.35, 28.00);
      }
      bPrice = Math.min(orderTotal, bPrice);
      bumpRevenue += bPrice;
      coreRevenue += Math.max(0, orderTotal - bPrice);
    } else {
      coreRevenue += orderTotal;
    }
  }

  const upsellEvents = reportEvents.filter(e => e.type === 'upsell_accept' && (e.offerType || 'upsell') === 'upsell');
  const downsellEvents = reportEvents.filter(e => e.type === 'upsell_accept' && e.offerType === 'downsell');

  const upsellTakes = upsellEvents.length;
  const upsellRevenue = Number(upsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));

  const downsellTakes = downsellEvents.length;
  const downsellRevenue = Number(downsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));

  bumpRevenue = Number(bumpRevenue.toFixed(2));
  coreRevenue = Number(coreRevenue.toFixed(2));

  const combinedRevenue = Number((coreRevenue + bumpRevenue + upsellRevenue + downsellRevenue).toFixed(2));
  const baseAov = totalFrontEndOrders > 0 ? Number((coreRevenue / totalFrontEndOrders).toFixed(2)) : 0;
  const effectiveAov = totalFrontEndOrders > 0 ? Number((combinedRevenue / totalFrontEndOrders).toFixed(2)) : 0;
  const aovLiftDollars = Number((effectiveAov - baseAov).toFixed(2));
  const aovLiftPercent = baseAov > 0 ? Number(((aovLiftDollars / baseAov) * 100).toFixed(1)) : 0;

  return {
    totalOrders: totalFrontEndOrders,
    combinedRevenue,
    baseAov,
    effectiveAov,
    aovLiftDollars,
    aovLiftPercent,
    streams: [
      {
        tier: 'core',
        name: 'Core Front-End Product',
        orderCount: totalFrontEndOrders,
        revenue: coreRevenue,
        percentageOfTotal: combinedRevenue > 0 ? Number(((coreRevenue / combinedRevenue) * 100).toFixed(1)) : 100,
        attachRate: totalFrontEndOrders > 0 ? 100 : 0,
        aovContribution: baseAov
      },
      {
        tier: 'bump',
        name: 'Checkout Order Bump Add-on',
        orderCount: bumpOrdersCount,
        revenue: bumpRevenue,
        percentageOfTotal: combinedRevenue > 0 ? Number(((bumpRevenue / combinedRevenue) * 100).toFixed(1)) : 0,
        attachRate: totalFrontEndOrders > 0 ? Number(((bumpOrdersCount / totalFrontEndOrders) * 100).toFixed(1)) : 0,
        aovContribution: totalFrontEndOrders > 0 ? Number((bumpRevenue / totalFrontEndOrders).toFixed(2)) : 0
      },
      {
        tier: 'upsell',
        name: '1-Click Post-Purchase Upsell (OTO)',
        orderCount: upsellTakes,
        revenue: upsellRevenue,
        percentageOfTotal: combinedRevenue > 0 ? Number(((upsellRevenue / combinedRevenue) * 100).toFixed(1)) : 0,
        attachRate: totalFrontEndOrders > 0 ? Number(((upsellTakes / totalFrontEndOrders) * 100).toFixed(1)) : 0,
        aovContribution: totalFrontEndOrders > 0 ? Number((upsellRevenue / totalFrontEndOrders).toFixed(2)) : 0
      },
      {
        tier: 'downsell',
        name: 'Post-Purchase Downsell (OTO)',
        orderCount: downsellTakes,
        revenue: downsellRevenue,
        percentageOfTotal: combinedRevenue > 0 ? Number(((downsellRevenue / combinedRevenue) * 100).toFixed(1)) : 0,
        attachRate: totalFrontEndOrders > 0 ? Number(((downsellTakes / totalFrontEndOrders) * 100).toFixed(1)) : 0,
        aovContribution: totalFrontEndOrders > 0 ? Number((downsellRevenue / totalFrontEndOrders).toFixed(2)) : 0
      }
    ]
  };
}

test('computeAovExpansion accurately separates core and bump revenue from orders', () => {
  const orders = [
    { id: '1', totalPrice: 58.00, orderBumpIncluded: false },
    { id: '2', totalPrice: 86.00, orderBumpIncluded: true, lineItems: [
      { title: 'Rosehip Serum', price: 58.00, quantity: 1 },
      { title: 'Order Bump - Eye Cream', price: 28.00, quantity: 1 }
    ]},
    { id: '3', totalPrice: 58.00, orderBumpIncluded: false },
    { id: '4', totalPrice: 86.00, orderBumpIncluded: true, lineItems: [
      { title: 'Rosehip Serum', price: 58.00, quantity: 1 },
      { title: 'Order Bump - Eye Cream', price: 28.00, quantity: 1 }
    ]}
  ];

  const events = [];
  const result = computeAovExpansion(orders, events);

  assert.equal(result.totalOrders, 4, 'Total front-end orders is 4');
  assert.equal(result.baseAov, 58.00, 'Base AOV is $58.00');
  assert.equal(result.effectiveAov, 72.00, 'Effective AOV with bumps is $72.00');
  assert.equal(result.aovLiftDollars, 14.00, 'AOV lift is +$14.00');
  assert.equal(result.aovLiftPercent, 24.1, 'AOV lift percentage is +24.1%');

  const bumpStream = result.streams.find(s => s.tier === 'bump');
  assert.equal(bumpStream.orderCount, 2, '2 orders included a bump');
  assert.equal(bumpStream.revenue, 56.00, 'Bump revenue is $56.00');
  assert.equal(bumpStream.attachRate, 50.0, 'Bump attach rate is 50.0%');
  assert.equal(bumpStream.aovContribution, 14.00, 'Bump AOV contribution is $14.00');
});

test('computeAovExpansion integrates 1-click upsells and downsells into blended AOV', () => {
  const orders = [
    { id: '1', totalPrice: 50.00, orderBumpIncluded: false },
    { id: '2', totalPrice: 50.00, orderBumpIncluded: false }
  ];

  const events = [
    { type: 'upsell_accept', offerType: 'upsell', amount: 40.00 },
    { type: 'upsell_accept', offerType: 'downsell', amount: 20.00 }
  ];

  const result = computeAovExpansion(orders, events);

  assert.equal(result.totalOrders, 2, '2 front-end buyers');
  assert.equal(result.baseAov, 50.00, 'Base AOV is $50.00');
  assert.equal(result.combinedRevenue, 160.00, '$100 core + $40 upsell + $20 downsell = $160');
  assert.equal(result.effectiveAov, 80.00, 'Blended effective AOV is $80.00 ($160 / 2)');
  assert.equal(result.aovLiftDollars, 30.00, 'AOV lift is +$30.00 per customer');
  assert.equal(result.aovLiftPercent, 60.0, '+60.0% expansion lift');

  const upsellStream = result.streams.find(s => s.tier === 'upsell');
  assert.equal(upsellStream.revenue, 40.00, 'Upsell revenue is $40.00');
  assert.equal(upsellStream.aovContribution, 20.00, 'Upsell AOV contribution is $20.00');

  const downsellStream = result.streams.find(s => s.tier === 'downsell');
  assert.equal(downsellStream.revenue, 20.00, 'Downsell revenue is $20.00');
  assert.equal(downsellStream.aovContribution, 10.00, 'Downsell AOV contribution is $10.00');
});

test('computeAovExpansion handles zero orders gracefully without division by zero', () => {
  const result = computeAovExpansion([], []);

  assert.equal(result.totalOrders, 0, 'Zero orders handled');
  assert.equal(result.baseAov, 0, 'Base AOV is 0');
  assert.equal(result.effectiveAov, 0, 'Effective AOV is 0');
  assert.equal(result.aovLiftDollars, 0, 'AOV lift is 0');
  assert.equal(result.aovLiftPercent, 0, 'AOV lift percent is 0');
  assert.equal(result.streams.length, 4, 'Contains all 4 tiers');
});
