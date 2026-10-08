// The page builder's palette (LANDING_BUILDER_DESIGN.md sections 4 and 6): layouts, then the widgets
// by WIDGET_GROUPS. Each item is a button and a draggable. Click (or Enter) adds it next to what is
// selected; Space picks it up for a keyboard drag; a pointer drags it onto a drop zone.

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { WIDGET_GROUPS, WIDGET_REGISTRY } from '../../lib/pageBuilder/model.mjs';
import type { WidgetType } from '../../types/pageBuilder';
import { LAYOUTS, type DragItem } from './dropZones';

export interface BuilderPaletteProps {
  onAdd: (item: DragItem, label: string) => void;
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '2px',
  width: '100%',
  padding: '7px 9px',
  borderRadius: '7px',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  color: '#F1F5F9',
  fontSize: '12px',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'grab',
  touchAction: 'none'
};

const PaletteItem: React.FC<{ dragId: string; item: DragItem; label: string; description: string; onAdd: BuilderPaletteProps['onAdd'] }> = ({
  dragId,
  item,
  label,
  description,
  onAdd
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId, data: { drag: item, label } });
  // The pointer drags with dnd-kit. Space is the shell's keyboard placing, read from data-place-*.
  const { onKeyDown: _dndKey, ...pointer } = (listeners ?? {}) as Record<string, unknown>;
  const place = item.kind === 'widget'
    ? { 'data-place-widget': item.widgetType }
    : item.kind === 'layout'
      ? { 'data-place-layout': item.columns.join(',') }
      : {};
  return (
    <li style={{ listStyle: 'none' }}>
      <button
        ref={setNodeRef}
        type="button"
        {...attributes}
        {...(pointer as React.DOMAttributes<HTMLButtonElement>)}
        {...place}
        data-place-label={label}
        data-palette-item={label}
        aria-label={`Add ${label}`}
        title={description}
        onClick={() => onAdd(item, label)}
        style={{ ...itemStyle, opacity: isDragging ? 0.5 : 1 }}
      >
        <span>{label}</span>
      </button>
    </li>
  );
};

const groupHeading: React.CSSProperties = {
  margin: '10px 0 6px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#A5B4FC'
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '6px',
  margin: 0,
  padding: 0
};

export const BuilderPalette: React.FC<BuilderPaletteProps> = ({ onAdd }) => {
  const widgets = Object.values(WIDGET_REGISTRY) as Array<{ type: WidgetType; label: string; group: string; description: string }>;
  return (
    <section aria-labelledby="jvb-palette-title" style={{ display: 'flex', flexDirection: 'column' }}>
      <h3 id="jvb-palette-title" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Add blocks</h3>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: 1.45 }}>
        Click to add next to what is selected, or drag onto the page. With the keyboard, Space picks a block up and the arrows choose where it goes.
      </p>

      <h4 id="jvb-palette-layouts" style={groupHeading}>Layouts</h4>
      <ul aria-labelledby="jvb-palette-layouts" style={gridStyle}>
        {LAYOUTS.map(layout => (
          <PaletteItem
            key={layout.id}
            dragId={`palette:layout:${layout.id}`}
            item={{ kind: 'layout', columns: [...layout.columns] }}
            label={`Section, ${layout.label}`}
            description={`A new section with ${layout.label === '1 column' ? 'one column' : layout.label}.`}
            onAdd={onAdd}
          />
        ))}
      </ul>

      {WIDGET_GROUPS.map(group => {
        const inGroup = widgets.filter(w => w.group === group.id);
        if (!inGroup.length) return null;
        const headingId = `jvb-palette-${group.id}`;
        return (
          <React.Fragment key={group.id}>
            <h4 id={headingId} style={groupHeading}>{group.label}</h4>
            <ul aria-labelledby={headingId} style={gridStyle}>
              {inGroup.map(w => (
                <PaletteItem
                  key={w.type}
                  dragId={`palette:${w.type}`}
                  item={{ kind: 'widget', widgetType: w.type }}
                  label={w.label}
                  description={w.description}
                  onAdd={onAdd}
                />
              ))}
            </ul>
          </React.Fragment>
        );
      })}
    </section>
  );
};
