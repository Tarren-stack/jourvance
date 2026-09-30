// Path focus: selecting a step fades every line that is not on its path (a port of Aura's
// journeyEditor.connectedPath). The path is the selected step, every step that leads to it and
// every step it leads to, with the lines between them. Only lines fade: step cards and rate pills
// sit outside the edge group, so their text keeps full contrast.
// No imports, so node tests and other libs can load this file.

export interface FocusEdge {
  id: string;
  source: string;
  target: string;
}

export interface PathFocus {
  nodes: Set<string>;
  edges: Set<string>;
}

export const PATH_MUTED_CLASS = 'jv-path-muted';
/** Kept equal to the .react-flow__edge.jv-path-muted opacity in src/index.css (a test pins it). */
export const PATH_MUTED_OPACITY = 0.25;

/**
 * The selected step's path over the given lines, or null when nothing is selected or the step is
 * not on screen. Ancestors are walked backwards and descendants forwards in separate passes, so an
 * ancestor's other branches stay dark. A step with no lines gives an empty path, which fades every
 * line: nothing reaches it.
 */
export function pathFocus(
  selectedId: string | null | undefined,
  edges: readonly FocusEdge[],
  selectedShown = true
): PathFocus | null {
  if (!selectedId || !selectedShown) return null;

  const into = new Map<string, FocusEdge[]>();
  const out = new Map<string, FocusEdge[]>();
  for (const e of edges) {
    (into.get(e.target) ?? into.set(e.target, []).get(e.target)!).push(e);
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
  }

  const nodes = new Set<string>([selectedId]);
  const lit = new Set<string>();

  const walk = (adjacency: Map<string, FocusEdge[]>, next: (e: FocusEdge) => string) => {
    // Each pass has its own seen set, which also ends cycles and self-loops.
    const seen = new Set<string>([selectedId]);
    const queue = [selectedId];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const e of adjacency.get(at) ?? []) {
        const n = next(e);
        lit.add(e.id);
        nodes.add(n);
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  };

  walk(into, e => e.source);
  walk(out, e => e.target);
  return { nodes, edges: lit };
}

function addClass(className: string | undefined, cls: string): string {
  const parts = (className ?? '').split(/\s+/).filter(Boolean);
  return parts.includes(cls) ? (className as string) : [...parts, cls].join(' ');
}

/**
 * The lines to draw, with the off-path ones marked. Render only: the result goes to React Flow's
 * edges prop and never into saved or counted state. Returns the same array when nothing is focused,
 * and lit lines come back as the same objects.
 */
export function withPathFocus<E extends { id: string; className?: string }>(
  edges: E[],
  focus: PathFocus | null
): E[] {
  if (!focus) return edges;
  return edges.map(e => (focus.edges.has(e.id) ? e : { ...e, className: addClass(e.className, PATH_MUTED_CLASS) }));
}
