import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps
} from '@xyflow/react';
import type { ConversionEdgeData } from '../../../types/journey';
import { getStepBenchmark } from '../../../lib/conversionBenchmarks';

export const ConversionEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
  markerEnd
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16
  });

  const d = data as unknown as ConversionEdgeData | undefined;
  const sourceThroughput = d?.sourceThroughput || 0;
  const targetCount = d?.targetCount || 0;
  const rate = typeof d?.rate === 'number' && Number.isFinite(d.rate) ? d.rate : 0;
  const isSelected = !!d?.isSelected;

  const benchmark = getStepBenchmark(
    d?.sourceNodeType,
    d?.targetNodeType,
    rate,
    sourceThroughput,
    targetCount
  );

  const isRetentionEdge = Boolean(
    d?.isRetentionEdge ||
    d?.sourceHandle === 'declined' ||
    d?.sourceHandle === 'rescue' ||
    d?.sourceHandle === 'abandon' ||
    (d?.targetNodeData as any)?.isRetentionBranch ||
    (d?.targetNodeData as any)?.sequenceType === 'upsell_recovery' ||
    (d?.targetNodeData as any)?.sequenceType === 'checkout_recovery' ||
    (d?.targetNodeData as any)?.sequenceType === 'at_risk_winback'
  );

  const isFlowing = sourceThroughput > 0;
  const strokeColor = isSelected
    ? '#38BDF8'
    : isRetentionEdge
    ? '#F59E0B'
    : isFlowing
    ? benchmark.statusColor
    : 'rgba(255, 255, 255, 0.2)';

  const strokeWidth = isSelected ? 3.5 : isRetentionEdge ? 2 : isFlowing ? 2.5 : 1.5;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (d?.onSelectEdge) {
      d.onSelectEdge(id);
    }
  };

  return (
    <>
      <defs>
        <style>
          {`
            @keyframes jvFlowDash {
              from { stroke-dashoffset: 24; }
              to { stroke-dashoffset: 0; }
            }
          `}
        </style>
      </defs>

      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: isFlowing ? '6 4' : isRetentionEdge ? '5 4' : undefined,
          animation: isFlowing ? 'jvFlowDash 1.2s linear infinite' : undefined,
          filter: isSelected
            ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.6))'
            : isRetentionEdge
            ? 'drop-shadow(0 0 4px rgba(245, 158, 11, 0.35))'
            : undefined,
          transition: 'stroke 0.2s, stroke-width 0.2s',
          ...style
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: isSelected ? 20 : 10
          }}
        >
          <button
            type="button"
            onClick={handleClick}
            title={`${isRetentionEdge ? 'Courtesy Retention Flow' : benchmark.metricName}: ${sourceThroughput > 0 ? `${rate}%` : isRetentionEdge ? 'Post-Decline Rescue Flow' : '0 traffic'}\nClick to inspect drop-off diagnostics & recommendations`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: isSelected ? '5px 12px' : '4px 10px',
              borderRadius: '9999px',
              background: '#0B0F19',
              border: isSelected
                ? '2px solid #38BDF8'
                : isRetentionEdge
                ? '1px solid rgba(245, 158, 11, 0.45)'
                : `1px solid ${benchmark.statusBorder}`,
              boxShadow: isSelected
                ? '0 0 16px rgba(56, 189, 248, 0.4), 0 4px 12px rgba(0, 0, 0, 0.6)'
                : isRetentionEdge
                ? '0 0 10px rgba(245, 158, 11, 0.25), 0 4px 12px rgba(0, 0, 0, 0.5)'
                : '0 4px 12px rgba(0, 0, 0, 0.5)',
              fontSize: '11px',
              fontWeight: 700,
              color: isRetentionEdge && !isFlowing ? '#FBBF24' : benchmark.statusColor,
              cursor: 'pointer',
              outline: 'none',
              transform: isSelected ? 'scale(1.05)' : 'scale(1)',
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onMouseEnter={e => {
              if (!isSelected) {
                e.currentTarget.style.transform = 'scale(1.08)';
                e.currentTarget.style.borderColor = isRetentionEdge ? '#FBBF24' : benchmark.statusColor;
              }
            }}
            onMouseLeave={e => {
              if (!isSelected) {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.borderColor = isRetentionEdge ? 'rgba(245, 158, 11, 0.45)' : benchmark.statusBorder;
              }
            }}
          >
            {/* Metric Short Code */}
            <span
              style={{
                fontSize: '9px',
                fontWeight: 800,
                color: isRetentionEdge ? '#FBBF24' : isFlowing ? '#94A3B8' : '#64748B',
                letterSpacing: '0.04em'
              }}
            >
              {isRetentionEdge ? 'RESCUE' : benchmark.metricShort}
            </span>

            {/* Rate Value or Neutral Badge */}
            {isFlowing ? (
              <span style={{ color: benchmark.statusColor, fontWeight: 800 }}>
                {Math.round(rate)}%
              </span>
            ) : isRetentionEdge ? (
              <span style={{ color: '#FBBF24', fontWeight: 600, fontSize: '10px' }}>
                18h Delay
              </span>
            ) : (
              <span style={{ color: '#64748B', fontWeight: 600, fontSize: '10px' }}>
                Ready
              </span>
            )}

            {/* Target Volume or Drop-off Alert */}
            {isFlowing && (
              <span style={{ fontSize: '10px', fontWeight: 500, color: '#94A3B8' }}>
                ({targetCount.toLocaleString()})
              </span>
            )}

            {/* Warning pill if below benchmark */}
            {isFlowing && benchmark.status === 'needs_work' && (
              <span
                style={{
                  fontSize: '8px',
                  fontWeight: 800,
                  padding: '1px 5px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(245, 158, 11, 0.2)',
                  color: '#FBBF24',
                  marginLeft: '2px'
                }}
              >
                LEAK
              </span>
            )}
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
