// The page builder (LANDING_BUILDER_PLAN.md Wave 2): a full-screen modal dialog over the page
// editor, with the palette and outline on the left, the canvas in the middle and the inspector on
// the right.
//
// The one write path: the document is saved into the step's `builder` field through the SAME
// onChange PageEditor uses for every other field (never a second save path), 1.5 seconds after the
// last change and again on close. The journey's own autosave takes it from there.
//
// Keyboard (LANDING_BUILDER_DESIGN.md section 7): with a block selected, Alt+Up and Alt+Down move it
// among its siblings (a run of presses is one undo step), Alt+Shift+Up and Alt+Shift+Down move it
// into the previous or next column or section, Delete or Backspace removes it, Cmd or Ctrl+D
// duplicates it, Enter on the canvas writes its text in place. Cmd or Ctrl+Z undoes and Cmd or
// Ctrl+Shift+Z redoes. Escape cancels a drag, else leaves inline editing (the canvas handles that),
// else clears the selection, else closes the builder. Nothing here takes Tab: the dialog's focus
// trap (useDialogFocus) is the only thing that touches it.
//
// Wave 3: Cmd or Ctrl+C copies the selected block, Cmd or Ctrl+X cuts it and Cmd or Ctrl+V pastes
// (never while typing in a field, where those keys are the field's own). The left panel has three
// views: Blocks (the palette, with the saved sections first, and the outline), Templates and History.
// A template or a restored version replaces the page as ONE undo step (builderState's loadDoc).

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Eye, Redo2, Undo2, X } from 'lucide-react';
import type { PageNodeData } from '../../types/journey';
import type { BuilderDoc, BuilderNode } from '../../types/pageBuilder';
import { findNode } from '../../lib/pageBuilder/model.mjs';
import { parseAppLocation } from '../../lib/journeyRoute';
import { deleteLibraryItem, listLibrary, readLibraryDelete, readLibraryList, readLibrarySave, saveLibraryItem, type LibraryItem } from '../../lib/builderLibraryClient';
import { useDialogFocus } from '../../lib/a11yHooks';
import {
  builderReducer,
  canPaste,
  canRedo,
  canUndo,
  createBuilderState,
  crossMove,
  nodeLabel,
  siblingMove,
  type BuilderAction
} from './builderState';
import {
  appendZone,
  describeZone,
  dropZonesFor,
  planDrop,
  readingOrder,
  type DragItem,
  type DropZone
} from './dropZones';
import { BuilderCanvas, type ToolbarAction } from './BuilderCanvas';
import { BuilderPalette, type SavedState } from './BuilderPalette';
import { BuilderTemplates } from './BuilderTemplates';
import { BuilderHistory } from './BuilderHistory';
import { BuilderOutline, OUTLINE_PREFIX } from './BuilderOutline';
import { BuilderInspector, DeviceSwitch } from './BuilderInspector';

/** How long after the last change the document is written into the step. */
export const AUTOSAVE_MS = 1500;

/**
 * The keys dnd-kit's keyboard sensor answers (the outline's rows). Space picks up, so Enter stays the
 * tree's "select"; Tab is left out of `end` on purpose, so no drag ever takes Tab.
 */
export const KEYBOARD_CODES = Object.freeze({ start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] });

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'To move this, press Space to pick it up. Use the arrow keys to choose where it goes. Press Space or Enter to drop it, or Escape to put it back.'
};

const isTyping = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};

interface DragState {
  item: DragItem;
  label: string;
  activeId: string;
  zones: DropZone[] | null;
}

/** Keyboard placing from the palette or the canvas's drag handle: the zones in reading order and the one chosen. */
interface Placing {
  item: DragItem;
  label: string;
  zones: DropZone[];
  index: number;
}

export interface BuilderShellProps {
  /** The step's data. `data.builder` is the document the builder opens on. */
  data: PageNodeData;
  /** PageEditor's own onChange: the one way the builder writes the step. */
  onChange: (updated: PageNodeData) => void;
  onClose: () => void;
  /** The journey and the step this page is, for History. Read from the app's address when left out. */
  journeyId?: string | null;
  nodeId?: string | null;
}

/** A section's name for the Save section prompt: its own name, else nothing. */
function sectionName(node: BuilderNode | undefined): string {
  const name = (node && node.kind === 'section' ? (node.props as { name?: unknown } | undefined)?.name : '') ?? '';
  return typeof name === 'string' ? name.trim().slice(0, 80) : '';
}

/** The item a palette button or a canvas drag handle carries, read from its data attributes. */
function placeItemOf(el: EventTarget | null, doc: BuilderDoc): { item: DragItem; label: string } | null {
  if (!(el instanceof HTMLElement)) return null;
  const widget = el.getAttribute('data-place-widget');
  const layout = el.getAttribute('data-place-layout');
  const node = el.getAttribute('data-place-node');
  const label = el.getAttribute('data-place-label') || 'Block';
  if (widget) return { item: { kind: 'widget', widgetType: widget as never }, label };
  if (layout) return { item: { kind: 'layout', columns: layout.split(',').map(Number) }, label };
  if (node && findNode(doc, node)) return { item: { kind: 'node', id: node }, label };
  return null;
}

export const BuilderShell: React.FC<BuilderShellProps> = ({ data, onChange, onClose, journeyId: journeyIdProp, nodeId: nodeIdProp }) => {
  const [state, dispatch] = useReducer(builderReducer, data.builder as BuilderDoc, (doc: BuilderDoc) => createBuilderState(doc));
  const [preview, setPreview] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineRequest, setInlineRequest] = useState<{ id: string; seq: number } | null>(null);
  const [spoken, setSpoken] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const [view, setView] = useState<'blocks' | 'canvas' | 'settings'>('canvas');
  const [leftView, setLeftView] = useState<'blocks' | 'templates' | 'history'>('blocks');
  const [saved, setSaved] = useState<SavedState>({ state: 'loading' });
  const [saving, setSaving] = useState<{ id: string; name: string; busy: boolean; error: string | null } | null>(null);
  // `error` marks a refusal, which is shown as an alert in red rather than as a green note.
  const [savedNote, setSavedNote] = useState<{ text: string; error?: boolean } | null>(null);
  // The address names the journey and the step while a page step is open on the canvas.
  const here = useMemo(() => parseAppLocation(window.location.pathname, window.location.search), []);
  const journeyId = journeyIdProp ?? here.journeyId;
  const nodeId = nodeIdProp ?? here.step;
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastEscape = useRef(0);
  // A Space or Enter that placed a block must not also click the palette button it was pressed on.
  const suppressClickUntil = useRef(0);

  // The latest of everything, for timers and cleanups.
  const stateRef = useRef(state);
  stateRef.current = state;
  const dataRef = useRef(data);
  dataRef.current = data;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const say = useCallback((text: string) => setSpoken(prev => ({ text, n: prev.n + 1 })), []);
  useEffect(() => {
    if (state.announcement) say(state.announcement.text);
  }, [state.announcement, say]);

  // ---- The saved sections library ----

  const loadSaved = useCallback(async () => {
    setSaved({ state: 'loading' });
    const r = readLibraryList(await listLibrary());
    // A part list keeps the server's reason for the console only; the palette says it in the merchant's words.
    if (r.ok && !r.value.complete && r.value.reason) console.warn('[Jourvance] Saved sections listed in part:', r.value.reason);
    setSaved(r.ok ? { state: 'ready', items: r.value.items, ...(r.value.complete ? {} : { partial: true }) } : { state: 'error', error: r.error });
  }, []);
  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const startSave = useCallback((id: string) => {
    const found = findNode(stateRef.current.doc, id);
    if (!found || found.node.kind !== 'section') {
      dispatch({ type: 'notify', text: 'Only a section can be saved. Select a section first.' });
      return;
    }
    setSavedNote(null);
    setSaving({ id, name: sectionName(found.node) || nodeLabel(stateRef.current.doc, id), busy: false, error: null });
  }, []);

  const cancelSave = useCallback(() => {
    setSaving(null);
    say('Save section cancelled. Nothing was saved.');
    requestAnimationFrame(() => dialogEl?.querySelector<HTMLElement>('[data-jvb-canvas-host]')?.focus());
  }, [dialogEl, say]);

  const confirmSave = useCallback(async () => {
    if (!saving || saving.busy) return;
    const name = saving.name.trim();
    if (!name) {
      setSaving({ ...saving, error: 'Give the section a name.' });
      say('Give the section a name.');
      return;
    }
    const found = findNode(stateRef.current.doc, saving.id);
    if (!found) {
      setSaving({ ...saving, error: 'That section is no longer on the page.' });
      say('That section is no longer on the page.');
      return;
    }
    setSaving({ ...saving, busy: true, error: null });
    const r = readLibrarySave(await saveLibraryItem(name, found.node));
    if (!r.ok) {
      setSaving({ ...saving, name, busy: false, error: r.error });
      say(r.error);
      return;
    }
    setSaved(prev => (prev.state === 'ready' ? { ...prev, items: [r.value, ...prev.items.filter(i => i.id !== r.value.id)] } : { state: 'ready', items: [r.value] }));
    setSaving(null);
    // durable:false is the route's honest answer: the account store did not take it. The reason
    // is for whoever runs the app, so it goes to the console, not to the merchant.
    if (!r.durable && r.reason) console.warn('[Jourvance] Saved section not stored to the account:', r.reason);
    const note = r.durable
      ? `Saved ${r.value.name} to your library. It is in Saved at the top of Add blocks.`
      : `Saved ${r.value.name} for now, but not to your account yet, so it may disappear later. It is in Saved at the top of Add blocks.`;
    setSavedNote({ text: note });
    say(note);
    // The form that held focus is gone; put the keyboard back on the page, as Cancel does.
    requestAnimationFrame(() => dialogEl?.querySelector<HTMLElement>('[data-jvb-canvas-host]')?.focus());
  }, [saving, say, dialogEl]);

  // Deleting from the library is not undoable, so the palette asks first. Focus then goes to the
  // Saved heading, because the row that held it is gone.
  const deleteSaved = useCallback(async (item: LibraryItem): Promise<boolean> => {
    const r = readLibraryDelete(await deleteLibraryItem(item.id));
    if (!r.ok) {
      setSavedNote({ text: r.error, error: true });
      say(r.error);
      return false;
    }
    setSaved(prev => (prev.state === 'ready' ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : prev));
    // durable:false means only this server held it (no account store here), as on save.
    if (!r.durable && r.reason) console.warn('[Jourvance] Saved section delete not stored to the account:', r.reason);
    const note = r.durable
      ? `Deleted ${item.name} from your library.`
      : `Deleted ${item.name} from your library on this server. It was never stored in your account, so nothing else changes.`;
    setSavedNote({ text: note });
    say(note);
    requestAnimationFrame(() => dialogEl?.querySelector<HTMLElement>('#jvb-palette-saved')?.focus());
    return true;
  }, [say, dialogEl]);

  const addSaved = useCallback((item: LibraryItem) => {
    dispatch({ type: 'insertSaved', node: item.section, name: item.name });
  }, []);

  // ---- Templates and History: a whole new page, as one undo step ----

  const loadDoc = useCallback((doc: BuilderDoc, sentence: string) => {
    dispatch({ type: 'loadDoc', doc, sentence });
  }, []);

  // ---- Saving: the step's own onChange, 1.5 s after the last change and on close ----

  const save = useCallback(() => {
    const s = stateRef.current;
    if (s.doc === s.savedDoc) return;
    onChangeRef.current({ ...dataRef.current, builder: s.doc });
    dispatch({ type: 'markSaved', doc: s.doc });
  }, []);

  useEffect(() => {
    if (!state.dirty) return;
    const timer = window.setTimeout(save, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [state.doc, state.dirty, save]);

  // Leaving by any route still writes the last change.
  useEffect(() => () => save(), [save]);

  const requestClose = useCallback(() => {
    save();
    onCloseRef.current();
  }, [save]);

  // ---- The dialog: on the shared stack, modal, focus in on open and back on close ----

  const panelRef = useDialogFocus<HTMLDialogElement>(true, requestClose, { modal: true, initialFocus: false });
  useEffect(() => {
    const dialog = panelRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    dialog.querySelector<HTMLElement>('[data-dialog-start]')?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Keys and focus never leave the builder for the journey map behind it ----
  // The map's own shortcuts listen on the document: Delete there removes the selected STEP, this very
  // page. The dialog carries React Flow's `nokey` class, so a key pressed inside it is never the map's.
  // And when React moves a focused row (a keyboard move reorders the outline) focus falls to the page
  // body, where the next key would reach the map: the guard below stops any key whose target is not in
  // the builder, and the focus watcher puts focus back on the same row.
  useEffect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    const host = () => dialog.querySelector<HTMLElement>('[data-jvb-canvas-host]');
    const restore = (lost: HTMLElement | null, nodeId: string | null) => {
      const row = nodeId ? dialog.querySelector<HTMLElement>(`[role="treeitem"][data-node-id="${CSS.escape(nodeId)}"]`) : null;
      const back = row ?? (lost && lost.isConnected && dialog.contains(lost) ? lost : null) ?? host();
      back?.focus({ preventScroll: true });
    };
    const guard = (e: KeyboardEvent) => {
      if (e.target instanceof Node && dialog.contains(e.target)) return;
      e.stopPropagation();
      if (e.key === 'Tab') return; // the browser moves focus into the modal dialog itself
      e.preventDefault();
      restore(null, null);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      const lost = e.target instanceof HTMLElement ? e.target : null;
      const nodeId = lost?.getAttribute('data-node-id') ?? null;
      requestAnimationFrame(() => {
        if (!dialog.isConnected || !dialog.open) return;
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) return;
        restore(lost, nodeId);
      });
    };
    window.addEventListener('keydown', guard, true);
    dialog.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('keydown', guard, true);
      dialog.removeEventListener('focusout', onFocusOut);
    };
  }, [dialogEl]);

  // ---- Labels and the actions every control shares ----

  const labelOf = useCallback((id: string) => nodeLabel(stateRef.current.doc, id), []);
  const act = useCallback((action: BuilderAction) => dispatch(action), []);

  const toolbar = useCallback((kind: ToolbarAction, id: string) => {
    const doc = stateRef.current.doc;
    if (kind === 'duplicate') dispatch({ type: 'duplicate', id });
    else if (kind === 'remove') dispatch({ type: 'remove', id });
    else if (kind === 'copy') dispatch({ type: 'copyNode', id });
    else if (kind === 'cut') dispatch({ type: 'cutNode', id });
    else if (kind === 'paste') dispatch({ type: 'pasteNode' });
    else if (kind === 'save') startSave(id);
    else {
      const r = siblingMove(doc, id, kind === 'up' ? -1 : 1);
      dispatch('action' in r ? r.action : { type: 'notify', text: r.refused });
    }
  }, [startSave]);

  const addFromPalette = useCallback((item: DragItem) => {
    if (performance.now() < suppressClickUntil.current) return;
    const doc = stateRef.current.doc;
    const plan = planDrop(doc, item, appendZone(doc, item, stateRef.current.selectedId));
    dispatch(plan.ok ? plan.action : { type: 'notify', text: plan.reason });
  }, []);

  // ---- Keyboard placing (palette items and the canvas drag handle) ----

  const startPlacing = (item: DragItem, label: string) => {
    const doc = stateRef.current.doc;
    const zones = readingOrder(doc, dropZonesFor(doc, item));
    if (!zones.length) {
      dispatch({ type: 'notify', text: `There is nowhere on this page ${label} can go.` });
      return;
    }
    const want = appendZone(doc, item, stateRef.current.selectedId).id;
    const index = Math.max(0, zones.findIndex(z => z.id === want));
    suppressClickUntil.current = performance.now() + 600;
    setPlacing({ item, label, zones, index });
    say(`Picked up ${label}. ${describeZone(doc, zones[index], labelOf)}. Use the arrow keys to choose where it goes, then Space or Enter to drop it, or Escape to put it back.`);
  };

  const placingKey = (e: React.KeyboardEvent): boolean => {
    if (!placing) return false;
    const doc = stateRef.current.doc;
    if (e.key === 'Tab') {
      setPlacing(null);
      say(`${placing.label} put back.`);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      lastEscape.current = performance.now();
      setPlacing(null);
      say(`${placing.label} put back. Nothing changed.`);
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const index = Math.min(placing.zones.length - 1, Math.max(0, placing.index + delta));
      setPlacing({ ...placing, index });
      say(describeZone(doc, placing.zones[index], labelOf));
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      const zone = placing.zones[placing.index];
      const plan = planDrop(doc, placing.item, zone);
      suppressClickUntil.current = performance.now() + 600;
      setPlacing(null);
      dispatch(plan.ok ? plan.action : { type: 'notify', text: plan.reason });
      return true;
    }
    return true;
  };

  // ---- Keys for the whole builder ----

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    // A key the builder acts on goes no further. React re-renders inside this handler, so the row a
    // Delete was pressed on is already gone from the page when the event reaches the document, and
    // the journey map's own Delete (React Flow) no longer sees the .nokey around it: it would delete
    // the selected STEP. Never for Tab, which the dialog's focus trap needs, and never during a drag,
    // whose sensor listens on the document.
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (placing) {
      if (placingKey(e) && e.key !== 'Tab') e.stopPropagation();
      return;
    }
    const s = stateRef.current;
    if (e.key === 'Escape') {
      lastEscape.current = performance.now();
      if (drag || inlineEditing) {
        e.preventDefault(); // the drag sensor and the inline editor answer their own Escape
        return;
      }
      handled();
      if (s.selectedId) {
        const fromInspector = e.target instanceof HTMLElement && !!e.target.closest('[data-builder-inspector]');
        dispatch({ type: 'select', id: null });
        if (fromInspector) dialogEl?.querySelector<HTMLElement>('[data-jvb-canvas-host]')?.focus();
        return;
      }
      requestClose();
      return;
    }
    if (drag || inlineEditing) return;
    const typing = isTyping(e.target);
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && key === 'z') {
      if (typing) return;
      handled();
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === 'y') {
      if (typing) return;
      handled();
      dispatch({ type: 'redo' });
      return;
    }
    if (typing) return;
    // Space on a palette item or a drag handle picks it up for keyboard placing.
    if ((e.code === 'Space' || e.key === ' ') && !mod && !e.altKey) {
      const place = placeItemOf(e.target, s.doc);
      if (place) {
        handled();
        startPlacing(place.item, place.label);
      }
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && key === 'v') {
      handled();
      dispatch({ type: 'pasteNode' });
      return;
    }
    if (!s.selectedId) return;
    if (mod && !e.altKey && !e.shiftKey && (key === 'c' || key === 'x')) {
      handled();
      dispatch({ type: key === 'c' ? 'copyNode' : 'cutNode', id: s.selectedId });
      return;
    }
    if (mod && !e.altKey && key === 'd') {
      handled();
      dispatch({ type: 'duplicate', id: s.selectedId });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey) {
      handled();
      dispatch({ type: 'remove', id: s.selectedId });
      return;
    }
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      handled();
      const delta = e.key === 'ArrowUp' ? -1 : 1;
      const r = e.shiftKey ? crossMove(s.doc, s.selectedId, delta, Date.now()) : siblingMove(s.doc, s.selectedId, delta, Date.now());
      dispatch('action' in r ? r.action : { type: 'notify', text: r.refused });
      return;
    }
    if (e.key === 'Enter' && !mod && !e.altKey && e.target instanceof HTMLElement && e.target.hasAttribute('data-jvb-canvas-host')) {
      handled();
      setInlineRequest(prev => ({ id: s.selectedId as string, seq: (prev?.seq ?? 0) + 1 }));
    }
  };

  // ---- Pointer drag and the outline's keyboard drag (dnd-kit) ----

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: [...KEYBOARD_CODES.start], cancel: [...KEYBOARD_CODES.cancel], end: [...KEYBOARD_CODES.end] }, coordinateGetter: sortableKeyboardCoordinates })
  );

  const collision: CollisionDetection = useCallback(args => {
    const outline = String(args.active.id).startsWith(OUTLINE_PREFIX);
    const droppableContainers = args.droppableContainers.filter(c => String(c.id).startsWith(outline ? OUTLINE_PREFIX : 'zone:'));
    const scoped = { ...args, droppableContainers };
    const p = args.pointerCoordinates;
    if (!p) return closestCenter(scoped);
    if (!outline) {
      const frame = scrollerRef.current?.getBoundingClientRect();
      if (frame && (p.x < frame.left || p.x > frame.right || p.y < frame.top || p.y > frame.bottom)) return [];
      const within = pointerWithin(scoped);
      if (within.length) return within;
    }
    // The nearest to the pointer, not to the dragged item's box.
    return closestCenter({ ...scoped, collisionRect: { left: p.x, top: p.y, right: p.x, bottom: p.y, width: 0, height: 0 } });
  }, []);

  const dragLabel = (data: unknown): string => {
    const d = data as { label?: string; drag?: DragItem } | undefined;
    if (d?.label) return d.label;
    if (d?.drag?.kind === 'node') return labelOf(d.drag.id);
    return 'Block';
  };

  const describeOver = (over: { id: string | number; data: { current?: unknown } } | null): string => {
    if (!over) return 'nowhere it can go';
    const d = over.data.current as { zone?: DropZone; nodeId?: string } | undefined;
    if (d?.zone) return describeZone(stateRef.current.doc, d.zone, labelOf);
    if (d?.nodeId) return `the place of ${labelOf(d.nodeId)}`;
    return 'a new place';
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${dragLabel(active.data.current)}.`,
    onDragOver: ({ active, over }) => `${dragLabel(active.data.current)} is over ${describeOver(over)}.`,
    onDragEnd: ({ active, over }) => (over ? `${dragLabel(active.data.current)} dropped on ${describeOver(over)}.` : `${dragLabel(active.data.current)} put back.`),
    onDragCancel: ({ active }) => `${dragLabel(active.data.current)} put back. Nothing changed.`
  };

  const onDragStart = (e: DragStartEvent) => {
    setPlacing(null);
    const data = e.active.data.current as { drag?: DragItem } | undefined;
    const item = data?.drag;
    if (!item) return;
    const activeId = String(e.active.id);
    const outline = activeId.startsWith(OUTLINE_PREFIX);
    setDrag({ item, label: dragLabel(e.active.data.current), activeId, zones: outline ? null : dropZonesFor(stateRef.current.doc, item) });
    setOverId(null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const d = e.over?.data.current as { zone?: DropZone; nodeId?: string } | undefined;
    setOverId(d?.zone ? d.zone.id : d?.nodeId ?? null);
  };

  const finishDrag = () => {
    setDrag(null);
    setOverId(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const item = (e.active.data.current as { drag?: DragItem } | undefined)?.drag;
    const d = e.over?.data.current as { zone?: DropZone; nodeId?: string } | undefined;
    finishDrag();
    if (!item || !e.over) return;
    const doc = stateRef.current.doc;
    if (d?.zone) {
      const plan = planDrop(doc, item, d.zone);
      if (plan.ok) dispatch(plan.action);
      else if (!plan.noop) dispatch({ type: 'notify', text: plan.reason });
      return;
    }
    if (d?.nodeId && item.kind === 'node' && d.nodeId !== item.id) {
      const target = findNode(doc, d.nodeId);
      if (!target) return;
      dispatch({ type: 'move', id: item.id, parentId: target.parent ? target.parent.id : null, index: target.index });
    }
  };

  // While a drag is on, a scroll of the canvas moves the zones: measure them again.
  const [measureTick, setMeasureTick] = useState(0);
  const onCanvasScroll = useCallback(() => {
    if (drag) setMeasureTick(t => t + 1);
  }, [drag]);

  // Bring the zone being chosen into view.
  const shownZoneId = placing ? placing.zones[placing.index]?.id ?? null : drag?.zones ? overId : null;
  useEffect(() => {
    if (!shownZoneId) return;
    const el = scrollerRef.current?.querySelector(`[data-zone-id="${CSS.escape(shownZoneId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [shownZoneId]);

  const zones = placing ? placing.zones : drag?.zones ?? null;
  const pageName = data.slug ? `/${data.slug}` : 'Landing page';
  const undoOk = canUndo(state);
  const redoOk = canRedo(state);

  const overlayLabel = drag?.label ?? '';
  const dragOutlineNodeId = drag && drag.activeId.startsWith(OUTLINE_PREFIX) ? drag.activeId.slice(OUTLINE_PREFIX.length) : null;

  const titleId = 'jvb-builder-title';
  const viewButton = (id: 'blocks' | 'canvas' | 'settings', label: string) => (
    <button type="button" aria-pressed={view === id} onClick={() => setView(id)} style={{ ...topButton, backgroundColor: view === id ? '#4338CA' : 'transparent' }}>
      {label}
    </button>
  );

  return (
    <dialog
      ref={el => {
        (panelRef as React.MutableRefObject<HTMLDialogElement | null>).current = el;
        if (el !== dialogEl) setDialogEl(el);
      }}
      aria-labelledby={titleId}
      aria-modal="true"
      className="jv-builder nokey"
      onKeyDown={onKeyDown}
      onCancel={e => {
        e.preventDefault();
        if (performance.now() - lastEscape.current < 100) return;
        if (stateRef.current.selectedId) dispatch({ type: 'select', id: null });
        else requestClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
        padding: 0,
        border: 'none',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0B0F19',
        color: '#F8FAFC',
        overflow: 'hidden'
      }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: '#111827' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, flex: '1 1 160px' }}>
          <h2 id={titleId} tabIndex={-1} data-dialog-start style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#FFFFFF', whiteSpace: 'nowrap' }}>
            Page builder
          </h2>
          <span style={{ fontSize: '12px', color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pageName}</span>
        </div>
        <DeviceSwitch device={state.device} onDevice={d => dispatch({ type: 'setDevice', device: d })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Command or Control Z)"
            aria-disabled={!undoOk}
            onClick={() => { if (undoOk) dispatch({ type: 'undo' }); }}
            style={{ ...iconButton, opacity: undoOk ? 1 : 0.45 }}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Command or Control Shift Z)"
            aria-disabled={!redoOk}
            onClick={() => { if (redoOk) dispatch({ type: 'redo' }); }}
            style={{ ...iconButton, opacity: redoOk ? 1 : 0.45 }}
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </div>
        <span
          role="status"
          data-builder-save-state={state.dirty ? 'dirty' : 'saved'}
          style={{
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 700,
            color: state.dirty ? '#FDE68A' : '#A7F3D0',
            backgroundColor: state.dirty ? 'rgba(245, 158, 11, 0.14)' : 'rgba(16, 185, 129, 0.14)',
            whiteSpace: 'nowrap'
          }}
        >
          {state.dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(p => !p)} style={topButton}>
          <Eye size={14} aria-hidden="true" />
          <span>Preview</span>
        </button>
        <button type="button" onClick={requestClose} style={{ ...topButton, backgroundColor: '#4338CA', borderColor: '#4338CA' }}>
          <X size={14} aria-hidden="true" />
          <span>Close</span>
        </button>
      </div>

      <div className="jv-builder-views" style={{ gap: '4px', padding: '6px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
        {viewButton('blocks', 'Blocks')}
        {viewButton('canvas', 'Page')}
        {viewButton('settings', 'Settings')}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS, container: dialogEl ?? undefined }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={finishDrag}
      >
        <div className="jv-builder-body">
          <div className="jv-builder-panel" data-view="blocks" {...(view === 'blocks' ? { 'data-view-active': '' } : {})} style={{ borderRight: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div role="group" aria-label="Left panel" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {([['blocks', 'Blocks'], ['templates', 'Templates'], ['history', 'History']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-left-view={id}
                  aria-pressed={leftView === id}
                  onClick={() => setLeftView(id)}
                  style={{ ...topButton, backgroundColor: leftView === id ? '#4338CA' : 'transparent' }}
                >
                  {label}
                </button>
              ))}
            </div>
            {leftView === 'templates' && (
              <BuilderTemplates
                hasContent={state.doc.sections.length > 0}
                onUse={(doc, name) => loadDoc(doc, `Page replaced with the ${name} template. Undo brings your page back.`)}
              />
            )}
            {leftView === 'history' && (
              <BuilderHistory
                journeyId={journeyId}
                nodeId={nodeId}
                onRestore={(doc, label) => loadDoc(doc, `Restored ${label}. Undo brings back the page you had. Nothing is published until you publish.`)}
                onProblem={say}
              />
            )}
            {leftView === 'blocks' && <BuilderPalette onAdd={addFromPalette} saved={saved} onAddSaved={addSaved} onDeleteSaved={deleteSaved} onRetrySaved={() => void loadSaved()} />}
            {leftView === 'blocks' && <BuilderOutline
              doc={state.doc}
              device={state.device}
              selectedId={state.selectedId}
              labelOf={labelOf}
              onSelect={id => dispatch({ type: 'select', id })}
              activeId={dragOutlineNodeId}
              overId={dragOutlineNodeId ? overId : null}
              dragging={!!drag}
            />}
          </div>

          <div data-view="canvas" {...(view === 'canvas' ? { 'data-view-active': '' } : {})} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            {state.notice && (
              <div role="note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '8px 12px 0', padding: '8px 10px', borderRadius: '8px', backgroundColor: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#FDE68A', fontSize: '12px' }}>
                <span>{state.notice.text}</span>
                <button type="button" onClick={() => dispatch({ type: 'clearNotice' })} style={{ ...topButton, padding: '3px 8px' }}>Dismiss</button>
              </div>
            )}
            {saving && (
              <form
                data-save-section=""
                aria-label="Save section to your library"
                onSubmit={e => {
                  e.preventDefault();
                  void confirmSave();
                }}
                style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap', margin: '8px 12px 0', padding: '8px 10px', borderRadius: '8px', backgroundColor: 'rgba(67, 56, 202, 0.18)', border: '1px solid rgba(129, 140, 248, 0.45)' }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: '#E0E7FF', flex: '1 1 180px', minWidth: 0 }}>
                  Name this saved section
                  <input
                    type="text"
                    autoFocus
                    value={saving.name}
                    maxLength={80}
                    aria-invalid={saving.error ? true : undefined}
                    onChange={e => setSaving({ ...saving, name: e.target.value, error: null })}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        lastEscape.current = performance.now();
                        cancelSave();
                      }
                    }}
                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.2)', backgroundColor: '#0B0F19', color: '#F8FAFC', fontSize: '13px', minWidth: 0 }}
                  />
                </label>
                <button type="submit" aria-disabled={saving.busy} style={{ ...topButton, backgroundColor: '#4338CA', borderColor: '#4338CA' }}>{saving.busy ? 'Saving' : 'Save'}</button>
                <button type="button" onClick={cancelSave} style={topButton}>Cancel</button>
                {saving.error && <p role="alert" style={{ flexBasis: '100%', margin: 0, fontSize: '12px', color: '#FCA5A5' }}>{saving.error}</p>}
              </form>
            )}
            {savedNote && (
              <div
                role={savedNote.error ? 'alert' : 'note'}
                data-saved-note={savedNote.error ? 'error' : 'ok'}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', margin: '8px 12px 0', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', ...(savedNote.error
                  ? { backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.45)', color: '#FCA5A5' }
                  : { backgroundColor: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#A7F3D0' }) }}
              >
                <span>{savedNote.text}</span>
                <button type="button" onClick={() => setSavedNote(null)} style={{ ...topButton, padding: '3px 8px' }}>Close note</button>
              </div>
            )}
            {placing && (
              <p style={{ margin: '8px 12px 0', fontSize: '12px', color: '#C7D2FE' }}>
                {`Placing ${placing.label}: arrows choose the place, Space or Enter drops it, Escape puts it back.`}
              </p>
            )}
            <BuilderCanvas
              doc={state.doc}
              device={state.device}
              selectedId={state.selectedId}
              hoveredId={state.hoveredId}
              preview={preview}
              zones={zones}
              overZoneId={shownZoneId}
              labelOf={labelOf}
              onSelect={id => {
                setPlacing(null);
                dispatch({ type: 'select', id });
              }}
              onHover={id => dispatch({ type: 'hover', id })}
              onToolbar={toolbar}
              canPaste={canPaste(state)}
              onInlineCommit={(id, patch, target) => dispatch({ type: 'setProps', id, props: patch, target })}
              inlineRequest={inlineRequest}
              onEditingChange={setInlineEditing}
              scrollerRef={scrollerRef}
              onScroll={onCanvasScroll}
              measureTick={measureTick}
            />
          </div>

          <div className="jv-builder-panel" data-view="settings" data-builder-inspector="" {...(view === 'settings' ? { 'data-view-active': '' } : {})} style={{ borderLeft: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <BuilderInspector
              doc={state.doc}
              device={state.device}
              selectedId={state.selectedId}
              notice={state.notice}
              dispatch={act}
              onDevice={d => dispatch({ type: 'setDevice', device: d })}
              labelOf={labelOf}
              onSay={say}
            />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {drag ? (
            <div style={{ padding: '6px 10px', borderRadius: '8px', backgroundColor: '#4338CA', color: '#FFFFFF', fontSize: '12px', fontWeight: 700, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {overlayLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* One polite live region for every change, refusal and keyboard placing step. */}
      <div role="status" aria-live="polite" className="jv-sr-only">
        {spoken.text}
        {spoken.n % 2 ? ' ' : ''}
      </div>
    </dialog>
  );
};

const topButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 10px',
  borderRadius: '7px',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backgroundColor: 'transparent',
  color: '#F1F5F9',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer'
};

const iconButton: React.CSSProperties = {
  ...topButton,
  padding: '5px 7px'
};
