// The page builder's outline (LANDING_BUILDER_DESIGN.md section 7): the page as a tree with one tab
// stop. Up and Down move between visible rows, Right opens a row or enters it, Left closes it or goes
// to its parent, Home and End go to the first and last row, Enter selects. Space picks the row up
// for a keyboard drag. Rows are sortable within their sibling group; dropped on a row in another
// group, a row moves there and the model decides whether it may.
//
// The DOM is flat (aria-level, aria-setsize and aria-posinset carry the shape) while each sibling
// group is its own SortableContext in the React tree, so a row's drag never reorders another group.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolveStyle } from '../../lib/pageBuilder/model.mjs';
import type { BuilderColumn, BuilderDevice, BuilderDoc, BuilderNode, BuilderSection } from '../../types/pageBuilder';
import { ancestry, nodeSnippet } from './builderState';
import { FLIP_EASE, FLIP_MS, flipOffsets } from './motion';

export interface BuilderOutlineProps {
  doc: BuilderDoc;
  device: BuilderDevice;
  selectedId: string | null;
  labelOf: (id: string) => string;
  onSelect: (id: string) => void;
  /** The id of the row being dragged and of the row it is over, to draw the drop line. */
  activeId: string | null;
  overId: string | null;
  dragging: boolean;
  /** The editor's motion is off (the device asks for less, or the preference is on): rows jump. */
  motionOff?: boolean;
}

interface Row {
  node: BuilderNode;
  level: number;
  setSize: number;
  posInSet: number;
  parentId: string | null;
  hasChildren: boolean;
}

/** Rows are not shifted while dragging: a drop line on the row under the pointer says where it goes. */
const STAY: SortingStrategy = () => null;

export const OUTLINE_PREFIX = 'outline:';

const childrenOf = (node: BuilderNode): BuilderNode[] =>
  node.kind === 'widget' ? [] : ((node as BuilderSection | BuilderColumn).children as BuilderNode[]);

const OutlineRow: React.FC<{
  row: Row;
  label: string;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  hiddenHere: boolean;
  dropLine: boolean;
  onFocusRow: (id: string) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLDivElement>, row: Row) => void;
}> = ({ row, label, selected, focused, expanded, hiddenHere, dropLine, onFocusRow, onSelect, onToggle, onKey }) => {
  const id = row.node.id;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id: `${OUTLINE_PREFIX}${id}`,
    data: { drag: { kind: 'node', id }, label, nodeId: id }
  });
  const snippet = nodeSnippet(row.node);
  const dndKeyDown = (listeners as Record<string, ((e: React.KeyboardEvent) => void) | undefined> | undefined)?.onKeyDown;
  return (
    <div
      ref={el => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      {...attributes}
      {...listeners}
      role="treeitem"
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-label={`${label}${snippet ? `, ${snippet}` : ''}${hiddenHere ? ', hidden on this device' : ''}`}
      tabIndex={focused ? 0 : -1}
      data-node-id={id}
      onFocus={() => onFocusRow(id)}
      onClick={() => onSelect(id)}
      onKeyDown={e => {
        // Space picks the row up (dnd-kit); every other key is the tree's.
        if (e.code === 'Space' || e.key === ' ') {
          dndKeyDown?.(e);
          return;
        }
        onKey(e, row);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        minHeight: '30px',
        padding: `2px 6px 2px ${6 + (row.level - 1) * 14}px`,
        borderRadius: '6px',
        cursor: 'pointer',
        color: selected ? '#FFFFFF' : '#E2E8F0',
        backgroundColor: selected ? 'rgba(99, 102, 241, 0.35)' : 'transparent',
        opacity: isDragging ? 0.45 : 1,
        boxShadow: dropLine ? 'inset 0 3px 0 #F472B6' : 'none',
        fontSize: '12px',
        userSelect: 'none',
        touchAction: 'none'
      }}
    >
      {row.hasChildren ? (
        <span
          aria-hidden="true"
          onClick={e => {
            e.stopPropagation();
            onToggle(id);
          }}
          style={{ display: 'inline-flex', width: '16px', justifyContent: 'center', color: '#94A3B8' }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      ) : (
        <span aria-hidden="true" style={{ display: 'inline-block', width: '16px' }} />
      )}
      <span style={{ fontWeight: row.node.kind === 'widget' ? 500 : 700, whiteSpace: 'nowrap' }}>{label}</span>
      {snippet && (
        <span aria-hidden="true" style={{ color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {snippet}
        </span>
      )}
      {hiddenHere && <span aria-hidden="true" style={{ marginLeft: 'auto', color: '#FCD34D', fontSize: '11px' }}>Hidden</span>}
    </div>
  );
};

export const BuilderOutline: React.FC<BuilderOutlineProps> = ({ doc, device, selectedId, labelOf, onSelect, activeId, overId, dragging, motionOff = false }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // FLIP (section 4): when the document changed and no drag is on, a row that moved slides from where
  // it was to where it is. Tops are read as offsetTop, which a scroll and a transform do not change.
  const lastTops = useRef<Map<string, number>>(new Map());
  const lastDoc = useRef(doc);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    const after = new Map<string, number>();
    const els = new Map<string, HTMLElement>();
    tree?.querySelectorAll<HTMLElement>('[data-node-id]').forEach(el => {
      const id = el.getAttribute('data-node-id');
      if (id) {
        after.set(id, el.offsetTop);
        els.set(id, el);
      }
    });
    const changed = lastDoc.current !== doc;
    const before = lastTops.current;
    lastDoc.current = doc;
    lastTops.current = after;
    if (!changed || motionOff || dragging || !tree) return;
    const offsets = flipOffsets(before, after);
    if (offsets.size === 0) return;
    const moved: HTMLElement[] = [];
    offsets.forEach((delta, id) => {
      const el = els.get(id);
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      moved.push(el);
    });
    void tree.offsetHeight;
    // Never cancelled: a re-render before the frame would leave the rows held at their old place.
    requestAnimationFrame(() => {
      for (const el of moved) {
        const clear = () => {
          el.style.transition = '';
          el.style.transform = '';
          el.removeEventListener('transitionend', clear);
        };
        el.addEventListener('transitionend', clear);
        window.setTimeout(clear, FLIP_MS + 150);
        el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
        el.style.transform = 'none';
      }
    });
  });

  // The canvas's selection opens its rows in the outline and brings the row into view.
  useEffect(() => {
    if (!selectedId) return;
    const chain = ancestry(doc, selectedId);
    setCollapsed(prev => {
      if (!chain.slice(0, -1).some(n => prev.has(n.id))) return prev;
      const next = new Set(prev);
      for (const n of chain.slice(0, -1)) next.delete(n.id);
      return next;
    });
    setFocusedId(selectedId);
    const row = treeRef.current?.querySelector<HTMLElement>(`[data-node-id="${selectedId}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, doc]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (nodes: BuilderNode[], level: number, parentId: string | null) => {
      nodes.forEach((node, i) => {
        const kids = childrenOf(node);
        out.push({ node, level, setSize: nodes.length, posInSet: i + 1, parentId, hasChildren: kids.length > 0 });
        if (kids.length && !collapsed.has(node.id)) visit(kids, level + 1, node.id);
      });
    };
    visit(doc.sections, 1, null);
    return out;
  }, [doc, collapsed]);

  const tabStop = focusedId && rows.some(r => r.node.id === focusedId) ? focusedId : (selectedId && rows.some(r => r.node.id === selectedId) ? selectedId : rows[0]?.node.id ?? null);

  const focusRow = (id: string | null | undefined) => {
    if (!id) return;
    setFocusedId(id);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus());
  };

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>, row: Row) => {
    if (dragging || e.altKey || e.metaKey || e.ctrlKey) return;
    const at = rows.findIndex(r => r.node.id === row.node.id);
    const id = row.node.id;
    const expanded = row.hasChildren && !collapsed.has(id);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(rows[at + 1]?.node.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(rows[at - 1]?.node.id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.hasChildren && !expanded) toggle(id);
        else if (expanded) focusRow(rows[at + 1]?.node.id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expanded) toggle(id);
        else focusRow(row.parentId);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(rows[0]?.node.id);
        break;
      case 'End':
        e.preventDefault();
        focusRow(rows[rows.length - 1]?.node.id);
        break;
      case 'Enter':
        e.preventDefault();
        onSelect(id);
        break;
      default:
        break;
    }
  };

  // One SortableContext per sibling group, nested in the React tree, rendering flat rows.
  const renderGroup = (nodes: BuilderNode[], level: number, parentId: string | null): React.ReactNode => (
    <SortableContext key={`group:${parentId ?? 'page'}`} items={nodes.map(n => `${OUTLINE_PREFIX}${n.id}`)} strategy={STAY}>
      {nodes.map((node, i) => {
        const kids = childrenOf(node);
        const expanded = kids.length > 0 && !collapsed.has(node.id);
        const row: Row = { node, level, setSize: nodes.length, posInSet: i + 1, parentId, hasChildren: kids.length > 0 };
        return (
          <React.Fragment key={node.id}>
            <OutlineRow
              row={row}
              label={labelOf(node.id)}
              selected={node.id === selectedId}
              focused={node.id === tabStop}
              expanded={expanded}
              hiddenHere={resolveStyle(node, device).hidden === true}
              dropLine={dragging && overId === node.id && activeId !== node.id}
              onFocusRow={setFocusedId}
              onSelect={onSelect}
              onToggle={toggle}
              onKey={onKey}
            />
            {expanded && renderGroup(kids, level + 1, node.id)}
          </React.Fragment>
        );
      })}
    </SortableContext>
  );

  return (
    <section aria-labelledby="jvb-outline-title" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <h3 id="jvb-outline-title" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Page outline</h3>
      {doc.sections.length === 0 ? (
        <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94A3B8' }}>The page is empty. Add a layout from Add blocks.</p>
      ) : (
        <div ref={treeRef} role="tree" aria-labelledby="jvb-outline-title" style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {renderGroup(doc.sections, 1, null)}
        </div>
      )}
    </section>
  );
};
