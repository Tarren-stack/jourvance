/**
 * Jourvance Analytics & Reporting Controller
 * Handles Multi-Channel Attribution Analytics, CSV Exports, Funnel Telemetry Stats,
 * Email Analytics & Windows, and Operator Summaries.
 */

import {
  orderBelongsTo,
  attributionTouches,
  channelOf
} from '../../email-map.mjs';
import { cleanAttributionWindows } from '../../email-feeds.mjs';

function round1(n) {
  return Math.round(n * 10) / 10;
}

// The one report window rule. Anything that is not a named range reaches back 9999 days, which
// is how far the report's 'all' has always looked.
const TIMEFRAME_DAYS = { '7d': 7, '30d': 30, '90d': 90, all: 9999 };

export function timeframeCutoff(timeframe, now = Date.now()) {
  return now - (TIMEFRAME_DAYS[timeframe] ?? 9999) * 86400000;
}

// The map's ranges (#9). Anything else reads as the default 30 days.
export function funnelStatsDays(v) {
  const n = Number(v);
  return n === 7 || n === 30 || n === 90 ? n : 30;
}

// The Attribution page names its range as a timeframe. The map keeps at most 90 days, so its
// 'all' reads as the longest range; the answer echoes the days it counted.
const FUNNEL_TIMEFRAME_DAYS = { '7d': 7, '30d': 30, '90d': 90, all: 90 };

// People, not page loads: each visitorId once, and each event without an id once.
export function countPeople(list) {
  const ids = new Set();
  let anonymous = 0;
  for (const e of list) {
    const id = String(e?.visitorId || '');
    if (id) ids.add(id);
    else anonymous++;
  }
  return ids.size + anonymous;
}

// A percentage, or null when there is nothing to divide by. Never above 100.
export function rateOr(part, whole) {
  if (!(whole > 0) || !Number.isFinite(part)) return null;
  return Math.min(100, round1((part / whole) * 100));
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// The drip triggers each kind of follow-up step stands for. Lead sign-ups, checkout abandoners and
// declined upsells are all enrolled with the page's slug, so an unlinked step counts only the
// enrolments of its own kind of sequence.
const SEQUENCE_TRIGGERS = {
  lead_nurture: ['lead_capture', 'exit_intent'],
  checkout_recovery: ['checkout_abandonment'],
  upsell_recovery: ['upsell_recovery'],
  at_risk_winback: ['at_risk_inactivity'],
  fulfillment_review: ['fulfillment_review']
};
// Win-back and review enrolments are made from the contact list and from orders, never from a page,
// so they carry no sourceSlug and a journey cannot count them.
const PAGELESS_TRIGGERS = new Set(['at_risk_inactivity', 'fulfillment_review']);
// A line out of one of these handles only ever carries that kind of recovery.
const HANDLE_SEQUENCE = { abandon: 'checkout_recovery', rescue: 'upsell_recovery', declined: 'upsell_recovery' };
// The built-in sequences' triggers, for an enrolment whose sequence is no longer in the list.
const BUILT_IN_TRIGGERS = {
  drip_seq_default: 'lead_capture',
  drip_seq_cart_recovery: 'checkout_abandonment',
  drip_seq_upsell_recovery: 'upsell_recovery',
  drip_seq_at_risk_winback: 'at_risk_inactivity',
  drip_seq_review_request: 'fulfillment_review'
};

/** The drip triggers a follow-up step counts: its own kind, else its incoming line's, else nurture. */
export function followUpTriggers(node, incomingHandles) {
  const own = Object.hasOwn(SEQUENCE_TRIGGERS, node?.sequenceType) ? node.sequenceType : '';
  if (own && own !== 'lead_nurture') return SEQUENCE_TRIGGERS[own];
  const handle = (incomingHandles || []).find(h => Object.hasOwn(HANDLE_SEQUENCE, h));
  return SEQUENCE_TRIGGERS[handle ? HANDLE_SEQUENCE[handle] : 'lead_nurture'];
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
    hubReady,
    eventsKept
  } = ctx;

  // ── Multi-Channel Attribution Analytics ───────────────────────────────────────

  app.get('/api/reports/attribution', requireUser, async (req, res) => {
    const model = req.query.model || 'last_touch'; // 'first_touch' | 'last_touch' | 'linear'
    const timeframe = req.query.timeframe || '30d'; // '7d' | '30d' | 'all'
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : '';

    const uid = req.user.uid;
    const now = Date.now();
    const cutoff = timeframeCutoff(timeframe, now);
    const inWindow = (iso) => new Date(iso || 0).getTime() >= cutoff;
    const eventOwner = (e) => e.userId || (e.slug && publicPageCache[e.slug]?.userId) || '';
    // Every count below is read from the event log. A log that cannot be read is not an empty one,
    // so the report is unavailable rather than a page of zeros (U06).
    let loggedEvents;
    try {
      loggedEvents = loadEvents();
    } catch (err) {
      console.warn('[Jourvance] Event log read failed in attribution report:', err.message);
    }
    if (!Array.isArray(loggedEvents)) {
      return res.status(503).json({ success: false, error: 'The event log could not be read, so this report is unavailable.' });
    }
    const reportEvents = loggedEvents.filter(e => {
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
      // A ratio without a denominator is unmeasured: null, never 0 (T05).
      ch.roas = ch.spend > 0 ? Number((ch.revenue / ch.spend).toFixed(2)) : null;
      ch.cac = ch.orders > 0 ? Number((ch.spend / ch.orders).toFixed(2)) : null;
      ch.conversionRate = ch.clicks > 0 ? Number(((ch.orders / ch.clicks) * 100).toFixed(2)) : null;

      // Per-channel AOV and offer attach intelligence
      ch.bumpOrders = Math.round(ch.bumpOrders);
      ch.upsellTakes = Math.round(ch.upsellTakes);
      ch.bumpRevenue = Number(ch.bumpRevenue.toFixed(2));
      ch.upsellRevenue = Number(ch.upsellRevenue.toFixed(2));
      ch.baseAov = ch.orders > 0 ? Number((ch.coreRevenue / ch.orders).toFixed(2)) : null;
      ch.aov = ch.orders > 0 ? Number(((ch.revenue + ch.upsellRevenue) / ch.orders).toFixed(2)) : null;
      ch.aovLift = ch.orders > 0 ? Number(Math.max(0, ch.aov - ch.baseAov).toFixed(2)) : null;
      ch.bumpAttachRate = ch.orders > 0 ? Number(((ch.bumpOrders / ch.orders) * 100).toFixed(1)) : null;
      ch.upsellAttachRate = ch.orders > 0 ? Number(((ch.upsellTakes / ch.orders) * 100).toFixed(1)) : null;

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
    // A ratio without a denominator is unmeasured: null, never 0.
    const repeatBuyerRate = buyerCount > 0 ? Number(((repeatCount / buyerCount) * 100).toFixed(1)) : null;

    const summary = {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalSpend: Number(totalSpend.toFixed(2)),
      blendedRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : null,
      blendedCac: totalOrders > 0 ? Number((totalSpend / totalOrders).toFixed(2)) : null,
      blendedAov: totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : null,
      totalOrders: Math.round(totalOrders),
      totalLeads,
      repeatBuyerRate,
      netProfit: Number((totalRevenue - totalSpend).toFixed(2))
    };

    const viewCount = reportEvents.filter(e => e.type === 'page_view').length;
    const leadCount = Math.max(totalLeads, reportEvents.filter(e => e.type === 'lead').length);
    const checkoutCount = reportEvents.filter(e => e.type === 'checkout_start').length;
    const bumpCount = filteredOrders.filter(o => o.orderBumpIncluded).length;
    // A share or a drop-off needs a step to divide by; without one it is null, never 0 (T05).
    const share = (count, base) => base > 0 ? Number(((count / base) * 100).toFixed(1)) : null;
    const drop = (count, prev) => prev > 0 ? Number((Math.max(0, prev - count) / prev * 100).toFixed(1)) : null;
    const funnelSteps = [
      { id: 'views', name: 'Landing Page Views', count: viewCount, percentage: viewCount > 0 ? 100 : null, dropoffRate: null },
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
    const recoveryRate = totalDeclines > 0 ? Number(((recoveredUpsellOrders / totalDeclines) * 100).toFixed(1)) : null;

    bumpRevenue = Number(bumpRevenue.toFixed(2));
    coreRevenue = Number(coreRevenue.toFixed(2));

    const combinedRevenue = Number((coreRevenue + bumpRevenue + upsellRevenue + downsellRevenue).toFixed(2));
    // An average needs orders and a share needs revenue: without them each is null, never 0 (T05).
    const hasOrders = totalFrontEndOrders > 0;
    const baseAov = hasOrders ? Number((coreRevenue / totalFrontEndOrders).toFixed(2)) : null;
    const effectiveAov = hasOrders ? Number((combinedRevenue / totalFrontEndOrders).toFixed(2)) : null;
    const aovLiftDollars = hasOrders ? Number((effectiveAov - baseAov).toFixed(2)) : null;
    const aovLiftPercent = baseAov > 0 ? Number(((aovLiftDollars / baseAov) * 100).toFixed(1)) : null;
    const shareOfRevenue = (revenue) => combinedRevenue > 0 ? Number(((revenue / combinedRevenue) * 100).toFixed(1)) : null;
    const attachOf = (count) => hasOrders ? Number(((count / totalFrontEndOrders) * 100).toFixed(1)) : null;
    const perOrder = (revenue) => hasOrders ? Number((revenue / totalFrontEndOrders).toFixed(2)) : null;

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
          percentageOfTotal: shareOfRevenue(coreRevenue),
          attachRate: hasOrders ? 100 : null,
          aovContribution: baseAov
        },
        {
          tier: 'bump',
          name: 'Checkout Order Bump Add-on',
          orderCount: bumpOrdersCount,
          revenue: bumpRevenue,
          percentageOfTotal: shareOfRevenue(bumpRevenue),
          attachRate: attachOf(bumpOrdersCount),
          aovContribution: perOrder(bumpRevenue)
        },
        {
          tier: 'upsell',
          name: '1-Click Post-Purchase Upsell (OTO)',
          orderCount: upsellTakes,
          revenue: upsellRevenue,
          percentageOfTotal: shareOfRevenue(upsellRevenue),
          attachRate: attachOf(upsellTakes),
          aovContribution: perOrder(upsellRevenue),
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
          percentageOfTotal: shareOfRevenue(downsellRevenue),
          attachRate: attachOf(downsellTakes),
          aovContribution: perOrder(downsellRevenue)
        }
      ]
    };

    // A count from a stream that was read is measured, so none is 0 (U06). Page views come from
    // this app's own log, which was read above. Sends and clicks are logged only while email
    // sending is connected, so with it off and nothing logged the stream was never there to read.
    const countOrBlank = (type, connected = true) => {
      const count = reportEvents.filter((event) => event.type === type).length;
      return connected || count > 0 ? count : null;
    };
    const emailConnected = Boolean(hubReady);

    const upsellViewCount = reportEvents.filter(e => e.type === 'upsell_view' && (e.offerType || 'upsell') === 'upsell').length;
    if (upsellViewCount > 0 || upsellTakes > 0) {
      funnelSteps.push({
        id: 'upsells',
        name: '1-Click Upsell Taken',
        count: upsellTakes,
        percentage: share(upsellTakes, viewCount),
        dropoffRate: drop(upsellTakes, Math.round(totalOrders))
      });
    }
    const downsellViewCount = reportEvents.filter(e => e.type === 'upsell_view' && e.offerType === 'downsell').length;
    if (downsellViewCount > 0 || downsellTakes > 0) {
      funnelSteps.push({
        id: 'downsells',
        name: 'Downsell Offer Taken',
        count: downsellTakes,
        percentage: share(downsellTakes, viewCount),
        dropoffRate: drop(downsellTakes, Math.max(0, upsellViewCount - upsellTakes))
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
      : null;

    const totalRetentionRevenue = Number((recoveredCheckoutRevenue + recoveredUpsellRevenue).toFixed(2));
    const totalRetentionOrders = recoveredCheckoutsCount + recoveredUpsellOrders;
    // No profit figure: the product cost is the user's own number, entered in the Forecaster, and
    // the page works it out from that. An assumed 20% was a figure nobody measured (U06).

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
      totalRetentionOrders
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
          emailSends: countOrBlank('email_sent', emailConnected),
          emailClicks: countOrBlank('email_clicked', emailConnected)
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

  // One stats snapshot for one journey and one range (#9). Every figure on the journey map and
  // the Attribution leak finder reads this answer. It counts only this journey's events and orders
  // inside the range, counts people rather than page loads, answers null for anything it cannot
  // measure (never 0), and says in `coverage` which steps it measured and why not. It echoes the
  // journey and range, so the canvas never shows a slow answer for another range.
  app.post('/api/funnel/stats', requireUser, (req, res) => {
    const uid = req.user.uid;
    const journeyId = typeof req.body?.journeyId === 'string' ? req.body.journeyId.trim() : '';
    if (!journeyId) {
      return res.status(400).json({ success: false, error: 'Name the journey whose numbers you want.' });
    }
    const nodes = (Array.isArray(req.body?.nodes) ? req.body.nodes : []).filter(n => n && typeof n.id === 'string');
    const edges = (Array.isArray(req.body?.edges) ? req.body.edges : []).filter(e => e && typeof e === 'object');
    const days = req.body?.days != null
      ? funnelStatsDays(req.body.days)
      : funnelStatsDays(FUNNEL_TIMEFRAME_DAYS[req.body?.timeframe]);
    const now = Date.now();
    const cutoff = timeframeCutoff(`${days}d`, now);
    // An undated row cannot be placed in a range, so it is left out.
    const inRange = (iso) => {
      const t = Date.parse(iso || '');
      return Number.isFinite(t) && t >= cutoff;
    };

    const all = loadEvents();
    const events = all.filter(e => e && e.userId === uid && e.journeyId === journeyId && inRange(e.at));
    // recordEvent in server.mjs keeps only the newest 20,000 events across every account. When the
    // store is full and its oldest event is inside the range, older visits in the range are gone.
    const kept = Number(eventsKept) > 0 ? Number(eventsKept) : 20000;
    let partialSince = null;
    if (all.length >= kept) {
      let oldest = Infinity;
      for (const e of all) {
        const t = Date.parse(e?.at || '');
        if (Number.isFinite(t) && t < oldest) oldest = t;
      }
      if (Number.isFinite(oldest) && oldest > cutoff) partialSince = new Date(oldest).toISOString();
    }

    const ownsPage = (page) => Boolean(page && typeof page === 'object' && page.userId === uid && page.journeyId === journeyId);
    const orders = loadOrders().filter(o => o && o.attributedSlug && ownsPage(publicPageCache[o.attributedSlug]) && inRange(o.createdAt));
    const livePages = Object.values(publicPageCache || {}).filter(ownsPage);
    const pageLive = (node) => Boolean(node?.slug) && ownsPage(publicPageCache[node.slug]);
    const journeySlugs = new Set(nodes.map(n => String(n.slug || '')).filter(Boolean));
    const drips = loadDrips() || {};
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    const nodeStats = {};
    const coverage = {};

    const eventsFor = (node) => events.filter(e => e.nodeId === node.id || (node.slug && e.slug === node.slug));
    const ordersFor = (node) => orders.filter(o => o.attributedNodeId === node.id || (node.slug && o.attributedSlug === node.slug));
    const pageMeasured = (node) => pageLive(node) || eventsFor(node).length > 0 || ordersFor(node).length > 0;
    const nulls = (keys) => Object.fromEntries(keys.map(k => [k, null]));
    const notMeasured = (node, keys, why) => {
      nodeStats[node.id] = nulls(keys);
      coverage[node.id] = why ? { measured: false, why } : { measured: false };
    };
    const incoming = (node) => edges.filter(e => e.target === node.id).map(e => byId[e.source]).filter(Boolean);

    for (const node of nodes) {
      const mine = eventsFor(node);
      const mineOrders = ordersFor(node);
      if (node.type === 'ad-source') {
        const campaign = String(node.utmCampaign || '');
        const keys = ['clicks', 'impressions', 'ctr', 'roas', 'attributedRevenue'];
        if (!campaign) { notMeasured(node, keys, 'no_campaign'); continue; }
        const clicks = countPeople(events.filter(e => e.type === 'page_view' && e.utm_campaign === campaign));
        const revenue = events
          .filter(e => e.type === 'order' && e.utm_campaign === campaign)
          .reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const spend = Number(node.spend || 0);
        nodeStats[node.id] = {
          clicks,
          // The ad platform's audience is never read here, so there is no impression count and no rate.
          impressions: null,
          ctr: null,
          roas: spend > 0 ? round1(revenue / spend) : null,
          attributedRevenue: Number(revenue.toFixed(2)),
          // Not a measure: the lines out of this ad into a step other than a follow-up, in the map
          // this answer counted. The clicks are the whole campaign, so only a lone routing line may
          // show them (journeyMetrics.ts edgeFigure), and a reader with no line list needs this.
          routingLines: edges.filter(e => e.source === node.id && byId[e.target]?.type !== 'follow-up-sequence').length
        };
        coverage[node.id] = { measured: true };
      } else if (node.type === 'landing-page') {
        const keys = ['visitors', 'leads', 'conversions', 'conversionRate', 'grossRevenue', 'liveRevenue', 'liveOrders',
          'orderBumpTakes', 'liveBumpOrders', 'orderBumpRevenue', 'variantAVisitors', 'variantBVisitors',
          'variantAConversions', 'variantBConversions'];
        if (!pageMeasured(node)) { notMeasured(node, keys, 'not_published'); continue; }
        const views = mine.filter(e => e.type === 'page_view');
        const leadEvents = mine.filter(e => e.type === 'lead');
        const visitors = countPeople(views);
        const leads = countPeople(leadEvents);
        const orderCount = mineOrders.length;
        const conversions = orderCount || leads;
        const grossRevenue = Number(mineOrders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0).toFixed(2));
        const bumpOrders = mineOrders.filter(o => o.orderBumpIncluded);
        nodeStats[node.id] = {
          visitors,
          leads,
          conversions,
          conversionRate: rateOr(conversions, visitors),
          grossRevenue,
          liveRevenue: grossRevenue,
          liveOrders: orderCount,
          orderBumpTakes: bumpOrders.length,
          liveBumpOrders: bumpOrders.length,
          // Orders do not record what the bump itself earned.
          orderBumpRevenue: null,
          variantAVisitors: countPeople(views.filter(e => e.variant !== 'b')),
          variantBVisitors: countPeople(views.filter(e => e.variant === 'b')),
          variantAConversions: countPeople(leadEvents.filter(e => e.variant !== 'b')),
          variantBConversions: countPeople(leadEvents.filter(e => e.variant === 'b'))
        };
        coverage[node.id] = { measured: true };
      } else if (node.type === 'lead-form') {
        const keys = ['views', 'submissions', 'completionRate'];
        // A form is counted on the page that holds it.
        const source = incoming(node).find(n => n.type === 'landing-page');
        if (!source || !pageMeasured(source)) { notMeasured(node, keys, 'no_source'); continue; }
        const upstream = eventsFor(source);
        const views = countPeople(upstream.filter(e => e.type === 'page_view'));
        const submissions = countPeople(upstream.filter(e => e.type === 'lead'));
        nodeStats[node.id] = { views, submissions, completionRate: rateOr(submissions, views) };
        coverage[node.id] = { measured: true };
      } else if (node.type === 'follow-up-sequence') {
        const keys = ['flowEnrolled', 'flowSent', 'flowClicked', 'flowOpened', 'flowRevenue'];
        const flowId = String(node.jourvanceFlowId || '');
        const bag = userProgramBag(uid);
        const flows = Array.isArray(bag?.flows) ? bag.flows : [];
        if (flowId && flows.some((flow) => flow.id === flowId)) {
          // Flow enrolments store no journeyId, so these figures cover the whole flow.
          const stats = messageStatsFor(uid, (item) => item.flowId === flowId && inRange(item.at)) || {};
          nodeStats[node.id] = {
            flowEnrolled: (bag.flowEnrollments || []).filter(r => r.flowId === flowId && r.status !== 'handed_to_klaviyo' && inRange(r.enrolledAt)).length,
            flowSent: finiteOrNull(stats.sent),
            flowClicked: finiteOrNull(stats.clicked),
            flowOpened: finiteOrNull(stats.opened),
            flowRevenue: finiteOrNull(stats.revenue),
            jourvanceFlowName: flows.find((flow) => flow.id === flowId)?.name || ''
          };
          coverage[node.id] = { measured: true, scope: 'flow' };
        } else {
          const source = incoming(node).find(n => pageLive(n));
          const handoffs = events.filter(evt => evt.type === 'klaviyo_handoff' && evt.entered && evt.nodeId === node.id && evt.email);
          const triggers = followUpTriggers(node, edges.filter(e => e.target === node.id).map(e => e.sourceHandle));
          // Only a Klaviyo handoff names this step, so without one a win-back or review step is unmeasured, not 0.
          const pageless = triggers.every(t => PAGELESS_TRIGGERS.has(t));
          if (pageless && handoffs.length === 0) { notMeasured(node, keys, 'not_by_page'); continue; }
          if (!source && handoffs.length === 0) { notMeasured(node, keys, 'no_source'); continue; }
          const triggerOf = (sequenceId) =>
            (drips.sequences || []).find(s => s && s.id === sequenceId)?.triggerType || BUILT_IN_TRIGGERS[sequenceId] || '';
          const emails = new Set();
          for (const enr of drips.enrollments || []) {
            if (source && !pageless && enr.userId === uid && inRange(enr.enrolledAt) && enr.sourceSlug === source.slug && enr.customerEmail &&
              triggers.includes(triggerOf(enr.sequenceId))) {
              emails.add(String(enr.customerEmail).toLowerCase());
            }
          }
          for (const evt of handoffs) emails.add(String(evt.email).toLowerCase());
          // Drip sends are not tied to a step, so only the enrolments are counted here.
          nodeStats[node.id] = { flowEnrolled: emails.size, flowSent: null, flowClicked: null, flowOpened: null, flowRevenue: null };
          coverage[node.id] = { measured: true };
        }
      } else if (node.type === 'thank-you') {
        const keys = ['pageViews', 'bounceBackClaims'];
        // A thank-you page is served by a live landing page, whose record names the step it serves.
        // One published before that record existed serves the journey's first thank-you.
        const thankYous = nodes.filter(n => n.type === 'thank-you');
        const servingSlugs = new Set(livePages.filter(p => {
          if (p.servedThankYou && typeof p.servedThankYou === 'object') return p.servedThankYou.nodeId === node.id;
          if ('servedThankYou' in p) return false;
          return Boolean(p.data?.thankYou) && byId[p.nodeId]?.type === 'landing-page' && thankYous[0]?.id === node.id;
        }).map(p => String(p.slug || '')).filter(Boolean));
        const views = thankYous.length === 1
          ? events.filter(e => e.type === 'thank_you_view')
          : events.filter(e => e.type === 'thank_you_view' && (servingSlugs.has(e.slug) || (node.slug && e.slug === node.slug)));
        // A step no live page serves and no visit reached is unpublished, not a measured 0.
        if (servingSlugs.size === 0 && views.length === 0) { notMeasured(node, keys, 'not_published'); continue; }
        // Bounce-back claims are never recorded.
        nodeStats[node.id] = { pageViews: countPeople(views), bounceBackClaims: null };
        coverage[node.id] = { measured: true };
      } else if (node.type === 'upsell') {
        const keys = ['views', 'takes', 'conversionRate', 'attributedRevenue', 'totalDeclines', 'recoveredTakes', 'recoveredRevenue', 'recoveryRate'];
        // Offers are recorded on the page that shows them, so two offers of the same kind in one
        // journey share these counts.
        const offer = node.offerType === 'downsell' ? 'downsell' : 'upsell';
        const ofOffer = (type) => events.filter(e => e.type === type && (e.offerType || 'upsell') === offer);
        // Publishing writes each offer step its own record, so a step with none is unpublished, not a
        // measured 0. Visits of its kind count only for the step a landing record serves, which is the
        // journey's first offer of that kind (funnelParts in journeyRoutes.mjs).
        const kindOf = (n) => (n.offerType === 'downsell' ? 'downsell' : 'upsell');
        const served = nodes.find(n => n.type === 'upsell' && kindOf(n) === offer)?.id === node.id;
        const offerSeen = ['upsell_view', 'upsell_accept', 'upsell_decline'].some(type => ofOffer(type).length > 0);
        if (!pageLive(node) && !(served && offerSeen)) { notMeasured(node, keys, 'not_published'); continue; }
        const views = countPeople(ofOffer('upsell_view'));
        const accepts = ofOffer('upsell_accept');
        const takes = countPeople(accepts);
        const attributedRevenue = Number(accepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));
        const declines = ofOffer('upsell_decline');
        const totalDeclines = countPeople(declines);
        const declinedEmails = new Set(declines.map(d => String(d.email || '').toLowerCase()).filter(Boolean));
        // Only this user's recovery enrolments, from this journey's own pages.
        const recoveryEnrollments = (drips.enrollments || []).filter(e =>
          e.sequenceId === 'drip_seq_upsell_recovery' && e.userId === uid && journeySlugs.has(String(e.sourceSlug || '')));
        const recoveryConvertedEmails = new Set(
          recoveryEnrollments.filter(e => e.status === 'converted_exit' && e.customerEmail).map(e => String(e.customerEmail).toLowerCase())
        );
        // An accept carrying a code counts only when a recovery enrolment was sent that code (C18).
        const recoveryCodes = new Set(recoveryEnrollments.map(e => String(e.discountCode || '').trim()).filter(Boolean));
        const recoveredAccepts = accepts.filter(a => {
          const em = String(a.email || '').toLowerCase();
          return (em && (declinedEmails.has(em) || recoveryConvertedEmails.has(em))) || (a.discountCode && recoveryCodes.has(a.discountCode));
        });
        const recoveredTakes = countPeople(recoveredAccepts);
        const recoveredRevenue = Number(recoveredAccepts.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2));

        nodeStats[node.id] = {
          views,
          takes,
          conversionRate: rateOr(takes, views),
          attributedRevenue,
          totalDeclines,
          recoveredTakes,
          recoveredRevenue,
          recoveryRate: rateOr(recoveredTakes, totalDeclines)
        };
        coverage[node.id] = { measured: true };
      } else if (node.type === 'ab-split') {
        const keys = ['branchAVisitors', 'branchAConversions', 'branchAGrossRevenue', 'branchBVisitors', 'branchBConversions', 'branchBGrossRevenue'];
        const splitSlug = String(node.slug || '');
        const splitEvents = events.filter(e => e.nodeId === node.id || (splitSlug && (e.slug === splitSlug || e.splitSlug === splitSlug)));
        if (!(splitSlug && ownsPage(publicPageCache[`split:${splitSlug}`])) && splitEvents.length === 0) {
          notMeasured(node, keys, 'not_published');
          continue;
        }
        const routed = splitEvents.filter(e => e.type === 'split_route' || e.type === 'page_view');
        const visA = countPeople(routed.filter(e => e.variant !== 'b'));
        const visB = countPeople(routed.filter(e => e.variant === 'b'));

        const outgoingEdges = edges.filter(e => e.source === node.id);
        const edgeA = outgoingEdges.find(e => e.sourceHandle === 'branch-a') || outgoingEdges[0];
        const edgeB = outgoingEdges.find(e => e.sourceHandle === 'branch-b') || outgoingEdges[1];
        const nodeA = edgeA ? byId[edgeA.target] : null;
        const nodeB = edgeB ? byId[edgeB.target] : null;

        // A branch's conversions are its orders, or its leads when it took none, so the split card
        // labels them conversions (C40).
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
        coverage[node.id] = { measured: true };
      } else {
        notMeasured(node, [], null);
      }
    }

    // No line stats: a line's figure is derived on the client from the two steps' own figures
    // (src/lib/journeyMetrics.ts), so the map and the Attribution leak finder read one rule.
    res.json({
      success: true,
      journeyId,
      days,
      from: new Date(cutoff).toISOString(),
      to: new Date(now).toISOString(),
      partialSince,
      stats: { nodes: nodeStats },
      coverage
    });
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
