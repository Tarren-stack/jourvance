import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layout, Users, CheckCircle, ExternalLink } from 'lucide-react';
import type { PageNodeData } from '../../../types/journey';

export const PageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as PageNodeData;

  return (
    <div
      style={{
        width: '260px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.9)',
        border: selected ? '1.5px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: selected ? '0 0 20px rgba(99, 102, 241, 0.3)' : '0 10px 25px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      {/* Target Handle (from Ad) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818CF8' }}>
            <Layout size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#818CF8' }}>
              Landing Page
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              /{d.slug || 'offer'}
            </div>
          </div>
        </div>
        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', fontWeight: 600 }}>
          Published
        </span>
      </div>

      {/* Content Preview */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {d.headline || 'Offer Page'}
        </div>
        <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {d.subhead || 'Clean single-offer landing page.'}
        </div>
      </div>

      {/* Metrics Bar */}
      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Users size={10} /> Visitors
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
            {d.visitors ? d.visitors.toLocaleString() : '0'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle size={10} /> Conv.
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>
            {d.conversions ? d.conversions.toLocaleString() : '0'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Rate
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F8FAFC' }}>
            {d.conversionRate ? `${d.conversionRate}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Source Handle (to Form) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />
    </div>
  );
};
