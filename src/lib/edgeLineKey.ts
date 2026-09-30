// The part of the line list that caption layout depends on: which lines exist, which cards and
// handles they join, their kind and whether they show. The caption layout effect keys on this
// rather than on the edges array, because the canvas rebuilds that array on every keystroke
// (each line carries its cards' data) and re-running the layout then re-placed every caption for
// nothing. Caption size, midpoint and path changes reach the layout through its own observers.

export interface EdgeLineLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  hidden?: boolean;
}

/** A string that changes only when a line is added, removed, rejoined, retyped, hidden or shown. */
export function edgeLineKey(edges: readonly EdgeLineLike[]): string {
  // JSON quoting keeps the fields apart whatever characters an id or handle holds.
  return JSON.stringify(
    edges.map(e => [e.id, e.source, e.sourceHandle ?? '', e.target, e.targetHandle ?? '', e.type ?? '', e.hidden ? 1 : 0])
  );
}
