import React from 'react';
import { X, Layers, Trash2 } from 'lucide-react';
import type { JourneyNode, JourneyNodeData, Workspace } from '../../types/journey';
import { AdEditor } from './AdEditor';
import { PageEditor } from './PageEditor';
import { FormEditor } from './FormEditor';
import { SequenceEditor } from './SequenceEditor';
import { ThankYouEditor } from './ThankYouEditor';
import { UpsellEditor } from './UpsellEditor';
import { AbSplitEditor } from './AbSplitEditor';
import { nodeMeasure, type MetricsView } from '../../lib/journeyMetrics';
import { stepName, stepSpokenName } from '../../lib/stepNavigation';
import { stepShortName } from '../../lib/stepNames';
import { isPublishableStep } from '../../lib/publishState';
import type { PreviewOutcome } from '../../lib/saveOutcome';
import { StepPublishPanel } from './StepPublishPanel';
import { usePublishStatus } from '../canvas/PublishStatus';

interface Props {
  node: JourneyNode | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: JourneyNodeData) => void;
  onDeleteNode?: (nodeId: string) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  journeyId?: string;
  onOpenShopifyConnect?: () => void;
  /** The map's stats snapshot (#9); the split editor reads its branch figures from it. */
  metrics?: MetricsView;
  /** The step heading, which the docked panel focuses when a step is opened from the map (#7). */
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** Rendered above the editors: the docked panel's connections list (#7), later its issues (#10). */
  navigation?: React.ReactNode;
  /** A sequence step's Email Studio button (#21): App saves first, then opens it. Resolves false when it did not open. */
  onOpenEmailStudio?: (nodeId: string) => Promise<boolean>;
  /** Build a flow (Wave 7): App links the flow the step built, saves, then opens it. Resolves false when it did not open. */
  onBuildEmailFlow?: (nodeId: string, flow: { id: string; name: string }) => Promise<boolean>;
  /** True while that save is in flight. */
  openingEmailStudio?: boolean;
  /** The step just returned to from Email Studio; its button takes focus once. */
  returnFocusNodeId?: string | null;
  /** Saves, then makes a one-hour preview link (#23). Defaults to the one PublishStatusContext carries. */
  onPreviewStep?: (nodeId: string) => Promise<PreviewOutcome>;
}

export const NodeInspector: React.FC<Props> = ({
  node,
  onClose,
  onUpdateNode,
  onDeleteNode,
  offerHeadline,
  businessType,
  workspace,
  journeyId,
  onOpenShopifyConnect,
  metrics,
  headingRef,
  navigation,
  onOpenEmailStudio,
  onBuildEmailFlow,
  openingEmailStudio,
  returnFocusNodeId,
  onPreviewStep
}) => {
  const publishStatus = usePublishStatus();
  if (!node) return null;
  const onPreview = onPreviewStep ?? publishStatus.preview;

  const data = node.data;
  // The map, Check design and the issue badges call a step by its card wording, so that name
  // sits under the heading too, and both names a person may have heard are on screen together.
  const cardName = stepShortName(node);
  const showCardName = cardName.toLowerCase() !== stepName(node).toLowerCase();

  const getTitle = () => {
    switch (data.type) {
      case 'ad-source': return 'Ad Campaign Settings';
      case 'landing-page': return 'Landing Page Editor';
      case 'lead-form': return 'Lead Capture Form';
      case 'follow-up-sequence': {
        const seq = data as any;
        if (seq.sequenceType === 'upsell_recovery') return 'Courtesy Rescue Flow';
        if (seq.sequenceType === 'checkout_recovery') return 'Abandoned Checkout Rescue';
        if (seq.sequenceType === 'at_risk_winback') return 'VIP Winback Retention Flow';
        if (seq.isRetentionBranch) return 'Customer Retention Sequence';
        return 'Follow-up Nurture Flow';
      }
      case 'thank-you': return 'VIP Thank-You Portal';
      case 'upsell': return 'Upsell & Downsell Offer Editor';
      case 'ab-split': return 'A/B Traffic Splitter';
      default: return 'Node Configuration';
    }
  };

  // A panel inside the docked step panel (StepDock), beside the map rather than over it. The
  // header stays put and the body scrolls. A region named by its heading and described by the
  // step's spoken name (#19); StepDock puts it on the dialog stack, so it does not join it again.
  return (
    <div
      role="region"
      aria-labelledby="jv-step-panel-title"
      aria-describedby="jv-inspector-step"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Header: the step's type as a small line, the step's own name as the heading, then its card wording. */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flex: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Layers size={16} color="#818CF8" aria-hidden="true" style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{getTitle()}</p>
            <h2
              ref={headingRef}
              data-dialog-start
              id="jv-step-panel-title"
              tabIndex={-1}
              style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#FFFFFF', overflowWrap: 'anywhere' }}
            >
              {stepName(node)}
            </h2>
            {showCardName && (
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                {cardName}
              </p>
            )}
            {/* Never drawn: aria-describedby still reads text from a hidden element. */}
            <span id="jv-inspector-step" hidden>
              {stepSpokenName(node, publishStatus.states.get(node.id))}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {onDeleteNode && (
            <button
              type="button"
              onClick={() => onDeleteNode(node.id)}
              aria-label="Delete this step"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                padding: '6px',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="Delete this step"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close step panel"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              color: '#94A3B8',
              padding: '6px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Panel body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px'
        }}
      >
        {/* A page step opens on its words (#17): the editor comes before the publish status and
            the connections, or they push Headline to Page address below the fold. Every other
            step keeps them first. */}
        {data.type === 'landing-page' && (
          <div style={{ marginBottom: '20px' }}>
            <PageEditor
              data={data}
              onChange={updated => onUpdateNode(node.id, updated)}
              offerHeadline={offerHeadline}
              businessType={businessType}
              workspace={workspace}
              onOpenShopifyConnect={onOpenShopifyConnect}
              journeyId={journeyId}
              nodeId={node.id}
            />
          </div>
        )}
        {isPublishableStep(node) && <StepPublishPanel key={node.id} node={node} onPreview={onPreview} />}
        {navigation}
        {data.type === 'ad-source' && (
          <AdEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            offerHeadline={offerHeadline}
            businessType={businessType}
          />
        )}
        {data.type === 'lead-form' && (
          <FormEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
          />
        )}
        {data.type === 'follow-up-sequence' && (
          <SequenceEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            offerHeadline={offerHeadline}
            businessType={businessType}
            workspace={workspace}
            journeyId={journeyId}
            nodeId={node.id}
            onOpenEmailStudio={onOpenEmailStudio ? () => onOpenEmailStudio(node.id) : undefined}
            onBuildEmailFlow={onBuildEmailFlow ? flow => onBuildEmailFlow(node.id, flow) : undefined}
            openingEmailStudio={openingEmailStudio}
            focusStudioButton={returnFocusNodeId === node.id}
          />
        )}
        {data.type === 'thank-you' && (
          <ThankYouEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            workspace={workspace}
          />
        )}
        {data.type === 'upsell' && (
          <UpsellEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            workspace={workspace}
            onOpenShopifyConnect={onOpenShopifyConnect}
          />
        )}
        {data.type === 'ab-split' && (
          <AbSplitEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            measure={nodeMeasure(metrics?.snapshot ?? null, node.id)}
          />
        )}
      </div>
    </div>
  );
};
