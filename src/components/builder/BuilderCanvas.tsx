// The page builder's canvas (LANDING_BUILDER_PLAN.md decision 5; LANDING_BUILDER_DESIGN.md sections
// 3, 4 and 7). It draws the SAME html and css the server publishes, from render.mjs, into a shadow
// root, so the page's styles never reach the cockpit and the cockpit's never reach the page. The
// editor's own marks (hover and selection outlines, the toolbar, drop zones) live in the light DOM
// above it, placed from the boxes of the shadow nodes (`.jvb-n-<id>`), so drag and drop and the
// outlines share one document with the rest of the builder.
//
// Nothing from the page runs here: the renderer writes no script, the markup is stripped of any
// script before parsing, parsed in an inert <template>, and cleared of event handler attributes
// and script links before it reaches the shadow root. The page's links, buttons and fields take no
// pointer and no Tab stop, so a click selects a block and Tab moves through the editor.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookmarkPlus, ClipboardCopy, ClipboardPaste, Copy, GripVertical, Scissors, Trash2 } from 'lucide-react';
import { render } from '../../lib/pageBuilder/render.mjs';
import { MOTION_PRESETS, findNode, resolveStyle, walk } from '../../lib/pageBuilder/model.mjs';
import type { BuilderDevice, BuilderDoc, BuilderNode, BuilderWidget } from '../../types/pageBuilder';
import { zoneGeometry, type DropZone, type Rect } from './dropZones';
import {
  DESIGN_WIDTHS,
  EDITOR_CSS,
  EMPTY_HINTS,
  INLINE_TARGETS,
  canvasScale,
  cleanInlineText,
  inlineLabel,
  inlineMultiline,
  inlinePatch,
  inlineValue,
  isHandlerAttribute,
  isUnsafeUrl,
  itemPropIndex,
  stripScripts,
  type InlineTarget
} from './canvasMarkup';
import { DEVICE_IN_MAX_MS, removeClassWhenPlayed, toolbarFocusMemo, toolbarFocusTarget, type ToolbarFocusMemo } from './motion';

/** How wide the page is drawn for each device (see canvasMarkup.DESIGN_WIDTHS). */
export const DEVICE_WIDTHS = DESIGN_WIDTHS;

/** The frame's padding on each side, in CSS pixels. */
const FRAME_PAD = 24;

/** Below this frame width the selection toolbar drops its visible label to stay one row. */
const TOOLBAR_LABEL_MIN_FRAME = 480;

export type ToolbarAction = 'up' | 'down' | 'duplicate' | 'remove' | 'copy' | 'cut' | 'paste' | 'save';

export interface BuilderCanvasProps {
  doc: BuilderDoc;
  device: BuilderDevice;
  selectedId: string | null;
  hoveredId: string | null;
  /** Preview hides every editor mark. */
  preview: boolean;
  /** The zones of the drag in progress, or null when nothing is being dragged. */
  zones: DropZone[] | null;
  overZoneId: string | null;
  labelOf: (id: string) => string;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onToolbar: (action: ToolbarAction, id: string) => void;
  /** Something is on the builder's clipboard, so Paste can act. */
  canPaste?: boolean;
  onInlineCommit: (id: string, patch: Record<string, unknown>, target: string) => void;
  /** Bumped by the shell (Enter on a selected widget) to start editing its first in-place prop. */
  inlineRequest: { id: string; seq: number } | null;
  onEditingChange: (editing: boolean) => void;
  /** The scrolling frame, which the shell watches to re-measure drop zones during a drag. */
  scrollerRef: React.MutableRefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  /** Bumped by the shell when the frame scrolls during a drag, so the zones are measured again. */
  measureTick?: number;
  /** The node a drop, paste or duplicate just landed: drawn once as a flash (section 4). */
  flash?: { id: string; seq: number } | null;
  /** The editor's own motion is off (the device asks for less, or the preference is on). */
  motionOff?: boolean;
  /** Bumped by the theme panel's Preview motion button. */
  motionPreview?: { seq: number } | null;
  /** Told when a Preview motion run starts and when it ends, so the shell can say so. */
  onMotionPreview?: (phase: 'start' | 'end', level: 'subtle' | 'cinematic') => void;
}

/** How long a flash overlay may stay if its animation never reports an end. */
const FLASH_MAX_MS = 900;

interface Editing {
  id: string;
  path: string;
  done: boolean;
  finish: (keep: boolean) => void;
}

const FOCUSABLE_IN_PAGE = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';
const NODE_CLASS = /^jvb-n-([A-Za-z][A-Za-z0-9_-]{0,63})$/;

/** The id of the deepest builder node on an event's path through the shadow root. */
function nodeIdFromEvent(event: Event): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    for (const c of Array.from(target.classList)) {
      const m = NODE_CLASS.exec(c);
      if (m) return m[1];
    }
    if (target.id === 'jvb-root') return null;
  }
  return null;
}

function contains(r: DOMRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** A section that has a reveal on the published page, and the class it carries once revealed (render.mjs, publicBuilderScript.mjs). */
export const REVEAL_SELECTOR = '[data-jvb-reveal]';
export const REVEALED_CLASS = 'jvb-in';

/**
 * "Reduce motion in the editor", and the device's own setting, inside the canvas. The light-DOM rule
 * in index.css (`.jv-builder[data-reduce-motion] *`) cannot cross the shadow boundary, so the page's
 * own button and link transitions and its keyframes would still play here. The host carries
 * `data-jvbe-motion-off` whenever the editor's motion is off, and this rule, written last into the
 * shadow root, turns every transition and animation of the drawn page off while it does. It is
 * editor CSS: the published page never carries it.
 */
export const CANVAS_MOTION_OFF_CSS = ':host([data-jvbe-motion-off]) #jvb-root,:host([data-jvbe-motion-off]) #jvb-root *,:host([data-jvbe-motion-off]) #jvb-root *::before,:host([data-jvbe-motion-off]) #jvb-root *::after{animation:none!important;transition:none!important}';

/** Writes the rendered page into the shadow root, cleaned, with a hint where an empty widget drew nothing. */
export function writeShadow(root: ShadowRoot, html: string, css: string, doc: BuilderDoc, device: BuilderDevice): void {
  const style = document.createElement('style');
  style.textContent = `${EDITOR_CSS}\n${css}\n${CANVAS_MOTION_OFF_CSS}`;
  const template = document.createElement('template');
  template.innerHTML = stripScripts(html);
  const content = template.content;
  content.querySelectorAll('script').forEach(el => el.remove());
  content.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (isHandlerAttribute(attr.name)) el.removeAttribute(attr.name);
      else if (/^(href|src|action|formaction|xlink:href)$/i.test(attr.name) && isUnsafeUrl(attr.value)) el.removeAttribute(attr.name);
    }
    if (el.matches(FOCUSABLE_IN_PAGE)) el.setAttribute('tabindex', '-1');
  });
  // A reveal is drawn SETTLED, as the published page shows a section once it has scrolled in: the
  // section carries the class the frame script gives it then (`jvb-in`). The canvas never runs that
  // script, so the root never holds `jvb-motion-on` here and nothing hides; and because each
  // section is written already in, a redraw starts it at rest instead of playing its entrance.
  // Only Preview motion takes the class away, for one run.
  content.querySelectorAll(REVEAL_SELECTOR).forEach(el => el.classList.add(REVEALED_CLASS));
  root.replaceChildren(style, content);

  // An empty widget draws nothing on the published page. The editor shows a hint in its place, so it
  // can still be seen, selected and edited.
  walk(doc, node => {
    if (node.kind !== 'widget' || root.querySelector(`.jvb-n-${node.id}`)) return true;
    const found = findNode(doc, node.id);
    const column = found?.parent ? root.querySelector(`.jvb-n-${found.parent.id}`) : null;
    if (!column || !found?.parent) return true;
    const hint = document.createElement('div');
    hint.className = `jvb-n-${node.id} jvbe-empty`;
    hint.setAttribute('data-jvbe-empty-hint', '');
    if (resolveStyle(node, device).hidden === true) hint.setAttribute('data-jvbe-hidden', '');
    hint.textContent = EMPTY_HINTS[(node as BuilderWidget).type] ?? 'Empty block';
    const siblings = found.parent.children as BuilderNode[];
    let before: Element | null = null;
    for (let i = found.index + 1; i < siblings.length && !before; i++) before = column.querySelector(`:scope > .jvb-n-${siblings[i].id}`);
    column.insertBefore(hint, before);
    return true;
  });
}

/** Loads the page's Google Fonts into the cockpit document: a font declared inside a shadow root does not load. */
function useCanvasFonts(fonts: string[]): void {
  const key = fonts.join('|');
  useEffect(() => {
    const want = new Set(fonts);
    for (const link of Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[data-jvb-canvas-font]'))) {
      const family = link.getAttribute('data-jvb-canvas-font') || '';
      if (want.has(family)) want.delete(family);
      else link.remove();
    }
    for (const family of want) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-jvb-canvas-font', family);
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`;
      document.head.appendChild(link);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The links go with the canvas.
  useEffect(() => () => {
    document.head.querySelectorAll('link[data-jvb-canvas-font]').forEach(link => link.remove());
  }, []);
}

const ZoneView: React.FC<{ zone: DropZone; rect: Rect; over: boolean }> = ({ zone, rect, over }) => {
  // The drop target names its container and the gap in it; planDrop turns that into the model's index.
  const { setNodeRef } = useDroppable({ id: zone.id, data: { zone, parentId: zone.parentId, index: zone.before } });
  const box = zone.empty && zone.container === 'column';
  return (
    <div
      ref={setNodeRef}
      data-zone-id={zone.id}
      aria-hidden="true"
      className="jv-motion-appear"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: over ? 4 : 3
      }}
    >
      <div
        className="jv-motion-zone"
        style={box ? {
          width: '100%',
          height: '100%',
          border: `2px dashed ${over ? '#F472B6' : 'rgba(129, 140, 248, 0.85)'}`,
          borderRadius: '8px',
          backgroundColor: over ? 'rgba(236, 72, 153, 0.16)' : 'rgba(99, 102, 241, 0.10)'
        } : {
          width: rect.width >= rect.height ? '100%' : over ? '6px' : '4px',
          height: rect.width >= rect.height ? (over ? '6px' : '4px') : '100%',
          borderRadius: '9999px',
          backgroundColor: over ? '#F472B6' : 'rgba(129, 140, 248, 0.85)',
          boxShadow: over ? '0 0 0 3px rgba(236, 72, 153, 0.3)' : 'none'
        }}
      />
    </div>
  );
};

const DragHandle: React.FC<{ id: string; label: string }> = ({ id, label }) => {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `canvas:${id}`, data: { drag: { kind: 'node', id }, label } });
  // The pointer drags with dnd-kit; Space is the shell's keyboard placing (data-place-node).
  const { onKeyDown: _dndKey, ...pointer } = (listeners ?? {}) as Record<string, unknown>;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...(pointer as React.DOMAttributes<HTMLButtonElement>)}
      data-place-node={id}
      data-place-label={label}
      aria-label={`Drag ${label} to a new place`}
      title="Drag to move"
      style={toolButton}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );
};

const toolButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  border: 'none',
  borderRadius: '6px',
  backgroundColor: 'transparent',
  color: '#E0E7FF',
  cursor: 'pointer'
};

export const BuilderCanvas: React.FC<BuilderCanvasProps> = ({
  doc,
  device,
  selectedId,
  hoveredId,
  preview,
  zones,
  overZoneId,
  labelOf,
  onSelect,
  onHover,
  onToolbar,
  canPaste = false,
  onInlineCommit,
  inlineRequest,
  onEditingChange,
  scrollerRef,
  onScroll,
  measureTick = 0,
  flash = null,
  motionOff = false,
  motionPreview = null,
  onMotionPreview
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const editing = useRef<Editing | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const hoverRef = useRef<string | null>(null);
  const [rects, setRects] = useState<Map<string, Rect>>(() => new Map());
  const [pageRect, setPageRect] = useState<Rect | null>(null);
  const [writeTick, setWriteTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The room the frame gives the page, and the page's own height, both in CSS pixels. The page is
  // drawn at its design width inside a transformed layer; the editor's marks live outside that layer
  // in a box the size of the SCALED page, and are placed from getBoundingClientRect, which already
  // reports the scaled boxes, so no scale ever has to be divided out.
  const [room, setRoom] = useState(0);
  const [layerHeight, setLayerHeight] = useState(0);
  const designWidth = DESIGN_WIDTHS[device];
  const scale = canvasScale(device, room);
  const frameWidth = Math.round(designWidth * scale * 100) / 100;
  // The selection toolbar keeps inside the frame: a block near the right edge would push its buttons
  // out of the window, where a keyboard-less or touch user could not reach them.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  // The toolbar is keyed by the selected id, so Duplicate, Paste, Delete and Cut (which all move the
  // selection) replace it. The ref sees the old one leave while it still holds the focus, and puts
  // the focus on the same button of the new one (motion.ts toolbarFocusMemo / toolbarFocusTarget).
  const toolbarFocus = useRef<ToolbarFocusMemo | null>(null);
  const attachToolbar = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const target = toolbarFocusTarget(el, toolbarFocus.current, document.activeElement, document.body, Date.now());
      toolbarFocus.current = null;
      if (target instanceof HTMLElement) target.focus();
    } else {
      toolbarFocus.current = toolbarFocusMemo(toolbarRef.current, document.activeElement, Date.now());
    }
    toolbarRef.current = el;
  }, []);

  const result = useMemo(() => render(doc, { device }), [doc, device]);

  // A device switch fades the new drawing up. The layer is not keyed: it holds the shadow root, the
  // observers and the listeners below, so the animation is restarted on the same element instead.
  const lastDevice = useRef(device);
  useEffect(() => {
    if (lastDevice.current === device) return;
    lastDevice.current = device;
    const layer = layerRef.current;
    if (!layer || motionOff) return;
    // Off again once the fade has played (or after DEVICE_IN_MAX_MS when none ran), so it never replays
    // when its rule starts matching again with no device change. Armed before the restart, on purpose.
    removeClassWhenPlayed(layer, 'jv-motion-device-in', 'jvbe-device-in', DEVICE_IN_MAX_MS);
    layer.classList.remove('jv-motion-device-in');
    void layer.offsetWidth;
    layer.classList.add('jv-motion-device-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  // The flash: one overlay per new flash seq, gone when its animation ends and in any case after
  // FLASH_MAX_MS. A flash that was already there when the canvas mounted is not replayed.
  const lastFlash = useRef(flash ? flash.seq : 0);
  const [flashLive, setFlashLive] = useState<{ id: string; seq: number } | null>(null);
  useEffect(() => {
    if (!flash || flash.seq === lastFlash.current) return;
    lastFlash.current = flash.seq;
    if (motionOff) return;
    setFlashLive(flash);
    const timer = window.setTimeout(() => setFlashLive(cur => (cur && cur.seq === flash.seq ? null : cur)), FLASH_MAX_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.seq]);

  // Preview motion: play every section's reveal once on the canvas, then take the hidden state away,
  // so nothing is ever left hidden here. The run is a visual one, so it is also said: the shell
  // announces its start and its end in the builder's polite live region.
  const onMotionPreviewRef = useRef(onMotionPreview);
  onMotionPreviewRef.current = onMotionPreview;
  const lastPreview = useRef(motionPreview ? motionPreview.seq : 0);
  useEffect(() => {
    if (!motionPreview || motionPreview.seq === lastPreview.current) return;
    lastPreview.current = motionPreview.seq;
    if (motionOff) return;
    const level = docRef.current.theme.motion;
    const preset = level === 'subtle' || level === 'cinematic' ? MOTION_PRESETS[level] : null;
    const root = hostRef.current?.shadowRoot?.querySelector<HTMLElement>('#jvb-root');
    if (!preset || !root) return;
    const playing: 'subtle' | 'cinematic' = level === 'cinematic' ? 'cinematic' : 'subtle';
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-jvb-reveal]'));
    sections.forEach(el => el.classList.remove('jvb-in'));
    root.classList.add('jvb-motion-on');
    void root.offsetWidth;
    sections.forEach(el => el.classList.add('jvb-in'));
    onMotionPreviewRef.current?.('start', playing);
    const timer = window.setTimeout(() => {
      root.classList.remove('jvb-motion-on');
      onMotionPreviewRef.current?.('end', playing);
    }, preset.durationMs + 100);
    return () => {
      window.clearTimeout(timer);
      root.classList.remove('jvb-motion-on');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionPreview?.seq]);
  useCanvasFonts(result.fonts);

  const measure = useCallback(() => {
    const root = hostRef.current?.shadowRoot;
    const frame = frameRef.current;
    if (!root || !frame) return;
    const base = frame.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height });
    const next = new Map<string, Rect>();
    walk(docRef.current, node => {
      const el = root.querySelector(`.jvb-n-${node.id}`);
      if (el) next.set(node.id, rel(el.getBoundingClientRect()));
    });
    const page = root.querySelector('#jvb-root');
    setRects(next);
    setPageRect(page ? rel(page.getBoundingClientRect()) : null);
  }, []);

  // Draw the page. Never while an inline edit is open: that would pull the text out from under it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || editing.current) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const scroller = scrollerRef.current;
    const keep = scroller ? { top: scroller.scrollTop, left: scroller.scrollLeft } : null;
    writeShadow(root, result.problems.length ? '' : result.html, result.css, doc, device);
    if (scroller && keep) {
      scroller.scrollTop = keep.top;
      scroller.scrollLeft = keep.left;
    }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, writeTick]);

  // Boxes move when images load, fonts arrive or the window changes size.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
    observer?.observe(host);
    if (frameRef.current) observer?.observe(frameRef.current);
    window.addEventListener('resize', measure);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => measure()).catch(() => {});
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    measure();
  }, [device, scale, layerHeight, zones, selectedId, measureTick, measure]);

  // The room the frame gives the page, and the page's own height (it sets the height of the box the
  // scaled page takes up, because a transform does not change layout).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const layer = layerRef.current;
    const read = () => {
      if (scroller) setRoom(Math.max(0, scroller.clientWidth - FRAME_PAD * 2));
      if (layer) setLayerHeight(layer.offsetHeight);
    };
    read();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver(read);
    if (scroller) observer.observe(scroller);
    if (layer) observer.observe(layer);
    return () => observer.disconnect();
  }, [scrollerRef]);

  // The page's own forms and links do nothing in the editor.
  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    if (!root) return;
    const stop = (e: Event) => {
      if (editing.current) return;
      if (e.type === 'submit') {
        e.preventDefault();
        return;
      }
      if (e.composedPath().some(t => t instanceof Element && t.matches('a, button, summary, label, input'))) e.preventDefault();
    };
    root.addEventListener('submit', stop, true);
    root.addEventListener('click', stop, true);
    return () => {
      root.removeEventListener('submit', stop, true);
      root.removeEventListener('click', stop, true);
    };
  }, []);

  const startEdit = useCallback((id: string, point?: { x: number; y: number }): boolean => {
    const root = hostRef.current?.shadowRoot;
    if (!root || editing.current) return false;
    const found = findNode(docRef.current, id);
    if (!found || found.node.kind !== 'widget') return false;
    const widget = found.node as BuilderWidget;
    const targets: InlineTarget[] = INLINE_TARGETS[widget.type] ?? [];
    const widgetEl = root.querySelector<HTMLElement>(`.jvb-n-${id}`);
    if (!targets.length || !widgetEl) return false;

    let chosen: { target: InlineTarget; el: HTMLElement; propIndex: number } | null = null;
    if (widgetEl.hasAttribute('data-jvbe-empty-hint')) {
      // An empty widget: write its first single prop in place of the hint. A list has no item to edit yet.
      const first = targets.find(t => !t.list);
      if (first) chosen = { target: first, el: widgetEl, propIndex: 0 };
    } else {
      const candidates: Array<{ target: InlineTarget; el: HTMLElement; propIndex: number }> = [];
      for (const target of targets) {
        if (target.list) {
          const items = Array.from(widgetEl.querySelectorAll<HTMLElement>(target.list.itemSelector));
          items.forEach((itemEl, drawn) => {
            const el = itemEl.querySelector<HTMLElement>(target.selector);
            const propIndex = itemPropIndex((widget.props as Record<string, unknown>)[target.list!.prop], target.list!.keepField, drawn);
            if (el && propIndex >= 0) candidates.push({ target, el, propIndex });
          });
        } else {
          const el = target.selector === ':scope' ? widgetEl : widgetEl.querySelector<HTMLElement>(target.selector);
          if (el) candidates.push({ target, el, propIndex: 0 });
        }
      }
      chosen = (point && candidates.find(c => contains(c.el.getBoundingClientRect(), point.x, point.y))) || candidates[0] || null;
    }
    if (!chosen) return false;

    const { target, propIndex } = chosen;
    let el = chosen.el;
    // A page <button> or link cannot be edited as text: Chrome reads Space there as a press. While it
    // is edited a <span> with the same classes stands in for it; the redraw after the edit puts the
    // real element back.
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      const stand = document.createElement('span');
      stand.className = el.className;
      const inline = el.getAttribute('style');
      if (inline) stand.setAttribute('style', inline);
      stand.style.display = getComputedStyle(el).display === 'inline' ? 'inline-block' : getComputedStyle(el).display;
      el.replaceWith(stand);
      el = stand;
    }
    const multiline = inlineMultiline(widget.type, target.path);
    const own = inlineValue(widget, target, propIndex);
    // A prop left empty may show the page's own fallback words ("Continue"). Editing starts from
    // what is on screen, and nothing is written unless the merchant changes it.
    const start = own !== '' ? own : el.hasAttribute('data-jvbe-empty-hint') ? '' : (el.textContent || '');
    el.textContent = start;
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    el.setAttribute('data-jvbe-editing', '');
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', inlineLabel(widget.type, target.path));
    if (multiline) el.setAttribute('aria-multiline', 'true');
    el.tabIndex = 0;

    const state: Editing = { id, path: target.path, done: false, finish: () => {} };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return; // Tab moves on, and blur keeps the text
      e.stopPropagation();
      if (e.key === 'Escape') {
        // Design section 7: Escape leaves editing and KEEPS what was typed. Undo takes it back.
        e.preventDefault();
        state.finish(true);
      } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        state.finish(true);
      }
    };
    const onBlur = () => state.finish(true);
    state.finish = (keep: boolean) => {
      if (state.done) return;
      state.done = true;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      const value = cleanInlineText(el.innerText ?? el.textContent ?? '', multiline);
      editing.current = null;
      setEditingId(null);
      onEditingChange(false);
      if (keep && value !== start) {
        const latest = findNode(docRef.current, id)?.node as BuilderWidget | undefined;
        const patch = latest ? inlinePatch(latest, target, propIndex, value) : null;
        if (patch) onInlineCommit(id, patch, `props.${target.list ? target.list.prop : target.path}`);
      }
      // Draw from the document again: a kept edit is in it now, a cancelled one never was.
      setWriteTick(t => t + 1);
      hostRef.current?.focus({ preventScroll: true });
    };
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    editing.current = state;
    setEditingId(id);
    onEditingChange(true);
    el.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }, [onEditingChange, onInlineCommit]);

  // Enter on a selected widget, from the shell.
  useEffect(() => {
    if (inlineRequest && !preview) startEdit(inlineRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineRequest?.seq]);

  // Leaving preview or switching device ends an edit and keeps its text.
  useEffect(() => {
    editing.current?.finish(true);
  }, [preview, device]);

  const selectedRect = selectedId ? rects.get(selectedId) : undefined;
  useLayoutEffect(() => {
    const w = toolbarRef.current ? toolbarRef.current.offsetWidth : 0;
    if (w !== toolbarWidth) setToolbarWidth(w);
  });
  const hoveredRect = hoveredId && hoveredId !== selectedId ? rects.get(hoveredId) : undefined;
  const selectedNode = selectedId ? findNode(doc, selectedId)?.node : undefined;
  const selectedLabel = selectedId ? labelOf(selectedId) : '';
  const across = selectedNode?.kind === 'column';
  const showMarks = !preview;

  const zoneBoxes = useMemo(() => {
    if (!zones || !pageRect) return [];
    const rectOf = (id: string) => rects.get(id) ?? null;
    return zones.map(zone => ({ zone, rect: zoneGeometry(doc, zone, rectOf, pageRect) })).filter((z): z is { zone: DropZone; rect: Rect } => !!z.rect);
  }, [zones, rects, pageRect, doc]);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {result.problems.length > 0 && (
        <div role="alert" style={{ margin: '12px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#FECACA', fontSize: '13px' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>This page has problems the builder cannot draw.</p>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {result.problems.slice(0, 5).map((p, i) => <li key={i}>{p.message}</li>)}
          </ul>
        </div>
      )}
      <div
        ref={el => { scrollerRef.current = el; }}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: '#1F2937', padding: '24px' }}
      >
        <div
          ref={frameRef}
          data-canvas-frame=""
          data-canvas-scale={scale}
          style={{
            position: 'relative',
            width: `${frameWidth}px`,
            height: layerHeight > 0 ? `${Math.round(layerHeight * scale * 100) / 100}px` : undefined,
            minHeight: `${Math.round(480 * scale)}px`,
            margin: '0 auto',
            flex: 'none'
          }}
        >
        <div
          ref={layerRef}
          data-canvas-layer=""
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${designWidth}px`,
            transformOrigin: '0 0',
            transform: scale < 1 ? `scale(${scale})` : undefined,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
            backgroundColor: doc.theme?.colors?.background || '#09080E'
          }}
        >
          <div
            ref={hostRef}
            role="region"
            aria-label="Page canvas"
            aria-describedby="jvb-canvas-help"
            tabIndex={0}
            data-jvb-canvas-host=""
            data-jvbe-motion-off={motionOff ? '' : undefined}
            onClick={e => {
              if (editing.current) return;
              onSelect(nodeIdFromEvent(e.nativeEvent));
            }}
            onDoubleClick={e => {
              if (preview) return;
              const id = nodeIdFromEvent(e.nativeEvent);
              if (!id) return;
              onSelect(id);
              startEdit(id, { x: e.clientX, y: e.clientY });
            }}
            onMouseMove={e => {
              if (editing.current) return;
              const id = nodeIdFromEvent(e.nativeEvent);
              if (id !== hoverRef.current) {
                hoverRef.current = id;
                onHover(id);
              }
            }}
            onMouseLeave={() => {
              hoverRef.current = null;
              onHover(null);
            }}
            style={{ display: 'block', minHeight: '480px', outlineOffset: '-3px' }}
          />
          <span id="jvb-canvas-help" hidden>
            Click a block to select it. With a block selected, press Enter to write its text in place. Enter or Escape keeps what you wrote, and Control or Command Z takes it back.
          </span>
        </div>

          {showMarks && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {hoveredRect && !zones && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: hoveredRect.left,
                    top: hoveredRect.top,
                    width: hoveredRect.width,
                    height: hoveredRect.height,
                    outline: '1px dashed rgba(129, 140, 248, 0.9)',
                    outlineOffset: '-1px'
                  }}
                />
              )}
              {selectedRect && selectedId && (
                <>
                  <div
                    key={`outline:${selectedId}`}
                    aria-hidden="true"
                    data-selection-outline={selectedId}
                    className="jv-motion-appear"
                    style={{
                      position: 'absolute',
                      left: selectedRect.left,
                      top: selectedRect.top,
                      width: selectedRect.width,
                      height: selectedRect.height,
                      outline: editingId === selectedId ? 'none' : '2px solid #818CF8',
                      outlineOffset: '-2px'
                    }}
                  />
                  {/* While a drag is on the toolbar is hidden, not removed: the grip IS the drag's source,
                      and a source that leaves the page takes the dragged block's identity with it (the
                      drop then finds no block to move). */}
                  <div
                      key={`toolbar:${selectedId}`}
                      ref={attachToolbar}
                      className="jv-motion-appear"
                      role="toolbar"
                      aria-label={`${selectedLabel} actions`}
                      style={{
                        position: 'absolute',
                        left: Math.max(0, Math.min(selectedRect.left, frameWidth - toolbarWidth)),
                        // Above the block; with no room above, below a short block (so it never covers the text a
                        // double-click is meant to reach), else inside the top of a tall one.
                        top: selectedRect.top >= 36 ? selectedRect.top - 34 : selectedRect.height < 80 ? selectedRect.top + selectedRect.height + 4 : selectedRect.top + 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        padding: '2px 4px',
                        borderRadius: '8px',
                        backgroundColor: '#312E81',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                        pointerEvents: zones ? 'none' : 'auto',
                        visibility: zones ? 'hidden' : 'visible',
                        zIndex: 5,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {/* The toolbar's own name carries the block's label; on a narrow frame the visible label
                          gives its room to the buttons, so the one row still fits inside the frame. */}
                      {frameWidth >= TOOLBAR_LABEL_MIN_FRAME && (
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#E0E7FF', padding: '0 6px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {selectedLabel}
                        </span>
                      )}
                      <DragHandle id={selectedId} label={selectedLabel} />
                      <button type="button" aria-label={across ? 'Move left' : 'Move up'} title={across ? 'Move left' : 'Move up'} onClick={() => onToolbar('up', selectedId)} style={toolButton}>
                        {across ? <ArrowLeft size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
                      </button>
                      <button type="button" aria-label={across ? 'Move right' : 'Move down'} title={across ? 'Move right' : 'Move down'} onClick={() => onToolbar('down', selectedId)} style={toolButton}>
                        {across ? <ArrowRight size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                      </button>
                      <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => onToolbar('duplicate', selectedId)} style={toolButton}>
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Delete" title="Delete" onClick={() => onToolbar('remove', selectedId)} style={{ ...toolButton, color: '#FECACA' }}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Copy" title="Copy (Command or Control C)" onClick={() => onToolbar('copy', selectedId)} style={toolButton}>
                        <ClipboardCopy size={14} aria-hidden="true" />
                      </button>
                      <button type="button" aria-label="Cut" title="Cut (Command or Control X)" onClick={() => onToolbar('cut', selectedId)} style={toolButton}>
                        <Scissors size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Paste"
                        title={canPaste ? 'Paste (Command or Control V)' : 'Paste: copy or cut a block first'}
                        aria-disabled={!canPaste}
                        onClick={() => onToolbar('paste', selectedId)}
                        style={{ ...toolButton, opacity: canPaste ? 1 : 0.45 }}
                      >
                        <ClipboardPaste size={14} aria-hidden="true" />
                      </button>
                      {selectedNode?.kind === 'section' && (
                        <button type="button" aria-label="Save section" title="Save section to your library" onClick={() => onToolbar('save', selectedId)} style={toolButton}>
                          <BookmarkPlus size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                </>
              )}
              {flashLive && !motionOff && rects.get(flashLive.id) && (() => {
                const r = rects.get(flashLive.id)!;
                return (
                  <div
                    key={`flash:${flashLive.seq}`}
                    aria-hidden="true"
                    data-jvbe-flash={flashLive.id}
                    className="jv-motion-flash"
                    onAnimationEnd={() => setFlashLive(cur => (cur && cur.seq === flashLive.seq ? null : cur))}
                    style={{
                      position: 'absolute',
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      outline: '2px solid #F472B6',
                      outlineOffset: '-2px',
                      backgroundColor: 'rgba(244, 114, 182, 0.28)',
                      pointerEvents: 'none',
                      zIndex: 2
                    }}
                  />
                );
              })()}
              {zoneBoxes.map(({ zone, rect }) => (
                <ZoneView key={zone.id} zone={zone} rect={rect} over={zone.id === overZoneId} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
