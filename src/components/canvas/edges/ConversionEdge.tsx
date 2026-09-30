import React from 'react';
import { createPortal } from 'react-dom';
import {
  BaseEdge,
  ViewportPortal,
  getSmoothStepPath,
  type EdgeProps
} from '@xyflow/react';
import type { ConversionEdgeData } from '../../../types/journey';
import {
  EDGE_KINDS,
  EDGE_WIDTH,
  EDGE_WIDTH_SELECTED,
  edgeKind
} from '../../../lib/edgeKinds';
import { edgePillCount, edgePillValue, edgeSentence, UNAVAILABLE } from '../../../lib/journeyMetrics';
import { asRetentionLine, isRetentionMetric } from '../../../lib/conversionBenchmarks';
import { LEADER_COLOR, placementFits } from '../../../lib/edgeLabelLayout';
import { useCaptionPortal, useEdgeLabelPlacement } from '../EdgeLabelLayout';
import { useEdgeFigure, useMetricsView } from '../CanvasMetrics';

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

  // The caption sits where the map's label layout put it, clear of cards and handles. A placement
  // made for a midpoint this line no longer has is dropped, so the pill never floats off a moved line.
  const placed = useEdgeLabelPlacement(id);
  const portal = useCaptionPortal();
  const fit = placed && placementFits(placed, labelX, labelY) ? placed : undefined;
  const captionX = fit ? fit.x : labelX;
  const captionY = fit ? fit.y : labelY;
  // Zoomed out, a caption with no clear spot near its line shows its figure only, or nothing
  // (T02). Its words stay in the pill's name and the line panel, and a hidden pill still takes focus.
  const form = fit?.form ?? 'full';

  const d = data as unknown as ConversionEdgeData | undefined;
  const isSelected = !!d?.isSelected;
  // Set by the canvas from the whole map (findLoopEdges), never from saved data. Only the chip
  // shows it: the line's colour and dash still say which branch this is.
  const inLoop = !!d?.inLoop;

  // The line says which branch this is (see the legend); the pill below says how well it converts.
  const kindId = edgeKind(d?.sourceHandle, d?.targetNodeData, d?.isRetentionEdge);
  const kind = EDGE_KINDS[kindId];

  // The pill reads the map's one stats snapshot (#9), never counts saved on the line. A line the
  // map has no figure for yet reads Unavailable. A line drawn as a retention flow is named as one,
  // so its pill never says NEXT under the legend's retention colour (R06).
  const measured = useEdgeFigure(id);
  const view = useMetricsView();
  const retentionDef = measured ? asRetentionLine(measured.def, kindId === 'retention') : undefined;
  const figure = measured && retentionDef && retentionDef !== measured.def ? { ...measured, def: retentionDef } : measured;
  const isRetentionEdge = isRetentionMetric(figure?.def);
  const status = figure?.status;
  const statusColor = status?.color ?? '#94A3B8';
  const statusBorder = status?.border ?? 'rgba(148, 163, 184, 0.25)';
  const value = edgePillValue(figure);
  const count = edgePillCount(figure);
  const sentence = `${edgeSentence(figure, view)}${inLoop ? ' This line is part of a loop. Visitors can come back to a step they already passed.' : ''}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // A click with no pointer behind it (detail 0) is Enter or Space on the pill: the line panel
    // then takes focus, as a step's panel does.
    if (d?.onSelectEdge) {
      d.onSelectEdge(id, { focus: e.detail === 0 });
    }
  };

  // The caption goes in React Flow's viewport portal, which sits after the steps, not in its edge
  // label layer, which sits before them. So Tab and a screen reader meet every step before the
  // lines between them (C34). Same viewport transform, so it moves with the map.
  // Centred on its spot and scaled about its centre by --jv-caption-scale, which keeps its 11px
  // text 11px on screen below zoom 1 (T02) and is 1 from zoom 1 up, so a zoom frame re-renders no
  // caption. The layout places it at that scale (EdgeLabelLayout).
  const caption = (
    <div
      data-edge-id={id}
      data-jv-edge-label={id}
      data-label-x={labelX}
      data-label-y={labelY}
      data-edge-path={edgePath}
      data-displaced={fit?.displaced ? 'true' : undefined}
      data-jv-caption-form={form}
      style={{
        position: 'absolute',
        transform: `translate(${captionX}px,${captionY}px) scale(var(--jv-caption-scale, 1)) translate(-50%, -50%)`,
        transformOrigin: '0 0',
        pointerEvents: 'all',
        zIndex: isSelected ? 20 : 10
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        data-edge-metric={figure?.def.id ?? 'unavailable'}
        aria-label={sentence}
        aria-describedby={d?.description ? `jv-edge-desc-${id}` : undefined}
        title={sentence}
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
            : `1px solid ${statusBorder}`,
          boxShadow: isSelected
            ? '0 0 16px rgba(56, 189, 248, 0.4), 0 4px 12px rgba(0, 0, 0, 0.6)'
            : isRetentionEdge
            ? '0 0 10px rgba(245, 158, 11, 0.25), 0 4px 12px rgba(0, 0, 0, 0.5)'
            : '0 4px 12px rgba(0, 0, 0, 0.5)',
          fontSize: '11px',
          fontWeight: 700,
          color: statusColor,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          outline: 'none',
          transform: isSelected ? 'scale(1.05)' : 'scale(1)',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        onMouseEnter={e => {
          if (!isSelected) {
            e.currentTarget.style.transform = 'scale(1.08)';
            e.currentTarget.style.borderColor = isRetentionEdge ? '#FBBF24' : statusColor;
          }
        }}
        onMouseLeave={e => {
          if (!isSelected) {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.borderColor = isRetentionEdge ? 'rgba(245, 158, 11, 0.45)' : statusBorder;
          }
        }}
      >
        {/* Metric Short Code */}
        <span
          data-jv-caption-part="code"
          style={{
            fontSize: '11px',
            fontWeight: 800,
            color: isRetentionEdge ? '#FBBF24' : '#94A3B8',
            letterSpacing: '0.04em'
          }}
        >
          {figure?.def.short ?? 'LINE'}
        </span>

        {/* The value: a rate, a count of visits, or on a retention line the wait set on its step.
            The one part a compact caption keeps. */}
        <span
          data-jv-caption-part="value"
          style={{
            color: isRetentionEdge ? '#FBBF24' : statusColor,
            fontWeight: value === UNAVAILABLE ? 600 : 800,
            fontSize: value === UNAVAILABLE ? '11px' : undefined
          }}
        >
          {value}
        </span>

        {/* The count behind the value, when it was measured */}
        {count && (
          <span data-jv-caption-part="count" style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8' }}>
            {count}
          </span>
        )}

        {/* Only a measured rate below the typical range is a leak. */}
        {status?.status === 'needs_work' && (
          <span
            data-jv-caption-part="leak"
            style={{
              fontSize: '11px',
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

        {/* On a loop (#13): the visitor can come back round to a step they passed. */}
        {inLoop && (
          <span
            data-loop="true"
            data-jv-caption-part="loop"
            style={{
              fontSize: '11px',
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: '9999px',
              border: '1px solid #F87171',
              color: '#FCA5A5',
              marginLeft: '2px'
            }}
          >
            LOOP
          </span>
        )}
      </button>

      {/* The line in words from the canvas (#19), read as the pill's description. The line itself
          is hidden from assistive tech, so this is where a screen reader hears where it goes. */}
      {d?.description && (
        <span id={`jv-edge-desc-${id}`} className="jv-sr-only">
          {d.description}
        </span>
      )}

      {/* + Step on the selected line (#12): opens the step picker to put a step on this line.
          Beside the pill, out of the caption's flow, so the pill does not move when it shows. */}
      {isSelected && d?.onAddStep && (
        <button
          type="button"
          className="jv-add-next nodrag nopan"
          aria-label="Add a step on this line"
          onClick={e => {
            e.stopPropagation();
            d.onAddStep?.(id);
          }}
          style={{
            position: 'absolute',
            left: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            marginLeft: '6px',
            padding: '4px 10px',
            borderRadius: '9999px',
            background: '#0B0F19',
            border: '1px solid #818CF8',
            color: '#E0E7FF',
            fontSize: '11px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)'
          }}
        >
          + Step
        </button>
      )}
    </div>
  );

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: kind.color,
          strokeWidth: isSelected ? EDGE_WIDTH_SELECTED : EDGE_WIDTH,
          strokeDasharray: kind.dash,
          strokeLinecap: kind.round ? 'round' : undefined,
          filter: isSelected ? `drop-shadow(0 0 6px ${kind.color}99)` : undefined,
          transition: 'stroke-width 0.2s',
          ...style
        }}
      />

      {/* Leader from the line to a caption that had to move off it; the pill covers its inner end. */}
      {fit?.displaced && (
        <g data-jv-edge-leader={id} aria-hidden="true" style={{ pointerEvents: 'none' }}>
          <path
            d={`M${fit.anchorX},${fit.anchorY}L${captionX},${captionY}`}
            fill="none"
            stroke={LEADER_COLOR}
            strokeWidth={1.25}
          />
          <circle cx={fit.anchorX} cy={fit.anchorY} r={3} fill={kind.color} stroke="#0B0F19" strokeWidth={1.5} />
        </g>
      )}

      {/* One portal element for every caption, from EdgeLabelLayout (R16). Outside that provider,
          React Flow's own ViewportPortal finds it. */}
      {portal === undefined ? <ViewportPortal>{caption}</ViewportPortal> : portal ? createPortal(caption, portal) : null}
    </>
  );
};
