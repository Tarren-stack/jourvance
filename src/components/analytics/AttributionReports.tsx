import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, DollarSign, Users, ShoppingCart, ArrowDownRight, 
  Download, RefreshCw, Layers, ShieldCheck, CheckCircle2, Zap,
  ExternalLink, BarChart3, Filter, Clock
} from 'lucide-react';
import type { Workspace, JourneyNode, AttributionReport, AttributionModelType } from '../../types/journey';
import { authHeaders } from '../../lib/firebase';

interface Props {
  workspace: Workspace | null;
  nodes?: JourneyNode[];
  onOpenShopifySync?: () => void;
}

export const AttributionReports: React.FC<Props> = ({
  workspace,
  nodes = [],
  onOpenShopifySync
}) => {
  const [model, setModel] = useState<AttributionModelType>('last_touch');
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | 'all'>('30d');
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const fetchAttribution = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/attribution?model=${model}&timeframe=${timeframe}`, {
        headers: {
          ...(await authHeaders()),
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.report) {
          setReport(data.report);
        }
      }
    } catch (err) {
      console.warn('[Jourvance] Failed fetching attribution report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttribution();
  }, [model, timeframe]);

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const res = await fetch(`/api/reports/attribution/export-csv?model=${model}&timeframe=${timeframe}`, {
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
            Page views {report?.touchCounts?.pageViews == null ? '—' : report.touchCounts.pageViews} · Email sends {report?.touchCounts?.emailSends == null ? '—' : report.touchCounts.emailSends} · Email clicks {report?.touchCounts?.emailClicks == null ? '—' : report.touchCounts.emailClicks}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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

      {/* Executive KPI Stat Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
              ${summary ? summary.totalRevenue.toLocaleString() : '0'}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981' }}>
              ({report?.model === 'first_touch' ? 'First-Touch' : report?.model === 'last_touch' ? 'Last-Touch' : 'Linear'})
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            From {summary?.totalOrders || 0} verified customer orders
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
              {summary ? `${summary.blendedRoas}x` : '0x'}
            </span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8' }}>
              {(summary?.totalSpend || 0) > 0 ? 'Revenue / spend' : 'No spend'}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            Ad Spend: ${summary?.totalSpend || 0} across channels
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
              ${summary ? summary.blendedCac.toFixed(2) : '0.00'}
            </span>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>
              vs ${summary ? summary.blendedAov.toFixed(2) : '0.00'} AOV
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            Spend divided by orders in this window
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
              {summary ? `${summary.repeatBuyerRate}%` : '0%'}
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

      {/* Channel Breakdown Table */}
      <div style={{
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="#818CF8" />
            <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
              Acquisition & Conversion Channel Breakdown
            </h2>
          </div>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            Model: <strong style={{ color: '#E2E8F0' }}>{report?.model === 'first_touch' ? 'First-Touch' : report?.model === 'last_touch' ? 'Last-Touch' : 'Linear Multi-Touch'}</strong> • Timeframe: <strong style={{ color: '#E2E8F0' }}>{timeframe}</strong>
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#94A3B8',
              textAlign: 'left'
            }}>
              <th style={{ padding: '12px 20px', fontWeight: 600 }}>Channel</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ad Spend</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Clicks</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Leads</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Orders</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Attributed Revenue</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>ROAS</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>CAC</th>
              <th style={{ padding: '12px 20px', fontWeight: 600 }}>CVR</th>
            </tr>
          </thead>
          <tbody>
            {report?.channels.map(ch => (
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
                  <span style={{ fontWeight: 600, color: '#F8FAFC' }}>{ch.channelName}</span>
                </td>
                <td style={{ padding: '14px 16px', color: '#CBD5E1' }}>${ch.spend.toFixed(2)}</td>
                <td style={{ padding: '14px 16px', color: '#94A3B8' }}>{ch.clicks.toLocaleString()}</td>
                <td style={{ padding: '14px 16px', color: '#CBD5E1' }}>{ch.leads}</td>
                <td style={{ padding: '14px 16px', fontWeight: 700, color: '#F8FAFC' }}>{ch.orders}</td>
                <td style={{ padding: '14px 16px', fontWeight: 800, color: '#34D399' }}>${ch.revenue.toLocaleString()}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    backgroundColor: ch.roas >= 3 ? 'rgba(16, 185, 129, 0.15)' : ch.roas >= 1.5 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                    color: ch.roas >= 3 ? '#34D399' : ch.roas >= 1.5 ? '#818CF8' : '#94A3B8'
                  }}>
                    {ch.spend > 0 ? `${ch.roas}x` : '—'}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', color: '#CBD5E1' }}>
                  {ch.cac > 0 ? `$${ch.cac.toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '14px 20px', color: '#94A3B8' }}>{ch.conversionRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Two-Column Grid: Funnel Dropoff Velocity & Live Attributions Stream */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '24px'
      }}>
        {/* Funnel Dropoff Velocity */}
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
              <TrendingUp size={16} color="#10B981" />
              <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>
                Funnel Velocity & Conversion Throughput
              </h3>
            </div>
            <span style={{ fontSize: '11px', color: '#64748B' }}>Full Journey Flow</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {report?.funnelSteps.map((step, idx) => (
              <div key={step.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#CBD5E1', fontWeight: 600 }}>
                    {idx + 1}. {step.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#F8FAFC', fontWeight: 700 }}>{step.count.toLocaleString()}</span>
                    {idx > 0 && (
                      <span style={{ fontSize: '10px', color: '#F43F5E', fontWeight: 600 }}>
                        (-{step.dropoffRate}%)
                      </span>
                    )}
                  </div>
                </div>
                {/* Visual Bar */}
                <div style={{
                  height: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: '9999px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.max(step.percentage, 3)}%`,
                    backgroundColor: idx === 0 ? '#6366F1' : idx === 3 ? '#EC4899' : idx >= 5 ? '#10B981' : '#3B82F6',
                    borderRadius: '9999px',
                    transition: 'width 0.4s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

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
                      fontSize: '10px',
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
                  <span style={{ fontSize: '10px', color: '#64748B' }}>
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
