import type { JourneyEdge, JourneyNode, NodeType } from '../types/journey';
// The explicit extension lets node import this file for its tests.
import { stripCanvasOnlyFields } from './canvasOnlyFields.ts';

// React Flow draws a line from the handle its edge names, or from the first handle when it names
// none, and a name the step does not have draws nothing. Maps saved before #6 named 'accepted' on
// a landing page, so that line stayed hidden. This is the one handle table for every step, in the
// cards' render order (null = the unnamed main handle). step-handles.test.mjs reads it back out of
// the node components, so a card that gains or renames a handle fails the suite until this agrees.

export type HandleSide = 'source' | 'target';

export const SOURCE_HANDLES: Readonly<Record<NodeType, readonly (string | null)[]>> = {
  'ad-source': [null],
  'landing-page': [null, 'abandon'],
  'lead-form': [null],
  'follow-up-sequence': [null],
  'thank-you': [],
  upsell: ['accepted', 'declined', 'rescue'],
  'ab-split': ['branch-a', 'branch-b']
};

export const TARGET_HANDLES: Readonly<Record<NodeType, readonly (string | null)[]>> = {
  'ad-source': [],
  'landing-page': [null],
  'lead-form': [null],
  'follow-up-sequence': [null, 'retention-in'],
  'thank-you': [null],
  upsell: [null],
  'ab-split': [null]
};

/** True when a step of this type renders a handle with this id on this side (no id = the main one). */
export function stepHasHandle(type: unknown, side: HandleSide, id?: string | null): boolean {
  const table = side === 'source' ? SOURCE_HANDLES : TARGET_HANDLES;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(table, type)) return false;
  return table[type as NodeType].includes(id || null);
}

// A name is dropped only when the step has a main handle to draw from instead. On an upsell or an
// A/B split React Flow would fall back to the first branch and claim a branch nobody chose.
function foreignName(type: unknown, side: HandleSide, name: unknown): boolean {
  return typeof name === 'string' && name !== ''
    && stepHasHandle(type, side, null)
    && !stepHasHandle(type, side, name);
}

/** Drops handle names a step does not have, from the edge and from its data. Same array when clean. */
export function repairEdgeHandles(nodes: JourneyNode[], edges: JourneyEdge[]): JourneyEdge[] {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return edges;
  // node.type is what JourneyCanvas's nodeTypes uses to pick the card, so it decides the handles.
  const typeOf = new Map<unknown, unknown>(nodes.map(n => [n?.id, n?.type]));
  let changed = false;
  const out = edges.map(edge => {
    if (!edge || typeof edge !== 'object') return edge;
    const sourceType = typeOf.get(edge.source);
    const targetType = typeOf.get(edge.target);
    const data = edge.data && typeof edge.data === 'object' ? edge.data : null;
    const dropSource = foreignName(sourceType, 'source', edge.sourceHandle);
    const dropTarget = foreignName(targetType, 'target', edge.targetHandle);
    const dropDataSource = !!data && foreignName(sourceType, 'source', data.sourceHandle);
    const dropDataTarget = !!data && foreignName(targetType, 'target', data.targetHandle);
    if (!dropSource && !dropTarget && !dropDataSource && !dropDataTarget) return edge;
    changed = true;
    const { sourceHandle, targetHandle, ...rest } = edge;
    const next: JourneyEdge = { ...rest };
    if (!dropSource && 'sourceHandle' in edge) next.sourceHandle = sourceHandle;
    if (!dropTarget && 'targetHandle' in edge) next.targetHandle = targetHandle;
    if (data && (dropDataSource || dropDataTarget)) {
      const { sourceHandle: dataSource, targetHandle: dataTarget, ...dataRest } = data;
      const nextData = { ...dataRest };
      if (!dropDataSource && 'sourceHandle' in data) nextData.sourceHandle = dataSource;
      if (!dropDataTarget && 'targetHandle' in data) nextData.targetHandle = dataTarget;
      next.data = nextData;
    }
    return next;
  });
  return changed ? out : edges;
}

/**
 * The one load-time repair for a whole journey: handle names a step does not have, and the
 * drawing-only fields journeys saved before C36 still carry (canvasOnlyFields.ts, R25). Same object
 * when clean. Never touches updatedAt: App adopts the server copy only when it is strictly newer,
 * so a repair that re-stamped the local map would hide the saved journey again. Every load path
 * baselines the autosave on what this returns, so the repair is neither an edit nor an undo step.
 */
export function repairJourneyHandles<T extends { nodes: JourneyNode[]; edges: JourneyEdge[] }>(project: T): T {
  const stripped = stripCanvasOnlyFields(project.nodes, project.edges);
  const edges = repairEdgeHandles(stripped.nodes, stripped.edges);
  if (stripped.nodes === project.nodes && edges === project.edges) return project;
  return { ...project, nodes: stripped.nodes, edges };
}
