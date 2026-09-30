import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitFork, TrendingUp, Trophy, ArrowRight } from 'lucide-react';
import type { AbSplitNodeData } from '../../../types/journey';
import { branchHandleStyle } from '../../../lib/edgeKinds';
import { stepKind, cardFrame } from '../../../lib/stepKinds';
import { StepIcon } from '../StepIcon';
import { DesignIssueBadge } from '../DesignIssueBadge';
import { PublishStatusStrip } from '../PublishStatus';
import { StepSummary } from '../StepSummary';
import { useNodeMetrics } from '../CanvasMetrics';
import { countText, measureValue, moneyText, percentText, rateOf, splitTest, UNAVAILABLE } from '../../../lib/journeyMetrics';
import { stepAddress } from '../../../lib/stepNames';

export const AbSplitNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as AbSplitNodeData;
  const kind = stepKind('ab-split', d);
  const isRoasMode = (d as any).canvasViewMode === 'roas';

  const splitRatio = typeof d.splitRatio === 'number' ? Math.max(0, Math.min(100, d.splitRatio)) : 50;
  const ratioA = splitRatio;
  const ratioB = 100 - splitRatio;

  // Per-branch figures come from the map's snapshot (#9); null means not measured, never 0.
  const { measure: m, note } = useNodeMetrics(id);
  const visA = measureValue(m, 'branchAVisitors');
  const convA = measureValue(m, 'branchAConversions');
  const revA = measureValue(m, 'branchAGrossRevenue');
  const rateA = rateOf(convA, visA);
  const aovA = revA !== null && convA !== null && convA > 0 ? revA / convA : null;

  const visB = measureValue(m, 'branchBVisitors');
  const convB = measureValue(m, 'branchBConversions');
  const revB = measureValue(m, 'branchBGrossRevenue');
  const rateB = rateOf(convB, visB);
  const aovB = revB !== null && convB !== null && convB > 0 ? revB / convB : null;

  // A branch's conversions are its orders, or its leads when it took no orders (the ab-split
  // branch of server/routes/analyticsRoutes.mjs), so the card labels them conversions (C40).
  const sum = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
  const totalVisitors = sum(visA, visB);
  const totalConversions = sum(convA, convB);

  // A leader and a lift only once the confidence test has run, the same splitTest the editor's
  // confidence panel reads (C23). Below its per-branch sample the card names no leader.
  const test = splitTest(visA, convA, visB, convB);
  const isBLeading = test.ran && test.leader === 'b';
  const isALeading = test.ran && test.leader === 'a';
  const lift = test.ran && test.lift !== null ? test.lift.toFixed(1) : null;
  const tooFewVisits = !test.ran && test.reason === 'too_few_visits';

  const winner = d.winner;
  // Same rule as the step's spoken name and the step panel (T11): no saved address says so, muted.
  const address = stepAddress({ ...d, type: 'ab-split' });
  const name = address || 'No address yet';

  return (
    <div
      style={{
        width: '300px',
        borderRadius: '14px',
        background: 'rgba(15, 23, 42, 0.95)',
        ...cardFrame(selected, {
          border: winner ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(139, 92, 246, 0.35)',
          boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)'
        }),
        overflow: 'hidden',
        color: '#FFFFFF',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <DesignIssueBadge nodeId={id} />
      {/* Target Handle (Input from Ad Source or previous step) */}
      <Handle
        type="target"
        position={Position.Left}
        className="custom-handle"
        style={{ left: -6, top: '50%', background: '#8B5CF6' }}
      />

      {/* Top Banner */}
      <div
        data-jv-detail-row
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
          <StepIcon kind={kind} icon={GitFork} />
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
            <div data-jv-title style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>
              {address || <span style={{ color: '#94A3B8' }}>{name}</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {winner ? (
            <span
              style={{
                fontSize: '11px',
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
                fontSize: '11px',
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

      <PublishStatusStrip nodeId={id} nodeType="ab-split" />

      {/* Lift / Status Bar */}
      <div
        data-jv-detail-row
        style={{
          padding: '6px 14px',
          background: 'rgba(0, 0, 0, 0.25)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px'
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
              {lift === null ? 'Branch B leading' : `Branch B +${lift}% lift`}
            </>
          ) : isALeading ? (
            <>
              <TrendingUp size={11} />
              {lift === null ? 'Branch A leading' : `Branch A +${lift}% lift`}
            </>
          ) : totalVisitors === null ? (
            UNAVAILABLE
          ) : tooFewVisits && totalVisitors > 0 ? (
            'Too few visits to call a leader'
          ) : totalVisitors > 0 ? (
            'Gathering data'
          ) : (
            'No visits yet'
          )}
        </span>
      </div>

      {/* Dual Branches Comparison Pod */}
      <div data-jv-detail-row style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#C4B5FD' }}>
              {ratioA}% Flow
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px', fontSize: '11px' }}>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>Visitors</span>
              <span data-metric style={{ fontWeight: 700, color: visA === null ? '#94A3B8' : '#F1F5F9' }}>{countText(visA)}</span>
            </div>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>{isRoasMode ? 'Sales' : 'Conversions'}</span>
              <span data-metric style={{ fontWeight: 700, color: (isRoasMode ? revA : convA) === null ? '#94A3B8' : '#34D399' }}>{isRoasMode ? moneyText(revA) : countText(convA)}</span>
            </div>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>{isRoasMode ? 'AOV' : 'Conv. Rate'}</span>
              <span data-metric style={{ fontWeight: 700, color: (isRoasMode ? aovA : rateA) === null ? '#94A3B8' : '#F8FAFC' }}>{isRoasMode ? moneyText(aovA) : percentText(rateA)}</span>
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
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#F472B6' }}>
              {ratioB}% Flow
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px', fontSize: '11px' }}>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>Visitors</span>
              <span data-metric style={{ fontWeight: 700, color: visB === null ? '#94A3B8' : '#F1F5F9' }}>{countText(visB)}</span>
            </div>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>{isRoasMode ? 'Sales' : 'Conversions'}</span>
              <span data-metric style={{ fontWeight: 700, color: (isRoasMode ? revB : convB) === null ? '#94A3B8' : '#34D399' }}>{isRoasMode ? moneyText(revB) : countText(convB)}</span>
            </div>
            <div>
              <span style={{ color: '#94A3B8', display: 'block', fontSize: '11px' }}>{isRoasMode ? 'AOV' : 'Conv. Rate'}</span>
              <span data-metric style={{ fontWeight: 700, color: (isRoasMode ? aovB : rateB) === null ? '#94A3B8' : '#F8FAFC' }}>{isRoasMode ? moneyText(aovB) : percentText(rateB)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Aggregate Bar */}
      <div
        data-jv-detail-row
        style={{
          padding: '8px 14px',
          background: 'rgba(0, 0, 0, 0.35)',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '4px 8px',
          fontSize: '11px'
        }}
      >
        <span style={{ color: '#94A3B8' }}>Total Test Throughput:</span>
        <span data-metric style={{ fontWeight: 700, color: totalVisitors === null ? '#94A3B8' : '#F1F5F9' }}>
          {totalVisitors === null ? UNAVAILABLE : `${countText(totalVisitors)} visitors • ${countText(totalConversions)} conversions`}
        </span>
        <div data-metrics-note style={{ gridColumn: '1 / -1', flexBasis: '100%', fontSize: '11px', color: '#94A3B8' }}>{note}</div>
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
            ...branchHandleStyle('split-a')
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
            ...branchHandleStyle('split-b')
          }}
        />
      </div>

      <StepSummary
        nodeId={id}
        kind={kind}
        icon={GitFork}
        name={name}
        figure={{ label: 'Visitors', value: totalVisitors === null ? UNAVAILABLE : countText(totalVisitors) }}
      />
    </div>
  );
};
