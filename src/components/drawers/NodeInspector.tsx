import React from 'react';
import { X, Layers, Trash2 } from 'lucide-react';
import type { JourneyNode, JourneyNodeData, Workspace } from '../../types/journey';
import { AdEditor } from './AdEditor';
import { PageEditor } from './PageEditor';
import { FormEditor } from './FormEditor';
import { SequenceEditor } from './SequenceEditor';
import { ThankYouEditor } from './ThankYouEditor';
import { UpsellEditor } from './UpsellEditor';

interface Props {
  node: JourneyNode | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: JourneyNodeData) => void;
  onDeleteNode?: (nodeId: string) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
}

export const NodeInspector: React.FC<Props> = ({
  node,
  onClose,
  onUpdateNode,
  onDeleteNode,
  offerHeadline,
  businessType,
  workspace,
  onOpenShopifyConnect
}) => {
  if (!node) return null;

  const data = node.data;

  const getTitle = () => {
    switch (data.type) {
      case 'ad-source': return 'Ad Campaign Settings';
      case 'landing-page': return 'Landing Page Editor';
      case 'lead-form': return 'Lead Capture Form';
      case 'follow-up-sequence': return 'Follow-up Nurture Flow';
      case 'thank-you': return 'VIP Thank-You Portal';
      default: return 'Node Configuration';
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '420px',
        maxWidth: '100vw',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
        animation: 'slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={16} color="#818CF8" />
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>
            {getTitle()}
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onDeleteNode && (
            <button
              onClick={() => onDeleteNode(node.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                padding: '6px',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
              title="Delete node from canvas"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              color: '#94A3B8',
              padding: '6px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Drawer Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px'
        }}
      >
        {data.type === 'ad-source' && (
          <AdEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            offerHeadline={offerHeadline}
            businessType={businessType}
          />
        )}
        {data.type === 'landing-page' && (
          <PageEditor
            data={data}
            onChange={updated => onUpdateNode(node.id, updated)}
            offerHeadline={offerHeadline}
            businessType={businessType}
            workspace={workspace}
            onOpenShopifyConnect={onOpenShopifyConnect}
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
          />
        )}
      </div>
    </div>
  );
};
