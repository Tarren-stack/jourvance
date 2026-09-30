// A saved line must have both of its steps on the map (C06). The map draws a line only between
// steps it shows, so a line whose step is gone can be neither seen, selected nor deleted, and the
// design check then reports a problem the person cannot reach. React Flow removes only the lines
// it was given, and with Retention Flows hidden it is never given the lines into a hidden step,
// so a keyboard delete of the step at their other end left them saved. App passes every node and
// line change through here, whichever arrives first, so no delete path can save an orphan line.
// Pure: no React, no DOM, and only type imports, so `node --test` loads it directly.

import type { JourneyNode, JourneyEdge } from '../types/journey';

/** The lines whose source and target are both in `nodes`, in their order. The same array when none go. */
export function linesWithBothEnds(nodes: readonly Pick<JourneyNode, 'id'>[], edges: JourneyEdge[]): JourneyEdge[] {
  const ids = new Set(nodes.map(n => n.id));
  const kept = edges.filter(e => ids.has(e.source) && ids.has(e.target));
  return kept.length === edges.length ? edges : kept;
}
