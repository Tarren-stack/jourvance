import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
import { useStore, useStoreApi } from '@xyflow/react';
import {
  geometryKey,
  mapEdgeBands,
  nodeGeometry,
  obstaclesFor,
  placeBadges,
  placeEdgeLabels,
  samePlacements,
  screenBoxToFlow,
  viewportPortalOf,
  type BadgeRequest,
  type Box,
  type LabelPlacement,
  type LabelRequest,
  type NodeGeometry
} from '../../lib/edgeLabelLayout';
import { edgeLineKey } from '../../lib/edgeLineKey';
import { captionLayoutScale, captionScale } from '../../lib/semanticZoom';
import { DesignIssuesContext } from './DesignIssueBadge';

// Places every line's caption clear of cards, handles and other captions (see edgeLabelLayout.ts).
// Sits between ReactFlowProvider and ReactFlow so it reads the same store. From zoom 1 up placement
// is in map units and never depends on pan or zoom, so this subscribes to card geometry and to
// which lines exist (edgeLineKey), never to the edges array itself: the canvas rebuilds that on
// every keystroke.
// Captions register by carrying data-jv-edge-label=<key>, data-label-x, data-label-y and
// data-edge-path; one caption per key.
// Below zoom 1 captions and the design-check badges counter-scale (T02, semanticZoom.ts), so the
// layout also reads captionLayoutScale: a stepped number, so it runs again about 25 times over a
// zoom from 1 to 0.1 and never once a frame. It measures each caption whole and as its figure only
// (data-jv-caption-form, which ConversionEdge renders from the placement), and decides how much of
// each badge fits (placeBadges: whole, a dot or nothing), then keeps the badges clear as well. Zoomed out, an 11px caption that leaves its line can also reach what
// floats over the map (the tools and legend, the zoom controls, the minimap), which take the pointer,
// or the edge of the map, so those are kept clear where they are on screen when the layout runs, and
// the layout runs again once the map stops moving. From zoom 1 up none of this is asked about, as
// before T02.

const EMPTY: Map<string, LabelPlacement> = new Map();
/** How long the map must be still before captions are laid out again against the overlays. */
const SETTLE_MS = 160;
const PlacementContext = createContext<Map<string, LabelPlacement>>(EMPTY);
// React Flow's viewport portal, found once here and handed to every caption. Each caption running
// its own <ViewportPortal> store query cost 2,970 DOM queries a keystroke at 120 steps (R16).
// undefined = no provider above; null = the flow has not mounted its portal yet.
const PortalContext = createContext<HTMLElement | null | undefined>(undefined);

/** The placement for one caption, or undefined until it has been laid out. */
export function useEdgeLabelPlacement(key: string): LabelPlacement | undefined {
  return useContext(PlacementContext).get(key);
}

/**
 * What floats over the map, in screen px where it is now: each painted box of the top-right tools and
 * legend (their container is transparent and lets the pointer through, as check:canvas reads them),
 * the zoom controls and the minimap, and a band beyond each edge of the map (pane). Zoomed-out
 * captions keep clear of these, and so does a selected step's + Before / + Next row (T07).
 */
export function mapOverlayRects(
  root: Element,
  pane: { left: number; top: number; width: number; height: number }
): { left: number; top: number; width: number; height: number }[] {
  const painted = (el: Element) => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  };
  const tools = root.querySelector('[data-map-overlay]');
  const els: Element[] = [];
  tools?.querySelectorAll('*').forEach(el => {
    if (!painted(el)) return;
    for (let a = el.parentElement; a && a !== tools; a = a.parentElement) if (painted(a)) return;
    els.push(el);
  });
  root.querySelectorAll('.react-flow__minimap, .react-flow__controls').forEach(el => els.push(el));
  return [...els.map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0), ...mapEdgeBands(pane)];
}

/** The element captions portal into: undefined outside this provider, null until the flow mounts. */
export function useCaptionPortal(): HTMLElement | null | undefined {
  return useContext(PortalContext);
}

export const EdgeLabelLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = useStoreApi();
  const domNode = useStore(s => s.domNode);
  const portal = useStore(s => viewportPortalOf<HTMLElement>(s.domNode));
  const key = useStore(s => geometryKey(s.nodeLookup.values()));
  const lines = useStore(s => edgeLineKey(s.edges));
  const scale = useStore(s => captionLayoutScale(s.transform[2]));
  // Which steps carry a design-check badge, so a badge that comes or goes is laid out around.
  const { byNode } = useContext(DesignIssuesContext);
  const badged = Object.keys(byNode).filter(k => byNode[k]?.messages.length).sort().join(' ');
  const [placements, setPlacements] = useState<Map<string, LabelPlacement>>(EMPTY);

  useLayoutEffect(() => {
    if (!domNode) return;
    let frame = 0;
    // A caption that changes size (new figures, selection padding) is placed again. Each caption
    // is observed once: observing it again would report it again and never settle.
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;
    const observed = new WeakSet<Element>();

    const layout = () => {
      const labels: LabelRequest[] = [];
      const els = [...domNode.querySelectorAll<HTMLElement>('[data-jv-edge-label]')];
      // Each caption's size whole and, zoomed out, as its figure only. Every form is set, then every
      // size read, so the page lays out twice in all, not twice a caption. The form each caption had
      // is put back before anything is drawn or observed, so no resize is reported for the reads.
      const forms = els.map(el => el.dataset.jvCaptionForm);
      const setForm = (form: string) => els.forEach(el => { el.dataset.jvCaptionForm = form; });
      setForm('full');
      const full = els.map(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
      let compact: { width: number; height: number }[] | null = null;
      if (scale > 1) {
        setForm('compact');
        compact = els.map(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
      }
      els.forEach((el, i) => {
        const was = forms[i];
        if (was === undefined) delete el.dataset.jvCaptionForm;
        else el.dataset.jvCaptionForm = was;
      });
      els.forEach((el, i) => {
        if (resize && !observed.has(el)) {
          observed.add(el);
          resize.observe(el);
        }
        const midX = Number(el.dataset.labelX);
        const midY = Number(el.dataset.labelY);
        if (!Number.isFinite(midX) || !Number.isFinite(midY)) return;
        // Layout sizes ignore the viewport scale, the caption scale and the pill's hover scale, so
        // they are map units at scale 1; placeEdgeLabels multiplies them by the scale.
        labels.push({
          id: el.dataset.jvEdgeLabel || '',
          width: full[i].width,
          height: full[i].height,
          compactWidth: compact?.[i].width,
          compactHeight: compact?.[i].height,
          midX,
          midY,
          path: el.dataset.edgePath || ''
        });
      });
      const geometry = [...store.getState().nodeLookup.values()]
        .map(nodeGeometry)
        .filter((g): g is NodeGeometry => g !== null);
      // Zoomed out, a design-check badge grows up and left from its bottom-right corner (index.css),
      // above its card's corner. Where that would reach another card, a handle or another badge it
      // grows up and right instead, or shows as a dot on the corner, or not at all (placeBadges),
      // written straight onto the badge as data-jv-badge-form so no card re-renders, and the box it
      // keeps is kept clear of captions.
      // Its offsets are from the card, unscaled. At scale 1 every badge is left as it is and out of
      // the obstacles, so badges and captions sit exactly where they did before T02.
      const badges: Box[] = [];
      const badgeEls = new Map<string, HTMLElement>();
      const requests: BadgeRequest[] = [];
      domNode.querySelectorAll<HTMLElement>('[data-jv-design-badge]').forEach(el => {
        if (resize && !observed.has(el)) {
          observed.add(el);
          resize.observe(el);
        }
        if (scale <= 1) {
          delete el.dataset.jvBadgeForm;
          return;
        }
        const id = el.closest<HTMLElement>('.react-flow__node')?.dataset.id;
        const g = id ? geometry.find(n => n.id === id) : undefined;
        if (!id || !g || !el.offsetWidth) return;
        badgeEls.set(id, el);
        requests.push({ nodeId: id, box: { x: g.box.x + el.offsetLeft, y: g.box.y + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } });
      });
      // At the scale the badges are drawn at now, not the stepped one: the layout runs again once the
      // map is still (below), so a badge at rest is decided at exactly its size.
      for (const [id, p] of placeBadges(requests, geometry, captionScale(store.getState().transform[2]))) {
        const el = badgeEls.get(id);
        if (el && el.dataset.jvBadgeForm !== p.form) el.dataset.jvBadgeForm = p.form;
        if (p.box) badges.push(p.box);
      }
      const next = placeEdgeLabels(labels, [...obstaclesFor(geometry, scale), ...badges, ...overlays()], { scale });
      setPlacements(prev => (samePlacements(prev, next) ? prev : next));
    };

    // What floats over the map, in map units for the view as it is now: each painted box of the
    // top-right tools and legend (their container is transparent and lets the pointer through, as
    // check:canvas reads them), the zoom controls and the minimap. And beyond each edge of the map,
    // so a caption is never pushed off screen, half drawn.
    const root = domNode.closest<HTMLElement>('#journey-map') ?? domNode.parentElement;
    const overlays = (): Box[] => {
      if (scale <= 1 || !root) return [];
      const pane = domNode.getBoundingClientRect();
      const t = store.getState().transform;
      return mapOverlayRects(root, pane).map(r => screenBoxToFlow(r, pane, t));
    };

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        layout();
      });
    };

    layout();

    // A line whose midpoint moved, or a caption added or removed, in a render this effect did not
    // run for. Only the midpoint attributes are watched, never the transform this layout writes.
    // Captions live in the viewport portal (after the steps, see ConversionEdge), not the label layer.
    const mutations = portal && typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    mutations?.observe(portal as Element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-label-x', 'data-label-y', 'data-edge-path']
    });

    // Zoomed out, once the map has been still for SETTLE_MS after a pan or a zoom inside one scale
    // step, lay out again against where the overlays now are. Never on a moving frame, and never
    // from zoom 1 up. The tools resizing (the legend opened or closed) does the same.
    let settle = 0;
    const unsubscribe = scale > 1
      ? store.subscribe((s, prev) => {
          if (s.transform === prev.transform) return;
          if (settle) clearTimeout(settle);
          settle = window.setTimeout(() => { settle = 0; schedule(); }, SETTLE_MS);
        })
      : null;
    const tools = scale > 1 ? root?.querySelector('[data-map-overlay]') : null;
    const toolResize = tools && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;
    if (tools) toolResize?.observe(tools);

    return () => {
      resize?.disconnect();
      mutations?.disconnect();
      toolResize?.disconnect();
      unsubscribe?.();
      if (settle) clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [domNode, portal, key, lines, store, scale, badged]);

  return <PlacementContext.Provider value={placements}>
    <PortalContext.Provider value={portal}>{children}</PortalContext.Provider>
  </PlacementContext.Provider>;
};
