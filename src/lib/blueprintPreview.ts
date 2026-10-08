// The small map a blueprint shows before it is loaded: every step as a box, every line as an
// arrow, laid out by RANK (longest path from a step nothing points at), left to right, so the
// picture is the funnel's shape and never two boxes on top of each other, whatever the saved
// canvas positions were. Pure: no React, no DOM, so a node test can drive it over every
// shipped blueprint. Rendered by components/modals/BlueprintPreviewMap.tsx.
import type { JourneyEdge, JourneyNode, NodeType } from '../types/journey';

export interface PreviewBox {
  id: string;
  type: NodeType;
  label: string;
  retention: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreviewLine {
  id: string;
  source: string;
  target: string;
  /** A line that points back to an earlier or the same column (a loop or a retention return). */
  back: boolean;
  retention: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PreviewLayout {
  width: number;
  height: number;
  columns: number;
  boxes: PreviewBox[];
  lines: PreviewLine[];
}

/** Accent per step type, the same family the canvas uses for its step chrome. */
export const PREVIEW_TYPE_COLORS: Record<NodeType, string> = {
  'ad-source': '#EC4899',
  'landing-page': '#8B5CF6',
  'lead-form': '#38BDF8',
  'follow-up-sequence': '#F59E0B',
  'thank-you': '#10B981',
  'upsell': '#F97316',
  'ab-split': '#94A3B8'
};

export const PREVIEW_TYPE_NAMES: Record<NodeType, string> = {
  'ad-source': 'Ad',
  'landing-page': 'Page',
  'lead-form': 'Form',
  'follow-up-sequence': 'Emails',
  'thank-you': 'Thank you',
  'upsell': 'Upsell',
  'ab-split': 'A/B split'
};

export const PREVIEW_DEFAULTS = Object.freeze({
  width: 560,
  boxWidth: 128,
  boxHeight: 46,
  columnGap: 36,
  rowGap: 14,
  padding: 12,
  labelChars: 24
});

export function previewLabel(node: JourneyNode, max: number = PREVIEW_DEFAULTS.labelChars): string {
  const data = (node.data || {}) as { label?: unknown; headline?: unknown };
  const raw = typeof data.label === 'string' && data.label.trim() ? data.label : typeof data.headline === 'string' ? data.headline : '';
  const text = raw.replace(/\s+/g, ' ').trim() || PREVIEW_TYPE_NAMES[(node.type || 'landing-page') as NodeType] || 'Step';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/**
 * Rank every node by longest path from the roots. Roots are nodes nothing points at (the first
 * node when every node is pointed at). A depth-first walk along OUTGOING lines marks a line whose
 * target is on the current path as a back edge (a loop); the ranks are then the longest path over
 * the remaining acyclic graph, taken in topological order. A node the roots never reach is walked
 * afterwards, so it ranks 0 with no incoming forward line, else one more than its highest source.
 */
export function rankNodes(nodes: JourneyNode[], edges: JourneyEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) || []), e.target]);
    hasIncoming.add(e.target);
  }
  let roots = nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id);
  if (roots.length === 0 && nodes.length > 0) roots = [nodes[0].id];

  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = finished
  const forward = new Map<string, string[]>(); // kept (non back) edges, source -> targets
  const walk = (id: string): void => {
    state.set(id, 1);
    for (const t of out.get(id) || []) {
      if (state.get(t) === 1) continue; // back edge: a loop, dropped
      forward.set(id, [...(forward.get(id) || []), t]);
      if (!state.has(t)) walk(t);
    }
    state.set(id, 2);
  };
  for (const r of roots) if (!state.has(r)) walk(r);
  for (const n of nodes) if (!state.has(n.id)) walk(n.id); // unreachable from the roots

  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, 0);
  for (const targets of forward.values()) for (const t of targets) indegree.set(t, (indegree.get(t) || 0) + 1);
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift() as string;
    for (const t of forward.get(id) || []) {
      rank.set(t, Math.max(rank.get(t) || 0, (rank.get(id) || 0) + 1));
      indegree.set(t, (indegree.get(t) || 0) - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }
  return rank;
}

export function layoutPreview(
  nodes: JourneyNode[],
  edges: JourneyEdge[],
  opts: Partial<Record<keyof typeof PREVIEW_DEFAULTS, number>> = {}
): PreviewLayout {
  const o = { ...PREVIEW_DEFAULTS, ...opts };
  const list = nodes.filter((n) => n && typeof n.id === 'string');
  if (list.length === 0) return { width: o.width, height: o.boxHeight + o.padding * 2, columns: 0, boxes: [], lines: [] };
  const rank = rankNodes(list, edges);
  const columns = Math.max(...list.map((n) => rank.get(n.id) || 0)) + 1;
  // Fit the columns into the width: shrink the box and the gap together when there are many.
  const usable = o.width - o.padding * 2;
  const scale = Math.min(1, usable / (columns * o.boxWidth + (columns - 1) * o.columnGap));
  const boxW = Math.max(56, Math.round(o.boxWidth * scale));
  const gapX = Math.max(12, Math.round(o.columnGap * scale));
  const byColumn = new Map<number, JourneyNode[]>();
  for (const n of list) {
    const r = rank.get(n.id) || 0;
    byColumn.set(r, [...(byColumn.get(r) || []), n]);
  }
  const rows = Math.max(...Array.from(byColumn.values()).map((c) => c.length));
  const height = o.padding * 2 + rows * o.boxHeight + (rows - 1) * o.rowGap;
  const boxes: PreviewBox[] = [];
  const at = new Map<string, PreviewBox>();
  for (const [col, members] of byColumn) {
    // Keep the author's top-to-bottom order within a column, retention branches last.
    members.sort((a, b) => {
      const ra = (a.data as { isRetentionBranch?: boolean })?.isRetentionBranch ? 1 : 0;
      const rb = (b.data as { isRetentionBranch?: boolean })?.isRetentionBranch ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0);
    });
    const colHeight = members.length * o.boxHeight + (members.length - 1) * o.rowGap;
    const top = o.padding + Math.round((height - o.padding * 2 - colHeight) / 2);
    members.forEach((n, i) => {
      const box: PreviewBox = {
        id: n.id,
        type: (n.type || 'landing-page') as NodeType,
        label: previewLabel(n, o.labelChars),
        retention: !!(n.data as { isRetentionBranch?: boolean })?.isRetentionBranch,
        x: o.padding + col * (boxW + gapX),
        y: top + i * (o.boxHeight + o.rowGap),
        w: boxW,
        h: o.boxHeight
      };
      boxes.push(box);
      at.set(n.id, box);
    });
  }
  const lines: PreviewLine[] = [];
  for (const e of edges) {
    const s = at.get(e.source);
    const t = at.get(e.target);
    if (!s || !t || s === t) continue;
    const back = t.x <= s.x;
    lines.push({
      id: e.id,
      source: e.source,
      target: e.target,
      back,
      retention: s.retention || t.retention || !!(e.data as { isRetentionEdge?: boolean })?.isRetentionEdge,
      x1: back ? s.x + s.w / 2 : s.x + s.w,
      y1: back ? s.y + s.h : s.y + s.h / 2,
      x2: back ? t.x + t.w / 2 : t.x,
      y2: back ? t.y + t.h : t.y + t.h / 2
    });
  }
  return { width: o.width, height, columns, boxes, lines };
}

/** The map in words, for the SVG title and a screen reader: "4 steps: Ad, then Page, ...". */
export function describePreview(layout: PreviewLayout): string {
  const ordered = [...layout.boxes].sort((a, b) => a.x - b.x || a.y - b.y);
  if (ordered.length === 0) return 'An empty blueprint with no steps.';
  const names = ordered.map((b) => `${PREVIEW_TYPE_NAMES[b.type] || b.type} “${b.label}”`);
  return `${ordered.length} step${ordered.length === 1 ? '' : 's'} in ${layout.columns} column${layout.columns === 1 ? '' : 's'}: ${names.join(', then ')}.`;
}
