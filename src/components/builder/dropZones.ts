// Where a dragged thing may land on the page builder's canvas (LANDING_BUILDER_DESIGN.md section 4).
//
// Pure: no React, no DOM, no clock, so `node --test` loads it as it is. The canvas draws a drop zone
// only where the model would accept the drop, and it asks the model (insertNode or moveNode on the
// current document) rather than keeping a second copy of the nesting rules here.
//
// A zone is a gap in a container: before child `before` of a page, a section or a column, counted
// in the document as it is now. A move's index in the model counts after the node has left its old
// place, so planDrop converts the gap into that index.

import { createNode, findNode, insertNode, moveNode, walk, WIDGET_REGISTRY } from '../../lib/pageBuilder/model.mjs';
import type {
  BuilderColumn,
  BuilderDoc,
  BuilderNode,
  BuilderSection,
  BuilderWidget,
  WidgetType
} from '../../types/pageBuilder';
import type { BuilderAction } from './builderState';

/** What is being dragged. */
export type DragItem =
  /** A widget from the palette. Dropped between sections, it gets a one-column section around it. */
  | { kind: 'widget'; widgetType: WidgetType }
  /** A layout from the palette: a new section with these column widths (0 means an equal share). */
  | { kind: 'layout'; columns: number[] }
  /** A node already on the page, dragged from the outline or the canvas. */
  | { kind: 'node'; id: string };

export interface DropZone {
  /** `zone:<parent id or page>:<before>`. */
  id: string;
  /** The container: null for the page. */
  parentId: string | null;
  /** The gap: before this child of the container, 0 to its length. */
  before: number;
  container: 'page' | 'section' | 'column';
  /** The container has no children: an empty column is one zone. */
  empty: boolean;
}

export const PAGE_ZONE = 'page';

export function zoneId(parentId: string | null, before: number): string {
  return `zone:${parentId ?? PAGE_ZONE}:${before}`;
}

/** The palette's layouts. 0 is an equal share of the row; a number is a column's width in percent. */
export const LAYOUTS: ReadonlyArray<{ id: string; label: string; columns: number[] }> = Object.freeze([
  { id: 'one', label: '1 column', columns: [0] },
  { id: 'two', label: '2 columns', columns: [0, 0] },
  { id: 'three', label: '3 columns', columns: [0, 0, 0] },
  { id: 'four', label: '4 columns', columns: [0, 0, 0, 0] },
  { id: 'third-two-thirds', label: '33 / 67', columns: [33, 67] },
  { id: 'two-thirds-third', label: '67 / 33', columns: [67, 33] },
  { id: 'quarter-three-quarters', label: '25 / 75', columns: [25, 75] }
]);

export interface NodeFactory {
  section(): BuilderSection;
  column(): BuilderColumn;
  widget(type: WidgetType): BuilderWidget;
}

/** The model's own node maker, with fresh ids each call. Tests may pass a deterministic one. */
export const MODEL_FACTORY: NodeFactory = {
  section: () => createNode('section'),
  column: () => createNode('column'),
  widget: type => createNode('widget', type) as BuilderWidget
};

/** A new section with one column per entry of `columns`, each with its width when one is given. */
export function createLayout(columns: number[], make: NodeFactory = MODEL_FACTORY): BuilderSection {
  const section = make.section();
  const widths = columns.length ? columns.slice(0, 6) : [0];
  section.children = widths.map(width => {
    const column = make.column();
    if (width > 0) column.style = { ...column.style, desktop: { ...column.style.desktop, width } };
    return column;
  });
  return section;
}

/** A widget from the palette inside a new one-column section, for a drop between sections. */
export function wrapInSection(widget: BuilderWidget, make: NodeFactory = MODEL_FACTORY): BuilderSection {
  const section = make.section();
  const column = section.children[0] ?? make.column();
  section.children = [{ ...column, children: [widget] }];
  return section;
}

/** Every gap in every container on the page, page gaps first, then containers in page order. */
export function candidateZones(doc: BuilderDoc): DropZone[] {
  const zones: DropZone[] = [];
  const add = (parentId: string | null, container: DropZone['container'], length: number) => {
    for (let before = 0; before <= length; before++) {
      zones.push({ id: zoneId(parentId, before), parentId, before, container, empty: length === 0 });
    }
  };
  add(null, 'page', doc.sections.length);
  walk(doc, node => {
    if (node.kind === 'section') add(node.id, 'section', node.children.length);
    else if (node.kind === 'column') add(node.id, 'column', node.children.length);
  });
  return zones;
}

export type DropPlan =
  | { ok: true; action: BuilderAction }
  | { ok: false; reason: string; noop?: boolean };

/**
 * What a drop at `zone` does, as a reducer action: an insert for a palette item, a move for a node
 * on the page. The action is not checked here; the reducer runs it through the model.
 */
export function planDrop(doc: BuilderDoc, item: DragItem, zone: DropZone, make: NodeFactory = MODEL_FACTORY): DropPlan {
  if (item.kind === 'widget') {
    if (!Object.hasOwn(WIDGET_REGISTRY, item.widgetType)) return { ok: false, reason: 'That is not a block this builder knows.' };
    const widget = make.widget(item.widgetType);
    if (zone.container === 'page') {
      return { ok: true, action: { type: 'insert', parentId: null, index: zone.before, node: wrapInSection(widget, make), select: widget.id } };
    }
    return { ok: true, action: { type: 'insert', parentId: zone.parentId, index: zone.before, node: widget, select: widget.id } };
  }
  if (item.kind === 'layout') {
    return { ok: true, action: { type: 'insert', parentId: zone.parentId, index: zone.before, node: createLayout(item.columns, make) } };
  }
  const from = findNode(doc, item.id);
  if (!from) return { ok: false, reason: 'That block is no longer on the page.' };
  const fromParent = from.parent ? from.parent.id : null;
  const sameParent = fromParent === zone.parentId;
  if (sameParent && (zone.before === from.index || zone.before === from.index + 1)) {
    return { ok: false, reason: 'That is where it already is.', noop: true };
  }
  const index = sameParent && from.index < zone.before ? zone.before - 1 : zone.before;
  return { ok: true, action: { type: 'move', id: item.id, parentId: zone.parentId, index } };
}

/** Whether the model accepts this action on `doc`. */
function modelAccepts(doc: BuilderDoc, action: BuilderAction): boolean {
  if (action.type === 'insert') return insertNode(doc, action.parentId, action.index, action.node).ok;
  if (action.type === 'move') return moveNode(doc, action.id, action.parentId, action.index).ok;
  return false;
}

/**
 * The zones drawn for this drag: every gap where the model accepts the drop, and none where the
 * drop would leave the node where it already is.
 */
export function dropZonesFor(doc: BuilderDoc, item: DragItem, make: NodeFactory = MODEL_FACTORY): DropZone[] {
  return candidateZones(doc).filter(zone => {
    const plan = planDrop(doc, item, zone, make);
    return plan.ok && modelAccepts(doc, plan.action);
  });
}

/** The place a zone stands for, in words, for the drag announcements. */
export function describeZone(doc: BuilderDoc, zone: DropZone, labelOf: (id: string) => string): string {
  if (zone.parentId === null) {
    if (doc.sections.length === 0) return 'the empty page';
    return zone.before === 0
      ? 'the top of the page'
      : zone.before >= doc.sections.length
        ? 'the bottom of the page'
        : `the page, between ${labelOf(doc.sections[zone.before - 1].id)} and ${labelOf(doc.sections[zone.before].id)}`;
  }
  const found = findNode(doc, zone.parentId);
  const name = labelOf(zone.parentId);
  if (!found) return name;
  if (zone.empty) return `${name}, which is empty`;
  const length = (found.node as BuilderSection | BuilderColumn).children.length;
  let where = name;
  if (found.node.kind === 'column' && found.parent) where = `${labelOf(found.parent.id)}, ${name}`;
  return `${where}, position ${zone.before + 1} of ${length + 1}`;
}

/**
 * Where a click on a palette item puts it (design section 4's rules, applied to the selection): a
 * widget goes after the selected widget, at the end of the selected column, or at the end of the
 * last column of the selected section (or of the page's last section when nothing is selected); on
 * an empty page it goes between sections, where planDrop wraps it in a section of its own. A layout
 * goes after the selected section, after the section holding the selection, or at the end of the page.
 */
export function appendZone(doc: BuilderDoc, item: DragItem, selectedId: string | null): DropZone {
  const pageZone = (before: number): DropZone => ({
    id: zoneId(null, before), parentId: null, before, container: 'page', empty: doc.sections.length === 0
  });
  const columnZone = (column: BuilderColumn, before: number): DropZone => ({
    id: zoneId(column.id, before), parentId: column.id, before, container: 'column', empty: column.children.length === 0
  });
  const lastColumn = (section: BuilderSection | undefined): BuilderColumn | null =>
    section && section.children.length ? section.children[section.children.length - 1] : null;
  const found = selectedId ? findNode(doc, selectedId) : null;
  // The top-level section holding the selection, and its place on the page.
  let topIndex = -1;
  if (found) {
    doc.sections.forEach((section, i) => {
      if (topIndex >= 0) return;
      if (section.id === selectedId) topIndex = i;
      else walk({ ...doc, sections: [section] }, n => {
        if (n.id === selectedId) topIndex = i;
        return topIndex < 0;
      });
    });
  }
  if (item.kind !== 'widget') return pageZone(topIndex >= 0 ? topIndex + 1 : doc.sections.length);
  if (found) {
    const node = found.node;
    if (node.kind === 'column') return columnZone(node, node.children.length);
    if (node.kind === 'widget' && found.parent && found.parent.kind === 'column') return columnZone(found.parent, found.index + 1);
    if (node.kind === 'section') {
      const column = lastColumn(node);
      if (column) return columnZone(column, column.children.length);
    }
  }
  const column = lastColumn(doc.sections[doc.sections.length - 1]);
  return column ? columnZone(column, column.children.length) : pageZone(doc.sections.length);
}

/**
 * The zones in reading order, the order the keyboard walks them: the gap before a section, then the
 * gaps inside it (between its columns, and down each column, inner sections included), then the gap
 * after it.
 */
export function readingOrder(doc: BuilderDoc, zones: ReadonlyArray<DropZone>): DropZone[] {
  const rank = new Map<string, number>();
  const visitContainer = (parentId: string | null, children: BuilderNode[]) => {
    for (let i = 0; i <= children.length; i++) {
      rank.set(zoneId(parentId, i), rank.size);
      if (i < children.length) visitNode(children[i]);
    }
  };
  const visitNode = (node: BuilderNode) => {
    if (node.kind === 'widget') return;
    visitContainer(node.id, (node as BuilderSection | BuilderColumn).children as BuilderNode[]);
  };
  visitContainer(null, doc.sections);
  return [...zones].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

// ---- Geometry: where the canvas draws a zone, from the rendered nodes' boxes ----

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const visible = (r: Rect | null | undefined): r is Rect => !!r && r.width > 0 && r.height > 0;

/**
 * The box a zone is drawn in, from the boxes of the rendered nodes (`rectOf`, null for a node that is
 * not drawn on this device) and of the page root. A gap between stacked children is a bar across the
 * container at the middle of the gap; a gap between columns side by side is an upright bar. An empty
 * container is one zone over its whole box. `thickness` is the bar's size across, which is also how
 * far a pointer may be from the gap and still drop there. Null when nothing is drawn to place it by.
 */
export function zoneGeometry(
  doc: BuilderDoc,
  zone: DropZone,
  rectOf: (id: string) => Rect | null,
  pageRect: Rect,
  thickness = 16
): Rect | null {
  const half = thickness / 2;
  let container: Rect | null;
  let children: BuilderNode[];
  if (zone.parentId === null) {
    container = pageRect;
    children = doc.sections;
  } else {
    const found = findNode(doc, zone.parentId);
    if (!found || found.node.kind === 'widget') return null;
    container = rectOf(zone.parentId);
    children = (found.node as BuilderSection | BuilderColumn).children as BuilderNode[];
  }
  if (!visible(container)) return null;
  const boxes = children.map(child => rectOf(child.id));
  const shown = boxes.map((b, i) => (visible(b) ? i : -1)).filter(i => i >= 0);
  if (shown.length === 0) {
    if (zone.parentId === null) return { left: container.left, top: container.top, width: container.width, height: Math.max(thickness, Math.min(container.height, 96)) };
    return { left: container.left, top: container.top, width: container.width, height: Math.max(container.height, thickness * 3) };
  }
  const prevIndex = [...shown].reverse().find(i => i < zone.before);
  const nextIndex = shown.find(i => i >= zone.before);
  const prev = prevIndex === undefined ? null : (boxes[prevIndex] as Rect);
  const next = nextIndex === undefined ? null : (boxes[nextIndex] as Rect);

  // Side by side: a section whose drawn columns sit in one row (one column reads as a row of one).
  let sideways = false;
  if (zone.container === 'section') {
    if (shown.length === 1) sideways = true;
    else {
      const a = boxes[shown[0]] as Rect;
      const b = boxes[shown[1]] as Rect;
      sideways = b.left >= a.left + a.width - 1;
    }
  }

  if (sideways) {
    const x = prev && next ? (prev.left + prev.width + next.left) / 2 : prev ? prev.left + prev.width : (next as Rect).left;
    return { left: x - half, top: container.top, width: thickness, height: container.height };
  }
  const y = prev && next ? (prev.top + prev.height + next.top) / 2 : prev ? prev.top + prev.height : (next as Rect).top;
  return { left: container.left, top: y - half, width: container.width, height: thickness };
}
