import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layout, GitFork, Clock, TrendingUp } from 'lucide-react';
import type { PageNodeData } from '../../../types/journey';

export const PageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as PageNodeData;
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  const visitors = d.visitors || 850;
  const conv = d.conversions || 34;
  const aov = d.aov || 48;
  const bumpTakes = d.orderBumpTakes || (d.orderBumpEnabled ? Math.round(conv * 0.35) : 0);
  const bumpPrice = Number(d.orderBumpPrice || 18);
  const bumpRev = d.orderBumpRevenue || (bumpTakes * bumpPrice);
  const grossRev = d.grossRevenue || (conv * aov + bumpRev);
  const bumpRate = conv > 0 ? Math.round((bumpTakes / conv) * 100) : 35;

  // A/B test comparative calculations
  const isAbActive = Boolean(d.abTestingEnabled);
  const splitRatio = d.splitRatio ?? 50;
  const varAVis = d.variantAVisitors ?? Math.round(visitors * (splitRatio / 100));
  const varBVis = d.variantBVisitors ?? Math.max(0, visitors - varAVis);
  const varAConv = d.variantAConversions ?? Math.round(conv * 0.44);
  const varBConv = d.variantBConversions ?? Math.max(0, conv - varAConv);
  const varARate = varAVis > 0 ? ((varAConv / varAVis) * 100).toFixed(1) : '0.0';
  const varBRate = varBVis > 0 ? ((varBConv / varBVis) * 100).toFixed(1) : '0.0';
  const isBLeading = parseFloat(varBRate) > parseFloat(varARate);
  const isALeading = parseFloat(varARate) > parseFloat(varBRate);

  return (
    <div
      style={{
        width: isAbActive ? '280px' : '260px',
        borderRadius: '12px',
        background: isRoasMode ? 'rgba(11, 15, 25, 0.95)' : 'rgba(15, 23, 42, 0.9)',
        border: selected
          ? '1.5px solid #6366F1'
          : isAbActive
          ? '1px solid rgba(236, 72, 153, 0.4)'
          : isRoasMode
          ? '1px solid rgba(16, 185, 129, 0.3)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: selected
          ? '0 0 20px rgba(99, 102, 241, 0.3)'
          : isAbActive
          ? '0 10px 25px rgba(236, 72, 153, 0.15)'
          : '0 10px 25px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Target Handle (from Ad) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: isRoasMode ? 'rgba(16, 185, 129, 0.15)' : isAbActive ? 'rgba(236, 72, 153, 0.15)' : 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isRoasMode ? '#34D399' : isAbActive ? '#F472B6' : '#818CF8' }}>
            <Layout size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: isRoasMode ? '#34D399' : isAbActive ? '#F472B6' : '#818CF8' }}>
              {isRoasMode ? 'Offer Revenue' : 'Landing Page'}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              /{d.slug || 'offer'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isAbActive && (
            <span
              style={{
                fontSize: '9px',
                padding: '2px 6px',
                borderRadius: '9999px',
                background: 'rgba(236, 72, 153, 0.2)',
                border: '1px solid rgba(236, 72, 153, 0.4)',
                color: '#F472B6',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '3px'
              }}
            >
              <GitFork size={10} />
              A/B {splitRatio}/{100 - splitRatio}
            </span>
          )}
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '9999px',
              background: isRoasMode ? 'rgba(16, 185, 129, 0.25)' : 'rgba(56, 189, 248, 0.15)',
              color: isRoasMode ? '#34D399' : '#38BDF8',
              fontWeight: 700
            }}
          >
            {isRoasMode ? `AOV: $${aov}` : (d.customDomain ? 'Custom Domain' : 'Published')}
          </span>
        </div>
      </div>

      {/* Content Preview / Financial Breakdown */}
      {isRoasMode ? (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94A3B8' }}>Gross Funnel Sales:</span>
            <span style={{ fontWeight: 800, color: '#34D399' }}>${grossRev.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#64748B' }}>Order Bump Boost:</span>
            <span style={{ color: '#F472B6', fontWeight: 700 }}>+${bumpRev} ({bumpRate}% accept)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#64748B' }}>Purchases:</span>
            <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{conv} Orders</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.headline || 'Offer Page'}
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.subhead || 'Clean single-offer landing page.'}
          </div>

          {(d.urgencyTimerEnabled || d.scarcityBatchEnabled) && (
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#FBCFE8', background: 'rgba(236, 72, 153, 0.1)', padding: '3px 7px', borderRadius: '6px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
              <Clock size={11} color="#F472B6" />
              <span>
                {d.urgencyTimerEnabled && d.scarcityBatchEnabled
                  ? `Urgency: ${d.urgencyMinutes || 15}m Timer + Stock Batch`
                  : d.urgencyTimerEnabled
                  ? `Urgency: ${d.urgencyMinutes || 15}m Reservation Timer`
                  : `Scarcity: ${d.scarcityBatchCount || 14} Units Left`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* A/B Testing Comparative Pod if Active */}
      {isAbActive && (
        <div style={{ padding: '8px 14px', background: 'rgba(236, 72, 153, 0.05)', borderTop: '1px dashed rgba(236, 72, 153, 0.25)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Split Test Leader
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#34D399', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <TrendingUp size={11} />
              {isBLeading ? 'Variant B +Lift' : isALeading ? 'Variant A Leading' : 'Even Split'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '5px 8px', borderRadius: '6px', border: isALeading ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94A3B8' }}>
                <span>Var A (Ctrl)</span>
                <span style={{ fontWeight: 700, color: isALeading ? '#34D399' : '#E2E8F0' }}>{varARate}%</span>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F8FAFC', marginTop: '2px' }}>
                {varAConv} <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748B' }}>/ {varAVis}</span>
              </div>
            </div>
            <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '5px 8px', borderRadius: '6px', border: isBLeading ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94A3B8' }}>
                <span>Var B (Test)</span>
                <span style={{ fontWeight: 700, color: isBLeading ? '#34D399' : '#E2E8F0' }}>{varBRate}%</span>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#F8FAFC', marginTop: '2px' }}>
                {varBConv} <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748B' }}>/ {varBVis}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Bar */}
      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {isRoasMode ? 'Revenue' : 'Visitors'}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: isRoasMode ? '#34D399' : '#F1F5F9' }}>
            {isRoasMode ? `$${grossRev}` : (d.visitors ? d.visitors.toLocaleString() : '0')}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {isRoasMode ? 'Bump' : 'Conv.'}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: isRoasMode ? '#F472B6' : '#34D399' }}>
            {isRoasMode ? `${bumpRate}%` : (d.conversions ? d.conversions.toLocaleString() : '0')}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {isRoasMode ? 'AOV' : 'Rate'}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F8FAFC' }}>
            {isRoasMode ? `$${aov}` : (d.conversionRate ? `${d.conversionRate}%` : '0%')}
          </div>
        </div>
      </div>

      {/* Source Handle (to Form) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />
    </div>
  );
};
