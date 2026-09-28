/**
 * Jourvance Analytics & Reporting Controller
 * Handles Multi-Channel Attribution Analytics, CSV Exports, Funnel Telemetry Stats,
 * Email Analytics & Windows, and Operator Summaries.
 */

import {
  orderBelongsTo,
  attributionTouches,
  channelOf,
  enrollmentCount
} from '../../email-map.mjs';
import { cleanAttributionWindows } from '../../email-feeds.mjs';

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function setupAnalyticsRoutes(app, ctx) {
  const {
    requireUser,
    requireOperator,
    loadEvents,
    loadOrders,
    loadContacts,
    loadDrips,
    loadCheckouts = () => [],
    publicPageCache,
    journeyCache,
    contactsForUser,
    userProgramBag,
    writeUserPrograms,
    messageStatsFor,
    hubReady
  } = ctx;

  // ── Multi-Channel Attribution Analytics ───────────────────────────────────────

  app.get('/api/reports/attribution', requireUser, async (req, res) => {
    const model = req.query.model || 'last_touch'; // 'first_touch' | 'last_touch' | 'linear'
    const timeframe = req.query.timeframe || '30d'; // '7d' | '30d' | 'all'
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : '';

    const uid = req.user.uid;
    const now = Date.now();
    const daysLimit = timeframe === '7d' ? 7 : (timeframe === '30d' ? 30 : 9999);
    const cutoff = now - (daysLimit * 86400000);
    const inWindow = (iso) => new Date(iso || 0).getTime() >= cutoff;
    const eventOwner = (e) => e.userId || (e.slug && publicPageCache[e.slug]?.userId) || '';
    const reportEvents = loadEvents().filter(e => {
      if (eventOwner(e) !== uid || !inWindow(e.at)) return false;
      if (workspaceId) {
        if (e.workspaceId && e.workspaceId !== workspaceId) return false;
        const slugWs = e.slug ? publicPageCache[e.slug]?.workspaceId : '';
        if (slugWs && slugWs !== workspaceId) return false;
      }
      return true;
    });
    const filteredOrders = loadOrders().filter(o => {
      if (!inWindow(o.createdAt)) return false;
      const slugOwner = o.attributedSlug ? publicPageCache[o.attributedSlug]?.userId : '';
      if (!orderBelongsTo(o, uid, slugOwner)) return false;
      if (workspaceId) {
        if (o.workspaceId && o.workspaceId !== workspaceId) return false;
        const orderWsId = o.attributedSlug ? publicPageCache[o.attributedSlug]?.workspaceId : '';
        if (orderWsId && orderWsId !== workspaceId) return false;
      }
      return true;
    });
    const channels = {
      meta: {
        channelId: 'meta',
        channelName: 'Meta Ads (Facebook & IG)',
        iconName: 'meta',
        spend: 0,
        clicks: 0,
        leads: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
        cac: 0,
        conversionRate: 0,
        bumpOrders: 0,
        bumpRevenue: 0,
        upsellTakes: 0,
        upsellRevenue: 0,
        coreRevenue: 0
      },
      google: {
        channelId: 'google',
        channelName: 'Google Ads & Search',
        iconName: 'google',
        spend: 0,
        clicks: 0,
        leads: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
        cac: 0,
        conversionRate: 0,
        bumpOrders: 0,
        bumpRevenue: 0,
        upsellTakes: 0,
        upsellRevenue: 0,
        coreRevenue: 0
      },
      tiktok: {
        channelId: 'tiktok',
        channelName: 'TikTok Ads',
        iconName: 'tiktok',
        spend: 0,
        clicks: 0,
        leads: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
        cac: 0,
        conversionRate: 0,
        bumpOrders: 0,
        bumpRevenue: 0,
        upsellTakes: 0,
        upsellRevenue: 0,
        coreRevenue: 0
      },
      email: {
        channelId: 'email',
        channelName: 'Email Nurture & Drips',
        iconName: 'email',
        spend: 0,
        clicks: 0,
        leads: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
        cac: 0,
        conversionRate: 0,
        bumpOrders: 0,
        bumpRevenue: 0,
        upsellTakes: 0,
        upsellRevenue: 0,
        coreRevenue: 0
      },
      direct: {
        channelId: 'direct',
        channelName: 'Direct & Organic',
        iconName: 'direct',
        spend: 0,
        clicks: 0,
        leads: 0,
        orders: 0,
        revenue: 0,
        roas: 0,
        cac: 0,
        conversionRate: 0,
        bumpOrders: 0,
        bumpRevenue: 0,
        upsellTakes: 0,
        upsellRevenue: 0,
        coreRevenue: 0
      }
    };

    for (const journey of Object.values(journeyCache)) {
      if (journey.userId !== uid) continue;
      if (workspaceId && journey.workspaceId && journey.workspaceId !== workspaceId) continue;
      for (const node of journey.nodes || []) {
        if (node.type !== 'ad-source') continue;
        const platform = node.data?.platform;
        const key = platform === 'meta' || platform === 'google' || platform === 'tiktok' ? platform : 'direct';
        channels[key].spend += Number(node.data?.spend || 0);
      }
    }

    const leadEmails = new Set();
    for (const e of reportEvents) {
      const key = channelOf(e);
      if (e.type === 'page_view' || e.type === 'email_clicked') channels[key].clicks++;
      if (e.type === 'lead') {
        channels[key].leads++;
        if (e.email) leadEmails.add(String(e.email).toLowerCase());
      }
    }
    for (const c of loadContacts()) {
      const owner = c.userId || (c.sourceSlug && publicPageCache[c.sourceSlug]?.userId) || '';
      if (owner !== uid || !inWindow(c.firstSeenAt || c.subscribedAt)) continue;
      const email = String(c.email || '').toLowerCase();
      if (email && leadEmails.has(email)) continue;
      channels[channelOf(c)].leads++;
    }

    const recentAttributions = [];

    for (const o of filteredOrders) {
      const amount = Number(o.totalPrice || 0);
      const touches = attributionTouches(reportEvents, o);
      if (o.utm_source || o.fbclid || o.gclid || o.ttclid) touches.push(o);
      touches.sort((a, b) => Date.parse(a.at || a.createdAt || 0) - Date.parse(b.at || b.createdAt || 0));
      const labeled = touches.map(channelOf);
      const firstIdx = labeled.findIndex(c => c !== 'direct');
      let lastIdx = -1;
      labeled.forEach((c, i) => { if (c !== 'direct') lastIdx = i; });
      const firstTouch = firstIdx >= 0 ? labeled[firstIdx] : (o.checkoutChannel || 'direct');
      const lastTouch = lastIdx >= 0 ? labeled[lastIdx] : firstTouch;
      const distinct = new Set(labeled.filter(c => c !== 'direct'));

      const isBump = Boolean(o.orderBumpIncluded);
      let bPrice = 0;
      if (isBump) {
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
          bPrice = Math.min(amount * 0.35, 28.00);
        }
        bPrice = Math.min(amount, bPrice);
      }
      const cPrice = Math.max(0, amount - bPrice);

      const targetList = (model === 'first_touch')
        ? [firstTouch]
        : (model === 'last_touch' || firstTouch === lastTouch)
          ? [lastTouch]
          : [firstTouch, lastTouch];
      const weight = targetList.length === 1 ? 1 : 0.5;

      for (const ch of targetList) {
        channels[ch].orders += weight;
        channels[ch].revenue += amount * weight;
        channels[ch].coreRevenue += cPrice * weight;
        if (isBump) {
          channels[ch].bumpOrders += weight;
          channels[ch].bumpRevenue += bPrice * weight;
        }
      }

      const orderUpsells = reportEvents.filter(e =>
        e.type === 'upsell_accept' &&
        ((o.customerEmail && String(e.email || '').toLowerCase() === String(o.customerEmail).toLowerCase()) ||
         (o.visitorId && e.visitorId === o.visitorId))
      );
      for (const upEvent of orderUpsells) {
        const upAmt = Number(upEvent.amount || 0);
        for (const ch of targetList) {
          channels[ch].upsellTakes += weight;
          channels[ch].upsellRevenue += upAmt * weight;
        }
      }

      recentAttributions.push({
        orderId: o.id,
        orderNumber: o.orderNumber || `#${String(o.id).slice(-4)}`,
        amount,
        customerEmail: o.customerEmail || '',
        channel: model === 'first_touch' ? channels[firstTouch].channelName : channels[lastTouch].channelName,
        touchpointCount: Math.max(1, distinct.size),
        linked: Boolean(o.visitorId),
        createdAt: o.createdAt
      });
    }

    let totalRevenue = 0;
    let totalSpend = 0;
    let totalOrders = 0;
    let totalLeads = 0;

    const channelList = Object.values(channels).map(ch => {
      ch.revenue = Number(ch.revenue.toFixed(2));
      ch.orders = Number(ch.orders.toFixed(1));
      ch.roas = ch.spend > 0 ? Number((ch.revenue / ch.spend).toFixed(2)) : 0;
      ch.cac = ch.orders > 0 ? Number((ch.spend / ch.orders).toFixed(2)) : 0;
      ch.conversionRate = ch.clicks > 0 ? Number(((ch.orders / ch.clicks) * 100).toFixed(2)) : 0;

      // Per-channel AOV and offer attach intelligence
      ch.bumpOrders = Math.round(ch.bumpOrders);
      ch.upsellTakes = Math.round(ch.upsellTakes);
      ch.bumpRevenue = Number(ch.bumpRevenue.toFixed(2));
      ch.upsellRevenue = Number(ch.upsellRevenue.toFixed(2));
      ch.baseAov = ch.orders > 0 ? Number((ch.coreRevenue / ch.orders).toFixed(2)) : 0;
      ch.aov = ch.orders > 0 ? Number(((ch.revenue + ch.upsellRevenue) / ch.orders).toFixed(2)) : 0;
      ch.aovLift = Number(Math.max(0, ch.aov - ch.baseAov).toFixed(2));
      ch.bumpAttachRate = ch.orders > 0 ? Number(((ch.bumpOrders / ch.orders) * 100).toFixed(1)) : 0;
      ch.upsellAttachRate = ch.orders > 0 ? Number(((ch.upsellTakes / ch.orders) * 100).toFixed(1)) : 0;

      totalRevenue += ch.revenue;
      totalSpend += ch.spend;
      totalOrders += ch.orders;
      totalLeads += ch.leads;
      return ch;
    });

    const ordersByEmail = {};
    for (const o of filteredOrders) {
      const email = String(o.customerEmail || '').toLowerCase();
      if (!email) continue;
      ordersByEmail[email] = (ordersByEmail[email] || 0) + 1;
    }
    const buyerCount = Object.keys(ordersByEmail).length;
    const repeatCount = Object.values(ordersByEmail).filter(n => n >= 2).length;
    const repeatBuyerRate = buyerCount > 0 ? Number(((repeatCount / buyerCount) * 100).toFixed(1)) : 0;

    const summary = {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalSpend: Number(totalSpend.toFixed(2)),
      blendedRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
      blendedCac: totalOrders > 0 ? Number((totalSpend / totalOrders).toFixed(2)) : 0,
      blendedAov: totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0,
      totalOrders: Math.round(totalOrders),
      totalLeads,
      repeatBuyerRate,
      netProfit: Number((totalRevenue - totalSpend).toFixed(2))
    };

    const viewCount = reportEvents.filter(e => e.type === 'page_view').length;
    const leadCount = Math.max(totalLeads, reportEvents.filter(e => e.type === 'lead').length);
    const checkoutCount = reportEvents.filter(e => e.type === 'checkout_start').length;
    const bumpCount = filteredOrders.filter(o => o.orderBumpIncluded).length;
    const share = (count, base) => base > 0 ? Number(((count / base) * 100).toFixed(1)) : 0;
    const drop = (count, prev) => prev > 0 ? Number((Math.max(0, prev - count) / prev * 100).toFixed(1)) : 0;
    const funnelSteps = [
      { id: 'views', name: 'Landing Page Views', count: viewCount, percentage: viewCount > 0 ? 100 : 0, dropoffRate: 0 },
      { id: 'leads', name: 'Leads Captured', count: leadCount, percentage: share(leadCount, viewCount), dropoffRate: drop(leadCount, viewCount) },
      { id: 'checkouts', name: 'Checkouts Started', count: checkoutCount, percentage: share(checkoutCount, viewCount), dropoffRate: drop(checkoutCount, leadCount) },
      { id: 'orders', name: 'Orders Placed', count: Math.round(totalOrders), percentage: share(totalOrders, viewCount), dropoffRate: drop(totalOrders, checkoutCount) },
      { id: 'bumps', name: 'Orders With a Bump', count: bumpCount, percentage: share(bumpCount, viewCount), dropoffRate: drop(bumpCount, totalOrders) }
    ];

    // Multi-Offer Revenue Breakdown & AOV Expansion Lift
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

    // Recovery intelligence from second-chance post-purchase courtesy email sequence
    const totalDeclines = upsellDeclines.length;
    const declinedEmails = new Set(upsellDeclines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));
    
    let recoveryConvertedEmails = new Set();
    try {
      const dripsData = loadDrips();
      const recoveryEnrollments = (dripsData.enrollments || []).filter(e => e.sequenceId === 'drip_seq_upsell_recovery');
      for (const enr of recoveryEnrollments) {
        if (enr.status === 'converted_exit' && enr.customerEmail) {
          recoveryConvertedEmails.add(String(enr.customerEmail).toLowerCase());
        }
      }
    } catch (err) {
      console.warn('[Jourvance] Recovery drips load failed in attribution report:', err.message);
    }

    const recoveredUpsellEvents = upsellEvents.filter(u => {
      const em = String(u.email || '').toLowerCase();
      return em && (declinedEmails.has(em) || recoveryConvertedEmails.has(em));
    });
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

    const aovExpansion = {
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

    const countOrBlank = (type) => {
      const count = reportEvents.filter((event) => event.type === type).length;
      return count > 0 ? count : null;
    };

    const upsellViewCount = reportEvents.filter(e => e.type === 'upsell_view' && (e.offerType || 'upsell') === 'upsell').length;
    if (upsellViewCount > 0 || upsellTakes > 0) {
      funnelSteps.push({
        id: 'upsells',
        name: '1-Click Upsell Taken',
        count: upsellTakes,
        percentage: share(upsellTakes, viewCount),
        dropoffRate: drop(upsellTakes, Math.max(1, Math.round(totalOrders)))
      });
    }
    const downsellViewCount = reportEvents.filter(e => e.type === 'upsell_view' && e.offerType === 'downsell').length;
    if (downsellViewCount > 0 || downsellTakes > 0) {
      funnelSteps.push({
        id: 'downsells',
        name: 'Downsell Offer Taken',
        count: downsellTakes,
        percentage: share(downsellTakes, viewCount),
        dropoffRate: drop(downsellTakes, Math.max(1, upsellViewCount - upsellTakes))
      });
    }

    // ── Retention Telemetry (Cart Abandonment Recovery & 24h Courtesy Upsell Rescue) ──
    const allCheckouts = typeof loadCheckouts === 'function' ? loadCheckouts() : [];
    const userCheckouts = allCheckouts.filter(chk => {
      if (chk.userId !== uid) return false;
      const chkDate = chk.abandonedAt || chk.createdAt || chk.recoveredAt;
      if (!inWindow(chkDate)) return false;
      if (workspaceId && chk.workspaceId && chk.workspaceId !== workspaceId) return false;
      return true;
    });

    const recoveredCheckouts = userCheckouts.filter(chk => chk.recoveryStatus === 'recovered');
    const recoveredCheckoutEvents = reportEvents.filter(e => e.type === 'checkout_recovered');

    const recoveredCheckoutsCount = Math.max(recoveredCheckouts.length, recoveredCheckoutEvents.length);
    let recoveredCheckoutRevenue = recoveredCheckouts.reduce((sum, c) => sum + (Number(c.totalPrice) || 0), 0);
    if (recoveredCheckoutRevenue <= 0 && recoveredCheckoutEvents.length > 0) {
      recoveredCheckoutRevenue = recoveredCheckoutEvents.reduce((sum, e) => sum + (Number(e.value || e.amount) || 0), 0);
    }
    recoveredCheckoutRevenue = Number(recoveredCheckoutRevenue.toFixed(2));

    const abandonedCheckoutsCount = Math.max(userCheckouts.length, recoveredCheckoutsCount);
    const checkoutRecoveryRate = abandonedCheckoutsCount > 0
      ? Number(((recoveredCheckoutsCount / abandonedCheckoutsCount) * 100).toFixed(1))
      : 0;

    const totalRetentionRevenue = Number((recoveredCheckoutRevenue + recoveredUpsellRevenue).toFixed(2));
    const totalRetentionOrders = recoveredCheckoutsCount + recoveredUpsellOrders;
    // Realized Net Profit Saved with zero additional ad spend (estimated 20% COGS deduction)
    const retentionNetProfit = Number((totalRetentionRevenue * 0.80).toFixed(2));

    const retentionTelemetry = {
      abandonedCheckoutsCount,
      recoveredCheckoutsCount,
      recoveredCheckoutRevenue,
      checkoutRecoveryRate,
      upsellDeclinesCount: totalDeclines,
      recoveredUpsellOrders,
      recoveredUpsellRevenue,
      upsellRecoveryRate: recoveryRate,
      totalRetentionRevenue,
      totalRetentionOrders,
      retentionNetProfit
    };

    res.json({
      success: true,
      report: {
        timeframe,
        model,
        summary,
        channels: channelList,
        funnelSteps,
        touchCounts: {
          pageViews: countOrBlank('page_view'),
          emailSends: countOrBlank('email_sent'),
          emailClicks: countOrBlank('email_clicked')
        },
        recentAttributions: recentAttributions.slice(0, 10),
        aovExpansion,
        retentionTelemetry
      }
    });
  });

  // ── Attribution CSV Export ───────────────────────────────────────────────────

  app.get('/api/reports/attribution/export-csv', requireUser, async (req, res) => {
    const model = req.query.model || 'last_touch';
    const timeframe = req.query.timeframe || '30d';
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : '';
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : null;
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    const orders = loadOrders().filter(o => {
      if (cutoff && new Date(o.createdAt || 0).getTime() < cutoff) return false;
      const slugOwner = o.attributedSlug ? publicPageCache[o.attributedSlug]?.userId : '';
      if (!orderBelongsTo(o, req.user.uid, slugOwner)) return false;
      if (workspaceId) {
        if (o.workspaceId && o.workspaceId !== workspaceId) return false;
        const orderWsId = o.attributedSlug ? publicPageCache[o.attributedSlug]?.workspaceId : '';
        if (orderWsId && orderWsId !== workspaceId) return false;
      }
      return true;
    });

    const allCheckouts = typeof loadCheckouts === 'function' ? loadCheckouts() : [];
    const recoveredOrdersMap = new Set(
      allCheckouts
        .filter(c => c.recoveryStatus === 'recovered' && c.recoveredOrderId)
        .map(c => String(c.recoveredOrderId))
    );
    const recoveredCheckoutEvents = loadEvents().filter(e => e.type === 'checkout_recovered');
    for (const ev of recoveredCheckoutEvents) {
      if (ev.orderId) recoveredOrdersMap.add(String(ev.orderId));
    }

    const lines = ['Order,Email,Amount,Created,Discount,Slug,Visitor,Channel,OrderBump,RetentionRescue'];
    for (const o of orders) {
      let rescueType = 'Direct / Day 0';
      if (recoveredOrdersMap.has(String(o.id)) || (o.discountCode && /save10|recover|cart/i.test(o.discountCode))) {
        rescueType = 'Cart Recovery';
      } else if (o.discountCode && /viprescue|oto.?recovery|courtesy/i.test(o.discountCode)) {
        rescueType = 'Upsell Rescue';
      }

      lines.push([
        o.orderNumber || o.id,
        o.customerEmail || '',
        Number(o.totalPrice || 0).toFixed(2),
        o.createdAt || '',
        o.discountCode || '',
        o.attributedSlug || '',
        o.visitorId || '',
        o.checkoutChannel || channelOf(o),
        o.orderBumpIncluded ? 'Yes' : 'No',
        rescueType
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="jourvance-orders-${timeframe}-${model}.csv"`);
    res.send(lines.join('\n'));
  });

  // ── Email Analytics & Attribution Windows ───────────────────────────────────

  app.get('/api/email/analytics', requireUser, async (req, res) => {
    const uid = req.user.uid;
    const stats = messageStatsFor(uid, () => true);
    const sent = stats.sent;
    const rate = (part) => (sent && part != null ? Number(((part / sent) * 100).toFixed(1)) : null);
    res.json({
      success: true,
      analytics: {
        totalSent: sent,
        sent,
        delivered: stats.delivered,
        opened: stats.opened,
        clicked: stats.clicked,
        unsubscribed: stats.unsubscribed,
        revenue: stats.revenue,
        prefetchOpens: stats.prefetchOpens,
        avgOpenRate: rate(stats.opened),
        avgClickRate: rate(stats.clicked),
        deliveryRate: rate(stats.delivered),
        activeSubscribers: contactsForUser(uid).length,
        windows: cleanAttributionWindows(userProgramBag(uid).attributionWindows),
        windowNote: 'Last-touch revenue uses a click within 5 days, or an open within 5 days when there is no click. A text click uses 5 days. These are the defaults. Changing them does not change an order already attributed.'
      }
    });
  });

  app.post('/api/email/attribution-windows', requireUser, (req, res) => {
    const bag = userProgramBag(req.user.uid);
    bag.attributionWindows = cleanAttributionWindows(req.body || {});
    writeUserPrograms(req.user.uid, bag);
    res.json({ success: true, windows: bag.attributionWindows, note: 'Orders already attributed keep the window stored on them.' });
  });

  // ── Visual Canvas Funnel Telemetry & Conversion Stats ────────────────────────

  app.post('/api/funnel/stats', requireUser, (req, res) => {
    const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
    const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];
    const journeyId = String(req.body?.journeyId || '');
    const events = loadEvents().filter(e => e.userId === req.user.uid && (!journeyId || e.journeyId === journeyId));
    const orders = loadOrders().filter(o => {
      if (!o.attributedSlug) return false;
      const page = publicPageCache[o.attributedSlug];
      return page && page.userId === req.user.uid && (!journeyId || page.journeyId === journeyId);
    });
    const drips = loadDrips();
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    const nodeStats = {};

    const eventsFor = (node) => events.filter(e => e.nodeId === node.id || (node.slug && e.slug === node.slug));
    const ordersFor = (node) => orders.filter(o => o.attributedNodeId === node.id || (node.slug && o.attributedSlug === node.slug));

    for (const node of nodes) {
      const mine = eventsFor(node);
      const mineOrders = ordersFor(node);
      if (node.type === 'ad-source') {
        const campaign = String(node.utmCampaign || '');
        const clicks = campaign
          ? events.filter(e => e.type === 'page_view' && e.utm_campaign === campaign).length
          : 0;
        const revenue = orders
          .filter(o => campaign && publicPageCache[o.attributedSlug])
          .reduce((sum, o) => sum, 0);
        const matchedOrders = events.filter(e => e.type === 'order' && campaign && e.utm_campaign === campaign);
        const orderRevenue = matchedOrders.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const spend = Number(node.spend || 0);
        nodeStats[node.id] = {
          clicks,
          impressions: 0,
          ctr: 0,
          roas: spend > 0 ? round1(orderRevenue / spend) : 0
        };
        void revenue;
      } else if (node.type === 'landing-page') {
        const visitors = mine.filter(e => e.type === 'page_view').length;
        const leads = mine.filter(e => e.type === 'lead').length;
        const orderCount = mineOrders.length;
        const conversions = orderCount || leads;
        const grossRevenue = Number(mineOrders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));
        const bumpOrders = mineOrders.filter(o => o.orderBumpIncluded);
        nodeStats[node.id] = {
          visitors,
          conversions,
          conversionRate: visitors > 0 ? round1((conversions / visitors) * 100) : 0,
          grossRevenue,
          liveRevenue: grossRevenue,
          liveOrders: orderCount,
          orderBumpTakes: bumpOrders.length,
          liveBumpOrders: bumpOrders.length,
          variantAVisitors: mine.filter(e => e.type === 'page_view' && e.variant !== 'b').length,
          variantBVisitors: mine.filter(e => e.type === 'page_view' && e.variant === 'b').length,
          variantAConversions: mine.filter(e => e.type === 'lead' && e.variant !== 'b').length,
          variantBConversions: mine.filter(e => e.type === 'lead' && e.variant === 'b').length
        };
      } else if (node.type === 'lead-form') {
        const sourceId = edges.find(e => e.target === node.id)?.source;
        const source = sourceId ? byId[sourceId] : null;
        const upstream = source ? eventsFor(source) : [];
        const views = upstream.filter(e => e.type === 'page_view').length;
        const submissions = upstream.filter(e => e.type === 'lead').length;
        nodeStats[node.id] = {
          views,
          submissions,
          completionRate: views > 0 ? round1((submissions / views) * 100) : 0
        };
      } else if (node.type === 'follow-up-sequence') {
        const flowId = String(node.jourvanceFlowId || '');
        const bag = userProgramBag(req.user.uid);
        if (flowId && bag.flows.some((flow) => flow.id === flowId)) {
          const stats = messageStatsFor(req.user.uid, (item) => item.flowId === flowId);
          nodeStats[node.id] = {
            flowEnrolled: enrollmentCount(bag.flowEnrollments, flowId),
            flowSent: stats.sent,
            flowClicked: stats.clicked,
            flowOpened: stats.opened,
            flowRevenue: stats.revenue,
            jourvanceFlowName: bag.flows.find((flow) => flow.id === flowId)?.name || ''
          };
        } else {
          const sourceId = edges.find(e => e.target === node.id)?.source;
          const source = sourceId ? byId[sourceId] : null;
          const slug = source?.slug || '';
          const emails = new Set();
          for (const enr of drips.enrollments) {
            if (enr.userId === req.user.uid && slug && enr.sourceSlug === slug && enr.customerEmail) emails.add(String(enr.customerEmail).toLowerCase());
          }
          for (const evt of events) {
            if (evt.type === 'klaviyo_handoff' && evt.entered && evt.nodeId === node.id && evt.email) emails.add(String(evt.email).toLowerCase());
          }
          nodeStats[node.id] = {
            flowEnrolled: emails.size > 0 ? emails.size : null,
            flowSent: null,
            flowClicked: null,
            flowOpened: null,
            flowRevenue: null
          };
        }
      } else if (node.type === 'thank-you') {
        const thankYous = nodes.filter(n => n.type === 'thank-you');
        const views = thankYous.length === 1
          ? events.filter(e => e.type === 'thank_you_view').length
          : events.filter(e => e.type === 'thank_you_view' && e.slug === node.slug).length;
        nodeStats[node.id] = { pageViews: views, bounceBackClaims: 0 };
      } else if (node.type === 'upsell') {
        const offer = node.offerType === 'downsell' ? 'downsell' : 'upsell';
        const views = events.filter(e => e.type === 'upsell_view' && (e.offerType || 'upsell') === offer).length;
        const accepts = events.filter(e => e.type === 'upsell_accept' && (e.offerType || 'upsell') === offer);
        const takes = accepts.length;
        const attributedRevenue = Number(accepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
        const declines = events.filter(e => e.type === 'upsell_decline' && (e.offerType || 'upsell') === offer);
        const totalDeclines = declines.length;
        const declinedEmails = new Set(declines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));
        const recoveryEnrollments = (drips.enrollments || []).filter(e => e.sequenceId === 'drip_seq_upsell_recovery');
        const recoveryConvertedEmails = new Set(
          recoveryEnrollments.filter(e => e.status === 'converted_exit' && e.customerEmail).map(e => e.customerEmail.toLowerCase())
        );
        const recoveredAccepts = accepts.filter(a => {
          const em = String(a.email || '').toLowerCase();
          return (em && (declinedEmails.has(em) || recoveryConvertedEmails.has(em))) || (a.discountCode && a.discountCode === 'SAVE10');
        });
        const recoveredTakes = recoveredAccepts.length;
        const recoveredRevenue = Number(recoveredAccepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
        const recoveryRate = totalDeclines > 0 ? round1((recoveredTakes / totalDeclines) * 100) : 0;

        nodeStats[node.id] = {
          views,
          takes,
          conversionRate: views > 0 ? round1((takes / views) * 100) : 0,
          attributedRevenue,
          totalDeclines,
          recoveredTakes,
          recoveredRevenue,
          recoveryRate
        };
      } else if (node.type === 'ab-split') {
        const splitSlug = String(node.slug || '');
        const splitEvents = events.filter(e => e.nodeId === node.id || (splitSlug && (e.slug === splitSlug || e.splitSlug === splitSlug)));
        const visA = splitEvents.filter(e => (e.type === 'split_route' || e.type === 'page_view') && e.variant !== 'b').length;
        const visB = splitEvents.filter(e => (e.type === 'split_route' || e.type === 'page_view') && e.variant === 'b').length;

        const outgoingEdges = edges.filter(e => e.source === node.id);
        const edgeA = outgoingEdges.find(e => e.sourceHandle === 'branch-a') || outgoingEdges[0];
        const edgeB = outgoingEdges.find(e => e.sourceHandle === 'branch-b') || outgoingEdges[1];
        const nodeA = edgeA ? byId[edgeA.target] : null;
        const nodeB = edgeB ? byId[edgeB.target] : null;

        const eventsA = nodeA ? eventsFor(nodeA) : [];
        const ordersA = nodeA ? ordersFor(nodeA) : [];
        const convA = (ordersA.length || eventsA.filter(e => e.type === 'lead').length) || splitEvents.filter(e => (e.type === 'lead' || e.type === 'order') && e.variant !== 'b').length;
        const revA = Number(ordersA.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));

        const eventsB = nodeB ? eventsFor(nodeB) : [];
        const ordersB = nodeB ? ordersFor(nodeB) : [];
        const convB = (ordersB.length || eventsB.filter(e => e.type === 'lead').length) || splitEvents.filter(e => (e.type === 'lead' || e.type === 'order') && e.variant === 'b').length;
        const revB = Number(ordersB.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));

        nodeStats[node.id] = {
          branchAVisitors: visA,
          branchAConversions: convA,
          branchAGrossRevenue: revA,
          branchBVisitors: visB,
          branchBConversions: convB,
          branchBGrossRevenue: revB
        };
      }
    }

    const throughput = (node) => {
      const s = nodeStats[node.id] || {};
      if (node.type === 'ad-source') return s.clicks || 0;
      if (node.type === 'ab-split') return (s.branchAVisitors || 0) + (s.branchBVisitors || 0);
      if (node.type === 'landing-page') return s.visitors || 0;
      if (node.type === 'lead-form') return s.submissions || 0;
      if (node.type === 'follow-up-sequence') return s.flowEnrolled || 0;
      if (node.type === 'thank-you') return s.pageViews || 0;
      if (node.type === 'upsell') return s.takes || 0;
      return 0;
    };
    const edgeStats = {};
    for (const edge of edges) {
      const source = byId[edge.source];
      const target = byId[edge.target];
      let sourceThroughput = source ? throughput(source) : 0;
      if (source?.type === 'ab-split') {
        const splitStats = nodeStats[source.id] || {};
        if (edge.sourceHandle === 'branch-b') {
          sourceThroughput = splitStats.branchBVisitors || 0;
        } else {
          sourceThroughput = splitStats.branchAVisitors || 0;
        }
      }
      const targetCount = target ? throughput(target) : 0;
      edgeStats[edge.id] = {
        sourceThroughput,
        targetCount,
        rate: sourceThroughput > 0 ? round1((targetCount / sourceThroughput) * 100) : 0
      };
    }

    res.json({ success: true, stats: { nodes: nodeStats, edges: edgeStats } });
  });

  // ── Operator Admin Aggregate Summary ──────────────────────────────────────────

  app.get('/api/admin/summary', requireOperator, (req, res) => {
    const events = loadEvents();
    res.json({
      success: true,
      leads: loadContacts().length,
      orders: loadOrders().length,
      pageViews: events.filter(e => e.type === 'page_view').length,
      events: events.length,
      hubConfigured: hubReady
    });
  });
}
