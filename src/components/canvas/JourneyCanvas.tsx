import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  useStoreApi,
  type Connection,
  type FinalConnectionState,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type NodeChange,
  type EdgeChange,
  type OnNodeDrag,
  type ReactFlowInstance
} from '@xyflow/react';
import { Sparkles, EyeOff, Workflow, Undo2, X, SlidersHorizontal, ChevronDown } from 'lucide-react';
import type { JourneyNode, JourneyEdge, JourneyNodeData, CanvasViewMode, NodeType } from '../../types/journey';
import { AdNode } from './nodes/AdNode';
import { PageNode } from './nodes/PageNode';
import { FormNode } from './nodes/FormNode';
import { SequenceNode } from './nodes/SequenceNode';
import { ThankYouNode } from './nodes/ThankYouNode';
import { UpsellNode } from './nodes/UpsellNode';
import { AbSplitNode } from './nodes/AbSplitNode';
import { ConversionEdge } from './edges/ConversionEdge';
import { EdgeLegend } from './EdgeLegend';
import { EdgeLabelLayout, mapOverlayRects, useCaptionPortal } from './EdgeLabelLayout';
import { placeStepAddZoomed, geometryKey, intersectRects, rectToBox, type Box, type StepAddSpot } from '../../lib/edgeLabelLayout';
import { EDGE_KINDS, EDGE_KIND_ORDER, EDGE_WIDTH_SELECTED, edgeKind, isRetentionLink, isRetentionStep, type EdgeKind } from '../../lib/edgeKinds';
import { stepKind } from '../../lib/stepKinds';
import { parentMovedIds } from '../../lib/journeyHistory';
import { pathFocus, withPathFocus } from '../../lib/pathFocus';
import { tidyPositions, applyPositions, positionsOf, nodesAt, type Positions, type Size } from '../../lib/journeyLayout';
import {
  checkConnection,
  withConnection,
  createsLoop,
  findLoopEdges,
  replacePrompt,
  loopMessage,
  refusalNotice,
  connectionFromState
} from '../../lib/connectionRules';
import { ReplaceLineDialog } from './ReplaceLineDialog';
import { CanvasMetricsContext } from './CanvasMetrics';
import { DesignIssuesContext } from './DesignIssueBadge';
import { usePublishStatus } from './PublishStatus';
import { checkJourneyDesign } from '../../lib/designChecks';
import {
  buildCanvasMetrics,
  legendNote,
  normalizeRangeDays,
  rangeLabel,
  RANGE_DAYS,
  DEFAULT_RANGE_DAYS,
  type MetricsView,
  type RangeDays
} from '../../lib/journeyMetrics';
import { canvasKeyAction, panTarget, stepName, stepSpokenName, PAN_DURATION_MS } from '../../lib/stepNavigation';
import { describeEdge, stepShortName, stripA11yDecorations, JOURNEY_ARIA_LABELS, endSentence, nameInSentence } from '../../lib/stepNames';
import { applyMoves, commitsWaitingMove, createMoveQueue, type MoveQueue } from '../../lib/keyboardMoves';
import { deletedNotice, restoredNotice, focusFellWithDelete, isApplePlatform } from '../../lib/deleteNotice';
import {
  STEP_PORTS,
  checkPlan,
  choicesFor,
  defaultExit,
  dropOnLine,
  exitNote,
  exitOptions,
  makeLine,
  nearestLine,
  pickerAnchorLabel,
  pickerTitle,
  planAdd,
  sizeOf,
  type AddRequest,
  type CanvasView,
  type ChoiceRow,
  type XY
} from '../../lib/addStep';
import { newStamp } from '../../lib/stepDefaults';
import { StepPicker } from './StepPicker';
import { canvasFitOptions } from '../../lib/editorReturn';
import { MINIMAP_SIZE, overlayFitPadding, wholeMapFit } from '../../lib/fitRoom';
import { COARSE_POINTER_QUERY, handleTargetsTight, semanticZoomVars } from '../../lib/semanticZoom';
import { mapToolsCompact, noticePlace, revealShift, unionBox, visibleBand, NOTICE_DOCK_GAP, REVEAL_MAX_WAIT_MS, REVEAL_MIN_WAIT_MS, REVEAL_QUIET_MS } from '../../lib/tapReveal';

// Arrowheads keep one size whatever the line width, and take the line's colour.
const arrowFor = (kind: EdgeKind) => ({
  type: MarkerType.ArrowClosed,
  color: EDGE_KINDS[kind].color,
  width: 26,
  height: 26,
  markerUnits: 'userSpaceOnUse'
});

interface Props {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  onNodesChange: (nodes: JourneyNode[]) => void;
  onEdgesChange: (edges: JourneyEdge[]) => void;
  selectedNodeId: string | null;
  onSelectNode: (node: JourneyNode | null) => void;
  selectedEdgeId?: string | null;
  onSelectEdge?: (edge: JourneyEdge | null) => void;
  canvasViewMode?: CanvasViewMode;
  showRetentionBranches?: boolean;
  onToggleRetentionBranches?: (show: boolean) => void;
  /** The history's undo for a move still on top of the stack; false when a later edit is on top. */
  onUndoMove?: (positions: Positions) => boolean;
  /** The stats snapshot for this journey and range (#9). Held by App, never written into the journey. */
  metrics?: MetricsView;
  onChangeStatsDays?: (days: RangeDays) => void;
  /** Enter or Space on a focused step: open it in the docked panel and move focus there (#7). */
  onOpenStep?: (nodeId: string) => void;
  /** Enter or Space on a line's rate pill: open the line in the docked panel and move focus there. */
  onOpenEdge?: (edgeId: string) => void;
  /** Bumped by App when a step is chosen again, so the map pans back to it even if it was already selected. */
  focusRequest?: number;
  /** A card's "! N" badge: open Check design at that step's rows (#10). Keep it stable (useCallback). */
  onOpenIssues?: (nodeId: string) => void;
  /**
   * A step added or inserted from the map (#12): the whole node and edge list after it, as ONE
   * change, so it is one undo step. Falls back to onNodesChange then onEdgesChange.
   */
  onGraphChange?: (nodes: JourneyNode[], edges: JourneyEdge[]) => void;
  /** Filled by the canvas: the centre of the visible map and each drawn card's size, for the header's Add Step. */
  canvasViewRef?: React.MutableRefObject<CanvasView | null>;
  pickerRequest?: AddRequest | null;
  onClearPickerRequest?: () => void;
}

// A line dragged out of a dot and let go on empty map opens the step picker; a request that came
// from a dot keeps that dot's exit, so the picker hides Connect from.
type PickerState = { request: AddRequest; lockedExit: boolean; note?: string };

// The + Before / + Next / + Step pills: dark, 11px, an indigo edge.
const addPill: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '9999px',
  background: '#0B0F19',
  border: '1px solid #818CF8',
  color: '#E0E7FF',
  fontSize: '11px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
  // The slot around the pills takes no clicks (see StepAddSlot); the pills themselves do.
  pointerEvents: 'auto'
};

// + Before and + Next for the selected step (#12). They sit inside that step's own card wrapper,
// right after its content, not in React Flow's NodeToolbar, which portals after every step: there
// Tab and a screen reader reached them only after the last step on the map (C34).
const StepAddContext = createContext<{ stepId: string | null; buttons: React.ReactNode }>({ stepId: null, buttons: null });

// Above the card's top-right corner, counter-scaled so the pills keep their 11px text and 8px gap
// at any zoom, as the toolbar drew them. nokey keeps React Flow from reading Enter as selecting the
// step, an arrow as moving it, or Backspace as deleting it, while a pill has focus. The slot itself
// takes no pointer events: it sits in the selected step's layer, so its 8px gap and the space between
// the pills would otherwise swallow clicks on a line's label beneath it when zoomed out.
// A caption that left its line often sits above the card's corner too, and on a branch the card
// above and its bottom handles can be close, so the row moves to the first spot around its own card,
// above it first, that covers none of them and sits nearer that card than any other (placeStepAdd,
// R22). Measured in screen px. What floats over the map (the tools, the legend, the zoom controls,
// the minimap) and the map's own edges take the pointer or cut the row off, so no spot may touch
// them either: a card scrolled up under the tools gets its row below it (T07). They stay put while
// the map moves under them, so the row is placed again after every pan too. On a phone the map
// scrolls with the step panel under it, so its edges are where it is cut off on screen: by any
// scroller around it and by the window, and the row is placed again on a scroll.
const STEP_ADD_GAP = 8;

const StepAddSlot: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const { stepId, buttons } = useContext(StepAddContext);
  const shown = stepId === nodeId;
  const store = useStoreApi();
  const zoom = useStore(s => (shown ? s.transform[2] : 1));
  // Where every step and handle is, so a drag or a card that changes size measures again.
  const layout = useStore(s => (shown ? geometryKey(s.nodeLookup.values()) : ''));
  const portal = useCaptionPortal();
  const slotRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef({ x: 0, y: 0, hidden: false });
  const [spot, setSpot] = useState<{ x: number; y: number; hidden: boolean; side: StepAddSpot['side'] }>({ x: 0, y: 0, hidden: false, side: 'above' });
  // A row placed hidden still shows while a pill in it holds keyboard focus (U10).
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const own = slot?.closest<HTMLElement>('.react-flow__node');
    const flow = own?.closest<HTMLElement>('.react-flow');
    if (!shown || !slot || !own || !flow) return;
    let frame = 0;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const measure = () => {
      frame = 0;
      // The row with no move: its bottom STEP_ADD_GAP above the card, its right edge on the card's.
      // Its layout size, which the counter-scale makes its size on screen and which a hidden row
      // (scale 0, U10) keeps: measured on screen, a hidden row read as 0 wide and was placed again.
      const row = { width: slot.offsetWidth, height: slot.offsetHeight - STEP_ADD_GAP };
      const card = box(own);
      const captions: Box[] = [];
      portal?.querySelectorAll('[data-jv-edge-label], [data-jv-edge-label] .jv-add-next').forEach(el => captions.push(box(el)));
      // A design-check badge sits on its card's corner, where the row rests, so it is kept clear at
      // every zoom (U10). Zoomed out, captions and badges keep 11px on screen (T02), so the row may
      // move further to find a clear spot (placeStepAddZoomed).
      const badges: Box[] = [];
      flow.querySelectorAll('[data-jv-design-badge]').forEach(el => badges.push(box(el)));
      const cards: Box[] = [];
      flow.querySelectorAll('.react-flow__node').forEach(el => { if (el !== own) cards.push(box(el)); });
      const handles: Box[] = [];
      flow.querySelectorAll('.react-flow__handle').forEach(el => handles.push(box(el)));
      const root = flow.closest('#journey-map') ?? flow.parentElement;
      const clips = [{ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }];
      for (let a = flow.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflowX !== 'visible' || o.overflowY !== 'visible') clips.push(a.getBoundingClientRect());
      }
      const onScreen = intersectRects(flow.getBoundingClientRect(), ...clips);
      const overlays = root ? mapOverlayRects(root, onScreen).map(rectToBox) : [];
      const at = placeStepAddZoomed(card, row, { captions, cards, handles, badges, overlays }, zoom < 1, STEP_ADD_GAP);
      const next = {
        x: Math.round(at.x - (card.x + card.width - row.width)),
        y: Math.round(at.y - (card.y - STEP_ADD_GAP - row.height)),
        // Nowhere it covers nothing (U10): not drawn, like a hidden caption or badge, but kept in
        // the tab order and shown while a pill in it holds focus.
        hidden: at.fit === 'hidden'
      };
      if (next.x !== moveRef.current.x || next.y !== moveRef.current.y || next.hidden !== moveRef.current.hidden) {
        moveRef.current = next;
        setSpot({ ...next, side: at.side });
      }
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    // Captions are placed in their provider's layout effect, after this one, so look again next frame,
    // and whenever a caption moves, appears or changes size.
    schedule();
    const moves = portal && typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    moves?.observe(portal as Element, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    const sizes = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    sizes?.observe(slot);
    // The map resized, or the tools and legend did (a legend opened, a tidy note shown).
    sizes?.observe(flow);
    const tools = flow.closest('#journey-map')?.querySelector('[data-map-overlay]');
    if (tools) sizes?.observe(tools);
    // A pan moves the card, and the row with it, under the overlays, which do not move.
    const panned = store.subscribe((s, prev) => {
      if (s.transform !== prev.transform) schedule();
    });
    // A scroll of the page around the map moves where the map is cut off.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      moves?.disconnect();
      sizes?.disconnect();
      panned();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [shown, zoom, layout, portal, store]);

  if (!shown) return null;
  return (
    <div
      ref={slotRef}
      data-step-add={nodeId}
      data-step-add-side={spot.side}
      data-step-add-hidden={spot.hidden ? '' : undefined}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      className="nodrag nopan nokey"
      style={{
        position: 'absolute',
        right: 0,
        bottom: '100%',
        paddingBottom: `${STEP_ADD_GAP}px`,
        display: 'flex',
        gap: '6px',
        width: 'max-content',
        pointerEvents: 'none',
        // Hidden as a hidden caption is (index.css): no room, no pointer, still in the tab order.
        opacity: spot.hidden && !focused ? 0 : undefined,
        scale: spot.hidden && !focused ? '0' : undefined,
        transform: `scale(${1 / zoom})`,
        transformOrigin: '100% 100%',
        // The translate property applies outside the counter-scale, in map units, so divide by the zoom.
        translate: spot.x || spot.y ? `${spot.x / zoom}px ${spot.y / zoom}px` : undefined
      }}
    >
      {buttons}
    </div>
  );
};

function withStepAdd<P extends { id: string }>(Card: React.ComponentType<P>): React.FC<P> {
  const WithStepAdd: React.FC<P> = props => (
    <>
      <Card {...props} />
      <StepAddSlot nodeId={props.id} />
    </>
  );
  WithStepAdd.displayName = `WithStepAdd(${Card.displayName || Card.name || 'Step'})`;
  return WithStepAdd;
}

const NOTICE_BORDER = { refused: '#F87171', loop: '#FBBF24', added: '#818CF8', hint: '#E2E8F0', deleted: '#CBD5E1', connecting: '#E2E8F0' } as const;
type NoticeTone = keyof typeof NOTICE_BORDER;

// Fit with no animation when the person asked the system for less motion.
const reduceMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// The Tidy layout button and its notice, in the same dark glass as the retention toggle. No
// outline here: the browser's focus ring must stay.
const toolPill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  borderRadius: '8px',
  background: 'rgba(15, 23, 42, 0.88)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  color: '#E2E8F0',
  fontSize: '11px',
  fontWeight: 700,
  backdropFilter: 'blur(12px)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
  pointerEvents: 'auto'
};
const noteButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 6px',
  borderRadius: '6px',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  color: '#E2E8F0',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer'
};

/** The nearest box that scrolls the map up and down: the page's own scroller in the stacked layout. */
function scrollBoxOf(el: Element): Element | null {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const o = getComputedStyle(a).overflowY;
    if (o === 'auto' || o === 'scroll') return a;
  }
  return null;
}

/**
 * A tapped step stays on screen in the stacked phone layout (T06, src/lib/tapReveal.ts). The tap
 * scrolls the step panel into view under the map (R02), which can push the card up out of sight;
 * once that scroll settles the map pans, with no zoom change, so the card sits centred in the strip
 * of map still showing. Only a pointer tap asks (`tap`), and only where something scrolls the map,
 * so the side-by-side layout from 768px up is never moved, and a first fit or a return from Email
 * Studio (#21) never asks. FocusSelectedStep runs it, so it stays the one pan that follows the
 * selection.
 */
function useKeepTappedStepOnScreen(nodeId: string | null, tap: number) {
  const store = useStoreApi();
  const { setViewport } = useReactFlow();

  React.useEffect(() => {
    const flow = store.getState().domNode;
    if (!tap || !nodeId || !flow) return;
    const scroller = scrollBoxOf(flow);
    if (!scroller) return;
    const started = performance.now();
    let timer = 0;
    const pan = () => {
      timer = 0;
      const { nodeLookup, transform, connection } = store.getState();
      if (nodeLookup.get(nodeId)?.dragging || connection.inProgress) return;
      const selector = `.react-flow__node[data-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId}"]`;
      const card = flow.querySelector(selector);
      if (!card) return;
      const target = unionBox([card, ...card.querySelectorAll('.jv-add-next')].map(el => el.getBoundingClientRect()));
      const map = flow.getBoundingClientRect();
      const band = visibleBand(map, scroller.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
      const root = flow.closest('#journey-map') ?? flow.parentElement;
      const obstacles = root && band
        ? mapOverlayRects(root, { left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top })
          .map(r => ({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height }))
        : [];
      const shift = target ? revealShift(target, band, obstacles) : null;
      if (!shift) return;
      void setViewport(
        { x: transform[0] + shift.dx, y: transform[1] + shift.dy, zoom: transform[2] },
        { duration: reduceMotion() ? 0 : PAN_DURATION_MS }
      );
    };
    // Wait for the panel's scroll to start and then go quiet, but never longer than the cap.
    const wait = () => {
      if (timer) clearTimeout(timer);
      const elapsed = performance.now() - started;
      if (elapsed >= REVEAL_MAX_WAIT_MS) return pan();
      timer = window.setTimeout(pan, Math.min(Math.max(REVEAL_QUIET_MS, REVEAL_MIN_WAIT_MS - elapsed), REVEAL_MAX_WAIT_MS - elapsed));
    };
    scroller.addEventListener('scroll', wait, { passive: true });
    wait();
    return () => {
      scroller.removeEventListener('scroll', wait);
      if (timer) clearTimeout(timer);
    };
    // Runs per tap; nodeId is read with it. setViewport and store are stable for the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap]);
}

/**
 * Pans the selected step fully into view (#7), the one pan every "jump to a step" relies on: the
 * finder, Previous/Next, a connection row, the audit drawer and a new step all just select it.
 * The map moves only when the step is not already fully visible, and never zooms out below
 * MIN_FOCUS_ZOOM. Waiting for `ready` covers a hidden retention step that is revealed and then
 * measured; `request` re-pans when the selected step is chosen again after the map moved away,
 * and `tap` keeps a tapped step on screen in the phone layout (T06, useKeepTappedStepOnScreen).
 * Must render inside <ReactFlow>, which provides the store.
 */
function FocusSelectedStep({ nodeId, request, tap = 0 }: { nodeId: string | null; request: number; tap?: number }) {
  const store = useStoreApi();
  const { setCenter } = useReactFlow();
  useKeepTappedStepOnScreen(nodeId, tap);
  const ready = useStore(s => Boolean(nodeId && (s.nodeLookup.get(nodeId)?.measured?.width ?? 0) > 0));
  const seen = React.useRef({ nodeId, ready, request, tap });

  React.useEffect(() => {
    const prev = seen.current;
    seen.current = { nodeId, ready, request, tap };
    if (!nodeId || !ready) return;
    if (tap !== prev.tap) {
      // A tap in the phone layout is shown by useKeepTappedStepOnScreen, with no zoom change: this
      // pan zooming in to MIN_FOCUS_ZOOM made a card near the edge taller than the strip of map
      // left above the panel (T06). A tap on the step already open asks nothing here, as before.
      const flow = store.getState().domNode;
      if (flow && scrollBoxOf(flow)) return;
      if (prev.nodeId === nodeId && prev.ready === ready && prev.request === request) return;
    }
    const { nodeLookup, transform, width, height } = store.getState();
    const n = nodeLookup.get(nodeId);
    if (!n || n.dragging) return;
    const t = panTarget(
      {
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        width: n.measured.width ?? 0,
        height: n.measured.height ?? 0
      },
      { x: transform[0], y: transform[1], zoom: transform[2] },
      { width, height }
    );
    if (t) void setCenter(t.x, t.y, { zoom: t.zoom, duration: reduceMotion() ? 0 : PAN_DURATION_MS });
    // setCenter and store are stable for the life of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ready, request, tap]);

  return null;
}

/**
 * Semantic zoom (F3, src/lib/semanticZoom.ts). Writes the zoom's detail level and sizes onto the
 * .react-flow element as data-jv-detail, --jv-title-scale (and the compact name's
 * --jv-compact-title-scale, U02), --jv-handle-hit, --jv-zoom and
 * --jv-caption-scale, which index.css reads to swap each card's detail rows for its summary, to size
 * the handles' hit areas and to keep line captions and design-check badges 11px on screen (T02). It
 * subscribes to the store rather than calling useStore, and writes at most once per animation frame,
 * so a zoom frame re-renders no card (and not even this component). Must render inside <ReactFlow>,
 * which provides the store.
 */
function SemanticZoom() {
  const store = useStoreApi();

  React.useEffect(() => {
    let frame = 0;
    let written = '';
    const write = () => {
      frame = 0;
      const { transform, domNode } = store.getState();
      if (!domNode) return;
      const v = semanticZoomVars(transform[2]);
      const key = `${v.detail} ${v.titleScale} ${v.compactTitleScale} ${v.handleHitPx} ${v.zoom} ${v.captionScale}`;
      if (key === written && domNode.dataset.jvDetail === v.detail) return;
      written = key;
      domNode.dataset.jvDetail = v.detail;
      domNode.style.setProperty('--jv-title-scale', String(v.titleScale));
      domNode.style.setProperty('--jv-compact-title-scale', String(v.compactTitleScale));
      domNode.style.setProperty('--jv-handle-hit', `${v.handleHitPx}px`);
      domNode.style.setProperty('--jv-zoom', String(v.zoom));
      domNode.style.setProperty('--jv-caption-scale', String(v.captionScale));
    };
    write();
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.transform[2] === prev.transform[2] && s.domNode === prev.domNode) return;
      if (!frame) frame = requestAnimationFrame(write);
    });
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [store]);

  return null;
}

/**
 * Tells the map's notice that the view or a card moved (U01), so it can keep clear of the selected
 * card: the T06 pan, a zoom, a drag. Must render inside <ReactFlow>, which provides the store.
 */
function MapMoved({ onMove }: { onMove: () => void }) {
  const store = useStoreApi();
  const moved = useRef(onMove);
  moved.current = onMove;
  React.useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.transform !== prev.transform || s.nodeLookup !== prev.nodeLookup) moved.current();
      }),
    [store]
  );
  return null;
}

/** A tap's press and its click come this close together; a later click is not that tap's. */
const TOUCH_TAP_MAX_MS = 1000;

/**
 * True when a touch at (x, y) that the browser gave to `handle` landed on the handle's card and off
 * the drawn dot, the handle's own box (U01): a press on the card body the browser snapped to the dot.
 */
function touchOffDot(handle: Element, x: number, y: number): boolean {
  const card = handle.closest('.react-flow__node');
  if (!card) return false;
  const within = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  return within(card.getBoundingClientRect()) && !within(handle.getBoundingClientRect());
}

/** The dot React Flow has armed a line from. */
type ArmedDot = { nodeId: string; type: 'source' | 'target'; id: string | null };

/**
 * A finger's press on a card body never starts a line (U01). The hit areas stop at the dot on a
 * coarse pointer, but the browser snaps a touch onto a tap target that near, so a tap 2 to 9px inside
 * a card, level with a dot, still reached the dot. So a touch whose own point is inside the card and
 * off the dot (touchOffDot) reaches no handle: its touchstart is stopped before React Flow's, so it
 * draws no line, and the answer says whether the line just armed came from that touch's tap, for the
 * notice to drop it unsaid. The tap still selects the card. A mouse or pen press forgets the touch.
 */
function useTouchSnapGuard(): (from: ArmedDot) => boolean {
  const press = useRef<{ at: number; offDot: Element | null } | null>(null);
  React.useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') press.current = null;
    };
    const onTouch = (e: TouchEvent) => {
      const point = e.touches.length === 1 ? e.touches[0] : null;
      const handle = point && e.target instanceof Element ? e.target.closest('.react-flow__handle') : null;
      const offDot = handle && point && touchOffDot(handle, point.clientX, point.clientY) ? handle : null;
      press.current = { at: performance.now(), offDot };
      // Ahead of React Flow's own touchstart on the handle, so the press cannot start drawing a line.
      if (offDot) e.stopPropagation();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('touchstart', onTouch, { capture: true });
    };
  }, []);
  return useCallback((from: ArmedDot) => {
    const last = press.current;
    press.current = null;
    const dot = last?.offDot;
    return Boolean(
      dot && performance.now() - last.at < TOUCH_TAP_MAX_MS
      && dot.getAttribute('data-nodeid') === from.nodeId
      && dot.classList.contains(from.type)
      && (dot.getAttribute('data-handleid') ?? null) === from.id
    );
  }, []);
}

/**
 * Click-to-connect (T03). A tap on a dot arms a line that the next tap on another dot finishes, and
 * zoomed out a dot's hit area reaches well into its card, so a tap meant for the card can arm one.
 * React Flow keeps the armed dot in its store and offers no way out but finishing the line, so this
 * lets Escape, a tap on the empty map and the notice's Dismiss drop it (through `cancelRef`), and
 * reports when one is armed and when it is dropped by any path, so a notice can name it while it
 * waits. Must render inside <ReactFlow>, which provides the store.
 */
function ClickConnectCancel({
  cancelRef,
  onArmed,
  onDropped
}: {
  cancelRef: React.MutableRefObject<() => void>;
  onArmed: (from: ArmedDot) => void;
  onDropped: () => void;
}) {
  const store = useStoreApi();
  const armed = useRef(onArmed);
  armed.current = onArmed;
  const dropped = useRef(onDropped);
  dropped.current = onDropped;

  React.useEffect(() => {
    const cancel = () => {
      if (store.getState().connectionClickStartHandle) store.setState({ connectionClickStartHandle: null });
    };
    cancelRef.current = cancel;
    // Capture, and nothing is stopped: the same Escape still closes whatever else it closes.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey, true);
    const unsubscribe = store.subscribe((s, prev) => {
      const now = s.connectionClickStartHandle;
      if (now === prev.connectionClickStartHandle) return;
      if (now) armed.current({ nodeId: now.nodeId, type: now.type, id: now.id ?? null });
      else dropped.current();
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      unsubscribe();
      cancelRef.current = () => {};
    };
  }, [store, cancelRef]);

  return null;
}

export const JourneyCanvas: React.FC<Props> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
  canvasViewMode = 'edit',
  showRetentionBranches,
  onToggleRetentionBranches,
  onUndoMove,
  metrics,
  onChangeStatsDays,
  onOpenStep,
  onOpenEdge,
  focusRequest,
  onOpenIssues,
  onGraphChange,
  canvasViewRef,
  pickerRequest,
  onClearPickerRequest
}) => {
  const nodeTypes: NodeTypes = useMemo(() => ({
    'ad-source': withStepAdd(AdNode),
    'landing-page': withStepAdd(PageNode),
    'lead-form': withStepAdd(FormNode),
    'follow-up-sequence': withStepAdd(SequenceNode),
    'thank-you': withStepAdd(ThankYouNode),
    'upsell': withStepAdd(UpsellNode),
    'ab-split': withStepAdd(AbSplitNode)
  }), []);

  const edgeTypes: EdgeTypes = useMemo(() => ({
    conversion: ConversionEdge
  }), []);

  const [rfNodes, setRfNodes, onNodesChangeHandler] = useNodesState(nodes);
  const [rfEdges, setRfEdges, onEdgesChangeHandler] = useEdgesState(edges);
  const [localShowRetention, setLocalShowRetention] = useState(true);
  // The last tidy, so its notice can offer Undo. Held only while every step still sits where it put them.
  const [tidyNote, setTidyNote] = useState<{ kind: 'tidied' | 'already'; before: Positions; after: Positions } | null>(null);
  const flowRef = useRef<ReactFlowInstance<JourneyNode, JourneyEdge> | null>(null);
  const tidyButtonRef = useRef<HTMLButtonElement>(null);
  // The last real size of each card. The sync effect rebuilds rf nodes without `measured`, and a
  // card hidden by the retention filter is never measured again, so the tidy reads sizes from here.
  const measuredSizes = useRef(new Map<string, Size>());

  const effectiveShowRetention = showRetentionBranches !== undefined ? showRetentionBranches : localShowRetention;

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  // What each card's status strip shows, so a step's spoken name says the same (U07).
  const { states: publishStates } = usePublishStatus();

  const retentionNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of rfNodes) {
      if (isRetentionStep(n.data)) {
        set.add(n.id);
      }
    }
    return set;
  }, [rfNodes]);

  const retentionCount = retentionNodeIds.size;

  // Every card and line reads its figures from here (#9), built from the saved nodes and edges so
  // hidden retention steps and a line mid-draw never change what the others say.
  const canvasMetrics = useMemo(() => buildCanvasMetrics(nodes, edges, metrics ?? null), [nodes, edges, metrics]);
  const rangeLocked = !metrics || metrics.status === 'signed-out' || !onChangeStatsDays;

  // Lines on a loop (#13), from the whole map: hidden retention lines still count, and a saved
  // inLoop is never trusted.
  const loopEdgeIds = useMemo(() => findLoopEdges(edges), [edges]);

  // Connection rules (#13). A line asking to replace the one on its branch waits here for the
  // person's answer; a refusal or a new loop is explained in the notice at the foot of the map.
  const [pendingReplace, setPendingReplace] = useState<{ connection: Connection; existing: JourneyEdge[] } | null>(null);
  // The one notice at the foot of the map: a refused line, a loop, a step just added (#12, cleared
  // after 6 s) or what releasing a dragged step onto a line will do.
  const [ruleNotice, setRuleNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  // The step picker (#12), open for one request at a time.
  const [picker, setPicker] = useState<PickerState | null>(null);
  // Bumped by each tap on a step card, so the phone layout can keep that card on screen (T06).
  const [tapRequest, setTapRequest] = useState(0);
  // The line a dragged loose step would land on if released now (#12), and each line's shape.
  const [dropLineId, setDropLineId] = useState<string | null>(null);
  const dropLineRef = useRef<string | null>(null);
  const lineSamples = useRef<Record<string, XY[]> | null>(null);
  const dragFrame = useRef(0);
  // The click-to-connect path hands onClickConnectEnd no target, so the refusal isValidConnection
  // saw on the second click is the only record of why nothing was added.
  const lastRefusal = useRef<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // How far down the map the top-right tools and legend reach, and the map's height, so a
  // whole-map fit keeps its cards out from under them and the minimap (C01). Read before React
  // Flow measures the cards, so the first fit already has it, and again when the legend opens.
  const overlayRef = useRef<HTMLDivElement>(null);
  // On a narrow map (a phone, or 768px with the panel beside it) the tools row and the Lines legend
  // fold into one "Map tools" button (T06), so more of the map shows. Measured before the room below
  // is read, so the first fit already leaves room for the one row.
  const [compactTools, setCompactTools] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsToggleRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const box = canvasRef.current;
    if (!box) return;
    const read = () => setCompactTools(mapToolsCompact(box.clientWidth));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const toolsShown = !compactTools || toolsOpen;
  const readOverlayRoom = useCallback(() => {
    const box = canvasRef.current;
    const overlay = overlayRef.current;
    return box && overlay ? { bottom: overlay.offsetTop + overlay.offsetHeight, pane: box.clientHeight } : { bottom: 0, pane: 0 };
  }, []);
  const [overlayRoom, setOverlayRoom] = useState({ bottom: 0, pane: 0 });
  useLayoutEffect(() => {
    const box = canvasRef.current;
    const overlay = overlayRef.current;
    if (!box || !overlay) return;
    const read = () => {
      const next = readOverlayRoom();
      setOverlayRoom(r => (r.bottom === next.bottom && r.pane === next.pane ? r : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(overlay);
    ro.observe(box);
    return () => ro.disconnect();
  }, [readOverlayRoom, compactTools]);
  const wholeMapPadding = overlayFitPadding(0.2, overlayRoom.pane, overlayRoom.bottom);
  // The step a Replace line leaves, kept past the dialog's close so focus can go back to it.
  const replaceReturnId = useRef<string | null>(null);

  // React Flow names its zoom panel "Map controls" (JOURNEY_ARIA_LABELS) on a div with no role, and
  // a name on a plain div is not allowed, so many screen readers skip it (#11's aria-prohibited-attr).
  // Its Controls take no role prop, so the panel is made a named group here, after each render.
  React.useEffect(() => {
    const panel = canvasRef.current?.querySelector('.react-flow__controls');
    if (panel && panel.getAttribute('role') !== 'group') panel.setAttribute('role', 'group');
  });

  // A step the pending line names has gone (a delete, a blueprint load): there is nothing to ask.
  React.useEffect(() => {
    if (pendingReplace && (!nodeMap.has(pendingReplace.connection.source) || !nodeMap.has(pendingReplace.connection.target))) {
      setPendingReplace(null);
    }
  }, [pendingReplace, nodeMap]);

  // The positions last passed in, so a position the parent changed (an undo, a tidy) can be told
  // apart from one React Flow is holding mid-drag.
  const lastPropPositions = React.useRef(new Map<string, { x: number; y: number }>());

  // Synchronize when external nodes change, preserving active user coordinates unless the
  // parent moved the card itself
  React.useEffect(() => {
    const moved = parentMovedIds(nodes, lastPropPositions.current);
    lastPropPositions.current = new Map(nodes.map(n => [n.id, n.position]));
    setRfNodes(currentRfNodes => {
      const positionMap = new Map(currentRfNodes.map(rn => [rn.id, rn.position]));
      // A node rebuilt without `measured` is hidden (visibility: hidden) until React Flow measures
      // it again, and a hidden element loses keyboard focus. Keeping the last size means a
      // selection change never blinks the map or drops focus from the step that has it (#7).
      const measuredMap = new Map(currentRfNodes.map(rn => [rn.id, rn.measured]));
      return nodes.map(n => ({
        ...n,
        measured: n.measured ?? measuredMap.get(n.id),
        position: !moved.has(n.id) && positionMap.has(n.id) ? (positionMap.get(n.id) || n.position) : n.position,
        selected: n.id === selectedNodeId,
        // What a screen reader says for the step's focusable wrapper. Recomputed on every sync,
        // and stripped again before anything goes back to App.
        ariaLabel: stepSpokenName(n, publishStates.get(n.id)),
        // "Landing page /vip-consultation, not published, step", not "group" or a node id (#19).
        domAttributes: { 'aria-roledescription': 'step' },
        data: {
          ...n.data,
          canvasViewMode
        }
      }));
    });
  }, [nodes, selectedNodeId, canvasViewMode, publishStates, setRfNodes]);

  // The handlers every line carries in its data, made once for the life of the canvas and reading
  // the latest props through a ref (C24). A closure made during render holds that whole render
  // scope, rfEdges included, so a fresh one on every line kept the previous generation of lines
  // alive, and that one the generation before: the heap grew with every selection and keystroke.
  // Built once, the lines also stop being rebuilt when App hands in a new inline arrow.
  const edgeHandlers = useRef({ edges, onOpenEdge, onSelectNode, onSelectEdge });
  edgeHandlers.current = { edges, onOpenEdge, onSelectNode, onSelectEdge };
  const lineHandlers = useMemo(() => ({
    onSelectEdge: (id: string, opts?: { focus?: boolean }) => {
      const h = edgeHandlers.current;
      const clicked = h.edges.find(item => item.id === id);
      if (clicked && opts?.focus && h.onOpenEdge) { h.onOpenEdge(id); return; }
      if (h.onSelectNode) h.onSelectNode(null);
      if (h.onSelectEdge) h.onSelectEdge(clicked || null);
    },
    // + Step on the selected line (#12). The picker keeps this line's exit.
    onAddStep: (id: string) => setPicker({ request: { direction: 'between', edgeId: id }, lockedExit: true })
  }), []);

  React.useEffect(() => {
    setRfEdges(
      edges.map(e => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        const isRetention = Boolean(e.data?.isRetentionEdge || isRetentionLink(e.sourceHandle, target?.data));
        const kind = edgeKind(e.sourceHandle, target?.data, isRetention);
        // The line in words (#19). The <g> is hidden from assistive tech and never takes focus: the
        // rate pill is the line's one keyboard stop, and it reads this sentence as its description.
        // Counts come from the figure the pill shows (#9), never from counts saved on the line.
        const description = describeEdge({
          kind,
          from: source ? stepShortName(source.data) : 'a step that is gone',
          to: target ? stepShortName(target.data) : 'a step that is gone',
          figure: canvasMetrics.edges[e.id] ?? null
        });

        return {
          ...e,
          markerEnd: arrowFor(kind),
          ariaLabel: description,
          focusable: false,
          domAttributes: { 'aria-hidden': true },
          data: {
            sourceThroughput: 0,
            targetCount: 0,
            rate: 0,
            sourceHandle: e.sourceHandle || undefined,
            targetHandle: e.targetHandle || undefined,
            isRetentionEdge: isRetention,
            ...(e.data || {}),
            inLoop: loopEdgeIds.has(e.id),
            sourceNodeType: source?.data?.type,
            targetNodeType: target?.data?.type,
            sourceNodeLabel: source?.data?.label,
            targetNodeLabel: target?.data?.label,
            sourceNodeData: source?.data,
            targetNodeData: target?.data,
            isSelected: e.id === selectedEdgeId,
            onSelectEdge: lineHandlers.onSelectEdge,
            onAddStep: lineHandlers.onAddStep,
            description
          }
        };
      })
    );
  }, [edges, nodeMap, loopEdgeIds, canvasMetrics, selectedEdgeId, lineHandlers, setRfEdges]);

  // React Flow's keyboard move (a selected step plus Arrow or Shift+Arrow) sends position changes
  // with no drag, so onNodeDragStop never runs and App never heard of it: a reload put the step
  // back, and the next drag's undo step swept it up (C05). The queue hands App ONE onNodesChange
  // once the presses stop, or at once when anything else is pressed or clicked, so Undo right
  // after the arrows takes back the move. Refs, because the queue lives as long as the canvas.
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;
  const latestOnNodesChange = useRef(onNodesChange);
  latestOnNodesChange.current = onNodesChange;
  const moveQueue = useRef<MoveQueue | null>(null);
  if (!moveQueue.current) moveQueue.current = createMoveQueue(moves => latestOnNodesChange.current(applyMoves(latestNodes.current, moves)));

  React.useEffect(() => {
    const queue = moveQueue.current!;
    const flush = (e: Event) => {
      if (queue.pending() && commitsWaitingMove(e as KeyboardEvent)) queue.flush();
    };
    window.addEventListener('keydown', flush, true);
    window.addEventListener('pointerdown', flush, true);
    return () => {
      window.removeEventListener('keydown', flush, true);
      window.removeEventListener('pointerdown', flush, true);
      queue.flush();
    };
  }, []);

  // What gets saved: the parent's nodes, at the positions on screen. Never rfNodes as they are,
  // which carry the view mode, the spoken label and the selection. Every path that hands App the
  // steps (a delete, a drag, an added step) goes through here (C36).
  const persistedNodes = useCallback(
    (moved: { id: string; position: XY }[] = []) => {
      const live = new Map(rfNodes.map(n => [n.id, n.position]));
      return nodes.map(n => {
        const position = moved.find(m => m.id === n.id)?.position ?? live.get(n.id);
        return position ? { ...n, position } : n;
      });
    },
    [nodes, rfNodes]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeHandler(changes as any);
      moveQueue.current!.add(changes);
      const removals = changes.filter(c => c.type === 'remove');
      if (removals.length > 0) {
        // Tell App outside any state updater: an updater that sets App's state runs during
        // render, and a re-run of it looped until React gave up (update depth exceeded).
        // The saved steps less the gone ones, never rfNodes, whose measured size, selection and
        // view mode were being saved into the journey (C36).
        const removedIds = new Set(removals.map((c: any) => c.id));
        onNodesChange(persistedNodes().filter(n => !removedIds.has(n.id)).map(stripA11yDecorations) as JourneyNode[]);
        if (selectedNodeId && removedIds.has(selectedNodeId)) {
          onSelectNode(null);
        }
      }
    },
    [onNodesChangeHandler, onNodesChange, selectedNodeId, onSelectNode, persistedNodes]
  );

  React.useEffect(() => {
    for (const n of rfNodes) {
      const w = n.measured?.width;
      const h = n.measured?.height;
      if (w && h) measuredSizes.current.set(n.id, { width: w, height: h });
    }
  }, [rfNodes]);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeHandler(changes as any);
      const removals = changes.filter(c => c.type === 'remove');
      if (removals.length > 0) {
        // The saved lines less the gone ones, never rfEdges: those carry a copy of both end steps'
        // data, the arrow, the loop and selection flags the sync effect adds for drawing (C36).
        const removedIds = new Set(removals.map((c: any) => c.id));
        onEdgesChange(edges.filter(e => !removedIds.has(e.id)).map(stripA11yDecorations) as JourneyEdge[]);
        if (selectedEdgeId && removedIds.has(selectedEdgeId)) {
          if (onSelectEdge) onSelectEdge(null);
        }
      }
    },
    [onEdgesChangeHandler, onEdgesChange, selectedEdgeId, onSelectEdge, edges]
  );

  // Backspace or Delete on the map, React Flow's own delete key, which every step's description
  // offers (C04). The card that had focus leaves the page, so focus goes to the map, never the page
  // body, and the notice says what went and how to undo it. React Flow calls this after both change
  // handlers but before the card is gone, so focus waits for the card to leave. The panel's Delete
  // button is App's and has its own focus rule.
  const keyboardDeleted = useRef<{ ids: Set<string>; gone: boolean } | null>(null);
  const handleDelete = useCallback(
    ({ nodes: goneNodes, edges: goneEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const apple = isApplePlatform(typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent);
      const text = deletedNotice({ nodes: goneNodes, edges: goneEdges }, nodeMap, apple);
      if (text) setRuleNotice({ tone: 'deleted', text });
      if (goneNodes.length === 0) return;
      const ids = goneNodes.map(n => n.id);
      keyboardDeleted.current = { ids: new Set(ids), gone: false };
      let tries = 0;
      const onPage = (id: string) => canvasRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      const attempt = () => {
        if (ids.some(onPage) && ++tries < 30) {
          requestAnimationFrame(attempt);
          return;
        }
        if (focusFellWithDelete(document.activeElement, document.body)) canvasRef.current?.focus({ preventScroll: true });
      };
      requestAnimationFrame(attempt);
    },
    [nodeMap]
  );

  // Every new line lands here once the rules have said yes. Added to the saved edges, not rfEdges,
  // so the derived fields the canvas adds for drawing (sourceNodeData, onSelectEdge, isSelected,
  // inLoop) never reach the saved journey. The sync effect redraws from the props. A line drawn by
  // hand has the one shape a line the step picker adds has (makeLine, #12), and a line out of a
  // retention step reads as retention because makeLine is given the source step's data.
  const commitConnection = useCallback(
    (params: Connection, replaced: JourneyEdge[]) => {
      const sourceNode = nodeMap.get(params.source);
      const targetNode = nodeMap.get(params.target);
      const newEdge = makeLine(
        params.source,
        params.sourceHandle ?? null,
        params.target,
        params.targetHandle ?? null,
        targetNode?.data,
        newStamp(),
        sourceNode?.data
      );
      const nextEdges = withConnection(edges, newEdge, replaced);
      onEdgesChange(nextEdges);
      setRuleNotice(
        createsLoop(nextEdges, params.source, params.target)
          ? { tone: 'loop', text: loopMessage(params, nodes) }
          : null
      );
    },
    [edges, nodes, nodeMap, onEdgesChange]
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      const verdict = checkConnection(params, nodes, edges);
      if (verdict.kind === 'refuse') {
        // isValidConnection already stops these; kept for a drop that slips past it.
        setRuleNotice({ tone: 'refused', text: refusalNotice(verdict.message) });
      } else if (verdict.kind === 'replace') {
        replaceReturnId.current = params.source;
        setPendingReplace({ connection: params, existing: verdict.existing });
      } else {
        commitConnection(params, []);
      }
    },
    [nodes, edges, commitConnection]
  );

  // Asked on every handle a line is dragged over: a refused line draws red and dashed, and cannot
  // be dropped. Replace and a loop are both allowed.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const verdict = checkConnection(c, nodes, edges);
      lastRefusal.current = verdict.kind === 'refuse' ? verdict.message : null;
      return verdict.kind !== 'refuse';
    },
    [nodes, edges]
  );

  // A new line starts with a clean slate: the last explanation has done its job.
  const clearRuleState = useCallback(() => {
    lastRefusal.current = null;
    setRuleNotice(null);
  }, []);

  // A drag released on a handle the rules refused. Worked out again from where it ended rather
  // than from the last handle hovered. A same-kind drop (source onto source) is not a rule, so it
  // stays silent. A line let go on empty map opens the step picker for that dot (#12): an exit dot
  // asks what comes next, the main input dot asks what comes before. Only the bare pane counts, so
  // a release on a card, a rate pill, the legend, the controls or the minimap opens nothing.
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid === false) {
        const c = connectionFromState(state);
        if (!c) return;
        const verdict = checkConnection(c, nodes, edges);
        if (verdict.kind === 'refuse') setRuleNotice({ tone: 'refused', text: refusalNotice(verdict.message) });
        return;
      }
      if (state.isValid || !state.fromNode || !state.fromHandle || !flowRef.current) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point) return;
      const hit = document.elementFromPoint(point.clientX, point.clientY);
      if (!hit?.classList.contains('react-flow__pane') || !canvasRef.current?.contains(hit)) return;
      const at = flowRef.current.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const anchorId = state.fromNode.id;
      if (state.fromHandle.type === 'source') {
        setPicker({ request: { direction: 'next', anchorId, handle: state.fromHandle.id ?? null, at }, lockedExit: true });
      } else if (!state.fromHandle.id) {
        setPicker({ request: { direction: 'before', anchorId, at }, lockedExit: true });
      } else {
        setRuleNotice({ tone: 'refused', text: 'Retention flows start from the bottom dot of a page or an offer.' });
      }
    },
    [nodes, edges]
  );

  // A tap on a dot armed a line (T03): say which, and how to drop it, since a tap meant for the card
  // can land on a dot's hit area when the map is zoomed out.
  const cancelClickConnect = useRef<() => void>(() => {});
  const snappedFromCard = useTouchSnapGuard();
  // Set once React Flow has armed the dot, so after clearRuleState has run for the same tap.
  const showConnectingNotice = useCallback(
    (from: ArmedDot) => {
      // A tap on a card body that the browser snapped onto a dot (U01): drop the line and say
      // nothing, once React Flow has finished setting it, since this runs inside its update.
      if (snappedFromCard(from)) {
        queueMicrotask(() => cancelClickConnect.current());
        return;
      }
      const node = nodeMap.get(from.nodeId);
      const name = node ? nameInSentence(stepShortName(node.data)) : 'this step';
      const way = from.type === 'target' ? 'into' : 'from';
      // On a touch screen a dot takes a tap on little more than itself (U01), so zoomed far out the
      // notice says to zoom in rather than promise a dot that is easy to hit.
      let coarse = false;
      try {
        coarse = window.matchMedia(COARSE_POINTER_QUERY).matches;
      } catch {
        coarse = false;
      }
      const tight = handleTargetsTight(flowRef.current?.getZoom() ?? 1, coarse ? 'coarse' : 'fine');
      setRuleNotice({
        tone: 'connecting',
        text: `Choose a dot on another step to finish the line ${way} ${name}, or press Escape to cancel.${tight ? ' Zoom in if a dot is too small to tap.' : ''}`
      });
    },
    // snappedFromCard is one function for the canvas's life (useTouchSnapGuard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeMap]
  );
  const dropConnectingNotice = useCallback(() => setRuleNotice(n => (n?.tone === 'connecting' ? null : n)), []);

  const handleClickConnectEnd = useCallback(() => {
    const message = lastRefusal.current;
    lastRefusal.current = null;
    if (message) setRuleNotice({ tone: 'refused', text: refusalNotice(message) });
  }, []);

  // The map may have changed while the dialog was open, so the answer is checked again: a line
  // deleted meanwhile means the new one is simply added.
  const confirmReplace = useCallback(() => {
    const pending = pendingReplace;
    setPendingReplace(null);
    if (!pending) return;
    const verdict = checkConnection(pending.connection, nodes, edges);
    if (verdict.kind === 'refuse') setRuleNotice({ tone: 'refused', text: refusalNotice(verdict.message) });
    else commitConnection(pending.connection, verdict.kind === 'replace' ? verdict.existing : []);
  }, [pendingReplace, nodes, edges, commitConnection]);

  // After the dialog closes, focus goes to the step the line leaves, or to the map when that step
  // is hidden or gone.
  const returnFocusAfterReplace = useCallback(() => {
    const id = replaceReturnId.current;
    const card = id ? canvasRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`) : null;
    (card ?? canvasRef.current)?.focus({ preventScroll: true });
  }, []);

  const dismissRuleNotice = () => {
    if (ruleNotice?.tone === 'connecting') cancelClickConnect.current();
    setRuleNotice(null);
    canvasRef.current?.focus({ preventScroll: true });
  };

  const handleNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      if (onSelectEdge) onSelectEdge(null);
      onSelectNode(node as JourneyNode);
      // A tap on the card itself, not a control inside it or a keyboard press, keeps it on screen
      // once the panel has scrolled into view (T06, useKeepTappedStepOnScreen).
      const onControl = e.target instanceof Element && e.target.closest('button, a, input, select, textarea');
      if (e.detail > 0 && !onControl) setTapRequest(t => t + 1);
    },
    [onSelectNode, onSelectEdge]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (onSelectNode) onSelectNode(null);
      if (onSelectEdge) onSelectEdge(edge as JourneyEdge);
    },
    [onSelectNode, onSelectEdge]
  );

  const handlePaneClick = useCallback(() => {
    cancelClickConnect.current();
    onSelectNode(null);
    if (onSelectEdge) onSelectEdge(null);
  }, [onSelectNode, onSelectEdge]);

  // Enter or Space on a focused step: React Flow selects it in its own store and never calls
  // onNodeClick, so the panel is opened here. Escape on the selected step closes its panel. React
  // Flow queued a blur of the step in an earlier animation frame callback, so this one runs after
  // it and puts focus back on the step.
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const a = canvasKeyAction(e.key, e.target as HTMLElement);
    if (!a) return;
    if ('open' in a) {
      if (nodeMap.has(a.open) && onOpenStep) {
        e.preventDefault();
        onOpenStep(a.open);
      }
      return;
    }
    if (a.close === selectedNodeId) {
      onSelectNode(null);
      const el = e.target as HTMLElement;
      requestAnimationFrame(() => el.focus({ preventScroll: true }));
    }
  };

  // ---- Adding a step where the person works (#12). Every rule is in addStep.ts; this wires it.

  // Focus the card once it is drawn and measured: a card React Flow has not measured yet is
  // hidden, and a hidden element cannot take focus. The map pans to it on its own (FocusSelectedStep).
  const focusCard = useCallback((id: string) => {
    let tries = 0;
    const attempt = () => {
      const card = canvasRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (card && getComputedStyle(card).visibility !== 'hidden') {
        card.focus({ preventScroll: true });
        return;
      }
      if (++tries < 30) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(() => requestAnimationFrame(attempt));
  }, []);

  // One map edit: the whole node and edge list as ONE change (one undo step), then the step is
  // selected, shown (a retention step turns Retention Flows back on, never off) and focused.
  const applyGraph = useCallback(
    (nextNodes: JourneyNode[], nextEdges: JourneyEdge[], stepId: string, summary: string) => {
      if (onGraphChange) onGraphChange(nextNodes, nextEdges);
      else {
        onNodesChange(nextNodes);
        onEdgesChange(nextEdges);
      }
      const step = nextNodes.find(n => n.id === stepId) ?? null;
      onSelectEdge?.(null);
      onSelectNode(step);
      if (step && isRetentionStep(step.data) && !effectiveShowRetention) {
        setLocalShowRetention(true);
        onToggleRetentionBranches?.(true);
      }
      setRuleNotice({ tone: 'added', text: summary });
      focusCard(stepId);
    },
    [onGraphChange, onNodesChange, onEdgesChange, onSelectEdge, onSelectNode, effectiveShowRetention, onToggleRetentionBranches, focusCard]
  );

  const openPicker = useCallback((request: AddRequest, lockedExit: boolean) => {
    setRuleNotice(null);
    setPicker({ request, lockedExit });
  }, []);

  useEffect(() => {
    if (pickerRequest) {
      openPicker(pickerRequest, false);
      onClearPickerRequest?.();
    }
  }, [pickerRequest, openPicker, onClearPickerRequest]);

  // rfNodes carry each card's measured size, which placement needs; the edges are the saved ones.
  const planNodes = rfNodes as JourneyNode[];

  const chooseStep = (row: ChoiceRow) => {
    if (!picker) return;
    const plan = planAdd(picker.request, row.key, planNodes, edges, newStamp());
    const check = checkPlan(plan, nodes, edges);
    if (!plan.ok || !plan.node || !check.ok) {
      // Kept open: the reason shows where the note was.
      const reason = !plan.ok ? plan.reason : !check.ok ? check.message : 'That step could not be added.';
      setPicker(p => (p ? { ...p, note: reason } : p));
      return;
    }
    setPicker(null);
    applyGraph([...persistedNodes(), plan.node], plan.edges, plan.node.id, plan.summary);
  };

  const pickerView = useMemo(() => {
    if (!picker) return null;
    const { request } = picker;
    const anchor = request.direction === 'between' ? undefined : nodeMap.get(request.anchorId);
    return {
      title: pickerTitle(request),
      anchorLabel: pickerAnchorLabel(request, nodes, edges),
      rows: choicesFor(request, planNodes, edges),
      note: picker.note || exitNote(request, nodes, edges),
      exits: !picker.lockedExit && request.direction === 'next' && anchor ? exitOptions(anchor, nodes, edges) : undefined,
      exit: request.direction === 'next' ? request.handle : undefined
    };
    // planNodes is rfNodes; positions matter only once a step is chosen, which reads them afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, nodes, edges, nodeMap]);

  // The step whose + Before / + Next show: the selected step while it is on the map.
  const toolbarStep = selectedNodeId ? nodeMap.get(selectedNodeId) : undefined;
  const toolbarPorts = toolbarStep ? STEP_PORTS[toolbarStep.type as NodeType] : undefined;
  const canAddBefore = !!toolbarPorts?.inputs.some(p => p.handle === null);
  const canAddNext = !!toolbarPorts && toolbarPorts.exits.length > 0;

  // A loose step dragged over a line (#12). Only a single step with no line of its own can go onto
  // one; anything else is just moved, and no line changes.
  const handleNodeDragStart: OnNodeDrag = useCallback((_event, node, dragged) => {
    // An arrow-key move still waiting is its own undo step, never part of this drag's (C05).
    moveQueue.current!.flush();
    dropLineRef.current = null;
    setDropLineId(null);
    lineSamples.current = null;
    if (dragged.length !== 1 || edges.some(e => e.source === node.id || e.target === node.id)) return;
    const samples: Record<string, XY[]> = {};
    canvasRef.current?.querySelectorAll<SVGGElement>('.react-flow__edge[data-id]').forEach(g => {
      const path = g.querySelector<SVGPathElement>('path.react-flow__edge-path');
      const id = g.getAttribute('data-id');
      if (!path || !id) return;
      // Edge paths are drawn inside the viewport transform, so these points are in map units.
      const length = path.getTotalLength();
      const points: XY[] = [];
      for (let i = 0; i < 48; i++) {
        const p = path.getPointAtLength((length * i) / 47);
        points.push({ x: p.x, y: p.y });
      }
      samples[id] = points;
    });
    lineSamples.current = samples;
  }, [edges]);

  const handleNodeDrag: OnNodeDrag = useCallback((_event, node) => {
    if (!lineSamples.current || dragFrame.current) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      const samples = lineSamples.current;
      if (!samples) return;
      const size = sizeOf(node);
      const centre = { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 };
      const hit = nearestLine(centre, samples, Math.min(size.width, size.height) / 2);
      if (hit === dropLineRef.current) return;
      dropLineRef.current = hit;
      setDropLineId(hit);
      if (!hit) {
        setRuleNotice(n => (n?.tone === 'hint' ? null : n));
        return;
      }
      const line = edges.find(e => e.id === hit);
      const trial = dropOnLine(nodes, edges, hit, node.id, 'dry-run');
      const text = trial.ok
        ? endSentence(`Release to put ${nameInSentence(stepName(nodeMap.get(node.id)))} between ${nameInSentence(stepName(nodeMap.get(line?.source ?? '')))} and ${nameInSentence(stepName(nodeMap.get(line?.target ?? '')))}`)
        : trial.reason;
      setRuleNotice(text ? { tone: trial.ok ? 'hint' : 'refused', text } : null);
    });
  }, [edges, nodes, nodeMap]);

  // Push the drop positions React Flow hands over, not rfNodes from this render, which can still
  // hold the position from before the last move. One push per drag, so one undo step. A loose step
  // let go on a line goes onto it, where it was dropped, in that same one change.
  const handleNodeDragStop = useCallback<OnNodeDrag>((_event, node, dragged) => {
    // The drag's own last position change is pushed below, not by the keyboard-move queue.
    moveQueue.current!.discard();
    if (dragFrame.current) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = 0;
    }
    const lineId = dropLineRef.current;
    dropLineRef.current = null;
    lineSamples.current = null;
    setDropLineId(null);
    if (lineId) {
      const moved = persistedNodes(dragged);
      const plan = dropOnLine(moved, edges, lineId, node.id, newStamp());
      const check = checkPlan(plan, moved, edges);
      if (plan.ok && check.ok) {
        applyGraph(moved, plan.edges, node.id, plan.summary);
        return;
      }
      const reason = !plan.ok ? plan.reason : !check.ok ? check.message : '';
      setRuleNotice(reason ? { tone: 'refused', text: reason } : null);
    }
    onNodesChange(persistedNodes(dragged).map(stripA11yDecorations) as JourneyNode[]);
  }, [edges, onNodesChange, persistedNodes, applyGraph]);

  // A step added, deleted or restored is announced for 6 s; the next notice replaces it sooner.
  React.useEffect(() => {
    if (ruleNotice?.tone !== 'added' && ruleNotice?.tone !== 'deleted') return;
    const shown = ruleNotice;
    const timer = window.setTimeout(() => setRuleNotice(n => (n === shown ? null : n)), 6000);
    return () => window.clearTimeout(timer);
  }, [ruleNotice]);

  // The header's Add Step (App.handleAddNode) reads the visible centre when it is pressed, so the
  // centre is a getter: it is always the view on screen now, after any pan, zoom or resize.
  const reportView = useCallback(() => {
    if (!canvasViewRef) return;
    canvasViewRef.current = {
      get center() {
        const rect = canvasRef.current?.getBoundingClientRect();
        const flow = flowRef.current;
        if (!rect || !flow || rect.width === 0) return null;
        return flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      },
      sizeOf: (id: string) => flowRef.current?.getInternalNode(id)?.measured ?? measuredSizes.current.get(id)
    };
  }, [canvasViewRef]);

  // A step that appears already selected (the header's Add Step) gets keyboard focus, like one the
  // picker adds. Ids from the first render are known, so loading a journey focuses nothing.
  const knownIds = useRef<Set<string> | null>(null);
  React.useEffect(() => {
    const known = knownIds.current;
    knownIds.current = new Set(nodes.map(n => n.id));
    if (known && selectedNodeId && !known.has(selectedNodeId) && knownIds.current.has(selectedNodeId)) focusCard(selectedNodeId);
  }, [nodes, selectedNodeId, focusCard]);

  // An undo that brings keyboard-deleted steps back (C04) says so, and when focus is still on the
  // map, where the delete left it, it goes to the first step that came back. Only once the steps
  // were seen gone, so a delete App did not take never reads as restored.
  React.useEffect(() => {
    const deleted = keyboardDeleted.current;
    if (!deleted) return;
    const back = nodes.filter(n => deleted.ids.has(n.id));
    if (back.length === 0) {
      deleted.gone = true;
      return;
    }
    if (!deleted.gone) return;
    keyboardDeleted.current = null;
    setRuleNotice({ tone: 'added', text: restoredNotice(back) });
    const active = document.activeElement;
    if (active === canvasRef.current || focusFellWithDelete(active, document.body)) focusCard(back[0].id);
  }, [nodes, focusCard]);

  // Double frame: the new positions reach the DOM before the view fits them. The overlay room is
  // read as the fit runs, with the tidy notice already under the tools.
  const fitAfterLayout = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const room = readOverlayRoom();
    void flowRef.current?.fitView({ padding: overlayFitPadding(0.2, room.pane, room.bottom), duration: reduceMotion() ? 0 : 300 });
  }));

  // rfNodes, not the parent's nodes: they hold the positions on screen and the sizes measured.
  // Only positions change, as ONE onNodesChange, so the tidy is one undo step. Lines are never
  // touched, because a line's source handle is the branch it carries.
  const handleTidyLayout = () => {
    const after = tidyPositions(rfNodes, edges, measuredSizes.current);
    const before = positionsOf(rfNodes);
    if (nodesAt(rfNodes, after)) {
      setTidyNote({ kind: 'already', before, after });
      return;
    }
    setRfNodes(prev => applyPositions(prev, after));
    onNodesChange(applyPositions(nodes, after));
    setTidyNote({ kind: 'tidied', before, after });
    fitAfterLayout();
  };

  // One undo stack: while the tidy is still the latest change this is the history's own undo.
  // After a later edit it puts the steps back as a new change, which keeps that edit.
  const handleUndoTidy = () => {
    const note = tidyNote;
    if (!note || note.kind !== 'tidied') return;
    setRfNodes(prev => applyPositions(prev, note.before));
    if (!onUndoMove?.(note.before)) onNodesChange(applyPositions(nodes, note.before));
    setTidyNote(null);
    focusTidyButton();
    fitAfterLayout();
  };

  // The X unmounts with the notice, so hand focus back to the button that opened it, or to Map tools
  // when the tools have been folded away since (T06).
  const focusTidyButton = () => {
    const tidy = tidyButtonRef.current;
    if (tidy && tidy.getClientRects().length > 0) tidy.focus();
    else toolsToggleRef.current?.focus();
  };
  const dismissTidyNote = () => {
    setTidyNote(null);
    focusTidyButton();
  };

  // A drag, a keyboard move, a delete or a journey swap withdraws the offer, so Undo can never
  // silently revert a later move. Adding a step or hiding retention flows keeps it.
  React.useEffect(() => {
    if (tidyNote && !nodesAt(rfNodes, tidyNote.after)) setTidyNote(null);
  }, [rfNodes, tidyNote]);

  const displayedNodes = useMemo(() => {
    if (effectiveShowRetention) return rfNodes;
    return rfNodes.filter(n => !retentionNodeIds.has(n.id));
  }, [rfNodes, effectiveShowRetention, retentionNodeIds]);

  const displayedEdges = useMemo(() => {
    const shown = effectiveShowRetention
      ? rfEdges
      : rfEdges.filter(e => !retentionNodeIds.has(e.source) && !retentionNodeIds.has(e.target));
    if (!dropLineId) return shown;
    // The line a dragged step would go onto if released now thickens and glows (#12).
    return shown.map(e => (e.id === dropLineId
      ? { ...e, style: { ...e.style, strokeWidth: EDGE_WIDTH_SELECTED + 1.5, filter: 'drop-shadow(0 0 6px rgba(248, 250, 252, 0.6))' } }
      : e));
  }, [rfEdges, effectiveShowRetention, retentionNodeIds, dropLineId]);

  // Path focus is render only: never store focusedEdges. A selected step fades the lines off its
  // path; a stale id (a deleted step) or a hidden retention step fades nothing.
  const selectedShown = Boolean(
    selectedNodeId && nodeMap.has(selectedNodeId) && (effectiveShowRetention || !retentionNodeIds.has(selectedNodeId))
  );
  const focus = useMemo(
    () => pathFocus(selectedNodeId, displayedEdges, selectedShown),
    [selectedNodeId, displayedEdges, selectedShown]
  );
  const focusedEdges = useMemo(() => withPathFocus(displayedEdges, focus), [displayedEdges, focus]);

  // The notice keeps clear of the selected card (U01, noticePlace in src/lib/tapReveal.ts): its top in
  // the map's own px, 'docked' at the window's foot when the strip of map on a phone has no room clear
  // of the card and the zoom controls, or null for its home above the zoom controls and the minimap.
  // Worked out again when the notice, the selection, the view or the page's scroll changes, at most
  // once a frame.
  const noticeBoxRef = useRef<HTMLDivElement>(null);
  const [noticeAt, setNoticeAt] = useState<number | 'docked' | null>(null);
  const noticeShown = useRef(false);
  noticeShown.current = ruleNotice !== null;
  const noticeCard = useRef<string | null>(null);
  noticeCard.current = selectedShown ? selectedNodeId : null;
  const placeFrame = useRef(0);
  const placeNotice = useCallback(() => {
    placeFrame.current = 0;
    const root = canvasRef.current;
    const box = noticeBoxRef.current;
    const id = noticeCard.current;
    if (!noticeShown.current || !root || !box || !id) {
      setNoticeAt(null);
      return;
    }
    const rootBox = root.getBoundingClientRect();
    const drawn = box.getBoundingClientRect();
    const scroller = scrollBoxOf(root);
    const band = visibleBand(rootBox, scroller ? scroller.getBoundingClientRect() : null, { width: window.innerWidth, height: window.innerHeight });
    const card = root.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    const target = card ? unionBox([card, ...card.querySelectorAll('.jv-add-next')].map(el => el.getBoundingClientRect())) : null;
    const obstacles = band
      ? mapOverlayRects(root, { left: band.left, top: band.top, width: band.right - band.left, height: band.bottom - band.top })
        .map(r => ({ left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height }))
      : [];
    // Home is the wrapper's bottom: 116 below, clear of the zoom controls and the minimap.
    const home = rootBox.bottom - 116 - drawn.height;
    const place = noticePlace(drawn, home, band, target, obstacles, { height: window.innerHeight });
    const next = place.docked ? 'docked' : place.top === home ? null : Math.round(place.top - rootBox.top);
    setNoticeAt(prev => (prev === next ? prev : next));
  }, []);
  const scheduleNotice = useCallback(() => {
    if (noticeShown.current && !placeFrame.current) placeFrame.current = requestAnimationFrame(placeNotice);
  }, [placeNotice]);
  useLayoutEffect(() => {
    placeNotice();
  }, [ruleNotice, selectedNodeId, selectedShown, placeNotice]);
  React.useEffect(() => {
    if (!ruleNotice) return;
    window.addEventListener('scroll', scheduleNotice, { capture: true, passive: true });
    window.addEventListener('resize', scheduleNotice);
    // The card's + Before / + Next row settles on its own side after the card is drawn (T07).
    const card = selectedNodeId ? canvasRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(selectedNodeId)}"]`) : null;
    const rows = card && typeof MutationObserver !== 'undefined' ? new MutationObserver(scheduleNotice) : null;
    if (card && rows) rows.observe(card, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
    return () => {
      rows?.disconnect();
      window.removeEventListener('scroll', scheduleNotice, { capture: true });
      window.removeEventListener('resize', scheduleNotice);
      if (placeFrame.current) cancelAnimationFrame(placeFrame.current);
      placeFrame.current = 0;
    };
  }, [ruleNotice, selectedNodeId, scheduleNotice]);

  const legendKinds = useMemo(() => {
    const present = new Set(
      displayedEdges.map(e => edgeKind(e.sourceHandle, e.data?.targetNodeData, e.data?.isRetentionEdge))
    );
    return EDGE_KIND_ORDER.filter(k => present.has(k));
  }, [displayedEdges]);

  // Design checks (#10), from the saved nodes and edges so hidden retention steps still count. The
  // cards read them through context: they never enter node data, undo history or a saved journey.
  const design = useMemo(() => checkJourneyDesign({ nodes, edges }), [nodes, edges]);
  const issueCtx = useMemo(() => ({ byNode: design.byNode, onOpenIssues }), [design, onOpenIssues]);

  const toggleRetention = () => {
    const nextVal = !effectiveShowRetention;
    setLocalShowRetention(nextVal);
    if (onToggleRetentionBranches) {
      onToggleRetentionBranches(nextVal);
    }
  };

  // + Before and + Next on the selected step (#12), above its top-right corner (see StepAddSlot).
  const stepAdd = {
    stepId: selectedShown && toolbarStep && (canAddBefore || canAddNext) ? toolbarStep.id : null,
    buttons: (
      <>
        {toolbarStep && canAddBefore && (
          <button
            type="button"
            className="jv-add-next nodrag nopan"
            aria-label={`Add a step before ${stepName(toolbarStep)}`}
            onClick={e => {
              e.stopPropagation();
              openPicker({ direction: 'before', anchorId: toolbarStep.id }, false);
            }}
            style={addPill}
          >
            + Before
          </button>
        )}
        {toolbarStep && canAddNext && (
          <button
            type="button"
            className="jv-add-next nodrag nopan"
            aria-label={`Add a step after ${stepName(toolbarStep)}`}
            onClick={e => {
              e.stopPropagation();
              openPicker({ direction: 'next', anchorId: toolbarStep.id, handle: defaultExit(toolbarStep, nodes, edges) ?? null }, false);
            }}
            style={addPill}
          >
            + Next
          </button>
        )}
      </>
    )
  };

  return (
    <div ref={canvasRef} tabIndex={-1}
      id="journey-map"
      role="region"
      aria-label="Journey map"
      onKeyDown={handleCanvasKeyDown}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {/* Floating Toolbar Filter: Show / Hide Retention Flows, with the line legend under it. The
          box ignores the pointer and only the pills take it, so the map under the gaps and the
          legend can still be clicked and dragged. */}
      <div
        ref={overlayRef}
        data-map-overlay="tools"
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          zIndex: 20,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px'
        }}
      >
        {/* A narrow map folds the tools and the legend into this one button (T06). Hidden, they
            leave the tab order and the accessibility tree with it; the tidy notice stays out. */}
        {compactTools && (
          <button
            ref={toolsToggleRef}
            type="button"
            aria-expanded={toolsOpen}
            aria-controls="jv-map-tools jv-map-legend"
            onClick={() => setToolsOpen(o => !o)}
            style={{ ...toolPill, cursor: 'pointer' }}
          >
            <SlidersHorizontal size={12} aria-hidden="true" />
            <span>Map tools</span>
            <ChevronDown size={12} aria-hidden="true" style={{ transform: toolsOpen ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: tidyNote && toolsShown ? '8px' : 0 }}>
          <div id="jv-map-tools" style={{ display: toolsShown ? 'flex' : 'none', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              ref={tidyButtonRef}
              type="button"
              onClick={handleTidyLayout}
              disabled={rfNodes.length < 2}
              title={rfNodes.length < 2 ? 'Add a second step to tidy the layout.' : 'Arrange steps in columns from left to right. Only positions change.'}
              style={{
                ...toolPill,
                cursor: rfNodes.length < 2 ? 'not-allowed' : 'pointer',
                opacity: rfNodes.length < 2 ? 0.5 : 1
              }}
            >
              <Workflow size={12} aria-hidden="true" />
              <span>Tidy layout</span>
            </button>
            <label
              style={{ ...toolPill, gap: '6px', cursor: rangeLocked ? 'not-allowed' : 'default' }}
              title={rangeLocked ? 'Sign in to see numbers.' : undefined}
            >
              <span>Numbers</span>
              <select
                aria-label="Date range for the numbers on this map"
                value={metrics?.days ?? DEFAULT_RANGE_DAYS}
                disabled={rangeLocked}
                title={rangeLocked ? 'Sign in to see numbers.' : undefined}
                onChange={e => onChangeStatsDays?.(normalizeRangeDays(e.target.value))}
                style={{
                  padding: '1px 4px',
                  borderRadius: '6px',
                  background: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: rangeLocked ? '#94A3B8' : '#E2E8F0',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: rangeLocked ? 'not-allowed' : 'pointer'
                }}
              >
                {RANGE_DAYS.map(d => (
                  <option key={d} value={d}>{rangeLabel(d)}</option>
                ))}
              </select>
            </label>
            {/* One fixed name with aria-pressed (#19): the visible text changes with the state, and a
                name that changed too would be read as a different button. */}
            <button
              type="button"
              onClick={toggleRetention}
              aria-pressed={effectiveShowRetention}
              aria-label="Retention flows"
              title={effectiveShowRetention ? 'Hide courtesy retention and rescue flows from the canvas' : 'Show courtesy retention and rescue flows on the canvas'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: effectiveShowRetention ? 'rgba(15, 23, 42, 0.88)' : 'rgba(15, 23, 42, 0.65)',
                border: effectiveShowRetention ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(255, 255, 255, 0.1)',
                color: effectiveShowRetention ? '#FBBF24' : '#94A3B8',
                fontSize: '11px',
                fontWeight: 700,
                backdropFilter: 'blur(12px)',
                cursor: 'pointer',
                boxShadow: effectiveShowRetention
                  ? '0 0 16px rgba(245, 158, 11, 0.25), 0 4px 12px rgba(0, 0, 0, 0.4)'
                  : '0 4px 12px rgba(0, 0, 0, 0.4)',
                transition: 'all 0.15s ease',
                pointerEvents: 'auto'
              }}
            >
              {effectiveShowRetention ? (
                <Sparkles size={12} color="#FBBF24" aria-hidden="true" />
              ) : (
                <EyeOff size={12} color="#94A3B8" aria-hidden="true" />
              )}
              <span>{effectiveShowRetention ? 'Retention Flows: Visible' : 'Retention Flows: Hidden'}</span>
              {retentionCount > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    background: effectiveShowRetention ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: effectiveShowRetention ? '#FDE68A' : '#94A3B8',
                    fontWeight: 700
                  }}
                >
                  {retentionCount}
                </span>
              )}
            </button>
          </div>
          <div role="status" aria-live="polite">
            {tidyNote && (
              <div style={{ ...toolPill, color: '#CBD5E1' }}>
                <span>{tidyNote.kind === 'tidied' ? 'Layout tidied.' : 'Already tidy. Nothing moved.'}</span>
                {tidyNote.kind === 'tidied' && (
                  <button type="button" onClick={handleUndoTidy} aria-label="Undo tidy layout" style={noteButton}>
                    <Undo2 size={12} aria-hidden="true" /> Undo
                  </button>
                )}
                <button type="button" aria-label="Dismiss message" onClick={dismissTidyNote} style={{ ...noteButton, padding: '2px 4px' }}>
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div id="jv-map-legend" style={{ display: toolsShown ? 'contents' : 'none' }}>
          <EdgeLegend kinds={legendKinds} note={legendNote(metrics ?? null)} />
        </div>
      </div>

      {/* Why a line was not added, or that it made a loop (#13). Above the controls and the minimap,
          or wherever keeps it off the selected card and the controls, at the window's foot when a
          phone's strip of map has no such place (U01, noticeAt), and it stays until dismissed or
          the next line starts. The status region is always mounted
          so a screen reader hears each new sentence, and holds only the sentence: Dismiss sits
          beside it in the same box, so it is not read as part of the message (R10). */}
      <div
        style={{
          position: noticeAt === 'docked' ? 'fixed' : 'absolute',
          left: 16,
          right: 16,
          ...(noticeAt === null ? { bottom: 116 } : noticeAt === 'docked' ? { bottom: NOTICE_DOCK_GAP } : { top: noticeAt }),
          zIndex: 20,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}
      >
        <div
          ref={noticeBoxRef}
          style={ruleNotice ? {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            maxWidth: 440,
            padding: '8px 10px 8px 12px',
            borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.95)',
            border: `1px solid ${NOTICE_BORDER[ruleNotice.tone]}`,
            color: '#F8FAFC',
            fontSize: '13px',
            lineHeight: 1.4,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            // While a line waits for its second dot, a tap on the notice reaches the map beneath it:
            // on a short map (a phone with the step panel open) it sits over the cards (T03).
            pointerEvents: ruleNotice.tone === 'connecting' ? 'none' : 'auto'
          } : { display: 'contents' }}
        >
          <span role="status" aria-live="polite" data-rule-notice={ruleNotice?.tone}>{ruleNotice?.text}</span>
          {ruleNotice && (
            <button type="button" onClick={dismissRuleNotice} style={{ ...noteButton, flexShrink: 0, padding: '4px 8px', pointerEvents: 'auto' }}>
              Dismiss
            </button>
          )}
        </div>
      </div>

      <ReplaceLineDialog
        prompt={pendingReplace ? replacePrompt(pendingReplace.connection, nodes, pendingReplace.existing) : null}
        onReplace={confirmReplace}
        onCancel={() => setPendingReplace(null)}
        returnFocus={returnFocusAfterReplace}
      />

      {picker && pickerView && (
        <StepPicker
          title={pickerView.title}
          anchorLabel={pickerView.anchorLabel}
          exits={pickerView.exits}
          exit={pickerView.exit}
          onExit={handle => setPicker(p => (p && p.request.direction === 'next' ? { ...p, request: { ...p.request, handle }, note: undefined } : p))}
          note={pickerView.note}
          rows={pickerView.rows}
          onChoose={chooseStep}
          onCancel={() => setPicker(null)}
          fallbackFocusId="journey-map"
        />
      )}

      <DesignIssuesContext.Provider value={issueCtx}>
      <CanvasMetricsContext.Provider value={canvasMetrics}>
      <StepAddContext.Provider value={stepAdd}>
      <ReactFlowProvider>
        <EdgeLabelLayout>
          <ReactFlow
            nodes={displayedNodes}
            edges={focusedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            deleteKeyCode={['Backspace', 'Delete']}
            onDelete={handleDelete}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onConnectStart={clearRuleState}
            onConnectEnd={handleConnectEnd}
            onClickConnectStart={clearRuleState}
            onClickConnectEnd={handleClickConnectEnd}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onPaneClick={handlePaneClick}
            onNodeDragStart={handleNodeDragStart}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
            onInit={instance => { flowRef.current = instance; reportView(); }}
            fitView
            // The first fit frames the selected step at 100% when it is on the map (#21: back from
            // Email Studio, or from Attribution), and the whole map otherwise. React Flow reads this
            // only for its queued first fit, so a later selection is FocusSelectedStep's to pan. A
            // journey opened at a step (#18: its address, Back, Forward) is framed the same way,
            // because App remounts the canvas per journey with that step already selected.
            fitViewOptions={wholeMapFit(canvasFitOptions(selectedNodeId, displayedNodes.map(n => n.id)), wholeMapPadding)}
            // Low enough that fitView can show a tidied journey whole on a phone: four columns
            // need about 0.17 at 390px, and 0.3 cut off the first and last cards.
            minZoom={0.1}
            maxZoom={1.8}
            defaultEdgeOptions={{ type: 'conversion' }}
            ariaLabelConfig={JOURNEY_ARIA_LABELS}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.2}
              color="rgba(255, 255, 255, 0.08)"
            />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              // The map reads the same step-kind table as the cards, so each rectangle is its card's icon colour.
              nodeColor={n => stepKind(n.type, n.data).color}
              maskColor="rgba(11, 15, 25, 0.75)"
              style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
            />
            <FocusSelectedStep nodeId={selectedNodeId} request={focusRequest ?? 0} tap={tapRequest} />
            <SemanticZoom />
            <ClickConnectCancel cancelRef={cancelClickConnect} onArmed={showConnectingNotice} onDropped={dropConnectingNotice} />
            <MapMoved onMove={scheduleNotice} />
          </ReactFlow>
        </EdgeLabelLayout>
      </ReactFlowProvider>
      </StepAddContext.Provider>
      </CanvasMetricsContext.Provider>
      </DesignIssuesContext.Provider>
    </div>
  );
};
