/**
 * Where a journey loses people: the funnel built from the journey's own steps.
 *
 * The Attribution page used to draw a fixed six-row funnel (page views, leads, checkouts and so
 * on) that had nothing to do with the steps on the map. This module orders the open journey's
 * steps along its path, compares each step with the steps that lead into it, and names the
 * biggest measured drop. The counts come from POST /api/funnel/stats, read through the same
 * snapshot rules the map uses (journeyMetrics: stageTotal for a step, sentAlongLine for a line), so
 * the card and the map agree.
 *
 * Pure functions only, so node tests can import this file. Its value imports carry an explicit
 * .ts extension for Node's type stripping.
 */
import { edgeKind, isRetentionLink, isRetentionStep } from './edgeKinds.ts';
import { stepKindLabel as kindLabelOf } from './stepNavigation.ts';
import { readStatsAnswer, sentAlongLine, stageTotal, statsRequestBody, nodeMeasure } from './journeyMetrics.ts';
import type { EdgeKind } from './edgeKinds';
import type { MetricsSnapshot, RangeDays } from './journeyMetrics';
import type { JourneyNode, JourneyEdge, NodeType } from '../types/journey';
import type { ServerAnswer } from './saveOutcome';

/**
 * A drop is named only when at least this many people were counted at the steps before it.
 * A product threshold: 3 people falling to 0 is not a leak worth sending anyone to fix.
 */
export const MIN_LEAK_BASE = 20;

export type FunnelTimeframe = '7d' | '30d' | 'all';

/**
 * The stats route counts 7, 30 or 90 days. The Attribution page's 'All time' reads as the longest
 * range the map keeps, and the card names the range it actually shows.
 */
export function timeframeDays(timeframe?: FunnelTimeframe | string | null): RangeDays {
  if (timeframe === '7d') return 7;
  if (timeframe === 'all') return 90;
  return 30;
}

/** One step's count. null means the step cannot be measured; 0 is a measured zero. */
export type StepCount = { count: number | null; why?: string };

/** Per step, the count; per line, the people it carries out of its source (null when unknown). */
export type FunnelStats = {
  steps: Record<string, StepCount>;
  edges: Record<string, { sourceThroughput: number | null }>;
};

export type FunnelRow = {
  nodeId: string;
  label: string;
  kind: NodeType;
  kindLabel: string;
  /** What the count counts, for example 'forms sent'. */
  unit: string;
  depth: number;
  count: number | null;
  why?: string;
  /** The visited steps that lead into this one. */
  fromIds: string[];
  fromLabel: string;
  /** People the steps before this one sent here, or null when that is unknown. */
  base: number | null;
  conversion: number | null;
  drop: number | null;
  lost: number | null;
};

export type JourneyFunnel = { rows: FunnelRow[]; leakIndex: number; hasData: boolean };

export type FunnelAnswer =
  | { kind: 'ok'; snapshot: MetricsSnapshot }
  | { kind: 'signed-out'; message: string }
  | { kind: 'failed'; message: string; retryable: boolean };

export const STEP_UNIT: Record<NodeType, string> = {
  'ad-source': 'ad visits',
  'landing-page': 'visitors',
  'lead-form': 'forms sent',
  'follow-up-sequence': 'enrolled',
  'thank-you': 'page views',
  upsell: 'offers taken',
  'ab-split': 'visitors split'
};

type NodeLike = Pick<JourneyNode, 'id' | 'type' | 'position'> & { data?: unknown };
type EdgeLike = Pick<JourneyEdge, 'id' | 'source' | 'target'> & { sourceHandle?: string | null; data?: unknown };

const dataOf = (node: NodeLike | null | undefined) => (node?.data || {}) as Record<string, unknown>;
const textOf = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The plain name of a step's type ('Ad', 'Follow-up', 'Downsell' and so on). One naming rule for
 * the whole app: stepNavigation's, which the finder and the docked panel read. The node's own type
 * is used when its data does not carry one.
 */
export function stepKindLabel(node: NodeLike): string {
  const data = dataOf(node);
  return kindLabelOf({ ...data, type: node.type || data.type });
}

const formatCount = (n: number) => n.toLocaleString('en-US');

/** The request body for POST /api/funnel/stats: the one builder the map's poll uses, for this range. */
export function funnelStatsRequest(
  journeyId: string,
  nodes: NodeLike[],
  edges: EdgeLike[],
  timeframe?: FunnelTimeframe
) {
  return statsRequestBody({ id: journeyId, nodes, edges }, timeframeDays(timeframe));
}

/** Turns the stats answer (or its absence) into a snapshot, or one 'Unavailable.' sentence. */
export function readFunnelAnswer(answer: ServerAnswer | null, journeyId: string, days: RangeDays): FunnelAnswer {
  if (!answer) {
    return { kind: 'failed', message: 'Unavailable. The server could not be reached.', retryable: true };
  }
  if (answer.status === 401 || answer.status === 403) {
    return { kind: 'signed-out', message: "Unavailable. Sign in to see this journey's measured counts." };
  }
  if (answer.status >= 500) {
    return { kind: 'failed', message: "Unavailable. The server could not count this journey's steps.", retryable: true };
  }
  if (answer.status < 200 || answer.status >= 300) {
    return { kind: 'failed', message: `Unavailable. The server answered with status ${answer.status}.`, retryable: false };
  }
  const snapshot = readStatsAnswer(answer.body, journeyId, days);
  if (!snapshot) {
    return { kind: 'failed', message: "Unavailable. The server's answer was not for this journey and range.", retryable: true };
  }
  return { kind: 'ok', snapshot };
}

/**
 * The funnel's counts from a snapshot: a step counts by stageTotal, the rule its card and lines
 * use, and a line carries its source's total (a split branch, its own share). A step the server
 * did not measure is null with the server's reason.
 */
export function funnelStats(nodes: NodeLike[], edges: EdgeLike[], snapshot: MetricsSnapshot): FunnelStats {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const typeOf = (n: NodeLike | undefined) => (n?.type || textOf(dataOf(n).type)) as NodeType;
  const steps: Record<string, StepCount> = {};
  for (const n of nodes) {
    const m = nodeMeasure(snapshot, n.id);
    const why = snapshot.coverage[n.id]?.why;
    steps[n.id] = m ? { count: stageTotal(typeOf(n), m) } : { count: null, ...(why ? { why } : {}) };
  }
  const lines: FunnelStats['edges'] = {};
  for (const e of edges) {
    const source = byId.get(e.source);
    lines[e.id] = { sourceThroughput: source ? sentAlongLine(typeOf(source), e.sourceHandle, nodeMeasure(snapshot, source.id)) : null };
  }
  return { steps, edges: lines };
}

const FUNNEL_KINDS = new Set<EdgeKind>(['main', 'accepted', 'split-a', 'split-b']);

const kindOf = (edge: EdgeLike, target: NodeLike | null | undefined): EdgeKind => {
  const data = (edge.data || {}) as { isRetentionEdge?: unknown };
  return edgeKind(
    edge.sourceHandle,
    target?.data,
    Boolean(data.isRetentionEdge || isRetentionLink(edge.sourceHandle, target?.data))
  );
};

/**
 * A line the funnel follows: the main path, an accepted offer or a split branch. Declined,
 * abandon, rescue and retention lines are the leaks themselves, so the funnel never walks them.
 * The kind is decided exactly as JourneyCanvas decides a line's colour.
 */
export function isFunnelLink(edge: EdgeLike, target: NodeLike | null | undefined, source?: NodeLike | null): boolean {
  if (!FUNNEL_KINDS.has(kindOf(edge, target))) return false;
  return !isRetentionStep(target?.data) && !isRetentionStep(source?.data);
}

const byPosition = (a: { node: NodeLike; index: number }, b: { node: NodeLike; index: number }, xFirst: boolean) => {
  const [pa, pb] = [a.node.position || { x: 0, y: 0 }, b.node.position || { x: 0, y: 0 }];
  const first = xFirst ? pa.x - pb.x : pa.y - pb.y;
  const second = xFirst ? pa.y - pb.y : pa.x - pb.x;
  return first || second || a.index - b.index;
};

/** The journey's steps in path order, each compared with the visited steps that lead into it. */
export function buildJourneyFunnel(nodes: NodeLike[], edges: EdgeLike[], stats: FunnelStats): JourneyFunnel {
  const indexed = nodes.map((node, index) => ({ node, index }));
  const byId = new Map(indexed.map(item => [item.node.id, item]));
  const steps = indexed.filter(item => !isRetentionStep(item.node.data));
  const stepIds = new Set(steps.map(item => item.node.id));
  const hasIncoming = new Set(edges.filter(e => byId.has(e.source) && e.source !== e.target).map(e => e.target));

  const funnelLinks = edges.filter(e => {
    if (!stepIds.has(e.source) || !stepIds.has(e.target)) return false;
    return isFunnelLink(e, byId.get(e.target)?.node, byId.get(e.source)?.node);
  });

  // Breadth first from the entries, over funnel links only. The first visit sets the depth and
  // the visited set stops a loop. A step no funnel link reaches is not a row.
  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue = steps.filter(item => !hasIncoming.has(item.node.id)).sort((a, b) => byPosition(a, b, true));
  for (const item of queue) {
    depth.set(item.node.id, 0);
    order.push(item.node.id);
  }
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const children = funnelLinks
      .filter(e => e.source === id && !depth.has(e.target))
      .map(e => byId.get(e.target)!)
      .sort((a, b) => byPosition(a, b, false));
    for (const child of children) {
      if (depth.has(child.node.id)) continue;
      depth.set(child.node.id, (depth.get(id) || 0) + 1);
      order.push(child.node.id);
    }
  }

  const labelOf = (node: NodeLike) => textOf(dataOf(node).label).trim() || stepKindLabel(node);
  const rows: FunnelRow[] = order.map(id => {
    const node = byId.get(id)!.node;
    const kind = node.type as NodeType;
    const d = depth.get(id)!;
    const step = stats.steps[id];
    const count = typeof step?.count === 'number' && Number.isFinite(step.count) ? step.count : null;

    // Forward parents only: a line back from a later step is a loop, not a source of people.
    const seen = new Set<string>();
    const parents = funnelLinks.filter(e => {
      if (e.target !== id || !depth.has(e.source) || depth.get(e.source)! >= d) return false;
      const key = `${e.source}\u0000${e.sourceHandle || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const fromIds = [...new Set(parents.map(e => e.source))];
    let base: number | null = parents.length ? 0 : null;
    for (const link of parents) {
      const sent = stats.edges[link.id]?.sourceThroughput;
      const parentCount = stats.steps[link.source]?.count;
      if (base === null || typeof parentCount !== 'number' || typeof sent !== 'number' || !Number.isFinite(sent)) {
        base = null;
        break;
      }
      base += sent;
    }

    let fromLabel = 'the steps before it';
    if (parents.length === 1) {
      const parent = byId.get(parents[0].source)!.node;
      const k = kindOf(parents[0], node);
      fromLabel = k === 'split-a' ? `${labelOf(parent)} branch A` : k === 'split-b' ? `${labelOf(parent)} branch B` : labelOf(parent);
    } else if (fromIds.length === 1) {
      fromLabel = labelOf(byId.get(fromIds[0])!.node);
    }

    let conversion: number | null = null;
    let drop: number | null = null;
    let lost: number | null = null;
    if (base !== null && base > 0 && count !== null) {
      conversion = count / base;
      drop = Math.max(0, 1 - conversion);
      lost = Math.max(0, base - count);
    }

    return {
      nodeId: id,
      label: labelOf(node),
      kind,
      kindLabel: stepKindLabel(node),
      unit: STEP_UNIT[kind] || 'people',
      depth: d,
      count,
      ...(step?.why && count === null ? { why: step.why } : {}),
      fromIds,
      fromLabel,
      base,
      conversion,
      drop,
      lost
    };
  });

  return { rows, leakIndex: biggestLeakIndex(rows), hasData: rows.some(r => (r.count ?? 0) > 0) };
}

/** The biggest measured drop over enough people; ties go to more people lost, then the earlier row. */
export function biggestLeakIndex(rows: FunnelRow[], minBase: number = MIN_LEAK_BASE): number {
  let best = -1;
  rows.forEach((row, i) => {
    if (row.drop === null || !(row.drop > 0) || row.count === null || row.base === null || row.base < minBase) return;
    if (best === -1) { best = i; return; }
    const top = rows[best];
    if (row.drop > top.drop! || (row.drop === top.drop && (row.lost ?? 0) > (top.lost ?? 0))) best = i;
  });
  return best;
}

export type LeakSummary = { nodeId: string | null; sentence: string; buttonLabel?: string };

/** The 'What this means' sentence and the button that goes back to the step on the map. */
export function leakSummary(rows: FunnelRow[], leakIndex: number): LeakSummary | null {
  const row = leakIndex >= 0 ? rows[leakIndex] : undefined;
  if (row && row.base !== null && row.count !== null && row.drop !== null) {
    const parentUnit = row.fromIds.length === 1
      ? STEP_UNIT[rows.find(r => r.nodeId === row.fromIds[0])?.kind as NodeType] || 'people'
      : '';
    const before = row.fromIds.length === 1
      ? `${row.fromLabel} (${formatCount(row.base)} ${parentUnit})`
      : `the steps before it (${formatCount(row.base)} in total)`;
    return {
      nodeId: row.nodeId,
      sentence: `The biggest drop is between ${before} and ${row.label} (${formatCount(row.count)} ${row.unit}). ${Math.round(row.drop * 100)}% did not go on.`,
      buttonLabel: `Show ${row.label} on the map`
    };
  }
  if (rows.some(r => (r.drop ?? 0) > 0)) {
    return {
      nodeId: null,
      sentence: `Too few people so far to name a leak. It needs at least ${MIN_LEAK_BASE} at the step before.`
    };
  }
  return null;
}

/** Why a step reads 'Unavailable', in one line. */
export function unavailableReason(why: string | undefined): string {
  if (why === 'no_campaign') return 'Add a UTM campaign to this ad to count its visits.';
  if (why === 'not_published') return 'Publish this page to count its visits.';
  if (why === 'no_source') return 'Connect a published page before this step.';
  if (why === 'not_by_page') return 'These emails are not sent from a page, so this journey cannot count them.';
  return 'This step cannot be measured.';
}
