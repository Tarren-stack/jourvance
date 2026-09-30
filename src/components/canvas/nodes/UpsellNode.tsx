import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, ArrowDownRight, Tag, Clock, ShoppingBag, TrendingUp, DollarSign, Sparkles } from 'lucide-react';
import type { UpsellNodeData } from '../../../types/journey';
import { branchHandleStyle } from '../../../lib/edgeKinds';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { PublishStatusStrip } from '../PublishStatus';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';
import { countText, measureValue, moneyText, percentText, UNAVAILABLE } from '../../../lib/journeyMetrics';
import { MIN_GRADE_SAMPLE } from '../../../lib/conversionBenchmarks';
import { stepAddress } from '../../../lib/stepNames';

export const UpsellNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as UpsellNodeData;
  const isDownsell = d.offerType === 'downsell';
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  const kind = stepKind('upsell', d);
  const accentColor = kind.color;
  const badgeBg = isDownsell ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)';
  const badgeBorder = isDownsell ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)';

  // Every count comes from the map's snapshot (#9). The take rate is this offer's own takes over
  // its own views, so it never passes 100%.
  const { measure: m, note } = useNodeMetrics(id);
  const views = measureValue(m, 'views');
  const takes = measureValue(m, 'takes');
  const takeRate = measureValue(m, 'conversionRate');
  const revenue = measureValue(m, 'attributedRevenue');
  const live = views !== null && views > 0;
  // The pill is tinted green or amber only when the take rate could be graded (100 views or more).
  const graded = views !== null && views >= MIN_GRADE_SAMPLE && takeRate !== null;
  const healthyTake = graded && takeRate >= 18;

  // The recovery rows show only what was measured and is above zero.
  const totalDeclines = measureValue(m, 'totalDeclines') ?? 0;
  const recoveredTakes = measureValue(m, 'recoveredTakes') ?? 0;
  const recoveredRevenue = measureValue(m, 'recoveredRevenue') ?? 0;
  const recoveryRate = measureValue(m, 'recoveryRate');
  const viewsText = countText(views);
  const takeRateText = percentText(takeRate);
  const revenueText = revenue === null ? UNAVAILABLE : `+${moneyText(revenue)}`;
  // The address comes from the same rule as the step's spoken name and the step panel (T11): a
  // step with no saved address says so, muted, rather than showing a default "/upsell".
  const address = stepAddress({ ...d, type: 'upsell' });
  const name = address || 'No address yet';

  return (
    <div
      style={{
        width: '270px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.94)',
        ...cardFrame(selected, {
          border: `1px solid ${isDownsell ? 'rgba(245, 158, 11, 0.28)' : 'rgba(16, 185, 129, 0.28)'}`,
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.45)'
        }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
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
        style={{ right: -6, top: '35%', ...branchHandleStyle('accepted') }}
        title="If Accepted: Route to Next Upsell or Thank-You"
      />

      {/* Source Handle (Declined -> Downsell or Thank You) */}
      <Handle
        type="source"
        position={Position.Right}
        id="declined"
        className="custom-handle"
        style={{ right: -6, top: '65%', ...branchHandleStyle('declined') }}
        title="If Declined: Route to Downsell or Thank-You"
      />

      {/* Source Handle (Declined -> 24h Courtesy Rescue Flow) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="rescue"
        className="custom-handle"
        style={{ bottom: -6, left: '50%', ...branchHandleStyle('retention') }}
        title="Courtesy Rescue: Connect to 24h Post-Decline Retention Sequence"
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
          <StepIcon kind={kind} icon={isDownsell ? ArrowDownRight : Zap} />
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
            background: badgeBg,
            border: `1px solid ${badgeBorder}`,
            color: accentColor,
            fontWeight: 700
          }}
        >
          {d.badgeText || (isDownsell ? 'Downsell' : 'Upsell')}
        </span>
      </div>

      <PublishStatusStrip nodeId={id} nodeType="upsell" />

      {/* Content Preview */}
      <div data-jv-detail-row style={{ padding: '12px 14px' }}>
        {/* Performance & Revenue Live Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: graded
              ? (healthyTake ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)')
              : live ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${
              graded
                ? (healthyTake ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)')
                : live ? 'rgba(99, 102, 241, 0.28)' : 'rgba(255, 255, 255, 0.08)'
            }`,
            borderRadius: '8px',
            padding: '5px 10px',
            marginBottom: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <TrendingUp size={12} color={graded ? (healthyTake ? '#34D399' : '#F59E0B') : live ? '#818CF8' : '#64748B'} />
            <span
              data-metric
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: live ? '#FFFFFF' : '#94A3B8',
                letterSpacing: '0.03em'
              }}
            >
              {views === null ? UNAVAILABLE : views === 0 ? '0 views' : `${takeRateText} take rate`}
            </span>
            {live && (
              <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                ({countText(takes)}/{viewsText})
              </span>
            )}
          </div>
          {revenue !== null && (
            <div
              data-metric
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: revenue > 0 ? '#34D399' : '#94A3B8',
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              {moneyText(revenue)} rev
            </div>
          )}
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
              fontSize: '11px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#34D399', fontWeight: 700 }}>
              <Sparkles size={11} color="#34D399" />
              <span>{recoveryRate === null ? 'Recovered after a decline' : `${percentText(recoveryRate)} recovered after a decline`}</span>
            </div>
            <div
              style={{
                color: '#F8FAFC',
                fontWeight: 700,
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              +{countText(recoveredTakes)} {recoveredTakes === 1 ? 'order' : 'orders'}{recoveredRevenue > 0 ? ` • +${moneyText(recoveredRevenue)}` : ''}
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
              fontSize: '11px',
              color: '#94A3B8'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={11} color="#94A3B8" />
              <span>{countText(totalDeclines)} {totalDeclines === 1 ? 'person' : 'people'} declined this offer</span>
            </div>
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
          {d.headline || 'No headline yet'}
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
                alt=""
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
                {d.productTitle || 'No product chosen'}
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                {d.discountCode ? `Code: ${d.discountCode}` : 'No discount code'}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: accentColor }}>
              {d.productPrice || 'No price set'}
            </div>
            {d.regularPrice && (
              <div style={{ fontSize: '11px', color: '#94A3B8', textDecoration: 'line-through' }}>
                {d.regularPrice}
              </div>
            )}
          </div>
        </div>

        {/* Urgency Indicator: only when the step sets a hold, never an invented 5 minutes (#25) */}
        {(d.urgencyMinutes ?? 0) > 0 && (
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Clock size={11} color={accentColor} />
            <span>{d.urgencyMinutes}m countdown • Instant 1-Tap Checkout</span>
          </div>
        )}
      </div>

      {/* Metrics Bar */}
      <div
        data-jv-detail-row
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
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>
            Views
          </div>
          <div data-metric style={metricValueStyle(viewsText, '#E2E8F0')}>
            {viewsText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>
            Take Rate
          </div>
          <div data-metric style={metricValueStyle(takeRateText, accentColor)}>
            {takeRateText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>
            +Revenue
          </div>
          <div data-metric style={metricValueStyle(revenueText, '#34D399')}>
            {revenueText}
          </div>
          {recoveredRevenue > 0 && (
            <div style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>
              incl. +{moneyText(recoveredRevenue)} rec.
            </div>
          )}
        </div>
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      <StepSummary
        nodeId={id}
        kind={kind}
        icon={isDownsell ? ArrowDownRight : Zap}
        name={name}
        figure={{ label: 'Take rate', value: takeRateText }}
      />
    </div>
  );
};
