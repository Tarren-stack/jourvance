import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Mail, Clock, Users } from 'lucide-react';
import type { SequenceNodeData } from '../../../types/journey';

export const SequenceNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as SequenceNodeData;
  const steps = d.steps || [];

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
      {/* Target Handle (from Form) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FBBF24' }}>
            <Mail size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#FBBF24' }}>
              Nurture Sequence
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {d.sequenceTitle || 'Follow-Up'}
            </div>
            {d.jourvanceFlowName && (
              <div style={{ fontSize: '10px', color: '#FDE68A', marginTop: 2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Flow · {d.jourvanceFlowName}
              </div>
            )}
            {d.klaviyoFlowName && (
              <div style={{ fontSize: '10px', color: '#C4B5FD', marginTop: 2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Klaviyo · {d.klaviyoFlowName}
              </div>
            )}
          </div>
        </div>
        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(245, 158, 11, 0.15)', color: '#FBBF24', fontWeight: 600 }}>
          {steps.length} Letters
        </span>
      </div>

      {/* Steps Preview */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {steps.slice(0, 3).map((s, idx) => (
          <div
            key={s.id || idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 600 }}>#{idx + 1}</span>
              <span style={{ color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                {s.subject}
              </span>
            </div>
            <span style={{ fontSize: '10px', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
              <Clock size={9} /> {s.delay}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {([
          ['Enrolled', d.flowEnrolled],
          ['Sent', d.flowSent],
          ['Clicked', d.flowClicked],
          ['Revenue', d.flowRevenue]
        ] as const).map(([name, value]) => (
          <div key={name}>
            <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {name === 'Enrolled' ? <Users size={10} /> : null} {name}
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
              {value == null ? '—' : name === 'Revenue' ? `$${Number(value).toFixed(2)}` : value.toLocaleString()}
            </div>
          </div>
        ))}
        {typeof d.flowOpened === 'number' && (
          <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#d1d5db' }}>Opened {d.flowOpened}</div>
        )}
      </div>
    </div>
  );
};
