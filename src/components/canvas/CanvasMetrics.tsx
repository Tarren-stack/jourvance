import { createContext, useContext, type CSSProperties } from 'react';
import { nodeNote, UNAVAILABLE } from '../../lib/journeyMetrics';
import type { CanvasMetrics, EdgeFigure, MetricsView, NodeMetrics } from '../../lib/journeyMetrics';

// The map's figures reach cards and lines through this context, never through node or edge data,
// so a stats poll never changes the journey, never enters undo history and is never saved (#9).
// JourneyCanvas provides buildCanvasMetrics(nodes, edges, metrics). Without a provider the view
// is null and every figure reads Unavailable.

const EMPTY: CanvasMetrics = { view: null, nodes: {}, edges: {} };

export const CanvasMetricsContext = createContext<CanvasMetrics>(EMPTY);

/** A card's measured figures (null when not measured) and its one basis line. */
export function useNodeMetrics(id: string): NodeMetrics {
  const metrics = useContext(CanvasMetricsContext);
  return metrics.nodes[id] ?? { measure: null, note: nodeNote(metrics.view, id) };
}

/** A line's figure, or null when the map has not built one for it yet. */
export function useEdgeFigure(id: string): EdgeFigure | null {
  return useContext(CanvasMetricsContext).edges[id] ?? null;
}

/** The view the map is showing: its status, range and snapshot. A line's sentence names the range. */
export function useMetricsView(): MetricsView | null {
  return useContext(CanvasMetricsContext).view;
}

/**
 * A card's value cell. 'Unavailable' is dimmed and a size smaller so it reads as an absence, not
 * a figure, and so it fits a third of a card without spilling out of its cell.
 */
export function metricValueStyle(text: string, color: string, size = 12): CSSProperties {
  const missing = text === UNAVAILABLE || text === 'Not entered' || text === 'No spend';
  return {
    fontSize: `${missing ? Math.max(11, size - 1) : size}px`,
    fontWeight: missing ? 600 : 700,
    color: missing ? '#94A3B8' : color,
    whiteSpace: 'nowrap'
  };
}
