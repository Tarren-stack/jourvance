import type { JourneyEdge, JourneyNode, JourneyProject } from '../types/journey';
// The explicit extension lets node import this file for its tests; liveStats has only type imports.
import { MEASURED_KEYS, FLOW_STAT_KEYS, PAGE_STAT_KEYS } from './liveStats.ts';

/**
 * Undo history for the journey canvas, as pure functions over immutable project snapshots.
 *
 * Every canvas edit reaches App through setProject, so history is recorded in ONE place (the
 * useJourneyEditing hook watches `project`) and no call site takes its own snapshot. What makes
 * that safe is the fingerprint: a stats poll, a selection, a measured size or a publish flag
 * changes the project object without changing its content, and none of those may become an undo
 * step or an autosave.
 */

export const HISTORY_LIMIT = 100;
/** Edits to the same node's data, or to the same top-level field, merge within this gap. */
export const COALESCE_MS = 1000;
/** Any two edits this close together are one gesture (a delete and its lines, a drag's writes). */
export const GESTURE_MS = 150;

export const PUBLISH_KEYS = ['published', 'publishedAt', 'publishedUrl'] as const;

/** Counts the stats poll writes onto cards. They are measurements, never an edit. */
export const LIVE_STAT_KEYS: readonly string[] = [...MEASURED_KEYS, ...FLOW_STAT_KEYS, ...PAGE_STAT_KEYS];
/** Counts the stats poll writes onto lines. */
export const EDGE_MEASURED_KEYS = ['sourceThroughput', 'targetCount', 'rate'] as const;

/** React Flow's own bookkeeping on a node. */
const NODE_VIEW_KEYS = new Set(['selected', 'dragging', 'measured', 'width', 'height', 'positionAbsolute', 'resizing']);
const EDGE_VIEW_KEYS = new Set(['selected', 'markerEnd']);
/** JourneyCanvas injects these into edge data and pushes them back through onEdgesChange. */
const EDGE_DATA_DROP = new Set<string>([
  ...EDGE_MEASURED_KEYS,
  'isSelected', 'onSelectEdge',
  'sourceNodeType', 'targetNodeType', 'sourceNodeLabel', 'targetNodeLabel', 'sourceNodeData', 'targetNodeData'
]);
const NODE_DATA_DROP_SAVE = new Set<string>(['canvasViewMode', ...LIVE_STAT_KEYS]);
/** History also ignores publish flags and the flow name the stats poll refreshes. */
const NODE_DATA_DROP_HISTORY = new Set<string>([...NODE_DATA_DROP_SAVE, ...PUBLISH_KEYS, 'jourvanceFlowName']);

type Kind = 'history' | 'save';
type Plain = Record<string, unknown>;

/** Canonical JSON: sorted keys, undefined values and functions dropped. */
function canonical(value: unknown, drop?: Set<string>): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => (item === undefined || typeof item === 'function' ? 'null' : canonical(item))).join(',')}]`;
  }
  const record = value as Plain;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    if (drop?.has(key)) continue;
    const item = record[key];
    if (item === undefined || typeof item === 'function') continue;
    parts.push(`${JSON.stringify(key)}:${canonical(item)}`);
  }
  return `{${parts.join(',')}}`;
}

// Snapshots are immutable, so a node or edge object's fingerprint never changes. One cache per
// kind, because the two kinds drop different keys.
const nodeCache: Record<Kind, WeakMap<object, string>> = { history: new WeakMap(), save: new WeakMap() };
const edgeCache: Record<Kind, WeakMap<object, string>> = { history: new WeakMap(), save: new WeakMap() };
const dataCache: Record<Kind, WeakMap<object, string>> = { history: new WeakMap(), save: new WeakMap() };

function dataFingerprint(data: unknown, kind: Kind): string {
  if (!data || typeof data !== 'object') return canonical(data);
  const hit = dataCache[kind].get(data as object);
  if (hit !== undefined) return hit;
  const fp = canonical(data, kind === 'history' ? NODE_DATA_DROP_HISTORY : NODE_DATA_DROP_SAVE);
  dataCache[kind].set(data as object, fp);
  return fp;
}

/** A node without its data or React Flow's bookkeeping: id, type, position and the rest. */
function nodeShellFingerprint(node: JourneyNode): string {
  const drop = new Set(NODE_VIEW_KEYS);
  drop.add('data');
  return canonical(node, drop);
}

function nodeFingerprint(node: JourneyNode, kind: Kind): string {
  const hit = nodeCache[kind].get(node);
  if (hit !== undefined) return hit;
  const fp = `{"data":${dataFingerprint(node.data, kind)},"shell":${nodeShellFingerprint(node)}}`;
  nodeCache[kind].set(node, fp);
  return fp;
}

function edgeFingerprint(edge: JourneyEdge, kind: Kind): string {
  const hit = edgeCache[kind].get(edge);
  if (hit !== undefined) return hit;
  const drop = new Set(EDGE_VIEW_KEYS);
  drop.add('data');
  const data = edge.data ? canonical(edge.data, EDGE_DATA_DROP) : 'null';
  const fp = `{"data":${data},"shell":${canonical(edge, drop)}}`;
  edgeCache[kind].set(edge, fp);
  return fp;
}

const TOP_LEVEL_DROP = new Set(['nodes', 'edges', 'updatedAt']);

function fieldNames(project: JourneyProject): string[] {
  return Object.keys(project).filter(key => !TOP_LEVEL_DROP.has(key));
}

function fieldFingerprint(project: JourneyProject, name: string): string {
  const value = (project as unknown as Plain)[name];
  return value === undefined || typeof value === 'function' ? '' : canonical(value);
}

function projectFingerprint(project: JourneyProject, kind: Kind): string {
  const nodes = (project.nodes || []).map(n => nodeFingerprint(n, kind)).join(',');
  const edges = (project.edges || []).map(e => edgeFingerprint(e, kind)).join(',');
  return `{"edges":[${edges}],"fields":${canonical(project, TOP_LEVEL_DROP)},"nodes":[${nodes}]}`;
}

/** What counts as an undo step. Ignores view state, live counts, publish flags and updatedAt. */
export function historyFingerprint(project: JourneyProject): string {
  return projectFingerprint(project, 'history');
}

/** What counts as needing a save. Like historyFingerprint, but a publish or a flow rename is saved. */
export function saveFingerprint(project: JourneyProject): string {
  return projectFingerprint(project, 'save');
}

function sameList<T>(a: readonly T[], b: readonly T[], fp: (item: T) => string): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && fp(a[i]) !== fp(b[i])) return false;
  }
  return true;
}

function changedFields(before: JourneyProject, after: JourneyProject): string[] {
  const names = new Set([...fieldNames(before), ...fieldNames(after)]);
  return [...names].filter(name => fieldFingerprint(before, name) !== fieldFingerprint(after, name));
}

/**
 * What an edit touched, so repeated edits to one thing can merge: `data:<nodeId>` when exactly
 * one node's data changed and nothing else did, `field:<name>` when exactly one top-level field
 * changed and nothing else did, and null for anything structural.
 */
export function editKey(before: JourneyProject, after: JourneyProject): string | null {
  const edgesSame = sameList(before.edges || [], after.edges || [], e => edgeFingerprint(e, 'history'));
  if (!edgesSame) return null;
  const fields = changedFields(before, after);
  const bn = before.nodes || [];
  const an = after.nodes || [];
  const nodesSame = sameList(bn, an, n => nodeFingerprint(n, 'history'));
  if (nodesSame) return fields.length === 1 ? `field:${fields[0]}` : null;
  if (fields.length > 0 || bn.length !== an.length) return null;
  let changed: string | null = null;
  for (let i = 0; i < bn.length; i++) {
    const b = bn[i];
    const a = an[i];
    if (b.id !== a.id) return null;
    if (b === a || nodeFingerprint(b, 'history') === nodeFingerprint(a, 'history')) continue;
    if (changed !== null) return null;
    if (nodeShellFingerprint(b) !== nodeShellFingerprint(a)) return null;
    changed = a.id;
  }
  return changed === null ? null : `data:${changed}`;
}

/** The snapshot with every step at one place, so two snapshots compare on content alone. */
const withoutPositions = (p: JourneyProject): JourneyProject => ({
  ...p,
  nodes: (p.nodes || []).map(n => ({ ...n, position: { x: 0, y: 0 } }))
});

/** True when two snapshots differ in nothing but where the steps sit (a drag or a tidy). */
export function onlyPositionsDiffer(a: JourneyProject, b: JourneyProject): boolean {
  return historyFingerprint(withoutPositions(a)) === historyFingerprint(withoutPositions(b));
}

export interface JourneyHistory {
  /** Snapshots before each step, oldest first. */
  past: JourneyProject[];
  /** Snapshots undone, the next redo last. */
  future: JourneyProject[];
  lastEditAt: number;
  lastEditKey: string | null;
}

export function createHistory(): JourneyHistory {
  return { past: [], future: [], lastEditAt: 0, lastEditKey: null };
}

/**
 * Record the change from `before` to `after`. A change with no content returns `h` itself, so a
 * caller can tell nothing happened. A burst of edits to one thing, or one gesture, is one step.
 */
export function recordEdit(h: JourneyHistory, before: JourneyProject, after: JourneyProject, nowMs: number): JourneyHistory {
  if (before === after || historyFingerprint(before) === historyFingerprint(after)) return h;
  const key = editKey(before, after);
  const gap = nowMs - h.lastEditAt;
  const merge = h.past.length > 0 && (
    gap <= GESTURE_MS || (key !== null && key === h.lastEditKey && gap <= COALESCE_MS)
  );
  const past = merge ? h.past : [...h.past, before].slice(-HISTORY_LIMIT);
  return { past, future: [], lastEditAt: nowMs, lastEditKey: key };
}

export interface HistoryStep {
  history: JourneyHistory;
  /** The snapshot to restore, through restoreSnapshot. */
  target: JourneyProject;
}

export function undoStep(h: JourneyHistory, present: JourneyProject): HistoryStep | null {
  if (h.past.length === 0) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, present], lastEditAt: 0, lastEditKey: null },
    target: h.past[h.past.length - 1]
  };
}

export function redoStep(h: JourneyHistory, present: JourneyProject): HistoryStep | null {
  if (h.future.length === 0) return null;
  return {
    history: { past: [...h.past, present].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1), lastEditAt: 0, lastEditKey: null },
    target: h.future[h.future.length - 1]
  };
}

/**
 * The target snapshot's content, carrying the present's live counts and publish flags, since
 * undo must never roll back a measurement or a page's live state. A node or line that no longer
 * exists keeps the values it had in the snapshot.
 */
export function restoreSnapshot(current: JourneyProject, target: JourneyProject, nowIso: string): JourneyProject {
  const currentNodes = new Map((current.nodes || []).map(n => [n.id, n]));
  const currentEdges = new Map((current.edges || []).map(e => [e.id, e]));
  const nodes = (target.nodes || []).map(node => {
    const present = currentNodes.get(node.id);
    if (!present) return node;
    const from = (present.data || {}) as Plain;
    const data = { ...(node.data as Plain) };
    let changed = false;
    for (const key of LIVE_STAT_KEYS) {
      if (key in from && data[key] !== from[key]) {
        data[key] = from[key];
        changed = true;
      }
    }
    for (const key of PUBLISH_KEYS) {
      if (key in from) {
        if (data[key] !== from[key]) {
          data[key] = from[key];
          changed = true;
        }
      } else if (key in data) {
        delete data[key];
        changed = true;
      }
    }
    return changed ? { ...node, data: data as JourneyNode['data'] } : node;
  });
  const edges = (target.edges || []).map(edge => {
    const present = currentEdges.get(edge.id);
    if (!present?.data) return edge;
    const from = present.data as Plain;
    const data = { ...((edge.data || {}) as Plain) };
    let changed = false;
    for (const key of EDGE_MEASURED_KEYS) {
      if (key in from && data[key] !== from[key]) {
        data[key] = from[key];
        changed = true;
      }
    }
    return changed ? { ...edge, data: data as JourneyEdge['data'] } : edge;
  });
  return { ...target, nodes, edges, updatedAt: nowIso };
}

export type HistoryAction = 'undo' | 'redo';

interface ShortcutKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface ShortcutTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/**
 * Cmd or Ctrl+Z undoes, Cmd or Ctrl+Shift+Z and Ctrl+Y redo. Never inside a text field, where
 * the browser's own undo belongs to what the person is typing.
 */
export function historyShortcut(e: ShortcutKey, target: ShortcutTarget | null): HistoryAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (target) {
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return null;
    if (tag === 'INPUT' && TEXT_INPUT_TYPES.has(String(target.type ?? '').toLowerCase())) return null;
  }
  const key = String(e.key || '').toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.metaKey) return 'redo';
  return null;
}

/** Ids whose position the parent set, rather than React Flow: new ids and ids that moved. */
export function parentMovedIds(
  propNodes: readonly { id: string; position: { x: number; y: number } }[],
  lastSeen: Map<string, { x: number; y: number }>
): Set<string> {
  const moved = new Set<string>();
  for (const node of propNodes) {
    const seen = lastSeen.get(node.id);
    if (!seen || seen.x !== node.position?.x || seen.y !== node.position?.y) moved.add(node.id);
  }
  return moved;
}
