import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, Gift, CheckCircle2, Repeat, ExternalLink } from 'lucide-react';
import type { ThankYouNodeData } from '../../../types/journey';

export const ThankYouNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as ThankYouNodeData;
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  const views = d.pageViews || 320;
  const claims = d.bounceBackClaims || 48;
  const claimRate = views > 0 ? ((claims / views) * 100).toFixed(1) : '15.0';
  const stepsCount = (d.usageGuideSteps || []).length || 3;

  return (
    <div
      style={{
        width: '260px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.92)',
        border: selected
          ? '1.5px solid #EC4899'
          : '1px solid rgba(236, 72, 153, 0.25)',
        boxShadow: selected
          ? '0 0 20px rgba(236, 72, 153, 0.35)'
          : '0 10px 25px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Target Handle (from Landing Page / Form) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F472B6' }}>
            <Sparkles size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F472B6' }}>
              VIP Thank You
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              /{d.slug || 'thank-you'}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: 'rgba(236, 72, 153, 0.18)',
            color: '#F472B6',
            fontWeight: 700
          }}
        >
          {d.badgeText || 'VIP Portal'}
        </span>
      </div>

      {/* Content Preview */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {d.headline || 'Your VIP Allocation is Confirmed'}
        </div>

        {/* Bounce-Back Offer Badge */}
        <div style={{ background: 'rgba(236, 72, 153, 0.08)', border: '1px dashed rgba(236, 72, 153, 0.3)', borderRadius: '6px', padding: '6px 8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Gift size={11} color="#F472B6" /> Bounce-Back:
            </span>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#FFFFFF', fontFamily: 'monospace' }}>
              {d.bounceBackDiscountCode || 'VIPRETURN'}
            </span>
          </div>
          <div style={{ fontSize: '9px', color: '#CBD5E1', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.bounceBackDiscountText || '$15 off next order'}
          </div>
        </div>

        {/* Ritual Guide Indicator */}
        <div style={{ fontSize: '10px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <CheckCircle2 size={11} color="#34D399" />
          <span>Includes {stepsCount}-Step Beauty Ritual Guide</span>
        </div>
      </div>

      {/* Metrics Bar */}
      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B' }}>Views</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
            {views.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B' }}>Re-Orders</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F472B6' }}>
            {claims}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B' }}>Re-Order Rate</div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>
            {claimRate}%
          </div>
        </div>
      </div>
    </div>
  );
};
