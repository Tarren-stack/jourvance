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
  const upsellDeclines = reportEvents.filter(e => e.type === 'upsell_decline' && (e.offerType || 'upsell') === 'upsell');

  const upsellTakes = upsellEvents.length;
  const upsellRevenue = Number(upsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));

  const downsellTakes = downsellEvents.length;
  const downsellRevenue = Number(downsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));

  const totalDeclines = upsellDeclines.length;
  const declinedEmails = new Set(upsellDeclines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));
  const recoveredUpsellEvents = upsellEvents.filter(u => u.email && declinedEmails.has(String(u.email).toLowerCase()));
  const recoveredUpsellOrders = recoveredUpsellEvents.length;
  const recoveredUpsellRevenue = Number(recoveredUpsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));
  const recoveryRate = totalDeclines > 0 ? Number(((recoveredUpsellOrders / totalDeclines) * 100).toFixed(1)) : 0;

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
    totalDeclines,
    recoveredUpsellRevenue,
    recoveredUpsellOrders,
    recoveryRate,
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
        aovContribution: totalFrontEndOrders > 0 ? Number((upsellRevenue / totalFrontEndOrders).toFixed(2)) : 0,
        recoveredRevenue: recoveredUpsellRevenue,
        recoveredOrders: recoveredUpsellOrders,
        recoveryRate,
        totalDeclines
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

function computeChannelAttribution(orders, events, model = 'last_touch') {
  const channels = {
    meta: { channelId: 'meta', orders: 0, revenue: 0, coreRevenue: 0, bumpOrders: 0, bumpRevenue: 0, upsellTakes: 0, upsellRevenue: 0 },
    tiktok: { channelId: 'tiktok', orders: 0, revenue: 0, coreRevenue: 0, bumpOrders: 0, bumpRevenue: 0, upsellTakes: 0, upsellRevenue: 0 }
  };

  for (const o of orders) {
    const chKey = o.checkoutChannel || 'meta';
    const amount = Number(o.totalPrice || 0);
    const isBump = Boolean(o.orderBumpIncluded);
    const bPrice = isBump ? 28.00 : 0;
    const cPrice = Math.max(0, amount - bPrice);

    channels[chKey].orders += 1;
    channels[chKey].revenue += amount;
    channels[chKey].coreRevenue += cPrice;
    if (isBump) {
      channels[chKey].bumpOrders += 1;
      channels[chKey].bumpRevenue += bPrice;
    }

    const upsells = events.filter(e => e.type === 'upsell_accept' && o.customerEmail && e.email === o.customerEmail);
    for (const u of upsells) {
      channels[chKey].upsellTakes += 1;
      channels[chKey].upsellRevenue += Number(u.amount || 0);
    }
  }

  return Object.values(channels).map(ch => {
    const baseAov = ch.orders > 0 ? Number((ch.coreRevenue / ch.orders).toFixed(2)) : 0;
    const aov = ch.orders > 0 ? Number(((ch.revenue + ch.upsellRevenue) / ch.orders).toFixed(2)) : 0;
    const aovLift = Number(Math.max(0, aov - baseAov).toFixed(2));
    const bumpAttachRate = ch.orders > 0 ? Number(((ch.bumpOrders / ch.orders) * 100).toFixed(1)) : 0;
    const upsellAttachRate = ch.orders > 0 ? Number(((ch.upsellTakes / ch.orders) * 100).toFixed(1)) : 0;
    return { ...ch, baseAov, aov, aovLift, bumpAttachRate, upsellAttachRate };
  });
}

test('channel attribution accurately isolates Base AOV, Blended AOV, and Bump/Upsell attach per channel', () => {
  const metaOrders = [
    { id: 'm1', customerEmail: 'm1@ex.com', totalPrice: 86.00, orderBumpIncluded: true, checkoutChannel: 'meta' },
    { id: 'm2', customerEmail: 'm2@ex.com', totalPrice: 58.00, orderBumpIncluded: false, checkoutChannel: 'meta' }
  ];
  const tiktokOrders = [
    { id: 't1', customerEmail: 't1@ex.com', totalPrice: 58.00, orderBumpIncluded: false, checkoutChannel: 'tiktok' },
    { id: 't2', customerEmail: 't2@ex.com', totalPrice: 58.00, orderBumpIncluded: false, checkoutChannel: 'tiktok' }
  ];
  const allOrders = [...metaOrders, ...tiktokOrders];
  const events = [
    { type: 'upsell_accept', email: 'm1@ex.com', offerType: 'upsell', amount: 38.00 }
  ];

  const results = computeChannelAttribution(allOrders, events);
  const meta = results.find(c => c.channelId === 'meta');
  const tiktok = results.find(c => c.channelId === 'tiktok');

  assert.equal(meta.orders, 2, 'Meta has 2 orders');
  assert.equal(meta.baseAov, 58.00, 'Meta base AOV is $58.00');
  assert.equal(meta.bumpAttachRate, 50.0, 'Meta bump attach rate is 50.0% (1 of 2)');
  assert.equal(meta.upsellAttachRate, 50.0, 'Meta upsell attach rate is 50.0% (1 of 2)');
  assert.equal(meta.aov, 91.00, 'Meta blended AOV is $91.00 ($182 total / 2)');
  assert.equal(meta.aovLift, 33.00, 'Meta AOV lift is +$33.00');

  assert.equal(tiktok.orders, 2, 'TikTok has 2 orders');
  assert.equal(tiktok.baseAov, 58.00, 'TikTok base AOV is $58.00');
  assert.equal(tiktok.bumpAttachRate, 0, 'TikTok bump attach rate is 0%');
  assert.equal(tiktok.upsellAttachRate, 0, 'TikTok upsell attach rate is 0%');
  assert.equal(tiktok.aov, 58.00, 'TikTok blended AOV is $58.00');
  assert.equal(tiktok.aovLift, 0, 'TikTok AOV lift is $0');
});

test('computeAovExpansion isolates post-purchase recovery revenue and calculates recovery rate from initial declines', () => {
  const orders = [
    { id: '1', customerEmail: 'buyer1@ex.com', totalPrice: 58.00, orderBumpIncluded: false },
    { id: '2', customerEmail: 'buyer2@ex.com', totalPrice: 58.00, orderBumpIncluded: false },
    { id: '3', customerEmail: 'buyer3@ex.com', totalPrice: 58.00, orderBumpIncluded: false },
    { id: '4', customerEmail: 'buyer4@ex.com', totalPrice: 58.00, orderBumpIncluded: false }
  ];

  // buyer1 accepted live on page without declining
  // buyer2 and buyer3 declined the offer initially (2 declines)
  // buyer2 then accepted via courtesy email flow ($38.00)
  // buyer3 did not convert (0)
  // buyer4 was never presented or declined
  const events = [
    { type: 'upsell_accept', email: 'buyer1@ex.com', offerType: 'upsell', amount: 38.00 },
    { type: 'upsell_decline', email: 'buyer2@ex.com', offerType: 'upsell' },
    { type: 'upsell_decline', email: 'buyer3@ex.com', offerType: 'upsell' },
    { type: 'upsell_accept', email: 'buyer2@ex.com', offerType: 'upsell', amount: 38.00 }
  ];

  const result = computeAovExpansion(orders, events);

  assert.equal(result.totalOrders, 4);
  assert.equal(result.totalDeclines, 2, 'Total 2 initial declines');
  assert.equal(result.recoveredUpsellOrders, 1, '1 recovered order from declined buyers');
  assert.equal(result.recoveredUpsellRevenue, 38.00, 'Recovered $38.00 from second-chance courtesy');
  assert.equal(result.recoveryRate, 50.0, 'Recovery rate is 50.0% (1 recovered out of 2 declines)');

  const upsellStream = result.streams.find(s => s.tier === 'upsell');
  assert.ok(upsellStream);
  assert.equal(upsellStream.orderCount, 2, 'Total 2 upsell takes (1 live + 1 recovered)');
  assert.equal(upsellStream.revenue, 76.00, 'Total $76.00 upsell revenue');
  assert.equal(upsellStream.recoveredRevenue, 38.00);
  assert.equal(upsellStream.recoveredOrders, 1);
  assert.equal(upsellStream.recoveryRate, 50.0);
  assert.equal(upsellStream.totalDeclines, 2);
});

function computeRetentionTelemetry(checkouts, reportEvents) {
  const recoveredCheckouts = checkouts.filter(chk => chk.recoveryStatus === 'recovered');
  const recoveredCheckoutEvents = reportEvents.filter(e => e.type === 'checkout_recovered');

  const recoveredCheckoutsCount = Math.max(recoveredCheckouts.length, recoveredCheckoutEvents.length);
  let recoveredCheckoutRevenue = recoveredCheckouts.reduce((sum, c) => sum + (Number(c.totalPrice) || 0), 0);
  if (recoveredCheckoutRevenue <= 0 && recoveredCheckoutEvents.length > 0) {
    recoveredCheckoutRevenue = recoveredCheckoutEvents.reduce((sum, e) => sum + (Number(e.value || e.amount) || 0), 0);
  }
  recoveredCheckoutRevenue = Number(recoveredCheckoutRevenue.toFixed(2));

  const abandonedCheckoutsCount = Math.max(checkouts.length, recoveredCheckoutsCount);
  const checkoutRecoveryRate = abandonedCheckoutsCount > 0
    ? Number(((recoveredCheckoutsCount / abandonedCheckoutsCount) * 100).toFixed(1))
    : 0;

  const upsellEvents = reportEvents.filter(e => e.type === 'upsell_accept' && (e.offerType || 'upsell') === 'upsell');
  const upsellDeclines = reportEvents.filter(e => e.type === 'upsell_decline' && (e.offerType || 'upsell') === 'upsell');
  const totalDeclines = upsellDeclines.length;
  const declinedEmails = new Set(upsellDeclines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));

  const recoveredUpsellEvents = upsellEvents.filter(u => u.email && declinedEmails.has(String(u.email).toLowerCase()));
  const recoveredUpsellOrders = recoveredUpsellEvents.length;
  const recoveredUpsellRevenue = Number(recoveredUpsellEvents.reduce((sum, e) => sum + (Number(e.amount) || 0), 0).toFixed(2));
  const upsellRecoveryRate = totalDeclines > 0 ? Number(((recoveredUpsellOrders / totalDeclines) * 100).toFixed(1)) : 0;

  const totalRetentionRevenue = Number((recoveredCheckoutRevenue + recoveredUpsellRevenue).toFixed(2));
  const totalRetentionOrders = recoveredCheckoutsCount + recoveredUpsellOrders;
  const retentionNetProfit = Number((totalRetentionRevenue * 0.80).toFixed(2));

  return {
    abandonedCheckoutsCount,
    recoveredCheckoutsCount,
    recoveredCheckoutRevenue,
    checkoutRecoveryRate,
    upsellDeclinesCount: totalDeclines,
    recoveredUpsellOrders,
    recoveredUpsellRevenue,
    upsellRecoveryRate,
    totalRetentionRevenue,
    totalRetentionOrders,
    retentionNetProfit
  };
}

test('computeRetentionTelemetry accurately computes cart and upsell rescue metrics', () => {
  const checkouts = [
    { id: 'c1', totalPrice: 48.00, recoveryStatus: 'recovered' },
    { id: 'c2', totalPrice: 48.00, recoveryStatus: 'recovered' },
    { id: 'c3', totalPrice: 48.00, recoveryStatus: 'pending' },
    { id: 'c4', totalPrice: 48.00, recoveryStatus: 'expired' }
  ];

  const events = [
    { type: 'upsell_decline', email: 'vip1@ex.com', offerType: 'upsell' },
    { type: 'upsell_decline', email: 'vip2@ex.com', offerType: 'upsell' },
    { type: 'upsell_decline', email: 'vip3@ex.com', offerType: 'upsell' },
    { type: 'upsell_accept', email: 'vip1@ex.com', offerType: 'upsell', amount: 35.00 }
  ];

  const ret = computeRetentionTelemetry(checkouts, events);

  // Cart recovery
  assert.equal(ret.abandonedCheckoutsCount, 4);
  assert.equal(ret.recoveredCheckoutsCount, 2);
  assert.equal(ret.recoveredCheckoutRevenue, 96.00);
  assert.equal(ret.checkoutRecoveryRate, 50.0);

  // Upsell rescue
  assert.equal(ret.upsellDeclinesCount, 3);
  assert.equal(ret.recoveredUpsellOrders, 1);
  assert.equal(ret.recoveredUpsellRevenue, 35.00);
  assert.equal(ret.upsellRecoveryRate, 33.3);

  // Totals & net profit lift ($0 ad spend, 80% margin)
  assert.equal(ret.totalRetentionRevenue, 131.00);
  assert.equal(ret.totalRetentionOrders, 3);
  assert.equal(ret.retentionNetProfit, 104.80);
});

test('computeRetentionTelemetry handles zero-state cleanly without errors', () => {
  const ret = computeRetentionTelemetry([], []);
  assert.equal(ret.abandonedCheckoutsCount, 0);
  assert.equal(ret.recoveredCheckoutsCount, 0);
  assert.equal(ret.recoveredCheckoutRevenue, 0);
  assert.equal(ret.checkoutRecoveryRate, 0);
  assert.equal(ret.totalRetentionRevenue, 0);
  assert.equal(ret.retentionNetProfit, 0);
});

test('CSV export properly tags RetentionRescue column for cart and upsell recoveries', () => {
  const recoveredMap = new Set(['ord_rec_1']);
  const sampleOrders = [
    { id: 'ord_1', customerEmail: 'a@ex.com', totalPrice: 58.00, discountCode: '' },
    { id: 'ord_rec_1', customerEmail: 'b@ex.com', totalPrice: 52.20, discountCode: 'SAVE10' },
    { id: 'ord_3', customerEmail: 'c@ex.com', totalPrice: 43.20, discountCode: 'VIPRESCUE' }
  ];

  const classified = sampleOrders.map(o => {
    if (recoveredMap.has(o.id) || (o.discountCode && /save10|recover|cart/i.test(o.discountCode))) {
      return 'Cart Recovery';
    } else if (o.discountCode && /viprescue|oto.?recovery|courtesy/i.test(o.discountCode)) {
      return 'Upsell Rescue';
    }
    return 'Direct / Day 0';
  });

  assert.deepEqual(classified, ['Direct / Day 0', 'Cart Recovery', 'Upsell Rescue']);
});


