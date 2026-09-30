// How a person finds, names and moves between the steps of a journey, decided in one place.
// The docked step panel (StepDock), its finder, its connections list and the map's keyboard
// handling all read this module, so the finder's order, the Previous/Next walk and the name a
// screen reader speaks on the map never disagree. Pure: no React, no DOM beyond duck typing.
// The explicit .ts extension on the value import lets `node --test` load this file directly.

import type { JourneyEdge, JourneyNode } from '../types/journey';
import { EDGE_KINDS, EDGE_KIND_ORDER, edgeKind, isRetentionLink, isRetentionStep, type EdgeKind } from './edgeKinds.ts';
import { stepShortName } from './stepNames.ts';

export type PathGroup = 'Main path' | 'Retention flows';

/** The finder's groups, in the order they are listed. */
export const PATH_GROUPS: PathGroup[] = ['Main path', 'Retention flows'];

/** One classifier for the Show filter and the Step optgroups (Aura's journeyStepGroup). */
export function pathGroup(data: unknown): PathGroup {
  return isRetentionStep(data) ? 'Retention flows' : 'Main path';
}

/** The plain name of a step's type, as a person would say it. */
export function stepKindLabel(data: unknown): string {
  const d = data as { type?: unknown; offerType?: unknown } | null | undefined;
  switch (d?.type) {
    case 'ad-source': return 'Ad';
    case 'landing-page': return 'Landing page';
    case 'lead-form': return 'Form';
    case 'follow-up-sequence': return 'Follow-up';
    case 'thank-you': return 'Thank-you page';
    case 'upsell': return d.offerType === 'downsell' ? 'Downsell' : 'Upsell';
    case 'ab-split': return 'A/B split';
    default: return 'Step';
  }
}

type NamedStep = Pick<JourneyNode, 'data'> | { data?: unknown } | null | undefined;

/** The step's own label, trimmed, or '' when it has none. The one label rule: journeyWalk and
 *  connectionRules read it too, so a named step is called the same thing everywhere. */
export function stepLabel(node: NamedStep): string {
  const label = (node?.data as { label?: unknown } | undefined)?.label;
  return typeof label === 'string' ? label.trim() : '';
}

/** The step's own name, or a stand-in when it has none. */
export function stepName(node: NamedStep): string {
  return stepLabel(node) || 'Untitled step';
}

// What a screen reader says for a step on the map is the card's own wording plus its status
// ("Landing page /vip-consultation, draft"), decided in stepNames.ts with the line descriptions.
// Re-exported here so the finder, the dock and the map read one naming rule.
export { stepSpokenName, STEP_ARIA_LABELS } from './stepNames.ts';

type PlacedStep = Pick<JourneyNode, 'id' | 'position' | 'data'>;

/** Main path first, then left to right, then top to bottom, then id, so ties never shuffle. */
export function orderSteps<T extends PlacedStep>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const group = PATH_GROUPS.indexOf(pathGroup(a.data)) - PATH_GROUPS.indexOf(pathGroup(b.data));
    if (group !== 0) return group;
    const x = Math.round(a.position?.x ?? 0) - Math.round(b.position?.x ?? 0);
    if (x !== 0) return x;
    const y = (a.position?.y ?? 0) - (b.position?.y ?? 0);
    if (y !== 0) return y;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function normalizeQuery(query: string | null | undefined): string {
  return String(query ?? '').trim().toLowerCase().replace(/^\//, '');
}

/**
 * Search matches the step's name, its type or its page address, ignoring case and a leading '/'.
 * It also matches the card wording ("Downsell /mini-essentials/downsell"), the name the map,
 * Check design and the issue badges give a step, so any name the app shows finds the step.
 */
export function stepMatchesQuery(node: PlacedStep, query: string | null | undefined): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const slug = (node.data as { slug?: unknown } | undefined)?.slug;
  const haystacks = [stepName(node), stepKindLabel(node.data), typeof slug === 'string' ? slug : '', stepShortName(node)];
  return haystacks.some(h => h.toLowerCase().includes(q));
}

export type PathFilter = 'all' | PathGroup;

export interface StepListOptions {
  query?: string;
  filter?: PathFilter;
  selectedId?: string | null;
}

export interface StepListResult<T extends PlacedStep> {
  /** Every step, in finder order. */
  ordered: T[];
  /** The ordered ids that pass both the search and the Show filter. */
  matchIds: string[];
  /** The groups that have a visible step (a match, or the selected step). */
  groups: PathGroup[];
  /** The Show filter's options. Only 'all' unless the journey has both groups. */
  filters: PathFilter[];
}

export function stepList<T extends PlacedStep>(nodes: T[], options: StepListOptions = {}): StepListResult<T> {
  const { query = '', filter = 'all', selectedId = null } = options;
  const ordered = orderSteps(nodes);
  const matchIds = ordered
    .filter(n => (filter === 'all' || pathGroup(n.data) === filter) && stepMatchesQuery(n, query))
    .map(n => n.id);
  const matchSet = new Set(matchIds);
  // Aura keeps the selected option in the list even when the filters hide it.
  const visible = ordered.filter(n => matchSet.has(n.id) || n.id === selectedId);
  const groups = PATH_GROUPS.filter(g => visible.some(n => pathGroup(n.data) === g));
  const present = PATH_GROUPS.filter(g => ordered.some(n => pathGroup(n.data) === g));
  const filters: PathFilter[] = present.length >= 2 ? ['all', ...present] : ['all'];
  return { ordered, matchIds, groups, filters };
}

/**
 * The step Previous (-1) or Next (1) moves to. With nothing selected, Next opens the first match
 * and Previous the last. A selected step that the filters hide still has a place in the full
 * order, so the walk continues from there to the nearest match. Null at either end.
 */
export function neighbourStep(
  orderedIds: string[],
  matchIds: string[],
  currentId: string | null | undefined,
  dir: 1 | -1
): string | null {
  if (matchIds.length === 0) return null;
  if (!currentId) return dir === 1 ? matchIds[0] : matchIds[matchIds.length - 1];
  const start = orderedIds.indexOf(currentId);
  if (start === -1) return dir === 1 ? matchIds[0] : matchIds[matchIds.length - 1];
  const matches = new Set(matchIds);
  for (let i = start + dir; i >= 0 && i < orderedIds.length; i += dir) {
    if (matches.has(orderedIds[i])) return orderedIds[i];
  }
  return null;
}

/**
 * The kind of line ConversionEdge actually draws. The canvas builds each line's data by putting
 * a computed sourceHandle and isRetentionEdge first and then spreading the saved data over them
 * (JourneyCanvas sync effect), and ConversionEdge reads the merged fields. This does the same, so
 * the connections list shows the colour and dash that are on the map.
 */
export function lineKindOf(
  edge: Pick<JourneyEdge, 'sourceHandle' | 'data'>,
  targetNode: Pick<JourneyNode, 'data'> | null | undefined
): EdgeKind {
  const merged = {
    sourceHandle: edge.sourceHandle || undefined,
    isRetentionEdge: Boolean(edge.data?.isRetentionEdge || isRetentionLink(edge.sourceHandle, targetNode?.data)),
    ...(edge.data || {})
  } as { sourceHandle?: string | null; isRetentionEdge?: boolean };
  return edgeKind(merged.sourceHandle, targetNode?.data, merged.isRetentionEdge);
}

export interface StepLink {
  edgeId: string;
  /** The step at the other end of the line. */
  stepId: string;
  stepName: string;
  kind: EdgeKind;
  lineLabel: string;
}

export interface StepConnectionsResult {
  incoming: StepLink[];
  outgoing: StepLink[];
}

/** The lines into and out of a step, read from saved data, in legend order then map order. */
export function stepConnections(nodeId: string, nodes: JourneyNode[], edges: JourneyEdge[]): StepConnectionsResult {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const rank = new Map(orderSteps(nodes).map((n, i) => [n.id, i]));
  const link = (edge: JourneyEdge, otherId: string): StepLink | null => {
    const other = byId.get(otherId);
    if (!other || !byId.has(edge.source) || !byId.has(edge.target)) return null;
    const kind = lineKindOf(edge, byId.get(edge.target));
    return { edgeId: edge.id, stepId: other.id, stepName: stepName(other), kind, lineLabel: EDGE_KINDS[kind].label };
  };
  const sort = (links: StepLink[]) =>
    links.sort(
      (a, b) =>
        EDGE_KIND_ORDER.indexOf(a.kind) - EDGE_KIND_ORDER.indexOf(b.kind) ||
        (rank.get(a.stepId) ?? 0) - (rank.get(b.stepId) ?? 0)
    );
  const incoming = sort(edges.filter(e => e.target === nodeId).map(e => link(e, e.source)).filter((l): l is StepLink => l !== null));
  const outgoing = sort(edges.filter(e => e.source === nodeId).map(e => link(e, e.target)).filter((l): l is StepLink => l !== null));
  return { incoming, outgoing };
}

/** True when choosing this step must turn Retention Flows back on. The map hides by the same rule. */
export function revealsHiddenStep(node: Pick<JourneyNode, 'data'> | null | undefined, showRetention: boolean): boolean {
  return !showRetention && isRetentionStep(node?.data);
}

/** Space kept between a panned-to step and the map's edge, in screen pixels. */
export const PAN_MARGIN = 24;
/** Panning to a step never leaves the map zoomed out further than this. */
export const MIN_FOCUS_ZOOM = 0.75;
/** How long the pan takes, unless the person asked for reduced motion. */
export const PAN_DURATION_MS = 280;

export interface FlowRect { x: number; y: number; width: number; height: number }
export interface FlowViewport { x: number; y: number; zoom: number }
export interface PaneSize { width: number; height: number }

/**
 * Where to centre the map so a step is fully in view, or null when it already is (the map then
 * does not move, and its zoom is left alone). rect is in flow coordinates; the viewport maps
 * flow to screen as screen = flow * zoom + offset.
 */
export function panTarget(
  rect: FlowRect,
  viewport: FlowViewport,
  pane: PaneSize,
  margin: number = PAN_MARGIN,
  minZoom: number = MIN_FOCUS_ZOOM
): { x: number; y: number; zoom: number } | null {
  if (!(pane.width > 0) || !(pane.height > 0)) return null;
  const left = rect.x * viewport.zoom + viewport.x;
  const top = rect.y * viewport.zoom + viewport.y;
  const right = left + rect.width * viewport.zoom;
  const bottom = top + rect.height * viewport.zoom;
  const inside = left >= margin && top >= margin && right <= pane.width - margin && bottom <= pane.height - margin;
  if (inside) return null;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, zoom: Math.max(viewport.zoom, minZoom) };
}

interface KeyTarget {
  classList?: { contains(name: string): boolean };
  getAttribute?(name: string): string | null;
}

/**
 * What a key pressed on the map does. Only a step's own focusable wrapper counts, the element
 * React Flow selects on Enter or Space, so the map and the panel never disagree. A button inside
 * a card, a line, the pane or any other key is left alone.
 */
export function canvasKeyAction(
  key: string,
  target: KeyTarget | null | undefined
): { open: string } | { close: string } | null {
  if (!target?.classList?.contains('react-flow__node')) return null;
  const id = target.getAttribute?.('data-id');
  if (!id) return null;
  if (key === 'Enter' || key === ' ') return { open: id };
  if (key === 'Escape') return { close: id };
  return null;
}
