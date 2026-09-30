import React, { useState, useEffect, useRef, useId } from 'react';
import { 
  DollarSign, Users, ShoppingCart, ArrowDownRight, 
  Download, RefreshCw, Layers, ShieldCheck, CheckCircle2, Zap,
  ExternalLink, BarChart3, Filter, Clock, ArrowUpRight, Sparkles, Mail
} from 'lucide-react';
import type { Workspace, JourneyNode, JourneyEdge, AttributionReport, AttributionModelType, FunnelForecast } from '../../types/journey';
import { authHeaders } from '../../lib/firebase';
import { extractPricingFromNodes, DEFAULT_FORECAST, calculateFunnelForecast, sellsThroughCheckout } from '../../lib/funnelForecaster';
import { JourneyLeakFinder } from './JourneyLeakFinder';

/** A finite number from the report, or null when it was not measured. */
function measuredNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

interface Props {
  workspace: Workspace | null;
  nodes?: JourneyNode[];
  forecast?: FunnelForecast;
  onOpenShopifySync?: () => void;
  /** The open journey, for the leak finder. */
  journeyId?: string;
  edges?: JourneyEdge[];
  /** Selects a step and returns to the map. */
  onSelectStep?: (nodeId: string) => void;
}

export const AttributionReports: React.FC<Props> = ({
  workspace,
  nodes = [],
  forecast,
  onOpenShopifySync,
  journeyId = '',
  edges = [],
  onSelectStep
}) => {
  const [model, setModel] = useState<AttributionModelType>('last_touch');
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | 'all'>('30d');
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the last request for this model and range failed. The cards then
  // read Unavailable rather than zeros or the previous range's numbers.
  const [failed, setFailed] = useState(false);
  // Only the newest request may set the report, so a slow reply for an old
  // range never lands under the range now selected.
  const requestSeq = useRef(0);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [channelViewMode, setChannelViewMode] = useState<'offers' | 'roi' | 'all'>('offers');
  // The channel table is wider than a phone, so its box scrolls sideways (T04). While it does,
  // it is a named region with a tab stop, so a keyboard user can reach it in every browser and
  // scroll it with the arrow keys; when the whole table fits it is not a tab stop.
  const channelTableTitleId = useId();
  const channelScrollRef = useRef<HTMLDivElement>(null);
  const [channelTableScrolls, setChannelTableScrolls] = useState(false);
  useEffect(() => {
    const box = channelScrollRef.current;
    if (!box) return;
    const read = () => setChannelTableScrolls(box.scrollWidth > box.clientWidth + 1);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);
    return () => ro.disconnect();
  }, [channelViewMode, report, loading, nodes]);

  const fetchAttribution = async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    setReport(null);
    let next: AttributionReport | null = null;
    try {
      const wsParam = workspace?.id ? `&workspaceId=${encodeURIComponent(workspace.id)}` : '';
      const res = await fetch(`/api/reports/attribution?model=${model}&timeframe=${timeframe}${wsParam}`, {
        headers: {
          ...(await authHeaders()),
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.report) next = data.report;
      }
    } catch (err) {
      console.warn('[Jourvance] Failed fetching attribution report:', err);
    }
    if (seq !== requestSeq.current) return;
    setReport(next);
    setFailed(!next);
    setLoading(false);
  };

  useEffect(() => {
    fetchAttribution();
  }, [model, timeframe, workspace?.id]);

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const wsParam = workspace?.id ? `&workspaceId=${encodeURIComponent(workspace.id)}` : '';
      const res = await fetch(`/api/reports/attribution/export-csv?model=${model}&timeframe=${timeframe}${wsParam}`, {
        headers: { ...(await authHeaders()) }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jourvance-attribution-${timeframe}-${model}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn('[Jourvance] Failed downloading CSV:', err);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const getChannelColor = (id: string) => {
    switch (id) {
      case 'meta': return '#3B82F6';
      case 'google': return '#10B981';
      case 'tiktok': return '#EC4899';
      case 'email': return '#8B5CF6';
      case 'direct': default: return '#64748B';
    }
  };

  const summary = report?.summary;
  const extractedPricing = extractPricingFromNodes(nodes || []);
  const aovExp = report?.aovExpansion;

  const totalOrders = aovExp?.totalOrders ?? summary?.totalOrders ?? 0;
  // An average needs orders. Without them the AOV is unmeasured (null), never
  // the product's list price.
  const baseAov: number | null = totalOrders > 0
    ? (aovExp?.baseAov ?? Number(((summary?.totalRevenue || 0) / totalOrders).toFixed(2)))
    : null;
  const effectiveAov: number | null = baseAov == null ? null : (aovExp?.effectiveAov ?? (measuredNumber(summary?.blendedAov) || baseAov));
  const aovLiftDollars = aovExp?.aovLiftDollars ?? (baseAov != null && effectiveAov != null ? Math.max(0, Number((effectiveAov - baseAov).toFixed(2))) : 0);
  const aovLiftPercent = aovExp?.aovLiftPercent ?? (baseAov != null && baseAov > 0 ? Number(((aovLiftDollars / baseAov) * 100).toFixed(1)) : 0);
  // Top-card figures. null means not measured: no report, or no denominator.
  const measuredRevenue = measuredNumber(summary?.totalRevenue);
  const measuredSpend = measuredNumber(summary?.totalSpend);
  const measuredRoas = measuredSpend != null && measuredSpend > 0 ? measuredNumber(summary?.blendedRoas) : null;
  const measuredCac = (summary?.totalOrders || 0) > 0 ? measuredNumber(summary?.blendedCac) : null;
  const measuredRepeatRate = (summary?.totalOrders || 0) > 0 ? measuredNumber(summary?.repeatBuyerRate) : null;
  const missingText = loading ? 'Loading' : 'Unavailable';
  const modelLabel = model === 'first_touch' ? 'First-Touch' : model === 'last_touch' ? 'Last-Touch' : 'Linear';

  const streams = aovExp?.streams || [
    {
      tier: 'core' as const,
      name: extractedPricing.coreTitle || 'Core Front-End Product',
      orderCount: totalOrders,
      revenue: Number(((baseAov ?? 0) * totalOrders).toFixed(2)),
      percentageOfTotal: 100,
      attachRate: totalOrders > 0 ? 100 : 0,
      aovContribution: baseAov ?? 0
    },
    {
      tier: 'bump' as const,
      name: extractedPricing.bumpTitle || 'Checkout Order Bump Add-on',
      orderCount: 0,
      revenue: 0,
      percentageOfTotal: 0,
      attachRate: 0,
      aovContribution: 0
    },
    {
      tier: 'upsell' as const,
      name: extractedPricing.upsellTitle || '1-Click Post-Purchase Upsell (OTO)',
      orderCount: 0,
      revenue: 0,
      percentageOfTotal: 0,
      attachRate: 0,
      aovContribution: 0
    },
    {
      tier: 'downsell' as const,
      name: extractedPricing.downsellTitle || 'Post-Purchase Downsell (OTO)',
      orderCount: 0,
      revenue: 0,
      percentageOfTotal: 0,
      attachRate: 0,
      aovContribution: 0
    }
  ];

  // Recovery flows follow a checkout or an upsell. A journey with neither has nothing to recover,
  // so the section is left out rather than shown with figures it can never have (T05).
  const hasCheckoutStep = nodes.some(n => n.data?.type === 'landing-page' && sellsThroughCheckout(n));
  const hasUpsellStep = nodes.some(n => n.data?.type === 'upsell');
  const showRecovery = hasCheckoutStep || hasUpsellStep;
  // Offer revenue and AOV need something to buy: a checkout, an upsell or a priced order bump. A
  // lead journey has none, so it shows lead measures only, not a section of offers it does not
  // have (U06).
  const sellsOffers = showRecovery || extractedPricing.hasBump;
  // A lead journey's channel table has no offer columns, so it is the acquisition view only.
  const tableMode = sellsOffers ? channelViewMode : 'roi';

  // A target is the user's own model, so it needs a forecast they saved. Without one every target
  // figure reads Unavailable: the defaults are not their traffic or their prices (T05).
  const hasSavedForecast = Boolean(forecast?.savedAt);
  const savedForecast: FunnelForecast | null = hasSavedForecast && forecast ? {
    ...DEFAULT_FORECAST,
    ...forecast,
    corePrice: extractedPricing.corePrice,
    bumpPrice: extractedPricing.bumpPrice,
    upsellPrice: extractedPricing.upsellPrice,
    downsellPrice: extractedPricing.downsellPrice,
    // Only the flows this journey can run count toward its target.
    cartRecoveryEnabled: hasCheckoutStep,
    upsellRescueEnabled: hasUpsellStep
  } : null;
  const simulatedTarget = savedForecast ? calculateFunnelForecast(savedForecast) : null;
  const targetCartRecoveryRate = savedForecast ? measuredNumber(savedForecast.cartRecoveryRate) : null;
  const targetUpsellRescueRate = savedForecast ? measuredNumber(savedForecast.upsellRescueRate) : null;
  const productCostPercent = savedForecast ? measuredNumber(savedForecast.cogsPercentage) : null;
  // What a customer can cost to win and still break even: the measured AOV less the product cost
  // the user saved in the Forecaster, the Forecaster's own break-even CAC. No saved cost, no line (U06).
  const productCostShare = productCostPercent != null ? Math.min(100, Math.max(0, productCostPercent)) : null;
  const allowableCac: number | null = effectiveAov != null && productCostShare != null
    ? Number((effectiveAov * (1 - productCostShare / 100)).toFixed(2))
    : null;

  // Retention figures come only from the report. Without one they are unmeasured and read
  // Unavailable, never $0.00 and 0% (R04).
  const retention = report?.retentionTelemetry ?? null;
  // A rate needs a denominator: no abandoned checkouts or no declined upsells is not 0%.
  const checkoutRate = retention && retention.abandonedCheckoutsCount > 0 ? measuredNumber(retention.checkoutRecoveryRate) : null;
  const upsellRate = retention && retention.upsellDeclinesCount > 0 ? measuredNumber(retention.upsellRecoveryRate) : null;
  const cartAhead = checkoutRate != null && targetCartRecoveryRate != null && checkoutRate >= targetCartRecoveryRate;
  const upsellAhead = upsellRate != null && targetUpsellRescueRate != null && upsellRate >= targetUpsellRescueRate;
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const monthlyTarget = simulatedTarget ? simulatedTarget.totalRetentionRevenue : null;
  // Pace needs both a measured figure and a target above zero to measure it against.
  const pacingPercent: number | null = retention && monthlyTarget != null && monthlyTarget > 0
    ? Math.min(100, Math.round((retention.totalRetentionRevenue / monthlyTarget) * 100))
    : null;
  // Profit after product costs uses the cost the user entered in the Forecaster, never an assumed one.
  const recoveredProfit: number | null = retention && productCostPercent != null
    ? Number((retention.totalRetentionRevenue * (1 - Math.min(100, Math.max(0, productCostPercent)) / 100)).toFixed(2))
    : null;
  // Stream figures are measured only when the report carries them, and a share or a take
  // rate only when there is revenue or an order to divide by.
  const streamsMeasured = Boolean(aovExp?.streams);
  const streamShareMeasured = streamsMeasured && (aovExp?.combinedRevenue || 0) > 0;
  const streamTakeMeasured = streamsMeasured && totalOrders > 0;
  // The streams' combined revenue, else the summary's (as before), else unmeasured.
  const combinedRevenue = measuredNumber(aovExp?.combinedRevenue);
  const totalAttributed = combinedRevenue ? combinedRevenue : (measuredNumber(summary?.totalRevenue) ?? combinedRevenue);

  return (
    <div style={{
      flex: 1,
      height: '100%',
      overflowY: 'auto',
      backgroundColor: '#090D16',
      color: '#F8FAFC',
      padding: '28px 36px',
      display: 'flex',
      flexDirection: 'column',
      gap: '28px'
    }}>
      {/* Top Header & Model Selector */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        paddingBottom: '20px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #10B981, #6366F1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <BarChart3 size={18} color="#FFFFFF" />
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Closed-Loop Attribution & Revenue Intelligence
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
            Ad clicks, page views, email sends, and email clicks sit on the same path. Channel still comes from the ad click, the page, or the email. A discount code stays on the order.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#cbd5e1' }}>
            Page views {report?.touchCounts?.pageViews ?? missingText} · Email sends {report?.touchCounts?.emailSends ?? missingText} · Email clicks {report?.touchCounts?.emailClicks ?? missingText}
          </p>
        </div>

        {/* Wraps, so Export CSV and Shopify drop to a new line on a phone instead of sitting
            off-screen past a sideways scroll (R03). */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Attribution Model Switcher */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            padding: '4px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            {(['last_touch', 'first_touch', 'linear'] as AttributionModelType[]).map(m => (
              <button
                key={m}
                onClick={() => setModel(m)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  transition: 'all 0.15s ease',
                  backgroundColor: model === m ? '#6366F1' : 'transparent',
                  color: model === m ? '#FFFFFF' : '#94A3B8'
                }}
              >
                {m === 'last_touch' ? 'Last-Touch' : m === 'first_touch' ? 'First-Touch' : 'Linear Multi-Touch'}
              </button>
            ))}
          </div>

          {/* Timeframe Selector */}
          <select
            value={timeframe}
            onChange={e => setTimeframe(e.target.value as any)}
            style={{
              padding: '7px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              color: '#F8FAFC',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <option value="7d" style={{ backgroundColor: '#0F172A' }}>Last 7 Days</option>
            <option value="30d" style={{ backgroundColor: '#0F172A' }}>Last 30 Days</option>
            <option value="all" style={{ backgroundColor: '#0F172A' }}>All Time</option>
          </select>

          {/* Export CSV Button */}
          <button
            onClick={handleDownloadCsv}
            disabled={downloadingCsv}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#CBD5E1',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <Download size={13} />
            <span>{downloadingCsv ? 'Exporting...' : 'Export CSV'}</span>
          </button>

          {/* Simulator Shortcut */}
          {onOpenShopifySync && (
            <button
              onClick={onOpenShopifySync}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(59, 130, 246, 0.2))',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#34D399',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <Zap size={13} />
              <span>Shopify</span>
            </button>
          )}
        </div>
      </div>

      {failed && (
        <div role="alert" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '12px 16px',
          borderRadius: '10px',
          backgroundColor: 'rgba(248, 113, 113, 0.08)',
          border: '1px solid rgba(248, 113, 113, 0.35)',
          color: '#FECACA',
          fontSize: '13px'
        }}>
          <span>Attribution numbers for this range are unavailable because the report could not be loaded.</span>
          <button
            type="button"
            onClick={() => { fetchAttribution(); }}
            style={{
              padding: '6px 12px',
              borderRadius: '7px',
              border: '1px solid rgba(248, 113, 113, 0.5)',
              background: 'transparent',
              color: '#FECACA',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Executive KPI Stat Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
        gap: '16px'
      }}>
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Attributed Gross Revenue
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#34D399' }}>
              {measuredRevenue != null ? `$${measuredRevenue.toLocaleString()}` : missingText}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981' }}>
              ({modelLabel})
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            {summary ? `From ${summary.totalOrders || 0} verified customer orders` : 'Orders not loaded'}
          </span>
        </div>

        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Blended ROAS
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#F1F5F9' }}>
              {measuredRoas != null ? `${measuredRoas}x` : missingText}
            </span>
            {summary && (
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8' }}>
                {measuredRoas != null ? 'Revenue / spend' : 'No spend'}
              </span>
            )}
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            Ad Spend: {measuredSpend != null ? `$${measuredSpend}` : missingText} across channels
          </span>
        </div>

        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Customer Acquisition Cost (CAC)
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#818CF8' }}>
              {measuredCac != null ? `$${measuredCac.toFixed(2)}` : missingText}
            </span>
            {effectiveAov != null && (
              <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                vs ${effectiveAov.toFixed(2)} AOV
              </span>
            )}
          </div>
          <span style={{ fontSize: '11px', color: aovLiftDollars > 0 ? '#34D399' : '#64748B' }}>
            {aovLiftDollars > 0 ? `+$${aovLiftDollars.toFixed(2)} (+${aovLiftPercent.toFixed(1)}%) expansion lift` : 'Spend divided by orders in this window'}
          </span>
        </div>

        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Repeat Buyer Retention
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#F472B6' }}>
              {measuredRepeatRate != null ? `${measuredRepeatRate}%` : missingText}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>
              From orders in this window
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            Customers with 2+ verified orders
          </span>
        </div>
      </div>

      {/* Retention Safety Nets & Courtesy Lift Showcase Card. Only on a journey with a checkout
          or an upsell to recover from (T05). */}
      {showRecovery && (
      <div style={{
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.95) 40%, rgba(16, 185, 129, 0.08) 100%)',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        borderRadius: '14px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
          paddingBottom: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #F59E0B, #10B981)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Sparkles size={15} color="#FFFFFF" />
              </div>
              <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em', color: '#F8FAFC' }}>
                ✦ Retention Safety Nets & Courtesy Lift
              </h2>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
              Orders that came back after a checkout was left or an upsell was declined, and the revenue from them.
            </p>
          </div>
        </div>

        {/* Top 3 Summary Pillars */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
          gap: '14px'
        }}>
          {/* Pillar 1: Total Reclaimed Revenue */}
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Realized Reclaimed Revenue
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '24px', fontWeight: 800, color: '#34D399', fontFamily: 'monospace' }}>
                {retention ? money(retention.totalRetentionRevenue) : missingText}
              </span>
              {retention && (
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  ({retention.totalRetentionOrders} {retention.totalRetentionOrders === 1 ? 'order' : 'orders'})
                </span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: '#CBD5E1' }}>
              From abandoned carts & courtesy upsells
            </span>
          </div>

          {/* Pillar 2: Net Profit Saved */}
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Net Profit Saved
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '24px', fontWeight: 800, color: '#F8FAFC', fontFamily: 'monospace' }}>
                {recoveredProfit != null ? money(recoveredProfit) : missingText}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#CBD5E1' }}>
              {productCostPercent != null
                ? `Reclaimed revenue less your ${productCostPercent}% product cost from the Forecaster`
                : 'Enter your product cost in the Forecaster to see this.'}
            </span>
          </div>

          {/* Pillar 3: Forecast Benchmark Pacing */}
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Simulator Target Benchmark
              </span>
              {monthlyTarget != null && (
                <span style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  color: '#A5B4FC',
                  fontWeight: 700
                }}>
                  Saved Model
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '24px', fontWeight: 800, color: monthlyTarget != null ? '#FBBF24' : '#F8FAFC', fontFamily: 'monospace' }}>
                {monthlyTarget != null
                  ? `$${monthlyTarget.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : 'Unavailable'}
              </span>
              {monthlyTarget != null && (
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  /mo modeled target
                </span>
              )}
            </div>
            {monthlyTarget == null ? (
              <span style={{ fontSize: '11px', color: '#CBD5E1' }}>
                Save a forecast in the Forecaster to set this target.
              </span>
            ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${pacingPercent ?? 0}%`,
                  backgroundColor: (pacingPercent ?? 0) >= 100 ? '#10B981' : (pacingPercent ?? 0) >= 50 ? '#F59E0B' : '#6366F1',
                  borderRadius: '3px',
                  transition: 'width 0.4s ease'
                }} />
              </div>
              <span style={{ fontSize: '11px', color: '#E2E8F0', fontWeight: 700 }}>
                {pacingPercent != null ? `${pacingPercent}% Pace` : `Pace ${missingText}`}
              </span>
            </div>
            )}
          </div>
        </div>

        {/* Dual Flow Performance: Cart Abandonment vs 24h Upsell Rescue */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
          gap: '14px'
        }}>
          {/* Flow 1: Cart Abandonment Recovery */}
          {hasCheckoutStep && (
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FBBF24'
                }}>
                  <ShoppingCart size={13} />
                </div>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#F8FAFC' }}>
                    Checkout Cart Recovery
                  </h4>
                  <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                    Triggered by checkout abandonment webhook
                  </span>
                </div>
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: cartAhead ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: cartAhead ? '#34D399' : '#CBD5E1',
                border: cartAhead ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {checkoutRate != null ? `${checkoutRate}% Recovery Rate` : retention ? 'No abandoned checkouts' : `Recovery rate ${missingText}`}
              </span>
            </div>

            <div style={{
              display: 'grid',
              // Three across when there is room; on a phone a long figure such as Unavailable
              // drops to the next row instead of spilling past the card.
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(96px, 100%), 1fr))',
              gap: '8px',
              padding: '10px',
              borderRadius: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Abandoned</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#E2E8F0' }}>
                  {retention ? retention.abandonedCheckoutsCount : missingText}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Recovered</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#34D399' }}>
                  {retention ? `${retention.recoveredCheckoutsCount} units` : missingText}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Reclaimed $</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#FBBF24', fontFamily: 'monospace' }}>
                  {retention ? money(retention.recoveredCheckoutRevenue) : missingText}
                </div>
              </div>
            </div>

            {targetCartRecoveryRate != null && (
              <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 8px' }}>
                <span>Target Benchmark: <strong>{targetCartRecoveryRate}%</strong></span>
                {checkoutRate != null && (
                  <span style={{ color: cartAhead ? '#34D399' : '#FBBF24' }}>
                    {cartAhead ? '✦ Outperforming model' : `Pacing (${checkoutRate}% vs ${targetCartRecoveryRate}%)`}
                  </span>
                )}
              </div>
            )}
          </div>

          )}

          {/* Flow 2: 24h Courtesy Upsell Rescue */}
          {hasUpsellStep && (
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#34D399'
                }}>
                  <Mail size={13} />
                </div>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#F8FAFC' }}>
                    24-Hour Courtesy Upsell Rescue
                  </h4>
                  <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                    Targeted at buyers who declined initial 1-click upsell
                  </span>
                </div>
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: upsellAhead ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: upsellAhead ? '#34D399' : '#CBD5E1',
                border: upsellAhead ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {upsellRate != null ? `${upsellRate}% Rescue Rate` : retention ? 'No declined upsells' : `Rescue rate ${missingText}`}
              </span>
            </div>

            <div style={{
              display: 'grid',
              // Three across when there is room; on a phone a long figure such as Unavailable
              // drops to the next row instead of spilling past the card.
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(96px, 100%), 1fr))',
              gap: '8px',
              padding: '10px',
              borderRadius: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Declined OTO</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#E2E8F0' }}>
                  {retention ? retention.upsellDeclinesCount : missingText}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Rescued</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#34D399' }}>
                  {retention ? `${retention.recoveredUpsellOrders} units` : missingText}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#94A3B8', textTransform: 'uppercase' }}>Reclaimed $</span>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#FBBF24', fontFamily: 'monospace' }}>
                  {retention ? money(retention.recoveredUpsellRevenue) : missingText}
                </div>
              </div>
            </div>

            {targetUpsellRescueRate != null && (
              <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px 8px' }}>
                <span>Target Benchmark: <strong>{targetUpsellRescueRate}%</strong></span>
                {upsellRate != null && (
                  <span style={{ color: upsellAhead ? '#34D399' : '#FBBF24' }}>
                    {upsellAhead ? '✦ Outperforming model' : `Pacing (${upsellRate}% vs ${targetUpsellRescueRate}%)`}
                  </span>
                )}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Measured zero-state. It states what the report found and claims nothing about
            what is connected or listening, and it never shows without a report (R04). */}
        {retention && retention.totalRetentionOrders === 0 && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            border: '1px dashed rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            color: '#CBD5E1'
          }}>
            <ShieldCheck size={14} color="#FBBF24" />
            <span>No recovered checkouts or rescued upsells in this window.</span>
          </div>
        )}
      </div>
      )}

      {/* Funnel Revenue Streams & AOV Expansion Section. Only on a journey that sells something. */}
      {sellsOffers && (
      <div style={{
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '14px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Section Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          paddingBottom: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #EC4899, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Sparkles size={14} color="#FFFFFF" />
              </div>
              <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
                Funnel Revenue Streams & AOV Expansion
              </h2>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
              Realized closed-loop revenue by offer tier and incremental average order value (AOV) lift.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '9999px',
              backgroundColor: aovLiftDollars > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: aovLiftDollars > 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
              color: aovLiftDollars > 0 ? '#34D399' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 700
            }}>
              <ArrowUpRight size={13} />
              <span>
                {aovLiftDollars > 0 ? `+${aovLiftPercent.toFixed(1)}% Blended AOV Expansion` : baseAov == null ? `AOV lift ${missingText}` : 'Baseline Offer Active'}
              </span>
            </span>
          </div>
        </div>

        {/* AOV Progression Banner */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
          gap: '16px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '10px',
          padding: '16px 20px'
        }}>
          {/* Base AOV */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Base Front-End AOV
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, color: '#F8FAFC' }}>
                {baseAov != null ? `$${baseAov.toFixed(2)}` : missingText}
              </span>
              <span style={{ fontSize: '11px', color: '#64748B' }}>
                per initial buyer
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#818CF8' }}>
              Core front-end product only
            </span>
          </div>

          {/* Incremental Lift */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Incremental Add-On Value
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, color: '#34D399' }}>
                {baseAov != null ? `+$${aovLiftDollars.toFixed(2)}` : missingText}
              </span>
              {baseAov != null && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#10B981' }}>
                  ({aovLiftPercent > 0 ? `+${aovLiftPercent.toFixed(1)}%` : '0%'} lift)
                </span>
              )}
            </div>
            <span style={{ fontSize: '11px', color: (aovExp?.recoveredUpsellRevenue || 0) > 0 ? '#34D399' : '#64748B' }}>
              {(aovExp?.recoveredUpsellRevenue || 0) > 0 ? `Includes $${(aovExp?.recoveredUpsellRevenue || 0).toFixed(2)} recovered via courtesy flow` : 'Generated via bumps & post-purchase OTOs'}
            </span>
          </div>

          {/* Effective Blended AOV */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Effective Blended AOV
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '22px', fontWeight: 800, color: '#A78BFA' }}>
                {effectiveAov != null ? `$${effectiveAov.toFixed(2)}` : missingText}
              </span>
              <span style={{ fontSize: '11px', color: '#64748B' }}>
                realized per customer
              </span>
            </div>
            {allowableCac != null && (
              <span style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>
                Allowable CAC: up to ${allowableCac.toFixed(2)} at your {productCostShare}% product cost
              </span>
            )}
          </div>
        </div>

        {/* 4-Tier Stream Breakdown Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
          gap: '14px'
        }}>
          {streams.map((stream) => {
            const isCore = stream.tier === 'core';
            const isBump = stream.tier === 'bump';
            const isUpsell = stream.tier === 'upsell';

            const accentColor = isCore ? '#818CF8' : isBump ? '#34D399' : isUpsell ? '#A78BFA' : '#F472B6';
            const tagLabel = isCore ? 'Core Product' : isBump ? 'Checkout Bump' : isUpsell ? '1-Click OTO' : 'Downsell OTO';

            return (
              <div
                key={stream.tier}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: `${accentColor}20`,
                    color: accentColor,
                    border: `1px solid ${accentColor}40`
                  }}>
                    {tagLabel}
                  </span>
                  {streamShareMeasured && stream.percentageOfTotal !== null && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8' }}>
                      {stream.percentageOfTotal.toFixed(1)}% share
                    </span>
                  )}
                </div>

                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 4px', color: '#F8FAFC' }}>
                    {stream.name}
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#F8FAFC' }}>
                      {streamsMeasured ? money(stream.revenue) : missingText}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  paddingTop: '8px',
                  fontSize: '11px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
                    <span>{isCore ? 'Orders Placed:' : 'Offer Takes:'}</span>
                    <strong style={{ color: '#E2E8F0' }}>
                      {!streamsMeasured ? missingText : isCore ? `${stream.orderCount} units` : streamTakeMeasured ? `${stream.orderCount} (${stream.attachRate}% take)` : stream.orderCount}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
                    <span>AOV Contribution:</span>
                    <strong style={{ color: accentColor }}>
                      {!streamTakeMeasured || stream.aovContribution === null ? missingText : isCore ? `$${stream.aovContribution.toFixed(2)}` : `+$${stream.aovContribution.toFixed(2)}`}
                    </strong>
                  </div>

                  {isUpsell && Boolean(stream.recoveredRevenue || stream.recoveredOrders || stream.totalDeclines) && (
                    <div style={{
                      marginTop: '6px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                        <span style={{ color: '#34D399', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Mail size={11} />
                          Post-Purchase Recovery:
                        </span>
                        <strong style={{ color: '#F8FAFC' }}>
                          ${(stream.recoveredRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                        {stream.recoveredOrders || 0} takes{stream.recoveryRate != null ? ` (${stream.recoveryRate}% recovery rate from ${stream.totalDeclines || 0} initial declines)` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Proportional Revenue Distribution Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8' }}>
            <span>Funnel Revenue Stream Allocation</span>
            <span>Total Attributed: {totalAttributed != null ? money(totalAttributed) : missingText}</span>
          </div>

          <div style={{
            height: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
            borderRadius: '9999px',
            overflow: 'hidden',
            display: 'flex'
          }}>
            {streams.map((stream) => {
              const width = streamShareMeasured && stream.percentageOfTotal !== null ? Math.max(0, stream.percentageOfTotal) : 0;
              if (width <= 0) return null;
              const color = stream.tier === 'core' ? '#818CF8' : stream.tier === 'bump' ? '#34D399' : stream.tier === 'upsell' ? '#A78BFA' : '#F472B6';
              return (
                <div
                  key={stream.tier}
                  style={{
                    height: '100%',
                    width: `${width}%`,
                    backgroundColor: color,
                    transition: 'width 0.4s ease'
                  }}
                  title={`${stream.name}: $${stream.revenue.toFixed(2)} (${stream.percentageOfTotal}%)`}
                />
              );
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#818CF8' }} />
              <span>Core Product</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34D399' }} />
              <span>Order Bump</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#A78BFA' }} />
              <span>1-Click Upsell</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F472B6' }} />
              <span>Downsell Recovery</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Channel Breakdown Table. It does not clip: in this scrolling column a clipping card may
          shrink to its borders (the whole table was 2px tall), and clipping cut off the focus
          ring of the table's scroller. The scroller rounds its own bottom corners instead. */}
      <div style={{
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        flexShrink: 0
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="#818CF8" />
            <h2 id={channelTableTitleId} style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
              Acquisition & Conversion Channel Breakdown
            </h2>
          </div>

          {/* Wraps on a phone, where the three view buttons and the model label are wider than the card. */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            {/* Table View Switcher. A lead journey has only the acquisition view, so no switcher. */}
            {sellsOffers && (
            <div role="group" aria-label="Table view" style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <button
                type="button"
                aria-pressed={channelViewMode === 'offers'}
                onClick={() => setChannelViewMode('offers')}
                style={{
                  flex: '1 1 auto',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: channelViewMode === 'offers' ? '#8B5CF6' : 'transparent',
                  color: channelViewMode === 'offers' ? '#FFFFFF' : '#94A3B8',
                  transition: 'all 0.15s ease'
                }}
              >
                Offer & AOV Lift
              </button>
              <button
                type="button"
                aria-pressed={channelViewMode === 'roi'}
                onClick={() => setChannelViewMode('roi')}
                style={{
                  flex: '1 1 auto',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: channelViewMode === 'roi' ? '#6366F1' : 'transparent',
                  color: channelViewMode === 'roi' ? '#FFFFFF' : '#94A3B8',
                  transition: 'all 0.15s ease'
                }}
              >
                Acquisition ROI
              </button>
              <button
                type="button"
                aria-pressed={channelViewMode === 'all'}
                onClick={() => setChannelViewMode('all')}
                style={{
                  flex: '1 1 auto',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: channelViewMode === 'all' ? '#10B981' : 'transparent',
                  color: channelViewMode === 'all' ? '#FFFFFF' : '#94A3B8',
                  transition: 'all 0.15s ease'
                }}
              >
                All Metrics
              </button>
            </div>
            )}

            <span style={{ fontSize: '11px', color: '#64748B' }}>
              Model: <strong style={{ color: '#E2E8F0' }}>{modelLabel}</strong>
            </span>
          </div>
        </div>

        <div
          ref={channelScrollRef}
          role="region"
          aria-labelledby={channelTableTitleId}
          tabIndex={channelTableScrolls ? 0 : undefined}
          style={{ overflowX: 'auto', borderRadius: '0 0 11px 11px' }}
        >
          <table aria-labelledby={channelTableTitleId} style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#94A3B8',
                textAlign: 'left'
              }}>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Channel</th>
                {tableMode !== 'offers' && (
                  <>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>Ad Spend</th>
                    {tableMode === 'roi' && (
                      <>
                        <th style={{ padding: '12px 14px', fontWeight: 600 }}>Clicks</th>
                        <th style={{ padding: '12px 14px', fontWeight: 600 }}>Leads</th>
                      </>
                    )}
                  </>
                )}
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>Orders</th>
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>Attributed Revenue</th>
                {tableMode !== 'roi' && (
                  <>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>Base AOV</th>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>Blended AOV</th>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>AOV Expansion Lift</th>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>Order Bump Attach</th>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>1-Click OTO Attach</th>
                  </>
                )}
                <th style={{ padding: '12px 14px', fontWeight: 600 }}>ROAS</th>
                {tableMode !== 'offers' && (
                  <>
                    <th style={{ padding: '12px 14px', fontWeight: 600 }}>CAC</th>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>CVR</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {report?.channels.map(ch => {
                const topAovChannelId = report?.channels.reduce((best: string | null, curr) => {
                  const currOrders = curr.orders || 0;
                  const currLift = curr.aovLift || 0;
                  if (currOrders > 0 && currLift > 0) {
                    if (!best) return curr.channelId;
                    const bestChannel = report.channels.find(c => c.channelId === best);
                    if ((bestChannel?.aovLift || 0) < currLift) return curr.channelId;
                  }
                  return best;
                }, null);

                const isTopLift = ch.channelId === topAovChannelId && (ch.aovLift || 0) > 0;
                const baseVal = ch.baseAov ?? (ch.orders > 0 ? ch.revenue / ch.orders : 0);
                const aovVal = ch.aov ?? (ch.orders > 0 ? ch.revenue / ch.orders : 0);
                const liftVal = ch.aovLift ?? Math.max(0, aovVal - baseVal);
                const liftPct = baseVal > 0 ? ((liftVal / baseVal) * 100).toFixed(1) : '0';
                // A channel with no orders has no AOV, lift, attach rate or CAC to show, and one
                // with no clicks has no conversion rate: those cells read Unavailable, not 0 (R04).
                const hasOrders = ch.orders > 0;
                const unmeasured = <span style={{ color: '#64748B' }}>{missingText}</span>;

                return (
                  <tr 
                    key={ch.channelId}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: getChannelColor(ch.channelId)
                      }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#F8FAFC' }}>{ch.channelName}</span>
                        {isTopLift && (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            color: '#34D399',
                            border: '1px solid rgba(16, 185, 129, 0.3)'
                          }}>
                            Top AOV Lift
                          </span>
                        )}
                      </div>
                    </td>

                    {tableMode !== 'offers' && (
                      <>
                        <td style={{ padding: '14px 14px', color: '#CBD5E1' }}>${ch.spend.toFixed(2)}</td>
                        {tableMode === 'roi' && (
                          <>
                            <td style={{ padding: '14px 14px', color: '#94A3B8' }}>{ch.clicks.toLocaleString()}</td>
                            <td style={{ padding: '14px 14px', color: '#CBD5E1' }}>{ch.leads}</td>
                          </>
                        )}
                      </>
                    )}

                    <td style={{ padding: '14px 14px', fontWeight: 700, color: '#F8FAFC' }}>{ch.orders}</td>
                    <td style={{ padding: '14px 14px', fontWeight: 800, color: '#34D399' }}>${ch.revenue.toLocaleString()}</td>

                    {tableMode !== 'roi' && (
                      <>
                        <td style={{ padding: '14px 14px', color: '#94A3B8' }}>{hasOrders ? `$${baseVal.toFixed(2)}` : unmeasured}</td>
                        <td style={{ padding: '14px 14px', fontWeight: 700, color: '#A78BFA' }}>
                          {hasOrders ? `$${aovVal.toFixed(2)}` : unmeasured}
                        </td>
                        <td style={{ padding: '14px 14px' }}>
                          {liftVal > 0 ? (
                            <span style={{ color: '#34D399', fontWeight: 700, fontSize: '12px' }}>
                              +${liftVal.toFixed(2)}
                              <span style={{ fontSize: '11px', color: '#10B981', marginLeft: '3px' }}>
                                (+{liftPct}%)
                              </span>
                            </span>
                          ) : (
                            hasOrders ? <span style={{ color: '#64748B' }}>$0.00</span> : unmeasured
                          )}
                        </td>
                        <td style={{ padding: '14px 14px' }}>
                          {(ch.bumpOrders || 0) > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ color: '#34D399', fontWeight: 700 }}>{ch.bumpAttachRate != null ? `${ch.bumpAttachRate}%` : missingText}</span>
                              <span style={{ fontSize: '11px', color: '#94A3B8' }}>{ch.bumpOrders} {ch.bumpOrders === 1 ? 'order' : 'orders'}</span>
                            </div>
                          ) : (
                            hasOrders ? <span style={{ color: '#64748B' }}>0%</span> : unmeasured
                          )}
                        </td>
                        <td style={{ padding: '14px 14px' }}>
                          {(ch.upsellTakes || 0) > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ color: '#A78BFA', fontWeight: 700 }}>{ch.upsellAttachRate != null ? `${ch.upsellAttachRate}%` : missingText}</span>
                              <span style={{ fontSize: '11px', color: '#94A3B8' }}>{ch.upsellTakes} {ch.upsellTakes === 1 ? 'take' : 'takes'}</span>
                            </div>
                          ) : (
                            hasOrders ? <span style={{ color: '#64748B' }}>0%</span> : unmeasured
                          )}
                        </td>
                      </>
                    )}

                    <td style={{ padding: '14px 14px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: (ch.roas ?? 0) >= 3 ? 'rgba(16, 185, 129, 0.15)' : (ch.roas ?? 0) >= 1.5 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                        color: (ch.roas ?? 0) >= 3 ? '#34D399' : (ch.roas ?? 0) >= 1.5 ? '#818CF8' : '#94A3B8'
                      }}>
                        {ch.spend > 0 ? (ch.roas === null ? missingText : `${ch.roas}x`) : 'No spend'}
                      </span>
                    </td>

                    {tableMode !== 'offers' && (
                      <>
                        <td style={{ padding: '14px 14px', color: '#CBD5E1' }}>
                          {hasOrders && ch.cac !== null ? `$${ch.cac.toFixed(2)}` : missingText}
                        </td>
                        <td style={{ padding: '14px 20px', color: '#94A3B8' }}>{ch.clicks > 0 ? `${ch.conversionRate}%` : missingText}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {/* Without a report the table still says so, rather than headers over nothing. */}
              {!report?.channels?.length && (
                <tr>
                  <td
                    colSpan={tableMode === 'all' ? 12 : 9}
                    style={{ padding: '14px 20px', color: '#94A3B8' }}
                  >
                    {/* Stays in sight while the table is scrolled sideways. */}
                    <span style={{ position: 'sticky', left: '20px', display: 'inline-block' }}>
                      {report ? 'No channels in this range.' : missingText}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-Column Grid: Journey Leak Finder & Live Attributions Stream */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
        gap: '24px'
      }}>
        <JourneyLeakFinder journeyId={journeyId} nodes={nodes} edges={edges} timeframe={timeframe} onSelectStep={onSelectStep} />

        {/* Live Attributions Stream */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="#EC4899" />
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>
                Recent Attributed Purchases
              </h3>
            </div>
            <span style={{ fontSize: '11px', color: '#64748B' }}>Verified Closed-Loop</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {report?.recentAttributions.map(att => (
              <div
                key={att.orderId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{att.orderNumber}</span>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(99, 102, 241, 0.2)',
                      color: '#818CF8',
                      fontWeight: 600
                    }}>
                      {att.channel}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#94A3B8' }}>{att.customerEmail}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <span style={{ fontWeight: 800, color: '#34D399', fontSize: '13px' }}>
                    +${att.amount.toFixed(2)}
                  </span>
                  <span style={{ fontSize: '11px', color: '#64748B' }}>
                    {att.touchpointCount} {att.touchpointCount === 1 ? 'touchpoint' : 'touchpoints'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
