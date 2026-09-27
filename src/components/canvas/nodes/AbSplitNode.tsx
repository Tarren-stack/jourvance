import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitFork, TrendingUp, Trophy, ArrowRight } from 'lucide-react';
import type { AbSplitNodeData } from '../../../types/journey';

export const AbSplitNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as unknown as AbSplitNodeData;
  const isRoasMode = (d as any).canvasViewMode === 'roas';

  const splitRatio = typeof d.splitRatio === 'number' ? Math.max(0, Math.min(100, d.splitRatio)) : 50;
  const ratioA = splitRatio;
  const ratioB = 100 - splitRatio;

  const visA = d.branchAVisitors || 0;
  const convA = d.branchAConversions || 0;
  const revA = d.branchAGrossRevenue || 0;
  const rateA = visA > 0 ? Number(((convA / visA) * 100).toFixed(1)) : 0;
  const aovA = convA > 0 ? Math.round(revA / convA) : 0;

  const visB = d.branchBVisitors || 0;
  const convB = d.branchBConversions || 0;
  const revB = d.branchBGrossRevenue || 0;
  const rateB = visB > 0 ? Number(((convB / visB) * 100).toFixed(1)) : 0;
  const aovB = convB > 0 ? Math.round(revB / convB) : 0;

  const totalVisitors = visA + visB;
  const totalConversions = convA + convB;
  const totalRevenue = revA + revB;

  const isBLeading = rateB > rateA && visB >= 5;
  const isALeading = rateA > rateB && visA >= 5;
  const lift = isBLeading && rateA > 0
    ? (((rateB - rateA) / rateA) * 100).toFixed(1)
    : isALeading && rateB > 0
    ? (((rateA - rateB) / rateB) * 100).toFixed(1)
    : null;

  const winner = d.winner;

  return (
    <div
      style={{
        width: '300px',
        borderRadius: '14px',
        background: 'rgba(15, 23, 42, 0.95)',
        border: selected
          ? '1.5px solid #8B5CF6'
          : winner
          ? '1px solid rgba(16, 185, 129, 0.45)'
          : '1px solid rgba(139, 92, 246, 0.35)',
        boxShadow: selected
          ? '0 0 24px rgba(139, 92, 246, 0.35)'
          : '0 12px 28px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(16px)',
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative'
      }}
    >
      {/* Target Handle (Input from Ad Source or previous step) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%', background: '#8B5CF6' }}
      />

      {/* Top Banner */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(236, 72, 153, 0.08) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'rgba(139, 92, 246, 0.2)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A78BFA'
            }}
          >
            <GitFork size={15} />
          </div>
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#C4B5FD'
              }}
            >
              A/B Traffic Split
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              /{d.slug || 'split-test'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {winner ? (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#34D399',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Trophy size={11} />
              Winner: {winner === 'a' ? 'A' : 'B'}
            </span>
          ) : (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 8px',
                borderRadius: '9999px',
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                color: '#DDD6FE',
                fontWeight: 700
              }}
            >
              {ratioA}% / {ratioB}%
            </span>
          )}
        </div>
      </div>

      {/* Lift / Status Bar */}
      <div
        style={{
          padding: '6px 14px',
          background: 'rgba(0, 0, 0, 0.25)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '10px'
        }}
      >
        <span style={{ color: '#94A3B8', fontWeight: 500 }}>
          {winner ? 'Traffic 100% Routed' : 'Active Traffic Split'}
        </span>
        <span
          style={{
            fontWeight: 700,
            color: isBLeading || isALeading ? '#34D399' : '#C4B5FD',
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
        >
          {isBLeading ? (
            <>
              <TrendingUp size={11} />
              Branch B +{lift}% Lift
            </>
          ) : isALeading ? (
            <>
              <TrendingUp size={11} />
              Branch A +{lift}% Lift
            </>
          ) : totalVisitors > 0 ? (
            'Gathering Data'
          ) : (
            'Awaiting Traffic'
          )}
        </span>
      </div>

      {/* Dual Branches Comparison Pod */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Branch A (Top) */}
        <div
          style={{
            background: winner === 'a' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(139, 92, 246, 0.08)',
            border: winner === 'a' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: '8px',
            padding: '8px 10px',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                {d.branchALabel || 'Branch A (Control)'}
              </span>
            </div>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#C4B5FD' }}>
              {ratioA}% Flow
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px', fontSize: '10px' }}>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>Visitors</span>
              <span style={{ fontWeight: 700, color: '#F1F5F9' }}>{visA.toLocaleString()}</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>{isRoasMode ? 'Sales' : 'Orders'}</span>
              <span style={{ fontWeight: 700, color: '#34D399' }}>{isRoasMode ? `$${revA}` : convA}</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>{isRoasMode ? 'AOV' : 'Conv. Rate'}</span>
              <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{isRoasMode ? `$${aovA}` : `${rateA}%`}</span>
            </div>
          </div>
        </div>

        {/* Branch B (Bottom) */}
        <div
          style={{
            background: winner === 'b' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(236, 72, 153, 0.08)',
            border: winner === 'b' ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(236, 72, 153, 0.2)',
            borderRadius: '8px',
            padding: '8px 10px',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#EC4899' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0' }}>
                {d.branchBLabel || 'Branch B (Challenger)'}
              </span>
            </div>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#F472B6' }}>
              {ratioB}% Flow
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px', fontSize: '10px' }}>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>Visitors</span>
              <span style={{ fontWeight: 700, color: '#F1F5F9' }}>{visB.toLocaleString()}</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>{isRoasMode ? 'Sales' : 'Orders'}</span>
              <span style={{ fontWeight: 700, color: '#34D399' }}>{isRoasMode ? `$${revB}` : convB}</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block', fontSize: '9px' }}>{isRoasMode ? 'AOV' : 'Conv. Rate'}</span>
              <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{isRoasMode ? `$${aovB}` : `${rateB}%`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Aggregate Bar */}
      <div
        style={{
          padding: '8px 14px',
          background: 'rgba(0, 0, 0, 0.35)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px'
        }}
      >
        <span style={{ color: '#94A3B8' }}>Total Test Throughput:</span>
        <span style={{ fontWeight: 700, color: '#F1F5F9' }}>
          {totalVisitors.toLocaleString()} visitors • {totalConversions} conversions
        </span>
      </div>

      {/* Dual Right Source Handles for Branch A and Branch B */}
      <div
        title="Branch A Destination Handle (Connect to Landing Page A)"
        style={{ position: 'absolute', right: 0, top: '44%', transform: 'translateY(-50%)' }}
      >
        <Handle
          type="source"
          id="branch-a"
          position={Position.Right}
          className="custom-handle"
          style={{
            right: -6,
            background: '#8B5CF6',
            width: '10px',
            height: '10px',
            border: '2px solid #0F172A'
          }}
        />
      </div>

      <div
        title="Branch B Destination Handle (Connect to Landing Page B)"
        style={{ position: 'absolute', right: 0, top: '75%', transform: 'translateY(-50%)' }}
      >
        <Handle
          type="source"
          id="branch-b"
          position={Position.Right}
          className="custom-handle"
          style={{
            right: -6,
            background: '#EC4899',
            width: '10px',
            height: '10px',
            border: '2px solid #0F172A'
          }}
        />
      </div>
    </div>
  );
};
