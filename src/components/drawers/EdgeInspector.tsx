import React from 'react';
import { X, TrendingUp, AlertTriangle, CheckCircle2, ArrowRight, Sparkles, DollarSign, Activity, Trash2 } from 'lucide-react';
import type { JourneyEdge, JourneyNode, JourneyNodeData } from '../../types/journey';
import { getStepBenchmark, calculateRevenueLeakage, getStepOptimizationTips } from '../../lib/conversionBenchmarks';

interface Props {
  edge: JourneyEdge | null;
  sourceNode: JourneyNode | null;
  targetNode: JourneyNode | null;
  onClose: () => void;
  onSelectNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}

export const EdgeInspector: React.FC<Props> = ({
  edge,
  sourceNode,
  targetNode,
  onClose,
  onSelectNode,
  onDeleteEdge
}) => {
  if (!edge) return null;

  const edgeData = edge.data || { sourceThroughput: 0, targetCount: 0, rate: 0 };
  const sourceThroughput = edgeData.sourceThroughput || 0;
  const targetCount = edgeData.targetCount || 0;
  const rate = typeof edgeData.rate === 'number' ? edgeData.rate : 0;

  const sourceType = sourceNode?.data?.type;
  const targetType = targetNode?.data?.type;

  const sourceLabel = sourceNode?.data?.label || sourceNode?.id || 'Source Step';
  const targetLabel = targetNode?.data?.label || targetNode?.id || 'Target Step';

  const benchmark = getStepBenchmark(sourceType, targetType, rate, sourceThroughput, targetCount);

  // AOV estimation from landing page or fallback $49
  const pageNodeData = (sourceNode?.data?.type === 'landing-page' ? sourceNode.data : targetNode?.data?.type === 'landing-page' ? targetNode.data : null) as JourneyNodeData | null;
  const rawPrice = pageNodeData && 'productPrice' in pageNodeData && typeof pageNodeData.productPrice === 'string'
    ? parseFloat(pageNodeData.productPrice.replace(/[^0-9.]/g, ''))
    : 49;
  const aov = !isNaN(rawPrice) && rawPrice > 0 ? rawPrice : 49;

  const leakage = calculateRevenueLeakage(
    benchmark.dropOffCount,
    rate,
    benchmark.healthyThreshold,
    aov
  );

  const tips = getStepOptimizationTips(sourceType, targetType);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '420px',
        maxWidth: '100vw',
        background: 'rgba(15, 23, 42, 0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
        animation: 'slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: '18px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255, 255, 255, 0.02)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: benchmark.statusBg,
              border: `1px solid ${benchmark.statusBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: benchmark.statusColor
            }}
          >
            <TrendingUp size={16} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
              Step Transition Analytics
            </h3>
            <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sourceLabel}</span>
              <ArrowRight size={10} color="#64748B" />
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targetLabel}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s'
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <X size={18} />
        </button>
      </div>

      {/* Drawer Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Step Metric Highlight Card */}
        <div
          style={{
            padding: '16px',
            borderRadius: '12px',
            background: benchmark.statusBg,
            border: `1px solid ${benchmark.statusBorder}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: benchmark.statusColor }}>
                {benchmark.metricName}
              </span>
              <div style={{ fontSize: '26px', fontWeight: 800, color: '#FFFFFF', marginTop: '2px' }}>
                {sourceThroughput > 0 ? `${rate}%` : '—'}
              </div>
            </div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: '9999px',
                background: 'rgba(0, 0, 0, 0.3)',
                color: benchmark.statusColor,
                border: `1px solid ${benchmark.statusBorder}`,
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              {benchmark.status === 'top_performer' ? (
                <CheckCircle2 size={12} />
              ) : benchmark.status === 'needs_work' ? (
                <AlertTriangle size={12} />
              ) : (
                <Activity size={12} />
              )}
              <span>{benchmark.statusLabel}</span>
            </div>
          </div>

          <div style={{ fontSize: '11px', color: '#CBD5E1', lineHeight: '1.4' }}>
            {benchmark.industryBenchmarkDesc}
          </div>
        </div>

        {/* Throughput & Drop-Off 2x2 Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Step Inflow</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#F1F5F9', marginTop: '4px' }}>
              {sourceThroughput.toLocaleString()}
            </div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>
              from {sourceLabel}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Progressed</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#34D399', marginTop: '4px' }}>
              {targetCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>
              reached {targetLabel}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              backgroundColor: benchmark.dropOffRate > 75 ? 'rgba(245, 158, 11, 0.06)' : 'rgba(255, 255, 255, 0.03)',
              border: benchmark.dropOffRate > 75 ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Drop-Off Count</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: benchmark.dropOffRate > 75 ? '#FBBF24' : '#F1F5F9', marginTop: '4px' }}>
              {benchmark.dropOffCount.toLocaleString()}
            </div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>
              visitors did not advance
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              backgroundColor: benchmark.dropOffRate > 75 ? 'rgba(245, 158, 11, 0.06)' : 'rgba(255, 255, 255, 0.03)',
              border: benchmark.dropOffRate > 75 ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ fontSize: '11px', color: '#94A3B8' }}>Drop-Off Rate</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: benchmark.dropOffRate > 75 ? '#FBBF24' : '#F1F5F9', marginTop: '4px' }}>
              {sourceThroughput > 0 ? `${benchmark.dropOffRate}%` : '—'}
            </div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>
              leakage percentage
            </div>
          </div>
        </div>

        {/* Revenue Leakage Card */}
        {sourceThroughput > 0 && benchmark.dropOffCount > 0 && leakage.potentialRevenueGain > 0 && (
          <div
            style={{
              padding: '14px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.6))',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <DollarSign size={14} color="#34D399" />
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#34D399', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recoverable Revenue Opportunity
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 700 }}>
              +${leakage.potentialRevenueGain.toLocaleString()} in potential additional orders
            </div>
            <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
              Lifting this step to the healthy industry benchmark ({leakage.targetBenchmarkRate}%) would recover approx. <strong>+{leakage.potentialRecoveredConversions} conversions</strong> at an estimated ${aov.toFixed(0)} AOV.
            </div>
          </div>
        )}

        {/* Optimization Playbook */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Sparkles size={12} /> Actionable Optimization Playbook
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tips.map((tip, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>{tip.title}</span>
                  <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 6px', borderRadius: '4px', background: 'rgba(236, 72, 153, 0.15)', color: '#F472B6' }}>
                    {tip.badge}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
                  {tip.description}
                </div>
                {tip.actionText && sourceNode && onSelectNode && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectNode(sourceNode.id);
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: '4px',
                      background: 'none',
                      border: 'none',
                      color: '#38BDF8',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: 0
                    }}
                  >
                    <span>{tip.actionText}</span>
                    <ArrowRight size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Delete Edge Action */}
        {onDeleteEdge && (
          <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
            <button
              type="button"
              onClick={() => {
                if (confirm('Disconnect this step in your customer journey?')) {
                  onDeleteEdge(edge.id);
                  onClose();
                }
              }}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                background: 'rgba(239, 68, 68, 0.06)',
                color: '#EF4444',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Trash2 size={13} />
              <span>Disconnect Step Connection</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
