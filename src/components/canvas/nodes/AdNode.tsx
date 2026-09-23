import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Megaphone, MousePointerClick, Eye, DollarSign } from 'lucide-react';
import type { AdNodeData } from '../../../types/journey';

export const AdNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as AdNodeData;
  const isRoasMode = (d as any).canvasViewMode === 'roas';
  const spend = d.spend || 120;
  const clicks = d.clicks || 95;
  const cpc = d.cpc ? d.cpc : (clicks > 0 ? (spend / clicks) : 1.25);
  const roas = d.roas || 3.8;
  const attributedRev = Math.round(spend * roas);

  return (
    <div
      className={`w-[260px] rounded-xl border transition-all duration-200 cursor-pointer ${
        selected
          ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.35)] bg-slate-900/95'
          : 'border-white/10 hover:border-white/20 bg-slate-900/85 hover:bg-slate-900/95'
      } backdrop-blur-md overflow-hidden text-white`}
      style={{
        background: isRoasMode ? 'rgba(11, 15, 25, 0.95)' : 'rgba(15, 23, 42, 0.9)',
        border: selected
          ? '1.5px solid #6366F1'
          : isRoasMode
          ? '1px solid rgba(16, 185, 129, 0.3)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: selected ? '0 0 20px rgba(99, 102, 241, 0.3)' : '0 10px 25px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* Top Banner */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: isRoasMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isRoasMode ? '#34D399' : '#60A5FA' }}>
            <Megaphone size={15} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: isRoasMode ? '#34D399' : '#60A5FA' }}>
              {isRoasMode ? 'Ad Attribution' : 'Traffic Source'}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {d.platform === 'meta' ? 'Meta Ad (IG/FB)' : d.platform === 'google' ? 'Google Search' : 'Paid Ad'}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: '9999px',
            background: isRoasMode ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)',
            color: '#34D399',
            fontWeight: 700
          }}
        >
          {isRoasMode ? `${roas}x ROAS` : 'Active'}
        </span>
      </div>

      {/* Content Preview / Financial Breakdown */}
      {isRoasMode ? (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#94A3B8' }}>Attributed Revenue:</span>
            <span style={{ fontWeight: 800, color: '#34D399' }}>${attributedRev.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#64748B' }}>Cost Per Click:</span>
            <span style={{ color: '#F1F5F9', fontWeight: 600 }}>${cpc.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#64748B' }}>Total Traffic:</span>
            <span style={{ color: '#38BDF8', fontWeight: 600 }}>{clicks} Clicks</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.headline || 'Untargeted Ad Campaign'}
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {d.body || 'No ad copy defined yet.'}
          </div>
        </div>
      )}

      {/* Metrics Bar */}
      <div style={{ padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <DollarSign size={10} /> Spend
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
            ${spend}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            CPC
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#38BDF8' }}>
            ${cpc.toFixed(2)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
            ROAS
          </div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#34D399' }}>
            {roas}x
          </div>
        </div>
      </div>

      {/* React Flow Source Handle (Traffic goes to next step) */}
      <Handle
        type="source"
        position={Position.Right}
        className="custom-handle"
        style={{ right: -6, top: '50%' }}
      />
    </div>
  );
};
