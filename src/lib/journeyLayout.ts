// Tidy layout: one button arranges the steps into ranked columns, left to right.
// Ported from Aura src/lib/journeyLayout.ts (the rule, not the surface). Only positions change,
// and lines are never rewritten, because in Jourvance a line's source handle IS the branch the
// visitor took (accepted, declined, abandon, rescue, branch-a, branch-b; see edgeKinds.ts).
// The explicit .ts extension lets node tests import this file; Vite resolves it to the same module.
import { isRetentionStep } from './edgeKinds.ts';

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
/** A Map, not a plain object: step ids are user data, and a Map has no prototype keys. */
export type Positions = Map<string, Point>;

export type LayoutNode = {
  id: string;
  position: Point;
  data?: unknown;
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

export type LayoutEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** Where the first column's top-left corner goes. */
export const LAYOUT_ORIGIN: Point = { x: 0, y: 0 };
/** Room for the widest rate pill (about 160px, ConversionEdge.tsx) plus the 26px arrowhead. */
export const COLUMN_GAP = 224;
/** Between cards stacked in one column. */
export const ROW_GAP = 64;
/** Between the main band, the retention band and the unconnected row. */
export const LANE_GAP = 128;
/** Between cards in the unconnected row. */
export const LOOSE_GAP = 64;
/** A card never measured (hidden since load, or a node test). Larger than any real card on purpose. */
export const DEFAULT_NODE_SIZE: Size = { width: 300, height: 400 };

/**
 * How far down its card each source handle sits, so siblings keep the order of the lines that feed
 * them. Copied from UpsellNode.tsx:53-76 (accepted 35%, declined 65%, rescue at the bottom),
 * AbSplitNode.tsx:291-316 (branch A and branch B) and PageNode.tsx:315-322 (abandon at the bottom).
 * Every other handle sits at the middle.
 */
export const HANDLE_Y_FRACTION: Record<string, number> = {
  accepted: 0.35,
  declined: 0.65,
  'branch-a': 0.44,
  'branch-b': 0.75,
  abandon: 1,
  rescue: 1
};

const handleFraction = (handle: string | null | undefined): number =>
  handle && Object.prototype.hasOwnProperty.call(HANDLE_Y_FRACTION, handle) ? HANDLE_Y_FRACTION[handle] : 0.5;

const positive = (...values: (number | undefined)[]): number | undefined =>
  values.find(v => typeof v === 'number' && Number.isFinite(v) && v > 0);

/** A card's real size when known: measured on screen, then the caller's cache, then the default. */
export function nodeSize(n: LayoutNode, sizes?: ReadonlyMap<string, Size>): Size {
  const cached = sizes?.get(n.id);
  return {
    width: positive(n.measured?.width, cached?.width, n.width) ?? DEFAULT_NODE_SIZE.width,
    height: positive(n.measured?.height, cached?.height, n.height) ?? DEFAULT_NODE_SIZE.height
  };
}

/** A line that drops down from a bottom handle, or into the top retention handle. Its target sits under its source. */
export function leavesDownward(e: LayoutEdge): boolean {
  return e.sourceHandle === 'abandon' || e.sourceHandle === 'rescue' || e.targetHandle === 'retention-in';
}

/** Where every step sits now, as copies. */
export function positionsOf(nodes: readonly LayoutNode[]): Positions {
  return new Map(nodes.map(n => [n.id, { x: n.position.x, y: n.position.y }]));
}

/** New nodes at the given positions. A node with no entry comes back as the same object; data is never touched. */
export function applyPositions<N extends LayoutNode>(nodes: readonly N[], positions: Positions): N[] {
  return nodes.map(n => {
    const p = positions.get(n.id);
    return p ? { ...n, position: { x: p.x, y: p.y } } : n;
  });
}

/** True when every step named in `positions` exists and sits there (within tol on both axes). */
export function nodesAt(nodes: readonly LayoutNode[], positions: Positions, tol = 0.5): boolean {
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const [id, p] of positions) {
    const n = byId.get(id);
    if (!n || Math.abs(n.position.x - p.x) > tol || Math.abs(n.position.y - p.y) > tol) return false;
  }
  return true;
}

/** Strongly connected groups (Tarjan). Recursion depth is at most the step count. */
function stronglyConnected(ids: string[], out: Map<string, string[]>): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const group = new Map<string, number>();
  let counter = 0;
  let groups = 0;
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of out.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.set(w, groups);
      } while (w !== v);
      groups++;
    }
  };
  for (const id of ids) if (!index.has(id)) visit(id);
  return group;
}

/**
 * New positions for every step. Connected steps go in ranked columns from the connection order
 * (a loop shares one column), main-path steps centred on one midline, retention flows in a lane
 * under the main band, and unconnected steps in a row at the bottom. Sizes and gaps decide every
 * coordinate and current positions only break ties, so tidying a tidy map moves nothing.
 */
export function tidyPositions(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  sizes?: ReadonlyMap<string, Size>
): Positions {
  const result: Positions = new Map();
  if (nodes.length === 0) return result;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const size = new Map(nodes.map(n => [n.id, nodeSize(n, sizes)]));

  // (a, b) Real links only: both ends present, no self links.
  const links = edges.filter(e => e.source !== e.target && byId.has(e.source) && byId.has(e.target));
  const connected = new Set<string>();
  for (const l of links) {
    connected.add(l.source);
    connected.add(l.target);
  }
  const ids = nodes.map(n => n.id).filter(id => connected.has(id));
  const loose = nodes.filter(n => !connected.has(n.id));

  // (c) A step fed by a drop-down line, or a retention step, sits in the retention lane.
  const incoming = new Map<string, LayoutEdge[]>(ids.map(id => [id, []]));
  const out = new Map<string, string[]>(ids.map(id => [id, []]));
  for (const l of links) {
    incoming.get(l.target)!.push(l);
    out.get(l.source)!.push(l.target);
  }
  const retention = new Set(
    ids.filter(id => incoming.get(id)!.some(leavesDownward) || isRetentionStep(byId.get(id)!.data))
  );

  // (d) Collapse loops, then rank the groups by longest path. A drop-down line weighs 0.
  const group = stronglyConnected(ids, out);
  const weight = new Map<string, number>();
  for (const l of links) {
    const a = group.get(l.source)!;
    const b = group.get(l.target)!;
    if (a === b) continue;
    const key = `${a}>${b}`;
    const w = leavesDownward(l) ? 0 : 1;
    weight.set(key, Math.max(weight.get(key) ?? 0, w));
  }
  const groupCount = new Set(group.values()).size;
  const indegree = new Array<number>(groupCount).fill(0);
  const next = Array.from({ length: groupCount }, () => [] as { to: number; w: number }[]);
  for (const [key, w] of weight) {
    const [a, b] = key.split('>').map(Number);
    next[a].push({ to: b, w });
    indegree[b]++;
  }
  const groupRank = new Array<number>(groupCount).fill(0);
  const queue: number[] = [];
  for (let g = 0; g < groupCount; g++) if (indegree[g] === 0) queue.push(g);
  while (queue.length > 0) {
    const g = queue.shift()!;
    for (const { to, w } of next[g]) {
      groupRank[to] = Math.max(groupRank[to], groupRank[g] + w);
      if (--indegree[to] === 0) queue.push(to);
    }
  }
  const rank = new Map(ids.map(id => [id, groupRank[group.get(id)!]]));

  // (e) Columns: each as wide as its widest card, cards centred in it so drop-down lines run straight.
  const ranks = [...new Set(rank.values())].sort((a, b) => a - b);
  const columns = new Map<number, string[]>(ranks.map(r => [r, []]));
  for (const id of ids) columns.get(rank.get(id)!)!.push(id);
  const colWidth = new Map<number, number>();
  const colX = new Map<number, number>();
  let x = LAYOUT_ORIGIN.x;
  for (const r of ranks) {
    const w = Math.max(...columns.get(r)!.map(id => size.get(id)!.width));
    colWidth.set(r, w);
    colX.set(r, x);
    x += w + COLUMN_GAP;
  }

  // (f) The main band's height does not depend on order.
  const stackHeight = (members: string[]) =>
    members.reduce((sum, id) => sum + size.get(id)!.height, 0) + ROW_GAP * Math.max(0, members.length - 1);
  let mainH = 0;
  for (const r of ranks) {
    mainH = Math.max(mainH, stackHeight(columns.get(r)!.filter(id => !retention.has(id))));
  }
  const midY = LAYOUT_ORIGIN.y + mainH / 2;
  const retentionTop = mainH > 0 ? LAYOUT_ORIGIN.y + mainH + LANE_GAP : LAYOUT_ORIGIN.y;

  const placed = new Map<string, Point>();
  const byCurrent = (a: string, b: string) =>
    byId.get(a)!.position.y - byId.get(b)!.position.y || order.get(a)! - order.get(b)!;

  // Siblings follow the handle they leave from; members with no placed parent keep their current order.
  const orderColumn = (members: string[]): string[] => {
    const score = new Map<string, number>();
    for (const id of members) {
      const fed = incoming.get(id)!.filter(l => placed.has(l.source));
      if (fed.length === 0) continue;
      const total = fed.reduce(
        (sum, l) => sum + placed.get(l.source)!.y + handleFraction(l.sourceHandle) * size.get(l.source)!.height,
        0
      );
      score.set(id, total / fed.length);
    }
    const first = members.filter(id => score.has(id)).sort((a, b) => score.get(a)! - score.get(b)! || byCurrent(a, b));
    const rest = members.filter(id => !score.has(id)).sort(byCurrent);
    return [...first, ...rest];
  };

  const stack = (list: string[], r: number, top: number) => {
    let y = top;
    for (const id of list) {
      const s = size.get(id)!;
      placed.set(id, { x: colX.get(r)! + (colWidth.get(r)! - s.width) / 2, y });
      y += s.height + ROW_GAP;
    }
  };

  for (const r of ranks) {
    const members = columns.get(r)!;
    const main = orderColumn(members.filter(id => !retention.has(id)));
    stack(main, r, midY - stackHeight(main) / 2);

    // (g) Retention band, top aligned. A step fed by a drop-down line from another step in this
    // column goes after it, so a child never sits above its parent. Chains are short.
    const lane = orderColumn(members.filter(id => retention.has(id)));
    const inLane = new Set(lane);
    for (let pass = 0, moved = true; moved && pass <= lane.length * lane.length; pass++) {
      moved = false;
      for (const l of links) {
        if (!leavesDownward(l) || !inLane.has(l.source) || !inLane.has(l.target)) continue;
        const from = lane.indexOf(l.source);
        const to = lane.indexOf(l.target);
        if (to < from) {
          lane.splice(to, 1);
          lane.splice(lane.indexOf(l.source) + 1, 0, l.target);
          moved = true;
        }
      }
    }
    stack(lane, r, retentionTop);
  }

  // (h) Unconnected steps: a row under everything, in array order.
  let bottom: number | null = null;
  for (const [id, p] of placed) {
    const b = p.y + size.get(id)!.height;
    bottom = bottom === null ? b : Math.max(bottom, b);
  }
  let looseX = LAYOUT_ORIGIN.x;
  const looseY = bottom === null ? LAYOUT_ORIGIN.y : bottom + LANE_GAP;
  for (const n of loose) {
    placed.set(n.id, { x: looseX, y: looseY });
    looseX += size.get(n.id)!.width + LOOSE_GAP;
  }

  // (i) Whole pixels, one entry per step, in the nodes' order.
  for (const n of nodes) {
    const p = placed.get(n.id)!;
    result.set(n.id, { x: Math.round(p.x), y: Math.round(p.y) });
  }
  return result;
}
