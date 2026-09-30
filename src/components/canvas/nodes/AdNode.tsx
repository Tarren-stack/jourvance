import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Megaphone, DollarSign } from 'lucide-react';
import type { AdNodeData } from '../../../types/journey';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';
import { countText, measureValue, moneyText, UNAVAILABLE } from '../../../lib/journeyMetrics';

export const AdNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as AdNodeData;
  const kind = stepKind('ad-source', d);
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  // Figures come from the map's stats snapshot (#9); spend is the one number the person types in.
  const { measure: m, note } = useNodeMetrics(id);
  const spend = typeof d.spend === 'number' && d.spend > 0 ? d.spend : 0;
  const visits = measureValue(m, 'clicks');
  const attributedRev = measureValue(m, 'attributedRevenue');
  const roas = measureValue(m, 'roas');
  // Spend is entered, so anything divided by it is an estimate.
  const costPerVisit = spend > 0 && visits !== null && visits > 0 ? `Est. ${moneyText(spend / visits, 2)}` : UNAVAILABLE;
  const roasText = spend > 0 && roas === null ? UNAVAILABLE : roas !== null ? `Est. ${roas.toFixed(1)}x` : 'No spend';
  const spendText = spend > 0 ? moneyText(spend) : 'Not entered';
  const visitsText = visits === null ? UNAVAILABLE : `${countText(visits)} ${visits === 1 ? 'visit' : 'visits'}`;
  const name = d.platform === 'meta' ? 'Meta Ad (IG/FB)' : d.platform === 'google' ? 'Google Search' : 'Paid Ad';
  // Inline styles cannot express :hover, so the pointer is tracked here. Selection wins over hover,
  // and hover changes colour only, never geometry.
  const [hovered, setHovered] = React.useState(false);
  const lit = hovered && !selected;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '260px',
        borderRadius: '12px',
        background: isRoasMode ? 'rgba(11, 15, 25, 0.95)' : lit ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.9)',
        ...cardFrame(selected, {
          border: isRoasMode
            ? (lit ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(16, 185, 129, 0.3)')
            : (lit ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(255, 255, 255, 0.1)'),
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)'
        }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Top Banner */}
      <div data-jv-detail-row style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <StepIcon kind={kind} icon={Megaphone} />
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: kind.color }}>
              {isRoasMode ? 'Ad Attribution' : 'Traffic Source'}
            </div>
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {name}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: isRoasMode ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)',
            color: '#34D399',
            fontWeight: 700
          }}
        >
          {isRoasMode ? (roas === null ? (spend > 0 ? 'ROAS Unavailable' : 'Spend not entered') : `${roasText} ROAS`) : visitsText}
        </span>
      </div>

      {/* Content Preview / Financial Breakdown */}
      {isRoasMode ? (
        <div data-jv-detail-row style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94A3B8' }}>Attributed Revenue:</span>
            <span data-metric style={{ fontWeight: 800, color: '#34D399' }}>{moneyText(attributedRev)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#94A3B8' }}>Cost per visit:</span>
            <span data-metric style={{ color: '#F1F5F9', fontWeight: 600 }}>{costPerVisit}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#94A3B8' }}>Visits from this ad:</span>
            <span data-metric style={{ color: '#38BDF8', fontWeight: 600 }}>{countText(visits)}</span>
          </div>
        </div>
      ) : (
        <div data-jv-detail-row style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.headline || 'No headline yet'}
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.body || 'No ad copy defined yet.'}
          </div>
        </div>
      )}

      {/* Metrics Bar */}
      <div data-jv-detail-row style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <DollarSign size={10} /> Spend
          </div>
          <div data-entered title="Spend you entered" style={metricValueStyle(spendText, '#F1F5F9')}>
            {spendText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Cost per visit
          </div>
          <div data-metric style={metricValueStyle(costPerVisit, '#38BDF8')}>
            {costPerVisit}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            ROAS
          </div>
          <div data-metric style={metricValueStyle(roasText, '#34D399')}>
            {roasText}
          </div>
        </div>
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      {/* React Flow Source Handle (Traffic goes to next step) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />

      <StepSummary
        nodeId={id}
        kind={kind}
        icon={Megaphone}
        name={name}
        figure={isRoasMode ? { label: 'ROAS', value: roasText } : { label: 'Visits', value: countText(visits) }}
      />
    </div>
  );
};
