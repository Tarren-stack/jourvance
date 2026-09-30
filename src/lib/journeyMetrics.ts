/**
 * Honest numbers on the journey map (#9, after Aura's journeyMetrics).
 *
 * Every figure on the map reads ONE stats snapshot for this journey and the chosen 7, 30 or 90
 * day range, held outside the journey (App state plus a canvas React context). Nothing here is
 * written into node or edge data, so a stats poll never changes the project, never enters undo
 * history and is never saved. A figure the server did not measure reads 'Unavailable', never 0.
 *
 * The contract is POST /api/funnel/stats in server/routes/analyticsRoutes.mjs:
 *   body   {journeyId, days 7|30|90, nodes, edges}
 *   answer {success, journeyId, days, from, to, partialSince, stats.nodes, coverage}
 * statsRequestBody is the one request builder; the Attribution leak finder uses it too.
 *
 * Pure functions only, so node tests can import this file: value imports carry an explicit .ts
 * extension and types come in with `import type`.
 */
import { edgeMetricFor, edgeStatus, MIN_GRADE_SAMPLE } from './conversionBenchmarks.ts';
import { edgeKind, isRetentionLink, lineRateMeasured, lineShowsDelay } from './edgeKinds.ts';
import type { EdgeMetricDef, EdgeStatusInfo } from './conversionBenchmarks';
import type { JourneyEdge, JourneyNode, NodeType } from '../types/journey';

// ── Basis and range ───────────────────────────────────────────────────────────

/** Where a figure came from. Jourvance has no demo numbers, so nothing emits 'Demo'. */
export type Basis = 'Measured' | 'Estimated' | 'Demo';
export type RangeDays = 7 | 30 | 90;

export const RANGE_DAYS: RangeDays[] = [7, 30, 90];
export const DEFAULT_RANGE_DAYS: RangeDays = 30;
export const UNAVAILABLE = 'Unavailable';

const RANGE_KEY = 'jourvance_stats_days';

/** 7, 30 or 90. Anything else is the default 30. */
export function normalizeRangeDays(v: unknown): RangeDays {
  const n = Number(v);
  return n === 7 || n === 30 || n === 90 ? n : DEFAULT_RANGE_DAYS;
}

export function rangeLabel(days: RangeDays): string {
  return `Last ${days} days`;
}

/** The range this browser last chose. No storage (Node, a private window) reads as 30. */
export function readStoredRange(): RangeDays {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_RANGE_DAYS;
    return normalizeRangeDays(localStorage.getItem(RANGE_KEY));
  } catch {
    return DEFAULT_RANGE_DAYS;
  }
}

export function writeStoredRange(days: RangeDays): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RANGE_KEY, String(normalizeRangeDays(days)));
  } catch {
    /* storage blocked: the range lasts until reload */
  }
}

// ── Snapshot and state ────────────────────────────────────────────────────────

/** One step's figures. null means the server could not measure that figure. */
export type NodeMeasure = Record<string, number | null>;

export type CoverageWhy = 'not_published' | 'no_campaign' | 'no_source' | 'not_by_page';

export interface NodeCoverage {
  measured: boolean;
  why?: CoverageWhy;
  /** 'flow': the figures cover the whole linked email flow, not just this journey. */
  scope?: 'flow';
}

export interface MetricsSnapshot {
  journeyId: string;
  days: RangeDays;
  from: string;
  to: string;
  /** Set when the event store no longer reaches back to the start of the range. */
  partialSince: string | null;
  nodes: Record<string, NodeMeasure>;
  coverage: Record<string, NodeCoverage>;
}

export type MetricsState =
  | { status: 'signed-out' }
  | { status: 'loading' | 'failed'; journeyId: string; days: RangeDays }
  | { status: 'ready'; snapshot: MetricsSnapshot };

/** What the map shows: a snapshot only when it is for this journey and this range. */
export interface MetricsView {
  status: 'signed-out' | 'loading' | 'failed' | 'ready';
  days: RangeDays;
  snapshot: MetricsSnapshot | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const WHY = new Set<CoverageWhy>(['not_published', 'no_campaign', 'no_source', 'not_by_page']);

/**
 * The snapshot in a stats answer, or null. The answer must say success and echo the same journey
 * and range, so a slow answer for the other range is never shown. Each node field keeps only a
 * finite number; anything else becomes null.
 */
export function readStatsAnswer(body: unknown, journeyId: string, days: RangeDays): MetricsSnapshot | null {
  if (!isRecord(body) || body.success !== true) return null;
  if (body.journeyId !== journeyId || body.days !== days) return null;
  const stats = body.stats;
  if (!isRecord(stats) || !isRecord(stats.nodes)) return null;

  const nodes: Record<string, NodeMeasure> = {};
  for (const [id, raw] of Object.entries(stats.nodes)) {
    if (!isRecord(raw)) continue;
    const m: NodeMeasure = {};
    for (const [key, value] of Object.entries(raw)) m[key] = finite(value) ? value : null;
    nodes[id] = m;
  }

  const rawCoverage = isRecord(body.coverage) ? body.coverage : {};
  const coverage: Record<string, NodeCoverage> = {};
  for (const id of new Set([...Object.keys(nodes), ...Object.keys(rawCoverage)])) {
    const c = rawCoverage[id];
    if (isRecord(c)) {
      const row: NodeCoverage = { measured: c.measured === true };
      if (WHY.has(c.why as CoverageWhy)) row.why = c.why as CoverageWhy;
      if (c.scope === 'flow') row.scope = 'flow';
      coverage[id] = row;
    } else {
      // No coverage row: measured only if the server sent a real number for it.
      coverage[id] = { measured: Object.values(nodes[id] || {}).some(finite) };
    }
  }

  return {
    journeyId,
    days,
    from: typeof body.from === 'string' ? body.from : '',
    to: typeof body.to === 'string' ? body.to : '',
    partialSince: typeof body.partialSince === 'string' && body.partialSince ? body.partialSince : null,
    nodes,
    coverage
  };
}

const matches = (snapshot: MetricsSnapshot, journeyId: string, days: RangeDays) =>
  snapshot.journeyId === journeyId && snapshot.days === days;

export function metricsView(state: MetricsState, journeyId: string, days: RangeDays): MetricsView {
  if (state.status === 'signed-out') return { status: 'signed-out', days, snapshot: null };
  if (state.status === 'ready') {
    return matches(state.snapshot, journeyId, days)
      ? { status: 'ready', days, snapshot: state.snapshot }
      : { status: 'loading', days, snapshot: null };
  }
  if (state.journeyId === journeyId && state.days === days) return { status: state.status, days, snapshot: null };
  return { status: 'loading', days, snapshot: null };
}

/** A new request is on its way. A snapshot for the same journey and range stays on screen. */
export function metricsLoading(prev: MetricsState, journeyId: string, days: RangeDays): MetricsState {
  if (prev.status === 'ready' && matches(prev.snapshot, journeyId, days)) return prev;
  return { status: 'loading', journeyId, days };
}

/** The request failed. A snapshot for the same journey and range stays on screen. */
export function metricsFailed(prev: MetricsState, journeyId: string, days: RangeDays): MetricsState {
  if (prev.status === 'ready' && matches(prev.snapshot, journeyId, days)) return prev;
  return { status: 'failed', journeyId, days };
}

// ── The request ───────────────────────────────────────────────────────────────

type NodeLike = { id: string; type?: string; data?: unknown };
type EdgeLike = { id: string; source: string; target: string; sourceHandle?: string | null };

const dataOf = (node: NodeLike | null | undefined) => (isRecord(node?.data) ? node!.data : {}) as Record<string, unknown>;
const textOf = (v: unknown) => (typeof v === 'string' ? v : '');
const typeOf = (node: NodeLike | null | undefined) => (node?.type || textOf(dataOf(node).type)) as NodeType | '';

/** The one body for POST /api/funnel/stats. Only the fields the server reads, never the counts. */
export function statsRequestBody(project: { id: string; nodes: NodeLike[]; edges: EdgeLike[] }, days: RangeDays) {
  return {
    journeyId: project.id,
    days: normalizeRangeDays(days),
    nodes: project.nodes.map(n => {
      const d = dataOf(n);
      return {
        id: n.id,
        type: typeOf(n),
        slug: textOf(d.slug),
        utmCampaign: textOf(d.utmCampaign),
        offerType: textOf(d.offerType),
        spend: finite(d.spend) ? d.spend : 0,
        jourvanceFlowId: textOf(d.jourvanceFlowId),
        // An unlinked follow-up counts only enrolments of its own kind of sequence.
        ...(typeOf(n) === 'follow-up-sequence' ? { sequenceType: textOf(d.sequenceType) } : {})
      };
    }),
    edges: project.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || null }))
  };
}

// ── Reading a step ────────────────────────────────────────────────────────────

/** A step's figures, or null when there is no snapshot or the server did not measure the step. */
export function nodeMeasure(snapshot: MetricsSnapshot | null, nodeId: string): NodeMeasure | null {
  if (!snapshot) return null;
  if (!snapshot.coverage[nodeId]?.measured) return null;
  return snapshot.nodes[nodeId] || null;
}

export function measureValue(m: NodeMeasure | null | undefined, key: string): number | null {
  const v = m?.[key];
  return finite(v) ? v : null;
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function countText(v: number | null | undefined): string {
  return finite(v) ? v.toLocaleString('en-US') : UNAVAILABLE;
}

/** One decimal: '12.5%'. */
export function percentText(v: number | null | undefined): string {
  return finite(v) ? `${v.toFixed(1)}%` : UNAVAILABLE;
}

/** Whole dollars by default; moneyText(v, 2) for cents. */
export function moneyText(v: number | null | undefined, decimals = 0): string {
  if (!finite(v)) return UNAVAILABLE;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A percentage, or null without a denominator. Never above 100. */
export function rateOf(count: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!finite(count) || !finite(denominator) || denominator <= 0) return null;
  return Math.min(100, round1((count / denominator) * 100));
}

// ── Split tests ───────────────────────────────────────────────────────────────

/**
 * The one sample rule for calling a split (C23): each branch needs this many measured visitors
 * before the confidence test runs, and nothing names a leader or prints a lift until it has. It
 * is the same floor a line grade uses, and the edge playbook's split tip asks for it too.
 */
export const MIN_SPLIT_BRANCH_SAMPLE = MIN_GRADE_SAMPLE;

export type SplitTest =
  | { ran: false; reason: 'unmeasured' | 'too_few_visits' | 'nothing_to_compare' }
  | {
      ran: true;
      /** Two-proportion z-test confidence, 0 to 99.9. */
      confidence: number;
      zScore: number;
      pValue: number;
      isSignificant: boolean;
      /** The branch converting at the higher rate, or null on a tie. */
      leader: 'a' | 'b' | null;
      /** The leader's relative lift over the other branch in percent, or null with a zero base. */
      lift: number | null;
    };

/**
 * The split card, the page card's variant pod and the split editor all read this. Any figure
 * missing, a branch under MIN_SPLIT_BRANCH_SAMPLE, or no spread to test (no conversions, or every
 * visitor converted) means the test did not run, which reads 'Unavailable', never 0% confidence.
 */
export function splitTest(
  visA: number | null | undefined,
  convA: number | null | undefined,
  visB: number | null | undefined,
  convB: number | null | undefined
): SplitTest {
  if (!finite(visA) || !finite(convA) || !finite(visB) || !finite(convB)) return { ran: false, reason: 'unmeasured' };
  if (visA < MIN_SPLIT_BRANCH_SAMPLE || visB < MIN_SPLIT_BRANCH_SAMPLE) return { ran: false, reason: 'too_few_visits' };
  const p1 = Math.min(1, Math.max(0, convA / visA));
  const p2 = Math.min(1, Math.max(0, convB / visB));
  const pPool = (p1 * visA + p2 * visB) / (visA + visB);
  const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / visA + 1 / visB));
  if (!(sePool > 0)) return { ran: false, reason: 'nothing_to_compare' };

  const z = Math.abs((p1 - p2) / sePool);
  // Standard normal CDF approximation (Abramowitz & Stegun formula)
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014337;
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pValue = 2 * (d * Math.exp(-0.5 * z * z) * poly);
  const confidence = Math.min(99.9, Math.max(0, Number(((1 - pValue) * 100).toFixed(1))));

  const leader = p1 > p2 ? 'a' : p2 > p1 ? 'b' : null;
  const base = leader === 'a' ? p2 : p1;
  const lift = leader && base > 0 ? round1((Math.abs(p1 - p2) / base) * 100) : null;
  return {
    ran: true,
    confidence,
    zScore: Number(z.toFixed(2)),
    pValue: Number(pValue.toFixed(4)),
    isSignificant: confidence >= 95.0,
    leader,
    lift
  };
}

/** 'Sep 12' in the viewer's own time zone. */
export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The sentence for a map with no snapshot to read. */
export function metricsStatusNote(view: MetricsView | null): string {
  if (!view) return 'Numbers unavailable.';
  if (view.status === 'signed-out') return 'Sign in to see numbers.';
  if (view.status === 'loading') return 'Loading numbers.';
  if (view.status === 'failed') return 'Numbers could not be loaded.';
  return view.snapshot ? '' : 'Loading numbers.';
}

const WHY_NOTE: Record<CoverageWhy, string> = {
  not_published: 'Unavailable. Publish this page to measure it.',
  no_campaign: 'Unavailable. Add a campaign tag to this ad to measure it.',
  no_source: 'Unavailable. Connect a published page before this step.',
  not_by_page: 'Unavailable. These emails are not sent from a page, so this journey cannot count them.'
};

/** The one basis line under a card: the range it was measured over, or why it was not. */
export function nodeNote(view: MetricsView | null, nodeId: string): string {
  if (!view || view.status !== 'ready' || !view.snapshot) return metricsStatusNote(view);
  const snap = view.snapshot;
  const cov = snap.coverage[nodeId];
  // A step added since the last answer: the next poll counts it.
  if (!cov) return 'Loading numbers.';
  if (!cov.measured) return cov.why ? WHY_NOTE[cov.why] : 'Unavailable.';
  const flow = cov.scope === 'flow' ? ', whole flow' : '';
  if (snap.partialSince) return `Measured since ${shortDate(snap.partialSince)}${flow}. Older visits were not kept.`;
  return `Measured, last ${snap.days} days${flow}`;
}

/** The legend footer. */
export function legendNote(view: MetricsView | null): string {
  if (!view || view.status !== 'ready' || !view.snapshot) return metricsStatusNote(view);
  const snap = view.snapshot;
  if (snap.partialSince) return `Since ${shortDate(snap.partialSince)}. Older visits were not kept. Est. marks an estimate.`;
  return `${rangeLabel(snap.days)}. Est. marks an estimate.`;
}

// ── Steps and lines ───────────────────────────────────────────────────────────

/** The one count each step shows, and the count a line out of it starts from. */
export function stageTotal(type: NodeType | string | null | undefined, m: NodeMeasure | null): number | null {
  if (!m) return null;
  switch (type) {
    case 'ad-source': return measureValue(m, 'clicks');
    case 'ab-split': {
      const a = measureValue(m, 'branchAVisitors');
      const b = measureValue(m, 'branchBVisitors');
      return a === null || b === null ? null : a + b;
    }
    case 'landing-page': return measureValue(m, 'visitors');
    case 'lead-form': return measureValue(m, 'submissions');
    case 'follow-up-sequence': return measureValue(m, 'flowEnrolled');
    case 'thank-you': return measureValue(m, 'pageViews');
    case 'upsell': return measureValue(m, 'takes');
    default: return null;
  }
}

/** People a line carries out of its source: a split branch sends its own share, any other step its total. */
export function sentAlongLine(sourceType: NodeType | string | null | undefined, sourceHandle: string | null | undefined, m: NodeMeasure | null): number | null {
  if (sourceType === 'ab-split') return measureValue(m, sourceHandle === 'branch-b' ? 'branchBVisitors' : 'branchAVisitors');
  return stageTotal(sourceType, m);
}

/** A retention step's wait, as set on the step. */
export function retentionDelayText(data: unknown): string {
  const hours = isRecord(data) ? data.delayHours : undefined;
  if (finite(hours) && hours > 0) return `${hours}h wait`;
  if (hours === 0) return 'No wait';
  return 'Wait not set';
}

export interface EdgeFigure {
  def: EdgeMetricDef;
  count: number | null;
  denominator: number | null;
  rate: number | null;
  /** null when a figure the line needs was not measured. */
  basis: Basis | null;
  status: EdgeStatusInfo;
  delayText?: string;
  /** Why this line reads Unavailable when the view itself is fine (an ad's side or extra line). */
  note?: string;
}

export interface EdgeFigureInput {
  sourceType?: NodeType | string | null;
  targetType?: NodeType | string | null;
  sourceHandle?: string | null;
  targetData?: unknown;
  /** The map draws this line as a retention flow (edgeKind), so its figure is named as one. */
  drawnAsRetention?: boolean;
  source: NodeMeasure | null;
  target: NodeMeasure | null;
  /**
   * How many lines leave this ad for a step other than a follow-up (adRoutingLines). The ad's
   * visit count is its whole campaign, so only a lone routing line can claim it. Left out, the
   * count the stats answer took from the same map (the ad's routingLines) decides.
   */
  adRoutingLines?: number;
}

/** The ad's visits go to the page it routes to; a follow-up off the ad is a side line (isFollowUpLine). */
export const AD_SIDE_LINE_NOTE = "This ad's visits are counted on its line into a page, not on a line into a follow-up.";
export const AD_FAN_OUT_NOTE = "This ad has more than one line into a page, and its visits are not counted per page.";

/** A measured rate from the source step's own figures for this branch. */
const measuredPart = (source: NodeMeasure | null, part: string, whole: string) => {
  const count = measureValue(source, part);
  const denominator = measureValue(source, whole);
  return { count, denominator, rate: rateOf(count, denominator), basis: count !== null && denominator !== null ? 'Measured' as const : null };
};

/**
 * A line's figure. Its rate is the source step's own measured figure for that branch; any other
 * line is estimated from the two step totals, capped at 100% and never graded.
 */
export function edgeFigure(input: EdgeFigureInput): EdgeFigure {
  const def = edgeMetricFor(input.sourceType, input.targetType, input.sourceHandle, input.targetData, input.drawnAsRetention);
  const { source, target } = input;
  let part: Omit<EdgeFigure, 'def' | 'status' | 'delayText'>;
  let delayText: string | undefined;
  let note: string | undefined;

  switch (def.id) {
    case 'ad-visits': {
      // The server counts every visit in the journey tagged with the ad's campaign
      // (analyticsRoutes.mjs, the ad-source branch), so the count belongs to one routing line only.
      // The answer also says how many routing lines the ad had in the map it counted, so a reader
      // with no line list (the line inspector) reaches the same verdict as the map's pill.
      const lines = Math.max(input.adRoutingLines ?? 1, measureValue(source, 'routingLines') ?? 1);
      note = input.targetType === 'follow-up-sequence'
        ? AD_SIDE_LINE_NOTE
        : lines > 1 ? AD_FAN_OUT_NOTE : undefined;
      const count = note ? null : measureValue(source, 'clicks');
      part = { count, denominator: null, rate: null, basis: count === null ? null : 'Measured' };
      break;
    }
    case 'split-share': {
      const count = sentAlongLine('ab-split', input.sourceHandle, source);
      const denominator = stageTotal('ab-split', source);
      part = { count, denominator, rate: rateOf(count, denominator), basis: count !== null && denominator !== null ? 'Measured' : null };
      break;
    }
    case 'retention': {
      const count = measureValue(target, 'flowEnrolled');
      part = { count, denominator: null, rate: null, basis: count === null ? null : 'Measured' };
      // The wait happens before a follow-up sends, so only a line into one shows it.
      if (lineShowsDelay(true, input.targetType)) delayText = retentionDelayText(input.targetData);
      break;
    }
    case 'decline': part = measuredPart(source, 'totalDeclines', 'views'); break;
    case 'take': part = measuredPart(source, 'takes', 'views'); break;
    case 'opt-in': part = measuredPart(source, 'leads', 'visitors'); break;
    case 'conversion': part = measuredPart(source, 'conversions', 'visitors'); break;
    case 'sequence-click': part = measuredPart(source, 'flowClicked', 'flowSent'); break;
    default: {
      const s = stageTotal(input.sourceType, source);
      const t = stageTotal(input.targetType, target);
      // A follow-up's enrolments over the next step's count is not a click or a rescue rate, so a
      // line out of a sequence has no estimate until it has a real measure (lineRateMeasured).
      part = s === null || t === null || !lineRateMeasured(input.sourceType)
        ? { count: null, denominator: null, rate: null, basis: null }
        : { count: Math.min(s, t), denominator: s, rate: rateOf(t, s), basis: 'Estimated' };
    }
  }

  const figure: EdgeFigure = { def, ...part, status: edgeStatus(def, part) };
  if (delayText !== undefined) figure.delayText = delayText;
  if (note !== undefined) figure.note = note;
  return figure;
}

type FlowNode = Pick<JourneyNode, 'id'> & { type?: string; data?: unknown };
type FlowEdge = Pick<JourneyEdge, 'id' | 'source' | 'target'> & { sourceHandle?: string | null; data?: { isRetentionEdge?: unknown } };

/**
 * How many lines leave this step for a step other than a follow-up sequence. For an ad that is
 * its routing lines: the map allows one (connectionRules.ts checkConnection), older journeys may
 * hold more.
 */
export function adRoutingLines(sourceId: string, nodes: readonly FlowNode[], edges: readonly FlowEdge[]): number {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return edges.filter(e => e.source === sourceId && typeOf(byId.get(e.target)) !== 'follow-up-sequence').length;
}

/**
 * edgeFigure for one line on the map, reading the current view. The map passes the ad's routing
 * line count (adRoutingLines) for a line out of an ad; left out, the ad's routingLines in the
 * stats answer, taken from the same map, stands in, so an ad that fans out claims its visits on
 * no line either way.
 */
export function figureForEdge(edge: FlowEdge, sourceNode: FlowNode | null, targetNode: FlowNode | null, view: MetricsView | null, adLines?: number): EdgeFigure {
  const snapshot = view?.status === 'ready' ? view.snapshot : null;
  return edgeFigure({
    sourceType: typeOf(sourceNode),
    targetType: typeOf(targetNode),
    sourceHandle: edge.sourceHandle,
    targetData: targetNode?.data,
    // The same test the map draws the line with, so the panel names it as the pill does.
    drawnAsRetention: edgeKind(edge.sourceHandle, targetNode?.data, Boolean(edge.data?.isRetentionEdge || isRetentionLink(edge.sourceHandle, targetNode?.data))) === 'retention',
    source: sourceNode ? nodeMeasure(snapshot, sourceNode.id) : null,
    target: targetNode ? nodeMeasure(snapshot, targetNode.id) : null,
    adRoutingLines: adLines
  });
}

// ── What a line says ──────────────────────────────────────────────────────────

/** 'last 30 days', or 'since Sep 12' when the event store no longer reaches back that far. */
export function rangeText(view: MetricsView | null): string {
  const snap = view?.status === 'ready' ? view.snapshot : null;
  if (snap?.partialSince) return `since ${shortDate(snap.partialSince)}`;
  return `last ${snap?.days ?? view?.days ?? DEFAULT_RANGE_DAYS} days`;
}

/** The value on a line's pill. Only a measured or estimated rate is a percentage. */
export function edgePillValue(f: EdgeFigure | null): string {
  if (!f) return UNAVAILABLE;
  if (f.def.id === 'retention') return f.delayText ?? countText(f.count);
  if (f.def.id === 'ad-visits') return countText(f.count);
  if (f.status.status === 'no_traffic') return '0 visits';
  if (f.rate === null) return UNAVAILABLE;
  return f.basis === 'Estimated' ? `Est. ${percentText(f.rate)}` : percentText(f.rate);
}

/** '(12)' after the value: the enrolled count on a retention line, the count behind a rate otherwise. */
export function edgePillCount(f: EdgeFigure | null): string | null {
  if (!f || f.count === null || f.def.id === 'ad-visits') return null;
  if (f.def.id === 'retention') return f.delayText ? `(${countText(f.count)})` : null;
  if (f.rate !== null) return `(${countText(f.count)})`;
  return null;
}

/** Why a line reads Unavailable. Pass the figure so an ad's side or extra line says why. */
export function edgeUnavailableReason(view: MetricsView | null, f?: EdgeFigure | null): string {
  if (!view || view.status !== 'ready' || !view.snapshot) return metricsStatusNote(view);
  if (f?.note) return f.note;
  return 'This line has no measured numbers for this range.';
}

/**
 * The one sentence a pill gives as its title and accessible name: the name, the value, what it
 * is out of, and whether it was measured or estimated over which range.
 */
export function edgeSentence(f: EdgeFigure | null, view: MetricsView | null): string {
  if (!f) return `Line: ${UNAVAILABLE}. ${edgeUnavailableReason(view)}`;
  if (!f.basis) {
    // A retention line still shows the wait set on its follow-up; only the enrolled count is missing.
    if (f.delayText) return `${f.def.name}: ${f.delayText}, set on the step. Enrolled: ${UNAVAILABLE}. ${edgeUnavailableReason(view, f)}`;
    return `${f.def.name}: ${UNAVAILABLE}. ${edgeUnavailableReason(view, f)}`;
  }
  let value = edgePillValue(f);
  if (f.def.id === 'retention') value = f.delayText ? `${f.delayText} (${countText(f.count)} enrolled)` : `${countText(f.count)} enrolled`;
  else if (f.def.id === 'ad-visits') value = `${countText(f.count)} visits`;
  else if (f.count !== null && f.denominator !== null) value += ` (${countText(f.count)} of ${countText(f.denominator)})`;
  return `${f.def.name}: ${value}. ${f.basis}, ${rangeText(view)}. Open for details.`;
}

/** What the inspector says about a retention step's wait: it is set on the step. */
export function retentionDelaySentence(data: unknown): string {
  const hours = isRecord(data) ? data.delayHours : undefined;
  if (finite(hours) && hours > 0) return `Set on this step: ${hours}h before the first message.`;
  if (hours === 0) return 'Set on this step: no wait before the first message.';
  return 'No wait is set on this step yet.';
}

export interface NodeMetrics {
  measure: NodeMeasure | null;
  note: string;
}

/** What the canvas context holds: every card's figures and basis line, and every line's figure. */
export interface CanvasMetrics {
  view: MetricsView | null;
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, EdgeFigure>;
}

export function buildCanvasMetrics(nodes: FlowNode[], edges: FlowEdge[], view: MetricsView | null): CanvasMetrics {
  const snapshot = view?.status === 'ready' ? view.snapshot : null;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const nodeMetrics: Record<string, NodeMetrics> = {};
  for (const n of nodes) nodeMetrics[n.id] = { measure: nodeMeasure(snapshot, n.id), note: nodeNote(view, n.id) };
  const edgeFigures: Record<string, EdgeFigure> = {};
  for (const e of edges) {
    const source = byId.get(e.source) || null;
    const adLines = typeOf(source) === 'ad-source' ? adRoutingLines(e.source, nodes, edges) : undefined;
    edgeFigures[e.id] = figureForEdge(e, source, byId.get(e.target) || null, view, adLines);
  }
  return { view, nodes: nodeMetrics, edges: edgeFigures };
}

// ── Money and totals ──────────────────────────────────────────────────────────

const priceOf = (v: unknown): number | null => {
  if (finite(v)) return v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The order value the leak card prices lost conversions with: the step's measured average
 * order, then the price set on the step (an estimate, and named as the price), then nothing.
 */
export function leakAov(sourceMeasure: NodeMeasure | null, sourceData: unknown): { value: number | null; basis: Basis | null } {
  const gross = measureValue(sourceMeasure, 'grossRevenue');
  const orders = measureValue(sourceMeasure, 'liveOrders');
  if (gross !== null && orders !== null && orders > 0) return { value: Math.round((gross / orders) * 100) / 100, basis: 'Measured' };
  const d = isRecord(sourceData) ? sourceData : {};
  const type = textOf(d.type);
  const price = type === 'upsell'
    ? priceOf(d.productPrice)
    : type === 'landing-page'
      ? priceOf(d.shopifyProductPrice)
      : priceOf(d.shopifyProductPrice) ?? priceOf(d.productPrice);
  return price === null ? { value: null, basis: null } : { value: price, basis: 'Estimated' };
}

export interface JourneyTotals {
  /** The ad spend the user entered. Never measured, so never null. */
  spend: number;
  visitors: number | null;
  leads: number | null;
  leadRate: number | null;
  gross: number | null;
  bumpRate: number | null;
  /** Gross over entered spend: an estimate, because the spend is typed in. */
  roas: number | null;
}

/** The toolbar totals, summed over the landing pages the snapshot measured. */
export function journeyTotals(nodes: FlowNode[], snapshot: MetricsSnapshot | null): JourneyTotals {
  let spend = 0;
  const sums = { visitors: null as number | null, leads: null as number | null, gross: null as number | null, bumps: null as number | null, orders: null as number | null };
  const add = (key: keyof typeof sums, v: number | null) => { if (v !== null) sums[key] = (sums[key] ?? 0) + v; };
  for (const n of nodes) {
    const type = typeOf(n);
    if (type === 'ad-source') {
      const s = dataOf(n).spend;
      if (finite(s) && s > 0) spend += s;
    }
    if (type !== 'landing-page') continue;
    const m = nodeMeasure(snapshot, n.id);
    if (!m) continue;
    add('visitors', measureValue(m, 'visitors'));
    add('leads', measureValue(m, 'leads'));
    add('gross', measureValue(m, 'grossRevenue'));
    add('bumps', measureValue(m, 'orderBumpTakes'));
    add('orders', measureValue(m, 'liveOrders'));
  }
  return {
    spend,
    visitors: sums.visitors,
    leads: sums.leads,
    leadRate: rateOf(sums.leads, sums.visitors),
    gross: sums.gross === null ? null : Math.round(sums.gross * 100) / 100,
    bumpRate: rateOf(sums.bumps, sums.orders),
    roas: sums.gross !== null && sums.gross > 0 && spend > 0 ? round1(sums.gross / spend) : null
  };
}
