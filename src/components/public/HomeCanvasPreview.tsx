import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, MarkerType, ReactFlow, ReactFlowProvider,
  useNodesInitialized, useReactFlow, type NodeTypes, type EdgeTypes
} from '@xyflow/react';
import { ArrowRight, Scan, Workflow } from 'lucide-react';
import { AdNode } from '../canvas/nodes/AdNode';
import { PageNode } from '../canvas/nodes/PageNode';
import { FormNode } from '../canvas/nodes/FormNode';
import { SequenceNode } from '../canvas/nodes/SequenceNode';
import { ConversionEdge } from '../canvas/edges/ConversionEdge';
import { CanvasMetricsContext } from '../canvas/CanvasMetrics';
import { EdgeLabelLayout } from '../canvas/EdgeLabelLayout';
import { SemanticZoom } from '../canvas/SemanticZoom';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from '../../lib/defaultBlueprint';
import { buildCanvasMetrics } from '../../lib/journeyMetrics';
import { EDGE_KINDS, edgeKind } from '../../lib/edgeKinds';
import type { JourneyNode, JourneyEdge } from '../../types/journey';

const nodeTypes: NodeTypes = {
  'ad-source': AdNode, 'landing-page': PageNode,
  'lead-form': FormNode, 'follow-up-sequence': SequenceNode
};
const edgeTypes: EdgeTypes = { conversion: ConversionEdge };
// Copy the blueprint, including its nested data. Only this example's layout changes.
const example = structuredClone(DEFAULT_LEAD_CAPTURE_PROJECT);
const nodes: JourneyNode[] = example.nodes.map((node, index) => ({
  ...node, position: { x: (index % 2) * 430, y: Math.floor(index / 2) * 340 }
}));
const edges: JourneyEdge[] = example.edges.map(edge => {
  const target = nodes.find(node => node.id === edge.target);
  const color = EDGE_KINDS[edgeKind(edge.sourceHandle, target?.data)].color;
  return {
    ...edge,
    data: { ...edge.data!, sourceHandle: edge.sourceHandle ?? undefined, targetNodeData: target?.data },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 26, height: 26, markerUnits: 'userSpaceOnUse' }
  };
});
const metrics = buildCanvasMetrics(nodes, edges, null);
const steps = [
  { name: 'Ad', description: 'An ad brings visitors to your landing page.' },
  { name: 'Landing page', description: 'Your landing page introduces the offer and leads visitors to the form.' },
  { name: 'Lead form', description: 'The form collects contact details from interested visitors.' },
  { name: 'Follow-up', description: 'A follow-up flow organizes the emails that come next.' }
];

function stepDetails(node: JourneyNode): string[] {
  const data = node.data;
  switch (data.type) {
    case 'ad-source':
      return [data.platform === 'meta' ? 'Meta Ad (IG/FB)' : 'Paid ad', data.headline || 'No headline yet', data.body || 'No ad copy defined yet.'];
    case 'landing-page':
      return [`Page: /${data.slug}`, data.headline || 'No headline yet', data.subhead || 'No subheadline yet'];
    case 'lead-form':
      return [data.formTitle, `Fields: ${data.fields.filter(field => field.enabled).map(field => field.label).join(', ')}`, `Button: ${data.submitButtonText}`];
    case 'follow-up-sequence':
      return [data.sequenceTitle, ...data.steps.map((email, index) => `${index + 1}. ${email.subject || 'No subject yet'} (${email.delay})`)];
    default:
      return [];
  }
}

function FrameExample({ step, width, height }: { step: number | null; width: number; height: number }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!initialized || !width) return;
    // Phones open on a readable card. Overview remains available at every size.
    void fitView({
      nodes: step === null ? undefined : [{ id: nodes[step].id }],
      padding: 0.12, minZoom: step === null ? 0.1 : 1, maxZoom: 1, duration: 0
    });
  }, [initialized, step, width, height, fitView]);
  return null;
}

export function HomeCanvasPreview({ onOpenCanvas }: { onOpenCanvas: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [chosenStep, setChosenStep] = useState<number | null | undefined>(undefined);
  const step = chosenStep === undefined ? (width >= 800 ? null : 0) : chosenStep;
  const description = step === null
    ? 'An ad leads to a landing page, then a lead form and a follow-up email flow.'
    : steps[step].description;
  const metricContext = useMemo(() => ({
    ...metrics,
    nodes: Object.fromEntries(Object.entries(metrics.nodes).map(([id, value]) => [id, {
      ...value, note: 'Example only. No live results.'
    }]))
  }), []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="home-canvas-preview" aria-labelledby="home-canvas-title">
      <header className="home-canvas-preview__header">
        <div>
          <div className="home-canvas-preview__eyebrow"><Workflow size={16} aria-hidden="true" /> Inside the canvas</div>
          <h2 id="home-canvas-title">A lead capture journey</h2>
          <p>The real canvas, with a starter journey. Read-only example, no live results.</p>
        </div>
        <button type="button" className="home-canvas-preview__open" onClick={onOpenCanvas}>
          Open the studio <ArrowRight size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="home-canvas-preview__steps" role="group" aria-label="Explore the example journey">
        <button type="button" aria-pressed={step === null} onClick={() => setChosenStep(null)}>
          <Scan size={16} aria-hidden="true" /> Full journey
        </button>
        {steps.map((item, index) => (
          <button key={item.name} type="button" aria-pressed={step === index} onClick={() => setChosenStep(index)}>
            <span className="home-canvas-preview__number">{index + 1}</span> {item.name}
          </button>
        ))}
      </div>
      <div ref={host} className="home-canvas-preview__map" data-view={step === null ? 'overview' : 'step'}>
        {/* The diagram is inert, like an image. The named controls and description above/below
            supply its accessible alternative without exposing the editor's inactive buttons. */}
        <div className="home-canvas-preview__diagram" aria-hidden="true" {...{ inert: '' }}>
          <CanvasMetricsContext.Provider value={metricContext}>
            <ReactFlowProvider>
              <EdgeLabelLayout>
                <ReactFlow
                  id="home-example-flow" defaultNodes={nodes} defaultEdges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
                  nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
                  nodesFocusable={false} edgesFocusable={false} edgesReconnectable={false}
                  deleteKeyCode={null} selectionKeyCode={null} panOnDrag={false}
                  zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
                  panOnScroll={false} preventScrolling={false} minZoom={0.1} maxZoom={1}
                >
                  <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="rgba(255, 255, 255, 0.08)" />
                  <SemanticZoom />
                  <FrameExample step={step} width={width} height={height} />
                </ReactFlow>
              </EdgeLabelLayout>
            </ReactFlowProvider>
          </CanvasMetricsContext.Provider>
        </div>
      </div>
      <div className="home-canvas-preview__description" aria-live="polite" aria-atomic="true">
        <p>{description}</p>
        {step !== null && <ul>{stepDetails(nodes[step]).map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
      </div>
      <p className="home-canvas-preview__hint">Choose a step to see its details. Your saved journeys stay separate.</p>
    </section>
  );
}
