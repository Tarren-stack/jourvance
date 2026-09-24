import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, ArrowDownRight, Tag, Clock, ShoppingBag } from 'lucide-react';
import type { UpsellNodeData } from '../../../types/journey';

export const UpsellNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as UpsellNodeData;
  const isDownsell = d.offerType === 'downsell';
  const accentColor = isDownsell ? '#F59E0B' : '#10B981';
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  const views = d.views || 184;
  const takes = d.takes || (isDownsell ? 22 : 46);
  const takeRate = views > 0 ? ((takes / views) * 100).toFixed(1) : (isDownsell ? '12.0' : '25.0');
  const revenue = d.attributedRevenue || (takes * (parseFloat(d.productPrice?.replace(/[^0-9.]/g, '') || (isDownsell ? '28' : '42'))));

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
        </div>
      </div>
    </div>
  );
};
