import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Mail, Clock, Users, ShieldAlert, Sparkles, ShoppingBag, Gift, CheckCircle, Star } from 'lucide-react';
import type { SequenceNodeData } from '../../../types/journey';
import { branchHandleStyle, isRetentionStep } from '../../../lib/edgeKinds';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { StepSummary } from '../StepSummary';
import { countText, measureValue, moneyText, retentionDelayText } from '../../../lib/journeyMetrics';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';

export const SequenceNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as SequenceNodeData;
  // Figures come from the map's snapshot (#9). A linked flow's figures cover the whole flow.
  const { measure: m, note } = useNodeMetrics(id);
  const opened = measureValue(m, 'flowOpened');
  const steps = d.steps || [];
  const kind = stepKind('follow-up-sequence', d);
  const name = d.sequenceTitle || 'Follow-Up Flow';
  const enrolledText = countText(measureValue(m, 'flowEnrolled'));

  const seqType = d.sequenceType || 'lead_nurture';
  const isRetention = Boolean(
    d.isRetentionBranch ||
    seqType === 'upsell_recovery' ||
    seqType === 'checkout_recovery' ||
    seqType === 'at_risk_winback' ||
    seqType === 'fulfillment_review'
  );

  const themeColor = kind.color;
  let badgeBg = 'rgba(245, 158, 11, 0.15)';
  let borderColor = 'rgba(255, 255, 255, 0.1)';
  let headerLabel = 'Nurture Sequence';
  let IconComponent = Mail;

  if (seqType === 'upsell_recovery') {
    badgeBg = 'rgba(245, 158, 11, 0.2)';
    borderColor = 'rgba(245, 158, 11, 0.35)';
    headerLabel = 'Courtesy Rescue';
    IconComponent = Sparkles;
  } else if (seqType === 'checkout_recovery') {
    badgeBg = 'rgba(16, 185, 129, 0.2)';
    borderColor = 'rgba(16, 185, 129, 0.35)';
    headerLabel = 'Cart Abandon Recovery';
    IconComponent = ShoppingBag;
  } else if (seqType === 'at_risk_winback') {
    badgeBg = 'rgba(139, 92, 246, 0.2)';
    borderColor = 'rgba(139, 92, 246, 0.35)';
    headerLabel = 'VIP Winback Journey';
    IconComponent = Gift;
  } else if (seqType === 'fulfillment_review') {
    badgeBg = 'rgba(236, 72, 153, 0.2)';
    borderColor = 'rgba(236, 72, 153, 0.35)';
    headerLabel = '7-Day Review Request';
    IconComponent = Star;
  }

  return (
    <div
      style={{
        width: '270px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.94)',
        ...cardFrame(selected, {
          border: `1.5px solid ${borderColor}`,
          boxShadow: isRetention
            ? `0 10px 25px rgba(0, 0, 0, 0.45), 0 0 15px ${themeColor}22`
            : '0 10px 25px rgba(0, 0, 0, 0.4)'
        }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Standard Left Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Handle for vertical decline / abandonment flow connection */}
      <Handle
        type="target"
        position={Position.Top}
        id="retention-in"
        className="custom-handle"
        style={{ top: -6, left: '50%', background: themeColor }}
        title="Retention flow inbound connection"
      />

      {/* Where a reader goes after the emails: back to a page, or on to a thank-you page once they buy. */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%', ...(isRetentionStep(d) ? branchHandleStyle('retention') : {}) }}
        title="Next step after the emails"
      />

      {/* Top Banner */}
      <div
        data-jv-detail-row
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StepIcon kind={kind} icon={IconComponent} />
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: themeColor
              }}
            >
              {headerLabel}
            </div>
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {name}
            </div>
            {d.jourvanceFlowName && (
              <div
                style={{
                  fontSize: '11px',
                  color: '#FDE68A',
                  marginTop: 2,
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                Flow · {d.jourvanceFlowName}
              </div>
            )}
            {d.klaviyoFlowName && (
              <div
                style={{
                  fontSize: '11px',
                  color: '#C4B5FD',
                  marginTop: 2,
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                Klaviyo · {d.klaviyoFlowName}
              </div>
            )}
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: badgeBg,
            color: themeColor,
            fontWeight: 700,
            border: `1px solid ${themeColor}44`
          }}
        >
          {steps.length} {steps.length === 1 ? 'Letter' : 'Letters'}
        </span>
      </div>

      {/* Retention Parameters Pill (Delay, Voucher, Smart Exit) */}
      {isRetention && (
        <div
          data-jv-detail-row
          style={{
            padding: '6px 12px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            fontSize: '11px'
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#F1F5F9',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}
          >
            <Clock size={10} color={themeColor} />
            {retentionDelayText(d)}
          </span>

          {d.voucherCode && (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: `${themeColor}22`,
                border: `1px solid ${themeColor}44`,
                color: themeColor,
                fontWeight: 700
              }}
            >
              ✦ {d.voucherCode}
            </span>
          )}

          {d.smartExitOnPurchase !== false && (
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#34D399',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '3px'
              }}
            >
              <CheckCircle size={9} /> Exit on Buy
            </span>
          )}
        </div>
      )}

      {/* Steps Preview */}
      <div data-jv-detail-row style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {steps.slice(0, 3).map((s, idx) => (
          <div
            key={s.id || idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>#{idx + 1}</span>
              <span
                style={{
                  color: '#E2E8F0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '140px'
                }}
              >
                {s.subject || 'No subject yet'}
              </span>
            </div>
            <span
              style={{
                fontSize: '11px',
                color: themeColor,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap'
              }}
            >
              <Clock size={9} /> {s.delay}
            </span>
          </div>
        ))}
      </div>

      {/* Performance & Revenue Live Metrics */}
      <div
        data-jv-detail-row
        style={{
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.25)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px'
        }}
      >
        {([
          ['Enrolled', enrolledText],
          ['Sent', countText(measureValue(m, 'flowSent'))],
          ['Clicked', countText(measureValue(m, 'flowClicked'))],
          ['Revenue', moneyText(measureValue(m, 'flowRevenue'), 2)]
        ] as const).map(([name, text]) => (
          <div key={name} style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '11px',
                color: '#94A3B8',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {name === 'Enrolled' ? <Users size={10} /> : null} {name}
            </div>
            <div data-metric style={metricValueStyle(text, '#F1F5F9')}>
              {text}
            </div>
          </div>
        ))}
        {opened !== null && (
          <div data-metric style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#d1d5db' }}>
            Opened {countText(opened)}
          </div>
        )}
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      <StepSummary nodeId={id} kind={kind} icon={IconComponent} name={name} figure={{ label: 'Enrolled', value: enrolledText }} />
    </div>
  );
};

