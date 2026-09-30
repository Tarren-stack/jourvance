import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles, Gift, CheckCircle2, Repeat, ExternalLink } from 'lucide-react';
import type { ThankYouNodeData } from '../../../types/journey';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { PublishStatusStrip } from '../PublishStatus';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';
import { countText, measureValue, percentText, rateOf } from '../../../lib/journeyMetrics';
import { stepAddress } from '../../../lib/stepNames';

export const ThankYouNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as ThankYouNodeData;
  const kind = stepKind('thank-you', d);
  // Figures come from the map's snapshot (#9). Bounce-back claims are never recorded, so they
  // and their rate always read Unavailable.
  const { measure: m, note } = useNodeMetrics(id);
  const views = measureValue(m, 'pageViews');
  const claims = measureValue(m, 'bounceBackClaims');
  const viewsText = countText(views);
  const claimsText = countText(claims);
  const claimRateText = percentText(rateOf(claims, views));
  const stepsCount = (d.usageGuideSteps || []).length;
  // Same rule as the step's spoken name and the step panel (T11): no saved address says so, muted.
  const address = stepAddress({ ...d, type: 'thank-you' });
  const name = address || 'No address yet';

  return (
    <div
      style={{
        width: '260px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.92)',
        ...cardFrame(selected, { border: '1px solid rgba(236, 72, 153, 0.25)', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)' }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Target Handle (from Landing Page / Form) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div data-jv-detail-row style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StepIcon kind={kind} icon={Sparkles} />
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#F472B6' }}>
              VIP Thank You
            </div>
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {address || <span style={{ color: '#94A3B8' }}>{name}</span>}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: 'rgba(236, 72, 153, 0.18)',
            color: '#F472B6',
            fontWeight: 700
          }}
        >
          {d.badgeText || 'Thank-you page'}
        </span>
      </div>

      <PublishStatusStrip nodeId={id} nodeType="thank-you" />

      {/* Content Preview */}
      <div data-jv-detail-row style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {d.headline || 'No headline yet'}
        </div>

        {/* Bounce-Back Offer Badge: only when the step holds a code, never an invented one */}
        {d.bounceBackDiscountCode && (
        <div style={{ background: 'rgba(236, 72, 153, 0.08)', border: '1px dashed rgba(236, 72, 153, 0.3)', borderRadius: '6px', padding: '6px 8px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Gift size={11} color="#F472B6" /> Bounce-Back:
            </span>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#FFFFFF', fontFamily: 'monospace' }}>
              {d.bounceBackDiscountCode}
            </span>
          </div>
          {d.bounceBackDiscountText && (
            <div style={{ fontSize: '11px', color: '#CBD5E1', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.bounceBackDiscountText}
            </div>
          )}
        </div>
        )}

        {/* Onboarding Guide Indicator: only when the step lists guide steps */}
        {stepsCount > 0 && (
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <CheckCircle2 size={11} color="#34D399" />
            <span>Includes {stepsCount}-Step Onboarding Guide</span>
          </div>
        )}
      </div>

      {/* Metrics Bar */}
      <div data-jv-detail-row style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>Views</div>
          <div data-metric style={metricValueStyle(viewsText, '#F1F5F9')}>
            {viewsText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>Re-Orders</div>
          <div data-metric style={metricValueStyle(claimsText, '#F472B6')}>
            {claimsText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>Re-Order Rate</div>
          <div data-metric style={metricValueStyle(claimRateText, '#34D399')}>
            {claimRateText}
          </div>
        </div>
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      <StepSummary nodeId={id} kind={kind} icon={Sparkles} name={name} figure={{ label: 'Views', value: viewsText }} />
    </div>
  );
};
