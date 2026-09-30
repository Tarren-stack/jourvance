import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layout, GitFork, Clock, TrendingUp } from 'lucide-react';
import type { PageNodeData } from '../../../types/journey';
import { branchHandleStyle } from '../../../lib/edgeKinds';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { PublishStatusStrip } from '../PublishStatus';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';
import { orderBumpPriceText } from '../../../lib/orderBumpPrice';
import { countText, measureValue, moneyText, percentText, rateOf, splitTest, UNAVAILABLE } from '../../../lib/journeyMetrics';
import { stepAddress } from '../../../lib/stepNames';

export const PageNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as PageNodeData;
  const kind = stepKind('landing-page', d);
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  // Every figure comes from the map's stats snapshot (#9). null means not measured, never 0.
  const { measure: m, note } = useNodeMetrics(id);
  const visitors = measureValue(m, 'visitors');
  const conv = measureValue(m, 'conversions');
  const convRate = measureValue(m, 'conversionRate');
  const grossRev = measureValue(m, 'grossRevenue');
  const orders = measureValue(m, 'liveOrders');
  const bumpTakes = measureValue(m, 'orderBumpTakes');
  const aov = grossRev !== null && orders !== null && orders > 0 ? grossRev / orders : null;
  const bumpRate = rateOf(bumpTakes, orders);

  const isAbActive = Boolean(d.abTestingEnabled);
  const splitRatio = d.splitRatio ?? 50;
  const varAVis = measureValue(m, 'variantAVisitors');
  const varBVis = measureValue(m, 'variantBVisitors');
  const varAConv = measureValue(m, 'variantAConversions');
  const varBConv = measureValue(m, 'variantBConversions');
  const varARate = rateOf(varAConv, varAVis);
  const varBRate = rateOf(varBConv, varBVis);
  // A variant leads only once the split's confidence test has run (C23, journeyMetrics' splitTest).
  const variantTest = splitTest(varAVis, varAConv, varBVis, varBConv);
  const isBLeading = variantTest.ran && variantTest.leader === 'b';
  const isALeading = variantTest.ran && variantTest.leader === 'a';
  const leaderText = isBLeading
    ? 'Variant B leading'
    : isALeading
    ? 'Variant A leading'
    : variantTest.ran
    ? 'Even split'
    : variantTest.reason === 'too_few_visits'
    ? 'Too few visits to call a leader'
    : 'No leader yet';
  const live = visitors !== null && visitors > 0;
  const visitorsText = countText(visitors);
  const convText = countText(conv);
  const rateText = percentText(convRate);
  // Same rule as the step's spoken name and the step panel (T11): no saved address says so, muted.
  const address = stepAddress({ ...d, type: 'landing-page' });
  const name = address || 'No address yet';

  return (
    <div
      style={{
        width: isAbActive ? '280px' : '260px',
        borderRadius: '12px',
        background: isRoasMode ? 'rgba(11, 15, 25, 0.95)' : 'rgba(15, 23, 42, 0.9)',
        ...cardFrame(selected, {
          border: isAbActive
            ? '1px solid rgba(236, 72, 153, 0.4)'
            : isRoasMode
            ? '1px solid rgba(16, 185, 129, 0.3)'
            : '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: isAbActive ? '0 10px 25px rgba(236, 72, 153, 0.15)' : '0 10px 25px rgba(0, 0, 0, 0.4)'
        }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Target Handle (from Ad) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div data-jv-detail-row style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <StepIcon kind={kind} icon={Layout} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: kind.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isRoasMode ? 'Offer Revenue' : 'Landing Page'}
            </div>
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {address || <span style={{ color: '#94A3B8' }}>{name}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '5px' }}>
          {isAbActive && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '9999px',
                background: 'rgba(236, 72, 153, 0.2)',
                border: '1px solid rgba(236, 72, 153, 0.4)',
                color: '#F472B6',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                whiteSpace: 'nowrap'
              }}
            >
              <GitFork size={10} />
              A/B {splitRatio}/{100 - splitRatio}
            </span>
          )}
          {/* Whether the page is live is the strip below, read from the server (#23). */}
          {isRoasMode && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: 'rgba(16, 185, 129, 0.25)',
                color: '#34D399',
                fontWeight: 700,
                whiteSpace: 'nowrap'
              }}
            >
              AOV: {moneyText(aov)}
            </span>
          )}
        </div>
      </div>
      <PublishStatusStrip nodeId={id} nodeType="landing-page" />

      {/* Content Preview / Financial Breakdown */}
      {isRoasMode ? (
        <div data-jv-detail-row style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94A3B8' }}>Gross Funnel Sales:</span>
            <span data-metric style={{ fontWeight: 800, color: grossRev === null ? '#94A3B8' : '#34D399' }}>{moneyText(grossRev)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#94A3B8' }}>Order bump take rate:</span>
            <span data-metric style={{ color: bumpRate === null ? '#94A3B8' : '#F472B6', fontWeight: 700 }}>{percentText(bumpRate)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#94A3B8' }}>Order bump revenue:</span>
            <span data-metric style={{ color: '#94A3B8', fontWeight: 600 }}>{UNAVAILABLE}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#94A3B8' }}>Orders:</span>
            <span data-metric style={{ color: orders === null ? '#94A3B8' : '#F1F5F9', fontWeight: 600 }}>{countText(orders)}</span>
          </div>
        </div>
      ) : (
        <div data-jv-detail-row style={{ padding: '12px 14px' }}>
          {/* Performance & Revenue Live Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: live ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${live ? 'rgba(99, 102, 241, 0.28)' : 'rgba(255, 255, 255, 0.08)'}`,
              borderRadius: '8px',
              padding: '5px 9px',
              marginBottom: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <TrendingUp size={12} color={live ? '#818CF8' : '#64748B'} />
              <span
                data-metric
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: live ? '#E0E7FF' : '#94A3B8',
                  letterSpacing: '0.03em'
                }}
              >
                {visitors === null ? UNAVAILABLE : visitors === 0 ? '0 visitors' : `${rateText} CVR`}
              </span>
              {live && (
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  ({visitorsText} visitors)
                </span>
              )}
            </div>
            {grossRev !== null && (
              <div
                data-metric
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: grossRev > 0 ? '#34D399' : '#94A3B8',
                  fontFamily: "'JetBrains Mono', monospace"
                }}
              >
                {moneyText(grossRev)} rev
              </div>
            )}
          </div>

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '4px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {/* What the page says, or that it says nothing yet: never a sentence it does not have (U04). */}
            {(d.headline || '').trim() || 'No headline yet'}
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {(d.subhead || '').trim() || 'No subheadline yet'}
          </div>

          {d.orderBumpEnabled && (
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#FBCFE8',
                background: 'rgba(236, 72, 153, 0.08)',
                padding: '3px 7px',
                borderRadius: '6px',
                border: '1px solid rgba(236, 72, 153, 0.2)'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#F472B6' }} />
                <span>Bump: {d.orderBumpTitle ? (d.orderBumpTitle.length > 14 ? d.orderBumpTitle.slice(0, 14) + '…' : d.orderBumpTitle) : 'Order Bump'}</span>
              </span>
              <span style={{ fontWeight: 700, color: '#F472B6' }}>
                {bumpTakes !== null && bumpTakes > 0 ? `+${countText(bumpTakes)} (${percentText(bumpRate)})` : orderBumpPriceText(d.orderBumpPrice)}
              </span>
            </div>
          )}

          {(d.urgencyTimerEnabled || d.scarcityBatchEnabled) && (
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#FBCFE8', background: 'rgba(236, 72, 153, 0.1)', padding: '3px 7px', borderRadius: '6px', border: '1px solid rgba(236, 72, 153, 0.2)' }}>
              <Clock size={11} color="#F472B6" />
              <span>
                {d.urgencyTimerEnabled && d.scarcityBatchEnabled
                  ? `Timer${d.urgencyMinutes ? `: ${d.urgencyMinutes}m` : ''} + stock line`
                  : d.urgencyTimerEnabled
                  ? `Timer${d.urgencyMinutes ? `: ${d.urgencyMinutes}m` : ''}`
                  : (d.scarcityBatchCount ? `Stock line: ${d.scarcityBatchCount} left` : 'Stock line on')}
              </span>
            </div>
          )}

          {d.exitIntentEnabled && (
            <div
              style={{
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#FDE68A',
                background: 'rgba(245, 158, 11, 0.08)',
                padding: '3px 7px',
                borderRadius: '6px',
                border: '1px solid rgba(245, 158, 11, 0.25)'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#FBBF24' }} />
                {/* Only what the user set: the drawer is published once it has a headline, and names a code only when one exists. */}
                <span>Exit drawer{(d.exitIntentHeadline || '').trim() && (d.exitIntentDiscountCode || d.discountCode) ? `: ${d.exitIntentDiscountCode || d.discountCode}` : ''}</span>
              </span>
              <span style={{ fontWeight: 700, color: '#FBBF24' }}>
                {(d.exitIntentHeadline || '').trim() ? 'On' : 'Needs a headline'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* A/B Testing Comparative Pod if Active */}
      {isAbActive && (
        <div data-jv-detail-row style={{ padding: '8px 14px', background: 'rgba(236, 72, 153, 0.05)', borderTop: '1px dashed rgba(236, 72, 153, 0.25)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Split Test Leader
            </span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: isALeading || isBLeading ? '#34D399' : '#94A3B8', display: 'flex', alignItems: 'center', gap: '3px', textAlign: 'right' }}>
              {(isALeading || isBLeading) && <TrendingUp size={11} aria-hidden="true" />}
              {leaderText}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '5px 8px', borderRadius: '6px', border: isALeading ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8' }}>
                <span>Var A (Ctrl)</span>
                <span data-metric style={{ fontWeight: 700, color: isALeading ? '#34D399' : '#E2E8F0' }}>{percentText(varARate)}</span>
              </div>
              <div data-metric style={{ fontSize: '11px', fontWeight: 700, color: '#F8FAFC', marginTop: '2px' }}>
                {varAConv === null || varAVis === null ? UNAVAILABLE : <>{countText(varAConv)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8' }}>/ {countText(varAVis)}</span></>}
              </div>
            </div>
            <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '5px 8px', borderRadius: '6px', border: isBLeading ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8' }}>
                <span>Var B (Test)</span>
                <span data-metric style={{ fontWeight: 700, color: isBLeading ? '#34D399' : '#E2E8F0' }}>{percentText(varBRate)}</span>
              </div>
              <div data-metric style={{ fontSize: '11px', fontWeight: 700, color: '#F8FAFC', marginTop: '2px' }}>
                {varBConv === null || varBVis === null ? UNAVAILABLE : <>{countText(varBConv)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8' }}>/ {countText(varBVis)}</span></>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Bar */}
      <div data-jv-detail-row style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        {([
          isRoasMode ? ['Revenue', moneyText(grossRev), '#34D399'] : ['Visitors', visitorsText, '#F1F5F9'],
          isRoasMode ? ['Bump', percentText(bumpRate), '#F472B6'] : ['Conv.', convText, '#34D399'],
          isRoasMode ? ['AOV', moneyText(aov), '#F8FAFC'] : ['Rate', rateText, '#F8FAFC']
        ] as const).map(([name, text, color]) => (
          <div key={name} style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {name}
            </div>
            <div data-metric style={metricValueStyle(text, color)}>
              {text}
            </div>
          </div>
        ))}
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      {/* Source Handle (to Form / Checkout) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />

      {/* Source Handle (Checkout Abandonment -> Retention Sequence) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="abandon"
        className="custom-handle"
        style={{ bottom: -6, left: '50%', ...branchHandleStyle('declined') }}
        title="Cart Abandonment: Route to Checkout Recovery Sequence"
      />

      <StepSummary
        nodeId={id}
        kind={kind}
        icon={Layout}
        name={name}
        figure={isRoasMode ? { label: 'Revenue', value: moneyText(grossRev) } : { label: 'Visitors', value: visitorsText }}
      />
    </div>
  );
};
