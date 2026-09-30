import type { JourneyEdge, JourneyNode } from '../types/journey';

// Before C36 a Backspace delete or a drag handed App React Flow's own copies of the steps and
// lines, so what the canvas adds only for drawing was saved into the journey: a full copy of both
// end steps' data on every line, the arrow, the loop and selection flags, and each step's measured
// size, selection and view mode. C36 stopped new saves carrying them; this strips them once from a
// journey saved before that, on the same load path as the handle repair (stepHandles.ts). The
// canvas recomputes every one of them on each draw, so nothing a person made is lost.

/** Top-level keys React Flow or the canvas put on a step. width and height stay: a set size is real. */
const NODE_KEYS = ['measured', 'selected', 'dragging', 'positionAbsolute', 'resizing', 'ariaLabel', 'domAttributes', 'focusable'];
/** The canvas writes the view mode into every step's data so the cards can read it. */
const NODE_DATA_KEYS = ['canvasViewMode'];
const EDGE_KEYS = ['markerEnd', 'selected', 'ariaLabel', 'domAttributes', 'focusable'];
/** What the canvas's line sync adds to a line's data. The saved counts and handles stay. */
const EDGE_DATA_KEYS = [
  'inLoop', 'isSelected', 'onSelectEdge', 'onAddStep', 'description',
  'sourceNodeType', 'targetNodeType', 'sourceNodeLabel', 'targetNodeLabel', 'sourceNodeData', 'targetNodeData'
];

type Plain = Record<string, unknown>;

const has = (o: Plain, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** A copy without these keys, or the same object when it has none of them. */
function without<T>(value: T, keys: readonly string[], extra?: (o: Plain) => boolean): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const o = value as unknown as Plain;
  const drop = keys.filter(k => has(o, k));
  const dropExtra = !!extra && extra(o);
  if (drop.length === 0 && !dropExtra) return value;
  const copy: Plain = { ...o };
  for (const k of drop) delete copy[k];
  if (dropExtra) delete copy.isRetentionEdge;
  return copy as unknown as T;
}

// The line sync saved isRetentionEdge: false on every plain line. False reads exactly like absent
// everywhere (edgeKind, the leak finder), while true may be one the forecaster or the AI builder
// set on purpose, so only false goes.
const staleRetentionFlag = (data: Plain) => data.isRetentionEdge === false;

function cleanNode(node: JourneyNode): JourneyNode {
  if (!node || typeof node !== 'object') return node;
  const shell = without(node, NODE_KEYS);
  const data = without(node.data, NODE_DATA_KEYS);
  if (data === node.data) return shell;
  return { ...shell, data } as JourneyNode;
}

function cleanEdge(edge: JourneyEdge): JourneyEdge {
  if (!edge || typeof edge !== 'object') return edge;
  const shell = without(edge, EDGE_KEYS);
  const data = without(edge.data, EDGE_DATA_KEYS, staleRetentionFlag);
  if (data === edge.data) return shell;
  return { ...shell, data } as JourneyEdge;
}

/** Each list without the canvas's drawing-only fields. The same array back when it holds none. */
export function stripCanvasOnlyFields(nodes: JourneyNode[], edges: JourneyEdge[]): { nodes: JourneyNode[]; edges: JourneyEdge[] } {
  const clean = <T,>(list: T[], one: (item: T) => T): T[] => {
    if (!Array.isArray(list)) return list;
    const out = list.map(one);
    return out.some((item, i) => item !== list[i]) ? out : list;
  };
  return { nodes: clean(nodes, cleanNode), edges: clean(edges, cleanEdge) };
}
