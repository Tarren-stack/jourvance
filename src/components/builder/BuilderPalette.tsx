// The page builder's palette (LANDING_BUILDER_DESIGN.md sections 4 and 6): layouts, then the widgets
// by WIDGET_GROUPS. Each item is a button and a draggable. Click (or Enter) adds it next to what is
// selected; Space picks it up for a keyboard drag; a pointer drags it onto a drop zone.
//
// Wave 3: a "Saved" group comes first, the sections the merchant saved to their library
// (server/routes/builderLibraryRoutes.mjs, read by the shell). A saved item is a button: click or
// Enter puts a copy, with fresh ids, after the section that holds the selection. Its Delete asks
// first (Delete or Keep), because removing it from the library cannot be undone.

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { WIDGET_GROUPS, WIDGET_REGISTRY } from '../../lib/pageBuilder/model.mjs';
import type { WidgetType } from '../../types/pageBuilder';
import type { LibraryItem } from '../../lib/builderLibraryClient';
import { LAYOUTS, type DragItem } from './dropZones';

/** What the shell knows of the saved sections library. */
export type SavedState =
  | { state: 'loading' }
  | { state: 'ready'; items: LibraryItem[]; partial?: boolean }
  | { state: 'error'; error: string };

export interface BuilderPaletteProps {
  onAdd: (item: DragItem, label: string) => void;
  saved?: SavedState;
  onAddSaved?: (item: LibraryItem) => void;
  /** Deletes a saved section from the library. The palette asks first; it is not undoable. */
  onDeleteSaved?: (item: LibraryItem) => Promise<boolean>;
  onRetrySaved?: () => void;
}

/** What a part-read library says, in the merchant's words. The server's reason goes to the console. */
export const SAVED_PARTIAL_NOTE = 'Some of your saved sections could not be loaded just now, so this list may be missing a few.';

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

const SavedGroup: React.FC<{ saved: SavedState; onAddSaved: (item: LibraryItem) => void; onDelete?: (item: LibraryItem) => Promise<boolean>; onRetry?: () => void }> = ({ saved, onAddSaved, onDelete, onRetry }) => {
  // The id whose delete is being asked about, and whether that delete is on its way.
  const [asking, setAsking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const keep = (id: string) => {
    setAsking(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-saved-delete="${CSS.escape(id)}"]`)?.focus());
  };
  const confirm = async (item: LibraryItem) => {
    if (!onDelete || busy) return;
    setBusy(true);
    const gone = await onDelete(item);
    setBusy(false);
    // Deleted: the shell moves focus to the Saved heading. Refused: the row stays, so focus goes
    // back to its own Delete, and the shell has said why.
    if (gone) setAsking(null);
    else keep(item.id);
  };
  return (
  <>
    <h4 id="jvb-palette-saved" tabIndex={-1} style={groupHeading}>Saved</h4>
    {saved.state === 'loading' && <p role="status" style={hint}>Loading your saved sections.</p>}
    {saved.state === 'error' && (
      <div role="alert" style={{ fontSize: '11px', color: '#FCA5A5', lineHeight: 1.45 }}>
        <p style={{ margin: '0 0 6px' }}>{saved.error}</p>
        {onRetry && <button type="button" onClick={onRetry} style={{ ...itemStyle, width: 'auto', cursor: 'pointer' }}>Try again</button>}
      </div>
    )}
    {saved.state === 'ready' && saved.items.length === 0 && (
      <p style={hint}>Nothing saved yet. Select a section and choose Save section on its toolbar to keep it here for any page.</p>
    )}
    {saved.state === 'ready' && saved.partial && (
      <div role="note" style={{ ...hint, color: '#FDE68A' }}>
        <p style={{ margin: '0 0 6px' }}>{SAVED_PARTIAL_NOTE}</p>
        {onRetry && <button type="button" onClick={onRetry} style={{ ...itemStyle, width: 'auto', cursor: 'pointer' }}>Try again</button>}
      </div>
    )}
    {saved.state === 'ready' && saved.items.length > 0 && (
      <ul aria-labelledby="jvb-palette-saved" style={gridStyle}>
        {saved.items.map(item => (
          <li key={item.id} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              type="button"
              data-saved-item={item.id}
              aria-label={`Add saved section ${item.name}`}
              title={`Adds a copy of ${item.name} after the selected section.`}
              onClick={() => onAddSaved(item)}
              style={{ ...itemStyle, cursor: 'pointer' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>{item.name}</span>
            </button>
            {onDelete && (asking === item.id ? (
              <div role="group" aria-label={`Delete ${item.name} from your library?`} style={{ display: 'flex', gap: '4px' }}>
                <button type="button" data-saved-delete-confirm={item.id} aria-disabled={busy} onClick={() => void confirm(item)} style={{ ...smallItemButton, color: '#FCA5A5' }}>{busy ? 'Deleting' : 'Delete'}</button>
                <button type="button" autoFocus onClick={() => keep(item.id)} style={smallItemButton}>Keep</button>
              </div>
            ) : (
              <button type="button" data-saved-delete={item.id} aria-label={`Delete saved section ${item.name}`} onClick={() => setAsking(item.id)} style={smallItemButton}>
                Delete
              </button>
            ))}
          </li>
        ))}
      </ul>
    )}
  </>
  );
};

const smallItemButton: React.CSSProperties = { ...itemStyle, width: 'auto', alignSelf: 'flex-start', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' };

const hint: React.CSSProperties = { margin: 0, fontSize: '11px', color: '#94A3B8', lineHeight: 1.45 };

export const BuilderPalette: React.FC<BuilderPaletteProps> = ({ onAdd, saved, onAddSaved, onDeleteSaved, onRetrySaved }) => {
  const widgets = Object.values(WIDGET_REGISTRY) as Array<{ type: WidgetType; label: string; group: string; description: string }>;
  return (
    <section aria-labelledby="jvb-palette-title" style={{ display: 'flex', flexDirection: 'column' }}>
      <h3 id="jvb-palette-title" style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Add blocks</h3>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: 1.45 }}>
        Click to add next to what is selected, or drag onto the page. With the keyboard, Space picks a block up and the arrows choose where it goes.
      </p>

      {saved && onAddSaved && <SavedGroup saved={saved} onAddSaved={onAddSaved} onDelete={onDeleteSaved} onRetry={onRetrySaved} />}

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
