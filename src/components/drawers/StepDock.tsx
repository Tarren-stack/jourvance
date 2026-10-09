import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JourneyEdge, JourneyNode, JourneyNodeData, Workspace } from '../../types/journey';
import type { MetricsView } from '../../lib/journeyMetrics';
import { NodeInspector } from './NodeInspector';
import { EdgeInspector } from './EdgeInspector';
import { StepFinder } from './StepFinder';
import { StepConnections } from './StepConnections';
import { useDialogFocus } from '../../lib/a11yHooks';
import { boxInView, deleteFocusTarget, dockStacked, mapTapId, tapOpensPanel, tapReopensPanel, type MapTap } from '../../lib/dockReveal';

// The docked step panel beside the map. It always shows the finder, then the opened step, the
// opened line, or a short empty state. Layout lives in the .jv-step-dock class (index.css) so the
// narrow-screen rule can stack it under the map.
//
// 'nokey' is React Flow's own opt-out: it ignores any key event from inside an element with that
// class, so Backspace on a panel button no longer deletes the selected step and Space no longer
// starts the map's pan mode, while text fields still edit.
//
// Focus rules: a focus request from the map (Enter or Space on a step) or a jump from a
// connection row moves focus to the new panel heading, because the row that was pressed unmounts
// with the old step. The finder's own controls stay mounted, so choosing from them keeps focus
// where it is and Next can be pressed again. Close returns focus to the step on the map, and a
// delete returns it to the search field, so focus never falls to <body>. After the last step is
// deleted the search field is gone, so focus goes to the finder's empty-journey message instead.
//
// The opened step or line is on the dialog stack (useDialogFocus, #19) as a non-modal panel: Escape
// with focus inside it closes it, and never while a dialog above it (the Audit, the product picker)
// is open. The stack does not move focus in on open (the rule above does), and it returns focus to
// the opener only when focus would otherwise fall to <body>, such as after the line panel's Close.
//
// Stacked under the map (below 768px), the panel can open below the fold (R02, rules in
// dockReveal.ts): a tap on a step or line scrolls the new heading into view, where a keyboard open
// already puts it, as does a tap on the step or line already open, and a delete made with a
// pointer brings the map back into view and focuses the map region instead of the search field,
// which scrolled the map away and could raise the keyboard.

interface Props {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  /** The selected step, or null. */
  node: JourneyNode | null;
  /** The selected line, or null. */
  edge: JourneyEdge | null;
  edgeSourceNode: JourneyNode | null;
  edgeTargetNode: JourneyNode | null;
  showRetentionBranches: boolean;
  /** Bumped by App when a choice should also move focus into the panel. */
  focusRequest: number;
  /** App.selectStep: the one way to choose a step. */
  onSelectStep: (nodeId: string | null) => void;
  onCloseEdge: () => void;
  onUpdateNode: (nodeId: string, data: JourneyNodeData) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  offerHeadline: string;
  businessType: string;
  journeyId?: string;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
  /** The map's stats snapshot (#9), passed through to the step and line panels. */
  metrics?: MetricsView;
  /** Passed to the step panel: a sequence step's save-then-open Email Studio button (#21). */
  onOpenEmailStudio?: (nodeId: string) => Promise<boolean>;
  /** Passed to the step panel: link the flow a step just built, save, then open it (Wave 7). */
  onBuildEmailFlow?: (nodeId: string, flow: { id: string; name: string }) => Promise<boolean>;
  openingEmailStudio?: boolean;
  returnFocusNodeId?: string | null;
  onAddStepBefore?: (nodeId: string) => void;
  onAddStepAfter?: (nodeId: string) => void;
}

/** Smooth unless the person asked for reduced motion. */
function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** Focuses a step's own wrapper on the map. False when the step is not on the map (hidden or gone). */
function focusMapStep(id: string): boolean {
  const selector = `.react-flow__node[data-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
}

export const StepDock: React.FC<Props> = ({
  nodes,
  edges,
  node,
  edge,
  edgeSourceNode,
  edgeTargetNode,
  showRetentionBranches,
  focusRequest,
  onSelectStep,
  onCloseEdge,
  onUpdateNode,
  onDeleteNode,
  onDeleteEdge,
  offerHeadline,
  businessType,
  journeyId,
  workspace,
  onOpenShopifyConnect,
  metrics,
  onOpenEmailStudio,
  onBuildEmailFlow,
  openingEmailStudio,
  returnFocusNodeId,
  onAddStepBefore,
  onAddStepAfter
}) => {
  const [jumpTick, setJumpTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const emptyRef = useRef<HTMLParagraphElement | null>(null);
  const seen = useRef({ focusRequest, jumpTick });
  // A delete from the panel is settled after the render that removes the item, not in the click
  // handler: until then we cannot know whether the finder will still show its search field.
  const pendingDelete = useRef<{ kind: 'node' | 'edge'; id: string; byPointer: boolean } | null>(null);
  const [deleteTick, setDeleteTick] = useState(0);
  const asideRef = useRef<HTMLElement | null>(null);
  // How the last panel control was pressed, read when a delete settles.
  const lastInput = useRef<'pointer' | 'keyboard'>('keyboard');
  // The last click on the map, recorded in the capture phase so it is known before the selection
  // it causes renders here.
  const mapTap = useRef<MapTap | null>(null);
  // The step or line whose panel is open, for a tap that lands on it again.
  const openRef = useRef<string | null>(null);
  const revealHeading = () => {
    const heading = headingRef.current;
    if (!heading || boxInView(heading.getBoundingClientRect(), window.innerHeight)) return;
    heading.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  };
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const id = mapTapId(e.target instanceof Element ? e.target : null, e.detail);
      // A tap on the open step or line selects nothing new, so the effect below never runs for it:
      // reveal the panel once the click has settled, if it is still that one's.
      if (tapReopensPanel(id, openRef.current)) {
        mapTap.current = null;
        requestAnimationFrame(() => { if (openRef.current === id) revealHeading(); });
        return;
      }
      mapTap.current = id ? { id, at: performance.now() } : null;
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const closeStep = (id: string) => {
    onSelectStep(null);
    if (!focusMapStep(id)) searchRef.current?.focus();
  };

  // Called before the heading-focus effect below, so the opener it records is the element the
  // person pressed and not the heading.
  const panelRef = useDialogFocus<HTMLDivElement>(
    Boolean(node || edge),
    () => (node ? closeStep(node.id) : onCloseEdge()),
    { modal: false, key: node ? `node:${node.id}` : edge ? `edge:${edge.id}` : null, fallbackFocusId: 'journey-map', initialFocus: false }
  );

  useEffect(() => {
    if (seen.current.focusRequest === focusRequest && seen.current.jumpTick === jumpTick) return;
    seen.current = { focusRequest, jumpTick };
    headingRef.current?.focus();
  }, [focusRequest, jumpTick, node?.id, edge?.id]);

  // Runs after the focus effect above, so a heading that took focus is already in view.
  const openedId = node ? node.id : edge ? edge.id : null;
  useEffect(() => {
    openRef.current = openedId;
    const tapped = tapOpensPanel(mapTap.current, openedId, performance.now());
    mapTap.current = null;
    if (tapped) revealHeading();
  }, [openedId]);

  useLayoutEffect(() => {
    const pending = pendingDelete.current;
    if (!pending) return;
    pendingDelete.current = null;
    const stillThere = pending.kind === 'node'
      ? nodes.some(n => n.id === pending.id)
      : edges.some(e => e.id === pending.id);
    // The delete did not happen (a future confirm step was declined), so focus stays put.
    if (stillThere) return;
    const map = document.getElementById('journey-map');
    const to = deleteFocusTarget({
      byPointer: pending.byPointer,
      stacked: dockStacked(asideRef.current?.getBoundingClientRect() ?? null, map?.getBoundingClientRect() ?? null),
      hasSearch: Boolean(searchRef.current?.isConnected),
      hasMap: Boolean(map)
    });
    if (to === 'map' && map) {
      map.focus({ preventScroll: true });
      map.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      return;
    }
    (to === 'search' ? searchRef.current : emptyRef.current)?.focus();
  }, [deleteTick, nodes, edges]);

  const requestDelete = (kind: 'node' | 'edge', id: string) => {
    pendingDelete.current = { kind, id, byPointer: lastInput.current === 'pointer' };
    setDeleteTick(t => t + 1);
  };

  const jump = (id: string) => {
    onSelectStep(id);
    setJumpTick(t => t + 1);
  };

  return (
    <aside className="jv-step-dock nokey" aria-label="Step panel" ref={asideRef}
      onPointerDownCapture={() => { lastInput.current = 'pointer'; }}
      onKeyDownCapture={() => { lastInput.current = 'keyboard'; }}
    >
      <StepFinder
        nodes={nodes}
        selectedId={node ? node.id : null}
        showRetentionBranches={showRetentionBranches}
        onSelectStep={onSelectStep}
        searchRef={searchRef}
        emptyRef={emptyRef}
      />

      {/* display: contents keeps the panels laid out as direct children of the dock. */}
      <div ref={panelRef} style={{ display: 'contents' }}>
        {node ? (
          // key={node.id}: the editors keep local state, and without a remount Next between two
          // steps of the same type would show the first step's values.
          <NodeInspector
            key={node.id}
            node={node}
            headingRef={headingRef}
            navigation={
              <StepConnections
                nodeId={node.id}
                nodes={nodes}
                edges={edges}
                showRetentionBranches={showRetentionBranches}
                onJump={jump}
                onAddBefore={onAddStepBefore ? () => onAddStepBefore(node.id) : undefined}
                onAddAfter={onAddStepAfter ? () => onAddStepAfter(node.id) : undefined}
              />
            }
            onClose={() => closeStep(node.id)}
            onUpdateNode={onUpdateNode}
            onDeleteNode={id => {
              requestDelete('node', id);
              onDeleteNode(id);
            }}
            offerHeadline={offerHeadline}
            businessType={businessType}
            journeyId={journeyId}
            workspace={workspace}
            onOpenShopifyConnect={onOpenShopifyConnect}
            metrics={metrics}
            onOpenEmailStudio={onOpenEmailStudio}
            onBuildEmailFlow={onBuildEmailFlow}
            openingEmailStudio={openingEmailStudio}
            returnFocusNodeId={returnFocusNodeId}
          />
        ) : edge ? (
          <EdgeInspector
            key={edge.id}
            edge={edge}
            sourceNode={edgeSourceNode}
            targetNode={edgeTargetNode}
            headingRef={headingRef}
            onClose={onCloseEdge}
            onSelectNode={jump}
            onDeleteEdge={id => {
              requestDelete('edge', id);
              onDeleteEdge(id);
            }}
            metrics={metrics}
          />
        ) : nodes.length === 0 ? null : (
          // With no steps at all the finder's own message says what to do, and this hint would
          // point at a list and a map that are both empty.
          <div style={{ padding: '20px 16px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: 'var(--color-text-main)' }}>No step selected.</p>
            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
              Choose one above, or click a step on the map. With a keyboard, press Tab to reach a step and Enter to open it.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};
