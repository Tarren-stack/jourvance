import React, { useMemo } from 'react';
import type { JourneyEdge, JourneyNode } from '../../types/journey';
import { describePreview, layoutPreview, PREVIEW_TYPE_COLORS, PREVIEW_TYPE_NAMES } from '../../lib/blueprintPreview';

interface Props {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  width?: number;
}

/**
 * The funnel a blueprint builds, drawn before the merchant chooses Replace or Create new (#33).
 * One box per step, coloured by type, arrows for the lines, retention branches dashed. Pure SVG
 * from lib/blueprintPreview's layout, so it costs nothing to open and reads the same on every
 * screen. The map is described in words in its title for a screen reader.
 */
export const BlueprintPreviewMap: React.FC<Props> = ({ nodes, edges, width: widthProp }) => {
  const width: number = widthProp ?? 560;
  const layout = useMemo(() => layoutPreview(nodes, edges, { width }), [nodes, edges, width]);
  const words = describePreview(layout);
  return (
    <svg
      data-testid="blueprint-preview"
      role="img"
      aria-label={words}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      style={{ display: 'block', height: 'auto', maxHeight: '260px', borderRadius: '10px', background: 'rgba(2, 6, 23, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)' }}
    >
      <title>{words}</title>
      <defs>
        <marker id="jv-bp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
        </marker>
      </defs>
      {layout.lines.map((l) => (
        l.back ? (
          <path
            key={l.id}
            d={`M ${l.x1} ${l.y1} C ${l.x1} ${l.y1 + 28}, ${l.x2} ${l.y2 + 28}, ${l.x2} ${l.y2}`}
            fill="none"
            stroke="#64748B"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            markerEnd="url(#jv-bp-arrow)"
          />
        ) : (
          <line
            key={l.id}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="#64748B"
            strokeWidth={1.5}
            strokeDasharray={l.retention ? '4 3' : undefined}
            markerEnd="url(#jv-bp-arrow)"
          />
        )
      ))}
      {layout.boxes.map((b) => {
        const color = PREVIEW_TYPE_COLORS[b.type] || '#94A3B8';
        return (
          <g key={b.id} data-step-id={b.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#0F172A" stroke={color} strokeWidth={1.25} strokeDasharray={b.retention ? '4 3' : undefined} />
            <rect x={b.x} y={b.y} width={4} height={b.h} rx={2} fill={color} />
            <text x={b.x + 10} y={b.y + 17} fontSize={9} fontWeight={700} fill={color} letterSpacing="0.06em">
              {(PREVIEW_TYPE_NAMES[b.type] || b.type).toUpperCase()}
            </text>
            <text x={b.x + 10} y={b.y + 33} fontSize={11} fontWeight={600} fill="#E2E8F0">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
