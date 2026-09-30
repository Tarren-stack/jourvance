import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ClipboardCheck, CheckSquare, Eye, Send } from 'lucide-react';
import type { FormNodeData } from '../../../types/journey';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics, metricValueStyle } from '../CanvasMetrics';
import { countText, measureValue, percentText } from '../../../lib/journeyMetrics';

export const FormNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as FormNodeData;
  const kind = stepKind('lead-form', d);
  const activeFields = (d.fields || []).filter(f => f.enabled);
  // A form is counted on the page that holds it; the figures come from the map's snapshot (#9).
  const { measure: m, note } = useNodeMetrics(id);
  const viewsText = countText(measureValue(m, 'views'));
  const leadsText = countText(measureValue(m, 'submissions'));
  const completionText = percentText(measureValue(m, 'completionRate'));
  const name = d.formTitle || 'Intake Form';

  return (
    <div
      style={{
        width: '260px',
        borderRadius: '12px',
        background: 'rgba(15, 23, 42, 0.9)',
        ...cardFrame(selected, { border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 10px 25px rgba(0, 0, 0, 0.4)' }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Target Handle (from Landing Page) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%' }}
      />

      {/* Top Banner */}
      <div data-jv-detail-row style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <StepIcon kind={kind} icon={ClipboardCheck} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#34D399' }}>
              Lead Capture
            </div>
            {/* The whole title on up to two lines, broken between words: cut at 18 characters it read
                "Where should we re…" even on a wide screen (U02). */}
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {name}
            </div>
          </div>
        </div>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', fontWeight: 600, flexShrink: 0, marginLeft: '8px' }}>
          {activeFields.length} Fields
        </span>
      </div>

      {/* Content Preview */}
      <div data-jv-detail-row style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {activeFields.map(f => (
            <span
              key={f.id}
              style={{
                fontSize: '11px',
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
      <div data-jv-detail-row style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Eye size={10} /> Views
          </div>
          <div data-metric style={metricValueStyle(viewsText, '#F1F5F9')}>
            {viewsText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckSquare size={10} /> Leads
          </div>
          <div data-metric style={metricValueStyle(leadsText, '#38BDF8')}>
            {leadsText}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>
            Comp. %
          </div>
          <div data-metric style={metricValueStyle(completionText, '#34D399')}>
            {completionText}
          </div>
        </div>
        <div data-metrics-note style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
      </div>

      {/* Source Handle (to Sequence) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />

      <StepSummary nodeId={id} kind={kind} icon={ClipboardCheck} name={name} figure={{ label: 'Leads', value: leadsText }} />
    </div>
  );
};
