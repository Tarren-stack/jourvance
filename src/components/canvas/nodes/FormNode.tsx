import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ClipboardCheck, CheckSquare, Eye, Send } from 'lucide-react';
import type { FormNodeData } from '../../../types/journey';

export const FormNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as FormNodeData;
  const activeFields = (d.fields || []).filter(f => f.enabled);

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
      {/* Target Handle (from Landing Page) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }}>
            <ClipboardCheck size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#34D399' }}>
              Lead Capture
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {d.formTitle ? (d.formTitle.length > 18 ? d.formTitle.slice(0, 18) + '…' : d.formTitle) : 'Intake Form'}
            </div>
          </div>
        </div>
        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', fontWeight: 600 }}>
          {activeFields.length} Fields
        </span>
      </div>

      {/* Content Preview */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {activeFields.map(f => (
            <span
              key={f.id}
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.07)',
                color: '#CBD5E1'
              }}
            >
              {f.label}
            </span>
          ))}
        </div>
        <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Send size={11} color="#64748B" /> CTA: <span style={{ color: '#E2E8F0', fontWeight: 500 }}>{d.submitButtonText || 'Submit'}</span>
        </div>
      </div>

      {/* Metrics Bar */}
      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Eye size={10} /> Views
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
            {d.views ? d.views.toLocaleString() : '0'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckSquare size={10} /> Leads
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#38BDF8' }}>
            {d.submissions ? d.submissions.toLocaleString() : '0'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B' }}>
            Comp. %
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>
            {d.completionRate ? `${Math.round(d.completionRate)}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Source Handle (to Sequence) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />
    </div>
  );
};
