// How the journey map's lines read as a graph, decided in one place (#10, Aura's validateFunnel).
// Which exits each step has and which of them need a destination, which lines React Flow can
// actually draw, what a traffic source reaches, and which lines close a loop. The design checks
// read this, and so can the add-step picker, tidy layout, path focus and the connections list.
// The handle literals live only in stepHandles.ts (#31), the loop detector only in
// connectionRules.ts (#13) and the step names only in stepNames.ts (#19); this file adds what
// each exit is called and whether a journey needs it filled.
// Pure: no React, no DOM. Value imports carry .ts so `node --test` loads this file directly, and
// type imports are whole `import type` lines (Node keeps an inline `{ type X }` as a real import).

import type { JourneyNode, JourneyEdge, NodeType } from '../types/journey';
import { SOURCE_HANDLES, TARGET_HANDLES } from './stepHandles.ts';
import { TYPE_NAMES, findLoopEdges, handleOf, stepCardName, typeOf } from './connectionRules.ts';

export { TYPE_NAMES, typeOf };

/** One exit on a step. handle null is the unnamed main exit. */
export interface BranchSpec {
  handle: string | null;
  label: string;
  /** True when a journey is unfinished until this exit leads somewhere. */
  required: boolean;
}

// What each exit is called on its card, and whether it must lead somewhere. 'main' is the
// unnamed exit. An exit this table does not know (a handle a card gains later) is named by its
// id and is optional until someone decides otherwise here.
const BRANCH_META: Partial<Record<NodeType, Record<string, { label: string; required: boolean }>>> = {
  'ad-source': { main: { label: 'Next step', required: true } },
  'landing-page': {
    main: { label: 'Button', required: true },
    abandon: { label: 'Left checkout', required: false }
  },
  'lead-form': { main: { label: 'After submit', required: true } },
  // A line out of a follow-up is where a reader goes after the emails (#30). It is a plain line,
  // not a branch, so a journey never needs one.
  'follow-up-sequence': { main: { label: 'After the messages', required: false } },
  upsell: {
    accepted: { label: 'Accepted', required: true },
    declined: { label: 'Declined', required: true },
    rescue: { label: 'Rescue flow', required: false }
  },
  'ab-split': {
    'branch-a': { label: 'Split A', required: true },
    'branch-b': { label: 'Split B', required: true }
  }
};

const NODE_TYPES = Object.keys(SOURCE_HANDLES) as NodeType[];

/** The exits of each step type, in the card's render order. Built from stepHandles, never typed again. */
export const STEP_BRANCHES: Readonly<Record<NodeType, readonly BranchSpec[]>> = Object.freeze(
  Object.fromEntries(
    NODE_TYPES.map(type => [
      type,
      SOURCE_HANDLES[type].map(handle => {
        const meta = BRANCH_META[type]?.[handle ?? 'main'];
        return { handle, label: meta?.label ?? handle ?? 'Next step', required: meta?.required ?? false };
      })
    ])
  ) as Record<NodeType, BranchSpec[]>
);

/** The entries (target handles) of each step type. null is the unnamed entry. */
export const STEP_ENTRIES: Readonly<Record<NodeType, readonly (string | null)[]>> = TARGET_HANDLES;

function tableFor<T>(table: Readonly<Record<NodeType, readonly T[]>>, type: string | undefined): readonly T[] {
  return type && Object.prototype.hasOwnProperty.call(table, type) ? table[type as NodeType] : [];
}

/**
 * The exit a line leaves from, read from edge.sourceHandle (the handle React Flow routes by).
 * With no name it is the step's FIRST exit, because React Flow draws an unnamed line from the
 * first source handle. A name the step does not have is null: React Flow draws nothing.
 */
export function branchOf(edge: Pick<JourneyEdge, 'sourceHandle'>, sourceType: string | undefined): BranchSpec | null {
  const branches = tableFor(STEP_BRANCHES, sourceType);
  const h = handleOf(edge.sourceHandle);
  if (h === null) return branches[0] ?? null;
  return branches.find(b => b.handle === h) ?? null;
}

/** True when the step takes a line on this entry (no name = the unnamed entry). */
export function hasEntry(targetType: string | undefined, targetHandle: string | null | undefined): boolean {
  return tableFor(STEP_ENTRIES, targetType).includes(handleOf(targetHandle));
}

/** True when React Flow can draw the line: both ends exist and both handles are on their steps. */
export function lineIsDrawable(edge: JourneyEdge, byId: ReadonlyMap<string, JourneyNode>): boolean {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return false;
  return branchOf(edge, typeOf(source)) !== null && hasEntry(typeOf(target), edge.targetHandle);
}

export function nodeLookup(nodes: readonly JourneyNode[]): Map<string, JourneyNode> {
  const byId = new Map<string, JourneyNode>();
  for (const n of nodes) if (n && typeof n.id === 'string') byId.set(n.id, n);
  return byId;
}

/** Every step reached from the start steps over lines React Flow can draw, the start steps included. */
export function reachableFrom(
  startIds: readonly string[],
  edges: readonly JourneyEdge[],
  byId: ReadonlyMap<string, JourneyNode>
): Set<string> {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (!e || !lineIsDrawable(e, byId)) continue;
    const list = next.get(e.source);
    if (list) list.push(e.target);
    else next.set(e.source, [e.target]);
  }
  const seen = new Set<string>(startIds.filter(id => byId.has(id)));
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const t of next.get(queue[i]) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return seen;
}

/**
 * The lines that close a loop, one per loop: the line a depth-first walk meets going back to a
 * step it is still inside. The walk starts from the traffic sources, then the rest in map order,
 * so the line reported is the one that points back up the path. Lines out of a follow-up are
 * left out: a reader sent back to an earlier page after the emails is an intended loop (#30).
 * findLoopEdges (#13) is the one loop detector; this only picks which of its lines to name.
 */
export function findLoopLines(nodes: readonly JourneyNode[], edges: readonly JourneyEdge[]): JourneyEdge[] {
  const byId = nodeLookup(nodes);
  const lines = edges.filter(e => e && lineIsDrawable(e, byId) && typeOf(byId.get(e.source)) !== 'follow-up-sequence');
  const onLoop = findLoopEdges(lines);
  if (onLoop.size === 0) return [];

  const out = new Map<string, JourneyEdge[]>();
  for (const e of lines) {
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  const state = new Map<string, 'open' | 'done'>();
  const back: JourneyEdge[] = [];
  const visit = (start: string) => {
    // Iterative, so a long map cannot overflow the stack.
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    state.set(start, 'open');
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = out.get(top.id) ?? [];
      if (top.i >= list.length) {
        state.set(top.id, 'done');
        stack.pop();
        continue;
      }
      const e = list[top.i++];
      const s = state.get(e.target);
      if (s === 'open') {
        if (onLoop.has(e.id)) back.push(e);
      } else if (s === undefined) {
        state.set(e.target, 'open');
        stack.push({ id: e.target, i: 0 });
      }
    }
  };
  const order = [...nodes.filter(n => typeOf(n) === 'ad-source'), ...nodes.filter(n => typeOf(n) !== 'ad-source')];
  for (const n of order) if (n && !state.has(n.id)) visit(n.id);
  return back;
}

/** The step's name as its card reads: 'Landing page /vip-consultation', 'Lead form: Apply'. One rule, in connectionRules. */
export function stepName(node: JourneyNode | null | undefined): string {
  return stepCardName(node);
}
