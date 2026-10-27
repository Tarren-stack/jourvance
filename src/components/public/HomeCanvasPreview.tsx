import React, { useEffect, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, MarkerType, ReactFlow, ReactFlowProvider,
  useNodesInitialized, useReactFlow, type NodeTypes, type EdgeTypes
} from '@xyflow/react';
import { ArrowRight, Scan, Workflow } from 'lucide-react';
import { AdNode } from '../canvas/nodes/AdNode';
import { PageNode } from '../canvas/nodes/PageNode';
import { SequenceNode } from '../canvas/nodes/SequenceNode';
import { UpsellNode } from '../canvas/nodes/UpsellNode';
import { ThankYouNode } from '../canvas/nodes/ThankYouNode';
import { ConversionEdge } from '../canvas/edges/ConversionEdge';
import { CanvasMetricsContext } from '../canvas/CanvasMetrics';
import { EdgeLabelLayout } from '../canvas/EdgeLabelLayout';
import { SemanticZoom } from '../canvas/SemanticZoom';
import { countText, measureValue, moneyText, percentText } from '../../lib/journeyMetrics';
import { createHomeCanvasExample } from './homeCanvasExample';
import { EDGE_KINDS, edgeKind } from '../../lib/edgeKinds';
import { VIEW_LABEL } from '../../lib/studioLabels';
import type { JourneyNode, JourneyEdge } from '../../types/journey';

const nodeTypes: NodeTypes = {
  'ad-source': AdNode, 'landing-page': PageNode,
  upsell: UpsellNode, 'thank-you': ThankYouNode, 'follow-up-sequence': SequenceNode
};
const edgeTypes: EdgeTypes = { conversion: ConversionEdge };
const { nodes, edges: exampleEdges, metrics } = createHomeCanvasExample();
const edges: JourneyEdge[] = exampleEdges.map(edge => {
  const target = nodes.find(node => node.id === edge.target);
  const color = EDGE_KINDS[edgeKind(edge.sourceHandle, target?.data)].color;
  return {
    ...edge,
    data: { ...edge.data!, sourceHandle: edge.sourceHandle ?? undefined, targetNodeData: target?.data },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 26, height: 26, markerUnits: 'userSpaceOnUse' }
  };
});
const steps = [
  { name: 'Ad', description: 'An ad introduces the Everyday Carry Kit and brings visitors to the offer.' },
  { name: 'Main offer', description: 'Visitors buy the $49 kit, then see an optional upgrade. Their purchase also starts the customer email flow.' },
  { name: 'Upsell', description: 'Buyers can add the $24 Travel Organizer Bundle. Accepting leads to confirmation; declining reveals the smaller $12 offer.' },
  { name: 'Downsell', description: 'Buyers who declined the bundle can add the $12 Compact Cable Pouch. Both accepting and declining lead to confirmation.' },
  { name: 'Confirmation', description: 'Every buyer reaches the order confirmation, with or without an add-on.' },
  { name: 'Follow-up', description: 'All buyers receive a receipt, useful kit tips and a check-in email. This flow starts with the purchase, alongside the optional offers.' }
];

function stepDetails(node: JourneyNode): string[] {
  const data = node.data;
  const measure = metrics.nodes[node.id].measure;
  const count = (key: string) => countText(measureValue(measure, key));
  const money = (key: string) => moneyText(measureValue(measure, key));
  const rate = (key: string) => percentText(measureValue(measure, key));
  switch (data.type) {
    case 'ad-source':
      return [data.platform === 'meta' ? 'Meta Ad (IG/FB)' : 'Paid ad', data.headline, data.body,
        `Demo results: ${count('clicks')} visits from ${moneyText(data.spend)} ad spend. ${money('attributedRevenue')} attributed revenue.`];
    case 'landing-page':
      return [`Page: /${data.slug}`, data.headline, data.subhead,
        `Demo results: ${count('visitors')} visitors, ${count('conversions')} purchases, ${rate('conversionRate')} conversion rate. ${money('grossRevenue')} from the main offer.`];
    case 'upsell':
      return [`${data.productTitle}: ${data.productPrice}`, data.headline, data.subhead,
        `Accept: ${data.acceptButtonText}. Decline: ${data.declineButtonText}.`,
        `Demo results: ${count('views')} buyers saw this offer, ${count('takes')} accepted, ${count('totalDeclines')} declined. ${rate('conversionRate')} take rate. ${money('attributedRevenue')} add-on revenue.`];
    case 'thank-you':
      return [data.headline, data.subhead, ...(data.usageGuideSteps || []),
        `Demo results: ${count('pageViews')} buyers reached confirmation.`];
    case 'follow-up-sequence':
      return [data.sequenceTitle, ...data.steps.map((email, index) => `${index + 1}. ${email.subject} (${email.delay})`),
        `Demo results: ${count('flowEnrolled')} enrolled, ${count('flowSent')} emails sent, ${count('flowOpened')} opened, ${count('flowClicked')} clicked. ${money('flowRevenue')} revenue.`];
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
    ? 'Ad → $49 kit → $24 upsell. Decline the upsell to see a $12 downsell. All buyers reach confirmation and receive follow-up emails.'
    : steps[step].description;

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
          <h2 id="home-canvas-title">An upsell and downsell journey <span className="home-canvas-preview__demo">Demo data</span></h2>
          <p>A fictional store campaign on the real canvas. Explore its offers, branches and sample results.</p>
        </div>
        <button type="button" className="home-canvas-preview__open" onClick={onOpenCanvas}>
          {VIEW_LABEL.canvas} <ArrowRight size={16} aria-hidden="true" />
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
          <CanvasMetricsContext.Provider value={metrics}>
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
      <p className="home-canvas-preview__hint">Read-only example. Choose a step to see its details. Your saved journeys stay separate.</p>
    </section>
  );
}
