import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps
} from '@xyflow/react';
import type { ConversionEdgeData } from '../../../types/journey';

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
  const rate = d?.rate !== undefined ? d.rate : 100;
  const isDropOff = rate < 20 && rate > 0;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isDropOff ? '#F59E0B' : '#6366F1',
          strokeWidth: 2.5,
          strokeDasharray: isDropOff ? '4 4' : undefined,
          ...style
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 10
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              background: '#0F172A',
              border: isDropOff ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(99, 102, 241, 0.4)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
              fontSize: '11px',
              fontWeight: 700,
              color: isDropOff ? '#FBBF24' : '#818CF8'
            }}
          >
            <span>{Math.round(rate)}%</span>
            {d?.targetCount !== undefined && (
              <span style={{ fontSize: '10px', fontWeight: 500, color: '#94A3B8' }}>
                ({d.targetCount})
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
