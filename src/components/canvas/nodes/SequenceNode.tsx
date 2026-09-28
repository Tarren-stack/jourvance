import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Mail, Clock, Users, ShieldAlert, Sparkles, ShoppingBag, Gift, CheckCircle } from 'lucide-react';
import type { SequenceNodeData } from '../../../types/journey';

export const SequenceNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as SequenceNodeData;
  const steps = d.steps || [];

  const seqType = d.sequenceType || 'lead_nurture';
  const isRetention = Boolean(
    d.isRetentionBranch ||
    seqType === 'upsell_recovery' ||
    seqType === 'checkout_recovery' ||
    seqType === 'at_risk_winback'
  );

  let themeColor = '#FBBF24';
  let badgeBg = 'rgba(245, 158, 11, 0.15)';
  let borderColor = 'rgba(255, 255, 255, 0.1)';
  let headerLabel = 'Nurture Sequence';
  let IconComponent = Mail;

  if (seqType === 'upsell_recovery') {
    themeColor = '#F59E0B';
    badgeBg = 'rgba(245, 158, 11, 0.2)';
    borderColor = selected ? '#F59E0B' : 'rgba(245, 158, 11, 0.35)';
    headerLabel = 'Courtesy Rescue';
    IconComponent = Sparkles;
  } else if (seqType === 'checkout_recovery') {
    themeColor = '#10B981';
    badgeBg = 'rgba(16, 185, 129, 0.2)';
    borderColor = selected ? '#10B981' : 'rgba(16, 185, 129, 0.35)';
    headerLabel = 'Cart Abandon Recovery';
    IconComponent = ShoppingBag;
  } else if (seqType === 'at_risk_winback') {
    themeColor = '#8B5CF6';
    badgeBg = 'rgba(139, 92, 246, 0.2)';
    borderColor = selected ? '#8B5CF6' : 'rgba(139, 92, 246, 0.35)';
    headerLabel = 'VIP Winback Journey';
    IconComponent = Gift;
  } else if (selected) {
    borderColor = '#6366F1';
  }

  return (
    <div
      style={{
        width: '270px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.94)',
        border: `1.5px solid ${borderColor}`,
        boxShadow: selected
          ? `0 0 20px ${themeColor}55`
          : isRetention
          ? `0 10px 25px rgba(0, 0, 0, 0.45), 0 0 15px ${themeColor}22`
          : '0 10px 25px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
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

      {/* Top Banner */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: badgeBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: themeColor
            }}
          >
            <IconComponent size={15} />
          </div>
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
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {d.sequenceTitle || 'Follow-Up Flow'}
            </div>
            {d.jourvanceFlowName && (
              <div
                style={{
                  fontSize: '10px',
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
                  fontSize: '10px',
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
            fontSize: '10px',
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
          style={{
            padding: '6px 12px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            fontSize: '10px'
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
            {d.delayHours ? `${d.delayHours}h delay` : '18h delay'}
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
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
              <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 600 }}>#{idx + 1}</span>
              <span
                style={{
                  color: '#E2E8F0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '140px'
                }}
              >
                {s.subject}
              </span>
            </div>
            <span
              style={{
                fontSize: '10px',
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
          ['Enrolled', d.flowEnrolled ?? d.contactsEnrolled],
          ['Sent', d.flowSent],
          ['Clicked', d.flowClicked],
          ['Revenue', d.flowRevenue]
        ] as const).map(([name, value]) => (
          <div key={name}>
            <div
              style={{
                fontSize: '10px',
                color: '#64748B',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {name === 'Enrolled' ? <Users size={10} /> : null} {name}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
              {value == null
                ? '—'
                : name === 'Revenue'
                ? `$${Number(value).toFixed(2)}`
                : value.toLocaleString()}
            </div>
          </div>
        ))}
        {typeof d.flowOpened === 'number' && (
          <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#d1d5db' }}>
            Opened {d.flowOpened}
          </div>
        )}
      </div>
    </div>
  );
};

