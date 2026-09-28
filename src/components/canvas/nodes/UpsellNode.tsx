import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, ArrowDownRight, Tag, Clock, ShoppingBag, TrendingUp, DollarSign, Sparkles } from 'lucide-react';
import type { UpsellNodeData } from '../../../types/journey';

export const UpsellNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as UpsellNodeData;
  const isDownsell = d.offerType === 'downsell';
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  const accentColor = isDownsell ? '#F59E0B' : '#10B981';
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  const views = d.views || 0;
  const takes = d.takes || 0;
  const takeRate = views > 0 ? ((takes / views) * 100).toFixed(1) : (d.conversionRate ? d.conversionRate.toFixed(1) : '0.0');
  const numRate = parseFloat(takeRate);
  const revenue = d.attributedRevenue || 0;

  const totalDeclines = d.totalDeclines || 0;
  const recoveredTakes = d.recoveredTakes || 0;
  const recoveredRevenue = d.recoveredRevenue || 0;
  const recoveryRate = d.recoveryRate || 0;

  return (
    <div
      style={{
        width: '270px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.94)',
        border: selected
          ? `1.5px solid ${accentColor}`
          : `1px solid ${isDownsell ? 'rgba(245, 158, 11, 0.28)' : 'rgba(16, 185, 129, 0.28)'}`,
        boxShadow: selected
          ? `0 0 20px ${isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`
          : '0 10px 25px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Target Handle from Checkout / Landing Page */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Source Handle (Accepted -> Next Step / Thank You) */}
      <Handle
        type="source"
        position={Position.Right}
        id="accepted"
        className="custom-handle"
        style={{ right: -6, top: '35%', background: '#10B981' }}
        title="If Accepted: Route to Next Upsell or Thank-You"
      />

      {/* Source Handle (Declined -> Downsell or Thank You) */}
      <Handle
        type="source"
        position={Position.Right}
        id="declined"
        className="custom-handle"
        style={{ right: -6, top: '65%', background: '#F59E0B' }}
        title="If Declined: Route to Downsell or Thank-You"
      />

      {/* Source Handle (Declined -> 24h Courtesy Rescue Flow) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="rescue"
        className="custom-handle"
        style={{ bottom: -6, left: '50%', background: '#F59E0B' }}
        title="Courtesy Rescue: Connect to 24h Post-Decline Retention Sequence"
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
              color: accentColor
            }}
          >
            {isDownsell ? <ArrowDownRight size={15} /> : <Zap size={15} />}
          </div>
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: accentColor
              }}
            >
              {isDownsell ? 'Downsell Step' : '1-Click Upsell (OTO)'}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              /{d.slug ? `${d.slug}/${isDownsell ? 'downsell' : 'upsell'}` : (isDownsell ? 'downsell' : 'upsell')}
            </div>
          </div>
        </div>

        <span
          style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: badgeBg,
            border: `1px solid ${badgeBorder}`,
            color: accentColor,
            fontWeight: 700
          }}
        >
          {d.badgeText || (isDownsell ? 'SAVE 50%' : 'SAVE 40%')}
        </span>
      </div>

      {/* Content Preview */}
      <div style={{ padding: '12px 14px' }}>
        {/* Performance & Revenue Live Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: views > 0
              ? (numRate >= 18 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)')
              : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${
              views > 0
                ? (numRate >= 18 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)')
                : 'rgba(255, 255, 255, 0.08)'
            }`,
            borderRadius: '8px',
            padding: '5px 10px',
            marginBottom: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <TrendingUp size={12} color={views > 0 ? (numRate >= 18 ? '#34D399' : '#F59E0B') : '#64748B'} />
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: views > 0 ? '#FFFFFF' : '#94A3B8',
                letterSpacing: '0.03em'
              }}
            >
              {views > 0 ? `${takeRate}% Take Rate` : '0 Views'}
            </span>
            {views > 0 && (
              <span style={{ fontSize: '9px', color: '#94A3B8' }}>
                ({takes}/{views})
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: revenue > 0 ? '#34D399' : '#94A3B8',
              fontFamily: "'JetBrains Mono', monospace"
            }}
          >
            {revenue > 0 ? `+$${Math.round(revenue).toLocaleString()}` : takes > 0 ? `${takes} sold` : '$0 rev'}
          </div>
        </div>

        {/* Progressive Courtesy Recovery Micro-Pill (Option C1) */}
        {recoveredTakes > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(99, 102, 241, 0.12))',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '8px',
              padding: '4px 8px',
              marginBottom: '8px',
              fontSize: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#34D399', fontWeight: 700 }}>
              <Sparkles size={11} color="#34D399" />
              <span>+{recoveryRate}% Courtesy Recovered</span>
            </div>
            <div
              style={{
                color: '#F8FAFC',
                fontWeight: 700,
                fontSize: '10px',
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              +{recoveredTakes} {recoveredTakes === 1 ? 'order' : 'orders'} • +${Math.round(recoveredRevenue)}
            </div>
          </div>
        ) : totalDeclines > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              padding: '4px 8px',
              marginBottom: '8px',
              fontSize: '10px',
              color: '#94A3B8'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={11} color="#94A3B8" />
              <span>{totalDeclines} {totalDeclines === 1 ? 'client' : 'clients'} in courtesy recovery</span>
            </div>
            <span style={{ fontSize: '9px', color: '#64748B', fontWeight: 600 }}>18h delay</span>
          </div>
        ) : null}

        <div
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#E2E8F0',
            marginBottom: '6px',
            lineHeight: '1.4',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical'
          }}
        >
          {d.headline || (isDownsell ? 'Wait! Try The Mini Replenishment Instead' : 'One-Time Offer: Complete Your Routine with 40% Off')}
        </div>

        {/* Product & Pricing Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '8px',
            padding: '8px 10px',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {d.productImage ? (
              <img
                src={d.productImage}
                alt="Product"
                style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94A3B8'
                }}
              >
                <ShoppingBag size={14} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#F1F5F9',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {d.productTitle || (isDownsell ? 'Deluxe Travel Ritual Duo' : 'Bioactive Triple Barrier Reserve')}
              </div>
              <div style={{ fontSize: '10px', color: '#94A3B8' }}>
                {d.discountCode ? `Code: ${d.discountCode}` : '1-Tap Discount Applied'}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: accentColor }}>
              {d.productPrice || (isDownsell ? '$24.00' : '$38.00')}
            </div>
            {d.regularPrice && (
              <div style={{ fontSize: '10px', color: '#64748B', textDecoration: 'line-through' }}>
                {d.regularPrice}
              </div>
            )}
          </div>
        </div>

        {/* Urgency Indicator */}
        <div style={{ fontSize: '10px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Clock size={11} color={accentColor} />
          <span>{d.urgencyMinutes || 5}m Reservation Hold • Instant 1-Tap Checkout</span>
        </div>
      </div>

      {/* Metrics Bar */}
      <div
        style={{
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.28)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px'
        }}
      >
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>
            Views
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#E2E8F0' }}>
            {views.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>
            Take Rate
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: accentColor }}>
            {takeRate}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>
            +Revenue
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>
            +${Math.round(revenue).toLocaleString()}
          </div>
          {recoveredRevenue > 0 && (
            <div style={{ fontSize: '9px', color: '#34D399', fontWeight: 600 }}>
              incl. +${Math.round(recoveredRevenue)} rec.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
